// Akun tambahan (BEBAN/PENDAPATAN) — master COA dari DB, bukan kode statis.
// Fokus: penambahan akun, validasi kode/nama, dan pemakaian akun baru di
// posting + laporan tanpa mengubah COA statis.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  getAkun,
  hapusAkun,
  insertJurnalTervalidasi,
  listAkun,
  listAuditLog,
  setAkunAktif,
  tambahAkun,
  ubahNamaAkun,
} from '../src/db/repository.js';
import { postingJurnal, validasiJurnalDb } from '../src/db/posting.js';
import { laporanLabaRugi, laporanNeraca, laporanNeracaSaldo } from '../src/db/laporan.js';
import { akunBolehDiposting, COA } from '../src/db/coa.js';

const RP = (rupiah: number): number => rupiah * 100;

const dirs: string[] = [];

function freshDb(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), 'pura-akun-'));
  dirs.push(dir);
  return openDb(join(dir, 'pura.db'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Tambah akun COA', () => {
  it('menyimpan akun BEBAN/PENDAPATAN dan menulis audit', () => {
    const db = freshDb();
    try {
      const beban = tambahAkun(db, {
        kode: '5011',
        nama: 'PENGELUARAN ARTOS',
        tipe: 'BEBAN',
      });
      expect(beban).toMatchObject({
        kode: '5011',
        nama: 'PENGELUARAN ARTOS',
        tipe: 'BEBAN',
        posisi_normal: 'DEBIT',
        aktif: true,
      });

      const pendapatan = tambahAkun(db, {
        kode: '4043',
        nama: 'PENDAPATAN WEWEDALAN',
        tipe: 'PENDAPATAN',
      });
      expect(pendapatan).toMatchObject({
        kode: '4043',
        posisi_normal: 'KREDIT',
      });

      expect(getAkun(db, '5011')?.nama).toBe('PENGELUARAN ARTOS');
      expect(listAkun(db).some((a) => a.kode === '4043')).toBe(true);
      expect(listAuditLog(db).some((a) => a.aksi === 'AKUN-TAMBAH 5011')).toBe(true);

      // COA statis tidak berubah; akun tambahan hanya ada di master DB.
      expect(COA.some((a) => a.kode === '5011')).toBe(false);
      expect(akunBolehDiposting('5011')).toBe(false);
      expect(akunBolehDiposting('5011', true, { dikenal: true })).toBe(true);
    } finally {
      db.close();
    }
  });

  it('menolak kode ganda, nama ganda, prefix salah, dan tipe di luar BEBAN/PENDAPATAN', () => {
    const db = freshDb();
    try {
      tambahAkun(db, { kode: '5011', nama: 'PENGELUARAN ARTOS', tipe: 'BEBAN' });

      expect(() =>
        tambahAkun(db, { kode: '5011', nama: 'ARTOS LAIN', tipe: 'BEBAN' }),
      ).toThrow(/sudah dipakai/i);
      expect(() =>
        tambahAkun(db, { kode: '5012', nama: 'pengeluaran artos', tipe: 'BEBAN' }),
      ).toThrow(/sudah dipakai/i);
      expect(() =>
        tambahAkun(db, { kode: '4043', nama: 'SALAH PREFIX', tipe: 'BEBAN' }),
      ).toThrow(/5xxx/i);
      expect(() =>
        tambahAkun(db, { kode: '5012', nama: 'BUKAN TIPE', tipe: 'AKTIVA' as never }),
      ).toThrow(/BEBAN atau PENDAPATAN/i);
    } finally {
      db.close();
    }
  });

  it('menolak ubah nama yang bentrok tanpa membedakan huruf besar/kecil', () => {
    const db = freshDb();
    try {
      tambahAkun(db, { kode: '5011', nama: 'PENGELUARAN ARTOS', tipe: 'BEBAN' });
      tambahAkun(db, { kode: '5012', nama: 'AKUN KEDUA', tipe: 'BEBAN' });

      expect(() => ubahNamaAkun(db, '5012', 'pengeluaran artos')).toThrow(/sudah dipakai/i);
      expect(getAkun(db, '5012')?.nama).toBe('AKUN KEDUA');

      // Rename valid tetap berjalan; constraint DB tidak mengganggu akun sah.
      expect(ubahNamaAkun(db, '5012', 'AKUN KEDUA BARU').nama).toBe('AKUN KEDUA BARU');
    } finally {
      db.close();
    }
  });

  it('mengubah nama, menonaktifkan, dan mengaktifkan lagi akun tambahan', () => {
    const db = freshDb();
    try {
      tambahAkun(db, { kode: '5011', nama: 'PENGELUARAN ARTOS', tipe: 'BEBAN' });

      const ubah = ubahNamaAkun(db, '5011', 'PENGELUARAN ARTOS BARU');
      expect(ubah.nama).toBe('PENGELUARAN ARTOS BARU');
      expect(listAuditLog(db).some((a) => a.aksi === 'AKUN-UBAH 5011')).toBe(true);

      const off = setAkunAktif(db, '5011', false);
      expect(off.aktif).toBe(false);
      expect(listAuditLog(db).some((a) => a.aksi === 'AKUN-NONAKTIF 5011')).toBe(true);

      const validasi = validasiJurnalDb(db, {
        header: {
          id: 'j-nonaktif',
          tanggal: '2026-02-01',
          keterangan: 'Coba akun nonaktif',
          jenis: 'BAYAR',
        },
        baris: [
          { akun_kode: '5011', debit: RP(10_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(10_000) },
        ],
      });
      expect(validasi.errors.join(' ')).toMatch(/tidak aktif/i);

      const on = setAkunAktif(db, '5011', true);
      expect(on.aktif).toBe(true);
      expect(listAuditLog(db).some((a) => a.aksi === 'AKUN-AKTIF 5011')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('hapus hanya untuk akun yang belum dipakai; akun bekas jurnal harus dinonaktifkan', () => {
    const db = freshDb();
    try {
      tambahAkun(db, { kode: '5012', nama: 'AKUN BELUM DIPAKAI', tipe: 'BEBAN' });
      expect(hapusAkun(db, '5012')).toEqual({ kode: '5012' });
      expect(getAkun(db, '5012')).toBeNull();

      tambahAkun(db, { kode: '5013', nama: 'AKUN SUDAH DIPAKAI', tipe: 'BEBAN' });
      insertJurnalTervalidasi(
        db,
        { id: 'awal', tanggal: '2026-01-01', keterangan: 'Saldo awal' },
        [
          { akun_kode: '1001', debit: RP(1_000_000), kredit: 0 },
          { akun_kode: '3000', debit: 0, kredit: RP(1_000_000) },
        ],
      );
      const posting = postingJurnal(db, {
        header: {
          id: 'j-pakai',
          tanggal: '2026-02-01',
          keterangan: 'Pakai akun 5013',
          jenis: 'BAYAR',
        },
        baris: [
          { akun_kode: '5013', debit: RP(50_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(50_000) },
        ],
      });
      expect(posting.tersimpan).toBe(true);

      expect(() => hapusAkun(db, '5013')).toThrow(/nonaktifkan/i);
      const off = setAkunAktif(db, '5013', false);
      expect(off.aktif).toBe(false);

      // Histori tetap ada dan tetap masuk laporan.
      const lr = laporanLabaRugi(db, { mulai: '2026-01-01', sampai: '2026-12-31' });
      expect(lr.beban.find((r) => r.kode === '5013')?.nominal).toBe(RP(50_000));
    } finally {
      db.close();
    }
  });

  it('menolak ubah/nonaktif/hapus akun bawaan', () => {
    const db = freshDb();
    try {
      expect(() => ubahNamaAkun(db, '5010', 'UBAH BAWAAN')).toThrow(/bawaan/i);
      expect(() => setAkunAktif(db, '5010', false)).toThrow(/bawaan/i);
      expect(() => hapusAkun(db, '5010')).toThrow(/bawaan/i);
    } finally {
      db.close();
    }
  });

  it('akun tambahan bisa dipakai posting dan muncul di Laba Rugi', () => {
    const db = freshDb();
    try {
      tambahAkun(db, { kode: '5011', nama: 'PENGELUARAN ARTOS', tipe: 'BEBAN' });
      tambahAkun(db, { kode: '4043', nama: 'PENDAPATAN WEWEDALAN', tipe: 'PENDAPATAN' });

      insertJurnalTervalidasi(
        db,
        { id: 'awal', tanggal: '2026-01-01', keterangan: 'Saldo awal' },
        [
          { akun_kode: '1001', debit: RP(10_000_000), kredit: 0 },
          { akun_kode: '3000', debit: 0, kredit: RP(10_000_000) },
        ],
      );

      const beban = postingJurnal(db, {
        header: {
          id: 'j-artos',
          tanggal: '2026-02-01',
          keterangan: 'Bayar artos',
          jenis: 'BAYAR',
        },
        baris: [
          { akun_kode: '5011', debit: RP(250_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(250_000) },
        ],
      });
      expect(beban.errors).toEqual([]);
      expect(beban.tersimpan).toBe(true);

      const pendapatan = postingJurnal(db, {
        header: {
          id: 'j-wewedalan',
          tanggal: '2026-02-02',
          keterangan: 'Terima wewedalan',
          jenis: 'TERIMA',
        },
        baris: [
          { akun_kode: '1001', debit: RP(400_000), kredit: 0 },
          { akun_kode: '4043', debit: 0, kredit: RP(400_000) },
        ],
      });
      expect(pendapatan.errors).toEqual([]);
      expect(pendapatan.tersimpan).toBe(true);

      const lr = laporanLabaRugi(db, { mulai: '2026-01-01', sampai: '2026-12-31' });
      expect(lr.pendapatan.find((r) => r.kode === '4043')?.nominal).toBe(RP(400_000));
      expect(lr.beban.find((r) => r.kode === '5011')?.nominal).toBe(RP(250_000));

      const ns = laporanNeracaSaldo(db, '2026-12-31', 'kumulatif');
      expect(ns.seimbang).toBe(true);
      expect(ns.rows.some((r) => r.kode === '5011')).toBe(true);
      expect(ns.rows.some((r) => r.kode === '4043')).toBe(true);

      const n = laporanNeraca(db, '2026-12-31');
      expect(n.balance).toBe(true);
      expect(n.selisih).toBe(0);
    } finally {
      db.close();
    }
  });
});
