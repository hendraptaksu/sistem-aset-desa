// DB-11 — constraint akun pada skema aktif v1.
//
// Fokus (hanya skema v1, tanpa jalur migrasi/rollback versi lama):
// - DB baru langsung punya unique index nama akun NOCASE + trigger validasi
//   BEFORE INSERT/UPDATE tanpa rebuild tabel.
// - Semua pelanggaran kode/nama/tipe/posisi/aktif ditolak dengan pesan field.
// - Nama yang hanya berbeda huruf besar/kecil ditolak DB.
// - Seed COA (56 akun) dan akun tambahan normal lolos; repository tetap jalan.
// - CHECK metadata menolak `sumber` dan `kelompok` liar.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COA, POSISI_NORMAL } from '../src/db/coa.js';
import {
  PESAN_AKTIF_AKUN_DB,
  PESAN_KODE_AKUN_DB,
  PESAN_NAMA_AKUN_DB,
  PESAN_POSISI_AKUN_DB,
  PESAN_TIPE_AKUN_DB,
  SCHEMA_VERSION,
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

const insAkun = (db: Database.Database) =>
  db.prepare(
    `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif) VALUES (?, ?, ?, ?, ?)`,
  );

describe('DB-11 — constraint akun skema v1', () => {
  it('DB v1 baru langsung punya index nama NOCASE dan trigger validasi insert/update', () => {
    const db = openDb(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(2);
      expect(versi(db)).toBe(2);

      const index = objekSql(db, 'index', 'ux_akun_nama_nocase');
      expect(index?.name).toBe('ux_akun_nama_nocase');
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
    } finally {
      db.close();
    }
  });

  it('seed COA 56 akun lolos dan tambahAkun/listAkun/getAkun tetap berfungsi', () => {
    expect(COA).toHaveLength(56);

    const path = tmpDb('pura-db11-seed-');
    const db = openDb(path);
    try {
      expect(listAkun(db)).toHaveLength(56);
      expect(listAkun(db)).toHaveLength(COA.length);
      for (const akun of COA) {
        expect(getAkun(db, akun.kode), `akun ${akun.kode} harus ada`).toMatchObject({
          kode: akun.kode,
          nama: akun.nama,
          tipe: akun.tipe,
          posisi_normal: akun.posisi_normal,
        });
      }

      // Akun tambahan normal (bukan COA) tetap bisa disimpan lewat repository.
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
        sumber: 'TAMBAHAN',
      });
      expect(listAkun(db)).toHaveLength(57);
      expect(getAkun(db, '5011')).toMatchObject({ nama: 'AKUN UJI DB-11' });
    } finally {
      db.close();
    }

    // Buka ulang tidak menggandakan seed COA dan akun tambahan tetap ada.
    const db2 = openDb(path);
    try {
      expect(listAkun(db2)).toHaveLength(57);
      expect(getAkun(db2, '5011')?.nama).toBe('AKUN UJI DB-11');
    } finally {
      db2.close();
    }
  });

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
      expect(() =>
        ubah.run('5901', 'AKUN UJI VALIDASI BARU', 'PENDAPATAN', 'KREDIT', 0),
      ).not.toThrow();
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

  it('CHECK metadata menolak sumber liar dan kelompok liar', () => {
    const db = openDb(':memory:');
    try {
      const ins = db.prepare(
        `INSERT INTO akun
           (kode, nama, tipe, posisi_normal, aktif, is_kas, kelompok, sumber)
         VALUES (?, ?, 'BEBAN', 'DEBIT', 1, 0, ?, ?)`,
      );

      expect(() => ins.run('5910', 'AKUN SUMBER LIAR', '', 'LUAR')).toThrow(
        /CHECK constraint failed.*sumber/i,
      );
      expect(() => ins.run('5911', 'AKUN KELOMPOK LIAR', 'ASAL', 'BAWAAN')).toThrow(
        /CHECK constraint failed.*kelompok/i,
      );
      expect(getAkun(db, '5910')).toBeNull();
      expect(getAkun(db, '5911')).toBeNull();
    } finally {
      db.close();
    }
  });
});
