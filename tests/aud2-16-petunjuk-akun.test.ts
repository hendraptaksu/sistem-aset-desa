// AUD2-16 — petunjuk pembeda akun kembar di form input.
//
// Fokus:
// - Helper memberi pesan kontekstual untuk seluruh akun yang punya kembaran
//   dan tidak menampilkan apa pun untuk akun lain.
// - Petunjuk tampil di bawah dropdown akun lawan TransaksiForm dan dropdown
//   akun beban PanjarTab, mengikuti akun yang sedang dipilih.

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COA } from '../src/db/coa.js';
import {
  PETUNJUK_AKUN_KEMBAR,
  petunjukAkunKembar,
  type KodeAkunKembar,
} from '../src/renderer/lib/petunjukAkun.js';
import { PetunjukAkunKembar } from '../src/renderer/components/PetunjukAkunKembar.js';
import { FormTransaksiTerpandu } from '../src/renderer/components/TransaksiForm.js';
import { PanjarTab } from '../src/renderer/components/PanjarTab.js';

const KODE_KEMBAR: KodeAkunKembar[] = [
  '5010',
  '5060',
  '5004',
  '5062',
  '5003',
  '5031',
  '4005',
  '4006',
  '4008',
  '4041',
  '4060',
];

/** Akun pembanding yang wajib disebut di pesan tiap kode. */
const PASANGAN: Record<KodeAkunKembar, string[]> = {
  '5010': ['5060'],
  '5060': ['5010'],
  '5004': ['5062'],
  '5062': ['5004'],
  '5003': ['5031'],
  '5031': ['5003'],
  '4005': ['4006'],
  '4006': ['4005'],
  '4008': ['4041', '4060'],
  '4041': ['4008', '4060'],
  '4060': ['4008', '4041'],
};

function renderForm(jenis: 'TERIMA' | 'BAYAR' | 'CATAT_UTANG'): string {
  return renderToStaticMarkup(
    createElement(FormTransaksiTerpandu, {
      jenis,
      coa: COA,
      memuat: false,
    }),
  );
}

describe('AUD2-16 — helper petunjuk akun kembar', () => {
  it('mencakup tepat 11 akun yang memiliki pasangan mirip', () => {
    expect(Object.keys(PETUNJUK_AKUN_KEMBAR).sort()).toEqual(
      [...KODE_KEMBAR].sort(),
    );
  });

  it('memberi pesan kontekstual yang menyebut akun pasangannya', () => {
    for (const kode of KODE_KEMBAR) {
      const pesan = petunjukAkunKembar(kode);
      expect(pesan, kode).not.toBeNull();
      expect(pesan, kode).toMatch(/^Tips:/);
      expect(pesan, kode).toContain(kode);
      for (const pasangan of PASANGAN[kode]) {
        expect(pesan, `${kode} → ${pasangan}`).toContain(pasangan);
      }
      expect(pesan, kode).toMatch(/konsisten|jangan campur|jangan berganti|pisahkan/i);
    }
  });

  it('tidak memberi petunjuk untuk akun tanpa kembaran atau kode kosong', () => {
    for (const kode of [
      '1001',
      '1040',
      '4001',
      '5000',
      '5061',
      '5063',
      '',
      '   ',
      null,
      undefined,
    ]) {
      expect(petunjukAkunKembar(kode), String(kode)).toBeNull();
    }
  });

  it('merapikan spasi pada kode yang dipilih', () => {
    expect(petunjukAkunKembar(' 5010 ')).toBe(
      PETUNJUK_AKUN_KEMBAR['5010'],
    );
  });
});

describe('AUD2-16 — komponen petunjuk mengikuti akun terpilih', () => {
  it('merender kotak tips untuk akun kembar dan hilang untuk akun lain', () => {
    const kembar = renderToStaticMarkup(
      createElement(PetunjukAkunKembar, { kode: '5010' }),
    );
    expect(kembar).toContain('role="note"');
    expect(kembar).toContain('data-petunjuk-akun="5010"');
    expect(kembar).toContain('5060 PENGELUARAN AIR, LISTRIK, TELEPON');

    const lain = renderToStaticMarkup(
      createElement(PetunjukAkunKembar, { kode: '1001' }),
    );
    expect(lain).toBe('');
  });
});

describe('AUD2-16 — petunjuk di TransaksiForm', () => {
  it('tampil di bawah dropdown akun lawan Bayar (default 5010)', () => {
    const html = renderForm('BAYAR');
    expect(html).toContain('data-petunjuk-akun="5010"');
    expect(html).toContain('5010 untuk tagihan listrik/air/telepon');
    expect(html).toContain('5060 PENGELUARAN AIR, LISTRIK, TELEPON');
  });

  it('tampil untuk akun beban Catat Utang (default 5003)', () => {
    const html = renderForm('CATAT_UTANG');
    expect(html).toContain('data-petunjuk-akun="5003"');
    expect(html).toContain('5031 BIAYA PROYEK');
  });

  it('tidak menampilkan petunjuk saat akun awal bukan akun kembar', () => {
    const html = renderForm('TERIMA');
    expect(html).not.toContain('data-petunjuk-akun');
  });

  it('mengikat petunjuk ke state akun lawan agar ikut berubah', () => {
    const sumber = readFileSync(
      new URL(
        '../src/renderer/components/TransaksiForm.tsx',
        import.meta.url,
      ),
      'utf8',
    );
    expect(sumber).toContain('<PetunjukAkunKembar kode={akunLawan} />');
    expect(sumber).toContain('setAkunLawan(e.target.value)');
  });
});

describe('AUD2-16 — petunjuk di PanjarTab', () => {
  it('tampil di bawah dropdown akun beban pertanggungjawaban (default 5004)', () => {
    const html = renderToStaticMarkup(createElement(PanjarTab));
    expect(html).toContain('Akun beban');
    expect(html).toContain('data-petunjuk-akun="5004"');
    expect(html).toContain('5062 PENGELUARAN BANTEN RUTIN (HARIAN)');
  });

  it('mengikat petunjuk ke kategori baris agar ikut berubah', () => {
    const sumber = readFileSync(
      new URL('../src/renderer/components/PanjarTab.tsx', import.meta.url),
      'utf8',
    );
    expect(sumber).toContain(
      '<PetunjukAkunKembar kode={it.kategori_baga} />',
    );
    expect(sumber).toContain('kategori_baga: e.target.value');
  });
});
