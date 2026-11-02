// P2-8 — dokumentasi pengguna, pemeriksaan, dan portable.
// AUD-31 — versi, README, dan istilah baru.
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
const ARAH = baca('arah-akuntansi.md');
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
      'Utang Usaha',
      'Jurnal Umum',
      'Kunci periode',
      'ganti laptop',
      'PIN',
      'kas minus',
      'Periode sudah ditutup',
      'Nomor bukti',
      'Pratinjau Cetak',
      'Simpan PDF',
      'Troubleshooting',
      'pura.db',
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
      'reversal',
      'kunci periode',
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

  it('DB-31: dokumen tidak lagi menawarkan Rekonsiliasi Bank', () => {
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, README, PORTABLE]) {
      expect(dokumen).not.toContain('Rekonsiliasi Bank');
    }
  });

  it('DB-24: dokumen tidak lagi menawarkan modul Anggaran', () => {
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, README, ARAH]) {
      expect(dokumen).not.toMatch(/anggaran/i);
    }
  });

  it('DB-25: dokumen tidak lagi menawarkan modul Import Excel', () => {
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, README, ARAH]) {
      expect(dokumen).not.toMatch(/import\s+excel/i);
      expect(dokumen).not.toMatch(/impor\s+jurnal/i);
      expect(dokumen).not.toMatch(/template\s+impor/i);
    }
  });

  it('DB-23a: dokumen tidak lagi menawarkan alur input piutang', () => {
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, README, ARAH]) {
      expect(dokumen).not.toContain('Piutang & Hutang');
      expect(dokumen).not.toMatch(/Piutang\/Hutang|piutang\/hutang/i);
    }
    // 1050 tetap dijelaskan sebagai akun data lama, bukan form input.
    expect(PENGGUNA).toContain('1050');
    expect(PENGGUNA).toMatch(/data lama/i);
    expect(PEMERIKSAAN).toMatch(/1050[^\n]*data lama/i);
  });

  it('DB-23b: dokumen menjelaskan utang usaha tanpa master pihak', () => {
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, README]) {
      expect(dokumen).not.toMatch(/master\s+pihak/i);
    }
    expect(PENGGUNA).toContain('Catat Utang Usaha');
    expect(PENGGUNA).toContain('Bayar Utang Usaha');
    expect(PENGGUNA).toContain('2060');
    expect(PENGGUNA).toMatch(/nama kreditur|kreditur/i);
    expect(PEMERIKSAAN).toContain('Catat Utang');
  });

  it('DB-37: dokumen tidak lagi menawarkan modul lampiran/attachments', () => {
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, README, PORTABLE]) {
      expect(dokumen).not.toMatch(/\blampiran\b/i);
      expect(dokumen).not.toContain('attachments');
    }
    // Panduan lama sudah dihapus, bukan dibiarkan menyesatkan.
    expect(existsSync(join(docsDir, 'lampiran-bukti.md'))).toBe(false);
    expect(PENGGUNA).toContain('Backup Lengkap');
    expect(README).toContain('manifest.json');
  });
});

describe('AKT-27 — dokumentasi akun legacy, kunci periode, dan reversal', () => {
  it('menjelaskan 3001/3002 sebagai akun legacy tanpa angka turunan v2', () => {
    expect(PEMERIKSAAN).toContain('3001 SALDO KUMULATIF');
    expect(PEMERIKSAAN).toContain('3002 SALDO BERJALAN');
    expect(PEMERIKSAAN).toContain('akun **legacy**');
    expect(PEMERIKSAAN).toContain('tidak dapat diposting');
    expect(PEMERIKSAAN).toMatch(/tidak\s+\*{0,2}menghitung/);
    // Teks lama AUD-22 salah: v2 tidak menghitung saldo 3001/3002.
    expect(PEMERIKSAAN).not.toMatch(/Nilai(nya)? dihitung dari tutup buku dan surplus/i);
  });

  it('menegaskan kunci periode bukan jurnal penutup manual', () => {
    for (const dokumen of [PEMERIKSAAN, PENGGUNA, ARAH]) {
      expect(dokumen).toMatch(/jurnal penutup manual/i);
      expect(dokumen).toMatch(/tidak membuat jurnal penutup/i);
    }
  });

  it('menyamakan default reversal dan alasan peringatan dengan perilaku aplikasi', () => {
    expect(PEMERIKSAAN).toMatch(/Default tanggal balik adalah tanggal jurnal asli/);
    expect(PEMERIKSAAN).toMatch(/termasuk ke\s+tahun berbeda/);
    expect(PEMERIKSAAN).toMatch(/alasan minimal 5\s+karakter/i);
    expect(PENGGUNA).toMatch(/tanggal jurnal asli/i);
    expect(PENGGUNA).toContain('termasuk ke tahun berbeda');
    expect(PENGGUNA).toMatch(/alasan minimal 5\s+karakter/i);
  });
});

describe('DB-17 — panduan Pindah Dana', () => {
  it('menyebut menu Transaksi → Pindah Dana, contoh nyata, dan bukan pendapatan/beban', () => {
    expect(PENGGUNA).toContain('**Transaksi** → pilih kartu **Pindah Dana**');
    expect(PENGGUNA).toContain('1014 — LPD 12.005150/DL/2020');
    expect(PENGGUNA).toContain('1001 KAS');
    expect(PENGGUNA).toMatch(/bukan pendapatan dan bukan beban/i);
    expect(PENGGUNA).toMatch(/total kas tetap/i);
    // Contoh harus tetap menegaskan arah jurnal: tujuan di debit, asal di kredit.
    expect(PENGGUNA).toMatch(/\*\*debit = dompet tujuan\*\*, \*\*kredit = dompet asal\*\*/i);
  });
});

describe('DB-18 — panduan panjar per nota', () => {
  it('menyebut input nota per baris dan jurnal close tetap agregat', () => {
    for (const istilah of [
      'nomor nota',
      'tanggal nota',
      'toko/penerima',
      'akun beban',
      'keterangan baris',
      '+ Tambah baris nota',
      'menggabungkan debit per akun',
      'tidak boleh setelah',
    ]) {
      expect(PENGGUNA, `istilah "${istilah}"`).toContain(istilah);
    }
  });
});

describe('P2-8 — panduan portable', () => {
  it('menjelaskan installer vs portable dan peringatan dua salinan', () => {
    expect(PORTABLE).toContain('2026-10-27');
    expect(PORTABLE).toContain('%APPDATA%\\Keuangan Pura Dalem Puri');
    expect(PORTABLE).toContain('<folder exe>\\data\\pura.db');
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
      lokasi.backupsDir,
    ]) {
      expect(PORTABLE, path).toContain(path);
    }
  });

  it('contoh portable menaruh data/backups di folder exe', () => {
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

describe('kebersihan dokumentasi', () => {
  it('semua dokumen yang ditautkan README benar-benar ada', () => {
    const tautan = [...README.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g)]
      .map((m) => m[0]);
    expect(tautan.length).toBeGreaterThan(5);
    for (const path of new Set(tautan)) {
      expect(existsSync(join(rootDir, path)), `${path} tidak ada`).toBe(true);
    }
  });
});
