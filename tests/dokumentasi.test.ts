// T5.7 — kontrak dokumen kanonik.
//
// Fokus pada hal yang stabil, bukan detail historis per tiket:
// - dokumen kanonik ada dan daftar `docs/*.md` sama persis dengan daftar ini;
// - istilah akuntansi kunci tersedia di dokumen yang tepat;
// - modul yang sudah dihapus tidak ditawarkan lagi;
// - path dokumen di README benar-benar ada.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
const SKEMA = baca('skema.md');
const PRINSIP = baca('prinsip-akuntansi.md');
const README = bacaRoot('README.md');

/**
 * Satu-satunya markdown yang boleh ada di `docs/`. Menambah dokumen historis
 * baru harus mengubah daftar ini secara sadar, bukan menumpuk arsip tiket.
 */
const DOKUMEN_KANONIK = [
  'skema.md',
  'prinsip-akuntansi.md',
  'panduan-pengguna.md',
  'panduan-pemeriksaan.md',
  'panduan-portable.md',
  'hardening-electron.md',
  'debugging.md',
  'template-cetak.md',
  'rilis.md',
] as const;

const DOKUMEN_PENGGUNA = [README, PENGGUNA, PEMERIKSAAN, PORTABLE, SKEMA, PRINSIP];

describe('dokumen kanonik', () => {
  it('seluruh dokumen kanonik ada', () => {
    for (const nama of DOKUMEN_KANONIK) {
      expect(existsSync(join(docsDir, nama)), `docs/${nama} tidak ada`).toBe(true);
    }
  });

  it('daftar docs/*.md sama persis dengan daftar kanonik', () => {
    const diDisk = readdirSync(docsDir)
      .filter((nama) => nama.endsWith('.md'))
      .sort();
    expect(diDisk).toEqual([...DOKUMEN_KANONIK].sort());
  });
});

describe('istilah akuntansi kunci', () => {
  it('prinsip akuntansi memuat konsep double-entry dan koreksi', () => {
    for (const istilah of [
      'double-entry',
      'debit',
      'kredit',
      'jurnal',
      'reversal',
      'kunci periode',
      'panjar',
      'pinjaman',
    ]) {
      expect(PRINSIP, `prinsip akuntansi memuat "${istilah}"`).toContain(istilah);
    }
  });

  it('panduan pemeriksaan memuat laba ditahan dan selisih nol', () => {
    expect(PEMERIKSAAN).toContain('laba ditahan');
    expect(PEMERIKSAAN).toContain('selisih 0');
  });

  it('panduan pengguna/pemeriksaan/portable menjelaskan PIN, backup, dan pura.db', () => {
    for (const dokumen of [PENGGUNA, PEMERIKSAAN, PORTABLE]) {
      expect(dokumen).toMatch(/PIN[^\n]*bukan enkripsi|bukan enkripsi/i);
      expect(dokumen).toContain('Backup Lengkap');
      expect(dokumen).toContain('pura.db');
    }
  });

  it('dokumen skema memuat kontrak sumber angka dan STRICT', () => {
    for (const istilah of [
      'satu-satunya sumber angka',
      'STRICT',
      'jurnal_baris',
      'panjar_item',
      'pinjaman_bayar',
    ]) {
      expect(SKEMA, `skema memuat "${istilah}"`).toContain(istilah);
    }
  });

  it('keputusan enkripsi backup T3.3 tercatat di README dan panduan pengguna', () => {
    // Keputusan rilis ini: dokumentasi + imbauan media terenkripsi, bukan
    // implementasi SQLCipher/arsip terenkripsi.
    expect(README).toMatch(/Keputusan enkripsi backup/i);
    expect(README).toMatch(/backup[^\n]*tidak (di|ter)?enkripsi/i);
    expect(README).toMatch(/PIN bukan enkripsi/i);
    expect(README).toMatch(/disk\/volume terenkripsi|media\/disk yang terenkripsi|enkripsi disk/i);
    expect(README).toMatch(/tiket terpisah/i);
    expect(README).toMatch(/SQLCipher/i);
    expect(README).toMatch(/arsip terenkripsi/i);

    expect(PENGGUNA).toMatch(/backup[^\n]*tidak terenkripsi/i);
    expect(PENGGUNA).toMatch(/PIN bukan enkripsi/i);
    expect(PENGGUNA).toMatch(/(media\/disk|disk\/flashdisk) yang terenkripsi/i);
    expect(PENGGUNA).toMatch(/cloud publik/i);
    expect(PENGGUNA).toMatch(/hapus salinan lama/i);

    // Peringatan harus terlihat di sumber UI, bukan hanya komentar/tooltip.
    const dashboard = bacaRoot('src/renderer/components/DashboardTab.tsx');
    expect(dashboard).toContain('<PeringatanBackupTidakTerenkripsi />');
    expect(dashboard).toContain('File backup tidak terenkripsi.');
    expect(dashboard).toMatch(/PIN hanya melindungi aplikasi/i);
    expect(dashboard).toMatch(/media\/disk yang terenkripsi/i);
    expect(dashboard).toContain('data-testid="peringatan-backup-tidak-terenkripsi"');
  });

  it('keputusan audit actor & hash chain T3.5 tidak hilang dari dokumen', () => {
    // Keputusan rilis v1: pertahankan trigger append-only + dokumentasi
    // risiko, tanpa kolom actor/hash dan tanpa perubahan skema. Opsi
    // aktor/hash chain dicatat untuk skema v2 lewat tiket terpisah.
    for (const istilah of [
      'tamper-evident',
      'actor',
      'hash chain',
      'skema v2',
      'append-only',
    ]) {
      expect(PRINSIP, `prinsip akuntansi memuat "${istilah}"`).toContain(
        istilah,
      );
    }
    expect(PRINSIP).toMatch(/tidak mencatat actor/i);
    expect(PRINSIP).toMatch(/tabel chain terpisah/i);
    expect(PRINSIP).toMatch(/anchor eksternal/i);
    expect(PRINSIP).toMatch(/tiket terpisah/i);

    // Catatan singkat di kontrak skema harus menunjuk keputusan lengkapnya.
    expect(SKEMA).toMatch(/audit_log` v1[^\n]*tidak memiliki kolom `actor`/i);
    expect(SKEMA).toMatch(/tidak tamper-evident/i);
    expect(SKEMA).toMatch(/hash chain/i);
    expect(SKEMA).toMatch(/prinsip-akuntansi\.md/);
  });
});

describe('runbook pemulihan T3.9', () => {
  it('README dan panduan pengguna memuat langkah saldo awal, backup, dan DB ditolak', () => {
    for (const dokumen of [README, PENGGUNA]) {
      expect(dokumen).toContain('Koreksi Saldo Awal');
      expect(dokumen).toContain('pre-restore');
      expect(dokumen).toMatch(/tabel\/kolom[^\n]*(hilang|wajib)/i);
      expect(dokumen).toMatch(/pulihkan dari backup/i);
      expect(dokumen).toMatch(/bukan enkripsi/i);
      expect(dokumen).toMatch(/tidak terenkripsi/i);
    }
  });

  it('skema menegaskan DB v2 tidak lengkap dipulihkan dari backup, bukan dibuat ulang', () => {
    expect(SKEMA).toMatch(/SCHEMA_VERSION\s*=\s*2/);
    expect(SKEMA).toMatch(/tabel wajib hilang|kolom wajib hilang/i);
    expect(SKEMA).toMatch(/pulihkan dari backup/i);
    expect(SKEMA).toMatch(/tidak\s*\**\s*membuat ulang|bukan dibuat ulang/i);
  });

  it('panduan pemeriksaan memuat checklist cepat pemulihan', () => {
    for (const frasa of [
      'Status saldo awal',
      'KOREKSI-SALDO-AWAL',
      'Backup terakhir',
      'integrity_check',
      'Lockout PIN',
    ]) {
      expect(PEMERIKSAAN, `panduan pemeriksaan memuat "${frasa}"`).toContain(frasa);
    }
  });
});

describe('modul yang sudah dihapus', () => {
  it('tidak ditawarkan lagi di dokumen kanonik', () => {
    for (const dokumen of DOKUMEN_PENGGUNA) {
      expect(dokumen).not.toContain('Rekonsiliasi Bank');
      expect(dokumen).not.toMatch(/\banggaran\b/i);
      expect(dokumen).not.toMatch(/import\s+excel/i);
      expect(dokumen).not.toMatch(/impor\s+jurnal/i);
      expect(dokumen).not.toMatch(/template\s+impor/i);
      expect(dokumen).not.toMatch(/\blampiran\b/i);
      expect(dokumen).not.toContain('attachments');
      expect(dokumen).not.toMatch(/master\s+pihak/i);
      expect(dokumen).not.toMatch(/Piutang\s*(&|\/)\s*Hutang/i);
    }
  });
});

describe('kebersihan dokumentasi', () => {
  it('semua path dokumen yang ditautkan README benar-benar ada', () => {
    const tautan = [...README.matchAll(/docs\/[A-Za-z0-9._/-]+\.md/g)].map(
      (m) => m[0],
    );
    expect(tautan.length).toBeGreaterThan(5);
    for (const path of new Set(tautan)) {
      expect(existsSync(join(rootDir, path)), `${path} tidak ada`).toBe(true);
    }
  });
});

describe('konsistensi path panduan portable dengan helper', () => {
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
    for (const path of [lokasi.dataDir, lokasi.dbPath, lokasi.backupsDir]) {
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
    for (const path of [lokasi.dataDir, lokasi.dbPath, lokasi.backupsDir]) {
      expect(PORTABLE, path).toContain(path);
    }
  });
});
