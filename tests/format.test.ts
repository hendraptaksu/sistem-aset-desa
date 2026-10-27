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
