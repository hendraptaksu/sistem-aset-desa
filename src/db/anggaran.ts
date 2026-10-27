// Adapter DB pagu anggaran (P2-1).
//
// Tabel `anggaran` HANYA menyimpan pagu. Realisasi/sisa/% tidak pernah
// disimpan: laporan mengambil baris jurnal lewat `listBarisJurnal` lalu
// menyerahkan perhitungan ke core/anggaran.ts (yang memakai labaRugi()).
// Simpan pagu = upsert atomik + audit `ANGGARAN`.

import type Database from 'better-sqlite3';
import {
  hitungRealisasiAnggaran,
  validasiBarisAnggaran,
  validasiTahunAnggaran,
  type AnggaranBarisInput,
  type RealisasiAnggaranHasil,
} from '../core/anggaran.js';
import { catatAudit, listAkun } from './repository.js';
import { listBarisJurnal } from './laporan.js';

export type AnggaranDb = {
  tahun: number;
  akun_kode: string;
  nominal: number;
  created_at: string;
  updated_at: string;
};

export type AnggaranTahun = {
  tahun: number;
  baris: AnggaranDb[];
  /** Total pagu tahun tersebut (SEN). */
  total: number;
};

export type OpsiSimpanAnggaran = {
  /** Alasan opsional yang ikut dicatat di audit. */
  alasan?: string;
  /**
   * Default true: baris dengan nominal 0 dihapus, bukan disimpan sebagai pagu
   * nol. Dengan begitu "kosongkan pagu" cukup isi 0. Baris lain yang tidak
   * dikirim TIDAK dihapus (simpan bersifat upsert parsial).
   */
  hapusNol?: boolean;
};

const rowToAnggaran = (r: Record<string, unknown>): AnggaranDb => ({
  tahun: Number(r.tahun),
  akun_kode: String(r.akun_kode),
  nominal: Number(r.nominal),
  created_at: String(r.created_at ?? ''),
  updated_at: String(r.updated_at ?? ''),
});

/** Daftar pagu satu tahun, urut kode akun. */
export function listAnggaran(db: Database.Database, tahunInput: unknown): AnggaranDb[] {
  const tahun = validasiTahunAnggaran(tahunInput);
  const rows = db
    .prepare(
      `SELECT tahun, akun_kode, nominal, created_at, updated_at
       FROM anggaran WHERE tahun = ? ORDER BY akun_kode`,
    )
    .all(tahun) as Record<string, unknown>[];
  return rows.map(rowToAnggaran);
}

/** Pagu satu tahun + total; dipakai IPC `anggaran:list` dan layar UI. */
export function getAnggaranTahun(db: Database.Database, tahunInput: unknown): AnggaranTahun {
  const tahun = validasiTahunAnggaran(tahunInput);
  const baris = listAnggaran(db, tahun);
  return { tahun, baris, total: baris.reduce((s, b) => s + b.nominal, 0) };
}

/**
 * Simpan pagu satu tahun secara atomik: upsert per akun, hapus baris bernominal
 * 0 (default), lalu tulis audit `ANGGARAN` berisi kondisi lama & baru.
 * Validasi akun/tahun/nominal memakai fungsi murni core/anggaran.ts.
 */
export function simpanAnggaran(
  db: Database.Database,
  tahunInput: unknown,
  barisInput: unknown,
  opsi: OpsiSimpanAnggaran = {},
): AnggaranDb[] {
  const tahun = validasiTahunAnggaran(tahunInput);
  // Validasi terhadap master `akun` (termasuk flag aktif), bukan hanya COA statis.
  const baris = validasiBarisAnggaran(barisInput, listAkun(db));
  const hapusNol = opsi.hapusNol !== false;

  const simpan = db.transaction(() => {
    const lama = listAnggaran(db, tahun);
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO anggaran (tahun, akun_kode, nominal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(tahun, akun_kode) DO UPDATE SET
         nominal = excluded.nominal,
         updated_at = excluded.updated_at`,
    );
    const hapus = db.prepare('DELETE FROM anggaran WHERE tahun = ? AND akun_kode = ?');

    for (const b of baris) {
      if (hapusNol && b.nominal === 0) {
        hapus.run(tahun, b.akun_kode);
      } else {
        upsert.run(tahun, b.akun_kode, b.nominal, now, now);
      }
    }

    const baru = listAnggaran(db, tahun);
    catatAudit(db, {
      aksi: 'ANGGARAN',
      alasan: String(opsi.alasan ?? '').trim(),
      lama: { tahun, baris: lama },
      baru: { tahun, baris: baru },
    });
    return baru;
  });

  return simpan();
}

export type FilterLaporanAnggaran = {
  tahun: unknown;
  mulai?: string;
  sampai?: string;
};

/**
 * Realisasi vs pagu satu tahun. Semua angka realisasi berasal dari
 * `listBarisJurnal` + core `hitungRealisasiAnggaran` (labaRugi), bukan tabel
 * transaksi single-entry. Bila mulai/sampai tidak diberikan, dipakai tahun
 * kalender 1 Jan–31 Des; main dapat mengirim rentang tahun buku (P1-13).
 */
export function laporanRealisasiAnggaran(
  db: Database.Database,
  filter: FilterLaporanAnggaran,
): RealisasiAnggaranHasil {
  const tahun = validasiTahunAnggaran(filter.tahun);
  const mulai = filter.mulai ?? `${tahun}-01-01`;
  const sampai = filter.sampai ?? `${tahun}-12-31`;

  const anggaran = listAnggaran(db, tahun).map((a) => ({
    tahun: a.tahun,
    akun_kode: a.akun_kode,
    nominal: a.nominal,
  }));
  const daftarAkun = listAkun(db);
  const barisJurnal = listBarisJurnal(
    db,
    filter.sampai ? { sampai: filter.sampai } : {},
  );

  return hitungRealisasiAnggaran(anggaran, barisJurnal, { mulai, sampai }, daftarAkun);
}

export type { AnggaranBarisInput };
