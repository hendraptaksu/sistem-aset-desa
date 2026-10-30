# Sumber COA — keputusan DB-13a, DB-13, DB-13b, dan DB-14

**Tanggal keputusan:** 2026-10-30 (DB-13a); lima akun baru disetujui dan
ditambahkan pada DB-13, 2026-10-30; 5063 BEBAN BUNGA PINJAMAN ditambahkan pada
DB-13b, 2026-10-30; metadata akun + akun bank/LPD baru ditambahkan pada DB-14,
2026-10-30.
**Status:** berlaku untuk DB-13, DB-13b, DB-14, dan seterusnya.

## Keputusan

Ada **satu sumber mesin** untuk daftar akun:

> **`KODE AKUN.csv`** — baris data client (kolom `NO`, `NAMA AKUN`,
> `KODE AKUN`) yang dinormalisasi menjadi pasangan `kode` + `nama`.

`src/db/coa.ts` adalah turunan mesin dari CSV tersebut dan wajib memenuhi:

```text
COA = seluruh baris KODE AKUN.csv + tepat ekstensi sistem (KODE_EKSTENSI_SISTEM)
```

Ekstensi sistem saat ini **hanya dua**:

| Kode | Nama | Alasan |
|---|---|---|
| 1040 | UANG PANJAR (KAS DI MUKA) | Kebutuhan double-entry panjar (2026-10-04) |
| 2060 | HUTANG USAHA | Memisahkan utang usaha dari pinjaman 2050 (AKT-20) |

Jadi untuk kondisi sekarang:

```text
48 akun baseline client + 6 akun tambahan (DB-13/DB-13b) + 2 ekstensi sistem = 56 akun COA
```

`KODE AKUN.csv` berisi **54 baris data**: 48 baris baseline client + lima akun
DB-13 + 5063 DB-13b. `docs/KODE AKUN.xlsx` tetap **48 akun baseline** dan tidak
menerima akun baru.

## Peran setiap file

| File | Peran | Boleh diubah? |
|---|---|---|
| `KODE AKUN.csv` | **Sumber mesin** daftar kode/nama akun client | Ya, lewat ticket yang disetujui; akun baru **ditambahkan di belakang** agar 48 baris baseline tetap utuh |
| `docs/KODE AKUN.xlsx` | **Arsip client** 48 akun baseline | **Tidak** tanpa persetujuan client. Bukan sumber mesin dan tidak menerima akun baru. |
| `src/db/coa.ts` | Daftar COA statis + tipe/posisi normal + ekstensi sistem | Hanya agar tetap sama dengan CSV + ekstensi; bukan sumber kode/nama yang independen |
| `tests/coa.test.ts` | Penjaga drift CSV ↔ xlsx ↔ COA | Diperbarui hanya saat baseline/ekstensi berubah secara sadar |

File xlsx **tidak dibaca aplikasi saat runtime**; file itu hanya arsip untuk
pemeriksaan manusia dan pembanding test. CSV juga tidak dibaca runtime — COA
statis di `src/db/coa.ts` yang dipakai aplikasi, dan test memastikan keduanya
identik.

## Baseline 48 akun dan enam akun tambahan

- `docs/KODE AKUN.xlsx` memuat **48 akun baseline** dan **tidak boleh diubah**.
  Isinya identik dengan 48 baris pertama `KODE AKUN.csv`.
- Lima akun yang disetujui 2026-10-30 — **5060, 5061, 5062, 4060, 4006** —
  ditambahkan pada DB-13 ke `KODE AKUN.csv` (baris 49–53) dan `src/db/coa.ts`,
  **bukan** ke xlsx.
- DB-13b menambahkan **5063 BEBAN BUNGA PINJAMAN** ke `KODE AKUN.csv` (baris
  54) dan `src/db/coa.ts`, juga **bukan** ke xlsx. Akun ini adalah akun bunga
  pinjaman LPD dan menjadi **default akun bunga untuk modul pinjaman LPD**
  (DB-16) saat form pinjaman dibuat.
- Enam akun di atas adalah **tambahan, bukan pengganti** akun lama. Akun lama
  `5010`, `5050`, `5004`, `4008`, `4041`, dan `4005` **tetap ada dan tetap
  aktif**. Namanya sengaja diberi pembeda agar operator tidak salah pilih.
- **5050 BIAYA LAIN-LAIN tidak diganti dan tidak dinonaktifkan** oleh 5063.
  5050 tetap dipakai untuk biaya lain-lain dan denda; 5063 khusus bunga
  pinjaman agar terlihat terpisah di Laba Rugi.
- Karena akun baru selalu ditambahkan di belakang CSV, xlsx tetap arsip 48 akun
  dan persamaan `COA = CSV + 2 ekstensi` tetap berlaku.

| Kode | Nama di CSV/COA | Tipe | Posisi normal | Pembeda dari akun lama |
|---|---|---|---|---|
| 5060 | PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL) | BEBAN | DEBIT | 5010 BAGA SUAR (TELPON, LISTRIK, PDAM) tetap ada |
| 5061 | PENGELUARAN ARTOS (UPACARA) | BEBAN | DEBIT | 5050 BIAYA LAIN-LAIN tetap ada |
| 5062 | PENGELUARAN BANTEN RUTIN (HARIAN) | BEBAN | DEBIT | 5004 BAGA UPAKARA tetap ada |
| 5063 | BEBAN BUNGA PINJAMAN | BEBAN | DEBIT | 5050 BIAYA LAIN-LAIN tetap ada; default bunga pinjaman LPD (DB-16) |
| 4060 | PENDAPATAN WEWEDALAN (UPACARA) | PENDAPATAN | KREDIT | 4008 PUNIA / 4041 SESARI tetap ada |
| 4006 | PENDAPATAN PARKIR BPD (KHUSUS) | PENDAPATAN | KREDIT | 4005 PENDAPATAN PARKIR tetap ada |

## Metadata akun DB-14 (`is_kas`, `kelompok`, `sumber`)

Sejak skema **v16**, tabel `akun` menyimpan tiga metadata tambahan:

| Kolom | Isi | Catatan |
|---|---|---|
| `is_kas` | `0`/`1` | `1` = dompet kas/bank yang boleh dipakai di Pindah Dana, Panjar, dan pembayaran. |
| `kelompok` | `KAS`, `BANK`, `LPD`, `PANJAR`, `PIUTANG`, `HUTANG`, `EKUITAS`, `PENDAPATAN`, `BEBAN`, atau kosong | Hanya untuk pengelompokan/tampilan; bukan pengganti `tipe`. |
| `sumber` | `BAWAAN` atau `TAMBAHAN` | `BAWAAN` = kode dari CSV/ekstensi sistem; `TAMBAHAN` = dibuat operator dari layar Daftar Akun. |

Backfill v16 memakai pemetaan tetap:

| Akun | `is_kas` | `kelompok` |
|---|---|---|
| `1001 KAS` | 1 | `KAS` |
| Akun LPD (`1010`, `1014`–`1021`, `1030`–`1032`, `1036`) | 1 | `LPD` |
| Dompet lain (`1028`, `1029`) | 1 | `BANK` |
| `1040 UANG PANJAR` | 0 | `PANJAR` |
| `1050 PIUTANG` | 0 | `PIUTANG` |
| `2050`, `2060` | 0 | `HUTANG` |
| `3000`–`3002` | 0 | `EKUITAS` |
| Akun `4xxx` | 0 | `PENDAPATAN` |
| Akun `5xxx` | 0 | `BEBAN` |

Akun di luar COA dianggap `TAMBAHAN`; `is_kas` yang sudah `1` dipertahankan dan
`kelompok` hanya diisi dari `tipe` bila masih kosong. Upsert COA saat `openDb`
hanya memperbarui baris `BAWAAN`, sehingga nama/tipe/aktif/metadata akun
`TAMBAHAN` tidak berubah saat aplikasi dibuka ulang.

### Akun kas/bank/LPD baru

Operator dapat menambah akun kas/bank/LPD dari **Daftar Akun** dengan syarat:

- kode 4 digit di rentang khusus **`1100`–`1199`** (tidak dipakai COA client);
- tipe `AKTIVA`, posisi normal `DEBIT`;
- `is_kas = 1`;
- `kelompok` salah satu dari `KAS`, `BANK`, atau `LPD`;
- `sumber = TAMBAHAN`.

Rentang ini sengaja dicadangkan agar akun baru tidak bentrok dengan CSV. Akun
`BEBAN` (`5xxx`) dan `PENDAPATAN` (`4xxx`) tetap dapat ditambah seperti sebelumnya.
Validasi `is_kas`/`kelompok` yang tidak konsisten ditolak di repository, dan
akun baru langsung muncul di dropdown kas, Panjar, Pindah Dana, serta total kas.

## Penjaga regresi

`tests/coa.test.ts` menegakkan:

1. `KODE AKUN.csv` ada, berisi 54 baris, dan setiap kode+nama cocok persis
   dengan COA.
2. `docs/KODE AKUN.xlsx` ada, bisa dibaca dengan `exceljs`, berisi tepat 48
   akun, sama dengan 48 baris pertama CSV, dan setiap akunnya ada identik di COA.
3. File xlsx tidak berubah: SHA-256 harus
   `c9a3f9f674f57ead20c1747bac25a16939f64acad6ea6aa6a9286fae4faae6b6`.
4. COA tepat sama dengan 54 baris CSV + ekstensi sistem 1040/2060 = 56 akun;
   tidak ada akun liar, dan ekstensi tidak boleh muncul di CSV.
5. Tidak ada kode atau nama duplikat di COA maupun CSV.
6. Lima akun DB-13 dan 5063 DB-13b punya kode, nama, tipe, dan posisi normal
   yang benar; akun lama yang mirip tidak di-rename atau dinonaktifkan.
7. Setelah `openDb`/seed, keenam akun muncul di `listAkun` dan akun lama tetap
   aktif; 5063 juga tampil di form Bayar.
8. Dokumen ini tetap ada dan mencatat keputusan, angka 48/54/56, kode 1040,
   2060, 5060, 5061, 5062, 5063 BEBAN BUNGA PINJAMAN, 4060, 4006, serta hash
   arsip.
9. **DB-14:** migrasi v16 menambah kolom metadata tanpa rebuild; backfill COA
   benar, akun di luar COA menjadi `TAMBAHAN`, dan akun `TAMBAHAN` tetap utuh
   setelah reopen. Akun bank baru `1100`–`1199` muncul di daftar kas dan total
   kas; `is_kas`/`kelompok` yang tidak konsisten ditolak.

## Cara mengubah dengan aman

- **Menambah akun client:** tambahkan baris baru di belakang `KODE AKUN.csv`,
  lalu tambahkan akun yang sama (kode, nama, tipe, posisi normal) ke COA.
  Jangan mengubah xlsx. Test akan memastikan jumlah dan isinya konsisten.
- **Menambah akun kas/bank/LPD operator:** jangan menambah ke CSV/COA. Buat dari
  layar **Daftar Akun** dengan kode `1100`–`1199`; akun tersimpan di DB sebagai
  `TAMBAHAN` dan tidak akan ditimpa upsert COA.
- **Mengubah nama akun baseline:** perlu persetujuan client karena berarti
  mengubah sumber mesin; xlsx lama tetap arsip dan test subset akan menolak
  perbedaan nama. Jangan mengedit xlsx diam-diam.
- **Menerima arsip xlsx baru dari client:** simpan salinan bertanggal, catat
  persetujuannya di ticket, perbarui baseline test + hash di dokumen ini, dan
  pastikan 48 akun lama tetap ada atau perubahan dijelaskan.
- **Menambah ekstensi sistem:** tambahkan kode ke `KODE_EKSTENSI_SISTEM` dan
  `COA`, perbarui test eksplisit 1040/2060, lalu catat alasannya di dokumen ini.
