// AKT-09: audit integritas akuntansi.
//
// Modul ini hanya MEMBACA database lalu mengembalikan daftar temuan. Tidak ada
// perbaikan otomatis dan tidak ada angka turunan yang disimpan. Temuan bukan
// error: pemanggil (mis. tutup buku atau restore) yang memutuskan menolak
// operasi. Error SQL tetap dilempar bila database memang tidak bisa dibaca.
//
// Saldo kas negatif sengaja TIDAK diperiksa di sini: itu peringatan
// operasional yang sudah ditangani terpisah, bukan kerusakan integritas DB.

import type Database from 'better-sqlite3';
import { formatRp } from '../utils/format.js';

export type KodeTemuan =
  | 'JURNAL_TIDAK_SEIMBANG'
  | 'JURNAL_KURANG_DUA_BARIS'
  | 'AKUN_TIDAK_DIKENAL'
  | 'BARIS_ORPHAN'
  | 'FOREIGN_KEY'
  | 'NOMOR_BUKTI_DUPLIKAT'
  | 'PANJAR_CLOSED_TIDAK_LENGKAP'
  | 'PANJAR_OPEN_PUNYA_CLOSE';

/** Satu temuan integritas; `detail` berisi data mentah untuk diagnosis. */
export type Temuan = {
  kode: KodeTemuan;
  pesan: string;
  detail?: unknown;
};

export type HasilAuditIntegritas = {
  /** `true` hanya bila tidak ada temuan sama sekali. */
  ok: boolean;
  temuan: Temuan[];
  /** Ringkasan bahasa Indonesia yang memuat jumlah temuan. */
  ringkasan: string;
};

type BarisTidakSeimbang = {
  id: string;
  tanggal: string;
  no_bukti: string;
  debit: number;
  kredit: number;
};

type BarisKurangDua = {
  id: string;
  tanggal: string;
  no_bukti: string;
  jumlah_baris: number;
};

type BarisAkunAsing = {
  baris_id: number;
  jurnal_id: string;
  akun_kode: string;
};

type BarisOrphan = {
  baris_id: number;
  jurnal_id: string;
};

type PelanggaranFk = {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
};

type NomorBuktiDuplikat = {
  tahun: string;
  no_bukti: string;
  jumlah: number;
};

type PanjarTidakKonsisten = {
  id: string;
  status: string;
  jurnal_close_id: string | null;
  tanggal_close: string | null;
};

/**
 * Audit integritas akuntansi tingkat DB.
 *
 * Pemeriksaan:
 * 1. total debit = total kredit per jurnal (hanya jurnal yang punya baris);
 * 2. setiap jurnal minimal punya 2 baris;
 * 3. setiap `akun_kode` baris ada di master `akun`;
 * 4. tidak ada baris yatim (`jurnal_id` tanpa kepala jurnal);
 * 5. semua foreign key lolos `PRAGMA foreign_key_check`;
 * 6. nomor bukti unik per tahun (kosong diabaikan);
 * 7. status panjar konsisten dengan kolom close-nya.
 *
 * Hasil selalu deterministik dan tidak mengubah database.
 */
export function auditIntegritas(db: Database.Database): HasilAuditIntegritas {
  const temuan: Temuan[] = [];

  const tidakSeimbang = db
    .prepare(
      `SELECT j.id, j.tanggal, j.no_bukti,
              SUM(b.debit) AS debit, SUM(b.kredit) AS kredit
         FROM jurnal j
         JOIN jurnal_baris b ON b.jurnal_id = j.id
        GROUP BY j.id
       HAVING SUM(b.debit) <> SUM(b.kredit)
        ORDER BY j.tanggal, j.id`,
    )
    .all() as BarisTidakSeimbang[];
  for (const r of tidakSeimbang) {
    temuan.push({
      kode: 'JURNAL_TIDAK_SEIMBANG',
      pesan:
        `Jurnal ${r.id} tanggal ${r.tanggal} tidak seimbang: ` +
        `debit ${formatRp(r.debit)} tidak sama dengan kredit ${formatRp(r.kredit)}.`,
      detail: r,
    });
  }

  const kurangDua = db
    .prepare(
      `SELECT j.id, j.tanggal, j.no_bukti, COUNT(b.id) AS jumlah_baris
         FROM jurnal j
         LEFT JOIN jurnal_baris b ON b.jurnal_id = j.id
        GROUP BY j.id
       HAVING COUNT(b.id) < 2
        ORDER BY j.tanggal, j.id`,
    )
    .all() as BarisKurangDua[];
  for (const r of kurangDua) {
    temuan.push({
      kode: 'JURNAL_KURANG_DUA_BARIS',
      pesan:
        `Jurnal ${r.id} tanggal ${r.tanggal} hanya punya ${r.jumlah_baris} baris; ` +
        `minimal 2 baris (debit dan kredit).`,
      detail: r,
    });
  }

  const akunAsing = db
    .prepare(
      `SELECT b.id AS baris_id, b.jurnal_id, b.akun_kode
         FROM jurnal_baris b
         LEFT JOIN akun a ON a.kode = b.akun_kode
        WHERE a.kode IS NULL
        ORDER BY b.id`,
    )
    .all() as BarisAkunAsing[];
  for (const r of akunAsing) {
    temuan.push({
      kode: 'AKUN_TIDAK_DIKENAL',
      pesan:
        `Baris jurnal ${r.baris_id} pada jurnal ${r.jurnal_id} memakai akun ` +
        `${r.akun_kode} yang tidak terdaftar di master akun.`,
      detail: r,
    });
  }

  const barisOrphan = db
    .prepare(
      `SELECT b.id AS baris_id, b.jurnal_id
         FROM jurnal_baris b
         LEFT JOIN jurnal j ON j.id = b.jurnal_id
        WHERE j.id IS NULL
        ORDER BY b.id`,
    )
    .all() as BarisOrphan[];
  for (const r of barisOrphan) {
    temuan.push({
      kode: 'BARIS_ORPHAN',
      pesan:
        `Baris jurnal ${r.baris_id} merujuk jurnal ${r.jurnal_id} ` +
        `yang tidak ada (baris yatim).`,
      detail: r,
    });
  }

  const pelanggaranFk = db.pragma('foreign_key_check') as PelanggaranFk[];
  for (const r of pelanggaranFk) {
    temuan.push({
      kode: 'FOREIGN_KEY',
      pesan:
        `Pelanggaran foreign key: tabel ${r.table} baris ${r.rowid ?? '-'} ` +
        `merujuk tabel ${r.parent} yang tidak punya pasangan.`,
      detail: r,
    });
  }

  const nomorDuplikat = db
    .prepare(
      `SELECT substr(j.tanggal, 1, 4) AS tahun,
              j.no_bukti AS no_bukti,
              COUNT(*) AS jumlah
         FROM jurnal j
        WHERE j.no_bukti <> ''
        GROUP BY substr(j.tanggal, 1, 4), j.no_bukti COLLATE NOCASE
       HAVING COUNT(*) > 1
        ORDER BY tahun, no_bukti`,
    )
    .all() as NomorBuktiDuplikat[];
  for (const r of nomorDuplikat) {
    temuan.push({
      kode: 'NOMOR_BUKTI_DUPLIKAT',
      pesan:
        `Nomor bukti "${r.no_bukti}" dipakai ${r.jumlah} kali pada tahun ${r.tahun}; ` +
        `nomor bukti harus unik per tahun.`,
      detail: r,
    });
  }

  const panjarClosed = db
    .prepare(
      `SELECT id, status, jurnal_close_id, tanggal_close
         FROM panjar
        WHERE status = 'CLOSED'
          AND (
            jurnal_close_id IS NULL OR jurnal_close_id = ''
            OR tanggal_close IS NULL OR tanggal_close = ''
          )
        ORDER BY id`,
    )
    .all() as PanjarTidakKonsisten[];
  for (const r of panjarClosed) {
    const kosong: string[] = [];
    if (!r.jurnal_close_id) kosong.push('jurnal_close_id');
    if (!r.tanggal_close) kosong.push('tanggal_close');
    temuan.push({
      kode: 'PANJAR_CLOSED_TIDAK_LENGKAP',
      pesan:
        `Panjar ${r.id} berstatus CLOSED tetapi ${kosong.join(' dan ')} ` +
        `masih kosong.`,
      detail: r,
    });
  }

  const panjarOpenDenganClose = db
    .prepare(
      `SELECT id, status, jurnal_close_id, tanggal_close
         FROM panjar
        WHERE status = 'OPEN'
          AND jurnal_close_id IS NOT NULL
          AND jurnal_close_id <> ''
        ORDER BY id`,
    )
    .all() as PanjarTidakKonsisten[];
  for (const r of panjarOpenDenganClose) {
    temuan.push({
      kode: 'PANJAR_OPEN_PUNYA_CLOSE',
      pesan:
        `Panjar ${r.id} berstatus OPEN tetapi sudah punya jurnal close ` +
        `${r.jurnal_close_id}.`,
      detail: r,
    });
  }

  const ok = temuan.length === 0;
  return {
    ok,
    temuan,
    ringkasan: ok
      ? 'Tidak ada temuan integritas akuntansi.'
      : `Ditemukan ${temuan.length} temuan integritas akuntansi.`,
  };
}
