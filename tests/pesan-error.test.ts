// P1-12: pesan error lintas form harus ramah operator awam.
// Error bisnis Indonesia dipertahankan; error teknis (SQLite, TypeError, path,
// stack) selalu disamarkan menjadi fallback generik.

import { describe, expect, it } from 'vitest';
import {
  PESAN_PROSES_GAGAL,
  PESAN_SIMPAN_GAGAL,
  pesanError,
  pesanValidasi,
} from '../src/utils/pesanError.js';

describe('P1-12 — pesanError', () => {
  it('mempertahankan pesan bisnis berbahasa Indonesia yang aman', () => {
    for (const pesan of [
      'Keterangan wajib diisi.',
      'Nomor bukti JU-2026-0001 sudah dipakai. Gunakan nomor bukti lain.',
      'Kas/Bank 1001 KAS akan minus Rp 500,00. Periksa kembali.',
      'Jurnal tidak seimbang: total debit Rp 1.000,00 ≠ total kredit Rp 900,00.',
      'File backup kosong.',
    ]) {
      expect(pesanError(new Error(pesan))).toBe(pesan);
    }
  });

  it('menyamarkan error SQLite/constraint menjadi fallback generik', () => {
    for (const pesan of [
      'SQLITE_CONSTRAINT: UNIQUE constraint failed: jurnal.no_bukti',
      'SqliteError: no such table: jurnal',
      'UNIQUE constraint failed: aset.kode',
      'constraint failed',
    ]) {
      expect(pesanError(new Error(pesan))).toBe(PESAN_SIMPAN_GAGAL);
    }
  });

  it('menyamarkan TypeError, path pengguna, dan stack trace', () => {
    for (const pesan of [
      'TypeError: Cannot read properties of undefined (reading id)',
      'undefined is not a function',
      'Cannot read property map of null',
      '/Users/taksu/Documents/taksu/sistem-aset-desa/src/main/index.ts:42:7',
      'Error: gagal\n    at jalankan (/Users/taksu/app.js:10:2)',
      'TypeError: x is not a function\n    at foo (node_modules/x/index.js:1:1)',
    ]) {
      expect(pesanError(new Error(pesan))).toBe(PESAN_SIMPAN_GAGAL);
    }
  });

  it('menyamarkan ReferenceError "is not defined" dan pesan runtime serumpun', () => {
    for (const pesan of [
      'COA is not defined',
      'ReferenceError: COA is not defined',
      'Baris is not a constructor',
    ]) {
      expect(pesanError(new Error(pesan))).toBe(PESAN_SIMPAN_GAGAL);
    }
    // Pesan bisnis Indonesia tanpa pola teknis tetap lolos apa adanya.
    expect(pesanError(new Error('Keterangan wajib diisi.'))).toBe(
      'Keterangan wajib diisi.',
    );
  });

  it('memakai fallback kustom dan tidak pernah mengembalikan non-Error mentah', () => {
    expect(
      pesanError(new Error('SqliteError: UNIQUE constraint failed'), PESAN_PROSES_GAGAL),
    ).toBe(PESAN_PROSES_GAGAL);
    expect(pesanError(null, PESAN_PROSES_GAGAL)).toBe(PESAN_PROSES_GAGAL);
    expect(pesanError(undefined, PESAN_PROSES_GAGAL)).toBe(PESAN_PROSES_GAGAL);
    expect(pesanError({ message: 'SQLITE_BUSY' }, PESAN_PROSES_GAGAL)).toBe(
      PESAN_PROSES_GAGAL,
    );
    expect(pesanError(42, PESAN_PROSES_GAGAL)).toBe(PESAN_PROSES_GAGAL);
    // String mentah dari catch lama juga tidak boleh lolos.
    expect(pesanError('SQLITE_BUSY: database is locked')).toBe(PESAN_SIMPAN_GAGAL);
    expect(pesanError('bukan Error object', PESAN_PROSES_GAGAL)).toBe(
      PESAN_PROSES_GAGAL,
    );
  });

  it('menyamarkan pesan kosong, terlalu panjang, dan newline berlebih', () => {
    expect(pesanError(new Error(''))).toBe(PESAN_SIMPAN_GAGAL);
    expect(pesanError(new Error('   '))).toBe(PESAN_SIMPAN_GAGAL);
    expect(pesanError(new Error('a'.repeat(401)))).toBe(PESAN_SIMPAN_GAGAL);
    expect(pesanError(new Error('baris satu\nbaris dua'))).toBe(PESAN_SIMPAN_GAGAL);
  });
});

describe('P1-12 — pesanValidasi', () => {
  it('menggabungkan pesan tanpa duplikat dan merapikan spasi', () => {
    expect(
      pesanValidasi([
        'Keterangan wajib diisi.',
        'Keterangan wajib diisi.',
        '  Nominal harus lebih dari 0.  ',
        '',
        '   ',
        'Tanggal tidak valid. Gunakan format YYYY-MM-DD dan tanggal yang benar.',
      ]),
    ).toBe(
      'Keterangan wajib diisi. Nominal harus lebih dari 0. Tanggal tidak valid. Gunakan format YYYY-MM-DD dan tanggal yang benar.',
    );
  });

  it('membatasi jumlah pesan agar kotak error tetap terbaca', () => {
    const delapan = Array.from({ length: 8 }, (_, i) => `Pesan ${i + 1}.`);
    expect(pesanValidasi(delapan, 5)).toBe(
      'Pesan 1. Pesan 2. Pesan 3. Pesan 4. Pesan 5. (dan 3 pesan lainnya)',
    );
    expect(pesanValidasi(delapan, 0)).toContain('(dan 3 pesan lainnya)');
  });

  it('mengembalikan string kosong untuk daftar kosong/non-array', () => {
    expect(pesanValidasi([])).toBe('');
    expect(pesanValidasi(null)).toBe('');
    expect(pesanValidasi(undefined)).toBe('');
  });
});
