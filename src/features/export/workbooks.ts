// Builder laporan murni (renderer-safe) — TANPA node:fs.
// Dipakai tab Electron di renderer: bangun workbook/HTML dari hasil builder,
// lalu kirim buffer ke main via IPC `file:save-buffer` untuk save dialog.
// Versi Node (writeXlsx/backupDb/restoreDb) ada di export.ts (main/tests saja).

import ExcelJS from 'exceljs';
import { formatPersen, formatRp, formatTanggal } from '../../utils/format.js';
import type { Aset } from '../../core/types.js';
import type { Neraca } from '../../core/ledger.js';
import type { PembantuHasil, RealisasiHasil, SurplusHasil } from '../reports/types.js';

// ---- Kop organisasi (wajib di SEMUA hasil export) ----
// Contoh dokumen resmi client:
//   "PURA DALEM PURI PELIATAN / NERACA / PER 30 Juni 2026"
//   "PURA DALEM PURI / BUKU BESAR / BULAN JANUARI S.D JUNI 2026"
// Nama kanonis mengikuti PRD + judul aplikasi: PURA DALEM PURI PELIATAN.
/** Nama organisasi untuk kop semua export (xlsx + HTML/print/PDF). */
export const KOP_ORG_NAMA = 'PURA DALEM PURI PELIATAN';

/** Teks periode "DD-MM-YYYY s/d DD-MM-YYYY" untuk subjudul kop. */
export function kopPeriode(mulai?: string, sampai?: string): string {
  const m = mulai ? formatTanggal(mulai) : '';
  const s = sampai ? formatTanggal(sampai) : '';
  if (m && s) return m === s ? m : `${m} s/d ${s}`;
  if (s) return `s/d ${s}`;
  if (m) return `mulai ${m}`;
  return '';
}

/** Rentang tanggal dari baris data (min/max kolom tanggal). */
export function rentangDariRows(rows: { tanggal: string }[]): { mulai?: string; sampai?: string } {
  if (rows.length === 0) return {};
  let min = rows[0]!.tanggal;
  let max = rows[0]!.tanggal;
  for (const r of rows) {
    if (r.tanggal < min) min = r.tanggal;
    if (r.tanggal > max) max = r.tanggal;
  }
  return { mulai: min, sampai: max };
}

/** Subjudul periode kop yang SELALU terisi (tak pernah string kosong):
 * 1. filter mulai/sampai bila ada,
 * 2. fallback ke rentang tanggal baris data,
 * 3. terakhir "SEMUA PERIODE".
 * `rows` opsional — untuk laporan agregat (realisasi/surplus) caller bisa
 * teruskan transaksi terfilter agar periode != "SEMUA PERIODE" bila ada data. */
export function kopPeriodeEfektif(
  mulai?: string,
  sampai?: string,
  rows?: { tanggal: string }[],
): string {
  const dariFilter = kopPeriode(mulai, sampai);
  if (dariFilter) return `PERIODE ${dariFilter}`;
  if (rows && rows.length > 0) {
    const { mulai: m2, sampai: s2 } = rentangDariRows(rows);
    const dariData = kopPeriode(m2, s2);
    if (dariData) return `PERIODE ${dariData}`;
  }
  return 'SEMUA PERIODE';
}

// ---- XLSX ----

function baseWorkbook(title: string): { wb: ExcelJS.Workbook; ws: ExcelJS.Worksheet } {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pura Dalem Puri';
  wb.created = new Date();
  const ws = wb.addWorksheet(title.slice(0, 31));
  return { wb, ws };
}

/** Tulis kop organisasi + judul + sub-periode di baris atas worksheet.
 * Return jumlah baris kop yang ditulis (untuk penomoran header tabel).
 * Semua baris kop di-merge selebar tabel + rata tengah + bold. */
function tulisKopXlsx(ws: ExcelJS.Worksheet, judul: string, subjudul: string, nKol: number): number {
  const baris: { teks: string; size: number }[] = [{ teks: KOP_ORG_NAMA, size: 14 }];
  baris.push({ teks: judul, size: 12 });
  if (subjudul) baris.push({ teks: subjudul, size: 11 });
  for (const b of baris) {
    const row = ws.addRow([b.teks]);
    row.font = { bold: true, size: b.size };
    row.alignment = { horizontal: 'center', vertical: 'middle' };
    if (nKol > 1) ws.mergeCells(row.number, 1, row.number, nKol);
  }
  return baris.length;
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true };
}

/** Pembantu → workbook. Kolom: Tanggal | Keterangan | Masuk | Keluar | Saldo jalan. */
export async function pembantuToWorkbook(p: PembantuHasil): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook(`Pembantu ${p.kode}`);
  tulisKopXlsx(ws, `BUKU PEMBANTU — ${p.kode} ${p.nama}`, kopPeriodeEfektif(p.mulai, p.sampai, p.rows), 4);
  const header = ws.addRow(['Tanggal', 'Keterangan', 'Masuk', 'Keluar']);
  styleHeader(header);
  let jalan = 0;
  for (const t of p.rows) {
    jalan += t.masuk - t.keluar;
    ws.addRow([formatTanggal(t.tanggal), t.keterangan, t.masuk === 0 ? '' : formatRp(t.masuk), t.keluar === 0 ? '' : formatRp(t.keluar)]);
  }
  const tr = ws.addRow(['TOTAL', '', formatRp(p.totalMasuk), formatRp(p.totalKeluar)]);
  styleHeader(tr);
  ws.addRow(['SALDO AKHIR', '', '', formatRp(p.saldo)]);
  ws.columns.forEach((c) => { c.width = 22; });
  ws.getColumn(2).width = 42;
  return wb;
}

/** Realisasi → workbook. Dua seksi + Net.
 * `rows` opsional: transaksi terfilter untuk fallback periode kop bila
 * filter tanggal kosong (agar subjudul periode selalu tampil). */
export async function realisasiToWorkbook(
  r: RealisasiHasil,
  rows?: { tanggal: string }[],
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Realisasi');
  tulisKopXlsx(ws, 'REALISASI ANGGARAN', kopPeriodeEfektif(r.mulai, r.sampai, rows), 3);
  const header = ws.addRow(['Kode', 'Uraian', 'Nominal']);
  styleHeader(header);
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

/** Surplus → workbook. Sama + kolom % + judul Surplus/(Defisit).
 * `rows` opsional: transaksi terfilter untuk fallback periode kop. */
export async function surplusToWorkbook(
  s: SurplusHasil,
  rows?: { tanggal: string }[],
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Surplus');
  tulisKopXlsx(ws, 'SURPLUS / (DEFISIT)', kopPeriodeEfektif(s.mulai, s.sampai, rows), 4);
  const header = ws.addRow(['Kode', 'Uraian', 'Nominal', '%']);
  styleHeader(header);
  ws.addRow(['PENDAPATAN', '', '', '']);
  for (const b of s.pendapatan)
    ws.addRow([b.kode, b.nama, formatRp(b.nominal), formatPersen(b.persen)]);
  const tp = ws.addRow(['Total Pendapatan', '', formatRp(s.totalPendapatan), formatPersen(100)]);
  styleHeader(tp);
  ws.addRow(['BEBAN', '', '', '']);
  for (const b of s.beban) ws.addRow([b.kode, b.nama, formatRp(b.nominal), formatPersen(b.persen)]);
  const tb = ws.addRow(['Total Beban', '', formatRp(s.totalBeban), formatPersen(100)]);
  styleHeader(tb);
  const sr = ws.addRow(['SURPLUS / (DEFISIT)', '', formatRp(s.surplus), '']);
  styleHeader(sr);
  ws.columns.forEach((c) => { c.width = 24; });
  ws.getColumn(2).width = 34;
  return wb;
}

/** Neraca → workbook (Aktiva + Pasiva, kop organisasi di atas). */
export async function neracaToWorkbook(n: Neraca): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Neraca');
  const status = n.balance ? 'BALANCE' : `SELISIH ${formatRp(n.selisih)}`;
  tulisKopXlsx(ws, 'NERACA', `PER ${formatTanggal(n.cutoff)} — ${status}`, 2);
  const ha = ws.addRow(['Aktiva', 'Nominal']);
  styleHeader(ha);
  for (const [k, v] of Object.entries(n.aktivaRinci.kas)) ws.addRow([`Kas ${k}`, formatRp(v)]);
  ws.addRow(['Piutang 1050', formatRp(n.aktivaRinci.piutang)]);
  ws.addRow(['Panjar OPEN', formatRp(n.aktivaRinci.panjarOpen)]);
  const ta = ws.addRow(['Total Aktiva', formatRp(n.aktiva)]);
  styleHeader(ta);
  const hp = ws.addRow(['Pasiva', 'Nominal']);
  styleHeader(hp);
  ws.addRow(['Hutang 2050', formatRp(n.hutang)]);
  ws.addRow(['Modal awal 3000', formatRp(n.modalAwal)]);
  ws.addRow(['Kumulatif 3001', formatRp(n.kumulatif)]);
  ws.addRow(['Berjalan 3002 (Jan s/d cut-off)', formatRp(n.berjalan)]);
  const tp = ws.addRow(['Total Pasiva', formatRp(n.pasiva)]);
  styleHeader(tp);
  ws.columns.forEach((c) => { c.width = 32; });
  ws.getColumn(2).width = 24;
  return wb;
}

/** Buku Besar / BKU → workbook generik (dipakai tab BKU / Buku Besar).
 * Kolom: Tanggal | Keterangan | Kode | Masuk | Keluar. Kop selalu di atas. */
export async function bkuToWorkbook(
  rows: { tanggal: string; keterangan: string; kode: string; masuk: number; keluar: number }[],
  opts: { judul?: string; mulai?: string; sampai?: string } = {},
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Buku Besar');
  tulisKopXlsx(ws, opts.judul ?? 'BUKU BESAR', kopPeriodeEfektif(opts.mulai, opts.sampai, rows), 5);
  const header = ws.addRow(['Tanggal', 'Keterangan', 'Kode', 'Masuk', 'Keluar']);
  styleHeader(header);
  let tm = 0;
  let tk = 0;
  for (const t of rows) {
    tm += t.masuk;
    tk += t.keluar;
    ws.addRow([
      formatTanggal(t.tanggal),
      t.keterangan,
      t.kode,
      t.masuk === 0 ? '' : formatRp(t.masuk),
      t.keluar === 0 ? '' : formatRp(t.keluar),
    ]);
  }
  const tr = ws.addRow(['TOTAL', '', '', formatRp(tm), formatRp(tk)]);
  styleHeader(tr);
  ws.columns.forEach((c) => { c.width = 22; });
  ws.getColumn(2).width = 42;
  return wb;
}

/** Versi buffer (untuk test + kirim ke main via IPC save dialog).
 * Renderer-safe: kembalikan Uint8Array murni TANPA global Node `Buffer`
 * (tidak ada di browser/Electron renderer sandbox → "Buffer is not defined").
 * `writeBuffer()` exceljs mengembalikan Buffer-polyfill (subclass Uint8Array)
 * atau ArrayBuffer — keduanya dinormalisasi ke Uint8Array baru. */
export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  const out = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
  if (out instanceof Uint8Array) return new Uint8Array(out);
  return new Uint8Array(out);
}

/** Inventaris Aset → workbook. Nilai null tampil "— (belum dinilai)". */
export async function asetToWorkbook(rows: Aset[]): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Inventaris Aset');
  tulisKopXlsx(ws, 'DAFTAR INVENTARIS ASET', `${rows.length} aset tercatat (non-keuangan, tidak masuk Neraca)`, 7);
  const header = ws.addRow(['Kode', 'Nama', 'Jenis', 'Luas (m²)', 'Lokasi', 'Status/Kondisi', 'Nilai']);
  styleHeader(header);
  for (const a of rows) {
    ws.addRow([
      a.kode,
      a.nama,
      a.jenis,
      a.luas_m2 === null ? '' : a.luas_m2,
      a.lokasi || '—',
      `${a.status_hukum || '—'} / ${a.kondisi}`,
      a.nilai_sen === null ? '— (belum dinilai)' : formatRp(a.nilai_sen),
    ]);
  }
  const dinilai = rows.filter((a) => a.nilai_sen !== null).reduce((s, a) => s + (a.nilai_sen ?? 0), 0);
  const tr = ws.addRow(['JUMLAH', `${rows.length} aset`, '', '', '', 'Total yang sudah dinilai', formatRp(dinilai)]);
  styleHeader(tr);
  ws.columns.forEach((c) => { c.width = 20; });
  ws.getColumn(2).width = 34;
  ws.getColumn(5).width = 28;
  return wb;
}

// ---- Print / PDF (renderer: window.print; Electron: printToPDF via main) ----

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Kop organisasi HTML — rata tengah, dipakai di ATAS setiap body laporan
 * (print popup, Simpan PDF, dan pratinjau). Judul + sub-periode opsional. */
export function kopHtml(judul: string, subjudul?: string): string {
  return `<div style="text-align:center;margin-bottom:12px;line-height:1.5">`
    + `<div style="font-weight:bold;font-size:14pt">${esc(KOP_ORG_NAMA)}</div>`
    + `<div style="font-weight:bold;font-size:12pt">${esc(judul)}</div>`
    + (subjudul ? `<div style="font-size:10pt">${esc(subjudul)}</div>` : '')
    + `</div>`;
}

export function pembantuToHtml(p: PembantuHasil): string {
  const rows = p.rows
    .map((t) => `<tr><td>${formatTanggal(t.tanggal)}</td><td>${esc(t.keterangan)}</td><td style="text-align:right">${formatRp(t.masuk)}</td><td style="text-align:right">${formatRp(t.keluar)}</td></tr>`)
    .join('');
  return `${kopHtml(`BUKU PEMBANTU — ${p.kode} ${p.nama}`, kopPeriodeEfektif(p.mulai, p.sampai, p.rows))}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>Keterangan</th><th>Masuk</th><th>Keluar</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th colspan="2">TOTAL</th><th style="text-align:right">${formatRp(p.totalMasuk)}</th><th style="text-align:right">${formatRp(p.totalKeluar)}</th></tr>
<tr><th colspan="3">SALDO AKHIR</th><th style="text-align:right">${formatRp(p.saldo)}</th></tr></tfoot></table>`;
}

export function realisasiToHtml(r: RealisasiHasil, rows?: { tanggal: string }[]): string {
  const li = (kode: string, nama: string, n: number): string =>
    `<tr><td>${kode}</td><td>${esc(nama)}</td><td style="text-align:right">${formatRp(n)}</td></tr>`;
  return `${kopHtml('REALISASI ANGGARAN', kopPeriodeEfektif(r.mulai, r.sampai, rows))}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th></tr></thead><tbody>
<tr><th colspan="3">PENDAPATAN</th></tr>${r.pendapatan.map((b) => li(b.kode, b.nama, b.nominal)).join('')}
<tr><th colspan="2">Total Pendapatan</th><th style="text-align:right">${formatRp(r.totalPendapatan)}</th></tr>
<tr><th colspan="3">BEBAN</th></tr>${r.beban.map((b) => li(b.kode, b.nama, b.nominal)).join('')}
<tr><th colspan="2">Total Beban</th><th style="text-align:right">${formatRp(r.totalBeban)}</th></tr>
<tr><th colspan="2">NET (Pendapatan - Beban)</th><th style="text-align:right">${formatRp(r.net)}</th></tr>
</tbody></table>`;
}

export function surplusToHtml(s: SurplusHasil, rows?: { tanggal: string }[]): string {
  const li = (kode: string, nama: string, n: number, p: number): string =>
    `<tr><td>${kode}</td><td>${esc(nama)}</td><td style="text-align:right">${formatRp(n)}</td><td style="text-align:right">${formatPersen(p)}</td></tr>`;
  return `${kopHtml('SURPLUS / (DEFISIT)', kopPeriodeEfektif(s.mulai, s.sampai, rows))}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th><th>%</th></tr></thead><tbody>
<tr><th colspan="4">PENDAPATAN</th></tr>${s.pendapatan.map((b) => li(b.kode, b.nama, b.nominal, b.persen)).join('')}
<tr><th colspan="2">Total Pendapatan</th><th style="text-align:right">${formatRp(s.totalPendapatan)}</th><th></th></tr>
<tr><th colspan="4">BEBAN</th></tr>${s.beban.map((b) => li(b.kode, b.nama, b.nominal, b.persen)).join('')}
<tr><th colspan="2">Total Beban</th><th style="text-align:right">${formatRp(s.totalBeban)}</th><th></th></tr>
<tr><th colspan="2">SURPLUS / (DEFISIT)</th><th style="text-align:right">${formatRp(s.surplus)}</th><th></th></tr>
</tbody></table>`;
}

/** Buku Besar / BKU → HTML generik (kolom Kode seperti dokumen resmi client).
 * Dipakai tab BKU / Buku Besar; kop selalu di atas. */
export function bkuToHtml(
  rows: { tanggal: string; keterangan: string; kode: string; masuk: number; keluar: number }[],
  opts: { judul?: string; mulai?: string; sampai?: string } = {},
): string {
  const body = rows
    .map(
      (t) =>
        `<tr><td>${formatTanggal(t.tanggal)}</td><td>${esc(t.keterangan)}</td><td>${esc(t.kode)}</td>` +
        `<td style="text-align:right">${formatRp(t.masuk)}</td><td style="text-align:right">${formatRp(t.keluar)}</td></tr>`,
    )
    .join('');
  const tm = rows.reduce((s, t) => s + t.masuk, 0);
  const tk = rows.reduce((s, t) => s + t.keluar, 0);
  return `${kopHtml(opts.judul ?? 'BUKU BESAR', kopPeriodeEfektif(opts.mulai, opts.sampai, rows))}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>Keterangan</th><th>Kode</th><th>Masuk</th><th>Keluar</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><th colspan="3">TOTAL</th><th style="text-align:right">${formatRp(tm)}</th><th style="text-align:right">${formatRp(tk)}</th></tr></tfoot></table>`;
}

/** Bungkus HTML laporan jadi dokumen print siap window.print / save-to-PDF.
 * `autoPrint:false` untuk alur Simpan PDF (hidden window + printToPDF di main)
 * agar script window.print() tidak memicu dialog di window tersembunyi. */
export function wrapPrintDocument(title: string, body: string, opts: { autoPrint?: boolean } = {}): string {
  const { autoPrint = true } = opts;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>@page{size:A4;margin:14mm 12mm}@media print{button{display:none}}body{font-family:system-ui,sans-serif;margin:24px;font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:5px 7px}thead{display:table-header-group}tfoot{display:table-footer-group}tr{page-break-inside:avoid}</style>
</head><body>${autoPrint ? '<button onclick="window.print()">Print / Save PDF</button>' : ''}${body}
${autoPrint ? '<script>window.onload=()=>window.print()</script>' : ''}</body></html>`;
}

/** Inventaris Aset → HTML tabel untuk print/PDF. */
export function asetToHtml(rows: Aset[]): string {
  const body = rows
    .map(
      (a) =>
        `<tr><td>${esc(a.kode)}</td><td>${esc(a.nama)}</td><td>${esc(a.jenis)}</td>` +
        `<td>${a.luas_m2 === null ? '—' : String(a.luas_m2)}</td><td>${esc(a.lokasi || '—')}</td>` +
        `<td>${esc(a.status_hukum || '—')} / ${esc(a.kondisi)}</td>` +
        `<td style="text-align:right">${a.nilai_sen === null ? '— (belum dinilai)' : formatRp(a.nilai_sen)}</td></tr>`,
    )
    .join('');
  const dinilai = rows.filter((a) => a.nilai_sen !== null).reduce((s, a) => s + (a.nilai_sen ?? 0), 0);
  return `${kopHtml('DAFTAR INVENTARIS ASET', `${rows.length} aset tercatat (non-keuangan, tidak masuk Neraca)`)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Nama</th><th>Jenis</th><th>Luas (m²)</th><th>Lokasi</th><th>Status/Kondisi</th><th>Nilai</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><th colspan="6">Total yang sudah dinilai (${rows.filter((a) => a.nilai_sen !== null).length} aset)</th><th style="text-align:right">${formatRp(dinilai)}</th></tr></tfoot></table>`;
}

/** Neraca → HTML tabel bersih untuk print (Aktiva + Pasiva). */
export function neracaToHtml(n: Neraca): string {
  const kasRows = Object.entries(n.aktivaRinci.kas)
    .map(([k, v]) => `<tr><td>Kas ${esc(k)}</td><td style="text-align:right">${formatRp(v)}</td></tr>`)
    .join('');
  const status = n.balance ? 'BALANCE' : `SELISIH ${formatRp(n.selisih)}`;
  return `${kopHtml('NERACA', `PER ${formatTanggal(n.cutoff)} — ${status}`)}
<h3>Aktiva — ${formatRp(n.aktiva)}</h3>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<tbody>${kasRows}
<tr><td>Piutang 1050</td><td style="text-align:right">${formatRp(n.aktivaRinci.piutang)}</td></tr>
<tr><td>Panjar OPEN</td><td style="text-align:right">${formatRp(n.aktivaRinci.panjarOpen)}</td></tr>
<tr><th style="text-align:right">Total Aktiva</th><th style="text-align:right">${formatRp(n.aktiva)}</th></tr>
</tbody></table>
<h3>Pasiva — ${formatRp(n.pasiva)}</h3>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<tbody>
<tr><td>Hutang 2050</td><td style="text-align:right">${formatRp(n.hutang)}</td></tr>
<tr><td>Modal awal 3000</td><td style="text-align:right">${formatRp(n.modalAwal)}</td></tr>
<tr><td>Kumulatif 3001</td><td style="text-align:right">${formatRp(n.kumulatif)}</td></tr>
<tr><td>Berjalan 3002 (Jan s/d cut-off)</td><td style="text-align:right">${formatRp(n.berjalan)}</td></tr>
<tr><th style="text-align:right">Total Pasiva</th><th style="text-align:right">${formatRp(n.pasiva)}</th></tr>
</tbody></table>`;
}

/** Buka dokumen print bersih (hanya data) di window baru lalu auto-print.
 * Renderer-only: gantikan window.print() langsung yang ikut mencetak sidebar/filter. */
export function printLaporan(title: string, body: string): void {
  const html = wrapPrintDocument(title, body);
  const w = window.open('', '_blank', 'width=900,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
}
