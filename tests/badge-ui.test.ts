// UI-18: tone `amber` harus benar-benar kuning, bukan hijau seperti sukses.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge } from '../src/renderer/components/ui.js';

function html(tone: 'stone' | 'green' | 'amber' | 'red'): string {
  return renderToStaticMarkup(createElement(Badge, { tone, children: 'Status' }));
}

describe('Badge tone', () => {
  it('memakai warna amber untuk peringatan/koreksi, bukan emerald', () => {
    const hasil = html('amber');
    expect(hasil).toContain('bg-amber-100');
    expect(hasil).toContain('text-amber-800');
    expect(hasil).not.toContain('emerald');
  });

  it('tidak mengubah tone green, red, dan stone', () => {
    expect(html('green')).toContain('bg-green-100 text-green-800');
    expect(html('red')).toContain('bg-red-100 text-red-800');
    expect(html('stone')).toContain('bg-stone-100 text-stone-700');
  });
});
