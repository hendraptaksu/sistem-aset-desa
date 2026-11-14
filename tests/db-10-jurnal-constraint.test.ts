// DB-10 — constraint jurnal pada skema aktif v1.
//
// Fokus (hanya skema v1, tanpa jalur migrasi/rollback versi lama):
// - DB baru langsung punya partial unique index `ux_jurnal_reversal` dan
//   trigger validasi `BEFORE INSERT` pada jurnal.
// - Dua REVERSAL untuk jurnal asli yang sama ditolak unique index.
// - Trigger menolak jenis/tanggal/reversal_of yang tidak valid.
// - Trigger memakai daftar `JENIS_JURNAL` dari posting layer, bukan salinan
//   terpisah yang bisa melenceng.
// - Buka ulang DB tetap menyisakan tepat satu index dan satu trigger.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JENIS_JURNAL } from '../src/core/posting.js';
import {
  PESAN_JENIS_JURNAL_DB,
  PESAN_REVERSAL_JURNAL_DB,
  PESAN_TANGGAL_JURNAL_DB,
  PESAN_TANGGAL_KALENDER_JURNAL_DB,
  SCHEMA_VERSION,
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

type JurnalInput = {
  id: string;
  tanggal?: string;
  jenis?: string;
  reversal_of?: string | null;
};

function insJurnal(db: Database.Database): (j: JurnalInput) => void {
  const ins = db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
  );
  return (j) => {
    const jenis = j.jenis ?? 'UMUM';
    ins.run(
      j.id,
      j.tanggal ?? '2026-01-02',
      `Keterangan ${j.id}`,
      jenis,
      jenis === 'REVERSAL' ? (j.reversal_of ?? 'j-asli') : j.id,
      j.reversal_of ?? null,
      WAKTU,
    );
  };
}

function hitungObjek(db: Database.Database, nama: string): number {
  return Number(
    (
      db
        .prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?')
        .get(nama) as { n: number }
    ).n,
  );
}

describe('DB-10 — constraint jurnal skema v1', () => {
  it('DB v1 baru langsung punya index reversal parsial dan trigger validasi insert', () => {
    const db = openDb(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(2);
      expect(versi(db)).toBe(2);

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
    } finally {
      db.close();
    }
  });

  it('trigger memakai seluruh JENIS_JURNAL dari posting layer', () => {
    const db = openDb(':memory:');
    try {
      const sql = triggerValidasi(db)?.sql ?? '';
      for (const jenis of JENIS_JURNAL) {
        expect(sql, `trigger harus mengenal ${jenis}`).toContain(`'${jenis}'`);
      }
    } finally {
      db.close();
    }
  });

  it('dua REVERSAL untuk jurnal asli yang sama ditolak unique index', () => {
    const db = openDb(':memory:');
    try {
      const ins = insJurnal(db);
      ins({ id: 'j-asli' });
      ins({ id: 'j-balik-1', tanggal: '2026-01-03', jenis: 'REVERSAL', reversal_of: 'j-asli' });

      expect(() =>
        ins({ id: 'j-balik-2', tanggal: '2026-01-04', jenis: 'REVERSAL', reversal_of: 'j-asli' }),
      ).toThrow(/UNIQUE constraint failed.*reversal_of/i);

      expect(
        db.prepare("SELECT COUNT(*) AS n FROM jurnal WHERE reversal_of = 'j-asli'").get(),
      ).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('trigger menolak jenis jurnal tak dikenal', () => {
    const db = openDb(':memory:');
    try {
      expect(() => insJurnal(db)({ id: 'j-jenis', jenis: 'ANEH' })).toThrow(
        PESAN_JENIS_JURNAL_DB,
      );
    } finally {
      db.close();
    }
  });

  it('trigger menolak tanggal yang bukan format YYYY-MM-DD', () => {
    const db = openDb(':memory:');
    try {
      expect(() => insJurnal(db)({ id: 'j-tanggal', tanggal: '01-01-2026' })).toThrow(
        PESAN_TANGGAL_JURNAL_DB,
      );
      expect(() => insJurnal(db)({ id: 'j-tanggal-2', tanggal: '2026-1-01' })).toThrow(
        PESAN_TANGGAL_JURNAL_DB,
      );
    } finally {
      db.close();
    }
  });

  it('trigger menolak tanggal kalender mustahil seperti 2026-02-30', () => {
    const db = openDb(':memory:');
    try {
      expect(() => insJurnal(db)({ id: 'j-kalender', tanggal: '2026-02-30' })).toThrow(
        PESAN_TANGGAL_KALENDER_JURNAL_DB,
      );
    } finally {
      db.close();
    }
  });

  it('trigger menolak REVERSAL tanpa reversal_of', () => {
    const db = openDb(':memory:');
    try {
      expect(() =>
        insJurnal(db)({ id: 'j-reversal', jenis: 'REVERSAL', reversal_of: null }),
      ).toThrow(PESAN_REVERSAL_JURNAL_DB);
    } finally {
      db.close();
    }
  });

  it('trigger menolak non-REVERSAL yang mengisi reversal_of', () => {
    const db = openDb(':memory:');
    try {
      const ins = insJurnal(db);
      ins({ id: 'j-asli' });
      expect(() => ins({ id: 'j-umum', jenis: 'UMUM', reversal_of: 'j-asli' })).toThrow(
        PESAN_REVERSAL_JURNAL_DB,
      );
    } finally {
      db.close();
    }
  });

  it('buka ulang DB tetap menyisakan tepat satu index dan satu trigger', () => {
    const path = tmpDb('pura-db10-idempoten-');

    const db = openDb(path);
    try {
      insJurnal(db)({ id: 'j-asli' });
      expect(hitungObjek(db, 'ux_jurnal_reversal')).toBe(1);
      expect(hitungObjek(db, 'trg_jurnal_validasi_insert')).toBe(1);
    } finally {
      db.close();
    }

    for (let i = 0; i < 2; i += 1) {
      const buka = openDb(path);
      try {
        expect(versi(buka)).toBe(2);
        expect(hitungObjek(buka, 'ux_jurnal_reversal')).toBe(1);
        expect(hitungObjek(buka, 'trg_jurnal_validasi_insert')).toBe(1);
        expect(indeksReversal(buka)?.sql).toMatch(/WHERE reversal_of IS NOT NULL/);
        expect(buka.prepare("SELECT id FROM jurnal WHERE id = 'j-asli'").get()).toEqual({
          id: 'j-asli',
        });
      } finally {
        buka.close();
      }
    }
  });
});
