// Surplus / (Defisit) — SAMA dengan realisasi tapi judul Surplus/(Defisit) +
// kolom % per baris + format kurung untuk defisit (lewat formatRp).
// Hanya tipe PENDAPATAN/BEBAN; 1050/2050/3000/PANJAR tidak masuk total.

import { BEBAN_KODES, PENDAPATAN_KODES, coaByKode } from '../../../db/coa.js';
import { surplus, totalBeban, totalPendapatan } from '../../../core/ledger.js';
import type { Transaksi } from '../../../core/types.js';
import type { SurplusHasil } from '../types.js';

const pct = (nominal: number, total: number): number => (total === 0 ? 0 : (nominal / total) * 100);

function sumKategori(transaksi: Transaksi[], kategori: string, mulai?: string, sampai?: string): number {
  return transaksi
    .filter(
      (t) =>
        t.kategori === kategori &&
        (!mulai || t.tanggal >= mulai) &&
        (!sampai || t.tanggal <= sampai),
    )
    .reduce((s, t) => s + (t.keluar - t.masuk), 0);
}

function sumPendapatan(transaksi: Transaksi[], kategori: string, mulai?: string, sampai?: string): number {
  return transaksi
    .filter(
      (t) =>
        t.kategori === kategori &&
        (!mulai || t.tanggal >= mulai) &&
        (!sampai || t.tanggal <= sampai),
    )
    .reduce((s, t) => s + (t.masuk - t.keluar), 0);
}

export function buildSurplus(transaksi: Transaksi[], mulai?: string, sampai?: string): SurplusHasil {
  const tp = totalPendapatan(transaksi, mulai, sampai);
  const tb = totalBeban(transaksi, mulai, sampai);
  const pendapatan = PENDAPATAN_KODES.map((kode) => {
    const nominal = sumPendapatan(transaksi, kode, mulai, sampai);
    return { kode, nama: coaByKode(kode)?.nama ?? kode, nominal, persen: pct(nominal, tp) };
  });
  const beban = BEBAN_KODES.map((kode) => {
    const nominal = sumKategori(transaksi, kode, mulai, sampai);
    return { kode, nama: coaByKode(kode)?.nama ?? kode, nominal, persen: pct(nominal, tb) };
  });
  const s = surplus(transaksi, mulai, sampai);
  return { mulai, sampai, pendapatan, beban, totalPendapatan: tp, totalBeban: tb, surplus: s, defisit: s < 0 };
}

/**
 * Cek silang: Surplus Jan-01 s/d cut-off == Berjalan 3002 di Neraca.
 * Caller isi `berjalan` dari neraca(...).berjalan agar tidak hitung ulang beda cara.
 */
export function cekSilangSurplusBerjalan(surplusJanSdCutoff: number, berjalan3002: number): boolean {
  return surplusJanSdCutoff === berjalan3002;
}
