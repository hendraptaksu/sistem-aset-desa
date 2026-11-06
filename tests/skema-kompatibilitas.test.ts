// Skema v1 — guard kompatibilitas DB saat dibuka.
//
// Fokus:
// - DB `user_version = 23` ditolak `openDb` dengan pesan resmi dan file
//   byte-for-byte tidak berubah (tidak ada `-wal`/`-shm` baru).
// - DB `user_version = 0` yang sudah punya tabel ditolak tanpa mengubah file.
// - DB `user_version = 1` dengan tabel asing ditolak.
// - DB v1 yang kehilangan tabel wajib (mis. `jurnal_baris`) ditolak sebelum
//   DDL/WAL, tanpa membuat tabel kosong dan tanpa mengubah byte file.
// - DB v1 yang tabelnya ada tetapi kehilangan kolom wajib (mis.
//   `pengaturan.nilai`) ditolak sebelum DDL/WAL tanpa menambah kolom.
// - Peta `KOLOM_WAJIB` sinkron dengan `PRAGMA table_info` DB baru.
// - DB v1 valid (11 tabel aktif) bisa dibuka, seed COA jalan, dan data
//   `pengaturan` sentinel tetap.
// - DB baru `:memory:` langsung v1, 11 tabel aktif, seluruhnya STRICT.
// - Kandidat backup v23 ditolak `validasiKandidatRestore` tanpa menyentuh DB
//   aktif.

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  KOLOM_WAJIB,
  PESAN_DB_KOLOM_TIDAK_LENGKAP,
  PESAN_DB_TIDAK_KOMPATIBEL,
  PESAN_DB_TIDAK_LENGKAP,
  SCHEMA_VERSION,
  TABEL_AKTIF,
  openDb,
} from '../src/db/database.js';
import { validasiKandidatRestore } from '../src/features/export/export.js';

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

function namaTabelUser(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function kolomTabel(db: Database.Database, tabel: string): string[] {
  return (db.pragma(`table_info(${tabel})`) as { name: string }[]).map((row) => row.name);
}

function tangkapPesan(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error('Fungsi seharusnya melempar error.');
}

/** Buat file DB SQLite mentah lalu tutup agar tidak ada handle/WAL tersisa. */
function buatDbMentah(path: string, isi: (db: Database.Database) => void): void {
  const db = new Database(path);
  try {
    isi(db);
  } finally {
    db.close();
  }
}

/**
 * Guard harus berjalan sebelum `journal_mode = WAL` dan sebelum DDL, sehingga
 * file lama tidak berubah sama sekali.
 */
function pastikanTidakBerubah(path: string, sebelum: Buffer): void {
  expect(readFileSync(path).equals(sebelum)).toBe(true);
  expect(existsSync(`${path}-wal`)).toBe(false);
  expect(existsSync(`${path}-shm`)).toBe(false);
}

describe('skema v1 — openDb menolak DB tidak kompatibel', () => {
  it('menolak DB v23 tanpa mengubah byte dan tanpa meninggalkan -wal/-shm', () => {
    const path = join(tmpDir('skema-v23-'), 'pura.db');
    buatDbMentah(path, (db) => {
      db.exec("CREATE TABLE sentinel (id TEXT PRIMARY KEY)");
      db.prepare("INSERT INTO sentinel (id) VALUES ('tetap')").run();
      db.pragma('user_version = 23');
    });
    const sebelum = readFileSync(path);

    expect(tangkapPesan(() => openDb(path))).toBe(PESAN_DB_TIDAK_KOMPATIBEL);
    pastikanTidakBerubah(path, sebelum);

    // Guard berjalan sebelum DDL: tabel inti tidak dibuat dan versi tetap.
    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(23);
      expect(namaTabelUser(cek)).toEqual(['sentinel']);
      expect(cek.prepare('SELECT id FROM sentinel').all()).toEqual([{ id: 'tetap' }]);
    } finally {
      cek.close();
    }
  });

  it('menolak DB user_version 0 yang sudah punya tabel tanpa mengubah file', () => {
    const path = join(tmpDir('skema-v0-'), 'pura.db');
    buatDbMentah(path, (db) => {
      db.exec("CREATE TABLE sentinel (id TEXT PRIMARY KEY)");
      db.prepare("INSERT INTO sentinel (id) VALUES ('tetap')").run();
    });
    const sebelum = readFileSync(path);

    expect(tangkapPesan(() => openDb(path))).toBe(PESAN_DB_TIDAK_KOMPATIBEL);
    pastikanTidakBerubah(path, sebelum);

    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(0);
      expect(namaTabelUser(cek)).toEqual(['sentinel']);
    } finally {
      cek.close();
    }
  });

  it('menolak DB v1 yang punya tabel asing walau 11 tabel aktif lengkap', () => {
    const path = join(tmpDir('skema-v1-asing-'), 'pura.db');
    buatDbMentah(path, (db) => {
      db.exec(DDL);
      db.exec('CREATE TABLE tabel_asing (id TEXT PRIMARY KEY)');
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });
    const sebelum = readFileSync(path);

    expect(tangkapPesan(() => openDb(path))).toBe(PESAN_DB_TIDAK_KOMPATIBEL);
    pastikanTidakBerubah(path, sebelum);
  });
});

describe('skema v1 — DB v1 tidak lengkap ditolak', () => {
  it('menolak DB v1 tanpa jurnal_baris tanpa membuat tabel kosong dan tanpa mengubah byte', () => {
    const path = join(tmpDir('skema-v1-kurang-'), 'pura.db');

    // DB v1 valid dibuat lewat jalur aplikasi, lalu ditutup agar tidak ada
    // handle/WAL tersisa.
    const awal = openDb(path);
    awal
      .prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('sentinel', 'tetap')")
      .run();
    awal.close();

    // Tiru DB rusak: hapus satu tabel wajib langsung dari file.
    buatDbMentah(path, (db) => {
      db.pragma('foreign_keys = OFF');
      db.exec('DROP TABLE jurnal_baris');
    });
    const sebelum = readFileSync(path);

    const pesan = tangkapPesan(() => openDb(path));
    expect(pesan).toContain(PESAN_DB_TIDAK_LENGKAP);
    expect(pesan).toContain('jurnal_baris');
    expect(pesan).toMatch(/backup/i);
    pastikanTidakBerubah(path, sebelum);

    // Guard berjalan sebelum DDL: tabel tidak dibuat ulang, versi tetap v1,
    // dan data lain tidak berubah.
    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(SCHEMA_VERSION);
      expect(namaTabelUser(cek)).not.toContain('jurnal_baris');
      expect(namaTabelUser(cek)).toHaveLength(TABEL_AKTIF.length - 1);
      expect(cek.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'sentinel'").get()).toEqual({
        nilai: 'tetap',
      });
    } finally {
      cek.close();
    }
  });

  it('DB v1 lengkap tetap bisa dibuka dan datanya utuh', () => {
    const path = join(tmpDir('skema-v1-lengkap-'), 'pura.db');
    const pertama = openDb(path);
    pertama
      .prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('sentinel', 'tetap')")
      .run();
    pertama.close();

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(namaTabelUser(db).sort()).toEqual([...TABEL_AKTIF].sort());
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'sentinel'").get()).toEqual({
        nilai: 'tetap',
      });
    } finally {
      db.close();
    }
  });
});

describe('skema v1 — DB v1 kehilangan kolom wajib ditolak', () => {
  it('menolak DB v1 tanpa pengaturan.nilai tanpa menambah kolom dan tanpa mengubah byte', () => {
    const path = join(tmpDir('skema-v1-kolom-kurang-'), 'pura.db');

    const awal = openDb(path);
    awal
      .prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('sentinel', 'tetap')")
      .run();
    awal
      .prepare(
        "INSERT INTO tutup_buku (tahun, created_at, catatan) VALUES (2025, '2026-01-01', 'lama')",
      )
      .run();
    awal.close();

    // Tiru DB rusak: hapus satu kolom wajib langsung dari file. `pengaturan`
    // tidak punya index/trigger sehingga aman untuk ALTER TABLE DROP COLUMN.
    buatDbMentah(path, (db) => {
      db.exec('ALTER TABLE pengaturan DROP COLUMN nilai');
    });
    const sebelum = readFileSync(path);

    const pesan = tangkapPesan(() => openDb(path));
    expect(pesan).toContain(PESAN_DB_KOLOM_TIDAK_LENGKAP);
    expect(pesan).toContain('pengaturan.nilai');
    expect(pesan).toMatch(/backup/i);
    pastikanTidakBerubah(path, sebelum);

    // Guard berjalan sebelum DDL: kolom tidak ditambahkan kembali, versi tetap
    // v1, dan data lain tidak berubah.
    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(SCHEMA_VERSION);
      expect(kolomTabel(cek, 'pengaturan')).toEqual(['kunci']);
      expect(cek.prepare('SELECT kunci FROM pengaturan').all()).toEqual([{ kunci: 'sentinel' }]);
      expect(cek.prepare('SELECT catatan FROM tutup_buku WHERE tahun = 2025').get()).toEqual({
        catatan: 'lama',
      });
    } finally {
      cek.close();
    }
  });

  it('KOLOM_WAJIB sinkron dengan PRAGMA table_info DB baru', () => {
    const db = openDb(':memory:');
    try {
      expect(Object.keys(KOLOM_WAJIB).sort()).toEqual([...TABEL_AKTIF].sort());
      for (const tabel of TABEL_AKTIF) {
        expect(kolomTabel(db, tabel), `kolom wajib ${tabel}`).toEqual([
          ...KOLOM_WAJIB[tabel],
        ]);
      }
    } finally {
      db.close();
    }
  });
});

describe('skema v1 — DB kompatibel tetap bisa dibuka', () => {
  it('membuka DB v1 valid, seed COA jalan, dan pengaturan sentinel tetap', () => {
    const path = join(tmpDir('skema-v1-valid-'), 'pura.db');
    buatDbMentah(path, (db) => {
      db.exec(DDL);
      db.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('sentinel', 'tetap')").run();
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(namaTabelUser(db).sort()).toEqual([...TABEL_AKTIF].sort());
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'sentinel'").get()).toEqual({
        nilai: 'tetap',
      });
      // Seed COA berjalan saat openDb.
      expect(db.prepare("SELECT 1 FROM akun WHERE kode = '2060'").get()).toBeTruthy();
      expect(db.prepare("SELECT 1 FROM akun WHERE kode = '1001'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('DB baru :memory: langsung v1 dengan 11 tabel aktif yang semuanya STRICT', () => {
    const db = openDb(':memory:');
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(namaTabelUser(db).sort()).toEqual([...TABEL_AKTIF].sort());

      const info = db.pragma('table_list') as {
        schema: string;
        name: string;
        strict: number;
      }[];
      for (const nama of TABEL_AKTIF) {
        const baris = info.find((r) => r.schema === 'main' && r.name === nama);
        expect(baris, `tabel ${nama} harus ada`).toBeDefined();
        expect(Number(baris?.strict), `${nama} harus STRICT`).toBe(1);
      }
    } finally {
      db.close();
    }
  });
});

describe('skema v1 — kandidat backup versi lain ditolak', () => {
  it('menolak kandidat v23 dengan pesan v23/v1 tanpa menyentuh DB aktif', () => {
    const dir = tmpDir('skema-backup-v23-');
    const aktifPath = join(dir, 'aktif.db');
    const aktif = openDb(aktifPath);
    try {
      aktif
        .prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('sentinel', 'tetap')")
        .run();

      const kandidatPath = join(dir, 'kandidat-v23.db');
      buatDbMentah(kandidatPath, (db) => {
        db.exec(DDL);
        db.pragma('user_version = 23');
      });

      const hasil = validasiKandidatRestore(kandidatPath);
      expect(hasil.valid).toBe(false);
      if (hasil.valid) throw new Error('backup v23 seharusnya ditolak');
      expect(hasil.error).toContain('v23');
      expect(hasil.error).toContain('v1');

      // DB aktif tetap terbuka, versinya tidak berubah, dan datanya utuh.
      expect(versi(aktif)).toBe(SCHEMA_VERSION);
      expect(aktif.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'sentinel'").get()).toEqual({
        nilai: 'tetap',
      });
      expect(aktif.prepare('SELECT 1 AS ok').get()).toEqual({ ok: 1 });
    } finally {
      aktif.close();
    }
  });
});
