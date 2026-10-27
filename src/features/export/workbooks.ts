// Builder laporan murni (renderer-safe) — TANPA node:fs.
// Dipakai tab Electron di renderer: bangun workbook/HTML dari hasil builder,
// lalu kirim buffer ke main via IPC `file:save-buffer` untuk save dialog.
// Versi Node (writeXlsx/backupVacuumInto/restoreDbAman) ada di export.ts (main/tests saja).

import ExcelJS from 'exceljs';
import { formatPersen, formatRp, formatTanggal } from '../../utils/format.js';
import type { Coa, PosisiNormal } from '../../db/coa.js';
import type { KopOrganisasi } from '../../core/pengaturan.js';
import type {
  ArusKasHasil,
  BukuBesarHasil,
  LabaRugiHasil,
  NeracaHasil,
  NeracaSaldoModeHasil,
} from '../../core/reports.js';
import type {
  RealisasiAnggaranBaris,
  RealisasiAnggaranHasil,
  TotalRealisasiAnggaran,
} from '../../core/anggaran.js';
import type { Aset, Panjar, PanjarItem } from '../../core/types.js';
import type { Neraca } from '../../core/ledger.js';
import type { PembantuHasil, RealisasiHasil, SurplusHasil } from '../reports/types.js';

// ---- Kop organisasi (wajib di SEMUA hasil export) ----
// Contoh dokumen resmi client:
//   "PURA DALEM PURI PELIATAN / NERACA / PER 30 Juni 2026"
//   "PURA DALEM PURI / BUKU BESAR / BULAN JANUARI S.D JUNI 2026"
// Nama kanonis mengikuti PRD + judul aplikasi: PURA DALEM PURI PELIATAN.
/** Nama organisasi untuk kop semua export (xlsx + HTML/print/PDF). */
export const KOP_ORG_NAMA = 'PURA DALEM PURI PELIATAN';

/** Kop default bila pemanggil tidak memberi kop dari pengaturan (P1-13). */
export const KOP_DEFAULT: KopOrganisasi = { nama: KOP_ORG_NAMA };

function barisKop(kop?: KopOrganisasi | null): string[] {
  const nama = String(kop?.nama ?? '').trim() || KOP_ORG_NAMA;
  const tambahan = String(kop?.tambahan ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 2);
  return [nama, ...tambahan];
}

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
export function rentangDariRows(rows: readonly { tanggal: string }[]): { mulai?: string; sampai?: string } {
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
  rows?: readonly { tanggal: string }[],
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
 * Semua baris kop di-merge selebar tabel + rata tengah + bold.
 * `kop` opsional (P1-13): nama entitas + maks. 2 baris tambahan; default tetap
 * KOP_ORG_NAMA agar pemanggil/test lama tidak berubah. */
function tulisKopXlsx(
  ws: ExcelJS.Worksheet,
  judul: string,
  subjudul: string,
  nKol: number,
  kop?: KopOrganisasi,
): number {
  const baris: { teks: string; size: number }[] = [];
  const [nama, ...tambahan] = barisKop(kop);
  baris.push({ teks: nama!, size: 14 });
  for (const t of tambahan) baris.push({ teks: t, size: 10 });
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

/** Pembantu → workbook. Kolom: Tanggal | Keterangan | Masuk | Keluar | Saldo.
 * Nominal = NUMBER Rupiah + numFmt Rp (bisa di-SUM di Excel), saldo berjalan
 * dimulai dari saldo awal periode. */
export async function pembantuToWorkbook(
  p: PembantuHasil,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook(`Pembantu ${p.kode}`);
  tulisKopXlsx(ws, `BUKU PEMBANTU — ${p.kode} ${p.nama}`, kopPeriodeEfektif(p.mulai, p.sampai, p.rows), 5, kop);
  const header = ws.addRow(['Tanggal', 'Keterangan', 'Masuk', 'Keluar', 'Saldo']);
  styleHeader(header);
  if (p.saldoAwal !== undefined) {
    const awal = ws.addRow(['', 'Saldo awal', null, null, null]);
    selRp(awal, 3, 0);
    selRp(awal, 4, 0);
    selRp(awal, 5, p.saldoAwal);
  }
  let saldo = p.saldoAwal ?? 0;
  for (const t of p.rows) {
    saldo += t.masuk - t.keluar;
    const row = ws.addRow([formatTanggal(t.tanggal), t.keterangan, null, null, null]);
    selRp(row, 3, t.masuk);
    selRp(row, 4, t.keluar);
    selRp(row, 5, saldo);
  }
  const tr = ws.addRow(['TOTAL', '', null, null, null]);
  selRp(tr, 3, p.totalMasuk);
  selRp(tr, 4, p.totalKeluar);
  styleHeader(tr);
  const akhir = ws.addRow(['SALDO AKHIR', '', null, null, null]);
  selRp(akhir, 3, 0);
  selRp(akhir, 4, 0);
  selRp(akhir, 5, p.saldo);
  styleHeader(akhir);
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
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Realisasi');
  tulisKopXlsx(ws, 'REALISASI ANGGARAN', kopPeriodeEfektif(r.mulai, r.sampai, rows), 3, kop);
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
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Surplus');
  tulisKopXlsx(ws, 'SURPLUS / (DEFISIT)', kopPeriodeEfektif(s.mulai, s.sampai, rows), 4, kop);
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
export async function neracaToWorkbook(
  n: Neraca,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Neraca');
  const status = n.balance ? 'BALANCE' : `SELISIH ${formatRp(n.selisih)}`;
  tulisKopXlsx(ws, 'NERACA', `PER ${formatTanggal(n.cutoff)} — ${status}`, 2, kop);
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
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Buku Besar');
  tulisKopXlsx(ws, opts.judul ?? 'BUKU BESAR', kopPeriodeEfektif(opts.mulai, opts.sampai, rows), 5, kop);
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
export async function asetToWorkbook(
  rows: Aset[],
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Inventaris Aset');
  tulisKopXlsx(ws, 'DAFTAR INVENTARIS ASET', `${rows.length} aset tercatat (non-keuangan, tidak masuk Neraca)`, 7, kop);
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

// ---------------------------------------------------------------------------
// Builder laporan double-entry (P1-10)
// ---------------------------------------------------------------------------
// Semua nominal internal adalah SEN. Sel Excel WAJIB berisi angka RUPIAH
// (sen / 100) + numFmt — bukan string hasil formatRp. formatRp hanya untuk
// HTML/print. Nominal negatif tetap angka negatif; numFmt menampilkan kurung.

/** Format sel nominal Rupiah: positif Rp 1.500,00; negatif (Rp 1.500,00). */
export const NUMFMT_RP = '"Rp"#,##0.00;(Rp"#,##0.00)';
/** Format sel persen: nilai fraksi 0..1 (0,5 = 50,00%). */
export const NUMFMT_PERSEN = '0.00%';

export type JurnalBarisTampil = {
  id?: number;
  akun_kode: string;
  debit: number;
  kredit: number;
  keterangan?: string | null;
};

/** Bentuk minimal jurnal untuk export; `JurnalLengkap` memenuhi tipe ini. */
export type JurnalTampil = {
  id?: string;
  tanggal: string;
  no_bukti?: string;
  keterangan: string;
  jenis?: string;
  reversal_of?: string | null;
  reversal_id?: string | null;
  total_debit?: number;
  baris: ReadonlyArray<JurnalBarisTampil>;
};

/** Panjar + rincian item pertanggungjawaban (opsional, dimuat saat export). */
export type PanjarTampil = Panjar & { items?: ReadonlyArray<PanjarItem> };

const LABEL_JENIS_JURNAL: Record<string, string> = {
  UMUM: 'Jurnal Umum',
  TERIMA: 'Terima Uang',
  BAYAR: 'Bayar / Beban',
  TRANSFER: 'Pindah Dana',
  PANJAR: 'Panjar',
  PIUTANG: 'Piutang',
  HUTANG: 'Hutang',
  SALDO_AWAL: 'Saldo Awal',
  REVERSAL: 'Jurnal Balik',
};

const LABEL_TIPE_COA: Record<Coa['tipe'], string> = {
  AKTIVA: 'Aktiva',
  KEWAJIBAN: 'Kewajiban',
  EKUITAS: 'Ekuitas',
  PENDAPATAN: 'Pendapatan',
  BEBAN: 'Beban',
};

const LABEL_KELOMPOK_ARUS_KAS: Record<ArusKasHasil['rows'][number]['kelompok'], string> = {
  OPERASI: 'Operasi',
  INVESTASI: 'Investasi',
  PENDANAAN: 'Pendanaan',
  TRANSFER: 'Transfer',
};

/** Label sisi saldo: positif = posisi normal akun, negatif = sisi lawannya. */
function sisiDariSaldo(saldo: number, posisiNormal: PosisiNormal): PosisiNormal | null {
  if (saldo === 0) return null;
  if (saldo > 0) return posisiNormal;
  return posisiNormal === 'DEBIT' ? 'KREDIT' : 'DEBIT';
}

function labelSisi(sisi: PosisiNormal | null): string {
  return sisi === null ? 'Nol' : sisi === 'DEBIT' ? 'Debit' : 'Kredit';
}

function labelJenis(jenis?: string): string {
  return jenis ? (LABEL_JENIS_JURNAL[jenis] ?? jenis) : '';
}

function statusKoreksi(j: JurnalTampil): string {
  if (j.reversal_of) return 'Jurnal balik';
  if (j.reversal_id) return 'Sudah dikoreksi';
  return 'Aktif';
}

function namaAkunCoa(coa: readonly Coa[], kode: string): string {
  const a = coa.find((x) => x.kode === kode);
  return a ? `${a.kode} — ${a.nama}` : kode;
}

function namaPanjar(coa: readonly Coa[], kode: string): string {
  return namaAkunCoa(coa, kode);
}

/** SEN → angka Rupiah untuk sel Excel. */
const rupiah = (sen: number): number => sen / 100;

/** Tulis nominal SEN ke sel sebagai NUMBER Rupiah + numFmt Rupiah. */
function selRp(row: ExcelJS.Row, kolom: number, sen: number): void {
  const cell = row.getCell(kolom);
  cell.value = rupiah(sen);
  cell.numFmt = NUMFMT_RP;
}

/** Tulis persen sebagai NUMBER fraksi 0..1 + numFmt persen. */
function selPersen(row: ExcelJS.Row, kolom: number, fraksi: number): void {
  const cell = row.getCell(kolom);
  cell.value = fraksi;
  cell.numFmt = NUMFMT_PERSEN;
}

/** Fraksi persen untuk tampilan (bukan perhitungan ulang laporan). */
function fraksi(nominal: number, dasar: number): number {
  return dasar === 0 ? 0 : nominal / dasar;
}

/** Subjudul periode untuk laporan per cut-off: "PER 31-12-2026". */
export function kopPeriodeCutoff(cutoff?: string): string {
  return cutoff ? `PER ${formatTanggal(cutoff)}` : 'SEMUA PERIODE';
}

/**
 * Subjudul Neraca Saldo sesuai mode (AUD-21b): tahun buku menampilkan
 * rentang 1 Januari s/d cut-off, kumulatif tetap "PER cut-off".
 */
export function kopPeriodeNeracaSaldo(ns: NeracaSaldoModeHasil): string {
  return ns.mode === 'tahun'
    ? `TAHUN BUKU ${kopPeriode(ns.mulai, ns.sampai)}`
    : kopPeriodeCutoff(ns.cutoff);
}

/** Bagian nama file dari periode/cut-off; aman untuk nama file Windows. */
export function periodeFile(mulai?: string, sampai?: string): string {
  if (mulai && sampai) return mulai === sampai ? mulai : `${mulai}_sd_${sampai}`;
  if (sampai) return `sd_${sampai}`;
  if (mulai) return `mulai_${mulai}`;
  return 'semua-periode';
}

/** Jurnal Umum (satu atau banyak jurnal) → workbook.
 * Kolom: Tanggal | No. Bukti | Akun | Keterangan | Debit | Kredit | Jenis | Status.
 * Setiap jurnal diberi baris subtotal; ditutup total keseluruhan. */
export async function jurnalToWorkbook(
  jurnal: JurnalTampil | readonly JurnalTampil[],
  coa: readonly Coa[] = [],
  opts: { mulai?: string; sampai?: string; kop?: KopOrganisasi } = {},
): Promise<ExcelJS.Workbook> {
  const daftar: readonly JurnalTampil[] = Array.isArray(jurnal)
    ? jurnal
    : [jurnal as JurnalTampil];
  const { wb, ws } = baseWorkbook('Jurnal Umum');
  const kop = tulisKopXlsx(
    ws,
    'JURNAL UMUM',
    kopPeriodeEfektif(opts.mulai, opts.sampai, daftar),
    8,
    opts.kop,
  );
  ws.views = [{ state: 'frozen', ySplit: kop + 1 }];

  const header = ws.addRow([
    'Tanggal',
    'No. Bukti',
    'Akun',
    'Keterangan',
    'Debit',
    'Kredit',
    'Jenis',
    'Status',
  ]);
  styleHeader(header);

  let grandDebit = 0;
  let grandKredit = 0;
  for (const j of daftar) {
    let subDebit = 0;
    let subKredit = 0;
    for (const b of j.baris) {
      const row = ws.addRow([
        formatTanggal(j.tanggal),
        j.no_bukti?.trim() || '—',
        namaAkunCoa(coa, b.akun_kode),
        b.keterangan?.trim() || j.keterangan,
        null,
        null,
        labelJenis(j.jenis),
        statusKoreksi(j),
      ]);
      selRp(row, 5, b.debit);
      selRp(row, 6, b.kredit);
      subDebit += b.debit;
      subKredit += b.kredit;
    }
    const noBukti = j.no_bukti?.trim() || j.id || 'tanpa nomor';
    const subtotal = ws.addRow(['', '', '', `Subtotal ${noBukti}`, null, null, '', '']);
    selRp(subtotal, 5, subDebit);
    selRp(subtotal, 6, subKredit);
    styleHeader(subtotal);
    grandDebit += subDebit;
    grandKredit += subKredit;
  }

  const total = ws.addRow(['', '', '', 'TOTAL KESELURUHAN', null, null, '', '']);
  selRp(total, 5, grandDebit);
  selRp(total, 6, grandKredit);
  styleHeader(total);

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 38;
  ws.getColumn(4).width = 44;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 16;
  ws.getColumn(8).width = 18;
  return wb;
}

/** Buku Besar satu akun → workbook (saldo awal, mutasi + saldo berjalan,
 * total debit/kredit, saldo akhir, kolom sisi). */
export async function bukuBesarToWorkbook(
  bb: BukuBesarHasil,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook(`Buku Besar ${bb.kode}`);
  const barisKopXlsx = tulisKopXlsx(
    ws,
    `BUKU BESAR — ${bb.kode} ${bb.nama}`,
    kopPeriodeEfektif(bb.mulai, bb.sampai, bb.rows),
    7,
    kop,
  );
  ws.views = [{ state: 'frozen', ySplit: barisKopXlsx + 1 }];

  const header = ws.addRow([
    'Tanggal',
    'No. Bukti',
    'Keterangan',
    'Debit',
    'Kredit',
    'Saldo',
    'Sisi',
  ]);
  styleHeader(header);

  const awal = ws.addRow([
    'Saldo awal',
    '',
    bb.mulai ? `sebelum ${formatTanggal(bb.mulai)}` : 'tanpa batas awal',
    null,
    null,
    null,
    labelSisi(sisiDariSaldo(bb.saldoAwal, bb.posisi_normal)),
  ]);
  selRp(awal, 4, 0);
  selRp(awal, 5, 0);
  selRp(awal, 6, bb.saldoAwal);

  for (const r of bb.rows) {
    const row = ws.addRow([
      formatTanggal(r.tanggal),
      r.no_bukti || '—',
      r.keterangan || '—',
      null,
      null,
      null,
      labelSisi(r.posisi),
    ]);
    selRp(row, 4, r.debit);
    selRp(row, 5, r.kredit);
    selRp(row, 6, r.saldo);
  }

  const total = ws.addRow(['TOTAL MUTASI', '', '', null, null, null, '']);
  selRp(total, 4, bb.totalDebit);
  selRp(total, 5, bb.totalKredit);
  selRp(total, 6, bb.saldoAkhir);
  styleHeader(total);

  const akhir = ws.addRow([
    'SALDO AKHIR',
    '',
    '',
    null,
    null,
    null,
    labelSisi(sisiDariSaldo(bb.saldoAkhir, bb.posisi_normal)),
  ]);
  selRp(akhir, 4, 0);
  selRp(akhir, 5, 0);
  selRp(akhir, 6, bb.saldoAkhir);
  styleHeader(akhir);

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 44;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 12;
  return wb;
}

/** Neraca Saldo per cut-off/tahun buku → workbook (semua akun + total + status). */
export async function neracaSaldoToWorkbook(
  ns: NeracaSaldoModeHasil,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Neraca Saldo');
  const barisKopXlsx = tulisKopXlsx(
    ws,
    'NERACA SALDO',
    kopPeriodeNeracaSaldo(ns),
    6,
    kop,
  );
  ws.views = [{ state: 'frozen', ySplit: barisKopXlsx + 1 }];

  const header = ws.addRow(['Kode', 'Nama Akun', 'Tipe', 'Debit', 'Kredit', 'Saldo']);
  styleHeader(header);
  for (const r of ns.rows) {
    const row = ws.addRow([
      r.kode,
      r.nama,
      LABEL_TIPE_COA[r.tipe],
      null,
      null,
      null,
    ]);
    if ('sintetis' in r && r.sintetis) row.font = { italic: true };
    selRp(row, 4, r.debit);
    selRp(row, 5, r.kredit);
    selRp(row, 6, r.saldo);
  }

  const total = ws.addRow(['TOTAL', '', '', null, null, null]);
  selRp(total, 4, ns.totalDebit);
  selRp(total, 5, ns.totalKredit);
  selRp(total, 6, 0);
  styleHeader(total);

  const status = ws.addRow([
    'STATUS',
    ns.seimbang ? 'Seimbang' : 'Selisih',
    '',
    null,
    null,
    null,
  ]);
  selRp(status, 4, 0);
  selRp(status, 5, 0);
  selRp(status, 6, ns.selisih);
  styleHeader(status);

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 42;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 18;
  return wb;
}

/** Laba Rugi periode → workbook (pendapatan, beban, total, laba/defisit, %). */
export async function labaRugiToWorkbook(
  lr: LabaRugiHasil,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Laba Rugi');
  const barisKopXlsx = tulisKopXlsx(
    ws,
    'LABA RUGI',
    kopPeriodeEfektif(lr.mulai, lr.sampai),
    4,
    kop,
  );
  ws.views = [{ state: 'frozen', ySplit: barisKopXlsx + 1 }];

  const header = ws.addRow(['Kode', 'Uraian', 'Nominal', '%']);
  styleHeader(header);

  const pendapatan = lr.pendapatan.filter((b) => b.nominal !== 0);
  const beban = lr.beban.filter((b) => b.nominal !== 0);

  ws.addRow(['', 'PENDAPATAN', null, null]);
  for (const b of pendapatan) {
    const row = ws.addRow([b.kode, b.nama, null, null]);
    selRp(row, 3, b.nominal);
    selPersen(row, 4, fraksi(b.nominal, lr.totalPendapatan));
  }
  const totalPendapatan = ws.addRow(['', 'Total Pendapatan', null, null]);
  selRp(totalPendapatan, 3, lr.totalPendapatan);
  selPersen(totalPendapatan, 4, lr.totalPendapatan === 0 ? 0 : 1);
  styleHeader(totalPendapatan);

  ws.addRow(['', 'BEBAN', null, null]);
  for (const b of beban) {
    const row = ws.addRow([b.kode, b.nama, null, null]);
    selRp(row, 3, b.nominal);
    selPersen(row, 4, fraksi(b.nominal, lr.totalPendapatan));
  }
  const totalBeban = ws.addRow(['', 'Total Beban', null, null]);
  selRp(totalBeban, 3, lr.totalBeban);
  selPersen(totalBeban, 4, fraksi(lr.totalBeban, lr.totalPendapatan));
  styleHeader(totalBeban);

  const laba = ws.addRow(['', 'LABA / (DEFISIT)', null, null]);
  selRp(laba, 3, lr.laba);
  selPersen(laba, 4, fraksi(lr.laba, lr.totalPendapatan));
  styleHeader(laba);

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 44;
  ws.getColumn(3).width = 20;
  ws.getColumn(4).width = 12;
  return wb;
}

const statusAnggaran = (lebih: boolean): string => (lebih ? 'Lebih' : 'Sesuai');

/**
 * Anggaran & realisasi per akun → workbook (P2-1).
 * Kolom: Kode | Uraian | Pagu | Realisasi | Sisa | % | Status.
 * Semua nominal = NUMBER Rupiah (SEN/100) + numFmt Rp; persen = NUMBER fraksi
 * 0..1 + numFmt persen. Baris total memakai angka dari core/anggaran.ts.
 */
export async function anggaranToWorkbook(
  hasil: RealisasiAnggaranHasil,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Anggaran');
  const barisKopXlsx = tulisKopXlsx(
    ws,
    'ANGGARAN & REALISASI',
    kopPeriodeEfektif(hasil.mulai, hasil.sampai),
    7,
    kop,
  );
  ws.views = [{ state: 'frozen', ySplit: barisKopXlsx + 1 }];

  const header = ws.addRow([
    'Kode',
    'Uraian',
    'Pagu',
    'Realisasi',
    'Sisa',
    '%',
    'Status',
  ]);
  styleHeader(header);

  const tulisBagian = (
    judul: string,
    rows: readonly RealisasiAnggaranBaris[],
    total: TotalRealisasiAnggaran,
  ): void => {
    ws.addRow(['', judul, null, null, null, null, '']);
    for (const b of rows.filter((r) => r.anggaran !== 0 || r.realisasi !== 0)) {
      const row = ws.addRow([b.kode, b.nama, null, null, null, null, statusAnggaran(b.lebih)]);
      selRp(row, 3, b.anggaran);
      selRp(row, 4, b.realisasi);
      selRp(row, 5, b.sisa);
      selPersen(row, 6, b.persen / 100);
    }
    const totalRow = ws.addRow([
      '',
      `Total ${judul === 'PENDAPATAN' ? 'Pendapatan' : judul === 'BEBAN' ? 'Beban' : judul}`,
      null,
      null,
      null,
      null,
      statusAnggaran(total.lebih),
    ]);
    selRp(totalRow, 3, total.anggaran);
    selRp(totalRow, 4, total.realisasi);
    selRp(totalRow, 5, total.sisa);
    selPersen(totalRow, 6, total.persen / 100);
    styleHeader(totalRow);
  };

  tulisBagian('PENDAPATAN', hasil.pendapatan, hasil.totalPendapatan);
  tulisBagian('BEBAN', hasil.beban, hasil.totalBeban);

  const total = ws.addRow([
    '',
    'TOTAL ANGGARAN & REALISASI',
    null,
    null,
    null,
    null,
    statusAnggaran(hasil.total.lebih),
  ]);
  selRp(total, 3, hasil.total.anggaran);
  selRp(total, 4, hasil.total.realisasi);
  selRp(total, 5, hasil.total.sisa);
  selPersen(total, 6, hasil.total.persen / 100);
  styleHeader(total);

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 44;
  ws.getColumn(3).width = 18;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 12;
  ws.getColumn(7).width = 12;
  return wb;
}

/** Neraca per cut-off → workbook (aset, kewajiban, ekuitas + laba turunan,
 * total aset/pasiva, status selisih). */
export async function neracaHasilToWorkbook(
  n: NeracaHasil,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Neraca');
  const statusText = n.balance ? 'SEIMBANG' : 'SELISIH';
  const barisKopXlsx = tulisKopXlsx(
    ws,
    'NERACA',
    `${kopPeriodeCutoff(n.cutoff)} — ${statusText}`,
    3,
    kop,
  );
  ws.views = [{ state: 'frozen', ySplit: barisKopXlsx + 1 }];

  const header = ws.addRow(['Kode', 'Uraian', 'Nominal']);
  styleHeader(header);

  const tulisBagian = (judul: string, rows: { kode: string; nama: string; saldo: number }[]): void => {
    ws.addRow(['', judul, null]);
    for (const a of rows.filter((x) => x.saldo !== 0)) {
      const row = ws.addRow([a.kode, a.nama, null]);
      selRp(row, 3, a.saldo);
    }
  };

  tulisBagian('ASET', n.aset);
  const totalAset = ws.addRow(['', 'Total Aset', null]);
  selRp(totalAset, 3, n.totalAset);
  styleHeader(totalAset);

  tulisBagian('KEWAJIBAN', n.kewajiban);
  const totalKewajiban = ws.addRow(['', 'Total Kewajiban', null]);
  selRp(totalKewajiban, 3, n.totalKewajiban);
  styleHeader(totalKewajiban);

  tulisBagian('EKUITAS', n.ekuitas);
  const labaDitahan = ws.addRow(['—', 'Laba ditahan (tahun sudah tutup)', null]);
  selRp(labaDitahan, 3, n.labaDitahan);
  const labaBelum = ws.addRow(['—', 'Laba tahun lampau belum ditutup', null]);
  selRp(labaBelum, 3, n.labaBelumDitutup);
  const labaBerjalan = ws.addRow(['—', 'Laba berjalan (1 Januari s/d cut-off)', null]);
  selRp(labaBerjalan, 3, n.labaBerjalan);
  const totalEkuitas = ws.addRow(['', 'Total Ekuitas', null]);
  selRp(totalEkuitas, 3, n.totalEkuitas);
  styleHeader(totalEkuitas);

  const totalPasiva = ws.addRow(['', 'TOTAL PASIVA', null]);
  selRp(totalPasiva, 3, n.totalPasiva);
  styleHeader(totalPasiva);

  const status = ws.addRow(['STATUS', statusText, null]);
  selRp(status, 3, n.selisih);
  styleHeader(status);

  ws.getColumn(1).width = 12;
  ws.getColumn(2).width = 48;
  ws.getColumn(3).width = 20;
  return wb;
}

/** Arus Kas → workbook: ringkasan kelompok + tabel mutasi kas + total. */
export async function arusKasToWorkbook(
  ak: ArusKasHasil,
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Arus Kas');
  const barisKopXlsx = tulisKopXlsx(
    ws,
    'ARUS KAS',
    kopPeriodeEfektif(ak.mulai, ak.sampai, ak.rows),
    8,
    kop,
  );
  ws.views = [{ state: 'frozen', ySplit: barisKopXlsx + 4 }];

  const ringkasan = ws.addRow(['RINGKASAN KELOMPOK', 'Masuk', 'Keluar', 'Neto', '', '', '', '']);
  styleHeader(ringkasan);
  const kelompok: { label: string; nilai: ArusKasHasil['operasi'] }[] = [
    { label: 'Operasi', nilai: ak.operasi },
    { label: 'Investasi', nilai: ak.investasi },
    { label: 'Pendanaan', nilai: ak.pendanaan },
    { label: 'Transfer', nilai: ak.transfer },
  ];
  for (const k of kelompok) {
    const row = ws.addRow([k.label, null, null, null, '', '', '', '']);
    selRp(row, 2, k.nilai.masuk);
    selRp(row, 3, k.nilai.keluar);
    selRp(row, 4, k.nilai.neto);
  }
  const saldoAwal = ws.addRow(['Saldo awal', null, null, null, '', '', '', '']);
  selRp(saldoAwal, 2, 0);
  selRp(saldoAwal, 3, 0);
  selRp(saldoAwal, 4, ak.saldoAwal);
  const totalMasuk = ws.addRow(['Total masuk', null, null, null, '', '', '', '']);
  selRp(totalMasuk, 2, ak.totalMasuk);
  selRp(totalMasuk, 3, 0);
  selRp(totalMasuk, 4, ak.totalMasuk);
  const totalKeluar = ws.addRow(['Total keluar', null, null, null, '', '', '', '']);
  selRp(totalKeluar, 2, 0);
  selRp(totalKeluar, 3, ak.totalKeluar);
  selRp(totalKeluar, 4, -ak.totalKeluar);
  const kenaikan = ws.addRow(['Kenaikan / (penurunan)', null, null, null, '', '', '', '']);
  selRp(kenaikan, 2, 0);
  selRp(kenaikan, 3, 0);
  selRp(kenaikan, 4, ak.kenaikan);
  const saldoAkhir = ws.addRow(['Saldo akhir', null, null, null, '', '', '', '']);
  selRp(saldoAkhir, 2, 0);
  selRp(saldoAkhir, 3, 0);
  selRp(saldoAkhir, 4, ak.saldoAkhir);
  styleHeader(saldoAkhir);

  ws.addRow([]);
  const header = ws.addRow([
    'Tanggal',
    'No. Bukti',
    'Keterangan',
    'Akun',
    'Masuk',
    'Keluar',
    'Lawan',
    'Kelompok',
  ]);
  styleHeader(header);
  for (const r of ak.rows) {
    const row = ws.addRow([
      formatTanggal(r.tanggal),
      r.no_bukti || '—',
      r.keterangan || '—',
      `${r.akun_kode} — ${r.akun_nama}`,
      null,
      null,
      r.lawan.length ? r.lawan.join(', ') : '—',
      LABEL_KELOMPOK_ARUS_KAS[r.kelompok],
    ]);
    selRp(row, 5, r.masuk);
    selRp(row, 6, r.keluar);
  }
  const total = ws.addRow([
    'TOTAL ARUS (tanpa transfer)',
    '',
    '',
    '',
    null,
    null,
    '',
    '',
  ]);
  selRp(total, 5, ak.totalMasuk);
  selRp(total, 6, ak.totalKeluar);
  styleHeader(total);

  ws.getColumn(1).width = 14;
  ws.getColumn(2).width = 18;
  ws.getColumn(3).width = 40;
  ws.getColumn(4).width = 38;
  ws.getColumn(5).width = 18;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 24;
  ws.getColumn(8).width = 14;
  return wb;
}

/** Panjar → workbook: daftar panjar + rincian item pertanggungjawaban. */
export async function panjarToWorkbook(
  daftar: readonly PanjarTampil[],
  coa: readonly Coa[] = [],
  kop?: KopOrganisasi,
): Promise<ExcelJS.Workbook> {
  const { wb, ws } = baseWorkbook('Panjar');
  const barisKopXlsx = tulisKopXlsx(
    ws,
    'PANJAR (UANG MUKA)',
    kopPeriodeEfektif(undefined, undefined, daftar),
    9,
    kop,
  );
  ws.views = [{ state: 'frozen', ySplit: barisKopXlsx + 1 }];

  const header = ws.addRow([
    'Tanggal',
    'Penerima',
    'Sumber',
    'Jumlah',
    'Status',
    'Realisasi',
    'Sisa',
    'Kurang',
    'Keterangan',
  ]);
  styleHeader(header);

  let totalJumlah = 0;
  let totalRealisasi = 0;
  let totalSisa = 0;
  let totalKurang = 0;
  for (const p of daftar) {
    const realisasi =
      p.total_realisasi ?? (p.items ?? []).reduce((s, it) => s + it.nominal, 0);
    const sisa = p.sisa ?? Math.max(0, p.jumlah - realisasi);
    const kurang = p.kurang ?? Math.max(0, realisasi - p.jumlah);
    const row = ws.addRow([
      formatTanggal(p.tanggal),
      p.penerima,
      namaPanjar(coa, p.akun_kas_sumber),
      null,
      p.status === 'OPEN' ? 'Belum' : 'Sudah',
      null,
      null,
      null,
      p.status === 'CLOSED' ? `Ditutup ${p.tanggal_close ? formatTanggal(p.tanggal_close) : ''}`.trim() : 'Masih terbuka',
    ]);
    selRp(row, 4, p.jumlah);
    selRp(row, 6, realisasi);
    selRp(row, 7, sisa);
    selRp(row, 8, kurang);
    totalJumlah += p.jumlah;
    totalRealisasi += realisasi;
    totalSisa += sisa;
    totalKurang += kurang;
  }
  const total = ws.addRow(['TOTAL', '', '', null, '', null, null, null, '']);
  selRp(total, 4, totalJumlah);
  selRp(total, 6, totalRealisasi);
  selRp(total, 7, totalSisa);
  selRp(total, 8, totalKurang);
  styleHeader(total);

  ws.addRow([]);
  const judulRincian = ws.addRow([
    'RINCIAN PERTANGGUNGJAWABAN',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ]);
  styleHeader(judulRincian);
  const headerRincian = ws.addRow([
    'Panjar',
    'Jenis Belanja',
    'Nominal',
    'Jurnal',
    '',
    '',
    '',
    '',
    '',
  ]);
  styleHeader(headerRincian);

  for (const p of daftar) {
    const items = p.items ?? [];
    if (items.length === 0) {
      const row = ws.addRow([
        `${formatTanggal(p.tanggal)} — ${p.penerima}`,
        'Belum ada rincian pertanggungjawaban',
        null,
        '',
        '',
        '',
        '',
        '',
        '',
      ]);
      selRp(row, 3, 0);
      continue;
    }
    let subtotal = 0;
    for (const it of items) {
      const row = ws.addRow([
        `${formatTanggal(p.tanggal)} — ${p.penerima}`,
        namaPanjar(coa, it.kategori_baga),
        null,
        it.jurnal_id || '—',
        '',
        '',
        '',
        '',
        '',
      ]);
      selRp(row, 3, it.nominal);
      subtotal += it.nominal;
    }
    const sub = ws.addRow(['', `Subtotal ${p.penerima}`, null, '', '', '', '', '', '']);
    selRp(sub, 3, subtotal);
    styleHeader(sub);
  }

  ws.getColumn(1).width = 16;
  ws.getColumn(2).width = 34;
  ws.getColumn(3).width = 38;
  ws.getColumn(4).width = 18;
  ws.getColumn(5).width = 12;
  ws.getColumn(6).width = 18;
  ws.getColumn(7).width = 18;
  ws.getColumn(8).width = 18;
  ws.getColumn(9).width = 28;
  return wb;
}

// ---- Print / PDF (renderer: window.print; Electron: printToPDF via main) ----

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Kop organisasi HTML — rata tengah, dipakai di ATAS setiap body laporan
 * (print popup, Simpan PDF, dan pratinjau). Judul + sub-periode opsional.
 * `kop` opsional (P1-13); default tetap KOP_ORG_NAMA. */
export function kopHtml(
  judul: string,
  subjudul?: string,
  kop?: KopOrganisasi,
): string {
  const [nama, ...tambahan] = barisKop(kop);
  return `<div style="text-align:center;margin-bottom:12px;line-height:1.5">`
    + `<div style="font-weight:bold;font-size:14pt">${esc(nama!)}</div>`
    + tambahan
      .map((t) => `<div style="font-size:9pt">${esc(t)}</div>`)
      .join('')
    + `<div style="font-weight:bold;font-size:12pt">${esc(judul)}</div>`
    + (subjudul ? `<div style="font-size:10pt">${esc(subjudul)}</div>` : '')
    + `</div>`;
}

export function pembantuToHtml(p: PembantuHasil, kop?: KopOrganisasi): string {
  const saldoAwal = p.saldoAwal !== undefined
    ? `<tr><td colspan="2"><b>Saldo awal</b></td><td style="text-align:right">${formatRp(0)}</td><td style="text-align:right">${formatRp(0)}</td><td style="text-align:right">${formatRp(p.saldoAwal)}</td></tr>`
    : '';
  let saldo = p.saldoAwal ?? 0;
  const rows = p.rows
    .map((t) => {
      saldo += t.masuk - t.keluar;
      return `<tr><td>${formatTanggal(t.tanggal)}</td><td>${esc(t.keterangan)}</td><td style="text-align:right">${formatRp(t.masuk)}</td><td style="text-align:right">${formatRp(t.keluar)}</td><td style="text-align:right">${formatRp(saldo)}</td></tr>`;
    })
    .join('');
  return `${kopHtml(`BUKU PEMBANTU — ${p.kode} ${p.nama}`, kopPeriodeEfektif(p.mulai, p.sampai, p.rows), kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>Keterangan</th><th>Masuk</th><th>Keluar</th><th>Saldo</th></tr></thead>
<tbody>${saldoAwal}${rows}</tbody>
<tfoot><tr><th colspan="2">TOTAL</th><th style="text-align:right">${formatRp(p.totalMasuk)}</th><th style="text-align:right">${formatRp(p.totalKeluar)}</th><th></th></tr>
<tr><th colspan="4">SALDO AKHIR</th><th style="text-align:right">${formatRp(p.saldo)}</th></tr></tfoot></table>`;
}

export function realisasiToHtml(
  r: RealisasiHasil,
  rows?: { tanggal: string }[],
  kop?: KopOrganisasi,
): string {
  const li = (kode: string, nama: string, n: number): string =>
    `<tr><td>${kode}</td><td>${esc(nama)}</td><td style="text-align:right">${formatRp(n)}</td></tr>`;
  return `${kopHtml('REALISASI ANGGARAN', kopPeriodeEfektif(r.mulai, r.sampai, rows), kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th></tr></thead><tbody>
<tr><th colspan="3">PENDAPATAN</th></tr>${r.pendapatan.map((b) => li(b.kode, b.nama, b.nominal)).join('')}
<tr><th colspan="2">Total Pendapatan</th><th style="text-align:right">${formatRp(r.totalPendapatan)}</th></tr>
<tr><th colspan="3">BEBAN</th></tr>${r.beban.map((b) => li(b.kode, b.nama, b.nominal)).join('')}
<tr><th colspan="2">Total Beban</th><th style="text-align:right">${formatRp(r.totalBeban)}</th></tr>
<tr><th colspan="2">NET (Pendapatan - Beban)</th><th style="text-align:right">${formatRp(r.net)}</th></tr>
</tbody></table>`;
}

export function surplusToHtml(
  s: SurplusHasil,
  rows?: { tanggal: string }[],
  kop?: KopOrganisasi,
): string {
  const li = (kode: string, nama: string, n: number, p: number): string =>
    `<tr><td>${kode}</td><td>${esc(nama)}</td><td style="text-align:right">${formatRp(n)}</td><td style="text-align:right">${formatPersen(p)}</td></tr>`;
  return `${kopHtml('SURPLUS / (DEFISIT)', kopPeriodeEfektif(s.mulai, s.sampai, rows), kop)}
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
  kop?: KopOrganisasi,
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
  return `${kopHtml(opts.judul ?? 'BUKU BESAR', kopPeriodeEfektif(opts.mulai, opts.sampai, rows), kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>Keterangan</th><th>Kode</th><th>Masuk</th><th>Keluar</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><th colspan="3">TOTAL</th><th style="text-align:right">${formatRp(tm)}</th><th style="text-align:right">${formatRp(tk)}</th></tr></tfoot></table>`;
}

/** Jurnal Umum satu bukti → HTML print (kop, tanggal, no. bukti, debit/kredit). */
export function jurnalToHtml(
  jurnal: {
    id?: string;
    tanggal: string;
    no_bukti?: string;
    keterangan: string;
    baris: ReadonlyArray<{
      akun_kode: string;
      debit: number;
      kredit: number;
      keterangan?: string | null;
    }>;
  },
  coa: ReadonlyArray<{ kode: string; nama: string }> = [],
  kop?: KopOrganisasi,
): string {
  const namaAkun = (kode: string): string => {
    const a = coa.find((x) => x.kode === kode);
    return a ? `${a.kode} — ${a.nama}` : kode;
  };
  const rows = jurnal.baris
    .map(
      (b) =>
        `<tr><td>${esc(namaAkun(b.akun_kode))}</td><td>${esc(b.keterangan ?? '')}</td>` +
        `<td style="text-align:right">${b.debit ? formatRp(b.debit) : ''}</td>` +
        `<td style="text-align:right">${b.kredit ? formatRp(b.kredit) : ''}</td></tr>`,
    )
    .join('');
  const totalDebit = jurnal.baris.reduce((s, b) => s + b.debit, 0);
  const totalKredit = jurnal.baris.reduce((s, b) => s + b.kredit, 0);
  const noBukti = String(jurnal.no_bukti ?? '').trim() || '—';
  return `${kopHtml(
    'JURNAL UMUM',
    `Tanggal ${formatTanggal(jurnal.tanggal)} · No. Bukti ${noBukti}`,
    kop,
  )}
<p><b>Keterangan:</b> ${esc(jurnal.keterangan)}</p>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Akun</th><th>Keterangan Baris</th><th>Debit</th><th>Kredit</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th colspan="2">TOTAL</th><th style="text-align:right">${formatRp(totalDebit)}</th><th style="text-align:right">${formatRp(totalKredit)}</th></tr></tfoot></table>`;
}

/** Daftar jurnal (satu atau banyak) → HTML print/PDF.
 * Satu tabel per jurnal + subtotal, ditutup total keseluruhan. */
export function jurnalDaftarToHtml(
  daftar: readonly JurnalTampil[],
  coa: readonly Coa[] = [],
  opts: { mulai?: string; sampai?: string } = {},
  kop?: KopOrganisasi,
): string {
  const bagian = daftar
    .map((j) => {
      const noBukti = j.no_bukti?.trim() || j.id || 'tanpa nomor';
      const rows = j.baris
        .map(
          (b) =>
            `<tr><td>${esc(namaAkunCoa(coa, b.akun_kode))}</td>` +
            `<td>${esc(b.keterangan?.trim() || j.keterangan)}</td>` +
            `<td style="text-align:right">${formatRp(b.debit)}</td>` +
            `<td style="text-align:right">${formatRp(b.kredit)}</td></tr>`,
        )
        .join('');
      const subDebit = j.baris.reduce((s, b) => s + b.debit, 0);
      const subKredit = j.baris.reduce((s, b) => s + b.kredit, 0);
      return `<div style="margin-bottom:14px">
<h3 style="margin:0 0 2px">${formatTanggal(j.tanggal)} · ${esc(noBukti)}</h3>
<p style="margin:0 0 5px"><b>${esc(j.keterangan)}</b> · ${esc(labelJenis(j.jenis))} · ${esc(statusKoreksi(j))}</p>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Akun</th><th>Keterangan</th><th>Debit</th><th>Kredit</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th colspan="2">Subtotal ${esc(noBukti)}</th><th style="text-align:right">${formatRp(subDebit)}</th><th style="text-align:right">${formatRp(subKredit)}</th></tr></tfoot>
</table></div>`;
    })
    .join('');
  const grandDebit = daftar.reduce(
    (s, j) => s + j.baris.reduce((x, b) => x + b.debit, 0),
    0,
  );
  const grandKredit = daftar.reduce(
    (s, j) => s + j.baris.reduce((x, b) => x + b.kredit, 0),
    0,
  );
  return `${kopHtml('JURNAL UMUM', kopPeriodeEfektif(opts.mulai, opts.sampai, daftar), kop)}
${daftar.length === 0 ? '<p>Belum ada jurnal pada periode ini.</p>' : bagian}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th colspan="2">TOTAL KESELURUHAN</th><th>Debit</th><th>Kredit</th></tr></thead>
<tbody><tr><th colspan="2">TOTAL KESELURUHAN</th><th style="text-align:right">${formatRp(grandDebit)}</th><th style="text-align:right">${formatRp(grandKredit)}</th></tr></tbody>
</table>`;
}

/** Buku Besar → HTML print/PDF (saldo awal, mutasi, saldo berjalan, total). */
export function bukuBesarToHtml(bb: BukuBesarHasil, kop?: KopOrganisasi): string {
  const rows = bb.rows
    .map(
      (r) =>
        `<tr><td>${formatTanggal(r.tanggal)}</td><td>${esc(r.no_bukti || '—')}</td>` +
        `<td>${esc(r.keterangan || '—')}</td>` +
        `<td style="text-align:right">${formatRp(r.debit)}</td>` +
        `<td style="text-align:right">${formatRp(r.kredit)}</td>` +
        `<td style="text-align:right">${formatRp(r.saldo)}</td>` +
        `<td>${labelSisi(r.posisi)}</td></tr>`,
    )
    .join('');
  return `${kopHtml(
    `BUKU BESAR — ${bb.kode} ${bb.nama}`,
    kopPeriodeEfektif(bb.mulai, bb.sampai, bb.rows),
    kop,
  )}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th><th>Debit</th><th>Kredit</th><th>Saldo</th><th>Sisi</th></tr></thead>
<tbody>
<tr><td colspan="2"><b>Saldo awal</b></td><td>${bb.mulai ? `sebelum ${formatTanggal(bb.mulai)}` : 'tanpa batas awal'}</td><td style="text-align:right">${formatRp(0)}</td><td style="text-align:right">${formatRp(0)}</td><td style="text-align:right">${formatRp(bb.saldoAwal)}</td><td>${labelSisi(sisiDariSaldo(bb.saldoAwal, bb.posisi_normal))}</td></tr>
${rows}
</tbody>
<tfoot>
<tr><th colspan="3">TOTAL MUTASI</th><th style="text-align:right">${formatRp(bb.totalDebit)}</th><th style="text-align:right">${formatRp(bb.totalKredit)}</th><th style="text-align:right">${formatRp(bb.saldoAkhir)}</th><th>${labelSisi(sisiDariSaldo(bb.saldoAkhir, bb.posisi_normal))}</th></tr>
<tr><th colspan="5">SALDO AKHIR</th><th style="text-align:right">${formatRp(bb.saldoAkhir)}</th><th>${labelSisi(sisiDariSaldo(bb.saldoAkhir, bb.posisi_normal))}</th></tr>
</tfoot></table>`;
}

/** Neraca Saldo → HTML print/PDF + status seimbang/selisih. */
export function neracaSaldoToHtml(
  ns: NeracaSaldoModeHasil,
  kop?: KopOrganisasi,
): string {
  const rows = ns.rows
    .map((r) => {
      const sintetis = 'sintetis' in r && r.sintetis;
      return (
        `<tr${sintetis ? ' style="font-style:italic"' : ''}><td>${esc(r.kode)}</td><td>${esc(r.nama)}</td><td>${LABEL_TIPE_COA[r.tipe]}</td>` +
        `<td style="text-align:right">${formatRp(r.debit)}</td>` +
        `<td style="text-align:right">${formatRp(r.kredit)}</td>` +
        `<td style="text-align:right">${formatRp(r.saldo)}</td></tr>`
      );
    })
    .join('');
  return `${kopHtml('NERACA SALDO', kopPeriodeNeracaSaldo(ns), kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Nama Akun</th><th>Tipe</th><th>Debit</th><th>Kredit</th><th>Saldo</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot>
<tr><th colspan="3">TOTAL</th><th style="text-align:right">${formatRp(ns.totalDebit)}</th><th style="text-align:right">${formatRp(ns.totalKredit)}</th><th style="text-align:right">${formatRp(0)}</th></tr>
<tr><th colspan="3">STATUS</th><th colspan="2">${ns.seimbang ? 'Seimbang' : 'Selisih'}</th><th style="text-align:right">${formatRp(ns.selisih)}</th></tr>
</tfoot></table>`;
}

/** Laba Rugi → HTML print/PDF (pendapatan, beban, total, laba/defisit, %). */
export function labaRugiToHtml(lr: LabaRugiHasil, kop?: KopOrganisasi): string {
  const baris = (
    kode: string,
    nama: string,
    nominal: number,
    persen: number,
  ): string =>
    `<tr><td>${esc(kode)}</td><td>${esc(nama)}</td>` +
    `<td style="text-align:right">${formatRp(nominal)}</td>` +
    `<td style="text-align:right">${formatPersen(persen * 100)}</td></tr>`;
  const pendapatan = lr.pendapatan.filter((b) => b.nominal !== 0);
  const beban = lr.beban.filter((b) => b.nominal !== 0);
  return `${kopHtml('LABA RUGI', kopPeriodeEfektif(lr.mulai, lr.sampai), kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th><th>%</th></tr></thead>
<tbody>
<tr><th colspan="4" style="text-align:left">PENDAPATAN</th></tr>
${pendapatan
  .map((b) => baris(b.kode, b.nama, b.nominal, fraksi(b.nominal, lr.totalPendapatan)))
  .join('')}
<tr><th colspan="2" style="text-align:right">Total Pendapatan</th><th style="text-align:right">${formatRp(lr.totalPendapatan)}</th><th style="text-align:right">${formatPersen(lr.totalPendapatan === 0 ? 0 : 100)}</th></tr>
<tr><th colspan="4" style="text-align:left">BEBAN</th></tr>
${beban
  .map((b) => baris(b.kode, b.nama, b.nominal, fraksi(b.nominal, lr.totalPendapatan)))
  .join('')}
<tr><th colspan="2" style="text-align:right">Total Beban</th><th style="text-align:right">${formatRp(lr.totalBeban)}</th><th style="text-align:right">${formatPersen(fraksi(lr.totalBeban, lr.totalPendapatan) * 100)}</th></tr>
<tr><th colspan="2" style="text-align:right">LABA / (DEFISIT)</th><th style="text-align:right">${formatRp(lr.laba)}</th><th style="text-align:right">${formatPersen(fraksi(lr.laba, lr.totalPendapatan) * 100)}</th></tr>
</tbody></table>`;
}

/** Neraca (hasil core/reports) → HTML print/PDF. */
export function neracaHasilToHtml(n: NeracaHasil, kop?: KopOrganisasi): string {
  const statusText = n.balance ? 'SEIMBANG' : 'SELISIH';
  const barisAkun = (a: { kode: string; nama: string; saldo: number }): string =>
    `<tr><td>${esc(a.kode)}</td><td>${esc(a.nama)}</td><td style="text-align:right">${formatRp(a.saldo)}</td></tr>`;
  const aset = n.aset.filter((a) => a.saldo !== 0);
  const kewajiban = n.kewajiban.filter((a) => a.saldo !== 0);
  const ekuitas = n.ekuitas.filter((a) => a.saldo !== 0);
  return `${kopHtml('NERACA', `${kopPeriodeCutoff(n.cutoff)} — ${statusText}`, kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th></tr></thead>
<tbody>
<tr><th colspan="3" style="text-align:left">ASET</th></tr>
${aset.map(barisAkun).join('')}
<tr><th colspan="2" style="text-align:right">Total Aset</th><th style="text-align:right">${formatRp(n.totalAset)}</th></tr>
<tr><th colspan="3" style="text-align:left">KEWAJIBAN</th></tr>
${kewajiban.map(barisAkun).join('')}
<tr><th colspan="2" style="text-align:right">Total Kewajiban</th><th style="text-align:right">${formatRp(n.totalKewajiban)}</th></tr>
<tr><th colspan="3" style="text-align:left">EKUITAS</th></tr>
${ekuitas.map(barisAkun).join('')}
<tr><td>—</td><td>Laba ditahan (tahun sudah tutup)</td><td style="text-align:right">${formatRp(n.labaDitahan)}</td></tr>
<tr><td>—</td><td>Laba tahun lampau belum ditutup</td><td style="text-align:right">${formatRp(n.labaBelumDitutup)}</td></tr>
<tr><td>—</td><td>Laba berjalan (1 Januari s/d cut-off)</td><td style="text-align:right">${formatRp(n.labaBerjalan)}</td></tr>
<tr><th colspan="2" style="text-align:right">Total Ekuitas</th><th style="text-align:right">${formatRp(n.totalEkuitas)}</th></tr>
<tr><th colspan="2" style="text-align:right">TOTAL PASIVA</th><th style="text-align:right">${formatRp(n.totalPasiva)}</th></tr>
<tr><th colspan="2">STATUS</th><th style="text-align:right">${statusText} · ${formatRp(n.selisih)}</th></tr>
</tbody></table>`;
}

/** Arus Kas → HTML print/PDF: ringkasan kelompok + tabel mutasi + total. */
export function arusKasToHtml(ak: ArusKasHasil, kop?: KopOrganisasi): string {
  const ringkasan = [
    ['Operasi', ak.operasi],
    ['Investasi', ak.investasi],
    ['Pendanaan', ak.pendanaan],
    ['Transfer', ak.transfer],
  ] as const;
  const rows = ak.rows
    .map(
      (r) =>
        `<tr><td>${formatTanggal(r.tanggal)}</td><td>${esc(r.no_bukti || '—')}</td>` +
        `<td>${esc(r.keterangan || '—')}</td>` +
        `<td>${esc(`${r.akun_kode} — ${r.akun_nama}`)}</td>` +
        `<td style="text-align:right">${formatRp(r.masuk)}</td>` +
        `<td style="text-align:right">${formatRp(r.keluar)}</td>` +
        `<td>${esc(r.lawan.length ? r.lawan.join(', ') : '—')}</td>` +
        `<td>${LABEL_KELOMPOK_ARUS_KAS[r.kelompok]}</td></tr>`,
    )
    .join('');
  return `${kopHtml('ARUS KAS', kopPeriodeEfektif(ak.mulai, ak.sampai, ak.rows), kop)}
<h3>Ringkasan Kelompok</h3>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kelompok</th><th>Masuk</th><th>Keluar</th><th>Neto</th></tr></thead>
<tbody>
${ringkasan
  .map(
    ([label, k]) =>
      `<tr><td>${label}</td><td style="text-align:right">${formatRp(k.masuk)}</td><td style="text-align:right">${formatRp(k.keluar)}</td><td style="text-align:right">${formatRp(k.neto)}</td></tr>`,
  )
  .join('')}
<tr><th>Saldo awal</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(ak.saldoAwal)}</th></tr>
<tr><th>Total masuk</th><th style="text-align:right">${formatRp(ak.totalMasuk)}</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(ak.totalMasuk)}</th></tr>
<tr><th>Total keluar</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(ak.totalKeluar)}</th><th style="text-align:right">${formatRp(-ak.totalKeluar)}</th></tr>
<tr><th>Kenaikan / (penurunan)</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(ak.kenaikan)}</th></tr>
<tr><th>Saldo akhir</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(0)}</th><th style="text-align:right">${formatRp(ak.saldoAkhir)}</th></tr>
</tbody></table>
<h3>Mutasi Kas</h3>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>No. Bukti</th><th>Keterangan</th><th>Akun</th><th>Masuk</th><th>Keluar</th><th>Lawan</th><th>Kelompok</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th colspan="4">TOTAL ARUS (tanpa transfer)</th><th style="text-align:right">${formatRp(ak.totalMasuk)}</th><th style="text-align:right">${formatRp(ak.totalKeluar)}</th><th colspan="2"></th></tr></tfoot>
</table>`;
}

/** Panjar → HTML print/PDF: daftar panjar + rincian item pertanggungjawaban. */
export function panjarToHtml(
  daftar: readonly PanjarTampil[],
  coa: readonly Coa[] = [],
  kop?: KopOrganisasi,
): string {
  const rows = daftar
    .map((p) => {
      const realisasi =
        p.total_realisasi ?? (p.items ?? []).reduce((s, it) => s + it.nominal, 0);
      const sisa = p.sisa ?? Math.max(0, p.jumlah - realisasi);
      const kurang = p.kurang ?? Math.max(0, realisasi - p.jumlah);
      return `<tr><td>${formatTanggal(p.tanggal)}</td><td>${esc(p.penerima)}</td><td>${esc(namaPanjar(coa, p.akun_kas_sumber))}</td><td style="text-align:right">${formatRp(p.jumlah)}</td><td>${p.status === 'OPEN' ? 'Belum' : 'Sudah'}</td><td style="text-align:right">${formatRp(realisasi)}</td><td style="text-align:right">${formatRp(sisa)}</td><td style="text-align:right">${formatRp(kurang)}</td></tr>`;
    })
    .join('');
  const totalJumlah = daftar.reduce((s, p) => s + p.jumlah, 0);
  const totalRealisasi = daftar.reduce(
    (s, p) => s + (p.total_realisasi ?? (p.items ?? []).reduce((x, it) => x + it.nominal, 0)),
    0,
  );
  const rincian = daftar
    .map((p) => {
      const items = p.items ?? [];
      const body = items.length
        ? items
            .map(
              (it) =>
                `<tr><td>${esc(namaPanjar(coa, it.kategori_baga))}</td><td style="text-align:right">${formatRp(it.nominal)}</td><td>${esc(it.jurnal_id || '—')}</td></tr>`,
            )
            .join('')
        : `<tr><td colspan="3">Belum ada rincian pertanggungjawaban.</td></tr>`;
      const subtotal = items.reduce((s, it) => s + it.nominal, 0);
      return `<h3 style="margin:12px 0 4px">${formatTanggal(p.tanggal)} — ${esc(p.penerima)}</h3>
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Jenis Belanja</th><th>Nominal</th><th>Jurnal</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><th>Subtotal</th><th style="text-align:right">${formatRp(subtotal)}</th><th></th></tr></tfoot>
</table>`;
    })
    .join('');
  return `${kopHtml('PANJAR (UANG MUKA)', kopPeriodeEfektif(undefined, undefined, daftar), kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Tanggal</th><th>Penerima</th><th>Sumber</th><th>Jumlah</th><th>Status</th><th>Realisasi</th><th>Sisa</th><th>Kurang</th></tr></thead>
<tbody>${rows}</tbody>
<tfoot><tr><th colspan="3">TOTAL</th><th style="text-align:right">${formatRp(totalJumlah)}</th><th></th><th style="text-align:right">${formatRp(totalRealisasi)}</th><th></th><th></th></tr></tfoot>
</table>
<h2 style="margin:16px 0 4px">RINCIAN PERTANGGUNGJAWABAN</h2>
${rincian || '<p>Belum ada panjar.</p>'}`;
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
export function asetToHtml(rows: Aset[], kop?: KopOrganisasi): string {
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
  return `${kopHtml('DAFTAR INVENTARIS ASET', `${rows.length} aset tercatat (non-keuangan, tidak masuk Neraca)`, kop)}
<table border="1" cellpadding="6" cellspacing="0" width="100%">
<thead><tr><th>Kode</th><th>Nama</th><th>Jenis</th><th>Luas (m²)</th><th>Lokasi</th><th>Status/Kondisi</th><th>Nilai</th></tr></thead>
<tbody>${body}</tbody>
<tfoot><tr><th colspan="6">Total yang sudah dinilai (${rows.filter((a) => a.nilai_sen !== null).length} aset)</th><th style="text-align:right">${formatRp(dinilai)}</th></tr></tfoot></table>`;
}

/** Neraca → HTML tabel bersih untuk print (Aktiva + Pasiva). */
export function neracaToHtml(n: Neraca, kop?: KopOrganisasi): string {
  const kasRows = Object.entries(n.aktivaRinci.kas)
    .map(([k, v]) => `<tr><td>Kas ${esc(k)}</td><td style="text-align:right">${formatRp(v)}</td></tr>`)
    .join('');
  const status = n.balance ? 'BALANCE' : `SELISIH ${formatRp(n.selisih)}`;
  return `${kopHtml('NERACA', `PER ${formatTanggal(n.cutoff)} — ${status}`, kop)}
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
