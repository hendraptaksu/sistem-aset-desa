// Repository tipis di atas better-sqlite3. dipakai Agent A (write) & Agent B (read).
// Kunci longgar ditegakkan di sini: update/delete periode terkunci wajib alasan.

import type Database from 'better-sqlite3';
import { buatAuditLog } from '../core/audit.js';
import { isPeriodeTerkunci } from '../core/periode.js';
import {
  formatNomorBukti,
  nomorBuktiBerikutnya,
  tahunDariTanggal,
} from '../core/nomorBukti.js';
import {
  DEFAULT_PENGATURAN,
  normalisasiPengaturan,
  validasiPengaturan,
  type PengaturanPembukuan,
} from '../core/pengaturan.js';
import { JENIS_JURNAL, tanggalKalenderValid } from '../core/posting.js';
import { akhirHariLokalUtc, awalHariLokalUtc } from '../utils/tanggal.js';
import { PESAN_AKUN_LEGACY, akunBolehDiposting, type CoaTipe, type PosisiNormal } from './coa.js';
import type {
  Aset,
  AuditLog,
  Jurnal,
  JurnalBaris,
  JurnalBarisInput,
  JurnalHeaderInput,
  TutupBuku,
} from '../core/types.js';

export type AkunDb = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
  posisi_normal: PosisiNormal;
  aktif: boolean;
};

const rowToAkun = (r: Record<string, unknown>): AkunDb => ({
  kode: String(r.kode),
  nama: String(r.nama),
  tipe: String(r.tipe) as CoaTipe,
  posisi_normal: String(r.posisi_normal) as PosisiNormal,
  aktif: Number(r.aktif) === 1,
});

/** Daftar akun dari master DB (hasil upsert COA saat openDb). */
export function listAkun(db: Database.Database, opts: { aktif?: boolean } = {}): AkunDb[] {
  const sql = opts.aktif === undefined
    ? 'SELECT * FROM akun ORDER BY kode'
    : 'SELECT * FROM akun WHERE aktif = ? ORDER BY kode';
  const rows = (opts.aktif === undefined
    ? db.prepare(sql).all()
    : db.prepare(sql).all(opts.aktif ? 1 : 0)) as Record<string, unknown>[];
  return rows.map(rowToAkun);
}

export function getAkun(db: Database.Database, kode: string): AkunDb | null {
  const r = db.prepare('SELECT * FROM akun WHERE kode = ?').get(kode) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToAkun(r) : null;
}

// ---------------------------------------------------------------------------
// Jurnal double-entry (P0-2)
// ---------------------------------------------------------------------------

const rowToJurnal = (r: Record<string, unknown>): Jurnal => ({
  id: String(r.id),
  tanggal: String(r.tanggal),
  no_bukti: String(r.no_bukti ?? ''),
  keterangan: String(r.keterangan),
  jenis: String(r.jenis) as Jurnal['jenis'],
  grup_id: String(r.grup_id),
  reversal_of: r.reversal_of === null || r.reversal_of === undefined ? null : String(r.reversal_of),
  created_at: String(r.created_at),
});

const rowToJurnalBaris = (r: Record<string, unknown>): JurnalBaris => ({
  id: Number(r.id),
  jurnal_id: String(r.jurnal_id),
  akun_kode: String(r.akun_kode),
  debit: Number(r.debit),
  kredit: Number(r.kredit),
  keterangan: String(r.keterangan ?? ''),
});

export type JurnalFilter = {
  mulai?: string;
  sampai?: string;
  jenis?: string;
  grup_id?: string;
  akun_kode?: string;
  reversal_of?: string;
  /**
   * Kata kunci bebas (P1-11): no. bukti, keterangan, kode/nama akun, atau
   * nominal rupiah (titik/koma/spasi diabaikan). Contoh "150000" cocok dengan
   * debit/kredit Rp 150.000 (tersimpan 15.000.000 sen).
   */
  cari?: string;
  limit?: number;
  offset?: number;
};

/**
 * Simpan satu jurnal + barisnya secara atomik. Aturan yang ditegakkan di sini
 * (bukan di UI): minimal 2 baris, tiap baris hanya debit atau kredit > 0,
 * akun harus ada di master `akun`, total debit = total kredit, total > 0.
 * Error dilempar dengan pesan berbahasa Indonesia.
 */
export function insertJurnal(
  db: Database.Database,
  header: JurnalHeaderInput,
  baris: JurnalBarisInput[],
): Jurnal {
  const id = String(header.id ?? '').trim();
  if (!id) throw new Error('ID jurnal wajib diisi.');
  if (!tanggalKalenderValid(String(header.tanggal ?? '')))
    throw new Error('Tanggal jurnal tidak valid (YYYY-MM-DD).');
  const keterangan = String(header.keterangan ?? '').trim();
  if (!keterangan) throw new Error('Keterangan jurnal wajib diisi.');
  if (!Array.isArray(baris) || baris.length < 2)
    throw new Error('Jurnal wajib memiliki minimal 2 baris (debit dan kredit).');
  if (getJurnal(db, id)) throw new Error(`Jurnal ${id} sudah ada.`);

  const jenis = header.jenis ?? 'UMUM';
  if (!JENIS_JURNAL.includes(jenis)) throw new Error('Jenis jurnal tidak dikenal.');

  // Tahun divalidasi di sini (tanggal sudah lolos tanggalKalenderValid) supaya
  // penomoran otomatis tidak pernah memakai tahun aneh.
  const tahunJurnal = tahunDariTanggal(String(header.tanggal));

  const noBukti = String(header.no_bukti ?? '').trim();
  if (noBukti) {
    // AUD-23: nomor bukti hanya unik dalam tahun yang sama. Nomor yang sama
    // boleh dipakai lagi di tahun berbeda (mis. JU-2026-0001 & JU-2025-0001).
    const dup = db
      .prepare(
        `SELECT id FROM jurnal
         WHERE no_bukti <> ''
           AND substr(tanggal, 1, 4) = ?
           AND no_bukti = ? COLLATE NOCASE
         LIMIT 1`,
      )
      .get(String(tahunJurnal), noBukti) as { id: string } | undefined;
    if (dup) throw new Error(`Nomor bukti ${noBukti} sudah dipakai jurnal ${dup.id}.`);
  }

  const reversalOf = header.reversal_of?.trim() || null;
  if (reversalOf) {
    const asli = getJurnal(db, reversalOf);
    if (!asli) throw new Error(`Jurnal yang dikoreksi (${reversalOf}) tidak ditemukan.`);
    // P0-6: jurnal balik tidak boleh dibalik lagi, dan satu jurnal hanya boleh
    // punya satu reversal. Penjagaan ini juga berlaku untuk pemanggil yang
    // melewati fungsi koreksi aplikasi.
    if (asli.reversal_of)
      throw new Error('Jurnal balik tidak boleh dibalik lagi. Koreksi jurnal aslinya.');
    const sudah = db
      .prepare('SELECT id FROM jurnal WHERE reversal_of = ? LIMIT 1')
      .get(reversalOf) as { id: string } | undefined;
    if (sudah)
      throw new Error(`Jurnal ${reversalOf} sudah dikoreksi oleh jurnal ${sudah.id}.`);
  }

  const cekAkun = db.prepare('SELECT kode, aktif FROM akun WHERE kode = ?');
  let totalDebit = 0;
  let totalKredit = 0;
  const bersih = baris.map((b, i) => {
    const akunKode = String(b.akun_kode ?? '').trim();
    const akunDb = cekAkun.get(akunKode) as { kode: string; aktif: number } | undefined;
    if (!akunKode || !akunDb)
      throw new Error(`Baris ${i + 1}: akun ${akunKode || '(kosong)'} tidak dikenal.`);
    if (Number(akunDb.aktif) !== 1)
      throw new Error(`Baris ${i + 1}: akun ${akunKode} sudah tidak aktif.`);
    if (!akunBolehDiposting(akunKode, Number(akunDb.aktif) === 1))
      throw new Error(`Baris ${i + 1}: akun ${akunKode} ${PESAN_AKUN_LEGACY}`);
    if (!Number.isInteger(b.debit) || b.debit < 0)
      throw new Error(`Baris ${i + 1}: debit harus bilangan bulat ≥ 0.`);
    if (!Number.isInteger(b.kredit) || b.kredit < 0)
      throw new Error(`Baris ${i + 1}: kredit harus bilangan bulat ≥ 0.`);
    if (b.debit > 0 && b.kredit > 0)
      throw new Error(`Baris ${i + 1}: isi salah satu saja — debit ATAU kredit.`);
    if (b.debit === 0 && b.kredit === 0)
      throw new Error(`Baris ${i + 1}: nominal debit/kredit harus lebih dari 0.`);
    totalDebit += b.debit;
    totalKredit += b.kredit;
    return {
      akun_kode: akunKode,
      debit: b.debit,
      kredit: b.kredit,
      keterangan: String(b.keterangan ?? '').trim(),
    };
  });
  if (totalDebit !== totalKredit)
    throw new Error(
      `Jurnal tidak seimbang: total debit ${totalDebit} ≠ total kredit ${totalKredit} (satuan sen).`,
    );
  if (totalDebit <= 0) throw new Error('Total jurnal harus lebih dari 0.');

  const row: Jurnal = {
    id,
    tanggal: header.tanggal,
    no_bukti: noBukti,
    keterangan,
    jenis,
    grup_id: header.grup_id?.trim() || id,
    reversal_of: reversalOf,
    created_at: header.created_at ?? new Date().toISOString(),
  };

  const simpan = db.transaction(() => {
    // P1-11/P1-13: nomor kosong diisi otomatis DI DALAM transaksi yang sama
    // dengan insert. Prefix & padding dibaca dari pengaturan pembukuan saat
    // nomor dibuat, sehingga nomor lama tidak berubah saat pengaturan diubah.
    if (!row.no_bukti) {
      const pengaturan = getPengaturanPembukuan(db);
      const terpakai = (
        db
          .prepare("SELECT no_bukti FROM jurnal WHERE no_bukti LIKE ? ESCAPE '\\'")
          .all(`${pengaturan.prefixNomorBukti}-${tahunJurnal}-%`) as {
          no_bukti: string;
        }[]
      ).map((r) => String(r.no_bukti));
      row.no_bukti = formatNomorBukti(
        tahunJurnal,
        nomorBuktiBerikutnya(
          tahunJurnal,
          terpakai,
          pengaturan.prefixNomorBukti,
          pengaturan.paddingNomorBukti,
        ),
        pengaturan.prefixNomorBukti,
        pengaturan.paddingNomorBukti,
      );
      const dup = db
        .prepare(
          `SELECT id FROM jurnal
           WHERE no_bukti <> ''
             AND substr(tanggal, 1, 4) = ?
             AND no_bukti = ? COLLATE NOCASE
           LIMIT 1`,
        )
        .get(String(tahunJurnal), row.no_bukti) as { id: string } | undefined;
      if (dup) throw new Error(`Nomor bukti ${row.no_bukti} sudah dipakai jurnal ${dup.id}.`);
    }
    db.prepare(
      `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.tanggal,
      row.no_bukti,
      row.keterangan,
      row.jenis,
      row.grup_id,
      row.reversal_of,
      row.created_at,
    );
    const insBaris = db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const b of bersih)
      insBaris.run(row.id, b.akun_kode, b.debit, b.kredit, b.keterangan);
  });
  try {
    simpan();
  } catch (e) {
    // AUD-23: unique index per tahun adalah penjaga terakhir bila ada pemanggil
    // yang melewati validasi aplikasi. Pesan SQLite diterjemahkan ke Indonesia.
    const pesan = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed:.*(jurnal\.no_bukti|idx_jurnal_no_bukti)/i.test(pesan))
      throw new Error(`Nomor bukti ${row.no_bukti} sudah dipakai. Gunakan nomor bukti lain.`);
    throw e;
  }
  return row;
}

export function getJurnal(db: Database.Database, id: string): Jurnal | null {
  const r = db.prepare('SELECT * FROM jurnal WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToJurnal(r) : null;
}

export function listJurnalBaris(db: Database.Database, jurnalId: string): JurnalBaris[] {
  const rows = db
    .prepare('SELECT * FROM jurnal_baris WHERE jurnal_id = ? ORDER BY id')
    .all(jurnalId) as Record<string, unknown>[];
  return rows.map(rowToJurnalBaris);
}

/** Escape wildcard LIKE agar kata kunci operator dicari apa adanya. */
function escapeLike(teks: string): string {
  return teks.replace(/[\\%_]/g, '\\$&');
}

/**
 * Nominal rupiah dari kata kunci pencarian → sen. Titik/koma/spasi (pemisah
 * ribuan) dan awalan "Rp" diabaikan. Bukan angka → null.
 */
function cariNominalSen(teks: string): number | null {
  const bersih = teks
    .trim()
    .replace(/^rp\.?\s*/i, '')
    .replace(/[.,\s]/g, '');
  if (!/^\d+$/.test(bersih)) return null;
  const rupiah = Number(bersih);
  if (!Number.isSafeInteger(rupiah) || rupiah <= 0) return null;
  const sen = rupiah * 100;
  return Number.isSafeInteger(sen) ? sen : null;
}

/** WHERE bersama untuk daftar & hitung jurnal (termasuk pencarian P1-11). */
function jurnalWhere(f: JurnalFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.mulai) { where.push('j.tanggal >= ?'); params.push(f.mulai); }
  if (f.sampai) { where.push('j.tanggal <= ?'); params.push(f.sampai); }
  if (f.jenis) { where.push('j.jenis = ?'); params.push(f.jenis); }
  if (f.grup_id) { where.push('j.grup_id = ?'); params.push(f.grup_id); }
  if (f.reversal_of) { where.push('j.reversal_of = ?'); params.push(f.reversal_of); }
  if (f.akun_kode) {
    where.push('EXISTS (SELECT 1 FROM jurnal_baris b WHERE b.jurnal_id = j.id AND b.akun_kode = ?)');
    params.push(f.akun_kode);
  }
  const cari = String(f.cari ?? '').trim();
  if (cari) {
    const like = `%${escapeLike(cari)}%`;
    const klausa = [
      "j.no_bukti LIKE ? ESCAPE '\\'",
      "j.keterangan LIKE ? ESCAPE '\\'",
      `EXISTS (
         SELECT 1 FROM jurnal_baris b
         JOIN akun a ON a.kode = b.akun_kode
         WHERE b.jurnal_id = j.id
           AND (b.akun_kode LIKE ? ESCAPE '\\' OR a.nama LIKE ? ESCAPE '\\')
       )`,
    ];
    params.push(like, like, like, like);
    const nominalSen = cariNominalSen(cari);
    if (nominalSen !== null) {
      klausa.push(
        'EXISTS (SELECT 1 FROM jurnal_baris bn WHERE bn.jurnal_id = j.id AND (bn.debit = ? OR bn.kredit = ?))',
      );
      params.push(nominalSen, nominalSen);
    }
    where.push(`(${klausa.join(' OR ')})`);
  }
  return {
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function listJurnal(
  db: Database.Database,
  f: JurnalFilter = {},
): Jurnal[] {
  const where = jurnalWhere(f);
  const params = [...where.params];
  let sql = `SELECT j.* FROM jurnal j ${where.sql} ORDER BY j.tanggal, j.rowid`;
  if (f.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(Number.isFinite(f.limit) ? Math.max(0, Math.trunc(f.limit)) : 0);
    if (f.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(Number.isFinite(f.offset) ? Math.max(0, Math.trunc(f.offset)) : 0);
    }
  } else if (f.offset !== undefined) {
    sql += ' LIMIT -1 OFFSET ?';
    params.push(Number.isFinite(f.offset) ? Math.max(0, Math.trunc(f.offset)) : 0);
  }
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToJurnal);
}

/** Jumlah jurnal yang cocok dengan filter (tanpa limit/offset), untuk pagination. */
export function hitungJurnal(db: Database.Database, f: JurnalFilter = {}): number {
  const where = jurnalWhere(f);
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM jurnal j ${where.sql}`)
    .get(...where.params) as { total: number };
  return Number(row.total);
}

/** Kepala + baris satu jurnal; null bila tidak ada. */
export function getJurnalDetail(
  db: Database.Database,
  id: string,
): { jurnal: Jurnal; baris: JurnalBaris[] } | null {
  const jurnal = getJurnal(db, id);
  return jurnal ? { jurnal, baris: listJurnalBaris(db, id) } : null;
}

export type JurnalLengkap = Jurnal & {
  baris: JurnalBaris[];
  total_debit: number;
  /** ID jurnal balik yang sudah ada untuk jurnal ini (null = belum dikoreksi). */
  reversal_id: string | null;
};

/**
 * Daftar jurnal beserta barisnya untuk layar Jurnal Umum (P0-6).
 * `reversal_id` menandai jurnal yang sudah dikoreksi agar tombol Koreksi bisa
 * dinonaktifkan tanpa query tambahan di UI.
 */
export function listJurnalLengkap(
  db: Database.Database,
  filter: JurnalFilter = {},
): JurnalLengkap[] {
  const ambilBaris = db.prepare(
    'SELECT * FROM jurnal_baris WHERE jurnal_id = ? ORDER BY id',
  );
  const ambilReversal = db.prepare(
    'SELECT id FROM jurnal WHERE reversal_of = ? ORDER BY rowid LIMIT 1',
  );
  return listJurnal(db, filter).map((jurnal) => {
    const baris = (ambilBaris.all(jurnal.id) as Record<string, unknown>[]).map(rowToJurnalBaris);
    const reversal = ambilReversal.get(jurnal.id) as { id: string } | undefined;
    return {
      ...jurnal,
      baris,
      total_debit: baris.reduce((s, b) => s + b.debit, 0),
      reversal_id: reversal ? String(reversal.id) : null,
    };
  });
}

/**
 * Halaman daftar jurnal + total server (P1-11). `rows` sudah dipotong oleh
 * LIMIT/OFFSET; `total` adalah jumlah seluruh baris yang cocok filter.
 */
export function listJurnalLengkapPage(
  db: Database.Database,
  filter: JurnalFilter = {},
): { rows: JurnalLengkap[]; total: number } {
  return {
    rows: listJurnalLengkap(db, filter),
    total: hitungJurnal(db, filter),
  };
}

/**
 * Saran nomor bukti berikutnya untuk pratinjau form (P1-11/P1-13). Hanya
 * membaca DB; penomoran final tetap dilakukan atomik oleh `insertJurnal`.
 * Prefix & padding mengikuti pengaturan pembukuan saat ini.
 */
export function saranNomorBukti(db: Database.Database, tanggal: string): string {
  const tahun = tahunDariTanggal(tanggal);
  const pengaturan = getPengaturanPembukuan(db);
  const terpakai = (
    db
      .prepare("SELECT no_bukti FROM jurnal WHERE no_bukti LIKE ? ESCAPE '\\'")
      .all(`${pengaturan.prefixNomorBukti}-${tahun}-%`) as {
      no_bukti: string;
    }[]
  ).map((r) => String(r.no_bukti));
  return formatNomorBukti(
    tahun,
    nomorBuktiBerikutnya(
      tahun,
      terpakai,
      pengaturan.prefixNomorBukti,
      pengaturan.paddingNomorBukti,
    ),
    pengaturan.prefixNomorBukti,
    pengaturan.paddingNomorBukti,
  );
}

export function listTutupBuku(db: Database.Database): TutupBuku[] {
  const rows = db
    .prepare('SELECT tahun, created_at, backup_path, catatan FROM tutup_buku ORDER BY tahun')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    tahun: Number(r.tahun),
    created_at: String(r.created_at),
    backup_path: String(r.backup_path ?? ''),
    catatan: String(r.catatan ?? ''),
  }));
}

/**
 * Simpan/ubah penanda tutup buku. Angka laba sengaja TIDAK ditulis: sumber
 * laba selalu jurnal (P0-7). Pemanggil wajib sudah memvalidasi penimpaan.
 */
export function insertTutupBuku(db: Database.Database, t: TutupBuku): void {
  db.prepare(
    `INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tahun) DO UPDATE SET
       created_at = excluded.created_at,
       backup_path = excluded.backup_path,
       catatan = excluded.catatan`,
  ).run(t.tahun, t.created_at, t.backup_path, t.catatan);
}

const rowToAuditLog = (r: Record<string, unknown>): AuditLog => ({
  id: String(r.id),
  tanggal: String(r.tanggal),
  aksi: String(r.aksi),
  alasan: String(r.alasan ?? ''),
  data_lama_json: String(r.data_lama_json ?? ''),
  data_baru_json: String(r.data_baru_json ?? ''),
});

export function insertAuditLog(db: Database.Database, a: AuditLog): void {
  db.prepare(
    `INSERT INTO audit_log (id, tanggal, aksi, alasan, data_lama_json, data_baru_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id,
    a.tanggal,
    a.aksi,
    a.alasan,
    a.data_lama_json ?? '',
    a.data_baru_json ?? '',
  );
}

export type InputAudit = {
  aksi: string;
  alasan?: string;
  /** Kondisi sebelum operasi. */
  lama?: unknown;
  /** Kondisi sesudah operasi. */
  baru?: unknown;
  id?: string;
  tanggal?: string;
};

/**
 * Helper audit terpusat (P0-9). Semua operasi yang wajib punya jejak audit
 * memakai fungsi ini supaya bentuk data sebelum/sesudah konsisten.
 * Pemanggil yang butuh atomik membungkusnya dalam `db.transaction`.
 */
export function catatAudit(db: Database.Database, input: InputAudit): AuditLog {
  const row = buatAuditLog(
    input.aksi,
    String(input.alasan ?? ''),
    input.lama,
    input.baru,
    { id: input.id, tanggal: input.tanggal },
  );
  insertAuditLog(db, row);
  return row;
}

/** Filter riwayat audit; `aksi` dicocokkan persis atau sebagai awalan. */
export type AuditFilter = {
  aksi?: string;
  /** Tanggal lokal WITA awal `YYYY-MM-DD` (inklusif). */
  mulai?: string;
  /** Tanggal lokal WITA akhir `YYYY-MM-DD` (inklusif). */
  sampai?: string;
  limit?: number;
  offset?: number;
};

function auditWhere(f: AuditFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const aksi = String(f.aksi ?? '').trim();
  if (aksi) {
    // Escape wildcard user agar filter teks tidak berubah jadi pola LIKE bebas.
    const escaped = aksi.replace(/[\\%_]/g, '\\$&');
    where.push("(aksi = ? OR aksi LIKE ? ESCAPE '\\')");
    params.push(aksi, `${escaped}%`);
  }
  // `tanggal` tersimpan ISO UTC; batas filter dikonversi dari tanggal lokal
  // agar audit pagi WITA tidak jatuh ke tanggal UTC hari sebelumnya.
  if (f.mulai) {
    where.push('tanggal >= ?');
    params.push(awalHariLokalUtc(f.mulai));
  }
  if (f.sampai) {
    where.push('tanggal < ?');
    params.push(akhirHariLokalUtc(f.sampai));
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function angkaAman(nilai: unknown, bawaan: number, min: number, maks: number): number {
  const n = Number(nilai);
  if (!Number.isFinite(n)) return bawaan;
  return Math.min(maks, Math.max(min, Math.trunc(n)));
}

/**
 * Daftar audit terbaru (default 200). Tetap mengembalikan array agar pemanggil
 * lama kompatibel; `listAuditLogPage` menambahkan total untuk pagination UI.
 */
export function listAuditLog(
  db: Database.Database,
  filter: AuditFilter | number = {},
): AuditLog[] {
  const f: AuditFilter = typeof filter === 'number' ? { limit: filter } : filter;
  const limit = angkaAman(f.limit, 200, 0, 1000);
  const offset = angkaAman(f.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const where = auditWhere(f);
  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${where.sql}
       ORDER BY tanggal DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as Record<string, unknown>[];
  return rows.map(rowToAuditLog);
}

/** Jumlah baris audit yang cocok dengan filter (tanpa limit/offset). */
export function hitungAuditLog(db: Database.Database, filter: AuditFilter = {}): number {
  const where = auditWhere(filter);
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM audit_log ${where.sql}`)
    .get(...where.params) as { total: number };
  return Number(row.total);
}

/** Halaman audit + total, dipakai IPC `audit:list` dan UI Pengaturan. */
export function listAuditLogPage(
  db: Database.Database,
  filter: AuditFilter = {},
): { rows: AuditLog[]; total: number } {
  return {
    rows: listAuditLog(db, filter),
    total: hitungAuditLog(db, filter),
  };
}

/** Guard kunci longgar untuk edit/hapus baris lama. Return error jika alasan kurang. */
export function guardPeriodeTerkunci(
  db: Database.Database,
  tanggal: string,
  alasan?: string,
): string | null {
  const tutup = listTutupBuku(db);
  if (!isPeriodeTerkunci(tanggal, tutup)) return null;
  if (!alasan || alasan.trim().length < 5)
    return 'Periode sudah ditutup: wajib isi alasan ≥5 karakter (kunci longgar).';
  return null;
}

// --- Kunci aplikasi (PIN 6 digit, single-laptop). Key-value di tabel pengaturan. ---
export const KUNCI_PIN_SALT = 'pin_salt';
export const KUNCI_PIN_HASH = 'pin_hash';
export const KUNCI_IDLE_MENIT = 'idle_menit';

export function getPengaturan(db: Database.Database, kunci: string): string | null {
  const r = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(kunci) as {
    nilai: string;
  } | undefined;
  return r ? String(r.nilai) : null;
}

export function setPengaturan(db: Database.Database, kunci: string, nilai: string): void {
  db.prepare('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai').run(
    kunci,
    nilai,
  );
}

export function sudahSetupPin(db: Database.Database): boolean {
  return getPengaturan(db, KUNCI_PIN_SALT) !== null && getPengaturan(db, KUNCI_PIN_HASH) !== null;
}

export function getIdleMenit(db: Database.Database, fallback = 30): number {
  const v = getPengaturan(db, KUNCI_IDLE_MENIT);
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) ? n : fallback;
}

// --- Pengaturan pembukuan (P1-13). Tetap key-value di tabel `pengaturan`. ---
export const KUNCI_AKUNTANSI_NAMA_ENTITAS = 'akuntansi_nama_entitas';
export const KUNCI_AKUNTANSI_KOP_TAMBAHAN = 'akuntansi_kop_tambahan';
export const KUNCI_AKUNTANSI_TANGGAL_MULAI = 'akuntansi_tanggal_mulai';
export const KUNCI_AKUNTANSI_AWAL_TAHUN = 'akuntansi_awal_tahun_buku';
export const KUNCI_AKUNTANSI_PREFIX_BUKTI = 'akuntansi_prefix_bukti';
export const KUNCI_AKUNTANSI_PADDING_BUKTI = 'akuntansi_padding_bukti';

/**
 * Baca pengaturan pembukuan lengkap. DB kosong / field belum pernah disimpan
 * otomatis memakai `DEFAULT_PENGATURAN` (kop lama, JU, 4 digit).
 */
export function getPengaturanPembukuan(
  db: Database.Database,
): PengaturanPembukuan {
  return normalisasiPengaturan({
    namaEntitas:
      getPengaturan(db, KUNCI_AKUNTANSI_NAMA_ENTITAS) ??
      DEFAULT_PENGATURAN.namaEntitas,
    kopTambahan: getPengaturan(db, KUNCI_AKUNTANSI_KOP_TAMBAHAN) ?? '',
    tanggalMulaiPembukuan:
      getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI) ?? '',
    awalTahunBuku:
      getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN) ??
      DEFAULT_PENGATURAN.awalTahunBuku,
    prefixNomorBukti:
      getPengaturan(db, KUNCI_AKUNTANSI_PREFIX_BUKTI) ??
      DEFAULT_PENGATURAN.prefixNomorBukti,
    paddingNomorBukti:
      getPengaturan(db, KUNCI_AKUNTANSI_PADDING_BUKTI) ??
      DEFAULT_PENGATURAN.paddingNomorBukti,
  });
}

export type OpsiSimpanPengaturan = {
  alasan?: string;
};

/**
 * Simpan pengaturan pembukuan secara atomik + audit `PENGATURAN-PEMBUKUAN`.
 * Data audit hanya berisi model pembukuan (tidak pernah PIN/salt/hash).
 * Melempar Error berbahasa Indonesia bila validasi gagal.
 */
export function simpanPengaturanPembukuan(
  db: Database.Database,
  input: unknown,
  opsi: OpsiSimpanPengaturan = {},
): PengaturanPembukuan {
  const bersih = normalisasiPengaturan(input);
  const errors = validasiPengaturan(bersih);
  if (errors.length > 0) throw new Error(errors[0]!);

  const lama = getPengaturanPembukuan(db);
  const simpan = db.transaction(() => {
    setPengaturan(db, KUNCI_AKUNTANSI_NAMA_ENTITAS, bersih.namaEntitas);
    setPengaturan(db, KUNCI_AKUNTANSI_KOP_TAMBAHAN, bersih.kopTambahan);
    setPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI, bersih.tanggalMulaiPembukuan);
    setPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN, String(bersih.awalTahunBuku));
    setPengaturan(db, KUNCI_AKUNTANSI_PREFIX_BUKTI, bersih.prefixNomorBukti);
    setPengaturan(db, KUNCI_AKUNTANSI_PADDING_BUKTI, String(bersih.paddingNomorBukti));

    catatAudit(db, {
      aksi: 'PENGATURAN-PEMBUKUAN',
      alasan: String(opsi.alasan ?? '').trim() || 'Pengaturan pembukuan diubah',
      lama,
      baru: bersih,
    });
  });
  simpan();
  return bersih;
}

// --- Inventaris Aset (non-keuangan, isolasi penuh dari ledger/neraca) ---
const rowToAset = (r: Record<string, unknown>): Aset => ({
  id: String(r.id),
  kode: String(r.kode),
  nama: String(r.nama),
  jenis: r.jenis as Aset['jenis'],
  luas_m2: r.luas_m2 === null || r.luas_m2 === undefined ? null : Number(r.luas_m2),
  lokasi: String(r.lokasi ?? ''),
  status_hukum: String(r.status_hukum ?? ''),
  tahun_perolehan: r.tahun_perolehan === null || r.tahun_perolehan === undefined ? null : Number(r.tahun_perolehan),
  asal_usul: String(r.asal_usul ?? ''),
  kondisi: r.kondisi as Aset['kondisi'],
  keterangan: String(r.keterangan ?? ''),
  nilai_sen: r.nilai_sen === null || r.nilai_sen === undefined ? null : Number(r.nilai_sen),
  created_at: String(r.created_at),
  updated_at: String(r.updated_at),
});

export function insertAset(db: Database.Database, a: Aset): void {
  const simpan = db.transaction(() => {
    db.prepare(
      `INSERT INTO aset (id, kode, nama, jenis, luas_m2, lokasi, status_hukum, tahun_perolehan,
        asal_usul, kondisi, keterangan, nilai_sen, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      a.id, a.kode, a.nama, a.jenis, a.luas_m2, a.lokasi, a.status_hukum, a.tahun_perolehan,
      a.asal_usul, a.kondisi, a.keterangan, a.nilai_sen, a.created_at, a.updated_at,
    );
    catatAudit(db, {
      aksi: `ASET-CREATE ${a.id}`,
      alasan: `Tambah aset ${a.kode}`,
      baru: a,
    });
  });
  simpan();
}

export function listAset(
  db: Database.Database,
  f: { jenis?: string; cari?: string } = {},
): Aset[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.jenis) { where.push('jenis = ?'); params.push(f.jenis); }
  if (f.cari) {
    where.push('(kode LIKE ? OR nama LIKE ? OR lokasi LIKE ?)');
    const like = `%${f.cari}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT * FROM aset ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY kode`;
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToAset);
}

export function getAset(db: Database.Database, id: string): Aset | null {
  const r = db.prepare('SELECT * FROM aset WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return r ? rowToAset(r) : null;
}

export function updateAset(db: Database.Database, a: Aset): void {
  const simpan = db.transaction(() => {
    const lama = getAset(db, a.id);
    const info = db.prepare(
      `UPDATE aset SET kode = ?, nama = ?, jenis = ?, luas_m2 = ?, lokasi = ?, status_hukum = ?,
        tahun_perolehan = ?, asal_usul = ?, kondisi = ?, keterangan = ?, nilai_sen = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      a.kode, a.nama, a.jenis, a.luas_m2, a.lokasi, a.status_hukum, a.tahun_perolehan,
      a.asal_usul, a.kondisi, a.keterangan, a.nilai_sen, a.updated_at, a.id,
    );
    if (Number(info.changes) === 0) return;
    catatAudit(db, {
      aksi: `ASET-UPDATE ${a.id}`,
      alasan: `Ubah aset ${a.kode}`,
      lama,
      baru: a,
    });
  });
  simpan();
}

export function deleteAset(db: Database.Database, id: string): void {
  const simpan = db.transaction(() => {
    const lama = getAset(db, id);
    const info = db.prepare('DELETE FROM aset WHERE id = ?').run(id);
    if (Number(info.changes) === 0 || !lama) return;
    catatAudit(db, {
      aksi: `ASET-DELETE ${id}`,
      alasan: `Hapus aset ${lama.kode}`,
      lama,
    });
  });
  simpan();
}
