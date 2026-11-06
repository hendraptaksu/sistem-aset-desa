// DB-30 — invariant ringan skema aktif (v23).
//
// Fokus:
// - set tabel aktif tepat 11; tidak ada tabel modul lama yang muncul kembali;
// - seluruh 11 tabel aktif STRICT (AUD2-09);
// - unique index penting (saldo awal, reversal, nama akun NOCASE, link panjar,
//   link pembayaran pinjaman) ada dan unik;
// - kolom `created_at` tersedia pada tabel yang memakainya; `audit_log` memakai
//   `tanggal` (bukan `created_at`) sesuai skema nyata;
// - `pinjaman_bayar`/`pinjaman_angsuran` tidak menyimpan saldo berjalan atau
//   nominal pembayaran ganda.

import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb, SCHEMA_VERSION } from '../src/db/database.js';

/** Tabel modul lama yang sudah dihapus dan tidak boleh muncul lagi. */
const TABEL_LEGACY = [
  'transaksi',
  'coa',
  'pihak',
  'jurnal_pihak',
  'aset',
  'anggaran',
  'rekonsiliasi_bank',
  'lampiran_jurnal',
] as const;

const TABEL_AKTIF = [
  'akun',
  'audit_log',
  'jurnal',
  'jurnal_baris',
  'panjar',
  'panjar_item',
  'pengaturan',
  'pinjaman',
  'pinjaman_angsuran',
  'pinjaman_bayar',
  'tutup_buku',
] as const;

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

interface InfoIndex {
  name: string;
  unique: number;
  partial: number;
}

function infoIndex(
  db: Database.Database,
  tabel: string,
  nama: string,
): InfoIndex | undefined {
  return (db.pragma(`index_list(${tabel})`) as InfoIndex[]).find(
    (i) => i.name === nama,
  );
}

function sqlIndex(db: Database.Database, nama: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(nama) as { sql: string } | undefined;
  return row?.sql ?? '';
}

function adaUniqueKolom(
  db: Database.Database,
  tabel: string,
  namaKolom: string,
): boolean {
  const indexes = db.pragma(`index_list(${tabel})`) as InfoIndex[];
  return indexes.some((i) => {
    if (Number(i.unique) !== 1) return false;
    const kolomIndex = db.pragma(`index_info(${i.name})`) as { name: string }[];
    return kolomIndex.length === 1 && kolomIndex[0]?.name === namaKolom;
  });
}

function adaUniqueGabungan(
  db: Database.Database,
  tabel: string,
  namaKolom: string[],
): boolean {
  const indexes = db.pragma(`index_list(${tabel})`) as InfoIndex[];
  return indexes.some((i) => {
    if (Number(i.unique) !== 1) return false;
    const kolomIndex = db.pragma(`index_info(${i.name})`) as { name: string }[];
    return (
      kolomIndex.length === namaKolom.length &&
      kolomIndex.every((k, posisi) => k.name === namaKolom[posisi])
    );
  });
}

describe('DB-30 — invariant tabel aktif', () => {
  it('memakai tepat 11 tabel aktif dan tidak menghidupkan tabel lama', () => {
    const db = openDb(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(23);
      expect(namaTabel(db)).toEqual([...TABEL_AKTIF]);
      for (const tabel of TABEL_AKTIF) {
        expect(strict(db, tabel), `${tabel} harus STRICT`).toBe(1);
      }
      expect(namaTabel(db)).not.toEqual(
        expect.arrayContaining([...TABEL_LEGACY]),
      );
    } finally {
      db.close();
    }
  });

  it('unique index saldo awal, reversal, nama akun, panjar, dan pembayaran pinjaman aktif', () => {
    const db = openDb(':memory:');
    try {
      const harapan: Array<[string, string, number]> = [
        // [tabel, index, partial]
        ['jurnal', 'ux_jurnal_saldo_awal', 1],
        ['jurnal', 'ux_jurnal_reversal', 1],
        ['akun', 'ux_akun_nama_nocase', 0],
        ['panjar', 'ux_panjar_jurnal_open', 0],
        ['panjar', 'ux_panjar_jurnal_close', 1],
        ['panjar', 'ux_panjar_jurnal_batal', 1],
      ];

      for (const [tabel, nama, partial] of harapan) {
        const index = infoIndex(db, tabel, nama);
        expect(index, `index ${nama} harus ada di ${tabel}`).toBeDefined();
        expect(Number(index?.unique), `${nama} harus UNIQUE`).toBe(1);
        expect(Number(index?.partial), `${nama} partial`).toBe(partial);
      }

      expect(adaUniqueKolom(db, 'pinjaman_bayar', 'angsuran_id')).toBe(false);
      expect(infoIndex(db, 'pinjaman_bayar', 'idx_pinjaman_bayar_angsuran')).toBeDefined();

      // Unique inline yang penting untuk link jurnal/angsuran.
      expect(adaUniqueKolom(db, 'pinjaman', 'jurnal_pencairan_id')).toBe(true);
      expect(adaUniqueKolom(db, 'pinjaman_bayar', 'jurnal_id')).toBe(true);
      expect(
        adaUniqueGabungan(db, 'pinjaman_angsuran', ['pinjaman_id', 'ke']),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  it('akun.nama unik NOCASE hanya punya satu implementasi index', () => {
    const db = openDb(':memory:');
    try {
      const sql = sqlIndex(db, 'ux_akun_nama_nocase');
      expect(sql).toMatch(/UNIQUE INDEX/);
      expect(sql).toMatch(/ON akun\(nama COLLATE NOCASE\)/);

      const uniqueNama = (
        db.pragma('index_list(akun)') as InfoIndex[]
      ).filter((i) => {
        if (Number(i.unique) !== 1) return false;
        const kolomIndex = db.pragma(`index_info(${i.name})`) as {
          name: string;
        }[];
        return kolomIndex.length === 1 && kolomIndex[0]?.name === 'nama';
      });
      expect(uniqueNama.map((i) => i.name)).toEqual(['ux_akun_nama_nocase']);

      // Efektif tanpa membedakan kapital: seed sudah punya "KAS".
      expect(() =>
        db
          .prepare(
            `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
             VALUES ('5901', 'kas', 'BEBAN', 'DEBIT', 1)`,
          )
          .run(),
      ).toThrow(/UNIQUE constraint failed/i);
    } finally {
      db.close();
    }
  });

  it('created_at ada di tabel operasional yang memakainya; audit memakai tanggal', () => {
    const db = openDb(':memory:');
    try {
      for (const tabel of [
        'jurnal',
        'tutup_buku',
        'panjar',
        'pinjaman',
        'pinjaman_bayar',
      ]) {
        expect(kolom(db, tabel), `${tabel}.created_at`).toContain('created_at');
      }

      // Skema nyata: audit_log punya timestamp `tanggal`, bukan created_at.
      expect(kolom(db, 'audit_log')).toContain('tanggal');
      expect(kolom(db, 'audit_log')).not.toContain('created_at');

      // Jadwal angsuran adalah rencana; tidak punya timestamp sendiri.
      expect(kolom(db, 'pinjaman_angsuran')).not.toContain('created_at');
    } finally {
      db.close();
    }
  });

  it('tidak ada kolom saldo berjalan/nominal ganda di tabel pinjaman', () => {
    const db = openDb(':memory:');
    try {
      const terlarang = [
        'sisa_pokok',
        'running_balance',
        'saldo_berjalan',
        'saldo_pokok',
      ];
      for (const tabel of ['pinjaman', 'pinjaman_bayar', 'pinjaman_angsuran']) {
        expect(kolom(db, tabel)).not.toEqual(
          expect.arrayContaining(terlarang),
        );
      }

      // Sisa pokok awal (parameter perjanjian) tetap ada di header.
      expect(kolom(db, 'pinjaman')).toContain('sisa_pokok_awal');

      // Nominal pembayaran hanya boleh dibaca dari jurnal, bukan disimpan.
      expect(kolom(db, 'pinjaman_bayar')).not.toEqual(
        expect.arrayContaining(['pokok', 'bunga', 'denda', 'nominal']),
      );
    } finally {
      db.close();
    }
  });
});
