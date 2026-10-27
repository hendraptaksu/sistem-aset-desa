// Helper tampilan laporan (P1-8) — fungsi murni, tanpa React/Electron.
// Dipakai tab Buku Besar & Neraca Saldo agar label dan badge sisi saldo
// konsisten di seluruh layar.

import type { CoaTipe, PosisiNormal } from '../../db/coa.js';
import type { KelompokArusKas } from '../../core/reports.js';
import { formatRp } from '../../utils/format.js';

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

/** Label kelompok Arus Kas untuk operator awam. */
export const LABEL_KELOMPOK_ARUS_KAS: Record<KelompokArusKas, string> = {
  OPERASI: 'Operasi',
  INVESTASI: 'Investasi',
  PENDANAAN: 'Pendanaan',
  TRANSFER: 'Transfer',
};

export function labelKelompokArusKas(kelompok: KelompokArusKas): string {
  return LABEL_KELOMPOK_ARUS_KAS[kelompok];
}

export type BadgeLaporan = {
  tone: 'green' | 'red';
  label: string;
};

/**
 * Badge status Neraca Saldo. Selalu memakai angka `selisih` dari mesin
 * laporan; tidak menghitung ulang di renderer.
 */
export function badgeNeracaSaldo(hasil: {
  seimbang: boolean;
  selisih: number;
}): BadgeLaporan {
  if (hasil.seimbang) return { tone: 'green', label: 'Neraca Saldo: seimbang' };
  return {
    tone: 'red',
    label: `Neraca Saldo: selisih ${formatRp(hasil.selisih)}`,
  };
}

/** Badge Laba Rugi: SURPLUS bila laba >= 0, DEFISIT bila negatif. */
export function badgeLabaRugi(defisit: boolean): BadgeLaporan {
  return defisit
    ? { tone: 'red', label: 'DEFISIT' }
    : { tone: 'green', label: 'SURPLUS' };
}
