// Helper tampilan laporan (P1-8) — fungsi murni, tanpa React/Electron.
// Dipakai tab Buku Besar & Neraca Saldo agar label dan badge sisi saldo
// konsisten di seluruh layar.

import type { CoaTipe, PosisiNormal } from '../../db/coa.js';
import type { KelompokArusKas } from '../../core/reports.js';
import { formatRp, formatTanggal } from '../../utils/format.js';

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
 * UI-A16/UI-A17: label Indonesia untuk jenis jurnal. Satu-satunya definisi;
 * dipakai JurnalTab, TransaksiTab, DetailJurnalModal, dan DashboardTab agar
 * badge jenis tidak berbeda antar layar.
 */
export const LABEL_JENIS: Record<string, string> = {
  UMUM: 'Jurnal Umum',
  TERIMA: 'Terima Uang',
  BAYAR: 'Bayar / Beban',
  TRANSFER: 'Pindah Dana',
  PANJAR: 'Panjar',
  PIUTANG: 'Piutang',
  HUTANG: 'Utang',
  SALDO_AWAL: 'Saldo Awal',
  REVERSAL: 'Jurnal Balik',
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

/**
 * Label periode filter Laba Rugi/Arus Kas. Tanggal kosong berarti batas
 * awal/akhir; dua-duanya kosong berarti seluruh riwayat (tombol "Semua tanggal").
 */
export function labelPeriodeLaporan(mulai: string, sampai: string): string {
  if (!mulai && !sampai) return 'seluruh riwayat';
  return `${mulai ? formatTanggal(mulai) : 'awal'} s/d ${
    sampai ? formatTanggal(sampai) : 'akhir'
  }`;
}

/**
 * UI-A10: satu-satunya definisi guard rentang terbalik; semua tab laporan
 * (dan KontrolPeriode) memakai fungsi ini agar aturannya tidak berbeda antar
 * layar. Rentang kosong (salah satu/dua tanggal kosong) dianggap sah karena
 * berarti tanpa batas awal/akhir.
 */
export function rentangTerbalik(mulai: string, sampai: string): boolean {
  return Boolean(mulai && sampai && mulai > sampai);
}

/**
 * UI-A10: label periode header laporan dihitung dari DATA HASIL
 * (`data.mulai`/`data.sampai`), bukan dari input filter, agar teks di layar
 * selalu cocok dengan angka yang sedang tampil (termasuk saat fetch baru
 * berjalan dan data lama masih ditampilkan).
 */
export function labelPeriodeHasil(hasil: {
  mulai?: string;
  sampai?: string;
}): string {
  return labelPeriodeLaporan(hasil.mulai ?? '', hasil.sampai ?? '');
}

/**
 * UI-A10: alasan baku tombol ekspor dinonaktifkan karena laporan tidak
 * memiliki data. Dipakai sama di Laba Rugi, Arus Kas, Buku Besar, dan
 * Neraca Saldo.
 */
export const ALASAN_EKSPOR_KOSONG =
  'Laporan ini belum punya data untuk diekspor. Ubah periode atau catat transaksi terlebih dahulu.';

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
  if (hasil.seimbang) return { tone: 'green', label: 'Pembukuan seimbang' };
  return {
    tone: 'red',
    label: `Ada selisih ${formatRp(hasil.selisih)}`,
  };
}

/** Badge Laba Rugi: SURPLUS bila laba >= 0, DEFISIT bila negatif. */
export function badgeLabaRugi(defisit: boolean): BadgeLaporan {
  return defisit
    ? { tone: 'red', label: 'DEFISIT' }
    : { tone: 'green', label: 'SURPLUS' };
}
