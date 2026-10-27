// P1-10 — export & print semua laporan.
// Fokus kontrak:
// - sel nominal = NUMBER Rupiah (bukan string formatRp) + numFmt Rupiah;
// - persen = NUMBER fraksi 0..1 + numFmt 0.00%;
// - total/baris mengikuti hasil core/reports.ts;
// - HTML memakai kop + periode + thead + kurung untuk negatif;
// - file xlsx bisa dibaca ulang ExcelJS (round-trip, in-memory).

import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { COA } from '../src/db/coa.js';
import {
  arusKas,
  bukuBesar,
  labaRugi,
  neraca,
  neracaSaldo,
  neracaSaldoPeriode,
  type BarisJurnalSumber,
} from '../src/core/reports.js';
import { hitungRealisasiAnggaran } from '../src/core/anggaran.js';
import type { Panjar } from '../src/core/types.js';
import { pembantuDariBukuBesar } from '../src/features/reports/pembantu/pembantu.js';
import {
  KOP_ORG_NAMA,
  NUMFMT_PERSEN,
  NUMFMT_RP,
  anggaranToWorkbook,
  arusKasToHtml,
  arusKasToWorkbook,
  bukuBesarToHtml,
  bukuBesarToWorkbook,
  jurnalDaftarToHtml,
  jurnalToWorkbook,
  kopPeriodeEfektif,
  labaRugiToHtml,
  labaRugiToWorkbook,
  neracaHasilToHtml,
  neracaHasilToWorkbook,
  neracaSaldoToHtml,
  neracaSaldoToWorkbook,
  panjarToHtml,
  panjarToWorkbook,
  pembantuToHtml,
  pembantuToWorkbook,
  workbookToBuffer,
  type JurnalTampil,
  type PanjarTampil,
} from '../src/features/export/workbooks.js';

const RP = (rupiah: number): number => rupiah * 100;

// Dataset kecil tetapi mencakup modal, pendapatan, beban, transfer, hutang,
// panjar buka/tutup — cukup untuk menguji semua builder.
const baris: BarisJurnalSumber[] = [
  {
    jurnal_id: 'j-modal',
    tanggal: '2025-01-01',
    no_bukti: 'JU-2025-0001',
    keterangan: 'Saldo awal',
    jenis: 'SALDO_AWAL',
    akun_kode: '1001',
    debit: RP(100_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-modal',
    tanggal: '2025-01-01',
    no_bukti: 'JU-2025-0001',
    keterangan: 'Saldo awal',
    jenis: 'SALDO_AWAL',
    akun_kode: '3000',
    debit: 0,
    kredit: RP(100_000_000),
  },
  {
    jurnal_id: 'j-r2025',
    tanggal: '2025-03-01',
    no_bukti: 'JU-2025-0002',
    keterangan: 'Pendapatan parkir 2025',
    jenis: 'TERIMA',
    akun_kode: '1001',
    debit: RP(10_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-r2025',
    tanggal: '2025-03-01',
    no_bukti: 'JU-2025-0002',
    keterangan: 'Pendapatan parkir 2025',
    jenis: 'TERIMA',
    akun_kode: '4005',
    debit: 0,
    kredit: RP(10_000_000),
  },
  {
    jurnal_id: 'j-e2025',
    tanggal: '2025-04-01',
    no_bukti: 'JU-2025-0003',
    keterangan: 'Beban upakara 2025',
    jenis: 'BAYAR',
    akun_kode: '5004',
    debit: RP(4_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-e2025',
    tanggal: '2025-04-01',
    no_bukti: 'JU-2025-0003',
    keterangan: 'Beban upakara 2025',
    jenis: 'BAYAR',
    akun_kode: '1001',
    debit: 0,
    kredit: RP(4_000_000),
  },
  {
    jurnal_id: 'j-r2026',
    tanggal: '2026-01-15',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Pendapatan parkir',
    jenis: 'TERIMA',
    akun_kode: '1001',
    debit: RP(2_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-r2026',
    tanggal: '2026-01-15',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Pendapatan parkir',
    jenis: 'TERIMA',
    akun_kode: '4005',
    debit: 0,
    kredit: RP(2_000_000),
  },
  {
    jurnal_id: 'j-e2026',
    tanggal: '2026-02-01',
    no_bukti: 'JU-2026-0002',
    keterangan: 'Bayar listrik',
    jenis: 'BAYAR',
    akun_kode: '5010',
    debit: RP(500_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-e2026',
    tanggal: '2026-02-01',
    no_bukti: 'JU-2026-0002',
    keterangan: 'Bayar listrik',
    jenis: 'BAYAR',
    akun_kode: '1001',
    debit: 0,
    kredit: RP(500_000),
  },
  {
    jurnal_id: 'j-transfer',
    tanggal: '2026-02-10',
    no_bukti: 'JU-2026-0003',
    keterangan: 'Pindah dana ke kas',
    jenis: 'TRANSFER',
    akun_kode: '1001',
    debit: RP(1_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-transfer',
    tanggal: '2026-02-10',
    no_bukti: 'JU-2026-0003',
    keterangan: 'Pindah dana ke kas',
    jenis: 'TRANSFER',
    akun_kode: '1029',
    debit: 0,
    kredit: RP(1_000_000),
  },
  {
    jurnal_id: 'j-hutang',
    tanggal: '2026-03-01',
    no_bukti: 'JU-2026-0004',
    keterangan: 'Terima pinjaman',
    jenis: 'HUTANG',
    akun_kode: '1029',
    debit: RP(3_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-hutang',
    tanggal: '2026-03-01',
    no_bukti: 'JU-2026-0004',
    keterangan: 'Terima pinjaman',
    jenis: 'HUTANG',
    akun_kode: '2050',
    debit: 0,
    kredit: RP(3_000_000),
  },
  {
    jurnal_id: 'j-bayar-hutang',
    tanggal: '2026-03-10',
    no_bukti: 'JU-2026-0005',
    keterangan: 'Bayar hutang',
    jenis: 'BAYAR',
    akun_kode: '2050',
    debit: RP(1_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-bayar-hutang',
    tanggal: '2026-03-10',
    no_bukti: 'JU-2026-0005',
    keterangan: 'Bayar hutang',
    jenis: 'BAYAR',
    akun_kode: '1029',
    debit: 0,
    kredit: RP(1_000_000),
  },
  {
    jurnal_id: 'j-panjar-buka',
    tanggal: '2026-04-01',
    no_bukti: 'JU-2026-0006',
    keterangan: 'Serah panjar',
    jenis: 'PANJAR',
    akun_kode: '1040',
    debit: RP(1_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-panjar-buka',
    tanggal: '2026-04-01',
    no_bukti: 'JU-2026-0006',
    keterangan: 'Serah panjar',
    jenis: 'PANJAR',
    akun_kode: '1001',
    debit: 0,
    kredit: RP(1_000_000),
  },
  {
    jurnal_id: 'j-panjar-tutup',
    tanggal: '2026-04-05',
    no_bukti: 'JU-2026-0007',
    keterangan: 'Pertanggungjawaban panjar',
    jenis: 'PANJAR',
    akun_kode: '5003',
    debit: RP(600_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-panjar-tutup',
    tanggal: '2026-04-05',
    no_bukti: 'JU-2026-0007',
    keterangan: 'Pertanggungjawaban panjar',
    jenis: 'PANJAR',
    akun_kode: '1001',
    debit: RP(400_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-panjar-tutup',
    tanggal: '2026-04-05',
    no_bukti: 'JU-2026-0007',
    keterangan: 'Pertanggungjawaban panjar',
    jenis: 'PANJAR',
    akun_kode: '1040',
    debit: 0,
    kredit: RP(1_000_000),
  },
];

const bb = bukuBesar(baris, '1001', { mulai: '2026-01-01', sampai: '2026-12-31' });
const ns = neracaSaldo(baris, '2026-12-31');
const nsTahun = {
  mode: 'tahun' as const,
  ...neracaSaldoPeriode(baris, {
    mulai: '2026-01-01',
    sampai: '2026-12-31',
  }),
};
const nsTanpaCutoff = { ...neracaSaldo(baris), mode: 'kumulatif' as const };
const lr = labaRugi(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });
const lrDefisit = labaRugi(baris, { mulai: '2026-02-01', sampai: '2026-02-28' });
const n = neraca(baris, '2026-12-31');
const ak = arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });
const anggaranHasil = hitungRealisasiAnggaran(
  [
    { tahun: 2026, akun_kode: '4005', nominal: RP(3_000_000) },
    { tahun: 2026, akun_kode: '5010', nominal: RP(400_000) },
    { tahun: 2026, akun_kode: '5003', nominal: RP(500_000) },
  ],
  baris,
  { mulai: '2026-01-01', sampai: '2026-12-31' },
);

const jurnal: JurnalTampil[] = [
  {
    id: 'j-r2026',
    tanggal: '2026-01-15',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Pendapatan parkir',
    jenis: 'TERIMA',
    reversal_id: 'j-reversal',
    baris: [
      { akun_kode: '1001', debit: RP(2_000_000), kredit: 0, keterangan: 'Kas masuk' },
      { akun_kode: '4005', debit: 0, kredit: RP(2_000_000), keterangan: 'Pendapatan' },
    ],
  },
  {
    id: 'j-reversal',
    tanggal: '2026-05-01',
    no_bukti: 'JU-2026-0008',
    keterangan: 'KOREKSI: pendapatan parkir',
    jenis: 'REVERSAL',
    reversal_of: 'j-r2026',
    baris: [
      { akun_kode: '4005', debit: RP(2_000_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(2_000_000) },
    ],
  },
];

const panjar: PanjarTampil[] = [
  {
    id: 'p-1',
    tanggal: '2026-04-01',
    penerima: 'Panitia Piodalan',
    jumlah: RP(1_000_000),
    akun_kas_sumber: '1001',
    status: 'CLOSED',
    tanggal_close: '2026-04-05',
    total_realisasi: RP(600_000),
    sisa: RP(400_000),
    kurang: 0,
    items: [
      {
        panjar_id: 'p-1',
        kategori_baga: '5003',
        nominal: RP(600_000),
        jurnal_id: 'j-panjar-tutup',
      },
    ],
  },
  {
    id: 'p-2',
    tanggal: '2026-05-01',
    penerima: 'Panitia Karya',
    jumlah: RP(500_000),
    akun_kas_sumber: '1001',
    status: 'OPEN',
    items: [],
  },
];

function cariBaris(ws: ExcelJS.Worksheet, kolom: number, teks: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(ws.getRow(r).getCell(kolom).value ?? '') === teks) return r;
  }
  return 0;
}

/** Semua sel nominal pada rentang baris wajib NUMBER + numFmt Rupiah.
 * Sel kosong (mis. baris judul seksi) dilewati; sel yang terisi tidak boleh string. */
function cekNominal(
  ws: ExcelJS.Worksheet,
  kolom: readonly number[],
  mulai: number,
  selesai: number = ws.rowCount,
): void {
  for (let r = mulai; r <= selesai; r++) {
    for (const k of kolom) {
      const cell = ws.getRow(r).getCell(k);
      if (cell.value === null || cell.value === undefined) continue;
      expect(typeof cell.value, `baris ${r} kolom ${k} harus number`).toBe('number');
      expect(String(cell.numFmt), `baris ${r} kolom ${k} harus numFmt Rupiah`).toContain(
        '"Rp"',
      );
    }
  }
}

function cekPersen(
  ws: ExcelJS.Worksheet,
  kolom: number,
  mulai: number,
  selesai: number = ws.rowCount,
): void {
  for (let r = mulai; r <= selesai; r++) {
    const cell = ws.getRow(r).getCell(kolom);
    if (cell.value === null || cell.value === undefined) continue;
    expect(typeof cell.value, `baris ${r} persen harus number`).toBe('number');
    expect(cell.value as number).toBeGreaterThanOrEqual(-10);
    expect(cell.value as number).toBeLessThanOrEqual(10);
    expect(String(cell.numFmt), `baris ${r} harus numFmt persen`).toContain('0.00%');
  }
}

async function roundTrip(wb: ExcelJS.Workbook): Promise<ExcelJS.Workbook> {
  const buf = await workbookToBuffer(wb);
  const hasil = new ExcelJS.Workbook();
  // ExcelJS mendeklarasikan tipe `Buffer` sendiri (extends ArrayBuffer);
  // runtime tetap menerima Buffer/ArrayBuffer. Cast hanya untuk tipe.
  await hasil.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
  return hasil;
}

describe('P1-10 — builder XLSX numerik', () => {
  it('Jurnal Umum: sel debit/kredit number, subtotal per jurnal, total keseluruhan', async () => {
    const wb = await jurnalToWorkbook(jurnal, COA, {
      mulai: '2026-01-01',
      sampai: '2026-12-31',
    });
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe(KOP_ORG_NAMA);
    expect(String(ws.getRow(3).getCell(1).value)).toContain('PERIODE');

    const header = cariBaris(ws, 1, 'Tanggal');
    expect(header).toBeGreaterThan(0);
    cekNominal(ws, [5, 6], header + 1);

    // 4 baris jurnal + 2 subtotal + 1 total keseluruhan.
    expect(ws.rowCount - header).toBe(7);
    const subtotalRows = [1, 2]
      .map((i) => cariBaris(ws, 4, `Subtotal ${jurnal[i - 1]!.no_bukti}`))
      .filter((r) => r > 0);
    expect(subtotalRows).toHaveLength(2);
    expect(ws.getRow(subtotalRows[0]!).getCell(5).value).toBe(2_000_000);
    expect(ws.getRow(subtotalRows[0]!).getCell(6).value).toBe(2_000_000);

    const total = cariBaris(ws, 4, 'TOTAL KESELURUHAN');
    expect(ws.getRow(total).getCell(5).value).toBe(4_000_000);
    expect(ws.getRow(total).getCell(6).value).toBe(4_000_000);

    // Status koreksi ikut tampil.
    expect(cariBaris(ws, 8, 'Sudah dikoreksi')).toBeGreaterThan(0);
    expect(cariBaris(ws, 8, 'Jurnal balik')).toBeGreaterThan(0);
  });

  it('Buku Besar: saldo awal/berjalan/akhir + total debit/kredit number', async () => {
    const wb = await bukuBesarToWorkbook(bb);
    const ws = wb.worksheets[0]!;
    const header = cariBaris(ws, 1, 'Tanggal');
    cekNominal(ws, [4, 5, 6], header + 1);

    // Saldo awal + 5 mutasi + total + saldo akhir.
    expect(ws.rowCount - header).toBe(bb.rows.length + 3);
    const total = cariBaris(ws, 1, 'TOTAL MUTASI');
    expect(ws.getRow(total).getCell(4).value).toBe(bb.totalDebit / 100);
    expect(ws.getRow(total).getCell(5).value).toBe(bb.totalKredit / 100);
    expect(ws.getRow(total).getCell(6).value).toBe(bb.saldoAkhir / 100);

    const akhir = cariBaris(ws, 1, 'SALDO AKHIR');
    expect(ws.getRow(akhir).getCell(6).value).toBe(107_900_000);
    expect(cariBaris(ws, 7, 'Debit')).toBeGreaterThan(0);
  });

  it('Neraca Saldo: semua akun + total + status seimbang/selisih', async () => {
    const wb = await neracaSaldoToWorkbook(ns);
    const ws = wb.worksheets[0]!;
    const header = cariBaris(ws, 1, 'Kode');
    cekNominal(ws, [4, 5, 6], header + 1);

    expect(ws.rowCount - header).toBe(ns.rows.length + 2);
    const total = cariBaris(ws, 1, 'TOTAL');
    expect(ws.getRow(total).getCell(4).value).toBe(ns.totalDebit / 100);
    expect(ws.getRow(total).getCell(5).value).toBe(ns.totalKredit / 100);
    const status = cariBaris(ws, 1, 'STATUS');
    expect(ws.getRow(status).getCell(2).value).toBe('Seimbang');
    expect(ws.getRow(status).getCell(6).value).toBe(0);
  });

  it('Neraca Saldo mode tahun: periode tahun buku + baris laba ditahan', async () => {
    const wb = await neracaSaldoToWorkbook(nsTahun);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getRow(3).getCell(1).value)).toContain(
      'TAHUN BUKU 01-01-2026 s/d 31-12-2026',
    );

    const header = cariBaris(ws, 1, 'Kode');
    cekNominal(ws, [4, 5, 6], header + 1);
    expect(ws.rowCount - header).toBe(nsTahun.rows.length + 2);

    const labaDitahan = cariBaris(ws, 2, 'Laba ditahan sebelum periode');
    expect(labaDitahan).toBeGreaterThan(header);
    expect(ws.getRow(labaDitahan).getCell(5).value).toBe(6_000_000);
    expect(ws.getRow(labaDitahan).getCell(4).value).toBe(0);

    const total = cariBaris(ws, 1, 'TOTAL');
    expect(ws.getRow(total).getCell(4).value).toBe(nsTahun.totalDebit / 100);
    expect(ws.getRow(total).getCell(5).value).toBe(nsTahun.totalKredit / 100);
    const status = cariBaris(ws, 1, 'STATUS');
    expect(ws.getRow(status).getCell(2).value).toBe('Seimbang');

    // Kontrak lama tanpa mode & tanpa cutoff tetap memakai label kumulatif.
    const wbLama = await neracaSaldoToWorkbook(nsTanpaCutoff);
    expect(String(wbLama.worksheets[0]!.getRow(3).getCell(1).value)).toBe(
      'SEMUA PERIODE',
    );
  });

  it('Laba Rugi: nominal & persen number, total dan defisit negatif', async () => {
    const wb = await labaRugiToWorkbook(lr);
    const ws = wb.worksheets[0]!;
    const header = cariBaris(ws, 1, 'Kode');
    cekNominal(ws, [3], header + 1);
    cekPersen(ws, 4, header + 1);

    const totalPendapatan = cariBaris(ws, 2, 'Total Pendapatan');
    expect(ws.getRow(totalPendapatan).getCell(3).value).toBe(lr.totalPendapatan / 100);
    expect(ws.getRow(totalPendapatan).getCell(4).value).toBe(1);

    const totalBeban = cariBaris(ws, 2, 'Total Beban');
    expect(ws.getRow(totalBeban).getCell(3).value).toBe(lr.totalBeban / 100);

    const laba = cariBaris(ws, 2, 'LABA / (DEFISIT)');
    expect(ws.getRow(laba).getCell(3).value).toBe(lr.laba / 100);

    const wbDefisit = await labaRugiToWorkbook(lrDefisit);
    const wsDefisit = wbDefisit.worksheets[0]!;
    const labaDefisit = cariBaris(wsDefisit, 2, 'LABA / (DEFISIT)');
    expect(wsDefisit.getRow(labaDefisit).getCell(3).value).toBe(-500_000);
    expect(typeof wsDefisit.getRow(labaDefisit).getCell(3).value).toBe('number');
    expect(String(wsDefisit.getRow(labaDefisit).getCell(3).numFmt)).toContain('(Rp');
  });

  it('Neraca: aset/kewajiban/ekuitas + laba turunan + total pasiva', async () => {
    const wb = await neracaHasilToWorkbook(n);
    const ws = wb.worksheets[0]!;
    const header = cariBaris(ws, 1, 'Kode');
    cekNominal(ws, [3], header + 1);

    const totalAset = cariBaris(ws, 2, 'Total Aset');
    expect(ws.getRow(totalAset).getCell(3).value).toBe(n.totalAset / 100);
    const totalKewajiban = cariBaris(ws, 2, 'Total Kewajiban');
    expect(ws.getRow(totalKewajiban).getCell(3).value).toBe(n.totalKewajiban / 100);
    const totalEkuitas = cariBaris(ws, 2, 'Total Ekuitas');
    expect(ws.getRow(totalEkuitas).getCell(3).value).toBe(n.totalEkuitas / 100);
    const totalPasiva = cariBaris(ws, 2, 'TOTAL PASIVA');
    expect(ws.getRow(totalPasiva).getCell(3).value).toBe(n.totalPasiva / 100);
    expect(cariBaris(ws, 2, 'Laba ditahan (tahun sudah tutup)')).toBeGreaterThan(0);
    expect(cariBaris(ws, 2, 'Laba berjalan (1 Januari s/d cut-off)')).toBeGreaterThan(0);

    const status = cariBaris(ws, 1, 'STATUS');
    expect(ws.getRow(status).getCell(2).value).toBe('SEIMBANG');
    expect(ws.getRow(status).getCell(3).value).toBe(0);
  });

  it('Arus Kas: ringkasan + tabel mutasi + total number', async () => {
    const wb = await arusKasToWorkbook(ak);
    const ws = wb.worksheets[0]!;
    const headerRingkasan = cariBaris(ws, 1, 'RINGKASAN KELOMPOK');
    const headerDetail = cariBaris(ws, 1, 'Tanggal');
    cekNominal(ws, [2, 3, 4], headerRingkasan + 1, headerDetail - 2);
    cekNominal(ws, [5, 6], headerDetail + 1);

    expect(ws.rowCount - headerDetail).toBe(ak.rows.length + 1);
    const total = cariBaris(ws, 1, 'TOTAL ARUS (tanpa transfer)');
    expect(ws.getRow(total).getCell(5).value).toBe(ak.totalMasuk / 100);
    expect(ws.getRow(total).getCell(6).value).toBe(ak.totalKeluar / 100);
    expect(cariBaris(ws, 1, 'Saldo akhir')).toBeGreaterThan(0);
    expect(cariBaris(ws, 8, 'Transfer')).toBeGreaterThan(0);
  });

  it('Panjar: daftar + rincian item, semua nominal number', async () => {
    const wb = await panjarToWorkbook(panjar, COA);
    const ws = wb.worksheets[0]!;
    const header = cariBaris(ws, 1, 'Tanggal');
    const headerRincian = cariBaris(ws, 1, 'Panjar');
    cekNominal(ws, [4, 6, 7, 8], header + 1, headerRincian - 2);
    cekNominal(ws, [3], headerRincian + 1);

    const total = cariBaris(ws, 1, 'TOTAL');
    expect(ws.getRow(total).getCell(4).value).toBe(1_500_000);
    expect(ws.getRow(total).getCell(6).value).toBe(600_000);
    expect(ws.getRow(total).getCell(7).value).toBe(900_000);
    expect(ws.getRow(total).getCell(8).value).toBe(0);
    expect(cariBaris(ws, 2, 'Subtotal Panitia Piodalan')).toBeGreaterThan(0);
    expect(cariBaris(ws, 2, 'Belum ada rincian pertanggungjawaban')).toBeGreaterThan(0);
  });

  it('Anggaran: pagu/realisasi/sisa number, persen fraksi, total gabungan', async () => {
    const wb = await anggaranToWorkbook(anggaranHasil);
    const ws = wb.worksheets[0]!;
    const header = cariBaris(ws, 1, 'Kode');
    cekNominal(ws, [3, 4, 5], header + 1);
    cekPersen(ws, 6, header + 1);

    const row = cariBaris(ws, 1, '4005');
    expect(ws.getRow(row).getCell(3).value).toBe(3_000_000);
    expect(ws.getRow(row).getCell(4).value).toBe(2_000_000);
    expect(ws.getRow(row).getCell(5).value).toBe(1_000_000);
    expect(ws.getRow(row).getCell(6).value).toBeCloseTo(2 / 3, 10);
    expect(ws.getRow(row).getCell(7).value).toBe('Sesuai');

    const lebih = cariBaris(ws, 1, '5010');
    expect(ws.getRow(lebih).getCell(5).value).toBe(-100_000);
    expect(ws.getRow(lebih).getCell(7).value).toBe('Lebih');

    const total = cariBaris(ws, 2, 'TOTAL ANGGARAN & REALISASI');
    expect(ws.getRow(total).getCell(3).value).toBe(anggaranHasil.total.anggaran / 100);
    expect(ws.getRow(total).getCell(4).value).toBe(anggaranHasil.total.realisasi / 100);
    expect(ws.getRow(total).getCell(5).value).toBe(anggaranHasil.total.sisa / 100);
    expect(ws.getRow(total).getCell(6).value).toBeCloseTo(
      anggaranHasil.total.persen / 100,
      10,
    );
  });

  it('semua workbook bisa dibaca ulang ExcelJS dan tetap numerik (round-trip)', async () => {
    const wbs = [
      await jurnalToWorkbook(jurnal, COA),
      await bukuBesarToWorkbook(bb),
      await neracaSaldoToWorkbook(ns),
      await labaRugiToWorkbook(lr),
      await neracaHasilToWorkbook(n),
      await arusKasToWorkbook(ak),
      await panjarToWorkbook(panjar, COA),
      await anggaranToWorkbook(anggaranHasil),
    ];
    for (const wb of wbs) {
      const hasil = await roundTrip(wb);
      const ws = hasil.worksheets[0]!;
      expect(ws.getRow(1).getCell(1).value).toBe(KOP_ORG_NAMA);
      expect(ws.rowCount).toBeGreaterThan(1);
    }

    // File jurnal valid & format sel tetap terbaca setelah round-trip.
    const jurnalLagi = await roundTrip(await jurnalToWorkbook(jurnal, COA));
    const wsJurnal = jurnalLagi.worksheets[0]!;
    const header = cariBaris(wsJurnal, 1, 'Tanggal');
    const selDebit = wsJurnal.getRow(header + 1).getCell(5);
    expect(typeof selDebit.value).toBe('number');
    expect(String(selDebit.numFmt)).toContain('"Rp"');
  });
});

describe('P1-10 — HTML print semua laporan', () => {
  const htmls: { nama: string; html: string; periode: string }[] = [
    {
      nama: 'jurnal',
      html: jurnalDaftarToHtml(jurnal, COA, {
        mulai: '2026-01-01',
        sampai: '2026-12-31',
      }),
      periode: 'PERIODE 01-01-2026 s/d 31-12-2026',
    },
    { nama: 'buku besar', html: bukuBesarToHtml(bb), periode: 'PERIODE 01-01-2026 s/d 31-12-2026' },
    { nama: 'neraca saldo', html: neracaSaldoToHtml(ns), periode: 'PER 31-12-2026' },
    {
      nama: 'neraca saldo tahun',
      html: neracaSaldoToHtml(nsTahun),
      periode: 'TAHUN BUKU 01-01-2026 s/d 31-12-2026',
    },
    {
      nama: 'laba rugi',
      html: labaRugiToHtml(lr),
      periode: 'PERIODE 01-01-2026 s/d 31-12-2026',
    },
    { nama: 'neraca', html: neracaHasilToHtml(n), periode: 'PER 31-12-2026' },
    {
      nama: 'arus kas',
      html: arusKasToHtml(ak),
      periode: 'PERIODE 01-01-2026 s/d 31-12-2026',
    },
    {
      nama: 'panjar',
      html: panjarToHtml(panjar, COA),
      periode: 'PERIODE 01-04-2026 s/d 01-05-2026',
    },
  ];

  it('semua HTML memuat kop, periode, thead, dan total', () => {
    for (const { html, periode } of htmls) {
      expect(html).toContain(KOP_ORG_NAMA);
      expect(html).toContain(periode);
      expect(html).toContain('<thead>');
      expect(html.toLowerCase()).toContain('total');
    }
  });

  it('HTML menampilkan total yang sama dengan core dan negatif dalam kurung', () => {
    expect(jurnalDaftarToHtml(jurnal, COA)).toContain('TOTAL KESELURUHAN');
    expect(bukuBesarToHtml(bb)).toContain('107.900.000,00');
    expect(neracaSaldoToHtml(ns)).toContain('Seimbang');
    expect(neracaSaldoToHtml(nsTahun)).toContain('Laba ditahan sebelum periode');
    expect(neracaSaldoToHtml(nsTanpaCutoff)).toContain('SEMUA PERIODE');
    expect(labaRugiToHtml(lr)).toContain('Total Pendapatan');
    expect(neracaHasilToHtml(n)).toContain('TOTAL PASIVA');
    expect(arusKasToHtml(ak)).toContain('TOTAL ARUS (tanpa transfer)');
    expect(panjarToHtml(panjar, COA)).toContain('Subtotal');

    // Defisit: format Rupiah negatif wajib dalam kurung, bukan minus.
    expect(labaRugiToHtml(lrDefisit)).toContain('(Rp 500.000,00)');
  });
});

describe('P1-10 — export Pembantu dari mesin v2', () => {
  const p = pembantuDariBukuBesar(bb);

  it('workbook + HTML memakai kop, periode, dan angka Buku Besar', async () => {
    // Buku Besar 1001: saldo awal Rp 106.000.000 + mutasi 2026 neto Rp 1.900.000.
    expect(p.saldoAwal).toBe(10_600_000_000);
    expect(p.totalMasuk).toBe(340_000_000);
    expect(p.totalKeluar).toBe(150_000_000);
    expect(p.saldo).toBe(10_790_000_000);

    const wb = await pembantuToWorkbook(p);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe(KOP_ORG_NAMA);
    expect(String(ws.getRow(3).getCell(1).value)).toContain(
      'PERIODE 01-01-2026 s/d 31-12-2026',
    );

    const html = pembantuToHtml(p);
    expect(html).toContain(KOP_ORG_NAMA);
    expect(html).toContain('BUKU PEMBANTU — 1001 KAS');
    expect(html).toContain('PERIODE 01-01-2026 s/d 31-12-2026');
    expect(html).toContain('TOTAL');
  });

  it('periode kop fallback ke rentang data, lalu "SEMUA PERIODE"', () => {
    const tanpaFilter = { ...p, mulai: undefined, sampai: undefined };
    expect(kopPeriodeEfektif(tanpaFilter.mulai, tanpaFilter.sampai, tanpaFilter.rows)).toBe(
      'PERIODE 15-01-2026 s/d 05-04-2026',
    );
    expect(pembantuToHtml(tanpaFilter)).toContain('PERIODE 15-01-2026 s/d 05-04-2026');
    expect(kopPeriodeEfektif(undefined, undefined, [])).toBe('SEMUA PERIODE');
    expect(
      pembantuToHtml({ ...p, rows: [], mulai: undefined, sampai: undefined }),
    ).toContain('SEMUA PERIODE');
  });
});

describe('P1-10 — konstanta format', () => {
  it('numFmt Rupiah & persen sesuai kontrak', () => {
    expect(NUMFMT_RP).toBe('"Rp"#,##0.00;(Rp"#,##0.00)');
    expect(NUMFMT_PERSEN).toBe('0.00%');
  });

  it('tipe PanjarTampil kompatibel dengan Panjar + items', () => {
    const p: PanjarTampil = panjar[0]!;
    const dasar: Panjar = p;
    expect(dasar.id).toBe('p-1');
  });
});
