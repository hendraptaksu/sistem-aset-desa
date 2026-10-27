import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { config as loadEnv } from 'dotenv';
import { basename, isAbsolute, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type Database from 'better-sqlite3';
import { openDb } from '../db/database.js';
import { seedDev } from '../db/seed-dev.js';
import { autoBackupHarian, backupPraUpgrade } from '../features/export/export.js';
import { registerIpc, type IpcDeps } from './ipc.js';
import { mulaiBackupPeriodik } from './backupPeriodik.js';
import { tentukanLokasiData, type LokasiData } from './lokasiData.js';
import { urlDiizinkan } from './windowSecurity.js';

let db: Database.Database;
let win: BrowserWindow | null = null;
let lokasi: LokasiData | null = null;
let hentikanBackupPeriodik: (() => void) | null = null;

/** Hentikan interval backup (idempoten); dipanggil saat app quit. */
function hentikanPenjadwalBackup(): void {
  hentikanBackupPeriodik?.();
  hentikanBackupPeriodik = null;
}

// Dev saja: baca .env di root repo agar PURA_DB bisa di-override.
// Production: installer memakai userData/data/pura.db; build portable memakai
// <folder exe>/data/pura.db (P2-8) lewat PORTABLE_EXECUTABLE_DIR.
if (!app.isPackaged) loadEnv();

/** Lokasi final (P2-8); dihitung sekali setelah Electron siap. */
function lokasiData(): LokasiData {
  if (!lokasi) {
    lokasi = tentukanLokasiData({
      userDataDir: app.getPath('userData'),
      portableDir: process.env.PORTABLE_EXECUTABLE_DIR,
      overrideDbPath: process.env.PURA_DB,
    });
    mkdirSync(lokasi.dataDir, { recursive: true });
  }
  return lokasi;
}

function dbPath(): string {
  return lokasiData().dbPath;
}

/**
 * Render HTML laporan di hidden window lalu tulis PDF ke `filePath`.
 * Implementasi Electron sengaja tetap di main; `src/main/ipc.ts` hanya
 * memanggil lewat `IpcDeps.printPdf` agar bisa diuji tanpa Electron (P2-7).
 */
async function printPdfKeFile(
  html: string,
  filePath: string,
  landscape = false,
): Promise<void> {
  let pdfWin: BrowserWindow | null = null;
  try {
    pdfWin = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    const pdf = await pdfWin.webContents.printToPDF({
      pageSize: 'A4',
      landscape,
      printBackground: true,
      // Margin diatur oleh @page + padding .halaman pada HTML paginator,
      // supaya PDF identik dengan pratinjau (tidak dobel margin).
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });
    writeFileSync(filePath, pdf);
  } finally {
    pdfWin?.close();
  }
}

/**
 * Save dialog harus menerima path absolut. Nama file saja membuat macOS
 * memakai folder terakhir panel (di dev, folder itu dipakai bersama semua
 * aplikasi Electron karena bundle ID `com.github.Electron`). Arahkan default
 * ke Documents supaya export tidak mendarat di folder project lain.
 */
function defaultPathSimpan(path?: string): string | undefined {
  if (!path) return undefined;
  return isAbsolute(path) ? path : join(app.getPath('documents'), basename(path));
}

/** Ketergantungan nyata main process untuk seluruh handler IPC (P2-7). */
function buatIpcDeps(): IpcDeps {
  return {
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    db: () => db,
    setDb: (d) => {
      db = d;
    },
    dbPath,
    dialog: {
      showSaveDialog: (opts) => {
        const opsi = { ...opts, defaultPath: defaultPathSimpan(opts.defaultPath) };
        // Lampirkan ke window utama agar tampil sebagai sheet modal; user
        // memilih folder tujuan dan nama file langsung di dialog ini.
        return win
          ? dialog.showSaveDialog(win, opsi)
          : dialog.showSaveDialog(opsi);
      },
      showOpenDialog: (opts) => dialog.showOpenDialog(opts),
    },
    writeFile: (path, data) => writeFileSync(path, data),
    printPdf: printPdfKeFile,
    openPath: (path) => shell.openPath(path),
    lampiranDir: () => lokasiData().attachmentsDir,
    lokasiData,
  };
}

/**
 * Lokasi file preload berbeda antara dev dan hasil build.
 * electron-vite mengeluarkan `out/preload/index.mjs`, sedangkan Electron
 * butuh CJS (`index.js`/`.cjs`) — lihat `lib.formats` di electron.vite.config.ts.
 * Cari kandidat pertama yang ada agar window.api selalu termuat.
 */
function preloadPath(): string {
  const candidates = [
    join(__dirname, '../preload/index.cjs'),
    join(__dirname, '../preload/index.js'),
    join(__dirname, '../preload/index.mjs'),
    join(process.cwd(), 'out/preload/index.cjs'),
    join(process.cwd(), 'out/preload/index.js'),
    join(process.cwd(), 'out/preload/index.mjs'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function createWindow(): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const rendererFile = join(__dirname, '../renderer/index.html');

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Keuangan Pura Dalem Puri',
    webPreferences: {
      preload: preloadPath(),
      // P1-15: preload hanya memakai contextBridge + ipcRenderer sehingga aman
      // dijalankan sandbox; preload tetap CJS sesuai catatan electron-vite.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Cegah window baru (target=_blank/window.open) dari renderer.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Hanya izinkan navigasi ke dev server aplikasi atau file renderer sendiri.
  win.webContents.on('will-navigate', (event, url) => {
    if (!urlDiizinkan(url, { devUrl, rendererFile })) event.preventDefault();
  });

  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(rendererFile);
  }
  win.on('closed', () => (win = null));
}

function mulaiAplikasi(): void {
  // Instance kedua tidak boleh membuka window baru: fokus/restore window utama.
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });

  void app.whenReady().then(() => {
    const lokasiAktif = lokasiData();
    const pathDb = lokasiAktif.dbPath;
    // Sebelum migrasi/reset skema: simpan DB lama (best-effort) agar tidak hilang.
    try {
      const p = backupPraUpgrade(pathDb, lokasiAktif.backupsDir);
      if (p) console.log(`[backup-upgrade] ${p}`);
    } catch (e) {
      console.warn('[backup-upgrade] gagal:', String(e));
    }
    db = openDb(pathDb);
    // Auto-backup harian 1x sehari (best-effort, jangan blokir app bila gagal).
    try {
      const p = autoBackupHarian(db, lokasiAktif.backupsDir, 7);
      console.log(`[backup-auto] ${p}`);
    } catch (e) {
      console.warn('[backup-auto] gagal:', String(e));
    }
    // AUD-13: app yang dibiarkan terbuka tetap backup saat tanggal berganti.
    // Interval ringan + guard di modul; jangan pernah biarkan timer menahan quit.
    hentikanPenjadwalBackup();
    hentikanBackupPeriodik = mulaiBackupPeriodik({
      db: () => db,
      dirBackup: () => lokasiData().backupsDir,
      onBackup: (p) => console.log(`[backup-auto] ${p}`),
      onError: (e) => console.warn('[backup-auto] gagal:', String(e)),
    });
    // Dev seeder: isi data dummy bervolume untuk uji laporan multi-halaman.
    // Hanya dev (!isPackaged) + flag .env; seedDev() hanya jalan bila DB kosong.
    if (!app.isPackaged && process.env.PURA_SEED_DEV === 'true') {
      const n = seedDev(db);
      if (n > 0) console.log(`[seed-dev] ${n} baris transaksi dummy dimasukkan.`);
    }
    registerIpc(buatIpcDeps());
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Bersihkan interval backup agar proses main bisa berhenti normal.
  app.on('before-quit', hentikanPenjadwalBackup);
  app.on('will-quit', hentikanPenjadwalBackup);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

// Wajib sebelum whenReady: instance kedua langsung keluar dan tidak mendaftar
// IPC/window apa pun. Instance pertama menerima event `second-instance`.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  mulaiAplikasi();
}
