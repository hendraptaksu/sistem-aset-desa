// Aturan navigasi window utama (P1-15). Fungsi murni agar bisa diuji tanpa
// menjalankan Electron: hanya origin dev server aplikasi atau file renderer
// aplikasi sendiri yang boleh menjadi tujuan navigasi utama.

import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export type KonteksNavigasi = {
  /** ELECTRON_RENDERER_URL saat `electron-vite dev`; kosong pada build. */
  devUrl?: string;
  /** Path absolut out/renderer/index.html yang dimuat saat build. */
  rendererFile: string;
};

function pathSama(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  // Windows tidak membedakan huruf besar/kecil pada path.
  return process.platform === 'win32'
    ? na.toLowerCase() === nb.toLowerCase()
    : na === nb;
}

/** true hanya untuk origin dev server aplikasi atau file HTML renderer itu sendiri. */
export function urlDiizinkan(target: string, ctx: KonteksNavigasi): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }

  const devUrl = String(ctx.devUrl ?? '').trim();
  if (devUrl) {
    try {
      if (url.origin === new URL(devUrl).origin) return true;
    } catch {
      // ELECTRON_RENDERER_URL tidak valid → abaikan jalur dev.
    }
  }

  if (url.protocol !== 'file:') return false;
  try {
    return pathSama(fileURLToPath(url), ctx.rendererFile);
  } catch {
    return false;
  }
}

/**
 * AUD-17: frame pengirim IPC harus frame renderer aplikasi sendiri. Frame
 * null/asing (mis. iframe `srcdoc`, halaman eksternal, atau frame yang sudah
 * hancur) ditolak agar tidak bisa memanggil handler main.
 */
export function pengirimDiizinkan(
  senderFrame: { url?: string | null } | null | undefined,
  ctx: KonteksNavigasi,
): boolean {
  const url = senderFrame?.url;
  return typeof url === 'string' && url.length > 0 && urlDiizinkan(url, ctx);
}
