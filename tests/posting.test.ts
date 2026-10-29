// P0-4: integrasi posting layer dengan SQLite.
// Fokus: satu pintu simpan jurnal, index no_bukti unik parsial, peringatan kas
// minus butuh konfirmasi, kunci periode, dan akun nonaktif.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { postingJurnal, postingSaldoAwal, validasiJurnalDb } from '../src/db/posting.js';
import {
  getJurnalDetail,
  insertJurnal,
  listAuditLog,
  listJurnal,
} from '../src/db/repository.js';
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
  it('menyimpan jurnal seimbang dan menyediakan index no_bukti unik per tahun', () => {
    const { db } = freshDb();
    try {
      const idx = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_no_bukti_tahun'",
        )
        .get() as { sql: string } | undefined;
      expect(idx, 'index no_bukti per tahun harus ada').toBeTruthy();
      expect(idx!.sql).toMatch(/UNIQUE INDEX/);
      expect(idx!.sql).toMatch(/substr\(tanggal,\s*1,\s*4\)/);
      expect(idx!.sql).toMatch(/COLLATE NOCASE/);
      expect(idx!.sql).toMatch(/WHERE no_bukti <> ''/);
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_no_bukti'",
          )
          .get(),
        'index global lama harus sudah dibuang',
      ).toBeUndefined();

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

  it('menolak akun legacy 3001/3002 di semua pintu, tetapi 3000 tetap boleh', () => {
    const { db } = freshDb();
    try {
      for (const kode of ['3001', '3002']) {
        const input = { header: header(), baris: pasangan('1001', kode) };

        const validasi = validasiJurnalDb(db, input);
        expect(validasi.boleh).toBe(false);
        expect(validasi.errors.join(' ')).toContain(kode);
        expect(validasi.errors.join(' ')).toMatch(/legacy/i);
        expect(validasi.errors.join(' ')).toMatch(/tidak boleh diposting/i);

        expect(postingJurnal(db, input).tersimpan).toBe(false);
        expect(() => insertJurnal(db, input.header, input.baris)).toThrow(
          /tidak boleh diposting/,
        );
      }
      expect(jumlahJurnal(db)).toBe(0);

      // 3000 MODAL tetap sah untuk setoran modal/saldo awal.
      const modal = postingJurnal(db, {
        header: header({ keterangan: 'Setoran modal', jenis: 'SALDO_AWAL' }),
        baris: pasangan('1001', '3000'),
      });
      expect(modal.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(1);
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

describe('AUD-10 — peringatan kas minus memakai saldo per tanggal jurnal', () => {
  it('pengeluaran backdate dievaluasi dengan saldo tanggalnya, bukan saldo masa depan', () => {
    const { db } = freshDb();
    try {
      // Kas Februari Rp 1.000; kas 15 Januari masih 0.
      const feb = postingJurnal(db, {
        header: header({
          id: 'j-feb',
          tanggal: '2026-02-01',
          no_bukti: 'JU-2026-0002',
          keterangan: 'Penerimaan Februari',
        }),
        baris: pasangan('1001', '4005', 100_000),
      });
      expect(feb.tersimpan).toBe(true);

      const backdate = {
        header: header({
          id: 'j-jan',
          tanggal: '2026-01-15',
          no_bukti: 'JU-2026-0003',
          keterangan: 'Pengeluaran backdate',
          jenis: 'BAYAR' as const,
        }),
        baris: pasangan('5000', '1001', 20_000),
      };

      const validasi = validasiJurnalDb(db, backdate);
      expect(validasi.boleh).toBe(true);
      expect(validasi.peringatan.join(' ')).toMatch(/akan minus/);

      const belum = postingJurnal(db, backdate);
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(1);

      const lanjut = postingJurnal(db, backdate, { konfirmasiPeringatan: true });
      expect(lanjut.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('transaksi maju normal tetap tanpa peringatan palsu', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, {
          header: header({ id: 'j-modal', no_bukti: 'JU-2026-0010', keterangan: 'Modal awal' }),
          baris: pasangan('1001', '3000', 100_000),
        }).tersimpan,
      ).toBe(true);

      const maju = postingJurnal(db, {
        header: header({
          id: 'j-maju',
          tanggal: '2026-01-15',
          no_bukti: 'JU-2026-0011',
          keterangan: 'Bayar listrik',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 20_000),
      });
      expect(maju.errors).toEqual([]);
      expect(maju.peringatan).toEqual([]);
      expect(maju.perluKonfirmasi).toBe(false);
      expect(maju.tersimpan).toBe(true);
    } finally {
      db.close();
    }
  });

  it('saldo dihitung per akun kas, bukan total semua dompet', () => {
    const { db } = freshDb();
    try {
      // Bank 1029 punya saldo, kas 1001 tidak.
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-bank',
            no_bukti: 'JU-2026-0020',
            keterangan: 'Penerimaan via bank',
          }),
          baris: pasangan('1029', '4005', 100_000),
        }).tersimpan,
      ).toBe(true);

      const hasil = validasiJurnalDb(db, {
        header: header({
          id: 'j-kas',
          tanggal: '2026-01-20',
          no_bukti: 'JU-2026-0021',
          keterangan: 'Bayar dari kas',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 20_000),
      });
      expect(hasil.boleh).toBe(true);
      expect(hasil.peringatan.join(' ')).toMatch(/Kas\/Bank 1001/);
    } finally {
      db.close();
    }
  });
});

describe('AKT-01 — jurnal pertama wajib saldo awal / konfirmasi', () => {
  const PESAN_WAJIB_SALDO_AWAL =
    'Belum ada saldo awal. Isi Wizard Saldo Awal dulu, atau konfirmasi mulai tanpa saldo awal.';

  it('menolak jurnal normal pertama tanpa konfirmasi dan tidak menulis jurnal/audit', () => {
    const { db } = freshDb();
    try {
      const hasil = postingJurnal(
        db,
        { header: header(), baris: pasangan() },
        { wajibSaldoAwal: true },
      );

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors).toEqual([PESAN_WAJIB_SALDO_AWAL]);
      expect(jumlahJurnal(db)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get()).toEqual({ c: 0 });
      // Guard berjalan di transaksi yang sama; gagal berarti audit pun tidak ditulis.
      expect(listAuditLog(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('menyimpan jurnal pertama bila operator memilih mulai tanpa saldo awal', () => {
    const { db } = freshDb();
    try {
      const hasil = postingJurnal(
        db,
        { header: header(), baris: pasangan() },
        { wajibSaldoAwal: true, konfirmasiTanpaSaldoAwal: true },
      );

      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('mengizinkan jurnal berikutnya setelah saldo awal, dan saldo awal sendiri tidak terkena guard', () => {
    const { db } = freshDb();
    try {
      const saldoAwal = postingSaldoAwal(
        db,
        {
          header: header({
            id: 'j-saldo-awal',
            tanggal: '2026-01-01',
            no_bukti: 'SA-2026-0001',
            keterangan: 'Saldo awal pembukuan',
            jenis: 'SALDO_AWAL',
          }),
          baris: pasangan('1001', '3000', 1_000_000),
        },
        { wajibSaldoAwal: true },
      );
      expect(saldoAwal.tersimpan, saldoAwal.errors.join(' ')).toBe(true);

      const berikutnya = postingJurnal(
        db,
        {
          header: header({ id: 'j-setelah-saldo-awal', no_bukti: 'JU-2026-0001' }),
          baris: pasangan('1029', '4005'),
        },
        { wajibSaldoAwal: true },
      );
      expect(berikutnya.tersimpan, berikutnya.errors.join(' ')).toBe(true);
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
