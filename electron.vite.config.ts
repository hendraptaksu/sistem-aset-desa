import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';
import { cspUntukMode, terapkanCsp } from './src/renderer/lib/csp';

/**
 * P1-15: suntikkan meta CSP yang berbeda untuk dev dan build.
 * - Build: `script-src 'self'` tanpa 'unsafe-inline' (CSP produksi ketat).
 * - Dev: 'unsafe-inline' hanya untuk script, karena react-refresh memakai
 *   preamble inline. Jangan sampai produksi ikut longgar.
 * `ctx.server` hanya ada saat dev server berjalan.
 */
function cspPlugin(): Plugin {
  return {
    name: 'pura-csp-html',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return terapkanCsp(html, cspUntukMode(ctx.server ? 'development' : 'production'));
      },
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/main' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // WAJIB cjs: preload ESM (.mjs) gagal dimuat sandbox Electron
    // ("Cannot use import statement outside a module") → window.api kosong.
    build: { outDir: 'out/preload', lib: { formats: ['cjs'] } },
  },
  renderer: {
    build: { outDir: 'out/renderer' },
    plugins: [cspPlugin(), react(), tailwindcss()],
  },
});
