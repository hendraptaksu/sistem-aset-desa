// AUD-11 — backup lengkap: satu folder berisi DB konsisten + semua lampiran.
//
// Modul ini main-only (memakai `node:fs`). DB TIDAK boleh disalin dengan
// `copyFileSync` saat koneksi terbuka karena transaksi terbaru bisa masih di
// WAL; `backupVacuumInto` (VACUUM INTO) dipakai agar salinan konsisten.
// Attachment disalin apa adanya (termasuk subfolder bila ada), lalu manifest
// ditulis terakhir sebagai penanda backup selesai.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
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
  jumlahLampiran: number;
  /** Ukuran `pura.db` hasil VACUUM dalam byte. */
  ukuranDb: number;
  /**
   * Semua file muatan backup, relatif terhadap folder backup dan memakai `/`
   * (mis. `pura.db`, `attachments/foto.jpg`). `manifest.json` sendiri tidak
   * ikut didaftar.
   */
  daftarFile: string[];
};

export type OpsiBackupLengkap = {
  /** Koneksi DB aktif; boleh masih memiliki transaksi di WAL. */
  db: Database.Database;
  /** Path DB aktif, dipakai untuk validasi sumber. */
  dbPath: string;
  /** Folder lampiran aktif (boleh belum ada/kosong). */
  attachmentsDir: string;
  /** Folder backup yang akan dibuat/diisi. */
  destDir: string;
  /** Awalan waktu lokal; default `YYYY-MM-DD-HHmm` zona aplikasi (WITA). */
  stamp?: string;
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

/** Salin isi folder secara rekursif; folder tujuan selalu dibuat. */
export function salinIsiFolder(sumber: string, tujuan: string): void {
  mkdirSync(tujuan, { recursive: true });
  for (const entri of readdirSync(sumber, { withFileTypes: true })) {
    const asal = join(sumber, entri.name);
    const target = join(tujuan, entri.name);
    if (entri.isDirectory()) salinIsiFolder(asal, target);
    else if (entri.isFile()) copyFileSync(asal, target);
  }
}

/** Daftar file di bawah folder, relatif dan memakai separator `/`. */
export function daftarFileRelatif(root: string, folder: string): string[] {
  const hasil: string[] = [];
  const jelajah = (dir: string): void => {
    for (const entri of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entri.name);
      if (entri.isDirectory()) jelajah(path);
      else if (entri.isFile()) {
        hasil.push(relative(root, path).split(sep).join('/'));
      }
    }
  };
  jelajah(folder);
  return hasil.sort();
}

/**
 * Buat satu folder backup lengkap:
 * `pura.db` (VACUUM INTO), `attachments/` (salinan), dan `manifest.json`.
 *
 * Folder tujuan baru boleh kosong/belum ada; folder berisi file ditolak agar
 * lampiran lama tidak tercampur dengan backup baru. Bila pembuatan gagal dan
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

    const destLampiran = join(destDir, 'attachments');
    mkdirSync(destLampiran, { recursive: true });
    if (existsSync(opsi.attachmentsDir)) {
      if (!statSync(opsi.attachmentsDir).isDirectory()) {
        throw new Error('Folder lampiran tidak valid. Backup dibatalkan.');
      }
      salinIsiFolder(opsi.attachmentsDir, destLampiran);
    }

    const lampiran = daftarFileRelatif(destDir, destLampiran);
    const manifest: ManifestBackupLengkap = {
      versiApp: opsi.versiApp?.trim() || VERSI_APP,
      schemaVersion:
        Number(opsi.db.pragma('user_version', { simple: true })) || SCHEMA_VERSION,
      dibuat: new Date().toISOString(),
      jumlahLampiran: lampiran.length,
      ukuranDb: statSync(destDb).size,
      daftarFile: ['pura.db', ...lampiran],
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
