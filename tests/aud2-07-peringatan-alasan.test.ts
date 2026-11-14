// AUD2-07: alasan peringatan wajib konsisten di serah panjar, reversal, dan
// pembatalan panjar. Test ini merekam opsi yang diteruskan ke posting layer
// agar `alasanPeringatan` + `wajibAlasanPeringatan` tidak hanya diasumsikan.

import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

type OpsiPostingRekam = {
  konfirmasiPeringatan?: boolean;
  alasanPeringatan?: string;
  wajibAlasanPeringatan?: boolean;
};

const rekaman = vi.hoisted(() => [] as OpsiPostingRekam[]);

vi.mock('../src/db/posting.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/db/posting.js')>();
  return {
    ...actual,
    postingJurnal: (
      db: Parameters<typeof actual.postingJurnal>[0],
      input: Parameters<typeof actual.postingJurnal>[1],
      opsi: Parameters<typeof actual.postingJurnal>[2] = {},
    ) => {
      rekaman.push({ ...opsi });
      return actual.postingJurnal(db, input, opsi);
    },
  };
});

import { AKUN_MODAL } from '../src/db/coa.js';
import { openDb } from '../src/db/database.js';
import { batalPanjarV2, serahkanPanjar } from '../src/db/panjar.js';
import { postingJurnal } from '../src/db/posting.js';
import { listAuditLog, listJurnal } from '../src/db/repository.js';
import { reverseJurnal } from '../src/db/reversal.js';
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

function dbKas(nominal = RP(100_000)): Database.Database {
  const db = openDb(':memory:');
  const awal = postingJurnal(db, {
    header: {
      id: 'awal-aud2-07',
      tanggal: '2026-01-01',
      no_bukti: 'SA-AUD2-07',
      keterangan: 'Saldo awal uji AUD2-07',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', nominal), K(AKUN_MODAL, nominal)],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  rekaman.length = 0;
  return db;
}

function opsiTerakhir(): OpsiPostingRekam {
  const opsi = rekaman.at(-1);
  expect(opsi).toBeDefined();
  return opsi!;
}

describe('AUD2-07 — serah panjar meneruskan alasan peringatan', () => {
  it('menolak tanpa/pendek alasan, menyimpan dengan alasan valid, dan audit memuatnya', () => {
    const db = dbKas(RP(10_000_000));
    try {
      const input = {
        id: 'p-aud2-07',
        jurnalId: 'j-aud2-07',
        tanggal: '2026-02-01',
        penerima: 'Panitia AUD2-07',
        jumlah: RP(11_000_000),
        akunKasSumber: '1001',
      };

      const belum = serahkanPanjar(db, input);
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/akan minus/);
      expect(opsiTerakhir()).toMatchObject({
        konfirmasiPeringatan: false,
        wajibAlasanPeringatan: true,
      });

      for (const alasanPeringatan of [undefined, '', '   ', 'ok']) {
        const ditolak = serahkanPanjar(db, {
          ...input,
          konfirmasiPeringatan: true,
          ...(alasanPeringatan === undefined ? {} : { alasanPeringatan }),
        });
        expect(ditolak.tersimpan, String(alasanPeringatan)).toBe(false);
        expect(ditolak.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);
        expect(opsiTerakhir()).toMatchObject({
          konfirmasiPeringatan: true,
          wajibAlasanPeringatan: true,
        });
      }
      expect(listJurnal(db)).toHaveLength(1);

      const alasan = 'Kas minus disetujui pemilik';
      const tersimpan = serahkanPanjar(db, {
        ...input,
        konfirmasiPeringatan: true,
        alasanPeringatan: `  ${alasan}  `,
      });
      expect(tersimpan.tersimpan, tersimpan.errors.join(' ')).toBe(true);
      expect(opsiTerakhir()).toMatchObject({
        konfirmasiPeringatan: true,
        alasanPeringatan: alasan,
        wajibAlasanPeringatan: true,
      });

      const audit = listAuditLog(db, { aksi: 'PANJAR-OPEN' });
      expect(audit).toHaveLength(1);
      const data = JSON.parse(audit[0]!.data_baru_json) as {
        alasanPeringatan?: string;
      };
      expect(data.alasanPeringatan).toBe(alasan);
    } finally {
      db.close();
    }
  });
});

describe('AUD2-07 — reversal meneruskan alasan peringatan', () => {
  it('reverseJurnal memakai alasan.trim() + wajib alasan saat kas minus', () => {
    const db = dbKas();
    try {
      const masuk = postingJurnal(db, {
        header: {
          id: 'j-masuk-aud2-07',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-9001',
          keterangan: 'Penerimaan uji AUD2-07',
          jenis: 'TERIMA',
        },
        baris: [D('1001', RP(50_000)), K('4005', RP(50_000))],
      });
      expect(masuk.tersimpan, masuk.errors.join(' ')).toBe(true);
      const keluar = postingJurnal(db, {
        header: {
          id: 'j-keluar-aud2-07',
          tanggal: '2026-01-03',
          no_bukti: 'JU-2026-9002',
          keterangan: 'Belanja uji AUD2-07',
          jenis: 'BAYAR',
        },
        baris: [D('5000', RP(250_000)), K('1001', RP(250_000))],
      }, { konfirmasiPeringatan: true });
      expect(keluar.tersimpan, keluar.errors.join(' ')).toBe(true);
      rekaman.length = 0;

      const belum = reverseJurnal(db, 'j-masuk-aud2-07', 'Salah catat pendapatan', {
        id: 'j-balik-aud2-07',
        tanggal: '2026-01-04',
      });
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(opsiTerakhir()).toMatchObject({
        konfirmasiPeringatan: false,
        alasanPeringatan: 'Salah catat pendapatan',
        wajibAlasanPeringatan: true,
      });

      const alasan = 'Salah catat pendapatan';
      const lanjut = reverseJurnal(db, 'j-masuk-aud2-07', `  ${alasan}  `, {
        id: 'j-balik-aud2-07',
        tanggal: '2026-01-04',
        konfirmasiPeringatan: true,
      });
      expect(lanjut.tersimpan, lanjut.errors.join(' ')).toBe(true);
      expect(opsiTerakhir()).toMatchObject({
        konfirmasiPeringatan: true,
        alasanPeringatan: alasan,
        wajibAlasanPeringatan: true,
      });
    } finally {
      db.close();
    }
  });

  it('batalPanjarV2 memakai alasan.trim() + wajib alasan saat kas minus', () => {
    const db = dbKas(RP(1_000_000));
    try {
      const keluar = postingJurnal(db, {
        header: {
          id: 'j-keluar-batal-aud2-07',
          tanggal: '2026-01-10',
          no_bukti: 'JU-2026-9003',
          keterangan: 'Belanja sebelum panjar',
          jenis: 'BAYAR',
        },
        baris: [D('5000', RP(1_500_000)), K('1001', RP(1_500_000))],
      }, { konfirmasiPeringatan: true });
      expect(keluar.tersimpan, keluar.errors.join(' ')).toBe(true);

      const serah = serahkanPanjar(db, {
        id: 'p-batal-aud2-07',
        jurnalId: 'j-serah-batal-aud2-07',
        tanggal: '2026-02-01',
        penerima: 'Panitia Batal AUD2-07',
        jumlah: RP(500_000),
        akunKasSumber: '1001',
        konfirmasiPeringatan: true,
        alasanPeringatan: 'Kas minus disetujui pemilik',
      });
      expect(serah.tersimpan, serah.errors.join(' ')).toBe(true);
      rekaman.length = 0;

      const belum = batalPanjarV2(db, {
        id: 'p-batal-aud2-07',
        alasan: 'Salah serah panitia',
        jurnalId: 'j-batal-aud2-07',
        tanggalBatal: '2026-02-02',
      });
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(opsiTerakhir()).toMatchObject({
        konfirmasiPeringatan: false,
        alasanPeringatan: 'Salah serah panitia',
        wajibAlasanPeringatan: true,
      });

      const alasan = 'Salah serah panitia';
      const lanjut = batalPanjarV2(db, {
        id: 'p-batal-aud2-07',
        alasan: `  ${alasan}  `,
        jurnalId: 'j-batal-aud2-07',
        tanggalBatal: '2026-02-02',
        konfirmasiPeringatan: true,
      });
      expect(lanjut.tersimpan, lanjut.errors.join(' ')).toBe(true);
      expect(opsiTerakhir()).toMatchObject({
        konfirmasiPeringatan: true,
        alasanPeringatan: alasan,
        wajibAlasanPeringatan: true,
      });
    } finally {
      db.close();
    }
  });
});
