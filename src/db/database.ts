// Lapisan SQLite (better-sqlite3, sync). Single-file lokal — dokumen arah §3.
// Satu-satunya file yang boleh membuat/mengubah tabel = file ini.
// Agent B memakai repository.ts (read) — JANGAN tulis SQL DDL di tempat lain.

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { JENIS_JURNAL } from '../core/posting.js';
import { COA, KELOMPOK_AKUN, POSISI_NORMAL, metadataAkunBawaan } from './coa.js';

/**
 * Versi skema baseline di `PRAGMA user_version`.
 * Aplikasi hanya mendukung skema v2. Database v1 ditolak dengan pesan khusus
 * agar operator mem-backup file lama lalu membuat DB baru; tidak ada migrasi
 * otomatis. Database dengan versi lain juga ditolak tanpa diubah.
 */
export const SCHEMA_VERSION = 2;

/**
 * AUD2-09 — daftar resmi 12 tabel aktif yang wajib `STRICT`.
 * Urutan mengikuti dokumen ERD; jangan menambah tabel legacy di sini.
 */
export const TABEL_AKTIF = [
  'akun',
  'jurnal',
  'jurnal_baris',
  'tutup_buku',
  'tutup_buku_snapshot',
  'audit_log',
  'pengaturan',
  'panjar',
  'panjar_item',
  'pinjaman',
  'pinjaman_angsuran',
  'pinjaman_bayar',
] as const;

/**
 * T1.4 — peta kolom kanonik wajib per tabel aktif, disalin dari DDL tabel di
 * bawah. `CREATE TABLE IF NOT EXISTS` tidak menambah kolom, sehingga DB v1
 * yang tabelnya ada tetapi kolomnya hilang harus ditolak sebelum DDL. Peta ini
 * dijaga tetap sinkron oleh test penjaga di
 * `tests/skema-kompatibilitas.test.ts` yang membandingkannya dengan
 * `PRAGMA table_info` pada DB baru.
 */
export const KOLOM_WAJIB: Record<(typeof TABEL_AKTIF)[number], readonly string[]> = {
  akun: ['kode', 'nama', 'tipe', 'posisi_normal', 'aktif', 'is_kas', 'kelompok', 'sumber'],
  jurnal: [
    'id',
    'tanggal',
    'no_bukti',
    'keterangan',
    'jenis',
    'peran',
    'grup_id',
    'reversal_of',
    'replaces_id',
    'created_at',
  ],
  jurnal_baris: ['id', 'jurnal_id', 'akun_kode', 'debit', 'kredit', 'keterangan'],
  tutup_buku: ['tahun', 'created_at', 'catatan'],
  tutup_buku_snapshot: [
    'id',
    'tahun',
    'versi',
    'laba',
    'total_aset',
    'total_kewajiban',
    'total_ekuitas',
    'total_pasiva',
    'selisih',
    'hash_jurnal',
    'created_at',
  ],
  audit_log: [
    'id',
    'tanggal',
    'aksi',
    'alasan',
    'data_lama_json',
    'data_baru_json',
    'ref_type',
    'ref_id',
  ],
  pengaturan: ['kunci', 'nilai'],
  panjar: [
    'id',
    'tanggal',
    'penerima',
    'jumlah',
    'akun_kas_sumber',
    'status',
    'sumber',
    'tanggal_close',
    'jurnal_open_id',
    'jurnal_close_id',
    'created_at',
    'jurnal_batal_id',
    'tanggal_batal',
    'alasan_batal',
  ],
  panjar_item: [
    'id',
    'panjar_id',
    'kategori_baga',
    'nominal',
    'jurnal_id',
    'nota_nomor',
    'nota_tanggal',
    'toko',
    'keterangan',
  ],
  pinjaman: [
    'id',
    'kreditur',
    'akun_kas',
    'akun_bunga',
    'pokok_awal',
    'sisa_pokok_awal',
    'tanggal_mulai',
    'tenor_bulan',
    'jurnal_pencairan_id',
    'catatan',
    'created_at',
  ],
  pinjaman_angsuran: [
    'id',
    'pinjaman_id',
    'ke',
    'jatuh_tempo',
    'pokok',
    'bunga',
    'catatan',
  ],
  pinjaman_bayar: [
    'id',
    'pinjaman_id',
    'angsuran_id',
    'jurnal_id',
    'tanggal',
    'catatan',
    'created_at',
  ],
};

/**
 * Pesan penolakan DB dengan skema lama/tidak dikenal. Tidak ada jalur migrasi:
 * operator harus memindahkan atau menghapus file DB lalu menjalankan ulang.
 */
export const PESAN_DB_TIDAK_KOMPATIBEL =
  'File database ini dibuat oleh versi/skema lain dan tidak kompatibel. ' +
  'Aplikasi hanya mendukung skema v2. Pindahkan atau hapus file database lama ' +
  'tersebut, lalu jalankan aplikasi lagi.';

/**
 * T-A00 — DB v1 (11 tabel) tidak dimigrasikan otomatis. File lama harus
 * di-backup lebih dulu, lalu DB baru v2 dibuat (mis. `npm run db:reset-dev`).
 */
export const PESAN_DB_V1_KEDALUWARSA =
  'Database ini memakai skema v1 yang sudah tidak didukung aplikasi versi ini. ' +
  'Backup dulu file database (dan file -wal/-shm bila ada), lalu buat database ' +
  'baru skema v2. Aplikasi tidak mengubah atau memigrasikan file lama secara otomatis.';

/**
 * Awalan pesan penolakan DB v2 yang kehilangan tabel wajib. DB seperti ini
 * tidak boleh dibuat ulang dengan `CREATE TABLE IF NOT EXISTS` karena tabel
 * kosong akan menutupi data yang hilang.
 */
export const PESAN_DB_TIDAK_LENGKAP =
  'File database skema v2 tidak lengkap: tabel wajib tidak ditemukan:';

/** Pesan penolakan DB v1 tidak lengkap; menyebut tabel yang hilang. */
export function pesanDbTidakLengkap(tabelKurang: readonly string[]): string {
  return (
    `${PESAN_DB_TIDAK_LENGKAP} ${tabelKurang.join(', ')}. ` +
    'Database tidak diubah agar data yang tersisa tidak tertimpa. ' +
    'Pulihkan file database ini dari backup yang sehat atau hubungi pendamping; ' +
    'jangan membuat ulang tabel kosong.'
  );
}

/**
 * Awalan pesan penolakan DB v2 yang tabelnya ada tetapi kehilangan kolom
 * wajib. DB seperti ini juga tidak boleh diperbaiki otomatis: `ALTER TABLE`
 * bisa menambah kolom kosong dan menutupi data yang hilang.
 */
export const PESAN_DB_KOLOM_TIDAK_LENGKAP =
  'File database skema v2 tidak lengkap: kolom wajib tidak ditemukan:';

/** Pesan penolakan DB v1 yang kolomnya hilang; menyebut tabel + kolom. */
export function pesanDbKolomTidakLengkap(
  kolomKurang: readonly { tabel: string; kolom: string }[],
): string {
  const rincian = kolomKurang.map(({ tabel, kolom }) => `${tabel}.${kolom}`).join(', ');
  return (
    `${PESAN_DB_KOLOM_TIDAK_LENGKAP} ${rincian}. ` +
    'Database tidak diubah agar data yang tersisa tidak tertimpa. ' +
    'Pulihkan file database ini dari backup yang sehat atau hubungi pendamping; ' +
    'jangan menambah kolom kosong secara manual.'
  );
}

/**
 * DDL index kanonik skema v1.
 *
 * Setiap index aplikasi diawali `DROP INDEX IF EXISTS` lalu `CREATE INDEX`
 * (bukan `IF NOT EXISTS`), sehingga `db.exec(DDL)` selalu membuat ulang index
 * dengan definisi kanonik — termasuk memperbaiki index bernama sama yang
 * definisinya salah. Pola ini analog dengan `DDL_TRIGGER`.
 *
 * Semua index aplikasi punya nama eksplisit. Index implisit dari constraint
 * `UNIQUE` tabel bernama `sqlite_autoindex_*` tidak pernah di-drop karena
 * bukan bagian dari DDL ini.
 */
export const DDL_INDEX = `
-- Nomor bukti unik per tahun, bukan global: nomor yang sama boleh dipakai
-- pada tahun berbeda.
DROP INDEX IF EXISTS idx_jurnal_tanggal;
CREATE INDEX idx_jurnal_tanggal ON jurnal(tanggal);
DROP INDEX IF EXISTS idx_jurnal_grup;
CREATE INDEX idx_jurnal_grup ON jurnal(grup_id);
DROP INDEX IF EXISTS idx_jurnal_reversal;
CREATE INDEX idx_jurnal_reversal ON jurnal(reversal_of);
DROP INDEX IF EXISTS idx_jurnal_no_bukti_tahun;
CREATE UNIQUE INDEX idx_jurnal_no_bukti_tahun
  ON jurnal(substr(tanggal, 1, 4), no_bukti COLLATE NOCASE)
  WHERE no_bukti <> '';
DROP INDEX IF EXISTS ux_jurnal_saldo_awal;
CREATE UNIQUE INDEX ux_jurnal_saldo_awal
  ON jurnal(jenis)
  WHERE jenis = 'SALDO_AWAL';
DROP INDEX IF EXISTS ux_jurnal_reversal;
CREATE UNIQUE INDEX ux_jurnal_reversal
  ON jurnal(reversal_of)
  WHERE reversal_of IS NOT NULL;
-- T-A00: satu jurnal hanya boleh digantikan satu kali. Nama ux_ sekaligus
-- menjadi index pencarian replaces_id; tidak perlu index biasa terpisah.
DROP INDEX IF EXISTS ux_jurnal_replaces;
CREATE UNIQUE INDEX ux_jurnal_replaces
  ON jurnal(replaces_id)
  WHERE replaces_id IS NOT NULL;

DROP INDEX IF EXISTS idx_jurnal_baris_jurnal;
CREATE INDEX idx_jurnal_baris_jurnal ON jurnal_baris(jurnal_id);
DROP INDEX IF EXISTS idx_jurnal_baris_akun;
CREATE INDEX idx_jurnal_baris_akun ON jurnal_baris(akun_kode);

DROP INDEX IF EXISTS idx_audit_tanggal;
CREATE INDEX idx_audit_tanggal ON audit_log(tanggal);
DROP INDEX IF EXISTS idx_audit_aksi;
CREATE INDEX idx_audit_aksi ON audit_log(aksi);
DROP INDEX IF EXISTS idx_audit_ref;
CREATE INDEX idx_audit_ref ON audit_log(ref_type, ref_id);

DROP INDEX IF EXISTS idx_panjar_status;
CREATE INDEX idx_panjar_status ON panjar(status);
DROP INDEX IF EXISTS idx_panjar_tanggal;
CREATE INDEX idx_panjar_tanggal ON panjar(tanggal);
DROP INDEX IF EXISTS idx_panjar_item_panjar;
CREATE INDEX idx_panjar_item_panjar ON panjar_item(panjar_id);
DROP INDEX IF EXISTS ux_panjar_jurnal_open;
CREATE UNIQUE INDEX ux_panjar_jurnal_open
  ON panjar(jurnal_open_id);
DROP INDEX IF EXISTS ux_panjar_jurnal_close;
CREATE UNIQUE INDEX ux_panjar_jurnal_close
  ON panjar(jurnal_close_id)
  WHERE jurnal_close_id IS NOT NULL;
DROP INDEX IF EXISTS ux_panjar_jurnal_batal;
CREATE UNIQUE INDEX ux_panjar_jurnal_batal
  ON panjar(jurnal_batal_id)
  WHERE jurnal_batal_id IS NOT NULL;

DROP INDEX IF EXISTS idx_pinjaman_tanggal;
CREATE INDEX idx_pinjaman_tanggal ON pinjaman(tanggal_mulai);
DROP INDEX IF EXISTS idx_pinjaman_kreditur;
CREATE INDEX idx_pinjaman_kreditur ON pinjaman(kreditur);
DROP INDEX IF EXISTS idx_pinjaman_angsuran_pinjaman;
CREATE INDEX idx_pinjaman_angsuran_pinjaman
  ON pinjaman_angsuran(pinjaman_id);
DROP INDEX IF EXISTS idx_pinjaman_angsuran_jatuh_tempo;
CREATE INDEX idx_pinjaman_angsuran_jatuh_tempo
  ON pinjaman_angsuran(jatuh_tempo);
DROP INDEX IF EXISTS idx_pinjaman_bayar_pinjaman;
CREATE INDEX idx_pinjaman_bayar_pinjaman
  ON pinjaman_bayar(pinjaman_id);
DROP INDEX IF EXISTS idx_pinjaman_bayar_tanggal;
CREATE INDEX idx_pinjaman_bayar_tanggal
  ON pinjaman_bayar(tanggal);
-- Pembayaran dapat dicicil; satu jurnal tetap hanya dimiliki satu pembayaran.
DROP INDEX IF EXISTS idx_pinjaman_bayar_angsuran;
CREATE INDEX idx_pinjaman_bayar_angsuran
  ON pinjaman_bayar(angsuran_id);

DROP INDEX IF EXISTS ux_akun_nama_nocase;
CREATE UNIQUE INDEX ux_akun_nama_nocase
  ON akun(nama COLLATE NOCASE);
`;

/**
 * Daftar kelompok akun resmi untuk CHECK DDL, dibangun dari `KELOMPOK_AKUN`
 * agar nilai resmi tidak diduplikasi manual di skema.
 */
const KELOMPOK_AKUN_SQL = KELOMPOK_AKUN.map((kelompok) => `'${kelompok}'`).join(', ');

/**
 * DDL tabel kanonik skema v2: 12 tabel aktif, semuanya `STRICT`.
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
const DDL_TABEL = `
CREATE TABLE IF NOT EXISTS akun (
  kode TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  tipe TEXT NOT NULL,
  posisi_normal TEXT NOT NULL,
  aktif INTEGER NOT NULL DEFAULT 1,
  is_kas INTEGER NOT NULL DEFAULT 0,
  kelompok TEXT NOT NULL DEFAULT '',
  sumber TEXT NOT NULL DEFAULT 'BAWAAN',
  CHECK (sumber IN ('BAWAAN', 'TAMBAHAN')),
  CHECK (kelompok = '' OR kelompok IN (${KELOMPOK_AKUN_SQL}))
) STRICT;

-- Model double-entry: jurnal = satu transaksi/bukti, jurnal_baris = debit/kredit.
CREATE TABLE IF NOT EXISTS jurnal (
  id TEXT PRIMARY KEY,
  tanggal TEXT NOT NULL,
  no_bukti TEXT NOT NULL DEFAULT '',
  keterangan TEXT NOT NULL,
  jenis TEXT NOT NULL DEFAULT 'UMUM',
  -- T-A00: peran siklus hidup jurnal, terpisah dari jenis dokumen.
  peran TEXT NOT NULL DEFAULT 'NORMAL'
    CHECK (peran IN ('NORMAL', 'OPENING', 'OPENING_REPLACEMENT', 'ADJUSTMENT')),
  grup_id TEXT NOT NULL,
  reversal_of TEXT,
  -- T-A00: relasi eksplisit "jurnal ini menggantikan jurnal X".
  replaces_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (reversal_of) REFERENCES jurnal(id),
  FOREIGN KEY (replaces_id) REFERENCES jurnal(id)
) STRICT;

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

-- Tutup buku: hanya penanda + kunci + catatan. Laba selalu dihitung dari
-- jurnal, bukan disimpan sebagai sumber angka.
CREATE TABLE IF NOT EXISTS tutup_buku (
  tahun INTEGER PRIMARY KEY CHECK (tahun BETWEEN 1900 AND 9999),
  created_at TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT ''
) STRICT;

-- T-A00: snapshot append-only hasil pembacaan angka saat tutup buku.
-- Bukan sumber angka laporan; laba/saldo tetap dihitung ulang dari jurnal.
-- Snapshot baru pada TUTUP-ULANG memakai versi berikutnya (UNIQUE tahun+versi).
CREATE TABLE IF NOT EXISTS tutup_buku_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tahun INTEGER NOT NULL,
  versi INTEGER NOT NULL,
  laba INTEGER NOT NULL,
  total_aset INTEGER NOT NULL,
  total_kewajiban INTEGER NOT NULL,
  total_ekuitas INTEGER NOT NULL,
  total_pasiva INTEGER NOT NULL,
  selisih INTEGER NOT NULL,
  hash_jurnal TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tahun, versi)
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
  -- T-A00: panjar yang sudah ada saat pembukaan. jurnal_open_id tetap
  -- NOT NULL dan wajib menunjuk jurnal berperan OPENING/OPENING_REPLACEMENT
  -- (divalidasi aplikasi/audit, bukan CHECK lintas tabel yang rapuh).
  sumber TEXT NOT NULL DEFAULT 'NORMAL' CHECK (sumber IN ('NORMAL', 'SALDO_AWAL')),
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
  FOREIGN KEY (jurnal_batal_id) REFERENCES jurnal(id),
  -- OPEN belum punya jurnal close/batal; CLOSED wajib punya jurnal close dan
  -- belum dibatalkan; DIBATALKAN wajib punya jurnal + tanggal + alasan batal.
  CHECK (
    (status = 'OPEN'
      AND jurnal_close_id IS NULL
      AND jurnal_batal_id IS NULL)
    OR (status = 'CLOSED'
      AND jurnal_close_id IS NOT NULL
      AND jurnal_batal_id IS NULL)
    OR (status = 'DIBATALKAN'
      AND jurnal_batal_id IS NOT NULL
      AND tanggal_batal IS NOT NULL
      AND length(trim(alasan_batal)) >= 5)
  )
) STRICT;

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
  created_at TEXT NOT NULL,
  CHECK (sisa_pokok_awal <= pokok_awal)
) STRICT;

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

CREATE TABLE IF NOT EXISTS pinjaman_bayar (
  id TEXT PRIMARY KEY,
  pinjaman_id TEXT NOT NULL REFERENCES pinjaman(id),
  angsuran_id INTEGER NULL REFERENCES pinjaman_angsuran(id),
  jurnal_id TEXT NOT NULL UNIQUE REFERENCES jurnal(id),
  tanggal TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
) STRICT;

${DDL_INDEX}
`;

/** DB-10: pesan trigger untuk jenis jurnal di luar daftar resmi. */
export const PESAN_JENIS_JURNAL_DB =
  'Jenis jurnal tidak dikenal. Gunakan jenis jurnal resmi aplikasi.';

/** DB-10: pesan trigger untuk tanggal yang tidak berbentuk YYYY-MM-DD. */
export const PESAN_TANGGAL_JURNAL_DB =
  'Tanggal jurnal harus berformat YYYY-MM-DD.';

/**
 * DB-10: pesan trigger untuk tanggal berformat benar tetapi bukan tanggal
 * kalender nyata (mis. `2026-02-30`).
 */
export const PESAN_TANGGAL_KALENDER_JURNAL_DB =
  'Tanggal jurnal harus tanggal kalender yang nyata, misalnya 2026-02-28, bukan 2026-02-30.';

/**
 * DB-10: pesan trigger untuk hubungan `jenis` dan `reversal_of` yang tidak
 * konsisten: hanya REVERSAL yang boleh punya reversal_of, dan REVERSAL wajib
 * menunjuk jurnal asli.
 */
export const PESAN_REVERSAL_JURNAL_DB =
  'Jurnal REVERSAL wajib menunjuk jurnal asli melalui reversal_of; ' +
  'reversal_of hanya boleh diisi untuk jurnal berjenis REVERSAL.';

/** Daftar jenis jurnal resmi, disinkronkan langsung dari posting layer. */
const JENIS_JURNAL_SQL = JENIS_JURNAL.map((jenis) => `'${jenis}'`).join(', ');

/** T-A00: daftar peran jurnal resmi (sama dengan `JurnalPeran`). */
const PERAN_JURNAL_SQL =
  "'NORMAL', 'OPENING', 'OPENING_REPLACEMENT', 'ADJUSTMENT'";

/** T-A00: pesan trigger untuk peran jurnal di luar daftar resmi. */
export const PESAN_PERAN_JURNAL_DB =
  'Peran jurnal tidak dikenal. Gunakan NORMAL, OPENING, OPENING_REPLACEMENT, atau ADJUSTMENT.';

/** T-A00: pesan trigger untuk relasi replaces_id yang tidak sah. */
export const PESAN_REPLACES_JURNAL_DB =
  'Relasi jurnal pengganti tidak sah: replaces_id tidak boleh menunjuk diri sendiri, ' +
  'harus menunjuk jurnal yang ada, dan hanya boleh diisi untuk peran ' +
  'OPENING_REPLACEMENT atau ADJUSTMENT.';

/** T-A00: pesan trigger untuk jurnal OPENING_REPLACEMENT yang tidak lengkap. */
export const PESAN_OPENING_REPLACEMENT_JURNAL_DB =
  'Jurnal OPENING_REPLACEMENT wajib berjenis UMUM dan menunjuk jurnal yang digantikan melalui replaces_id.';

/** T-A00: pesan trigger untuk jurnal OPENING yang tidak sesuai. */
export const PESAN_OPENING_JURNAL_DB =
  'Jurnal OPENING wajib berjenis SALDO_AWAL dan tidak boleh mengisi reversal_of.';

/** T-A00: pesan trigger saat jenis pengganti berbeda dari jurnal aslinya. */
export const PESAN_JENIS_PENGGANTI_JURNAL_DB =
  'Jenis jurnal pengganti harus sama dengan jurnal aslinya, kecuali pengganti SALDO_AWAL harus berjenis UMUM dengan peran OPENING_REPLACEMENT.';

/** T-A00: pesan trigger snapshot tutup buku yang mencoba diubah/dihapus. */
export const PESAN_SNAPSHOT_TUTUP_BUKU_DB =
  'Snapshot tutup buku bersifat append-only dan tidak boleh diubah atau dihapus.';

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
 * DDL trigger kanonik skema v2.
 *
 * Semua trigger didefinisikan di sini lalu diinterpolasi ke `DDL` melalui
 * `DDL_TRIGGER`, sehingga `db.exec(DDL)` pada DB baru langsung membuat tabel +
 * index + trigger. Pola `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER` (bukan
 * `IF NOT EXISTS`) membuat definisi selalu mengikuti kode, aman dijalankan
 * ulang, dan memulihkan trigger yang hilang.
 */
export const DDL_TRIGGER = `
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

DROP TRIGGER IF EXISTS trg_jurnal_validasi_insert;
CREATE TRIGGER trg_jurnal_validasi_insert
BEFORE INSERT ON jurnal
BEGIN
  SELECT RAISE(ABORT, '${PESAN_JENIS_JURNAL_DB}')
  WHERE NEW.jenis NOT IN (${JENIS_JURNAL_SQL});
  SELECT RAISE(ABORT, '${PESAN_TANGGAL_JURNAL_DB}')
  WHERE NEW.tanggal NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]';
  SELECT RAISE(ABORT, '${PESAN_TANGGAL_KALENDER_JURNAL_DB}')
  WHERE date(NEW.tanggal) IS NULL OR date(NEW.tanggal) <> NEW.tanggal;
  SELECT RAISE(ABORT, '${PESAN_REVERSAL_JURNAL_DB}')
  WHERE NEW.reversal_of IS NOT NULL
    AND NEW.reversal_of <> ''
    AND NEW.jenis <> 'REVERSAL';
  SELECT RAISE(ABORT, '${PESAN_REVERSAL_JURNAL_DB}')
  WHERE NEW.jenis = 'REVERSAL'
    AND (NEW.reversal_of IS NULL OR NEW.reversal_of = '');
  SELECT RAISE(ABORT, '${PESAN_PERAN_JURNAL_DB}')
  WHERE NEW.peran IS NULL OR NEW.peran NOT IN (${PERAN_JURNAL_SQL});
  SELECT RAISE(ABORT, '${PESAN_OPENING_JURNAL_DB}')
  WHERE NEW.peran = 'OPENING'
    AND (NEW.jenis <> 'SALDO_AWAL'
      OR (NEW.reversal_of IS NOT NULL AND NEW.reversal_of <> ''));
  SELECT RAISE(ABORT, '${PESAN_OPENING_REPLACEMENT_JURNAL_DB}')
  WHERE NEW.peran = 'OPENING_REPLACEMENT'
    AND (NEW.replaces_id IS NULL OR NEW.replaces_id = '' OR NEW.jenis <> 'UMUM');
  SELECT RAISE(ABORT, '${PESAN_REPLACES_JURNAL_DB}')
  WHERE NEW.replaces_id IS NOT NULL AND NEW.replaces_id <> ''
    AND (NEW.replaces_id = NEW.id
      OR NEW.peran NOT IN ('OPENING_REPLACEMENT', 'ADJUSTMENT'));
  SELECT RAISE(ABORT, '${PESAN_REPLACES_JURNAL_DB}')
  WHERE NEW.replaces_id IS NOT NULL AND NEW.replaces_id <> ''
    AND NOT EXISTS (SELECT 1 FROM jurnal a WHERE a.id = NEW.replaces_id);
  SELECT RAISE(ABORT, '${PESAN_JENIS_PENGGANTI_JURNAL_DB}')
  WHERE NEW.replaces_id IS NOT NULL AND NEW.replaces_id <> ''
    AND EXISTS (
      SELECT 1 FROM jurnal a
       WHERE a.id = NEW.replaces_id
         AND NOT (
           (a.jenis = 'SALDO_AWAL'
             AND NEW.jenis = 'UMUM'
             AND NEW.peran = 'OPENING_REPLACEMENT')
           OR (a.jenis <> 'SALDO_AWAL'
             AND NEW.jenis = a.jenis
             AND NEW.peran IN ('OPENING_REPLACEMENT', 'ADJUSTMENT'))
         )
    );
END;

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

DROP TRIGGER IF EXISTS trg_tutup_buku_snapshot_immutable_update;
CREATE TRIGGER trg_tutup_buku_snapshot_immutable_update
BEFORE UPDATE ON tutup_buku_snapshot
BEGIN
  SELECT RAISE(ABORT, '${PESAN_SNAPSHOT_TUTUP_BUKU_DB}');
END;

DROP TRIGGER IF EXISTS trg_tutup_buku_snapshot_immutable_delete;
CREATE TRIGGER trg_tutup_buku_snapshot_immutable_delete
BEFORE DELETE ON tutup_buku_snapshot
BEGIN
  SELECT RAISE(ABORT, '${PESAN_SNAPSHOT_TUTUP_BUKU_DB}');
END;
`;

/**
 * DDL kanonik skema v2: 12 tabel + seluruh index + seluruh trigger.
 * `DDL_TABEL` memuat tabel dan `${DDL_INDEX}`; `DDL_TRIGGER` memuat trigger.
 */
export const DDL = DDL_TABEL + DDL_TRIGGER;

/**
 * Awalan pesan penolakan DB yang index/trigger wajibnya hilang atau definisinya
 * berbeda. DDL sudah membuat ulang objek tersebut secara kanonik; bila masih
 * tidak sesuai, DB tidak boleh dibuka diam-diam.
 */
export const PESAN_OBJEK_SKEMA_TIDAK_SESUAI =
  'Skema database tidak valid: index/trigger wajib hilang atau definisinya berbeda:';

/** Pesan penolakan DB dengan objek skema tidak sesuai; menyebut objeknya. */
export function pesanObjekSkemaTidakSesuai(objek: readonly string[]): string {
  return (
    `${PESAN_OBJEK_SKEMA_TIDAK_SESUAI} ${objek.join(', ')}. ` +
    'Database tidak dibuka agar objek skema yang salah tidak dipakai diam-diam. ' +
    'Periksa file DB/backup, lalu pulihkan dari backup yang sehat; ' +
    'jangan membuat ulang atau mengubah objek skema secara manual.'
  );
}

type ObjekSkemaWajib = {
  nama: string;
  tipe: 'index' | 'trigger';
  sql: string;
};

/** Normalisasi teks SQL dari `sqlite_master` agar perbedaan spasi/kapital aman. */
function normalisasiSqlSkema(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Index/trigger non-implisit di `main`; `sqlite_autoindex_*` tidak termasuk. */
function bacaObjekSkema(db: Database.Database): ObjekSkemaWajib[] {
  const rows = db
    .prepare(
      "SELECT type, name, sql FROM sqlite_master " +
        "WHERE type IN ('index', 'trigger') AND sql IS NOT NULL " +
        "AND name NOT LIKE 'sqlite_autoindex_%'",
    )
    .all() as { type: string; name: string; sql: string }[];
  return rows.map((row) => ({
    nama: String(row.name),
    tipe: row.type === 'trigger' ? 'trigger' : 'index',
    sql: String(row.sql),
  }));
}

let definisiSkemaKanonikCache: ObjekSkemaWajib[] | undefined;

/**
 * Definisi index/trigger kanonik, diambil dari DB `:memory:` baru yang
 * dijalankan dengan `DDL` yang sama. Hasilnya di-cache karena `DDL` konstan.
 */
function definisiSkemaKanonik(): ObjekSkemaWajib[] {
  if (definisiSkemaKanonikCache) return definisiSkemaKanonikCache;
  const acuan = new Database(':memory:');
  try {
    acuan.exec(DDL);
    definisiSkemaKanonikCache = bacaObjekSkema(acuan);
  } finally {
    acuan.close();
  }
  return definisiSkemaKanonikCache;
}

/**
 * Bandingkan objek skema wajib (seluruh index & trigger kanonik) dengan
 * `sqlite_master.sql` pada DB target. Mengembalikan nama objek yang hilang
 * atau definisinya berbeda (ternormalisasi spasi + case-insensitive).
 */
export function objekSkemaTidakSesuai(db: Database.Database): string[] {
  const cari = db.prepare('SELECT type, sql FROM sqlite_master WHERE name = ?');
  const tidakSesuai: string[] = [];
  for (const wajib of definisiSkemaKanonik()) {
    const baris = cari.all(wajib.nama) as { type: string; sql: string | null }[];
    const cocok = baris.some(
      (row) =>
        row.type === wajib.tipe &&
        row.sql !== null &&
        normalisasiSqlSkema(String(row.sql)) === normalisasiSqlSkema(wajib.sql),
    );
    if (!cocok) tidakSesuai.push(wajib.nama);
  }
  return tidakSesuai;
}

/**
 * AUD2-09 — helper strictness. `pragma table_list` adalah sumber kebenaran
 * (bukan tebakan dari SQL DDL).
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

/** Daftar tabel aktif yang belum STRICT (kosong = seluruh kontrak terpenuhi). */
export function tabelAktifBelumStrict(db: Database.Database): string[] {
  return TABEL_AKTIF.filter((nama) => {
    const info = infoTabel(db, nama);
    return !info || Number(info.strict) !== 1;
  });
}

/**
 * AUD2-09 — verifikasi tabel aktif sudah berbentuk STRICT. Melempar pesan
 * Indonesia yang menyebut tabel bermasalah agar operator tidak membuka DB
 * dengan skema setengah jadi.
 */
export function pastikanTabelAktifStrict(db: Database.Database): void {
  const belum = tabelAktifBelumStrict(db);
  if (belum.length === 0) return;
  throw new Error(
    'Skema database tidak valid: tabel aktif wajib STRICT, tetapi tabel berikut ' +
      `belum STRICT atau tidak ditemukan: ${belum.join(', ')}. ` +
      'Database tidak diubah lebih lanjut; periksa file DB/backup.',
  );
}

/** Daftar tabel user di `main` (tabel internal `sqlite_*` diabaikan). */
function daftarTabelUser(db: Database.Database): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  return rows
    .map((row) => String(row.name))
    .filter((nama) => !nama.startsWith('sqlite_'));
}

/**
 * T1.4 — daftar kolom wajib yang hilang dari tabel aktif. `PRAGMA table_info`
 * adalah sumber kebenaran; peta `KOLOM_WAJIB` hanya daftar kolom yang
 * seharusnya ada.
 */
export function kolomWajibHilang(
  db: Database.Database,
): { tabel: string; kolom: string }[] {
  const kurang: { tabel: string; kolom: string }[] = [];
  for (const tabel of TABEL_AKTIF) {
    const info = db.pragma(`table_info(${tabel})`) as { name: string }[];
    const ada = new Set(info.map((row) => String(row.name)));
    for (const kolom of KOLOM_WAJIB[tabel]) {
      if (!ada.has(kolom)) kurang.push({ tabel, kolom });
    }
  }
  return kurang;
}

/**
 * Guard kompatibilitas skema. Hanya DB baru (v0 tanpa tabel) dan DB v2 yang
 * lengkap — seluruh `TABEL_AKTIF` ada beserta kolom wajibnya, dan tidak ada
 * tabel asing — yang boleh dibuka. DB v1 ditolak dengan pesan backup/reset
 * khusus; database lain/tidak lengkap tidak dimigrasikan dan tidak boleh
 * disentuh: fungsi ini dipanggil SEBELUM `journal_mode = WAL` agar file lama
 * tidak berubah byte-for-byte.
 */
export function cekKompatibilitas(db: Database.Database): void {
  const versi = Number(db.pragma('user_version', { simple: true }) ?? 0);
  const tabel = daftarTabelUser(db);

  if (versi === 0 && tabel.length === 0) return;

  // T-A00: skema v1 sengaja tidak dimigrasikan. Periksa versi sebelum DDL/WAL
  // agar file v1 tidak berubah; operator wajib backup lalu membuat DB baru.
  if (versi === 1) throw new Error(PESAN_DB_V1_KEDALUWARSA);

  if (versi === SCHEMA_VERSION) {
    const tabelSet = new Set(tabel);
    const tabelKurang = TABEL_AKTIF.filter((nama) => !tabelSet.has(nama));
    // DB v2 tanpa tabel wajib (mis. `jurnal_baris` terhapus) harus ditolak
    // sebelum DDL, jangan sampai `CREATE TABLE IF NOT EXISTS` membuat tabel
    // kosong dan menutupi kehilangan data. Cek tabel lebih dulu agar DB yang
    // tabelnya hilang tetap memakai pesan T1.3.
    if (tabelKurang.length > 0) throw new Error(pesanDbTidakLengkap(tabelKurang));

    const kolomKurang = kolomWajibHilang(db);
    if (kolomKurang.length > 0) throw new Error(pesanDbKolomTidakLengkap(kolomKurang));

    const tabelAktif = new Set<string>(TABEL_AKTIF);
    const tabelAsing = tabel.filter((nama) => !tabelAktif.has(nama));
    if (tabelAsing.length === 0) return;
  }

  throw new Error(PESAN_DB_TIDAK_KOMPATIBEL);
}

/**
 * Siapkan skema v2 untuk DB baru/kompatibel: jalankan seluruh DDL (tabel,
 * index, trigger) dalam satu transaksi, verifikasi STRICT, lalu naikkan
 * `user_version` ke v2 bila DB sebelumnya baru (v0).
 *
 * T3.6 — setelah DDL, objek index/trigger wajib dibandingkan dengan definisi
 * kanonik. `DROP ... IF EXISTS` + `CREATE` di DDL sudah membuat ulang objek
 * tersebut; bila masih hilang/berbeda (mis. nama bentrok dengan objek lain),
 * DB ditolak dengan pesan Indonesia agar tidak dibuka diam-diam.
 */
export function siapkanSkema(db: Database.Database): void {
  const versiAwal = Number(db.pragma('user_version', { simple: true }) ?? 0);
  const siapkan = db.transaction(() => {
    try {
      db.exec(DDL);
    } catch (e) {
      // `CREATE` bisa gagal bila nama index/trigger dipakai objek lain. Bila
      // memang ada objek wajib yang tidak sesuai, laporkan dalam bahasa
      // Indonesia beserta nama objeknya; selain itu teruskan error asli.
      const tidakSesuai = objekSkemaTidakSesuai(db);
      if (tidakSesuai.length > 0) {
        throw new Error(pesanObjekSkemaTidakSesuai(tidakSesuai));
      }
      throw e;
    }
    pastikanTabelAktifStrict(db);
    const tidakSesuai = objekSkemaTidakSesuai(db);
    if (tidakSesuai.length > 0) throw new Error(pesanObjekSkemaTidakSesuai(tidakSesuai));
    if (versiAwal === 0) db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  siapkan();
}

/**
 * Buka DB aplikasi. Database lama/tidak kompatibel ditolak sebelum pragma WAL
 * agar file tidak berubah; database baru langsung dibuat dengan skema v1.
 */
export function openDb(path = process.env.PURA_DB ?? './data/pura.db'): Database.Database {
  // better-sqlite3 tidak membuat folder induk — pastikan ada dulu.
  // (PURA_DB default `./data/...` dan folder `data/` di-gitignore sehingga
  // checkout baru pasti belum punya foldernya.)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  try {
    // Tolak DB lama/tidak kompatibel sebelum `journal_mode = WAL` (pragma itu
    // mengubah header file) dan sebelum DDL apa pun.
    cekKompatibilitas(db);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    siapkanSkema(db);

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
    // Jangan tinggalkan koneksi/file handle terbuka bila penyiapan skema gagal
    // (penting untuk restore: file harus bisa ditukar/dihapus di Windows).
    try {
      db.close();
    } catch {
      /* biarkan error asli yang dilaporkan */
    }
    throw e;
  }
}
