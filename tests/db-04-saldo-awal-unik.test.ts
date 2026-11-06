// DB-04 — satu jurnal SALDO_AWAL pada skema v1 + status wizard berbasis
// eksistensi.
//
// Fokus:
// - DB v1 baru menerima SALDO_AWAL pertama dan menolak SALDO_AWAL kedua lewat
//   unique index parsial `ux_jurnal_saldo_awal`; jurnal pertama tetap utuh.
// - `sudahAdaSaldoAwal()` / `statusSaldoAwal()` hanya terkunci oleh SALDO_AWAL,
//   bukan oleh jurnal harian biasa.
// - DB baru langsung memiliki unique index parsial tersebut, dan membuka ulang
//   file DB v1 tidak menambah data maupun index.

import type Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import {
  getJurnal,
  insertJurnalTervalidasi,
  listJurnalBaris,
} from '../src/db/repository.js';
import {
  PESAN_SALDO_AWAL_SUDAH_ADA,
  statusSaldoAwal,
  sudahAdaSaldoAwal,
} from '../src/db/saldoAwal.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const RP = (rupiah: number): number => rupiah * 100;
const WAKTU = '2026-01-01T00:00:00.000Z';

const dirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function pasangan(
  debit = '1001',
  kredit = '3000',
  nominal = RP(1_000_000),
): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

function indeksSaldoAwal(
  db: Database.Database,
): { name: string; sql: string } | undefined {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND name = 'ux_jurnal_saldo_awal'`,
    )
    .get() as { name: string; sql: string } | undefined;
}

function jumlahJurnal(db: Database.Database): number {
  return Number(
    (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n,
  );
}

function jumlahSaldoAwal(db: Database.Database): number {
  return Number(
    (
      db
        .prepare("SELECT COUNT(*) AS n FROM jurnal WHERE jenis = 'SALDO_AWAL'")
        .get() as { n: number }
    ).n,
  );
}

describe('DB-04 — unique index saldo awal', () => {
  it('menerima SALDO_AWAL pertama dan menolak SALDO_AWAL kedua; jurnal pertama tetap utuh', () => {
    const db = openDb(':memory:');
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-awal',
          tanggal: '2026-01-01',
          no_bukti: 'SA-2026-0001',
          keterangan: 'Saldo awal',
          jenis: 'SALDO_AWAL',
        },
        pasangan(),
      );

      expect(getJurnal(db, 'j-awal')).toMatchObject({
        id: 'j-awal',
        tanggal: '2026-01-01',
        jenis: 'SALDO_AWAL',
      });

      // INSERT mentah juga ditolak: penjaga terakhir ada di level DB, bukan
      // hanya di jalur aplikasi.
      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, created_at)
             VALUES (?, ?, ?, ?, 'SALDO_AWAL', ?, ?)`,
          )
          .run(
            'j-awal-2',
            '2026-01-02',
            'SA-2026-0002',
            'Saldo awal kedua',
            'j-awal-2',
            WAKTU,
          ),
      ).toThrow(/UNIQUE|ux_jurnal_saldo_awal/);

      // Jurnal pertama (header + dua baris) tidak berubah dan tidak bertambah.
      expect(jumlahJurnal(db)).toBe(1);
      expect(jumlahSaldoAwal(db)).toBe(1);
      expect(getJurnal(db, 'j-awal')).toMatchObject({
        id: 'j-awal',
        tanggal: '2026-01-01',
        no_bukti: 'SA-2026-0001',
        jenis: 'SALDO_AWAL',
      });
      expect(
        listJurnalBaris(db, 'j-awal').map((baris) => [
          baris.akun_kode,
          baris.debit,
          baris.kredit,
        ]),
      ).toEqual([
        ['1001', RP(1_000_000), 0],
        ['3000', 0, RP(1_000_000)],
      ]);
      expect(getJurnal(db, 'j-awal-2')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('jurnal biasa tidak mengunci status; SALDO_AWAL mengunci status', () => {
    const db = openDb(':memory:');
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-harian',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Pendapatan parkir',
          jenis: 'TERIMA',
        },
        pasangan('1001', '4005', RP(100_000)),
      );

      expect(sudahAdaSaldoAwal(db)).toBe(false);
      expect(statusSaldoAwal(db)).toEqual({
        boleh: true,
        jumlahJurnal: 1,
        tanggalMaksimal: '2026-01-02',
      });

      insertJurnalTervalidasi(
        db,
        {
          id: 'j-awal',
          tanggal: '2026-01-01',
          no_bukti: 'SA-2026-0001',
          keterangan: 'Saldo awal',
          jenis: 'SALDO_AWAL',
        },
        pasangan(),
      );

      expect(sudahAdaSaldoAwal(db)).toBe(true);
      expect(statusSaldoAwal(db)).toEqual({
        boleh: false,
        jumlahJurnal: 2,
        tanggalMaksimal: '2026-01-01',
        alasan: PESAN_SALDO_AWAL_SUDAH_ADA,
      });
    } finally {
      db.close();
    }
  });
});

describe('DB-04 — skema v1 baru', () => {
  it('DB v1 baru langsung memiliki unique index parsial ux_jurnal_saldo_awal', () => {
    expect(SCHEMA_VERSION).toBe(1);

    const path = join(tmpDir('pura-db04-index-'), 'pura.db');
    const db = openDb(path);
    try {
      expect(versi(db)).toBe(1);
      const index = indeksSaldoAwal(db);
      expect(index?.name).toBe('ux_jurnal_saldo_awal');
      expect(index?.sql).toMatch(/UNIQUE INDEX/);
      expect(index?.sql).toMatch(/WHERE jenis = 'SALDO_AWAL'/);
    } finally {
      db.close();
    }
  });

  it('membuka ulang file DB v1 tidak menambah data dan index tetap tepat satu', () => {
    const path = join(tmpDir('pura-db04-buka-ulang-'), 'pura.db');

    const db = openDb(path);
    let jumlahAwal: number;
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-awal',
          tanggal: '2026-01-01',
          no_bukti: 'SA-2026-0001',
          keterangan: 'Saldo awal',
          jenis: 'SALDO_AWAL',
        },
        pasangan(),
      );
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-harian',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Pendapatan parkir',
          jenis: 'TERIMA',
        },
        pasangan('1001', '4005', RP(100_000)),
      );
      jumlahAwal = jumlahJurnal(db);
      expect(jumlahAwal).toBe(2);
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(SCHEMA_VERSION);
      expect(
        db2
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'ux_jurnal_saldo_awal'",
          )
          .get(),
      ).toEqual({ n: 1 });
      expect(jumlahJurnal(db2)).toBe(jumlahAwal);
      expect(jumlahSaldoAwal(db2)).toBe(1);
      expect(sudahAdaSaldoAwal(db2)).toBe(true);
      expect(statusSaldoAwal(db2).boleh).toBe(false);
    } finally {
      db2.close();
    }
  });
});
