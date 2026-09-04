# PROMPT AGENT B — Jalur Baca (Pembantu + Realisasi + Surplus + Export)

Copy-paste seluruh isi file ini ke Agent B (Cursor / Claude Code / Windsurf). Bisa jalan PARALEL dengan Agent A.

---

## 1. Konteks wajib dibaca dulu
1. Baca `PRD.md` (full), `PROGRESS.md` (full), dan `KODE AKUN.csv` (COA resmi — lebih benar dari PRD §2).
2. Stack dikunci: Electron + Vite + React + TS + Tailwind/shadcn + better-sqlite3 + drizzle. Dev di Mac, JANGAN build Windows.
3. Kamu READ-ONLY terhadap skema. OWNER skema = Agent A. Kamu DILARANG edit `src/db/schema.*`, migrasi, seed.

## 2. Kontrak data (sama persis dengan Agent A, jangan diubah)
```ts
type Transaksi = { id:string; tanggal:string /*YYYY-MM-DD*/; keterangan:string; akun_kas:string; kategori:string; masuk:number; keluar:number };
type Panjar = { id:string; tanggal:string; penerima:string; jumlah:number; akun_kas_sumber:string; status:'OPEN'|'CLOSED' };
```
**Update kontrak 2026-09-04 (sudah diimplementasi Agent A, tinggal pakai):**
- Sumber kebenaran = `src/core/types.ts`, `src/db/coa.ts`, `src/core/ledger.ts`, `src/db/repository.ts`. Import langsung, jangan definisi ulang.
- Ada kategori sistem `PANJAR` (export `PANJAR_KATEGORI` dari `ledger.ts`) untuk mutasi panjar: menggerakkan Kas tapi EKSKLUSI dari Pendapatan/Beban (fungsi `totalPendapatan`/`totalBeban`/`surplus` sudah mengabaikannya). Di laporan tampilkan sebagai baris "Mutasi Panjar" atau abaikan — jangan masukkan ke total Beban.
- Helper `formatRp` sudah ada di `src/utils/format.ts` — pakai itu.
- Fungsi siap pakai: `saldoKas`, `saldoSemuaKas`, `totalPerKategori`, `totalPendapatan`, `totalBeban`, `surplus`, `neraca`, `labaTahun`.
Jika `src/db/schema.*` belum ada (Agent A belum selesai), JANGAN menunggu: buat `src/features/reports/__mocks__/data.ts` dengan 20 baris dummy mengikuti tipe di atas + COA dari `KODE AKUN.csv` (bukan PRD), kerjakan UI + query di atas mock lewat interface `getTransaksi(filter)`. Saat schema asli ada, tinggal ganti import — logika tidak berubah.

## 3. Yang kamu kerjakan (OWN: file-file ini saja)
- `src/utils/format.ts` — `formatRp(n)`: `Rp 1.500.000`, negatif `(Rp 100.000)`. Jika file sudah ada milik Agent A, pakai itu, jangan duplikat.
- `src/features/reports/pembantu/*` — filter per kode (kas dari `KAS_KODES` atau kategori apa pun incl. 1050/2050) + Total Masuk/Keluar/Saldo. JANGAN hardcode rentang — kode tidak berurutan (tidak ada 4006).
- `src/features/reports/realisasi/*` — grouping Pendapatan per jenis (`PENDAPATAN_KODES`) + Beban per Baga (`BEBAN_KODES`) + filter tanggal + Net = Pendapatan - Beban. 1050/2050/3000/PANJAR TIDAK masuk sini.
- Piutang tampil TERPISAH (bukan beban/pendapatan): pakai `totalPiutang()` dari `ledger.ts`.
- `src/features/dashboard/*` (read saja) — Saldo Kas Tunai (1001), Total LPD (`LPD_KODES` dari coa.ts), Piutang 1050 terpisah, badge Balance (baca dari query, jangan hitung ulang dengan cara beda)
- `src/features/export/*` — Export `.xlsx` (exceljs) + Print/PDF untuk 3 laporan di atas + Backup Export/Import `.db` (copy file)
- JANGAN sentuh: `src/features/bku/*`, `src/features/panjar/*`, Neraca final + Tutup Buku wizard.

## 4. Rumus yang harus dipegang (harus sama dengan Agent A)
- Semua laporan filter `tanggal` (mulai–selesai atau <= cut-off). Jangan sertakan 1050/2050/3000/PANJAR di Surplus (hanya tipe PENDAPATAN/BEBAN via helper, bukan rentang kode).
- Cek silang yang harus lolos: Surplus Jan-01 s/d cut-off == Berjalan 3002 di Neraca (Neraca dikerjakan tahap gabung, tapi rumusnya siapkan).
- Rupiah selalu lewat `formatRp`.

## 5. Definisi selesai (wajib)
- `npm run dev` jalan dengan mock maupun DB asli, 3 laporan tampil + filter tanggal benar + export xlsx/pdf keluar file.
- Test lolos (pakai mock dulu boleh): T6-parsial (grouping benar), T8 (format kurung), plus screenshot/log export berhasil.
- Update `PROGRESS.md`: centang Modul 2, 4, 6 + Non-Fungsional (Dashboard-read, Backup, Export) yang selesai. JANGAN centang milik Agent A (Modul 1, 3).

## 6. Larangan
- Jangan edit schema/migrasi/seed. Butuh kolom baru? Tulis di `NEEDS_SCHEMA.md` (1 baris: tabel, kolom, alasan), jangan langsung edit.
- Jangan kerjakan Neraca/Tutup/Windows build.
