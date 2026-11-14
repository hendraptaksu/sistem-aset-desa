// AUD-13 — usia backup, banner basi, dan penjadwal backup periodik.
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/database.js';
import { mulaiBackupPeriodik, sudahBackupUntukTanggal } from '../src/main/backupPeriodik.js';
import { BannerBackupBasi, PeringatanBackupTidakTerenkripsi } from '../src/renderer/components/DashboardTab.js';
import {
  BATAS_BACKUP_BASI_HARI,
  labelUsiaBackup,
  namaFileBackup,
  pesanBackupBasi,
  ringkasanBackup,
  tanggalDariPathBackup,
  toneStatusBackup,
  usiaBackupHari,
} from '../src/utils/backup.js';

describe('usiaBackupHari & pesan backup basi', () => {
  it('menghitung selisih hari kalender', () => {
    expect(usiaBackupHari('2026-10-20', '2026-10-23')).toBe(3);
    expect(usiaBackupHari('2026-10-23', '2026-10-23')).toBe(0);
    expect(usiaBackupHari('2026-10-24', '2026-10-23')).toBe(-1);
  });

  it('memakai tanggal lokal WITA saat sekarang berupa Date', () => {
    // 2026-10-22T16:30Z = 2026-10-23 00:30 WITA.
    expect(usiaBackupHari('2026-10-22', new Date('2026-10-22T16:30:00Z'))).toBe(1);
  });

  it('mengembalikan null untuk data tanggal yang tidak tersedia/valid', () => {
    for (const tanggal of [undefined, null, '', 'bukan-tanggal', '2026-13-01', '2026-02-30']) {
      expect(usiaBackupHari(tanggal, '2026-10-23')).toBeNull();
    }
    expect(usiaBackupHari('2026-10-20', '2026-02-30')).toBeNull();
    expect(usiaBackupHari('2026-10-20', new Date('invalid'))).toBeNull();
  });

  it('membaca tanggal dari nama file backup otomatis (POSIX/Windows)', () => {
    expect(tanggalDariPathBackup('/data/backups/auto-2026-10-23.db')).toBe('2026-10-23');
    expect(tanggalDariPathBackup('C:\\data\\backups\\auto-2026-10-20.db')).toBe('2026-10-20');
    expect(tanggalDariPathBackup('/data/backups/pura-2026.db')).toBeNull();
    expect(tanggalDariPathBackup(undefined)).toBeNull();
  });

  it('hanya memberi pesan bila backup lebih tua dari 2 hari', () => {
    expect(BATAS_BACKUP_BASI_HARI).toBe(2);
    expect(pesanBackupBasi(0)).toBeNull();
    expect(pesanBackupBasi(2)).toBeNull();
    expect(pesanBackupBasi(3)).toBe('Backup terakhir 3 hari lalu — buat backup sekarang.');
    expect(pesanBackupBasi(null)).toBeNull();
    expect(pesanBackupBasi(Number.NaN)).toBeNull();
  });

  it('banner amber dashboard tampil hanya untuk backup basi', () => {
    const basi = renderToStaticMarkup(createElement(BannerBackupBasi, { usiaHari: 3 }));
    expect(basi).toContain('role="alert"');
    expect(basi).toContain('bg-amber-50');
    expect(basi).toContain('Backup terakhir 3 hari lalu — buat backup sekarang.');
    expect(renderToStaticMarkup(createElement(BannerBackupBasi, { usiaHari: 2 }))).toBe('');
    expect(renderToStaticMarkup(createElement(BannerBackupBasi, { usiaHari: null }))).toBe('');
  });

  it('menampilkan peringatan backup tidak terenkripsi secara terlihat (T3.3)', () => {
    const html = renderToStaticMarkup(createElement(PeringatanBackupTidakTerenkripsi));
    expect(html).toContain('data-testid="peringatan-backup-tidak-terenkripsi"');
    expect(html).toContain('role="note"');
    expect(html).toContain('File backup tidak terenkripsi.');
    expect(html).toMatch(/PIN hanya melindungi aplikasi/i);
    expect(html).toMatch(/media\/disk yang terenkripsi/i);
    expect(html).toMatch(/jangan\s+unggah ke cloud publik/i);
  });
});

describe('ringkasan backup dashboard (UI-16)', () => {
  it('mengambil nama file dari path POSIX/Windows tanpa direktori', () => {
    expect(namaFileBackup('/data/backups/auto-2026-10-23.db')).toBe('auto-2026-10-23.db');
    expect(namaFileBackup('C:\\data\\backups\\auto-2026-10-20.db')).toBe(
      'auto-2026-10-20.db',
    );
    expect(namaFileBackup('')).toBeNull();
    expect(namaFileBackup(undefined)).toBeNull();
  });

  it('memberi label usia yang terbaca operator', () => {
    expect(labelUsiaBackup(0)).toBe('hari ini');
    expect(labelUsiaBackup(1)).toBe('1 hari lalu');
    expect(labelUsiaBackup(2)).toBe('2 hari lalu');
    expect(labelUsiaBackup(12)).toBe('12 hari lalu');
    for (const kosong of [null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(labelUsiaBackup(kosong)).toBe('Tanggal tidak diketahui');
    }
  });

  it('memilih tone badge: hijau segar, amber basi, batu tidak diketahui', () => {
    expect(toneStatusBackup(0)).toBe('green');
    expect(toneStatusBackup(BATAS_BACKUP_BASI_HARI)).toBe('green');
    expect(toneStatusBackup(BATAS_BACKUP_BASI_HARI + 1)).toBe('amber');
    for (const kosong of [null, undefined, Number.NaN, -1]) {
      expect(toneStatusBackup(kosong)).toBe('stone');
    }
  });

  it('menggabungkan path, tanggal, label, dan tone untuk kartu', () => {
    expect(ringkasanBackup('/data/backups/auto-2026-10-23.db', '2026-10-27')).toEqual({
      namaFile: 'auto-2026-10-23.db',
      tanggal: '2026-10-23',
      usiaHari: 4,
      label: '4 hari lalu',
      tone: 'amber',
    });
    expect(ringkasanBackup('/data/backups/auto-lama.db', '2026-10-27')).toEqual({
      namaFile: 'auto-lama.db',
      tanggal: null,
      usiaHari: null,
      label: 'Tanggal tidak diketahui',
      tone: 'stone',
    });
    expect(ringkasanBackup('', '2026-10-27')).toEqual({
      namaFile: null,
      tanggal: null,
      usiaHari: null,
      label: 'Tanggal tidak diketahui',
      tone: 'stone',
    });
  });
});

describe('mulaiBackupPeriodik', () => {
  it('backup saat tanggal berganti, idempoten di hari yang sama, dan berhenti bersih', () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'pura-periodik-'));
    const bakDir = join(dir, 'backups');
    const db = openDb(join(dir, 'pura.db'));
    let hari = '2026-10-23';
    const dibuat: string[] = [];
    let hentikan: (() => void) | null = null;
    try {
      hentikan = mulaiBackupPeriodik({
        db: () => db,
        dirBackup: () => bakDir,
        tanggal: () => hari,
        intervalMs: 60_000,
        onBackup: (p) => dibuat.push(p),
        onError: (e) => {
          throw e;
        },
      });

      expect(existsSync(join(bakDir, 'auto-2026-10-23.db'))).toBe(false);

      // Tick pertama hari ini → satu file.
      vi.advanceTimersByTime(60_000);
      const fileHariIni = join(bakDir, 'auto-2026-10-23.db');
      expect(existsSync(fileHariIni)).toBe(true);
      expect(dibuat).toEqual([fileHariIni]);
      const mtimePertama = statSync(fileHariIni).mtimeMs;

      // Tick berikutnya masih hari yang sama → tidak menulis ulang file.
      vi.advanceTimersByTime(60_000);
      expect(dibuat).toHaveLength(1);
      expect(statSync(fileHariIni).mtimeMs).toBe(mtimePertama);

      // Tanggal berganti → backup baru.
      hari = '2026-10-24';
      vi.advanceTimersByTime(60_000);
      expect(existsSync(join(bakDir, 'auto-2026-10-24.db'))).toBe(true);
      expect(dibuat).toHaveLength(2);

      // Setelah dihentikan, tidak ada backup lagi.
      hari = '2026-10-25';
      hentikan();
      hentikan = null;
      vi.advanceTimersByTime(120_000);
      expect(existsSync(join(bakDir, 'auto-2026-10-25.db'))).toBe(false);
      expect(dibuat).toHaveLength(2);
    } finally {
      hentikan?.();
      db.close();
      vi.useRealTimers();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('guard mencegah tick baru saat backup masih berjalan', () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), 'pura-periodik-'));
    const db = openDb(join(dir, 'pura.db'));
    let jumlah = 0;
    let berjalan = false;
    let tumpangTindih = false;
    let hentikan: (() => void) | null = null;
    try {
      hentikan = mulaiBackupPeriodik({
        db: () => db,
        dirBackup: () => dir,
        tanggal: () => '2026-10-23',
        intervalMs: 1_000,
        backupHarian: () => {
          jumlah++;
          if (berjalan) tumpangTindih = true;
          berjalan = true;
          // Picu tick berikutnya saat backup pertama belum selesai.
          vi.advanceTimersByTime(1_000);
          berjalan = false;
          return join(dir, 'auto-2026-10-23.db');
        },
      });

      vi.advanceTimersByTime(1_000);
      expect(jumlah).toBe(1);
      expect(tumpangTindih).toBe(false);
    } finally {
      hentikan?.();
      db.close();
      vi.useRealTimers();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('helper pembanding memakai nama file auto-<tanggal>.db', () => {
    expect(sudahBackupUntukTanggal('/b/auto-2026-10-23.db', '2026-10-23')).toBe(true);
    expect(sudahBackupUntukTanggal('C:\\b\\auto-2026-10-23.db', '2026-10-23')).toBe(true);
    expect(sudahBackupUntukTanggal('/b/auto-2026-10-22.db', '2026-10-23')).toBe(false);
    expect(sudahBackupUntukTanggal('', '2026-10-23')).toBe(false);
  });
});
