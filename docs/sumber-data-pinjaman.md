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
