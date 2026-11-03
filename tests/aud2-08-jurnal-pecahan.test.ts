// AUD2-08 — nilai pecahan (REAL) pada jurnal_baris.
//
// Fokus:
// - Trigger DB menolak debit/kredit bukan INTEGER (mis. 0.5) pada INSERT dan
//   UPDATE, termasuk nilai negatif dan dua sisi nol.
// - Aturan satu sisi (debit dan kredit sekaligus) tetap berlaku.
// - Trigger baru diterapkan ke DB lama/current lewat `migrasi()`.
// - `auditIntegritas` melaporkan baris pecahan bila trigger sempat dilewati.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DDL, SCHEMA_VERSION, migrasi, openDb } from '../src/db/database.js';
import { auditIntegritas } from '../src/db/integritas.js';

const WAKTU = '2026-11-03T00:00:00.000Z';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDb(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return join(dir, 'pura.db');
}

function buatJurnal(db: Database.Database, id = 'j-aud208'): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, '2026-11-03', '', 'Uji AUD2-08', 'UMUM', ?, NULL, ?)`,
  ).run(id, id, WAKTU);
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

/** Trigger satu sisi lama (pra-AUD2-08), untuk menguji migrasi DB existing. */
function pasangTriggerSatuSisiLama(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_insert;
    CREATE TRIGGER trg_jurnal_baris_satu_sisi_insert
    BEFORE INSERT ON jurnal_baris
    WHEN NEW.debit > 0 AND NEW.kredit > 0
    BEGIN
      SELECT RAISE(ABORT, 'Baris jurnal tidak boleh mengisi debit dan kredit sekaligus. Isi salah satu saja.');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_update;
    CREATE TRIGGER trg_jurnal_baris_satu_sisi_update
    BEFORE UPDATE ON jurnal_baris
    WHEN NEW.debit > 0 AND NEW.kredit > 0
    BEGIN
      SELECT RAISE(ABORT, 'Baris jurnal tidak boleh mengisi debit dan kredit sekaligus. Isi salah satu saja.');
    END;
  `);
}

describe('AUD2-08 — trigger jurnal_baris menolak nilai pecahan', () => {
  it('menolak INSERT pecahan, negatif, dua sisi nol, dan dua sisi sekaligus', () => {
    const db = openDb(':memory:');
    try {
      buatJurnal(db);

      const kasus: [debit: number, kredit: number, pesan: RegExp][] = [
        [0.5, 0, /bilangan bulat.*pecahan/i],
        [0, 0.5, /bilangan bulat.*pecahan/i],
        [0.25, 0.25, /bilangan bulat.*pecahan/i],
        [-1, 0, /tidak boleh negatif/i],
        [0, -1, /tidak boleh negatif/i],
        [0, 0, /salah satu sisi/i],
        [1, 1, /debit dan kredit sekaligus/i],
      ];
      for (const [debit, kredit, pesan] of kasus) {
        expect(() => buatBaris(db, 'j-aud208', '1001', debit, kredit), `${debit}/${kredit}`).toThrow(
          pesan,
        );
      }

      // Nilai bulat tetap diterima dan tersimpan sebagai INTEGER, bukan REAL.
      buatBaris(db, 'j-aud208', '1001', 100, 0);
      buatBaris(db, 'j-aud208', '4001', 0, 100);
      expect(
        db
          .prepare(
            `SELECT debit, kredit, typeof(debit) AS tipe_debit,
                    typeof(kredit) AS tipe_kredit
               FROM jurnal_baris
              ORDER BY id`,
          )
          .all(),
      ).toEqual([
        { debit: 100, kredit: 0, tipe_debit: 'integer', tipe_kredit: 'integer' },
        { debit: 0, kredit: 100, tipe_debit: 'integer', tipe_kredit: 'integer' },
      ]);
    } finally {
      db.close();
    }
  });

  it('menolak UPDATE ke nilai pecahan, negatif, dua sisi nol, dan dua sisi sekaligus', () => {
    const db = openDb(':memory:');
    try {
      buatJurnal(db);
      buatBaris(db, 'j-aud208', '1001', 100, 0);
      const id = Number(
        (db.prepare('SELECT id FROM jurnal_baris WHERE jurnal_id = ?').get('j-aud208') as {
          id: number;
        }).id,
      );

      // Trigger immutable selalu menolak UPDATE; drop dulu agar trigger satu
      // sisi (yang diperkuat AUD2-08) benar-benar diuji pada jalur update.
      db.exec('DROP TRIGGER IF EXISTS trg_jurnal_baris_immutable_update');

      const kasus: [debit: number, kredit: number, pesan: RegExp][] = [
        [0.5, 0, /bilangan bulat.*pecahan/i],
        [0, 0.5, /bilangan bulat.*pecahan/i],
        [-1, 0, /tidak boleh negatif/i],
        [0, -1, /tidak boleh negatif/i],
        [0, 0, /salah satu sisi/i],
        [1, 1, /debit dan kredit sekaligus/i],
      ];
      for (const [debit, kredit, pesan] of kasus) {
        expect(
          () =>
            db
              .prepare('UPDATE jurnal_baris SET debit = ?, kredit = ? WHERE id = ?')
              .run(debit, kredit, id),
          `${debit}/${kredit}`,
        ).toThrow(pesan);
      }

      expect(
        db.prepare('SELECT debit, kredit FROM jurnal_baris WHERE id = ?').get(id),
      ).toEqual({ debit: 100, kredit: 0 });
    } finally {
      db.close();
    }
  });

  it('auditIntegritas melaporkan baris pecahan yang lolos saat trigger dilewati', () => {
    const db = openDb(':memory:');
    try {
      buatJurnal(db);
      db.exec(`
        DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_insert;
        DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_update;
      `);
      buatBaris(db, 'j-aud208', '1001', 0.5, 0);
      buatBaris(db, 'j-aud208', '4001', 0, 0.5);

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(2);
      expect(hasil.temuan.map((t) => t.kode)).toEqual([
        'BARIS_NILAI_PECAHAN',
        'BARIS_NILAI_PECAHAN',
      ]);
      const debit = hasil.temuan.find(
        (t) => (t.detail as { debit: number }).debit === 0.5,
      );
      expect(debit?.detail).toMatchObject({
        jurnal_id: 'j-aud208',
        akun_kode: '1001',
        debit: 0.5,
        kredit: 0,
        tipe_debit: 'real',
        tipe_kredit: 'integer',
      });
      expect(debit?.pesan).toMatch(/pecahan|bukan bilangan bulat/i);
      expect(debit?.pesan).toMatch(/integer/i);
    } finally {
      db.close();
    }
  });

  it('migrasi menerapkan trigger baru ke DB existing yang masih memakai body lama', () => {
    const path = tmpDb('pura-aud208-migrasi-');
    const lama = new Database(path);
    try {
      lama.exec(DDL);
      pasangTriggerSatuSisiLama(lama);
      lama.pragma(`user_version = ${SCHEMA_VERSION}`);
    } finally {
      lama.close();
    }

    const db = openDb(path);
    try {
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
      const trigger = db
        .prepare(
          `SELECT name, sql FROM sqlite_master
            WHERE type = 'trigger' AND name LIKE 'trg_jurnal_baris_satu_sisi_%'
            ORDER BY name`,
        )
        .all() as { name: string; sql: string }[];
      expect(trigger).toHaveLength(2);
      for (const t of trigger) {
        expect(t.sql, t.name).toMatch(
          /typeof\(NEW\.debit\) <> 'integer' OR typeof\(NEW\.kredit\) <> 'integer'/,
        );
      }

      buatJurnal(db);
      expect(() => buatBaris(db, 'j-aud208', '1001', 0.5, 0)).toThrow(
        /bilangan bulat.*pecahan/i,
      );
      expect(migrasi(db)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });
});
