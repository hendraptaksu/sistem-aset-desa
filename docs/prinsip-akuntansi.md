# Prinsip Akuntansi

**Status:** berlaku untuk skema baseline v1.
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
8. **Skema baseline v1 bebas dirombak.** Tidak ada kewajiban kompatibilitas
   dengan data/skema lama; database lama ditolak dan pembukuan dimulai dari nol.
   Backup/restore tetap dijaga karena menyangkut data pemakaian nyata.
9. **Tetap offline**, satu file SQLite, tanpa server/cloud.
10. **Setiap jurnal punya nomor bukti dan jejak audit** (kapan dibuat, koreksi
    apa, alasannya apa).

### Mulai pembukuan di tengah tahun (cut-over)

Tahun buku tetap **Januari–Desember**; tidak ada setting tahun fiskal. Bila
pembukuan nyata dimulai pada tanggal lain (mis. `2026-07-01`):

- Isi **tanggal mulai pembukuan** dan **Saldo Awal** aset/kewajiban per tanggal
  itu; selisih menjadi `3000 MODAL`. Saldo awal tidak boleh memuat akun
  PENDAPATAN/BEBAN.
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
  `(Rp ...)` untuk negatif.
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
