// Auto-backup harian (TDD RED): 1x sehari saat app dibuka, retensi 7 file.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { insertTransaksi, listTransaksi } from '../src/db/repository.js';
import { autoBackupHarian } from '../src/features/export/export.js';

function makeTx(i: number) {
  return {
    id: `auto-${i}`,
    tanggal: '2026-09-09',
    keterangan: `uji ${i}`,
    akun_kas: '1000',
    kategori: '4007',
    masuk: 100000,
    keluar: 0,
  };
}

describe('autoBackupHarian: backup harian sekali sehari + retensi 7', () => {
  it('membuat backup hari ini via koneksi terbuka dan isi sama', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-auto-'));
    try {
      const dbPath = join(dir, 'pura.db');
      const bakDir = join(dir, 'backups');
      const db = openDb(dbPath);
      insertTransaksi(db, makeTx(1));
      insertTransaksi(db, makeTx(2));
      // DB tetap terbuka saat backup (simulasi app jalan, mode WAL)
      const dest = autoBackupHarian(db, bakDir, 7, '2026-09-09');
      expect(dest).toBe(join(bakDir, 'auto-2026-09-09.db'));
      expect(existsSync(dest)).toBe(true);
      db.close();
      const db2 = openDb(dest);
      expect(listTransaksi(db2)).toHaveLength(2);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('idempoten di hari yang sama dan prune ke 7 terbaru', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-auto-'));
    try {
      const dbPath = join(dir, 'pura.db');
      const bakDir = join(dir, 'backups');
      const db = openDb(dbPath);
      insertTransaksi(db, makeTx(1));
      // isi 10 backup lama dummy
      for (let d = 1; d <= 10; d++) {
        const stamp = `2026-08-${String(d).padStart(2, '0')}`;
        mkdirSync(bakDir, { recursive: true });
        writeFileSync(join(bakDir, `auto-${stamp}.db`), 'x');
      }
      const dest = autoBackupHarian(db, bakDir, 7, '2026-09-09');
      expect(existsSync(dest)).toBe(true);
      const files = readdirSync(bakDir).filter((f: string) => f.startsWith('auto-')).sort();
      expect(files).toHaveLength(7);
      expect(files[files.length - 1]).toBe('auto-2026-09-09.db');
      // panggil lagi hari sama -> tetap 7, tidak nambah
      autoBackupHarian(db, bakDir, 7, '2026-09-09');
      const files2 = readdirSync(bakDir).filter((f: string) => f.startsWith('auto-')).sort();
      expect(files2).toHaveLength(7);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
