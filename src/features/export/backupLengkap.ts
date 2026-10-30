// AUD-11 / DB-37 — backup lengkap: satu folder berisi DB konsisten + manifest.
//
// Modul ini main-only (memakai `node:fs`). DB TIDAK boleh disalin dengan
// `copyFileSync` saat koneksi terbuka karena transaksi terbaru bisa masih di
// WAL; `backupVacuumInto` (VACUUM INTO) dipakai agar salinan konsisten.
// Sejak DB-37 tidak ada folder lampiran: backup lengkap hanya berisi `pura.db`
// dan `manifest.json`.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';
import pkg from '../../../package.json';
import { SCHEMA_VERSION } from '../../db/database.js';
import { formatWaktuLokal } from '../../utils/tanggal.js';
import { backupVacuumInto } from './export.js';

/** Versi aplikasi yang sedang berjalan, diambil dari package.json saat build. */
export const VERSI_APP = pkg.version;

export type ManifestBackupLengkap = {
  versiApp: string;
  schemaVersion: number;
  /** Waktu backup dibuat dalam ISO UTC. */
  dibuat: string;
  /** Ukuran `pura.db` hasil VACUUM dalam byte. */
  ukuranDb: number;
  /**
   * Semua file muatan backup, relatif terhadap folder backup dan memakai `/`.
   * Sejak DB-37 hanya berisi `pura.db`; `manifest.json` sendiri tidak didaftar.
   */
  daftarFile: string[];
};

export type OpsiBackupLengkap = {
  /** Koneksi DB aktif; boleh masih memiliki transaksi di WAL. */
  db: Database.Database;
  /** Path DB aktif, dipakai untuk validasi sumber. */
  dbPath: string;
  /** Folder backup yang akan dibuat/diisi. */
  destDir: string;
  /** Override versi aplikasi (dipakai test); default `VERSI_APP`. */
  versiApp?: string;
};

export type HasilBackupLengkap = {
  destDir: string;
  manifest: ManifestBackupLengkap;
};

/**
 * Stempel waktu lokal WITA yang aman untuk nama folder: `YYYY-MM-DD-HHmm`.
 * Memakai `Intl` (bukan `toISOString`) supaya tanggal tidak bergeser ke UTC.
 */
export function stampBackupLokal(now: Date = new Date()): string {
  const teks = formatWaktuLokal(now.toISOString());
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(teks);
  if (!m) throw new Error('Waktu backup tidak valid.');
  return `${m[1]}-${m[2]}-${m[3]}-${m[4]}${m[5]}`;
}

/**
 * Buat satu folder backup lengkap:
 * `pura.db` (VACUUM INTO) dan `manifest.json`.
 *
 * Folder tujuan baru boleh kosong/belum ada; folder berisi file ditolak agar
 * backup lama tidak tercampur dengan backup baru. Bila pembuatan gagal dan
 * folder tujuan dibuat oleh fungsi ini, folder parsial dibersihkan.
 */
export function buatBackupLengkap(opsi: OpsiBackupLengkap): HasilBackupLengkap {
  const dbPath = resolve(opsi.dbPath);
  if (!existsSync(dbPath) || !statSync(dbPath).isFile()) {
    throw new Error('Database aktif tidak ditemukan. Backup tidak bisa dibuat.');
  }

  const destDir = resolve(opsi.destDir);
  const destDb = join(destDir, 'pura.db');
  if (destDb === dbPath) {
    throw new Error('Folder backup tidak boleh sama dengan folder database aktif.');
  }
  const destSudahAda = existsSync(destDir);
  if (destSudahAda) {
    if (!statSync(destDir).isDirectory()) {
      throw new Error('Tujuan backup harus berupa folder.');
    }
    if (readdirSync(destDir).length > 0) {
      throw new Error('Folder tujuan backup sudah berisi file. Pilih folder lain.');
    }
  }

  mkdirSync(destDir, { recursive: true });
  try {
    backupVacuumInto(opsi.db, destDb);

    const manifest: ManifestBackupLengkap = {
      versiApp: opsi.versiApp?.trim() || VERSI_APP,
      schemaVersion:
        Number(opsi.db.pragma('user_version', { simple: true })) || SCHEMA_VERSION,
      dibuat: new Date().toISOString(),
      ukuranDb: statSync(destDb).size,
      daftarFile: ['pura.db'],
    };
    writeFileSync(
      join(destDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf-8',
    );

    return { destDir, manifest };
  } catch (e) {
    // Jangan tinggalkan folder parsial yang bisa disangka backup lengkap.
    if (!destSudahAda) rmSync(destDir, { recursive: true, force: true });
    throw e;
  }
}
