# Tickets Database, Scope & Permintaan Client — 2026-10-28

> Dibuat dari review database 2026-10-27 + pesan client 2026-10-28.
> Fokus: **tiket kecil yang bisa dikerjakan satu per satu oleh AI agent**.
> **Baseline terakhir 2026-10-30 (setelah DB-35):** `npm run typecheck` bersih;
> `npm test` **736 test / 58 file hijau**. `docs/panduan-portable.md` dipulihkan;
> test arsip ERD v1 dihapus karena arsipnya memang tidak dipakai. Angka **737/58**
> di dokumen AKT sudah tidak relevan. Verifikasi ulang sebelum mulai.
>
> Prinsip yang tidak boleh dilanggar:
> - Jurnal + jurnal_baris adalah satu-satunya sumber angka.
> - Jangan menyimpan saldo/laba turunan.
> - Jurnal yang sudah tersimpan tidak boleh diedit/dihapus; koreksi = reversal + alasan.
> - Satu sesi = satu ticket. Jangan mengerjakan dua ticket sekaligus.
> - Setiap ticket wajib menambah regression test.
> - Ticket skema wajib menaikkan `SCHEMA_VERSION` satu langkah dan membuat migrasi
>   idempoten. Ticket skema berikutnya memakai versi berikutnya—jangan dua ticket
>   memakai nomor versi yang sama.

---

## Cara pakai (untuk AI agent)

1. Baca **Konteks → Langkah → DoD**. Baca file yang disebut sebelum mengubah kode.
2. Pilih ticket `[ ]` paling atas yang dependency-nya selesai.
3. **Reproduksi dulu**: test merah untuk bug, atau test baru untuk perilaku yang
   belum ada. Baru perbaiki.
4. Jangan menyentuh `data/` atau `data/backups/`. Jangan mengedit/menghapus jurnal.
5. Untuk perubahan skema:
   - naikkan `SCHEMA_VERSION` di `src/db/database.ts`;
   - tambahkan langkah migrasi yang idempoten;
   - pertahankan backup pra-upgrade;
   - uji DB lama (v8/v9) + DB baru.
6. Untuk tabel lama, **jangan langsung menambah `CHECK`** — SQLite tidak bisa
   `ALTER TABLE ADD CHECK`; gunakan trigger `BEFORE INSERT/UPDATE` atau ticket
   rebuild terpisah. `CHECK` hanya untuk tabel baru.
7. Sebelum centang, wajib hijau:
   ```bash
   npm run typecheck
   npm test
   npm run build   # jika menyentuh main/preload/renderer
   ```
8. Centang dengan bukti di baris ticket:
   `(YYYY-MM-DD: hasil singkat + jumlah test)`.
9. Commit terpisah per ticket:
   `fix(DB-03): pisahkan posting manual dan form terpandu`.
10. Jangan memperluas scope. Kalau menemukan bug lain, buat ticket baru.
11. **Jangan menduplikasi ticket existing** (AKT/AUD). Lihat bagian
    "Ticket existing yang tumpang tindih" di bawah.

### Kondisi working tree 2026-10-30

- `KODE AKUN.csv` **ada kembali** (48 akun) dan `docs/KODE AKUN.xlsx` isinya
  identik. Tidak ada lagi masalah “CSV terhapus”; **DB-13a** tinggal memilih
  satu sumber mesin dan menjaga agar CSV/xlsx/`coa.ts` tidak berbeda.
- `docs/KODE AKUN.xlsx` **belum** memuat 5 akun baru (5060, 5061, 5062, 4060,
  4006). Kelimanya **disetujui 2026-10-30** sebagai tambahan di atas baseline;
  kerjakan DB-13 dan beri nama pembeda agar tidak salah pilih (Lampiran C).
- `docs/panduan-portable.md` sudah dipulihkan dari git; `docs/erd-v1-arsip.md`
  sengaja tidak dipulihkan dan test arsipnya dihapus. Baseline sudah hijau
  (DB-35).
- Belum ada perubahan kode produksi untuk fitur; perubahan 2026-10-30 baru
  sebatas dokumen + test dokumentasi (DB-35).

---

## Ringkasan

| ID | P | Ukuran | Judul | Dependency | Status |
|---|---|---|---|---|---|
| DB-00 | — | S | Baseline review database & peta temuan | — | [x] |
| DB-01 | P0 | MANUAL | Klarifikasi client: arti hutang + overlap COA + modul | — | [x] |
| DB-02 | P1 | MANUAL | Klarifikasi lampiran, Jurnal Umum, Import, Anggaran | — | [x] |
| DB-03 | P0 | M | Pisahkan endpoint posting manual vs form terpandu | — | [ ] |
| DB-04 | P0 | S | Unique saldo awal + status saldo awal | — | [ ] |
| DB-05 | P0 | S | Tolak DB yang dibuat versi aplikasi lebih baru | — | [ ] |
| DB-06 | P0 | M | Hentikan drop tabel berbasis bentuk; cleanup legacy version-gated | DB-05 | [ ] |
| DB-07 | P0 | S | Trigger migrasi: drop/create, bukan `IF NOT EXISTS` | DB-06 | [ ] |
| DB-08 | P0 | S | Validasi restore: semua tabel + `foreign_key_check` | — | [ ] |
| DB-09 | P0 | M | Backup lengkap sebagai default / blokir restore `.db` berisiko | DB-02 | [ ] |
| DB-10 | P0 | S | Constraint jurnal: unique reversal + validasi insert | — | [ ] |
| DB-11 | P0 | S | Constraint akun: unique nama + validasi tipe/posisi | — | [ ] |
| DB-12 | P0 | M | Audit integritas DB (perluas AKT-09) | — | [ ] |
| DB-13a | P0 | S | Selaraskan sumber COA: xlsx vs CSV vs `coa.ts` | — | [ ] |
| DB-13 | P1 | S | Tambah 5 akun COA baru | DB-13a | [ ] |
| DB-13b | P1 | S | Tambah 5063 BEBAN BUNGA PINJAMAN | DB-13a | [ ] |
| DB-14 | P1 | M | `akun.is_kas`/`kelompok`/`sumber` + akun bank baru | DB-13a | [ ] |
| DB-15 | P1 | S | Izinkan nonaktifkan akun bawaan (bukan hapus) | DB-14 | [ ] |
| DB-16a | P0 | S | Desain input pinjaman LPD (user input, bukan data awal) | — | [x] |
| DB-16b | P1 | M | Skema `pinjaman` + jadwal angsuran + pembayaran | DB-16a, DB-03 | [ ] |
| DB-16c | P1 | M | Wizard pinjaman LPD: pencairan / saldo awal berjalan | DB-16b | [ ] |
| DB-16d | P1 | M | Form bayar angsuran: pokok + bunga + denda | DB-16b, DB-16c | [ ] |
| DB-16e | P1 | M | Kartu hutang / mutasi bulanan pinjaman LPD | DB-16b, DB-16d | [ ] |
| DB-16f | P1 | S | Rekonsiliasi saldo 2050 vs jadwal pinjaman | DB-16b, DB-16d | [ ] |
| DB-17 | P1 | S | Verifikasi & dokumentasi Pindah Dana | DB-14 | [ ] |
| DB-18 | P1 | M | Panjar: field nota di `panjar_item` + form | — | [ ] |
| DB-19 | P1 | M | Panjar: validasi item vs jurnal close | DB-18 | [ ] |
| DB-20 | P2 | S | Panjar: rapikan kolom header (bukan drop item) | DB-19 | [ ] |
| DB-21 | P2 | M | Panjar: batal/reopen panjar OPEN | DB-18 | [ ] |
| DB-22 | — | — | **DIBATALKAN** — Lampiran: kompresi gambar | — | [x] |
| DB-23a | P1 | M | Hapus alur piutang 1050 (UI/API/builder/test) | — | [x] |
| DB-23b | P1 | M | Hapus master Pihak + `jurnal_pihak`; hutang pakai keterangan/LPD | DB-16d, DB-23a | [x] |
| DB-24 | P1 | M | Hapus modul Anggaran (UI/API/test) | — | [x] |
| DB-25 | P1 | M | Hapus modul Import Excel (UI/API/parser/test) | DB-02 | [x] |
| DB-26 | P1 | S | Jurnal Umum di balik mode lanjutan + penjelasan | DB-01, DB-03 | [ ] |
| DB-27 | P2 | S | Audit log: `ref_type`/`ref_id` | — | [ ] |
| DB-28 | P2 | S | Hapus `tutup_buku.backup_path` & `awal_tahun_buku` dari UI | — | [ ] |
| DB-29 | P2 | S | Kurangi tab sidebar & rename “Tutup Buku” | DB-23a, DB-23b, DB-24..DB-26, DB-31, DB-32 | [ ] |
| DB-30 | P2 | M | STRICT/created_at/unique name + ERD v2 | — | [ ] |
| DB-31 | P1 | M | Hapus modul Rekonsiliasi Bank (UI/API/test) | — | [x] |
| DB-32 | P1 | M | Hapus modul Inventaris Aset (UI/API/test) | — | [x] |
| DB-33 | P0 | M | Migrasi v12: drop tabel yang disetujui + guard/backup | DB-23a, DB-23b, DB-24, DB-25, DB-31, DB-32, DB-37 | [ ] |
| DB-34 | P1 | S | Audit integritas: reversal, tipe akun, tabel opsional | DB-33 | [ ] |
| DB-35 | P0 | S | Baseline dokumen/test hijau | — | [x] |
| DB-36 | P1 | S | LPD: pembayaran link-only, tanpa duplikasi nominal | DB-16b | [x] |
| DB-37 | P1 | M | Hapus modul Lampiran (UI/API/backup/test) | DB-02 | [ ] |
| DB-38 | P1 | S | Migrasi tengah tahun: saldo awal + laba periode pertama | — | [ ] |

**Backlog P2 yang belum dipecah detail:** rebuild `grup_id` → `koreksi_dari`,
`posisi_normal` generated/drop, agregasi SQL jika data membesar. Rekonsiliasi
bank & Import Excel **tidak lagi masuk backlog**: keduanya diputuskan dihapus
(DB-31/DB-25). Jangan dikerjakan sebelum P0/P1 selesai.

---

## Fase 0 — Keputusan & baseline

- [x] **DB-00 — Baseline review database & peta temuan** · P0 · S
  - **Konteks:** Review 2026-10-27 menemukan 14 tabel/18 tab, duplikasi panjar,
    migrasi destruktif, backup lampiran, dan soft-link pihak/panjar. Pesan client
    2026-10-28 menambah 5 akun, transfer antar kas, dan “pencatatan hutang”.
  - **Bukti:** dokumen review + ticket ini; belum ada perubahan kode.
  - **DoD:** pemilik menyetujui daftar ticket dan urutan prioritas.

- [x] **DB-01 — Klarifikasi client: arti hutang + overlap COA + modul** · P0 · MANUAL/OWNER
  - **Keputusan 2026-10-30:**
    1. Hutang: client hanya punya **satu pinjaman LPD**; tidak ada piutang.
       Hutang usaha non-LPD memakai `2060` + keterangan bebas (tanpa master
       pihak).
    2. **5 akun COA baru semuanya disetujui**: 5060, 5061, 5062 (BEBAN),
       4060, 4006 (PENDAPATAN). Client menyatakan semuanya kategori baru yang
       berbeda dari akun lama.
    3. Master Pihak **dihapus**; piutang **dihapus**; pinjaman LPD memakai
       modul sendiri.
    4. Rincian pinjaman (pokok/bunga/tenor) tetap menunggu **DB-16a**.
  - **Catatan usability:** nama 5060 vs 5010, 5062 vs 5004, 4060 vs 4008/4041,
    dan 4006 vs 4005 masih berpotensi membingungkan operator. Client menyatakan
    **semua akun baru tidak menggantikan akun lama**; jangan nonaktifkan akun
    lama. Saat DB-13, beri nama yang tegas membedakan agar operator tidak salah
    pilih.
  - **Dependency:** —

- [x] **DB-02 — Klarifikasi lampiran, Jurnal Umum, Import, Anggaran** · P1 · MANUAL/OWNER
  - **Keputusan 2026-10-30:**
    1. Lampiran: **hapus** modul + tabel; client tidak butuh bukti foto/PDF.
    2. Jurnal Umum: **mode lanjutan**; operator harian tidak melihat.
    3. Import Excel: **hapus**; database masih kosong, tidak ada migrasi data.
    4. Anggaran: **hapus** modul + tabel; client tidak memakai pagu.
    5. Rekonsiliasi Bank: **hapus** modul + tabel.
  - **Dampak:** DB-22 dibatalkan; DB-24/DB-25/DB-31/DB-37 dikerjakan; DB-26
    tetap.
  - **Dependency:** —

---

## Fase 1 — P0 integritas data

- [ ] **DB-03 — Pisahkan endpoint posting manual vs form terpandu** · P0 · M
  - **Konteks:** `TransaksiForm` dan `JurnalUmumEditor` sama-sama memakai
    `jurnal:posting`. Renderer bisa mengirim `jenis=PANJAR/PIUTANG/HUTANG`
    tanpa membuat metadata `panjar`/`jurnal_pihak`. `validasiJurnal()` hanya
    memeriksa akun 1040/1050/2050 ada, bukan dokumennya.
  - **Langkah:**
    1. Tambah IPC `transaksi:posting` untuk form terpandu. Pindahkan
       `TransaksiForm` ke endpoint itu.
    2. `jurnal:posting` hanya menerima `jenis='UMUM'`. Tolak `PANJAR`,
       `PIUTANG`, `HUTANG`, `REVERSAL`, `SALDO_AWAL`, `TERIMA`, `BAYAR`,
       `TRANSFER` dari jalur manual.
    3. Hapus pilihan jenis dari `JurnalUmumEditor`/`JurnalTab`; cukup tampilkan
       badge “Jurnal Umum”.
    4. `panjar:*` tetap menjadi jalur dokumen; `pihak:posting` dihapus di
       DB-23b.
  - **DoD:** manual `PIUTANG` ditolak; form Terima/Bayar/Transfer tetap
    tersimpan; nomor bukti/audit tidak berubah.
  - **Test:** `tests/jurnal-form.test.ts`, `tests/ipc-main.test.ts`,
    `tests/ipc-validation.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** —

- [ ] **DB-04 — Unique saldo awal + status saldo awal** · P0 · S
  - **Konteks:** `statusSaldoAwal()` memakai `COUNT(*) FROM jurnal`; satu jurnal
    biasa/import membuat wizard terkunci. DB juga tidak mencegah dua jurnal
    `SALDO_AWAL`.
  - **Langkah:**
    1. Migrasi: cek duplikat `jenis='SALDO_AWAL'`; bila ada, hentikan dengan
       pesan jelas (jangan hapus/ubah data).
    2. Tambah `CREATE UNIQUE INDEX ux_jurnal_saldo_awal ON jurnal(jenis)
       WHERE jenis='SALDO_AWAL';`
    3. Tambah helper `sudahAdaSaldoAwal(db)` yang membaca index/eksistensi.
       Jangan ubah kebijakan “hanya saat DB kosong” di ticket ini; itu
       AKT-01/02.
    4. Test: dua saldo awal ditolak; DB v9 dengan satu saldo awal lolos migrasi.
  - **DoD:** unique index aktif; migrasi aman; status UI konsisten.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** —

- [ ] **DB-05 — Tolak DB yang dibuat versi aplikasi lebih baru** · P0 · S
  - **Konteks:** `openDb()` menjalankan DDL/trigger lama pada DB dengan
    `user_version > SCHEMA_VERSION`. Restore sudah dicek, direct open belum.
  - **Langkah:**
    1. Di `openDb()`, sebelum migrasi: bila `versiAwal > SCHEMA_VERSION`,
       lempar error: “Database dibuat aplikasi versi lebih baru. Perbarui
       aplikasi dulu.”
    2. Tutup koneksi dengan benar.
    3. Test: DB `:memory:`/file dengan `user_version = SCHEMA_VERSION + 1`
       ditolak; DB versi sama/lama tetap terbuka.
  - **DoD:** tidak ada DDL yang dijalankan pada DB versi lebih baru.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** —

- [ ] **DB-06 — Hentikan drop tabel berbasis bentuk** · P0 · M
  - **Konteks:** `buangTabelLama()` berjalan setiap `openDb()` dan menghapus
    `panjar`/`tutup_buku` berdasarkan bentuk kolom. Ini bisa menghapus data
    nyata saat skema berubah.
  - **Langkah:**
    1. Hapus semua pengecekan `kolomTabel(...)` yang men-drop tabel.
    2. Pindahkan pembersihan single-entry lama ke langkah migrasi yang hanya
       berjalan bila `user_version < 3` (sekali saja).
    3. Jangan pernah drop `panjar`, `panjar_item`, atau `tutup_buku` berdasarkan
       bentuk; gunakan migrasi eksplisit.
    4. Test: fixture v8 dengan data panjar/tutup → buka → data utuh.
       Fixture v2 dengan `transaksi`/`coa` → buka → tabel lama hilang.
  - **DoD:** tidak ada drop berdasarkan nama kolom; data v8 aman.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** DB-05.

- [ ] **DB-07 — Trigger migrasi: drop/create, bukan `IF NOT EXISTS`** · P0 · S
  - **Konteks:** `CREATE TRIGGER IF NOT EXISTS` membuat perubahan isi trigger
    di versi baru tidak pernah berlaku pada DB lama.
  - **Langkah:**
    1. Untuk semua trigger v9: `DROP TRIGGER IF EXISTS ...` lalu `CREATE
       TRIGGER ...` di dalam transaksi migrasi.
    2. Pastikan idempoten; jangan kehilangan trigger bila migrasi gagal.
    3. Test: trigger lama dengan body berbeda diganti setelah `openDb`.
  - **DoD:** SQL trigger di `sqlite_master` sesuai kode terbaru.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** DB-06.

- [ ] **DB-08 — Validasi restore: semua tabel + `foreign_key_check`** · P0 · S
  - **Konteks:** `TABEL_WAJIB_RESTORE` hanya 7 tabel inti; backup yang
    kehilangan `panjar`/`pihak`/`lampiran` bisa lolos. `integrity_check` tidak
    memeriksa foreign key.
  - **Langkah:**
    1. Tambah daftar tabel wajib sesuai versi (atau semua tabel current).
    2. Setelah `integrity_check`, jalankan `PRAGMA foreign_key_check`; tolak
       bila ada baris.
    3. Test: backup tanpa `panjar`/`lampiran` ditolak; backup dengan FK orphan
       ditolak.
  - **DoD:** restore tidak pernah memasukkan DB dengan tabel hilang/FK rusak.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** —

- [ ] **DB-09 — Backup lengkap sebagai default / blokir restore `.db` berisiko** · P0 · M
  - **Konteks:** auto-backup harian hanya `.db`; lampiran ada di folder lain.
    Restore `.db` bisa meninggalkan lampiran yatim atau metadata menunjuk file
    hilang.
  - **Langkah:**
    1. Jika lampiran dipakai: ubah `autoBackupHarian` agar membuat folder
       backup lengkap (`pura.db` + `attachments/` + `manifest.json`) atau
       minimal blokir restore `.db` saat ada baris `lampiran_jurnal`.
    2. Perbarui `lastAutoBackup`/retensi untuk folder.
    3. Di UI, jadikan “Restore Lengkap” default; “Restore .db” jadi jalur
       berbahaya dengan konfirmasi ekstra.
    4. Test: backup lengkap berisi lampiran; restore lengkap mengembalikan
       keduanya; restore `.db` ditolak/diperingatkan saat lampiran ada.
  - **DoD:** tidak ada restore yang meninggalkan lampiran yatim tanpa peringatan.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-02.

- [ ] **DB-10 — Constraint jurnal: unique reversal + validasi insert** · P0 · S
  - **Konteks:** `reversal_of` tidak unik; dua reversal bisa ditulis lewat SQL.
    `jurnal` tidak punya validasi DB untuk jenis/tanggal.
  - **Langkah:**
    1. Cek duplikat `reversal_of`; bila ada, hentikan migrasi dengan pesan.
    2. Tambah `CREATE UNIQUE INDEX ux_jurnal_reversal ON jurnal(reversal_of)
       WHERE reversal_of IS NOT NULL;`
    3. Tambah trigger `BEFORE INSERT ON jurnal` untuk `jenis` yang dikenal dan
       bentuk tanggal `YYYY-MM-DD` (pesan bahasa Indonesia).
    4. Jangan rebuild tabel di ticket ini; trigger cukup sebagai pertahanan
       terakhir.
  - **DoD:** dua reversal ditolak; jenis/tanggal invalid ditolak DB.
  - **Test:** `tests/jurnal.test.ts` + `tests/migrasi-v9.test.ts`.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** —

- [ ] **DB-11 — Constraint akun: unique nama + validasi tipe/posisi** · P0 · S
  - **Konteks:** `akun.tipe`/`posisi_normal` hanya divalidasi kode; typo bisa
    membuat akun hilang dari laporan. Nama akun juga hanya unik di aplikasi.
  - **Langkah:**
    1. Cek duplikat nama NOCASE; tambah unique index.
    2. Tambah trigger `BEFORE INSERT/UPDATE ON akun`: kode 4 digit, nama tidak
       kosong, `tipe` salah satu 5 tipe, `posisi_normal` cocok dengan tipe,
       `aktif` 0/1.
    3. Test: semua pelanggaran ditolak; akun bawaan tetap lolos.
  - **DoD:** DB menolak akun invalid; pesan error jelas.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** —

- [ ] **DB-12 — Audit integritas DB (perluas AKT-09)** · P0 · M
  - **Konteks:** aplikasi mengandalkan validasi kode; tidak ada pemeriksaan
    integritas menyeluruh pada DB/backup.
  - **Langkah:**
    1. Buat `auditIntegritasDb(db): string[]` di `src/db/`:
       - `PRAGMA foreign_key_check`;
       - jurnal tanpa baris / total debit ≠ kredit;
       - reversal ganda / reversal atas reversal;
       - `panjar` open/close link tidak konsisten (selama masih ada);
       - `lampiran_jurnal` vs file (fungsi main, bukan core);
       - akun dengan tipe/posisi invalid;
       - `anggaran` akun nonaktif (jika masih ada).
    2. Expose IPC read-only `audit:integritas`.
    3. Jalankan saat startup (log), sebelum backup, sebelum tutup buku.
    4. Koordinasi dengan AKT-09; jangan menulis dua modul audit berbeda.
  - **DoD:** report berisi daftar masalah + jumlah; test fixture rusak.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** — (koordinasi AKT-09).

---

## Fase 2 — Permintaan client 2026-10-28

- [ ] **DB-13a — Selaraskan sumber COA: xlsx vs CSV vs `coa.ts`** · P0 · S
  - **Konteks:** `KODE AKUN.csv` (48 akun) dan `docs/KODE AKUN.xlsx` (48 akun)
    isinya identik. Tidak ada lagi masalah CSV terhapus. File xlsx **belum**
    memuat 5 akun baru yang disetujui 2026-10-30.
  - **Langkah:**
    1. Pilih satu sumber mesin: CSV ternormalisasi atau langsung xlsx. Jangan
       biarkan `coa.ts`, CSV, dan xlsx menjadi tiga sumber yang bisa berbeda.
       Rekomendasi: xlsx tetap arsip client; commit CSV hasil normalisasi
       (48 + 5 akun) dan pakai CSV di test.
    2. Jangan mengubah isi xlsx client tanpa persetujuan. Kalau perlu versi
       baru, simpan salinan bertanggal dan catat di docs.
    3. Perbaiki `tests/coa.test.ts` agar tidak bergantung pada file yang hilang;
       tambah test bahwa semua kode di xlsx ada di `COA`.
    4. Dokumentasikan bahwa 5 akun baru adalah tambahan di atas baseline 48.
  - **DoD:** `npm test` hijau; satu sumber jelas; tidak ada file CSV/Excel yatim.
  - **Test:** `tests/coa.test.ts`.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** —

- [ ] **DB-13 — Tambah 5 akun COA baru** · P1 · S
  - **Konteks:** client menyetujui 5 akun baru dan menyatakan semuanya kategori
    berbeda dari akun lama: 5060, 5061, 5062 (BEBAN), 4060, 4006 (PENDAPATAN).
  - **Langkah:**
    1. Setelah DB-13a, tambahkan kode/nama ke sumber mesin yang disepakati
       (`KODE AKUN.csv` dan `src/db/coa.ts`).
    2. Tipe: 5060/5061/5062 = BEBAN (normal DEBIT); 4060/4006 = PENDAPATAN
       (normal KREDIT).
    3. Beri nama yang tegas membedakan dari akun lama. **Jangan nonaktifkan
       akun lama**: client menyatakan semua akun baru tidak menggantikan akun
       yang sudah ada. Kalau nama masih ambigu, minta client memberi nama
       pembeda.
    4. Update `tests/coa.test.ts` (jumlah CSV/COA, nama/tipe) dan test bahwa
       baseline xlsx tetap ada.
  - **DoD:** 5 akun muncul di form/laporan; tidak ada duplikat kode/nama;
    baseline 48 + 1040 + 2060 + 5 akun.
  - **Test:** `tests/coa.test.ts`, `tests/akun.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-13a.

- [ ] **DB-13b — Tambah 5063 BEBAN BUNGA PINJAMAN** · P1 · S
  - **Konteks:** CSV client tidak punya akun bunga. `5050` adalah BIAYA
    LAIN-LAIN, bukan akun bunga. Bunga pinjaman perlu terlihat terpisah di
    Laba Rugi.
  - **Langkah:**
    1. Tambah akun `5063 BEBAN BUNGA PINJAMAN`, tipe BEBAN, normal DEBIT, ke
       `KODE AKUN.csv` dan `src/db/coa.ts`.
    2. Jangan mengganti/menonaktifkan 5050.
    3. Update test COA (jumlah akun, nama/tipe).
  - **DoD:** 5063 tersedia di form dan laporan; tidak ada duplikat.
  - **Test:** `tests/coa.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-13a.

- [ ] **DB-14 — `akun.is_kas`/`kelompok`/`sumber` + akun bank baru** · P1 · M
  - **Konteks:** `KODE_KAS` dan `LPD_KODES` masih hardcoded; bank/LPD baru tidak
    bisa ditambah dari UI. Ini juga menghalangi “Parkir BPD” jika butuh rekening
    baru.
  - **Langkah:**
    1. Migrasi `ALTER TABLE akun ADD COLUMN`:
       - `is_kas INTEGER NOT NULL DEFAULT 0`;
       - `kelompok TEXT NOT NULL DEFAULT ''` (KAS/BANK/LPD/PIUTANG/HUTANG/MODAL/…);
       - `sumber TEXT NOT NULL DEFAULT 'BAWAAN'` (BAWAAN/TAMBAHAN).
    2. Backfill dari `KODE_KAS`/`COA`; akun di luar `COA` = TAMBAHAN.
    3. `AkunDb` + `rowToAkun` membawa field baru; form/report memakai `is_kas`
       dari DB, bukan `isAkunKas` statis.
    4. `tambahAkun` mengizinkan AKTIVA kas/bank baru dengan validasi kode,
       nama, `is_kas=1`, `kelompok`; cadangkan rentang kode kustom.
    5. Jangan menimpa akun `TAMBAHAN` saat `openDb` meng-upsert COA statis.
  - **DoD:** bank/LPD baru bisa dibuat dan muncul di Pindah Dana/Panjar;
    total kas benar.
  - **Test:** `tests/coa.test.ts`, `tests/akun.test.ts`,
    `tests/forms-ui.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-13a.

- [ ] **DB-15 — Izinkan nonaktifkan akun bawaan (bukan hapus)** · P1 · S
  - **Konteks:** 16 akun kas/bank bawaan selalu muncul di form; akun 5010 yang
    mungkin digantikan 5060 juga tidak bisa disembunyikan.
  - **Langkah:**
    1. `setAkunAktif` boleh untuk akun bawaan; tetap tolak rename/hapus.
       Kecualikan akun sistem yang dibutuhkan wizard: 3000, 1040, 1050, 2050.
    2. Audit `AKUN-NONAKTIF/AKTIF`; UI menampilkan status.
    3. Form/report sudah memfilter `aktif`; pastikan laporan historis tetap
       memakai akun nonaktif.
  - **DoD:** 5010 bisa dinonaktifkan; form tidak menampilkannya; histori tetap.
  - **Test:** `tests/akun.test.ts`, `tests/forms-ui.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-14.

- [x] **DB-16a — Desain input pinjaman LPD (user input, bukan data awal)** · P0 · S
  - **Keputusan 2026-10-30:** angka pinjaman **tidak** dikumpulkan sekarang.
    Semua nilai diisi user di form:
    1. **Mode pinjaman:** “Pencairan baru” atau “Sudah berjalan”. Jika sudah
       berjalan, user mengisi sisa pokok dan memilih tanggal mulai; sisa pokok
       harus sudah ada di Saldo Awal 2050, atau wizard menawarkan membuat
       saldo awal.
    2. **Akun kas LPD:** user memilih dari daftar akun kas/bank yang aktif
       (1010, 1014, 1015, 1016, 1017, 1018, 1036, 1001, dst.). Tidak
       di-hardcode.
    3. **Akun bunga:** user memilih; default **5063 BEBAN BUNGA PINJAMAN**
       (disetujui 2026-10-30). 5050 BIAYA LAIN-LAIN hanya fallback, bukan
       akun bunga.
    4. **Jadwal angsuran:** user mengisi manual per baris (ke-, jatuh tempo,
       pokok, bunga). Aplikasi tidak menghitung sendiri; angka diambil dari
       buku/jadwal LPD.
    5. **Bunga:** dicatat saat dibayar (cash basis). Jika nanti client butuh
       akrual, itu tiket terpisah.
    6. **Denda:** user mengisi nominal; akun denda memakai 5050 BIAYA
       LAIN-LAIN (atau akun baru bila diminta).
    7. **Pembayaran:** user memilih angsuran, lalu boleh mengubah nominal
       pokok/bunga/denda sesuai realisasi.
  - **DoD:** desain form/wizard tidak membutuhkan angka dari developer;
    semua parameter berasal dari input user dan tervalidasi.
  - **Dependency:** —

- [ ] **DB-16b — Skema `pinjaman` + jadwal angsuran + pembayaran** · P1 · M
  - **Konteks:** 2050 saja tidak cukup untuk memisahkan pokok/bunga, jadwal,
    dan realisasi pembayaran. Jadwal adalah **rencana**; jurnal tetap sumber
    angka realisasi.
  - **Langkah:**
    1. Migrasi tabel (nama boleh disesuaikan dengan gaya repo):
       ```sql
       pinjaman (
         id TEXT PRIMARY KEY,
         kreditur TEXT NOT NULL,
         akun_kas TEXT NOT NULL REFERENCES akun(kode),
         akun_bunga TEXT NOT NULL REFERENCES akun(kode),
         pokok_awal INTEGER NOT NULL CHECK (pokok_awal > 0),
         sisa_pokok_awal INTEGER NOT NULL CHECK (sisa_pokok_awal >= 0),
         tanggal_mulai TEXT NOT NULL,
         tenor_bulan INTEGER,
         jurnal_pencairan_id TEXT UNIQUE REFERENCES jurnal(id), -- null = saldo awal
         catatan TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       );

       pinjaman_angsuran (
         id INTEGER PRIMARY KEY,
         pinjaman_id TEXT NOT NULL REFERENCES pinjaman(id) ON DELETE CASCADE,
         ke INTEGER NOT NULL,
         jatuh_tempo TEXT NOT NULL,
         pokok INTEGER NOT NULL CHECK (pokok >= 0),
         bunga INTEGER NOT NULL CHECK (bunga >= 0),
         catatan TEXT NOT NULL DEFAULT '',
         UNIQUE (pinjaman_id, ke)
       );

       pinjaman_bayar (
         id TEXT PRIMARY KEY,
         pinjaman_id TEXT NOT NULL REFERENCES pinjaman(id),
         angsuran_id INTEGER REFERENCES pinjaman_angsuran(id),
         jurnal_id TEXT NOT NULL UNIQUE REFERENCES jurnal(id),
         tanggal TEXT NOT NULL,
         catatan TEXT NOT NULL DEFAULT '',
         created_at TEXT NOT NULL
       );
       ```
    2. `akun_kas`/`akun_bunga` dipilih user; 5063 default untuk bunga.
       `pinjaman_bayar` **tidak menyimpan nominal**: pokok/bunga/denda dibaca
       dari baris jurnal. Ini mencegah angka ganda/ drift.
    3. Jangan simpan saldo berjalan/`sisa_pokok`; hitung dari
       `sisa_pokok_awal - SUM(pokok dibayar dari jurnal)` dan rekonsiliasi
       dengan 2050.
    4. Validasi: jumlah pokok jadwal = `sisa_pokok_awal`; tanggal jatuh tempo
       valid/urut; tidak ada `ke` ganda.
    5. `jurnal_pencairan_id` null berarti pinjaman sudah berjalan dan sisa
       pokok ada di Saldo Awal 2050; jangan posting pencairan baru.
    4. `jurnal_pencairan_id` null berarti pinjaman sudah ada di saldo awal;
       jangan membuat jurnal pencairan baru.
  - **DoD:** skema + repository + test; jadwal 12 bulan dengan total pokok =
    sisa pokok; pembayaran mengurangi outstanding; tidak ada saldo tersimpan.
  - **Test:** test baru `tests/pinjaman.test.ts` + `tests/migrasi-*.test.ts`.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** DB-16a, DB-03.

- [ ] **DB-16c — Wizard pinjaman LPD: pencairan / saldo awal berjalan** · P1 · M
  - **Konteks:** pinjaman mungkin sudah berjalan sebelum aplikasi dipakai.
    Jangan memaksa jurnal pencairan baru yang membuat kas/2050 dobel.
  - **Langkah:**
    1. Mode **Pencairan baru**: isi tanggal, LPD, pokok, kas/bank penerima,
       akun bunga, tenor; posting D kas / K 2050; simpan `jurnal_pencairan_id`.
    2. Mode **Sudah berjalan**: isi sisa pokok saat ini, tanggal mulai jadwal,
       jadwal sisa; **tidak** posting jurnal pencairan. Tampilkan peringatan
       bahwa 2050 harus sudah ada di Saldo Awal.
    3. Jadwal: input manual per baris (ke, jatuh tempo, pokok, bunga). Untuk
       versi pertama, **jangan** hitung otomatis; ambil dari perjanjian LPD.
    4. Validasi total pokok jadwal = sisa pokok; tanggal tidak mundur.
  - **DoD:** pinjaman baru membuat jurnal pencairan; pinjaman berjalan tidak
    membuat jurnal baru; jadwal tersimpan.
  - **Test:** dua mode; total jadwal salah ditolak; jurnal seimbang.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-16b.

- [ ] **DB-16d — Form bayar angsuran: pokok + bunga + denda** · P1 · M
  - **Konteks:** pembayaran LPD harus memisahkan pokok (mengurangi 2050) dan
    bunga (beban), bukan satu baris “bayar hutang”.
  - **Langkah:**
    1. Pilih angsuran yang belum dibayar; prefill pokok/bunga dari jadwal.
    2. Form: tanggal bayar, kas/bank, pokok, bunga, denda, catatan.
    3. Jurnal: **D 2050 (pokok) + D akun bunga (bunga) + D beban denda
       (denda) / K kas (total)**. Gunakan `postingJurnal`.
    4. Simpan `pinjaman_bayar` + link `jurnal_id`; audit
       `PINJAMAN-BAYAR`.
    5. Jika nominal berbeda dari jadwal, minta konfirmasi + alasan; jangan
       mengubah jadwal secara diam-diam.
  - **DoD:** satu pembayaran menghasilkan jurnal 3–4 baris seimbang; 2050
    turun sebesar pokok; bunga masuk Laba Rugi; status angsuran terbayar.
  - **Test:** `tests/pinjaman.test.ts`, `tests/jurnal.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-16b, DB-16c.

- [ ] **DB-16e — Kartu hutang / mutasi bulanan pinjaman LPD** · P1 · M
  - **Konteks:** client ingin melihat mutasi pokok/bunga/angsuran setiap bulan.
  - **Langkah:**
    1. Laporan per bulan: saldo awal pokok, pokok dibayar, bunga dibayar,
       denda, total kas keluar, saldo akhir pokok.
    2. Tampilkan juga jadwal vs realisasi (selisih), dan drill-down ke jurnal.
    3. Semua angka dari **baris jurnal** + link `pinjaman_bayar`; jangan
       simpan nominal/saldo bulanan di tabel pembayaran.
    4. Filter periode; default tahun berjalan.
  - **DoD:** total pokok di laporan = penurunan 2050; total bunga = beban
    bunga; saldo akhir bulan berurutan.
  - **Test:** `tests/pinjaman.test.ts`, `tests/laporan.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-16b, DB-16d.

- [ ] **DB-16f — Rekonsiliasi saldo 2050 vs jadwal pinjaman** · P1 · S
  - **Konteks:** jika jurnal pembayaran salah akun atau saldo awal tidak cocok,
    laporan pinjaman bisa berbeda dari Neraca.
  - **Langkah:**
    1. Hitung outstanding dari 2050 (kredit − debit) dan dari
       `sisa_pokok_awal - SUM(pokok dibayar)`.
    2. Tampilkan peringatan bila selisih != 0; jangan menulis angka koreksi
       otomatis.
    3. Tambahkan ke audit integritas DB-12.
  - **DoD:** selisih terdeteksi; tidak ada auto-koreksi; pesan jelas.
  - **Test:** `tests/pinjaman.test.ts`.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** DB-16b, DB-16d.

- [ ] **DB-17 — Verifikasi & dokumentasi Pindah Dana** · P1 · S
  - **Konteks:** “Transaksi antar Kas/bank” sudah ada sebagai form Pindah Dana
    (`TRANSFER`), tetapi client mungkin belum menemukannya.
  - **Langkah:**
    1. Pastikan semua pasangan akun `is_kas` bisa dipilih; tidak boleh akun
       sama; total kas tidak berubah.
    2. Tambah test regresi untuk minimal 3 pasangan (kas→bank, bank→LPD,
       LPD→kas).
    3. Tambah langkah di `docs/panduan-pengguna.md` dengan contoh.
  - **DoD:** test semua pasangan hijau; panduan menyebut menu Transaksi →
    Pindah Dana.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-14.

- [ ] **DB-18 — Panjar: field nota di `panjar_item` + form** · P1 · M
  - **Konteks:** user butuh rincian per nota; `panjar_item` sekarang hanya
    menyimpan akun beban/nominal/jurnal_id. `buatJurnalPanjarClose` juga
    menggabungkan item per akun, sehingga detail nota hilang.
  - **Langkah:**
    1. Migrasi `ALTER TABLE panjar_item ADD COLUMN`:
       `nota_nomor TEXT NOT NULL DEFAULT ''`,
       `nota_tanggal TEXT NOT NULL DEFAULT ''`,
       `toko TEXT NOT NULL DEFAULT ''`,
       `keterangan TEXT NOT NULL DEFAULT ''`.
    2. Tambah field yang sama ke `ItemPanjarClose`/`ItemCloseInput`; validasi
       panjang dan tanggal nota.
    3. Form close panjar: input nomor nota, tanggal nota, toko, akun beban,
       nominal, keterangan.
    4. Jurnal close tetap boleh menggabungkan per akun; detail nota disimpan
       di `panjar_item`.
    5. `panjar_item.nominal` harus > 0; tanggal nota tidak boleh setelah
       tanggal close.
  - **DoD:** dua nota dengan akun sama tersimpan sebagai dua baris
    `panjar_item`; jurnal close tetap seimbang; UI menampilkan detail nota.
  - **Test:** `tests/panjar.test.ts` + test migrasi.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** —

- [ ] **DB-19 — Panjar: validasi item vs jurnal close** · P1 · M
  - **Konteks:** setelah DB-18, `panjar_item` adalah subledger detail dan
    jurnal close adalah sumber total. Keduanya bisa drift jika tidak
    direkonsiliasi.
  - **Langkah:**
    1. Saat close, hitung total `panjar_item` per akun dan bandingkan dengan
       baris debit BEBAN di jurnal close. Tolak jika selisih.
    2. `total_realisasi` panjar = `SUM(panjar_item.nominal)`; tampilkan juga
       total per akun.
    3. `listPanjarItemsV2` mengembalikan field nota/toko/keterangan.
    4. Tambah pemeriksaan di `auditIntegritas`: panjar CLOSED harus punya item
       dan total item per akun = debit jurnal close.
    5. Jangan hapus `panjar_item`; tabel ini memang detail nota.
  - **DoD:** selisih item vs jurnal ditolak/dilaporkan; detail nota tampil;
    total panjar benar.
  - **Test:** `tests/panjar.test.ts`, `tests/integritas.test.ts`.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** DB-18.

- [ ] **DB-20 — Panjar: rapikan kolom header (bukan drop item)** · P2 · S
  - **Konteks:** `panjar` menyimpan `tanggal`, `jumlah`, `akun_kas_sumber`,
    `status`, `tanggal_close`; sebagian bisa dibaca dari jurnal, tetapi
    menyimpannya membuat UI sederhana. Jangan over-normalisasi.
  - **Langkah:**
    1. Dokumentasikan kolom mana yang sengaja disimpan (header operasional)
       dan mana yang dihitung (total realisasi/sisa/kurang).
    2. Pastikan `jumlah` = nominal jurnal open; `akun_kas_sumber` = akun kas
       di jurnal open; `tanggal` = tanggal jurnal open.
    3. Tambah `UNIQUE` pada `jurnal_open_id` dan `jurnal_close_id` bila belum.
    4. **Jangan** drop `panjar_item`; itu detail nota yang dibutuhkan.
  - **DoD:** tidak ada kolom header yang bertentangan dengan jurnal; UI tetap
    berfungsi.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-19.

- [ ] **DB-21 — Panjar: batal/reopen panjar OPEN** · P2 · M
  - **Konteks:** koreksi panjar diblokir dari Jurnal Umum, tetapi belum ada
    “Batalkan panjar”. Salah serah = buntu.
  - **Langkah:**
    1. Hanya untuk status OPEN: buat reversal jurnal serah (D kas / K 1040),
       tautkan `jurnal_batal_id`, tampilkan status DIBATALKAN.
    2. Audit `PANJAR-BATAL`; jangan hapus jurnal.
    3. Jangan tangani panjar CLOSED di ticket ini; buat ticket lanjutan bila
       perlu.
  - **DoD:** panjar OPEN bisa dibatalkan; saldo 1040 kembali; riwayat tetap.
  - **Test:** `tests/panjar.test.ts` + `tests/reversal.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-18.

- [x] **DB-22 — DIBATALKAN: Lampiran: kompresi gambar** · — · —
  - **Keputusan 2026-10-30:** lampiran tidak dipakai; modul dan tabel dihapus
    lewat **DB-37** dan **DB-33**. Tidak ada kompresi yang perlu dibuat.

- [ ] **DB-23/DB-24/DB-25 — dipindahkan ke Fase 4**
  - Versi lama (“sembunyikan UI saja”) sudah diganti oleh **DB-23a/DB-23b/
    DB-24/DB-25** di Fase 4: hapus modul, siapkan drop tabel, lalu DB-33.
  - Jangan mengerjakan versi lama; lihat Fase 4.

- [ ] **DB-26 — Jurnal Umum di balik mode lanjutan + penjelasan** · P1 · S
  - **Konteks:** user tidak memahami Jurnal Umum. Jangan tampilkan sebagai menu
    harian; akuntan pendamping tetap bisa memakainya.
  - **Langkah:**
    1. Pindahkan `jurnal` ke grup “Data & Sistem” atau tambahkan toggle
       “Mode lanjutan” dengan konfirmasi.
    2. Tambah teks: “Jurnal Umum = tampilan debit/kredit untuk pemeriksaan.
       Operator harian tidak perlu membuka ini.”
    3. Pastikan DB-03 sudah membatasi jenis manual.
  - **DoD:** operator tidak melihat Jurnal Umum secara default; akuntan bisa
    membuka setelah konfirmasi; test menu.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-01, DB-03.

---

## Fase 3 — P2 kebersihan

- [ ] **DB-27 — Audit log: `ref_type`/`ref_id`** · P2 · S
  - Tambah kolom `ref_type`/`ref_id` (ALTER), isi untuk aksi baru, update
    `catatAudit`; query riwayat per jurnal tanpa `LIKE`.
  - Append-only/tutup buku adalah AKT-26; jangan duplikasi.
  - Test: audit jurnal/panjar bisa difilter berdasarkan ref.

- [ ] **DB-28 — Hapus `tutup_buku.backup_path` & `awal_tahun_buku` dari UI** · P2 · S
  - Hapus field dari tipe/UI/pengaturan; kolom DB boleh tetap sampai migrasi
    berikutnya. Jangan hapus data.
  - Test: pengaturan tetap bisa disimpan; laporan tidak berubah.

- [ ] **DB-29 — Kurangi tab sidebar & rename “Tutup Buku”** · P2 · S
  - Setelah DB-24/25/26/23: rapikan `TABS`/`GRUP_MENU`, hapus tab yang
    disembunyikan, rename “Tutup Buku” menjadi “Kunci Periode” atau beri
    penjelasan bahwa ini penanda + kunci, bukan jurnal penutup.
  - Update test menu + panduan.

- [ ] **DB-30 — STRICT/created_at/unique name + ERD v2** · P2 · M
  - Pertimbangkan tabel `STRICT` untuk tabel baru; tambah `DEFAULT` untuk
    `created_at`; unique `akun.nama` (sudah di DB-11); tulis
    `docs/erd-v2.md` dari skema aktif.
  - Jangan rebuild tabel lama tanpa ticket terpisah.

---

## Fase 4 — Audit ulang & simplifikasi 2026-10-30

### Keputusan yang sudah jelas

| Hal | Keputusan | Dampak |
|---|---|---|
| Status data | **Masih kosong/percobaan** | Drop tabel aman; tidak ada data client yang perlu diexport. |
| Rekonsiliasi bank | **Hapus** | Bukan sumber angka; saldo buku sudah ada di Buku Besar/Neraca Saldo. |
| Import Excel | **Hapus** | Risiko input ganda/salah akun; bukan kebutuhan client. Excel tetap dipakai untuk export/print. |
| Piutang | **Tidak ada** | Hapus alur 1050 dari UI/API/form; akun 1050 tetap di COA untuk kompatibilitas data lama. |
| Master Pihak | **Hapus** | Client memilih “keterangan saja”; hutang usaha memakai 2060 + keterangan, pinjaman LPD memakai modul LPD. |
| Inventaris aset | **Hapus** | Register non-akuntansi; tidak masuk jurnal/Neraca/penyusutan. |
| Anggaran | **Hapus** | Tidak ada pagu tahunan; realisasi P&L tidak perlu modul terpisah. |
| Lampiran | **Hapus** | Client tidak butuh bukti foto/PDF; tabel + folder attachments dibuang. |
| Panjar | **Pertahankan, per nota** | Client masih butuh rincian per nota; kerjakan DB-18/19/20. Field: nomor nota, tanggal nota, toko/penerima, akun beban, nominal, keterangan. |
| Tahun buku | **Januari–Desember, mulai tengah tahun boleh** | Cut-over memakai `tanggal mulai pembukuan` + saldo awal; laba tahun pertama dihitung sejak tanggal mulai. Tahun buku fiskal selain Januari tetap backlog. |
| COA 5 akun | **Tambah semua, tanpa menggantikan akun lama** | Client menyatakan 5060/5061/5062/4060/4006 kategori baru yang berbeda; jangan nonaktifkan akun lama, tetapi beri nama pembeda agar tidak salah pilih. |
| Utang usaha non-LPD | **Form kecil 2060 + keterangan** | Tanpa master pihak: “Beli Kredit” (D Beban / K 2060) dan “Bayar Utang Usaha” (D 2060 / K Kas). Jika client tidak pernah memakainya, form tetap aman dan tidak mengganggu. |
| Jurnal Umum | **Mode lanjutan** | Operator harian tidak melihat; akuntan/pendamping tetap bisa membuka (DB-26). |
| Tujuan aplikasi | **Pembukuan saja** | Fitur non-akuntansi yang tidak diminta client tidak dipertahankan. |
| Tabel/fitur tidak perlu | **Buang** | Migrasi menghapus tabel dengan backup + guard (DB-33). |

### Peta tabel — keep / drop

| Tabel | Status | Alasan |
|---|---|---|
| `akun` | **Keep** | Master COA; semua laporan membacanya. |
| `jurnal` | **Keep** | Kepala jurnal; satu-satunya sumber tanggal/jenis/bukti. |
| `jurnal_baris` | **Keep** | Baris debit/kredit; sumber semua angka. |
| `tutup_buku` | **Keep** | Penanda periode + audit; tidak menyimpan laba. |
| `audit_log` | **Keep** | Jejak append-only; penting untuk override/koreksi. |
| `pengaturan` | **Keep** | PIN, nama entitas, tanggal mulai, pengaturan lain. |
| `rekonsiliasi_bank` | **Drop** | Bukan sumber angka; user memutuskan hapus. |
| `anggaran` | **Drop** | Tidak ada pagu tahunan; realisasi dari Laba Rugi tidak perlu modul terpisah. |
| `aset` | **Drop** | Register non-akuntansi; tidak masuk jurnal/Neraca/penyusutan. |
| `pihak` | **Drop** | Client tidak minta piutang; hanya satu pinjaman LPD; cukup keterangan. |
| `jurnal_pihak` | **Drop** | Metadata subledger; ikut `pihak`. |
| `lampiran_jurnal` | **Drop** | Client tidak butuh bukti foto/PDF; folder attachments ikut dibersihkan. |
| `panjar` | **Keep** | Uang muka operasional masih dipakai; perlu rincian per nota. |
| `panjar_item` | **Keep** | Detail per nota (nomor/tanggal/toko/nominal); bukan duplikat jika divalidasi terhadap jurnal close. |
| `pinjaman` (baru) | **Add** | Header satu pinjaman LPD. |
| `pinjaman_angsuran` (baru) | **Add** | Jadwal rencana pokok/bunga. |
| `pinjaman_bayar` (baru) | **Add** | Link jurnal ↔ angsuran; nominal dari jurnal, bukan duplikat. |

Target akhir: **6 tabel inti + 2 tabel panjar + 3 tabel pinjaman = 11 tabel**
(turun dari 14). `panjar_item` tetap dipakai untuk detail per nota.

### Asumsi yang dipakai (tidak perlu tanya client lagi)

1. **Angsuran** boleh berisi pokok + bunga; nominalnya **diisi user** di form,
   bukan data yang harus dikumpulkan developer.
2. **Kas LPD** dipilih user dari daftar akun kas/bank aktif; tidak di-hardcode.
3. **5063 BEBAN BUNGA PINJAMAN** ditambahkan; `5050` tetap BIAYA LAIN-LAIN.
4. **Sisa pokok/jadwal** diisi user saat memakai wizard pinjaman.
5. **Tahun buku** tetap Januari–Desember; mulai tengah tahun memakai saldo awal
   (DB-38). Jika client ternyata memakai tahun buku fiskal lain, itu tiket
   terpisah.
6. **Bunga** dicatat saat dibayar (cash basis) untuk versi pertama.
7. **Denda** memakai 5050 BIAYA LAIN-LAIN; jika client butuh akun terpisah,
   tiket baru.

### Temuan P0 — jangan mulai data nyata sebelum selesai

1. **Baseline sudah hijau (DB-35).** `docs/panduan-portable.md` dipulihkan;
   test arsip ERD v1 dihapus. `npm test` **736/58 hijau**. Klaim `737/737` di
   dokumen AKT sudah tidak relevan.
2. **DB versi lebih baru tidak ditolak.** `migrasi()` di
   `src/db/database.ts` menjalankan DDL/seed walau `user_version` lebih besar
   dari `SCHEMA_VERSION`. `validasiKandidatRestore` sudah punya guard, tetapi
   `openDb()` belum. Risiko: aplikasi versi lama membuka DB versi baru lalu
   merusak/menimpa aturan. Ini **DB-05** yang masih terbuka.
3. **Backup pra-upgrade bergantung pada nama tabel, bukan versi.**
   `buangTabelLama()` berjalan setiap `openDb()` dan membuang tabel lama
   berdasarkan bentuk. `backupPraUpgrade()` hanya membuat backup bila ada
   tabel `transaksi`/`panjar`/`coa`. Selama `panjar` masih ada, backup jalan;
   setelah `panjar` dihapus, upgrade berikutnya **tidak** akan membuat backup.
   Ganti kondisinya menjadi “setiap kenaikan versi” di **DB-33**.
4. **Drop tabel tanpa rencana restore.** `TABEL_WAJIB_RESTORE` masih memuat
   `aset`; `hapusAkun()` masih mengecek `anggaran`/`panjar_item`/`jurnal_pihak`;
   `auditIntegritas()` masih mengecek `panjar`. Semua harus diperbarui bersamaan
   dengan drop tabel, bukan ditinggal.

### Temuan P1 — akurasi & konsistensi

1. **Audit integritas belum memeriksa reversal.** `auditIntegritas()` memeriksa
   jurnal tidak seimbang, jumlah baris, akun asing, orphan, FK, nomor bukti, dan
   panjar. Ia belum memeriksa: reversal harus cermin persis jurnal asli, satu
   jurnal hanya satu reversal, reversal tidak boleh dibalik lagi, dan `grup_id`
   harus sama. Karena reversal adalah satu-satunya jalur koreksi, ini penting.
2. **Tipe/posisi akun tidak dikunci di DB.** Tabel `akun` tidak punya CHECK;
   laporan mempercayai `akun.tipe`/`posisi_normal`. Input langsung lewat SQL
   bisa membuat laporan salah tanpa terdeteksi. Tambahkan audit/trigger.
3. **Arus kas jurnal campuran.** `arusKas()` memilih satu kelompok berdasarkan
   “ada lawan bertipe …”. Jurnal manual yang mencampur pendapatan + kewajiban +
   kas bisa masuk kelompok yang salah. Form terpandu aman; Jurnal Umum perlu
   dibatasi atau diberi metadata kategori arus kas.
4. **Kunci periode masih longgar.** Tahun yang sudah ditutup masih bisa
   diposting dengan alasan ≥5 karakter. Ini keputusan sadar, tetapi untuk
   akurasi sebaiknya ada aksi “buka periode” yang tercatat, bukan override
   bebas. Perlu keputusan client/akuntan.
5. **Angsuran LPD tidak muat di modul Pihak.** `klasifikasiAlurPihak()`
   mewajibkan tepat 2 baris. Angsuran LPD punya pokok + bunga + denda (3–4
   baris). Karena itu modul LPD terpisah memang perlu; jangan memaksa lewat
   `PihakTab`.
6. **Desain `pinjaman_bayar` berpotensi duplikasi angka.** DB-16b menyimpan
   pokok/bunga/denda di tabel pembayaran sekaligus di jurnal. Jurnal adalah
   sumber kebenaran; simpan link `jurnal_id` + `angsuran_id` saja, lalu hitung
   nominal dari baris jurnal (DB-36).
7. **Panjar belum per nota.** `panjar_item` hanya menyimpan
   `kategori_baga`/nominal/`jurnal_id`; belum ada nomor nota, tanggal nota, atau
   toko. Jika client tetap butuh “rincian per nota”, DB-18/19/20 harus
   diselesaikan. Jika tidak, hapus panjar.
8. **Lampiran dan backup.** `Backup Lengkap` sudah menyalin lampiran, tetapi
   backup `.db` tunggal tidak. Lampiran sudah diputuskan **hapus** (DB-37),
   jadi tabel `lampiran_jurnal` dan folder `attachments` tidak perlu
   dipertahankan. DB-22 (kompresi) dibatalkan.
9. **Inventaris aset bukan akuntansi.** `aset` tidak masuk jurnal, tidak
   disusutkan, dan tidak muncul di Neraca. Jangan menyebutnya “aset” dalam
   laporan keuangan. Jika client hanya butuh daftar fisik, Excel lebih murah;
   jika butuh aset tetap di Neraca, perlu desain akun + penyusutan terpisah.
10. **Anggaran bukan bagian pembukuan.** `anggaran` hanya menyimpan pagu;
    realisasi dihitung dari `labaRugi()`. Tidak memengaruhi Neraca/Laba Rugi.
    Jika client tidak menetapkan pagu tahunan, hapus.

### Temuan P2 — kebersihan

- `jurnal.jenis` dan `grup_id` belum punya constraint DB; validasi hanya di
  aplikasi.
- `akun.nama` belum unik di DB (DB-11).
- `anggaran.created_at`/`updated_at` boleh NULL; tabel baru sebaiknya `STRICT`
  dan `DEFAULT`.
- `tutup_buku.backup_path` menyimpan path yang belum tentu berguna (DB-28).
- Dokumentasi masih menyebut fitur yang akan dihapus (Rekonsiliasi, Anggaran,
  Import, Aset, Piutang). Update bersamaan dengan DB-29/DB-35.

### Urutan pengerjaan yang disarankan

1. **DB-35** — selesai 2026-10-30; baseline `736/58` hijau.
2. **DB-31** — hapus Rekonsiliasi Bank.
3. **DB-23a** — hapus alur piutang.
4. **DB-32** — hapus Inventaris Aset.
5. **DB-24** — hapus Anggaran.
6. **DB-25** — hapus Import Excel.
7. **DB-23b** — hapus master Pihak; sediakan form hutang sederhana/LPD.
8. **DB-37** — hapus modul Lampiran.
9. **DB-33** — migrasi v12: drop tabel final + guard/backup + update restore.
10. **DB-18/19/20/21** — panjar per nota; `panjar_item` dipertahankan sebagai detail nota.
11. **DB-34** — perluas audit integritas.
12. **DB-36** — rapikan desain pembayaran LPD.
13. **DB-16a..DB-16f** — modul LPD setelah parameter pinjaman jelas.
14. **DB-26/DB-29** — Jurnal Umum mode lanjutan + rapikan sidebar.

---

## Fase 4 — Tiket

- [x] **DB-35 — Baseline dokumen/test hijau** · P0 · S
  - **Bukti 2026-10-30:** `docs/panduan-portable.md` dipulihkan dari commit
    `530c8c7`; test arsip `erd-v1-arsip.md` dihapus karena arsip itu memang
    tidak dipakai. `npm run typecheck` bersih; `npm test` **736/58 hijau**.
  - **Catatan:** setelah fitur dihapus (DB-31/32/24/25/23), istilah di
    `docs/panduan-pengguna.md`, `docs/panduan-pemeriksaan.md`, dan README harus
    diperbarui lagi. Itu bagian dari tiket fitur masing-masing.
  - **Dependency:** —

- [x] **DB-31 — Hapus modul Rekonsiliasi Bank (UI/API/test)** · P1 · M
  - **Konteks:** user memutuskan membuang rekonsiliasi bank. Tabel
    `rekonsiliasi_bank` hanya menyimpan saldo rekening koran + status; bukan
    sumber angka. Saldo buku sudah bisa dilihat di Buku Besar/Neraca Saldo.
  - **Langkah:**
    1. Hapus `RekonsiliasiBankTab.tsx`, import/tab/menu/render di `App.tsx`.
    2. Hapus IPC `rekonsiliasi:*`, import, `GAGAL_REKONSILIASI`, tipe/API di
       `api.ts`/preload, dan validator di `main/validation.ts`.
    3. Hapus `core/rekonsiliasi.ts`, `db/rekonsiliasi.ts`, dan
       `tests/rekonsiliasi.test.ts`.
    4. Pertahankan label `REKONSILIASI-*` di `utils/auditDetail.ts` agar audit
       lama tetap terbaca.
    5. Jangan drop tabel di tiket ini; DB-33 yang menghapus.
    6. Update dokumen yang masih menyebut Rekonsiliasi Bank.
  - **DoD:** tidak ada tab/IPC/API; build & test hijau; tidak ada perubahan
    jurnal.
  - **Test:** test menu/UI + `tests/ipc-main.test.ts` bila ada.
  - **Verifikasi:** typecheck + test + build.
  - **Bukti 2026-10-30:** tab/menu/komponen, 4 channel IPC, tipe/API renderer,
    validator, `core/rekonsiliasi.ts`, `db/rekonsiliasi.ts`, dan
    `tests/rekonsiliasi.test.ts` dihapus; label audit `REKONSILIASI-*` tetap.
    Tabel `rekonsiliasi_bank` tidak disentuh (menunggu DB-33).
    `npm run typecheck` bersih; `npm test` **728/58 hijau**; `npm run build`
    berhasil.
  - **Dependency:** — (keputusan 2026-10-30).

- [x] **DB-32 — Hapus modul Inventaris Aset (UI/API/test)** · P1 · M
  - **Konteks:** `aset` adalah register non-akuntansi: tidak masuk jurnal,
    tidak disusutkan, tidak muncul di Neraca. User ingin aplikasi pembukuan
    saja. Menyimpan register terpisah membuat batas akuntansi kabur.
  - **Langkah:**
    1. Hapus tab/menu/render dan `AsetTab.tsx`.
    2. Hapus IPC `aset:*`, `validateAsetInput`, tipe `Aset`, CRUD repository,
       API/preload, dan `tests/aset.test.ts`.
    3. Hapus export/print aset di `workbooks.ts`/`export.ts` dan opsi `ASET`
       di `PengaturanTab`.
    4. Pertahankan label `ASET-*` di audit lama.
    5. Jangan drop tabel di tiket ini; DB-33 yang menghapus.
  - **DoD:** tidak ada tab/IPC/API/export aset; test & build hijau.
  - **Test:** test menu + `tests/audit.test.ts`/`tests/jurnal.test.ts` yang
    menyebut tabel aset disesuaikan.
  - **Verifikasi:** typecheck + test + build.
  - **Bukti 2026-10-30:** tab/menu/render, `AsetTab.tsx`, 4 channel IPC,
    `validateAsetInput`, tipe `Aset`, CRUD repository, API renderer, export XLSX/
    HTML aset, dan `tests/aset.test.ts` dihapus; opsi filter audit `ASET`
    dihapus tetapi label audit lama `ASET-*` tetap. Tabel `aset` dan
    `TABEL_WAJIB_RESTORE` sengaja belum disentuh (menunggu DB-33).
    `npm run typecheck` bersih; `npm test` **729/57 hijau**; `npm run build`
    berhasil.
  - **Dependency:** — (keputusan 2026-10-30).

- [x] **DB-23a — Hapus alur piutang 1050 (UI/API/builder/test)** · P1 · M
  - **Konteks:** client tidak minta pencatatan piutang. Alur piutang menambah
    pilihan di `PihakTab`, builder, subledger, dan laporan. Akun 1050 tetap
    dipertahankan di COA untuk data lama.
  - **Bukti 2026-10-30:** `BERI_PINJAMAN`/`TERIMA_PELUNASAN` dihapus dari
    builder, `PihakTab`, menu, dan IPC; `klasifikasiAlurPihak` hanya menerima
    empat alur hutang dan menolak jurnal 1050. `AKUN_PIUTANG` tetap di COA dan
    tetap terbaca di laporan, Arus Kas (INVESTASI), serta rekonsiliasi sebagai
    “Aset lain lama (1050)”. Seed dev tidak lagi membuat PIUTANG baru.
    `npm run typecheck` bersih; `npm test` **731/58 hijau**; `npm run build`
    berhasil.
  - **Langkah:**
    1. Hapus alur `BERI_PINJAMAN`/`TERIMA_PELUNASAN` dari `PihakTab` dan
       `core/forms.ts`; hapus tipe `PIUTANG` dari form baru.
    2. `klasifikasiAlurPihak` hanya menerima alur hutang (2050/2060).
    3. Hapus istilah “Piutang” dari menu/saldo awal; jika 1050 masih muncul,
       letakkan sebagai “aset lain” tanpa form piutang.
    4. Pertahankan `AKUN_PIUTANG` untuk laporan/arus kas dan data lama.
    5. Update test piutang menjadi test penolakan/penghapusan.
  - **DoD:** tidak ada cara membuat piutang baru dari UI; laporan 1050 lama
    tetap terbaca; test & build hijau.
  - **Test:** `tests/pihak.test.ts` (bagian piutang), `tests/forms-ui.test.ts`.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** — (keputusan 2026-10-30).

- [x] **DB-23b — Hapus master Pihak + `jurnal_pihak`; hutang pakai keterangan/LPD** · P1 · M
  - **Konteks:** user memilih “keterangan saja”; client hanya punya satu
    pinjaman LPD. Master pihak + `jurnal_pihak` menambah tabel, layar, dan
    risiko drift. Pinjaman LPD punya modul sendiri; utang usaha bisa memakai
    form sederhana dengan nama kreditur di `keterangan`.
  - **Langkah:**
    1. Hapus `PihakTab`, IPC `pihak:*`, API/preload, `core/pihak.ts`,
       `db/pihak.ts`, dan test terkait.
    2. Hapus `salinMappingPihak` dari reversal dan referensi `jurnal_pihak`
       di `hapusAkun`.
    3. Sediakan form “Catat Utang Usaha” (D BEBAN / K 2060) dan “Bayar Utang
       Usaha” (D 2060 / K kas) dengan kreditur di keterangan; atau arahkan
       pinjaman ke modul LPD.
    4. Jangan drop tabel di tiket ini; DB-33 yang menghapus.
  - **DoD:** tidak ada master pihak; hutang usaha & LPD bisa dicatat tanpa
    tabel pihak; jurnal 2050/2060 tetap terbaca.
  - **Test:** test form hutang + `tests/reversal.test.ts` (mapping dihapus).
  - **Verifikasi:** typecheck + test + build.
  - **Bukti 2026-10-30:** `PihakTab`, `core/pihak.ts`, `db/pihak.ts`, tab/menu
    `pihak`, 8 channel IPC `pihak:*`, API/tipe renderer, validator pihak, seed
    master pihak, dan `tests/pihak.test.ts` dihapus. `salinMappingPihak` serta
    referensi `jurnal_pihak` di `hapusAkun`/reversal dihapus; tabel `pihak` +
    `jurnal_pihak` **tetap ada** dan data legacy dibiarkan untuk DB-33. Form
    baru **Catat Utang Usaha** (D BEBAN / K 2060) dan **Bayar Utang Usaha**
    (D 2060 / K kas) memakai jenis HUTANG, nama kreditur di keterangan, serta
    tersedia di tab Transaksi dan pintasan Dashboard. Reversal jurnal lama tetap
    berjalan tanpa menyalin pemetaan. Modul LPD (DB-16b+) belum tersedia;
    pinjaman LPD diarahkan ke modul itu dan saldo 2050 lama tetap terbaca.
    `npm run typecheck` bersih; `npm test` **684/55 hijau**; `npm run build`
    berhasil.
  - **Dependency:** DB-16d, DB-23a.

- [x] **DB-24 — Hapus modul Anggaran (UI/API/test)** · P1 · M
  - **Konteks:** anggaran hanya pagu; realisasi dihitung dari `labaRugi()`.
    Tidak memengaruhi Neraca/Laba Rugi. User tidak meminta fitur ini.
  - **Langkah:**
    1. Hapus tab/menu/render dan `RealisasiTab.tsx`.
    2. Hapus IPC `anggaran:*`/`laporan:anggaran`, validator, API/preload,
       `core/anggaran.ts`, `db/anggaran.ts`, `tests/anggaran.test.ts`.
    3. Hapus export/print anggaran dan referensi `anggaran` di `hapusAkun`.
    4. Jangan drop tabel di tiket ini; DB-33 yang menghapus.
  - **DoD:** tidak ada tab/IPC/API/export anggaran; laporan lain tidak berubah;
    test & build hijau.
  - **Test:** test menu + `tests/export-laporan.test.ts`/`tests/print-doc.test.ts`
    bagian anggaran disesuaikan.
  - **Verifikasi:** typecheck + test + build.
  - **Bukti 2026-10-30:** tab/menu/render `RealisasiTab`, `core/anggaran.ts`,
    `db/anggaran.ts`, 3 channel IPC (`anggaran:list`, `anggaran:simpan`,
    `laporan:anggaran`), validator, API renderer, export XLSX/HTML, adapter
    cetak, dan `tests/anggaran.test.ts` dihapus; referensi `anggaran` di
    `hapusAkun` dihapus. Tabel `anggaran` dan DDL-nya sengaja dipertahankan
    (menunggu DB-33); label audit lama `ANGGARAN` tetap agar riwayat terbaca.
    Regression test menu/API/IPC/export/print/dokumen ditambahkan.
    `npm run typecheck` bersih; `npm test` **716/56 hijau**; `npm run build`
    berhasil.
  - **Dependency:** — (keputusan 2026-10-30).

- [x] **DB-25 — Hapus modul Import Excel (UI/API/parser/test)** · P1 · M
  - **Konteks:** user menilai import rawan dan tidak perlu. Import adalah pintu
    input eksternal; menghapusnya mengurangi risiko duplikat/salah akun.
    Excel tetap dipakai untuk export/print.
  - **Langkah:**
    1. Hapus tab/menu/render dan `ImportExcelTab.tsx`.
    2. Hapus IPC `import:*`, `bacaFileImpor`, validator, API/preload, dan
       pesan error import.
    3. Hapus `features/import/*`, `db/impor.ts`, `tests/impor-excel.test.ts`.
    4. Pertahankan `exceljs` untuk export/print.
    5. Jangan mengubah jurnal lama.
  - **DoD:** tidak ada import UI/IPC/parser; export Excel/PDF tetap jalan;
    test & build hijau.
  - **Test:** test menu + export.
  - **Verifikasi:** typecheck + test + build.
  - **Bukti 2026-10-30:** tab/menu/render `ImportExcelTab`, `src/features/import/*`,
    `src/db/impor.ts`, 3 channel IPC (`import:template`, `import:preview`,
    `import:proses`), helper `bacaFileImpor`/`pratinjauFileImpor`, tipe/API
    renderer, dan `tests/impor-excel.test.ts` dihapus. `exceljs` dipertahankan
    untuk export/print; regression test menu/API/IPC/parser/export/dokumen
    ditambahkan. Label audit lama `IMPORT-EXCEL` tetap agar riwayat terbaca.
    `npm run typecheck` bersih; `npm test` **695/55 hijau**; `npm run build`
    berhasil.
  - **Dependency:** DB-02 (konfirmasi tidak ada migrasi data lama).

- [ ] **DB-33 — Migrasi v12: drop tabel yang disetujui + guard/backup** · P0 · M
  - **Konteks:** setelah fitur dihapus, tabelnya menjadi beban. Namun drop
    tabel tanpa backup/guard bisa menghilangkan data. `migrasi()` juga belum
    menolak DB versi lebih baru.
  - **Langkah:**
    1. Di `migrasi()`, tolak `user_version > SCHEMA_VERSION` **sebelum** DDL;
       pesan: “Database dibuat aplikasi versi lebih baru. Perbarui aplikasi.”
    2. Pastikan backup pra-migrasi dibuat untuk setiap kenaikan versi, bukan
       hanya bila tabel `transaksi`/`panjar`/`coa` ada. Uji v11 → v12 dan
       v12 → v13.
    3. Naikkan `SCHEMA_VERSION` satu langkah. Drop tabel final yang sudah
       disetujui: `rekonsiliasi_bank`, `anggaran`, `aset`, `lampiran_jurnal`,
       `jurnal_pihak` lalu `pihak`. Urutan FK: child dulu.
    4. Jangan drop `akun`, `jurnal`, `jurnal_baris`, `tutup_buku`, `audit_log`,
       `pengaturan`, `panjar`, `panjar_item`.
    5. Update `TABEL_WAJIB_RESTORE`, `hapusAkun`, `auditIntegritas`, seed/test
       migrasi, dan semua ekspektasi `SCHEMA_VERSION`.
    6. Jika data nyata ada di tabel yang akan dihapus, export ke CSV/Excel
       dulu dan catat di audit.
  - **DoD:** DB v11 dengan data di tabel lama → terbuka, backup dibuat, tabel
    dihapus, jurnal utuh; DB v12 bisa direstore; DB versi lebih baru ditolak;
    test & build hijau.
  - **Test:** `tests/migrasi-v12.test.ts` (baru) + backup/restore + seed.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-23a, DB-23b, DB-24, DB-25, DB-31, DB-32, DB-37.

- [ ] **DB-34 — Audit integritas: reversal, tipe akun, tabel opsional** · P1 · S
  - **Konteks:** `auditIntegritas()` belum memeriksa pasangan reversal dan
    validitas tipe/posisi akun. Reversal adalah satu-satunya jalur koreksi.
  - **Langkah:**
    1. Periksa setiap `reversal_of`: jurnal asli ada, bukan reversal, hanya
       satu reversal, `grup_id` sama, dan barisnya cermin persis (akun sama,
       debit/kredit tertukar, total sama).
    2. Periksa `jurnal.jenis` termasuk `JENIS_JURNAL`.
    3. Periksa `akun.tipe`/`posisi_normal` valid dan konsisten.
    4. Periksa baris yang mengisi debit dan kredit sekaligus (bila trigger
       hilang).
    5. Sesuaikan pemeriksaan bila ada tabel yang di-drop; `panjar` tetap
       diperiksa.
  - **DoD:** setiap korupsi yang di-seed lewat SQL terdeteksi; DB bersih
    `ok:true`.
  - **Test:** `tests/integritas.test.ts`.
  - **Verifikasi:** typecheck + test.
  - **Dependency:** DB-33.

- [x] **DB-36 — LPD: pembayaran link-only, tanpa duplikasi nominal** · P1 · S
  - **Digabung ke DB-16b (2026-10-30):** desain `pinjaman_bayar` sekarang
    hanya menyimpan `jurnal_id` + `angsuran_id`; nominal dibaca dari jurnal.
    Tidak perlu tiket terpisah.

- [ ] **DB-37 — Hapus modul Lampiran (UI/API/backup/test)** · P1 · M
  - **Konteks:** client tidak butuh bukti foto/PDF. Lampiran menambah tabel,
    folder, kompresi, dan logika backup/restore. Panjar tetap dipakai dan
    ditangani DB-18/19/20.
  - **Langkah:**
    1. Hapus tombol/modal lampiran dari detail jurnal, `core/lampiran.ts`,
       `db/lampiran.ts`, `features/lampiran/lampiran.ts`, IPC `lampiran:*`,
       API/preload, dan `tests/lampiran.test.ts`.
    2. Hapus penyalinan/restore folder `attachments` dari
       `backupLengkap.ts`/`restoreLengkap.ts`; Backup Lengkap cukup berisi
       `pura.db` + manifest. Sesuaikan test backup/restore.
    3. Jangan drop tabel di tiket ini; DB-33 yang menghapus
       `lampiran_jurnal`.
    4. Tandai `docs/lampiran-bukti.md` sebagai tidak berlaku atau hapus.
  - **DoD:** tidak ada UI/IPC lampiran; backup/restore DB tetap jalan;
    typecheck + test + build hijau.
  - **Test:** `tests/backup-restore.test.ts`, test menu/detail jurnal.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** DB-02.

- [ ] **DB-38 — Migrasi tengah tahun: saldo awal + laba periode pertama** · P1 · S
  - **Konteks:** client mungkin pindah dari sistem lama di pertengahan tahun.
    Aplikasi sudah punya `tanggal mulai pembukuan`, tetapi perilaku laba tahun
    pertama (sebagian tahun) harus diuji dan didokumentasikan agar tidak
    dianggap salah.
  - **Keputusan:** tahun buku tetap **Januari–Desember**. Cut-over memakai
    tanggal mulai + saldo awal; laba sebelum cut-over masuk ekuitas awal, bukan
    Laba Rugi tahun berjalan.
  - **Langkah:**
    1. Dokumentasikan alur: tetapkan tanggal cut-over (mis. 2026-07-01), isi
       saldo awal aset/kewajiban per tanggal itu, selisih menjadi 3000 MODAL.
       Jangan memasukkan transaksi P&L sebelum cut-over.
    2. Pastikan `labaTahun(2026)` hanya menghitung 2026-07-01 s/d 2026-12-31;
       `neraca` per 2026-12-31 tetap balance.
    3. `tutupBuku(2026)` boleh dilakukan pada 2027; laba 2026 adalah laba
       parsial. Beri label “tahun pertama (parsial)” di laporan/dokumentasi.
    4. Jangan menambah setting tahun buku fiskal di tiket ini. Jika client
       ternyata memakai tahun buku selain Januari, buat tiket terpisah.
  - **DoD:** cut-over tengah tahun menghasilkan saldo awal benar, laba parsial
    benar, Neraca balance, dan alur terdokumentasi.
  - **Test:** `tests/saldo-awal.test.ts` + test laporan tahun parsial.
  - **Verifikasi:** typecheck + test + build.
  - **Dependency:** —.

---

## Ticket existing yang tumpang tindih

Kerjakan yang sudah ada; jangan membuat implementasi ganda.

| Ticket existing | Hubungan dengan dokumen ini |
|---|---|
| AKT-01/02/03 | Guard saldo awal/tanggal mulai. DB-04 hanya unique index; jangan ulang guard. |
| AKT-09 | Modul audit integritas. DB-12 memperluas cek DB/lampiran; koordinasi. |
| AKT-16 | Larangan jurnal penutup manual P&L → ekuitas. Tidak diduplikasi di sini. |
| AKT-19/20 | Desain utang usaha vs pinjaman. DB-16a..f mengimplementasikan sisi **pinjaman LPD**; koordinasi, jangan buat dua model. |
| AKT-25 | `insertJurnal` jadi internal. Tidak diduplikasi di sini. |
| AKT-26 | Audit append-only + `tutup_buku` tidak bisa dihapus. DB-27 hanya `ref_type/ref_id`. |
| AKT-13 | Anggaran akun nonaktif; moot karena DB-24 menghapus modul Anggaran. |
| AKT-21 | Alasan rekonsiliasi selisih; moot karena DB-31 menghapus Rekonsiliasi Bank. |
| AKT-24 | Anti-duplikat import; moot karena DB-25 menghapus Import Excel. |

---

## Lampiran A — Arti “Pencatatan Hutang”

“Hutang” adalah **kewajiban Pura kepada pihak lain**. Ada beberapa bentuk:

| Kejadian | Jurnal | Penjelasan |
|---|---|---|
| Beli barang/jasa belum dibayar | D Beban (5xxx) / K 2050 Hutang | Beban diakui sekarang; kas belum keluar |
| Terima pinjaman uang | D Kas/Bank / K 2050 Hutang | Kas bertambah; kewajiban bertambah |
| Bayar hutang | D 2050 Hutang / K Kas/Bank | Kewajiban berkurang; kas berkurang |
| Bayar bunga/denda | D Beban bunga / K Kas/Bank | Beban tambahan, bukan pengurang pokok |
| Orang berhutang ke Pura | D 1050 Piutang / K Kas | Ini **piutang**, bukan hutang |

Yang perlu ditanyakan ke client:

1. Hutang kepada siapa? (toko/supplier, bank, pengurus, pemerintah, dll.)
2. Hutang untuk apa? (barang, jasa, pinjaman uang, biaya belum dibayar)
3. Apakah perlu daftar per kreditur dan tanggal jatuh tempo?
4. Apakah perlu cicilan/angsuran dan bunga?
5. Apakah hutang lama sudah tercatat di saldo awal?
6. Apakah yang dimaksud justru piutang (orang berhutang ke Pura)?

Rekomendasi paling sederhana sesuai jawaban “keterangan saja”:

- Tidak perlu master pihak.
- Form “Catat Hutang” dan “Bayar Hutang” memakai 2050 + keterangan bebas.
- Jika perlu daftar per kreditur, tambahkan **satu field teks bebas** `kreditur`
  (bukan tabel master) dan kelompokkan berdasarkan teks yang dinormalisasi.
- Jika perlu jatuh tempo/aging, baru pertimbangkan tabel `hutang` sederhana;
  jangan langsung membangun subledger penuh.

### Kasus khusus: pinjaman LPD

Client hanya punya **satu pinjaman LPD**, tetapi ingin pokok, bunga, angsuran,
dan mutasi bulanan. Ini tidak cocok dengan form “Catat Hutang” dua baris biasa.
Gunakan modul kecil `DB-16a..DB-16f`.

> **Konfirmasi client 2026-10-30:** untuk pelunasan pokok, “kas di LPD berkurang
> di aktiva dan hutang berkurang di pasiva”. Ini persis jurnal **D 2050 Hutang
> Lain-lain / K Kas LPD**. Yang belum jelas: apakah angsuran juga mengandung
> bunga; jika ya, bunga harus dicatat terpisah sebagai beban.

### Arti “sudah masuk Saldo Awal 2050”

`2050` adalah **HUTANG LAIN-LAIN** (kewajiban). Kalau pinjaman LPD sudah
berjalan sebelum aplikasi dipakai, **sisa pokok pinjaman saat ini** harus
masuk sebagai saldo awal **kredit 2050**. Artinya:

- di Neraca tanggal mulai, 2050 sudah menunjukkan hutang LPD;
- aplikasi tidak membuat jurnal “terima pinjaman” baru (kalau dibuat, kas dan
  hutang menjadi dobel);
- jadwal angsuran dimulai dari sisa pokok tersebut.

Kalau 2050 belum diisi di Saldo Awal, hutang LPD tidak terlihat di Neraca dan
laporan pinjaman akan selisih.

### Jurnal pelunasan

Yang client gambarkan—**kas LPD berkurang di aktiva, hutang berkurang di
pasiva**—adalah jurnal pokok:

| Komponen | Jurnal |
|---|---|
| Pokok saja | **D 2050 Hutang LPD / K Kas LPD** |
| Pokok + bunga | **D 2050 (pokok) + D Beban Bunga (bunga) / K Kas LPD** |
| Pokok + bunga + denda | **D 2050 (pokok) + D Beban Bunga + D Beban Denda / K Kas LPD** |

Kalau angsuran LPD berisi pokok + bunga, jangan mencatat seluruh angsuran ke
2050. Kalau dicatat seluruhnya ke 2050, saldo hutang turun terlalu cepat dan
beban bunga tidak muncul di Laba Rugi. Jadi perlu dipisah: pokok mengurangi
2050, bunga masuk beban.

| Kejadian | Jurnal |
|---|---|
| Pencairan pinjaman baru | D Kas/Bank (pokok) / K 2050 Hutang LPD |
| Bayar angsuran bulanan | D 2050 Hutang LPD (pokok) + D Beban Bunga (bunga) / K Kas/Bank |
| Denda keterlambatan | D Beban Denda / K Kas/Bank |
| Pelunasan dipercepat | D 2050 (sisa pokok) + D Beban Bunga (bunga berjalan) / K Kas/Bank |
| Pinjaman sudah berjalan sebelum aplikasi | **Jangan** posting pencairan baru; masukkan sisa pokok ke Saldo Awal 2050, lalu input jadwal sisa |

### Akun bunga

Di CSV client **tidak ada akun bunga**. `5050` adalah **BIAYA LAIN-LAIN**,
bukan akun bunga. Saya menyebut 5050 hanya sebagai fallback sementara; itu
bukan pilihan yang ideal karena bunga pinjaman tercampur biaya lain.

Rekomendasi: tambah akun baru **`5063 BEBAN BUNGA PINJAMAN`** (BEBAN, normal
DEBIT). Dengan begitu bunga LPD terlihat terpisah di Laba Rugi. Kalau client
menolak akun baru, fallback-nya 5050—tetapi laporan Laba Rugi menjadi kurang
rinci.

### Prinsip

- **Jadwal angsuran = rencana** (dari perjanjian LPD), bukan sumber saldo.
- **Jurnal = realisasi**. Outstanding pokok dihitung dari 2050; sisa menurut
  jadwal dihitung dari `sisa_pokok_awal - total pokok dibayar`.
- Jangan simpan saldo berjalan di tabel jadwal. Cukup simpan pokok/bunga
  rencana dan link ke jurnal pembayaran.
- Untuk versi pertama, **input jadwal manual** dari buku LPD. Jangan hitung
  sendiri sebelum metode bunga (flat/efektif/anuitas), pembulatan, dan
  biaya admin jelas.
- Mutasi bulanan yang diinginkan:

  | Bulan | Saldo Awal Pokok | Pokok Dibayar | Bunga Dibayar | Denda | Total Kas Keluar | Saldo Akhir Pokok |
  |---|---|---:|---:|---:|---:|---:|
  | 2026-11 | 10.000.000 | 800.000 | 100.000 | 0 | 900.000 | 9.200.000 |

- Jika bunga diakrualkan tiap bulan (bukan saat bayar), itu keputusan akuntansi
  tersendiri; tanyakan di DB-16a. Jangan campur accrual dan cash basis.

### Pertanyaan klarifikasi untuk client

1. “Tidak memunculkan gedung” maksudnya apa? Apakah maksudnya tidak ada
   komponen bunga/beban, atau pinjaman ini tidak terkait gedung?
2. Angsuran LPD terdiri dari **pokok + bunga**, atau **pokok saja**?
3. Kalau ada bunga, berapa nominal bunga per angsuran?
4. Kas LPD mana yang dipakai untuk membayar: 1010, 1014, 1015, 1016, 1017,
   1018, atau 1036?
5. Bunga dicatat saat dibayar (cash basis) atau diakrualkan tiap bulan?

---

## Lampiran B — Jurnal Umum itu apa?

Jurnal Umum adalah **tampilan mentah debit/kredit**. Setiap transaksi yang
disimpan dari form terpandu tetap menjadi jurnal; Jurnal Umum hanya cara
melihat/mengoreksi bentuk mentahnya. Fungsinya:

- akuntan/pemeriksa melihat baris debit-kredit;
- koreksi transaksi yang tidak cocok dengan form;
- memastikan total debit = kredit.

Operator harian **tidak perlu** membuka Jurnal Umum. Rekomendasi: sembunyikan
di balik “Mode lanjutan” (DB-26), beri penjelasan singkat, dan jangan tampilkan
pilihan jenis dokumen di sana (DB-03).

---

## Lampiran C — Peta akun baru client

`docs/KODE AKUN.xlsx` berisi **48 akun baseline** (sama dengan CSV lama) dan
**belum** memuat lima akun di bawah. Lima akun ini **disetujui 2026-10-30**
sebagai kategori baru yang berbeda dari akun lama.

| Kode | Nama client | Tipe | Catatan |
|---|---|---|---|
| 5060 | Pengeluaran Air, Listrik, Telepon | BEBAN | Nama mirip 5010; beri nama pembeda, jangan nonaktifkan 5010 |
| 5061 | Pengeluaran Artos | BEBAN | Pastikan “artos” bukan istilah generik; jika generik, bedakan dari 5050 |
| 5062 | Pengeluaran Banten Rutin | BEBAN | Bedakan dari 5004 BAGA UPAKARA |
| 4060 | Pendapatan Wewedalan | PENDAPATAN | Bedakan dari 4008 PUNIA / 4041 SESARI |
| 4006 | Pendapatan Parkir BPD | PENDAPATAN | Bedakan dari 4005 PENDAPATAN PARKIR; jika hanya beda bank, gunakan 4005 + 1029 |

**Aturan:** jangan mengaktifkan dua akun untuk hal yang sama. Jika akun lama
diganti, nonaktifkan untuk posting baru, tetapi pertahankan histori (DB-15).

---

## Lampiran D — Keputusan user 2026-10-28

| Pertanyaan | Jawaban user | Dampak ticket |
|---|---|---|
| Piutang/hutang per pihak | “Coba keterangan saja” | DB-23a/DB-23b (hapus piutang + master Pihak); pinjaman LPD pakai modul sendiri |
| **Pinjaman LPD** | Hanya **1 pinjaman**; ingin pokok, bunga, angsuran, mutasi bulanan | DB-16a..DB-16f + DB-36 (jadwal + pembayaran link-only) |
| Status data | **Masih kosong/percobaan** (2026-10-30) | Drop tabel aman; tidak perlu export data client |
| Rincian panjar | **Tetap butuh rincian per nota** (2026-10-30) | DB-18/19/20 (field nota di `panjar_item`, validasi vs jurnal close) |
| Anggaran | **Tidak; hapus** (2026-10-30) | DB-24 hapus modul; DB-33 drop tabel |
| Lampiran | **Tidak; hapus** (2026-10-30) | DB-37 hapus modul; DB-33 drop tabel; DB-22 dibatalkan |
| Jurnal Umum | **Sembunyikan di mode lanjutan** (2026-10-30) | DB-26 |
| Import Excel | **Hapus** (2026-10-30) | DB-25 hapus modul + parser |
| **Rekonsiliasi bank** | **Hapus** (2026-10-30) | DB-31 hapus modul; DB-33 drop tabel |
| **Piutang** | **Client tidak minta; hanya hutang** (2026-10-30) | DB-23a hapus alur piutang; akun 1050 tetap untuk data lama |
| **Master Pihak** | **Hapus** (2026-10-30) | DB-23b hapus tabel + UI; hutang pakai keterangan/LPD |
| **Inventaris aset** | **Hapus** (2026-10-30) | DB-32 hapus modul; DB-33 drop tabel |
| **COA 5 akun** | **Tambah semua** (2026-10-30) | 5060/5061/5062 BEBAN; 4060/4006 PENDAPATAN; beri nama pembeda |
| **Tahun buku** | **Jan–Dec; mulai tengah tahun boleh** (2026-10-30) | DB-38: cut-over + saldo awal; laba tahun pertama parsial |
| **Utang usaha non-LPD** | **Form kecil 2060 + keterangan** (2026-10-30) | DB-23b: Beli Kredit / Bayar Utang Usaha tanpa master pihak |
| **Panjar fields** | **Cukup** (2026-10-30) | DB-18: nomor nota, tanggal nota, toko/penerima, akun beban, nominal, keterangan |
| **Tujuan aplikasi** | **Pembukuan saja; akurat secara akunting** (2026-10-30) | Prioritaskan jurnal, laporan, audit; buang fitur non-akuntansi yang tidak diminta |
