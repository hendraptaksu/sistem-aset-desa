// T4.8 — baseline skema v1 baru.
//
// Test ini mengunci kontrak skema aktif setelah migrasi dihapus:
// - DB baru (memory & file) langsung `user_version = 1`, tepat 11 tabel aktif
//   STRICT, tanpa tabel legacy;
// - seluruh index dan trigger wajib ada tepat satu;
// - membuka ulang file DB idempoten (tidak menambah objek, data sentinel tetap)
//   dan seed COA tidak menggandakan akun;
// - trigger yang dihapus lewat koneksi mentah dipulihkan oleh `openDb` berikut.
//
// Test sengaja ketat: satu tabel/index/trigger yang hilang harus menggagalkan
// suite. Sumber kebenaran strictness adalah `pragma table_list`.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COA } from '../src/db/coa.js';
import { SCHEMA_VERSION, TABEL_AKTIF, openDb } from '../src/db/database.js';

/** Tabel modul lama yang tidak boleh muncul kembali pada skema v1. */
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

/** Index eksplisit yang wajib ada, termasuk seluruh index pinjaman. */
const INDEX_WAJIB = [
  'idx_jurnal_tanggal',
  'idx_jurnal_grup',
  'idx_jurnal_reversal',
  'idx_jurnal_no_bukti_tahun',
  'ux_jurnal_saldo_awal',
  'ux_jurnal_reversal',
  'ux_akun_nama_nocase',
  'idx_jurnal_baris_jurnal',
  'idx_jurnal_baris_akun',
  'idx_audit_tanggal',
  'idx_audit_aksi',
  'idx_audit_ref',
  'idx_panjar_status',
  'idx_panjar_tanggal',
  'idx_panjar_item_panjar',
  'ux_panjar_jurnal_open',
  'ux_panjar_jurnal_close',
  'ux_panjar_jurnal_batal',
  // Seluruh index pinjaman.
  'idx_pinjaman_tanggal',
  'idx_pinjaman_kreditur',
  'idx_pinjaman_angsuran_pinjaman',
  'idx_pinjaman_angsuran_jatuh_tempo',
  'idx_pinjaman_bayar_pinjaman',
  'idx_pinjaman_bayar_tanggal',
  'idx_pinjaman_bayar_angsuran',
] as const;

/** 12 trigger aplikasi yang wajib ada tepat satu. */
const TRIGGER_WAJIB = [
  'trg_akun_validasi_insert',
  'trg_akun_validasi_update',
  'trg_audit_log_immutable_update',
  'trg_audit_log_immutable_delete',
  'trg_jurnal_baris_immutable_update',
  'trg_jurnal_baris_immutable_delete',
  'trg_jurnal_baris_satu_sisi_insert',
  'trg_jurnal_baris_satu_sisi_update',
  'trg_jurnal_immutable_update',
  'trg_jurnal_immutable_delete',
  'trg_jurnal_validasi_insert',
  'trg_tutup_buku_immutable_delete',
] as const;

const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-skema-baseline-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function versi(db: Database.Database): number {
  return Number(db.pragma('user_version', { simple: true }));
}

/** Tabel user di `main`, tanpa tabel internal `sqlite_*`. */
function namaTabel(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

/** Index eksplisit buatan aplikasi (auto-index `sqlite_*` diabaikan). */
function namaIndex(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function namaTrigger(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all() as { name: string }[]
  ).map((row) => row.name);
}

function sqlTrigger(db: Database.Database, nama: string): string {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = ?")
    .get(nama) as { sql: string } | undefined;
  return row?.sql ?? '';
}

function inventaris(db: Database.Database): {
  tabel: string[];
  index: string[];
  trigger: string[];
} {
  return {
    tabel: namaTabel(db),
    index: namaIndex(db),
    trigger: namaTrigger(db),
  };
}

/** Pastikan setiap index wajib muncul tepat satu kali di `sqlite_master`. */
function pastikanIndexWajib(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT name, COUNT(*) AS jumlah FROM sqlite_master
       WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
       GROUP BY name`,
    )
    .all() as { name: string; jumlah: number }[];
  const jumlah = new Map(rows.map((row) => [row.name, Number(row.jumlah)]));

  for (const nama of INDEX_WAJIB) {
    expect(jumlah.get(nama), `index ${nama} wajib ada tepat satu`).toBe(1);
  }
  expect(rows.every((row) => Number(row.jumlah) === 1)).toBe(true);
}

/** Pastikan tepat 12 trigger wajib ada, masing-masing satu. */
function pastikanTriggerWajib(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT name, COUNT(*) AS jumlah FROM sqlite_master
       WHERE type = 'trigger'
       GROUP BY name`,
    )
    .all() as { name: string; jumlah: number }[];

  expect(rows.map((row) => row.name).sort()).toEqual([...TRIGGER_WAJIB].sort());
  expect(rows.every((row) => Number(row.jumlah) === 1)).toBe(true);
  expect(namaTrigger(db)).toHaveLength(TRIGGER_WAJIB.length);

  return rows.map((row) => row.name).sort();
}

describe('skema baseline v1 — DB baru', () => {
  it('user_version DB baru adalah 1 (SCHEMA_VERSION)', () => {
    const db = openDb(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(1);
      expect(versi(db)).toBe(1);
      expect(versi(db)).toBe(SCHEMA_VERSION);
    } finally {
      db.close();
    }
  });

  it('tepat 11 tabel aktif sama dengan TABEL_AKTIF tanpa tabel sqlite_%', () => {
    const db = openDb(':memory:');
    try {
      expect(TABEL_AKTIF).toHaveLength(11);
      expect(namaTabel(db)).toEqual([...TABEL_AKTIF].sort());
      expect(namaTabel(db)).toHaveLength(11);
    } finally {
      db.close();
    }
  });

  it('semua tabel aktif STRICT menurut pragma table_list', () => {
    const db = openDb(':memory:');
    try {
      const info = db.pragma('table_list') as {
        schema: string;
        name: string;
        type: string;
        strict: number;
      }[];

      for (const tabel of TABEL_AKTIF) {
        const baris = info.find(
          (row) => row.schema === 'main' && row.name === tabel && row.type === 'table',
        );
        expect(baris, `tabel ${tabel} harus ada`).toBeDefined();
        expect(Number(baris?.strict), `${tabel} harus STRICT`).toBe(1);
      }

      const nonStrict = info
        .filter(
          (row) =>
            row.schema === 'main' &&
            row.type === 'table' &&
            !row.name.startsWith('sqlite_'),
        )
        .filter((row) => Number(row.strict) !== 1)
        .map((row) => row.name);
      expect(nonStrict).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('setiap index wajib ada tepat satu, termasuk seluruh index pinjaman', () => {
    const db = openDb(':memory:');
    try {
      pastikanIndexWajib(db);

      // Seluruh index pinjaman yang didefinisikan skema ikut terkunci di sini.
      const indexPinjaman = namaIndex(db).filter((nama) => nama.startsWith('idx_pinjaman_'));
      expect(indexPinjaman).toEqual(
        expect.arrayContaining([
          'idx_pinjaman_tanggal',
          'idx_pinjaman_kreditur',
          'idx_pinjaman_angsuran_pinjaman',
          'idx_pinjaman_angsuran_jatuh_tempo',
          'idx_pinjaman_bayar_pinjaman',
          'idx_pinjaman_bayar_tanggal',
          'idx_pinjaman_bayar_angsuran',
        ]),
      );
    } finally {
      db.close();
    }
  });

  it('tepat 12 trigger aplikasi ada, masing-masing satu', () => {
    const db = openDb(':memory:');
    try {
      const daftar = pastikanTriggerWajib(db);
      expect(daftar).toEqual([...TRIGGER_WAJIB].sort());
    } finally {
      db.close();
    }
  });

  it('tidak membuat tabel legacy apa pun', () => {
    const db = openDb(':memory:');
    try {
      const tabel = namaTabel(db);
      for (const legacy of TABEL_LEGACY) {
        expect(tabel, `tabel legacy ${legacy} tidak boleh ada`).not.toContain(legacy);
      }
    } finally {
      db.close();
    }
  });
});

describe('skema baseline v1 — file DB', () => {
  it('buka ulang idempoten: versi, jumlah tabel/index/trigger, dan sentinel tetap', () => {
    const path = join(dirBaru(), 'pura.db');

    const awal = (() => {
      const db = openDb(path);
      try {
        expect(versi(db)).toBe(SCHEMA_VERSION);
        const inv = inventaris(db);
        db.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('sentinel', 'tetap')").run();
        return inv;
      } finally {
        db.close();
      }
    })();

    expect(awal.tabel).toHaveLength(TABEL_AKTIF.length);
    expect(awal.index.length).toBeGreaterThanOrEqual(INDEX_WAJIB.length);
    expect(awal.trigger).toHaveLength(TRIGGER_WAJIB.length);

    // Buka ulang beberapa kali: tidak ada tabel/index/trigger yang bertambah.
    for (let kali = 0; kali < 3; kali++) {
      const db = openDb(path);
      try {
        expect(versi(db)).toBe(SCHEMA_VERSION);
        expect(inventaris(db)).toEqual(awal);
        expect(
          db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'sentinel'").get(),
        ).toEqual({ nilai: 'tetap' });
        pastikanIndexWajib(db);
        pastikanTriggerWajib(db);
      } finally {
        db.close();
      }
    }
  });

  it('seed COA idempoten: jumlah akun tetap COA.length dan setiap kode unik', () => {
    const path = join(dirBaru(), 'pura.db');
    const kodeCoa = COA.map((akun) => akun.kode).sort();

    // Sanity: daftar sumber sendiri tidak boleh memuat kode ganda.
    expect(new Set(kodeCoa).size).toBe(COA.length);

    for (let kali = 0; kali < 4; kali++) {
      const db = openDb(path);
      try {
        const rows = db
          .prepare('SELECT kode FROM akun ORDER BY kode')
          .all() as { kode: string }[];
        const kode = rows.map((row) => row.kode);

        expect(kode, `buka ke-${kali + 1}`).toHaveLength(COA.length);
        expect(new Set(kode).size, `kode akun harus unik pada buka ke-${kali + 1}`).toBe(
          COA.length,
        );
        expect(kode).toEqual(kodeCoa);
      } finally {
        db.close();
      }
    }
  });

  it('trigger yang hilang dipulihkan tepat satu oleh openDb berikutnya', () => {
    const path = join(dirBaru(), 'pura.db');
    const triggerHilang = 'trg_jurnal_validasi_insert';

    const sebelum = (() => {
      const db = openDb(path);
      try {
        const daftar = pastikanTriggerWajib(db);
        const sql = sqlTrigger(db, triggerHilang);
        expect(sql).toContain(`CREATE TRIGGER ${triggerHilang}`);
        return { daftar, sql };
      } finally {
        db.close();
      }
    })();

    // Hapus satu trigger lewat koneksi mentah, tanpa lewat openDb.
    const mentah = new Database(path);
    try {
      mentah.exec(`DROP TRIGGER ${triggerHilang}`);
      expect(namaTrigger(mentah)).toHaveLength(TRIGGER_WAJIB.length - 1);
      expect(namaTrigger(mentah)).not.toContain(triggerHilang);
    } finally {
      mentah.close();
    }

    // openDb berikutnya menjalankan ulang DDL trigger dan memulihkannya.
    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      expect(pastikanTriggerWajib(db)).toEqual(sebelum.daftar);
      expect(namaTrigger(db)).toHaveLength(TRIGGER_WAJIB.length);

      const jumlah = db
        .prepare(
          "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name = ?",
        )
        .get(triggerHilang) as { n: number };
      expect(Number(jumlah.n), `${triggerHilang} pulih tepat satu`).toBe(1);
      expect(sqlTrigger(db, triggerHilang)).toBe(sebelum.sql);
    } finally {
      db.close();
    }
  });
});
