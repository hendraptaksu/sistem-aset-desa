// AUD-34 — helper logger main dapat diuji penuh tanpa Electron.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARSIP_LOG_MAKS,
  ARSIP_LOG_BAWAAN,
  UKURAN_MAKS_LOG_BYTE,
  buatLoggerApp,
  formatBarisLog,
  pathArsipLog,
  pathLogApp,
  rotasiLogJikaPerlu,
} from '../src/main/logApp.js';
import { deskripsiError, redaksiLog, satuBaris } from '../src/utils/logAman.js';

const dirs: string[] = [];

function dirUji(awalan = 'pura-log-'): string {
  const dir = mkdtempSync(join(tmpdir(), awalan));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('AUD-34 — path & format log', () => {
  it('menaruh log di <userData>/logs/app.log', () => {
    expect(UKURAN_MAKS_LOG_BYTE).toBe(1024 * 1024);
    expect(ARSIP_LOG_MAKS).toBe(3);
    expect(pathLogApp('/tmp/pura')).toBe(join('/tmp/pura', 'logs', 'app.log'));
    expect(pathArsipLog('/tmp/pura/logs/app.log', 2)).toBe(
      join('/tmp/pura', 'logs', 'app.log.2'),
    );
  });

  it('menolak userData kosong agar path tidak menebak folder kerja', () => {
    expect(() => pathLogApp('')).toThrow(/userData/);
    expect(() => pathLogApp('   ')).toThrow(/userData/);
  });

  it('memformat satu kejadian menjadi satu baris berstempel ISO', () => {
    expect(
      formatBarisLog(
        new Date('2026-10-27T01:02:03.000Z'),
        'INFO',
        'Aplikasi mulai\nmode INSTALLED',
      ),
    ).toBe('2026-10-27T01:02:03.000Z [INFO] Aplikasi mulai mode INSTALLED\n');

    expect(formatBarisLog('bukan-tanggal', 'WARN', '  spasi   berlebih  ')).toBe(
      '1970-01-01T00:00:00.000Z [WARN] spasi berlebih\n',
    );
  });

  it('meratakan teks multi-baris dan tidak pernah menulis baris kosong', () => {
    expect(satuBaris('a\n\tb   c')).toBe('a b c');
    expect(formatBarisLog(new Date(0), 'ERROR', '')).toBe(
      '1970-01-01T00:00:00.000Z [ERROR] (kosong)\n',
    );
  });
});

describe('AUD-34 — redaksi data sensitif', () => {
  it('menyamarkan PIN, hash, salt, token, dan header otorisasi', () => {
    const hash = 'a'.repeat(64);
    const hasil = redaksiLog(
      `pin: 123456; pinBaru="654321"; hash=${hash}; salt=abc123; ` +
        'Authorization: Bearer tokenRahasia123; aman=backup-2026-10-27.db',
    );

    expect(hasil).not.toContain('123456');
    expect(hasil).not.toContain('654321');
    expect(hasil).not.toContain(hash);
    expect(hasil).not.toContain('tokenRahasia123');
    expect(hasil).toContain('pin=[disunting]');
    expect(hasil).toContain('pinBaru=[disunting]');
    expect(hasil).toContain('Bearer [disunting]');
    // Teks operasional yang tidak sensitif tetap berguna.
    expect(hasil).toContain('aman=backup-2026-10-27.db');
  });

  it('tidak mengubah kalimat biasa yang hanya menyebut kata PIN', () => {
    expect(redaksiLog('PIN dipertahankan setelah restore')).toBe(
      'PIN dipertahankan setelah restore',
    );
    expect(redaksiLog('Backup otomatis 2026-10-27 selesai')).toBe(
      'Backup otomatis 2026-10-27 selesai',
    );
  });

  it('mendeskripsikan Error dan nilai non-Error tanpa melempar', () => {
    const err = new Error('gagal menyimpan');
    expect(deskripsiError(err)).toContain('gagal menyimpan');
    expect(deskripsiError('teks error')).toBe('teks error');
    expect(deskripsiError(null)).toBe('null');
    expect(deskripsiError(undefined)).toBe('undefined');
    expect(deskripsiError({ kode: 'EACCES' })).toBe('{"kode":"EACCES"}');
  });
});

describe('AUD-34 — rotasi ukuran log', () => {
  it('tidak berotasi bila file belum ada atau masih di bawah batas', () => {
    const dir = dirUji();
    const file = join(dir, 'logs', 'app.log');
    mkdirSync(join(dir, 'logs'), { recursive: true });

    expect(rotasiLogJikaPerlu(file, { batasByte: 10 })).toBe(false);

    writeFileSync(file, '1234567890');
    expect(rotasiLogJikaPerlu(file, { batasByte: 10 })).toBe(false);
    expect(existsSync(pathArsipLog(file, 1))).toBe(false);

    // Baris berikutnya akan melewati batas → rotasi sebelum tulis.
    expect(rotasiLogJikaPerlu(file, { batasByte: 10, tambahanByte: 1 })).toBe(true);
    expect(readFileSync(pathArsipLog(file, 1), 'utf8')).toBe('1234567890');
    expect(existsSync(file)).toBe(false);
  });

  it('menggeser arsip dan membuang arsip tertua (maks 3)', () => {
    const dir = dirUji();
    const file = join(dir, 'logs', 'app.log');
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(file, 'baru');
    writeFileSync(pathArsipLog(file, 1), 'satu');
    writeFileSync(pathArsipLog(file, 2), 'dua');

    expect(rotasiLogJikaPerlu(file, { batasByte: 1, arsip: 2 })).toBe(true);
    expect(readFileSync(pathArsipLog(file, 1), 'utf8')).toBe('baru');
    expect(readFileSync(pathArsipLog(file, 2), 'utf8')).toBe('satu');
    expect(existsSync(pathArsipLog(file, 3))).toBe(false);

    // Nilai arsip di luar 1..3 dijepit ke batas aman.
    writeFileSync(file, 'paling-baru');
    writeFileSync(pathArsipLog(file, 1), 'lama-1');
    writeFileSync(pathArsipLog(file, 2), 'lama-2');
    writeFileSync(pathArsipLog(file, 3), 'lama-3');
    expect(rotasiLogJikaPerlu(file, { batasByte: 1, arsip: 9 })).toBe(true);
    expect(readFileSync(pathArsipLog(file, 1), 'utf8')).toBe('paling-baru');
    expect(readFileSync(pathArsipLog(file, 2), 'utf8')).toBe('lama-1');
    expect(readFileSync(pathArsipLog(file, 3), 'utf8')).toBe('lama-2');
    expect(existsSync(pathArsipLog(file, 4))).toBe(false);
  });

  it('memakai dua arsip sebagai default', () => {
    expect(ARSIP_LOG_BAWAAN).toBe(2);
  });
});

describe('AUD-34 — logger file', () => {
  it('menulis INFO/WARN/ERROR, meredaksi PIN, dan menyalin ke konsol', () => {
    const dir = dirUji();
    const konsol: string[] = [];
    const log = buatLoggerApp({
      userDataDir: dir,
      sekarang: () => new Date('2026-10-27T02:00:00.000Z'),
      konsol: {
        log: (p) => konsol.push(`log:${p}`),
        warn: (p) => konsol.push(`warn:${p}`),
        error: (p) => konsol.push(`error:${p}`),
      },
    });

    expect(log.file).toBe(pathLogApp(dir));
    log.info('Aplikasi mulai v2.0.0');
    log.warn('Backup lambat');
    log.error('Restore gagal', new Error('PIN: 123456 tidak valid'));

    const isi = readFileSync(log.file, 'utf8');
    const baris = isi.trimEnd().split('\n');
    expect(baris).toHaveLength(3);
    expect(baris[0]).toBe('2026-10-27T02:00:00.000Z [INFO] Aplikasi mulai v2.0.0');
    expect(baris[1]).toBe('2026-10-27T02:00:00.000Z [WARN] Backup lambat');
    expect(baris[2]).toContain('[ERROR] Restore gagal: Error: PIN=[disunting]');
    expect(isi).not.toContain('123456');
    expect(konsol).toHaveLength(3);
    expect(konsol[2]).not.toContain('123456');
  });

  it('berotasi otomatis saat file aktif melewati batas', () => {
    const dir = dirUji();
    const log = buatLoggerApp({
      userDataDir: dir,
      batasByte: 120,
      arsip: 1,
      sekarang: () => new Date('2026-10-27T02:00:00.000Z'),
      konsol: null,
    });

    for (let i = 1; i <= 4; i += 1) log.info(`kejadian-${i} ${'x'.repeat(40)}`);

    expect(statSync(log.file).size).toBeLessThanOrEqual(120);
    expect(existsSync(pathArsipLog(log.file, 1))).toBe(true);
    expect(existsSync(pathArsipLog(log.file, 2))).toBe(false);
    expect(readFileSync(pathArsipLog(log.file, 1), 'utf8')).toContain('kejadian-');
  });

  it('tidak pernah melempar saat folder log tidak bisa dibuat', () => {
    const dir = dirUji();
    const bukanFolder = join(dir, 'berkas');
    writeFileSync(bukanFolder, 'x');

    const log = buatLoggerApp({ userDataDir: bukanFolder, konsol: null });
    expect(() => log.info('tidak boleh melempar')).not.toThrow();
    expect(() => log.warn('tetap aman')).not.toThrow();
    expect(() => log.error('gagal', new Error('x'))).not.toThrow();
  });
});
