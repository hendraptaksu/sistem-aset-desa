// Auto-backup harian (TDD RED): 1x sehari saat app dibuka, retensi 7 file.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { DDL, SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { insertJurnalTervalidasi, listJurnal } from '../src/db/repository.js';
import {
  RETENSI_AUTO,
  RETENSI_PRE_RESTORE,
  RETENSI_TUTUP_BUKU,
  autoBackupHarian,
  backupVacuumInto,
  rapikanBackupInternal,
  restoreDbAman,
} from '../src/features/export/export.js';

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

describe('T3.2 — retensi backup internal terkendali', () => {
  const preRestore = (n: number): string[] =>
    Array.from(
      { length: n },
      (_, i) => `pre-restore-2026-01-${String(i + 1).padStart(2, '0')}.db`,
    );

  it('helper: pre-restore 8 file -> 5 terbaru, pola lain tidak disentuh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-t32-pre-'));
    try {
      const bakDir = join(dir, 'backups');
      mkdirSync(bakDir, { recursive: true });
      const pre = preRestore(8);
      const lain = [
        'auto-2026-01-01.db',
        'pura-2026.db',
        'lain.db',
        'pre-restore-2026-01-01.db.tmp-1',
        'pre-restore-2026-01-01.db.bak-1',
        'pre-restore-2026-01-01.db-wal',
        'pre-restore-catatan.txt',
      ];
      for (const f of [...pre, ...lain]) writeFileSync(join(bakDir, f), f);

      const dihapus = rapikanBackupInternal(
        bakDir,
        'pre-restore',
        RETENSI_PRE_RESTORE,
      );
      expect(dihapus).toHaveLength(3);

      const sisa = readdirSync(bakDir)
        .filter((f) => /^pre-restore-.*\.db$/.test(f))
        .sort();
      expect(sisa).toEqual(pre.slice(3));
      for (const f of lain) expect(existsSync(join(bakDir, f))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('helper: pura-<tahun> 12 file -> 10 terbaru', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-t32-tutup-'));
    try {
      const bakDir = join(dir, 'backups');
      mkdirSync(bakDir, { recursive: true });
      const tahun = Array.from({ length: 12 }, (_, i) => `pura-${2015 + i}.db`);
      const lain = [
        'pura-2026.db.tmp-1',
        'pura-99.db',
        'pura-2026.sqlite',
        'auto-2026-01-01.db',
      ];
      for (const f of [...tahun, ...lain]) writeFileSync(join(bakDir, f), f);

      const dihapus = rapikanBackupInternal(
        bakDir,
        'tutup-buku',
        RETENSI_TUTUP_BUKU,
      );
      expect(dihapus).toHaveLength(2);

      const sisa = readdirSync(bakDir)
        .filter((f) => /^pura-\d{4}\.db$/.test(f))
        .sort();
      expect(sisa).toEqual(tahun.slice(2));
      for (const f of lain) expect(existsSync(join(bakDir, f))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('helper: path di lindungi tidak dihapus walau di luar batas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-t32-lindungi-'));
    try {
      const bakDir = join(dir, 'backups');
      mkdirSync(bakDir, { recursive: true });
      const pre = preRestore(8);
      for (const f of pre) writeFileSync(join(bakDir, f), f);

      // File tertua dilindungi (mis. sedang dipakai rollback).
      const dihapus = rapikanBackupInternal(
        bakDir,
        'pre-restore',
        RETENSI_PRE_RESTORE,
        [join(bakDir, pre[0]!)],
      );
      expect(dihapus).toHaveLength(2);

      const sisa = readdirSync(bakDir)
        .filter((f) => /^pre-restore-.*\.db$/.test(f))
        .sort();
      expect(sisa).toEqual([pre[0]!, ...pre.slice(3)]);
      expect(sisa).toHaveLength(RETENSI_PRE_RESTORE + 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('auto: backup baru gagal tidak memicu penghapusan backup lama', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-t32-auto-gagal-'));
    let db: ReturnType<typeof openDb> | null = null;
    try {
      const bakDir = join(dir, 'backups');
      mkdirSync(bakDir, { recursive: true });
      const lama = Array.from(
        { length: 10 },
        (_, i) => `auto-2026-08-${String(i + 1).padStart(2, '0')}.db`,
      );
      for (const f of lama) writeFileSync(join(bakDir, f), 'x');

      db = openDb(join(dir, 'pura.db'));
      // VACUUM INTO ditolak di dalam transaksi: backup baru gagal dibuat,
      // sehingga retensi tidak boleh berjalan sama sekali.
      db.exec('BEGIN');
      try {
        expect(() =>
          autoBackupHarian(db!, bakDir, RETENSI_AUTO, '2026-09-09'),
        ).toThrow(/transaction/i);
      } finally {
        db.exec('ROLLBACK');
      }

      expect(existsSync(join(bakDir, 'auto-2026-09-09.db'))).toBe(false);
      const sisa = readdirSync(bakDir)
        .filter((f) => /^auto-.*\.db$/.test(f))
        .sort();
      expect(sisa).toEqual(lama);
    } finally {
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restore sukses memicu retensi pre-restore; file rollback tetap ada', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-t32-restore-ok-'));
    let aktif: Database.Database | null = null;
    let sumber: Database.Database | null = null;
    try {
      const aktifPath = join(dir, 'aktif.db');
      const bakDir = join(dir, 'backups');
      mkdirSync(bakDir, { recursive: true });
      const lama = preRestore(8);
      for (const f of lama) writeFileSync(join(bakDir, f), 'x');

      aktif = openDb(aktifPath);
      const j1 = makeJurnal(1);
      insertJurnalTervalidasi(aktif, j1.header, j1.baris);

      sumber = openDb(join(dir, 'sumber.db'));
      const j2 = makeJurnal(2);
      insertJurnalTervalidasi(sumber, j2.header, j2.baris);
      const kandidat = join(dir, 'kandidat.db');
      backupVacuumInto(sumber, kandidat);
      sumber.close();
      sumber = null;

      const hasil = restoreDbAman(aktif, {
        dbPath: aktifPath,
        backupPath: kandidat,
        dirBackup: bakDir,
        stamp: 'restore-uji',
      });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) throw new Error(hasil.error);
      aktif = hasil.db;

      // Cadangan yang baru dipakai untuk rollback tidak ikut terhapus.
      expect(existsSync(hasil.preRestorePath)).toBe(true);

      const sisa = readdirSync(bakDir)
        .filter((f) => /^pre-restore-.*\.db$/.test(f))
        .sort();
      expect(sisa).toHaveLength(RETENSI_PRE_RESTORE);
      for (const f of lama.slice(0, 4))
        expect(existsSync(join(bakDir, f))).toBe(false);
      for (const f of lama.slice(4))
        expect(existsSync(join(bakDir, f))).toBe(true);
      expect(sisa[sisa.length - 1]).toBe('pre-restore-restore-uji.db');
    } finally {
      sumber?.close();
      aktif?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('restore gagal tidak memicu retensi pre-restore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-t32-restore-gagal-'));
    let aktif: Database.Database | null = null;
    try {
      const aktifPath = join(dir, 'aktif.db');
      const bakDir = join(dir, 'backups');
      mkdirSync(bakDir, { recursive: true });
      const lama = preRestore(8);
      for (const f of lama) writeFileSync(join(bakDir, f), 'x');

      aktif = openDb(aktifPath);
      const j1 = makeJurnal(1);
      insertJurnalTervalidasi(aktif, j1.header, j1.baris);

      // Kandidat lolos validasi/audit tetapi gagal saat `openDb` (non-STRICT),
      // sehingga cadangan pra-restore sudah dibuat lalu restore dibatalkan.
      const kandidat = join(dir, 'kandidat-rusak.db');
      const rusak = new Database(kandidat);
      rusak.exec(DDL.replace(/\) STRICT;/g, ');'));
      rusak.pragma(`user_version = ${SCHEMA_VERSION}`);
      rusak.close();

      const hasil = restoreDbAman(aktif, {
        dbPath: aktifPath,
        backupPath: kandidat,
        dirBackup: bakDir,
        stamp: 'gagal',
      });
      expect(hasil.ok).toBe(false);
      if (hasil.ok) throw new Error('seharusnya gagal');
      aktif = hasil.db;

      // 8 backup lama + cadangan baru tetap ada; tidak ada yang dirapikan.
      const sisa = readdirSync(bakDir)
        .filter((f) => /^pre-restore-.*\.db$/.test(f))
        .sort();
      expect(sisa).toHaveLength(lama.length + 1);
      expect(existsSync(join(bakDir, 'pre-restore-gagal.db'))).toBe(true);
      for (const f of lama) expect(existsSync(join(bakDir, f))).toBe(true);
    } finally {
      aktif?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
