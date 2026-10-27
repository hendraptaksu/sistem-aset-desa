// Buku Pembantu — filter per kode akun (kas/bank atau akun lawan apa pun:
// PENDAPATAN/BEBAN/1040/1050/2050/3000) + Total Masuk/Keluar/Saldo.
// + Total Masuk/Keluar/Saldo. Delegasi angka ke ledger.totalPerKategori? Tidak —
// pembantu butuh rows rincian, jadi filter langsung lalu agregat masuk-keluar.
// Rumus sama dengan Agent A: filter tanggal mulai–selesai (inklusif).

import { coaByKode, isAkunKas } from '../../../db/coa.js';
import type { BukuBesarHasil } from '../../../core/reports.js';
import type { Transaksi } from '../../../core/types.js';
import type { PembantuHasil } from '../types.js';

export type PembantuOpts = { kode: string; mulai?: string; sampai?: string };

export function namaKode(kode: string): string {
  return coaByKode(kode)?.nama ?? kode;
}

/** Bangun laporan pembantu untuk satu kode rekening. */
export function buildPembantu(transaksi: Transaksi[], opts: PembantuOpts): PembantuHasil {
  const { kode, mulai, sampai } = opts;
  const byKas = isAkunKas(kode);
  const rows = transaksi
    .filter((t) => {
      if (mulai && t.tanggal < mulai) return false;
      if (sampai && t.tanggal > sampai) return false;
      return byKas ? t.akun_kas === kode : t.kategori === kode;
    })
    .sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));
  const totalMasuk = rows.reduce((s, t) => s + t.masuk, 0);
  const totalKeluar = rows.reduce((s, t) => s + t.keluar, 0);
  return { kode, nama: namaKode(kode), rows, totalMasuk, totalKeluar, saldo: totalMasuk - totalKeluar, mulai, sampai };
}

/**
 * Adapter P0-5: bentuk laporan Pembantu dari Buku Besar berbasis jurnal.
 *
 * Arah masuk/keluar mengikuti `posisi_normal` akun, bukan `isAkunKas`:
 * - DEBIT (kas, panjar, piutang): masuk = debit, keluar = kredit;
 * - KREDIT (pendapatan, hutang, modal): masuk = kredit, keluar = debit.
 * Akun AKTIVA non-kas seperti 1040/1050 juga bersaldo normal DEBIT, sehingga
 * tidak boleh diperlakukan seperti akun lawan kas.
 *
 * Saldo awal/akhir memakai perhitungan Buku Besar (saldo normal akun), bukan
 * sekadar total masuk − keluar periode, sehingga tetap benar saat ada saldo
 * sebelum tanggal "mulai".
 */
export function pembantuDariBukuBesar(bb: BukuBesarHasil): PembantuHasil {
  // `kas` hanya untuk kompatibilitas kolom legacy Transaksi; arah nominal
  // tetap ditentukan posisi normal akun.
  const kas = isAkunKas(bb.kode);
  const debitMasuk = bb.posisi_normal === 'DEBIT';
  const rows: Transaksi[] = bb.rows.map((r, i) => ({
    id: `${r.jurnal_id}:${r.baris_id ?? i}`,
    tanggal: r.tanggal,
    keterangan: r.keterangan,
    akun_kas: kas ? bb.kode : '',
    kategori: kas ? '' : bb.kode,
    masuk: debitMasuk ? r.debit : r.kredit,
    keluar: debitMasuk ? r.kredit : r.debit,
  }));
  const totalMasuk = rows.reduce((s, t) => s + t.masuk, 0);
  const totalKeluar = rows.reduce((s, t) => s + t.keluar, 0);
  return {
    kode: bb.kode,
    nama: bb.nama,
    rows,
    totalMasuk,
    totalKeluar,
    saldoAwal: bb.saldoAwal,
    saldo: bb.saldoAkhir,
    mulai: bb.mulai,
    sampai: bb.sampai,
  };
}
