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
 * - 3    = audit log lengkap (P0-9): kolom `data_baru_json` (sebelum/sesudah).
 * - 4    = metadata panjar v2 (P1-4): `panjar` + `panjar_item` menyimpan
 *          dokumen serah/pertanggungjawaban, bukan saldo/laba. Jurnal tetap
 *          satu-satunya sumber angka.
 * - 5    = master pihak + penghubung jurnal-pihak (P1-5). `jurnal_pihak`
 *          hanya metadata penghubung; saldo per pihak tetap dihitung dari
 *          baris jurnal 1050/2050.
 * - 6    = pagu anggaran per tahun (P2-1). Hanya pagu yang disimpan; realisasi
 *          dan sisa SELALU dihitung dari jurnal lewat core/reports.ts.
 * - 7    = rekonsiliasi bank (P2-2). Hanya saldo menurut rekening koran yang
 *          disimpan; saldo buku, selisih, dan daftar mutasi dihitung dari jurnal.
 * - 8    = lampiran bukti jurnal (P2-4). Hanya metadata; file fisik ada di
 *          `<userData>/attachments` dan TIDAK ikut backup `.db`.
 * - 9    = integritas jurnal (AUD-23): trigger menolak baris debit+kredit
 *          sekaligus dan menolak update/delete jurnal; nomor bukti unik per
 *          tahun (bukan global).
 */
export const SCHEMA_VERSION = 9;

/**
 * DDL dasar v2–v8. Sengaja hanya berisi tabel model baru + tabel pendukung
 * yang tetap dipertahankan (pengaturan PIN & inventaris aset non-akuntansi).
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

-- Master pihak (orang/lembaga) untuk piutang & hutang (P1-5).
-- TIDAK menyimpan saldo: saldo per pihak selalu dihitung dari jurnal.
CREATE TABLE IF NOT EXISTS pihak (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pihak_nama_unik
  ON pihak(nama COLLATE NOCASE);

-- Penghubung jurnal ke pihak. Satu jurnal bisa menyentuh 1050 atau 2050;
-- pasangan (jurnal_id, akun_kode) unik agar tidak ada pemetaan ganda.
CREATE TABLE IF NOT EXISTS jurnal_pihak (
  jurnal_id TEXT NOT NULL,
  pihak_id TEXT NOT NULL,
  akun_kode TEXT NOT NULL,
  PRIMARY KEY (jurnal_id, akun_kode),
  FOREIGN KEY (jurnal_id) REFERENCES jurnal(id) ON DELETE CASCADE,
  FOREIGN KEY (pihak_id) REFERENCES pihak(id),
  FOREIGN KEY (akun_kode) REFERENCES akun(kode)
);
CREATE INDEX IF NOT EXISTS idx_jurnal_pihak_pihak ON jurnal_pihak(pihak_id);

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

-- Pagu anggaran per tahun (P2-1). HANYA pagu yang disimpan; realisasi, sisa,
-- dan % tidak pernah menjadi kolom/tabel — semuanya dihitung ulang dari jurnal.
-- Satu akun hanya punya satu pagu per tahun (PRIMARY KEY), simpan = upsert.
CREATE TABLE IF NOT EXISTS anggaran (
  tahun INTEGER NOT NULL,
  akun_kode TEXT NOT NULL,
  nominal INTEGER NOT NULL CHECK (nominal >= 0),
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (tahun, akun_kode),
  FOREIGN KEY (akun_kode) REFERENCES akun(kode)
);
CREATE INDEX IF NOT EXISTS idx_anggaran_akun ON anggaran(akun_kode);

-- Rekonsiliasi bank (P2-2). HANYA saldo menurut rekening koran yang disimpan.
-- Saldo buku, selisih, status cocok, dan daftar mutasi TIDAK disimpan: semuanya
-- dihitung ulang dari jurnal supaya tidak basi saat ada koreksi.
CREATE TABLE IF NOT EXISTS rekonsiliasi_bank (
  id TEXT PRIMARY KEY,
  akun_kode TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  saldo_bank INTEGER NOT NULL CHECK (saldo_bank >= 0),
  catatan TEXT NOT NULL DEFAULT '',
  selesai INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  selesai_at TEXT,
  FOREIGN KEY (akun_kode) REFERENCES akun(kode)
);
CREATE INDEX IF NOT EXISTS idx_rekonsiliasi_akun_tanggal
  ON rekonsiliasi_bank(akun_kode, tanggal);

-- Lampiran bukti jurnal (P2-4). HANYA metadata: file fisik tinggal di folder
-- <userData>/attachments dan TIDAK ikut backup .db. nama_simpan relatif
-- terhadap folder itu; DB tidak pernah menyimpan path absolut.
CREATE TABLE IF NOT EXISTS lampiran_jurnal (
  id TEXT PRIMARY KEY,
  jurnal_id TEXT NOT NULL,
  nama_asli TEXT NOT NULL,
  nama_simpan TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  ukuran INTEGER NOT NULL CHECK (ukuran >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (jurnal_id) REFERENCES jurnal(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_lampiran_jurnal ON lampiran_jurnal(jurnal_id);
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
 * `pengaturan` (PIN) dan `aset` sengaja dipertahankan.
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
 * Migrasi skema berbasis `PRAGMA user_version`, idempoten.
 * - Selalu membersihkan tabel single-entry lama (P0-3).
 * - Membuat seluruh DDL v2 bila belum ada.
 * - Menerapkan aturan integritas v9 (trigger + unique index per tahun).
 * - Menaikkan user_version ke versi skema saat ini.
 */
export function migrasi(db: Database.Database): number {
  const versiAwal = Number(db.pragma('user_version', { simple: true }) ?? 0);
  const siapkan = db.transaction(() => {
    buangTabelLama(db);
    db.exec(DDL);
    // P0-9: DB v2 belum punya kolom data baru. ALTER TABLE idempoten agar DB
    // yang dibuat sebelum audit lengkap tetap terbuka tanpa kehilangan audit lama.
    if (!kolomTabel(db, 'audit_log').includes('data_baru_json')) {
      db.exec("ALTER TABLE audit_log ADD COLUMN data_baru_json TEXT NOT NULL DEFAULT ''");
    }
    terapkanAturanV9(db);
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
