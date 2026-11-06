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

/**
 * T2.9: DevTools hanya untuk mode dev. `devUrl` hanya diisi
 * `ELECTRON_RENDERER_URL` saat `electron-vite dev`, sehingga build produksi
 * (termasuk build portable) mendapat `devTools: false`.
 */
export function opsiDevTools(devUrl?: string): { devTools: boolean } {
  return { devTools: Boolean(String(devUrl ?? '').trim()) };
}

/** Bentuk minimal input `before-input-event` Electron yang dibutuhkan. */
export type InputPapanKetik = {
  type?: string;
  key?: string;
  control?: boolean;
  meta?: boolean;
  alt?: boolean;
  shift?: boolean;
};

/**
 * T2.9: shortcut pembuka DevTools yang harus diblokir di produksi.
 * Hanya `keyDown` agar tidak memblokir keyUp dan tidak menelan shortcut lain
 * seperti Ctrl+Shift+C (copy) atau Cmd+Alt+panah (navigasi kata).
 */
export function shortcutDevTools(input: InputPapanKetik): boolean {
  if (input?.type !== 'keyDown') return false;
  const key = String(input.key ?? '').toLowerCase();
  const ctrl = Boolean(input.control);
  const meta = Boolean(input.meta);
  const alt = Boolean(input.alt);
  const shift = Boolean(input.shift);

  if (key === 'f12') return true;
  if (key !== 'i') return false;

  // Ctrl+Shift+I (Windows/Linux), Cmd+Shift+I (macOS).
  if (shift && !alt && (ctrl || meta)) return true;
  // Cmd+Alt+I (macOS), Ctrl+Alt+I (Windows/Linux).
  if (alt && !shift && (ctrl || meta)) return true;
  return false;
}

/** Item menu minimal yang cukup untuk `Menu.buildFromTemplate` Electron. */
export type ItemMenuProduksi = {
  role?: string;
  label?: string;
  accelerator?: string;
  type?: string;
  submenu?: ItemMenuProduksi[];
};

/**
 * T2.9: template menu produksi tanpa `viewMenu`/`toggleDevTools`. Menu default
 * Electron menyertakan Toggle Developer Tools; template ini mempertahankan
 * menu aplikasi, edit (undo/cut/copy/paste/select all), dan window agar
 * pengguna tetap bisa bekerja normal.
 */
export function templateMenuProduksi(): ItemMenuProduksi[] {
  const template: ItemMenuProduksi[] = [];

  if (process.platform === 'darwin') template.push({ role: 'appMenu' });

  template.push({
    label: 'File',
    submenu: process.platform === 'darwin'
      ? [{ role: 'close' }]
      : [{ role: 'quit' }],
  });
  // Menu edit ditulis eksplisit agar tidak mewarisi item DevTools dan mudah
  // diuji: copy/paste tetap tersedia untuk pekerjaan operator.
  template.push({
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ],
  });
  template.push({ role: 'windowMenu' });

  return template;
}
