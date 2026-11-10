// T-A00 — pembacaan penunjuk pembukaan/cut-over resmi (baca-saja).
//
// Sumber kebenaran:
// - `pengaturan.saldo_awal_aktif_id` menunjuk jurnal pembukaan aktif;
// - `pengaturan.cutover_tanggal` adalah tanggal cut-over resmi laporan.
//
// `akuntansi_tanggal_mulai` tetap dibaca sebagai fallback kompatibilitas data
// lama, tetapi laporan baru wajib memakai `cutover_tanggal`. Modul ini tidak
// pernah menulis ke DB dan tidak memakai `MIN(tanggal)` jurnal SALDO_AWAL.

import type Database from 'better-sqlite3';
import { tanggalKalenderValid } from '../core/posting.js';
import type { JurnalPeran } from '../core/types.js';
import {
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  KUNCI_CUTOVER_TANGGAL,
  KUNCI_SALDO_AWAL_AKTIF_ID,
  getPengaturan,
} from './repository.js';

export type PembukaanAktif = {
  id: string;
  tanggal: string;
  peran: JurnalPeran;
};

/**
 * Jurnal pembukaan aktif dari `saldo_awal_aktif_id`. Pointer kosong, bukan
 * tanggal valid, atau tidak menunjuk jurnal yang ada menghasilkan `null`.
 */
export function getPembukaanAktif(
  db: Database.Database,
): PembukaanAktif | null {
  const id = String(getPengaturan(db, KUNCI_SALDO_AWAL_AKTIF_ID) ?? '').trim();
  if (!id) return null;
  const row = db
    .prepare('SELECT id, tanggal, peran FROM jurnal WHERE id = ?')
    .get(id) as
    | { id: string; tanggal: string; peran: string }
    | undefined;
  if (!row) return null;
  const tanggal = String(row.tanggal ?? '').trim();
  if (!tanggalKalenderValid(tanggal)) return null;
  return {
    id: String(row.id),
    tanggal,
    peran: String(row.peran ?? 'NORMAL') as JurnalPeran,
  };
}

function cutoverValid(nilai: string | null | undefined): string | null {
  const teks = String(nilai ?? '').trim();
  if (!teks || !tanggalKalenderValid(teks)) return null;
  return teks;
}

/**
 * Tanggal cut-over resmi. Prioritaskan `cutover_tanggal`; bila kosong/tidak
 * valid, fallback ke `akuntansi_tanggal_mulai` agar data lama tetap terbaca.
 * Tidak ada inferensi dari tanggal jurnal SALDO_AWAL.
 */
export function getCutoverTanggal(db: Database.Database): string | null {
  const primer = cutoverValid(getPengaturan(db, KUNCI_CUTOVER_TANGGAL));
  if (primer) return primer;
  return cutoverValid(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI));
}

/** Apakah cut-over berasal dari kunci resmi, bukan fallback lama. */
export function getCutoverEksplisit(db: Database.Database): {
  tanggal: string | null;
  eksplisit: boolean;
} {
  const primer = cutoverValid(getPengaturan(db, KUNCI_CUTOVER_TANGGAL));
  return {
    tanggal: primer ?? cutoverValid(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)),
    eksplisit: primer !== null,
  };
}
