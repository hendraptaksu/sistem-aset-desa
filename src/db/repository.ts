// Repository tipis di atas better-sqlite3. dipakai Agent A (write) & Agent B (read).
// Kunci longgar ditegakkan di sini: update/delete periode terkunci wajib alasan.

import type Database from 'better-sqlite3';
import { isPeriodeTerkunci } from '../core/ledger.js';
import type { AuditLog, Panjar, PanjarItem, Transaksi, TutupBuku } from '../core/types.js';

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
  return db.prepare('SELECT * FROM tutup_buku ORDER BY tahun').all() as TutupBuku[];
}

export function insertTutupBuku(db: Database.Database, t: TutupBuku): void {
  db.prepare('INSERT OR REPLACE INTO tutup_buku (tahun, laba, created_at, backup_path) VALUES (?, ?, ?, ?)').run(
    t.tahun,
    t.laba,
    t.created_at,
    t.backup_path,
  );
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
