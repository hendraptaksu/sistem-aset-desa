// Nomor bukti jurnal (P1-11) — fungsi murni tanpa DB/Electron.
//
// Keputusan pemilik K5: nomor baku `JU-<tahun>-<urut>` (JU = Jurnal Umum),
// contoh `JU-2026-0001`. Nomor boleh diedit operator dan wajib unik; bila
// operator mengosongkan, repository mengisi nomor berikutnya.
//
// Aturan urutan:
// - Hanya nomor dengan format baku dan tahun yang sama yang dihitung.
// - Nomor malformed / tahun lain diabaikan.
// - Celah TIDAK didaur ulang: selalu max+1 (nomor lama tidak dipakai ulang).
// - Urutan 9999 -> 10000 (tidak dipotong); parser menerima 4 digit atau lebih.

import { tanggalKalenderValid } from './posting.js';

export type NomorBukti = {
  tahun: number;
  urut: number;
};

/** Pola baku nomor bukti JU. Urut minimal 4 digit, boleh lebih setelah 9999. */
const POLA_NOMOR = /^JU-(\d{4})-(\d{4,})$/i;

/** Tahun harus bilangan bulat 4 digit (1000–9999). */
export function validasiTahun(tahun: number): number {
  if (!Number.isInteger(tahun) || tahun < 1000 || tahun > 9999)
    throw new Error('Tahun nomor bukti harus 4 digit (contoh: 2026).');
  return tahun;
}

/** `JU-<tahun>-<urut 4 digit>`; urut > 9999 tetap ditulis penuh (10000). */
export function formatNomorBukti(tahun: number, urut: number): string {
  const th = validasiTahun(tahun);
  if (!Number.isSafeInteger(urut) || urut <= 0)
    throw new Error('Urutan nomor bukti harus bilangan bulat lebih dari 0.');
  return `JU-${th}-${String(urut).padStart(4, '0')}`;
}

/**
 * Baca nomor bukti baku. Mengembalikan null untuk nomor kosong/malformed,
 * termasuk format lain (mis. BKM/BKK) agar tidak mencampur dua skema.
 */
export function parseNomorBukti(noBukti: string): NomorBukti | null {
  const teks = String(noBukti ?? '').trim();
  const m = POLA_NOMOR.exec(teks);
  if (!m) return null;
  const tahun = Number(m[1]);
  const urut = Number(m[2]);
  if (!Number.isInteger(tahun) || tahun < 1000 || tahun > 9999) return null;
  if (!Number.isSafeInteger(urut) || urut <= 0) return null;
  return { tahun, urut };
}

/**
 * Nomor urut berikutnya untuk satu tahun: max+1 dari nomor baku tahun itu.
 * Nomor tahun lain / malformed diabaikan; celah tidak didaur ulang.
 */
export function nomorBuktiBerikutnya(
  tahun: number,
  noBuktiTerpakai: readonly (string | null | undefined)[] = [],
): number {
  const th = validasiTahun(tahun);
  let maks = 0;
  const daftar = Array.isArray(noBuktiTerpakai) ? noBuktiTerpakai : [];
  for (const no of daftar) {
    const parsed = parseNomorBukti(String(no ?? ''));
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
