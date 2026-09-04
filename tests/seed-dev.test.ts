// Seeder DEV bervolume (laporan multi-halaman). Lihat src/db/seed-dev.ts.

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { listTransaksi } from '../src/db/repository.js';
import { SEED_DEV_ROW_COUNT, seedDev } from '../src/db/seed-dev.js';
import { validateTransaksiInput } from '../src/main/validation.js';

function freshDb(): { dir: string; db: ReturnType<typeof openDb> } {
  const dir = mkdtempSync(join(tmpdir(), 'pura-seed-'));
  return { dir, db: openDb(join(dir, 'dev.db')) };
}

describe('dev seeder (PURA_SEED_DEV)', () => {
  it('mengisi 240 baris VALID ke DB kosong', () => {
    const { dir, db } = freshDb();
    try {
      expect(seedDev(db)).toBe(SEED_DEV_ROW_COUNT);
      expect(SEED_DEV_ROW_COUNT).toBe(240);
      const rows = listTransaksi(db);
      expect(rows).toHaveLength(240);
      for (const r of rows) expect(validateTransaksiInput(r)).toEqual([]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('idempoten: jalan kedua tidak menambah baris', () => {
    const { dir, db } = freshDb();
    try {
      expect(seedDev(db)).toBe(240);
      expect(seedDev(db)).toBe(0);
      expect(listTransaksi(db)).toHaveLength(240);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tidak menyentuh DB yang sudah berisi data asli', () => {
    const { dir, db } = freshDb();
    try {
      db.prepare(
        "INSERT INTO transaksi (id, tanggal, keterangan, akun_kas, kategori, masuk, keluar) VALUES ('asli-1', '2026-06-01', 'Data asli', '1001', '4005', 100000, 0)",
      ).run();
      expect(seedDev(db)).toBe(0);
      expect(listTransaksi(db)).toHaveLength(1);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('deterministik: dua DB fresh berisi baris identik', () => {
    const a = freshDb();
    const b = freshDb();
    try {
      seedDev(a.db);
      seedDev(b.db);
      expect(listTransaksi(b.db)).toEqual(listTransaksi(a.db));
    } finally {
      a.db.close();
      b.db.close();
      rmSync(a.dir, { recursive: true, force: true });
      rmSync(b.dir, { recursive: true, force: true });
    }
  });
});
