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
const VALIDATION = baca('src/main/validation.ts');
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
      'Anggaran',
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
