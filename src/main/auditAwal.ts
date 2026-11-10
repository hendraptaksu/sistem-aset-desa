// DB-12 — audit integritas saat aplikasi mulai.
//
// Startup tidak boleh diblokir oleh temuan audit: operator tetap harus bisa
// membuka aplikasi untuk memeriksa/memperbaiki data. Modul ini hanya membaca,
// mencatat ringkasan + temuan ke log, dan tidak pernah menulis DB atau melempar
// error. Seluruh pemeriksaan tetap di `db/integritas.ts` (AKT-09/DB-12); modul
// ini hanyalah pembungkus pencatatan, bukan modul audit kedua.

import type Database from 'better-sqlite3';
import {
  auditIntegritas,
  type HasilAuditIntegritas,
} from '../db/integritas.js';
import type { LoggerApp } from './logApp.js';

export {
  KODE_AUDIT_KRITIS,
  ringkasanAuditAwal,
  temuanKritis,
  type KodeAuditKritis,
  type RingkasanAuditAwal,
} from '../core/auditAwalRingkasan.js';

export type LoggerAuditAwal = Pick<LoggerApp, 'info' | 'warn'>;

/** Batas temuan yang ditulis ke log agar satu baris tidak terlalu panjang. */
export const MAKS_TEMUAN_LOG = 10;

/**
 * Jalankan audit saat startup. Selalu mengembalikan hasil (atau `null` bila
 * audit sendiri gagal) dan tidak pernah melempar error, sehingga pemanggil
 * dapat melanjutkan membuka window/backup.
 */
export function auditIntegritasSaatMulai(
  db: Database.Database,
  log?: LoggerAuditAwal | null,
): HasilAuditIntegritas | null {
  try {
    const hasil = auditIntegritas(db);
    if (hasil.ok) {
      log?.info('[audit-integritas] Data lolos audit integritas.');
      return hasil;
    }

    const rincian = hasil.temuan
      .slice(0, MAKS_TEMUAN_LOG)
      .map((t) => `[${t.kode}] ${t.pesan}`)
      .join(' ');
    const sisa =
      hasil.temuan.length > MAKS_TEMUAN_LOG
        ? ` (+${hasil.temuan.length - MAKS_TEMUAN_LOG} temuan lain)`
        : '';
    log?.warn(`[audit-integritas] ${hasil.ringkasan}${sisa} ${rincian}`.trim());
    return hasil;
  } catch (e) {
    // Audit gagal dibaca tidak boleh menghalangi aplikasi. Jangan menyembunyikan
    // masalah: catat error-nya agar pendamping bisa memeriksa log.
    log?.warn('[audit-integritas] audit saat mulai gagal dijalankan', e);
    return null;
  }
}
