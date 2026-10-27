// Kebijakan CSP renderer (P1-15). Modul ini murni string: dipakai plugin
// electron.vite.config.ts (dev vs build) dan diuji tanpa Electron/DOM.
//
// Produksi TIDAK memakai 'unsafe-inline' pada script-src: semua JS hasil build
// berupa file eksternal dari origin aplikasi. Dev memakai 'unsafe-inline' hanya
// untuk script karena @vitejs/plugin-react menyuntikkan preamble react-refresh
// sebagai <script type="module"> inline. Jangan longgarkan produksi demi dev.

const DIREKTIF_PRODUKSI = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
] as const;

/** CSP ketat untuk hasil build/paket. */
export const CSP_PRODUKSI = DIREKTIF_PRODUKSI.join('; ');

/** CSP dev: script inline untuk react-refresh/Vite + WebSocket untuk HMR. */
export const CSP_DEV = CSP_PRODUKSI.replace(
  "script-src 'self'",
  "script-src 'self' 'unsafe-inline'",
).replace("connect-src 'self'", "connect-src 'self' ws: wss:");

const META_CSP_RE = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;
const HEAD_RE = /<head(\s[^>]*)?>/i;
const HTML_RE = /<html(\s[^>]*)?>/i;

/** Tag meta CSP yang aman untuk disisipkan ke HTML. */
export function tagMetaCsp(policy: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

/**
 * Terapkan CSP ke dokumen HTML. Bila sudah ada meta CSP (mis. dari
 * index.html), ganti di tempat agar tidak menumpuk dua kebijakan yang saling
 * mempersempit. Bila belum ada, sisipkan sebagai anak pertama <head>.
 */
export function terapkanCsp(html: string, policy: string): string {
  const tag = tagMetaCsp(policy);
  if (META_CSP_RE.test(html)) return html.replace(META_CSP_RE, tag);

  const denganHead = html.replace(HEAD_RE, (m) => `${m}\n    ${tag}`);
  if (denganHead !== html) return denganHead;

  const denganHtml = html.replace(HTML_RE, (m) => `${m}\n<head>${tag}</head>`);
  if (denganHtml !== html) return denganHtml;

  return `${tag}\n${html}`;
}

/** Pilih kebijakan berdasarkan mode Vite: hanya 'development' yang longgar. */
export function cspUntukMode(mode: string | undefined): string {
  return mode === 'development' ? CSP_DEV : CSP_PRODUKSI;
}
