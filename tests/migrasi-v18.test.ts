// DB-20 — migrasi v17 → v18: link jurnal open/close panjar unik.
//
// Fixture v17 dibuat dari DB current lalu dua unique index DB-20 di-drop dan
// user_version diturunkan. Ini meniru DB sebelum DB-20. Duplikat di-seed lewat
// SQL langsung (bukan API) untuk membuktikan migrasi berhenti dengan pesan
// Indonesia tanpa mengubah data/user_version.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  PESAN_DUPLIKAT_JURNAL_CLOSE_PANJAR,
  PESAN_DUPLIKAT_JURNAL_OPEN_PANJAR,
  SCHEMA_VERSION,
  openDb,
} from '../src/db/database.js';
import { auditIntegritas } from '../src/db/integritas.js';

const WAKTU = '2026-10-31T00:00:00.000Z';
const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-v18-'));
  dirs.push(dir);
  return dir;
}

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function daftarIndex(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function lepasIndexV18(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS ux_panjar_jurnal_close;
    DROP INDEX IF EXISTS ux_panjar_jurnal_open;
  `);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function buatJurnal(
  db: Database.Database,
  id: string,
  tanggal: string,
  jenis = 'PANJAR',
): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, ?, '', ?, ?, ?, NULL, ?)`,
  ).run(id, tanggal, `Uji ${id}`, jenis, id, WAKTU);
}

function buatBaris(
  db: Database.Database,
  jurnalId: string,
  akun: string,
  debit: number,
  kredit: number,
): void {
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, ?, ?, ?, '')`,
  ).run(jurnalId, akun, debit, kredit);
}

function jurnalOpen(
  db: Database.Database,
  id: string,
  tanggal = '2026-02-01',
  jumlah = 100_000,
  kas = '1001',
): void {
  buatJurnal(db, id, tanggal);
  buatBaris(db, id, '1040', jumlah, 0);
  buatBaris(db, id, kas, 0, jumlah);
}

function jurnalClose(
  db: Database.Database,
  id: string,
  tanggal = '2026-02-02',
  jumlah = 100_000,
): void {
  buatJurnal(db, id, tanggal);
  buatBaris(db, id, '5004', jumlah, 0);
  buatBaris(db, id, '1040', 0, jumlah);
}

function buatPanjar(
  db: Database.Database,
  data: {
    id: string;
    openId: string;
    closeId?: string | null;
    status?: 'OPEN' | 'CLOSED';
    tanggal?: string;
    jumlah?: number;
    kas?: string;
  },
): void {
  db.prepare(
    `INSERT INTO panjar
       (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
        tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
     VALUES (?, ?, 'Penerima Uji', ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    data.id,
    data.tanggal ?? '2026-02-01',
    data.jumlah ?? 100_000,
    data.kas ?? '1001',
    data.status ?? 'OPEN',
    data.status === 'CLOSED' ? '2026-02-02' : null,
    data.openId,
    data.closeId ?? null,
    WAKTU,
  );
}

/** Buat DB v17: index DB-20 dilepas dulu agar fixture duplikat bisa di-seed. */
function buatFixtureV17(
  path: string,
  seed: (db: Database.Database) => void,
): void {
  const db = openDb(path);
  try {
    lepasIndexV18(db);
    seed(db);
    db.pragma('user_version = 17');
  } finally {
    db.close();
  }
}

describe('DB-20 — migrasi v18 link jurnal panjar unik', () => {
  it('membuat dua unique index, mempertahankan data, dan idempoten', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV17(path, (db) => {
      jurnalOpen(db, 'j-open');
      jurnalClose(db, 'j-close');
      buatPanjar(db, {
        id: 'p-1',
        openId: 'j-open',
        closeId: 'j-close',
        status: 'CLOSED',
      });
      db.prepare(
        `INSERT INTO panjar_item (panjar_id, kategori_baga, nominal, jurnal_id)
         VALUES ('p-1', '5004', 100000, 'j-close')`,
      ).run();
    });

    let db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(19);
      expect(versi(db)).toBe(19);
      expect(daftarIndex(db)).toEqual(
        expect.arrayContaining(['ux_panjar_jurnal_open', 'ux_panjar_jurnal_close']),
      );
      const sqlClose = (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE name = 'ux_panjar_jurnal_close'")
          .get() as { sql: string }
      ).sql;
      expect(sqlClose).toMatch(/WHERE jurnal_close_id IS NOT NULL/i);

      expect(
        db.prepare('SELECT id, status, jurnal_open_id, jurnal_close_id FROM panjar').all(),
      ).toEqual([
        {
          id: 'p-1',
          status: 'CLOSED',
          jurnal_open_id: 'j-open',
          jurnal_close_id: 'j-close',
        },
      ]);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM panjar_item').get() as { n: number }).n,
      ).toBe(1);
      expect(auditIntegritas(db).ok).toBe(true);
    } finally {
      db.close();
    }

    db = openDb(path);
    try {
      expect(versi(db)).toBe(19);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM panjar').get() as { n: number }).n,
      ).toBe(1);
    } finally {
      db.close();
    }
  });

  it('membatalkan migrasi bila jurnal_open_id duplikat tanpa mengubah data', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV17(path, (db) => {
      jurnalOpen(db, 'j-open-sama');
      jurnalOpen(db, 'j-open-lain');
      buatPanjar(db, { id: 'p-a', openId: 'j-open-sama' });
      buatPanjar(db, { id: 'p-b', openId: 'j-open-sama' });
      buatPanjar(db, { id: 'p-c', openId: 'j-open-lain' });
    });

    expect(() => openDb(path)).toThrow(PESAN_DUPLIKAT_JURNAL_OPEN_PANJAR);

    const db = new Database(path, { readonly: true });
    try {
      expect(versi(db)).toBe(17);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM panjar').get() as { n: number }).n,
      ).toBe(3);
      expect(daftarIndex(db)).not.toContain('ux_panjar_jurnal_open');
      expect(daftarIndex(db)).not.toContain('ux_panjar_jurnal_close');
    } finally {
      db.close();
    }
  });

  it('membatalkan migrasi bila jurnal_close_id duplikat tanpa mengubah data', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV17(path, (db) => {
      jurnalOpen(db, 'j-open-a');
      jurnalOpen(db, 'j-open-b');
      jurnalClose(db, 'j-close-sama');
      buatPanjar(db, {
        id: 'p-a',
        openId: 'j-open-a',
        closeId: 'j-close-sama',
        status: 'CLOSED',
      });
      buatPanjar(db, {
        id: 'p-b',
        openId: 'j-open-b',
        closeId: 'j-close-sama',
        status: 'CLOSED',
      });
    });

    expect(() => openDb(path)).toThrow(PESAN_DUPLIKAT_JURNAL_CLOSE_PANJAR);

    const db = new Database(path, { readonly: true });
    try {
      expect(versi(db)).toBe(17);
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM panjar').get() as { n: number }).n,
      ).toBe(2);
      expect(daftarIndex(db)).not.toContain('ux_panjar_jurnal_open');
      expect(daftarIndex(db)).not.toContain('ux_panjar_jurnal_close');
    } finally {
      db.close();
    }
  });

  it('menolak dua panjar dengan jurnal_open_id sama lewat SQL langsung', () => {
    const db = openDb(':memory:');
    try {
      jurnalOpen(db, 'j-open-a');
      jurnalOpen(db, 'j-open-b');
      buatPanjar(db, { id: 'p-a', openId: 'j-open-a' });

      expect(() => buatPanjar(db, { id: 'p-b', openId: 'j-open-a' })).toThrow(
        /UNIQUE constraint failed: panjar\.jurnal_open_id/,
      );
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM panjar').get() as { n: number }).n,
      ).toBe(1);

      // Jurnal open berbeda tetap sah, termasuk dua panjar dengan close NULL.
      buatPanjar(db, { id: 'p-b', openId: 'j-open-b' });
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM panjar').get() as { n: number }).n,
      ).toBe(2);
    } finally {
      db.close();
    }
  });

  it('menolak dua panjar dengan jurnal_close_id sama lewat SQL langsung', () => {
    const db = openDb(':memory:');
    try {
      jurnalOpen(db, 'j-open-a');
      jurnalOpen(db, 'j-open-b');
      jurnalClose(db, 'j-close');
      buatPanjar(db, { id: 'p-a', openId: 'j-open-a' });
      buatPanjar(db, { id: 'p-b', openId: 'j-open-b' });
      db.prepare("UPDATE panjar SET jurnal_close_id = 'j-close' WHERE id = 'p-a'").run();

      expect(() =>
        db.prepare("UPDATE panjar SET jurnal_close_id = 'j-close' WHERE id = 'p-b'").run(),
      ).toThrow(/UNIQUE constraint failed: panjar\.jurnal_close_id/);
      expect(
        db.prepare("SELECT jurnal_close_id FROM panjar WHERE id = 'p-b'").get(),
      ).toEqual({ jurnal_close_id: null });
    } finally {
      db.close();
    }
  });
});
