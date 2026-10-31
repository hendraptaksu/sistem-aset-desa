// DB-19: adapter baca-saja rekonsiliasi panjar.
//
// Dipakai DUA jalur dengan aturan yang sama:
// 1. `closePanjarV2` setelah item tersimpan di dalam transaksi (guard drift);
// 2. `auditIntegritas` untuk panjar CLOSED yang sudah ada di DB.
//
// Tidak menulis apa pun. `null` berarti panjar tidak ditemukan atau belum punya
// jurnal close; pemanggil yang memutuskan apakah itu temuan.

import type Database from 'better-sqlite3';
import {
  rekonsiliasiPanjar,
  type BarisRekonsiliasiPanjar,
  type HasilRekonsiliasiPanjar,
  type ItemRekonsiliasiPanjar,
} from '../core/rekonsiliasiPanjar.js';

type RowPanjarClose = {
  jurnal_close_id: string | null;
};

/**
 * Rekonsiliasi item tersimpan sebuah panjar terhadap jurnal close-nya.
 * Hanya debit akun BEBAN yang dibandingkan; debit kas sisa dan sisi kredit
 * (1040/kas) memang bukan realisasi belanja.
 */
export function rekonsiliasiPanjarTersimpan(
  db: Database.Database,
  panjarId: string,
): HasilRekonsiliasiPanjar | null {
  const panjar = db
    .prepare('SELECT jurnal_close_id FROM panjar WHERE id = ?')
    .get(panjarId) as RowPanjarClose | undefined;
  if (!panjar || !panjar.jurnal_close_id) return null;

  const items = db
    .prepare(
      `SELECT kategori_baga AS akun, nominal
         FROM panjar_item
        WHERE panjar_id = ?
        ORDER BY id`,
    )
    .all(panjarId) as ItemRekonsiliasiPanjar[];

  const baris = db
    .prepare(
      `SELECT akun_kode, debit
         FROM jurnal_baris
        WHERE jurnal_id = ?
        ORDER BY id`,
    )
    .all(panjar.jurnal_close_id) as BarisRekonsiliasiPanjar[];

  const kodeBeban = new Set(
    (
      db
        .prepare("SELECT kode FROM akun WHERE tipe = 'BEBAN' ORDER BY kode")
        .all() as { kode: string }[]
    ).map((a) => a.kode),
  );

  return rekonsiliasiPanjar(items, baris, kodeBeban);
}
