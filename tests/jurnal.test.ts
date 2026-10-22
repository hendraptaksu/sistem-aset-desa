// P0-2: skema & repository jurnal double-entry.
// Fokus: jurnal seimbang tersimpan atomik, input tidak sah ditolak,
// migrasi `user_version` aman untuk DB lama (POC, tanpa migrasi data).

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import {
  getJurnal,
  getJurnalDetail,
  insertJurnal,
  listJurnal,
  listJurnalBaris,
} from '../src/db/repository.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const dirs: string[] = [];

function freshDb(): { dir: string; path: string; db: ReturnType<typeof openDb> } {
  const dir = mkdtempSync(join(tmpdir(), 'pura-jurnal-'));
  dirs.push(dir);
  const path = join(dir, 'pura.db');
  return { dir, path, db: openDb(path) };
}

function versi(db: ReturnType<typeof openDb>): number {
  return Number(db.pragma('user_version', { simple: true }));
}

const pasangan = (akunDebit: string, akunKredit: string, nominal = 100_000): JurnalBarisInput[] => [
  { akun_kode: akunDebit, debit: nominal, kredit: 0 },
  { akun_kode: akunKredit, debit: 0, kredit: nominal },
];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P0-2 — skema jurnal double-entry', () => {
  it('membuat tabel jurnal + jurnal_baris dan menaikkan user_version ke versi skema', () => {
    const { db } = freshDb();
    try {
      expect(SCHEMA_VERSION).toBe(3);
      expect(versi(db)).toBe(SCHEMA_VERSION);
      const tabel = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('jurnal', 'jurnal_baris') ORDER BY name",
        )
        .all() as { name: string }[];
      expect(tabel.map((t) => t.name)).toEqual(['jurnal', 'jurnal_baris']);
      const index = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_jurnal%' ORDER BY name",
        )
        .all() as { name: string }[];
      expect(index.map((i) => i.name)).toEqual(
        expect.arrayContaining([
          'idx_jurnal_baris_akun',
          'idx_jurnal_baris_jurnal',
          'idx_jurnal_grup',
          'idx_jurnal_tanggal',
        ]),
      );

      // P0-3: DB fresh tidak lagi membuat tabel single-entry lama.
      const lama = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('transaksi', 'panjar', 'panjar_item', 'coa')",
        )
        .all();
      expect(lama).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('menyimpan jurnal seimbang: grup_id default = id, created_at ISO, baris urut', () => {
    const { db } = freshDb();
    try {
      const jurnal = insertJurnal(
        db,
        {
          id: 'j-parkir-1',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Terima uang parkir',
        },
        pasangan('1001', '4005'),
      );

      expect(jurnal).toMatchObject({
        id: 'j-parkir-1',
        tanggal: '2026-01-02',
        no_bukti: 'JU-2026-0001',
        keterangan: 'Terima uang parkir',
        jenis: 'UMUM',
        grup_id: 'j-parkir-1',
        reversal_of: null,
      });
      expect(new Date(jurnal.created_at).toISOString()).toBe(jurnal.created_at);

      expect(getJurnal(db, 'j-parkir-1')).toEqual(jurnal);
      const detail = getJurnalDetail(db, 'j-parkir-1');
      expect(detail?.baris).toHaveLength(2);
      expect(detail?.baris[0]).toMatchObject({
        jurnal_id: 'j-parkir-1',
        akun_kode: '1001',
        debit: 100_000,
        kredit: 0,
        keterangan: '',
      });
      expect(detail?.baris[1]).toMatchObject({
        akun_kode: '4005',
        debit: 0,
        kredit: 100_000,
      });
      expect(detail!.baris[0]!.id).toBeLessThan(detail!.baris[1]!.id);
      expect(getJurnalDetail(db, 'tidak-ada')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('menolak jurnal tidak seimbang / <2 baris / nominal 0 & atomik (tidak ada sisa baris)', () => {
    const { db } = freshDb();
    try {
      const kasus: JurnalBarisInput[][] = [
        [], // kosong
        [{ akun_kode: '1001', debit: 100_000, kredit: 0 }], // 1 baris
        // tidak seimbang
        [
          { akun_kode: '1001', debit: 100_000, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 90_000 },
        ],
        // nominal nol
        [
          { akun_kode: '1001', debit: 0, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 0 },
        ],
        // negatif
        [
          { akun_kode: '1001', debit: -1, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: -1 },
        ],
        // bukan bilangan bulat
        [
          { akun_kode: '1001', debit: 1.5, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 1.5 },
        ],
        // dua sisi sekaligus
        [
          { akun_kode: '1001', debit: 100, kredit: 100 },
          { akun_kode: '4005', debit: 100, kredit: 100 },
        ],
        // akun tidak dikenal
        pasangan('1001', '9999'),
      ];

      for (const baris of kasus) {
        expect(() =>
          insertJurnal(
            db,
            { id: `j-gagal-${kasus.indexOf(baris)}`, tanggal: '2026-01-02', keterangan: 'Uji' },
            baris,
          ),
        ).toThrow();
      }
      expect(listJurnal(db)).toEqual([]);
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get(),
      ).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('menolak keterangan kosong, tanggal tidak valid, dan ID duplikat', () => {
    const { db } = freshDb();
    try {
      expect(() =>
        insertJurnal(db, { id: 'j-a', tanggal: '2026-01-02', keterangan: '   ' }, pasangan('1001', '4005')),
      ).toThrow(/Keterangan/);
      expect(() =>
        insertJurnal(db, { id: 'j-b', tanggal: '02-01-2026', keterangan: 'Salah format' }, pasangan('1001', '4005')),
      ).toThrow(/Tanggal/);

      insertJurnal(db, { id: 'j-c', tanggal: '2026-01-02', keterangan: 'Asli' }, pasangan('1001', '4005'));
      expect(() =>
        insertJurnal(db, { id: 'j-c', tanggal: '2026-01-03', keterangan: 'Duplikat' }, pasangan('1029', '4005')),
      ).toThrow(/sudah ada/);
      expect(listJurnal(db)).toHaveLength(1);
      expect(listJurnalBaris(db, 'j-c')).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('mendukung grup, reversal_of, created_at eksplisit, dan menolak referensi reversal asing', () => {
    const { db } = freshDb();
    try {
      insertJurnal(
        db,
        {
          id: 'j-asli',
          tanggal: '2026-02-01',
          keterangan: 'Beli alat',
          grup_id: 'g-beli-alat',
          created_at: '2026-02-01T10:00:00.000Z',
        },
        pasangan('5003', '1001'),
      );
      const reversal = insertJurnal(
        db,
        {
          id: 'j-balik',
          tanggal: '2026-02-02',
          keterangan: 'KOREKSI: beli alat',
          grup_id: 'g-beli-alat',
          reversal_of: 'j-asli',
        },
        pasangan('1001', '5003'),
      );
      expect(reversal.reversal_of).toBe('j-asli');
      expect(reversal.grup_id).toBe('g-beli-alat');

      expect(() =>
        insertJurnal(
          db,
          { id: 'j-asing', tanggal: '2026-02-03', keterangan: 'Salah', reversal_of: 'tidak-ada' },
          pasangan('1001', '4005'),
        ),
      ).toThrow(/tidak ditemukan/);
    } finally {
      db.close();
    }
  });

  it('listJurnal mendukung filter periode, jenis, grup, akun, dan pagination', () => {
    const { db } = freshDb();
    try {
      insertJurnal(db, { id: 'j-1', tanggal: '2026-01-05', keterangan: 'Parkir', jenis: 'TERIMA', grup_id: 'g-pendapatan' }, pasangan('1001', '4005'));
      insertJurnal(db, { id: 'j-2', tanggal: '2026-02-10', keterangan: 'Listrik', jenis: 'BAYAR' }, pasangan('5010', '1001'));
      insertJurnal(db, { id: 'j-3', tanggal: '2026-02-20', keterangan: 'Beji', jenis: 'TERIMA', grup_id: 'g-pendapatan' }, pasangan('1001', '4001'));
      insertJurnal(db, { id: 'j-4', tanggal: '2026-03-01', keterangan: 'Pindah dana', jenis: 'TRANSFER' }, pasangan('1029', '1001'));

      const ids = (f: Parameters<typeof listJurnal>[1] = {}) => listJurnal(db, f).map((j) => j.id);
      expect(ids()).toEqual(['j-1', 'j-2', 'j-3', 'j-4']);
      expect(ids({ mulai: '2026-02-01' })).toEqual(['j-2', 'j-3', 'j-4']);
      expect(ids({ sampai: '2026-02-20' })).toEqual(['j-1', 'j-2', 'j-3']);
      expect(ids({ jenis: 'TERIMA' })).toEqual(['j-1', 'j-3']);
      expect(ids({ grup_id: 'g-pendapatan' })).toEqual(['j-1', 'j-3']);
      expect(ids({ akun_kode: '5010' })).toEqual(['j-2']);
      expect(ids({ limit: 2 })).toEqual(['j-1', 'j-2']);
      expect(ids({ limit: 1, offset: 2 })).toEqual(['j-3']);
      expect(ids({ offset: 2 })).toEqual(['j-3', 'j-4']);
      expect(ids({ limit: 0 })).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('P0-3 — reset DB lama (POC, tanpa migrasi data)', () => {
  it('membuang tabel single-entry, mempertahankan pengaturan & aset, idempoten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-migrasi-'));
    dirs.push(dir);
    const path = join(dir, 'lama.db');

    // Simulasi DB v1 (single-entry) sebelum reset POC.
    const lama = new Database(path);
    lama.exec(`
      CREATE TABLE coa (kode TEXT PRIMARY KEY, nama TEXT NOT NULL, tipe TEXT NOT NULL);
      CREATE TABLE transaksi (
        id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, keterangan TEXT NOT NULL,
        akun_kas TEXT NOT NULL, kategori TEXT NOT NULL,
        masuk INTEGER NOT NULL DEFAULT 0, keluar INTEGER NOT NULL DEFAULT 0
      );
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
      CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL DEFAULT '');
      CREATE TABLE aset (
        id TEXT PRIMARY KEY, kode TEXT NOT NULL UNIQUE, nama TEXT NOT NULL,
        jenis TEXT NOT NULL DEFAULT 'LAINNYA', luas_m2 REAL, lokasi TEXT NOT NULL DEFAULT '',
        status_hukum TEXT NOT NULL DEFAULT '', tahun_perolehan INTEGER,
        asal_usul TEXT NOT NULL DEFAULT '', kondisi TEXT NOT NULL DEFAULT 'BAIK',
        keterangan TEXT NOT NULL DEFAULT '', nilai_sen INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 0;
    `);
    lama.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('pin_salt', 'lama')").run();
    lama
      .prepare(
        "INSERT INTO transaksi (id, tanggal, keterangan, akun_kas, kategori, masuk, keluar) VALUES ('t-lama', '2025-12-31', 'Data lama', '1001', '4005', 123, 0)",
      )
      .run();
    lama
      .prepare(
        `INSERT INTO aset (id, kode, nama, jenis, lokasi, status_hukum, asal_usul,
          kondisi, keterangan, created_at, updated_at)
         VALUES ('a-lama', 'AST-001', 'Tanah Druwe', 'TANAH', 'Puri', 'druwe', '',
          'BAIK', '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`,
      )
      .run();
    lama.prepare("INSERT INTO tutup_buku (tahun, laba, created_at) VALUES (2025, 999, '2025-12-31T00:00:00.000Z')").run();
    lama.close();

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);

      const tabel = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => t.name);
      for (const usang of ['transaksi', 'panjar', 'panjar_item', 'coa']) {
        expect(tabel, `tabel ${usang} harus dibuang`).not.toContain(usang);
      }

      // PIN & inventaris aset dipertahankan.
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'pin_salt'").get()).toEqual({ nilai: 'lama' });
      expect(db.prepare("SELECT kode, nama FROM aset WHERE id = 'a-lama'").get()).toEqual({
        kode: 'AST-001',
        nama: 'Tanah Druwe',
      });

      // tutup_buku lama (punya `laba`) diganti bentuk v2 tanpa angka laba tersimpan.
      const kolom = (db.pragma('table_info(tutup_buku)') as { name: string }[]).map((k) => k.name);
      expect(kolom).toEqual(expect.arrayContaining(['tahun', 'created_at', 'backup_path', 'catatan']));
      expect(kolom).not.toContain('laba');

      expect(listJurnal(db)).toEqual([]);
      expect(() =>
        insertJurnal(db, { id: 'j-baru', tanggal: '2026-01-01', keterangan: 'Setelah reset' }, pasangan('1001', '4005')),
      ).not.toThrow();
    } finally {
      db.close();
    }

    // Buka ulang: reset idempoten, jurnal tetap ada.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(SCHEMA_VERSION);
      expect(listJurnal(db2).map((j) => j.id)).toEqual(['j-baru']);
    } finally {
      db2.close();
    }
  });

  it('DB v2 awal (P0-2) yang masih membawa tabel lama ikut dibersihkan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-migrasi-v2-'));
    dirs.push(dir);
    const path = join(dir, 'p0-2.db');

    // DB v2 P0-2: user_version sudah 2, tetapi tabel single-entry masih ada.
    const lama = new Database(path);
    lama.exec(`
      CREATE TABLE transaksi (
        id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, keterangan TEXT NOT NULL,
        akun_kas TEXT NOT NULL, kategori TEXT NOT NULL,
        masuk INTEGER NOT NULL DEFAULT 0, keluar INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE coa (kode TEXT PRIMARY KEY, nama TEXT NOT NULL, tipe TEXT NOT NULL);
      PRAGMA user_version = 2;
    `);
    lama.prepare("INSERT INTO transaksi (id, tanggal, keterangan, akun_kas, kategori) VALUES ('t-lama', '2026-01-01', 'Lama', '1001', '4005')").run();
    lama.close();

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      const tabel = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => t.name);
      expect(tabel).not.toContain('transaksi');
      expect(tabel).not.toContain('coa');
      expect(tabel).toEqual(expect.arrayContaining(['akun', 'jurnal', 'jurnal_baris']));
    } finally {
      db.close();
    }
  });
});
