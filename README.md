# Keuangan Pura Dalem Puri

Aplikasi pembukuan **offline-first** untuk Pura Dalem Puri. Semua transaksi
dicatat sebagai **jurnal double-entry** (debit = kredit), lalu seluruh saldo,
laba, dan laporan dihitung ulang dari jurnal. Tidak ada server, cloud, atau
angka turunan yang disimpan mati.

- **Versi:** 2.0.0
- **Teknologi:** Electron + React + TypeScript + SQLite (`better-sqlite3`)
- **Platform:** Windows (installer NSIS dan portable); dev juga bisa di macOS/Linux
- **Data:** satu file `pura.db` per instalasi

> **Status: POC / pra-produksi.** Aplikasi sudah dipakai untuk pengujian dan
> hardening, tetapi **belum dinyatakan production-ready**. Jangan jadikan satu-
> satunya salinan catatan keuangan nyata. Sebelum produksi, selesaikan AUD-01
> (repo/akun/kode instalasi nyata — manual pemilik), uji backup/restore di mesin
> target, dan amankan file data di level sistem operasi. Checklist rilis dan
> signing ada di `docs/rilis.md`.

> **PIN bukan enkripsi.** PIN 6 digit adalah kunci akses aplikasi (hash scrypt +
> salt), bukan kunci enkripsi database. Siapa pun yang memegang file `pura.db`
> atau backup-nya dapat membuka dan membaca data dengan alat SQLite biasa,
> tanpa PIN. Lindungi file dengan akun OS, enkripsi disk, dan media backup yang
> aman.

---

## Ringkasan

- Input harian lewat form terpandu: **Terima Uang**, **Bayar**, **Pindah Dana**,
  **Panjar**, **Catat Utang Usaha**, **Bayar Utang Usaha**, dan **Saldo Awal**.
- **Daftar Akun** untuk menambah, mengubah nama, menonaktifkan, atau menghapus
  akun **Beban/Pendapatan** baru langsung dari aplikasi (tercatat di audit;
  akun langsung dipakai form dan laporan). Akun bawaan boleh dinonaktifkan untuk
  input baru tanpa menghapus histori; rename/hapus dan empat akun sistem
  `3000/1040/1050/2050` tetap terkunci.
- Akuntan pendamping dapat memakai **Jurnal Umum** multi-baris untuk koreksi
  dan jurnal yang tidak cocok dengan form terpandu. Menu ini hanya tampil
  setelah **Mode lanjutan** diaktifkan di Pengaturan.
- **Kunci Periode** menandai tahun yang sudah selesai dan mengunci tanggalnya;
  ini bukan jurnal penutup dan laba tetap dihitung ulang dari jurnal.
- Koreksi tidak pernah mengedit/menghapus jurnal lama: selalu **jurnal balik
  (reversal) + alasan**, dengan jejak audit.
- Laporan: Buku Besar, Neraca Saldo (tahun berjalan/kumulatif), Laba Rugi,
  Neraca, Arus Kas, dan Panjar.
- Backup database memakai `VACUUM INTO`; tersedia **Backup Lengkap** berisi
  database + `manifest.json` dalam satu folder.
- Aplikasi selalu terkunci saat dibuka, memiliki auto-kunci idle, dan kunci
  otomatis saat laptop sleep/lock-screen.

---

## Arsitektur satu halaman

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer (Chromium) — React 19 + Tailwind                           │
│ Tab: Dashboard, Transaksi, Daftar Akun, Panjar, Pinjaman LPD,      │
│ laporan, Kunci Periode, dan Pengaturan; Jurnal Umum hanya tampil    │
│ saat Mode lanjutan aktif.                                           │
│ Tidak pernah menyentuh SQLite; semua lewat window.api.invoke()      │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ IPC (preload CJS, contextBridge)
┌───────────────────────────────▼─────────────────────────────────────┐
│ Main process (Node/Electron)                                        │
│ - src/main/index.ts: window, auto-lock, backup periodik, recovery   │
│ - src/main/ipc.ts: registry channel + validasi input/sender         │
│ - src/main/validation.ts: guard bentuk data & periode terkunci      │
│ - src/main/kunci.ts: PIN scrypt, sesi memori, kode darurat          │
└───────────────┬───────────────────────────────┬─────────────────────┘
                │                               │
┌───────────────▼──────────────┐  ┌─────────────▼─────────────────────┐
│ src/core/* — logika murni    │  │ src/db/* — akses SQLite           │
│ forms, posting, reports,     │  │ database.ts (DDL + guard skema    │
│ reversal, periode, pin,      │  │ v1), repository, jurnal, panjar,  │
│ tutup, pengaturan            │  │ laporan, seed-dev                 │
└──────────────────────────────┘  └─────────────┬─────────────────────┘
                                                 │
                                    ┌────────────▼────────────┐
                                    │ SQLite pura.db (WAL)    │
                                    │ jurnal + jurnal_baris   │
                                    └─────────────────────────┘

src/features/*: export XLSX/PDF/HTML, backup & restore lengkap.
```

Prinsip yang dijaga:

1. **Satu pintu ke database.** Renderer hanya memanggil IPC; DDL hanya ada di
   `src/db/database.ts`.
2. **Satu sumber angka.** `jurnal` + `jurnal_baris` adalah sumber kebenaran.
   Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Arus Kas, dan Dashboard dihitung
   dari jurnal, bukan dari tabel saldo/laba tersimpan.
3. **Logika akuntansi murni** ada di `src/core/` supaya mudah diuji tanpa
   Electron. Lapisan `src/db/` mengurus SQL; `src/main/` mengurus IPC/OS.
4. **Skema baseline v1** (lihat `SCHEMA_VERSION = 1` di
   `src/db/database.ts`; kontrak lengkap di `docs/skema.md`). Ada 11 tabel
   aktif: `akun`, `jurnal`, `jurnal_baris`, `tutup_buku`, `audit_log`,
   `pengaturan`, `panjar`, `panjar_item`, `pinjaman`, `pinjaman_angsuran`, dan
   `pinjaman_bayar`. Seluruh tabel aktif memakai `STRICT` dengan `DEFAULT`
   eksplisit bila diperlukan (termasuk `created_at` ISO). **Tidak ada
   migrasi/pre-upgrade**: database dengan skema lain ditolak sebelum file diubah.
   Operator memindahkan atau menghapus file database lama, lalu menjalankan
   aplikasi lagi agar database baru dengan skema baseline v1 dibuat.
5. **Offline dan satu file.** Tidak ada backend; seluruh data ada di `pura.db`
   di mesin yang sama.

---

## Perintah

Prasyarat: Node.js 24 (lihat `.nvmrc`) dan npm.

```bash
npm install

npm run dev        # jalankan aplikasi mode development (electron-vite)
npm test           # seluruh test Vitest
npm run typecheck  # TypeScript tanpa emit
npm run build      # build main/preload/renderer ke out/
npm run dist       # build + paket installer untuk OS saat ini
npm run dist:win   # build + installer NSIS & portable Windows (paling aman di Windows/CI)
```

Untuk development, salin `.env.example` menjadi `.env` lalu sesuaikan. Env hanya
dibaca saat `npm run dev`; aplikasi terpasang memakai lokasi data standar.

---

## Lokasi data

Nama folder mengikuti `productName`: **Keuangan Pura Dalem Puri**.

| Mode | Database | Backup internal |
|---|---|---|
| Installer Windows | `%APPDATA%\Keuangan Pura Dalem Puri\data\pura.db` | `%APPDATA%\Keuangan Pura Dalem Puri\data\backups` |
| Portable Windows | `<folder exe>\data\pura.db` | `<folder exe>\backups` |
| Dev (`PURA_DB`) | path dari `PURA_DB`, contoh `./data/pura-dev.db` | `backups` di samping database |

Lokasi persis selalu bisa dilihat di **Pengaturan → Lokasi Data & Backup**.
Rincian ada di `docs/panduan-portable.md`.

### Backup dan restore

- **Backup Export .db** dan backup otomatis `auto-YYYY-MM-DD.db` **hanya**
  menyalin database.
- **Backup Lengkap** menghasilkan satu folder berisi `pura.db` dan
  `manifest.json`. Pakai ini untuk arsip jangka panjang atau pindah laptop.
- **Restore Import .db** memulihkan database dari satu file; **Restore Lengkap**
  memulihkan database dari folder hasil Backup Lengkap. Keduanya hanya menerima
  backup dengan skema baseline v1, memvalidasi kandidat (termasuk foreign key,
  tabel wajib, dan audit akuntansi), lalu mencadangkan database aktif lebih dulu.
- Backup **tidak terenkripsi**. Simpan di media yang aman dan pisahkan dari
  laptop (flashdisk/Drive) secara rutin.
- **Keputusan enkripsi backup (T3.3):** untuk rilis ini, backup `.db` **tidak
  dienkripsi** dan **PIN bukan enkripsi** — PIN hanya kunci akses aplikasi,
  bukan kunci isi file. Keputusan yang dipilih adalah **dokumentasi + imbauan
  menyimpan backup di disk/volume terenkripsi**, bukan implementasi SQLCipher
  atau arsip terenkripsi sekarang. Alasan: enkripsi penuh mengubah format
  database/backup, berisiko kompatibilitas dengan backup lama, dan perlu
  rancangan restore yang terpisah. Opsi **SQLCipher** (enkripsi penuh) dan
  **arsip terenkripsi** (mis. ZIP berpassword) dicatat sebagai kandidat
  **tiket terpisah**, bukan bagian rilis ini. Risiko yang diterima: siapa pun
  yang memegang file backup dapat membacanya dengan alat SQLite biasa tanpa
  PIN. Mitigasi: aktifkan enkripsi disk (BitLocker/FileVault), simpan backup
  hanya di media terenkripsi, jangan unggah ke cloud publik, dan hapus salinan
  lama yang tidak diperlukan.
- **Hanya skema baseline v1 yang didukung.** Tidak ada migrasi/pre-upgrade.
  Database atau backup dari skema lama ditolak tanpa mengubah file;
  pindahkan atau hapus file database lama tersebut, lalu jalankan aplikasi lagi.
  Backup yang dibuat aplikasi versi ini selalu dapat dipulihkan pada aplikasi
  versi ini.

---

## Keamanan dan keterbatasan

- **PIN = kunci akses, bukan enkripsi.** Hash PIN disimpan di database; isi
  database tetap teks/SQLite biasa. PIN tidak melindungi file yang dicuri.
  **Keputusan T3.3:** rilis ini memilih dokumentasi + imbauan disk terenkripsi,
  bukan SQLCipher/arsip terenkripsi; opsi enkripsi penuh menjadi tiket
  terpisah.
- **Lockout PIN bertahan setelah restart, tetapi tetap bukan enkripsi.** Setelah
  5 kali PIN salah, aplikasi memblokir percobaan selama 60 detik dan menyimpan
  hitungan gagal/waktu blokir di tabel `pengaturan`. Menutup lalu membuka
  aplikasi tidak mereset lockout, sehingga tebak PIN tidak bisa diulang tanpa
  batas. Perlindungan ini hanya untuk UI; isi database dan backup tetap tidak
  terenkripsi dan harus diamankan di level OS/media.
- **Kode darurat dibuat per-install.** Saat setup PIN pertama, aplikasi membuat
  kode acak 4 grup, menyimpan hash+salt scrypt, dan menampilkan kode itu **sekali**
  untuk dicatat di dokumen fisik. Tidak ada kode default/global atau override
  env. Kode dapat diganti di **Pengaturan → Kode Darurat**; kode lama langsung
  tidak berlaku. Instalasi lama tanpa hash ditolak dengan pesan untuk mengatur
  kode terlebih dahulu.
- Satu instalasi = satu laptop, satu PIN, tanpa multi-user.
- Aplikasi tidak mengirim data ke internet. Pembaruan aplikasi dilakukan manual.

---

## Dokumentasi

Dokumen kanonik utama:

- `docs/skema.md` — kontrak skema baseline v1: 11 tabel `STRICT`, kolom,
  relasi, index, trigger, sumber COA, dan aturan sumber angka.
- `docs/prinsip-akuntansi.md` — prinsip double-entry, koreksi/reversal, kunci
  periode, cut-over, dan batas yang masih berlaku.

Panduan pendukung:

- `docs/panduan-pengguna.md` — panduan operator harian.
- `docs/panduan-pemeriksaan.md` — panduan akuntan/pemeriksa.
- `docs/panduan-portable.md` — installer vs portable dan pindah laptop.
- `docs/hardening-electron.md` — single-instance, CSP, dan keamanan window.
- `docs/debugging.md` — smoke test, debug Electron, dan data terisolasi.
- `docs/template-cetak.md` — tata letak cetak, pratinjau, dan Simpan PDF.
- `docs/rilis.md` — icon aplikasi dan signing installer Windows.

> **Agent:** baca `docs/skema.md` dan `docs/prinsip-akuntansi.md` lebih dulu;
> panduan pengguna/pemeriksaan hanya bila relevan.

Arsip tiket yang sudah selesai tidak disimpan di working tree; riwayatnya tetap
tersedia di git.

Lisensi: ISC.
