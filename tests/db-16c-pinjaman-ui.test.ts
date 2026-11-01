// DB-16c — wizard pinjaman LPD: pencairan baru vs pinjaman sudah berjalan.
//
// Fokus:
// - mode pencairan memposting jurnal seimbang D kas / K 2050 dan menautkannya;
// - mode berjalan tidak membuat jurnal pencairan baru;
// - jadwal manual wajib total pokok = sisa pokok dan urut;
// - kegagalan jadwal/akun membatalkan jurnal pencairan (atomik);
// - bentuk IPC/API/UI/menu tersedia dan validasi server menolak input salah.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  getPinjaman,
  listPinjaman,
  simpanPinjamanLpd,
  type SimpanPinjamanLpdInput,
} from '../src/db/pinjaman.js';
import { getJurnalDetail } from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import { validasiBentukPinjamanSimpan } from '../src/main/validation.js';
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

function dbKas(): Database.Database {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  const awal = postingJurnal(db, {
    header: {
      id: 'awal-16c',
      tanggal: '2026-01-01',
      no_bukti: 'SA-16C',
      keterangan: 'Saldo awal uji wizard pinjaman',
      jenis: 'SALDO_AWAL',
    },
    baris: [
      D('1001', RP(100_000_000)),
      D('1014', RP(50_000_000)),
      K(AKUN_MODAL, RP(150_000_000)),
    ],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

function jadwal(
  total: number,
  jumlah = 3,
  mulai = '2026-02-01',
): { ke: number; jatuh_tempo: string; pokok: number; bunga: number; catatan: string }[] {
  const dasar = Math.floor(total / jumlah);
  const sisa = total - dasar * jumlah;
  return Array.from({ length: jumlah }, (_, i) => {
    const tgl = new Date(`${mulai}T00:00:00.000Z`);
    tgl.setUTCMonth(tgl.getUTCMonth() + i);
    return {
      ke: i + 1,
      jatuh_tempo: tgl.toISOString().slice(0, 10),
      pokok: i === jumlah - 1 ? dasar + sisa : dasar,
      bunga: RP(100_000),
      catatan: `Angsuran ${i + 1}`,
    };
  });
}

function inputDasar(
  overrides: Partial<SimpanPinjamanLpdInput> = {},
): SimpanPinjamanLpdInput {
  const total = RP(12_000_000);
  return {
    mode: 'PENCAIRAN',
    kreditur: 'LPD Desa Adat',
    tanggal: '2026-01-02',
    akunKas: '1014',
    akunBunga: '5063',
    pokok: total,
    tenor: 3,
    catatan: 'Pinjaman uji',
    angsuran: jadwal(total),
    ...overrides,
  } as SimpanPinjamanLpdInput;
}

function hitungJurnal(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n;
}

function aksiAudit(db: Database.Database): string[] {
  return (
    db.prepare('SELECT aksi FROM audit_log ORDER BY id').all() as {
      aksi: string;
    }[]
  ).map((r) => r.aksi);
}

afterEach(() => {
  for (const db of dbTerbuka.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup */
    }
  }
});

describe('DB-16c — mode pencairan baru', () => {
  it('memposting jurnal D kas / K 2050 seimbang dan menautkannya ke pinjaman', () => {
    const db = dbKas();
    const sebelum = hitungJurnal(db);
    const total = RP(12_000_000);

    const hasil = simpanPinjamanLpd(db, inputDasar());

    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.mode).toBe('PENCAIRAN');
    expect(hasil.jurnal).not.toBeNull();
    expect(hasil.pinjaman).toMatchObject({
      kreditur: 'LPD Desa Adat',
      akun_kas: '1014',
      akun_bunga: '5063',
      pokok_awal: total,
      sisa_pokok_awal: total,
      jurnal_pencairan_id: hasil.jurnal?.id,
      outstanding: total,
    });
    expect(hasil.pinjaman?.angsuran).toHaveLength(3);
    expect(
      hasil.pinjaman?.angsuran?.reduce((s, a) => s + a.pokok, 0),
    ).toBe(total);
    expect(hitungJurnal(db)).toBe(sebelum + 1);

    const detail = getJurnalDetail(db, hasil.jurnal!.id);
    expect(detail).not.toBeNull();
    const baris = detail!.baris;
    expect(baris.reduce((s, b) => s + b.debit, 0)).toBe(total);
    expect(baris.reduce((s, b) => s + b.kredit, 0)).toBe(total);
    expect(baris).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ akun_kode: '1014', debit: total, kredit: 0 }),
        expect.objectContaining({ akun_kode: '2050', debit: 0, kredit: total }),
      ]),
    );
    expect(detail!.jurnal.jenis).toBe('HUTANG');
    expect(detail!.jurnal.keterangan).toContain('LPD Desa Adat');

    const aksi = aksiAudit(db);
    expect(aksi.some((a) => a.startsWith('PINJAMAN-CREATE'))).toBe(true);
    expect(aksi.some((a) => a.startsWith('PINJAMAN-PENCAIRAN'))).toBe(true);
    expect(listPinjaman(db)).toHaveLength(1);
    expect(getPinjaman(db, hasil.pinjaman!.id)?.jurnal_pencairan_id).toBe(
      hasil.jurnal!.id,
    );
  });

  it('menolak total pokok jadwal yang salah dan tidak meninggalkan jurnal', () => {
    const db = dbKas();
    const sebelum = hitungJurnal(db);
    const rows = jadwal(RP(12_000_000));
    rows[2] = { ...rows[2], pokok: rows[2].pokok - RP(500_000) };

    const hasil = simpanPinjamanLpd(db, inputDasar({ angsuran: rows }));

    expect(hasil.tersimpan).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/Total pokok jadwal/);
    expect(hitungJurnal(db)).toBe(sebelum);
    expect(listPinjaman(db)).toHaveLength(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman_angsuran').get() as {
        n: number;
      }).n,
    ).toBe(0);
    expect(aksiAudit(db).some((a) => a.startsWith('PINJAMAN-'))).toBe(false);
  });

  it('rollback juga terjadi saat akun bunga tidak valid setelah jurnal diposting', () => {
    const db = dbKas();
    const sebelum = hitungJurnal(db);
    const hasil = simpanPinjamanLpd(
      db,
      inputDasar({ akunBunga: '1001' }),
    );

    expect(hasil.tersimpan).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/akun bunga/i);
    expect(hitungJurnal(db)).toBe(sebelum);
    expect(listPinjaman(db)).toHaveLength(0);
  });

  it('menolak akun kas yang bukan kas aktif sebelum jurnal dibuat', () => {
    const db = dbKas();
    const sebelum = hitungJurnal(db);
    const hasil = simpanPinjamanLpd(db, inputDasar({ akunKas: '2050' }));

    expect(hasil.tersimpan).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/akun kas/i);
    expect(hitungJurnal(db)).toBe(sebelum);
    expect(listPinjaman(db)).toHaveLength(0);
  });
});

describe('DB-16c — mode sudah berjalan', () => {
  it('tidak membuat jurnal baru dan memakai sisa pokok sebagai pokok awal', () => {
    const db = dbKas();
    const sebelum = hitungJurnal(db);
    const sisa = RP(7_500_000);

    const hasil = simpanPinjamanLpd(db, {
      mode: 'BERJALAN',
      kreditur: 'LPD Desa Adat',
      tanggal: '2026-01-01',
      akunBunga: '5063',
      sisaPokok: sisa,
      tenor: 3,
      catatan: 'Pinjaman sudah berjalan',
      angsuran: jadwal(sisa, 3, '2026-02-01'),
    });

    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.mode).toBe('BERJALAN');
    expect(hasil.jurnal).toBeNull();
    expect(hitungJurnal(db)).toBe(sebelum);
    expect(hasil.pinjaman).toMatchObject({
      pokok_awal: sisa,
      sisa_pokok_awal: sisa,
      jurnal_pencairan_id: null,
      outstanding: sisa,
    });
    expect(hasil.pinjaman?.angsuran).toHaveLength(3);
    const aksi = aksiAudit(db);
    expect(aksi.some((a) => a.startsWith('PINJAMAN-CREATE'))).toBe(true);
    expect(aksi.some((a) => a.startsWith('PINJAMAN-PENCAIRAN'))).toBe(false);
  });

  it('menerima mode berjalan tanpa memilih akun kas dan memakai kas aktif DB', () => {
    const db = dbKas();
    const hasil = simpanPinjamanLpd(db, {
      mode: 'BERJALAN',
      kreditur: 'LPD Cadangan',
      tanggal: '2025-06-01',
      sisaPokok: RP(1_000_000),
      angsuran: jadwal(RP(1_000_000), 1, '2026-01-01'),
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    // 1001 adalah akun kas aktif dengan kode terkecil di master DB.
    expect(hasil.pinjaman?.akun_kas).toBe('1001');
    expect(hasil.pinjaman?.jurnal_pencairan_id).toBeNull();
  });
});

describe('DB-16c — IPC, API, UI, dan menu', () => {
  const APP = baca('src/renderer/App.tsx');
  const TRANSAKSI = baca('src/renderer/components/TransaksiTab.tsx');
  const UI = baca('src/renderer/components/PinjamanTab.tsx');
  const API = baca('src/renderer/lib/api.ts');
  const IPC = baca('src/main/ipc.ts');
  const SERVICE = baca('src/db/pinjaman.ts');
  const VALIDATION = baca('src/main/validation.ts');
  const PRELOAD = baca('src/preload/index.ts');
  const AUDIT_DETAIL = baca('src/utils/auditDetail.ts');
  const PANDUAN = baca('docs/panduan-pengguna.md');

  it('mendaftarkan channel pinjaman:list/detail/simpan dan validasi server', () => {
    for (const channel of ['pinjaman:list', 'pinjaman:detail', 'pinjaman:simpan']) {
      expect(IPC, channel).toContain(`'${channel}'`);
    }
    expect(IPC).toContain('validasiBentukPinjamanSimpan');
    expect(IPC).toContain('simpanPinjamanLpd');
    expect(SERVICE).toContain('PINJAMAN-CREATE');
    expect(SERVICE).toContain('PINJAMAN-PENCAIRAN');
    expect(IPC).toContain('GAGAL_PINJAMAN');
    expect(VALIDATION).toContain('validasiBentukPinjamanSimpan');
    expect(VALIDATION).toContain('Mode pinjaman harus PENCAIRAN');
  });

  it('API renderer memakai preload generik dan tipe pinjaman', () => {
    expect(API).toContain('pinjamanList');
    expect(API).toContain('pinjamanDetail');
    expect(API).toContain('pinjamanSimpan');
    expect(API).toContain("'pinjaman:list'");
    expect(API).toContain("'pinjaman:detail'");
    expect(API).toContain("'pinjaman:simpan'");
    expect(API).toContain('PinjamanSimpanApi');
    expect(PRELOAD).toContain('ipcRenderer.invoke(channel, ...args)');
  });

  it('UI memakai metadata akun DB (is_kas/BEBAN), bukan daftar hardcoded', () => {
    expect(UI).toContain('isAkunKasData');
    expect(UI).toContain("c.tipe === 'BEBAN'");
    expect(UI).toContain('aktif !== false');
    expect(UI).toContain('Pinjaman LPD');
    expect(UI).toContain('Pencairan baru');
    expect(UI).toContain('Sudah berjalan');
    expect(UI).toContain('Saldo Awal 2050');
    expect(UI).toContain('Jadwal angsuran (input manual)');
    expect(UI).toContain('Total pokok jadwal');
    expect(UI).toContain('Tambah angsuran');
    expect(UI).toContain('api.pinjamanSimpan');
    expect(UI).not.toContain('amortisasi otomatis');
  });

  it('menu sidebar dan kartu Transaksi membuka Pinjaman LPD', () => {
    expect(APP).toContain('PinjamanTab');
    expect(APP).toContain("'pinjaman'");
    expect(APP).toContain('Pinjaman LPD');
    expect(TRANSAKSI).toContain('Pinjaman LPD');
    expect(TRANSAKSI).toContain("tujuan: 'pinjaman'");
    expect(TRANSAKSI).not.toContain('belum tersedia');
  });

  it('label audit dan panduan pengguna menjelaskan dua mode wizard', () => {
    expect(AUDIT_DETAIL).toContain('PINJAMAN-CREATE');
    expect(AUDIT_DETAIL).toContain('PINJAMAN-PENCAIRAN');
    expect(PANDUAN).toContain('Pinjaman LPD');
    expect(PANDUAN).toContain('Pencairan baru');
    expect(PANDUAN).toContain('Sudah berjalan');
    expect(PANDUAN).toContain('Saldo Awal');
    expect(PANDUAN).toContain('jadwal');
  });
});

describe('DB-16c — validasi bentuk server', () => {
  it('menolak mode asing, tanggal salah, dan field wajib per mode', () => {
    const dasar = {
      mode: 'PENCAIRAN',
      kreditur: 'LPD',
      tanggal: '2026-01-02',
      akunKas: '1014',
      akunBunga: '5063',
      pokok: RP(1_000_000),
      angsuran: jadwal(RP(1_000_000), 1),
    };

    expect(validasiBentukPinjamanSimpan({ ...dasar, mode: 'LAIN' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/mode pinjaman/i),
    });
    expect(
      validasiBentukPinjamanSimpan({ ...dasar, tanggal: '2026-02-31' }),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/tidak valid/i),
    });
    expect(
      validasiBentukPinjamanSimpan({
        ...dasar,
        akunKas: undefined,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/akun kas/i),
    });
    expect(
      validasiBentukPinjamanSimpan({
        ...dasar,
        mode: 'BERJALAN',
        pokok: undefined,
        sisaPokok: undefined,
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/sisa pokok/i),
    });

    const valid = validasiBentukPinjamanSimpan(dasar);
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.input.mode).toBe('PENCAIRAN');
      expect(valid.input.angsuran).toHaveLength(1);
    }
  });

  it('menolak jadwal tanpa baris, tanggal jadwal salah, dan nominal negatif', () => {
    const dasar = {
      mode: 'PENCAIRAN',
      kreditur: 'LPD',
      tanggal: '2026-01-02',
      akunKas: '1014',
      akunBunga: '5063',
      pokok: RP(1_000_000),
      angsuran: [],
    };
    expect(validasiBentukPinjamanSimpan(dasar)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/minimal satu baris/i),
    });
    expect(
      validasiBentukPinjamanSimpan({
        ...dasar,
        angsuran: [
          { ke: 1, jatuh_tempo: '2026-02-31', pokok: 1, bunga: 0, catatan: '' },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/jatuh tempo tidak valid/i),
    });
    expect(
      validasiBentukPinjamanSimpan({
        ...dasar,
        angsuran: [
          { ke: 1, jatuh_tempo: '2026-02-01', pokok: -1, bunga: 0, catatan: '' },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: expect.stringMatching(/pokok/i),
    });
  });
});

