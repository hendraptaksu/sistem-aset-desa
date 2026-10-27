// Adapter DB untuk mesin laporan murni (P0-5).
// Tugas file ini hanya mengambil baris jurnal datar (kepala + baris) dari
// SQLite; seluruh perhitungan tetap di `src/core/reports.ts`.

import type Database from 'better-sqlite3';
import { COA } from './coa.js';
import {
  getJurnalDetail,
  listJurnalLengkap,
  listTutupBuku,
  type JurnalLengkap,
} from './repository.js';
import type { JurnalJenis } from '../core/types.js';
import {
  arusKas,
  bukuBesar,
  labaRugi,
  neraca,
  neracaSaldo,
  neracaSaldoPeriode,
  type ArusKasHasil,
  type BarisJurnalSumber,
  type BukuBesarHasil,
  type LabaRugiHasil,
  type ModeNeracaSaldo,
  type NeracaHasil,
  type NeracaSaldoModeHasil,
} from '../core/reports.js';
import { tanggalLokal } from '../utils/tanggal.js';

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

// ---------------------------------------------------------------------------
// Adapter layar laporan (P1-8)
// ---------------------------------------------------------------------------

export type FilterBukuBesarDb = {
  mulai?: string;
  sampai?: string;
};

/**
 * Buku Besar satu akun untuk layar P1-8. Saldo awal tetap dihitung dari
 * jurnal sebelum `mulai`, jadi query hanya membatasi `sampai`; perhitungan
 * seluruhnya diserahkan ke fungsi murni `bukuBesar`.
 */
export function laporanBukuBesar(
  db: Database.Database,
  akunKode: string,
  filter: FilterBukuBesarDb = {},
): BukuBesarHasil {
  const akun = COA.find((a) => a.kode === akunKode);
  if (!akun) throw new Error(`Akun ${akunKode} tidak dikenal di COA.`);
  return bukuBesar(
    listBarisJurnal(db, filter.sampai ? { sampai: filter.sampai } : {}),
    akun,
    filter,
  );
}

/**
 * Neraca Saldo untuk UI/export.
 *
 * - `mode='tahun'` (default, AUD-21b): hanya P&L tahun buku berjalan
 *   (`1 Januari` s/d cut-off); laba tahun sebelumnya diringkas pada baris
 *   sintetis "Laba ditahan sebelum periode".
 * - `mode='kumulatif'`: perilaku lama, seluruh saldo s/d cut-off.
 *
 * `cutoff` opsional. Bila kosong, mode tahun memakai tanggal hari ini dan
 * mode kumulatif memakai seluruh riwayat. Pemanggil lama tanpa mode tetap
 * bekerja dan kini mendapat mode tahun yang aman.
 */
export function laporanNeracaSaldo(
  db: Database.Database,
  cutoff?: string,
  mode: ModeNeracaSaldo = 'tahun',
): NeracaSaldoModeHasil {
  const sampai = cutoff?.trim() || undefined;
  const baris = listBarisJurnal(db, sampai ? { sampai } : {});

  if (mode === 'kumulatif') {
    return { ...neracaSaldo(baris, sampai), mode: 'kumulatif' };
  }

  const akhir = sampai ?? tanggalLokal();
  const mulai = `${akhir.slice(0, 4)}-01-01`;
  return {
    ...neracaSaldoPeriode(baris, { mulai, sampai: akhir }),
    mode: 'tahun',
  };
}

/**
 * Daftar jurnal yang menyentuh satu akun (drill-down). Setiap jurnal
 * dikembalikan lengkap dengan semua barisnya, bukan hanya baris akun itu,
 * supaya modal detail bisa menampilkan sisi debit dan kredit berpasangan.
 */
export function laporanJurnalAkun(
  db: Database.Database,
  akunKode: string,
  filter: FilterBukuBesarDb = {},
): JurnalLengkap[] {
  if (!COA.some((a) => a.kode === akunKode))
    throw new Error(`Akun ${akunKode} tidak dikenal di COA.`);
  return listJurnalLengkap(db, {
    akun_kode: akunKode,
    ...(filter.mulai ? { mulai: filter.mulai } : {}),
    ...(filter.sampai ? { sampai: filter.sampai } : {}),
  });
}

/** Detail satu jurnal + semua barisnya untuk modal drill-down. */
export function laporanDetailJurnal(
  db: Database.Database,
  jurnalId: string,
): JurnalLengkap | null {
  const detail = getJurnalDetail(db, jurnalId);
  if (!detail) return null;
  const reversal = db
    .prepare('SELECT id FROM jurnal WHERE reversal_of = ? ORDER BY rowid LIMIT 1')
    .get(jurnalId) as { id: string } | undefined;
  return {
    ...detail.jurnal,
    baris: detail.baris,
    total_debit: detail.baris.reduce((s, b) => s + b.debit, 0),
    reversal_id: reversal ? String(reversal.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Adapter layar Laba Rugi, Neraca, Arus Kas (P1-9)
// ---------------------------------------------------------------------------

export type FilterPeriodeLaporanDb = {
  mulai?: string;
  sampai?: string;
};

/**
 * Laba Rugi periode. Adapter hanya mengambil baris jurnal; seluruh
 * perhitungan (termasuk akun bernominal nol) diserahkan ke `labaRugi` murni.
 */
export function laporanLabaRugi(
  db: Database.Database,
  filter: FilterPeriodeLaporanDb = {},
): LabaRugiHasil {
  return labaRugi(
    listBarisJurnal(db, filter.sampai ? { sampai: filter.sampai } : {}),
    filter,
  );
}

/**
 * Neraca per cut-off. Daftar tutup buku ikut dikirim agar laba tahun yang
 * sudah ditutup masuk `labaDitahan` dan tahun yang belum ditutup tetap
 * dilaporkan di `labaBelumDitutup` — tidak ada laba tersimpan.
 */
export function laporanNeraca(
  db: Database.Database,
  cutoff: string,
): NeracaHasil {
  return neraca(listBarisJurnal(db, { sampai: cutoff }), {
    cutoff,
    tutup: listTutupBuku(db),
  });
}

/**
 * Arus Kas periode. Query hanya dibatasi `sampai`; baris sebelum `mulai`
 * tetap diambil karena dibutuhkan untuk menghitung `saldoAwal`.
 */
export function laporanArusKas(
  db: Database.Database,
  filter: FilterPeriodeLaporanDb = {},
): ArusKasHasil {
  return arusKas(
    listBarisJurnal(db, filter.sampai ? { sampai: filter.sampai } : {}),
    filter,
  );
}
