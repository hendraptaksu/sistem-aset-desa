// Smoke test Electron memakai Playwright (bukan browser Chromium).
//
// Menjalankan hasil `npm run build` dengan profil & database terisolasi di
// folder sementara, membuat PIN awal, lalu memastikan dashboard tampil dan
// neraca saldo seimbang. Screenshot disimpan di `e2e/artifacts/<waktu>/`.
//
// Jalankan: npm run smoke
// Simpan folder data uji saat gagal: SMOKE_KEEP=1 npm run test:e2e

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright-core';

const root = process.cwd();
const artifacts = join(
  root,
  'e2e',
  'artifacts',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

test(
  'build aplikasi bisa dibuka, setup PIN, dan dashboard seimbang',
  { timeout: 120_000 },
  async (t) => {
    assert.ok(
      existsSync(join(root, 'out', 'main', 'index.js')),
      'Hasil build tidak ada. Jalankan `npm run build` lebih dulu.',
    );

    const workDir = await mkdtemp(join(tmpdir(), 'pura-smoke-'));
    const profileDir = join(workDir, 'profile');
    const dbPath = join(workDir, 'pura.db');
    await mkdir(artifacts, { recursive: true });

    /** @type {import('playwright-core').ElectronApplication | undefined} */
    let app;
    const consoleErrors = [];
    const attached = new WeakSet();
    let gagal = false;

    try {
      app = await electron.launch({
        args: ['.', `--user-data-dir=${profileDir}`],
        cwd: root,
        env: {
          ...process.env,
          // Isolasi total: jangan pernah memakai data asli pengguna.
          PURA_DB: dbPath,
          // Data dummy deterministik agar dashboard/laporan bisa diperiksa.
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
      pipe(app.process().stdout, 'main');
      pipe(app.process().stderr, 'main:err');

      const watch = (page) => {
        if (attached.has(page)) return;
        attached.add(page);
        page.on('console', (msg) => {
          if (msg.type() === 'error') consoleErrors.push(`console.error: ${msg.text()}`);
        });
        page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`));
      };
      app.on('window', watch);

      const page = await app.firstWindow();
      watch(page);

      await page
        .getByRole('heading', { name: 'Keuangan Pura Dalem Puri' })
        .waitFor({ timeout: 15_000 });
      await page.screenshot({
        path: join(artifacts, '01-layar-pin.png'),
        fullPage: true,
      });

      // Database baru selalu meminta pembuatan PIN 6 digit.
      await page.getByLabel('PIN baru 6 digit').fill('123456');
      await page.getByLabel('Ulangi PIN').fill('123456');
      await page.getByRole('button', { name: 'Simpan PIN' }).click();

      // AUD-19: kode darurat per-install tampil sekali dan wajib dicatat.
      await page
        .getByRole('heading', { name: 'Simpan kode darurat ini' })
        .waitFor({ timeout: 15_000 });
      const kodeDarurat = (await page.getByTestId('kode-darurat').textContent())?.trim() ?? '';
      assert.match(
        kodeDarurat,
        /^(?:[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}-){3}[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/,
      );
      await page.screenshot({
        path: join(artifacts, '02-kode-darurat.png'),
        fullPage: true,
      });
      await page.getByRole('button', { name: 'Saya sudah mencatat' }).click();

      await page.getByText('Dashboard Akuntan').waitFor({ timeout: 15_000 });
      await page.getByText('Seimbang').first().waitFor({ timeout: 15_000 });
      await page.screenshot({
        path: join(artifacts, '03-dashboard.png'),
        fullPage: true,
      });

      // Daftar Akun: tambah akun BEBAN baru dan pastikan muncul di daftar.
      await page.getByRole('button', { name: 'Daftar Akun' }).click();
      await page
        .getByRole('heading', { name: 'Daftar Akun (COA)' })
        .waitFor({ timeout: 15_000 });
      await page.getByLabel('Kode akun (4 digit)').fill('5011');
      await page.getByLabel('Nama akun').fill('PENGELUARAN ARTOS');
      await page.getByRole('button', { name: 'Tambah Akun', exact: true }).click();
      await page
        .getByText('Akun 5011 — PENGELUARAN ARTOS tersimpan.')
        .waitFor({ timeout: 15_000 });
      await page.screenshot({
        path: join(artifacts, '04-daftar-akun.png'),
        fullPage: true,
      });

      // Ubah nama → nonaktifkan → aktifkan → hapus akun tambahan.
      await page.getByRole('button', { name: 'Ubah' }).click();
      await page.getByLabel('Nama akun').fill('PENGELUARAN ARTOS BARU');
      await page.getByRole('button', { name: 'Simpan Perubahan' }).click();
      await page
        .getByText('Nama akun 5011 diubah menjadi PENGELUARAN ARTOS BARU.')
        .waitFor({ timeout: 15_000 });

      await page.getByRole('button', { name: 'Nonaktifkan' }).click();
      await page.getByRole('button', { name: 'Ya, nonaktifkan' }).click();
      await page
        .getByText(/dinonaktifkan\. Histori dan laporan lama tetap utuh/i)
        .waitFor({ timeout: 15_000 });

      await page.getByRole('button', { name: 'Aktifkan' }).click();
      await page.getByRole('button', { name: 'Ya, aktifkan' }).click();
      await page
        .getByText(/diaktifkan kembali/i)
        .waitFor({ timeout: 15_000 });

      await page.getByRole('button', { name: 'Hapus' }).click();
      await page.getByRole('button', { name: 'Ya, hapus permanen' }).click();
      await page
        .getByText(/dihapus permanen/i)
        .waitFor({ timeout: 15_000 });
      await page.screenshot({
        path: join(artifacts, '05-kelola-akun.png'),
        fullPage: true,
      });

      // Smoke reset: kunci → Lupa PIN → kode darurat per-install → PIN baru.
      await page.getByRole('button', { name: 'Kunci aplikasi' }).click();
      await page.getByRole('button', { name: 'Lupa PIN?' }).click();
      await page.getByLabel('Kode darurat').fill(kodeDarurat);
      await page.getByLabel('PIN baru 6 digit').fill('654321');
      await page.getByLabel('Ulangi PIN baru').fill('654321');
      await page.getByRole('button', { name: 'Reset PIN' }).click();
      await page.getByRole('button', { name: 'Dashboard' }).click();
      await page.getByText('Dashboard Akuntan').waitFor({ timeout: 15_000 });
      await page.screenshot({
        path: join(artifacts, '06-setelah-reset.png'),
        fullPage: true,
      });

      assert.match(await page.title(), /Keuangan Pura Dalem Puri/);
      assert.equal(
        consoleErrors.length,
        0,
        `Ada error di renderer:\n${consoleErrors.join('\n')}`,
      );

      // Bukti database benar-benar terisolasi dan terisi data dummy.
      assert.ok(existsSync(dbPath), `Database uji tidak ditemukan: ${dbPath}`);
      t.diagnostic(`Screenshot: ${artifacts}`);
      t.diagnostic(`Database uji: ${dbPath}`);
    } catch (err) {
      gagal = true;
      throw err;
    } finally {
      await app?.close().catch(() => {});
      // Saat gagal, data uji jangan dihapus agar bisa diperiksa (DB, backup,
      // lampiran). Folder sementara tetap aman karena berada di tmpdir.
      if (gagal || process.env.SMOKE_KEEP === '1') {
        t.diagnostic(`Folder uji disimpan: ${workDir}`);
      } else {
        await rm(workDir, { recursive: true, force: true });
      }
    }
  },
);
