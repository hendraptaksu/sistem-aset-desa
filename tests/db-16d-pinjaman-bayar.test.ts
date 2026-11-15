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
// - cicilan dua jurnal pada satu angsuran tetap sah (T-B10: DDL tidak punya
//   UNIQUE angsuran_id), jurnal yang sama hanya boleh ditautkan sekali;
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
  laporanMutasiPinjaman,
  listPinjamanBayar,
  simpanPinjamanLpd,
  tautkanPembayaran,
  type BayarAngsuranPinjamanInput,
} from '../src/db/pinjaman.js';
import { rekonsiliasiPinjaman } from '../src/db/pinjamanRekonsiliasi.js';
import { getJurnalDetail } from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
import { tutupBuku } from '../src/db/tutup.js';
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

  it('tetap menulis tepat satu audit PINJAMAN-BAYAR tanpa aksi LINK', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const hasil = bayarAngsuranPinjaman(db, inputBayar(pinjamanId, angsuran[0].id));
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

    const audit = db
      .prepare(
        `SELECT aksi, ref_type, ref_id
           FROM audit_log
          WHERE aksi LIKE 'PINJAMAN-BAYAR%'
          ORDER BY id`,
      )
      .all() as { aksi: string; ref_type: string; ref_id: string }[];
    expect(audit).toEqual([
      {
        aksi: `PINJAMAN-BAYAR ${pinjamanId}`,
        ref_type: 'pinjaman',
        ref_id: pinjamanId,
      },
    ]);
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

  // T-B10: `pinjaman_bayar.angsuran_id` sengaja TANPA UNIQUE agar satu
  // angsuran boleh dicicil beberapa jurnal. Dua pembayaran (dua jurnal
  // berbeda) pada angsuran yang sama wajib tetap sah.
  it('menerima cicilan: dua jurnal berbeda pada angsuran yang sama tetap sah', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const a1 = angsuran[0];

    const cicil1 = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a1.id, {
        id: 'pby-cicil-1',
        jurnal_id: 'j-cicil-1',
        pokok: RP(2_000_000),
        bunga: RP(100_000),
        denda: 0,
      }),
    );
    expect(cicil1.tersimpan, cicil1.errors.join(' ')).toBe(true);

    const setengahJalan = getPinjaman(db, pinjamanId)!.angsuran?.find(
      (a) => a.id === a1.id,
    );
    expect(setengahJalan).toMatchObject({
      status: 'SEBAGIAN',
      dibayar: false,
      jumlah_pembayaran: 1,
    });
    expect(setengahJalan?.sisa_pokok).toBe(RP(2_000_000));

    const cicil2 = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a1.id, {
        id: 'pby-cicil-2',
        jurnal_id: 'j-cicil-2',
        tanggal: '2026-03-15',
        pokok: RP(2_000_000),
        bunga: 0,
        denda: 0,
      }),
    );
    // Penjaga dead-code: kalau DDL mendapat UNIQUE(angsuran_id) atau handler
    // "satu angsuran hanya boleh dibayar sekali" dihidupkan lagi, insert
    // kedua ini gagal dan test merah.
    expect(cicil2.tersimpan, cicil2.errors.join(' ')).toBe(true);

    const baris = listPinjamanBayar(db, pinjamanId).filter(
      (p) => p.angsuran_id === a1.id,
    );
    expect(baris).toHaveLength(2);
    expect(new Set(baris.map((p) => p.jurnal_id))).toEqual(
      new Set(['j-cicil-1', 'j-cicil-2']),
    );

    const lunas = getPinjaman(db, pinjamanId)!.angsuran?.find(
      (a) => a.id === a1.id,
    );
    expect(lunas).toMatchObject({
      status: 'LUNAS',
      dibayar: true,
      jumlah_pembayaran: 2,
      sisa_pokok: 0,
    });
    expect(getPinjaman(db, pinjamanId)!.total_pokok_dibayar).toBe(RP(4_000_000));
    expect(getPinjaman(db, pinjamanId)!.outstanding).toBe(RP(8_000_000));
  });

  // T-B10: UNIQUE yang benar-benar ada di DDL adalah `jurnal_id`. Jurnal yang
  // sudah ditautkan tidak boleh dipakai pembayaran lain, dan pesannya tetap
  // konsisten dengan docstring ("satu jurnal hanya boleh ditautkan sekali").
  it('menolak jurnal yang sudah ditautkan dipakai pembayaran lain', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);
    const a1 = angsuran[0];
    const a2 = angsuran[1];
    const jurnalAwal = jumlahJurnal(db);

    const pertama = bayarAngsuranPinjaman(db, inputBayar(pinjamanId, a1.id));
    expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);
    const jurnalPertama = pertama.jurnal!.id;

    const ganda = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, a2.id, {
        id: 'pby-jurnal-ganda',
        jurnal_id: jurnalPertama,
      }),
    );
    expect(ganda.tersimpan).toBe(false);
    expect(ganda.errors.join(' ')).toMatch(
      new RegExp(`Jurnal ${jurnalPertama} sudah ditautkan ke pembayaran`),
    );
    expect(jumlahJurnal(db)).toBe(jurnalAwal + 1);
    expect(jumlahBayar(db)).toBe(1);
    expect(
      listPinjamanBayar(db, pinjamanId).filter((p) => p.angsuran_id === a2.id),
    ).toHaveLength(0);
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

describe('DB-16d — T-B05: jurnal dua-sisi 2050 ditolak dan angka neto diseragamkan', () => {
  /**
   * Jurnal pembayaran yang memuat debit DAN kredit 2050 sekaligus (dua baris).
   * Seimbang secara debit-kredit, tetapi tidak pernah dihasilkan builder
   * pinjaman (satu sisi saja); hanya muncul dari edit manual/data lama.
   */
  function buatJurnalDuaSisi2050(db: Database.Database): void {
    const hasil = postingJurnal(db, {
      header: {
        id: 'j-dua-sisi-2050',
        tanggal: '2026-03-01',
        no_bukti: 'BAYAR-DUA-SISI',
        keterangan: 'Pembayaran angsuran dengan baris 2050 dua sisi (uji T-B05)',
        jenis: 'HUTANG',
      },
      baris: [
        D('2050', RP(4_000_000)),
        K('2050', RP(1_000_000)),
        D(AKUN_BUNGA_PINJAMAN_DEFAULT, RP(100_000)),
        D(AKUN_DENDA_PINJAMAN_DEFAULT, RP(50_000)),
        K('1014', RP(3_150_000)),
      ],
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  }

  it('menolak menautkan jurnal pembayaran yang memuat debit DAN kredit 2050 sekaligus', () => {
    const db = dbKas();
    const { pinjamanId } = pinjamanUji(db);
    buatJurnalDuaSisi2050(db);

    const hasil = tautkanPembayaran(db, {
      pinjaman_id: pinjamanId,
      jurnal_id: 'j-dua-sisi-2050',
      tanggal: '2026-03-01',
      catatan: 'Percobaan taut dua sisi 2050',
    });

    expect(hasil.tersimpan).toBe(false);
    // Pesan operator: 2050 pada jurnal pembayaran hanya boleh satu sisi.
    expect(hasil.errors.join(' ')).toContain('2050');
    expect(hasil.errors.join(' ')).toMatch(/satu sisi/i);
    expect(jumlahBayar(db)).toBe(0);
    expect(getPinjaman(db, pinjamanId)!.outstanding).toBe(RP(12_000_000));
  });

  it('jaring pengaman neto: header, mutasi, dan rekonsiliasi sama untuk link lama dua-sisi 2050', () => {
    const db = dbKas();
    const { pinjamanId } = pinjamanUji(db);
    buatJurnalDuaSisi2050(db);

    // Simulasikan data lama: link dibuat sebelum validasi satu-sisi ada,
    // sehingga perhitungan neto tetap menjaga laporan konsisten.
    db.prepare(
      `INSERT INTO pinjaman_bayar (id, pinjaman_id, angsuran_id, jurnal_id, tanggal, catatan, created_at)
       VALUES ('pby-dua-sisi', ?, NULL, 'j-dua-sisi-2050', '2026-03-01', 'link lama dua sisi', '2026-03-01T00:00:00.000Z')`,
    ).run(pinjamanId);

    const header = getPinjaman(db, pinjamanId)!;
    const laporan = laporanMutasiPinjaman(db, pinjamanId, {
      periode: '2026-03',
    });
    const rekonsiliasi = rekonsiliasiPinjaman(db, pinjamanId)!;

    // Neto pokok = debit 4 juta - kredit 1 juta = 3 juta; kas keluar = 3,15 juta.
    expect(header.total_pokok_dibayar).toBe(RP(3_000_000));
    expect(header.outstanding).toBe(RP(9_000_000));
    // Mutasi memakai neto sejak awal; wajib sama dengan outstanding header.
    expect(laporan.outstanding).toBe(header.outstanding);
    expect(laporan.outstanding).toBe(RP(9_000_000));
    // Rekonsiliasi GL-vs-jadwal juga neto dan tetap cocok.
    expect(rekonsiliasi).toMatchObject({
      gl: RP(9_000_000),
      jadwal: RP(9_000_000),
      selisih: 0,
      cocok: true,
    });
  });
});

describe('DB-16d — T-B06: debit beban non-bunga wajib konfirmasi (peringatan, bukan error)', () => {
  const IPC = baca('src/main/ipc.ts');
  const API = baca('src/renderer/lib/api.ts');
  const UI = baca('src/renderer/components/PinjamanTab.tsx');
  const SERVICE = baca('src/db/pinjaman.ts');

  /**
   * Jurnal pembayaran manual yang menaruh nominal bunga ke akun BEBAN lain
   * (5040 BIAYA ADMINISTRASI DAN PAJAK BANK) — bukan akun bunga pinjaman
   * (5063) dan bukan 5050 denda modul. Klasifikasi lama menghitung debit ini
   * sebagai denda sehingga sisa bunga tidak pernah nol; T-B06 menuntut
   * peringatan + konfirmasi operator TANPA mengubah klasifikasi tersebut.
   */
  function buatJurnalBebanLain(db: Database.Database): void {
    const hasil = postingJurnal(db, {
      header: {
        id: 'j-beban-lain',
        tanggal: '2026-03-01',
        no_bukti: 'BAYAR-BEBAN-LAIN',
        keterangan: 'Pembayaran angsuran dengan debit beban non-bunga (uji T-B06)',
        jenis: 'HUTANG',
      },
      baris: [
        D('2050', RP(4_000_000)),
        D('5040', RP(150_000)),
        K('1014', RP(4_150_000)),
      ],
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  }

  function auditLink(
    db: Database.Database,
  ): { aksi: string; alasan: string; data_baru_json: string }[] {
    return db
      .prepare(
        `SELECT aksi, alasan, data_baru_json
           FROM audit_log
          WHERE aksi LIKE 'PINJAMAN-BAYAR-LINK%'
          ORDER BY id`,
      )
      .all() as { aksi: string; alasan: string; data_baru_json: string }[];
  }

  it('menautkan jurnal dengan debit beban non-bunga menunggu konfirmasi dan tidak menulis apa pun', () => {
    const db = dbKas();
    const { pinjamanId } = pinjamanUji(db);
    buatJurnalBebanLain(db);
    const jurnalAwal = jumlahJurnal(db);

    const tanpaKonfirmasi = tautkanPembayaran(db, {
      pinjaman_id: pinjamanId,
      jurnal_id: 'j-beban-lain',
      tanggal: '2026-03-01',
      catatan: 'Bunga dibayar lewat akun lain',
    });

    expect(tanpaKonfirmasi.tersimpan).toBe(false);
    expect(tanpaKonfirmasi.perluKonfirmasi).toBe(true);
    const pesan = tanpaKonfirmasi.errors.join(' ');
    expect(pesan).toMatch(/bukan akun bunga pinjaman/i);
    expect(pesan).toMatch(/dihitung sebagai denda/i);
    expect(pesan).toContain('BIAYA ADMINISTRASI DAN PAJAK BANK');
    expect(pesan).toContain('Rp 150.000');
    // Tidak ada tulisan: jurnal, link, outstanding, dan audit tetap.
    expect(jumlahJurnal(db)).toBe(jurnalAwal);
    expect(jumlahBayar(db)).toBe(0);
    expect(getPinjaman(db, pinjamanId)!.outstanding).toBe(RP(12_000_000));
    expect(auditLink(db)).toHaveLength(0);
  });

  it('konfirmasi tanpa alasan cukup tetap ditolak tanpa menulis', () => {
    const db = dbKas();
    const { pinjamanId } = pinjamanUji(db);
    buatJurnalBebanLain(db);
    const opsiTanpaAlasan = {
      pinjaman_id: pinjamanId,
      jurnal_id: 'j-beban-lain',
      tanggal: '2026-03-01',
    } as const;

    const tanpaAlasan = tautkanPembayaran(db, opsiTanpaAlasan, {
      konfirmasiDendaLain: true,
    });
    expect(tanpaAlasan.tersimpan).toBe(false);
    expect(tanpaAlasan.perluKonfirmasi).toBe(true);
    expect(tanpaAlasan.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);

    const alasanPendek = tautkanPembayaran(db, opsiTanpaAlasan, {
      konfirmasiDendaLain: true,
      alasanDendaLain: 'ok',
    });
    expect(alasanPendek.tersimpan).toBe(false);
    expect(alasanPendek.perluKonfirmasi).toBe(true);
    expect(alasanPendek.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);
    expect(jumlahBayar(db)).toBe(0);
    expect(auditLink(db)).toHaveLength(0);
  });

  it('setelah dikonfirmasi dengan alasan, pembayaran berjalan, klasifikasi denda tetap, dan audit mencatat', () => {
    const db = dbKas();
    const { pinjamanId } = pinjamanUji(db);
    buatJurnalBebanLain(db);

    const dikonfirmasi = tautkanPembayaran(
      db,
      {
        pinjaman_id: pinjamanId,
        jurnal_id: 'j-beban-lain',
        tanggal: '2026-03-01',
        catatan: 'Bunga sengaja dibayar lewat akun biaya bank',
      },
      {
        konfirmasiDendaLain: true,
        alasanDendaLain: 'bunga dibayar ke akun biaya bank sesuai instruksi pengurus',
      },
    );
    expect(dikonfirmasi.tersimpan, dikonfirmasi.errors.join(' ')).toBe(true);

    // Klasifikasi TIDAK berubah (keputusan pemilik): debit 5040 tetap denda.
    expect(getPembayaranPinjaman(db, dikonfirmasi.pembayaran!.id)).toMatchObject({
      pokok: RP(4_000_000),
      bunga: 0,
      denda: RP(150_000),
      kas_keluar: RP(4_150_000),
    });
    expect(getPinjaman(db, pinjamanId)!.outstanding).toBe(RP(8_000_000));

    const audit = auditLink(db);
    expect(audit).toHaveLength(1);
    expect(audit[0].data_baru_json).toContain('dendaLainDikonfirmasi');
    expect(audit[0].data_baru_json).toContain('5040');
    expect(audit[0].alasan).toMatch(/debit beban non-bunga dikonfirmasi/i);
    expect(audit[0].alasan).toContain('sesuai instruksi pengurus');
  });

  it('pembayaran normal (akun bunga + 5050) tetap berjalan tanpa dialog meski flag dikirim', () => {
    const db = dbKas();
    const { pinjamanId, angsuran } = pinjamanUji(db);

    const hasil = bayarAngsuranPinjaman(
      db,
      inputBayar(pinjamanId, angsuran[0].id),
      { konfirmasiDendaLain: true, alasanDendaLain: 'tanpa debit beban lain' },
    );
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.perluKonfirmasi).toBe(false);
    expect(hasil.rincian).toMatchObject({
      bunga: RP(100_000),
      denda: RP(50_000),
    });
  });

  it('IPC, API, UI, dan service meneruskan flag konfirmasi denda lain', () => {
    expect(SERVICE).toContain('konfirmasiDendaLain');
    expect(SERVICE).toContain('alasanDendaLain');
    expect(IPC).toContain('konfirmasiDendaLain');
    expect(IPC).toContain('alasanDendaLain');
    expect(API).toContain('konfirmasiDendaLain');
    expect(UI).toContain('konfirmasiDendaLain');
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
    expect(PANDUAN).toContain('selisih');
    expect(PANDUAN).toContain('denda');
    expect(PANDUAN).toContain('jurnal');
  });
});

describe('Kunci periode — pinjaman memakai alasan koreksi yang sama', () => {
  it('menolak pencairan/pembayaran tanpa alasan dan menerimanya dengan alasan', () => {
    const db = openDb(':memory:');
    dbTerbuka.push(db);

    const awal = simpanSaldoAwal(db, {
      header: {
        id: 'awal-kunci-pinjaman',
        tanggal: '2025-01-01',
        no_bukti: 'SA-KUNCI',
        keterangan: 'Saldo awal uji kunci periode pinjaman',
        jenis: 'SALDO_AWAL',
      },
      baris: [D('1001', RP(10_000_000)), K(AKUN_MODAL, RP(10_000_000))],
    });
    expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

    const dibuat = simpanPinjamanLpd(
      db,
      {
        id: 'pjr-kunci',
        mode: 'PENCAIRAN',
        kreditur: 'LPD Uji Kunci',
        tanggal: '2025-01-02',
        akunKas: '1001',
        pokok: RP(1_000_000),
        angsuran: [
          {
            ke: 1,
            jatuh_tempo: '2025-02-01',
            pokok: RP(1_000_000),
            bunga: 0,
            catatan: '',
          },
        ],
      },
      { sekarang: '2026-11-15' },
    );
    expect(dibuat.tersimpan, dibuat.errors.join(' ')).toBe(true);

    const tutup = tutupBuku(db, 2025, { sekarang: '2026-11-15' });
    expect(tutup.tersimpan, tutup.errors.join(' ')).toBe(true);

    const angsuranId = dibuat.pinjaman!.angsuran![0]!.id;
    const bayar = {
      id: 'pby-kunci',
      jurnal_id: 'j-bayar-kunci',
      pinjaman_id: 'pjr-kunci',
      angsuran_id: angsuranId,
      tanggal: '2025-03-01',
      akun_kas: '1001',
      pokok: RP(500_000),
      bunga: 0,
      denda: 0,
      catatan: 'Pembayaran uji kunci',
    };
    const gagal = bayarAngsuranPinjaman(db, bayar, { sekarang: '2026-11-15' });
    expect(gagal.tersimpan).toBe(false);
    expect(gagal.errors.join(' ')).toMatch(/Periode sudah ditutup/);
    expect(listPinjamanBayar(db, 'pjr-kunci')).toHaveLength(0);

    const berhasil = bayarAngsuranPinjaman(db, bayar, {
      sekarang: '2026-11-15',
      alasanPeringatan: 'Koreksi pembayaran tahun lalu',
    });
    expect(berhasil.tersimpan, berhasil.errors.join(' ')).toBe(true);
    expect(berhasil.jurnal?.tanggal).toBe('2025-03-01');
    const auditBayar = db
      .prepare(
        "SELECT alasan FROM audit_log WHERE ref_type = 'jurnal' AND ref_id = ?",
      )
      .get(berhasil.jurnal!.id) as { alasan: string } | undefined;
    expect(auditBayar?.alasan).toBe('Koreksi pembayaran tahun lalu');

    const dasarPencairan = {
      id: 'pjr-kunci-2',
      mode: 'PENCAIRAN' as const,
      kreditur: 'LPD Uji Kunci 2',
      tanggal: '2025-04-01',
      akunKas: '1001',
      pokok: RP(2_000_000),
      angsuran: [
        {
          ke: 1,
          jatuh_tempo: '2025-05-01',
          pokok: RP(2_000_000),
          bunga: 0,
          catatan: '',
        },
      ],
    };
    const pencairanGagal = simpanPinjamanLpd(db, dasarPencairan, {
      sekarang: '2026-11-15',
    });
    expect(pencairanGagal.tersimpan).toBe(false);
    expect(pencairanGagal.errors.join(' ')).toMatch(/Periode sudah ditutup/);
    expect(getPinjaman(db, 'pjr-kunci-2')).toBeNull();

    const pencairanBerhasil = simpanPinjamanLpd(db, dasarPencairan, {
      sekarang: '2026-11-15',
      alasanPeringatan: 'Koreksi pencairan tahun lalu',
    });
    expect(pencairanBerhasil.tersimpan, pencairanBerhasil.errors.join(' ')).toBe(
      true,
    );
    expect(pencairanBerhasil.jurnal?.tanggal).toBe('2025-04-01');
  });
});
