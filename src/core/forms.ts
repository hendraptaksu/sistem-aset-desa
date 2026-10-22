// Builder form terpandu (P0-10 / dipakai P1-1..P1-4).
//
// Fungsi murni tanpa DB/Electron: operator awam cukup mengisi tanggal, akun,
// nominal, dan keterangan. Builder menyusun jurnal double-entry yang seimbang
// (debit = kredit) sehingga UI tidak perlu tahu istilah debit/kredit.
//
// Semua nominal dalam satuan SEN dan wajib bilangan bulat > 0. Kesalahan
// dilempar sebagai `Error` berbahasa Indonesia; validasi bisnis lengkap tetap
// dijalankan lagi oleh posting layer (P0-4) saat jurnal disimpan.

import {
  AKUN_MODAL,
  AKUN_PANJAR,
  akun as cariAkunCoa,
  isAkunKas,
  type Coa,
} from '../db/coa.js';
import { tanggalKalenderValid, type JurnalInput } from './posting.js';
import type { JurnalBarisInput, JurnalJenis } from './types.js';

/** Kolom dasar yang sama untuk semua form terpandu. */
export type DasarFormJurnal = {
  /** Tanggal kalender YYYY-MM-DD. */
  tanggal: string;
  /** Nominal dalam sen; bilangan bulat > 0. */
  nominal: number;
  keterangan: string;
  /** Nomor bukti opsional (cth. JU-2026-0001). Wajib unik saat disimpan. */
  noBukti?: string;
  /** ID jurnal; bila kosong dibuat otomatis (tetap unik saat disimpan). */
  id?: string;
  /** Alasan wajib diisi bila tanggal berada di periode yang sudah ditutup. */
  alasan?: string;
};

export type FormTerimaUang = DasarFormJurnal & {
  /** Kas/bank yang menerima uang. */
  akunKas: string;
  /** Akun pendapatan, atau 3000 MODAL untuk setoran modal. */
  akunLawan: string;
};

export type FormBayar = DasarFormJurnal & {
  /** Kas/bank sumber pembayaran. */
  akunKas: string;
  /** Akun beban/hutang/akun lain yang dibayar (bukan akun kas). */
  akunLawan: string;
};

export type FormPindahDana = DasarFormJurnal & {
  /** Akun kas/bank asal. */
  dari: string;
  /** Akun kas/bank tujuan; wajib berbeda dari `dari`. */
  ke: string;
};

export type FormPanjarSerah = DasarFormJurnal & {
  /** Kas/bank sumber uang panjar. */
  akunKas: string;
};

let urutanId = 0;

/** ID unik sederhana; `crypto.randomUUID` tersedia di Node maupun renderer. */
function idOtomatis(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `j-${cryptoApi.randomUUID()}`;
  }
  urutanId += 1;
  return `j-${Date.now().toString(36)}-${urutanId.toString(36)}`;
}

function wajibTanggal(tanggal: string): string {
  const nilai = String(tanggal ?? '').trim();
  if (!tanggalKalenderValid(nilai))
    throw new Error('Tanggal tidak valid. Gunakan tanggal kalender YYYY-MM-DD yang benar.');
  return nilai;
}

function wajibNominal(nominal: number): number {
  if (!Number.isInteger(nominal) || nominal <= 0)
    throw new Error('Nominal harus bilangan bulat lebih dari 0 (satuan sen).');
  return nominal;
}

function wajibKeterangan(keterangan: string): string {
  const nilai = String(keterangan ?? '').trim();
  if (!nilai) throw new Error('Keterangan wajib diisi.');
  return nilai;
}

function wajibAkun(kode: string, label: string): string {
  const nilai = String(kode ?? '').trim();
  if (!nilai) throw new Error(`${label} wajib dipilih.`);
  return nilai;
}

/** Akun harus ada di COA; pesan menyebut label form agar mudah dipahami. */
function akunCoa(kode: string, label: string): Coa {
  const nilai = wajibAkun(kode, label);
  const data = cariAkunCoa(nilai);
  if (!data) throw new Error(`${label} ${nilai} tidak dikenal di daftar akun.`);
  return data;
}

function akunKas(kode: string, label: string): string {
  const nilai = wajibAkun(kode, label);
  if (!isAkunKas(nilai)) throw new Error(`${label} ${nilai} bukan akun kas/bank.`);
  return nilai;
}

function debit(akun_kode: string, nominal: number): JurnalBarisInput {
  return { akun_kode, debit: nominal, kredit: 0 };
}

function kredit(akun_kode: string, nominal: number): JurnalBarisInput {
  return { akun_kode, debit: 0, kredit: nominal };
}

function susun(
  dasar: DasarFormJurnal,
  jenis: JurnalJenis,
  baris: JurnalBarisInput[],
): JurnalInput {
  const tanggal = wajibTanggal(dasar.tanggal);
  const nominal = wajibNominal(dasar.nominal);
  const keterangan = wajibKeterangan(dasar.keterangan);
  const id = String(dasar.id ?? '').trim() || idOtomatis();
  const noBukti = String(dasar.noBukti ?? '').trim();
  const alasan = String(dasar.alasan ?? '').trim();

  // Jaring pengaman terakhir: builder tidak boleh menghasilkan jurnal pincang.
  const totalDebit = baris.reduce((s, b) => s + b.debit, 0);
  const totalKredit = baris.reduce((s, b) => s + b.kredit, 0);
  if (totalDebit !== totalKredit || totalDebit !== nominal)
    throw new Error('Jurnal form tidak seimbang. Periksa kembali nominal dan akun.');

  return {
    header: {
      id,
      tanggal,
      keterangan,
      ...(noBukti ? { no_bukti: noBukti } : {}),
      jenis,
    },
    baris,
    ...(alasan ? { alasan } : {}),
  };
}

/**
 * Terima uang: **D akun kas / K akun lawan**.
 * Lawan harus akun PENDAPATAN atau 3000 MODAL (setoran modal).
 */
export function buatJurnalTerimaUang(form: FormTerimaUang): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas penerima');
  const lawanData = akunCoa(form.akunLawan, 'Akun lawan');
  if (lawanData.tipe !== 'PENDAPATAN' && lawanData.kode !== AKUN_MODAL)
    throw new Error(
      'Akun lawan Terima Uang harus akun pendapatan atau 3000 MODAL (setoran modal).',
    );
  return susun(form, 'TERIMA', [debit(kas, nominal), kredit(lawanData.kode, nominal)]);
}

/**
 * Bayar/beban: **D akun lawan / K akun kas**.
 * Lawan boleh akun beban, hutang (2050), piutang (1050), atau akun non-kas lain.
 */
export function buatJurnalBayar(form: FormBayar): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas sumber');
  const lawanData = akunCoa(form.akunLawan, 'Akun lawan');
  if (isAkunKas(lawanData.kode))
    throw new Error(
      'Akun lawan Bayar bukan akun kas/bank. Untuk memindahkan uang antar kas, gunakan Pindah Dana.',
    );
  return susun(form, 'BAYAR', [debit(lawanData.kode, nominal), kredit(kas, nominal)]);
}

/**
 * Pindah dana antar kas/bank: **D akun tujuan / K akun asal**.
 * Kedua akun wajib akun kas/bank dan tidak boleh sama.
 */
export function buatJurnalPindahDana(form: FormPindahDana): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const dari = akunKas(form.dari, 'Akun asal');
  const ke = akunKas(form.ke, 'Akun tujuan');
  if (dari === ke)
    throw new Error('Pindah Dana harus memakai akun asal dan tujuan yang berbeda.');
  return susun(form, 'TRANSFER', [debit(ke, nominal), kredit(dari, nominal)]);
}

/**
 * Serah panjar: **D 1040 UANG PANJAR / K akun kas**.
 * Pertanggungjawaban/sisa panjar dibuat terpisah oleh form Panjar (P1-4).
 */
export function buatJurnalPanjarSerah(form: FormPanjarSerah): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas sumber');
  return susun(form, 'PANJAR', [debit(AKUN_PANJAR, nominal), kredit(kas, nominal)]);
}
