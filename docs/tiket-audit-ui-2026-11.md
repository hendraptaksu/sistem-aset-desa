# Tiket Audit UI/UX — November 2026

Hasil evaluasi UI/UX menyeluruh (renderer ~18.000 baris, 6 kelompok layar). Tidak ada
temuan P0. Seri tiket: **UI-A** (audit UI), mengikuti konvensi seri tiket repo
(`T-B`, `UI-`, `DB-`, `AUD-`, …).

Cara pakai: centang kolom Status saat mulai/selesai; kutip ID tiket di judul commit,
mis. `fix(panjar): sembunyikan grid rincian nota sampai target dipilih (UI-A01)`.

| ID | Prioritas | Ringkasan | Usaha | Status |
|----|-----------|-----------|-------|--------|
| UI-A01 | P1 | Panjar: rincian nota bisa terhapus diam-diam saat pilih target | S | ✅ |
| UI-A02 | P1 | Jurnal: KoreksiModal membuang isian saat Escape/klik latar | S | ✅ |
| UI-A03 | P1 | Drill-down Neraca/Neraca Saldo → Buku Besar kehilangan konteks periode | M | ✅ |
| UI-A04 | P1 | Pengaturan: race + spam request filter Riwayat Audit | S | ⬜ |
| UI-A05 | P1 | Pengaturan: form Pembukuan bisa menimpa setting dengan default setelah gagal muat | S | ⬜ |
| UI-A06 | P1 | Pinjaman: feedback aksi di bawah halaman tak terlihat | M | ⬜ |
| UI-A07 | P1 | Pinjaman: tombol "Kartu hutang" tanpa efek terlihat | S | ⬜ |
| UI-A08 | P1 | Temuan audit integritas tidak bisa dilihat ulang; banner menunjuk layar yang salah | M | ⬜ |
| UI-A09 | P1 | ui.tsx: LockModal — alasan di closure, tombol bisa diam tanpa reaksi | S | ⬜ |
| UI-A10 | P2 | Komponen KontrolPeriode bersama untuk semua laporan | L | ⬜ |
| UI-A11 | P2 | InfoBox `role="status"` + feedback tampil dekat aksinya | M | ⬜ |
| UI-A12 | P2 | Konfirmasi seragam sebelum isian user ditimpa | M | ⬜ |
| UI-A13 | P2 | Semua tombol nonaktif punya alasan; "Keterangan (wajib)" | S | ⬜ |
| UI-A14 | P2 | Loading/empty state yang jujur di semua daftar | M | ⬜ |
| UI-A15 | P2 | CurrencyInput ikut `disabled` saat proses berjalan | S | ⬜ |
| UI-A16 | P2 | Bersihkan jargon teknis dari UI | S | ⬜ |
| UI-A17 | P2 | Satukan istilah antar layar (utang, Pulihkan, Mode lanjutan, dst.) | S | ⬜ |
| UI-A18 | P2 | Ringkas wall-of-text di titik keputusan | S | ⬜ |
| UI-A19 | P2 | Perbaiki kebenaran peringatan tanggal koreksi | S | ⬜ |
| UI-A20 | P2 | Blokir Duplikat untuk jurnal SALDO_AWAL/REVERSAL | S | ⬜ |
| UI-A21 | P3 | A11y tabel: aria-label baris klikabel, caption/scope, ekspander, ikon | M | ⬜ |
| UI-A22 | P3 | A11y form & tampilan: label nominal, teks <13px, kontras, LockScreen | M | ⬜ |
| UI-A23 | P3 | State sibuk gabungan per tab | M | ⬜ |
| UI-A24 | P3 | Perbaiki flag dirty (direset aksi lain / palsu saat kosong) | M | ⬜ |
| UI-A25 | P3 | Batasi generator jadwal otomatis dari tenor | S | ⬜ |
| UI-A26 | P3 | Batch perbaikan kecil lintas layar | S | ⬜ |
| UI-A27 | P3 | Perluas `e2e/ui-audit.test.mjs` untuk regresi perbaikan di atas | M | ⬜ |

Status: ⬜ belum · 🔶 berjalan · ✅ selesai · ⛔ batal

---

## P1 — Perbaiki lebih dulu

### UI-A01 · Panjar: rincian nota bisa terhapus diam-diam saat memilih target
- **Area:** `src/renderer/components/PanjarTab.tsx` (form Pertanggungjawaban)
- **Bukti:** grid `{items.map(...)}` dirender tanpa syarat `closeTarget` (~baris 1539),
  sedangkan blok lain di sekitarnya dikondisikan; `pilihUntukClose` (~baris 1132)
  menjalankan `setItems([barisItemBaru()])` + `setCloseDirty(false)` tanpa konfirmasi.
- **Masalah:** grid nota tampil sebelum panjar dipilih (state awal sudah berisi 1 baris
  kosong), jadi operator wajar mengisi nota dulu. Saat memilih panjar, seluruh baris
  hilang tanpa konfirmasi, dan `closeDirty` direset sehingga tab-guard tidak membantu.
- **Dampak:** kehilangan isian diam-diam — pola yang paling merusak kepercayaan operator.
- **Perbaikan:**
  1. Render grid + kotak ringkasan hanya saat `closeTarget` ada.
  2. Jika `closeDirty === true` saat target diganti, tampilkan `KonfirmasiModal`
     "Ganti panjar? Rincian yang sudah diisi akan kosong."
  3. Gate kotak ringkasan "Sisa … kembali ke kas" pada `totalRealisasi > 0`;
     saat kosong tampilkan "Belum ada rincian belanja. Isi nota untuk melihat sisa/kurang."
  4. Saat panjar target dibatalkan (submitBatal / submitBatalSaldoAwal) dan target itu
     `closeId`, kosongkan form PJ + beri tahu di pesan sukses.
- **Verifikasi:** ui-audit: tanpa target → grid tidak ada; isi nota → pilih target →
  muncul konfirmasi; batal panjar target aktif → form PJ bersih.

### UI-A02 · Jurnal: KoreksiModal membuang isian saat Escape/klik latar
- **Area:** `src/renderer/components/JurnalTab.tsx` (KoreksiModal, `batal()` ~baris 701)
- **Bukti:** `onTutup={batal}`; `batal()` langsung `setDirty(false); onBatal()` tanpa cek
  perubahan. Bandingkan `JurnalUmumEditor.tsx:203-210` yang punya `mintaTutup`/`konfirmasiTutup`.
- **Masalah:** Escape / klik latar / tombol × menutup modal tanpa konfirmasi walaupun
  alasan + baris koreksi sudah diubah. (`setDirty` di modal ini juga dead code — modal
  menutupi navigasi; lihat UI-A24.)
- **Dampak:** akuntan kehilangan 10+ baris koreksi karena satu tekan Escape.
- **Perbaikan:** simpan snapshot awal (alasan, tanggalBalik, tanggal, baris); saat
  ditutup via Escape/latar/× dan ada perubahan, tampilkan `KonfirmasiModal`
  "Buang isian koreksi?" sebelum `onBatal()`. Terapkan pola `mintaTutup` milik editor.
- **Verifikasi:** ui-audit: ubah baris → Escape → muncul konfirmasi; tanpa perubahan →
  langsung tutup.

### UI-A03 · Drill-down Neraca/Neraca Saldo → Buku Besar kehilangan konteks periode
- **Area:** `App.tsx:720-734`, `NeracaTab.tsx:78`, `NeracaSaldoTab.tsx:234`,
  `BukuBesarTab.tsx:57-58`
- **Bukti:** `onBukaBukuBesar` hanya membawa kode akun; Buku Besar default
  `mulai='' / sampai=''` ("seluruh riwayat").
- **Masalah:** saldo yang dilihat di Buku Besar dihitung per hari ini, berbeda dari
  angka cut-off Neraca/Neraca Saldo yang barusan diklik — tanpa penjelasan.
- **Dampak:** dua laporan tampak bertentangan; menyerang kepercayaan pada data.
  Bandingkan Laba Rugi yang sudah benar meneruskan periode ke `JurnalAkunModal`
  (`LabaRugiTab.tsx:323-332`).
- **Perbaikan:** `BukuBesarTab` terima prop periode dari sumber drill-down
  (Neraca/Neraca Saldo kumulatif → `sampai = cutoff`; mode tahun → `mulai` awal tahun
  buku), dan header menampilkan periode sumber, mis. "Saldo akhir (per 31 Des 2025)".
- **Verifikasi:** klik baris Neraca per cutoff → Buku Besar terbuka dengan rentang &
  angka saldo akhir yang cocok.

### UI-A04 · Pengaturan: race + spam request pada filter Riwayat Audit
- **Area:** `src/renderer/components/PengaturanTab.tsx` (~baris 228-254, input `fRefId` 702-711)
- **Bukti:** `muatAudit()` dipanggil dari `useEffect` per perubahan filter tanpa
  debounce/penahan respons basi; input teks menembak IPC per ketikan huruf.
- **Dampak:** respons tak berurutan bisa menimpa hasil terbaru — tabel menampilkan data
  yang tidak cocok dengan filter di layar.
- **Perbaikan:** debounce 250–300 ms untuk filter teks + counter ref `idPermintaan`
  (respons lebih lama diabaikan) — tiru pola `SaranNomorBukti.tsx` yang sudah ada.
- **Verifikasi:** mengetik cepat 6 huruf → ≤2 panggilan; hasil akhir selalu terbaru.

### UI-A05 · Pengaturan: form Pembukuan bisa menimpa setting dengan default setelah gagal muat
- **Area:** `src/renderer/components/PengaturanTab.tsx` (state ~197-201, catch ~265-281, form ~523-583)
- **Bukti:** state diinisialisasi `DEFAULT_PENGATURAN`; saat `pengaturanGet()` gagal hanya
  `setErrPembukuan(...)`; form tetap dirender aktif dengan Simpan enabled.
- **Dampak:** kegagalan muat transien + satu klik Simpan = setting tersimpan (nama
  entitas, prefix, kop) tertimpa default diam-diam.
- **Perbaikan:** bila `errPembukuan` ada, render form read-only/disabled + tombol
  "Coba muat ulang"; `Simpan disabled={errPembukuan !== null}`.
- **Verifikasi:** gagalkan muat (dev) → form mati + tombol muat ulang; Simpan tak bisa
  ditekan.

### UI-A06 · Pinjaman: feedback aksi di bawah halaman tak terlihat
- **Area:** `src/renderer/components/PinjamanTab.tsx` (`err`/`info` hanya di kartu atas ~868-873)
- **Bukti:** `setInfo`/`setErr` juga dipakai untuk aksi jauh di bawah: simpan bayar
  (~711), pembatalan pembayaran/pencairan (~767), gagal muat detail (~588).
- **Dampak:** operator tidak melihat konfirmasi "tersimpan" → berisiko bayar dobel.
- **Perbaikan:** pisahkan info/err per seksi mengikuti pola PanjarTab
  (`info/infoClose/infoBatal/infoKoreksi`), atau minimal `scrollIntoView` ke banner
  hasil setelah aksi (pola `PanjarTab.tsx:1110`, `TransaksiForm.tsx:414`).
- **Verifikasi:** simpan bayar angsuran di bawah layar → banner hasil terlihat di viewport.

### UI-A07 · Pinjaman: tombol "Kartu hutang" tanpa efek terlihat
- **Area:** `src/renderer/components/PinjamanTab.tsx` (~1236-1238 → `pilihKartuHutang` ~812)
- **Bukti:** hanya mengubah state kartu mutasi yang berada ±1.500 px di bawah; tanpa
  scroll, tanpa penanda baris aktif.
- **Dampak:** klik → "tidak terjadi apa-apa" → tombol terkesan rusak.
- **Perbaikan:** beri `id="kartu-hutang"` pada kartu mutasi; setelah klik
  `scrollIntoView`, tandai pinjaman aktif (highlight tombol/badge di baris).
- **Verifikasi:** klik → viewport pindah ke kartu mutasi dengan pinjaman yang dipilih.

### UI-A08 · Temuan audit integritas tidak bisa dilihat ulang; banner menunjuk layar yang salah
- **Area:** `AuditAwalBanner.tsx:70-90`, `App.tsx:689-694`, `api.ts:648-649`
- **Bukti:** banner menunjuk "Riwayat Audit", tetapi `api.auditIntegritas()` tidak
  dirender layar mana pun (Riwayat Audit hanya `audit_log`); tombol "Abaikan" tersedia
  juga saat temuan kritis dan menutup untuk seluruh sesi.
- **Dampak:** temuan (termasuk kritis) hilang dari pandangan setelah banner ditutup,
  sampai aplikasi direstart.
- **Perbaikan:**
  1. Kartu "Audit Integritas" di Pengaturan yang memanggil `api.auditIntegritas()` dan
     merender daftar lengkap (pola `AuditDetail`).
  2. Tombol banner → kartu itu (dengan scroll/ref).
  3. Untuk temuan kritis: tanpa tombol "Abaikan", atau konfirmasi + indikator kecil
     di header selama belum ditinjau.
  4. Samakan label tujuan ("Buka Audit" vs "Buka Riwayat Audit", `AuditAwalBanner.tsx:72,85`).
- **Verifikasi:** injeksi temuan (dev) → banner → tombol membuka kartu integritas;
  temuan kritis tidak bisa diabaikan sekali klik.

### UI-A09 · ui.tsx: LockModal — alasan di closure, tombol bisa diam tanpa reaksi
- **Area:** `src/renderer/components/ui.tsx:668-686`
- **Bukti:** `let alasan = ''` (variabel biasa) + input uncontrolled; klik
  "Tetap simpan" mengevaluasi closure (`alasan.trim().length >= 5 && onSubmit(...)`).
- **Masalah:** re-render parent saat modal terbuka membuat closure baru dengan
  `alasan=''` — input terlihat terisi tapi klik tidak bereaksi; klik dengan alasan
  < 5 karakter juga senyap tanpa pesan.
- **Dampak:** jalan buntu di modal yang muncul tepat saat simpan ditolak (alur periode
  terkunci: Panjar, Transaksi, Wizard Saldo Awal).
- **Perbaikan:** ganti ke `useState` + `value={alasan}` (pola `PeringatanModal`),
  `disabled={!cukup}` pada tombol, dan helper "Alasan minimal 5 karakter".
- **Verifikasi:** ui-audit: isi alasan → re-render parent → klik → onSubmit terpanggil;
  alasan 3 karakter → tombol mati dengan helper terlihat.

---

## P2 — Pola sistemik & kebenaran

### UI-A10 · Komponen KontrolPeriode bersama untuk semua laporan
- **Area:** `DashboardTab`, `NeracaTab`, `NeracaSaldoTab`, `BukuBesarTab`, `LabaRugiTab`,
  `ArusKasTab` (bukti per layar: `DashboardTab.tsx:403-412`, `BukuBesarTab.tsx:192-224`,
  `LabaRugiTab.tsx:138-165`, `ArusKasTab.tsx:131-158`, `NeracaSaldoTab.tsx:118-129`)
- **Masalah:** 4 pola kontrol berbeda untuk pekerjaan yang sama (manual "Tampilkan" /
  auto + "Hari ini" / "Reset tanggal" / "Semua tanggal"); guard rentang terbalik hanya
  ada di Buku Besar — Laba Rugi & Arus Kas menampilkan "LABA Rp 0" + badge hijau
  **SURPLUS** untuk rentang salah (`LabaRugiTab.tsx:81-105,302-312`, `core/reports.ts:73-74`);
  label periode Laba Rugi/Arus Kas dari input, bukan data hasil (`LabaRugiTab.tsx:110`);
  default Laba Rugi (1 Jan kalender) beda dengan Dashboard (tahun buku) —
  dua angka "laba tahun berjalan" yang tidak sama (`utils/tanggal.ts:80-86`).
- **Perbaikan:**
  1. Komponen `KontrolPeriode` bersama: preset Hari ini / Bulan ini / Tahun berjalan
     (tahun buku) / Semua tanggal; auto-refresh seragam; guard rentang terbalik
     (kotak amber, blok fetch, `aria-invalid`).
  2. Label periode diheader dihitung dari `data.mulai/data.sampai/data.cutoff`.
  3. Samakan default Laba Rugi/Arus Kas dengan rentang tahun buku, atau label eksplisit.
  4. Indikator refresh saat fetch dengan data lama masih tampil (badge "Memperbarui…"
     atau redupkan tabel) — `LabaRugiTab.tsx:188`, `ArusKasTab.tsx:178`, `BukuBesarTab.tsx:269`.
  5. Samakan aturan ekspor laporan kosong (`LabaRugiTab.tsx:178`, `ArusKasTab.tsx:169`
     vs `BukuBesarTab.tsx:248`, `NeracaSaldoTab.tsx:169`).
  6. Dashboard: hint "ubah tanggal lalu klik Tampilkan" atau ikut auto.
- **Verifikasi:** ui-audit: rentang terbalik di 6 layar → pesan sama, fetch diblok;
  label header = data yang tampil.

### UI-A11 · InfoBox `role="status"` + feedback tampil dekat aksinya
- **Area:** `ui.tsx` (komponen baru) + pemakaian di semua tab
- **Bukti:** semua kotak sukses hijau adalah `div` polos tanpa live region
  (`PanjarTab.tsx:1251,1390,1483,1734,1740`; `ExportActions.tsx:171-175`); feedback
  sering dirender jauh dari aksi: `infoKoreksi` di kartu Daftar padahal layar di-scroll
  ke form PJ (`PanjarTab.tsx:1102-1114`); error muat rincian tampil di kartu lain
  (`PanjarTab.tsx:1171`); backup sukses di kartu atas vs tombol di bawah
  (`DashboardTab.tsx:418-426` vs 798); pembatalan dialog file tanpa feedback
  (`DashboardTab.tsx:302,345`); pesan sukses koreksi jurnal isi-ulang pakai UUID mentah
  (`JurnalTab.tsx:767`).
- **Perbaikan:**
  1. Komponen `InfoBox` di `ui.tsx` (`role="status" aria-live="polite"`), pakai di
     semua kotak sukses.
  2. Feedback dirender di seksi aksinya (ikuti pola `infoClose/infoBatal/...` PanjarTab).
  3. Backup/restore: `else setInfo('… dibatalkan. Tidak ada file yang dibuat.')`; salin
     info sukses ke kartu Backup/Restore; toast transaksi sebut nomor bukti
     ("Transaksi tersimpan — TB-2026-0012", `TransaksiForm.tsx:754-757`).
  4. Error muat rincian tampil di baris rincian terkait, bukan kartu lain.
  5. Pesan sukses tanpa UUID — pakai nomor bukti/keterangan.
- **Verifikasi:** pembaca layar mengumumkan hasil aksi; pembatalan dialog file
  menghasilkan pesan.

### UI-A12 · Konfirmasi seragam sebelum isian user ditimpa
- **Area:** beberapa layar
- **Bukti:**
  - Template jurnal menimpa baris tanpa konfirmasi (`JurnalUmumEditor.tsx:266-282`).
  - Wizard Saldo Awal tertutup via latar/×/"Batal" tanpa konfirmasi meski isian
    terberat di aplikasi (`SaldoAwalWizard.tsx:730-732`, `ui.tsx:604-607`).
  - Form bayar pinjaman ditimpa tanpa peringatan saat klik "Bayar Angsuran" baris lain
    (`PinjamanTab.tsx:594-617`; tombol hanya `disabled={bayarBusy || batalBusy}` ~1316).
  - Modal pembatalan pembayaran membuang alasan yang sudah diketik saat backdrop/Escape
    (`PinjamanTab.tsx:2071-2109`).
- **Perbaikan:** pola tunggal: bila form berisi data & belum tersimpan, aksi yang
  menimpa/menutup memunculkan `KonfirmasiModal` "… isian akan hilang". Untuk modal
  pembatalan pinjaman: pertahankan alasan sampai aksi selesai/ganti target.
- **Verifikasi:** ui-audit per kasus: isian → aksi penimpa → muncul konfirmasi.

### UI-A13 · Semua tombol nonaktif punya alasan; "Keterangan (wajib)"
- **Area:** lintas layar; util `alasanTombolNonaktif`/`ALASAN_SIBUK` sudah ada (`ui.tsx:114-130`)
- **Bukti:** Simpan transaksi `disabled={busy || memuat || !formSah}` tanpa alasan,
  label hanya "Keterangan" tanpa "(wajib)" (`TransaksiForm.tsx:1145,613,1031` — pesan
  "Lengkapi tanggal, akun, nominal, dan keterangan…" ~691 tak terjangkau karena tombol mati);
  "Bayar Angsuran" mati diam saat pokok > sisa (`PinjamanTab.tsx:1586-1591`);
  "Catat Panjar Saldo Awal" tanpa alasan (`PanjarTab.tsx:1460-1465`); "Mulai tanpa
  saldo awal" tanpa konsekuensi (`SaldoAwalGuard.tsx:100-118`); Pindah Dana mati senyap
  bila kas < 2 (`TransaksiForm.tsx:359-362`); "Lihat jurnal" tanpa pembayaran
  (`PinjamanTab.tsx:1868-1874`).
- **Perbaikan:** `title={alasanTombolNonaktif(...)}` di semua tombol mati + helper
  terlihat di dekat tombol untuk kasus paling umum; label "Keterangan (wajib)" &
  "Nominal (Rp)"; untuk "Mulai tanpa saldo awal" tambah satu kalimat konsekuensi.
- **Verifikasi:** tabel cek manual per layar; ui-audit: form transaksi kosong →
  alasan "Isi dulu: keterangan" terlihat.

### UI-A14 · Loading/empty state yang jujur di semua daftar
- **Bukti:** "Belum ada panjar." / "Belum ada pinjaman LPD." / "Belum pernah ada periode
  dikunci." tampil sebelum data tiba dan saat muat **gagal** — error dirender di kartu lain
  (`PanjarTab.tsx:599,1946-1952`; `PinjamanTab.tsx:261-276,1617-1623,1163`;
  `TutupTab.tsx:61-67,344-346`); kedipan "Belum ada pembayaran tercatat." saat detail
  dibuka (`PinjamanTab.tsx:1184,1413-1417`); filter status aktif tidak dibedakan di
  empty state (`PanjarTab.tsx:1946`).
- **Perbaikan:** state `memuat` per daftar ("Memuat…" / skeleton), error muat dirender
  di dalam kartu daftar sendiri, empty state membedakan "belum ada data" vs "filter
  tidak ketemu" vs "gagal memuat"; "Memuat riwayat pembayaran…" saat detail dimuat.
- **Verifikasi:** throttle IPC (dev) → tidak ada klaim "kosong" sebelum data tiba.

### UI-A15 · CurrencyInput ikut `disabled` saat proses berjalan
- **Bukti:** Panjar: `PanjarTab.tsx:1280-1287, 1429-1434, 1597-1602`; Pinjaman:
  `PinjamanTab.tsx:911-927, 1055-1064, 1501-1516`; Jurnal editor & koreksi:
  `JurnalUmumEditor.tsx:565-575`, `JurnalTab.tsx:994-997` — semua tanpa `disabled`,
  padahal TextInput/Select sekitarnya ikut mati.
- **Dampak:** nilai bisa berubah di tengah proses simpan; hasil tersimpan bisa beda
  dari yang terakhir dilihat.
- **Perbaikan:** `disabled={busy...}` pada semua `CurrencyInput` di form yang punya
  proses simpan; sekalian guard ref untuk `simpan()` pinjaman yang belum pakai
  `busyRef` (`PinjamanTab.tsx:396`).
- **Verifikasi:** grep `CurrencyInput` — semua instance dalam form simpan punya disabled.

### UI-A16 · Bersihkan jargon teknis dari UI
- **Daftar (lokasi → pengganti):**
  | Lokasi | Sekarang | Pengganti |
  |---|---|---|
  | `AkunTab.tsx:386,165` | label/error "(is_kas)" | hapus checkbox (lihat bawah); "Dompet kas/bank" |
  | `core/forms.ts:92`, `db/panjar.ts:375` | "…(satuan sen)" | "Nominal harus lebih dari 0." |
  | `PinjamanTab.tsx:1744` | badge `DB-16e` | hapus / "Dihitung dari jurnal" |
  | `PinjamanTab.tsx:1661` | "GL 2050" | "Saldo jurnal 2050" |
  | `PinjamanTab.tsx:1175,714` | "Outstanding" | "Sisa pokok (outstanding)" / "Sisa pokok sekarang" |
  | `SaldoAwalWizard.tsx:476` | "(tanggal jangkar)" | "(tanggal acuan)" |
  | `DashboardTab.tsx:594` | "cut-over/pembukaan" | "jurnal pembukaan/saldo awal" |
  | `AkunTab.tsx:295` | "COA client" | "daftar akun bawaan" |
  | `ArusKasTab.tsx:29,276` | "(termasuk 1050 lama)", "Lawan akun" | buang kode; "Akun terkait" |
  | `DashboardTab.tsx:652` | badge jenis mentah `UMUM/SALDO_AWAL/REVERSAL` | `LABEL_JENIS` (lihat UI-A17) |
  | `JurnalTab.tsx:534-547` | "‹ Prev / Next ›", "Hal 1 / 5" | "‹ Sebelumnya / Berikutnya ›", "Halaman 1 dari 5" |
  | `printDoc.ts:470-477` | "Halaman 1 dari N" (semua halaman tampil) | "{N} halaman · A4 Portrait" |
  | `JurnalTab.tsx:767` | UUID mentah di pesan sukses | nomor bukti/keterangan |
  | `PinjamanTab.tsx:768` | "angsuran 3" (ID DB) | "angsuran ke-3" |
  | `PengaturanTab.tsx:502` | "Idle (menit, 5–120)" | "Menit tanpa aktivitas (5–120)" |
  | `PengaturanTab.tsx:473-483` | "instalasi lama", "kode default lama" | "Perangkat ini belum punya kode darurat. Buat sekarang." |
  | `PengaturanTab.tsx:600-606` | "Pengembangan (PURA_DB)" | "Mode pengembangan — lokasi data ditentukan sistem" |
  | `PengaturanTab.tsx:702-711` | "ID referensi" | sembunyikan di "Filter lanjutan (untuk pendamping)" |
- **Khusus is_kas:** checkbox tidak punya efek nyata — simpan memaksa
  `is_kas: tipe === 'AKTIVA' ? true : false` (`AkunTab.tsx:207`) dan validasi menolak
  bila tidak dicentang (`:164-167`). Hapus checkbox; untuk tipe AKTIVA tampilkan teks
  statis "Akun aktiva otomatis menjadi dompet kas/bank".
- **Verifikasi:** grep istilah lama di `src/renderer` → nol hasil (kecuali komentar dev).

### UI-A17 · Satukan istilah antar layar
- **Daftar keputusan istilah (pilih satu, terapkan semua):**
  - "hutang" vs "utang" → **utang** (KBBI): `TransaksiTab.tsx:109,547` vs
    `TransaksiForm.tsx:211,623,627,1077`. Kode/identifier tidak diubah.
  - "Restore" vs "Pulihkan" → **Pulihkan (restore)**: satu kartu Dashboard mencampur
    keduanya (`DashboardTab.tsx:782` vs `:798-808`); "Backup Export .db (lanjutan)" /
    "Restore Import .db" → "Backup file .db (lanjutan)" / "Pulihkan file .db (lanjutan)"
    (`PengaturanTab.tsx:647-651`).
  - "Mode akuntan" vs "Mode lanjutan" → **Mode lanjutan** (`JurnalTab.tsx:325`,
    `JurnalUmumEditor.tsx:418` vs `PengaturanTab.tsx:84,127,146`, `modeLanjutan.ts`).
  - "pasiva" vs "kewajiban" → satu istilah (`TutupTab.tsx:56,324` vs
    `SaldoAwalWizard.tsx:630-632`).
  - Badge status panjar "Belum/Sudah" → "Terbuka/Selesai/Dibatalkan" samakan dengan
    opsi filter (`PanjarTab.tsx:1795-1799`).
  - Header Buku Besar "+ / Masuk" dipakai juga untuk akun Beban/Piutang/Panjar —
    ganti "Bertambah / Berkurang" untuk non-kas (`BukuBesarTab.tsx:37-40`).
  - Status angsuran SEBAGIAN di Daftar tapi BELUM di Kartu Hutang untuk data sama —
    turunkan status di mutasi (`PinjamanTab.tsx:1980-1982`, `core/pinjamanMutasi.ts:136`).
  - `LABEL_JENIS` diduplikasi (`JurnalTab.tsx:49-59`, `DetailJurnalModal.tsx:7-17`,
    `TransaksiTab.tsx:102-112`) → ekspor dari `lib/tampilanLaporan.ts`, pakai di
    Dashboard juga.
  - "Tanggal link"/nilai "sama" → "Tanggal catat"/"sama dengan jurnal"
    (`PinjamanTab.tsx:1885,1903-1905`).
  - "dicicil N× pembayaran" → "dibayar dalam N catatan pembayaran" (`PinjamanTab.tsx:2024`).
  - "Periksa lagi" → "Ubah isian" (`PinjamanTab.tsx:1570-1579`).
  - "Buka Kunci Periode" → "Buka menu Kunci Periode" (`DashboardTab.tsx:641`).
  - Dua nama tujuan banner: samakan (lihat UI-A08).
- **Verifikasi:** grep per istilah → hanya satu bentuk di `src/renderer`.

### UI-A18 · Ringkas wall-of-text di titik keputusan
- **Bukti:** paragraf 4-aturan di KoreksiModal dengan kalimat pembuka kontradiktif
  ("Jurnal balik mengikuti tanggal asli" di atas field tanggal yang bisa diedit,
  `JurnalTab.tsx:796-803`); paragraf Kunci Periode memadatkan 4 konsep +
  indikator langkah teks polos (`TutupTab.tsx:187-194`); paragraf ±10 baris di Daftar
  Panjar (`PanjarTab.tsx:1745-1757`); peringatan backup tak-terenkripsi diulang 3-4×
  dalam satu kartu (`DashboardTab.tsx:730-844`); "snapshot" tak diterjemahkan ~8× di
  TutupTab (`TutupTab.tsx:48,53,170,310`) — pilih "Ringkasan terkunci (snapshot)",
  jelaskan sekali.
- **Perbaikan:** pecah jadi bullet pendek (maks ±3 baris per layar); kalimat teknis
  pindah ke bantuan/langkah berikutnya; teks pembuka jujur soal default
  ("Default tanggal balik = tanggal jurnal asli. Boleh diubah, tidak boleh sebelum
  tanggal asli."); Kunci Periode: 2 kalimat + indikator langkah visual `aria-current="step"`;
  langkah 2/3 sebut lokasi backup ("tersimpan di folder Backup — lihat Pengaturan").
- **Verifikasi:** review manual; panjang blok teks per layar ≤ batas yang disepakati.

### UI-A19 · Perbaiki kebenaran peringatan tanggal koreksi
- **Area:** `src/renderer/components/JurnalTab.tsx:676-679, 797-798, 830-848, 920-928`
- **Bukti:** peringatan beda-tahun membandingkan `tanggalBalik` vs `tanggal` (pengganti),
  bukan terhadap tahun **jurnal asli** — skenario tersering (default yang user pilih)
  justru lolos tanpa warning padahal Laba Rugi lintas tahun terdistorsi. Aturan "tidak
  boleh sebelum tanggal asli" juga tidak divalidasi di UI (tanpa `min` pada input date,
  baru ketahuan setelah submit).
- **Perbaikan:** warning bila tahun `tanggalBalik` ATAU tahun `tanggal` ≠ tahun
  `jurnal.tanggal`; set `min={jurnal.tanggal}` pada kedua input date + pesan inline
  `role="alert"`.
- **Verifikasi:** ui-audit: tanggal balik lintas tahun dari jurnal asli → warning muncul;
  tanggal sebelum asli → diblok di UI sebelum submit.

### UI-A20 · Blokir Duplikat untuk jurnal SALDO_AWAL/REVERSAL
- **Area:** `DetailJurnalModal.tsx:126-130`, `JurnalTab.tsx:551-564`, `core/jurnalForm.ts:297-330`
- **Bukti:** tombol "Duplikat" tampil untuk semua jenis; `duplikatJurnalKeForm` hanya
  memvalidasi struktur baris. Arah koreksi SALDO_AWAL sudah diblokir (`bisaDikoreksiJurnal`),
  tetapi Duplikat tidak.
- **Dampak:** jurnal saldo awal bisa diduplikat jadi jurnal umum ber-tanggal hari ini →
  saldo kas/ekuitas tercatat ganda — melanggar premis "saldo awal hanya lewat wizard".
- **Perbaikan:** sembunyikan/nonaktifkan Duplikat untuk `SALDO_AWAL` (dan pertimbangkan
  `REVERSAL`) dengan alasan terlihat, konsisten pola `alasanTidakBisaKoreksi`.
- **Verifikasi:** ui-audit: detail jurnal SALDO_AWAL → tidak ada tombol Duplikat.

---

## P3 — Aksesibilitas & struktural

### UI-A21 · A11y tabel: baris klikabel, caption/scope, ekspander, ikon
- **Bukti:** baris drill-down `<tr tabIndex={0} title=...>` tanpa `aria-label`/`role`
  (`BukuBesarTab.tsx:352-363`, `NeracaSaldoTab.tsx:221-244`, `NeracaTab.tsx:69-94`,
  `LabaRugiTab.tsx:217-274`, `ArusKasTab.tsx:285-301`, `JurnalAkunModal.tsx:117-136`);
  tabel tanpa `caption`/`scope="col"` di semua laporan; ekspander tanpa
  `aria-expanded`/`aria-controls` (`PinjamanTab.tsx:1233,1868`; `PanjarTab.tsx:1877`);
  `ChevronRight` dekoratif tanpa `aria-hidden` (`NeracaSaldoTab.tsx:270`, `NeracaTab.tsx:91`,
  `LabaRugiTab.tsx:236,282`, `ArusKasTab.tsx:326`); JurnalAkunModal error/loading tanpa
  live region (`JurnalAkunModal.tsx:90-97`).
- **Perbaikan:** `aria-label` per baris (atau tombol eksplisit "Buka" di sel pertama —
  juga membantu operator mouse awam); `caption className="sr-only"` + `scope="col"`;
  `aria-expanded`/`aria-controls`; `aria-hidden` ikon dekoratif; `ErrorBox`/live region
  di JurnalAkunModal; pertimbangkan `tfoot` total di JurnalAkunModal.
- **Verifikasi:** audit manual dengan screen reader (macOS VO / Windows NVDA).

### UI-A22 · A11y form & tampilan: label nominal, teks <13px, kontras, LockScreen
- **Bukti:**
  - `CurrencyInput` tanpa `aria-label` di form paling rawan: baris jurnal
    (`JurnalUmumEditor.tsx:565-575`, `JurnalTab.tsx:993-997`), baris saldo wizard
    (`SaldoAwalWizard.tsx:577-589`), baris nota Panjar.
  - Teks konten penting < 13px (melanggar standar UI-15 sendiri):
    `AkunTab.tsx:534` (`text-[11px]`), `TransaksiTab.tsx:314` (alasan batal),
    `PinjamanTab.tsx:1290-1302` (rincian sisa pokok/bunga — dasar keputusan bayar),
    `PanjarTab.tsx:1915`, `AuditDetail.tsx:39,97,199`.
  - Kontras: `text-stone-400` di atas putih ≈ 2.8:1 (`AkunTab.tsx:530`).
  - LockScreen: PinInput tetap aktif saat blokir 60 detik, tanpa hitung mundur
    (`LockScreen.tsx:131-145`); autoFocus reset PIN mendarat di PIN baru, bukan kode
    darurat yang langkah pertama (`:146-156`); teks "terbuka otomatis" dobel
    (`:104-108,141-143`); perubahan status tanpa `role="status"`.
  - `PengaturanTab.tsx:438-444`: input PIN tanpa `autoComplete="current-password"/"new-password"`.
  - `ErrorBoundary.tsx:39-44`: menyuruh sebut waktu kejadian tapi waktunya tidak ditampilkan.
- **Perbaikan:** prop `ariaLabel` pada `CurrencyInput` (atau `aria-describedby`);
  naikkan semua teks konten ke `text-helper` (13px); `text-stone-500` untuk teks;
  blokir = disable PinInput + hitung mundur; pindahkan `autoFocus` sesuai langkah;
  satu penjelasan saja; `role="status"`; `autoComplete` benar; tampilkan tanggal/jam
  di kartu ErrorBoundary.
- **Verifikasi:** grep `text-xs`/`text-[11px]` di renderer → hanya metadata murni;
  kontras ≥ 4.5:1 untuk teks.

### UI-A23 · State sibuk gabungan per tab
- **Bukti:** tombol aksi daftar Panjar tetap aktif saat form lain menyimpan
  (`PanjarTab.tsx:1830-1880`); klik "Lihat rincian" diabaikan tanpa feedback saat detail
  lain dimuat (`PanjarTab.tsx:1157-1158`); Pinjaman: tombol "Kartu hutang"/ekspander tak
  dikoordinasikan dengan proses lain.
- **Perbaikan:** satu flag sibuk gabungan per tab (`busyOpen || busyClose || busyBatal ||
  busyKoreksi`) menonaktifkan semua tombol aksi + `ALASAN_SIBUK`; aksi yang antre
  (lihat rincian) diantrikan atau diberi feedback, bukan diabaikan.
- **Verifikasi:** mulai simpan → semua tombol aksi lain mati dengan alasan.

### UI-A24 · Perbaiki flag dirty (direset aksi lain / palsu saat kosong)
- **Bukti:** `batalBayar()` memanggil `setDirty(false)` (`PinjamanTab.tsx:624`) —
  menghapus guard isian form pinjaman **utama** yang belum disimpan; `ubahMode` selalu
  `setDirty(true)` walau form kosong (`:506`) → alarm palsu; `setDirty` di KoreksiModal
  JurnalTab dead code (modal menutupi navigasi) sementara `JurnalUmumEditor` tidak
  memakai guard sama sekali (`tabGuard.tsx` tidak dipanggil di sana).
- **Perbaikan:** hitung dirty dari state form (fungsi `formBerisiData(...)`), bukan
  diset manual di banyak titik; atau pisahkan dirty per form; dokumentasikan kontrak
  guard di `tabGuard.tsx` (modal menutupi navigasi → konfirmasi internal yang berlaku);
  auto-lock memberi satu baris di layar kunci: "Isian yang belum disimpan telah ditutup"
  (`App.tsx:490-498`).
- **Verifikasi:** ui-audit: isi form utama → buka+batal form bayar → pindah tab tetap
  konfirmasi; toggle mode dengan form kosong → tanpa konfirmasi.

### UI-A25 · Batasi generator jadwal otomatis dari tenor
- **Bukti:** `bolehIsiJadwalOtomatis` hanya butuh tenor ≥ 1 (`PinjamanTab.tsx:43-56`);
  `terapkanJadwalOtomatis` (~537-567) langsung merender `tenor` baris × 5 input.
- **Dampak:** typo tenor "12000" → ribuan baris → UI tampak hang.
- **Perbaikan:** batas tenor generator (mis. maks 360) dengan pesan; tenor > 60
  muncul konfirmasi "Akan membuat N baris — lanjutkan?"; sukses beri info
  "Jadwal N baris berhasil diisi. Periksa tanggal dan bunga sebelum menyimpan."
- **Verifikasi:** ui-audit: tenor 1200 → ditolak dengan pesan; tenor 100 → konfirmasi.

### UI-A26 · Batch perbaikan kecil lintas layar
- **Daftar:**
  1. `jenisTransaksiAwal` dari pintasan Dashboard tidak pernah direset → form Transaksi
     terbuka dengan jenis pintasan terakhir minggu lalu (`App.tsx:198-199,353-355`,
     `TransaksiTab.tsx:393`); reset ke `'TERIMA'` saat navigasi biasa.
  2. Header pratinjau jurnal "Keterangan" padahal isinya akun+posisi → "Akun (posisi)";
     samakan dengan `DetailJurnalModal.tsx:92` (`TransaksiForm.tsx:1095`).
  3. Grid 7 kartu jenis pada `xl:grid-cols-6` — kartu yatim → `xl:grid-cols-4`
     (`TransaksiTab.tsx:630`).
  4. Ikon kembar: Panjar & Bayar Utang sama-sama HandCoins → ganti ikon Panjar
     (`TransaksiTab.tsx:81,87`).
  5. Tombol "Hapus" akun pakai `ghost` — lebih berbahaya dari "Batalkan transaksi"
     yang `danger-outline` → samakan `danger-outline` (`AkunTab.tsx:546-553`).
  6. `LockModal` TransaksiForm tanpa `sibuk={busy}` (`TransaksiForm.tsx:1172-1180`).
  7. KodeDaruratModal tidak memakai Modal bersama — tanpa focus trap/Escape
     (`KodeDaruratModal.tsx:19-58`) → bangun di atas `Modal`.
  8. TutupTab: input tahun menghapus isi langsung jadi "0" (`TutupTab.tsx:203-212`) →
     state string atau Select; `TAHUN_BERJALAN` konstanta modul bisa basi (`:28-29`);
     backup auto dibuat ulang bolak-balik langkah 2↔3 (`:106-116,246-251`).
  9. LockScreen: sisa isian mode reset tidak dibersihkan saat pindah mode
     (`LockScreen.tsx:90-94`).
  10. Pratinjau nomor bukti "—" tanpa penjelasan saat prefix kosong
      (`PengaturanTab.tsx:409-415`) → "Nomor otomatis (tanpa prefix)".
  11. Dashboard: badge hijau "Total" permanen (`DashboardTab.tsx:487`); rincian kas
      tanpa thead/empty state (`:492-511`); "Boleh dikunci s/d 2025" → "Tahun terakhir
      yang boleh ditutup: 2025" (`:631-633`); error tidak direset saat tanggal diubah
      (`:405-408`); path backup hanya via `title` hover (`:706-718`) → `<details>`.
  12. Neraca: judul "Neraca per {tanggal}" dari input, bukan `data.cutoff`
      (`NeracaTab.tsx:103`); pesan kosong tidak seragam (`:187,224`).
  13. Buku Besar: "Saldo akhir" tampil dua kali (`BukuBesarTab.tsx:291-293,318-327`);
      tanpa indikator memuat saat ganti akun dengan data lama tampil (`:269`).
  14. TransaksiTab: info pembatalan lama tidak pernah dikosongkan saat simpan baru
      (`TransaksiTab.tsx:407` vs `:696`); header tabel "Jurnal" menampilkan ID mentah
      (`PanjarTab.tsx:1899`); pinjaman DIBATALKAN masih menampilkan "Sisa awal" penuh
      tanpa redup (`PinjamanTab.tsx:1212-1214`).
  15. Editor jurnal: blur akun hanya exact-match — ketikan parsial menghasilkan error
      "akun legacy/nonaktif" yang menuduh salah penyebab; coba prefix/substring sebelum
      gagal + pesan jujur "Pilih akun dari daftar saran" (`core/jurnalForm.ts:230-245`,
      `JurnalUmumEditor.tsx:239-247,558-563`); tombol "+ Jurnal Baru" aktif sebelum COA
      termuat (`JurnalTab.tsx:326-332`); error akun tanpa `role="alert"`.
  16. Ukuran angka utama laporan tidak konsisten (`text-3xl` Dashboard vs `text-xl`
      Buku Besar vs `text-lg` Arus Kas) → satu skala.
  17. AkunTab menampilkan enum mentah "DEBIT/KREDIT", "BEBAN" padahal label Indonesia
      sudah ada (`AkunTab.tsx:501,401-404` vs `tampilanLaporan.ts:17-20`).
  18. Panjar: badge header statis "Jurnal otomatis seimbang" redundan dengan badge
      "Seimbang" tiap pratinjau (`PanjarTab.tsx:1241`); default akun beban '5004'
      hardcoded bisa tak cocok opsi (`:70-79,1589-1594`); error koreksi tampil dobel
      (`:1990` vs `:1739`); label baris jurnal "1040 — dihabiskan" saat ada sisa
      (`:1197-1209`); margin kotak info tak konsisten (`:1391`).
  19. JurnalTab: tone badge "Aktif" beda antar layar (`JurnalTab.tsx:477` vs
      `DetailJurnalModal.tsx:51`); "Total halaman (25 jurnal):" ambigu →
      "Subtotal halaman ini"; ID UUID 12px di daftar (`:467`) → hapus dari daftar;
      `aria-busy` saat refetch.
  20. Pinjaman: label "Ke" berulang tanpa konteks baris (`PinjamanTab.tsx:1037-1045`)
      → `aria-label` per baris; badge rekonsiliasi tone stale saat "Memeriksa…"
      (`:1641-1647`); error mutasi lama tak direset saat periode tak valid
      (`:298-303`); pesan sukses simpan nominal tanpa keterangan (`:471-475`);
      filter "Bulan (kosong = satu tahun)" → "Bulan (Semua bulan = satu tahun penuh)"
      (`:1772`); kartu hutang tanpa empty state (`:1751-1754`).
- **Perbaikan:** kerjakan sebagai satu PR kecil-kecil dengan commit per nomor.
- **Verifikasi:** checklist manual per nomor.

### UI-A27 · Perluas `e2e/ui-audit.test.mjs` untuk regresi
- **Tujuan:** mengunci perbaikan UI-A01 s/d UI-A25 sebagai pengujian UI otomatis
  (infrastruktur sudah ada: `npm run audit:ui`).
- **Kasus minimum:**
  1. Panjar: tanpa target → grid nota tidak dirender; ganti target dengan isian →
     konfirmasi muncul.
  2. Jurnal: KoreksiModal dengan perubahan → Escape → konfirmasi; tanpa perubahan → tutup.
  3. Jurnal: Duplikat tak tersedia untuk SALDO_AWAL.
  4. Laba Rugi/Arus Kas: rentang terbalik → pesan, fetch diblok, badge SURPLUS tidak tampil.
  5. Buku Besar dari drill-down Neraca: header berisi periode sumber.
  6. LockModal: alasan ≥5 karakter setelah re-render tetap terkirim.
  7. Pengaturan: gagal muat → Simpan disabled.
  8. Transaksi: form kosong → alasan tombol nonaktif terlihat.
- **Verifikasi:** `npm run audit:ui` hijau di CI/dev sebelum merge.

---

## Yang sudah baik (pertahankan)

- Design system konsisten (`ui.tsx`): fokus ring seragam, focus-trap + tumpukan modal,
  fokus awal ke tombol aman pada `KonfirmasiModal`.
- Guard klik-ganda `busyRef`/`useAksiSibuk` hampir di semua jalur; validasi ganda
  client + server; tidak ada temuan P0.
- `ErrorBox` ber-`role="alert"`, skip-link, `PinInput` matang (paste/arrow/shake).
- Konfirmasi berlapis berbahasa operator untuk aksi destruktif (reversal, tutup buku,
  restore).
- Empty state laporan sudah cukup lengkap di beberapa tab (Buku Besar, Neraca Saldo,
  Transaksi) — tinggal diseragamkan (UI-A14).
- Dokumentasi kuat (panduan pengguna, runbook) + e2e UI audit yang sudah ada.
