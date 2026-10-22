// Jembatan posting layer murni (core/posting.ts) dengan database.
// Semua jalur simpan jurnal untuk aplikasi sebaiknya lewat `postingJurnal()`,
// supaya aturan bisnis tidak tersebar di UI/IPC (P0-4).

import type Database from 'better-sqlite3';
import { KAS_KODES, isAkunKas } from './coa.js';
import { insertAuditLog, insertJurnal, listAkun, listTutupBuku } from './repository.js';
import {
  validasiJurnal,
  type HasilValidasiJurnal,
  type JurnalInput,
  type PostingContext,
} from '../core/posting.js';
import type { AuditLog, Jurnal } from '../core/types.js';

export type OpsiPosting = {
  /** Operator sudah melihat peringatan (mis. kas minus) dan memilih lanjut. */
  konfirmasiPeringatan?: boolean;
  /**
   * Baris audit yang ditulis ATOMIK bersama jurnal. Dipakai reversal (P0-6)
   * dan nanti operasi lain yang wajib punya jejak audit (P0-9).
   */
  audit?: AuditLog[];
};

export type HasilPosting = HasilValidasiJurnal & {
  tersimpan: boolean;
  jurnal?: Jurnal;
};

/** Ambil konteks DB yang dibutuhkan validator murni. */
export function buatKonteksPosting(db: Database.Database, header: JurnalInput['header']): PostingContext {
  const noBukti = String(header.no_bukti ?? '').trim();
  const noBuktiTerpakai = noBukti
    ? (db
        .prepare('SELECT no_bukti FROM jurnal WHERE lower(no_bukti) = lower(?)')
        .all(noBukti) as { no_bukti: string }[]).map((r) => String(r.no_bukti))
    : [];

  const saldoKas: Record<string, number> = {};
  for (const kode of KAS_KODES) saldoKas[kode] = 0;
  const saldoRows = db
    .prepare(
      'SELECT akun_kode, COALESCE(SUM(debit - kredit), 0) AS saldo FROM jurnal_baris GROUP BY akun_kode',
    )
    .all() as { akun_kode: string; saldo: number }[];
  for (const r of saldoRows) {
    if (isAkunKas(r.akun_kode)) saldoKas[String(r.akun_kode)] = Number(r.saldo);
  }

  return {
    akun: listAkun(db).map((a) => ({
      kode: a.kode,
      nama: a.nama,
      tipe: a.tipe,
      posisi_normal: a.posisi_normal,
      aktif: a.aktif,
    })),
    tutupBuku: listTutupBuku(db).map((t) => ({ tahun: Number(t.tahun) })),
    noBuktiTerpakai,
    saldoKas,
  };
}

/** Validasi jurnal dengan konteks dari DB (tanpa menyimpan). */
export function validasiJurnalDb(
  db: Database.Database,
  input: JurnalInput,
): HasilValidasiJurnal {
  return validasiJurnal(input, buatKonteksPosting(db, input.header));
}

/**
 * Validasi + simpan jurnal dalam satu pintu.
 * - Error -> `tersimpan: false`, tidak ada baris yang ditulis.
 * - Peringatan + belum dikonfirmasi -> `tersimpan: false`, `perluKonfirmasi: true`.
 * - Peringatan + `konfirmasiPeringatan` -> tetap disimpan.
 */
export function postingJurnal(
  db: Database.Database,
  input: JurnalInput,
  opsi: OpsiPosting = {},
): HasilPosting {
  const hasil = validasiJurnalDb(db, input);
  if (hasil.errors.length > 0) return { ...hasil, tersimpan: false };
  if (hasil.peringatan.length > 0 && !opsi.konfirmasiPeringatan)
    return { ...hasil, tersimpan: false };

  try {
    const simpan = db.transaction(() => {
      const jurnal = insertJurnal(db, input.header, input.baris);
      for (const a of opsi.audit ?? []) insertAuditLog(db, a);
      return jurnal;
    });
    const jurnal = simpan();
    return { ...hasil, tersimpan: true, jurnal };
  } catch (e) {
    return {
      ...hasil,
      tersimpan: false,
      errors: [...hasil.errors, e instanceof Error ? e.message : String(e)],
    };
  }
}
