// AUD2-11: input & tampilan nominal Rupiah.
// Fokus: formatRp bersih untuk nominal bulat/pecahan, CurrencyInput memakai
// keyboard numerik, menampilkan titik ribuan, dan membaca format Indonesia
// (termasuk koma desimal) tanpa mengubah arti paste '100,000' menjadi Rp 100.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { formatRp } from '../src/utils/format.js';
import {
  CurrencyInput,
  parseCurrencyInput,
} from '../src/renderer/components/ui.js';

describe('AUD2-11 — formatRp nominal bulat', () => {
  it('menampilkan nominal bulat tanpa akhiran ,00', () => {
    expect(formatRp(15_000_000)).toBe('Rp 150.000');
    expect(formatRp(150_000_000)).toBe('Rp 1.500.000');
    expect(formatRp(0)).toBe('Rp 0');
  });

  it('tetap menampilkan pecahan sen bila datanya pecahan', () => {
    expect(formatRp(15_000_050)).toBe('Rp 150.000,50');
    expect(formatRp(150_050)).toBe('Rp 1.500,50');
  });

  it('negatif tetap dalam kurung', () => {
    expect(formatRp(-15_000_000)).toBe('(Rp 150.000)');
    expect(formatRp(-15_000_050)).toBe('(Rp 150.000,50)');
  });
});

describe('AUD2-11 — CurrencyInput rupiah', () => {
  it('memakai inputMode numeric dan memformat nilai awal dengan titik ribuan', () => {
    const html = renderToStaticMarkup(
      createElement(CurrencyInput, {
        value: 15_000_000,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('value="150.000"');
  });

  it('mengetik digit menampilkan titik ribuan dan mengirim SEN ×100', () => {
    expect(parseCurrencyInput('150000')).toEqual({
      tampil: '150.000',
      sen: 15_000_000,
    });
    expect(parseCurrencyInput('1500000')).toEqual({
      tampil: '1.500.000',
      sen: 150_000_000,
    });
  });

  it('menghapus seluruh isi menghasilkan tampilan kosong dan nilai 0', () => {
    expect(parseCurrencyInput('')).toEqual({ tampil: '', sen: 0 });
  });

  it('paste bertitik/koma dibaca sebagai rupiah utuh, bukan pecahan 100 rupiah', () => {
    expect(parseCurrencyInput('100,000')).toEqual({
      tampil: '100.000',
      sen: 10_000_000,
    });
    expect(parseCurrencyInput('Rp 1.500.000')).toEqual({
      tampil: '1.500.000',
      sen: 150_000_000,
    });
  });

  it('membaca koma desimal sebagai sen', () => {
    expect(parseCurrencyInput('1.500,50')).toEqual({
      tampil: '1.500,50',
      sen: 150_050,
    });
    expect(parseCurrencyInput('1.500,5')).toEqual({
      tampil: '1.500,5',
      sen: 150_050,
    });
    expect(parseCurrencyInput('1500,50')).toEqual({
      tampil: '1.500,50',
      sen: 150_050,
    });
    expect(parseCurrencyInput('0,05')).toEqual({ tampil: '0,05', sen: 5 });
  });

  it('mempertahankan koma di akhir agar desimal bisa diketik bertahap', () => {
    expect(parseCurrencyInput('1.500,')).toEqual({
      tampil: '1.500,',
      sen: 150_000,
    });
  });

  it('membaca paste format AS dan memotong desimal lebih dari 2 digit', () => {
    expect(parseCurrencyInput('1,500.50')).toEqual({
      tampil: '1.500,50',
      sen: 150_050,
    });
    expect(parseCurrencyInput('1.500,505')).toEqual({
      tampil: '1.500,50',
      sen: 150_050,
    });
    expect(parseCurrencyInput('Rp 1.500.000,00')).toEqual({
      tampil: '1.500.000,00',
      sen: 150_000_000,
    });
  });

  it('menampilkan nilai pecahan sen di input', () => {
    const html = renderToStaticMarkup(
      createElement(CurrencyInput, {
        value: 150_050,
        onChange: () => undefined,
      }),
    );
    expect(html).toContain('value="1.500,50"');
  });

  it('membatasi digit agar nilai SEN tetap bilangan aman', () => {
    const { sen } = parseCurrencyInput('99999999999999999999');
    expect(Number.isSafeInteger(sen)).toBe(true);
  });
});
