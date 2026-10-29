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
> - `docs/lampiran-bukti.md` — aturan foto/PDF bukti jurnal.

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

Prinsipnya: **catat saat kejadian**, lalu lampirkan bukti bila ada. Operator tidak
perlu menghitung debit/kredit; sistem menyusun jurnalnya dan menampilkan
pratinjau sebelum menyimpan.

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

**Penting:** form Bayar tidak menawarkan `1040 UANG PANJAR`, `1050 PIUTANG`,
`2050 HUTANG LAIN-LAIN`, maupun `2060 HUTANG USAHA`. Untuk panjar gunakan menu
**Buku Panjar**; untuk piutang/hutang gunakan menu **Piutang & Hutang**. Jurnal
Umum tetap boleh memakai akun tersebut untuk koreksi oleh akuntan pendamping.

### 2.3 Pindah Dana

Dipakai untuk memindahkan uang antar dompet kas/bank, misalnya **LPD → Kas
Bendahara**. Ini bukan pendapatan dan bukan beban.

1. Buka **Transaksi** → **Pindah Dana**.
2. Isi **Dari** (dompet asal), **Ke** (dompet tujuan), nominal, tanggal, dan
   keterangan.
3. Asal dan tujuan tidak boleh sama. Total kas tidak berubah, hanya pindah tempat.
4. Periksa pratinjau lalu simpan.

### 2.4 Panjar (uang muka kegiatan)

Panjar dicatat dua tahap: saat uang diserahkan, lalu saat
pertanggungjawabannya.

1. Buka menu **Buku Panjar** → **Serah Panjar**. Isi penerima, jumlah, kas
   sumber, tanggal, dan keterangan. Simpan. Jurnalnya: `1040 UANG PANJAR` di
   debit, kas di kredit.
2. Setelah kegiatan selesai, pilih panjar tersebut → **Pertanggungjawaban**.
3. Isi rincian belanja per akun beban. Bila ada sisa uang, isi pengembalian ke
   kas. Bila kurang, sistem meminta konfirmasi.
4. Periksa pratinjau lalu simpan. Saldo `1040` harus kembali nol setelah semua
   panjar dipertanggungjawabkan.

**Penting — koreksi panjar:** jurnal serah maupun pertanggungjawaban panjar
tidak bisa direversal dari **Jurnal Umum**. Sistem menolak agar status panjar
tidak basi (mis. panjar tetap CLOSED padahal `1040` sudah bersaldo lagi).
Koreksi panjar belum lewat Jurnal Umum; gunakan modul **Buku Panjar**. Alur
**Batalkan panjar** masih backlog dan belum tersedia di aplikasi.

### 2.5 Piutang & Hutang

Buka menu **Piutang & Hutang**. Form Bayar terpandu sengaja tidak menawarkan
akun `1050`/`2050`/`2060` agar setiap transaksi piutang/hutang memiliki pihak
yang jelas. Gunakan menu ini untuk semua alur berikut:

| Kejadian | Jurnal yang dibuat sistem |
|---|---|
| Memberi pinjaman | Debit `1050 PIUTANG` / Kredit kas |
| Menerima pelunasan piutang | Debit kas / Kredit `1050 PIUTANG` |
| Menerima pinjaman | Debit kas / Kredit `2050 HUTANG LAIN-LAIN` |
| Membayar pinjaman | Debit `2050 HUTANG LAIN-LAIN` / Kredit kas |
| Beli/perbaikan barang secara kredit | Debit akun beban / Kredit `2060 HUTANG USAHA` |
| Membayar utang usaha | Debit `2060 HUTANG USAHA` / Kredit kas |

`2050` dipakai untuk pinjaman dan saldo lama; pembayarannya masuk kelompok
**Pendanaan**. `2060` dipakai untuk utang usaha (pembelian/perbaikan kredit);
pembayarannya masuk kelompok **Operasi** di laporan Arus Kas. Saldo utang usaha
lama yang masih berada di `2050` tetap terbaca sebagai Pendanaan sampai
akuntan memindahkannya lewat jurnal reklasifikasi; aplikasi tidak pernah
memindahkan saldo lama secara otomatis.

Pihak (nama orang/lembaga) wajib dipilih untuk piutang dan hutang. Saldo per
pihak dihitung dari jurnal, bukan diketik manual.

**Penting:** perbaikan gedung yang dibayar belakangan **tidak menambah modal**.
Yang naik adalah beban (Laba Rugi) dan Utang Usaha `2060` (Neraca). Modal hanya
berubah lewat setoran/penarikan modal atau wizard Saldo Awal.

### 2.6 Jurnal Umum (untuk akuntan pendamping)

Menu **Jurnal Umum** dipakai bila transaksi tidak cocok dengan form terpandu,
atau untuk pemeriksaan. Di sini debit/kredit diisi manual:

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
Jika tanggal balik atau tanggal pengganti diubah sampai berbeda tahun, aplikasi
menampilkan peringatan kuning. Baca peringatan itu sebelum melanjutkan.

### 2.7 Lampiran bukti

Foto kuitansi/nota atau PDF ditempelkan per jurnal:

1. Buka **Jurnal Umum** → **Lihat** pada jurnal yang dituju.
2. Di bagian **Lampiran Bukti**, tekan **Unggah Lampiran**.
3. Pilih JPG/JPEG/PNG/WEBP/PDF, maksimal 10 MB per file.

Lampiran disimpan sebagai file di folder `attachments`, **bukan** di dalam file
database. Karena itu lampiran **tidak ikut backup `.db`** — lihat bagian 5.

### 2.8 Import Excel (migrasi data lama / banyak jurnal sekaligus)

Menu **Import Excel** dipakai bila data sudah ada di Excel dan ingin dimasukkan
sekaligus. Alurnya empat langkah:

1. **Unduh Template** → simpan file `.xlsx`. Di dalamnya ada sheet:
   - **Jurnal** — tabel yang diisi (contoh 3 grup sudah tersedia),
   - **Petunjuk** — cara pakai singkat,
   - **Akun** — daftar kode akun yang sah beserta nama dan tipenya.
2. **Isi file.** Satu **grup** = satu jurnal. Kolom sheet Jurnal:
   `grup`, `tanggal`, `no_bukti`, `keterangan`, `akun`, `debit`, `kredit`,
   `catatan`.
   - `tanggal` ditulis `YYYY-MM-DD` (mis. `2026-01-31`) atau `DD/MM/YYYY`
     (mis. `31/01/2026`). Tanggal yang tidak ada (31 Feb) ditolak.
   - `akun` berisi **kode akun**, bukan nama (mis. `1001`).
   - `debit` dan `kredit` berisi **angka rupiah** pada salah satu kolom saja,
     bukan sen dan tanpa tulisan `Rp`.
   - `tanggal`, `keterangan`, dan `no_bukti` boleh hanya diisi di baris pertama
     grup; baris berikutnya otomatis mengikuti.
   - Setiap grup minimal 2 baris dan **total debit harus sama dengan total
     kredit**. Grup yang tidak seimbang ditolak seluruhnya.
   - `no_bukti` opsional. Kosong = sistem membuat `JU-<tahun>-<urut>`.
3. **Pilih & Pratinjau** → pilih file `.xlsx`. Sistem menampilkan ringkasan dan
   hasil **per baris** (baris Excel, grup, tanggal, keterangan, akun, debit,
   kredit, status, alasan). Tahap ini **belum menyimpan apa pun**.
4. **Impor N Jurnal Valid** → konfirmasi. Hanya grup valid yang disimpan. Bila
   ada peringatan kas/bank minus, centang izin khusus setelah memeriksa saldo;
   tanpa centang, grup tersebut tidak diimpor. Setelah selesai, nomor bukti yang
   dibuat ditampilkan dan jurnal bisa dilihat di **Jurnal Umum**.

Bentuk sederhana juga didukung: satu baris Excel dengan kolom `tanggal`,
`keterangan`, `akun_debit`, `akun_kredit`, `nominal` menjadi satu jurnal dua
baris. Batas aman: file maksimal **10 MB** dan maksimal **5.000 baris** data.
Jurnal yang sudah diimpor tetap permanen; koreksi dilakukan lewat jurnal balik,
bukan edit/hapus.

### 2.9 Daftar Akun (tambah/ubah/nonaktifkan akun)

Menu **Daftar Akun** menampilkan seluruh COA yang dipakai aplikasi. Di sini
operator dapat mengelola akun **Beban** atau **Pendapatan** baru tanpa menunggu
update aplikasi:

1. Buka **Daftar Akun**.
2. Isi **Kode akun** 4 digit yang belum dipakai (Beban `5xxx`, Pendapatan
   `4xxx`), **Nama akun**, dan **Jenis akun**.
3. Tekan **Tambah Akun**. Akun langsung muncul di form **Transaksi**,
   **Jurnal Umum**, laporan, dan template **Import Excel**.
4. Setiap penambahan tercatat di **Riwayat Audit** dengan aksi **Tambah akun**.

Untuk akun tambahan yang sudah ada:

- **Ubah** — memperbaiki nama akun. Kode dan jenis akun tetap agar histori
  jurnal tidak berubah. Perubahan nama tercatat di audit.
- **Nonaktifkan** — akun tidak muncul lagi di form input baru, tetapi jurnal,
  anggaran, dan laporan lama tetap utuh. Akun bisa **diaktifkan kembali**.
- **Hapus** — hanya berhasil bila akun belum pernah dipakai di jurnal,
  anggaran, atau panjar. Bila sudah dipakai, sistem menolak dan menyarankan
  **Nonaktifkan** agar histori tidak hilang.

Contoh: `5011 PENGELUARAN ARTOS` (Beban) atau
`4043 PENDAPATAN WEWEDALAN` (Pendapatan). Akun bawaan tidak bisa diubah,
dinonaktifkan, atau dihapus dari layar ini; akun kas/bank baru juga belum bisa
ditambahkan lewat layar ini karena perlu penanda kas khusus.

---

## 3. Rutinitas mingguan dan bulanan

### Mingguan

- Buka **Dashboard**, periksa **Saldo Kas & Bank**, **Laba/Rugi tahun berjalan**,
  dan badge **Neraca Saldo: Seimbang**.
- Periksa **Jurnal Terakhir** dan **Backup Terakhir**.
- Lakukan **Backup Lengkap (DB + lampiran)** ke flashdisk/Drive. Alternatifnya:
  **Backup Export .db** lalu salin folder `attachments` ke media yang sama.

### Bulanan

1. Periksa laporan **Buku Besar** dan **Neraca Saldo** (akuntan pendamping).
   Di Neraca Saldo, pilih **Tahun berjalan** (default) untuk trial balance tahun
   buku saja, atau **Kumulatif sejak awal** untuk seluruh riwayat. Pada mode
   tahun berjalan, laba tahun sebelumnya diringkas pada baris
   **Laba ditahan sebelum periode** — baris ini bukan akun yang bisa diposting.
2. Bandingkan saldo bank di aplikasi dengan rekening koran lewat menu
   **Rekonsiliasi Bank**. Isi saldo menurut rekening koran; selisih dihitung
   sistem.
3. Periksa **Laba Rugi**, **Neraca**, dan **Arus Kas**.
4. Periksa **Anggaran** vs realisasi bila pagu tahunan sudah diisi.
5. Buat **Backup Lengkap** (DB + lampiran) dalam satu folder bertanggal,
   misalnya `backup-2026-10-31`. Bila memakai Backup Export `.db`, salin folder
   `attachments` secara terpisah ke folder yang sama.
6. Catatan: **tutup buku hanya untuk tahun yang sudah selesai**, bukan tutup
   bulanan. Tidak ada tutup buku bulanan di aplikasi ini.

---

## 4. Tutup buku tahunan

Tutup buku adalah **penanda + kunci periode + catatan**, bukan menyimpan angka
laba. Laba dan laba ditahan selalu dihitung ulang dari jurnal.

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

| Yang dibackup | Letaknya | Backup Export `.db` | Backup Lengkap |
|---|---|---|---|
| Database | file `pura.db` | ya — inilah file backup | ya |
| Lampiran bukti | folder `attachments` | **tidak** | ya |
| Backup otomatis | folder `backups` | bukan sumber data, hanya salinan | bukan sumber data |

- **Backup otomatis harian:** aplikasi membuat `auto-YYYY-MM-DD.db` di folder
  `backups` saat dibuka (dan saat aplikasi dibiarkan terbuka), menyimpan 7 file
  terakhir. Backup ini **hanya database**, tanpa lampiran.
- **Backup Export .db:** **Dashboard → Backup Export .db**, lalu pilih lokasi
  penyimpanan (flashdisk/Drive). Sebaiknya beri nama bertanggal. Ini juga
  **hanya database**.
- **Backup Lengkap (DB + lampiran):** **Dashboard → Backup Lengkap**, lalu pilih
  folder induk. Aplikasi membuat satu folder berisi `pura.db`, folder
  `attachments`, dan `manifest.json`. Pakai cara ini untuk arsip jangka panjang
  atau pindah laptop.
- **Backup lampiran manual:** buka **Pengaturan → Lokasi Data & Backup → Buka
  Folder** pada folder lampiran, lalu salin seluruh isinya.

Simpan `.db` dan folder lampiran dalam **satu folder backup bertanggal**. File
`.db` saja tidak cukup untuk memulihkan foto/PDF bukti. Backup **tidak
terenkripsi**; simpan di media yang aman dan pisahkan dari laptop.

### 5.2 Restore database dan lampiran

Ada dua pilihan di **Dashboard**:

- **Restore Lengkap (DB + lampiran)** — pilih folder hasil **Backup Lengkap**
  (yang berisi `manifest.json`). Database dan lampiran dipulihkan bersama.
- **Restore Import .db** — hanya memulihkan database dari satu file `.db`.
  Folder `attachments` tidak ikut berubah.

Langkah umum:

1. Tutup pekerjaan lain; jangan menutup aplikasi saat restore berjalan.
2. Buka **Dashboard**, pilih tombol restore yang sesuai.
3. Baca peringatan, lalu pilih file `.db` atau folder backup lengkap.
4. Sistem memvalidasi isi backup dan membuat cadangan data lama lebih dulu
   (`pre-restore-<waktu>.db`, dan untuk restore lengkap juga salinan lampiran
   lama), lalu mengganti data aktif.
5. Setelah selesai, periksa **Dashboard**, **Neraca Saldo**, dan beberapa
   lampiran.

Bila hanya memakai **Restore Import .db**, folder `attachments` harus disalin
kembali secara terpisah.

### 5.3 Ganti laptop

**Cara paling aman (installer):**

1. Di laptop lama: buka **Dashboard → Backup Lengkap** dan simpan foldernya ke
   flashdisk/Drive.
2. Di laptop baru: pasang aplikasi, buat PIN, lalu
   **Dashboard → Restore Lengkap** dan pilih folder backup tadi.
3. Buka aplikasi, periksa beberapa jurnal dan pastikan lampiran bisa dibuka.

Bila memakai **Backup Export .db**, restore hanya database; salin folder
`attachments` dari laptop lama ke folder lampiran laptop baru secara terpisah
(lokasi persis ada di `docs/panduan-portable.md` atau di
**Pengaturan → Lokasi Data & Backup**).

**Cara portable:** tutup aplikasi, lalu salin **seluruh folder portable**
(file `.exe`, `data`, `attachments`, `backups`) ke flashdisk/laptop baru. Jangan
hanya menyalin file `.exe`.

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
| **Kas akan minus** | Transaksi membuat saldo kas/bank di akun itu negatif (kas minus). | Periksa saldo awal dan tanggal. Bila memang benar (kas belum tercatat), konfirmasi; bila ragu, jangan simpan. |
| **Periode sudah ditutup** | Tanggal transaksi berada di tahun yang sudah ditutup. | Bila koreksi memang perlu, isi **alasan** minimal 5 karakter. Koreksi tercatat di audit. |
| **Nomor bukti sudah dipakai** | Nomor `JU-...` sudah ada. | Ganti nomor atau kosongkan agar sistem membuat nomor berikutnya. |
| **Neraca Saldo: Selisih** | Ada jurnal yang tidak seimbang (seharusnya tidak terjadi). | Jangan tutup buku. Periksa Jurnal Umum dan hubungi pendamping. |
| **Aplikasi terkunci** | Sesi PIN habis karena idle. | Masukkan PIN kembali. |
| **Terlalu banyak salah** | PIN salah 5 kali. | Tunggu 60 detik, lalu coba lagi dengan hati-hati. |
| **File lampiran tidak ditemukan** | Metadata ada, file fisik tidak ada di folder `attachments`. | Salin kembali folder lampiran dari backup, atau unggah ulang filenya. |
| **Backup gagal** | Media penyimpanan penuh/tidak bisa ditulis. | Ganti lokasi simpan, pastikan flashdisk tidak dikunci, coba lagi. |
| **Database dibuat versi lebih baru** | File backup berasal dari aplikasi versi lebih baru. | Perbarui aplikasi di laptop ini, jangan memaksa restore. |
| **Tahun belum boleh ditutup** | Tutup buku hanya untuk tahun yang sudah selesai. | Tutup tahun lalu lebih dulu; tahun berjalan jangan ditutup. |

---

## 8. Cetak, pratinjau, dan PDF

Semua laporan memakai alur yang sama:

1. Buka laporan (mis. **Jurnal Umum**, **Buku Besar**, **Neraca Saldo**,
   **Laba Rugi**, **Neraca**, **Arus Kas**, **Anggaran**, atau **Buku Panjar**).
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
| Lampiran tidak bisa dibuka | Pastikan folder `attachments` ada dan file tidak dipindah. Pulihkan dari backup lampiran. |
| Restore berhenti di tengah | Jangan tutup aplikasi. Tunggu; bila gagal, aplikasi otomatis memakai data lama dan menampilkan pesan. |
| Portable dipindah ke laptop lain tetapi data kosong | Yang disalin hanya `.exe`. Salin seluruh folder portable (`data`, `attachments`, `backups`). |
| Aplikasi portable tidak bisa menulis | Jangan taruh di folder read-only seperti `Program Files` atau folder jaringan. Pindahkan ke folder biasa, mis. `D:\Keuangan Pura`. |
| Komputer mati saat input | Buka aplikasi lagi; data yang sudah tersimpan ada di `pura.db`, data yang belum ditekan Simpan tidak tersimpan. |

Bila masalah tidak selesai: **jangan menghapus `pura.db`**. Backup dulu file
`.db` dan folder `attachments`, lalu hubungi akuntan pendamping/pengembang.
