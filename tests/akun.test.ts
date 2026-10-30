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
  kodeKasAktifDb,
  kodeKasDariDb,
  listAkun,
  listAuditLog,
  listJurnalLengkap,
  setAkunAktif,
  tambahAkun,
  ubahNamaAkun,
} from '../src/db/repository.js';
import { postingJurnal, validasiJurnalDb } from '../src/db/posting.js';
import {
  laporanArusKas,
  laporanBukuBesar,
  laporanLabaRugi,
  laporanNeraca,
  laporanNeracaSaldo,
  listBarisJurnal,
} from '../src/db/laporan.js';
import {
  AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF,
  akunBolehDiposting,
  COA,
} from '../src/db/coa.js';
import { totalKas } from '../src/core/reports.js';

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
        tambahAkun(db, { kode: '5012', nama: 'BUKAN TIPE', tipe: 'EKUITAS' as never }),
      ).toThrow(/BEBAN, PENDAPATAN, atau AKTIVA/i);
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

  it('menolak ubah nama/hapus akun bawaan, tetapi status aktifnya boleh diubah', () => {
    const db = freshDb();
    try {
      expect(() => ubahNamaAkun(db, '5010', 'UBAH BAWAAN')).toThrow(/bawaan/i);
      expect(() => hapusAkun(db, '5010')).toThrow(/bawaan/i);
      // DB-15: nonaktif akun bawaan non-sistem diizinkan (soft delete).
      expect(setAkunAktif(db, '5010', false).aktif).toBe(false);
      expect(getAkun(db, '5010')?.nama).toBe(
        'BAGA SUAR (TELPON, LISTRIK, PDAM)',
      );
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

describe('DB-15 — nonaktifkan akun bawaan tanpa menghapus histori', () => {
  it('5010 bisa dinonaktifkan, hilang dari daftar aktif, tetapi histori/laporan tetap', () => {
    const db = freshDb();
    try {
      insertJurnalTervalidasi(
        db,
        { id: 'awal-15', tanggal: '2026-01-01', keterangan: 'Saldo awal' },
        [
          { akun_kode: '1001', debit: RP(10_000_000), kredit: 0 },
          { akun_kode: '3000', debit: 0, kredit: RP(10_000_000) },
        ],
      );
      const posting = postingJurnal(db, {
        header: {
          id: 'j-5010',
          tanggal: '2026-02-01',
          keterangan: 'Bayar listrik sebelum akun dinonaktifkan',
          jenis: 'BAYAR',
        },
        baris: [
          { akun_kode: '5010', debit: RP(250_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(250_000) },
        ],
      });
      expect(posting.errors).toEqual([]);
      expect(posting.tersimpan).toBe(true);

      const off = setAkunAktif(db, '5010', false, 'Digantikan akun 5060');
      expect(off).toMatchObject({
        kode: '5010',
        nama: 'BAGA SUAR (TELPON, LISTRIK, PDAM)',
        aktif: false,
        sumber: 'BAWAAN',
      });

      // Soft delete: baris akun tetap ada, hanya tidak masuk dropdown aktif.
      expect(getAkun(db, '5010')).not.toBeNull();
      expect(listAkun(db, { aktif: true }).some((a) => a.kode === '5010')).toBe(false);
      expect(listAkun(db, { aktif: false }).some((a) => a.kode === '5010')).toBe(true);

      // Posting baru ke akun nonaktif ditolak; histori tidak berubah.
      const validasi = validasiJurnalDb(db, {
        header: {
          id: 'j-5010-baru',
          tanggal: '2026-03-01',
          keterangan: 'Coba posting akun nonaktif',
          jenis: 'BAYAR',
        },
        baris: [
          { akun_kode: '5010', debit: RP(10_000), kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: RP(10_000) },
        ],
      });
      expect(validasi.errors.join(' ')).toMatch(/tidak aktif/i);

      // Audit menyimpan aksi, alasan, dan kondisi lama/baru; append-only.
      const audit = listAuditLog(db).find((a) => a.aksi === 'AKUN-NONAKTIF 5010');
      expect(audit).toBeDefined();
      expect(audit?.alasan).toBe('Digantikan akun 5060');
      expect(audit?.data_lama_json).toContain('"aktif":true');
      expect(audit?.data_baru_json).toContain('"aktif":false');
      expect(() =>
        db
          .prepare('UPDATE audit_log SET alasan = ? WHERE id = ?')
          .run('ubah audit', audit!.id),
      ).toThrow(/tidak boleh diubah/i);
      expect(() =>
        db.prepare('DELETE FROM audit_log WHERE id = ?').run(audit!.id),
      ).toThrow(/tidak boleh dihapus/i);

      // Laporan historis tetap memakai akun nonaktif dan saldonya.
      const lr = laporanLabaRugi(db, { mulai: '2026-01-01', sampai: '2026-12-31' });
      expect(lr.beban.find((r) => r.kode === '5010')?.nominal).toBe(RP(250_000));

      const ns = laporanNeracaSaldo(db, '2026-12-31', 'kumulatif');
      expect(ns.rows.some((r) => r.kode === '5010')).toBe(true);

      const bb = laporanBukuBesar(db, '5010', { sampai: '2026-12-31' });
      expect(bb).toMatchObject({
        kode: '5010',
        nama: 'BAGA SUAR (TELPON, LISTRIK, PDAM)',
        totalDebit: RP(250_000),
      });

      expect(
        listJurnalLengkap(db, { akun_kode: '5010' }).some((j) => j.id === 'j-5010'),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  it('menolak nonaktif akun sistem 3000/1040/1050/2050 dengan pesan Indonesia', () => {
    const db = freshDb();
    try {
      expect([...AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF].sort()).toEqual([
        '1040',
        '1050',
        '2050',
        '3000',
      ]);

      for (const kode of ['3000', '1040', '1050', '2050']) {
        expect(() => setAkunAktif(db, kode, false)).toThrow(/akun sistem/i);
        expect(getAkun(db, kode)?.aktif, `akun ${kode} tetap aktif`).toBe(true);
      }

      // DB lama yang terlanjur membawa akun sistem nonaktif tetap bisa dipulihkan.
      db.prepare("UPDATE akun SET aktif = 0 WHERE kode = '3000'").run();
      expect(setAkunAktif(db, '3000', true).aktif).toBe(true);
      expect(listAuditLog(db).some((a) => a.aksi === 'AKUN-AKTIF 3000')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('status nonaktif akun bawaan bertahan setelah reopen dan bisa diaktifkan lagi', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-akun-bawaan-'));
    try {
      const path = join(dir, 'pura.db');
      let db = openDb(path);
      setAkunAktif(db, '5010', false, 'Digantikan akun 5060');
      db.close();

      db = openDb(path);
      try {
        expect(getAkun(db, '5010')).toMatchObject({
          kode: '5010',
          nama: 'BAGA SUAR (TELPON, LISTRIK, PDAM)',
          aktif: false,
          sumber: 'BAWAAN',
        });
        expect(listAkun(db, { aktif: true }).some((a) => a.kode === '5010')).toBe(false);

        const on = setAkunAktif(db, '5010', true, 'Dipakai lagi');
        expect(on.aktif).toBe(true);
        expect(listAkun(db, { aktif: true }).some((a) => a.kode === '5010')).toBe(true);

        const audit = listAuditLog(db).find((a) => a.aksi === 'AKUN-AKTIF 5010');
        expect(audit?.alasan).toBe('Dipakai lagi');
        expect(audit?.data_lama_json).toContain('"aktif":false');
        expect(audit?.data_baru_json).toContain('"aktif":true');
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('menolak nonaktif akun tambahan yang kode-nya tidak ada', () => {
    const db = freshDb();
    try {
      expect(() => setAkunAktif(db, '9999', false)).toThrow(/tidak ditemukan/i);
    } finally {
      db.close();
    }
  });
});

describe('DB-14 — akun kas/bank baru dan metadata sumber', () => {
  it('menambah bank 1100–1199, muncul di daftar kas, dan masuk total kas', () => {
    const db = freshDb();
    try {
      const jumlahAwal = listAkun(db).length;
      const bank = tambahAkun(db, {
        kode: '1101',
        nama: 'BANK BPD REKENING BARU',
        tipe: 'AKTIVA',
        is_kas: true,
        kelompok: 'BANK',
      });
      expect(bank).toMatchObject({
        kode: '1101',
        nama: 'BANK BPD REKENING BARU',
        tipe: 'AKTIVA',
        posisi_normal: 'DEBIT',
        aktif: true,
        is_kas: true,
        kelompok: 'BANK',
        sumber: 'TAMBAHAN',
      });
      expect(listAkun(db)).toHaveLength(jumlahAwal + 1);
      expect(kodeKasAktifDb(db)).toContain('1101');
      expect(kodeKasDariDb(db)).toContain('1101');
      expect(listAuditLog(db).some((a) => a.aksi === 'AKUN-TAMBAH 1101')).toBe(true);

      insertJurnalTervalidasi(
        db,
        { id: 'awal-bank', tanggal: '2026-01-01', keterangan: 'Saldo awal bank baru' },
        [
          { akun_kode: '1101', debit: RP(5_000_000), kredit: 0 },
          { akun_kode: '3000', debit: 0, kredit: RP(5_000_000) },
        ],
      );

      const baris = listBarisJurnal(db);
      expect(totalKas(baris, kodeKasDariDb(db), undefined, listAkun(db))).toBe(
        RP(5_000_000),
      );
      expect(laporanArusKas(db).saldoAkhir).toBe(RP(5_000_000));
    } finally {
      db.close();
    }
  });

  it('menolak kode di luar 1100–1199 dan metadata is_kas/kelompok yang tidak konsisten', () => {
    const db = freshDb();
    try {
      const dasar = {
        nama: 'BANK BARU',
        tipe: 'AKTIVA' as const,
        is_kas: true,
        kelompok: 'BANK',
      };
      expect(() => tambahAkun(db, { ...dasar, kode: '1099' })).toThrow(/1100–1199/);
      expect(() => tambahAkun(db, { ...dasar, kode: '1200' })).toThrow(/1100–1199/);
      expect(() =>
        tambahAkun(db, { ...dasar, kode: '1102', is_kas: false }),
      ).toThrow(/is_kas = 1/i);
      expect(() =>
        tambahAkun(db, { ...dasar, kode: '1103', kelompok: 'PANJAR' }),
      ).toThrow(/KAS, BANK, atau LPD/i);
      expect(() =>
        tambahAkun(db, {
          kode: '5012',
          nama: 'BEBAN TIDAK BOLEH KAS',
          tipe: 'BEBAN',
          is_kas: true,
        }),
      ).toThrow(/tidak boleh ditandai is_kas/i);
      expect(() =>
        tambahAkun(db, {
          kode: '5013',
          nama: 'KELOMPOK SALAH',
          tipe: 'BEBAN',
          kelompok: 'PENDAPATAN',
        }),
      ).toThrow(/Kelompok akun BEBAN/i);

      // Tidak ada baris yang setengah jadi saat validasi gagal.
      expect(getAkun(db, '1102')).toBeNull();
      expect(getAkun(db, '1103')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('akun bank tambahan tetap utuh setelah reopen (nama, tipe, aktif, metadata)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-akun-bank-'));
    try {
      const path = join(dir, 'pura.db');
      let db = openDb(path);
      tambahAkun(db, {
        kode: '1101',
        nama: 'BANK BPD REKENING BARU',
        tipe: 'AKTIVA',
        is_kas: true,
        kelompok: 'LPD',
      });
      ubahNamaAkun(db, '1101', 'BANK BPD REKENING BARU (UBAH)');
      setAkunAktif(db, '1101', false);
      db.close();

      db = openDb(path);
      try {
        expect(getAkun(db, '1101')).toMatchObject({
          kode: '1101',
          nama: 'BANK BPD REKENING BARU (UBAH)',
          tipe: 'AKTIVA',
          posisi_normal: 'DEBIT',
          aktif: false,
          is_kas: true,
          kelompok: 'LPD',
          sumber: 'TAMBAHAN',
        });
        expect(kodeKasAktifDb(db)).not.toContain('1101');
        // Laporan historis tetap memakai akun nonaktif agar saldo lama utuh.
        expect(kodeKasDariDb(db)).toContain('1101');
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
