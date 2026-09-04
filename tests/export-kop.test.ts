// Regresi: SEMUA hasil export wajib menyertakan kop organisasi
// (contoh dokumen client: "PURA DALEM PURI PELIATAN / NERACA / PER ..." dan
// "BUKU BESAR / BULAN ..."). Berlaku untuk xlsx + HTML/print/PDF.
import { describe, expect, it } from 'vitest';
import { KAS_KODES } from '../src/db/coa.js';
import { neraca } from '../src/core/ledger.js';
import { MOCK_PANJAR, MOCK_TRANSAKSI, MOCK_TUTUP } from '../src/features/reports/__mocks__/data.js';
import { buildPembantu } from '../src/features/reports/pembantu/pembantu.js';
import { buildRealisasi } from '../src/features/reports/realisasi/realisasi.js';
import { buildSurplus } from '../src/features/reports/surplus/surplus.js';
import {
  KOP_ORG_NAMA,
  bkuToHtml,
  bkuToWorkbook,
  kopPeriodeEfektif,
  neracaToHtml,
  neracaToWorkbook,
  pembantuToHtml,
  pembantuToWorkbook,
  realisasiToHtml,
  realisasiToWorkbook,
  surplusToHtml,
  surplusToWorkbook,
} from '../src/features/export/workbooks.js';

describe('kop organisasi di semua export', () => {
  it('KOP_ORG_NAMA = PURA DALEM PURI PELIATAN', () => {
    expect(KOP_ORG_NAMA).toBe('PURA DALEM PURI PELIATAN');
  });

  it('HTML pembantu/realisasi/surplus/neraca/bku memuat kop', () => {
    const p = buildPembantu(MOCK_TRANSAKSI, { kode: '1001', mulai: '2025-01-01', sampai: '2025-12-31' });
    const r = buildRealisasi(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
    const s = buildSurplus(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
    const n = neraca(MOCK_TRANSAKSI, MOCK_PANJAR, MOCK_TUTUP, '2025-12-31', KAS_KODES);
    const bku = bkuToHtml(
      [{ tanggal: '2025-01-01', keterangan: 'x', kode: '1001', masuk: 10000, keluar: 0 }],
      { judul: 'BUKU BESAR', mulai: '2025-01-01', sampai: '2025-06-30' },
    );
    for (const html of [pembantuToHtml(p), realisasiToHtml(r), surplusToHtml(s), neracaToHtml(n), bku]) {
      expect(html).toContain(KOP_ORG_NAMA);
    }
    // Judul + periode/cutoff tetap ada di bawah kop
    expect(pembantuToHtml(p)).toContain('BUKU PEMBANTU');
    expect(realisasiToHtml(r)).toContain('REALISASI ANGGARAN');
    expect(surplusToHtml(s)).toContain('SURPLUS');
    expect(neracaToHtml(n)).toContain('NERACA');
    expect(neracaToHtml(n)).toContain('31-12-2025');
  });

  it('xlsx pembantu/realisasi/surplus/neraca/bku baris 1 = kop', async () => {
    const p = buildPembantu(MOCK_TRANSAKSI, { kode: '1001' });
    const r = buildRealisasi(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
    const s = buildSurplus(MOCK_TRANSAKSI, '2025-01-01', '2025-12-31');
    const n = neraca(MOCK_TRANSAKSI, MOCK_PANJAR, MOCK_TUTUP, '2025-12-31', KAS_KODES);
    const wbs = [
      await pembantuToWorkbook(p),
      await realisasiToWorkbook(r),
      await surplusToWorkbook(s),
      await neracaToWorkbook(n),
      await bkuToWorkbook([{ tanggal: '2025-01-01', keterangan: 'x', kode: '1001', masuk: 10000, keluar: 0 }]),
    ];
    for (const wb of wbs) {
      const ws = wb.worksheets[0]!;
      expect(ws.getRow(1).getCell(1).value).toBe(KOP_ORG_NAMA);
    }
  });

  it('periode kop SELALU tampil: fallback rentang data bila filter kosong', () => {
    // Pembantu tanpa filter tanggal → periode dari min/max baris data
    const p = buildPembantu(MOCK_TRANSAKSI, { kode: '1001' });
    expect(p.mulai).toBeUndefined();
    expect(kopPeriodeEfektif(p.mulai, p.sampai, p.rows)).toContain('PERIODE');
    expect(pembantuToHtml(p)).toContain('PERIODE');
    // Realisasi/surplus tanpa filter + rows → periode data, bukan kosong
    const r = buildRealisasi(MOCK_TRANSAKSI);
    expect(kopPeriodeEfektif(r.mulai, r.sampai, MOCK_TRANSAKSI)).toContain('PERIODE');
    expect(realisasiToHtml(r, MOCK_TRANSAKSI)).toContain('PERIODE');
    expect(surplusToHtml(buildSurplus(MOCK_TRANSAKSI), MOCK_TRANSAKSI)).toContain('PERIODE');
    // Tanpa filter DAN tanpa data → "SEMUA PERIODE" (tetap eksplisit)
    expect(kopPeriodeEfektif(undefined, undefined, [])).toBe('SEMUA PERIODE');
    expect(pembantuToHtml({ ...p, rows: [] })).toContain('SEMUA PERIODE');
  });
});
