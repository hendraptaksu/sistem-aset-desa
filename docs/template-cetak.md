# Template Cetak Resmi & Pratinjau

Dokumen ini menjadi acuan tata letak cetak laporan Pura Dalem Puri Peliatan.
Semua laporan memakai model dokumen yang sama (`src/features/export/printDoc.ts`)
dan adapter dari hasil laporan `src/core/reports.ts`; tidak ada angka yang
dihitung ulang di lapisan cetak.

## 1. Contoh dokumen resmi yang dijadikan acuan

Contoh berikut berasal dari kop yang sudah dipakai di kode export, bukan
contoh baru yang dikarang:

1. **Buku Besar / BKU**
   - Acuan di kode: `PURA DALEM PURI / BUKU BESAR / BULAN JANUARI S.D JUNI 2026`.
   - Implementasi aplikasi: `PURA DALEM PURI PELIATAN` / `BUKU BESAR — 1001 KAS` /
     `PERIODE 01-01-2026 s/d 30-06-2026`.
   - Asumsi: nama organisasi kanonis mengikuti `KOP_ORG_NAMA`
     (`PURA DALEM PURI PELIATAN`), dan periode ditulis sebagai rentang tanggal
     `DD-MM-YYYY` karena filter laporan memakai tanggal, bukan nama bulan.

2. **Neraca**
   - Acuan di kode: `PURA DALEM PURI PELIATAN / NERACA / PER 30 Juni 2026`.
   - Implementasi aplikasi: `PURA DALEM PURI PELIATAN` / `NERACA` /
     `PER 30-06-2026 — SEIMBANG` (atau `SELISIH`).
   - Asumsi: status seimbang/selisih ikut dicetak di subjudul agar pembaca
     langsung tahu kondisi Neraca.

3. **Laporan bulanan (Jurnal Umum, Laba Rugi, Arus Kas, Panjar)**
   - Acuan: kop organisasi + judul laporan + periode, seperti contoh
     `BUKU BESAR / BULAN ...` di atas.
   - Implementasi aplikasi: `PURA DALEM PURI PELIATAN` / `JURNAL UMUM` (atau
     `LABA RUGI`, `ARUS KAS`, `PANJAR (UANG MUKA)`) / `PERIODE ...`.
   - Untuk laporan per tanggal (Neraca Saldo/Neraca) dipakai `PER <tanggal>`.

Tidak ada logo, tanda tangan, atau stempel pada contoh kode yang ada. Karena
itu template ini **tidak mengarang** blok tanda tangan/logo. Bila kelak
dibutuhkan, tambahkan sebagai blok baru di model cetak.

## 2. Aturan tata letak

- **Kertas:** A4. Portrait untuk Jurnal Umum, Neraca Saldo, Laba Rugi, Neraca,
  Arus Kas, dan Panjar. **Landscape untuk Buku Besar** (kolom lebih banyak).
- **Halaman eksplisit:** satu `<div class="halaman">` per halaman, dengan
  ukuran A4 dan `page-break-after: always`. Nomor halaman dihitung dari
  jumlah halaman yang benar-benar dirender, bukan tebakan.
- **Kop:**
  - Halaman pertama: kop lengkap (nama organisasi, judul, periode/cut-off).
  - Halaman lanjutan: kop ringkas (nama organisasi + judul + periode) agar
    dokumen tetap terbaca saat halaman terpisah.
- **Footer tiap halaman:** `Tanggal cetak: DD-MM-YYYY` dan
  `Halaman X dari Y`.
- **Header tabel berulang:** setiap potongan tabel di halaman baru membawa
  `<thead>` yang sama. Footer/total tabel hanya muncul sekali di akhir tabel.
- **Baris tidak terbelah:** CSS memakai `page-break-inside: avoid` dan
  `break-inside: avoid` pada `tr`. Paginator memotong per baris utuh; tidak
  ada baris yang dibelah di tengah.
- **Kolom tidak terpotong:** `table-layout: fixed` + `<colgroup>` dengan lebar
  kolom yang dinormalisasi ke 100%. Teks panjang membungkus
  (`overflow-wrap: anywhere`), bukan memotong kolom.
- **Font:** body 10pt, tabel 8,5pt; tetap terbaca saat dicetak hitam-putih.
- **Nominal:** Rupiah memakai `formatRp`; negatif dalam kurung, mis.
  `(Rp 500.000,00)`. Angka asli tetap tersimpan sebagai SEN di properti
  `nilai` baris untuk pemeriksaan, bukan hasil parsing string.
- **Pagination deterministik:** parameter `barisPerHalaman` (default portrait
  30, landscape 22) menghitung baris data **dan** baris footer/total. Jumlah
  baris per halaman tidak berubah-ubah antar render.

## 3. Cara pratinjau dan Simpan PDF

1. Buka layar laporan (mis. Buku Besar), atur akun/periode.
2. Tekan **Pratinjau Cetak**. Modal besar menampilkan iframe `srcDoc` berisi
   dokumen cetak lengkap. Di modal tertulis info halaman dan orientasi.
3. Periksa kop, periode, kolom, dan nomor halaman.
4. Tekan **Cetak** untuk membuka dialog printer. Dialog **tidak** terbuka
   otomatis saat modal dibuka. Pemanggilan dilakukan dari React (parent) ke
   `iframe.contentWindow.print()`; dokumen cetak tidak memuat inline script
   (aman untuk CSP produksi).
5. Tekan **Simpan PDF** untuk menyimpan PDF. PDF memakai HTML paginator yang
   **sama** dengan pratinjau (`renderPrintDocument`), tanpa script/auto-print
   dan dengan orientasi yang sama. Jadi hasil PDF identik dengan pratinjau.
6. **Export Excel** tetap tersedia dan tidak berubah (XLSX numerik).

## 4. API untuk pengembang

- `PrintDoc`, `PrintBlock`, `PrintTable`, `PrintRow` — model dokumen murni.
- `paginatePrintDoc(doc, { barisPerHalaman })` — halaman eksplisit.
- `renderPrintDocument(doc)` → `{ html, jumlahHalaman, orientasi }`.
- `renderPrintHtml(doc)` — kontrak HTML lengkap.
- Adapter: `jurnalPrintDoc`, `bukuBesarPrintDoc`, `neracaSaldoPrintDoc`,
  `labaRugiPrintDoc`, `neracaPrintDoc`, `arusKasPrintDoc`, `panjarPrintDoc`,
  `jurnalDetailPrintDoc`.
- Komponen: `PratinjauCetakModal` (`judul`, `html`, `jumlahHalaman`,
  `orientasi`, `onClose`) dan `ExportActions` (`buatWorkbook`, `buatDokumen`).

## 5. Catatan untuk CSP dan SOP operator

- Dokumen cetak **tidak boleh** ditambahi `<script>` atau
  `onclick="window.print()"`. Semua aksi cetak berasal dari parent React.
- CSP renderer perlu mengizinkan iframe `srcDoc` dan style dokumen cetak.
  Jangan memblokir `frame-src` untuk dokumen internal ini.
- SOP operator dijelaskan di `docs/panduan-pengguna.md` §8: pilih
  periode → **Pratinjau Cetak** → periksa halaman → **Cetak** atau **Simpan
  PDF**. Tidak perlu mengatur orientation manual; sistem sudah memilih
  portrait/landscape per laporan.
