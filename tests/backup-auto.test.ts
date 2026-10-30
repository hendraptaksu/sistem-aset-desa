// Auto-backup harian (TDD RED): 1x sehari saat app dibuka, retensi 7 file.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

describe('autoBackupHarian: backup harian sekali sehari + retensi 7', () => {  it('stamp default memakai tanggal lokal WITA', () => {
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

describe('DB-12 — auto-backup menolak DB yang tidak lolos audit', () => {
  /** Korupsi SQL langsung: jurnal dengan debit ≠ kredit. */
  function korupsi(db: ReturnType<typeof openDb>): void {
    db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES ('j-rusak', '2026-09-09', '', 'Korupsi', 'UMUM', 'j-rusak', NULL,
               '2026-10-29T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-rusak', '1001', 1000, 0, '')`,
    ).run();
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-rusak', '4001', 0, 900, '')`,
    ).run();
  }

  it('tidak membuat file backup dan pesan menyebut audit integritas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-auto-audit-'));
    try {
      const db = openDb(join(dir, 'pura.db'));
      try {
        korupsi(db);
        const bakDir = join(dir, 'backups');
        const dest = join(bakDir, 'auto-2026-09-09.db');

        expect(() => autoBackupHarian(db, bakDir, 7, '2026-09-09')).toThrow(
          /audit integritas/i,
        );
        expect(existsSync(dest)).toBe(false);
        // Tidak ada audit BACKUP-AUTO yang ditulis untuk backup yang batal.
        const audit = db
          .prepare("SELECT COUNT(*) AS n FROM audit_log WHERE aksi = 'BACKUP-AUTO'")
          .get() as { n: number };
        expect(audit.n).toBe(0);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('backup yang sudah ada untuk hari itu tidak ditulis ulang/diaudit', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-auto-audit-lama-'));
    try {
      const db = openDb(join(dir, 'pura.db'));
      try {
        const bakDir = join(dir, 'backups');
        mkdirSync(bakDir, { recursive: true });
        const dest = join(bakDir, 'auto-2026-09-09.db');
        writeFileSync(dest, 'backup-lama');
        korupsi(db);

        // Tidak ada pembuatan backup baru, jadi audit tidak dijalankan dan
        // backup lama tidak disentuh.
        expect(autoBackupHarian(db, bakDir, 7, '2026-09-09')).toBe(dest);
        expect(readFileSync(dest, 'utf-8')).toBe('backup-lama');
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
