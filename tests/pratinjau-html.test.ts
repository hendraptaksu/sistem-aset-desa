// P1-15 — pratinjau cetak untuk HTML laporan lama (Realisasi/Pembantu).
// Kontrak: dokumen legacy dibungkus tanpa auto-print/inline script; tombol
// Cetak berasal dari komponen parent, bukan dari dalam iframe.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { wrapPrintDocument } from '../src/features/export/workbooks.js';
import { PratinjauHtmlModal } from '../src/renderer/components/PratinjauHtmlModal.js';

const bodyLegacy =
  '<table><tbody><tr><td>Buku Pembantu</td><td>Rp 1.000</td></tr></tbody></table>';

describe('PratinjauHtmlModal (P1-15)', () => {
  it('dokumen legacy dibungkus tanpa window.print() otomatis dan tanpa script', () => {
    const html = wrapPrintDocument('Buku Pembantu', bodyLegacy, {
      autoPrint: false,
    });
    expect(html).toContain('Buku Pembantu');
    expect(html).toContain('@page');
    expect(html).toContain('<style>');
    expect(html).not.toContain('window.print()');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick=');
  });

  it('modal menampilkan iframe srcDoc + tombol Cetak/Tutup dari parent', () => {
    const markup = renderToStaticMarkup(
      createElement(PratinjauHtmlModal, {
        judul: 'Buku Pembantu',
        body: bodyLegacy,
        onClose: () => {},
      }),
    );
    expect(markup).toContain('Pratinjau Cetak');
    expect(markup).toContain('srcDoc=');
    expect(markup).toContain('sandbox="allow-same-origin allow-modals"');
    expect(markup).not.toContain('allow-scripts');
    expect(markup).toContain('Cetak');
    expect(markup).toContain('Tutup');
    expect(markup).not.toContain('window.print()');
    expect(markup).not.toContain('<script');
  });
});
