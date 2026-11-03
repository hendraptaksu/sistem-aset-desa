// DB-33 — migrasi v12: drop tabel modul yang sudah dihapus + guard versi.
//
// Fokus:
// - DB v11 berisi data di semua tabel yang disetujui tetap terbuka, dibuatkan
//   backup pra-upgrade, tabel legacy dibuang, dan tabel akuntansi utuh.
// - DB baru langsung v21 tanpa tabel legacy.
// - DB versi lebih baru ditolak SEBELUM DDL dan tidak diubah.
// - Backup v11/v14 tetap bisa direstore; backup v14 diterima.
// - Migrasi idempoten dan backup dibuat untuk setiap kenaikan versi.
// - Tabel wajib restore mengikuti skema saat ini (termasuk panjar_item).

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DDL,
  SCHEMA_VERSION,
  TABEL_DIHAPUS_V12,
  migrasi,
  openDb,
} from '../src/db/database.js';
import { auditIntegritas } from '../src/db/integritas.js';
import {
  getPengaturan,
  insertJurnalTervalidasi,
  listAuditLog,
  listJurnal,
  listJurnalBaris,
  listTutupBuku,
} from '../src/db/repository.js';
import {
  TABEL_WAJIB_RESTORE,
  backupPraUpgrade,
  backupVacuumInto,
  restoreDbAman,
  validasiKandidatRestore,
} from '../src/features/export/export.js';

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

function daftarTabel(db: Database.Database): string[] {
  return (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
      name: string;
    }[]
  ).map((t) => t.name);
}

const TABEL_INTI = [
  'akun',
  'jurnal',
  'jurnal_baris',
  'tutup_buku',
  'audit_log',
  'pengaturan',
  'panjar',
  'panjar_item',
] as const;

/**
 * DDL tabel legacy persis seperti v11. Tabel-tabel ini sengaja tidak lagi ada
 * di `DDL` produksi; fixture harus membuatnya sendiri agar migrasi v12 diuji
 * dengan bentuk DB lama yang nyata.
 */
const DDL_LEGACY_V11 = `
CREATE TABLE pihak (
  id TEXT PRIMARY KEY,
  nama TEXT NOT NULL,
  catatan TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_pihak_nama_unik ON pihak(nama COLLATE NOCASE);

CREATE TABLE jurnal_pihak (
  jurnal_id TEXT NOT NULL,
  pihak_id TEXT NOT NULL,
  akun_kode TEXT NOT NULL,
  PRIMARY KEY (jurnal_id, akun_kode),
  FOREIGN KEY (jurnal_id) REFERENCES jurnal(id) ON DELETE CASCADE,
  FOREIGN KEY (pihak_id) REFERENCES pihak(id),
  FOREIGN KEY (akun_kode) REFERENCES akun(kode)
);
CREATE INDEX idx_jurnal_pihak_pihak ON jurnal_pihak(pihak_id);

CREATE TABLE aset (
  id TEXT PRIMARY KEY,
  kode TEXT NOT NULL UNIQUE,
  nama TEXT NOT NULL,
  jenis TEXT NOT NULL DEFAULT 'LAINNYA',
  luas_m2 REAL,
  lokasi TEXT NOT NULL DEFAULT '',
  status_hukum TEXT NOT NULL DEFAULT '',
  tahun_perolehan INTEGER,
  asal_usul TEXT NOT NULL DEFAULT '',
  kondisi TEXT NOT NULL DEFAULT 'BAIK',
  keterangan TEXT NOT NULL DEFAULT '',
  nilai_sen INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_aset_jenis ON aset(jenis);
CREATE INDEX idx_aset_kode ON aset(kode);

CREATE TABLE anggaran (
  tahun INTEGER NOT NULL,
  akun_kode TEXT NOT NULL,
  nominal INTEGER NOT NULL CHECK (nominal >= 0),
  created_at TEXT,
  updated_at TEXT,
  PRIMARY KEY (tahun, akun_kode),
  FOREIGN KEY (akun_kode) REFERENCES akun(kode)
);
CREATE INDEX idx_anggaran_akun ON anggaran(akun_kode);

CREATE TABLE rekonsiliasi_bank (
  id TEXT PRIMARY KEY,
  akun_kode TEXT NOT NULL,
  tanggal TEXT NOT NULL,
  saldo_bank INTEGER NOT NULL CHECK (saldo_bank >= 0),
  catatan TEXT NOT NULL DEFAULT '',
  selesai INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  selesai_at TEXT,
  FOREIGN KEY (akun_kode) REFERENCES akun(kode)
);
CREATE INDEX idx_rekonsiliasi_akun_tanggal ON rekonsiliasi_bank(akun_kode, tanggal);

CREATE TABLE lampiran_jurnal (
  id TEXT PRIMARY KEY,
  jurnal_id TEXT NOT NULL,
  nama_asli TEXT NOT NULL,
  nama_simpan TEXT NOT NULL UNIQUE,
  mime TEXT NOT NULL,
  ukuran INTEGER NOT NULL CHECK (ukuran >= 0),
  created_at TEXT NOT NULL,
  FOREIGN KEY (jurnal_id) REFERENCES jurnal(id) ON DELETE CASCADE
);
CREATE INDEX idx_lampiran_jurnal ON lampiran_jurnal(jurnal_id);
`;

const WAKTU = '2026-01-05T08:00:00.000Z';

/**
 * Fixture v11: skema v2–v11 + satu baris di setiap tabel yang akan dibuang,
 * plus jurnal/panjar/tutup/audit/pengaturan yang harus dipertahankan.
 */
function buatFixtureV11(path: string): void {
  const lama = new Database(path);
  try {
    lama.pragma('foreign_keys = OFF');
    lama.exec(DDL);
    lama.exec(DDL_LEGACY_V11);

    const insAkun = lama.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
       VALUES (?, ?, ?, ?, 1)`,
    );
    insAkun.run('1001', 'KAS', 'AKTIVA', 'DEBIT');
    insAkun.run('2050', 'HUTANG LAIN-LAIN', 'KEWAJIBAN', 'KREDIT');
    insAkun.run('3000', 'MODAL', 'EKUITAS', 'KREDIT');
    insAkun.run('4001', 'PENDAPATAN', 'PENDAPATAN', 'KREDIT');
    insAkun.run('1040', 'UANG PANJAR', 'AKTIVA', 'DEBIT');
    insAkun.run('5004', 'BEBAN KONSUMSI', 'BEBAN', 'DEBIT');

    lama
      .prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(
        'j-v11',
        '2026-01-01',
        'JU-2026-0001',
        'Saldo awal v11',
        'SALDO_AWAL',
        'j-v11',
        WAKTU,
      );
    const insBaris = lama.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, '')`,
    );
    insBaris.run('j-v11', '1001', 5_000_000, 0);
    insBaris.run('j-v11', '3000', 0, 5_000_000);

    // Jurnal serah panjar terpisah agar header `panjar` cocok dengan jurnal
    // open (DB-20) dan fixture tetap lolos audit.
    lama
      .prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES (?, ?, ?, ?, 'PANJAR', ?, NULL, ?)`,
      )
      .run(
        'j-v11-open',
        '2026-01-02',
        '',
        'Serah panjar v11',
        'j-v11-open',
        WAKTU,
      );
    insBaris.run('j-v11-open', '1040', 100_000, 0);
    insBaris.run('j-v11-open', '1001', 0, 100_000);

    // Jurnal close panjar agar fixture tetap lolos audit DB-19 (item CLOSED
    // harus cocok dengan debit BEBAN jurnal close).
    lama
      .prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES (?, ?, ?, ?, 'PANJAR', ?, NULL, ?)`,
      )
      .run(
        'j-v11-close',
        '2026-01-03',
        '',
        'Pertanggungjawaban panjar v11',
        'j-v11-close',
        WAKTU,
      );
    insBaris.run('j-v11-close', '5004', 50_000, 0);
    // Sisa panjar 50.000 kembali ke kas agar saldo 1040 nol dan cocok dengan
    // daftar panjar OPEN (AUD2-04).
    insBaris.run('j-v11-close', '1001', 50_000, 0);
    insBaris.run('j-v11-close', '1040', 0, 100_000);

    lama
      .prepare(
        `INSERT INTO panjar
           (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
            tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'CLOSED', ?, ?, ?, ?)`,
      )
      .run(
        'p-v11',
        '2026-01-02',
        'Penerima Panjar',
        100_000,
        '1001',
        '2026-01-03',
        'j-v11-open',
        'j-v11-close',
        WAKTU,
      );
    lama
      .prepare(
        `INSERT INTO panjar_item (panjar_id, kategori_baga, nominal, jurnal_id)
         VALUES (?, ?, ?, ?)`,
      )
      .run('p-v11', '5004', 50_000, 'j-v11-close');

    lama
      .prepare(
        `INSERT INTO tutup_buku (tahun, created_at, catatan)
         VALUES (?, ?, ?)`,
      )
      .run(2025, WAKTU, 'Tutup buku v11');
    lama
      .prepare(
        `INSERT INTO audit_log
           (id, tanggal, aksi, alasan, data_lama_json, data_baru_json)
         VALUES (?, ?, ?, ?, '', ?)`,
      )
      .run('audit-v11', WAKTU, 'UJI-V11', 'Audit lama v11', '{"uji":true}');
    lama
      .prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('uji-v11', 'tetap')")
      .run();

    // Data di tabel yang disetujui dibuang.
    lama
      .prepare('INSERT INTO pihak (id, nama, catatan, created_at) VALUES (?, ?, ?, ?)')
      .run('pihak-v11', 'Pihak Lama', 'Legacy', WAKTU);
    lama
      .prepare('INSERT INTO jurnal_pihak (jurnal_id, pihak_id, akun_kode) VALUES (?, ?, ?)')
      .run('j-v11', 'pihak-v11', '2050');
    lama
      .prepare(
        `INSERT INTO aset
           (id, kode, nama, jenis, luas_m2, lokasi, status_hukum, tahun_perolehan,
            asal_usul, kondisi, keterangan, nilai_sen, created_at, updated_at)
         VALUES (?, ?, ?, 'TANAH', 100, 'Lokasi', 'SHM', 2020,
                 'Waris', 'BAIK', 'Legacy', 1000, ?, ?)`,
      )
      .run('aset-v11', 'AST-001', 'Aset Lama', WAKTU, WAKTU);
    lama
      .prepare(
        `INSERT INTO anggaran (tahun, akun_kode, nominal, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(2026, '1001', 123_000, WAKTU, WAKTU);
    lama
      .prepare(
        `INSERT INTO rekonsiliasi_bank
           (id, akun_kode, tanggal, saldo_bank, catatan, selesai, created_at, selesai_at)
         VALUES (?, ?, ?, ?, '', 0, ?, NULL)`,
      )
      .run('rek-v11', '1001', '2026-01-03', 999_000, WAKTU);
    lama
      .prepare(
        `INSERT INTO lampiran_jurnal
           (id, jurnal_id, nama_asli, nama_simpan, mime, ukuran, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('lamp-v11', 'j-v11', 'bukti.pdf', 'simpan-v11.pdf', 'application/pdf', 10, WAKTU);

    lama.pragma('user_version = 11');
  } finally {
    lama.close();
  }
}

describe('DB-33 — migrasi v11 → v21', () => {
  it('membuat backup, membuang tabel legacy, dan mempertahankan tabel akuntansi', () => {
    const dir = tmpDir('pura-v12-migrasi-');
    const path = join(dir, 'pura.db');
    buatFixtureV11(path);

    const backup = backupPraUpgrade(path, join(dir, 'backups'), 'v11');
    expect(backup).toBe(join(dir, 'backups', 'pre-upgrade-v11.db'));
    expect(existsSync(backup)).toBe(true);
    expect(statSync(backup).size).toBeGreaterThan(0);

    // Backup berisi v11 lengkap, termasuk data tabel yang akan dibuang.
    const pra = new Database(backup, { readonly: true });
    try {
      expect(versi(pra)).toBe(11);
      for (const tabel of TABEL_DIHAPUS_V12) {
        expect(
          (pra.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).get() as { n: number }).n,
          `baris ${tabel} di backup`,
        ).toBe(1);
      }
    } finally {
      pra.close();
    }

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(23);
      expect(versi(db)).toBe(23);
      const tabel = daftarTabel(db);
      for (const wajib of TABEL_INTI) expect(tabel).toContain(wajib);
      for (const lama of TABEL_DIHAPUS_V12) {
        expect(tabel, `tabel ${lama} seharusnya sudah dibuang`).not.toContain(lama);
      }
      const index = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as {
          name: string;
        }[]
      ).map((i) => i.name);
      for (const lama of [
        'idx_pihak_nama_unik',
        'idx_jurnal_pihak_pihak',
        'idx_aset_jenis',
        'idx_aset_kode',
        'idx_anggaran_akun',
        'idx_rekonsiliasi_akun_tanggal',
        'idx_lampiran_jurnal',
      ]) {
        expect(index, `index ${lama} seharusnya ikut terhapus`).not.toContain(lama);
      }

      // Jurnal + panjar + tutup buku + audit + pengaturan utuh.
      expect(listJurnal(db).map((j) => j.id)).toEqual(['j-v11', 'j-v11-open', 'j-v11-close']);
      const baris = listJurnalBaris(db, 'j-v11');
      expect(baris).toHaveLength(2);
      expect(baris.reduce((t, b) => t + b.debit, 0)).toBe(5_000_000);
      expect(baris.reduce((t, b) => t + b.kredit, 0)).toBe(5_000_000);
      expect(db.prepare('SELECT id, status FROM panjar').all()).toEqual([
        { id: 'p-v11', status: 'CLOSED' },
      ]);
      expect(db.prepare('SELECT panjar_id, kategori_baga FROM panjar_item').all()).toEqual([
        { panjar_id: 'p-v11', kategori_baga: '5004' },
      ]);
      expect(listTutupBuku(db).map((t) => t.tahun)).toEqual([2025]);
      expect(listAuditLog(db).map((a) => a.id)).toEqual(['audit-v11']);
      expect(getPengaturan(db, 'uji-v11')).toBe('tetap');

      // Trigger v9/v11 tetap terpasang setelah drop tabel.
      expect(
        (
          db
            .prepare(
              `SELECT COUNT(*) AS n FROM sqlite_master
               WHERE type = 'trigger' AND (name LIKE 'trg_jurnal%' OR name LIKE 'trg_audit%'
                 OR name LIKE 'trg_tutup%')`,
            )
            .get() as { n: number }
        ).n,
      ).toBe(10);
      expect(auditIntegritas(db).ok).toBe(true);
    } finally {
      db.close();
    }

    // Migrasi dijalankan ulang dan DB dibuka ulang: tetap v21, tanpa tabel legacy.
    const db2 = openDb(path);
    try {
      expect(migrasi(db2)).toBe(23);
      expect(migrasi(db2)).toBe(23);
      expect(versi(db2)).toBe(23);
      const tabel = daftarTabel(db2);
      for (const lama of TABEL_DIHAPUS_V12) expect(tabel).not.toContain(lama);
      expect(listJurnal(db2).map((j) => j.id)).toEqual(['j-v11', 'j-v11-open', 'j-v11-close']);
    } finally {
      db2.close();
    }

    // Backup v11 tetap valid direstore (extra tabel legacy tidak menolak).
    expect(validasiKandidatRestore(backup)).toEqual({ valid: true });
  });

  it('DB baru langsung v21 tanpa tabel legacy dan lolos audit', () => {
    const db = openDb(':memory:');
    try {
      expect(versi(db)).toBe(23);
      const tabel = daftarTabel(db);
      for (const wajib of TABEL_INTI) expect(tabel).toContain(wajib);
      for (const lama of TABEL_DIHAPUS_V12) {
        expect(tabel, `tabel ${lama} tidak boleh dibuat`).not.toContain(lama);
      }
      expect(auditIntegritas(db).ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it('menolak DB versi lebih baru sebelum DDL dan tidak mengubah file', () => {
    const dir = tmpDir('pura-v12-baru-');
    const path = join(dir, 'baru.db');
    const baru = new Database(path);
    try {
      baru.exec('CREATE TABLE sentinel (id TEXT PRIMARY KEY)');
      baru.prepare("INSERT INTO sentinel (id) VALUES ('tetap')").run();
      baru.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    } finally {
      baru.close();
    }

    expect(() => openDb(path)).toThrow(
      'Database dibuat aplikasi versi lebih baru. Perbarui aplikasi.',
    );

    // Tidak ada DDL yang dijalankan: versi, tabel sentinel, dan isinya tetap.
    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(SCHEMA_VERSION + 1);
      expect(daftarTabel(cek)).toEqual(['sentinel']);
      expect(cek.prepare('SELECT id FROM sentinel').all()).toEqual([{ id: 'tetap' }]);
    } finally {
      cek.close();
    }

    // `migrasi()` juga menolak koneksi yang sudah terbuka.
    const langsung = new Database(path);
    try {
      expect(() => migrasi(langsung)).toThrow(
        'Database dibuat aplikasi versi lebih baru. Perbarui aplikasi.',
      );
      expect(versi(langsung)).toBe(SCHEMA_VERSION + 1);
    } finally {
      langsung.close();
    }
  });
});

describe('DB-33 — restore & backup lintas versi', () => {
  it('menerima backup versi saat ini dan merestorekannya', () => {
    const dir = tmpDir('pura-v15-restore-');
    const sumberPath = join(dir, 'sumber.db');
    const backupPath = join(dir, 'backup-v15.db');
    let sumber = openDb(sumberPath);
    try {
      insertJurnalTervalidasi(
        sumber,
        { id: 'j-v15', tanggal: '2026-03-01', keterangan: 'Data v15' },
        [
          { akun_kode: '1001', debit: 100_000, kredit: 0 },
          { akun_kode: '4001', debit: 0, kredit: 100_000 },
        ],
      );
      backupVacuumInto(sumber, backupPath);
    } finally {
      sumber.close();
    }

    expect(validasiKandidatRestore(backupPath)).toEqual({ valid: true });
    const cek = new Database(backupPath, { readonly: true });
    try {
      expect(versi(cek)).toBe(SCHEMA_VERSION);
      for (const lama of TABEL_DIHAPUS_V12) expect(daftarTabel(cek)).not.toContain(lama);
    } finally {
      cek.close();
    }

    const aktifPath = join(dir, 'aktif.db');
    let aktif = openDb(aktifPath);
    try {
      const hasil = restoreDbAman(aktif, {
        dbPath: aktifPath,
        backupPath,
        dirBackup: join(dir, 'backups'),
        stamp: 'v15',
      });
      expect(hasil.ok, hasil.ok ? '' : hasil.error).toBe(true);
      if (!hasil.ok) throw new Error(hasil.error);
      aktif = hasil.db;
      expect(versi(aktif)).toBe(SCHEMA_VERSION);
      expect(listJurnal(aktif).map((j) => j.id)).toEqual(['j-v15']);
      for (const lama of TABEL_DIHAPUS_V12) expect(daftarTabel(aktif)).not.toContain(lama);
    } finally {
      aktif.close();
    }
  });

  it.each(['panjar_item', 'panjar'] as const)(
    'menolak backup versi saat ini yang kehilangan %s',
    (tabelHilang) => {
      const dir = tmpDir('pura-v15-wajib-');
      const asli = join(dir, 'asli.db');
      const kurang = join(dir, 'kurang.db');
      const db = openDb(asli);
      try {
        backupVacuumInto(db, kurang);
      } finally {
        db.close();
      }

      const rusak = new Database(kurang);
      try {
        rusak.exec(`DROP TABLE ${tabelHilang}`);
      } finally {
        rusak.close();
      }

      const hasil = validasiKandidatRestore(kurang);
      expect(hasil.valid).toBe(false);
      if (!hasil.valid) expect(hasil.error).toContain(tabelHilang);
    },
  );

  it('menerima backup v11 yang masih memiliki tabel legacy', () => {
    const dir = tmpDir('pura-v12-v11-legacy-');
    const path = join(dir, 'v11.db');
    buatFixtureV11(path);

    const cek = new Database(path, { readonly: true });
    try {
      expect(versi(cek)).toBe(11);
      for (const lama of TABEL_DIHAPUS_V12) expect(daftarTabel(cek)).toContain(lama);
    } finally {
      cek.close();
    }

    // Tabel legacy tidak diwajibkan, tetapi keberadaannya tidak menolak restore.
    expect(validasiKandidatRestore(path)).toEqual({ valid: true });
  });

  it(`membuat backup untuk setiap kenaikan versi, termasuk jalur hipotetis v${SCHEMA_VERSION} → v${SCHEMA_VERSION + 1}`, () => {
    const dir = tmpDir('pura-v14-target-');
    const path = join(dir, 'pura.db');
    const db = openDb(path);
    try {
      insertJurnalTervalidasi(
        db,
        { id: 'j-target', tanggal: '2026-04-01', keterangan: 'Data target' },
        [
          { akun_kode: '1001', debit: 50_000, kredit: 0 },
          { akun_kode: '4001', debit: 0, kredit: 50_000 },
        ],
      );
    } finally {
      db.close();
    }

    // Versi saat ini tidak perlu backup.
    expect(backupPraUpgrade(path, join(dir, 'backups'), `v${SCHEMA_VERSION}`)).toBe('');
    // Simulasi target versi berikutnya: versi saat ini < target sehingga backup dibuat.
    const dest = backupPraUpgrade(
      path,
      join(dir, 'backups'),
      `v${SCHEMA_VERSION}-ke-v${SCHEMA_VERSION + 1}`,
      SCHEMA_VERSION + 1,
    );
    expect(dest).toBe(
      join(dir, 'backups', `pre-upgrade-v${SCHEMA_VERSION}-ke-v${SCHEMA_VERSION + 1}.db`),
    );
    const cek = new Database(dest, { readonly: true });
    try {
      expect(versi(cek)).toBe(SCHEMA_VERSION);
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['j-target']);
    } finally {
      cek.close();
    }
    // In-memory dan file kosong tidak membuat backup.
    expect(
      backupPraUpgrade(':memory:', join(dir, 'backups'), 'mem', SCHEMA_VERSION + 1),
    ).toBe('');
  });
});

describe('DB-33 — kontrak tabel wajib restore', () => {
  it('memakai tabel skema saat ini, bukan tabel legacy', () => {
    expect([...TABEL_WAJIB_RESTORE].sort()).toEqual([...TABEL_INTI].sort());
  });
});
