// Kunci aplikasi (main process saja — butuh node:crypto).
// Model: single laptop, PIN 6 digit. Hash scrypt + salt per-DB, sesi di memori
// (selalu terkunci saat app dibuka). Brute-force dibatasi: 5x salah → blokir 60 dtk.
// Reset lupa PIN pakai KODE DARURAT statis (ancaman = anak/iseng, bukan pencuri file).

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  IDLE_DEFAULT_MENIT,
  MAKS_GAGAL,
  TUNDA_BLOKIR_MS,
  validasiIdleMenit,
  validasiPin,
} from '../core/pin.js';
import {
  KUNCI_IDLE_MENIT,
  KUNCI_PIN_HASH,
  KUNCI_PIN_SALT,
  getIdleMenit,
  getPengaturan,
  setPengaturan,
  sudahSetupPin,
} from '../db/repository.js';

// GANTI sebelum distribusi ke bendahara + simpan di dokumen fisik terpisah.
// Bisa di-override tanpa ubah kode via env PURA_RESET_CODE (dev) — production
// yang di-pack tetap memakai nilai ini.
export const KODE_DARURAT_DEFAULT = 'PURI-DARURAT-1945';
export function kodeDarurat(): string {
  return process.env.PURA_RESET_CODE ?? KODE_DARURAT_DEFAULT;
}

// --- Hash ---
export function buatSalt(): string {
  return randomBytes(16).toString('hex');
}

export function hashPin(pin: string, saltHex: string): string {
  return scryptSync(pin, Buffer.from(saltHex, 'hex'), 32, { N: 16384, r: 8, p: 1 }).toString('hex');
}

export function verifikasiHash(pin: string, saltHex: string, hashHex: string): boolean {
  try {
    const a = Buffer.from(hashPin(pin, saltHex), 'hex');
    const b = Buffer.from(hashHex, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// --- Sesi memori (reset tiap app dibuka → selalu terkunci saat start) ---
export const sesi = { terbuka: false, gagal: 0, blokirSampai: 0 };

export function sisaBlokirDetik(kini = Date.now()): number {
  return Math.max(0, Math.ceil((sesi.blokirSampai - kini) / 1000));
}

export function statusKunci(db: Database.Database): {
  sudahSetup: boolean;
  terbuka: boolean;
  idleMenit: number;
  gagal: number;
  blokirDetik: number;
} {
  return {
    sudahSetup: sudahSetupPin(db),
    terbuka: sesi.terbuka,
    idleMenit: getIdleMenit(db, IDLE_DEFAULT_MENIT),
    gagal: sesi.gagal,
    blokirDetik: sisaBlokirDetik(),
  };
}

const cekBlokir = (): string | null => {
  const sisa = sisaBlokirDetik();
  return sisa > 0 ? `Terlalu banyak salah. Coba lagi dalam ${sisa} detik.` : null;
};

const catatGagal = (): string => {
  sesi.gagal += 1;
  if (sesi.gagal >= MAKS_GAGAL) {
    sesi.blokirSampai = Date.now() + TUNDA_BLOKIR_MS;
    sesi.gagal = 0;
    return `Terlalu banyak salah. Terkunci ${TUNDA_BLOKIR_MS / 1000} detik.`;
  }
  return `PIN salah. Sisa coba: ${MAKS_GAGAL - sesi.gagal}x.`;
};

function simpanPin(db: Database.Database, pin: string): void {
  const salt = buatSalt();
  setPengaturan(db, KUNCI_PIN_SALT, salt);
  setPengaturan(db, KUNCI_PIN_HASH, hashPin(pin, salt));
}

export function setupPin(db: Database.Database, pin: string): string | null {
  if (sudahSetupPin(db)) return 'PIN sudah ada. Pakai menu Ganti PIN di Pengaturan.';
  const v = validasiPin(pin);
  if (v) return v;
  simpanPin(db, pin);
  sesi.terbuka = true;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
  return null;
}

export function bukaKunci(db: Database.Database, pin: string): string | null {
  if (!sudahSetupPin(db)) return 'Belum ada PIN. Buat PIN dulu.';
  const b = cekBlokir();
  if (b) return b;
  const salt = getPengaturan(db, KUNCI_PIN_SALT);
  const hash = getPengaturan(db, KUNCI_PIN_HASH);
  if (!salt || !hash) return 'Data PIN rusak. Pakai kode darurat untuk reset.';
  if (!verifikasiHash(pin, salt, hash)) return catatGagal();
  sesi.terbuka = true;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
  return null;
}

export function kunciLagi(): void {
  sesi.terbuka = false;
}

export function ubahPin(db: Database.Database, lama: string, baru: string): string | null {
  const salt = getPengaturan(db, KUNCI_PIN_SALT);
  const hash = getPengaturan(db, KUNCI_PIN_HASH);
  if (!salt || !hash) return 'Belum ada PIN.';
  if (!verifikasiHash(lama, salt, hash)) return 'PIN lama salah.';
  const v = validasiPin(baru);
  if (v) return v;
  if (lama === baru) return 'PIN baru sama dengan PIN lama.';
  simpanPin(db, baru);
  return null;
}

export function aturIdle(db: Database.Database, menit: number): string | null {
  const v = validasiIdleMenit(menit);
  if (v) return v;
  setPengaturan(db, KUNCI_IDLE_MENIT, String(menit));
  return null;
}

export function resetPaksa(db: Database.Database, kode: string, pinBaru: string): string | null {
  if (kode.trim() !== kodeDarurat()) return 'Kode darurat salah.';
  const v = validasiPin(pinBaru);
  if (v) return v;
  simpanPin(db, pinBaru);
  sesi.terbuka = true;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
  return null;
}
