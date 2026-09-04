Dokumen **Product Requirement Document (PRD) / System Requirement Specification (SRS)** ini dirancang agar bisa langsung disalin (*copy-paste*) ke AI Coding Agent (seperti Cursor, Claude Code, Windsurf, atau GitHub Copilot).

---

# SYSTEM REQUIREMENT SPECIFICATION (SRS)

## Aplikasi Pembukuan Keuangan Desktop Pura Dalem Puri

### 1. OVERVIEW & OBJECTIVES

* **Project Name:** Desktop App Pengelolaan Keuangan & Aset Pura Dalem Puri Peliatan
* **Target User:** Pengurus/Bendahara Desa & Pura (non-akuntan).
* **Architecture Constraint:** Aplikasi Desktop Standalone (Offline-First, Tanpa Koneksi Internet / Cloud SaaS).
* **Primary Objective:** Sistem pembukuan tunggal berbasis *Single-Entry Input* yang secara otomatis merangkum data menjadi Buku Kas Umum, Buku Pembantu per Kategori, Buku Panjar, Laporan Realisasi Anggaran, dan Neraca Keuangan.

---

### 2. CHART OF ACCOUNTS (COA) / STRUKTUR KODE REKENING

Aplikasi harus mendukung pengelompokan akun sesuai struktur berikut:

* **1000 - AKTIVA (HARTA):**
* `1000` Kas Tunai
* `1010` LPD Kios
* `1014` LPD Utama
* `1015` LPD Parkir
* `1016` LPD Beji
* `1017` LPD Shuttle Bus
* `1018` LPD Toilet
* `1028` KSU Usaha Mandiri
* `1029` Bank BPD Ubud


* **2000 - PASIVA (KEWAJIBAN / UTANG):**
* `2050` Hutang Lain-Lain


* **3000 - EKUITAS (MODAL):**
* `3000` Modal / Saldo Awal
* `3001` Saldo Kumulatif
* `3002` Saldo Berjalan ($\text{Pendapatan} - \text{Pengeluaran}$ periode berjalan)


* **4000 - PENDAPATAN:**
* `4001` Pendapatan Parkir, `4002` Air Beji, `4003` Sewa Tanah, `4004` Sewa Toko/Kios, `4005` Wewedalan Krame, `4006` Sesari, `4007` Punia, `4008` Pendapatan Lain-lain.


* **5000 - PENGELUARAN / BEBAN (PER BAGA):**
* `5002` Baga Pamitegep (Rutin, Perlengkapan)
* `5003` Baga Wewangunan (Renovasi, Perbaikan)
* `5004` Baga Upakara / Piodalan (Banten, Sesari, Tetangunan, Kesenian)
* `5005` Baga Wahana (Transport, Melasti)
* `5006` Biaya Humas / Rapat / Besuk
* `5007` Biaya Operasional (Listrik, Wifi, ATK, Banner, Fotocopy)



---

### 3. CORE FUNCTIONAL MODULES

#### Modul 1: Buku Kas Umum (BKU) — Input Utama

* **Fungsi:** Form transaksi harian kas/bank.
* **Fields:**
* `Tanggal` (Datepicker)
* `Keterangan` (Text)
* `Kode Akun` (Dropdown COA)
* `Tipe Transaksi` (Radio: Uang Masuk / Uang Keluar)
* `Nominal` (Currency Input)


* **Rules:**
* Setiap transaksi di BKU otomatis memperbarui saldo kas/bank terkait.
* Menyediakan tabel view BKU lengkap dengan pagination, pencarian, dan filter rentang tanggal.



#### Modul 2: Buku Pembantu (Sub-Ledgers)

* **Fungsi:** Menampilkan rincian transaksi berdasarkan Kode Akun tertentu.
* **Logic:** Filter otomatis dari data BKU berdasarkan Kode Rekening (contoh: Menampilkan khusus transaksi `1010 LPD Kios` atau `5004 Baga Upakara`).
* **Output:** Tabel sub-ledger dengan kalkulasi Total Masuk, Total Keluar, dan Saldo Akhir Sub-Ledger.

#### Modul 3: Buku Panjar (Uang Muka Kerja)

* **Fungsi:** Mengelola pencatatan dana panjar piodalan/kegiatan.
* **Fields:** `Tanggal Panjar`, `Nama Penerima/Panitia`, `Jumlah Panjar`, `Status` (Open / Closed), `Realisasi Belanja`, `Sisa/Kurang`.
* **Logic:** Saat status di-close, selisih realisasi belanja dicatat otomatis ke BKU.

#### Modul 4: Laporan Arus Kas & Realisasi Anggaran

* **Fungsi:** Menampilkan rekapitulasi total penerimaan dan pengeluaran berdasarkan kategori.
* **Filter:** Rentang tanggal (`Tanggal Mulai` s/d `Tanggal Selesai`).
* **Structure:**
* Grouping Total Pendapatan per jenis (Parkir, Beji, Kios, Punia, dll).
* Grouping Total Pengeluaran per Baga (Pamitegep, Upakara, Wewangunan, dll).
* Net Total: $\text{Total Pendapatan} - \text{Total Pengeluaran}$.



#### Modul 5: Neraca Keuangan (Balance Sheet)

* **Fungsi:** Potret akumulasi keuangan pada tanggal tertentu (`Cut-off Date`).
* **Equation:**

$$\text{Total Aktiva} = \text{Total Pasiva}$$


* **Calculation Logic:**
* **Sisi Aktiva:** $SUM(\text{Saldo Kas}) + SUM(\text{Saldo LPD}) + SUM(\text{Saldo Bank})$.
* **Sisi Pasiva:** $SUM(\text{Utang}) + \text{Modal Awal (3000)} + \text{Saldo Kumulatif (3001)} + \text{Saldo Berjalan (3002)}$.
* **Formula Saldo Berjalan (3002):** Total Pendapatan Periode Ini - Total Pengeluaran Periode Ini.


* **Validation:** Tampilkan status "BALANCE" jika $\text{Aktiva} - \text{Pasiva} = 0$.

---

### 4. NON-FUNCTIONAL & TECHNICAL REQUIREMENTS

* **Database & Storage:** SQLite (Local File Storage). Seluruh data tersimpan dalam satu file `.db` lokal di komputer pengurus.
* **Backup & Migration:**
* Fitur **Export File Database (`.db`)** untuk pencadangan manual.
* Fitur **Import File Database (`.db`)** untuk pemulihan data saat ganti laptop/pengurus.
* Fitur **Export All Reports to Excel (.xlsx)** dan **Print/Save to PDF**.


* **Formatting Rules:**
* Semua angka mata uang diformat ke Rupiah (`Rp X.XXX.XXX`).
* Angka bernilai negatif/minus (seperti defisit Saldo Berjalan) **HARUS** ditampilkan dengan format kurung `(Rp 100.000,00)`.


* **UX/UI Guidelines:**
* Tampilan sederhana, bersih, dan berukuran font jelas.
* Menyediakan dashboard summary yang menampilkan Saldo Kas Tunai Saat Ini, Total Saldo LPD, dan Status Balance Neraca.
