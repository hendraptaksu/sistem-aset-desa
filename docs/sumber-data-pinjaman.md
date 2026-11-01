# Sumber Data Pinjaman LPD — DB-16b

**Status:** berlaku sejak skema v20 (2026-11-01).
**Prinsip:** jadwal adalah rencana; jurnal adalah realisasi. Tidak ada saldo
berjalan atau nominal pembayaran ganda yang disimpan.

## Peran tabel

| Tabel | Menyimpan | Tidak menyimpan |
|---|---|---|
| `pinjaman` | kreditur, akun kas, akun bunga, pokok awal, sisa pokok awal, tanggal mulai, tenor, link `jurnal_pencairan_id`, catatan | saldo berjalan, total pembayaran |
| `pinjaman_angsuran` | rencana `ke`, `jatuh_tempo`, `pokok`, `bunga`, catatan | realisasi, status lunas tersimpan |
| `pinjaman_bayar` | link `pinjaman_id` + `angsuran_id` + `jurnal_id`, tanggal, catatan | nominal pokok/bunga/denda, kas keluar, saldo |

`jurnal_pencairan_id = NULL` berarti pinjaman sudah berjalan. Sisa pokok harus
sudah ada sebagai kredit 2050 di Saldo Awal; modul tidak membuat jurnal
pencairan baru.

## Angka turunan (dihitung saat membaca)

| Angka | Rumus |
|---|---|
| Outstanding pokok | `sisa_pokok_awal - SUM(debit 2050 pada jurnal pinjaman_bayar)` |
| Total pokok dibayar | `SUM(debit 2050 pada jurnal tertaut)` |
| Total bunga dibayar | `SUM(debit akun_bunga pada jurnal tertaut)` |
| Total denda dibayar | `SUM(debit BEBAN lain pada jurnal tertaut)` |
| Kas keluar | `SUM(kredit akun is_kas pada jurnal tertaut)` |
| Status angsuran | `LUNAS` bila `pinjaman_bayar.angsuran_id` menunjuk baris itu |

Tidak ada kolom `sisa_pokok`, `saldo_berjalan`, atau nominal pembayaran di
`pinjaman_bayar`. Sumber angka laporan tetap `jurnal` + `jurnal_baris`.

## Arah jurnal

| Kejadian | Jurnal |
|---|---|
| Pencairan baru | D kas/bank / K 2050 (dibuat pemanggil DB-16c, bukan repository DB-16b) |
| Bayar angsuran | D 2050 (pokok) + D akun bunga (bunga) + D beban denda bila ada / K kas/bank |
| Pinjaman sudah berjalan | tidak ada jurnal pencairan; sisa pokok di Saldo Awal 2050 |

Pembayaran wajib memakai jurnal yang sudah ada, seimbang, memuat debit 2050,
dan kredit kas/bank. Satu angsuran dan satu jurnal hanya boleh ditautkan sekali
(unique index + validasi repository).

## Validasi input pinjaman

- Kreditur tidak kosong.
- Akun kas aktif, bertipe AKTIVA, dan `is_kas = 1`.
- Akun bunga aktif bertipe BEBAN; default `5063 BEBAN BUNGA PINJAMAN`.
- Pokok awal > 0; sisa pokok awal 0..pokok awal.
- Tanggal mulai dan semua jatuh tempo valid `YYYY-MM-DD`; jatuh tempo tidak
  mundur.
- `ke` bilangan bulat > 0, unik, dan naik.
- Pokok/bunga jadwal bilangan bulat ≥ 0.
- Minimal satu baris jadwal dan total pokok jadwal = sisa pokok awal.
- Tenor (bila diisi) bilangan bulat > 0.
- Jurnal pencairan (bila diisi) ada dan seimbang.

## Rekonsiliasi 2050 vs jadwal (DB-16f)

Helper baca-saja `src/core/pinjamanRekonsiliasi.ts` (murni) + adapter
`src/db/pinjamanRekonsiliasi.ts` membandingkan dua outstanding per pinjaman.
Tidak ada koreksi otomatis, tidak ada jurnal baru, dan tidak ada kolom saldo
yang disimpan.

| Angka | Rumus |
|---|---|
| `gl` pinjaman pencairan | kredit neto 2050 pada jurnal pencairan tertaut − debit neto 2050 pada seluruh jurnal pembayaran yang ditautkan `pinjaman_bayar` |
| `gl` pinjaman berjalan | `sisa_pokok_awal` (sudah ada di Saldo Awal 2050) − debit neto 2050 pada jurnal pembayaran tertaut |
| `jadwal` | `sisa_pokok_awal` − jumlah **pokok aktual** dari jurnal pembayaran tertaut |
| `selisih` | `gl − jadwal`; `cocok` hanya bila tepat 0 |

**Pokok aktual** diambil dari debit neto 2050 pada jurnal pembayaran. Bila
jurnal itu tidak memuat 2050 (mis. pokok salah akun), pokok aktual dihitung
dari sisa debit setelah bunga dan denda. Dengan begitu pembayaran yang salah
akun membuat `jadwal` turun sementara `gl` tetap, sehingga selisihnya terlihat.

Batas penting:

- Perbandingan hanya memakai jurnal yang tertaut ke pinjaman ini (jurnal
  pencairan + `pinjaman_bayar`). Saldo total akun 2050 **tidak** dipakai karena
  akun itu juga menampung **2050 non-LPD** (utang lain).
- Debit/kredit 2050 yang tidak tertaut — termasuk pembayaran yang lupa
  ditautkan — tidak bisa diatribusikan ke pinjaman dan tidak masuk hitungan.
  Link yang hilang tidak terdeteksi oleh rekonsiliasi per pinjaman ini.
- Hasil hanya dibaca: `gl`, `jadwal`, `selisih`, `cocok`, dan `pesan`. Audit
  integritas menambahkan temuan `REKONSILIASI_PINJAMAN_SELISIH` hanya untuk
  pinjaman dengan `selisih != 0`; pinjaman bersih tidak menghasilkan temuan.
  Pesan meminta operator memeriksa jurnal/Saldo Awal, bukan menulis angka
  koreksi otomatis.
