// AUD-12 / DB-37 — restore lengkap: database dari satu folder backup AUD-11.
//
// Sejak DB-37 backup lengkap hanya berisi `pura.db` + `manifest.json`. Restore
// hanya mengganti database. Folder `attachments` pada backup lama (dibuat
// sebelum DB-37) sengaja diabaikan dan tidak pernah disentuh.
//
// Urutan sengaja dibuat agar data lama tidak pernah hilang lebih dulu:
//   1. validasi manifest, `pura.db`, dan kandidat DB;
//   2. cadangkan DB aktif via VACUUM INTO (`pre-restore-<stamp>.db`);
//   3. tutup DB, tukar file DB, buka ulang, pertahankan PIN aktif (AUD-14);
//   4. bila langkah 3 gagal, `restoreDbAman` mengembalikan DB lama.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../../db/database.js';
import {
  backupVacuumInto,
  restoreDbAman,
  type HasilRestoreDb,
  validasiKandidatRestore,
} from './export.js';
import type { ManifestBackupLengkap } from './backupLengkap.js';

export type ValidasiBackupLengkap =
  | {
      valid: true;
      manifest: ManifestBackupLengkap;
      /** Path `pura.db` di dalam folder backup. */
      dbPath: string;
    }
  | { valid: false; error: string };

export type OpsiRestoreLengkap = {
  /** Koneksi DB aktif; boleh masih memiliki transaksi di WAL. */
  db: Database.Database;
  /** Path DB aktif yang akan diganti. */
  dbPath: string;
  /** Folder backup lengkap pilihan user (berisi manifest.json). */
  backupDir: string;
  /** Folder cadangan internal DB; default `<dir DB>/backups`. */
  dirBackup?: string;
  /** Awalan nama cadangan; default ISO waktu sekarang. */
  stamp?: string;
};

export type HasilRestoreLengkap =
  | {
      ok: true;
      db: Database.Database;
      preRestorePath: string;
    }
  | { ok: false; error: string; db: Database.Database };

/** Path relatif yang aman dipakai manifest (tanpa absolut/`..`/backslash). */
function pathRelatifAman(entry: string): boolean {
  if (!entry || entry.includes('\\')) return false;
  if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return false;
  return !entry.split('/').some((bagian) => bagian === '' || bagian === '.' || bagian === '..');
}

/** Apakah `child` sama dengan atau berada di bawah `parent`. */
function diDalam(parent: string, child: string): boolean {
  const p = resolve(parent);
  const c = resolve(child);
  return c === p || c.startsWith(p.endsWith(sep) ? p : `${p}${sep}`);
}

/**
 * Validasi folder backup lengkap sebelum menyentuh data aktif:
 * manifest terbaca & bentuknya benar, `pura.db` ada, dan file lain yang
 * dicatat (selain lampiran legacy) tersedia.
 *
 * Manifest lama yang masih memuat `jumlahLampiran` atau entri
 * `attachments/...` diterima; bagian lampiran diabaikan karena DB-37 hanya
 * memulihkan database. Validasi SQLite kandidat dilakukan terpisah oleh
 * `validasiKandidatRestore`.
 */
export function validasiBackupLengkap(dirBackup: string): ValidasiBackupLengkap {
  const backupDir = resolve(String(dirBackup ?? '').trim() || '.');
  if (!String(dirBackup ?? '').trim())
    return { valid: false, error: 'Folder backup belum dipilih.' };
  if (!existsSync(backupDir) || !statSync(backupDir).isDirectory())
    return { valid: false, error: 'Folder backup tidak ditemukan.' };

  const manifestPath = join(backupDir, 'manifest.json');
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile())
    return {
      valid: false,
      error: 'manifest.json tidak ditemukan. Pilih folder hasil Backup Lengkap.',
    };

  let mentah: unknown;
  try {
    mentah = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return {
      valid: false,
      error: 'manifest.json rusak atau tidak bisa dibaca. Pilih folder backup lain.',
    };
  }
  if (!mentah || typeof mentah !== 'object' || Array.isArray(mentah))
    return { valid: false, error: 'Isi manifest.json tidak valid.' };

  const m = mentah as Record<string, unknown>;
  if (typeof m.versiApp !== 'string' || !m.versiApp.trim())
    return { valid: false, error: 'manifest.json tidak memuat versi aplikasi.' };
  if (
    typeof m.schemaVersion !== 'number' ||
    !Number.isInteger(m.schemaVersion) ||
    m.schemaVersion < 0
  )
    return { valid: false, error: 'manifest.json memuat versi skema yang tidak valid.' };
  if (typeof m.dibuat !== 'string' || Number.isNaN(Date.parse(m.dibuat)))
    return { valid: false, error: 'manifest.json memuat waktu pembuatan yang tidak valid.' };
  if (typeof m.ukuranDb !== 'number' || !Number.isFinite(m.ukuranDb) || m.ukuranDb <= 0)
    return { valid: false, error: 'manifest.json memuat ukuran database yang tidak valid.' };
  if (
    !Array.isArray(m.daftarFile) ||
    m.daftarFile.length === 0 ||
    !m.daftarFile.every((f) => typeof f === 'string')
  )
    return { valid: false, error: 'manifest.json tidak memuat daftar file backup.' };

  const daftarFile = [...new Set(m.daftarFile as string[])];
  if (daftarFile.length !== m.daftarFile.length)
    return { valid: false, error: 'manifest.json memuat daftar file ganda.' };
  if (!daftarFile.includes('pura.db'))
    return { valid: false, error: 'manifest.json tidak mencantumkan pura.db.' };

  for (const entry of daftarFile) {
    if (!pathRelatifAman(entry))
      return { valid: false, error: 'manifest.json memuat path file yang tidak aman.' };
    // Backup lama (sebelum DB-37) mencantumkan attachments/...; abaikan saja.
    if (entry.startsWith('attachments/')) continue;
    const file = join(backupDir, ...entry.split('/'));
    if (!existsSync(file) || !statSync(file).isFile())
      return {
        valid: false,
        error: `File ${entry} yang tercatat di manifest.json tidak ditemukan.`,
      };
  }

  const dbPath = join(backupDir, 'pura.db');
  if (!existsSync(dbPath) || !statSync(dbPath).isFile())
    return { valid: false, error: 'File pura.db tidak ditemukan di folder backup.' };

  if (m.schemaVersion !== SCHEMA_VERSION)
    return {
      valid: false,
      error: `Manifest backup memakai skema v${m.schemaVersion}; aplikasi hanya mendukung skema v${SCHEMA_VERSION}. Pilih backup dari aplikasi versi ini.`,
    };

  return {
    valid: true,
    manifest: {
      versiApp: m.versiApp,
      schemaVersion: m.schemaVersion,
      dibuat: m.dibuat,
      ukuranDb: m.ukuranDb,
      daftarFile: ['pura.db'],
    },
    dbPath,
  };
}

/** Pilih stamp yang belum dipakai cadangan DB. */
function pilihStamp(stampDasar: string, dirBackup: string): string {
  let stamp = stampDasar;
  let urutan = 2;
  while (existsSync(join(dirBackup, `pre-restore-${stamp}.db`))) {
    stamp = `${stampDasar}-${urutan}`;
    urutan += 1;
  }
  return stamp;
}

/**
 * Restore lengkap yang atomik. Pemanggil WAJIB memakai `hasil.db` sebagai
 * koneksi aktif, baik saat sukses maupun gagal (koneksi bisa sudah berganti).
 * Folder lampiran legacy tidak disentuh sama sekali.
 */
export function restoreLengkap(opsi: OpsiRestoreLengkap): HasilRestoreLengkap {
  const validasi = validasiBackupLengkap(opsi.backupDir);
  if (!validasi.valid) return { ok: false, error: validasi.error, db: opsi.db };

  const validasiDb = validasiKandidatRestore(validasi.dbPath);
  if (!validasiDb.valid) return { ok: false, error: validasiDb.error, db: opsi.db };

  const dbPath = resolve(opsi.dbPath);
  const backupDir = resolve(opsi.backupDir);
  if (validasi.dbPath === dbPath || diDalam(backupDir, dbPath))
    return {
      ok: false,
      error: 'Folder backup tidak boleh berisi database yang sedang aktif. Pilih folder lain.',
      db: opsi.db,
    };

  const dirBackup = resolve(opsi.dirBackup ?? join(dirname(dbPath), 'backups'));
  const stampDasar = opsi.stamp?.trim() || new Date().toISOString().replace(/[:.]/g, '-');
  const stamp = pilihStamp(stampDasar, dirBackup);
  const preRestorePath = join(dirBackup, `pre-restore-${stamp}.db`);

  // 1. Cadangkan DB aktif lebih dulu; kegagalan di sini belum menyentuh apa pun.
  try {
    backupVacuumInto(opsi.db, preRestorePath);
  } catch {
    return {
      ok: false,
      error:
        'Gagal membuat cadangan database sebelum restore. Data lama belum diubah. Coba lagi; bila tetap gagal, hubungi pendamping.',
      db: opsi.db,
    };
  }

  // 2. Tukar DB + buka ulang + pertahankan PIN aktif (AUD-14). restoreDbAman
  //    memakai preRestorePath yang sudah dibuat sebagai sumber rollback.
  const hasilDb: HasilRestoreDb = restoreDbAman(opsi.db, {
    dbPath,
    backupPath: validasi.dbPath,
    dirBackup,
    stamp,
    preRestorePath,
  });

  if (!hasilDb.ok) return { ok: false, error: hasilDb.error, db: hasilDb.db };

  return {
    ok: true,
    db: hasilDb.db,
    preRestorePath: hasilDb.preRestorePath,
  };
}
