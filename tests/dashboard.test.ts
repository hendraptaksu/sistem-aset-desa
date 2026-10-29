// P1-14 — dashboard akuntan: semua angka turunan dari jurnal (core/reports.ts).
// Tanpa jsdom/Electron; DB kosong memakai SQLite in-memory.
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { listTutupBuku } from '../src/db/repository.js';
import {
  buildDashboardJurnal,
  denganBackupTerakhir,
  rentangLabaBerjalan,
} from '../src/features/dashboard/dashboard.js';
import {
  labaRugi,
  neracaSaldo,
  totalKas,
  type BarisJurnalSumber,
} from '../src/core/reports.js';

const RP = (rupiah: number): number => rupiah * 100;
const CUTOFF = '2026-06-30';

type BarisRingkas = [akun: string, debit: number, kredit: number];

function jurnal(
  id: string,
  tanggal: string,
  noBukti: string,
  keterangan: string,
  jenis: BarisJurnalSumber['jenis'],
  baris: BarisRingkas[],
): BarisJurnalSumber[] {
  return baris.map(([akun_kode, debit, kredit], i) => ({
    jurnal_id: id,
    baris_id: i + 1,
    tanggal,
    no_bukti: noBukti,
    keterangan,
    jenis,
    akun_kode,
    debit,
    kredit,
  }));
}

// 2025: modal 10jt, pendapatan parkir 5jt + sesari 2jt, beban upakara 2jt,
// pindah dana 1jt. Tutup 2025 → laba 5jt.
// 2026 s/d 30 Jun: pendapatan parkir 3jt + kios 2jt, beban listrik 1jt,
// administrasi 300rb, lain-lain 200rb → laba 3,5jt. Jurnal Juli di luar cutoff.
const BARIS: BarisJurnalSumber[] = [
  ...jurnal('j-2025-01', '2025-01-01', 'JU-2025-0001', 'Saldo awal', 'SALDO_AWAL', [
    ['1001', RP(10_000_000), 0],
    ['3000', 0, RP(10_000_000)],
  ]),
  ...jurnal('j-2025-02', '2025-03-01', 'JU-2025-0002', 'Pendapatan parkir', 'TERIMA', [
    ['1001', RP(5_000_000), 0],
    ['4005', 0, RP(5_000_000)],
  ]),
  ...jurnal('j-2025-03', '2025-06-01', 'JU-2025-0003', 'Beban upakara', 'BAYAR', [
    ['5004', RP(2_000_000), 0],
    ['1001', 0, RP(2_000_000)],
  ]),
  ...jurnal('j-2025-04', '2025-12-15', 'JU-2025-0004', 'Pendapatan sesari', 'TERIMA', [
    ['1001', RP(2_000_000), 0],
    ['4041', 0, RP(2_000_000)],
  ]),
  ...jurnal('j-2025-05', '2025-12-31', 'JU-2025-0005', 'Pindah dana ke bank', 'TRANSFER', [
    ['1029', RP(1_000_000), 0],
    ['1001', 0, RP(1_000_000)],
  ]),
  ...jurnal('j-2026-01', '2026-01-10', 'JU-2026-0001', 'Pendapatan parkir', 'TERIMA', [
    ['1001', RP(3_000_000), 0],
    ['4005', 0, RP(3_000_000)],
  ]),
  ...jurnal('j-2026-02', '2026-02-05', 'JU-2026-0002', 'Bayar listrik', 'BAYAR', [
    ['5010', RP(1_000_000), 0],
    ['1001', 0, RP(1_000_000)],
  ]),
  ...jurnal('j-2026-03', '2026-03-01', 'JU-2026-0003', 'Pendapatan kios', 'TERIMA', [
    ['1010', RP(2_000_000), 0],
    ['4003', 0, RP(2_000_000)],
  ]),
  // Dua jurnal di tanggal yang sama: yang input terakhir harus dipilih.
  ...jurnal('j-2026-04', '2026-05-01', 'JU-2026-0004', 'Beban administrasi', 'BAYAR', [
    ['5040', RP(300_000), 0],
    ['1001', 0, RP(300_000)],
  ]),
  ...jurnal('j-2026-05', '2026-05-01', 'JU-2026-0005', 'Beban lain-lain', 'BAYAR', [
    ['5050', RP(200_000), 0],
    ['1001', 0, RP(200_000)],
  ]),
  // Setelah cutoff: tidak boleh memengaruhi dashboard.
  ...jurnal('j-2026-06', '2026-07-01', 'JU-2026-0006', 'Pendapatan setelah cutoff', 'TERIMA', [
    ['1001', RP(9_000_000), 0],
    ['4005', 0, RP(9_000_000)],
  ]),
];

const TUTUP = [{ tahun: 2025 }];

describe('P1-14 — dashboard akuntan dari jurnal', () => {
  it('kas/bank, laba berjalan, dan neraca saldo sama dengan mesin laporan', () => {
    const d = buildDashboardJurnal(BARIS, TUTUP, CUTOFF, { sekarang: CUTOFF });

    // Manual: 1001 15,5jt + 1010 2jt + 1029 1jt = 18,5jt.
    expect(d.kasBank.total).toBe(RP(18_500_000));
    expect(d.kasBank.total).toBe(totalKas(BARIS, undefined, CUTOFF));
    expect(d.kasTunai).toBe(RP(15_500_000));
    expect(d.kasBank.rincian.find((a) => a.kode === '1001')).toEqual({
      kode: '1001',
      nama: 'KAS',
      saldo: RP(15_500_000),
    });
    expect(d.kasBank.rincian.find((a) => a.kode === '1010')?.saldo).toBe(RP(2_000_000));
    expect(d.kasBank.rincian.find((a) => a.kode === '1029')?.saldo).toBe(RP(1_000_000));

    // Laba 2026: pendapatan 5jt − beban 1,5jt = 3,5jt.
    expect(d.labaRugiBerjalan.mulai).toBe('2026-01-01');
    expect(d.labaRugiBerjalan.sampai).toBe(CUTOFF);
    expect(d.labaRugiBerjalan.totalPendapatan).toBe(RP(5_000_000));
    expect(d.labaRugiBerjalan.totalBeban).toBe(RP(1_500_000));
    expect(d.labaRugiBerjalan.laba).toBe(RP(3_500_000));
    expect(d.labaRugiBerjalan.defisit).toBe(false);
    expect(d.labaRugiBerjalan.badge).toBe('SURPLUS');
    expect(d.labaRugiBerjalan.laba).toBe(
      labaRugi(BARIS, { mulai: '2026-01-01', sampai: CUTOFF }).laba,
    );

    // Neraca Saldo selalu seimbang: total debit = kredit = 22jt.
    expect(d.neracaSaldo).toEqual({
      totalDebit: RP(22_000_000),
      totalKredit: RP(22_000_000),
      selisih: 0,
      seimbang: true,
    });
    expect(d.neracaSaldo.selisih).toBe(neracaSaldo(BARIS, CUTOFF).selisih);
    expect(d.selisih).toBe(d.neracaSaldo.selisih);
    expect(d.balance).toBe(true);
    expect(d.badge).toBe('BALANCE');

    // Field lama tetap konsisten dengan Neraca mesin laporan.
    expect(d.aktiva).toBe(RP(18_500_000));
    expect(d.pasiva).toBe(RP(18_500_000));
    expect(d.totalLpd).toBe(RP(2_000_000));
  });

  it('periode menampilkan 2025 terkunci & 2026 terbuka', () => {
    const d = buildDashboardJurnal(BARIS, TUTUP, CUTOFF, { sekarang: CUTOFF });
    expect(d.periode.tahunTerakhirDitutup).toBe(2025);
    expect(d.periode.tahunTerkunci).toEqual([2025]);
    expect(d.periode.tahunBerjalan).toBe(2026);
    expect(d.periode.status).toBe('2025 terkunci · 2026 terbuka');
    expect(d.periode.batasTahun).toBe(2025);
  });

  it('cut-off historis yang terkunci tidak tampil terbuka pada tahun yang sama', () => {
    const d = buildDashboardJurnal(BARIS, TUTUP, '2025-12-31', {
      sekarang: '2026-10-29',
    });
    expect(d.periode.tahunBerjalan).toBe(2026);
    expect(d.periode.status).toBe('2025 terkunci · 2026 terbuka');
    expect(d.periode.status).not.toContain('2025 terbuka');
    expect(d.periode.batasTahun).toBe(2025);
  });

  it('status terbuka melewati tahun acuan yang sudah terkunci', () => {
    const d = buildDashboardJurnal(BARIS, [{ tahun: 2025 }, { tahun: 2026 }], CUTOFF, {
      sekarang: '2026-10-29',
    });
    expect(d.periode.tahunBerjalan).toBe(2027);
    expect(d.periode.status).toBe('2025, 2026 terkunci · 2027 terbuka');
  });

  it('jurnal terakhir = tanggal terbaru; tanggal sama pakai input terakhir', () => {
    const d = buildDashboardJurnal(BARIS, TUTUP, CUTOFF, { sekarang: CUTOFF });
    expect(d.jurnalTerakhir).toEqual({
      id: 'j-2026-05',
      tanggal: '2026-05-01',
      noBukti: 'JU-2026-0005',
      keterangan: 'Beban lain-lain',
      total: RP(200_000),
      jenis: 'BAYAR',
    });
  });

  it('awal tahun buku Desember mengubah rentang & angka laba berjalan', () => {
    const desember = buildDashboardJurnal(BARIS, TUTUP, CUTOFF, {
      awalTahunBuku: 12,
      sekarang: CUTOFF,
    });
    expect(desember.labaRugiBerjalan.mulai).toBe('2025-12-01');
    expect(desember.labaRugiBerjalan.sampai).toBe(CUTOFF);
    expect(desember.labaRugiBerjalan.tahunBuku).toBe(2025);
    expect(desember.labaRugiBerjalan.awalTahunBuku).toBe(12);
    expect(desember.labaRugiBerjalan.labelPeriode).toBe('1 Des 2025 – 30 Jun 2026');
    // Pendapatan Des 2025 (2jt) ikut; beban Juni 2025 tidak ikut.
    expect(desember.labaRugiBerjalan.totalPendapatan).toBe(RP(7_000_000));
    expect(desember.labaRugiBerjalan.totalBeban).toBe(RP(1_500_000));
    expect(desember.labaRugiBerjalan.laba).toBe(RP(5_500_000));
    expect(desember.labaRugiBerjalan.laba).toBe(
      labaRugi(BARIS, { mulai: '2025-12-01', sampai: CUTOFF }).laba,
    );

    expect(rentangLabaBerjalan(CUTOFF, 12)).toMatchObject({
      mulai: '2025-12-01',
      sampai: CUTOFF,
      tahunBuku: 2025,
    });
  });

  it('DB kosong: nol, seimbang, tidak error', () => {
    const db = openDb(':memory:');
    try {
      const d = buildDashboardJurnal(listBarisJurnal(db), listTutupBuku(db), '2026-10-23', {
        sekarang: '2026-10-23',
      });
      expect(d.kasBank.total).toBe(0);
      expect(d.kasTunai).toBe(0);
      expect(d.labaRugiBerjalan.laba).toBe(0);
      expect(d.labaRugiBerjalan.defisit).toBe(false);
      expect(d.neracaSaldo).toEqual({
        totalDebit: 0,
        totalKredit: 0,
        selisih: 0,
        seimbang: true,
      });
      expect(d.aktiva).toBe(0);
      expect(d.pasiva).toBe(0);
      expect(d.balance).toBe(true);
      expect(d.badge).toBe('BALANCE');
      expect(d.jurnalTerakhir).toBeNull();
      expect(d.periode.status).toBe('Belum ada periode terkunci · 2026 terbuka');
    } finally {
      db.close();
    }
  });

  it('path backup terakhir ditempelkan main tanpa mengubah hasil builder', () => {
    const dasar = buildDashboardJurnal(BARIS, TUTUP, CUTOFF, { sekarang: CUTOFF });
    const path = '/data/backups/auto-2026-10-23.db';
    const hasil = denganBackupTerakhir(dasar, path);
    expect(hasil.backupTerakhir).toBe(path);
    expect(dasar.backupTerakhir).toBeUndefined();
    expect(hasil.labaRugiBerjalan.laba).toBe(dasar.labaRugiBerjalan.laba);
  });
});
