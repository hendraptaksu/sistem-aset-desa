// P2-2 — rekonsiliasi bank dari saldo buku jurnal.
//
// Fokus kontrak:
// - hanya saldo menurut rekening koran yang disimpan; saldo buku/selisih/
//   daftar mutasi selalu dihitung dari jurnal;
// - status cocok/lebih/kurang dihitung dengan nominal integer SEN;
// - akun wajib kas/bank (1040/1050 ditolak), tanggal kalender nyata;
// - create/list/detail/selesai + audit, selesai ganda ditolak;
// - DB v6 lama terbuka, tabel baru dibuat, data awet setelah reopen.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { insertJurnalTervalidasi, listAuditLog } from '../src/db/repository.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import {
  buatRekonsiliasi,
  getRekonsiliasiDetail,
  listRekonsiliasi,
  selesaikanRekonsiliasi,
} from '../src/db/rekonsiliasi.js';
import {
  hitungRekonsiliasi,
  normalisasiRekonsiliasi,
  ringkasMutasiRekonsiliasi,
} from '../src/core/rekonsiliasi.js';
import { saldoAkun, type BarisJurnalSumber } from '../src/core/reports.js';
import { validasiBentukRekonsiliasiCreate } from '../src/main/validation.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../src/utils/pesanError.js';

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

const dirs: string[] = [];

function pathBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-rekonsiliasi-'));
  dirs.push(dir);
  return join(dir, 'pura.db');
}

function freshDb(): ReturnType<typeof openDb> {
  return openDb(pathBaru());
}

function posting(
  db: ReturnType<typeof openDb>,
  id: string,
  tanggal: string,
  keterangan: string,
  baris: BarisRingkas[],
): void {
  insertJurnalTervalidasi(
    db,
    {
      id,
      tanggal,
      no_bukti: `JU-${tanggal.slice(0, 4)}-${id}`,
      keterangan,
    },
    baris.map(([akun_kode, debit, kredit]) => ({
      akun_kode,
      debit,
      kredit,
    })),
  );
}

function isiJurnal(db: ReturnType<typeof openDb>): void {
  posting(db, 'awal-2025', '2025-12-31', 'Saldo awal kas', [
    ['1001', RP(5_000_000), 0],
    ['3000', 0, RP(5_000_000)],
  ]);
  posting(db, 'parkir-jan', '2026-01-05', 'Pendapatan parkir Januari', [
    ['1001', RP(1_000_000), 0],
    ['4005', 0, RP(1_000_000)],
  ]);
  posting(db, 'listrik-jan', '2026-01-20', 'Bayar listrik Januari', [
    ['5010', RP(200_000), 0],
    ['1001', 0, RP(200_000)],
  ]);
  posting(db, 'parkir-feb', '2026-02-10', 'Pendapatan parkir Februari', [
    ['1001', RP(2_000_000), 0],
    ['4005', 0, RP(2_000_000)],
  ]);
  posting(db, 'upakara-feb', '2026-02-15', 'Beban upakara Februari', [
    ['5004', RP(500_000), 0],
    ['1001', 0, RP(500_000)],
  ]);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P2-2 — hitungRekonsiliasi (murni)', () => {
  it('cocok, bank lebih, bank kurang, dan saldo 0', () => {
    expect(hitungRekonsiliasi({ saldoBank: RP(1_000_000), saldoBuku: RP(1_000_000) })).toEqual({
      saldoBank: RP(1_000_000),
      saldoBuku: RP(1_000_000),
      selisih: 0,
      status: 'COCOK',
      cocok: true,
    });

    const lebih = hitungRekonsiliasi({
      saldoBank: RP(1_000_000) + 50,
      saldoBuku: RP(1_000_000),
    });
    expect(lebih.selisih).toBe(50);
    expect(lebih.status).toBe('LEBIH');
    expect(lebih.cocok).toBe(false);

    const kurang = hitungRekonsiliasi({
      saldoBank: RP(1_000_000) - 25,
      saldoBuku: RP(1_000_000),
    });
    expect(kurang.selisih).toBe(-25);
    expect(kurang.status).toBe('KURANG');
    expect(kurang.cocok).toBe(false);

    expect(hitungRekonsiliasi({ saldoBank: 0, saldoBuku: 0 })).toMatchObject({
      selisih: 0,
      status: 'COCOK',
      cocok: true,
    });
    expect(hitungRekonsiliasi({ saldoBank: 0, saldoBuku: RP(1) })).toMatchObject({
      selisih: -RP(1),
      status: 'KURANG',
      cocok: false,
    });
  });

  it('menolak nominal bukan integer SEN', () => {
    expect(() =>
      hitungRekonsiliasi({ saldoBank: 1.5, saldoBuku: 0 }),
    ).toThrow(/bilangan bulat/);
    expect(() =>
      hitungRekonsiliasi({ saldoBank: 0, saldoBuku: Number.NaN }),
    ).toThrow(/bilangan bulat/);
  });
});

describe('P2-2 — daftar mutasi rekonsiliasi', () => {
  const BARIS: BarisJurnalSumber[] = [
    ...jurnal('j-awal', '2025-12-31', 'Saldo awal', [
      ['1001', RP(5_000_000), 0],
      ['3000', 0, RP(5_000_000)],
    ]),
    ...jurnal('j-parkir', '2026-01-05', 'Pendapatan parkir', [
      ['1001', RP(1_000_000), 0],
      ['4005', 0, RP(1_000_000)],
    ]),
    ...jurnal('j-listrik', '2026-01-20', 'Bayar listrik', [
      ['5010', RP(200_000), 0],
      ['1001', 0, RP(200_000)],
    ]),
    ...jurnal('j-lain', '2026-01-15', 'Pendapatan bank lain', [
      ['1029', RP(7_000_000), 0],
      ['4005', 0, RP(7_000_000)],
    ]),
    ...jurnal('j-feb', '2026-02-01', 'Di luar rentang', [
      ['1001', RP(9_000_000), 0],
      ['4005', 0, RP(9_000_000)],
    ]),
  ];

  it('total mutasi = saldo akhir − saldo awal, hanya akun & rentang terpilih', () => {
    const hasil = ringkasMutasiRekonsiliasi(BARIS, '1001', {
      mulai: '2026-01-01',
      sampai: '2026-01-31',
    });

    expect(hasil.saldoAwal).toBe(RP(5_000_000));
    expect(hasil.saldoAkhir).toBe(RP(5_800_000));
    expect(hasil.totalDebit).toBe(RP(1_000_000));
    expect(hasil.totalKredit).toBe(RP(200_000));
    expect(hasil.totalMutasi).toBe(RP(800_000));
    expect(hasil.saldoAkhir - hasil.saldoAwal).toBe(hasil.totalMutasi);

    // Hanya baris akun 1001 pada rentang; jurnal akun 1029 & Februari tidak ikut.
    expect(hasil.rows.map((r) => r.jurnal_id)).toEqual(['j-parkir', 'j-listrik']);
    expect(hasil.rows.every((r) => r.tanggal >= '2026-01-01' && r.tanggal <= '2026-01-31')).toBe(
      true,
    );
    expect(hasil.rows[0]).toMatchObject({
      tanggal: '2026-01-05',
      no_bukti: 'JU-2026-j-parkir',
      debit: RP(1_000_000),
      kredit: 0,
      saldo: RP(6_000_000),
    });
    expect(hasil.rows[1]).toMatchObject({
      debit: 0,
      kredit: RP(200_000),
      saldo: RP(5_800_000),
    });
    expect(hasil.saldoAkhir).toBe(saldoAkun(BARIS, '1001', '2026-01-31'));
  });
});

describe('P2-2 — validasi input', () => {
  it('menolak akun non-kas (1040/1050/4005) dan akun tidak ada', () => {
    for (const kode of ['1040', '1050', '4005']) {
      const hasil = normalisasiRekonsiliasi({
        akun_kode: kode,
        tanggal: '2026-01-31',
        saldo_bank: 0,
      });
      expect(hasil.ok, `akun ${kode} harus ditolak`).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(/bukan akun kas\/bank/);
    }

    const tidakAda = normalisasiRekonsiliasi({
      akun_kode: '9999',
      tanggal: '2026-01-31',
      saldo_bank: 0,
    });
    expect(tidakAda.ok).toBe(false);
    if (!tidakAda.ok) expect(tidakAda.error).toMatch(/tidak dikenal/);
  });

  it('menolak tanggal 31 Feb, saldo negatif/pecahan, dan menerima akun kas', () => {
    const feb31 = normalisasiRekonsiliasi({
      akun_kode: '1001',
      tanggal: '2026-02-31',
      saldo_bank: 0,
    });
    expect(feb31.ok).toBe(false);
    if (!feb31.ok) expect(feb31.error).toBe(PESAN_TANGGAL_TIDAK_VALID);

    for (const saldo of [-1, 1.5, Number.NaN]) {
      const hasil = normalisasiRekonsiliasi({
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: saldo,
      });
      expect(hasil.ok).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(/bilangan bulat ≥ 0/);
    }

    const valid = normalisasiRekonsiliasi({
      akun_kode: ' 1001 ',
      tanggal: ' 2026-01-31 ',
      saldo_bank: RP(5_800_000),
      catatan: '  Cocok dengan rekening koran  ',
    });
    expect(valid).toEqual({
      ok: true,
      input: {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_800_000),
        catatan: 'Cocok dengan rekening koran',
      },
    });

    const bentuk = validasiBentukRekonsiliasiCreate({
      akun_kode: '1001',
      tanggal: '2026-02-31',
      saldo_bank: 0,
    });
    expect(bentuk.ok).toBe(false);
    if (!bentuk.ok) expect(bentuk.error).toBe(PESAN_TANGGAL_TIDAK_VALID);
  });
});

describe('P2-2 — create, list, detail, selesai, audit', () => {
  it('menyimpan saldo bank, menghitung saldo buku, dan mencatat audit', () => {
    const db = freshDb();
    try {
      isiJurnal(db);

      const rek = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_800_000),
        catatan: 'Cocok dengan rekening koran Januari',
      });

      expect(rek.id).toBeTruthy();
      expect(rek).toMatchObject({
        akun_kode: '1001',
        akun_nama: 'KAS',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_800_000),
        saldo_buku: RP(5_800_000),
        selisih: 0,
        status: 'COCOK',
        cocok: true,
        selesai: false,
        selesai_at: null,
      });

      const audit = listAuditLog(db).filter((a) => a.aksi === 'REKONSILIASI');
      expect(audit).toHaveLength(1);
      const baru = JSON.parse(audit[0]!.data_baru_json) as Record<string, unknown>;
      expect(baru).toMatchObject({
        id: rek.id,
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_800_000),
        catatan: 'Cocok dengan rekening koran Januari',
        selesai: false,
      });
      // Tabel tidak menyimpan angka turunan.
      expect(Object.keys(baru)).not.toContain('saldo_buku');
      expect(Object.keys(baru)).not.toContain('selisih');
    } finally {
      db.close();
    }
  });

  it('detail memakai mutasi sejak rekonsiliasi selesai sebelumnya dan saldo dari jurnal', () => {
    const db = freshDb();
    try {
      isiJurnal(db);

      const januari = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_800_000),
        catatan: 'Rekonsiliasi Januari',
      });
      const januariSelesai = selesaikanRekonsiliasi(db, januari.id);
      expect(januariSelesai.selesai).toBe(true);
      expect(januariSelesai.selesai_at).toBeTruthy();

      const februari = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-02-28',
        saldo_bank: RP(7_300_000),
        catatan: 'Rekonsiliasi Februari',
      });

      const detailJan = getRekonsiliasiDetail(db, januari.id);
      expect(detailJan).not.toBeNull();
      expect(detailJan).toMatchObject({
        mulai: '2026-01-01',
        saldo_awal: RP(5_000_000),
        saldo_akhir: RP(5_800_000),
        saldo_buku: RP(5_800_000),
        total_debit: RP(1_000_000),
        total_kredit: RP(200_000),
        total_mutasi: RP(800_000),
      });
      expect(detailJan!.mutasi.map((m) => m.jurnal_id)).toEqual([
        'parkir-jan',
        'listrik-jan',
      ]);

      const detailFeb = getRekonsiliasiDetail(db, februari.id);
      expect(detailFeb).not.toBeNull();
      expect(detailFeb).toMatchObject({
        mulai: '2026-02-01',
        saldo_awal: RP(5_800_000),
        saldo_akhir: RP(7_300_000),
        saldo_buku: RP(7_300_000),
        total_debit: RP(2_000_000),
        total_kredit: RP(500_000),
        total_mutasi: RP(1_500_000),
        selisih: 0,
        status: 'COCOK',
      });
      expect(detailFeb!.mutasi.map((m) => m.jurnal_id)).toEqual([
        'parkir-feb',
        'upakara-feb',
      ]);
      expect(detailFeb!.saldo_akhir - detailFeb!.saldo_awal).toBe(
        detailFeb!.total_mutasi,
      );
    } finally {
      db.close();
    }
  });

  it('list urut tanggal terbaru + filter akun/status; selesai ganda ditolak', () => {
    const db = freshDb();
    try {
      isiJurnal(db);
      const januari = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_800_000),
        catatan: 'Januari',
      });
      const februari = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-02-28',
        saldo_bank: RP(7_300_000),
        catatan: 'Februari',
      });
      const bankLain = buatRekonsiliasi(db, {
        akun_kode: '1029',
        tanggal: '2026-02-28',
        saldo_bank: 0,
        catatan: 'Bank lain',
      });

      expect(listRekonsiliasi(db).map((r) => r.id)).toEqual([
        bankLain.id,
        februari.id,
        januari.id,
      ]);
      // Urutan tanggal terbaru: dua tanggal 2026-02-28 (1029 & 1001), lalu Januari.
      expect(listRekonsiliasi(db, { akun_kode: '1001' }).map((r) => r.id)).toEqual([
        februari.id,
        januari.id,
      ]);
      expect(listRekonsiliasi(db, { akun_kode: '1029' })).toHaveLength(1);

      const sudah = selesaikanRekonsiliasi(db, januari.id);
      expect(sudah.selesai).toBe(true);
      expect(listRekonsiliasi(db, { selesai: true }).map((r) => r.id)).toEqual([
        januari.id,
      ]);
      expect(listRekonsiliasi(db, { selesai: false }).map((r) => r.id)).toHaveLength(2);

      const auditSelesai = listAuditLog(db).filter(
        (a) => a.aksi === 'REKONSILIASI-SELESAI',
      );
      expect(auditSelesai).toHaveLength(1);
      expect(JSON.parse(auditSelesai[0]!.data_lama_json)).toMatchObject({
        id: januari.id,
        selesai: false,
      });
      expect(JSON.parse(auditSelesai[0]!.data_baru_json)).toMatchObject({
        id: januari.id,
        selesai: true,
      });

      expect(() => selesaikanRekonsiliasi(db, januari.id)).toThrow(
        /sudah ditandai selesai/,
      );
      expect(
        listAuditLog(db).filter((a) => a.aksi === 'REKONSILIASI-SELESAI'),
      ).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('menolak input tidak valid tanpa menulis baris/audit', () => {
    const db = freshDb();
    try {
      const sebelum = listAuditLog(db).length;
      const tidakValid = [
        { akun_kode: '1040', tanggal: '2026-01-31', saldo_bank: 0 },
        { akun_kode: '1050', tanggal: '2026-01-31', saldo_bank: 0 },
        { akun_kode: '4005', tanggal: '2026-01-31', saldo_bank: 0 },
        { akun_kode: '9999', tanggal: '2026-01-31', saldo_bank: 0 },
        { akun_kode: '1001', tanggal: '2026-02-31', saldo_bank: 0 },
        { akun_kode: '1001', tanggal: '2026-01-31', saldo_bank: -1 },
        { akun_kode: '1001', tanggal: '2026-01-31', saldo_bank: 1.5 },
      ];
      for (const input of tidakValid) {
        expect(() => buatRekonsiliasi(db, input)).toThrow();
      }
      expect(listRekonsiliasi(db)).toEqual([]);
      expect(listAuditLog(db).length).toBe(sebelum);
    } finally {
      db.close();
    }
  });
});

describe('AKT-21 — wajib alasan saat rekonsiliasi berselisih', () => {
  const CATATAN = 'Biaya admin bank belum tercatat';

  it('menolak selisih tanpa catatan dan tidak mengubah status', () => {
    const db = freshDb();
    try {
      isiJurnal(db);
      const rek = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_900_000),
      });
      expect(rek).toMatchObject({
        saldo_buku: RP(5_800_000),
        selisih: RP(100_000),
        status: 'LEBIH',
        selesai: false,
      });

      // Tanpa catatan dan catatan < 5 karakter sama-sama ditolak, pesan
      // menyebut nominal selisih.
      expect(() => selesaikanRekonsiliasi(db, rek.id)).toThrow(/Rp 100\.000,00/);
      expect(() => selesaikanRekonsiliasi(db, rek.id, { catatan: 'abcd' })).toThrow(
        /Rp 100\.000,00/,
      );

      const setelah = listRekonsiliasi(db).find((r) => r.id === rek.id);
      expect(setelah).toMatchObject({
        catatan: '',
        selesai: false,
        selesai_at: null,
        selisih: RP(100_000),
      });
      expect(
        listAuditLog(db).filter((a) => a.aksi === 'REKONSILIASI-SELESAI'),
      ).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('mengizinkan selisih selesai dengan catatan tersimpan dan mengaudit selisih + catatan', () => {
    const db = freshDb();
    try {
      isiJurnal(db);
      const rek = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_900_000),
        catatan: CATATAN,
      });

      const selesai = selesaikanRekonsiliasi(db, rek.id);
      expect(selesai).toMatchObject({
        catatan: CATATAN,
        selisih: RP(100_000),
        selesai: true,
      });
      expect(selesai.selesai_at).toBeTruthy();

      const audit = listAuditLog(db).find((a) => a.aksi === 'REKONSILIASI-SELESAI');
      expect(audit).toBeTruthy();
      expect(audit!.alasan).toContain('Rp 100.000,00');
      expect(audit!.alasan).toContain(CATATAN);
      expect(JSON.parse(audit!.data_baru_json)).toMatchObject({
        catatan: CATATAN,
        selesai: true,
      });
    } finally {
      db.close();
    }
  });

  it('mengizinkan selisih selesai dengan catatan baru saat menandai selesai', () => {
    const db = freshDb();
    try {
      isiJurnal(db);
      const rek = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_900_000),
      });

      const selesai = selesaikanRekonsiliasi(db, rek.id, {
        catatan: `  ${CATATAN}  `,
      });
      expect(selesai).toMatchObject({
        catatan: CATATAN,
        selisih: RP(100_000),
        selesai: true,
      });

      const audit = listAuditLog(db).find((a) => a.aksi === 'REKONSILIASI-SELESAI');
      expect(audit).toBeTruthy();
      expect(audit!.alasan).toContain('Rp 100.000,00');
      expect(audit!.alasan).toContain(CATATAN);
    } finally {
      db.close();
    }
  });

  it('cocok tanpa catatan tetap boleh selesai', () => {
    const db = freshDb();
    try {
      isiJurnal(db);
      const rek = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(5_800_000),
      });

      const selesai = selesaikanRekonsiliasi(db, rek.id);
      expect(selesai).toMatchObject({
        catatan: '',
        selisih: 0,
        status: 'COCOK',
        selesai: true,
      });

      const audit = listAuditLog(db).find((a) => a.aksi === 'REKONSILIASI-SELESAI');
      expect(audit).toBeTruthy();
      expect(audit!.alasan).toContain('Rp 0,00');
      expect(JSON.parse(audit!.data_baru_json)).toMatchObject({
        catatan: '',
        selesai: true,
      });
    } finally {
      db.close();
    }
  });
});

describe('P2-2 — migrasi v6 & data tetap setelah reopen', () => {
  it('membuat tabel + index, menaikkan user_version, dan menyimpan data', () => {
    const path = pathBaru();

    // DB lama v6: belum punya tabel rekonsiliasi; pengaturan lama dipertahankan.
    const lama = new Database(path);
    lama.exec(`
      CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL DEFAULT '');
      INSERT INTO pengaturan (kunci, nilai) VALUES ('uji-lama', 'tetap');
      PRAGMA user_version = 6;
    `);
    lama.close();

    const db = openDb(path);
    let rekId = '';
    try {
      expect(SCHEMA_VERSION).toBe(10);
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(10);
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rekonsiliasi_bank'",
          )
          .get(),
      ).toBeTruthy();
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_rekonsiliasi_akun_tanggal'",
          )
          .get(),
      ).toBeTruthy();

      const kolom = (db.pragma('table_info(rekonsiliasi_bank)') as { name: string }[]).map(
        (k) => k.name,
      );
      expect(kolom).toEqual(
        expect.arrayContaining([
          'id',
          'akun_kode',
          'tanggal',
          'saldo_bank',
          'catatan',
          'selesai',
          'created_at',
          'selesai_at',
        ]),
      );
      expect(kolom).not.toContain('saldo_buku');
      expect(kolom).not.toContain('selisih');

      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'uji-lama'").get()).toEqual({
        nilai: 'tetap',
      });

      posting(db, 'awal', '2026-01-01', 'Saldo awal', [
        ['1001', RP(4_000_000), 0],
        ['3000', 0, RP(4_000_000)],
      ]);
      const rek = buatRekonsiliasi(db, {
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(4_000_000),
        catatan: 'Cek awal tahun',
      });
      rekId = rek.id;
      expect(rek.saldo_buku).toBe(RP(4_000_000));
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(Number(db2.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
      const rows = listRekonsiliasi(db2);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: rekId,
        akun_kode: '1001',
        tanggal: '2026-01-31',
        saldo_bank: RP(4_000_000),
        saldo_buku: RP(4_000_000),
        selisih: 0,
        status: 'COCOK',
        catatan: 'Cek awal tahun',
        selesai: false,
      });
      expect(getRekonsiliasiDetail(db2, rekId)?.saldo_akhir).toBe(RP(4_000_000));
      expect(listBarisJurnal(db2)).toHaveLength(2);
    } finally {
      db2.close();
    }
  });
});
