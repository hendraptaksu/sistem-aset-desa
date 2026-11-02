// DB-26 — Jurnal Umum di balik Mode lanjutan.
// Fokus: default tersembunyi, persistensi per profil, menu Data & Sistem,
// penjelasan di layar Jurnal, dan perpindahan tab yang aman saat mode dimatikan.
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  KUNCI_MODE_LANJUTAN,
  bacaModeLanjutan,
  menuTerlihat,
  simpanModeLanjutan,
  tabSetelahModeLanjutan,
  type PenyimpananMode,
} from '../src/renderer/lib/modeLanjutan.js';
import { JurnalTab } from '../src/renderer/components/JurnalTab.js';
import { ModeLanjutanCard } from '../src/renderer/components/PengaturanTab.js';
import {
  DashboardTab,
  type DashboardTabTujuan,
} from '../src/renderer/components/DashboardTab.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const APP = baca('src/renderer/App.tsx');
const DASHBOARD = baca('src/renderer/components/DashboardTab.tsx');
const JURNAL_TAB = baca('src/renderer/components/JurnalTab.tsx');

function penyimpananPalsu(awal?: string): PenyimpananMode & {
  isi: Map<string, string>;
} {
  const isi = new Map<string, string>();
  if (awal !== undefined) isi.set(KUNCI_MODE_LANJUTAN, awal);
  return {
    isi,
    getItem: (kunci) => isi.get(kunci) ?? null,
    setItem: (kunci, nilai) => {
      isi.set(kunci, nilai);
    },
  };
}

describe('DB-26 — Mode lanjutan: default, persistensi, dan menu', () => {
  it('default mati dan helper menu menyembunyikan Jurnal Umum saja', () => {
    expect(bacaModeLanjutan(penyimpananPalsu())).toBe(false);
    expect(bacaModeLanjutan(null)).toBe(false);

    expect(menuTerlihat('jurnal', false)).toBe(false);
    expect(menuTerlihat('jurnal', true)).toBe(true);
    for (const tab of ['dashboard', 'transaksi', 'akun', 'tutup', 'pengaturan']) {
      expect(menuTerlihat(tab, false), `${tab} tetap tampil`).toBe(true);
      expect(menuTerlihat(tab, true), `${tab} tetap tampil`).toBe(true);
    }
  });

  it('persistensi localStorage per profil memakai kunci tetap dan default mati', () => {
    const penyimpanan = penyimpananPalsu();
    simpanModeLanjutan(true, penyimpanan);
    expect(penyimpanan.isi.get(KUNCI_MODE_LANJUTAN)).toBe('true');
    expect(bacaModeLanjutan(penyimpanan)).toBe(true);

    simpanModeLanjutan(false, penyimpanan);
    expect(penyimpanan.isi.get(KUNCI_MODE_LANJUTAN)).toBe('false');
    expect(bacaModeLanjutan(penyimpanan)).toBe(false);

    // Nilai asing/korup tidak boleh menyalakan mode.
    expect(bacaModeLanjutan(penyimpananPalsu('1'))).toBe(false);
    expect(bacaModeLanjutan(penyimpananPalsu('TRUE'))).toBe(false);

    // localStorage diblokir: baca = mati, simpan tidak melempar.
    const gagal: PenyimpananMode = {
      getItem: () => {
        throw new Error('diblokir');
      },
      setItem: () => {
        throw new Error('diblokir');
      },
    };
    expect(bacaModeLanjutan(gagal)).toBe(false);
    expect(() => simpanModeLanjutan(true, gagal)).not.toThrow();
  });

  it('jurnal dipindah ke grup Data & Sistem dan tidak ada di grup Harian', () => {
    const harian = APP.slice(APP.indexOf("id: 'harian'"), APP.indexOf("id: 'laporan'"));
    const data = APP.slice(APP.indexOf("id: 'data'"), APP.indexOf('];', APP.indexOf("id: 'data'")));
    expect(harian).not.toContain("'jurnal'");
    expect(data).toContain("'jurnal'");
    expect(data).toContain("'tutup'");
    // Menu dirender lewat filter Mode lanjutan, bukan daftar mentah.
    expect(APP).toContain('menuTerlihat(id, modeLanjutan)');
    expect(APP).toContain('tabSetelahModeLanjutan(tab, modeLanjutan)');
    expect(APP).toContain('simpanModeLanjutan(aktif)');
    expect(APP).toContain('modeLanjutan={modeLanjutan}');
    // DB-29: label operator memakai Kunci Periode, bukan Tutup Buku.
    expect(APP).toContain("label: 'Kunci Periode'");
    expect(APP).not.toContain("label: 'Tutup Buku'");
  });

  it('dashboard tidak menawarkan pintasan Jurnal Umum saat mode mati', () => {
    const tujuan: DashboardTabTujuan[] = [];
    const html = renderToStaticMarkup(
      createElement(DashboardTab, {
        onBukaTab: (tab) => tujuan.push(tab),
        modeLanjutan: false,
      }),
    );
    // Data belum termuat di SSR, jadi pintasan hanya bisa diperiksa dari sumber:
    // tombol Jurnal Umum dibungkus kondisi modeLanjutan. DB-29 menghapus
    // pintasan ganda; tombol tersisa ada di kartu Jurnal Terakhir.
    expect((DASHBOARD.match(/onBukaTab\('jurnal'\)/g) ?? []).length).toBe(1);
    expect((DASHBOARD.match(/modeLanjutan &&/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).not.toContain('>Jurnal Umum</button>');
    expect(tujuan).toEqual([]);
  });
});

describe('DB-26 — saklar Mode lanjutan dan tab aman', () => {
  it('kartu pengaturan memberi label jelas, status, dan penjelasan', () => {
    const mati = renderToStaticMarkup(
      createElement(ModeLanjutanCard, { aktif: false, onBerubah: () => undefined }),
    );
    expect(mati).toContain('Mode lanjutan');
    expect(mati).toContain('Nonaktif');
    expect(mati).toContain('Aktifkan Mode lanjutan');
    expect(mati).toContain('Jurnal Umum');
    expect(mati).toContain('Operator harian tidak perlu membuka ini.');

    const hidup = renderToStaticMarkup(
      createElement(ModeLanjutanCard, { aktif: true, onBerubah: () => undefined }),
    );
    expect(hidup).toContain('Aktif');
    expect(hidup).toContain('Nonaktifkan Mode lanjutan');
    expect(hidup).toContain('Data &amp; Sistem');
    expect(hidup).toContain('jurnal balik');

    // Konfirmasi eksplisit hanya muncul setelah tombol aktif ditekan.
    const sumber = baca('src/renderer/components/PengaturanTab.tsx');
    expect(sumber).toContain('Aktifkan Mode lanjutan?');
    expect(sumber).toContain('untuk pemeriksaan oleh akuntan');
    expect(sumber).toContain('labelYa="Ya, aktifkan Mode lanjutan"');
    expect(sumber).toContain('onKonfirmasi={() => {');
  });

  it('menonaktifkan mode saat Jurnal aktif memindahkan tab ke dashboard', () => {
    expect(tabSetelahModeLanjutan('jurnal', true)).toBe('jurnal');
    expect(tabSetelahModeLanjutan('jurnal', false)).toBe('dashboard');
    expect(tabSetelahModeLanjutan('pengaturan', false)).toBe('pengaturan');
    expect(tabSetelahModeLanjutan('dashboard', false)).toBe('dashboard');
    // Efek App memakai helper yang sama dan melewati guard form.
    expect(APP).toContain('const tujuan = tabSetelahModeLanjutan(tab, modeLanjutan)');
    expect(APP).toContain('if (tujuan !== tab) lakukanPindah(tujuan)');
  });

  it('JurnalTab menjelaskan pemeriksaan dan koreksi tanpa mengedit', () => {
    const html = renderToStaticMarkup(createElement(JurnalTab));
    expect(html).toContain('Jurnal Umum = tampilan debit/kredit untuk pemeriksaan.');
    expect(html).toContain('Operator harian tidak perlu membuka ini.');
    expect(html).toContain('Koreksi tidak dilakukan dengan mengedit jurnal');
    expect(html).toContain('jurnal balik');
    expect(html).toContain('form terpandu');
    // DB-03 tidak berubah: badge statis dan editor selalu UMUM.
    expect(html).toContain('>Jurnal Umum</span>');
    expect(html).toContain('+ Jurnal Baru');
    expect(JURNAL_TAB).toContain('Jurnal Umum = tampilan debit/kredit untuk pemeriksaan.');
  });
});
