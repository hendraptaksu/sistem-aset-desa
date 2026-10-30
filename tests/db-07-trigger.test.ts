// DB-07 — trigger migrasi selalu DROP + CREATE, bukan `IF NOT EXISTS`.
//
// Fokus:
// - DB yang sudah current tetapi berisi trigger lama dengan body berbeda
//   mendapat body dari kode terbaru setelah `openDb`/`migrasi`.
// - Semua trigger aplikasi (v9 + v11 + v14) ada tepat satu setelah dibuka berulang.
// - Aturan integritas tetap menolak operasi terlarang setelah trigger diganti.
// - Migrasi yang gagal (duplikat SALDO_AWAL) rollback tanpa kehilangan trigger;
//   definisi lama tetap utuh.
// - Sumber database.ts tidak lagi memakai `CREATE TRIGGER IF NOT EXISTS`.

import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  PESAN_DUPLIKAT_SALDO_AWAL,
  SCHEMA_VERSION,
  migrasi,
  openDb,
} from '../src/db/database.js';

const WAKTU = '2026-01-01T00:00:00.000Z';
const MARKER_LAMA = 'LAMA-DB-07';

/** Semua trigger yang dibuat aplikasi, diurutkan seperti query sqlite_master. */
const TRIGGER_APP = [
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

function pasangTriggerLama(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_insert;
    CREATE TRIGGER trg_jurnal_baris_satu_sisi_insert
    BEFORE INSERT ON jurnal_baris
    WHEN NEW.debit > 0 AND NEW.kredit > 0
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} satu sisi insert');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_update;
    CREATE TRIGGER trg_jurnal_baris_satu_sisi_update
    BEFORE UPDATE ON jurnal_baris
    WHEN NEW.debit > 0 AND NEW.kredit > 0
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} satu sisi update');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_immutable_update;
    CREATE TRIGGER trg_jurnal_immutable_update
    BEFORE UPDATE ON jurnal
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} jurnal update');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_immutable_delete;
    CREATE TRIGGER trg_jurnal_immutable_delete
    BEFORE DELETE ON jurnal
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} jurnal delete');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_baris_immutable_update;
    CREATE TRIGGER trg_jurnal_baris_immutable_update
    BEFORE UPDATE ON jurnal_baris
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} baris update');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_baris_immutable_delete;
    CREATE TRIGGER trg_jurnal_baris_immutable_delete
    BEFORE DELETE ON jurnal_baris
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} baris delete');
    END;

    DROP TRIGGER IF EXISTS trg_audit_log_immutable_update;
    CREATE TRIGGER trg_audit_log_immutable_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} audit update');
    END;

    DROP TRIGGER IF EXISTS trg_audit_log_immutable_delete;
    CREATE TRIGGER trg_audit_log_immutable_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} audit delete');
    END;

    DROP TRIGGER IF EXISTS trg_tutup_buku_immutable_delete;
    CREATE TRIGGER trg_tutup_buku_immutable_delete
    BEFORE DELETE ON tutup_buku
    BEGIN
      SELECT RAISE(ABORT, '${MARKER_LAMA} tutup buku delete');
    END;
  `);
}

/** DB current buatan "versi lama": skema ada, body trigger berbeda dari kode. */
function buatFixtureTriggerLama(path: string, versiDb = SCHEMA_VERSION): void {
  const db = new Database(path);
  try {
    db.exec(DDL);
    pasangTriggerLama(db);
    db.pragma(`user_version = ${versiDb}`);
  } finally {
    db.close();
  }
}

function bodyDariKodeSekarang(): { name: string; sql: string }[] {
  const fresh = openDb(':memory:');
  try {
    return daftarTrigger(fresh);
  } finally {
    fresh.close();
  }
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

describe('DB-07 — trigger lama diganti body terbaru', () => {
  it('openDb mengganti semua trigger lama dengan definisi dari kode saat ini', () => {
    const path = tmpDb('pura-db07-ganti-');
    buatFixtureTriggerLama(path);
    const harapan = bodyDariKodeSekarang();

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(daftarTrigger(db)).toEqual(harapan);
      expect(daftarTrigger(db).map((t) => t.name)).toEqual([...TRIGGER_APP]);
      for (const trigger of daftarTrigger(db)) {
        expect(trigger.sql, trigger.name).not.toContain(MARKER_LAMA);
      }
      pastikanSatuSetiap(db);
    } finally {
      db.close();
    }
  });

  it('migrasi langsung juga mengganti trigger lama meski versi sudah current', () => {
    const path = tmpDb('pura-db07-migrasi-');
    const db = openDb(path);
    try {
      const harapan = daftarTrigger(db);
      pasangTriggerLama(db);
      expect(daftarTrigger(db).map((t) => t.sql).join('\n')).toContain(MARKER_LAMA);

      expect(migrasi(db)).toBe(SCHEMA_VERSION);
      expect(daftarTrigger(db)).toEqual(harapan);
      pastikanSatuSetiap(db);
    } finally {
      db.close();
    }
  });

  it('aturan integritas memakai body terbaru setelah trigger lama diganti', () => {
    const path = tmpDb('pura-db07-aturan-');
    buatFixtureTriggerLama(path);

    const db = openDb(path);
    try {
      db.prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES ('j-db07', '2026-01-02', '', 'Uji DB-07', 'UMUM', 'j-db07', NULL, ?)`,
      ).run(WAKTU);
      db.prepare(
        `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
         VALUES ('j-db07', '1001', 1000, 0, '')`,
      ).run();

      // Trigger v9: satu sisi, immutable jurnal, immutable baris.
      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
             VALUES ('j-db07', '1001', 1, 1, 'dua sisi')`,
          )
          .run(),
      ).toThrow(/debit dan kredit sekaligus/);
      expect(() =>
        db.prepare("UPDATE jurnal SET keterangan = 'Diubah' WHERE id = 'j-db07'").run(),
      ).toThrow(/Jurnal tidak boleh diubah/);
      expect(() => db.prepare("DELETE FROM jurnal WHERE id = 'j-db07'").run()).toThrow(
        /Jurnal tidak boleh dihapus/,
      );
      expect(() =>
        db.prepare("UPDATE jurnal_baris SET keterangan = 'Diubah' WHERE jurnal_id = 'j-db07'").run(),
      ).toThrow(/Baris jurnal tidak boleh diubah/);
      expect(() => db.prepare("DELETE FROM jurnal_baris WHERE jurnal_id = 'j-db07'").run()).toThrow(
        /Baris jurnal tidak boleh dihapus/,
      );

      // Trigger v11: audit append-only dan tutup buku tidak bisa dihapus.
      db.prepare(
        `INSERT INTO audit_log
           (id, tanggal, aksi, alasan, data_lama_json, data_baru_json)
         VALUES ('a-db07', ?, 'UJI', 'Uji DB-07', '', '')`,
      ).run(WAKTU);
      expect(() =>
        db.prepare("UPDATE audit_log SET alasan = 'Diubah' WHERE id = 'a-db07'").run(),
      ).toThrow(/Audit log tidak boleh diubah/);
      expect(() => db.prepare("DELETE FROM audit_log WHERE id = 'a-db07'").run()).toThrow(
        /Audit log tidak boleh dihapus/,
      );

      db.prepare(
        `INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan)
         VALUES (2025, ?, '', 'Uji DB-07')`,
      ).run(WAKTU);
      expect(() => db.prepare('DELETE FROM tutup_buku WHERE tahun = 2025').run()).toThrow(
        /Tutup buku tidak boleh dihapus/,
      );

      // Tidak ada pesan lama yang bocor.
      for (const trigger of daftarTrigger(db)) {
        expect(trigger.sql, trigger.name).not.toContain(MARKER_LAMA);
      }
    } finally {
      db.close();
    }
  });
});

describe('DB-07 — idempoten saat openDb/migrasi berulang', () => {
  it('setiap trigger tetap tepat satu setelah migrasi dan openDb berulang', () => {
    const path = tmpDb('pura-db07-idempoten-');
    buatFixtureTriggerLama(path);
    const harapan = bodyDariKodeSekarang();

    const db = openDb(path);
    try {
      expect(daftarTrigger(db)).toEqual(harapan);
      expect(migrasi(db)).toBe(SCHEMA_VERSION);
      expect(migrasi(db)).toBe(SCHEMA_VERSION);
      expect(daftarTrigger(db)).toEqual(harapan);
      pastikanSatuSetiap(db);

      // Masukkan body lama lagi, lalu pastikan migrasi berikutnya tetap aman.
      pasangTriggerLama(db);
      expect(migrasi(db)).toBe(SCHEMA_VERSION);
      expect(daftarTrigger(db)).toEqual(harapan);
      pastikanSatuSetiap(db);
    } finally {
      db.close();
    }

    for (let i = 0; i < 3; i += 1) {
      const ulang = openDb(path);
      try {
        expect(versi(ulang)).toBe(SCHEMA_VERSION);
        expect(daftarTrigger(ulang)).toEqual(harapan);
        pastikanSatuSetiap(ulang);
      } finally {
        ulang.close();
      }
    }
  });
});

describe('DB-07 — migrasi gagal tidak menghilangkan trigger', () => {
  it('rollback mempertahankan definisi trigger lama dan data saat migrasi gagal', () => {
    const path = tmpDb('pura-db07-gagal-');
    const lama = new Database(path);
    let sebelum: { name: string; sql: string }[];
    try {
      lama.exec(DDL);
      pasangTriggerLama(lama);
      const insertJurnal = lama.prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES (?, ?, '', ?, 'SALDO_AWAL', ?, NULL, ?)`,
      );
      insertJurnal.run('j-sa-lama-1', '2025-01-01', 'Saldo awal 1', 'j-sa-lama-1', WAKTU);
      insertJurnal.run('j-sa-lama-2', '2025-01-02', 'Saldo awal 2', 'j-sa-lama-2', WAKTU);
      lama.pragma('user_version = 12');
      sebelum = daftarTrigger(lama);
    } finally {
      lama.close();
    }

    // Migrasi v13 menolak dua SALDO_AWAL. Trigger sudah sempat DROP + CREATE
    // di transaksi yang sama, jadi rollback harus mengembalikan definisi lama.
    expect(() => openDb(path)).toThrow(PESAN_DUPLIKAT_SALDO_AWAL);

    const cek = new Database(path);
    try {
      expect(versi(cek)).toBe(12);
      expect(daftarTrigger(cek)).toEqual(sebelum);
      expect(daftarTrigger(cek).map((t) => t.sql).join('\n')).toContain(MARKER_LAMA);
      expect(
        cek.prepare("SELECT COUNT(*) AS total FROM jurnal WHERE jenis = 'SALDO_AWAL'").get(),
      ).toEqual({ total: 2 });
      expect(
        cek
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ux_jurnal_saldo_awal'",
          )
          .get(),
      ).toBeUndefined();
    } finally {
      cek.close();
    }
  });
});

describe('DB-07 — sumber tidak memakai CREATE TRIGGER IF NOT EXISTS', () => {
  it('setiap trigger aplikasi dibuat ulang dengan DROP + CREATE', () => {
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
