// P0-4: integrasi posting layer dengan SQLite.
// Fokus: satu pintu simpan jurnal, index no_bukti unik parsial, peringatan kas
// minus butuh konfirmasi, kunci periode, dan akun nonaktif.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { postingJurnal, validasiJurnalDb } from '../src/db/posting.js';
import { getJurnalDetail, insertJurnal, listJurnal } from '../src/db/repository.js';
import type { JurnalBarisInput, JurnalHeaderInput } from '../src/core/types.js';

const dirs: string[] = [];

function freshDb(): { dir: string; db: ReturnType<typeof openDb> } {
  const dir = mkdtempSync(join(tmpdir(), 'pura-posting-'));
  dirs.push(dir);
  return { dir, db: openDb(join(dir, 'pura.db')) };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function header(over: Partial<JurnalHeaderInput> = {}): JurnalHeaderInput {
  return {
    id: 'j-uji',
    tanggal: '2026-01-02',
    keterangan: 'Terima uang parkir',
    no_bukti: 'JU-2026-0001',
    ...over,
  };
}

function pasangan(debit = '1001', kredit = '4005', nominal = 100_000): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

function jumlahJurnal(db: ReturnType<typeof openDb>): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM jurnal').get() as { c: number }).c;
}

describe('P0-4 — satu pintu posting jurnal', () => {
  it('menyimpan jurnal seimbang dan menyediakan index no_bukti unik parsial', () => {
    const { db } = freshDb();
    try {
      const idx = db
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_no_bukti'")
        .get() as { sql: string } | undefined;
      expect(idx, 'index no_bukti harus ada').toBeTruthy();
      expect(idx!.sql).toMatch(/UNIQUE INDEX/);
      expect(idx!.sql).toMatch(/WHERE no_bukti <> ''/);

      const hasil = postingJurnal(db, { header: header(), baris: pasangan() });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.errors).toEqual([]);
      expect(hasil.peringatan).toEqual([]);
      expect(hasil.jurnal).toMatchObject({
        id: 'j-uji',
        no_bukti: 'JU-2026-0001',
        tanggal: '2026-01-02',
      });

      const detail = getJurnalDetail(db, 'j-uji');
      expect(detail?.baris).toHaveLength(2);
      expect(detail?.baris[0]).toMatchObject({ akun_kode: '1001', debit: 100_000 });
      expect(detail?.baris[1]).toMatchObject({ akun_kode: '4005', kredit: 100_000 });
    } finally {
      db.close();
    }
  });

  it('menolak jurnal tidak seimbang / tanggal 31 Feb dan tidak menulis baris apa pun', () => {
    const { db } = freshDb();
    try {
      const tidakSeimbang = postingJurnal(db, {
        header: header({ id: 'j-salah' }),
        baris: [
          { akun_kode: '1001', debit: 100_000, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 90_000 },
        ],
      });
      expect(tidakSeimbang.tersimpan).toBe(false);
      expect(tidakSeimbang.errors.join(' ')).toMatch(/tidak seimbang/);

      const tanggalSalah = postingJurnal(db, {
        header: header({ id: 'j-tanggal', tanggal: '2026-02-31' }),
        baris: pasangan(),
      });
      expect(tanggalSalah.tersimpan).toBe(false);
      expect(tanggalSalah.errors.join(' ')).toMatch(/Tanggal tidak valid/);

      expect(jumlahJurnal(db)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get()).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('menolak nomor bukti duplikat (case-insensitive) lewat validasi, repository, dan index', () => {
    const { db } = freshDb();
    try {
      expect(postingJurnal(db, { header: header(), baris: pasangan() }).tersimpan).toBe(true);

      const duplikat = postingJurnal(db, {
        header: header({ id: 'j-kedua', no_bukti: 'ju-2026-0001' }),
        baris: pasangan('1029', '4005'),
      });
      expect(duplikat.tersimpan).toBe(false);
      expect(duplikat.errors.join(' ')).toMatch(/sudah dipakai/);
      expect(jumlahJurnal(db)).toBe(1);

      expect(() =>
        insertJurnal(db, header({ id: 'j-ketiga' }), pasangan('1029', '4005')),
      ).toThrow(/sudah dipakai/);

      // Penjaga terakhir: INSERT mentah tetap ditolak unique index parsial.
      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('j-mentah', '2026-01-03', 'JU-2026-0001', 'Duplikat mentah', 'UMUM', 'j-mentah', '2026-01-03T00:00:00.000Z'),
      ).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('mengizinkan beberapa jurnal draft tanpa no_bukti', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, { header: header({ id: 'j-a', no_bukti: '' }), baris: pasangan() }).tersimpan,
      ).toBe(true);
      expect(
        postingJurnal(db, { header: header({ id: 'j-b', no_bukti: '' }), baris: pasangan('1029', '4005') })
          .tersimpan,
      ).toBe(true);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('menolak akun nonaktif baik lewat posting layer maupun repository', () => {
    const { db } = freshDb();
    try {
      db.prepare("UPDATE akun SET aktif = 0 WHERE kode = '4005'").run();

      const hasil = validasiJurnalDb(db, { header: header(), baris: pasangan() });
      expect(hasil.boleh).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/sudah tidak aktif/);

      expect(postingJurnal(db, { header: header(), baris: pasangan() }).tersimpan).toBe(false);
      expect(() => insertJurnal(db, header(), pasangan())).toThrow(/tidak aktif/);
      expect(jumlahJurnal(db)).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('P0-4 — peringatan kas minus', () => {
  it('menahan simpan sampai operator mengonfirmasi, lalu menyimpan', () => {
    const { db } = freshDb();
    try {
      const awal = postingJurnal(db, {
        header: header({
          id: 'j-modal',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Saldo awal kas',
          jenis: 'SALDO_AWAL',
        }),
        baris: pasangan('1001', '3000', 100_000),
      });
      expect(awal.tersimpan).toBe(true);

      const bayar = {
        header: header({
          id: 'j-bayar',
          no_bukti: 'JU-2026-0002',
          keterangan: 'Bayar listrik',
          jenis: 'BAYAR' as const,
        }),
        baris: pasangan('5000', '1001', 150_000),
      };

      const belumKonfirmasi = postingJurnal(db, bayar);
      expect(belumKonfirmasi.tersimpan).toBe(false);
      expect(belumKonfirmasi.errors).toEqual([]);
      expect(belumKonfirmasi.perluKonfirmasi).toBe(true);
      expect(belumKonfirmasi.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(1);

      const dikonfirmasi = postingJurnal(db, bayar, { konfirmasiPeringatan: true });
      expect(dikonfirmasi.tersimpan).toBe(true);
      expect(dikonfirmasi.peringatan).toHaveLength(1);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe('P0-4 — kunci periode via DB', () => {
  it('menolak tanggal periode tutup tanpa alasan, menerima dengan alasan', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        'INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan) VALUES (?, ?, ?, ?)',
      ).run(2025, '2026-01-01T00:00:00.000Z', '', 'Uji kunci');

      const koreksi = {
        header: header({
          id: 'j-koreksi',
          tanggal: '2025-12-31',
          no_bukti: 'JU-2025-0001',
          keterangan: 'Koreksi Desember',
        }),
        baris: pasangan('1001', '4005', 10_000),
      };

      const tanpaAlasan = postingJurnal(db, koreksi);
      expect(tanpaAlasan.tersimpan).toBe(false);
      expect(tanpaAlasan.errors.join(' ')).toMatch(/Periode sudah ditutup/);

      const denganAlasan = postingJurnal(db, { ...koreksi, alasan: 'Koreksi struk Desember' });
      expect(denganAlasan.tersimpan).toBe(true);
      expect(denganAlasan.jurnal?.tanggal).toBe('2025-12-31');
    } finally {
      db.close();
    }
  });

  it('tidak mengunci tahun berjalan setelah tutup 2025', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        'INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan) VALUES (?, ?, ?, ?)',
      ).run(2025, '2026-01-01T00:00:00.000Z', '', '');

      const hasil = postingJurnal(db, {
        header: header({ id: 'j-2026', tanggal: '2026-01-01', no_bukti: 'JU-2026-0009' }),
        baris: pasangan('1001', '4005', 10_000),
      });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.errors).toEqual([]);
    } finally {
      db.close();
    }
  });
});
