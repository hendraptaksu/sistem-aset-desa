// Lapisan SQLite (better-sqlite3, sync). Single-file lokal — PRD §4.
// Satu-satunya file yang boleh membuat/mengubah tabel = file ini (Agent A owner).
// Agent B memakai repository.ts (read) — JANGAN tulis SQL DDL di tempat lain.

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { COA } from './coa.js';

/**
 * Versi skema di `PRAGMA user_version`.
 * - 0/v1 = model single-entry lama (transaksi + kategori).
 * - 2    = model double-entry (jurnal + jurnal_baris). Tabel single-entry lama
 *          masih ada sampai reset POC di P0-3.
 */
export const SCHEMA_VERSION = 2;

export const DDL = `
CREATE TABLE IF NOT EXISTS akun (
  kode TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL,
  posisi_normal TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS coa (
  kode TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transaksi (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  keterangan TEXT NOT NULL,
  akun_kas TEXT NOT NULL,
  kategori TEXT NOT NULL,
  masuk INTEGER NOT NULL DEFAULT 0,
  keluar INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_transaksi_tanggal ON transaksi(tanggal);
CREATE INDEX IF NOT EXISTS idx_transaksi_akun ON transaksi(akun_kas);
CREATE INDEX IF NOT EXISTS idx_transaksi_kategori ON transaksi(kategori);
CREATE TABLE IF NOT EXISTS panjar (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  penerima TEXT NOT NULL,
  jumlah INTEGER NOT NULL,
  akun_kas_sumber TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN'
);
CREATE TABLE IF NOT EXISTS panjar_item (
  panjar_id TEXT NOT NULL,
  kategori_baga TEXT NOT NULL,
  nominal INTEGER NOT NULL,
  FOREIGN KEY (panjar_id) REFERENCES panjar(id)
);
CREATE TABLE IF NOT EXISTS tutup_buku (
  tahun INTEGER PRIMARY KEY,
  laba INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  backup_path TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  aksi TEXT NOT NULL,
  alasan TEXT NOT NULL,
  data_lama_json TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS pengaturan (
  kunci TEXT PRIMARY KEY,
  nilai TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS aset (
  id TEXT PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  jenis TEXT NOT NULL DEFAULT 'LAINNYA',
  luas_m2 REAL,
  lokasi TEXT NOT NULL DEFAULT '',
  status_hukum TEXT NOT NULL DEFAULT '',
  tahun_perolehan INTEGER,
  asal_usul TEXT NOT NULL DEFAULT '',
  kondisi TEXT NOT NULL DEFAULT 'BAIK',
  keterangan TEXT NOT NULL DEFAULT '',
  nilai_sen INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aset_jenis ON aset(jenis);
CREATE INDEX IF NOT EXISTS idx_aset_kode ON aset(kode);

-- Model double-entry (v2): jurnal = satu transaksi/bukti, jurnal_baris = debit/kredit.
CREATE TABLE IF NOT EXISTS jurnal (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  no_bukti TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL,
  jenis TEXT NOT NULL DEFAULT 'UMUM',
  grup_id TEXT NOT NULL,
  reversal_of TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reversal_of) REFERENCES jurnal(id)
);
CREATE INDEX IF NOT EXISTS idx_jurnal_tanggal ON jurnal(tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_grup ON jurnal(grup_id);
CREATE INDEX IF NOT EXISTS idx_jurnal_reversal ON jurnal(reversal_of);

CREATE TABLE IF NOT EXISTS jurnal_baris (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jurnal_id TEXT NOT NULL,
  akun_kode TEXT NOT NULL,
  debit INTEGER NOT NULL DEFAULT 0,
  kredit INTEGER NOT NULL DEFAULT 0,
  keterangan TEXT NOT NULL DEFAULT '',
  CHECK (debit >= 0 AND kredit >= 0),
  CHECK (debit > 0 OR kredit > 0),
  FOREIGN KEY (jurnal_id) REFERENCES jurnal(id) ON DELETE CASCADE,
  FOREIGN KEY (akun_kode) REFERENCES akun(kode)
);
CREATE INDEX IF NOT EXISTS idx_jurnal_baris_jurnal ON jurnal_baris(jurnal_id);
CREATE INDEX IF NOT EXISTS idx_jurnal_baris_akun ON jurnal_baris(akun_kode);
`;

/**
 * Migrasi skema berbasis `PRAGMA user_version`, idempoten.
 * Tabel jurnal dibuat oleh DDL di atas (CREATE TABLE IF NOT EXISTS), jadi langkah
 * v0/v1 → v2 cukup menaikkan versi. Pembuangan tabel single-entry lama dilakukan
 * di P0-3 setelah seed v2 siap, supaya commit ini tetap kompatibel dengan UI lama.
 */
export function migrasi(db: Database.Database): number {
  const versiAwal = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (versiAwal >= SCHEMA_VERSION) return versiAwal;
  const naik = db.transaction(() => {
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  naik();
  return Number(db.pragma('user_version', { simple: true }));
}

export function openDb(path = process.env.PURA_DB ?? './data/pura.db'): Database.Database {
  // better-sqlite3 tidak membuat folder induk — pastikan ada dulu.
  // (PURA_DB default `./data/...` dan folder `data/` di-gitignore sehingga
  // checkout baru pasti belum punya foldernya.)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  migrasi(db);
  // Upsert daftar akun resmi saat DB dibuka. `akun` adalah master COA untuk
  // model double-entry; `coa` dipertahankan sampai reset skema P0-3.
  const txCount = (db.prepare('SELECT COUNT(*) AS c FROM transaksi').get() as { c: number }).c;
  const seedTx = db.transaction(() => {
    const upsertAkun = db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(kode) DO UPDATE SET
         nama = excluded.nama,
         tipe = excluded.tipe,
         posisi_normal = excluded.posisi_normal`,
    );
    for (const c of COA) upsertAkun.run(c.kode, c.nama, c.tipe, c.posisi_normal);

    const upsertCoa = db.prepare('INSERT INTO coa (kode, nama, tipe) VALUES (?, ?, ?) ON CONFLICT(kode) DO UPDATE SET nama = excluded.nama, tipe = excluded.tipe');
    for (const c of COA) upsertCoa.run(c.kode, c.nama, c.tipe);
    if (txCount === 0) {
      db.prepare(
        `DELETE FROM coa WHERE kode NOT IN (${COA.map(() => '?').join(',')})`,
      ).run(...COA.map((c) => c.kode));
    }
  });
  seedTx();
  return db;
}
