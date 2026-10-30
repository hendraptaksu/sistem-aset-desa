# Panduan Lokasi Data & Paket Portable

**Versi aplikasi:** 2.0.0  
**Tanggal dokumen:** 2026-10-27  
**Untuk:** operator, akuntan pendamping, dan pengembang

Dokumen ini menjelaskan **lokasi persis** database, lampiran, dan backup untuk
dua paket Windows: **installer (NSIS)** dan **portable**. Lokasi yang sama juga
ditampilkan di aplikasi pada **Pengaturan → Lokasi Data & Backup**.

Aturan umum:

- Database selalu bernama **`pura.db`**.
- Lampiran bukti ada di folder **`attachments`** dan **tidak ikut** file backup
  `.db`.
- Backup otomatis/manual internal ada di folder **`backups`**.
- Nama folder aplikasi mengikuti `productName` di `package.json`, yaitu
  **Keuangan Pura Dalem Puri**.

> **PIN bukan enkripsi.** PIN hanya mengunci aplikasi, bukan file `pura.db`.
> Siapa pun yang memegang file database atau backup dapat membacanya dengan
> alat SQLite biasa. Simpan laptop dan media backup di tempat aman, dan gunakan
> enkripsi disk bila tersedia.

---

## 1. Versi installer (NSIS)

Installer memasang aplikasi per pengguna (bukan per mesin). Database, lampiran,
dan backup berada di folder data aplikasi Windows (`userData`):

| Isi | Lokasi |
|---|---|
| Folder data | `%APPDATA%\Keuangan Pura Dalem Puri\data` |
| Database | `%APPDATA%\Keuangan Pura Dalem Puri\data\pura.db` |
| Lampiran bukti | `%APPDATA%\Keuangan Pura Dalem Puri\attachments` |
| Backup | `%APPDATA%\Keuangan Pura Dalem Puri\data\backups` |

`%APPDATA%` biasanya `C:\Users\<nama pengguna>\AppData\Roaming`.

**Contoh konkret** untuk pengguna Windows bernama `Budi`:

- Folder data: `C:\Users\Budi\AppData\Roaming\Keuangan Pura Dalem Puri\data`
- Database: `C:\Users\Budi\AppData\Roaming\Keuangan Pura Dalem Puri\data\pura.db`
- Lampiran: `C:\Users\Budi\AppData\Roaming\Keuangan Pura Dalem Puri\attachments`
- Backup: `C:\Users\Budi\AppData\Roaming\Keuangan Pura Dalem Puri\data\backups`

Data installer **tidak** berada di folder `Program Files`. Menghapus/upgrade
aplikasi tidak menghapus folder `%APPDATA%` tersebut, tetapi tetap lakukan
backup rutin.

---

## 2. Versi portable

Build portable menetapkan environment `PORTABLE_EXECUTABLE_DIR` ke folder tempat
file `.exe` portable dijalankan. Aplikasi memakai folder itu sebagai rumah data,
sehingga seluruh data ikut pindah bila foldernya disalin:

| Isi | Lokasi |
|---|---|
| Folder data | `<folder exe>\data` |
| Database | `<folder exe>\data\pura.db` |
| Lampiran bukti | `<folder exe>\attachments` |
| Backup | `<folder exe>\backups` |

**Contoh konkret** bila file portable ada di `D:\Keuangan Pura Dalem Puri`:

- Folder data: `D:\Keuangan Pura Dalem Puri\data`
- Database: `D:\Keuangan Pura Dalem Puri\data\pura.db`
- Lampiran: `D:\Keuangan Pura Dalem Puri\attachments`
- Backup: `D:\Keuangan Pura Dalem Puri\backups`

Nama file portable mengikuti `artifactName` di `package.json`, misalnya
`Keuangan Pura Dalem Puri-2.0.0-portable.exe`.

### Hal penting tentang portable

- Taruh folder portable di lokasi yang **bisa ditulis**, misalnya
  `D:\Keuangan Pura Dalem Puri` atau flashdisk. Jangan di `Program Files`,
  folder Windows, atau folder jaringan yang read-only — aplikasi tidak akan bisa
  membuat `pura.db`, lampiran, atau backup.
- **Jangan menjalankan dua salinan portable dari folder berbeda.** Masing-masing
  folder memiliki `data\pura.db` sendiri, sehingga catatan akan terpisah dan
  membingungkan. Pilih satu folder induk dan pakai terus.
- Jangan menyalin hanya file `.exe`. Data ada di subfolder `data`,
  `attachments`, dan `backups`.
- Aplikasi hanya mengizinkan satu instance berjalan. Bila portable dijalankan
  dua kali, instance kedua keluar dan jendela pertama difokuskan — tetapi
  kebiasaan menyimpan dua salinan di folder berbeda tetap harus dihindari.

---

## 3. Pindah laptop atau flashdisk

### 3.1 Portable → laptop lain / USB

1. Tutup aplikasi sampai benar-benar keluar.
2. Salin **seluruh folder portable** (file `.exe` + `data` + `attachments` +
   `backups`) ke flashdisk/laptop baru.
3. Jalankan `.exe` dari folder hasil salinan.
4. Buka **Pengaturan → Lokasi Data & Backup** dan pastikan lokasinya menunjuk
   folder baru.
5. Periksa beberapa jurnal dan buka satu lampiran untuk memastikan file ikut.

Jangan menyalin folder saat aplikasi masih berjalan, karena database memakai
mode WAL (`pura.db-wal`/`pura.db-shm`). Menutup aplikasi lebih dulu membuat
seluruh transaksi tertulis ke `pura.db`.

### 3.2 Installer → laptop baru

1. Di laptop lama: **Dashboard → Backup Lengkap (DB + lampiran)**, simpan
   foldernya ke flashdisk.
2. Di laptop baru: pasang aplikasi installer, buat PIN, lalu
   **Dashboard → Restore Lengkap** dan pilih folder backup tadi.
3. Buka aplikasi, periksa jurnal dan lampiran.

Bila memakai **Backup Export .db**: simpan file `.db`, salin juga folder
`attachments` dari `%APPDATA%\Keuangan Pura Dalem Puri\attachments`, lalu di
laptop baru gunakan **Restore Import .db** dan salin folder lampiran secara
terpisah ke lokasi yang sama. Tanpa itu metadata lampiran akan menunjuk file
yang tidak ada.

### 3.3 Installer → portable (atau sebaliknya)

- Dari installer ke portable: backup `.db`, jalankan portable sekali agar folder
  `data`/`attachments`/`backups` terbentuk, tutup aplikasi, lalu tempatkan
  `pura.db` di `<folder exe>\data\pura.db` dan salin lampiran ke
  `<folder exe>\attachments`. Cara yang lebih aman: gunakan **Restore Import
  .db** dari dalam aplikasi portable.
- Dari portable ke installer: gunakan **Restore Import .db** di aplikasi
  installer, lalu salin folder `attachments` portable ke folder lampiran
  installer.
- Selalu backup dulu sebelum memindahkan file secara manual.

---

## 4. Backup yang benar

| Yang perlu disalin | Installer | Portable |
|---|---|---|
| Database | `%APPDATA%\Keuangan Pura Dalem Puri\data\pura.db` | `<folder exe>\data\pura.db` |
| Lampiran | `%APPDATA%\Keuangan Pura Dalem Puri\attachments` | `<folder exe>\attachments` |
| Backup internal (opsional) | `%APPDATA%\Keuangan Pura Dalem Puri\data\backups` | `<folder exe>\backups` |

- Backup otomatis harian menyimpan maksimal 7 file `auto-YYYY-MM-DD.db` di folder
  `backups`.
- Backup manual lewat **Dashboard → Backup Export .db** memakai `VACUUM INTO`,
  aman dilakukan saat aplikasi terbuka. Backup ini hanya berisi database.
- **Backup Lengkap** di Dashboard menghasilkan satu folder berisi `pura.db`,
  folder `attachments`, dan `manifest.json`; gunakan **Restore Lengkap** untuk
  memulihkan keduanya sekaligus.
- Simpan `.db` dan folder `attachments` dalam satu folder bertanggal, misalnya
  `backup-2026-10-23`.
- Jangan mengandalkan hanya folder `backups`: folder itu ada di laptop yang sama.
  Salin ke media lain (flashdisk/Drive).

---

## 5. Mode pengembangan (PURA_DB)

Hanya untuk pengembangan/pengujian. Bila environment `PURA_DB` diisi (mis.
`./data/pura-dev.db`), lokasi database mengikuti path tersebut dan menang atas
mode portable/installer. Pada mode ini:

- database ada di path `PURA_DB`;
- lampiran tetap di `<userData>\attachments`;
- backup ada di folder `backups` di samping database.

Operator produksi tidak perlu mengubah `PURA_DB`.

---

## 6. Memastikan lokasi yang dipakai

1. Buka **Pengaturan → Lokasi Data & Backup**.
2. Baca **Mode**:
   - **Portable** → data di folder exe, seperti tabel bagian 2.
   - **Installer** → data di `%APPDATA%\Keuangan Pura Dalem Puri`, seperti
     bagian 1.
   - **Pengembangan (PURA_DB)** → hanya untuk dev/test.
3. Tekan **Buka Folder** pada folder data, lampiran, atau backup untuk memeriksa
   isinya langsung di Windows Explorer.

Bila lokasi yang tampil tidak sesuai dugaan, **jangan memindahkan file secara
manual** sebelum membuat backup. Tanyakan pendamping/pengembang terlebih dahulu.
