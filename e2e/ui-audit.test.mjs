// UI-23 — Audit regresi UI otomatis memakai Electron asli (Playwright).
//
// Menjalankan hasil `npm run build` dengan profil & database sementara per
// ukuran jendela, lalu memeriksa 13 tab: error console, overflow horizontal,
// h1/header, sticky header, reset scroll antar tab, skip link, modal, guard
// isian, simpan transaksi, filter Jurnal Umum, dan akses sidebar. Jurnal Umum
// hanya muncul setelah Mode lanjutan diaktifkan, sesuai DB-26/DB-29.
//
// UI-A27 — alur regresi perbaikan tiket audit UI dijalankan setelah audit tab
// dasar, di ujung test agar kunci periode uji tidak mengganggu alur lain:
// - UI-A01: grid nota Panjar baru dirender setelah target dipilih; ganti
//   target saat form PJ kotor wajib konfirmasi "Ganti panjar?".
// - UI-A02: KoreksiModal Escape saat isian berubah → konfirmasi
//   "Buang isian koreksi?"; tanpa perubahan langsung tutup.
// - UI-A20: Duplikat nonaktif dengan alasan untuk jurnal SALDO_AWAL.
// - UI-A10: rentang terbalik Laba Rugi/Arus Kas → guard amber seragam dan
//   badge SURPLUS/DEFISIT tidak tampil.
// - UI-A03: drill-down Neraca → Buku Besar membawa periode sumber ("per …").
// - UI-A05: Pengaturan Pembukuan aktif setelah muat sukses (jalur gagal muat
//   dikunci lewat uji sumber di tests/ui-a05-pembukuan-gagal-muat.test.ts
//   karena IPC pengaturanGet tidak bisa digagalkan lewat e2e).
// - UI-A09: LockModal — alasan 3 karakter → tombol mati + helper; 5 karakter
//   → tombol aktif dan submit benar-benar tersimpan (tahun lalu dikunci lewat
//   alur Kunci Periode lebih dulu).
// - UI-A13: form Transaksi kosong → tombol Simpan mati dengan alasan
//   "Isi dulu: …" yang terlihat.
//
// Jalankan: npm run test:ui-audit
// Simpan folder data uji saat gagal: SMOKE_KEEP=1 npm run test:ui-audit
//
// Catatan ukuran: jendela punya minWidth/minHeight 1024×680, jadi 800×600
// tidak bisa diuji (akan di-clamp oleh OS/Electron). Ukuran diatur lewat
// BrowserWindow.setSize + reload agar default lipat sidebar mengikuti lebar.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright-core';

const root = process.cwd();
const waktu = new Date().toISOString().replace(/[:.]/g, '-');
const artifacts = join(root, 'e2e', 'artifacts', `ui-audit-${waktu}`);

const UKURAN = [
  { nama: '1280x800', width: 1280, height: 800 },
  { nama: '1024x768', width: 1024, height: 768 },
  // Minimum yang dijanjikan UI-02. 800×600 tidak mungkin: BrowserWindow
  // memaksa minWidth 1024 / minHeight 680.
  { nama: '1024x680', width: 1024, height: 680 },
];

/** Daftar tab yang diaudit (mengikuti menu sidebar yang tersedia). */
const TAB = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'transaksi', label: 'Transaksi' },
  { id: 'akun', label: 'Daftar Akun' },
  { id: 'jurnal', label: 'Jurnal Umum' },
  { id: 'buku-besar', label: 'Buku Besar' },
  { id: 'neraca-saldo', label: 'Neraca Saldo' },
  { id: 'panjar', label: 'Buku Panjar' },
  { id: 'pinjaman', label: 'Pinjaman LPD' },
  { id: 'laba-rugi', label: 'Laba Rugi' },
  { id: 'neraca', label: 'Neraca' },
  { id: 'arus-kas', label: 'Arus Kas' },
  { id: 'tutup', label: 'Kunci Periode' },
  { id: 'pengaturan', label: 'Pengaturan' },
];

const TAB_DI_GRUP_LAPORAN = new Set([
  'Buku Besar',
  'Neraca Saldo',
  'Laba Rugi',
  'Neraca',
  'Arus Kas',
]);

const pesan = (bagian, detail) => `${bagian}: ${detail}`;

function tombolTab(page, label) {
  if (label === 'Pengaturan') {
    return page.getByRole('button', { name: 'Pengaturan', exact: true });
  }
  return page
    .getByRole('navigation', { name: 'Menu utama' })
    .getByRole('button', { name: label, exact: true });
}

async function tungguHeader(page, label) {
  await page.waitForFunction(
    (teks) => document.querySelector('header p')?.textContent?.trim() === teks,
    label,
    { timeout: 20_000 },
  );
}

/** Klik item sidebar tanpa menunggu perpindahan (dipakai saat guard muncul). */
async function klikTab(page, label) {
  let tombol = tombolTab(page, label);
  if ((await tombol.count()) === 0) {
    // Grup Laporan default tertutup di sidebar terbuka.
    const grup = TAB_DI_GRUP_LAPORAN.has(label) ? 'Laporan' : null;
    if (!grup) throw new Error(`Tombol tab tidak ditemukan: ${label}`);
    const toggle = page.getByRole('button', { name: grup, exact: true });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    tombol = tombolTab(page, label);
  }
  await tombol.first().click();
}

/** Klik tab, tunggu header berganti, beri waktu data async selesai. */
async function pindahTab(page, label) {
  await klikTab(page, label);
  await tungguHeader(page, label);
  await page.waitForTimeout(300);
}

/** Tunggu layar PIN setup/buka selesai; buat PIN 123456 bila database baru. */
async function siapkanSesi(page, t) {
  await page.waitForFunction(
    () => {
      const teks = document.body?.innerText ?? '';
      return (
        teks.includes('Buat PIN 6 digit') ||
        teks.includes('Masukkan PIN 6 digit') ||
        Boolean(document.querySelector('header p'))
      );
    },
    null,
    { timeout: 60_000 },
  );

  const tombolSimpan = page.getByRole('button', { name: 'Simpan PIN' });
  if ((await tombolSimpan.count()) > 0) {
    await page.getByLabel('PIN baru 6 digit').fill('123456');
    await page.getByLabel('Ulangi PIN baru', { exact: true }).fill('123456');
    await tombolSimpan.click();
    // Kode darurat tampil sekali; tutup setelah dipastikan ada.
    await page
      .getByRole('heading', { name: 'Simpan kode darurat ini' })
      .waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Saya sudah mencatat' }).click();
  } else if ((await page.getByLabel('Digit PIN ke-1').count()) > 0) {
    await page.getByLabel('Digit PIN ke-1').click();
    await page.keyboard.type('123456');
  }

  await page
    .getByRole('navigation', { name: 'Menu utama' })
    .waitFor({ timeout: 30_000 });
  await tungguHeader(page, 'Dashboard');
  await page.waitForTimeout(300);
  t.diagnostic('Sesi siap: PIN 123456, kode darurat ditutup');
}

/**
 * Set ukuran jendela lalu reload. Reload penting: status lipat sidebar dibaca
 * saat mount, jadi default 1024 (lipat) baru berlaku setelah render ulang.
 */
async function aturUkuran(app, page, ukuran, t) {
  await app.evaluate(
    ({ BrowserWindow }, dimensi) => {
      const jendela = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
      if (!jendela) throw new Error('Jendela utama tidak ditemukan');
      jendela.setSize(dimensi.width, dimensi.height);
    },
    { width: ukuran.width, height: ukuran.height },
  );
  await page.waitForTimeout(300);
  await page.reload();
  await siapkanSesi(page, t);
  const metrik = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    outerWidth: window.outerWidth,
    outerHeight: window.outerHeight,
    layar: `${window.screen.width}x${window.screen.height}`,
    lipat: window.localStorage.getItem('pura.sidebar.collapsed'),
  }));
  t.diagnostic(
    `${ukuran.nama}: viewport ${metrik.innerWidth}×${metrik.innerHeight}, ` +
      `window ${metrik.outerWidth}×${metrik.outerHeight}, layar ${metrik.layar}`,
  );
  return metrik;
}

/**
 * DB-26/DB-29: Jurnal Umum harus tersembunyi secara default, lalu muncul di
 * grup Data & Sistem setelah Mode lanjutan diaktifkan. Label periode memakai
 * "Kunci Periode", bukan "Tutup Buku".
 */
async function aktifkanModeLanjutan(page, t) {
  const nav = page.getByRole('navigation', { name: 'Menu utama' });
  const jurnal = nav.getByRole('button', { name: 'Jurnal Umum', exact: true });

  assert.equal(
    await jurnal.count(),
    0,
    'Jurnal Umum tampil sebelum Mode lanjutan diaktifkan',
  );
  assert.ok(
    await nav.getByRole('button', { name: 'Kunci Periode', exact: true }).isVisible(),
    'Menu Kunci Periode tidak terlihat di Data & Sistem',
  );
  assert.equal(
    await nav.getByRole('button', { name: 'Tutup Buku', exact: true }).count(),
    0,
    'Label lama Tutup Buku masih tampil',
  );

  await page.evaluate(() => {
    window.localStorage.setItem('pura.mode.lanjutan', 'true');
  });
  await page.reload();
  await siapkanSesi(page, t);
  await page.waitForTimeout(300);

  assert.equal(
    await jurnal.count(),
    1,
    'Jurnal Umum tidak muncul setelah Mode lanjutan diaktifkan',
  );
  t.diagnostic(
    'Mode lanjutan OK: Jurnal Umum tersembunyi default, lalu muncul di Data & Sistem',
  );
}

/** Cek sidebar: Pengaturan selalu terlihat; grup Laporan bisa dibuka. */
async function cekSidebar(page, ukuran) {
  const pengaturan = tombolTab(page, 'Pengaturan');
  assert.ok(
    await pengaturan.isVisible(),
    'Pengaturan harus terlihat di sidebar',
  );
  const kotak = await pengaturan.boundingBox();
  const tinggiViewport = await page.evaluate(() => window.innerHeight);
  assert.ok(kotak, 'Pengaturan tidak punya kotak layout');
  assert.ok(
    kotak.y >= -1 && kotak.y + kotak.height <= tinggiViewport + 1,
    pesan(
      'Pengaturan keluar viewport',
      `y=${kotak.y}, tinggi=${kotak.height}, viewport=${tinggiViewport}`,
    ),
  );

  const nav = page.getByRole('navigation', { name: 'Menu utama' });
  if (ukuran.width >= 1200) {
    // Sidebar terbuka: grup Laporan default tertutup, harus bisa dibuka.
    const toggle = page.getByRole('button', { name: 'Laporan', exact: true });
    assert.equal(await toggle.count(), 1, 'Tombol grup Laporan tidak ada');
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    assert.equal(
      await toggle.getAttribute('aria-expanded'),
      'true',
      'Grup Laporan gagal dibuka',
    );
    for (const label of TAB_DI_GRUP_LAPORAN) {
      assert.ok(
        await nav.getByRole('button', { name: label, exact: true }).isVisible(),
        `Item laporan ${label} tidak terlihat setelah grup dibuka`,
      );
    }
    // Jurnal Umum sudah terlihat karena Mode lanjutan aktif; pastikan bukan
    // race setelah reload sebelum menghitung tombol.
    assert.ok(
      await nav.getByRole('button', { name: 'Jurnal Umum', exact: true }).isVisible(),
      'Jurnal Umum tidak terlihat di sidebar setelah Mode lanjutan aktif',
    );
    // Isi nav saat sidebar terbuka = seluruh tab kecuali Pengaturan (dipin di
    // footer di luar <nav>) + 3 tombol header grup (Harian/Laporan/Data).
    // Jangan menulis angka mati: daftar TAB boleh berubah tanpa membuat audit
    // gagal karena selisih satu.
    const jumlahItemNav = TAB.length - 1;
    assert.equal(
      await nav.getByRole('button').count(),
      jumlahItemNav + 3,
      'Jumlah tombol nav tidak sesuai setelah grup Laporan dibuka',
    );
  } else {
    // Sidebar lipat: semua 13 item tetap bisa diakses lewat aria-label.
    for (const tab of TAB) {
      if (tab.label === 'Pengaturan') continue;
      assert.ok(
        await nav.getByRole('button', { name: tab.label, exact: true }).isVisible(),
        `Item nav ${tab.label} tidak terlihat saat sidebar lipat`,
      );
    }
  }
}

/** Audit satu tab: h1, header, overflow, screenshot, sticky header. */
async function auditTab(page, ukuran, tab, indeks, t) {
  const metrik = await page.evaluate(() => {
    const main = document.querySelector('main');
    const header = document.querySelector('header');
    const dok = document.documentElement;
    if (!main || !header) throw new Error('Shell main/header tidak ditemukan');
    return {
      jumlahH1: document.querySelectorAll('h1').length,
      teksH1: [...document.querySelectorAll('h1')].map((el) =>
        (el.textContent ?? '').trim(),
      ),
      labelHeader: document.querySelector('header p')?.textContent?.trim() ?? '',
      overflowDokumen: dok.scrollWidth - dok.clientWidth,
      overflowMain: main.scrollWidth - main.clientWidth,
      topHeader: header.getBoundingClientRect().top,
      scrollTop: main.scrollTop,
      scrollMaks: main.scrollHeight - main.clientHeight,
    };
  });

  assert.equal(
    metrik.jumlahH1,
    1,
    pesan(`${tab.label}: jumlah h1`, `${metrik.jumlahH1} (${metrik.teksH1.join(' | ')})`),
  );
  assert.equal(
    metrik.labelHeader,
    tab.label,
    pesan(`${tab.label}: label header kiri`, `"${metrik.labelHeader}"`),
  );
  assert.ok(
    metrik.overflowDokumen <= 0,
    pesan(`${tab.label}: overflow horizontal dokumen`, `${metrik.overflowDokumen}px`),
  );
  assert.ok(
    metrik.overflowMain <= 0,
    pesan(`${tab.label}: overflow horizontal main`, `${metrik.overflowMain}px`),
  );
  assert.ok(
    Math.abs(metrik.topHeader) <= 1,
    pesan(`${tab.label}: header tidak menempel di atas`, `top=${metrik.topHeader}`),
  );

  await page.screenshot({
    path: join(
      artifacts,
      ukuran.nama,
      `${String(indeks + 1).padStart(2, '0')}-${tab.id}.png`,
    ),
  });

  // Sticky: gulir main 650 px (atau maksimum bila lebih pendek). Header harus
  // tetap di top 0 karena berada di dalam area scroll yang sama.
  const setelahGulir = await page.evaluate(() => {
    const main = document.querySelector('main');
    main.scrollTop = 650;
    return main.scrollTop;
  });
  await page.waitForTimeout(120);
  const topSetelahGulir = await page.evaluate(
    () => document.querySelector('header').getBoundingClientRect().top,
  );
  assert.ok(
    Math.abs(topSetelahGulir) <= 1,
    pesan(
      `${tab.label}: header tidak sticky setelah digulir`,
      `scrollTop=${setelahGulir}, top=${topSetelahGulir}`,
    ),
  );

  t.diagnostic(
    `${ukuran.nama} ${tab.label}: h1=1, overflow doc/main=${metrik.overflowDokumen}/${metrik.overflowMain}, ` +
      `scrollMaks=${metrik.scrollMaks}, scroll=${setelahGulir}, headerTop=${topSetelahGulir}`,
  );

  return {
    ...metrik,
    scrollSetelahGulir: setelahGulir,
    topSetelahGulir,
  };
}

/** Scroll dashboard ke bawah → pindah tab/shortcut → main kembali 0. */
async function cekScrollAntarTab(page, t) {
  await pindahTab(page, 'Dashboard');
  const posisiBawah = await page.evaluate(() => {
    const main = document.querySelector('main');
    main.scrollTop = main.scrollHeight;
    return main.scrollTop;
  });
  assert.ok(
    posisiBawah > 650,
    pesan('Dashboard tidak cukup panjang untuk uji scroll', `${posisiBawah}px`),
  );

  // Jalur 1: klik menu Transaksi dari sidebar.
  await pindahTab(page, 'Transaksi');
  const resetMenu = await page.evaluate(
    () => document.querySelector('main').scrollTop,
  );
  assert.equal(resetMenu, 0, 'Scroll main tidak kembali 0 setelah klik menu');
  assert.ok(
    await page.getByLabel('Tanggal').isVisible(),
    'Field Tanggal tidak terlihat setelah pindah tab',
  );

  // Jalur 2: shortcut "Terima Uang" di dashboard. Klik lewat DOM agar posisi
  // scroll bawah tidak diubah oleh auto-scroll Playwright sebelum klik.
  await pindahTab(page, 'Dashboard');
  await page.evaluate(() => {
    const main = document.querySelector('main');
    main.scrollTop = main.scrollHeight;
  });
  const posisiSebelumShortcut = await page.evaluate(
    () => document.querySelector('main').scrollTop,
  );
  assert.ok(posisiSebelumShortcut > 650, 'Dashboard gagal digulir ke bawah');
  await page
    .getByRole('button', { name: 'Terima Uang', exact: true })
    .evaluate((el) => el.click());
  await tungguHeader(page, 'Transaksi');
  await page.waitForTimeout(300);
  const resetShortcut = await page.evaluate(
    () => document.querySelector('main').scrollTop,
  );
  assert.equal(
    resetShortcut,
    0,
    'Scroll main tidak kembali 0 setelah shortcut Terima Uang',
  );
  assert.ok(
    await page.getByLabel('Tanggal').isVisible(),
    'Field Tanggal tidak terlihat setelah shortcut Terima Uang',
  );

  t.diagnostic(
    `scroll antar-tab OK: dashboard ${posisiBawah}px → menu/shortcut, scrollTop 0, Tanggal terlihat`,
  );
}

/** Tab pertama = skip link; Enter memfokuskan #main-content. */
async function cekSkipLink(page, t) {
  // Uji dari keadaan awal halaman: reload agar titik awal navigasi fokus
  // kembali ke awal dokumen (bukan setelah tombol sidebar terakhir diklik).
  await page.reload();
  await siapkanSesi(page, t);
  await page.waitForTimeout(300);

  const aktifAwal = await page.evaluate(() => ({
    tag: document.activeElement?.tagName ?? '',
    id: document.activeElement?.id ?? '',
  }));
  assert.ok(
    aktifAwal.tag === 'BODY' || aktifAwal.id === '',
    pesan('Ada elemen terfokus otomatis sebelum Tab pertama', JSON.stringify(aktifAwal)),
  );

  await page.keyboard.press('Tab');
  const pertama = await page.evaluate(() => ({
    teks: (document.activeElement?.textContent ?? '').trim(),
    tag: document.activeElement?.tagName ?? '',
  }));
  assert.equal(
    pertama.tag,
    'A',
    pesan('Fokus pertama bukan tautan', JSON.stringify(pertama)),
  );
  assert.equal(
    pertama.teks,
    'Lewati ke konten',
    pesan('Fokus pertama bukan skip link', JSON.stringify(pertama)),
  );

  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => document.activeElement?.id === 'main-content',
    null,
    { timeout: 5_000 },
  );
}

/** Guard isian transaksi: dialog, tetap di sini, tinggalkan, form bersih. */
async function cekGuard(page, folder, t) {
  const dialog = page.getByRole('dialog', { name: 'Isian belum disimpan' });

  await pindahTab(page, 'Transaksi');
  await page.getByLabel('Nominal').fill('123.456');
  await page.getByLabel('Keterangan').fill('Isian belum disimpan UI-23');
  await klikTab(page, 'Jurnal Umum');
  await dialog.waitFor({ timeout: 15_000 });
  await page.screenshot({
    path: join(folder, 'flow-guard-isian.png'),
  });

  await page.getByRole('button', { name: 'Tetap di sini' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    (await page.getByLabel('Keterangan').inputValue()),
    'Isian belum disimpan UI-23',
    'Keterangan hilang setelah "Tetap di sini"',
  );
  assert.equal(
    (await page.getByLabel('Nominal').inputValue()).replace(/[^\d]/g, ''),
    '123456',
    'Nominal hilang setelah "Tetap di sini"',
  );

  await klikTab(page, 'Jurnal Umum');
  await dialog.waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Tinggalkan' }).click();
  await tungguHeader(page, 'Jurnal Umum');

  await pindahTab(page, 'Transaksi');
  assert.equal(
    await page.getByLabel('Nominal').inputValue(),
    '',
    'Nominal tidak dikosongkan setelah "Tinggalkan"',
  );
  assert.equal(
    await page.getByLabel('Keterangan').inputValue(),
    '',
    'Keterangan tidak dikosongkan setelah "Tinggalkan"',
  );

  // Form bersih: pindah tab langsung tanpa dialog.
  await klikTab(page, 'Jurnal Umum');
  await tungguHeader(page, 'Jurnal Umum');
  await page.waitForTimeout(500);
  assert.equal(
    await dialog.count(),
    0,
    'Dialog guard muncul untuk form bersih',
  );

  t.diagnostic('guard isian OK: dialog, tetap di sini, tinggalkan, form bersih');
}

/** Simpan transaksi kecil lalu pastikan muncul di Jurnal Umum. */
async function cekSimpanTransaksi(page, folder, t) {
  await pindahTab(page, 'Transaksi');
  const keterangan = `UJI UI-23 ${waktu}`;
  await page.getByLabel('Nominal').fill('12.345');
  await page.getByLabel('Keterangan').fill(keterangan);
  await page.getByRole('button', { name: 'Simpan Transaksi' }).click();

  const status = page.getByRole('status').filter({ hasText: 'tersimpan' });
  await status.waitFor({ timeout: 20_000 });
  const teksStatus = (await status.textContent()) ?? '';
  assert.match(
    teksStatus,
    /tersimpan.*JU-\d{4}-\d{4}.*Rp/s,
    pesan('Pesan sukses transaksi tidak lengkap', teksStatus),
  );

  await pindahTab(page, 'Jurnal Umum');
  await page.getByLabel('Cari').fill(keterangan);
  const baris = page.locator('tbody tr').filter({ hasText: keterangan });
  await baris.waitFor({ timeout: 20_000 });
  assert.equal(
    await baris.count(),
    1,
    pesan('Baris transaksi tidak muncul tepat satu di Jurnal Umum', keterangan),
  );
  await page.screenshot({
    path: join(folder, 'flow-simpan-jurnal.png'),
  });

  t.diagnostic(`simpan transaksi OK: "${keterangan}" tampil di Jurnal Umum`);
  return { keterangan, baris };
}

/**
 * T3.8: konfirmasi aksi berisiko menjelaskan dampak, memfokuskan pilihan aman,
 * dan bisa ditutup dengan Escape tanpa menjalankan aksi.
 */
async function cekKonfirmasiAksiBerisiko(page, t) {
  const pemicu = page.getByRole('button', { name: 'Backup Lengkap (disarankan)' });
  await pemicu.scrollIntoViewIfNeeded();
  await pemicu.click();

  const dialog = page.getByRole('dialog', { name: 'Buat backup lengkap?' });
  await dialog.waitFor({ timeout: 10_000 });
  const teks = await dialog.innerText();
  assert.match(teks, /Yang berubah:/, 'Konfirmasi backup tidak menyebut yang berubah');
  assert.match(teks, /Yang tetap:/, 'Konfirmasi backup tidak menyebut yang tetap');
  // UI-A18: peringatan tak-terenkripsi cukup sekali di kartu (kotak permanen),
  // jadi modal konfirmasi tidak mengulangnya.
  assert.equal(
    await page.locator('[data-testid="peringatan-backup-tidak-terenkripsi"]').count(),
    1,
    'Peringatan backup tak-terenkripsi harus tampil tepat satu di kartu',
  );
  assert.doesNotMatch(
    teks,
    /tidak terenkripsi/i,
    'Konfirmasi backup tidak perlu mengulang peringatan enkripsi',
  );

  const fokus = await page.evaluate(() =>
    (document.activeElement?.textContent ?? '').trim(),
  );
  assert.equal(fokus, 'Batal', 'Fokus awal konfirmasi bukan pilihan aman Batal');

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    () => (document.activeElement?.textContent ?? '').includes('Backup Lengkap'),
    null,
    { timeout: 5_000 },
  );

  // UI-A17: label dibakukan ke "Pulihkan (restore)" — tombol lama "Restore
  // Lengkap" sudah tidak ada.
  const restore = page.getByRole('button', { name: 'Pulihkan Lengkap (disarankan)' });
  await restore.click();
  const dialogRestore = page.getByRole('dialog', {
    name: 'Pulihkan dari backup lengkap?',
  });
  await dialogRestore.waitFor({ timeout: 10_000 });
  const teksRestore = await dialogRestore.innerText();
  assert.match(teksRestore, /Yang tetap:/, 'Konfirmasi restore tidak menyebut yang tetap');
  assert.match(teksRestore, /dicadangkan otomatis/, 'Konfirmasi restore tidak menyebut cadangan otomatis');
  assert.doesNotMatch(teksRestore, /manifest.json|pura.db/, 'Konfirmasi restore membocorkan nama file internal');
  await page.keyboard.press('Escape');
  await dialogRestore.waitFor({ state: 'detached' });

  t.diagnostic(
    'konfirmasi aksi berisiko OK: copy dampak, fokus Batal, Escape menutup tanpa aksi',
  );
}

/** Modal Detail Jurnal: fokus masuk, Tab terkurung, Escape + restore fokus. */
async function cekModalJurnal(page, baris, folder, t) {
  const dialog = page.getByRole('dialog', { name: 'Detail Jurnal' });
  const pemicu = baris.getByRole('button', { name: /^Lihat jurnal / });
  await pemicu.focus();
  const labelPemicu = await pemicu.getAttribute('aria-label');
  assert.ok(labelPemicu, 'Tombol pemicu tidak punya aria-label');

  await page.keyboard.press('Enter');
  await dialog.waitFor({ timeout: 15_000 });

  const fokusDiDialog = () =>
    page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));
  assert.ok(await fokusDiDialog(), 'Fokus awal tidak masuk dialog Detail Jurnal');

  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    assert.ok(
      await fokusDiDialog(),
      `Tab ke-${i + 1} keluar dari dialog Detail Jurnal`,
    );
  }
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Shift+Tab');
    assert.ok(
      await fokusDiDialog(),
      `Shift+Tab ke-${i + 1} keluar dari dialog Detail Jurnal`,
    );
  }

  await page.screenshot({
    path: join(folder, 'flow-modal-jurnal.png'),
  });

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  await page.waitForFunction(
    (label) => document.activeElement?.getAttribute('aria-label') === label,
    labelPemicu,
    { timeout: 5_000 },
  );

  t.diagnostic(
    'modal Detail Jurnal OK: fokus masuk, 20×Tab + 20×Shift+Tab terkurung, Escape + fokus kembali',
  );
}

/** Label filter ada; rentang terbalik memblokir hasil/export; lalu pulih. */
async function cekFilterJurnal(page, folder, t) {
  await page.getByLabel('Cari').fill('');
  await page.waitForTimeout(600);

  // Label terlihat. Select yang dibungkus <label> ikut menyerap teks opsi ke
  // nama aksesibel, jadi dicocokkan lewat awalan "Jenis".
  const kontrolFilter = [
    ['Cari', page.getByLabel('Cari', { exact: true })],
    ['Dari tanggal', page.getByLabel('Dari tanggal', { exact: true })],
    ['Sampai tanggal', page.getByLabel('Sampai tanggal', { exact: true })],
    ['Filter jenis', page.getByRole('combobox', { name: /^Filter jenis\b/ })],
  ];
  for (const [label, kontrol] of kontrolFilter) {
    assert.ok(
      await kontrol.isVisible(),
      `Label filter "${label}" tidak terlihat`,
    );
  }

  const alert = page.getByRole('alert').filter({ hasText: 'tidak boleh setelah' });
  await page.getByLabel('Dari tanggal', { exact: true }).fill('2026-12-31');
  await page.getByLabel('Sampai tanggal', { exact: true }).fill('2026-01-01');
  await alert.waitFor({ timeout: 10_000 });

  assert.equal(
    await page.getByRole('button', { name: /^Lihat jurnal / }).count(),
    0,
    'Rentang terbalik masih menampilkan baris jurnal',
  );
  assert.ok(
    await page
      .locator('tbody')
      .getByText('Perbaiki rentang tanggal untuk menampilkan jurnal.')
      .isVisible(),
    'Pesan kosong untuk rentang terbalik tidak tampil',
  );
  for (const namaTombol of ['Ekspor Excel', 'Simpan PDF', 'Pratinjau Cetak']) {
    assert.ok(
      await page.getByRole('button', { name: namaTombol }).isDisabled(),
      `${namaTombol} tetap aktif saat rentang terbalik`,
    );
  }

  // Perbaiki rentang → hasil dan export kembali.
  await page.getByLabel('Sampai tanggal', { exact: true }).fill('2026-12-31');
  await alert.waitFor({ state: 'detached', timeout: 10_000 });
  await page.getByLabel('Dari tanggal', { exact: true }).fill('2026-01-01');
  await page
    .getByRole('button', { name: /^Lihat jurnal / })
    .first()
    .waitFor({ timeout: 20_000 });
  assert.ok(
    await page.getByRole('button', { name: 'Ekspor Excel' }).isEnabled(),
    'Ekspor Excel tidak aktif kembali setelah rentang diperbaiki',
  );

  await page.screenshot({
    path: join(folder, 'flow-filter-jurnal.png'),
  });
  t.diagnostic(
    'filter Jurnal OK: label lengkap, rentang terbalik memblokir hasil/export, rentang benar memulihkan',
  );
}

/** Status lipat sidebar tidak boleh menghilangkan akses menu. */
async function cekLipatSidebar(page, ukuran, t) {
  const nav = page.getByRole('navigation', { name: 'Menu utama' });
  const semuaItemTerlihat = async () => {
    for (const tab of TAB) {
      if (tab.label === 'Pengaturan') continue;
      assert.ok(
        await nav.getByRole('button', { name: tab.label, exact: true }).isVisible(),
        `Item ${tab.label} tidak terlihat setelah status lipat berubah`,
      );
    }
  };

  if (ukuran.width >= 1200) {
    await page.getByRole('button', { name: 'Lipat menu' }).click();
    assert.equal(
      await page.getByRole('button', { name: 'Buka menu' }).count(),
      1,
      'Sidebar gagal dilipat',
    );
    await semuaItemTerlihat();
    await page.getByRole('button', { name: 'Buka menu' }).click();
  } else {
    await page.getByRole('button', { name: 'Buka menu' }).click();
    const toggle = page.getByRole('button', { name: 'Laporan', exact: true });
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click();
    }
    for (const label of TAB_DI_GRUP_LAPORAN) {
      assert.ok(
        await nav.getByRole('button', { name: label, exact: true }).isVisible(),
        `Item ${label} tidak terlihat setelah sidebar dibuka`,
      );
    }
    await page.getByRole('button', { name: 'Lipat menu' }).click();
    await semuaItemTerlihat();
  }

  t.diagnostic('sidebar OK: grup Laporan bisa dibuka, status lipat tetap mengakses semua tab');
}

// ---------------------------------------------------------------------------
// UI-A27 — regresi perbaikan tiket audit UI (UI-A01 s/d UI-A20).
// ---------------------------------------------------------------------------

/**
 * UI-A20 (kasus 3): tombol Duplikat tidak tersedia untuk jurnal SALDO_AWAL,
 * dengan alasan terlihat; jurnal biasa (TERIMA) tetap bisa diduplikat.
 * Seed dev menaruh saldo awal di JU-2026-0001 dan TERIMA di JU-2026-0002,
 * keduanya ada di halaman 1 (urutan tanggal menaik).
 */
async function cekDuplikatSaldoAwal(page, t) {
  const detail = page.getByRole('dialog', { name: 'Detail Jurnal' });

  const lihatSaldoAwal = page.getByRole('button', {
    name: 'Lihat jurnal JU-2026-0001',
  });
  await lihatSaldoAwal.waitFor({ timeout: 20_000 });
  await lihatSaldoAwal.click();
  await detail.waitFor({ timeout: 15_000 });

  const duplikat = detail.getByRole('button', { name: 'Duplikat' });
  assert.equal(await duplikat.count(), 1, 'Tombol Duplikat hilang dari Detail Jurnal');
  assert.ok(
    await duplikat.isDisabled(),
    'Duplikat aktif untuk jurnal SALDO_AWAL — saldo awal bisa tercatat ganda',
  );
  assert.equal(
    await duplikat.getAttribute('title'),
    'Saldo awal tidak bisa diduplikat: saldo awal hanya boleh diatur lewat wizard saldo awal.',
    'Duplikat nonaktif tanpa alasan terlihat',
  );
  // Konsistensi: koreksi saldo awal juga diblokir di baris yang sama.
  assert.ok(
    await page.getByRole('button', { name: 'Koreksi jurnal JU-2026-0001' }).isDisabled(),
    'Koreksi aktif untuk jurnal SALDO_AWAL',
  );
  await page.keyboard.press('Escape');
  await detail.waitFor({ state: 'detached' });

  // Kontras: jurnal TERIMA boleh diduplikat (guard tidak terlalu luas).
  const lihatTerima = page.getByRole('button', { name: 'Lihat jurnal JU-2026-0002' });
  await lihatTerima.waitFor({ timeout: 10_000 });
  await lihatTerima.click();
  await detail.waitFor({ timeout: 15_000 });
  assert.ok(
    await detail.getByRole('button', { name: 'Duplikat' }).isEnabled(),
    'Duplikat ikut mati untuk jurnal TERIMA — guard terlalu luas',
  );
  await page.keyboard.press('Escape');
  await detail.waitFor({ state: 'detached' });

  t.diagnostic('UI-A20 OK: Duplikat nonaktif+alasan untuk SALDO_AWAL, aktif untuk TERIMA');
}

/**
 * UI-A02 (kasus 2): KoreksiModal — Escape saat isian berubah memunculkan
 * konfirmasi "Buang isian koreksi?"; tanpa perubahan langsung menutup modal.
 */
async function cekKoreksiModalKonfirmasi(page, t) {
  const pemicu = page.getByRole('button', { name: 'Koreksi jurnal JU-2026-0002' });
  const modal = page.getByRole('dialog', { name: 'Koreksi Jurnal' });
  const buang = page.getByRole('dialog', { name: 'Buang isian koreksi?' });

  await pemicu.waitFor({ timeout: 10_000 });
  await pemicu.click();
  await modal.waitFor({ timeout: 15_000 });

  // Tanpa perubahan: Escape langsung menutup modal tanpa konfirmasi.
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
  assert.equal(
    await buang.count(),
    0,
    'Konfirmasi buang muncul padahal isian koreksi belum diubah',
  );

  // Dengan perubahan: Escape memunculkan konfirmasi.
  await pemicu.click();
  await modal.waitFor({ timeout: 15_000 });
  await page.getByLabel(/^Alasan koreksi/).fill('Salah ketik nominal — uji UI-A27');
  await page.keyboard.press('Escape');
  await buang.waitFor({ timeout: 10_000 });

  // Escape pada konfirmasi hanya menutup konfirmasi; modal koreksi tetap ada.
  await page.keyboard.press('Escape');
  await buang.waitFor({ state: 'detached' });
  assert.equal(await modal.count(), 1, 'Modal koreksi ikut tertutup saat konfirmasi dibatalkan');

  // Escape ulang → konfirmasi lagi → "Ya, buang isian" menutup modal koreksi.
  await page.keyboard.press('Escape');
  await buang.waitFor({ timeout: 10_000 });
  await buang.getByRole('button', { name: 'Ya, buang isian' }).click();
  await modal.waitFor({ state: 'detached' });

  t.diagnostic(
    'UI-A02 OK: Escape tanpa perubahan langsung tutup; dengan perubahan muncul konfirmasi buang',
  );
}

/**
 * UI-A10 (kasus 4): rentang terbalik di Laba Rugi & Arus Kas memunculkan
 * guard amber seragam, memblokir fetch (tabel & badge hilang), lalu pulih
 * lewat preset tahun buku.
 */
async function cekGuardRentangLaporan(page, t) {
  const presetTahun = page.getByRole('button', { name: 'Tahun berjalan (tahun buku)' });

  await pindahTab(page, 'Laba Rugi');
  await page.getByLabel('Dari tanggal').fill('2026-12-31');
  await page.getByLabel('Sampai tanggal').fill('2026-01-01');
  const guard = page.getByRole('alert').filter({ hasText: 'tidak boleh setelah' });
  await guard.waitFor({ timeout: 10_000 });
  assert.match(
    (await guard.textContent()) ?? '',
    /menampilkan Laba Rugi/,
    'Guard rentang terbalik tidak menyebut nama laporan',
  );
  // Fetch diblok: hasil lama dihapus, jadi badge dan tabel tidak tampil.
  assert.equal(
    await page.getByText('SURPLUS').count(),
    0,
    'Badge SURPLUS tampil untuk rentang terbalik',
  );
  assert.equal(
    await page.getByText('DEFISIT').count(),
    0,
    'Badge DEFISIT tampil untuk rentang terbalik',
  );
  assert.equal(
    await page.getByText('Total Pendapatan').count(),
    0,
    'Tabel Laba Rugi masih tampil untuk rentang terbalik',
  );

  await presetTahun.click();
  await guard.waitFor({ state: 'detached', timeout: 10_000 });
  await page.locator('h1').getByText(/SURPLUS|DEFISIT/).waitFor({ timeout: 20_000 });

  // Guard yang sama berlaku di Arus Kas (komponen KontrolPeriode bersama).
  await pindahTab(page, 'Arus Kas');
  await page.getByLabel('Dari tanggal').fill('2026-12-31');
  await page.getByLabel('Sampai tanggal').fill('2026-01-01');
  const guardKas = page.getByRole('alert').filter({ hasText: 'tidak boleh setelah' });
  await guardKas.waitFor({ timeout: 10_000 });
  assert.match(
    (await guardKas.textContent()) ?? '',
    /menampilkan Arus Kas/,
    'Guard rentang terbalik Arus Kas tidak menyebut nama laporan',
  );
  await presetTahun.click();
  await guardKas.waitFor({ state: 'detached', timeout: 10_000 });

  t.diagnostic('UI-A10 OK: rentang terbalik Laba Rugi & Arus Kas → guard seragam, fetch diblok');
}

/**
 * UI-A03 (kasus 5): Buku Besar dibuka dari drill-down Neraca membawa periode
 * sumber — cut-off Neraca muncul di header kartu ("periode awal s/d …") dan
 * di kaki tabel ("Saldo akhir (per …)").
 */
async function cekDrilldownNeracaBukuBesar(page, t) {
  await pindahTab(page, 'Neraca');
  await page.waitForFunction(
    () =>
      /^Neraca per \d{1,2} /.test(
        document.querySelector('h1')?.textContent?.trim() ?? '',
      ),
    null,
    { timeout: 20_000 },
  );
  const cocok = /Neraca per (\d{1,2} \w+ \d{4})/.exec(
    (await page.locator('h1').textContent()) ?? '',
  );
  assert.ok(cocok, 'Cut-off Neraca tidak terbaca dari header');
  const tanggalSumber = cocok[1];

  const barisKas = page.getByRole('button', { name: /^Buka Buku Besar akun 1001/ });
  await barisKas.waitFor({ timeout: 20_000 });
  await barisKas.click();
  await tungguHeader(page, 'Buku Besar');
  await page.waitForTimeout(300);

  await page.getByText(`periode awal s/d ${tanggalSumber}`).waitFor({ timeout: 20_000 });
  await page.getByText(`Saldo akhir (per ${tanggalSumber})`).waitFor({ timeout: 10_000 });

  t.diagnostic(
    `UI-A03 OK: Buku Besar dari drill-down Neraca memuat periode sumber "per ${tanggalSumber}"`,
  );
}

/**
 * UI-A05 (kasus 7, jalur bahagia): setelah pengaturan pembukuan berhasil
 * dimuat, Simpan aktif dan tidak ada tombol "Coba muat ulang". Jalur gagal
 * muat (Simpan disabled saat errPembukuan) tidak mungkin dipicu lewat e2e —
 * IPC `pengaturanGet` asli selalu tersedia dan errPembukuan adalah state
 * internal — sehingga dikunci lewat uji sumber di
 * tests/ui-a05-pembukuan-gagal-muat.test.ts.
 */
async function cekPengaturanPembukuanSiap(page, t) {
  await pindahTab(page, 'Pengaturan');
  const simpan = page.getByRole('button', { name: 'Simpan Pengaturan Pembukuan' });
  await simpan.waitFor({ timeout: 20_000 });
  assert.equal(
    await page.getByRole('button', { name: 'Coba muat ulang' }).count(),
    0,
    'Tombol "Coba muat ulang" tampil padahal pengaturan berhasil dimuat',
  );
  assert.ok(
    await simpan.isEnabled(),
    'Simpan Pengaturan Pembukuan mati padahal pengaturan berhasil dimuat',
  );
  assert.ok(
    await page.getByLabel('Nama entitas (kop laporan)').isEnabled(),
    'Isian Nama entitas mati padahal pengaturan berhasil dimuat',
  );

  t.diagnostic('UI-A05 OK (jalur bahagia): muat sukses → Simpan & isian aktif, tanpa muat ulang');
}

/**
 * UI-A01 (kasus 1): grid nota Panjar tidak dirender sebelum target dipilih;
 * mengisi nota lalu mengganti target memunculkan konfirmasi "Ganti panjar?".
 * Seed dev tidak menyisakan panjar terbuka, jadi satu panjar dibuat lewat
 * form Serahkan Panjar lebih dulu.
 */
async function cekPanjarGantiTarget(page, folder, t) {
  await pindahTab(page, 'Buku Panjar');

  const selectPJ = page.getByLabel('Panjar yang dipertanggungjawabkan');
  const nomorNota = page.getByLabel('Nomor nota');

  // Tanpa target: grid nota (dan kotak sisa/kurang) tidak dirender.
  await selectPJ.waitFor({ timeout: 20_000 });
  assert.equal(
    await nomorNota.count(),
    0,
    'Grid nota dirender sebelum panjar target dipilih (UI-A01 kembali)',
  );

  // Buat satu panjar terbuka lewat UI agar tersedia target.
  await page.getByLabel('Penerima / panitia').fill('Panitia UI-A27');
  await page.getByLabel('Jumlah panjar (Rp)').fill('100000');
  await page.getByRole('button', { name: 'Serahkan Panjar' }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'Panjar untuk Panitia UI-A27 tersimpan' })
    .waitFor({ timeout: 20_000 });

  // Pilih target → grid nota muncul.
  const nilaiPanjar = await selectPJ
    .locator('option')
    .filter({ hasText: 'Panitia UI-A27' })
    .first()
    .getAttribute('value');
  assert.ok(nilaiPanjar, 'Panjar baru tidak muncul di pilihan pertanggungjawaban');
  await selectPJ.selectOption(nilaiPanjar);
  await nomorNota.waitFor({ timeout: 10_000 });

  // Isi nota → form PJ menjadi kotor.
  await nomorNota.fill('001/UIA27/2026');

  // Ganti target saat kotor → konfirmasi muncul, tidak menimpa diam-diam.
  const dialog = page.getByRole('dialog', { name: 'Ganti panjar?' });
  await selectPJ.selectOption('');
  await dialog.waitFor({ timeout: 10_000 });
  assert.match(
    await dialog.innerText(),
    /Rincian yang sudah diisi akan dikosongkan/,
    'Konfirmasi ganti panjar tidak menjelaskan dampak',
  );
  await page.screenshot({ path: join(folder, 'flow-panjar-ganti-target.png') });

  // Batal → isian nota tetap ada.
  await dialog.getByRole('button', { name: 'Batal' }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.equal(
    await nomorNota.inputValue(),
    '001/UIA27/2026',
    'Isian nota hilang setelah Batal pada konfirmasi ganti panjar',
  );

  // Konfirmasi → form PJ kembali kosong dan grid nota hilang bersama target.
  await selectPJ.selectOption('');
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Ya, ganti panjar' }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.waitForTimeout(200);
  assert.equal(
    await nomorNota.count(),
    0,
    'Grid nota masih tampil setelah target dikosongkan',
  );

  t.diagnostic('UI-A01 OK: grid nota tersembunyi tanpa target; ganti target kotor → konfirmasi');
}

/**
 * Kunci tahun lalu lewat alur Kunci Periode (3 langkah, tanpa dialog native)
 * supaya transaksi bertanggal 31 Des tahun lalu memunculkan LockModal.
 * Mengembalikan tahun yang dikunci.
 */
async function kunciTahunLalu(page, t) {
  await pindahTab(page, 'Kunci Periode');
  const fieldTahun = page.getByLabel('Tahun');
  const tahun = Number(await fieldTahun.inputValue());
  assert.ok(
    Number.isInteger(tahun) && tahun > 1900,
    pesan('Tahun default Kunci Periode tidak terbaca', String(tahun)),
  );

  await page.getByRole('button', { name: 'Pratinjau laba' }).click();
  const tombolBackup = page.getByRole('button', { name: 'Backup otomatis & lanjut' });
  await tombolBackup.waitFor({ timeout: 30_000 });
  await tombolBackup.click();
  const tombolKonfirmasi = page.getByRole('button', { name: 'Konfirmasi kunci periode' });
  await tombolKonfirmasi.waitFor({ timeout: 30_000 });
  await tombolKonfirmasi.click();

  const dialog = page.getByRole('dialog', { name: `Kunci periode tahun ${tahun}?` });
  await dialog.waitFor({ timeout: 10_000 });
  await dialog.getByRole('button', { name: 'Ya, kunci periode' }).click();
  await page
    .getByRole('status')
    .filter({ hasText: 'dikunci' })
    .waitFor({ timeout: 30_000 });

  t.diagnostic(`Kunci periode uji OK: tahun ${tahun} dikunci lewat UI`);
  return tahun;
}

/**
 * UI-A13 (kasus 8) + UI-A09 (kasus 6): form Transaksi kosong menampilkan
 * alasan tombol Simpan nonaktif; tanggal di tahun terkunci memunculkan
 * LockModal dengan helper 5 karakter, dan alasan yang cukup benar-benar
 * mengirim submit (alasan kini hidup di state React, bukan closure).
 */
async function cekTransaksiAlasanDanLockModal(page, tahunTerkunci, folder, t) {
  await pindahTab(page, 'Transaksi');

  // UI-A13: form kosong → tombol Simpan mati dengan alasan terlihat.
  const simpan = page.getByRole('button', { name: 'Simpan Transaksi' });
  await simpan.waitFor({ timeout: 20_000 });
  assert.ok(await simpan.isDisabled(), 'Simpan Transaksi aktif padahal form kosong');
  const alasanKosong = page.getByRole('status').filter({ hasText: 'Isi dulu:' });
  // Teks bisa sempat "Memuat daftar akun…" sebelum COA selesai dimuat.
  await alasanKosong.waitFor({ timeout: 15_000 });
  // Tanggal dan akun sudah terisi default, jadi alasan hanya menyebut isian
  // yang benar-benar kosong (UI-A13). Regex tetap menerima keduanya agar
  // tidak rapuh bila default berubah.
  assert.match(
    (await alasanKosong.textContent()) ?? '',
    /Isi dulu: (tanggal, )?(akun, )?nominal dan keterangan\./,
    'Teks alasan tombol Simpan tidak sesuai',
  );

  // UI-A09: simpan ke tahun terkunci → backend minta alasan → LockModal.
  const fieldTanggal = page.getByLabel('Tanggal');
  const tanggalAwal = await fieldTanggal.inputValue();
  await fieldTanggal.fill(`${tahunTerkunci}-12-31`);
  await page.getByLabel('Nominal').fill('50.000');
  await page.getByLabel('Keterangan').fill('Uji UI-A27 LockModal periode terkunci');
  await simpan.click();

  const lock = page.getByRole('dialog', { name: 'Periode sudah terkunci' });
  await lock.waitFor({ timeout: 20_000 });
  const helper = lock.getByText('Minimal 5 karakter.');
  const tetapSimpan = lock.getByRole('button', { name: 'Tetap simpan' });

  // Alasan 3 karakter: tombol mati + helper terlihat (kasus minimum tiket).
  await lock.getByLabel(/^Alasan/).fill('abc');
  assert.ok(await helper.isVisible(), 'Helper "Minimal 5 karakter." tidak tampil');
  assert.ok(
    await tetapSimpan.isDisabled(),
    'Tombol Tetap simpan aktif dengan alasan 3 karakter',
  );

  // Alasan 5 karakter: tombol aktif dan submit terkirim (bukan jalan buntu).
  await lock.getByLabel(/^Alasan/).fill('abcde');
  assert.ok(await tetapSimpan.isEnabled(), 'Tombol Tetap simpan mati dengan alasan 5 karakter');
  await page.screenshot({ path: join(folder, 'flow-lock-modal.png') });
  await tetapSimpan.click();
  await lock.waitFor({ state: 'detached', timeout: 20_000 });
  await page
    .getByRole('status')
    .filter({ hasText: 'tersimpan' })
    .waitFor({ timeout: 20_000 });

  // Pulihkan tanggal agar form tidak menyisakan tanggal periode terkunci.
  await fieldTanggal.fill(tanggalAwal);

  t.diagnostic(
    'UI-A09/UI-A13 OK: alasan Simpan terlihat; LockModal 3 karakter mati+helper, 5 karakter terkirim',
  );
}


/** Jalankan seluruh audit untuk satu ukuran jendela dengan profil baru. */
async function jalankanAudit(ukuran, t) {
  assert.ok(
    existsSync(join(root, 'out', 'main', 'index.js')),
    'Hasil build tidak ada. Jalankan `npm run build` lebih dulu.',
  );

  const workDir = await mkdtemp(join(tmpdir(), 'pura-ui-audit-'));
  const profileDir = join(workDir, 'profile');
  const dbPath = join(workDir, 'pura.db');
  const folder = join(artifacts, ukuran.nama);
  await mkdir(folder, { recursive: true });

  /** @type {import('playwright-core').ElectronApplication | undefined} */
  let app;
  const consoleErrors = [];
  const attached = new WeakSet();
  const ringkasan = {
    ukuran: ukuran.nama,
    viewport: null,
    tab: [],
    flow: {},
    errorConsole: consoleErrors,
  };
  let gagal = false;

  const { ELECTRON_RENDERER_URL: _abaikanDevUrl, ...envDasar } = process.env;

  try {
    app = await electron.launch({
      args: ['.', `--user-data-dir=${profileDir}`],
      cwd: root,
      env: {
        ...envDasar,
        PURA_DB: dbPath,
        PURA_SEED_DEV: 'true',
      },
      timeout: 30_000,
    });

    const pipe = (stream, label) => {
      stream?.on('data', (chunk) => {
        for (const line of String(chunk).split('\n')) {
          if (line.trim()) console.log(`[${label}] ${line}`);
        }
      });
    };
    pipe(app.process().stdout, `${ukuran.nama}:main`);
    pipe(app.process().stderr, `${ukuran.nama}:main:err`);

    const watch = (page) => {
      if (attached.has(page)) return;
      attached.add(page);
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(`console.error: ${msg.text()}`);
        }
      });
      page.on('pageerror', (err) => {
        consoleErrors.push(`pageerror: ${err.message}`);
      });
    };
    app.on('window', watch);

    const page = await app.firstWindow();
    watch(page);
    await page.waitForLoadState('domcontentloaded').catch(() => {});

    ringkasan.viewport = await aturUkuran(app, page, ukuran, t);

    // Sidebar diperiksa setelah Mode lanjutan diaktifkan; default-nya Jurnal
    // Umum disembunyikan (DB-26).
    await aktifkanModeLanjutan(page, t);
    await cekSidebar(page, ukuran);
    t.diagnostic(`${ukuran.nama} sidebar: Pengaturan terlihat, grup Laporan dapat diakses`);

    await cekKonfirmasiAksiBerisiko(page, t);
    ringkasan.flow.konfirmasiBerisiko = 'lulus';

    await cekScrollAntarTab(page, t);
    ringkasan.flow.scrollAntarTab = 'lulus';

    // 13 tab: verifikasi metrik, screenshot, sticky, dan reset scroll.
    for (let i = 0; i < TAB.length; i++) {
      const tab = TAB[i];
      await pindahTab(page, tab.label);
      const scrollAwal = await page.evaluate(
        () => document.querySelector('main').scrollTop,
      );
      if (i > 0) {
        assert.equal(
          scrollAwal,
          0,
          pesan(`${tab.label}: scroll tidak reset saat pindah tab`, `${scrollAwal}px`),
        );
      }
      await page.waitForTimeout(350);
      ringkasan.tab.push(await auditTab(page, ukuran, tab, i, t));
    }
    ringkasan.flow.tab = `${TAB.length} tab lulus`;
    t.diagnostic(`${ukuran.nama}: ${TAB.length} tab lulus (h1, header, overflow, sticky, reset scroll)`);

    await cekSkipLink(page, t);
    ringkasan.flow.skipLink = 'lulus';
    t.diagnostic(`${ukuran.nama} skip link OK: Tab pertama "Lewati ke konten", Enter → #main-content`);

    await cekGuard(page, folder, t);
    ringkasan.flow.guardIsian = 'lulus';

    const { keterangan, baris } = await cekSimpanTransaksi(page, folder, t);
    ringkasan.flow.simpanTransaksi = `lulus (${keterangan})`;

    await cekModalJurnal(page, baris, folder, t);
    ringkasan.flow.modalJurnal = 'lulus';

    await cekFilterJurnal(page, folder, t);
    ringkasan.flow.filterJurnal = 'lulus';

    await cekLipatSidebar(page, ukuran, t);
    ringkasan.flow.sidebarLipat = 'lulus';

    // UI-A27: regresi perbaikan tiket audit UI. Dijalankan di ujung karena
    // kunciTahunLalu mengunci tahun lalu di database uji — tidak boleh
    // mengganggu alur simpan transaksi/filter di atas.
    await cekDuplikatSaldoAwal(page, t);
    ringkasan.flow.duplikatSaldoAwal = 'lulus';

    await cekKoreksiModalKonfirmasi(page, t);
    ringkasan.flow.koreksiModalKonfirmasi = 'lulus';

    await cekGuardRentangLaporan(page, t);
    ringkasan.flow.guardRentangLaporan = 'lulus';

    await cekDrilldownNeracaBukuBesar(page, t);
    ringkasan.flow.drilldownBukuBesar = 'lulus';

    await cekPengaturanPembukuanSiap(page, t);
    ringkasan.flow.pengaturanPembukuan = 'lulus';

    await cekPanjarGantiTarget(page, folder, t);
    ringkasan.flow.panjarGantiTarget = 'lulus';

    const tahunTerkunci = await kunciTahunLalu(page, t);
    ringkasan.flow.kunciTahunLalu = `lulus (${tahunTerkunci})`;

    await cekTransaksiAlasanDanLockModal(page, tahunTerkunci, folder, t);
    ringkasan.flow.transaksiAlasanLockModal = 'lulus';

    assert.equal(
      consoleErrors.length,
      0,
      `Ada error console/pageerror:\n${consoleErrors.join('\n')}`,
    );
    ringkasan.flow.errorConsole = '0 error';

    assert.ok(existsSync(dbPath), `Database uji tidak ditemukan: ${dbPath}`);
    t.diagnostic(`Database uji: ${dbPath}`);
    t.diagnostic(`Screenshot: ${folder}`);
  } catch (err) {
    gagal = true;
    ringkasan.gagal = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    ringkasan.errorConsole = [...consoleErrors];
    await writeFile(
      join(folder, 'ringkasan.json'),
      `${JSON.stringify(ringkasan, null, 2)}\n`,
    ).catch(() => {});
    await app?.close().catch(() => {});
    if (gagal || process.env.SMOKE_KEEP === '1') {
      t.diagnostic(`Folder uji disimpan: ${workDir}`);
    } else {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

for (const ukuran of UKURAN) {
  test(
    `audit UI ${ukuran.nama}`,
    { timeout: 600_000 },
    async (t) => {
      await jalankanAudit(ukuran, t);
    },
  );
}
