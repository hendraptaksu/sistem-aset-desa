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
| 1 — Data safety | P0 | 9 | 9 |
| 2 — Kontrol & UX | P1 | 3 | 9 |
| 3 — Hardening | P2 | 0 | 9 |
| 4 — Rilis | — | 0 | 3 |
| **Total** |  | **15** | **33** |

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
  - **Catatan:** File disentuh: `src/features/export/pathAman.ts` (baru), `src/features/export/export.ts`, `tests/backup-restore.test.ts`, `TICKETS.md`. Guard `pastikanBukanFileDbAktif(db.name, dest)` berjalan sebelum `VACUUM INTO`, membandingkan path kanonik (`realpath`/`resolve`) dan inode (`stat`) sehingga path relatif/absolut, symlink, dan hardlink ke DB aktif atau sidecar `-wal`/`-shm` ditolak. Verifikasi: `npm test -- tests/backup-restore.test.ts` (25 lulus, 4 test T1.1 gagal bila guard dilepas), `npm run typecheck` lulus, `npm test` 85 file/1.082 test lulus. Commit `9a9c820`.

- [x] **T1.2 — Pasang guard path di semua kanal simpan**
  - **Masalah:** `file:save-buffer` dan `file:save-pdf` menulis ke path apa pun yang dipilih dialog. Memilih file DB aktif dapat menimpa database dengan isi xlsx/pdf.
  - **File:** `src/main/ipc.ts`, `src/main/index.ts` bila perlu, `tests/ipc-main.test.ts`, `tests/save-pdf.test.ts`.
  - **Langkah:**
    1. Panggil helper T1.1 setelah dialog dan sebelum `writeFile`/`printPdf`.
    2. Terapkan pada `file:save-buffer`, `file:save-pdf`, dan `backup:export`.
    3. Kembalikan pesan error Indonesia yang menyebut file DB aktif tidak boleh menjadi tujuan.
  - **Selesai bila:** test dengan dialog palsu yang mengembalikan `deps.dbPath()` memastikan `writeFile`/`printPdf` tidak dipanggil dan DB tidak berubah.
  - **Verifikasi:** `npm test -- tests/ipc-main.test.ts tests/save-pdf.test.ts`.
  - **Catatan:** File disentuh: `src/main/ipc.ts`, `tests/ipc-main.test.ts`, `TICKETS.md`. Helper `pastikanBukanFileDbAktif(deps.dbPath(), tujuan)` dipanggil setelah dialog dan sebelum operasi tulis/cetak pada `file:save-buffer`, `file:save-pdf`, dan `backup:export` (termasuk sidecar `-wal`/`-shm`). Pesan error Indonesia: “File DB yang sedang aktif tidak boleh menjadi tujuan simpan. Pilih nama file lain.” Test regresi memakai dialog palsu yang mengembalikan `deps.dbPath()`/sidecar dan memastikan `writeFile`/`printPdf`/`backupVacuumInto` tidak berjalan, audit tidak bertambah, dan byte DB tidak berubah. Verifikasi: `npm test -- tests/ipc-main.test.ts tests/save-pdf.test.ts` (52 lulus), `npm run typecheck` lulus, `npm test` 85 file/1.085 test lulus. Commit `52524b9`.

- [x] **T1.3 — Tolak DB v1 yang kehilangan tabel wajib**
  - **Masalah:** `cekKompatibilitas` hanya menolak tabel asing. DB v1 tanpa `jurnal_baris` lolos, lalu `siapkanSkema` menjalankan `CREATE TABLE IF NOT EXISTS` dan membuat tabel kosong. Data baris hilang tanpa error.
  - **File:** `src/db/database.ts`, `tests/skema-kompatibilitas.test.ts`.
  - **Langkah:**
    1. Saat `user_version === SCHEMA_VERSION`, hitung `TABEL_AKTIF.filter(t => !tabel.has(t))`.
    2. Bila ada yang kurang, lempar pesan khusus (mis. `PESAN_DB_TIDAK_LENGKAP`) yang menyebut nama tabel dan instruksi memakai backup.
    3. Pastikan pengecekan berjalan sebelum `journal_mode = WAL` dan sebelum `DDL`.
  - **Selesai bila:** test menghapus `jurnal_baris` dari DB v1, lalu `openDb` melempar error; file tetap byte-for-byte sama; tidak ada `-wal`/`-shm`; tabel tidak dibuat ulang.
  - **Verifikasi:** `npm test -- tests/skema-kompatibilitas.test.ts`.
  - **Catatan:** File disentuh: `src/db/database.ts`, `tests/skema-kompatibilitas.test.ts`, `TICKETS.md`. `cekKompatibilitas` kini menghitung `TABEL_AKTIF` yang hilang saat `user_version === SCHEMA_VERSION` dan melempar `PESAN_DB_TIDAK_LENGKAP` (menyebut nama tabel + instruksi memulihkan dari backup) sebelum `journal_mode = WAL` dan sebelum DDL. DB baru v0 tanpa tabel dan DB v1 lengkap tetap bisa dibuka; penolakan tabel asing/versi lama tidak berubah. Test regresi membuat DB v1 valid via `openDb`, menghapus `jurnal_baris` langsung dengan better-sqlite3 (`foreign_keys = OFF`), lalu memastikan `openDb` ditolak, byte file identik, tanpa `-wal`/`-shm`, versi tetap v1, dan tabel tidak muncul kembali; kasus DB v1 lengkap juga diuji. Verifikasi: `npm test -- tests/skema-kompatibilitas.test.ts` (8 lulus), `npm run typecheck` lulus, `npm test` 85 file/1.087 test lulus. Commit `19c9654`.

- [x] **T1.4 — Tolak DB v1 yang kehilangan kolom wajib**
  - **Masalah:** tabel yang ada tetapi kehilangan kolom tidak terdeteksi. `CREATE TABLE IF NOT EXISTS` tidak menambah kolom; error baru muncul jauh di lapisan query.
  - **File:** `src/db/database.ts`, `tests/skema-kompatibilitas.test.ts`.
  - **Langkah:**
    1. Tambah peta `KOLOM_WAJIB` per tabel (boleh dibangkitkan dari DDL saat test/build, bukan tebakan runtime).
    2. Bandingkan dengan `PRAGMA table_info`.
    3. Tolak dengan pesan yang menyebut tabel dan kolom yang hilang; jangan `ALTER TABLE` otomatis.
  - **Selesai bila:** DB v1 dengan satu kolom hilang ditolak sebelum DDL; DB valid tetap bisa dibuka.
  - **Verifikasi:** `npm test -- tests/skema-kompatibilitas.test.ts tests/skema-strict.test.ts`.
  - **Catatan:** File disentuh: `src/db/database.ts`, `tests/skema-kompatibilitas.test.ts`, `TICKETS.md`. `KOLOM_WAJIB` memetakan 11 `TABEL_AKTIF` ke seluruh kolom kanonik DDL; `kolomWajibHilang` membandingkannya dengan `PRAGMA table_info`. `cekKompatibilitas` mengecek tabel hilang lebih dulu (pesan T1.3 tetap dipakai), lalu kolom hilang, dan melempar `PESAN_DB_KOLOM_TIDAK_LENGKAP` yang menyebut `tabel.kolom` + instruksi memakai backup — sebelum `journal_mode = WAL`/DDL dan tanpa `ALTER TABLE`. Test regresi membuat DB v1 valid, menghapus `pengaturan.nilai` via better-sqlite3, lalu memastikan `openDb` ditolak, byte file identik, tanpa `-wal`/`-shm`, kolom tidak ditambahkan kembali, dan data lain utuh; kasus DB v1 lengkap tetap terbuka. Test penjaga sinkronisasi membandingkan `KOLOM_WAJIB` dengan `PRAGMA table_info` DB baru. Verifikasi: `npm test -- tests/skema-kompatibilitas.test.ts tests/skema-strict.test.ts` (12 lulus), `npm run typecheck` lulus, `npm test` 85 file/1.089 test lulus. Commit `b001349`.

- [x] **T1.5 — Blokir reversal `SALDO_AWAL` dari jalur umum**
  - **Masalah:** `reverseJurnal` mengizinkan `SALDO_AWAL` dibalik. Dampaknya saldo awal menjadi nol, wizard tetap terkunci karena jurnal `SALDO_AWAL` masih ada, dan saldo awal baru tetap ditolak unique index. Pesan `PESAN_SALDO_AWAL_SUDAH_ADA` menyesatkan karena menyarankan “koreksi/jurnal biasa”.
  - **File:** `src/db/reversal.ts`, `src/core/reversal.ts`, `src/db/saldoAwal.ts`, `src/renderer/components/JurnalTab.tsx`, `src/renderer/components/TransaksiTab.tsx`, `tests/reversal.test.ts`, `tests/saldo-awal.test.ts`.
  - **Langkah:**
    1. Tambah `PESAN_REVERSAL_SALDO_AWAL` yang menjelaskan saldo awal hanya boleh dikoreksi lewat alur koreksi saldo awal.
    2. Di `rencanaUntuk`, tolak jurnal berjenis `SALDO_AWAL` sebelum menyusun rencana. Jangan memblokir seluruh grup, karena jurnal penyesuaian `UMUM` nanti tetap boleh dikoreksi lewat jalur biasa.
    3. Perbarui `PESAN_SALDO_AWAL_SUDAH_ADA` agar tidak menyarankan jurnal biasa.
    4. Sembunyikan/nonaktifkan tombol Koreksi untuk saldo awal sampai T1.8 selesai.
  - **Selesai bila:** reversal saldo awal ditolak tanpa menulis jurnal/audit; saldo awal tidak berubah; UI tidak menawarkan aksi yang selalu gagal.
  - **Verifikasi:** `npm test -- tests/reversal.test.ts tests/saldo-awal.test.ts`.
  - **Catatan:** File disentuh: `src/core/reversal.ts`, `src/db/reversal.ts`, `src/db/saldoAwal.ts`, `src/renderer/components/JurnalTab.tsx`, `src/renderer/components/TransaksiTab.tsx`, `tests/reversal.test.ts`, `tests/saldo-awal.test.ts`, `tests/audit-pinjaman-regresi.test.ts`, `tests/db-16f-pinjaman-rekonsiliasi.test.ts`, `TICKETS.md`. `PESAN_REVERSAL_SALDO_AWAL` ditambahkan dan diekspor ulang dari `src/db/reversal.ts`; `rencanaUntuk` menolak hanya jurnal berjenis `SALDO_AWAL` sebelum menyusun rencana, sehingga `reverseJurnal` dan `koreksiDanIsiUlang` berhenti tanpa menulis jurnal/audit. Jurnal `UMUM` di grup yang sama tetap bisa dikoreksi (diuji). `PESAN_SALDO_AWAL_SUDAH_ADA` kini mengarah ke alur koreksi saldo awal, bukan jurnal biasa. `JurnalTab` memakai helper `bisaDikoreksiJurnal` untuk menonaktifkan tombol Koreksi pada saldo awal; `TransaksiTab` memakai teks status yang sama. Test lama disesuaikan: `tests/reversal.test.ts:573-631` (dulu mengharapkan rollback unique index, kini mengharapkan penolakan awal + unique index tetap diuji terpisah), `tests/audit-pinjaman-regresi.test.ts` (koreksi saldo pembukaan via jalur umum kini ditolak), dan `tests/db-16f-pinjaman-rekonsiliasi.test.ts` (pembalikan internal disimulasikan lewat insert tervalidasi agar cakupan kredit neto 2050 tetap terjaga). Test regresi baru: penolakan reversal & isi ulang saldo awal tanpa perubahan jurnal/audit/saldo, UMUM satu grup tetap bisa dikoreksi, helper UI menolak saldo awal, dan pesan tidak menyarankan jurnal biasa. Verifikasi: `npm test -- tests/reversal.test.ts tests/saldo-awal.test.ts` (48 lulus), `npm run typecheck` lulus, `npm test` 85 file/1.093 test lulus. Commit `ab19105`.

- [x] **T1.6 — Putuskan mekanisme koreksi saldo awal**
  - **Masalah:** belum ada alur koreksi yang sah. Dua opsi perlu dipilih sebelum implementasi:
    - **Opsi A (disarankan):** reversal saldo awal + jurnal penyesuaian `UMUM` bertanggal saldo awal, tanpa perubahan skema. Wizard menampilkan tombol “Koreksi Saldo Awal”, bukan mengizinkan edit biasa.
    - **Opsi B:** ganti unique index `ux_jurnal_saldo_awal` dengan trigger yang mengizinkan `SALDO_AWAL` baru setelah yang lama dibalik. Ini perubahan skema dan test besar.
  - **File:** `TICKETS.md`, `docs/prinsip-akuntansi.md` bila keputusan disetujui.
  - **Selesai bila:** opsi dipilih, dampak skema/test dicatat, dan alasan keputusan ditulis.
  - **Verifikasi:** review keputusan; belum ada kode.
  - **Catatan:** **Opsi A dipilih**: reversal `SALDO_AWAL` lama + jurnal penyesuaian `UMUM` bertanggal sama + audit `KOREKSI-SALDO-AWAL`, semuanya dalam satu transaksi atomik. Alasan: ini *reverse and re-post* standar akuntansi, menjaga jurnal lama tetap utuh (tidak diedit/dihapus), dan mempertahankan `ux_jurnal_saldo_awal` sebagai penjaga "saldo awal hanya sekali" sehingga `sudahAdaSaldoAwal`/`statusSaldoAwal` tetap sederhana. Opsi B (trigger) butuh perubahan skema, keputusan reset/migrasi, perubahan `DDL_INDEX` + `docs/skema.md`, dan penyesuaian test skema (`db-04`, `skema-baseline`, `db-30`, `skema-strict`, `skema-hardening`) tanpa mengubah hasil yang dilihat pengguna; risiko `SALDO_AWAL` ganda juga membuat laporan berpotensi menghitung saldo awal dua kali. **Dampak skema:** tidak ada perubahan skema/migrasi; `ux_jurnal_saldo_awal` tetap apa adanya. **Dampak test (T1.7):** test baru untuk sukses (saldo laporan berubah; jurnal lama + reversal + UMUM ada; audit `KOREKSI-SALDO-AWAL`), rollback atomik (jurnal pengganti gagal → reversal & audit batal), penolakan tanggal (setelah transaksi paling awal/periode terkunci), koreksi berulang membalik `UMUM` aktif (bukan `SALDO_AWAL` dua kali), reversal generik `SALDO_AWAL` tetap ditolak, dan validasi IPC `saldo-awal:koreksi`. **UI (T1.8):** tombol **Koreksi Saldo Awal** saat wizard terkunci, prefill saldo saat ini, jelaskan jurnal lama tetap tersimpan. **File:** `docs/prinsip-akuntansi.md` (bagian baru “10. Koreksi saldo awal”), `TICKETS.md`. **Verifikasi:** review dokumen + `npm test -- tests/dokumentasi.test.ts` (10 lulus); belum ada kode implementasi. Commit dokumen `42a8213`; commit catatan tiket terpisah.

- [x] **T1.7 — Implementasi backend koreksi saldo awal**
  - **Masalah:** setelah T1.5, pengguna belum punya cara memperbaiki saldo awal yang salah.
  - **File:** `src/db/saldoAwal.ts` (atau modul baru), `src/db/reversal.ts`, `src/main/ipc.ts`, `src/main/validation.ts`, test baru.
  - **Langkah (Opsi A):**
    1. Tambah `koreksiSaldoAwal(db, input, opsi)` yang memvalidasi input lewat builder/validator yang sama.
    2. Dalam satu transaksi: reversal saldo awal lama + jurnal penyesuaian `UMUM` bertanggal sama + audit `KOREKSI-SALDO-AWAL`.
    3. Perbarui `KUNCI_AKUNTANSI_TANGGAL_MULAI` bila tanggal berubah.
    4. Tambah IPC `saldo-awal:koreksi` dengan validasi bentuk input dan alasan.
  - **Selesai bila:** koreksi mengubah saldo laporan sesuai input; bila jurnal pengganti gagal, reversal ikut batal; reversal generik tetap diblokir; audit tercatat.
  - **Verifikasi:** test baru untuk sukses, rollback, dan penolakan tanggal.
  - **Catatan:** File disentuh: `src/db/saldoAwal.ts`, `src/main/ipc.ts`, `src/renderer/lib/api.ts`, `tests/saldo-awal-koreksi.test.ts` (baru), `tests/ipc-main.test.ts`, `TICKETS.md`. `koreksiSaldoAwal(db, input, opsi)` mencari jurnal pembukaan aktif di grup `SALDO_AWAL` yang belum punya reversal (koreksi pertama = `SALDO_AWAL`, berikutnya = `UMUM` pengganti terakhir), lalu dalam SATU transaksi menulis jurnal `REVERSAL` bertanggal jurnal aktif + jurnal pengganti `UMUM` bertanggal input (baris saldo penuh, `grup_id` sama), audit `KOREKSI-SALDO-AWAL` (data lama aktif + baris; data baru pengganti + reversal; `ref_type`/`ref_id` jurnal aktif), dan memperbarui `KUNCI_AKUNTANSI_TANGGAL_MULAI`. Kedua jurnal divalidasi lewat `validasiJurnal` dengan konteks DB `koreksiSaldoAwal: true`; batas bawah KUNCI lama dikecualikan agar koreksi yang memindahkan tanggal mulai lebih awal tidak salah ditolak, sedangkan tanggal setelah transaksi non-pembukaan paling awal dan tanggal masa depan tetap ditolak. Alasan wajib >=5 karakter; `konfirmasiPeringatan`/`alasanPeringatan` didukung seperti jalur posting. IPC `saldo-awal:koreksi` memakai `validasiBentukSaldoAwal` + `buatJurnalSaldoAwal` yang sama, mengembalikan `{ jurnal, reversal }`, dan status saldo awal tetap `boleh:false`. `reverseJurnal`/`jurnal:reverse` publik tidak diubah sehingga reversal `SALDO_AWAL` tetap diblokir. Test baru mencakup koreksi sukses + laporan/neraca + audit + status terkunci, koreksi kedua membalik `UMUM` aktif, rollback atomik lewat trigger audit, penolakan tanggal setelah transaksi paling awal, penerimaan tanggal lebih awal dari KUNCI lama, alasan <5 karakter, belum ada `SALDO_AWAL`, reversal generik tetap ditolak, dan IPC sukses/validasi alasan/bentuk. Verifikasi: `npm test -- tests/saldo-awal-koreksi.test.ts tests/saldo-awal.test.ts tests/reversal.test.ts tests/ipc-main.test.ts` (106 lulus), `npm run typecheck` lulus, `npm test` 86 file/1.101 test lulus. Commit kode `9d67f92`.

- [x] **T1.8 — UI koreksi saldo awal di wizard**
  - **Masalah:** wizard hanya punya status terkunci tanpa jalan keluar.
  - **File:** `src/renderer/components/SaldoAwalWizard.tsx`, `src/renderer/lib/api.ts`, `src/preload/*`, test UI terkait.
  - **Langkah:**
    1. Saat `statusSaldoAwal.boleh === false`, tampilkan tombol **Koreksi Saldo Awal**.
    2. Muat saldo awal saat ini, prefill form, tampilkan selisih dan baris penyeimbang `3000`.
    3. Jelaskan bahwa jurnal lama tetap tersimpan di audit.
    4. Kirim ke IPC T1.7 dan muat ulang status setelah sukses.
  - **Selesai bila:** pengguna bisa memperbaiki saldo awal tanpa menghapus jurnal; form biasa tetap terkunci; pesan sukses jelas.
  - **Verifikasi:** `npm test -- tests/saldo-awal.test.ts tests/forms-ui.test.ts` + audit UI.
  - **Catatan:** File disentuh: `src/db/saldoAwal.ts`, `src/main/ipc.ts`, `src/renderer/components/SaldoAwalWizard.tsx`, `src/renderer/components/TransaksiTab.tsx`, `src/renderer/lib/api.ts`, `tests/saldo-awal.test.ts`, `tests/forms-ui.test.ts`, `tests/ipc-main.test.ts`, `TICKETS.md`. `saldoAwalSaatIni(db)` membaca jurnal grup pembukaan aktif dan menjumlahkan seluruh baris grup (jurnal asli + balik + penyesuaian), sehingga prefill tetap benar setelah koreksi berulang; akun `3000 MODAL` sengaja tidak dikembalikan. IPC baru `saldo-awal:saat-ini` mengembalikan `{ tanggal, saldo, keterangan, tanggalMaksimal? }` dan menolak dengan pesan jelas bila belum ada saldo awal. `TransaksiTab` memilih tombol **Koreksi Saldo Awal** hanya setelah status termuat dan `boleh:false` (status `null` tetap menampilkan wizard biasa nonaktif), memuat prefill lebih dulu, lalu membuka `SaldoAwalWizard` mode `koreksi`. Wizard prefills tanggal/saldo/keterangan, mewajibkan alasan koreksi >=5 karakter (trim), menjelaskan jurnal lama tersimpan di audit, menampilkan pratinjau selisih + baris penyeimbang `3000`, dan mengirim `api.saldoAwalKoreksi(form, { alasan, ...opsi })` ke IPC `saldo-awal:koreksi`. Setelah sukses, status dimuat ulang dari DB; mode awal tetap optimistis terkunci, sedangkan koreksi tidak pernah membuat status `boleh:true`. Form biasa tetap terkunci saat `boleh:false`. Review menemukan dan memperbaiki satu cacat: batas tanggal koreksi kini memakai jurnal non-pembukaan paling awal, bukan `statusSaldoAwal.tanggalMaksimal` yang masih menunjuk `SALDO_AWAL` lama setelah tanggal mulai dipindahkan, sehingga prefill tidak terjepit kembali ke tanggal lama. `src/preload/index.ts` tidak perlu diubah karena memakai `invoke` generik. Verifikasi: `npm test -- tests/saldo-awal.test.ts tests/forms-ui.test.ts tests/saldo-awal-koreksi.test.ts tests/ipc-main.test.ts` 124 lulus; `npm run typecheck` lulus; `npm test` 86 file/1.112 test lulus. `npm run audit:ui`: 1024x768 dan 1024x680 lulus; 1280x800 gagal pada assertion lama jumlah tombol nav `15 !== 16` di `e2e/ui-audit.test.mjs` (jumlah item nav saat ini memang 12 item + 3 header grup = 15; `App.tsx`/e2e tidak disentuh T1.8 dan kegagalan reproducible, jadi di luar lingkup tiket; test tidak diubah). Commit kode `72d4260`.

- [x] **T1.9 — Regression P0 & smoke manual**
  - **Langkah:**
    1. Pastikan empat reproduksi baseline punya test permanen.
    2. Jalankan `npm run typecheck` dan `npm test`.
    3. Smoke manual: backup ke DB aktif ditolak; DB tanpa tabel ditolak; reversal saldo awal diblokir; koreksi saldo awal berhasil; DB dibuka ulang tanpa kehilangan data.
  - **Selesai bila:** semua test P0 lulus dan tidak ada data hilang pada skenario manual.
  - **Verifikasi:** hasil test + catatan smoke di tiket.
  - **Catatan:** File disentuh: `tests/regresi-p0.test.ts` (baru), `TICKETS.md`. Empat reproduksi baseline sudah punya test permanen yang menguji perilaku, bukan smoke: (a) `tests/backup-restore.test.ts:300` menolak `dest === db.name` sebelum `VACUUM INTO`, byte DB tidak berubah, tidak ada tmp/bak, lalu jurnal baru tetap ada setelah close/reopen; (b) `tests/skema-kompatibilitas.test.ts:154` menghapus `jurnal_baris`, `openDb` ditolak tanpa membuat tabel kosong, byte file identik, tanpa `-wal`/`-shm`, versi tetap v1; (c) `tests/reversal.test.ts:436` + `tests/saldo-awal-koreksi.test.ts:356` menolak reversal/isi-ulang `SALDO_AWAL` tanpa jurnal/audit baru dan saldo tetap; (d) `tests/saldo-awal-koreksi.test.ts:65` dan `:155` membuktikan laporan berubah, audit bertambah, dan koreksi kedua membalik `UMUM` aktif sehingga unique index tidak dilanggar. Celah yang ditutup `tests/regresi-p0.test.ts`: hasil koreksi dan penolakan reversal diuji pada DB **file** yang ditutup lalu dibuka ulang (persistensi sesi), termasuk koreksi berulang setelah reopen (5 jurnal, 1 `SALDO_AWAL`, audit 2, neraca seimbang) dan reversal yang tetap tidak mengubah jurnal/audit/saldo setelah reopen. Verifikasi: `npm run typecheck` lulus; `npm test` **87 file / 1.114 test lulus, 0 gagal** (baseline 85/1.078; sebelumnya 86/1.112) — 5 file fokus P0 = 70 test lulus. Smoke manual terotomatisasi `npx tsx` (DB di temp dir, skrip dihapus setelah lulus) **5/5 skenario lulus**: (1) backup ke DB aktif ditolak, DB tetap bisa menulis, jurnal baru bertahan setelah reopen; (2) DB v1 tanpa `jurnal_baris` ditolak, byte file & sentinel tetap, tanpa sidecar; (3) reversal saldo awal diblokir, jumlah jurnal/audit dan saldo tidak berubah; (4) koreksi saldo awal mengubah laporan (kas 5jt→8jt, neraca seimbang) dan audit bertambah; (5) DB dibuka ulang setelah koreksi tanpa data hilang, koreksi kedua setelah reopen tetap sah (unique index aman). Commit test `98604d9`.

---

## Fase 2 — P1: Kontrol akuntansi, keamanan, dan UX

- [x] **T2.1 — Helper backend untuk kemampuan koreksi jurnal**
  - **Masalah:** UI menebak aksi yang boleh dari `jenis` dan akun, sehingga tombol Koreksi muncul untuk panjar/pinjaman/saldo awal yang pasti ditolak backend.
  - **File:** `src/db/reversal.ts`, `src/db/repository.ts`, `src/features/export/...` bila perlu.
  - **Langkah:**
    1. Tambah fungsi `kemampuanKoreksiJurnal(db, jurnal)` yang mengembalikan `{ bisaDibalik, bisaDikoreksi, alasan }`.
    2. Cek: jurnal ada, bukan `REVERSAL`, belum punya reversal, bukan anggota panjar (`panjar.jurnal_open_id`/`jurnal_close_id`), bukan pinjaman (`pinjaman.jurnal_pencairan_id`/`pinjaman_bayar.jurnal_id`), dan bukan `SALDO_AWAL`.
    3. Untuk pinjaman, gunakan relasi tabel — bukan heuristik “jenis HUTANG + akun 2050”.
  - **Selesai bila:** helper memberi alasan yang benar untuk panjar, pinjaman pokok, pinjaman bunga saja, saldo awal, dan jurnal yang sudah dikoreksi.
  - **Verifikasi:** test unit baru.
  - **Catatan:** File disentuh: `src/db/reversal.ts`, `tests/kemampuan-koreksi-jurnal.test.ts` (baru), `TICKETS.md`. `kemampuanKoreksiJurnal(db, jurnal)` menerima objek minimal `{ id }` (atau `Jurnal`) dan SELALU membaca ulang jurnal dari DB, sehingga `jenis` dari renderer diabaikan. Urutan aturan: tidak ditemukan → `REVERSAL`/`reversal_of` (pakai `PESAN_REVERSAL.asliBalik`) → sudah punya reversal (`SELECT 1 FROM jurnal WHERE reversal_of = ?`, pakai `PESAN_REVERSAL.sudahDibalik`) → panjar (`jurnal_open_id`/`jurnal_close_id`/`jurnal_batal_id`) → pinjaman (`pinjaman.jurnal_pencairan_id` UNION `pinjaman_bayar.jurnal_id`) → `SALDO_AWAL`; masing-masing memakai `PESAN_REVERSAL_PANJAR`, `PESAN_REVERSAL_PINJAMAN`, `PESAN_REVERSAL_SALDO_AWAL` yang sudah ada, dirangkum di `PESAN_KOREKSI_JURNAL`. `bisaDibalik` dan `bisaDikoreksi` sengaja memakai aturan yang sama karena koreksi isi ulang juga menulis reversal; perbedaan sah nanti harus diubah di helper ini, bukan di UI. `alasan` bernilai `null` bila kedua aksi boleh. Pemeriksaan panjar capability memakai fungsi terpisah yang menyertakan `jurnal_batal_id`, sehingga perilaku/pesan `reverseJurnal` publik untuk jurnal batal (DB-21, tetap "jurnal balik") tidak berubah. Deteksi pinjaman memakai relasi tabel, bukan heuristik jenis HUTANG + akun 2050; test membuktikan pembayaran bunga saja (`pokok: 0`, jurnal HUTANG berisi 5063 tanpa 2050) tetap ditolak dengan alasan pinjaman. Verifikasi: `npx vitest run tests/kemampuan-koreksi-jurnal.test.ts tests/reversal.test.ts tests/aud2-13-transaksi-terakhir.test.ts` 3 file/46 test lulus; `npm run typecheck` lulus; `npm test` 88 file/1.122 test lulus, 0 gagal. Commit kode `ecef39d`.

- [x] **T2.2 — Expose capability flags dan pakai di UI**
  - **Masalah:** `JurnalTab`/`TransaksiTab` masih memakai daftar jenis dan `jurnalTerhubungPinjaman` yang tidak lengkap.
  - **File:** `src/db/repository.ts`, tipe `JurnalLengkap`, `src/renderer/components/JurnalTab.tsx`, `src/renderer/components/TransaksiTab.tsx`, `src/renderer/lib/api.ts`.
  - **Langkah:**
    1. Tambah field `bisa_dibalik`, `bisa_dikoreksi`, `alasan_tidak_bisa` pada DTO jurnal.
    2. Ganti logika tombol dengan field tersebut; tampilkan alasan di tooltip/teks bantuan.
    3. Hapus atau jadikan fallback `JENIS_BISA_DIBATALKAN`/`jurnalTerhubungPinjaman`.
  - **Selesai bila:** tidak ada tombol koreksi yang selalu gagal; alasan ketidakbisaan terlihat; test pure function dan UI lulus.
  - **Verifikasi:** `npm test -- tests/reversal.test.ts tests/aud2-13-transaksi-terakhir.test.ts tests/ui-audit`.
  - **Catatan:** File disentuh: `src/db/kemampuanKoreksi.ts` (baru), `src/db/reversal.ts`, `src/db/repository.ts`, `src/db/laporan.ts`, `src/renderer/lib/api.ts`, `src/renderer/components/JurnalTab.tsx`, `src/renderer/components/TransaksiTab.tsx`, `tests/kemampuan-koreksi-jurnal.test.ts`, `tests/reversal.test.ts`, `tests/aud2-13-transaksi-terakhir.test.ts`, `TICKETS.md`. `kemampuanKoreksiJurnal` + pesan panjar/pinjaman dipindah ke `src/db/kemampuanKoreksi.ts` yang hanya bergantung pada `Database` + `core/reversal`; `reversal.ts` mengimpor dan me-re-export helper/tipe/pesan lama sehingga test/API T2.1 tetap kompatibel, `repository.ts` mengimpor modul baru tanpa siklus. `JurnalLengkap` (DB + renderer) kini membawa `bisa_dibalik`, `bisa_dikoreksi`, `alasan_tidak_bisa`; `listJurnalLengkap` mengisi ketiganya per baris lewat helper (jurnal dibaca ulang dari DB), dan `laporanDetailJurnal` yang mengonstruksi DTO manual ikut dilengkapi. `JurnalTab` memakai `bisa_dikoreksi`/`alasan_tidak_bisa` lebih dulu (tooltip pada tombol Koreksi nonaktif), dengan fallback lama untuk objek tanpa field; `TransaksiTab` memakai `bisa_dibalik`/`alasan_tidak_bisa` lebih dulu, menampilkan alasan sebagai teks kecil di bawah status dan hanya menampilkan tombol Batalkan bila boleh, dengan `JENIS_BISA_DIBATALKAN`/`jurnalTerhubungPinjaman` dipertahankan sebagai fallback objek lama. Test baru mencakup flag DTO untuk UMUM aktif, `SALDO_AWAL`, panjar open/close, pinjaman pencairan/pokok/bunga saja, `REVERSAL`, dan jurnal sudah dikoreksi; pure function UI memakai flag + fallback; SSR kartu Transaksi menampilkan alasan tanpa tombol; test sumber memastikan `JurnalTab` memakai alasan capability pada `title`. Verifikasi: `npx vitest run tests/reversal.test.ts tests/aud2-13-transaksi-terakhir.test.ts tests/kemampuan-koreksi-jurnal.test.ts` 3 file/52 test lulus; `npm run typecheck` lulus; `npm test` **88 file/1.128 test lulus, 0 gagal**. `tests/ui-audit` tidak ada sebagai test vitest (audit UI adalah e2e `npm run audit:ui`); `npm run audit:ui` dijalankan: 1024x768 dan 1024x680 lulus, 1280x800 gagal pada assertion nav lama (`Jumlah tombol nav tidak sesuai setelah grup Laporan dibuka: 15 !== 16`) yang sudah tercatat sebagai kegagalan pre-existing di T1.8, bukan akibat perubahan ini. Commit kode `7d487f6`.

- [x] **T2.3 — Regression pembayaran pinjaman bunga saja**
  - **Masalah:** pembayaran bunga tanpa pokok tidak selalu memuat akun 2050, sehingga deteksi lama menganggapnya boleh dibatalkan dari Transaksi. Pembatalan harus lewat modul Pinjaman.
  - **File:** `tests/pinjaman-pembatalan-validation.test.ts`, `tests/pinjaman.test.ts`.
  - **Langkah:** buat pinjaman, catat pembayaran dengan `pokok: 0` dan `bunga > 0`, lalu pastikan capability `bisaDibalik=false` dan alasan menunjuk modul Pinjaman.
  - **Selesai bila:** test gagal pada implementasi lama dan lulus setelah T2.1/T2.2.
  - **Verifikasi:** `npm test -- tests/pinjaman-pembatalan-validation.test.ts`.
  - **Catatan:** File disentuh: `tests/pinjaman-pembatalan-validation.test.ts`, `tests/pinjaman.test.ts`, `TICKETS.md`. Test memakai API pinjaman asli: `simpanPinjamanLpd` (pencairan + jadwal 2 angsuran) lalu `bayarAngsuranPinjaman` dengan `pokok: 0`, `bunga: RP(100_000)` sehingga jurnal pembayaran berjenis `HUTANG` hanya berisi D 5063 / K kas **tanpa baris 2050**. Assertion: capability `kemampuanKoreksiJurnal` memberi `bisaDibalik=false`, `bisaDikoreksi=false`, dan `alasan` persis `PESAN_REVERSAL_PINJAMAN` (mengarah ke “menu Pinjaman LPD”); DTO `listJurnalLengkap` membawa flag yang sama; `reverseJurnal` generik ditolak tanpa jurnal baru, sedangkan `batalkanPembayaranPinjaman` di modul Pinjaman berhasil menandai pembayaran `dibatalkan`. Test negatif juga menegaskan heuristik lama (`jenis HUTANG` + akun 2050) gagal mendeteksi jurnal ini. Bukti regresi: dengan patch sementara yang mengembalikan heuristik lama, kedua test T2.3 **gagal** (`bisaDibalik: true`); setelah dipulihkan keduanya lulus. Verifikasi: `npm test -- tests/pinjaman-pembatalan-validation.test.ts tests/pinjaman.test.ts` (2 file/16 test lulus), `npm run typecheck` lulus, `npm test` **88 file/1.131 test lulus, 0 gagal**. Commit `67810a2`.

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
