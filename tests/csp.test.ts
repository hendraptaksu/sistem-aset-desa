// P1-15 — kontrak CSP renderer. Fungsi murni, tanpa Electron/DOM.
// Produksi wajib ketat; dev boleh longgar HANYA untuk script inline
// (react-refresh) supaya `electron-vite dev` tetap jalan.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CSP_DEV,
  CSP_PRODUKSI,
  cspUntukMode,
  terapkanCsp,
} from '../src/renderer/lib/csp.js';

function direktif(policy: string, nama: string): string | undefined {
  return policy
    .split(';')
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${nama} `));
}

describe('CSP renderer (P1-15)', () => {
  it('produksi: script-src hanya self, tanpa unsafe-inline', () => {
    expect(CSP_PRODUKSI).toContain("default-src 'self'");
    expect(direktif(CSP_PRODUKSI, 'script-src')).toBe("script-src 'self'");
    expect(CSP_PRODUKSI).toContain("style-src 'self' 'unsafe-inline'");
    expect(CSP_PRODUKSI).toContain("img-src 'self' data: blob:");
    expect(CSP_PRODUKSI).toContain("font-src 'self' data:");
    expect(CSP_PRODUKSI).toContain("connect-src 'self' ws: wss:");
    expect(CSP_PRODUKSI).toContain("frame-src 'self' data: blob:");
    expect(CSP_PRODUKSI).toContain("object-src 'none'");
    expect(CSP_PRODUKSI).toContain("base-uri 'none'");
    expect(CSP_PRODUKSI).toContain("form-action 'none'");
  });

  it('dev: inline script diizinkan, produksi tidak ikut longgar', () => {
    expect(direktif(CSP_DEV, 'script-src')).toBe(
      "script-src 'self' 'unsafe-inline'",
    );
    expect(direktif(CSP_PRODUKSI, 'script-src')).toBe("script-src 'self'");
    expect(cspUntukMode('development')).toBe(CSP_DEV);
    expect(cspUntukMode('production')).toBe(CSP_PRODUKSI);
    expect(cspUntukMode(undefined)).toBe(CSP_PRODUKSI);
    expect(cspUntukMode('build')).toBe(CSP_PRODUKSI);
  });

  it('terapkanCsp menyisipkan meta di head dan tidak menduplikasi', () => {
    const asli =
      '<!doctype html><html><head><meta charset="UTF-8"><title>x</title></head><body></body></html>';
    const sekali = terapkanCsp(asli, CSP_PRODUKSI);
    expect(sekali).toContain('http-equiv="Content-Security-Policy"');
    expect(sekali).toContain(CSP_PRODUKSI);
    expect(sekali.match(/Content-Security-Policy/g)).toHaveLength(1);

    const dua = terapkanCsp(sekali, CSP_DEV);
    expect(dua.match(/Content-Security-Policy/g)).toHaveLength(1);
    expect(dua).toContain(CSP_DEV);
    expect(dua).not.toContain(CSP_PRODUKSI);
  });

  it('index.html sumber sudah memuat meta CSP', () => {
    const html = readFileSync(
      join(process.cwd(), 'src/renderer/index.html'),
      'utf8',
    );
    expect(html).toMatch(/http-equiv=["']Content-Security-Policy["']/);
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("script-src 'self'");
  });
});
