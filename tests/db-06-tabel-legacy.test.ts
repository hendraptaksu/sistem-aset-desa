// DB-06 — tidak ada DROP TABLE berdasarkan bentuk kolom.
//
// Fokus:
// - DB v8 dengan data panjar/panjar_item/tutup_buku tetap utuh setelah openDb
//   dan setelah dibuka berulang kali.
// - DB v2 yang masih membawa `transaksi`/`coa` membersihkan tabel single-entry
//   lama secara one-time, lalu membuat skema current.
// - DB current (user_version >= 3) tidak pernah menjalankan cleanup legacy,
//   meskipun tabel bernama `transaksi`/`coa` muncul di DB tersebut.
// - Panjar/tutup_buku bentuk lama tidak dibuang hanya karena kolomnya berbeda.
// - Sumber database.ts tidak lagi memakai bentuk kolom untuk memutuskan DROP.

import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  SCHEMA_VERSION,
  TABEL_DIHAPUS_V12,
  TABEL_SINGLE_ENTRY_LAMA,
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

function daftarTabel(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
}

function buatFixtureV8(path: string): void {
  const db = new Database(path);
  try {
    db.exec(DDL);
    const insAkun = db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
       VALUES (?, ?, ?, ?, 1)`,
    );
    insAkun.run('1001', 'KAS', 'ASET', 'DEBIT');
    insAkun.run('1040', 'UANG PANJAR', 'ASET', 'DEBIT');
    insAkun.run('5004', 'BEBAN KONSUMSI', 'BEBAN', 'DEBIT');

    const insJurnal = db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    insJurnal.run('j-v8-open', '2026-01-02', '', 'Panjar v8', 'PANJAR', 'j-v8-open', WAKTU);
    insJurnal.run('j-v8-item', '2026-01-03', '', 'Realisasi v8', 'PANJAR', 'j-v8-item', WAKTU);

    db.prepare(
      `INSERT INTO panjar
         (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
          tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'OPEN', NULL, ?, NULL, ?)`,
    ).run('p-v8', '2026-01-02', 'Penerima v8', 150_000, '1001', 'j-v8-open', WAKTU);

    db.prepare(
      `INSERT INTO panjar_item (panjar_id, kategori_baga, nominal, jurnal_id)
       VALUES (?, ?, ?, ?)`,
    ).run('p-v8', '5004', 75_000, 'j-v8-item');

    db.prepare(
      `INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan)
       VALUES (?, ?, ?, ?)`,
    ).run(2025, WAKTU, '/backup/2025.db', 'Tutup buku v8');

    db.pragma('user_version = 8');
  } finally {
    db.close();
  }
}

function bacaDataPreserved(db: Database.Database): {
  panjar: unknown[];
  item: unknown[];
  tutup: unknown[];
} {
  return {
    panjar: db
      .prepare(
        `SELECT id, tanggal, penerima, jumlah, akun_kas_sumber, status,
                jurnal_open_id, jurnal_close_id
           FROM panjar ORDER BY id`,
      )
      .all(),
    item: db
      .prepare(
        `SELECT panjar_id, kategori_baga, nominal, jurnal_id
           FROM panjar_item ORDER BY id`,
      )
      .all(),
    tutup: db
      .prepare(
        `SELECT tahun, created_at, backup_path, catatan
           FROM tutup_buku ORDER BY tahun`,
      )
      .all(),
  };
}

describe('DB-06 — data v8 aman saat openDb', () => {
  it('mempertahankan panjar/panjar_item/tutup_buku pada openDb dan reopen', () => {
    const path = tmpDb('pura-db06-v8-');
    buatFixtureV8(path);

    const db = openDb(path);
    let data: ReturnType<typeof bacaDataPreserved>;
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      data = bacaDataPreserved(db);
      expect(data.panjar).toEqual([
        {
          id: 'p-v8',
          tanggal: '2026-01-02',
          penerima: 'Penerima v8',
          jumlah: 150_000,
          akun_kas_sumber: '1001',
          status: 'OPEN',
          jurnal_open_id: 'j-v8-open',
          jurnal_close_id: null,
        },
      ]);
      expect(data.item).toEqual([
        {
          panjar_id: 'p-v8',
          kategori_baga: '5004',
          nominal: 75_000,
          jurnal_id: 'j-v8-item',
        },
      ]);
      expect(data.tutup).toEqual([
        {
          tahun: 2025,
          created_at: WAKTU,
          backup_path: '/backup/2025.db',
          catatan: 'Tutup buku v8',
        },
      ]);
    } finally {
      db.close();
    }

    // Buka ulang tidak boleh menjalankan drop berbasis bentuk/versi lama.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(SCHEMA_VERSION);
      expect(bacaDataPreserved(db2)).toEqual(data);
    } finally {
      db2.close();
    }

    const db3 = openDb(path);
    try {
      expect(bacaDataPreserved(db3)).toEqual(data);
    } finally {
      db3.close();
    }
  });
});

describe('DB-06 — cleanup single-entry hanya untuk versi asli < 3', () => {
  it('DB v2: transaksi/coa hilang dan skema current terbentuk', () => {
    const path = tmpDb('pura-db06-v2-');
    const lama = new Database(path);
    try {
      lama.exec(`
        CREATE TABLE coa (kode TEXT PRIMARY KEY, nama TEXT NOT NULL, tipe TEXT NOT NULL);
        CREATE TABLE transaksi (
          id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, keterangan TEXT NOT NULL,
          akun_kas TEXT NOT NULL, kategori TEXT NOT NULL,
          masuk INTEGER NOT NULL DEFAULT 0, keluar INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL DEFAULT '');

        INSERT INTO coa (kode, nama, tipe) VALUES ('1001', 'KAS', 'ASET');
        INSERT INTO transaksi
          (id, tanggal, keterangan, akun_kas, kategori, masuk, keluar)
        VALUES ('t-lama', '2025-12-31', 'Data lama', '1001', '4005', 123, 0);
        INSERT INTO pengaturan (kunci, nilai) VALUES ('pin_salt', 'lama');
        PRAGMA user_version = 2;
      `);
    } finally {
      lama.close();
    }

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      const tabel = daftarTabel(db);
      for (const usang of TABEL_SINGLE_ENTRY_LAMA) {
        expect(tabel, `tabel ${usang} harus dibuang`).not.toContain(usang);
      }
      for (const wajib of [
        'akun',
        'jurnal',
        'jurnal_baris',
        'panjar',
        'panjar_item',
        'tutup_buku',
        'audit_log',
      ]) {
        expect(tabel, `tabel ${wajib} wajib ada`).toContain(wajib);
      }
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'pin_salt'").get()).toEqual({
        nilai: 'lama',
      });
      expect(db.prepare("SELECT 1 FROM akun WHERE kode = '1001'").get()).toBeTruthy();
    } finally {
      db.close();
    }
  });

  it('DB current tidak menjalankan cleanup legacy meski tabel lama muncul lagi', () => {
    const path = tmpDb('pura-db06-current-');
    const awal = openDb(path);
    awal.close();

    const cur = new Database(path);
    try {
      cur.exec(`
        CREATE TABLE transaksi (id TEXT PRIMARY KEY, nominal INTEGER NOT NULL);
        CREATE TABLE coa (kode TEXT PRIMARY KEY, nama TEXT NOT NULL);
        INSERT INTO transaksi (id, nominal) VALUES ('t-current', 500);
        INSERT INTO coa (kode, nama) VALUES ('1001', 'KAS');
      `);
    } finally {
      cur.close();
    }

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(daftarTabel(db)).toEqual(expect.arrayContaining(['transaksi', 'coa']));
      expect(db.prepare('SELECT nominal FROM transaksi WHERE id = ?').get('t-current')).toEqual({
        nominal: 500,
      });
      expect(db.prepare('SELECT nama FROM coa WHERE kode = ?').get('1001')).toEqual({
        nama: 'KAS',
      });
    } finally {
      db.close();
    }
  });
});

describe('DB-06 — DROP tidak lagi diputuskan dari bentuk kolom', () => {
  it('panjar/tutup_buku bentuk lama tidak dibuang hanya karena kolomnya berbeda', () => {
    const path = tmpDb('pura-db06-shape-');
    const lama = new Database(path);
    try {
      lama.exec(`
        CREATE TABLE panjar (
          id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, penerima TEXT NOT NULL,
          jumlah INTEGER NOT NULL, akun_kas_sumber TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN'
        );
        CREATE TABLE panjar_item (
          panjar_id TEXT NOT NULL, kategori_baga TEXT NOT NULL, nominal INTEGER NOT NULL
        );
        CREATE TABLE tutup_buku (
          tahun INTEGER PRIMARY KEY, laba INTEGER NOT NULL,
          created_at TEXT NOT NULL, backup_path TEXT NOT NULL DEFAULT ''
        );

        INSERT INTO panjar
          (id, tanggal, penerima, jumlah, akun_kas_sumber, status)
        VALUES ('p-bentuk-lama', '2025-01-01', 'Lama', 100, '1001', 'OPEN');
        INSERT INTO panjar_item (panjar_id, kategori_baga, nominal)
        VALUES ('p-bentuk-lama', '5004', 50);
        INSERT INTO tutup_buku (tahun, laba, created_at)
        VALUES (2025, 999, '2025-12-31T00:00:00.000Z');
        PRAGMA user_version = 2;
      `);
    } finally {
      lama.close();
    }

    const db = openDb(path);
    try {
      const tabel = daftarTabel(db);
      expect(tabel).toEqual(expect.arrayContaining(['panjar', 'panjar_item', 'tutup_buku']));
      expect(
        (db.pragma('table_info(panjar)') as { name: string }[]).map((k) => k.name),
      ).not.toContain('jurnal_open_id');
      expect(
        (db.pragma('table_info(tutup_buku)') as { name: string }[]).map((k) => k.name),
      ).toContain('laba');
      expect(db.prepare('SELECT penerima FROM panjar WHERE id = ?').get('p-bentuk-lama')).toEqual({
        penerima: 'Lama',
      });
      expect(db.prepare('SELECT nominal FROM panjar_item').get()).toEqual({ nominal: 50 });
      expect(db.prepare('SELECT laba FROM tutup_buku WHERE tahun = 2025').get()).toEqual({
        laba: 999,
      });
    } finally {
      db.close();
    }
  });

  it('database.ts tidak memakai kolomTabel/table_info untuk memutuskan DROP', () => {
    const sumber = readFileSync(join(process.cwd(), 'src/db/database.ts'), 'utf8');
    expect(sumber).not.toContain('buangTabelLama');

    // Pemakaian bentuk kolom hanya untuk ALTER TABLE aditif: audit_log (P0-9),
    // akun (DB-14), panjar_item (DB-18), dan guard index link panjar DB-20
    // (tabel panjar bentuk lama tidak direbuild). Tidak boleh ada panggilan
    // shape-check untuk tabel lain.
    const panggilanKolom = [...sumber.matchAll(/kolomTabel\(db,\s*'([^']+)'\)/g)].map(
      (m) => m[1],
    );
    expect(panggilanKolom).toEqual(['akun', 'panjar_item', 'panjar', 'audit_log']);
    expect(sumber.match(/table_info\(/g) ?? []).toHaveLength(1);

    // Blok cleanup legacy hanya berisi daftar tabel eksplisit + DROP IF EXISTS;
    // tidak membaca bentuk kolom.
    const awalLegacy = sumber.indexOf('function terapkanMigrasiSingleEntryLama');
    const akhirLegacy = sumber.indexOf('/**\n * AUD-23');
    expect(awalLegacy).toBeGreaterThanOrEqual(0);
    expect(akhirLegacy).toBeGreaterThan(awalLegacy);
    const blokLegacy = sumber.slice(awalLegacy, akhirLegacy);
    expect(blokLegacy).not.toMatch(/kolomTabel|table_info|pragma/i);

    expect(TABEL_SINGLE_ENTRY_LAMA).toEqual(['transaksi', 'coa']);
    for (const terlarang of ['panjar', 'panjar_item', 'tutup_buku']) {
      expect(TABEL_SINGLE_ENTRY_LAMA).not.toContain(terlarang);
      expect(TABEL_DIHAPUS_V12).not.toContain(terlarang);
    }
  });
});
