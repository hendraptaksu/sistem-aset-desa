// Repository tipis di atas better-sqlite3. dipakai Agent A (write) & Agent B (read).
// Kunci longgar ditegakkan di sini: update/delete periode terkunci wajib alasan.

import type Database from 'better-sqlite3';
import { isPeriodeTerkunci } from '../core/ledger.js';
import { JENIS_JURNAL, tanggalKalenderValid } from '../core/posting.js';
import type { CoaTipe, PosisiNormal } from './coa.js';
import type {
  Aset,
  AuditLog,
  Jurnal,
  JurnalBaris,
  JurnalBarisInput,
  JurnalHeaderInput,
  Panjar,
  PanjarItem,
  Transaksi,
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

  const noBukti = String(header.no_bukti ?? '').trim();
  if (noBukti) {
    const dup = db
      .prepare('SELECT id FROM jurnal WHERE lower(no_bukti) = lower(?)')
      .get(noBukti) as { id: string } | undefined;
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
    // Index parsial `idx_jurnal_no_bukti` adalah penjaga terakhir bila ada
    // pemanggil yang melewati validasi aplikasi.
    if (String(e).includes('UNIQUE constraint failed: jurnal.no_bukti'))
      throw new Error(`Nomor bukti ${noBukti} sudah dipakai. Gunakan nomor bukti lain.`);
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

export function listJurnal(
  db: Database.Database,
  f: JurnalFilter = {},
): Jurnal[] {
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
  let sql = `SELECT j.* FROM jurnal j ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY j.tanggal, j.rowid`;
  if (f.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(Math.max(0, Math.trunc(f.limit)));
    if (f.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(Math.max(0, Math.trunc(f.offset)));
    }
  } else if (f.offset !== undefined) {
    sql += ' LIMIT -1 OFFSET ?';
    params.push(Math.max(0, Math.trunc(f.offset)));
  }
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToJurnal);
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

// ---------------------------------------------------------------------------
// Model single-entry lama (dihapus di P0-3; dipertahankan sampai UI pindah)
// ---------------------------------------------------------------------------

const rowToTransaksi = (r: Record<string, unknown>): Transaksi => ({
  id: String(r.id),
  tanggal: String(r.tanggal),
  keterangan: String(r.keterangan),
  akun_kas: String(r.akun_kas),
  kategori: String(r.kategori),
  masuk: Number(r.masuk),
  keluar: Number(r.keluar),
});

export function insertTransaksi(db: Database.Database, t: Transaksi): void {
  db.prepare(
    'INSERT INTO transaksi (id, tanggal, keterangan, akun_kas, kategori, masuk, keluar) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(t.id, t.tanggal, t.keterangan, t.akun_kas, t.kategori, t.masuk, t.keluar);
}

export function listTransaksi(
  db: Database.Database,
  f: { mulai?: string; sampai?: string; akun_kas?: string; kategori?: string } = {},
): Transaksi[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.mulai) { where.push('tanggal >= ?'); params.push(f.mulai); }
  if (f.sampai) { where.push('tanggal <= ?'); params.push(f.sampai); }
  if (f.akun_kas) { where.push('akun_kas = ?'); params.push(f.akun_kas); }
  if (f.kategori) { where.push('kategori = ?'); params.push(f.kategori); }
  const sql = `SELECT * FROM transaksi ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY tanggal, rowid`;
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToTransaksi);
}

export function insertPanjar(db: Database.Database, p: Panjar, items: PanjarItem[] = []): void {
  const tx = db.transaction(() => {
    db.prepare(
      'INSERT INTO panjar (id, tanggal, penerima, jumlah, akun_kas_sumber, status) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(p.id, p.tanggal, p.penerima, p.jumlah, p.akun_kas_sumber, p.status);
    const ins = db.prepare('INSERT INTO panjar_item (panjar_id, kategori_baga, nominal) VALUES (?, ?, ?)');
    for (const it of items) ins.run(p.id, it.kategori_baga, it.nominal);
  });
  tx();
}

export function listPanjar(db: Database.Database, status?: 'OPEN' | 'CLOSED'): Panjar[] {
  const sql = status
    ? 'SELECT * FROM panjar WHERE status = ? ORDER BY tanggal'
    : 'SELECT * FROM panjar ORDER BY tanggal';
  const rows = (
    status ? db.prepare(sql).all(status) : db.prepare(sql).all()
  ) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    tanggal: String(r.tanggal),
    penerima: String(r.penerima),
    jumlah: Number(r.jumlah),
    akun_kas_sumber: String(r.akun_kas_sumber),
    status: r.status as 'OPEN' | 'CLOSED',
  }));
}

export function listPanjarItems(db: Database.Database, panjarId: string): PanjarItem[] {
  const rows = db.prepare('SELECT * FROM panjar_item WHERE panjar_id = ?').all(panjarId) as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({
    panjar_id: String(r.panjar_id),
    kategori_baga: String(r.kategori_baga),
    nominal: Number(r.nominal),
  }));
}

export function closePanjar(db: Database.Database, id: string, closeRows: Transaksi[]): void {
  const tx = db.transaction(() => {
    db.prepare("UPDATE panjar SET status = 'CLOSED' WHERE id = ?").run(id);
    for (const t of closeRows) insertTransaksi(db, t);
  });
  tx();
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

export function insertAuditLog(db: Database.Database, a: AuditLog): void {
  db.prepare('INSERT INTO audit_log (id, tanggal, aksi, alasan, data_lama_json) VALUES (?, ?, ?, ?, ?)').run(
    a.id,
    a.tanggal,
    a.aksi,
    a.alasan,
    a.data_lama_json,
  );
}

export function listAuditLog(db: Database.Database, limit = 200): AuditLog[] {
  return db
    .prepare('SELECT * FROM audit_log ORDER BY tanggal DESC LIMIT ?')
    .all(limit) as AuditLog[];
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
  db.prepare(
    `INSERT INTO aset (id, kode, nama, jenis, luas_m2, lokasi, status_hukum, tahun_perolehan,
      asal_usul, kondisi, keterangan, nilai_sen, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id, a.kode, a.nama, a.jenis, a.luas_m2, a.lokasi, a.status_hukum, a.tahun_perolehan,
    a.asal_usul, a.kondisi, a.keterangan, a.nilai_sen, a.created_at, a.updated_at,
  );
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
  db.prepare(
    `UPDATE aset SET kode = ?, nama = ?, jenis = ?, luas_m2 = ?, lokasi = ?, status_hukum = ?,
      tahun_perolehan = ?, asal_usul = ?, kondisi = ?, keterangan = ?, nilai_sen = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    a.kode, a.nama, a.jenis, a.luas_m2, a.lokasi, a.status_hukum, a.tahun_perolehan,
    a.asal_usul, a.kondisi, a.keterangan, a.nilai_sen, a.updated_at, a.id,
  );
}

export function deleteAset(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM aset WHERE id = ?').run(id);
}
