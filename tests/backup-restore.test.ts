// P0-8: backup .db aman (VACUUM INTO) + restore tervalidasi & tidak merusak data lama.
import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import pkg from '../package.json';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { insertJurnal, listJurnal } from '../src/db/repository.js';
import {
  TABEL_WAJIB_RESTORE,
  backupPraUpgrade,
  backupVacuumInto,
  restoreDbAman,
  validasiKandidatRestore,
} from '../src/features/export/export.js';
import {
  buatBackupLengkap,
  stampBackupLokal,
} from '../src/features/export/backupLengkap.js';

// AUD-15: kontrol test untuk menggagalkan rename tmp -> dest. Semua fungsi fs
// lain tetap memakai implementasi asli.
const kontrolRename = vi.hoisted(() => ({ gagalTmp: false }));

vi.mock('node:fs', async (importOriginal) => {
  const asli = await importOriginal<typeof import('node:fs')>();
  return {
    ...asli,
    renameSync: (from: string, to: string) => {
      if (kontrolRename.gagalTmp && from.includes('.tmp-'))
        throw Object.assign(new Error('EPERM simulasi: rename backup gagal'), { code: 'EPERM' });
      return asli.renameSync(from, to);
    },
  };
});

function jurnal(id: string, tanggal = '2026-09-09') {
  return {
    header: { id, tanggal, keterangan: `uji ${id}` },
    baris: [
      { akun_kode: '1001', debit: 100_000, kredit: 0 },
      { akun_kode: '4007', debit: 0, kredit: 100_000 },
    ],
  };
}

describe('P0-8 — backupVacuumInto: konsisten walau WAL belum checkpoint', () => {
  it('menyertakan transaksi terbaru, aman untuk path ber-kutip, tujuan lama ditimpa', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-bak-'));
    let db: Database.Database | null = null;
    let cek: Database.Database | null = null;
    try {
      const dbPath = join(dir, 'pura.db');
      db = openDb(dbPath);
      insertJurnal(db, jurnal('j1').header, jurnal('j1').baris);
      insertJurnal(db, jurnal('j2').header, jurnal('j2').baris);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      // Data terbaru masih berada di WAL (belum checkpoint, DB tetap terbuka).
      expect(existsSync(`${dbPath}-wal`)).toBe(true);

      const dest = join(dir, "cadangan 'pura'", 'pura-backup.db');
      backupVacuumInto(db, dest);
      expect(existsSync(dest)).toBe(true);

      // Koneksi aktif tetap bisa dipakai setelah backup.
      insertJurnal(db, jurnal('j3').header, jurnal('j3').baris);

      cek = openDb(dest);
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['j1', 'j2']);

      // Backup kedua ke tujuan yang sama harus menimpa bersih, bukan gagal.
      backupVacuumInto(db, dest);
      cek.close();
      cek = openDb(dest);
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['j1', 'j2', 'j3']);
    } finally {
      cek?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AUD-15 — backupVacuumInto: tulis via tmp + rename tanpa kehilangan backup lama', () => {
  it('backup baru valid, menimpa tujuan lama, dan membersihkan bak/tmp/sidecar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-aud15-ok-'));
    let db: Database.Database | null = null;
    let cek: Database.Database | null = null;
    try {
      db = openDb(join(dir, 'pura.db'));
      insertJurnal(db, jurnal('lama').header, jurnal('lama').baris);
      const dest = join(dir, 'backup.db');
      backupVacuumInto(db, dest);

      // Sidecar lama yang mungkin tertinggal saat tujuan pernah dibuka.
      writeFileSync(`${dest}-wal`, 'wal-lama');
      writeFileSync(`${dest}-shm`, 'shm-lama');
      insertJurnal(db, jurnal('baru').header, jurnal('baru').baris);

      backupVacuumInto(db, dest);
      expect(existsSync(dest)).toBe(true);
      expect(existsSync(`${dest}-wal`)).toBe(false);
      expect(existsSync(`${dest}-shm`)).toBe(false);
      expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);
      expect(readdirSync(dir).filter((f) => f.includes('.bak-'))).toEqual([]);

      cek = openDb(dest);
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['lama', 'baru']);
    } finally {
      cek?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('VACUUM gagal tidak menghapus backup lama dan membersihkan tmp', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-aud15-vacuum-'));
    let db: Database.Database | null = null;
    let cek: Database.Database | null = null;
    try {
      const koneksi = openDb(join(dir, 'pura.db'));
      db = koneksi;
      insertJurnal(koneksi, jurnal('lama').header, jurnal('lama').baris);
      const dest = join(dir, 'backup.db');
      backupVacuumInto(koneksi, dest);

      // VACUUM INTO ditolak SQLite saat berada di dalam transaksi.
      insertJurnal(koneksi, jurnal('baru').header, jurnal('baru').baris);
      koneksi.exec('BEGIN');
      try {
        expect(() => backupVacuumInto(koneksi, dest)).toThrow(/transaction/i);
      } finally {
        koneksi.exec('ROLLBACK');
      }

      expect(existsSync(dest)).toBe(true);
      expect(existsSync(`${dest}.bak-${process.pid}`)).toBe(false);
      expect(readdirSync(dir).filter((f) => f.includes('.tmp-'))).toEqual([]);

      cek = openDb(dest);
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['lama']);
    } finally {
      cek?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rename tmp gagal: backup lama dikembalikan dan tmp dipertahankan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-aud15-rename-'));
    let db: Database.Database | null = null;
    let cek: Database.Database | null = null;
    try {
      db = openDb(join(dir, 'pura.db'));
      insertJurnal(db, jurnal('lama').header, jurnal('lama').baris);
      const dest = join(dir, 'backup.db');
      backupVacuumInto(db, dest);
      insertJurnal(db, jurnal('baru').header, jurnal('baru').baris);

      let error: unknown;
      kontrolRename.gagalTmp = true;
      try {
        backupVacuumInto(db, dest);
      } catch (e) {
        error = e;
      } finally {
        kontrolRename.gagalTmp = false;
      }
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/EPERM simulasi/);

      // Backup lama kembali di path tujuan, bukan hilang.
      expect(existsSync(dest)).toBe(true);
      expect(existsSync(`${dest}.bak-${process.pid}`)).toBe(false);
      cek = openDb(dest);
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['lama']);
      cek.close();
      cek = null;

      // tmp sengaja dipertahankan untuk diagnosis.
      const tmp = readdirSync(dir).filter((f) => f.includes('.tmp-'));
      expect(tmp).toHaveLength(1);
      expect(statSync(join(dir, tmp[0]!)).size).toBeGreaterThan(0);
    } finally {
      kontrolRename.gagalTmp = false;
      cek?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AUD-11 — backup lengkap: DB + lampiran + manifest', () => {
  it('menyalin DB dan 2 lampiran; manifest valid; DB backup memuat data WAL terbaru', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-aud11-'));
    let db: Database.Database | null = null;
    let cek: Database.Database | null = null;
    try {
      const dbPath = join(dir, 'data', 'pura.db');
      db = openDb(dbPath);
      insertJurnal(db, jurnal('j1').header, jurnal('j1').baris);
      insertJurnal(db, jurnal('j2').header, jurnal('j2').baris);
      expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
      // Transaksi terbaru masih di WAL (belum checkpoint, koneksi terbuka).
      expect(existsSync(`${dbPath}-wal`)).toBe(true);

      const attachmentsDir = join(dir, 'lampiran');
      mkdirSync(join(attachmentsDir, 'nested'), { recursive: true });
      writeFileSync(join(attachmentsDir, 'foto.jpg'), 'isi-foto');
      writeFileSync(join(attachmentsDir, 'nested', 'bukti.pdf'), 'isi-pdf');

      const destDir = join(dir, 'tujuan', 'pura-backup-2026-10-27-1530');
      const hasil = buatBackupLengkap({
        db,
        dbPath,
        attachmentsDir,
        destDir,
        stamp: '2026-10-27-1530',
      });

      expect(hasil.destDir).toBe(destDir);
      expect(existsSync(join(destDir, 'pura.db'))).toBe(true);
      expect(existsSync(join(destDir, 'attachments', 'foto.jpg'))).toBe(true);
      expect(
        existsSync(join(destDir, 'attachments', 'nested', 'bukti.pdf')),
      ).toBe(true);
      expect(readFileSync(join(destDir, 'attachments', 'foto.jpg'), 'utf-8')).toBe(
        'isi-foto',
      );

      const manifest = JSON.parse(
        readFileSync(join(destDir, 'manifest.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(manifest).toMatchObject({
        versiApp: pkg.version,
        schemaVersion: SCHEMA_VERSION,
        jumlahLampiran: 2,
        ukuranDb: statSync(join(destDir, 'pura.db')).size,
        daftarFile: [
          'pura.db',
          'attachments/foto.jpg',
          'attachments/nested/bukti.pdf',
        ],
      });
      expect(typeof manifest.dibuat).toBe('string');
      expect(Number.isNaN(Date.parse(String(manifest.dibuat)))).toBe(false);
      expect(hasil.manifest).toEqual(manifest);

      // DB hasil VACUUM bisa dibuka dan berisi jurnal yang tadinya di WAL.
      cek = openDb(join(destDir, 'pura.db'));
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['j1', 'j2']);
    } finally {
      cek?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('lampiran tidak ada tetap menghasilkan folder attachments kosong + manifest 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-aud11-kosong-'));
    let db: Database.Database | null = null;
    try {
      const dbPath = join(dir, 'pura.db');
      db = openDb(dbPath);
      const destDir = join(dir, 'backup');
      const hasil = buatBackupLengkap({
        db,
        dbPath,
        attachmentsDir: join(dir, 'attachments-tidak-ada'),
        destDir,
        stamp: '2026-10-27-1531',
      });

      expect(readdirSync(join(destDir, 'attachments'))).toEqual([]);
      expect(hasil.manifest.jumlahLampiran).toBe(0);
      expect(hasil.manifest.daftarFile).toEqual(['pura.db']);
    } finally {
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stamp default memakai jam lokal WITA, bukan UTC', () => {
    // 16:05 UTC = 00:05 WITA tanggal berikutnya.
    expect(stampBackupLokal(new Date('2026-10-27T16:05:00.000Z'))).toBe(
      '2026-10-28-0005',
    );
  });
});

describe('P0-8 — validasiKandidatRestore: file sampah ditolak', () => {
  it('menerima backup asli dan menolak file kosong/rusak/bukan skema aplikasi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-val-'));
    let db: Database.Database | null = null;
    let lain: Database.Database | null = null;
    try {
      // Backup asli → valid.
      const asli = join(dir, 'asli.db');
      db = openDb(asli);
      insertJurnal(db, jurnal('ok').header, jurnal('ok').baris);
      const validPath = join(dir, 'valid.db');
      backupVacuumInto(db, validPath);
      expect(validasiKandidatRestore(validPath)).toEqual({ valid: true });

      // Bukan file SQLite.
      const sampah = join(dir, 'sampah.db');
      writeFileSync(sampah, 'ini bukan database sqlite');
      const vSampah = validasiKandidatRestore(sampah);
      expect(vSampah.valid).toBe(false);
      if (!vSampah.valid) expect(vSampah.error).toMatch(/tidak bisa dibaca|rusak/i);

      // File kosong.
      const kosong = join(dir, 'kosong.db');
      writeFileSync(kosong, '');
      const vKosong = validasiKandidatRestore(kosong);
      expect(vKosong.valid).toBe(false);
      if (!vKosong.valid) expect(vKosong.error).toMatch(/kosong/i);

      // SQLite valid tetapi bukan backup aplikasi (tabel wajib tidak lengkap).
      const lainPath = join(dir, 'lain.db');
      lain = new Database(lainPath);
      lain.exec('CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT)');
      lain.close();
      lain = null;
      const vLain = validasiKandidatRestore(lainPath);
      expect(vLain.valid).toBe(false);
      if (!vLain.valid) {
        expect(vLain.error).toMatch(/bukan backup aplikasi/i);
        expect(vLain.error).toContain('jurnal');
      }
    } finally {
      lain?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('P0-8 — backupPraUpgrade: simpan DB lama sebelum tabel single-entry dibuang', () => {
  it('membuat pre-upgrade untuk DB v1 dan tidak membuat untuk DB v2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-upgrade-'));
    let lamaDb: Database.Database | null = null;
    let probe: Database.Database | null = null;
    let dbV2: Database.Database | null = null;
    try {
      // DB v1 tiruan: punya tabel single-entry `transaksi`, user_version = 1.
      const lamaPath = join(dir, 'lama.db');
      lamaDb = new Database(lamaPath);
      lamaDb.exec('CREATE TABLE transaksi (id TEXT PRIMARY KEY, nominal INTEGER)');
      lamaDb.pragma('user_version = 1');
      lamaDb.prepare('INSERT INTO transaksi (id, nominal) VALUES (?, ?)').run('t1', 500);
      lamaDb.close();
      lamaDb = null;

      const dest = backupPraUpgrade(lamaPath, join(dir, 'backups'), 'uji');
      expect(dest).toBe(join(dir, 'backups', 'pre-upgrade-uji.db'));
      expect(existsSync(dest)).toBe(true);

      // Backup berisi tabel lama utuh (tidak ikut dimigrasi/dibuang).
      probe = new Database(dest, { readonly: true });
      expect(probe.prepare('SELECT nominal FROM transaksi WHERE id = ?').get('t1')).toEqual({
        nominal: 500,
      });
      probe.close();
      probe = null;

      // DB v2 tidak perlu backup pra-upgrade.
      const v2Path = join(dir, 'v2.db');
      dbV2 = openDb(v2Path);
      expect(backupPraUpgrade(v2Path, join(dir, 'backups'), 'v2')).toBe('');
    } finally {
      probe?.close();
      lamaDb?.close();
      dbV2?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('P0-8 — restoreDbAman', () => {
  it('restore sukses: DB aktif berganti, cadangan pra-restore berisi data lama', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-restore-'));
    let aktif: Database.Database | null = null;
    let sumber: Database.Database | null = null;
    let cekAktif: Database.Database | null = null;
    let cekLama: Database.Database | null = null;
    try {
      const aktifPath = join(dir, 'aktif.db');
      const sumberPath = join(dir, 'sumber.db');
      aktif = openDb(aktifPath);
      insertJurnal(aktif, jurnal('lama').header, jurnal('lama').baris);

      sumber = openDb(sumberPath);
      insertJurnal(sumber, jurnal('baru').header, jurnal('baru').baris);
      // Kandidat diambil dari koneksi terbuka (VACUUM INTO), lalu ditutup.
      const kandidat = join(dir, 'kandidat.db');
      backupVacuumInto(sumber, kandidat);
      sumber.close();
      sumber = null;

      const hasil = restoreDbAman(aktif, {
        dbPath: aktifPath,
        backupPath: kandidat,
        dirBackup: join(dir, 'backups'),
        stamp: 'uji',
      });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) throw new Error(hasil.error);
      aktif = hasil.db; // koneksi lama sudah ditutup; pakai koneksi hasil restore
      expect(hasil.preRestorePath).toBe(join(dir, 'backups', 'pre-restore-uji.db'));
      expect(existsSync(hasil.preRestorePath)).toBe(true);
      expect(existsSync(`${aktifPath}.restore-tmp`)).toBe(false);
      expect(listJurnal(aktif).map((j) => j.id)).toEqual(['baru']);

      // File DB aktif benar-benar sudah berganti.
      cekAktif = openDb(aktifPath);
      expect(listJurnal(cekAktif).map((j) => j.id)).toEqual(['baru']);

      // Cadangan pra-restore memuat data sebelum restore.
      cekLama = openDb(hasil.preRestorePath);
      expect(listJurnal(cekLama).map((j) => j.id)).toEqual(['lama']);
    } finally {
      cekLama?.close();
      cekAktif?.close();
      sumber?.close();
      aktif?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('kandidat sampah ditolak tanpa menyentuh DB aktif', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-tolak-'));
    let db: Database.Database | null = null;
    try {
      const aktifPath = join(dir, 'aktif.db');
      db = openDb(aktifPath);
      insertJurnal(db, jurnal('lama').header, jurnal('lama').baris);
      const sampah = join(dir, 'sampah.db');
      writeFileSync(sampah, 'bukan sqlite');

      const hasil = restoreDbAman(db, {
        dbPath: aktifPath,
        backupPath: sampah,
        dirBackup: join(dir, 'backups'),
        stamp: 'x',
      });
      expect(hasil.ok).toBe(false);
      if (hasil.ok) throw new Error('seharusnya ditolak');
      expect(hasil.db).toBe(db); // koneksi lama tetap dipakai
      // Tidak ada cadangan pra-restore karena validasi gagal lebih dulu.
      expect(existsSync(join(dir, 'backups', 'pre-restore-x.db'))).toBe(false);

      // DB lama tetap bisa ditulis.
      insertJurnal(hasil.db, jurnal('baru').header, jurnal('baru').baris);
      expect(listJurnal(hasil.db).map((j) => j.id)).toEqual(['lama', 'baru']);
    } finally {
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('gagal saat membuka kandidat → DB lama dipulihkan dari pra-restore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-gagal-'));
    let db: Database.Database | null = null;
    try {
      const aktifPath = join(dir, 'aktif.db');
      db = openDb(aktifPath);
      insertJurnal(db, jurnal('lama').header, jurnal('lama').baris);

      // Lolos validasi (nama tabel lengkap, integrity ok) tetapi skemanya rusak:
      // openDb akan gagal membuat index/upsert akun.
      const kandidatPath = join(dir, 'kandidat-rusak.db');
      const rusak = new Database(kandidatPath);
      for (const t of TABEL_WAJIB_RESTORE) rusak.exec(`CREATE TABLE ${t} (x TEXT)`);
      rusak.close();

      const hasil = restoreDbAman(db, {
        dbPath: aktifPath,
        backupPath: kandidatPath,
        dirBackup: join(dir, 'backups'),
        stamp: 'gagal',
      });
      expect(hasil.ok).toBe(false);
      if (hasil.ok) throw new Error('seharusnya gagal');
      expect(hasil.error).toMatch(/data lama tetap dipakai/i);
      expect(existsSync(`${aktifPath}.restore-tmp`)).toBe(false);
      db = hasil.db;
      // File aktif kembali berisi data lama + tetap bisa ditulis.
      expect(listJurnal(db).map((j) => j.id)).toEqual(['lama']);
      insertJurnal(db, jurnal('lagi').header, jurnal('lagi').baris);
      expect(listJurnal(db).map((j) => j.id)).toEqual(['lama', 'lagi']);
    } finally {
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
