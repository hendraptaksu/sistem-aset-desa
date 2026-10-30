// DB-05 — DB dari aplikasi versi lebih baru ditolak sebelum DDL.
//
// Fokus:
// - File DB `user_version = SCHEMA_VERSION + 1` ditolak dengan pesan tepat,
//   isi file byte-for-byte tidak berubah, dan tidak ada tabel/trigger dibuat.
// - Koneksi ditutup: file bisa dibuka readonly lalu dihapus setelah penolakan.
// - DB `:memory:` versi lebih baru juga ditolak sebelum DDL.
// - Versi sama, versi lama, dan DB baru tetap terbuka/migrasi normal.
// - Jalur restore (kandidat .db + manifest backup lengkap) menolak versi baru.

import Database from 'better-sqlite3';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  PESAN_DB_VERSI_BARU,
  SCHEMA_VERSION,
  migrasi,
  openDb,
} from '../src/db/database.js';
import { validasiKandidatRestore, restoreDbAman } from '../src/features/export/export.js';
import { validasiBackupLengkap } from '../src/features/export/restoreLengkap.js';

const PESAN_BACKUP_DB =
  'File backup dibuat oleh aplikasi versi lebih baru. Perbarui aplikasi dulu.';
const PESAN_BACKUP_LENGKAP =
  'Backup dibuat oleh aplikasi versi lebih baru. Perbarui aplikasi dulu.';

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

function daftarTabel(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((r) => r.name);
}

function tangkapPesan(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('Fungsi seharusnya melempar error.');
}

/**
 * Fixture minimal dengan tabel sentinel + data. `denganDdl` dipakai untuk DB
 * versi lama/sama yang memang sudah punya tabel inti.
 */
function buatDbVersi(
  path: string,
  versiDb: number,
  opsi: { denganDdl?: boolean } = {},
): void {
  const db = new Database(path);
  try {
    db.exec("CREATE TABLE sentinel (id TEXT PRIMARY KEY)");
    db.prepare("INSERT INTO sentinel (id) VALUES ('tetap')").run();
    if (opsi.denganDdl) {
      db.exec(DDL);
      db.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('uji', 'tetap')").run();
    }
    db.pragma(`user_version = ${versiDb}`);
  } finally {
    db.close();
  }
}

describe('DB-05 — openDb menolak DB versi lebih baru', () => {
  it('menolak file DB v14 tanpa mengubah byte, DDL, atau meninggalkan koneksi terbuka', () => {
    const path = join(tmpDir('pura-db05-file-'), 'pura.db');
    buatDbVersi(path, SCHEMA_VERSION + 1);
    const sebelum = readFileSync(path);

    expect(tangkapPesan(() => openDb(path))).toBe(PESAN_DB_VERSI_BARU);

    // Guard berjalan sebelum PRAGMA WAL dan sebelum DDL: file identik.
    expect(readFileSync(path).equals(sebelum)).toBe(true);
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);

    // Isi dan versi tidak berubah; tidak ada tabel inti yang dibuat.
    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(SCHEMA_VERSION + 1);
      expect(daftarTabel(cek)).toEqual(['sentinel']);
      expect(cek.prepare('SELECT id FROM sentinel').all()).toEqual([{ id: 'tetap' }]);
    } finally {
      cek.close();
    }

    // Koneksi sudah ditutup: file bisa dihapus (penting di Windows).
    rmSync(path);
    expect(existsSync(path)).toBe(false);
  });

  it('menolak DB :memory: versi lebih baru sebelum DDL tanpa kehilangan tabel sentinel', () => {
    const db = new Database(':memory:');
    try {
      db.exec("CREATE TABLE sentinel (id TEXT PRIMARY KEY)");
      db.prepare("INSERT INTO sentinel (id) VALUES ('tetap')").run();
      db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);

      expect(tangkapPesan(() => migrasi(db))).toBe(PESAN_DB_VERSI_BARU);
      expect(versi(db)).toBe(SCHEMA_VERSION + 1);
      expect(daftarTabel(db)).toEqual(['sentinel']);
      expect(db.prepare('SELECT id FROM sentinel').all()).toEqual([{ id: 'tetap' }]);
    } finally {
      db.close();
    }
  });

  it('DB versi sama tetap terbuka, data dipertahankan, dan seed tetap jalan', () => {
    const path = join(tmpDir('pura-db05-sama-'), 'pura.db');
    buatDbVersi(path, SCHEMA_VERSION, { denganDdl: true });

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'uji'").get()).toEqual({
        nilai: 'tetap',
      });
      expect(db.prepare('SELECT id FROM sentinel').all()).toEqual([{ id: 'tetap' }]);
      expect(db.prepare("SELECT 1 FROM akun WHERE kode = '2060'").get()).toBeTruthy();
      expect(daftarTabel(db)).toContain('jurnal');
      expect(daftarTabel(db)).toContain('jurnal_baris');
    } finally {
      db.close();
    }
  });

  it('DB versi lama (v12) terbuka dan dimigrasikan ke versi saat ini', () => {
    const path = join(tmpDir('pura-db05-lama-'), 'pura.db');
    buatDbVersi(path, SCHEMA_VERSION - 1, { denganDdl: true });

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'uji'").get()).toEqual({
        nilai: 'tetap',
      });
      expect(db.prepare('SELECT id FROM sentinel').all()).toEqual([{ id: 'tetap' }]);
      // Migrasi v13 berjalan pada DB lama.
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ux_jurnal_saldo_awal'",
          )
          .get(),
      ).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('DB baru (:memory:) tetap terbuka pada versi skema saat ini', () => {
    const db = openDb(':memory:');
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(daftarTabel(db)).toContain('jurnal');
      expect(daftarTabel(db)).toContain('panjar_item');
    } finally {
      db.close();
    }
  });
});

describe('DB-05 — jalur restore juga menolak DB versi lebih baru', () => {
  it('validasi kandidat .db menolak versi lebih baru dengan pesan tepat', () => {
    const path = join(tmpDir('pura-db05-restore-'), 'baru.db');
    buatDbVersi(path, SCHEMA_VERSION + 1);

    expect(validasiKandidatRestore(path)).toEqual({
      valid: false,
      error: PESAN_BACKUP_DB,
    });
  });

  it('restoreDbAman menolak versi lebih baru sebelum DB aktif disentuh', () => {
    const dir = tmpDir('pura-db05-restore-aman-');
    const aktifPath = join(dir, 'aktif.db');
    const aktif = openDb(aktifPath);
    try {
      buatDbVersi(join(dir, 'baru.db'), SCHEMA_VERSION + 1);
      const hasil = restoreDbAman(aktif, {
        dbPath: aktifPath,
        backupPath: join(dir, 'baru.db'),
        dirBackup: join(dir, 'backups'),
        stamp: 'db05',
      });

      expect(hasil.ok).toBe(false);
      if (hasil.ok) throw new Error('restore versi lebih baru seharusnya ditolak');
      expect(hasil.error).toBe(PESAN_BACKUP_DB);
      expect(hasil.db).toBe(aktif);
      // Validasi berjalan sebelum backup pra-restore; DB aktif tetap bisa dipakai.
      expect(existsSync(join(dir, 'backups'))).toBe(false);
      expect(aktif.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
    } finally {
      aktif.close();
    }
  });

  it('validasi backup lengkap menolak manifest versi lebih baru dengan pesan tepat', () => {
    const dir = tmpDir('pura-db05-lengkap-');
    buatDbVersi(join(dir, 'pura.db'), SCHEMA_VERSION + 1);
    writeFileSync(
      join(dir, 'manifest.json'),
      JSON.stringify({
        versiApp: '2.0.0',
        schemaVersion: SCHEMA_VERSION + 1,
        dibuat: '2026-10-30T00:00:00.000Z',
        ukuranDb: 1,
        daftarFile: ['pura.db'],
      }),
    );

    expect(validasiBackupLengkap(dir)).toEqual({
      valid: false,
      error: PESAN_BACKUP_LENGKAP,
    });
  });
});
