// AUD-34 — fallback error boundary dan log console yang aman.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ErrorBoundary,
  PESAN_ERROR_RENDERER,
  TampilanError,
  pesanErrorRenderer,
} from '../src/renderer/components/ErrorBoundary.js';

describe('AUD-34 — ErrorBoundary renderer', () => {
  it('menampilkan pesan ramah dan tombol "Muat ulang", bukan layar kosong', () => {
    const html = renderToStaticMarkup(
      createElement(TampilanError, { onMuatUlang: () => {} }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Tampilan bermasalah');
    expect(html).toContain(PESAN_ERROR_RENDERER);
    expect(html).toContain('Data yang sudah tersimpan tetap aman');
    expect(html).toContain('Muat ulang');
  });

  it('menyimpan error ke state turunan React', () => {
    const err = new Error('rusak');
    expect(ErrorBoundary.getDerivedStateFromError(err).error).toBe(err);

    const bukanError = ErrorBoundary.getDerivedStateFromError('rusak').error;
    expect(bukanError).toBeInstanceOf(Error);
    expect(bukanError?.message).toBe('rusak');
  });

  it('mencatat error ke console dengan satu baris dan tanpa PIN', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const boundary = new ErrorBoundary({ children: null });
      boundary.componentDidCatch(new Error('PIN: 123456 gagal'), {
        componentStack: '\n    at App\n    at Root',
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const pesan = String(spy.mock.calls[0]?.[0] ?? '');
      expect(pesan).toContain('[renderer] error tak tertangani');
      expect(pesan).toContain('komponen: at App at Root');
      expect(pesan).not.toContain('123456');
      expect(pesan).not.toMatch(/[\r\n]/);
    } finally {
      spy.mockRestore();
    }
  });

  it('meredaksi hash panjang pada pesan error renderer', () => {
    const hash = 'b'.repeat(64);
    const pesan = pesanErrorRenderer(new Error(`hash=${hash}`), null);
    expect(pesan).not.toContain(hash);
    expect(pesan).toContain('[disunting]');
    expect(pesan).not.toMatch(/[\r\n]/);
  });
});
