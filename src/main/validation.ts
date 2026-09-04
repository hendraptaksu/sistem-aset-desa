// Validasi input murni (tanpa Electron/DB) — di-test di tests/ipc-validation.test.ts.

import { coaByKode, isBeban, isKas } from '../db/coa.js';

export type TransaksiInput = {
  tanggal: string;
  keterangan: string;
  akun_kas: string;
  kategori: string;
  masuk: number;
  keluar: number;
};

const TGL = /^\d{4}-\d{2}-\d{2}$/;

/** Kategori yang boleh dipilih user di form BKU (PANJAR sistem dikecualikan). */
export function kategoriBolehDipilih(kode: string): boolean {
  const c = coaByKode(kode);
  if (!c) return false;
  if (c.tipe === 'KAS') return false;
  if (kode === '3001' || kode === '3002') return false; // dihitung otomatis
  return true;
}

export function validateTransaksiInput(t: TransaksiInput): string[] {
  const err: string[] = [];
  if (!TGL.test(t.tanggal) || Number.isNaN(Date.parse(t.tanggal))) err.push('Tanggal tidak valid (YYYY-MM-DD).');
  if (!t.keterangan.trim()) err.push('Keterangan wajib diisi.');
  if (!isKas(t.akun_kas)) err.push('Akun Kas tidak dikenal.');
  if (!kategoriBolehDipilih(t.kategori)) err.push('Kategori tidak valid.');
  if (!Number.isInteger(t.masuk) || t.masuk < 0) err.push('Uang masuk harus bilangan bulat ≥ 0.');
  if (!Number.isInteger(t.keluar) || t.keluar < 0) err.push('Uang keluar harus bilangan bulat ≥ 0.');
  if (t.masuk + t.keluar <= 0) err.push('Nominal harus lebih dari 0.');
  if (t.masuk > 0 && t.keluar > 0) err.push('Isi salah satu: masuk ATAU keluar.');
  return err;
}

export type PanjarItemInput = { kategori_baga: string; nominal: number };

export function validatePanjarItems(items: PanjarItemInput[]): string[] {
  const err: string[] = [];
  if (items.length === 0) err.push('Rincian belanja masih kosong.');
  items.forEach((it, i) => {
    if (!isBeban(it.kategori_baga)) err.push(`Baris ${i + 1}: Baga tidak valid.`);
    if (!Number.isInteger(it.nominal) || it.nominal <= 0) err.push(`Baris ${i + 1}: nominal harus > 0.`);
  });
  return err;
}
