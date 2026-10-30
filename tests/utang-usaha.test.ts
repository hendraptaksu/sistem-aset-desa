// DB-23b — form utang usaha sederhana tanpa master pihak.
//
// Fokus:
// - Catat Utang Usaha: D BEBAN / K 2060, nama kreditur di keterangan.
// - Bayar Utang Usaha: D 2060 / K kas.
// - Jurnal seimbang, laporan tetap benar, dan tidak ada metadata pihak baru.
// - DB-33: tabel legacy `pihak`/`jurnal_pihak` sudah dibuang; reversal jurnal
//   lama tetap jalan tanpa metadata subledger.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openDb } from '../src/db/database.js';
import { postingJurnal } from '../src/db/posting.js';
import { reverseJurnal } from '../src/db/reversal.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import {
  getJurnal,
  listJurnal,
  listJurnalBaris,
} from '../src/db/repository.js';
import {
  buatJurnalBayarUtangUsaha,
  buatJurnalCatatUtangUsaha,
} from '../src/core/forms.js';
import {
  arusKas,
  labaRugi,
  neraca,
  neracaSaldo,
  saldoAkun,
} from '../src/core/reports.js';
import { AKUN_MODAL, AKUN_PIUTANG, COA } from '../src/db/coa.js';
import type { JurnalInput } from '../src/core/posting.js';
import { FormTransaksiTerpandu } from '../src/renderer/components/TransaksiForm.js';

const RP = (rupiah: number): number => rupiah * 100;

const D = (akun: string, nominal: number) => ({
  akun_kode: akun,
  debit: nominal,
  kredit: 0,
});
const K = (akun: string, nominal: number) => ({
  akun_kode: akun,
  debit: 0,
  kredit: nominal,
});

const dasar = {
  tanggal: '2026-02-01',
  keterangan: 'Perbaikan gedung — utang ke Toko Bangunan Jaya',
};

function total(input: JurnalInput): { debit: number; kredit: number } {
  return input.baris.reduce(
    (t, b) => ({ debit: t.debit + b.debit, kredit: t.kredit + b.kredit }),
    { debit: 0, kredit: 0 },
  );
}

function dbDenganKas(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  const awal = postingJurnal(db, {
    header: {
      id: 'awal-utang',
      tanggal: '2026-01-01',
      keterangan: 'Saldo awal uji utang usaha',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', RP(1_000_000)), K(AKUN_MODAL, RP(1_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

describe('DB-23b — builder Catat Utang Usaha', () => {
  it('menyusun D beban / K 2060 dengan kreditur di keterangan', () => {
    const input = buatJurnalCatatUtangUsaha({
      ...dasar,
      akunBeban: '5003',
      nominal: RP(300_000),
      noBukti: ' JU-2026-0100 ',
      id: 'j-catat-utang',
    });

    expect(input.header).toMatchObject({
      id: 'j-catat-utang',
      tanggal: '2026-02-01',
      keterangan: 'Perbaikan gedung — utang ke Toko Bangunan Jaya',
      jenis: 'HUTANG',
      no_bukti: 'JU-2026-0100',
    });
    expect(input.baris).toEqual([
      { akun_kode: '5003', debit: RP(300_000), kredit: 0 },
      { akun_kode: '2060', debit: 0, kredit: RP(300_000) },
    ]);
    expect(total(input)).toEqual({
      debit: RP(300_000),
      kredit: RP(300_000),
    });
  });

  it('menolak akun non-beban dan nominal/keterangan tidak valid', () => {
    for (const akunBeban of ['4005', '1001', '1040', '1050', '2050', '2060', '9999']) {
      expect(
        () =>
          buatJurnalCatatUtangUsaha({
            ...dasar,
            akunBeban,
            nominal: RP(100_000),
          }),
        `akun ${akunBeban}`,
      ).toThrow(/bukan akun BEBAN|tidak dikenal/i);
    }

    expect(() =>
      buatJurnalCatatUtangUsaha({
        ...dasar,
        akunBeban: '5003',
        nominal: 0,
      }),
    ).toThrow(/Nominal/);
    expect(() =>
      buatJurnalCatatUtangUsaha({
        ...dasar,
        akunBeban: '5003',
        nominal: 1.5,
      }),
    ).toThrow(/Nominal/);
    expect(() =>
      buatJurnalCatatUtangUsaha({
        ...dasar,
        keterangan: '   ',
        akunBeban: '5003',
        nominal: RP(100_000),
      }),
    ).toThrow(/Keterangan/);
  });
});

describe('DB-23b — builder Bayar Utang Usaha', () => {
  it('menyusun D 2060 / K kas dengan jenis HUTANG', () => {
    const input = buatJurnalBayarUtangUsaha({
      ...dasar,
      keterangan: 'Bayar utang ke Toko Bangunan Jaya',
      akunKas: '1001',
      nominal: RP(200_000),
      id: 'j-bayar-utang',
    });

    expect(input.header.jenis).toBe('HUTANG');
    expect(input.header.keterangan).toBe('Bayar utang ke Toko Bangunan Jaya');
    expect(input.baris).toEqual([
      { akun_kode: '2060', debit: RP(200_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(200_000) },
    ]);
    expect(total(input)).toEqual({
      debit: RP(200_000),
      kredit: RP(200_000),
    });
  });

  it('menolak akun kas yang salah, akun tak dikenal, dan nominal tidak valid', () => {
    expect(() =>
      buatJurnalBayarUtangUsaha({
        ...dasar,
        akunKas: '5010',
        nominal: RP(100_000),
      }),
    ).toThrow(/kas\/bank/i);
    expect(() =>
      buatJurnalBayarUtangUsaha({
        ...dasar,
        akunKas: '9999',
        nominal: RP(100_000),
      }),
    ).toThrow(/kas\/bank|tidak dikenal/i);
    expect(() =>
      buatJurnalBayarUtangUsaha({
        ...dasar,
        akunKas: '1001',
        nominal: -1,
      }),
    ).toThrow(/Nominal/);
  });
});

describe('DB-23b — alur utang usaha end-to-end', () => {
  it('mencatat utang lalu pembayaran, menjaga 2060 dan laporan seimbang', () => {
    const db = dbDenganKas();
    try {
      const catat = postingJurnal(
        db,
        buatJurnalCatatUtangUsaha({
          ...dasar,
          akunBeban: '5003',
          nominal: RP(300_000),
          id: 'j-catat-utang-db',
        }),
      );
      expect(catat.tersimpan, catat.errors.join(' ')).toBe(true);
      expect(catat.jurnal?.jenis).toBe('HUTANG');
      expect(catat.jurnal?.keterangan).toContain('Toko Bangunan Jaya');
      expect(
        listJurnalBaris(db, 'j-catat-utang-db').map((b) => ({
          akun: b.akun_kode,
          debit: b.debit,
          kredit: b.kredit,
        })),
      ).toEqual([
        { akun: '5003', debit: RP(300_000), kredit: 0 },
        { akun: '2060', debit: 0, kredit: RP(300_000) },
      ]);
      expect(saldoAkun(listBarisJurnal(db), '2060')).toBe(RP(300_000));
      expect(saldoAkun(listBarisJurnal(db), '1001')).toBe(RP(1_000_000));

      const bayar = postingJurnal(
        db,
        buatJurnalBayarUtangUsaha({
          ...dasar,
          tanggal: '2026-02-10',
          keterangan: 'Bayar utang ke Toko Bangunan Jaya',
          akunKas: '1001',
          nominal: RP(200_000),
          id: 'j-bayar-utang-db',
        }),
      );
      expect(bayar.tersimpan, bayar.errors.join(' ')).toBe(true);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '2060')).toBe(RP(100_000));
      expect(saldoAkun(baris, '1001')).toBe(RP(800_000));
      expect(saldoAkun(baris, '2050')).toBe(0);
      expect(labaRugi(baris, { sampai: '2026-12-31' }).laba).toBe(RP(-300_000));

      const neracaHasil = neraca(baris, '2026-12-31');
      expect(neracaHasil.totalKewajiban).toBe(RP(100_000));
      expect(neracaHasil.balance).toBe(true);
      expect(neracaSaldo(baris).selisih).toBe(0);

      const arus = arusKas(baris);
      expect(
        arus.rows.find((r) => r.jurnal_id === 'j-bayar-utang-db')?.kelompok,
      ).toBe('OPERASI');

      // DB-33: tidak ada tabel metadata pihak lagi untuk jurnal baru.
      expect(
        db
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jurnal_pihak'")
          .get(),
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });
});

describe('DB-33 — tabel legacy pihak sudah dibuang', () => {
  it('reversal jurnal 2050 tetap jalan tanpa tabel pihak/jurnal_pihak', () => {
    const db = dbDenganKas();
    try {
      const lama = postingJurnal(db, {
        header: {
          id: 'j-pihak-lama',
          tanggal: '2026-02-01',
          keterangan: 'Terima pinjaman dari Banjar (data lama)',
          jenis: 'HUTANG',
        },
        baris: [D('1001', RP(500_000)), K('2050', RP(500_000))],
      });
      expect(lama.tersimpan, lama.errors.join(' ')).toBe(true);

      const tabel = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((t) => t.name);
      expect(tabel).not.toContain('pihak');
      expect(tabel).not.toContain('jurnal_pihak');

      const balik = reverseJurnal(db, 'j-pihak-lama', 'Koreksi pinjaman lama', {
        id: 'j-pihak-lama-balik',
        tanggal: '2026-02-02',
      });
      expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);

      // Jurnal asli utuh; koreksi hanya menambah jurnal balik.
      expect(getJurnal(db, 'j-pihak-lama')).not.toBeNull();
      expect(saldoAkun(listBarisJurnal(db), '2050')).toBe(0);
      expect(neracaSaldo(listBarisJurnal(db)).selisih).toBe(0);
      expect(listJurnal(db).map((j) => j.id).sort()).toEqual([
        'awal-utang',
        'j-pihak-lama',
        'j-pihak-lama-balik',
      ]);
    } finally {
      db.close();
    }
  });

  it('akun 1050 lama tetap terbaca di laporan (tanpa form input piutang)', () => {
    const db = dbDenganKas();
    try {
      const piutang = postingJurnal(db, {
        header: {
          id: 'j-piutang-lama',
          tanggal: '2026-02-01',
          keterangan: 'Piutang lama',
          jenis: 'PIUTANG',
        },
        baris: [D(AKUN_PIUTANG, RP(250_000)), K('1001', RP(250_000))],
      });
      expect(piutang.tersimpan, piutang.errors.join(' ')).toBe(true);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, AKUN_PIUTANG)).toBe(RP(250_000));
      expect(
        arusKas(baris).rows.find((r) => r.jurnal_id === 'j-piutang-lama')?.kelompok,
      ).toBe('INVESTASI');
      expect(neraca(baris, '2026-12-31').balance).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('DB-23b — form terpandu di tab Transaksi', () => {
  it('merender Catat Utang Usaha dengan akun beban dan keterangan kreditur', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'CATAT_UTANG',
        coa: COA,
        memuat: false,
      }),
    );

    expect(html).toContain('Catat Utang Usaha');
    expect(html).toContain('Akun beban (untuk Laba Rugi)');
    expect(html).toContain('Tulis nama kreditur di Keterangan');
    expect(html).toContain('Utang Usaha (2060)');
    expect(html).toContain('Kas belum keluar');
    expect(html).toContain('Simpan Catat Utang Usaha');
    expect(html).not.toContain('Pihak (wajib)');
    expect(html).not.toContain('Daftar Pihak');
  });

  it('merender Bayar Utang Usaha dengan kas sumber dan tanpa master pihak', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'BAYAR_UTANG',
        coa: COA,
        memuat: false,
      }),
    );

    expect(html).toContain('Bayar Utang Usaha');
    expect(html).toContain('Uang keluar dari');
    expect(html).toContain('Tulis nama kreditur di Keterangan');
    expect(html).toContain('Utang Usaha (2060)');
    expect(html).toContain('Simpan Bayar Utang Usaha');
    expect(html).not.toContain('Pihak (wajib)');
    expect(html).not.toContain('Pilih pihak');
  });
});
