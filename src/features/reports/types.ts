// Tipe bersama laporan Agent B. Sumber kebenaran angka = src/core/ledger.ts.

import type { Transaksi } from '../../core/types.js';

export type RentangTanggal = { mulai?: string; sampai?: string };

export type PembantuHasil = {
  kode: string;
  nama: string;
  rows: Transaksi[];
  totalMasuk: number;
  totalKeluar: number;
  saldo: number;
  mulai?: string;
  sampai?: string;
};

export type RealisasiBaris = { kode: string; nama: string; nominal: number };

export type RealisasiHasil = {
  mulai?: string;
  sampai?: string;
  pendapatan: RealisasiBaris[];
  beban: RealisasiBaris[];
  totalPendapatan: number;
  totalBeban: number;
  net: number;
};

export type SurplusBaris = { kode: string; nama: string; nominal: number; persen: number };

export type SurplusHasil = {
  mulai?: string;
  sampai?: string;
  pendapatan: SurplusBaris[];
  beban: SurplusBaris[];
  totalPendapatan: number;
  totalBeban: number;
  surplus: number;
  defisit: boolean;
};
