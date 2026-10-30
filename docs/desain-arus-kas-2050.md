# Desain Pemisahan Arus Kas: Utang Usaha vs Pinjaman (2050)

> **Catatan status (DB-23b, 2026-10-30):** dokumen ini adalah arsip keputusan
> desain AKT-19/AKT-20. Master Pihak, UI subledger, dan penulisan
> `jurnal_pihak` sudah **dihapus** pada DB-23b; form utang usaha sekarang
> memakai akun 2060 + nama kreditur di keterangan. Bagian dokumen yang menyebut
> menu/form Pihak atau pemetaan pihak hanya berlaku untuk data lama dan tidak
> lagi menjadi rencana implementasi aktif.

> **Tiket:** AKT-19 (P1) · **Tanggal:** 2026-10-29
> **Sifat:** dokumen keputusan desain. Tidak ada kode produksi, data, atau jurnal
> lama yang diubah pada tiket ini.
> **Pelaksana:** AKT-20.
> **Baseline verifikasi:** `npm run typecheck` bersih; `npm test` 687/687 hijau
> (56 file) sebelum dan sesudah dokumen ini dibuat.

---

## 0. Ringkasan keputusan

**Rekomendasi: Opsi A (akun COA baru), varian A′ — tambah akun `2060 HUTANG
USAHA`, sementara `2050 HUTANG LAIN-LAIN` dipertahankan apa adanya sebagai akun
pinjaman/legacy yang tetap masuk kelompok PENDANAAN.**

| Hal | Keputusan |
|---|---|
| Akun utang usaha | **2060 HUTANG USAHA** (KEWAJIBAN, saldo normal KREDIT) |
| Akun pinjaman | **2050 HUTANG LAIN-LAIN** (tetap seperti sekarang) |
| Arus kas bayar utang usaha | **OPERASI** (D 2060 / K kas) |
| Arus kas terima/bayar pinjaman | **PENDANAAN** (D kas / K 2050; D 2050 / K kas) |
| Beli/perbaikan kredit | D beban / K **2060** (tidak ada arus kas sampai dibayar) |
| Jurnal lama | **Tidak diedit, tidak dihapus, tidak direklasifikasi otomatis** |
| Reklasifikasi saldo 2050 lama | Opsional, per pihak, lewat jurnal reklasifikasi baru yang diaudit: D 2050 / K 2060 |
| Skema | Tanpa tabel/kolom baru; `SCHEMA_VERSION` naik ke 10 sebagai penanda kontrak COA dan pencegahan downgrade backup |
| Backup/restore | Backup v9 tetap bisa direstore; backup v10 ditolak aplikasi v9 |

Alasan singkat: opsi ini membuat transaksi **baru** langsung benar, tidak
mengubah klasifikasi laporan periode lama, dan tetap membuat akun jurnal
sebagai satu-satunya sumber angka. Kerugiannya hanya pada saldo utang usaha
lama yang masih berada di 2050: pembayarannya tetap PENDANAAN sampai operator
memindahkannya lewat jurnal reklasifikasi. Kerugian itu **sudah ada hari ini**
dan tidak bertambah buruk.

> Catatan istilah: dokumen ini memakai “utang usaha” untuk kewajiban atas
> pembelian/perbaikan barang/jasa yang dibayar belakangan, dan “pinjaman” untuk
> uang yang dipinjam dari pihak lain. Keduanya adalah KEWAJIBAN, tetapi arus
> kasnya berbeda menurut PSAK/kerangka konseptual: pembayaran utang usaha adalah
> arus operasi; penerimaan/pelunasan pokok pinjaman adalah arus pendanaan.

---

## 1. Fakta implementasi saat ini

| Area | Fakta di kode | Konsekuensi |
|---|---|---|
| COA | `src/db/coa.ts:35` menetapkan `AKUN_HUTANG = '2050'`; `COA` hanya punya satu akun kewajiban, `2050 HUTANG LAIN-LAIN` (`src/db/coa.ts:86`). `KODE AKUN.csv` resmi juga hanya punya 2050. | Tidak ada pemisahan akun untuk dua jenis utang. |
| Arus kas | `src/core/reports.ts:851-862`: lawan tipe `PENDAPATAN`/`BEBAN`/`1040` → OPERASI; `KEWAJIBAN`/`EKUITAS` → PENDANAAN; `AKTIVA`/`1050` → INVESTASI. | Semua mutasi kas yang lawannya 2050 menjadi PENDANAAN, baik pembayaran utang usaha maupun pinjaman. |
| Form Pihak | `src/core/forms.ts:311-352`: `TERIMA_PINJAMAN` (D kas / K 2050), `BAYAR_HUTANG` (D 2050 / K kas), `BELI_KREDIT` (D beban / K 2050). `src/core/pihak.ts:82-96` mengklasifikasi lima alur baku. | Satu akun dipakai untuk tiga alur berbeda; `BAYAR_HUTANG` tidak membedakan pembayaran utang usaha dan pinjaman. |
| Skema jurnal | `src/db/database.ts:52-80`: tabel `jurnal` (jenis, grup_id, reversal_of) dan `jurnal_baris` (akun, debit, kredit). Tidak ada kolom kategori arus kas. | Klasifikasi arus kas sepenuhnya diturunkan dari akun lawan. |
| Metadata pihak | `src/db/database.ts:95-106`: `jurnal_pihak (jurnal_id, pihak_id, akun_kode)` hanya penghubung; tidak menyimpan alur/jenis utang. `src/db/pihak.ts:429-431` mengisi satu baris pemetaan. | Riwayat per pihak tidak bisa membedakan utang usaha vs pinjaman karena akunnya sama. |
| Imutabilitas jurnal | `src/db/database.ts:305-327`: trigger `trg_jurnal_immutable_update/delete` dan `trg_jurnal_baris_immutable_update/delete` menolak perubahan/penghapusan jurnal. | Opsi metadata yang menempel pada `jurnal` tidak bisa diisi belakangan untuk data lama tanpa melewati/mengubah trigger. |
| Validasi jenis | `src/core/posting.ts:254-255`: jenis `HUTANG` wajib memakai akun 2050. | Penambahan akun 2060 harus disertai perubahan validasi jenis. |
| Seed COA | `src/db/database.ts:368-381`: setiap `openDb` melakukan upsert `COA` ke tabel `akun`; akun tambahan operator tidak dihapus. | Akun statis baru otomatis tersedia di DB lama saat aplikasi dibuka. Tidak perlu `INSERT` manual atau migrasi tabel. |
| Backup/restore | `src/features/export/backupLengkap.ts` menulis `schemaVersion`; `src/features/export/restoreLengkap.ts:188` dan `src/features/export/export.ts:196-201` menolak backup dengan versi lebih tinggi dari aplikasi. `SCHEMA_VERSION` saat ini 9 (`src/db/database.ts:32`). | Backup v9 harus tetap bisa direstore ke aplikasi v10; backup v10 tidak boleh dibuka aplikasi v9. |
| Data lama | 2050 sudah mungkin berisi campuran utang usaha dan pinjaman. Audit log menyimpan aksi/alur (`HUTANG-BELI-KREDIT`, `HUTANG-BAYAR`, `HUTANG-TERIMA-PINJAMAN`) tetapi `HUTANG-BAYAR` tidak membedakan pembayaran utang usaha dan pinjaman. | Tidak ada cara deterministik untuk memisahkan saldo 2050 lama secara otomatis. Reklasifikasi massal otomatis akan salah. |

Catatan penting: `jurnal_pihak` **bukan** sumber saldo. Saldo per pihak selalu
dihitung dari baris jurnal 1050/2050 (`src/core/pihak.ts:1-7`). Prinsip yang
sama harus dipertahankan pada desain ini: tidak ada saldo baru yang disimpan.

---

## 2. Kriteria desain

1. **Benar secara akuntansi:** pembayaran utang usaha = OPERASI; pokok pinjaman
   = PENDANAAN; tidak mengubah total kas, neraca, atau laba.
2. **Jurnal satu-satunya sumber angka:** klasifikasi tidak boleh bergantung pada
   angka yang diketik terpisah atau tabel saldo baru.
3. **Tidak mengedit/menghapus jurnal lama:** koreksi hanya lewat jurnal baru.
4. **Data lama aman:** 2050 yang sudah dipakai tidak boleh berubah arti secara
   diam-diam; laporan periode lama tidak berubah tanpa keputusan eksplisit.
5. **Backup/restore kompatibel:** backup lama tetap bisa dibuka; backup baru
   tidak dibuka aplikasi lama yang belum memahami akun baru.
6. **Operator awam tetap bisa memakai form terpandu:** pilihan jenis utang harus
   jelas, bukan istilah akuntansi yang membingungkan.
7. **Dampak kode terukur:** perubahan sekecil mungkin, dengan test regresi untuk
   semua jalur yang menyentuh 2050/2060.

---

## 3. Opsi yang dibandingkan

### Opsi A — Akun COA baru, arah sesuai usulan tiket

**Inti:** `2050` menjadi akun **utang usaha**; akun baru `2060` (misalnya
`HUTANG PINJAMAN`) menjadi akun **pinjaman**. `arusKas` mengklasifikasi 2050
sebagai OPERASI dan 2060 sebagai PENDANAAN (karena 2060 tetap KEWAJIBAN, cukup
special-case 2050).

| Dimensi | Dampak |
|---|---|
| **Kelebihan** | Pemisahan akun paling tegas; neraca langsung memisahkan utang usaha dan pinjaman; klasifikasi arus kas diturunkan dari akun, bukan metadata; tidak perlu join tambahan di laporan. |
| **Kekurangan** | Mengubah arti 2050 yang sudah dipakai. Semua jurnal 2050 lama—termasuk yang sebenarnya pinjaman—akan berubah kelompok menjadi OPERASI secara retroaktif. Karena jurnal tidak boleh diedit, perubahan laporan historis ini tidak bisa dikoreksi dengan jurnal reklasifikasi saldo. |
| **Dampak arus kas** | Pembayaran utang usaha baru (2050) → OPERASI. Penerimaan/pembayaran pinjaman baru (2060) → PENDANAAN. Tetapi seluruh arus kas 2050 lama ikut menjadi OPERASI, termasuk pelunasan pinjaman lama. |
| **Dampak neraca** | Dua baris kewajiban: 2050 utang usaha dan 2060 pinjaman. Total kewajiban tidak berubah; neraca tetap balance karena hanya pemisahan baris. |
| **Kompleksitas form** | Sedang. `BAYAR_HUTANG` harus dipecah atau diberi pilihan akun; `BELI_KREDIT` tetap 2050; `TERIMA_PINJAMAN` pindah ke 2060. |
| **Migrasi data 2050 lama** | Berat dan berisiko. Saldo pinjaman lama harus direklasifikasi 2050 → 2060, tetapi saldo utang usaha lama juga ada di 2050. Tanpa pemisahan per transaksi, operator harus menebak. Arus kas historis tetap berubah karena baris 2050 lama sudah terlanjur dibaca sebagai OPERASI. |
| **Backup/restore** | Backup v9 bisa direstore; saat dibuka, 2060 di-seed. Backup v10 harus ditolak aplikasi v9 (naikkan `SCHEMA_VERSION`). Tidak ada kolom baru, jadi restore tidak membutuhkan DDL tambahan. |
| **Kebutuhan skema** | Tidak ada tabel/kolom baru. Cukup tambah akun statis + seed saat `openDb` + naikkan versi skema sebagai penanda kontrak. |

**Contoh jurnal:**

```
Beli kredit:        D 5003 Beban Wewangunan     1.000.000
                    K 2050 Hutang Usaha         1.000.000

Bayar utang usaha:  D 2050 Hutang Usaha           600.000
                    K 1001 Kas                    600.000   → OPERASI

Terima pinjaman:    D 1029 Bank                 2.000.000
                    K 2060 Hutang Pinjaman      2.000.000   → PENDANAAN

Bayar pinjaman:     D 2060 Hutang Pinjaman        500.000
                    K 1029 Bank                   500.000   → PENDANAAN
```

**Masalah utama:** pada data lama, 2050 berisi dua hal. Setelah 2050 diubah
menjadi “utang usaha”, laporan arus kas periode lalu mengklaim semua pembayaran
2050 sebagai operasi, padahal sebagian adalah pinjaman. Ini adalah restatement
retroaktif tanpa jurnal koreksi—bertentangan dengan prinsip “jangan mengubah
jurnal lama” dan berisiko bagi pemeriksa.

### Opsi A′ — Akun COA baru, arah dipertahankan (REKOMENDASI)

**Inti:** tambah `2060 HUTANG USAHA`; `2050 HUTANG LAIN-LAIN` tetap menjadi akun
lama untuk **pinjaman dan saldo legacy**, tetap PENDANAAN. Utang usaha **baru**
memakai 2060 dan pembayarannya OPERASI.

| Dimensi | Dampak |
|---|---|
| **Kelebihan** | Tidak ada jurnal lama yang berubah arti; laporan periode lama stabil. Klasifikasi tetap diturunkan dari akun (deterministik, tanpa metadata). Perubahan kode paling kecil: alur pinjaman yang sudah ada tetap memakai 2050; hanya `BELI_KREDIT` pindah ke 2060 dan ditambah satu alur `BAYAR_UTANG_USAHA`. |
| **Kekurangan** | Nama `2050 HUTANG LAIN-LAIN` tetap generik; operator harus tahu bahwa 2060 adalah utang usaha. Saldo utang usaha lama yang masih di 2050 tetap PENDANAAN sampai direklasifikasi. Neraca menampilkan dua baris kewajiban yang harus dijelaskan di panduan. |
| **Dampak arus kas** | `2060` → OPERASI (pembayaran utang usaha). `2050` tetap PENDANAAN (terima/bayar pinjaman). Pembayaran utang usaha lama yang belum direklasifikasi tetap PENDANAAN—sama seperti kondisi hari ini, bukan regresi baru. |
| **Dampak neraca** | Dua baris kewajiban: `2050 HUTANG LAIN-LAIN` (pinjaman/legacy) dan `2060 HUTANG USAHA`. Total kewajiban, total aset, dan ekuitas tidak berubah. Tidak ada saldo tersimpan. |
| **Kompleksitas form** | Sedang. Tambah satu kartu/alur `Bayar Utang Usaha`; `Beli Kredit` memakai 2060; `Terima Pinjaman` dan `Bayar Pinjaman` tetap 2050. Tidak perlu field “jenis utang” tambahan karena akun sudah menjadi pilihan alur. |
| **Migrasi data 2050 lama** | Ringan dan opsional. Tidak ada reklasifikasi otomatis. Operator dapat memindahkan saldo utang usaha lama per pihak lewat jurnal reklasifikasi D 2050 / K 2060 yang diaudit. Pinjaman lama tetap di 2050 dan tetap benar sebagai PENDANAAN. Jika reklasifikasi belum dilakukan, data lama tetap terbaca dengan perilaku lama. |
| **Backup/restore** | Backup v9 dapat direstore; saat `openDb` akun 2060 di-seed. Backup v10 ditolak aplikasi v9 bila `SCHEMA_VERSION` dinaikkan. Tidak ada DDL baru, sehingga risiko restore rendah. |
| **Kebutuhan skema** | Tidak ada tabel/kolom baru. Tambah akun statis `2060`, seed otomatis lewat `openDb`, naikkan `SCHEMA_VERSION` ke 10 sebagai penanda kontrak dan guard downgrade. Reklasifikasi memakai jurnal + `jurnal_pihak` + `audit_log` yang sudah ada. |

**Contoh jurnal:**

```
Beli kredit:        D 5003 Beban Wewangunan     1.000.000
                    K 2060 Hutang Usaha         1.000.000   (tidak ada kas)

Bayar utang usaha:  D 2060 Hutang Usaha           600.000
                    K 1001 Kas                    600.000   → OPERASI

Terima pinjaman:    D 1029 Bank                 2.000.000
                    K 2050 Hutang Lain-lain     2.000.000   → PENDANAAN

Bayar pinjaman:     D 2050 Hutang Lain-lain       500.000
                    K 1029 Bank                   500.000   → PENDANAAN

Reklasifikasi lama: D 2050 Hutang Lain-lain       300.000
                    K 2060 Hutang Usaha           300.000   (tanpa kas, diaudit)
```

### Opsi B — Metadata `kategori_arus_kas` pada jurnal/pihak

**Inti:** tidak menambah akun; setiap jurnal (atau baris/pemetaan pihak)
menyimpan kategori `OPERASI`/`PENDANAAN`. `arusKas` memakai metadata itu sebagai
override; jika kosong, jatuh ke klasifikasi akun seperti sekarang.

Ada tiga varian yang perlu dibedakan karena konsekuensinya berbeda:

| Varian | Tempat metadata | Masalah |
|---|---|---|
| B1 | Kolom baru `jurnal.kategori_arus_kas` | Jurnal bersifat immutable; trigger `trg_jurnal_immutable_update` menolak `UPDATE jurnal`, sehingga metadata data lama tidak bisa diisi belakangan tanpa membuka trigger atau melakukan migrasi khusus. Satu kategori untuk seluruh jurnal juga salah bila jurnal memuat beberapa arus kas. |
| B2 | Tabel samping `jurnal_arus_kas(jurnal_id, kategori)` | Bisa diubah belakangan (tidak kena trigger jurnal), tetapi menjadi sumber klasifikasi di luar baris jurnal; harus dijaga manual, bisa hilang, dan tidak menjamin konsistensi dengan akun. |
| B3 | Kolom baru `jurnal_pihak.kategori_arus_kas` | Hanya mencakup jurnal yang dipetakan ke pihak; jurnal umum/import/saldo awal tidak tercakup. `arusKas` harus di-join ke `jurnal_pihak`. |

| Dimensi | Dampak |
|---|---|
| **Kelebihan** | Tanpa akun COA baru; neraca tidak berubah. Bisa menandai jurnal lama tertentu bila memakai tabel samping (B2) atau membuka trigger (B1). Form Pihak dapat mengisi otomatis dari alur. |
| **Kekurangan** | Klasifikasi tidak lagi murni diturunkan dari akun; metadata bisa kosong, salah, atau tidak konsisten. B1 terhalang imutabilitas jurnal. B3 hanya mencakup jalur Pihak. Jurnal campuran (satu jurnal berisi pembayaran utang usaha dan pinjaman) tidak bisa diwakili satu kategori. Form tetap harus tahu bedanya utang usaha vs pinjaman—yang berarti tetap butuh pilihan pengguna seperti Opsi C. |
| **Dampak arus kas** | Benar hanya bila metadata terisi tepat. Data lama tanpa metadata kembali ke fallback 2050 = PENDANAAN. Pembayaran utang usaha lama tetap salah sampai ditandai manual; tidak ada cara otomatis yang aman. |
| **Dampak neraca** | Tidak ada pemisahan; 2050 tetap satu baris kewajiban campuran. Akuntan tidak bisa melihat utang usaha vs pinjaman dari neraca. |
| **Kompleksitas form** | Tinggi. Setiap jalur input (form Pihak, Jurnal Umum, import, saldo awal) harus mengisi/mewarisi metadata; jika tidak, klasifikasi salah diam-diam. |
| **Migrasi data 2050 lama** | Metadata baru perlu backfill. Audit log hanya membantu untuk `HUTANG-TERIMA-PINJAMAN` dan `HUTANG-BELI-KREDIT`; `HUTANG-BAYAR` ambigu. B1 tidak bisa `UPDATE` karena trigger. B2 memungkinkan penandaan manual, tetapi menjadi pekerjaan data baru yang tidak diaudit oleh jurnal. |
| **Backup/restore** | Menambah kolom/tabel; backup v9 perlu migrasi v10. Restore backup lama harus mengisi default kosong; backup baru ditolak aplikasi lama bila versi dinaikkan. |
| **Kebutuhan skema** | Kolom `jurnal.kategori_arus_kas` (B1, plus pengecualian trigger) atau tabel samping (B2) atau kolom `jurnal_pihak.kategori_arus_kas` (B3), migrasi v10, perubahan query `listBarisJurnal`/`arusKas`, dan perubahan tipe. |

**Contoh masalah B1:** jurnal lama `D 2050 / K kas` tidak bisa diberi
`kategori_arus_kas = 'OPERASI'` setelah tersimpan karena trigger menolak update.
Sementara jurnal baru `D 5003 / K 2060` tidak memiliki arus kas; yang perlu
diklasifikasi justru jurnal pembayaran 2050/2060. Jadi metadata harus dipasang
sejak insert, dan data lama tetap tidak tertolong.

### Opsi C — Pemilihan jenis utang di form Pihak

**Inti:** tambah pilihan wajib di form Pihak, misalnya `Jenis utang: Utang
Usaha / Pinjaman`, lalu simpan di `jurnal_pihak.jenis_utang` (bukan di master
`pihak`, karena satu pihak bisa punya keduanya). Laporan membaca metadata ini.

| Dimensi | Dampak |
|---|---|
| **Kelebihan** | Tanpa akun COA baru; operator memilih jenis saat mencatat; form dapat menampilkan konsekuensi arus kas. Neraca tidak berubah. |
| **Kekurangan** | Hanya mencakup transaksi lewat form Pihak. Jurnal Umum, import Excel, saldo awal, dan reversal/pengganti tidak otomatis punya metadata. Neraca tetap mencampur 2050. `arusKas` harus di-join ke `jurnal_pihak`; jurnal tanpa pemetaan tidak terklasifikasi. |
| **Dampak arus kas** | Hanya benar untuk jurnal form Pihak yang metadatanya terisi. Jurnal 2050 lain tetap PENDANAAN; tidak ada perbaikan menyeluruh. |
| **Dampak neraca** | Tidak ada pemisahan baris; total kewajiban sama, tetapi komposisi utang usaha/pinjaman tidak terlihat. |
| **Kompleksitas form** | Rendah–sedang: satu field baru, tetapi pengguna harus memahami perbedaan dan field harus wajib. Jalur input lain tetap perlu aturan fallback. |
| **Migrasi data 2050 lama** | `jurnal_pihak` lama tidak punya jenis utang; harus diisi manual atau dibiarkan null. `HUTANG-BAYAR` lama tetap ambigu. Tidak ada reklasifikasi saldo; hanya klasifikasi laporan. |
| **Backup/restore** | Menambah kolom di `jurnal_pihak`; migrasi v10; backup lama restore dengan nilai kosong dan fallback. |
| **Kebutuhan skema** | Kolom `jurnal_pihak.jenis_utang` (atau `kategori_arus_kas`) + migrasi + query laporan + tipe `JurnalPihak`/`BarisJurnalSumber`. |

---

## 4. Matriks perbandingan

| Kriteria | A (2050 = utang usaha) | **A′ (rekomendasi)** | B (metadata) | C (form Pihak) |
|---|---|---|---|---|
| Sumber klasifikasi | Akun COA | **Akun COA** | Metadata jurnal/pihak | Metadata dokumen |
| Pembayaran utang usaha baru | OPERASI | **OPERASI** | OPERASI bila metadata ada | OPERASI bila dipilih |
| Pembayaran pinjaman baru | PENDANAAN | **PENDANAAN** | PENDANAAN bila metadata ada | PENDANAAN bila dipilih |
| Data 2050 lama | Berubah retroaktif menjadi OPERASI | **Tidak berubah; tetap PENDANAAN** | Fallback PENDANAAN; perlu tagging manual | Fallback PENDANAAN; perlu isi manual |
| Laporan periode lama | Restatement tanpa jurnal koreksi | **Stabil** | Stabil bila metadata tidak diisi; benar hanya setelah tagging | Stabil; perbaikan terbatas |
| Neraca | 2 baris | **2 baris** | 1 baris campuran | 1 baris campuran |
| Jurnal Umum/import/saldo awal | Otomatis dari akun | **Otomatis dari akun** | Tidak otomatis tercakup | Tidak tercakup |
| Jurnal campuran | Perlu aturan | **Perlu aturan validasi** | Satu kategori bisa salah | Form 2 baris, relatif aman |
| Kompleksitas form | Sedang | **Sedang** | Tinggi | Rendah–sedang |
| Perubahan skema | COA + versi | **COA + versi** | Kolom/tabel + versi | Kolom + versi |
| Risiko migrasi | Tinggi (arti 2050 berubah) | **Rendah (opsional per pihak)** | Sedang–tinggi (backfill) | Sedang (coverage) |
| Kesesuaian “jurnal satu-satunya sumber angka” | Kuat | **Kuat** | Sedang (metadata di luar baris) | Lemah (metadata dokumen) |

---

## 5. Keputusan eksplisit

**Dipilih: Opsi A (akun COA baru), varian A′, yaitu penambahan akun COA
`2060 HUTANG USAHA` dengan `2050 HUTANG LAIN-LAIN` tetap sebagai akun
pinjaman/legacy dan tetap PENDANAAN.**

Alasan keputusan:

1. **Tidak ada restatement diam-diam.** Jurnal 2050 lama tetap menghasilkan
   klasifikasi yang sama seperti hari ini. Tidak ada laporan periode lalu yang
   berubah hanya karena aplikasi diperbarui.
2. **Jurnal tetap satu-satunya sumber angka.** Kelompok arus kas ditentukan oleh
   kode akun pada baris jurnal. Tidak ada metadata klasifikasi yang bisa hilang
   atau bertentangan dengan jurnal.
3. **Perbaikan langsung untuk transaksi baru.** Setelah AKT-20, setiap beli
   kredit dan pembayaran utang usaha baru memakai 2060 dan otomatis OPERASI.
   Pinjaman tetap 2050 dan PENDANAAN.
4. **Migrasi data lama kecil dan terkendali.** Tidak ada reklasifikasi otomatis.
   Operator dapat memindahkan saldo utang usaha lama per pihak dengan jurnal
   reklasifikasi D 2050 / K 2060 yang dapat diaudit. Jika belum dipindahkan,
   perilakunya sama seperti sekarang—tidak ada kerusakan baru.
5. **Backup/restore paling aman.** Hanya akun statis yang di-seed ulang saat
   `openDb`; tidak ada DDL baru yang mengubah tabel. Backup v9 tetap bisa
   direstore. `SCHEMA_VERSION` dinaikkan ke 10 agar aplikasi v9 tidak membuka
   backup v10 yang berisi akun 2060 dan kontrak klasifikasi baru.
6. **Dampak kode paling kecil.** Alur pinjaman yang sudah ada tidak berubah;
   yang berubah adalah `BELI_KREDIT` (K 2050 → K 2060), tambah satu alur
   `BAYAR_UTANG_USAHA` (D 2060 / K kas), special-case 2060 di `arusKas`, dan
   perluasan laporan pihak.

**Yang secara eksplisit ditolak:**

- **Opsi A literal (2050 menjadi utang usaha).** Ditolak karena mengubah arti
  data lama dan membuat laporan arus kas historis berubah tanpa jurnal koreksi.
  Jika pemilik sistem tetap menghendaki 2050 = utang usaha, itu harus menjadi
  proyek restatement tersendiri dengan keputusan dan pengungkapan eksplisit;
  bukan bagian AKT-20.
- **Opsi B (metadata `kategori_arus_kas`).** Ditolak karena jurnal immutable
  sehingga metadata data lama tidak bisa diisi; jurnal campuran tidak terwakili
  satu kategori; jalur Jurnal Umum/import/saldo awal tidak otomatis tercakup.
- **Opsi C (pilihan jenis utang di form Pihak saja).** Ditolak karena hanya
  mencakup satu jalur input, tidak memisahkan neraca, dan tetap menyisakan
  jurnal 2050 di luar form Pihak tanpa klasifikasi.
- **Reklasifikasi otomatis seluruh saldo 2050.** Ditolak karena `HUTANG-BAYAR`
  lama tidak menyimpan apakah pembayaran untuk utang usaha atau pinjaman.
  Reklasifikasi otomatis akan menebak dan merusak audit trail.

**Kapan keputusan ini perlu ditinjau ulang:** jika pemilik sistem memutuskan
bahwa seluruh saldo 2050 historis harus dipresentasikan ulang sebagai utang
usaha, atau jika jumlah data lama sangat kecil sehingga restatement disetujui.
Keputusan itu harus tercatat sebagai perubahan kebijakan akuntansi, bukan
tersembunyi dalam migrasi teknis.

---

## 6. Dampak rinci Opsi A′

### 6.1 Arus kas

Aturan baru di `arusKas`:

| Akun lawan pada jurnal kas | Kelompok | Contoh |
|---|---|---|
| `2060 HUTANG USAHA` | **OPERASI** | D 2060 / K kas (bayar utang usaha) |
| `2050 HUTANG LAIN-LAIN` | PENDANAAN | D kas / K 2050 (terima pinjaman); D 2050 / K kas (bayar pinjaman) |
| `1050 PIUTANG` | INVESTASI | D 1050 / K kas; D kas / K 1050 |
| `3000 MODAL` | PENDANAAN | D kas / K 3000 |
| Pendapatan/beban/1040 | OPERASI | transaksi harian, panjar |
| Antar kas tanpa non-kas | TRANSFER | pindah dana |

Implementasi minimal: tambahkan `AKUN_HUTANG_USAHA` ke cabang OPERASI sebelum
cabang `KEWAJIBAN`/`EKUITAS` (lihat `src/core/reports.ts:851-862`). `2050` tidak
perlu diubah karena tetap jatuh ke cabang PENDANAAN.

Contoh angka:

```
Saldo awal kas                         10.000.000
Beli kredit 1.000.000 (D beban/K 2060)          0   (bukan arus kas)
Bayar utang usaha 600.000 (D 2060/K kas)  -600.000   OPERASI
Terima pinjaman 2.000.000 (D kas/K 2050)+2.000.000   PENDANAAN
Bayar pinjaman 500.000 (D 2050/K kas)     -500.000   PENDANAAN
--------------------------------------------------
Saldo akhir kas                         10.900.000
```

Total kas, `saldoAwal`, `saldoAkhir`, `totalMasuk`, dan `totalKeluar` tidak
berubah karena klasifikasi hanya memindahkan baris antar kelompok. Invarian
`saldoAkhir = saldoAwal + kenaikan` tetap.

### 6.2 Neraca

`2060` muncul sebagai baris kewajiban baru di bawah `2050`. Total kewajiban
adalah jumlah keduanya. Tidak ada saldo tersimpan; `neraca()` membaca
`listAkun(db)` dan baris jurnal, sehingga akun baru otomatis tampil
(`src/core/reports.ts:637-650`). Neraca tetap balance karena jurnal tetap
double-entry.

Dampak tampilan: laporan neraca akan menampilkan dua baris kewajiban. Ini
disengaja agar akuntan bisa melihat komposisi utang usaha vs pinjaman. Jika
diinginkan, UI dapat memberi subjudul “Utang Usaha” dan “Pinjaman”, tetapi
angkanya tetap dari akun masing-masing.

### 6.3 Hutang per pihak

- `saldoPihak()` harus menjumlahkan 2050 **dan** 2060 sebagai total hutang
  pihak. Tambahkan field rincian (mis. `hutangUsaha` dan `pinjaman`) agar UI
  bisa menampilkan komposisi tanpa mengubah total.
- `mutasiPerJurnal()` dan `saldoMap()` di `src/core/pihak.ts` harus mengenali
  `2060` selain `2050`. Saat ini keduanya memfilter persis `AKUN_HUTANG`.
- `rekonsiliasiPihak()` perlu baris untuk 2060, atau generalisasi daftar akun
  hutang. Kartu rekonsiliasi di `PihakTab` menampilkan 2050/2060; baris 1050
  hanya dipertahankan sebagai “Aset lain lama” untuk data lama (DB-23a).
- Peringatan overbalance di `postingPihak` harus membandingkan nominal dengan
  saldo **akun yang dipakai alur**, bukan total hutang. Contoh: pihak punya
  pinjaman 2050 Rp100.000 dan utang usaha 2060 Rp100.000; membayar utang usaha
  Rp150.000 harus tetap memicu peringatan meskipun total hutang Rp200.000.
- `jurnal_pihak` tetap hanya metadata penghubung. Satu jurnal reklasifikasi
  dapat punya dua baris pemetaan (2050 dan 2060) untuk pihak yang sama; PK
  `(jurnal_id, akun_kode)` sudah mendukungnya.
- `salinMappingPihak` pada reversal harus menyalin kedua pemetaan bila jurnal
  hasil reversal/pengganti memuat kedua akun. Tidak ada perubahan logika selain
  memastikan filter akun mencakup 2060.

### 6.4 Form dan UI Pihak

Alur hutang menjadi empat (alur piutang 1050 sudah dihapus di DB-23a):

| Alur | Jurnal | Kelompok arus kas |
|---|---|---|
| Terima Pinjaman | D kas / K 2050 | PENDANAAN |
| Bayar Pinjaman (sebelumnya “Bayar Hutang”) | D 2050 / K kas | PENDANAAN |
| Beli / Perbaikan Kredit | D beban / K **2060** | tidak ada kas |
| **Bayar Utang Usaha** (baru) | D **2060** / K kas | **OPERASI** |

Perubahan UI minimal:
- `ALUR_INFO` dan `URUTAN_ALUR` di `PihakTab.tsx` hanya memuat empat alur
  hutang; tidak ada lagi entri piutang.
- Label “Bayar Hutang” diganti “Bayar Pinjaman” agar tidak ambigu; deskripsi
  menyebut 2050 dan 2060.
- Tabel saldo per pihak menampilkan kolom/ekspansi “Pinjaman (2050)” dan
  “Utang Usaha (2060)”, atau kolom “Hutang” dengan rincian.
- Teks bantuan `BELI_KREDIT` berubah dari “K Hutang (2050)” menjadi
  “K Hutang Usaha (2060)”.
- Tidak perlu field “jenis utang” tambahan: pilihan alur sudah menjadi pilihan
  akun. Ini menjaga form tetap sederhana dan menghindari metadata yang bisa
  hilang.

### 6.5 Jurnal Umum, import, saldo awal, dan validasi

- **Jurnal Umum:** boleh memakai 2060. `validasiJurnal` jenis `HUTANG` harus
  menerima 2050 atau 2060. Jenis `UMUM` tetap boleh memakai keduanya.
- **Import Excel:** akun 2060 tersedia dari master `akun` setelah `openDb`;
  template tidak perlu kolom baru. Import yang menyentuh 2060 tetap mendapat
  peringatan pihak belum teralokasi bila tidak lewat form Pihak.
- **Saldo awal:** `SaldoAwalWizard` memfilter semua KEWAJIBAN dari master,
  sehingga 2060 otomatis muncul. Saldo awal pinjaman lama tetap boleh di 2050;
  saldo awal utang usaha baru boleh di 2060.
- **Peringatan pihak:** `peringatanPihakTanpaMapping` harus menyebut 2050 dan
  2060. Jurnal yang menyentuh 2060 tanpa pemetaan tetap diperingatkan.
- **Jurnal campuran:** jurnal dengan kas dan **kedua** akun 2050 dan 2060
  sekaligus tidak boleh disimpan (kecuali `SALDO_AWAL`), karena satu jurnal
  tidak bisa menggambarkan dua kelompok arus kas yang berbeda. Pesannya:
  “Pisahkan pembayaran utang usaha dan pinjaman ke jurnal terpisah.” Jurnal
  reklasifikasi D 2050 / K 2060 tanpa kas tetap diperbolehkan.
  Alasan: `arusKas` mengklasifikasi seluruh arus kas satu jurnal berdasarkan
  akun lawan yang ada; tanpa aturan ini, jurnal campuran akan masuk salah satu
  kelompok dan menyesatkan. Aturan ini adalah pengaman baru, bukan perubahan
  jurnal lama.

### 6.6 Audit dan reklasifikasi

Jurnal reklasifikasi adalah jurnal baru, bukan edit jurnal lama:

```
D 2050 HUTANG LAIN-LAIN     xxx
K 2060 HUTANG USAHA         xxx
```

Ketentuan:
- `jenis = 'UMUM'`, tanpa baris kas, tanpa akun PENDAPATAN/BEBAN.
- Tanggal tidak boleh di masa depan; periode terkunci mengikuti aturan posting
  yang ada (alasan minimal 5 karakter).
- Nominal integer > 0; tidak boleh melebihi saldo 2050 pihak (atau harus
  konfirmasi + alasan, mengikuti pola overbalance AKT-08).
- `jurnal_pihak` diisi untuk kedua akun dengan pihak yang sama, sehingga saldo
  total pihak tidak berubah dan rekonsiliasi tetap nol.
- `audit_log` mencatat aksi `HUTANG-REKLASIFIKASI`, alasan operator, saldo
  sebelum/sesudah, dan ID jurnal.
- Tidak mengubah Laba Rugi, total kewajiban, total aset, atau kas.
- Efeknya hanya pada **pembayaran berikutnya**: setelah saldo pindah ke 2060,
  pembayaran utang usaha masuk OPERASI. Arus kas historis yang sudah tercatat
  di 2050 tidak berubah dan tidak diklaim ulang.

### 6.7 Batasan yang harus disampaikan ke pengguna/akuntan

1. Pembayaran utang usaha **sebelum** reklasifikasi dan masih memakai 2050 tetap
   tampil PENDANAAN. Ini adalah keterbatasan data lama, bukan bug baru.
2. Reklasifikasi saldo tidak mengubah laporan arus kas periode lalu. Jika
   restatement historis diperlukan, itu keputusan terpisah dan harus memakai
   jurnal koreksi yang disetujui, bukan migrasi diam-diam.
3. `2050` tetap bernama “HUTANG LAIN-LAIN” karena nama resmi CSV tidak diubah
   pada tiket ini. Panduan pengguna harus menjelaskan bahwa 2050 dipakai untuk
   pinjaman/legacy dan 2060 untuk utang usaha.
4. Tambahan akun 2060 adalah ekstensi sistem seperti 1040; `KODE AKUN.csv`
   resmi tetap 48 akun sampai ada persetujuan perubahan dokumen COA dari client.
   Jika CSV diperbarui kelak, test COA harus disesuaikan.

---

## 7. Rencana migrasi AKT-20 (langkah demi langkah)

Rencana ini ditulis agar bisa dieksekusi langsung. Urutan penting: backup dan
inventaris dulu, baru kode, lalu data opsional, lalu test.

### Langkah 0 — Pra-migrasi (wajib, sebelum mengubah kode)

1. Buat **Backup Lengkap** versi 9 dari aplikasi lama; simpan di folder di luar
   `data/backups/` bila diperlukan. Jangan menghapus backup lama.
2. Catat `PRAGMA user_version` dan `schemaVersion` manifest. Baseline harus 9.
3. Buat inventaris read-only saldo 2050 per pihak (lihat query di §7.1).
   Simpan hasilnya sebagai lampiran pekerjaan, bukan di repo.
4. Pastikan tidak ada proses aplikasi yang menulis DB saat migrasi.

### Langkah 1 — COA dan konstanta (`src/db/coa.ts`)

1. Tambah `export const AKUN_HUTANG_USAHA = '2060';`.
2. Tambah baris COA setelah 2050:
   `akunBaru(AKUN_HUTANG_USAHA, 'HUTANG USAHA', 'KEWAJIBAN')`.
3. Pertahankan `AKUN_HUTANG = '2050'`; perbarui komentar: 2050 = pinjaman/legacy,
   2060 = utang usaha. Jangan mengganti nama 2050 agar tetap cocok dengan
   `KODE AKUN.csv` dan test COA.
4. Perluas helper:
   - `isHutang(kode)` menjadi true untuk 2050 dan 2060 (atau tambah
     `isHutangUsaha`/`isHutangPinjaman` agar pemanggil eksplisit).
   - `KEWAJIBAN_KODES` otomatis ikut karena memfilter `tipe`.
5. Perbarui komentar header COA: 2060 adalah ekstensi sistem di luar CSV,
   seperti 1040.

**Acceptance:** `akun('2060')` bertipe KEWAJIBAN/KREDIT; `COA` bertambah satu;
`KODE AKUN.csv` tidak diubah.

### Langkah 2 — Versi skema (`src/db/database.ts`)

1. Naikkan `SCHEMA_VERSION` dari 9 ke 10. Jika tiket lain (mis. AKT-26) sudah
   menaikkan versi lebih dulu, pakai nomor berikutnya yang belum terpakai;
   jangan dua tiket memakai nomor versi yang sama.
2. Tambah catatan riwayat: “10 = pemisahan akun utang usaha 2060; tidak ada DDL
   baru, seed COA idempoten; mencegah aplikasi v9 membuka backup v10.”
3. Tidak perlu `ALTER TABLE`. `openDb` sudah meng-upsert COA setiap kali DB
   dibuka (`src/db/database.ts:368-381`), sehingga DB v9 yang dibuka aplikasi
   v10 otomatis mendapat akun 2060.
4. Pastikan `migrasi()` tetap idempoten: buka DB v9, tutup, buka lagi → versi
   10, akun 2060 tetap satu baris, jurnal lama tidak berubah.
5. Perbarui seluruh test yang masih mengunci `SCHEMA_VERSION`/`user_version` ke
   9 (lihat §8).

**Acceptance:** DB v8/v9 lama terbuka, `user_version = 10`, akun 2060 ada,
jumlah/jurnal 2050 lama tidak berubah; buka ulang tidak menggandakan akun.

### Langkah 3 — Builder form (`src/core/forms.ts`)

1. `buatJurnalBeliKredit`: kredit memakai `AKUN_HUTANG_USAHA` (2060), bukan
   `AKUN_HUTANG`. Perbarui pesan error/komentar.
2. Tambah `FormBayarUtangUsaha` dan `buatJurnalBayarUtangUsaha`:
   **D 2060 / K akun kas**; jenis `HUTANG`.
3. Biarkan `buatJurnalTerimaPinjaman` dan `buatJurnalBayarHutang` memakai
   `AKUN_HUTANG` (2050). Perbarui komentar agar menyebut “pinjaman”, bukan
   “hutang” generik. Opsional: alias tipe `FormBayarPinjaman =
   FormBayarHutang` untuk keterbacaan tanpa memutus pemanggil lama.
4. `buatJurnalBayar` (form Bayar terpandu) harus menolak **2050 dan 2060**,
   bukan hanya 2050, agar pengguna diarahkan ke menu Pihak yang mencatat pihak.
5. `buatJurnalBeliKredit` tetap menolak akun kas/1040/1050/2050 sebagai akun
   beban; tambahkan 2060 ke penolakan akun beban.

**Acceptance:** builder beli kredit menghasilkan K 2060; builder bayar utang
usaha menghasilkan D 2060/K kas; builder pinjaman tetap 2050; form Bayar
terpandu menolak 2060.

### Langkah 4 — Klasifikasi alur (`src/core/pihak.ts`)

1. `AlurPihak` tambah `'BAYAR_UTANG_USAHA'`.
2. `KlasifikasiAlurPihak.akunPihak` menjadi union `'1050' | '2050' | '2060'`.
3. Aturan klasifikasi:
   - D 1050 / K kas → `BERI_PINJAMAN` (1050)
   - D kas / K 1050 → `TERIMA_PELUNASAN` (1050)
   - D kas / K 2050 → `TERIMA_PINJAMAN` (2050)
   - D 2050 / K kas → `BAYAR_HUTANG` (2050, pinjaman)
   - D 2060 / K kas → `BAYAR_UTANG_USAHA` (2060)
   - D beban / K 2060 → `BELI_KREDIT` (2060)
   - D beban / K 2050 → tetap diterima sebagai `BELI_KREDIT` legacy (2050)
     agar data/form lama dalam pengujian tidak langsung rusak; form baru selalu
     memakai 2060.
4. `jenisWajib` tetap: akun pihak 1050 → `PIUTANG`; 2050/2060 → `HUTANG`.
5. Perluas `peringatanPihakTanpaMapping` untuk 2060.
6. Perluas `saldoPihak`/`ringkasanSaldoPihak`/`rekonsiliasiPihak` agar 2060
   dihitung sebagai hutang. Tambah field rincian tanpa mengubah total.

**Acceptance:** enam alur tervalidasi; akun 2060 tidak bisa dipakai untuk alur
pinjaman; saldo total pihak = 2050 + 2060; reklasifikasi bisa dipetakan ke dua
akun.

### Langkah 5 — Adapter DB pihak (`src/db/pihak.ts`)

1. `AKSI_AUDIT` tambah `BAYAR_UTANG_USAHA: 'HUTANG-USAHA-BAYAR'` (nama final
   boleh disesuaikan, tetapi harus unik dan jelas).
2. Overbalance `TERIMA_PELUNASAN`/`BAYAR_HUTANG`/`BAYAR_UTANG_USAHA` memakai
   saldo akun spesifik (`akunPihak`), bukan total hutang. `saldoPihak` perlu
   menyediakan saldo 2050 dan 2060 terpisah.
3. `daftarJurnalPihak` sudah membaca `akun_pihak`; tidak perlu perubahan
   struktur, tetapi UI harus menampilkan 2060.
4. Tambah fungsi reklasifikasi (lihat Langkah 6) bila diputuskan masuk AKT-20.
5. Pastikan transaksi tulis tetap atomik: jurnal + `jurnal_pihak` + audit.

**Acceptance:** posting enam alur tersimpan; saldo pihak tidak berubah total
setelah reklasifikasi; audit memuat alur dan akun yang benar.

### Langkah 6 — Jurnal reklasifikasi 2050 → 2060 (kondisional)

Lakukan hanya jika ada saldo utang usaha lama yang diketahui dan operator ingin
memperbaikinya. Jika tidak ada, lewati langkah ini tanpa mengubah data.

1. Tambah fungsi main/DB, misalnya
   `reklasifikasiHutangUsaha(db, { pihakId, nominal, tanggal, alasan, id? })`.
2. Validasi:
   - pihak ada;
   - nominal integer > 0;
   - akun 2050 dan 2060 ada/aktif;
   - tanggal valid, tidak masa depan, periode tidak terkunci (atau alasan
     sesuai aturan posting);
   - alasan minimal 5 karakter;
   - saldo 2050 pihak cukup; jika tidak, perlakukan seperti overbalance
     (peringatan + konfirmasi + alasan), bukan blokir diam-diam.
3. Susun jurnal 2 baris: D 2050 / K 2060, `jenis: 'UMUM'`, `grup_id` baru,
   tanpa akun kas/P&L. Simpan lewat `postingJurnal` agar semua validasi berlaku.
4. Dalam transaksi yang sama, insert `jurnal_pihak` untuk 2050 dan 2060 dengan
   pihak yang sama.
5. Tulis `audit_log` `HUTANG-REKLASIFIKASI` berisi alasan, saldo 2050/2060
   sebelum dan sesudah, serta detail jurnal.
6. UI: tampilkan daftar pihak + saldo 2050, total beli kredit yang diketahui
   dari riwayat/audit, input nominal, peringatan, dan pratinjau jurnal. Jangan
   mengisi nominal otomatis dari total 2050; operator harus memilih.
7. Tambah IPC tervalidasi (mis. `pihak:reklasifikasi`) dan preload/API.
8. Jangan menjalankan reklasifikasi otomatis saat migrasi. Tidak ada data yang
   berubah tanpa aksi operator.

**Acceptance:** jurnal reklasifikasi tampil di Jurnal Umum, dapat diaudit,
tidak mengubah total kewajiban/kas/laba, dan memindahkan saldo 2050 → 2060
sebesar nominal. Jurnal lama tidak tersentuh.

### Langkah 7 — `arusKas` (`src/core/reports.ts`)

1. Impor `AKUN_HUTANG_USAHA`.
2. Di blok penentuan `kelompok` (`src/core/reports.ts:851-862`), masukkan 2060
   ke cabang OPERASI sebelum cabang KEWAJIBAN/EKUITAS. Contoh:

   ```ts
   const kelompok: KelompokArusKas =
     jenisLawan.some((a) =>
       a.kode === AKUN_HUTANG_USAHA ||
       a.tipe === 'PENDAPATAN' ||
       a.tipe === 'BEBAN' ||
       a.kode === AKUN_PANJAR,
     )
       ? 'OPERASI'
       : jenisLawan.some((a) => a.tipe === 'KEWAJIBAN' || a.tipe === 'EKUITAS')
         ? 'PENDANAAN'
         : ...
   ```

3. Jangan mengubah 2050: tetap PENDANAAN.
4. Perbarui komentar fungsi dan label `ArusKasTab`/export bila perlu.
5. Pastikan invarian `saldoAkhir = saldoAwal + kenaikan` dan total masuk/keluar
   tidak berubah pada test lama.

**Acceptance:** D 2060/K kas → OPERASI; D kas/K 2050 → PENDANAAN; D 2050/K kas
→ PENDANAAN; total kas tetap.

### Langkah 8 — Validasi posting (`src/core/posting.ts`)

1. Jenis `HUTANG` menerima 2050 **atau** 2060. Perbarui pesan error.
2. Tambah aturan jurnal campuran:
   - jika ada baris kas dan ada **2050 dan 2060** dalam satu jurnal, dan
     `jenis !== 'SALDO_AWAL'`, tolak dengan pesan agar dipecah;
   - jurnal tanpa kas (reklasifikasi) tetap boleh memuat keduanya.
3. Jangan mengubah aturan 1050/1040/3001/3002 atau aturan penutup manual.

**Acceptance:** jurnal `HUTANG` dengan 2060 valid; jurnal campuran kas
2050+2060 ditolak; jurnal reklasifikasi non-kas lolos; test validasi lama tetap
hijau setelah pesan disesuaikan.

### Langkah 9 — UI, IPC, dan dokumen pengguna

1. `PihakTab.tsx`: tambah alur `BAYAR_UTANG_USAHA`; ubah label `BAYAR_HUTANG`
   menjadi “Bayar Pinjaman”; `BELI_KREDIT` menyebut 2060; tabel/religasi pihak
   menampilkan 2050 dan 2060; grid kartu disesuaikan.
2. `ArusKasTab.tsx`: legenda pendanaan menyebut pinjaman/modal; operasi
   menyebut utang usaha (bukan hanya “hutang”).
3. `src/main/ipc.ts`: pastikan `pihak:posting` meneruskan alur baru; tambah
   handler reklasifikasi bila Langkah 6 dikerjakan; update komentar lima alur
   menjadi enam.
4. `src/preload/index.ts`/`src/renderer/lib/api.ts`: tambah binding reklasifikasi
   bila ada.
5. `docs/panduan-pengguna.md` dan `docs/panduan-pemeriksaan.md`: jelaskan 2050
   vs 2060, enam alur, dan batas data lama. Ini bisa menjadi bagian AKT-20 atau
   tiket dokumentasi terpisah, tetapi jangan meninggalkan dokumen yang
   menyatakan semua hutang memakai 2050.
6. `docs/arah-akuntansi.md` baris contoh “K 2050 Hutang” untuk beli kredit
   perlu diperbarui menjadi 2060 saat implementasi.

### Langkah 10 — Seed/dev dan data uji

1. `src/db/seed-dev.ts`: jurnal pinjaman tetap 2050. Tambah contoh beli kredit
   dan pembayaran utang usaha dengan 2060 agar jalur baru teruji di data dev.
2. Jangan mengubah data produksi/`data/` atau `data/backups/`.
3. Test seed yang menghitung total hutang harus menjumlahkan 2050 + 2060.

---

### 7.1 Query inventaris data lama (read-only, untuk AKT-20)

Jalankan pada salinan/backup, bukan langsung mengubah DB:

```sql
-- Saldo 2050/2060 per akun
SELECT b.akun_kode,
       COUNT(DISTINCT j.id) AS jumlah_jurnal,
       SUM(b.debit)  AS total_debit,
       SUM(b.kredit) AS total_kredit
FROM jurnal_baris b
JOIN jurnal j ON j.id = b.jurnal_id
WHERE b.akun_kode IN ('2050', '2060')
GROUP BY b.akun_kode;

-- Saldo 2050 per pihak (berdasarkan pemetaan)
SELECT jp.pihak_id, p.nama,
       SUM(b.kredit - b.debit) AS saldo_2050
FROM jurnal_pihak jp
JOIN pihak p ON p.id = jp.pihak_id
JOIN jurnal_baris b
  ON b.jurnal_id = jp.jurnal_id AND b.akun_kode = jp.akun_kode
WHERE jp.akun_kode = '2050'
GROUP BY jp.pihak_id, p.nama;

-- Petunjuk alur dari audit (bukan bukti saldo)
SELECT aksi, COUNT(*) AS jumlah
FROM audit_log
WHERE aksi LIKE 'HUTANG-%'
GROUP BY aksi;
```

Catatan: query terakhir hanya menunjukkan pernah ada alur tertentu; tidak bisa
menentukan saldo utang usaha yang tersisa karena `HUTANG-BAYAR` tidak menunjuk
pembelian mana yang dibayar. Karena itu reklasifikasi tetap keputusan operator
per pihak.

---

## 8. Test yang harus dibuat/diubah AKT-20

Baseline saat ini 687 test / 56 file. AKT-20 akan menambah test; angka final
tidak harus 687, tetapi semua test lama yang relevan harus tetap hijau.

### 8.1 `tests/laporan.test.ts`

- [ ] `D 2060 / K kas` → baris `kelompok: 'OPERASI'`, `operasi.keluar` naik,
      `pendanaan` tidak berubah.
- [ ] `D kas / K 2050` (terima pinjaman) → `PENDANAAN`.
- [ ] `D 2050 / K kas` (bayar pinjaman) → `PENDANAAN`.
- [ ] `D beban / K 2060` (beli kredit) → tidak menghasilkan baris arus kas.
- [ ] Total `totalMasuk`, `totalKeluar`, `kenaikan`, `saldoAwal`, `saldoAkhir`
      sama dengan perhitungan kas langsung.
- [ ] Jurnal campuran kas 2050+2060 ditolak oleh validasi (bila aturan Langkah 8
      dipilih); jurnal non-kas 2050+2060 (reklasifikasi) tidak menghasilkan baris
      arus kas dan tidak mengubah total.
- [ ] Test AKT-17 (1050 → INVESTASI) dan AKT-18 (transfer) tetap hijau.

### 8.2 `tests/pihak.test.ts`

- [ ] Enam alur menghasilkan akun D/K yang benar (termasuk `BAYAR_UTANG_USAHA`
      dan `BELI_KREDIT` → 2060).
- [ ] Saldo total pihak = 2050 + 2060; saldo per akun tersedia untuk UI.
- [ ] Overbalance dibandingkan dengan saldo akun yang dipakai, bukan total.
- [ ] Rekonsiliasi 1050/2050/2060: setelah jurnal dipetakan, `belum` = 0.
- [ ] Reklasifikasi D 2050 / K 2060: total hutang pihak tidak berubah; saldo
      2050 turun, 2060 naik; audit `HUTANG-REKLASIFIKASI` tercatat; jurnal lama
      tidak berubah.
- [ ] Reversal jurnal 2060 menyalin pemetaan pihak dan mengembalikan saldo.
- [ ] Data lama 2050 tanpa 2060 tetap terbaca dan tetap PENDANAAN (fallback).
- [ ] Snapshot/HTML `PihakTab` memuat teks 2050/2060 yang baru.

### 8.3 `tests/coa.test.ts`

- [ ] `akun('2060')` ada, nama `HUTANG USAHA`, tipe KEWAJIBAN, posisi KREDIT.
- [ ] `COA` = akun CSV + 1040 + 2060; test lama `COA.length === csv.length + 1`
      diubah menjadi `+ 2` dengan komentar ekstensi.
- [ ] `isHutang('2060')` true; `AKUN_HUTANG` tetap 2050.
- [ ] `KEWAJIBAN_KODES` memuat 2050 dan 2060.

### 8.4 `tests/jurnal-form.test.ts` / `tests/forms-ui.test.ts`

- [ ] `buatJurnalBeliKredit` → K 2060.
- [ ] `buatJurnalBayarUtangUsaha` → D 2060/K kas.
- [ ] `buatJurnalTerimaPinjaman`/`buatJurnalBayarHutang` tetap 2050.
- [ ] Form Bayar terpandu menolak 2050 dan 2060.
- [ ] Form Saldo Awal menerima 2060 sebagai KEWAJIBAN.

### 8.5 `tests/ipc-validation.test.ts` / `tests/ipc-main.test.ts`

- [ ] Jenis `HUTANG` dengan 2050 valid; dengan 2060 valid; dengan akun lain
      error yang menyebut 2050/2060.
- [ ] `pihak:posting` alur baru tersimpan dan audit benar.
- [ ] Peringatan pihak tanpa mapping muncul untuk 2060.

### 8.6 Test migrasi/backup

- [ ] `tests/migrasi-v9.test.ts` atau `tests/migrasi-v10.test.ts`: DB v9 lama
      dibuka → `user_version` 10, akun 2060 ada, jurnal 2050 lama utuh;
      idempoten saat dibuka dua kali.
- [ ] `tests/backup-restore.test.ts`: backup v9 (tanpa 2060) bisa direstore;
      aplikasi v10 menambahkan 2060; manifest backup v10 memuat
      `schemaVersion: 10`; backup v10 ditolak oleh aturan versi aplikasi v9
      (test batas `> SCHEMA_VERSION`).
- [ ] `tests/integritas.test.ts`/`tests/invariant.test.ts`: total kewajiban
      setelah pemisahan = 2050 + 2060; neraca tetap balance.

### 8.7 Test yang perlu menyesuaikan angka versi

Cari semua `expect(SCHEMA_VERSION).toBe(9)` dan `user_version` 9, lalu ubah ke
10 sesuai versi baru. File yang saat ini memuat assertion tersebut antara lain:
`tests/migrasi-v9.test.ts`, `tests/rekonsiliasi.test.ts`, `tests/pihak.test.ts`,
`tests/jurnal.test.ts`, `tests/lampiran.test.ts`, dan test lain yang memakai
`SCHEMA_VERSION`. Jangan hanya mengubah satu file lalu meninggalkan assertion
lain merah.

---

## 9. Backup, restore, dan rollback

### 9.1 Kompatibilitas

| Skenario | Perilaku yang diharapkan |
|---|---|
| Backup v9 → aplikasi v10 | **Boleh.** Restore lolos validasi versi; `openDb` menaikkan `user_version` ke 10 dan meng-upsert akun 2060. Jurnal lama tidak berubah. |
| Backup v10 → aplikasi v10 | **Boleh.** Manifest `schemaVersion: 10`, akun 2060 sudah ada. |
| Backup v10 → aplikasi v9 | **Ditolak** oleh `validasiKandidatRestore`/`validasiBackupLengkap` karena `schemaVersion > SCHEMA_VERSION` aplikasi lama. Ini disengaja agar aplikasi lama tidak menulis transaksi baru ke akun yang belum dipahaminya. |
| Restore gagal di tengah | Mekanisme restore yang ada mengembalikan DB/lampiran lama; tidak ada perubahan pada mekanisme ini. |
| Reklasifikasi | Jurnal baru + audit; backup setelah reklasifikasi memuat jurnal tersebut. Backup sebelum reklasifikasi tetap valid, hanya belum memuat reklasifikasi. |

### 9.2 Rollback

1. Sebelum upgrade, buat Backup Lengkap v9 dan simpan.
2. Jika aplikasi v10 bermasalah, pasang kembali aplikasi v9 dan restore backup
   v9 (bukan backup v10; backup v10 akan ditolak).
3. Jangan menurunkan `SCHEMA_VERSION` pada DB yang sudah v10 tanpa prosedur
   restatement; itu akan membuat backup v10 tampak “lebih baru” dan membingungkan.
4. Reklasifikasi tidak boleh di-rollback dengan menghapus jurnal (trigger
   menolak). Jika salah, buat jurnal reklasifikasi balik D 2060 / K 2050 dengan
   alasan, atau reversal sesuai prosedur koreksi.

---

## 10. Risiko dan mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Operator mengira 2060 wajib untuk semua hutang | Pinjaman baru tercatat di 2060 dan menjadi OPERASI | Label form “Terima/Bayar Pinjaman” tetap 2050; panduan dan teks bantuan menyebut 2060 hanya untuk utang usaha |
| Utang usaha lama tetap di 2050 | Pembayaran lama tetap PENDANAAN | Reklasifikasi per pihak yang diaudit; dokumentasikan batasnya; jangan auto-reclass |
| Reklasifikasi melebihi saldo 2050 pihak | Saldo 2050 pihak minus, laporan pihak aneh | Peringatan + konfirmasi + alasan seperti overbalance AKT-08; tampilkan saldo sebelum |
| Jurnal campuran 2050+2060 | Satu jurnal punya dua kategori arus kas | Tolak untuk jurnal ber-kas non-SALDO_AWAL; minta pisahkan jurnal |
| 2060 tidak ada di DB lama | Posting gagal setelah restore | `openDb` upsert COA; test restore v9; validasi akun |
| `jurnal_pihak` lupa 2060 | Saldo pihak tidak mencakup utang usaha | Perluas semua filter `AKUN_HUTANG`; test rekonsiliasi 2060 |
| Overbalance memakai total hutang | Pembayaran utang usaha melebihi saldo 2060 lolos | Bandingkan dengan saldo akun spesifik; test dua akun |
| Aplikasi v9 membuka backup v10 | Data 2060 ditulis dengan form 2050 | Naikkan `SCHEMA_VERSION`; test penolakan versi |
| Nama 2050 membingungkan | Operator salah pilih akun | Panduan + label UI; pertimbangkan rename hanya jika CSV resmi diubah |

---

## 11. Definition of Done AKT-20

- [ ] Akun 2060 `HUTANG USAHA` ada di COA statis dan master DB setelah `openDb`.
- [ ] `SCHEMA_VERSION` 10; DB v9 lama terbuka dan mendapat 2060 tanpa kehilangan
      data; migrasi idempoten.
- [ ] Form Pihak punya enam alur; beli kredit dan bayar utang usaha memakai
      2060; pinjaman tetap 2050.
- [ ] `arusKas`: 2060 → OPERASI; 2050 → PENDANAAN; total kas tidak berubah.
- [ ] Neraca menampilkan 2050 dan 2060 terpisah; total kewajiban dan balance
      tidak berubah.
- [ ] Saldo/rekonsiliasi pihak mencakup 2050 dan 2060; overbalance per akun.
- [ ] Reklasifikasi opsional tersedia, memakai jurnal baru + audit, tidak
      mengedit jurnal lama.
- [ ] Backup v9 bisa direstore ke v10; backup v10 ditolak v9; test tersedia.
- [ ] `npm run typecheck` bersih dan `npm test` seluruhnya hijau.
- [ ] Dokumen pengguna/pemeriksaan diperbarui agar tidak lagi menyatakan semua
      hutang memakai 2050.

---

## 12. Referensi kode yang dibaca untuk desain ini

- `src/db/coa.ts` — COA statis, `AKUN_HUTANG`, `isHutang`, seed.
- `src/db/database.ts` — `SCHEMA_VERSION`, DDL `jurnal`/`jurnal_baris`/
  `jurnal_pihak`, trigger imutabilitas, `openDb` upsert COA.
- `src/core/reports.ts` — `arusKas`, klasifikasi lawan, `neraca`.
- `src/core/forms.ts` — builder lima alur Pihak.
- `src/core/pihak.ts` — `klasifikasiAlurPihak`, saldo/rekonsiliasi pihak.
- `src/db/pihak.ts` — adapter posting pihak, audit, `jurnal_pihak`.
- `src/core/posting.ts` — validasi jenis `HUTANG` dan aturan jurnal.
- `src/db/posting.ts` — `postingJurnal`, validasi DB.
- `src/features/export/backupLengkap.ts`, `src/features/export/restoreLengkap.ts`,
  `src/features/export/export.ts` — manifest dan validasi versi backup.
- `src/renderer/components/PihakTab.tsx`, `src/renderer/components/ArusKasTab.tsx`
  — form dan tampilan laporan.
- `tests/coa.test.ts`, `tests/laporan.test.ts`, `tests/pihak.test.ts`,
  `tests/migrasi-v9.test.ts`, `tests/backup-restore.test.ts` — baseline test.
