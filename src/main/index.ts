import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  screen,
  shell,
} from 'electron';
import { config as loadEnv } from 'dotenv';
import { basename, isAbsolute, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type Database from 'better-sqlite3';
import { IDLE_DEFAULT_MENIT } from '../core/pin.js';
import { openDb } from '../db/database.js';
import { getIdleMenit } from '../db/repository.js';
import { seedDev } from '../db/seed-dev.js';
import { autoBackupHarian, backupPraUpgrade } from '../features/export/export.js';
import { registerIpc, type IpcDeps } from './ipc.js';
import { auditIntegritasSaatMulai } from './auditAwal.js';
import { mulaiBackupPeriodik } from './backupPeriodik.js';
import { buatLoggerApp, type LoggerApp } from './logApp.js';
import {
  INTERVAL_AUTO_KUNCI_MS,
  kunciLagi,
  perluKunciOtomatis,
  sesi,
} from './kunci.js';
import { tentukanLokasiData, type LokasiData } from './lokasiData.js';
import {
  aksiPemulihanDariRespons,
  bukaDbDenganPemulihan,
  JUDUL_PEMULIHAN_DB,
  PESAN_GAGAL_BUKA_DB,
  pesanGagalBukaDb,
  TOMBOL_BUKA_BACKUP,
  TOMBOL_COBA_LAGI,
  TOMBOL_KELUAR,
  type AksiPemulihanDb,
} from './pemulihanDb.js';
import { opsiUkuranJendela } from './ukuranJendela.js';
import { urlDiizinkan } from './windowSecurity.js';

let db: Database.Database;
let win: BrowserWindow | null = null;
let lokasi: LokasiData | null = null;
let hentikanBackupPeriodik: (() => void) | null = null;
let hentikanAutoKunci: (() => void) | null = null;
let logApp: LoggerApp | null = null;

/**
 * AUD-34: logger dibuat lazy agar error sebelum `app.whenReady()` tetap
 * tercatat. Kegagalan menyiapkan file log tidak boleh menghalangi aplikasi.
 */
function loggerMain(): LoggerApp | null {
  if (logApp) return logApp;
  try {
    logApp = buatLoggerApp({ userDataDir: app.getPath('userData') });
  } catch (e) {
    console.error('[log] gagal menyiapkan file log:', String(e));
    logApp = null;
  }
  return logApp;
}

/** Hentikan interval backup (idempoten); dipanggil saat app quit. */
function hentikanPenjadwalBackup(): void {
  hentikanBackupPeriodik?.();
  hentikanBackupPeriodik = null;
}

/**
 * AUD-18: keputusan idle ditegakkan di main. Renderer bisa freeze/di-pause,
 * tetapi interval ini tetap berjalan dan mengunci sesi bila melewati batas.
 * Timer di-`unref()` dan dibersihkan saat quit agar tidak menahan proses.
 */
function mulaiAutoKunci(): () => void {
  let dihentikan = false;
  const timer = setInterval(() => {
    if (dihentikan || !sesi.terbuka) return;
    try {
      const menit = getIdleMenit(db, IDLE_DEFAULT_MENIT);
      if (!perluKunciOtomatis(Date.now(), menit)) return;
      kunciLagi();
      loggerMain()?.info('[auto-lock] sesi dikunci karena idle.');
    } catch (e) {
      loggerMain()?.warn('[auto-lock] gagal memeriksa idle', e);
    }
  }, INTERVAL_AUTO_KUNCI_MS);
  timer.unref?.();

  return () => {
    dihentikan = true;
    clearInterval(timer);
  };
}

function hentikanPenjadwalKunci(): void {
  hentikanAutoKunci?.();
  hentikanAutoKunci = null;
}

/** Suspend/lock-screen OS = sesi tidak boleh tetap terbuka saat laptop dibuka lagi. */
function kunciSaatSistemTidur(): void {
  kunciLagi();
}

function pasangPemicuKunciSistem(): void {
  powerMonitor.on('suspend', kunciSaatSistemTidur);
  powerMonitor.on('lock-screen', kunciSaatSistemTidur);
}

function lepasPemicuKunciSistem(): void {
  powerMonitor.removeListener('suspend', kunciSaatSistemTidur);
  powerMonitor.removeListener('lock-screen', kunciSaatSistemTidur);
}

function bersihkanPenjadwal(): void {
  hentikanPenjadwalBackup();
  hentikanPenjadwalKunci();
}

// Dev saja: baca .env di root repo agar PURA_DB bisa di-override.
// Production: installer memakai userData/data/pura.db; build portable memakai
// <folder exe>/data/pura.db (P2-8) lewat PORTABLE_EXECUTABLE_DIR.
if (!app.isPackaged) loadEnv();

// AUD-34: error tak tertangani di main wajib meninggalkan jejak di
// `<userData>/logs/app.log`. Logger juga menyalin ke console; listener ini
// sengaja tidak melempar ulang agar aplikasi tidak langsung mati di tengah
// pekerjaan operator — langkah pemulihan tetap menjadi keputusan pengguna.
process.on('uncaughtException', (error) => {
  loggerMain()?.error('uncaughtException', error);
});
process.on('unhandledRejection', (reason) => {
  loggerMain()?.error('unhandledRejection', reason);
});

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

/**
 * AUD-16: layar pemulihan tanpa window. Dialog ini tampil saat database gagal
 * dibuka, sebelum window utama dibuat, sehingga operator tetap punya UI untuk
 * membuka backup, mencoba lagi, atau keluar.
 */
async function tanyaPemulihanDb(
  lokasiAktif: LokasiData,
  error: unknown,
): Promise<AksiPemulihanDb> {
  app.focus({ steal: true });
  const hasil = await dialog.showMessageBox({
    type: 'error',
    title: JUDUL_PEMULIHAN_DB,
    message: PESAN_GAGAL_BUKA_DB,
    detail: pesanGagalBukaDb(error, lokasiAktif.dbPath),
    buttons: [TOMBOL_BUKA_BACKUP, TOMBOL_COBA_LAGI, TOMBOL_KELUAR],
    defaultId: 1,
    cancelId: 2,
    noLink: true,
  });
  return aksiPemulihanDariRespons(hasil.response);
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
    lokasiData,
    log: loggerMain() ?? undefined,
    // AUD-17: frame pengirim yang sah = renderer build atau dev origin.
    pengirim: {
      devUrl: process.env['ELECTRON_RENDERER_URL'],
      rendererFile: join(__dirname, '../renderer/index.html'),
    },
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
    // UI-02: default 1240×760 di-clamp ke work area layar aktif agar muat di
    // 1366×768 (Windows memotong taskbar); minimum 1024×680 menjaga layout.
    ...opsiUkuranJendela(screen.getPrimaryDisplay().workAreaSize),
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
  // AUD-34: crash/unresponsive renderer juga perlu jejak di file log.
  win.webContents.on('render-process-gone', (_event, details) => {
    loggerMain()?.error(
      `[renderer] proses renderer berhenti (${details.reason}, exitCode ${details.exitCode})`,
    );
  });
  win.on('unresponsive', () => loggerMain()?.warn('[window] halaman tidak merespons'));

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

  void app.whenReady().then(async () => {
    const lokasiAktif = lokasiData();
    const pathDb = lokasiAktif.dbPath;
    const log = loggerMain();
    log?.info(
      `Aplikasi mulai v${app.getVersion()} (mode ${lokasiAktif.mode}); log: ${log.file}`,
    );
    // Backup pra-upgrade cukup sekali; retry hanya membuka ulang database.
    let backupPraUpgradeDilakukan = false;
    const dbDibuka = await bukaDbDenganPemulihan({
      buka: () => {
        // Sebelum membuka DB: simpan DB lama (best-effort) agar tidak hilang.
        // Kegagalan backup tidak boleh menghalangi percobaan buka DB.
        if (!backupPraUpgradeDilakukan) {
          backupPraUpgradeDilakukan = true;
          try {
            const p = backupPraUpgrade(pathDb, lokasiAktif.backupsDir);
            if (p) loggerMain()?.info(`[backup-upgrade] ${p}`);
          } catch (e) {
            loggerMain()?.warn('[backup-upgrade] gagal', e);
          }
        }
        return openDb(pathDb);
      },
      tanya: (e) => {
        // Detail teknis hanya untuk log; layar pemulihan memakai pesan ramah.
        loggerMain()?.error('[db] gagal membuka database', e);
        return tanyaPemulihanDb(lokasiAktif, e);
      },
      bukaFolderBackup: async () => {
        try {
          mkdirSync(lokasiAktif.backupsDir, { recursive: true });
          const galat = await shell.openPath(lokasiAktif.backupsDir);
          if (galat) loggerMain()?.warn('[pemulihan-db] gagal membuka folder backup', galat);
        } catch (e) {
          loggerMain()?.warn('[pemulihan-db] gagal menyiapkan folder backup', e);
        }
      },
      keluar: () => app.quit(),
    });
    if (!dbDibuka) return;
    db = dbDibuka;
    // DB-12: audit integritas saat startup, SEBELUM backup otomatis. Temuan
    // hanya dicatat ke log dan tidak memblokir aplikasi; backup yang gagal audit
    // akan dibatalkan oleh auditSebelumBackup (fail-safe seperti restore).
    auditIntegritasSaatMulai(db, loggerMain());
    // Auto-backup harian 1x sehari (best-effort, jangan blokir app bila gagal).
    try {
      const p = autoBackupHarian(db, lokasiAktif.backupsDir, 7);
      loggerMain()?.info(`[backup-auto] ${p}`);
    } catch (e) {
      loggerMain()?.warn('[backup-auto] gagal', e);
    }
    // AUD-13: app yang dibiarkan terbuka tetap backup saat tanggal berganti.
    // Interval ringan + guard di modul; jangan pernah biarkan timer menahan quit.
    hentikanPenjadwalBackup();
    hentikanBackupPeriodik = mulaiBackupPeriodik({
      db: () => db,
      dirBackup: () => lokasiData().backupsDir,
      onBackup: (p) => loggerMain()?.info(`[backup-auto] ${p}`),
      onError: (e) => loggerMain()?.warn('[backup-auto] gagal', e),
    });
    // AUD-18: auto-lock ditegakkan main (idle, suspend, lock-screen).
    hentikanPenjadwalKunci();
    hentikanAutoKunci = mulaiAutoKunci();
    pasangPemicuKunciSistem();
    // Dev seeder: isi data dummy bervolume untuk uji laporan multi-halaman.
    // Hanya dev (!isPackaged) + flag .env; seedDev() hanya jalan bila DB kosong.
    if (!app.isPackaged && process.env.PURA_SEED_DEV === 'true') {
      const n = seedDev(db);
      if (n > 0) loggerMain()?.info(`[seed-dev] ${n} baris transaksi dummy dimasukkan.`);
    }
    registerIpc(buatIpcDeps());
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Bersihkan interval backup + auto-lock agar proses main bisa berhenti normal.
  app.on('before-quit', () => {
    loggerMain()?.info('Aplikasi akan berhenti.');
    bersihkanPenjadwal();
  });
  app.on('will-quit', () => {
    bersihkanPenjadwal();
    lepasPemicuKunciSistem();
  });

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
