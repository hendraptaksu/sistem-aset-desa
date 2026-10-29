// AKT-09: audit integritas akuntansi.
//
// Setiap jenis temuan diuji dengan korupsi yang di-seed lewat SQL langsung,
// bukan lewat API aplikasi. Test memastikan `foreign_keys` selalu ON lagi
// setelah selesai, termasuk saat assertion gagal.

import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/database.js';
import { auditIntegritas } from '../src/db/integritas.js';

const WAKTU = '2026-10-29T00:00:00.000Z';

function denganDb(fn: (db: Database.Database) => void): void {
  const db = openDb(':memory:');
  try {
    fn(db);
  } finally {
    db.pragma('foreign_keys = ON');
    expect(Number(db.pragma('foreign_keys', { simple: true }))).toBe(1);
    db.close();
  }
}

/** Jalankan seed yang sengaja melanggar FK, lalu pastikan FK dinyalakan lagi. */
function tanpaFk<T>(db: Database.Database, fn: () => T): T {
  db.pragma('foreign_keys = OFF');
  try {
    return fn();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function buatJurnal(
  db: Database.Database,
  id: string,
  tanggal: string,
  noBukti = '',
  reversalOf: string | null = null,
): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, ?, ?, ?, 'UMUM', ?, ?, ?)`,
  ).run(id, tanggal, noBukti, `Uji ${id}`, id, reversalOf, WAKTU);
}

function buatBaris(
  db: Database.Database,
  jurnalId: string,
  akun: string,
  debit: number,
  kredit: number,
): void {
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, ?, ?, ?, '')`,
  ).run(jurnalId, akun, debit, kredit);
}

/** Jurnal seimbang dua baris: D 1001 / K 4001. */
function jurnalSeimbang(
  db: Database.Database,
  id: string,
  tanggal: string,
  noBukti = '',
): void {
  buatJurnal(db, id, tanggal, noBukti);
  buatBaris(db, id, '1001', 1_000, 0);
  buatBaris(db, id, '4001', 0, 1_000);
}

function buatPanjar(
  db: Database.Database,
  data: {
    id: string;
    status: 'OPEN' | 'CLOSED';
    jurnalOpenId: string;
    jurnalCloseId?: string | null;
    tanggalClose?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO panjar
       (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
        tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
     VALUES (?, '2026-02-01', 'Penerima Uji', 100000, '1001', ?, ?, ?, ?, ?)`,
  ).run(
    data.id,
    data.status,
    data.tanggalClose ?? null,
    data.jurnalOpenId,
    data.jurnalCloseId ?? null,
    WAKTU,
  );
}

describe('AKT-09 — audit integritas akuntansi', () => {
  it('DB bersih dengan jurnal seimbang dan panjar OPEN tidak menghasilkan temuan', () => {
    denganDb((db) => {
      jurnalSeimbang(db, 'j-bersih', '2026-01-05', 'JU-001');
      buatJurnal(db, 'j-panjar-open', '2026-02-01', 'PJ-001');
      buatBaris(db, 'j-panjar-open', '1040', 100_000, 0);
      buatBaris(db, 'j-panjar-open', '1001', 0, 100_000);
      buatPanjar(db, {
        id: 'p-bersih',
        status: 'OPEN',
        jurnalOpenId: 'j-panjar-open',
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(true);
      expect(hasil.temuan).toEqual([]);
      expect(hasil.ringkasan).toMatch(/tidak ada temuan/i);
    });
  });

  it('mendeteksi jurnal dengan total debit tidak sama dengan total kredit', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-tidak-seimbang', '2026-01-02', 'JU-002');
      buatBaris(db, 'j-tidak-seimbang', '1001', 1_000, 0);
      buatBaris(db, 'j-tidak-seimbang', '4001', 0, 900);

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'JURNAL_TIDAK_SEIMBANG',
        detail: { id: 'j-tidak-seimbang', debit: 1_000, kredit: 900 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/tidak seimbang/i);
      expect(hasil.ringkasan).toMatch(/1 temuan/i);
    });
  });

  it('mendeteksi jurnal yang punya kurang dari dua baris', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-tanpa-baris', '2026-01-03', 'JU-003');

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'JURNAL_KURANG_DUA_BARIS',
        detail: { id: 'j-tanpa-baris', jumlah_baris: 0 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/minimal 2 baris/i);
    });
  });

  it('mendeteksi baris jurnal dengan akun yang tidak ada di master akun', () => {
    denganDb((db) => {
      tanpaFk(db, () => {
        buatJurnal(db, 'j-akun-asing', '2026-01-04', 'JU-004');
        buatBaris(db, 'j-akun-asing', '1001', 1_000, 0);
        buatBaris(db, 'j-akun-asing', '9999', 0, 1_000);
      });

      const hasil = auditIntegritas(db);
      const kode = hasil.temuan.map((t) => t.kode);

      expect(hasil.ok).toBe(false);
      expect(kode).toContain('AKUN_TIDAK_DIKENAL');
      expect(hasil.temuan.find((t) => t.kode === 'AKUN_TIDAK_DIKENAL')?.pesan).toMatch(
        /9999.*tidak terdaftar/i,
      );
      // foreign_key_check juga melihat akun asing yang sama.
      expect(kode).toContain('FOREIGN_KEY');
    });
    // `tanpaFk` sudah menyalakan foreign_keys kembali; `denganDb` memverifikasi.
  });

  it('mendeteksi baris orphan yang merujuk jurnal tidak ada', () => {
    denganDb((db) => {
      tanpaFk(db, () => {
        buatBaris(db, 'jurnal-hilang', '1001', 1_000, 0);
      });

      const hasil = auditIntegritas(db);
      const kode = hasil.temuan.map((t) => t.kode);

      expect(hasil.ok).toBe(false);
      expect(kode).toContain('BARIS_ORPHAN');
      expect(hasil.temuan.find((t) => t.kode === 'BARIS_ORPHAN')?.pesan).toMatch(
        /jurnal-hilang.*tidak ada/i,
      );
      expect(kode).toContain('FOREIGN_KEY');
    });
  });

  it('melaporkan pelanggaran PRAGMA foreign_key_check', () => {
    denganDb((db) => {
      tanpaFk(db, () => {
        buatJurnal(db, 'j-reversal-hilang', '2026-01-05', 'JU-005', 'jurnal-asal-hilang');
        buatBaris(db, 'j-reversal-hilang', '1001', 1_000, 0);
        buatBaris(db, 'j-reversal-hilang', '4001', 0, 1_000);
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'FOREIGN_KEY',
        detail: { table: 'jurnal', parent: 'jurnal' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/foreign key/i);
    });
  });

  it('mendeteksi nomor bukti duplikat per tahun saat unique index hilang', () => {
    denganDb((db) => {
      db.exec('DROP INDEX IF EXISTS idx_jurnal_no_bukti_tahun');
      jurnalSeimbang(db, 'j-dup-1', '2026-03-01', 'JU-006');
      jurnalSeimbang(db, 'j-dup-2', '2026-03-02', 'JU-006');

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'NOMOR_BUKTI_DUPLIKAT',
        detail: { tahun: '2026', no_bukti: 'JU-006', jumlah: 2 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/unik per tahun/i);
    });
  });

  it('mendeteksi panjar CLOSED tanpa jurnal_close_id dan tanggal_close', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-panjar-open', '2026-02-01', 'PJ-002');
      buatBaris(db, 'j-panjar-open', '1040', 100_000, 0);
      buatBaris(db, 'j-panjar-open', '1001', 0, 100_000);
      buatPanjar(db, {
        id: 'p-closed-tidak-lengkap',
        status: 'CLOSED',
        jurnalOpenId: 'j-panjar-open',
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_CLOSED_TIDAK_LENGKAP',
        detail: { id: 'p-closed-tidak-lengkap', status: 'CLOSED' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/jurnal_close_id dan tanggal_close/i);
    });
  });

  it('mendeteksi panjar OPEN yang sudah punya jurnal_close_id', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-panjar-open', '2026-02-01', 'PJ-003');
      buatBaris(db, 'j-panjar-open', '1040', 100_000, 0);
      buatBaris(db, 'j-panjar-open', '1001', 0, 100_000);
      buatJurnal(db, 'j-panjar-close', '2026-02-02', 'PJ-004');
      buatBaris(db, 'j-panjar-close', '5001', 100_000, 0);
      buatBaris(db, 'j-panjar-close', '1040', 0, 100_000);
      buatPanjar(db, {
        id: 'p-open-punya-close',
        status: 'OPEN',
        jurnalOpenId: 'j-panjar-open',
        jurnalCloseId: 'j-panjar-close',
        tanggalClose: '2026-02-02',
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_OPEN_PUNYA_CLOSE',
        detail: { id: 'p-open-punya-close', status: 'OPEN' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/status OPEN.*jurnal close/i);
    });
  });
});
