// DB-11 — constraint akun di tingkat database.
//
// Fokus:
// - Migrasi v15 memasang unique index nama akun NOCASE + trigger validasi
//   BEFORE INSERT/UPDATE tanpa rebuild tabel.
// - Semua pelanggaran kode/nama/tipe/posisi/aktif ditolak dengan pesan field.
// - Nama yang hanya berbeda huruf besar/kecil ditolak DB.
// - Akun bawaan (COA) dan akun tambahan normal tetap lolos.
// - DB v14 dengan nama duplikat NOCASE menghentikan migrasi dengan rollback
//   penuh: user_version tetap 14 dan data tidak berubah.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COA, POSISI_NORMAL } from '../src/db/coa.js';
import {
  DDL,
  PESAN_AKTIF_AKUN_DB,
  PESAN_DUPLIKAT_NAMA_AKUN,
  PESAN_KODE_AKUN_DB,
  PESAN_NAMA_AKUN_DB,
  PESAN_POSISI_AKUN_DB,
  PESAN_TIPE_AKUN_DB,
  SCHEMA_VERSION,
  migrasi,
  openDb,
} from '../src/db/database.js';
import { getAkun, listAkun, tambahAkun } from '../src/db/repository.js';

const dirs: string[] = [];

function tmpDb(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return join(dir, 'pura.db');
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function objekSql(
  db: Database.Database,
  tipe: 'index' | 'trigger',
  nama: string,
): { name: string; sql: string } | undefined {
  return db
    .prepare('SELECT name, sql FROM sqlite_master WHERE type = ? AND name = ?')
    .get(tipe, nama) as { name: string; sql: string } | undefined;
}

/**
 * Fixture v14: DDL produksi tanpa index/trigger v13–v15, lalu user_version
 * diturunkan. Duplikat nama sengaja dibuat dengan beda kapital agar menguji
 * pemeriksaan NOCASE di migrasi v15.
 */
function buatFixtureV14(path: string, opsi: { duplikatNama?: boolean } = {}): void {
  const db = new Database(path);
  try {
    db.exec(DDL);
    const ins = db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif) VALUES (?, ?, ?, ?, 1)`,
    );
    ins.run('1001', 'KAS', 'AKTIVA', 'DEBIT');
    ins.run('2050', 'HUTANG LAIN-LAIN', 'KEWAJIBAN', 'KREDIT');
    ins.run('3000', 'MODAL', 'EKUITAS', 'KREDIT');
    ins.run('4001', 'PENDAPATAN BEJI', 'PENDAPATAN', 'KREDIT');
    ins.run('5000', 'BIAYA KESEKRETARIATAN', 'BEBAN', 'DEBIT');
    if (opsi.duplikatNama) ins.run('5901', 'kas', 'BEBAN', 'DEBIT');
    db.pragma('user_version = 14');
  } finally {
    db.close();
  }
}

const insAkun = (db: Database.Database) =>
  db.prepare(
    `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif) VALUES (?, ?, ?, ?, ?)`,
  );

describe('DB-11 — migrasi v15', () => {
  it('DB v14 sehat naik ke v15; index/trigger aktif, COA dan akun baru lolos', () => {
    const path = tmpDb('pura-db11-naik-');
    buatFixtureV14(path);

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(18);
      expect(versi(db)).toBe(18);

      const index = objekSql(db, 'index', 'ux_akun_nama_nocase');
      expect(index?.sql).toMatch(/UNIQUE INDEX/);
      expect(index?.sql).toMatch(/ON akun\(nama COLLATE NOCASE\)/);

      const insertTrigger = objekSql(db, 'trigger', 'trg_akun_validasi_insert');
      const updateTrigger = objekSql(db, 'trigger', 'trg_akun_validasi_update');
      expect(insertTrigger?.sql).toMatch(/BEFORE INSERT ON akun/);
      expect(updateTrigger?.sql).toMatch(/BEFORE UPDATE ON akun/);
      const sqlTrigger = `${insertTrigger?.sql ?? ''}\n${updateTrigger?.sql ?? ''}`;
      for (const tipe of Object.keys(POSISI_NORMAL)) {
        expect(sqlTrigger, `trigger harus mengenal tipe ${tipe}`).toContain(`'${tipe}'`);
      }

      // Seed COA berjalan setelah trigger dibuat, jadi semua akun bawaan harus
      // lolos constraint. Data lama yang sudah ada tetap dipertahankan.
      expect(listAkun(db)).toHaveLength(COA.length);
      for (const akun of COA) {
        expect(getAkun(db, akun.kode), `akun ${akun.kode} harus ada`).toMatchObject({
          kode: akun.kode,
          nama: akun.nama,
          tipe: akun.tipe,
          posisi_normal: akun.posisi_normal,
        });
      }
      expect(getAkun(db, '2050')?.nama).toBe('HUTANG LAIN-LAIN');

      // Akun tambahan normal (bukan COA) tetap bisa disimpan.
      const baru = tambahAkun(db, {
        kode: '5011',
        nama: 'AKUN UJI DB-11',
        tipe: 'BEBAN',
      });
      expect(baru).toMatchObject({
        kode: '5011',
        nama: 'AKUN UJI DB-11',
        tipe: 'BEBAN',
        posisi_normal: 'DEBIT',
        aktif: true,
      });

      // Migrasi berulang tidak menggandakan index/trigger.
      expect(migrasi(db)).toBe(18);
      expect(migrasi(db)).toBe(18);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM sqlite_master
             WHERE name IN ('ux_akun_nama_nocase',
               'trg_akun_validasi_insert', 'trg_akun_validasi_update')`,
          )
          .get(),
      ).toEqual({ n: 3 });
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(18);
      expect(objekSql(db2, 'index', 'ux_akun_nama_nocase')?.name).toBe('ux_akun_nama_nocase');
      expect(getAkun(db2, '5011')?.nama).toBe('AKUN UJI DB-11');
    } finally {
      db2.close();
    }
  });

  it('trigger akun selalu dibuat ulang dengan body terbaru (DROP + CREATE)', () => {
    const db = openDb(':memory:');
    try {
      db.exec(`
        DROP TRIGGER IF EXISTS trg_akun_validasi_insert;
        CREATE TRIGGER trg_akun_validasi_insert
        BEFORE INSERT ON akun
        WHEN NEW.kode = '9999'
        BEGIN
          SELECT RAISE(ABORT, 'BODY-LAMA-DB-11');
        END;
      `);
      expect(objekSql(db, 'trigger', 'trg_akun_validasi_insert')?.sql).toContain(
        'BODY-LAMA-DB-11',
      );

      expect(migrasi(db)).toBe(18);
      const sql = objekSql(db, 'trigger', 'trg_akun_validasi_insert')?.sql ?? '';
      expect(sql).not.toContain('BODY-LAMA-DB-11');
      expect(sql).toMatch(/BEFORE INSERT ON akun/);
      expect(sql).toContain(PESAN_KODE_AKUN_DB);
      expect(objekSql(db, 'trigger', 'trg_akun_validasi_update')?.sql).toMatch(
        /BEFORE UPDATE ON akun/,
      );
    } finally {
      db.close();
    }
  });
});

describe('DB-11 — validasi akun pada INSERT dan UPDATE', () => {
  const kasus = [
    {
      label: 'kode 3 digit',
      kode: '123',
      nama: 'AKUN KODE PENDEK',
      tipe: 'BEBAN',
      posisi: 'DEBIT',
      aktif: 1,
      pesan: PESAN_KODE_AKUN_DB,
    },
    {
      label: 'kode bukan angka',
      kode: 'ABCD',
      nama: 'AKUN KODE HURUF',
      tipe: 'BEBAN',
      posisi: 'DEBIT',
      aktif: 1,
      pesan: PESAN_KODE_AKUN_DB,
    },
    {
      label: 'nama kosong',
      kode: '5901',
      nama: '   ',
      tipe: 'BEBAN',
      posisi: 'DEBIT',
      aktif: 1,
      pesan: PESAN_NAMA_AKUN_DB,
    },
    {
      label: 'tipe tidak dikenal',
      kode: '5902',
      nama: 'AKUN TIPE SALAH',
      tipe: 'ASET',
      posisi: 'DEBIT',
      aktif: 1,
      pesan: PESAN_TIPE_AKUN_DB,
    },
    {
      label: 'posisi normal tidak cocok',
      kode: '5903',
      nama: 'AKUN POSISI SALAH',
      tipe: 'BEBAN',
      posisi: 'KREDIT',
      aktif: 1,
      pesan: PESAN_POSISI_AKUN_DB,
    },
    {
      label: 'aktif bukan 0/1',
      kode: '5904',
      nama: 'AKUN AKTIF SALAH',
      tipe: 'BEBAN',
      posisi: 'DEBIT',
      aktif: 2,
      pesan: PESAN_AKTIF_AKUN_DB,
    },
  ] as const;

  it('setiap pelanggaran ditolak pada INSERT dengan pesan field yang jelas', () => {
    const db = openDb(':memory:');
    try {
      const ins = insAkun(db);
      for (const k of kasus) {
        expect(
          () => ins.run(k.kode, k.nama, k.tipe, k.posisi, k.aktif),
          k.label,
        ).toThrow(k.pesan);
      }
      expect(db.prepare("SELECT COUNT(*) AS n FROM akun WHERE kode LIKE '590%'").get()).toEqual({
        n: 0,
      });
    } finally {
      db.close();
    }
  });

  it('setiap pelanggaran ditolak pada UPDATE dengan pesan field yang jelas', () => {
    const db = openDb(':memory:');
    try {
      insAkun(db).run('5900', 'AKUN UJI VALIDASI', 'BEBAN', 'DEBIT', 1);
      const ubah = db.prepare(
        `UPDATE akun SET kode = ?, nama = ?, tipe = ?, posisi_normal = ?, aktif = ?
         WHERE kode = '5900'`,
      );
      for (const k of kasus) {
        expect(
          () => ubah.run(k.kode, k.nama, k.tipe, k.posisi, k.aktif),
          k.label,
        ).toThrow(k.pesan);
      }
      expect(getAkun(db, '5900')).toMatchObject({
        nama: 'AKUN UJI VALIDASI',
        tipe: 'BEBAN',
        posisi_normal: 'DEBIT',
        aktif: true,
      });

      // Update valid tetap lolos setelah semua penolakan.
      expect(() => ubah.run('5901', 'AKUN UJI VALIDASI BARU', 'PENDAPATAN', 'KREDIT', 0)).not.toThrow();
      expect(getAkun(db, '5901')).toMatchObject({
        nama: 'AKUN UJI VALIDASI BARU',
        tipe: 'PENDAPATAN',
        posisi_normal: 'KREDIT',
        aktif: false,
      });
    } finally {
      db.close();
    }
  });

  it('nama yang hanya berbeda kapital ditolak pada INSERT dan UPDATE', () => {
    const db = openDb(':memory:');
    try {
      const ins = insAkun(db);
      expect(() => ins.run('5901', 'kas', 'BEBAN', 'DEBIT', 1)).toThrow(
        /UNIQUE constraint failed/i,
      );

      ins.run('5902', 'AKUN UNIK UJI', 'BEBAN', 'DEBIT', 1);
      expect(() =>
        db.prepare("UPDATE akun SET nama = 'kas' WHERE kode = '5902'").run(),
      ).toThrow(/UNIQUE constraint failed/i);
      expect(getAkun(db, '5902')?.nama).toBe('AKUN UNIK UJI');
    } finally {
      db.close();
    }
  });
});

describe('DB-11 — duplikat nama di DB v14 membatalkan migrasi', () => {
  it('migrasi v15 rollback penuh dan tidak mengubah data', () => {
    const path = tmpDb('pura-db11-duplikat-');
    buatFixtureV14(path, { duplikatNama: true });

    const db = new Database(path);
    try {
      expect(() => migrasi(db)).toThrow(PESAN_DUPLIKAT_NAMA_AKUN);
      expect(() => migrasi(db)).toThrow(/Migrasi v15 dibatalkan/);
      expect(() => migrasi(db)).toThrow(/nama akun duplikat/i);

      // Rollback penuh: versi dan data tetap v14; index/trigger v15 tidak ada.
      expect(versi(db)).toBe(14);
      expect(objekSql(db, 'index', 'ux_akun_nama_nocase')).toBeUndefined();
      expect(objekSql(db, 'trigger', 'trg_akun_validasi_insert')).toBeUndefined();
      expect(objekSql(db, 'trigger', 'trg_akun_validasi_update')).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM akun').get()).toEqual({ n: 6 });
      expect(
        db.prepare("SELECT kode, nama FROM akun WHERE kode IN ('1001', '5901') ORDER BY kode").all(),
      ).toEqual([
        { kode: '1001', nama: 'KAS' },
        { kode: '5901', nama: 'kas' },
      ]);
    } finally {
      db.close();
    }

    // Jalur produksi `openDb` juga menolak tanpa mengubah isi file.
    expect(() => openDb(path)).toThrow(PESAN_DUPLIKAT_NAMA_AKUN);

    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(14);
      expect(objekSql(cek, 'index', 'ux_akun_nama_nocase')).toBeUndefined();
      expect(objekSql(cek, 'trigger', 'trg_akun_validasi_insert')).toBeUndefined();
      expect(cek.prepare('SELECT COUNT(*) AS n FROM akun').get()).toEqual({ n: 6 });
    } finally {
      cek.close();
    }
  });
});
