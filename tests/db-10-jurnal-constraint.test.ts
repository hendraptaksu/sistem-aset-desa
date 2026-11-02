// DB-10 — constraint jurnal di tingkat database.
//
// Fokus:
// - DB v13 sehat naik ke versi saat ini: partial unique index `ux_jurnal_reversal` dan
//   trigger validasi `BEFORE INSERT` terpasang, data lama tetap utuh.
// - Migrasi idempoten: index/trigger tidak dobel setelah openDb/migrasi berulang.
// - DB v13 dengan `reversal_of` duplikat menghentikan migrasi v14 dengan pesan
//   Indonesia, rollback penuh, `user_version` tetap 13, dan data tidak berubah.
// - Trigger memakai daftar `JENIS_JURNAL` dari posting layer, bukan salinan
//   terpisah yang bisa melenceng.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JENIS_JURNAL } from '../src/core/posting.js';
import {
  DDL,
  PESAN_DUPLIKAT_REVERSAL,
  SCHEMA_VERSION,
  migrasi,
  openDb,
} from '../src/db/database.js';

const WAKTU = '2026-01-01T00:00:00.000Z';
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

function indeksReversal(db: Database.Database): { name: string; sql: string } | undefined {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND name = 'ux_jurnal_reversal'`,
    )
    .get() as { name: string; sql: string } | undefined;
}

function triggerValidasi(db: Database.Database): { name: string; sql: string } | undefined {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger' AND name = 'trg_jurnal_validasi_insert'`,
    )
    .get() as { name: string; sql: string } | undefined;
}

/**
 * Fixture v13 memakai DDL produksi lalu menurunkan `user_version`. Index
 * `ux_jurnal_saldo_awal` dan `ux_jurnal_reversal` sengaja belum ada karena
 * keduanya baru dibuat migrasi v13/v14.
 */
function buatFixtureV13(
  path: string,
  opsi: { reversalOfDuplikat?: boolean } = {},
): void {
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(DDL);

    const insJurnal = db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
    );
    insJurnal.run('j-asli', '2026-01-02', 'Jurnal asli', 'UMUM', 'j-asli', null, WAKTU);
    insJurnal.run(
      'j-balik-1',
      '2026-01-03',
      'Reversal pertama',
      'REVERSAL',
      'j-asli',
      'j-asli',
      WAKTU,
    );
    if (opsi.reversalOfDuplikat) {
      insJurnal.run(
        'j-balik-2',
        '2026-01-04',
        'Reversal kedua',
        'REVERSAL',
        'j-asli',
        'j-asli',
        WAKTU,
      );
    }

    db.pragma('user_version = 13');
  } finally {
    db.close();
  }
}

describe('DB-10 — migrasi v14', () => {
  it('DB v13 sehat naik ke versi skema saat ini, data utuh, index/trigger idempoten', () => {
    const path = tmpDb('pura-db10-naik-');
    buatFixtureV13(path, { reversalOfDuplikat: false });

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(21);
      expect(versi(db)).toBe(21);

      const index = indeksReversal(db);
      expect(index?.name).toBe('ux_jurnal_reversal');
      expect(index?.sql).toMatch(/UNIQUE INDEX/);
      expect(index?.sql).toMatch(/ON jurnal\(reversal_of\)/);
      expect(index?.sql).toMatch(/WHERE reversal_of IS NOT NULL/);

      const trigger = triggerValidasi(db);
      expect(trigger?.name).toBe('trg_jurnal_validasi_insert');
      expect(trigger?.sql).toMatch(/BEFORE INSERT ON jurnal/);
      expect(trigger?.sql).toMatch(
        /GLOB '\[0-9\]\[0-9\]\[0-9\]\[0-9\]-\[0-9\]\[0-9\]-\[0-9\]\[0-9\]'/,
      );

      expect(
        db.prepare('SELECT id, reversal_of FROM jurnal ORDER BY id').all(),
      ).toEqual([
        { id: 'j-asli', reversal_of: null },
        { id: 'j-balik-1', reversal_of: 'j-asli' },
      ]);

      // Migrasi berulang tidak menggandakan index/trigger.
      expect(migrasi(db)).toBe(21);
      expect(migrasi(db)).toBe(21);
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM sqlite_master
             WHERE name IN ('ux_jurnal_reversal', 'trg_jurnal_validasi_insert')`,
          )
          .get(),
      ).toEqual({ n: 2 });
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(21);
      expect(indeksReversal(db2)?.name).toBe('ux_jurnal_reversal');
      expect(triggerValidasi(db2)?.name).toBe('trg_jurnal_validasi_insert');
    } finally {
      db2.close();
    }
  });

  it('trigger memakai seluruh JENIS_JURNAL dari posting layer', () => {
    const db = openDb(':memory:');
    try {
      const sql = triggerValidasi(db)?.sql ?? '';
      for (const jenis of JENIS_JURNAL) {
        expect(sql, `trigger harus mengenal ${jenis}`).toContain(`'${jenis}'`);
      }
      // Tidak ada salinan daftar liar di luar posting layer.
      expect(JENIS_JURNAL).toHaveLength(9);
    } finally {
      db.close();
    }
  });

  it('reversal_of duplikat di DB v13 membatalkan migrasi tanpa mengubah data', () => {
    const path = tmpDb('pura-db10-duplikat-');
    buatFixtureV13(path, { reversalOfDuplikat: true });

    const db = new Database(path);
    try {
      expect(() => migrasi(db)).toThrow(PESAN_DUPLIKAT_REVERSAL);
      expect(() => migrasi(db)).toThrow(/Migrasi v14 dibatalkan/);
      expect(() => migrasi(db)).toThrow(/reversal_of/);

      // Rollback penuh: versi, data, index, dan trigger tetap seperti v13.
      expect(versi(db)).toBe(13);
      expect(indeksReversal(db)).toBeUndefined();
      expect(triggerValidasi(db)).toBeUndefined();
      expect(
        db.prepare("SELECT name FROM sqlite_master WHERE name = 'ux_jurnal_saldo_awal'").get(),
      ).toBeUndefined();
      expect(db.prepare('SELECT COUNT(*) AS n FROM jurnal').get()).toEqual({ n: 3 });
      expect(
        db.prepare("SELECT COUNT(*) AS n FROM jurnal WHERE reversal_of = 'j-asli'").get(),
      ).toEqual({ n: 2 });
    } finally {
      db.close();
    }

    // Jalur produksi `openDb` juga menolak dan menutup koneksi tanpa mengubah file.
    expect(() => openDb(path)).toThrow(PESAN_DUPLIKAT_REVERSAL);

    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(13);
      expect(indeksReversal(cek)).toBeUndefined();
      expect(triggerValidasi(cek)).toBeUndefined();
      expect(cek.prepare('SELECT COUNT(*) AS n FROM jurnal').get()).toEqual({ n: 3 });
    } finally {
      cek.close();
    }
  });
});
