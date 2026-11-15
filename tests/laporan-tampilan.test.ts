// P1-9: layar Laba Rugi, Neraca, dan Arus Kas.
// Fokus: adapter DB hanya mengambil baris jurnal lalu menyerahkan seluruh
// perhitungan ke core/reports.ts (bukan rumus baru), Neraca memakai daftar
// tutup buku, Arus Kas konsisten (saldo awal + penyesuaian + kenaikan) dan
// transfer antar dompet tidak dihitung dua kali, drill-down jurnal benar,
// serta validasi tanggal/helper tampilan.

import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/database.js';
import {
  insertJurnalTervalidasi,
  insertTutupBuku,
  listTutupBuku,
} from '../src/db/repository.js';
import {
  laporanArusKas,
  laporanDetailJurnal,
  laporanJurnalAkun,
  laporanLabaRugi,
  laporanNeraca,
  laporanNeracaSaldo,
  listBarisJurnal,
} from '../src/db/laporan.js';
import { seedDev } from '../src/db/seed-dev.js';
import { arusKas, labaRugi, neraca, totalKas } from '../src/core/reports.js';
import type { JurnalBarisInput } from '../src/core/types.js';
import {
  validasiFilterNeraca,
  validasiRentangLaporan,
} from '../src/main/validation.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../src/utils/pesanError.js';
import {
  badgeLabaRugi,
  badgeNeracaSaldo,
  labelKelompokArusKas,
} from '../src/renderer/lib/tampilanLaporan.js';
import { formatRp } from '../src/utils/format.js';

const RP = (rupiah: number): number => rupiah * 100;

type BarisRingkas = [akun: string, debit: number, kredit: number];

const dbs: Database.Database[] = [];

function freshDb(): Database.Database {
  const db = openDb(':memory:');
  dbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
});

function catat(
  db: Database.Database,
  id: string,
  tanggal: string,
  baris: BarisRingkas[],
): void {
  insertJurnalTervalidasi(
    db,
    {
      id,
      tanggal,
      no_bukti: `JU-${id}`,
      keterangan: `Uji ${id}`,
    },
    baris.map(
      ([akun_kode, debit, kredit]): JurnalBarisInput => ({
        akun_kode,
        debit,
        kredit,
      }),
    ),
  );
}

/**
 * Dataset contoh: modal 100jt (2025), pendapatan/beban 2025, lalu aktivitas
 * 2026 termasuk transfer antar dompet, pinjaman, dan pembayaran hutang.
 */
function isiContoh(db: Database.Database): void {
  catat(db, 'm-1', '2025-01-01', [
    ['1001', RP(100_000_000), 0],
    ['3000', 0, RP(100_000_000)],
  ]);
  catat(db, 'r-1', '2025-03-01', [
    ['1001', RP(10_000_000), 0],
    ['4005', 0, RP(10_000_000)],
  ]);
  catat(db, 'e-1', '2025-04-01', [
    ['5000', RP(4_000_000), 0],
    ['1001', 0, RP(4_000_000)],
  ]);
  catat(db, 'r-2', '2026-01-15', [
    ['1001', RP(2_000_000), 0],
    ['4005', 0, RP(2_000_000)],
  ]);
  catat(db, 'e-2', '2026-02-01', [
    ['5010', RP(500_000), 0],
    ['1001', 0, RP(500_000)],
  ]);
  catat(db, 't-1', '2026-02-10', [
    ['1029', RP(1_000_000), 0],
    ['1001', 0, RP(1_000_000)],
  ]);
  catat(db, 'h-1', '2026-03-01', [
    ['1029', RP(3_000_000), 0],
    ['2050', 0, RP(3_000_000)],
  ]);
  catat(db, 'h-2', '2026-03-10', [
    ['2050', RP(1_000_000), 0],
    ['1029', 0, RP(1_000_000)],
  ]);
}

describe('P1-9 — adapter Laba Rugi sama persis dengan core/reports', () => {
  it('memakai labaRugi murni untuk dataset jurnal manual', () => {
    const db = freshDb();
    isiContoh(db);
    const baris = listBarisJurnal(db);
    const rentang = { mulai: '2026-01-01', sampai: '2026-12-31' };

    const lewatAdapter = laporanLabaRugi(db, rentang);
    const langsungCore = labaRugi(baris, rentang);

    expect(lewatAdapter).toEqual(langsungCore);
    expect(lewatAdapter.totalPendapatan).toBe(RP(2_000_000));
    expect(lewatAdapter.totalBeban).toBe(RP(500_000));
    expect(lewatAdapter.laba).toBe(RP(1_500_000));
    expect(lewatAdapter.labaBersih).toBe(lewatAdapter.laba);
    expect(lewatAdapter.defisit).toBe(false);
    expect(lewatAdapter.pendapatan.find((b) => b.kode === '4005')?.nominal).toBe(
      RP(2_000_000),
    );
    expect(lewatAdapter.beban.find((b) => b.kode === '5010')?.nominal).toBe(
      RP(500_000),
    );
  });

  it('defisit tetap negatif dan diformat dalam kurung oleh helper Rupiah', () => {
    const db = freshDb();
    isiContoh(db);
    const hasil = laporanLabaRugi(db, {
      mulai: '2025-01-01',
      sampai: '2025-12-31',
    });
    // 2025: pendapatan 10jt − beban 4jt = laba 6jt (bukan defisit).
    expect(hasil.laba).toBe(RP(6_000_000));
    expect(hasil.defisit).toBe(false);

    const defisit = laporanLabaRugi(db, {
      mulai: '2026-02-01',
      sampai: '2026-12-31',
    });
    // Februari–Desember 2026: pendapatan Januari tidak ikut, beban 500rb ikut.
    expect(defisit.laba).toBe(RP(-500_000));
    expect(defisit.defisit).toBe(true);
    expect(formatRp(defisit.laba)).toBe('(Rp 500.000)');

    // Format kurung diuji langsung pada nominal negatif (kontrak formatRp).
    expect(formatRp(RP(-1_500_000))).toBe('(Rp 1.500.000)');
  });
});

describe('P1-9 — adapter Neraca memakai daftar tutup buku', () => {
  it('laba ditahan + laba berjalan konsisten dan Neraca seimbang', () => {
    const db = freshDb();
    isiContoh(db);
    const baris = listBarisJurnal(db);
    const cutoff = '2026-12-31';

    // Sebelum tutup 2025: laba 2025 masih "belum ditutup".
    const sebelum = laporanNeraca(db, cutoff);
    expect(sebelum.labaDitahan).toBe(0);
    expect(sebelum.labaBelumDitutup).toBe(RP(6_000_000));
    expect(sebelum.labaBerjalan).toBe(RP(1_500_000));
    expect(sebelum.balance).toBe(true);

    insertTutupBuku(db, {
      tahun: 2025,
      created_at: '2026-01-01T00:00:00.000Z',
      catatan: 'Sudah diperiksa',
    });

    const sesudah = laporanNeraca(db, cutoff);
    const core = neraca(baris, {
      cutoff,
      tutup: listTutupBuku(db),
    });

    expect(sesudah).toEqual(core);
    expect(sesudah.labaDitahan).toBe(RP(6_000_000));
    expect(sesudah.labaBelumDitutup).toBe(0);
    expect(sesudah.labaBerjalan).toBe(RP(1_500_000));
    expect(sesudah.totalAset).toBe(RP(109_500_000));
    expect(sesudah.totalKewajiban).toBe(RP(2_000_000));
    expect(sesudah.totalEkuitas).toBe(RP(107_500_000));
    expect(sesudah.totalEkuitas).toBe(
      sesudah.totalEkuitasAkun +
        sesudah.labaDitahan +
        sesudah.labaBelumDitutup +
        sesudah.labaBerjalan,
    );
    expect(sesudah.totalPasiva).toBe(RP(109_500_000));
    expect(sesudah.selisih).toBe(0);
    expect(sesudah.balance).toBe(true);

    // Badge layar memakai Neraca Saldo dari mesin laporan yang sama.
    const ns = laporanNeracaSaldo(db, cutoff, 'kumulatif');
    expect(ns.seimbang).toBe(true);
    expect(badgeNeracaSaldo(ns)).toEqual({
      tone: 'green',
      label: 'Pembukuan seimbang',
    });
  });
});

describe('P1-9 — adapter Arus Kas & drill-down jurnal', () => {
  it('saldo akhir = saldo awal + penyesuaian pembukaan + kenaikan dan transfer tidak menambah arus', () => {
    const db = freshDb();
    isiContoh(db);
    const baris = listBarisJurnal(db);
    const rentang = { mulai: '2026-01-01', sampai: '2026-12-31' };

    const ak = laporanArusKas(db, rentang);
    expect(ak).toEqual(arusKas(baris, rentang));

    expect(ak.saldoAwal).toBe(RP(106_000_000));
    expect(ak.totalMasuk).toBe(RP(5_000_000));
    expect(ak.totalKeluar).toBe(RP(1_500_000));
    expect(ak.kenaikan).toBe(RP(3_500_000));
    expect(ak.saldoAkhir).toBe(
      ak.saldoAwal + ak.penyesuaianSaldoAwal + ak.kenaikan,
    );
    expect(ak.saldoAkhir).toBe(RP(109_500_000));
    expect(ak.saldoAkhir).toBe(totalKas(baris, undefined, '2026-12-31'));

    // Transfer antar kas neto 0 dan tidak masuk total masuk/keluar.
    expect(ak.transfer).toMatchObject({
      masuk: RP(1_000_000),
      keluar: RP(1_000_000),
      neto: 0,
    });
    expect(ak.totalMasuk).toBe(
      ak.operasi.masuk + ak.investasi.masuk + ak.pendanaan.masuk,
    );
    expect(ak.operasi.neto).toBe(RP(1_500_000));
    expect(ak.pendanaan.neto).toBe(RP(2_000_000));
    expect(ak.rows.filter((r) => r.kelompok === 'TRANSFER')).toHaveLength(2);
    expect(
      ak.rows.find((r) => r.jurnal_id === 't-1' && r.akun_kode === '1029'),
    ).toMatchObject({
      lawan: ['1001'],
      masuk: RP(1_000_000),
      keluar: 0,
      kelompok: 'TRANSFER',
    });
  });

  it('drill-down akun mengembalikan jurnal periode yang benar + detail lengkap', () => {
    const db = freshDb();
    isiContoh(db);

    const pendapatan = laporanJurnalAkun(db, '4005', {
      mulai: '2026-01-01',
      sampai: '2026-12-31',
    });
    expect(pendapatan.map((j) => j.id)).toEqual(['r-2']);
    expect(pendapatan[0]!.baris.some((b) => b.akun_kode === '4005')).toBe(true);

    const kas2026 = laporanJurnalAkun(db, '1001', {
      mulai: '2026-01-01',
      sampai: '2026-12-31',
    });
    expect(kas2026.map((j) => j.id)).toEqual(['r-2', 'e-2', 't-1']);
    expect(kas2026.some((j) => j.id === 'r-1' || j.id === 'e-1')).toBe(false);

    const detail = laporanDetailJurnal(db, 'r-2');
    expect(detail).not.toBeNull();
    expect(detail!.baris.map((b) => b.akun_kode)).toEqual(['1001', '4005']);
    expect(detail!.total_debit).toBe(RP(2_000_000));
  });

  it('dataset seedDev juga memakai mesin laporan yang sama', () => {
    const db = freshDb();
    expect(seedDev(db)).toBeGreaterThan(0);
    const baris = listBarisJurnal(db);
    const rentang = { mulai: '2026-01-01', sampai: '2026-06-30' };

    expect(laporanLabaRugi(db, rentang)).toEqual(labaRugi(baris, rentang));
    expect(laporanNeraca(db, '2026-12-31')).toEqual(
      neraca(baris, { cutoff: '2026-12-31', tutup: listTutupBuku(db) }),
    );
    expect(laporanArusKas(db, rentang)).toEqual(arusKas(baris, rentang));
  });
});

describe('P1-9 — validasi tanggal laporan', () => {
  it('menolak tanggal yang tidak ada di kalender dengan pesan Indonesia', () => {
    const mulai = validasiRentangLaporan({ mulai: '2026-02-31' });
    expect(mulai.ok).toBe(false);
    if (!mulai.ok) expect(mulai.error).toBe(PESAN_TANGGAL_TIDAK_VALID);

    const sampai = validasiRentangLaporan({ sampai: '2026-13-01' });
    expect(sampai.ok).toBe(false);
    if (!sampai.ok) expect(sampai.error).toBe(PESAN_TANGGAL_TIDAK_VALID);

    const neraca = validasiFilterNeraca({ cutoff: '2026-04-31' });
    expect(neraca.ok).toBe(false);
    if (!neraca.ok) expect(neraca.error).toBe(PESAN_TANGGAL_TIDAK_VALID);
  });

  it('menerima rentang kosong/valid dan menolak rentang terbalik', () => {
    expect(validasiRentangLaporan({})).toEqual({ ok: true, input: {} });
    expect(
      validasiRentangLaporan({
        mulai: '2028-02-29',
        sampai: '2028-03-01',
      }),
    ).toEqual({
      ok: true,
      input: { mulai: '2028-02-29', sampai: '2028-03-01' },
    });

    const terbalik = validasiRentangLaporan({
      mulai: '2026-12-31',
      sampai: '2026-01-01',
    });
    expect(terbalik.ok).toBe(false);
    if (!terbalik.ok)
      expect(terbalik.error).toContain('tidak boleh setelah tanggal sampai');

    expect(validasiFilterNeraca({})).toMatchObject({
      ok: false,
      error: 'Tanggal laporan wajib diisi.',
    });
    expect(validasiFilterNeraca({ cutoff: '2028-02-29' })).toEqual({
      ok: true,
      input: { cutoff: '2028-02-29' },
    });
  });
});

describe('P1-9 — helper tampilan laporan', () => {
  it('label kelompok Arus Kas memakai bahasa Indonesia', () => {
    expect(labelKelompokArusKas('OPERASI')).toBe('Operasi');
    expect(labelKelompokArusKas('INVESTASI')).toBe('Investasi');
    expect(labelKelompokArusKas('PENDANAAN')).toBe('Pendanaan');
    expect(labelKelompokArusKas('TRANSFER')).toBe('Transfer');
  });

  it('badge Neraca Saldo menampilkan seimbang atau selisih nominal', () => {
    expect(badgeNeracaSaldo({ seimbang: true, selisih: 0 })).toEqual({
      tone: 'green',
      label: 'Pembukuan seimbang',
    });

    const selisih = badgeNeracaSaldo({ seimbang: false, selisih: RP(1_500_000) });
    expect(selisih.tone).toBe('red');
    expect(selisih.label).toContain('Ada selisih');
    expect(selisih.label).toContain(formatRp(RP(1_500_000)));
  });

  it('badge Laba Rugi SURPLUS/DEFISIT sesuai tanda laba', () => {
    expect(badgeLabaRugi(false)).toEqual({ tone: 'green', label: 'SURPLUS' });
    expect(badgeLabaRugi(true)).toEqual({ tone: 'red', label: 'DEFISIT' });
  });
});
