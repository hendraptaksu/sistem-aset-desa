// P0-1: COA ber-tipe + akun 1040 Uang Panjar.
// Sumber kode/nama: KODE AKUN.csv (dibaca langsung agar tidak ada kode yang hilang).

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  const isi = readFileSync(join(ROOT, 'KODE AKUN.csv'), 'utf8');
  return isi
    .split(/\r?\n/)
    .filter((line) => /^\d+,/.test(line))
    .map((line) => {
      const [, nama, kode] = parseCsvLine(line);
      return { kode: kode!.trim(), nama: nama!.trim() };
    });
}

describe('COA P0-1', () => {
  it('memuat semua kode & nama dari KODE AKUN.csv', () => {
    const csv = bacaCsv();
    expect(csv).toHaveLength(48);
    for (const { kode, nama } of csv) {
      expect(akun(kode), `akun ${kode} hilang`).toMatchObject({ kode, nama });
    }
    // CSV + 1040 UANG PANJAR + 2060 HUTANG USAHA (ekstensi sistem AKT-20).
    expect(COA).toHaveLength(csv.length + 2);
    expect(COA.map((c) => c.kode)).toContain(AKUN_PANJAR);
    expect(COA.map((c) => c.kode)).toContain(AKUN_HUTANG_USAHA);
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
