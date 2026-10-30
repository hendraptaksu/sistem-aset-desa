// P2-8 — lokasi data yang dapat diprediksi untuk installer, portable, dan
// override dev. Modul murni: tidak menyentuh filesystem/Electron.
import { posix, win32 } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tentukanLokasiData } from '../src/main/lokasiData.js';

describe('P2-8 — lokasi data installer (POSIX)', () => {
  const userData = posix.join('/home', 'budi', '.config', 'Keuangan Pura Dalem Puri');

  it('menaruh DB & backup di <userData>/data', () => {
    const lokasi = tentukanLokasiData({ userDataDir: userData });

    expect(lokasi).toEqual({
      mode: 'INSTALLED',
      dataDir: posix.join(userData, 'data'),
      dbPath: posix.join(userData, 'data', 'pura.db'),
      backupsDir: posix.join(userData, 'data', 'backups'),
    });
    expect(lokasi.dbPath.endsWith(posix.join('data', 'pura.db'))).toBe(true);
    expect(lokasi.backupsDir.endsWith(posix.join('data', 'backups'))).toBe(true);
  });
});

describe('P2-8 — lokasi data installer (Windows)', () => {
  const userData = win32.join(
    'C:',
    'Users',
    'Budi',
    'AppData',
    'Roaming',
    'Keuangan Pura Dalem Puri',
  );

  it('memakai pemisah Windows dan struktur folder yang sama', () => {
    const lokasi = tentukanLokasiData({ userDataDir: userData });

    expect(lokasi).toEqual({
      mode: 'INSTALLED',
      dataDir: win32.join(userData, 'data'),
      dbPath: win32.join(userData, 'data', 'pura.db'),
      backupsDir: win32.join(userData, 'data', 'backups'),
    });
    expect(lokasi.dbPath).toContain(win32.sep);
    expect(lokasi.dbPath).not.toContain('/');
  });
});

describe('P2-8 — lokasi data portable (POSIX & Windows)', () => {
  it('menaruh data dan backup di dalam folder exe (POSIX)', () => {
    const portableDir = posix.join('/media', 'flashdisk', 'Keuangan Pura Dalem Puri');
    const lokasi = tentukanLokasiData({
      userDataDir: posix.join('/home', 'budi', '.config', 'Keuangan Pura Dalem Puri'),
      portableDir,
    });

    expect(lokasi).toEqual({
      mode: 'PORTABLE',
      dataDir: posix.join(portableDir, 'data'),
      dbPath: posix.join(portableDir, 'data', 'pura.db'),
      backupsDir: posix.join(portableDir, 'backups'),
    });
  });

  it('memakai folder exe yang sama persis di Windows', () => {
    const portableDir = win32.join('D:', 'Keuangan Pura Dalem Puri');
    const lokasi = tentukanLokasiData({
      userDataDir: win32.join('C:', 'Users', 'Budi', 'AppData', 'Roaming', 'Keuangan Pura Dalem Puri'),
      portableDir,
    });

    expect(lokasi).toEqual({
      mode: 'PORTABLE',
      dataDir: win32.join(portableDir, 'data'),
      dbPath: win32.join(portableDir, 'data', 'pura.db'),
      backupsDir: win32.join(portableDir, 'backups'),
    });
    expect(lokasi.dbPath).toBe(win32.join('D:', 'Keuangan Pura Dalem Puri', 'data', 'pura.db'));
  });
});

describe('P2-8 — override PURA_DB (dev/test)', () => {
  const userData = posix.join('/home', 'budi', '.config', 'Keuangan Pura Dalem Puri');

  it('memberi prioritas PURA_DB di atas mode portable', () => {
    const overrideDbPath = posix.join('/repo', 'data', 'pura-dev.db');
    const lokasi = tentukanLokasiData({
      userDataDir: userData,
      portableDir: posix.join('/media', 'flashdisk', 'Keuangan'),
      overrideDbPath,
    });

    expect(lokasi).toEqual({
      mode: 'OVERRIDE',
      dataDir: posix.join('/repo', 'data'),
      dbPath: overrideDbPath,
      backupsDir: posix.join('/repo', 'data', 'backups'),
    });
  });

  it('mendukung path Windows dan path relatif dev', () => {
    const userDataWin = win32.join('C:', 'Users', 'Budi', 'AppData', 'Roaming', 'Keuangan');
    const overrideWin = win32.join('E:', 'PURA', 'data dev', 'pura-dev.db');
    expect(
      tentukanLokasiData({ userDataDir: userDataWin, overrideDbPath: overrideWin }),
    ).toEqual({
      mode: 'OVERRIDE',
      dataDir: win32.join('E:', 'PURA', 'data dev'),
      dbPath: overrideWin,
      backupsDir: win32.join('E:', 'PURA', 'data dev', 'backups'),
    });

    expect(
      tentukanLokasiData({ userDataDir: userData, overrideDbPath: posix.join('data', 'pura-dev.db') }),
    ).toMatchObject({
      mode: 'OVERRIDE',
      dataDir: 'data',
      dbPath: posix.join('data', 'pura-dev.db'),
      backupsDir: posix.join('data', 'backups'),
    });
  });
});

describe('P2-8 — masukan kosong & validasi', () => {
  it('mengabaikan portable/override kosong dan kembali ke installer', () => {
    const userData = posix.join('/home', 'budi', 'data-app');
    const lokasi = tentukanLokasiData({
      userDataDir: userData,
      portableDir: '   ',
      overrideDbPath: '',
    });
    expect(lokasi.mode).toBe('INSTALLED');
    expect(lokasi.dbPath).toBe(posix.join(userData, 'data', 'pura.db'));
  });

  it('menolak userData kosong karena lokasi tidak bisa diprediksi', () => {
    expect(() => tentukanLokasiData({ userDataDir: '  ' })).toThrow(/userData/);
  });
});
