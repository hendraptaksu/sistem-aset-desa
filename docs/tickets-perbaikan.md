# Tickets Pengembangan — Arah Akuntansi

> **Revisi 2026-10-04 (2): arah double-entry + keputusan pemilik K1–K6.**
> - K1: operator **orang awam**; istri (akuntan) sebagai pendamping/pemeriksa. Form terpandu = alur utama.
> - K2: tutup buku hanya tahun yang sudah selesai.
> - K3: aset tetap & penyusutan **dibatalkan**.
> - K4: cukup PIN; multi-user & enkripsi **dibatalkan**.
> - K5: nomor bukti **`JU-2026-0001`** (JU = Jurnal Umum).
> - K6: data lama **dibuang** (POC) — tidak ada migrasi.
>
> Acuan arah: `docs/arah-akuntansi.md`. **PRD tidak dipakai lagi.**
> Baseline kode: v1.2.0 (single-entry). Baseline verifikasi: `npx tsc --noEmit` bersih, 72/72 test hijau.
> Dokumen pendamping: `docs/erd-dan-arsitektur.md` (snapshot v1.2.0, bukan source of truth).
>
> **Feedback WhatsApp v1.2.0** (edit typo, layout print, pindah kas LPD → kas bendahara, lawan hutang)
> sudah dipetakan: P0-6, P1-3, P1-5, P1-10, P1-16 — peta lengkap di `docs/arah-akuntansi.md` §12.

## Cara pakai (untuk AI agent)

1. **Satu sesi = satu ticket.** Pilih ticket `[ ]` paling atas yang dependency-nya selesai.
2. Baca **Konteks → Langkah → DoD**. Untuk ticket yang menyentuh model data, baca dulu
   `docs/arah-akuntansi.md` §3 (prinsip yang dikunci).
3. **Operator adalah orang awam.** Semua UI default harus bisa dipakai tanpa paham debit/kredit;
   istilah akuntansi dipakai hanya di tempat yang memang untuk akuntan (Jurnal Umum, Buku Besar),
   dengan bahasa yang standar/lumrah.
4. Test dulu untuk logika murni (vitest, tanpa Electron), baru IPC/main, terakhir UI.
5. Wajib sebelum centang: `npm run typecheck` **dan** `npm test` hijau. Perubahan main/UI: `npm run build` hijau.
6. Selesai → ubah `- [ ]` jadi `- [x]` + bukti di baris yang sama
   `(YYYY-MM-DD: 1 kalimat hasil + jumlah test)`. **Jangan centang tanpa bukti.**
7. Commit terpisah per ticket: `feat(P0-2): ...` / `fix(P0-5): ...`.
8. **Jangan menyimpan angka turunan.** Saldo, laba, dan total selalu dihitung dari jurnal.
9. **Jangan menghapus/ubah jurnal yang sudah tersimpan.** Koreksi lewat reversal + alasan.
10. DB dev lama (`data/pura-dev.db`) **boleh dibuang** (K6). Jangan menyentuh `data/backups/*`.
11. Proyek POC: merombak file lama diperbolehkan; ganti test lama dengan test setara untuk model baru.

## Kondisi awal yang diketahui (pelajaran dari v1, bukan data yang harus diselamatkan)

- `data/pura-dev.db` per 2026-10-03: Neraca selisih **Rp 2.000.000** karena `tutup_buku.laba` disimpan
  mati dan koreksi 2025 masuk setelah tutup buku.
- `backup:export` / `backup:auto` di `src/main/index.ts` memakai `copyFileSync` saat WAL terbuka
  (rawan kehilangan transaksi terbaru); `autoBackupHarian` sudah benar pakai `VACUUM INTO`.
- Tidak ada jalur koreksi transaksi; `panjar_item` tidak pernah terisi saat close.
- Tidak ada Buku Besar / Neraca Saldo / Jurnal Umum — laporan tidak bisa diperiksa akuntan.

## Urutan pengerjaan yang disarankan

`P0-1 → P0-2 → P0-3 → P0-4 → P0-5 → P0-6 → P0-7 → P0-8 → P0-9 → P0-10`, lalu P1, lalu P2.
P0-8 dan P0-9 tidak bergantung pada yang lain dan boleh dikerjakan lebih dulu.

---

## P0 — Pondasi akuntansi (wajib sebelum fitur lain)

- [x] **P0-1 — COA ber-tipe + akun 1040 Uang Panjar** (2026-10-22: COA bertipe baku + `posisi_normal`, 1040 tersimpan di tabel `akun`, `PANJAR_KATEGORI` dihapus; 78/78 test hijau)
  - **Konteks:** `src/db/coa.ts` sekarang memakai tipe campuran (`KAS`, `PIUTANG`, `PENDAPATAN`, ...) dan
    kategori `PANJAR` yang bukan akun. Model baru butuh tipe akuntansi yang baku + akun panjar sebagai aset.
  - **Langkah:**
    1. Ganti tipe menjadi `AKTIVA | KEWAJIBAN | EKUITAS | PENDAPATAN | BEBAN`, tambah `posisi_normal:
       'DEBIT' | 'KREDIT'`.
    2. Tambah akun **`1040` UANG PANJAR (KAS DI MUKA)** tipe AKTIVA (normal debit). Nama & kode mengikuti
       `KODE AKUN.csv`; 1040 adalah tambahan yang disetujui arah ini.
    3. Tetapkan posisi normal: AKTIVA & BEBAN = DEBIT; KEWAJIBAN, EKUITAS, PENDAPATAN = KREDIT.
    4. Simpan daftar akun ke tabel `akun` (upsert) saat `openDb`; helper `akun(kode)`, `isAkunKas(kode)`
       (semua AKTIVA kas/bank: 1001, 1010–1036, 1028, 1029; **bukan** 1040/1050).
    5. Ganti fungsi lama `isPendapatan/isBeban/isKas` mengikuti tipe baru; `PANJAR_KATEGORI` dihapus.
  - **DoD:** test: semua kode di `KODE AKUN.csv` ada; tipe & posisi normal benar; 1040 ada; daftar akun
    kas tepat (tidak termasuk 1040/1050).
  - **Verifikasi:** `npx vitest run` + test baru
  - **Dependency:** —

- [x] **P0-2 — Skema & repository jurnal double-entry** (2026-10-22: tabel `jurnal`/`jurnal_baris` + migrasi `user_version` v2 + `insertJurnal` atomik tervalidasi; 85/85 test hijau)
  - **Konteks:** semua angka harus berasal dari jurnal. Butuh tabel kepala + baris + kerangka versi skema
    (PRAGMA user_version), karena `database.ts` sekarang hanya `CREATE TABLE IF NOT EXISTS`.
  - **Langkah:**
    1. DDL baru:
       - `jurnal(id TEXT PK, tanggal TEXT, no_bukti TEXT, keterangan TEXT, jenis TEXT, grup_id TEXT,
         reversal_of TEXT, created_at TEXT)`.
       - `jurnal_baris(id INTEGER PK AUTOINCREMENT, jurnal_id TEXT FK, akun_kode TEXT FK, debit INTEGER,
         kredit INTEGER, keterangan TEXT, CHECK(debit >= 0 AND kredit >= 0 AND (debit > 0 OR kredit > 0)))`.
       - Index: `jurnal(tanggal)`, `jurnal(grup_id)`, `jurnal_baris(jurnal_id)`, `jurnal_baris(akun_kode)`.
    2. Kerangka `migrasi(db)` dengan `PRAGMA user_version`: v0/v1 → v2 = buat tabel baru + buang tabel
       single-entry lama (lihat P0-3); idempoten.
    3. Repository: `insertJurnal(db, header, baris[])` dalam satu transaksi DB wajib:
       ≥2 baris; total debit = total kredit; total > 0; akun ada; nominal integer sen.
       Plus `listJurnal(f)`, `getJurnal(id)`, `listJurnalBaris(id)`.
    4. Simpan `created_at` ISO; `grup_id` default = id jurnal bila kosong.
  - **DoD:** test: jurnal seimbang tersimpan; jurnal tidak seimbang / 1 baris / nominal 0 ditolak;
    DB lama terbuka tanpa error; `user_version` naik.
  - **Verifikasi:** `npx vitest run` + test baru `tests/jurnal.test.ts`
  - **Dependency:** P0-1

- [x] **P0-3 — Reset DB POC + seed dev v2 (tanpa migrasi)** (2026-10-22: skema v2 bersih tanpa tabel single-entry, seed 240 jurnal seimbang deterministik, Neraca Saldo total debit = kredit; 89/89 test hijau)
  - **Konteks:** keputusan K6 — masih POC, tidak ada production, data lama boleh dibuang. Jadi tidak perlu
    menulis konverter `transaksi` → jurnal. Cukup skema baru + data dev baru.
  - **Langkah:**
    1. Di `migrasi()` (P0-2), saat naik dari versi < 2: `DROP TABLE IF EXISTS transaksi, panjar,
       panjar_item, tutup_buku, coa`. Pertahankan `pengaturan` (PIN) dan `aset` (inventaris non-akuntansi).
    2. Hapus `src/db/seed-dev.ts` lama (single-entry), tulis ulang: hasilkan contoh **jurnal seimbang**
       deterministik (pendapatan, beban, transfer, piutang, hutang, modal, panjar open + close) selama
       beberapa bulan; `PURA_SEED_DEV=true` tetap dipakai.
    3. Jangan menyertakan data dummy di build production (sama seperti sekarang: hanya `!app.isPackaged`).
    4. Perbarui `tests/seed-dev.test.ts` agar memeriksa jumlah jurnal & Neraca Saldo nol.
  - **DoD:** DB baru langsung punya skema v2; `PURA_SEED_DEV=true` mengisi jurnal; laporan jalan;
    tabel single-entry lama sudah tidak ada.
  - **Verifikasi:** `npx vitest run tests/seed-dev.test.ts`
  - **Dependency:** P0-2

- [ ] **P0-4 — Posting layer & aturan validasi bisnis**
  - **Konteks:** aturan akuntansi harus satu pintu, bukan tersebar di UI.
  - **Langkah:** fungsi murni `validasiJurnal(input, ctx)`:
    1. Tanggal kalender valid (tolak 31 Feb — perbaikan bug lama).
    2. Akun ada & aktif; jenis akun konsisten dengan baris.
    3. Jurnal seimbang (ditegaskan lagi di sini + repository).
    4. Periode terkunci → butuh alasan ≥5 karakter (`guardPeriodeTerkunci` dipertahankan).
    5. Akun kas/bank akan minus → kembalikan `peringatan` (bukan error), UI minta konfirmasi.
    6. `no_bukti` duplikat → tolak (unique index parsial).
  - **DoD:** test tiap aturan + kombinasi; pesan error berbahasa Indonesia sederhana.
  - **Verifikasi:** `npx vitest run tests/ipc-validation.test.ts` (dirombak) + test baru
  - **Dependency:** P0-2

- [ ] **P0-5 — Laporan inti dari jurnal (pure functions)**
  - **Konteks:** laporan lama (`ledger.ts`, `realisasi.ts`, `surplus.ts`, `pembantu.ts`) dibangun dari
    single-entry dengan rumus berbeda-beda. Arah baru: satu mesin laporan dari jurnal.
  - **Langkah:** implementasi + test angka manual:
    1. `saldoAkun(jurnalBaris, akun, sampai)` — per posisi normal.
    2. `bukuBesar(akun, {mulai, sampai})` — saldo awal, baris mutasi, saldo berjalan, saldo akhir.
    3. `neracaSaldo(cutoff)` — daftar akun + debit/kredit/saldo; **selisih wajib 0**.
    4. `labaRugi({mulai, sampai})` — total pendapatan − beban, per akun.
    5. `neraca(cutoff)` — aset = kewajiban + ekuitas (termasuk laba berjalan & laba ditahan turunan).
    6. `arusKas({mulai, sampai})` — metode langsung dari mutasi akun kas/bank.
    7. Ganti pemakaian fungsi single-entry lama di seluruh kode; hapus setelah semua tab pindah.
  - **DoD:** test skenario lengkap: pendapatan, beban, transfer, piutang, hutang, modal, panjar open+close,
    saldo awal → Neraca Saldo nol; Neraca seimbang; Laba Rugi cocok perhitungan manual.
  - **Verifikasi:** `npx vitest run tests/laporan.test.ts`
  - **Dependency:** P0-3

- [ ] **P0-6 — Koreksi = jurnal balik (reversal)**
  - **Konteks:** tidak boleh ada edit/hapus; akuntan butuh koreksi yang bisa diaudit.
  - **Langkah:**
    1. Backend: `jurnal:reverse(id, alasan)` → buat jurnal baru yang menukar debit/kredit semua baris,
       `reversal_of = id asli`, `grup_id` sama, keterangan `KOREKSI: ...`; tolak reversal ganda &
       reversal atas reversal; hormati kunci periode; tulis audit.
    2. UI: layar daftar jurnal + tombol **Koreksi** + modal alasan + pratinjau jurnal balik.
       Setelah reversal, tawarkan **"Koreksi & isi ulang"**: form terbuka terisi data lama supaya operator
       awam memperbaiki typo dalam satu alur (reversal + jurnal baru + audit), bukan dua langkah manual.
  - **DoD:** test: saldo kembali ke posisi sebelum jurnal asli; jurnal asli tetap ada; Neraca Saldo nol;
    reversal ganda ditolak.
  - **Verifikasi:** `npx vitest run` + smoke manual
  - **Dependency:** P0-2, P0-4

- [ ] **P0-7 — Tutup buku & kunci periode (tanpa angka tersimpan)**
  - **Konteks:** masalah utama v1 adalah `tutup_buku.laba` disimpan → basi. Di v2, tutup buku hanya
    **penanda + kunci + catatan audit**; laba & laba ditahan selalu dihitung dari jurnal.
    **K2:** hanya tahun yang sudah selesai (≤ tahun lalu) yang boleh ditutup.
  - **Langkah:**
    1. `tutup_buku` tetap ada (tahun, created_at, backup_path, catatan) **tanpa** laba sebagai sumber angka;
       bila perlu `laba_snapshot` hanya untuk riwayat cetak (dokumen, bukan perhitungan).
    2. Validasi: tahun bilangan bulat, `≤ tahun lalu` (K2), harus urut menaik, konfirmasi bila menimpa.
    3. `isPeriodeTerkunci` dipertahankan: tanggal ≤ 31 Des tahun tutup terakhir butuh alasan.
    4. Audit setiap aksi tutup (`TUTUP`, `TUTUP-ULANG`).
    5. Laba ditahan = akumulasi laba tahun-tahun yang sudah tutup; dihitung dari jurnal.
  - **DoD:** test: koreksi jurnal 2025 setelah tutup 2025 → Neraca 2026 tetap seimbang (regresi bug v1);
    tutup tahun berjalan ditolak; tutup tidak urut ditolak; audit tercatat.
  - **Verifikasi:** `npx vitest run tests/tutup.test.ts`
  - **Dependency:** P0-5

- [ ] **P0-8 — Backup & restore `.db` aman**
  - **Konteks:** `backup:export`/`backup:auto` memakai `copyFileSync` saat WAL terbuka; restore tanpa
    validasi & tanpa cadangan. Berlaku sejak sekarang sampai v2.
  - **Langkah:**
    1. Helper `backupVacuumInto(db, dest)` di `src/features/export/export.ts` (escape path, hapus tujuan
       bila ada, `VACUUM INTO`), dipakai `backup:export`, `backup:auto`, dan backup pra-reset/pra-upgrade.
    2. Restore: validasi kandidat (`integrity_check` = ok, tabel wajib ada) → backup DB aktif ke
       `backups/pre-restore-<stamp>.db` → `db.close()` → hapus `-wal`/`-shm` → copy ke `.tmp` lalu rename →
       reopen (jalankan migrasi versi) → audit `RESTORE`.
    3. Setiap kegagalan → buka ulang DB lama; jangan tinggalkan file setengah jadi.
  - **DoD:** test WAL: insert tanpa checkpoint → backup → buka hasil → semua baris ada; file sampah ditolak.
  - **Verifikasi:** `npx vitest run tests/backup-auto.test.ts` + test baru
  - **Dependency:** —

- [ ] **P0-9 — Audit log lengkap**
  - **Konteks:** tutup buku & aset tidak pernah diaudit; panjar hanya bila alasan diisi; daftar dibatasi 200
    tanpa filter.
  - **Langkah:**
    1. Wajib audit: create/reversal jurnal, tutup buku, saldo awal, panjar, CRUD aset, backup/restore,
       ubah pengaturan. Field: aksi, alasan (boleh kosong untuk operasi normal), `data_lama_json` (sebelum)
       + `data_baru_json` (sesudah).
    2. `audit:list` terima filter `{aksi, mulai, sampai, limit, offset}`.
    3. UI riwayat lengkap + detail sebelum/sesudah di tab Pengaturan (bukan di Tutup Buku).
  - **DoD:** test filter + setiap aksi di atas menghasilkan baris audit.
  - **Verifikasi:** `npx vitest run tests/audit.test.ts`
  - **Dependency:** —

- [ ] **P0-10 — Test invariant & gerbang kualitas**
  - **Konteks:** bukti utama "correctness": apa pun operasinya, Neraca Saldo selalu nol. POC tanpa migrasi,
    jadi fokus ke DB v2 fresh + invariant.
  - **Langkah:**
    1. Test acak-deterministik (seed tetap): rangkaian 200 operasi lewat posting layer (masuk, keluar,
       transfer, panjar, reversal, tutup) → setelah tiap operasi, `neracaSaldo` selisih 0.
    2. Test DB v2 fresh: buka DB kosong → skema lengkap → `seedDev` → Neraca Saldo nol & semua laporan jalan.
    3. Test: koreksi setelah tutup tidak pernah menghasilkan selisih.
    4. Test alur operator awam: builder form terpandu menghasilkan jurnal seimbang yang tidak butuh
       pengetahuan debit/kredit (P1 mulai memakainya).
    5. Hapus/ganti test lama yang menguji model single-entry.
  - **DoD:** semua hijau; `npm run typecheck` bersih; `npm test` tanpa test yang di-skip.
  - **Verifikasi:** `npm test`
  - **Dependency:** P0-1 s/d P0-9

---

## P1 — Pengalaman pengguna & laporan lengkap

- [ ] **P1-1 — Form terpandu: Terima Uang**
  - **Langkah:** tanggal, akun kas/bank tujuan, akun pendapatan (atau `3000` untuk setoran modal),
    nominal, keterangan, no bukti `JU-...`; **pratinjau jurnal** (debit/kredit) sebelum simpan;
    simpan = jurnal seimbang; peringatan kas minus (P0-4). Bahasa tombol & label harus dimengerti operator awam.
  - **DoD:** test builder jurnal dari form; smoke UI; laporan langsung berubah.
  - **Dependency:** P0-4

- [ ] **P1-2 — Form terpandu: Bayar / Beban**
  - **Langkah:** tanggal, akun kas/bank sumber, akun beban/akun lain, nominal, keterangan, no bukti;
    pratinjau jurnal; info anggaran (bila P2-1 ada).
  - **DoD:** test builder + smoke.
  - **Dependency:** P0-4

- [ ] **P1-3 — Form terpandu: Pindah Dana (transfer antar kas/bank)**
  - **Langkah:** dari, ke, nominal, tanggal, keterangan; jurnal 2 baris (D tujuan / K asal); tolak dari = ke.
    Label UI: "Pindah Dana" (bukan istilah asing). Kasus utama dari feedback: **LPD → Kas Bendahara (1001)**
    atau bank → kas; semua akun kas/bank boleh jadi asal/tujuan karena tiap dompet adalah akun tersendiri.
  - **DoD:** test saldo dua akun berubah sesuai; total kas tetap; contoh LPD 1014 → 1001 berfungsi.
  - **Dependency:** P0-4

- [ ] **P1-4 — Form Panjar (serah & pertanggungjawaban)**
  - **Langkah:** serah → D 1040 / K kas; close → rincian per akun beban (D beban / K 1040), sisa (D kas /
    K 1040), kurang boleh dengan konfirmasi; simpan `panjar_item`; validasi `tanggalClose >= tanggal`;
    tampilkan rincian di daftar.
  - **DoD:** test open/close/pas/sisa/kurang; `panjar_item` terisi; Neraca Saldo nol.
  - **Dependency:** P0-4

- [ ] **P1-5 — Form Piutang & Hutang + master pihak**
  - **Konteks:** feedback WhatsApp: user bingung "mencari lawan" hutang dan takut pencatatan perbaikan
    gedung menambah modal. Di double-entry lawannya jelas dan modal tidak tersentuh.
  - **Langkah:** tabel `pihak` (nama, catatan); form terpandu 5 alur:
    1. Beri pinjaman: D 1050 / K kas.
    2. Terima pelunasan: D kas / K 1050.
    3. Terima pinjaman: D kas / K 2050.
    4. Bayar hutang: D 2050 / K kas.
    5. **Beli/perbaikan barang secara kredit** (kasus feedback): D akun Beban (mis. 5003 Wewangunan) /
       K 2050 → beban masuk Laba Rugi, hutang masuk Neraca, **modal tidak berubah**.
    Pihak wajib untuk 1050/2050; peringatan bila pelunasan melebihi saldo pihak. Modal (3000) hanya
    berubah lewat setoran/penarikan modal atau wizard Saldo Awal, bukan lewat transaksi beban.
  - **DoD:** test tiap alur; saldo per pihak; laporan pembantu per pihak; test khusus: perbaikan gedung
    kredit → Laba Rugi turun, hutang naik, modal **tidak** berubah.
  - **Dependency:** P0-4

- [ ] **P1-6 — Wizard Saldo Awal**
  - **Langkah:** form saldo per akun (kas/bank, piutang, hutang, aset lain) + tanggal jangkar; selisih
    otomatis ke akun `3000 MODAL`; hanya boleh sekali (saat jurnal masih kosong); audit `SALDO-AWAL`;
    hasil = satu jurnal seimbang. Dipakai saat mulai pembukuan nyata (setelah POC selesai).
  - **DoD:** test: total debit = kredit; Neraca seimbang; menolak dijalankan dua kali.
  - **Dependency:** P0-4

- [ ] **P1-7 — Mode Jurnal Umum (untuk akuntan pendamping)**
  - **Langkah:** tabel multi-baris debit/kredit; autocomplete akun; kolom total debit/kredit live;
    tombol simpan nonaktif sampai seimbang; template & duplikat jurnal; keyboard-friendly (Tab/Enter);
    pratinjau no bukti; bisa print. Istilah & layout mengikuti kelaziman akuntansi Indonesia.
  - **DoD:** test validasi form (tidak seimbang tidak bisa simpan); smoke UI; audit tercatat.
  - **Dependency:** P0-4

- [ ] **P1-8 — Layar Buku Besar & Neraca Saldo**
  - **Langkah:** Buku Besar per akun dengan filter periode + saldo awal/berjalan/akhir; Neraca Saldo per
    cutoff; klik baris → daftar jurnal akun tersebut; klik jurnal → detail debit/kredit + no bukti.
  - **DoD:** test drill-down data; smoke UI.
  - **Dependency:** P0-5

- [ ] **P1-9 — Layar Laba Rugi, Neraca, Arus Kas**
  - **Langkah:** tampilkan dari mesin laporan P0-5; filter periode/cutoff; badge "Neraca Saldo: seimbang/
    selisih"; drill-down ke jurnal; format Rupiah & kurung untuk negatif.
  - **DoD:** test/smoke; angka sama dengan P0-5 untuk dataset contoh.
  - **Dependency:** P0-5

- [ ] **P1-10 — Export & print semua laporan (xlsx numerik + PDF)**
  - **Langkah:** builder xlsx untuk Jurnal Umum, Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Arus Kas,
    Panjar; **sel nominal = number + numFmt** `'"Rp"#,##0.00;(Rp"#,##0.00)'` (bukan string); persen = number;
    tombol Export + Print/Simpan PDF di tiap layar; kop & periode.
  - **DoD:** test: `typeof cell.value === 'number'`; total baris benar; file terbuka di Excel.
  - **Dependency:** P1-8, P1-9

- [ ] **P1-11 — Nomor bukti `JU` & pencarian jurnal**
  - **Langkah:** auto nomor **`JU-<tahun>-<urut>`** (K5; bisa diedit, wajib unik per tahun); pencarian
    jurnal by no bukti/keterangan/nominal/akun; filter tanggal + jenis; daftar jurnal dengan pagination.
    Catatan: `JU` = Jurnal Umum (lazim); jangan `JP` (ambigu). Alternatif `BKM/BKK` hanya jika pemilik
    ingin nomor per bukti kas — jangan campur dua skema.
  - **DoD:** test nomor unik & urut; smoke.
  - **Dependency:** P0-2

- [ ] **P1-12 — Validasi & UX lintas form**
  - **Langkah:** tanggal kalender (P0-4) dipakai di semua form & cutoff; tombol simpan disable saat proses
    (anti double-submit); peringatan kas minus konsisten; pesan error berbahasa Indonesia (tanpa `String(e)`
    mentah); konfirmasi sebelum aksi besar (tutup buku, restore, reversal).
  - **DoD:** test validasi; smoke double-click.
  - **Dependency:** P0-4

- [ ] **P1-13 — Pengaturan pembukuan**
  - **Langkah:** nama entitas & kop laporan, tanggal mulai pembukuan, awal tahun buku, format nomor bukti,
    idle lock & ganti PIN; semua perubahan masuk audit.
  - **DoD:** test simpan/baca pengaturan; kop export terpengaruh.
  - **Dependency:** P0-2

- [ ] **P1-14 — Dashboard akuntan**
  - **Langkah:** kartu: saldo kas & bank, laba/rugi tahun berjalan, status Neraca Saldo (selalu seimbang),
    periode terbuka/terkunci, jurnal terakhir, backup terakhir; pintasan ke form terpandu.
  - **DoD:** angka sama dengan laporan; smoke.
  - **Dependency:** P0-5

- [ ] **P1-15 — Hardening Electron ringan**
  - **Langkah:** `app.requestSingleInstanceLock()`; `setWindowOpenHandler` deny; CSP di `index.html`;
    pastikan dev & build tetap jalan.
  - **DoD:** dua instance tidak membuka window baru; `npm run build` hijau.
  - **Dependency:** —

- [ ] **P1-16 — Template cetak resmi & pratinjau**
  - **Konteks:** feedback WhatsApp: "bagaimana dengan layout print?". v1.2.0 mencetak HTML sederhana;
    perlu tata letak yang rapi dan cocok dengan dokumen resmi pura.
  - **Langkah:**
    1. Kumpulkan 2–3 contoh dokumen cetak resmi yang biasa dipakai pura (BKU, neraca, laporan) sebagai acuan.
    2. Atur tata letak: A4, portrait (buku besar boleh landscape), kop + periode + nomor halaman
       ("Halaman X dari Y"), tanggal cetak, kolom tidak terpotong, baris tidak terbelah antar halaman.
    3. Pratinjau sebelum cetak (bukan langsung `window.print()`); tombol Print/Simpan PDF konsisten.
    4. Uji dengan data seed bervolume (ratusan baris) agar pagination & header tabel berulang benar.
  - **DoD:** satu laporan contoh tercetak rapi di A4 + PDF; header tabel berulang di halaman berikutnya;
    tidak ada kolom terpotong.
  - **Dependency:** P1-10

---

## P2 — Lanjutan

- [ ] **P2-1 — Anggaran & Realisasi Anggaran**
  - **Langkah:** tabel `anggaran(tahun, akun_kode, nominal)`; CRUD; laporan realisasi vs pagu per akun
    (anggaran, realisasi, sisa, %); export; hanya akun PENDAPATAN/BEBAN.
  - **DoD:** test sisa/% + laporan; UI input per tahun.
  - **Dependency:** P1-10

- [ ] **P2-2 — Rekonsiliasi bank**
  - **Langkah:** input saldo menurut rekening koran per tanggal; bandingkan dengan saldo buku; tampilkan
    selisih + daftar jurnal di antara; tandai selesai + audit.
  - **DoD:** test perhitungan selisih.
  - **Dependency:** P0-5

- [ ] **P2-4 — Lampiran bukti jurnal**
  - **Langkah:** unggah foto/PDF kuitansi per jurnal (disimpan di `userData/attachments`, bukan di DB);
    tampil di detail jurnal; dokumentasikan bahwa lampiran TIDAK ikut backup `.db`.
  - **DoD:** test metadata; smoke.
  - **Dependency:** P0-2

- [ ] **P2-7 — Test integrasi IPC/main**
  - **Langkah:** ekstrak handler IPC jadi `registerIpc(deps)` yang bisa di-mock; uji alur create → reverse →
    tutup → backup → restore tanpa Electron runtime.
  - **DoD:** `tests/ipc-main.test.ts` hijau.
  - **Dependency:** P0-10

- [ ] **P2-8 — Dokumentasi pengguna & paket portable**
  - **Langkah:** SOP singkat berbahasa awam untuk operator (input harian, tutup bulan/tahun, backup,
    ganti laptop) + panduan pemeriksaan untuk akuntan pendamping (Jurnal Umum, Buku Besar, Neraca Saldo);
    glosarium debit/kredit; pastikan target `portable` menyimpan data di lokasi yang didokumentasikan.
  - **DoD:** dokumen cocok dengan perilaku build Windows.
  - **Dependency:** —

- [ ] **P2-9 — Import data massal dari Excel**
  - **Langkah:** template xlsx → validasi → buat jurnal; laporan hasil per baris (sukses/gagal + alasan);
    berguna untuk migrasi awal dari pembukuan lama.
  - **DoD:** test parser + pembuatan jurnal; tolak file tidak seimbang.
  - **Dependency:** P0-2

### Dibatalkan oleh keputusan pemilik (2026-10-04) — jangan dikerjakan

- [x] **P2-3 — Aset tetap & penyusutan.** Dibatalkan (K3: terlalu rumit/membingungkan). Modul Inventaris
      Aset yang sudah ada tetap sebagai daftar barang non-akuntansi dan tidak masuk laporan keuangan;
      boleh dihapus kapan saja tanpa memengaruhi pembukuan.
- [x] **P2-5 — Enkripsi DB & keamanan PIN lanjutan.** Dibatalkan (K4: PIN cukup, POC).
- [x] **P2-6 — Multi-user & peran.** Dibatalkan (K4).

---

## Keputusan pemilik (dijawab 2026-10-04)

- [x] **K1 — Operator utama:** orang awam (pengurus/suami), dengan istri (akuntan) sebagai pendamping/
      pemeriksa. Form terpandu jadi alur utama; istilah & alur akuntansi harus lumrah.
- [x] **K2 — Tutup tahun berjalan:** setuju hanya tahun yang sudah selesai (≤ tahun lalu).
- [x] **K3 — Aset tetap & penyusutan:** dibuang dari sistem.
- [x] **K4 — Multi-user & enkripsi:** tidak; PIN tunggal cukup.
- [x] **K5 — Nomor bukti:** `JU-2026-0001` (JU = Jurnal Umum). `JP` tidak dipakai karena ambigu
      (Jurnal Pembelian/Penjualan); `BKM/BKK` tersedia sebagai alternatif jika kelak ingin nomor per
      bukti kas, tapi jangan campur dua skema.
- [x] **K6 — Data lama:** dibuang; tidak ada migrasi (POC).

## Riwayat dokumen

- 2026-10-04: ditulis ulang total dari versi single-entry ke arah akuntansi double-entry.
- 2026-10-04 (revisi 2): keputusan K1–K6 dijawab. P0-3 diganti "reset POC tanpa migrasi"; P0-7 hanya
  tahun selesai; P0-10 fokus DB fresh; P1-11 nomor `JU-`; P2-3/P2-5/P2-6 dibatalkan.
- 2026-10-04 (revisi 3): feedback WhatsApp v1.2.0 dipetakan. P0-6 dapat alur "Koreksi & isi ulang";
  P1-3 jadi form "Pindah Dana" (contoh LPD → kas bendahara); P1-5 dapat alur beli/perbaikan kredit
  (D beban / K hutang, modal tidak tersentuh); P1-16 baru (template cetak resmi & pratinjau).
