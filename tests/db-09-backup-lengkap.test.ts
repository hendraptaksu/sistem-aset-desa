// DB-09 — Backup Lengkap adalah jalur utama; restore `.db` hanya alternatif
// lanjutan dengan peringatan ekstra.
//
// Sejak DB-37 aplikasi tidak menyimpan file bukti terpisah, jadi backup lengkap
// hanya berisi `pura.db` + `manifest.json` dan auto-backup harian sengaja tetap
// satu file `.db`. Test ini menjaga isi backup, restore, dan tidak adanya file
// yatim (attachments/manifest) yang ikut tercampur.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { insertJurnalTervalidasi, listJurnal } from '../src/db/repository.js';
import { buatBackupLengkap } from '../src/features/export/backupLengkap.js';
import { autoBackupHarian, validasiKandidatRestore } from '../src/features/export/export.js';
import { restoreLengkap } from '../src/features/export/restoreLengkap.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

function jurnal(id: string, keterangan = `uji ${id}`) {
  return {
    header: { id, tanggal: '2026-10-30', keterangan },
    baris: [
      { akun_kode: '1001', debit: 100_000, kredit: 0 },
      { akun_kode: '4007', debit: 0, kredit: 100_000 },
    ],
  };
}

describe('DB-09 — backup lengkap: pura.db + manifest, tanpa file lampiran', () => {
  it('membuat folder berisi tepat pura.db + manifest.json dan manifest hanya mendaftar pura.db', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-db09-buat-'));
    let db: ReturnType<typeof openDb> | null = null;
    let cek: ReturnType<typeof openDb> | null = null;
    try {
      const dbPath = join(dir, 'data', 'pura.db');
      db = openDb(dbPath);
      insertJurnalTervalidasi(db, jurnal('j1').header, jurnal('j1').baris);

      const destDir = join(dir, 'pura-backup-lengkap');
      buatBackupLengkap({ db, dbPath, destDir });

      expect(readdirSync(destDir).sort()).toEqual(['manifest.json', 'pura.db']);
      expect(existsSync(join(destDir, 'attachments'))).toBe(false);
      expect(
        readdirSync(destDir).filter((f) => /attachment|lampiran/i.test(f)),
      ).toEqual([]);

      const manifest = JSON.parse(
        readFileSync(join(destDir, 'manifest.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(manifest.daftarFile).toEqual(['pura.db']);
      expect(manifest.ukuranDb).toBe(statSync(join(destDir, 'pura.db')).size);
      expect(manifest).not.toHaveProperty('jumlahLampiran');
      expect(manifest.auditIntegritas).toMatchObject({
        ok: true,
        jumlahTemuan: 0,
      });

      cek = openDb(join(destDir, 'pura.db'));
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['j1']);
    } finally {
      cek?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DB-09 — restore lengkap: database pulih, manifest tidak disalin, folder lama tidak disentuh', () => {
  it('mengganti database dan membiarkan file/folder non-database di lokasi aktif', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-db09-restore-'));
    let aktif: ReturnType<typeof openDb> | null = null;
    let sumber: ReturnType<typeof openDb> | null = null;
    let cekLama: ReturnType<typeof openDb> | null = null;
    try {
      const dataDir = join(dir, 'data');
      const aktifPath = join(dataDir, 'pura.db');
      aktif = openDb(aktifPath);
      insertJurnalTervalidasi(aktif, jurnal('lama').header, jurnal('lama').baris);
      insertJurnalTervalidasi(
        aktif,
        jurnal('tambahan', 'Data setelah backup').header,
        jurnal('tambahan').baris,
      );

      // Sisa folder dari versi lama (DB-37). Restore tidak boleh menghapus atau
      // menggantinya, dan tidak boleh membuat folder lampiran baru.
      const folderLama = join(dataDir, 'attachments');
      mkdirSync(folderLama, { recursive: true });
      writeFileSync(join(folderLama, 'berkas-lama.jpg'), 'milik-instalasi-aktif');

      const sumberPath = join(dir, 'sumber', 'pura.db');
      sumber = openDb(sumberPath);
      insertJurnalTervalidasi(sumber, jurnal('baru').header, jurnal('baru').baris);
      const backupDir = join(dir, 'backup-lengkap');
      buatBackupLengkap({ db: sumber, dbPath: sumberPath, destDir: backupDir });
      sumber.close();
      sumber = null;

      const hasil = restoreLengkap({
        db: aktif,
        dbPath: aktifPath,
        backupDir,
        dirBackup: join(dataDir, 'backups'),
        stamp: 'db09',
      });
      expect(hasil.ok, hasil.ok ? '' : hasil.error).toBe(true);
      if (!hasil.ok) throw new Error(hasil.error);
      aktif = hasil.db;

      expect(listJurnal(aktif).map((j) => j.id)).toEqual(['baru']);

      // Manifest hanya metadata backup; tidak disalin ke folder data aktif.
      expect(existsSync(join(dataDir, 'manifest.json'))).toBe(false);
      expect(readdirSync(backupDir).sort()).toEqual(['manifest.json', 'pura.db']);
      expect(readFileSync(join(folderLama, 'berkas-lama.jpg'), 'utf-8')).toBe(
        'milik-instalasi-aktif',
      );

      // Cadangan pra-restore memuat data lama, termasuk jurnal tambahan.
      cekLama = openDb(hasil.preRestorePath);
      expect(listJurnal(cekLama).map((j) => j.id)).toEqual(['lama', 'tambahan']);
    } finally {
      cekLama?.close();
      sumber?.close();
      aktif?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DB-09 — restore lengkap menolak folder tanpa manifest', () => {
  it('tidak menyentuh DB aktif dan tidak membuat cadangan pra-restore', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-db09-tanpa-manifest-'));
    let aktif: ReturnType<typeof openDb> | null = null;
    let sumber: ReturnType<typeof openDb> | null = null;
    try {
      const dataDir = join(dir, 'data');
      const aktifPath = join(dataDir, 'pura.db');
      aktif = openDb(aktifPath);
      insertJurnalTervalidasi(aktif, jurnal('lama').header, jurnal('lama').baris);

      const sumberPath = join(dir, 'sumber', 'pura.db');
      sumber = openDb(sumberPath);
      insertJurnalTervalidasi(sumber, jurnal('baru').header, jurnal('baru').baris);
      const backupDir = join(dir, 'backup-lengkap');
      buatBackupLengkap({ db: sumber, dbPath: sumberPath, destDir: backupDir });
      sumber.close();
      sumber = null;

      rmSync(join(backupDir, 'manifest.json'));
      const hasil = restoreLengkap({
        db: aktif,
        dbPath: aktifPath,
        backupDir,
        dirBackup: join(dataDir, 'backups'),
        stamp: 'tanpa-manifest',
      });
      expect(hasil.ok).toBe(false);
      if (hasil.ok) throw new Error('folder tanpa manifest seharusnya ditolak');
      expect(hasil.db).toBe(aktif);
      expect(hasil.error).toMatch(/manifest\.json/i);
      expect(listJurnal(aktif).map((j) => j.id)).toEqual(['lama']);
      expect(existsSync(join(dataDir, 'backups', 'pre-restore-tanpa-manifest.db'))).toBe(
        false,
      );
    } finally {
      sumber?.close();
      aktif?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DB-09 — auto-backup harian sengaja satu file .db', () => {
  it('hanya membuat auto-YYYY-MM-DD.db tanpa manifest/attachments dan tetap bisa divalidasi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-db09-auto-'));
    let db: ReturnType<typeof openDb> | null = null;
    let cek: ReturnType<typeof openDb> | null = null;
    try {
      const dbPath = join(dir, 'data', 'pura.db');
      const bakDir = join(dir, 'data', 'backups');
      db = openDb(dbPath);
      insertJurnalTervalidasi(db, jurnal('auto').header, jurnal('auto').baris);

      const dest = autoBackupHarian(db, bakDir, 7, '2026-10-30');
      expect(dest).toBe(join(bakDir, 'auto-2026-10-30.db'));
      expect(readdirSync(bakDir)).toEqual(['auto-2026-10-30.db']);
      expect(existsSync(join(bakDir, 'manifest.json'))).toBe(false);
      expect(existsSync(join(bakDir, 'attachments'))).toBe(false);
      expect(validasiKandidatRestore(dest).valid).toBe(true);

      // Idempoten: pemanggilan kedua tidak menambah file/folder.
      expect(autoBackupHarian(db, bakDir, 7, '2026-10-30')).toBe(dest);
      expect(readdirSync(bakDir)).toEqual(['auto-2026-10-30.db']);

      cek = openDb(dest);
      expect(listJurnal(cek).map((j) => j.id)).toEqual(['auto']);
    } finally {
      cek?.close();
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('DB-09 — UI dan dokumentasi menempatkan Restore Lengkap sebagai jalur utama', () => {  it('Dashboard: tombol Restore Lengkap tampil lebih dulu dan .db diberi peringatan', () => {
    const dashboard = baca('src/renderer/components/DashboardTab.tsx');
    const awalPulihkan = dashboard.indexOf('id="judul-pulihkan"');
    expect(awalPulihkan).toBeGreaterThan(-1);
    const bagianPulihkan = dashboard.slice(
      awalPulihkan,
      dashboard.indexOf('</section>', awalPulihkan),
    );

    const lengkap = bagianPulihkan.indexOf('Restore Lengkap (disarankan)');
    const db = bagianPulihkan.indexOf('Restore Import .db (lanjutan)');
    expect(lengkap).toBeGreaterThan(-1);
    expect(db).toBeGreaterThan(-1);
    expect(lengkap).toBeLessThan(db);

    expect(bagianPulihkan).toMatch(/hanya memulihkan database/i);
    expect(bagianPulihkan).toMatch(/tanpa validasi manifest/i);
    // Dua tahap konfirmasi + pengiriman konfirmasi eksplisit ke main.
    expect(dashboard).toContain('konfirmasiRestoreFinal');
    expect(dashboard).toContain('api.backupImport(true)');
  });

  it('Pengaturan dan panduan menandai Backup Lengkap sebagai disarankan dan .db sebagai lanjutan', () => {
    const pengaturan = baca('src/renderer/components/PengaturanTab.tsx');
    expect(pengaturan).toMatch(/Backup Lengkap/);
    expect(pengaturan).toMatch(/Restore Lengkap/);
    expect(pengaturan).toMatch(/Backup Export \.db \(lanjutan\)/);
    expect(pengaturan).toMatch(/tidak memvalidasi manifest/i);

    for (const path of ['docs/panduan-pengguna.md', 'docs/panduan-portable.md']) {
      // Normalisasi line break agar kalimat yang dibungkus tetap bisa dicek.
      const dokumen = baca(path).replace(/\s+/g, ' ');
      expect(dokumen, path).toMatch(/Restore Lengkap \(disarankan\)/);
      expect(dokumen, path).toMatch(/hanya memulihkan database/i);
      expect(dokumen, path).toMatch(/tidak memvalidasi manifest/i);
      expect(dokumen, path).toMatch(/satu file database/i);
    }
  });
});

describe('DB-12 — backup lengkap menolak DB yang tidak lolos audit', () => {
  it('tidak membuat folder/target dan tidak menulis manifest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-db12-backup-rusak-'));
    let db: ReturnType<typeof openDb> | null = null;
    try {
      const dbPath = join(dir, 'data', 'pura.db');
      db = openDb(dbPath);
      db.prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES ('j-rusak', '2026-10-30', '', 'Korupsi', 'UMUM', 'j-rusak', NULL,
                 '2026-10-30T00:00:00.000Z')`,
      ).run();
      db.prepare(
        `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
         VALUES ('j-rusak', '1001', 1000, 0, '')`,
      ).run();
      db.prepare(
        `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
         VALUES ('j-rusak', '4001', 0, 900, '')`,
      ).run();

      const destDir = join(dir, 'pura-backup-rusak');
      expect(() => buatBackupLengkap({ db: db!, dbPath, destDir })).toThrow(
        /audit integritas/i,
      );
      expect(existsSync(destDir)).toBe(false);
    } finally {
      db?.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
