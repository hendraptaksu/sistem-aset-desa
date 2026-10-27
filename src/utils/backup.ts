// Helper usia backup (AUD-13) — murni, aman untuk main + renderer.
// Tidak memakai Node/Electron API agar mudah diuji dan dipakai dashboard.

import { tanggalLokal } from './tanggal.js';

const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Nomor hari (UTC) dari tanggal kalender `YYYY-MM-DD`; null bila tidak valid. */
function nomorHari(tanggal: string): number | null {
  const m = POLA_TANGGAL.exec(tanggal.trim());
  if (!m) return null;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  const ms = Date.UTC(tahun, bulan - 1, hari);
  const cek = new Date(ms);
  if (
    tahun < 1900 ||
    tahun > 9999 ||
    cek.getUTCFullYear() !== tahun ||
    cek.getUTCMonth() !== bulan - 1 ||
    cek.getUTCDate() !== hari
  ) {
    return null;
  }
  return Math.floor(ms / 86_400_000);
}

/**
 * Usia backup dalam hari kalender (bisa negatif bila tanggal backup di masa
 * depan). Mengembalikan `null` bila tanggal backup/sekarang tidak valid —
 * dashboard tidak boleh crash karena data backup yang tidak tersedia.
 *
 * `sekarang` boleh `YYYY-MM-DD` atau Date/number; Date dikonversi ke tanggal
 * lokal aplikasi (WITA), bukan UTC.
 */
export function usiaBackupHari(
  tanggalBackup: string | null | undefined,
  sekarang: string | Date | number = new Date(),
): number | null {
  const hariBackup = nomorHari(String(tanggalBackup ?? ''));
  if (hariBackup === null) return null;

  let tanggalSekarang: string;
  try {
    tanggalSekarang = typeof sekarang === 'string' ? sekarang : tanggalLokal(sekarang);
  } catch {
    return null;
  }
  const hariSekarang = nomorHari(tanggalSekarang);
  if (hariSekarang === null) return null;

  return hariSekarang - hariBackup;
}

/**
 * Ambil tanggal dari nama file backup otomatis `auto-YYYY-MM-DD.db`.
 * Menerima path POSIX maupun Windows; null bila bukan backup otomatis.
 */
export function tanggalDariPathBackup(path: string | null | undefined): string | null {
  const nama = String(path ?? '').split(/[\\/]/).pop() ?? '';
  const m = /^auto-(\d{4}-\d{2}-\d{2})\.db$/.exec(nama);
  return m?.[1] ?? null;
}

/** Ambang peringatan dashboard: backup lebih tua dari 2 hari dianggap basi. */
export const BATAS_BACKUP_BASI_HARI = 2;

/**
 * Pesan banner amber untuk dashboard; null bila backup masih segar atau
 * usianya tidak diketahui.
 */
export function pesanBackupBasi(usiaHari: number | null | undefined): string | null {
  if (usiaHari === null || usiaHari === undefined) return null;
  if (!Number.isFinite(usiaHari) || usiaHari <= BATAS_BACKUP_BASI_HARI) return null;
  return `Backup terakhir ${usiaHari} hari lalu — buat backup sekarang.`;
}

/** Nama file backup dari path POSIX/Windows; null bila path kosong. */
export function namaFileBackup(path: string | null | undefined): string | null {
  const teks = String(path ?? '').trim();
  if (!teks) return null;
  const nama = teks.split(/[\\/]/).filter(Boolean).pop();
  return nama || null;
}

/**
 * Label usia backup untuk status di dashboard. Tanggal yang tidak bisa
 * diturunkan (null/tidak valid/di masa depan) ditampilkan sebagai
 * "Tanggal tidak diketahui" agar operator tidak menerima info menyesatkan.
 */
export function labelUsiaBackup(usiaHari: number | null | undefined): string {
  if (
    usiaHari === null ||
    usiaHari === undefined ||
    !Number.isFinite(usiaHari) ||
    usiaHari < 0
  ) {
    return 'Tanggal tidak diketahui';
  }
  const hari = Math.trunc(usiaHari);
  if (hari === 0) return 'hari ini';
  if (hari === 1) return '1 hari lalu';
  return `${hari} hari lalu`;
}

/** Tone badge status backup: segar hijau, basi amber, tidak diketahui batu. */
export function toneStatusBackup(
  usiaHari: number | null | undefined,
): 'green' | 'amber' | 'stone' {
  if (
    usiaHari === null ||
    usiaHari === undefined ||
    !Number.isFinite(usiaHari) ||
    usiaHari < 0
  ) {
    return 'stone';
  }
  return usiaHari <= BATAS_BACKUP_BASI_HARI ? 'green' : 'amber';
}

export type RingkasanBackup = {
  namaFile: string | null;
  tanggal: string | null;
  usiaHari: number | null;
  label: string;
  tone: 'green' | 'amber' | 'stone';
};

/**
 * Ringkasan satu path backup untuk kartu dashboard: nama file, tanggal dari
 * nama `auto-YYYY-MM-DD.db`, usia, label, dan tone badge.
 */
export function ringkasanBackup(
  path: string | null | undefined,
  sekarang: string | Date | number = new Date(),
): RingkasanBackup {
  const namaFile = namaFileBackup(path);
  const tanggal = tanggalDariPathBackup(path);
  const usiaHari = usiaBackupHari(tanggal, sekarang);
  return {
    namaFile,
    tanggal,
    usiaHari,
    label: labelUsiaBackup(usiaHari),
    tone: toneStatusBackup(usiaHari),
  };
}
