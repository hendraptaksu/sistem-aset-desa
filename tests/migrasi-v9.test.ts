// AUD-23 — migrasi v9: integritas jurnal + nomor bukti per tahun.
//
// Fokus:
// - DB menolak baris jurnal dengan debit & kredit sekaligus.
// - Jurnal/baris jurnal tidak bisa di-UPDATE/DELETE langsung (koreksi = reversal).
// - no_bukti unik PER TAHUN (case-insensitive), bukan global.
// - DB v8 lama (termasuk lewat restore) termigrasi ke versi skema saat ini
//   secara idempoten (sejak AKT-26: v11; DB-33: v12; aturan v9 tetap berlaku).
// - AKT-20 menguji DB v9 → v10 di tests/migrasi-v10.test.ts; AKT-26 menguji
//   trigger v11 di tests/migrasi-v11.test.ts.

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COA } from '../src/db/coa.js';
import { DDL, SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { getJurnal, listJurnal, listJurnalBaris, insertJurnalTervalidasi } from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { backupPraUpgrade, restoreDbAman } from '../src/features/export/export.js';
import type { JurnalBarisInput, JurnalHeaderInput } from '../src/core/types.js';

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

function pasangan(debit = '1001', kredit = '4005', nominal = 100_000): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

function header(over: Partial<JurnalHeaderInput> = {}): JurnalHeaderInput {
  return {
    id: 'j-v9',
    tanggal: '2026-01-02',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Uji v9',
    ...over,
  };
}

const TRIGGER_V9 = [
  'trg_jurnal_baris_immutable_delete',
  'trg_jurnal_baris_immutable_update',
  'trg_jurnal_baris_satu_sisi_insert',
  'trg_jurnal_baris_satu_sisi_update',
  'trg_jurnal_immutable_delete',
  'trg_jurnal_immutable_update',
] as const;

function daftarTrigger(db: Database.Database): { name: string; sql: string }[] {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'trigger' AND name LIKE 'trg_jurnal%'
       ORDER BY name`,
    )
    .all() as { name: string; sql: string }[];
}

function indeksNoBukti(db: Database.Database): { name: string; sql: string }[] {
  return db
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'index' AND name LIKE 'idx_jurnal_no_bukti%'
       ORDER BY name`,
    )
    .all() as { name: string; sql: string }[];
}

/**
 * Fixture v8 realistis: skema dasar v2–v8 + index global lama + data jurnal.
 * Dibuat di folder sementara test; tidak menyentuh `data/` repo.
 */
function buatFixtureV8(path: string): void {
  const lama = new Database(path);
  try {
    lama.pragma('foreign_keys = OFF');
    lama.exec(DDL);
    // Index v8: no_bukti unik GLOBAL (belum per tahun).
    lama.exec(`
      CREATE UNIQUE INDEX idx_jurnal_no_bukti
        ON jurnal(no_bukti COLLATE NOCASE)
        WHERE no_bukti <> '';
    `);

    const insAkun = lama.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
       VALUES (?, ?, ?, ?, 1)`,
    );
    for (const a of COA) insAkun.run(a.kode, a.nama, a.tipe, a.posisi_normal);

    const insJurnal = lama.prepare(
      `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insBaris = lama.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, ?)`,
    );

    // Dua tahun berbeda, masing-masing punya nomor sendiri.
    insJurnal.run(
      'j-v8-2025',
      '2025-12-31',
      'JU-2025-0001',
      'Saldo awal 2025',
      'SALDO_AWAL',
      'j-v8-2025',
      null,
      '2025-12-31T00:00:00.000Z',
    );
    insBaris.run('j-v8-2025', '1001', 500_000_000, 0, '');
    insBaris.run('j-v8-2025', '3000', 0, 500_000_000, '');

    insJurnal.run(
      'j-v8-2026',
      '2026-01-02',
      'JU-2026-0001',
      'Modal 2026',
      'SALDO_AWAL',
      'j-v8-2026',
      null,
      '2026-01-02T00:00:00.000Z',
    );
    insBaris.run('j-v8-2026', '1001', 100_000_000, 0, '');
    insBaris.run('j-v8-2026', '3000', 0, 100_000_000, '');

    lama.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('uji-lama', 'tetap')").run();
    lama.pragma('user_version = 8');
  } finally {
    lama.close();
  }
}

describe('AUD-23 — skema v9 & trigger integritas', () => {
  it('membuat unique index per tahun + 6 trigger, tanpa index global lama; idempoten', () => {
    const path = join(tmpDir('pura-v9-skema-'), 'pura.db');

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(12);
      expect(versi(db)).toBe(12);

      const indeks = indeksNoBukti(db);
      expect(indeks.map((i) => i.name)).toEqual(['idx_jurnal_no_bukti_tahun']);
      expect(indeks[0]!.sql).toMatch(/UNIQUE INDEX/);
      expect(indeks[0]!.sql).toMatch(/substr\(tanggal,\s*1,\s*4\)/);
      expect(indeks[0]!.sql).toMatch(/COLLATE NOCASE/);
      expect(indeks[0]!.sql).toMatch(/WHERE no_bukti <> ''/);

      const trigger = daftarTrigger(db);
      expect(trigger.map((t) => t.name)).toEqual([...TRIGGER_V9]);
      const satuSisi = trigger.filter((t) => t.name.includes('satu_sisi'));
      expect(satuSisi).toHaveLength(2);
      for (const t of satuSisi)
        expect(t.sql).toMatch(/NEW\.debit > 0 AND NEW\.kredit > 0/);
    } finally {
      db.close();
    }

    // Buka ulang: tidak ada trigger/index dobel.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(12);
      expect(indeksNoBukti(db2).map((i) => i.name)).toEqual(['idx_jurnal_no_bukti_tahun']);
      expect(daftarTrigger(db2).map((t) => t.name)).toEqual([...TRIGGER_V9]);
    } finally {
      db2.close();
    }
  });

  it('menolak insert/update baris yang mengisi debit dan kredit sekaligus', () => {
    const path = join(tmpDir('pura-v9-dua-sisi-'), 'pura.db');
    const db = openDb(path);
    try {
      const jurnal = insertJurnalTervalidasi(db, header(), pasangan());
      const baris = listJurnalBaris(db, jurnal.id);

      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .run(jurnal.id, '1001', 1_000, 1_000, 'dua sisi'),
      ).toThrow(/debit dan kredit sekaligus/);

      // Update juga ditolak. Trigger immutable bisa lebih dulu bicara; yang
      // penting tidak ada perubahan yang lolos dan pesannya jelas.
      expect(() =>
        db
          .prepare('UPDATE jurnal_baris SET debit = ?, kredit = ? WHERE id = ?')
          .run(1_000, 1_000, baris[0]!.id),
      ).toThrow(/debit dan kredit sekaligus|tidak boleh diubah/);

      expect(listJurnalBaris(db, jurnal.id)).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('menolak update/delete jurnal dan baris jurnal; data tetap utuh', () => {
    const path = join(tmpDir('pura-v9-immutable-'), 'pura.db');
    const db = openDb(path);
    try {
      const jurnal = insertJurnalTervalidasi(db, header(), pasangan());
      const baris = listJurnalBaris(db, jurnal.id);

      expect(() =>
        db.prepare("UPDATE jurnal SET keterangan = 'Diubah' WHERE id = ?").run(jurnal.id),
      ).toThrow(/tidak boleh diubah/);
      expect(() => db.prepare('DELETE FROM jurnal WHERE id = ?').run(jurnal.id)).toThrow(
        /tidak boleh dihapus/,
      );
      expect(() =>
        db
          .prepare("UPDATE jurnal_baris SET keterangan = 'Diubah' WHERE id = ?")
          .run(baris[0]!.id),
      ).toThrow(/tidak boleh diubah/);
      expect(() =>
        db.prepare('DELETE FROM jurnal_baris WHERE jurnal_id = ?').run(jurnal.id),
      ).toThrow(/tidak boleh dihapus/);

      expect(getJurnal(db, jurnal.id)?.keterangan).toBe('Uji v9');
      expect(listJurnalBaris(db, jurnal.id)).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe('AUD-23 — nomor bukti unik per tahun', () => {
  it('mengizinkan JU-2026-0001 dan JU-2025-0001 bersama, menolak duplikat tahun sama', () => {
    const path = join(tmpDir('pura-v9-nomor-'), 'pura.db');
    const db = openDb(path);
    try {
      insertJurnalTervalidasi(db, header({ id: 'j-2026', no_bukti: 'JU-2026-0001' }), pasangan());

      // Tahun berbeda: nomor baku tahun masing-masing boleh bersama...
      expect(() =>
        insertJurnalTervalidasi(
          db,
          header({ id: 'j-2025', tanggal: '2025-06-01', no_bukti: 'JU-2025-0001' }),
          pasangan('1001', '4005', 50_000),
        ),
      ).not.toThrow();
      // ...dan nomor yang sama persis pun boleh bila tahun jurnalnya berbeda.
      expect(() =>
        insertJurnalTervalidasi(
          db,
          header({ id: 'j-2025-lain', tanggal: '2025-07-01', no_bukti: 'JU-2026-0001' }),
          pasangan('1001', '4005', 25_000),
        ),
      ).not.toThrow();

      // Tahun sama: duplikat (termasuk beda kapitalisasi) ditolak validasi...
      const duplikat = postingJurnal(db, {
        header: header({ id: 'j-dup-posting', tanggal: '2026-03-01', no_bukti: 'ju-2026-0001' }),
        baris: pasangan(),
      });
      expect(duplikat.tersimpan).toBe(false);
      expect(duplikat.errors.join(' ')).toMatch(/sudah dipakai/);

      // ...repository, ...
      expect(() =>
        insertJurnalTervalidasi(
          db,
          header({ id: 'j-dup-repo', tanggal: '2026-04-01', no_bukti: 'Ju-2026-0001' }),
          pasangan(),
        ),
      ).toThrow(/sudah dipakai/);

      // ...dan unique index (penjaga terakhir untuk INSERT mentah).
      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            'j-dup-mentah',
            '2026-05-01',
            'JU-2026-0001',
            'Duplikat mentah',
            'UMUM',
            'j-dup-mentah',
            '2026-05-01T00:00:00.000Z',
          ),
      ).toThrow(/UNIQUE/);

      expect(listJurnal(db).map((j) => j.id)).toEqual(['j-2025', 'j-2025-lain', 'j-2026']);
    } finally {
      db.close();
    }
  });

  it('posting layer mengizinkan nomor tahun lain tanpa peringatan duplikat', () => {
    const path = join(tmpDir('pura-v9-posting-'), 'pura.db');
    const db = openDb(path);
    try {
      expect(postingJurnal(db, { header: header({ id: 'j-2026' }), baris: pasangan() }).tersimpan).toBe(
        true,
      );

      const tahunLalu = postingJurnal(db, {
        header: header({ id: 'j-2025', tanggal: '2025-03-01', no_bukti: 'ju-2026-0001' }),
        baris: pasangan('1001', '4005', 50_000),
      });
      expect(tahunLalu.tersimpan).toBe(true);
      expect(tahunLalu.errors).toEqual([]);
      expect(tahunLalu.jurnal?.no_bukti).toBe('ju-2026-0001');
    } finally {
      db.close();
    }
  });
});

describe('AUD-23 — migrasi/restore DB v8 → v12', () => {
  it('openDb memigrasikan fixture v8, mempertahankan data, dan membuat backup pra-upgrade', () => {
    const dir = tmpDir('pura-v9-upgrade-');
    const path = join(dir, 'pura.db');
    buatFixtureV8(path);

    const backup = backupPraUpgrade(path, join(dir, 'backups'), 'uji');
    expect(backup).toBe(join(dir, 'backups', 'pre-upgrade-uji.db'));
    expect(existsSync(backup)).toBe(true);

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(12);
      expect(indeksNoBukti(db).map((i) => i.name)).toEqual(['idx_jurnal_no_bukti_tahun']);
      expect(daftarTrigger(db).map((t) => t.name)).toEqual([...TRIGGER_V9]);
      expect(listJurnal(db).map((j) => j.id)).toEqual(['j-v8-2025', 'j-v8-2026']);
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'uji-lama'").get()).toEqual({
        nilai: 'tetap',
      });

      // Setelah migrasi, nomor yang sama boleh dipakai di tahun lain...
      expect(() =>
        insertJurnalTervalidasi(
          db,
          header({ id: 'j-v9-2025', tanggal: '2025-07-01', no_bukti: 'JU-2026-0001' }),
          pasangan(),
        ),
      ).not.toThrow();
      // ... tetapi tetap ditolak dalam tahun yang sama.
      expect(() =>
        insertJurnalTervalidasi(
          db,
          header({ id: 'j-v9-dup', tanggal: '2026-07-01', no_bukti: 'ju-2026-0001' }),
          pasangan(),
        ),
      ).toThrow(/sudah dipakai/);
    } finally {
      db.close();
    }

    // Buka ulang: migrasi idempoten, trigger/index tidak dobel.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(12);
      expect(indeksNoBukti(db2).map((i) => i.name)).toEqual(['idx_jurnal_no_bukti_tahun']);
      expect(daftarTrigger(db2)).toHaveLength(TRIGGER_V9.length);
      expect(listJurnal(db2).map((j) => j.id)).toEqual(['j-v9-2025', 'j-v8-2025', 'j-v8-2026']);
    } finally {
      db2.close();
    }
  });

  it('restore backup v8 menaikkan skema ke versi saat ini tanpa kehilangan data', () => {
    const dir = tmpDir('pura-v9-restore-');
    const backupPath = join(dir, 'backup-v8.db');
    buatFixtureV8(backupPath);

    const aktifPath = join(dir, 'aktif.db');
    let aktif = openDb(aktifPath);
    try {
      insertJurnalTervalidasi(
        aktif,
        header({ id: 'j-aktif', tanggal: '2026-06-01', no_bukti: 'JU-2026-9001' }),
        pasangan(),
      );

      const hasil = restoreDbAman(aktif, {
        dbPath: aktifPath,
        backupPath,
        dirBackup: join(dir, 'backups'),
        stamp: 'uji',
      });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) throw new Error(hasil.error);
      aktif = hasil.db;

      expect(versi(aktif)).toBe(12);
      expect(indeksNoBukti(aktif).map((i) => i.name)).toEqual(['idx_jurnal_no_bukti_tahun']);
      expect(daftarTrigger(aktif).map((t) => t.name)).toEqual([...TRIGGER_V9]);
      expect(listJurnal(aktif).map((j) => j.id)).toEqual(['j-v8-2025', 'j-v8-2026']);

      // Cadangan pra-restore tetap berisi DB aktif sebelum restore.
      const pra = new Database(hasil.preRestorePath, { readonly: true });
      try {
        const ids = (pra.prepare('SELECT id FROM jurnal ORDER BY id').all() as { id: string }[]).map(
          (r) => r.id,
        );
        expect(ids).toEqual(['j-aktif']);
      } finally {
        pra.close();
      }
    } finally {
      aktif.close();
    }
  });
});
