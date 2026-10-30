# Sumber COA — keputusan DB-13a

**Tanggal keputusan:** 2026-10-30
**Status:** berlaku untuk DB-13, DB-13b, dan seterusnya.

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

Jadi untuk baseline sekarang: **48 baris CSV + 2 ekstensi = 50 akun COA**.

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

## Baseline 48 akun dan akun baru

- `docs/KODE AKUN.xlsx` memuat **48 akun baseline** dan **tidak boleh diubah**
  dalam DB-13a. Isinya identik dengan 48 baris pertama `KODE AKUN.csv`.
- Lima akun yang disetujui 2026-10-30 — **5060, 5061, 5062, 4060, 4006** —
  **belum** ditambahkan di DB-13a. DB-13 akan menambahkannya ke `KODE AKUN.csv`
  dan `src/db/coa.ts`, bukan ke xlsx.
- DB-13b nanti menambahkan **5063** dengan cara yang sama.
- Karena akun baru selalu ditambahkan di belakang CSV, xlsx tetap arsip 48 akun
  dan persamaan `COA = CSV + 2 ekstensi` tetap berlaku.

## Penjaga regresi

`tests/coa.test.ts` menegakkan:

1. `KODE AKUN.csv` ada, berisi 48 baris, dan setiap kode+nama cocok persis
   dengan COA.
2. `docs/KODE AKUN.xlsx` ada, bisa dibaca dengan `exceljs`, berisi tepat 48
   akun, sama dengan 48 baris pertama CSV, dan setiap akunnya ada identik di COA.
3. File xlsx tidak berubah: SHA-256 harus
   `c9a3f9f674f57ead20c1747bac25a16939f64acad6ea6aa6a9286fae4faae6b6`.
4. COA tepat sama dengan baris CSV + ekstensi sistem 1040/2060; tidak ada akun
   liar, dan ekstensi tidak boleh muncul di CSV.
5. Tidak ada kode atau nama duplikat di COA maupun CSV.
6. Dokumen ini tetap ada dan mencatat keputusan, angka 48, 1040, 2060, serta
   hash arsip.

## Cara mengubah dengan aman

- **Menambah akun client:** tambahkan baris baru di belakang `KODE AKUN.csv`,
  lalu tambahkan akun yang sama (kode, nama, tipe, posisi normal) ke COA.
  Jangan mengubah xlsx. Test akan memastikan jumlah dan isinya konsisten.
- **Mengubah nama akun baseline:** perlu persetujuan client karena berarti
  mengubah sumber mesin; xlsx lama tetap arsip dan test subset akan menolak
  perbedaan nama. Jangan mengedit xlsx diam-diam.
- **Menerima arsip xlsx baru dari client:** simpan salinan bertanggal, catat
  persetujuannya di ticket, perbarui baseline test + hash di dokumen ini, dan
  pastikan 48 akun lama tetap ada atau perubahan dijelaskan.
- **Menambah ekstensi sistem:** tambahkan kode ke `KODE_EKSTENSI_SISTEM` dan
  `COA`, perbarui test eksplisit 1040/2060, lalu catat alasannya di dokumen ini.
