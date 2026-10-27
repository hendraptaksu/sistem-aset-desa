// AUD-21b — smoke UI Neraca Saldo tanpa Electron.
// Effect data tidak berjalan di render statis; test ini memastikan toggle mode
// tampil dan default-nya tahun berjalan, plus penjelasan laba ditahan.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NeracaSaldoTab } from '../src/renderer/components/NeracaSaldoTab.js';

describe('AUD-21b — UI Neraca Saldo', () => {
  it('menampilkan toggle mode dengan default tahun berjalan', () => {
    const html = renderToStaticMarkup(
      createElement(NeracaSaldoTab, {
        onBukaBukuBesar: () => undefined,
      }),
    );

    expect(html).toContain('role="group"');
    expect(html).toContain('Tahun berjalan');
    expect(html).toContain('Kumulatif sejak awal');
    // Tombol tahun berjalan aktif (default aman).
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('Laba ditahan sebelum periode');
  });
});
