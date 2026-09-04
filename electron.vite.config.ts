import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

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
    plugins: [react(), tailwindcss()],
  },
});
