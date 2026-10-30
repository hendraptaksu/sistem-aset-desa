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
   per akun). Tidak ada tabel saldo, tidak ada laba tersimpan. **Tutup buku tidak membuat jurnal penutup**;
   jurnal penutup manual yang mencampur PENDAPATAN/BEBAN dengan EKUITAS ditolak, kecuali jurnal
   **SALDO_AWAL** dari wizard Saldo Awal. Akun legacy `3001`/`3002` hanya-baca: tidak dapat diposting dan
   tidak dihitung ulang dari tutup buku/surplus.
2. **Setiap jurnal seimbang**: minimal 2 baris, minimal satu sisi > 0 per baris, total debit = total kredit.
3. **Koreksi = jurnal balik (reversal) + alasan.** Tidak pernah edit/hapus jurnal yang sudah tersimpan.
4. **Semua laporan dihitung ulang dari jurnal setiap dibuka.** Boleh lambat, tidak boleh basi.
   Tidak ada cache angka turunan. Ini yang menjamin Neraca selalu balance.
5. **Akun kas/bank tidak boleh minus.** Kalau transaksi membuat minus → peringatan + konfirmasi + alasan
   (bukan blokir keras, karena kas bisa saja belum tercatat).
6. **Periode dikunci lewat tutup buku.** Koreksi di periode terkunci wajib alasan dan tercatat di audit.
7. **UI dua level**: form terpandu untuk transaksi harian (operator awam pun aman), mode **Jurnal Umum**
   untuk akuntan. Keduanya menghasilkan jurnal yang sama.
8. **POC = bebas merombak.** Tidak ada kewajiban kompatibilitas dengan data/skema lama; DB POC lama
   dibuang dan mulai dari nol. Backup/restore tetap dijaga karena menyangkut data pemakaian nyata nanti.
9. **Tetap offline**, satu file SQLite, tanpa server/cloud.
10. **Setiap jurnal punya nomor bukti dan jejak audit** (kapan dibuat, koreksi apa, alasannya apa).

## 4. Yang berubah

| Sebelum overhaul (v1.2.0) | Arah baru |
|---|---|
| `transaksi` (masuk/keluar + kategori) | `jurnal` + `jurnal_baris` (debit/kredit per akun) |
| Kategori = campuran akun kas & akun lawan | Semua sisi adalah **akun COA** ber-tipe |
| `PANJAR` kategori sistem tersembunyi | Akun aset **1040 Uang Panjar (Kas di Muka)** |
| `tutup_buku.laba` sumber angka Neraca | Laba dihitung dari jurnal; tutup buku hanya kunci + catatan |
| Hanya 1 bentuk input | Form terpandu + Jurnal Umum |
| Neraca dihitung ad-hoc | Neraca Saldo, Buku Besar, Laba Rugi, Neraca — semua dari jurnal |
| Tidak ada koreksi | Jurnal balik + audit |

Karena masih POC, tabel single-entry lama (`transaksi`, `panjar`, `panjar_item`) langsung dibuang saat
upgrade skema — **tidak ada migrasi data**. DB dev lama boleh dihapus; dev seed baru dibuat di atas jurnal v2.

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
- **Level 3 — Laporan.** Buku Besar per akun, Neraca Saldo, Laba Rugi, Neraca, Arus Kas, Realisasi
  Anggaran, Panjar. Setiap baris laporan bisa diklik → detail jurnal asal (drill-down).

## 7. Definisi "benar" yang akan diuji

1. Neraca Saldo selalu **selisih nol** (total debit = total kredit), kapan pun, setelah operasi apa pun.
2. Setiap saldo di Neraca bisa dijelaskan oleh Buku Besar akun tersebut.
3. Setiap laporan bisa ditelusuri ke jurnal + nomor bukti.
4. Koreksi tidak pernah menghapus sejarah.
5. Backup/restore tidak boleh kehilangan transaksi (VACUUM INTO + cek integritas).
6. Koreksi setelah tutup buku **tidak** membuat selisih (karena tidak ada angka turunan tersimpan).
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
| K3 | Aset tetap & penyusutan | **Dibuang** — terlalu rumit/membingungkan | Tidak ada aset tetap/penyusutan di Neraca. Modul Inventaris Aset tetap daftar barang non-akuntansi (opsional, boleh dihapus kapan saja) |
| K4 | Multi-user & enkripsi | **Tidak; PIN cukup** | Ticket multi-user & enkripsi dibatalkan |
| K5 | Nomor bukti | Ikut yang lazim | **`JU-2026-0001`** (JU = Jurnal Umum). `JP` dihindari karena ambigu (Jurnal Pembelian/Penjualan di perusahaan dagang). Alternatif: `BKM/BKK` untuk bukti kas masuk/keluar |
| K6 | Data lama | **Dibuang** — masih POC, belum ada production | Tidak ada kode migrasi; DB v2 mulai dari nol |

## 10. POC: mulai dari nol (tidak ada migrasi)

- Skema v2 membuat tabel baru; tabel single-entry lama dibuang saat upgrade versi.
- DB dev lama (`data/pura-dev.db`) dan file backup dev boleh dihapus kapan saja.
- `seed-dev` baru menghasilkan contoh jurnal yang seimbang (deterministik) untuk uji laporan.
- Backup/restore tetap aman karena nanti dipakai untuk data nyata: `VACUUM INTO`, validasi integritas,
  dan auto-backup sebelum restore.

## 11. Roadmap ringkas

- **P0 — Pondasi:** COA ber-tipe, skema jurnal, reset DB POC + seed baru, laporan inti (Buku Besar,
  Neraca Saldo, Laba Rugi, Neraca, Arus Kas), posting layer, reversal, tutup buku, backup/restore aman, audit.
- **P1 — Pengalaman pengguna:** form terpandu (operator awam), Jurnal Umum (akuntan pendamping),
  drill-down, export/print semua laporan, template cetak resmi, nomor bukti `JU`, pengaturan, dashboard.
- **P2 — Lanjutan:** anggaran vs realisasi, lampiran bukti, test integrasi, dokumentasi,
  import Excel massal. (Rekonsiliasi bank, aset tetap, & multi-user sudah dibatalkan.)

Detail per ticket (dengan checkbox dan bukti) ada di `docs/tickets-perbaikan.md`.

## 12. Peta feedback WhatsApp v1.2.0 → solusi di arah baru

| # | Feedback pengguna v1.2.0 | Solusi di rencana baru |
|---|---|---|
| 1 | "Menu edit kalau ada salah ketik/input apakah ada?" | **P0-6**: tombol **Koreksi** di daftar jurnal → sistem membuat jurnal balik + form **"Koreksi & isi ulang"** yang sudah terisi data lama, wajib alasan, tercatat audit. Jurnal asli tidak dihapus. |
| 2 | "Bagaimana dengan layout print?" | **P1-10** (export/print semua laporan) + **P1-16** (template cetak resmi & pratinjau: kop, periode, A4, nomor halaman, kolom muat, pratinjau sebelum cetak). |
| 3 | "Perpindahan kas dari LPD ke kas umum bendahara, sesama kas" | **P1-3 Form Pindah Dana**: dua baris jurnal (D Kas Bendahara / K LPD), total kas tidak berubah. Berlaku untuk semua pasangan dompet (LPD, bank, kas tunai). |
| 4 | "Pencatatan hutang bingung cari lawan; kalau pakai gedung/perbaikan gedung memengaruhi modal" | **P1-5/AKT-20 form Utang**: perbaikan gedung dibayar belakangan = D 5003 Beban Wewangunan / K 2060 Hutang Usaha → laba turun, utang usaha naik, **modal tidak berubah**. Pelunasan utang usaha = D 2060 / K Kas (arus Operasi); pinjaman tetap memakai 2050 dan arus Pendanaan. Modal hanya berubah lewat setoran/penarikan modal atau Saldo Awal. |
