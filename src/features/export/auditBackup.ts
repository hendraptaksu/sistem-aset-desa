// DB-12 — audit integritas sebelum membuat backup.
//
// Backup yang dibuat dari DB rusak tidak akan lolos `validasiKandidatRestore`
// (AKT-11). Agar tidak menghasilkan kandidat restore yang menyesatkan dan tidak
// diam-diam mengabaikan kerusakan, backup baru dibatalkan bila audit menemukan
// masalah. Audit hanya membaca; tidak ada perbaikan otomatis.
//
// Modul kecil ini dipakai jalur backup lengkap dan auto-backup harian. Ia bukan
// modul audit kedua: seluruh pemeriksaan tetap di `db/integritas.ts`.

import type Database from 'better-sqlite3';
import {
  auditIntegritas,
  type HasilAuditIntegritas,
} from '../../db/integritas.js';

/** Awalan pesan yang aman ditampilkan ke operator (tanpa istilah teknis). */
export const PESAN_BACKUP_AUDIT_GAGAL =
  'Backup dibatalkan: data tidak lolos audit integritas.';

/**
 * Jalankan audit sebelum backup. Mengembalikan hasil audit bila lolos;
 * melempar error berisi ringkasan + temuan bila ada masalah.
 *
 * Fail-safe ini sengaja sama dengan validasi restore: backup yang tidak akan
 * bisa dipulihkan tidak boleh dibuat seolah-olah sehat. Pemanggil (startup,
 * penjadwal, IPC) menangkap error dan menuliskannya ke log.
 */
export function auditSebelumBackup(db: Database.Database): HasilAuditIntegritas {
  const audit = auditIntegritas(db);
  if (audit.ok) return audit;

  const rincian = audit.temuan
    .slice(0, 5)
    .map((t) => `[${t.kode}] ${t.pesan}`)
    .join(' ');
  const sisa = audit.temuan.length > 5 ? ` (+${audit.temuan.length - 5} temuan lain)` : '';
  const pesan = `${PESAN_BACKUP_AUDIT_GAGAL} ${audit.ringkasan} ${rincian}${sisa}`.trim();
  throw new Error(pesan.length > 400 ? `${pesan.slice(0, 397)}...` : pesan);
}
