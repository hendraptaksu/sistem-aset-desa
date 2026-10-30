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

/** DB-13: CSV baseline 48 + 5 akun baru = 53 baris; COA = 53 + 2 ekstensi = 55. */
const CSV_BASELINE_JUMLAH = 48;
const CSV_JUMLAH = 53;
const COA_JUMLAH = 55;

/** Lima akun baru, dalam urutan baris CSV 49–53 (urutan persetujuan client). */
const AKUN_DB13_CSV = [
  { kode: '5060', nama: 'PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL)' },
  { kode: '5061', nama: 'PENGELUARAN ARTOS (UPACARA)' },
  { kode: '5062', nama: 'PENGELUARAN BANTEN RUTIN (HARIAN)' },
  { kode: '4060', nama: 'PENDAPATAN WEWEDALAN (UPACARA)' },
  { kode: '4006', nama: 'PENDAPATAN PARKIR BPD (KHUSUS)' },
] as const;

/** Bentuk COA lengkap kelima akun baru, urut kode seperti array COA. */
const AKUN_DB13_COA = [
  {
    kode: '4006',
    nama: 'PENDAPATAN PARKIR BPD (KHUSUS)',
    tipe: 'PENDAPATAN',
    posisi_normal: 'KREDIT',
  },
  {
    kode: '4060',
    nama: 'PENDAPATAN WEWEDALAN (UPACARA)',
    tipe: 'PENDAPATAN',
    posisi_normal: 'KREDIT',
  },
  {
    kode: '5060',
    nama: 'PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL)',
    tipe: 'BEBAN',
    posisi_normal: 'DEBIT',
  },
  {
    kode: '5061',
    nama: 'PENGELUARAN ARTOS (UPACARA)',
    tipe: 'BEBAN',
    posisi_normal: 'DEBIT',
  },
  {
    kode: '5062',
    nama: 'PENGELUARAN BANTEN RUTIN (HARIAN)',
    tipe: 'BEBAN',
    posisi_normal: 'DEBIT',
  },
] as const;

/** Akun lama yang mirip tetap ada dan tidak diganti/dinonaktifkan oleh DB-13. */
const AKUN_LAMA_TETAP = [
  { kode: '5010', nama: 'BAGA SUAR (TELPON, LISTRIK, PDAM)' },
  { kode: '5050', nama: 'BIAYA LAIN-LAIN' },
  { kode: '5004', nama: 'BAGA UPAKARA' },
  { kode: '4008', nama: 'PENDAPATAN PUNIA' },
  { kode: '4041', nama: 'PENDAPATAN SESARI' },
  { kode: '4005', nama: 'PENDAPATAN PARKIR' },
] as const;

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
    expect(csv).toHaveLength(CSV_JUMLAH);
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
    // Baseline xlsx harus sama dengan 48 baris pertama CSV; lima akun DB-13
    // ditambahkan di belakang CSV sehingga arsip lama tetap utuh.
    expect(csv.slice(0, CSV_BASELINE_JUMLAH)).toHaveLength(XLSX_BASELINE_JUMLAH);
    expect(xlsx).toEqual(csv.slice(0, XLSX_BASELINE_JUMLAH));

    // Baseline subset: setiap akun arsip wajib ada identik di COA.
    for (const { kode, nama } of xlsx) {
      expect(akun(kode), `akun arsip ${kode} hilang dari COA`).toMatchObject({ kode, nama });
    }
  });

  it('menambahkan lima akun DB-13 di baris CSV 49–53 tanpa mengganti akun lama', () => {
    const csv = bacaCsv();
    expect(csv.slice(CSV_BASELINE_JUMLAH)).toEqual([...AKUN_DB13_CSV]);

    // Bentuk COA: tipe + posisi normal benar, dan nama pembeda persis.
    for (const diharapkan of AKUN_DB13_COA) {
      expect(akun(diharapkan.kode), `akun DB-13 ${diharapkan.kode} hilang`).toEqual(diharapkan);
    }

    // Posisi COA mengikuti urutan kode di dalam kelompoknya.
    const kodeCoa = COA.map((c) => c.kode);
    expect(kodeCoa.indexOf('4006')).toBe(kodeCoa.indexOf('4005') + 1);
    expect(kodeCoa.indexOf('4060')).toBe(kodeCoa.indexOf('4050') + 1);
    expect(kodeCoa.indexOf('5060')).toBe(kodeCoa.indexOf('5050') + 1);
    expect(kodeCoa.indexOf('5061')).toBe(kodeCoa.indexOf('5060') + 1);
    expect(kodeCoa.indexOf('5062')).toBe(kodeCoa.indexOf('5061') + 1);

    // Akun lama yang mirip tidak di-rename, tidak dihapus, dan tetap bisa diposting.
    for (const lama of AKUN_LAMA_TETAP) {
      expect(akun(lama.kode)).toMatchObject({ kode: lama.kode, nama: lama.nama });
      expect(akunBolehDiposting(lama.kode), `${lama.kode} tidak boleh dinonaktifkan`).toBe(true);
    }

    // Nama baru harus berbeda tegas dari semua nama lama.
    const namaLama = new Set(AKUN_LAMA_TETAP.map((a) => a.nama.toUpperCase()));
    for (const baru of AKUN_DB13_CSV) {
      expect(namaLama.has(baru.nama.toUpperCase())).toBe(false);
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
    expect(diharapkan.size).toBe(CSV_JUMLAH + ekstensi.length);
    expect(diharapkan.size).toBe(COA_JUMLAH);
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
      '53',
      '55',
      '1040',
      '2060',
      '5060',
      '5061',
      '5062',
      '4060',
      '4006',
      'tambahan',
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

  it('lima akun DB-13 muncul di listAkun setelah seed DB, akun lama tetap aktif', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-coa-db13-'));
    try {
      const db = openDb(join(dir, 'pura.db'));
      try {
        const rows = listAkun(db);
        expect(rows).toHaveLength(COA_JUMLAH);
        expect(listAkun(db, { aktif: true })).toHaveLength(COA_JUMLAH);

        for (const diharapkan of AKUN_DB13_COA) {
          expect(getAkun(db, diharapkan.kode)).toEqual({ ...diharapkan, aktif: true });
        }

        // listAkun mengurutkan kode; posisi akun baru mengikuti kode di COA.
        const posisi = (kode: string): number => rows.findIndex((r) => r.kode === kode);
        expect(posisi('4006')).toBe(posisi('4005') + 1);
        expect(posisi('4060')).toBe(posisi('4050') + 1);
        expect(posisi('5060')).toBe(posisi('5050') + 1);
        expect(posisi('5061')).toBe(posisi('5060') + 1);
        expect(posisi('5062')).toBe(posisi('5061') + 1);

        for (const lama of AKUN_LAMA_TETAP) {
          expect(getAkun(db, lama.kode), `${lama.kode} harus tetap ada`).toMatchObject({
            kode: lama.kode,
            nama: lama.nama,
            aktif: true,
          });
        }
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
