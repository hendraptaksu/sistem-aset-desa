# Lampiran Bukti Jurnal (P2-4)

Lampiran bukti adalah foto kuitansi/nota atau PDF yang ditempelkan ke satu
jurnal. Lampiran **bukan bagian dari jurnal** dan tidak mengubah angka apa pun;
ia hanya alat bantu pemeriksaan.

## Lokasi penyimpanan

File lampiran disimpan sebagai file biasa di subfolder `attachments` di dalam
folder data aplikasi, bukan di dalam database.

| Sistem / paket | Lokasi folder lampiran |
|---|---|
| Windows installer | `%APPDATA%\Keuangan Pura Dalem Puri\attachments` |
| Windows portable | `<folder exe>\attachments` |
| macOS (dev) | `~/Library/Application Support/Keuangan Pura Dalem Puri/attachments` |
| Linux (dev) | `~/.config/Keuangan Pura Dalem Puri/attachments` |

Database ada di `<userData>\data\pura.db` untuk installer, atau
`<folder exe>\data\pura.db` untuk portable. Lokasi persis selalu bisa dilihat di
**Pengaturan → Lokasi Data & Backup**; rincian ada di `docs/panduan-portable.md`.
Di mode pengembangan, nama folder bisa berbeda (mengikuti nama project); gunakan
menu tersebut untuk memastikan.

Database hanya menyimpan **metadata**: nama asli, nama file simpan, jenis file,
ukuran, dan waktu unggah. Database tidak menyimpan path absolut dan tidak
menyimpan isi file.

## Format & ukuran

- Foto: **JPG/JPEG, PNG, WEBP**
- Dokumen: **PDF**
- Ukuran maksimal: **10 MB per file**
- Nama file asli tetap ditampilkan di aplikasi; file fisik memakai nama aman
  (`<id>.<ekstensi>`) agar tidak rawan path traversal.

## Cara unggah

1. Buka **Jurnal Umum** (atau laporan yang bisa di-drill-down: Buku Besar,
   Arus Kas, Laba Rugi, Rekonsiliasi Bank).
2. Klik **Lihat** pada jurnal yang dituju.
3. Di bagian **Lampiran Bukti**, klik **Unggah Lampiran**.
4. Pilih file JPG/JPEG/PNG/WEBP/PDF. Sistem menolak jenis file lain atau file
   lebih dari 10 MB dengan pesan berbahasa Indonesia.
5. Setelah tersimpan, nama file, ukuran, dan tanggal unggah muncul di daftar.

## Cara melihat & membuka

- **Lihat** (khusus gambar): menampilkan pratinjau di dalam aplikasi. Gambar
  lebih dari 5 MB tidak dipratinjau agar aplikasi tetap ringan; gunakan
  **Buka**.
- **Buka**: membuka file dengan aplikasi bawaan komputer (PDF viewer, penampil
  foto). Jalur file selalu divalidasi berada di dalam folder `attachments`.

## Cara menghapus

1. Klik **Hapus** di samping lampiran.
2. Konfirmasi pada dialog yang muncul.
3. Metadata dan file dihapus; jurnal **tidak** berubah. Penghapusan tercatat di
   riwayat audit dengan aksi `LAMPIRAN-HAPUS`.

## Penting: lampiran TIDAK ikut backup `.db`

Backup aplikasi (tombol **Backup** dan backup otomatis) hanya menyalin file
database `.db`. **File lampiran tidak ikut** di dalam backup tersebut.

Artinya:

- Memulihkan `.db` dari backup tidak memulihkan file lampiran.
- Menyalin aplikasi ke laptop lain hanya dengan `.db` akan kehilangan lampiran.
- Menghapus folder `attachments` membuat metadata lampiran menunjuk file yang
  sudah tidak ada.

**Saran:** salin folder `attachments` secara terpisah ke media cadangan
(flashdisk/Drive) dengan jadwal yang sama seperti backup `.db`, misalnya
setelah tutup bulan. Simpan juga file asli kuitansi di tempat aman; lampiran
digital hanyalah salinan pendukung.

## Catatan teknis

- Tabel metadata: `lampiran_jurnal` (skema v8), dengan relasi
  `jurnal_id → jurnal(id) ON DELETE CASCADE`.
- Audit: `LAMPIRAN-TAMBAH` dan `LAMPIRAN-HAPUS` hanya mencatat metadata, tidak
  pernah isi file/base64.
- Urutan unggah aman: file disalin dulu ke folder `attachments` (tulis `.tmp`
  lalu `rename`), baru metadata ditulis. Bila metadata gagal, file yang sudah
  tersalin dihapus lagi supaya tidak ada file yatim.
- Backup folder lampiran terpisah dibahas di `docs/panduan-pengguna.md` dan
  `docs/panduan-portable.md` (P2-8).
