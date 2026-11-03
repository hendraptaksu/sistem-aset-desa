# Tickets Perbaikan Hasil Audit Akuntansi, Database & UX — 2026-11-02

> Dibuat dari hasil audit menyeluruh sistem akuntansi, desain database, dan UX
> untuk Bendahara Pura & Akuntan Pendamping (2026-11-02).
> Fokus: **tiket-tiket kecil dan atomik yang bisa dikerjakan satu per satu oleh AI agent**.
>
> Prinsip yang wajib dijaga:
> - `jurnal` + `jurnal_baris` adalah satu-satunya sumber angka laporan.
> - Jangan pernah menyimpan saldo berjalan atau laba turunan di tabel lain.
> - Jurnal yang sudah tersimpan tidak boleh diedit/dihapus; koreksi selalu melalui `REVERSAL` + alasan.
> - Satu sesi = satu ticket. Jangan menggabungkan dua ticket dalam satu commit.
> - Setiap ticket wajib menyertakan regression test baru atau memperbarui test terkait.

---

## Cara Pakai (untuk AI Agent)

1. Baca **Konteks → File yang disentuh → Langkah → DoD** pada ticket yang dipilih.
2. Pilih ticket `[ ]` paling atas yang seluruh `Dependency`-nya sudah `[x]`.
3. **Reproduksi dulu**: tulis unit/integration test yang merah untuk bug, atau test baru untuk perilaku yang diminta, baru ubah implementasi.
4. Sebelum mengubah status ticket menjadi `[x]`, wajib jalankan dan pastikan hijau:
   ```bash
   npm run typecheck
   npx vitest run --pool=threads
   npm run build
   ```
5. Ubah `[ ]` menjadi `[x]` pada tabel **Ringkasan** dan pada heading detail ticket, lalu tambahkan baris `- **Bukti YYYY-MM-DD:** ...` berisi ringkasan perubahan + jumlah test yang lulus.
6. Buat commit terpisah per ticket, contoh: `fix(AUD2-01): teruskan daftar akun db ke laporan dan saldo awal`.

---

## Ringkasan Progress

| ID | Prioritas | Ukuran | Judul | Dependency | Status |
|---|---|---|---|---|---|
| AUD2-01 | P0 | S | Teruskan master akun DB (`listAkun`) ke Buku Besar, Kunci Periode, Saldo Awal, dan `hapusAkun` | — | [x] |
| AUD2-02 | P0 | S | Selaraskan `statusSaldoAwal` & izinkan Saldo Awal disusulkan sebelum tanggal jurnal pertama | — | [x] |
| AUD2-03 | P0 | M | Koreksi / batalkan pertanggungjawaban Panjar `CLOSED` (buka jalan buntu koreksi panjar) | — | [x] |
| AUD2-04 | P0 | S | Kunci akun kontrol subledger (`1040` & `2050`) dari Jurnal Umum manual + audit saldo `1040` | — | [x] |
| AUD2-05 | P0 | M | Rekonsiliasi riil saldo GL `2050` terhadap Pinjaman LPD & validasi Saldo Awal pinjaman `BERJALAN` | AUD2-04 | [x] |
| AUD2-06 | P0 | S | Guard cut-off Panjar `OPEN` lintas tahun pada Kunci Periode & peringatan tahun nota | — | [x] |
| AUD2-07 | P1 | S | Konsistensi wajib alasan peringatan ($\ge 5$ karakter) di semua jalur transaksi, panjar, pinjaman, dan reversal | — | [x] |
| AUD2-08 | P0 | S | Tolak nilai pecahan (`REAL`) pada `jurnal_baris` di trigger DB dan `auditIntegritas` | — | [x] |
| AUD2-09 | P1 | M | Rombak/rebuild seluruh 11 tabel aktif menjadi `STRICT` & bersihkan kolom warisan | AUD2-08 | [x] |
| AUD2-10 | P1 | S | Peringatan saldo negatif (debit > kredit) pada pembayaran `2060 HUTANG USAHA` | — | [x] |
| AUD2-11 | P1 | M | Ubah input & tampilan nominal ke Rupiah bulat (tanpa desimal sen `,00`) | — | [x] |
| AUD2-12 | P2 | S | Hapus tab redundan `Buku Pembantu` & perjelas label arah mutasi di `Buku Besar` | AUD2-01 | [x] |
| AUD2-13 | P1 | M | Tabel "Transaksi Terakhir" & tombol Koreksi cepat di halaman `Transaksi` harian | — | [ ] |
| AUD2-14 | P2 | S | Tampilkan sisa saldo `2060 HUTANG USAHA` secara langsung di form `Bayar Utang Usaha` | AUD2-10 | [ ] |
| AUD2-15 | P2 | S | Generator jadwal angsuran otomatis (bagi rata pokok & jatuh tempo bulanan) di `Pinjaman LPD` | — | [ ] |
| AUD2-16 | P2 | S | Petunjuk pembeda akun kembar (`5010`/`5060`, `5004`/`5062`, `4005`/`4006`) di form input | — | [ ] |

---

## Fase 1 — P0: Bug Fungsional & Integritas Akuntansi

- [x] **AUD2-01 — Teruskan master akun DB (`listAkun`) ke Buku Besar, Kunci Periode, Saldo Awal, dan `hapusAkun`** · P0 · S
  - **Konteks:**
    Saat operator menambahkan akun baru (`TAMBAHAN`, misal `5011`, `4043`, atau `1101`) lewat menu **Daftar Akun** lalu memposting transaksi dengan akun tersebut:
    1. `laporanBukuBesar()` di `src/db/laporan.ts:161` memanggil `bukuBesar(baris, akun, filter)` tanpa argumen ke-4 (`daftarAkun`). Akibatnya `bukuBesar()` memakai default `COA` statis dan melempar error `Akun 5011 pada jurnal tidak dikenal di COA` untuk seluruh akun.
    2. `previewTutupBuku()`, `tutupBuku()`, dan `hitungLabaDitahan()` di `src/db/tutup.ts:116,154,195`, `labaDitahan()` di `src/core/tutup.ts:149`, serta handler `tutup:list` di `src/main/ipc.ts:1271` memanggil `labaTahun()` tanpa `listAkun(db)`, sehingga menu **Kunci Periode** gagal dimuat/disimpan.
    3. Handler `saldo-awal:posting` di `src/main/ipc.ts:727` memanggil `buatJurnalSaldoAwal(bentuk.input)` tanpa `daftarAkun: listAkun(deps.db())`, sehingga akun bank/LPD kustom (`1100–1199`) lolos di pratinjau UI tetapi ditolak saat disimpan.
    4. `hapusAkun()` di `src/db/repository.ts:383-394` hanya memeriksa `jurnal_baris` dan `panjar_item`, belum memeriksa apakah akun dipakai di `panjar.akun_kas_sumber`, `pinjaman.akun_kas`, atau `pinjaman.akun_bunga`.
  - **File yang disentuh:**
    - `src/db/laporan.ts`
    - `src/core/tutup.ts`
    - `src/db/tutup.ts`
    - `src/main/ipc.ts`
    - `src/db/repository.ts`
  - **Langkah:**
    1. Di `src/db/laporan.ts:161`, teruskan `daftarAkun` sebagai argumen ke-4 pada `bukuBesar(..., daftarAkun)`.
    2. Di `src/core/tutup.ts:149`, tambahkan parameter opsional `daftarAkun: readonly Coa[] = COA` pada `labaDitahan(baris, tutup, daftarAkun)` dan teruskan ke `labaTahun(baris, tahun, daftarAkun)`.
    3. Di `src/db/tutup.ts`, ambil `const daftarAkun = listAkun(db)` pada `previewTutupBuku()` dan `tutupBuku()`, lalu teruskan ke `labaTahun` dan `hitungLabaDitahan`.
    4. Di `src/main/ipc.ts:1271` (`tutup:list`), teruskan `listAkun(deps.db())` ke `labaTahunJurnal(baris, tahun, daftarAkun)`.
    5. Di `src/main/ipc.ts:727` (`saldo-awal:posting`), teruskan `daftarAkun: listAkun(deps.db())` ke `buatJurnalSaldoAwal({ ...bentuk.input, daftarAkun: listAkun(deps.db()) })`.
    6. Di `src/db/repository.ts:383` (`hapusAkun`), tambahkan pengecekan referensi ke `panjar (akun_kas_sumber)` dan `pinjaman (akun_kas / akun_bunga)` agar menghasilkan pesan error ramah bahasa Indonesia sebelum `DELETE`.
  - **Test:**
    - Buat test yang menambah akun `5011` (BEBAN) dan `1101` (AKTIVA kas/bank), mengisi Saldo Awal dengan `1101`, memposting jurnal beban `5011`, lalu memastikan `laporanBukuBesar`, `previewTutupBuku`, `tutupBuku`, `tutup:list`, dan `hapusAkun` berjalan tanpa error.
  - **DoD:** Semua laporan, Kunci Periode, dan Wizard Saldo Awal mendukung penuh akun `TAMBAHAN` dari database.
  - **Bukti 2026-11-03:** `laporanBukuBesar()` meneruskan `daftarAkun` ke `bukuBesar()`; `labaDitahan()`/`labaTahun()`, adapter tutup buku, dan IPC `tutup:list` memakai `listAkun(db)`; `saldo-awal:posting` meneruskan master akun DB ke `buatJurnalSaldoAwal()`; `hapusAkun()` menolak referensi `panjar.akun_kas_sumber`, `pinjaman.akun_kas`, dan `pinjaman.akun_bunga` dengan pesan Indonesia. Regression test baru untuk akun `5011`/`1101`, Kunci Periode, dan referensi hapus. `npm run typecheck`, 1007 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

- [x] **AUD2-02 — Selaraskan `statusSaldoAwal` & izinkan Saldo Awal disusulkan sebelum tanggal jurnal pertama** · P0 · S
  - **Konteks:**
    Di `src/db/saldoAwal.ts:67-72`, `statusSaldoAwal(db)` mengembalikan `boleh: true` selama belum ada jurnal berjenis `SALDO_AWAL`. Namun jika bendahara pernah memilih *"Mulai tanpa saldo awal"* dan mencatat 1 transaksi harian, tombol **Wizard Saldo Awal** di UI tetap aktif menyala tetapi saat disimpan ditolak oleh `simpanSaldoAwal()` (`if (hitungJurnal(db) > 0)` di `src/db/saldoAwal.ts:102`).
  - **File yang disentuh:**
    - `src/db/saldoAwal.ts`
    - `src/renderer/components/TransaksiTab.tsx`
    - `tests/saldo-awal.test.ts` / `tests/db-04-saldo-awal-unik.test.ts`
  - **Langkah:**
    1. Di `src/db/saldoAwal.ts`, ubah aturan `simpanSaldoAwal()`:
       - Tolak bila `sudahAdaSaldoAwal(db)` sudah `true` (pesan: `'Saldo awal sudah pernah dibuat. Gunakan koreksi/jurnal biasa.'`).
       - Bila sudah ada jurnal lain di DB, periksa tanggal jurnal paling awal (`SELECT MIN(tanggal) AS awal FROM jurnal`). Jika `tanggalSaldoAwal > awal`, tolak dengan pesan jelas: `'Tanggal saldo awal (${tanggalSaldoAwal}) tidak boleh setelah transaksi paling awal (${awal}).'`.
       - Bila `tanggalSaldoAwal <= awal`, izinkan penyimpanan jurnal `SALDO_AWAL` dan set `KUNCI_AKUNTANSI_TANGGAL_MULAI` ke `tanggalSaldoAwal`.
    2. Pastikan `statusSaldoAwal(db)` mengembalikan field opsional `tanggalMaksimal?: string` (tanggal jurnal paling awal bila sudah ada jurnal) agar `SaldoAwalWizard` dapat membatasi input tanggal maksimal.
  - **Test:**
    - Skenario `OPENING_STATUS` (`docs/audit/repro-akuntansi-2026-11-02.ts:52-57`): setelah ada jurnal tanggal `2025-01-02`, simpan saldo awal tanggal `2025-01-01` berhasil; simpan saldo awal tanggal `2025-01-05` ditolak; simpan saldo awal kedua ditolak.
  - **DoD:** Tidak ada lagi tombol Wizard Saldo Awal yang aktif di UI tetapi gagal saat disimpan karena sudah ada 1 transaksi harian.
  - **Bukti 2026-11-03:** `simpanSaldoAwal()` kini menolak hanya bila `SALDO_AWAL` sudah ada, lalu membandingkan tanggal dengan `MIN(jurnal.tanggal)` di dalam transaksi yang sama; tanggal setelah jurnal pertama ditolak dengan pesan jelas, tanggal sama/lebih awal diterima dan menulis `KUNCI_AKUNTANSI_TANGGAL_MULAI`. `statusSaldoAwal()` mengembalikan `tanggalMaksimal`; `SaldoAwalWizard` memakai batas `max` tersebut, menjepit tanggal default, dan menonaktifkan simpan bila tanggal melewati batas. Guard saldo awal ikut memuat batas tanggal. Test baru mencakup skenario OPENING_STATUS (simpan `2025-01-01` setelah jurnal `2025-01-02` berhasil, tanggal `2025-01-05` ditolak, saldo awal kedua ditolak), status `tanggalMaksimal`, dan UI `max`. `npm run typecheck`, 1009 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

- [x] **AUD2-03 — Koreksi / batalkan pertanggungjawaban Panjar `CLOSED` (buka jalan buntu koreksi panjar)** · P0 · M
  - **Konteks:**
    Saat ini panjar yang sudah `CLOSED` tidak bisa dikoreksi dari mana pun: `reverseJurnal` memblokir jurnal panjar (`PESAN_REVERSAL_PANJAR` di `src/db/reversal.ts:56`), sedangkan `batalPanjarV2` menolak panjar `CLOSED` (`src/db/panjar.ts:575`). Jika bendahara salah menginput nota pertanggungjawaban, tidak ada jalan untuk memperbaiki.
  - **File yang disentuh:**
    - `src/db/panjar.ts`
    - `src/main/validation.ts`
    - `src/main/ipc.ts`
    - `src/preload/index.ts`
    - `src/renderer/lib/api.ts`
    - `src/renderer/components/PanjarTab.tsx`
  - **Langkah:**
    1. Di `src/db/panjar.ts`, tambahkan fungsi `batalkanPertanggungjawabanPanjar(db, input: { id: string; alasan: string; tanggalBatal?: string; konfirmasiPeringatan?: boolean; alasanPeringatan?: string })`:
       - Validasi panjar ada, berstatus `CLOSED`, punya `jurnal_close_id`, dan `alasan.trim().length >= 5`.
       - Susun jurnal balik (`rencanaReversal`) atas `jurnal_close_id` (default tanggal = `panjar.tanggal_close`).
       - Dalam satu transaksi DB: posting jurnal reversal, hapus baris `panjar_item` milik panjar tersebut (data lama disimpan lengkap di JSON `audit_log`), update baris `panjar` kembali menjadi `status = 'OPEN'`, `tanggal_close = NULL`, `jurnal_close_id = NULL`, dan tulis audit `PANJAR-BATAL-CLOSE`.
    2. Daftarkan channel IPC `panjar:batal-close` di `src/main/ipc.ts`, `src/preload/index.ts`, dan `src/renderer/lib/api.ts`.
    3. Di `src/renderer/components/PanjarTab.tsx`, pada baris daftar panjar berstatus `CLOSED`, tambahkan tombol **"Koreksi Pertanggungjawaban"** yang membuka modal konfirmasi beralasan ($\ge 5$ karakter), lalu setelah berhasil langsung memuat panjar tersebut ke form Pertanggungjawaban agar bendahara bisa mengisi ulang rincian nota yang benar.
  - **Test:**
    - Skenario `CLOSED_PANJAR_CORRECTION` (`docs/audit/repro-akuntansi-2026-11-02.ts:68-73`): serah panjar → close dengan akun salah `5003` → batalkan pertanggungjawaban dengan alasan → saldo `1040` kembali sebesar panjar & beban `5003` kembali 0 → close ulang dengan akun benar `5010` → lolos `auditIntegritas(db)`.
  - **DoD:** Panjar `CLOSED` yang salah input dapat dikoreksi dan dipertanggungjawabkan ulang secara atomik dengan jejak audit lengkap.
  - **Bukti 2026-11-03:** `batalkanPertanggungjawabanPanjar()` memvalidasi panjar `CLOSED` + `jurnal_close_id` + alasan ≥5 karakter, menyusun jurnal balik lewat `rencanaReversal` (default tanggal `tanggal_close`), lalu dalam satu transaksi memposting reversal, menghapus `panjar_item` (data lama lengkap di `audit_log`), mereset panjar menjadi `OPEN` dengan `tanggal_close`/`jurnal_close_id` NULL, dan menulis audit `PANJAR-BATAL-CLOSE`; jurnal close asli tetap utuh. Channel `panjar:batal-close` didaftarkan di IPC dengan validator `validasiBentukPembatalanPertanggungjawabanPanjar` dan API renderer (preload tetap memakai `ipcRenderer.invoke` generik). PanjarTab menampilkan tombol **Koreksi Pertanggungjawaban** pada baris `CLOSED`, modal alasan ≥5 karakter dengan konfirmasi peringatan, lalu memuat panjar tersebut kembali ke form pertanggungjawaban. Test regresi `CLOSED_PANJAR_CORRECTION` membuktikan saldo `1040` pulih, beban `5003` nol, item lama terhapus tetapi tercatat di audit, close ulang dengan `5010` berhasil, dan `auditIntegritas` lolos; ditambah test validasi, IPC, API, dan UI. `npm run typecheck`, 1015 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

- [x] **AUD2-04 — Kunci akun kontrol subledger (`1040` & `2050`) dari Jurnal Umum manual + audit saldo `1040`** · P0 · S
  - **Konteks:**
    Akun `1040 UANG PANJAR` dan `2050 HUTANG LAIN-LAIN` memiliki subledger (`panjar` dan `pinjaman`). Jika akuntan memposting jurnal manual `UMUM` langsung ke `1040` atau `2050`, saldo Buku Besar/Neraca akan berbeda (*split-brain*) dengan daftar di tab Buku Panjar dan Pinjaman LPD.
  - **File yang disentuh:**
    - `src/core/posting.ts`
    - `src/db/integritas.ts`
  - **Langkah:**
    1. Di `src/core/posting.ts` (`validasiJurnal`), jika `jenis === 'UMUM'` dan bukan `konteks.koreksiSaldoAwal`:
       - Tolak baris yang memakai `1040` dengan pesan: `'Akun 1040 UANG PANJAR adalah akun kontrol panjar dan tidak boleh diposting lewat Jurnal Umum. Gunakan menu Buku Panjar.'`.
       - Tolak baris yang memakai `2050` dengan pesan: `'Akun 2050 HUTANG LAIN-LAIN adalah akun kontrol pinjaman dan tidak boleh diposting lewat Jurnal Umum. Gunakan menu Pinjaman LPD (atau 2060 HUTANG USAHA untuk utang usaha).'`.
    2. Di `src/db/integritas.ts` (`auditIntegritas`), tambahkan pemeriksaan `REKONSILIASI_PANJAR_GL_SELISIH`:
       - Hitung saldo normal debit akun `1040` dari `jurnal_baris` (kredit pada `SALDO_AWAL` atau debit serah dikurangi kredit close/batal).
       - Bandingkan dengan `SUM(jumlah)` dari tabel `panjar` yang berstatus `OPEN` aktif (`jurnal_batal_id IS NULL`). Jika berbeda, laporkan temuan integritas.
  - **Test:**
    - Test `validasiJurnal` menolak `UMUM` dengan `1040` atau `2050`, tetapi tetap mengizinkan `PANJAR`, `HUTANG`, `SALDO_AWAL`, dan `REVERSAL`.
    - Test `auditIntegritas` mendeteksi selisih jika ada baris jurnal `1040` liar yang di-inject lewat SQL.
  - **DoD:** Saldo `1040` di Neraca selalu dijamin sama dengan daftar Panjar `OPEN`.
  - **Bukti 2026-11-03:** `validasiJurnal` menolak baris `1040`/`2050` pada jurnal `UMUM` (kecuali `konteks.koreksiSaldoAwal`) dengan pesan persis sesuai tiket, tanpa mengganggu jalur internal `PANJAR`/`HUTANG`/`SALDO_AWAL`/`REVERSAL`. `auditIntegritas` menghitung saldo normal debit `1040` dari `jurnal_baris` (termasuk `SALDO_AWAL`/reversal) dan membandingkannya dengan `SUM(jumlah)` panjar `OPEN` aktif (`jurnal_batal_id` kosong), lalu melaporkan `REKONSILIASI_PANJAR_GL_SELISIH` dengan detail saldo GL, total panjar, dan selisih; pemeriksaan dilewati untuk backup pra-v19 tanpa kolom batal. Test regresi baru mencakup penolakan UMUM `1040`/`2050`, izin jenis internal + koreksi saldo awal, deteksi baris `1040` liar lewat SQL, serta pengecualian panjar `CLOSED`/dibatalkan. `npm run typecheck`, 1019 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

- [x] **AUD2-05 — Rekonsiliasi riil saldo GL `2050` terhadap Pinjaman LPD & validasi Saldo Awal pinjaman `BERJALAN`** · P0 · M
  - **Konteks:**
    1. Di `src/core/pinjamanRekonsiliasi.ts:157-161`, pinjaman mode `BERJALAN` (`jurnal_pencairan_id === null`) menetapkan `glAwal = sisaPokokAwal` (menyalin dari header pinjaman, bukan membaca saldo `2050` dari jurnal `SALDO_AWAL`). Akibatnya, walaupun bendahara lupa mengisi `2050` di Saldo Awal, rekonsiliasi selalu menampilkan **"Cocok" (Selisih 0)** padahal Neraca `2050` minus!
    2. `simpanPinjamanLpd` mode `BERJALAN` di `src/db/pinjaman.ts:776` tidak memvalidasi apakah saldo kredit `2050` pada jurnal `SALDO_AWAL` mencukupi.
  - **File yang disentuh:**
    - `src/db/pinjaman.ts`
    - `src/core/pinjamanRekonsiliasi.ts`
    - `src/db/pinjamanRekonsiliasi.ts`
    - `src/db/integritas.ts`
  - **Langkah:**
    1. Di `src/db/pinjaman.ts` (`simpanPinjamanLpd` saat `mode === 'BERJALAN'`), periksa total kredit neto akun `2050` pada grup jurnal `SALDO_AWAL`. Hitung total `sisa_pokok_awal` dari semua pinjaman `BERJALAN` aktif yang sudah ada ditambah pinjaman baru. Jika melebihi saldo awal `2050`, tolak simpan dengan pesan jelas: `'Sisa pokok pinjaman berjalan (${formatRp(totalBerjalan)}) melebihi Saldo Awal akun 2050 HUTANG LAIN-LAIN (${formatRp(saldoAwal2050)}). Isi atau koreksi Saldo Awal 2050 terlebih dahulu.'`.
    2. Di `src/db/pinjamanRekonsiliasi.ts` dan `src/db/integritas.ts`, pastikan rekonsiliasi juga memeriksa apakah total seluruh saldo kredit neto akun `2050` di Buku Besar cocok dengan jumlah `outstanding` seluruh pinjaman aktif; jika saldo awal `2050` kurang dari total `sisa_pokok_awal` pinjaman berjalan, laporkan sebagai `REKONSILIASI_PINJAMAN_SELISIH`.
  - **Test:**
    - Buat pinjaman `BERJALAN` tanpa Saldo Awal `2050` → ditolak oleh `simpanPinjamanLpd`.
    - Jika dipaksa lewat `buatPinjaman` / SQL mentah tanpa Saldo Awal `2050`, `rekonsiliasiSemuaPinjaman` dan `auditIntegritas` melaporkan `cocok: false` (`REKONSILIASI_PINJAMAN_SELISIH`).
  - **DoD:** Pinjaman `BERJALAN` tidak bisa membuat akun `2050` di Neraca menjadi negatif atau selisih diam-diam.
  - **Bukti 2026-11-03:** `simpanPinjamanLpd` mode `BERJALAN` menghitung kredit neto `2050` dari grup jurnal `SALDO_AWAL` (kredit − debit, sehingga reversal mengurangi saldo) dan menolak simpan bila total `sisa_pokok_awal` seluruh pinjaman berjalan + pinjaman baru melebihi saldo tersebut, dengan pesan persis sesuai tiket. `hitungRekonsiliasiPinjaman` kini memakai alokasi kredit neto `2050` aktual untuk pinjaman berjalan, bukan menyalin `sisa_pokok_awal`; adapter membagi saldo pembukaan berurutan ke beberapa pinjaman berjalan sehingga pembayaran dan pinjaman lama tetap cocok. `rekonsiliasiSaldoAwal2050` dan `rekonsiliasiGl2050` memeriksa kecukupan saldo awal serta kredit neto `2050` Buku Besar terhadap outstanding seluruh pinjaman aktif (hanya kekurangan yang dilaporkan agar utang non-LPD tidak menjadi temuan palsu), dan `auditIntegritas` melaporkan `REKONSILIASI_PINJAMAN_SELISIH` termasuk saat saldo awal kurang. Test regresi mencakup penolakan tanpa `2050`, penolakan total melebihi saldo awal, alokasi beberapa pinjaman, pembayaran pokok, pemaksaan lewat `buatPinjaman`, arah debit `2050`, serta deteksi debit `2050` liar di tingkat agregat. `npm run typecheck`, 1028 test vitest, dan `npm run build` hijau.
  - **Dependency:** AUD2-04

- [x] **AUD2-06 — Guard cut-off Panjar `OPEN` lintas tahun pada Kunci Periode & peringatan tahun nota** · P0 · S
  - **Konteks:**
    Jika panjar diserahkan Desember 2025 dan belum dipertanggungjawabkan, `tutupBuku(db, 2025)` saat ini mengizinkan tahun 2025 dikunci begitu saja. Lalu saat dipertanggungjawabkan Januari 2026 (`PANJAR_CROSS_YEAR`), beban kegiatan 2025 menyeberang ke Laba Rugi 2026.
  - **File yang disentuh:**
    - `src/core/tutup.ts`
    - `src/db/tutup.ts`
    - `src/renderer/components/PanjarTab.tsx`
  - **Langkah:**
    1. Di `src/core/tutup.ts` (`KonteksValidasiTutup` & `validasiTutupBuku`), tambahkan `panjarOpenTahun?: ReadonlyArray<{ id: string; tanggal: string; penerima: string }>` dan tolak penguncian tahun `tahun` bila masih ada panjar `OPEN` (belum dipertanggungjawabkan & belum dibatalkan) dengan `tanggal <= '${tahun}-12-31'`. Berikan pesan jelas menyebut penerima dan tanggal panjar agar diselesaikan atau dibatalkan dulu.
    2. Di `src/db/tutup.ts`, query daftar panjar `OPEN` aktif dan masukkan ke konteks `validasiTutupBuku`.
    3. Di `src/renderer/components/PanjarTab.tsx`, pada form Pertanggungjawaban Panjar, tampilkan kotak peringatan kuning bila `tanggalClose` berada di tahun yang berbeda dengan `closeTarget.tanggal` atau berbeda tahun dengan `nota_tanggal` item: jelaskan bahwa beban akan masuk ke Laba Rugi tahun `tanggalClose`.
  - **Test:**
    - Test `previewTutupBuku` dan `tutupBuku` menolak tahun 2025 jika ada panjar `OPEN` tertanggal `2025-12-20`; setelah panjar di-close atau dibatalkan, `tutupBuku(2025)` berhasil.
  - **DoD:** Tahun buku tidak bisa dikunci selama masih ada uang panjar menggantung di tahun tersebut.
  - **Bukti 2026-11-03:** `KonteksValidasiTutup` menerima `panjarOpenTahun`; `validasiTutupBuku()` menolak kunci periode maupun tutup ulang tahun Y selama masih ada panjar OPEN aktif bertanggal <= 31 Des Y, dengan pesan yang menyebut penerima, tanggal, dan saran menyelesaikan/membatalkan panjar. `previewTutupBuku()` dan `tutupBuku()` membaca panjar OPEN aktif (`status = 'OPEN'` dan `jurnal_batal_id` kosong) lalu meneruskannya ke validasi. Form pertanggungjawaban `PanjarTab` menampilkan kotak kuning `PeringatanTahunPertanggungjawaban` bila tahun `tanggalClose` berbeda dari tahun panjar atau tanggal nota, dan menjelaskan beban akan masuk Laba Rugi tahun `tanggalClose`. Regression test mencakup penolakan preview/simpan 2025, keberhasilan setelah panjar di-close dan setelah dibatalkan, validasi murni lintas tahun, serta peringatan UI. `npm run typecheck`, 1035 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

- [x] **AUD2-07 — Konsistensi wajib alasan peringatan ($\ge 5$ karakter) di semua jalur transaksi, panjar, pinjaman, dan reversal** · P1 · S
  - **Konteks:**
    Beberapa jalur konfirmasi peringatan masih melewati kewajiban alasan minimal 5 karakter dari pengguna:
    - `PinjamanTab.tsx:379` mengirim hardcoded `alasanPeringatan: 'Konfirmasi operator'`.
    - `PanjarTab.tsx:835-855` (`submitOpen`) hanya menampilkan kotak "Ya, tetap serahkan" tanpa input alasan, dan `serahkanPanjar` (`src/db/panjar.ts:270`) tidak memasang `wajibAlasanPeringatan: true`.
    - `reverseJurnal` (`src/db/reversal.ts:167`) dan `batalPanjarV2` (`src/db/panjar.ts:640`) tidak meneruskan `alasan` sebagai `alasanPeringatan` dengan `wajibAlasanPeringatan: true`.
  - **File yang disentuh:**
    - `src/db/panjar.ts`
    - `src/db/reversal.ts`
    - `src/main/ipc.ts`
    - `src/renderer/components/PanjarTab.tsx`
    - `src/renderer/components/PinjamanTab.tsx`
  - **Langkah:**
    1. Di `src/db/panjar.ts` (`serahkanPanjar`), teruskan `alasanPeringatan` dan `wajibAlasanPeringatan: true` ke `postingJurnal`.
    2. Di `src/db/reversal.ts` (`reverseJurnal`) dan `src/db/panjar.ts` (`batalPanjarV2`), teruskan `alasan.trim()` sebagai `alasanPeringatan` dan `wajibAlasanPeringatan: true`.
    3. Di `src/renderer/components/PanjarTab.tsx` (form Serah Panjar) dan `src/renderer/components/PinjamanTab.tsx` (form Simpan Pinjaman), ganti kotak konfirmasi tanpa alasan menjadi `PeringatanModal` yang mewajibkan input alasan $\ge 5$ karakter.
  - **Test:**
    - Uji `panjar:create` dan `pinjaman:simpan` saat kas minus: konfirmasi tanpa `alasanPeringatan` $\ge 5$ karakter ditolak; dengan alasan valid tersimpan dan tercatat di `audit_log`.
  - **DoD:** Tidak ada lagi konfirmasi peringatan yang lolos tanpa alasan nyata dari pengguna.
  - **Bukti 2026-11-03:** `serahkanPanjar()` meneruskan `alasanPeringatan` + `wajibAlasanPeringatan: true` ke `postingJurnal` dan mencatat alasan di audit `PANJAR-OPEN`; `reverseJurnal()` dan `batalPanjarV2()` meneruskan `alasan.trim()` dengan kewajiban yang sama; `simpanPinjamanLpd()` ikut mewajibkan alasan pada peringatan posting. IPC `panjar:create` meneruskan `alasanPeringatan` dan mempertahankan `perluKonfirmasi` saat alasan kurang, sejalan dengan `pinjaman:simpan`. Form Serah Panjar dan Simpan Pinjaman kini memakai `PeringatanModal` yang mewajibkan alasan minimal 5 karakter (hardcoded `'Konfirmasi operator'` dihapus) dan meneruskannya sebagai `alasanPeringatan`. Regression test baru mencakup penolakan tanpa/pendek alasan, penyimpanan dengan alasan valid, jejak audit, serta propagasi opsi pada serah/reversal/batal panjar. `npm run typecheck`, 1040 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

---

## Fase 2 — P1: Ketahanan Skema Database (`STRICT` & Validasi Kewajiban)

- [x] **AUD2-08 — Tolak nilai pecahan (`REAL`) pada `jurnal_baris` di trigger DB dan `auditIntegritas`** · P0 · S
  - **Konteks:**
    Terbukti pada `docs/audit/repro-akuntansi-2026-11-02.ts:75-81` (`FRACTIONAL_SEN_SQL`), SQLite non-STRICT mengizinkan nilai pecahan seperti `0.5` sen masuk ke `jurnal_baris.debit`/`kredit` (`typeof = 'real'`), dan `auditIntegritas` menganggapnya valid (`auditOk: true`).
  - **File yang disentuh:**
    - `src/db/database.ts`
    - `src/db/integritas.ts`
  - **Langkah:**
    1. Di `src/db/database.ts` (`terapkanAturanV9`), perkuat `trg_jurnal_baris_satu_sisi_insert` dan `trg_jurnal_baris_satu_sisi_update` agar juga menolak `typeof(NEW.debit) <> 'integer' OR typeof(NEW.kredit) <> 'integer'` serta menolak `NEW.debit < 0 OR NEW.kredit < 0 OR (NEW.debit = 0 AND NEW.kredit = 0)`.
    2. Di `src/db/integritas.ts`, perluas query pemeriksaan baris jurnal agar mendeteksi `typeof(debit) <> 'integer' OR typeof(kredit) <> 'integer'` dan melaporkannya pada temuan integritas.
  - **Test:**
    - Jalankan skenario `FRACTIONAL_SEN_SQL`: insert `0.5` langsung ditolak trigger DB; bila trigger dimatikan saat insert lalu dijalankan `auditIntegritas(db)`, menghasilkan `ok: false`.
  - **DoD:** Nilai pecahan sen tidak pernah bisa masuk atau lolos audit integritas.
  - **Bukti 2026-11-03:** `terapkanAturanV9` membuat ulang `trg_jurnal_baris_satu_sisi_insert`/`_update` dengan penolakan `typeof(NEW.debit)`/`typeof(NEW.kredit) <> 'integer'`, nilai negatif, dan dua sisi nol; aturan satu sisi tetap berlaku dan body baru otomatis diterapkan ke DB existing lewat migrasi. `auditIntegritas` menambah temuan `BARIS_NILAI_PECAHAN` beserta tipe `typeof`/nilai mentah. Regression test baru mencakup jalur insert, update, audit saat trigger dilewati, dan migrasi DB existing. `npm run typecheck`, 1044 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

- [x] **AUD2-09 — Rombak/rebuild seluruh 11 tabel aktif menjadi `STRICT` & bersihkan kolom warisan** · P1 · M
  - **Konteks:**
    Aplikasi belum di production dan semua data masih dummy. Saat ini ke-11 tabel aktif di `src/db/database.ts` belum memakai `STRICT` (`docs/erd-v2.md:43`), `tutup_buku` masih menyimpan kolom warisan `backup_path`, dan `panjar.status` masih `CHECK (status IN ('OPEN', 'CLOSED'))`.
  - **File yang disentuh:**
    - `src/db/database.ts`
    - `src/db/panjar.ts`
    - `docs/erd-v2.md`
    - `tests/erd-v2.test.ts`
  - **Langkah:**
    1. Tambahkan `STRICT` pada definisi DDL seluruh 11 tabel aktif (`akun`, `jurnal`, `jurnal_baris`, `tutup_buku`, `audit_log`, `pengaturan`, `panjar`, `panjar_item`, `pinjaman`, `pinjaman_angsuran`, `pinjaman_bayar`) dan sediakan migrasi kenaikan `SCHEMA_VERSION` yang me-rebuild tabel non-STRICT menjadi `STRICT` dengan aman.
    2. Izinkan `'DIBATALKAN'` secara resmi di `CHECK (status IN ('OPEN', 'CLOSED', 'DIBATALKAN'))` pada tabel `panjar`, dan tulis `status = 'DIBATALKAN'` saat `batalPanjarV2`.
    3. Bersihkan kolom warisan `tutup_buku.backup_path` dan perbarui kontrak dokumentasi di `docs/erd-v2.md` serta `tests/erd-v2.test.ts`.
  - **Test:**
    - Pastikan `pragma table_list` menunjukkan `strict = 1` untuk seluruh 11 tabel aktif pada `openDb(':memory:')` maupun DB hasil migrasi, dan `tests/erd-v2.test.ts` hijau.
  - **DoD:** Seluruh 11 tabel database aktif berstatus `STRICT` dan cocok 100% dengan `docs/erd-v2.md`.
  - **Bukti 2026-11-03:** Seluruh 11 tabel aktif kini `STRICT` di DDL baru dan pada DB hasil migrasi; `SCHEMA_VERSION` naik ke 23 dengan migrasi rebuild atomik (`foreign_keys` dimatikan sementara, tabel baru -> salin kolom -> drop lama -> rename, fallback bentuk legacy tanpa kehilangan kolom), index/trigger dipasang ulang, dan helper `pastikanTabelAktifStrict()` memverifikasi kontrak. `tutup_buku.backup_path` dihapus dari DDL/migrasi; CHECK `panjar.status` menerima `DIBATALKAN`, `batalPanjarV2` menulis status tersebut, baris legacy dinormalisasi, serta filter/audit/UI disesuaikan. `docs/erd-v2.md` dan test kontrak diperbarui. Regression test baru mencakup DB v22 non-STRICT (seluruh data 11 tabel, index, trigger, FK), DB versi lama tanpa tabel pinjaman, dan `openDb(':memory:')`. `npm run typecheck`, 1048 test vitest, dan `npm run build` hijau.
  - **Dependency:** AUD2-08

- [x] **AUD2-10 — Peringatan saldo negatif (debit > kredit) pada pembayaran `2060 HUTANG USAHA`** · P1 · S
  - **Konteks:**
    Saat ini `validasiJurnal` (`src/core/posting.ts:385`) hanya memeriksa saldo minus untuk akun kas/bank (`is_kas = 1`). Jika bendahara memilih **Bayar Utang Usaha** (`D 2060 / K Kas`) dengan nominal lebih besar daripada saldo Utang Usaha (`2060`) yang tercatat (atau belum pernah mencatat utang sama sekali), sistem menyimpan tanpa peringatan sehingga kewajiban `2060` di Neraca menjadi negatif.
  - **File yang disentuh:**
    - `src/core/posting.ts`
    - `src/db/posting.ts`
  - **Langkah:**
    1. Di `src/core/posting.ts` (`PostingContext`), tambahkan field opsional `saldoHutangUsaha?: number` (saldo normal kredit `2060` pada tanggal jurnal, yaitu `SUM(kredit - debit)`).
    2. Di `src/db/posting.ts` (`buatKonteksPosting`), hitung saldo normal kredit `2060` s/d tanggal jurnal.
    3. Di `src/core/posting.ts` (`validasiJurnal`), jika jurnal mendebit `2060` sehingga `saldoHutangUsaha + deltaKredit2060 < 0`, tambahkan peringatan ke `peringatan`: `'Utang Usaha (2060) akan menjadi minus ${formatRp(-saldoAkhir)}. Pastikan utang sudah dicatat lewat Catat Utang Usaha sebelum dibayar.'`.
  - **Test:**
    - Test `postingJurnal` untuk `Bayar Utang Usaha` saat saldo `2060` = 0 menghasilkan `perluKonfirmasi: true` dengan peringatan minus; bila saldo `2060` mencukupi, langsung tersimpan tanpa peringatan.
  - **DoD:** Bendahara langsung diperingatkan jika membayar utang usaha melebihi utang yang tercatat.
  - **Bukti 2026-11-03:** `PostingContext` kini menerima `saldoHutangUsaha` (saldo normal kredit 2060 s.d. tanggal jurnal, `SUM(kredit - debit)`); `buatKonteksPosting` mengisinya dengan cutoff tanggal yang sama seperti saldo kas dan belum menghitung jurnal yang sedang divalidasi. `validasiJurnal` menambahkan peringatan (bukan error) bila delta 2060 membuat saldo akhir negatif: `Utang Usaha (2060) akan menjadi minus <nominal>. Pastikan utang sudah dicatat lewat Catat Utang Usaha sebelum dibayar.`; seluruh jalur HUTANG/UMUM memakai konteks ini dan peringatan kas minus tetap berjalan. Regression test di `tests/utang-usaha.test.ts` mencakup saldo 2060 nol, saldo cukup, kelebihan bayar sebagian, dan cutoff tanggal; test rekonsiliasi pinjaman yang sengaja memakai akun salah disesuaikan dengan konfirmasi peringatan. `npm run typecheck`, 1052 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

---

## Fase 3 — P2: Penyederhanaan Fitur & UX Anti-Salah-Input bagi Bendahara Pura

- [x] **AUD2-11 — Ubah input & tampilan nominal ke Rupiah bulat (tanpa desimal sen `,00`)** · P1 · M
  - **Konteks:**
    Transaksi pura tidak pernah memakai pecahan sen. Saat ini `CurrencyInput` (`src/renderer/components/ui.tsx:230`) memakai `inputMode="decimal"` yang berisiko fatal: mengetik `100,000` dengan koma dibaca sebagai `Rp 100,00` (seratus rupiah). Selain itu, akhiran `,00` di `formatRp` (`src/utils/format.ts:5`) memenuhi seluruh tabel laporan.
  - **File yang disentuh:**
    - `src/utils/format.ts`
    - `src/renderer/components/ui.tsx`
    - Test terkait format Rupiah (`tests/format.test.ts`, dll.)
  - **Langkah:**
    1. Di `src/utils/format.ts`:
       - Ubah `formatRp(sen)` agar menampilkan desimal **hanya bila `Math.abs(sen) % 100 !== 0`** (contoh: `15000000` sen → `'Rp 150.000'`, `-15000000` sen → `'(Rp 150.000)'`). Dengan begitu semua angka Rupiah bulat tampil bersih tanpa `,00`, tetapi data pecahan bila ada tetap tidak tersembunyi.
    2. Di `src/renderer/components/ui.tsx` (`CurrencyInput`):
       - Ubah `inputMode` menjadi `"numeric"`.
       - Saat pengguna mengetik, format tampilan otomatis dengan pemisah ribuan titik Indonesia (`150.000`) dan konversi ke integer sen (`rupiah * 100`) untuk dikirim ke `onChange`.
  - **Test:**
    - Perbarui unit test `formatRp` dan `CurrencyInput` agar menguji format Rupiah bulat (`Rp 150.000`) dan memastikan ketikan angka bulat tetap menghasilkan nilai sen (`* 100`) yang akurat.
  - **DoD:** Input angka mudah dibaca dengan titik ribuan otomatis dan laporan bebas dari deretan `,00` yang membingungkan.
  - **Bukti 2026-11-03:** `formatRp()` hanya menampilkan desimal bila `Math.abs(sen) % 100 !== 0` — nominal bulat menjadi `Rp 150.000` dan negatif `(Rp 150.000)`, pecahan sen tetap `Rp 150.000,50`. `CurrencyInput` memakai `inputMode="numeric"`, memformat titik ribuan saat mengetik, dan membaca digit saja sebagai rupiah utuh ×100 ke sen, sehingga paste `100,000` menjadi Rp 100.000 (bukan Rp 100). Test baru `tests/currency-input.test.ts` serta pembaruan ekspektasi format di test laporan, print, jurnal, dan validasi. `npm run typecheck`, 1060 test vitest, dan `npm run build` hijau.
  - **Dependency:** —

- [x] **AUD2-12 — Hapus tab redundan `Buku Pembantu` & perjelas label arah mutasi di `Buku Besar`** · P2 · S
  - **Konteks:**
    Tab `Buku Pembantu` (`src/renderer/components/PembantuTab.tsx`) menampilkan data yang 100% sama dengan `Buku Besar`, tetapi tidak memiliki fitur *drill-down* klik baris jurnal dan tidak menampilkan nomor bukti. Keberadaan dua menu untuk hal yang sama membingungkan bendahara dan akuntan.
  - **File yang disentuh:**
    - `src/renderer/App.tsx`
    - `src/renderer/lib/modeLanjutan.ts`
    - `src/renderer/components/BukuBesarTab.tsx`
    - `src/renderer/components/PembantuTab.tsx`
  - **Langkah:**
    1. Hapus item `'pembantu'` dari `TABS` dan `GRUP_MENU` di `src/renderer/App.tsx` (serta daftar menu di `modeLanjutan.ts` bila ada).
    2. Di `src/renderer/components/BukuBesarTab.tsx`, tambahkan sub-label ramah awam pada header kolom tabel mutasi sesuai `data.posisi_normal`:
       - Jika `posisi_normal === 'DEBIT'` (misal Kas/Bank/Beban): `Debit (+ / Masuk)` dan `Kredit (- / Keluar)`.
       - Jika `posisi_normal === 'KREDIT'` (misal Pendapatan/Hutang/Modal): `Debit (- / Berkurang)` dan `Kredit (+ / Bertambah)`.
  - **Test:**
    - Perbarui test navigasi sidebar (`App.tsx`) dan pastikan `BukuBesarTab` menampilkan keterangan arah mutasi yang jelas.
  - **DoD:** Menu sidebar lebih ramping dan `Buku Besar` mudah dipahami baik oleh bendahara awam maupun akuntan.
  - **Bukti 2026-11-03:** Tab `pembantu` dihapus dari `TabId`, `TABS`, `GRUP_MENU`, render `App.tsx`, dan `PembantuTab.tsx` (file mati tanpa referensi tersisa); daftar tab e2e menyusut menjadi 13 dan test sidebar diperbarui. `BukuBesarTab` menampilkan header mutasi dengan istilah Debit/Kredit plus sub-label arah sesuai `posisi_normal`: Debit `(+ / Masuk)` / Kredit `(- / Keluar)` untuk akun normal debit, serta Debit `(- / Berkurang)` / Kredit `(+ / Bertambah)` untuk akun normal kredit; drill-down jurnal asal tetap dipertahankan. Regression test `tests/aud2-12-buku-pembantu.test.ts` mencakup penghapusan navigasi/file, daftar tab e2e, dan kedua arah mutasi. `npm run typecheck`, 1066 test vitest, dan `npm run build` hijau.
  - **Dependency:** AUD2-01

- [ ] **AUD2-13 — Tabel "Transaksi Terakhir" & tombol Koreksi cepat di halaman `Transaksi` harian** · P1 · M
  - **Konteks:**
    Karena menu `Jurnal Umum` disembunyikan di balik `Mode Lanjutan`, bendahara harian yang baru saja menyimpan `Terima Uang`, `Bayar`, `Pindah Dana`, atau `Utang Usaha` tidak bisa melihat daftar transaksi yang baru dicatatnya dan tidak bisa langsung mengoreksi jika salah ketik nominal/keterangan.
  - **File yang disentuh:**
    - `src/renderer/components/TransaksiTab.tsx`
    - `src/renderer/components/TransaksiForm.tsx`
  - **Langkah:**
    1. Di bagian bawah `src/renderer/components/TransaksiTab.tsx`, tambahkan kartu **"Transaksi Terakhir yang Dicatat"** yang memuat 10 jurnal terbaru (`api.jurnalCari({ limit: 10, offset: 0 })`) dan otomatis di-refresh setiap kali `FormTransaksiTerpandu` atau `SaldoAwalWizard` selesai menyimpan.
    2. Tampilkan kolom: `Tanggal`, `No. Bukti`, `Jenis`, `Keterangan`, `Nominal`, `Status`, serta tombol **"Lihat"** (`DetailJurnalModal`) dan **"Batalkan / Salah Input"** (untuk jurnal aktif yang bukan panjar/pinjaman).
    3. Saat **"Batalkan / Salah Input"** diklik, buka modal sederhana yang meminta alasan ($\ge 5$ karakter) lalu memanggil `api.jurnalReverse(jurnal.id, alasan)`.
  - **Test:**
    - Test `TransaksiTab` menampilkan transaksi yang baru disimpan dan mengizinkan pembatalan jurnal dengan alasan tanpa harus membuka Mode Lanjutan.
  - **DoD:** Bendahara dapat langsung memeriksa dan membatalkan salah ketik harian dari halaman `Transaksi`.
  - **Dependency:** —

- [ ] **AUD2-14 — Tampilkan sisa saldo `2060 HUTANG USAHA` secara langsung di form `Bayar Utang Usaha`** · P2 · S
  - **Konteks:**
    Saat bendahara membuka kartu **Bayar Utang** (`BAYAR_UTANG` di `src/renderer/components/TransaksiForm.tsx`), ia tidak tahu berapa saldo Utang Usaha (`2060`) yang masih belum dibayar tanpa berpindah ke tab Neraca atau Buku Besar.
  - **File yang disentuh:**
    - `src/renderer/components/TransaksiForm.tsx`
  - **Langkah:**
    1. Saat `jenis === 'BAYAR_UTANG'` di `FormTransaksiTerpandu`, panggil `api.laporanBukuBesar({ akun_kode: '2060', sampai: tanggal })` untuk membaca `saldoAkhir` akun `2060 HUTANG USAHA`.
    2. Tampilkan info box di atas form: **"Sisa Utang Usaha (2060) saat ini: Rp ..."** beserta tombol kecil **"Isi sesuai sisa utang"** (jika `saldoAkhir > 0`) yang langsung mengisi field `Nominal` sebesar saldo tersebut.
  - **Test:**
    - Test komponen `FormTransaksiTerpandu` mode `BAYAR_UTANG` menampilkan saldo `2060` dan tombol pengisi nominal otomatis.
  - **DoD:** Bendahara langsung melihat sisa utang usaha saat hendak melunasi dan tidak salah ketik nominal pelunasan.
  - **Dependency:** AUD2-10

- [ ] **AUD2-15 — Generator jadwal angsuran otomatis (bagi rata pokok & jatuh tempo bulanan) di `Pinjaman LPD`** · P2 · S
  - **Konteks:**
    Pada `src/renderer/components/PinjamanTab.tsx:848-938`, jadwal angsuran harus ditambah satu per satu secara manual. Untuk pinjaman tenor 24–60 bulan, cara ini sangat melelahkan dan rawan salah pilih tanggal jatuh tempo.
  - **File yang disentuh:**
    - `src/renderer/components/PinjamanTab.tsx`
  - **Langkah:**
    1. Tambahkan input bantu opsional **"Bunga rencana per bulan (Rp)"** dan tombol **"Isi Jadwal Otomatis dari Tenor"** pada bagian Jadwal Angsuran di `PinjamanTab.tsx`.
    2. Saat tombol diklik (aktif bila `targetPokok > 0` dan `tenor >= 1`):
       - Buat `N = tenor` baris jadwal (`ke = 1..N`).
       - Tanggal jatuh tempo baris `ke` = `tanggal` mulai ditambah `ke` bulan (gunakan perhitungan tanggal UTC yang aman terhadap akhir bulan, misal 31 Jan → 28/29 Feb).
       - Pokok per baris = `Math.floor((targetPokok / N) / 100) * 100` (dibulatkan ke Rupiah penuh), dan baris terakhir (`ke = N`) menerima sisa pokok `targetPokok - pokokBaris * (N - 1)` agar total pokok jadwal selalu 100% cocok dengan `targetPokok`.
       - Semua baris yang dihasilkan tetap bisa diedit manual oleh bendahara sebelum klik Simpan.
  - **Test:**
    - Test fungsi generator jadwal untuk pokok Rp 10.000.000 dengan tenor 3 bulan menghasilkan `[3.333.333, 3.333.333, 3.333.334]` (dalam sen) yang totalnya tepat Rp 10.000.000 dan tanggal jatuh tempo berurutan per bulan.
  - **DoD:** Bendahara cukup 1 klik untuk membuat jadwal angsuran puluhan bulan yang total pokoknya langsung valid.
  - **Dependency:** —

- [ ] **AUD2-16 — Petunjuk pembeda akun kembar (`5010`/`5060`, `5004`/`5062`, `4005`/`4006`) di form input** · P2 · S
  - **Konteks:**
    Karena `KODE AKUN.csv` menyimpan akun lama sekaligus akun tambahan baru yang mirip (`5010` vs `5060` untuk listrik/air/telepon, `5004` vs `5062` untuk upakara/banten, `4005` vs `4006` untuk parkir), bendahara rawan tidak konsisten saat memilih akun di dropdown.
  - **File yang disentuh:**
    - `src/renderer/components/TransaksiForm.tsx`
    - `src/renderer/components/PanjarTab.tsx`
  - **Langkah:**
    1. Buat helper panduan singkat untuk akun-akun yang memiliki pasangan mirip (`5010`, `5060`, `5004`, `5062`, `5003`, `5031`, `4005`, `4006`, `4008`, `4041`, `4060`).
    2. Tampilkan teks bantu kontekstual di bawah dropdown akun lawan pada `TransaksiForm.tsx` dan `PanjarTab.tsx` saat salah satu akun tersebut dipilih (contoh: saat memilih `5010`, tampilkan info *"Tips: Jika untuk tagihan rutin operasional air/listrik/telepon, periksa apakah pura memakai 5010 atau 5060 agar konsisten setiap bulan"*).
  - **Test:**
    - Test `TransaksiForm` menampilkan petunjuk kontekstual ketika akun yang memiliki kembaran dipilih.
  - **DoD:** Risiko salah pilih akun yang mirip oleh bendahara berkurang drastis tanpa merusak arsip COA client.
  - **Dependency:** —
