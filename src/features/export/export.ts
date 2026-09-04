// Export Agent B — .xlsx (exceljs) + Print/PDF (HTML) + Backup Export/Import .db (copy file).
// Semua angka Rupiah diformat via formatRp; negatif otomatis (Rp ...) — PRD §4.

import { copyFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { formatRp } from '../../utils/format.js';
import type { PembantuHasil, RealisasiHasil, SurplusHasil } from '../reports/types.js';

// ---- XLSX ----

function baseWorkbook(title: string): { wb: ExcelJS.Workbook; ws: ExcelJS.Worksheet } {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pura Dalem Puri';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31));
  return { wb, ws };
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
}

/** Pembantu → workbook. Kolom: Tanggal | Keterangan | Masuk | Keluar | Saldo jalan. */
export async function pembantuToWorkbook(p: PembantuHasil): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook(`Pembantu ${p.kode}`);
  ws.addRow([`Buku Pembantu — ${p.kode} ${p.nama}`]);
  ws.addRow(['Tanggal', 'Keterangan', 'Masuk', 'Keluar']);
  styleHeader(ws.getRow(2));
  let jalan = 0;
  for (const t of p.rows) {
    jalan += t.masuk - t.keluar;
    ws.addRow([t.tanggal, t.keterangan, t.masuk === 0 ? '' : formatRp(t.masuk), t.keluar === 0 ? '' : formatRp(t.keluar)]);
  }
  const tr = ws.addRow(['TOTAL', '', formatRp(p.totalMasuk), formatRp(p.totalKeluar)]);
  styleHeader(tr);
  ws.addRow(['SALDO AKHIR', '', '', formatRp(p.saldo)]);
  ws.columns.forEach((c) => { c.width = 22; });
  ws.getColumn(2).width = 42;
  return wb;
}

/** Realisasi → workbook. Dua seksi + Net. */
export async function realisasiToWorkbook(r: RealisasiHasil): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Realisasi');
  ws.addRow([`Realisasi Anggaran ${r.mulai ?? ''} s/d ${r.sampai ?? ''}`]);
  ws.addRow(['Kode', 'Uraian', 'Nominal']);
  styleHeader(ws.getRow(2));
  ws.addRow(['PENDAPATAN', '', '']);
  for (const b of r.pendapatan) ws.addRow([b.kode, b.nama, formatRp(b.nominal)]);
  const tp = ws.addRow(['Total Pendapatan', '', formatRp(r.totalPendapatan)]);
  styleHeader(tp);
  ws.addRow(['BEBAN', '', '']);
  for (const b of r.beban) ws.addRow([b.kode, b.nama, formatRp(b.nominal)]);
  const tb = ws.addRow(['Total Beban', '', formatRp(r.totalBeban)]);
  styleHeader(tb);
  const net = ws.addRow(['NET (Pendapatan - Beban)', '', formatRp(r.net)]);
  styleHeader(net);
  ws.columns.forEach((c) => { c.width = 24; });
  ws.getColumn(2).width = 34;
  return wb;
}

/** Surplus → workbook. Sama + kolom % + judul Surplus/(Defisit). */
export async function surplusToWorkbook(s: SurplusHasil): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Surplus');
  ws.addRow([`Surplus / (Defisit) ${s.mulai ?? ''} s/d ${s.sampai ?? ''}`]);
  ws.addRow(['Kode', 'Uraian', 'Nominal', '%']);
  styleHeader(ws.getRow(2));
  ws.addRow(['PENDAPATAN', '', '', '']);
  for (const b of s.pendapatan)
    ws.addRow([b.kode, b.nama, formatRp(b.nominal), `${b.persen.toFixed(1)}%`]);
  const tp = ws.addRow(['Total Pendapatan', '', formatRp(s.totalPendapatan), '100.0%']);
  styleHeader(tp);
  ws.addRow(['BEBAN', '', '', '']);
  for (const b of s.beban) ws.addRow([b.kode, b.nama, formatRp(b.nominal), `${b.persen.toFixed(1)}%`]);
  const tb = ws.addRow(['Total Beban', '', formatRp(s.totalBeban), '100.0%']);
  styleHeader(tb);
  const sr = ws.addRow(['SURPLUS / (DEFISIT)', '', formatRp(s.surplus), '']);
  styleHeader(sr);
  ws.columns.forEach((c) => { c.width = 24; });
  ws.getColumn(2).width = 34;
  return wb;
}

/** Tulis workbook ke file .xlsx. Return path untuk log/screenshot. */
export async function writeXlsx(wb: ExcelJS.Workbook, filePath: string): Promise<string> {
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

/** Versi buffer (untuk test tanpa file + unduh di browser). */
export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

// ---- Print / PDF (browser: window.print; Electron: save-to-PDF) ----

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function pembantuToHtml(p: PembantuHasil): string {
  const rows = p.rows
    .map((t) => `<tr><td>${t.tanggal}</td><td>${esc(t.keterangan)}</td><td style="text-align:right">${formatRp(t.masuk)}</td><td style="text-align:right">${formatRp(t.keluar)}</td></tr>`)
    .join('');
  return `<h2>Buku Pembantu — ${p.kode} ${esc(p.nama)}</h2>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>Keterangan</th><th>Masuk</th><th>Keluar</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th colspan="2">TOTAL</th><th style="text-align:right">${formatRp(p.totalMasuk)}</th><th style="text-align:right">${formatRp(p.totalKeluar)}</th></tr>
<tr><th colspan="3">SALDO AKHIR</th><th style="text-align:right">${formatRp(p.saldo)}</th></tr></tfoot></table>`;
}

export function realisasiToHtml(r: RealisasiHasil): string {
  const li = (kode: string, nama: string, n: number): string =>
    `<tr><td>${kode}</td><td>${esc(nama)}</td><td style="text-align:right">${formatRp(n)}</td></tr>`;
  return `<h2>Realisasi Anggaran ${r.mulai ?? ''} s/d ${r.sampai ?? ''}</h2>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th></tr></thead><tbody>
<tr><th colspan="3">PENDAPATAN</th></tr>${r.pendapatan.map((b) => li(b.kode, b.nama, b.nominal)).join('')}
<tr><th colspan="2">Total Pendapatan</th><th style="text-align:right">${formatRp(r.totalPendapatan)}</th></tr>
<tr><th colspan="3">BEBAN</th></tr>${r.beban.map((b) => li(b.kode, b.nama, b.nominal)).join('')}
<tr><th colspan="2">Total Beban</th><th style="text-align:right">${formatRp(r.totalBeban)}</th></tr>
<tr><th colspan="2">NET (Pendapatan - Beban)</th><th style="text-align:right">${formatRp(r.net)}</th></tr>
</tbody></table>`;
}

export function surplusToHtml(s: SurplusHasil): string {
  const li = (kode: string, nama: string, n: number, p: number): string =>
    `<tr><td>${kode}</td><td>${esc(nama)}</td><td style="text-align:right">${formatRp(n)}</td><td style="text-align:right">${p.toFixed(1)}%</td></tr>`;
  return `<h2>Surplus / (Defisit) ${s.mulai ?? ''} s/d ${s.sampai ?? ''}</h2>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th><th>%</th></tr></thead><tbody>
<tr><th colspan="4">PENDAPATAN</th></tr>${s.pendapatan.map((b) => li(b.kode, b.nama, b.nominal, b.persen)).join('')}
<tr><th colspan="2">Total Pendapatan</th><th style="text-align:right">${formatRp(s.totalPendapatan)}</th><th></th></tr>
<tr><th colspan="4">BEBAN</th></tr>${s.beban.map((b) => li(b.kode, b.nama, b.nominal, b.persen)).join('')}
<tr><th colspan="2">Total Beban</th><th style="text-align:right">${formatRp(s.totalBeban)}</th><th></th></tr>
<tr><th colspan="2">SURPLUS / (DEFISIT)</th><th style="text-align:right">${formatRp(s.surplus)}</th><th></th></tr>
</tbody></table>`;
}

/** Bungkus HTML laporan jadi dokumen print siap window.print / save-to-PDF. */
export function wrapPrintDocument(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@media print{button{display:none}}body{font-family:system-ui,sans-serif;margin:24px}table{border-collapse:collapse}</style>
</head><body><button onclick="window.print()">Print / Save PDF</button>${body}
<script>window.onload=()=>window.print()</script></body></html>`;
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
