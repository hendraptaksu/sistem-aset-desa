# Tiket Audit & Perbaikan — Sistem Aset Desa

**Status:** aktif  
**Baseline audit:** 2026-11-06  
**Cara pakai:** kerjakan satu tiket kecil, centang `[x]` hanya setelah test/verifikasi terkait lulus.  
**Lokasi:** root repo. Hapus file ini setelah semua tiket selesai agar tidak menjadi context rot.  
**Mulai dari:** T1.1 (P0 data safety), lalu ikuti urutan di bagian “Catatan lintas tiket”.

## Baseline yang sudah tercatat

- `npm run typecheck` lulus.
- `npm test`: 85 file / 1.078 test lulus, 0 gagal.
- Empat bug kritis sudah direproduksi:
  1. Backup ke path DB aktif membuat jurnal baru hilang setelah DB dibuka ulang.
  2. DB v1 yang kehilangan `jurnal_baris` diam-diam membuat tabel kosong saat dibuka.
  3. Reversal `SALDO_AWAL` membuat saldo awal nol; wizard tetap terkunci dan saldo awal baru ditolak.
  4. `koreksiDanIsiUlang` pada `SALDO_AWAL` gagal dengan `UNIQUE constraint failed: jurnal.jenis`.

## Legenda prioritas

- **P0:** berisiko kehilangan data / memblokir pemulihan. Kerjakan lebih dulu.
- **P1:** salah kontrol, keamanan, atau UX yang menyesatkan.
- **P2:** hardening, performa, dokumentasi, dan poles UX.

## Ringkasan progres

| Fase | Prioritas | Selesai | Total |
| --- | --- | ---: | ---: |
| 0 — Persiapan | — | 3 | 3 |
| 1 — Data safety | P0 | 1 | 9 |
| 2 — Kontrol & UX | P1 | 0 | 9 |
| 3 — Hardening | P2 | 0 | 9 |
| 4 — Rilis | — | 0 | 3 |
| **Total** |  | **4** | **33** |

## Aturan kerja

- Satu tiket = satu perubahan kecil yang bisa diuji sendiri. Jangan campur refactor besar.
- Jangan menandai `[x]` sebelum test regresi tiket itu lulus.
- Setiap tiket wajib menyebut file yang disentuh dan cara verifikasinya.
- Jangan mengubah logika akuntansi di `src/core/` tanpa test yang menjelaskan alasannya.
- Jangan menambah jalur migrasi DB lama. Tiket yang mengubah skema harus lewat keputusan eksplisit.
- Setelah tiket selesai: catat commit/hash di bagian **Catatan** tiket, lalu pastikan `git status` bersih.
- Urutan P0 disarankan berurutan karena banyak menyentuh `src/db/database.ts`, `export.ts`, dan alur saldo awal.

---

## Fase 0 — Persiapan

- [x] **T0.1 — Audit awal & reproduksi bug**
  - **Hasil:** audit statis + `npm run typecheck` + `npm test` selesai.
  - **Bukti:** empat bug kritis pada bagian baseline sudah direproduksi dengan skrip sementara.
  - **Selesai bila:** temuan P0/P1/P2 terdokumentasi dan tidak ada perubahan kode yang tertinggal.
  - **Catatan:** skrip reproduksi sementara sudah dihapus; tidak ada perubahan kode yang tertinggal.

- [x] **T0.2 — Catat baseline test**
  - **Baseline (2026-11-06):** typecheck lulus; `vitest run` 85 file / 1.078 test lulus, 0 gagal.
  - **Selesai bila:** angka baseline tercatat di tiket ini dan dipakai sebagai pembanding di T4.1.

- [x] **T0.3 — Siapkan branch kerja**
  - Buat branch mis. `fix/audit-p0` dari commit terbaru.
  - Kerjakan satu fase per branch agar review dan rollback mudah.
  - **Selesai bila:** `git status` bersih dan branch aktif tercatat di PR/commit.
  - **Catatan:** branch `fix/audit-p0` dibuat dari `reset-skema-v1`@`a2663d1`; commit awal `37af56b`.

---

## Fase 1 — P0: Data safety

- [x] **T1.1 — Guard backup agar tidak menimpa DB aktif**
  - **Masalah:** `backupVacuumInto(db, dest)` memindahkan file lama lalu me-rename hasil VACUUM ke `dest`. Bila `dest` adalah path DB aktif, koneksi SQLite tetap menulis ke inode lama; jurnal baru tidak ada saat DB dibuka ulang.
  - **File:** `src/features/export/export.ts`, helper baru mis. `src/features/export/pathAman.ts`, `tests/backup-restore.test.ts`.
  - **Langkah:**
    1. Tambah helper `pastikanBukanFileDbAktif(dbPath, tujuan)` yang membandingkan path kanonik dan inode (`realpath`/`stat`), termasuk symlink dan hardlink.
    2. Panggil guard di awal `backupVacuumInto` memakai `db.name`; tolak `dest === db.name`, `${db.name}-wal`, dan `${db.name}-shm`.
    3. Tolak juga path relatif yang menunjuk file yang sama (mis. `./data/pura.db` vs path absolut).
  - **Selesai bila:** backup ke path DB aktif ditolak sebelum `VACUUM INTO`; DB tetap bisa dipakai; data jurnal baru masih ada setelah close/reopen.
  - **Verifikasi:** `npm test -- tests/backup-restore.test.ts`.
  - **Catatan:** File disentuh: `src/features/export/pathAman.ts` (baru), `src/features/export/export.ts`, `tests/backup-restore.test.ts`, `TICKETS.md`. Guard `pastikanBukanFileDbAktif(db.name, dest)` berjalan sebelum `VACUUM INTO`, membandingkan path kanonik (`realpath`/`resolve`) dan inode (`stat`) sehingga path relatif/absolut, symlink, dan hardlink ke DB aktif atau sidecar `-wal`/`-shm` ditolak. Verifikasi: `npm test -- tests/backup-restore.test.ts` (25 lulus, 4 test T1.1 gagal bila guard dilepas), `npm run typecheck` lulus, `npm test` 85 file/1.082 test lulus. Commit `c15d7a0`.

- [ ] **T1.2 — Pasang guard path di semua kanal simpan**
  - **Masalah:** `file:save-buffer` dan `file:save-pdf` menulis ke path apa pun yang dipilih dialog. Memilih file DB aktif dapat menimpa database dengan isi xlsx/pdf.
  - **File:** `src/main/ipc.ts`, `src/main/index.ts` bila perlu, `tests/ipc-main.test.ts`, `tests/save-pdf.test.ts`.
  - **Langkah:**
    1. Panggil helper T1.1 setelah dialog dan sebelum `writeFile`/`printPdf`.
    2. Terapkan pada `file:save-buffer`, `file:save-pdf`, dan `backup:export`.
    3. Kembalikan pesan error Indonesia yang menyebut file DB aktif tidak boleh menjadi tujuan.
  - **Selesai bila:** test dengan dialog palsu yang mengembalikan `deps.dbPath()` memastikan `writeFile`/`printPdf` tidak dipanggil dan DB tidak berubah.
  - **Verifikasi:** `npm test -- tests/ipc-main.test.ts tests/save-pdf.test.ts`.
  - **Catatan:** -

- [ ] **T1.3 — Tolak DB v1 yang kehilangan tabel wajib**
  - **Masalah:** `cekKompatibilitas` hanya menolak tabel asing. DB v1 tanpa `jurnal_baris` lolos, lalu `siapkanSkema` menjalankan `CREATE TABLE IF NOT EXISTS` dan membuat tabel kosong. Data baris hilang tanpa error.
  - **File:** `src/db/database.ts`, `tests/skema-kompatibilitas.test.ts`.
  - **Langkah:**
    1. Saat `user_version === SCHEMA_VERSION`, hitung `TABEL_AKTIF.filter(t => !tabel.has(t))`.
    2. Bila ada yang kurang, lempar pesan khusus (mis. `PESAN_DB_TIDAK_LENGKAP`) yang menyebut nama tabel dan instruksi memakai backup.
    3. Pastikan pengecekan berjalan sebelum `journal_mode = WAL` dan sebelum `DDL`.
  - **Selesai bila:** test menghapus `jurnal_baris` dari DB v1, lalu `openDb` melempar error; file tetap byte-for-byte sama; tidak ada `-wal`/`-shm`; tabel tidak dibuat ulang.
  - **Verifikasi:** `npm test -- tests/skema-kompatibilitas.test.ts`.
  - **Catatan:** -

- [ ] **T1.4 — Tolak DB v1 yang kehilangan kolom wajib**
  - **Masalah:** tabel yang ada tetapi kehilangan kolom tidak terdeteksi. `CREATE TABLE IF NOT EXISTS` tidak menambah kolom; error baru muncul jauh di lapisan query.
  - **File:** `src/db/database.ts`, `tests/skema-kompatibilitas.test.ts`.
  - **Langkah:**
    1. Tambah peta `KOLOM_WAJIB` per tabel (boleh dibangkitkan dari DDL saat test/build, bukan tebakan runtime).
    2. Bandingkan dengan `PRAGMA table_info`.
    3. Tolak dengan pesan yang menyebut tabel dan kolom yang hilang; jangan `ALTER TABLE` otomatis.
  - **Selesai bila:** DB v1 dengan satu kolom hilang ditolak sebelum DDL; DB valid tetap bisa dibuka.
  - **Verifikasi:** `npm test -- tests/skema-kompatibilitas.test.ts tests/skema-strict.test.ts`.
  - **Catatan:** -

- [ ] **T1.5 — Blokir reversal `SALDO_AWAL` dari jalur umum**
  - **Masalah:** `reverseJurnal` mengizinkan `SALDO_AWAL` dibalik. Dampaknya saldo awal menjadi nol, wizard tetap terkunci karena jurnal `SALDO_AWAL` masih ada, dan saldo awal baru tetap ditolak unique index. Pesan `PESAN_SALDO_AWAL_SUDAH_ADA` menyesatkan karena menyarankan “koreksi/jurnal biasa”.
  - **File:** `src/db/reversal.ts`, `src/core/reversal.ts`, `src/db/saldoAwal.ts`, `src/renderer/components/JurnalTab.tsx`, `src/renderer/components/TransaksiTab.tsx`, `tests/reversal.test.ts`, `tests/saldo-awal.test.ts`.
  - **Langkah:**
    1. Tambah `PESAN_REVERSAL_SALDO_AWAL` yang menjelaskan saldo awal hanya boleh dikoreksi lewat alur koreksi saldo awal.
    2. Di `rencanaUntuk`, tolak jurnal berjenis `SALDO_AWAL` sebelum menyusun rencana. Jangan memblokir seluruh grup, karena jurnal penyesuaian `UMUM` nanti tetap boleh dikoreksi lewat jalur biasa.
    3. Perbarui `PESAN_SALDO_AWAL_SUDAH_ADA` agar tidak menyarankan jurnal biasa.
    4. Sembunyikan/nonaktifkan tombol Koreksi untuk saldo awal sampai T1.8 selesai.
  - **Selesai bila:** reversal saldo awal ditolak tanpa menulis jurnal/audit; saldo awal tidak berubah; UI tidak menawarkan aksi yang selalu gagal.
  - **Verifikasi:** `npm test -- tests/reversal.test.ts tests/saldo-awal.test.ts`.
  - **Catatan:** test `tests/reversal.test.ts:573-631` perlu disesuaikan karena perilaku yang diharapkan berubah.

- [ ] **T1.6 — Putuskan mekanisme koreksi saldo awal**
  - **Masalah:** belum ada alur koreksi yang sah. Dua opsi perlu dipilih sebelum implementasi:
    - **Opsi A (disarankan):** reversal saldo awal + jurnal penyesuaian `UMUM` bertanggal saldo awal, tanpa perubahan skema. Wizard menampilkan tombol “Koreksi Saldo Awal”, bukan mengizinkan edit biasa.
    - **Opsi B:** ganti unique index `ux_jurnal_saldo_awal` dengan trigger yang mengizinkan `SALDO_AWAL` baru setelah yang lama dibalik. Ini perubahan skema dan test besar.
  - **File:** `TICKETS.md`, `docs/prinsip-akuntansi.md` bila keputusan disetujui.
  - **Selesai bila:** opsi dipilih, dampak skema/test dicatat, dan alasan keputusan ditulis.
  - **Verifikasi:** review keputusan; belum ada kode.
  - **Catatan:** -

- [ ] **T1.7 — Implementasi backend koreksi saldo awal**
  - **Masalah:** setelah T1.5, pengguna belum punya cara memperbaiki saldo awal yang salah.
  - **File:** `src/db/saldoAwal.ts` (atau modul baru), `src/db/reversal.ts`, `src/main/ipc.ts`, `src/main/validation.ts`, test baru.
  - **Langkah (Opsi A):**
    1. Tambah `koreksiSaldoAwal(db, input, opsi)` yang memvalidasi input lewat builder/validator yang sama.
    2. Dalam satu transaksi: reversal saldo awal lama + jurnal penyesuaian `UMUM` bertanggal sama + audit `KOREKSI-SALDO-AWAL`.
    3. Perbarui `KUNCI_AKUNTANSI_TANGGAL_MULAI` bila tanggal berubah.
    4. Tambah IPC `saldo-awal:koreksi` dengan validasi bentuk input dan alasan.
  - **Selesai bila:** koreksi mengubah saldo laporan sesuai input; bila jurnal pengganti gagal, reversal ikut batal; reversal generik tetap diblokir; audit tercatat.
  - **Verifikasi:** test baru untuk sukses, rollback, dan penolakan tanggal.
  - **Catatan:** bergantung pada T1.6.

- [ ] **T1.8 — UI koreksi saldo awal di wizard**
  - **Masalah:** wizard hanya punya status terkunci tanpa jalan keluar.
  - **File:** `src/renderer/components/SaldoAwalWizard.tsx`, `src/renderer/lib/api.ts`, `src/preload/*`, test UI terkait.
  - **Langkah:**
    1. Saat `statusSaldoAwal.boleh === false`, tampilkan tombol **Koreksi Saldo Awal**.
    2. Muat saldo awal saat ini, prefill form, tampilkan selisih dan baris penyeimbang `3000`.
    3. Jelaskan bahwa jurnal lama tetap tersimpan di audit.
    4. Kirim ke IPC T1.7 dan muat ulang status setelah sukses.
  - **Selesai bila:** pengguna bisa memperbaiki saldo awal tanpa menghapus jurnal; form biasa tetap terkunci; pesan sukses jelas.
  - **Verifikasi:** `npm test -- tests/saldo-awal.test.ts tests/forms-ui.test.ts` + audit UI.
  - **Catatan:** -

- [ ] **T1.9 — Regression P0 & smoke manual**
  - **Langkah:**
    1. Pastikan empat reproduksi baseline punya test permanen.
    2. Jalankan `npm run typecheck` dan `npm test`.
    3. Smoke manual: backup ke DB aktif ditolak; DB tanpa tabel ditolak; reversal saldo awal diblokir; koreksi saldo awal berhasil; DB dibuka ulang tanpa kehilangan data.
  - **Selesai bila:** semua test P0 lulus dan tidak ada data hilang pada skenario manual.
  - **Verifikasi:** hasil test + catatan smoke di tiket.
  - **Catatan:** -

---

## Fase 2 — P1: Kontrol akuntansi, keamanan, dan UX

- [ ] **T2.1 — Helper backend untuk kemampuan koreksi jurnal**
  - **Masalah:** UI menebak aksi yang boleh dari `jenis` dan akun, sehingga tombol Koreksi muncul untuk panjar/pinjaman/saldo awal yang pasti ditolak backend.
  - **File:** `src/db/reversal.ts`, `src/db/repository.ts`, `src/features/export/...` bila perlu.
  - **Langkah:**
    1. Tambah fungsi `kemampuanKoreksiJurnal(db, jurnal)` yang mengembalikan `{ bisaDibalik, bisaDikoreksi, alasan }`.
    2. Cek: jurnal ada, bukan `REVERSAL`, belum punya reversal, bukan anggota panjar (`panjar.jurnal_open_id`/`jurnal_close_id`), bukan pinjaman (`pinjaman.jurnal_pencairan_id`/`pinjaman_bayar.jurnal_id`), dan bukan `SALDO_AWAL`.
    3. Untuk pinjaman, gunakan relasi tabel — bukan heuristik “jenis HUTANG + akun 2050”.
  - **Selesai bila:** helper memberi alasan yang benar untuk panjar, pinjaman pokok, pinjaman bunga saja, saldo awal, dan jurnal yang sudah dikoreksi.
  - **Verifikasi:** test unit baru.
  - **Catatan:** -

- [ ] **T2.2 — Expose capability flags dan pakai di UI**
  - **Masalah:** `JurnalTab`/`TransaksiTab` masih memakai daftar jenis dan `jurnalTerhubungPinjaman` yang tidak lengkap.
  - **File:** `src/db/repository.ts`, tipe `JurnalLengkap`, `src/renderer/components/JurnalTab.tsx`, `src/renderer/components/TransaksiTab.tsx`, `src/renderer/lib/api.ts`.
  - **Langkah:**
    1. Tambah field `bisa_dibalik`, `bisa_dikoreksi`, `alasan_tidak_bisa` pada DTO jurnal.
    2. Ganti logika tombol dengan field tersebut; tampilkan alasan di tooltip/teks bantuan.
    3. Hapus atau jadikan fallback `JENIS_BISA_DIBATALKAN`/`jurnalTerhubungPinjaman`.
  - **Selesai bila:** tidak ada tombol koreksi yang selalu gagal; alasan ketidakbisaan terlihat; test pure function dan UI lulus.
  - **Verifikasi:** `npm test -- tests/reversal.test.ts tests/aud2-13-transaksi-terakhir.test.ts tests/ui-audit`.
  - **Catatan:** -

- [ ] **T2.3 — Regression pembayaran pinjaman bunga saja**
  - **Masalah:** pembayaran bunga tanpa pokok tidak selalu memuat akun 2050, sehingga deteksi lama menganggapnya boleh dibatalkan dari Transaksi. Pembatalan harus lewat modul Pinjaman.
  - **File:** `tests/pinjaman-pembatalan-validation.test.ts`, `tests/pinjaman.test.ts`.
  - **Langkah:** buat pinjaman, catat pembayaran dengan `pokok: 0` dan `bunga > 0`, lalu pastikan capability `bisaDibalik=false` dan alasan menunjuk modul Pinjaman.
  - **Selesai bila:** test gagal pada implementasi lama dan lulus setelah T2.1/T2.2.
  - **Verifikasi:** `npm test -- tests/pinjaman-pembatalan-validation.test.ts`.
  - **Catatan:** -

- [ ] **T2.4 — Lindungi akun sistem 2060, 5063, dan 5050**
  - **Masalah:** `AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF` hanya berisi 3000/1040/1050/2050. Menonaktifkan 2060 (utang usaha), 5063 (bunga pinjaman), atau 5050 (denda) memutus alur wizard/utang/pinjaman.
  - **File:** `src/db/coa.ts`, `src/db/pinjaman.ts`, `src/db/repository.ts`, `src/renderer/components/AkunTab.tsx`, `tests/akun.test.ts`.
  - **Langkah:**
    1. Pindahkan/definisikan konstanta akun bunga & denda di `coa.ts` agar tidak impor melingkar.
    2. Tambahkan 2060, 5063, 5050 ke daftar akun sistem.
    3. Perbarui teks bantuan AkunTab.
  - **Selesai bila:** deaktivasi ketiga akun ditolak dengan pesan jelas; reaktivasi tetap boleh.
  - **Verifikasi:** `npm test -- tests/akun.test.ts tests/utang-usaha.test.ts tests/pinjaman.test.ts`.
  - **Catatan:** -

- [ ] **T2.5 — Matriks test alur dengan akun sistem nonaktif**
  - **Masalah:** akun tetap lain di wizard/template bisa dinonaktifkan dan baru ketahuan saat dipakai.
  - **File:** test baru mis. `tests/akun-sistem-alur.test.ts`.
  - **Langkah:** untuk setiap alur (saldo awal, panjar, utang usaha, pinjaman, jurnal terpandu), coba akun sistem nonaktif dan pastikan hasilnya error validasi yang jelas, bukan crash/data setengah jadi.
  - **Selesai bila:** matriks alur × akun sistem terdokumentasi di test.
  - **Verifikasi:** test baru.
  - **Catatan:** -

- [ ] **T2.6 — Konsistenkan `awalTahunBuku` legacy**
  - **Masalah:** `getPengaturanPembukuan` masih mengembalikan nilai legacy (mis. 7), dan dashboard memakainya, sedangkan aplikasi hanya mendukung Januari (`AWAL_TAHUN_BUKU_DIDUKUNG = 1`). Laporan bisa memakai periode berbeda dari dashboard.
  - **File:** `src/db/repository.ts`, `src/features/dashboard/dashboard.ts`, `src/main/ipc.ts`, `tests/dashboard.test.ts`, `tests/pengaturan.test.ts`.
  - **Langkah:** normalisasi nilai legacy ke 1 saat dibaca, atau abaikan di dashboard dan gunakan konstanta yang didukung. Tambahkan test dengan setting 7.
  - **Selesai bila:** dashboard dan laporan memakai Januari–Desember untuk DB legacy; tidak ada error saat menyimpan pengaturan.
  - **Verifikasi:** `npm test -- tests/dashboard.test.ts tests/pengaturan.test.ts`.
  - **Catatan:** -

- [ ] **T2.7 — Refresh kunci segera setelah restore**
  - **Masalah:** setelah restore, main memanggil `kunciLagi()`, tetapi renderer masih memanggil `muatData(cutoff)`. Permintaan ditolak karena terkunci; dashboard bisa menampilkan data lama/error sampai polling berikutnya.
  - **File:** `src/renderer/components/DashboardTab.tsx`, `src/renderer/App.tsx`, `src/renderer/lib/api.ts`, test komponen.
  - **Langkah:**
    1. Jangan panggil `muatData` setelah restore sukses.
    2. Panggil callback refresh status kunci / reload layar kunci segera.
    3. Tampilkan pesan restore sebelum layar kunci.
  - **Selesai bila:** setelah restore, layar kunci muncul langsung; tidak ada error “Aplikasi terkunci” atau data stale.
  - **Verifikasi:** test komponen/handler + smoke manual.
  - **Catatan:** -

- [ ] **T2.8 — Lockout PIN bertahan setelah restart**
  - **Masalah:** `sesi.gagal`/`sesi.blokirSampai` hanya di memori. Menutup aplikasi mereset blokir, sehingga brute-force PIN 6 digit bisa diulang.
  - **File:** `src/main/kunci.ts`, `src/db/repository.ts`, `tests/kunci.test.ts`.
  - **Langkah:**
    1. Simpan `gagal` dan `blokirSampai` di `pengaturan` atau file state kecil.
    2. Muat saat startup; reset saat setup/unlock sukses/reset PIN.
    3. Tetap tampilkan sisa blokir di `lock:status`.
  - **Selesai bila:** 5 kali salah → restart → masih diblokir; PIN benar setelah blokir habis membersihkan state.
  - **Verifikasi:** `npm test -- tests/kunci.test.ts`.
  - **Catatan:** ini bukan enkripsi DB; tetap dokumentasikan di README.

- [ ] **T2.9 — Matikan DevTools di build produksi**
  - **Masalah:** `BrowserWindow` tidak menetapkan `devTools: false`; menu default Electron masih menyediakan Toggle Developer Tools. Di aplikasi keuangan, ini memperbesar risiko inspeksi/manipulasi renderer.
  - **File:** `src/main/index.ts`, `src/main/windowSecurity.ts`, `tests/window-security.test.ts`.
  - **Langkah:**
    1. Set `devTools: Boolean(devUrl)` pada window utama dan hidden PDF window.
    2. Di produksi, hapus item menu View/Toggle DevTools atau set application menu tanpa devtools.
    3. Blokir shortcut F12 / Cmd+Alt+I / Ctrl+Shift+I lewat `before-input-event`.
  - **Selesai bila:** build produksi tidak bisa membuka DevTools lewat menu/shortcut; mode dev tetap bisa.
  - **Verifikasi:** test helper konfigurasi + smoke build.
  - **Catatan:** -

---

## Fase 3 — P2: Hardening, performa, dan dokumentasi

- [ ] **T3.1 — Verifikasi isi backup sebelum mengganti backup lama**
  - **Masalah:** `backupVacuumInto` hanya mengecek file tmp ada dan ukurannya > 0. Backup yang korup tetapi berukuran wajar bisa menggantikan backup lama yang sehat.
  - **File:** `src/features/export/export.ts`, `tests/backup-restore.test.ts`.
  - **Langkah:**
    1. Setelah `VACUUM INTO` ke tmp, buka readonly.
    2. Jalankan `PRAGMA integrity_check`, `foreign_key_check`, cek `user_version`, dan keberadaan `TABEL_AKTIF`.
    3. Bila gagal: hapus tmp, pertahankan `dest` lama, lempar error.
  - **Selesai bila:** backup korup tidak pernah menggantikan backup lama.
  - **Verifikasi:** test dengan file tmp korup/valid.
  - **Catatan:** -

- [ ] **T3.2 — Retensi backup internal**
  - **Masalah:** `auto-*.db` dibatasi 7 file, tetapi `pre-restore-*.db` dan `pura-<tahun>.db` bisa menumpuk tanpa batas.
  - **File:** `src/features/export/export.ts`, `src/main/ipc.ts`, `tests/backup-auto.test.ts`.
  - **Langkah:**
    1. Tetapkan batas retensi untuk backup internal (bukan folder pilihan pengguna).
    2. Hapus hanya setelah backup baru terverifikasi.
    3. Jangan pernah menghapus backup yang sedang dipakai rollback.
  - **Selesai bila:** jumlah file internal terkendali dan test retensi lulus.
  - **Verifikasi:** `npm test -- tests/backup-auto.test.ts`.
  - **Catatan:** -

- [ ] **T3.3 — Keputusan enkripsi backup**
  - **Masalah:** backup `.db` tidak terenkripsi; PIN hanya melindungi UI, bukan isi file. Ini risiko nyata bila backup disalin ke USB/cloud.
  - **File:** `README.md`, `docs/panduan-pengguna.md`, UI backup.
  - **Langkah:**
    1. Tulis keputusan: enkripsi penuh (SQLCipher) vs arsip terenkripsi vs dokumentasi + imbauan disk terenkripsi.
    2. Tambahkan peringatan di UI backup dan README.
    3. Bila memilih implementasi, buat tiket terpisah — jangan campur dengan tiket ini.
  - **Selesai bila:** keputusan dan risiko terdokumentasi; pengguna melihat peringatan.
  - **Verifikasi:** review dokumen + test dokumentasi.
  - **Catatan:** -

- [ ] **T3.4 — Bersihkan template Jurnal Umum yang tidak bisa diposting**
  - **Masalah:** template `serah-panjar` memakai akun 1040, tetapi `validasiJurnal` menolak 1040 lewat Jurnal Umum. Template ini selalu gagal.
  - **File:** `src/core/jurnalForm.ts`, `tests/jurnal-form.test.ts`.
  - **Langkah:**
    1. Hapus `serah-panjar` atau arahkan pengguna ke modul Panjar.
    2. Tambah test yang mencoba memposting setiap template dengan nominal contoh.
  - **Selesai bila:** semua template yang ditampilkan bisa diposting; tidak ada template mati.
  - **Verifikasi:** `npm test -- tests/jurnal-form.test.ts`.
  - **Catatan:** -

- [ ] **T3.5 — Keputusan audit actor & hash chain**
  - **Masalah:** `audit_log` punya trigger append-only, tetapi tidak mencatat aktor dan tidak tamper-evident. Siapa pun yang bisa mengedit file DB bisa mengubah isi audit.
  - **File:** `docs/prinsip-akuntansi.md`, `src/db/database.ts`, `src/db/repository.ts`.
  - **Langkah:**
    1. Nilai opsi: kolom `actor` + `prev_hash`/`hash` di skema v2, tabel chain terpisah, atau cukup dokumentasi risiko.
    2. Catat dampak migrasi/reset DB dan biaya implementasi.
  - **Selesai bila:** keputusan disetujui; implementasi (bila ada) masuk tiket terpisah.
  - **Verifikasi:** review keputusan.
  - **Catatan:** -

- [ ] **T3.6 — Self-check definisi index/trigger**
  - **Masalah:** `CREATE INDEX IF NOT EXISTS` tidak memperbaiki index dengan nama sama tetapi definisi salah. Trigger sudah di-drop/recreate, index belum.
  - **File:** `src/db/database.ts`, `tests/skema-hardening.test.ts`.
  - **Langkah:**
    1. Bandingkan `sqlite_master.sql` objek wajib dengan definisi yang diharapkan.
    2. Recreate trigger/index yang aman; tolak atau laporkan index yang tidak bisa dipulihkan.
    3. Tambah test drop trigger → `openDb` memulihkan; index salah → terdeteksi.
  - **Selesai bila:** DB dengan objek skema hilang/berbeda tidak dibuka diam-diam.
  - **Verifikasi:** `npm test -- tests/skema-hardening.test.ts`.
  - **Catatan:** -

- [ ] **T3.7 — Benchmark laporan & audit pagination**
  - **Masalah:** belum ada bukti performa untuk DB besar; beberapa laporan bisa memuat seluruh jurnal tanpa batas.
  - **File:** script benchmark baru, `src/db/laporan.ts`, `src/main/ipc.ts`, test performa ringan.
  - **Langkah:**
    1. Seed ±10.000 jurnal / 50.000 baris.
    2. Ukur dashboard, neraca saldo, laba rugi, arus kas, buku besar.
    3. Periksa `EXPLAIN QUERY PLAN`; tambah index hanya bila terbukti perlu.
    4. Pastikan semua daftar memakai limit/offset.
  - **Selesai bila:** target waktu wajar pada laptop referensi tercatat dan tidak ada query scan besar yang tidak disengaja.
  - **Verifikasi:** hasil benchmark + test regression query plan.
  - **Catatan:** -

- [ ] **T3.8 — Poles UX untuk aksi berisiko**
  - **Masalah:** beberapa konfirmasi/error belum menjelaskan dampak; tombol nonaktif kadang tanpa alasan; modal perlu fokus yang jelas.
  - **File:** `DashboardTab.tsx`, `JurnalTab.tsx`, `SaldoAwalWizard.tsx`, `AkunTab.tsx`, komponen modal/confirm.
  - **Langkah:**
    1. Konfirmasi restore/backup/saldo awal menjelaskan apa yang berubah dan apa yang tetap.
    2. Tombol nonaktif punya tooltip/alasan.
    3. Fokus awal modal, Esc menutup, error diumumkan `aria-live`.
    4. Copy error tidak menyalahkan pengguna; sebut langkah berikutnya.
  - **Selesai bila:** checklist UX di atas lulus audit UI/manual.
  - **Verifikasi:** `npm run audit:ui` + smoke manual.
  - **Catatan:** -

- [ ] **T3.9 — Perbarui dokumentasi & runbook pemulihan**
  - **Masalah:** README sudah menyebut batasan, tetapi belum ada runbook singkat untuk saldo awal salah, backup/restore, dan DB ditolak.
  - **File:** `README.md`, `docs/panduan-pengguna.md`, `docs/panduan-pemeriksaan.md`, `docs/skema.md`.
  - **Langkah:**
    1. Dokumentasikan alur koreksi saldo awal dan backup/restore.
    2. Perjelas bahwa PIN bukan enkripsi dan backup tidak terenkripsi.
    3. Catat skenario DB v1 tidak lengkap harus dipulihkan dari backup, bukan dibuat ulang.
  - **Selesai bila:** pengguna non-teknis bisa mengikuti runbook; `tests/dokumentasi.test.ts` lulus.
  - **Verifikasi:** `npm test -- tests/dokumentasi.test.ts`.
  - **Catatan:** -

---

## Fase 4 — Rilis & penutupan

- [ ] **T4.1 — Verifikasi menyeluruh**
  - Jalankan `npm run typecheck`, `npm test`, dan smoke/e2e yang tersedia (`npm run smoke` bila build memungkinkan).
  - Bandingkan hasil dengan baseline T0.2; tidak boleh ada test yang turun tanpa alasan.
  - **Selesai bila:** semua lulus dan hasilnya dicatat.
  - **Catatan:** -

- [ ] **T4.2 — Smoke manual matriks**
  - Skenario minimum:
    1. DB baru → saldo awal → jurnal → laporan.
    2. Backup manual → tutup → buka backup.
    3. Restore `.db` dan restore lengkap → layar kunci muncul.
    4. Koreksi saldo awal → laporan berubah, audit bertambah.
    5. Panjar: serah → close; pinjaman: pencairan → bayar pokok/bunga → batal.
    6. Tutup buku → backup otomatis → jurnal tahun terkunci ditolak.
    7. Matikan PIN salah 5x → restart → masih diblokir.
  - Uji di macOS dan Windows bila tersedia.
  - **Selesai bila:** semua skenario lulus dan catatan platform disimpan.
  - **Catatan:** -

- [ ] **T4.3 — Tutup tiket & arsipkan**
  - Pastikan seluruh tiket `[x]` dan tidak ada P0/P1 terbuka.
  - Hapus `TICKETS.md` setelah semua selesai (sesuai konvensi repo) atau pindahkan ringkasan ke changelog.
  - Perbarui versi/changelog bila akan dirilis.
  - **Selesai bila:** working tree bersih dan riwayat rilis tercatat.
  - **Catatan:** -

---

## Catatan lintas tiket

- **Urutan P0 yang disarankan:** T1.1 → T1.2 → T1.3 → T1.4 → T1.5 → T1.6 → T1.7 → T1.8 → T1.9.
- **Urutan P1 yang disarankan:** T2.1 → T2.2 → T2.3, lalu T2.4 → T2.5, lalu T2.6 → T2.7 → T2.8 → T2.9.
- **Jangan** mengerjakan T3.5 (hash chain) sebelum T1–T2 stabil; perubahan skema akan mengganggu test data safety.
- Bila menemukan bug baru saat mengerjakan tiket, tambahkan tiket baru di fase yang sesuai; jangan menyelipkan perubahan besar di tiket yang sedang berjalan.
