// Lapisan SQLite (better-sqlite3, sync). Single-file lokal — dokumen arah §3.
// Satu-satunya file yang boleh membuat/mengubah tabel = file ini.
// Agent B memakai repository.ts (read) — JANGAN tulis SQL DDL di tempat lain.

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { AKUN_HUTANG_USAHA, COA } from './coa.js';

/**
 * Versi skema di `PRAGMA user_version`.
 * - 0/v1 = model single-entry lama (transaksi + kategori).
 * - 2    = model double-entry (jurnal + jurnal_baris). Tabel single-entry lama
 *          dibuang saat reset POC (P0-3); tidak ada migrasi data (K6).
 * - 3    = audit log lengkap (P0-9): kolom `data_baru_json` (sebelum/sesudah).
 * - 4    = metadata panjar v2 (P1-4): `panjar` + `panjar_item` menyimpan
 *          dokumen serah/pertanggungjawaban, bukan saldo/laba. Jurnal tetap
 *          satu-satunya sumber angka.
 * - 5    = master pihak + penghubung jurnal-pihak (P1-5). Fitur dihapus dari
 *          UI/API pada DB-23b; tabelnya dibuang oleh migrasi v12 (DB-33).
 * - 6    = pagu anggaran per tahun (P2-1). Modul dihapus pada DB-24; tabelnya
 *          dibuang oleh migrasi v12 (DB-33).
 * - 7    = rekonsiliasi bank (P2-2). Modul dihapus pada DB-31; tabelnya
 *          dibuang oleh migrasi v12 (DB-33).
 * - 8    = tabel legacy `lampiran_jurnal` (P2-4). Modul dihapus pada DB-37;
 *          tabelnya dibuang oleh migrasi v12 (DB-33).
 * - 9    = integritas jurnal (AUD-23): trigger menolak baris debit+kredit
 *          sekaligus dan menolak update/delete jurnal; nomor bukti unik per
 *          tahun (bukan global).
 * - 10   = pemisahan akun utang usaha (AKT-20): COA statis 2060 HUTANG USAHA
 *          di-seed idempoten (tanpa DDL baru); 2050 tetap pinjaman/legacy.
 *          Versi ini juga mencegah aplikasi v9 membuka backup v10.
 * - 11   = audit log append-only + tutup buku tidak bisa dihapus (AKT-26):
 *          trigger menolak update/delete `audit_log` dan delete `tutup_buku`.
 *          Update `tutup_buku` tetap diizinkan karena tutup ulang memakai
 *          `ON CONFLICT DO UPDATE`.
 * - 12   = drop tabel modul yang sudah dihapus (DB-33): rekonsiliasi_bank,
 *          anggaran, aset, lampiran_jurnal, jurnal_pihak, lalu pihak.
 *          Jurnal/panjar/tutup buku/audit/pengaturan tetap dipertahankan.
 */
export const SCHEMA_VERSION = 12;

/**
 * DDL dasar v2–v12. Hanya berisi tabel model baru + tabel pendukung
 * (pengaturan PIN). Tabel modul yang sudah dihapus (pihak, jurnal_pihak, aset,
 * anggaran, rekonsiliasi_bank, lampiran_jurnal) TIDAK dibuat lagi; migrasi v12
 * (DB-33) membuangnya dari DB lama.
 * Tabel single-entry lama TIDAK dibuat lagi; `buangTabelLama()` membersihkannya
 * dari DB lama, sedangkan metadata panjar v2 dipertahankan.
 * Aturan integritas v9 (trigger + unique index per tahun) dibuat oleh
 * `terapkanAturanV9()` agar DB lama ikut termigrasi dan idempoten.
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
-- AUD-23: tidak ada lagi index no_bukti global. Unique index per tahun dibuat
-- oleh terapkanAturanV9() supaya nomor yang sama boleh dipakai di tahun berbeda.

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

-- Audit log lengkap (P0-9): alasan + kondisi sebelum/sesudah dalam JSON.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  aksi TEXT NOT NULL,
  alasan TEXT NOT NULL,
  data_lama_json TEXT NOT NULL DEFAULT '',
  data_baru_json TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_tanggal ON audit_log(tanggal);
CREATE INDEX IF NOT EXISTS idx_audit_aksi ON audit_log(aksi);

CREATE TABLE IF NOT EXISTS pengaturan (
  kunci TEXT PRIMARY KEY,
  nilai TEXT NOT NULL DEFAULT ''
);

-- Panjar v2 (P1-4): dokumen serah & pertanggungjawaban.
-- Angka saldo/realisasi TIDAK disimpan di sini; laporan tetap dihitung dari
-- jurnal. Tabel ini hanya menyimpan metadata dokumen + rincian item.
CREATE TABLE IF NOT EXISTS panjar (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  penerima TEXT NOT NULL,
  jumlah INTEGER NOT NULL CHECK (jumlah > 0),
  akun_kas_sumber TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  tanggal_close TEXT,
  jurnal_open_id TEXT NOT NULL,
  jurnal_close_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (akun_kas_sumber) REFERENCES akun(kode),
  FOREIGN KEY (jurnal_open_id) REFERENCES jurnal(id),
  FOREIGN KEY (jurnal_close_id) REFERENCES jurnal(id)
);
CREATE INDEX IF NOT EXISTS idx_panjar_status ON panjar(status);
CREATE INDEX IF NOT EXISTS idx_panjar_tanggal ON panjar(tanggal);

CREATE TABLE IF NOT EXISTS panjar_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panjar_id TEXT NOT NULL,
  kategori_baga TEXT NOT NULL,
  nominal INTEGER NOT NULL CHECK (nominal > 0),
  jurnal_id TEXT NOT NULL,
  FOREIGN KEY (panjar_id) REFERENCES panjar(id) ON DELETE CASCADE,
  FOREIGN KEY (kategori_baga) REFERENCES akun(kode),
  FOREIGN KEY (jurnal_id) REFERENCES jurnal(id)
);
CREATE INDEX IF NOT EXISTS idx_panjar_item_panjar ON panjar_item(panjar_id);
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
 * K6: POC, data single-entry lama dibuang. Hapus `transaksi`/`coa` dan panjar
 * bentuk v1 (tanpa jurnal_open_id). Panjar bentuk v2 (P1-4) dipertahankan agar
 * metadata dokumen tidak hilang saat aplikasi dibuka ulang.
 * `pengaturan` (PIN) dipertahankan. Tabel modul yang sudah dihapus dibuang oleh
 * `terapkanMigrasiV12()` (DB-33), bukan di sini.
 */
function buangTabelLama(db: Database.Database): void {
  db.exec('DROP TABLE IF EXISTS transaksi');
  db.exec('DROP TABLE IF EXISTS coa');

  // Panjar v1 (single-entry) tidak punya kolom jurnal_open_id / jurnal_id.
  // Bentuk v2 (P1-4) WAJIB dipertahankan: metadata panjar jangan hilang hanya
  // karena aplikasi dibuka ulang. Anak dibuang lebih dulu agar aman FK.
  if (tabelAda(db, 'panjar') && !kolomTabel(db, 'panjar').includes('jurnal_open_id')) {
    db.exec('DROP TABLE IF EXISTS panjar_item');
    db.exec('DROP TABLE IF EXISTS panjar');
  } else if (tabelAda(db, 'panjar_item')) {
    const kolomItem = kolomTabel(db, 'panjar_item');
    if (!kolomItem.includes('id') || !kolomItem.includes('jurnal_id')) {
      db.exec('DROP TABLE IF EXISTS panjar_item');
    }
  }

  // tutup_buku lama menyimpan `laba` (sumber bug Neraca v1). Buang hanya bila
  // bentuknya masih lama; bentuk v2 (tanpa laba) dipertahankan.
  if (tabelAda(db, 'tutup_buku') && kolomTabel(db, 'tutup_buku').includes('laba')) {
    db.exec('DROP TABLE IF EXISTS tutup_buku');
  }
}

/**
 * AUD-23 — aturan integritas v9. Dijalankan setiap `migrasi()` agar DB lama
 * (v8) ikut terlindungi dan DB yang sudah v9 tetap konsisten bila trigger
 * hilang. Semua perintah idempoten:
 * - index global lama dibuang (nomor bukti kini unik PER TAHUN);
 * - trigger menolak baris dengan debit & kredit sekaligus;
 * - trigger menolak update/delete jurnal dan barisnya (koreksi lewat reversal).
 */
function terapkanAturanV9(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_jurnal_no_bukti;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_jurnal_no_bukti_tahun
      ON jurnal(substr(tanggal, 1, 4), no_bukti COLLATE NOCASE)
      WHERE no_bukti <> '';

    CREATE TRIGGER IF NOT EXISTS trg_jurnal_baris_satu_sisi_insert
    BEFORE INSERT ON jurnal_baris
    WHEN NEW.debit > 0 AND NEW.kredit > 0
    BEGIN
      SELECT RAISE(ABORT, 'Baris jurnal tidak boleh mengisi debit dan kredit sekaligus. Isi salah satu saja.');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_jurnal_baris_satu_sisi_update
    BEFORE UPDATE ON jurnal_baris
    WHEN NEW.debit > 0 AND NEW.kredit > 0
    BEGIN
      SELECT RAISE(ABORT, 'Baris jurnal tidak boleh mengisi debit dan kredit sekaligus. Isi salah satu saja.');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_jurnal_immutable_update
    BEFORE UPDATE ON jurnal
    BEGIN
      SELECT RAISE(ABORT, 'Jurnal tidak boleh diubah. Koreksi dilakukan dengan jurnal balik (reversal).');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_jurnal_immutable_delete
    BEFORE DELETE ON jurnal
    BEGIN
      SELECT RAISE(ABORT, 'Jurnal tidak boleh dihapus. Koreksi dilakukan dengan jurnal balik (reversal).');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_jurnal_baris_immutable_update
    BEFORE UPDATE ON jurnal_baris
    BEGIN
      SELECT RAISE(ABORT, 'Baris jurnal tidak boleh diubah. Koreksi dilakukan dengan jurnal balik (reversal).');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_jurnal_baris_immutable_delete
    BEFORE DELETE ON jurnal_baris
    BEGIN
      SELECT RAISE(ABORT, 'Baris jurnal tidak boleh dihapus. Koreksi dilakukan dengan jurnal balik (reversal).');
    END;
  `);
}

/**
 * AKT-20 — kontrak COA v10. Tidak ada DDL baru: cukup memastikan akun
 * `2060 HUTANG USAHA` tersedia saat DB lama dibuka. Upsert idempoten agar
 * membuka DB berulang tidak menggandakan baris dan DB v9 tetap utuh.
 * Seed lengkap tetap dilakukan `openDb` setelah migrasi.
 */
function terapkanKontrakV10(db: Database.Database): void {
  const akun = COA.find((a) => a.kode === AKUN_HUTANG_USAHA);
  if (!akun) throw new Error('COA 2060 HUTANG USAHA tidak ditemukan.');
  db.prepare(
    `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(kode) DO UPDATE SET
       nama = excluded.nama,
       tipe = excluded.tipe,
       posisi_normal = excluded.posisi_normal`,
  ).run(akun.kode, akun.nama, akun.tipe, akun.posisi_normal);
}

/**
 * AKT-26 — aturan v11: audit log append-only dan `tutup_buku` tidak bisa
 * dihapus. Trigger selalu dibuat ulang (DROP + CREATE) agar DB lama ikut
 * terlindungi dan perubahan definisi trigger di masa depan ikut diterapkan.
 * Update `tutup_buku` sengaja TIDAK diblokir: tutup ulang memakai upsert
 * `ON CONFLICT(tahun) DO UPDATE`.
 */
function terapkanAturanV11(db: Database.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS trg_audit_log_immutable_update;
    CREATE TRIGGER trg_audit_log_immutable_update
    BEFORE UPDATE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log tidak boleh diubah.');
    END;

    DROP TRIGGER IF EXISTS trg_audit_log_immutable_delete;
    CREATE TRIGGER trg_audit_log_immutable_delete
    BEFORE DELETE ON audit_log
    BEGIN
      SELECT RAISE(ABORT, 'Audit log tidak boleh dihapus.');
    END;

    DROP TRIGGER IF EXISTS trg_tutup_buku_immutable_delete;
    CREATE TRIGGER trg_tutup_buku_immutable_delete
    BEFORE DELETE ON tutup_buku
    BEGIN
      SELECT RAISE(ABORT, 'Tutup buku tidak boleh dihapus.');
    END;
  `);
}

/**
 * DB-33 — tabel modul yang sudah dihapus dan disetujui untuk dibuang pada v12.
 * Urutan WAJIB child dulu agar aman dengan `foreign_keys = ON`: `jurnal_pihak`
 * dan `lampiran_jurnal` adalah anak, `pihak` adalah induk. Index/trigger milik
 * tabel ikut terhapus otomatis oleh SQLite.
 */
export const TABEL_DIHAPUS_V12 = [
  'rekonsiliasi_bank',
  'anggaran',
  'aset',
  'lampiran_jurnal',
  'jurnal_pihak',
  'pihak',
] as const;

/**
 * DB-33 — migrasi v12 idempoten: buang hanya tabel yang sudah disetujui.
 * `DROP TABLE IF EXISTS` membuat langkah ini aman dijalankan berulang kali.
 * Jangan menambahkan tabel akuntansi inti (`akun`, `jurnal`, `jurnal_baris`,
 * `tutup_buku`, `audit_log`, `pengaturan`, `panjar`, `panjar_item`) ke daftar
 * ini. Dijalankan di dalam transaksi `migrasi()`.
 */
function terapkanMigrasiV12(db: Database.Database): void {
  for (const tabel of TABEL_DIHAPUS_V12) {
    db.exec(`DROP TABLE IF EXISTS ${tabel}`);
  }
}

/**
 * Migrasi skema berbasis `PRAGMA user_version`, idempoten.
 * - Menolak DB yang dibuat aplikasi versi lebih baru SEBELUM DDL apa pun.
 * - Selalu membersihkan tabel single-entry lama (P0-3).
 * - Membuat seluruh DDL v2 bila belum ada.
 * - Menerapkan aturan integritas v9 (trigger + unique index per tahun).
 * - Menerapkan kontrak COA v10 (akun 2060 idempoten, tanpa DDL).
 * - Menerapkan aturan v11 (audit append-only, tutup buku tidak bisa dihapus).
 * - Menerapkan migrasi v12 (drop tabel modul yang sudah dihapus).
 * - Menaikkan user_version ke versi skema saat ini.
 */
export function migrasi(db: Database.Database): number {
  const versiAwal = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (versiAwal > SCHEMA_VERSION) {
    throw new Error('Database dibuat aplikasi versi lebih baru. Perbarui aplikasi.');
  }
  const siapkan = db.transaction(() => {
    buangTabelLama(db);
    db.exec(DDL);
    // P0-9: DB v2 belum punya kolom data baru. ALTER TABLE idempoten agar DB
    // yang dibuat sebelum audit lengkap tetap terbuka tanpa kehilangan audit lama.
    if (!kolomTabel(db, 'audit_log').includes('data_baru_json')) {
      db.exec("ALTER TABLE audit_log ADD COLUMN data_baru_json TEXT NOT NULL DEFAULT ''");
    }
    terapkanAturanV9(db);
    terapkanKontrakV10(db);
    terapkanAturanV11(db);
    terapkanMigrasiV12(db);
    if (versiAwal < SCHEMA_VERSION) {
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    }
  });
  siapkan();
  return Number(db.pragma('user_version', { simple: true }));
}

/**
 * Buka DB aplikasi. Pemanggil produksi (main) WAJIB memanggil
 * `backupPraUpgrade()` lebih dulu untuk setiap kenaikan versi; modul ini tidak
 * mengurus path folder backup agar tidak terjadi impor melingkar.
 */
export function openDb(path = process.env.PURA_DB ?? './data/pura.db'): Database.Database {
  // better-sqlite3 tidak membuat folder induk — pastikan ada dulu.
  // (PURA_DB default `./data/...` dan folder `data/` di-gitignore sehingga
  // checkout baru pasti belum punya foldernya.)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
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
  } catch (e) {
    // Jangan tinggalkan koneksi/file handle terbuka bila migrasi gagal
    // (penting untuk restore: file harus bisa ditukar/dihapus di Windows).
    try {
      db.close();
    } catch {
      /* biarkan error asli yang dilaporkan */
    }
    throw e;
  }
}
