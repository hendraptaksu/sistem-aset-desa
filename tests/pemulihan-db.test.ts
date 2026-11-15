// AUD-16: layar pemulihan saat database gagal dibuka.
// Pesan tidak boleh membocorkan stack/SQL, tetapi wajib menyebut path DB.
// Alur retry harus benar-benar mencoba membuka ulang hanya setelah user memilih.

import { describe, expect, it, vi } from 'vitest';
import {
  aksiPemulihanDariRespons,
  bukaDbDenganPemulihan,
  pesanGagalBukaDb,
} from '../src/main/pemulihanDb.js';

const DB_PATH = '/tmp/pura-smoke/data/pura.db';

describe('AUD-16 — pesanGagalBukaDb', () => {
  it('menyertakan path database dan panduan pemulihan yang ramah', () => {
    const pesan = pesanGagalBukaDb(new Error('boom'), DB_PATH);
    expect(pesan).toContain(DB_PATH);
    expect(pesan).toContain('Data Anda tidak dihapus');
    expect(pesan).toContain('Buka folder backup');
    expect(pesan).toContain('Coba lagi');
    expect(pesan).toContain('Keluar');
  });

  it('tidak membocorkan stack trace, SQL, atau pesan error mentah', () => {
    const error = new Error(
      'SqliteError: file is not a database\n' +
        '    at Database.prepare (/Users/taksu/app/src/db/database.ts:305:7)\n' +
        'SQL: SELECT * FROM jurnal WHERE id = ?',
    );
    const pesan = pesanGagalBukaDb(error, DB_PATH);
    expect(pesan).not.toContain('SqliteError');
    expect(pesan).not.toContain('SQL');
    expect(pesan).not.toContain('SELECT');
    expect(pesan).not.toContain('database.ts');
    expect(pesan).not.toContain('at Database');
    expect(pesan).not.toContain('boom');
  });

  it('memetakan kode error menjadi petunjuk aman tanpa kode mentah', () => {
    const kasus: [string, string][] = [
      ['SQLITE_NOTADB', 'rusak atau bukan file data aplikasi'],
      ['ENOSPC', 'Ruang penyimpanan mungkin penuh'],
      ['EACCES', 'tidak punya izin menulis'],
      ['SQLITE_BUSY', 'sedang dipakai aplikasi lain'],
    ];
    for (const [code, petunjuk] of kasus) {
      const pesan = pesanGagalBukaDb(Object.assign(new Error('raw'), { code }), DB_PATH);
      expect(pesan).toContain(petunjuk);
      expect(pesan).not.toContain(code);
      expect(pesan).not.toContain('raw');
    }
  });

  it('tetap aman saat error bukan Error dan path kosong', () => {
    const pesan = pesanGagalBukaDb(null, '   ');
    expect(pesan).toContain('(lokasi tidak diketahui)');
    expect(pesan).toContain('Data Anda tidak dihapus');
  });

  it('DB lama berskema tidak didukung memakai pesan khusus tanpa kata rusak', () => {
    const error = new Error(
      'File database ini dibuat oleh versi/skema lama dan tidak kompatibel. ' +
        'Aplikasi hanya mendukung skema v2. Pindahkan atau hapus file database lama ' +
        'tersebut, lalu jalankan aplikasi lagi.',
    );
    const pesan = pesanGagalBukaDb(error, DB_PATH);
    expect(pesan).toContain('versi aplikasi yang berbeda');
    expect(pesan).toMatch(/kosongkan lokasi/i);
    expect(pesan).not.toMatch(/rusak/i);
  });
});

describe('AUD-16 — alur pemulihan database', () => {
  it('membuka ulang database setelah pengguna memilih Coba lagi', async () => {
    const buka = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw new Error('SQLITE_NOTADB');
      })
      .mockReturnValueOnce('db-terbuka');
    const tanya = vi.fn().mockResolvedValue('cobaLagi');
    const keluar = vi.fn();

    const hasil = await bukaDbDenganPemulihan({
      buka,
      tanya,
      bukaFolderBackup: vi.fn(),
      keluar,
    });

    expect(hasil).toBe('db-terbuka');
    expect(buka).toHaveBeenCalledTimes(2);
    expect(tanya).toHaveBeenCalledTimes(1);
    expect(keluar).not.toHaveBeenCalled();
  });

  it('berhenti tanpa membuka ulang saat pengguna memilih Keluar', async () => {
    const buka = vi.fn<() => string>().mockImplementation(() => {
      throw new Error('SQLITE_NOTADB');
    });
    const keluar = vi.fn();

    const hasil = await bukaDbDenganPemulihan({
      buka,
      tanya: vi.fn().mockResolvedValue('keluar'),
      bukaFolderBackup: vi.fn(),
      keluar,
    });

    expect(hasil).toBeNull();
    expect(buka).toHaveBeenCalledTimes(1);
    expect(keluar).toHaveBeenCalledTimes(1);
  });

  it('Buka folder backup tidak mencoba DB lagi sebelum pengguna memilih Coba lagi', async () => {
    const buka = vi
      .fn<() => string>()
      .mockImplementationOnce(() => {
        throw new Error('SQLITE_NOTADB');
      })
      .mockReturnValueOnce('db-terbuka');
    const tanya = vi
      .fn()
      .mockResolvedValueOnce('bukaBackup')
      .mockResolvedValueOnce('cobaLagi');
    const bukaFolderBackup = vi.fn().mockResolvedValue(undefined);

    const hasil = await bukaDbDenganPemulihan({
      buka,
      tanya,
      bukaFolderBackup,
      keluar: vi.fn(),
    });

    expect(hasil).toBe('db-terbuka');
    expect(bukaFolderBackup).toHaveBeenCalledTimes(1);
    expect(buka).toHaveBeenCalledTimes(2);
    expect(tanya).toHaveBeenCalledTimes(2);
  });

  it('memetakan tombol dialog dan respons tak dikenal dengan aman', () => {
    expect(aksiPemulihanDariRespons(0)).toBe('bukaBackup');
    expect(aksiPemulihanDariRespons(1)).toBe('cobaLagi');
    expect(aksiPemulihanDariRespons(2)).toBe('keluar');
    expect(aksiPemulihanDariRespons(99)).toBe('keluar');
    expect(aksiPemulihanDariRespons(-1)).toBe('keluar');
  });
});
