// Kunci aplikasi (main process saja — butuh node:crypto).
// Model: single laptop, PIN 6 digit. Hash scrypt + salt per-DB, sesi di memori
// (selalu terkunci saat app dibuka). Brute-force dibatasi: 5x salah → blokir 60 dtk.
// Reset lupa PIN memakai kode darurat per-install (scrypt + salt). Kode hanya
// ditampilkan sekali saat dibuat; database tidak pernah menyimpan plaintext.

import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
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
  KUNCI_RESET_HASH,
  KUNCI_RESET_SALT,
  catatAudit,
  getIdleMenit,
  getPengaturan,
  kodeDaruratDiatur,
  setPengaturan,
  sudahSetupPin,
} from '../db/repository.js';

// --- Kode darurat per-install ---

/** Alfabet tanpa 0/O/1/I/L agar kode mudah dibaca dari kertas. */
const ALFABET_KODE_DARURAT = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const PANJANG_GRUP = 4;
const JUMLAH_GRUP = 4;

/** Kode 4 grup × 4 karakter, mis. `7K3M-P9QX-...` — acak kriptografis. */
export function buatKodeDarurat(): string {
  const grup: string[] = [];
  for (let g = 0; g < JUMLAH_GRUP; g += 1) {
    let isi = '';
    for (let i = 0; i < PANJANG_GRUP; i += 1) {
      isi += ALFABET_KODE_DARURAT[randomInt(ALFABET_KODE_DARURAT.length)];
    }
    grup.push(isi);
  }
  return grup.join('-');
}

/** Bentuk kanonik untuk hashing/verifikasi: huruf besar, tanpa spasi/tanda hubung. */
export function normalkanKodeDarurat(kode: string): string {
  return String(kode ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Kode baru yang belum sempat ditampilkan ke UI. Hanya di memori proses dan
 * diambil sekali; tidak pernah dibaca ulang dari database.
 */
let kodeDaruratSekali: string | null = null;

/** Ambil kode yang baru dibuat (sekali saja). Panggilan berikutnya `null`. */
export function ambilKodeDaruratSekali(): string | null {
  const kode = kodeDaruratSekali;
  kodeDaruratSekali = null;
  return kode;
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
export const sesi = {
  terbuka: false,
  gagal: 0,
  blokirSampai: 0,
  /** Timestamp aktivitas terakhir yang sah (setup/unlock/IPC yang lolos gembok). */
  terakhirAktivitas: 0,
  /** Jumlah operasi panjang (backup/restore) yang menahan auto-kunci. */
  operasiPanjang: 0,
};

/** Interval cek idle di main; keputusan tetap di main, bukan renderer. */
export const INTERVAL_AUTO_KUNCI_MS = 60_000;

export function sisaBlokirDetik(kini = Date.now()): number {
  return Math.max(0, Math.ceil((sesi.blokirSampai - kini) / 1000));
}

/** Catat aktivitas sesi yang sah. Tidak pernah menyimpan PIN atau data sensitif. */
export function sentuhAktivitas(kini = Date.now()): void {
  sesi.terakhirAktivitas = kini;
}

/**
 * Fungsi murni keputusan idle. `terakhir <= 0` berarti belum ada aktivitas
 * (jangan mengunci), dan jam yang mundur tidak boleh memicu lock.
 */
export function harusKunci(now: number, terakhir: number, menit: number): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(terakhir) || !Number.isFinite(menit)) {
    return false;
  }
  if (terakhir <= 0 || menit <= 0) return false;
  return now - terakhir >= menit * 60_000;
}

export function operasiPanjangAktif(): boolean {
  return sesi.operasiPanjang > 0;
}

/**
 * Tahan auto-kunci selama operasi backup/restore yang sah. Pengembalian fungsi
 * bersifat idempoten dan wajib dipanggil di `finally`. Saat dilepas, aktivitas
 * disentuh lagi agar sesi tidak langsung terkunci tepat setelah operasi selesai.
 */
export function tahanAutoKunci(): () => void {
  sesi.operasiPanjang += 1;
  let dilepas = false;
  return () => {
    if (dilepas) return;
    dilepas = true;
    sesi.operasiPanjang = Math.max(0, sesi.operasiPanjang - 1);
    sentuhAktivitas();
  };
}

/** Keputusan auto-lock memakai state sesi nyata; operasi panjang menahannya. */
export function perluKunciOtomatis(kini: number, menit: number): boolean {
  return (
    sesi.terbuka &&
    !operasiPanjangAktif() &&
    harusKunci(kini, sesi.terakhirAktivitas, menit)
  );
}

export function statusKunci(db: Database.Database): {
  sudahSetup: boolean;
  terbuka: boolean;
  idleMenit: number;
  gagal: number;
  blokirDetik: number;
  kodeDaruratDiatur: boolean;
} {
  return {
    sudahSetup: sudahSetupPin(db),
    terbuka: sesi.terbuka,
    idleMenit: getIdleMenit(db, IDLE_DEFAULT_MENIT),
    gagal: sesi.gagal,
    blokirDetik: sisaBlokirDetik(),
    kodeDaruratDiatur: kodeDaruratDiatur(db),
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

/** Simpan hash kode darurat; plaintext hanya hidup di memori sampai ditampilkan. */
function simpanKodeDarurat(db: Database.Database, kode: string): void {
  const salt = buatSalt();
  setPengaturan(db, KUNCI_RESET_SALT, salt);
  setPengaturan(db, KUNCI_RESET_HASH, hashPin(normalkanKodeDarurat(kode), salt));
}

/** Audit PIN/kode tidak pernah menyimpan PIN, kode, salt, atau hash. */
function catatAuditPin(
  db: Database.Database,
  aksi: string,
  alasan: string,
  label = 'PIN diganti',
): void {
  catatAudit(db, {
    aksi,
    alasan,
    baru: { pin: label },
  });
}

function catatAuditKodeDarurat(
  db: Database.Database,
  aksi: string,
  alasan: string,
  label = 'Kode darurat dibuat',
): void {
  catatAudit(db, {
    aksi,
    alasan,
    baru: { kodeDarurat: label },
  });
}

export function setupPin(db: Database.Database, pin: string): string | null {
  if (sudahSetupPin(db)) return 'PIN sudah ada. Pakai menu Ganti PIN di Pengaturan.';
  const v = validasiPin(pin);
  if (v) return v;
  kodeDaruratSekali = null;
  const kode = buatKodeDarurat();
  const tx = db.transaction(() => {
    simpanPin(db, pin);
    simpanKodeDarurat(db, kode);
    catatAuditPin(db, 'PENGATURAN-SETUP-PIN', 'PIN dibuat', 'PIN dibuat');
    catatAuditKodeDarurat(
      db,
      'PENGATURAN-KODE-DARURAT',
      'Kode darurat dibuat saat setup PIN',
    );
  });
  tx();
  kodeDaruratSekali = kode;
  sesi.terbuka = true;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
  sentuhAktivitas();
  return null;
}

/**
 * Buat/ganti kode darurat. Hash baru langsung berlaku dan kode lama tidak bisa
 * dipakai lagi. Mengembalikan plaintext HANYA untuk ditampilkan sekali oleh UI.
 */
export function gantiKodeDarurat(db: Database.Database): string {
  const kode = buatKodeDarurat();
  const tx = db.transaction(() => {
    simpanKodeDarurat(db, kode);
    catatAuditKodeDarurat(
      db,
      'PENGATURAN-KODE-DARURAT',
      'Kode darurat diganti dari Pengaturan',
      'Kode darurat diganti',
    );
  });
  tx();
  return kode;
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
  sentuhAktivitas();
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
  const tx = db.transaction(() => {
    simpanPin(db, baru);
    catatAuditPin(db, 'PENGATURAN-PIN', 'PIN diganti');
  });
  tx();
  return null;
}

export function aturIdle(db: Database.Database, menit: number): string | null {
  const v = validasiIdleMenit(menit);
  if (v) return v;
  const lama = getIdleMenit(db, IDLE_DEFAULT_MENIT);
  const tx = db.transaction(() => {
    setPengaturan(db, KUNCI_IDLE_MENIT, String(menit));
    catatAudit(db, {
      aksi: 'PENGATURAN-IDLE',
      alasan: `Auto-kunci diubah dari ${lama} ke ${menit} menit`,
      lama: { idleMenit: lama },
      baru: { idleMenit: menit },
    });
  });
  tx();
  return null;
}

export function resetPaksa(db: Database.Database, kode: string, pinBaru: string): string | null {
  const salt = getPengaturan(db, KUNCI_RESET_SALT);
  const hash = getPengaturan(db, KUNCI_RESET_HASH);
  if (!salt || !hash) {
    return 'Kode darurat belum diatur untuk instalasi ini. Buka Pengaturan (dengan PIN terbuka), lalu pilih Atur kode darurat.';
  }
  if (!verifikasiHash(normalkanKodeDarurat(kode), salt, hash)) {
    return 'Kode darurat salah.';
  }
  const v = validasiPin(pinBaru);
  if (v) return v;
  const tx = db.transaction(() => {
    simpanPin(db, pinBaru);
    catatAuditPin(db, 'PENGATURAN-RESET-PIN', 'PIN direset dengan kode darurat');
  });
  tx();
  sesi.terbuka = true;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
  sentuhAktivitas();
  return null;
}
