// AKT-26 — migrasi v11: audit log append-only dan `tutup_buku` tidak bisa dihapus.
//
// Fokus:
// - DB baru langsung punya trigger penjaga `audit_log` dan `tutup_buku`.
// - UPDATE/DELETE audit ditolak; DELETE tutup buku ditolak.
// - Tutup ulang (`ON CONFLICT(tahun) DO UPDATE`) tetap berfungsi, dan UPDATE
//   langsung ke `tutup_buku` tidak diblokir.
// - DB v9/v10 lama yang dibuka aplikasi saat ini (v21) ikut mendapat trigger; migrasi
//   idempoten saat dijalankan/dibuka ulang.
// - Backup v9/v10 tetap bisa direstore dan trigger terpasang setelah migrasi.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DDL, SCHEMA_VERSION, migrasi, openDb } from '../src/db/database.js';
import {
  insertAuditLog,
  insertTutupBuku,
  listAuditLog,
  listTutupBuku,
} from '../src/db/repository.js';
import { restoreDbAman, validasiKandidatRestore } from '../src/features/export/export.js';

const dirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

const TRIGGER_V11 = [
  'trg_audit_log_immutable_delete',
  'trg_audit_log_immutable_update',
  'trg_tutup_buku_immutable_delete',
] as const;

function daftarTriggerV11(db: Database.Database): { name: string; sql: string }[] {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger'
         AND (name LIKE 'trg_audit%' OR name LIKE 'trg_tutup%')
       ORDER BY name`,
    )
    .all() as { name: string; sql: string }[];
}

function auditAwal(): Parameters<typeof insertAuditLog>[1] {
  return {
    id: 'audit-lama',
    tanggal: '2026-01-02T00:00:00.000Z',
    aksi: 'UJI-AUDIT',
    alasan: 'Audit lama',
    data_lama_json: '',
    data_baru_json: '{"uji":true}',
  };
}

function tutupAwal(): Parameters<typeof insertTutupBuku>[1] {
  return {
    tahun: 2025,
    created_at: '2025-12-31T00:00:00.000Z',
    catatan: 'Tutup lama',
  };
}

/**
 * Fixture DB v9/v10 realistis: skema v2–v8 + data audit/tutup buku, TANPA
 * trigger v11. Dibuat di folder sementara test; tidak menyentuh `data/` repo.
 */
function buatFixtureLama(path: string, versiLama: 9 | 10): void {
  const lama = new Database(path);
  try {
    lama.pragma('foreign_keys = OFF');
    lama.exec(DDL);
    insertAuditLog(lama, auditAwal());
    insertTutupBuku(lama, tutupAwal());
    lama.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('uji-lama', 'tetap')").run();
    lama.pragma(`user_version = ${versiLama}`);
  } finally {
    lama.close();
  }
}

describe('AKT-26 — trigger v11 pada DB baru', () => {
  it('membuat trigger audit/tutup buku, versi v21, dan idempoten', () => {
    const path = join(tmpDir('pura-v11-baru-'), 'pura.db');

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(23);
      expect(versi(db)).toBe(23);

      const trigger = daftarTriggerV11(db);
      expect(trigger.map((t) => t.name)).toEqual([...TRIGGER_V11]);
      const sql = Object.fromEntries(trigger.map((t) => [t.name, t.sql]));
      expect(sql.trg_audit_log_immutable_update).toMatch(/BEFORE UPDATE ON audit_log/);
      expect(sql.trg_audit_log_immutable_delete).toMatch(/BEFORE DELETE ON audit_log/);
      expect(sql.trg_tutup_buku_immutable_delete).toMatch(/BEFORE DELETE ON tutup_buku/);
      // UPDATE tutup_buku sengaja tidak diblokir (tutup ulang memakai upsert).
      expect(trigger.some((t) => /UPDATE ON tutup_buku/.test(t.sql))).toBe(false);

      // Aturan integritas jurnal v9 tetap ada; trigger validasi v14 menambah satu.
      expect(
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM sqlite_master
             WHERE type = 'trigger' AND name LIKE 'trg_jurnal%'`,
          )
          .get(),
      ).toEqual({ n: 7 });

      // Migrasi dijalankan dua kali: trigger dibuat ulang, tidak dobel.
      expect(migrasi(db)).toBe(23);
      expect(migrasi(db)).toBe(23);
      expect(daftarTriggerV11(db).map((t) => t.name)).toEqual([...TRIGGER_V11]);
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(23);
      expect(daftarTriggerV11(db2).map((t) => t.name)).toEqual([...TRIGGER_V11]);
    } finally {
      db2.close();
    }
  });

  it('menolak update/delete audit dan delete tutup buku; tutup ulang tetap jalan', () => {
    const db = openDb(':memory:');
    try {
      insertAuditLog(db, auditAwal());
      expect(() =>
        db.prepare("UPDATE audit_log SET alasan = 'Diubah' WHERE id = 'audit-lama'").run(),
      ).toThrow(/Audit log tidak boleh diubah/);
      expect(() => db.prepare("DELETE FROM audit_log WHERE id = 'audit-lama'").run()).toThrow(
        /Audit log tidak boleh dihapus/,
      );
      expect(listAuditLog(db).map((a) => a.alasan)).toEqual(['Audit lama']);

      insertTutupBuku(db, tutupAwal());
      // Update langsung diizinkan; tutup ulang memakai jalur upsert yang sama.
      expect(() =>
        db.prepare("UPDATE tutup_buku SET catatan = 'Ubah langsung' WHERE tahun = 2025").run(),
      ).not.toThrow();
      insertTutupBuku(db, {
        ...tutupAwal(),
        created_at: '2026-01-01T00:00:00.000Z',
        catatan: 'Tutup ulang',
      });
      expect(listTutupBuku(db)).toEqual([
        {
          tahun: 2025,
          created_at: '2026-01-01T00:00:00.000Z',
          catatan: 'Tutup ulang',
        },
      ]);

      expect(() => db.prepare('DELETE FROM tutup_buku WHERE tahun = 2025').run()).toThrow(
        /Tutup buku tidak boleh dihapus/,
      );
      expect(listTutupBuku(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});

describe('AKT-26 — migrasi DB v9/v10 → v21', () => {
  for (const versiLama of [9, 10] as const) {
    it(`membuka DB v${versiLama} lama: trigger terpasang, data utuh, idempoten`, () => {
      const path = join(tmpDir(`pura-v11-dari-v${versiLama}-`), 'pura.db');
      buatFixtureLama(path, versiLama);

      const db = openDb(path);
      try {
        expect(versi(db)).toBe(23);
        expect(daftarTriggerV11(db).map((t) => t.name)).toEqual([...TRIGGER_V11]);

        // Data lama tidak berubah.
        expect(listAuditLog(db).map((a) => a.id)).toEqual(['audit-lama']);
        expect(listTutupBuku(db).map((t) => t.tahun)).toEqual([2025]);
        expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'uji-lama'").get()).toEqual({
          nilai: 'tetap',
        });

        // Perlindungan langsung berlaku setelah migrasi.
        expect(() =>
          db.prepare("UPDATE audit_log SET alasan = 'Diubah' WHERE id = 'audit-lama'").run(),
        ).toThrow(/Audit log tidak boleh diubah/);
        expect(() => db.prepare("DELETE FROM audit_log WHERE id = 'audit-lama'").run()).toThrow(
          /Audit log tidak boleh dihapus/,
        );
        expect(() => db.prepare('DELETE FROM tutup_buku WHERE tahun = 2025').run()).toThrow(
          /Tutup buku tidak boleh dihapus/,
        );

        // Migrasi kedua pada DB yang sama tidak menggandakan trigger.
        expect(migrasi(db)).toBe(23);
        expect(daftarTriggerV11(db).map((t) => t.name)).toEqual([...TRIGGER_V11]);
        expect(listAuditLog(db)).toHaveLength(1);
        expect(listTutupBuku(db)).toHaveLength(1);
      } finally {
        db.close();
      }

      // Buka ulang juga idempoten.
      const db2 = openDb(path);
      try {
        expect(versi(db2)).toBe(23);
        expect(daftarTriggerV11(db2).map((t) => t.name)).toEqual([...TRIGGER_V11]);
      } finally {
        db2.close();
      }
    });

    it(`merestore backup v${versiLama} ke v21 dan memasang trigger`, () => {
      const dir = tmpDir(`pura-v11-restore-v${versiLama}-`);
      const backupPath = join(dir, `backup-v${versiLama}.db`);
      buatFixtureLama(backupPath, versiLama);

      expect(versi(new Database(backupPath, { readonly: true }))).toBe(versiLama);
      expect(validasiKandidatRestore(backupPath)).toEqual({ valid: true });

      const aktifPath = join(dir, 'aktif.db');
      let aktif = openDb(aktifPath);
      try {
        const hasil = restoreDbAman(aktif, {
          dbPath: aktifPath,
          backupPath,
          dirBackup: join(dir, 'backups'),
          stamp: `uji-v11-dari-v${versiLama}`,
        });
        expect(hasil.ok).toBe(true);
        if (!hasil.ok) throw new Error(hasil.error);
        aktif = hasil.db;

        expect(versi(aktif)).toBe(23);
        expect(daftarTriggerV11(aktif).map((t) => t.name)).toEqual([...TRIGGER_V11]);
        expect(listAuditLog(aktif).map((a) => a.id)).toEqual(['audit-lama']);
        expect(listTutupBuku(aktif).map((t) => t.tahun)).toEqual([2025]);

        expect(() =>
          aktif.prepare("UPDATE audit_log SET alasan = 'Diubah' WHERE id = 'audit-lama'").run(),
        ).toThrow(/Audit log tidak boleh diubah/);
        expect(() => aktif.prepare('DELETE FROM tutup_buku WHERE tahun = 2025').run()).toThrow(
          /Tutup buku tidak boleh dihapus/,
        );
      } finally {
        aktif.close();
      }
    });
  }
});
