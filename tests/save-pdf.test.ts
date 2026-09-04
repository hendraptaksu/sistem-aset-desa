// Kontrak dokumen print untuk alur Simpan PDF langsung (file:save-pdf).
// wrapPrintDocument(title, body) dipakai 2 alur: Print/PDF popup dan Simpan PDF
// (hidden window + printToPDF di main).

import { describe, expect, it } from 'vitest';
import { wrapPrintDocument } from '../src/features/export/workbooks.js';

describe('wrapPrintDocument untuk Simpan PDF', () => {
  it('default: CSS A4 multi-halaman + auto-print (aliran lama tak berubah)', () => {
    const html = wrapPrintDocument('Laporan', '<table><tbody><tr><td>x</td></tr></tbody></table>');
    expect(html).toContain('@page');
    expect(html).toContain('size:A4');
    expect(html).toContain('table-header-group'); // thead diulang tiap halaman
    expect(html).toContain('window.print()');
  });

  it('autoPrint:false — tanpa script print (anti dialog nyasar di hidden window)', () => {
    const html = wrapPrintDocument('Laporan', '<p>x</p>', { autoPrint: false });
    expect(html).toContain('@page');
    expect(html).not.toContain('window.print()');
  });
});
