// DB-16b — migrasi v19 → v20: tabel pinjaman LPD baru, aditif/idempoten.
//
// Fixture v19 dibuat dari DB current lalu tiga tabel pinjaman dibuang dan
// user_version diturunkan. Ini meniru DB sebelum DB-16b: jurnal, akun, dan
// panjar lama wajib tetap utuh setelah migrasi.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { buatPinjaman, getPinjaman } from '../src/db/pinjaman.js';
import {
  TABEL_WAJIB_RESTORE_V20,
  tabelWajibRestore,
} from '../src/features/export/export.js';

const WAKTU = '2026-11-01T00:00:00.000Z';
const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-v20-'));
  dirs.push(dir);
  return dir;
}

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function namaTabel(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function kolom(db: Database.Database, tabel: string): string[] {
  return (db.pragma(`table_info(${tabel})`) as { name: string }[]).map(
    (k) => k.name,
  );
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** DB v19: data lama ada, tiga tabel pinjaman belum dibuat. */
function buatFixtureV19(path: string): void {
  const db = openDb(path);
  try {
    db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES ('j-lama', '2026-01-02', 'H-1', 'Terima pinjaman lama', 'HUTANG',
               'j-lama', NULL, ?)`,
    ).run(WAKTU);
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-lama', '1001', 5000000, 0, '')`,
    ).run();
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-lama', '2050', 0, 5000000, '')`,
    ).run();

    db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES ('j-panjar', '2026-01-03', 'P-1', 'Panjar lama', 'PANJAR',
               'j-panjar', NULL, ?)`,
    ).run(WAKTU);
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-panjar', '1040', 250000, 0, '')`,
    ).run();
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-panjar', '1001', 0, 250000, '')`,
    ).run();
    db.prepare(
      `INSERT INTO panjar
         (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
          tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
       VALUES ('p-lama', '2026-01-03', 'Panitia Lama', 250000, '1001', 'OPEN',
               NULL, 'j-panjar', NULL, ?)`,
    ).run(WAKTU);

    db.exec('DROP TABLE pinjaman_bayar');
    db.exec('DROP TABLE pinjaman_angsuran');
    db.exec('DROP TABLE pinjaman');
    db.pragma('user_version = 19');
  } finally {
    db.close();
  }
}

describe('DB-16b — migrasi v20 tabel pinjaman', () => {
  it('mewajibkan tabel pinjaman hanya untuk backup v20+, bukan backup lama', () => {
    expect([...TABEL_WAJIB_RESTORE_V20]).toEqual(
      expect.arrayContaining([
        'pinjaman',
        'pinjaman_angsuran',
        'pinjaman_bayar',
      ]),
    );
    expect(tabelWajibRestore(19)).not.toContain('pinjaman');
    expect(tabelWajibRestore(4)).not.toContain('pinjaman_bayar');
    expect(tabelWajibRestore(20)).toEqual(
      expect.arrayContaining(['pinjaman', 'pinjaman_angsuran', 'pinjaman_bayar']),
    );
  });

  it('membuat tabel baru tanpa mengubah jurnal/akun/panjar lama', () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV19(path);

    const sebelum = new Database(path, { readonly: true });
    const jurnalSebelum = sebelum
      .prepare('SELECT id, tanggal, no_bukti, keterangan, jenis FROM jurnal ORDER BY id')
      .all();
    const barisSebelum = sebelum
      .prepare(
        'SELECT jurnal_id, akun_kode, debit, kredit FROM jurnal_baris ORDER BY id',
      )
      .all();
    const akunSebelum = sebelum
      .prepare('SELECT kode, nama, tipe, posisi_normal FROM akun ORDER BY kode')
      .all();
    sebelum.close();

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(21);
      expect(versi(db)).toBe(21);
      expect(namaTabel(db)).toEqual(
        expect.arrayContaining([
          'pinjaman',
          'pinjaman_angsuran',
          'pinjaman_bayar',
        ]),
      );

      // Data lama tidak berubah sama sekali.
      expect(
        db
          .prepare('SELECT id, tanggal, no_bukti, keterangan, jenis FROM jurnal ORDER BY id')
          .all(),
      ).toEqual(jurnalSebelum);
      expect(
        db
          .prepare(
            'SELECT jurnal_id, akun_kode, debit, kredit FROM jurnal_baris ORDER BY id',
          )
          .all(),
      ).toEqual(barisSebelum);
      expect(
        db
          .prepare('SELECT kode, nama, tipe, posisi_normal FROM akun ORDER BY kode')
          .all(),
      ).toEqual(akunSebelum);
      expect(
        db.prepare("SELECT id, status, jurnal_open_id FROM panjar").all(),
      ).toEqual([{ id: 'p-lama', status: 'OPEN', jurnal_open_id: 'j-panjar' }]);

      // Tidak ada kolom saldo tersimpan / nominal pembayaran duplikat.
      expect(kolom(db, 'pinjaman')).not.toEqual(
        expect.arrayContaining(['sisa_pokok', 'saldo_pokok', 'saldo_berjalan']),
      );
      expect(kolom(db, 'pinjaman_bayar')).not.toEqual(
        expect.arrayContaining(['pokok', 'bunga', 'denda', 'nominal']),
      );

      // Tabel baru langsung bisa dipakai pada DB hasil migrasi.
      const baru = buatPinjaman(db, {
        id: 'pjr-migrasi',
        kreditur: 'LPD Desa',
        akun_kas: '1001',
        akun_bunga: '5063',
        pokok_awal: 5_000_000,
        sisa_pokok_awal: 5_000_000,
        tanggal_mulai: '2026-01-02',
        tenor_bulan: 1,
        jurnal_pencairan_id: 'j-lama',
        angsuran: [
          {
            ke: 1,
            jatuh_tempo: '2026-02-02',
            pokok: 5_000_000,
            bunga: 100_000,
          },
        ],
      });
      expect(baru.tersimpan, baru.errors.join(' ')).toBe(true);
      expect(getPinjaman(db, 'pjr-migrasi')?.outstanding).toBe(5_000_000);
    } finally {
      db.close();
    }

    // Idempoten: buka ulang tidak menggandakan tabel/data.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(21);
      expect(
        (db2.prepare('SELECT COUNT(*) AS n FROM pinjaman').get() as { n: number }).n,
      ).toBe(1);
      expect(
        (db2.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n,
      ).toBe(2);
    } finally {
      db2.close();
    }
  });
});
