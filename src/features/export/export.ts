// Facade Node (main/tests) — re-export builder murni + helper fs.
// Renderer WAJIB import dari ./workbooks.js langsung (tanpa node:fs)
// agar build Vite tidak menarik `node:fs` ke browser.

import { copyFileSync } from 'node:fs';
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
