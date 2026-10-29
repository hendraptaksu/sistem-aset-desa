# Tickets Audit Akuntansi — 2026-10-27

> Dokumen ini memecah hasil **audit ulang sistem akuntansi 2026-10-27** menjadi
> tiket kecil yang bisa dikerjakan satu sesi per tiket oleh AI agent.
>
> Prinsip yang tidak boleh dilanggar:
> - Jurnal adalah satu-satunya sumber angka. Tidak ada saldo/laba tersimpan.
> - Jurnal yang sudah tersimpan tidak boleh diedit/dihapus; koreksi lewat reversal.
> - Setiap tiket wajib menambah regression test untuk kasus yang diperbaiki.
> - Satu sesi = satu tiket. Jangan mengerjakan dua tiket sekaligus.
> - Setelah selesai: ubah `[ ]` menjadi `[x]`, tambahkan bukti di baris yang sama,
>   lalu commit dengan pesan `fix(AKT-xx): ...`.
>
> Baseline: `npm run typecheck` bersih; `npm test` **604 test / 53 file hijau**
> pada 2026-10-27. Test yang ada belum mencakup temuan di bawah.

## Progress

| ID | P | Ukuran | Judul | Dependency | Status |
|---|---|---|---|---|---|
| AKT-00 | — | S | Baseline audit & reproduksi | — | [x] |
| AKT-01 | P1 | M | Guard backend: jurnal pertama wajib saldo awal / konfirmasi | — | [x] |
| AKT-02 | P1 | M | UI konfirmasi "mulai tanpa saldo awal" | AKT-01 | [x] |
| AKT-03 | P1 | M | Tegakkan tanggal mulai pembukuan sebagai batas bawah | AKT-01 | [x] |
| AKT-04 | P1 | M | Peringatan kas minus untuk tanggal setelah jurnal | — | [x] |
| AKT-05 | P1 | S | Default tanggal reversal = tanggal jurnal asli | — | [x] |
| AKT-06 | P1 | M | Audit override: peringatan + konfirmasi + alasan | — | [x] |
| AKT-07 | P1 | M | UI alasan konfirmasi Transaksi/Jurnal Umum/Saldo Awal | AKT-06 | [x] |
| AKT-08 | P1 | M | UI/API alasan overbalance Pihak & overrun Panjar | AKT-06 | [x] |
| AKT-09 | P1 | M | Modul audit integritas akuntansi | — | [x] |
| AKT-10 | P1 | S | Tutup buku menolak jika audit integritas gagal | AKT-09 | [x] |
| AKT-11 | P1 | S | Restore menolak backup yang tidak lolos audit integritas | AKT-09 | [x] |
| AKT-12 | P1 | S | Tutup buku berurutan / cegah lompat tahun | — | [x] |
| AKT-13 | P1 | S | Laporan anggaran tetap jalan saat akun pagu nonaktif | — | [x] |
| AKT-14 | P1 | S | Tolak/tandai tanggal jurnal di masa depan | — | [x] |
| AKT-15 | P1 | S | Default periode Laba Rugi & Arus Kas ke periode berjalan | AKT-14 | [x] |
| AKT-16 | P1 | M | Larang jurnal penutup manual P&L → ekuitas | — | [x] |
| AKT-17 | P1 | S | Reklasifikasi arus kas pinjaman 1050 ke investasi | — | [x] |
| AKT-18 | P1 | M | Pisahkan transfer dan biaya pada jurnal kas gabungan | — | [x] |
| AKT-19 | P1 | S | Desain pemisahan utang usaha vs pinjaman (2050) | — | [x] |
| AKT-20 | P1 | M | Implementasi klasifikasi arus kas 2050 | AKT-19 | [x] |
| AKT-21 | P2 | S | Wajib alasan saat menandai rekonsiliasi dengan selisih | — | [x] |
| AKT-22 | P2 | S | Validasi input koreksi & isi ulang | — | [ ] |
| AKT-23 | P2 | S | Cek akun asing di semua laporan | — | [ ] |
| AKT-24 | P2 | M | Anti-duplikat import Excel | — | [ ] |
| AKT-25 | P2 | M | Guard `insertJurnal` / jadikan internal | — | [ ] |
| AKT-26 | P2 | S | Audit log append-only; `tutup_buku` tidak bisa dihapus | — | [ ] |
| AKT-27 | P2 | S | Perbaiki dokumentasi 3001/3002, closing, reversal | AKT-05, AKT-16 | [ ] |
| AKT-28 | P2 | S | Rapikan total saldo export, total anggaran, status dashboard | — | [ ] |
| AKT-29 | P3 | S | Ketahanan validasi & tanggal import | — | [ ] |

**Status: 22/30 (AKT-00, AKT-01, AKT-02, AKT-03, AKT-04, AKT-05, AKT-06, AKT-07, AKT-08, AKT-09, AKT-10, AKT-11, AKT-12, AKT-13, AKT-14, AKT-15, AKT-16, AKT-17, AKT-18, AKT-19, AKT-20, AKT-21 selesai).** Kerjakan berurutan; jangan mencentang
tiket tanpa bukti test.

> **Catatan skema:** `SCHEMA_VERSION` saat ini 10 (AKT-20). Tiket yang menambah
> kolom/trigger wajib menaikkan versi satu langkah dan memperbarui test migrasi.
> Jika AKT-20 dan AKT-26 sama-sama menyentuh skema, tiket yang dikerjakan kedua
> memakai versi berikutnya—jangan dua tiket memakai nomor versi yang sama.

---

## Fase A — P1: wajib sebelum data nyata

- [x] **AKT-00 — Baseline audit & reproduksi** · — · S (2026-10-27: typecheck bersih; 604/604 test hijau; 10 temuan P1 direproduksi, lihat `docs/tickets-audit-akuntansi-2026-10-27.md`)

- [x] **AKT-01 — Guard backend: jurnal pertama wajib saldo awal / konfirmasi** · P1 · M (2026-10-29: typecheck bersih; 609/609 test hijau (53 file); guard `wajibSaldoAwal` dicek di dalam transaksi sebelum insert + audit, IPC `jurnal:posting` meneruskan `wajibSaldoAwal: true`/`konfirmasiTanpaSaldoAwal`, saldo awal dikecualikan)
  - **Konteks:** `statusSaldoAwal()` hanya melihat `COUNT(*) FROM jurnal = 0`
    (`src/db/saldoAwal.ts`). Setelah satu jurnal apa pun—termasuk reversal—wizard
    saldo awal terkunci permanen. Saat ini tidak ada guard di jalur posting, jadi
    operator awam bisa memulai transaksi tanpa saldo awal dan kehilangan
    kesempatan mencatat aset/kewajiban awal.
  - **Langkah:**
    1. Tambah `wajibSaldoAwal?: boolean` dan
       `konfirmasiTanpaSaldoAwal?: boolean` ke `OpsiPosting`
       (`src/db/posting.ts`).
    2. Di dalam transaksi `postingJurnal`, sebelum `insertJurnal`, cek
       `SELECT COUNT(*) FROM jurnal`. Bila `wajibSaldoAwal === true`, count 0,
       `header.jenis !== 'SALDO_AWAL'`, dan `konfirmasiTanpaSaldoAwal !== true`,
       lempar error:
       `Belum ada saldo awal. Isi Wizard Saldo Awal dulu, atau konfirmasi mulai tanpa saldo awal.`
    3. `jurnal:posting` mengirim `wajibSaldoAwal: true`. `postingSaldoAwal`
       (jenis `SALDO_AWAL`) tidak terkena guard.
    4. Jalur Pihak/Panjar/Import belum diwajibkan di tiket ini; itu AKT-02.
       Jangan menambah guard tanpa opsi agar test lama tidak rusak.
  - **DoD:** DB kosong + `jurnal:posting` normal tanpa flag → gagal, tidak ada
    baris tertulis; dengan `konfirmasiTanpaSaldoAwal` → tersimpan; saldo awal
    lebih dulu → jurnal berikutnya tersimpan.
  - **Test:** `tests/saldo-awal.test.ts` atau `tests/posting.test.ts`:
    tiga skenario di DoD, plus kegagalan tidak menulis audit.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-02 — UI konfirmasi "mulai tanpa saldo awal"** · P1 · M (2026-10-29: typecheck bersih; 615/615 test hijau (53 file); build hijau; modal guard `SaldoAwalGuard` dipakai Transaksi/Jurnal Umum/Panjar/Pihak/Import, tombol Isi Saldo Awal membuka wizard, pilihan mulai tanpa disimpan per sesi (sessionStorage) dan diteruskan sebagai `wajibSaldoAwal: true` + `konfirmasiTanpaSaldoAwal`; IPC pihak/panjar/import kini ikut menolak jurnal pertama; error backend "Belum ada saldo awal..." memicu modal)
  - **Konteks:** Setelah AKT-01, pintu `jurnal:posting` pada DB kosong akan
    gagal. Tiket ini memperluas guard ke semua pintu input dan memberi pilihan
    yang jelas di UI, bukan error buntu.
  - **Langkah:**
    1. Buat komponen/helper guard saldo awal yang menampilkan modal:
       "Belum ada saldo awal. Isi saldo awal dulu, atau mulai tanpa saldo awal."
       Tombol: **Isi Saldo Awal** dan **Mulai tanpa saldo awal**.
    2. Terapkan di `TransaksiForm`, `JurnalUmumEditor`, `PanjarTab` (serah/close),
       `PihakTab`, dan `ImportExcelTab`.
    3. Teruskan `wajibSaldoAwal: true` + `konfirmasiTanpaSaldoAwal` ke API/IPC:
       `jurnal:posting`, `saldo-awal:posting`, `pihak:posting`,
       `panjar:create`/`panjar:close`, `import:proses`. Jalur Pihak/Panjar/
       Import baru ikut diwajibkan di tiket ini.
    4. Jangan tampilkan modal lagi setelah operator memilih "mulai tanpa saldo
       awal" pada sesi itu; simpan pilihan di state/option.
  - **DoD:** Tidak ada jurnal pertama dari UI yang tersimpan tanpa pilihan
    eksplisit; tombol **Isi Saldo Awal** membuka wizard; pilihan "mulai tanpa"
    benar-benar meneruskan flag ke backend.
  - **Test:** test payload/IPC untuk flag; test render/teks modal (statis) bila
    pola UI test sudah ada.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** AKT-01.

- [x] **AKT-03 — Tegakkan tanggal mulai pembukuan sebagai batas bawah** · P1 · M (2026-10-29: typecheck bersih; 622/622 test hijau (53 file); `simpanSaldoAwal` menulis `akuntansi_tanggal_mulai` atomik bersama jurnal + audit; `PostingContext.tanggalMulaiPembukuan` diisi `buatKonteksPosting`; `validasiJurnal` menolak tanggal sebelum batas dengan pesan `Tanggal jurnal sebelum tanggal mulai pembukuan (YYYY-MM-DD).` kecuali `SALDO_AWAL`; setting kosong tetap tanpa batas; `simpanPengaturanPembukuan` menolak tanggal setelah jurnal paling awal dan pengosongan nilai lama tanpa `konfirmasiKosongkanTanggalMulai`; bypass `insertJurnal` dicatat sebagai dependensi AKT-25)
  - **Konteks:** `tanggalMulaiPembukuan` disimpan, ditampilkan, dan divalidasi,
    tetapi `tanggalMulaiEfektif()` tidak dipakai di produksi. Jurnal bertanggal
    sebelum saldo awal bisa membuat saldo awal dobel hitung.
  - **Langkah:**
    1. Saat `simpanSaldoAwal` berhasil, tulis
       `KUNCI_AKUNTANSI_TANGGAL_MULAI` = tanggal jurnal saldo awal, dalam
       transaksi yang sama dengan jurnal + audit.
    2. Tambah `tanggalMulaiPembukuan?: string` ke `PostingContext`;
       `buatKonteksPosting` membaca `getPengaturanPembukuan(db)`.
    3. Di `validasiJurnal`, tolak tanggal `< tanggalMulaiPembukuan` kecuali
       `header.jenis === 'SALDO_AWAL'`. Pesan:
       `Tanggal jurnal sebelum tanggal mulai pembukuan (YYYY-MM-DD).`
    4. Bila setting kosong, tidak ada batas (kompatibel data lama).
    5. Di `simpanPengaturanPembukuan`, tolak tanggal mulai yang **setelah**
       jurnal paling awal (kecuali belum ada jurnal) agar setting tidak
       bertentangan dengan data yang sudah ada. Jangan izinkan mengosongkan
       tanggal mulai bila sudah ada jurnal/saldo awal; minta konfirmasi khusus
       bila benar-benar perlu.
    6. Pastikan `insertJurnal` langsung tidak menjadi jalan bypass permanen;
       catat sebagai dependensi AKT-25.
  - **DoD:** Saldo awal 2025-01-01 → jurnal 2024-12-31 ditolak; jurnal
    2025-01-01 diterima; setting manual juga ditegakkan; setting kosong tetap
    boleh.
  - **Test:** `tests/saldo-awal.test.ts` + `tests/posting.test.ts`; uji juga
    `SALDO_AWAL` bertanggal lain.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** AKT-01.

- [x] **AKT-04 — Peringatan kas minus untuk tanggal setelah jurnal** · P1 · M (2026-10-29: typecheck bersih; 627/627 test hijau (53 file); `PostingContext.kasMinimumSetelah` diisi `buatKonteksPosting` dari minimum cumulative sum mutasi kas setelah tanggal jurnal (agregasi per jurnal, urut tanggal+id, mulai 0); `validasiJurnal` menilai saldo terburuk `saldoAwal + delta + kasMinimumSetelah` dan hanya memberi satu peringatan per akun; skenario 1 Jan kas Rp 1.000, 10 Jan keluar Rp 800, backdate 5 Jan keluar Rp 300 kini memperingatkan minus Rp 100,00)
  - **Konteks:** `buatKonteksPosting` hanya menjumlah `j.tanggal <= tanggal
    jurnal`; validator hanya memeriksa saldo pada tanggal itu. Backdate bisa
    membuat saldo negatif di tanggal berikutnya tanpa peringatan.
  - **Langkah:**
    1. Tambah `kasMinimumSetelah?: Record<string, number>` ke `PostingContext`.
    2. Di `buatKonteksPosting`, untuk setiap akun kas hitung **minimum
       cumulative sum** mutasi kas dengan `j.tanggal > tanggal jurnal` (termasuk
       0 bila tidak ada). Ini mewakili tambahan terburuk setelah tanggal jurnal.
    3. Di `validasiJurnal`, untuk setiap `deltaKas`:
       `saldoAwal + delta + (kasMinimumSetelah[kode] ?? 0) < 0` → peringatan
       minus, walaupun saldo pada tanggal jurnal sendiri masih positif.
    4. Hindari peringatan ganda: bila saldo pada tanggal jurnal sudah minus,
       cukup satu pesan dengan nominal minus terburuk.
  - **DoD:** Skenario 1 Jan kas 100, 10 Jan keluar 80, backdate 5 Jan keluar 30
    → peringatan, bukan `peringatan: []`.
  - **Test:** `tests/posting.test.ts`: skenario di atas; kas cukup → tidak ada
    peringatan; tanpa mutasi setelahnya → perilaku lama.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-05 — Default tanggal reversal = tanggal jurnal asli** · P1 · S (2026-10-29: typecheck bersih; 629/629 test hijau (53 file); `rencanaUntuk` mengambil detail jurnal sebelum menyusun rencana dan default `tanggal` = `detail.jurnal.tanggal`; `opsi.tanggal` eksplisit tetap menang termasuk lintas tahun; test reversal 2025 tanpa tanggal menjaga laba 2025 kembali nol dan laba 2026 tidak berubah, plus test tanggal eksplisit lintas tahun)
  - **Konteks:** `reverseJurnal` memakai `hariIni()` bila `opsi.tanggal` kosong
    (`src/db/reversal.ts`), sedangkan UI dan dokumentasi memakai tanggal asli.
    Koreksi jurnal 2025 lewat API bisa menggeser laba ke 2026.
  - **Langkah:**
    1. Ambil `detail` jurnal sebelum menyusun rencana; default `tanggal` =
       `detail.jurnal.tanggal`.
    2. `opsi.tanggal` eksplisit tetap menang.
    3. Bila tanggal eksplisit berbeda tahun dari asli, biarkan (UI sudah
       memperingatkan), tetapi jangan mengubah default.
  - **DoD:** `reverseJurnal(db, id, alasan)` tanpa `tanggal` menghasilkan
    reversal bertanggal sama dengan jurnal asli.
  - **Test:** `tests/reversal.test.ts`: reversal 2025 tanpa tanggal; cek
    `labaTahun(2025)` tetap dan `labaTahun(2026)` tidak berubah.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-06 — Audit override: peringatan + konfirmasi + alasan** · P1 · M (2026-10-29: typecheck bersih; 634/634 test hijau (53 file); `OpsiPosting`/`OpsiSimpanSaldoAwal` menerima `alasanPeringatan` + `wajibAlasanPeringatan`, konfirmasi peringatan tanpa alasan ≥5 karakter ditolak sebelum tulis jurnal/audit; audit `CREATE`/`SALDO-AWAL` dengan peringatan memuat `peringatan`, `konfirmasiPeringatan`, `alasanPeringatan`, sedangkan jurnal tanpa peringatan tetap `{ jurnal, baris }`; `jurnal:posting` & `saldo-awal:posting` meneruskan opsi ini sementara Pihak/Panjar tetap kompatibel)
  - **Konteks:** `postingJurnal` menyimpan audit `CREATE` dengan alasan dari
    `input.alasan` saja. Konfirmasi kas minus/peringatan lain tidak punya alasan
    dan tidak tercatat sebagai override.
  - **Langkah:**
    1. Tambah `alasanPeringatan?: string` dan
       `wajibAlasanPeringatan?: boolean` ke `OpsiPosting`.
    2. Bila ada `peringatan`, `konfirmasiPeringatan === true`, dan
       `wajibAlasanPeringatan === true`, wajibkan
       `alasanPeringatan.trim().length >= 5`; bila tidak, kembalikan
       `tersimpan:false`, `perluKonfirmasi:true`, dan pesan yang jelas.
    3. `jurnal:posting` dan `saldo-awal:posting` mengirim
       `wajibAlasanPeringatan: true` (teruskan lewat `OpsiSimpanSaldoAwal`).
       Jalur Pihak/Panjar belum diwajibkan di tiket ini; AKT-08 yang
       menambahkan.
    4. Simpan ke audit `data_baru_json`: daftar `peringatan`, status konfirmasi,
       dan `alasanPeringatan`.
    5. Jangan mengubah audit `CREATE` generik untuk jurnal tanpa peringatan.
  - **DoD:** Konfirmasi kas minus via `jurnal:posting`/`saldo-awal:posting`
    tanpa alasan ditolak; dengan alasan tersimpan; audit memuat peringatan +
    alasan. Jalur Pihak/Panjar tetap kompatibel sampai AKT-08.
  - **Test:** `tests/posting.test.ts`; baca `listAuditLog` dan parse JSON.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-07 — UI alasan konfirmasi Transaksi/Jurnal Umum/Saldo Awal** · P1 · M (2026-10-29: typecheck bersih; 639/639 test hijau (54 file); `PeringatanModal` mewajibkan alasan ≥5 karakter dan menonaktifkan tombol "Ya, tetap simpan" sampai cukup; `FormTransaksiTerpandu`, `JurnalUmumEditor`, dan `SaldoAwalWizard` mengirim `alasanPeringatan` + `wajibAlasanPeringatan: true` lewat `jurnalPosting`/`saldoAwalPosting`; alasan kunci periode tetap terpisah di `LockModal` dan dipertahankan saat retry; penolakan backend ditampilkan di modal agar bisa diperbaiki; build sukses)
  - **Konteks:** Setelah AKT-06, tombol "Ya, tetap simpan" tanpa field alasan
    akan selalu gagal.
  - **Langkah:**
    1. Buat modal/field alasan (min. 5 karakter) untuk konfirmasi peringatan.
    2. Terapkan di `TransaksiForm`, `JurnalUmumEditor`, dan `SaldoAwalWizard`.
    3. Teruskan `alasanPeringatan` + `wajibAlasanPeringatan: true` lewat API
       (`jurnalPosting`, `saldoAwalPosting`) dan IPC.
    4. Jangan mencampur alasan kunci periode (`LockModal`) dengan alasan
       peringatan; tampilkan field yang sesuai.
  - **DoD:** Tidak ada tombol konfirmasi tanpa alasan; alasan sampai ke audit;
    alasan kunci periode tidak hilang.
  - **Test:** guard payload/IPC + test render teks modal (pola
    `tests/forms-ui.test.ts`).
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** AKT-06.

- [x] **AKT-08 — UI/API alasan overbalance Pihak & overrun Panjar** · P1 · M (2026-10-29: typecheck bersih; 643/643 test hijau (54 file); build sukses; `postingPihak`/`closePanjarV2` mewajibkan `alasanSaldo`/`alasanKurang` ≥5 karakter saat konfirmasi overbalance/overrun dan menolak sebelum jurnal/audit ditulis; `wajibAlasanPeringatan: true` + `alasanPeringatan` diteruskan untuk peringatan kas; audit `data_baru_json` memuat `nominalLebih`/`nominalKurang` + alasan; checkbox setuju Pihak/Panjar diganti `PeringatanModal`)
  - **Konteks:** `postingPihak` bisa menyimpan pelunasan melebihi saldo pihak
    lewat `konfirmasiSaldo`; `closePanjarV2` bisa menyimpan realisasi melebihi
    panjar lewat `konfirmasiKurang`. Keduanya hanya checkbox tanpa alasan, dan
    audit tidak menyimpan alasan override.
  - **Langkah:**
    1. Tambah `alasanSaldo?`/`alasanPeringatan?` pada input pihak dan
       `alasanKurang?`/`alasanPeringatan?` pada close panjar.
    2. Overbalance/overrun adalah aturan adapter, bukan `validasiJurnal`:
       wajibkan `alasanSaldo`/`alasanKurang` min. 5 karakter di `postingPihak`/
       `closePanjarV2` dan masukkan ke audit `data_baru_json`.
    3. Untuk peringatan kas dari `postingJurnal`, kirim
       `wajibAlasanPeringatan: true` + `alasanPeringatan`.
    4. Ganti checkbox "setuju" di `PihakTab`/`PanjarTab` dengan modal alasan.
    5. Pesan error harus menyebut nominal lebih/kurang dan meminta alasan.
  - **DoD:** Overbalance/overrun tanpa alasan ditolak; dengan alasan tersimpan;
    audit memuat nominal dan alasan.
  - **Test:** `tests/pihak.test.ts`, `tests/panjar.test.ts`, dan test UI statis.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** AKT-06.

- [x] **AKT-09 — Modul audit integritas akuntansi** · P1 · M (2026-10-29: typecheck bersih; 652/652 test hijau (55 file); `src/db/integritas.ts` mendeteksi jurnal tidak seimbang, jurnal <2 baris, akun asing, baris orphan, pelanggaran `PRAGMA foreign_key_check`, nomor bukti duplikat per tahun, panjar CLOSED tidak lengkap, dan panjar OPEN yang punya `jurnal_close_id`; DB bersih → `ok:true`; saldo kas negatif tidak dijadikan hard failure)
  - **Konteks:** Trigger v9 hanya menjaga satu baris dan immutability; tidak ada
    yang menjamin total debit = total kredit per jurnal di DB. Backup/restore
    juga belum memeriksa integritas akuntansi.
  - **Langkah:**
    1. Buat `src/db/integritas.ts` dengan
       `auditIntegritas(db): { ok: boolean; temuan: Temuan[] }`.
    2. Periksa minimal:
       - jurnal dengan `SUM(debit) <> SUM(kredit)`;
       - jurnal dengan `< 2` baris;
       - baris dengan `akun_kode` tidak ada di `akun`;
       - baris orphan (`jurnal_id` tidak ada);
       - `PRAGMA foreign_key_check`;
       - nomor bukti duplikat per tahun (jika index hilang/rusak);
       - `panjar` CLOSED tanpa `jurnal_close_id`/`tanggal_close`, atau OPEN
         dengan `jurnal_close_id`.
    3. Kembalikan pesan berbahasa Indonesia + jumlah temuan; jangan melempar
       error untuk temuan (kecuali DB tidak bisa dibaca).
    4. Jangan memasukkan saldo kas negatif sebagai hard failure; itu peringatan
       terpisah.
  - **DoD:** DB bersih → `ok:true`; setiap korupsi yang di-seed lewat SQL
    langsung terdeteksi.
  - **Test:** `tests/integritas.test.ts` (baru), satu test per jenis temuan.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-10 — Tutup buku menolak jika audit integritas gagal** · P1 · S (2026-10-29: typecheck bersih; 654/654 test hijau (55 file); `previewTutupBuku` & `tutupBuku` memanggil `auditIntegritas`, menolak dengan daftar kode/pesan bila DB tidak lolos, dan tidak menulis penanda/audit; jurnal tidak seimbang via SQL diuji di `tests/tutup.test.ts`)
  - **Konteks:** `tutupBuku` hanya menghitung laba; jurnal tidak seimbang/akun
    asing tidak dicek. Saya reproduksi jurnal tidak seimbang langsung di SQLite
    dan `tutupBuku(2025)` tetap `tersimpan:true`.
  - **Langkah:**
    1. Panggil `auditIntegritas(db)` di `previewTutupBuku` dan `tutupBuku`.
    2. Bila `!ok`, kembalikan `boleh:false`, `errors` berisi ringkasan temuan,
       dan `tersimpan:false`.
    3. Tampilkan temuan di `TutupTab` (minimal daftar kode/pesan).
  - **DoD:** Jurnal tidak seimbang → tutup buku ditolak; DB bersih → perilaku
    lama.
  - **Test:** `tests/tutup.test.ts` dengan DB yang dikorupsi lewat SQL.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** AKT-09.

- [x] **AKT-11 — Restore menolak backup yang tidak lolos audit integritas** · P1 · S (2026-10-29: typecheck bersih; 656/656 test hijau (55 file); `validasiKandidatRestore` membuka kandidat readonly lalu menjalankan `auditIntegritas` (termasuk `PRAGMA foreign_key_check`) setelah cek tabel wajib; temuan apa pun -> `valid:false` dengan ringkasan + pesan "Backup tidak lolos audit akuntansi. Pilih backup lain."; kandidat selalu ditutup di `finally`; test di `tests/backup-restore.test.ts` memastikan jurnal tidak seimbang/akun asing ditolak sebelum DB aktif disentuh dan backup sehat tetap `valid:true`)
  - **Konteks:** `validasiKandidatRestore` hanya `integrity_check` SQLite dan
    keberadaan tabel. Backup yang secara SQLite valid tetapi punya jurnal tidak
    seimbang/akun asing bisa lolos.
  - **Langkah:**
    1. Setelah cek tabel wajib, buka kandidat readonly dan jalankan
       `auditIntegritas(kandidat)` + `PRAGMA foreign_key_check`.
    2. Bila ada temuan, kembalikan `valid:false` dengan ringkasan dan pesan
       "Backup tidak lolos audit akuntansi. Pilih backup lain."
    3. Pastikan kandidat tetap ditutup di `finally`.
  - **DoD:** Backup dengan jurnal tidak seimbang ditolak sebelum DB aktif
    disentuh.
  - **Test:** `tests/backup-restore.test.ts` atau test baru yang membuat file
    backup rusak.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** AKT-09.

- [x] **AKT-12 — Tutup buku berurutan / cegah lompat tahun** · P1 · S (2026-10-29: typecheck bersih; 661/661 test hijau (55 file); `KonteksValidasiTutup.tahunAdaJurnal` dipakai `validasiTutupBuku` untuk menolak penutupan baru bila tahun lebih lama berjurnal belum ditutup—daftar tahun diurutkan dan disebut di pesan—sementara `TUTUP-ULANG` tidak terkena aturan ini dan tahun tanpa jurnal boleh dilewati; `previewTutupBuku`/`tutupBuku` mengisi data dari `SELECT DISTINCT substr(tanggal,1,4) FROM jurnal`; test pure + DB di `tests/tutup.test.ts`)
  - **Konteks:** `validasiTutupBuku` hanya menolak tahun yang lebih kecil dari
    tahun tutup terakhir. 2025 bisa ditutup lebih dulu, lalu 2024 ditolak
    selamanya. Laba 2024 tidak pernah masuk `labaDitahan`.
  - **Langkah:**
    1. Tambah `tahunAdaJurnal: number[]` ke `KonteksValidasiTutup`.
    2. Untuk penutupan baru, tolak bila ada tahun `< angka` yang punya jurnal
       tetapi belum ada di `tutup`; pesan menyebut tahun yang harus ditutup dulu.
    3. Untuk `TUTUP-ULANG`, jangan terapkan aturan ini.
    4. Adapter `previewTutupBuku`/`tutupBuku` mengisi `tahunAdaJurnal` dari
       `SELECT DISTINCT substr(tanggal,1,4) FROM jurnal`.
  - **DoD:** Tutup 2025 saat 2024 punya jurnal → ditolak; 2024 lalu 2025 →
    diterima; tahun tanpa jurnal boleh dilewati.
  - **Test:** `tests/tutup.test.ts` (pure + DB).
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-13 — Laporan anggaran tetap jalan saat akun pagu nonaktif** · P1 · S (2026-10-29: typecheck bersih; 664/664 test hijau (55 file); `validasiBarisAnggaran` menerima opsi `{ izinkanNonaktif }` sehingga pagu tersimpan akun nonaktif tetap divalidasi kode/tipe/nominalnya, sementara `simpanAnggaran` dari form tetap memakai default yang menolak akun nonaktif; `hitungRealisasiAnggaran` memakai mode izin tersebut tanpa mengubah rumus realisasi/sisa; test DoD di `tests/anggaran.test.ts` membuat akun 5011 + jurnal + pagu, menonaktifkannya, memastikan laporan tetap terbuka dengan angka yang sama, lalu memastikan pagu baru ditolak tanpa mengubah pagu/audit)
  - **Konteks:** `hitungRealisasiAnggaran` memvalidasi pagu tersimpan dengan
    `validasiBarisAnggaran`, yang menolak akun nonaktif. Setelah akun dinonaktifkan,
    seluruh laporan anggaran error.
  - **Langkah:**
    1. Tambah opsi `{ izinkanNonaktif?: boolean }` pada
       `validasiBarisAnggaran` atau buat helper `validasiAnggaranTersimpan`.
    2. `hitungRealisasiAnggaran` memakai mode yang mengizinkan akun nonaktif
       (kode harus tetap dikenal; nominal tetap valid).
    3. Pagu baru dari form tetap menolak akun nonaktif.
  - **DoD:** Akun 5011 punya pagu + jurnal, lalu dinonaktifkan → laporan
    anggaran tetap terbuka dan menampilkan realisasi.
  - **Test:** `tests/anggaran.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-14 — Tolak/tandai tanggal jurnal di masa depan** · P1 · S (2026-10-29: typecheck bersih; 666/666 test hijau (55 file); `PostingContext.sekarang` diisi `buatKonteksPosting` dengan `tanggalLokal()` WITA (bukan `toISOString`); `validasiJurnal` menolak `header.tanggal > ctx.sekarang` dengan pesan `Tanggal jurnal tidak boleh di masa depan.` sementara tanggal hari ini tetap diterima; `OpsiPosting.sekarang` diteruskan `postingJurnal`/`postingSaldoAwal` dan `validasiJurnalDb` menerima opsi `sekarang` tanpa mengubah pemanggil lama; `insertJurnal` tidak diubah (bypass menyusul AKT-25); test dengan `sekarang` eksplisit: 2026-01-10 diterima, 2026-01-11 ditolak lewat `validasiJurnalDb` + `postingJurnal` tanpa jurnal/audit tertulis, plus konteks default terbukti memakai tanggal WITA via fake timer)
  - **Konteks:** `validasiJurnal` tidak menolak tanggal setelah hari ini. P&L/Arus
    Kas tanpa `sampai` bisa memasukkan transaksi 2027, sedangkan Neraca per hari
    ini tidak.
  - **Langkah:**
    1. Tambah `sekarang?: string` ke `PostingContext`; `buatKonteksPosting`
       memakai `tanggalLokal()`.
    2. `validasiJurnal` menolak `header.tanggal > ctx.sekarang` dengan pesan
       "Tanggal jurnal tidak boleh di masa depan."
    3. Sediakan `OpsiPosting.sekarang`/context injection untuk test yang butuh
       tanggal tetap.
    4. Jangan mengubah `insertJurnal` langsung; itu ditangani AKT-25.
  - **DoD:** Tanggal besok ditolak; hari ini diterima; test tidak bergantung
    tanggal mesin.
  - **Test:** `tests/posting.test.ts` dengan `sekarang` eksplisit.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-15 — Default periode Laba Rugi & Arus Kas ke periode berjalan** · P1 · S (2026-10-29: typecheck bersih; 673/673 test hijau (56 file); build electron-vite bersih; helper murni `periodeBerjalan(sekarang)` di `src/utils/tanggal.ts` memakai `tanggalLokal()` WITA sehingga `mulai` = 1 Januari tahun berjalan dan `sampai` = hari ini; `LabaRugiTab` dan `ArusKasTab` menginisialisasi filter dari helper tersebut (parameter `sekarang` hanya untuk test) dan menampilkan “Periode aktif …” dengan tombol “Semua tanggal” tetap mengosongkan filter untuk seluruh riwayat; kop export memakai `data.mulai`/`data.sampai` sehingga default menampilkan periode berjalan, bukan “SEMUA PERIODE”; perhitungan laporan tidak diubah; test `tests/laporan-periode.test.ts` mencakup helper WITA/pergantian tahun, label periode, kop, dan render statis kedua tab)
  - **Konteks:** `LabaRugiTab` dan `ArusKasTab` default mengosongkan tanggal;
    laporan berarti seluruh riwayat (termasuk transaksi masa depan). Dashboard
    dan Neraca memakai cut-off hari ini, jadi angkanya tidak konsisten.
  - **Langkah:**
    1. Inisialisasi `mulai` = 1 Januari tahun berjalan dan `sampai` = hari ini
       (WITA) di kedua tab.
    2. Tombol "Semua tanggal" tetap ada untuk melihat riwayat, tetapi beri label
       periode yang jelas.
    3. Pertimbangkan helper murni `periodeBerjalan(sekarang)` agar bisa diuji.
  - **DoD:** Buka tab tanpa mengubah filter → kop menampilkan periode berjalan,
    bukan "seluruh riwayat"; "Semua tanggal" tetap berfungsi.
  - **Test:** helper murni + test render/teks.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** AKT-14.

- [x] **AKT-16 — Larang jurnal penutup manual P&L → ekuitas** · P1 · M (2026-10-29: typecheck bersih; 679/679 test hijau (56 file); `validasiJurnal` mengumpulkan tipe akun dari `ctx.akun` per kode dan menolak jurnal yang memakai PENDAPATAN/BEBAN sekaligus EKUITAS dengan pesan `PESAN_JURNAL_PENUTUP_MANUAL`; `SALDO_AWAL` dikecualikan sehingga jurnal modal/saldo awal tetap sah; penolakan terjadi sebelum transaksi tulis sehingga jurnal, baris, dan audit tidak tersimpan; test `tests/posting.test.ts` mencakup D 4005/K 3000, D 5000/K 3000, dan D 3000/K 5000 ditolak tanpa jejak, serta P&L murni, beban/kas, kas/modal, dan SALDO_AWAL tetap boleh; jenis `PENUTUP` resmi tetap backlog terpisah)
  - **Konteks:** Sistem mengasumsikan tidak ada jurnal penutup manual, tetapi
    Jurnal Umum bisa menutup P&L ke 3000. Setelah itu `labaTahun` dan riwayat
    tutup buku menjadi 0, walaupun Neraca tetap balance.
  - **Langkah:**
    1. [x] Di `validasiJurnal`, deteksi jurnal yang memakai akun PENDAPATAN/BEBAN
       dan EKUITAS sekaligus.
    2. [x] Tolak dengan pesan: "Jurnal penutup manual tidak didukung. Tutup buku
       hanya penanda; gunakan menu Tutup Buku. Untuk pembayaran beban oleh
       pemilik, buat dua jurnal: beban/kas lalu kas/modal."
    3. [x] Jangan blokir `SALDO_AWAL` (tidak memakai P&L) dan jurnal modal murni
       (tanpa P&L).
    4. [x] Bila nanti dibutuhkan alur penutup resmi, buat jenis `PENUTUP` terpisah;
       jangan longgarkan aturan ini diam-diam.
  - **DoD:** Jurnal D 4005 / K 3000 ditolak; D beban / K kas dan D kas / K 3000
    tetap boleh.
  - **Test:** `tests/posting.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-17 — Reklasifikasi arus kas pinjaman 1050 ke investasi** · P1 · S (2026-10-29: typecheck bersih; 682/682 test hijau (56 file); `arusKas` tidak lagi memasukkan `AKUN_PIUTANG` ke kondisi OPERASI; lawan 1050 (AKTIVA non-kas) masuk INVESTASI sehingga beri pinjaman = INVESTASI keluar dan pelunasan = INVESTASI masuk; 1040 panjar tetap OPERASI; total masuk/keluar/kenaikan/saldo akhir tidak berubah; test tiga skenario di `tests/laporan.test.ts`)
  - **Konteks:** `arusKas` memasukkan `1050` ke OPERASI. Pemberian pinjaman
    kepada pihak lain umumnya arus kas INVESTASI.
  - **Langkah:**
    1. Hapus `AKUN_PIUTANG` dari kondisi OPERASI.
    2. Masukkan `AKUN_PIUTANG` ke kelompok INVESTASI (AKTIVA non-kas).
    3. Pertahankan `1040` (panjar) sebagai OPERASI.
  - **DoD:** Beri pinjaman → INVESTASI keluar; terima pelunasan → INVESTASI
    masuk; panjar tetap OPERASI.
  - **Test:** `tests/laporan.test.ts` atau `tests/arus-kas.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-18 — Pisahkan transfer dan biaya pada jurnal kas gabungan** · P1 · M (2026-10-29: typecheck bersih; 687/687 test hijau (56 file); `arusKas` memisahkan jurnal yang punya kas masuk dan kas keluar sekaligus dengan akun non-kas: porsi transfer = `min(total neto masuk, total neto keluar)` dialokasikan FIFO per arah (sisa masuk dan sisa keluar terpisah) sehingga deterministik, tanpa pecahan, dan tidak melebihi neto tiap dompet; baris TRANSFER dipisah dari baris OPERASI/INVESTASI/PENDANAAN yang mengikuti sifat akun non-kas; `totalMasuk`/`totalKeluar` mengecualikan transfer dan `saldoAkhir = saldoAwal + kenaikan` tetap; contoh D bank 100 / D beban 5 / K kas 105 → transfer 100/100 + operasi keluar 5; test `tests/laporan.test.ts` lima skenario: kas keluar>masuk, kas masuk>keluar, transfer murni tanpa non-kas, banyak dompet/non-kas, dan sisa piutang→INVESTASI)
  - **Konteks:** Jurnal D bank 100 / D beban 5 / K kas 105 dianggap satu arus
    OPERASI: masuk 100 dan keluar 105. Padahal 100 adalah transfer internal,
    hanya 5 biaya operasi.
  - **Langkah:**
    1. Di `arusKas`, bila grup punya kas masuk dan kas keluar **serta** akun
       non-kas, pisahkan porsi transfer = `min(total kas masuk, total kas keluar)`.
    2. Buat baris transfer untuk porsi itu (kelompok TRANSFER) dan baris
       operasi/investasi/pendanaan untuk sisanya.
    3. Pastikan `totalMasuk`/`totalKeluar` tetap mengecualikan transfer dan
       `saldoAkhir = saldoAwal + kenaikan` tidak berubah.
    4. Dokumentasikan algoritma alokasi bila ada beberapa akun kas.
  - **DoD:** Contoh di atas menghasilkan transfer 100 (masuk/keluar) + operasi
    keluar 5; total kas akhir benar.
  - **Test:** `tests/laporan.test.ts` dengan jurnal 3 baris.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [x] **AKT-19 — Desain pemisahan utang usaha vs pinjaman (2050)** · P1 · S (2026-10-29: desain docs/desain-arus-kas-2050.md; typecheck/test tetap 687 hijau)
  - **Konteks:** `2050` dipakai untuk utang usaha (beli kredit) dan pinjaman.
    Arus kas pembayaran keduanya tidak bisa dibedakan; saat ini semuanya
    PENDANAAN.
  - **Langkah:**
    1. Tulis `docs/desain-arus-kas-2050.md` yang membandingkan minimal:
       - akun COA baru (`2050` utang usaha, akun baru utang pinjaman),
       - metadata `kategori_arus_kas` pada jurnal/pihak,
       - pemilihan jenis utang di form Pihak.
    2. Rekomendasikan satu opsi, termasuk migrasi data 2050 lama, dampak
       laporan, dan kompatibilitas backup.
    3. Jangan mengubah kode produksi di tiket ini.
  - **DoD:** ada keputusan tertulis + dampak + rencana migrasi; siap dipakai
    AKT-20.
  - **Test:** review dokumen; tidak ada test kode.
  - **Verifikasi:** `npm run typecheck && npm test` (tidak berubah).
  - **Dependency:** —

- [x] **AKT-20 — Implementasi klasifikasi arus kas 2050** · P1 · M (2026-10-29: Opsi A′ dijalankan—COA `2060 HUTANG USAHA` + `SCHEMA_VERSION` 10 dengan migrasi idempoten; form/IPC Pihak enam alur (beli kredit & bayar utang usaha 2060, pinjaman 2050); `arusKas` 2060 → OPERASI dan 2050 → PENDANAAN; saldo/rekonsiliasi pihak 2050/2060; typecheck bersih; 699/699 test hijau (57 file); build sukses; migrasi v9→v10 + backup/restore v9 teruji)
  - **Konteks:** Melanjutkan AKT-19. Tanpa ini, laporan Arus Kas masih salah
    untuk pembayaran utang usaha.
  - **Langkah:**
    1. Ikuti keputusan AKT-19; jangan mulai sebelum desain disetujui.
    2. Bila memilih metadata: tambah kolom/migrasi, isi dari form Pihak
       (`BELI_KREDIT`/pembayaran utang usaha → OPERASI; pinjaman → PENDANAAN),
       dan baca di `arusKas`.
    3. Bila memilih akun baru: seed COA, ubah form/builder, migrasikan saldo
       2050 lama dengan jurnal reklasifikasi yang dapat diaudit.
    4. Tambah test: bayar utang usaha → OPERASI; bayar pinjaman → PENDANAAN;
       data lama tetap fallback.
  - **DoD:** arus kas 2050 sesuai desain; tidak ada perubahan saldo/neraca.
  - **Test:** `tests/laporan.test.ts`, `tests/pihak.test.ts`, test migrasi.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** AKT-19.

---

## Fase B — P2: penting, setelah P1 stabil

- [x] **AKT-21 — Wajib alasan saat menandai rekonsiliasi dengan selisih** · P2 · S (2026-10-29: `selesaikanRekonsiliasi` menghitung ulang saldo buku/selisih dari jurnal sebelum ubah status; selisih ≠ 0 wajib catatan ≥5 karakter (baru atau tersimpan) dan ditolak tanpa mengubah status bila kurang; audit `REKONSILIASI-SELESAI` memuat selisih + catatan; cocok tetap boleh selesai tanpa catatan; item penyesuaian tetap backlog terpisah; typecheck bersih; 703/703 test hijau (57 file))
  - **Konteks:** `selesaikanRekonsiliasi` bisa menandai selesai walau
    `selisih != 0` dan `catatan` kosong. Saya reproduksi selisih Rp100.000,
    `selesai:true`, catatan `""`.
  - **Langkah:**
    1. Sebelum update status, hitung `saldoBuku`/`selisih` untuk rekonsiliasi
       itu.
    2. Bila `selisih !== 0`, wajibkan `catatan` (baru atau lama) minimal 5
       karakter; jika tidak, lempar error yang menyebut selisih.
    3. Audit `REKONSILIASI-SELESAI` memuat selisih + catatan.
    4. Catat di komentar bahwa item penyesuaian (outstanding check, setoran
       dalam perjalanan) adalah backlog terpisah; tiket ini hanya mencegah
       “selesai palsu”.
  - **DoD:** Selisih tanpa catatan ditolak; selisih dengan catatan boleh
    selesai; cocok tanpa catatan tetap boleh.
  - **Test:** `tests/rekonsiliasi.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **AKT-22 — Validasi input koreksi & isi ulang** · P2 · S
  - **Konteks:** `koreksiDanIsiUlang` mengambil `header` dari input. Saya
    reproduksi replacement berjenis `REVERSAL` dengan `reversal_of:null` dan
    `grup_id` diubah dari luar. Ini merusak label/audit dan bisa dibalik lagi.
  - **Langkah:**
    1. Paksa `headerBaru.grup_id` = `grup_id` jurnal asli; abaikan input.
    2. Tolak `inputBaru.header.jenis === 'REVERSAL'`.
    3. Izinkan `SALDO_AWAL` hanya bila jurnal asli juga `SALDO_AWAL`.
    4. Validasi panjang ID/keterangan/no_bukti di IPC dengan validator bentuk
       yang sama seperti jurnal biasa (atau helper khusus koreksi).
    5. Pastikan `reversal_of` tetap `null` untuk replacement.
  - **DoD:** Replacement tidak bisa menjadi REVERSAL palsu; grup selalu sama
    dengan asli; koreksi normal tetap jalan.
  - **Test:** `tests/reversal.test.ts` untuk jenis/grup; test IPC.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **AKT-23 — Cek akun asing di semua laporan** · P2 · S
  - **Konteks:** `neracaSaldo` dan `labaRugi` diam-diam mengabaikan baris dengan
    akun yang tidak ada di COA; `neraca` melempar error. Saya reproduksi
    `neracaSaldo` “seimbang” padahal akun 9998/9999 tidak dikenal.
  - **Langkah:**
    1. Buat helper `pastikanAkunDikenal(baris, daftarAkun)` yang melempar pesan
       sama seperti `neraca`: `Akun X pada jurnal tidak dikenal di COA.`
    2. Panggil di awal `neracaSaldo`, `labaRugi`, `arusKas`, dan `bukuBesar`.
    3. Jangan mengubah perilaku `neraca`/`neracaSaldoPeriode` yang sudah benar.
  - **DoD:** Akun asing pada baris → laporan melempar error yang jelas, bukan
    total palsu.
  - **Test:** `tests/laporan.test.ts` dengan akun 9999.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **AKT-24 — Anti-duplikat import Excel** · P2 · M
  - **Konteks:** Import tidak mewajibkan `no_bukti`; jika kosong, impor ulang
    file yang sama membuat jurnal baru lagi (ID baru, nomor bukti baru).
  - **Keputusan tiket ini:** wajibkan `no_bukti` untuk setiap grup impor.
    Jangan memakai nomor otomatis untuk impor. Fingerprint deterministik
    menjadi backlog terpisah bila nanti diperlukan.
  - **Langkah:**
    1. Parser menolak grup tanpa `no_bukti` dengan pesan:
       `Nomor bukti wajib diisi pada impor agar tidak duplikat.`
    2. Template import menandai kolom `no_bukti` sebagai wajib dan contohnya
       terisi.
    3. Sebelum posting, cek nomor bukti yang sudah ada di tahun yang sama;
       tandai grup `GAGAL: nomor bukti sudah dipakai`.
    4. Tampilkan status duplikat di pratinjau; jangan menyimpan.
    5. Update dokumentasi import.
  - **DoD:** Impor file yang sama dua kali tidak menggandakan jurnal; grup kedua
    gagal dengan alasan jelas; grup tanpa nomor bukti ditolak di pratinjau.
  - **Test:** `tests/impor-excel.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **AKT-25 — Guard `insertJurnal` / jadikan internal** · P2 · M
  - **Konteks:** `insertJurnal` adalah fungsi publik yang melewati sebagian
    aturan posting (kunci periode, konsistensi jenis, peringatan kas minus).
    Saat ini dipakai `koreksiDanIsiUlang`, seed, dan test.
  - **Langkah:**
    1. Pisahkan `insertJurnalTervalidasi` (internal) dan `insertJurnal` (publik)
       atau beri opsi wajib `{ tervalidasi: true }`.
    2. Produksi hanya boleh memakai `postingJurnal` atau jalur koreksi yang
       sudah memvalidasi.
    3. Update test/seed dengan nama fungsi yang jelas.
    4. Jangan mengubah perilaku `postingJurnal`/`koreksiDanIsiUlang`.
  - **DoD:** Tidak ada jalur produksi yang memanggil insert mentah tanpa
    validasi; test/seed tetap jelas.
  - **Test:** `tests/posting.test.ts`, `tests/reversal.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **AKT-26 — Audit log append-only; `tutup_buku` tidak bisa dihapus** · P2 · S
  - **Konteks:** `jurnal` dilindungi trigger, tetapi `audit_log` dan `tutup_buku`
    masih bisa di-update/delete lewat SQL. Audit tidak tamper-evident, tetapi
    minimal jangan bisa dihapus tanpa meninggalkan jejak.
  - **Langkah:**
    1. Migrasi v10: trigger `BEFORE UPDATE/DELETE ON audit_log` → `RAISE(ABORT)`.
    2. Trigger `BEFORE DELETE ON tutup_buku` → `RAISE(ABORT)`; **jangan** blokir
       update, karena tutup ulang memakai `ON CONFLICT DO UPDATE`.
    3. Pastikan `migrasi()` idempoten dan DB lama ikut terlindungi.
  - **DoD:** update/delete audit gagal; delete tutup buku gagal; tutup ulang
    tetap berfungsi.
  - **Test:** `tests/migrasi-v9.test.ts` atau test migrasi baru.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **AKT-27 — Perbaiki dokumentasi 3001/3002, closing, reversal** · P2 · S
  - **Konteks:** `docs/panduan-pemeriksaan.md` menyebut 3001/3002 “dihitung dari
    tutup buku dan surplus”, padahal kode tidak menghitungnya. Dokumentasi juga
    perlu menegaskan larangan jurnal penutup manual dan default tanggal reversal.
  - **Langkah:**
    1. Perbaiki bagian 3001/3002: akun legacy, tidak dapat diposting, saldo
       hanya dari data lama; bukan angka turunan yang dihitung v2.
    2. Tegaskan: tutup buku = penanda; jangan posting jurnal penutup manual.
    3. Samakan default reversal dengan perilaku setelah AKT-05.
    4. Tambah catatan bahwa konfirmasi peringatan wajib alasan (AKT-06).
    5. Cek `docs/arah-akuntansi.md` dan `docs/panduan-pengguna.md` untuk
       pernyataan yang bertentangan.
  - **DoD:** dokumen tidak menjanjikan perilaku yang tidak ada; test dokumentasi
    (jika ada) tetap hijau.
  - **Test:** `tests/dokumentasi.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** AKT-05, AKT-16.

- [ ] **AKT-28 — Rapikan total saldo export, total anggaran, status dashboard** · P2 · S
  - **Konteks:** Tiga presentasi yang bisa menyesatkan:
    - `neracaSaldoToWorkbook` menulis total kolom Saldo = 0, padahal kolom itu
      saldo normal, bukan selisih (`src/features/export/workbooks.ts`);
    - “Total Anggaran & Realisasi” menjumlahkan pendapatan + beban sehingga
      “Sisa” tidak bermakna (`src/core/anggaran.ts`, `RealisasiTab.tsx`);
    - status periode dashboard memakai tahun cut-off, sehingga cut-off historis
      bisa menampilkan “2025 terkunci · 2025 terbuka”.
  - **Langkah:**
    1. Untuk Neraca Saldo: ganti total Saldo menjadi `ns.selisih` dengan label
       “Selisih”, atau kosongkan; test XLSX/HTML.
    2. Untuk Anggaran: tampilkan total pendapatan dan total beban terpisah;
       hapus “total gabungan” atau ganti menjadi “Pendapatan − Beban”; test.
    3. Untuk Dashboard: status “terbuka” memakai tahun acuan hari ini atau
       status per tahun cut-off yang konsisten; test `susunPeriode`.
  - **DoD:** Tidak ada angka total yang salah tafsir; label sesuai isi.
  - **Test:** `tests/export-laporan.test.ts`, `tests/anggaran.test.ts`,
    `tests/dashboard.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **AKT-29 — Ketahanan validasi & tanggal import** · P3 · S
  - **Konteks:** Beberapa kasus kecil tetapi berpotensi error:
    - `validasiJurnal` bisa melempar exception bila `header`/baris null;
    - nominal core/repository memakai `Number.isInteger`, bukan
      `Number.isSafeInteger`;
    - `parseTanggalImpor` memakai `toISOString()` untuk `Date`, yang bisa
      bergeser sehari untuk `Date` lokal WITA;
    - serial Excel 1904 belum diuji.
  - **Langkah:**
    1. Guard `input?.header`/`baris` di `validasiJurnal`; kembalikan error, bukan
       throw.
    2. Ganti `Number.isInteger` → `Number.isSafeInteger` untuk nominal di
       `core/posting.ts`, `core/forms.ts`, `db/repository.ts`, `db/panjar.ts`,
       `core/pihak.ts` (kecuali nilai non-nominal).
    3. `parseTanggalImpor` untuk `Date` memakai `tanggalLokal(nilai)` atau
       komponen lokal yang aman; tambah test WITA.
    4. Tambah test serial 1904 bila ExcelJS mendukung; jika tidak, dokumentasikan
       batasannya.
  - **DoD:** Input null tidak crash; nominal tidak aman ditolak; tanggal import
    tidak bergeser sehari.
  - **Test:** `tests/posting.test.ts`, `tests/impor-excel.test.ts`,
    `tests/tanggal.test.ts`.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

---

## Backlog yang sengaja belum dipecah

Hal-hal berikut bukan tiket kecil; jangan dikerjakan di tengah tiket di atas:

- Alur penyesuaian saldo awal setelah sudah ada jurnal (untuk data lama/instalasi
  yang terlanjur mulai). AKT-01/AKT-02 hanya mencegah kasus baru; penyesuaian
  setelahnya butuh desain agar tidak dobel hitung.
- Rekonsiliasi bank penuh dengan item penyesuaian (outstanding check, setoran
  dalam perjalanan, biaya bank) — desain dulu seperti AKT-19.
- Jurnal penutup resmi + snapshot tutup buku.
- Multi-user/user identity.
- Hash chain audit / tamper-evident audit.
- Enkripsi database (PIN bukan enkripsi).
- Tahun buku fiskal selain Januari.
- Aset tetap & penyusutan (sudah diputuskan dibuang).

---

## Checklist umum sebelum mencentang tiket

- [ ] Regression test untuk kasus yang diperbaiki sudah ada dan gagal sebelum fix.
- [ ] `npm run typecheck` bersih.
- [ ] `npm test` hijau.
- [ ] Untuk perubahan UI/main: `npm run build` hijau.
- [ ] Tidak ada angka turunan baru yang disimpan.
- [ ] Tidak ada jurnal lama yang diedit/dihapus.
- [ ] Audit mencatat alasan/konfirmasi bila ada override.
- [ ] Tiket di file ini diubah `[ ]` → `[x]` + bukti tanggal/hasil test.
- [ ] Commit terpisah: `fix(AKT-xx): ...` / `feat(AKT-xx): ...`.
