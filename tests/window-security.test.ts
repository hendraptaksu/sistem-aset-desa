// P1-15 — aturan `will-navigate` window utama. Fungsi murni tanpa Electron.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  opsiDevTools,
  pengirimDiizinkan,
  shortcutDevTools,
  templateMenuProduksi,
  urlDiizinkan,
  type ItemMenuProduksi,
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

// T2.9 — DevTools hanya untuk dev. Semua helper murni, tanpa Electron.
describe('T2.9 — DevTools nonaktif di build produksi', () => {
  it('opsiDevTools: true di dev, false di produksi/kosong', () => {
    expect(opsiDevTools('http://localhost:5173')).toEqual({ devTools: true });
    expect(opsiDevTools(' http://localhost:5173 ')).toEqual({ devTools: true });
    expect(opsiDevTools()).toEqual({ devTools: false });
    expect(opsiDevTools('')).toEqual({ devTools: false });
    expect(opsiDevTools('   ')).toEqual({ devTools: false });
  });

  it('shortcutDevTools: F12, Ctrl+Shift+I, dan Cmd+Alt+I diblokir', () => {
    expect(shortcutDevTools({ type: 'keyDown', key: 'F12' })).toBe(true);
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'I', control: true, shift: true }),
    ).toBe(true);
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'I', meta: true, alt: true }),
    ).toBe(true);
    // Varian lain yang lazim membuka DevTools.
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'i', meta: true, shift: true }),
    ).toBe(true);
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'i', control: true, alt: true }),
    ).toBe(true);
  });

  it('shortcutDevTools: shortcut lain dan keyUp tidak diblokir', () => {
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'C', control: true, shift: true }),
    ).toBe(false);
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'ArrowLeft', meta: true, alt: true }),
    ).toBe(false);
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'I', control: true }),
    ).toBe(false);
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'I', meta: true }),
    ).toBe(false);
    expect(
      shortcutDevTools({ type: 'keyDown', key: 'F5', control: true }),
    ).toBe(false);
    expect(shortcutDevTools({ type: 'keyUp', key: 'F12' })).toBe(false);
    expect(
      shortcutDevTools({ type: 'keyUp', key: 'I', control: true, shift: true }),
    ).toBe(false);
    expect(shortcutDevTools({ key: 'F12' })).toBe(false);
    expect(shortcutDevTools({ type: 'keyDown' })).toBe(false);
  });

  it('templateMenuProduksi: tanpa role devtools, edit/copy/paste tetap ada', () => {
    const template = templateMenuProduksi();
    const roles: string[] = [];
    const kumpulkan = (items: ItemMenuProduksi[]): void => {
      for (const item of items) {
        if (item.role) roles.push(item.role);
        if (item.submenu) kumpulkan(item.submenu);
      }
    };
    kumpulkan(template);

    expect(roles).not.toContain('toggleDevTools');
    expect(roles).not.toContain('viewMenu');
    expect(roles).not.toContain('toggleDevToolsMenu');
    expect(roles).toContain('copy');
    expect(roles).toContain('paste');
    expect(roles).toContain('cut');
    expect(roles).toContain('undo');

    // Tidak ada label View/Developer Tools yang bisa membuka DevTools.
    const label = JSON.stringify(template).toLowerCase();
    expect(label).not.toContain('developertools');
    expect(label).not.toContain('toggle devtools');
  });
});
