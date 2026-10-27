// Buku Pembantu — filter per kode akun (kas/bank atau akun lawan apa pun:
// PENDAPATAN/BEBAN/1040/1050/2050/3000) + Total Masuk/Keluar/Saldo.
// Sumber angka = Buku Besar dari jurnal double-entry; tidak ada tabel lama.

import { isAkunKas } from '../../../db/coa.js';
import type { BukuBesarHasil } from '../../../core/reports.js';
import type { BarisPembantu, PembantuHasil } from '../types.js';

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
  const debitMasuk = bb.posisi_normal === 'DEBIT';
  const rows: BarisPembantu[] = bb.rows.map((r, i) => ({
    id: `${r.jurnal_id}:${r.baris_id ?? i}`,
    tanggal: r.tanggal,
    keterangan: r.keterangan,
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
