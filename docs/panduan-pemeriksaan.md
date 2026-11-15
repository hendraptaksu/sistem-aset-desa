# Panduan Pemeriksaan — Keuangan Pura Dalem Puri

**Versi aplikasi:** 2.0.0  
**Tanggal dokumen:** 2026-11-09  
**Untuk:** akuntan pendamping/pemeriksa

Panduan ini untuk memeriksa pembukuan yang diinput operator. Prinsip utamanya:
**jurnal adalah satu-satunya sumber kebenaran**. Semua saldo, laba, dan total di
laporan dihitung ulang dari tabel `jurnal` + `jurnal_baris`; tidak ada angka
turunan yang disimpan. Karena itu koreksi tidak boleh mengubah/menghapus jurnal
lama, melainkan membuat jurnal balik.

> Posting operator memakai alur terpandu; hasilnya tetap jurnal double-entry
> yang sama dengan mode **Jurnal Umum**. Pemeriksaan tidak perlu membedakan asal
> form.

---

## 1. Urutan pemeriksaan yang disarankan

1. **Jurnal Umum** — pastikan setiap transaksi punya bukti, tanggal, dan lawan
   akun yang masuk akal.
2. **Buku Besar** — telusuri akun yang saldonya besar/berubah tidak wajar.
3. **Neraca Saldo** — total debit harus **sama dengan** total kredit (selisih 0).
4. **Laba Rugi** — pendapatan dan beban periode.
5. **Neraca** — aset = kewajiban + ekuitas; cek laba berjalan & laba ditahan.
6. **Arus Kas** — mutasi kas/bank metode langsung.
7. **Riwayat Audit** — periksa koreksi, kunci periode, backup/restore, perubahan
   pengaturan.

Semua layar laporan bisa **drill-down**: klik baris/akun → daftar jurnal → detail
debit/kredit + nomor bukti. Gunakan ini untuk membuktikan angka sampai ke
transaksi aslinya.

---

## 2. Jurnal Umum

> **Membuka Jurnal Umum.** Menu ini sengaja tersembunyi dari operator
> harian. Buka **Pengaturan → Mode lanjutan**, tekan **Aktifkan Mode lanjutan**,
> dan setujui konfirmasi yang menjelaskan tampilan debit/kredit mentah untuk
> pemeriksaan. Menu Jurnal Umum lalu muncul di grup **Data & Sistem**. Matikan
> kembali mode ini setelah pemeriksaan selesai; bila tab Jurnal Umum sedang
> aktif saat mode dimatikan, aplikasi berpindah aman ke Dashboard. Preferensi
> tersimpan per profil di perangkat ini (default mati).

Jurnal baru dari layar **Jurnal Umum** selalu berjenis **`UMUM`**. Jenis
dokumen lain (`TERIMA`, `BAYAR`, `TRANSFER`, `HUTANG`, `PANJAR`, `SALDO_AWAL`,
`REVERSAL`) dibuat lewat form terpandu, Buku Panjar, Wizard Saldo Awal, atau
menu Koreksi; aplikasi menolak jenis itu dari jalur Jurnal Umum.

### Yang diperiksa

- **Tanggal** masuk akal dan tidak berada di masa depan yang tidak seharusnya.
- **Nomor bukti** berpola `JU-<tahun>-<urut>` (default `JU-`), unik, dan tidak
  melompat tanpa alasan. Nomor boleh diedit operator, jadi periksa konsistensinya.
- **Keterangan** cukup jelas: untuk apa, dengan siapa, dan bukti apa.
- **Akun lawan** sesuai sifat transaksi:
  - penerimaan → kas/bank di debit, pendapatan/modal di kredit;
  - pengeluaran → beban/hutang di debit, kas/bank di kredit;
  - pindah dana → tujuan di debit, asal di kredit (total kas tetap);
  - panjar → `1040` di debit saat serah; beban/sisa kas di debit dan `1040` di
    kredit saat pertanggungjawaban;
  - pinjaman/utang → `2050` (pinjaman) atau `2060` (utang usaha) sesuai arah,
    bukan akun beban.
  - form terpandu **Bayar** hanya menawarkan akun **BEBAN**; pembayaran panjar
    lewat menu **Buku Panjar**, sedangkan pencatatan/pembayaran utang usaha lewat
    kartu **Catat Utang** dan **Bayar Utang** di tab Transaksi. Jurnal Umum
    hanya boleh memakai `2060` untuk koreksi akuntan; `1040` dan `2050` adalah
    akun kontrol subledger dan ditolak di Jurnal Umum — gunakan menu **Buku
    Panjar**/**Pinjaman LPD** atau Wizard Koreksi Saldo Awal.
  - `1050 PIUTANG LAIN LAIN` hanya untuk **data lama**. Alur input piutang sudah
    dihapus; jangan membuat jurnal 1050 baru. Koreksi saldo lama hanya lewat
    Jurnal Umum akuntan pendamping.
- **Dokumen bukti** transaksi material disimpan di arsip fisik; aplikasi tidak
  menyimpan foto/PDF bukti.

### Tanda bahaya

- Beban besar tetapi lawannya bukan kas/hutang (mis. langsung ke modal).
- Perbaikan/penambahan aset dibebankan ke modal, padahal seharusnya beban atau
  hutang.
- Transfer antar kas/bank yang memakai akun pendapatan/beban.
- Jurnal dengan dua baris yang keduanya debit atau keduanya kredit (sistem
  menolak, tetapi periksa bila ada data lama).
- Jurnal balik (`REVERSAL`) tanpa alasan yang jelas.

---

## 3. Buku Besar

Buka **Buku Besar**, pilih akun dan periode.

Yang diperiksa:

1. **Saldo awal** = saldo akhir periode sebelumnya (untuk akun yang sama).
2. Setiap baris mutasi punya tanggal, nomor bukti, dan keterangan.
3. **Saldo berjalan** = saldo awal + debit − kredit (atau sebaliknya sesuai posisi
   normal akun).
4. **Saldo akhir** cocok dengan angka di Neraca Saldo pada cut-off yang sama.

Akun yang paling sering diperiksa:

- `1001 KAS`, akun LPD (1010–1036), dan `1029 BANK BPD UBUD`.
- `1040 UANG PANJAR` — harus nol bila semua panjar sudah ditutup **atau
  dibatalkan**.
- `2050 HUTANG LAIN-LAIN` (pinjaman/legacy) dan `2060 HUTANG USAHA` — cocokkan
  dengan Buku Besar dan Neraca. Nama kreditur ada di keterangan jurnal, bukan di
  daftar pihak. Pembayaran `2060` masuk Arus Kas Operasi; `2050` tetap
  Pendanaan. Saldo utang usaha lama yang masih di `2050` juga tetap Pendanaan
  sampai direklasifikasi lewat jurnal yang diaudit.
- `1050 PIUTANG LAIN-LAIN` hanya dibaca untuk data lama; tidak ada lagi form
  input piutang. Saldo 1050 lama tetap muncul di Buku Besar/Neraca/Arus Kas.
- `3000 MODAL` — hanya berubah karena setoran/penarikan modal atau Saldo Awal.
- `3001 SALDO KUMULATIF` dan `3002 SALDO BERJALAN` — akun **legacy** yang hanya
  ditampilkan untuk membaca data lama. Keduanya **tidak dapat diposting** lewat
  Jurnal Umum, form terpandu, maupun Saldo Awal. Aplikasi versi ini **tidak
  menghitung** saldo akun ini dari kunci periode atau surplus periode dan **tidak
  menulis** ke akun ini; saldo yang tampil hanyalah akumulasi baris jurnal lama
  yang sudah ada di database. Bila tidak ada data lama, saldonya nol dan itu
  normal.

Bila saldo tidak wajar, klik baris jurnal untuk melihat detail, lalu koreksi
lewat mekanisme di bagian 8.

---

## 4. Neraca Saldo

Buka **Neraca Saldo**, pilih cut-off, lalu pilih mode:

- **Tahun berjalan** (default) — trial balance tahun buku: saldo AKTIVA/
  KEWAJIBAN/EKUITAS kumulatif sampai cut-off, sedangkan PENDAPATAN/BEBAN hanya
  mutasi tahun tersebut. Laba tahun sebelumnya muncul pada baris sintetis
  **Laba ditahan sebelum periode** (kredit bila laba, debit bila defisit).
  Baris ini bukan akun COA dan tidak bisa diposting.
- **Kumulatif sejak awal** — seluruh riwayat PENDAPATAN/BEBAN sejak awal,
  perilaku lama. Gunakan bila perlu memeriksa akumulasi total, bukan laba tahun
  berjalan.

**Aturan mutlak:** total debit = total kredit; **selisih harus 0**. Bila ada
selisih, jangan kunci periode dan jangan membuat laporan resmi. Cari jurnal yang
tidak seimbang di Jurnal Umum, atau hubungi pengembang bila sistem sendiri yang
menghasilkan selisih (seharusnya tidak terjadi karena posting layer menolak
jurnal tidak seimbang).

Yang diperiksa:

- Semua akun yang punya saldo muncul (termasuk akun kas/bank yang jarang dipakai).
- Saldo debit/kredit sesuai **posisi normal** akun:
  - AKTIVA & BEBAN → normal debit;
  - KEWAJIBAN, EKUITAS, PENDAPATAN → normal kredit.
- Tidak ada saldo negatif pada akun kas/bank tanpa penjelasan (kas minus
  diperingatkan saat input, tetapi tetap mungkin bila operator mengonfirmasi).

---

## 5. Laba Rugi

Buka **Laba Rugi**, pilih periode. Awal tahun buku dikunci ke **Januari (tahun
kalender)**; tahun buku fiskal (mis. Juli–Juni) **belum didukung**. Namun
pembukuan boleh **dimulai di tengah tahun** dengan tanggal mulai + Saldo Awal
(lihat panduan pengguna §2.7). Pada kasus itu, tahun pertama adalah **tahun
pertama (parsial)**: Laba Rugi hanya memuat transaksi sejak tanggal cut-over
sampai 31 Desember. Laba sebelum cut-over sudah masuk ekuitas awal dan tidak
boleh dicatat sebagai P&L tahun berjalan. Karena itu semua laporan tetap memakai
rentang Januari–Desember, bukan tahun fiskal.

- **Pendapatan** = total kredit akun pendapatan (posisi normal kredit).
- **Beban** = total debit akun beban (posisi normal debit).
- **Laba/rugi** = pendapatan − beban. Negatif = defisit dan ditampilkan dengan
  tanda kurung/Rp negatif.
- Cocokkan total pendapatan/beban dengan Buku Besar akun terkait.
- Bila ada pendapatan/beban yang seharusnya masuk tahun lain, periksa tanggal
  jurnal — bukan mengubah angka laporan.
- **Pengaturan tidak lagi menampilkan field awal tahun buku.** Bila DB lama
  menyimpan nilai selain Januari, aplikasi tetap membukanya tanpa error dan
  laporan tidak gagal dimuat. Nilai tersimpan baru menjadi Januari setelah
  operator menekan **Simpan Pengaturan Pembukuan**; aplikasi tidak mengubah data
  lama hanya karena dibuka.

Catatan: laporan ini **tidak** memakai angka tersimpan. Koreksi jurnal setelah
periode berjalan langsung mengubah Laba Rugi saat dibuka ulang.

---

## 6. Neraca

Buka **Neraca** dan pilih cut-off.

- **Aset** = saldo akun AKTIVA (kas/bank, piutang, panjar, aset lain).
- **Kewajiban** = saldo akun KEWAJIBAN (mis. `2050` pinjaman dan `2060` utang usaha).
- **Ekuitas** = modal + laba ditahan + laba berjalan (dihitung dari jurnal).
- **Aset = Kewajiban + Ekuitas**. Bila tidak sama, lihat status **Neraca Saldo**
  dan jangan kunci periode.
- **Laba ditahan** = akumulasi laba tahun-tahun yang sudah ditutup. Laba tahun
  berjalan terpisah sampai tahun itu ditutup.
- Bila ada koreksi setelah kunci periode, Neraca tahun berikutnya harus tetap
  seimbang; ini perilaku yang diuji (bukan bug).

Periksa juga bahwa **modal tidak berubah** hanya karena ada beban atau
pembelian kredit. Perubahan modal yang sah: setoran/penarikan modal dan wizard
Saldo Awal.

---

## 7. Arus Kas

Buka **Arus Kas**, pilih periode. Laporan memakai **metode langsung** dari mutasi
akun kas/bank:

- **Kas masuk** = debit akun kas/bank.
- **Kas keluar** = kredit akun kas/bank.
- **Arus kas bersih** = masuk − keluar.
- Saldo awal + arus kas bersih harus sama dengan saldo akhir kas/bank pada
  cut-off yang sama (cocokkan dengan Buku Besar/Neraca).

Pindah dana antar kas/bank bukan arus kas keluar/masuk ekonomi; periksa apakah
laporan menampilkannya sebagai mutasi internal sesuai tampilan aplikasi.

---

## 8. Koreksi: reversal + isi ulang

**Jangan pernah mengedit atau menghapus jurnal yang sudah tersimpan.** Semua
koreksi harus dapat diaudit.

Langkah baku:

1. Buka **Jurnal Umum**, cari jurnal yang salah.
2. Tekan **Koreksi**, isi **alasan** (wajib, minimal 5 karakter).
3. Periksa **pratinjau jurnal balik**: debit/kredit ditukar, nomor bukti baru.
   **Default tanggal balik adalah tanggal jurnal asli** agar koreksi tetap di
   periode yang sama. Tanggal balik boleh diubah secara eksplisit, termasuk ke
   tahun yang lebih baru, tetapi **tidak boleh lebih awal dari tanggal jurnal
   asli**. Koreksi yang perlu memindahkan tanggal lebih awal hanya bisa lewat
   **Wizard Koreksi Saldo Awal**.
4. Bila tanggal balik dan tanggal pengganti jatuh di tahun berbeda, aplikasi
   menampilkan peringatan kuning. Periksa dampaknya ke Laba Rugi tahunan sebelum
   menyimpan. Untuk koreksi biasa, pertahankan default tanggal asli.
5. Simpan. Jurnal asli tetap ada; jurnal balik menetralkan saldonya.
6. Bila perlu, gunakan **Koreksi & isi ulang** — form terbuka dengan data lama
   sebagai awalan. Sistem membuat jurnal balik + jurnal pengganti dalam satu
   alur. **Jenis jurnal pengganti wajib sama** dengan jurnal asli; aplikasi
   menolak perubahan jenis (mis. `BAYAR` menjadi `UMUM` atau `SALDO_AWAL`).
7. Periksa kembali Buku Besar, Neraca Saldo, dan laporan terkait.

Aturan penting:

- Reversal ganda atas jurnal yang sama ditolak.
- Reversal atas jurnal reversal ditolak.
- **Jurnal pembukaan aktif dan penggantinya tidak boleh dibalik/dikoreksi dari
  Jurnal Umum.** Jurnal yang ditunjuk `saldo_awal_aktif_id`, berperan
  `OPENING`/`OPENING_REPLACEMENT`, atau berjenis `SALDO_AWAL` hanya bisa
  dikoreksi lewat **Wizard Koreksi Saldo Awal**. Pesannya mengarahkan ke wizard,
  bukan menawarkan jalur generik.
- Jurnal yang terhubung ke dokumen panjar (`jurnal_open_id`/`jurnal_close_id`)
  tidak boleh direversal dari Jurnal Umum. Gunakan modul **Panjar**: tombol
  **Batalkan** untuk panjar OPEN yang salah serah (membuat jurnal balik
  `D kas / K 1040`, wajib alasan, status menjadi DIBATALKAN), atau alur
  pertanggungjawaban untuk panjar yang benar. Panjar CLOSED belum bisa
  dibatalkan lewat modul Panjar. Panjar `sumber = 'SALDO_AWAL'` memakai
  pembatalan khusus tanpa jurnal balik (lihat §14).
- Panjar yang dibatalkan tetap menyimpan jurnal serah asli dan jurnal balik;
  tidak ada jurnal yang dihapus. Audit `PANJAR-BATAL` mencatat alasan dan link
  `jurnal_batal_id`.
- Koreksi di periode yang sudah ditutup wajib alasan dan tercatat di audit.
- Koreksi setelah kunci periode tidak boleh membuat Neraca selisih.

**Peringatan dan alasan.** Peringatan seperti kas/bank akan minus atau realisasi
panjar melebihi panjar tidak memblokir penyimpanan, tetapi wajib dikonfirmasi.
Di form Transaksi, Jurnal Umum, Saldo Awal, dan Panjar, konfirmasi baru bisa
dilanjutkan setelah **alasan minimal 5 karakter** diisi; alasan tercatat di
Riwayat Audit. Alasan koreksi jurnal juga wajib minimal 5 karakter.

---

## 9. Kunci periode

1. Pastikan **Neraca Saldo seimbang** dan laporan tahun tersebut sudah diperiksa.
2. Buka **Kunci Periode**.
3. Hanya tahun yang sudah selesai boleh dikunci (mis. pada 2026 maksimal 2025).
   Tahun berjalan ditolak.
4. Tekan **Preview laba**, periksa laba dan laba ditahan.
5. **Backup otomatis & lanjut** akan membuat backup `.db` sebelum kunci.
6. Isi catatan pemeriksaan (opsional), lalu konfirmasi.

Kunci periode hanya menyimpan penanda tahun, waktu, dan catatan. Path/lokasi file
backup tidak disimpan di riwayat kunci periode; backup otomatis tetap dibuat
sebagai berkas terpisah di folder `backups`. **Laba tidak disimpan sebagai
sumber angka.** Mengunci ulang tahun yang sama tercatat sebagai `TUTUP-ULANG`
dan menulis **snapshot versi baru**; snapshot lama tidak diubah. Snapshot adalah
bukti angka saat tutup, bukan sumber laporan. Setelah dikunci, koreksi masih
boleh dengan alasan.

Sebelum mengunci periode, aplikasi menjalankan audit integritas. **Semua
temuan integritas memblokir kunci periode, kecuali `SNAPSHOT_TUTUP_BERUBAH`**
yang hanya peringatan kontrol (non-blok) agar kunci ulang yang dikonfirmasi
tetap bisa mencatat versi snapshot baru, dan `PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS`
yang juga kontrol non-blok (kondisi aneh tetapi tidak merusak GL). Daftar kode
dan tindakannya ada di §14.

Kunci periode **tidak membuat jurnal penutup** dan tidak memindahkan saldo
PENDAPATAN/BEBAN ke akun ekuitas. Jangan membuat jurnal penutup manual: sistem
menolak jurnal yang mencampur akun PENDAPATAN/BEBAN dengan EKUITAS dalam satu
jurnal (termasuk `3000 MODAL`; `3001`/`3002` juga tidak dapat diposting).
Pengecualian hanya jurnal **Saldo Awal** dari wizard Saldo Awal. Laba tahun
berjalan tetap dihitung dari jurnal; laba ditahan bertambah dari daftar tahun
yang dikunci, bukan dari jurnal buatan operator.

---

## 10. Audit

Buka **Pengaturan → Riwayat Audit**.

- Filter berdasarkan aksi, tanggal, dan jumlah baris per halaman.
- Filter **Jenis referensi** + **ID referensi** mencari jejak satu objek tanpa
  menebak teks aksi:
  - `jurnal` + ID jurnal: pembuatan jurnal, saldo awal, reversal, dan koreksi
    isi ulang untuk jurnal tersebut;
  - `panjar` + ID panjar: serah, close, dan pembatalan dokumen panjar;
  - `pinjaman` + ID pinjaman: pembuatan, pencairan, dan pembayaran angsuran;
  - `tutup_buku` + tahun (mis. `2026`): tutup dan tutup ulang tahun itu;
  - `akun` + kode 4 digit: tambah, ubah nama, aktif/nonaktif akun.
- Referensi dicocokkan **persis** (ID `j-1` tidak ikut mengambil `j-10`), dan
  tetap bisa digabung dengan filter tanggal serta pagination.
- Baris audit lama dari sebelum fitur referensi tetap tampil; kolom
  referensinya kosong dan tidak diubah karena audit bersifat append-only.
- Klik **Lihat** untuk melihat data sebelum/sesudah dan referensi objek.
- Aksi penting yang harus muncul: pembuatan jurnal, `REVERSAL`,
  `KOREKSI-ISI-ULANG`, `KOREKSI-SALDO-AWAL`, `TUTUP`/`TUTUP-ULANG`,
  `SALDO-AWAL`, `PANJAR`/`PANJAR-BATAL`, `BACKUP`/`RESTORE`, dan perubahan
  `PENGATURAN`.
- Audit tidak pernah menyimpan PIN, salt, atau hash PIN.

Gunakan audit untuk menjawab: siapa/apa yang berubah, kapan, dan dengan alasan
apa. Audit tidak boleh dihapus dari UI.

**Catatan keamanan:** PIN adalah kunci akses aplikasi, **bukan enkripsi**.
Siapa pun yang memegang `pura.db` atau file backup dapat membaca isinya dengan
alat SQLite biasa. Audit di dalam aplikasi juga tidak melindungi file dari
penyalinan; perlindungan file harus lewat akun OS dan enkripsi disk.

---

## 11. Glosarium

| Istilah | Arti sederhana |
|---|---|
| **Debit (D)** | Sisi kiri jurnal. Menambah aset/beban; mengurangi kewajiban/ekuitas/pendapatan. |
| **Kredit (K)** | Sisi kanan jurnal. Menambah kewajiban/ekuitas/pendapatan; mengurangi aset/beban. |
| **Aktiva (aset)** | Harta yang dimiliki: kas, bank, piutang, dan panjar. |
| **Kewajiban (hutang)** | Yang masih harus dibayar pura kepada pihak lain. |
| **Ekuitas (modal)** | Hak pemilik atas aset setelah dikurangi kewajiban; terdiri dari modal, laba ditahan, dan laba berjalan. |
| **Pendapatan** | Penghasilan periode: parkir, sesari, punia, kios, bunga, dll. Menambah ekuitas. |
| **Beban** | Biaya periode: upakara, listrik, perbaikan, administrasi, dll. Mengurangi ekuitas. |
| **Laba** | Pendapatan − beban dalam satu periode. Negatif = rugi/defisit. |
| **Laba ditahan** | Akumulasi laba tahun-tahun yang sudah ditutup, belum dibagikan/dipakai. |
| **Neraca Saldo** | Daftar saldo semua akun pada tanggal tertentu; total debit harus sama dengan total kredit. |
| **Buku Besar** | Riwayat mutasi per akun beserta saldo berjalan. |
| **Reversal** | Jurnal balik yang menetralkan jurnal salah; jurnal asli tetap tersimpan. |
| **Kunci periode** | Mengunci periode tahun yang sudah selesai dan mencatat pemeriksaan; bukan menyimpan laba. |

---

## 12. Checklist singkat sebelum menandatangani laporan

- [ ] Jurnal Umum: semua transaksi punya tanggal, keterangan, nomor bukti, dan
      lawan akun yang wajar.
- [ ] Dokumen bukti transaksi material tersedia di arsip fisik.
- [ ] Buku Besar: saldo awal/berjalan/akhir konsisten.
- [ ] Neraca Saldo: **selisih 0**; mode tahun berjalan/kumulatif sesuai tujuan
      pemeriksaan dan baris laba ditahan sudah dipahami.
- [ ] Laba Rugi cocok dengan Buku Besar pendapatan/beban.
- [ ] Neraca: aset = kewajiban + ekuitas.
- [ ] Arus Kas cocok dengan mutasi kas/bank.
- [ ] Audit: koreksi dan kunci periode punya alasan.
- [ ] Backup Lengkap (`pura.db` + `manifest.json`) atau Backup Export `.db`
      sudah dibuat.

---

## 13. Checklist cepat pemulihan

Pakai checklist ini setelah koreksi saldo awal, restore, atau saat aplikasi
menolak database. Langkah untuk operator ada di `docs/panduan-pengguna.md` §10
dan README bagian **Runbook singkat**.

- [ ] **Status saldo awal** — wizard saldo awal terkunci dan saldo awal aktif
      ada. Bila pernah dikoreksi, pastikan tetap hanya ada satu jurnal
      `SALDO_AWAL`; koreksi tidak boleh membuat saldo awal kedua.
- [ ] **Audit KOREKSI-SALDO-AWAL** — ada audit dengan alasan minimal 5 karakter
      yang menunjuk jurnal lama, jurnal balik, dan jurnal penyesuaian. Jurnal
      lama tidak diedit/dihapus; laporan memakai angka baru.
- [ ] **Backup terakhir** — Backup Lengkap terbaru (`pura.db` +
      `manifest.json`) atau backup otomatis tersedia, disimpan di media/disk
      terenkripsi. Ingat backup **tidak terenkripsi** dan PIN **bukan enkripsi**.
- [ ] **Integritas** — Neraca Saldo selisih 0; kandidat restore lolos
      `integrity_check`, foreign key, skema v2, dan 12 tabel wajib. Bila database
      ditolak karena tabel/kolom hilang, **pulihkan dari backup**, jangan membuat
      DB baru.
- [ ] **Lockout PIN** — setelah 5 kali PIN salah, aplikasi memblokir 60 detik
      dan blokir bertahan setelah restart; PIN benar setelah blokir habis
      membersihkan state. Lockout hanya melindungi UI, bukan isi file.

---

## 14. Temuan audit integritas

Audit integritas membaca DB tanpa mengubah apa pun. Temuannya muncul di pratinjau
kunci periode dan dapat diperiksa sebelum laporan ditandatangani. **Semua kode
di bawah memblokir kunci periode, kecuali `SNAPSHOT_TUTUP_BERUBAH` dan
`PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS`** yang merupakan kontrol
non-blok.

| Kode | Arti | Tindakan | Blokir? |
|---|---|---|---|
| `NERACA_TIDAK_SEIMBANG` | Neraca pada cutoff jurnal terakhir/hari ini tidak seimbang: total aset ≠ total pasiva. Biasanya karena baris jurnal tidak seimbang, P&L sebelum cut-over, atau saldo awal/pembukaan tidak konsisten. | Jangan menutup periode atau membuat laporan resmi. Periksa Neraca Saldo, jurnal tidak seimbang, cut-over, dan saldo awal. Perbaiki lewat koreksi/wizard, lalu ulangi audit. | Ya |
| `NERACA_SALDO_SELISIH` | Neraca Saldo mode **kumulatif** atau **tahun** selisih (total debit ≠ total kredit). Bisa muncul satu temuan per mode. | Periksa baris jurnal yang tidak seimbang dan P&L sebelum cut-over; jangan menutup periode sampai selisih 0. | Ya |
| `CUTOVER_TIDAK_KONSISTEN` | `pengaturan.cutover_tanggal` berbeda dari tanggal jurnal pembukaan aktif. Biasanya karena setting diubah manual setelah saldo awal. | Jangan mengubah tanggal cut-over manual. Jalankan **Wizard Koreksi Saldo Awal** agar penunjuk pembukaan dan tanggal cut-over diperbarui bersama. | Ya |
| `PEMBUKAAN_AKTIF_HILANG` | Ada jurnal `SALDO_AWAL`, tetapi `saldo_awal_aktif_id` kosong/tidak valid, atau menunjuk jurnal yang bukan pembukaan aktif (sudah dibalik/digantikan). | Perbaiki lewat **Wizard Koreksi Saldo Awal**; jangan membuat jurnal pembukaan baru atau mengubah jurnal lama. Bila data berasal dari restore, pertimbangkan pulihkan backup yang lebih sehat. | Ya |
| `LABA_RUGI_SEBELUM_CUTOVER` | Ada baris PENDAPATAN/BEBAN bertanggal sebelum cut-over resmi di luar grup pembukaan. P&L itu tidak boleh dilaporkan sebagai laba tahun pertama. | Pindahkan/benahi baris lewat **Wizard Koreksi Saldo Awal** atau koreksi jurnal yang benar; jangan mengubah tanggal cut-over manual. | Ya |
| `SALDO_AWAL_MEMUAT_LABA_RUGI` | Jurnal pembukaan (atau pengganti) memuat akun PENDAPATAN/BEBAN. Saldo awal hanya boleh AKTIVA, KEWAJIBAN, dan EKUITAS. | Perbaiki lewat **Wizard Koreksi Saldo Awal**; akun P&L sebelum cut-over harus tercermin di ekuitas/modal awal, bukan di jurnal pembukaan. | Ya |
| `SNAPSHOT_TUTUP_BERUBAH` | Snapshot kunci periode versi terbaru berbeda dari angka/hash jurnal live. Penyebab sah: koreksi setelah kunci periode. Bisa juga data rusak. Snapshot tidak diubah otomatis. | Periksa rincian perbedaan dan audit koreksi setelah kunci periode. Bila memang ada koreksi sah, lakukan **KUNCI ULANG** yang dikonfirmasi agar versi snapshot baru tercatat; jangan mengedit snapshot. | **Tidak** (kontrol) |
| `PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS` | Outstanding pinjaman sudah 0 tetapi masih ada angsuran berstatus BELUM/SEBAGIAN. Hanya mungkin lewat pembayaran pelunasan tanpa `angsuran_id` (skema mengizinkan, tetapi tidak diekspos UI/IPC) atau cicilan yang tidak pernah dilengkapi; akses pustaka/SQL langsung. Rekonsiliasi GL 2050 vs jadwal tetap cocok, jadi kondisi ini tidak merusak GL tetapi tampak kontradiktif di layar. | Periksa daftar pembayaran pinjaman yang disebut temuan: bila pelunasan memang sah, catat penjelasannya; bila salah taut/cicilan menggantung, perbaiki lewat modul pinjaman (tautkan pembayaran ke angsuran atau buat jurnal balik lewat pintu resmi). Aplikasi tidak mengoreksi otomatis. | **Tidak** (kontrol) |
| `PANJAR_OPENING_TIDAK_LENGKAP` | Panjar `sumber = 'SALDO_AWAL'` tidak lengkap: `jurnal_open_id` kosong/tidak ditemukan, menunjuk jurnal yang bukan `OPENING`/`OPENING_REPLACEMENT`, total panjar OPEN melebihi debit neto `1040` jurnal pembukaan, penunjuk pembukaan aktif tidak sah, atau panjar OPEN menunjuk jurnal yang bukan pembukaan aktif saat ini (pembukaan lama sudah dibalik/digantikan koreksi saldo awal — bisa terjadi meski saldo GL `1040` masih cocok). | Periksa dokumen panjar dan jurnal pembukaan. Bila jurnal pembukaan sudah dikoreksi, perbarui penunjuk dokumen representasi agar menunjuk pembukaan aktif lewat **Wizard Koreksi Saldo Awal**; bila belum ada realisasi, pembatalan khusus panjar saldo awal menghapus dokumen tanpa jurnal balik. Close panjar dengan pointer basi juga ditolak sampai penunjuk diperbarui. Jangan membuat jurnal serah kedua untuk 1040 yang sudah ada. | Ya |

Catatan:

- Temuan kontrol (`SNAPSHOT_TUTUP_BERUBAH`,
  `PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS`) **tidak memblokir**
  **KUNCI ULANG** yang sudah dikonfirmasi, tetapi tetap harus ditampilkan dan
  diperiksa. Temuan lain memblokir kunci periode **dan** kunci ulang sampai
  data diperbaiki.
- Jangan memperbaiki temuan dengan mengedit/menghapus jurnal, snapshot, atau
  audit langsung lewat SQLite. Gunakan wizard/koreksi resmi, atau pulihkan dari
  backup sehat bila data memang rusak.
- Setelah perbaikan, jalankan ulang audit integritas dan pastikan Neraca Saldo
  selisih 0 sebelum mengunci periode.
