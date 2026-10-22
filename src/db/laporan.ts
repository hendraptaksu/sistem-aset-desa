// Adapter DB untuk mesin laporan murni (P0-5).
// Tugas file ini hanya mengambil baris jurnal datar (kepala + baris) dari
// SQLite; seluruh perhitungan tetap di `src/core/reports.ts`.

import type Database from 'better-sqlite3';
import type { JurnalJenis } from '../core/types.js';
import type { BarisJurnalSumber } from '../core/reports.js';

export type FilterBarisJurnal = {
  mulai?: string;
  sampai?: string;
  /** Hanya baris milik akun ini. */
  akun_kode?: string;
  jenis?: JurnalJenis;
  grup_id?: string;
  jurnal_id?: string;
};

type RowBaris = {
  jurnal_id: string;
  baris_id: number;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  jenis: string;
  grup_id: string;
  reversal_of: string | null;
  akun_kode: string;
  debit: number;
  kredit: number;
  keterangan_baris: string;
};

/**
 * Ambil semua baris jurnal sebagai data datar untuk laporan, urut tanggal
 * lalu urutan jurnal/baris. Tanpa filter = seluruh riwayat.
 */
export function listBarisJurnal(
  db: Database.Database,
  f: FilterBarisJurnal = {},
): BarisJurnalSumber[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.mulai) {
    where.push('j.tanggal >= ?');
    params.push(f.mulai);
  }
  if (f.sampai) {
    where.push('j.tanggal <= ?');
    params.push(f.sampai);
  }
  if (f.akun_kode) {
    where.push('b.akun_kode = ?');
    params.push(f.akun_kode);
  }
  if (f.jenis) {
    where.push('j.jenis = ?');
    params.push(f.jenis);
  }
  if (f.grup_id) {
    where.push('j.grup_id = ?');
    params.push(f.grup_id);
  }
  if (f.jurnal_id) {
    where.push('j.id = ?');
    params.push(f.jurnal_id);
  }

  const sql = `
    SELECT
      j.id AS jurnal_id,
      b.id AS baris_id,
      j.tanggal AS tanggal,
      j.no_bukti AS no_bukti,
      j.keterangan AS keterangan,
      j.jenis AS jenis,
      j.grup_id AS grup_id,
      j.reversal_of AS reversal_of,
      b.akun_kode AS akun_kode,
      b.debit AS debit,
      b.kredit AS kredit,
      b.keterangan AS keterangan_baris
    FROM jurnal_baris b
    JOIN jurnal j ON j.id = b.jurnal_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY j.tanggal, j.rowid, b.id
  `;

  const rows = db.prepare(sql).all(...params) as RowBaris[];
  return rows.map((r) => ({
    jurnal_id: String(r.jurnal_id),
    baris_id: Number(r.baris_id),
    tanggal: String(r.tanggal),
    no_bukti: String(r.no_bukti ?? ''),
    keterangan: String(r.keterangan ?? ''),
    keterangan_baris: String(r.keterangan_baris ?? ''),
    jenis: String(r.jenis) as JurnalJenis,
    grup_id: String(r.grup_id ?? ''),
    reversal_of: r.reversal_of ?? null,
    akun_kode: String(r.akun_kode),
    debit: Number(r.debit),
    kredit: Number(r.kredit),
  }));
}

/** Baris satu jurnal, urut sesuai input (untuk detail/drill-down). */
export function listBarisSatuJurnal(
  db: Database.Database,
  jurnalId: string,
): BarisJurnalSumber[] {
  return listBarisJurnal(db, { jurnal_id: jurnalId });
}
