// Buku Pembantu — filter per kode (kas 1000-1029 atau kategori 4001-5007/2050/3000/PANJAR)
// + Total Masuk/Keluar/Saldo. Delegasi angka ke ledger.totalPerKategori? Tidak —
// pembantu butuh rows rincian, jadi filter langsung lalu agregat masuk-keluar.
// Rumus sama dengan Agent A: filter tanggal mulai–selesai (inklusif).

import { coaByKode, isKas } from '../../../db/coa.js';
import { PANJAR_KATEGORI } from '../../../core/ledger.js';
import type { Transaksi } from '../../../core/types.js';
import type { PembantuHasil } from '../types.js';

export type PembantuOpts = { kode: string; mulai?: string; sampai?: string };

export function namaKode(kode: string): string {
  if (kode === PANJAR_KATEGORI) return 'Mutasi Panjar';
  return coaByKode(kode)?.nama ?? kode;
}

/** Bangun laporan pembantu untuk satu kode rekening. */
export function buildPembantu(transaksi: Transaksi[], opts: PembantuOpts): PembantuHasil {
  const { kode, mulai, sampai } = opts;
  const byKas = isKas(kode);
  const rows = transaksi
    .filter((t) => {
      if (mulai && t.tanggal < mulai) return false;
      if (sampai && t.tanggal > sampai) return false;
      return byKas ? t.akun_kas === kode : t.kategori === kode;
    })
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));
  const totalMasuk = rows.reduce((s, t) => s + t.masuk, 0);
  const totalKeluar = rows.reduce((s, t) => s + t.keluar, 0);
  return { kode, nama: namaKode(kode), rows, totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar };
}
