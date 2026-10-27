// Fitur Kunci Aplikasi: PIN 6 digit + idle configurable + reset kode darurat.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/database.js';
import { getIdleMenit, setPengaturan, getPengaturan, sudahSetupPin } from '../src/db/repository.js';
import { IDLE_DEFAULT_MENIT, validasiIdleMenit, validasiPin } from '../src/core/pin.js';
import {
  aturIdle,
  bukaKunci,
  buatSalt,
  harusKunci,
  hashPin,
  INTERVAL_AUTO_KUNCI_MS,
  kodeDarurat,
  kunciLagi,
  operasiPanjangAktif,
  perluKunciOtomatis,
  resetPaksa,
  sentuhAktivitas,
  sesi,
  setupPin,
  statusKunci,
  tahanAutoKunci,
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
  sesi.terakhirAktivitas = 0;
  sesi.operasiPanjang = 0;
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

describe('AUD-18 — auto-lock ditegakkan main', () => {
  const MENIT = 30;
  const T0 = 1_800_000_000_000;

  it('harusKunci: belum idle, tepat batas, dan lewat batas', () => {
    expect(harusKunci(T0, T0, MENIT)).toBe(false);
    expect(harusKunci(T0 + MENIT * 60_000 - 1, T0, MENIT)).toBe(false);
    expect(harusKunci(T0 + MENIT * 60_000, T0, MENIT)).toBe(true);
    expect(harusKunci(T0 + MENIT * 60_000 + 1, T0, MENIT)).toBe(true);
  });

  it('timestamp kosong/invalid atau jam mundur tidak memicu lock', () => {
    expect(harusKunci(T0, 0, MENIT)).toBe(false);
    expect(harusKunci(T0, T0 + 60_000, MENIT)).toBe(false);
    expect(harusKunci(Number.NaN, T0, MENIT)).toBe(false);
    expect(harusKunci(T0, T0, 0)).toBe(false);
    expect(harusKunci(T0, T0, Number.NaN)).toBe(false);
  });

  it('setup dan bukaKunci yang berhasil menyentuh aktivitas', () => {
    const db = dbBaru();
    sesi.terakhirAktivitas = 0;
    expect(setupPin(db, '123456')).toBeNull();
    expect(sesi.terakhirAktivitas).toBeGreaterThan(0);
    kunciLagi();
    sentuhAktivitas(1);
    expect(bukaKunci(db, '123456')).toBeNull();
    expect(sesi.terakhirAktivitas).toBeGreaterThan(1);
    db.close();
  });

  it('sesi tertutup atau operasi panjang menahan auto-lock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      sesi.terbuka = true;
      sentuhAktivitas(T0);
      expect(perluKunciOtomatis(T0 + 1, MENIT)).toBe(false);
      expect(perluKunciOtomatis(T0 + MENIT * 60_000, MENIT)).toBe(true);

      kunciLagi();
      expect(perluKunciOtomatis(T0 + MENIT * 60_000, MENIT)).toBe(false);

      sesi.terbuka = true;
      const selesai = tahanAutoKunci();
      expect(operasiPanjangAktif()).toBe(true);
      expect(perluKunciOtomatis(T0 + MENIT * 60_000, MENIT)).toBe(false);

      vi.setSystemTime(T0 + MENIT * 60_000);
      selesai();
      selesai(); // idempoten
      expect(operasiPanjangAktif()).toBe(false);
      expect(sesi.terakhirAktivitas).toBe(T0 + MENIT * 60_000);
      // Pelepasan operasi dihitung aktivitas; idle berikutnya baru mengunci.
      expect(perluKunciOtomatis(T0 + MENIT * 60_000, MENIT)).toBe(false);
      expect(perluKunciOtomatis(T0 + 2 * MENIT * 60_000, MENIT)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('interval pengecekan main 60 detik', () => {
    expect(INTERVAL_AUTO_KUNCI_MS).toBe(60_000);
  });
});
