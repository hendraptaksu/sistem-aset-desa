// DB-21 — migrasi v18 → v19: kolom pembatalan panjar + link jurnal batal unik.
//
// Fixture v18 dibuat dengan DDL dasar (yang belum punya kolom batal), lalu
// user_version diturunkan. Ini meniru DB sebelum DB-21. Tidak ada rebuild
// tabel: kolom hanya ditambah lewat ALTER TABLE dan baris lama tetap sah.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  PESAN_DUPLIKAT_JURNAL_BATAL_PANJAR,
  SCHEMA_VERSION,
  openDb,
} from '../src/db/database.js';
import {
  batalPanjarV2,
  getPanjar,
  serahkanPanjar,
} from '../src/db/panjar.js';
import { postingJurnal } from '../src/db/posting.js';
import { AKUN_MODAL } from '../src/db/coa.js';

const WAKTU = '2026-10-31T00:00:00.000Z';
const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-v19-'));
  dirs.push(dir);
  return dir;
}

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function daftarIndex(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
      .all() as { name: string }[]
  ).map((r) => r.name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** DB v18: DDL lama + saldo awal + satu panjar OPEN. */
function buatFixtureV18(path: string): void {
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.exec(DDL);
    const insAkun = db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
       VALUES (?, ?, ?, ?, 1)`,
    );
    insAkun.run('1001', 'KAS', 'ASET', 'DEBIT');
    insAkun.run('1040', 'UANG PANJAR', 'ASET', 'DEBIT');
    insAkun.run('3000', 'MODAL', 'EKUITAS', 'KREDIT');
    insAkun.run('5004', 'BEBAN KONSUMSI', 'BEBAN', 'DEBIT');

    const insJurnal = db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    );
    insJurnal.run('j-awal', '2026-01-01', 'SA-1', 'Saldo awal', 'SALDO_AWAL', 'j-awal', WAKTU);
    insJurnal.run('j-open', '2026-02-01', 'PNJ-1', 'Serah panjar', 'PANJAR', 'j-open', WAKTU);
    const insBaris = db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, '')`,
    );
    insBaris.run('j-awal', '1001', 10_000_000, 0);
    insBaris.run('j-awal', '3000', 0, 10_000_000);
    insBaris.run('j-open', '1040', 1_000_000, 0);
    insBaris.run('j-open', '1001', 0, 1_000_000);

    db.prepare(
      `INSERT INTO panjar
         (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
          tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
       VALUES ('p-lama', '2026-02-01', 'Panitia Lama', 1000000, '1001', 'OPEN',
               NULL, 'j-open', NULL, ?)`,
    ).run(WAKTU);
    db.pragma('user_version = 18');
  } finally {
    db.close();
  }
}

describe('DB-21 — migrasi v19 pembatalan panjar', () => {
  it("menambah kolom batal dengan default NULL/'' dan index unik, tanpa rebuild", () => {
    const path = join(dirBaru(), 'pura.db');
    buatFixtureV18(path);

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(23);
      expect(versi(db)).toBe(23);
      const kolom = (db.pragma('table_info(panjar)') as { name: string }[]).map(
        (k) => k.name,
      );
      expect(kolom).toEqual(
        expect.arrayContaining(['jurnal_batal_id', 'tanggal_batal', 'alasan_batal']),
      );
      expect(daftarIndex(db)).toContain('ux_panjar_jurnal_batal');
      const sqlIndex = (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE name = 'ux_panjar_jurnal_batal'")
          .get() as { sql: string }
      ).sql;
      expect(sqlIndex).toMatch(/WHERE jurnal_batal_id IS NOT NULL/i);

      // Baris lama tetap ada dan mendapat default yang aman.
      expect(
        db
          .prepare(
            `SELECT id, status, jurnal_batal_id, tanggal_batal, alasan_batal
               FROM panjar`,
          )
          .all(),
      ).toEqual([
        {
          id: 'p-lama',
          status: 'OPEN',
          jurnal_batal_id: null,
          tanggal_batal: null,
          alasan_batal: '',
        },
      ]);
      expect(getPanjar(db, 'p-lama')).toMatchObject({
        status: 'OPEN',
        jurnal_batal_id: null,
        tanggal_batal: null,
        alasan_batal: '',
      });

      // Kolom baru benar-benar bisa dipakai membatalkan panjar lama.
      const batal = batalPanjarV2(db, {
        id: 'p-lama',
        alasan: 'Salah serah ke panitia',
        jurnalId: 'j-batal-lama',
        tanggalBatal: '2026-02-02',
      });
      expect(batal.tersimpan, batal.errors.join(' ')).toBe(true);
      expect(getPanjar(db, 'p-lama')).toMatchObject({
        status: 'DIBATALKAN',
        jurnal_batal_id: 'j-batal-lama',
        tanggal_batal: '2026-02-02',
        alasan_batal: 'Salah serah ke panitia',
      });
    } finally {
      db.close();
    }

    // Migrasi idempoten: buka ulang tidak menambah kolom ganda / menghapus data.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(23);
      expect(getPanjar(db2, 'p-lama')?.status).toBe('DIBATALKAN');
      expect(
        (db2.prepare('SELECT COUNT(*) AS n FROM panjar').get() as { n: number }).n,
      ).toBe(1);
    } finally {
      db2.close();
    }
  });

  it('membatalkan migrasi bila jurnal_batal_id duplikat tanpa mengubah data', () => {
    const path = join(dirBaru(), 'pura.db');
    const siap = openDb(path);
    try {
      const awal = postingJurnal(siap, {
        header: {
          id: 'j-awal',
          tanggal: '2026-01-01',
          no_bukti: 'SA-1',
          keterangan: 'Saldo awal',
          jenis: 'SALDO_AWAL',
        },
        baris: [
          { akun_kode: '1001', debit: 10_000_000, kredit: 0 },
          { akun_kode: AKUN_MODAL, debit: 0, kredit: 10_000_000 },
        ],
      });
      expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
      for (const id of ['p-a', 'p-b']) {
        const buat = serahkanPanjar(siap, {
          id,
          jurnalId: `j-${id}`,
          tanggal: '2026-02-01',
          penerima: `Penerima ${id}`,
          jumlah: 100_000,
          akunKasSumber: '1001',
        });
        expect(buat.tersimpan, buat.errors.join(' ')).toBe(true);
      }
      const batalA = batalPanjarV2(siap, {
        id: 'p-a',
        alasan: 'Salah serah A',
        jurnalId: 'j-batal-a',
        tanggalBatal: '2026-02-02',
      });
      expect(batalA.tersimpan, batalA.errors.join(' ')).toBe(true);

      // Rusak tautan: dua panjar memakai jurnal batal yang sama, lalu index
      // dilepas agar fixture bisa dibuat. Migrasi v19 harus menolak.
      siap.exec('DROP INDEX IF EXISTS ux_panjar_jurnal_batal');
      siap
        .prepare("UPDATE panjar SET jurnal_batal_id = 'j-batal-a' WHERE id = 'p-b'")
        .run();
      siap.pragma('user_version = 18');
    } finally {
      siap.close();
    }

    expect(() => openDb(path)).toThrow(PESAN_DUPLIKAT_JURNAL_BATAL_PANJAR);

    const db = new Database(path, { readonly: true });
    try {
      expect(versi(db)).toBe(18);
      expect(
        (db
          .prepare(
            "SELECT COUNT(*) AS n FROM panjar WHERE jurnal_batal_id = 'j-batal-a'",
          )
          .get() as { n: number }).n,
      ).toBe(2);
      expect(daftarIndex(db)).not.toContain('ux_panjar_jurnal_batal');
    } finally {
      db.close();
    }
  });

  it('menolak dua panjar memakai jurnal batal sama lewat SQL langsung', () => {
    const db = openDb(':memory:');
    try {
      expect(
        postingJurnal(db, {
          header: {
            id: 'j-awal',
            tanggal: '2026-01-01',
            no_bukti: 'SA-1',
            keterangan: 'Saldo awal',
            jenis: 'SALDO_AWAL',
          },
          baris: [
            { akun_kode: '1001', debit: 10_000_000, kredit: 0 },
            { akun_kode: AKUN_MODAL, debit: 0, kredit: 10_000_000 },
          ],
        }).tersimpan,
      ).toBe(true);
      for (const id of ['p-a', 'p-b']) {
        expect(
          serahkanPanjar(db, {
            id,
            jurnalId: `j-${id}`,
            tanggal: '2026-02-01',
            penerima: `Penerima ${id}`,
            jumlah: 100_000,
            akunKasSumber: '1001',
          }).tersimpan,
        ).toBe(true);
      }
      expect(
        batalPanjarV2(db, {
          id: 'p-a',
          alasan: 'Salah serah A',
          jurnalId: 'j-batal-a',
          tanggalBatal: '2026-02-02',
        }).tersimpan,
      ).toBe(true);

      expect(() =>
        db
          .prepare("UPDATE panjar SET jurnal_batal_id = 'j-batal-a' WHERE id = 'p-b'")
          .run(),
      ).toThrow(/UNIQUE constraint failed: panjar\.jurnal_batal_id/);
      expect(getPanjar(db, 'p-b')?.jurnal_batal_id).toBeNull();
    } finally {
      db.close();
    }
  });
});
