# Spec: Satuan Sen + Format Indonesia (DD-MM-YYYY, Rp 2 Desimal)

Tanggal: 2026-09-04 · Status: disetujui user · Tahap: development (data boleh rusak)

## 1. Latar & Keputusan

- Penyimpanan nominal pindah dari rupiah-integer ke **sen-integer** (×100).
- Tanpa data produksi existing → **tanpa kode migrasi**; DB lama dihapus manual.
- Input desimal **opsional**: bilangan bulat auto-convert ke sen; koma hanya bila butuh pecahan.
- Matematika `src/core/ledger.ts` agnostik satuan → tidak berubah.

## 2. Satuan & Kontrak

- Kolom terdampak (semua tetap `INTEGER`, tetap invariant "salah satu masuk/keluar = 0"):
  `transaksi.masuk`, `transaksi.keluar`, `panjar.jumlah`, `panjar_item.nominal`, `tutup_buku.laba`.
- `src/core/types.ts`: komentar kontrak diubah menjadi "Nominal disimpan sebagai integer dalam satuan SEN (1 Rp = 100 sen)".
- `Number.isInteger` di validasi tetap berlaku (sen selalu bulat).

## 3. Parsing Input (Gaya Indonesia)

- Helper baru `parseRupiahToSen(s: string): number` (lokasi: `src/utils/format.ts`):
  - `"1500"` → `150000`; `"1.500"` → `150000`; `"1500,50"` → `150050`; `"1.500,50"` → `150050`.
  - Titik = pemisah ribuan (opsional, posisi ribuan tidak divalidasi ketat); koma = desimal, maks 2 digit.
  - Invalid (huruf, >2 digit desimal, negatif, hanya-titik seperti `'.'`/`'..'`) → throw `Error` pesan Indonesia. Pengecualian: `''` → `0` (untuk clearing input).
- Form BKU/Panjar: field nominal bertipe teks; saat submit, parse ke sen lalu kirim integer via IPC seperti sekarang.
- Validasi `validateTransaksiInput` / `validatePanjarItems` menerima sen; pesan error diperbarui ("Uang masuk harus bilangan bulat ≥ 0." tetap, tanpa kata rupiah-pecahan).

## 4. Tampilan

- `formatRp(sen: number): string` → `"Rp 1.500,50"`; negatif tetap kurung: `"(Rp 100.000,00)"`; nol → `"Rp 0,00"`.
  Implementasi: `Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })`.
- Helper baru `formatTanggal(iso: string): string`: `"2026-01-05"` → `"05-01-2026"`. Input invalid → kembalikan string asal.
- Diterapkan di: semua tabel tab (BKU/Panjar/Pembantu/Realisasi/Surplus/Neraca/Dashboard/Tutup), builder HTML (`workbooks.ts`), dan export xlsx.
- Penyimpanan (`YYYY-MM-DD`), input date native, sorting, dan perbandingan periode tetap ISO.

## 5. Tanpa Migrasi (Keputusan Eksplisit)

- Tidak ada `PRAGMA user_version`, tidak ada `UPDATE ×100`.
- Prosedur: hapus file `.db` lama → restart dev → `PURA_SEED_DEV` mengisi ulang bila aktif.
- `audit_log.data_lama_json` tidak relevan (DB fresh, tanpa migrasi).

## 6. Fixtures & Seed

- `src/features/reports/__mocks__/data.ts`: semua nominal ×100.
- `src/db/seed-dev.ts`: nominal ×100 (tetap kelipatan rapi dalam sen); determinisme mulberry32 dipertahankan; tanggal tak berubah.
- Ekspektasi test yang menyebut `formatRp` diperbarui ke 2 desimal; ekspektasi nominal ×100.

## 7. Testing

- Baru: parsing (`"1.500,50"`, `"1500"`, invalid: `"1,234"` 3 digit, `"abc"`, `""`, `"-5"`), `formatRp` 2 desimal + kurung negatif, `formatTanggal` + input invalid.
- Diperbarui: `tests/accuracy.test.ts`, `tests/reports.test.ts`, `tests/ipc-validation.test.ts`, `tests/seed-dev.test.ts`.
- Kriteria selesai: `npm test` hijau, `tsc --noEmit` bersih, `electron-vite build` sukses.

## 8. Non-tujuan

- Tidak ada perubahan skema tabel/kolom (hanya makna satuan).
- Tidak ada perubahan logika ledger, kunci periode, audit, backup/restore, IPC channel.
- Tidak ada pemformatan input live (masking saat mengetik) — di luar scope.
