// Facade Node (main/tests) — re-export builder murni + helper fs.
// Renderer WAJIB import dari ./workbooks.js langsung (tanpa node:fs)
// agar build Vite tidak menarik `node:fs` ke browser.

import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import type ExcelJS from 'exceljs';

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

// ---- Backup Export/Import .db (copy file) — PRD §4 ----

/** Export manual: copy file .db ke path backup. */
export function backupDb(dbPath: string, backupPath: string): string {
  copyFileSync(dbPath, backupPath);
  return backupPath;
}

/** Import/restore: copy file backup menimpa .db aktif. Caller wajib tutup koneksi dulu. */
export function restoreDb(backupPath: string, dbPath: string): string {
  copyFileSync(backupPath, dbPath);
  return dbPath;
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
  if (!existsSync(dest)) {
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
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
