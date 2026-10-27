// P1-15 — aturan `will-navigate` window utama. Fungsi murni tanpa Electron.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  pengirimDiizinkan,
  urlDiizinkan,
} from '../src/main/windowSecurity.js';

const rendererFile = join('/tmp', 'pura', 'out', 'renderer', 'index.html');

describe('will-navigate (P1-15)', () => {
  it('dev: hanya origin ELECTRON_RENDERER_URL yang diizinkan', () => {
    const ctx = { devUrl: 'http://localhost:5173', rendererFile };
    expect(urlDiizinkan('http://localhost:5173/', ctx)).toBe(true);
    expect(urlDiizinkan('http://localhost:5173/index.html#bagian', ctx)).toBe(
      true,
    );
    expect(urlDiizinkan('https://localhost:5173/', ctx)).toBe(false);
    expect(urlDiizinkan('http://localhost:5174/', ctx)).toBe(false);
    expect(urlDiizinkan('https://contoh.test/', ctx)).toBe(false);
  });

  it('build: hanya file renderer aplikasi sendiri', () => {
    const ctx = { rendererFile };
    expect(urlDiizinkan(pathToFileURL(rendererFile).href, ctx)).toBe(true);
    expect(
      urlDiizinkan(
        pathToFileURL(join('/tmp', 'pura', 'out', 'renderer', 'lain.html'))
          .href,
        ctx,
      ),
    ).toBe(false);
    expect(urlDiizinkan('file:///etc/passwd', ctx)).toBe(false);
    expect(urlDiizinkan('https://contoh.test/', ctx)).toBe(false);
    expect(urlDiizinkan('about:blank', ctx)).toBe(false);
    expect(urlDiizinkan('bukan-url', ctx)).toBe(false);
  });
});

describe('AUD-17 — validasi frame pengirim IPC', () => {
  it('menerima frame renderer aplikasi (build dan dev)', () => {
    expect(
      pengirimDiizinkan(
        { url: pathToFileURL(rendererFile).href },
        { rendererFile },
      ),
    ).toBe(true);
    expect(
      pengirimDiizinkan(
        { url: 'http://localhost:5173/#/jurnal' },
        { devUrl: 'http://localhost:5173', rendererFile },
      ),
    ).toBe(true);
  });

  it('menolak frame asing, iframe srcdoc, URL kosong, dan senderFrame null', () => {
    const ctx = { devUrl: 'http://localhost:5173', rendererFile };
    expect(
      pengirimDiizinkan({ url: 'https://contoh.test/' }, ctx),
    ).toBe(false);
    expect(
      pengirimDiizinkan({ url: 'http://localhost:5174/' }, ctx),
    ).toBe(false);
    expect(pengirimDiizinkan({ url: 'about:srcdoc' }, ctx)).toBe(false);
    expect(
      pengirimDiizinkan(
        { url: pathToFileURL(join('/tmp', 'pura', 'out', 'renderer', 'lain.html')).href },
        ctx,
      ),
    ).toBe(false);
    expect(pengirimDiizinkan({ url: '' }, ctx)).toBe(false);
    expect(pengirimDiizinkan({}, ctx)).toBe(false);
    expect(pengirimDiizinkan(null, ctx)).toBe(false);
    expect(pengirimDiizinkan(undefined, ctx)).toBe(false);
  });
});
