# Audit pembukuan bendahara pura — 2 November 2026

**Penilaian:** fondasi jurnal dua sisi layak dipertahankan, tetapi versi ini belum layak dijadikan sumber pembukuan resmi sebelum cacat hubungan jurnal–pinjaman, klasifikasi arus kas, dan jalur koreksi dibereskan. Seimbang secara matematis belum berarti lengkap, benar akun, benar periode, atau sesuai bukti.

Audit dilakukan terhadap commit `1e9c8a8`, dengan asumsi seluruh data masih dummy dan desain database boleh dirombak. Cakupan: kode akuntansi, skema, jalur posting/koreksi, laporan, panjar, pinjaman, input harian, penguncian periode, backup, dan tes. Penilaian UX memadukan pembacaan kode dengan pengujian Electron terfokus. Audit tidak mencocokkan data dengan kas fisik, rekening koran, atau bukti transaksi nyata.

**Bukti yang dapat diulang:** [skrip reproduksi](audit/repro-akuntansi-2026-11-02.ts) dan [hasil observasi](audit/observasi-2026-11-02.txt). Jalankan dari root repo:

```sh
node --import tsx docs/audit/repro-akuntansi-2026-11-02.ts
```

Skrip hanya membuka database `:memory:`. Nilai output dalam Rupiah, kecuali kasus pecahan sen yang menampilkan nilai mentah database. Skrip mendokumentasikan perilaku pada tanggal audit; perilaku yang salah tidak boleh dijadikan kontrak tes yang dipertahankan.

**Validasi yang dijalankan:**

| Pemeriksaan | Hasil |
|---|---|
| `npm test` | 82 berkas, 977 tes lulus |
| `npm run typecheck` | Lulus |
| `npm run build` | Lulus |
| Skenario domain tambahan pada database sementara | Menghasilkan sembilan observasi, dirinci di bawah |
| Pengujian Electron terfokus | Pilihan akun otomatis dan hilangnya isian saat ganti jenis transaksi terkonfirmasi |
| `npm run test:e2e` | Gagal pada selector `Nonaktifkan` yang cocok dengan 53 tombol; aplikasi berhasil dibuka, setup PIN, dashboard, dan penambahan/pengubahan akun sempat berjalan |

Kegagalan smoke test ada di [e2e/smoke.test.mjs](/Users/taksu/Documents/taksu/sistem-aset-desa/e2e/smoke.test.mjs:142). Ini cacat pengujian karena selector tidak dibatasi ke baris akun; kegagalan ini tidak membuktikan fungsi nonaktifkan akun rusak. Rangkaian E2E penuh belum selesai, dan audit visual semua ukuran jendela tidak dijalankan.

**Yang sudah benar dan patut dipertahankan**

- Nominal divalidasi sebagai integer sen; debit/kredit positif dan keseimbangan diperiksa sebelum posting. Bukti: [core/posting.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/posting.ts:253).
- Jurnal dan audit ditulis dalam transaksi database yang sama. Koreksi biasa dapat membalik dan mengisi ulang secara atomik. Bukti: [db/posting.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/posting.ts:258), [db/reversal.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/reversal.ts:279).
- Trigger menolak perubahan/penghapusan jurnal serta audit lama. Bukti: [database.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/database.ts:413).
- Saldo dan laporan dihitung dari jurnal, termasuk akun yang kemudian dinonaktifkan. Form harian dan Jurnal Umum memakai fondasi yang sama.
- Validasi tanggal kalender, tanggal masa depan, akun aktif, dan nomor bukti sudah ada. Jurnal Umum tersembunyi dari operator harian sampai mode lanjutan dinyalakan.
- Backup memakai `VACUUM INTO`; kandidat restore diperiksa secara struktural, foreign key, dan akuntansi. Bukti: [export.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/features/export/export.ts:267).

**Temuan 1 — P1: reversal pinjaman memutus kesesuaian buku besar dan buku pinjaman. Terbukti melalui eksekusi.**

Skenario pertama: cairkan pinjaman Rp10.000.000, bayar seluruh pokok dan bunga, kemudian balik jurnal pembayaran. Buku besar kembali memiliki utang Rp10.000.000, tetapi modul pinjaman menunjukkan outstanding Rp0 dan angsuran `LUNAS`. `auditIntegritas()` mengembalikan `ok: true`, tanpa temuan.

Skenario kedua: balik jurnal pencairan. Buku besar kembali memiliki utang Rp0, tetapi modul pinjaman tetap menunjukkan outstanding Rp10.000.000. Audit kembali lolos.

Penyebab: guard koreksi hanya melindungi jurnal tertaut panjar; link pinjaman tetap menunjuk jurnal asli. Outstanding membaca pembayaran tertaut tanpa mengimbangi reversal. Rekonsiliasi pinjaman juga hanya menghitung jurnal tertaut, sehingga kelemahan yang sama muncul di angka operasional dan pemeriksaannya. Bukti: [reversal.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/reversal.ts:74), [pinjaman.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/pinjaman.ts:439), [integritas.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/integritas.ts:1143).

Akibat: bendahara dan akuntan mendapat dua jawaban berbeda untuk utang yang sama, disertai indikator pemeriksaan yang meyakinkan secara keliru.

Saran: segera lindungi semua jurnal yang dimiliki dokumen pinjaman dari koreksi generik. Sediakan tindakan koreksi/batalkan melalui modul pinjaman yang memperbarui rantai dokumen dan efek jurnal dalam satu transaksi. Rekonsiliasi harus menelusuri reversal serta membandingkan total subledger dengan akun kontrol; transaksi akun kontrol yang tidak teralokasi harus terlihat sebagai pengecualian, bukan hilang dari pemeriksaan.

**Temuan 2 — P1: pembayaran sebagian dapat diberi status lunas dan menghalangi pembayaran berikutnya. Terbukti melalui eksekusi.**

Skenario: jadwal pokok Rp10.000.000 dan bunga Rp100.000. Bayar bunga saja, dengan konfirmasi selisih. Pembayaran diterima, outstanding masih Rp10.000.000, tetapi status angsuran menjadi `LUNAS`. Saat pokoknya dibayar pada hari berikutnya, sistem menolak: satu angsuran hanya boleh dibayar satu kali.

Penyebab: status lunas ditentukan oleh keberadaan link pembayaran; satu link sekaligus dianggap penyelesaian angsuran. Padahal nominal berbeda dari jadwal, termasuk pokok nol, diperbolehkan. Bukti: [pinjaman.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/pinjaman.ts:279), [validasi selisih](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/pinjaman.ts:1317), [penolakan pembayaran berikutnya](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/pinjaman.ts:1407).

Saran: pisahkan pembayaran dari alokasinya ke angsuran. Satu angsuran boleh menerima beberapa alokasi; status `BELUM`, `SEBAGIAN`, dan `LUNAS` diturunkan dari nominal yang masih terutang setelah koreksi. Bila cakupan MVP hanya mendukung pembayaran penuh, nominal kurang harus ditolak dengan penjelasan yang jelas, dan pembayaran bunga saja perlu jalur tersendiri. Konfirmasi selisih tidak boleh mengubah arti kata lunas.

**Temuan 3 — P1: pokok pinjaman salah masuk arus kas operasi saat dibayar bersama bunga. Terbukti melalui eksekusi.**

Pembayaran pokok Rp10.000.000 + bunga Rp100.000 menghasilkan operasi keluar Rp10.100.000 dan pendanaan keluar Rp0. Total kas tetap benar; klasifikasi laporannya salah.

Penyebab: satu jurnal diberi satu kelompok arus kas. Kehadiran satu akun beban mengutamakan seluruh jurnal ke `OPERASI`, termasuk pokok pinjaman. Bukti: [reports.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/reports.ts:930). Ini juga dapat memengaruhi jurnal gabungan lain yang menyentuh beberapa kelompok arus kas.

Saran: kelompokkan komponen transaksi. Pokok pinjaman masuk pendanaan; bunga mengikuti kebijakan akuntansi yang dipilih dan diterapkan konsisten. Untuk kebijakan bunga operasi, contoh tersebut menjadi pendanaan keluar Rp10.000.000 dan operasi keluar Rp100.000. Referensi pembanding untuk definisi aktivitas pendanaan: [IAS 7, IFRS Foundation](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/). Pemilihan klasifikasi bunga perlu mengikuti kerangka dan periode pelaporan yang digunakan pura.

**Temuan 4 — P1: saldo awal dianggap penerimaan kas periode. Terbukti melalui eksekusi.**

Masukkan saldo awal kas Rp20.000.000 per 1 Januari 2025, tanpa aktivitas lain. Laporan 2025 menampilkan saldo awal Rp0, penerimaan pendanaan Rp20.000.000, kenaikan kas Rp20.000.000, dan saldo akhir Rp20.000.000.

Kas tersebut sudah dimiliki pada awal pembukuan; tidak ada penerimaan pendanaan baru. Laporan seharusnya memisahkan saldo yang dibawa dari awal dari aktivitas periode. Penyebab: saldo awal dihitung sampai sehari sebelum rentang, sedangkan semua jurnal dalam rentang, termasuk `SALDO_AWAL`, diproses sebagai arus. Bukti: [reports.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/reports.ts:874), [pengelompokan jurnal](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/reports.ts:883).

Saran: bedakan saldo pembukaan dari mutasi usaha dan pastikan efek pembalik/koreksi saldo pembukaan diperlakukan konsisten. Untuk awal pembukuan di tengah tahun, gunakan tanggal mulai efektif dan beri label periode parsial. Memfilter satu jenis jurnal saja tanpa memperhatikan rantai koreksinya belum cukup.

**Temuan 5 — P1: panjar CLOSED belum memiliki alur koreksi yang menjaga dokumen dan jurnal tetap cocok. Terbukti melalui eksekusi dan penelusuran UI.**

Setelah panjar dipertanggungjawabkan, mengulang pertanggungjawaban ditolak. Reversal jurnalnya juga ditolak dengan pesan agar memakai modul Panjar. Modul tersebut hanya menyediakan pertanggungjawaban/pembatalan untuk `OPEN`, dan pembatalan `CLOSED` ditolak secara eksplisit. Bukti: [panjar.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/panjar.ts:314), [penolakan batal CLOSED](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/panjar.ts:575), [tombol UI](/Users/taksu/Documents/taksu/sistem-aset-desa/src/renderer/components/PanjarTab.tsx:1197).

Akibat: typo nominal, akun belanja, atau rincian nota pada pertanggungjawaban tidak mempunyai jalur perbaikan terpandu. Jurnal penyesuaian manual mungkin memperbaiki sebagian GL, tetapi tidak memperbarui rincian dokumen dengan sendirinya.

Saran: tindakan `Koreksi pertanggungjawaban` dengan versi dokumen, alasan, preview sebelum/sesudah, reversal, dan jurnal pengganti yang atomik. Bedakan pembatalan administratif dari pengembalian uang nyata: membalik panjar juga menyatakan kas kembali, sehingga perlu konfirmasi bahwa uang benar-benar diterima kembali.

**Temuan 6 — P2: mengganti jenis transaksi menghapus isian tanpa peringatan. Terbukti pada Electron.**

Isi nominal Rp125.000 dan keterangan di Terima Uang, lalu klik kartu Bayar. Hasil: tidak ada dialog isian belum disimpan, nominal menjadi kosong, dan keterangan menjadi kosong.

Penyebab: kartu langsung memanggil `setJenis`; form memakai `key={jenis}` sehingga state lama dibuang. Guard pindah tab tidak diterapkan pada pergantian jenis. Bukti: [TransaksiTab.tsx](/Users/taksu/Documents/taksu/sistem-aset-desa/src/renderer/components/TransaksiTab.tsx:222), [remount form](/Users/taksu/Documents/taksu/sistem-aset-desa/src/renderer/components/TransaksiTab.tsx:272), [cleanup dirty](/Users/taksu/Documents/taksu/sistem-aset-desa/src/renderer/components/TransaksiForm.tsx:243).

Saran: gunakan guard yang sama sebelum mengganti jenis, atau pertahankan draft per jenis. Draf yang hilang membuat operator harus mengingat dan mengetik ulang rincian transaksi, menambah peluang salah.

**Temuan 7 — P2: pilihan default memudahkan penyimpanan ke kas/kategori yang salah. Pilihan otomatis terkonfirmasi pada Electron; ini risiko desain.**

Form Terima Uang langsung memilih `1001 KAS` dan `4001 PENDAPATAN BEJI`. Form Bayar memprioritaskan `5010`; Catat Utang memprioritaskan `5003`. User cukup mengisi tanggal/nominal/keterangan untuk menyimpan ke pilihan yang sebenarnya belum dia tentukan. Bukti: [TransaksiForm.tsx](/Users/taksu/Documents/taksu/sistem-aset-desa/src/renderer/components/TransaksiForm.tsx:121), [default sumber uang](/Users/taksu/Documents/taksu/sistem-aset-desa/src/renderer/components/TransaksiForm.tsx:167), [default kas](/Users/taksu/Documents/taksu/sistem-aset-desa/src/renderer/components/TransaksiForm.tsx:240).

Saran: bila pilihan lebih dari satu, awalnya kosong dan wajib dipilih. Sediakan favorit yang dipilih sadar oleh bendahara. Ringkasan sebelum simpan memakai bahasa kejadian, misalnya “Rp125.000 masuk ke Bank A sebagai Punia Umum”, dengan debit/kredit dapat dibuka oleh pendamping. Validasi teknis tidak dapat menebak maksud transaksi.

**Temuan 8 — P2: status wizard saldo awal bertentangan dengan aturan penyimpanan. Terbukti melalui eksekusi.**

Setelah satu jurnal biasa tersimpan tanpa saldo awal, `statusSaldoAwal()` mengatakan `boleh: true`, tetapi `simpanSaldoAwal()` selalu menolak karena jurnal tidak kosong. Ketidaksesuaian ini memang tertulis dalam komentar kode, namun tetap menjadikan informasi UI tidak sesuai kemampuan sistem. Bukti: [saldoAwal.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/saldoAwal.ts:59), [guard simpan](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/saldoAwal.ts:102).

Saran: satu aturan status dan simpan. Awal pembukuan sebaiknya memiliki tahap persiapan eksplisit: tetapkan tanggal, cocokkan kas/rekening/utang/panjar, review, lalu mulai. Bila pengguna memilih mulai tanpa saldo, jelaskan konsekuensinya dan sediakan alur penyesuaian pembukaan yang aman. Selisih aset–utang otomatis ke modal adalah perhitungan residual yang dapat sah; ia tidak membuktikan semua saldo sudah dimasukkan.

**Temuan 9 — P1 jika laporan dimaksudkan berbasis akrual: periode beban panjar mengikuti tanggal pertanggungjawaban, bukan tanggal kejadian. Perilaku terbukti; kesalahannya bergantung kebijakan.**

Panjar Rp1.000.000 diserahkan 20 Desember 2025, nota belanja Rp900.000 bertanggal 28 Desember, dan dipertanggungjawabkan 5 Januari 2026. Hasil: beban 2025 Rp0, beban 2026 Rp900.000, serta saldo panjar per 31 Desember tetap Rp1.000.000.

Penyebab: `nota_tanggal` menjadi metadata, sedangkan jurnal seluruh realisasi memakai `tanggalClose`. Bukti: [panjar.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/panjar.ts:339), [tanggal jurnal](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/panjar.ts:350), [builder](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/forms.ts:662).

Saran: tetapkan basis pembukuan secara tertulis. Untuk akrual sederhana, pisahkan tanggal kejadian, tanggal bukti, dan waktu input; izinkan pengakuan realisasi pada periode kejadian atau penyesuaian akhir periode yang jelas. Untuk laporan kas internal, beri nama serta penjelasan yang sesuai. Saat ini Catat Utang sudah mengakui beban sebelum kas dibayar, sedangkan nota panjar menunggu close: ini alasan kebijakan perlu diperjelas.

**Temuan 10 — P2: kunci periode terlalu mudah dilewati untuk tujuan mencegah salah input. Kebijakan disengaja, bukan bug tersembunyi.**

Setiap jurnal ke periode tertutup dapat diterima dengan alasan minimal lima karakter. Koreksi default juga memakai tanggal transaksi asli. Laporan yang sebelumnya sudah dibagikan bisa berubah, meski histori jurnal tetap terjaga. Bukti: [periode.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/periode.ts:23), [tanggal reversal](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/reversal.ts:104).

Saran: kunci bulan/tahun secara tegas pada input biasa. Perubahan periode lama melalui tindakan khusus buka kembali/koreksi periode, alasan, daftar perubahan, lalu kunci ulang. Arsipkan versi laporan yang telah disetujui. Akuntan menentukan perlakuan koreksi lintas periode; pilihan periode koreksi perlu eksplisit agar dampaknya pada laporan lama jelas. Ini dapat dilakukan tanpa membangun sistem multi-user.

**Temuan 11 — P1 kebutuhan kontrol: tidak ada pencocokan kas/bank dengan bukti eksternal.**

Dokumentasi menyatakan rekonsiliasi bank dibatalkan; tabelnya juga termasuk modul yang dihapus. Bukti: [arah-akuntansi.md](/Users/taksu/Documents/taksu/sistem-aset-desa/docs/arah-akuntansi.md:229), [database.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/database.ts:501). Pemeriksaan panjar/pinjaman yang ada merupakan pencocokan antardata di dalam aplikasi, bukan pencocokan terhadap rekening koran.

Akibat: satu penerimaan yang terlupa, transaksi tercatat dua kali, atau pembayaran di rekening yang salah tetap dapat menghasilkan jurnal seimbang.

Saran paling bernilai untuk bendahara: pemeriksaan kas fisik dan saldo rekening per tanggal, saldo menurut buku, selisih, penjelasan transaksi belum cocok, serta penanda sudah diperiksa. Mulai dengan input manual saldo eksternal dan daftar transaksi; impor bank otomatis dapat menyusul. Ini kontrol dasar yang lebih mendesak daripada menambah banyak jenis laporan.

**Temuan 12 — Kebutuhan domain pura: dana khusus belum dimodelkan; laporan masih berbahasa ekuitas usaha.**

Skema jurnal/baris hanya mengelompokkan akun; belum ada dimensi dana atau pembatasan penggunaan. Istilah utama memakai `MODAL`, `Laba Rugi`, dan `laba ditahan`. Bukti: [database.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/database.ts:211), [types.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/types.ts:73), [coa.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/coa.ts:243).

Contoh risiko: punia pembangunan Rp100 juta disimpan bersama uang operasional. Saldo bank saja tidak menjawab berapa yang boleh dipakai untuk operasional. Memindahkan uang antar rekening juga tidak membebaskan pembatasan dana.

Saran: bila ada sumbangan dengan pembatasan, tambahkan dimensi dana sederhana: umum, upacara/kegiatan, pembangunan, serta aturan pembatasannya. Tampilkan saldo dan penggunaan dana, termasuk pelepasan pembatasan yang relevan. Program internal dan pembatasan pemberi dana perlu dibedakan. Bila seluruh dana memang bebas pembatasan, satu dana umum cukup.

Untuk pelaporan nonlaba, gunakan bahasa surplus/defisit serta aset neto, dan rancang laporan perubahan aset neto serta catatan kebijakan. IAI saat ini menggunakan ISAK 335; bahan IAI membahas pembatasan sumber daya dan membedakan penyajian dari pengakuan/pengukuran. Kerangka yang tepat untuk pura perlu dipilih bersama akuntan, bukan disimpulkan hanya dari jenis organisasi. Referensi: [Discussion Paper PIR ISAK 335, IAI 2025](https://web.iaiglobal.or.id/assets/files/file_sak/1.%20Discussion%20Paper%20PIR%20ISAK%20335%20%282025%2C%20Maret%2017%29.pdf). IAI juga telah mengesahkan amendemen pada Juni 2026; gunakan edisi dan ketentuan efektif yang sesuai: [pengumuman IAI](https://web.iaiglobal.or.id/Berita-IAI/detail/pengesahan_amendemen_isak_335).

**Temuan 13 — Risiko klasifikasi: deposito otomatis diperlakukan sebagai kas/setara kas.**

Kode `1030–1032`, bernama deposito, masuk `KODE_KAS` dan memperoleh `is_kas: true`. Bukti: [coa.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/coa.ts:160), [nama akun](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/coa.ts:232). Konsekuensinya saldo masuk total kas dan perpindahannya diperlakukan sebagai transfer antardompet.

Belum tersedia bukti tenor, likuiditas, atau pembatasan deposito; karena itu audit ini tidak menyatakan semua deposito tersebut pasti salah. Namun klasifikasi otomatis tidak cukup. Saran: pisahkan “rekening yang bisa dipilih di UI” dari “kas/setara kas untuk laporan”. Klasifikasikan deposito berdasarkan karakteristik sebenarnya; deposito yang bukan setara kas perlu perlakuan investasi. Referensi definisi: [IFRS Foundation, IAS 7](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/).

**Temuan 14 — P2: kontrak integer sen belum ditegakkan database dan audit. Terbukti melalui SQL langsung.**

Tanpa menonaktifkan trigger atau foreign key, database menerima debit `0.5` sen dan kredit `0.5` sen pada jurnal seimbang. SQLite menyimpannya sebagai `REAL`, dan audit tetap lolos. Bukti: [kolom nominal](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/database.ts:228), [pemeriksaan nominal audit](/Users/taksu/Documents/taksu/sistem-aset-desa/src/db/integritas.ts:476).

Jalur form saat ini memvalidasi integer, sehingga ini kelemahan pertahanan database terhadap penulis lain/bug baru, bukan bukti form normal menghasilkan pecahan sen.

Saran: karena belum produksi, rebuild tabel inti menjadi `STRICT`, tambahkan `CHECK` satu sisi, tipe/batas nominal, foreign key, dan validasi kalender. Jika tetap memakai JavaScript `number`, nominal individual dan total harus aman pada rentang integer JavaScript. Pertimbangkan penanda finalisasi jurnal agar baris tidak bisa ditambahkan setelah posting selesai; draft dapat dikelola terpisah agar histori posted tetap sederhana.

**Temuan 15 — P2: backup harian belum berarti transaksi hari ini sudah tercadangkan.**

Backup otomatis dibuat saat startup, kemudian tidak diperbarui bila file bertanggal hari ini sudah ada. Penjadwal 30 menit hanya mengecek pergantian hari; penutupan aplikasi tidak membuat snapshot akhir sesi. Bukti: [index.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/main/index.ts:374), [backupPeriodik.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/main/backupPeriodik.ts:64), [export.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/features/export/export.ts:531).

Akibat: status backup “hari ini” bisa tetap benar sementara semua input setelah startup belum masuk salinan tersebut. Backup di disk yang sama juga tidak menyelamatkan kegagalan disk.

Saran: snapshot setelah ada perubahan dengan jeda singkat/akhir sesi, simpan waktu dan identitas jurnal terakhir yang tercakup, serta alur salin ke media lain yang mudah. Bedakan usia file backup dengan berapa transaksi belum tercadangkan. Jalur manual `backup:export` dan sebelum kunci periode langsung menyalin database, sedangkan restore melakukan audit: tampilkan hasil verifikasi pada semua salinan yang ditawarkan sebagai backup pemulihan. Salinan data bermasalah tetap dapat berguna untuk penyelamatan, tetapi perlu label yang jujur. Bukti: [ipc.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/main/ipc.ts:1414), [audit restore](/Users/taksu/Documents/taksu/sistem-aset-desa/src/features/export/export.ts:284).

**Dua batas cakupan yang perlu dinyatakan jelas**

Pertama, aset tetap dan penyusutan sengaja dikeluarkan oleh keputusan K3. Ini bukan cacat implementasi terhadap spesifikasi lama. Namun jika aplikasi ditujukan menghasilkan posisi keuangan pura secara lengkap, pembelian barang tahan lama tidak boleh otomatis disamakan dengan seluruh belanja operasional tanpa kebijakan pengakuan. Pilihan sederhana: tetap menjadi pembukuan bendahara dengan batas cakupan yang jelas dan jurnal penyesuaian akuntan, atau tambah pencatatan aset minimal. Bukti keputusan: [arah-akuntansi.md](/Users/taksu/Documents/taksu/sistem-aset-desa/docs/arah-akuntansi.md:142).

Kedua, utang usaha hanya akun kontrol `2060`; nama kreditur ditulis bebas dalam keterangan. “Buku Pembantu” sekarang merupakan tampilan lain dari Buku Besar per akun, bukan daftar saldo per kreditur/nota. Bukti: [forms.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/core/forms.ts:293), [pembantu.ts](/Users/taksu/Documents/taksu/sistem-aset-desa/src/features/reports/pembantu/pembantu.ts:29). Jika utang rutin dipakai, tambahkan kreditur, nomor nota, sisa tagihan, dan alokasi pembayaran yang sederhana. Jika jarang, tampilkan modul hanya saat dibutuhkan.

**Rancangan perbaikan database yang disarankan**

Pertahankan SQLite lokal dan model `jurnal` + `jurnal_baris`. Kebutuhan ini belum menunjukkan alasan mengganti ke server atau microservice. Yang perlu dibenahi adalah kontrak dan hubungan dokumennya.

| Bagian | Perubahan yang disarankan | Tujuan |
|---|---|---|
| Akun | Bedakan rekening operasional, kas/setara kas untuk pelaporan, dan investasi; metadata kebijakan arus kas | Rekening tidak otomatis menjadi kas/setara kas |
| Kepala jurnal | Tanggal akuntansi, waktu input, referensi dokumen, rantai reversal/koreksi yang jelas | Pisahkan kejadian ekonomi dari waktu mengetik |
| Baris jurnal | Integer ketat, satu sisi, referensi dana bila perlu | Mencegah data nominal tidak sah dan menjaga pertanggungjawaban dana |
| Dokumen sumber | Identitas transaksi/bukti, jenis dokumen, versi koreksi, tautan jurnal | Pemilik transaksi jelas; koreksi tidak memutus subledger |
| Pinjaman | Pembayaran terpisah dari alokasi ke angsuran; banyak alokasi per angsuran | Pembayaran sebagian dan koreksi tetap benar |
| Panjar | Realisasi/nota dan tanggal kejadian; pertanggungjawaban berversi | Salah input dapat diperbaiki, beban masuk periode yang tepat |
| Periode | Status terkunci serta riwayat pembukaan kembali dan versi laporan | Angka yang telah disetujui tidak berubah lewat input biasa |
| Rekonsiliasi | Saldo eksternal/kas fisik per tanggal, selisih dan status pemeriksaan | Menguji kelengkapan pembukuan terhadap dunia nyata |

Tidak semua bagian harus menjadi tabel baru. Hindari tabel/kolom saldo berjalan yang dapat diperoleh dari jurnal; snapshot saldo eksternal dan arsip laporan merupakan bukti pemeriksaan, bukan pengganti sumber angka GL. Dana dan alokasi harus mematuhi keseimbangan per dana bila laporan posisi keuangan per dana dibutuhkan.

Karena data dummy, gunakan skema baru yang bersih untuk tahap pra-produksi dan satu proses inisialisasi yang mudah diuji. Tetap tetapkan versi skema dan cara menolak backup yang tidak kompatibel. Sesudah data nyata mulai digunakan, perubahan skema perlu migrasi serta pengujian pemulihan yang menjaga histori.

**Alur paling sederhana bagi bendahara**

1. Persiapan sekali: tanggal mulai, daftar rekening yang benar-benar dipakai, saldo pembukaan dengan sumber bukti, review pendamping, mulai pembukuan.
2. Harian: Terima Uang, Bayar, Pindah Dana, dan Panjar. Pinjaman/utang tampil bila dipakai. Akun teknis boleh memakai label familiar dan favorit.
3. Sebelum simpan: ringkasan kejadian, rekening, dana, kategori, dan nominal. Tampilkan kemungkinan transaksi kembar berdasarkan tanggal/nominal/pihak/bukti sebagai peringatan yang bisa dijelaskan.
4. Sesudah simpan: nomor bukti dan tindakan `Koreksi transaksi ini` yang mengikuti dokumen asal.
5. Akhir bulan: cocokkan kas fisik/rekening, selesaikan selisih, review panjar/utang, lihat surplus-defisit dan dana, backup, kunci bulan.
6. Mode pendamping: Jurnal Umum, Buku Besar, Neraca Saldo, penyesuaian periode, dan pemeriksaan. “Buku Pembantu” yang hanya menduplikasi Buku Besar bisa digabung sebagai tampilan “Buku Kas/Bank”.

Satu PIN tetap dapat dipakai sesuai keputusan sebelumnya. Audit trail saat ini menunjukkan apa/kapan berubah, tetapi belum mengidentifikasi siapa secara independen. Nama pemeriksa/penyetuju dan waktu review dapat dicatat tanpa langsung menambah sistem hak akses yang rumit. Perlindungan file serta salinan backup tetap penting karena PIN bukan enkripsi.

**Urutan pengerjaan yang disarankan**

| Tahap | Isi | Syarat selesai |
|---|---|---|
| 1. Benahi angka dan koreksi | Temuan 1–5; nominal/alokasi angsuran; pemeriksaan reversal | Semua skenario reproduksi menghasilkan angka, status, dan klasifikasi yang diharapkan |
| 2. Sepakati kebijakan | Basis pembukuan, cut-off, aset, deposito, dana, kunci periode | Dokumen singkat dengan contoh jurnal yang disetujui akuntan pendamping |
| 3. Kuatkan data dan input | Skema bersih, saldo awal, default akun, draft, bukti, koreksi dokumen | Input salah ditolak/ditangani; koreksi tidak merusak histori atau subledger |
| 4. Tambahkan kontrol harian | Rekonsiliasi kas/bank sederhana, review bulanan, backup setelah perubahan | Saldo buku dapat dibuktikan dengan saldo eksternal dan salinan yang bisa dipulihkan |
| 5. Uji penerimaan | Satu bulan transaksi realistis, ganti tahun, koreksi, pembayaran sebagian, restore | Pendamping dapat menelusuri setiap saldo dan merekonsiliasi hasilnya secara independen |

Tambahkan tes berbasis hasil bisnis yang dihitung independen: GL vs seluruh subledger; pembayaran sebagian dan reversal; arus kas komponen pokok/bunga; saldo pembukaan; panjar lintas tahun; semua jalur koreksi; backup–restore pada folder sementara. Perbaiki selector smoke test agar spesifik ke akun yang dibuat. Gunakan E2E untuk membuktikan operator dapat menyelesaikan serta memperbaiki transaksi, selain sekadar membuktikan layar tampil.

Prioritas produk: tingkatkan kemampuan mencegah, menemukan, dan memperbaiki kesalahan sebelum memperluas fitur. Sederhana untuk bendahara dapat dicapai dengan alur terpandu di atas mesin jurnal yang ketat.
