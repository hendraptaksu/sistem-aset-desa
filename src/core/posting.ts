// Posting layer (P0-4): aturan bisnis jurnal double-entry, satu pintu.
// Fungsi murni — tanpa DB/Electron. Pemanggil (main/IPC/test) menyiapkan `ctx`
// dari database: master akun, tahun tutup buku, nomor bukti terpakai, saldo kas.
//
// Prinsip:
// - Error = jurnal tidak boleh disimpan.
// - Peringatan = boleh disimpan, tetapi operator wajib konfirmasi (mis. kas minus).

import {
  PESAN_AKUN_LEGACY,
  POSISI_NORMAL,
  akunBolehDiposting,
  isAkunKas,
  type CoaTipe,
  type PosisiNormal,
} from '../db/coa.js';
import { validasiSimpanLonggar } from './ledger.js';
import type { JurnalBarisInput, JurnalHeaderInput, JurnalJenis } from './types.js';
import { formatRp } from '../utils/format.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../utils/pesanError.js';

export const JENIS_JURNAL: readonly JurnalJenis[] = [
  'UMUM',
  'TERIMA',
  'BAYAR',
  'TRANSFER',
  'PANJAR',
  'PIUTANG',
  'HUTANG',
  'SALDO_AWAL',
  'REVERSAL',
];

const TIPE_AKUN: readonly CoaTipe[] = ['AKTIVA', 'KEWAJIBAN', 'EKUITAS', 'PENDAPATAN', 'BEBAN'];

/** Akun master yang dipakai validator (bentuk aman untuk fungsi murni). */
export type AkunPosting = {
  kode: string;
  nama?: string;
  tipe: CoaTipe;
  posisi_normal?: PosisiNormal;
  aktif: boolean;
};

/** Konteks DB yang dibutuhkan posting layer, sudah diambil pemanggil. */
export type PostingContext = {
  akun: AkunPosting[];
  /** Tahun yang sudah ditutup. Tanggal <= 31 Des tahun terakhir butuh alasan. */
  tutupBuku?: ReadonlyArray<{ tahun: number }>;
  /** Nomor bukti yang sudah dipakai (boleh kosong). */
  noBuktiTerpakai?: readonly string[];
  /** Saldo kas/bank saat ini dalam sen, per kode akun. */
  saldoKas?: Readonly<Record<string, number>>;
};

export type JurnalInput = {
  header: JurnalHeaderInput;
  baris: JurnalBarisInput[];
  /** Wajib diisi bila tanggal berada di periode yang sudah ditutup. */
  alasan?: string;
};

export type HasilValidasiJurnal = {
  /** true bila tidak ada error (peringatan tetap boleh). */
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  /** true bila ada peringatan yang wajib dikonfirmasi sebelum simpan. */
  perluKonfirmasi: boolean;
};

const TGL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Tanggal kalender sungguhan (YYYY-MM-DD). Bukan sekadar regex/Date.parse:
 * `2026-02-31` ditolak, `2028-02-29` diterima (tahun kabisat).
 */
export function tanggalKalenderValid(tanggal: string): boolean {
  const m = TGL.exec(String(tanggal ?? ''));
  if (!m) return false;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  if (tahun < 1900 || tahun > 9999 || bulan < 1 || bulan > 12 || hari < 1) return false;
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  return (
    d.getUTCFullYear() === tahun && d.getUTCMonth() === bulan - 1 && d.getUTCDate() === hari
  );
}

const labelAkun = (a: AkunPosting | undefined, kode: string): string =>
  a?.nama ? `${kode} ${a.nama}` : kode;

/**
 * Validasi lengkap satu jurnal sebelum disimpan.
 *
 * Urutan aturan:
 * 1. Tanggal kalender nyata, keterangan, minimal 2 baris.
 * 2. Akun ada, aktif, bukan akun legacy 3001/3002, tipe/posisi normal
 *    konsisten, nominal sen valid.
 * 3. Jenis jurnal konsisten dengan akun (TRANSFER kas/bank; PANJAR 1040;
 *    PIUTANG 1050; HUTANG 2050).
 * 4. Total debit = total kredit dan > 0.
 * 5. Periode terkunci wajib alasan >= 5 karakter.
 * 6. Kas/bank akan minus -> peringatan (bukan error).
 * 7. Nomor bukti duplikat ditolak.
 */
export function validasiJurnal(input: JurnalInput, ctx: PostingContext): HasilValidasiJurnal {
  const errors: string[] = [];
  const peringatan: string[] = [];
  const header = input.header;
  const baris = Array.isArray(input.baris) ? input.baris : [];
  const alasan = String(input.alasan ?? '').trim();

  // ---- 1. Kepala jurnal ----
  if (!tanggalKalenderValid(header.tanggal))
    errors.push(PESAN_TANGGAL_TIDAK_VALID);
  if (!String(header.keterangan ?? '').trim()) errors.push('Keterangan wajib diisi.');
  if (baris.length < 2)
    errors.push('Jurnal wajib memiliki minimal 2 baris (satu debit dan satu kredit).');

  const petaAkun = new Map(ctx.akun.map((a) => [a.kode, a]));
  const deltaKas = new Map<string, number>();
  let totalDebit = 0;
  let totalKredit = 0;
  let adaNominalSalah = false;

  // ---- 2. Baris: akun, tipe, nominal ----
  baris.forEach((b, i) => {
    const no = i + 1;
    const kode = String(b.akun_kode ?? '').trim();
    const akunBaris = petaAkun.get(kode);

    if (!kode) errors.push(`Baris ${no}: akun belum dipilih.`);
    else if (!akunBaris) errors.push(`Baris ${no}: akun ${kode} tidak dikenal.`);
    else if (!akunBaris.aktif) errors.push(`Baris ${no}: akun ${labelAkun(akunBaris, kode)} sudah tidak aktif.`);
    else if (!akunBolehDiposting(kode, akunBaris.aktif))
      errors.push(`Baris ${no}: akun ${labelAkun(akunBaris, kode)} ${PESAN_AKUN_LEGACY}`);

    if (akunBaris) {
      if (!TIPE_AKUN.includes(akunBaris.tipe))
        errors.push(`Baris ${no}: jenis akun ${labelAkun(akunBaris, kode)} tidak dikenal.`);
      else if (
        akunBaris.posisi_normal &&
        akunBaris.posisi_normal !== POSISI_NORMAL[akunBaris.tipe]
      )
        errors.push(
          `Baris ${no}: posisi normal akun ${labelAkun(akunBaris, kode)} tidak sesuai jenisnya.`,
        );
    }

    const debitOk = Number.isInteger(b.debit) && b.debit >= 0;
    const kreditOk = Number.isInteger(b.kredit) && b.kredit >= 0;
    if (!debitOk) errors.push(`Baris ${no}: debit harus bilangan bulat ≥ 0.`);
    if (!kreditOk) errors.push(`Baris ${no}: kredit harus bilangan bulat ≥ 0.`);

    if (!debitOk || !kreditOk) {
      adaNominalSalah = true;
      return;
    }
    if (b.debit > 0 && b.kredit > 0) {
      errors.push(`Baris ${no}: isi salah satu saja — debit ATAU kredit.`);
      adaNominalSalah = true;
      return;
    }
    if (b.debit === 0 && b.kredit === 0) {
      errors.push(`Baris ${no}: nominal debit/kredit harus lebih dari 0.`);
      adaNominalSalah = true;
      return;
    }

    totalDebit += b.debit;
    totalKredit += b.kredit;
    if (akunBaris && isAkunKas(kode))
      deltaKas.set(kode, (deltaKas.get(kode) ?? 0) + b.debit - b.kredit);
  });

  // ---- 3. Jenis jurnal konsisten dengan akun yang dipakai ----
  const jenis = String(header.jenis ?? 'UMUM') as JurnalJenis;
  if (!JENIS_JURNAL.includes(jenis)) {
    errors.push('Jenis jurnal tidak dikenal.');
  } else {
    const kodeSah = baris
      .map((b) => String(b.akun_kode ?? '').trim())
      .filter((kode) => petaAkun.has(kode));

    if (jenis === 'TRANSFER') {
      const bukanKas = kodeSah.filter((kode) => !isAkunKas(kode));
      if (bukanKas.length > 0)
        errors.push('Jurnal Pindah Dana hanya boleh memakai akun kas/bank.');
      const kasUnik = new Set(kodeSah.filter((kode) => isAkunKas(kode)));
      if (kasUnik.size < 2)
        errors.push('Pindah Dana harus memakai dua akun kas/bank yang berbeda.');
    }
    if (jenis === 'PANJAR' && !kodeSah.includes('1040'))
      errors.push('Jurnal Panjar wajib memakai akun 1040 UANG PANJAR (KAS DI MUKA).');
    if (jenis === 'PIUTANG' && !kodeSah.includes('1050'))
      errors.push('Jurnal Piutang wajib memakai akun 1050 PIUTANG LAIN LAIN.');
    if (jenis === 'HUTANG' && !kodeSah.includes('2050'))
      errors.push('Jurnal Hutang wajib memakai akun 2050 HUTANG LAIN-LAIN.');
  }

  // ---- 4. Keseimbangan ----
  if (!adaNominalSalah && baris.length >= 2) {
    if (totalDebit !== totalKredit)
      errors.push(
        `Jurnal tidak seimbang: total debit ${formatRp(totalDebit)} ≠ total kredit ${formatRp(totalKredit)}.`,
      );
    else if (totalDebit <= 0) errors.push('Total jurnal harus lebih dari 0.');
  }

  // ---- 5. Kunci periode (longgar: alasan >= 5 karakter) ----
  if (tanggalKalenderValid(header.tanggal)) {
    const kunci = validasiSimpanLonggar(header.tanggal, ctx.tutupBuku ?? [], alasan);
    if (!kunci.boleh && kunci.error) errors.push(kunci.error);
  }

  // ---- 6. Kas/bank minus: peringatan, bukan error ----
  if (ctx.saldoKas) {
    for (const [kode, delta] of deltaKas) {
      const saldoAwal = ctx.saldoKas[kode];
      if (saldoAwal === undefined || delta === 0) continue;
      const saldoAkhir = saldoAwal + delta;
      if (saldoAkhir < 0) {
        peringatan.push(
          `Kas/Bank ${labelAkun(petaAkun.get(kode), kode)} akan minus ${formatRp(-saldoAkhir)}. Periksa kembali — boleh lanjut dengan konfirmasi.`,
        );
      }
    }
  }

  // ---- 7. Nomor bukti unik ----
  const noBukti = String(header.no_bukti ?? '').trim();
  if (noBukti) {
    const dipakai = new Set(
      (ctx.noBuktiTerpakai ?? []).map((n) => String(n).trim().toLowerCase()),
    );
    if (dipakai.has(noBukti.toLowerCase()))
      errors.push(`Nomor bukti ${noBukti} sudah dipakai. Gunakan nomor bukti lain.`);
  }

  return {
    boleh: errors.length === 0,
    errors,
    peringatan,
    perluKonfirmasi: peringatan.length > 0,
  };
}
