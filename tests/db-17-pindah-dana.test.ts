// DB-17 — verifikasi & regresi form Pindah Dana (jurnal TRANSFER).
//
// Fokus pembuktian:
// - semua pasangan akun aktif ber-`is_kas = 1` dari master DB dapat disusun,
//   termasuk rekening bank tambahan (bukan hanya `KAS_KODES` statis);
// - akun asal dan tujuan tidak boleh sama, baik di builder maupun posting layer;
// - nominal wajib bilangan bulat lebih dari 0;
// - akun kas yang dinonaktifkan ditolak posting layer dan hilang dari daftar
//   dompet aktif (histori/total lama tetap terbaca);
// - jurnal selalu D tujuan / K asal, seimbang, dan total kas seluruh dompet
//   tidak berubah.

import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { laporanArusKas, listBarisJurnal } from '../src/db/laporan.js';
import { postingJurnal } from '../src/db/posting.js';
import {
  kodeKasAktifDb,
  kodeKasDariDb,
  listAkun,
  listJurnalLengkap,
  setAkunAktif,
  tambahAkun,
} from '../src/db/repository.js';
import { buatJurnalPindahDana, type FormPindahDana } from '../src/core/forms.js';
import { isAkunKasData } from '../src/db/coa.js';
import {
  validasiJurnal,
  type JurnalInput,
  type PostingContext,
} from '../src/core/posting.js';
import { neracaSaldo, saldoAkun, totalKas } from '../src/core/reports.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const RP = (rupiah: number): number => rupiah * 100;

const D = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: nominal,
  kredit: 0,
});
const K = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: 0,
  kredit: nominal,
});

const TANGGAL_AWAL = '2026-01-01';
const TANGGAL_PINDAH = '2026-02-01';
const TOTAL_AWAL = RP(6_000_000);

/** DB bersih + saldo awal tiga dompet: 1001 Rp 1 jt, 1010 Rp 2 jt, 1014 Rp 3 jt. */
function dbDenganSaldoAwal(): Database.Database {
  const db = openDb(':memory:');
  const awal = postingJurnal(db, {
    header: {
      id: 'db17-awal',
      tanggal: TANGGAL_AWAL,
      no_bukti: 'DB17-0000',
      keterangan: 'Saldo awal uji Pindah Dana',
      jenis: 'SALDO_AWAL',
    },
    baris: [
      D('1001', RP(1_000_000)),
      D('1010', RP(2_000_000)),
      D('1014', RP(3_000_000)),
      K('3000', TOTAL_AWAL),
    ],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

function barisDb(db: Database.Database) {
  return listBarisJurnal(db);
}

/** Saldo satu dompet memakai master DB (termasuk akun tambahan). */
function saldoDompet(db: Database.Database, kode: string): number {
  return saldoAkun(barisDb(db), kode, undefined, listAkun(db));
}

/**
 * Total kas seluruh dompet dari metadata DB (`is_kas = 1`), bukan daftar
 * statis. Akun nonaktif tetap dihitung agar histori tidak berubah diam-diam.
 */
function totalKasDb(db: Database.Database): number {
  return totalKas(barisDb(db), kodeKasDariDb(db), undefined, listAkun(db));
}

function jumlahBaris(baris: readonly { debit: number; kredit: number }[]): {
  debit: number;
  kredit: number;
} {
  return baris.reduce(
    (t, b) => ({ debit: t.debit + b.debit, kredit: t.kredit + b.kredit }),
    { debit: 0, kredit: 0 },
  );
}

const PASANGAN: readonly {
  label: string;
  dari: string;
  ke: string;
  nominal: number;
}[] = [
  {
    label: 'kas 1001 → bank/LPD 1010',
    dari: '1001',
    ke: '1010',
    nominal: RP(100_000),
  },
  {
    label: 'bank/LPD 1010 → LPD 1014',
    dari: '1010',
    ke: '1014',
    nominal: RP(250_000),
  },
  {
    label: 'LPD 1014 → kas 1001',
    dari: '1014',
    ke: '1001',
    nominal: RP(50_000),
  },
];

describe('DB-17 — Pindah Dana tiga pasangan utama', () => {
  for (const kasus of PASANGAN) {
    it(`${kasus.label}: D tujuan / K asal, seimbang, total kas tetap`, () => {
      const db = dbDenganSaldoAwal();
      try {
        const totalAwal = totalKasDb(db);
        const saldoDariAwal = saldoDompet(db, kasus.dari);
        const saldoKeAwal = saldoDompet(db, kasus.ke);
        expect(totalAwal).toBe(TOTAL_AWAL);
        expect(saldoDariAwal).toBeGreaterThanOrEqual(kasus.nominal);

        const daftarAkun = listAkun(db);
        const input = buatJurnalPindahDana({
          tanggal: TANGGAL_PINDAH,
          dari: kasus.dari,
          ke: kasus.ke,
          nominal: kasus.nominal,
          keterangan: `Uji DB-17: ${kasus.label}`,
          id: `db17-${kasus.dari}-${kasus.ke}`,
          daftarAkun,
        });

        expect(input.header.jenis).toBe('TRANSFER');
        // Dana masuk ke tujuan (debit), keluar dari asal (kredit).
        expect(input.baris).toEqual([
          { akun_kode: kasus.ke, debit: kasus.nominal, kredit: 0 },
          { akun_kode: kasus.dari, debit: 0, kredit: kasus.nominal },
        ]);
        expect(jumlahBaris(input.baris)).toEqual({
          debit: kasus.nominal,
          kredit: kasus.nominal,
        });

        const hasil = postingJurnal(db, input);
        expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
        expect(hasil.errors).toEqual([]);
        expect(hasil.peringatan).toEqual([]);
        expect(hasil.jurnal?.jenis).toBe('TRANSFER');

        // Hanya posisi antar dompet yang berubah; total kas tetap.
        expect(saldoDompet(db, kasus.dari)).toBe(saldoDariAwal - kasus.nominal);
        expect(saldoDompet(db, kasus.ke)).toBe(saldoKeAwal + kasus.nominal);
        expect(totalKasDb(db)).toBe(totalAwal);

        // Jurnal tersimpan juga seimbang dan memakai dua akun berbeda.
        const tersimpan = listJurnalLengkap(db, { jenis: 'TRANSFER' }).find(
          (j) => j.id === input.header.id,
        );
        expect(tersimpan).toBeDefined();
        expect(tersimpan?.baris).toHaveLength(2);
        expect(jumlahBaris(tersimpan?.baris ?? [])).toEqual({
          debit: kasus.nominal,
          kredit: kasus.nominal,
        });
        expect(new Set(tersimpan?.baris.map((b) => b.akun_kode)).size).toBe(2);

        // Tidak mengubah laba/rugi; Neraca Saldo tetap seimbang.
        expect(
          neracaSaldo(barisDb(db), '2026-12-31', daftarAkun).selisih,
        ).toBe(0);

        // Arus Kas: pindah dana masuk kelompok TRANSFER, bukan operasi.
        const arus = laporanArusKas(db, {
          mulai: TANGGAL_PINDAH,
          sampai: '2026-02-28',
        });
        expect(arus.saldoAwal).toBe(totalAwal);
        expect(arus.kenaikan).toBe(0);
        expect(arus.saldoAkhir).toBe(totalAwal);
        expect(arus.operasi.masuk).toBe(0);
        expect(arus.operasi.keluar).toBe(0);
        expect(arus.transfer.masuk).toBe(kasus.nominal);
        expect(arus.transfer.keluar).toBe(kasus.nominal);
      } finally {
        db.close();
      }
    });
  }
});

describe('DB-17 — cakupan pasangan akun aktif dari master DB', () => {
  it('semua pasangan akun aktif is_kas=1 dapat disusun, termasuk bank tambahan', () => {
    const db = openDb(':memory:');
    try {
      tambahAkun(db, {
        kode: '1101',
        nama: 'BANK BPD REKENING BARU DB-17',
        tipe: 'AKTIVA',
        is_kas: true,
        kelompok: 'BANK',
      });

      const daftarAkun = listAkun(db);
      const dompet = daftarAkun.filter(
        (a) => isAkunKasData(a) && a.aktif,
      );
      expect(dompet.length).toBeGreaterThanOrEqual(16);
      expect(dompet.map((a) => a.kode)).toContain('1101');
      // 1040 panjar dan 1050 piutang bukan dompet.
      expect(dompet.map((a) => a.kode)).not.toContain('1040');
      expect(dompet.map((a) => a.kode)).not.toContain('1050');

      const konteks: PostingContext = {
        akun: daftarAkun,
        tutupBuku: [],
        noBuktiTerpakai: [],
        saldoKas: Object.fromEntries(
          dompet.map((a) => [a.kode, RP(10_000_000)]),
        ),
        sekarang: '2026-10-31',
      };

      let jumlahPasangan = 0;
      for (const dari of dompet) {
        for (const ke of dompet) {
          if (dari.kode === ke.kode) continue;
          const input = buatJurnalPindahDana({
            tanggal: TANGGAL_PINDAH,
            dari: dari.kode,
            ke: ke.kode,
            nominal: RP(10_000),
            keterangan: `Uji pasangan ${dari.kode} → ${ke.kode}`,
            daftarAkun,
          });
          const hasil = validasiJurnal(input, konteks);
          expect(hasil.errors, `${dari.kode} → ${ke.kode}`).toEqual([]);
          jumlahPasangan += 1;
        }
      }
      expect(jumlahPasangan).toBe(dompet.length * (dompet.length - 1));
    } finally {
      db.close();
    }
  });
});

describe('DB-17 — penolakan input Pindah Dana', () => {
  it('menolak akun asal yang sama dengan tujuan di builder dan posting layer', () => {
    const db = dbDenganSaldoAwal();
    try {
      const totalAwal = totalKasDb(db);
      const daftarAkun = listAkun(db);

      expect(() =>
        buatJurnalPindahDana({
          tanggal: TANGGAL_PINDAH,
          dari: '1001',
          ke: '1001',
          nominal: RP(10_000),
          keterangan: 'Tidak boleh akun sama',
          daftarAkun,
        }),
      ).toThrow(/berbeda/);

      // Bypass builder (mis. renderer nakal) tetap ditolak posting layer.
      const input: JurnalInput = {
        header: {
          id: 'db17-sama',
          tanggal: TANGGAL_PINDAH,
          keterangan: 'Pindah ke akun yang sama',
          jenis: 'TRANSFER',
        },
        baris: [D('1001', RP(10_000)), K('1001', RP(10_000))],
      };
      const hasil = postingJurnal(db, input);
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(
        /dua akun kas\/bank yang berbeda/,
      );
      expect(listJurnalLengkap(db, { jenis: 'TRANSFER' })).toEqual([]);
      expect(totalKasDb(db)).toBe(totalAwal);
    } finally {
      db.close();
    }
  });

  it('menolak akun kas nonaktif dan menyembunyikannya dari daftar dompet aktif', () => {
    const db = dbDenganSaldoAwal();
    try {
      const totalAwal = totalKasDb(db);
      setAkunAktif(db, '1014', false, 'Uji DB-17: akun nonaktif');

      expect(kodeKasAktifDb(db)).not.toContain('1014');
      // Total historis tetap menghitung dompet nonaktif agar saldo lama utuh.
      expect(kodeKasDariDb(db)).toContain('1014');

      // UI sudah menyaring akun nonaktif; bila tetap terkirim, posting menolak.
      const input = buatJurnalPindahDana({
        tanggal: TANGGAL_PINDAH,
        dari: '1001',
        ke: '1014',
        nominal: RP(10_000),
        keterangan: 'Pindah ke akun nonaktif',
        daftarAkun: listAkun(db),
      });
      const hasil = postingJurnal(db, input);
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/sudah tidak aktif/);
      expect(listJurnalLengkap(db, { jenis: 'TRANSFER' })).toEqual([]);
      expect(totalKasDb(db)).toBe(totalAwal);
    } finally {
      db.close();
    }
  });

  it('menolak nominal nol, negatif, pecahan, dan bukan angka', () => {
    const db = dbDenganSaldoAwal();
    try {
      const dasar: Omit<FormPindahDana, 'nominal'> = {
        tanggal: TANGGAL_PINDAH,
        dari: '1001',
        ke: '1010',
        keterangan: 'Uji nominal Pindah Dana',
        daftarAkun: listAkun(db),
      };
      for (const nominal of [0, -1, -RP(1), 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(
          () => buatJurnalPindahDana({ ...dasar, nominal }),
          `nominal ${nominal}`,
        ).toThrow(/Nominal/);
      }

      // Bypass builder dengan dua baris nol juga ditolak posting layer.
      const input: JurnalInput = {
        header: {
          id: 'db17-nol',
          tanggal: TANGGAL_PINDAH,
          keterangan: 'Pindah dana nol',
          jenis: 'TRANSFER',
        },
        baris: [D('1001', 0), K('1010', 0)],
      };
      const hasil = postingJurnal(db, input);
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(
        /nominal debit\/kredit harus lebih dari 0/,
      );
      expect(listJurnalLengkap(db, { jenis: 'TRANSFER' })).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('DB-17 — rekening bank tambahan dari metadata DB', () => {
  it('memindahkan dana ke bank 1101 dan total kas seluruh dompet tetap', () => {
    const db = dbDenganSaldoAwal();
    try {
      const bank = tambahAkun(db, {
        kode: '1101',
        nama: 'BANK BPD REKENING BARU DB-17',
        tipe: 'AKTIVA',
        is_kas: true,
        kelompok: 'BANK',
      });
      expect(bank).toMatchObject({
        kode: '1101',
        is_kas: true,
        kelompok: 'BANK',
        sumber: 'TAMBAHAN',
      });
      expect(kodeKasAktifDb(db)).toContain('1101');

      const totalAwal = totalKasDb(db);
      const daftarAkun = listAkun(db);
      const input = buatJurnalPindahDana({
        tanggal: TANGGAL_PINDAH,
        dari: '1001',
        ke: '1101',
        nominal: RP(300_000),
        keterangan: 'Setor kas ke rekening bank baru',
        id: 'db17-bank-baru',
        daftarAkun,
      });
      expect(input.baris).toEqual([
        { akun_kode: '1101', debit: RP(300_000), kredit: 0 },
        { akun_kode: '1001', debit: 0, kredit: RP(300_000) },
      ]);

      const hasil = postingJurnal(db, input);
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.errors).toEqual([]);

      expect(saldoDompet(db, '1001')).toBe(RP(700_000));
      expect(saldoDompet(db, '1101')).toBe(RP(300_000));
      expect(totalKasDb(db)).toBe(totalAwal);
      expect(laporanArusKas(db).saldoAkhir).toBe(totalAwal);
    } finally {
      db.close();
    }
  });
});
