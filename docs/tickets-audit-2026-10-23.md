# Tickets Audit — Perbaikan Bugs & Hardening

> Dibuat **2026-10-23** dari audit kode, test, dan database dev.
> Acuan arah: `docs/arah-akuntansi.md`. Riwayat ticket lama: `docs/tickets-perbaikan.md`.
> Baseline saat audit: `npm test` **427 test hijau**, `npm run typecheck` bersih,
> `npm run build` bersih.
>
> Dokumen ini sengaja memecah temuan menjadi ticket **kecil** supaya bisa
> dikerjakan satu per satu oleh AI agent. **Satu sesi = satu ticket.**
> Jangan mengerjakan beberapa ticket sekaligus dalam satu commit.

---

## Cara pakai (untuk AI agent)

1. Pilih ticket `[ ]` paling atas yang dependency-nya sudah selesai.
2. Baca **Konteks → Langkah → DoD**. Baca juga file yang disebut di Konteks.
3. **Reproduksi bug dulu** (test merah), baru perbaiki. Untuk logika murni,
   tulis test Vitest tanpa Electron.
4. Jangan mengubah data di `data/` atau `data/backups/`. Jangan pernah
   mengedit/menghapus jurnal; koreksi hanya lewat reversal + audit.
5. Ticket yang menyentuh skema wajib:
   - naikkan `SCHEMA_VERSION` di `src/db/database.ts`;
   - buat migrasi idempotent di `migrasi()`;
   - pertahankan backup pra-upgrade.
6. Sebelum centang, wajib hijau:
   ```bash
   npm run typecheck
   npm test
   npm run build          # jika menyentuh main/preload/renderer
   ```
7. Centang dengan bukti di baris ticket:
   `(2026-10-24: hasil singkat + jumlah test)`.
8. Commit terpisah per ticket:
   `fix(AUD-02): gunakan tanggal lokal Asia/Makassar`.
9. Jangan memperluas scope. Kalau menemukan bug lain, buat ticket baru,
   jangan diam-diam dikerjakan di ticket ini.
10. Untuk perubahan UI, lakukan smoke manual singkat dan tulis hasilnya di
    bukti ticket.

### Kondisi awal yang harus diperhatikan

- Working tree saat audit masih punya perubahan **Pembantu** yang belum
  di-commit (`pembantu.ts`, `workbooks.ts`, `PembantuTab.tsx`, `types.ts`,
  `main/index.ts`, dan `tests/pembantu-jurnal.test.ts`).
  Selesaikan **AUD-25** lebih dulu atau stash perubahan itu sebelum ticket lain.
- Repo GitHub saat audit terdeteksi **public**. Ticket **AUD-01** adalah
  tindakan manual pemilik; jangan minta AI agent mengubah visibilitas repo.
- Database dev berisi data dummy; jangan dipakai sebagai bukti produksi.

---

## Ringkasan prioritas

| ID | Prioritas | Ukuran | Judul | Dependency |
|---|---|---|---|---|
| AUD-01 | P0 — MANUAL | M | Amankan repo publik, nomor rekening, dan kode darurat | — |
| AUD-02 | P0 | S | Helper tanggal lokal `Asia/Makassar` + test | — |
| AUD-03 | P0 | M | Ganti tanggal default di core/db/main | AUD-02 |
| AUD-04 | P0 | M | Ganti tanggal default di renderer | AUD-02 |
| AUD-05 | P0 | M | Waktu audit tampil lokal + filter tanggal lokal | AUD-02 |
| AUD-06 | P0 | S | Default tanggal koreksi harus satu periode | AUD-02, AUD-03 |
| AUD-07 | P0 | S | Blokir reversal jurnal yang terhubung ke panjar | — |
| AUD-08 | P0 | S | Hapus 1040/1050/2050 dari form Bayar terpandu | — |
| AUD-09 | P0 | M | Rekonsiliasi pihak vs saldo akun 1050/2050 | — |
| AUD-10 | P0 | S | Peringatan kas minus berdasarkan tanggal jurnal | — |
| AUD-11 | P0 | M | Buat backup lengkap (DB + lampiran) | AUD-15 |
| AUD-12 | P0 | M | Restore backup lengkap (DB + lampiran) | AUD-11, AUD-14 |
| AUD-13 | P0 | S | Backup otomatis periodik + peringatan backup basi | — |
| AUD-14 | P0 | S | Pertahankan PIN saat restore | — |
| AUD-15 | P0 | S | Tulis backup aman (temp + rename) | — |
| AUD-16 | P0 | M | Layar pemulihan saat database gagal dibuka | — |
| AUD-17 | P0 | S | Hardening IPC/CSP: `backup:auto`, sender frame, iframe | — |
| AUD-18 | P0 | M | Auto-lock di main + lock saat suspend + tombol kunci | AUD-02 |
| AUD-19 | P1 | M | Kode darurat per-install (hash, tampil sekali) | AUD-01 |
| AUD-20 | P1 | S | Kunci `awalTahunBuku` ke Januari sampai fiskal didukung | — |
| AUD-21a | P1 | M | Core Neraca Saldo per tahun buku | AUD-20 |
| AUD-21b | P1 | M | UI/export Neraca Saldo per tahun buku | AUD-21a |
| AUD-22 | P1 | S | 3001/3002 tidak boleh diposting | — |
| AUD-23 | P1 | M | Migrasi v9: integritas jurnal + nomor bukti per tahun | — |
| AUD-24 | P1 | S | Seed dev: pihak + mapping 1050/2050 | AUD-09 |
| AUD-25 | P1 | S | Perbaiki arah Pembantu + XLSX numerik (WIP) | — |
| AUD-26 | P1 | S | Hilangkan copy UI yang sudah basi | — |
| AUD-27 | P1 | S | Detail audit human-readable + label aksi baru | AUD-05 |
| AUD-28 | P2 | M | Hapus jalur single-entry di renderer/API/IPC | — |
| AUD-29 | P2 | M | Hapus repository/ledger/laporan legacy + migrasikan test | AUD-28 |
| AUD-30 | P2 | S | Migrasikan test aset/export ke mesin laporan v2 | AUD-29 |
| AUD-31 | P2 | S | Docs, versi, README | — |
| AUD-32 | P2 | S | CI di branch `dev`, npm audit, update dependency | — |
| AUD-33 | P2 | S | Icon aplikasi + konfigurasi signing | — |
| AUD-34 | P2 | M | Error boundary + log file | — |

**Backlog produk (belum jadi ticket detail):** laporan BKU konsolidasi,
pengelompokan sidebar operator/akuntan, saldo awal per pihak, kolom pihak di
Import Excel, tutup buku bulanan, buka kunci tahun, dukungan tahun buku fiskal
penuh, jurnal penutup + snapshot tutup buku, dan code-splitting ExcelJS.

---

## Fase 0 — Aman sebelum memakai data nyata

- [ ] **AUD-01 — Amankan repo publik, nomor rekening, dan kode darurat** · P0 · MANUAL/OWNER
  - **Konteks:** Repo GitHub `hendraptaksu/sistem-aset-desa` terdeteksi public.
    `KODE AKUN.csv` dan `src/db/coa.ts` memuat nomor rekening bank/LPD nyata.
    `src/main/kunci.ts`, `docs/erd-dan-arsitektur.md`, dan `.env.example` memuat
    kode darurat default. Database/backup tidak ter-track (bagus), dan `.env`
    diabaikan (bagus).
  - **Langkah (manual, bukan AI agent):**
    1. Putuskan: repo dibuat **private**, atau tetap public dengan data
       disanitasi.
    2. Kalau tetap public: ganti nomor rekening nyata dengan placeholder di
       `KODE AKUN.csv`/`coa.ts`, dan sediakan mekanisme konfigurasi lokal
       (file di-gitignore) untuk daftar akun produksi.
    3. Hapus kode darurat default dari source, docs, dan `.env.example`.
    4. Periksa riwayat git; jika nomor rekening/kode pernah ter-commit,
       rewrite history dan anggap kode itu sudah bocor.
    5. Ganti kode darurat di semua instalasi nyata.
  - **DoD:**
    - Repo private atau tidak ada nomor rekening/kode darurat nyata di file
      yang ter-track maupun riwayat git.
    - Pemilik mengonfirmasi kode darurat baru sudah diganti.
  - **Verifikasi:**
    ```bash
    # Cari kode darurat default. Jangan mencetak nomor rekening lengkap ke log.
    git grep -nE "PURI-DARURAT" || true
    # Cek file mana saja yang pernah menyentuh data akun; review manual tanpa
    # menyalin isi rekening ke issue/chat.
    git log --all --name-only --pretty=format: -- '*.csv' 'src/db/coa.ts' | sort -u
    ```
  - **Dependency:** —

- [x] **AUD-02 — Helper tanggal lokal `Asia/Makassar` + test** · P0 · S (2026-10-27: helper `tanggalLokal`/`tahunLokal`/`formatWaktuLokal` via `Intl.formatToParts`; typecheck/test/build hijau, 440 test total + 10 test)
  - **Konteks:** `new Date().toISOString().slice(0, 10)` memakai UTC. Di WITA,
    pukul 00:00–07:59 menghasilkan tanggal kemarin. Ini memengaruhi transaksi,
    cut-off, reversal, tutup buku, nama backup, dan audit.
  - **Langkah:**
    1. Buat `src/utils/tanggal.ts` (aman untuk main + renderer, tanpa Node API):
       - `ZONA_WAKTU_APP = 'Asia/Makassar'`
       - `tanggalLokal(now?: Date | number, timeZone = ZONA_WAKTU_APP): string`
         → `YYYY-MM-DD`
       - `tahunLokal(...)`, `formatWaktuLokal(iso, timeZone?)`
         → `YYYY-MM-DD HH:mm` untuk audit.
       - Gunakan `Intl.DateTimeFormat` + `formatToParts`, bukan
         `toISOString().slice(0, 10)`.
    2. Jangan memakai `process.env` di renderer. Zona waktu adalah konstanta
       aplikasi; parameter hanya untuk test.
    3. Buat `tests/tanggal.test.ts`:
       - `2025-12-31T16:30:00Z` → `2026-01-01` (WITA).
       - `2026-01-01T00:30:00+08:00` → `2026-01-01`.
       - `2026-10-23T23:30:00Z` → `2026-10-24`.
       - format waktu audit menampilkan jam lokal, bukan UTC.
  - **DoD:** helper punya test; tidak ada ketergantungan Node/Electron.
  - **Verifikasi:** `npx vitest run tests/tanggal.test.ts` + `npm run typecheck`.
  - **Dependency:** —

- [x] **AUD-03 — Ganti tanggal default di core/db/main** · P0 · M (2026-10-27: `tanggalLokal`/`tahunLokal` dipakai di jurnalForm, reversal, tutup, pengaturan, ipc, auto-backup, printDoc, dan validasi aset; typecheck/test/build hijau, 442 test total + 2 test)
  - **Konteks:** Setelah AUD-02, semua tanggal bisnis di proses non-renderer
    harus memakai helper.
  - **Langkah:**
    1. Ganti di:
       - `src/core/jurnalForm.ts` (`hariIni`)
       - `src/db/reversal.ts` (`hariIni`)
       - `src/db/tutup.ts` (`hariIni`)
       - `src/core/pengaturan.ts` (`tanggalMulaiEfektif` default)
       - `src/main/ipc.ts` (`tanggalSekarang`)
       - `src/features/export/export.ts` (stamp `autoBackupHarian`)
    2. `created_at`/timestamp tetap ISO UTC; jangan diubah.
    3. Tambah/ubah test:
       - `tests/tutup.test.ts`: `sekarang` yang dipakai default mengikuti WITA
         (bisa lewat helper murni).
       - `tests/backup-auto.test.ts`: stamp default memakai tanggal lokal.
    4. Cari sisa pola:
       ```bash
       rg "toISOString\(\)\.slice\(0, ?10\)" src
       ```
       Pastikan yang tersisa hanya untuk timestamp, bukan tanggal bisnis.
  - **DoD:** grep bersih untuk tanggal bisnis; test lama tetap hijau.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** AUD-02.

- [x] **AUD-04 — Ganti tanggal default di renderer** · P0 · M (2026-10-27: `tanggalLokal`/`tahunLokal` dipakai di 14 komponen renderer; helper `tanggalHariIni` RekonsiliasiBank dihapus; grep `toISOString().slice` renderer kosong; typecheck/test/build hijau, 442 test total + 0 test baru karena helper sudah teruji di `tests/tanggal.test.ts`)
  - **Konteks:** Semua form dan tab memakai `today()` UTC.
  - **Langkah:**
    1. Ganti `today()`/`new Date().toISOString().slice(0, 10)` di:
       - `TransaksiForm.tsx`, `SaldoAwalWizard.tsx`, `JurnalUmumEditor.tsx`
       - `JurnalTab.tsx`, `PihakTab.tsx`, `PanjarTab.tsx`
       - `DashboardTab.tsx`, `NeracaTab.tsx`, `NeracaSaldoTab.tsx`
       - `BkuTab.tsx` (kalau belum dihapus oleh AUD-28)
    2. `TutupTab.tsx` dan `RealisasiTab.tsx` memakai `new Date().getFullYear()`;
       ganti dengan `tahunLokal()`.
    3. `RekonsiliasiBankTab.tsx` punya helper tanggal lokal sendiri; ganti
       dengan helper bersama.
    4. `formatTanggal()` tetap boleh dipakai untuk menampilkan `YYYY-MM-DD`.
  - **DoD:** semua default tanggal form/tab konsisten WITA; build hijau.
  - **Verifikasi:** `rg "toISOString\(\)\.slice\(0, ?10\)" src/renderer` →
    tidak ada; `npm run typecheck && npm test && npm run build`.
  - **Dependency:** AUD-02.

- [x] **AUD-05 — Waktu audit tampil lokal + filter tanggal lokal** · P0 · M (2026-10-27: `formatWaktuAudit` memakai `formatWaktuLokal`; `auditWhere` memakai batas UTC dari helper `awalHariLokalUtc`/`akhirHariLokalUtc` sehingga filter `YYYY-MM-DD` adalah hari WITA; audit `2026-10-22T23:30Z` tampil `2026-10-23 07:30`, masuk filter `2026-10-23`, tidak masuk `2026-10-22`; typecheck/test/build hijau, 448 test total + 6 test)
  - **Konteks:** `formatWaktuAudit()` hanya memotong string UTC, jadi audit
    pukul 06:30 WITA tampil 22:30 hari sebelumnya. Filter audit memakai
    `substr(tanggal, 1, 10)` sehingga mengelompokkan berdasarkan tanggal UTC.
  - **Langkah:**
    1. `src/utils/auditDetail.ts`: `formatWaktuAudit` memakai
       `formatWaktuLokal` dari AUD-02.
    2. Filter audit: ubah `mulai`/`sampai` lokal menjadi rentang UTC:
       - `mulai` lokal 00:00 WITA → UTC batas bawah.
       - `sampai` lokal 23:59:59.999 WITA → UTC batas atas eksklusif.
       Implementasi boleh di `src/db/repository.ts` (`auditWhere`) atau di
       `main/ipc.ts` sebelum memanggil repository.
    3. Test:
       - audit `2026-10-22T23:30:00Z` tampil `2026-10-23 07:30`;
       - filter `2026-10-23` memuat audit tersebut;
       - filter `2026-10-22` tidak memuatnya.
  - **DoD:** tampilan dan filter audit konsisten dengan tanggal lokal.
  - **Verifikasi:** test baru + `npm test`.
  - **Dependency:** AUD-02.

- [x] **AUD-06 — Default tanggal koreksi harus satu periode** · P0 · S (2026-10-27: `KoreksiModal` memakai tanggal jurnal asli sebagai default `tanggalBalik`; catatan periode terkunci dan peringatan kuning bila tanggal balik/pengganti beda tahun; regression test laba tahunan satu periode + skenario lama; typecheck/test/build hijau, 450 test total + 2 test)
  - **Konteks:** `KoreksiModal` memakai `tanggalBalik = today()` (UTC) tetapi
    tanggal pengganti = tanggal jurnal asli. Koreksi jurnal 2025 pada 2026
    membuat 2025 naik X dan 2026 turun X; total ekuitas benar, tetapi laba
    tahunan salah.
  - **Langkah:**
    1. Di `src/renderer/components/JurnalTab.tsx`, ubah default
       `tanggalBalik` menjadi **tanggal jurnal asli** (bukan hari ini).
    2. Tambah catatan UI: “Jurnal balik mengikuti tanggal asli. Jika periode
       terkunci, isi alasan minimal 5 karakter.”
    3. Jika operator mengubah salah satu tanggal sehingga balik dan pengganti
       berada di tahun berbeda, tampilkan peringatan kuning yang menjelaskan
       dampaknya ke Laba Rugi tahunan.
    4. Tambah regression test di `tests/reversal.test.ts`:
       - jurnal 2025 Rp 100; koreksi menjadi Rp 120 dengan kedua tanggal 2025;
       - `labaTahun(2025)` = Rp 120; `labaTahun(2026)` = 0;
       - Neraca Saldo tetap nol.
    5. Tambah test untuk skenario lama (balik 2026, pengganti 2025) sebagai
       dokumentasi mengapa default diubah.
  - **DoD:** default aman; ada test tahunan; UI memperingatkan lintas tahun.
  - **Verifikasi:** `npx vitest run tests/reversal.test.ts` + `npm run build`.
  - **Dependency:** AUD-02, AUD-03.

- [x] **AUD-07 — Blokir reversal jurnal yang terhubung ke panjar** · P0 · S (2026-10-27: `src/db/reversal.ts` mengecek `panjar.jurnal_open_id`/`jurnal_close_id` sebelum rencana; `reverseJurnal` dan `koreksiDanIsiUlang` menolak dengan pesan “Gunakan modul Panjar”, panduan pengguna/pemeriksaan diperbarui dan “Batalkan panjar” tetap backlog; typecheck/test/build hijau, 454 test total + 4 test)
  - **Konteks:** `panjar` menyimpan `jurnal_open_id`/`jurnal_close_id` dan
    `status`. `reverseJurnal` tidak tahu hubungan itu. Sudah direproduksi:
    close panjar → reverse → status tetap CLOSED, `1040` kembali bersaldo,
    dan panjar tidak bisa ditutup lagi. Reverse jurnal open juga bisa membuat
    `1040` negatif saat close berikutnya.
  - **Langkah:**
    1. Di `src/db/reversal.ts`, sebelum membuat rencana reversal, cek:
       ```sql
       SELECT 1 FROM panjar
       WHERE jurnal_open_id = ? OR jurnal_close_id = ?
       LIMIT 1
       ```
    2. Jika ada, kembalikan error jelas:
       “Jurnal ini terhubung ke dokumen panjar. Reversal dari Jurnal Umum
       diblokir agar status panjar tidak basi. Gunakan modul Panjar.”
    3. Terapkan pada `reverseJurnal` **dan** `koreksiDanIsiUlang`.
    4. Tambah test di `tests/reversal.test.ts`:
       - reverse jurnal open panjar ditolak;
       - reverse jurnal close panjar ditolak;
       - jurnal biasa tetap bisa direverse.
    5. Update `docs/panduan-pengguna.md`/`panduan-pemeriksaan.md` bahwa
       koreksi panjar belum lewat Jurnal Umum. Catat “Batalkan panjar” sebagai
       backlog (jangan dikerjakan di ticket ini).
  - **DoD:** tidak ada jalur reversal yang membuat metadata panjar basi.
  - **Verifikasi:** test baru + `npm test`.
  - **Dependency:** —

- [x] **AUD-08 — Hapus 1040/1050/2050 dari form Bayar terpandu** · P0 · S (2026-10-27: form Bayar hanya menampilkan grup akun BEBAN dan menampilkan arahan Buku Panjar/Piutang & Hutang; `buatJurnalBayar` menolak 1040/1050/2050 (juga non-BEBAN) dengan pesan jelas tanpa mengubah Jurnal Umum; panduan 2.2/2.5 diperbarui; typecheck/test/build hijau, 455 test total (+2 test baru, 1 test lama diganti))
  - **Konteks:** Form Bayar menawarkan “Aset lain (panjar/piutang)” dan semua
    kewajiban. Akibatnya user bisa memposting 1040 tanpa dokumen panjar, atau
    1050/2050 tanpa pihak. Ini bertentangan dengan dokumen yang mengatakan
    pihak wajib untuk piutang/hutang.
  - **Langkah:**
    1. Di `src/renderer/components/TransaksiForm.tsx`, grup lawan untuk BAYAR
       hanya berisi akun `BEBAN`.
    2. Hapus `1040`, `1050`, dan `2050` dari pilihan; tambahkan teks:
       “Untuk panjar gunakan menu Buku Panjar; untuk piutang/hutang gunakan
       menu Piutang & Hutang.”
    3. Perkuat `src/core/forms.ts` `buatJurnalBayar`: tolak lawan
       `AKUN_PANJAR`/`AKUN_PIUTANG`/`AKUN_HUTANG` untuk form terpandu ini.
       Jurnal Umum tetap boleh memakai akun tersebut (jalur akuntan).
    4. Update `docs/panduan-pengguna.md` bagian 2.2 dan 2.5.
    5. Test di `tests/forms-ui.test.ts`: builder Bayar menolak ketiga akun.
  - **DoD:** guided Bayar tidak bisa membuat 1040/1050/2050; dokumen selaras.
  - **Verifikasi:** test baru + `npm run build`.
  - **Dependency:** —

- [x] **AUD-09 — Rekonsiliasi pihak vs saldo akun 1050/2050** · P0 · M (2026-10-27: `rekonsiliasiPihak` menghitung saldo 1050/2050 dari jurnal + mapping dengan tanda posisi normal, `belum = saldo akun − teralokasi` (tidak disimpan); IPC `pihak:rekon` dengan cutoff tervalidasi; kartu amber “Rekonsiliasi 1050/2050” + daftar jurnal belum di PihakTab; Jurnal Umum/Import memberi peringatan/konfirmasi “belum teralokasi” tanpa error keras; typecheck/test/build hijau, 463 test total + 8 test, smoke render kartu hijau)
  - **Konteks:** `jurnal_pihak` hanya ditulis form Piutang/Hutang. Jurnal Umum,
    import, saldo awal, dan seed bisa membuat saldo 1050/2050 tanpa mapping.
    Di DB dev: saldo 1050 dan 2050 sama-sama bukan nol, `pihak` = 0,
    `jurnal_pihak` = 0. Tab Piutang & Hutang tampak kosong.
  - **Langkah:**
    1. Tambah fungsi murni di `src/core/pihak.ts`:
       ```ts
       export type RekonsiliasiPihak = {
         piutangAkun: number;   // saldo 1050 dari jurnal
         hutangAkun: number;    // saldo 2050 dari jurnal
         piutangTeralokasi: number;
         hutangTeralokasi: number;
         piutangBelum: number;
         hutangBelum: number;
         jurnalBelum: { jurnal_id, tanggal, no_bukti, keterangan, akun_kode, nominal }[];
       };
       export function rekonsiliasiPihak(baris, mapping, sampai?): RekonsiliasiPihak
       ```
       `belum` = saldo akun − total mapping. Jangan simpan angka ini.
    2. Adapter `src/db/pihak.ts` + IPC `pihak:rekon` (opsional cutoff,
       validasi tanggal kalender).
    3. UI `PihakTab`: kartu “Rekonsiliasi 1050/2050” dengan angka akun,
       teralokasi, belum teralokasi; jika belum ≠ 0 tampilkan badge amber dan
       daftar jurnal belum teralokasi.
    4. Jurnal Umum/Import: jika sebuah jurnal menyentuh 1050/2050 tanpa
       mapping pihak, tampilkan peringatan/konfirmasi sebelum simpan:
       “Jurnal ini akan tampil sebagai belum teralokasi di Piutang & Hutang.”
       Jangan blokir akuntan, tetapi jangan biarkan drift tanpa peringatan.
       Peringatan ini boleh berupa `peringatan`/`perluKonfirmasi` di jalur
       posting, bukan error keras.
    5. Test:
       - mapped + unmapped;
       - reversal mapped;
       - saldo awal 1050 tanpa mapping;
       - total teralokasi + belum = saldo akun;
       - posting 1050 tanpa pihak menghasilkan peringatan.
  - **DoD:** selisih tidak bisa lagi “hilang diam-diam”.
  - **Verifikasi:** test baru + `npm run build`.
  - **Dependency:** —

- [x] **AUD-10 — Peringatan kas minus berdasarkan tanggal jurnal** · P0 · S (2026-10-27: `buatKonteksPosting` menghitung saldo kas per akun dengan cutoff `j.tanggal <= header.tanggal`; `koreksiDanIsiUlang` memakai konteks tanggal balik dan tanggal pengganti secara terpisah, termasuk pengaruh balik bila tanggalnya lebih dulu; test backdate Rp 1.000/Feb → pengeluaran 15 Jan Rp 200, transaksi maju normal, saldo per akun kas, serta koreksi lintas tanggal; typecheck/test/build hijau, 468 test total + 5 test)
  - **Konteks:** `buatKonteksPosting` menjumlahkan **seluruh** riwayat kas,
    bukan saldo pada tanggal jurnal. Contoh yang sudah direproduksi:
    kas Jan 0, kas Feb Rp 1.000, posting pengeluaran backdate 15 Jan Rp 200 →
    tidak ada peringatan, padahal 15 Jan kas menjadi minus.
  - **Langkah:**
    1. Ubah `buatKonteksPosting(db, header)` agar saldo kas dihitung dari
       baris jurnal dengan `j.tanggal <= header.tanggal`.
       ```sql
       SELECT b.akun_kode, COALESCE(SUM(b.debit - b.kredit), 0)
       FROM jurnal_baris b JOIN jurnal j ON j.id = b.jurnal_id
       WHERE j.tanggal <= ?
       GROUP BY b.akun_kode
       ```
    2. Pastikan `koreksiDanIsiUlang` membuat konteks terpisah untuk tanggal
       reversal dan tanggal pengganti. Jangan memakai satu `ctx` untuk dua
       tanggal berbeda.
    3. Test:
       - skenario backdate di atas sekarang memberi peringatan;
       - transaksi maju normal tetap sama;
       - koreksi lintas tanggal tidak memakai saldo tanggal yang salah.
  - **DoD:** peringatan mencerminkan saldo pada tanggal jurnal.
  - **Verifikasi:** `npx vitest run tests/posting.test.ts tests/reversal.test.ts`.
  - **Dependency:** —

- [x] **AUD-11 — Buat backup lengkap (DB + lampiran)** · P0 · M (2026-10-27: modul main-only `buatBackupLengkap` menulis `pura.db` via `backupVacuumInto` (bukan copy WAL), menyalin isi `attachments/` (termasuk subfolder/kosong), dan `manifest.json` berisi `versiApp`, `schemaVersion`, `dibuat`, `jumlahLampiran`, `ukuranDb`, `daftarFile`; IPC `backup:lengkap` memilih folder induk, membuat subfolder `pura-backup-YYYY-MM-DD-HHmm` (stamp WITA), dan audit `BACKUP-LENGKAP`; tombol “Backup Lengkap (DB + lampiran)” + penjelasan di Dashboard; typecheck/test/build hijau, 475 test total + 4 test; smoke UI Electron: klik tombol membuat folder `pura-backup-2026-10-27-0954` dengan 2 lampiran dan manifest valid)
  - **Konteks:** Backup saat ini hanya `.db`; semua foto/PDF di `attachments`
    tidak ikut. Docs sudah memberi tahu, tetapi user awam tetap akan
    menganggap “Backup” = semua data.
  - **Langkah:**
    1. Tambah modul `src/features/export/backupLengkap.ts` (main-only):
       - `buatBackupLengkap({ db, dbPath, attachmentsDir, destDir, stamp })`
       - isi folder: `pura.db` via `backupVacuumInto`, `attachments/`, dan
         `manifest.json` (`versiApp`, `schemaVersion`, `dibuat`, `jumlahLampiran`,
         `ukuranDb`, `daftarFile`).
       - Jangan memakai `copyFileSync` untuk DB; tetap `VACUUM INTO`.
    2. IPC `backup:lengkap`:
       - `showOpenDialog({ properties: ['openDirectory','createDirectory'] })`
         untuk memilih folder induk;
       - buat subfolder `pura-backup-YYYY-MM-DD-HHmm/`;
       - tulis audit `BACKUP-LENGKAP`.
    3. UI Dashboard: tombol **Backup Lengkap (DB + lampiran)** di samping
       backup `.db`, dengan penjelasan singkat.
    4. Test dengan folder sementara:
       - DB + 2 lampiran tersalin;
       - manifest valid;
       - DB hasil backup bisa dibuka dan berisi jurnal terbaru (WAL).
  - **DoD:** satu tombol menghasilkan satu folder backup yang lengkap.
  - **Verifikasi:** test baru + `npm run typecheck && npm run build`.
  - **Dependency:** AUD-15.

- [x] **AUD-12 — Restore backup lengkap (DB + lampiran)** · P0 · M (2026-10-27: modul main-only `restoreLengkap` memvalidasi `manifest.json`/`pura.db`/folder `attachments` + `validasiKandidatRestore`, mencadangkan DB aktif ke `pre-restore-<stamp>.db` via VACUUM INTO, me-rename folder lampiran lama ke `attachments-pre-restore-<stamp>/`, menukar DB (PIN aktif tetap dipertahankan, AUD-14), lalu menyalin lampiran backup + memverifikasi daftar file terhadap manifest; bila gagal, DB dan lampiran lama dikembalikan. IPC `backup:restore-lengkap` + audit `RESTORE-LENGKAP` (`sumber`, `pre_restore_db`, `pre_restore_attachments`) serta tombol “Restore Lengkap (DB + lampiran)” + modal konfirmasi di Dashboard; typecheck/test/build hijau, 482 test total + 5 test; smoke UI build renderer (mock IPC): tombol membuka modal, konfirmasi menampilkan “Restore lengkap OK (2 lampiran)” dan data dimuat ulang)
  - **Konteks:** Restore saat ini hanya DB. Setelah AUD-11, restore harus
    bisa memulihkan folder lengkap.
  - **Langkah:**
    1. IPC `backup:restore-lengkap`:
       - pilih folder backup;
       - validasi `manifest.json`, `pura.db`, dan folder `attachments`;
       - validasi kandidat DB dengan `validasiKandidatRestore`;
       - backup DB aktif ke `pre-restore-...`;
       - backup folder `attachments` aktif ke
         `attachments-pre-restore-<stamp>/` (rename, bukan hapus);
       - tutup DB, tukar DB, salin attachments baru, buka ulang;
       - jika gagal, pulihkan DB **dan** attachments lama.
    2. Jangan menimpa folder attachments lama sebelum backup berhasil.
    3. Audit `RESTORE-LENGKAP` mencatat sumber, pre-restore DB, dan
       pre-restore attachments.
    4. Test:
       - restore sukses;
       - manifest rusak ditolak;
       - DB valid tetapi attachments hilang ditolak;
       - kegagalan di tengah mengembalikan DB + attachments lama.
  - **DoD:** restore lengkap atomik; tidak ada lampiran yatim.
  - **Verifikasi:** test baru + `npm run build`.
  - **Dependency:** AUD-11, AUD-14.

- [x] **AUD-13 — Backup otomatis periodik + peringatan backup basi** · P0 · S (2026-10-27: penjadwal 30 menit di main memanggil `autoBackupHarian` hanya saat tanggal lokal berbeda dari backup terakhir, guard boolean anti-tumpang-tindih, timer `unref` + dibersihkan saat `before-quit`/`will-quit`; helper `usiaBackupHari`/`tanggalDariPathBackup` + banner amber “Backup terakhir … hari lalu — buat backup sekarang.” untuk usia > 2 hari dan aman bila data backup tidak tersedia; typecheck/test/build hijau, 491 test total + 9 test, smoke render banner amber 3 hari tampil dan 2 hari tidak tampil)
  - **Konteks:** `autoBackupHarian` hanya dipanggil saat app dibuka. Kalau
    laptop tidak pernah ditutup, backup bisa berhenti berhari-hari.
  - **Langkah:**
    1. Di `src/main/index.ts`, setelah app siap, pasang interval ringan
       (mis. tiap 30 menit) yang memanggil `autoBackupHarian` bila
       `tanggalLokal()` berbeda dari backup terakhir. Jangan jalankan
       bersamaan (guard boolean).
    2. Tambah helper murni `usiaBackupHari(tanggalBackup, sekarang)` untuk
       dashboard.
    3. Dashboard: jika backup terakhir > 2 hari, tampilkan banner amber
       “Backup terakhir … hari lalu — buat backup sekarang.”
    4. Test helper dan pastikan backup idempoten per hari.
  - **DoD:** app yang dibiarkan terbuka tetap membuat backup harian.
  - **Verifikasi:** test baru + `npm run build`.
  - **Dependency:** AUD-02, AUD-04.

- [x] **AUD-14 — Pertahankan PIN saat restore** · P0 · S (2026-10-27: `restoreDbAman` membaca `pin_salt`/`pin_hash` DB aktif sebelum tukar file, menulisnya kembali ke DB hasil restore dalam satu transaksi + audit `RESTORE-PIN-DIPERTAHANKAN` tanpa salt/hash/PIN, backup tanpa PIN tetap memakai PIN aktif; IPC `backup:import` memanggil `kunciLagi()` setelah restore sukses; typecheck/test/build hijau, 477 test total + 2 test)
  - **Konteks:** Backup berisi tabel `pengaturan` termasuk hash PIN. Restore
    mengembalikan PIN lama; jika PIN sudah diganti, PIN saat ini tidak berlaku
    setelah restart. Session juga tetap terbuka setelah restore.
  - **Langkah:**
    1. Sebelum `restoreDbAman`, baca `pin_salt`/`pin_hash` dari DB aktif.
    2. Setelah DB baru dibuka, tulis kembali PIN tersebut secara atomik dan
       audit `RESTORE-PIN-DIPERTAHANKAN`.
    3. Jika DB backup tidak punya PIN, tetap pasang PIN aktif.
    4. Setelah restore sukses, panggil `kunciLagi()` agar user membuka dengan
       PIN yang sekarang (opsional tetapi disarankan).
    5. Test di `tests/backup-restore.test.ts`:
       - DB A PIN 111111, DB B PIN 222222;
       - restore B ke A;
       - PIN 111111 masih membuka; PIN 222222 ditolak.
  - **DoD:** restore tidak mengunci user dengan PIN lama.
  - **Verifikasi:** test baru + `npm test`.
  - **Dependency:** —

- [x] **AUD-15 — Tulis backup aman (temp + rename)** · P0 · S (2026-10-27: `backupVacuumInto` menulis ke `<dest>.tmp-<pid>-<timestamp>`, memindahkan tujuan lama ke `<dest>.bak-<pid>`, lalu rename tmp → dest; VACUUM gagal membersihkan tmp, rename gagal mengembalikan `.bak` dan mempertahankan tmp untuk diagnosis, sidecar `-wal`/`-shm` lama dibersihkan; typecheck/test/build hijau, 471 test total + 3 test)
  - **Konteks:** `backupVacuumInto` menghapus tujuan lebih dulu. Jika VACUUM
    gagal (disk penuh), backup lama di path yang sama ikut hilang.
  - **Langkah:**
    1. VACUUM INTO file sementara di folder tujuan:
       `<dest>.tmp-<pid>-<timestamp>`.
    2. Setelah tmp valid, pindahkan `<dest>` lama ke `<dest>.bak-<pid>`
       (jangan langsung hapus).
    3. `renameSync(tmp, dest)`; jika sukses, hapus `.bak` dan sidecar
       `-wal`/`-shm` lama.
    4. Jika rename gagal, kembalikan `.bak` menjadi `<dest>` dan pertahankan
       file tmp untuk diagnosis; laporkan error.
    5. Pastikan file tmp dibersihkan saat gagal.
    6. Test:
       - backup baru valid;
       - file lama tidak hilang jika VACUUM gagal (simulasi path invalid);
       - file lama tidak hilang jika rename gagal;
       - sidecar `-wal`/`-shm` tidak tertinggal.
  - **DoD:** tidak ada data loss pada backup yang sudah ada.
  - **Verifikasi:** `npx vitest run tests/backup-auto.test.ts tests/backup-restore.test.ts`.
  - **Dependency:** —

- [x] **AUD-16 — Layar pemulihan saat database gagal dibuka** · P0 · M (2026-10-27: `bukaDbDenganPemulihan` membungkus `openDb` + backup pra-upgrade; saat gagal, `dialog.showMessageBox` “Pemulihan Database” menampilkan pesan ramah + path DB tanpa stack/SQL dengan tombol **Buka folder backup**, **Coba lagi**, **Keluar**. Retry hanya berjalan setelah pengguna memilih (tidak ada loop otomatis), folder backup dibuka via `shell.openPath(backupsDir)`, dan Keluar menghentikan app. Helper murni `pesanGagalBukaDb` memetakan kode error menjadi petunjuk aman + 8 test (termasuk bukti retry memanggil `openDb` ulang dan Keluar tanpa retry); typecheck/test/build hijau, 499 test total + 8 test; smoke Electron: `PURA_DB` diarahkan ke file teks bukan SQLite (userData terpisah agar tidak bentrok instance aktif), dialog muncul dengan path DB + 3 tombol tanpa stack/SQL, lalu DB diganti valid dan klik **Coba lagi** membuka window utama tanpa blank + log `[backup-auto]`)
  - **Konteks:** `main/index.ts` memanggil `db = openDb(pathDb)` tanpa
    try/catch. Jika DB korup, path tidak bisa ditulis, atau disk penuh,
    aplikasi tidak menampilkan window; UI restore tidak bisa diakses.
  - **Langkah:**
    1. Bungkus `openDb` + backup pra-upgrade dalam try/catch.
    2. Jika gagal, tampilkan `dialog.showMessageBox` (atau window minimal)
       dengan:
       - pesan ramah + path DB;
       - tombol **Buka folder backup** (`shell.openPath(backupsDir)`);
       - tombol **Coba lagi**;
       - tombol **Keluar**.
    3. Jangan menampilkan stack trace/SQL mentah.
    4. Tambah helper murni `pesanGagalBukaDb(error, lokasi)` + test pesan.
    5. Smoke manual: arahkan `PURA_DB` ke file bukan SQLite, pastikan dialog
       muncul dan app tidak blank.
  - **DoD:** kegagalan DB tidak membuat app tanpa UI.
  - **Verifikasi:** test helper + smoke manual + `npm run build`.
  - **Dependency:** —

- [x] **AUD-17 — Hardening IPC/CSP: `backup:auto`, sender frame, iframe** · P0 · S (2026-10-27: `backup:auto` menormalkan tahun ke integer 1900..9999 sebelum `join` sehingga `../../x`/`NaN`/`0`/desimal ditolak tanpa membuat path; CSP produksi `connect-src 'self'` dan `ws:`/`wss:` hanya ada di CSP dev HMR; wrapper `registerIpc` memvalidasi `event.senderFrame.url` lewat helper murni `pengirimDiizinkan` (renderer `file:`/dev origin, frame asing & null ditolak); iframe pratinjau cetak/html memakai `sandbox="allow-same-origin allow-modals"` (script/form/popup tetap mati); typecheck/test/build hijau, 503 test total + 4 test; smoke Electron: parent bisa mengakses `contentWindow` dan memanggil `print()`, frame tanpa `allow-modals` ditolak Chromium dengan log “Ignored call to 'print()'…” sehingga izin terbukti minimal)
  - **Konteks:** `backup:auto` menerima `tahun` dari renderer dan langsung
    memasukkannya ke path (`pura-${tahun}.db`). Nilai seperti `../../x` bisa
    keluar folder. CSP produksi juga masih mengizinkan `ws:`/`wss:`.
  - **Langkah:**
    1. Di `src/main/ipc.ts` handler `backup:auto`, validasi:
       ```ts
       const n = Number(tahun);
       if (!Number.isInteger(n) || n < 1900 || n > 9999) return fail(...);
       const dest = join(dir, `pura-${n}.db`);
       ```
       Jangan memakai string mentah.
    2. Di `src/renderer/lib/csp.ts`:
       - produksi: `connect-src 'self'` saja;
       - dev: tambahkan `ws: wss:`.
    3. Tambah validasi pengirim IPC: di wrapper `deps.handle`/`registerIpc`,
       pastikan `event.senderFrame.url` berasal dari renderer aplikasi
       (`file:` renderer atau dev origin). Tolak frame asing.
    4. Tambah `sandbox` pada iframe pratinjau cetak/html
       (`PratinjauCetakModal`, `PratinjauHtmlModal`) dengan izin minimal yang
       masih membolehkan `print()`; smoke print setelah perubahan.
    5. Test:
       - `backup:auto` dengan `../../x`, `NaN`, `0`, `2026.5` ditolak;
       - `CSP_PRODUKSI` tidak mengandung `ws:`/`wss:`;
       - `CSP_DEV` tetap mengandung untuk HMR;
       - helper validasi sender menolak URL asing.
  - **DoD:** path traversal tertutup; CSP produksi offline; frame asing tidak
    bisa memanggil IPC.
  - **Verifikasi:** `npx vitest run tests/csp.test.ts tests/ipc-main.test.ts`.
  - **Dependency:** —

- [x] **AUD-18 — Auto-lock di main + lock saat suspend + tombol kunci** · P0 · M (2026-10-27: `terakhirAktivitas` di sesi disentuh saat `setupPin`/`bukaKunci`/`resetPaksa` berhasil dan setiap `perluBuka()` lolos; fungsi murni `harusKunci` + interval main 60 dtk (`unref`, dibersihkan saat quit) dan `powerMonitor` `suspend`/`lock-screen` memanggil `kunciLagi()`; backup/restore menahan auto-lock lewat `tahanAutoKunci` yang idempoten dan menyentuh aktivitas saat dilepas; renderer polling `lock:status` 30 dtk + listener `focus` (keduanya dibersihkan) dan tombol **Kunci** di header memanggil `api.lockLock()` lalu `refreshLock()`; typecheck/test/build hijau, 511 test total + 8 test; smoke Electron build: tombol Kunci → `terbuka:false` + layar PIN, emit `suspend`/`lock-screen` di main → sesi tertutup dan layar PIN muncul, interval main dengan waktu dimajukan +31 mnt mencatat `[auto-lock]` dan menampilkan layar PIN)
  - **Konteks:** Timer idle hanya ada di renderer. Jika renderer freeze,
    DevTools di-pause, atau app ditutup-lid, sesi main tetap terbuka. Tidak
    ada tombol kunci manual.
  - **Langkah:**
    1. Di `src/main/kunci.ts`, simpan `terakhirAktivitas`. Set nilainya saat
       `setupPin`/`bukaKunci` berhasil, dan panggil `sentuhAktivitas()` setiap
       kali `perluBuka()` berhasil.
    2. Tambah fungsi murni `harusKunci(now, terakhir, menit)` + test.
    3. Di main, interval 60 detik memanggil `kunciLagi()` bila idle.
    4. `powerMonitor.on('suspend')` dan `on('lock-screen')` → `kunciLagi()`.
    5. Renderer: polling `lock:status` tiap 30 detik; jika `terbuka=false`,
       tampilkan LockScreen. Tambah tombol **Kunci** di header yang memanggil
       `api.lockLock()` lalu `refreshLock()`.
    6. Test sesi murni; smoke manual: lock via tombol, lock saat suspend
       (atau simulasi fungsi).
  - **DoD:** keputusan lock ditegakkan main, bukan hanya renderer.
  - **Verifikasi:** test baru + `npm run typecheck && npm run build`.
  - **Dependency:** AUD-02.

- [ ] **AUD-19 — Kode darurat per-install (hash, tampil sekali)** · P1 · M
  - **Konteks:** Kode darurat default ada di source dan docs; repo public.
    Siapa pun yang mengekstrak app bisa mereset PIN lalu membaca DB plaintext.
  - **Langkah:**
    1. Tambah pengaturan `reset_salt`, `reset_hash` (scrypt, pola sama dengan
       PIN). Jangan simpan kode plaintext.
    2. Saat setup PIN pertama, generate kode acak (mis. 4 grup karakter),
       simpan hash, dan tampilkan modal “Simpan kode darurat ini” satu kali.
       Ubah `setupPin`/IPC `lock:setup` agar mengembalikan kode **hanya sekali**
       pada respons setup; jangan pernah membacanya lagi dari DB.
    3. Tambah UI **Atur/Ganti kode darurat** di Pengaturan (butuh PIN terbuka).
    4. `resetPaksa` memverifikasi hash; tidak ada fallback default di
       production.
    5. Untuk instalasi lama tanpa `reset_hash`: tampilkan pesan “Kode darurat
       belum diatur” dan arahkan ke Pengaturan; jangan memakai default lama.
    6. Hapus `PURA_RESET_CODE`/default dari `.env.example` dan docs, atau
       batasi hanya untuk test/dev dengan nama jelas.
    7. Test: setup menghasilkan kode, verifikasi benar/salah, tidak ada
       plaintext di DB, rotate code.
  - **DoD:** tidak ada kode darurat global yang bisa ditebak dari source.
  - **Verifikasi:** test baru + `npm run build` + smoke reset.
  - **Dependency:** AUD-01.

---

## Fase 1 — Konsistensi akuntansi

- [x] **AUD-20 — Kunci `awalTahunBuku` ke Januari sampai fiskal didukung** · P1 · S (2026-10-27: `validasiPengaturan` hanya menerima Januari/1 dengan pesan “Tahun buku fiskal belum didukung”; field Pengaturan dikunci “Januari (tahun kalender)” tanpa pilihan 1–12, peringatan amber untuk data lama (mis. bulan 7) meminta simpan ulang tanpa mengubah DB otomatis; panduan pemeriksaan §5 diperbarui; typecheck/test/build hijau, 515 test total + 4 test; smoke in-memory DB lama 7 → peringatan, simpan 7 ditolak & DB tetap 7, simpan 1 diterima)
  - **Konteks:** Setting menerima bulan 1–12, tetapi `neraca()` dan
    `tutupBuku()` memakai tahun kalender; Dashboard/Anggaran memakai setting.
    Ini menghasilkan angka yang saling bertentangan.
  - **Langkah:**
    1. Sampai dukungan fiskal penuh dibuat, ubah `validasiPengaturan` agar
       hanya menerima `awalTahunBuku === 1`, dengan pesan jelas.
    2. UI Pengaturan: tampilkan field sebagai “Januari (tahun kalender)” dan
       jelaskan bahwa tahun buku fiskal belum didukung.
    3. Jika DB lama berisi 7, tampilkan peringatan di Pengaturan dan minta
       user menyimpan ulang ke 1; jangan diam-diam mengubah data.
    4. Update `panduan-pemeriksaan.md` §5.
    5. Test: setting 7 ditolak; setting 1 diterima.
  - **DoD:** tidak ada lagi setting yang hanya berlaku di sebagian laporan.
  - **Verifikasi:** `npx vitest run tests/pengaturan.test.ts tests/dashboard.test.ts`.
  - **Dependency:** —

- [x] **AUD-21a — Core Neraca Saldo per tahun buku** · P1 · M (2026-10-27: `neracaSaldoPeriode` murni di `src/core/reports.ts` — akun AKTIVA/KEWAJIBAN/EKUITAS kumulatif s/d `sampai`, PENDAPATAN/BEBAN hanya mutasi `mulai..sampai`, baris sintetis “Laba ditahan sebelum periode” dari laba bersih sebelum `mulai` (debit bila defisit), total debit = kredit + `selisih`/`seimbang`; `neracaSaldo` lama tidak diubah; 5 test 2025/2026 + rekonsiliasi saldo akun dengan Neraca; typecheck/test/build hijau, 520 test total + 5 test)
  - **Konteks:** `neracaSaldo` hanya punya cutoff dan memasukkan seluruh akun
    P&L sejak awal. Setelah tutup buku 2025, Neraca Saldo 2026 masih memuat
    pendapatan/beban 2025. Total tetap seimbang, tetapi bukan trial balance
    yang diharapkan akuntan.
  - **Langkah:**
    1. Tambah fungsi murni di `src/core/reports.ts`:
       ```ts
       neracaSaldoPeriode(baris, {
         mulai: '2026-01-01',
         sampai: '2026-12-31',
         daftarAkun?
       })
       ```
    2. Aturan:
       - akun AKTIVA/KEWAJIBAN/EKUITAS: saldo kumulatif s/d `sampai`;
       - akun PENDAPATAN/BEBAN: hanya mutasi `mulai..sampai`;
       - tambah baris sintetis **“Laba ditahan sebelum periode”** dari laba
         bersih sebelum `mulai` (kredit jika laba, debit jika defisit);
       - total debit harus = total kredit; ekspos `selisih`/`seimbang`.
    3. Jangan ubah `neracaSaldo` lama dulu; tambahkan fungsi baru agar
       kompatibel. Asumsi: tidak ada jurnal penutup manual ke 3000/3001/3002;
       jika nanti ada, sesuaikan perhitungan laba ditahan agar tidak dobel.
    4. Test manual 2025 + 2026:
       - 2026 hanya memuat P&L 2026;
       - laba 2025 masuk baris laba ditahan;
       - total debit = kredit;
       - dibandingkan dengan Neraca.
  - **DoD:** fungsi baru teruji dan tidak menyentuh angka tersimpan.
  - **Verifikasi:** `npx vitest run tests/laporan.test.ts`.
  - **Dependency:** AUD-20.

- [ ] **AUD-21b — UI/export Neraca Saldo per tahun buku** · P1 · M
  - **Konteks:** Setelah AUD-21a, UI perlu pilihan mode.
  - **Langkah:**
    1. Di `NeracaSaldoTab`, tambah toggle:
       - **Tahun berjalan** (default; pakai `neracaSaldoPeriode`),
       - **Kumulatif sejak awal** (perilaku lama).
    2. Tampilkan periode dan label baris laba ditahan.
    3. IPC `laporan:neraca-saldo` menerima `{ cutoff, mode: 'tahun'|'kumulatif' }`;
       validasi bentuk.
    4. Export XLSX/PDF mengikuti mode dan label.
    5. Test adapter + print builder; minimal pastikan label/rows benar.
  - **DoD:** akuntan bisa memilih trial balance tahun berjalan.
  - **Verifikasi:** test baru + `npm run build`.
  - **Dependency:** AUD-21a.

- [ ] **AUD-22 — 3001/3002 tidak boleh diposting** · P1 · S
  - **Konteks:** `3001`/`3002` adalah akun ekuitas legacy yang dulu dihitung
    otomatis. Di v2, Jurnal Umum/import masih bisa memposting ke sana dan
    membingungkan derivasi laba.
  - **Langkah:**
    1. Tambah helper `akunBolehDiposting(kode)` di `src/db/coa.ts`:
       tolak `3001`, `3002` (dan akun nonaktif).
    2. Panggil di `validasiJurnal` (`src/core/posting.ts`) dan
       `insertJurnal` (pertahanan terakhir).
    3. Filter pilihan akun di `JurnalUmumEditor`/`Pembantu`/form lain.
    4. Test: posting 3001/3002 ditolak dengan pesan jelas; 3000 tetap boleh.
    5. Update docs COA.
  - **DoD:** akun legacy tidak bisa dipakai lagi.
  - **Verifikasi:** test baru + `npm test`.
  - **Dependency:** —

- [ ] **AUD-23 — Migrasi v9: integritas jurnal + nomor bukti per tahun** · P1 · M
  - **Konteks:** DB mengizinkan baris dengan debit dan kredit sama-sama > 0.
    Jurnal juga bisa di-UPDATE/DELETE langsung. `no_bukti` unik global,
    padahal ticket P1-11 mengatakan unik per tahun.
  - **Langkah:**
    1. Naikkan `SCHEMA_VERSION` ke 9.
    2. Migrasi idempotent:
       - trigger `BEFORE INSERT/UPDATE ON jurnal_baris` yang menolak
         `debit > 0 AND kredit > 0`;
       - trigger `BEFORE UPDATE/DELETE ON jurnal` dan `jurnal_baris` yang
         menolak perubahan/penghapusan;
       - drop index `idx_jurnal_no_bukti` lama;
       - buat unique index per tahun:
         `ON jurnal(substr(tanggal,1,4), no_bukti COLLATE NOCASE)
          WHERE no_bukti <> ''`.
    3. Update `insertJurnal` dan `buatKonteksPosting` agar pengecekan duplikat
       `no_bukti` dibatasi tahun yang sama.
    4. Test:
       - insert/update baris dua sisi ditolak;
       - update/delete jurnal ditolak;
       - nomor `JU-2026-0001` dan `JU-2025-0001` boleh bersama;
       - nomor sama dalam tahun yang sama ditolak;
       - restore DB v8 termigrasi ke v9.
    5. Pastikan test lama yang menghapus jurnal langsung disesuaikan.
  - **DoD:** integritas inti dijaga DB, bukan hanya aplikasi.
  - **Verifikasi:** `npm run typecheck && npm test` + test restore.
  - **Dependency:** — (koordinasi dengan AUD-22/AUD-24 jika menyentuh migrasi).

- [ ] **AUD-24 — Seed dev: pihak + mapping 1050/2050** · P1 · S
  - **Konteks:** Seed dev membuat 1050/2050 tanpa `pihak`/`jurnal_pihak`.
    Tab Piutang & Hutang kosong meski Neraca punya saldo.
  - **Langkah:**
    1. Di `src/db/seed-dev.ts`, buat 2–3 pihak contoh.
    2. Setiap jurnal 1050/2050 yang dibuat seed harus punya mapping
       `jurnal_pihak` yang sesuai (piutang/hutang per pihak).
    3. Pastikan `saldoPerPihak` total = saldo 1050/2050 dan
       `rekonsiliasiPihak` (AUD-09) “belum” = 0.
    4. Update `tests/seed-dev.test.ts`.
  - **DoD:** DB seed mendemonstrasikan fitur pihak dengan benar.
  - **Verifikasi:** `npx vitest run tests/seed-dev.test.ts tests/pihak.test.ts`.
  - **Dependency:** AUD-09.

- [x] **AUD-25 — Perbaiki arah Pembantu + XLSX numerik (WIP)** · P1 · S
  - **Bukti:** (2026-10-27: arah masuk/keluar dari `posisi_normal`; nominal XLSX number + `NUMFMT_RP`; saldo berjalan + saldo awal konsisten di UI/HTML/XLSX; 430 test hijau, +3 test)
  - **Konteks:** Refactor `pembantuDariBukuBesar` (belum di-commit) memakai
    `isAkunKas` untuk arah masuk/keluar. 1040/1050 adalah AKTIVA non-kas,
    sehingga arahnya terbalik dan saldo berjalan di export melompat.
  - **Langkah:**
    1. Ganti keputusan arah berdasarkan `bb.posisi_normal`:
       - DEBIT: `masuk = debit`, `keluar = kredit`;
       - KREDIT: `masuk = kredit`, `keluar = debit`.
    2. `pembantuToWorkbook`: tulis nominal sebagai number + `NUMFMT_RP` (bukan
       `formatRp` string) agar bisa di-SUM di Excel. Untuk HTML/print tetap
       pakai `formatRp` karena HTML tidak punya numFmt.
    3. Pastikan tabel UI menampilkan saldo berjalan atau hapus kolom saldo
       dari export bila tidak konsisten; pilih satu perilaku.
    4. Test:
       - 1001 kas;
       - 4005 pendapatan;
       - 1040 panjar (D 50 dari saldo awal 100 → saldo 150);
       - 1050 piutang;
       - sel Excel bertipe `number`.
  - **DoD:** angka Pembantu konsisten dengan Buku Besar untuk semua tipe akun.
  - **Verifikasi:** `npx vitest run tests/pembantu-jurnal.test.ts tests/export-laporan.test.ts`.
  - **Dependency:** — (selesaikan WIP ini dulu sebelum ticket lain).

- [ ] **AUD-26 — Hilangkan copy UI yang sudah basi** · P1 · S
  - **Konteks:** `TransaksiTab` masih menampilkan Panjar/Piutang sebagai
    “Segera hadir” dan “Jenis lain menyusul”; `TransaksiForm` bilang anggaran
    “belum diatur (fitur anggaran menyusul)”. Semua fitur itu sudah ada.
  - **Langkah:**
    1. Di `TransaksiTab.tsx`: hapus kartu disabled “Segera hadir”, atau ubah
       menjadi tombol navigasi ke tab **Buku Panjar**/**Piutang & Hutang**
       (butuh prop `onBukaTab` dari `App`).
    2. Hapus teks “Jenis lain menyusul”.
    3. Di `TransaksiForm.tsx`, ganti info anggaran menjadi
       “Pagu anggaran diatur di menu Anggaran” atau hapus.
    4. Cari semua teks basi:
       ```bash
       rg -n "Segera hadir|menyusul|belum diatur|fitur .* menyusul" src/renderer
       ```
    5. Smoke UI.
  - **DoD:** tidak ada fitur yang sudah jadi tetapi disebut “segera hadir”.
  - **Verifikasi:** `npm run build` + grep bersih.
  - **Dependency:** AUD-08.

- [ ] **AUD-27 — Detail audit human-readable + label aksi baru** · P1 · S
  - **Konteks:** `PengaturanTab` menampilkan `data_lama_json`/`data_baru_json`
    sebagai JSON mentah. `formatAksiAudit` belum mengenal aksi pihak,
    anggaran, rekonsiliasi, import, lampiran, setup PIN, dll.
  - **Langkah:**
    1. Tambah label aksi baru di `src/utils/auditDetail.ts`.
    2. Buat parser/component untuk bentuk audit v2:
       - `{ jurnal, baris }` → tampilkan tanggal, no bukti, keterangan, tabel
         akun/debit/kredit;
       - `{ panjar, items }` → penerima, jumlah, status;
       - fallback ke `<pre>` JSON.
    3. Ganti tampilan `<pre>` di `PengaturanTab` dengan komponen tersebut.
    4. Test parser + label untuk contoh audit v2.
  - **DoD:** operator bisa membaca detail audit tanpa membaca JSON mentah.
  - **Verifikasi:** test baru + `npm run build`.
  - **Dependency:** AUD-05.

---

## Fase 2 — Kebersihan, dokumentasi, rilis

- [ ] **AUD-28 — Hapus jalur single-entry di renderer/API/IPC** · P2 · M
  - **Konteks:** `BkuTab.tsx` tidak dipasang di `App`, tetapi masih memanggil
    `api.transaksiList`/`transaksiCreate`. IPC `transaksi:list/create` masih
    terdaftar dan menulis ke tabel `transaksi` yang sudah di-drop.
  - **Langkah:**
    1. Hapus `src/renderer/components/BkuTab.tsx`.
    2. Hapus `transaksiList`/`transaksiCreate` dari `src/renderer/lib/api.ts`.
    3. Hapus handler `transaksi:list`/`transaksi:create` dari
       `src/main/ipc.ts` beserta importnya.
    4. Hapus/ubah test yang memanggil endpoint itu.
    5. `rg "transaksi:list|transaksi:create|BkuTab" src` harus bersih.
  - **DoD:** tidak ada UI/API mati yang menulis ke tabel yang tidak ada.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** —

- [ ] **AUD-29 — Hapus repository/ledger/laporan legacy + migrasikan test** · P2 · M
  - **Konteks:** `src/db/repository.ts` masih punya `insertTransaksi`,
    `listTransaksi`, `insertPanjar`, `closePanjar`; `core/ledger.ts` masih
    berisi mesin single-entry; `features/reports/dataProvider.ts`,
    `realisasi/surplus`, dan sebagian export legacy masih ada. Dua mesin
    akuntansi dalam satu repo berbahaya.
  - **Langkah:**
    1. Inventaris pemakaian:
       `rg "core/ledger|insertTransaksi|listTransaksi|insertPanjar|closePanjar|buildRealisasi|buildSurplus|dataProvider" src tests`.
    2. Pindahkan helper yang masih dipakai (`buatAuditLog`,
       `jsonAuditAman`, `validasiSimpanLonggar`, `isPeriodeTerkunci`) ke modul
       kecil yang jelas (mis. `core/audit.ts`, `core/periode.ts`), lalu hapus
       sisanya.
    3. Hapus fungsi/report/export legacy yang tidak dipakai UI.
    4. Hapus/ganti test single-entry.
    5. Pastikan `rg` untuk simbol legacy kosong.
  - **DoD:** hanya ada satu mesin akuntansi (jurnal double-entry).
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** AUD-28.

- [ ] **AUD-30 — Migrasikan test aset/export ke mesin laporan v2** · P2 · S
  - **Konteks:** `tests/aset.test.ts` menguji isolasi aset memakai
    `core/ledger.neraca` single-entry, bukan `core/reports.neraca`.
    `tests/export-kop.test.ts` menguji builder legacy.
  - **Langkah:**
    1. Ubah test isolasi aset agar memakai `core/reports.neraca` + jurnal
       seimbang.
    2. Tambah skenario: aset dengan `nilai_sen` besar tidak mengubah
       Laba Rugi/Neraca.
    3. Hapus test export legacy atau pindahkan ke builder v2.
    4. Pastikan test baru menggunakan minimal satu jurnal modal + satu beban.
  - **DoD:** properti isolasi aset diuji terhadap mesin yang benar.
  - **Verifikasi:** `npx vitest run tests/aset.test.ts tests/export-laporan.test.ts`.
  - **Dependency:** AUD-29.

- [ ] **AUD-31 — Docs, versi, README** · P2 · S
  - **Konteks:** `package.json` masih `1.2.0`; docs masih menyebut 1.2.0;
    `docs/erd-dan-arsitektur.md` adalah snapshot single-entry; tidak ada
    README; `.env.example` masih menyebut “240 transaksi dummy”.
  - **Langkah:**
    1. Naikkan versi ke `2.0.0` (atau versi rilis yang disepakati) dan samakan
       header docs.
    2. Buat `README.md`: ringkasan, arsitektur satu halaman, perintah
       (`dev`, `test`, `typecheck`, `build`, `dist:win`), lokasi data,
       peringatan backup lampiran, dan status POC/produksi.
    3. Arsipkan `erd-dan-arsitektur.md` (rename `erd-v1-arsip.md` atau beri
       header arsip yang jelas); jangan biarkan jadi acuan aktif.
    4. Update `.env.example` (240 jurnal, bukan transaksi; kode darurat baru).
    5. Update `docs/panduan-pengguna.md`/`panduan-pemeriksaan.md` untuk
       perubahan AUD-06/AUD-07/AUD-08/AUD-20/AUD-21.
    6. Jelaskan eksplisit bahwa PIN adalah kunci akses aplikasi, **bukan
       enkripsi**: siapa pun yang memegang file `pura.db`/backup bisa membaca
       data. Jangan biarkan user menganggap PIN melindungi file yang dicuri.
    7. Update `tests/dokumentasi.test.ts` tanggal/istilah yang berubah.
  - **DoD:** dokumentasi cocok dengan kode dan versi.
  - **Verifikasi:** `npm test -- tests/dokumentasi.test.ts` + review manual.
  - **Dependency:** AUD-06, AUD-07, AUD-08, AUD-20, AUD-21b.

- [ ] **AUD-32 — CI di branch `dev`, npm audit, update dependency** · P2 · S
  - **Konteks:** workflow hanya `main`, sedangkan kerja di `dev`. `npm audit`
    melaporkan `brace-expansion` high dan `uuid` moderate via `exceljs`.
  - **Langkah:**
    1. Ubah trigger workflow menjadi push/PR untuk `main` dan `dev`.
    2. Tambah step `npm audit --omit=dev --audit-level=high` (boleh
       `continue-on-error` sementara, tetapi tampilkan hasil).
    3. Jalankan `npm audit fix` untuk `brace-expansion`; evaluasi `uuid`
       (jangan paksa downgrade `exceljs` tanpa test).
    4. Jalankan `npm test`, `npm run build`, `npm run dist:win` di CI.
    5. Catat versi Node yang dipakai.
  - **DoD:** CI berjalan di branch kerja; tidak ada high vulnerability yang
    belum diketahui.
  - **Verifikasi:** workflow YAML review + `npm audit`.
  - **Dependency:** —

- [ ] **AUD-33 — Icon aplikasi + konfigurasi signing** · P2 · S
  - **Konteks:** Installer belum punya icon kustom dan belum ditandatangani;
    Windows SmartScreen akan memperingatkan user.
  - **Langkah:**
    1. Tambah `build/icon.ico` (dan PNG untuk macOS jika perlu).
    2. Set `build.icon` di `package.json`.
    3. Tambah placeholder konfigurasi signing (`CSC_LINK`/`CSC_KEY_PASSWORD`
       lewat CI secrets); jangan commit sertifikat.
    4. Dokumentasikan bahwa sertifikat adalah tindakan manual pemilik.
    5. `npm run dist:win` menghasilkan installer ber-icon.
  - **DoD:** build Windows memakai icon; jalur signing terdokumentasi.
  - **Verifikasi:** `npm run dist:win` (atau CI Windows) + cek artifact.
  - **Dependency:** —

- [ ] **AUD-34 — Error boundary + log file** · P2 · S
  - **Konteks:** Error React membuat layar blank; error main hanya
    `console.warn`/`console.log`, tidak ada file log untuk pendamping.
  - **Langkah:**
    1. Tambah `ErrorBoundary` di renderer dengan pesan ramah + tombol
       “Muat ulang”.
    2. Tambah logger main sederhana ke `<userData>/logs/app.log` (rotasi
       ukuran, jangan log PIN/data sensitif).
    3. Log startup, backup, restore, dan error tak tertangani.
    4. Test helper logger (path/rotasi) tanpa Electron.
  - **DoD:** crash UI/main tidak blank tanpa jejak.
  - **Verifikasi:** test helper + smoke manual.
  - **Dependency:** —

---

## Backlog produk (belum siap dikerjakan AI tanpa keputusan pemilik)

Ticket berikut **bukan bug**; jangan dikerjakan sebelum diputuskan:

- **BKU konsolidasi** — laporan Buku Kas Umum dari jurnal dengan saldo
  berjalan per dompet, export/print. Ini kemungkinan laporan harian utama
  pura, dan saat ini belum ada pengganti `BkuTab`.
- **Mode operator vs akuntan** — kelompokkan 17 tab menjadi “Harian”,
  “Laporan”, “Akuntan”, “Alat”, atau toggle mode.
- **Saldo awal per pihak** — tambah detail pihak pada wizard Saldo Awal untuk
  1050/2050.
- **Kolom pihak di Import Excel** — template + parser + adapter.
- **Tutup buku bulanan / buka kunci tahun** — keputusan kebijakan.
- **Tahun buku fiskal penuh** — jika pura memakai Juli–Juni; harus konsisten
  di dashboard, neraca, laba rugi, tutup buku, dan anggaran.
- **Jurnal penutup + snapshot tutup buku** — jika akuntan membutuhkan trial
  balance pasca-closing dan angka tutup yang immutable.
- **Batalkan panjar** — flow reversal + reset metadata setelah AUD-07.
- **Lazy-load ExcelJS** — kurangi bundle renderer ~2.58 MB.
- **E2E Playwright Electron** — smoke: setup PIN → transaksi → jurnal →
  lock/unlock → backup.
