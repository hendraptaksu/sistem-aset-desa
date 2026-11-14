// T-B04 — semua jurnal balik tertaut dokumen ditulis dengan sumber REVERSAL.
//
// `sumber` T-A14 bukan kolom jurnal; ia dikirim command layer (`postingJurnal`
// opsi `mode`) ke `insertJurnalInternal`. Sebelum T-B04, jalur batal panjar
// dan pinjaman menulis jurnal balik tanpa `mode: 'REVERSAL'` sehingga lapisan
// insert menerima `sumber = 'POSTING'` (temuan audit R6). Test ini memakai
// mock tipis di atas implementasi asli untuk merekam `sumber` yang benar-benar
// dikirim ke pintu insert, tanpa mengubah perilaku tulis.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';

/** Rekam (id, jenis, reversal_of, sumber) setiap insert jurnal produksi. */
const rekamInsert = vi.hoisted(() => {
  return {
    daftar: [] as {
      id: string;
      jenis?: string;
      reversal_of?: string | null;
      sumber: string;
    }[],
  };
});

vi.mock('../src/db/repository.js', async (importOriginal) => {
  const asli = await importOriginal<typeof import('../src/db/repository.js')>();
  return {
    ...asli,
    insertJurnalInternal: (...args: Parameters<typeof asli.insertJurnalInternal>) => {
      rekamInsert.daftar.push({
        id: args[1].id,
        jenis: args[1].jenis,
        reversal_of: args[1].reversal_of ?? null,
        sumber: args[3].sumber,
      });
      return asli.insertJurnalInternal(...args);
    },
  };
});

import { openDb } from '../src/db/database.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import {
  batalPanjarV2,
  batalkanPertanggungjawabanPanjar,
  closePanjarV2,
  getPanjar,
  serahkanPanjar,
} from '../src/db/panjar.js';
import {
  batalkanPembayaranPinjaman,
  batalkanPinjaman,
  bayarAngsuranPinjaman,
  getPinjaman,
  simpanPinjamanLpd,
} from '../src/db/pinjaman.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
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

const dbs: Database.Database[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  rekamInsert.daftar.length = 0;
});

/** DB bersih + kas 1001 Rp 10.000.000 (lawan modal) — pola tests/panjar.test.ts. */
function dbKas(): Database.Database {
  const db = openDb(':memory:');
  dbs.push(db);
  const awal = simpanSaldoAwal(db, {
    header: {
      id: 'awal',
      tanggal: '2026-01-01',
      no_bukti: 'T-B04-0000',
      keterangan: 'Saldo awal uji sumber reversal',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', RP(10_000_000)), K(AKUN_MODAL, RP(10_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

/**
 * Pinjaman pencairan Rp 10 juta, 1 angsuran — pola tests/audit-pinjaman-regresi.
 * Mengembalikan helper bayar untuk mencatat satu pembayaran angsuran.
 */
function buatPinjaman(db: Database.Database): {
  pinjamanId: string;
  angsuranId: number;
  bayar: (id: string) => ReturnType<typeof bayarAngsuranPinjaman>;
} {
  const simpan = simpanPinjamanLpd(db, {
    id: 'loan',
    mode: 'PENCAIRAN',
    kreditur: 'LPD Uji',
    tanggal: '2026-02-01',
    akunKas: '1001',
    pokok: RP(10_000_000),
    tenor: 1,
    angsuran: [
      { ke: 1, jatuh_tempo: '2026-03-01', pokok: RP(10_000_000), bunga: RP(100_000) },
    ],
  });
  expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);
  const pinjamanId = simpan.pinjaman!.id;
  const angsuranId = simpan.pinjaman!.angsuran![0].id;
  const bayar = (id: string) =>
    bayarAngsuranPinjaman(db, {
      id,
      jurnal_id: `j-${id}`,
      pinjaman_id: pinjamanId,
      angsuran_id: angsuranId,
      tanggal: '2026-03-01',
      akun_kas: '1001',
      pokok: RP(10_000_000),
      bunga: RP(100_000),
      denda: 0,
    });
  return { pinjamanId, angsuranId, bayar };
}

/** Insert jurnal balik yang terekam untuk `idAsli`. */
function insertReversalUntuk(idAsli: string) {
  const cocok = rekamInsert.daftar.filter((r) => r.reversal_of === idAsli);
  expect(cocok, `Jurnal balik untuk ${idAsli} tidak terekam`).toHaveLength(1);
  return cocok[0];
}

describe('T-B04 — jurnal balik panjar/pinjaman ditulis dengan sumber REVERSAL', () => {
  it('batal panjar OPEN mengirim sumber REVERSAL ke lapisan insert', () => {
    const db = dbKas();
    const serah = serahkanPanjar(db, {
      id: 'p1',
      jurnalId: 'j-p1',
      tanggal: '2026-02-01',
      penerima: 'Panitia Piodalan',
      jumlah: RP(1_000_000),
      akunKasSumber: '1001',
    });
    expect(serah.tersimpan, serah.errors.join(' ')).toBe(true);

    const hasil = batalPanjarV2(db, {
      id: 'p1',
      alasan: 'Salah serah ke panitia lain',
      jurnalId: 'j-batal-p1',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

    expect(insertReversalUntuk('j-p1')).toEqual({
      id: 'j-batal-p1',
      jenis: 'REVERSAL',
      reversal_of: 'j-p1',
      sumber: 'REVERSAL',
    });
  });

  it('koreksi pertanggungjawaban panjar CLOSED mengirim sumber REVERSAL', () => {
    const db = dbKas();
    expect(
      serahkanPanjar(db, {
        id: 'p1',
        jurnalId: 'j-p1',
        tanggal: '2026-02-01',
        penerima: 'Panitia Piodalan',
        jumlah: RP(1_000_000),
        akunKasSumber: '1001',
      }).tersimpan,
    ).toBe(true);
    const close = closePanjarV2(db, {
      id: 'p1',
      tanggalClose: '2026-02-05',
      items: [{ kategori_baga: '5003', nominal: RP(900_000) }],
    });
    expect(close.tersimpan, close.errors.join(' ')).toBe(true);
    const jurnalCloseId = getPanjar(db, 'p1')!.jurnal_close_id!;
    expect(jurnalCloseId).toBeTruthy();

    const hasil = batalkanPertanggungjawabanPanjar(db, {
      id: 'p1',
      alasan: 'Salah kategori realisasi',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

    expect(insertReversalUntuk(jurnalCloseId)).toMatchObject({ sumber: 'REVERSAL' });
  });

  it('batal pembayaran pinjaman mengirim sumber REVERSAL', () => {
    const db = dbKas();
    const { bayar } = buatPinjaman(db);
    expect(bayar('salah').tersimpan).toBe(true);

    const hasil = batalkanPembayaranPinjaman(db, {
      id: 'salah',
      alasan: 'Nominal salah dicatat',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

    expect(insertReversalUntuk('j-salah')).toEqual({
      id: hasil.jurnal!.id,
      jenis: 'REVERSAL',
      reversal_of: 'j-salah',
      sumber: 'REVERSAL',
    });
  });

  it('batal pencairan pinjaman mengirim sumber REVERSAL', () => {
    const db = dbKas();
    const { pinjamanId, bayar } = buatPinjaman(db);
    expect(bayar('bayar').tersimpan).toBe(true);
    const jurnalPencairanId = getPinjaman(db, pinjamanId)!.jurnal_pencairan_id!;
    expect(jurnalPencairanId).toBeTruthy();

    expect(
      batalkanPembayaranPinjaman(db, {
        id: 'bayar',
        alasan: 'Pembayaran dibatalkan lebih dulu',
      }).tersimpan,
    ).toBe(true);
    const hasil = batalkanPinjaman(db, {
      id: pinjamanId,
      alasan: 'Pencairan salah dicatat',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

    expect(insertReversalUntuk(jurnalPencairanId)).toEqual({
      id: hasil.jurnal!.id,
      jenis: 'REVERSAL',
      reversal_of: jurnalPencairanId,
      sumber: 'REVERSAL',
    });
  });
});
