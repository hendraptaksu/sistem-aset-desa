// Fitur Kunci Aplikasi: PIN 6 digit + idle configurable + reset kode darurat.
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { getIdleMenit, setPengaturan, getPengaturan, sudahSetupPin } from '../src/db/repository.js';
import { IDLE_DEFAULT_MENIT, validasiIdleMenit, validasiPin } from '../src/core/pin.js';
import {
  aturIdle,
  bukaKunci,
  buatSalt,
  hashPin,
  kodeDarurat,
  kunciLagi,
  resetPaksa,
  sesi,
  setupPin,
  statusKunci,
  ubahPin,
  verifikasiHash,
} from '../src/main/kunci.js';

function dbBaru() {
  return openDb(':memory:');
}

beforeEach(() => {
  sesi.terbuka = false;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
  delete process.env.PURA_RESET_CODE;
});

describe('validasi PIN & idle', () => {
  it('PIN tepat 6 digit angka', () => {
    expect(validasiPin('123456')).toBeNull();
    expect(validasiPin('12345')).not.toBeNull();
    expect(validasiPin('1234567')).not.toBeNull();
    expect(validasiPin('12a456')).not.toBeNull();
    expect(validasiPin('')).not.toBeNull();
  });
  it('idle 5–120 menit, default 30', () => {
    expect(IDLE_DEFAULT_MENIT).toBe(30);
    expect(validasiIdleMenit(30)).toBeNull();
    expect(validasiIdleMenit(4)).not.toBeNull();
    expect(validasiIdleMenit(121)).not.toBeNull();
    expect(validasiIdleMenit(2.5)).not.toBeNull();
  });
});

describe('hash scrypt + salt', () => {
  it('roundtrip benar, PIN salah ditolak, salt beda → hash beda', () => {
    const s = buatSalt();
    const h = hashPin('123456', s);
    expect(verifikasiHash('123456', s, h)).toBe(true);
    expect(verifikasiHash('654321', s, h)).toBe(false);
    expect(hashPin('123456', buatSalt())).not.toBe(h);
  });
});

describe('repo pengaturan', () => {
  it('set/get roundtrip, belum setup → idle fallback', () => {
    const db = dbBaru();
    expect(sudahSetupPin(db)).toBe(false);
    expect(getIdleMenit(db)).toBe(30);
    setPengaturan(db, 'idle_menit', '45');
    expect(getPengaturan(db, 'idle_menit')).toBe('45');
    expect(getIdleMenit(db)).toBe(45);
    db.close();
  });
});

describe('alur kunci end-to-end', () => {
  it('setup → terkunci saat start → buka → ubah → idle', () => {
    const db = dbBaru();
    expect(setupPin(db, '123456')).toBeNull();
    expect(statusKunci(db).terbuka).toBe(true);
    kunciLagi();
    expect(statusKunci(db).terbuka).toBe(false);
    expect(bukaKunci(db, '000000')).not.toBeNull();
    expect(statusKunci(db).terbuka).toBe(false);
    expect(bukaKunci(db, '123456')).toBeNull();
    expect(ubahPin(db, '123456', '654321')).toBeNull();
    kunciLagi();
    expect(bukaKunci(db, '123456')).not.toBeNull();
    expect(bukaKunci(db, '654321')).toBeNull();
    expect(aturIdle(db, 45)).toBeNull();
    expect(statusKunci(db).idleMenit).toBe(45);
    expect(aturIdle(db, 3)).not.toBeNull();
    db.close();
  });
  it('setup dua kali ditolak, PIN jelek ditolak', () => {
    const db = dbBaru();
    expect(setupPin(db, '12')).not.toBeNull();
    expect(setupPin(db, '123456')).toBeNull();
    expect(setupPin(db, '654321')).not.toBeNull();
    db.close();
  });
  it('5x salah → blokir 60 detik', () => {
    const db = dbBaru();
    setupPin(db, '123456');
    kunciLagi();
    for (let i = 0; i < 4; i++) expect(bukaKunci(db, '000000')).toMatch(/sisa coba/i);
    expect(bukaKunci(db, '000000')).toMatch(/terkunci/i);
    // PIN benar pun ditolak selama blokir
    expect(bukaKunci(db, '123456')).toMatch(/coba lagi dalam/i);
    expect(statusKunci(db).blokirDetik).toBeGreaterThan(0);
    db.close();
  });
  it('reset kode darurat: salah ditolak, benar membuka + ganti PIN', () => {
    process.env.PURA_RESET_CODE = 'RESET-UNIT-001';
    expect(kodeDarurat()).toBe('RESET-UNIT-001');
    const db = dbBaru();
    setupPin(db, '123456');
    kunciLagi();
    expect(resetPaksa(db, 'SALAH', '777777')).not.toBeNull();
    expect(statusKunci(db).terbuka).toBe(false);
    expect(resetPaksa(db, 'RESET-UNIT-001', '77')).not.toBeNull();
    expect(resetPaksa(db, 'RESET-UNIT-001', '777777')).toBeNull();
    expect(statusKunci(db).terbuka).toBe(true);
    kunciLagi();
    expect(bukaKunci(db, '777777')).toBeNull();
    db.close();
  });
});
