// AUD2-12 — hapus tab Buku Pembantu yang redundan dan perjelas arah mutasi
// Buku Besar untuk bendahara awam tanpa menghilangkan istilah akuntan.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KepalaMutasi } from '../src/renderer/components/BukuBesarTab.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const APP = baca('src/renderer/App.tsx');
const MODE_LANJUTAN = baca('src/renderer/lib/modeLanjutan.ts');
const BUKU_BESAR = baca('src/renderer/components/BukuBesarTab.tsx');
const E2E = baca('e2e/ui-audit.test.mjs');

describe('AUD2-12 — tab Buku Pembantu dihapus dari navigasi', () => {
  it('tidak lagi punya tab, menu, route, import, atau komponen Buku Pembantu', () => {
    expect(APP).not.toContain('PembantuTab');
    expect(APP).not.toContain('Buku Pembantu');
    expect(APP).not.toContain("'pembantu'");
    expect(APP).not.toContain('NotebookText');
    expect(MODE_LANJUTAN).not.toContain('pembantu');
    expect(existsSync(join(ROOT, 'src/renderer/components/PembantuTab.tsx'))).toBe(false);
  });

  it('daftar tab e2e ikut ramping dan tetap mengaktifkan Mode lanjutan', () => {
    const blokTab = E2E.slice(E2E.indexOf('const TAB ='), E2E.indexOf('const TAB_DI_GRUP'));
    const id = [...blokTab.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
    expect(id).toHaveLength(13);
    expect(id).not.toContain('pembantu');
    expect(blokTab).not.toContain('Buku Pembantu');
    expect(E2E).not.toContain("'pembantu'");
  });

  it('Buku Besar tetap mempertahankan drill-down jurnal asal', () => {
    expect(BUKU_BESAR).toContain('DetailJurnalModal');
    expect(BUKU_BESAR).toContain('bukaDetail');
    expect(BUKU_BESAR).toContain('Klik untuk melihat jurnal asal');
  });
});

describe('AUD2-12 — label arah mutasi Buku Besar', () => {
  it('akun posisi normal DEBIT: debit menambah, kredit mengurangi', () => {
    const html = renderToStaticMarkup(
      createElement(KepalaMutasi, { posisiNormal: 'DEBIT' }),
    );
    expect(html).toContain('Debit');
    expect(html).toContain('(+ / Masuk)');
    expect(html).toContain('Kredit');
    expect(html).toContain('(- / Keluar)');
  });

  it('akun posisi normal KREDIT: debit mengurangi, kredit menambah', () => {
    const html = renderToStaticMarkup(
      createElement(KepalaMutasi, { posisiNormal: 'KREDIT' }),
    );
    expect(html).toContain('Debit');
    expect(html).toContain('(- / Berkurang)');
    expect(html).toContain('Kredit');
    expect(html).toContain('(+ / Bertambah)');
  });

  it('tabel mutasi memakai posisi normal akun yang sedang dibuka', () => {
    expect(BUKU_BESAR).toContain('<KepalaMutasi posisiNormal={data.posisi_normal} />');
  });
});
