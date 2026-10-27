// P1-11: helper nomor bukti JU (murni) + validasi filter pencarian jurnal.
// Tanpa Electron/jsdom — hanya fungsi murni.

import { describe, expect, it } from 'vitest';
import {
  formatNomorBukti,
  nomorBuktiBerikutnya,
  parseNomorBukti,
  tahunDariTanggal,
  validasiTahun,
} from '../src/core/nomorBukti.js';
import { validasiFilterJurnalCari } from '../src/main/validation.js';

describe('P1-11 — format nomor bukti JU', () => {
  it('memformat urutan menjadi 4 digit: 0001, 0002, 0010, 0100', () => {
    expect(formatNomorBukti(2026, 1)).toBe('JU-2026-0001');
    expect(formatNomorBukti(2026, 2)).toBe('JU-2026-0002');
    expect(formatNomorBukti(2026, 10)).toBe('JU-2026-0010');
    expect(formatNomorBukti(2026, 100)).toBe('JU-2026-0100');
  });

  it('9999 → 10000 (tidak dipotong) dan parser menerima 4+ digit', () => {
    expect(formatNomorBukti(2026, 9999)).toBe('JU-2026-9999');
    expect(formatNomorBukti(2026, 10000)).toBe('JU-2026-10000');
    expect(parseNomorBukti('JU-2026-9999')).toEqual({ tahun: 2026, urut: 9999 });
    expect(parseNomorBukti('JU-2026-10000')).toEqual({ tahun: 2026, urut: 10000 });
  });

  it('menolak tahun bukan 4 digit dan urutan tidak masuk akal', () => {
    for (const tahun of [26, 202, 20261, 0, -2026, 2026.5, Number.NaN]) {
      expect(() => formatNomorBukti(tahun, 1)).toThrow(/Tahun nomor bukti/);
      expect(() => validasiTahun(tahun)).toThrow(/Tahun nomor bukti/);
    }
    for (const urut of [0, -1, 1.5, Number.NaN]) {
      expect(() => formatNomorBukti(2026, urut)).toThrow(/Urutan nomor bukti/);
    }
  });

  it('parse mengembalikan null untuk nomor kosong/malformed/format lain', () => {
    for (const no of [
      '',
      '   ',
      'JU-2026-000',
      'JU-2026-ABC',
      'JU-26-0001',
      'BKM-2026-0001',
      '2026-0001',
      'JU/2026/0001',
      'JU-2026-0000',
    ]) {
      expect(parseNomorBukti(no), no).toBeNull();
    }
    // Huruf kecil tetap dibaca sebagai nomor baku yang sama.
    expect(parseNomorBukti('ju-2026-0007')).toEqual({ tahun: 2026, urut: 7 });
  });
});

describe('P1-11 — urutan nomor berikutnya', () => {
  it('mulai dari 1 saat belum ada nomor', () => {
    expect(nomorBuktiBerikutnya(2026, [])).toBe(1);
    expect(nomorBuktiBerikutnya(2026)).toBe(1);
  });

  it('memakai max+1 dan tidak mendaur ulang celah', () => {
    expect(nomorBuktiBerikutnya(2026, ['JU-2026-0001'])).toBe(2);
    expect(
      nomorBuktiBerikutnya(2026, [
        'JU-2026-0001',
        'JU-2026-0005',
        'JU-2026-0002',
      ]),
    ).toBe(6);
    expect(nomorBuktiBerikutnya(2026, ['JU-2026-9999'])).toBe(10000);
    expect(nomorBuktiBerikutnya(2026, ['JU-2026-10000'])).toBe(10001);
  });

  it('mengabaikan tahun lain dan nomor malformed', () => {
    expect(
      nomorBuktiBerikutnya(2026, [
        'JU-2025-0099',
        'JU-2024-0001',
        'BKM-2026-0050',
        'JU-26-0001',
        'JU-2026-ABC',
        '',
        '   ',
      ]),
    ).toBe(1);
    expect(
      nomorBuktiBerikutnya(2026, [
        'JU-2025-0099',
        'JU-2026-0003',
        'JU-2027-0008',
        'JU-2026-0001',
      ]),
    ).toBe(4);
  });

  it('menerima no_bukti null/undefined dari hasil query', () => {
    expect(nomorBuktiBerikutnya(2026, [null, undefined, 'JU-2026-0004'])).toBe(5);
  });
});

describe('P1-11 — tahun dari tanggal jurnal', () => {
  it('mengambil tahun dari tanggal kalender yang valid', () => {
    expect(tahunDariTanggal('2026-10-23')).toBe(2026);
    expect(tahunDariTanggal('2028-02-29')).toBe(2028);
  });

  it('menolak tanggal kalender tidak valid', () => {
    for (const tanggal of [
      '2026-02-31',
      '2026-13-01',
      '2026-2-3',
      '26-01-01',
      '',
    ]) {
      expect(() => tahunDariTanggal(tanggal), tanggal).toThrow(/Tanggal tidak valid/);
    }
  });
});

describe('P1-11 — validasi filter jurnal:cari', () => {
  it('menerima limit 1..200, offset >= 0, dan menormalkan kata kunci', () => {
    const hasil = validasiFilterJurnalCari({
      cari: '  parkir  ',
      mulai: '2026-01-01',
      sampai: '2026-12-31',
      jenis: 'TERIMA',
      limit: 200,
      offset: 0,
    });
    expect(hasil.ok).toBe(true);
    if (hasil.ok) {
      expect(hasil.input).toMatchObject({
        cari: 'parkir',
        mulai: '2026-01-01',
        sampai: '2026-12-31',
        jenis: 'TERIMA',
        limit: 200,
        offset: 0,
      });
    }

    const bawaan = validasiFilterJurnalCari(undefined);
    expect(bawaan.ok).toBe(true);
    if (bawaan.ok) expect(bawaan.input).toEqual({ limit: 50, offset: 0 });
  });

  it('menolak limit di luar 1..200 dan offset negatif/pecahan', () => {
    for (const limit of [0, -1, 201, 1.5, '20']) {
      const hasil = validasiFilterJurnalCari({ limit });
      expect(hasil.ok, `limit ${String(limit)}`).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(/Limit/);
    }
    for (const offset of [-1, 1.5, -0.5, '5']) {
      const hasil = validasiFilterJurnalCari({ offset });
      expect(hasil.ok, `offset ${String(offset)}`).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(/Offset/);
    }
  });

  it('menolak tanggal/jenis tidak valid dan rentang terbalik', () => {
    expect(validasiFilterJurnalCari({ mulai: '2026-02-31' }).ok).toBe(false);
    expect(validasiFilterJurnalCari({ sampai: '2026-13-01' }).ok).toBe(false);
    expect(
      validasiFilterJurnalCari({ mulai: '2026-02-01', sampai: '2026-01-01' }).ok,
    ).toBe(false);
    expect(validasiFilterJurnalCari({ jenis: 'KARANGAN' }).ok).toBe(false);
  });
});
