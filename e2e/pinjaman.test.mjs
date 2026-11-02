import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { _electron as electron } from 'playwright-core';

const RP = (n) => n * 100;

test('bendahara melanjutkan pembayaran sebagian, membatalkan catatan, dan arus kas tetap cocok',
  { timeout: 120_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pura-loan-e2e-'));
    let app;
    try {
      const { ELECTRON_RENDERER_URL: _ignore, ...baseEnv } = process.env;
      app = await electron.launch({
        args: ['.', `--user-data-dir=${join(dir, 'profile')}`],
        cwd: process.cwd(),
        env: { ...baseEnv, PURA_DB: join(dir, 'pura.db'), PURA_SEED_DEV: 'false' },
      });
      const page = await app.firstWindow();
      await page.getByLabel('PIN baru 6 digit').fill('123456');
      await page.getByLabel('Ulangi PIN').fill('123456');
      await page.getByRole('button', { name: 'Simpan PIN', exact: true }).click();
      await page.getByRole('button', { name: 'Saya sudah mencatat', exact: true }).click();
      // Data awal fixture melalui IPC yang sama dengan form; aksi pembayaran
      // dan pembatalan berikutnya benar-benar memakai kontrol UI bendahara.
      const loanId = await page.evaluate(async () => {
        const awal = await window.api.invoke('saldo-awal:posting', {
          tanggal: '2025-01-01', saldo: [{ akun_kode: '1001', nominal: 2_000_000_000 }],
        });
        if (!awal.ok) throw new Error(awal.error);
        const loan = await window.api.invoke('pinjaman:simpan', {
          mode: 'PENCAIRAN', kreditur: 'LPD Regresi UI', tanggal: '2025-02-01',
          akunKas: '1001', pokok: 1_000_000_000, tenor: 1,
          angsuran: [{ ke: 1, jatuh_tempo: '2025-03-01', pokok: 1_000_000_000, bunga: 10_000_000 }],
        });
        if (!loan.ok) throw new Error(loan.error);
        return loan.data.pinjaman.id;
      });
      await page.getByRole('navigation', { name: 'Menu utama' })
        .getByRole('button', { name: 'Pinjaman LPD', exact: true }).click();
      await page.getByRole('button', { name: 'Lihat jadwal', exact: true }).click();
      await page.getByRole('button', { name: 'Bayar Angsuran', exact: true }).click();
      await page.getByLabel('Tanggal bayar', { exact: true }).fill('2025-03-01');
      await page.getByLabel('Pokok dibayar (Rp)', { exact: true }).fill('0');
      await page.getByRole('button', { name: 'Bayar Angsuran', exact: true }).last().click();
      await page.getByRole('button', { name: 'Lanjut Bayar', exact: true }).waitFor();

      const loan = () => page.evaluate(async (id) => {
        const r = await window.api.invoke('pinjaman:detail', id);
        if (!r.ok) throw new Error(r.error);
        return r.data;
      }, loanId);
      assert.equal((await loan()).angsuran[0].status, 'SEBAGIAN');
      await page.getByRole('button', { name: 'Lanjut Bayar', exact: true }).click();
      assert.equal(Number((await page.getByLabel('Bunga dibayar (Rp)', { exact: true }).inputValue()).replace(/\D/g, '')), 0);
      assert.equal((await page.getByLabel('Pokok dibayar (Rp)', { exact: true }).inputValue()).replace(/\D/g, ''), '10000000');
      await page.getByLabel('Tanggal bayar', { exact: true }).fill('2025-03-02');
      await page.getByLabel('Pokok dibayar (Rp)', { exact: true }).fill('4.000.000');
      // Dua event pada frame yang sama tetap menghasilkan satu kuitansi.
      await page.getByRole('button', { name: 'Bayar Angsuran', exact: true }).evaluate((el) => {
        el.click();
        el.click();
      });
      await page.getByLabel('Tanggal bayar', { exact: true }).waitFor({ state: 'detached' });
      assert.equal((await loan()).outstanding, RP(6_000_000));
      await page.getByRole('button', { name: 'Lanjut Bayar', exact: true }).click();
      assert.equal((await page.getByLabel('Pokok dibayar (Rp)', { exact: true }).inputValue()).replace(/\D/g, ''), '6000000');
      await page.getByLabel('Tanggal bayar', { exact: true }).fill('2025-03-03');
      await page.getByRole('button', { name: 'Bayar Angsuran', exact: true }).click();
      await page.getByText('Sudah lunas', { exact: true }).waitFor();
      assert.equal((await loan()).outstanding, 0);

      const arus = await page.evaluate(async () => {
        const r = await window.api.invoke('laporan:arus-kas', { mulai: '2025-03-01', sampai: '2025-03-31' });
        if (!r.ok) throw new Error(r.error);
        return r.data;
      });
      assert.equal(arus.pendanaan.keluar, RP(10_000_000));
      assert.equal(arus.operasi.keluar, RP(100_000));

      // Batalkan dua kuitansi pokok, lalu kuitansi bunga. Histori tetap ada.
      async function batalkanPembayaran() {
        await page.getByRole('button', { name: 'Batalkan catatan pembayaran', exact: true }).last().click();
        const modal = page.getByRole('dialog', { name: 'Batalkan catatan pembayaran', exact: true });
        await modal.getByLabel('Alasan pembetulan (wajib ≥ 5 karakter)').fill('Kesalahan catatan untuk uji regresi');
        await modal.getByRole('button', { name: 'Batalkan catatan', exact: true }).click();
        await modal.waitFor({ state: 'detached' });
      }
      await batalkanPembayaran();
      await page.getByRole('button', { name: 'Lanjut Bayar', exact: true }).waitFor();
      assert.equal((await loan()).outstanding, RP(6_000_000));
      await batalkanPembayaran();
      await page.getByRole('button', { name: 'Lanjut Bayar', exact: true }).waitFor();
      assert.equal((await loan()).outstanding, RP(10_000_000));
      await batalkanPembayaran();
      await page.getByRole('button', { name: 'Batalkan catatan pencairan', exact: true }).waitFor();
      const pembayaran = await page.evaluate(async (id) => (await window.api.invoke('pinjaman:pembayaran', id)).data, loanId);
      assert.equal(pembayaran.length, 3);
      assert.ok(pembayaran.every((p) => p.dibatalkan));
      await page.getByRole('button', { name: 'Batalkan catatan pencairan', exact: true }).click();
      const modal = page.getByRole('dialog', { name: 'Batalkan catatan pencairan', exact: true });
      await modal.getByLabel('Alasan pembetulan (wajib ≥ 5 karakter)').fill('Pencairan salah dicatat pada uji');
      await modal.getByRole('button', { name: 'Batalkan catatan', exact: true }).click();
      await modal.waitFor({ state: 'detached' });
      assert.equal((await loan()).status, 'DIBATALKAN');
      assert.equal((await loan()).outstanding, 0);
    } finally {
      await app?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
