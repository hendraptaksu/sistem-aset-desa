// DB-16d — form bayar angsuran pinjaman LPD: pokok + bunga + denda.
//
// Fokus:
// - satu pembayaran = satu jurnal seimbang 3–4 baris lewat `postingJurnal`;
// - D 2050 pokok menurunkan outstanding, bunga masuk BEBAN, denda masuk 5050,
//   kas dikredit sebesar total;
// - `pinjaman_bayar` tetap link-only (tanpa kolom nominal, DB-36);
// - selisih realisasi vs jadwal wajib konfirmasi + alasan dan TIDAK mengubah
//   jadwal;
// - pembayaran ganda, akun nonaktif, nominal negatif/nol, dan input bukan
//   bilangan bulat ditolak tanpa meninggalkan jurnal/link;
// - IPC/API/UI/dokumen tersedia dan memakai metadata akun dari DB.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import {
  AKUN_DENDA_PINJAMAN_DEFAULT,
  AKUN_BUNGA_PINJAMAN_DEFAULT,
  bayarAngsuranPinjaman,
  getPembayaranPinjaman,
  getPinjaman,
  listPinjamanBayar,
  simpanPinjamanLpd,
  type BayarAngsuranPinjamanInput,
} from '../src/db/pinjaman.js';
import { getJurnalDetail } from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { validasiBentukPinjamanBayar } from '../src/main/validation.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

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

type JadwalUji = {
  ke: number;
  jatuh_tempo: string;
  pokok: number;
  bunga: number;
  catatan: string;
};

function jadwal(total: number, jumlah = 3): JadwalUji[] {
  const dasar = Math.floor(total / jumlah);
  const sisa = total - dasar * jumlah;
  return Array.from({ length: jumlah }, (_, i) => ({
    ke: i + 1,
    jatuh_tempo: `2026-0${i + 2}-01`,
    pokok: i === jumlah - 1 ? dasar + sisa : dasar,
    bunga: RP(100_000),
    catatan: `Angsuran ${i + 1}`,
  }));
}

const dbTerbuka: Database.Database[] = [];

function dbKas(): Database.Database {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  const awal = postingJurnal(db, {
    header: {
      id: 'awal-16d',
      tanggal: '2026-01-01',
      no_bukti: 'SA-16D',
      keterangan: 'Saldo awal uji bayar angsuran',
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

/** Pinjaman pencairan 12 juta, 3 angsuran @4 juta + bunga 100 ribu. */
function pinjamanUji(db: Database.Database): {
  pinjamanId: string;
  angsuran: { id: number; ke: number; pokok: number; bunga: number }[];
} {
  const total = RP(12_000_000);
  const hasil = simpanPinjamanLpd(db, {
    id: 'pjr-16d',
    mode: 'PENCAIRAN',
    kreditur: 'LPD Desa Adat',
    tanggal: '2026-01-02',
    akunKas: '1014',
    akunBunga: AKUN_BUNGA_PINJAMAN_DEFAULT,
    pokok: total,
    tenor: 3,
    catatan: 'Pinjaman uji DB-16d',
    angsuran: jadwal(total),
  });
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  expect(hasil.pinjaman?.angsuran).toHaveLength(3);
  return {
    pinjamanId: hasil.pinjaman!.id,
    angsuran: (hasil.pinjaman!.angsuran ?? []).map((a) => ({
      id: a.id,
      ke: a.ke,
      pokok: a.pokok,
      bunga: a.bunga,
    })),
  };
}

function inputBayar(
  pinjamanId: string,
  angsuranId: number,
  overrides: Partial<BayarAngsuranPinjamanInput> = {},
): BayarAngsuranPinjamanInput {
  return {
    id: `pby-${angsuranId}`,
    jurnal_id: `j-bayar-${angsuranId}`,
    pinjaman_id: pinjamanId,
    angsuran_id: angsuranId,
    tanggal: '2026-03-01',
    akun_kas: '1014',
    pokok: RP(4_000_000),
    bunga: RP(100_000),
    denda: RP(50_000),
    catatan: 'Realisasi angsuran',
    ...overrides,
  };
}

function jumlahJurnal(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n;
}

function jumlahBayar(db: Database.Database): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM pinjaman_bayar').get() as {
    n: number;
  }).n;
}

function aksiAudit(db: Database.Database): string[] {
  return (
    db.prepare('SELECT aksi FROM audit_log ORDER BY id').all() as {
      aksi: string;
    }[]
  ).map((r) => r.aksi);
}

afterEach(() => {
  for (const db of dbTerbuka.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup */
    }
  }
});

describe('DB-16d — jurnal pembayaran angsuran', () => {
  it('membuat jurnal 4 baris seimbang, menurunkan 2050, dan menandai LUNAS', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const a1 = angsuran[0];
    const sebelum = getPinjaman(db, pinjamanId)!;
    const sebelumJurnal = jumlahJurnal(db);

    const hasil = bayarAngsuranPinjaman(db, inputBayar(pinjamanId, a1.id));

    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.perluKonfirmasi).toBe(false);
    expect(hasil.jurnal).toMatchObject({ jenis: 'HUTANG' });
    expect(hasil.jurnal?.keterangan).toContain('LPD Desa Adat');
    expect(hasil.rincian).toEqual({
      pokok: RP(4_000_000),
      bunga: RP(100_000),
      denda: RP(50_000),
      kas_keluar: RP(4_150_000),
    });
    expect(hasil.pembayaran).toMatchObject({
      pinjaman_id: pinjamanId,
      angsuran_id: a1.id,
      jurnal_id: hasil.jurnal!.id,
      pokok: RP(4_000_000),
      bunga: RP(100_000),
      denda: RP(50_000),
      kas_keluar: RP(4_150_000),
    });
    expect(jumlahJurnal(db)).toBe(sebelumJurnal + 1);

    const detail = getJurnalDetail(db, hasil.jurnal!.id)!;
    const totalDebit = detail.baris.reduce((s, b) => s + b.debit, 0);
    const totalKredit = detail.baris.reduce((s, b) => s + b.kredit, 0);
    expect(detail.baris).toHaveLength(4);
    expect(totalDebit).toBe(RP(4_150_000));
    expect(totalKredit).toBe(totalDebit);
    expect(detail.baris).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          akun_kode: '2050',
          debit: RP(4_000_000),
          kredit: 0,
        }),
        expect.objectContaining({
          akun_kode: AKUN_BUNGA_PINJAMAN_DEFAULT,
          debit: RP(100_000),
          kredit: 0,
        }),
        expect.objectContaining({
          akun_kode: AKUN_DENDA_PINJAMAN_DEFAULT,
          debit: RP(50_000),
          kredit: 0,
        }),
        expect.objectContaining({
          akun_kode: '1014',
          debit: 0,
          kredit: RP(4_150_000),
        }),
      ]),
    );

    const sesudah = getPinjaman(db, pinjamanId)!;
    expect(sesudah.outstanding).toBe(sebelum.outstanding! - RP(4_000_000));
    expect(sesudah.total_pokok_dibayar).toBe(RP(4_000_000));
    expect(sesudah.total_bunga_dibayar).toBe(RP(100_000));
    expect(sesudah.total_denda_dibayar).toBe(RP(50_000));
    expect(sesudah.angsuran?.find((a) => a.id === a1.id)).toMatchObject({
      status: 'LUNAS',
      dibayar: true,
      pinjaman_bayar_id: hasil.pembayaran!.id,
      tanggal_bayar: '2026-03-01',
      jurnal_id: hasil.jurnal!.id,
    });
    expect(sesudah.angsuran?.filter((a) => a.status === 'BELUM')).toHaveLength(2);
    expect(listPinjamanBayar(db, pinjamanId)).toHaveLength(1);
    expect(getPembayaranPinjaman(db, hasil.pembayaran!.id)?.pokok).toBe(
      RP(4_000_000),
    );
    expect(aksiAudit(db).some((a) => a.startsWith('PINJAMAN-BAYAR'))).toBe(true);
  });

  it('menerima 3 baris tanpa denda dan komponen bunga saja (pokok 0)', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);

    const tanpaDenda = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, angsuran[0].id, {
        denda: 0,
        jurnal_id: 'j-tanpa-denda',
        id: 'pby-tanpa-denda',
      }),
    );
    expect(tanpaDenda.tersimpan, tanpaDenda.errors.join(' ')).toBe(true);
    expect(getJurnalDetail(db, tanpaDenda.jurnal!.id)!.baris).toHaveLength(3);

    const sebelumOutstanding = getPinjaman(db, pinjamanId)!.outstanding;
    const bungaSaja = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, angsuran[1].id, {
        pokok: 0,
        bunga: RP(250_000),
        denda: 0,
        jurnal_id: 'j-bunga-saja',
        id: 'pby-bunga-saja',
        tanggal: '2026-04-01',
      }),
      {
        konfirmasiSelisih: true,
        alasanSelisih: 'kesepakatan bunga berjalan',
      },
    );
    expect(bungaSaja.tersimpan, bungaSaja.errors.join(' ')).toBe(true);
    const detail = getJurnalDetail(db, bungaSaja.jurnal!.id)!;
    expect(detail.baris).toHaveLength(2);
    expect(
      detail.baris.some((b) => b.akun_kode === '2050'),
    ).toBe(false);
    expect(detail.baris).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          akun_kode: AKUN_BUNGA_PINJAMAN_DEFAULT,
          debit: RP(250_000),
        }),
        expect.objectContaining({
          akun_kode: '1014',
          kredit: RP(250_000),
        }),
      ]),
    );
    expect(getPinjaman(db, pinjamanId)!.outstanding).toBe(sebelumOutstanding);
  });

  it('menyimpan pinjaman_bayar link-only tanpa kolom nominal (DB-36)', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const hasil = bayarAngsuranPinjaman(db, inputBayar(pinjamanId, angsuran[0].id));
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

    const kolom = (db.pragma('table_info(pinjaman_bayar)') as { name: string }[]).map(
      (k) => k.name,
    );
    for (const nama of [
      'pokok',
      'bunga',
      'denda',
      'nominal',
      'kas_keluar',
      'total',
    ]) {
      expect(kolom, nama).not.toContain(nama);
    }
    const row = db
      .prepare('SELECT * FROM pinjaman_bayar WHERE id = ?')
      .get(hasil.pembayaran!.id) as Record<string, unknown>;
    expect(row).toMatchObject({
      pinjaman_id: pinjamanId,
      angsuran_id: angsuran[0].id,
      jurnal_id: hasil.jurnal!.id,
      tanggal: '2026-03-01',
      catatan: 'Realisasi angsuran',
    });
  });
});

describe('DB-16d — selisih jadwal dan penolakan', () => {
  it('mewajibkan konfirmasi + alasan saat nominal berbeda dan tidak mengubah jadwal', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const a2 = angsuran[1];
    const jurnalAwal = jumlahJurnal(db);
    const jadwalAwal = db
      .prepare('SELECT pokok, bunga FROM pinjaman_angsuran WHERE id = ?')
      .get(a2.id) as { pokok: number; bunga: number };

    const tanpaKonfirmasi = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a2.id, {
        pokok: RP(3_500_000),
        bunga: RP(150_000),
      }),
    );
    expect(tanpaKonfirmasi.tersimpan).toBe(false);
    expect(tanpaKonfirmasi.perluKonfirmasi).toBe(true);
    expect(tanpaKonfirmasi.errors.join(' ')).toMatch(/berbeda dari jadwal/i);
    expect(jumlahJurnal(db)).toBe(jurnalAwal);
    expect(jumlahBayar(db)).toBe(0);

    const alasanPendek = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a2.id, {
        pokok: RP(3_500_000),
        bunga: RP(150_000),
      }),
      { konfirmasiSelisih: true, alasanSelisih: 'ok' },
    );
    expect(alasanPendek.tersimpan).toBe(false);
    expect(alasanPendek.perluKonfirmasi).toBe(true);
    expect(alasanPendek.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);
    expect(jumlahJurnal(db)).toBe(jurnalAwal);

    const dikonfirmasi = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a2.id, {
        pokok: RP(3_500_000),
        bunga: RP(150_000),
        jurnal_id: 'j-selisih',
        id: 'pby-selisih',
      }),
      {
        konfirmasiSelisih: true,
        alasanSelisih: 'pembulatan sesuai kesepakatan LPD',
      },
    );
    expect(dikonfirmasi.tersimpan, dikonfirmasi.errors.join(' ')).toBe(true);
    expect(dikonfirmasi.selisih).toEqual({
      pokok: -RP(500_000),
      bunga: RP(50_000),
    });
    expect(getJurnalDetail(db, dikonfirmasi.jurnal!.id)!.jurnal.keterangan).toMatch(
      /pembulatan sesuai kesepakatan/i,
    );
    const jadwalSesudah = db
      .prepare('SELECT pokok, bunga FROM pinjaman_angsuran WHERE id = ?')
      .get(a2.id) as { pokok: number; bunga: number };
    expect(jadwalSesudah).toEqual(jadwalAwal);
    expect(getPinjaman(db, pinjamanId)!.total_pokok_dibayar).toBe(RP(3_500_000));
    const auditBayar = db
      .prepare(
        "SELECT data_baru_json FROM audit_log WHERE aksi LIKE 'PINJAMAN-BAYAR%'",
      )
      .all() as { data_baru_json: string }[];
    expect(auditBayar).toHaveLength(1);
    expect(auditBayar[0].data_baru_json).toContain('pembulatan');
  });

  it('menolak angsuran dibayar dua kali tanpa menambah jurnal/link', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const a1 = angsuran[0];
    const pertama = bayarAngsuranPinjaman(db, inputBayar(pinjamanId, a1.id));
    expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);
    const jurnal = jumlahJurnal(db);

    const kedua = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a1.id, {
        jurnal_id: 'j-bayar-ganda',
        id: 'pby-ganda',
        tanggal: '2026-04-01',
      }),
    );
    expect(kedua.tersimpan).toBe(false);
    expect(kedua.errors.join(' ')).toMatch(/sudah lunas/i);
    expect(jumlahJurnal(db)).toBe(jurnal);
    expect(jumlahBayar(db)).toBe(1);
    expect(getPinjaman(db, pinjamanId)!.outstanding).toBe(RP(8_000_000));
  });

  it('menolak akun kas nonaktif/bukan kas dan nominal negatif, pecahan, atau nol', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const a1 = angsuran[0];
    const jurnal = jumlahJurnal(db);
    db.prepare("UPDATE akun SET aktif = 0 WHERE kode = '1001'").run();

    const nonaktif = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a1.id, { akun_kas: '1001' }),
    );
    expect(nonaktif.tersimpan).toBe(false);
    expect(nonaktif.errors.join(' ')).toMatch(/akun kas/i);

    const bukanKas = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a1.id, { akun_kas: '2050' }),
    );
    expect(bukanKas.tersimpan).toBe(false);
    expect(bukanKas.errors.join(' ')).toMatch(/akun kas/i);

    for (const [label, patch] of [
      ['negatif', { pokok: -1 }],
      ['pecahan', { bunga: 1.5 }],
      ['nol', { pokok: 0, bunga: 0, denda: 0 }],
    ] as const) {
      const hasil = bayarAngsuranPinjaman(
        db,
        inputBayar(pinjamanId, a1.id, patch),
      );
      expect(hasil.tersimpan, label).toBe(false);
      expect(hasil.errors.join(' '), label).toMatch(
        /bilangan bulat|lebih dari 0/i,
      );
    }
    expect(jumlahJurnal(db)).toBe(jurnal);
    expect(jumlahBayar(db)).toBe(0);
    expect(getPinjaman(db, pinjamanId)!.angsuran?.[0]).toMatchObject({
      status: 'BELUM',
      dibayar: false,
    });
  });
});

describe('DB-16d — validasi bentuk, IPC, API, UI, dan dokumentasi', () => {
  const IPC = baca('src/main/ipc.ts');
  const VALIDATION = baca('src/main/validation.ts');
  const SERVICE = baca('src/db/pinjaman.ts');
  const API = baca('src/renderer/lib/api.ts');
  const UI = baca('src/renderer/components/PinjamanTab.tsx');
  const AUDIT_DETAIL = baca('src/utils/auditDetail.ts');
  const PANDUAN = baca('docs/panduan-pengguna.md');

  it('validasi bentuk menolak field wajib kosong, tanggal salah, dan nominal salah', () => {
    const dasar = {
      pinjamanId: 'pjr-1',
      angsuranId: 1,
      tanggal: '2026-03-01',
      akunKas: '1014',
      pokok: RP(1_000_000),
      bunga: RP(100_000),
      denda: 0,
    };
    expect(validasiBentukPinjamanBayar(dasar)).toMatchObject({ ok: true });

    for (const [patch, pola] of [
      [{ pinjamanId: '' }, /pinjaman/i],
      [{ angsuranId: 0 }, /angsuran/i],
      [{ tanggal: '2026-02-31' }, /tidak valid/i],
      [{ akunKas: '' }, /akun kas/i],
      [{ pokok: -1 }, /pokok/i],
      [{ bunga: 1.5 }, /bunga/i],
      [{ pokok: 0, bunga: 0, denda: 0 }, /lebih dari 0/i],
    ] as const) {
      const hasil = validasiBentukPinjamanBayar({ ...dasar, ...patch });
      expect(hasil.ok).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(pola);
    }
  });

  it('mendaftarkan channel pinjaman:bayar dan memakai service posting jurnal', () => {
    expect(IPC).toContain("'pinjaman:bayar'");
    expect(IPC).toContain('validasiBentukPinjamanBayar');
    expect(IPC).toContain('bayarAngsuranPinjaman');
    expect(IPC).toContain('konfirmasiSelisih');
    expect(VALIDATION).toContain('validasiBentukPinjamanBayar');
    expect(SERVICE).toContain('postingJurnal');
    expect(SERVICE).toContain('PINJAMAN-BAYAR');
    expect(SERVICE).toContain("jenis: 'HUTANG'");
    expect(AUDIT_DETAIL).toContain('PINJAMAN-BAYAR');
  });

  it('API renderer dan UI memakai endpoint bayar + metadata akun DB', () => {
    expect(API).toContain('pinjamanBayar');
    expect(API).toContain("'pinjaman:bayar'");
    expect(API).toContain('PinjamanBayarApi');
    expect(API).toContain('konfirmasiSelisih');
    expect(UI).toContain('Bayar Angsuran');
    expect(UI).toContain('api.pinjamanBayar');
    expect(UI).toContain('isAkunKasData');
    expect(UI).toContain('kasList');
    expect(UI).toContain('alasanSelisih');
    expect(UI).toContain('Sisa saat ini: pokok');
  });

  it('panduan pengguna menjelaskan form bayar, konfirmasi selisih, dan link-only', () => {
    expect(PANDUAN).toContain('Bayar Angsuran');
    expect(PANDUAN).toContain('DB-16d');
    expect(PANDUAN).toContain('selisih');
    expect(PANDUAN).toContain('denda');
    expect(PANDUAN).toContain('jurnal');
  });
});
