// T2.3 — regresi pembayaran pinjaman bunga saja.
//
// Pembayaran bunga tanpa pokok membuat jurnal berjenis HUTANG yang TIDAK
// memuat akun 2050. Deteksi lama (jenis HUTANG + akun 2050) menganggapnya
// jurnal biasa sehingga tombol "Batalkan" di Transaksi muncul, padahal
// pembatalan wajib lewat modul Pinjaman agar status pembayaran ikut berubah.
//
// Test ini memakai API pinjaman asli (`simpanPinjamanLpd` +
// `bayarAngsuranPinjaman`), bukan insert jurnal manual, supaya bentuk jurnal
// yang diuji sama dengan produksi.

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  validasiBentukPembatalanPinjaman,
  validasiBentukPinjamanBayar,
} from '../src/main/validation.js';
import {
  bayarAngsuranPinjaman,
  batalkanPembayaranPinjaman,
  getPembayaranPinjaman,
  simpanPinjamanLpd,
} from '../src/db/pinjaman.js';
import {
  kemampuanKoreksiJurnal,
  PESAN_REVERSAL_PINJAMAN,
} from '../src/db/kemampuanKoreksi.js';
import { getJurnalDetail, listJurnalLengkap } from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { reverseJurnal } from '../src/db/reversal.js';
import { AKUN_MODAL } from '../src/db/coa.js';
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

const dbTerbuka: Database.Database[] = [];

function dbKas(): Database.Database {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  const awal = postingJurnal(db, {
    header: {
      id: 'awal-t23',
      tanggal: '2026-01-01',
      no_bukti: 'SA-T23',
      keterangan: 'Saldo awal uji pembayaran bunga saja',
      jenis: 'SALDO_AWAL',
    },
    baris: [
      D('1001', RP(100_000_000)),
      D('1014', RP(50_000_000)),
      K(AKUN_MODAL, RP(150_000_000)),
    ],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

afterEach(() => {
  for (const db of dbTerbuka.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup test */
    }
  }
});

/**
 * Pinjaman 12 juta (2 angsuran) lewat wizard asli, lalu bayar bunga saja
 * pada angsuran pertama. Jurnal pembayaran yang dihasilkan: D 5063 / K kas,
 * tanpa baris 2050.
 */
function buatPembayaranBungaSaja(db: Database.Database): string {
  const simpan = simpanPinjamanLpd(db, {
    id: 'pjr-t23',
    mode: 'PENCAIRAN',
    kreditur: 'LPD Desa Adat',
    tanggal: '2026-01-02',
    akunKas: '1014',
    akunBunga: '5063',
    pokok: RP(12_000_000),
    tenor: 2,
    catatan: 'Pinjaman uji T2.3',
    angsuran: [
      {
        ke: 1,
        jatuh_tempo: '2026-02-01',
        pokok: RP(6_000_000),
        bunga: RP(100_000),
      },
      {
        ke: 2,
        jatuh_tempo: '2026-03-01',
        pokok: RP(6_000_000),
        bunga: RP(100_000),
      },
    ],
  });
  expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);
  const angsuran = simpan.pinjaman?.angsuran?.[0];
  expect(angsuran).toBeDefined();

  const bayar = bayarAngsuranPinjaman(db, {
    id: 'pby-bunga-saja',
    jurnal_id: 'j-bayar-bunga-saja',
    pinjaman_id: 'pjr-t23',
    angsuran_id: angsuran?.id,
    tanggal: '2026-02-01',
    akun_kas: '1014',
    pokok: 0,
    bunga: RP(100_000),
    catatan: 'Bunga saja',
  });
  expect(bayar.tersimpan, bayar.errors.join(' ')).toBe(true);
  expect(bayar.jurnal).toBeDefined();
  return bayar.jurnal!.id;
}

describe('T2.3 — pembayaran bunga saja tidak bisa dibatalkan dari Transaksi', () => {
  it('capability dan DTO menolak jurnal HUTANG tanpa 2050 dengan alasan Pinjaman', () => {
    const db = dbKas();
    const jurnalId = buatPembayaranBungaSaja(db);

    const detail = getJurnalDetail(db, jurnalId);
    expect(detail).not.toBeNull();
    // Heuristik lama hanya melihat jenis HUTANG + akun 2050; bentuk jurnal
    // inilah yang membuat deteksi lama salah mengizinkan pembatalan.
    expect(detail?.jurnal.jenis).toBe('HUTANG');
    const akun = (detail?.baris ?? []).map((b) => b.akun_kode);
    expect(akun).toContain('5063');
    expect(akun).not.toContain('2050');

    expect(kemampuanKoreksiJurnal(db, { id: jurnalId })).toEqual({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL_PINJAMAN,
    });
    expect(PESAN_REVERSAL_PINJAMAN).toMatch(/Pinjaman/);

    const baris = listJurnalLengkap(db).find((j) => j.id === jurnalId);
    expect(baris).toBeDefined();
    expect(baris).toMatchObject({
      bisa_dibalik: false,
      bisa_dikoreksi: false,
    });
    expect(baris?.alasan_tidak_bisa).toContain('Pinjaman');
  });

  it('pembatalan generik ditolak dan hanya modul Pinjaman yang bisa membatalkan', () => {
    const db = dbKas();
    const jurnalId = buatPembayaranBungaSaja(db);
    const jumlahJurnal = (
      db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }
    ).n;

    const salahJalur = reverseJurnal(db, jurnalId, 'salah input bunga');
    expect(salahJalur.tersimpan).toBe(false);
    expect(salahJalur.errors.join(' ')).toContain('Pinjaman');
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n,
    ).toBe(jumlahJurnal);

    const batal = batalkanPembayaranPinjaman(db, {
      id: 'pby-bunga-saja',
      alasan: 'salah input bunga',
    });
    expect(batal.tersimpan, batal.errors.join(' ')).toBe(true);
    expect(getPembayaranPinjaman(db, 'pby-bunga-saja')?.dibatalkan).toBe(true);
  });
});

describe('DB-16g — kontrak pembatalan dan pembayaran sebagian pinjaman', () => {
  it('mewajibkan ID dan alasan koreksi, lalu hanya meneruskan field yang dikenal', () => {
    expect(validasiBentukPembatalanPinjaman(null).ok).toBe(false);
    expect(validasiBentukPembatalanPinjaman({ id: '', alasan: 'cukup alasan' }).ok).toBe(false);
    expect(validasiBentukPembatalanPinjaman({ id: 'bayar-1', alasan: 'abc' })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/minimal 5/i),
    });
    expect(
      validasiBentukPembatalanPinjaman({
        id: '  bayar-1  ',
        alasan: '  pembayaran salah input  ',
        akunKas: '1001',
        konfirmasiPeringatan: true,
      }),
    ).toEqual({
      ok: true,
      input: { id: 'bayar-1', alasan: 'pembayaran salah input' },
    });
  });

  it('mempertahankan ID pembayaran yang dipakai ulang saat submit dicoba lagi', () => {
    expect(
      validasiBentukPinjamanBayar({
        id: 'pby-retry-stabil',
        pinjamanId: 'pinjaman-1',
        angsuranId: 1,
        tanggal: '2026-02-01',
        akunKas: '1014',
        pokok: 100,
        bunga: 0,
      }),
    ).toMatchObject({ ok: true, input: { id: 'pby-retry-stabil' } });
  });

});
