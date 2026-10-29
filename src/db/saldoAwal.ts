// Adapter DB Wizard Saldo Awal (P1-6).
//
// Prinsip:
// - Saldo awal hanya boleh dibuat SEKALI, saat tabel `jurnal` masih kosong.
//   Pemeriksaan jumlah jurnal dilakukan DI DALAM transaksi DB yang sama dengan
//   penulisan jurnal (race-safe), bukan hanya di UI.
// - Hasilnya tetap satu jurnal double-entry seimbang (jenis SALDO_AWAL); tidak
//   ada tabel saldo/angka turunan. Laporan selalu dihitung dari jurnal.
// - Audit `SALDO-AWAL` ditulis atomik bersama jurnal lewat `postingSaldoAwal`.

import type Database from 'better-sqlite3';
import type { HasilValidasiJurnal, JurnalInput } from '../core/posting.js';
import {
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  setPengaturan,
} from './repository.js';
import { postingSaldoAwal, type HasilPosting } from './posting.js';

export const PESAN_SALDO_AWAL_SUDAH_ADA =
  'Saldo awal hanya bisa diisi saat belum ada jurnal. Gunakan koreksi/jurnal biasa.';

export type StatusSaldoAwal = {
  boleh: boolean;
  jumlahJurnal: number;
  /** Diisi bila tidak boleh; siap ditampilkan di UI. */
  alasan?: string;
};

export type OpsiSimpanSaldoAwal = {
  /** Operator sudah melihat peringatan (mis. kas minus) dan memilih lanjut. */
  konfirmasiPeringatan?: boolean;
  /** AKT-02: diteruskan ke posting layer; jenis SALDO_AWAL selalu dikecualikan. */
  wajibSaldoAwal?: boolean;
  konfirmasiTanpaSaldoAwal?: boolean;
};

function hitungJurnal(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM jurnal').get() as { total: number };
  return Number(row.total);
}

/** Status wizard: hanya boleh saat belum ada jurnal sama sekali. */
export function statusSaldoAwal(db: Database.Database): StatusSaldoAwal {
  const jumlahJurnal = hitungJurnal(db);
  return jumlahJurnal === 0
    ? { boleh: true, jumlahJurnal }
    : { boleh: false, jumlahJurnal, alasan: PESAN_SALDO_AWAL_SUDAH_ADA };
}

function hasilGagal(pesan: string): HasilPosting {
  const hasil: HasilValidasiJurnal = {
    boleh: false,
    errors: [pesan],
    peringatan: [],
    perluKonfirmasi: false,
  };
  return { ...hasil, tersimpan: false };
}

/**
 * Simpan saldo awal sebagai satu jurnal seimbang + audit SALDO-AWAL.
 *
 * Pemeriksaan "jurnal masih kosong" dan penulisan jurnal berada dalam satu
 * transaksi, sehingga jurnal kedua (termasuk jurnal balik) tidak bisa membuat
 * saldo awal baru. Bila sudah ada jurnal, hasilnya `tersimpan: false` dengan
 * pesan yang sama seperti status UI.
 */
export function simpanSaldoAwal(
  db: Database.Database,
  input: JurnalInput,
  opsi: OpsiSimpanSaldoAwal = {},
): HasilPosting {
  if (!input || !input.header || !Array.isArray(input.baris))
    return hasilGagal('Data saldo awal tidak lengkap.');

  try {
    const simpan = db.transaction((): HasilPosting => {
      if (hitungJurnal(db) > 0) return hasilGagal(PESAN_SALDO_AWAL_SUDAH_ADA);
      const hasil = postingSaldoAwal(db, input, {
        konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        wajibSaldoAwal: opsi.wajibSaldoAwal === true,
        konfirmasiTanpaSaldoAwal: opsi.konfirmasiTanpaSaldoAwal === true,
      });
      // AKT-03: tanggal jurnal saldo awal menjadi batas bawah pembukuan.
      // Ditulis di transaksi yang sama dengan jurnal + audit; bila penulisan
      // setting gagal, seluruh saldo awal ikut dibatalkan.
      if (hasil.tersimpan) {
        const tanggalMulai = String(
          hasil.jurnal?.tanggal ?? input.header.tanggal ?? '',
        ).trim();
        if (tanggalMulai)
          setPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI, tanggalMulai);
      }
      return hasil;
    });
    return simpan();
  } catch (e) {
    return hasilGagal(
      `Saldo awal gagal disimpan: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
