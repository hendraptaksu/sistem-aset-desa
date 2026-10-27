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
import {
  KUNCI_PIN_HASH,
  KUNCI_PIN_SALT,
  catatAudit,
  getPengaturan,
  setPengaturan,
} from '../../db/repository.js';
import { pesanError } from '../../utils/pesanError.js';
import { tanggalLokal } from '../../utils/tanggal.js';

export {
  KOP_ORG_NAMA,
  NUMFMT_RP,
  NUMFMT_PERSEN,
  kopHtml,
  kopPeriode,
  kopPeriodeEfektif,
  kopPeriodeCutoff,
  periodeFile,
  rentangDariRows,
  pembantuToWorkbook,
  realisasiToWorkbook,
  surplusToWorkbook,
  neracaToWorkbook,
  bkuToWorkbook,
  jurnalToWorkbook,
  bukuBesarToWorkbook,
  neracaSaldoToWorkbook,
  labaRugiToWorkbook,
  neracaHasilToWorkbook,
  arusKasToWorkbook,
  panjarToWorkbook,
  workbookToBuffer,
  pembantuToHtml,
  realisasiToHtml,
  surplusToHtml,
  neracaToHtml,
  bkuToHtml,
  jurnalToHtml,
  jurnalDaftarToHtml,
  bukuBesarToHtml,
  neracaSaldoToHtml,
  labaRugiToHtml,
  neracaHasilToHtml,
  arusKasToHtml,
  panjarToHtml,
  wrapPrintDocument,
} from './workbooks.js';
export type {
  JurnalBarisTampil,
  JurnalTampil,
  PanjarTampil,
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

/** Hapus sidecar WAL/SHM milik sebuah file DB (best-effort). */
function buangSidecarDb(path: string): void {
  for (const p of [`${path}-wal`, `${path}-shm`]) {
    try {
      if (existsSync(p)) unlinkSync(p);
    } catch {
      /* sidecar lama tidak boleh menggagalkan backup utama */
    }
  }
}

/** Hapus file DB beserta sidecar WAL/SHM agar tidak bercampur dengan hasil baru. */
function buangFileDb(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* biarkan pemanggil melaporkan error tulis utama */
  }
  buangSidecarDb(path);
}

/**
 * Backup aman dari koneksi yang sedang terbuka: `VACUUM INTO` menghasilkan
 * satu file konsisten (termasuk isi WAL), tanpa menghentikan aplikasi.
 *
 * Hasil VACUUM ditulis ke file sementara `<dest>.tmp-<pid>-<timestamp>` lebih
 * dulu. Setelah tmp valid, backup lama dipindahkan ke `<dest>.bak-<pid>` lalu
 * tmp di-rename menjadi `<dest>`. Dengan urutan ini kegagalan VACUUM atau
 * rename tidak menghapus backup lama. Bila rename gagal, backup lama
 * dikembalikan dan tmp dipertahankan untuk diagnosis. Path di-escape agar aman
 * untuk nama folder yang mengandung tanda kutip.
 */
export function backupVacuumInto(db: Database.Database, dest: string): string {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  const bak = `${dest}.bak-${process.pid}`;

  try {
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    if (!existsSync(tmp) || !statSync(tmp).isFile() || statSync(tmp).size === 0)
      throw new Error('VACUUM INTO tidak menghasilkan file backup yang valid.');
  } catch (e) {
    // Jangan tinggalkan file sementara/parsial saat VACUUM gagal.
    buangFileDb(tmp);
    throw e;
  }

  let destLamaDipindah = false;
  try {
    if (existsSync(dest)) {
      // Sisa proses dengan PID sama (mis. crash sebelumnya) tidak boleh
      // menghalangi rename.
      buangFileDb(bak);
      renameSync(dest, bak);
      destLamaDipindah = true;
    }
    renameSync(tmp, dest);
  } catch (e) {
    if (destLamaDipindah) {
      try {
        renameSync(bak, dest);
      } catch (gagalPulih) {
        throw new Error(
          `Backup gagal dan file lama tidak bisa dikembalikan otomatis. File lama tersimpan di ${bak}. ${pesanError(
            gagalPulih,
            'Hubungi pendamping sebelum memakai aplikasi lagi.',
          )}`,
        );
      }
    }
    // tmp sengaja dipertahankan untuk diagnosis (tidak dihapus).
    throw e;
  }

  // Sukses: backup lama dan sidecar-nya tidak diperlukan lagi.
  buangFileDb(bak);
  buangSidecarDb(dest);
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
        error: 'File backup rusak. Pilih file backup lain.',
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
  } catch {
    return {
      valid: false,
      error: 'File backup tidak bisa dibaca. Pastikan file .db berasal dari aplikasi ini.',
    };
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
  /**
   * Path cadangan DB yang sudah dibuat pemanggil sebelum fungsi ini dipanggil
   * (mis. restore lengkap yang mencadangkan DB lebih dulu). Bila diisi, fungsi
   * ini TIDAK membuat cadangan baru dan memakai path tersebut untuk rollback.
   */
  preRestorePath?: string;
};

export type HasilRestoreDb =
  | { ok: true; db: Database.Database; preRestorePath: string }
  | { ok: false; error: string; db: Database.Database };

/** Pasangan salt/hash PIN milik DB aktif; tidak pernah memuat PIN plaintext. */
type PinAktif = { salt: string; hash: string };

function bacaPinAktif(db: Database.Database): PinAktif | null {
  const salt = getPengaturan(db, KUNCI_PIN_SALT);
  const hash = getPengaturan(db, KUNCI_PIN_HASH);
  // Hanya pakai pasangan lengkap; data PIN parsial/rusak tidak disalin.
  return salt && hash ? { salt, hash } : null;
}

/** Tulis PIN aktif ke DB hasil restore dalam satu transaksi + audit tanpa rahasia. */
function tulisPinAktif(db: Database.Database, pin: PinAktif): void {
  const tx = db.transaction(() => {
    setPengaturan(db, KUNCI_PIN_SALT, pin.salt);
    setPengaturan(db, KUNCI_PIN_HASH, pin.hash);
    catatAudit(db, {
      aksi: 'RESTORE-PIN-DIPERTAHANKAN',
      alasan: 'PIN aktif dipertahankan setelah restore',
      baru: { pin: 'PIN dipertahankan' },
    });
  });
  tx();
}

/**
 * Restore aman (P0-8):
 * 1. validasi kandidat lebih dulu (file sampah ditolak tanpa menyentuh DB aktif);
 * 2. backup DB aktif ke `backups/pre-restore-<stamp>.db` via VACUUM INTO
 *    (bila pemanggil sudah membuat cadangan lewat `preRestorePath`, path itu
 *    yang dipakai);
 * 3. tutup koneksi, buang `-wal`/`-shm`, copy ke `.tmp`, rename (atomik);
 * 4. buka ulang + jalankan migrasi versi;
 * 5. tulis kembali PIN DB aktif (AUD-14) dalam transaksi agar PIN backup lama
 *    tidak mengunci user.
 *
 * Bila langkah mana pun gagal setelah DB ditutup, file lama dipulihkan dari
 * backup pra-restore dan koneksi dibuka kembali. Pemanggil WAJIB memakai
 * `hasil.db` sebagai koneksi aktif (bisa koneksi lama atau koneksi baru).
 */
export function restoreDbAman(db: Database.Database, opsi: OpsiRestoreDb): HasilRestoreDb {
  const validasi = validasiKandidatRestore(opsi.backupPath);
  if (!validasi.valid) return { ok: false, error: validasi.error, db };

  // AUD-14: baca PIN sebelum koneksi aktif ditutup; backup boleh tidak punya PIN.
  const pinAktif = bacaPinAktif(db);
  const stamp = opsi.stamp ?? new Date().toISOString().replace(/[:.]/g, '-');
  const dirBackup = opsi.dirBackup ?? join(dirname(opsi.dbPath), 'backups');
  const preRestorePath =
    opsi.preRestorePath ?? join(dirBackup, `pre-restore-${stamp}.db`);
  try {
    // Pemanggil yang sudah mencadangkan DB (restore lengkap) tidak perlu
    // VACUUM kedua; path yang sama dipakai untuk rollback.
    if (!opsi.preRestorePath) backupVacuumInto(db, preRestorePath);
  } catch (e) {
    return {
      ok: false,
      error: `Gagal membuat cadangan sebelum restore. ${pesanError(
        e,
        'Coba lagi; bila tetap gagal, hubungi pendamping.',
      )}`,
      db,
    };
  }

  const tmp = `${opsi.dbPath}.restore-tmp`;
  let dbBaru: Database.Database | null = null;
  try {
    db.close();
    buangFileDb(opsi.dbPath);
    copyFileSync(opsi.backupPath, tmp);
    // rename menimpa file yang sudah dihapus; aman di POSIX & Windows.
    renameSync(tmp, opsi.dbPath);
    dbBaru = openDb(opsi.dbPath);
    if (pinAktif) tulisPinAktif(dbBaru, pinAktif);
    return { ok: true, db: dbBaru, preRestorePath };
  } catch {
    try {
      dbBaru?.close();
    } catch {
      /* jangan menutupi error utama */
    }
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
        error:
          'Restore gagal, data lama tetap dipakai. Coba lagi; bila tetap gagal, hubungi pendamping.',
        db: openDb(opsi.dbPath),
      };
    } catch {
      throw new Error(
        'Restore gagal dan pemulihan otomatis juga gagal. Hubungi pendamping sebelum memakai aplikasi lagi.',
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
  stamp = tanggalLokal(),
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
