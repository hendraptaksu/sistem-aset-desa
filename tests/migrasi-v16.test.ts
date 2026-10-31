// DB-14 — migrasi v15 → v16: kolom metadata akun + backfill idempoten.
//
// Fixture v15 dibuat dari DB v16 lalu tiga kolom baru di-drop dan user_version
// diturunkan. Ini meniru DB yang dibuat sebelum DB-14: tabel `akun` belum punya
// is_kas/kelompok/sumber, tetapi data COA + akun operator sudah ada.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { getAkun, listAkun } from '../src/db/repository.js';

const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-v16-'));
  dirs.push(dir);
  return dir;
}

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function kolomAkun(db: Database.Database): string[] {
  return (db.pragma('table_info(akun)') as { name: string }[]).map((k) => k.name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Buat DB v15: data lengkap, tetapi kolom DB-14 belum ada. */
function buatFixtureV15(path: string): void {
  const db = openDb(path);
  try {
    db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif, is_kas, kelompok, sumber)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run('5011', 'PENGELUARAN ARTOS', 'BEBAN', 'DEBIT', 0, 'BEBAN', 'TAMBAHAN');
    db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif, is_kas, kelompok, sumber)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    ).run('1101', 'AKTIVA LAMA TANPA PENANDA', 'AKTIVA', 'DEBIT', 0, '', 'TAMBAHAN');

    db.pragma('user_version = 15');
    db.exec('ALTER TABLE akun DROP COLUMN sumber');
    db.exec('ALTER TABLE akun DROP COLUMN kelompok');
    db.exec('ALTER TABLE akun DROP COLUMN is_kas');
  } finally {
    db.close();
  }
}

describe('DB-14 — migrasi v16 metadata akun', () => {
  it('menambah kolom, mem-backfill COA dan akun tambahan, lalu naik ke v16', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV15(path);

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(19);
      expect(versi(db)).toBe(19);
      expect(kolomAkun(db)).toEqual(
        expect.arrayContaining(['is_kas', 'kelompok', 'sumber']),
      );

      // COA bawaan: pemetaan tetap dan sumber BAWAAN.
      expect(getAkun(db, '1001')).toMatchObject({
        is_kas: true,
        kelompok: 'KAS',
        sumber: 'BAWAAN',
      });
      expect(getAkun(db, '1010')).toMatchObject({
        is_kas: true,
        kelompok: 'LPD',
        sumber: 'BAWAAN',
      });
      expect(getAkun(db, '1029')).toMatchObject({
        is_kas: true,
        kelompok: 'BANK',
        sumber: 'BAWAAN',
      });
      expect(getAkun(db, '1040')).toMatchObject({
        is_kas: false,
        kelompok: 'PANJAR',
        sumber: 'BAWAAN',
      });
      expect(getAkun(db, '1050')).toMatchObject({
        is_kas: false,
        kelompok: 'PIUTANG',
        sumber: 'BAWAAN',
      });
      for (const kode of ['2050', '2060']) {
        expect(getAkun(db, kode)).toMatchObject({
          is_kas: false,
          kelompok: 'HUTANG',
          sumber: 'BAWAAN',
        });
      }
      for (const kode of ['3000', '3001', '3002']) {
        expect(getAkun(db, kode)).toMatchObject({
          is_kas: false,
          kelompok: 'EKUITAS',
          sumber: 'BAWAAN',
        });
      }
      expect(getAkun(db, '4005')).toMatchObject({
        is_kas: false,
        kelompok: 'PENDAPATAN',
        sumber: 'BAWAAN',
      });
      expect(getAkun(db, '5003')).toMatchObject({
        is_kas: false,
        kelompok: 'BEBAN',
        sumber: 'BAWAAN',
      });

      // Akun di luar COA = TAMBAHAN; is_kas default 0, kelompok dari tipe.
      expect(getAkun(db, '5011')).toMatchObject({
        nama: 'PENGELUARAN ARTOS',
        is_kas: false,
        kelompok: 'BEBAN',
        sumber: 'TAMBAHAN',
      });
      expect(getAkun(db, '1101')).toMatchObject({
        nama: 'AKTIVA LAMA TANPA PENANDA',
        is_kas: false,
        kelompok: '',
        sumber: 'TAMBAHAN',
      });

      // 56 COA + 2 akun fixture; akun COA tidak bertambah/berkurang.
      expect(listAkun(db)).toHaveLength(58);
    } finally {
      db.close();
    }
  });

  it('idempoten: reopen tidak mengubah metadata/identitas akun TAMBAHAN', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV15(path);

    let db = openDb(path);
    try {
      db.prepare(
        "UPDATE akun SET is_kas = 1, kelompok = 'LPD', nama = 'BANK LPD BARU' WHERE kode = '1101'",
      ).run();
    } finally {
      db.close();
    }

    db = openDb(path);
    try {
      expect(versi(db)).toBe(19);
      expect(getAkun(db, '1101')).toMatchObject({
        nama: 'BANK LPD BARU',
        tipe: 'AKTIVA',
        aktif: true,
        is_kas: true,
        kelompok: 'LPD',
        sumber: 'TAMBAHAN',
      });
      expect(getAkun(db, '5011')).toMatchObject({
        nama: 'PENGELUARAN ARTOS',
        tipe: 'BEBAN',
        is_kas: false,
        kelompok: 'BEBAN',
        sumber: 'TAMBAHAN',
      });
    } finally {
      db.close();
    }
  });
});
