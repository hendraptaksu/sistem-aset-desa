// DB-31 — modul Rekonsiliasi Bank dihapus dari menu/UI, API renderer, dan
// validator main. Shell App baru merender menu setelah status kunci tersedia
// (butuh Electron), jadi kontrak yang dijaga di sini adalah sumber daftar
// tab/menu dan lapisan API yang dipakai tab tersebut.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const APP = baca('src/renderer/App.tsx');
const API = baca('src/renderer/lib/api.ts');
const IPC = baca('src/main/ipc.ts');
const VALIDATION = baca('src/main/validation.ts');
const WORKBOOKS = baca('src/features/export/workbooks.ts');
const PRINT_ADAPTERS = baca('src/features/export/printAdapters.ts');
const AUDIT_DETAIL = baca('src/utils/auditDetail.ts');

describe('DB-31 — Rekonsiliasi Bank dihapus dari menu/UI', () => {
  it('tidak lagi punya tab, menu, render, atau komponen Rekonsiliasi Bank', () => {
    expect(APP).not.toContain('Rekonsiliasi Bank');
    expect(APP).not.toContain('RekonsiliasiBankTab');
    expect(APP).not.toContain("'rekonsiliasi'");
    for (const label of [
      'Dashboard',
      'Transaksi',
      'Buku Besar',
      'Neraca Saldo',
      'Tutup Buku',
      'Pengaturan',
    ]) {
      expect(APP, `menu "${label}" tetap ada`).toContain(label);
    }
  });

  it('tidak mengekspos tipe/API renderer atau validator rekonsiliasi bank', () => {
    expect(API).not.toContain('rekonsiliasi:');
    expect(API).not.toContain('RekonsiliasiTampil');
    expect(API).not.toContain('RekonsiliasiDetail');
    expect(API).not.toContain('StatusRekonsiliasi');
    expect(API).not.toContain('InputRekonsiliasiApi');
    expect(API).not.toContain('FilterRekonsiliasiApi');
    expect(VALIDATION).not.toContain('Rekonsiliasi');
  });

  it('file modul dan test rekonsiliasi bank sudah dihapus', () => {
    for (const path of [
      'src/renderer/components/RekonsiliasiBankTab.tsx',
      'src/core/rekonsiliasi.ts',
      'src/db/rekonsiliasi.ts',
      'tests/rekonsiliasi.test.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('label audit lama REKONSILIASI-* tetap tersedia', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('REKONSILIASI-SELESAI')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('REKONSILIASI')");
  });
});

describe('DB-32 — Inventaris Aset dihapus dari menu/UI', () => {
  it('tidak lagi punya tab, menu, render, atau komponen Inventaris Aset', () => {
    expect(APP).not.toContain('Inventaris Aset');
    expect(APP).not.toContain('AsetTab');
    expect(APP).not.toContain("'aset'");
    for (const label of [
      'Dashboard',
      'Transaksi',
      'Panjar',
      'Hutang',
      'Buku Besar',
      'Neraca Saldo',
      'Laba Rugi',
      'Neraca',
      'Arus Kas',
      'Pengaturan',
    ]) {
      expect(APP, `menu "${label}" tetap ada`).toContain(label);
    }
  });

  it('tidak mengekspos tipe/API renderer, validator, atau export aset', () => {
    expect(API).not.toContain('aset:');
    expect(API).not.toContain('asetList');
    expect(API).not.toContain('asetCreate');
    expect(API).not.toContain('asetUpdate');
    expect(API).not.toContain('asetDelete');
    expect(VALIDATION).not.toContain('AsetInput');
    expect(VALIDATION).not.toContain('validateAsetInput');
    expect(WORKBOOKS).not.toContain('asetToWorkbook');
    expect(WORKBOOKS).not.toContain('asetToHtml');
    expect(WORKBOOKS).not.toContain('DAFTAR INVENTARIS ASET');
  });

  it('file modul dan test inventaris aset sudah dihapus', () => {
    for (const path of [
      'src/renderer/components/AsetTab.tsx',
      'tests/aset.test.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('label audit lama ASET-* tetap tersedia', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('ASET-CREATE')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('ASET-UPDATE')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('ASET-DELETE')");
  });
});

describe('DB-24 — Anggaran dihapus dari menu/UI', () => {
  it('tidak lagi punya tab, menu, render, atau komponen Anggaran', () => {
    expect(APP).not.toContain('Anggaran');
    expect(APP).not.toContain('RealisasiTab');
    expect(APP).not.toContain("'realisasi'");
    for (const label of [
      'Dashboard',
      'Transaksi',
      'Buku Besar',
      'Neraca Saldo',
      'Laba Rugi',
      'Neraca',
      'Arus Kas',
      'Pengaturan',
    ]) {
      expect(APP, `menu "${label}" tetap ada`).toContain(label);
    }
  });

  it('tidak mengekspos tipe/API renderer, validator, IPC, atau export anggaran', () => {
    expect(API).not.toMatch(/anggaran/i);
    expect(VALIDATION).not.toMatch(/anggaran/i);
    expect(IPC).not.toMatch(/anggaran/i);
    expect(WORKBOOKS).not.toMatch(/anggaran/i);
    expect(PRINT_ADAPTERS).not.toMatch(/anggaran/i);
  });

  it('file modul dan test anggaran sudah dihapus', () => {
    for (const path of [
      'src/renderer/components/RealisasiTab.tsx',
      'src/core/anggaran.ts',
      'src/db/anggaran.ts',
      'tests/anggaran.test.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('label audit lama ANGGARAN tetap tersedia', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('ANGGARAN')");
  });
});
