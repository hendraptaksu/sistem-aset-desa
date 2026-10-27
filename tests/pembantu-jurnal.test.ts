// P0-5 / AUD-25 — tab Pembantu harus memakai jurnal, bukan tabel single-entry lama.
// Arah masuk/keluar mengikuti posisi_normal akun (bukan isAkunKas), dan nominal
// XLSX wajib berupa number + numFmt Rupiah agar bisa di-SUM di Excel.

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import type { BukuBesarHasil } from '../src/core/reports.js';
import { pembantuDariBukuBesar } from '../src/features/reports/pembantu/pembantu.js';
import {
  NUMFMT_RP,
  pembantuToHtml,
  pembantuToWorkbook,
} from '../src/features/export/workbooks.js';

type Posisi = BukuBesarHasil['posisi_normal'];
type Baris = BukuBesarHasil['rows'][number];

const baris = (
  debit: number,
  kredit: number,
  saldo: number,
  posisiNormal: Posisi = 'DEBIT',
  keterangan = 'Uji',
): Baris => ({
  jurnal_id: 'j1',
  baris_id: 1,
  tanggal: '2026-01-02',
  no_bukti: 'JU-2026-0001',
  keterangan,
  debit,
  kredit,
  saldo,
  posisi:
    saldo === 0
      ? null
      : saldo > 0
        ? posisiNormal
        : posisiNormal === 'DEBIT'
          ? 'KREDIT'
          : 'DEBIT',
});

function bb(
  partial: Pick<BukuBesarHasil, 'kode' | 'nama' | 'tipe' | 'posisi_normal'> &
    Partial<BukuBesarHasil>,
): BukuBesarHasil {
  return {
    saldoAwal: 0,
    rows: [],
    totalDebit: 0,
    totalKredit: 0,
    saldoAkhir: 0,
    ...partial,
  };
}

const bbKas = bb({
  kode: '1001',
  nama: 'KAS',
  tipe: 'AKTIVA',
  posisi_normal: 'DEBIT',
  saldoAwal: 500,
  rows: [baris(1_000, 0, 1_500), baris(0, 250, 1_250)],
  totalDebit: 1_000,
  totalKredit: 250,
  saldoAkhir: 1_250,
});

const bbPendapatan = bb({
  kode: '4005',
  nama: 'PENDAPATAN PARKIR',
  tipe: 'PENDAPATAN',
  posisi_normal: 'KREDIT',
  saldoAwal: 0,
  rows: [baris(200, 1_000, 800, 'KREDIT')],
  totalDebit: 200,
  totalKredit: 1_000,
  saldoAkhir: 800,
});

// Bug utama AUD-25: 1040 adalah AKTIVA non-kas bersaldo normal DEBIT. Debit 50
// di atas saldo awal 100 harus menambah saldo menjadi 150, bukan mengurangi.
const bbPanjar = bb({
  kode: '1040',
  nama: 'PANJAR',
  tipe: 'AKTIVA',
  posisi_normal: 'DEBIT',
  saldoAwal: 100,
  rows: [baris(50, 0, 150, 'DEBIT', 'Panjar')],
  totalDebit: 50,
  totalKredit: 0,
  saldoAkhir: 150,
});

const bbPiutang = bb({
  kode: '1050',
  nama: 'PIUTANG',
  tipe: 'AKTIVA',
  posisi_normal: 'DEBIT',
  saldoAwal: 30,
  rows: [baris(70, 0, 100), baris(0, 20, 80, 'DEBIT', 'Pelunasan')],
  totalDebit: 70,
  totalKredit: 20,
  saldoAkhir: 80,
});

describe('pembantuDariBukuBesar', () => {
  it('akun kas: debit = masuk, kredit = keluar, saldo akhir dari Buku Besar', () => {
    const p = pembantuDariBukuBesar(bbKas);

    expect(p.rows.map((r) => [r.masuk, r.keluar])).toEqual([
      [1_000, 0],
      [0, 250],
    ]);
    expect(p.totalMasuk).toBe(1_000);
    expect(p.totalKeluar).toBe(250);
    expect(p.saldoAwal).toBe(500);
    expect(p.saldo).toBe(1_250);
  });

  it('akun pendapatan (KREDIT): kredit = masuk, debit = keluar', () => {
    const p = pembantuDariBukuBesar(bbPendapatan);

    expect(p.rows[0]).toMatchObject({ masuk: 1_000, keluar: 200 });
    expect(p.totalMasuk).toBe(1_000);
    expect(p.totalKeluar).toBe(200);
    expect(p.saldo).toBe(800);
  });

  it('1040 panjar (DEBIT non-kas): debit = masuk, saldo awal 100 + 50 = 150', () => {
    const p = pembantuDariBukuBesar(bbPanjar);

    expect(p.rows[0]).toMatchObject({ masuk: 50, keluar: 0 });
    expect(p.saldoAwal).toBe(100);
    expect(p.totalMasuk).toBe(50);
    expect(p.totalKeluar).toBe(0);
    expect(p.saldo).toBe(150);
  });

  it('1050 piutang (DEBIT non-kas): debit = masuk, kredit = keluar', () => {
    const p = pembantuDariBukuBesar(bbPiutang);

    expect(p.rows.map((r) => [r.masuk, r.keluar])).toEqual([
      [70, 0],
      [0, 20],
    ]);
    expect(p.saldoAwal).toBe(30);
    expect(p.totalMasuk).toBe(70);
    expect(p.totalKeluar).toBe(20);
    expect(p.saldo).toBe(80);
  });
});

describe('pembantuToWorkbook', () => {
  it('menulis nominal sebagai number + numFmt Rp dan saldo berjalan ikut saldo awal', async () => {
    const p = pembantuDariBukuBesar(bbPanjar);
    const wb = await pembantuToWorkbook(p);
    const ws = wb.worksheets[0]!;

    let headerRow = 0;
    ws.eachRow((row, n) => {
      if (row.getCell(1).value === 'Tanggal') headerRow = n;
    });
    expect(headerRow).toBeGreaterThan(0);
    expect(ws.getRow(headerRow).getCell(5).value).toBe('Saldo');

    const cariBaris = (label: string, kolom = 2): ExcelJS.Row => {
      let found: ExcelJS.Row | undefined;
      ws.eachRow((row) => {
        if (row.getCell(kolom).value === label) found = row;
      });
      expect(found, `baris ${label}`).toBeTruthy();
      return found!;
    };

    const awal = cariBaris('Saldo awal');
    expect(awal.getCell(5).type).toBe(ExcelJS.ValueType.Number);
    expect(awal.getCell(5).value).toBe(1); // 100 sen
    expect(awal.getCell(5).numFmt).toBe(NUMFMT_RP);

    const mutasi = cariBaris('Panjar');
    for (const kolom of [3, 4, 5]) {
      expect(mutasi.getCell(kolom).type).toBe(ExcelJS.ValueType.Number);
    }
    expect(mutasi.getCell(3).value).toBe(0.5); // 50 sen
    expect(mutasi.getCell(4).value).toBe(0);
    expect(mutasi.getCell(5).value).toBe(1.5); // 150 sen
    expect(mutasi.getCell(3).numFmt).toBe(NUMFMT_RP);
    expect(mutasi.getCell(5).numFmt).toBe(NUMFMT_RP);

    const total = cariBaris('TOTAL', 1);
    for (const kolom of [3, 4]) {
      expect(total.getCell(kolom).type).toBe(ExcelJS.ValueType.Number);
    }

    const akhir = cariBaris('SALDO AKHIR', 1);
    expect(akhir.getCell(5).type).toBe(ExcelJS.ValueType.Number);
    expect(akhir.getCell(5).value).toBe(1.5);

    // HTML/print tetap memakai formatRp (bukan numFmt).
    expect(pembantuToHtml(p)).toContain('Rp 1,50');
  });
});
