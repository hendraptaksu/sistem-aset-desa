// DB-16e — kartu hutang / mutasi bulanan pinjaman LPD.
//
// Fokus:
// - saldo awal/akhir pokok per bulan berantai dan turunan dari jurnal;
// - pokok = penurunan 2050, bunga = beban bunga, denda = beban denda,
//   kas keluar = kredit kas pada jurnal yang ditautkan `pinjaman_bayar`;
// - jadwal vs realisasi per angsuran + drill-down jurnal;
// - filter bulan/rentang dan periode kosong;
// - tidak ada total bulanan/saldo yang disimpan di tabel pembayaran;
// - validasi IPC/API/UI/dokumen tersedia.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import {
  bayarAngsuranPinjaman,
  getPinjaman,
  laporanMutasiPinjaman,
  simpanPinjamanLpd,
} from '../src/db/pinjaman.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { listAkun } from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { saldoAkun } from '../src/core/reports.js';
import { periodeMutasiPinjaman } from '../src/core/pinjamanMutasi.js';
import { validasiBentukPinjamanMutasi } from '../src/main/validation.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const RP = (rupiah: number): number => rupiah * 100;
const D = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: nominal,
  kredit: 0,
});
const K = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: 0,
  kredit: nominal,
});

const dbTerbuka: Database.Database[] = [];

afterEach(() => {
  for (const db of dbTerbuka.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup */
    }
  }
});

type Fixture = {
  db: Database.Database;
  pinjamanId: string;
  total: number;
};

/**
 * Pinjaman pencairan Rp 12 juta, 4 angsuran pokok Rp 3 juta + bunga Rp 100
 * ribu. Pembayaran lintas bulan:
 * - Feb: pokok 3 juta, bunga 100 ribu, denda 50 ribu
 * - Mar: pokok 2,5 juta, bunga 150 ribu (selisih, dikonfirmasi)
 * - Apr: pokok 3 juta, bunga 100 ribu, denda 25 ribu
 * - Mei: belum dibayar
 */
function siapkanFixture(): Fixture {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  const awal = postingJurnal(db, {
    header: {
      id: 'awal-16e',
      tanggal: '2026-01-01',
      no_bukti: 'SA-16E',
      keterangan: 'Saldo awal uji mutasi pinjaman',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', RP(200_000_000)), K(AKUN_MODAL, RP(200_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

  const total = RP(12_000_000);
  const jadwal = [1, 2, 3, 4].map((ke) => ({
    ke,
    jatuh_tempo: `2026-${String(ke + 1).padStart(2, '0')}-01`,
    pokok: RP(3_000_000),
    bunga: RP(100_000),
    catatan: `Angsuran ${ke}`,
  }));
  const simpan = simpanPinjamanLpd(db, {
    id: 'pjr-16e',
    mode: 'PENCAIRAN',
    kreditur: 'LPD Desa Adat',
    tanggal: '2026-01-02',
    akunKas: '1014',
    akunBunga: '5063',
    pokok: total,
    tenor: 4,
    catatan: 'Pinjaman uji DB-16e',
    angsuran: jadwal,
  });
  expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);
  const pinjamanId = simpan.pinjaman!.id;
  const angsuran = simpan.pinjaman!.angsuran ?? [];
  expect(angsuran).toHaveLength(4);

  const bayar = (
    ke: number,
    tanggal: string,
    pokok: number,
    bunga: number,
    denda: number,
    noBukti: string,
    opsi: { konfirmasiSelisih?: boolean; alasanSelisih?: string } = {},
  ): void => {
    const a = angsuran.find((x) => x.ke === ke)!;
    const hasil = bayarAngsuranPinjaman(
      db,
      {
        id: `pby-${ke}`,
        jurnal_id: `j-bayar-${ke}`,
        pinjaman_id: pinjamanId,
        angsuran_id: a.id,
        tanggal,
        akun_kas: '1014',
        pokok,
        bunga,
        denda,
        noBukti,
        catatan: `Realisasi angsuran ${ke}`,
      },
      opsi,
    );
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  };

  bayar(1, '2026-02-05', RP(3_000_000), RP(100_000), RP(50_000), 'B-1');
  bayar(2, '2026-03-05', RP(2_500_000), RP(150_000), 0, 'B-2', {
    konfirmasiSelisih: true,
    alasanSelisih: 'kesepakatan ulang dengan LPD',
  });
  bayar(3, '2026-04-05', RP(3_000_000), RP(100_000), RP(25_000), 'B-3');

  return { db, pinjamanId, total };
}

describe('DB-16e — mutasi bulanan dari jurnal', () => {
  it('menampilkan mutasi lintas bulan dengan saldo awal/akhir berantai', () => {
    const { db, pinjamanId, total } = siapkanFixture();
    const laporan = laporanMutasiPinjaman(db, pinjamanId, {
      sekarang: '2026-10-23',
    });

    expect(laporan.periode).toMatchObject({
      mode: 'tahun',
      mulai: '2026-01-01',
      sampai: '2026-12-31',
      label: 'Tahun 2026',
    });
    expect(laporan.bulanan).toHaveLength(12);
    expect(laporan.bulanan.map((b) => b.bulan)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
      '2026-11',
      '2026-12',
    ]);

    expect(laporan.bulanan[0]).toMatchObject({
      bulan: '2026-01',
      saldo_awal: total,
      pokok: 0,
      saldo_akhir: total,
    });
    expect(laporan.bulanan[1]).toMatchObject({
      bulan: '2026-02',
      saldo_awal: total,
      pokok: RP(3_000_000),
      bunga: RP(100_000),
      denda: RP(50_000),
      kas_keluar: RP(3_150_000),
      saldo_akhir: RP(9_000_000),
    });
    expect(laporan.bulanan[2]).toMatchObject({
      bulan: '2026-03',
      saldo_awal: RP(9_000_000),
      pokok: RP(2_500_000),
      bunga: RP(150_000),
      denda: 0,
      kas_keluar: RP(2_650_000),
      saldo_akhir: RP(6_500_000),
    });
    expect(laporan.bulanan[3]).toMatchObject({
      bulan: '2026-04',
      saldo_awal: RP(6_500_000),
      pokok: RP(3_000_000),
      bunga: RP(100_000),
      denda: RP(25_000),
      kas_keluar: RP(3_125_000),
      saldo_akhir: RP(3_500_000),
    });
    expect(laporan.bulanan[4]).toMatchObject({
      bulan: '2026-05',
      saldo_awal: RP(3_500_000),
      pokok: 0,
      saldo_akhir: RP(3_500_000),
    });

    for (let i = 1; i < laporan.bulanan.length; i += 1) {
      expect(laporan.bulanan[i].saldo_awal, laporan.bulanan[i].bulan).toBe(
        laporan.bulanan[i - 1].saldo_akhir,
      );
    }

    expect(laporan.saldo_awal_periode).toBe(total);
    expect(laporan.total_pokok).toBe(RP(8_500_000));
    expect(laporan.total_bunga).toBe(RP(350_000));
    expect(laporan.total_denda).toBe(RP(75_000));
    expect(laporan.total_kas_keluar).toBe(RP(8_925_000));
    expect(laporan.saldo_akhir_periode).toBe(RP(3_500_000));
    expect(laporan.outstanding).toBe(getPinjaman(db, pinjamanId)?.outstanding);
    expect(laporan.bulanan[1].jurnal_ids).toEqual(['j-bayar-1']);
    expect(laporan.bulanan[2].pembayaran[0]).toMatchObject({
      jurnal_id: 'j-bayar-2',
      tanggal: '2026-03-05',
      tanggal_bayar: '2026-03-05',
      no_bukti: 'B-2',
      pokok: RP(2_500_000),
      bunga: RP(150_000),
      denda: 0,
      kas_keluar: RP(2_650_000),
    });
  });

  it('mencocokkan total pokok/bunga/denda/kas dengan jurnal dan COA', () => {
    const { db, pinjamanId, total } = siapkanFixture();
    const laporan = laporanMutasiPinjaman(db, pinjamanId, {
      sekarang: '2026-10-23',
    });
    const baris = listBarisJurnal(db);
    const daftarAkun = listAkun(db);

    // 2050: kredit pencairan 12 juta - debit pokok 8,5 juta = outstanding.
    expect(saldoAkun(baris, '2050', undefined, daftarAkun)).toBe(
      laporan.outstanding,
    );
    expect(total - saldoAkun(baris, '2050', undefined, daftarAkun)).toBe(
      laporan.total_pokok,
    );

    // Bunga/denda di laporan = saldo beban yang berasal dari jurnal bayar.
    expect(saldoAkun(baris, '5063', undefined, daftarAkun)).toBe(
      laporan.total_bunga,
    );
    expect(saldoAkun(baris, '5050', undefined, daftarAkun)).toBe(
      laporan.total_denda,
    );

    // Kas keluar = kredit kas, bukan debit pencairan.
    const kreditKas = baris
      .filter((b) => b.akun_kode === '1014')
      .reduce((s, b) => s + b.kredit, 0);
    expect(kreditKas).toBe(laporan.total_kas_keluar);
  });

  it('menampilkan jadwal vs realisasi dan drill-down no/ tanggal/ link jurnal', () => {
    const { db, pinjamanId } = siapkanFixture();
    const laporan = laporanMutasiPinjaman(db, pinjamanId, {
      sekarang: '2026-10-23',
    });

    expect(laporan.jadwal).toHaveLength(4);
    expect(laporan.jadwal[0]).toMatchObject({
      ke: 1,
      jatuh_tempo: '2026-02-01',
      pokok_jadwal: RP(3_000_000),
      bunga_jadwal: RP(100_000),
      pokok_realisasi: RP(3_000_000),
      bunga_realisasi: RP(100_000),
      denda_realisasi: RP(50_000),
      selisih_pokok: 0,
      selisih_bunga: 0,
      dibayar: true,
      jurnal_id: 'j-bayar-1',
      no_bukti: 'B-1',
      tanggal_jurnal: '2026-02-05',
      tanggal_bayar: '2026-02-05',
    });

    // Realisasi angsuran 2 berbeda dari jadwal, jadwal tetap rencana.
    expect(laporan.jadwal[1]).toMatchObject({
      ke: 2,
      pokok_jadwal: RP(3_000_000),
      bunga_jadwal: RP(100_000),
      pokok_realisasi: RP(2_500_000),
      bunga_realisasi: RP(150_000),
      selisih_pokok: -RP(500_000),
      selisih_bunga: RP(50_000),
      dibayar: false,
      jurnal_id: 'j-bayar-2',
      no_bukti: 'B-2',
    });

    expect(laporan.jadwal[3]).toMatchObject({
      ke: 4,
      dibayar: false,
      pokok_realisasi: 0,
      bunga_realisasi: 0,
      selisih_pokok: -RP(3_000_000),
      selisih_bunga: -RP(100_000),
      jurnal_id: null,
      no_bukti: null,
      tanggal_jurnal: null,
    });
  });

  // T-B08: angsuran boleh dicicil (angsuran_id boleh ganda); kartu mutasi
  // tetap menampilkan jejak bukti dari pembayaran pertama + jumlah pembayaran.
  it('menampilkan referensi pembayaran pertama dan jumlah pembayaran saat angsuran dicicil', () => {
    const db = openDb(':memory:');
    dbTerbuka.push(db);
    const awal = postingJurnal(db, {
      header: {
        id: 'awal-cicil',
        tanggal: '2026-01-01',
        no_bukti: 'SA-CICIL',
        keterangan: 'Saldo awal uji cicilan',
        jenis: 'SALDO_AWAL',
      },
      baris: [D('1001', RP(200_000_000)), K(AKUN_MODAL, RP(200_000_000))],
    });
    expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

    const jadwal = [1, 2].map((ke) => ({
      ke,
      jatuh_tempo: `2026-0${ke + 1}-01`,
      pokok: RP(3_000_000),
      bunga: RP(100_000),
      catatan: `Angsuran ${ke}`,
    }));
    const simpan = simpanPinjamanLpd(db, {
      id: 'pjr-cicil',
      mode: 'PENCAIRAN',
      kreditur: 'LPD Desa Adat',
      tanggal: '2026-01-02',
      akunKas: '1014',
      akunBunga: '5063',
      pokok: RP(6_000_000),
      tenor: 2,
      catatan: 'Pinjaman uji cicilan',
      angsuran: jadwal,
    });
    expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);
    const pinjamanId = simpan.pinjaman!.id;
    const a1 = simpan.pinjaman!.angsuran![0];

    const cicil = (
      id: string,
      tanggal: string,
      pokok: number,
      bunga: number,
      noBukti: string,
    ): void => {
      const hasil = bayarAngsuranPinjaman(db, {
        id,
        jurnal_id: `j-${id}`,
        pinjaman_id: pinjamanId,
        angsuran_id: a1.id,
        tanggal,
        akun_kas: '1014',
        pokok,
        bunga,
        denda: 0,
        noBukti,
        catatan: `Cicilan angsuran 1 (${noBukti})`,
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    };
    cicil('pby-1a', '2026-02-05', RP(1_000_000), RP(100_000), 'B-1A');
    cicil('pby-1b', '2026-02-20', RP(2_000_000), 0, 'B-1B');

    const laporan = laporanMutasiPinjaman(db, pinjamanId, {
      periode: '2026-02',
    });
    expect(laporan.jadwal).toHaveLength(1);
    expect(laporan.jadwal[0]).toMatchObject({
      ke: 1,
      dibayar: true,
      pokok_realisasi: RP(3_000_000),
      bunga_realisasi: RP(100_000),
      denda_realisasi: 0,
      jumlah_pembayaran: 2,
      // Referensi dari pembayaran pertama, bukan null.
      pembayaran_id: 'pby-1a',
      jurnal_id: 'j-pby-1a',
      no_bukti: 'B-1A',
      tanggal_jurnal: '2026-02-05',
      tanggal_bayar: '2026-02-05',
    });
  });

  it('memfilter satu bulan dan menampilkan periode kosong tanpa mengubah saldo', () => {
    const { db, pinjamanId } = siapkanFixture();

    const maret = laporanMutasiPinjaman(db, pinjamanId, { periode: '2026-03' });
    expect(maret.periode).toMatchObject({
      mode: 'bulan',
      mulai: '2026-03-01',
      sampai: '2026-03-31',
      label: 'Maret 2026',
      bulan: '2026-03',
    });
    expect(maret.bulanan).toHaveLength(1);
    expect(maret.bulanan[0]).toMatchObject({
      bulan: '2026-03',
      saldo_awal: RP(9_000_000),
      pokok: RP(2_500_000),
      bunga: RP(150_000),
      denda: 0,
      kas_keluar: RP(2_650_000),
      saldo_akhir: RP(6_500_000),
    });
    expect(maret.total_pokok).toBe(RP(2_500_000));
    expect(maret.jadwal.map((a) => a.ke)).toEqual([2]);

    const kosong = laporanMutasiPinjaman(db, pinjamanId, {
      periode: '2027-06',
    });
    expect(kosong.bulanan).toHaveLength(1);
    expect(kosong.bulanan[0]).toMatchObject({
      bulan: '2027-06',
      saldo_awal: RP(3_500_000),
      pokok: 0,
      bunga: 0,
      denda: 0,
      kas_keluar: 0,
      saldo_akhir: RP(3_500_000),
    });
    expect(kosong.total_pokok).toBe(0);
    expect(kosong.jadwal).toEqual([]);
    expect(kosong.outstanding).toBe(RP(3_500_000));
  });

  it('mendukung filter rentang tanggal dan default tahun berjalan', () => {
    const { db, pinjamanId } = siapkanFixture();

    expect(periodeMutasiPinjaman({}, '2026-10-23')).toMatchObject({
      mode: 'tahun',
      mulai: '2026-01-01',
      sampai: '2026-12-31',
    });
    expect(() => periodeMutasiPinjaman({ periode: '2026-13' }, '2026-10-23')).toThrow(
      /YYYY-MM/,
    );

    const rentang = laporanMutasiPinjaman(db, pinjamanId, {
      mulai: '2026-02-05',
      sampai: '2026-03-31',
    });
    expect(rentang.periode.mode).toBe('rentang');
    expect(rentang.bulanan.map((b) => b.bulan)).toEqual(['2026-02', '2026-03']);
    expect(rentang.bulanan[0].bulan).toBe('2026-02');
    expect(rentang.bulanan[0].saldo_awal).toBe(RP(12_000_000));
    expect(rentang.bulanan[0].pokok).toBe(RP(3_000_000));
    expect(rentang.bulanan[1].saldo_awal).toBe(RP(9_000_000));
    expect(rentang.total_pokok).toBe(RP(5_500_000));
    expect(rentang.saldo_akhir_periode).toBe(RP(6_500_000));
  });

  it('tidak menyimpan total bulanan/saldo di tabel pembayaran atau tabel baru', () => {
    const { db, pinjamanId } = siapkanFixture();
    const laporan = laporanMutasiPinjaman(db, pinjamanId, {
      sekarang: '2026-10-23',
    });
    expect(laporan.bulanan).toHaveLength(12);

    const tabel = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((r) => r.name);
    expect(tabel).not.toContain('pinjaman_mutasi');
    expect(tabel).not.toContain('pinjaman_bulanan');

    const kolomBayar = (
      db.pragma('table_info(pinjaman_bayar)') as { name: string }[]
    ).map((k) => k.name);
    for (const nama of [
      'bulan',
      'saldo_awal',
      'saldo_akhir',
      'pokok',
      'bunga',
      'denda',
      'kas_keluar',
      'total',
    ]) {
      expect(kolomBayar, nama).not.toContain(nama);
    }

    const SERVICE = baca('src/db/pinjaman.ts');
    const CORE = baca('src/core/pinjamanMutasi.ts');
    expect(SERVICE).not.toMatch(/INSERT\s+INTO\s+pinjaman_(mutasi|bulanan)/i);
    expect(CORE).toContain('hitungMutasiPinjaman');
    expect(CORE).not.toContain('better-sqlite3');
  });
});

describe('DB-16e — validasi, IPC, API, UI, dan dokumentasi', () => {
  const IPC = baca('src/main/ipc.ts');
  const VALIDATION = baca('src/main/validation.ts');
  const API = baca('src/renderer/lib/api.ts');
  const UI = baca('src/renderer/components/PinjamanTab.tsx');
  const PANDUAN = baca('docs/panduan-pengguna.md');

  it('memvalidasi ID pinjaman, periode bulan, dan rentang tanggal', () => {
    expect(validasiBentukPinjamanMutasi({ pinjamanId: 'pjr-1' })).toEqual({
      ok: true,
      input: { pinjamanId: 'pjr-1' },
    });
    expect(
      validasiBentukPinjamanMutasi({ pinjamanId: 'pjr-1', periode: '2026-03' }),
    ).toEqual({
      ok: true,
      input: { pinjamanId: 'pjr-1', periode: '2026-03' },
    });
    expect(
      validasiBentukPinjamanMutasi({
        pinjamanId: 'pjr-1',
        mulai: '2026-01-01',
        sampai: '2026-12-31',
      }),
    ).toMatchObject({
      ok: true,
      input: { pinjamanId: 'pjr-1', mulai: '2026-01-01', sampai: '2026-12-31' },
    });

    for (const [input, pola] of [
      [{}, /pinjaman/i],
      [{ pinjamanId: ' ' }, /pinjaman/i],
      [{ pinjamanId: 'pjr-1', periode: '2026-13' }, /YYYY-MM/i],
      [{ pinjamanId: 'pjr-1', periode: '0000-01' }, /tahun|YYYY-MM/i],
      [{ pinjamanId: 'pjr-1', mulai: '2026-02-31' }, /tidak valid/i],
      [
        { pinjamanId: 'pjr-1', mulai: '2026-12-31', sampai: '2026-01-01' },
        /sebelum|setelah/i,
      ],
      [
        { pinjamanId: 'pjr-1', periode: '2026-03', mulai: '2026-03-01' },
        /jangan keduanya/i,
      ],
    ] as const) {
      const hasil = validasiBentukPinjamanMutasi(input);
      expect(hasil.ok, JSON.stringify(input)).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(pola);
    }
  });

  it('mendaftarkan channel pinjaman:mutasi dan memakai adapter jurnal', () => {
    expect(IPC).toContain("'pinjaman:mutasi'");
    expect(IPC).toContain('validasiBentukPinjamanMutasi');
    expect(IPC).toContain('laporanMutasiPinjaman');
    expect(VALIDATION).toContain('validasiBentukPinjamanMutasi');
    expect(API).toContain('pinjamanMutasi');
    expect(API).toContain("'pinjaman:mutasi'");
    expect(API).toContain('FilterMutasiPinjamanApi');
    expect(API).toContain('MutasiPinjamanHasil');
  });

  it('UI menampilkan tabel bulan, filter periode, jadwal vs realisasi, dan detail jurnal', () => {
    expect(UI).toContain('Kartu Hutang / Mutasi Bulanan');
    expect(UI).toContain('api.pinjamanMutasi');
    expect(UI).toContain('Jadwal vs Realisasi');
    expect(UI).toContain('Saldo awal periode');
    expect(UI).toContain('Total kas keluar');
    expect(UI).toContain('Tanggal jurnal');
    expect(UI).toContain('Jurnal ID');
    expect(UI).toContain('mutasiBulan');
    expect(UI).toContain('tahunLokal');
  });

  it('panduan pengguna menjelaskan kartu hutang dan sumber jurnalnya', () => {
    expect(PANDUAN).toContain('Kartu hutang');
    expect(PANDUAN).toContain('mutasi bulanan');
    expect(PANDUAN).toContain('2050');
    expect(PANDUAN).toContain('tidak disimpan');
  });
});
