import { describe, expect, it } from 'vitest';
import {
  validasiBentukPembatalanPinjaman,
  validasiBentukPinjamanBayar,
} from '../src/main/validation.js';

describe('DB-16g — kontrak pembatalan dan pembayaran sebagian pinjaman', () => {
  it('mewajibkan ID dan alasan koreksi, lalu hanya meneruskan field yang dikenal', () => {
    expect(validasiBentukPembatalanPinjaman(null).ok).toBe(false);
    expect(validasiBentukPembatalanPinjaman({ id: '', alasan: 'cukup alasan' }).ok).toBe(false);
    expect(validasiBentukPembatalanPinjaman({ id: 'bayar-1', alasan: 'abc' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/minimal 5/i),
    });
    expect(
      validasiBentukPembatalanPinjaman({
        id: '  bayar-1  ',
        alasan: '  pembayaran salah input  ',
        akunKas: '1001',
        konfirmasiPeringatan: true,
      }),
    ).toEqual({
      ok: true,
      input: { id: 'bayar-1', alasan: 'pembayaran salah input' },
    });
  });

  it('mempertahankan ID pembayaran yang dipakai ulang saat submit dicoba lagi', () => {
    expect(
      validasiBentukPinjamanBayar({
        id: 'pby-retry-stabil',
        pinjamanId: 'pinjaman-1',
        angsuranId: 1,
        tanggal: '2026-02-01',
        akunKas: '1014',
        pokok: 100,
        bunga: 0,
      }),
    ).toMatchObject({ ok: true, input: { id: 'pby-retry-stabil' } });
  });

});
