// Kemampuan koreksi jurnal (T2.1/T2.2).
//
// Modul ini sengaja hanya bergantung pada Database + konstanta/pesan core,
// bukan `repository.ts`. Dengan begitu `repository.ts` bisa memakai helper ini
// untuk mengisi capability flag DTO tanpa impor melingkar
// (repository -> reversal -> repository).

import type Database from 'better-sqlite3';
import {
  PESAN_REVERSAL,
  PESAN_REVERSAL_SALDO_AWAL,
} from '../core/reversal.js';
import type { Jurnal } from '../core/types.js';

/** Cukup `{ id }`; `jenis` boleh ikut tetapi selalu diabaikan (dibaca ulang dari DB). */
export type JurnalUntukKoreksi = Pick<Jurnal, 'id'> &
  Partial<Pick<Jurnal, 'jenis'>>;

/**
 * Hasil capability untuk UI. `alasan` null berarti kedua aksi boleh; selain
 * itu berisi pesan Indonesia yang siap ditampilkan sebagai tooltip.
 */
export type KemampuanKoreksiJurnal = {
  bisaDibalik: boolean;
  bisaDikoreksi: boolean;
  alasan: string | null;
};

/** Pesan saat jurnal merupakan bagian dari dokumen panjar (AUD-07). */
export const PESAN_REVERSAL_PANJAR =
  'Jurnal ini terhubung ke dokumen panjar. Reversal dari Jurnal Umum diblokir ' +
  'agar status panjar tidak basi. Gunakan modul Panjar.';

export const PESAN_REVERSAL_PINJAMAN =
  'Jurnal ini terhubung ke pinjaman. Gunakan Batalkan catatan pembayaran ' +
  'atau Batalkan catatan pencairan di menu Pinjaman LPD, lalu input ulang.';

/**
 * Pesan capability (T2.1). Isinya sengaja memakai pesan jalur reversal yang
 * sudah ada agar UI dan backend tidak memberi alasan yang berbeda.
 */
export const PESAN_KOREKSI_JURNAL = {
  tidakDitemukan: PESAN_REVERSAL.tidakDitemukan,
  jurnalBalik: PESAN_REVERSAL.asliBalik,
  sudahDikoreksi: PESAN_REVERSAL.sudahDibalik,
  saldoAwal: PESAN_REVERSAL_SALDO_AWAL,
  panjar: PESAN_REVERSAL_PANJAR,
  pinjaman: PESAN_REVERSAL_PINJAMAN,
} as const;

type JurnalRingkas = Pick<Jurnal, 'id' | 'jenis' | 'reversal_of'>;

/** Baca ulang dari DB: data `jenis` dari renderer tidak boleh dipercaya. */
function bacaJurnal(
  db: Database.Database,
  id: string,
): JurnalRingkas | null {
  const row = db
    .prepare('SELECT id, jenis, reversal_of FROM jurnal WHERE id = ?')
    .get(id) as
    | { id: string; jenis: Jurnal['jenis']; reversal_of: string | null }
    | undefined;
  if (!row) return null;
  return {
    id: String(row.id),
    jenis: row.jenis,
    reversal_of: row.reversal_of ? String(row.reversal_of) : null,
  };
}

/** Jurnal sudah punya balik? */
function punyaReversal(db: Database.Database, idJurnal: string): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM jurnal WHERE reversal_of = ? LIMIT 1')
      .get(idJurnal),
  );
}

/**
 * Jurnal serah/pertanggungjawaban panjar tidak boleh direversal dari Jurnal
 * Umum: status `panjar` akan basi (mis. tetap CLOSED padahal 1040 bersaldo).
 */
export function terhubungPanjar(
  db: Database.Database,
  idJurnal: string,
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM panjar
         WHERE jurnal_open_id = ? OR jurnal_close_id = ?
         LIMIT 1`,
      )
      .get(idJurnal, idJurnal),
  );
}

/**
 * Versi pemeriksaan panjar untuk capability. `jurnal_batal_id` ikut diperiksa
 * agar jurnal pembatalan panjar tidak pernah ditawarkan sebagai jurnal biasa.
 * Fungsi terpisah dipakai supaya pesan `reverseJurnal` publik untuk jurnal
 * batal (yang memang REVERSAL) tidak berubah (DB-21).
 */
export function terhubungPanjarTermasukBatal(
  db: Database.Database,
  idJurnal: string,
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM panjar
         WHERE jurnal_open_id = ? OR jurnal_close_id = ? OR jurnal_batal_id = ?
         LIMIT 1`,
      )
      .get(idJurnal, idJurnal, idJurnal),
  );
}

/**
 * Relasi tabel adalah satu-satunya sumber kebenaran pinjaman (T2.1/T2.3).
 * Jangan menebak dari `jenis === 'HUTANG'` atau akun 2050: pembayaran bunga
 * saja berjenis HUTANG tanpa baris 2050, tetapi tetap milik modul Pinjaman.
 */
export function terhubungPinjaman(
  db: Database.Database,
  idJurnal: string,
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM pinjaman WHERE jurnal_pencairan_id = ?
         UNION ALL SELECT 1 FROM pinjaman_bayar WHERE jurnal_id = ?
         LIMIT 1`,
      )
      .get(idJurnal, idJurnal),
  );
}

/**
 * Satu sumber aturan untuk UI/IPC — jangan menebak dari `jenis` dan akun.
 *
 * Parameter boleh objek ringkas `{ id, jenis }` atau `Jurnal`. Nilai `jenis`
 * dari renderer selalu diabaikan: jurnal dibaca ulang dari DB agar data render
 * yang basi/dimanipulasi tidak membuka tombol yang pasti ditolak backend.
 *
 * `bisaDibalik` dan `bisaDikoreksi` memakai aturan yang sama untuk sekarang:
 * koreksi isi ulang juga menulis jurnal balik (`koreksiDanIsiUlang`), jadi
 * keduanya selalu ditolak/diizinkan bersama. Bila nanti ada jalur koreksi yang
 * tidak memerlukan reversal, pisahkan aturannya di sini — bukan di UI.
 */
export function kemampuanKoreksiJurnal(
  db: Database.Database,
  jurnal: JurnalUntukKoreksi | null | undefined,
): KemampuanKoreksiJurnal {
  const tolak = (alasan: string): KemampuanKoreksiJurnal => ({
    bisaDibalik: false,
    bisaDikoreksi: false,
    alasan,
  });

  const id = String(jurnal?.id ?? '').trim();
  const asli = id ? bacaJurnal(db, id) : null;
  if (!asli) return tolak(PESAN_KOREKSI_JURNAL.tidakDitemukan);

  // Reversal tidak boleh dibalik lagi, termasuk jurnal batal panjar/pinjaman.
  if (asli.jenis === 'REVERSAL' || asli.reversal_of)
    return tolak(PESAN_KOREKSI_JURNAL.jurnalBalik);
  if (punyaReversal(db, asli.id))
    return tolak(PESAN_KOREKSI_JURNAL.sudahDikoreksi);

  // Subledger: koreksi wajib lewat modul asalnya agar status dokumen tidak basi.
  if (terhubungPanjarTermasukBatal(db, asli.id))
    return tolak(PESAN_KOREKSI_JURNAL.panjar);
  if (terhubungPinjaman(db, asli.id))
    return tolak(PESAN_KOREKSI_JURNAL.pinjaman);

  // Saldo awal hanya boleh dikoreksi lewat wizard koreksi saldo awal (T1.8).
  if (asli.jenis === 'SALDO_AWAL')
    return tolak(PESAN_KOREKSI_JURNAL.saldoAwal);

  return { bisaDibalik: true, bisaDikoreksi: true, alasan: null };
}
