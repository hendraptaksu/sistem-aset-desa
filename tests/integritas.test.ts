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

/** Jurnal serah panjar: D 1040 / K kas, sesuai header `panjar` uji. */
function jurnalOpenPanjar(
  db: Database.Database,
  id: string,
  tanggal = '2026-02-01',
  jumlah = 100_000,
  kas = '1001',
): void {
  buatJurnal(db, id, tanggal);
  buatBaris(db, id, '1040', jumlah, 0);
  buatBaris(db, id, kas, 0, jumlah);
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

function buatItemPanjar(
  db: Database.Database,
  panjarId: string,
  akun: string,
  nominal: number,
  jurnalId: string,
): void {
  db.prepare(
    `INSERT INTO panjar_item (panjar_id, kategori_baga, nominal, jurnal_id)
     VALUES (?, ?, ?, ?)`,
  ).run(panjarId, akun, nominal, jurnalId);
}

/** Panjar CLOSED lengkap: jurnal open 100k, close sesuai item, item tersimpan. */
function panjarClosedLengkap(
  db: Database.Database,
  id: string,
  items: [akun: string, nominal: number][],
  barisClose: [akun: string, debit: number, kredit: number][],
): void {
  buatJurnal(db, `j-open-${id}`, '2026-02-01', `PJ-O-${id}`);
  buatBaris(db, `j-open-${id}`, '1040', 100_000, 0);
  buatBaris(db, `j-open-${id}`, '1001', 0, 100_000);
  buatJurnal(db, `j-close-${id}`, '2026-02-02', `PJ-C-${id}`);
  for (const [akun, debit, kredit] of barisClose)
    buatBaris(db, `j-close-${id}`, akun, debit, kredit);
  buatPanjar(db, {
    id,
    status: 'CLOSED',
    jurnalOpenId: `j-open-${id}`,
    jurnalCloseId: `j-close-${id}`,
    tanggalClose: '2026-02-02',
  });
  for (const [akun, nominal] of items)
    buatItemPanjar(db, id, akun, nominal, `j-close-${id}`);
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
      const temuan = hasil.temuan.find((t) => t.kode === 'PANJAR_CLOSED_TIDAK_LENGKAP');

      expect(hasil.ok).toBe(false);
      expect(temuan).toMatchObject({
        kode: 'PANJAR_CLOSED_TIDAK_LENGKAP',
        detail: { id: 'p-closed-tidak-lengkap', status: 'CLOSED', jumlah_item: 0 },
      });
      expect(temuan?.pesan).toMatch(/jurnal_close_id dan tanggal_close/i);
      expect(temuan?.pesan).toMatch(/item pertanggungjawaban/i);
      // Panjar CLOSED tanpa jurnal close juga meninggalkan saldo 1040 tanpa
      // panjar OPEN; AUD2-04 melaporkan split-brain itu secara terpisah.
      expect(kodeTemuan(db)).toContain('REKONSILIASI_PANJAR_GL_SELISIH');
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
      const temuan = hasil.temuan.find((t) => t.kode === 'PANJAR_OPEN_PUNYA_CLOSE');

      expect(hasil.ok).toBe(false);
      expect(temuan).toMatchObject({
        kode: 'PANJAR_OPEN_PUNYA_CLOSE',
        detail: { id: 'p-open-punya-close', status: 'OPEN' },
      });
      expect(temuan?.pesan).toMatch(/status OPEN.*jurnal close/i);
      // Jurnal close sudah mengkredit 1040, sedangkan panjar masih OPEN:
      // saldo GL tidak lagi sama dengan daftar panjar OPEN.
      expect(kodeTemuan(db)).toContain('REKONSILIASI_PANJAR_GL_SELISIH');
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
        baris: [
          ['4001', 1_000, 0],
          ['1001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik-2', {
        jenis: 'REVERSAL',
        grupId: 'g-1',
        reversalOf: 'j-balik-1',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
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
        baris: [
          ['4001', 1_000, 0],
          ['1001', 0, 1_000],
        ],
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
      jurnalOpenPanjar(db, 'j-open');
      buatJurnalLengkap(db, 'j-close');
      buatPanjar(db, {
        id: 'p-closed-tanpa-item',
        status: 'CLOSED',
        jurnalOpenId: 'j-open',
        jurnalCloseId: 'j-close',
        tanggalClose: '2026-02-02',
      });

      const hasil = auditIntegritas(db);
      const temuan = hasil.temuan.find((t) => t.kode === 'PANJAR_CLOSED_TIDAK_LENGKAP');

      expect(hasil.ok).toBe(false);
      expect(temuan).toMatchObject({
        kode: 'PANJAR_CLOSED_TIDAK_LENGKAP',
        detail: { id: 'p-closed-tanpa-item', jumlah_item: 0 },
      });
      expect(temuan?.pesan).toMatch(/belum punya item pertanggungjawaban/i);
      // Jurnal close uji tidak mengkredit 1040, jadi saldo GL juga tidak cocok
      // dengan daftar panjar OPEN.
      expect(kodeTemuan(db)).toContain('REKONSILIASI_PANJAR_GL_SELISIH');
    });
  });

  it('mendeteksi panjar OPEN yang hanya punya tanggal_close', () => {
    denganDb((db) => {
      jurnalOpenPanjar(db, 'j-open');
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

describe('DB-19 — audit rekonsiliasi panjar item vs jurnal close', () => {
  it('panjar CLOSED normal lolos audit tanpa temuan', () => {
    denganDb((db) => {
      panjarClosedLengkap(
        db,
        'p-ok',
        [
          ['5004', 30_000],
          ['5004', 30_000],
          ['5010', 40_000],
        ],
        [
          ['5004', 60_000, 0],
          ['5010', 40_000, 0],
          ['1040', 0, 100_000],
        ],
      );

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(true);
      expect(hasil.temuan).toEqual([]);
    });
  });

  it('mendeteksi nominal item diubah lewat SQL langsung', () => {
    denganDb((db) => {
      panjarClosedLengkap(
        db,
        'p-nominal',
        [['5004', 60_000]],
        [
          ['5004', 60_000, 0],
          ['1040', 0, 60_000],
        ],
      );
      db.prepare("UPDATE panjar_item SET nominal = 70000 WHERE panjar_id = 'p-nominal'").run();

      const hasil = auditIntegritas(db);
      const temuan = hasil.temuan.find((t) => t.kode === 'PANJAR_ITEM_TIDAK_COCOK');

      expect(hasil.ok).toBe(false);
      expect(temuan).toMatchObject({
        kode: 'PANJAR_ITEM_TIDAK_COCOK',
        detail: {
          id: 'p-nominal',
          jurnal_close_id: 'j-close-p-nominal',
          total_item: 70_000,
          total_jurnal: 60_000,
          selisih: 10_000,
          akun_selisih: [
            {
              akun: '5004',
              total_item: 70_000,
              total_jurnal: 60_000,
              selisih: 10_000,
            },
          ],
        },
      });
      expect(temuan?.pesan).toMatch(/tidak cocok dengan jurnal close/i);
      expect(temuan?.pesan).toMatch(/5004/);
      // Close hanya mengkredit 1040 sebesar 60.000 dari panjar 100.000,
      // sehingga sisa 40.000 di GL tidak punya pasangan panjar OPEN.
      expect(kodeTemuan(db)).toContain('REKONSILIASI_PANJAR_GL_SELISIH');
    });
  });

  it('mendeteksi item yang dihapus sehingga total per akun kurang', () => {
    denganDb((db) => {
      panjarClosedLengkap(
        db,
        'p-hapus-item',
        [
          ['5004', 60_000],
          ['5010', 40_000],
        ],
        [
          ['5004', 60_000, 0],
          ['5010', 40_000, 0],
          ['1040', 0, 100_000],
        ],
      );
      db.prepare("DELETE FROM panjar_item WHERE panjar_id = 'p-hapus-item' AND kategori_baga = '5010'").run();

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_ITEM_TIDAK_COCOK',
        detail: {
          id: 'p-hapus-item',
          total_item: 60_000,
          total_jurnal: 100_000,
          akun_selisih: [
            {
              akun: '5010',
              total_item: 0,
              total_jurnal: 40_000,
              selisih: -40_000,
            },
          ],
        },
      });
    });
  });

  it('mendeteksi item dengan akun ekstra di luar jurnal close', () => {
    denganDb((db) => {
      panjarClosedLengkap(
        db,
        'p-akun-ekstra',
        [['5004', 60_000]],
        [
          ['5004', 60_000, 0],
          ['1040', 0, 60_000],
        ],
      );
      buatItemPanjar(db, 'p-akun-ekstra', '5001', 25_000, 'j-close-p-akun-ekstra');

      const hasil = auditIntegritas(db);
      const temuan = hasil.temuan.find((t) => t.kode === 'PANJAR_ITEM_TIDAK_COCOK');

      expect(hasil.ok).toBe(false);
      expect(temuan).toMatchObject({
        kode: 'PANJAR_ITEM_TIDAK_COCOK',
        detail: {
          id: 'p-akun-ekstra',
          total_item: 85_000,
          total_jurnal: 60_000,
          akun_selisih: [
            {
              akun: '5001',
              total_item: 25_000,
              total_jurnal: 0,
              selisih: 25_000,
            },
          ],
        },
      });
      expect(temuan?.pesan).toMatch(/5001/);
      // Close hanya mengkredit 1040 sebesar 60.000, menyisakan 40.000 di GL.
      expect(kodeTemuan(db)).toContain('REKONSILIASI_PANJAR_GL_SELISIH');
    });
  });

  it('mendeteksi panjar OPEN yang sudah punya item', () => {
    denganDb((db) => {
      buatJurnal(db, 'j-open-punya-item', '2026-02-01', 'PJ-OI');
      buatBaris(db, 'j-open-punya-item', '1040', 100_000, 0);
      buatBaris(db, 'j-open-punya-item', '1001', 0, 100_000);
      buatPanjar(db, {
        id: 'p-open-punya-item',
        status: 'OPEN',
        jurnalOpenId: 'j-open-punya-item',
      });
      buatItemPanjar(db, 'p-open-punya-item', '5004', 10_000, 'j-open-punya-item');

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_OPEN_PUNYA_ITEM',
        detail: { id: 'p-open-punya-item', status: 'OPEN', jumlah_item: 1 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/status OPEN.*item pertanggungjawaban/i);
    });
  });
});

describe('DB-20 — header panjar vs jurnal serah', () => {
  it('panjar normal lolos audit header', () => {
    denganDb((db) => {
      jurnalOpenPanjar(db, 'j-open-header', '2026-02-01', 100_000, '1001');
      buatPanjar(db, {
        id: 'p-header-ok',
        status: 'OPEN',
        jurnalOpenId: 'j-open-header',
      });

      expect(auditIntegritas(db).ok).toBe(true);
    });
  });

  it('mendeteksi jumlah header yang diubah lewat SQL langsung', () => {
    denganDb((db) => {
      jurnalOpenPanjar(db, 'j-open-jumlah', '2026-02-01', 100_000, '1001');
      buatPanjar(db, {
        id: 'p-header-jumlah',
        status: 'OPEN',
        jurnalOpenId: 'j-open-jumlah',
      });
      db.prepare("UPDATE panjar SET jumlah = 90000 WHERE id = 'p-header-jumlah'").run();

      const hasil = auditIntegritas(db);
      const temuan = hasil.temuan.find((t) => t.kode === 'PANJAR_HEADER_TIDAK_COCOK');

      expect(hasil.ok).toBe(false);
      expect(temuan).toMatchObject({
        kode: 'PANJAR_HEADER_TIDAK_COCOK',
        detail: {
          id: 'p-header-jumlah',
          jurnal_open_id: 'j-open-jumlah',
          jumlah: 90_000,
          debit_panjar: 100_000,
        },
      });
      expect(temuan?.pesan).toMatch(/jumlah header.*debit 1040/i);
      // GL 1040 tetap 100.000 sedangkan header panjar OPEN sudah diubah ke
      // 90.000; selisih ini juga dilaporkan AUD2-04.
      expect(kodeTemuan(db)).toContain('REKONSILIASI_PANJAR_GL_SELISIH');
    });
  });

  it('mendeteksi tanggal header yang berbeda dari jurnal serah', () => {
    denganDb((db) => {
      jurnalOpenPanjar(db, 'j-open-tanggal', '2026-02-01', 100_000, '1001');
      buatPanjar(db, {
        id: 'p-header-tanggal',
        status: 'OPEN',
        jurnalOpenId: 'j-open-tanggal',
      });
      db.prepare("UPDATE panjar SET tanggal = '2026-02-03' WHERE id = 'p-header-tanggal'").run();

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_HEADER_TIDAK_COCOK',
        detail: {
          id: 'p-header-tanggal',
          tanggal: '2026-02-03',
          tanggal_jurnal: '2026-02-01',
        },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/tanggal header/i);
    });
  });

  it('mendeteksi akun kas header yang tidak dipakai jurnal serah', () => {
    denganDb((db) => {
      jurnalOpenPanjar(db, 'j-open-kas', '2026-02-01', 100_000, '1001');
      buatPanjar(db, {
        id: 'p-header-kas',
        status: 'OPEN',
        jurnalOpenId: 'j-open-kas',
      });
      db.prepare("UPDATE panjar SET akun_kas_sumber = '1010' WHERE id = 'p-header-kas'").run();

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'PANJAR_HEADER_TIDAK_COCOK',
        detail: {
          id: 'p-header-kas',
          akun_kas_sumber: '1010',
          akun_kredit: '1001',
          kredit_kas: 0,
        },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/akun kas header/i);
    });
  });
});

describe('DB-21 — audit integritas pembatalan panjar', () => {
  type OpsiBatal = {
    status?: 'OPEN' | 'CLOSED';
    batalId?: string | null;
    /** Default true; false dipakai untuk mensimulasikan tautan yatim. */
    buatJurnalBatal?: boolean;
    tanggalBatal?: string | null;
    alasanBatal?: string;
    closeId?: string | null;
    tanggalClose?: string | null;
  };

  /** Panjar + jurnal serah + (opsional) jurnal batal; cukup untuk audit. */
  function panjarBatal(db: Database.Database, id: string, opsi: OpsiBatal = {}): void {
    const openId = `j-open-${id}`;
    jurnalOpenPanjar(db, openId);
    const batalId = opsi.batalId === undefined ? `j-batal-${id}` : opsi.batalId;
    if (batalId && opsi.buatJurnalBatal !== false) {
      buatJurnalLengkap(db, batalId, {
        tanggal: opsi.tanggalBatal ?? '2026-02-02',
        jenis: 'REVERSAL',
        grupId: openId,
        reversalOf: openId,
        baris: [
          ['1040', 0, 100_000],
          ['1001', 100_000, 0],
        ],
      });
    }
    db.prepare(
      `INSERT INTO panjar
         (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
          tanggal_close, jurnal_open_id, jurnal_close_id,
          jurnal_batal_id, tanggal_batal, alasan_batal, created_at)
       VALUES (?, '2026-02-01', 'Penerima Uji', 100000, '1001', ?,
               ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      opsi.status ?? 'OPEN',
      opsi.tanggalClose ?? null,
      openId,
      opsi.closeId ?? null,
      batalId,
      opsi.tanggalBatal === undefined ? '2026-02-02' : opsi.tanggalBatal,
      opsi.alasanBatal ?? 'Salah serah ke panitia',
      WAKTU,
    );
  }

  it('panjar yang dibatalkan dengan jurnal balik valid tidak menghasilkan temuan', () => {
    denganDb((db) => {
      panjarBatal(db, 'p-batal-bersih');
      const hasil = auditIntegritas(db);
      expect(hasil.temuan).toEqual([]);
      expect(hasil.ok).toBe(true);
    });
  });

  it('mendeteksi tautan jurnal batal yatim tanpa menghapus data', () => {
    denganDb((db) => {
      tanpaFk(db, () =>
        panjarBatal(db, 'p-batal-yatim', {
          batalId: 'j-hilang',
          buatJurnalBatal: false,
        }),
      );
      const hasil = auditIntegritas(db);
      expect(hasil.ok).toBe(false);
      expect(kodeTemuan(db)).toEqual(
        expect.arrayContaining(['PANJAR_BATAL_TIDAK_LENGKAP', 'FOREIGN_KEY']),
      );
      expect(
        (db.prepare("SELECT COUNT(*) AS n FROM panjar WHERE id = 'p-batal-yatim'").get() as {
          n: number;
        }).n,
      ).toBe(1);
    });
  });

  it('mendeteksi satu jurnal batal dipakai dua panjar', () => {
    denganDb((db) => {
      panjarBatal(db, 'p-batal-a');
      // Lepas index agar korupsi SQL langsung bisa di-seed.
      db.exec('DROP INDEX IF EXISTS ux_panjar_jurnal_batal');
      panjarBatal(db, 'p-batal-b');
      db.prepare(
        "UPDATE panjar SET jurnal_batal_id = 'j-batal-p-batal-a' WHERE id = 'p-batal-b'",
      ).run();

      const hasil = auditIntegritas(db);
      expect(hasil.ok).toBe(false);
      expect(kodeTemuan(db)).toContain('PANJAR_BATAL_GANDA');
      expect(
        hasil.temuan.find((t) => t.kode === 'PANJAR_BATAL_GANDA')?.pesan,
      ).toMatch(/dipakai 2 panjar/i);
    });
  });

  it('mendeteksi status/close/item dan jenis jurnal batal yang tidak konsisten', () => {
    denganDb((db) => {
      // Status tersimpan CLOSED padahal punya jurnal batal.
      panjarBatal(db, 'p-batal-closed', {
        status: 'CLOSED',
        tanggalClose: '2026-02-03',
      });
      // Jurnal batal ada tetapi bukan REVERSAL dan tidak membalik jurnal serah.
      panjarBatal(db, 'p-batal-jenis');
      buatJurnalLengkap(db, 'j-batal-salah', {
        jenis: 'UMUM',
        grupId: 'g-lain',
        reversalOf: null,
      });
      db.prepare(
        "UPDATE panjar SET jurnal_batal_id = 'j-batal-salah' WHERE id = 'p-batal-jenis'",
      ).run();

      // Item pertanggungjawaban tidak boleh ada pada panjar yang dibatalkan.
      buatJurnalLengkap(db, 'j-close-item', {
        jenis: 'PANJAR',
        baris: [
          ['5004', 50_000, 0],
          ['1040', 0, 50_000],
        ],
      });
      buatItemPanjar(db, 'p-batal-closed', '5004', 50_000, 'j-close-item');

      const hasil = auditIntegritas(db);
      expect(hasil.ok).toBe(false);
      expect(kodeTemuan(db)).toContain('PANJAR_BATAL_TIDAK_KONSISTEN');
      const detail = hasil.temuan.find(
        (t) => t.kode === 'PANJAR_BATAL_TIDAK_KONSISTEN' && t.detail,
      )?.detail as { id: string; alasan: string[] } | undefined;
      expect(detail?.id).toBeTruthy();
      expect(detail?.alasan.join(' ')).toMatch(/status tersimpan|bukan REVERSAL/);
    });
  });
});

describe('DB-34 — audit reversal, jenis jurnal, akun, dan baris', () => {

  it('reversal yang benar dan baris terpecah/urutan berbeda lolos audit', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', {
        grupId: 'g-asli',
        baris: [
          ['1001', 400, 0],
          ['1001', 600, 0],
          ['4001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
        reversalOf: 'j-asli',
        baris: [
          ['1001', 0, 400],
          ['4001', 1_000, 0],
          ['1001', 0, 600],
        ],
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(true);
      expect(hasil.temuan).toEqual([]);
    });
  });

  it('mendeteksi reversal dengan akun yang salah', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', {
        grupId: 'g-asli',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
        reversalOf: 'j-asli',
        baris: [
          ['4002', 1_000, 0],
          ['1001', 0, 1_000],
        ],
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_BARIS_TIDAK_CERMIN',
        detail: {
          reversal_id: 'j-balik',
          reversal_of: 'j-asli',
          akun_hilang: ['4001'],
          akun_ekstra: ['4002'],
        },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/tidak mencerminkan jurnal asli/i);
      expect(auditIntegritasDb(db)[0]).toMatch(/^REVERSAL_BARIS_TIDAK_CERMIN: /);
    });
  });

  it('mendeteksi reversal dengan nominal yang salah', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', {
        grupId: 'g-asli',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
        reversalOf: 'j-asli',
        baris: [
          ['4001', 900, 0],
          ['1001', 0, 900],
        ],
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_BARIS_TIDAK_CERMIN',
        detail: {
          reversal_id: 'j-balik',
          akun_hilang: [],
          akun_ekstra: [],
          akun_nilai_beda: [
            {
              akun: '1001',
              asli_debit: 1_000,
              asli_kredit: 0,
              balik_debit: 0,
              balik_kredit: 900,
            },
            {
              akun: '4001',
              asli_debit: 0,
              asli_kredit: 1_000,
              balik_debit: 900,
              balik_kredit: 0,
            },
          ],
          total_debit: 900,
          total_kredit: 900,
        },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/akun 4001/i);
    });
  });

  it('mendeteksi reversal dengan arah debit/kredit sama', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', {
        grupId: 'g-asli',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
        reversalOf: 'j-asli',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_BARIS_TIDAK_CERMIN',
        detail: { reversal_id: 'j-balik' },
      });
      expect(
        (hasil.temuan[0]?.detail as { akun_nilai_beda: unknown[] }).akun_nilai_beda,
      ).toHaveLength(2);
    });
  });

  it('mendeteksi reversal yang kehilangan satu baris', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', {
        grupId: 'g-asli',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
        reversalOf: 'j-asli',
        baris: [['4001', 1_000, 0]],
      });

      const hasil = auditIntegritas(db);
      const kode = hasil.temuan.map((t) => t.kode);
      const mirror = hasil.temuan.find((t) => t.kode === 'REVERSAL_BARIS_TIDAK_CERMIN');

      expect(kode).toContain('REVERSAL_BARIS_TIDAK_CERMIN');
      expect(mirror).toMatchObject({
        detail: { akun_hilang: ['1001'], akun_ekstra: [] },
      });
      // Satu baris juga memicu pemeriksaan lama; kode mirror tetap spesifik.
      expect(kode).toContain('JURNAL_KURANG_DUA_BARIS');
      expect(kode).toContain('JURNAL_TIDAK_SEIMBANG');
    });
  });

  it('mendeteksi reversal dengan baris akun ekstra', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', {
        grupId: 'g-asli',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
      });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
        reversalOf: 'j-asli',
        baris: [
          ['4001', 1_000, 0],
          ['1001', 0, 1_000],
          ['5001', 100, 0],
          ['5002', 0, 100],
        ],
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_BARIS_TIDAK_CERMIN',
        detail: { akun_hilang: [], akun_ekstra: ['5001', '5002'] },
      });
    });
  });

  it('mendeteksi reversal tanpa baris sama sekali', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', { grupId: 'g-asli' });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
        reversalOf: 'j-asli',
        baris: [],
      });

      const hasil = auditIntegritas(db);
      const kode = hasil.temuan.map((t) => t.kode);
      const mirror = hasil.temuan.find((t) => t.kode === 'REVERSAL_BARIS_TIDAK_CERMIN');

      expect(kode).toContain('REVERSAL_BARIS_TIDAK_CERMIN');
      expect(kode).toContain('JURNAL_TANPA_BARIS');
      expect(mirror).toMatchObject({
        detail: { total_debit: 0, total_kredit: 0 },
      });
      expect(
        (mirror?.detail as { alasan: string[] }).alasan.join(' '),
      ).toMatch(/jurnal balik tidak punya baris/i);
    });
  });
});

describe('DB-34 — pasangan reversal dan jenis jurnal', () => {
  /** Jurnal asli D 1001 / K 4001 dan reversal yang benar (D/K tertukar). */
  function pasanganReversalBersih(db: Database.Database): void {
    buatJurnalLengkap(db, 'j-asli', {
      grupId: 'g-asli',
      baris: [
        ['1001', 1_000, 0],
        ['4001', 0, 1_000],
      ],
    });
    buatJurnalLengkap(db, 'j-balik', {
      jenis: 'REVERSAL',
      grupId: 'g-asli',
      reversalOf: 'j-asli',
      baris: [
        ['4001', 1_000, 0],
        ['1001', 0, 1_000],
      ],
    });
  }

  it('menerima pasangan reversal normal tanpa temuan', () => {
    denganDb((db) => {
      pasanganReversalBersih(db);
      expect(auditIntegritas(db).temuan).toEqual([]);
      expect(auditIntegritas(db).ok).toBe(true);
    });
  });

  it('mendeteksi jurnal asli yang ternyata reversal', () => {
    denganDb((db) => {
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
        reversalOf: 'j-balik-1',
        baris: [
          ['1001', 1_000, 0],
          ['4001', 0, 1_000],
        ],
      });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'REVERSAL_ATAS_REVERSAL',
        detail: { reversal_id: 'j-balik-2', reversal_of: 'j-balik-1' },
      });
    });
  });

  it('mendeteksi dua reversal untuk jurnal asli yang sama', () => {
    denganDb((db) => {
      db.exec('DROP INDEX IF EXISTS ux_jurnal_reversal');
      pasanganReversalBersih(db);
      buatJurnalLengkap(db, 'j-balik-2', {
        jenis: 'REVERSAL',
        grupId: 'g-asli',
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
    });
  });

  it('mendeteksi grup reversal yang berbeda dari jurnal asli', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-asli', { grupId: 'g-asli' });
      buatJurnalLengkap(db, 'j-balik', {
        jenis: 'REVERSAL',
        grupId: 'g-lain',
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
        kode: 'REVERSAL_GRUP_BERBEDA',
        detail: { grup_reversal: 'g-lain', grup_asal: 'g-asli' },
      });
    });
  });

  it('mendeteksi jenis jurnal di luar JENIS_JURNAL saat trigger hilang', () => {
    denganDb((db) => {
      db.exec('DROP TRIGGER IF EXISTS trg_jurnal_validasi_insert');
      buatJurnalLengkap(db, 'j-jenis-liar', { jenis: 'LUAR_DAFTAR' });

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'JURNAL_JENIS_TIDAK_DIKENAL',
        detail: { id: 'j-jenis-liar', jenis: 'LUAR_DAFTAR' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/jenis.*tidak dikenal/i);
      expect(hasil.temuan[0]?.pesan).toMatch(/UMUM/);
    });
  });
});

describe('DB-34 — akun legacy, baris rusak, dan tabel opsional', () => {
  /** Drop trigger + CHECK sementara untuk mensimulasikan baris legacy/korup. */
  function tanpaCheckBaris(db: Database.Database, fn: () => void): void {
    db.exec(`
      DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_insert;
      DROP TRIGGER IF EXISTS trg_jurnal_baris_satu_sisi_update;
    `);
    db.pragma('ignore_check_constraints = ON');
    try {
      fn();
    } finally {
      db.pragma('ignore_check_constraints = OFF');
    }
  }

  it('mendeteksi kode akun bukan 4 digit dan nama kosong pada data legacy', () => {
    denganDb((db) => {
      db.exec(`
        DROP TRIGGER IF EXISTS trg_akun_validasi_insert;
        DROP TRIGGER IF EXISTS trg_akun_validasi_update;
      `);
      db.prepare(
        `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
         VALUES ('12', 'Akun Kode Pendek', 'AKTIVA', 'DEBIT', 1)`,
      ).run();
      db.prepare("UPDATE akun SET nama = '   ' WHERE kode = '4004'").run();

      const hasil = auditIntegritas(db);
      const kode = hasil.temuan.map((t) => t.kode);

      expect(hasil.ok).toBe(false);
      expect(kode).toContain('AKUN_KODE_TIDAK_VALID');
      expect(kode).toContain('AKUN_NAMA_KOSONG');
      expect(
        hasil.temuan.find((t) => t.kode === 'AKUN_KODE_TIDAK_VALID')?.pesan,
      ).toMatch(/tepat 4 digit/i);
      expect(hasil.temuan.find((t) => t.kode === 'AKUN_NAMA_KOSONG')?.pesan).toMatch(
        /nama kosong/i,
      );
    });
  });

  it('mendeteksi baris jurnal yang mengisi debit dan kredit sekaligus', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-dua-sisi');
      tanpaCheckBaris(db, () => buatBaris(db, 'j-dua-sisi', '5001', 100, 100));

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'BARIS_DUA_SISI',
        detail: { jurnal_id: 'j-dua-sisi', akun_kode: '5001' },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/debit dan kredit sekaligus/i);
    });
  });

  it('mendeteksi baris jurnal dengan nilai negatif', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-negatif');
      tanpaCheckBaris(db, () => buatBaris(db, 'j-negatif', '5001', -100, -100));

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'BARIS_NILAI_NEGATIF',
        detail: { jurnal_id: 'j-negatif', akun_kode: '5001', debit: -100, kredit: -100 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/nilai negatif/i);
    });
  });

  it('mendeteksi baris jurnal yang tidak punya sisi positif', () => {
    denganDb((db) => {
      buatJurnalLengkap(db, 'j-tanpa-sisi');
      tanpaCheckBaris(db, () => buatBaris(db, 'j-tanpa-sisi', '5001', 0, 0));

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(false);
      expect(hasil.temuan).toHaveLength(1);
      expect(hasil.temuan[0]).toMatchObject({
        kode: 'BARIS_TANPA_SISI',
        detail: { jurnal_id: 'j-tanpa-sisi', akun_kode: '5001', debit: 0, kredit: 0 },
      });
      expect(hasil.temuan[0]?.pesan).toMatch(/tidak punya sisi positif/i);
    });
  });

  it('tidak crash bila tabel panjar belum ada (backup v2/v3)', () => {
    denganDb((db) => {
      db.exec(`
        DROP TABLE panjar_item;
        DROP TABLE panjar;
      `);

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(true);
      expect(hasil.temuan).toEqual([]);
    });
  });

  it('tidak crash pada bentuk panjar pra-v4 tanpa kolom link jurnal', () => {
    denganDb((db) => {
      db.exec(`
        DROP TABLE panjar_item;
        DROP TABLE panjar;
        CREATE TABLE panjar (
          id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, penerima TEXT NOT NULL,
          jumlah INTEGER NOT NULL, akun_kas_sumber TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'OPEN'
        );
        CREATE TABLE panjar_item (
          panjar_id TEXT NOT NULL, kategori_baga TEXT NOT NULL, nominal INTEGER NOT NULL
        );
        INSERT INTO panjar
          (id, tanggal, penerima, jumlah, akun_kas_sumber, status)
        VALUES ('p-lama', '2025-01-01', 'Lama', 100, '1001', 'OPEN');
        INSERT INTO panjar_item (panjar_id, kategori_baga, nominal)
        VALUES ('p-lama', '5004', 50);
      `);

      const hasil = auditIntegritas(db);

      expect(hasil.ok).toBe(true);
      expect(hasil.temuan).toEqual([]);
    });
  });

  it('tidak lagi mereferensikan tabel modul yang dihapus DB-33', () => {
    const sumber = baca('src/db/integritas.ts');
    const tabelDihapus = [
      'pihak',
      'jurnal_pihak',
      'aset',
      'anggaran',
      'rekonsiliasi_bank',
      'lampiran_jurnal',
    ].join('|');
    expect(sumber).not.toMatch(new RegExp(`\\b(?:FROM|JOIN)\\s+(?:${tabelDihapus})\\b`, 'i'));
  });
});

describe('AUD2-04 — rekonsiliasi saldo GL 1040 vs panjar OPEN', () => {
  it('mendeteksi baris 1040 liar yang di-inject lewat SQL', () => {
    denganDb((db) => {
      jurnalOpenPanjar(db, 'j-open-aud204', '2026-02-01', 100_000, '1001');
      buatPanjar(db, {
        id: 'p-aud204',
        status: 'OPEN',
        jurnalOpenId: 'j-open-aud204',
      });
      expect(auditIntegritas(db).ok).toBe(true);

      // Baris liar D 1040 / K 1001 tanpa dokumen panjar. Trigger aplikasi tidak
      // menolak insert SQL langsung; audit harus menangkap split-brain-nya.
      buatJurnal(db, 'j-liar-1040', '2026-02-02', 'LIAR-1040');
      buatBaris(db, 'j-liar-1040', '1040', 25_000, 0);
      buatBaris(db, 'j-liar-1040', '1001', 0, 25_000);

      const hasil = auditIntegritas(db);
      const temuan = hasil.temuan.find(
        (t) => t.kode === 'REKONSILIASI_PANJAR_GL_SELISIH',
      );

      expect(hasil.ok).toBe(false);
      expect(temuan).toMatchObject({
        kode: 'REKONSILIASI_PANJAR_GL_SELISIH',
        detail: {
          akun: '1040',
          saldo_gl: 125_000,
          total_panjar: 100_000,
          selisih: 25_000,
        },
      });
      expect(temuan?.pesan).toMatch(/1040 UANG PANJAR/);
      expect(temuan?.pesan).toMatch(/panjar OPEN/i);
      expect(temuan?.pesan).toMatch(/selisih/i);
      expect(auditIntegritasDb(db).some((p) => p.startsWith('REKONSILIASI_PANJAR_GL_SELISIH: '))).toBe(
        true,
      );
    });
  });

  it('mengabaikan panjar CLOSED dan panjar yang sudah dibatalkan', () => {
    denganDb((db) => {
      panjarClosedLengkap(
        db,
        'p-tutup-aud204',
        [['5004', 100_000]],
        [
          ['5004', 100_000, 0],
          ['1040', 0, 100_000],
        ],
      );

      jurnalOpenPanjar(db, 'j-open-batal-aud204', '2026-02-03', 100_000, '1001');
      buatJurnalLengkap(db, 'j-batal-aud204', {
        tanggal: '2026-02-04',
        jenis: 'REVERSAL',
        grupId: 'j-open-batal-aud204',
        reversalOf: 'j-open-batal-aud204',
        baris: [
          ['1040', 0, 100_000],
          ['1001', 100_000, 0],
        ],
      });
      db.prepare(
        `INSERT INTO panjar
           (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
            tanggal_close, jurnal_open_id, jurnal_close_id,
            jurnal_batal_id, tanggal_batal, alasan_batal, created_at)
         VALUES ('p-batal-aud204', '2026-02-03', 'Penerima Uji', 100000, '1001', 'OPEN',
                 NULL, 'j-open-batal-aud204', NULL,
                 'j-batal-aud204', '2026-02-04', 'Salah serah', ?)`,
      ).run(WAKTU);

      const hasil = auditIntegritas(db);
      expect(hasil.temuan).toEqual([]);
      expect(hasil.ok).toBe(true);
    });
  });
});
