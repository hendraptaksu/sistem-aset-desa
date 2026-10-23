// Logika murni rekonsiliasi bank (P2-2) — tanpa DB/Electron.
//
// Yang disimpan hanya saldo menurut rekening koran. Saldo buku, selisih, dan
// daftar mutasi selalu dihitung ulang dari jurnal (core/reports.ts), sehingga
// koreksi jurnal tidak pernah meninggalkan angka rekonsiliasi yang basi.

import { COA, isAkunKas, type Coa, type PosisiNormal } from '../db/coa.js';
import { bukuBesar, type BarisJurnalSumber } from './reports.js';
import { tanggalKalenderValid } from './posting.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../utils/pesanError.js';

export type StatusRekonsiliasi = 'COCOK' | 'LEBIH' | 'KURANG';

/** Label operator awam; `LEBIH`/`KURANG` selalu dibaca dari sisi rekening koran. */
export const LABEL_STATUS_REKONSILIASI: Record<StatusRekonsiliasi, string> = {
  COCOK: 'Cocok',
  LEBIH: 'Lebih',
  KURANG: 'Kurang',
};

export type HasilHitungRekonsiliasi = {
  saldoBank: number;
  saldoBuku: number;
  /** saldoBank − saldoBuku. Positif = uang di bank lebih dari catatan buku. */
  selisih: number;
  status: StatusRekonsiliasi;
  cocok: boolean;
};

/**
 * Bandingkan saldo menurut rekening koran dengan saldo buku.
 * Nominal selalu integer SEN; saldo buku boleh negatif (mis. kas minus),
 * sedangkan saldo bank divalidasi ≥ 0 saat input.
 */
export function hitungRekonsiliasi(input: {
  saldoBank: number;
  saldoBuku: number;
}): HasilHitungRekonsiliasi {
  const { saldoBank, saldoBuku } = input;
  if (!Number.isSafeInteger(saldoBank))
    throw new Error('Saldo bank harus bilangan bulat (satuan sen).');
  if (!Number.isSafeInteger(saldoBuku))
    throw new Error('Saldo buku harus bilangan bulat (satuan sen).');

  const selisih = saldoBank - saldoBuku;
  const status: StatusRekonsiliasi =
    selisih === 0 ? 'COCOK' : selisih > 0 ? 'LEBIH' : 'KURANG';
  return {
    saldoBank,
    saldoBuku,
    selisih,
    status,
    cocok: selisih === 0,
  };
}

// ---------------------------------------------------------------------------
// Validasi input
// ---------------------------------------------------------------------------

/** Akun dari master DB (boleh membawa flag `aktif`). */
export type AkunRekonsiliasi = Coa & { aktif?: boolean };

export type InputRekonsiliasi = {
  akun_kode: string;
  tanggal: string;
  /** Saldo menurut rekening koran, integer SEN, ≥ 0. */
  saldo_bank: number;
  catatan: string;
};

export type HasilNormalisasiRekonsiliasi =
  | { ok: true; input: InputRekonsiliasi }
  | { ok: false; error: string };

const objek = (nilai: unknown): nilai is Record<string, unknown> =>
  typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);

/**
 * Normalisasi + validasi input rekonsiliasi. Akun wajib ada di master dan
 * termasuk kas/bank (`isAkunKas`), sehingga 1040 Uang Panjar dan 1050 Piutang
 * tidak bisa dipakai sebagai rekening bank.
 */
export function normalisasiRekonsiliasi(
  nilai: unknown,
  daftarAkun: readonly AkunRekonsiliasi[] = COA,
): HasilNormalisasiRekonsiliasi {
  if (!objek(nilai))
    return { ok: false, error: 'Data rekonsiliasi bank tidak lengkap.' };

  if (typeof nilai.akun_kode !== 'string' || !nilai.akun_kode.trim())
    return { ok: false, error: 'Akun kas/bank wajib dipilih.' };
  const akunKode = nilai.akun_kode.trim();
  if (akunKode.length > 20)
    return { ok: false, error: 'Kode akun terlalu panjang.' };

  const akun = daftarAkun.find((a) => a.kode === akunKode);
  if (!akun) return { ok: false, error: `Akun ${akunKode} tidak dikenal.` };
  if (akun.aktif === false)
    return { ok: false, error: `Akun ${akunKode} sudah tidak aktif.` };
  if (!isAkunKas(akunKode))
    return {
      ok: false,
      error: `Akun ${akunKode} bukan akun kas/bank. Rekonsiliasi hanya untuk akun kas/bank.`,
    };

  if (typeof nilai.tanggal !== 'string' || !nilai.tanggal.trim())
    return { ok: false, error: 'Tanggal rekonsiliasi wajib diisi.' };
  const tanggal = nilai.tanggal.trim();
  if (!tanggalKalenderValid(tanggal))
    return { ok: false, error: PESAN_TANGGAL_TIDAK_VALID };

  if (
    typeof nilai.saldo_bank !== 'number' ||
    !Number.isSafeInteger(nilai.saldo_bank) ||
    nilai.saldo_bank < 0
  )
    return {
      ok: false,
      error: 'Saldo menurut rekening koran harus bilangan bulat ≥ 0 (satuan sen).',
    };

  let catatan = '';
  if (nilai.catatan !== undefined && nilai.catatan !== null) {
    if (typeof nilai.catatan !== 'string')
      return { ok: false, error: 'Catatan rekonsiliasi tidak valid.' };
    catatan = nilai.catatan.trim();
    if (catatan.length > 1000)
      return { ok: false, error: 'Catatan rekonsiliasi maks. 1000 karakter.' };
  }

  return {
    ok: true,
    input: { akun_kode: akunKode, tanggal, saldo_bank: nilai.saldo_bank, catatan },
  };
}

// ---------------------------------------------------------------------------
// Mutasi jurnal pada rentang rekonsiliasi
// ---------------------------------------------------------------------------

export type OpsiMutasiRekonsiliasi = {
  mulai?: string;
  sampai?: string;
};

export type MutasiRekonsiliasiBaris = {
  jurnal_id: string;
  baris_id: number | null;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  debit: number;
  kredit: number;
  /** Saldo berjalan (positif = posisi normal akun). */
  saldo: number;
  posisi: PosisiNormal | null;
};

export type RingkasanMutasiRekonsiliasi = {
  kode: string;
  nama: string;
  posisi_normal: PosisiNormal;
  mulai?: string;
  sampai?: string;
  saldoAwal: number;
  rows: MutasiRekonsiliasiBaris[];
  totalDebit: number;
  totalKredit: number;
  /** saldoAkhir − saldoAwal; sama dengan jumlah mutasi bersih pada rentang. */
  totalMutasi: number;
  saldoAkhir: number;
};

/**
 * Daftar mutasi satu akun pada rentang tanggal, diambil dari mesin Buku Besar.
 * `saldoAwal` adalah saldo sebelum `mulai`, sehingga selalu berlaku:
 * `saldoAkhir − saldoAwal = totalMutasi` (mutasi bersih dalam rentang).
 */
export function ringkasMutasiRekonsiliasi(
  baris: readonly BarisJurnalSumber[],
  akun: string | Coa,
  opsi: OpsiMutasiRekonsiliasi = {},
  daftarAkun: readonly Coa[] = COA,
): RingkasanMutasiRekonsiliasi {
  const bb = bukuBesar(baris, akun, opsi, daftarAkun);
  return {
    kode: bb.kode,
    nama: bb.nama,
    posisi_normal: bb.posisi_normal,
    mulai: bb.mulai,
    sampai: bb.sampai,
    saldoAwal: bb.saldoAwal,
    rows: bb.rows.map((r) => ({
      jurnal_id: r.jurnal_id,
      baris_id: r.baris_id,
      tanggal: r.tanggal,
      no_bukti: r.no_bukti,
      keterangan: r.keterangan,
      debit: r.debit,
      kredit: r.kredit,
      saldo: r.saldo,
      posisi: r.posisi,
    })),
    totalDebit: bb.totalDebit,
    totalKredit: bb.totalKredit,
    totalMutasi: bb.saldoAkhir - bb.saldoAwal,
    saldoAkhir: bb.saldoAkhir,
  };
}
