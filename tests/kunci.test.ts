// Fitur Kunci Aplikasi: PIN 6 digit + idle configurable + reset kode darurat.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  getIdleMenit,
  KUNCI_KEAMANAN_BLOKIR_SAMPAI,
  KUNCI_KEAMANAN_GAGAL,
  KUNCI_RESET_HASH,
  KUNCI_RESET_SALT,
  setPengaturan,
  getPengaturan,
  kodeDaruratDiatur,
  sudahSetupPin,
} from '../src/db/repository.js';
import {
  IDLE_DEFAULT_MENIT,
  MAKS_GAGAL,
  TUNDA_BLOKIR_MS,
  validasiIdleMenit,
  validasiPin,
} from '../src/core/pin.js';
import {
  ambilKodeDaruratSekali,
  aturIdle,
  bukaKunci,
  buatKodeDarurat,
  buatSalt,
  gantiKodeDarurat,
  harusKunci,
  hashPin,
  INTERVAL_AUTO_KUNCI_MS,
  kunciLagi,
  muatStateBlokir,
  normalkanKodeDarurat,
  operasiPanjangAktif,
  perluKunciOtomatis,
  resetPaksa,
  sentuhAktivitas,
  sesi,
  setupPin,
  simpanStateBlokir,
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
  // Buang kode sekali-pakai yang mungkin tertinggal dari test sebelumnya.
  ambilKodeDaruratSekali();
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
  it('reset kode darurat per-install: salah ditolak, benar membuka + ganti PIN', () => {
    const db = dbBaru();
    expect(setupPin(db, '123456')).toBeNull();
    const kode = ambilKodeDaruratSekali();
    expect(kode).toMatch(/^(?:[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}-){3}[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    kunciLagi();
    expect(resetPaksa(db, 'SALAH', '777777')).not.toBeNull();
    expect(statusKunci(db).terbuka).toBe(false);
    expect(resetPaksa(db, kode!.toLowerCase(), '77')).not.toBeNull();
    expect(resetPaksa(db, ` ${kode!.toLowerCase()} `, '777777')).toBeNull();
    expect(statusKunci(db).terbuka).toBe(true);
    kunciLagi();
    expect(bukaKunci(db, '777777')).toBeNull();
    db.close();
  });
});

describe('T2.8 — lockout PIN bertahan setelah restart', () => {
  const buatDbDenganPin = () => {
    const db = dbBaru();
    expect(setupPin(db, '123456')).toBeNull();
    kunciLagi();
    return db;
  };

  const salahLimaKali = (db: ReturnType<typeof dbBaru>) => {
    for (let i = 0; i < MAKS_GAGAL - 1; i++) {
      expect(bukaKunci(db, '000000')).toMatch(/sisa coba/i);
    }
    expect(bukaKunci(db, '000000')).toMatch(/terkunci/i);
  };

  it('(a) 5x salah menyimpan state dan blokirDetik > 0', () => {
    const db = buatDbDenganPin();
    salahLimaKali(db);
    expect(statusKunci(db).blokirDetik).toBeGreaterThan(0);
    expect(getPengaturan(db, KUNCI_KEAMANAN_GAGAL)).toBe('0');
    expect(Number(getPengaturan(db, KUNCI_KEAMANAN_BLOKIR_SAMPAI))).toBeGreaterThan(Date.now());
    db.close();
  });

  it('(b) simulasi restart: state dimuat ulang dan PIN benar tetap ditolak', () => {
    const db = buatDbDenganPin();
    salahLimaKali(db);
    const sisaSebelum = statusKunci(db).blokirDetik;
    expect(sisaSebelum).toBeGreaterThan(0);

    // Simulasi proses baru: state memori kosong, lalu dimuat dari DB.
    sesi.gagal = 0;
    sesi.blokirSampai = 0;
    muatStateBlokir(db);

    expect(statusKunci(db).blokirDetik).toBeGreaterThan(0);
    expect(bukaKunci(db, '123456')).toMatch(/coba lagi dalam/i);
    expect(statusKunci(db).terbuka).toBe(false);
    db.close();
  });

  it('(c) setelah blokir habis PIN benar berhasil dan state persisted kembali 0', () => {
    const T0 = 1_800_000_000_000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const db = buatDbDenganPin();
      salahLimaKali(db);
      expect(bukaKunci(db, '123456')).toMatch(/coba lagi dalam/i);

      vi.setSystemTime(T0 + TUNDA_BLOKIR_MS + 1_000);
      expect(statusKunci(db).blokirDetik).toBe(0);
      // statusKunci ikut membersihkan nilai persisted yang kedaluwarsa.
      expect(getPengaturan(db, KUNCI_KEAMANAN_BLOKIR_SAMPAI)).toBe('0');

      expect(bukaKunci(db, '123456')).toBeNull();
      expect(statusKunci(db).terbuka).toBe(true);
      expect(statusKunci(db).gagal).toBe(0);
      expect(statusKunci(db).blokirDetik).toBe(0);
      expect(getPengaturan(db, KUNCI_KEAMANAN_GAGAL)).toBe('0');
      expect(getPengaturan(db, KUNCI_KEAMANAN_BLOKIR_SAMPAI)).toBe('0');
      db.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('(d) restart setelah unlock sukses tidak memblokir', () => {
    const db = buatDbDenganPin();
    for (let i = 0; i < 3; i++) expect(bukaKunci(db, '000000')).toMatch(/sisa coba/i);
    expect(getPengaturan(db, KUNCI_KEAMANAN_GAGAL)).toBe('3');
    expect(bukaKunci(db, '123456')).toBeNull();

    sesi.gagal = 0;
    sesi.blokirSampai = 0;
    muatStateBlokir(db);
    expect(statusKunci(db).gagal).toBe(0);
    expect(statusKunci(db).blokirDetik).toBe(0);

    kunciLagi();
    expect(bukaKunci(db, '123456')).toBeNull();
    expect(getPengaturan(db, KUNCI_KEAMANAN_GAGAL)).toBe('0');
    expect(getPengaturan(db, KUNCI_KEAMANAN_BLOKIR_SAMPAI)).toBe('0');
    db.close();
  });

  it('(e) setup PIN baru mereset lockout di memori dan DB', () => {
    const db = dbBaru();
    simpanStateBlokir(db, 3, Date.now() + TUNDA_BLOKIR_MS);
    sesi.gagal = 3;
    sesi.blokirSampai = Date.now() + TUNDA_BLOKIR_MS;

    expect(setupPin(db, '123456')).toBeNull();
    expect(statusKunci(db).gagal).toBe(0);
    expect(statusKunci(db).blokirDetik).toBe(0);
    expect(getPengaturan(db, KUNCI_KEAMANAN_GAGAL)).toBe('0');
    expect(getPengaturan(db, KUNCI_KEAMANAN_BLOKIR_SAMPAI)).toBe('0');
    db.close();
  });

  it('muatStateBlokir menimpa penuh: DB baru tanpa key tidak mewarisi state proses', () => {
    sesi.gagal = 4;
    sesi.blokirSampai = Date.now() + TUNDA_BLOKIR_MS;
    const db = dbBaru();
    muatStateBlokir(db);
    expect(statusKunci(db).gagal).toBe(0);
    expect(statusKunci(db).blokirDetik).toBe(0);
    db.close();
  });
});

describe('AUD-19 — kode darurat per-install (hash, tampil sekali)', () => {
  it('membuat kode acak sekali saat setup dan hanya menyimpan hash+salt', () => {
    const db = dbBaru();
    expect(setupPin(db, '123456')).toBeNull();
    const kode = ambilKodeDaruratSekali();
    expect(kode).not.toBeNull();
    expect(kodeDaruratDiatur(db)).toBe(true);
    expect(statusKunci(db).kodeDaruratDiatur).toBe(true);
    expect(ambilKodeDaruratSekali()).toBeNull();

    const salt = getPengaturan(db, KUNCI_RESET_SALT)!;
    const hash = getPengaturan(db, KUNCI_RESET_HASH)!;
    expect(salt).toMatch(/^[0-9a-f]{32}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifikasiHash(normalkanKodeDarurat(kode!), salt, hash)).toBe(true);
    expect(verifikasiHash(normalkanKodeDarurat('SALAH'), salt, hash)).toBe(false);

    // Plaintext tidak boleh ada di nilai pengaturan maupun audit.
    const nilai = db
      .prepare('SELECT kunci, nilai FROM pengaturan')
      .all() as { kunci: string; nilai: string }[];
    const audit = db
      .prepare('SELECT aksi, alasan, data_lama_json, data_baru_json FROM audit_log')
      .all() as Record<string, string>[];
    const semuaTeks = [
      ...nilai.map((r) => `${r.kunci}=${r.nilai}`),
      ...audit.map((r) => Object.values(r).join(' ')),
    ].join('\n');
    for (const rahasia of [kode!, normalkanKodeDarurat(kode!)]) {
      expect(semuaTeks).not.toContain(rahasia);
    }
    db.close();
  });

  it('kode acak yang dibuat berbeda dan mudah dibaca', () => {
    const a = buatKodeDarurat();
    const b = buatKodeDarurat();
    expect(a).not.toBe(b);
    for (const kode of [a, b]) {
      expect(kode).toMatch(/^(?:[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}-){3}[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
      expect(kode).not.toMatch(/[01OIL]/);
    }
  });

  it('rotate: kode lama langsung gagal, kode baru berhasil', () => {
    const db = dbBaru();
    expect(setupPin(db, '123456')).toBeNull();
    const lama = ambilKodeDaruratSekali()!;
    const baru = gantiKodeDarurat(db);
    expect(baru).toMatch(/^(?:[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}-){3}[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
    expect(baru).not.toBe(lama);
    expect(statusKunci(db).kodeDaruratDiatur).toBe(true);

    kunciLagi();
    expect(resetPaksa(db, lama, '777777')).toMatch(/kode darurat salah/i);
    expect(statusKunci(db).terbuka).toBe(false);
    expect(resetPaksa(db, baru, '777777')).toBeNull();
    expect(statusKunci(db).terbuka).toBe(true);
    kunciLagi();
    expect(bukaKunci(db, '777777')).toBeNull();
    db.close();
  });

  it('instalasi lama tanpa reset_hash ditolak dengan pesan jelas, tanpa default lama', () => {
    const db = dbBaru();
    expect(setupPin(db, '123456')).toBeNull();
    ambilKodeDaruratSekali();
    // Simulasikan DB lama: PIN ada, kode darurat belum pernah dibuat.
    db.prepare('DELETE FROM pengaturan WHERE kunci IN (?, ?)').run(
      KUNCI_RESET_SALT,
      KUNCI_RESET_HASH,
    );
    expect(kodeDaruratDiatur(db)).toBe(false);
    expect(statusKunci(db).kodeDaruratDiatur).toBe(false);
    kunciLagi();

    for (const kode of ['KODE-LAMA-TIDAK-BERLAKU', 'PURA-CONTOH-LAMA', '']) {
      const err = resetPaksa(db, kode, '777777');
      expect(err).toMatch(/kode darurat belum diatur/i);
      expect(err).toMatch(/pengaturan/i);
    }
    expect(statusKunci(db).terbuka).toBe(false);
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
