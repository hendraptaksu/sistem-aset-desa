# Panduan Pengguna — Keuangan Pura Dalem Puri

**Versi aplikasi:** 2.0.0  
**Tanggal dokumen:** 2026-10-27  
**Untuk:** operator harian (pengurus/bendahara) dan akuntan pendamping

Panduan ini ditulis dengan bahasa sehari-hari. Istilah akuntansi hanya dipakai
di bagian yang memang untuk pemeriksaan. Semua angka laporan dihitung ulang dari
jurnal, jadi tidak ada saldo atau laba yang “disimpan mati”.

> Dokumen pendamping:
> - `docs/panduan-pemeriksaan.md` — untuk akuntan pendamping.
> - `docs/panduan-portable.md` — lokasi data installer vs portable dan cara pindah laptop.

---

## 1. Sebelum mulai

1. Buka aplikasi **Keuangan Pura Dalem Puri**.
2. Masukkan **PIN 6 digit**. Aplikasi selalu terkunci saat dibuka.
3. Bila PIN salah 5 kali, aplikasi menunggu 60 detik. Tunggu, jangan menutup
   paksa lewat Task Manager.
4. Bila lupa PIN, gunakan **kode darurat** yang tampil sekali saat PIN pertama
   dibuat dan sudah dicatat di dokumen fisik terpisah (bukan di folder laptop).
   Setelah masuk, buat PIN baru. Bila kode belum pernah diatur (instalasi lama),
   aplikasi menolak reset dan meminta mengaturnya lewat Pengaturan.

**Auto-kunci:** aplikasi mengunci sendiri setelah tidak dipakai (bawaan 30 menit,
bisa diubah di **Pengaturan → Auto-kunci saat idle**). Ini bukan error.

**Satu aplikasi saja:** buka aplikasi cukup sekali. Bila terasa “tidak terbuka”,
periksa taskbar — kemungkinan jendela lama hanya ter-minimize dan aplikasi
memfokuskannya kembali.

---

## 2. Alur harian (SOP singkat)

Prinsipnya: **catat saat kejadian**, lalu simpan bukti fisik di tempat aman.
Operator tidak perlu menghitung debit/kredit; sistem menyusun jurnalnya dan
menampilkan pratinjau sebelum menyimpan.

> **Peringatan wajib alasan.** Di form Transaksi, Jurnal Umum, Saldo Awal, dan
> Panjar, peringatan (mis. kas/bank akan minus, atau realisasi panjar melebihi
> panjar) hanya bisa dilanjutkan setelah menulis **alasan minimal 5 karakter**.
> Alasan tercatat di Riwayat Audit.

### 2.1 Terima Uang

Dipakai untuk uang masuk ke kas/bank: parkir, sesari, punia, kios, setoran modal,
dan sejenisnya.

1. Buka **Transaksi** → pilih kartu **Terima Uang**.
2. Isi **Tanggal**, **Kas/Bank tujuan**, **akun lawan** (pendapatan, atau
   `3000 MODAL` bila setoran modal), **Nominal**, dan **Keterangan**.
3. Periksa **pratinjau jurnal** di bawah form: sisi debit dan kredit harus sama.
4. Tekan **Simpan**. Nomor bukti dibuat otomatis dengan pola `JU-2026-0001`
   (boleh diubah, tetapi harus unik).
5. Bila muncul peringatan **kas akan minus**, baca dengan teliti. Bila memang
   benar (mis. kas belum tercatat), beri konfirmasi; bila salah, perbaiki dulu.

### 2.2 Bayar / Beban

Dipakai untuk belanja, biaya listrik/telepon, upakara, dan perbaikan. Form ini
hanya menawarkan **akun beban** sebagai akun lawan.

1. Buka **Transaksi** → **Bayar**.
2. Isi tanggal, **Kas/Bank sumber**, **akun lawan** (akun beban), nominal, dan
   keterangan.
3. Periksa pratinjau: beban di debit, kas di kredit.
4. Simpan.

**Penting:** form Bayar tidak menawarkan `1040 UANG PANJAR`,
`2050 HUTANG LAIN-LAIN`, maupun `2060 HUTANG USAHA`. Untuk panjar gunakan menu
**Buku Panjar**; untuk utang usaha gunakan kartu **Catat Utang** dan
**Bayar Utang**. Akun `1050 PIUTANG LAIN LAIN` hanya dipertahankan untuk data
lama dan tidak lagi punya form input piutang. Jurnal Umum tetap boleh memakai
akun tersebut untuk koreksi oleh akuntan pendamping.

### 2.3 Pindah Dana

Dipakai untuk memindahkan uang antar dompet kas/bank, misalnya **LPD → Kas
Bendahara**. Ini **bukan pendapatan dan bukan beban**: tidak ada akun 4xxx/5xxx
yang dipakai, tidak masuk Laba Rugi, dan total kas seluruh dompet tidak
berubah. Yang berubah hanya saldo masing-masing dompet.

1. Buka **Transaksi** → pilih kartu **Pindah Dana**.
2. Isi **Tanggal**, **Dari** (dompet asal), **Ke** (dompet tujuan), **Nominal**,
   dan **Keterangan**.
3. Asal dan tujuan harus dua dompet berbeda. Bila sama, tombol simpan tetap
   nonaktif dan aplikasi menampilkan peringatan.
4. Periksa pratinjau: **debit = dompet tujuan**, **kredit = dompet asal**.
   Kedua sisi harus sama besar.
5. Tekan **Simpan Pindah Dana**.

**Contoh konkret.** Tanggal 31 Oktober 2026 Bendahara memindahkan Rp 250.000
dari LPD `1014 LPD 12.005150/DL/2020` ke kas tunai `1001 KAS`.

| Isian | Nilai |
|---|---|
| Tanggal | 2026-10-31 |
| Dari | `1014 — LPD 12.005150/DL/2020` |
| Ke | `1001 — KAS` |
| Nominal | Rp 250.000 |
| Keterangan | Pindah kas LPD ke Kas Bendahara |

Pratinjau jurnal yang disimpan:

| Akun | Debit | Kredit |
|---|---:|---:|
| `1001 KAS` (tujuan) | Rp 250.000 | — |
| `1014 LPD 12.005150/DL/2020` (asal) | — | Rp 250.000 |
| **Total** | **Rp 250.000** | **Rp 250.000** |

Setelah disimpan: saldo `1014` berkurang Rp 250.000, saldo `1001` bertambah
Rp 250.000, dan **total kas tetap**. Jurnal ini berjenis **Transfer** di daftar
jurnal.

**Dompet baru.** Rekening bank/LPD yang ditambahkan lewat **Daftar Akun**
dengan penanda kas/bank (`is_kas = 1`) otomatis muncul di pilihan **Dari** dan
**Ke** Pindah Dana. Akun yang dinonaktifkan tidak muncul di form baru, tetapi
saldo historisnya tetap terbaca di laporan.

### 2.4 Panjar (uang muka kegiatan)

Panjar dicatat dua tahap: saat uang diserahkan, lalu saat
pertanggungjawabannya.

1. Buka menu **Buku Panjar** → **Serah Panjar**. Isi penerima, jumlah, kas
   sumber, tanggal, dan keterangan. Simpan. Jurnalnya: `1040 UANG PANJAR` di
   debit, kas di kredit.
2. Setelah kegiatan selesai, pilih panjar tersebut → **Pertanggungjawaban**.
3. Isi rincian belanja **per nota**: nomor nota, tanggal nota, toko/penerima,
   akun beban, nominal, dan keterangan baris. Gunakan **+ Tambah baris nota**
   bila satu pertanggungjawaban memuat beberapa nota. Dua nota dengan akun beban
   yang sama tetap disimpan sebagai dua baris rincian; jurnal close tetap
   menggabungkan debit per akun agar tidak ada baris jurnal ganda. Detail nota
   bisa dibuka lewat **Lihat rincian** di daftar panjar.
4. Nomor nota maksimal 100 karakter, toko/penerima maksimal 200 karakter, dan
   keterangan baris maksimal 500 karakter. Tanggal nota tidak boleh setelah
   tanggal realisasi. Bila nota fisik tidak ada, field nota boleh dikosongkan
   (perilaku lama tetap sah).
5. Bila ada sisa uang, isi pengembalian ke kas. Bila kurang, sistem meminta
   konfirmasi dengan alasan minimal 5 karakter.
6. Periksa pratinjau lalu simpan. Saldo `1040` harus kembali nol setelah semua
   panjar dipertanggungjawabkan.

**Membatalkan panjar OPEN (salah serah):** bila uang sudah diserahkan tetapi
panjar belum dipertanggungjawabkan, buka **Buku Panjar**, cari panjar berstatus
**Belum**, lalu klik **Batalkan**. Tulis alasan minimal 5 karakter dan konfirmasi.
Sistem membuat **jurnal balik** (kas sumber kembali di debit, `1040` di kredit),
menyimpan status **DIBATALKAN**, dan mencatat audit `PANJAR-BATAL`. Jurnal serah
asli tidak dihapus/diubah, dan panjar yang sudah dibatalkan tidak bisa
dipertanggungjawabkan atau dibatalkan ulang. Panjar yang sudah **Sudah**
(CLOSED) belum bisa dibatalkan lewat alur ini.

**Penting — koreksi panjar:** jurnal serah maupun pertanggungjawaban panjar
tidak bisa direversal dari **Jurnal Umum**. Sistem menolak agar status panjar
tidak basi (mis. panjar tetap CLOSED padahal `1040` sudah bersaldo lagi).
Gunakan modul **Buku Panjar**: **Batalkan** untuk panjar OPEN yang salah serah,
atau alur pertanggungjawaban untuk panjar yang benar-benar sudah dibelanjakan.

### 2.5 Utang Usaha

Tidak ada daftar pihak. Utang usaha non-LPD dicatat lewat dua form sederhana di
tab **Transaksi**. Nama kreditur (orang/toko/lembaga) cukup ditulis di
**Keterangan**; sistem tidak menyimpan daftar pihak.

| Form | Jurnal yang dibuat sistem |
|---|---|
| **Catat Utang Usaha** | Debit akun beban / Kredit `2060 HUTANG USAHA` |
| **Bayar Utang Usaha** | Debit `2060 HUTANG USAHA` / Kredit kas/bank |

**Catat Utang Usaha** dipakai untuk pembelian atau perbaikan yang dibayar
belakangan. Pilih akun beban (mis. `5003 BAGA WEWANGUNAN`), isi nominal, lalu
tulis nama kreditur di keterangan — misalnya “Perbaikan gedung — utang ke Toko
Bangunan Jaya”. Uang kas belum keluar dan modal `3000` tidak berubah.

**Bayar Utang Usaha** dipakai saat utang dilunasi. Pilih kas/bank sumber dan
tulis nama kreditur di keterangan — misalnya “Bayar utang bahan ke Toko
Bangunan Jaya”. Pembayaran `2060` masuk kelompok **Operasi** di laporan Arus
Kas.

Saldo `2060` dihitung dari jurnal dan bisa diperiksa di Buku Besar atau Neraca.
Tidak ada tabel saldo per pihak yang disimpan.

`2050 HUTANG LAIN-LAIN` adalah pinjaman atau saldo lama; pembayarannya masuk
kelompok **Pendanaan**. Pinjaman LPD memakai menu **Pinjaman LPD** tersendiri
(DB-16c), dan angsuran dibayar lewat tombol **Bayar Angsuran** di detail jadwal
(DB-16d). Jangan membuat pinjaman baru lewat Jurnal Umum kecuali untuk koreksi
oleh akuntan pendamping; saldo 2050 lama tetap terbaca di laporan.

### 2.5a Pinjaman LPD (jadwal dan pembayaran)

Pinjaman LPD dipisahkan dari **rencana** dan **realisasi**:

- **Jadwal angsuran** adalah rencana dari perjanjian LPD: nomor angsuran,
  jatuh tempo, pokok, dan bunga. Total pokok jadwal harus sama dengan sisa
  pokok saat pinjaman mulai diinput.
- **Jurnal adalah realisasi.** Pembayaran angsuran memakai jurnal:
  **D 2050 HUTANG LAIN-LAIN (pokok) + D 5063 BEBAN BUNGA PINJAMAN (bunga)
  + D beban denda bila ada / K kas/bank**. Jangan mencatat seluruh angsuran
  ke 2050; bunga harus masuk Laba Rugi dan pokok saja yang mengurangi utang.
- Sistem hanya menautkan jurnal pembayaran ke angsuran. Nominal pokok, bunga,
  dan denda **tidak disimpan ulang** di tabel pembayaran; semuanya dibaca dari
  baris jurnal agar tidak ada angka ganda.
- **Sisa pokok pinjaman** dihitung dari `sisa pokok awal - total pokok yang
  dibayar menurut jurnal`, bukan dari kolom saldo tersimpan. Status angsuran
  menjadi **LUNAS** setelah jurnal pembayaran ditautkan; satu angsuran tidak
  bisa dibayar dua kali.
- Jika pinjaman **sudah berjalan** sebelum aplikasi dipakai, isi sisa pokok
  dan jadwalnya tanpa membuat jurnal pencairan baru. Sisa pokok itu harus sudah
  masuk sebagai **kredit 2050 di Saldo Awal**. Membuat jurnal pencairan baru
  akan membuat kas dan utang menjadi dobel.

#### Langkah wizard Pinjaman LPD

Buka menu **Pinjaman LPD** (juga tersedia sebagai kartu di tab **Transaksi**),
lalu pilih salah satu mode:

1. **Pencairan baru** — isi tanggal pencairan, nama kreditur/LPD, pokok,
   akun kas/bank penerima, akun bunga (default `5063 BEBAN BUNGA PINJAMAN`),
   tenor, dan catatan. Saat disimpan, sistem membuat jurnal seimbang
   **D akun kas penerima / K 2050 HUTANG LAIN-LAIN** dengan keterangan yang
   memuat nama kreditur, lalu menyimpan pinjaman + jadwal secara atomik.
2. **Sudah berjalan** — isi kreditur, **sisa pokok saat ini**, tanggal mulai
   jadwal, akun bunga, tenor, dan catatan. Mode ini **tidak** membuat jurnal
   pencairan baru. Pastikan sisa pokok sudah tercatat sebagai kredit 2050 di
   **Saldo Awal**; jika belum, isi Saldo Awal lebih dulu agar 2050 tidak dobel.
3. **Jadwal angsuran** diisi manual per baris: nomor ke, jatuh tempo, pokok,
   bunga, dan catatan. Aplikasi tidak menghitung amortisasi sendiri. Total
   pokok semua baris wajib sama dengan pokok (mode pencairan) atau sisa pokok
   (mode berjalan); tanggal jatuh tempo tidak boleh mundur dan nomor ke tidak
   boleh ganda. Server menolak simpan bila aturan ini dilanggar.
4. Setelah tersimpan, pinjaman dan jadwal tampil di **Daftar Pinjaman LPD**.
   Tombol **Lihat jadwal** menampilkan rincian angsuran dan statusnya. Jurnal
   pencairan bisa dibuka lewat menu **Jurnal Umum**; pinjaman mode berjalan
   ditandai **Saldo awal** dan tidak memiliki jurnal pencairan.

#### Langkah membayar angsuran (DB-16d)

1. Buka **Lihat jadwal** pada pinjaman yang akan dibayar. Setiap angsuran yang
   belum lunas menampilkan tombol **Bayar Angsuran**; angsuran yang sudah
   dibayar ditandai **LUNAS** dan tidak bisa dibayar lagi.
2. Form menampilkan tanggal bayar, akun kas/bank aktif dari master akun,
   pokok, bunga, denda, dan catatan. Pokok serta bunga otomatis terisi dari
   jadwal; denda default 0.
3. Periksa total. Jurnal yang dibuat server selalu seimbang:
   **D 2050 HUTANG LAIN-LAIN sebesar pokok + D akun bunga pinjaman sebesar
   bunga + D 5050 BIAYA LAIN-LAIN sebesar denda / K akun kas/bank sebesar
   total**. Komponen boleh 0, tetapi total pembayaran harus lebih dari 0.
4. Bila pokok atau bunga yang dibayar **berbeda dari jadwal**, server menolak
   sekali dan meminta konfirmasi. Isi alasan minimal 5 karakter, lalu pilih
   **Ya, bayar dengan konfirmasi**. Jadwal **tidak diubah**; selisih hanya
   tercatat pada jurnal dan audit. Jika perlu, koreksi jadwal dilakukan lewat
   perjanjian/akuntan pendamping, bukan diam-diam saat pembayaran.
5. Setelah tersimpan, status angsuran menjadi **LUNAS**, outstanding pinjaman
   langsung dihitung ulang dari pengurangan pokok, dan jurnal pembayaran bisa
   dibuka lewat **Jurnal Umum**. Nominal pembayaran tetap dibaca dari baris
   jurnal dan **tidak disimpan ulang** di tabel pembayaran.

#### Kartu hutang / mutasi bulanan (DB-16e)

Bagian **Kartu Hutang / Mutasi Bulanan** di menu **Pinjaman LPD** menampilkan
mutasi pokok, bunga, denda, dan kas keluar setiap bulan. Pilih pinjaman, tahun,
dan bulan (kosongkan bulan untuk satu tahun penuh; default tahun berjalan).

- **Saldo awal** periode dihitung dari `sisa pokok awal - pokok jurnal yang
  tanggalnya sebelum periode`. **Saldo akhir** bulan = saldo awal − pokok bulan
  itu; saldo berantai bulan ke bulan dan berakhir sama dengan outstanding
  pinjaman.
- **Pokok** di laporan adalah penurunan akun `2050 HUTANG LAIN-LAIN`;
  **bunga** adalah beban akun bunga pinjaman; **denda** adalah beban denda; dan
  **kas keluar** adalah kredit kas/bank pada jurnal pembayaran yang tertaut.
- Tabel **Jadwal vs Realisasi** membandingkan pokok/bunga jadwal dengan nominal
  jurnal per angsuran. Selisih negatif berarti kurang bayar. Jadwal tidak
  diubah oleh realisasi.
- Tombol **Lihat jurnal** per bulan menampilkan nomor bukti, tanggal jurnal,
  tanggal link pembayaran, dan ID jurnal untuk drill-down. Semua angka dibaca
  dari baris jurnal; total bulanan/saldo **tidak disimpan** di tabel pembayaran.

#### Rekonsiliasi 2050 vs jadwal pinjaman (DB-16f)

Bagian **Rekonsiliasi 2050 vs Jadwal Pinjaman** di menu **Pinjaman LPD**
menampilkan status setiap pinjaman: **Cocok** atau **Selisih**, beserta
outstanding menurut jurnal **2050 HUTANG LAIN-LAIN**, outstanding menurut
jadwal, dan nominal selisihnya.

- Untuk pinjaman **pencairan baru**, outstanding GL dihitung dari kredit 2050
  pada jurnal pencairan dikurangi debit 2050 pada jurnal pembayaran yang
  tertaut. Untuk pinjaman **sudah berjalan**, saldo awalnya adalah sisa pokok
  awal yang sudah tercatat di **Saldo Awal 2050**.
- Outstanding jadwal dihitung dari sisa pokok awal dikurangi pokok aktual pada
  jurnal pembayaran yang tertaut. Bila jurnal pembayaran tidak memakai akun
  2050 (mis. pokok salah akun), selisihnya akan terlihat.
- Perbandingan **hanya memakai jurnal yang tertaut ke pinjaman itu**. Saldo
  2050 untuk utang non-LPD dan jurnal 2050 yang belum ditautkan tidak ikut
  dibandingkan; link pembayaran yang hilang tidak terdeteksi oleh pemeriksaan
  per pinjaman ini.
- Bila muncul **Selisih**, periksa jurnal pencairan, jurnal pembayaran (akun
  pokok dan link `pinjaman_bayar`), atau Saldo Awal 2050. Aplikasi
  **tidak mengoreksi otomatis** dan tidak menyediakan tombol koreksi di bagian
  ini. Koreksi data lama dilakukan lewat jurnal koreksi/reversal oleh akuntan
  pendamping. Pinjaman yang bersih tidak menampilkan peringatan.

**Piutang tidak dipakai lagi.** Client tidak meminta pencatatan piutang, jadi
tidak ada form/menu input piutang baru. Akun `1050 PIUTANG LAIN LAIN` tetap ada
di COA dan tetap terbaca di Buku Besar/Neraca/Arus Kas untuk data lama; jangan
membuat jurnal piutang baru. Jika ada saldo 1050 lama, koreksi hanya lewat
Jurnal Umum oleh akuntan pendamping.

**Penting:** perbaikan gedung yang dibayar belakangan **tidak menambah modal**.
Yang naik adalah beban (Laba Rugi) dan Utang Usaha `2060` (Neraca). Modal hanya
berubah lewat setoran/penarikan modal atau wizard Saldo Awal.

### 2.6 Jurnal Umum (untuk akuntan pendamping)

Menu **Jurnal Umum** dipakai bila transaksi tidak cocok dengan form terpandu,
atau untuk pemeriksaan. Di sini debit/kredit diisi manual:

> **Jenis jurnal di layar ini selalu `UMUM`.** Transaksi harian (Terima Uang,
> Bayar, Pindah Dana, Catat/Bayar Utang Usaha) harus lewat tab **Transaksi**;
> panjar lewat **Buku Panjar**; koreksi lewat tombol **Koreksi**; dan saldo awal
> lewat **Wizard Saldo Awal**. Aplikasi menolak jenis dokumen lain dari layar
> Jurnal Umum.

1. Pilih tanggal, isi keterangan dan nomor bukti (opsional; sistem menyarankan
   `JU-...`).
2. Tambah baris akun, isi debit **atau** kredit. Total debit dan kredit tampil
   langsung.
3. Tombol simpan hanya aktif bila total debit = total kredit.
4. Gunakan **Koreksi** untuk memperbaiki jurnal yang sudah tersimpan. Jangan
   pernah menghapus jurnal. Koreksi membuat jurnal balik + alasan, lalu
   menawarkan **Koreksi & isi ulang** dengan data lama sebagai awalan.

**Tanggal koreksi:** jurnal balik otomatis memakai **tanggal jurnal asli**, bukan
tanggal hari ini, supaya koreksi tidak memindahkan laba ke tahun yang salah.
Tanggal balik boleh diubah secara eksplisit, termasuk ke tahun berbeda; aplikasi
tidak memblokir, tetapi menampilkan peringatan kuning bila tanggal balik dan
tanggal pengganti jatuh di tahun berbeda. Baca peringatan itu sebelum melanjutkan.

### 2.7 Daftar Akun (tambah/ubah/nonaktifkan akun)

Menu **Daftar Akun** menampilkan seluruh COA yang dipakai aplikasi. Di sini
operator dapat mengelola akun **Beban**, **Pendapatan**, atau **Kas/Bank/LPD**
baru tanpa menunggu update aplikasi:

1. Buka **Daftar Akun**.
2. Isi **Kode akun** 4 digit yang belum dipakai:
   - Beban `5xxx`, mis. `5011`;
   - Pendapatan `4xxx`, mis. `4043`;
   - Kas/Bank/LPD baru wajib di rentang khusus **`1100`–`1199`**, mis. `1101`.
3. Pilih **Jenis akun**. Untuk **Aktiva** (kas/bank/LPD), pilih **Kelompok
   akun** (`Kas`, `Bank`, atau `LPD`) dan pastikan **Dompet kas/bank (is_kas)**
   tercentang. Akun kas/bank baru otomatis bersaldo normal **Debit**.
4. Isi **Nama akun**, lalu tekan **Tambah Akun**. Akun langsung muncul di form
   **Transaksi**, **Pindah Dana**, **Buku Panjar**, pembayaran, **Jurnal Umum**,
   dan laporan.
5. Setiap penambahan tercatat di **Riwayat Audit** dengan aksi **Tambah akun**.

Akun kas/bank/LPD baru langsung ikut dihitung di **total kas** dan muncul di
pilihan dompet. Kode `1100`–`1199` dicadangkan agar tidak bentrok dengan akun
client di `KODE AKUN.csv`. Jangan memakai kode itu untuk beban/pendapatan.

Enam akun hasil persetujuan 2026-10-30 sudah tersedia otomatis dan **tidak
menggantikan** akun lama:

- **5060 PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL)** — Beban. Akun lama
  **5010 BAGA SUAR (TELPON, LISTRIK, PDAM)** tetap aktif.
- **5061 PENGELUARAN ARTOS (UPACARA)** — Beban. Akun lama **5050 BIAYA
  LAIN-LAIN** tetap aktif.
- **5062 PENGELUARAN BANTEN RUTIN (HARIAN)** — Beban. Akun lama **5004 BAGA
  UPAKARA** tetap aktif.
- **5063 BEBAN BUNGA PINJAMAN** — Beban. Akun lama **5050 BIAYA LAIN-LAIN**
  tetap aktif. 5063 adalah akun bunga pinjaman LPD dan akan menjadi pilihan
  default akun bunga saat form pinjaman LPD tersedia; 5050 tetap untuk biaya
  lain-lain dan denda.
- **4060 PENDAPATAN WEWEDALAN (UPACARA)** — Pendapatan. Akun lama **4008
  PENDAPATAN PUNIA** dan **4041 PENDAPATAN SESARI** tetap aktif.
- **4006 PENDAPATAN PARKIR BPD (KHUSUS)** — Pendapatan. Akun lama **4005
  PENDAPATAN PARKIR** tetap aktif.

Pilih akun yang paling spesifik untuk transaksi baru. Jangan menonaktifkan akun
lama hanya karena akun baru tersedia; keduanya boleh dipakai sesuai kebutuhan.

Untuk akun yang sudah ada:

- **Ubah** — memperbaiki nama akun **tambahan**. Kode dan jenis akun tetap agar
  histori jurnal tidak berubah. Perubahan nama tercatat di audit.
- **Nonaktifkan** — akun tidak muncul lagi di form input baru, tetapi jurnal
  dan laporan lama tetap utuh. Akun bisa **diaktifkan kembali**. Sejak DB-15,
  akun **bawaan** juga boleh dinonaktifkan (mis. `5010` yang digantikan
  `5060`), tanpa mengubah namanya.
- **Hapus** — hanya untuk akun **tambahan** dan hanya berhasil bila akun belum
  pernah dipakai di jurnal atau panjar. Bila sudah dipakai, sistem menolak dan
  menyarankan **Nonaktifkan** agar histori tidak hilang.

Contoh: `5011 PENGELUARAN ARTOS` (Beban), `4043 PENDAPATAN WEWEDALAN`
(Pendapatan), atau `1101 BANK BPD REKENING BARU` (Kas/Bank, kelompok Bank).

Akun bawaan **tidak bisa diubah namanya atau dihapus**, tetapi status aktifnya
boleh diubah. Empat akun sistem tetap tidak bisa dinonaktifkan karena dibutuhkan
wizard/alur: **3000 MODAL** (penyeimbang Saldo Awal), **1040 UANG PANJAR**
(jurnal panjar), **1050 PIUTANG** (data lama yang masih dibaca laporan), dan
**2050 HUTANG LAIN-LAIN** (utang/pinjaman). Akun sistem ini ditandai **Sistem**
di tabel dan tidak menampilkan tombol Nonaktifkan.

Setiap perubahan status aktif/nonaktif dicatat di **Riwayat Audit** sebagai
**Nonaktifkan akun** atau **Aktifkan akun** beserta alasannya. Akun nonaktif
tetap tampil di jurnal, Buku Besar, Neraca Saldo, Laba Rugi, Neraca, dan Arus
Kas historis beserta saldonya; akun itu hanya hilang dari pilihan input baru.

Setiap akun menyimpan metadata **is_kas** (dompet kas/bank), **kelompok**
(`KAS`, `BANK`, `LPD`, `PANJAR`, `PIUTANG`, `HUTANG`, `EKUITAS`, `PENDAPATAN`,
`BEBAN`), dan **sumber** (`BAWAAN` dari CSV/COA atau `TAMBAHAN` buatan
operator). Akun `TAMBAHAN` tidak pernah ditimpa saat aplikasi membuka database
atau memperbarui COA bawaan.

---

## 3. Rutinitas mingguan dan bulanan

### Mingguan

- Buka **Dashboard**, periksa **Saldo Kas & Bank**, **Laba/Rugi tahun berjalan**,
  dan badge **Neraca Saldo: Seimbang**.
- Periksa **Jurnal Terakhir** dan **Backup Terakhir**.
- Lakukan **Backup Lengkap** ke flashdisk/Drive — ini jalur yang disarankan.
  **Backup Export .db** hanya untuk kebutuhan lanjutan (satu file database,
  tanpa manifest).

### Bulanan

1. Periksa laporan **Buku Besar** dan **Neraca Saldo** (akuntan pendamping).
   Di Neraca Saldo, pilih **Tahun berjalan** (default) untuk trial balance tahun
   buku saja, atau **Kumulatif sejak awal** untuk seluruh riwayat. Pada mode
   tahun berjalan, laba tahun sebelumnya diringkas pada baris
   **Laba ditahan sebelum periode** — baris ini bukan akun yang bisa diposting.
2. Periksa **Laba Rugi**, **Neraca**, dan **Arus Kas**.
3. Buat **Backup Lengkap** dalam satu folder bertanggal,
   misalnya `backup-2026-10-31`. Ini jalur utama; jangan mengandalkan satu file
   **Backup Export .db** kecuali diminta pendamping.
4. Catatan: **tutup buku hanya untuk tahun yang sudah selesai**, bukan tutup
   bulanan. Tidak ada tutup buku bulanan di aplikasi ini.

---

## 4. Tutup buku tahunan

Tutup buku adalah **penanda + kunci periode + catatan**, bukan menyimpan angka
laba. Laba dan laba ditahan selalu dihitung ulang dari jurnal.

Tutup buku **tidak membuat jurnal penutup** dan tidak memindahkan
pendapatan/beban ke modal. Jangan membuat jurnal penutup manual; aplikasi menolak
jurnal yang mencampur akun pendapatan/beban dengan ekuitas dalam satu jurnal
(kecuali jurnal **Saldo Awal** dari wizard).

1. Pastikan laporan tahun tersebut sudah diperiksa dan **Neraca Saldo seimbang**.
2. Buka menu **Tutup Buku**.
3. Isi **Tahun** yang akan ditutup. Hanya tahun yang sudah selesai yang boleh
   (mis. pada 2026 hanya sampai 2025). Tahun berjalan ditolak.
4. Tekan **Preview laba**, periksa laba dan laba ditahan.
5. Tekan **Backup otomatis & lanjut** — sistem membuat backup `.db` lebih dulu.
6. Isi catatan (opsional), lalu **Konfirmasi tutup buku**.

Setelah tutup buku, tanggal pada tahun tersebut terkunci. Koreksi masih boleh,
tetapi wajib memberi **alasan** dan tercatat di **Riwayat Audit**. Menutup ulang
tahun yang sama juga tercatat sebagai `TUTUP-ULANG`.

---

## 5. Backup, restore, dan ganti laptop

### 5.1 Apa yang harus dibackup

| Yang dibackup | Letaknya | Backup Lengkap (disarankan) | Backup Export `.db` (lanjutan) |
|---|---|---|---|
| Database | file `pura.db` | ya | ya — hanya database |
| Manifest | file `manifest.json` | ya | tidak ada |
| Backup otomatis | folder `backups` | bukan sumber data, hanya salinan | bukan sumber data, hanya salinan |

- **Backup otomatis harian:** aplikasi membuat satu file `auto-YYYY-MM-DD.db`
  di folder `backups` saat dibuka (dan saat aplikasi dibiarkan terbuka),
  menyimpan 7 file terakhir. Backup ini **sengaja berupa satu file database**
  karena aplikasi tidak lagi menyimpan file bukti terpisah; tidak ada folder
  lain yang perlu ikut disalin. Backup otomatis adalah jaring pemulihan cepat,
  **bukan pengganti Backup Lengkap**.
- **Backup Lengkap (disarankan):** **Dashboard → Backup Lengkap**, lalu pilih
  folder induk. Aplikasi membuat satu folder berisi `pura.db` dan
  `manifest.json`. Pakai cara ini untuk arsip jangka panjang, pindah laptop,
  atau sebelum perubahan besar.
- **Backup Export .db (lanjutan):** **Dashboard → Backup Export .db**, lalu
  pilih lokasi penyimpanan (flashdisk/Drive). File ini hanya berisi database
  dan **tidak punya manifest**. Gunakan hanya bila diminta pendamping.

Simpan backup dalam **satu folder bertanggal**. Backup **tidak terenkripsi**;
simpan di media yang aman dan pisahkan dari laptop.

### 5.2 Restore database

Ada dua pilihan di **Dashboard**:

- **Restore Lengkap (disarankan)** — pilih folder hasil **Backup Lengkap** yang
  berisi `manifest.json` dan `pura.db`. Manifest diperiksa lebih dulu, sehingga
  aplikasi tahu folder itu memang backup lengkap.
- **Restore Import .db (lanjutan/berisiko)** — memulihkan database dari satu
  file `.db`. Jalur ini **hanya memulihkan database**, **tidak memvalidasi
  manifest.json**, dan selalu meminta dua konfirmasi. Gunakan hanya bila folder
  Backup Lengkap tidak tersedia atau Anda diminta pendamping.

Langkah umum:

1. Tutup pekerjaan lain; jangan menutup aplikasi saat restore berjalan.
2. Buka **Dashboard** dan pilih **Restore Lengkap** (disarankan). Untuk file
   `.db`, pilih **Restore Import .db** dan baca peringatan lanjutannya.
3. Baca peringatan, lalu pilih folder backup lengkap atau file `.db`.
4. Sistem memvalidasi isi backup sebelum menyentuh data aktif: file SQLite
   terbaca, `integrity_check` lolos, tidak ada baris foreign key yatim, versi
   skema tidak lebih baru dari aplikasi, tabel wajib untuk versi backup tersedia,
   dan audit akuntansi tidak menemukan masalah. Restore Lengkap juga memeriksa
   `manifest.json`; Restore Import .db tidak. Setelah lolos, sistem membuat
   cadangan data lama (`pre-restore-<waktu>.db`) lalu mengganti data aktif.
5. Setelah selesai, periksa **Dashboard**, **Neraca Saldo**, dan beberapa jurnal.

### 5.3 Ganti laptop

**Cara paling aman (installer):**

1. Di laptop lama: buka **Dashboard → Backup Lengkap** dan simpan foldernya ke
   flashdisk/Drive.
2. Di laptop baru: pasang aplikasi, buat PIN, lalu
   **Dashboard → Restore Lengkap** dan pilih folder backup tadi.
3. Buka aplikasi dan periksa beberapa jurnal serta **Neraca Saldo**.

Bila terpaksa memakai **Backup Export .db**, ingat bahwa restore hanya
memulihkan database dari file tersebut: manifest tidak ada, tidak ada validasi
manifest, dan aplikasi meminta konfirmasi tambahan. Jalur **Backup Lengkap →
Restore Lengkap** tetap yang paling aman.

**Cara portable:** tutup aplikasi, lalu salin **seluruh folder portable**
(file `.exe`, `data`, `backups`) ke flashdisk/laptop baru. Jangan hanya
menyalin file `.exe`.

---

## 6. PIN dan auto-kunci

- PIN terdiri dari **6 digit**. Ganti di **Pengaturan → Kunci Aplikasi (PIN)**.
- PIN lama wajib benar saat mengganti PIN.
- **Kode darurat** dibuat acak per-install saat PIN pertama dibuat dan tampil
  **sekali** dalam modal “Simpan kode darurat ini”. Catat di kertas/dokumen
  fisik, simpan terpisah dari laptop, dan jangan kirim lewat chat. Database hanya
  menyimpan hash+salt — kode tidak bisa dibaca ulang dari aplikasi.
- Ganti kode darurat di **Pengaturan → Kode Darurat** (butuh PIN terbuka). Kode
  baru tampil sekali; kode lama langsung tidak berlaku. Instalasi lama yang
  belum punya kode akan diminta mengaturnya di sana.
- Auto-kunci diatur di **Pengaturan → Auto-kunci saat idle** (batas yang
  diizinkan ditampilkan di layar).
- Aplikasi selalu terkunci saat dibuka ulang. Ini disengaja.

> **Penting — PIN bukan enkripsi.** PIN hanya kunci akses aplikasi; isi
> `pura.db` tidak dienkripsi. Siapa pun yang memegang file `pura.db` atau
> backup-nya bisa membuka dan membaca data dengan alat SQLite biasa, tanpa PIN.
> Auto-kunci hanya menghalangi orang yang memakai aplikasi yang sedang terbuka,
> bukan orang yang menyalin file. Lindungi laptop dengan akun Windows dan
> enkripsi disk (mis. BitLocker), dan simpan media backup di tempat aman.

---

## 7. Arti pesan penting

| Pesan | Artinya | Yang harus dilakukan |
|---|---|---|
| **Kas akan minus** | Transaksi membuat saldo kas/bank di akun itu negatif (kas minus). | Periksa saldo awal dan tanggal. Bila memang benar (kas belum tercatat), isi alasan minimal 5 karakter lalu konfirmasi; bila ragu, jangan simpan. |
| **Periode sudah ditutup** | Tanggal transaksi berada di tahun yang sudah ditutup. | Bila koreksi memang perlu, isi **alasan** minimal 5 karakter. Koreksi tercatat di audit. |
| **Nomor bukti sudah dipakai** | Nomor `JU-...` sudah ada. | Ganti nomor atau kosongkan agar sistem membuat nomor berikutnya. |
| **Neraca Saldo: Selisih** | Ada jurnal yang tidak seimbang (seharusnya tidak terjadi). | Jangan tutup buku. Periksa Jurnal Umum dan hubungi pendamping. |
| **Aplikasi terkunci** | Sesi PIN habis karena idle. | Masukkan PIN kembali. |
| **Terlalu banyak salah** | PIN salah 5 kali. | Tunggu 60 detik, lalu coba lagi dengan hati-hati. |
| **Backup gagal** | Media penyimpanan penuh/tidak bisa ditulis. | Ganti lokasi simpan, pastikan flashdisk tidak dikunci, coba lagi. |
| **Database dibuat versi lebih baru** | File backup berasal dari aplikasi versi lebih baru. | Perbarui aplikasi di laptop ini, jangan memaksa restore. |
| **Tahun belum boleh ditutup** | Tutup buku hanya untuk tahun yang sudah selesai. | Tutup tahun lalu lebih dulu; tahun berjalan jangan ditutup. |

---

## 8. Cetak, pratinjau, dan PDF

Semua laporan memakai alur yang sama:

1. Buka laporan (mis. **Jurnal Umum**, **Buku Besar**, **Neraca Saldo**,
   **Laba Rugi**, **Neraca**, **Arus Kas**, atau **Buku Panjar**).
2. Atur periode/akun/cut-off.
3. Tekan **Pratinjau Cetak**. Periksa kop, periode, kolom, dan nomor halaman.
4. Tekan **Cetak** untuk printer, atau **Simpan PDF** untuk file PDF.
5. **Export Excel** tetap tersedia bila perlu diolah lagi.

Template sudah A4 dan otomatis memilih orientasi: portrait untuk laporan biasa,
landscape untuk Buku Besar. Header tabel diulang di halaman berikutnya. Tidak
perlu mengatur ukuran kertas manual.

---

## 9. Troubleshooting singkat

| Masalah | Solusi |
|---|---|
| Aplikasi seolah tidak terbuka saat diklik dua kali | Periksa taskbar. Aplikasi hanya boleh satu instance; jendela lama difokuskan. |
| Layar minta PIN terus | PIN salah/blokir sementara, atau auto-kunci terlalu pendek. Tunggu, lalu ubah idle di Pengaturan. |
| Laporan tidak berubah setelah input | Pastikan tanggal jurnal masuk rentang/cut-off laporan, lalu muat ulang laporan. |
| Angka kas berbeda dengan uang fisik | Periksa Buku Besar akun kas, cari jurnal yang salah, lalu gunakan **Koreksi** (bukan hapus). |
| Restore berhenti di tengah | Jangan tutup aplikasi. Tunggu; bila gagal, aplikasi otomatis memakai data lama dan menampilkan pesan. |
| Portable dipindah ke laptop lain tetapi data kosong | Yang disalin hanya `.exe`. Salin seluruh folder portable (`data`, `backups`). |
| Aplikasi portable tidak bisa menulis | Jangan taruh di folder read-only seperti `Program Files` atau folder jaringan. Pindahkan ke folder biasa, mis. `D:\Keuangan Pura`. |
| Komputer mati saat input | Buka aplikasi lagi; data yang sudah tersimpan ada di `pura.db`, data yang belum ditekan Simpan tidak tersimpan. |

Bila masalah tidak selesai: **jangan menghapus `pura.db`**. Backup dulu file
`.db`, lalu hubungi akuntan pendamping/pengembang.
