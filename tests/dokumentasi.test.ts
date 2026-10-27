// P2-8 — dokumentasi pengguna, pemeriksaan, dan portable.
// AUD-31 — versi, README, arsip ERD, dan istilah baru.
// Fokus: file ada, istilah kunci tersedia, dan contoh path di dokumen cocok
// dengan helper `tentukanLokasiData` (bukan snapshot seluruh file).
import { existsSync, readFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { tentukanLokasiData } from '../src/main/lokasiData.js';

const docsDir = fileURLToPath(new URL('../docs/', import.meta.url));
const rootDir = fileURLToPath(new URL('../', import.meta.url));
const baca = (nama: string): string => readFileSync(join(docsDir, nama), 'utf-8');
const bacaRoot = (nama: string): string => readFileSync(join(rootDir, nama), 'utf-8');

const PENGGUNA = baca('panduan-pengguna.md');
const PEMERIKSAAN = baca('panduan-pemeriksaan.md');
const PORTABLE = baca('panduan-portable.md');
const README = bacaRoot('README.md');
const PAKET = JSON.parse(bacaRoot('package.json')) as { version: string };

describe('AUD-31 — versi, README, dan arsip ERD', () => {
  it('versi package dan header panduan aktif konsisten', () => {
    expect(PAKET.version).toBe('2.0.0');
    expect(README).toContain('**Versi:** 2.0.0');
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, PORTABLE]) {
      expect(dokumen).toContain('**Versi aplikasi:** 2.0.0');
    }
  });

  it('README memuat ringkasan, arsitektur, perintah, data, backup, dan status', () => {
    for (const istilah of [
      'Ringkasan',
      'Arsitektur satu halaman',
      'npm run dev',
      'npm test',
      'npm run typecheck',
      'npm run build',
      'npm run dist:win',
      'pura.db',
      'attachments',
      'backups',
      'Backup Lengkap',
      'POC',
      'produksi',
    ]) {
      expect(README, `README memuat "${istilah}"`).toContain(istilah);
    }
  });

  it('README dan panduan menjelaskan PIN bukan enkripsi', () => {
    for (const dokumen of [README, PENGGUNA, PEMERIKSAAN, PORTABLE]) {
      expect(dokumen).toMatch(/PIN[^\n]*bukan enkripsi|bukan enkripsi/i);
      expect(dokumen).toContain('pura.db');
    }
  });

  it('ERD v1 diarsipkan dan tidak menjadi acuan aktif', () => {
    expect(existsSync(join(docsDir, 'erd-dan-arsitektur.md'))).toBe(false);
    const arsip = baca('erd-v1-arsip.md');
    expect(arsip).toMatch(/BUKAN ACUAN AKTIF/i);
    expect(arsip).toContain('single-entry');
  });

  it('.env.example menyebut 240 jurnal dan tidak memuat kode darurat global', () => {
    const env = bacaRoot('.env.example');
    expect(env).toContain('240 jurnal');
    expect(env).not.toContain('240 transaksi');
    expect(env).not.toContain('PURA_RESET_CODE');
    expect(env).toMatch(/kode darurat[^\n]*(per-install|tampil sekali)/i);
  });
});

describe('P2-8 — panduan pengguna', () => {
  it('ada, bertanggal, dan memuat istilah kunci operator', () => {
    expect(PENGGUNA).toContain('2026-10-27');
    for (const istilah of [
      'Terima Uang',
      'Bayar',
      'Pindah Dana',
      'Panjar',
      'Piutang & Hutang',
      'Jurnal Umum',
      'Tutup buku',
      'ganti laptop',
      'PIN',
      'kas minus',
      'Periode sudah ditutup',
      'Nomor bukti',
      'Pratinjau Cetak',
      'Simpan PDF',
      'Troubleshooting',
      'pura.db',
      'attachments',
      'backups',
      'JU-',
      'Neraca Saldo',
      'Tahun berjalan',
      'Kumulatif sejak awal',
      'Laba ditahan sebelum periode',
      'Backup Lengkap',
      'Restore Lengkap',
      'bukan enkripsi',
      'restore',
      'portable',
    ]) {
      expect(PENGGUNA, `istilah "${istilah}"`).toContain(istilah);
    }
  });
});

describe('P2-8 — panduan pemeriksaan akuntan', () => {
  it('mencakup seluruh laporan dan glosarium debit/kredit', () => {
    expect(PEMERIKSAAN).toContain('2026-10-27');
    for (const istilah of [
      'Jurnal Umum',
      'Buku Besar',
      'Neraca Saldo',
      'Tahun berjalan',
      'Kumulatif sejak awal',
      'Laba ditahan sebelum periode',
      'Laba Rugi',
      'Neraca',
      'Arus Kas',
      'Rekonsiliasi Bank',
      'Anggaran',
      'reversal',
      'tutup buku',
      'audit',
      'bukan enkripsi',
      'Debit',
      'Kredit',
      'Aktiva',
      'Kewajiban',
      'Ekuitas',
      'Pendapatan',
      'Beban',
      'Laba ditahan',
      'selisih 0',
    ]) {
      expect(PEMERIKSAAN, `istilah "${istilah}"`).toContain(istilah);
    }
  });
});

describe('P2-8 — panduan portable', () => {
  it('menjelaskan installer vs portable dan peringatan dua salinan', () => {
    expect(PORTABLE).toContain('2026-10-27');
    expect(PORTABLE).toContain('%APPDATA%\\Keuangan Pura Dalem Puri');
    expect(PORTABLE).toContain('<folder exe>\\data\\pura.db');
    expect(PORTABLE).toContain('attachments');
    expect(PORTABLE).toContain('backups');
    expect(PORTABLE).toMatch(/dua salinan portable dari folder berbeda/i);
    expect(PORTABLE).toMatch(/jangan menyalin hanya file `?\.exe`?/i);
  });
});

describe('P2-8 — konsistensi path dokumen dengan helper', () => {
  const userDataWin = win32.join(
    'C:',
    'Users',
    'Budi',
    'AppData',
    'Roaming',
    'Keuangan Pura Dalem Puri',
  );
  const portableDirWin = win32.join('D:', 'Keuangan Pura Dalem Puri');

  it('contoh installer memakai path yang dihasilkan tentukanLokasiData', () => {
    const lokasi = tentukanLokasiData({ userDataDir: userDataWin });
    expect(lokasi.mode).toBe('INSTALLED');
    for (const path of [
      lokasi.dataDir,
      lokasi.dbPath,
      lokasi.attachmentsDir,
      lokasi.backupsDir,
    ]) {
      expect(PORTABLE, path).toContain(path);
    }
  });

  it('contoh portable menaruh data/attachments/backups di folder exe', () => {
    const lokasi = tentukanLokasiData({
      userDataDir: userDataWin,
      portableDir: portableDirWin,
    });
    expect(lokasi.mode).toBe('PORTABLE');
    expect(lokasi.dbPath).toBe(
      win32.join('D:', 'Keuangan Pura Dalem Puri', 'data', 'pura.db'),
    );
    for (const path of [
      lokasi.dataDir,
      lokasi.dbPath,
      lokasi.attachmentsDir,
      lokasi.backupsDir,
    ]) {
      expect(PORTABLE, path).toContain(path);
    }
    // Jangan sampai dokumen mengklaim data portable ada di AppData.
    expect(PORTABLE).not.toContain(
      win32.join('C:', 'Users', 'Budi', 'AppData', 'Roaming', 'Keuangan Pura Dalem Puri', 'data', 'pura.db') +
        ' (portable)',
    );
  });
});
