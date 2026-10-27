// Penjadwal backup harian untuk app yang dibiarkan terbuka (AUD-13).
// Modul ini tidak mengimpor Electron supaya bisa diuji dengan timer palsu.
//
// Alur: tiap interval, cek backup otomatis terakhir. Bila tanggalnya belum
// sama dengan tanggal lokal hari ini, panggil `autoBackupHarian` (yang juga
// idempoten per hari). Guard boolean mencegah dua proses backup tumpang tindih.

import type Database from 'better-sqlite3';
import { autoBackupHarian, lastAutoBackup } from '../features/export/export.js';
import { tanggalLokal } from '../utils/tanggal.js';

/** Interval ringan: cukup untuk menangkap pergantian hari tanpa membebani app. */
export const INTERVAL_BACKUP_MS = 30 * 60 * 1000;

export type OpsiBackupPeriodik = {
  /** Koneksi aktif; dibaca ulang agar tetap benar setelah restore. */
  db: () => Database.Database;
  dirBackup: () => string;
  /** Tanggal lokal saat ini; bisa dipatok di test. */
  tanggal?: () => string;
  keep?: number;
  intervalMs?: number;
  /** Dipanggil hanya saat file backup baru benar-benar dibuat. */
  onBackup?: (path: string) => void;
  onError?: (error: unknown) => void;
  /** Pengganti autoBackupHarian untuk test. */
  backupHarian?: (
    db: Database.Database,
    dir: string,
    keep: number,
    stamp: string,
  ) => string;
};

/**
 * True bila file backup terakhir sudah memakai tanggal yang sama.
 * `pathTerakhir` kosong berarti belum ada backup.
 */
export function sudahBackupUntukTanggal(pathTerakhir: string, tanggal: string): boolean {
  const nama = pathTerakhir.split(/[\\/]/).pop() ?? '';
  return nama === `auto-${tanggal}.db`;
}

/**
 * Pasang interval backup periodik. Mengembalikan fungsi penghenti yang wajib
 * dipanggil saat app quit (atau akhir test). Timer di-`unref()` agar tidak
 * menahan proses hidup bila lupa dihentikan.
 */
export function mulaiBackupPeriodik(opsi: OpsiBackupPeriodik): () => void {
  const intervalMs = opsi.intervalMs ?? INTERVAL_BACKUP_MS;
  const keep = opsi.keep ?? 7;
  const tanggal = opsi.tanggal ?? (() => tanggalLokal());
  const backup = opsi.backupHarian ?? autoBackupHarian;

  let berjalan = false;
  let dihentikan = false;

  function cek(): void {
    if (berjalan || dihentikan) return;
    berjalan = true;
    try {
      const hariIni = tanggal();
      const dir = opsi.dirBackup();
      if (sudahBackupUntukTanggal(lastAutoBackup(dir), hariIni)) return;
      const path = backup(opsi.db(), dir, keep, hariIni);
      opsi.onBackup?.(path);
    } catch (e) {
      opsi.onError?.(e);
    } finally {
      berjalan = false;
    }
  }

  const timer = setInterval(cek, intervalMs);
  timer.unref?.();

  return () => {
    dihentikan = true;
    clearInterval(timer);
  };
}
