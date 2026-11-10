// Koreksi jurnal (P0-6) — fungsi murni tanpa DB/Electron.
//
// Prinsip arah akuntansi: jurnal yang sudah tersimpan TIDAK PERNAH diedit atau
// dihapus. Koreksi dilakukan dengan membuat jurnal balik (reversal) yang
// menukar debit/kredit, lalu (bila perlu) mengisi ulang jurnal yang benar.
//
// Fungsi di file ini hanya menyusun rencana reversal; validasi keseimbangan,
// periode terkunci, nomor bukti, dan penyimpanan tetap dilakukan posting layer.

import { tanggalKalenderValid, type JurnalInput } from './posting.js';
import type { Jurnal, JurnalBaris, JurnalJenis } from './types.js';

export const ALASAN_REVERSAL_MIN = 5;

/** Pesan aturan jenis pengganti (T-A02). */
export const PESAN_JENIS_PENGGANTI = {
  reversal:
    'Jurnal pengganti tidak boleh berjenis REVERSAL. Jenis jurnal tidak boleh diubah saat koreksi.',
  saldoAwal: (asli: JurnalJenis): string =>
    `Jurnal pengganti tidak boleh berjenis SALDO_AWAL bila jurnal asli berjenis ${asli}. ` +
    'Jenis jurnal tidak boleh diubah saat koreksi.',
  beda: (asli: JurnalJenis, pengganti: JurnalJenis): string =>
    `Jenis jurnal tidak boleh diubah saat koreksi: jurnal asli berjenis ${asli}, ` +
    `jurnal pengganti berjenis ${pengganti}. Gunakan jenis ${asli}.`,
} as const;

export type HasilJenisPenggantiSah = {
  boleh: boolean;
  /** Jenis final yang wajib dipakai jurnal pengganti. */
  jenis: JurnalJenis;
  pesan?: string;
};

/**
 * T-A02: jenis jurnal pengganti tidak boleh mengubah jenis dokumen aslinya.
 *
 * - `REVERSAL` selalu ditolak (jurnal balik dibuat terpisah).
 * - `SALDO_AWAL` hanya boleh dikoreksi lewat wizard saldo awal; hasil akhirnya
 *   selalu `UMUM`. Jalur generik tetap menolak jurnal asli `SALDO_AWAL` lebih
 *   awal di `rencanaUntuk()`.
 * - Selain itu pengganti wajib sama dengan jenis asli.
 * - `pengganti` kosong/null mewarisi jenis asli, sehingga default DB `UMUM`
 *   tidak pernah mengambil alih.
 */
export function jenisPenggantiSah(
  asli: JurnalJenis,
  pengganti?: JurnalJenis | null,
): HasilJenisPenggantiSah {
  const diminta = pengganti ?? asli;

  if (diminta === 'REVERSAL')
    return { boleh: false, jenis: asli, pesan: PESAN_JENIS_PENGGANTI.reversal };

  if (asli === 'SALDO_AWAL') {
    if (diminta !== 'SALDO_AWAL' && diminta !== 'UMUM')
      return { boleh: false, jenis: asli, pesan: PESAN_JENIS_PENGGANTI.beda(asli, diminta) };
    // Wizard koreksi saldo awal selalu menulis pengganti UMUM.
    return { boleh: true, jenis: 'UMUM' };
  }

  if (diminta === 'SALDO_AWAL')
    return { boleh: false, jenis: asli, pesan: PESAN_JENIS_PENGGANTI.saldoAwal(asli) };

  if (diminta !== asli)
    return { boleh: false, jenis: asli, pesan: PESAN_JENIS_PENGGANTI.beda(asli, diminta) };

  return { boleh: true, jenis: asli };
}

/**
 * T1.5: saldo awal tidak boleh dibalik dari jalur umum. Saldo awal hanya
 * dikoreksi lewat alur koreksi saldo awal agar wizard dan unique index tetap
 * konsisten.
 */
export const PESAN_REVERSAL_SALDO_AWAL =
  'Jurnal saldo awal tidak bisa dibalik dari Jurnal Umum. Saldo awal hanya boleh dikoreksi lewat alur koreksi saldo awal.';

export type RencanaReversalInput = {
  /** Jurnal asli; null bila id tidak ditemukan. */
  jurnal: Jurnal | null;
  baris: readonly JurnalBaris[];
  /** Jurnal balik yang sudah ada untuk jurnal ini (untuk menolak reversal ganda). */
  reversalAda?: readonly Pick<Jurnal, 'id'>[];
  /** ID jurnal balik yang akan dibuat. */
  id: string;
  /** Tanggal jurnal balik (YYYY-MM-DD). */
  tanggal: string;
  /** Alasan koreksi; wajib dan juga dipakai untuk kunci periode. */
  alasan: string;
  /** Nomor bukti jurnal balik (opsional, wajib unik bila diisi). */
  no_bukti?: string;
};

export type RencanaReversal = {
  boleh: boolean;
  errors: string[];
  /** Terisi bila `boleh`; siap divalidasi/disimpan lewat posting layer. */
  input?: JurnalInput;
};

/** Pesan standar agar UI & test memakai bahasa yang sama. */
export const PESAN_REVERSAL = {
  tidakDitemukan: 'Jurnal yang mau dikoreksi tidak ditemukan.',
  idKosong: 'ID jurnal balik wajib diisi.',
  alasanPendek: `Alasan koreksi wajib diisi minimal ${ALASAN_REVERSAL_MIN} karakter.`,
  tanggalSalah: 'Tanggal jurnal balik tidak valid (YYYY-MM-DD).',
  asliBalik: 'Jurnal ini adalah jurnal balik. Jurnal balik tidak boleh dikoreksi dengan balik lagi.',
  sudahDibalik: 'Jurnal ini sudah pernah dikoreksi (sudah ada jurnal baliknya).',
  barisKurang: 'Jurnal asli tidak punya baris debit/kredit yang cukup untuk dibalik.',
} as const;

/**
 * Susun jurnal balik: tukar debit/kredit semua baris, pakai `grup_id` yang
 * sama, set `reversal_of`, dan beri keterangan `KOREKSI: ...`.
 *
 * Aturan:
 * - alasan wajib >= 5 karakter;
 * - jurnal yang merupakan reversal tidak boleh dibalik lagi;
 * - jurnal yang sudah punya reversal ditolak (cegah reversal ganda).
 */
export function rencanaReversal(input: RencanaReversalInput): RencanaReversal {
  const errors: string[] = [];
  const alasan = String(input.alasan ?? '').trim();
  const id = String(input.id ?? '').trim();
  const noBukti = String(input.no_bukti ?? '').trim();

  if (!input.jurnal) errors.push(PESAN_REVERSAL.tidakDitemukan);
  if (!id) errors.push(PESAN_REVERSAL.idKosong);
  if (alasan.length < ALASAN_REVERSAL_MIN) errors.push(PESAN_REVERSAL.alasanPendek);
  if (!tanggalKalenderValid(input.tanggal)) errors.push(PESAN_REVERSAL.tanggalSalah);

  const jurnal = input.jurnal;
  if (jurnal) {
    if (jurnal.reversal_of) errors.push(PESAN_REVERSAL.asliBalik);
    if ((input.reversalAda ?? []).length > 0) errors.push(PESAN_REVERSAL.sudahDibalik);
    if (input.baris.length < 2) errors.push(PESAN_REVERSAL.barisKurang);
  }

  if (errors.length > 0) return { boleh: false, errors };

  const asli = jurnal!;
  const baris = input.baris.map((b) => ({
    akun_kode: b.akun_kode,
    debit: b.kredit,
    kredit: b.debit,
    keterangan: b.keterangan,
  }));

  return {
    boleh: true,
    errors: [],
    input: {
      header: {
        id,
        tanggal: input.tanggal,
        no_bukti: noBukti,
        keterangan: `KOREKSI: ${asli.keterangan} — ${alasan}`,
        jenis: 'REVERSAL',
        grup_id: asli.grup_id,
        reversal_of: asli.id,
      },
      baris,
      alasan,
    },
  };
}
