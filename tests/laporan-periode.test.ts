// AKT-15: default periode Laba Rugi & Arus Kas = periode berjalan.
// Fokus: helper periode murni (WITA, bukan UTC), label periode, kop laporan,
// dan render statis kedua tab tanpa mengubah perhitungan laporan.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { kopPeriodeEfektif } from '../src/features/export/workbooks.js';
import { ArusKasTab } from '../src/renderer/components/ArusKasTab.js';
import { LabaRugiTab } from '../src/renderer/components/LabaRugiTab.js';
import { labelPeriodeLaporan } from '../src/renderer/lib/tampilanLaporan.js';
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
    expect(html).toContain('Periode aktif: 1 Jan 2026 s/d 29 Okt 2026.');
    expect(html).toContain('Semua tanggal');
    expect(html).not.toContain('Periode aktif: seluruh riwayat');
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
  });
});
