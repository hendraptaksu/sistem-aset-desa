# Tiket Perbaikan Akuntansi — Hasil Audit 2026-11-10

**Status:** usulan, belum dikerjakan  
**Baseline:** `npm test` 92 file / 1.216 test lulus; `npm run typecheck` lulus.  
**Konteks:** belum ada data produksi; masih development. Perubahan skema — termasuk
reset DB dev dan `SCHEMA_VERSION` baru — **diperbolehkan** bila itu model terbaik.  
**Cara pakai:** kerjakan satu tiket kecil, tambahkan test regresi, baru centang `[x]`.  
**Lokasi:** root repo. Hapus file ini setelah semua tiket selesai agar tidak menjadi context rot.

> Audit ini tidak mengubah kode produksi. Yang salah bukan skema inti `jurnal` +
> `jurnal_baris`; yang perlu diperbaiki adalah sumber makna cut-over, invariant
> koreksi, penjagaan jurnal pembukaan, dan kontrol laporan/tutup buku.

## Ringkasan prioritas

| Prioritas | Arti | Tiket |
| --- | --- | --- |
| **P0** | Model/skema salah, laporan salah, atau jalur pemulihan hilang | T-A00, T-A01, T-A02, T-A03 |
| **P1** | Celah kontrol yang bisa menghasilkan data salah / memblokir koreksi | T-A04–T-A11 |
| **P2** | Hardening, dokumentasi, dan visibilitas | T-A12, T-A14–T-A16 |

## Peta temuan audit → tiket

| Temuan | Tiket |
| --- | --- |
| Cut-over: Laba Rugi 0, Neraca selisih, dashboard `BALANCE` palsu | T-A01, T-A07, T-A08 |
| Koreksi bisa mengganti jenis jurnal (mis. `BAYAR` → `PANJAR`) | T-A02 |
| Jurnal pengganti saldo awal bisa dibalik lewat reversal generik | T-A03 |
| Akun nonaktif memblokir reversal jurnal historis | T-A04 |
| `postingSaldoAwal` menerima akun P&L bila dipanggil langsung | T-A05 |
| Tutup buku hanya penanda; tidak ada snapshot angka yang disahkan | T-A06 |
| Audit integritas tidak memeriksa Neraca/Neraca Saldo | T-A07 |
| Dashboard memakai trial balance untuk `balance`, Neraca untuk `aktiva`/`pasiva` | T-A08 |
| `tautkanPembayaran` tidak menulis audit dan menerima tanggal lepas dari jurnal | T-A09 |
| Reversal bisa bertanggal sebelum jurnal asli | T-A10 |
| Saldo awal 1040 tidak bisa direkonsiliasi dengan panjar OPEN | T-A11 |
| Jadwal angsuran bisa jatuh tempo sebelum tanggal mulai; baris nol otomatis `LUNAS` | T-A12 |
| Tidak ada peran/relasi eksplisit untuk jurnal pengganti | T-A00 |
| Tutup buku tidak punya tabel snapshot resmi | T-A00, T-A06 |
| Panjar OPEN saat cut-over tidak punya model | T-A00, T-A11 |
| `insertJurnalTervalidasi` masih menjadi pintu tulis kedua | T-A14 |
| Dokumen akuntansi masih menjelaskan perilaku lama | T-A15 |
| Audit saat mulai hanya menulis log, tidak terlihat operator | T-A16 |

## Aturan kerja

- Satu tiket = satu perubahan yang bisa diuji sendiri. Jangan campur refactor besar.
- Jangan menandai `[x]` sebelum test regresi tiket itu lulus dan `npm run typecheck` lulus.
- Setiap tiket wajib menyebut file yang disentuh dan cara verifikasinya.
- Jangan mengubah logika akuntansi di `src/core/` tanpa test yang menjelaskan alasannya.
- Perubahan skema **boleh dan dianjurkan** bila model lama memaksa workaround.
  Karena belum ada data produksi: naikkan `SCHEMA_VERSION`, perbarui
  `TABEL_AKTIF`/`KOLOM_WAJIB`/DDL/trigger, lalu reset DB dev atau sediakan
  migrasi dev satu kali. Jangan menambah tabel/kolom ke v1 secara diam-diam.
- Setiap perubahan skema wajib disertai backup DB dev dan catatan cara reset di
  commit/PR; tidak perlu menjaga kompatibilitas DB produksi.
- Urutan P0 disarankan berurutan: T-A00 (skema/model) lebih dulu, lalu
  T-A01/T-A02/T-A03 yang memakai `peran`, `replaces_id`, dan penunjuk cut-over.
  T-A01 juga menyentuh mesin laporan yang dipakai tiket lain.
- Setelah selesai: catat commit di tiket, lalu pastikan `git status` bersih.

---

## P0 — Salah angka / kehilangan jalur pemulihan

### [x] T-A00 — Skema v2: model domain eksplisit

| | |
| --- | --- |
| **Prioritas** | P0 |
| **Perkiraan** | L |
| **Depends** | — |
| **Status** | Selesai — commit b97006d |

**Masalah**

Sistem menyimpulkan peran jurnal dari kombinasi `jenis`, `grup_id`,
`reversal_of`, tanggal, dan `pengaturan`. Tidak ada relasi eksplisit “jurnal
ini menggantikan jurnal X”, tidak ada peran `OPENING_REPLACEMENT`, cut-over
disimpulkan dari `MIN(SALDO_AWAL)`, dan tutup buku tidak punya tabel snapshot.
Ini akar dari T-A01/T-A02/T-A03/T-A06/T-A11.

**Keputusan**

Karena belum ada data produksi, **jangan** mempertahankan workaround seperti
menyimpan snapshot di `audit_log` atau menebak cut-over dari tanggal
`SALDO_AWAL`. Naikkan `SCHEMA_VERSION` ke **2** dan benahi model sekarang.
Tidak perlu menjaga kompatibilitas DB produksi; DB dev boleh di-reset.

**Perubahan skema yang diusulkan**

1. **`jurnal.peran`** — `TEXT NOT NULL DEFAULT 'NORMAL'` dengan `CHECK`:
   - `NORMAL`
   - `OPENING`
   - `OPENING_REPLACEMENT`
   - `ADJUSTMENT`

   `jenis` tetap menjadi jenis dokumen (`TERIMA`/`BAYAR`/`PANJAR`/`HUTANG`/
   `UMUM`/`SALDO_AWAL`/`REVERSAL`). `peran` menjawab “jurnal ini apa dalam
   siklus hidup pembukuan”, bukan “dokumennya apa”.

2. **`jurnal.replaces_id`** — `TEXT NULL REFERENCES jurnal(id)`, dengan
   `UNIQUE(replaces_id)` agar satu jurnal hanya digantikan sekali.
   - Jurnal koreksi biasa menunjuk jurnal yang digantikan.
   - Reversal tetap memakai `reversal_of`.
   - Rantai koreksi menjadi eksplisit, tidak lagi ditebak dari `grup_id`.

3. **Penunjuk pembukaan/cut-over resmi** — tambah di `pengaturan`:
   - `saldo_awal_aktif_id` (ID jurnal pembukaan aktif), dan
   - `cutover_tanggal` (tanggal mulai pembukuan efektif).

   Rekomendasi: pakai dua kunci ini; jangan menambah tabel pembukaan terpisah.
   Keduanya harus diperbarui atomik oleh wizard koreksi saldo awal. Laporan
   membaca penunjuk ini, bukan `MIN(tanggal)`.

4. **`tutup_buku_snapshot`** — tabel append-only:
   - `id INTEGER PRIMARY KEY AUTOINCREMENT`
   - `tahun INTEGER NOT NULL`
   - `versi INTEGER NOT NULL`
   - `laba`, `total_aset`, `total_kewajiban`, `total_ekuitas`, `total_pasiva`,
     `selisih` (INTEGER sen)
   - `hash_jurnal TEXT NOT NULL`
   - `created_at TEXT NOT NULL`
   - `UNIQUE(tahun, versi)`

   Trigger melarang `UPDATE`/`DELETE`. Snapshot baru pada `TUTUP-ULANG`
   mendapat `versi` berikutnya; snapshot lama tidak ditimpa.

5. **Panjar opening** — tambah `panjar.sumber` (`NORMAL`/`SALDO_AWAL`) dan
   longgarkan `jurnal_open_id` hanya untuk `sumber = 'SALDO_AWAL'` (detail
   implementasi di T-A11). Jangan mengecualikan `SALDO_AWAL` dari rekonsiliasi
   tanpa memodelkannya.

6. **Backstop invariant di DB** (trigger/CHECK), minimal:
   - `replaces_id` tidak boleh menunjuk diri sendiri;
   - `OPENING_REPLACEMENT` wajib punya `replaces_id` dan `jenis = 'UMUM'`;
   - `replaces_id` hanya boleh untuk jurnal dengan `peran` yang sah;
   - snapshot tutup buku immutable.

**Kebijakan reset/migrasi DB dev**

- **Opsi A (disarankan):** DB v1 ditolak saat dibuka dengan pesan yang jelas:
  “DB dev versi lama. Backup file DB, lalu buat DB baru.” Sediakan skrip/npm
  command untuk reset DB dev; jangan menghapus file otomatis.
- **Opsi B:** migrasi dev satu kali (v1 → v2) bila data dev perlu dipertahankan.
  Wajib backup, test migrasi, dan tidak boleh menjadi jalur permanen.
- Jangan mempertahankan dua jalur kode v1/v2 di runtime. Setelah migrasi/reset,
  hanya v2 yang didukung.

**File**

- `src/db/database.ts` — DDL, `SCHEMA_VERSION`, `TABEL_AKTIF`, `KOLOM_WAJIB`,
  trigger, guard kompatibilitas
- `src/db/repository.ts` — insert/read `peran`, `replaces_id`, pengaturan
- `src/db/saldoAwal.ts` — penunjuk pembukaan aktif
- `src/db/reversal.ts` — koreksi memakai `replaces_id`
- `src/db/tutup.ts` — snapshot
- `src/db/panjar.ts` — `sumber`
- `src/core/reports.ts` / `src/db/laporan.ts` — cut-over eksplisit
- `src/db/integritas.ts` — invariant baru
- `tests/skema-*.test.ts`, `tests/saldo-awal*.test.ts`, `tests/reversal.test.ts`,
  `tests/tutup.test.ts`, `tests/panjar.test.ts`

**Kriteria selesai**

- DB baru v2 memiliki `peran`, `replaces_id`, penunjuk pembukaan, dan
  `tutup_buku_snapshot`.
- `jurnal.replaces_id` punya FK + unique; `peran` punya CHECK.
- Snapshot tutup buku immutable; `TUTUP-ULANG` menambah versi baru.
- Tidak ada kode laporan yang memakai `MIN(SALDO_AWAL)` untuk cut-over.
- DB v1 ditolak dengan pesan reset yang jelas, atau dimigrasikan dev satu kali.
- `STRICT`, trigger, `TABEL_AKTIF`, dan `KOLOM_WAJIB` diperbarui.
- Seluruh test lama disesuaikan; tidak ada perilaku ganda v1/v2.

**Verifikasi**

```bash
npm test -- tests/skema.test.ts tests/skema-strict.test.ts tests/skema-baseline.test.ts tests/skema-kompatibilitas.test.ts
npm test -- tests/saldo-awal.test.ts tests/reversal.test.ts tests/tutup.test.ts tests/panjar.test.ts
npm run typecheck
```

**Catatan**

T-A00 adalah prasyarat T-A01/T-A02/T-A03. Jangan mengerjakan tiket lain yang
menyentuh skema secara paralel sebelum DDL v2 stabil.

**Catatan penyelesaian (commit b97006d):**

- Skema v2 (`SCHEMA_VERSION = 2`, 12 tabel STRICT): `jurnal.peran` +
  `jurnal.replaces_id` (FK, `ux_jurnal_replaces`), `panjar.sumber`, dan
  `tutup_buku_snapshot` append-only. `TABEL_AKTIF`, `KOLOM_WAJIB`, index,
  trigger backstop, serta guard DB v1 (`PESAN_DB_V1_KEDALUWARSA`) diperbarui.
- Model domain di `src/core/types.ts` (`JurnalPeran`, `Jurnal.peran`,
  `Jurnal.replaces_id`, `Panjar.sumber`, `TutupBukuSnapshot`) dan repository
  (konstanta `KUNCI_SALDO_AWAL_AKTIF_ID`, `KUNCI_CUTOVER_TANGGAL`, insert/read
  snapshot).
- `src/db/pembukaan.ts` baru: `getPembukaanAktif`, `getCutoverTanggal`,
  `getCutoverEksplisit`. `simpanSaldoAwal`/`koreksiSaldoAwal` menulis penunjuk
  pembukaan + cut-over secara atomik; koreksi memakai
  `OPENING_REPLACEMENT` + `replaces_id`.
- Core reports memakai cut-over EKSPLISIT (tanpa `MIN(SALDO_AWAL)`); adapter
  `laporan.ts`, dashboard, dan `tutup.ts` meneruskan cut-over dari DB.
- `scripts/reset-dev-db.ts` + `npm run db:reset-dev` memindahkan DB dev
  (termasuk `-wal`/`-shm`) ke `data/backups/pre-reset-<timestamp>.db` sebelum
  membuat DB baru.
- Dokumentasi `docs/skema.md` diperbarui ke v2; test skema/saldo/reversal/
  tutup/panjar/laporan/dashboard/db-38 disesuaikan dan ditambah
  `tests/skema-v2.test.ts`.
- Verifikasi akhir: `npm test` 93 file / 1228 test lulus;
  `npm run typecheck` lulus. DB dev tidak diubah oleh test/script.

---

### [ ] T-A01 — Satukan sumber tanggal cut-over

| | |
| --- | --- |
| **Prioritas** | P0 |
| **Perkiraan** | M/L |
| **Depends** | T-A00 |
| **Status** | Belum |

**Masalah**

`petaCutoverSaldoAwal()` di `src/core/reports.ts` memakai tanggal `SALDO_AWAL`
paling awal. Koreksi saldo awal membuat jurnal balik + jurnal pengganti
berjenis `UMUM`; jurnal `SALDO_AWAL` lama tetap ada (sudah dibalik) dengan
tanggal lama. Sementara itu `pengaturan.tanggalMulaiPembukuan` sudah dipindahkan
ke tanggal koreksi oleh `koreksiSaldoAwal()`. Laporan memakai tanggal lama,
posting/setting memakai tanggal baru.

**Bukti reproduksi**

1. Saldo awal `2026-07-01`: D 1001 Kas Rp100.000.000 / K 3000 Modal Rp100.000.000.
2. Koreksi saldo awal ke `2026-06-01`.
3. Posting pendapatan `2026-06-15` Rp10.000.000.
4. Hasil: Laba Rugi 2026 = Rp0 (seharusnya Rp10.000.000); Neraca aset
   Rp110.000.000 vs pasiva Rp100.000.000 (selisih Rp10.000.000); Neraca Saldo
   mode tahun selisih Rp10.000.000, mode kumulatif 0; Dashboard
   `balance: true` dengan `aktiva` Rp110.000.000 dan `pasiva` Rp100.000.000.

**Dampak**

Laporan keuangan tahun pertama understated/overstated, Neraca tidak balance,
dashboard memberi badge `BALANCE` yang menyesatkan, dan tutup buku bisa
mengunci angka yang salah.

**Perbaikan yang diusulkan**

1. Hapus ketergantungan laporan pada `MIN(tanggal)` `SALDO_AWAL`. Pakai
   penunjuk resmi dari T-A00:
   - `saldo_awal_aktif_id` untuk identitas jurnal pembukaan aktif;
   - `cutover_tanggal` untuk batas P&L tahun pertama.
2. Ubah API core (`labaRugi`, `neraca`, `neracaSaldoPeriode`, `labaTahun`)
   agar menerima `cutover` eksplisit. Adapter DB di `src/db/laporan.ts` dan
   Dashboard wajib mengisinya dari penunjuk resmi; jangan menyimpulkan sendiri.
3. `koreksiSaldoAwal()` memperbarui `saldo_awal_aktif_id` + `cutover_tanggal`
   secara atomik bersama jurnal balik/pengganti.
4. `simpanPengaturanPembukuan()` menolak perubahan manual yang membuat
   `cutover_tanggal` berbeda dari pembukaan aktif. Bila operator memang perlu
   mengubah tanggal mulai, arahkan ke wizard koreksi saldo awal.
5. Tambahkan invariant/audit yang memastikan penunjuk menunjuk jurnal
   `OPENING`/`OPENING_REPLACEMENT` yang masih aktif (lihat T-A07).
6. Jangan mengubah perilaku multi-tahun: cut-over hanya membatasi P&L tahun
   pertama; tahun berikutnya dihitung penuh.

**File**

- `src/core/reports.ts` — `petaCutoverSaldoAwal`, `labaRugi`, `neraca`,
  `neracaSaldoPeriode`, `labaTahun`
- `src/db/laporan.ts` — adapter laporan
- `src/features/dashboard/dashboard.ts`
- `src/db/repository.ts` — validasi pengaturan
- `src/db/saldoAwal.ts` — helper pembukaan aktif
- `tests/saldo-awal-koreksi.test.ts`
- `tests/db-38-tengah-tahun.test.ts`
- `tests/laporan.test.ts`
- `tests/dashboard.test.ts`

**Kriteria selesai**

- Skenario reproduksi menghasilkan Laba Rugi Rp10.000.000.
- Neraca `totalAset === totalPasiva` dan `selisih === 0`.
- Neraca Saldo mode tahun dan kumulatif sama-sama `selisih === 0`.
- Dashboard `balance === true` dan `aktiva === pasiva`.
- Koreksi saldo awal ke tanggal lebih awal/lebih akhir tetap berfungsi.
- Tidak ada P&L sebelum tanggal pembukaan aktif yang ikut dihitung.
- Seluruh test lama lulus.

**Verifikasi**

```bash
npm test -- tests/saldo-awal-koreksi.test.ts tests/db-38-tengah-tahun.test.ts tests/laporan.test.ts tests/dashboard.test.ts
npm run typecheck
```

---

### [ ] T-A02 — Larang perubahan jenis jurnal pada koreksi

| | |
| --- | --- |
| **Prioritas** | P0 |
| **Perkiraan** | S |
| **Depends** | T-A00 |
| **Status** | Belum |

**Masalah**

`koreksiDanIsiUlang()` hanya menolak pengganti berjenis `REVERSAL`, dan menolak
`SALDO_AWAL` bila jurnal asli bukan `SALDO_AWAL`. Jenis lain bebas diganti.
Jurnal asli `BAYAR` bisa dikoreksi menjadi `PANJAR` dengan baris D 1040 /
K 1001; jurnal tersimpan, lalu `auditIntegritas` melaporkan
`REKONSILIASI_PANJAR_GL_SELISIH`. Bila header pengganti tidak mengisi `jenis`,
DB memakai default `UMUM`, sehingga perubahan jenis juga terjadi tanpa disadari.

**Dampak**

Jenis jurnal menentukan aturan akun kontrol, laporan, dan subledger. Mengganti
jenis membuat jurnal “sah” secara double-entry tetapi salah secara domain:
1040/2050 bisa dipakai tanpa dokumen panjar/pinjaman, dan laporan arus kas
dapat salah mengelompokkan transaksi.

**Perbaikan yang diusulkan**

1. Baca `jenis` asli dari DB (sudah dilakukan).
2. Tambahkan aturan murni `jenisPenggantiSah(asli, pengganti)`:
   - `REVERSAL` selalu ditolak.
   - `SALDO_AWAL` hanya boleh diganti `UMUM` lewat alur koreksi saldo awal.
   - Selain itu, pengganti wajib sama dengan jenis asli.
   - Bila `jenis` pengganti kosong, isi dari jenis asli, jangan biarkan default
     `UMUM`.
3. Panggil aturan ini di `koreksiDanIsiUlang()` sebelum menyusun jurnal/audit.
4. Selaraskan pesan capability di `kemampuanKoreksiJurnal()` agar UI tidak
   menawarkan koreksi yang pasti ditolak.
5. Isi `jurnal.replaces_id` pada jurnal pengganti dan `jurnal.peran` yang sah.
6. Tambahkan backstop DB v2: trigger menolak pengganti yang `jenis`-nya berbeda
   dari asli, kecuali `SALDO_AWAL` → `UMUM` dengan `peran =
   'OPENING_REPLACEMENT'`.

**File**

- `src/db/reversal.ts` — `koreksiDanIsiUlang`
- `src/db/kemampuanKoreksi.ts`
- `src/db/database.ts` — trigger `replaces_id`/`jenis`
- `src/core/reversal.ts` bila aturan murni ditempatkan di core
- `tests/reversal.test.ts`
- `tests/kemampuan-koreksi-jurnal.test.ts`
- `tests/skema-hardening.test.ts`

**Kriteria selesai**

- Koreksi `BAYAR` → `PANJAR` ditolak; tidak ada `jurnal`/`audit_log` baru.
- Koreksi `BAYAR` → `BAYAR` diterima.
- Koreksi dengan `jenis` kosong menghasilkan jenis yang sama dengan asli, bukan
  `UMUM`.
- Koreksi saldo awal (`SALDO_AWAL` → `UMUM`) tetap berjalan lewat wizard.
- `auditIntegritas` tetap bersih setelah koreksi yang sah.

**Verifikasi**

```bash
npm test -- tests/reversal.test.ts tests/kemampuan-koreksi-jurnal.test.ts tests/saldo-awal-koreksi.test.ts
npm run typecheck
```

---

### [ ] T-A03 — Blokir reversal generik atas jurnal pembukaan pengganti

| | |
| --- | --- |
| **Prioritas** | P0 |
| **Perkiraan** | M |
| **Depends** | T-A00, T-A01 |
| **Status** | Belum |

**Masalah**

`rencanaUntuk()` hanya menolak jurnal berjenis `SALDO_AWAL`. Jurnal pengganti
hasil koreksi saldo awal berjenis `UMUM` dan berada di grup pembukaan yang sama,
sehingga bisa dibalik lewat `reverseJurnal()` biasa. Setelah dibalik:

- tidak ada lagi jurnal pembukaan aktif;
- `statusSaldoAwal()` tetap terkunci karena jurnal `SALDO_AWAL` lama masih ada;
- `koreksiSaldoAwal()` tidak menemukan pembukaan aktif;
- tidak ada jalur pemulihan dari UI.

**Dampak**

Saldo awal bisa “hilang” secara fungsional tanpa pesan yang jelas, dan operator
tidak bisa memperbaikinya lewat wizard. Ini kerusakan state, bukan sekadar
selisih laporan.

**Perbaikan yang diusulkan**

1. Gunakan `jurnal.peran` dan `pengaturan.saldo_awal_aktif_id` dari T-A00
   sebagai sumber kebenaran; jangan menebak dari `jenis`/`grup_id`.
2. Di `rencanaUntuk()`:
   - tolak bila `idAsli === saldo_awal_aktif_id`;
   - tolak bila `peran` jurnal adalah `OPENING` atau `OPENING_REPLACEMENT`;
   - arahkan pesan ke Wizard Koreksi Saldo Awal.
3. Terapkan aturan yang sama di `kemampuanKoreksiJurnal()` agar tombol
   reversal/koreksi tidak muncul untuk jurnal pembukaan aktif.
4. Tambahkan test: setelah koreksi saldo awal, reversal generik ditolak; wizard
   koreksi tetap bisa dilakukan berulang.
5. Tambahkan test bahwa `ADJUSTMENT`/`NORMAL` lain tidak ikut terblokir.

**File**

- `src/db/reversal.ts`
- `src/db/kemampuanKoreksi.ts`
- `src/db/saldoAwal.ts` (helper)
- `tests/reversal.test.ts`
- `tests/kemampuan-koreksi-jurnal.test.ts`
- `tests/saldo-awal-koreksi.test.ts`

**Kriteria selesai**

- `reverseJurnal()` atas jurnal pengganti saldo awal mengembalikan
  `tersimpan: false` dengan pesan yang menyebut wizard koreksi.
- `koreksiDanIsiUlang()` generik atas jurnal yang sama juga ditolak.
- `kemampuanKoreksiJurnal()` mengembalikan `bisaDibalik: false` dan
  `bisaDikoreksi: false`.
- Wizard `koreksiSaldoAwal()` tetap berfungsi, termasuk koreksi berulang.
- Tidak ada jurnal/audit yang tertulis saat penolakan.

**Verifikasi**

```bash
npm test -- tests/reversal.test.ts tests/kemampuan-koreksi-jurnal.test.ts tests/saldo-awal-koreksi.test.ts
npm run typecheck
```

---

## P1 — Kontrol, audit, dan konsistensi laporan

### [ ] T-A04 — Izinkan reversal jurnal historis yang akunnya sudah nonaktif

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | M |
| **Depends** | — |
| **Status** | Belum |

**Masalah**

`validasiJurnal()` dan `insertJurnalTervalidasi()` menolak semua baris dengan
akun nonaktif. Akibatnya jurnal lama yang memakai akun yang kemudian
dinonaktifkan tidak bisa direversal. Reproduksi: jurnal lama memakai 4001
PENDAPATAN; setelah 4001 dinonaktifkan, `reverseJurnal()` gagal dengan
`Baris 2: akun 4001 PENDAPATAN ... sudah tidak aktif.` Nonaktif adalah soft
delete untuk form input baru, bukan larangan membaca/mengoreksi histori.

**Dampak**

Koreksi jurnal historis terblokir permanen; satu-satunya jalan adalah
mengaktifkan kembali akun yang sengaja dinonaktifkan, yang melemahkan kontrol
master akun.

**Perbaikan yang diusulkan**

1. Tambahkan konteks `akunNonaktifDiizinkan?: ReadonlySet<string>` pada
   `validasiJurnal()`; akun dalam set ini boleh dipakai meski `aktif = 0`.
2. `reverseJurnal()` membangun set dari akun jurnal asli, tetapi **hanya**
   untuk baris yang benar-benar cermin reversal:
   - akun sama;
   - nominal sama;
   - debit/kredit tertukar;
   - jumlah baris sama.
3. `insertJurnalTervalidasi()` harus menerima konteks yang sama (atau
   memindahkan pemeriksaan aktif ke validator) agar tidak menolak ulang.
4. `koreksiDanIsiUlang()`: jurnal balik boleh memakai akun nonaktif. Jurnal
   pengganti hanya boleh memakai akun nonaktif bila barisnya **persis sama**
   dengan baris asli (akun, sisi, nominal) — yaitu bagian histori yang tidak
   diubah. Bila nominal/sisi berubah, wajib memakai akun aktif; tolak dengan
   pesan “ganti ke akun aktif”.
5. Jangan melonggarkan jalur input manual: jurnal baru dari form tetap menolak
   akun nonaktif.

**File**

- `src/core/posting.ts` — context validator
- `src/db/posting.ts` — `validasiJurnalDb`, `postingJurnalInti`
- `src/db/repository.ts` — `insertJurnalTervalidasi`
- `src/db/reversal.ts`
- `tests/reversal.test.ts`
- `tests/posting.test.ts`
- `tests/akun.test.ts`

**Kriteria selesai**

- Jurnal historis dengan akun 4001 yang sudah nonaktif bisa direversal.
- Jurnal balik tetap cermin persis; tidak ada baris baru ke akun nonaktif.
- Posting manual baru ke 4001 tetap ditolak.
- Koreksi dengan pengganti yang memakai akun nonaktif ditolak dengan pesan
  yang jelas.
- `auditIntegritas` bersih setelah reversal.

**Verifikasi**

```bash
npm test -- tests/reversal.test.ts tests/posting.test.ts tests/akun.test.ts
npm run typecheck
```

---

### [ ] T-A05 — Tolak akun P&L pada jurnal saldo awal

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | S |
| **Depends** | — |
| **Status** | Belum |

**Masalah**

`postingSaldoAwal()` memaksa `jenis = SALDO_AWAL`, tetapi validator utama
mengecualikan `SALDO_AWAL` dari larangan jurnal penutup manual (P&L + ekuitas).
Pemeriksaan “hanya aset/kewajiban/ekuitas” baru ada saat
`konteks.koreksiSaldoAwal === true`. Pemanggil langsung `postingSaldoAwal()`
bisa menyimpan D 1001 Kas / K 4001 Pendapatan sebagai “saldo awal”. Wizard
memang membatasi input ke AKTIVA/KEWAJIBAN + modal otomatis, tetapi service
yang diekspor tidak.

**Dampak**

Saldo awal bisa memuat pendapatan/beban fiktif; Laba Rugi dan ekuitas tahun
pertama salah, dan laporan bisa tampak balance secara aritmetika meskipun
maknanya salah.

**Perbaikan yang diusulkan**

1. Di `validasiJurnal()`, untuk `jenis === 'SALDO_AWAL'`, tolak akun bertipe
   `PENDAPATAN` atau `BEBAN`.
2. Izinkan `AKTIVA`, `KEWAJIBAN`, dan `EKUITAS` (modal penyeimbang).
3. Pesan error menyebut akun dan tipe yang tidak boleh.
4. Pastikan `postingSaldoAwal()` dan `simpanSaldoAwal()` memakai validator yang
   sama; jangan menduplikasi aturan hanya di builder form.
5. Tambahkan test pemanggilan langsung `postingSaldoAwal()` dengan P&L.

**File**

- `src/core/posting.ts`
- `src/db/posting.ts`
- `tests/posting.test.ts`
- `tests/saldo-awal.test.ts`

**Kriteria selesai**

- `postingSaldoAwal()` dengan akun 4001/5xxx ditolak dan tidak menulis apa pun.
- Saldo awal valid (aset/kewajiban + modal otomatis) tetap tersimpan.
- Wizard saldo awal dan koreksi saldo awal tetap lulus test.
- `auditIntegritas` tidak menemukan P&L di jurnal pembukaan.

**Verifikasi**

```bash
npm test -- tests/posting.test.ts tests/saldo-awal.test.ts tests/saldo-awal-koreksi.test.ts
npm run typecheck
```

---

### [ ] T-A06 — Simpan snapshot tutup buku yang tidak berubah

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | L |
| **Depends** | T-A00, T-A01 |
| **Status** | Belum |

**Masalah**

`tutup_buku` hanya menyimpan `tahun`, `created_at`, dan `catatan`. Laba dan
laporan selalu dihitung ulang dari jurnal. Reversal atau jurnal baru di tahun
yang sudah ditutup mengubah laba tahun itu dan `labaDitahan`, tanpa jejak angka
yang disahkan saat tutup. Riwayat tutup buku bisa menampilkan angka berbeda
dari saat operator menutup.

**Dampak**

Tidak ada bukti angka yang disetujui saat tutup buku; audit eksternal tidak
bisa membedakan “laporan berubah karena koreksi sah” dari “laporan berubah
karena data rusak”.

**Perbaikan yang diusulkan**

1. Buat tabel `tutup_buku_snapshot` di skema v2 (T-A00), append-only:
   - `tahun`, `versi`;
   - `laba` tahun tersebut;
   - `total_aset`, `total_kewajiban`, `total_ekuitas`, `total_pasiva`, `selisih`
     pada cutoff `YYYY-12-31`;
   - jumlah jurnal dan hash kanonik baris jurnal tahun itu (SHA-256);
   - `created_at`.
2. Saat `tutupBuku()` berhasil, tulis penanda + snapshot di dalam transaksi yang
   sama. Jangan menyimpan snapshot di `audit_log` sebagai workaround.
3. Jangan menimpa snapshot saat `TUTUP-ULANG`; tambahkan baris dengan `versi`
   berikutnya agar riwayat tetap ada.
4. Tambahkan modul pembaca/komparator (mis. `src/db/tutupSnapshot.ts`) yang:
   - mengambil snapshot terbaru per tahun;
   - menghitung ulang angka dan hash dari jurnal;
   - mengembalikan daftar perbedaan.
5. `auditIntegritas()` menambahkan temuan `SNAPSHOT_TUTUP_BERUBAH` bila hash
   atau angka berbeda.
6. `TutupTab` menampilkan angka snapshot dan peringatan bila angka live sudah
   berbeda; jangan hanya menampilkan hasil hitung ulang.

**Interaksi dengan audit integritas**

`SNAPSHOT_TUTUP_BERUBAH` adalah temuan **kontrol**, bukan alasan otomatis
memblokir `TUTUP-ULANG`. Karena `tutupBuku()` memanggil `auditIntegritas()`,
pastikan:
- penutupan pertama tidak terblokir oleh snapshot yang belum ada;
- `TUTUP-ULANG` dengan `konfirmasiTimpak` tetap bisa berjalan untuk mencatat
  snapshot baru, tetapi UI wajib menampilkan peringatan bahwa angka berubah;
- temuan Neraca/Neraca Saldo (T-A07) tetap memblokir penutupan.

**File**

- `src/db/database.ts` — tabel `tutup_buku_snapshot` + trigger immutable
- `src/db/tutup.ts`
- `src/db/tutupSnapshot.ts` (baru)
- `src/db/integritas.ts`
- `src/renderer/components/TutupTab.tsx`
- `tests/tutup.test.ts`
- `tests/integritas.test.ts`
- `tests/db-28-tutup-pengaturan.test.ts`

**Kriteria selesai**

- Tutup buku menyimpan snapshot laba + Neraca + hash.
- Reversal jurnal di tahun tertutup tidak mengubah snapshot.
- Audit/UI melaporkan `SNAPSHOT_TUTUP_BERUBAH` setelah data berubah.
- `TUTUP-ULANG` menambah snapshot baru, tidak menghapus yang lama.
- Penutupan yang gagal validasi tidak menulis snapshot/penanda.

**Verifikasi**

```bash
npm test -- tests/tutup.test.ts tests/integritas.test.ts tests/db-28-tutup-pengaturan.test.ts
npm run typecheck
```

---

### [ ] T-A07 — Audit integritas berbasis laporan

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | M |
| **Depends** | T-A01, T-A06 |
| **Status** | Belum |

**Masalah**

`auditIntegritas()` memeriksa jurnal per jurnal (seimbang, baris, reversal,
akun, link subledger), tetapi tidak memeriksa konsistensi laporan. Database
bisa lolos audit walau Neraca selisih dan Neraca Saldo mode tahun tidak nol
(lihat reproduksi T-A01).

**Dampak**

Audit memberi rasa aman palsu. `tutupBuku()` juga memakai audit ini, sehingga
tahun bisa dikunci meski laporan tidak balance.

**Perbaikan yang diusulkan**

Tambahkan pemeriksaan dan kode temuan baru:

1. `NERACA_TIDAK_SEIMBANG` — `neraca()` pada cutoff hari ini/latest journal
   menghasilkan `selisih !== 0`.
2. `NERACA_SALDO_SELISIH` — `neracaSaldoPeriode()` mode kumulatif dan mode
   tahun; sertakan `mode`, `totalDebit`, `totalKredit`, `selisih`.
3. `CUTOVER_TIDAK_KONSISTEN` — `pengaturan.cutover_tanggal` berbeda dari
   tanggal jurnal pembukaan aktif (hanya bila keduanya ada).
4. `PEMBUKAAN_AKTIF_HILANG` — ada `SALDO_AWAL`, tetapi tidak ada jurnal
   pembukaan aktif (mis. akibat reversal generik T-A03).
5. `LABA_RUGI_SEBELUM_CUTOVER` — ada baris P&L bertanggal sebelum cut-over di
   luar grup pembukaan.
6. `SALDO_AWAL_MEMUAT_LABA_RUGI` — jurnal pembukaan/grup pembukaan memuat akun
   `PENDAPATAN`/`BEBAN` (menangkap data lama yang dibuat sebelum T-A05).
7. `SNAPSHOT_TUTUP_BERUBAH` — dihasilkan modul T-A06; T-A07 memastikan temuan
   itu ikut dalam hasil audit dan tidak memblokir `TUTUP-ULANG` yang
   dikonfirmasi (lihat catatan interaksi di T-A06).
8. Jangan memeriksa saldo kas negatif di sini; itu tetap peringatan operasional.

**File**

- `src/db/integritas.ts`
- `src/db/tutupSnapshot.ts`
- `src/core/reports.ts` (API yang dipakai audit)
- `tests/integritas.test.ts`
- `tests/tutup.test.ts`

**Kriteria selesai**

- Setiap kode temuan baru punya test fixture yang menghasilkan temuan tersebut;
  jangan hanya mengandalkan reproduksi T-A01 yang sudah diperbaiki.
- Fixture dengan jurnal pembukaan aktif dihapus paksa / cut-over tidak konsisten
  menghasilkan `PEMBUKAAN_AKTIF_HILANG`/`CUTOVER_TIDAK_KONSISTEN`.
- DB bersih tetap `ok: true`.
- `tutupBuku()` menolak tahun yang laporan live-nya tidak balance, tetapi
  `SNAPSHOT_TUTUP_BERUBAH` tidak memblokir `TUTUP-ULANG` yang dikonfirmasi.
- Audit tetap hanya membaca; tidak ada jurnal/angka turunan yang ditulis.
- Temuan baru punya pesan Indonesia yang bisa ditindaklanjuti.

**Verifikasi**

```bash
npm test -- tests/integritas.test.ts tests/tutup.test.ts
npm run typecheck
```

---

### [ ] T-A08 — Dashboard memakai satu definisi balance

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | S |
| **Depends** | T-A01 |
| **Status** | Belum |

**Masalah**

`hitungDashboard()` mengambil `aktiva`/`pasiva` dari `neraca()`, tetapi
`balance`/`selisih`/`badge` dari `hitungNeracaSaldo()` (trial balance). Pada
reproduksi T-A01, trial balance seimbang sehingga dashboard menampilkan
`BALANCE` meski Neraca selisih Rp10.000.000.

**Dampak**

Operator melihat badge `BALANCE` dan menyimpulkan laporan sehat, padahal
Neraca tidak balance. Ini kegagalan trust yang paling terlihat.

**Perbaikan yang diusulkan**

1. Hitung `neraca()` lebih dulu.
2. Set `balance`, `selisih`, dan `badge` dari Neraca, bukan trial balance.
3. Tetap kirim `neracaSaldo` sebagai informasi trial balance; bila perlu
   tambahkan `neracaSaldo.seimbang` dan `neraca.balance` terpisah.
4. UI `DashboardTab` menampilkan peringatan bila trial balance seimbang tetapi
   Neraca tidak; jangan menampilkan `BALANCE`.
5. Test komposisi: `balance === neraca.balance` dan
   `selisih === neraca.selisih` untuk fixture apa pun. Fixture dengan Neraca
   sengaja tidak balance harus menghasilkan `balance: false` dan badge bukan
   `BALANCE`.

**File**

- `src/features/dashboard/dashboard.ts`
- `src/renderer/components/DashboardTab.tsx`
- `tests/dashboard.test.ts`

**Kriteria selesai**

- `balance` dan `selisih` dashboard konsisten dengan `neraca()`.
- Tidak ada badge `BALANCE` saat Neraca selisih.
- Trial balance tetap bisa dilihat terpisah.
- Dashboard bersih tetap `balance: true`.

**Verifikasi**

```bash
npm test -- tests/dashboard.test.ts tests/laporan.test.ts
npm run typecheck
```

---

### [ ] T-A09 — Audit dan validasi tanggal tautkan pembayaran pinjaman

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | S/M |
| **Depends** | — |
| **Status** | Belum |

**Masalah**

`tautkanPembayaran()` hanya menulis baris `pinjaman_bayar`; tidak ada
`catatAudit`. Tanggal pembayaran diambil dari input `tanggal` bila ada, bukan
dari tanggal jurnal, sehingga bisa berbeda dari jurnal yang ditautkan dan bisa
sebelum `pinjaman.tanggal_mulai`. Jalur `catatPembayaran()` yang lebih baru
sudah menulis audit; jalur link-only belum.

**Dampak**

Tautan pembayaran bisa berubah tanpa jejak audit, dan tanggal laporan pinjaman
bisa tidak konsisten dengan jurnal.

**Perbaikan yang diusulkan**

1. Turunkan `tanggal` dari `detail.jurnal.tanggal`. Bila pemanggil mengirim
   tanggal berbeda, tolak dengan pesan jelas (jangan diam-diam menimpa).
2. Tolak bila tanggal jurnal/pembayaran < `pinjaman.tanggal_mulai`.
3. Tulis `catatAudit` dalam transaksi yang sama:
   - `aksi = 'PINJAMAN-BAYAR-LINK <pinjaman_id>'`;
   - `ref_type = 'pinjaman_bayar'`, `ref_id = pembayaran.id`;
   - `baru` berisi link, tanggal, dan rincian pokok/bunga/denda.
4. Pastikan kegagalan audit membatalkan insert.
5. Samakan gaya pesan dengan `catatPembayaran()`.

**File**

- `src/db/pinjaman.ts`
- `tests/pinjaman.test.ts`
- `tests/db-16d-pinjaman-bayar.test.ts`
- `tests/audit.test.ts`

**Kriteria selesai**

- `tautkanPembayaran()` menambah tepat satu audit log.
- Tanggal berbeda dari jurnal ditolak; tanggal sama diterima.
- Pembayaran sebelum tanggal mulai pinjaman ditolak.
- Tidak ada baris `pinjaman_bayar`/audit yang tertinggal saat gagal.
- `catatPembayaran()` yang sudah ada tidak berubah perilakunya.

**Verifikasi**

```bash
npm test -- tests/pinjaman.test.ts tests/db-16d-pinjaman-bayar.test.ts tests/audit.test.ts
npm run typecheck
```

---

### [ ] T-A10 — Validasi tanggal reversal dan koreksi

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | S |
| **Depends** | T-A01, T-A03 |
| **Status** | Belum |

**Masalah**

`rencanaUntuk()` menerima `opsi.tanggal` apa pun yang valid. Reversal bisa
bertanggal sebelum jurnal asli. Dampaknya: saldo kas pada tanggal reversal bisa
negatif, P&L bergeser ke periode lebih awal, dan cut-over/laba tahun bisa
berubah tanpa aturan yang jelas.

**Dampak**

Koreksi bisa mengubah laporan tahun sebelumnya secara tidak terkontrol, di luar
alur koreksi saldo awal.

**Perbaikan yang diusulkan**

1. Untuk `reverseJurnal()`: tolak tanggal eksplisit < tanggal jurnal asli.
   Tanggal sama atau lebih baru boleh; alasan tetap wajib.
2. Untuk `koreksiDanIsiUlang()` non-pembukaan: tolak tanggal pengganti <
   tanggal asli. Koreksi yang perlu memindahkan tanggal lebih awal hanya boleh
   lewat wizard koreksi saldo awal.
3. Jangan mengubah default: tanpa tanggal eksplisit, reversal tetap memakai
   tanggal jurnal asli.
4. Bila tanggal reversal/pengganti jatuh di tahun yang sudah ditutup, aturan
   kunci periode + alasan tetap berlaku; tambahkan peringatan di UI bahwa
   snapshot tutup buku akan berbeda.
5. Tambahkan test batas: H-1 ditolak, H sama diterima, H+1 diterima, koreksi
   saldo awal lebih awal tetap diterima.

**File**

- `src/db/reversal.ts`
- `src/core/reversal.ts` (bila aturan murni ditempatkan di sana)
- `tests/reversal.test.ts`
- `tests/saldo-awal-koreksi.test.ts`

**Kriteria selesai**

- Reversal bertanggal sebelum asli ditolak tanpa menulis jurnal/audit.
- Reversal bertanggal sama/lebih baru tetap berfungsi.
- Koreksi non-pembukaan tidak bisa memindahkan tanggal ke belakang asli.
- Koreksi saldo awal tetap bisa memindahkan tanggal lebih awal.
- Pesan error menyebut tanggal asli dan batas yang diperbolehkan.

**Verifikasi**

```bash
npm test -- tests/reversal.test.ts tests/saldo-awal-koreksi.test.ts
npm run typecheck
```

---

### [ ] T-A11 — Representasikan panjar OPEN saat cut-over

| | |
| --- | --- |
| **Prioritas** | P1 |
| **Perkiraan** | L |
| **Depends** | T-A00 |
| **Status** | Belum |

**Masalah**

`auditIntegritas()` membandingkan seluruh saldo 1040 (termasuk `SALDO_AWAL`)
dengan total `panjar` OPEN. Bila saldo awal memuat panjar yang masih beredar,
tidak ada dokumen `panjar` yang mewakilinya, sehingga audit selalu melaporkan
`REKONSILIASI_PANJAR_GL_SELISIH`. Model belum punya konsep “panjar OPEN pada
saat cut-over”.

**Dampak**

Audit integritas menghasilkan false positive setelah saldo awal; operator
mungkin “memperbaiki” dengan jurnal 1040 liar atau menghapus saldo awal, yang
lebih merusak.

**Perbaikan yang diusulkan**

1. Implementasikan model yang sudah dipilih T-A00:
   - `panjar.sumber` (`NORMAL`/`SALDO_AWAL`);
   - untuk `sumber = 'SALDO_AWAL'`, `jurnal_open_id` menunjuk jurnal
     pembukaan dan `jumlah` adalah bagian 1040 yang masih beredar;
   - jangan mengecualikan `SALDO_AWAL` dari rekonsiliasi tanpa memodelkannya.
2. Sesuaikan rekonsiliasi:
   - total 1040 = panjar OPEN normal + bagian opening;
   - jangan menghitung dua kali jurnal pembukaan.
3. Sesuaikan UI Buku Panjar: tampilkan baris “saldo awal”, larang close normal
   bila belum ada realisasi, atau sediakan alur close khusus.
4. Tambahkan audit `PANJAR_OPENING_TIDAK_LENGKAP` bila dokumen opening tidak
   konsisten dengan baris 1040.
5. Jangan menyelesaikan tiket ini hanya dengan mengecualikan `SALDO_AWAL` dari
   rekonsiliasi; itu menyembunyikan selisih, bukan memodelkannya.

**File**

- `src/db/database.ts` (jika skema berubah)
- `src/db/panjar.ts`
- `src/db/panjarRekonsiliasi.ts`
- `src/db/integritas.ts`
- `src/renderer/components/PanjarTab.tsx`
- `tests/panjar.test.ts`
- `tests/integritas.test.ts`

**Kriteria selesai**

- Saldo awal 1040 RpX + panjar OPEN RpX tidak menghasilkan temuan selisih.
- Panjar normal tetap direkonsiliasi seperti sekarang.
- Tidak ada panjar “hantu” tanpa dokumen.
- Penutupan/pembatalan panjar opening punya alur yang jelas.
- Perubahan skema mengikuti aturan versi/migrasi.

**Verifikasi**

```bash
npm test -- tests/panjar.test.ts tests/integritas.test.ts
npm run typecheck
```

---

## P2 — Hardening, desain, dan dokumentasi

### [ ] T-A12 — Validasi jadwal angsuran pinjaman

| | |
| --- | --- |
| **Prioritas** | P2 |
| **Perkiraan** | S |
| **Depends** | — |
| **Status** | Belum |

**Masalah**

`buatPinjaman()` memvalidasi urutan `jatuh_tempo` naik, tetapi tidak memastikan
tanggal pertama tidak sebelum `tanggal_mulai`. Baris jadwal dengan `pokok = 0`
dan `bunga = 0` juga diterima, lalu `ringkasanAngsuran()` menandainya `LUNAS`
tanpa pembayaran karena `sisaPokok === 0 && sisaBunga === 0`.

**Dampak**

Jadwal bisa berisi angsuran yang jatuh tempo sebelum pinjaman dimulai, atau
angsuran nol yang tampak lunas padahal tidak ada pembayaran. Ini mengacaukan
status angsuran dan laporan pinjaman.

**Perbaikan yang diusulkan**

1. Wajibkan `jatuh_tempo` setiap baris >= `tanggal_mulai`.
2. **Default:** tolak baris dengan `pokok === 0 && bunga === 0` saat pembuatan
   jadwal. Baris tanpa kewajiban bukan angsuran; bila produk butuh masa
   tenggang, buat flag domain eksplisit di tiket terpisah.
3. `ringkasanAngsuran()` tidak boleh menetapkan `dibayar: true` hanya karena
   jadwal bernilai nol; `dibayar` harus mencerminkan realisasi pembayaran.
4. Tambahkan test jadwal mundur, jadwal nol, dan jadwal normal.

**File**

- `src/db/pinjaman.ts`
- `src/core/pinjamanAngsuran.ts`
- `tests/pinjaman.test.ts`
- `tests/aud2-15-jadwal-otomatis.test.ts`

**Kriteria selesai**

- Jadwal dengan jatuh tempo sebelum tanggal mulai ditolak.
- Baris `pokok = 0` dan `bunga = 0` ditolak saat pembuatan jadwal.
- Tidak ada angsuran yang berstatus `LUNAS` tanpa realisasi pembayaran.
- Jadwal normal dan pembayaran sebagian tetap berfungsi.

**Verifikasi**

```bash
npm test -- tests/pinjaman.test.ts tests/aud2-15-jadwal-otomatis.test.ts
npm run typecheck
```

---

### [ ] T-A14 — Satu command layer untuk semua penulisan jurnal

| | |
| --- | --- |
| **Prioritas** | P2 |
| **Perkiraan** | L |
| **Depends** | T-A00, T-A02, T-A03, T-A04, T-A05 |
| **Status** | Belum |

**Masalah**

`insertJurnalTervalidasi()` diekspor dan dipakai beberapa jalur (`postingJurnal`,
`simpanSaldoAwal`, `koreksiSaldoAwal`, `koreksiDanIsiUlang`, seed). Aturan
seperti audit otomatis, wajib saldo awal, konfirmasi peringatan, dan akun aktif
tidak semuanya berada di satu pintu. Setiap jalur baru harus mengingat aturan
yang sama.

**Dampak**

Invariant akuntansi bisa terlewat di jalur yang tidak memanggil
`postingJurnal()`. Ini bukan bug hari ini, tetapi risiko regresi jangka panjang.

**Perbaikan yang diusulkan**

1. Inventaris semua pemanggil `insertJurnalTervalidasi()`.
2. Jadikan fungsi itu internal (tidak diekspor bebas) atau beri nama
   `insertJurnalInternal` dengan konteks wajib.
3. Perluas `postingJurnal()` dengan mode eksplisit:
   `NORMAL`, `OPENING`, `REVERSAL`, `CORRECTION`.
4. Pindahkan audit, cek periode, cek akun, dan guard saldo awal ke satu service.
5. Tambahkan test/lint arsitektur: tidak ada modul produksi di luar service yang
   mengimpor raw insert.
6. Seed/dev boleh memakai helper test khusus, bukan jalur produksi.

**Kriteria selesai**

- Semua jalur produksi menulis jurnal lewat satu service.
- Tidak ada penurunan jumlah audit/jurnal pada test yang ada.
- Seed/test tetap bisa membuat data tanpa membuka pintu produksi.
- `npm test` dan `npm run typecheck` lulus.

**Verifikasi**

```bash
npm test
npm run typecheck
```

---

### [ ] T-A15 — Sinkronkan dokumentasi akuntansi

| | |
| --- | --- |
| **Prioritas** | P2 |
| **Perkiraan** | S |
| **Depends** | T-A01–T-A11 |
| **Status** | Belum |

**Masalah**

`docs/prinsip-akuntansi.md` masih menyatakan koreksi saldo awal tidak mengubah
`KUNCI_AKUNTANSI_TANGGAL_MULAI` karena tanggal saldo awal tidak berubah. Setelah
koreksi bisa memindahkan tanggal, setting ikut berubah dan laporan memakai
cut-over aktif. Dokumentasi juga belum menjelaskan larangan ganti jenis,
perlindungan jurnal pembukaan pengganti, dan snapshot tutup buku.

**Dampak**

Operator/pendamping memakai mental model yang salah saat memeriksa data atau
melatih pengguna baru.

**Perbaikan yang diusulkan**

1. Perbarui bagian koreksi saldo awal:
   - tanggal boleh pindah;
   - `saldo_awal_aktif_id` dan `cutover_tanggal` diperbarui atomik;
   - laporan memakai penunjuk resmi, bukan `MIN(SALDO_AWAL)`.
2. Dokumentasikan aturan jenis pengganti (T-A02).
3. Dokumentasikan larangan reversal generik atas pembukaan aktif (T-A03).
4. Dokumentasikan snapshot tutup buku dan temuan audit baru (T-A06/T-A07).
5. Perbarui `docs/skema.md` untuk skema v2 (`peran`, `replaces_id`, penunjuk
   pembukaan, `tutup_buku_snapshot`, `panjar.sumber`).
6. Perbarui `docs/panduan-pemeriksaan.md` dengan kode temuan baru.

**File**

- `docs/prinsip-akuntansi.md`
- `docs/skema.md`
- `docs/panduan-pemeriksaan.md`
- `README.md` bila perlu
- `tests/dokumentasi.test.ts`

**Kriteria selesai**

- Tidak ada pernyataan dokumentasi yang bertentangan dengan kode.
- Istilah/kode temuan baru terdokumentasi.
- `tests/dokumentasi.test.ts` lulus.

**Verifikasi**

```bash
npm test -- tests/dokumentasi.test.ts
```

---

### [ ] T-A16 — Tampilkan temuan audit integritas saat aplikasi mulai

| | |
| --- | --- |
| **Prioritas** | P2 |
| **Perkiraan** | S |
| **Depends** | T-A07 |
| **Status** | Belum |

**Masalah**

`auditIntegritasSaatMulai()` hanya menulis ringkasan ke log. Operator yang tidak
membuka log tidak tahu bahwa Neraca selisih, snapshot tutup berubah, atau ada
temuan integritas lain.

**Dampak**

Kerusakan data bisa berlanjut tanpa peringatan yang terlihat; aplikasi tetap
terasa “normal”.

**Perbaikan yang diusulkan**

1. Kembalikan hasil audit ke renderer saat startup (tanpa memblokir buka
   aplikasi).
2. Tampilkan banner/dialog ringkas: jumlah temuan, 3–5 temuan teratas, tombol
   “Buka Audit”.
3. Untuk temuan kritis (Neraca tidak balance, snapshot tutup berubah), beri
   warna/peringatan lebih kuat; jangan auto-fix.
4. Tetap catat ke log dan jangan pernah menulis DB dari modul audit.
5. Tambahkan test bahwa startup dengan temuan mengembalikan hasil dan tidak
   melempar error.

**File**

- `src/main/auditAwal.ts`
- `src/main/index.ts`
- `src/renderer/App.tsx` / komponen banner
- `src/renderer/components/AuditDetail.tsx`
- `tests/audit-awal.test.ts`

**Kriteria selesai**

- Startup dengan DB bermasalah menampilkan peringatan yang bisa dilihat.
- Startup dengan DB bersih tidak menampilkan gangguan.
- Aplikasi tetap bisa dibuka untuk memperbaiki data.
- Tidak ada perubahan data dari audit.

**Verifikasi**

```bash
npm test -- tests/audit-awal.test.ts
npm run typecheck
```

---

## Urutan eksekusi yang disarankan

```text
P0
  T-A00  skema v2: peran, replaces_id, pembukaan, snapshot
  T-A01  cut-over
  T-A02  jenis pengganti
  T-A03  proteksi pembukaan pengganti
      │
P1    ├─ T-A04  akun nonaktif
      ├─ T-A05  P&L saldo awal
      ├─ T-A06  snapshot tutup (pakai tabel v2)
      ├─ T-A07  audit laporan (butuh A01/A06)
      ├─ T-A08  dashboard (butuh A01)
      ├─ T-A09  audit pinjaman
      ├─ T-A10  tanggal reversal
      └─ T-A11  panjar opening (pakai model v2)
      │
P2    ├─ T-A12  jadwal angsuran
      ├─ T-A14  satu command layer
      ├─ T-A15  dokumentasi
      └─ T-A16  audit saat mulai
```

**Catatan:** T-A00 harus selesai lebih dulu karena mengubah DDL dan tipe data
inti. T-A01/T-A02/T-A03 memakai `peran`, `replaces_id`, dan penunjuk pembukaan
dari T-A00. **Jangan** mengerjakan T-A14 sebelum P0 selesai; refactor command
layer setelah angka laporan dipercaya.

## Definition of Done (semua tiket)

- [ ] Test regresi khusus tiket ditambahkan dan gagal bila perbaikan dilepas.
- [ ] `npm run typecheck` lulus.
- [ ] `npm test` lulus seluruhnya.
- [ ] Data dev di-reset atau dimigrasikan sesuai T-A00; tidak ada data produksi
      yang perlu dijaga.
- [ ] Pesan error berbahasa Indonesia dan bisa ditindaklanjuti operator.
- [ ] Audit log bertambah untuk operasi yang mengubah data.
- [ ] Dokumentasi yang relevan diperbarui.
- [ ] `git status` bersih setelah commit.

## Di luar cakupan tiket ini

Hal-hal berikut adalah keputusan produk/akuntansi, bukan bug yang bisa
diperbaiki tanpa kesepakatan:

- bunga pinjaman efektif/amortisasi (sekarang flat);
- akrual penuh dan jurnal penutup resmi;
- rekonsiliasi bank;
- penyusutan aset;
- kebijakan buka kembali periode tertutup secara formal;
- migrasi data produksi (belum ada); reset/migrasi DB dev sudah diatur T-A00.

Bila salah satu dibutuhkan, buat tiket produk terpisah dengan contoh jurnal dan
persetujuan akuntan.
