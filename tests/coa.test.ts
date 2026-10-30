// P0-1: COA ber-tipe + akun 1040 Uang Panjar.
// DB-13a: `KODE AKUN.csv` adalah sumber mesin tunggal; `docs/KODE AKUN.xlsx`
// adalah arsip client 48 akun. Test ini menjaga CSV, xlsx, dan COA tidak drift.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  AKUN_HUTANG,
  AKUN_HUTANG_USAHA,
  AKUN_LEGACY_TIDAK_DIPOSTING,
  AKUN_MODAL,
  AKUN_PANJAR,
  AKUN_PIUTANG,
  COA,
  KAS_KODES,
  KODE_EKSTENSI_SISTEM,
  LPD_KODES,
  PESAN_AKUN_LEGACY,
  POSISI_NORMAL,
  akun,
  akunBolehDiposting,
  isAkunKas,
  isAktiva,
  isBeban,
  isEkuitas,
  isHutang,
  isKewajiban,
  isPendapatan,
} from '../src/db/coa.js';
import { openDb } from '../src/db/database.js';
import { getAkun, listAkun } from '../src/db/repository.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSV_PATH = join(ROOT, 'KODE AKUN.csv');
const XLSX_PATH = join(ROOT, 'docs', 'KODE AKUN.xlsx');
const DOKUMEN_SUMBER_COA = join(ROOT, 'docs', 'sumber-coa.md');

/**
 * Arsip xlsx client adalah baseline 48 akun. Hash byte menjaga file biner ini
 * tidak berubah diam-diam; perubahan hanya boleh lewat persetujuan client dan
 * harus memperbarui dokumen + test ini secara sadar.
 */
const XLSX_BASELINE_JUMLAH = 48;
const XLSX_BASELINE_SHA256 =
  'c9a3f9f674f57ead20c1747bac25a16939f64acad6ea6aa6a9286fae4faae6b6';

/** Parser CSV sederhana (cukup untuk KODE AKUN.csv; mendukung tanda kutip). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function bacaCsv(): { kode: string; nama: string }[] {
  expect(existsSync(CSV_PATH), 'KODE AKUN.csv (sumber mesin COA) harus ada').toBe(true);
  const isi = readFileSync(CSV_PATH, 'utf8');
  return isi
    .split(/\r?\n/)
    .filter((line) => /^\d+,/.test(line))
    .map((line) => {
      const [, nama, kode] = parseCsvLine(line);
      return { kode: kode!.trim(), nama: nama!.trim() };
    });
}

/** Baca baris akun dari arsip xlsx client (kolom B nama, kolom C kode). */
async function bacaXlsx(): Promise<{ kode: string; nama: string }[]> {
  expect(existsSync(XLSX_PATH), 'docs/KODE AKUN.xlsx (arsip client) harus ada').toBe(true);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(XLSX_PATH);
  const ws = wb.worksheets[0];
  expect(ws, 'xlsx harus punya satu worksheet').toBeDefined();
  const rows: { kode: string; nama: string }[] = [];
  ws!.eachRow((row, nomor) => {
    if (nomor < 4) return; // 3 baris judul/header client
    const nama = row.getCell(2).value;
    const kode = row.getCell(3).value;
    if (typeof nama !== 'string' || typeof kode !== 'number') return;
    const kodeTeks = String(kode);
    if (!/^\d{4}$/.test(kodeTeks)) return;
    rows.push({ kode: kodeTeks, nama: nama.trim() });
  });
  return rows;
}

describe('COA P0-1', () => {
  it('memuat semua kode & nama dari KODE AKUN.csv secara persis', () => {
    const csv = bacaCsv();
    expect(csv).toHaveLength(48);
    for (const { kode, nama } of csv) {
      expect(kode, `kode CSV tidak 4 digit: ${kode}`).toMatch(/^\d{4}$/);
      expect(akun(kode), `akun ${kode} hilang dari COA`).toMatchObject({ kode, nama });
    }
  });

  it('docs/KODE AKUN.xlsx tetap arsip baseline 48 akun dan tidak diubah', async () => {
    expect(existsSync(XLSX_PATH), 'arsip xlsx client harus ada').toBe(true);
    const hash = createHash('sha256').update(readFileSync(XLSX_PATH)).digest('hex');
    expect(hash, 'file xlsx client berubah tanpa persetujuan').toBe(XLSX_BASELINE_SHA256);

    const xlsx = await bacaXlsx();
    expect(xlsx).toHaveLength(XLSX_BASELINE_JUMLAH);
    const csv = bacaCsv();
    // Baseline xlsx harus sama dengan 48 baris pertama CSV; akun baru selalu
    // ditambahkan di belakang CSV sehingga arsip lama tetap utuh.
    expect(xlsx).toEqual(csv.slice(0, XLSX_BASELINE_JUMLAH));

    // Baseline subset: setiap akun arsip wajib ada identik di COA.
    for (const { kode, nama } of xlsx) {
      expect(akun(kode), `akun arsip ${kode} hilang dari COA`).toMatchObject({ kode, nama });
    }
  });

  it('COA = baris CSV + tepat ekstensi sistem 1040/2060', () => {
    const csv = bacaCsv();
    expect([...KODE_EKSTENSI_SISTEM]).toEqual([AKUN_PANJAR, AKUN_HUTANG_USAHA]);
    expect([...KODE_EKSTENSI_SISTEM]).toEqual(['1040', '2060']);

    const ekstensi = [
      { kode: '1040', nama: 'UANG PANJAR (KAS DI MUKA)' },
      { kode: '2060', nama: 'HUTANG USAHA' },
    ];
    const diharapkan = new Map(
      [...csv, ...ekstensi].map(({ kode, nama }) => [kode, { kode, nama }]),
    );
    expect(diharapkan.size).toBe(csv.length + ekstensi.length);
    expect(COA).toHaveLength(diharapkan.size);

    for (const c of COA) {
      expect(diharapkan.get(c.kode), `${c.kode} bukan CSV/ekstensi terdokumentasi`).toEqual({
        kode: c.kode,
        nama: c.nama,
      });
    }
    for (const { kode } of ekstensi) {
      expect(csv.some((row) => row.kode === kode), `${kode} tidak boleh ada di CSV`).toBe(false);
    }

    // Baris CSV tidak boleh hilang hanya karena COA memakai nama lain.
    for (const { kode, nama } of csv) {
      expect(akun(kode), `akun CSV ${kode} hilang`).toMatchObject({ kode, nama });
    }
  });

  it('tidak ada kode atau nama duplikat di COA maupun CSV', () => {
    for (const [label, rows] of [
      ['COA', COA],
      ['CSV', bacaCsv()],
    ] as const) {
      const kode = rows.map((row) => row.kode);
      const nama = rows.map((row) => row.nama.trim().toUpperCase());
      expect(new Set(kode).size, `${label} punya kode duplikat`).toBe(kode.length);
      expect(new Set(nama).size, `${label} punya nama duplikat`).toBe(nama.length);
    }
  });

  it('dokumentasi sumber COA mencatat keputusan DB-13a', () => {
    expect(existsSync(DOKUMEN_SUMBER_COA), 'docs/sumber-coa.md harus ada').toBe(true);
    const dokumen = readFileSync(DOKUMEN_SUMBER_COA, 'utf8');
    for (const istilah of [
      'KODE AKUN.csv',
      'KODE AKUN.xlsx',
      'sumber mesin',
      '48',
      '1040',
      '2060',
      XLSX_BASELINE_SHA256,
    ]) {
      expect(dokumen, `docs/sumber-coa.md harus menyebut "${istilah}"`).toContain(istilah);
    }
  });

  it('memakai tipe akuntansi baku + posisi normal yang benar', () => {
    expect(POSISI_NORMAL).toEqual({
      AKTIVA: 'DEBIT',
      KEWAJIBAN: 'KREDIT',
      EKUITAS: 'KREDIT',
      PENDAPATAN: 'KREDIT',
      BEBAN: 'DEBIT',
    });
    const tipeBaku = ['AKTIVA', 'KEWAJIBAN', 'EKUITAS', 'PENDAPATAN', 'BEBAN'];
    for (const c of COA) {
      expect(tipeBaku, `tipe ${c.kode} tidak baku`).toContain(c.tipe);
      expect(c.posisi_normal, `posisi normal ${c.kode}`).toBe(POSISI_NORMAL[c.tipe]);
    }
    expect(akun('1001')).toMatchObject({ tipe: 'AKTIVA', posisi_normal: 'DEBIT' });
    expect(akun('1050')).toMatchObject({ tipe: 'AKTIVA', posisi_normal: 'DEBIT' });
    expect(akun('2050')).toMatchObject({ tipe: 'KEWAJIBAN', posisi_normal: 'KREDIT' });
    expect(akun('2060')).toMatchObject({
      kode: '2060',
      nama: 'HUTANG USAHA',
      tipe: 'KEWAJIBAN',
      posisi_normal: 'KREDIT',
    });
    expect(akun('3000')).toMatchObject({ tipe: 'EKUITAS', posisi_normal: 'KREDIT' });
    expect(akun('4005')).toMatchObject({ tipe: 'PENDAPATAN', posisi_normal: 'KREDIT' });
    expect(akun('5003')).toMatchObject({ tipe: 'BEBAN', posisi_normal: 'DEBIT' });
  });

  it('menambah 1040 UANG PANJAR (KAS DI MUKA) sebagai aktiva normal debit', () => {
    expect(AKUN_PANJAR).toBe('1040');
    expect(akun('1040')).toEqual({
      kode: '1040',
      nama: 'UANG PANJAR (KAS DI MUKA)',
      tipe: 'AKTIVA',
      posisi_normal: 'DEBIT',
    });
    expect(akun('1040')?.kode).not.toBe(AKUN_PIUTANG);
    expect(akun(AKUN_HUTANG)?.tipe).toBe('KEWAJIBAN');
    expect(akun(AKUN_MODAL)?.tipe).toBe('EKUITAS');
  });

  it('daftar akun kas tepat: 16 dompet, tanpa 1040/1050', () => {
    expect(KAS_KODES).toEqual([
      '1001',
      '1010', '1014', '1015', '1016', '1017', '1018', '1019', '1020', '1021',
      '1028', '1029', '1030', '1031', '1032', '1036',
    ]);
    for (const kode of KAS_KODES) {
      expect(akun(kode)?.tipe, `${kode} harus AKTIVA`).toBe('AKTIVA');
      expect(isAkunKas(kode), `${kode} harus kas`).toBe(true);
    }
    expect(isAkunKas('1040')).toBe(false); // uang panjar bukan dompet
    expect(isAkunKas('1050')).toBe(false); // piutang bukan dompet
    expect(isAkunKas('4005')).toBe(false);
    expect(isAkunKas('9999')).toBe(false);
    expect(LPD_KODES).toContain('1014');
    expect(LPD_KODES).not.toContain('1001');
    expect(LPD_KODES).not.toContain('1028');
    expect(LPD_KODES).not.toContain('1029');
  });

  it('helper tipe menggantikan tipe lama', () => {
    expect(isPendapatan('4005')).toBe(true);
    expect(isPendapatan('5003')).toBe(false);
    expect(isBeban('5003')).toBe(true);
    expect(isBeban('4005')).toBe(false);
    expect(isAktiva('1001')).toBe(true);
    expect(isAktiva('1040')).toBe(true);
    expect(isKewajiban('2050')).toBe(true);
    expect(isKewajiban('2060')).toBe(true);
    expect(isHutang('2050')).toBe(true);
    expect(isHutang('2060')).toBe(true);
    expect(isHutang('1050')).toBe(false);
    expect(isEkuitas('3000')).toBe(true);
    expect(isPendapatan('9999')).toBe(false);
    expect(isBeban('PANJAR')).toBe(false);
  });

  it('menolak posting ke akun legacy 3001/3002 & akun nonaktif, tetapi 3000 tetap boleh', () => {
    expect(AKUN_LEGACY_TIDAK_DIPOSTING).toEqual(new Set(['3001', '3002']));
    expect(PESAN_AKUN_LEGACY).toMatch(/3001\/3002/);
    expect(PESAN_AKUN_LEGACY).toMatch(/tidak boleh diposting/i);

    // Akun legacy tetap ada di COA untuk membaca saldo/laporan lama.
    expect(akun('3001')).toMatchObject({ kode: '3001', tipe: 'EKUITAS' });
    expect(akun('3002')).toMatchObject({ kode: '3002', tipe: 'EKUITAS' });

    expect(akunBolehDiposting('3000')).toBe(true);
    expect(akunBolehDiposting('1001')).toBe(true);
    expect(akunBolehDiposting('4005')).toBe(true);
    expect(akunBolehDiposting('3001')).toBe(false);
    expect(akunBolehDiposting('3002')).toBe(false);
    expect(akunBolehDiposting('9999')).toBe(false);
    expect(akunBolehDiposting('')).toBe(false);
    // Status aktif dari master DB diteruskan pemanggil.
    expect(akunBolehDiposting('4005', false)).toBe(false);
  });

  it('menyimpan daftar akun ke tabel akun saat openDb (upsert)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-coa-'));
    try {
      const path = join(dir, 'pura.db');
      let db = openDb(path);
      const rows = listAkun(db);
      expect(rows).toHaveLength(COA.length);
      expect(rows.every((r) => r.aktif)).toBe(true);
      expect(getAkun(db, '1040')).toMatchObject({
        kode: '1040',
        nama: 'UANG PANJAR (KAS DI MUKA)',
        tipe: 'AKTIVA',
        posisi_normal: 'DEBIT',
        aktif: true,
      });
      expect(getAkun(db, '2060')).toMatchObject({
        kode: '2060',
        nama: 'HUTANG USAHA',
        tipe: 'KEWAJIBAN',
        posisi_normal: 'KREDIT',
        aktif: true,
      });

      // Upsert memperbaiki nama yang pernah diubah manual saat DB dibuka lagi.
      db.prepare("UPDATE akun SET nama = 'NAMA LAMA' WHERE kode = '1040'").run();
      db.close();
      db = openDb(path);
      expect(getAkun(db, '1040')?.nama).toBe('UANG PANJAR (KAS DI MUKA)');
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
