import { describe, expect, it } from 'vitest';
import {
  ZONA_WAKTU_APP,
  akhirHariLokalUtc,
  awalHariLokalUtc,
  formatWaktuLokal,
  tahunLokal,
  tanggalLokal,
} from '../src/utils/tanggal.js';

describe('tanggalLokal WITA', () => {
  it('zona waktu aplikasi adalah Asia/Makassar', () => {
    expect(ZONA_WAKTU_APP).toBe('Asia/Makassar');
  });

  it('2025-12-31T16:30:00Z → 2026-01-01 (WITA)', () => {
    expect(tanggalLokal(new Date('2025-12-31T16:30:00Z'))).toBe('2026-01-01');
    expect(tahunLokal(new Date('2025-12-31T16:30:00Z'))).toBe(2026);
  });

  it('2026-01-01T00:30:00+08:00 → 2026-01-01', () => {
    expect(tanggalLokal(new Date('2026-01-01T00:30:00+08:00'))).toBe('2026-01-01');
  });

  it('tengah malam WITA tidak mundur sehari', () => {
    // 2026-01-14T16:00:00Z = 2026-01-15 00:00 WITA.
    expect(tanggalLokal(new Date('2026-01-14T16:00:00.000Z'))).toBe('2026-01-15');
  });

  it('2026-10-23T23:30:00Z → 2026-10-24', () => {
    expect(tanggalLokal(new Date('2026-10-23T23:30:00Z'))).toBe('2026-10-24');
  });

  it('menerima epoch milidetik', () => {
    expect(tanggalLokal(Date.parse('2026-10-23T23:30:00Z'))).toBe('2026-10-24');
  });

  it('parameter timeZone hanya untuk test/override', () => {
    expect(tanggalLokal(new Date('2025-12-31T16:30:00Z'), 'UTC')).toBe('2025-12-31');
    expect(tahunLokal(new Date('2025-12-31T16:30:00Z'), 'UTC')).toBe(2025);
  });
});

describe('formatWaktuLokal untuk audit', () => {
  it('menampilkan jam lokal, bukan UTC', () => {
    expect(formatWaktuLokal('2026-10-22T23:30:00Z')).toBe('2026-10-23 07:30');
  });

  it('tengah malam tampil 00:xx, bukan 24:xx', () => {
    expect(formatWaktuLokal('2026-01-01T16:00:00Z')).toBe('2026-01-02 00:00');
  });

  it('timeZone bisa dioverride untuk test', () => {
    expect(formatWaktuLokal('2026-10-22T23:30:00Z', 'UTC')).toBe('2026-10-22 23:30');
  });

  it('input tidak valid dikembalikan apa adanya', () => {
    expect(formatWaktuLokal('bukan-waktu')).toBe('bukan-waktu');
  });
});

describe('batas hari lokal → UTC untuk filter', () => {
  it('awal hari inklusif dan batas akhir eksklusif (WITA)', () => {
    expect(awalHariLokalUtc('2026-10-23')).toBe('2026-10-22T16:00:00.000Z');
    expect(akhirHariLokalUtc('2026-10-23')).toBe('2026-10-23T16:00:00.000Z');
  });

  it('benar di sekitar pergantian tahun', () => {
    expect(awalHariLokalUtc('2026-01-01')).toBe('2025-12-31T16:00:00.000Z');
    expect(akhirHariLokalUtc('2026-12-31')).toBe('2026-12-31T16:00:00.000Z');
  });

  it('timeZone bisa dioverride untuk test', () => {
    expect(awalHariLokalUtc('2026-10-23', 'UTC')).toBe('2026-10-23T00:00:00.000Z');
    expect(akhirHariLokalUtc('2026-10-23', 'UTC')).toBe('2026-10-24T00:00:00.000Z');
  });

  it('tanggal kalender tidak valid ditolak', () => {
    expect(() => awalHariLokalUtc('2026-02-31')).toThrow(RangeError);
    expect(() => akhirHariLokalUtc('bukan-tanggal')).toThrow(RangeError);
  });
});
