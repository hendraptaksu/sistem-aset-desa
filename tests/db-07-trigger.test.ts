// DB-07 — trigger skema v2 selalu dibuat dengan pola DROP + CREATE.
//
// Fokus:
// - DB v2 baru (`openDb`) memiliki tepat 14 trigger aplikasi, masing-masing
//   satu.
// - Trigger yang dihapus dipulihkan oleh `siapkanSkema(db)` maupun `openDb`
//   berikutnya.
// - Aturan integritas jurnal, audit log, dan tutup buku tetap ditegakkan.
// - Sumber `src/db/database.ts` memakai `DROP TRIGGER IF EXISTS` + `CREATE
//   TRIGGER`, bukan `CREATE TRIGGER IF NOT EXISTS`.

import type Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb, siapkanSkema } from '../src/db/database.js';

const WAKTU = '2026-01-01T00:00:00.000Z';

/** Semua trigger yang dibuat aplikasi, diurutkan seperti query sqlite_master. */
const TRIGGER_APP = [
  'trg_akun_validasi_insert',
  'trg_akun_validasi_update',
  'trg_audit_log_immutable_delete',
  'trg_audit_log_immutable_update',
  'trg_jurnal_baris_immutable_delete',
  'trg_jurnal_baris_immutable_update',
  'trg_jurnal_baris_satu_sisi_insert',
  'trg_jurnal_baris_satu_sisi_update',
  'trg_jurnal_immutable_delete',
  'trg_jurnal_immutable_update',
  'trg_jurnal_validasi_insert',
  'trg_tutup_buku_immutable_delete',
  'trg_tutup_buku_snapshot_immutable_delete',
  'trg_tutup_buku_snapshot_immutable_update',
] as const;

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

function daftarTrigger(db: Database.Database): { name: string; sql: string }[] {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger'
       ORDER BY name`,
    )
    .all() as { name: string; sql: string }[];
}

function pastikanSatuSetiap(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT name, COUNT(*) AS total FROM sqlite_master
       WHERE type = 'trigger'
       GROUP BY name
       ORDER BY name`,
    )
    .all() as { name: string; total: number }[];
  expect(rows.map((r) => r.name)).toEqual([...TRIGGER_APP]);
  expect(rows.every((r) => r.total === 1)).toBe(true);
  expect(daftarTrigger(db)).toHaveLength(TRIGGER_APP.length);
}

/** Jurnal valid minimal untuk menguji trigger baris dan immutable. */
function buatJurnal(db: Database.Database, id = 'j-db07'): string {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, '2026-01-02', '', 'Uji DB-07', 'UMUM', ?, NULL, ?)`,
  ).run(id, id, WAKTU);
  return id;
}

function buatBarisValid(db: Database.Database, jurnalId: string): void {
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, '1001', 1000, 0, '')`,
  ).run(jurnalId);
}

describe('DB-07 — trigger skema v2', () => {
  it('DB v2 baru memiliki tepat 14 trigger aplikasi, masing-masing satu', () => {
    const db = openDb(':memory:');
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      pastikanSatuSetiap(db);
      expect(daftarTrigger(db).map((t) => t.name)).toEqual([...TRIGGER_APP]);
    } finally {
      db.close();
    }
  });

  it('trigger yang dihapus dipulihkan oleh siapkanSkema(db)', () => {
    const db = openDb(':memory:');
    try {
      const harapan = daftarTrigger(db);
      const dihapus = [
        'trg_jurnal_validasi_insert',
        'trg_jurnal_baris_satu_sisi_insert',
        'trg_tutup_buku_immutable_delete',
      ];
      for (const nama of dihapus) db.exec(`DROP TRIGGER ${nama}`);

      expect(daftarTrigger(db)).toHaveLength(TRIGGER_APP.length - dihapus.length);
      for (const nama of dihapus) {
        expect(daftarTrigger(db).map((t) => t.name)).not.toContain(nama);
      }

      siapkanSkema(db);

      expect(daftarTrigger(db)).toEqual(harapan);
      pastikanSatuSetiap(db);
    } finally {
      db.close();
    }
  });

  it('trigger yang dihapus dipulihkan oleh openDb berikutnya', () => {
    const path = tmpDb('pura-db07-pulih-');
    let harapan: { name: string; sql: string }[] = [];

    const db = openDb(path);
    try {
      harapan = daftarTrigger(db);
      db.exec('DROP TRIGGER trg_audit_log_immutable_update');
      db.exec('DROP TRIGGER trg_jurnal_immutable_delete');
      expect(daftarTrigger(db)).toHaveLength(TRIGGER_APP.length - 2);
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(SCHEMA_VERSION);
      expect(daftarTrigger(db2)).toEqual(harapan);
      pastikanSatuSetiap(db2);
    } finally {
      db2.close();
    }
  });
});

describe('DB-07 — aturan integritas', () => {
  it('baris jurnal menolak dua sisi, pecahan, negatif, dan dua sisi nol', () => {
    const db = openDb(':memory:');
    try {
      const jurnalId = buatJurnal(db);
      const insert = db.prepare(
        `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
         VALUES (?, '1001', ?, ?, '')`,
      );

      expect(() => insert.run(jurnalId, 1, 1)).toThrow(
        /debit dan kredit sekaligus/,
      );
      expect(() => insert.run(jurnalId, 1.5, 0)).toThrow(/REAL|bilangan bulat/);
      expect(() => insert.run(jurnalId, -1, 0)).toThrow(/tidak boleh negatif/);
      expect(() => insert.run(jurnalId, 0, 0)).toThrow(/salah satu sisi/);

      // Tidak ada baris yang lolos dari percobaan di atas.
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM jurnal_baris').get(),
      ).toEqual({ n: 0 });

      buatBarisValid(db, jurnalId);
      expect(
        db.prepare('SELECT COUNT(*) AS n FROM jurnal_baris').get(),
      ).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('jurnal dan jurnal_baris immutable; audit_log dan tutup_buku tidak bisa dihapus', () => {
    const db = openDb(':memory:');
    try {
      const jurnalId = buatJurnal(db);
      buatBarisValid(db, jurnalId);

      expect(() =>
        db
          .prepare("UPDATE jurnal SET keterangan = 'Diubah' WHERE id = ?")
          .run(jurnalId),
      ).toThrow(/Jurnal tidak boleh diubah/);
      expect(() =>
        db.prepare('DELETE FROM jurnal WHERE id = ?').run(jurnalId),
      ).toThrow(/Jurnal tidak boleh dihapus/);
      expect(() =>
        db
          .prepare(
            "UPDATE jurnal_baris SET keterangan = 'Diubah' WHERE jurnal_id = ?",
          )
          .run(jurnalId),
      ).toThrow(/Baris jurnal tidak boleh diubah/);
      expect(() =>
        db.prepare('DELETE FROM jurnal_baris WHERE jurnal_id = ?').run(jurnalId),
      ).toThrow(/Baris jurnal tidak boleh dihapus/);

      db.prepare(
        `INSERT INTO audit_log
           (id, tanggal, aksi, alasan, data_lama_json, data_baru_json)
         VALUES ('a-db07', ?, 'UJI', 'Uji DB-07', '', '')`,
      ).run(WAKTU);
      expect(() =>
        db
          .prepare("UPDATE audit_log SET alasan = 'Diubah' WHERE id = 'a-db07'")
          .run(),
      ).toThrow(/Audit log tidak boleh diubah/);
      expect(() =>
        db.prepare("DELETE FROM audit_log WHERE id = 'a-db07'").run(),
      ).toThrow(/Audit log tidak boleh dihapus/);

      db.prepare(
        `INSERT INTO tutup_buku (tahun, created_at, catatan)
         VALUES (2025, ?, 'Uji DB-07')`,
      ).run(WAKTU);
      expect(() =>
        db.prepare('DELETE FROM tutup_buku WHERE tahun = 2025').run(),
      ).toThrow(/Tutup buku tidak boleh dihapus/);
    } finally {
      db.close();
    }
  });
});

describe('DB-07 — sumber memakai DROP + CREATE', () => {
  it('tidak memakai CREATE TRIGGER IF NOT EXISTS dan membuat ulang setiap trigger', () => {
    const sumber = readFileSync(join(process.cwd(), 'src/db/database.ts'), 'utf8');
    expect(sumber).not.toMatch(/CREATE\s+TRIGGER\s+IF\s+NOT\s+EXISTS/i);

    for (const nama of TRIGGER_APP) {
      const pola = new RegExp(
        `DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${nama};\\s*CREATE\\s+TRIGGER\\s+${nama}\\b`,
      );
      expect(sumber, nama).toMatch(pola);
    }
  });
});
