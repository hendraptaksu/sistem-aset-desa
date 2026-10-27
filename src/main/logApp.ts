// AUD-34 — logger main process ke `<userData>/logs/app.log`.
//
// Modul ini sengaja tidak mengimpor Electron supaya path, format baris, rotasi,
// dan redaksi bisa diuji langsung dengan Node/vitest. Pemanggil (main/index.ts)
// hanya menyerahkan `app.getPath('userData')`.
//
// Aturan isi log:
// - hanya jejak operasional (startup, backup, restore, error tak tertangani);
// - TIDAK PERNAH menulis PIN, hash/salt, isi jurnal, atau payload IPC mentah;
// - `redaksiLog` menjadi jaring pengaman bila pesan error tidak sengaja
//   mengandung nilai sensitif.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { deskripsiError, redaksiLog, satuBaris } from '../utils/logAman.js';

/** Rotasi saat file aktif melewati 1 MB. */
export const UKURAN_MAKS_LOG_BYTE = 1024 * 1024;

/** Batas atas arsip yang didukung ticket: app.log.1 .. app.log.3. */
export const ARSIP_LOG_MAKS = 3;

/** Default menyimpan dua arsip (cukup untuk beberapa sesi pemakaian). */
export const ARSIP_LOG_BAWAAN = 2;

export type LevelLog = 'INFO' | 'WARN' | 'ERROR';

export type LoggerApp = {
  /** Path file log aktif (untuk ditampilkan/diuji). */
  readonly file: string;
  info(pesan: string): void;
  warn(pesan: string, error?: unknown): void;
  error(pesan: string, error?: unknown): void;
};

export type OpsiLoggerApp = {
  /** `app.getPath('userData')`; log ditulis ke `<userData>/logs/app.log`. */
  userDataDir: string;
  /** Default 1 MB; bisa diperkecil di test. */
  batasByte?: number;
  /** Jumlah arsip `app.log.N`; dijepit ke 1..3. */
  arsip?: number;
  /** Jam yang bisa dipatok di test. */
  sekarang?: () => Date;
  /**
   * Tujuan salinan konsol. `undefined` = console bawaan, `null` = matikan
   * (dipakai test agar output tidak berisik).
   */
  konsol?: Pick<Console, 'log' | 'warn' | 'error'> | null;
};

/** Path log aplikasi: `<userData>/logs/app.log`. */
export function pathLogApp(userDataDir: string): string {
  const basis = String(userDataDir ?? '').trim();
  if (!basis) throw new Error('Folder userData wajib diisi untuk log aplikasi.');
  return join(basis, 'logs', 'app.log');
}

/** Path arsip rotasi ke-`nomor` (mis. `app.log.1`). */
export function pathArsipLog(fileLog: string, nomor: number): string {
  return `${fileLog}.${Math.trunc(nomor)}`;
}

/**
 * Format satu baris log: `<ISO-8601> [LEVEL] pesan\n`.
 * Pesan diratakan satu baris dan diredaksi agar aman ditulis ke file.
 */
export function formatBarisLog(
  waktu: Date | string,
  level: LevelLog,
  pesan: string,
): string {
  const tanggal = waktu instanceof Date ? waktu : new Date(waktu);
  const stempel = Number.isNaN(tanggal.getTime())
    ? new Date(0).toISOString()
    : tanggal.toISOString();
  const isi = satuBaris(redaksiLog(pesan)) || '(kosong)';
  return `${stempel} [${level}] ${isi}\n`;
}

/**
 * Rotasi bila ukuran file aktif (ditambah baris yang akan ditulis) melewati
 * batas. Arsip digeser `app.log.1` → `app.log.2` → ...; arsip tertua dibuang.
 * Mengembalikan `true` bila rotasi terjadi. File yang belum ada = tidak ada
 * rotasi. Kegagalan fs tidak dilempar; logger tetap berusaha menulis.
 */
export function rotasiLogJikaPerlu(
  fileLog: string,
  opsi: {
    batasByte?: number;
    arsip?: number;
    /** Ukuran baris berikutnya agar file aktif tidak melewati batas. */
    tambahanByte?: number;
  } = {},
): boolean {
  const batas = opsi.batasByte ?? UKURAN_MAKS_LOG_BYTE;
  const diminta = Math.trunc(opsi.arsip ?? ARSIP_LOG_BAWAAN);
  const jumlahArsip = Math.min(
    ARSIP_LOG_MAKS,
    Math.max(1, Number.isFinite(diminta) ? diminta : ARSIP_LOG_BAWAAN),
  );
  const tambahan = Math.max(0, Math.trunc(opsi.tambahanByte ?? 0));

  let ukuran: number;
  try {
    const info = statSync(fileLog);
    if (!info.isFile()) return false;
    ukuran = info.size;
  } catch {
    return false;
  }
  if (ukuran + tambahan <= batas) return false;

  try {
    const tertua = pathArsipLog(fileLog, jumlahArsip);
    if (existsSync(tertua)) unlinkSync(tertua);
    for (let i = jumlahArsip - 1; i >= 1; i -= 1) {
      const dari = pathArsipLog(fileLog, i);
      if (existsSync(dari)) renameSync(dari, pathArsipLog(fileLog, i + 1));
    }
    renameSync(fileLog, pathArsipLog(fileLog, 1));
    return true;
  } catch {
    // Log tidak boleh menjatuhkan aplikasi; coba lagi pada penulisan berikutnya.
    return false;
  }
}

/**
 * Buat logger main. Semua operasi file dibungkus try/catch: kegagalan log
 * (disk penuh, folder tidak bisa dibuat) tidak boleh menggagalkan aplikasi.
 */
export function buatLoggerApp(opsi: OpsiLoggerApp): LoggerApp {
  const file = pathLogApp(opsi.userDataDir);
  const sekarang = opsi.sekarang ?? (() => new Date());
  const konsol = opsi.konsol === undefined ? console : opsi.konsol;

  const tulis = (level: LevelLog, pesan: string, error?: unknown): void => {
    const mentah =
      error === undefined ? String(pesan ?? '') : `${pesan}: ${deskripsiError(error)}`;
    const aman = redaksiLog(mentah);

    // Salinan konsol membantu `npm run dev`/debug tanpa membuka file log.
    try {
      if (level === 'ERROR') konsol?.error(aman);
      else if (level === 'WARN') konsol?.warn(aman);
      else konsol?.log(aman);
    } catch {
      /* console bisa saja sudah dibuang; file tetap prioritas */
    }

    try {
      mkdirSync(dirname(file), { recursive: true });
      const baris = formatBarisLog(sekarang(), level, mentah);
      rotasiLogJikaPerlu(file, {
        batasByte: opsi.batasByte,
        arsip: opsi.arsip,
        tambahanByte: Buffer.byteLength(baris, 'utf-8'),
      });
      appendFileSync(file, baris, 'utf-8');
    } catch {
      // Diamkan: aplikasi tetap berjalan walau log tidak bisa ditulis.
    }
  };

  return {
    file,
    info: (pesan) => tulis('INFO', pesan),
    warn: (pesan, error) => tulis('WARN', pesan, error),
    error: (pesan, error) => tulis('ERROR', pesan, error),
  };
}
