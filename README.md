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
> target, dan amankan file data di level sistem operasi. Lihat
> `docs/tickets-audit-akuntansi-2026-10-27.md`.

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
│ forms, posting, reports,     │  │ database.ts (DDL + migrasi 2–21), │
│ reversal, periode, pin,      │  │ repository, jurnal, panjar,       │
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
4. **Skema v21** (lihat `SCHEMA_VERSION` di `src/db/database.ts`; kontrak
   lengkap di `docs/erd-v2.md`). Ada 11 tabel aktif: `akun`, `jurnal`,
   `jurnal_baris`, `tutup_buku`, `audit_log`, `pengaturan`, `panjar`,
   `panjar_item`, `pinjaman`, `pinjaman_angsuran`, dan `pinjaman_bayar`.
   Tabel single-entry lama (`transaksi`/`coa`) hanya dibersihkan dari DB asli
   v0–v2; tabel modul yang sudah dihapus dibuang oleh migrasi v12 idempoten.
   `panjar`, `panjar_item`, dan `tutup_buku` tidak pernah dibuang berdasarkan
   bentuk kolom. Backup pra-upgrade (`pre-upgrade-*.db`) dibuat untuk setiap
   kenaikan versi sebelum migrasi berjalan. Sejak v13 hanya boleh ada satu
   jurnal `SALDO_AWAL`; sejak v14 satu jurnal hanya boleh punya satu reversal
   dan DB menolak insert dengan jenis/tanggal tidak valid; sejak v15 nama akun
   unik tanpa membedakan huruf besar/kecil dan trigger menolak akun dengan
   kode/nama/tipe/posisi/aktif tidak valid; v20 menambah tabel pinjaman LPD;
   v21 menambah referensi audit terstruktur. Migrasi berhenti tanpa mengubah
   data bila DB lama berisi duplikat. Tabel baru setelah DB-30 wajib `STRICT`
   dengan `DEFAULT` eksplisit (termasuk `created_at` ISO); tabel pinjaman
   adalah warisan v20 dan tidak direbuild tanpa ticket migrasi terpisah.
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
  memulihkan database dari folder hasil Backup Lengkap. Keduanya memvalidasi
  kandidat (termasuk foreign key dan tabel wajib sesuai versi skema) dan
  mencadangkan database aktif lebih dulu.
- Backup **tidak terenkripsi**. Simpan di media yang aman dan pisahkan dari
  laptop (flashdisk/Drive) secara rutin.
- **Migrasi skema.** Saat database lama dibuka, aplikasi membuat
  `pre-upgrade-*.db` di folder `backups` lebih dulu, lalu menjalankan migrasi
  idempoten. Skema v21 membuang tabel modul yang sudah dihapus pada v12,
  menegakkan satu jurnal saldo awal (v13), satu reversal per jurnal dan validasi
  jenis/tanggal insert jurnal (v14), unique nama akun dan validasi
  kode/nama/tipe/posisi/aktif akun (v15), menambah metadata akun (v16), detail
  nota panjar (v17), link jurnal panjar (v18), pembatalan panjar (v19), tabel
  pinjaman LPD (v20), dan referensi audit terstruktur (v21); `jurnal`,
  `jurnal_baris`, `panjar`, `panjar_item`, `tutup_buku`, `audit_log`, dan
  `pengaturan` tidak ikut dibuang.

---

## Keamanan dan keterbatasan

- **PIN = kunci akses, bukan enkripsi.** Hash PIN disimpan di database; isi
  database tetap teks/SQLite biasa. PIN tidak melindungi file yang dicuri.
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

- `docs/panduan-pengguna.md` — panduan operator harian.
- `docs/panduan-pemeriksaan.md` — panduan akuntan/pemeriksa.
- `docs/panduan-portable.md` — installer vs portable dan pindah laptop.
- `docs/arah-akuntansi.md` — keputusan arah double-entry.
- `docs/sumber-coa.md` — sumber mesin COA (CSV), arsip xlsx, dan ekstensi sistem.
- `docs/sumber-data-pinjaman.md` — sumber data pinjaman LPD (rencana vs jurnal).
- `docs/erd-v2.md` — ERD skema aktif v21: tabel, kolom, relasi, index, trigger,
  dan aturan sumber angka.
- `docs/hardening-electron.md` — single-instance, CSP, dan keamanan window.
- `docs/rilis.md` — icon aplikasi dan signing installer Windows.
- `docs/audit-ui-2026-10-27.md` — audit UI/UX + bukti pengukuran.
- `docs/tickets-ui-2026-10-27.md` — ticket perbaikan UI untuk AI agent.
- `docs/tickets-audit-akuntansi-2026-10-27.md` — daftar pekerjaan audit/hardening.

Lisensi: ISC.
