# Progress — Sistem Pembukuan Pura Dalem Puri

> Sumber: `PRD.md` + keputusan diskusi. Update file ini tiap selesai 1 fitur: ubah `- [ ]` jadi `- [x]` + isi tanggal & catatan.
> Format: `- [x] Fitur (2026-09-04: catatan)`

Terakhir update: 2026-09-04 — Agent A SELESAI: UI BKU + Panjar + shell Electron jalan (`npm run dev`/`build`, smoke 12 dtk OK, 14/14 test). **Agent B SUDAH BOLEH JALAN** (kontrak freeze di `src/core/*`, `src/db/*`; lihat AGENT_B_PROMPT.md §2).

## Keputusan yang sudah dikunci
- [x] Framework: Electron + Vite + React + TS + Tailwind/shadcn + better-sqlite3 + drizzle (2026-09-04: dev di Mac, build Windows nanti via CI)
- [x] BKU pakai 2 dropdown: Akun Kas [1000-1029] + Kategori [4001-5007/2050] (2026-09-04: agar Neraca bisa BALANCE)
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
- [ ] Filter otomatis per kode rekening dari BKU
- [ ] Total Masuk / Keluar / Saldo Akhir per sub-ledger

## Modul 3 — Buku Panjar
- [x] Form: Tanggal Panjar, Penerima, Jumlah, Akun Kas Sumber, Status Open/Closed (2026-09-04: `PanjarTab.tsx` + daftar + filter status)
- [x] Rincian belanja per Baga (`panjar_item`) (2026-09-04: multi-baris + live sisa/kurang)
- [x] Open kurangi Kas (pindah ke Panjar Aktiva); Close jadi Beban + sisa kembali + auto-buat baris BKU (2026-09-04: via `panjarCloseToTransaksi`, T5 lolos)

## Modul 4 — Arus Kas & Realisasi Anggaran
- [ ] Grouping Pendapatan per jenis + Pengeluaran per Baga + filter tanggal
- [ ] Net Total = Total Pendapatan - Total Pengeluaran

## Modul 5 — Neraca + Tutup Buku
- [ ] Neraca per cut-off: Aktiva (Kas + Panjar OPEN) vs Pasiva (Hutang + 3000 + 3001 + 3002)
- [ ] Badge BALANCE jika selisih 0, tampil selisih jika tidak
- [ ] Wizard Tutup Buku manual: auto-backup .db → preview laba → konfirmasi
- [ ] Kunci longgar: edit tanggal lama boleh + warning + wajib alasan + audit_log + badge di tabel

## Modul 6 — Surplus / (Defisit)
- [ ] Grouping 4xxx - 5xxx per periode bebas + % + format kurung untuk defisit
- [ ] Cek silang: Surplus Jan s/d cut-off = Berjalan 3002 di Neraca

## Non-Fungsional
- [ ] Dashboard: Saldo Kas Tunai, Total LPD, Status Balance
- [ ] Backup Export `.db` / Import `.db`
- [ ] Export Excel `.xlsx` + Print/Save PDF
- [ ] SQLite single-file lokal offline

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

## Deferred — Build Windows (nanti saja)
- [ ] GitHub Actions windows-latest → `.exe` NSIS + portable
- [ ] Smoke test di laptop pinjaman (install, input, export, backup/restore)

## Cara update file ini (untuk AI agent)
1. Saat mulai fitur: tidak perlu ubah.
2. Saat selesai + test lolos: `- [ ]` → `- [x] Nama (YYYY-MM-DD: 1 kalimat hasil test)`.
3. Jangan centang tanpa bukti test/log.
