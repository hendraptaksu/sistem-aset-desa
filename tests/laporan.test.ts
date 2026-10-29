// P0-5: mesin laporan double-entry (murni) + adapter DB.
// Skenario manual: modal 10jt, parkir 5jt, upakara 2jt, panjar 5jt
// (realisasi 4,5jt + sisa 0,5jt), piutang 1jt, hutang 3jt (bayar 1jt),
// transfer 0,5jt pada 2025; lalu transaksi 2026 untuk laba berjalan.
//
// Semua nominal SEN. Angka harapan dihitung manual, bukan dari fungsi lain.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { insertJurnal } from '../src/db/repository.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { buildDashboardJurnal } from '../src/features/dashboard/dashboard.js';
import {
  arusKas,
  bukuBesar,
  labaRugi,
  labaTahun,
  neraca,
  neracaSaldo,
  neracaSaldoPeriode,
  NAMA_LABA_DITAHAN_SEBELUM_PERIODE,
  saldoAkun,
  saldoSemuaKas,
  totalKas,
  type BarisJurnalSumber,
} from '../src/core/reports.js';
import { hitungRealisasiAnggaran } from '../src/core/anggaran.js';

const RP = (rupiah: number): number => rupiah * 100;

type BarisRingkas = [akun: string, debit: number, kredit: number];

const jurnal = (
  id: string,
  tanggal: string,
  keterangan: string,
  baris: BarisRingkas[],
): BarisJurnalSumber[] =>
  baris.map(([akun_kode, debit, kredit], i) => ({
    jurnal_id: id,
    baris_id: i + 1,
    tanggal,
    no_bukti: `JU-${tanggal.slice(0, 4)}-${id.slice(-3).padStart(3, '0')}`,
    keterangan,
    akun_kode,
    debit,
    kredit,
  }));

const BARIS: BarisJurnalSumber[] = [
  // 2025
  ...jurnal('j-001', '2025-01-01', 'Saldo awal kas', [
    ['1001', RP(10_000_000), 0],
    ['3000', 0, RP(10_000_000)],
  ]),
  ...jurnal('j-002', '2025-02-01', 'Pendapatan parkir', [
    ['1015', RP(5_000_000), 0],
    ['4005', 0, RP(5_000_000)],
  ]),
  ...jurnal('j-003', '2025-03-01', 'Beban upakara', [
    ['5004', RP(2_000_000), 0],
    ['1001', 0, RP(2_000_000)],
  ]),
  ...jurnal('j-004', '2025-04-01', 'Serah panjar', [
    ['1040', RP(5_000_000), 0],
    ['1001', 0, RP(5_000_000)],
  ]),
  ...jurnal('j-005', '2025-04-20', 'Pertanggungjawaban panjar', [
    ['5003', RP(4_500_000), 0],
    ['1001', RP(500_000), 0],
    ['1040', 0, RP(5_000_000)],
  ]),
  ...jurnal('j-006', '2025-05-01', 'Beri pinjaman', [
    ['1050', RP(1_000_000), 0],
    ['1001', 0, RP(1_000_000)],
  ]),
  ...jurnal('j-007', '2025-05-20', 'Pelunasan pinjaman', [
    ['1001', RP(1_000_000), 0],
    ['1050', 0, RP(1_000_000)],
  ]),
  ...jurnal('j-008', '2025-06-01', 'Terima pinjaman', [
    ['1029', RP(3_000_000), 0],
    ['2050', 0, RP(3_000_000)],
  ]),
  ...jurnal('j-009', '2025-07-01', 'Bayar hutang', [
    ['2050', RP(1_000_000), 0],
    ['1029', 0, RP(1_000_000)],
  ]),
  ...jurnal('j-010', '2025-12-31', 'Pindah dana kas ke bank', [
    ['1029', RP(500_000), 0],
    ['1001', 0, RP(500_000)],
  ]),
  // 2026
  ...jurnal('j-011', '2026-01-15', 'Pendapatan parkir 2026', [
    ['1001', RP(700_000), 0],
    ['4005', 0, RP(700_000)],
  ]),
  ...jurnal('j-012', '2026-02-01', 'Bayar listrik', [
    ['5010', RP(200_000), 0],
    ['1001', 0, RP(200_000)],
  ]),
  ...jurnal('j-013', '2026-02-10', 'Terima pinjaman 2026', [
    ['1029', RP(2_000_000), 0],
    ['2050', 0, RP(2_000_000)],
  ]),
  ...jurnal('j-014', '2026-03-01', 'Bayar hutang 2026', [
    ['2050', RP(500_000), 0],
    ['1029', 0, RP(500_000)],
  ]),
  ...jurnal('j-015', '2026-03-15', 'Perbaikan gedung dibayar belakangan', [
    ['5003', RP(800_000), 0],
    ['2050', 0, RP(800_000)],
  ]),
];

const dirs: string[] = [];

function freshDb(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), 'pura-laporan-'));
  dirs.push(dir);
  return openDb(join(dir, 'pura.db'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P0-5 — saldoAkun per posisi normal', () => {
  it('akun debit normal (kas/beban) dan kredit normal (pendapatan/hutang/modal)', () => {
    expect(saldoAkun(BARIS, '1001', '2025-12-31')).toBe(RP(3_000_000));
    expect(saldoAkun(BARIS, '1015', '2025-12-31')).toBe(RP(5_000_000));
    expect(saldoAkun(BARIS, '1029', '2025-12-31')).toBe(RP(2_500_000));
    expect(saldoAkun(BARIS, '1040', '2025-12-31')).toBe(0);
    expect(saldoAkun(BARIS, '1050', '2025-12-31')).toBe(0);
    expect(saldoAkun(BARIS, '5004', '2025-12-31')).toBe(RP(2_000_000));
    expect(saldoAkun(BARIS, '4005', '2025-12-31')).toBe(RP(5_000_000));
    expect(saldoAkun(BARIS, '2050', '2025-12-31')).toBe(RP(2_000_000));
    expect(saldoAkun(BARIS, '3000', '2025-12-31')).toBe(RP(10_000_000));
  });

  it('cut-off inklusif dan saldo semua kas', () => {
    expect(saldoAkun(BARIS, '1001', '2025-04-01')).toBe(RP(3_000_000));
    expect(saldoAkun(BARIS, '1001', '2025-03-31')).toBe(RP(8_000_000));
    const kas = saldoSemuaKas(BARIS, ['1001', '1015', '1029', '1040'], '2025-12-31');
    expect(kas).toEqual({
      '1001': RP(3_000_000),
      '1015': RP(5_000_000),
      '1029': RP(2_500_000),
      '1040': 0,
    });
    expect(totalKas(BARIS, ['1001', '1015', '1029'], '2025-12-31')).toBe(RP(10_500_000));
  });
});

describe('P0-5 — Buku Besar', () => {
  it('saldo awal, mutasi, saldo berjalan, dan saldo akhir kas 1001', () => {
    const bb = bukuBesar(BARIS, '1001', { mulai: '2026-01-01', sampai: '2026-12-31' });
    expect(bb.kode).toBe('1001');
    expect(bb.saldoAwal).toBe(RP(3_000_000));
    expect(bb.rows).toHaveLength(2);
    expect(bb.rows[0]).toMatchObject({
      tanggal: '2026-01-15',
      debit: RP(700_000),
      kredit: 0,
      saldo: RP(3_700_000),
      posisi: 'DEBIT',
    });
    expect(bb.rows[1]).toMatchObject({
      tanggal: '2026-02-01',
      debit: 0,
      kredit: RP(200_000),
      saldo: RP(3_500_000),
    });
    expect(bb.totalDebit).toBe(RP(700_000));
    expect(bb.totalKredit).toBe(RP(200_000));
    expect(bb.saldoAkhir).toBe(RP(3_500_000));
    expect(bb.saldoAkhir).toBe(saldoAkun(BARIS, '1001', '2026-12-31'));
  });

  it('akun kredit normal (2050) menampilkan saldo positif sesuai posisi normal', () => {
    const bb = bukuBesar(BARIS, '2050');
    expect(bb.posisi_normal).toBe('KREDIT');
    expect(bb.rows).toHaveLength(5);
    expect(bb.rows[0]!.saldo).toBe(RP(3_000_000));
    expect(bb.rows[1]!.saldo).toBe(RP(2_000_000));
    expect(bb.rows[2]!.saldo).toBe(RP(4_000_000));
    expect(bb.rows[3]!.saldo).toBe(RP(3_500_000));
    expect(bb.rows[4]!.saldo).toBe(RP(4_300_000));
    expect(bb.saldoAkhir).toBe(RP(4_300_000));
  });

  it('panjar 1040: open + close kembali nol; filter periode tetap benar', () => {
    const bb = bukuBesar(BARIS, '1040');
    expect(bb.rows).toHaveLength(2);
    expect(bb.totalDebit).toBe(RP(5_000_000));
    expect(bb.totalKredit).toBe(RP(5_000_000));
    expect(bb.saldoAkhir).toBe(0);
    expect(bb.rows[1]!.posisi).toBeNull();
  });
});

describe('P0-5 — Neraca Saldo', () => {
  it('selisih nol di beberapa cut-off; kolom debit/kredit seimbang', () => {
    for (const cutoff of ['2025-01-01', '2025-12-31', '2026-06-30', '2026-12-31']) {
      const ns = neracaSaldo(BARIS, cutoff);
      expect(ns.selisih, `cutoff ${cutoff}`).toBe(0);
      expect(ns.totalDebit, `cutoff ${cutoff}`).toBe(ns.totalKredit);
      expect(ns.seimbang).toBe(true);
    }
  });

  it('angka manual 2026: debit = aset + beban, kredit = kewajiban + ekuitas + pendapatan', () => {
    const ns = neracaSaldo(BARIS, '2026-12-31');
    // Aset 1.250.000 + beban 750.000 = 2.000.000 (Rp 20.000.000)
    expect(ns.totalDebit).toBe(RP(20_000_000));
    // 2050 430.000 + 3000 1.000.000 + pendapatan 570.000 = 2.000.000
    expect(ns.totalKredit).toBe(RP(20_000_000));
    expect(ns.rows.find((r) => r.kode === '1001')).toMatchObject({
      saldo: RP(3_500_000),
      debit: RP(3_500_000),
      kredit: 0,
      adaMutasi: true,
    });
    expect(ns.rows.find((r) => r.kode === '2050')).toMatchObject({
      saldo: RP(4_300_000),
      debit: 0,
      kredit: RP(4_300_000),
    });
    expect(ns.rows.find((r) => r.kode === '4005')?.saldo).toBe(RP(5_700_000));
  });

  it('opsi hanyaAdaSaldo membuang akun nol tanpa mengubah total', () => {
    const semua = neracaSaldo(BARIS, '2025-12-31');
    const berisi = neracaSaldo(BARIS, { cutoff: '2025-12-31', hanyaAdaSaldo: true });
    expect(berisi.rows.length).toBeLessThan(semua.rows.length);
    expect(berisi.rows.some((r) => r.kode === '1040')).toBe(false);
    expect(berisi.totalDebit).toBe(semua.totalDebit);
    expect(berisi.totalKredit).toBe(semua.totalKredit);
  });
});

describe('AUD-21a — Neraca Saldo per tahun buku', () => {
  const P = { mulai: '2026-01-01', sampai: '2026-12-31' } as const;

  it('2026 hanya memuat P&L 2026; laba 2025 masuk baris laba ditahan', () => {
    const ns = neracaSaldoPeriode(BARIS, P);

    // P&L 2026 saja: pendapatan 700rb; beban 1jt (800rb + 200rb).
    expect(ns.rows.find((r) => r.kode === '4005')?.saldo).toBe(RP(700_000));
    expect(ns.rows.find((r) => r.kode === '5003')?.saldo).toBe(RP(800_000));
    expect(ns.rows.find((r) => r.kode === '5010')?.saldo).toBe(RP(200_000));
    // Beban 2025 (5004 2jt) tidak boleh muncul lagi.
    expect(ns.rows.find((r) => r.kode === '5004')?.saldo).toBe(0);
    expect(ns.totalPendapatan).toBe(RP(700_000));
    expect(ns.totalBeban).toBe(RP(1_000_000));
    expect(ns.labaPeriode).toBe(RP(-300_000));

    // Laba 2025 defisit 1,5jt → baris sintetis di sisi debit.
    expect(ns.labaDitahanSebelumPeriode).toBe(RP(-1_500_000));
    const sintetis = ns.rows.find((r) => r.sintetis);
    expect(sintetis).toMatchObject({
      kode: '',
      nama: NAMA_LABA_DITAHAN_SEBELUM_PERIODE,
      tipe: 'EKUITAS',
      posisi_normal: 'KREDIT',
      saldo: RP(-1_500_000),
      debit: RP(1_500_000),
      kredit: 0,
    });

    // Manual: aset 12,5jt + beban 1jt + defisit ditahan 1,5jt = 15jt.
    // Kredit: kewajiban 4,3jt + modal 10jt + pendapatan 700rb = 15jt.
    expect(ns.totalDebit).toBe(RP(15_000_000));
    expect(ns.totalKredit).toBe(RP(15_000_000));
    expect(ns.selisih).toBe(0);
    expect(ns.seimbang).toBe(true);
  });

  it('saldo akun neraca cocok dengan neraca() dan laba ditahan/berjalan', () => {
    const ns = neracaSaldoPeriode(BARIS, P);
    const n = neraca(BARIS, { cutoff: '2026-12-31', tutup: [{ tahun: 2025 }] });
    const saldoNeraca = (kode: string): number | undefined => {
      const saldo = [...n.aset, ...n.kewajiban, ...n.ekuitas].find((r) => r.kode === kode)?.saldo;
      // neraca() lama bisa menghasilkan -0 untuk akun kredit normal tanpa mutasi.
      return saldo === 0 ? 0 : saldo;
    };

    for (const r of ns.rows) {
      if (r.sintetis || r.tipe === 'PENDAPATAN' || r.tipe === 'BEBAN') continue;
      expect(r.saldo, `akun ${r.kode}`).toBe(saldoNeraca(r.kode));
    }
    expect(ns.rows.find((r) => r.kode === '1001')?.saldo).toBe(RP(3_500_000));
    expect(ns.rows.find((r) => r.kode === '1029')?.saldo).toBe(RP(4_000_000));
    expect(ns.rows.find((r) => r.kode === '2050')?.saldo).toBe(RP(4_300_000));
    expect(ns.rows.find((r) => r.kode === '3000')?.saldo).toBe(RP(10_000_000));

    expect(ns.labaDitahanSebelumPeriode).toBe(n.labaDitahan);
    expect(ns.labaPeriode).toBe(n.labaBerjalan);
    expect(n.totalEkuitasAkun + ns.labaDitahanSebelumPeriode + ns.labaPeriode).toBe(
      n.totalEkuitas,
    );
  });

  it('2025: seluruh P&L 2025 masuk periode, tanpa baris laba ditahan', () => {
    const ns = neracaSaldoPeriode(BARIS, { mulai: '2025-01-01', sampai: '2025-12-31' });
    expect(ns.labaDitahanSebelumPeriode).toBe(0);
    expect(ns.rows.some((r) => r.sintetis)).toBe(false);
    expect(ns.rows.find((r) => r.kode === '4005')?.saldo).toBe(RP(5_000_000));
    expect(ns.rows.find((r) => r.kode === '5004')?.saldo).toBe(RP(2_000_000));
    expect(ns.rows.find((r) => r.kode === '5003')?.saldo).toBe(RP(4_500_000));
    expect(ns.labaPeriode).toBe(RP(-1_500_000));

    // Manual: aset 10,5jt + beban 6,5jt = 17jt;
    // kewajiban 2jt + modal 10jt + pendapatan 5jt = 17jt.
    expect(ns.totalDebit).toBe(RP(17_000_000));
    expect(ns.totalKredit).toBe(RP(17_000_000));
    expect(ns.seimbang).toBe(true);

    const n = neraca(BARIS, { cutoff: '2025-12-31', tutup: [] });
    expect(ns.rows.find((r) => r.kode === '1001')?.saldo).toBe(n.aset[0]?.saldo);
    expect(ns.rows.find((r) => r.kode === '2050')?.saldo).toBe(n.kewajiban[0]?.saldo);
    expect(ns.rows.find((r) => r.kode === '3000')?.saldo).toBe(n.ekuitas[0]?.saldo);
    expect(ns.labaPeriode).toBe(n.labaBerjalan);
  });

  it('hanyaAdaSaldo menjaga total; data kosong aman dan tanpa baris sintetis', () => {
    const penuh = neracaSaldoPeriode(BARIS, P);
    const berisi = neracaSaldoPeriode(BARIS, { ...P, hanyaAdaSaldo: true });
    expect(berisi.rows.length).toBeLessThan(penuh.rows.length);
    expect(berisi.rows.some((r) => r.kode === '1040')).toBe(false);
    expect(berisi.rows.some((r) => r.sintetis)).toBe(true);
    expect(berisi.totalDebit).toBe(penuh.totalDebit);
    expect(berisi.totalKredit).toBe(penuh.totalKredit);

    const kosong = neracaSaldoPeriode([], P);
    expect(kosong.totalDebit).toBe(0);
    expect(kosong.totalKredit).toBe(0);
    expect(kosong.selisih).toBe(0);
    expect(kosong.seimbang).toBe(true);
    expect(kosong.labaDitahanSebelumPeriode).toBe(0);
    expect(kosong.labaPeriode).toBe(0);
    expect(kosong.rows.some((r) => r.sintetis)).toBe(false);
  });

  it('menolak rentang terbalik dan akun di luar COA', () => {
    expect(() =>
      neracaSaldoPeriode([], { mulai: '2026-12-31', sampai: '2026-01-01' }),
    ).toThrow(/Rentang periode tidak valid/);
    expect(() =>
      neracaSaldoPeriode(
        [{ tanggal: '2026-01-01', akun_kode: '9999', debit: 100, kredit: 0 }],
        P,
      ),
    ).toThrow(/Akun 9999 pada jurnal tidak dikenal/);
  });
});

describe('P0-5 — Laba Rugi', () => {
  it('2026: pendapatan 700rb, beban 1jt, defisit 300rb', () => {
    const lr = labaRugi(BARIS, { mulai: '2026-01-01', sampai: '2026-12-31' });
    expect(lr.totalPendapatan).toBe(RP(700_000));
    expect(lr.totalBeban).toBe(RP(1_000_000));
    expect(lr.laba).toBe(RP(-300_000));
    expect(lr.labaBersih).toBe(lr.laba);
    expect(lr.defisit).toBe(true);
    expect(lr.pendapatan.find((b) => b.kode === '4005')?.nominal).toBe(RP(700_000));
    expect(lr.beban.find((b) => b.kode === '5010')?.nominal).toBe(RP(200_000));
    expect(lr.beban.find((b) => b.kode === '5003')?.nominal).toBe(RP(800_000));
  });

  it('2025: pendapatan 5jt, beban 6,5jt, defisit 1,5jt; labaTahun setara', () => {
    const lr = labaRugi(BARIS, { mulai: '2025-01-01', sampai: '2025-12-31' });
    expect(lr.totalPendapatan).toBe(RP(5_000_000));
    expect(lr.totalBeban).toBe(RP(6_500_000));
    expect(lr.laba).toBe(RP(-1_500_000));
    expect(labaTahun(BARIS, 2025)).toBe(RP(-1_500_000));
  });

  it('hanya akun PENDAPATAN/BEBAN yang masuk; transfer/piutang/panjar tidak', () => {
    const lr = labaRugi(BARIS, { mulai: '2025-01-01', sampai: '2026-12-31' });
    expect(lr.pendapatan.every((b) => b.kode.startsWith('4'))).toBe(true);
    expect(lr.beban.every((b) => b.kode.startsWith('5'))).toBe(true);
    expect(lr.totalPendapatan).toBe(RP(5_700_000));
    expect(lr.totalBeban).toBe(RP(7_500_000));
  });
});

describe('P0-5 — Neraca', () => {
  it('aset = kewajiban + ekuitas; laba berjalan 2026 dan laba ditahan 2025', () => {
    const n = neraca(BARIS, { cutoff: '2026-12-31', tutup: [{ tahun: 2025 }] });
    expect(n.totalAset).toBe(RP(12_500_000));
    expect(n.totalKewajiban).toBe(RP(4_300_000));
    expect(n.totalEkuitasAkun).toBe(RP(10_000_000));
    expect(n.labaDitahan).toBe(RP(-1_500_000));
    expect(n.labaBelumDitutup).toBe(0);
    expect(n.labaBerjalan).toBe(RP(-300_000));
    expect(n.totalEkuitas).toBe(RP(8_200_000));
    expect(n.totalPasiva).toBe(RP(12_500_000));
    expect(n.selisih).toBe(0);
    expect(n.balance).toBe(true);
    expect(n.aktiva).toBe(n.totalAset);
    expect(n.pasiva).toBe(n.totalPasiva);
  });

  it('tahun lampau yang belum ditutup tetap dihitung agar Neraca tidak selisih', () => {
    const n = neraca(BARIS, { cutoff: '2026-12-31', tutup: [] });
    expect(n.labaDitahan).toBe(0);
    expect(n.labaBelumDitutup).toBe(RP(-1_500_000));
    expect(n.labaBerjalan).toBe(RP(-300_000));
    expect(n.totalEkuitas).toBe(RP(8_200_000));
    expect(n.balance).toBe(true);
  });

  it('tanpa info tutup, seluruh laba tahun lampau dianggap laba ditahan turunan', () => {
    const n = neraca(BARIS, '2026-12-31');
    expect(n.labaDitahan).toBe(RP(-1_500_000));
    expect(n.labaBelumDitutup).toBe(0);
    expect(n.balance).toBe(true);
  });

  it('cut-off akhir 2025: balance dan laba berjalan = laba 2025', () => {
    const n = neraca(BARIS, { cutoff: '2025-12-31', tutup: [] });
    expect(n.totalAset).toBe(RP(10_500_000));
    expect(n.totalKewajiban).toBe(RP(2_000_000));
    expect(n.labaBerjalan).toBe(RP(-1_500_000));
    expect(n.balance).toBe(true);
  });
});

describe('P0-5 — Arus Kas metode langsung', () => {
  it('2026: masuk 2,7jt, keluar 700rb, kenaikan 2jt, saldo akhir 12,5jt', () => {
    const ak = arusKas(BARIS, { mulai: '2026-01-01', sampai: '2026-12-31' });
    expect(ak.saldoAwal).toBe(RP(10_500_000));
    expect(ak.totalMasuk).toBe(RP(2_700_000));
    expect(ak.totalKeluar).toBe(RP(700_000));
    expect(ak.kenaikan).toBe(RP(2_000_000));
    expect(ak.saldoAkhir).toBe(RP(12_500_000));
    expect(ak.saldoAkhir).toBe(totalKas(BARIS, undefined, '2026-12-31'));
    expect(ak.operasi).toMatchObject({ masuk: RP(700_000), keluar: RP(200_000), neto: RP(500_000) });
    expect(ak.pendanaan).toMatchObject({ masuk: RP(2_000_000), keluar: RP(500_000), neto: RP(1_500_000) });
    expect(ak.investasi.neto).toBe(0);
    expect(ak.transfer.neto).toBe(0);
  });

  it('transfer antar kas tidak dihitung sebagai arus masuk/keluar', () => {
    const ak = arusKas(BARIS, { mulai: '2025-01-01', sampai: '2025-12-31' });
    expect(ak.totalMasuk).toBe(RP(19_500_000));
    expect(ak.totalKeluar).toBe(RP(9_000_000));
    expect(ak.kenaikan).toBe(RP(10_500_000));
    expect(ak.saldoAwal).toBe(0);
    expect(ak.saldoAkhir).toBe(RP(10_500_000));
    expect(ak.transfer).toMatchObject({
      masuk: RP(500_000),
      keluar: RP(500_000),
      neto: 0,
    });
    expect(ak.rows.filter((r) => r.kelompok === 'TRANSFER')).toHaveLength(2);
    expect(ak.rows.some((r) => r.no_bukti === 'JU-2025-010' && r.jurnal_id === 'j-010')).toBe(true);
  });
});

describe('AKT-17 — pinjaman 1050 diklasifikasikan sebagai INVESTASI', () => {
  const modalAwal = jurnal('akt17-modal', '2026-01-01', 'Modal awal', [
    ['1001', RP(10_000_000), 0],
    ['3000', 0, RP(10_000_000)],
  ]);

  it('beri pinjaman: kas keluar masuk kelompok INVESTASI, bukan OPERASI', () => {
    const baris = [
      ...modalAwal,
      ...jurnal('akt17-pinjam', '2026-02-01', 'Beri pinjaman', [
        ['1050', RP(1_000_000), 0],
        ['1001', 0, RP(1_000_000)],
      ]),
    ];
    const ak = arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });

    expect(ak.rows.find((r) => r.jurnal_id === 'akt17-pinjam')).toMatchObject({
      akun_kode: '1001',
      lawan: ['1050'],
      kelompok: 'INVESTASI',
      masuk: 0,
      keluar: RP(1_000_000),
    });
    expect(ak.investasi).toMatchObject({
      masuk: 0,
      keluar: RP(1_000_000),
      neto: RP(-1_000_000),
    });
    expect(ak.operasi.neto).toBe(0);

    // Klasifikasi baris tidak mengubah total kas.
    expect(ak.totalMasuk).toBe(RP(10_000_000));
    expect(ak.totalKeluar).toBe(RP(1_000_000));
    expect(ak.kenaikan).toBe(RP(9_000_000));
    expect(ak.saldoAwal).toBe(0);
    expect(ak.saldoAkhir).toBe(RP(9_000_000));
    expect(ak.saldoAkhir).toBe(totalKas(baris, undefined, '2026-12-31'));
  });

  it('terima pelunasan: kas masuk tetap kelompok INVESTASI', () => {
    const baris = [
      ...modalAwal,
      ...jurnal('akt17-pinjam', '2026-02-01', 'Beri pinjaman', [
        ['1050', RP(1_000_000), 0],
        ['1001', 0, RP(1_000_000)],
      ]),
      ...jurnal('akt17-lunas', '2026-03-01', 'Pelunasan pinjaman', [
        ['1001', RP(1_000_000), 0],
        ['1050', 0, RP(1_000_000)],
      ]),
    ];
    const ak = arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });

    expect(ak.rows.find((r) => r.jurnal_id === 'akt17-lunas')).toMatchObject({
      akun_kode: '1001',
      lawan: ['1050'],
      kelompok: 'INVESTASI',
      masuk: RP(1_000_000),
      keluar: 0,
    });
    expect(ak.investasi).toMatchObject({
      masuk: RP(1_000_000),
      keluar: RP(1_000_000),
      neto: 0,
    });
    expect(ak.operasi.neto).toBe(0);

    expect(ak.totalMasuk).toBe(RP(11_000_000));
    expect(ak.totalKeluar).toBe(RP(1_000_000));
    expect(ak.kenaikan).toBe(RP(10_000_000));
    expect(ak.saldoAwal).toBe(0);
    expect(ak.saldoAkhir).toBe(RP(10_000_000));
    expect(ak.saldoAkhir).toBe(totalKas(baris, undefined, '2026-12-31'));
  });

  it('panjar 1040 tetap OPERASI', () => {
    const baris = [
      ...modalAwal,
      ...jurnal('akt17-panjar', '2026-04-01', 'Serah panjar', [
        ['1040', RP(500_000), 0],
        ['1001', 0, RP(500_000)],
      ]),
    ];
    const ak = arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });

    expect(ak.rows.find((r) => r.jurnal_id === 'akt17-panjar')).toMatchObject({
      akun_kode: '1001',
      lawan: ['1040'],
      kelompok: 'OPERASI',
      masuk: 0,
      keluar: RP(500_000),
    });
    expect(ak.operasi).toMatchObject({
      masuk: 0,
      keluar: RP(500_000),
      neto: RP(-500_000),
    });
    expect(ak.investasi.neto).toBe(0);

    expect(ak.totalMasuk).toBe(RP(10_000_000));
    expect(ak.totalKeluar).toBe(RP(500_000));
    expect(ak.kenaikan).toBe(RP(9_500_000));
    expect(ak.saldoAwal).toBe(0);
    expect(ak.saldoAkhir).toBe(RP(9_500_000));
    expect(ak.saldoAkhir).toBe(totalKas(baris, undefined, '2026-12-31'));
  });
});

describe('P0-5 — dashboard dari jurnal', () => {
  it('kas tunai, total LPD, dan badge BALANCE dihitung dari baris jurnal', () => {
    const d = buildDashboardJurnal(BARIS, [{ tahun: 2025 }], '2026-12-31');
    expect(d.kasTunai).toBe(RP(3_500_000));
    expect(d.rincianLpd['1015']).toBe(RP(5_000_000));
    expect(d.totalLpd).toBe(RP(5_000_000));
    expect(d.aktiva).toBe(RP(12_500_000));
    expect(d.pasiva).toBe(RP(12_500_000));
    expect(d.selisih).toBe(0);
    expect(d.balance).toBe(true);
    expect(d.badge).toBe('BALANCE');
  });
});

describe('P0-5 — data kosong', () => {
  it('semua laporan aman dan Neraca Saldo tetap nol', () => {
    const ns = neracaSaldo([], '2026-12-31');
    expect(ns.totalDebit).toBe(0);
    expect(ns.totalKredit).toBe(0);
    expect(ns.selisih).toBe(0);
    expect(ns.seimbang).toBe(true);

    const n = neraca([], '2026-12-31');
    expect(n.totalAset).toBe(0);
    expect(n.totalPasiva).toBe(0);
    expect(n.balance).toBe(true);

    const lr = labaRugi([], { mulai: '2026-01-01', sampai: '2026-12-31' });
    expect(lr.laba).toBe(0);
    expect(lr.defisit).toBe(false);

    const ak = arusKas([], { mulai: '2026-01-01', sampai: '2026-12-31' });
    expect(ak.saldoAwal).toBe(0);
    expect(ak.saldoAkhir).toBe(0);
    expect(ak.rows).toEqual([]);
  });
});

describe('P0-5 — adapter DB (baris jurnal → laporan)', () => {
  it('listBarisJurnal membaca kepala + baris dan laporan tetap seimbang', () => {
    const db = freshDb();
    try {
      insertJurnal(
        db,
        { id: 'db-1', tanggal: '2026-01-01', no_bukti: 'JU-2026-0001', keterangan: 'Modal' },
        [
          { akun_kode: '1001', debit: RP(1_000_000), kredit: 0 },
          { akun_kode: '3000', debit: 0, kredit: RP(1_000_000) },
        ],
      );
      insertJurnal(
        db,
        { id: 'db-2', tanggal: '2026-02-01', no_bukti: 'JU-2026-0002', keterangan: 'Parkir' },
        [
          { akun_kode: '1001', debit: RP(500_000), kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(500_000) },
        ],
      );
      insertJurnal(
        db,
        { id: 'db-3', tanggal: '2026-03-01', no_bukti: 'JU-2026-0003', keterangan: 'Beban' },
        [
          { akun_kode: '5010', debit: RP(200_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(200_000) },
        ],
      );

      const baris = listBarisJurnal(db);
      expect(baris).toHaveLength(6);
      expect(baris[0]).toMatchObject({
        jurnal_id: 'db-1',
        baris_id: expect.any(Number),
        tanggal: '2026-01-01',
        no_bukti: 'JU-2026-0001',
        keterangan: 'Modal',
        akun_kode: '1001',
        debit: RP(1_000_000),
        kredit: 0,
      });
      expect(baris.map((b) => b.jurnal_id)).toEqual(['db-1', 'db-1', 'db-2', 'db-2', 'db-3', 'db-3']);

      const ns = neracaSaldo(baris, '2026-12-31');
      expect(ns.selisih).toBe(0);
      expect(ns.totalDebit).toBe(ns.totalKredit);
      expect(saldoAkun(baris, '1001', '2026-12-31')).toBe(RP(1_300_000));
      expect(labaRugi(baris, { mulai: '2026-01-01', sampai: '2026-12-31' }).laba).toBe(RP(300_000));
      expect(neraca(baris, '2026-12-31').balance).toBe(true);
      expect(arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' }).saldoAkhir).toBe(
        RP(1_300_000),
      );
    } finally {
      db.close();
    }
  });

  it('filter listBarisJurnal per tanggal/akun/jurnal', () => {
    const db = freshDb();
    try {
      insertJurnal(
        db,
        { id: 'f-1', tanggal: '2026-01-01', keterangan: 'Satu' },
        [
          { akun_kode: '1001', debit: 100, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 100 },
        ],
      );
      insertJurnal(
        db,
        { id: 'f-2', tanggal: '2026-02-01', keterangan: 'Dua' },
        [
          { akun_kode: '1029', debit: 200, kredit: 0 },
          { akun_kode: '4001', debit: 0, kredit: 200 },
        ],
      );
      expect(listBarisJurnal(db, { mulai: '2026-02-01' }).map((b) => b.jurnal_id)).toEqual([
        'f-2',
        'f-2',
      ]);
      expect(listBarisJurnal(db, { akun_kode: '1001' }).map((b) => b.jurnal_id)).toEqual(['f-1']);
      expect(listBarisJurnal(db, { jurnal_id: 'f-2' })).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

// P2-1: layar anggaran memakai mesin laporan yang sama; totalnya tidak boleh
// berbeda dari labaRugi() untuk dataset jurnal yang sama.
describe('P2-1 — realisasi anggaran konsisten dengan labaRugi', () => {
  it('total pendapatan/beban sama dengan labaRugi periode', () => {
    const rentang = { mulai: '2026-01-01', sampai: '2026-12-31' };
    const lr = labaRugi(BARIS, rentang);
    const hasil = hitungRealisasiAnggaran(
      [
        { tahun: 2026, akun_kode: '4005', nominal: RP(1_000_000) },
        { tahun: 2026, akun_kode: '5010', nominal: RP(100_000) },
      ],
      BARIS,
      rentang,
    );

    expect(hasil.totalPendapatan.realisasi).toBe(lr.totalPendapatan);
    expect(hasil.totalBeban.realisasi).toBe(lr.totalBeban);
    expect(hasil.total.realisasi).toBe(lr.totalPendapatan + lr.totalBeban);
    expect(hasil.pendapatan.find((b) => b.kode === '4005')?.realisasi).toBe(RP(700_000));
    expect(hasil.beban.find((b) => b.kode === '5010')?.realisasi).toBe(RP(200_000));
  });
});
