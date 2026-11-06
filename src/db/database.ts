// Lapisan SQLite (better-sqlite3, sync). Single-file lokal — dokumen arah §3.
// Satu-satunya file yang boleh membuat/mengubah tabel = file ini.
// Agent B memakai repository.ts (read) — JANGAN tulis SQL DDL di tempat lain.

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { JENIS_JURNAL } from '../core/posting.js';
import {
  AKUN_HUTANG_USAHA,
  COA,
  KELOMPOK_AKUN,
  POSISI_NORMAL,
  kelompokDariTipe,
  metadataAkunBawaan,
  type CoaTipe,
} from './coa.js';

/**
 * Versi skema baseline di `PRAGMA user_version`.
 * Aplikasi hanya mendukung skema v1. Database dengan skema lama ditolak dan
 * tidak dimigrasikan: pindahkan atau hapus file DB lama, lalu jalankan
 * aplikasi lagi.
 */
export const SCHEMA_VERSION = 1;

/**
 * AUD2-09 — daftar resmi 11 tabel aktif yang wajib `STRICT`.
 * Urutan mengikuti dokumen ERD; jangan menambah tabel legacy di sini.
 */
export const TABEL_AKTIF = [
  'akun',
  'jurnal',
  'jurnal_baris',
  'tutup_buku',
  'audit_log',
  'pengaturan',
  'panjar',
  'panjar_item',
  'pinjaman',
  'pinjaman_angsuran',
  'pinjaman_bayar',
] as const;

/** DB-05: pesan penolakan DB yang dibuat aplikasi versi lebih baru. */
export const PESAN_DB_VERSI_BARU =
  'Database dibuat aplikasi versi lebih baru. Perbarui aplikasi.';

/**
 * Pesan penolakan DB dengan skema lama/tidak dikenal. Tidak ada jalur migrasi:
 * operator harus memindahkan atau menghapus file DB lalu menjalankan ulang.
 */
export const PESAN_DB_TIDAK_KOMPATIBEL =
  'File database ini dibuat oleh versi/skema lama dan tidak kompatibel. ' +
  'Aplikasi hanya mendukung skema v1. Pindahkan atau hapus file database lama ' +
  'tersebut, lalu jalankan aplikasi lagi.';

/**
 * DDL kanonik skema v1: 11 tabel aktif, semuanya `STRICT`.
 * Tabel modul lama (`transaksi`, `coa`, `pihak`, `jurnal_pihak`, `aset`,
 * `anggaran`, `rekonsiliasi_bank`, `lampiran_jurnal`) tidak pernah dibuat.
 *
 * Semua `CREATE ... IF NOT EXISTS` membuat DDL ini aman dijalankan ulang.
 *
 * Prinsip sumber angka:
 * - `jurnal` adalah satu-satunya sumber angka akuntansi; saldo, laba, dan
 *   realisasi selalu dihitung dari jurnal, tidak dipersistenkan.
 * - `tutup_buku` hanya penanda + catatan; laba dihitung dari jurnal.
 * - `panjar` hanya menyimpan metadata dokumen; total realisasi, sisa, dan
 *   kurang diturunkan dari `panjar_item` + jurnal.
 * - `pinjaman_angsuran` hanya menyimpan rencana pokok/bunga; `pinjaman_bayar`
 *   hanya menyimpan link jurnal + angsuran, tanpa nominal atau saldo berjalan.
 *   Outstanding = `sisa_pokok_awal` dikurangi debit 2050 pada jurnal
 *   pembayaran tertaut, dihitung saat dibaca.
 */
export const DDL = `
CREATE TABLE IF NOT EXISTS akun (
  kode TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL,
  posisi_normal TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1,
  is_kas INTEGER NOT NULL DEFAULT 0,
  kelompok TEXT NOT NULL DEFAULT '',
  sumber TEXT NOT NULL DEFAULT 'BAWAAN'
) STRICT;

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
) STRICT;
CREATE INDEX IF NOT EXISTS idx_jurnal_tanggal ON jurnal(tanggal);
CREATE INDEX IF NOT EXISTS idx_jurnal_grup ON jurnal(grup_id);
CREATE INDEX IF NOT EXISTS idx_jurnal_reversal ON jurnal(reversal_of);
-- Nomor bukti unik per tahun, bukan global: nomor yang sama boleh dipakai
-- pada tahun berbeda.

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
) STRICT;
CREATE INDEX IF NOT EXISTS idx_jurnal_baris_jurnal ON jurnal_baris(jurnal_id);
CREATE INDEX IF NOT EXISTS idx_jurnal_baris_akun ON jurnal_baris(akun_kode);

-- Tutup buku: hanya penanda + kunci + catatan. Laba selalu dihitung dari
-- jurnal, bukan disimpan sebagai sumber angka.
CREATE TABLE IF NOT EXISTS tutup_buku (
  tahun INTEGER PRIMARY KEY,
  created_at TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT ''
) STRICT;

-- Audit log lengkap: alasan + kondisi sebelum/sesudah dalam JSON.
-- ref_type/ref_id menunjuk objek terkait secara terstruktur (mis. 'jurnal' + id)
-- sehingga riwayat tidak perlu LIKE pada aksi. Baris tanpa referensi boleh kosong.
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  aksi TEXT NOT NULL,
  alasan TEXT NOT NULL,
  data_lama_json TEXT NOT NULL DEFAULT '',
  data_baru_json TEXT NOT NULL DEFAULT '',
  ref_type TEXT NOT NULL DEFAULT '',
  ref_id TEXT NOT NULL DEFAULT ''
) STRICT;
CREATE INDEX IF NOT EXISTS idx_audit_tanggal ON audit_log(tanggal);
CREATE INDEX IF NOT EXISTS idx_audit_aksi ON audit_log(aksi);

CREATE TABLE IF NOT EXISTS pengaturan (
  kunci TEXT PRIMARY KEY,
  nilai TEXT NOT NULL DEFAULT ''
) STRICT;

-- Panjar: dokumen serah & pertanggungjawaban.
-- Angka saldo/realisasi TIDAK disimpan di sini; laporan tetap dihitung dari
-- jurnal. Tabel ini hanya menyimpan metadata dokumen + rincian item.
--
-- Kolom header yang SENGAJA disimpan (operasional, bukan angka turunan):
--   tanggal, jumlah, akun_kas_sumber, status, tanggal_close,
--   jurnal_open_id, jurnal_close_id, created_at.
-- tanggal, jumlah, dan akun_kas_sumber wajib sama dengan jurnal serah
-- (D 1040 / K kas sumber) saat dibuat; tanggal_close dan jurnal_close_id
-- diisi saat close. Nilai ini disimpan agar daftar/detail panjar tidak perlu
-- join ke jurnal setiap kali, bukan untuk menggantikan jurnal.
-- Kolom TURUNAN (tidak ada di tabel; dihitung dari panjar_item + jurnal):
--   total_realisasi = SUM(panjar_item.nominal),
--   sisa = max(0, jumlah - total_realisasi),
--   kurang = max(0, total_realisasi - jumlah).
-- panjar_item adalah detail nota per baris dan TIDAK boleh di-drop.
CREATE TABLE IF NOT EXISTS panjar (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  penerima TEXT NOT NULL,
  jumlah INTEGER NOT NULL CHECK (jumlah > 0),
  akun_kas_sumber TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'DIBATALKAN')),
  tanggal_close TEXT,
  jurnal_open_id TEXT NOT NULL,
  jurnal_close_id TEXT,
  created_at TEXT NOT NULL,
  jurnal_batal_id TEXT,
  tanggal_batal TEXT,
  alasan_batal TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (akun_kas_sumber) REFERENCES akun(kode),
  FOREIGN KEY (jurnal_open_id) REFERENCES jurnal(id),
  FOREIGN KEY (jurnal_close_id) REFERENCES jurnal(id),
  FOREIGN KEY (jurnal_batal_id) REFERENCES jurnal(id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_panjar_status ON panjar(status);
CREATE INDEX IF NOT EXISTS idx_panjar_tanggal ON panjar(tanggal);

CREATE TABLE IF NOT EXISTS panjar_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  panjar_id TEXT NOT NULL,
  kategori_baga TEXT NOT NULL,
  nominal INTEGER NOT NULL CHECK (nominal > 0),
  jurnal_id TEXT NOT NULL,
  -- Detail nota per baris; kolom nota boleh kosong.
  nota_nomor TEXT NOT NULL DEFAULT '',
  nota_tanggal TEXT NOT NULL DEFAULT '',
  toko TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (panjar_id) REFERENCES panjar(id) ON DELETE CASCADE,
  FOREIGN KEY (kategori_baga) REFERENCES akun(kode),
  FOREIGN KEY (jurnal_id) REFERENCES jurnal(id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_panjar_item_panjar ON panjar_item(panjar_id);

-- Pinjaman LPD. Rencana angsuran dan pembayaran adalah dua hal terpisah:
-- rencana tidak pernah menjadi angka buku, pembayaran selalu tertaut jurnal.
CREATE TABLE IF NOT EXISTS pinjaman (
  id TEXT PRIMARY KEY,
  kreditur TEXT NOT NULL,
  akun_kas TEXT NOT NULL REFERENCES akun(kode),
  akun_bunga TEXT NOT NULL REFERENCES akun(kode),
  pokok_awal INTEGER NOT NULL CHECK (pokok_awal > 0),
  sisa_pokok_awal INTEGER NOT NULL CHECK (sisa_pokok_awal >= 0),
  tanggal_mulai TEXT NOT NULL,
  tenor_bulan INTEGER NULL CHECK (tenor_bulan > 0),
  jurnal_pencairan_id TEXT UNIQUE NULL REFERENCES jurnal(id),
  catatan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_pinjaman_tanggal ON pinjaman(tanggal_mulai);
CREATE INDEX IF NOT EXISTS idx_pinjaman_kreditur ON pinjaman(kreditur);

CREATE TABLE IF NOT EXISTS pinjaman_angsuran (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pinjaman_id TEXT NOT NULL REFERENCES pinjaman(id) ON DELETE CASCADE,
  ke INTEGER NOT NULL CHECK (ke > 0),
  jatuh_tempo TEXT NOT NULL,
  pokok INTEGER NOT NULL CHECK (pokok >= 0),
  bunga INTEGER NOT NULL CHECK (bunga >= 0),
  catatan TEXT NOT NULL DEFAULT '',
  UNIQUE (pinjaman_id, ke)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_pinjaman_angsuran_pinjaman
  ON pinjaman_angsuran(pinjaman_id);
CREATE INDEX IF NOT EXISTS idx_pinjaman_angsuran_jatuh_tempo
  ON pinjaman_angsuran(jatuh_tempo);

CREATE TABLE IF NOT EXISTS pinjaman_bayar (
  id TEXT PRIMARY KEY,
  pinjaman_id TEXT NOT NULL REFERENCES pinjaman(id),
  angsuran_id INTEGER NULL REFERENCES pinjaman_angsuran(id),
  jurnal_id TEXT NOT NULL UNIQUE REFERENCES jurnal(id),
  tanggal TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_pinjaman_bayar_pinjaman
  ON pinjaman_bayar(pinjaman_id);
CREATE INDEX IF NOT EXISTS idx_pinjaman_bayar_tanggal
  ON pinjaman_bayar(tanggal);
-- Pembayaran dapat dicicil; satu jurnal tetap hanya dimiliki satu pembayaran.
CREATE INDEX IF NOT EXISTS idx_pinjaman_bayar_angsuran
  ON pinjaman_bayar(angsuran_id);
`;

function tabelAda(db: Database.Database, nama: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nama),
  );
}

function kolomTabel(db: Database.Database, nama: string): string[] {
  // `nama` selalu konstanta internal, bukan input user.
  // JANGAN memakai helper ini untuk memutuskan DROP TABLE: bentuk kolom bukan
  // alasan yang sah untuk menghapus data (DB-06). Saat ini hanya dipakai untuk
  // ALTER TABLE `audit_log` yang aditif.
  return (db.pragma(`table_info(${nama})`) as { name: string }[]).map((k) => k.name);
}

/**
 * DB-06 — daftar eksplisit tabel single-entry lama yang boleh dibersihkan dari
 * DB asli v0–v2. Jangan menambah `panjar`, `panjar_item`, atau `tutup_buku` ke
 * daftar ini: tabel tersebut hanya boleh dibuang oleh migrasi eksplisit yang
 * disetujui di masa depan.
 */
export const TABEL_SINGLE_ENTRY_LAMA = ['transaksi', 'coa'] as const;

/** Versi terakhir yang masih memakai model single-entry lama. */
const VERSI_SINGLE_ENTRY_TERAKHIR = 2;

/**
 * DB-06 / K6 — pembersihan one-time tabel single-entry lama.
 *
 * Hanya berjalan bila versi ASLI DB (sebelum `user_version` dinaikkan) masih
 * v0–v2 DAN tabel lama benar-benar ada. DB baru (versi 0, belum punya tabel
 * legacy) maupun DB current (versi ≥3) tidak pernah menjalankan DROP apa pun.
 * Daftar tabel tetap dan eksplisit; tidak ada keputusan berdasarkan bentuk
 * kolom. `DROP TABLE IF EXISTS` membuat langkah ini idempoten bila migrasi
 * diulang setelah rollback.
 */
function terapkanMigrasiSingleEntryLama(
  db: Database.Database,
  versiAwal: number,
): void {
  if (versiAwal > VERSI_SINGLE_ENTRY_TERAKHIR) return;
  if (!TABEL_SINGLE_ENTRY_LAMA.some((tabel) => tabelAda(db, tabel))) return;
  for (const tabel of TABEL_SINGLE_ENTRY_LAMA) {
    db.exec(`DROP TABLE IF EXISTS ${tabel}`);
  }
}

/**
 * AUD-23 / DB-07 — aturan integritas v9. Dijalankan setiap `migrasi()` agar DB
 * lama (v8) ikut terlindungi dan DB yang sudah v9 tetap konsisten bila trigger
 * hilang. Semua trigger selalu dibuat ulang dengan `DROP TRIGGER IF EXISTS` +
 * `CREATE TRIGGER` (bukan varian `IF NOT EXISTS`) supaya perubahan isi trigger
 * di versi aplikasi baru benar-benar berlaku pada DB lama. DROP dan
 * CREATE berjalan di dalam transaksi `migrasi()`; bila langkah berikutnya gagal,
 * rollback mengembalikan definisi trigger lama, bukan menghilangkannya.
 * Semua perintah idempoten:
 * - index global lama dibuang (nomor bukti kini unik PER TAHUN);
 * - trigger menolak baris dengan debit & kredit sekaligus;
 * - AUD2-08: trigger menolak nilai pecahan/REAL, negatif, dan dua sisi nol;
 * - trigger menolak update/delete jurnal dan barisnya (koreksi lewat reversal).
 */
function terapkanAturanV9(db: Database.Database): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_jurnal_no_bukti;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_jurnal_no_bukti_tahun
      ON jurnal(substr(tanggal, 1, 4), no_bukti COLLATE NOCASE)
      WHERE no_bukti <> '';

    DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_insert;
    CREATE TRIGGER trg_jurnal_baris_satu_sisi_insert
    BEFORE INSERT ON jurnal_baris
    WHEN typeof(NEW.debit) <> 'integer' OR typeof(NEW.kredit) <> 'integer'
      OR NEW.debit < 0 OR NEW.kredit < 0
      OR (NEW.debit = 0 AND NEW.kredit = 0)
      OR (NEW.debit > 0 AND NEW.kredit > 0)
    BEGIN
      SELECT CASE
        WHEN typeof(NEW.debit) <> 'integer' OR typeof(NEW.kredit) <> 'integer'
          THEN RAISE(ABORT, 'Nilai debit/kredit jurnal harus bilangan bulat (integer), bukan pecahan.')
        WHEN NEW.debit < 0 OR NEW.kredit < 0
          THEN RAISE(ABORT, 'Nilai debit/kredit jurnal tidak boleh negatif.')
        WHEN NEW.debit = 0 AND NEW.kredit = 0
          THEN RAISE(ABORT, 'Baris jurnal harus mengisi salah satu sisi: debit atau kredit lebih dari 0.')
        ELSE RAISE(ABORT, 'Baris jurnal tidak boleh mengisi debit dan kredit sekaligus. Isi salah satu saja.')
      END;
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_update;
    CREATE TRIGGER trg_jurnal_baris_satu_sisi_update
    BEFORE UPDATE ON jurnal_baris
    WHEN typeof(NEW.debit) <> 'integer' OR typeof(NEW.kredit) <> 'integer'
      OR NEW.debit < 0 OR NEW.kredit < 0
      OR (NEW.debit = 0 AND NEW.kredit = 0)
      OR (NEW.debit > 0 AND NEW.kredit > 0)
    BEGIN
      SELECT CASE
        WHEN typeof(NEW.debit) <> 'integer' OR typeof(NEW.kredit) <> 'integer'
          THEN RAISE(ABORT, 'Nilai debit/kredit jurnal harus bilangan bulat (integer), bukan pecahan.')
        WHEN NEW.debit < 0 OR NEW.kredit < 0
          THEN RAISE(ABORT, 'Nilai debit/kredit jurnal tidak boleh negatif.')
        WHEN NEW.debit = 0 AND NEW.kredit = 0
          THEN RAISE(ABORT, 'Baris jurnal harus mengisi salah satu sisi: debit atau kredit lebih dari 0.')
        ELSE RAISE(ABORT, 'Baris jurnal tidak boleh mengisi debit dan kredit sekaligus. Isi salah satu saja.')
      END;
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_immutable_update;
    CREATE TRIGGER trg_jurnal_immutable_update
    BEFORE UPDATE ON jurnal
    BEGIN
      SELECT RAISE(ABORT, 'Jurnal tidak boleh diubah. Koreksi dilakukan dengan jurnal balik (reversal).');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_immutable_delete;
    CREATE TRIGGER trg_jurnal_immutable_delete
    BEFORE DELETE ON jurnal
    BEGIN
      SELECT RAISE(ABORT, 'Jurnal tidak boleh dihapus. Koreksi dilakukan dengan jurnal balik (reversal).');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_baris_immutable_update;
    CREATE TRIGGER trg_jurnal_baris_immutable_update
    BEFORE UPDATE ON jurnal_baris
    BEGIN
      SELECT RAISE(ABORT, 'Baris jurnal tidak boleh diubah. Koreksi dilakukan dengan jurnal balik (reversal).');
    END;

    DROP TRIGGER IF EXISTS trg_jurnal_baris_immutable_delete;
    CREATE TRIGGER trg_jurnal_baris_immutable_delete
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

/** DB-04: pesan migrasi saat DB lama berisi lebih dari satu jurnal SALDO_AWAL. */
export const PESAN_DUPLIKAT_SALDO_AWAL =
  'Migrasi v13 dibatalkan: ditemukan lebih dari satu jurnal SALDO_AWAL. ' +
  'Hanya satu saldo awal yang diizinkan. Perbaiki duplikat secara manual; ' +
  'tidak ada data yang dihapus atau diubah.';

/**
 * DB-04 — migrasi v13 idempoten: pastikan hanya ada satu jurnal SALDO_AWAL.
 * Hitung duplikat SEBELUM membuat index. Bila duplikat ada, lempar error agar
 * transaksi `migrasi()` rollback (user_version tidak naik, data tidak berubah).
 * Jangan pernah menghapus/mengubah jurnal di sini.
 */
function terapkanMigrasiV13(db: Database.Database): void {
  const row = db
    .prepare("SELECT COUNT(*) AS total FROM jurnal WHERE jenis = 'SALDO_AWAL'")
    .get() as { total: number };
  if (Number(row.total) > 1) throw new Error(PESAN_DUPLIKAT_SALDO_AWAL);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_jurnal_saldo_awal
      ON jurnal(jenis)
      WHERE jenis = 'SALDO_AWAL';
  `);
}

/** DB-10: pesan migrasi saat DB lama berisi `reversal_of` duplikat. */
export const PESAN_DUPLIKAT_REVERSAL =
  'Migrasi v14 dibatalkan: ditemukan lebih dari satu jurnal dengan reversal_of yang sama. ' +
  'Satu jurnal hanya boleh dikoreksi satu kali. Perbaiki duplikat secara manual; ' +
  'tidak ada data yang dihapus atau diubah.';

/** DB-10: pesan trigger untuk jenis jurnal di luar daftar resmi. */
export const PESAN_JENIS_JURNAL_DB =
  'Jenis jurnal tidak dikenal. Gunakan jenis jurnal resmi aplikasi.';

/** DB-10: pesan trigger untuk tanggal yang tidak berbentuk YYYY-MM-DD. */
export const PESAN_TANGGAL_JURNAL_DB =
  'Tanggal jurnal harus berformat YYYY-MM-DD.';

/** Daftar jenis jurnal resmi, disinkronkan langsung dari posting layer. */
const JENIS_JURNAL_SQL = JENIS_JURNAL.map((jenis) => `'${jenis}'`).join(', ');

/**
 * DB-10 — constraint jurnal v14.
 *
 * 1. Periksa `reversal_of` duplikat SEBELUM membuat unique index. Bila ada,
 *    lempar error agar transaksi `migrasi()` rollback penuh: `user_version`
 *    tidak naik dan tidak ada data yang dihapus/diubah.
 * 2. Pasang partial unique index agar dua reversal untuk jurnal yang sama
 *    ditolak DB, termasuk INSERT mentah yang melewati repository.
 * 3. Pasang ulang trigger validasi `BEFORE INSERT` dengan pola DROP + CREATE
 *    (DB-07). Trigger hanya pertahanan terakhir: `jenis` wajib salah satu dari
 *    `JENIS_JURNAL` dan `tanggal` wajib berbentuk `YYYY-MM-DD`. Tabel `jurnal`
 *    TIDAK direbuild di sini.
 *
 * Idempoten: index memakai `IF NOT EXISTS`, trigger selalu dibuat ulang, dan
 * pemeriksaan duplikat aman dijalankan berulang.
 */
function terapkanMigrasiV14(db: Database.Database): void {
  const duplikat = db
    .prepare(
      `SELECT reversal_of
       FROM jurnal
       WHERE reversal_of IS NOT NULL
       GROUP BY reversal_of
       HAVING COUNT(*) > 1
       LIMIT 1`,
    )
    .get() as { reversal_of: string } | undefined;
  if (duplikat) throw new Error(PESAN_DUPLIKAT_REVERSAL);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_jurnal_reversal
      ON jurnal(reversal_of)
      WHERE reversal_of IS NOT NULL;

    DROP TRIGGER IF EXISTS trg_jurnal_validasi_insert;
    CREATE TRIGGER trg_jurnal_validasi_insert
    BEFORE INSERT ON jurnal
    BEGIN
      SELECT RAISE(ABORT, '${PESAN_JENIS_JURNAL_DB}')
      WHERE NEW.jenis NOT IN (${JENIS_JURNAL_SQL});
      SELECT RAISE(ABORT, '${PESAN_TANGGAL_JURNAL_DB}')
      WHERE NEW.tanggal NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
    END;
  `);
}

/** DB-11: pesan migrasi saat DB lama berisi nama akun duplikat (NOCASE). */
export const PESAN_DUPLIKAT_NAMA_AKUN =
  'Migrasi v15 dibatalkan: ditemukan nama akun duplikat tanpa membedakan huruf besar/kecil. ' +
  'Nama akun wajib unik. Perbaiki duplikat secara manual; ' +
  'tidak ada data yang dihapus atau diubah.';

/** DB-11: pesan trigger untuk kode akun yang bukan tepat 4 digit angka. */
export const PESAN_KODE_AKUN_DB = 'Kode akun harus tepat 4 digit angka.';

/** DB-11: pesan trigger untuk nama akun kosong setelah trim. */
export const PESAN_NAMA_AKUN_DB =
  'Nama akun wajib diisi dan tidak boleh kosong atau hanya berisi spasi.';

/** DB-11: pesan trigger untuk tipe akun di luar lima tipe resmi. */
export const PESAN_TIPE_AKUN_DB =
  'Tipe akun tidak dikenal. Gunakan AKTIVA, KEWAJIBAN, EKUITAS, PENDAPATAN, atau BEBAN.';

/** DB-11: pesan trigger untuk posisi normal yang tidak cocok dengan tipe. */
export const PESAN_POSISI_AKUN_DB =
  'Posisi normal akun tidak cocok dengan tipe akun. ' +
  'AKTIVA/BEBAN harus DEBIT; KEWAJIBAN/EKUITAS/PENDAPATAN harus KREDIT.';

/** DB-11: pesan trigger untuk status aktif selain 0/1. */
export const PESAN_AKTIF_AKUN_DB =
  'Status aktif akun harus 0 (nonaktif) atau 1 (aktif).';

/** Daftar tipe akun resmi, disinkronkan langsung dari kontrak COA. */
const TIPE_AKUN_SQL = Object.keys(POSISI_NORMAL)
  .map((tipe) => `'${tipe}'`)
  .join(', ');

/** Pemetaan tipe → posisi normal untuk trigger, disinkronkan dari COA. */
const POSISI_NORMAL_SQL = Object.entries(POSISI_NORMAL)
  .map(([tipe, posisi]) => `WHEN '${tipe}' THEN '${posisi}'`)
  .join(' ');

/**
 * DB-11 — constraint akun v15.
 *
 * 1. Periksa nama akun duplikat dengan `COLLATE NOCASE` SEBELUM membuat unique
 *    index. Bila ada, lempar error agar transaksi `migrasi()` rollback penuh:
 *    `user_version` tidak naik dan tidak ada data yang dihapus/diubah.
 * 2. Pasang unique index agar nama akun unik tanpa membedakan huruf besar/kecil,
 *    termasuk INSERT/UPDATE mentah yang melewati repository.
 * 3. Pasang ulang trigger `BEFORE INSERT` dan `BEFORE UPDATE` dengan pola
 *    DROP + CREATE (DB-07). Trigger adalah pertahanan terakhir: kode tepat
 *    4 digit, nama tidak kosong, tipe resmi, posisi normal cocok dengan tipe,
 *    dan aktif hanya 0/1. Tabel `akun` TIDAK direbuild di sini.
 *
 * Idempoten: index memakai `IF NOT EXISTS`, trigger selalu dibuat ulang, dan
 * pemeriksaan duplikat aman dijalankan berulang.
 */
function terapkanMigrasiV15(db: Database.Database): void {
  const duplikat = db
    .prepare(
      `SELECT nama
       FROM akun
       GROUP BY nama COLLATE NOCASE
       HAVING COUNT(*) > 1
       LIMIT 1`,
    )
    .get() as { nama: string } | undefined;
  if (duplikat) throw new Error(PESAN_DUPLIKAT_NAMA_AKUN);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_akun_nama_nocase
      ON akun(nama COLLATE NOCASE);

    DROP TRIGGER IF EXISTS trg_akun_validasi_insert;
    CREATE TRIGGER trg_akun_validasi_insert
    BEFORE INSERT ON akun
    BEGIN
      SELECT RAISE(ABORT, '${PESAN_KODE_AKUN_DB}')
      WHERE NEW.kode IS NULL OR NEW.kode NOT GLOB '[0-9][0-9][0-9][0-9]';
      SELECT RAISE(ABORT, '${PESAN_NAMA_AKUN_DB}')
      WHERE NEW.nama IS NULL OR length(trim(NEW.nama)) = 0;
      SELECT RAISE(ABORT, '${PESAN_TIPE_AKUN_DB}')
      WHERE NEW.tipe IS NULL OR NEW.tipe NOT IN (${TIPE_AKUN_SQL});
      SELECT RAISE(ABORT, '${PESAN_POSISI_AKUN_DB}')
      WHERE NEW.posisi_normal IS NULL
         OR NEW.posisi_normal <> CASE NEW.tipe ${POSISI_NORMAL_SQL} END;
      SELECT RAISE(ABORT, '${PESAN_AKTIF_AKUN_DB}')
      WHERE NEW.aktif IS NULL OR NEW.aktif NOT IN (0, 1);
    END;

    DROP TRIGGER IF EXISTS trg_akun_validasi_update;
    CREATE TRIGGER trg_akun_validasi_update
    BEFORE UPDATE ON akun
    BEGIN
      SELECT RAISE(ABORT, '${PESAN_KODE_AKUN_DB}')
      WHERE NEW.kode IS NULL OR NEW.kode NOT GLOB '[0-9][0-9][0-9][0-9]';
      SELECT RAISE(ABORT, '${PESAN_NAMA_AKUN_DB}')
      WHERE NEW.nama IS NULL OR length(trim(NEW.nama)) = 0;
      SELECT RAISE(ABORT, '${PESAN_TIPE_AKUN_DB}')
      WHERE NEW.tipe IS NULL OR NEW.tipe NOT IN (${TIPE_AKUN_SQL});
      SELECT RAISE(ABORT, '${PESAN_POSISI_AKUN_DB}')
      WHERE NEW.posisi_normal IS NULL
         OR NEW.posisi_normal <> CASE NEW.tipe ${POSISI_NORMAL_SQL} END;
      SELECT RAISE(ABORT, '${PESAN_AKTIF_AKUN_DB}')
      WHERE NEW.aktif IS NULL OR NEW.aktif NOT IN (0, 1);
    END;
  `);
}

/**
 * DB-14 — metadata akun v16 (aditif, tanpa rebuild tabel).
 *
 * 1. Tambah kolom `is_kas`, `kelompok`, `sumber` bila belum ada. Kolom baru
 *    otomatis berisi default 0/''/'BAWAAN', sehingga DB lama tetap terbuka.
 * 2. Backfill akun bawaan (kode yang ada di `COA`) dari pemetaan statis:
 *    1001 KAS, akun LPD = LPD, dompet lain = BANK, 1040 PANJAR, 1050 PIUTANG,
 *    2050/2060 HUTANG, ekuitas/pendapatan/beban mengikuti tipe.
 * 3. Akun di luar COA adalah buatan operator: `sumber = TAMBAHAN`, `is_kas`
 *    dipertahankan bila sudah 1, dan `kelompok` hanya diisi dari tipe bila
 *    masih kosong. Nilai TAMBAHAN tidak pernah ditimpa pada migrasi ulang.
 *
 * Idempoten: kolom diperiksa dari `table_info`, UPDATE memakai kode sebagai
 * kunci, dan tidak ada DROP/REBUILD. Dijalankan di dalam transaksi `migrasi()`.
 */
function terapkanMigrasiV16(db: Database.Database): void {
  const kolom = new Set(kolomTabel(db, 'akun'));
  if (!kolom.has('is_kas'))
    db.exec('ALTER TABLE akun ADD COLUMN is_kas INTEGER NOT NULL DEFAULT 0');
  if (!kolom.has('kelompok'))
    db.exec("ALTER TABLE akun ADD COLUMN kelompok TEXT NOT NULL DEFAULT ''");
  if (!kolom.has('sumber'))
    db.exec("ALTER TABLE akun ADD COLUMN sumber TEXT NOT NULL DEFAULT 'BAWAAN'");

  // Trigger v15 ikut memvalidasi baris LAMA saat UPDATE. DB sebelum v15 mungkin
  // masih berisi tipe legacy yang tidak baku; backfill metadata tidak boleh
  // gagal karenanya. Trigger update dilepas sementara lalu dipasang ulang oleh
  // `terapkanMigrasiV15` di akhir fungsi ini (dalam transaksi yang sama).
  db.exec('DROP TRIGGER IF EXISTS trg_akun_validasi_update');

  const kodeBawaan = new Set(COA.map((a) => a.kode));
  const updateBawaan = db.prepare(
    'UPDATE akun SET is_kas = ?, kelompok = ?, sumber = ? WHERE kode = ?',
  );
  for (const c of COA) {
    const meta = metadataAkunBawaan(c);
    updateBawaan.run(meta.is_kas ? 1 : 0, meta.kelompok, meta.sumber, c.kode);
  }

  const rows = db
    .prepare('SELECT kode, tipe, is_kas, kelompok FROM akun')
    .all() as { kode: string; tipe: string; is_kas: number; kelompok: string }[];
  const updateTambahan = db.prepare(
    'UPDATE akun SET is_kas = ?, kelompok = ?, sumber = ? WHERE kode = ?',
  );
  for (const r of rows) {
    const kode = String(r.kode);
    if (kodeBawaan.has(kode)) continue;
    const isKas = Number(r.is_kas) === 1 ? 1 : 0;
    const kelompokLama = String(r.kelompok ?? '').trim();
    const tipe = String(r.tipe) as keyof typeof POSISI_NORMAL;
    const kelompok =
      kelompokLama ||
      (tipe in POSISI_NORMAL
        ? kelompokDariTipe(tipe as Parameters<typeof kelompokDariTipe>[0])
        : '');
    const valid = (KELOMPOK_AKUN as readonly string[]).includes(kelompok) ? kelompok : kelompokLama;
    updateTambahan.run(isKas, valid, 'TAMBAHAN', kode);
  }

  // Pasang kembali trigger validasi akun v15 yang sempat dilepas.
  terapkanMigrasiV15(db);
}

/**
 * DB-18 — detail nota panjar v17 (aditif, tanpa rebuild tabel).
 *
 * Empat kolom baru ditambahkan bila belum ada. Baris `panjar_item` lama
 * otomatis mendapat default '' sehingga tidak ada data yang hilang/diubah.
 * Idempoten: kolom diperiksa dari `table_info`, dan tidak ada DROP/REBUILD.
 * Dijalankan di dalam transaksi `migrasi()`.
 */
function terapkanMigrasiV17(db: Database.Database): void {
  const kolom = new Set(kolomTabel(db, 'panjar_item'));
  if (!kolom.has('nota_nomor'))
    db.exec("ALTER TABLE panjar_item ADD COLUMN nota_nomor TEXT NOT NULL DEFAULT ''");
  if (!kolom.has('nota_tanggal'))
    db.exec("ALTER TABLE panjar_item ADD COLUMN nota_tanggal TEXT NOT NULL DEFAULT ''");
  if (!kolom.has('toko'))
    db.exec("ALTER TABLE panjar_item ADD COLUMN toko TEXT NOT NULL DEFAULT ''");
  if (!kolom.has('keterangan'))
    db.exec("ALTER TABLE panjar_item ADD COLUMN keterangan TEXT NOT NULL DEFAULT ''");
}

/**
 * DB-20: pesan migrasi saat lebih dari satu panjar memakai jurnal serah yang
 * sama. Data lama tidak dihapus/diubah; operator harus memperbaiki tautan.
 */
export const PESAN_DUPLIKAT_JURNAL_OPEN_PANJAR =
  'Migrasi v18 dibatalkan: ditemukan lebih dari satu panjar yang memakai ' +
  'jurnal_open_id yang sama. Satu jurnal serah hanya boleh dipakai satu dokumen ' +
  'panjar. Perbaiki tautan duplikat secara manual; tidak ada data yang dihapus ' +
  'atau diubah.';

/** DB-20: pesan migrasi saat lebih dari satu panjar memakai jurnal close sama. */
export const PESAN_DUPLIKAT_JURNAL_CLOSE_PANJAR =
  'Migrasi v18 dibatalkan: ditemukan lebih dari satu panjar yang memakai ' +
  'jurnal_close_id yang sama. Satu jurnal close hanya boleh dipakai satu dokumen ' +
  'panjar. Perbaiki tautan duplikat secara manual; tidak ada data yang dihapus ' +
  'atau diubah.';

/**
 * DB-20 — link jurnal panjar unik v18.
 *
 * Satu jurnal serah hanya boleh dipakai satu dokumen panjar, dan satu jurnal
 * close juga. Sebelum membuat index, periksa duplikat agar DB bermasalah tidak
 * gagal dengan error UNIQUE mentah. Bila duplikat ada, lempar error supaya
 * transaksi `migrasi()` rollback penuh: `user_version` tidak naik dan tidak ada
 * data yang diubah/dihapus.
 *
 * Index sengaja hanya dibuat di migrasi ini (bukan DDL dasar) mengikuti pola
 * DB-13/14/15: DB lama harus melewati pemeriksaan duplikat lebih dulu. Saat
 * `openDb` DB baru langsung menjalankan migrasi yang sama. Idempoten karena
 * `IF NOT EXISTS` dan pemeriksaan duplikat aman dijalankan berulang.
 */
function terapkanMigrasiV18(db: Database.Database): void {
  // DB-06: tabel `panjar` bentuk lama (sebelum v4) sengaja TIDAK direbuild
  // hanya karena kolomnya berbeda. Bila kolom link belum ada, lewati index
  // terkait; tabel lama tetap utuh dan aplikasi tidak memakainya sebagai
  // dokumen panjar v2.
  const kolom = new Set(kolomTabel(db, 'panjar'));

  if (kolom.has('jurnal_open_id')) {
    const duplikatOpen = db
      .prepare(
        `SELECT jurnal_open_id, COUNT(*) AS jumlah
           FROM panjar
          GROUP BY jurnal_open_id
         HAVING COUNT(*) > 1
          LIMIT 1`,
      )
      .get() as { jurnal_open_id: string; jumlah: number } | undefined;
    if (duplikatOpen) throw new Error(PESAN_DUPLIKAT_JURNAL_OPEN_PANJAR);
  }

  if (kolom.has('jurnal_close_id')) {
    const duplikatClose = db
      .prepare(
        `SELECT jurnal_close_id, COUNT(*) AS jumlah
           FROM panjar
          WHERE jurnal_close_id IS NOT NULL
          GROUP BY jurnal_close_id
         HAVING COUNT(*) > 1
          LIMIT 1`,
      )
      .get() as { jurnal_close_id: string; jumlah: number } | undefined;
    if (duplikatClose) throw new Error(PESAN_DUPLIKAT_JURNAL_CLOSE_PANJAR);
  }

  if (kolom.has('jurnal_open_id')) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_panjar_jurnal_open
        ON panjar(jurnal_open_id);
    `);
  }
  if (kolom.has('jurnal_close_id')) {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_panjar_jurnal_close
        ON panjar(jurnal_close_id)
        WHERE jurnal_close_id IS NOT NULL;
    `);
  }
}

/** DB-21: pesan migrasi saat lebih dari satu panjar memakai jurnal batal sama. */
export const PESAN_DUPLIKAT_JURNAL_BATAL_PANJAR =
  'Migrasi v19 dibatalkan: ditemukan lebih dari satu panjar yang memakai ' +
  'jurnal_batal_id yang sama. Satu jurnal batal hanya boleh dipakai satu dokumen ' +
  'panjar. Perbaiki tautan duplikat secara manual; tidak ada data yang dihapus ' +
  'atau diubah.';

/**
 * DB-21 — pembatalan panjar v19 (aditif, tanpa rebuild tabel).
 *
 * Tiga kolom baru ditambahkan bila belum ada. Baris lama otomatis mendapat
 * `NULL`/`NULL`/`''` sehingga tetap OPEN/CLOSED seperti sebelumnya. Status
 * tersimpan tetap OPEN saat dibatalkan (CHECK lama tidak diubah); status publik
 * DIBATALKAN diturunkan dari `jurnal_batal_id`.
 *
 * Partial unique index mencegah satu jurnal batal dipakai dua dokumen panjar.
 * Duplikat diperiksa lebih dulu agar DB bermasalah tidak gagal dengan error
 * UNIQUE mentah; bila ada, transaksi `migrasi()` rollback penuh. Idempoten:
 * kolom diperiksa dari `table_info` dan index memakai `IF NOT EXISTS`.
 */
function terapkanMigrasiV19(db: Database.Database): void {
  const kolom = new Set(kolomTabel(db, 'panjar'));

  if (!kolom.has('jurnal_batal_id'))
    db.exec('ALTER TABLE panjar ADD COLUMN jurnal_batal_id TEXT REFERENCES jurnal(id)');
  if (!kolom.has('tanggal_batal'))
    db.exec('ALTER TABLE panjar ADD COLUMN tanggal_batal TEXT');
  if (!kolom.has('alasan_batal'))
    db.exec("ALTER TABLE panjar ADD COLUMN alasan_batal TEXT NOT NULL DEFAULT ''");

  const duplikatBatal = db
    .prepare(
      `SELECT jurnal_batal_id, COUNT(*) AS jumlah
         FROM panjar
        WHERE jurnal_batal_id IS NOT NULL AND jurnal_batal_id <> ''
        GROUP BY jurnal_batal_id
       HAVING COUNT(*) > 1
        LIMIT 1`,
    )
    .get() as { jurnal_batal_id: string; jumlah: number } | undefined;
  if (duplikatBatal) throw new Error(PESAN_DUPLIKAT_JURNAL_BATAL_PANJAR);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_panjar_jurnal_batal
      ON panjar(jurnal_batal_id)
      WHERE jurnal_batal_id IS NOT NULL;
  `);
}

/**
 * DB-27 — referensi audit terstruktur v21 (aditif, tanpa rebuild).
 *
 * `audit_log` sudah ada sejak v2 dan AKT-26 memasang trigger append-only pada
 * v11. Kolom baru diberi default `''` sehingga baris lama tetap sah dan tidak
 * perlu diubah. Backfill baris legacy sengaja TIDAK dilakukan: satu-satunya
 * cara mengisinya adalah UPDATE, sedangkan trigger `trg_audit_log_immutable_update`
 * menolak UPDATE audit_log. Menghapus trigger sementara demi backfill akan
 * melemahkan jaminan append-only, jadi referensi lama dibiarkan kosong dan
 * tetap tampil di daftar audit.
 *
 * Index dibuat di sini (bukan DDL dasar) karena DB v20 belum punya kolomnya
 * saat `db.exec(DDL)` berjalan. Idempoten: kolom diperiksa dari `table_info`
 * dan index memakai `IF NOT EXISTS`.
 */
function terapkanMigrasiV21(db: Database.Database): void {
  const kolom = new Set(kolomTabel(db, 'audit_log'));

  if (!kolom.has('ref_type'))
    db.exec("ALTER TABLE audit_log ADD COLUMN ref_type TEXT NOT NULL DEFAULT ''");
  if (!kolom.has('ref_id'))
    db.exec("ALTER TABLE audit_log ADD COLUMN ref_id TEXT NOT NULL DEFAULT ''");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_ref
      ON audit_log(ref_type, ref_id);
  `);
}

/**
 * AUD2-09 — helper strictness. `pragma table_list` adalah sumber kebenaran
 * (bukan tebakan dari SQL DDL). Dipakai migrasi dan test kontrak.
 */
type InfoTabel = {
  schema: string;
  name: string;
  type: string;
  strict: number;
  sql?: string | null;
};

function infoTabel(db: Database.Database, nama: string): InfoTabel | undefined {
  return (db.pragma('table_list') as InfoTabel[]).find(
    (r) => r.schema === 'main' && r.name === nama && r.type === 'table',
  );
}

function sqlTabel(db: Database.Database, nama: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(nama) as { sql: string } | undefined;
  return String(row?.sql ?? '');
}

/** Daftar tabel aktif yang belum STRICT (kosong = seluruh kontrak terpenuhi). */
export function tabelAktifBelumStrict(db: Database.Database): string[] {
  return TABEL_AKTIF.filter((nama) => {
    const info = infoTabel(db, nama);
    return !info || Number(info.strict) !== 1;
  });
}

/**
 * AUD2-09 — verifikasi akhir migrasi. Melempar pesan Indonesia yang menyebut
 * tabel bermasalah agar operator tidak membuka DB dengan skema setengah jadi.
 */
export function pastikanTabelAktifStrict(db: Database.Database): void {
  const belum = tabelAktifBelumStrict(db);
  if (belum.length === 0) return;
  throw new Error(
    'Migrasi v23 gagal: tabel aktif wajib STRICT, tetapi tabel berikut belum ' +
      `STRICT atau tidak ditemukan: ${belum.join(', ')}. ` +
      'Database tidak diubah lebih lanjut; periksa file DB/backup.',
  );
}

/** Ambil CREATE TABLE target (STRICT) untuk satu tabel dari DDL resmi. */
function ddlTargetTabel(nama: string): string {
  const pola = new RegExp(
    `CREATE TABLE IF NOT EXISTS ${nama} \\([\\s\\S]*?\\n\\) STRICT;`,
  );
  const hasil = DDL.match(pola);
  if (!hasil) throw new Error(`DDL STRICT untuk tabel ${nama} tidak ditemukan.`);
  return hasil[0];
}

/** Nama kolom dari CREATE TABLE target; constraint bukan kolom. */
function kolomDariDdl(ddl: string): string[] {
  return [...ddl.matchAll(/^  ([a-z_]+) (?:TEXT|INTEGER|REAL|BLOB|ANY)\b/gm)].map(
    (m) => m[1],
  );
}

function dropTabelSementara(db: Database.Database, nama: string): string {
  const tmp = `__strict_${nama}`;
  db.exec(`DROP TABLE IF EXISTS "${tmp}"`);
  return tmp;
}

/**
 * Rebuild ke bentuk DDL target: tabel baru -> salin kolom target -> drop lama
 * -> rename. Hanya dipakai bila seluruh kolom target ada dan tidak ada kolom
 * ekstra yang berisi data (kecuali `tutup_buku.backup_path` yang memang
 * dibuang).
 */
function rebuildTabelTarget(
  db: Database.Database,
  nama: string,
  targetSql: string,
  kolomTarget: string[],
): void {
  const tmp = dropTabelSementara(db, nama);
  const sqlTmp = targetSql.replace(
    `CREATE TABLE IF NOT EXISTS ${nama}`,
    `CREATE TABLE "${tmp}"`,
  );
  db.exec(sqlTmp);
  const daftar = kolomTarget.map((k) => `"${k}"`).join(', ');
  db.exec(`INSERT INTO "${tmp}" (${daftar}) SELECT ${daftar} FROM "${nama}"`);
  db.exec(`DROP TABLE "${nama}"`);
  db.exec(`ALTER TABLE "${tmp}" RENAME TO "${nama}"`);
}

/**
 * Fallback untuk tabel bentuk legacy yang tidak cocok dengan DDL target
 * (mis. `tutup_buku` v2 dengan kolom `laba`). Bentuk kolom dipertahankan
 * 100%, hanya ditambah opsi `STRICT`, sehingga tidak ada data legacy yang
 * hilang. Tabel seperti ini tidak dipakai sebagai tabel aktif model v2.
 */
function rebuildTabelBentukLama(
  db: Database.Database,
  nama: string,
  sqlLama: string,
): void {
  const tmp = dropTabelSementara(db, nama);
  const tanpaSemi = sqlLama.trim().replace(/;\s*$/, '');
  const pola = new RegExp(
    '^(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)(?:["\\x60\\[])?' +
      nama +
      '(?:["\\x60\\]])?',
    'i',
  );
  const sqlTmp = tanpaSemi.replace(pola, `$1"${tmp}"`);
  if (sqlTmp === tanpaSemi)
    throw new Error(`Bentuk CREATE TABLE legacy untuk ${nama} tidak dikenali.`);
  const opsi = /WITHOUT\s+ROWID\s*$/i.test(sqlTmp) ? ', STRICT' : ' STRICT';
  const kolomLama = kolomTabel(db, nama);
  try {
    db.exec(`${sqlTmp}${opsi}`);
    const daftar = kolomLama.map((k) => `"${k}"`).join(', ');
    db.exec(`INSERT INTO "${tmp}" (${daftar}) SELECT ${daftar} FROM "${nama}"`);
    db.exec(`DROP TABLE "${nama}"`);
    db.exec(`ALTER TABLE "${tmp}" RENAME TO "${nama}"`);
  } catch (e) {
    throw new Error(
      `Migrasi v23 gagal merebuild tabel legacy ${nama} menjadi STRICT: ` +
        `${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * AUD2-09 — migrasi v23: rebuild seluruh tabel aktif non-STRICT menjadi
 * STRICT. Tabel yang sudah STRICT dan bentuknya sudah sesuai dilewati, jadi
 * fungsi ini idempoten dan aman dipanggil setiap `migrasi()`.
 *
 * Urutan aman:
 * 1. `migrasi()` mematikan `foreign_keys` SEBELUM transaksi (pragma ini tidak
 *    berlaku di dalam transaksi), sehingga DROP/RENAME tidak memicu cascade
 *    atau penolakan FK sementara.
 * 2. Untuk tabel bentuk current: buat tabel target, salin kolom target, drop
 *    tabel lama, rename. `tutup_buku.backup_path` tidak disalin.
 * 3. Untuk tabel bentuk legacy yang tidak cocok: pertahankan seluruh kolom,
 *    cukup tambahkan STRICT agar tidak ada data yang hilang.
 * 4. Normalisasi panjar lama: baris yang sudah punya `jurnal_batal_id`
 *    diubah statusnya menjadi DIBATALKAN (CHECK baru mengizinkannya).
 * 5. Index/trigger dipasang ulang oleh `migrasi()` setelah fungsi ini.
 */
function terapkanMigrasiV23(db: Database.Database): string[] {
  const dibangun: string[] = [];

  for (const nama of TABEL_AKTIF) {
    const info = infoTabel(db, nama);
    if (!info) continue;

    const kolomLama = kolomTabel(db, nama);
    const targetSql = ddlTargetTabel(nama);
    const kolomTarget = kolomDariDdl(targetSql);
    const setLama = new Set(kolomLama);
    const setTarget = new Set(kolomTarget);
    const kolomLengkap = kolomTarget.every((k) => setLama.has(k));
    const ekstra = kolomLama.filter((k) => !setTarget.has(k));
    const ekstraAman =
      ekstra.length === 0 ||
      (nama === 'tutup_buku' && ekstra.every((k) => k === 'backup_path'));
    const sudahStrict = Number(info.strict) === 1;
    const checkPanjarBaru =
      nama !== 'panjar' || sqlTabel(db, nama).includes("'DIBATALKAN'");

    if (sudahStrict && !kolomLengkap) continue;
    if (sudahStrict && kolomLengkap && !ekstraAman) continue;
    if (
      sudahStrict &&
      kolomLengkap &&
      ekstraAman &&
      ekstra.length === 0 &&
      checkPanjarBaru
    )
      continue;

    if (kolomLengkap && ekstraAman) {
      rebuildTabelTarget(db, nama, targetSql, kolomTarget);
    } else {
      rebuildTabelBentukLama(db, nama, sqlTabel(db, nama));
    }
    dibangun.push(nama);
  }

  const kolomPanjar = new Set(kolomTabel(db, 'panjar'));
  if (kolomPanjar.has('status') && kolomPanjar.has('jurnal_batal_id')) {
    db.prepare(
      `UPDATE panjar
          SET status = 'DIBATALKAN'
        WHERE jurnal_batal_id IS NOT NULL
          AND jurnal_batal_id <> ''
          AND status = 'OPEN'`,
    ).run();
  }

  return dibangun;
}

/**
 * DB-05 — guard downgrade. `openDb()` memanggil ini SEBELUM pragma WAL (yang
 * mengubah header file), dan `migrasi()` memanggilnya sebelum DDL. DB dengan
 * `user_version` lebih besar tidak boleh disentuh sama sekali.
 */
function pastikanVersiDidukung(db: Database.Database): number {
  const versi = Number(db.pragma('user_version', { simple: true }) ?? 0);
  if (versi > SCHEMA_VERSION) throw new Error(PESAN_DB_VERSI_BARU);
  return versi;
}

/**
 * Migrasi skema berbasis `PRAGMA user_version`, idempoten.
 * - Menolak DB yang dibuat aplikasi versi lebih baru SEBELUM DDL apa pun.
 * - Membersihkan tabel single-entry lama hanya bila versi ASLI DB < 3 (DB-06).
 * - Membuat seluruh DDL v2 bila belum ada.
 * - Menerapkan aturan integritas v9 (trigger + unique index per tahun).
 * - Menerapkan kontrak COA v10 (akun 2060 idempoten, tanpa DDL).
 * - Menerapkan aturan v11 (audit append-only, tutup buku tidak bisa dihapus).
 * - Menerapkan migrasi v12 (drop tabel modul yang sudah dihapus).
 * - Menerapkan migrasi v13 (unique index satu jurnal SALDO_AWAL).
 * - Menerapkan migrasi v14 (unique reversal + trigger validasi jurnal).
 * - Menerapkan migrasi v15 (unique nama akun + trigger validasi akun).
 * - Menerapkan migrasi v16 (metadata is_kas/kelompok/sumber + backfill).
 * - Menerapkan migrasi v17 (detail nota panjar, aditif).
 * - Menerapkan migrasi v18 (link jurnal open/close panjar unik).
 * - Menerapkan migrasi v19 (kolom pembatalan panjar + link jurnal batal unik).
 * - Menerapkan migrasi v21 (referensi audit terstruktur, aditif/idempoten).
 * - Menerapkan migrasi v23 (rebuild seluruh tabel aktif menjadi STRICT).
 * - Menaikkan user_version ke versi skema saat ini.
 */
export function migrasi(db: Database.Database): number {
  const versiAwal = pastikanVersiDidukung(db);
  // AUD2-09: `PRAGMA foreign_keys` tidak bisa diubah di dalam transaksi.
  // Matikan dulu agar DROP/RENAME tabel saat rebuild tidak memicu cascade atau
  // penolakan FK sementara; setelah transaksi selesai/rollback, pulihkan.
  const fkAwal = Number(db.pragma('foreign_keys', { simple: true })) === 1;
  if (fkAwal && !db.inTransaction) db.pragma('foreign_keys = OFF');

  try {
    const siapkan = db.transaction(() => {
      // DB-06: `versiAwal` ditangkap SEBELUM `user_version` diubah. Cleanup
      // legacy tidak boleh berjalan pada DB baru/current.
      terapkanMigrasiSingleEntryLama(db, versiAwal);
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
      terapkanMigrasiV13(db);
      terapkanMigrasiV14(db);
      terapkanMigrasiV15(db);
      terapkanMigrasiV16(db);
      terapkanMigrasiV17(db);
      terapkanMigrasiV18(db);
      terapkanMigrasiV19(db);
      terapkanMigrasiV21(db);
      // v22: lepaskan batas satu kuitansi per angsuran, tanpa mengubah histori.
      db.exec('DROP INDEX IF EXISTS ux_pinjaman_bayar_angsuran');
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pinjaman_bayar_angsuran
        ON pinjaman_bayar(angsuran_id)`);

      // AUD2-09: rebuild tabel non-STRICT. Index/trigger yang ikut terhapus
      // oleh DROP TABLE dipasang ulang di bawah (DDL + fungsi aturan).
      terapkanMigrasiV23(db);
      db.exec(DDL);
      terapkanAturanV9(db);
      terapkanAturanV11(db);
      terapkanMigrasiV13(db);
      terapkanMigrasiV14(db);
      terapkanMigrasiV15(db);
      terapkanMigrasiV18(db);
      terapkanMigrasiV19(db);
      terapkanMigrasiV21(db);
      db.exec('DROP INDEX IF EXISTS ux_pinjaman_bayar_angsuran');
      db.exec(`CREATE INDEX IF NOT EXISTS idx_pinjaman_bayar_angsuran
        ON pinjaman_bayar(angsuran_id)`);

      pastikanTabelAktifStrict(db);
      if (versiAwal < SCHEMA_VERSION) {
        db.pragma(`user_version = ${SCHEMA_VERSION}`);
      }
    });
    siapkan();
  } finally {
    if (fkAwal && !db.inTransaction) db.pragma('foreign_keys = ON');
  }
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
    // DB-05: tolak versi lebih baru sebelum `journal_mode = WAL` (pragma itu
    // mengubah header file) dan sebelum migrasi/DDL apa pun. Guard di
    // `migrasi()` tetap dipertahankan untuk pemanggil langsung.
    pastikanVersiDidukung(db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrasi(db);

    // Upsert daftar akun resmi saat DB dibuka. `akun` adalah master COA untuk
    // model double-entry. DB-14: metadata (`is_kas`/`kelompok`/`sumber`) ikut
    // di-seed, tetapi baris TAMBAHAN tidak pernah ditimpa — name/tipe/posisi/
    // metadata operator dipertahankan; hanya baris BAWAAN yang di-refresh.
    const seedTx = db.transaction(() => {
      const upsertAkun = db.prepare(
        `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif, is_kas, kelompok, sumber)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'BAWAAN')
         ON CONFLICT(kode) DO UPDATE SET
           nama = CASE WHEN akun.sumber = 'BAWAAN' THEN excluded.nama ELSE akun.nama END,
           tipe = CASE WHEN akun.sumber = 'BAWAAN' THEN excluded.tipe ELSE akun.tipe END,
           posisi_normal = CASE WHEN akun.sumber = 'BAWAAN' THEN excluded.posisi_normal ELSE akun.posisi_normal END,
           is_kas = CASE WHEN akun.sumber = 'BAWAAN' THEN excluded.is_kas ELSE akun.is_kas END,
           kelompok = CASE WHEN akun.sumber = 'BAWAAN' THEN excluded.kelompok ELSE akun.kelompok END`,
      );
      for (const c of COA) {
        const meta = metadataAkunBawaan(c);
        upsertAkun.run(
          c.kode,
          c.nama,
          c.tipe,
          c.posisi_normal,
          meta.is_kas ? 1 : 0,
          meta.kelompok,
        );
      }
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
