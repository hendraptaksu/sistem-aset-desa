// Realisasi Anggaran — grouping Pendapatan per jenis (PENDAPATAN_KODES) + Beban
// per Baga (BEBAN_KODES) + filter tanggal + Net = Pendapatan - Beban.
// PANJAR & 1050/2050/3000 otomatis eksklusi (hanya tipe PENDAPATAN/BEBAN).

import { BEBAN_KODES, PENDAPATAN_KODES, coaByKode } from '../../../db/coa.js';
import { totalBeban, totalPendapatan } from '../../../core/ledger.js';
import type { Transaksi } from '../../../core/types.js';
import type { RealisasiHasil } from '../types.js';

function nominalKategori(transaksi: Transaksi[], kategori: string, mulai?: string, sampai?: string): number {
  return transaksi
    .filter(
      (t) =>
        t.kategori === kategori &&
        (!mulai || t.tanggal >= mulai) &&
        (!sampai || t.tanggal <= sampai),
    )
    .reduce((s, t) => s + (t.masuk - t.keluar), 0);
}

function nominalBeban(transaksi: Transaksi[], kategori: string, mulai?: string, sampai?: string): number {
  // Beban disimpan sebagai keluar; tampilkan sebagai angka positif.
  return transaksi
    .filter(
      (t) =>
        t.kategori === kategori &&
        (!mulai || t.tanggal >= mulai) &&
        (!sampai || t.tanggal <= sampai),
    )
    .reduce((s, t) => s + (t.keluar - t.masuk), 0);
}

export function buildRealisasi(transaksi: Transaksi[], mulai?: string, sampai?: string): RealisasiHasil {
  const pendapatan = PENDAPATAN_KODES.map((kode) => ({
    kode,
    nama: coaByKode(kode)?.nama ?? kode,
    nominal: nominalKategori(transaksi, kode, mulai, sampai),
  }));
  const beban = BEBAN_KODES.map((kode) => ({
    kode,
    nama: coaByKode(kode)?.nama ?? kode,
    nominal: nominalBeban(transaksi, kode, mulai, sampai),
  }));
  const tp = totalPendapatan(transaksi, mulai, sampai);
  const tb = totalBeban(transaksi, mulai, sampai);
  return { mulai, sampai, pendapatan, beban, totalPendapatan: tp, totalBeban: tb, net: tp - tb };
}
