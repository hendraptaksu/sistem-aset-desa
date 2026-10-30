// DB-04 — satu jurnal SALDO_AWAL + status wizard berbasis eksistensi.
//
// Fokus:
// - DB menolak SALDO_AWAL kedua (partial unique index), termasuk INSERT mentah.
// - DB v9/v12 dengan tepat satu SALDO_AWAL naik ke versi skema saat ini tanpa
//   kehilangan data.
// - DB v12 dengan duplikat SALDO_AWAL menghentikan migrasi, rollback utuh,
//   user_version tidak naik, dan tidak ada data/tabel yang hilang.
// - `sudahAdaSaldoAwal()` / `statusSaldoAwal()` tidak menganggap jurnal harian
//   biasa sebagai saldo awal.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  PESAN_DUPLIKAT_SALDO_AWAL,
  SCHEMA_VERSION,
  migrasi,
  openDb,
} from '../src/db/database.js';
import { insertJurnalTervalidasi } from '../src/db/repository.js';
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

function pasangan(debit = '1001', kredit = '3000', nominal = RP(1_000_000)): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

type OpsiFixture = {
  versi: number;
  jumlahSaldoAwal: number;
  jurnalBiasa?: number;
  /** Tabel legacy yang dibuang migrasi v12; dipakai untuk membuktikan rollback. */
  denganTabelLegacy?: boolean;
};

/**
 * Fixture DB lama memakai DDL produksi lalu menurunkan `user_version`.
 * Index `ux_jurnal_saldo_awal` sengaja belum ada karena baru dibuat migrasi v13.
 */
function buatFixture(path: string, opsi: OpsiFixture): void {
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = OFF');
    db.exec(DDL);

    const insAkun = db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
       VALUES (?, ?, ?, ?, 1)`,
    );
    insAkun.run('1001', 'KAS', 'ASET', 'DEBIT');
    insAkun.run('3000', 'MODAL', 'EKUITAS', 'KREDIT');
    insAkun.run('4005', 'PENDAPATAN PARKIR', 'PENDAPATAN', 'KREDIT');

    const insJurnal = db.prepare(
      `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    const insBaris = db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, '')`,
    );

    for (let i = 0; i < opsi.jumlahSaldoAwal; i += 1) {
      const id = `j-awal-${i + 1}`;
      insJurnal.run(
        id,
        `2026-01-0${i + 1}`,
        `SA-2026-000${i + 1}`,
        `Saldo awal ${i + 1}`,
        'SALDO_AWAL',
        id,
        WAKTU,
      );
      insBaris.run(id, '1001', RP(1_000_000), 0);
      insBaris.run(id, '3000', 0, RP(1_000_000));
    }

    for (let i = 0; i < (opsi.jurnalBiasa ?? 0); i += 1) {
      const id = `j-biasa-${i + 1}`;
      insJurnal.run(
        id,
        `2026-02-0${i + 1}`,
        `JU-2026-100${i + 1}`,
        `Jurnal biasa ${i + 1}`,
        'UMUM',
        id,
        WAKTU,
      );
      insBaris.run(id, '1001', RP(100_000), 0);
      insBaris.run(id, '4005', 0, RP(100_000));
    }

    if (opsi.denganTabelLegacy) {
      db.exec(`
        CREATE TABLE lampiran_jurnal (
          id TEXT PRIMARY KEY,
          jurnal_id TEXT NOT NULL,
          nama_asli TEXT NOT NULL
        );
      `);
      db.prepare(
        'INSERT INTO lampiran_jurnal (id, jurnal_id, nama_asli) VALUES (?, ?, ?)',
      ).run('lamp-lama', 'j-awal-1', 'bukti.pdf');
    }

    db.pragma(`user_version = ${opsi.versi}`);
  } finally {
    db.close();
  }
}

function indeksSaldoAwal(db: Database.Database): { name: string; sql: string } | undefined {
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

describe('DB-04 — unique index saldo awal', () => {
  it('DB menolak INSERT SALDO_AWAL kedua; jurnal pertama tetap utuh', () => {
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

      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, created_at)
             VALUES (?, ?, ?, ?, 'SALDO_AWAL', ?, ?)`,
          )
          .run('j-awal-2', '2026-01-02', 'SA-2026-0002', 'Saldo awal kedua', 'j-awal-2', WAKTU),
      ).toThrow(/UNIQUE|ux_jurnal_saldo_awal/);

      expect(jumlahJurnal(db)).toBe(1);
      const index = indeksSaldoAwal(db);
      expect(index?.name).toBe('ux_jurnal_saldo_awal');
      expect(index?.sql).toMatch(/UNIQUE INDEX/);
      expect(index?.sql).toMatch(/WHERE jenis = 'SALDO_AWAL'/);
    } finally {
      db.close();
    }
  });

  it('jurnal biasa tidak membuat status terkunci; SALDO_AWAL yang ada mengunci status', () => {
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
      expect(statusSaldoAwal(db)).toEqual({ boleh: true, jumlahJurnal: 1 });

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
        alasan: PESAN_SALDO_AWAL_SUDAH_ADA,
      });
    } finally {
      db.close();
    }
  });
});

describe('DB-04 — migrasi v13', () => {
  it.each([9, 12] as const)(
    'DB v%s dengan tepat satu SALDO_AWAL naik ke versi skema saat ini tanpa kehilangan data',
    (versiLama) => {
      const path = join(tmpDir(`pura-db04-v${versiLama}-`), 'pura.db');
      buatFixture(path, { versi: versiLama, jumlahSaldoAwal: 1, jurnalBiasa: 1 });

      const db = openDb(path);
      try {
        expect(SCHEMA_VERSION).toBe(17);
        expect(versi(db)).toBe(17);
        expect(indeksSaldoAwal(db)?.name).toBe('ux_jurnal_saldo_awal');
        expect(jumlahJurnal(db)).toBe(2);
        expect(
          db
            .prepare("SELECT COUNT(*) AS n FROM jurnal WHERE jenis = 'SALDO_AWAL'")
            .get(),
        ).toEqual({ n: 1 });
        expect(sudahAdaSaldoAwal(db)).toBe(true);
        expect(statusSaldoAwal(db).boleh).toBe(false);
      } finally {
        db.close();
      }

      // Buka ulang: idempoten, index tidak dobel, saldo awal tidak bertambah.
      const db2 = openDb(path);
      try {
        expect(versi(db2)).toBe(17);
        expect(
          db2
            .prepare(
              "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'ux_jurnal_saldo_awal'",
            )
            .get(),
        ).toEqual({ n: 1 });
        expect(jumlahJurnal(db2)).toBe(2);
      } finally {
        db2.close();
      }
    },
  );

  it('DB baru langsung memiliki unique index saldo awal', () => {
    const path = join(tmpDir('pura-db04-baru-'), 'pura.db');
    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(indeksSaldoAwal(db)?.sql).toMatch(/WHERE jenis = 'SALDO_AWAL'/);
    } finally {
      db.close();
    }
  });

  it('duplikat SALDO_AWAL di DB v12 membatalkan migrasi dengan rollback utuh', () => {
    const path = join(tmpDir('pura-db04-duplikat-'), 'pura.db');
    buatFixture(path, {
      versi: 12,
      jumlahSaldoAwal: 2,
      jurnalBiasa: 1,
      denganTabelLegacy: true,
    });

    const db = new Database(path);
    try {
      expect(() => migrasi(db)).toThrow(PESAN_DUPLIKAT_SALDO_AWAL);
      expect(() => migrasi(db)).toThrow(/Migrasi v13 dibatalkan/);
      expect(() => migrasi(db)).toThrow(/SALDO_AWAL/);

      // Tidak ada perubahan yang tertinggal: versi, data, dan tabel legacy utuh.
      expect(versi(db)).toBe(12);
      expect(indeksSaldoAwal(db)).toBeUndefined();
      expect(jumlahJurnal(db)).toBe(3);
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM jurnal WHERE jenis = 'SALDO_AWAL'")
          .get(),
      ).toEqual({ n: 2 });
      expect(
        db
          .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'lampiran_jurnal'")
          .get(),
      ).toEqual({ n: 1 });
      expect(db.prepare('SELECT id FROM lampiran_jurnal').all()).toEqual([
        { id: 'lamp-lama' },
      ]);
    } finally {
      db.close();
    }

    // Jalur produksi `openDb` juga menolak dan menutup koneksi tanpa mengubah file.
    expect(() => openDb(path)).toThrow(PESAN_DUPLIKAT_SALDO_AWAL);

    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(12);
      expect(jumlahJurnal(cek)).toBe(3);
      expect(indeksSaldoAwal(cek)).toBeUndefined();
      expect(
        cek
          .prepare(
            "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'lampiran_jurnal'",
          )
          .get(),
      ).toEqual({ n: 1 });
    } finally {
      cek.close();
    }
  });
});
