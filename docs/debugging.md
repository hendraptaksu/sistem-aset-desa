# Debugging & Smoke Test

Alat bantu untuk memeriksa aplikasi tanpa menyentuh database asli. Semua
perintah dijalankan dari root repo.

## Prasyarat

- Node 24 (sama dengan CI; `better-sqlite3@13` bermasalah di Node 20/22 lama).
  Repo menyediakan `.nvmrc`, jadi jalankan `nvm use` lebih dulu.
- Dependensi sudah terpasang: `npm install`.
- Playwright Electron terpasang sebagai devDependency (`playwright-core`) dan
  memakai binary Electron proyek — tidak mengunduh browser Chromium.

## 1. Smoke test otomatis (Playwright Electron)

```bash
npm run smoke
```

Perintah ini:

1. build produksi (`npm run build`),
2. menjalankan dua skenario E2E berurutan dengan profil Electron dan database
   sementara: smoke UI (`e2e/smoke.test.mjs`) dan alur pinjaman
   (`e2e/pinjaman.test.mjs`),
3. pada smoke test, mengisi database kosong dengan 240 jurnal dummy
   (`PURA_SEED_DEV`), membuat PIN awal lewat UI, lalu memastikan dashboard
   tampil dan neraca saldo **Seimbang**,
4. menyimpan screenshot ke `e2e/artifacts/<waktu>/` (di-gitignore).

Saat gagal, folder data sementara (database, backup) otomatis
disimpan dan path-nya dicetak di output. Untuk mempertahankan folder data meski
test lulus:

```bash
SMOKE_KEEP=1 npm run test:e2e
```

Untuk menjalankan tanpa build ulang: `npm run test:e2e`.

## 2. Debug renderer via Chrome DevTools Protocol

```bash
npm run dev:debug
```

Yang tersedia:

- **CDP renderer:** <http://localhost:9222/json> — buka DevTools/Chrome dan
  hubungkan ke target aplikasi.
- **V8 inspector main process:** port `5858` — buka `chrome://inspect` lalu
  pilih proses Electron, atau pasang breakpoint di `src/main`.

Tutup instance aplikasi/dev lain lebih dulu — Electron memakai single-instance
lock, sehingga instance kedua langsung keluar. Jika port `9222`/`5858` sedang
dipakai, ubah angkanya di script `dev:debug` pada `package.json`.

Matikan proses dengan `Ctrl+C` setelah selesai. Port debug hanya untuk mesin
lokal; jangan diekspos ke jaringan.

## 3. Menjalankan build dengan data terisolasi

Cara manual (macOS/Linux):

```bash
mkdir -p /tmp/pura-debug
PURA_DB=/tmp/pura-debug/pura.db \
  node_modules/.bin/electron . \
  --user-data-dir=/tmp/pura-debug/profile
```

PowerShell:

```powershell
$env:PURA_DB = "$env:TEMP\pura-debug\pura.db"
.\node_modules\.bin\electron.cmd . --user-data-dir="$env:TEMP\pura-debug\profile"
```

Catatan:

- `PURA_DB` menang atas lokasi data normal, tetapi **hanya dibaca saat app
  belum dipaketkan** (lihat `src/main/index.ts`).
- Backup tetap berada di samping file database.
- Selalu gunakan folder/profile baru saat menguji skenario merusak data,
  restore, atau pemulihan database. Jangan arahkan ke data produksi.
- Untuk data dummy, tambahkan `PURA_SEED_DEV=true`. Seeder hanya mengisi
  database yang tabel jurnalnya masih kosong.

## 4. Memeriksa database & backup

Database uji adalah SQLite biasa. Bisa dibuka dengan DB Browser for SQLite
atau CLI `sqlite3`:

```bash
sqlite3 /tmp/pura-debug/pura.db ".tables"
sqlite3 /tmp/pura-debug/pura.db "SELECT COUNT(*) FROM jurnal;"
```

Backup otomatis/manual ada di folder `backups/` di samping database. Backup
lengkap berisi `pura.db` dan `manifest.json`.

## 5. Debug UI kustom dengan Playwright

Contoh minimal untuk memakai Electron yang sudah berjalan di test:

```js
import { _electron as electron } from 'playwright-core';

const app = await electron.launch({
  args: ['.', '--user-data-dir=/tmp/pura-debug/profile'],
  env: { ...process.env, PURA_DB: '/tmp/pura-debug/pura.db' },
});
const page = await app.firstWindow();
await page.screenshot({ path: 'debug.png', fullPage: true });
await app.close();
```

Helper di `e2e/smoke.test.mjs` bisa dipakai sebagai contoh menangani layar PIN,
menunggu elemen, dan mengumpulkan error console.

## 6. Test unit yang sudah ada

```bash
npm test
npm run typecheck
```

Smoke test sengaja dipisah dari Vitest (`tests/**/*.test.ts`) agar tidak ikut
berjalan di CI Windows dan tidak membutuhkan tampilan grafis.
