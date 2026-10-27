// Regresi: hasil export Pembantu wajib menyertakan kop organisasi.
// Builder laporan lain diuji di tests/export-laporan.test.ts (mesin v2).
import { describe, expect, it } from 'vitest';
import type { PembantuHasil } from '../src/features/reports/types.js';
import {
  KOP_ORG_NAMA,
  kopPeriodeEfektif,
  pembantuToHtml,
  pembantuToWorkbook,
} from '../src/features/export/workbooks.js';

const PEMBANTU: PembantuHasil = {
  kode: '1001',
  nama: 'KAS',
  rows: [
    {
      id: 'j1:1',
      tanggal: '2025-01-05',
      keterangan: 'Modal awal',
      masuk: 10_000,
      keluar: 0,
    },
  ],
  totalMasuk: 10_000,
  totalKeluar: 0,
  saldoAwal: 0,
  saldo: 10_000,
  mulai: '2025-01-01',
  sampai: '2025-12-31',
};

describe('kop organisasi di export Pembantu', () => {
  it('KOP_ORG_NAMA = PURA DALEM PURI PELIATAN', () => {
    expect(KOP_ORG_NAMA).toBe('PURA DALEM PURI PELIATAN');
  });

  it('HTML + xlsx pembantu memuat kop dan periode', async () => {
    const html = pembantuToHtml(PEMBANTU);
    expect(html).toContain(KOP_ORG_NAMA);
    expect(html).toContain('BUKU PEMBANTU');
    expect(html).toContain('PERIODE');

    const wb = await pembantuToWorkbook(PEMBANTU);
    expect(wb.worksheets[0]!.getRow(1).getCell(1).value).toBe(KOP_ORG_NAMA);
  });

  it('periode kop fallback ke rentang data, lalu "SEMUA PERIODE"', () => {
    const tanpaFilter: PembantuHasil = { ...PEMBANTU, mulai: undefined, sampai: undefined };
    expect(kopPeriodeEfektif(tanpaFilter.mulai, tanpaFilter.sampai, tanpaFilter.rows)).toContain(
      'PERIODE',
    );
    expect(pembantuToHtml(tanpaFilter)).toContain('PERIODE');
    expect(kopPeriodeEfektif(undefined, undefined, [])).toBe('SEMUA PERIODE');
    expect(pembantuToHtml({ ...PEMBANTU, rows: [], mulai: undefined, sampai: undefined })).toContain(
      'SEMUA PERIODE',
    );
  });
});
