# Progress — Sistem Pembukuan Pura Dalem Puri

> Sumber: `PRD.md` + keputusan diskusi. Update file ini tiap selesai 1 fitur: ubah `- [ ]` jadi `- [x]` + isi tanggal & catatan.
> Format: `- [x] Fitur (2026-09-04: catatan)`

Terakhir update: 2026-09-07 — MODUL 7 INVENTARIS ASET SELESAI: tabel `aset` + CRUD + tab Electron ke-9 + export ber-kop, isolasi penuh dari BKU/Neraca; 61/61 test hijau, tsc bersih, build OK.

## Keputusan yang sudah dikunci
- [x] Framework: Electron + Vite + React + TS + Tailwind/shadcn + better-sqlite3 + drizzle (2026-09-04: dev di Mac, build Windows nanti via CI)
- [x] BKU pakai 2 dropdown: Akun Kas (`KAS_KODES`) + Kategori (PENDAPATAN/BEBAN/1050/2050/3000, lihat `KODE AKUN.csv`) (2026-09-04: agar Neraca bisa BALANCE)
- [x] Tutup buku: hitungan auto + kunci manual longgar (2026-09-04: bisa edit tahun lalu + wajib alasan + audit_log)
- [x] Modul 6 baru: Surplus / (Defisit) = Laba-Rugi versi Pura (2026-09-04: disetujui)
- [x] Format tracking: 1 file ini (2026-09-04)

## Phase 0 — Setup & Core (fokus akurasi di Mac)
- [x] Scaffold npm + SQLite konek di Mac (2026-09-04: better-sqlite3 WAL, `npm test` → vitest; UI Electron menyusul)
- [x] Seed COA resmi client (2026-09-04: `KODE AKUN.csv` → `src/db/coa.ts`; 16 kas + 1050 piutang + 2050 + 3000-3002 + 12 pendapatan + 15 beban; 1001 KAS, bukan 1000)
- [x] Skema tabel (2026-09-04: `src/db/database.ts` + `src/db/repository.ts`; kontrak freeze di `src/core/types.ts`)
- [x] Helper Rupiah (2026-09-04: `src/utils/format.ts`, T8 lolos)

## Modul 1 — Buku Kas Umum (BKU)
- [x] Form: Tanggal, Keterangan, Akun Kas, Kategori, Masuk/Keluar, Nominal (2026-09-04: `BkuTab.tsx`, validasi di main + `validation.ts`)
- [x] Tabel + pagination + pencarian + filter rentang tanggal (2026-09-04: 20/halaman, filter kas + kategori)
- [x] Saldo per kas auto-update (2026-09-04: chip saldo via `saldo:list`, refresh tiap simpan)

## Modul 2 — Buku Pembantu
- [x] Filter otomatis per kode rekening dari BKU (2026-09-04: `buildPembantu` kas/kategori/PANJAR, test B1 lolos)
- [x] Total Masuk / Keluar / Saldo Akhir per sub-ledger (2026-09-04: kas 1001 = 21,25jt/13,8jt/7,45jt, test B1 lolos)
- [x] Tab Electron via IPC (2026-09-04: `PembantuTab.tsx` muat `transaksi:list` + builder di renderer + save via `file:save-buffer`)

## Modul 3 — Buku Panjar
- [x] Form: Tanggal Panjar, Penerima, Jumlah, Akun Kas Sumber, Status Open/Closed (2026-09-04: `PanjarTab.tsx` + daftar + filter status)
- [x] Rincian belanja per Baga (`panjar_item`) (2026-09-04: multi-baris + live sisa/kurang)
- [x] Open kurangi Kas (pindah ke Panjar Aktiva); Close jadi Beban + sisa kembali + auto-buat baris BKU (2026-09-04: via `panjarCloseToTransaksi`, T5 lolos)

## Modul 4 — Arus Kas & Realisasi Anggaran
- [x] Grouping Pendapatan per jenis + Pengeluaran per Baga + filter tanggal (2026-09-04: `buildRealisasi`, 12+15 baris COA resmi, test B2 lolos)
- [x] Net Total = Total Pendapatan - Total Pengeluaran (2026-09-04: 14jt-11,8jt=2,2jt; PANJAR/1050/2050 eksklusi, test B2 lolos)
- [x] Tab Electron via IPC (2026-09-04: `RealisasiTab.tsx` + `SurplusTab.tsx`, export xlsx via save dialog main)

## Modul 5 — Neraca + Tutup Buku
- [x] Neraca per cut-off: Aktiva (Kas + Panjar OPEN) vs Pasiva (Hutang + 3000 + 3001 + 3002) (2026-09-04: `NeracaTab.tsx` via `neraca:get`, badge BALANCE)
- [x] Badge BALANCE jika selisih 0, tampil selisih jika tidak (2026-09-04: dari `neraca()` ledger, bukan hitung ulang)
- [x] Wizard Tutup Buku manual: auto-backup .db → preview laba → konfirmasi (2026-09-04: `TutupTab.tsx` 3 langkah via `tutup:preview` + `backup:auto` + `tutup:create`)
- [x] Kunci longgar: edit tanggal lama boleh + warning + wajib alasan + audit_log + badge di tabel (2026-09-04: `LockModal` di BKU/Panjar + `guardPeriodeTerkunci` di main, T7 lolos)

## Modul 6 — Surplus / (Defisit)
- [x] Grouping 4xxx - 5xxx per periode bebas + % + format kurung untuk defisit (2026-09-04: `buildSurplus`, T8 kurung lolos, test B3 lolos)
- [x] Cek silang: Surplus Jan s/d cut-off = Berjalan 3002 di Neraca (2026-09-04: 2,2jt == berjalan, balance, test B3 lolos)

## Non-Fungsional
- [x] Dashboard: Saldo Kas Tunai, Total LPD, Status Balance (2026-09-04: `DashboardTab.tsx` via `dashboard:get`; 7,45jt/7,5jt/BALANCE, test B4 lolos)
- [x] Backup Export `.db` / Import `.db` (2026-09-04: tombol di DashboardTab via `backup:export`/`backup:import` dialog + `backup:auto` untuk wizard; logic copy tetap, test B6 lolos)
- [x] Export Excel `.xlsx` + Print/Save PDF (2026-09-04: builder murni `workbooks.ts` di renderer + `file:save-buffer` di main; `export.ts` tinggal facade Node; test B5 lolos)
- [x] Kop organisasi di SEMUA export xlsx + HTML/print/PDF (2026-09-04: `KOP_ORG_NAMA=PURA DALEM PURI PELIATAN` + `kopHtml`/`tulisKopXlsx`/`kopPeriode` di `workbooks.ts`; pembantu/realisasi/surplus/neraca/bku semua ber-kop + periode/cut-off; `neracaToWorkbook` + `bkuToWorkbook/Html` baru; tombol Export xlsx + Simpan PDF di NeracaTab; test `export-kop` 3/3 lolos, 46/46 total)
- [x] Periode kop selalu tampil (2026-09-04: `kopPeriodeEfektif` — filter diutamakan, fallback rentang min/max baris data, terakhir `SEMUA PERIODE`; realisasi/surplus terima `rows` opsional dari tab; test fallback lolos, 47/47 total)
- [x] SQLite single-file lokal offline (2026-09-04: `userData/data/pura.db` WAL di Mac; backup/restore via dialog teruji manual)

## Verifikasi Agent B — INTEGRASI 2026-09-04 (re-key mock ke COA resmi; web-shell dilebur, port tab Electron menyusul)
- [x] B1 Pembantu: filter kas/kategori/PANJAR + total + filter tanggal + mock setara repository
- [x] B2 Realisasi: grouping 12+15, net 2,2jt, eksklusi PANJAR/1050/2050, filter Feb benar
- [x] B3 Surplus: % per baris, defisit kurung, cek silang == berjalan 3002 + balance
- [x] B4 Dashboard-read: kas tunai 1001 + total LPD (`LPD_KODES` coa.ts) + badge dari ledger (tanpa hitung ulang)
- [x] B5 Export: 3 workbook → buffer + file .xlsx; Print/PDF via HTML print
- [x] B6 Backup: `.db` copy round-trip 20 baris via `openDb` file

## Port Electron — SELESAI 2026-09-04 (8 tab, IPC baru, split export)
- [x] Split export: `workbooks.ts` murni renderer-safe + `export.ts` facade Node (writeXlsx/backupDb/restoreDb)
- [x] IPC baru di main: `neraca:get`, `dashboard:get`, `file:save-buffer`, `backup:export`, `backup:auto`, `backup:import`
- [x] Tab Pembantu/Realisasi/Surplus via `transaksi:list` + builder di renderer + save dialog main
- [x] Tab Neraca (`NeracaTab`) + wizard Tutup Buku 3 langkah (`TutupTab`)
- [x] Dashboard final + backup UI (`DashboardTab`); App 8 tab; views mentah `*View.tsx` dihapus
- [x] Verifikasi: `npx tsc --noEmit` bersih + `npx vitest run` 29/29 + `npm run build` OK + smoke buffer 7216B/BALANCE
- [x] Fix preload `.mjs` (2026-09-04: build keluarkan `out/preload/index.mjs` tapi main tunjuk `.js` → `window.api` undefined; kini `preloadPath()` cari kandidat yang ada + guard pesan jelas di `api.ts`)
- [x] Fix preload ESM→CJS (2026-09-04: log Electron `Cannot use import statement outside a module` — sandbox tolak preload `.mjs`; `preload.build.lib.formats=['cjs']` → `index.cjs`; bukti CDP `dashboard:get` → `API-OK aktiva=0 kasTunai=0 badge=BALANCE`)
- [x] Fix nama config (2026-09-04: `electron-vite.config.ts` → `electron.vite.config.ts`; electron-vite hanya baca nama bertitik — sebelumnya config TIDAK pernah dimuat, plugin react/tailwind mati, CSS kosong; kini utilities `.bg-amber-900` dkk. ter-generate, 29/29 + build OK)

## Verifikasi Akurasi (9 test di Mac, tanpa Windows) — 16/16 LOLOS 2026-09-04 (`npx vitest run`, termasuk 5 test validasi input)
- [x] T1 Modal awal balance
- [x] T2 Parkir masuk → Aktiva & Berjalan naik
- [x] T3 Upakara keluar → Aktiva & Berjalan turun
- [x] T4 Panjar Open → Kas turun, Aktiva tetap
- [x] T5 Panjar Close → Beban + sisa kembali (termasuk kasus kurang, tanpa baris kurang terpisah)
- [x] T6 Neraca mid-year & akhir tahun balance
- [x] T7 Setelah tutup + edit lama beralasan tetap balance + tercatat di audit_log
- [x] T8 Format negatif `(Rp ...)`
- [x] T9 Piutang 1050 pinjam & lunas → Aktiva tetap, tetap balance, surplus tak terpengaruh

## Modul 7 — Inventaris Aset (non-keuangan, terpisah dari BKU/Neraca)
- [x] Tabel `aset` + repo CRUD + validasi nilai opsional (2026-09-07: `tests/aset.test.ts` CRUD/filter/kode-unik lolos)
- [x] IPC `aset:list/create/update/delete` + tab `AsetTab` + export xlsx/PDF ber-kop (2026-09-07: `npx vitest run` 61/61, `tsc` bersih, `npm run build` OK)
- [x] Isolasi Neraca: aset (termasuk nilai raksasa/null) tidak ubah Aktiva=Pasiva (2026-09-07: test isolasi balance lolos)

## Deferred — Build Windows (nanti saja)
- [ ] GitHub Actions windows-latest → `.exe` NSIS + portable
- [ ] Smoke test di laptop pinjaman (install, input, export, backup/restore)

## Cara update file ini (untuk AI agent)
1. Saat mulai fitur: tidak perlu ubah.
2. Saat selesai + test lolos: `- [ ]` → `- [x] Nama (YYYY-MM-DD: 1 kalimat hasil test)`.
3. Jangan centang tanpa bukti test/log.
