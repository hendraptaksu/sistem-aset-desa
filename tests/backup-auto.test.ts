// Auto-backup harian (TDD RED): 1x sehari saat app dibuka, retensi 7 file.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/database.js';
import { insertJurnalTervalidasi, listJurnal } from '../src/db/repository.js';
import { autoBackupHarian } from '../src/features/export/export.js';

function makeJurnal(i: number) {
  return {
    header: {
      id: `auto-${i}`,
      tanggal: '2026-09-09',
      no_bukti: `JU-2026-${String(i).padStart(4, '0')}`,
      keterangan: `uji ${i}`,
    },
    baris: [
      { akun_kode: '1001', debit: 100000, kredit: 0 },
      { akun_kode: '4007', debit: 0, kredit: 100000 },
    ],
  };
}

describe('autoBackupHarian: backup harian sekali sehari + retensi 7', () => {
  it('stamp default memakai tanggal lokal WITA', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-auto-'));
    try {
      const db = openDb(join(dir, 'pura.db'));
      try {
        vi.useFakeTimers();
        try {
          // 2025-12-31T16:30:00Z = 2026-01-01 00:30 WITA.
          vi.setSystemTime(new Date('2025-12-31T16:30:00Z'));
          const dest = autoBackupHarian(db, join(dir, 'backups'));
          expect(dest).toBe(join(dir, 'backups', 'auto-2026-01-01.db'));
          expect(existsSync(dest)).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('membuat backup hari ini via koneksi terbuka dan isi sama', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-auto-'));
    try {
      const dbPath = join(dir, 'pura.db');
      const bakDir = join(dir, 'backups');
      const db = openDb(dbPath);
      const j1 = makeJurnal(1);
      const j2 = makeJurnal(2);
      insertJurnalTervalidasi(db, j1.header, j1.baris);
      insertJurnalTervalidasi(db, j2.header, j2.baris);
      // DB tetap terbuka saat backup (simulasi app jalan, mode WAL)
      const dest = autoBackupHarian(db, bakDir, 7, '2026-09-09');
      expect(dest).toBe(join(bakDir, 'auto-2026-09-09.db'));
      expect(existsSync(dest)).toBe(true);
      db.close();
      const db2 = openDb(dest);
      expect(listJurnal(db2)).toHaveLength(2);
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
      const j1 = makeJurnal(1);
      insertJurnalTervalidasi(db, j1.header, j1.baris);
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
