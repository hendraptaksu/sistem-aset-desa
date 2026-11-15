// AKT-15: default periode Laba Rugi & Arus Kas = periode berjalan.
// Fokus: helper periode murni (WITA, bukan UTC), label periode, kop laporan,
// dan render statis kedua tab tanpa mengubah perhitungan laporan.
// UI-A10: komponen KontrolPeriode bersama + guard rentang terbalik seragam.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { kopPeriodeEfektif } from '../src/features/export/workbooks.js';
import { ArusKasTab } from '../src/renderer/components/ArusKasTab.js';
import { LabaRugiTab } from '../src/renderer/components/LabaRugiTab.js';
import {
  KontrolPeriode,
  nilaiPresetRentang,
} from '../src/renderer/components/KontrolPeriode.js';
import {
  ALASAN_EKSPOR_KOSONG,
  labelPeriodeHasil,
  labelPeriodeLaporan,
  rentangTerbalik,
} from '../src/renderer/lib/tampilanLaporan.js';
import { periodeBerjalan } from '../src/utils/tanggal.js';

/** 29 Okt 2026, 11:00 WITA. */
const SEKARANG = new Date('2026-10-29T03:00:00Z');

describe('AKT-15 — helper periodeBerjalan', () => {
  it('mulai 1 Januari tahun berjalan dan sampai hari ini (WITA)', () => {
    expect(periodeBerjalan(SEKARANG)).toEqual({
      mulai: '2026-01-01',
      sampai: '2026-10-29',
    });
  });

  it('mengikuti pergantian tahun WITA, bukan UTC', () => {
    // 31 Des 2025 16:30 UTC = 1 Jan 2026 00:30 WITA.
    expect(periodeBerjalan(new Date('2025-12-31T16:30:00Z'))).toEqual({
      mulai: '2026-01-01',
      sampai: '2026-01-01',
    });
    expect(
      periodeBerjalan(new Date('2025-12-31T16:30:00Z'), 'UTC'),
    ).toEqual({
      mulai: '2025-01-01',
      sampai: '2025-12-31',
    });
  });

  it('menerima epoch milidetik', () => {
    expect(periodeBerjalan(Date.parse('2026-10-29T03:00:00Z'))).toEqual({
      mulai: '2026-01-01',
      sampai: '2026-10-29',
    });
  });
});

describe('AKT-15 — label periode & kop laporan', () => {
  it('label periode berjalan dan tombol Semua tanggal', () => {
    expect(labelPeriodeLaporan('2026-01-01', '2026-10-29')).toBe(
      '1 Jan 2026 s/d 29 Okt 2026',
    );
    // "Semua tanggal" mengosongkan kedua filter -> seluruh riwayat.
    expect(labelPeriodeLaporan('', '')).toBe('seluruh riwayat');
    expect(labelPeriodeLaporan('2026-01-01', '')).toBe('1 Jan 2026 s/d akhir');
    expect(labelPeriodeLaporan('', '2026-10-29')).toBe('awal s/d 29 Okt 2026');
  });

  it('kop default memakai periode berjalan, bukan SEMUA PERIODE', () => {
    const p = periodeBerjalan(SEKARANG);
    expect(kopPeriodeEfektif(p.mulai, p.sampai)).toBe(
      'PERIODE 1 Jan 2026 s/d 29 Okt 2026',
    );
    expect(kopPeriodeEfektif('', '')).toBe('SEMUA PERIODE');
  });
});

describe('AKT-15 — render statis tab Laba Rugi & Arus Kas', () => {
  it('Laba Rugi terisi periode berjalan dan tetap punya tombol Semua tanggal', () => {
    const html = renderToStaticMarkup(
      createElement(LabaRugiTab, { sekarang: SEKARANG }),
    );

    expect(html).toContain('value="2026-01-01"');
    expect(html).toContain('value="2026-10-29"');
    expect(html).toContain(
      'Klik baris akun atau tombol panah untuk melihat jurnal pada periode ini.',
    );
    expect(html).toContain('Semua tanggal');
    expect(html).not.toContain('Periode aktif:');
    // UI-A10: preset tahun buku eksplisit di kontrol bersama.
    expect(html).toContain('Tahun berjalan (tahun buku)');
  });

  it('Arus Kas terisi periode berjalan dan tetap punya tombol Semua tanggal', () => {
    const html = renderToStaticMarkup(
      createElement(ArusKasTab, { sekarang: SEKARANG }),
    );

    expect(html).toContain('value="2026-01-01"');
    expect(html).toContain('value="2026-10-29"');
    expect(html).toContain('Periode aktif: 1 Jan 2026 s/d 29 Okt 2026.');
    expect(html).toContain('Semua tanggal');
    expect(html).not.toContain('Periode aktif: seluruh riwayat');
    // UI-A10: preset tahun buku eksplisit di kontrol bersama.
    expect(html).toContain('Tahun berjalan (tahun buku)');
  });
});

describe('UI-A10 — guard rentangTerbalik seragam', () => {
  it('sah bila salah satu atau kedua tanggal kosong (= tanpa batas)', () => {
    expect(rentangTerbalik('', '')).toBe(false);
    expect(rentangTerbalik('2026-01-01', '')).toBe(false);
    expect(rentangTerbalik('', '2026-10-29')).toBe(false);
  });

  it('sah bila mulai <= sampai (perbandingan string ISO)', () => {
    expect(rentangTerbalik('2026-01-01', '2026-01-01')).toBe(false);
    expect(rentangTerbalik('2026-01-01', '2026-10-29')).toBe(false);
  });

  it('terbalik bila mulai > sampai', () => {
    expect(rentangTerbalik('2026-10-29', '2026-01-01')).toBe(true);
    expect(rentangTerbalik('2026-12-31', '2026-01-01')).toBe(true);
  });
});

describe('UI-A10 — nilaiPresetRentang (WITA)', () => {
  it('Hari ini = rentang satu hari', () => {
    expect(nilaiPresetRentang('hari-ini', SEKARANG)).toEqual({
      mulai: '2026-10-29',
      sampai: '2026-10-29',
    });
  });

  it('Bulan ini = tanggal 1 bulan berjalan s/d hari ini', () => {
    expect(nilaiPresetRentang('bulan-ini', SEKARANG)).toEqual({
      mulai: '2026-10-01',
      sampai: '2026-10-29',
    });
  });

  it('Tahun berjalan (tahun buku) = 1 Januari s/d hari ini, sama dengan Dashboard', () => {
    // AUD-20: awal tahun buku yang didukung hanya Januari, jadi preset ini
    // identik dengan periodeBerjalan.
    expect(nilaiPresetRentang('tahun-buku', SEKARANG)).toEqual(
      periodeBerjalan(SEKARANG),
    );
  });

  it('Semua tanggal = rentang kosong (seluruh riwayat)', () => {
    expect(nilaiPresetRentang('semua', SEKARANG)).toEqual({ mulai: '', sampai: '' });
  });
});

describe('UI-A10 — render KontrolPeriode', () => {
  const rentangSah = {
    mulai: '2026-01-01',
    sampai: '2026-10-29',
    onMulai: () => undefined,
    onSampai: () => undefined,
  };

  it('mode rentang sah: tanpa kotak amber dan input tidak invalid', () => {
    const html = renderToStaticMarkup(createElement(KontrolPeriode, rentangSah));
    expect(html).toContain('Dari tanggal');
    expect(html).toContain('Sampai tanggal');
    expect(html).toContain('Tahun berjalan (tahun buku)');
    expect(html).toContain('Semua tanggal');
    expect(html).not.toContain('tidak boleh setelah');
    expect(html).not.toContain('aria-invalid');
  });

  it('mode rentang terbalik: kotak amber + aria-invalid pada kedua input', () => {
    const html = renderToStaticMarkup(
      createElement(KontrolPeriode, {
        ...rentangSah,
        mulai: '2026-10-29',
        sampai: '2026-01-01',
        namaLaporan: 'Laba Rugi',
      }),
    );
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Tanggal “Dari” tidak boleh setelah “Sampai”');
    expect(html).toContain('menampilkan Laba Rugi');
    expect(html).toContain('aria-describedby');
  });

  it('mode cutoff: preset Hari ini; cutoff kosong menampilkan peringatan', () => {
    const html = renderToStaticMarkup(
      createElement(KontrolPeriode, {
        mode: 'cutoff',
        cutoff: '',
        onCutoff: () => undefined,
      }),
    );
    expect(html).toContain('Per tanggal');
    expect(html).toContain('Hari ini');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('Isi tanggal laporan terlebih dahulu.');

    const terisi = renderToStaticMarkup(
      createElement(KontrolPeriode, {
        mode: 'cutoff',
        cutoff: '2026-10-29',
        onCutoff: () => undefined,
      }),
    );
    expect(terisi).toContain('value="2026-10-29"');
    expect(terisi).not.toContain('Isi tanggal laporan terlebih dahulu.');
  });

  it('pola manual (Dashboard): tombol Tampilkan + hint di dekatnya', () => {
    const html = renderToStaticMarkup(
      createElement(KontrolPeriode, {
        mode: 'cutoff',
        cutoff: '2026-10-29',
        onCutoff: () => undefined,
        onTerapkan: () => undefined,
        labelTerapkan: 'Tampilkan',
        sibuk: false,
      }),
    );
    expect(html).toContain('>Tampilkan</button>');
    expect(html).toContain('Ubah tanggal lalu klik');
  });

  it('pola auto: tanpa tombol Tampilkan dan tanpa hint', () => {
    const html = renderToStaticMarkup(createElement(KontrolPeriode, rentangSah));
    expect(html).not.toContain('>Tampilkan</button>');
    expect(html).not.toContain('Ubah tanggal lalu klik');
  });
});

describe('UI-A10 — label header dari data hasil & aturan ekspor kosong', () => {
  it('labelPeriodeHasil membaca data.mulai/data.sampai, bukan input', () => {
    expect(labelPeriodeHasil({ mulai: '2026-01-01', sampai: '2026-10-29' })).toBe(
      '1 Jan 2026 s/d 29 Okt 2026',
    );
    // Rentang kosong pada data hasil = seluruh riwayat.
    expect(labelPeriodeHasil({})).toBe('seluruh riwayat');
    expect(labelPeriodeHasil({ mulai: '2026-01-01' })).toBe('1 Jan 2026 s/d akhir');
  });

  it('alasan ekspor kosong tersedia dan dipakai tab laporan', () => {
    expect(ALASAN_EKSPOR_KOSONG).toContain('belum punya data');
  });
});
