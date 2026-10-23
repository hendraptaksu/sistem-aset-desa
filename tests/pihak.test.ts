// P1-5: Form Piutang & Hutang + master pihak.
//
// Fokus pembuktian:
// - Lima alur baku menghasilkan akun debit/kredit yang benar.
// - Saldo per pihak dihitung dari jurnal 1050/2050 + pemetaan `jurnal_pihak`.
// - Pelunasan/pembayaran melebihi saldo pihak hanya peringatan (bisa dikonfirmasi).
// - Kasus feedback: D 5003 / K 2050 → beban naik, Laba Rugi turun, hutang naik,
//   modal 3000 TIDAK berubah, Neraca Saldo tetap nol.
// - Pihak wajib; pihak yang sudah dipakai tidak bisa dihapus; audit tercatat.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { openDb, SCHEMA_VERSION } from '../src/db/database.js';
import { postingJurnal } from '../src/db/posting.js';
import { reverseJurnal } from '../src/db/reversal.js';
import {
  createPihak,
  daftarJurnalPihak,
  deletePihak,
  getPihak,
  listPihak,
  postingPihak,
  saldoPerPihak,
  updatePihak,
} from '../src/db/pihak.js';
import {
  buatJurnalBayarHutang,
  buatJurnalBeliKredit,
  buatJurnalBeriPinjaman,
  buatJurnalTerimaPelunasanPiutang,
  buatJurnalTerimaPinjaman,
} from '../src/core/forms.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import {
  getJurnal,
  listAuditLog,
  listJurnal,
  listJurnalBaris,
} from '../src/db/repository.js';
import { labaRugi, neraca, neracaSaldo, saldoAkun } from '../src/core/reports.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import type { JurnalInput } from '../src/core/posting.js';
import type { JurnalBarisInput } from '../src/core/types.js';
import {
  validasiBentukPihak,
  validasiBentukPostingPihak,
} from '../src/main/validation.js';
import { PihakTab } from '../src/renderer/components/PihakTab.js';

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

/** DB bersih + kas 1001 Rp 10.000.000 (lawan modal) + dua pihak. */
function dbPihak() {
  const db = openDb(':memory:');
  const awal = postingJurnal(db, {
    header: {
      id: 'awal',
      tanggal: '2026-01-01',
      no_bukti: 'P1-5-0000',
      keterangan: 'Saldo awal uji pihak',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', RP(10_000_000)), K(AKUN_MODAL, RP(10_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  const budi = createPihak(db, { id: 'p-budi', nama: 'Budi', catatan: 'Banjar' });
  const lpd = createPihak(db, { id: 'p-lpd', nama: 'LPD', catatan: 'Lembaga' });
  return { db, budi, lpd };
}

function barisJurnal(db: Database.Database, jurnalId: string) {
  return listJurnalBaris(db, jurnalId).map((b) => ({
    akun: b.akun_kode,
    debit: b.debit,
    kredit: b.kredit,
  }));
}

function simpan(
  db: Database.Database,
  pihakId: string,
  input: JurnalInput,
  opsi: { konfirmasiSaldo?: boolean; konfirmasiPeringatan?: boolean } = {},
) {
  return postingPihak(db, {
    pihakId,
    input,
    konfirmasiSaldo: opsi.konfirmasiSaldo,
    konfirmasiPeringatan: opsi.konfirmasiPeringatan,
  });
}

const dasar = {
  tanggal: '2026-02-01',
  keterangan: 'Transaksi uji pihak',
};

describe('P1-5 — lima alur piutang/hutang', () => {
  it('menghasilkan akun D/K benar dan saldo kas/1050/2050 berubah', () => {
    const { db, budi } = dbPihak();
    try {
      // 1. Beri pinjaman: D 1050 / K kas.
      const pinjam = simpan(
        db,
        budi.id,
        buatJurnalBeriPinjaman({
          ...dasar,
          pihakId: budi.id,
          akunKas: '1001',
          nominal: RP(1_000_000),
          noBukti: 'P1-5-0001',
          id: 'j-pinjam',
        }).input,
      );
      expect(pinjam.tersimpan, pinjam.errors.join(' ')).toBe(true);
      expect(pinjam.alur).toBe('BERI_PINJAMAN');
      expect(getJurnal(db, 'j-pinjam')?.jenis).toBe('PIUTANG');
      expect(barisJurnal(db, 'j-pinjam')).toEqual([
        { akun: '1050', debit: RP(1_000_000), kredit: 0 },
        { akun: '1001', debit: 0, kredit: RP(1_000_000) },
      ]);
      expect(saldoAkun(listBarisJurnal(db), '1001')).toBe(RP(9_000_000));
      expect(saldoAkun(listBarisJurnal(db), '1050')).toBe(RP(1_000_000));
      expect(saldoPerPihak(db).find((p) => p.id === budi.id)).toMatchObject({
        piutang: RP(1_000_000),
        hutang: 0,
        neto: RP(1_000_000),
      });

      // 2. Terima pelunasan piutang: D kas / K 1050.
      const lunas = simpan(
        db,
        budi.id,
        buatJurnalTerimaPelunasanPiutang({
          ...dasar,
          tanggal: '2026-02-10',
          pihakId: budi.id,
          akunKas: '1001',
          nominal: RP(400_000),
          noBukti: 'P1-5-0002',
          id: 'j-lunas',
        }).input,
      );
      expect(lunas.tersimpan, lunas.errors.join(' ')).toBe(true);
      expect(lunas.alur).toBe('TERIMA_PELUNASAN');
      expect(barisJurnal(db, 'j-lunas')).toEqual([
        { akun: '1001', debit: RP(400_000), kredit: 0 },
        { akun: '1050', debit: 0, kredit: RP(400_000) },
      ]);
      expect(saldoAkun(listBarisJurnal(db), '1050')).toBe(RP(600_000));
      expect(saldoAkun(listBarisJurnal(db), '1001')).toBe(RP(9_400_000));

      // 3. Terima pinjaman: D kas / K 2050.
      const terima = simpan(
        db,
        budi.id,
        buatJurnalTerimaPinjaman({
          ...dasar,
          tanggal: '2026-02-15',
          pihakId: budi.id,
          akunKas: '1001',
          nominal: RP(2_000_000),
          noBukti: 'P1-5-0003',
          id: 'j-terima-pinjam',
        }).input,
      );
      expect(terima.tersimpan, terima.errors.join(' ')).toBe(true);
      expect(terima.alur).toBe('TERIMA_PINJAMAN');
      expect(barisJurnal(db, 'j-terima-pinjam')).toEqual([
        { akun: '1001', debit: RP(2_000_000), kredit: 0 },
        { akun: '2050', debit: 0, kredit: RP(2_000_000) },
      ]);
      expect(saldoAkun(listBarisJurnal(db), '2050')).toBe(RP(2_000_000));
      expect(saldoAkun(listBarisJurnal(db), '1001')).toBe(RP(11_400_000));

      // 4. Bayar hutang: D 2050 / K kas.
      const bayar = simpan(
        db,
        budi.id,
        buatJurnalBayarHutang({
          ...dasar,
          tanggal: '2026-02-20',
          pihakId: budi.id,
          akunKas: '1001',
          nominal: RP(500_000),
          noBukti: 'P1-5-0004',
          id: 'j-bayar-hutang',
        }).input,
      );
      expect(bayar.tersimpan, bayar.errors.join(' ')).toBe(true);
      expect(bayar.alur).toBe('BAYAR_HUTANG');
      expect(barisJurnal(db, 'j-bayar-hutang')).toEqual([
        { akun: '2050', debit: RP(500_000), kredit: 0 },
        { akun: '1001', debit: 0, kredit: RP(500_000) },
      ]);
      expect(saldoAkun(listBarisJurnal(db), '2050')).toBe(RP(1_500_000));
      expect(saldoAkun(listBarisJurnal(db), '1001')).toBe(RP(10_900_000));

      // 5. Beli/perbaikan kredit: D beban / K 2050.
      const kredit = simpan(
        db,
        budi.id,
        buatJurnalBeliKredit({
          ...dasar,
          tanggal: '2026-02-25',
          pihakId: budi.id,
          akunBeban: '5003',
          nominal: RP(300_000),
          noBukti: 'P1-5-0005',
          id: 'j-beli-kredit',
        }).input,
      );
      expect(kredit.tersimpan, kredit.errors.join(' ')).toBe(true);
      expect(kredit.alur).toBe('BELI_KREDIT');
      expect(barisJurnal(db, 'j-beli-kredit')).toEqual([
        { akun: '5003', debit: RP(300_000), kredit: 0 },
        { akun: '2050', debit: 0, kredit: RP(300_000) },
      ]);
      expect(saldoAkun(listBarisJurnal(db), '2050')).toBe(RP(1_800_000));
      expect(saldoAkun(listBarisJurnal(db), '1001')).toBe(RP(10_900_000)); // kas tidak berubah

      const budiAkhir = saldoPerPihak(db).find((p) => p.id === budi.id)!;
      expect(budiAkhir).toMatchObject({
        piutang: RP(600_000),
        hutang: RP(1_800_000),
        neto: RP(-1_200_000),
      });

      const ns = neracaSaldo(listBarisJurnal(db));
      expect(ns.selisih).toBe(0);
      expect(ns.totalDebit).toBe(ns.totalKredit);

      // Aksi audit spesifik untuk tiap alur (bukan satu aksi generik).
      for (const aksi of [
        'PIUTANG-BERI-PINJAMAN',
        'PIUTANG-PELUNASAN',
        'HUTANG-TERIMA-PINJAMAN',
        'HUTANG-BAYAR',
        'HUTANG-BELI-KREDIT',
      ]) {
        expect(listAuditLog(db, { aksi }), `audit ${aksi}`).toHaveLength(1);
      }
    } finally {
      db.close();
    }
  });

  it('saldo antar pihak terpisah dan riwayat jurnal hanya milik pihak tersebut', () => {
    const { db, budi, lpd } = dbPihak();
    try {
      expect(
        simpan(
          db,
          budi.id,
          buatJurnalBeriPinjaman({
            ...dasar,
            pihakId: budi.id,
            akunKas: '1001',
            nominal: RP(1_000_000),
            id: 'j-budi-1',
          }).input,
        ).tersimpan,
      ).toBe(true);
      expect(
        simpan(
          db,
          lpd.id,
          buatJurnalBeriPinjaman({
            ...dasar,
            tanggal: '2026-02-02',
            pihakId: lpd.id,
            akunKas: '1001',
            nominal: RP(2_000_000),
            id: 'j-lpd-1',
          }).input,
        ).tersimpan,
      ).toBe(true);
      expect(
        simpan(
          db,
          budi.id,
          buatJurnalTerimaPinjaman({
            ...dasar,
            tanggal: '2026-02-03',
            pihakId: budi.id,
            akunKas: '1010',
            nominal: RP(500_000),
            id: 'j-budi-2',
          }).input,
          { konfirmasiPeringatan: true },
        ).tersimpan,
      ).toBe(true);
      expect(
        simpan(
          db,
          lpd.id,
          buatJurnalBeliKredit({
            ...dasar,
            tanggal: '2026-02-04',
            pihakId: lpd.id,
            akunBeban: '5004',
            nominal: RP(250_000),
            id: 'j-lpd-2',
          }).input,
        ).tersimpan,
      ).toBe(true);

      const saldo = saldoPerPihak(db);
      expect(saldo.find((p) => p.id === budi.id)).toMatchObject({
        piutang: RP(1_000_000),
        hutang: RP(500_000),
        neto: RP(500_000),
      });
      expect(saldo.find((p) => p.id === lpd.id)).toMatchObject({
        piutang: RP(2_000_000),
        hutang: RP(250_000),
        neto: RP(1_750_000),
      });

      const riwayatBudi = daftarJurnalPihak(db, budi.id);
      expect(riwayatBudi.map((j) => j.id)).toEqual(['j-budi-1', 'j-budi-2']);
      expect(riwayatBudi.map((j) => j.akun_pihak)).toEqual(['1050', '2050']);
      expect(riwayatBudi[0]).toMatchObject({
        debit: RP(1_000_000),
        kredit: 0,
        pihak_id: budi.id,
      });
      expect(riwayatBudi[0]!.baris).toHaveLength(2);
      expect(daftarJurnalPihak(db, lpd.id).map((j) => j.id)).toEqual([
        'j-lpd-1',
        'j-lpd-2',
      ]);
    } finally {
      db.close();
    }
  });
});

describe('P1-5 — peringatan saldo dan validasi pihak', () => {
  it('pelunasan piutang melebihi saldo: perlu konfirmasi lalu bisa disimpan', () => {
    const { db, budi } = dbPihak();
    try {
      expect(
        simpan(
          db,
          budi.id,
          buatJurnalBeriPinjaman({
            ...dasar,
            pihakId: budi.id,
            akunKas: '1001',
            nominal: RP(1_000_000),
            id: 'j-pinjam',
          }).input,
        ).tersimpan,
      ).toBe(true);
      const sebelum = listJurnal(db).length;

      const lunas = buatJurnalTerimaPelunasanPiutang({
        ...dasar,
        tanggal: '2026-02-10',
        pihakId: budi.id,
        akunKas: '1001',
        nominal: RP(1_500_000),
        id: 'j-lunas-lebih',
      }).input;
      const belum = simpan(db, budi.id, lunas);
      expect(belum.tersimpan).toBe(false);
      expect(belum.errors).toEqual([]);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/melebihi saldo piutang/i);
      expect(belum.saldoSebelum?.piutang).toBe(RP(1_000_000));
      expect(listJurnal(db)).toHaveLength(sebelum);
      expect(saldoPerPihak(db).find((p) => p.id === budi.id)?.piutang).toBe(
        RP(1_000_000),
      );

      const lanjut = simpan(db, budi.id, lunas, { konfirmasiSaldo: true });
      expect(lanjut.tersimpan, lanjut.errors.join(' ')).toBe(true);
      expect(lanjut.saldoSesudah?.piutang).toBe(RP(-500_000));
      expect(listJurnal(db)).toHaveLength(sebelum + 1);
    } finally {
      db.close();
    }
  });

  it('pembayaran hutang melebihi saldo: perlu konfirmasi lalu bisa disimpan', () => {
    const { db, budi } = dbPihak();
    try {
      expect(
        simpan(
          db,
          budi.id,
          buatJurnalTerimaPinjaman({
            ...dasar,
            pihakId: budi.id,
            akunKas: '1001',
            nominal: RP(500_000),
            id: 'j-pinjam-masuk',
          }).input,
        ).tersimpan,
      ).toBe(true);

      const bayar = buatJurnalBayarHutang({
        ...dasar,
        tanggal: '2026-02-11',
        pihakId: budi.id,
        akunKas: '1001',
        nominal: RP(800_000),
        id: 'j-bayar-lebih',
      }).input;
      const belum = simpan(db, budi.id, bayar);
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/melebihi saldo hutang/i);

      const lanjut = simpan(db, budi.id, bayar, { konfirmasiSaldo: true });
      expect(lanjut.tersimpan, lanjut.errors.join(' ')).toBe(true);
      expect(lanjut.saldoSesudah?.hutang).toBe(RP(-300_000));
      // Kas cukup: peringatan saldo tidak otomatis menjadi error.
      expect(lanjut.errors).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('pihak wajib; jurnal di luar lima alur baku ditolak', () => {
    const { db, budi } = dbPihak();
    try {
      expect(() =>
        buatJurnalBeriPinjaman({
          ...dasar,
          pihakId: '   ',
          akunKas: '1001',
          nominal: RP(10_000),
        }),
      ).toThrow(/Pihak wajib/i);

      const tanpaPihak = simpan(
        db,
        'p-tidak-ada',
        buatJurnalBeriPinjaman({
          ...dasar,
          pihakId: 'p-tidak-ada',
          akunKas: '1001',
          nominal: RP(10_000),
          id: 'j-tanpa-pihak',
        }).input,
      );
      expect(tanpaPihak.tersimpan).toBe(false);
      expect(tanpaPihak.errors.join(' ')).toMatch(/tidak ditemukan/i);

      // Menyentuh 1050 tetapi lawannya bukan kas (bukan alur baku).
      const alurAsing: JurnalInput = {
        header: {
          id: 'j-asing',
          tanggal: '2026-02-01',
          keterangan: 'Piutang lawan pendapatan',
          jenis: 'PIUTANG',
        },
        baris: [D('1050', RP(100_000)), K('4005', RP(100_000))],
      };
      const ditolak = simpan(db, budi.id, alurAsing);
      expect(ditolak.tersimpan).toBe(false);
      expect(ditolak.errors.join(' ')).toMatch(/alur piutang\/hutang tidak dikenal/i);

      // Beli kredit wajib akun BEBAN.
      expect(() =>
        buatJurnalBeliKredit({
          ...dasar,
          pihakId: budi.id,
          akunBeban: '4005',
          nominal: RP(100_000),
        }),
      ).toThrow(/bukan akun BEBAN/i);
      expect(() =>
        buatJurnalBeliKredit({
          ...dasar,
          pihakId: budi.id,
          akunBeban: '1001',
          nominal: RP(100_000),
        }),
      ).toThrow(/bukan akun BEBAN/i);
      expect(listJurnal(db)).toHaveLength(1); // hanya saldo awal
    } finally {
      db.close();
    }
  });

  it('validasi bentuk IPC tidak mempercayai input mentah', () => {
    expect(validasiBentukPihak({ nama: '  Budi  ', catatan: '  Banjar ' })).toEqual({
      ok: true,
      input: { nama: 'Budi', catatan: 'Banjar' },
    });
    expect(validasiBentukPihak({ nama: '   ' }).ok).toBe(false);
    expect(validasiBentukPihak(null).ok).toBe(false);
    expect(validasiBentukPihak({ nama: 'x', catatan: 5 }).ok).toBe(false);

    const jurnal = {
      header: {
        id: 'j-ipc',
        tanggal: '2026-02-01',
        keterangan: 'Uji IPC',
        jenis: 'PIUTANG',
      },
      baris: [D('1050', RP(100_000)), K('1001', RP(100_000))],
    };
    expect(validasiBentukPostingPihak({ pihakId: ' p-budi ', input: jurnal }).ok).toBe(
      true,
    );
    expect(validasiBentukPostingPihak({ pihakId: '', input: jurnal }).ok).toBe(false);
    expect(validasiBentukPostingPihak({ input: jurnal }).ok).toBe(false);
    expect(
      validasiBentukPostingPihak({
        pihakId: 'p-budi',
        input: { ...jurnal, header: { ...jurnal.header, jenis: 'TERIMA' } },
      }).ok,
    ).toBe(false);
  });
});

describe('P1-5 — kasus feedback: perbaikan gedung kredit', () => {
  it('D 5003 / K 2050: Laba Rugi turun, hutang naik, modal 3000 tetap', () => {
    const { db, budi } = dbPihak();
    try {
      const sebelum = listBarisJurnal(db);
      const modalSebelum = saldoAkun(sebelum, AKUN_MODAL);
      const labaSebelum = labaRugi(sebelum, { sampai: '2026-12-31' });
      const neracaSebelum = neraca(sebelum, '2026-12-31');
      expect(modalSebelum).toBe(RP(10_000_000));
      expect(labaSebelum.laba).toBe(0);
      expect(neracaSebelum.totalKewajiban).toBe(0);

      const hasil = simpan(
        db,
        budi.id,
        buatJurnalBeliKredit({
          ...dasar,
          tanggal: '2026-02-01',
          pihakId: budi.id,
          akunBeban: '5003',
          nominal: RP(1_200_000),
          keterangan: 'Perbaikan gedung — dibayar bulan depan',
          noBukti: 'P1-5-1000',
          id: 'j-perbaikan',
        }).input,
      );
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.alur).toBe('BELI_KREDIT');
      expect(barisJurnal(db, 'j-perbaikan')).toEqual([
        { akun: '5003', debit: RP(1_200_000), kredit: 0 },
        { akun: '2050', debit: 0, kredit: RP(1_200_000) },
      ]);

      const sesudah = listBarisJurnal(db);
      // Beban masuk Laba Rugi → laba turun.
      const laba = labaRugi(sesudah, { sampai: '2026-12-31' });
      expect(laba.totalBeban).toBe(RP(1_200_000));
      expect(laba.laba).toBe(RP(-1_200_000));
      expect(laba.laba).toBeLessThan(labaSebelum.laba);

      // Hutang naik di Neraca, modal TIDAK berubah.
      const neracaSesudah = neraca(sesudah, '2026-12-31');
      expect(neracaSesudah.totalKewajiban).toBe(RP(1_200_000));
      expect(neracaSesudah.totalKewajiban).toBeGreaterThan(
        neracaSebelum.totalKewajiban,
      );
      expect(saldoAkun(sesudah, AKUN_MODAL)).toBe(modalSebelum);
      expect(saldoAkun(sesudah, '1050')).toBe(0);
      expect(saldoAkun(sesudah, '1001')).toBe(RP(10_000_000));

      // Neraca tetap seimbang; Neraca Saldo selisih 0.
      expect(neracaSesudah.balance).toBe(true);
      expect(neracaSesudah.selisih).toBe(0);
      expect(neracaSaldo(sesudah).selisih).toBe(0);
      expect(saldoPerPihak(db).find((p) => p.id === budi.id)?.hutang).toBe(
        RP(1_200_000),
      );
    } finally {
      db.close();
    }
  });
});

describe('P1-5 — master pihak, audit, dan reversal', () => {
  it('pihak terpakai tidak bisa dihapus; pihak bebas bisa dihapus; audit tercatat', () => {
    const { db, budi, lpd } = dbPihak();
    try {
      expect(
        simpan(
          db,
          budi.id,
          buatJurnalBeriPinjaman({
            ...dasar,
            pihakId: budi.id,
            akunKas: '1001',
            nominal: RP(100_000),
            id: 'j-budi',
          }).input,
        ).tersimpan,
      ).toBe(true);

      expect(() => deletePihak(db, budi.id)).toThrow(/sudah dipakai jurnal/i);
      expect(getPihak(db, budi.id)).not.toBeNull();

      const dihapus = deletePihak(db, lpd.id);
      expect(dihapus.nama).toBe('LPD');
      expect(getPihak(db, lpd.id)).toBeNull();
      expect(listPihak(db).map((p) => p.id)).toEqual([budi.id]);

      expect(listAuditLog(db, { aksi: 'PIHAK-DELETE' })[0]?.data_lama_json).toContain(
        'LPD',
      );
    } finally {
      db.close();
    }
  });

  it('nama pihak unik tanpa membedakan huruf besar/kecil; update tercatat', () => {
    const { db, budi } = dbPihak();
    try {
      expect(() => createPihak(db, { nama: 'budi' })).toThrow(/sudah dipakai/i);

      const baru = updatePihak(db, budi.id, {
        nama: 'Budi Kecil',
        catatan: 'Banjar Puseh',
      });
      expect(baru).toMatchObject({ id: budi.id, nama: 'Budi Kecil', catatan: 'Banjar Puseh' });
      const audit = listAuditLog(db, { aksi: 'PIHAK-UPDATE' })[0]!;
      expect(JSON.parse(audit.data_lama_json)).toMatchObject({ nama: 'Budi' });
      expect(JSON.parse(audit.data_baru_json)).toMatchObject({ nama: 'Budi Kecil' });
    } finally {
      db.close();
    }
  });

  it('setiap posting pihak menulis audit spesifik alur dengan saldo sebelum/sesudah', () => {
    const { db, budi } = dbPihak();
    try {
      expect(
        simpan(
          db,
          budi.id,
          buatJurnalBeriPinjaman({
            ...dasar,
            pihakId: budi.id,
            akunKas: '1001',
            nominal: RP(1_000_000),
            id: 'j-audit',
          }).input,
        ).tersimpan,
      ).toBe(true);

      const audit = listAuditLog(db, { aksi: 'PIUTANG-BERI-PINJAMAN' });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.aksi).toContain('j-audit');
      const lama = JSON.parse(audit[0]!.data_lama_json) as {
        pihak: { id: string };
        saldo: { piutang: number };
      };
      const baru = JSON.parse(audit[0]!.data_baru_json) as {
        pihak: { id: string };
        akun_kode: string;
        jurnal: { id: string };
        saldo: { piutang: number };
      };
      expect(lama.pihak.id).toBe(budi.id);
      expect(lama.saldo.piutang).toBe(0);
      expect(baru.pihak.id).toBe(budi.id);
      expect(baru.akun_kode).toBe('1050');
      expect(baru.jurnal.id).toBe('j-audit');
      expect(baru.saldo.piutang).toBe(RP(1_000_000));
    } finally {
      db.close();
    }
  });

  it('jurnal balik mewarisi pemetaan pihak sehingga saldo pihak kembali', () => {
    const { db, budi } = dbPihak();
    try {
      expect(
        simpan(
          db,
          budi.id,
          buatJurnalBeriPinjaman({
            ...dasar,
            pihakId: budi.id,
            akunKas: '1001',
            nominal: RP(1_000_000),
            id: 'j-asli',
          }).input,
        ).tersimpan,
      ).toBe(true);
      expect(saldoPerPihak(db).find((p) => p.id === budi.id)?.piutang).toBe(
        RP(1_000_000),
      );

      const balik = reverseJurnal(db, 'j-asli', 'Koreksi uji pihak', {
        id: 'j-balik',
        tanggal: '2026-02-02',
      });
      expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);
      expect(saldoPerPihak(db).find((p) => p.id === budi.id)?.piutang).toBe(0);
      expect(daftarJurnalPihak(db, budi.id).map((j) => j.id)).toEqual([
        'j-asli',
        'j-balik',
      ]);
      // Jurnal asli tidak diubah/dihapus.
      expect(getJurnal(db, 'j-asli')).not.toBeNull();
      expect(neracaSaldo(listBarisJurnal(db)).selisih).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('P1-5 — skema v5 idempoten', () => {
  it('membuat tabel pihak & jurnal_pihak, versi naik, dan data bertahan saat dibuka ulang', () => {
    const folder = mkdtempSync(join(tmpdir(), 'pura-pihak-'));
    const path = join(folder, 'pura.db');
    try {
      const db = openDb(path);
      try {
        expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
        expect(SCHEMA_VERSION).toBe(8);
        const tabel = (
          db
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('pihak', 'jurnal_pihak') ORDER BY name",
            )
            .all() as { name: string }[]
        ).map((t) => t.name);
        expect(tabel).toEqual(['jurnal_pihak', 'pihak']);

        const awal = postingJurnal(db, {
          header: {
            id: 'm-awal',
            tanggal: '2026-01-01',
            keterangan: 'Modal',
            jenis: 'SALDO_AWAL',
          },
          baris: [D('1001', RP(1_000_000)), K(AKUN_MODAL, RP(1_000_000))],
        });
        expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
        const p = createPihak(db, { id: 'p-tetap', nama: 'Pihak Tetap' });
        expect(
          simpan(
            db,
            p.id,
            buatJurnalBeriPinjaman({
              ...dasar,
              pihakId: p.id,
              akunKas: '1001',
              nominal: RP(250_000),
              id: 'j-tetap',
            }).input,
          ).tersimpan,
        ).toBe(true);
      } finally {
        db.close();
      }

      const db2 = openDb(path);
      try {
        expect(Number(db2.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
        expect(listPihak(db2).map((p) => p.nama)).toEqual(['Pihak Tetap']);
        expect(daftarJurnalPihak(db2, 'p-tetap')).toHaveLength(1);
        expect(saldoPerPihak(db2)[0]?.piutang).toBe(RP(250_000));
      } finally {
        db2.close();
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});

describe('P1-5 — layar Piutang & Hutang', () => {
  it('merender lima alur, penjelasan modal, dan master pihak', () => {
    const html = renderToStaticMarkup(createElement(PihakTab));

    expect(html).toContain('Piutang &amp; Hutang');
    expect(html).toContain('Daftar Pihak');
    for (const label of [
      'Beri Pinjaman',
      'Terima Pelunasan Piutang',
      'Terima Pinjaman',
      'Bayar Hutang',
      'Beli / Perbaikan Barang Kredit',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Pratinjau Jurnal (untuk diperiksa)');
    expect(html).toContain('modal (3000) tidak berubah');
    expect(html).toContain('Pihak (wajib)');
  });
});
