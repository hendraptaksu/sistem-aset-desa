# Changelog

Semua perubahan penting pada proyek ini dicatat di file ini. Format mengikuti
[Keep a Changelog](https://keepachangelog.com/id/1.1.0/). Versi aplikasi saat ini
**2.0.0**; entri di bawah berstatus **Unreleased** karena audit P0–P2 belum
dirilis sebagai versi baru.

## [Unreleased] — Audit P0–P2 (2026-11)

### Ditambahkan

- **Alur koreksi saldo awal** (T1.6–T1.8): reversal jurnal `SALDO_AWAL` lama +
  jurnal penyesuaian `UMUM` bertanggal sama + audit `KOREKSI-SALDO-AWAL` dalam
  satu transaksi atomik. Tersedia tombol **Koreksi Saldo Awal** di wizard dengan
  prefill saldo saat ini, pratinjau selisih, dan kewajiban alasan ≥5 karakter.
  Jurnal lama tidak diedit/dihapus; koreksi berulang membalik penyesuaian
  terakhir, bukan saldo awal asli.
- **Capability flags koreksi jurnal** (T2.1–T2.3): helper backend
  `kemampuanKoreksiJurnal` dan field `bisa_dibalik`/`bisa_dikoreksi`/
  `alasan_tidak_bisa` pada DTO jurnal. UI memakai flag ini (bukan tebakan jenis
  atau akun) sehingga tidak ada tombol yang selalu gagal; alasan ketidakbisaan
  ditampilkan untuk panjar, pinjaman, saldo awal, reversal, dan jurnal yang
  sudah dikoreksi.
- **Perlindungan akun sistem** (T2.4): `2060` (utang usaha), `5063` (bunga
  pinjaman), dan `5050` (denda) tidak bisa dinonaktifkan; reaktivasi tetap
  diizinkan. Matriks test alur × akun sistem nonaktif (T2.5) memastikan
  penolakan berupa error validasi yang jelas tanpa data setengah jadi.
- **Verifikasi isi backup** (T3.1): sebelum mengganti backup lama,
  `VACUUM INTO` hasilnya dibuka readonly dan diperiksa `integrity_check`,
  `foreign_key_check`, `user_version`, dan keberadaan seluruh tabel wajib.
  Backup korup tidak pernah menggantikan backup sehat.
- **Retensi backup internal** (T3.2): batas `auto-*` (7), `pre-restore-*` (5),
  dan `pura-<tahun>` (10). Pruning hanya setelah backup baru terverifikasi dan
  tidak pernah menghapus backup yang sedang dipakai rollback.
- **Self-check definisi index/trigger** (T3.6): index/trigger kanonik dibuat
  ulang dengan `DROP ... IF EXISTS` + `CREATE`, lalu dibandingkan dengan
  definisi acuan. Objek hilang/berbeda dipulihkan; yang tidak bisa dipulihkan
  membuat DB ditolak dengan pesan jelas.
- **Benchmark laporan + batas daftar jurnal** (T3.7): script
  `npm run benchmark` (10.000 jurnal / 50.000 baris) dan pagination default
  `jurnal:list` (limit 500, maksimum 1.000) dengan test query plan.
- **Runbook pemulihan** (T3.9): README dan panduan pengguna memuat tiga alur
  bernomor untuk saldo awal salah, backup/restore, dan DB ditolak; pemeriksa
  mendapat checklist pemulihan.
- **Lockout PIN persisten** (T2.8): hitungan gagal dan waktu blokir disimpan di
  tabel `pengaturan`, sehingga menutup/membuka aplikasi tidak mereset blokir.
- **Regresi P0** (T1.9): test permanen untuk empat reproduksi baseline, termasuk
  persistensi koreksi/reversal setelah DB ditutup dan dibuka ulang.

### Diubah

- **Pratinjau dan pesan UI aksi berisiko** (T3.8): konfirmasi backup/restore/
  saldo awal menjelaskan “Yang berubah”/“Yang tetap”, tombol nonaktif punya
  alasan terlihat, modal memakai fokus aman (Batal), Escape menutup, dan error
  diumumkan lewat `aria-live`.
- **Template Jurnal Umum** (T3.4): template mati `serah-panjar` (akun kontrol
  1040) diganti `bayar-utang-usaha` (D 2060 / K 1001). Semua template yang
  ditampilkan kini bisa diposting.
- **Normalisasi awal tahun buku** (T2.6): DB legacy yang menyimpan nilai selain
  Januari dibaca sebagai Januari (`AWAL_TAHUN_BUKU_DIDUKUNG = 1`) agar
  dashboard dan laporan memakai periode yang sama; input mentah yang tidak
  didukung ditolak saat disimpan.
- **Refresh kunci setelah restore** (T2.7): renderer langsung memuat ulang
  status kunci dan menampilkan pesan restore di layar kunci, tanpa memanggil
  API dashboard saat aplikasi masih terkunci.
- **Keputusan backup terenkripsi** (T3.3): rilis ini memilih dokumentasi +
  imbauan disk/volume terenkripsi, bukan SQLCipher/arsip terenkripsi. PIN
  ditegaskan sebagai kunci akses aplikasi, bukan enkripsi isi file. Opsi
  enkripsi penuh dicatat sebagai kandidat tiket terpisah.
- **Keputusan audit actor & hash chain** (T3.5): trigger append-only
  dipertahankan tanpa perubahan skema; risiko edit file DB langsung
  didokumentasikan. Opsi `actor` + `prev_hash`/`hash` skema v2 dicatat sebagai
  kandidat tiket terpisah.

### Diperbaiki

- **P0 data safety — backup ke DB aktif** (T1.1): backup ke path DB aktif
  (termasuk symlink/hardlink dan sidecar `-wal`/`-shm`) ditolak sebelum
  `VACUUM INTO`; data jurnal baru tidak lagi hilang setelah DB dibuka ulang.
- **P0 data safety — semua kanal simpan** (T1.2): guard path yang sama dipasang
  pada `file:save-buffer`, `file:save-pdf`, dan `backup:export`, sehingga file
  DB aktif tidak bisa tertimpa isi xlsx/pdf.
- **P0 data safety — DB v1 tidak lengkap** (T1.3–T1.4): DB v1 tanpa tabel atau
  kolom wajib ditolak **sebelum** WAL/DDL dengan pesan Indonesia yang menyebut
  objek hilang dan instruksi memulihkan dari backup. Tidak ada tabel/kolom yang
  dibuat ulang atau `ALTER TABLE` otomatis.
- **P0 data safety — reversal saldo awal** (T1.5): reversal generik
  `SALDO_AWAL` diblokir tanpa menulis jurnal/audit; pesan
  `PESAN_SALDO_AWAL_SUDAH_ADA` mengarah ke alur koreksi saldo awal, bukan
  jurnal biasa.
- **DevTools di build produksi** (T2.9): `devTools: false`, menu produksi tanpa
  Toggle Developer Tools, dan shortcut F12/Ctrl+Shift+I/Ctrl+Alt+I diblokir.
  Mode development tetap bisa membuka DevTools.

### Verifikasi akhir (T4.1–T4.2)

- `npm run typecheck` lulus.
- `npm test`: **91 file / 1.201 test lulus, 0 gagal** (baseline audit 85 file /
  1.078 test; tidak ada test yang hilang).
- `npm run smoke`: **2/2** lulus; `npm run audit:ui`: **3/3** ukuran lulus.
- `npm run benchmark` (10.000 jurnal / 50.000 baris): seluruh laporan
  **<120 ms** pada laptop referensi.
- Platform: diuji di **macOS**; **Windows tidak diuji** pada sesi audit ini.
