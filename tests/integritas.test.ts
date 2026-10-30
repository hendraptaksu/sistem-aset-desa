// AKT-09 / DB-12: audit integritas akuntansi.
//
// Setiap jenis temuan diuji dengan korupsi yang di-seed lewat SQL langsung,
// bukan lewat API aplikasi. Test memastikan `foreign_keys` selalu ON lagi
// setelah selesai, termasuk saat assertion gagal.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/database.js';
import { auditIntegritas, auditIntegritasDb } from '../src/db/integritas.js';

const WAKTU = '2026-10-29T00:00:00.000Z';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(`${ROOT}${path}`, 'utf8');

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

type OpsiJurnal = {
  tanggal?: string;
  noBukti?: string;
  jenis?: string;
  grupId?: string;
  reversalOf?: string | null;
  baris?: [akun: string, debit: number, kredit: number][];
};

/**
 * Jurnal lengkap dengan jenis/grup/reversal yang bisa diatur. Dipakai untuk
 * mensimulasikan korupsi reversal yang tidak mungkin dibuat lewat API.
 */
function buatJurnalLengkap(
  db: Database.Database,
  id: string,
  opsi: OpsiJurnal = {},
): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    opsi.tanggal ?? '2026-01-01',
    opsi.noBukti ?? '',
    `Uji ${id}`,
    opsi.jenis ?? 'UMUM',
    opsi.grupId ?? id,
    opsi.reversalOf ?? null,
    WAKTU,
  );
  const baris = opsi.baris ?? [
    ['1001', 1_000, 0],
    ['4001', 0, 1_000],
  ];
  for (const [akun, debit, kredit] of baris) buatBaris(db, id, akun, debit, kredit);
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

function kodeTemuan(db: Database.Database): string[] {
  return auditIntegritas(db).temuan.map((t) => t.kode);
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
      expect(auditIntegritasDb(db)).toEqual([]);
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

  it('mendeteksi jurnal tanpa baris dengan kode khusus JURNAL_TANPA_BARIS', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-tanpa-baris', '2026-01-03', 'JU-003');

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'JURNAL_TANPA_BARIS',
        detail: { id: 'j-tanpa-baris' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/tidak punya baris sama sekali/i);
    });
  });

  it('mendeteksi jurnal yang hanya punya satu baris', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-satu-baris', '2026-01-03', 'JU-003b');
      buatBaris(db, 'j-satu-baris', '1001', 1_000, 0);

      const hasil = auditIntegritas(db);
      const kurang = hasil.temuan.find((t) => t.kode === 'JURNAL_KURANG_DUA_BARIS');

      expect(hasil.ok).toBe(false);
      expect(kurang).toMatchObject({
        kode: 'JURNAL_KURANG_DUA_BARIS',
        detail: { id: 'j-satu-baris', jumlah_baris: 1 },
      });
      expect(kurang?.pesan).toMatch(/minimal 2 baris/i);
      // Satu baris debit saja juga tidak seimbang; keduanya sama-sama temuan.
      expect(hasil.temuan.map((t) => t.kode)).toContain('JURNAL_TIDAK_SEIMBANG');
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

  it('melaporkan pelanggaran PRAGMA foreign_key_check dan reversal tanpa asli', () => {
    denganDb((db) => {
      tanpaFk(db, () => {
        buatJurnal(db, 'j-reversal-hilang', '2026-01-05', 'JU-005', 'jurnal-asal-hilang');
        buatBaris(db, 'j-reversal-hilang', '1001', 1_000, 0);
        buatBaris(db, 'j-reversal-hilang', '4001', 0, 1_000);
      });

      const hasil = auditIntegritas(db);
      const kode = hasil.temuan.map((t) => t.kode);

      expect(hasil.ok).toBe(false);
      expect(kode).toContain('FOREIGN_KEY');
      expect(kode).toContain('REVERSAL_TANPA_ASLI');
      expect(hasil.temuan.find((t) => t.kode === 'FOREIGN_KEY')).toMatchObject({
        detail: { table: 'jurnal', parent: 'jurnal' },
      });
      expect(hasil.temuan.find((t) => t.kode === 'FOREIGN_KEY')?.pesan).toMatch(
        /foreign key/i,
      );
      expect(hasil.temuan.find((t) => t.kode === 'REVERSAL_TANPA_ASLI')?.pesan).toMatch(
        /jurnal-asal-hilang.*tidak ada/i,
      );
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

  it('mendeteksi panjar CLOSED tanpa jurnal_close_id, tanggal_close, dan item', () => {
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
        detail: { id: 'p-closed-tidak-lengkap', status: 'CLOSED', jumlah_item: 0 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/jurnal_close_id dan tanggal_close/i);
      expect(hasil.temuan[0]?.pesan).toMatch(/item pertanggungjawaban/i);
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

describe('DB-12 — perluasan audit integritas', () => {
  it('auditIntegritasDb mengembalikan daftar "KODE: pesan"', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-tidak-seimbang', '2026-01-02');
      buatBaris(db, 'j-tidak-seimbang', '1001', 1_000, 0);
      buatBaris(db, 'j-tidak-seimbang', '4001', 0, 900);

      const daftar = auditIntegritasDb(db);

      expect(daftar).toHaveLength(1);
      expect(daftar[0]).toMatch(/^JURNAL_TIDAK_SEIMBANG: /);
      expect(daftar[0]).toMatch(/tidak seimbang/i);
    });
  });

  it('mendeteksi dua reversal untuk satu jurnal asli', () => {
    denganDb((db) => {
      // Unique index v14 mencegah lewat aplikasi; hapus untuk mensimulasikan
      // korupsi SQL langsung.
      db.exec('DROP INDEX IF EXISTS ux_jurnal_reversal');
      buatJurnalLengkap(db, 'j-asli', { grupId: 'g-1' });
      buatJurnalLengkap(db, 'j-balik-1', {
        jenis: 'REVERSAL',
        grupId: 'g-1',
        reversalOf: 'j-asli',
        baris: [
          ['4001', 1_000, 0],
          ['1001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik-2', {
        jenis: 'REVERSAL',
        grupId: 'g-1',
        reversalOf: 'j-asli',
        baris: [
          ['4001', 1_000, 0],
          ['1001', 0, 1_000],
        ],
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_GANDA',
        detail: { reversal_of: 'j-asli', jumlah: 2 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/satu jurnal hanya boleh punya satu reversal/i);
    });
  });

  it('mendeteksi reversal atas reversal', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', { grupId: 'g-1' });
      buatJurnalLengkap(db, 'j-balik-1', {
        jenis: 'REVERSAL',
        grupId: 'g-1',
        reversalOf: 'j-asli',
      });
      buatJurnalLengkap(db, 'j-balik-2', {
        jenis: 'REVERSAL',
        grupId: 'g-1',
        reversalOf: 'j-balik-1',
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_ATAS_REVERSAL',
        detail: { reversal_id: 'j-balik-2', reversal_of: 'j-balik-1' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/reversal atas reversal tidak diizinkan/i);
    });
  });

  it('mendeteksi reversal yang grup_id-nya berbeda dari jurnal asli', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', { grupId: 'g-asli' });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-lain',
        reversalOf: 'j-asli',
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_GRUP_BERBEDA',
        detail: { reversal_id: 'j-balik', grup_reversal: 'g-lain', grup_asal: 'g-asli' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/berbeda dari grup jurnal asli/i);
    });
  });

  it('mendeteksi panjar OPEN tanpa jurnal serah', () => {
    denganDb((db) => {
      tanpaFk(db, () => {
        buatPanjar(db, {
          id: 'p-open-tanpa-jurnal',
          status: 'OPEN',
          jurnalOpenId: '',
        });
      });

      const kode = kodeTemuan(db);

      expect(kode).toContain('PANJAR_OPEN_TIDAK_LENGKAP');
      expect(
        auditIntegritas(db).temuan.find((t) => t.kode === 'PANJAR_OPEN_TIDAK_LENGKAP')
          ?.pesan,
      ).toMatch(/jurnal serah.*kosong/i);
    });
  });

  it('mendeteksi panjar CLOSED yang punya jurnal close tetapi tanpa item', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-open');
      buatJurnalLengkap(db, 'j-close');
      buatPanjar(db, {
        id: 'p-closed-tanpa-item',
        status: 'CLOSED',
        jurnalOpenId: 'j-open',
        jurnalCloseId: 'j-close',
        tanggalClose: '2026-02-02',
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_CLOSED_TIDAK_LENGKAP',
        detail: { id: 'p-closed-tanpa-item', jumlah_item: 0 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/belum punya item pertanggungjawaban/i);
    });
  });

  it('mendeteksi panjar OPEN yang hanya punya tanggal_close', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-open');
      buatPanjar(db, {
        id: 'p-open-tanggal-close',
        status: 'OPEN',
        jurnalOpenId: 'j-open',
        tanggalClose: '2026-02-02',
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_OPEN_PUNYA_CLOSE',
        detail: { id: 'p-open-tanggal-close' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/tanggal close/i);
    });
  });

  it('mendeteksi akun dengan tipe/posisi_normal/aktif tidak valid', () => {
    denganDb((db) => {
      // Trigger v15 menjaga lewat aplikasi; drop agar bisa mensimulasikan
      // korupsi SQL langsung.
      db.exec(`
        DROP TRIGGER IF EXISTS trg_akun_validasi_insert;
        DROP TRIGGER IF EXISTS trg_akun_validasi_update;
      `);
      db.prepare("UPDATE akun SET tipe = 'ASET' WHERE kode = '1001'").run();
      db.prepare("UPDATE akun SET posisi_normal = 'DEBIT' WHERE kode = '4001'").run();
      db.prepare("UPDATE akun SET posisi_normal = 'SALAH' WHERE kode = '4002'").run();
      db.prepare('UPDATE akun SET aktif = 2 WHERE kode = ?').run('4003');
      db.prepare("UPDATE akun SET aktif = 'ya' WHERE kode = '4004'").run();

      const hasil = auditIntegritas(db);
      const kode = hasil.temuan.map((t) => t.kode);

      expect(hasil.ok).toBe(false);
      expect(kode).toContain('AKUN_TIPE_TIDAK_VALID');
      expect(kode).toContain('AKUN_POSISI_NORMAL_TIDAK_VALID');
      expect(kode).toContain('AKUN_POSISI_NORMAL_TIDAK_COCOK');
      expect(kode).toContain('AKUN_AKTIF_TIDAK_VALID');
      expect(hasil.temuan.find((t) => t.kode === 'AKUN_TIPE_TIDAK_VALID')?.pesan).toMatch(
        /1001.*ASET.*tidak dikenal/i,
      );
      expect(
        hasil.temuan.find((t) => t.kode === 'AKUN_POSISI_NORMAL_TIDAK_COCOK')?.pesan,
      ).toMatch(/4001.*seharusnya KREDIT/i);
    });
  });
});

describe('DB-12 — pemanggilan audit di startup, backup, dan tutup buku', () => {
  it('startup menjalankan audit sebelum backup otomatis dan tidak memblokir', () => {
    const index = baca('src/main/index.ts');
    const audit = index.indexOf('auditIntegritasSaatMulai(db');
    const backup = index.indexOf('autoBackupHarian(db');
    expect(audit).toBeGreaterThan(-1);
    expect(backup).toBeGreaterThan(-1);
    expect(audit).toBeLessThan(backup);
    // Tidak ada `throw`/`return` yang menjadikan temuan audit sebagai gate start.
    expect(index.slice(audit, backup)).not.toMatch(/\bthrow\b/);
  });

  it('backup lengkap dan auto harian mengaudit DB sebelum VACUUM INTO', () => {
    const auto = baca('src/features/export/export.ts');
    expect(auto.indexOf('auditSebelumBackup(db)')).toBeGreaterThan(-1);
    expect(auto.indexOf('auditSebelumBackup(db)')).toBeLessThan(
      auto.indexOf('backupVacuumInto(db, dest)'),
    );

    const lengkap = baca('src/features/export/backupLengkap.ts');
    expect(lengkap.indexOf('auditSebelumBackup(opsi.db)')).toBeGreaterThan(-1);
    expect(lengkap.indexOf('auditSebelumBackup(opsi.db)')).toBeLessThan(
      lengkap.indexOf('backupVacuumInto(opsi.db, destDb)'),
    );
    expect(lengkap).toContain('auditIntegritas');
  });

  it('tutup buku memakai auditIntegritas yang sama (termasuk pemeriksaan baru)', () => {
    const tutup = baca('src/db/tutup.ts');
    expect(tutup).toContain("from './integritas.js'");
    expect(tutup.match(/auditIntegritas\(db\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
