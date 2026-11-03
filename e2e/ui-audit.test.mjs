// UI-23 — Audit regresi UI otomatis memakai Electron asli (Playwright).
//
// Menjalankan hasil `npm run build` dengan profil & database sementara per
// ukuran jendela, lalu memeriksa 13 tab: error console, overflow horizontal,
// h1/header, sticky header, reset scroll antar tab, skip link, modal, guard
// isian, simpan transaksi, filter Jurnal Umum, dan akses sidebar. Jurnal Umum
// hanya muncul setelah Mode lanjutan diaktifkan, sesuai DB-26/DB-29.
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
    await page.getByLabel('Ulangi PIN').fill('123456');
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
    // 13 item tab (tanpa Pengaturan) + 3 header grup, dengan Jurnal Umum
    // terlihat karena Mode lanjutan sudah aktif.
    assert.equal(
      await nav.getByRole('button').count(),
      16,
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
    /tersimpan.*Jurnal otomatis sudah dibuat/s,
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
  for (const namaTombol of ['Export Excel', 'Simpan PDF', 'Pratinjau Cetak']) {
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
    await page.getByRole('button', { name: 'Export Excel' }).isEnabled(),
    'Export Excel tidak aktif kembali setelah rentang diperbaiki',
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
