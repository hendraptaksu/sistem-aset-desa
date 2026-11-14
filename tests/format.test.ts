// tests/format.test.ts
import { describe, expect, it } from 'vitest';
import { formatRp, formatTanggal, parseRupiahToSen } from '../src/utils/format.js';

describe('formatRp sen → Rupiah bulat, desimal hanya bila ada pecahan', () => {
  it('bulat tampil tanpa ,00', () => {
    expect(formatRp(15_000_000)).toBe('Rp 150.000');
    expect(formatRp(150_000_000)).toBe('Rp 1.500.000');
    expect(formatRp(0)).toBe('Rp 0');
  });
  it('pecahan sen tetap tampil', () => {
    expect(formatRp(150_050)).toBe('Rp 1.500,50');
    expect(formatRp(15_000_050)).toBe('Rp 150.000,50');
  });
  it('negatif kurung, bulat maupun pecahan', () => {
    expect(formatRp(-15_000_000)).toBe('(Rp 150.000)');
    expect(formatRp(-10_000_000)).toBe('(Rp 100.000)');
    expect(formatRp(-15_000_050)).toBe('(Rp 150.000,50)');
  });
});

describe('formatTanggal ISO → "27 Okt 2026"', () => {
  it('konversi benar', () => {
    expect(formatTanggal('2026-01-05')).toBe('5 Jan 2026');
    expect(formatTanggal('2026-10-27')).toBe('27 Okt 2026');
  });
  it('semua bulan memakai nama Indonesia 3 huruf', () => {
    const bulan = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    bulan.forEach((nama, indeks) => {
      const iso = `2026-${String(indeks + 1).padStart(2, '0')}-01`;
      expect(formatTanggal(iso)).toBe(`1 ${nama} 2026`);
    });
  });
  it('hari tanpa leading zero', () => {
    expect(formatTanggal('2026-12-09')).toBe('9 Des 2026');
    expect(formatTanggal('2026-06-30')).toBe('30 Jun 2026');
  });
  it('input invalid dikembalikan apa adanya', () => {
    for (const invalid of ['asal', '', '2026-1-5', '2026-13-01', '2026-00-10', '2026-01-00']) {
      expect(formatTanggal(invalid)).toBe(invalid);
    }
  });
});

describe('parseRupiahToSen gaya Indonesia', () => {
  it('bulat auto ×100', () => {
    expect(parseRupiahToSen('1500')).toBe(150_000);
    expect(parseRupiahToSen('1.500')).toBe(150_000);
    expect(parseRupiahToSen('')).toBe(0);
  });
  it('ribuan berkelompok 3 digit tetap sah', () => {
    expect(parseRupiahToSen('1500000')).toBe(150_000_000);
    expect(parseRupiahToSen('1.500.000')).toBe(150_000_000);
    expect(parseRupiahToSen('20.000')).toBe(2_000_000);
    expect(parseRupiahToSen('12.345.678')).toBe(1_234_567_800);
  });
  it('koma desimal', () => {
    expect(parseRupiahToSen('1500,50')).toBe(150_050);
    expect(parseRupiahToSen('1.500,50')).toBe(150_050);
    expect(parseRupiahToSen('1500,5')).toBe(150_050);
    expect(parseRupiahToSen('1.500,5')).toBe(150_050);
    expect(parseRupiahToSen('0,5')).toBe(50);
    expect(parseRupiahToSen('1.500.000,50')).toBe(1_500_000_50);
  });
  it('menolak susunan titik ribuan tak lazim (T-B11)', () => {
    // Titik hanya sah sebagai pemisah ribuan berkelompok tepat 3 digit;
    // '1.50.0', '1.500.5', '1500.5' dulu diterima (dihitung 1500/15005).
    for (const bad of ['1.50.0', '1.500.5', '1500.5', '12.34.567', '1.5.00,10', '1.5000', '1500.', '.500']) {
      expect(() => parseRupiahToSen(bad)).toThrowError();
    }
    // Pesan ditolak tetap Indonesia dan bisa ditindaklanjuti.
    expect(() => parseRupiahToSen('1.50.0')).toThrowError(/Nominal tidak valid/);
  });
  it('invalid throw pesan Indonesia', () => {
    for (const bad of ['abc', '1,234', '-5', ',50', '.', '..']) {
      expect(() => parseRupiahToSen(bad)).toThrowError();
    }
  });
});
