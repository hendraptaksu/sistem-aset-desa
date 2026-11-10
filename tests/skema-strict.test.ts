// Skema v2 — DB baru wajib langsung punya 12 tabel aktif yang semuanya STRICT.
//
// Tidak ada jalur migrasi/rebuild: setiap DB yang dibuat `openDb` harus sesuai
// kontrak skema aktif sejak awal, baik di `:memory:` maupun di file sementara.
// Sumber kebenaran strictness adalah `pragma table_list`, bukan tebakan dari SQL.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, TABEL_AKTIF, openDb } from '../src/db/database.js';

/** Tabel modul lama yang tidak boleh muncul pada skema aktif. */
const TABEL_LEGACY = [
  'transaksi',
  'coa',
  'pihak',
  'jurnal_pihak',
  'aset',
  'anggaran',
  'rekonsiliasi_bank',
  'lampiran_jurnal',
];

const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-skema-strict-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

function namaTabelUser(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function infoTabel(
  db: Database.Database,
): { schema: string; name: string; type: string; strict: number }[] {
  return db.pragma('table_list') as {
    schema: string;
    name: string;
    type: string;
    strict: number;
  }[];
}

/** Pastikan tepat 12 tabel aktif ada dan semuanya STRICT. */
function pastikanSemuaTabelAktifStrict(db: Database.Database): void {
  expect(namaTabelUser(db)).toEqual([...TABEL_AKTIF].sort());

  const info = infoTabel(db);
  for (const tabel of TABEL_AKTIF) {
    const baris = info.find(
      (r) => r.schema === 'main' && r.name === tabel && r.type === 'table',
    );
    expect(baris, `tabel ${tabel} harus ada`).toBeDefined();
    expect(Number(baris?.strict), `${tabel} harus STRICT`).toBe(1);
  }

  // Tidak boleh ada tabel user mana pun yang non-STRICT.
  const nonStrict = info
    .filter((r) => r.schema === 'main' && r.type === 'table' && !r.name.startsWith('sqlite_'))
    .filter((r) => Number(r.strict) !== 1)
    .map((r) => r.name);
  expect(nonStrict).toEqual([]);
}

describe('skema v2 — DB baru langsung STRICT', () => {
  it('DB :memory: punya 12 tabel aktif, semuanya STRICT, tanpa tabel legacy', () => {
    const db = openDb(':memory:');
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      pastikanSemuaTabelAktifStrict(db);

      const tabel = namaTabelUser(db);
      for (const legacy of TABEL_LEGACY) {
        expect(tabel).not.toContain(legacy);
      }
    } finally {
      db.close();
    }
  });

  it('DB file baru langsung 12 tabel STRICT dan tetap sama saat dibuka ulang', () => {
    const path = join(dirBaru(), 'pura.db');

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      pastikanSemuaTabelAktifStrict(db);

      db.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('sentinel', 'tetap')").run();
    } finally {
      db.close();
    }

    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(SCHEMA_VERSION);
      pastikanSemuaTabelAktifStrict(db2);
      expect(db2.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'sentinel'").get()).toEqual({
        nilai: 'tetap',
      });
    } finally {
      db2.close();
    }
  });
});
