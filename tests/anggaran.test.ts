// P2-1 — pagu anggaran & realisasi dari jurnal.
//
// Fokus kontrak:
// - hanya PENDAPATAN/BEBAN yang boleh dianggarkan;
// - realisasi memakai labaRugi()/saldoAkun() (bukan tabel transaksi lama dan
//   bukan angka tersimpan);
// - sisa/%% benar untuk pagu 0, tepat, kurang, dan lebih;
// - simpan atomik = upsert + hapus nol + audit `ANGGARAN`;
// - DB lama (v2 tanpa tabel anggaran) terbuka, tabel dibuat, data awet;
// - export xlsx tetap numerik + print A4 portrait.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { COA } from '../src/db/coa.js';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import {
  hitungRealisasiAnggaran,
  validasiBarisAnggaran,
  validasiTahunAnggaran,
  type AnggaranBaris,
} from '../src/core/anggaran.js';
import {
  getAnggaranTahun,
  laporanRealisasiAnggaran,
  listAnggaran,
  simpanAnggaran,
} from '../src/db/anggaran.js';
import { insertJurnal, listAkun, listAuditLog, setAkunAktif, tambahAkun } from '../src/db/repository.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { labaRugi, saldoAkun, type BarisJurnalSumber } from '../src/core/reports.js';
import {
  KOP_ORG_NAMA,
  NUMFMT_PERSEN,
  NUMFMT_RP,
  anggaranToWorkbook,
  workbookToBuffer,
} from '../src/features/export/workbooks.js';
import { anggaranPrintDoc } from '../src/features/export/printAdapters.js';
import { cariBarisCetak, renderPrintDocument } from '../src/features/export/printDoc.js';

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
    no_bukti: `JU-${tanggal.slice(0, 4)}-${id}`,
    keterangan,
    akun_kode,
    debit,
    kredit,
  }));

/**
 * Data uji periode 2026:
 * - pendapatan 4005 5jt, 4001 1jt (2025 ada 4005 9jt agar filter terbukti);
 * - beban 5003 600rb, 5004 4,5jt, 5010 200rb.
 * Total realisasi: pendapatan 6jt, beban 5,3jt.
 */
const BARIS: BarisJurnalSumber[] = [
  ...jurnal('j-2025', '2025-12-01', 'Pendapatan 2025 (di luar periode)', [
    ['1001', RP(9_000_000), 0],
    ['4005', 0, RP(9_000_000)],
  ]),
  ...jurnal('j-4005', '2026-01-10', 'Pendapatan parkir', [
    ['1001', RP(5_000_000), 0],
    ['4005', 0, RP(5_000_000)],
  ]),
  ...jurnal('j-4001', '2026-02-15', 'Pendapatan beji', [
    ['1029', RP(1_000_000), 0],
    ['4001', 0, RP(1_000_000)],
  ]),
  ...jurnal('j-5003', '2026-03-01', 'Beban wewangunan', [
    ['5003', RP(600_000), 0],
    ['1001', 0, RP(600_000)],
  ]),
  ...jurnal('j-5004', '2026-04-01', 'Beban upakara', [
    ['5004', RP(4_500_000), 0],
    ['1001', 0, RP(4_500_000)],
  ]),
  ...jurnal('j-5010', '2026-04-10', 'Beban listrik tanpa pagu', [
    ['5010', RP(200_000), 0],
    ['1029', 0, RP(200_000)],
  ]),
];

const ANGGARAN: AnggaranBaris[] = [
  { tahun: 2026, akun_kode: '4005', nominal: RP(10_000_000) },
  { tahun: 2026, akun_kode: '4001', nominal: RP(1_000_000) },
  { tahun: 2026, akun_kode: '4008', nominal: RP(2_000_000) },
  { tahun: 2026, akun_kode: '5003', nominal: RP(500_000) },
  { tahun: 2026, akun_kode: '5004', nominal: RP(4_500_000) },
];

const RENTANG_2026 = { mulai: '2026-01-01', sampai: '2026-12-31' };
const HASIL = hitungRealisasiAnggaran(ANGGARAN, BARIS, RENTANG_2026);

const cari = (rows: readonly { kode: string }[], kode: string) => {
  const row = rows.find((r) => r.kode === kode);
  if (!row) throw new Error(`Akun ${kode} tidak ada di hasil`);
  return row as (typeof rows)[number] & {
    anggaran: number;
    realisasi: number;
    sisa: number;
    persen: number;
    lebih: boolean;
  };
};

const dirs: string[] = [];
function pathBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-anggaran-'));
  dirs.push(dir);
  return join(dir, 'pura.db');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P2-1 — hitung realisasi: pagu 0, tepat, kurang, lebih', () => {
  it('menghitung sisa/%/lebih untuk pagu 0, tepat, kurang, dan lebih', () => {
    expect(cari(HASIL.pendapatan, '4005')).toMatchObject({
      anggaran: RP(10_000_000),
      realisasi: RP(5_000_000),
      sisa: RP(5_000_000),
      persen: 50,
      lebih: false,
    });
    expect(cari(HASIL.pendapatan, '4001')).toMatchObject({
      realisasi: RP(1_000_000),
      sisa: 0,
      persen: 100,
      lebih: false,
    });
    expect(cari(HASIL.pendapatan, '4008')).toMatchObject({
      anggaran: RP(2_000_000),
      realisasi: 0,
      sisa: RP(2_000_000),
      persen: 0,
      lebih: false,
    });
    // Pagu 0 dengan realisasi > 0: persen tetap 0 (tidak bagi nol), sisa negatif.
    expect(cari(HASIL.beban, '5010')).toMatchObject({
      anggaran: 0,
      realisasi: RP(200_000),
      sisa: -RP(200_000),
      persen: 0,
      lebih: true,
    });
    // Realisasi melebihi pagu: persen > 100 dan sisa negatif.
    expect(cari(HASIL.beban, '5003')).toMatchObject({
      anggaran: RP(500_000),
      realisasi: RP(600_000),
      sisa: -RP(100_000),
      persen: 120,
      lebih: true,
    });
    expect(cari(HASIL.beban, '5004')).toMatchObject({
      anggaran: RP(4_500_000),
      realisasi: RP(4_500_000),
      sisa: 0,
      persen: 100,
      lebih: false,
    });
  });

  it('total pendapatan/beban/gabungan konsisten dengan labaRugi', () => {
    const lr = labaRugi(BARIS, RENTANG_2026);
    expect(HASIL.totalPendapatan).toMatchObject({
      anggaran: RP(13_000_000),
      realisasi: lr.totalPendapatan,
      sisa: RP(7_000_000),
    });
    expect(HASIL.totalPendapatan.realisasi).toBe(RP(6_000_000));
    expect(HASIL.totalPendapatan.persen).toBeCloseTo((6 / 13) * 100, 10);
    expect(HASIL.totalBeban).toMatchObject({
      anggaran: RP(5_000_000),
      realisasi: lr.totalBeban,
      sisa: -RP(300_000),
      lebih: true,
    });
    expect(HASIL.totalBeban.realisasi).toBe(RP(5_300_000));
    expect(HASIL.total).toMatchObject({
      anggaran: RP(18_000_000),
      realisasi: RP(11_300_000),
      sisa: RP(6_700_000),
      lebih: false,
    });
    expect(HASIL.total.persen).toBeCloseTo((11_300_000 / 18_000_000) * 100, 10);
  });

  it('realisasi per akun sama dengan selisih saldoAkun dalam periode', () => {
    for (const b of [...HASIL.pendapatan, ...HASIL.beban]) {
      const awal = saldoAkun(BARIS, b.kode, '2025-12-31');
      const akhir = saldoAkun(BARIS, b.kode, '2026-12-31');
      expect(b.realisasi, b.kode).toBe(akhir - awal);
    }
  });

  it('filter periode memotong realisasi, bukan pagu', () => {
    const q1 = hitungRealisasiAnggaran(ANGGARAN, BARIS, {
      mulai: '2026-02-01',
      sampai: '2026-03-31',
    });
    expect(cari(q1.pendapatan, '4005').realisasi).toBe(0);
    expect(cari(q1.pendapatan, '4001').realisasi).toBe(RP(1_000_000));
    expect(cari(q1.beban, '5003').realisasi).toBe(RP(600_000));
    expect(cari(q1.beban, '5010').realisasi).toBe(0);
    expect(cari(q1.beban, '5003').anggaran).toBe(RP(500_000));
    expect(q1.totalPendapatan.realisasi).toBe(RP(1_000_000));
    expect(q1.totalBeban.realisasi).toBe(RP(600_000));
  });

  it('hanya akun PENDAPATAN/BEBAN yang muncul', () => {
    const kode = new Set([...HASIL.pendapatan, ...HASIL.beban].map((b) => b.kode));
    expect(kode.has('1001')).toBe(false);
    expect(kode.has('2050')).toBe(false);
    expect(kode.has('3000')).toBe(false);
    for (const b of [...HASIL.pendapatan, ...HASIL.beban]) {
      const akun = COA.find((a) => a.kode === b.kode)!;
      expect(['PENDAPATAN', 'BEBAN']).toContain(akun.tipe);
    }
  });
});

describe('P2-1 — validasi pagu', () => {
  it('menolak akun aset/kewajiban/ekuitas dan akun tak dikenal', () => {
    expect(() => validasiBarisAnggaran([{ akun_kode: '1001', nominal: 100 }])).toThrow(
      /bukan akun pendapatan\/beban/,
    );
    expect(() => validasiBarisAnggaran([{ akun_kode: '2050', nominal: 100 }])).toThrow(
      /bukan akun pendapatan\/beban/,
    );
    expect(() => validasiBarisAnggaran([{ akun_kode: '3000', nominal: 100 }])).toThrow(
      /bukan akun pendapatan\/beban/,
    );
    expect(() => validasiBarisAnggaran([{ akun_kode: '9999', nominal: 100 }])).toThrow(
      /tidak dikenal/,
    );
  });

  it('menolak akun tidak aktif', () => {
    const akun4005 = COA.find((a) => a.kode === '4005')!;
    expect(() =>
      validasiBarisAnggaran([{ akun_kode: '4005', nominal: 100 }], [
        { ...akun4005, aktif: false },
      ]),
    ).toThrow(/tidak aktif/);
  });

  it('opsi izinkanNonaktif hanya melonggarkan status aktif, aturan lain tetap', () => {
    const akun5011 = {
      kode: '5011',
      nama: 'Beban contoh nonaktif',
      tipe: 'BEBAN',
      posisi_normal: 'DEBIT',
      aktif: false,
    } as const;
    const daftar = [akun5011];

    // Mode pagu tersimpan: akun nonaktif diterima dan dinormalisasi.
    expect(
      validasiBarisAnggaran(
        [{ akun_kode: ' 5011 ', nominal: 100 }],
        daftar,
        { izinkanNonaktif: true },
      ),
    ).toEqual([{ akun_kode: '5011', nominal: 100 }]);

    // Default (input form) tetap menolak akun nonaktif.
    expect(() =>
      validasiBarisAnggaran([{ akun_kode: '5011', nominal: 100 }], daftar),
    ).toThrow(/tidak aktif/);

    // Kode harus tetap dikenal, tipe tetap PENDAPATAN/BEBAN, nominal tetap valid.
    expect(() =>
      validasiBarisAnggaran(
        [{ akun_kode: '5099', nominal: 100 }],
        daftar,
        { izinkanNonaktif: true },
      ),
    ).toThrow(/tidak dikenal/);
    expect(() =>
      validasiBarisAnggaran(
        [{ akun_kode: '5011', nominal: -1 }],
        daftar,
        { izinkanNonaktif: true },
      ),
    ).toThrow(/bilangan bulat/);
    expect(() =>
      validasiBarisAnggaran(
        [{ akun_kode: '5011', nominal: 100 }],
        [{ ...akun5011, tipe: 'AKTIVA', posisi_normal: 'DEBIT' }],
        { izinkanNonaktif: true },
      ),
    ).toThrow(/bukan akun pendapatan\/beban/);
  });

  it('hitungRealisasiAnggaran tetap membaca pagu akun nonaktif tanpa mengubah rumus', () => {
    const akun5011 = {
      kode: '5011',
      nama: 'Beban contoh nonaktif',
      tipe: 'BEBAN',
      posisi_normal: 'DEBIT',
      aktif: false,
    } as const;
    // COA uji harus memuat semua akun yang dipakai jurnal; labaRugi() kini
    // menolak baris berakun asing, bukan mengabaikannya diam-diam (AKT-23).
    const akun1001 = {
      kode: '1001',
      nama: 'Kas tunai',
      tipe: 'AKTIVA',
      posisi_normal: 'DEBIT',
      aktif: true,
    } as const;
    const baris = jurnal('j-5011', '2026-05-01', 'Beban nonaktif', [
      ['5011', RP(300_000), 0],
      ['1001', 0, RP(300_000)],
    ]);

    const hasil = hitungRealisasiAnggaran(
      [{ tahun: 2026, akun_kode: '5011', nominal: RP(500_000) }],
      baris,
      RENTANG_2026,
      [akun5011, akun1001],
    );
    expect(cari(hasil.beban, '5011')).toMatchObject({
      anggaran: RP(500_000),
      realisasi: RP(300_000),
      sisa: RP(200_000),
      persen: 60,
      lebih: false,
    });
    expect(hasil.totalBeban).toMatchObject({
      anggaran: RP(500_000),
      realisasi: RP(300_000),
      sisa: RP(200_000),
      persen: 60,
      lebih: false,
    });

    // Pagu tersimpan yang nominalnya rusak tetap ditolak, walau akun nonaktif.
    expect(() =>
      hitungRealisasiAnggaran(
        [{ tahun: 2026, akun_kode: '5011', nominal: -1 }],
        baris,
        RENTANG_2026,
        [akun5011],
      ),
    ).toThrow(/bilangan bulat/);
  });

  it('menolak nominal negatif, pecahan, dan bukan angka', () => {
    for (const nominal of [-1, 1.5, Number.NaN, '100' as unknown as number]) {
      expect(() =>
        validasiBarisAnggaran([{ akun_kode: '4005', nominal }]),
      ).toThrow(/bilangan bulat/);
    }
  });

  it('menolak akun duplikat dan menormalkan urutan', () => {
    expect(() =>
      validasiBarisAnggaran([
        { akun_kode: '4005', nominal: 100 },
        { akun_kode: '4005', nominal: 200 },
      ]),
    ).toThrow(/lebih dari sekali/);

    expect(
      validasiBarisAnggaran([
        { akun_kode: '5003', nominal: 200 },
        { akun_kode: '4005', nominal: 100 },
      ]).map((b) => b.akun_kode),
    ).toEqual(['4005', '5003']);
  });

  it('tahun harus bilangan bulat 2000–2100', () => {
    expect(validasiTahunAnggaran(2026)).toBe(2026);
    for (const tahun of [1999, 2101, 2026.5, Number.NaN, 'x']) {
      expect(() => validasiTahunAnggaran(tahun)).toThrow(/2000–2100/);
    }
  });
});

describe('P2-1 — simpan/baca/audit', () => {
  it('simpan = upsert per tahun, baca kembali, dan audit ANGGARAN berisi lama/baru', () => {
    const db = openDb(':memory:');
    try {
      const awal = simpanAnggaran(
        db,
        2026,
        [
          { akun_kode: '4005', nominal: RP(10_000_000) },
          { akun_kode: '5003', nominal: RP(500_000) },
        ],
        { alasan: 'Pagu awal 2026' },
      );
      expect(awal).toHaveLength(2);
      expect(listAnggaran(db, 2026)).toHaveLength(2);
      expect(getAnggaranTahun(db, 2026)).toMatchObject({
        tahun: 2026,
        total: RP(10_500_000),
      });

      // Upsert: akun sama tidak menambah baris, akun lain tetap.
      simpanAnggaran(db, 2026, [{ akun_kode: '4005', nominal: RP(12_000_000) }]);
      const setelah = listAnggaran(db, 2026);
      expect(setelah).toHaveLength(2);
      expect(setelah.find((b) => b.akun_kode === '4005')?.nominal).toBe(RP(12_000_000));

      // Nominal 0 = hapus pagu akun tersebut (default hapusNol).
      simpanAnggaran(db, 2026, [{ akun_kode: '4005', nominal: 0 }]);
      expect(listAnggaran(db, 2026).map((b) => b.akun_kode)).toEqual(['5003']);

      // Opsi hapusNol=false menyimpan pagu nol secara eksplisit.
      simpanAnggaran(db, 2026, [{ akun_kode: '4005', nominal: 0 }], {
        hapusNol: false,
      });
      expect(
        listAnggaran(db, 2026).find((b) => b.akun_kode === '4005')?.nominal,
      ).toBe(0);

      const audit = listAuditLog(db).filter((a) => a.aksi === 'ANGGARAN');
      expect(audit.length).toBeGreaterThanOrEqual(4);
      const pertama = audit[audit.length - 1]!;
      expect(pertama.alasan).toBe('Pagu awal 2026');
      expect(JSON.parse(pertama.data_lama_json)).toEqual({ tahun: 2026, baris: [] });
      const baru = JSON.parse(pertama.data_baru_json) as {
        tahun: number;
        baris: { akun_kode: string; nominal: number }[];
      };
      expect(baru.tahun).toBe(2026);
      expect(baru.baris.map((b) => [b.akun_kode, b.nominal])).toEqual([
        ['4005', RP(10_000_000)],
        ['5003', RP(500_000)],
      ]);
    } finally {
      db.close();
    }
  });

  it('penyimpanan ditolak untuk akun aset dan tidak menulis audit', () => {
    const db = openDb(':memory:');
    try {
      const sebelum = listAuditLog(db).length;
      expect(() =>
        simpanAnggaran(db, 2026, [{ akun_kode: '1001', nominal: 100 }]),
      ).toThrow(/bukan akun pendapatan\/beban/);
      expect(listAuditLog(db).length).toBe(sebelum);
      expect(listAnggaran(db, 2026)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('P2-1 — migrasi & data tetap setelah reopen', () => {
  it('DB v2 lama tanpa tabel anggaran → dibuat, user_version naik, data awet', () => {
    const path = pathBaru();

    const lama = new Database(path);
    lama.exec('PRAGMA user_version = 2;');
    expect(
      lama
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'anggaran'")
        .get(),
    ).toBeUndefined();
    lama.close();

    const db = openDb(path);
    try {
      expect(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'anggaran'")
          .get(),
      ).toBeTruthy();
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
      simpanAnggaran(db, 2026, [
        { akun_kode: '4005', nominal: RP(8_000_000) },
        { akun_kode: '5004', nominal: RP(2_000_000) },
      ]);
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(listAnggaran(db2, 2026).map((b) => [b.akun_kode, b.nominal])).toEqual([
        ['4005', RP(8_000_000)],
        ['5004', RP(2_000_000)],
      ]);
      expect(Number(db2.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
    } finally {
      db2.close();
    }
  });
});

describe('P2-1 — realisasi dari jurnal tersimpan', () => {
  it('angka sama dengan saldoAkun/labaRugi dan filter periode bekerja', () => {
    const db = openDb(':memory:');
    try {
      insertJurnal(
        db,
        { id: 'j-parkir', tanggal: '2026-01-10', no_bukti: 'JU-2026-0001', keterangan: 'Parkir' },
        [
          { akun_kode: '1001', debit: RP(7_000_000), kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(7_000_000) },
        ],
      );
      insertJurnal(
        db,
        { id: 'j-upakara', tanggal: '2026-02-01', no_bukti: 'JU-2026-0002', keterangan: 'Upakara' },
        [
          { akun_kode: '5004', debit: RP(2_000_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(2_000_000) },
        ],
      );
      insertJurnal(
        db,
        { id: 'j-2027', tanggal: '2027-01-05', no_bukti: 'JU-2027-0001', keterangan: 'Di luar tahun' },
        [
          { akun_kode: '1001', debit: RP(1_000_000), kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(1_000_000) },
        ],
      );

      simpanAnggaran(db, 2026, [
        { akun_kode: '4005', nominal: RP(10_000_000) },
        { akun_kode: '5004', nominal: RP(1_000_000) },
      ]);

      const hasil = laporanRealisasiAnggaran(db, { tahun: 2026 });
      const parkir = cari(hasil.pendapatan, '4005');
      const upakara = cari(hasil.beban, '5004');
      expect(parkir).toMatchObject({
        realisasi: RP(7_000_000),
        sisa: RP(3_000_000),
        persen: 70,
        lebih: false,
      });
      expect(upakara).toMatchObject({
        realisasi: RP(2_000_000),
        sisa: -RP(1_000_000),
        persen: 200,
        lebih: true,
      });

      const baris = listBarisJurnal(db);
      expect(parkir.realisasi).toBe(saldoAkun(baris, '4005', '2026-12-31'));
      const lr = labaRugi(baris, RENTANG_2026);
      expect(hasil.totalPendapatan.realisasi).toBe(lr.totalPendapatan);
      expect(hasil.totalBeban.realisasi).toBe(lr.totalBeban);

      // Jurnal 2027 tidak ikut tahun 2026; filter periode eksplisit juga benar.
      const januari = laporanRealisasiAnggaran(db, {
        tahun: 2026,
        mulai: '2026-01-01',
        sampai: '2026-01-31',
      });
      expect(cari(januari.pendapatan, '4005').realisasi).toBe(RP(7_000_000));
      expect(cari(januari.beban, '5004').realisasi).toBe(0);

      const daftarAkun = listAkun(db);
      expect(daftarAkun.some((a) => a.kode === '4005' && a.tipe === 'PENDAPATAN')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('akun 5011 dinonaktifkan: laporan tetap terbuka dengan realisasi, pagu baru ditolak', () => {
    const db = openDb(':memory:');
    try {
      tambahAkun(db, {
        kode: '5011',
        nama: 'Beban contoh yang dinonaktifkan',
        tipe: 'BEBAN',
      });
      insertJurnal(
        db,
        { id: 'j-5011', tanggal: '2026-05-01', no_bukti: 'JU-2026-5011', keterangan: 'Beban 5011' },
        [
          { akun_kode: '5011', debit: RP(300_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(300_000) },
        ],
      );
      simpanAnggaran(db, 2026, [{ akun_kode: '5011', nominal: RP(500_000) }]);

      const sebelum = laporanRealisasiAnggaran(db, { tahun: 2026 });
      setAkunAktif(db, '5011', false);

      // DoD: laporan tidak error dan angka realisasi tetap sama setelah nonaktif.
      const sesudah = laporanRealisasiAnggaran(db, { tahun: 2026 });
      expect(sesudah.beban).toEqual(sebelum.beban);
      expect(cari(sesudah.beban, '5011')).toMatchObject({
        anggaran: RP(500_000),
        realisasi: RP(300_000),
        sisa: RP(200_000),
        persen: 60,
        lebih: false,
      });
      expect(sesudah.totalBeban).toMatchObject({
        anggaran: RP(500_000),
        realisasi: RP(300_000),
        sisa: RP(200_000),
      });

      // Jalur input form tetap menolak akun nonaktif dan tidak mengubah pagu/audit.
      const auditSebelum = listAuditLog(db).length;
      expect(() =>
        simpanAnggaran(db, 2026, [{ akun_kode: '5011', nominal: RP(600_000) }]),
      ).toThrow(/tidak aktif/);
      expect(listAnggaran(db, 2026)).toMatchObject([
        { akun_kode: '5011', nominal: RP(500_000) },
      ]);
      expect(listAuditLog(db).length).toBe(auditSebelum);
    } finally {
      db.close();
    }
  });
});

function cariBaris(ws: ExcelJS.Worksheet, kolom: number, teks: string): number {
  for (let r = 1; r <= ws.rowCount; r++) {
    if (String(ws.getRow(r).getCell(kolom).value ?? '') === teks) return r;
  }
  return 0;
}

describe('P2-1 — export XLSX & print', () => {
  it('workbook: nominal NUMBER + numFmt Rp, persen NUMBER fraksi + total', async () => {
    const wb = await anggaranToWorkbook(HASIL);
    const ws = wb.worksheets[0]!;
    expect(ws.getRow(1).getCell(1).value).toBe(KOP_ORG_NAMA);
    expect(String(ws.getRow(3).getCell(1).value)).toContain('PERIODE');

    const header = cariBaris(ws, 1, 'Kode');
    expect(header).toBeGreaterThan(0);
    for (const kolom of [3, 4, 5]) {
      expect(ws.getRow(header).getCell(kolom).value).toBeTypeOf('string');
    }

    const row4005 = cariBaris(ws, 1, '4005');
    expect(row4005).toBeGreaterThan(0);
    for (const kolom of [3, 4, 5]) {
      expect(typeof ws.getRow(row4005).getCell(kolom).value).toBe('number');
      expect(String(ws.getRow(row4005).getCell(kolom).numFmt)).toContain('"Rp"');
    }
    expect(ws.getRow(row4005).getCell(3).value).toBe(10_000_000);
    expect(ws.getRow(row4005).getCell(4).value).toBe(5_000_000);
    expect(ws.getRow(row4005).getCell(5).value).toBe(5_000_000);
    expect(ws.getRow(row4005).getCell(6).value).toBe(0.5);
    expect(String(ws.getRow(row4005).getCell(6).numFmt)).toContain(NUMFMT_PERSEN);
    expect(ws.getRow(row4005).getCell(7).value).toBe('Sesuai');

    const row5003 = cariBaris(ws, 1, '5003');
    expect(ws.getRow(row5003).getCell(5).value).toBe(-100_000);
    expect(ws.getRow(row5003).getCell(6).value).toBe(1.2);
    expect(ws.getRow(row5003).getCell(7).value).toBe('Lebih');

    const total = cariBaris(ws, 2, 'TOTAL ANGGARAN & REALISASI');
    expect(total).toBeGreaterThan(0);
    expect(ws.getRow(total).getCell(3).value).toBe(18_000_000);
    expect(ws.getRow(total).getCell(4).value).toBe(11_300_000);
    expect(ws.getRow(total).getCell(5).value).toBe(6_700_000);

    // Round-trip: file benar-benar bisa dibaca ExcelJS dan tetap numerik.
    const buf = await workbookToBuffer(wb);
    const ulang = new ExcelJS.Workbook();
    await ulang.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
    const wsUlang = ulang.worksheets[0]!;
    const ulang4005 = cariBaris(wsUlang, 1, '4005');
    expect(typeof wsUlang.getRow(ulang4005).getCell(3).value).toBe('number');
    expect(String(wsUlang.getRow(ulang4005).getCell(3).numFmt)).toContain('"Rp"');
    expect(String(wsUlang.getRow(ulang4005).getCell(6).numFmt)).toContain('0.00%');
    expect(NUMFMT_RP).toBe('"Rp"#,##0.00;(Rp"#,##0.00)');
  });

  it('print: A4 portrait, halaman, kop/periode, total, dan status', () => {
    const doc = anggaranPrintDoc(HASIL, { tanggalCetak: '2026-10-23' });
    expect(doc.orientasi).toBe('portrait');
    expect(doc.judul).toContain('ANGGARAN');
    expect(doc.subjudul).toContain('1 Jan 2026');
    expect(doc.subjudul).toContain('31 Des 2026');

    const baris4005 = cariBarisCetak(doc, '4005');
    expect(baris4005).toBeTruthy();
    expect(baris4005!.nilai?.[5]).toBe(50);
    expect(baris4005!.sel[6]).toBe('Sesuai');
    expect(cariBarisCetak(doc, '5003')!.sel[6]).toBe('Lebih');

    const { html, jumlahHalaman, orientasi } = renderPrintDocument(doc);
    expect(orientasi).toBe('portrait');
    expect(jumlahHalaman).toBeGreaterThanOrEqual(1);
    expect(html).toContain('@page{size:A4 portrait');
    expect(html).toContain(`Halaman 1 dari ${jumlahHalaman}`);
    expect(html).toContain(KOP_ORG_NAMA);
    expect(html).toContain('Total Pendapatan');
    expect(html).toContain('Total Beban');
    expect(html).toContain('TOTAL ANGGARAN');
    expect(html).toContain('Rp 6.000.000,00');
  });
});
