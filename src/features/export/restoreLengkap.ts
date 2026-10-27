// AUD-12 — restore lengkap: DB + lampiran dari satu folder backup AUD-11.
//
// Urutan sengaja dibuat agar data lama tidak pernah hilang lebih dulu:
//   1. validasi manifest, pura.db, folder attachments, dan kandidat DB;
//   2. cadangkan DB aktif via VACUUM INTO (`pre-restore-<stamp>.db`);
//   3. pindahkan (rename) folder lampiran aktif ke
//      `attachments-pre-restore-<stamp>/` — bukan menghapus;
//   4. tutup DB, tukar file DB, buka ulang, pertahankan PIN aktif (AUD-14);
//   5. salin lampiran backup ke folder lampiran aktif;
//   6. bila langkah 4/5 gagal, DB dan lampiran lama dikembalikan.
//
// Restore hanya dianggap sukses setelah isi folder lampiran baru cocok dengan
// daftar file di manifest, sehingga tidak ada lampiran yatim.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type Database from 'better-sqlite3';
import { SCHEMA_VERSION } from '../../db/database.js';
import {
  backupVacuumInto,
  restoreDbAman,
  type HasilRestoreDb,
  validasiKandidatRestore,
} from './export.js';
import {
  daftarFileRelatif,
  salinIsiFolder,
  type ManifestBackupLengkap,
} from './backupLengkap.js';

export type ValidasiBackupLengkap =
  | {
      valid: true;
      manifest: ManifestBackupLengkap;
      /** Path `pura.db` di dalam folder backup. */
      dbPath: string;
      /** Folder `attachments` di dalam folder backup. */
      attachmentsDir: string;
      jumlahLampiran: number;
    }
  | { valid: false; error: string };

export type OpsiRestoreLengkap = {
  /** Koneksi DB aktif; boleh masih memiliki transaksi di WAL. */
  db: Database.Database;
  /** Path DB aktif yang akan diganti. */
  dbPath: string;
  /** Folder lampiran aktif yang akan diganti. */
  attachmentsDir: string;
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
      preRestoreAttachmentsPath: string;
      jumlahLampiran: number;
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
 * manifest terbaca & bentuknya benar, semua file yang didaftar ada,
 * `pura.db` ada, `attachments/` ada, dan isi lampiran cocok dengan manifest.
 * Validasi SQLite kandidat dilakukan terpisah oleh `validasiKandidatRestore`.
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
  if (
    typeof m.jumlahLampiran !== 'number' ||
    !Number.isInteger(m.jumlahLampiran) ||
    m.jumlahLampiran < 0
  )
    return { valid: false, error: 'manifest.json memuat jumlah lampiran yang tidak valid.' };
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
    const file = join(backupDir, ...entry.split('/'));
    if (!existsSync(file) || !statSync(file).isFile())
      return {
        valid: false,
        error: `File ${entry} yang tercatat di manifest.json tidak ditemukan.`,
      };
  }

  const dbPath = join(backupDir, 'pura.db');
  const attachmentsDir = join(backupDir, 'attachments');
  if (!existsSync(attachmentsDir))
    return {
      valid: false,
      error: 'Folder attachments tidak ditemukan di folder backup. Pilih backup lengkap.',
    };
  if (!statSync(attachmentsDir).isDirectory())
    return { valid: false, error: 'Folder attachments di folder backup tidak valid.' };

  const aktual = daftarFileRelatif(backupDir, attachmentsDir);
  const tercatat = daftarFile
    .filter((f) => f.startsWith('attachments/'))
    .sort();
  if (JSON.stringify(aktual) !== JSON.stringify(tercatat))
    return {
      valid: false,
      error: 'Isi folder attachments tidak cocok dengan manifest.json. Backup mungkin tidak lengkap.',
    };
  if (aktual.length !== m.jumlahLampiran)
    return {
      valid: false,
      error: 'Jumlah lampiran tidak cocok dengan manifest.json. Backup mungkin tidak lengkap.',
    };
  if (m.schemaVersion > SCHEMA_VERSION)
    return {
      valid: false,
      error: 'Backup dibuat oleh aplikasi versi lebih baru. Perbarui aplikasi dulu.',
    };

  return {
    valid: true,
    manifest: {
      versiApp: m.versiApp,
      schemaVersion: m.schemaVersion,
      dibuat: m.dibuat,
      jumlahLampiran: m.jumlahLampiran,
      ukuranDb: m.ukuranDb,
      daftarFile,
    },
    dbPath,
    attachmentsDir,
    jumlahLampiran: aktual.length,
  };
}

/** Pilih stamp yang belum dipakai cadangan DB maupun folder lampiran. */
function pilihStamp(
  stampDasar: string,
  dirBackup: string,
  dirLampiran: string,
): { stamp: string; preAttachmentsPath: string } {
  let stamp = stampDasar;
  let preAttachmentsPath = join(dirLampiran, `attachments-pre-restore-${stamp}`);
  let urutan = 2;
  while (
    existsSync(preAttachmentsPath) ||
    existsSync(join(dirBackup, `pre-restore-${stamp}.db`))
  ) {
    stamp = `${stampDasar}-${urutan}`;
    preAttachmentsPath = join(dirLampiran, `attachments-pre-restore-${stamp}`);
    urutan += 1;
  }
  return { stamp, preAttachmentsPath };
}

/**
 * Kembalikan folder lampiran lama dari cadangan rename. Melempar bila gagal
 * agar pemanggil bisa melaporkan lokasi cadangan yang harus dipulihkan manual.
 */
function kembalikanLampiranLama(
  attachmentsDir: string,
  preAttachmentsPath: string,
): void {
  if (!existsSync(preAttachmentsPath)) return;
  if (existsSync(attachmentsDir)) rmSync(attachmentsDir, { recursive: true, force: true });
  renameSync(preAttachmentsPath, attachmentsDir);
}

/**
 * Restore lengkap yang atomik. Pemanggil WAJIB memakai `hasil.db` sebagai
 * koneksi aktif, baik saat sukses maupun gagal (koneksi bisa sudah berganti).
 */
export function restoreLengkap(opsi: OpsiRestoreLengkap): HasilRestoreLengkap {
  const validasi = validasiBackupLengkap(opsi.backupDir);
  if (!validasi.valid) return { ok: false, error: validasi.error, db: opsi.db };

  const validasiDb = validasiKandidatRestore(validasi.dbPath);
  if (!validasiDb.valid) return { ok: false, error: validasiDb.error, db: opsi.db };

  const dbPath = resolve(opsi.dbPath);
  const attachmentsDir = resolve(opsi.attachmentsDir);
  const backupDir = resolve(opsi.backupDir);
  if (validasi.dbPath === dbPath || diDalam(backupDir, dbPath))
    return {
      ok: false,
      error: 'Folder backup tidak boleh berisi database yang sedang aktif. Pilih folder lain.',
      db: opsi.db,
    };
  if (
    validasi.attachmentsDir === attachmentsDir ||
    diDalam(attachmentsDir, backupDir) ||
    diDalam(backupDir, attachmentsDir)
  )
    return {
      ok: false,
      error: 'Folder backup tidak boleh berada di dalam folder lampiran aktif. Pilih folder lain.',
      db: opsi.db,
    };

  const dirBackup = resolve(opsi.dirBackup ?? join(dirname(dbPath), 'backups'));
  const stampDasar = opsi.stamp?.trim() || new Date().toISOString().replace(/[:.]/g, '-');
  const { stamp, preAttachmentsPath } = pilihStamp(
    stampDasar,
    dirBackup,
    dirname(attachmentsDir),
  );
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

  // 2. Pindahkan folder lampiran lama (rename, bukan hapus). Bila folder belum
  //    ada, buat folder kosong agar cadangan tetap punya path yang jelas.
  try {
    if (existsSync(attachmentsDir) && !statSync(attachmentsDir).isDirectory())
      throw new Error('Folder lampiran aktif bukan folder.');
    mkdirSync(attachmentsDir, { recursive: true });
    renameSync(attachmentsDir, preAttachmentsPath);
  } catch {
    return {
      ok: false,
      error:
        'Gagal menyiapkan cadangan lampiran lama. Database dan lampiran belum diubah. Coba lagi; bila tetap gagal, hubungi pendamping.',
      db: opsi.db,
    };
  }

  // 3. Tukar DB + buka ulang + pertahankan PIN aktif (AUD-14). restoreDbAman
  //    memakai preRestorePath yang sudah dibuat sebagai sumber rollback.
  let hasilDb: HasilRestoreDb;
  try {
    hasilDb = restoreDbAman(opsi.db, {
      dbPath,
      backupPath: validasi.dbPath,
      dirBackup,
      stamp,
      preRestorePath,
    });
  } catch (e) {
    // Kegagalan fatal saat rollback DB: lampiran lama tetap dikembalikan bila bisa.
    try {
      kembalikanLampiranLama(attachmentsDir, preAttachmentsPath);
    } catch {
      /* error utama lebih penting; jalur cadangan dilaporkan di pesan utama */
    }
    throw e;
  }

  if (!hasilDb.ok) {
    let error = hasilDb.error;
    try {
      kembalikanLampiranLama(attachmentsDir, preAttachmentsPath);
    } catch {
      error += ` Lampiran lama tersimpan di ${preAttachmentsPath} dan perlu dikembalikan manual.`;
    }
    return { ok: false, error, db: hasilDb.db };
  }

  // 4. Salin lampiran baru dan pastikan isinya sama persis dengan manifest.
  try {
    mkdirSync(attachmentsDir, { recursive: true });
    salinIsiFolder(validasi.attachmentsDir, attachmentsDir);
    const aktual = daftarFileRelatif(attachmentsDir, attachmentsDir);
    const harapan = validasi.manifest.daftarFile
      .filter((f) => f.startsWith('attachments/'))
      .map((f) => f.slice('attachments/'.length))
      .sort();
    if (JSON.stringify(aktual) !== JSON.stringify(harapan))
      throw new Error('Daftar lampiran hasil salin tidak cocok dengan manifest.');
  } catch {
    // 5. Rollback lampiran lalu DB. Kegagalan rollback dilaporkan eksplisit.
    let galatLampiran = '';
    try {
      kembalikanLampiranLama(attachmentsDir, preAttachmentsPath);
    } catch {
      galatLampiran = ` Lampiran lama tersimpan di ${preAttachmentsPath} dan perlu dikembalikan manual.`;
    }

    try {
      const rollback = restoreDbAman(hasilDb.db, {
        dbPath,
        backupPath: preRestorePath,
        dirBackup,
        stamp: `${stamp}-rollback`,
      });
      if (!rollback.ok) throw new Error(rollback.error);
      return {
        ok: false,
        error: `Restore lengkap gagal, data lama tetap dipakai.${galatLampiran}`,
        db: rollback.db,
      };
    } catch (e) {
      throw new Error(
        `Restore lengkap gagal dan pemulihan otomatis juga gagal.${galatLampiran} ${
          e instanceof Error ? e.message : ''
        } Hubungi pendamping sebelum memakai aplikasi lagi.`,
      );
    }
  }

  return {
    ok: true,
    db: hasilDb.db,
    preRestorePath: hasilDb.preRestorePath,
    preRestoreAttachmentsPath: preAttachmentsPath,
    jumlahLampiran: validasi.jumlahLampiran,
  };
}
