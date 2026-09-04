# PROMPT AGENT A — Jalur Tulis (BKU + Panjar + Schema Owner)

Copy-paste seluruh isi file ini ke Agent A (Cursor / Claude Code / Windsurf).

---

## 1. Konteks wajib dibaca dulu
1. Baca `PRD.md` (full), `PROGRESS.md` (full), dan `KODE AKUN.csv` (COA resmi — lebih benar dari PRD §2).
2. Stack dikunci: Electron + Vite + React + TS + Tailwind/shadcn + better-sqlite3 + drizzle. Dev di Mac, JANGAN build Windows.
3. Kamu adalah OWNER skema. Agent B hanya read — kamu satu-satunya yang boleh edit schema/migrasi.

## 2. Kontrak data — SUMBER KEBENARAN = `KODE AKUN.csv` + `src/db/coa.ts` + `src/core/types.ts` (JANGAN pakai COA PRD §2, sudah terbukti salah)
```ts
// Akun Kas (dompet): 1001,1010,1014,1015,1016,1017,1018,1019,1020,1021,1028,1029,1030,1031,1032,1036
// Kategori: PENDAPATAN (12 kode, tidak berurutan — cth. tanpa 4006) | BEBAN (15 kode) | 1050 PIUTANG | 2050 HUTANG | 3000 MODAL
// JANGAN asumsikan rentang kode — selalu cek `tipe` via coa.ts (isKas/isBeban/isPendapatan/isPiutang).
// 1050 PIUTANG hanya di sisi kategori: keluar = pinjaman diberikan, masuk = pelunasan. BUKAN dompet.
type Transaksi = { id:string; tanggal:string /*YYYY-MM-DD*/; keterangan:string; akun_kas:string; kategori:string; masuk:number; keluar:number /*integer rupiah, salah satu 0*/ };
type Panjar = { id:string; tanggal:string; penerima:string; jumlah:number; akun_kas_sumber:string; status:'OPEN'|'CLOSED' };
type PanjarItem = { panjar_id:string; kategori_baga:string /*kode BEBAN, lihat BEBAN_KODES*/; nominal:number };
type TutupBuku = { tahun:number; laba:number; created_at:string; backup_path:string };
type AuditLog = { id:string; tanggal:string; aksi:string; alasan:string; data_lama_json:string };
```
Aturan: simpan rupiah integer. Negatif tampil `(Rp 100.000)`, bukan `-Rp`.

## 3. Yang kamu kerjakan (OWN: file-file ini saja)
- `src/db/schema.*`, `src/db/migrations/*`, `src/db/seed-coa.ts` (seed persis `KODE AKUN.csv`, BUKAN PRD §2)
- `src/features/bku/*` — Form (Tanggal, Keterangan, Akun Kas dropdown, Kategori dropdown, Masuk/Keluar, Nominal) + tabel + pagination + search + filter tanggal + saldo per kas auto-update
- `src/features/panjar/*` — Form + rincian per Baga + OPEN kurangi Kas (pindah ke Panjar Aktiva, total harta tetap) + CLOSE jadi Beban + sisa kembali ke Kas + auto-buat baris BKU
- Kunci longgar: jika `tanggal < 01-01-(tahun tutup terakhir+1)` → tampilkan warning kuning + wajib isi alasan → simpan ke `audit_log` + badge di tabel. Tetap boleh simpan.
- JANGAN sentuh: `src/features/reports/*`, `src/features/export/*`, Neraca final, Tutup Buku wizard (itu Agent lain / tahap gabung).

## 4. Rumus yang harus dipegang
- Saldo kas per dompet = SUM(masuk)-SUM(keluar) filter akun_kas s/d cut-off.
- Panjar OPEN ikut Aktiva (Kas turun, Panjar naik, total tetap). Panjar CLOSE habis jadi Beban.
- Semua query saring `tanggal <= cut-off`.

## 5. Definisi selesai (wajib)
- `npm run dev` jalan di Mac, CRUD BKU + Panjar bisa dipakai.
- Test lolos: T1 (modal balance), T2 (parkir masuk), T3 (upakara keluar), T4 (panjar open aktiva tetap), T5 (panjar close), T7 (edit tahun lama + alasan masuk audit_log).
- Update `PROGRESS.md`: centang Modul 1 + Modul 3 yang selesai dengan format `- [x] ... (YYYY-MM-DD: bukti test)`. JANGAN centang milik Agent B.

## 6. Larangan
- Jangan edit file milik Agent B. Jangan ubah kontrak tipe tanpa tulis diydeskripsi commit. Jangan kerjakan Neraca/Tutup/Windows build.
