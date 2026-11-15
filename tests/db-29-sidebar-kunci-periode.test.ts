// DB-29 — kurangi tab sidebar & rename "Tutup Buku" menjadi "Kunci Periode".
//
// Fokus:
// - TABS/GRUP_MENU hanya memuat modul yang masih ada (tanpa tab modul hapus);
// - Laporan default tertutup, Jurnal Umum tetap di Data & Sistem dan tersembunyi
//   sampai Mode lanjutan aktif;
// - label UI, audit, dan dokumentasi memakai Kunci Periode;
// - penjelasan Kunci Periode menegaskan ini bukan jurnal penutup dan laba tetap
//   dihitung dari jurnal;
// - daftar tab e2e ikut set tab saat ini, tanpa label lama.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TutupTab } from '../src/renderer/components/TutupTab.js';
import {
  menuTerlihat,
  tabSetelahModeLanjutan,
} from '../src/renderer/lib/modeLanjutan.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const APP = baca('src/renderer/App.tsx');
const TUTUP = baca('src/renderer/components/TutupTab.tsx');
const DASHBOARD = baca('src/renderer/components/DashboardTab.tsx');
const PENGATURAN = baca('src/renderer/components/PengaturanTab.tsx');
const AUDIT_DETAIL = baca('src/utils/auditDetail.ts');
const E2E = baca('e2e/ui-audit.test.mjs');
const README = baca('README.md');
const PENGGUNA = baca('docs/panduan-pengguna.md');
const PEMERIKSAAN = baca('docs/panduan-pemeriksaan.md');
const ARAH = baca('docs/prinsip-akuntansi.md');

const LABEL_TAB = [
  'Dashboard',
  'Transaksi',
  'Daftar Akun',
  'Jurnal Umum',
  'Buku Besar',
  'Neraca Saldo',
  'Buku Panjar',
  'Pinjaman LPD',
  'Laba Rugi',
  'Neraca',
  'Arus Kas',
  'Kunci Periode',
  'Pengaturan',
];

const LABEL_MODUL_DIHAPUS = [
  'Tutup Buku',
  'Inventaris Aset',
  'Anggaran',
  'Realisasi',
  'Rekonsiliasi Bank',
  'Import Excel',
  'Pihak',
  'Lampiran',
];

describe('DB-29 — TABS dan GRUP_MENU bersih', () => {
  it('hanya memuat tab fungsional saat ini dengan label Kunci Periode', () => {
    const blokTabs = APP.slice(APP.indexOf('const TABS'), APP.indexOf('// UI-04'));
    const label = [...blokTabs.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(label).toEqual(LABEL_TAB);
    expect(label).not.toContain('Tutup Buku');

    for (const lama of LABEL_MODUL_DIHAPUS.slice(1)) {
      expect(APP, `tab "${lama}" sudah tidak ada`).not.toContain(lama);
    }
  });

  it('Laporan default tertutup, Data & Sistem memuat Kunci Periode + Jurnal', () => {
    const blokGrup = APP.slice(
      APP.indexOf('const GRUP_MENU'),
      APP.indexOf('const TAB_BY_ID'),
    );
    expect(blokGrup).toMatch(
      /id: 'laporan',\s*label: 'Laporan',\s*defaultTerbuka: false/,
    );
    expect(blokGrup).toContain("label: 'Data & Sistem'");
    expect(blokGrup).toMatch(/item: \['akun', 'tutup', 'jurnal'\]/);

    const item = [...blokGrup.matchAll(/item:\s*\[([^\]]*)\]/g)].flatMap((m) =>
      [...m[1]!.matchAll(/'([^']+)'/g)].map((x) => x[1]!),
    );
    expect(item).toHaveLength(12);
    expect(new Set(item).size).toBe(item.length);
    expect(item).toContain('jurnal');
    expect(item).not.toContain('pengaturan');
    expect(item).not.toContain('pembantu');
  });

  it('Jurnal Umum tetap tersembunyi sampai Mode lanjutan aktif dan tab aman', () => {
    expect(menuTerlihat('jurnal', false)).toBe(false);
    expect(menuTerlihat('jurnal', true)).toBe(true);
    expect(tabSetelahModeLanjutan('jurnal', false)).toBe('dashboard');
    expect(tabSetelahModeLanjutan('tutup', false)).toBe('tutup');
    expect(APP).toContain('menuTerlihat(id, modeLanjutan)');
    expect(APP).toContain('const tujuan = tabSetelahModeLanjutan(tab, modeLanjutan)');
    expect(APP).toContain('if (tujuan !== tab) lakukanPindah(tujuan)');
  });

  it('dashboard hanya punya satu pintasan menuju Kunci Periode dan Jurnal', () => {
    expect((DASHBOARD.match(/onBukaTab\('tutup'\)/g) ?? []).length).toBe(1);
    expect((DASHBOARD.match(/onBukaTab\('jurnal'\)/g) ?? []).length).toBe(1);
    expect(DASHBOARD).toContain('Buka menu Kunci Periode');
    expect(DASHBOARD).not.toMatch(/Tutup Buku|Buka Tutup Buku|jangan tutup buku/);
  });
});

describe('DB-29 — Kunci Periode di UI dan audit', () => {
  it('TutupTab menjelaskan penanda + kunci, bukan jurnal penutup', () => {
    const html = renderToStaticMarkup(createElement(TutupTab));
    expect(html).toContain('>Kunci Periode</h1>');
    // Istilah asing ("snapshot", "hash") tidak dipakai di UI.
    expect(html).toContain('Ringkasan terkunci');
    expect(html).not.toContain('snapshot');
    expect(html).not.toContain('hash jurnal');
    expect(html).toContain('Angka saat ini tetap dihitung dari jurnal');
    expect(html).toContain('Apakah kunci periode membuat jurnal penutup?');
    expect(html).toContain('Tidak ada jurnal yang dibuat atau dipindahkan ke ekuitas');
    // UI-A18: indikator langkah visual dengan aria-current="step".
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Backup otomatis');
    expect(html).toContain('Riwayat kunci periode');
    expect(html).not.toMatch(/Tutup Buku|Tutup buku|tutup buku/);

    expect(TUTUP).toContain('Catatan kunci periode (opsional)');
    expect(TUTUP).toContain('Konfirmasi kunci periode');
    expect(TUTUP).toContain('Konfirmasi kunci ulang');
    expect(TUTUP).not.toMatch(/Tutup Buku|Tutup buku|tutup buku/);
  });

  it('Pengaturan dan label audit memakai Kunci periode, nilai DB tetap', () => {
    expect(PENGATURAN).toContain("{ value: 'TUTUP', label: 'Kunci periode' }");
    expect(PENGATURAN).toContain("{ value: 'tutup_buku', label: 'Kunci periode' }");
    expect(PENGATURAN).toContain('jurnal, koreksi, kunci periode, backup/pulihkan');
    expect(PENGATURAN).not.toContain("label: 'Tutup buku'");

    expect(AUDIT_DETAIL).toContain("return 'Kunci periode'");
    expect(AUDIT_DETAIL).toContain("return 'Kunci periode (ulang)'");
    expect(AUDIT_DETAIL).not.toContain("return 'Tutup buku");
  });
});

describe('DB-29 — dokumentasi dan e2e mengikuti label baru', () => {
  it('panduan dan README memakai Kunci Periode, bukan istilah lama', () => {
    for (const dokumen of [README, PENGGUNA, PEMERIKSAAN, ARAH]) {
      expect(dokumen).toMatch(/kunci periode/i);
      expect(dokumen).not.toMatch(/tutup buku/i);
    }
    expect(PENGGUNA).toContain('Buka menu **Kunci Periode**');
    expect(PENGGUNA).toContain('Konfirmasi kunci periode');
    expect(PEMERIKSAAN).toContain('## 9. Kunci periode');
  });

  it('dokumen pengguna tidak lagi menawarkan modul sidebar yang dihapus', () => {
    for (const dokumen of [README, PENGGUNA, PEMERIKSAAN]) {
      for (const modul of [
        'Rekonsiliasi Bank',
        'Inventaris Aset',
        'Import Excel',
        'Master Pihak',
        'Lampiran',
      ]) {
        expect(dokumen, `"${modul}" tidak ditawarkan`).not.toContain(modul);
      }
      expect(dokumen).not.toMatch(/\banggaran\b/i);
    }
  });

  it('daftar tab e2e memakai 13 tab saat ini dan mengaktifkan Mode lanjutan', () => {
    const blokTab = E2E.slice(E2E.indexOf('const TAB ='), E2E.indexOf('const TAB_DI_GRUP'));
    const id = [...blokTab.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    expect(id).toEqual([
      'dashboard',
      'transaksi',
      'akun',
      'jurnal',
      'buku-besar',
      'neraca-saldo',
      'panjar',
      'pinjaman',
      'laba-rugi',
      'neraca',
      'arus-kas',
      'tutup',
      'pengaturan',
    ]);
    expect(blokTab).toContain("label: 'Kunci Periode'");
    expect(blokTab).not.toMatch(/Tutup Buku|Inventaris Aset|Anggaran|Rekonsiliasi Bank/);
    expect(E2E).toContain('aktifkanModeLanjutan');
    expect(E2E).toContain("localStorage.setItem('pura.mode.lanjutan', 'true')");
    expect(E2E).toContain('Jurnal Umum tampil sebelum Mode lanjutan diaktifkan');
  });
});
