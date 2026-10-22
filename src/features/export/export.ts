// Facade Node (main/tests) — re-export builder murni + helper fs.
// Renderer WAJIB import dari ./workbooks.js langsung (tanpa node:fs)
// agar build Vite tidak menarik `node:fs` ke browser.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import type ExcelJS from 'exceljs';
import { openDb, SCHEMA_VERSION } from '../../db/database.js';
import { catatAudit } from '../../db/repository.js';

export {
  KOP_ORG_NAMA,
  kopHtml,
  kopPeriode,
  kopPeriodeEfektif,
  rentangDariRows,
  pembantuToWorkbook,
  realisasiToWorkbook,
  surplusToWorkbook,
  neracaToWorkbook,
  bkuToWorkbook,
  workbookToBuffer,
  pembantuToHtml,
  realisasiToHtml,
  surplusToHtml,
  neracaToHtml,
  bkuToHtml,
  wrapPrintDocument,
} from './workbooks.js';

/** Tulis workbook ke file .xlsx. Return path untuk log. (Node/main saja) */
export async function writeXlsx(wb: ExcelJS.Workbook, filePath: string): Promise<string> {
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

// ---- Backup & restore .db (P0-8) ----
// JANGAN copy file .db mentah saat koneksi masih terbuka: transaksi terbaru
// bisa masih berada di WAL dan hilang dari salinan. Semua backup memakai
// `VACUUM INTO` lewat satu helper di bawah.

/** Hapus file DB beserta sidecar WAL/SHM agar tidak bercampur dengan hasil baru. */
function buangFileDb(path: string): void {
  for (const p of [path, `${path}-wal`, `${path}-shm`]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* biarkan pemanggil melaporkan error tulis utama */
    }
  }
}

/**
 * Backup aman dari koneksi yang sedang terbuka: `VACUUM INTO` menghasilkan
 * satu file konsisten (termasuk isi WAL), tanpa menghentikan aplikasi.
 * File tujuan lama (dan sidecar-nya) dihapus lebih dulu karena `VACUUM INTO`
 * menolak tujuan yang sudah ada. Path di-escape agar aman untuk nama folder
 * yang mengandung tanda kutip.
 */
export function backupVacuumInto(db: Database.Database, dest: string): string {
  mkdirSync(dirname(dest), { recursive: true });
  buangFileDb(dest);
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
  return dest;
}

/** Tabel yang wajib ada agar file dianggap backup aplikasi ini (skema v2). */
export const TABEL_WAJIB_RESTORE = [
  'akun',
  'jurnal',
  'jurnal_baris',
  'tutup_buku',
  'pengaturan',
  'audit_log',
  'aset',
] as const;

export type ValidasiRestore = { valid: true } | { valid: false; error: string };

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Validasi kandidat restore SEBELUM menyentuh DB aktif:
 * file ada & berupa file, SQLite terbaca, `integrity_check` = ok, bukan dari
 * versi aplikasi yang lebih baru, dan semua tabel wajib ada.
 */
export function validasiKandidatRestore(backupPath: string): ValidasiRestore {
  let kandidat: Database.Database | null = null;
  try {
    if (!existsSync(backupPath)) return { valid: false, error: 'File backup tidak ditemukan.' };
    const info = statSync(backupPath);
    if (!info.isFile()) return { valid: false, error: 'Backup harus berupa satu file .db.' };
    if (info.size === 0) return { valid: false, error: 'File backup kosong.' };

    kandidat = new Database(backupPath, { readonly: true, fileMustExist: true });
    const hasilIntegritas = kandidat.pragma('integrity_check') as { integrity_check: string }[];
    const pesanIntegritas = hasilIntegritas.map((r) => r.integrity_check).join('; ');
    if (pesanIntegritas.toLowerCase() !== 'ok')
      return {
        valid: false,
        error: `File backup rusak (integrity_check: ${pesanIntegritas || 'gagal'}).`,
      };

    const versi = Number(kandidat.pragma('user_version', { simple: true }) ?? 0);
    if (versi > SCHEMA_VERSION)
      return {
        valid: false,
        error: 'File backup dibuat oleh aplikasi versi lebih baru. Perbarui aplikasi dulu.',
      };

    const tabel = new Set(
      (kandidat.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]).map((r) => r.name),
    );
    const kurang = TABEL_WAJIB_RESTORE.filter((t) => !tabel.has(t));
    if (kurang.length > 0)
      return {
        valid: false,
        error: `File ini bukan backup aplikasi ini (tabel ${kurang.join(', ')} tidak ditemukan).`,
      };

    return { valid: true };
  } catch (e) {
    return { valid: false, error: `File backup tidak bisa dibaca: ${pesanError(e)}` };
  } finally {
    try {
      kandidat?.close();
    } catch {
      /* kandidat readonly; aman diabaikan */
    }
  }
}

export type OpsiRestoreDb = {
  /** Path DB yang sedang aktif (file yang akan ditimpa). */
  dbPath: string;
  /** File backup kandidat yang sudah dipilih user. */
  backupPath: string;
  /** Folder cadangan internal; default `<dir DB>/backups`. */
  dirBackup?: string;
  /** Stamp nama `pre-restore-<stamp>.db`; default waktu sekarang. */
  stamp?: string;
};

export type HasilRestoreDb =
  | { ok: true; db: Database.Database; preRestorePath: string }
  | { ok: false; error: string; db: Database.Database };

/**
 * Restore aman (P0-8):
 * 1. validasi kandidat lebih dulu (file sampah ditolak tanpa menyentuh DB aktif);
 * 2. backup DB aktif ke `backups/pre-restore-<stamp>.db` via VACUUM INTO;
 * 3. tutup koneksi, buang `-wal`/`-shm`, copy ke `.tmp`, rename (atomik);
 * 4. buka ulang + jalankan migrasi versi.
 *
 * Bila langkah mana pun gagal setelah DB ditutup, file lama dipulihkan dari
 * backup pra-restore dan koneksi dibuka kembali. Pemanggil WAJIB memakai
 * `hasil.db` sebagai koneksi aktif (bisa koneksi lama atau koneksi baru).
 */
export function restoreDbAman(db: Database.Database, opsi: OpsiRestoreDb): HasilRestoreDb {
  const validasi = validasiKandidatRestore(opsi.backupPath);
  if (!validasi.valid) return { ok: false, error: validasi.error, db };

  const stamp = opsi.stamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const dirBackup = opsi.dirBackup ?? join(dirname(opsi.dbPath), 'backups');
  const preRestorePath = join(dirBackup, `pre-restore-${stamp}.db`);
  try {
    backupVacuumInto(db, preRestorePath);
  } catch (e) {
    return {
      ok: false,
      error: `Gagal membuat cadangan sebelum restore: ${pesanError(e)}`,
      db,
    };
  }

  const tmp = `${opsi.dbPath}.restore-tmp`;
  try {
    db.close();
    buangFileDb(opsi.dbPath);
    copyFileSync(opsi.backupPath, tmp);
    // rename menimpa file yang sudah dihapus; aman di POSIX & Windows.
    renameSync(tmp, opsi.dbPath);
    return { ok: true, db: openDb(opsi.dbPath), preRestorePath };
  } catch (e) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      /* jangan menutupi error utama */
    }
    try {
      // Kembalikan DB lama; file aktif mungkin sudah tertimpa kandidat.
      buangFileDb(opsi.dbPath);
      copyFileSync(preRestorePath, opsi.dbPath);
      return {
        ok: false,
        error: `Restore gagal, data lama tetap dipakai: ${pesanError(e)}`,
        db: openDb(opsi.dbPath),
      };
    } catch (e2) {
      throw new Error(
        `Restore gagal dan pemulihan otomatis juga gagal: ${pesanError(e)}; ${pesanError(e2)}`,
      );
    }
  }
}

/**
 * Backup otomatis SEBELUM migrasi/reset skema (mis. DB v1 single-entry yang
 * tabel lamanya akan dibuang oleh `openDb`). Mengembalikan '' bila DB belum ada
 * atau sudah versi terbaru. Best-effort: pemanggil boleh mencatat kegagalan.
 */
export function backupPraUpgrade(
  dbPath: string,
  dirBackup = join(dirname(dbPath), 'backups'),
  stamp = new Date().toISOString().replace(/[:.]/g, '-'),
): string {
  if (!existsSync(dbPath)) return '';
  let probe: Database.Database | null = null;
  try {
    probe = new Database(dbPath, { fileMustExist: true });
    const versi = Number(probe.pragma('user_version', { simple: true }) ?? 0);
    if (versi >= SCHEMA_VERSION) return '';
    const adaTabelLama = Boolean(
      probe
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name IN ('transaksi', 'panjar', 'coa') LIMIT 1",
        )
        .get(),
    );
    if (!adaTabelLama) return '';
    return backupVacuumInto(probe, join(dirBackup, `pre-upgrade-${stamp}.db`));
  } finally {
    try {
      probe?.close();
    } catch {
      /* koneksi probe sementara */
    }
  }
}

// ---- Auto-backup harian (1x sehari saat app dibuka, retensi N file) ----

/** Backup harian aman saat DB terbuka (VACUUM INTO, bukan copy mentah WAL). Idempoten per stamp. */
export function autoBackupHarian(
  db: Database.Database,
  dir: string,
  keep = 7,
  stamp = new Date().toISOString().slice(0, 10),
): string {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `auto-${stamp}.db`);
  let dibuat = false;
  if (!existsSync(dest)) {
    backupVacuumInto(db, dest);
    dibuat = true;
  }
  // P0-9: catat hanya saat file baru benar-benar dibuat (idempoten per hari).
  if (dibuat) {
    catatAudit(db, {
      aksi: 'BACKUP-AUTO',
      alasan: `Backup otomatis harian ${stamp}`,
      baru: { path: dest, jenis: 'harian', hari: stamp },
    });
  }
  const files = readdirSync(dir)
    .filter((f) => f.startsWith('auto-') && f.endsWith('.db'))
    .sort();
  while (files.length > keep) {
    const old = files.shift()!;
    try {
      unlinkSync(join(dir, old));
    } catch {
      break;
    }
  }
  return dest;
}

/** Path backup otomatis terbaru, '' bila belum ada. */
export function lastAutoBackup(dir: string): string {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith('auto-') && f.endsWith('.db'))
      .sort();
    return files.length ? join(dir, files[files.length - 1]!) : '';
  } catch {
    return '';
  }
}
