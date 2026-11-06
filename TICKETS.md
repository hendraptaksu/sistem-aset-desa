# Tiket Reset Skema v1 & Pembersihan Dokumen

**Status:** aktif  
**Cara pakai:** kerjakan satu tiket, centang `[x]` hanya setelah test/verifikasi terkait lulus.  
**Lokasi:** root repo. Hapus file ini setelah semua tiket selesai agar tidak menjadi context rot.

## Keputusan yang sudah disetujui

- [x] Baseline `SCHEMA_VERSION = 1`; DB lama ditolak, bukan dimigrasikan.
- [x] Keseimbangan jurnal cukup dijaga `validasiJurnal` + `auditIntegritas`; belum perlu `DRAFT → POSTED`.
- [x] Tidak ada tombol “Mulai Database Baru”; pesan saja: pindahkan/hapus file DB lalu jalankan lagi.
- [x] Konsolidasi dokumen: `erd-v2.md` + `sumber-coa.md` + `sumber-data-pinjaman.md` → `docs/skema.md`.
- [x] `arah-akuntansi.md` → `docs/prinsip-akuntansi.md`.
- [x] Hapus artefak audit lama di `docs/audit/`.

## Aturan kerja

- Jangan menambah jalur migrasi untuk DB lama.
- Jangan mengubah logika akuntansi di `src/core/` atau `src/db/integritas.ts` kecuali ada bug yang terbukti.
- Jangan menghapus test akuntansi yang masih relevan.
- Jangan menulis ulang git history.
- Kerjakan tiket schema secara berurutan karena banyak menyentuh `src/db/database.ts`.

---

## Fase 0 — Persiapan

- [x] **T0.1 — Branch kerja**
  - Buat branch `reset-skema-v1` dari commit terbaru.
  - Selesai bila `git status` bersih.

- [x] **T0.2 — Catat baseline test**
  - Jalankan `npm run typecheck` dan `npm test`.
  - Simpan hasilnya (jumlah test lulus/gagal) untuk pembanding di akhir.
  - Selesai bila output baseline tercatat di deskripsi PR/commit.
  - **Baseline (2026-11-06):** typecheck lulus; `vitest run` 93 file / 1110 test lulus, 0 gagal.

---

## Fase 1 — Skema baseline v1

- [ ] **T1.1 — Konstanta skema**
  - File: `src/db/database.ts`
  - Ubah `SCHEMA_VERSION` menjadi `1`.
  - Pertahankan `TABEL_AKTIF` berisi 11 tabel aktif.
  - Tambah `PESAN_DB_TIDAK_KOMPATIBEL` yang menyebut skema v1 dan instruksi menghapus/memindahkan file DB.
  - Selesai bila tidak ada lagi referensi ke versi 2–23 di konstanta aktif.

- [ ] **T1.2 — DDL tabel kanonik**
  - File: `src/db/database.ts`
  - Tulis satu `DDL` berisi 11 tabel aktif, semuanya `STRICT`.
  - Pastikan tidak ada tabel legacy (`transaksi`, `coa`, `pihak`, `jurnal_pihak`, `aset`, `anggaran`, `rekonsiliasi_bank`, `lampiran_jurnal`).
  - Hapus pemisahan `DDL_PINJAMAN` bila tidak diperlukan; inline ke `DDL`.
  - Selesai bila DB baru `openDb(':memory:')` punya 11 tabel dan semuanya `STRICT`.

- [ ] **T1.3 — DDL index kanonik**
  - File: `src/db/database.ts`
  - Pindahkan semua index ke `DDL`/`DDL_INDEX`:
    - `idx_jurnal_tanggal`, `idx_jurnal_grup`, `idx_jurnal_reversal`
    - `idx_jurnal_no_bukti_tahun`
    - `ux_jurnal_saldo_awal`, `ux_jurnal_reversal`
    - `ux_akun_nama_nocase`
    - `idx_jurnal_baris_jurnal`, `idx_jurnal_baris_akun`
    - `idx_audit_tanggal`, `idx_audit_aksi`, `idx_audit_ref`
    - `idx_panjar_status`, `idx_panjar_tanggal`, `idx_panjar_item_panjar`
    - `ux_panjar_jurnal_open`, `ux_panjar_jurnal_close`, `ux_panjar_jurnal_batal`
    - seluruh index pinjaman.
  - Selesai bila index dibuat dari DDL, bukan dari fungsi migrasi.

- [ ] **T1.4 — DDL trigger kanonik**
  - File: `src/db/database.ts`
  - Pindahkan semua trigger ke `DDL`/`DDL_TRIGGER`:
    - trigger satu sisi + integer + non-negatif pada `jurnal_baris`;
    - trigger immutable `jurnal` dan `jurnal_baris`;
    - trigger validasi `jurnal` (jenis + tanggal);
    - trigger validasi `akun` insert/update;
    - trigger audit append-only;
    - trigger `tutup_buku` tidak bisa dihapus.
  - Gunakan pola `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` agar definisi selalu sesuai kode.
  - Selesai bila membuka DB berulang tidak menggandakan trigger dan trigger yang hilang bisa dipulihkan.

- [ ] **T1.5 — Hapus seluruh kode migrasi**
  - File: `src/db/database.ts`
  - Hapus:
    - `terapkanMigrasiSingleEntryLama`
    - `terapkanAturanV9`, `V10`, `V11`, `V12`, `V13`, `V14`, `V15`, `V16`, `V17`, `V18`, `V19`, `V20`, `V21`, `V23`
    - `TABEL_SINGLE_ENTRY_LAMA`, `VERSI_SINGLE_ENTRY_TERAKHIR`, `TABEL_DIHAPUS_V12`
    - `PESAN_DUPLIKAT_*` yang hanya dipakai migrasi
    - `rebuildTabelTarget`, `rebuildTabelBentukLama`, `ddlTargetTabel`, `kolomDariDdl`
    - `migrasi()`.
  - Selesai bila `rg "terapkanMigrasi|terapkanAturan|TABEL_DIHAPUS|TABEL_SINGLE_ENTRY|rebuildTabel" src/db/database.ts` kosong.

- [ ] **T1.6 — Guard kompatibilitas DB**
  - File: `src/db/database.ts`
  - Tambah `cekKompatibilitas(db)` yang berjalan **sebelum** `journal_mode = WAL`:
    - `user_version > 1` → tolak;
    - `user_version === 0` tetapi sudah ada tabel → tolak;
    - `user_version === 1` tetapi ada tabel di luar `TABEL_AKTIF` (kecuali `sqlite_%`) → tolak.
  - Pesan error harus menyebut file DB lama/tidak kompatibel dan instruksi memindahkan/menghapus file.
  - Selesai bila file DB lama tidak berubah byte-for-byte saat ditolak.

- [ ] **T1.7 — `siapkanSkema()` dan `openDb()` baru**
  - File: `src/db/database.ts`
  - `siapkanSkema(db)`:
    - jalankan `DDL`/index/trigger dalam satu transaksi;
    - verifikasi `pastikanTabelAktifStrict`;
    - set `user_version = 1` bila DB baru.
  - `openDb(path)`:
    - buka koneksi;
    - panggil `cekKompatibilitas` sebelum WAL;
    - set `journal_mode = WAL` dan `foreign_keys = ON`;
    - panggil `siapkanSkema`;
    - seed/refresh COA.
  - Hapus pemanggilan `backupPraUpgrade` dari alur buka DB.
  - Selesai bila DB baru langsung v1 dan DB lama v23 ditolak.

- [ ] **T1.8 — Sapu komentar migrasi di kode**
  - File: `src/db/database.ts`, `src/features/export/*.ts`, `src/main/index.ts`, `src/db/pinjaman.ts`, `src/db/tutup.ts`
  - Hapus komentar yang menjelaskan langkah migrasi v9–v23 yang sudah tidak ada.
  - Pertahankan komentar yang menjelaskan alasan invariant akuntansi saat ini.
  - Selesai bila `rg "migrasi v|Migrasi v|pre-upgrade" src` hanya menyisakan penjelasan historis yang benar-benar perlu.

---

## Fase 2 — Hardening akuntansi (opsional, setelah Fase 1)

- [ ] **T2.1 — CHECK konsistensi status panjar**
  - File: `src/db/database.ts`
  - Tambah `CHECK` pada `panjar`:
    - `OPEN`: `jurnal_close_id IS NULL`, `jurnal_batal_id IS NULL`;
    - `CLOSED`: `jurnal_close_id IS NOT NULL`, `jurnal_batal_id IS NULL`;
    - `DIBATALKAN`: `jurnal_batal_id IS NOT NULL`, `tanggal_batal IS NOT NULL`, alasan minimal 5 karakter.
  - Selesai bila insert/update status yang tidak konsisten ditolak DB.

- [ ] **T2.2 — CHECK pinjaman dan tutup buku**
  - File: `src/db/database.ts`
  - `pinjaman.sisa_pokok_awal <= pokok_awal`.
  - `tutup_buku.tahun` dalam rentang 1900–9999.
  - Selesai bila nilai di luar batas ditolak.

- [ ] **T2.3 — Validasi tanggal dan reversal di trigger jurnal**
  - File: `src/db/database.ts`
  - Trigger `jurnal` menolak tanggal yang formatnya benar tetapi bukan tanggal kalender nyata.
  - `reversal_of` hanya boleh diisi bila `jenis = 'REVERSAL'`, dan `REVERSAL` wajib punya `reversal_of`.
  - Selesai bila `2026-02-30` dan reversal tidak konsisten ditolak.

- [ ] **T2.4 — CHECK metadata akun**
  - File: `src/db/database.ts`
  - `akun.sumber IN ('BAWAAN', 'TAMBAHAN')`.
  - Bila `kelompok` diisi, nilainya harus salah satu kelompok resmi.
  - Selesai bila nilai liar ditolak.

- [ ] **T2.5 — Test hardening**
  - File: `tests/skema-baseline.test.ts` atau test baru.
  - Uji setiap CHECK/trigger di T2.1–T2.4.
  - Selesai bila test gagal saat constraint dihapus.

---

## Fase 3 — Backup, restore, dan pemulihan

- [ ] **T3.1 — Sederhanakan daftar tabel wajib restore**
  - File: `src/features/export/export.ts`
  - Hapus `TABEL_WAJIB_V2`, `TABEL_WAJIB_RESTORE_V20`, dan parameter versi pada `tabelWajibRestore`.
  - Gunakan satu daftar 11 tabel aktif.
  - Selesai bila tidak ada lagi cabang versi 2–19.

- [ ] **T3.2 — Validasi kandidat restore hanya v1**
  - File: `src/features/export/export.ts`
  - `validasiKandidatRestore` hanya menerima `user_version === SCHEMA_VERSION`.
  - Pesan error menyebut versi file dan versi yang didukung.
  - Selesai bila backup v23 ditolak sebelum DB aktif disentuh.

- [ ] **T3.3 — Hapus `backupPraUpgrade`**
  - File: `src/features/export/export.ts`, `src/main/index.ts`
  - Hapus fungsi dan pemanggilannya.
  - Selesai bila tidak ada file `pre-upgrade-*.db` yang dibuat saat membuka DB.

- [ ] **T3.4 — Manifest Backup Lengkap hanya v1**
  - File: `src/features/export/restoreLengkap.ts`
  - Tolak manifest dengan `schemaVersion !== 1`.
  - Selesai bila backup lengkap lama ditolak dengan pesan jelas.

- [ ] **T3.5 — Pesan layar pemulihan**
  - File: `src/main/pemulihanDb.ts`
  - Tambah pesan khusus untuk DB tidak kompatibel:
    - jelaskan aplikasi hanya mendukung skema v1;
    - minta pindahkan/hapus file DB lalu jalankan lagi;
    - jangan menawarkan tombol reset otomatis.
  - Selesai bila pesan tidak menyebut “rusak” untuk DB lama yang sebenarnya valid.

- [ ] **T3.6 — Test backup/restore**
  - File: `tests/backup-restore.test.ts`, `tests/db-09-backup-lengkap.test.ts`, `tests/pemulihan-db.test.ts`
  - Update semua ekspektasi versi ke 1.
  - Tambah kasus backup v23 ditolak.
  - Selesai bila test lulus.

---

## Fase 4 — Test skema

- [ ] **T4.1 — Hapus test migrasi**
  - Hapus `tests/migrasi-v9.test.ts` s/d `tests/migrasi-v20.test.ts`.
  - Selesai bila tidak ada file `tests/migrasi-*.test.ts`.

- [ ] **T4.2 — Hapus test tabel legacy**
  - Hapus `tests/db-06-tabel-legacy.test.ts`.
  - Selesai bila tidak ada referensi `TABEL_DIHAPUS_V12`/`TABEL_SINGLE_ENTRY_LAMA` di test.

- [ ] **T4.3 — Ganti test versi baru**
  - Ganti `tests/db-05-versi-baru.test.ts` dengan `tests/skema-kompatibilitas.test.ts`.
  - Kasus:
    - DB v23 ditolak dan file tidak berubah;
    - DB v0 dengan tabel ditolak;
    - DB v1 dengan tabel asing ditolak;
    - DB v1 valid terbuka;
    - DB baru terbuka.
  - Selesai bila semua kasus lulus.

- [ ] **T4.4 — Ganti test strict migration**
  - Ganti `tests/aud2-09-strict-migration.test.ts` dengan `tests/skema-strict.test.ts`.
  - Uji bahwa DB baru langsung punya 11 tabel `STRICT`.
  - Hapus skenario rebuild tabel lama.
  - Selesai bila test tidak lagi memakai fixture non-STRICT.

- [ ] **T4.5 — Rewrite test invariant jurnal**
  - File: `tests/db-04-saldo-awal-unik.test.ts`, `tests/db-07-trigger.test.ts`
  - Hapus fixture versi lama.
  - Pertahankan uji:
    - satu `SALDO_AWAL`;
    - trigger satu sisi/integer;
    - immutable jurnal/baris;
    - audit append-only;
    - `tutup_buku` tidak bisa dihapus.
  - Selesai bila test hanya memakai DB baseline v1.

- [ ] **T4.6 — Rewrite test constraint jurnal dan akun**
  - File: `tests/db-10-jurnal-constraint.test.ts`, `tests/db-11-akun-constraint.test.ts`
  - Hapus skenario migrasi/rollback versi lama.
  - Pertahankan uji unique reversal, validasi jenis/tanggal, unique nama akun NOCASE, dan validasi akun.
  - Selesai bila test hanya menguji skema aktif.

- [ ] **T4.7 — Rewrite test audit ref dan schema invariant**
  - File: `tests/db-27-audit-ref.test.ts`, `tests/db-30-schema-invariant.test.ts`
  - Hapus referensi v21/v23 dan tabel legacy.
  - Uji kolom/index audit ref dan invariant 11 tabel aktif.
  - Selesai bila test lulus pada DB baru.

- [ ] **T4.8 — Test baseline baru**
  - File baru: `tests/skema-baseline.test.ts`
  - Uji:
    - `user_version === 1`;
    - 11 tabel aktif;
    - semua `STRICT`;
    - index/trigger wajib ada tepat satu;
    - tidak ada tabel legacy;
    - buka ulang idempoten;
    - seed COA tidak menggandakan akun.
  - Selesai bila test gagal jika satu tabel/index/trigger dihapus.

- [ ] **T4.9 — Test dokumentasi dan path**
  - Update test yang membaca dokumen:
    - `tests/erd-v2.test.ts` → `tests/skema.test.ts` (baca `docs/skema.md`);
    - `tests/coa.test.ts` → `docs/skema.md`;
    - `tests/db-16f-pinjaman-rekonsiliasi.test.ts` → `docs/skema.md`;
    - `tests/db-29-sidebar-kunci-periode.test.ts` dan `tests/db-38-tengah-tahun.test.ts` → `docs/prinsip-akuntansi.md`;
    - `tests/dokumentasi.test.ts` → daftar dokumen kanonik baru.
  - Selesai bila tidak ada test yang membaca path dokumen lama.

- [ ] **T4.10 — Suite lengkap**
  - Jalankan `npm run typecheck` dan `npm test`.
  - Perbaiki semua kegagalan yang disebabkan reset.
  - Selesai bila seluruh suite hijau.

---

## Fase 5 — Dokumen

- [ ] **T5.1 — Hapus artefak audit lama**
  - Hapus `docs/audit/observasi-2026-11-02.txt`.
  - Hapus `docs/audit/repro-akuntansi-2026-11-02.ts`.
  - Hapus folder `docs/audit/`.
  - Selesai bila `rg "docs/audit"` kosong.

- [ ] **T5.2 — Buat `docs/skema.md`**
  - Gabungkan dan pangkas:
    - `docs/erd-v2.md` — tabel, kolom, relasi, index, trigger, invariant;
    - `docs/sumber-coa.md` — sumber COA, 56 akun, metadata akun;
    - `docs/sumber-data-pinjaman.md` — model pinjaman, angka turunan, rekonsiliasi.
  - Hapus seluruh “Catatan migrasi”, “Temuan audit DB-30”, dan narasi v20/v22/v23.
  - Status dokumen: skema baseline v1.
  - Selesai bila `docs/skema.md` menjadi satu-satunya kontrak skema.

- [ ] **T5.3 — Buat `docs/prinsip-akuntansi.md`**
  - Dari `docs/arah-akuntansi.md`.
  - Buang §1 “Kenapa arah berubah”, §4 “Yang berubah”, §11 roadmap, §12 feedback WhatsApp.
  - Hapus ID tiket dari heading; pertahankan prinsip double-entry, K1–K6, cut-over, aturan panjar/pinjaman.
  - Selesai bila dokumen hanya berisi prinsip yang masih berlaku.

- [ ] **T5.4 — Hapus dokumen lama**
  - Hapus `docs/erd-v2.md`, `docs/arah-akuntansi.md`, `docs/sumber-coa.md`, `docs/sumber-data-pinjaman.md`.
  - Selesai bila tidak ada referensi ke empat path tersebut.

- [ ] **T5.5 — Update `README.md`**
  - Ganti bagian skema v22/migrasi menjadi baseline v1.
  - Hapus `pre-upgrade`, migrasi 2–22, dan klaim kompatibilitas DB lama.
  - Update daftar dokumentasi ke `docs/skema.md` + `docs/prinsip-akuntansi.md`.
  - Tambah arahan agent: baca dua dokumen itu dulu; panduan pengguna/pemeriksaan hanya bila relevan.
  - Selesai bila `README.md` tidak menyebut v22/v23/migrasi lama.

- [ ] **T5.6 — Rapikan panduan operasional**
  - File: `docs/panduan-pengguna.md`, `docs/panduan-pemeriksaan.md`, `docs/panduan-portable.md`, `docs/hardening-electron.md`, `docs/template-cetak.md`.
  - Hapus ID tiket yang tidak perlu.
  - Update bagian restore: hanya backup skema v1 yang didukung.
  - Selesai bila tidak ada instruksi lama yang bertentangan dengan reset.

- [ ] **T5.7 — Kecilkan test dokumentasi**
  - File: `tests/dokumentasi.test.ts`
  - Hapus assertion historis per tiket (DB-31, DB-24, DB-25, DB-23a/b, DB-37, dsb.).
  - Pertahankan:
    - dokumen kanonik ada;
    - istilah akuntansi kunci ada;
    - tidak ada referensi ke modul yang dihapus.
  - Tambah test bahwa daftar file `docs/*.md` sama dengan daftar kanonik.
  - Selesai bila menambah markdown historis baru akan menggagalkan test.

- [ ] **T5.8 — Sapu referensi lama**
  - Jalankan:
    ```bash
    rg "migrasi|pre-upgrade|v22|v23|erd-v2|sumber-coa|sumber-data-pinjaman|TABEL_DIHAPUS|TABEL_SINGLE_ENTRY" README.md docs src tests
    ```
  - Hapus atau perbarui setiap hasil yang masih berupa instruksi aktif.
  - Selesai bila hasil yang tersisa hanya penjelasan sejarah yang disengaja.

---

## Fase 6 — Verifikasi akhir

- [ ] **T6.1 — Typecheck, test, build**
  - Jalankan:
    ```bash
    npm run typecheck
    npm test
    npm run build
    ```
  - Selesai bila ketiganya lulus.

- [ ] **T6.2 — Uji DB baru dari nol**
  - Hapus/pindahkan `data/pura-dev.db`, `data/pura-dev.db-wal`, `data/pura-dev.db-shm`, dan `data/backups/pre-upgrade-*.db`.
  - Jalankan aplikasi (`npm run dev`) dan pastikan DB baru dibuat.
  - Verifikasi:
    - `user_version = 1`;
    - 11 tabel aktif;
    - semua `STRICT`;
    - seed COA dan seed dev berjalan.
  - Selesai bila aplikasi bisa dipakai tanpa error.

- [ ] **T6.3 — Uji penolakan DB lama**
  - Buat file DB dengan `user_version = 23` (atau pakai backup lama).
  - Jalankan aplikasi dan pastikan ditolak dengan pesan yang benar.
  - Pastikan file DB lama tidak berubah.
  - Selesai bila pesan meminta pindahkan/hapus file, bukan menawarkan migrasi.

- [ ] **T6.4 — Hapus file tiket**
  - Setelah semua tiket `[x]`, hapus `TICKETS.md`.
  - Selesai bila tidak ada tiket historis yang tertinggal di working tree.
