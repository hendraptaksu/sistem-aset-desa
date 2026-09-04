// Test validasi input form (main process) — melengkapi T1-T8 akurasi.

import { describe, expect, it } from 'vitest';
import {
  kategoriBolehDipilih,
  validatePanjarItems,
  validateTransaksiInput,
} from '../src/main/validation.js';

const BASE = {
  tanggal: '2025-03-12',
  keterangan: 'Parkir',
  akun_kas: '1015',
  kategori: '4001',
  masuk: 100_000,
  keluar: 0,
};

describe('validateTransaksiInput', () => {
  it('input valid lolos', () => {
    expect(validateTransaksiInput(BASE)).toEqual([]);
  });
  it('menolak tanggal, keterangan kosong, kas salah', () => {
    expect(validateTransaksiInput({ ...BASE, tanggal: '12-03-2025' }).length).toBeGreaterThan(0);
    expect(validateTransaksiInput({ ...BASE, keterangan: '  ' }).length).toBeGreaterThan(0);
    expect(validateTransaksiInput({ ...BASE, akun_kas: '4001' }).length).toBeGreaterThan(0);
  });
  it('menolak nominal 0 dan dua sisi terisi', () => {
    expect(validateTransaksiInput({ ...BASE, masuk: 0 }).length).toBeGreaterThan(0);
    expect(validateTransaksiInput({ ...BASE, masuk: 5, keluar: 5 }).length).toBeGreaterThan(0);
  });
  it('kategori sistem & hasil hitungan tidak bisa dipilih', () => {
    expect(kategoriBolehDipilih('PANJAR')).toBe(false);
    expect(kategoriBolehDipilih('3001')).toBe(false);
    expect(kategoriBolehDipilih('3002')).toBe(false);
    expect(kategoriBolehDipilih('1001')).toBe(false);
    expect(kategoriBolehDipilih('5004')).toBe(true);
    expect(kategoriBolehDipilih('2050')).toBe(true);
    expect(kategoriBolehDipilih('1050')).toBe(true); // piutang lewat sisi kategori
    expect(validateTransaksiInput({ ...BASE, kategori: 'PANJAR' }).length).toBeGreaterThan(0);
  });
});

describe('validatePanjarItems', () => {
  it('menolak rincian kosong / baga salah / nominal 0', () => {
    expect(validatePanjarItems([]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '4001', nominal: 100 }]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '5004', nominal: 0 }]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '5004', nominal: 100 }])).toEqual([]);
  });
});
