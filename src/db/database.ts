// Lapisan SQLite (better-sqlite3, sync). Single-file lokal — dokumen arah §3.
// Satu-satunya file yang boleh membuat/mengubah tabel = file ini.
// Agent B memakai repository.ts (read) — JANGAN tulis SQL DDL di tempat lain.

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { COA } from './coa.js';

/**
 * Versi skema di `PRAGMA user_version`.
 * - 0/v1 = model single-entry lama (transaksi + kategori).
 * - 2    = model double-entry (jurnal + jurnal_baris). Tabel single-entry lama
 *          dibuang saat reset POC (P0-3); tidak ada migrasi data (K6).
 */
export const SCHEMA_VERSION = 2;

/**
 * DDL v2. Sengaja hanya berisi tabel model baru + tabel pendukung yang tetap
 * dipertahankan (pengaturan PIN & inventaris aset non-akuntansi).
 * Tabel single-entry lama TIDAK dibuat lagi; `buangTabelLama()` membersihkannya
 * dari DB yang dibuat sebelum P0-3.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS akun (
  kode TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL,
  posisi_normal TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1
);

-- Model double-entry: jurnal = satu transaksi/bukti, jurnal_baris = debit/kredit.
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

-- Tutup buku v2: hanya penanda + kunci + catatan. Laba selalu dihitung dari jurnal
-- (P0-7), bukan disimpan sebagai sumber angka.
CREATE TABLE IF NOT EXISTS tutup_buku (
  tahun INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  backup_path TEXT NOT NULL DEFAULT '',
  catatan TEXT NOT NULL DEFAULT ''
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

-- Inventaris barang non-akuntansi (tidak masuk Neraca/Laba Rugi).
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
`;

function tabelAda(db: Database.Database, nama: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nama),
  );
}

function kolomTabel(db: Database.Database, nama: string): string[] {
  // `nama` selalu konstanta internal, bukan input user.
  return (db.pragma(`table_info(${nama})`) as { name: string }[]).map((k) => k.name);
}

/**
 * K6: POC, data lama dibuang. Hapus tabel single-entry dari DB versi lama
 * (termasuk DB v2 awal P0-2 yang masih membawa tabel lama).
 * `pengaturan` (PIN) dan `aset` sengaja dipertahankan.
 */
function buangTabelLama(db: Database.Database): void {
  // Anak dulu agar tidak melanggar foreign key.
  db.exec('DROP TABLE IF EXISTS panjar_item');
  db.exec('DROP TABLE IF EXISTS panjar');
  db.exec('DROP TABLE IF EXISTS transaksi');
  db.exec('DROP TABLE IF EXISTS coa');

  // tutup_buku lama menyimpan `laba` (sumber bug Neraca v1). Buang hanya bila
  // bentuknya masih lama; bentuk v2 (tanpa laba) dipertahankan.
  if (tabelAda(db, 'tutup_buku') && kolomTabel(db, 'tutup_buku').includes('laba')) {
    db.exec('DROP TABLE IF EXISTS tutup_buku');
  }
}

/**
 * Migrasi skema berbasis `PRAGMA user_version`, idempoten.
 * - Selalu membersihkan tabel single-entry lama (P0-3).
 * - Membuat seluruh DDL v2 bila belum ada.
 * - Menaikkan user_version ke versi skema saat ini.
 */
export function migrasi(db: Database.Database): number {
  const versiAwal = Number(db.pragma('user_version', { simple: true }) ?? 0);
  const siapkan = db.transaction(() => {
    buangTabelLama(db);
    db.exec(DDL);
    if (versiAwal < SCHEMA_VERSION) {
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  });
  siapkan();
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
  migrasi(db);

  // Upsert daftar akun resmi saat DB dibuka. `akun` adalah master COA untuk
  // model double-entry.
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
  });
  seedTx();
  return db;
}
