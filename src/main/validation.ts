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

export const ASET_JENIS = ['TANAH', 'BANGUNAN', 'LAINNYA'] as const;
export const ASET_KONDISI = ['BAIK', 'RUSAK_RINGAN', 'RUSAK_BERAT', 'TIDAK_DIKETAHUI'] as const;

export type AsetInput = {
  kode: string;
  nama: string;
  jenis: string;
  luas_m2: number | null;
  lokasi: string;
  status_hukum: string;
  tahun_perolehan: number | null;
  asal_usul: string;
  kondisi: string;
  keterangan: string;
  nilai_sen: number | null;
};

/** Validasi Inventaris Aset: nominal sengaja opsional (null = belum dinilai). */
export function validateAsetInput(a: AsetInput): string[] {
  const err: string[] = [];
  if (!a.kode.trim()) err.push('Kode aset wajib diisi.');
  else if (a.kode.trim().length > 32) err.push('Kode aset maks. 32 karakter.');
  if (!a.nama.trim()) err.push('Nama aset wajib diisi.');
  if (!(ASET_JENIS as readonly string[]).includes(a.jenis)) err.push('Jenis aset tidak valid.');
  if (!(ASET_KONDISI as readonly string[]).includes(a.kondisi)) err.push('Kondisi aset tidak valid.');
  if (a.luas_m2 !== null && (!Number.isFinite(a.luas_m2) || a.luas_m2 < 0 || a.luas_m2 > 1e9))
    err.push('Luas harus angka ≥ 0 (atau kosongkan).');
  const tahunIni = new Date().getFullYear();
  if (
    a.tahun_perolehan !== null &&
    (!Number.isInteger(a.tahun_perolehan) || a.tahun_perolehan < 1900 || a.tahun_perolehan > tahunIni + 1)
  )
    err.push('Tahun perolehan tidak valid (atau kosongkan).');
  if (a.nilai_sen !== null && (!Number.isInteger(a.nilai_sen) || a.nilai_sen < 0))
    err.push('Nilai harus bilangan bulat ≥ 0 (atau kosongkan bila belum dinilai).');
  for (const [label, v] of [
    ['Lokasi', a.lokasi],
    ['Status hukum', a.status_hukum],
    ['Asal-usul', a.asal_usul],
    ['Keterangan', a.keterangan],
  ] as const) {
    if (v.length > 500) err.push(`${label} maks. 500 karakter.`);
  }
  return err;
}
