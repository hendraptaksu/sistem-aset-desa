// Lokasi data aplikasi (P2-8) — modul murni, tanpa Electron.
//
// Satu tempat untuk memutuskan di mana database dan backup tinggal
// agar UI, dokumentasi, dan main process tidak saling berbeda:
// - PORTABLE  : electron-builder portable menetapkan PORTABLE_EXECUTABLE_DIR.
//               Semua data ikut folder exe supaya bisa dibawa di flashdisk.
// - INSTALLED : installer NSIS biasa. DB & backup di <userData>/data.
// - OVERRIDE  : PURA_DB (dev/test) tetap menang. DB di path pilihan; backup di
//               samping DB, persis perilaku dev sebelum P2-8.
//
// Modul ini sengaja memilih `path.win32`/`path.posix` berdasarkan bentuk path
// masuk, bukan platform host. Dengan begitu aturan Windows dapat diuji di
// macOS/Linux tanpa hardcode separator. Di aplikasi nyata path selalu berasal
// dari Electron sehingga gayanya sudah sesuai OS.

import { posix, win32 } from 'node:path';

export type ModeLokasiData = 'PORTABLE' | 'INSTALLED' | 'OVERRIDE';

export type LokasiData = {
  mode: ModeLokasiData;
  /** Folder tempat file `pura.db` berada. */
  dataDir: string;
  /** File database SQLite aktif. */
  dbPath: string;
  /** Folder backup otomatis/manual internal. */
  backupsDir: string;
};

export type OpsiLokasiData = {
  /** `app.getPath('userData')` — folder data aplikasi dari Electron. */
  userDataDir: string;
  /** `process.env.PORTABLE_EXECUTABLE_DIR` (hanya build portable). */
  portableDir?: string | null;
  /** `process.env.PURA_DB` (dev/test); prioritas paling tinggi. */
  overrideDbPath?: string | null;
};

type PathApi = typeof posix;

function teksNilai(nilai: string | null | undefined): string {
  return typeof nilai === 'string' ? nilai.trim() : '';
}

/** Path berformat Windows (drive letter atau backslash) → API win32. */
function apiPath(path: string): PathApi {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.includes('\\') ? win32 : posix;
}

function gabung(base: string, ...bagian: string[]): string {
  return apiPath(base).join(base, ...bagian);
}

function folderInduk(path: string): string {
  return apiPath(path).dirname(path);
}

/**
 * Tentukan lokasi data yang dapat diprediksi dari environment.
 * Tidak membuat/mengubah file apa pun.
 */
export function tentukanLokasiData(opsi: OpsiLokasiData): LokasiData {
  const userDataDir = teksNilai(opsi.userDataDir);
  if (!userDataDir) {
    throw new Error('Folder data aplikasi (userData) wajib diisi.');
  }

  // 1. PURA_DB menang (dev/test); backup di samping DB seperti perilaku lama.
  const overrideDbPath = teksNilai(opsi.overrideDbPath);
  if (overrideDbPath) {
    const dataDir = folderInduk(overrideDbPath);
    return {
      mode: 'OVERRIDE',
      dataDir,
      dbPath: overrideDbPath,
      backupsDir: gabung(dataDir, 'backups'),
    };
  }

  // 2. Build portable: seluruh data di dalam folder exe.
  const portableDir = teksNilai(opsi.portableDir);
  if (portableDir) {
    const dataDir = gabung(portableDir, 'data');
    return {
      mode: 'PORTABLE',
      dataDir,
      dbPath: gabung(dataDir, 'pura.db'),
      backupsDir: gabung(portableDir, 'backups'),
    };
  }

  // 3. Installer NSIS: DB & backup di <userData>/data.
  const dataDir = gabung(userDataDir, 'data');
  return {
    mode: 'INSTALLED',
    dataDir,
    dbPath: gabung(dataDir, 'pura.db'),
    backupsDir: gabung(dataDir, 'backups'),
  };
}
