# Tickets Perbaikan UI/UX — 2026-10-27

> Dibuat dari audit UI/UX 27 Oktober 2026:
> **`docs/audit-ui-2026-10-27.md`**.
>
> Audit memakai aplikasi Electron asli + `playwright-core` (bukan mock browser):
> 18 tab, 1280×800 / 1024×768 / 800×600, uji keyboard, modal, scroll, dan alur
> simpan transaksi. Baseline build: `out/` 27 Okt 2026 14:20.
>
> Dokumen ini sengaja memecah temuan menjadi ticket **kecil** supaya bisa
> dikerjakan satu per satu oleh AI agent. **Satu sesi = satu ticket.**
> Jangan mengerjakan beberapa ticket sekaligus dalam satu commit.

---

## Cara pakai (untuk AI agent)

1. Pilih ticket `[ ]` paling atas yang **dependency**-nya sudah selesai.
2. Baca **Konteks → Langkah → DoD**. Buka file yang disebut di Konteks.
3. **Reproduksi dulu** kondisi yang dilaporkan (screenshot / ukur DOM /
   keyboard), baru ubah kode.
4. Jangan mengubah logika akuntansi, skema DB, jurnal, PIN, atau backup.
   Ticket di sini hanya UI/UX.
5. Jangan memakai data di `data/` atau `data/backups/`. Untuk uji manual,
   pakai database sementara + seed:

   ```bash
   PURA_DB=/tmp/pura-ui-check.db PURA_SEED_DEV=true npm run dev
   ```

6. Sebelum centang, wajib hijau:

   ```bash
   npm run typecheck
   npm test
   npm run build          # semua ticket UI menyentuh renderer/main
   ```

   Untuk ticket shell/navigasi/modal, jalankan juga:

   ```bash
   npm run smoke
   ```

7. Selesai → ubah `- [ ]` jadi `- [x]` + bukti di baris ticket:
   `(YYYY-MM-DD: 1 kalimat hasil + jumlah test)`.
   **Jangan centang tanpa bukti.**
8. Commit terpisah per ticket: `fix(UI-03): ...` / `feat(UI-04): ...`.
9. Jangan memperluas scope. Kalau menemukan bug lain, buat ticket baru.

### Kondisi awal yang harus diperhatikan

- Working tree sedang punya perubahan **Daftar Akun** yang belum di-commit
  (`App.tsx`, `AkunTab.tsx`, `db/coa.ts`, `core/forms.ts`, `TransaksiForm.tsx`,
  dll.). Selesaikan/commit dulu sebelum ticket yang menyentuh `App.tsx`
  (**UI-01, UI-04, UI-05, UI-06, UI-07, UI-17**), atau pastikan perubahan itu
  tidak hilang.
- Dev server mungkin sedang berjalan. Jangan menghentikan proses milik user.
- Jangan menambah dependency UI baru (axe, testing-library, dsb.) tanpa
  persetujuan. Gunakan `playwright-core` + `e2e/` yang sudah ada.
- **Jangan merusak yang sudah baik:** kontras, format Rupiah, label form,
  `aria-current`, pratinjau jurnal, dan konfirmasi aksi berbahaya.

---

## Ringkasan prioritas

| ID | Prioritas | Ukuran | Judul | Dependency |
|---|---|---|---|---|
| UI-00 | — | S | Baseline audit UI (selesai) | — |
| UI-01 | P0 | M | Shell scroll: header sticky + reset posisi antar tab | — |
| UI-02 | P0 | S | Ukuran minimum & default jendela | — |
| UI-03 | P0 | S | Grid kartu dashboard adaptif | UI-02 |
| UI-04 | P0 | M | Kelompokkan menu sidebar (Harian/Laporan/Data) | — |
| UI-05 | P0 | S | Pin Pengaturan, simpan status lipat, scroll shadow | UI-04 |
| UI-06 | P0 | S | Skip link + judul halaman & fokus konten | UI-01 |
| UI-07 | P0 | M | Guard “isian belum disimpan” untuk form transaksi | — |
| UI-08 | P0 | S | Terapkan guard ke Panjar/Pihak/Koreksi | UI-07 |
| UI-09 | P1 | M | Komponen modal aksesibel + Detail Jurnal | — |
| UI-10 | P1 | S | Terapkan modal aksesibel ke modal lain | UI-09 |
| UI-11 | P1 | S | Label filter Jurnal Umum + reset tanggal | — |
| UI-12 | P1 | S | Konteks aksi baris + target klik | — |
| UI-13 | P1 | S | Umpan balik sukses/error dekat tombol aksi | — |
| UI-14 | P1 | S | Pindahkan pintasan transaksi ke atas dashboard | — |
| UI-15 | P1 | M | Teks bantu 12 px → 13–14 px | — |
| UI-16 | P1 | S | Kartu backup: path, status, dan hierarki restore | — |
| UI-17 | P1 | S | Header judul halaman + hierarki heading | UI-01, UI-06 |
| UI-18 | P2 | S | Perbaiki tone `Badge` amber | — |
| UI-19 | P2 | S | Focus ring konsisten untuk keyboard | — |
| UI-20 | P2 | M | Standarkan format tanggal | — |
| UI-21 | P2 | S | Konsistensi istilah UI | — |
| UI-22 | P2 | S | Sanitasi error “X is not defined” | — |
| UI-23 | P2 | M | Audit ulang regresi UI | semua P0/P1 |

---

## P0 — Navigasi & alur harian

- [x] **UI-00 — Baseline audit UI** · — · S (2026-10-27: 18 layar, 3 ukuran, uji keyboard+modal; 0 error console, 0 kontras teks terlihat gagal; laporan di `docs/audit-ui-2026-10-27.md`)
  - **Konteks:** Audit awal sebelum perbaikan. Angka acuan:
    scroll antar-tab bertahan 472,5 px; header `top = -472`; menu 18 item
    (857 px) vs area terlihat 707 px; tidak ada `minWidth`/`minHeight`;
    19 stop Tab sebelum konten.
  - **DoD:** laporan tersedia dan bisa dijadikan acuan regresi.
  - **Verifikasi:** buka `docs/audit-ui-2026-10-27.md`.
  - **Dependency:** —

- [x] **UI-01 — Shell scroll: header sticky + reset posisi antar tab** · P0 · M (2026-10-27: shell setinggi layar, main satu-satunya area scroll, header sticky tetap di top 0 dan tab baru mulai dari scroll 0 + 592 test)
  - **Konteks:** `main` memakai `min-h-screen overflow-y-auto`, tetapi halaman
    sebenarnya digulir oleh dokumen. Header `sticky top-0` berada di dalam
    `main` sehingga ikut hilang (terukur `top = -650` saat scroll 650).
    Pindah tab mempertahankan `window.scrollY` (terukur 472,5 px), sehingga
    form Transaksi terbuka terpotong. Lihat audit bagian P0 butir 1.
  - **Langkah:**
    1. Ubah root `App` menjadi `h-screen overflow-hidden`; jadikan `main`
       satu-satunya area scroll (`h-screen overflow-y-auto` atau `flex-1`
       di dalam kontainer setinggi layar).
    2. Pastikan `<header>` tetap terlihat saat konten digulir; beri `z-20`
       dan border/shadow tipis bila perlu.
    3. Buat satu helper `pindahTab(id)` yang dipakai menu sidebar, tombol
       dashboard (`onBukaTab`), dan navigasi internal. Setelah state tab
       berubah, reset scroll `main` ke 0 (mis. `requestAnimationFrame`),
       bukan memaksa `window.scrollTo` yang bisa berkedip.
    4. Jangan reset scroll saat membuka modal, memuat ulang data tab yang
       sama, atau kembali dari detail.
    5. Tambah `data-testid="app-scroll"` pada area scroll untuk e2e.
  - **DoD:**
    - Scroll dashboard 650 px → header `top = 0`, tetap terlihat.
    - Klik Transaksi dari posisi bawah dashboard **dan** lewat pintasan
      “Terima Uang” → area scroll 0; field Tanggal terlihat.
    - Tidak ada dua scrollbar vertikal; sidebar tidak ikut bergeser.
    - 1280×800 dan 1024×768 tetap rapi.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`;
    uji manual dengan skrip/DevTools:
    `document.querySelector('[data-testid="app-scroll"]').scrollTop`.
  - **Dependency:** —

- [x] **UI-02 — Ukuran minimum & default jendela** · P0 · S (2026-10-27: minimum 1024×680 dan default 1240×760 di-clamp ke work area layar agar muat di 1366×768, terkunci lewat helper murni + 595 test)
  - **Konteks:** `BrowserWindow` di `src/main/index.ts` tidak menetapkan
    `minWidth`/`minHeight` (terukur 0×0). Pada 800×600 layout rusak; default
    1280×800 lebih tinggi dari layar 1366×768.
  - **Langkah:**
    1. Set `minWidth: 1024`, `minHeight: 680` (atau 1000×660 setelah uji).
    2. Set default `width: 1240`, `height: 760`; pastikan tetap muat di
       work area 1366×768.
    3. Jangan mengubah `titleBarStyle`/perilaku window lain.
    4. Uji 125% scaling Windows bila tersedia.
  - **DoD:** jendela tidak bisa diperkecil di bawah batas; semua kontrol
    utama tetap terjangkau pada 1024×680; default muat di 1366×768;
    `npm run build` hijau.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    manual resize.
  - **Dependency:** —

- [x] **UI-03 — Grid kartu dashboard adaptif** · P0 · S (2026-10-27: grid kartu 1 kolom di 800, 2 kolom di 1024/1280; 0 overflow dokumen/kartu dan semua nominal utuh + 595 test)
  - **Konteks:** Kartu ringkasan memakai `md:grid-cols-2` yang dihitung dari
    viewport, bukan lebar konten. Dengan sidebar 240 px, pada 800 px kartu
    tetap dua kolom dan nominal `Rp 657.500.000,00` keluar kartu/bertabrakan.
  - **Langkah:**
    1. Ganti grid kartu ringkasan (dan grid pintasan bila perlu) menjadi
       `grid-cols-[repeat(auto-fit,minmax(320px,1fr))]` atau container query.
    2. Tambah `min-w-0` pada kartu; jangan memotong nominal dengan
       `truncate` — biarkan kartu menjadi satu kolom.
    3. Pertahankan dua kolom pada 1280×800.
    4. Cek juga kartu “Laba/Rugi” dan `dl` dua kolom di dalamnya.
  - **DoD:** 800, 1024, dan 1280 tidak ada horizontal overflow; nominal
    tidak terpotong/tumpang tindih; dashboard tetap enak dipindai.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    screenshot 800/1024/1280.
  - **Dependency:** UI-02

- [x] **UI-04 — Kelompokkan menu sidebar** · P0 · M (2026-10-27: menu jadi 3 kelompok lipat dengan Harian/Data & Sistem terbuka dan Laporan tertutup, Pengaturan dipin di footer; nav pas tanpa scroll 672/672 px di 1280×800 dan 640/640 px di 1024×768, tab aktif otomatis terlihat; 595 test + smoke hijau)
  - **Konteks:** 18 item datar (termasuk Daftar Akun) membutuhkan 857 px,
    area terlihat 707 px. “Tutup Buku” dan “Pengaturan” tersembunyi; tidak
    ada judul kelompok. Lihat audit bagian P0 butir 2.
  - **Langkah:**
    1. Kelompokkan tanpa mengubah `TabId`/logika tab:
       - **Harian:** Dashboard, Transaksi, Buku Panjar, Piutang & Hutang,
         Jurnal Umum.
       - **Laporan:** Buku Besar, Neraca Saldo, Laba Rugi, Neraca, Arus Kas,
         Anggaran, Rekonsiliasi Bank, Pembantu, Inventaris Aset.
       - **Data & Sistem:** Daftar Akun, Import Excel, Tutup Buku.
       - **Pengaturan:** pinned di bawah (UI-05).
    2. Beri judul kelompok kecil (uppercase 11–12 px) dan `role="group"` +
       `aria-label` bila memakai `<nav>`.
    3. Untuk kelompok panjang, gunakan disclosure yang bisa dibuka/tutup
       (`aria-expanded` + `aria-controls`). Default: Harian terbuka;
       Laporan/Data boleh tertutup agar muat, tetapi harus terlihat jelas.
    4. Pastikan tab aktif selalu terlihat: buka otomatis kelompoknya dan
       scroll item aktif ke viewport.
    5. Jangan mengubah label/ID tab yang sudah dipakai test atau pengguna
       tanpa ticket terpisah.
  - **DoD:** pada 1280×800, Pengaturan terlihat tanpa scroll; semua 18 tab
    dapat dijangkau maksimal satu klik buka kelompok; tab aktif tidak pernah
    tersembunyi; ikon tetap punya `aria-label`/`title`.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`;
    uji keyboard + screenshot.
  - **Dependency:** — (setelah WIP Daftar Akun di-commit)

- [x] **UI-05 — Pin Pengaturan, simpan status lipat, scroll shadow** · P0 · S (2026-10-27: Pengaturan tetap di footer luar nav scroll, status lipat tersimpan di `localStorage` dengan default lipat <1200 px tanpa menimpa pilihan manual, dan gradien scroll muncul/hilang sesuai posisi; 595 test + smoke hijau)
  - **Konteks:** Pengaturan (PIN/backup) adalah tujuan penting, tetapi
    berada di urutan terakhir dan bisa tersembunyi. Status lipat sidebar
    tidak bertahan setelah restart.
  - **Langkah:**
    1. Pindahkan tombol Pengaturan ke footer sidebar, di luar `<nav>` yang
       scroll, sehingga selalu terlihat.
    2. Simpan status `collapsed` di `localStorage`
       (mis. `pura.sidebar.collapsed`), baca saat mount.
    3. Saat pertama dibuka pada lebar < 1200 px, default lipat; jangan
       menimpa pilihan manual pengguna.
    4. Tambah gradien/shadow di bawah nav bila masih ada item di bawah
       (isyarat bisa scroll).
    5. Pastikan mode lipat tetap punya tooltip/`aria-label` untuk semua ikon.
  - **DoD:** Pengaturan selalu terlihat pada 1024×680 dan 1280×800;
    status lipat bertahan setelah restart; tidak ada item yang tidak bisa
    dijangkau; `npm run smoke` hijau.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`.
  - **Dependency:** UI-04

- [x] **UI-06 — Skip link + judul halaman & fokus konten** · P0 · S (2026-10-27: “Lewati ke konten” menjadi fokus pertama dan memindahkan fokus ke main, `document.title` mengikuti tab aktif (Dashboard/Transaksi/Jurnal), dan fokus konten hanya berpindah saat navigasi keyboard tanpa merampas klik mouse atau modal; 595 test + smoke hijau)
  - **Konteks:** Tidak ada skip link; 19 stop Tab (lipat + 18 menu) sebelum
    konten. `document.title` tidak berubah antar tab. Pengguna keyboard/
    pembaca layar tidak tahu halaman mana yang terbuka.
  - **Langkah:**
    1. Tambah tautan pertama “Lewati ke konten” (`sr-only` lalu terlihat
       saat fokus) menuju `#main-content`.
    2. Beri `main id="main-content" tabIndex={-1}`.
    3. Saat tab berubah, set `document.title` menjadi `<label> — Keuangan Pura Dalem Puri`.
    4. Fokuskan `main`/judul halaman setelah perubahan tab **hanya** bila
       navigasi berasal dari keyboard; jangan merampas fokus saat modal
       terbuka atau saat klik mouse.
    5. Tambah `aria-label` pada grup nav (setelah UI-04).
  - **DoD:** Tab pertama menampilkan skip link; Enter memindahkan fokus ke
    konten; judul jendela berubah; tidak ada focus jump saat klik biasa.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    uji Tab/Enter manual.
  - **Dependency:** UI-01

- [ ] **UI-07 — Guard “isian belum disimpan” untuk form transaksi** · P0 · M
  - **Konteks:** Isian `Nominal 123.456` + `Keterangan` hilang tanpa
    peringatan saat pindah tab (terukur: kedua field kosong setelah kembali).
    Komponen tab di-unmount saat tab berubah.
  - **Langkah:**
    1. Buat konteks/hook kecil di `src/renderer/lib/`:
       `useTabGuard`/`UnsavedChangesProvider` dengan `dirty`, `setDirty`,
       dan `konfirmasiTinggalkan`.
    2. Di `App`, bungkus `pindahTab`: bila `dirty`, tampilkan
       `KonfirmasiModal` “Isian belum disimpan. Tinggalkan halaman?” dengan
       tombol **Tetap di sini** (default) dan **Tinggalkan**.
    3. Di `TransaksiForm`, tandai dirty saat field berubah; bersihkan setelah
       simpan sukses, reset, atau saat form kembali kosong.
    4. Jangan menandai dirty untuk prefill awal (tanggal/akun default).
    5. Pastikan auto-lock tidak memicu dialog yang tidak bisa ditutup;
       jika perlu, simpan draft di state App (bukan localStorage) sampai
       pengguna benar-benar pergi.
  - **DoD:** isi form → klik tab lain → muncul konfirmasi; “Tetap di sini”
    mempertahankan isian; “Tinggalkan” pindah dan membuang isian; form bersih
    tidak memunculkan dialog; simpan sukses menghapus status dirty.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    uji manual alur di atas.
  - **Dependency:** —

- [ ] **UI-08 — Terapkan guard ke Panjar/Pihak/Koreksi** · P0 · S
  - **Konteks:** Pola kehilangan isian yang sama berlaku untuk form Panjar,
    Piutang & Hutang, dan Koreksi Jurnal.
  - **Langkah:**
    1. Pakai hook/konteks dari UI-07.
    2. Tandai dirty saat field berubah; bersihkan setelah simpan/batal.
    3. Pastikan modal Koreksi yang sudah terbuka tidak memicu guard ganda
       saat pengguna menekan Escape/klik latar (lihat UI-10).
  - **DoD:** tiga form menampilkan konfirmasi saat ditinggalkan dalam
    keadaan kotor; tidak ada dialog saat form bersih; tidak ada regresi
    simpan.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`; uji manual.
  - **Dependency:** UI-07

---

## P1 — Aksesibilitas & efisiensi

- [ ] **UI-09 — Komponen modal aksesibel + Detail Jurnal** · P1 · M
  - **Konteks:** `DetailJurnalModal` tidak punya `role="dialog"`/
    `aria-modal`; fokus tetap di tombol “Lihat” di belakang overlay; Escape
    tidak menutup; Tab keluar ke latar. Ini modal yang paling sering dipakai
    untuk memeriksa jurnal.
  - **Langkah:**
    1. Buat komponen `Modal` bersama di `ui.tsx`:
       `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, initial
       focus, focus trap, Escape (kecuali `busy`), restore focus ke pemicu,
       tombol X, dan backdrop.
    2. Migrasikan `DetailJurnalModal` ke komponen ini; pertahankan fitur
       lampiran, duplikat, dan cetak.
    3. Tangani modal bertumpuk: hanya modal teratas yang menangani Escape;
       setelah modal atas ditutup, fokus kembali ke modal di bawahnya.
    4. Jangan membuat background bisa di-Tab saat modal terbuka.
  - **DoD:** buka detail via keyboard → fokus masuk dialog; Tab berputar di
    dalam; Escape menutup; fokus kembali ke “Lihat”; background tidak
    terjangkau Tab; `npm run smoke` hijau.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`;
    uji keyboard.
  - **Dependency:** —

- [ ] **UI-10 — Terapkan modal aksesibel ke modal lain** · P1 · S
  - **Konteks:** `KonfirmasiModal` sudah punya role tetapi fokus tetap di
    pemicu, Escape tidak menutup, dan Tab keluar setelah 3 stop. Modal
    Koreksi, JurnalAkun, PratinjauCetak, dan SaldoAwalWizard juga belum
    konsisten.
  - **Langkah:**
    1. Migrasikan `KonfirmasiModal`, modal Koreksi di `JurnalTab`,
       `JurnalAkunModal`, `PratinjauCetakModal`, `PratinjauHtmlModal`, dan
       `SaldoAwalWizard` ke `Modal` dari UI-09.
    2. Saat `busy`/`sibuk`, jangan tutup lewat Escape/backdrop.
    3. Pastikan modal konfirmasi di atas Detail Jurnal mengembalikan fokus
       ke Detail, bukan ke halaman.
    4. Hapus handler Escape ganda di `JurnalUmumEditor` setelah memakai
       komponen bersama.
  - **DoD:** semua modal: fokus masuk, Tab terkurung, Escape menutup (kecuali
    sibuk), fokus kembali ke pemicu; tidak ada background tabbable.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`;
    uji keyboard tiap modal.
  - **Dependency:** UI-09

- [ ] **UI-11 — Label filter Jurnal Umum + reset tanggal** · P1 · S
  - **Konteks:** Empat kontrol filter berjajar tanpa label; dua input tanggal
    sama-sama menampilkan `dd/mm/yyyy` sehingga tidak jelas “dari”/“sampai”.
    Placeholder search terpotong. “Semua tanggal” di Buku Besar ambigu.
  - **Langkah:**
    1. Tambah label terlihat: “Cari”, “Dari tanggal”, “Sampai tanggal”,
       “Jenis” (boleh memakai `Field`).
    2. Untuk layar sempit, susun 2×2; jangan mengecilkan placeholder.
    3. Ganti “Semua tanggal” menjadi “Reset tanggal” di Buku Besar.
    4. Tampilkan pesan inline bila tanggal “dari” > “sampai”; jangan
       mengirim query yang tidak valid.
    5. Pertahankan debounce search dan perilaku filter yang ada.
  - **DoD:** semua kontrol punya nama aksesibel dan label terlihat; tidak
    ada input tanggal yang ambigu; 1024×768 tidak overflow; filter tetap
    bekerja.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    uji keyboard + screenshot.
  - **Dependency:** —

- [ ] **UI-12 — Konteks aksi baris + target klik** · P1 · S
  - **Konteks:** Di Jurnal Umum ada 25 “Lihat” + 25 “Koreksi” tanpa nomor
    bukti; pembaca layar tidak tahu baris mana. Nama pihak di Piutang &
    Hutang setinggi 23 px; `summary` “Rincian per akun” 20 px.
  - **Langkah:**
    1. Tambah `aria-label` berisi `Lihat jurnal <noBukti>` dan
       `Koreksi jurnal <noBukti>`.
    2. Beri padding vertikal pada tautan nama pihak dan `summary` sampai
       minimal 32 px; jangan mengubah tampilan tabel secara berlebihan.
    3. Pertimbangkan klik baris untuk membuka detail (dengan `tabIndex` dan
       Enter/Space), sisakan “Koreksi” di detail. Bila terlalu besar,
       kerjakan aria-label + target size dulu, klik baris jadi ticket baru.
    4. Pastikan tombol tetap bisa di-Tab dan tidak memicu aksi ganda.
  - **DoD:** setiap aksi baris punya nama unik yang menyebut nomor bukti;
    target minimal 32 px; tidak ada regresi buka detail/koreksi.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    cek accessible name di DevTools/Playwright.
  - **Dependency:** —

- [ ] **UI-13 — Umpan balik sukses/error dekat tombol aksi** · P1 · S
  - **Konteks:** Form transaksi ±900 px; pesan sukses/error muncul di atas
    form, tombol simpan di bawah. Bila pengguna berada di bawah, pesan tidak
    terlihat. Sukses tidak punya `role="status"`; `ErrorBox` tidak punya
    `role="alert"`.
  - **Langkah:**
    1. Tampilkan toast ringkas (fixed, aman dari scroll) atau pesan tepat di
       atas tombol simpan; jangan menghilangkan pesan detail di atas.
    2. Sukses: `role="status"`; error: `role="alert"`.
    3. Saat error, scroll/fokus ke ringkasan error (atau ke field bermasalah).
    4. Setelah sukses, fokuskan field Nominal agar entri berikutnya cepat.
    5. Jangan menampilkan pesan teknis; tetap lewat `pesanError`.
  - **DoD:** setelah simpan/gagal dari posisi bawah, pesan terlihat tanpa
    scroll; screen reader menerima status; tidak ada pesan ganda yang
    membingungkan.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    uji simpan sukses dan error validasi.
  - **Dependency:** —

- [ ] **UI-14 — Pindahkan pintasan transaksi ke atas dashboard** · P1 · S
  - **Konteks:** Kartu “Catat Transaksi / Pintasan” berada setelah 6 kartu
    ringkasan (±1,5 layar). Untuk aplikasi pembukuan harian, aksi utama
    seharusnya paling terlihat.
  - **Langkah:**
    1. Pindahkan blok pintasan tepat setelah kartu cut-off (sebelum kartu
       Saldo Kas), atau taruh tombol utama “+ Catat Transaksi” di header.
    2. Pertahankan pintasan yang ada (Terima Uang, Bayar, Pindah Dana,
       Panjar, Piutang & Hutang, Tutup Buku, Jurnal Umum).
    3. Pastikan layout 1280×800 menampilkan minimal Terima Uang/Bayar/
       Pindah Dana tanpa scroll.
    4. Jangan mengubah urutan kartu ringkasan lain tanpa alasan.
  - **DoD:** aksi harian terlihat di viewport pertama 1280×800; dashboard
    tidak terasa lebih padat secara berlebihan; `npm run smoke` hijau.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`;
    screenshot 1280.
  - **Dependency:** —

- [ ] **UI-15 — Teks bantu 12 px → 13–14 px** · P1 · M
  - **Konteks:** Ada 55 pemakaian `text-xs` (12 px), termasuk deskripsi mode
    transaksi, petunjuk nomor bukti, status “Sedang dipakai”, path backup,
    dan ID jurnal. Pengguna utama cenderung senior.
  - **Langkah:**
    1. Tambah token/utility teks bantu 13 px (mis. `.text-helper`) atau
       gunakan `text-sm` (14 px) untuk teks yang penting.
    2. Ganti `text-xs` pada: deskripsi mode, helper field, peringatan,
       status, dan path backup.
    3. Boleh tetap 12 px untuk metadata murni (ID seed, nomor versi).
    4. Jaga line-height dan wrapping; uji 1024×768 dan 800×600.
  - **DoD:** tidak ada teks bantu penting < 13 px; layout tidak overflow;
    jumlah `text-xs` turun signifikan dan sisanya memang metadata.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    screenshot 3 ukuran.
  - **Dependency:** —

- [ ] **UI-16 — Kartu backup: path, status, dan hierarki restore** · P1 · S
  - **Konteks:** Path backup panjang memakai `break-all` sehingga terpotong
    per karakter. Empat tombol backup/restore bergaya sama; restore
    mengganti data tetapi tidak dibedakan.
  - **Langkah:**
    1. Tampilkan nama file + tanggal backup; path lengkap di `title` atau
       tombol salin, bukan blok `break-all`.
    2. Tampilkan status “Backup terakhir: hari ini / N hari lalu” dengan
       badge yang benar (lihat UI-18).
    3. Pisahkan bagian Backup dan Pulihkan; beri gaya peringatan/danger
       pada restore.
    4. Pertahankan dialog konfirmasi restore yang sudah ada.
  - **DoD:** pada 1024 tidak ada path terpotong per karakter; operator bisa
    membedakan backup vs restore; status backup terbaca; konfirmasi tetap.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    screenshot 1024.
  - **Dependency:** —

- [ ] **UI-17 — Header judul halaman + hierarki heading** · P1 · S
  - **Konteks:** Header menampilkan “Sesi PIN terbuka” (jargon teknis) dan
    tidak menampilkan halaman aktif. Beberapa tab (Jurnal Umum, Buku Besar,
    Neraca Saldo, Pengaturan) mulai dari `<h2>` tanpa `<h1>`.
  - **Langkah:**
    1. Header kiri: judul halaman aktif (dari `TABS`) + subjudul singkat
       (nama entitas atau “Data lokal”); hapus “Sesi PIN terbuka”.
    2. Setiap tab punya tepat satu `<h1>` (judul utama di konten; Dashboard
       hero tetap).
    3. `document.title` mengikuti halaman (bisa memakai UI-06).
    4. Jangan mengubah tombol Kunci/aria-label.
  - **DoD:** header menunjukkan halaman aktif; tidak ada “Sesi PIN terbuka”;
    setiap tab punya satu h1; `npm run smoke` hijau.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`;
    cek heading via DevTools.
  - **Dependency:** UI-01, UI-06

---

## P2 — Konsistensi & polesan

- [ ] **UI-18 — Perbaiki tone `Badge` amber** · P2 · S
  - **Konteks:** `Badge` tone `amber` memakai `bg-emerald-100 text-emerald-800`,
    jadi “Sudah dikoreksi”, “Mode akuntan”, dan “Total kas tetap” tampil
    hijau seperti status sukses.
  - **Langkah:**
    1. Ubah mapping `amber` ke `bg-amber-100 text-amber-800` (atau token
       setara).
    2. Audit pemakaian `tone="amber"`; pastikan status peringatan/koreksi
       memang kuning, sukses tetap hijau, bahaya tetap merah.
    3. Jangan mengubah tone `green`/`red`/`stone`.
  - **DoD:** “Sudah dikoreksi” dan badge peringatan tampil amber; tidak ada
    regresi kontras AA; `npm run build` hijau.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** —

- [ ] **UI-19 — Focus ring konsisten untuk keyboard** · P2 · S
  - **Konteks:** Input memakai `focus:outline-none` dan hanya mengganti
    border 1 px; tombol memakai ring oranye bawaan Chromium. Indikator fokus
    tidak konsisten dan tipis.
  - **Langkah:**
    1. Tambah kelas fokus bersama untuk `Button`, `TextInput`, `Select`,
       `TextArea`, dan tombol nav:
       `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2`.
    2. Di sidebar gelap, gunakan ring terang (mis. `emerald-300`) agar
       terlihat.
    3. Jangan menghilangkan indikator fokus untuk pengguna mouse; gunakan
       `focus-visible`, bukan `focus`.
  - **DoD:** Tab menampilkan ring jelas di semua kontrol; tidak ada kontrol
    yang kehilangan indikator; `npm run build` hijau.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    uji Tab di dashboard, form, dan sidebar.
  - **Dependency:** —

- [ ] **UI-20 — Standarkan format tanggal** · P2 · M
  - **Konteks:** Format campur: input `27/10/2026`, tabel `27-10-2026`,
    hero `1 Jan 2026 – 27 Oct 2026`.
  - **Langkah:**
    1. Pilih satu format tampilan (mis. `27 Okt 2026` atau `27/10/2026`)
       dan satu helper di `src/utils/format.ts`.
    2. Ganti pemakaian `formatTanggal`/format manual di tabel, kartu,
       dashboard, modal, dan export agar konsisten.
    3. Input `type="date"` tetap mengikuti locale browser; jangan memaksa
       nilai internal selain `YYYY-MM-DD`.
    4. Tambah unit test untuk helper format.
  - **DoD:** tidak ada campuran `-` dan `/` pada tanggal tampilan; test
    helper hijau; export tetap benar.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`;
    grep pola tanggal.
  - **Dependency:** —

- [ ] **UI-21 — Konsistensi istilah UI** · P2 · S
  - **Konteks:** Istilah campur: “Dashboard”, “Cut-off”, “Muat”, “Pembantu”,
    “Daftar Akun (COA)”. Sebagian terasa teknis bagi operator awam.
  - **Langkah:**
    1. Sepakati istilah dengan pemilik sebelum mengganti label:
       - “Muat” → “Tampilkan”
       - “Cut-off” → “Per tanggal”
       - “Pembantu” → “Buku Pembantu”
       - “Dashboard” → tetap atau “Ringkasan”
    2. Ganti label yang disepakati di sidebar, judul kartu, tombol, dan
       pesan; jangan mengubah nama kolom DB/API.
    3. Perbarui test/e2e yang menunggu teks lama.
  - **DoD:** istilah konsisten di seluruh layar; tidak ada test yang gagal
    karena teks lama; perubahan disetujui pemilik.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build`.
  - **Dependency:** —

- [ ] **UI-22 — Sanitasi error “X is not defined”** · P2 · S
  - **Konteks:** `pesanError` menyaring banyak pola teknis, tetapi belum
    menyaring `"X is not defined"`. Saat build transisi sempat muncul
    “COA is not defined” di layar operator. Bug sumbernya sudah hilang,
    tetapi pola ini bisa muncul lagi.
  - **Langkah:**
    1. Tambah `/\bis not defined\b/i` (dan pola serumpun bila perlu) ke
       `POLA_TEKNIS` di `src/utils/pesanError.ts`.
    2. Tambah test di `tests/pesan-error.test.ts`:
       `new Error('COA is not defined')` → pesan fallback, bukan teks mentah.
    3. Jangan menyaring pesan bisnis berbahasa Indonesia.
  - **DoD:** test unit baru hijau; error teknis tidak bocor; pesan bisnis
    tetap tampil apa adanya.
  - **Verifikasi:** `npm run typecheck && npm test`.
  - **Dependency:** —

- [ ] **UI-23 — Audit ulang regresi UI** · P2 · M
  - **Konteks:** Setelah ticket P0/P1 selesai, perlu bukti bahwa tidak ada
    regresi visual/aksesibilitas.
  - **Langkah:**
    1. Jalankan ulang skrip audit 2026-10-27 (Electron + `playwright-core`;
       lihat `docs/audit-ui-2026-10-27.md`) pada 18 tab, 1280×800,
       1024×768, dan ukuran minimum. Jika skrip tidak tersedia, buat
       `e2e/ui-audit.test.mjs` dengan pola `_electron` seperti
       `e2e/smoke.test.mjs`.
    2. Uji: scroll antar-tab, header, keyboard Tab, modal, simpan transaksi,
       filter Jurnal, dan guard isian.
    3. Simpan screenshot + catatan di `docs/audit-ui-2026-10-27.md` (bagian
       hasil ulang) atau dokumen baru.
    4. Buka ticket baru untuk temuan yang tersisa; jangan perluas ticket ini.
  - **DoD:** 0 error console; tidak ada overflow horizontal; header terlihat;
    modal fokus terkurung; tidak ada isian hilang; laporan audit diperbarui.
  - **Verifikasi:** `npm run typecheck && npm test && npm run build && npm run smoke`;
    skrip audit manual.
  - **Dependency:** semua P0/P1

---

## Di luar scope (jangan dikerjakan di ticket UI)

- Perubahan skema DB, jurnal, reversal, tutup buku, atau perhitungan laporan.
- Enkripsi database, multi-user, atau perubahan model PIN.
- Redesign total (ganti framework, komponen library baru, dark mode).
- Menambah dependency besar (axe, Storybook, testing-library) tanpa
  persetujuan pemilik.
- Data seed/produksi di `data/` dan `data/backups/`.

## Backlog produk (belum jadi ticket)

- Command palette `Ctrl+K` untuk mencari 18 menu.
- Draft transaksi persisten saat auto-lock.
- Pengaturan urutan/favorit menu.
- Mode kontras tinggi / ukuran teks aplikasi.
- Sortir kolom tabel Jurnal Umum.
- Ekspor audit UI otomatis ke CI (screenshot diff).
