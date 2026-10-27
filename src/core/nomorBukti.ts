// Nomor bukti jurnal (P1-11/P1-13) — fungsi murni tanpa DB/Electron.
//
// Keputusan pemilik K5: nomor baku `JU-<tahun>-<urut>` (JU = Jurnal Umum),
// contoh `JU-2026-0001`. Nomor boleh diedit operator dan wajib unik; bila
// operator mengosongkan, repository mengisi nomor berikutnya.
//
// P1-13: prefix & jumlah digit berasal dari pengaturan pembukuan. Default tetap
// JU/4 digit agar perilaku lama tidak berubah. Saat prefix diganti, nomor lama
// TIDAK diubah dan pencarian urutan hanya menghitung prefix baru.
//
// Aturan urutan:
// - Hanya nomor dengan format baku, prefix, dan tahun yang sama yang dihitung.
// - Nomor malformed / tahun lain / prefix lain diabaikan.
// - Celah TIDAK didaur ulang: selalu max+1 (nomor lama tidak dipakai ulang).
// - Urutan melebihi padding tetap ditulis penuh (9999 -> 10000).

import { tanggalKalenderValid } from './posting.js';

export type NomorBukti = {
  tahun: number;
  urut: number;
};

/** Prefix baku: 1–8 huruf kapital/angka. */
const POLA_PREFIX = /^[A-Z0-9]{1,8}$/;

/** Tahun harus bilangan bulat 4 digit (1000–9999). */
export function validasiTahun(tahun: number): number {
  if (!Number.isInteger(tahun) || tahun < 1000 || tahun > 9999)
    throw new Error('Tahun nomor bukti harus 4 digit (contoh: 2026).');
  return tahun;
}

/** Prefix nomor bukti; mengembalikan bentuk kapital yang sah. */
export function validasiPrefixBukti(prefix: string): string {
  const teks = String(prefix ?? '').trim().toUpperCase();
  if (!POLA_PREFIX.test(teks))
    throw new Error('Prefix nomor bukti harus 1–8 huruf kapital atau angka (contoh: JU).');
  return teks;
}

/** Jumlah digit urutan nomor bukti (3–6). */
export function validasiPaddingBukti(padding: number): number {
  if (!Number.isInteger(padding) || padding < 3 || padding > 6)
    throw new Error('Jumlah digit nomor bukti harus bilangan bulat 3–6.');
  return padding;
}

/**
 * `PREFIX-<tahun>-<urut>`; urut dipad dengan `padding` digit, tetapi angka
 * yang lebih panjang tidak dipotong.
 */
export function formatNomorBukti(
  tahun: number,
  urut: number,
  prefix = 'JU',
  padding = 4,
): string {
  const th = validasiTahun(tahun);
  const p = validasiPrefixBukti(prefix);
  const pad = validasiPaddingBukti(padding);
  if (!Number.isSafeInteger(urut) || urut <= 0)
    throw new Error('Urutan nomor bukti harus bilangan bulat lebih dari 0.');
  return `${p}-${th}-${String(urut).padStart(pad, '0')}`;
}

/**
 * Baca nomor bukti baku untuk prefix & padding tertentu. Mengembalikan null
 * untuk nomor kosong/malformed, termasuk format lain (mis. BKM/BKK) agar tidak
 * mencampur dua skema.
 */
export function parseNomorBukti(
  noBukti: string,
  prefix = 'JU',
  padding = 4,
): NomorBukti | null {
  let p: string;
  let pad: number;
  try {
    p = validasiPrefixBukti(prefix);
    pad = validasiPaddingBukti(padding);
  } catch {
    return null;
  }
  const teks = String(noBukti ?? '').trim();
  const pola = new RegExp(`^${p}-(\\d{4})-(\\d{${pad},})$`, 'i');
  const m = pola.exec(teks);
  if (!m) return null;
  const tahun = Number(m[1]);
  const urut = Number(m[2]);
  if (!Number.isInteger(tahun) || tahun < 1000 || tahun > 9999) return null;
  if (!Number.isSafeInteger(urut) || urut <= 0) return null;
  return { tahun, urut };
}

/**
 * Nomor urut berikutnya untuk satu tahun & prefix: max+1 dari nomor baku yang
 * cocok. Nomor tahun lain / prefix lain / malformed diabaikan; celah tidak
 * didaur ulang.
 */
export function nomorBuktiBerikutnya(
  tahun: number,
  noBuktiTerpakai: readonly (string | null | undefined)[] = [],
  prefix = 'JU',
  padding = 4,
): number {
  const th = validasiTahun(tahun);
  validasiPrefixBukti(prefix);
  validasiPaddingBukti(padding);
  let maks = 0;
  const daftar = Array.isArray(noBuktiTerpakai) ? noBuktiTerpakai : [];
  for (const no of daftar) {
    // Baca dengan minimal 3 digit agar nomor lama tetap dihitung saat padding
    // diperbesar (mis. 4 -> 6); urutan tidak mundur dan nomor lama tidak diubah.
    const parsed = parseNomorBukti(String(no ?? ''), prefix, 3);
    if (!parsed || parsed.tahun !== th) continue;
    if (parsed.urut > maks) maks = parsed.urut;
  }
  return maks + 1;
}

/** Tahun dari tanggal kalender YYYY-MM-DD; melempar pesan Indonesia bila salah. */
export function tahunDariTanggal(tanggal: string): number {
  const teks = String(tanggal ?? '').trim();
  if (!tanggalKalenderValid(teks))
    throw new Error('Tanggal tidak valid (YYYY-MM-DD dan harus tanggal kalender).');
  return Number(teks.slice(0, 4));
}
