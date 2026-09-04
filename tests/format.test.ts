// tests/format.test.ts
import { describe, expect, it } from 'vitest';
import { formatRp, formatTanggal, parseRupiahToSen } from '../src/utils/format.js';

describe('formatRp sen → 2 desimal', () => {
  it('bulat tampil ,00', () => {
    expect(formatRp(150_000_000)).toBe('Rp 1.500.000,00');
    expect(formatRp(0)).toBe('Rp 0,00');
  });
  it('pecahan tampil', () => {
    expect(formatRp(150_050)).toBe('Rp 1.500,50');
  });
  it('negatif kurung', () => {
    expect(formatRp(-10_000_000)).toBe('(Rp 100.000,00)');
  });
});

describe('formatTanggal ISO → DD-MM-YYYY', () => {
  it('konversi benar', () => {
    expect(formatTanggal('2026-01-05')).toBe('05-01-2026');
  });
  it('input invalid dikembalikan apa adanya', () => {
    expect(formatTanggal('asal')).toBe('asal');
  });
});

describe('parseRupiahToSen gaya Indonesia', () => {
  it('bulat auto ×100', () => {
    expect(parseRupiahToSen('1500')).toBe(150_000);
    expect(parseRupiahToSen('1.500')).toBe(150_000);
    expect(parseRupiahToSen('')).toBe(0);
  });
  it('koma desimal', () => {
    expect(parseRupiahToSen('1500,50')).toBe(150_050);
    expect(parseRupiahToSen('1.500,50')).toBe(150_050);
  });
  it('invalid throw pesan Indonesia', () => {
    // Catatan: posisi titik ribuan TIDAK divalidasi ketat (per spec §3),
    // jadi '1.5.00,10' diterima sebagai 150010 sen — bukan invalid.
    for (const bad of ['abc', '1,234', '-5', ',50', '.', '..']) {
      expect(() => parseRupiahToSen(bad)).toThrowError();
    }
  });
});
