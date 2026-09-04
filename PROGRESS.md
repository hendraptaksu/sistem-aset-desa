# Progress — Sistem Pembukuan Pura Dalem Puri

> Sumber: `PRD.md` + keputusan diskusi. Update file ini tiap selesai 1 fitur: ubah `- [ ]` jadi `- [x]` + isi tanggal & catatan.
> Format: `- [x] Fitur (2026-09-04: catatan)`

Terakhir update: 2026-09-04 — core Agent A selesai + 9/9 test lolos. **Agent B SUDAH BOLEH JALAN** (kontrak freeze di `src/core/*`, `src/db/*`; lihat AGENT_B_PROMPT.md §2).

## Keputusan yang sudah dikunci
- [x] Framework: Electron + Vite + React + TS + Tailwind/shadcn + better-sqlite3 + drizzle (2026-09-04: dev di Mac, build Windows nanti via CI)
- [x] BKU pakai 2 dropdown: Akun Kas [1000-1029] + Kategori [4001-5007/2050] (2026-09-04: agar Neraca bisa BALANCE)
- [x] Tutup buku: hitungan auto + kunci manual longgar (2026-09-04: bisa edit tahun lalu + wajib alasan + audit_log)
- [x] Modul 6 baru: Surplus / (Defisit) = Laba-Rugi versi Pura (2026-09-04: disetujui)
- [x] Format tracking: 1 file ini (2026-09-04)

## Phase 0 — Setup & Core (fokus akurasi di Mac)
- [x] Scaffold npm + SQLite konek di Mac (2026-09-04: better-sqlite3 WAL, `npm test` → vitest; UI Electron menyusul)
- [x] Seed COA sesuai PRD (2026-09-04: `src/db/coa.ts`, 9 kas + 2050 + 3000-3002 + 8 pendapatan + 6 baga)
- [x] Skema tabel (2026-09-04: `src/db/database.ts` + `src/db/repository.ts`; kontrak freeze di `src/core/types.ts`)
- [x] Helper Rupiah (2026-09-04: `src/utils/format.ts`, T8 lolos)

## Modul 1 — Buku Kas Umum (BKU)
- [ ] Form: Tanggal, Keterangan, Akun Kas, Kategori, Masuk/Keluar, Nominal
- [ ] Tabel + pagination + pencarian + filter rentang tanggal
- [ ] Saldo per kas auto-update

## Modul 2 — Buku Pembantu
- [x] Filter otomatis per kode rekening dari BKU (2026-09-04: `buildPembantu` kas/kategori/PANJAR, test B1 lolos)
- [x] Total Masuk / Keluar / Saldo Akhir per sub-ledger (2026-09-04: kas 1000 = 21,25jt/13,8jt/7,45jt, test B1 lolos)

## Modul 3 — Buku Panjar
- [ ] Form: Tanggal Panjar, Penerima, Jumlah, Akun Kas Sumber, Status Open/Closed
- [ ] Rincian belanja per Baga (`panjar_item`)
- [ ] Open kurangi Kas (pindah ke Panjar Aktiva); Close jadi Beban + sisa kembali + auto-buat baris BKU

## Modul 4 — Arus Kas & Realisasi Anggaran
- [x] Grouping Pendapatan per jenis + Pengeluaran per Baga + filter tanggal (2026-09-04: `buildRealisasi`, 8+6 baris, test B2 lolos)
- [x] Net Total = Total Pendapatan - Total Pengeluaran (2026-09-04: 14jt-11,8jt=2,2jt; PANJAR/2050 eksklusi, test B2 lolos)

## Modul 5 — Neraca + Tutup Buku
- [ ] Neraca per cut-off: Aktiva (Kas + Panjar OPEN) vs Pasiva (Hutang + 3000 + 3001 + 3002)
- [ ] Badge BALANCE jika selisih 0, tampil selisih jika tidak
- [ ] Wizard Tutup Buku manual: auto-backup .db → preview laba → konfirmasi
- [ ] Kunci longgar: edit tanggal lama boleh + warning + wajib alasan + audit_log + badge di tabel

## Modul 6 — Surplus / (Defisit)
- [x] Grouping 4xxx - 5xxx per periode bebas + % + format kurung untuk defisit (2026-09-04: `buildSurplus`, T8 kurung lolos, test B3 lolos)
- [x] Cek silang: Surplus Jan s/d cut-off = Berjalan 3002 di Neraca (2026-09-04: 2,2jt == berjalan, balance, test B3 lolos)

## Non-Fungsional
- [x] Dashboard: Saldo Kas Tunai, Total LPD, Status Balance (2026-09-04: `buildDashboard` read dari ledger; 7,45jt/7,5jt/BALANCE, test B4 lolos)
- [x] Backup Export `.db` / Import `.db` (2026-09-04: `backupDb`/`restoreDb` copy file, 20 baris round-trip, test B6 lolos)
- [x] Export Excel `.xlsx` + Print/Save PDF (2026-09-04: exceljs 3 workbook + HTML print, file keluar, test B5 lolos)
- [ ] SQLite single-file lokal offline

## Verifikasi Agent B (2026-09-04: `npx vitest run` → 22/22 LOLOS = 9 inti + 13 baru di `tests/reports.test.ts`)
- [x] B1 Pembantu: filter kas/kategori/PANJAR + total + filter tanggal + mock setara repository
- [x] B2 Realisasi: grouping 8+6, net 2,2jt, eksklusi PANJAR/2050, filter Feb benar
- [x] B3 Surplus: % per baris, defisit kurung, cek silang == berjalan 3002 + balance
- [x] B4 Dashboard-read: kas tunai + total LPD + badge dari ledger (tanpa hitung ulang)
- [x] B5 Export: 3 workbook → buffer + file .xlsx; Print/PDF via HTML `window.print`
- [x] B6 Backup: `.db` copy round-trip 20 baris via `openDb` file
- [x] `npm run dev` (Vite React, mock 20 baris): 4 tab tampil + filter tanggal + export xlsx/print per laporan

## Verifikasi Akurasi (8 test di Mac, tanpa Windows) — 9/9 LOLOS 2026-09-04 (`npx vitest run`)
- [x] T1 Modal awal balance
- [x] T2 Parkir masuk → Aktiva & Berjalan naik
- [x] T3 Upakara keluar → Aktiva & Berjalan turun
- [x] T4 Panjar Open → Kas turun, Aktiva tetap
- [x] T5 Panjar Close → Beban + sisa kembali (termasuk kasus kurang, tanpa baris kurang terpisah)
- [x] T6 Neraca mid-year & akhir tahun balance
- [x] T7 Setelah tutup + edit lama beralasan tetap balance + tercatat di audit_log
- [x] T8 Format negatif `(Rp ...)`

## Deferred — Build Windows (nanti saja)
- [ ] GitHub Actions windows-latest → `.exe` NSIS + portable
- [ ] Smoke test di laptop pinjaman (install, input, export, backup/restore)

## Cara update file ini (untuk AI agent)
1. Saat mulai fitur: tidak perlu ubah.
2. Saat selesai + test lolos: `- [ ]` → `- [x] Nama (YYYY-MM-DD: 1 kalimat hasil test)`.
3. Jangan centang tanpa bukti test/log.
