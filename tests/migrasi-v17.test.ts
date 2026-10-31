// DB-18 — migrasi v16 → v17: kolom detail nota pada `panjar_item`.
//
// Fixture v16 dibuat dari DB current lalu empat kolom DB-18 di-drop dan
// user_version diturunkan. Ini meniru DB yang dibuat sebelum DB-18: baris
// panjar_item lama belum punya nota_nomor/nota_tanggal/toko/keterangan.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { listPanjarItemsV2 } from '../src/db/panjar.js';

const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-v17-'));
  dirs.push(dir);
  return dir;
}

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function kolomPanjarItem(db: Database.Database): string[] {
  return (db.pragma('table_info(panjar_item)') as { name: string }[]).map(
    (k) => k.name,
  );
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Buat DB v16: metadata panjar v2 ada, tetapi kolom DB-18 belum ada. */
function buatFixtureV16(path: string): void {
  const db = openDb(path);
  try {
    db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES ('j-panjar-lama', '2026-02-01', 'P-LAMA-1', 'Panjar lama', 'PANJAR',
               'j-panjar-lama', NULL, '2026-02-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO panjar
         (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
          tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
       VALUES ('p-lama', '2026-02-01', 'Panitia Lama', 50000, '1001', 'OPEN',
               NULL, 'j-panjar-lama', NULL, '2026-02-01T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO panjar_item (panjar_id, kategori_baga, nominal, jurnal_id)
       VALUES ('p-lama', '5004', 50000, 'j-panjar-lama')`,
    ).run();

    db.pragma('user_version = 16');
    db.exec('ALTER TABLE panjar_item DROP COLUMN keterangan');
    db.exec('ALTER TABLE panjar_item DROP COLUMN toko');
    db.exec('ALTER TABLE panjar_item DROP COLUMN nota_tanggal');
    db.exec('ALTER TABLE panjar_item DROP COLUMN nota_nomor');
  } finally {
    db.close();
  }
}

describe('DB-18 — migrasi v17 detail nota panjar', () => {
  it('menambah empat kolom dan memberi default kosong pada baris lama', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV16(path);

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(18);
      expect(versi(db)).toBe(18);
      expect(kolomPanjarItem(db)).toEqual(
        expect.arrayContaining([
          'nota_nomor',
          'nota_tanggal',
          'toko',
          'keterangan',
        ]),
      );

      const items = listPanjarItemsV2(db, 'p-lama');
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        kategori_baga: '5004',
        nominal: 50000,
        nota_nomor: '',
        nota_tanggal: '',
        toko: '',
        keterangan: '',
        jurnal_id: 'j-panjar-lama',
      });
    } finally {
      db.close();
    }
  });

  it('idempoten saat dibuka ulang dan tetap bisa menyimpan nota baru', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV16(path);

    let db = openDb(path);
    try {
      db.prepare(
        `INSERT INTO panjar_item
           (panjar_id, kategori_baga, nominal, jurnal_id,
            nota_nomor, nota_tanggal, toko, keterangan)
         VALUES ('p-lama', '5004', 25000, 'j-panjar-lama',
                 'N-002', '2026-02-02', 'Toko Baru', 'nota setelah migrasi')`,
      ).run();
    } finally {
      db.close();
    }

    db = openDb(path);
    try {
      expect(versi(db)).toBe(18);
      const items = listPanjarItemsV2(db, 'p-lama');
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({
        nota_nomor: '',
        nota_tanggal: '',
        toko: '',
        keterangan: '',
      });
      expect(items[1]).toMatchObject({
        nominal: 25000,
        nota_nomor: 'N-002',
        nota_tanggal: '2026-02-02',
        toko: 'Toko Baru',
        keterangan: 'nota setelah migrasi',
      });
    } finally {
      db.close();
    }

    // DB baru langsung memakai DDL current: default kolom tetap string kosong.
    const baru = openDb(':memory:');
    try {
      expect(versi(baru)).toBe(18);
      const info = baru.pragma('table_info(panjar_item)') as {
        name: string;
        dflt_value: string | null;
      }[];
      for (const nama of ['nota_nomor', 'nota_tanggal', 'toko', 'keterangan']) {
        const kolom = info.find((k) => k.name === nama);
        expect(kolom?.dflt_value, nama).toBe("''");
      }
    } finally {
      baru.close();
    }
  });
});
