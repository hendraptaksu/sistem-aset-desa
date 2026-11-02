// AKT-20 — migrasi v9 → v10: pemisahan akun utang usaha 2060.
//
// Fokus:
// - DB v9 lama dibuka aplikasi saat ini: user_version v21, akun 2060 di-seed,
//   jurnal 2050 lama utuh, dan migrasi idempoten saat dibuka ulang.
// - Backup v9 tetap bisa direstore; DB hasil restore ikut menjadi v21.
// - Kandidat backup dari versi lebih baru ditolak (guard downgrade).

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AKUN_HUTANG_USAHA, COA } from '../src/db/coa.js';
import { DDL, SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { getAkun, listJurnal, listJurnalBaris } from '../src/db/repository.js';
import { backupPraUpgrade, restoreDbAman, validasiKandidatRestore } from '../src/features/export/export.js';

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

/**
 * Fixture v9 realistis: skema v2–v9 + COA lama TANPA 2060 + jurnal 2050.
 * Dibuat di folder sementara test; tidak menyentuh `data/` repo.
 */
function buatFixtureV9(path: string): void {
  const lama = new Database(path);
  try {
    lama.pragma('foreign_keys = OFF');
    lama.exec(DDL);

    const insAkun = lama.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
       VALUES (?, ?, ?, ?, 1)`,
    );
    for (const a of COA) {
      if (a.kode === AKUN_HUTANG_USAHA) continue; // v9 belum mengenal 2060
      insAkun.run(a.kode, a.nama, a.tipe, a.posisi_normal);
    }

    const insJurnal = lama.prepare(
      `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insBaris = lama.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, ?)`,
    );

    insJurnal.run(
      'j-v9-awal',
      '2026-01-01',
      'JU-2026-0001',
      'Saldo awal v9',
      'SALDO_AWAL',
      'j-v9-awal',
      null,
      '2026-01-01T00:00:00.000Z',
    );
    insBaris.run('j-v9-awal', '1001', 5_000_000_00, 0, '');
    insBaris.run('j-v9-awal', '3000', 0, 5_000_000_00, '');

    // Jurnal 2050 lama: pinjaman/legacy yang tidak boleh berubah arti.
    insJurnal.run(
      'j-v9-hutang',
      '2026-01-02',
      'JU-2026-0002',
      'Terima pinjaman lama',
      'HUTANG',
      'j-v9-hutang',
      null,
      '2026-01-02T00:00:00.000Z',
    );
    insBaris.run('j-v9-hutang', '1001', 1_000_000_00, 0, '');
    insBaris.run('j-v9-hutang', '2050', 0, 1_000_000_00, '');

    lama.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('uji-v9', 'tetap')").run();
    lama.pragma('user_version = 9');
  } finally {
    lama.close();
  }
}

describe('AKT-20 — migrasi kontrak COA v10 (2060)', () => {
  it('membuka DB v9 → versi saat ini, menambah 2060 idempoten, jurnal 2050 lama utuh', () => {
    const path = join(tmpDir('pura-v10-migrasi-'), 'pura.db');
    buatFixtureV9(path);

    const sebelum = new Database(path, { readonly: true });
    const baris2050Sebelum = sebelum
      .prepare("SELECT akun_kode, debit, kredit FROM jurnal_baris WHERE akun_kode = '2050' ORDER BY id")
      .all();
    sebelum.close();

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(22);
      expect(versi(db)).toBe(22);
      expect(getAkun(db, AKUN_HUTANG_USAHA)).toMatchObject({
        kode: '2060',
        nama: 'HUTANG USAHA',
        tipe: 'KEWAJIBAN',
        posisi_normal: 'KREDIT',
        aktif: true,
      });
      expect(listJurnal(db).map((j) => j.id)).toEqual(['j-v9-awal', 'j-v9-hutang']);
      expect(listJurnalBaris(db, 'j-v9-hutang')).toHaveLength(2);
      expect(
        db
          .prepare("SELECT akun_kode, debit, kredit FROM jurnal_baris WHERE akun_kode = '2050' ORDER BY id")
          .all(),
      ).toEqual(baris2050Sebelum);
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'uji-v9'").get()).toEqual({
        nilai: 'tetap',
      });
    } finally {
      db.close();
    }

    // Buka ulang: idempoten, akun 2060 tidak tergandakan.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(22);
      expect(
        db2.prepare("SELECT COUNT(*) AS n FROM akun WHERE kode = '2060'").get(),
      ).toEqual({ n: 1 });
      expect(listJurnal(db2).map((j) => j.id)).toEqual(['j-v9-awal', 'j-v9-hutang']);
    } finally {
      db2.close();
    }
  });

  it('backup v9 tetap valid direstore ke aplikasi saat ini dan mendapat akun 2060', () => {
    const dir = tmpDir('pura-v10-restore-');
    const backupPath = join(dir, 'backup-v9.db');
    buatFixtureV9(backupPath);

    expect(versi(new Database(backupPath, { readonly: true }))).toBe(9);
    expect(validasiKandidatRestore(backupPath)).toEqual({ valid: true });

    const aktifPath = join(dir, 'aktif.db');
    let aktif = openDb(aktifPath);
    try {
      const hasil = restoreDbAman(aktif, {
        dbPath: aktifPath,
        backupPath,
        dirBackup: join(dir, 'backups'),
        stamp: 'uji-v10',
      });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) throw new Error(hasil.error);
      aktif = hasil.db;

      expect(versi(aktif)).toBe(22);
      expect(getAkun(aktif, AKUN_HUTANG_USAHA)?.nama).toBe('HUTANG USAHA');
      expect(listJurnal(aktif).map((j) => j.id)).toEqual(['j-v9-awal', 'j-v9-hutang']);
      expect(
        aktif
          .prepare("SELECT SUM(kredit - debit) AS saldo FROM jurnal_baris WHERE akun_kode = '2050'")
          .get(),
      ).toEqual({ saldo: 1_000_000_00 });
    } finally {
      aktif.close();
    }
  });

  it(`backup dari skema lebih baru (v${SCHEMA_VERSION + 1}) ditolak sebelum restore`, () => {
    const dir = tmpDir('pura-v10-baru-');
    const path = join(dir, 'baru.db');
    buatFixtureV9(path);

    const db = new Database(path);
    try {
      db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    } finally {
      db.close();
    }

    const hasil = validasiKandidatRestore(path);
    expect(hasil.valid).toBe(false);
    if (!hasil.valid) expect(hasil.error).toMatch(/versi lebih baru/i);
  });

  it('backupPraUpgrade tetap berfungsi sebagai cadangan sebelum v9 dimigrasikan', () => {
    const dir = tmpDir('pura-v10-pra-');
    const path = join(dir, 'pura.db');
    buatFixtureV9(path);

    const backup = backupPraUpgrade(path, join(dir, 'backups'), 'v9');
    const lama = new Database(backup, { readonly: true });
    try {
      expect(versi(lama)).toBe(9);
      expect(
        lama.prepare("SELECT COUNT(*) AS n FROM akun WHERE kode = '2060'").get(),
      ).toEqual({ n: 0 });
    } finally {
      lama.close();
    }
  });
});
