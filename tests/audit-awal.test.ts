// DB-12 — audit integritas saat startup.
//
// Audit startup hanya mencatat, tidak menulis DB, dan tidak boleh menghalangi
// aplikasi dibuka. Modul auditnya tetap `src/db/integritas.ts` (AKT-09/DB-12).

import type Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/database.js';
import { auditIntegritasSaatMulai } from '../src/main/auditAwal.js';

const WAKTU = '2026-10-30T00:00:00.000Z';

function loggerPalsu() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

/** Korupsi langsung lewat SQL: total debit ≠ kredit. */
function buatJurnalTidakSeimbang(db: Database.Database): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES ('j-rusak', '2026-01-02', '', 'Korupsi', 'UMUM', 'j-rusak', NULL, ?)`,
  ).run(WAKTU);
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES ('j-rusak', '1001', 1000, 0, '')`,
  ).run();
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES ('j-rusak', '4001', 0, 900, '')`,
  ).run();
}

describe('DB-12 — audit integritas saat mulai', () => {
  it('DB bersih: mengembalikan hasil ok dan mencatat info', () => {
    const db = openDb(':memory:');
    const log = loggerPalsu();
    try {
      const hasil = auditIntegritasSaatMulai(db, log);
      expect(hasil?.ok).toBe(true);
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining('lolos audit integritas'),
      );
      expect(log.warn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('DB rusak: mencatat warning berisi kode/pesan tetapi tidak melempar', () => {
    const db = openDb(':memory:');
    const log = loggerPalsu();
    try {
      buatJurnalTidakSeimbang(db);
      const jumlahJurnal = db.prepare('SELECT COUNT(*) AS n FROM jurnal').get();

      expect(() => auditIntegritasSaatMulai(db, log)).not.toThrow();
      const hasil = auditIntegritasSaatMulai(db, log);

      expect(hasil?.ok).toBe(false);
      expect(hasil?.temuan.map((t) => t.kode)).toContain('JURNAL_TIDAK_SEIMBANG');
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringMatching(/JURNAL_TIDAK_SEIMBANG.*tidak seimbang/i),
      );
      // Audit tidak mengubah data.
      expect(db.prepare('SELECT COUNT(*) AS n FROM jurnal').get()).toEqual(jumlahJurnal);
    } finally {
      db.close();
    }
  });

  it('audit gagal dibaca (DB tertutup) tetap tidak melempar dan dicatat sebagai warning', () => {
    const db = openDb(':memory:');
    db.close();
    const log = loggerPalsu();

    expect(() => auditIntegritasSaatMulai(db, log)).not.toThrow();
    expect(auditIntegritasSaatMulai(db, log)).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });

  it('logger opsional: hasil tetap dikembalikan tanpa logger', () => {
    const db = openDb(':memory:');
    try {
      expect(auditIntegritasSaatMulai(db)?.ok).toBe(true);
    } finally {
      db.close();
    }
  });
});
