// Test Agent B — Modul 2 (Pembantu), Modul 4 (Realisasi), Modul 6 (Surplus),
// Dashboard-read, Export xlsx + Backup .db. Memakai mock 20 baris + DB asli.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KAS_KODES } from '../src/db/coa.js';
import { openDb } from '../src/db/database.js';
import { insertTransaksi, listTransaksi } from '../src/db/repository.js';
import { neraca, surplus } from '../src/core/ledger.js';
import { formatRp } from '../src/utils/format.js';
import { MOCK_PANJAR, MOCK_TRANSAKSI, MOCK_TUTUP, getTransaksiMock } from '../src/features/reports/__mocks__/data.js';
import { buildPembantu } from '../src/features/reports/pembantu/pembantu.js';
import { buildRealisasi } from '../src/features/reports/realisasi/realisasi.js';
import { buildSurplus, cekSilangSurplusBerjalan } from '../src/features/reports/surplus/surplus.js';
import { buildDashboard } from '../src/features/dashboard/dashboard.js';
import {
  backupDb,
  pembantuToWorkbook,
  realisasiToWorkbook,
  restoreDb,
  surplusToWorkbook,
  workbookToBuffer,
  writeXlsx,
} from '../src/features/export/export.js';

describe('B1 pembantu: filter per kode + total', () => {
  it('kas 1001: masuk 21,25jt keluar 13,8jt saldo 7,45jt', () => {
    const p = buildPembantu(MOCK_TRANSAKSI, { kode: '1001' });
    expect(p.totalMasuk).toBe(21_250_000);
    expect(p.totalKeluar).toBe(13_800_000);
    expect(p.saldo).toBe(7_450_000);
  });
  it('kategori 5004: 6,5jt keluar (2jt + realisasi panjar 4,5jt)', () => {
    const p = buildPembantu(MOCK_TRANSAKSI, { kode: '5004' });
    expect(p.totalMasuk).toBe(0);
    expect(p.totalKeluar).toBe(6_500_000);
    expect(p.saldo).toBe(-6_500_000);
  });
  it('PANJAR tampil sebagai Mutasi Panjar, saldo 0, tidak bocor ke beban', () => {
    const p = buildPembantu(MOCK_TRANSAKSI, { kode: 'PANJAR' });
    expect(p.nama).toBe('Mutasi Panjar');
    expect(p.totalMasuk).toBe(5_000_000);
    expect(p.totalKeluar).toBe(5_000_000);
    expect(p.rows).toHaveLength(3);
  });
  it('filter tanggal benar (kas 1001 Jan saja = modal 10jt)', () => {
    const p = buildPembantu(MOCK_TRANSAKSI, { kode: '1001', mulai: '2025-01-01', sampai: '2025-01-31' });
    expect(p.rows).toHaveLength(1);
    expect(p.saldo).toBe(10_000_000);
  });
  it('getTransaksiMock setara filter repository', () => {
    expect(getTransaksiMock({ kategori: '5004' })).toHaveLength(2);
    expect(getTransaksiMock({ akun_kas: '1015' })).toHaveLength(2);
    expect(getTransaksiMock({ mulai: '2025-02-01', sampai: '2025-02-28' })).toHaveLength(2);
  });
});

describe('B2 realisasi: grouping + net (T6-parsial)', () => {
  it('total pendapatan 14jt, beban 11,8jt, net 2,2jt; 2050/PANJAR eksklusi', () => {
    const r = buildRealisasi(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
    expect(r.totalPendapatan).toBe(14_000_000);
    expect(r.totalBeban).toBe(11_800_000);
    expect(r.net).toBe(2_200_000);
    expect(r.pendapatan.find((b) => b.kode === '4005')?.nominal).toBe(5_000_000);
    expect(r.beban.find((b) => b.kode === '5004')?.nominal).toBe(6_500_000);
    expect(r.pendapatan).toHaveLength(12);
    expect(r.beban).toHaveLength(15);
  });
  it('filter Februari saja: pend 7jt, beban 0', () => {
    const r = buildRealisasi(MOCK_TRANSAKSI, '2025-02-01', '2025-02-28');
    expect(r.totalPendapatan).toBe(7_000_000);
    expect(r.totalBeban).toBe(0);
    expect(r.net).toBe(7_000_000);
  });
});

describe('B3 surplus: % + kurung defisit + cek silang 3002', () => {
  it('surplus 2,2jt, % baris benar', () => {
    const s = buildSurplus(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
    expect(s.surplus).toBe(2_200_000);
    expect(s.defisit).toBe(false);
    const p4005 = s.pendapatan.find((b) => b.kode === '4005')!;
    expect(p4005.persen).toBeCloseTo((5_000_000 / 14_000_000) * 100, 5);
    const b5004 = s.beban.find((b) => b.kode === '5004')!;
    expect(b5004.persen).toBeCloseTo((6_500_000 / 11_800_000) * 100, 5);
  });
  it('periode rugi jadi defisit + formatRp kurung (T8)', () => {
    const s = buildSurplus(MOCK_TRANSAKSI, '2025-04-10', '2025-04-18');
    // 10-18 Apr: beban 2jt+1jt+0,6jt+0,9jt=4,5jt vs pendapatan 0 → defisit
    expect(s.surplus).toBe(-4_500_000);
    expect(s.defisit).toBe(true);
    expect(formatRp(s.surplus)).toBe('(Rp 4.500.000)');
    expect(formatRp(-100_000)).toBe('(Rp 100.000)');
  });
  it('cek silang: Surplus Jan s/d cut-off == Berjalan 3002 di Neraca', () => {
    const cutoff = '2025-12-31';
    const s = surplus(MOCK_TRANSAKSI, '2025-01-01', cutoff);
    const n = neraca(MOCK_TRANSAKSI, MOCK_PANJAR, MOCK_TUTUP, cutoff, KAS_KODES);
    expect(cekSilangSurplusBerjalan(s, n.berjalan)).toBe(true);
    expect(n.berjalan).toBe(2_200_000);
    expect(n.balance).toBe(true);
  });
});

describe('B4 dashboard-read dari query ledger', () => {
  it('kas tunai 7,45jt, total LPD 7,5jt, badge BALANCE', () => {
    const d = buildDashboard(MOCK_TRANSAKSI, MOCK_PANJAR, MOCK_TUTUP, '2025-12-31', KAS_KODES);
    expect(d.kasTunai).toBe(7_450_000);
    expect(d.totalLpd).toBe(7_500_000);
    expect(d.balance).toBe(true);
    expect(d.badge).toBe('BALANCE');
    expect(d.aktiva).toBe(d.pasiva);
  });
});

describe('B5 export xlsx keluar buffer/file', () => {
  it('3 workbook jadi buffer + file .xlsx', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-export-'));
    try {
      const p = buildPembantu(MOCK_TRANSAKSI, { kode: '1001' });
      const r = buildRealisasi(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
      const s = buildSurplus(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
      for (const [wb, name] of [
        [await pembantuToWorkbook(p), 'pembantu-1001.xlsx'],
        [await realisasiToWorkbook(r), 'realisasi.xlsx'],
        [await surplusToWorkbook(s), 'surplus.xlsx'],
      ] as const) {
        const buf = await workbookToBuffer(wb);
        expect(buf.length).toBeGreaterThan(1000);
        const fp = await writeXlsx(wb, join(dir, name));
        expect(existsSync(fp)).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('B6 backup export/import .db (copy file)', () => {
  it('backup lalu restore isi sama', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-db-'));
    try {
      const dbPath = join(dir, 'pura.db');
      const bakPath = join(dir, 'pura-backup.db');
      const restoredPath = join(dir, 'pura-restored.db');
      const db = openDb(dbPath);
      for (const t of MOCK_TRANSAKSI) insertTransaksi(db, t);
      expect(listTransaksi(db)).toHaveLength(20);
      db.close();
      expect(backupDb(dbPath, bakPath)).toBe(bakPath);
      expect(existsSync(bakPath)).toBe(true);
      expect(restoreDb(bakPath, restoredPath)).toBe(restoredPath);
      const db2 = openDb(restoredPath);
      // openDb menjalankan DDL (idempoten); isi transaksi ikut ter-copy
      expect(listTransaksi(db2).length).toBe(20);
      db2.close();
      expect(readFileSync(bakPath).length).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
