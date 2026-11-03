// AUD2-09 — seluruh 11 tabel aktif wajib STRICT, termasuk DB lama non-STRICT.
//
// Fixture dibuat dari DDL current yang diubah kembali ke bentuk v22:
// - semua `STRICT` dilepas;
// - CHECK panjar lama hanya OPEN/CLOSED;
// - kolom legacy `tutup_buku.backup_path` ditambahkan kembali.
// Setelah `openDb`, migrasi v23 harus merebuild tabel tanpa kehilangan data,
// membuang `backup_path`, memperlebar CHECK status, dan memasang ulang
// index/trigger.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  SCHEMA_VERSION,
  TABEL_AKTIF,
  openDb,
} from '../src/db/database.js';

const WAKTU = '2026-11-03T00:00:00.000Z';
const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-aud209-'));
  dirs.push(dir);
  return dir;
}

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function namaTabel(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function kolom(db: Database.Database, tabel: string): string[] {
  return (db.pragma(`table_info(${tabel})`) as { name: string }[]).map(
    (k) => k.name,
  );
}

function strict(db: Database.Database, tabel: string): number {
  const row = (
    db.pragma('table_list') as { schema: string; name: string; strict: number }[]
  ).find((r) => r.schema === 'main' && r.name === tabel);
  return Number(row?.strict ?? -1);
}

function daftarIndex(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function daftarTrigger(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** DDL v22 lama: non-STRICT, CHECK panjar lama, tanpa backup_path. */
function ddlV22Lama(): string {
  return DDL.replace(/\) STRICT;/g, ');').replace(
    "CHECK (status IN ('OPEN', 'CLOSED', 'DIBATALKAN'))",
    "CHECK (status IN ('OPEN', 'CLOSED'))",
  );
}

function buatFixtureV22(path: string): void {
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.exec(ddlV22Lama());
    if (!kolom(db, 'tutup_buku').includes('backup_path')) {
      db.exec("ALTER TABLE tutup_buku ADD COLUMN backup_path TEXT NOT NULL DEFAULT ''");
    }

    const insAkun = db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif, is_kas, kelompok, sumber)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    );
    insAkun.run('1001', 'KAS', 'AKTIVA', 'DEBIT', 1, 'KAS', 'BAWAAN');
    insAkun.run('1040', 'UANG PANJAR', 'AKTIVA', 'DEBIT', 0, 'PANJAR', 'BAWAAN');
    insAkun.run('2050', 'HUTANG LAIN-LAIN', 'KEWAJIBAN', 'KREDIT', 0, 'HUTANG', 'BAWAAN');
    insAkun.run('3000', 'MODAL', 'EKUITAS', 'KREDIT', 0, 'EKUITAS', 'BAWAAN');
    insAkun.run('4005', 'PENDAPATAN', 'PENDAPATAN', 'KREDIT', 0, 'PENDAPATAN', 'BAWAAN');
    insAkun.run('5004', 'BEBAN', 'BEBAN', 'DEBIT', 0, 'BEBAN', 'BAWAAN');
    insAkun.run('5063', 'BUNGA', 'BEBAN', 'DEBIT', 0, 'BEBAN', 'BAWAAN');
    insAkun.run('9999', 'AKUN KHUSUS AUD209', 'BEBAN', 'DEBIT', 0, 'BEBAN', 'TAMBAHAN');

    const insJurnal = db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insJurnal.run('j-open', '2026-02-01', 'PNJ-1', 'Panjar open', 'PANJAR', 'j-open', null, WAKTU);
    insJurnal.run('j-open2', '2026-02-02', 'PNJ-2', 'Panjar batal', 'PANJAR', 'j-open2', null, WAKTU);
    insJurnal.run('j-open3', '2026-02-03', 'PNJ-3', 'Panjar closed', 'PANJAR', 'j-open3', null, WAKTU);
    insJurnal.run('j-close', '2026-02-04', 'PNJ-4', 'Close panjar', 'PANJAR', 'j-close', null, WAKTU);
    insJurnal.run('j-batal', '2026-02-05', 'PNJ-5', 'Batal panjar', 'REVERSAL', 'j-open2', 'j-open2', WAKTU);
    insJurnal.run('j-pencairan', '2026-01-02', 'H-1', 'Pencairan pinjaman', 'HUTANG', 'j-pencairan', null, WAKTU);
    insJurnal.run('j-bayar', '2026-03-02', 'H-2', 'Bayar pinjaman', 'HUTANG', 'j-bayar', null, WAKTU);

    const insBaris = db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, '')`,
    );
    insBaris.run('j-open', '1040', 100_000, 0);
    insBaris.run('j-open', '1001', 0, 100_000);
    insBaris.run('j-open2', '1040', 50_000, 0);
    insBaris.run('j-open2', '1001', 0, 50_000);
    insBaris.run('j-open3', '1040', 100_000, 0);
    insBaris.run('j-open3', '1001', 0, 100_000);
    insBaris.run('j-close', '5004', 100_000, 0);
    insBaris.run('j-close', '1040', 0, 100_000);
    insBaris.run('j-batal', '1001', 50_000, 0);
    insBaris.run('j-batal', '1040', 0, 50_000);
    insBaris.run('j-pencairan', '1001', 1_000_000, 0);
    insBaris.run('j-pencairan', '2050', 0, 1_000_000);
    insBaris.run('j-bayar', '2050', 100_000, 0);
    insBaris.run('j-bayar', '1001', 0, 100_000);

    db.prepare(
      `INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan)
       VALUES (2025, ?, '/backup/lama-2025.db', 'Catatan lama')`,
    ).run(WAKTU);

    db.prepare(
      `INSERT INTO audit_log
         (id, tanggal, aksi, alasan, data_lama_json, data_baru_json, ref_type, ref_id)
       VALUES ('a-lama', ?, 'UJI', 'Audit lama', '{"lama":1}', '{"baru":2}', '', '')`,
    ).run(WAKTU);

    db.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('nama_entitas', 'PURA UJI')").run();

    const insPanjar = db.prepare(
      `INSERT INTO panjar
         (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
          tanggal_close, jurnal_open_id, jurnal_close_id, created_at,
          jurnal_batal_id, tanggal_batal, alasan_batal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insPanjar.run('p-open', '2026-02-01', 'Panitia Open', 100_000, '1001', 'OPEN', null, 'j-open', null, WAKTU, null, null, '');
    insPanjar.run('p-batal', '2026-02-02', 'Panitia Batal', 50_000, '1001', 'OPEN', null, 'j-open2', null, WAKTU, 'j-batal', '2026-02-05', 'Salah serah');
    insPanjar.run('p-closed', '2026-02-03', 'Panitia Closed', 100_000, '1001', 'CLOSED', '2026-02-04', 'j-open3', 'j-close', WAKTU, null, null, '');

    db.prepare(
      `INSERT INTO panjar_item
         (panjar_id, kategori_baga, nominal, jurnal_id, nota_nomor, nota_tanggal, toko, keterangan)
       VALUES ('p-closed', '5004', 100000, 'j-close', 'N-1', '2026-02-04', 'Toko', '')`,
    ).run();

    db.prepare(
      `INSERT INTO pinjaman
         (id, kreditur, akun_kas, akun_bunga, pokok_awal, sisa_pokok_awal,
          tanggal_mulai, tenor_bulan, jurnal_pencairan_id, catatan, created_at)
       VALUES ('pjr-lama', 'LPD Desa', '1001', '5063', 1000000, 900000,
               '2026-01-02', 12, 'j-pencairan', '', ?)`,
    ).run(WAKTU);
    db.prepare(
      `INSERT INTO pinjaman_angsuran
         (pinjaman_id, ke, jatuh_tempo, pokok, bunga, catatan)
       VALUES ('pjr-lama', 1, '2026-02-02', 100000, 10000, '')`,
    ).run();
    db.prepare(
      `INSERT INTO pinjaman_bayar
         (id, pinjaman_id, angsuran_id, jurnal_id, tanggal, catatan, created_at)
       VALUES ('pb-lama', 'pjr-lama', 1, 'j-bayar', '2026-03-02', '', ?)`,
    ).run(WAKTU);

    db.pragma('user_version = 22');
  } finally {
    db.close();
  }
}

describe('AUD2-09 — migrasi v23 seluruh tabel aktif STRICT', () => {
  it('membuat DB baru dengan 11 tabel STRICT, tanpa backup_path, CHECK status resmi', () => {
    const db = openDb(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(23);
      expect(namaTabel(db)).toEqual([...TABEL_AKTIF].sort());
      for (const tabel of TABEL_AKTIF) {
        expect(strict(db, tabel), `${tabel} harus STRICT`).toBe(1);
      }
      expect(kolom(db, 'tutup_buku')).not.toContain('backup_path');
      expect(kolom(db, 'panjar')).toContain('status');

      // CHECK resmi menerima DIBATALKAN.
      db.prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES ('j-check', '2026-01-01', 'UJI-1', 'Uji CHECK', 'UMUM', 'j-check', NULL, ?)`,
      ).run(WAKTU);
      expect(() =>
        db
          .prepare(
            `INSERT INTO panjar
               (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
                tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
             VALUES ('p-check', '2026-01-01', 'Uji', 1000, '1001', 'DIBATALKAN',
                     NULL, 'j-check', NULL, ?)`,
          )
          .run(WAKTU),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('merebuild DB v22 non-STRICT tanpa kehilangan data dan tetap idempoten', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV22(path);

    const sebelum = new Database(path, { readonly: true });
    const dataSebelum = {
      jurnal: sebelum.prepare('SELECT id, tanggal, no_bukti, keterangan, jenis FROM jurnal ORDER BY id').all(),
      baris: sebelum.prepare('SELECT jurnal_id, akun_kode, debit, kredit FROM jurnal_baris ORDER BY id').all(),
      akunKhusus: sebelum.prepare("SELECT kode, nama, tipe FROM akun WHERE kode = '9999'").get(),
      pengaturan: sebelum.prepare('SELECT kunci, nilai FROM pengaturan ORDER BY kunci').all(),
      pinjaman: sebelum.prepare('SELECT id, kreditur, sisa_pokok_awal FROM pinjaman ORDER BY id').all(),
      angsuran: sebelum.prepare('SELECT pinjaman_id, ke, pokok, bunga FROM pinjaman_angsuran ORDER BY id').all(),
      bayar: sebelum.prepare('SELECT id, jurnal_id, tanggal FROM pinjaman_bayar ORDER BY id').all(),
      audit: sebelum.prepare('SELECT id, aksi, alasan FROM audit_log ORDER BY id').all(),
      tutup: sebelum.prepare('SELECT tahun, created_at, catatan FROM tutup_buku ORDER BY tahun').all(),
    };
    sebelum.close();

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(23);
      for (const tabel of TABEL_AKTIF) {
        expect(strict(db, tabel), `${tabel} harus STRICT setelah migrasi`).toBe(1);
      }

      // backup_path benar-benar dibuang, data lain di tutup_buku tetap utuh.
      expect(kolom(db, 'tutup_buku')).not.toContain('backup_path');
      expect(db.prepare('SELECT tahun, created_at, catatan FROM tutup_buku ORDER BY tahun').all()).toEqual(
        dataSebelum.tutup,
      );

      // Data seluruh tabel lain tidak berubah.
      expect(db.prepare('SELECT id, tanggal, no_bukti, keterangan, jenis FROM jurnal ORDER BY id').all()).toEqual(
        dataSebelum.jurnal,
      );
      expect(db.prepare('SELECT jurnal_id, akun_kode, debit, kredit FROM jurnal_baris ORDER BY id').all()).toEqual(
        dataSebelum.baris,
      );
      expect(db.prepare("SELECT kode, nama, tipe FROM akun WHERE kode = '9999'").get()).toEqual(
        dataSebelum.akunKhusus,
      );
      expect(db.prepare('SELECT kunci, nilai FROM pengaturan ORDER BY kunci').all()).toEqual(
        dataSebelum.pengaturan,
      );
      expect(db.prepare('SELECT id, kreditur, sisa_pokok_awal FROM pinjaman ORDER BY id').all()).toEqual(
        dataSebelum.pinjaman,
      );
      expect(db.prepare('SELECT pinjaman_id, ke, pokok, bunga FROM pinjaman_angsuran ORDER BY id').all()).toEqual(
        dataSebelum.angsuran,
      );
      expect(db.prepare('SELECT id, jurnal_id, tanggal FROM pinjaman_bayar ORDER BY id').all()).toEqual(
        dataSebelum.bayar,
      );
      expect(db.prepare('SELECT id, aksi, alasan FROM audit_log ORDER BY id').all()).toEqual(
        dataSebelum.audit,
      );

      // Panjar lama yang sudah punya jurnal batal dinormalisasi ke DIBATALKAN.
      expect(
        db.prepare('SELECT id, status, jurnal_batal_id, tanggal_batal FROM panjar ORDER BY id').all(),
      ).toEqual([
        { id: 'p-batal', status: 'DIBATALKAN', jurnal_batal_id: 'j-batal', tanggal_batal: '2026-02-05' },
        { id: 'p-closed', status: 'CLOSED', jurnal_batal_id: null, tanggal_batal: null },
        { id: 'p-open', status: 'OPEN', jurnal_batal_id: null, tanggal_batal: null },
      ]);

      // Index dan trigger wajib kembali setelah rebuild.
      const index = daftarIndex(db);
      for (const nama of [
        'idx_jurnal_tanggal',
        'idx_jurnal_grup',
        'idx_jurnal_reversal',
        'idx_jurnal_no_bukti_tahun',
        'ux_jurnal_saldo_awal',
        'ux_jurnal_reversal',
        'ux_akun_nama_nocase',
        'idx_audit_tanggal',
        'idx_audit_aksi',
        'idx_audit_ref',
        'idx_panjar_status',
        'idx_panjar_tanggal',
        'ux_panjar_jurnal_open',
        'ux_panjar_jurnal_close',
        'ux_panjar_jurnal_batal',
        'idx_panjar_item_panjar',
        'idx_pinjaman_tanggal',
        'idx_pinjaman_kreditur',
        'idx_pinjaman_angsuran_pinjaman',
        'idx_pinjaman_angsuran_jatuh_tempo',
        'idx_pinjaman_bayar_pinjaman',
        'idx_pinjaman_bayar_tanggal',
        'idx_pinjaman_bayar_angsuran',
      ]) {
        expect(index, `index ${nama}`).toContain(nama);
      }

      const trigger = daftarTrigger(db);
      for (const nama of [
        'trg_jurnal_baris_satu_sisi_insert',
        'trg_jurnal_baris_satu_sisi_update',
        'trg_jurnal_immutable_update',
        'trg_jurnal_immutable_delete',
        'trg_jurnal_baris_immutable_update',
        'trg_jurnal_baris_immutable_delete',
        'trg_jurnal_validasi_insert',
        'trg_akun_validasi_insert',
        'trg_akun_validasi_update',
        'trg_audit_log_immutable_update',
        'trg_audit_log_immutable_delete',
        'trg_tutup_buku_immutable_delete',
      ]) {
        expect(trigger, `trigger ${nama}`).toContain(nama);
      }

      // Trigger tetap efektif setelah rebuild.
      expect(() =>
        db.prepare("UPDATE jurnal SET keterangan = 'Diubah' WHERE id = 'j-open'").run(),
      ).toThrow(/Jurnal tidak boleh diubah/);
      expect(() =>
        db.prepare("UPDATE audit_log SET alasan = 'Diubah' WHERE id = 'a-lama'").run(),
      ).toThrow(/Audit log tidak boleh diubah/);
      expect(() => db.prepare('DELETE FROM tutup_buku WHERE tahun = 2025').run()).toThrow(
        /Tutup buku tidak boleh dihapus/,
      );
      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
             VALUES ('j-open', '1001', 0.5, 0, '')`,
          )
          .run(),
      ).toThrow(/bilangan bulat|integer/i);

      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }

    // Idempoten: buka ulang tidak mengubah data/versi.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(23);
      for (const tabel of TABEL_AKTIF) expect(strict(db2, tabel)).toBe(1);
      expect(
        (db2.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n,
      ).toBe(7);
      expect(
        (db2.prepare('SELECT COUNT(*) AS n FROM panjar').get() as { n: number }).n,
      ).toBe(3);
      expect(db2.prepare('SELECT status FROM panjar WHERE id = ?').get('p-batal')).toEqual({
        status: 'DIBATALKAN',
      });
    } finally {
      db2.close();
    }
  });

  it('aman untuk DB versi lama non-STRICT yang belum punya tabel pinjaman', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV22(path);

    const lama = new Database(path);
    try {
      lama.pragma('foreign_keys = OFF');
      lama.exec(`
        DROP TABLE pinjaman_bayar;
        DROP TABLE pinjaman_angsuran;
        DROP TABLE pinjaman;
      `);
      lama.pragma('user_version = 8');
    } finally {
      lama.close();
    }

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(23);
      for (const tabel of TABEL_AKTIF) {
        expect(strict(db, tabel), `${tabel} harus STRICT`).toBe(1);
      }
      expect(namaTabel(db)).toEqual([...TABEL_AKTIF].sort());
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n,
      ).toBe(7);
      expect(db.prepare('SELECT status FROM panjar WHERE id = ?').get('p-batal')).toEqual({
        status: 'DIBATALKAN',
      });
      expect(
        (db.prepare('SELECT COUNT(*) AS n FROM pinjaman').get() as { n: number }).n,
      ).toBe(0);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });
});
