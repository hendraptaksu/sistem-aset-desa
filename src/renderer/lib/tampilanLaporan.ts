// Helper tampilan laporan (P1-8) — fungsi murni, tanpa React/Electron.
// Dipakai tab Buku Besar & Neraca Saldo agar label dan badge sisi saldo
// konsisten di seluruh layar.

import type { CoaTipe, PosisiNormal } from '../../db/coa.js';

export const LABEL_TIPE_AKUN: Record<CoaTipe, string> = {
  AKTIVA: 'Aktiva',
  KEWAJIBAN: 'Kewajiban',
  EKUITAS: 'Ekuitas',
  PENDAPATAN: 'Pendapatan',
  BEBAN: 'Beban',
};

export const LABEL_POSISI_NORMAL: Record<PosisiNormal, string> = {
  DEBIT: 'Debit',
  KREDIT: 'Kredit',
};

/**
 * Sisi saldo berjalan/akhir. Positif = sesuai posisi normal akun; negatif =
 * sisi lawannya (mis. bank bersaldo negatif berarti kredit). Nol = tanpa sisi.
 */
export function sisiSaldo(
  saldo: number,
  posisiNormal: PosisiNormal,
): PosisiNormal | null {
  if (saldo === 0) return null;
  if (saldo > 0) return posisiNormal;
  return posisiNormal === 'DEBIT' ? 'KREDIT' : 'DEBIT';
}

/** Label badge sisi saldo; null berarti nol. */
export function labelSisiSaldo(sisi: PosisiNormal | null): string {
  return sisi === null ? 'Nol' : LABEL_POSISI_NORMAL[sisi];
}

/** Nada warna badge: hijau untuk debit, kuning untuk kredit, netral untuk nol. */
export function toneSisiSaldo(sisi: PosisiNormal | null): 'green' | 'amber' | 'stone' {
  if (sisi === 'DEBIT') return 'green';
  if (sisi === 'KREDIT') return 'amber';
  return 'stone';
}
