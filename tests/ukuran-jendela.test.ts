// UI-02 — ukuran minimum & default jendela utama. Helper murni tanpa Electron
// agar nilai min/default/clamp terkunci oleh unit test.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LEBAR_JENDELA,
  DEFAULT_TINGGI_JENDELA,
  MARGIN_LAYAR_PX,
  MIN_LEBAR_JENDELA,
  MIN_TINGGI_JENDELA,
  opsiUkuranJendela,
} from '../src/main/ukuranJendela.js';

describe('UI-02 — ukuran jendela utama', () => {
  it('memakai minimum 1024×680 dan default 1240×760', () => {
    expect(MIN_LEBAR_JENDELA).toBe(1024);
    expect(MIN_TINGGI_JENDELA).toBe(680);
    expect(DEFAULT_LEBAR_JENDELA).toBe(1240);
    expect(DEFAULT_TINGGI_JENDELA).toBe(760);

    expect(opsiUkuranJendela({ width: 2560, height: 1440 })).toEqual({
      width: 1240,
      height: 760,
      minWidth: 1024,
      minHeight: 680,
    });
  });

  it('default muat di work area 1366×768 (tinggi 728 setelah taskbar)', () => {
    const opsi = opsiUkuranJendela({ width: 1366, height: 728 });

    expect(opsi.width).toBe(1240);
    expect(opsi.height).toBe(728 - MARGIN_LAYAR_PX * 2);
    expect(opsi.width).toBeLessThanOrEqual(1366 - MARGIN_LAYAR_PX * 2);
    expect(opsi.height).toBeLessThanOrEqual(728 - MARGIN_LAYAR_PX * 2);
    expect(opsi.height).toBeGreaterThanOrEqual(MIN_TINGGI_JENDELA);
    expect(opsi.minWidth).toBe(1024);
    expect(opsi.minHeight).toBe(680);
  });

  it('tidak turun di bawah minimum pada layar kecil', () => {
    expect(opsiUkuranJendela({ width: 800, height: 600 })).toEqual({
      width: 1024,
      height: 680,
      minWidth: 1024,
      minHeight: 680,
    });
  });

  it('tanpa info work area yang valid tetap memakai default', () => {
    const defaultOpsi = {
      width: 1240,
      height: 760,
      minWidth: 1024,
      minHeight: 680,
    };
    expect(opsiUkuranJendela()).toEqual(defaultOpsi);
    expect(opsiUkuranJendela({ width: Number.NaN, height: 0 })).toEqual(
      defaultOpsi,
    );
  });
});
