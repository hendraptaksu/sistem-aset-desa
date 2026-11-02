# Arah Sistem — Akuntansi yang Benar, Mudah Dipakai Akuntan

> Keputusan arah: **2026-10-04**. Dokumen ini menggantikan PRD sebagai acuan pengembangan.
> `PRD.md` sudah tidak dipakai (terhapus). Kalau menemukan komentar/kode yang merujuk PRD, boleh
> diperbarui sambil jalan.
>
> Prinsip utama: **correctness & accuracy dulu; kecepatan belakangan (asal masuk akal).**
> Keputusan pemilik sistem K1–K6 sudah dijawab — lihat §9.

---

## 1. Kenapa arah berubah

Sistem lama memakai pembukuan **satu sisi (single-entry)**: user memilih "dompet + kategori + masuk/keluar",
lalu sisi lawannya *ditebak* oleh laporan. Akibatnya:

- Tidak ada jurnal yang bisa diperiksa akuntan. Akuntan bekerja dengan **debit–kredit**.
- Laporan dihitung ulang dengan rumus yang berbeda-beda per fitur (Neraca, Realisasi, Surplus).
- Ada angka turunan yang **disimpan mati** (mis. `tutup_buku.laba`). Begitu ada koreksi, angka itu basi
  dan Neraca langsung selisih — sudah terbukti di DB dev (selisih Rp 2.000.000).
- Koreksi tidak ada jalurnya; typo = permanen.

Karena akurasi adalah prioritas utama, sistem ini diubah menjadi **pembukuan dua sisi (double-entry) yang
sesungguhnya**, dengan tampilan yang tetap mudah: transaksi harian lewat form terpandu, dan akuntan
pendamping bisa masuk ke jurnal umum kapan pun.

## 2. Konsep double-entry versi sederhana

Setiap transaksi selalu dicatat di **dua sisi sekaligus**, dan jumlah kiri harus sama dengan jumlah kanan.
Pakai istilah akuntansi: sisi kiri = **debit**, sisi kanan = **kredit**.

| Kejadian | Debit (kiri) | Kredit (kanan) |
|---|---|---|
| Terima uang parkir Rp 100.000 | Kas +100.000 | Pendapatan Parkir +100.000 |
| Bayar listrik Rp 50.000 | Beban Listrik +50.000 | Kas −50.000 (berkurang) |
| Pindah uang kas → bank Rp 1.000.000 | Bank +1.000.000 | Kas −1.000.000 (berkurang) |
| Terima pinjaman dari pihak lain | Kas +5.000.000 | Hutang +5.000.000 |

Aturan mutlak: **total debit = total kredit**. Kalau tidak sama, sistem menolak menyimpan.
Inilah yang membuat akuntan percaya: setiap angka di laporan bisa ditelusuri ke jurnalnya.

## 3. Prinsip yang dikunci

1. **Jurnal adalah satu-satunya sumber kebenaran.** Tabel `jurnal` (kepala) + `jurnal_baris` (debit/kredit
   per akun). Tidak ada tabel saldo, tidak ada laba tersimpan. **Kunci periode tidak membuat jurnal penutup**;
   jurnal penutup manual yang mencampur PENDAPATAN/BEBAN dengan EKUITAS ditolak, kecuali jurnal
   **SALDO_AWAL** dari wizard Saldo Awal. Akun legacy `3001`/`3002` hanya-baca: tidak dapat diposting dan
   tidak dihitung ulang dari kunci periode/surplus.
2. **Setiap jurnal seimbang**: minimal 2 baris, minimal satu sisi > 0 per baris, total debit = total kredit.
3. **Koreksi = jurnal balik (reversal) + alasan.** Tidak pernah edit/hapus jurnal yang sudah tersimpan.
4. **Semua laporan dihitung ulang dari jurnal setiap dibuka.** Boleh lambat, tidak boleh basi.
   Tidak ada cache angka turunan. Ini yang menjamin Neraca selalu balance.
5. **Akun kas/bank tidak boleh minus.** Kalau transaksi membuat minus → peringatan + konfirmasi + alasan
   (bukan blokir keras, karena kas bisa saja belum tercatat).
6. **Periode dikunci lewat menu Kunci Periode.** Koreksi di periode terkunci wajib alasan dan tercatat di audit.
7. **UI dua level**: form terpandu untuk transaksi harian (operator awam pun aman), mode **Jurnal Umum**
   untuk akuntan. Keduanya menghasilkan jurnal yang sama.
8. **POC = bebas merombak.** Tidak ada kewajiban kompatibilitas dengan data/skema lama; DB POC lama
   dibuang dan mulai dari nol. Backup/restore tetap dijaga karena menyangkut data pemakaian nyata nanti.
9. **Tetap offline**, satu file SQLite, tanpa server/cloud.
10. **Setiap jurnal punya nomor bukti dan jejak audit** (kapan dibuat, koreksi apa, alasannya apa).

### Mulai pembukuan di tengah tahun (cut-over, DB-38)

Tahun buku tetap **Januari–Desember**; tidak ada setting tahun fiskal. Bila
pembukuan nyata dimulai pada tanggal lain (mis. `2026-07-01`):

- Isi **tanggal mulai pembukuan** dan **Saldo Awal** aset/kewajiban per tanggal
  itu; selisih menjadi `3000 MODAL`. Saldo awal tidak boleh memuat akun
  PENDAPATAN/BEBAN.
- Jangan mencatat transaksi P&L sebelum cut-over. Hasil usaha sebelum cut-over
  sudah tercermin pada ekuitas/modal awal, bukan Laba Rugi tahun berjalan.
- Tahun pertama adalah **tahun pertama (parsial)**. `labaTahun()`/Laba Rugi hanya
  berisi transaksi sejak cut-over sampai 31 Desember; Neraca tetap seimbang
  karena saldo awal + laba parsial masuk ekuitas.
- `tutupBuku(2026)` boleh dijalankan pada 2027. Laba yang dikunci adalah laba
  parsial; **tidak ada jurnal penutup** yang dibuat (AKT-16). `3001`/`3002`
  tetap tidak diposting.

## 4. Yang berubah

| Sebelum overhaul (v1.2.0) | Arah baru |
|---|---|
| `transaksi` (masuk/keluar + kategori) | `jurnal` + `jurnal_baris` (debit/kredit per akun) |
| Kategori = campuran akun kas & akun lawan | Semua sisi adalah **akun COA** ber-tipe |
| `PANJAR` kategori sistem tersembunyi | Akun aset **1040 Uang Panjar (Kas di Muka)** |
| `tutup_buku.laba` sumber angka Neraca | Laba dihitung dari jurnal; kunci periode hanya kunci + catatan |
| Hanya 1 bentuk input | Form terpandu + Jurnal Umum |
| Neraca dihitung ad-hoc | Neraca Saldo, Buku Besar, Laba Rugi, Neraca — semua dari jurnal |
| Tidak ada koreksi | Jurnal balik + audit |

Karena masih POC, tabel single-entry lama (`transaksi`, `coa`) dibersihkan hanya saat DB asli v0–v2
dibuka — **tidak ada migrasi data**. `panjar`, `panjar_item`, dan `tutup_buku` tidak dibuang berdasarkan
bentuk kolom (DB-06); perubahan bentuk tabel hanya lewat migrasi eksplisit. DB dev lama boleh dihapus;
dev seed baru dibuat di atas jurnal v2.

## 5. Yang tetap sama (jangan hilang)

- Bahasa Indonesia sederhana, kop "PURA DALEM PURI PELIATAN", format Rupiah `(Rp ...)` untuk negatif.
- Kode & nama akun mengikuti `KODE AKUN.csv` resmi pura (plus 1040 Uang Panjar).
- Offline-first, satu file, backup/restore `.db`.
- Tema UI hijau/tenang, tabel besar, tombol jelas.
- **Semua tampilan untuk operator awam**: tidak ada istilah yang belum dijelaskan.

## 6. Bagaimana aplikasi tetap mudah

- **Level 1 — Terpandu (default untuk operator awam).** Tombol besar: `Terima Uang`, `Bayar`, `Transfer`,
  `Panjar`, `Hutang`, `Saldo Awal`. User mengisi 3–4 kolom (tanggal, akun, jumlah, keterangan).
  Sistem menampilkan **pratinjau jurnal** (debit/kredit) sebelum simpan — jadi operator awam perlahan
  belajar, dan akuntan pendamping bisa memeriksa hasilnya.
- **Level 2 — Jurnal Umum (untuk akuntan pendamping).** Tabel multi-baris debit/kredit, validasi seimbang
  *real-time*, template jurnal, duplikat jurnal. Istilah, format, dan alurnya standar akuntansi Indonesia
  supaya "lumrah" bagi akuntan.
- **Level 3 — Laporan.** Buku Besar per akun, Neraca Saldo, Laba Rugi, Neraca, Arus Kas, dan
  Panjar. Setiap baris laporan bisa diklik → detail jurnal asal (drill-down).

## 7. Definisi "benar" yang akan diuji

1. Neraca Saldo selalu **selisih nol** (total debit = total kredit), kapan pun, setelah operasi apa pun.
2. Setiap saldo di Neraca bisa dijelaskan oleh Buku Besar akun tersebut.
3. Setiap laporan bisa ditelusuri ke jurnal + nomor bukti.
4. Koreksi tidak pernah menghapus sejarah.
5. Backup/restore tidak boleh kehilangan transaksi (VACUUM INTO + cek integritas).
6. Koreksi setelah kunci periode **tidak** membuat selisih (karena tidak ada angka turunan tersimpan).
7. Test tetap hijau: `npm run typecheck` + `npm test` sebelum setiap commit.

## 8. Peran pengguna (hasil keputusan K1)

- **Operator harian (orang awam)** — pengurus/suami; memakai **form terpandu** untuk input harian.
  Tidak wajib paham debit/kredit.
- **Akuntan pendamping/pemeriksa** — istri; memeriksa Jurnal Umum, Buku Besar, dan Neraca Saldo.
  Istilah & alur harus **lumrah secara akuntansi**, bukan istilah karangan sistem.
- **Pemegang PIN** — pengurus/pemilik; melihat laporan & mengotorisasi.
- Tanpa multi-user: satu PIN, satu laptop (K4).

## 9. Keputusan pemilik (dijawab 2026-10-04)

| # | Keputusan | Jawaban | Dampak ke sistem |
|---|---|---|---|
| K1 | Operator utama | **Orang awam**, dengan istri (akuntan) sebagai pendamping/pemeriksa | Form terpandu jadi alur utama; mode Jurnal Umum & istilah standar tetap tersedia |
| K2 | Boleh tutup tahun berjalan? | **Setuju: tidak.** Hanya tahun yang sudah selesai (≤ tahun lalu) | P0-7 menolak tahun berjalan/berikutnya |
| K3 | Aset tetap & penyusutan | **Dibuang** — terlalu rumit/membingungkan | Tidak ada aset tetap/penyusutan di Neraca. Modul Inventaris Aset juga dihapus (DB-32); aplikasi hanya untuk pembukuan. |
| K4 | Multi-user & enkripsi | **Tidak; PIN cukup** | Ticket multi-user & enkripsi dibatalkan |
| K5 | Nomor bukti | Ikut yang lazim | **`JU-2026-0001`** (JU = Jurnal Umum). `JP` dihindari karena ambigu (Jurnal Pembelian/Penjualan di perusahaan dagang). Alternatif: `BKM/BKK` untuk bukti kas masuk/keluar |
| K6 | Data lama | **Dibuang** — masih POC, belum ada production | Tidak ada kode migrasi; DB v2 mulai dari nol |

## 10. POC: mulai dari nol (tidak ada migrasi)

- Skema v2 membuat tabel baru; tabel single-entry lama (`transaksi`/`coa`) dibersihkan dari DB asli
  v0–v2 oleh migrasi eksplisit. `panjar`/`panjar_item`/`tutup_buku` dipertahankan.
- Kontrak skema aktif (11 tabel, relasi, index, trigger, dan aturan sumber
  angka) ada di `docs/erd-v2.md`. Tabel baru setelah DB-30 wajib `STRICT`
  dengan `DEFAULT` eksplisit; tabel pinjaman warisan v20 tidak direbuild tanpa
  ticket migrasi terpisah.
- DB dev lama (`data/pura-dev.db`) dan file backup dev boleh dihapus kapan saja.
- `seed-dev` baru menghasilkan contoh jurnal yang seimbang (deterministik) untuk uji laporan.
- Backup/restore tetap aman karena nanti dipakai untuk data nyata: `VACUUM INTO`, validasi integritas,
  dan auto-backup sebelum restore.

### Kolom header panjar: disimpan vs dihitung (DB-20)

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
`NULL`) dipasang lewat migrasi v18 setelah pemeriksaan duplikat. Audit
`PANJAR_HEADER_TIDAK_COCOK` melaporkan drift header terhadap jurnal serah yang
di-seed lewat SQL langsung.

### Pembatalan panjar OPEN (DB-21)

Migrasi v19 menambah kolom aditif `jurnal_batal_id`, `tanggal_batal`, dan
`alasan_batal`, plus partial unique index `ux_panjar_jurnal_batal` (satu jurnal
batal untuk satu dokumen). Tabel **tidak** direbuild dan CHECK lama
`status IN ('OPEN','CLOSED')` tidak diubah.

- Saat panjar OPEN dibatalkan, status tersimpan tetap `OPEN`; status publik
  `DIBATALKAN` diturunkan dari `jurnal_batal_id` yang tidak NULL.
- Jurnal balik dibuat dari jurnal serah: `D kas sumber / K 1040`, berjenis
  `REVERSAL`, `grup_id` sama, `reversal_of` = jurnal serah, keterangan
  `KOREKSI: ...`. Jurnal serah asli tidak diubah/dihapus.
- Pembatalan wajib alasan >= 5 karakter dan menulis audit `PANJAR-BATAL` dalam
  transaksi yang sama. Panjar CLOSED tidak ditangani DB-21.
- Panjar DIBATALKAN tidak muncul di daftar/filter OPEN maupun CLOSED, tidak bisa
  ditutup/dibatalkan ulang, dan tidak boleh punya jurnal close/item. Audit
  integritas melaporkan link batal yatim, duplikat, atau status tidak konsisten.
- Guard Jurnal Umum (`PESAN_REVERSAL_PANJAR`) tidak dilonggarkan: jalur
  pembatalan internal memakai `rencanaReversal` + posting layer, bukan endpoint
  reversal umum.

### Pinjaman LPD: rencana vs realisasi (DB-16b)

Modul pinjaman LPD memisahkan **jadwal** dari **jurnal**:

- `pinjaman` menyimpan parameter perjanjian (kreditur, akun kas, akun bunga,
  pokok awal, sisa pokok awal, tanggal mulai, tenor, link jurnal pencairan).
- `pinjaman_angsuran` hanya menyimpan **rencana** pokok/bunga per jatuh tempo.
- `pinjaman_bayar` hanya menautkan `jurnal_id` + `angsuran_id`; **tidak ada
  kolom nominal pokok/bunga/denda** di tabel pembayaran.
- Outstanding dihitung saat dibaca:
  `sisa_pokok_awal - SUM(debit 2050 pada jurnal pembayaran tertaut)`.
  Tidak ada kolom `sisa_pokok`/saldo berjalan yang disimpan.
- Pembayaran harus memakai jurnal seimbang dengan **D 2050 (pokok)**,
  **D akun bunga** (default `5063 BEBAN BUNGA PINJAMAN`), **D beban denda**
  bila ada, dan **K kas/bank**. Nominal tersebut dibaca dari baris jurnal.
- Status angsuran `LUNAS` diturunkan dari link `pinjaman_bayar.angsuran_id`;
  satu angsuran dan satu jurnal hanya boleh ditautkan sekali.
- `jurnal_pencairan_id = NULL` berarti pinjaman sudah berjalan: sisa pokok
  harus sudah ada di Saldo Awal 2050 dan modul **tidak** membuat jurnal
  pencairan baru.

## 11. Roadmap ringkas

- **P0 — Pondasi:** COA ber-tipe, skema jurnal, reset DB POC + seed baru, laporan inti (Buku Besar,
  Neraca Saldo, Laba Rugi, Neraca, Arus Kas), posting layer, reversal, kunci periode, backup/restore aman, audit.
- **P1 — Pengalaman pengguna:** form terpandu (operator awam), Jurnal Umum (akuntan pendamping),
  drill-down, export/print semua laporan, template cetak resmi, nomor bukti `JU`, pengaturan, dashboard.
- **P2 — Lanjutan:** test integrasi dan dokumentasi.
  (Rekonsiliasi bank, aset tetap, & multi-user sudah dibatalkan.)

Detail per ticket (dengan checkbox dan bukti) ada di `docs/tickets-perbaikan.md`.

## 12. Peta feedback WhatsApp v1.2.0 → solusi di arah baru

| # | Feedback pengguna v1.2.0 | Solusi di rencana baru |
|---|---|---|
| 1 | "Menu edit kalau ada salah ketik/input apakah ada?" | **P0-6**: tombol **Koreksi** di daftar jurnal → sistem membuat jurnal balik + form **"Koreksi & isi ulang"** yang sudah terisi data lama, wajib alasan, tercatat audit. Jurnal asli tidak dihapus. |
| 2 | "Bagaimana dengan layout print?" | **P1-10** (export/print semua laporan) + **P1-16** (template cetak resmi & pratinjau: kop, periode, A4, nomor halaman, kolom muat, pratinjau sebelum cetak). |
| 3 | "Perpindahan kas dari LPD ke kas umum bendahara, sesama kas" | **P1-3 Form Pindah Dana**: dua baris jurnal (D Kas Bendahara / K LPD), total kas tidak berubah. Berlaku untuk semua pasangan dompet (LPD, bank, kas tunai). |
| 4 | "Pencatatan hutang bingung cari lawan; kalau pakai gedung/perbaikan gedung memengaruhi modal" | **P1-5/AKT-20 form Utang**: perbaikan gedung dibayar belakangan = D 5003 Beban Wewangunan / K 2060 Hutang Usaha → laba turun, utang usaha naik, **modal tidak berubah**. Pelunasan utang usaha = D 2060 / K Kas (arus Operasi); pinjaman tetap memakai 2050 dan arus Pendanaan. Modal hanya berubah lewat setoran/penarikan modal atau Saldo Awal. |
