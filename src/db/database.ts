// Lapisan SQLite (better-sqlite3, sync). Single-file lokal — PRD §4.
// Satu-satunya file yang boleh membuat/mengubah tabel = file ini (Agent A owner).
// Agent B memakai repository.ts (read) — JANGAN tulis SQL DDL di tempat lain.

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { COA } from './coa.js';

export const DDL = `
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
`;

export function openDb(path = process.env.PURA_DB ?? './data/pura.db'): Database.Database {
  // better-sqlite3 tidak membuat folder induk — pastikan ada dulu.
  // (PURA_DB default `./data/...` dan folder `data/` di-gitignore sehingga
  // checkout baru pasti belum punya foldernya.)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(DDL);
  // Upsert COA agar DB lama ikut koreksi nama/kode resmi tanpa menghapus transaksi.
  // Baris COA yang tidak ada di seed HANYA dihapus bila tabel transaksi masih kosong
  // (mencegah referensi yatim di DB produksi).
  const txCount = (db.prepare('SELECT COUNT(*) AS c FROM transaksi').get() as { c: number }).c;
  const seedTx = db.transaction(() => {
    const upsert = db.prepare('INSERT INTO coa (kode, nama, tipe) VALUES (?, ?, ?) ON CONFLICT(kode) DO UPDATE SET nama = excluded.nama, tipe = excluded.tipe');
    for (const c of COA) upsert.run(c.kode, c.nama, c.tipe);
    if (txCount === 0) {
      db.prepare(
        `DELETE FROM coa WHERE kode NOT IN (${COA.map(() => '?').join(',')})`,
      ).run(...COA.map((c) => c.kode));
    }
  });
  seedTx();
  return db;
}
