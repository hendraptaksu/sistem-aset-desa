# Prinsip Akuntansi

**Status:** berlaku untuk skema baseline v2 (`SCHEMA_VERSION = 2`).
**Kontrak skema:** `docs/skema.md` — tabel, kolom, index, trigger, invariant, sumber COA, dan model pinjaman.
**Prinsip utama:** correctness & accuracy dulu; kecepatan belakangan (asal masuk akal).

Dokumen ini hanya memuat prinsip yang masih berlaku. Aplikasi memakai pembukuan
dua sisi (double-entry) yang sesungguhnya, dengan tampilan yang tetap mudah:
transaksi harian lewat form terpandu, dan akuntan pendamping dapat masuk ke
Jurnal Umum kapan pun.

## 1. Konsep double-entry versi sederhana

Setiap transaksi selalu dicatat di **dua sisi sekaligus**, dan jumlah kiri harus
sama dengan jumlah kanan. Sisi kiri = **debit**, sisi kanan = **kredit**.

| Kejadian | Debit (kiri) | Kredit (kanan) |
|---|---|---|
| Terima uang parkir Rp 100.000 | Kas +100.000 | Pendapatan Parkir +100.000 |
| Bayar listrik Rp 50.000 | Beban Listrik +50.000 | Kas −50.000 (berkurang) |
| Pindah uang kas → bank Rp 1.000.000 | Bank +1.000.000 | Kas −1.000.000 (berkurang) |
| Terima pinjaman dari pihak lain | Kas +5.000.000 | Hutang +5.000.000 |

Aturan mutlak: **total debit = total kredit**. Kalau tidak sama, sistem menolak
menyimpan. Inilah yang membuat akuntan percaya: setiap angka di laporan bisa
ditelusuri ke jurnalnya.

## 2. Prinsip yang dikunci

1. **Jurnal adalah satu-satunya sumber kebenaran.** Tabel `jurnal` (kepala) +
   `jurnal_baris` (debit/kredit per akun). Tidak ada tabel saldo, tidak ada laba
   tersimpan. **Kunci periode tidak membuat jurnal penutup**; jurnal penutup manual yang
   mencampur PENDAPATAN/BEBAN dengan EKUITAS ditolak, kecuali jurnal
   **SALDO_AWAL** dari wizard Saldo Awal. Akun legacy `3001`/`3002` hanya-baca:
   tidak dapat diposting dan tidak dihitung ulang dari kunci periode/surplus.
2. **Setiap jurnal seimbang**: minimal 2 baris, minimal satu sisi > 0 per baris,
   total debit = total kredit.
3. **Koreksi = jurnal balik (reversal) + alasan.** Tidak pernah edit/hapus
   jurnal yang sudah tersimpan.
4. **Semua laporan dihitung ulang dari jurnal setiap dibuka.** Boleh lambat,
   tidak boleh basi. Tidak ada cache angka turunan. Ini yang menjamin Neraca
   selalu balance.
5. **Akun kas/bank tidak boleh minus.** Kalau transaksi membuat minus →
   peringatan + konfirmasi + alasan (bukan blokir keras, karena kas bisa saja
   belum tercatat).
6. **Periode dikunci lewat menu Kunci Periode.** Koreksi di periode terkunci
   wajib alasan dan tercatat di audit.
7. **UI dua level input**: form terpandu untuk transaksi harian (operator awam
   pun aman), mode **Jurnal Umum** untuk akuntan. Keduanya menghasilkan jurnal
   yang sama.
8. **Skema baseline v2 adalah satu-satunya skema yang didukung.** Tidak ada
   migrasi otomatis: database/backup v1 atau versi lain ditolak tanpa diubah,
   dan database v2 yang tidak lengkap harus **dipulihkan dari backup**, bukan
   dibuat ulang. Backup/restore tetap dijaga karena menyangkut data pemakaian
   nyata. Untuk DB dev, `npm run db:reset-dev` memindahkan file lama ke
   `data/backups/pre-reset-<timestamp>.db` sebelum membuat DB v2 baru.
9. **Tetap offline**, satu file SQLite, tanpa server/cloud.
10. **Setiap jurnal punya nomor bukti dan jejak audit** (kapan dibuat, koreksi
    apa, alasannya apa).

### Mulai pembukuan di tengah tahun (cut-over)

Tahun buku tetap **Januari–Desember**; tidak ada setting tahun fiskal. Bila
pembukuan nyata dimulai pada tanggal lain (mis. `2026-07-01`):

- Isi **tanggal mulai pembukuan** dan **Saldo Awal** aset/kewajiban per tanggal
  itu; selisih menjadi `3000 MODAL`. Saldo awal tidak boleh memuat akun
  PENDAPATAN/BEBAN.
- Tanggal cut-over resmi disimpan di `pengaturan.cutover_tanggal`, dan jurnal
  pembukaan aktif ditunjuk `pengaturan.saldo_awal_aktif_id`. Laporan membaca
  kedua penunjuk resmi itu (dengan `akuntansi_tanggal_mulai` sebagai fallback
  data lama), **bukan** `MIN(tanggal)` jurnal `SALDO_AWAL`.
- Bila saldo awal sudah ada dan sebagian `1040 UANG PANJAR` sudah tercatat di
  jurnal pembukaan, buat dokumen **panjar `sumber = 'SALDO_AWAL'`** yang
  menunjuk jurnal pembukaan aktif. Dokumen ini adalah representasi bagian 1040
  yang sudah ada, bukan jurnal serah kedua.
- Jangan mencatat transaksi P&L sebelum cut-over. Hasil usaha sebelum cut-over
  sudah tercermin pada ekuitas/modal awal, bukan Laba Rugi tahun berjalan.
- Tahun pertama adalah **tahun pertama (parsial)**. `labaTahun()`/Laba Rugi
  hanya berisi transaksi sejak cut-over sampai 31 Desember; Neraca tetap
  seimbang karena saldo awal + laba parsial masuk ekuitas.
- `tutupBuku(2026)` boleh dijalankan pada 2027. Laba yang dikunci adalah laba
  parsial; **tidak ada jurnal penutup** yang dibuat. `3001`/`3002` tetap tidak
  diposting.

## 3. Yang tetap sama (jangan hilang)

- Bahasa Indonesia sederhana, kop "PURA DALEM PURI PELIATAN", format Rupiah
  `Rp 1.500.000` untuk nominal bulat (tanpa `,00`), `Rp 1.500,50` untuk
  pecahan sen, dan `(Rp ...)` untuk negatif.
- Kode & nama akun mengikuti `KODE AKUN.csv` resmi pura (plus 1040 Uang Panjar).
- Offline-first, satu file, backup/restore `.db`.
- Tema UI hijau/tenang, tabel besar, tombol jelas.
- **Semua tampilan untuk operator awam**: tidak ada istilah yang belum
  dijelaskan.

## 4. Bagaimana aplikasi tetap mudah (UI tiga level)

- **Level 1 — Terpandu (default untuk operator awam).** Tombol besar:
  `Terima Uang`, `Bayar`, `Transfer`, `Panjar`, `Hutang`, `Saldo Awal`. User
  mengisi 3–4 kolom (tanggal, akun, jumlah, keterangan). Sistem menampilkan
  **pratinjau jurnal** (debit/kredit) sebelum simpan — jadi operator awam
  perlahan belajar, dan akuntan pendamping bisa memeriksa hasilnya.
- **Level 2 — Jurnal Umum (untuk akuntan pendamping).** Tabel multi-baris
  debit/kredit, validasi seimbang *real-time*, template jurnal, duplikat jurnal.
  Istilah, format, dan alurnya standar akuntansi Indonesia supaya "lumrah" bagi
  akuntan.
- **Level 3 — Laporan.** Buku Besar per akun, Neraca Saldo, Laba Rugi, Neraca,
  Arus Kas, dan Panjar. Setiap baris laporan bisa diklik → detail jurnal asal
  (drill-down).

## 5. Definisi "benar" yang akan diuji

1. Neraca Saldo selalu **selisih nol** (total debit = total kredit), kapan pun,
   setelah operasi apa pun.
2. Setiap saldo di Neraca bisa dijelaskan oleh Buku Besar akun tersebut.
3. Setiap laporan bisa ditelusuri ke jurnal + nomor bukti.
4. Koreksi tidak pernah menghapus sejarah.
5. Backup/restore tidak boleh kehilangan transaksi (VACUUM INTO + cek
   integritas).
6. Koreksi setelah kunci periode **tidak** membuat selisih (karena tidak ada
   angka turunan tersimpan).
7. Test tetap hijau: `npm run typecheck` + `npm test` sebelum setiap commit.

## 6. Peran pengguna

- **Operator harian (orang awam)** — pengurus/suami; memakai **form terpandu**
  untuk input harian. Tidak wajib paham debit/kredit.
- **Akuntan pendamping/pemeriksa** — istri; memeriksa Jurnal Umum, Buku Besar,
  dan Neraca Saldo. Istilah & alur harus **lumrah secara akuntansi**, bukan
  istilah karangan sistem.
- **Pemegang PIN** — pengurus/pemilik; melihat laporan & mengotorisasi.
- Tanpa multi-user: satu PIN, satu laptop.

## 7. Keputusan pemilik (K1–K6)

| # | Keputusan | Jawaban | Dampak ke sistem |
|---|---|---|---|
| K1 | Operator utama | **Orang awam**, dengan istri (akuntan) sebagai pendamping/pemeriksa | Form terpandu jadi alur utama; mode Jurnal Umum & istilah standar tetap tersedia |
| K2 | Boleh tutup tahun berjalan? | **Setuju: tidak.** Hanya tahun yang sudah selesai (≤ tahun lalu) | Aplikasi menolak tahun berjalan/berikutnya |
| K3 | Aset tetap & penyusutan | **Dibuang** — terlalu rumit/membingungkan | Tidak ada aset tetap/penyusutan di Neraca; aplikasi hanya untuk pembukuan |
| K4 | Multi-user & enkripsi | **Tidak; PIN cukup** | Tidak ada multi-user & enkripsi |
| K5 | Nomor bukti | Ikut yang lazim | **`JU-2026-0001`** (JU = Jurnal Umum). `JP` dihindari karena ambigu (Jurnal Pembelian/Penjualan di perusahaan dagang). Alternatif: `BKM/BKK` untuk bukti kas masuk/keluar |
| K6 | Data lama | **Dibuang** — masih POC, belum ada production | Tidak ada konversi data; database lama ditolak dan pembukuan mulai dari nol |

## 8. Aturan panjar

`panjar` menyimpan header operasional agar daftar/detail dokumen tidak perlu
join ke jurnal setiap saat:

- **Sengaja disimpan:** `tanggal`, `jumlah`, `akun_kas_sumber`, `status`,
  `tanggal_close`, `jurnal_open_id`, `jurnal_close_id`, `created_at`.
  `tanggal`, `jumlah`, dan `akun_kas_sumber` adalah cermin jurnal serah
  (D 1040 / K kas sumber) dan wajib sama dengan jurnal tersebut.
- **Dihitung, bukan kolom:** `total_realisasi` = `SUM(panjar_item.nominal)`,
  `sisa`, dan `kurang`. Sumber angka laporan tetap jurnal.
- `panjar_item` tetap dipertahankan sebagai detail nota per baris; tidak ada
  over-normalisasi atau drop tabel.

Satu jurnal serah/close hanya boleh dipakai satu dokumen panjar. Unique index
`ux_panjar_jurnal_open` dan `ux_panjar_jurnal_close` (partial, mengabaikan
`NULL`) menjaga aturan ini. Audit `PANJAR_HEADER_TIDAK_COCOK` melaporkan drift
header terhadap jurnal serah yang di-seed lewat SQL langsung.

### Panjar saldo awal (`sumber = 'SALDO_AWAL'`)

Saat cut-over, sebagian saldo `1040 UANG PANJAR` mungkin sudah tercatat di
jurnal pembukaan. Bagian itu tidak boleh dibuatkan jurnal serah kedua; catat
sebagai dokumen panjar dengan `sumber = 'SALDO_AWAL'`:

- `jurnal_open_id` menunjuk **jurnal pembukaan aktif**
  (`OPENING`/`OPENING_REPLACEMENT`), bukan jurnal serah baru.
- Tanggal dokumen wajib sama dengan tanggal jurnal pembukaan aktif; `jumlah`
  tidak boleh melebihi debit neto `1040` jurnal itu (dikurangi dokumen opening
  lain), dan satu jurnal pembukaan hanya boleh punya satu dokumen.
- Rekonsiliasi `1040` menghitung dokumen ini satu kali. Close normal tetap
  memakai jurnal close yang mengkredit `1040`; tidak ada jurnal serah tambahan.
- Pembatalan generik ditolak karena akan membalik jurnal pembukaan. Bila belum
  ada realisasi, pembatalan khusus panjar saldo awal menghapus **dokumen
  representasi** tanpa jurnal balik (audit `PANJAR-SALDO-AWAL-BATAL`); jurnal
  pembukaan tidak diubah. Koreksi saldo awal tidak memindahkan
  `jurnal_open_id` dokumen ini secara otomatis; bila penunjuknya menunjuk
  pembukaan lama yang sudah tidak aktif, audit melaporkan
  `PANJAR_OPENING_TIDAK_LENGKAP`.

### Pembatalan panjar OPEN

Status resmi panjar adalah `OPEN`, `CLOSED`, atau `DIBATALKAN`.

- Saat panjar OPEN dibatalkan, status tersimpan menjadi `DIBATALKAN` dan
  `jurnal_batal_id` menautkan jurnal balik. `tanggal_batal` diisi dan
  `alasan_batal` minimal 5 karakter.
- Jurnal balik dibuat dari jurnal serah: `D kas sumber / K 1040`, berjenis
  `REVERSAL`, `grup_id` sama, `reversal_of` = jurnal serah, keterangan
  `KOREKSI: ...`. Jurnal serah asli tidak diubah/dihapus.
- Pembatalan wajib menulis audit `PANJAR-BATAL` dalam transaksi yang sama.
  Panjar CLOSED tidak dibatalkan lewat jalur ini.
- Panjar DIBATALKAN tidak muncul di daftar/filter OPEN maupun CLOSED, tidak bisa
  ditutup/dibatalkan ulang, dan tidak boleh punya jurnal close/item. Audit
  integritas melaporkan link batal yatim, duplikat, atau status tidak konsisten.
- Guard Jurnal Umum (`PESAN_REVERSAL_PANJAR`) tidak dilonggarkan: jalur
  pembatalan internal memakai `rencanaReversal` + posting layer, bukan endpoint
  reversal umum.

## 9. Aturan pinjaman LPD

Modul pinjaman LPD memisahkan **jadwal** dari **jurnal**:

- `pinjaman` menyimpan parameter perjanjian (kreditur, akun kas, akun bunga,
  pokok awal, sisa pokok awal, tanggal mulai, tenor, link jurnal pencairan).
- `pinjaman_angsuran` hanya menyimpan **rencana** pokok/bunga per jatuh tempo.
- `pinjaman_bayar` hanya menautkan `jurnal_id` + `angsuran_id`; **tidak ada
  kolom nominal pokok/bunga/denda** di tabel pembayaran.
- Outstanding dihitung saat dibaca:
  `sisa_pokok_awal - pokok pembayaran aktif`. Pencairan yang dibatalkan
  bersaldo pembukaan 0; riwayat reversal tetap ikut rekonsiliasi dan mutasi.
  Tidak ada kolom `sisa_pokok`/saldo berjalan yang disimpan.
- Pembayaran harus memakai jurnal seimbang dengan **D 2050 (pokok)**,
  **D akun bunga** (default `5063 BEBAN BUNGA PINJAMAN`), **D beban denda**
  bila ada, dan **K kas/bank**. Nominal tersebut dibaca dari baris jurnal.
- Satu angsuran dapat menerima beberapa pembayaran. Status
  `BELUM`/`SEBAGIAN`/`LUNAS` dihitung dari pokok dan bunga aktif; satu jurnal
  tetap hanya dimiliki satu pembayaran. Pembatalan melalui modul pinjaman
  menjaga histori asli dan membuat jurnal balik pada tanggal asli.
- `jurnal_pencairan_id = NULL` berarti pinjaman sudah berjalan: sisa pokok
  harus sudah ada di Saldo Awal 2050 dan modul **tidak** membuat jurnal
  pencairan baru.

Rekonsiliasi 2050 vs jadwal bersifat baca-saja: membandingkan outstanding GL
dari jurnal tertaut dengan sisa jadwal, tanpa koreksi otomatis dan tanpa
menyimpan saldo. Batas, rumus, dan validasi input dijelaskan di `docs/skema.md`.

## 10. Koreksi saldo awal

**Koreksi saldo awal = *reverse and re-post* lewat Wizard Koreksi Saldo Awal.**
Koreksi **bukan** edit/hapus jurnal, **bukan** reversal dari Jurnal Umum, dan
**bukan** `SALDO_AWAL` kedua. Unique index `ux_jurnal_saldo_awal` tetap menjaga
hanya ada satu jurnal berjenis `SALDO_AWAL`; jurnal pengganti selalu berjenis
`UMUM` dengan `peran = 'OPENING_REPLACEMENT'` dan `replaces_id` yang menunjuk
jurnal pembukaan yang digantikan.

### 10.1 Apa yang terjadi saat koreksi

Seluruh langkah berjalan dalam **satu transaksi DB yang atomik**:

1. Baca jurnal pembukaan yang **aktif**: jurnal di grup saldo awal yang belum
   punya reversal dan berperan `OPENING` atau `OPENING_REPLACEMENT`. Koreksi
   pertama membalik jurnal `SALDO_AWAL`; koreksi berikutnya membalik jurnal
   `UMUM` pengganti terakhir, bukan mengulang reversal jurnal yang sama.
2. Buat jurnal balik `REVERSAL` yang membalik persis jurnal pembukaan aktif
   (`reversal_of` = jurnal aktif, `grup_id` sama, keterangan `KOREKSI: ...`),
   dengan tanggal default **tanggal jurnal pembukaan aktif**.
3. Susun jurnal pengganti dari input koreksi memakai builder/validator saldo
   awal yang sama: hanya akun aset, kewajiban, dan ekuitas; selisih
   aktiva − kewajiban menjadi baris penyeimbang `3000 MODAL`. Header memakai
   `jenis = UMUM`, `peran = OPENING_REPLACEMENT`, `replaces_id` = jurnal
   pembukaan aktif, dan tanggal yang diisi operator.
4. Tulis audit `KOREKSI-SALDO-AWAL` berisi jurnal lama, jurnal balik, jurnal
   pengganti, dan alasan.
5. Perbarui **secara atomik** `pengaturan.saldo_awal_aktif_id` ke jurnal
   pengganti, `pengaturan.cutover_tanggal` ke tanggal baru, dan
   `pengaturan.akuntansi_tanggal_mulai` (fallback data lama) ke tanggal baru.
6. Bila salah satu langkah gagal (validasi, kunci periode, unique index,
   penulisan setting), **seluruh transaksi dibatalkan**; tidak ada koreksi
   setengah jadi dan penunjuk pembukaan tidak berpindah.

| Jurnal | Jenis | Peran | Tanggal | Isi |
|---|---|---|---|---|
| Pembukaan lama | `SALDO_AWAL` (koreksi pertama) atau `UMUM` (pengganti sebelumnya) | `OPENING` / `OPENING_REPLACEMENT` | `T` lama | Tidak diubah dan tidak dihapus; tetap menjadi histori |
| Jurnal balik | `REVERSAL` | `NORMAL` | `T` lama | Kebalikan persis jurnal pembukaan lama; `reversal_of` = jurnal lama |
| Jurnal pengganti | `UMUM` | `OPENING_REPLACEMENT` | `T` baru (boleh pindah) | Saldo hasil koreksi **penuh** (bukan delta), selisih ke `3000 MODAL`; `replaces_id` = jurnal lama |

Jurnal pengganti memuat saldo hasil koreksi secara penuh, bukan hanya
selisihnya, karena wizard memuat ulang dan menampilkan pratinjau saldo akhir
yang akan dipakai. Efek bersih di laporan adalah:

```text
jurnal pembukaan lama + REVERSAL + UMUM pengganti = saldo awal hasil koreksi
```

Jurnal `SALDO_AWAL` lama tidak pernah dibalik dua kali; `ux_jurnal_reversal`
tetap menjadi penjaga terakhir. Dengan demikian selalu ada satu rangkaian:
saldo awal asli → balik → pengganti → balik → pengganti, dan seterusnya,
semuanya dalam `grup_id` yang sama. Penunjuk `saldo_awal_aktif_id` selalu
berpindah ke pengganti terakhir.

### 10.2 Tanggal boleh pindah; laporan memakai penunjuk resmi

- **Tanggal saldo awal boleh dipindah**, baik lebih akhir maupun lebih awal.
  Tidak ada batas bawah dari `cutover_tanggal` lama: koreksi yang sah boleh
  memundurkan tanggal mulai pembukuan. Batas atasnya adalah **tidak boleh
  setelah transaksi non-pembukaan paling awal**; tanggal masa depan tetap
  ditolak validator. Batas ini dihitung dari `MIN(tanggal)` jurnal **di luar
  grup pembukaan**, bukan dari jurnal `SALDO_AWAL` lama.
- `pengaturan.saldo_awal_aktif_id` dan `pengaturan.cutover_tanggal` diperbarui
  **atomik** bersama jurnal balik, jurnal pengganti, dan audit. Bila penulisan
  setting gagal, seluruh koreksi dibatalkan.
- Laporan memakai **penunjuk resmi**: `getPembukaanAktif()` membaca
  `saldo_awal_aktif_id`, dan `getCutoverTanggal()` memprioritaskan
  `cutover_tanggal` (fallback `akuntansi_tanggal_mulai` untuk data lama).
  Laporan **tidak** memakai `MIN(tanggal)` jurnal `SALDO_AWAL`. Karena itu
  tanggal jurnal `SALDO_AWAL` lama tidak perlu diubah saat cut-over dipindah.
- `KUNCI_AKUNTANSI_TANGGAL_MULAI` ikut diperbarui sebagai fallback data lama;
  nilai ini **bukan** sumber tanggal cut-over utama dan bukan pembatas koreksi.
- Audit integritas mendeteksi drift manual: `CUTOVER_TIDAK_KONSISTEN` bila
  `cutover_tanggal` berbeda dari tanggal pembukaan aktif, dan
  `PEMBUKAAN_AKTIF_HILANG` bila penunjuk kosong/tidak sah padahal ada jurnal
  `SALDO_AWAL`.

### 10.3 Mengapa tidak membuat `SALDO_AWAL` kedua

- **Praktik akuntansi standar.** Koreksi saldo awal adalah *reverse and
  re-post*: balik jurnal lama, lalu posting ulang. Jurnal lama tidak pernah
  diedit/dihapus, sehingga jejak audit utuh.
- **`ux_jurnal_saldo_awal` adalah penjaga murah dan jelas.** Index parsial ini
  memastikan tidak pernah ada dua jurnal `SALDO_AWAL`, sehingga
  `sudahAdaSaldoAwal`/`statusSaldoAwal` tetap sederhana: wizard normal terkunci
  setelah saldo awal pertama.
- **Risiko double count.** Bila `SALDO_AWAL` kedua diizinkan, laporan yang
  menjumlahkan `jurnal_baris` bisa menghitung saldo awal dua kali dan aturan
  "saldo awal hanya sekali" menjadi kabur.
- **Skema v2 tidak mengubah model ini.** `peran` dan `replaces_id` membuat
  relasi pembukaan/pengganti eksplisit, tetapi pengganti tetap `UMUM`; tidak
  ada kebutuhan membuat `SALDO_AWAL` baru atau mengubah `ux_jurnal_saldo_awal`.

### 10.4 Batasan dan larangan jalur generik

- Jurnal lama **tidak pernah dihapus atau diedit**; trigger immutable tetap
  berlaku.
- **Reversal generik dilarang atas pembukaan aktif/pengganti.**
  `reverseJurnal()` dan `koreksiDanIsiUlang()` menolak jurnal yang ditunjuk
  `saldo_awal_aktif_id`, berperan `OPENING`/`OPENING_REPLACEMENT`, atau
  berjenis `SALDO_AWAL` (`PESAN_REVERSAL_PEMBUKAAN_AKTIF` /
  `PESAN_REVERSAL_SALDO_AWAL`). UI juga tidak menawarkan tombol koreksi untuk
  jurnal itu. Jalur satu-satunya adalah **Wizard Koreksi Saldo Awal**.
- **Jenis jurnal tidak boleh diganti saat koreksi generik.** Jurnal pengganti
  wajib berjenis sama dengan jurnal asli; `REVERSAL` selalu ditolak, dan
  `SALDO_AWAL` tidak boleh dipakai sebagai pengganti jurnal jenis lain. Satu-
  satunya perubahan `SALDO_AWAL` → `UMUM` adalah wizard koreksi saldo awal,
  yang memang selalu menulis pengganti `UMUM` + `OPENING_REPLACEMENT`.
- **Tanggal reversal/pengganti generik tidak boleh mundur** dari tanggal jurnal
  asli. Tanpa tanggal eksplisit, reversal memakai tanggal asli. Koreksi yang
  perlu memindahkan tanggal lebih awal hanya bisa lewat Wizard Koreksi Saldo
  Awal (cut-over ikut disesuaikan).
- Koreksi saldo awal hanya boleh memakai akun aset, kewajiban, dan ekuitas;
  akun PENDAPATAN/BEBAN ditolak. Akun kontrol `1040`/`2050` hanya boleh
  disentuh lewat konteks koreksi ini, bukan Jurnal Umum biasa.
- Satu jurnal hanya boleh dibalik sekali. Koreksi berulang selalu membalik
  jurnal pembukaan yang sedang aktif, bukan mengulang reversal jurnal yang
  sama.
- Bila tanggal jatuh di periode terkunci, aturan kunci periode dan alasan tetap
  berlaku seperti jurnal biasa.

## 11. Snapshot kunci periode (T-A06)

Mengunci periode menulis penanda `tutup_buku` **dan** snapshot append-only di
`tutup_buku_snapshot` dalam transaksi yang sama. Snapshot berisi laba tahun,
total aset/kewajiban/ekuitas/pasiva, selisih Neraca, serta `hash_jurnal`
SHA-256 dari seluruh kepala + baris jurnal bertanggal tahun itu.

- **Bukan sumber angka laporan.** Laba, Neraca, dan seluruh laporan tetap
  dihitung ulang dari `jurnal` + `jurnal_baris` setiap kali dibuka. Snapshot
  hanya bukti angka yang disahkan saat tutup dan bahan perbandingan audit.
- **Immutable.** Trigger `trg_tutup_buku_snapshot_immutable_update` dan
  `trg_tutup_buku_snapshot_immutable_delete` menolak perubahan/penghapusan.
- **Versi naik pada `TUTUP-ULANG`.** `UNIQUE(tahun, versi)` mencegah versi yang
  sama tertimpa. Tutup ulang menulis versi baru; versi lama tetap tersimpan
  sebagai histori.
- **Temuan `SNAPSHOT_TUTUP_BERUBAH` bersifat kontrol (non-blok).** Audit
  membandingkan snapshot terbaru dengan angka + hash live. Bila berbeda,
  temuan dilaporkan dan UI menampilkan peringatan, tetapi **tidak memblokir**
  `TUTUP-ULANG` yang sudah dikonfirmasi. Temuan integritas lain tetap
  memblokir kunci periode. Snapshot tidak pernah diubah otomatis; perbedaan bisa
  berasal dari koreksi setelah tutup atau data rusak.

## 12. Audit: aktor, hash chain, dan threat model (T3.5)

**Keputusan (T3.5, dibuat saat skema v1): pertahankan `audit_log` + trigger
append-only dan dokumentasikan risikonya. Tidak ada perubahan skema, tidak ada
kolom `actor`, dan tidak ada `prev_hash`/`hash`.** Baseline **skema v2** kini
sudah aktif dan tetap mempertahankan keputusan ini. Implementasi aktor atau
**hash chain**, bila kelak dipilih, wajib lewat **tiket terpisah** dengan
keputusan skema berikutnya (v3) yang eksplisit; jangan menyelipkannya ke tiket
hardening lain.

### 12.1 Konteks

- Aplikasi **single-user, offline, satu laptop, satu PIN**. Tidak ada login
  per pengguna dan tidak ada identitas operator yang bisa dipercaya dari
  aplikasi.
- `audit_log` v1 menyimpan `id`, `tanggal`, `aksi`, `alasan`,
  `data_lama_json`, `data_baru_json`, `ref_type`, dan `ref_id`.
- Dua trigger DB (`trg_audit_log_immutable_update`,
  `trg_audit_log_immutable_delete`) menolak `UPDATE`/`DELETE`. Repository hanya
  menulis audit lewat `INSERT` (`insertAuditLog`/`catatAudit`) dan tidak punya
  jalur edit/hapus.

### 12.2 Apa yang dilindungi

- **Append-only dari dalam aplikasi.** Tidak ada operasi edit/hapus audit di
  repository, IPC, atau UI. Trigger DB menolak percobaan `UPDATE`/`DELETE`
  yang lewat koneksi SQLite aplikasi.
- **Konteks keputusan, bukan sekadar "ada kejadian".** Setiap baris audit
  dapat memuat **alasan**, kondisi **data lama/baru** dalam JSON, waktu
  peristiwa (`tanggal`), serta **`ref_type`/`ref_id`** yang menunjuk objek
  terkait (mis. `jurnal` + id). Ini memungkinkan pemeriksa menjawab "apa yang
  berubah, mengapa, dan atas objek apa".
- **Atomik dengan transaksi bisnis.** Audit yang diwajibkan ditulis dalam
  transaksi yang sama dengan jurnal/koreksi, sehingga kegagalan salah satu
  pihak membatalkan keduanya.
- **Histori koreksi tetap utuh.** Jurnal lama tidak diedit/dihapus; koreksi
  berupa jurnal balik + alasan, dan audit mencatat kedua kondisi.

### 12.3 Apa yang TIDAK dilindungi

- **Edit file DB langsung.** Siapa pun yang bisa menulis file `pura.db`
  (mis. membukanya dengan alat SQLite) dapat menghapus trigger lalu
  `UPDATE`/`DELETE` baris audit, atau menulis ulang isinya. Trigger bukan batas
  keamanan terhadap pemilik file/OS.
- **Tidak ada aktor.** `audit_log` v1 **tidak mencatat actor**. Tanpa login,
  nilai aktor hanya bisa diisi konstanta atau tebakan sehingga tidak bermakna
  untuk atribusi. Audit menjawab "apa & mengapa", bukan "siapa".
- **Tidak tamper-evident.** Tidak ada hash chain, tanda tangan, atau anchor
  eksternal. Perubahan isi audit tidak terdeteksi oleh aplikasi. Backup lama
  juga dapat diedit dengan cara yang sama.
- **Bukan enkripsi.** PIN hanya kunci akses aplikasi, bukan enkripsi database
  atau backup (lihat README bagian "Keamanan dan keterbatasan" dan keputusan
  T3.3).

### 12.4 Opsi masa depan dan biayanya

| Opsi | Isi | Manfaat | Biaya/dampak |
|---|---|---|---|
| **A** | Kolom `actor` + `prev_hash`/`hash` di `audit_log` (**skema v3**) | Aktor tercatat; baris audit bisa dirantai dan diverifikasi | Perubahan DDL + `SCHEMA_VERSION`; migrasi/reset DB; backup v1 lama tidak langsung kompatibel; `insertAuditLog`/`catatAudit` dan seluruh pemanggil berubah; perlu aturan kanonikalisasi hash, baris genesis, dan verifikasi; test skema/backup/audit ikut berubah |
| **B** | **Tabel chain terpisah** (mis. `audit_chain`) yang menautkan hash per baris audit | `audit_log` tidak berubah bentuk; rantai bisa diverifikasi terpisah | Tetap **skema v3** + migrasi/reset; butuh penulisan atomik dua tabel, urutan/`id` chain yang stabil, query gabungan, dan test konsistensi; biaya operasional lebih tinggi dari A |
| **C** | **Dokumentasi risiko + trigger append-only** (dipilih sejak v1, dipertahankan di v2) | Tanpa migrasi; skema v2 tetap kompatibel; perilaku yang dilihat pengguna tidak berubah | Tidak melindungi dari edit file DB langsung; tidak ada aktor; tidak tamper-evident |

Catatan penting untuk opsi A/B: **hash chain tidak melindungi dari penyerang
yang bisa menulis file DB**. Setelah mengedit satu baris, penyerang dapat
menghitung ulang seluruh rantai dari genesis. Hash chain hanya membuat edit
parsial/naif terdeteksi; untuk **tamper-evident** yang nyata dibutuhkan
**anchor eksternal** (mis. hash terakhir dicatat di kertas/laporan tercetak,
file terpisah yang read-only, atau layanan lain). Tanpa anchor, rantai hanya
mendeteksi perubahan yang tidak disengaja, bukan penyerang dengan akses tulis
penuh.

Begitu pula `actor`: baru bermakna bila ada autentikasi per pengguna atau
pemisahan peran. Selama aplikasi single-user dengan satu PIN, kolom aktor
akan berisi nilai tetap dan tidak menambah bukti atribusi.

### 12.5 Dampak migrasi/reset DB dan backup

- Skema v2 menaikkan `user_version`; kebijakan repo saat ini **hanya menerima
  `user_version = 2`** dan tidak melakukan konversi otomatis
  (`docs/skema.md`). Karena itu opsi A/B memerlukan **migrasi eksplisit** ke
  skema berikutnya atau **reset database** — keduanya keputusan produk, bukan
  sekadar perubahan DDL.
- **Backup v1 lama** tidak bisa dibuka build v2 tanpa jalur migrasi. Restore
  harus tetap diuji, atau operator diberi instruksi ekspor/impor yang jelas.
- **Reset DB** berarti data pembukuan nyata hilang; ini bertentangan dengan
  janji backup/restore yang sudah diuji di T1/T3 dan harus disetujui pemilik.
- Biaya test mencakup `skema-baseline`, `skema-strict`, `skema-kompatibilitas`,
  `backup-restore`, `dokumentasi`, dan test audit lintas modul.
- Karena dampaknya besar dan tidak mendesak untuk pemakaian single-user
  offline, perubahan ini **tidak dikerjakan pada rilis skema v2** dan tidak
  dicampur dengan tiket hardening lain.

### 12.6 Rekomendasi

1. **Rilis saat ini (skema v2):** pertahankan trigger append-only +
   dokumentasi risiko ini (Opsi C). Nilai utama audit saat ini adalah mencegah edit/hapus dari dalam
   aplikasi dan merekam alasan serta kondisi sebelum/sesudah.
2. **Sebelum skema berikutnya (v3):** buka **tiket keputusan terpisah** yang
   memilih A, B, atau tetap C, lengkap dengan rencana migrasi/backup dan
   persetujuan pemilik.
   Bila tujuannya benar-benar tamper-evident, rancang sekalian **anchor
   eksternal**; tanpa itu hash chain memberi rasa aman yang menyesatkan.
3. **Implementasi** opsi A/B (bila disetujui) masuk **tiket terpisah** setelah
   keputusan skema v3; tiket T3.5 ini hanya menetapkan keputusan dan threat
   model.
