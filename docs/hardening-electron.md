# Hardening Electron (P1-15)

Perubahan ini menjaga aplikasi tetap satu instance, memblokir window baru, dan
memasang CSP produksi yang ketat tanpa merusak alur dev.

## 1. Single instance

- `app.requestSingleInstanceLock()` dipanggil **sebelum** `app.whenReady()`.
  Proses kedua langsung `app.quit()` dan tidak membuat window, DB, atau handler IPC.
- Instance pertama menerima event `second-instance`: window yang ada di-restore
  (bila minimize) lalu `show()` + `focus()`. Tidak ada window kedua.

### Cara uji manual

1. `npm run build`
2. Buka terminal 1: `npx electron .` → aplikasi dan satu window muncul.
3. Biarkan window terbuka. Buka terminal 2: `npx electron .`
4. Hasil yang benar: proses terminal 2 langsung selesai; window di terminal 1
   muncul ke depan/fokus; tidak ada window baru.
5. Ulangi dengan window pertama di-minimize → window harus restore + fokus.

Untuk paket Windows: jalankan `Keuangan Pura Dalem Puri.exe` dua kali
(termasuk versi portable) dan periksa hasil yang sama.

Catatan dev: `npm run dev` menjalankan satu instance Electron. Menjalankan
`npm run dev` kedua kali akan membuat proses Electron kedua keluar karena kunci
instance; hentikan dev server lama lebih dulu bila ingin memulai ulang bersih.

## 2. Window hardening

`createWindow()` memakai:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true` (aman: preload hanya `contextBridge` + `ipcRenderer`, CJS)
- `setWindowOpenHandler(() => ({ action: 'deny' }))`
- `will-navigate` hanya mengizinkan origin `ELECTRON_RENDERER_URL` (dev) atau
  file `out/renderer/index.html` (build). URL lain di-`preventDefault()`.
- Semua handler IPC (`registerIpc`) memvalidasi `event.senderFrame.url` dengan
  aturan yang sama. Frame asing, iframe `srcdoc`, atau `senderFrame` null
  ditolak sebelum handler menyentuh DB/dialog.

Cara uji blokir window baru: dari DevTools renderer jalankan
`window.open('https://example.com')` → harus mengembalikan `null`/tidak membuka
window. Navigasi paksa ke situs luar juga harus ditolak.

## 3. CSP dev vs produksi

- Sumber: `src/renderer/index.html` (default produksi).
- Plugin `pura-csp-html` di `electron.vite.config.ts` mengganti meta CSP:
  - **dev** (`ctx.server` ada): `script-src 'self' 'unsafe-inline'` agar
    preamble react-refresh Vite tidak diblokir.
  - **build**: `script-src 'self'` **tanpa** `'unsafe-inline'`.
- Logika murni ada di `src/renderer/lib/csp.ts` dan diuji di `tests/csp.test.ts`.

Periksa hasil build:

```bash
npm run build
grep -n "Content-Security-Policy" out/renderer/index.html
```

CSP produksi yang diharapkan:

```text
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-src 'self' data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'
```

`ws:`/`wss:` hanya ditambahkan pada CSP dev untuk HMR Vite.

Pratinjau cetak memakai iframe `srcDoc` dengan
`sandbox="allow-same-origin allow-modals"`: `allow-same-origin` agar parent bisa
memanggil `contentWindow.print()`, `allow-modals` agar dialog cetak tidak
diblokir Chromium. Script/form/popup tetap dinonaktifkan. `frame-src` dan
`style-src` di atas mengizinkan pratinjau; dokumen cetak tidak memuat inline
script/auto-print.

## 4. Catatan untuk P2-8 (SOP operator)

- Operator cukup membuka aplikasi **sekali**. Bila terasa "tidak terbuka",
  cek taskbar/dock: kemungkinan window lama hanya ter-minimize dan instance
  kedua sudah memfokuskannya.
- Semua cetak lewat **Pratinjau Cetak** → periksa halaman → **Cetak** atau
  **Simpan PDF**. Tidak ada window popup cetak terpisah.
- Jangan menutup aplikasi dari Task Manager saat backup/restore berjalan.
