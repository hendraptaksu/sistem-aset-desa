# Panduan Pemeriksaan — Keuangan Pura Dalem Puri

**Versi aplikasi:** 1.2.0  
**Tanggal dokumen:** 2026-10-23  
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
7. **Rekonsiliasi Bank** — cocokkan saldo buku dengan rekening koran.
8. **Anggaran** — bandingkan realisasi dengan pagu.
9. **Riwayat Audit** — periksa koreksi, tutup buku, backup/restore, perubahan
   pengaturan.

Semua layar laporan bisa **drill-down**: klik baris/akun → daftar jurnal → detail
debit/kredit + nomor bukti. Gunakan ini untuk membuktikan angka sampai ke
transaksi aslinya.

---

## 2. Jurnal Umum

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
  - piutang/hutang → `1050`/`2050` sesuai arah, bukan akun beban.
- **Lampiran bukti** ada untuk transaksi material (foto kuitansi/PDF). Lampiran
  tidak mengubah angka; hanya bukti pendukung.

### Tanda bahaya

- Beban besar tetapi lawannya bukan kas/hutang (mis. langsung ke modal).
- Perbaikan/penambahan aset dibebankan ke modal, padahal seharusnya beban atau
  hutang.
- Transfer antar kas/bank yang memakai akun pendapatan/beban.
- Jurnal dengan dua baris yang keduanya debit atau keduanya kredit (sistem
  menolak, tetapi periksa bila ada data lama/import).
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
- `1040 UANG PANJAR` — harus nol bila semua panjar sudah ditutup.
- `1050 PIUTANG LAIN-LAIN` dan `2050 HUTANG LAIN-LAIN` — cocokkan dengan saldo
  per pihak di menu **Piutang & Hutang**.
- `3000 MODAL` — hanya berubah karena setoran/penarikan modal atau Saldo Awal.

Bila saldo tidak wajar, klik baris jurnal untuk melihat detail, lalu koreksi
lewat mekanisme di bagian 9.

---

## 4. Neraca Saldo

Buka **Neraca Saldo** dan pilih cut-off.

**Aturan mutlak:** total debit = total kredit; **selisih harus 0**. Bila ada
selisih, jangan tutup buku dan jangan membuat laporan resmi. Cari jurnal yang
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
kalender)**; tahun buku fiskal (mis. mulai Juli) **belum didukung**. Karena itu
semua laporan memakai rentang Januari–Desember, bukan tahun fiskal.

- **Pendapatan** = total kredit akun pendapatan (posisi normal kredit).
- **Beban** = total debit akun beban (posisi normal debit).
- **Laba/rugi** = pendapatan − beban. Negatif = defisit dan ditampilkan dengan
  tanda kurung/Rp negatif.
- Cocokkan total pendapatan/beban dengan Buku Besar akun terkait.
- Bila ada pendapatan/beban yang seharusnya masuk tahun lain, periksa tanggal
  jurnal — bukan mengubah angka laporan.
- Bila **Pengaturan** menampilkan peringatan bahwa data lama masih memakai awal
  tahun buku selain Januari (mis. bulan 7), jangan mengubah data secara manual.
  Buka Pengaturan, pastikan field **Awal tahun buku** menunjukkan
  “Januari (tahun kalender)”, lalu tekan **Simpan Pengaturan Pembukuan**.
  Aplikasi tidak mengubah setting lama secara otomatis.

Catatan: laporan ini **tidak** memakai angka tersimpan. Koreksi jurnal setelah
periode berjalan langsung mengubah Laba Rugi saat dibuka ulang.

---

## 6. Neraca

Buka **Neraca** dan pilih cut-off.

- **Aset** = saldo akun AKTIVA (kas/bank, piutang, panjar, aset lain).
- **Kewajiban** = saldo akun KEWAJIBAN (mis. `2050`).
- **Ekuitas** = modal + laba ditahan + laba berjalan (dihitung dari jurnal).
- **Aset = Kewajiban + Ekuitas**. Bila tidak sama, lihat status **Neraca Saldo**
  dan jangan tutup buku.
- **Laba ditahan** = akumulasi laba tahun-tahun yang sudah ditutup. Laba tahun
  berjalan terpisah sampai tahun itu ditutup.
- Bila ada koreksi setelah tutup buku, Neraca tahun berikutnya harus tetap
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

## 8. Rekonsiliasi Bank

Buka **Rekonsiliasi Bank**.

1. Pilih akun kas/bank (hanya akun kas/bank; `1040` dan `1050` tidak boleh).
2. Isi tanggal dan **saldo menurut rekening koran**.
3. Aplikasi menampilkan **saldo buku** (dari jurnal), **selisih**, dan status
   **Cocok/Lebih/Kurang**. Yang disimpan hanya saldo rekening koran; saldo buku
   dan selisih selalu dihitung ulang.
4. Bila selisih, isi catatan/alasan selisih, lalu simpan.
5. Setelah ditelusuri, tekan **Tandai Selesai**. Ini hanya menandai rekonsiliasi
   sudah diperiksa; **tidak mengubah jurnal**.

Yang diperiksa:

- Setoran/penarikan yang belum tercatat di aplikasi.
- Biaya administrasi bank, bunga, atau pajak yang belum dijurnal.
- Cek/transfer yang sudah dicatat tetapi belum cair di rekening koran.
- Saldo awal rekonsiliasi sebelumnya.

---

## 9. Anggaran & Realisasi

Buka **Anggaran**.

- **Pagu** diisi per tahun dan per akun PENDAPATAN/BEBAN. Pagu adalah satu-satunya
  angka yang disimpan.
- **Realisasi** dihitung dari jurnal pada rentang tahun buku.
- Kolom **Sisa** = pagu − realisasi; **%** = realisasi / pagu.
- Periksa akun yang realisasinya melebihi pagu, lalu cari jurnalnya lewat
  drill-down/Buku Besar.
- Pagu boleh diubah dengan alasan; perubahan tercatat di audit.

---

## 10. Koreksi: reversal + isi ulang

**Jangan pernah mengedit atau menghapus jurnal yang sudah tersimpan.** Semua
koreksi harus dapat diaudit.

Langkah baku:

1. Buka **Jurnal Umum**, cari jurnal yang salah.
2. Tekan **Koreksi**, isi **alasan** (wajib, minimal 5 karakter).
3. Periksa **pratinjau jurnal balik**: debit/kredit ditukar, tanggal bisa diatur,
   nomor bukti baru.
4. Simpan. Jurnal asli tetap ada; jurnal balik menetralkan saldonya.
5. Bila perlu, gunakan **Koreksi & isi ulang** — form terbuka dengan data lama
   sebagai awalan. Sistem membuat jurnal balik + jurnal pengganti dalam satu
   alur.
6. Periksa kembali Buku Besar, Neraca Saldo, dan laporan terkait.

Aturan penting:

- Reversal ganda atas jurnal yang sama ditolak.
- Reversal atas jurnal reversal ditolak.
- Jurnal yang terhubung ke dokumen panjar (`jurnal_open_id`/`jurnal_close_id`)
  tidak boleh direversal dari Jurnal Umum. Koreksi panjar belum lewat Jurnal
  Umum; gunakan modul **Panjar** agar status dokumen tidak basi. Alur
  **Batalkan panjar** masih backlog (belum tersedia).
- Koreksi di periode yang sudah ditutup wajib alasan dan tercatat di audit.
- Koreksi setelah tutup buku tidak boleh membuat Neraca selisih.

---

## 11. Tutup buku

1. Pastikan **Neraca Saldo seimbang** dan laporan tahun tersebut sudah diperiksa.
2. Buka **Tutup Buku**.
3. Hanya tahun yang sudah selesai boleh ditutup (mis. pada 2026 maksimal 2025).
   Tahun berjalan ditolak.
4. Tekan **Preview laba**, periksa laba dan laba ditahan.
5. **Backup otomatis & lanjut** akan membuat backup `.db` sebelum kunci.
6. Isi catatan pemeriksaan, lalu konfirmasi.

Tutup buku hanya menyimpan penanda tahun, waktu, path backup, dan catatan.
**Laba tidak disimpan sebagai sumber angka.** Menutup ulang tahun yang sama
tercatat sebagai `TUTUP-ULANG`. Setelah tutup, koreksi masih boleh dengan alasan.

---

## 12. Audit

Buka **Pengaturan → Riwayat Audit**.

- Filter berdasarkan aksi, tanggal, dan jumlah baris per halaman.
- Klik **Lihat** untuk melihat data sebelum/sesudah.
- Aksi penting yang harus muncul: pembuatan jurnal, `REVERSAL`,
  `KOREKSI-ISI-ULANG`, `TUTUP`/`TUTUP-ULANG`, `SALDO-AWAL`, `PANJAR`,
  `BACKUP`/`RESTORE`, perubahan `PENGATURAN`, serta tambah/hapus lampiran.
- Audit tidak pernah menyimpan PIN, salt, atau hash PIN.

Gunakan audit untuk menjawab: siapa/apa yang berubah, kapan, dan dengan alasan
apa. Audit tidak boleh dihapus dari UI.

---

## 13. Glosarium

| Istilah | Arti sederhana |
|---|---|
| **Debit (D)** | Sisi kiri jurnal. Menambah aset/beban; mengurangi kewajiban/ekuitas/pendapatan. |
| **Kredit (K)** | Sisi kanan jurnal. Menambah kewajiban/ekuitas/pendapatan; mengurangi aset/beban. |
| **Aktiva (aset)** | Harta yang dimiliki: kas, bank, piutang, panjar, inventaris (inventaris tidak masuk Neraca keuangan). |
| **Kewajiban (hutang)** | Yang masih harus dibayar pura kepada pihak lain. |
| **Ekuitas (modal)** | Hak pemilik atas aset setelah dikurangi kewajiban; terdiri dari modal, laba ditahan, dan laba berjalan. |
| **Pendapatan** | Penghasilan periode: parkir, sesari, punia, kios, bunga, dll. Menambah ekuitas. |
| **Beban** | Biaya periode: upakara, listrik, perbaikan, administrasi, dll. Mengurangi ekuitas. |
| **Laba** | Pendapatan − beban dalam satu periode. Negatif = rugi/defisit. |
| **Laba ditahan** | Akumulasi laba tahun-tahun yang sudah ditutup, belum dibagikan/dipakai. |
| **Neraca Saldo** | Daftar saldo semua akun pada tanggal tertentu; total debit harus sama dengan total kredit. |
| **Buku Besar** | Riwayat mutasi per akun beserta saldo berjalan. |
| **Reversal** | Jurnal balik yang menetralkan jurnal salah; jurnal asli tetap tersimpan. |
| **Tutup buku** | Mengunci periode tahun yang sudah selesai dan mencatat pemeriksaan; bukan menyimpan laba. |

---

## 14. Checklist singkat sebelum menandatangani laporan

- [ ] Jurnal Umum: semua transaksi punya tanggal, keterangan, nomor bukti, dan
      lawan akun yang wajar.
- [ ] Bukti/lampiran tersedia untuk transaksi material.
- [ ] Buku Besar: saldo awal/berjalan/akhir konsisten.
- [ ] Neraca Saldo: **selisih 0**.
- [ ] Laba Rugi cocok dengan Buku Besar pendapatan/beban.
- [ ] Neraca: aset = kewajiban + ekuitas.
- [ ] Arus Kas cocok dengan mutasi kas/bank.
- [ ] Rekonsiliasi Bank sudah ditandai selesai atau selisihnya dijelaskan.
- [ ] Anggaran: realisasi dan sisa sudah diperiksa.
- [ ] Audit: koreksi dan tutup buku punya alasan.
- [ ] Backup `.db` **dan** folder `attachments` sudah dibuat.
