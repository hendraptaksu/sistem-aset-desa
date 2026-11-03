// Adapter DB Wizard Saldo Awal (P1-6).
//
// Prinsip:
// - Saldo awal hanya boleh dibuat SEKALI. Jurnal harian yang sudah ada tidak
//   menutup wizard, tetapi tanggal saldo awal tidak boleh setelah jurnal
//   paling awal agar tidak ada transaksi yang mendahului saldo awal.
// - Pemeriksaan eksistensi SALDO_AWAL, batas tanggal, dan penulisan jurnal
//   dilakukan DI DALAM transaksi DB yang sama (race-safe), bukan hanya di UI.
//   DB-04 menambahkan unique index sebagai penjaga terakhir.
// - Hasilnya tetap satu jurnal double-entry seimbang (jenis SALDO_AWAL); tidak
//   ada tabel saldo/angka turunan. Laporan selalu dihitung dari jurnal.
// - Audit `SALDO-AWAL` ditulis atomik bersama jurnal lewat `postingSaldoAwal`.

import type Database from 'better-sqlite3';
import {
  tanggalKalenderValid,
  type HasilValidasiJurnal,
  type JurnalInput,
} from '../core/posting.js';
import {
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  setPengaturan,
} from './repository.js';
import { postingSaldoAwal, type HasilPosting } from './posting.js';

export const PESAN_SALDO_AWAL_SUDAH_ADA =
  'Saldo awal sudah pernah dibuat. Gunakan koreksi/jurnal biasa.';

export type StatusSaldoAwal = {
  boleh: boolean;
  jumlahJurnal: number;
  /**
   * AUD2-02: tanggal jurnal paling awal bila sudah ada jurnal. Wizard memakai
   * nilai ini sebagai batas atas tanggal saldo awal yang masih bisa disusulkan.
   */
  tanggalMaksimal?: string;
  /** Diisi bila tidak boleh; siap ditampilkan di UI. */
  alasan?: string;
};

export type OpsiSimpanSaldoAwal = {
  /** Operator sudah melihat peringatan (mis. kas minus) dan memilih lanjut. */
  konfirmasiPeringatan?: boolean;
  /** AKT-06: alasan operator melanjutkan meski ada peringatan. */
  alasanPeringatan?: string;
  /** AKT-06: diteruskan ke posting layer; wajib alasan ≥5 karakter. */
  wajibAlasanPeringatan?: boolean;
  /** AKT-02: diteruskan ke posting layer; jenis SALDO_AWAL selalu dikecualikan. */
  wajibSaldoAwal?: boolean;
  konfirmasiTanpaSaldoAwal?: boolean;
};

function hitungJurnal(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM jurnal').get() as { total: number };
  return Number(row.total);
}

/** Tanggal jurnal paling awal; `undefined` bila tabel jurnal masih kosong. */
function tanggalJurnalPertama(db: Database.Database): string | undefined {
  const row = db.prepare('SELECT MIN(tanggal) AS awal FROM jurnal').get() as {
    awal: string | null;
  };
  const awal = row.awal == null ? '' : String(row.awal).trim();
  return awal || undefined;
}

/**
 * DB-04: apakah jurnal SALDO_AWAL sudah pernah dibuat. Deteksi memakai
 * eksistensi baris (didukung `ux_jurnal_saldo_awal`), bukan jumlah seluruh
 * jurnal. Dengan demikian jurnal harian biasa tidak dianggap saldo awal.
 */
export function sudahAdaSaldoAwal(db: Database.Database): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM jurnal WHERE jenis = 'SALDO_AWAL' LIMIT 1").get(),
  );
}

/**
 * Status wizard untuk UI: terkunci hanya bila SALDO_AWAL sudah ada.
 * `jumlahJurnal` tetap jumlah seluruh jurnal agar informasi status transparan.
 * Bila sudah ada jurnal, `tanggalMaksimal` memberi batas atas tanggal saldo
 * awal yang masih boleh disusulkan (AUD2-02).
 */
export function statusSaldoAwal(db: Database.Database): StatusSaldoAwal {
  const jumlahJurnal = hitungJurnal(db);
  const tanggalMaksimal = tanggalJurnalPertama(db);
  const dasar = tanggalMaksimal
    ? { jumlahJurnal, tanggalMaksimal }
    : { jumlahJurnal };
  return sudahAdaSaldoAwal(db)
    ? {
        boleh: false,
        ...dasar,
        alasan: PESAN_SALDO_AWAL_SUDAH_ADA,
      }
    : { boleh: true, ...dasar };
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
 * AUD2-02: saldo awal tetap hanya sekali, tetapi boleh disusulkan setelah ada
 * jurnal harian selama tanggalnya tidak setelah jurnal paling awal. Semua
 * pemeriksaan (SALDO_AWAL sudah ada, batas tanggal) dan penulisan jurnal berada
 * dalam satu transaksi, sehingga dua penyimpanan bersamaan tidak bisa sama-sama
 * lolos; unique index `ux_jurnal_saldo_awal` menjadi penjaga terakhir.
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
      if (sudahAdaSaldoAwal(db)) return hasilGagal(PESAN_SALDO_AWAL_SUDAH_ADA);

      const tanggalSaldoAwal = String(input.header.tanggal ?? '').trim();
      const jurnalPertama = tanggalJurnalPertama(db);
      if (
        jurnalPertama &&
        tanggalKalenderValid(tanggalSaldoAwal) &&
        tanggalSaldoAwal > jurnalPertama
      ) {
        return hasilGagal(
          `Tanggal saldo awal (${tanggalSaldoAwal}) tidak boleh setelah transaksi paling awal (${jurnalPertama}).`,
        );
      }

      const hasil = postingSaldoAwal(db, input, {
        konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        alasanPeringatan: opsi.alasanPeringatan,
        wajibAlasanPeringatan: opsi.wajibAlasanPeringatan === true,
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
