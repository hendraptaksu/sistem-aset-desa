# Keuangan Pura Dalem Puri

Aplikasi pembukuan **offline-first** untuk Pura Dalem Puri. Semua transaksi
dicatat sebagai **jurnal double-entry** (debit = kredit), lalu seluruh saldo,
laba, dan laporan dihitung ulang dari jurnal. Tidak ada server, cloud, atau
angka turunan yang disimpan mati.

- **Versi:** 2.0.0
- **Teknologi:** Electron + React + TypeScript + SQLite (`better-sqlite3`)
- **Platform:** Windows (installer NSIS dan portable); dev juga bisa di macOS/Linux
- **Data:** satu file `pura.db` per instalasi, ditambah folder lampiran bukti

> **Status: POC / pra-produksi.** Aplikasi sudah dipakai untuk pengujian dan
> hardening, tetapi **belum dinyatakan production-ready**. Jangan jadikan satu-
> satunya salinan catatan keuangan nyata. Sebelum produksi, selesaikan AUD-01
> (repo/akun/kode instalasi nyata — manual pemilik), uji backup/restore di mesin
> target, dan amankan file data di level sistem operasi. Lihat
> `docs/tickets-audit-2026-10-23.md`.

> **PIN bukan enkripsi.** PIN 6 digit adalah kunci akses aplikasi (hash scrypt +
> salt), bukan kunci enkripsi database. Siapa pun yang memegang file `pura.db`
> atau backup-nya dapat membuka dan membaca data dengan alat SQLite biasa,
> tanpa PIN. Lindungi file dengan akun OS, enkripsi disk, dan media backup yang
> aman.

---

## Ringkasan

- Input harian lewat form terpandu: **Terima Uang**, **Bayar**, **Pindah Dana**,
  **Panjar**, **Piutang & Hutang**, dan **Saldo Awal**.
- **Daftar Akun** untuk menambah, mengubah nama, menonaktifkan, atau menghapus
  akun **Beban/Pendapatan** baru langsung dari aplikasi (tercatat di audit;
  akun langsung dipakai form dan laporan).
- Akuntan pendamping dapat memakai **Jurnal Umum** multi-baris untuk koreksi
  dan jurnal yang tidak cocok dengan form terpandu.
- Koreksi tidak pernah mengedit/menghapus jurnal lama: selalu **jurnal balik
  (reversal) + alasan**, dengan jejak audit.
- Laporan: Buku Besar, Neraca Saldo (tahun berjalan/kumulatif), Laba Rugi,
  Neraca, Arus Kas, Rekonsiliasi Bank, Anggaran, Panjar, dan aset/inventaris.
- Lampiran bukti (foto/PDF) disimpan di folder `attachments`, bukan di dalam
  database.
- Backup database memakai `VACUUM INTO`; tersedia **Backup Lengkap** yang
  menyertakan database + lampiran + `manifest.json`.
- Aplikasi selalu terkunci saat dibuka, memiliki auto-kunci idle, dan kunci
  otomatis saat laptop sleep/lock-screen.

---

## Arsitektur satu halaman

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Renderer (Chromium) — React 19 + Tailwind                           │
│ Tab: Dashboard, Transaksi, Daftar Akun, Panjar, Pihak, Jurnal,     │
│ laporan, Pengaturan, Import Excel, Aset                             │
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
│ forms, posting, reports,     │  │ database.ts (DDL + migrasi v9),   │
│ reversal, periode, pin,      │  │ repository, jurnal, panjar, pihak,│
│ tutup, anggaran, rekonsiliasi│  │ lampiran, laporan, seed-dev       │
└──────────────────────────────┘  └─────────────┬─────────────────────┘
                                                 │
                                    ┌────────────▼────────────┐
                                    │ SQLite pura.db (WAL)    │
                                    │ jurnal + jurnal_baris   │
                                    └─────────────────────────┘

src/features/*: import Excel, export XLSX/PDF/HTML, backup & restore lengkap.
```

Prinsip yang dijaga:

1. **Satu pintu ke database.** Renderer hanya memanggil IPC; DDL hanya ada di
   `src/db/database.ts`.
2. **Satu sumber angka.** `jurnal` + `jurnal_baris` adalah sumber kebenaran.
   Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Arus Kas, dan Dashboard dihitung
   dari jurnal, bukan dari tabel saldo/laba tersimpan.
3. **Logika akuntansi murni** ada di `src/core/` supaya mudah diuji tanpa
   Electron. Lapisan `src/db/` mengurus SQL; `src/main/` mengurus IPC/OS.
4. **Skema v9** (lihat `SCHEMA_VERSION` di `src/db/database.ts`). Tabel
   single-entry lama sudah dibuang; migrasi bersifat idempotent dan backup
   pra-upgrade tetap dibuat.
5. **Offline dan satu file.** Tidak ada backend; seluruh data ada di `pura.db`
   dan folder `attachments` di mesin yang sama.

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

| Mode | Database | Lampiran | Backup internal |
|---|---|---|---|
| Installer Windows | `%APPDATA%\Keuangan Pura Dalem Puri\data\pura.db` | `%APPDATA%\Keuangan Pura Dalem Puri\attachments` | `%APPDATA%\Keuangan Pura Dalem Puri\data\backups` |
| Portable Windows | `<folder exe>\data\pura.db` | `<folder exe>\attachments` | `<folder exe>\backups` |
| Dev (`PURA_DB`) | path dari `PURA_DB`, contoh `./data/pura-dev.db` | `<userData>\attachments` | `backups` di samping database |

Lokasi persis selalu bisa dilihat di **Pengaturan → Lokasi Data & Backup**.
Rincian ada di `docs/panduan-portable.md`.

### Peringatan backup lampiran

- **Backup Export .db** dan backup otomatis `auto-YYYY-MM-DD.db` **hanya**
  menyalin database. File di folder `attachments` **tidak ikut**.
- **Backup Lengkap (DB + lampiran)** menghasilkan satu folder berisi
  `pura.db`, folder `attachments/`, dan `manifest.json`. Pakai ini untuk arsip
  jangka panjang atau pindah laptop.
- **Restore Import .db** hanya memulihkan database; **Restore Lengkap**
  memulihkan database dan lampiran dari folder hasil Backup Lengkap.
- Menyalin hanya `pura.db` ke laptop lain akan membuat metadata lampiran
  menunjuk file yang tidak ada. Selalu simpan `.db` dan `attachments` bersama.
- Backup **tidak terenkripsi**. Simpan di media yang aman dan pisahkan dari
  laptop (flashdisk/Drive) secara rutin.

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
- `docs/lampiran-bukti.md` — aturan foto/PDF bukti jurnal.
- `docs/arah-akuntansi.md` — keputusan arah double-entry.
- `docs/hardening-electron.md` — single-instance, CSP, dan keamanan window.
- `docs/rilis.md` — icon aplikasi dan signing installer Windows.
- `docs/tickets-audit-2026-10-23.md` — daftar pekerjaan hardening.
- `docs/erd-v1-arsip.md` — **arsip** ERD v1.2.0 (single-entry), bukan acuan aktif.

Lisensi: ISC.
