// P0-3: reset DB POC + seed dev v2 (tanpa migrasi single-entry).
// Fokus: skema v2 bersih, seed jurnal deterministik & seimbang, tidak menimpa data.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import {
  getJurnalDetail,
  insertJurnalTervalidasi,
  listJurnal,
  listJurnalBaris,
} from '../src/db/repository.js';
import { SEED_DEV_JURNAL_COUNT, seedDev } from '../src/db/seed-dev.js';
import { saldoAkun } from '../src/core/reports.js';

const dirs: string[] = [];

function freshDb(): { dir: string; db: ReturnType<typeof openDb> } {
  const dir = mkdtempSync(join(tmpdir(), 'pura-seed-'));
  dirs.push(dir);
  return { dir, db: openDb(join(dir, 'dev.db')) };
}

function namaTabel(db: ReturnType<typeof openDb>): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
}

function totalJurnalBaris(db: ReturnType<typeof openDb>): { debit: number; kredit: number } {
  return db
    .prepare(
      'SELECT COALESCE(SUM(debit), 0) AS debit, COALESCE(SUM(kredit), 0) AS kredit FROM jurnal_baris',
    )
    .get() as { debit: number; kredit: number };
}

function semuaBaris(db: ReturnType<typeof openDb>): unknown[] {
  return db
    .prepare(
      'SELECT jurnal_id, akun_kode, debit, kredit, keterangan FROM jurnal_baris ORDER BY id',
    )
    .all();
}

function jumlahPihak(db: ReturnType<typeof openDb>): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM pihak').get() as { c: number }).c;
}

function jumlahMapping(db: ReturnType<typeof openDb>): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM jurnal_pihak').get() as { c: number }).c;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P0-3 — skema v2 fresh tanpa tabel single-entry', () => {
  it('hanya membuat tabel model baru + pengaturan yang dipertahankan', () => {
    const { db } = freshDb();
    try {
      const tabel = namaTabel(db);
      for (const lama of ['transaksi', 'coa']) {
        expect(tabel, `tabel lama ${lama} seharusnya tidak ada`).not.toContain(lama);
      }
      expect(tabel).toEqual(
        expect.arrayContaining([
          'akun',
          'jurnal',
          'jurnal_baris',
          'tutup_buku',
          'audit_log',
          'pengaturan',
          // P1-4: metadata panjar v2 (bukan tabel single-entry lama).
          'panjar',
          'panjar_item',
          // DB-23b: tabel legacy tetap ada sampai migrasi DB-33.
          'pihak',
          'jurnal_pihak',
        ]),
      );
      // tutup_buku v2 tidak menyimpan laba sebagai sumber angka.
      const kolom = (db.pragma('table_info(tutup_buku)') as { name: string }[]).map((k) => k.name);
      expect(kolom).toEqual(expect.arrayContaining(['tahun', 'created_at', 'backup_path', 'catatan']));
      expect(kolom).not.toContain('laba');
    } finally {
      db.close();
    }
  });
});

describe('P0-3 — seed jurnal dev', () => {
  it('mengisi tepat 240 jurnal yang semuanya seimbang (Neraca Saldo nol)', () => {
    const { db } = freshDb();
    try {
      expect(seedDev(db)).toBe(SEED_DEV_JURNAL_COUNT);
      expect(SEED_DEV_JURNAL_COUNT).toBe(240);

      const jurnal = listJurnal(db);
      expect(jurnal).toHaveLength(240);
      for (const j of jurnal) {
        const detail = getJurnalDetail(db, j.id);
        expect(detail, `detail ${j.id}`).not.toBeNull();
        expect(detail!.baris.length).toBeGreaterThanOrEqual(2);
        expect(new Date(j.created_at).toISOString()).toBe(j.created_at);

        let debit = 0;
        let kredit = 0;
        for (const b of detail!.baris) {
          expect(b.debit >= 0).toBe(true);
          expect(b.kredit >= 0).toBe(true);
          expect(b.debit > 0 || b.kredit > 0).toBe(true);
          expect(b.debit === 0 || b.kredit === 0).toBe(true);
          debit += b.debit;
          kredit += b.kredit;
        }
        expect(debit, `jurnal ${j.id} tidak seimbang`).toBe(kredit);
        expect(debit).toBeGreaterThan(0);
      }

      const total = totalJurnalBaris(db);
      expect(total.debit).toBeGreaterThan(0);
      expect(total.debit).toBe(total.kredit); // Neraca Saldo: selisih 0
    } finally {
      db.close();
    }
  });

  it('memuat semua jenis transaksi & rentang beberapa bulan', () => {
    const { db } = freshDb();
    try {
      seedDev(db);
      const jurnal = listJurnal(db);
      const jenis = new Set(jurnal.map((j) => j.jenis));
      for (const wajib of [
        'SALDO_AWAL',
        'TERIMA',
        'BAYAR',
        'TRANSFER',
        'HUTANG',
        'PANJAR',
      ]) {
        expect(jenis, `jenis ${wajib} hilang`).toContain(wajib);
      }
      // DB-23a: seed dev tidak membuat dokumen PIUTANG baru.
      expect(jenis).not.toContain('PIUTANG');

      expect(jurnal[0]!.tanggal).toBe('2026-01-01');
      expect(jurnal[jurnal.length - 1]!.tanggal).toBe('2026-06-30');
      expect(new Set(jurnal.map((j) => j.tanggal.slice(0, 7))).size).toBeGreaterThanOrEqual(5);

      // Nomor bukti unik & berurutan JU-2026-0001 ...
      const noBukti = jurnal.map((j) => j.no_bukti);
      expect(new Set(noBukti).size).toBe(noBukti.length);
      expect(noBukti[0]).toBe('JU-2026-0001');
      expect(noBukti[noBukti.length - 1]).toBe('JU-2026-0240');
    } finally {
      db.close();
    }
  });

  it('panjar open + close berbagi grup, 1040 terisi, sisa kembali ke kas', () => {
    const { db } = freshDb();
    try {
      seedDev(db);
      const panjar = listJurnal(db, { jenis: 'PANJAR' });
      expect(panjar.length).toBeGreaterThanOrEqual(8);
      expect(panjar.length % 2).toBe(0);

      const grup = [...new Set(panjar.map((j) => j.grup_id))];
      expect(grup).toHaveLength(panjar.length / 2);

      for (const g of grup) {
        const rows = panjar.filter((j) => j.grup_id === g).sort((a, b) => a.id.localeCompare(b.id));
        expect(rows).toHaveLength(2);
        const buka = listJurnalBaris(db, rows[0]!.id);
        const tutup = listJurnalBaris(db, rows[1]!.id);
        expect(buka.some((b) => b.akun_kode === '1040' && b.debit > 0)).toBe(true);
        expect(tutup.some((b) => b.akun_kode === '1040' && b.kredit > 0)).toBe(true);
        expect(tutup.some((b) => b.akun_kode === '1001' && b.debit > 0)).toBe(true);
      }
    } finally {
      db.close();
    }
  });

  it('hutang 2050 punya sisi debit dan kredit; seed tidak membuat piutang 1050 baru', () => {
    const { db } = freshDb();
    try {
      seedDev(db);
      const rows = listJurnal(db, { jenis: 'HUTANG' }).flatMap((j) =>
        listJurnalBaris(db, j.id),
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((b) => b.akun_kode === '2050' && b.debit > 0)).toBe(true);
      expect(rows.some((b) => b.akun_kode === '2050' && b.kredit > 0)).toBe(true);
      expect(listJurnal(db, { jenis: 'PIUTANG' })).toEqual([]);
      expect(saldoAkun(listBarisJurnal(db), '1050')).toBe(0);
    } finally {
      db.close();
    }
  });

  it('idempoten dan tidak menimpa jurnal yang sudah ada', () => {
    const { db } = freshDb();
    try {
      expect(seedDev(db)).toBe(240);
      // DB-23b: seed tidak membuat master pihak / pemetaan baru.
      expect(jumlahPihak(db)).toBe(0);
      expect(jumlahMapping(db)).toBe(0);

      expect(seedDev(db)).toBe(0);
      expect(listJurnal(db)).toHaveLength(240);
      expect(jumlahPihak(db)).toBe(0);
      expect(jumlahMapping(db)).toBe(0);

      const lain = freshDb();
      try {
        insertJurnalTervalidasi(
          lain.db,
          { id: 'asli-1', tanggal: '2026-06-01', keterangan: 'Data asli' },
          [
            { akun_kode: '1001', debit: 100_000, kredit: 0 },
            { akun_kode: '4005', debit: 0, kredit: 100_000 },
          ],
        );
        expect(seedDev(lain.db)).toBe(0);
        expect(listJurnal(lain.db).map((j) => j.id)).toEqual(['asli-1']);
        expect(jumlahPihak(lain.db)).toBe(0);
        expect(jumlahMapping(lain.db)).toBe(0);
      } finally {
        lain.db.close();
      }
    } finally {
      db.close();
    }
  });

  it('deterministik: dua DB fresh berisi jurnal & baris identik', () => {
    const a = freshDb();
    const b = freshDb();
    try {
      seedDev(a.db);
      seedDev(b.db);
      expect(listJurnal(b.db)).toEqual(listJurnal(a.db));
      expect(semuaBaris(b.db)).toEqual(semuaBaris(a.db));
      expect(jumlahPihak(b.db)).toBe(jumlahPihak(a.db));
      expect(jumlahMapping(b.db)).toBe(jumlahMapping(a.db));
    } finally {
      a.db.close();
      b.db.close();
    }
  });
});

describe('DB-23b — seed dev hutang tanpa master pihak', () => {
  it('menulis kreditur di keterangan dan tidak membuat baris pihak/mapping', () => {
    const { db } = freshDb();
    try {
      seedDev(db);

      const hutang = listJurnal(db, { jenis: 'HUTANG' });
      expect(hutang.length).toBeGreaterThan(0);
      for (const j of hutang) {
        expect(j.keterangan).toMatch(/Koperasi Desa Sari|Toko Bangunan Jaya/);
      }

      expect(jumlahPihak(db)).toBe(0);
      expect(jumlahMapping(db)).toBe(0);
      expect(saldoAkun(listBarisJurnal(db), '1050')).toBe(0);
      expect(saldoAkun(listBarisJurnal(db), '2050')).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});
