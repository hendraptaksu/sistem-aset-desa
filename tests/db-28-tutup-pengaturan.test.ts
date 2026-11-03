// DB-28 — hapus `tutup_buku.backup_path` & `awal_tahun_buku` dari UI.
//
// Fokus:
// - kolom backup_path sudah dibuang dari skema v23 (AUD2-09);
// - penulisan baru tidak menyimpan/mengekspos path backup;
// - pengaturan lama non-Januari tetap terbaca tanpa auto-rewrite;
// - save pengaturan dari kontrak publik (tanpa awal tahun) menulis Januari;
// - UI Pengaturan tidak punya field/peringatan awal tahun buku dan riwayat
//   tutup buku tidak punya kolom Backup.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  getPengaturan,
  getPengaturanPembukuan,
  insertJurnalTervalidasi,
  insertTutupBuku,
  KUNCI_AKUNTANSI_AWAL_TAHUN,
  listAuditLog,
  listTutupBuku,
  setPengaturan,
  simpanPengaturanPembukuan,
} from '../src/db/repository.js';
import { tutupBuku } from '../src/db/tutup.js';
import {
  DEFAULT_PENGATURAN,
  pengaturanPublik,
} from '../src/core/pengaturan.js';
import type { JurnalBarisInput, TutupBuku } from '../src/core/types.js';
import { validasiBentukPengaturanPembukuan } from '../src/main/validation.js';
import { PengaturanTab } from '../src/renderer/components/PengaturanTab.js';
import { TutupTab } from '../src/renderer/components/TutupTab.js';

const SRC_PENGATURAN = readFileSync(
  new URL('../src/renderer/components/PengaturanTab.tsx', import.meta.url),
  'utf8',
);
const SRC_TUTUP = readFileSync(
  new URL('../src/renderer/components/TutupTab.tsx', import.meta.url),
  'utf8',
);

const dbTerbuka: Database.Database[] = [];

function dbKosong(): Database.Database {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  return db;
}

function catatPendapatan(db: Database.Database, tahun: number): void {
  const baris: JurnalBarisInput[] = [
    { akun_kode: '1001', debit: 1_000_000, kredit: 0 },
    { akun_kode: '4005', debit: 0, kredit: 1_000_000 },
  ];
  insertJurnalTervalidasi(
    db,
    {
      id: `j-db28-${tahun}`,
      tanggal: `${tahun}-03-01`,
      no_bukti: `JU-DB28-${tahun}`,
      keterangan: `Pendapatan uji ${tahun}`,
      jenis: 'UMUM',
    },
    baris,
  );
}

afterEach(() => {
  for (const db of dbTerbuka.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup */
    }
  }
});

describe('DB-28 — tutup buku tanpa backup_path', () => {
  it('skema tutup_buku hanya berisi tahun, created_at, dan catatan', () => {
    const db = dbKosong();
    const kolom = (db.pragma('table_info(tutup_buku)') as { name: string }[]).map(
      (k) => k.name,
    );
    expect(kolom).toEqual(['tahun', 'created_at', 'catatan']);
    expect(kolom).not.toContain('backup_path');
  });

  it('tutup baru menyimpan catatan; audit baru tidak memuat backup_path', () => {
    const db = dbKosong();
    catatPendapatan(db, 2025);

    const hasil = tutupBuku(db, 2025, {
      sekarang: '2026-10-22',
      catatan: 'Sudah diperiksa',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.data).not.toHaveProperty('backup_path');

    const fisik = db
      .prepare('SELECT tahun, created_at, catatan FROM tutup_buku WHERE tahun = 2025')
      .get() as { tahun: number; created_at: string; catatan: string };
    expect(fisik.tahun).toBe(2025);
    expect(fisik.catatan).toBe('Sudah diperiksa');

    const audit = listAuditLog(db).find((a) => a.aksi === 'TUTUP 2025');
    expect(audit).toBeDefined();
    expect(audit!.data_baru_json).not.toContain('backup_path');
    expect(listTutupBuku(db)[0]).not.toHaveProperty('backup_path');

    // Tipe publik juga tidak mengizinkan field legacy.
    const contoh: TutupBuku = {
      tahun: 2025,
      created_at: '2026-01-01T00:00:00.000Z',
      catatan: '',
    };
    // @ts-expect-error DB-28: backup_path bukan bagian kontrak TutupBuku.
    const terlarang: TutupBuku = { ...contoh, backup_path: '/backup/baru.db' };
    void terlarang;
  });

  it('tutup ulang memperbarui catatan tanpa kolom legacy', () => {
    const db = dbKosong();
    insertTutupBuku(db, {
      tahun: 2024,
      created_at: '2025-01-01T00:00:00.000Z',
      catatan: 'Lama',
    });

    insertTutupBuku(db, {
      tahun: 2024,
      created_at: '2026-01-01T00:00:00.000Z',
      catatan: 'Diperbarui',
    });

    expect(listTutupBuku(db)).toEqual([
      {
        tahun: 2024,
        created_at: '2026-01-01T00:00:00.000Z',
        catatan: 'Diperbarui',
      },
    ]);
  });
});

describe('DB-28 — pengaturan tanpa awal tahun buku', () => {
  it('nilai lama non-Januari tetap terbaca tanpa auto-rewrite', () => {
    const db = dbKosong();
    setPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN, '7');

    const lama = getPengaturanPembukuan(db);
    expect(lama.awalTahunBuku).toBe(7);
    expect(pengaturanPublik(lama)).not.toHaveProperty('awalTahunBuku');
    expect(getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN)).toBe('7');
  });

  it('save dari kontrak publik menulis Januari; input legacy tetap diabaikan', () => {
    const db = dbKosong();
    setPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN, '7');
    const publik = pengaturanPublik(getPengaturanPembukuan(db));

    const bentuk = validasiBentukPengaturanPembukuan(publik);
    expect(bentuk.ok).toBe(true);
    if (!bentuk.ok) return;
    expect(bentuk.input).not.toHaveProperty('awalTahunBuku');

    const hasil = simpanPengaturanPembukuan(db, bentuk.input);
    expect(hasil.awalTahunBuku).toBe(1);
    expect(getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN)).toBe('1');
    expect(getPengaturanPembukuan(db)).toEqual(DEFAULT_PENGATURAN);

    // Renderer lama yang masih mengirim 7 juga tidak lagi menyimpan 7.
    const legacy = validasiBentukPengaturanPembukuan({
      ...DEFAULT_PENGATURAN,
      awalTahunBuku: 7,
      namaEntitas: 'PURA UJI',
    });
    expect(legacy.ok).toBe(true);
    if (!legacy.ok) return;
    expect(legacy.input).not.toHaveProperty('awalTahunBuku');
    expect(simpanPengaturanPembukuan(db, legacy.input).awalTahunBuku).toBe(1);
    expect(getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN)).toBe('1');
  });

  it('UI Pengaturan tidak menampilkan field/peringatan awal tahun buku', () => {
    const html = renderToStaticMarkup(
      createElement(PengaturanTab, {
        idleAwal: 30,
        kodeDaruratDiatur: true,
        onIdleBerubah: () => undefined,
        modeLanjutan: false,
        onModeLanjutanBerubah: () => undefined,
      }),
    );
    expect(html).toContain('Pengaturan Pembukuan');
    expect(SRC_PENGATURAN).toContain('Tanggal mulai pembukuan');
    expect(html).not.toContain('Awal tahun buku');
    expect(html).not.toContain('Tahun buku fiskal');
    expect(html).not.toContain('bulan 7');

    // Form dirender setelah load (effect tidak jalan di SSR), jadi pastikan
    // sumber komponen juga tidak lagi memuat field/peringatan legacy.
    expect(SRC_PENGATURAN).not.toMatch(/Awal tahun buku|Tahun buku fiskal/);
    expect(SRC_PENGATURAN).not.toMatch(
      /BidangAwalTahunBuku|PeringatanAwalTahunBuku|awalTahunBuku|awalTersimpan/,
    );
  });
});

describe('DB-28 — riwayat tutup buku tanpa kolom Backup', () => {
  it('header riwayat hanya Tahun, Laba, dan Catatan', () => {
    const html = renderToStaticMarkup(createElement(TutupTab));
    expect(html).toContain('>Tahun</th>');
    expect(html).toContain('>Laba</th>');
    expect(html).toContain('>Catatan</th>');
    expect(html).not.toContain('>Backup</th>');
    expect(html).not.toContain('backup_path');
    expect(SRC_TUTUP).not.toContain('backup_path');
    expect(SRC_TUTUP).not.toContain('backupPath');
    expect(SRC_TUTUP).not.toContain('t.backup');
  });
});
