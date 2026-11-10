// DB-16b — repository pinjaman LPD.
//
// Fokus:
// - pinjaman + jadwal rencana tersimpan atomik; total pokok jadwal = sisa awal;
// - outstanding & status angsuran DITURUNKAN, tidak ada kolom saldo tersimpan;
// - pembayaran link-only: nominal pokok/bunga/denda dibaca dari jurnal;
// - link ganda dan jadwal salah ditolak tanpa menulis data setengah jadi.

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  bayarAngsuranPinjaman,
  buatPinjaman,
  catatPembayaran,
  getPembayaranPinjaman,
  getPinjaman,
  hitungOutstandingPinjaman,
  listPinjaman,
  listPinjamanBayar,
  rincianPembayaranDariJurnal,
  statusAngsuranPinjaman,
  tautkanPembayaran,
  type BuatPinjamanInput,
  type PinjamanAngsuranInput,
} from '../src/db/pinjaman.js';
import { postingJurnal } from '../src/db/posting.js';
import { getJurnalDetail, listAuditLog } from '../src/db/repository.js';
import {
  kemampuanKoreksiJurnal,
  PESAN_REVERSAL_PINJAMAN,
} from '../src/db/kemampuanKoreksi.js';
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
      id: 'awal',
      tanggal: '2026-01-01',
      no_bukti: 'SA-16B',
      keterangan: 'Saldo awal uji pinjaman',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', RP(100_000_000)), K(AKUN_MODAL, RP(100_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

function jurnalPencairan(
  db: Database.Database,
  id = 'j-cair',
  nominal = RP(12_000_000),
  tanggal = '2026-01-02',
): void {
  const hasil = postingJurnal(db, {
    header: {
      id,
      tanggal,
      no_bukti: `H-${id}`,
      keterangan: 'Pencairan pinjaman LPD',
      jenis: 'HUTANG',
    },
    baris: [D('1001', nominal), K('2050', nominal)],
  });
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
}

function jadwal(
  total: number,
  jumlah = 12,
  mulai = '2026-02-01',
): PinjamanAngsuranInput[] {
  const dasar = Math.floor(total / jumlah);
  const sisa = total - dasar * jumlah;
  const awal = new Date(`${mulai}T00:00:00.000Z`);
  return Array.from({ length: jumlah }, (_, i) => {
    const tgl = new Date(
      Date.UTC(awal.getUTCFullYear(), awal.getUTCMonth() + i, awal.getUTCDate()),
    );
    return {
      ke: i + 1,
      jatuh_tempo: tgl.toISOString().slice(0, 10),
      pokok: i === jumlah - 1 ? dasar + sisa : dasar,
      bunga: RP(100_000),
      catatan: `Angsuran ${i + 1}`,
    };
  });
}

function inputPinjaman(
  overrides: Partial<BuatPinjamanInput> = {},
): BuatPinjamanInput {
  const total = RP(12_000_000);
  return {
    id: 'pjr-1',
    kreditur: 'LPD Desa Adat',
    akun_kas: '1014',
    akun_bunga: '5063',
    pokok_awal: total,
    sisa_pokok_awal: total,
    tanggal_mulai: '2026-01-02',
    tenor_bulan: 12,
    jurnal_pencairan_id: 'j-cair',
    catatan: 'Pinjaman modal',
    angsuran: jadwal(total),
    ...overrides,
  };
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

describe('DB-16b — pembuatan pinjaman & jadwal', () => {
  it('menyimpan pinjaman baru + 12 angsuran, total pokok = sisa pokok', () => {
    const db = dbKas();
    jurnalPencairan(db);
    const sebelumJurnal = (
      db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }
    ).n;
    const total = RP(12_000_000);

    const hasil = buatPinjaman(db, inputPinjaman());
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.pinjaman).toMatchObject({
      id: 'pjr-1',
      kreditur: 'LPD Desa Adat',
      akun_kas: '1014',
      akun_bunga: '5063',
      pokok_awal: total,
      sisa_pokok_awal: total,
      tanggal_mulai: '2026-01-02',
      tenor_bulan: 12,
      jurnal_pencairan_id: 'j-cair',
      outstanding: total,
      total_pokok_dibayar: 0,
      total_bunga_dibayar: 0,
      total_denda_dibayar: 0,
    });
    expect(hasil.pinjaman?.angsuran).toHaveLength(12);
    expect(
      hasil.pinjaman?.angsuran?.reduce((s, a) => s + a.pokok, 0),
    ).toBe(total);
    expect(hasil.pinjaman?.angsuran?.every((a) => a.status === 'BELUM')).toBe(true);
    expect(hasil.pinjaman?.angsuran?.[0]).toMatchObject({
      ke: 1,
      jatuh_tempo: '2026-02-01',
      pokok: Math.floor(total / 12),
      bunga: RP(100_000),
    });

    // Membuat jadwal tidak membuat jurnal baru.
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n,
    ).toBe(sebelumJurnal);

    const daftar = listPinjaman(db);
    expect(daftar).toHaveLength(1);
    expect(daftar[0]).toMatchObject({ id: 'pjr-1', outstanding: total });
    expect(daftar[0].angsuran).toHaveLength(12);

    const detail = getPinjaman(db, 'pjr-1');
    expect(detail?.angsuran?.map((a) => a.ke)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );
    expect(statusAngsuranPinjaman(db, 'pjr-1')).toHaveLength(12);
    expect(hitungOutstandingPinjaman(db, 'pjr-1')).toBe(total);
    expect(hitungOutstandingPinjaman(db, 'tidak-ada')).toBeNull();
  });

  it('menolak total pokok jadwal yang tidak sama dengan sisa pokok', () => {
    const db = dbKas();
    jurnalPencairan(db);
    const rows = jadwal(RP(12_000_000));
    rows[11] = { ...rows[11], pokok: rows[11].pokok - 1 };

    const hasil = buatPinjaman(db, inputPinjaman({ angsuran: rows }));
    expect(hasil.tersimpan).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/Total pokok jadwal.*sisa pokok awal/);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman').get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman_angsuran').get() as {
        n: number;
      }).n,
    ).toBe(0);
  });

  it('menolak ke ganda/tidak naik dan tanggal jadwal mundur', () => {
    const db = dbKas();
    jurnalPencairan(db);

    const keGanda = jadwal(RP(12_000_000));
    keGanda[1] = { ...keGanda[1], ke: 1 };
    const hasilKe = buatPinjaman(db, inputPinjaman({ angsuran: keGanda }));
    expect(hasilKe.tersimpan).toBe(false);
    expect(hasilKe.errors.join(' ')).toMatch(/nomor ke harus naik.*ganda/);

    const tanggalMundur = jadwal(RP(12_000_000));
    tanggalMundur[2] = { ...tanggalMundur[2], jatuh_tempo: '2026-03-01' };
    tanggalMundur[3] = { ...tanggalMundur[3], jatuh_tempo: '2026-02-15' };
    const hasilTanggal = buatPinjaman(
      db,
      inputPinjaman({ angsuran: tanggalMundur }),
    );
    expect(hasilTanggal.tersimpan).toBe(false);
    expect(hasilTanggal.errors.join(' ')).toMatch(
      /tanggal jatuh tempo tidak boleh mundur/,
    );

    const tanggalSalah = jadwal(RP(12_000_000));
    tanggalSalah[0] = { ...tanggalSalah[0], jatuh_tempo: '2026-02-31' };
    const hasilSalah = buatPinjaman(
      db,
      inputPinjaman({ angsuran: tanggalSalah }),
    );
    expect(hasilSalah.tersimpan).toBe(false);
    expect(hasilSalah.errors.join(' ')).toMatch(/tidak valid/);
  });

  it('menolak akun kas/bunga, pokok, sisa, tanggal, tenor, dan jurnal tidak sah', () => {
    const db = dbKas();
    jurnalPencairan(db);

    const hasil = buatPinjaman(
      db,
      inputPinjaman({
        kreditur: ' ',
        akun_kas: '2050', // bukan kas
        akun_bunga: '1001', // bukan BEBAN
        pokok_awal: 0,
        sisa_pokok_awal: -1,
        tanggal_mulai: '2026-02-30',
        tenor_bulan: 0,
        jurnal_pencairan_id: 'j-tidak-ada',
        angsuran: [],
      }),
    );
    expect(hasil.tersimpan).toBe(false);
    const pesan = hasil.errors.join(' ');
    expect(pesan).toMatch(/kreditur/i);
    expect(pesan).toMatch(/akun kas/i);
    expect(pesan).toMatch(/akun bunga/i);
    expect(pesan).toMatch(/pokok awal/i);
    expect(pesan).toMatch(/sisa pokok/i);
    expect(pesan).toMatch(/tanggal mulai/i);
    expect(pesan).toMatch(/tenor/i);
    expect(pesan).toMatch(/jurnal pencairan.*tidak ditemukan/i);
    expect(pesan).toMatch(/jadwal angsuran wajib/i);
  });

  it('menerima pinjaman sudah berjalan tanpa jurnal pencairan dan tidak membuat jurnal', () => {
    const db = dbKas();
    const sebelum = (
      db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }
    ).n;
    const hasil = buatPinjaman(
      db,
      inputPinjaman({
        id: 'pjr-jalan',
        pokok_awal: RP(20_000_000),
        sisa_pokok_awal: RP(7_500_000),
        tanggal_mulai: '2025-06-01',
        tenor_bulan: null,
        jurnal_pencairan_id: null,
        angsuran: jadwal(RP(7_500_000), 3, '2026-01-01'),
      }),
    );
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.pinjaman).toMatchObject({
      id: 'pjr-jalan',
      pokok_awal: RP(20_000_000),
      sisa_pokok_awal: RP(7_500_000),
      jurnal_pencairan_id: null,
      outstanding: RP(7_500_000),
    });
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n,
    ).toBe(sebelum);
  });
});

function jurnalBayar(
  db: Database.Database,
  id = 'j-bayar-1',
  opts: { pokok?: number; bunga?: number; denda?: number; tanggal?: string } = {},
): void {
  const pokok = opts.pokok ?? RP(1_000_000);
  const bunga = opts.bunga ?? RP(100_000);
  const denda = opts.denda ?? 0;
  const hasil = postingJurnal(db, {
    header: {
      id,
      tanggal: opts.tanggal ?? '2026-03-01',
      no_bukti: `B-${id}`,
      keterangan: 'Bayar angsuran pinjaman LPD',
      jenis: 'HUTANG',
    },
    baris: [
      D('2050', pokok),
      D('5063', bunga),
      ...(denda > 0 ? [D('5050', denda)] : []),
      K('1001', pokok + bunga + denda),
    ],
  });
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
}

function jumlahBayar(db: Database.Database): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM pinjaman_bayar').get() as {
      n: number;
    }
  ).n;
}

describe('DB-16b — pembayaran link-only', () => {
  it('menautkan jurnal nyata dan menurunkan outstanding dari debit 2050', () => {
    const db = dbKas();
    jurnalPencairan(db);
    const buat = buatPinjaman(db, inputPinjaman());
    expect(buat.tersimpan, buat.errors.join(' ')).toBe(true);
    const pinjaman = getPinjaman(db, 'pjr-1');
    const angsuran1 = pinjaman?.angsuran?.[0];
    expect(angsuran1).toBeDefined();
    jurnalBayar(db, 'j-bayar-1', { denda: RP(50_000) });

    const hasil = tautkanPembayaran(db, {
      id: 'pby-1',
      pinjaman_id: 'pjr-1',
      angsuran_id: angsuran1?.id,
      jurnal_id: 'j-bayar-1',
      tanggal: '2026-03-01',
      catatan: 'Realisasi angsuran 1',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.pembayaran).toMatchObject({
      id: 'pby-1',
      pinjaman_id: 'pjr-1',
      angsuran_id: angsuran1?.id,
      jurnal_id: 'j-bayar-1',
      tanggal: '2026-03-01',
      catatan: 'Realisasi angsuran 1',
      pokok: RP(1_000_000),
      bunga: RP(100_000),
      denda: RP(50_000),
      kas_keluar: RP(1_150_000),
    });

    const sesudah = getPinjaman(db, 'pjr-1');
    expect(sesudah?.total_pokok_dibayar).toBe(RP(1_000_000));
    expect(sesudah?.total_bunga_dibayar).toBe(RP(100_000));
    expect(sesudah?.total_denda_dibayar).toBe(RP(50_000));
    expect(sesudah?.outstanding).toBe(RP(11_000_000));
    expect(
      sesudah?.angsuran?.find((a) => a.id === angsuran1?.id),
    ).toMatchObject({
      status: 'LUNAS',
      dibayar: true,
      pinjaman_bayar_id: 'pby-1',
      tanggal_bayar: '2026-03-01',
      jurnal_id: 'j-bayar-1',
    });
    expect(
      sesudah?.angsuran?.filter((a) => a.status === 'BELUM'),
    ).toHaveLength(11);

    expect(listPinjamanBayar(db, 'pjr-1')).toHaveLength(1);
    expect(getPembayaranPinjaman(db, 'pby-1')?.pokok).toBe(RP(1_000_000));
    expect(
      rincianPembayaranDariJurnal(db, 'j-bayar-1', '5063'),
    ).toEqual({
      pokok: RP(1_000_000),
      bunga: RP(100_000),
      denda: RP(50_000),
      kas_keluar: RP(1_150_000),
    });
    expect(hitungOutstandingPinjaman(db, 'pjr-1')).toBe(RP(11_000_000));
  });

  it('menerima alias catatPembayaran dan jurnal tanpa denda', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    jurnalBayar(db, 'j-bayar-alias', { denda: 0 });
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    const hasil = catatPembayaran(db, {
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-alias',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.pembayaran).toMatchObject({
      pokok: RP(1_000_000),
      bunga: RP(100_000),
      denda: 0,
      kas_keluar: RP(1_100_000),
      tanggal: '2026-03-01',
    });
  });

  it('menolak satu angsuran dibayar dua kali dan satu jurnal ditautkan dua kali', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    jurnalBayar(db, 'j-bayar-1');
    const pertama = tautkanPembayaran(db, {
      id: 'pby-1',
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-1',
    });
    expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);

    jurnalBayar(db, 'j-bayar-2', { tanggal: '2026-04-01' });
    const kedua = tautkanPembayaran(db, {
      id: 'pby-2',
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-2',
      tanggal: '2026-04-01',
    });
    expect(kedua.tersimpan).toBe(false);
    expect(kedua.errors.join(' ')).toMatch(/sudah lunas/);

    // Jurnal yang sudah dipakai juga tidak boleh ditautkan lagi, walau ke
    // angsuran berbeda.
    const a2 = getPinjaman(db, 'pjr-1')?.angsuran?.[1];
    const ketiga = tautkanPembayaran(db, {
      id: 'pby-3',
      pinjaman_id: 'pjr-1',
      angsuran_id: a2?.id,
      jurnal_id: 'j-bayar-1',
    });
    expect(ketiga.tersimpan).toBe(false);
    expect(ketiga.errors.join(' ')).toMatch(/sudah ditautkan/);

    expect(listPinjamanBayar(db, 'pjr-1')).toHaveLength(1);
    expect(getPinjaman(db, 'pjr-1')?.outstanding).toBe(RP(11_000_000));
  });

  it('menolak jurnal tidak seimbang, tanpa debit 2050, atau tanpa kredit kas', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];

    // Seed SQL langsung melewati posting layer untuk menguji guard repository.
    const insJurnal = db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES (?, '2026-03-01', ?, 'Uji guard', 'UMUM', ?, NULL,
               '2026-03-01T00:00:00.000Z')`,
    );
    const insBaris = db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, '')`,
    );

    insJurnal.run('j-tidak-seimbang', 'X-1', 'j-tidak-seimbang');
    insBaris.run('j-tidak-seimbang', '2050', RP(1_000_000), 0);
    insBaris.run('j-tidak-seimbang', '1001', 0, RP(900_000));

    insJurnal.run('j-tanpa-2050', 'X-2', 'j-tanpa-2050');
    insBaris.run('j-tanpa-2050', '5063', RP(100_000), 0);
    insBaris.run('j-tanpa-2050', '1001', 0, RP(100_000));

    insJurnal.run('j-tanpa-kas', 'X-3', 'j-tanpa-kas');
    insBaris.run('j-tanpa-kas', '2050', RP(1_000_000), 0);
    insBaris.run('j-tanpa-kas', '5063', 0, RP(1_000_000));

    for (const [jurnalId, pola] of [
      ['j-tidak-seimbang', /tidak seimbang/],
      ['j-tanpa-2050', /tidak memuat debit 2050/],
      ['j-tanpa-kas', /tidak memuat kredit kas/],
    ] as const) {
      const hasil = tautkanPembayaran(db, {
        pinjaman_id: 'pjr-1',
        angsuran_id: a?.id,
        jurnal_id: jurnalId,
      });
      expect(hasil.tersimpan, jurnalId).toBe(false);
      expect(hasil.errors.join(' '), jurnalId).toMatch(pola);
    }

    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman_bayar').get() as {
        n: number;
      }).n,
    ).toBe(0);
  });

  it('menulis tepat satu audit PINJAMAN-BAYAR-LINK dengan link dan rincian jurnal', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    jurnalBayar(db, 'j-bayar-audit', { denda: RP(25_000) });

    const hasil = tautkanPembayaran(db, {
      id: 'pby-audit',
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-audit',
      tanggal: '2026-03-01',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

    const audit = listAuditLog(db, { aksi: 'PINJAMAN-BAYAR-LINK pjr-1' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      aksi: 'PINJAMAN-BAYAR-LINK pjr-1',
      ref_type: 'pinjaman_bayar',
      ref_id: 'pby-audit',
    });
    expect(JSON.parse(audit[0]!.data_baru_json)).toEqual({
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-audit',
      tanggal: '2026-03-01',
      pokok: RP(1_000_000),
      bunga: RP(100_000),
      denda: RP(25_000),
    });
  });

  it('menolak tanggal berbeda dari jurnal tanpa menambah pembayaran/audit', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    jurnalBayar(db, 'j-bayar-tanggal', { tanggal: '2026-03-01' });
    const sebelumBayar = jumlahBayar(db);
    const sebelumAudit = listAuditLog(db, {
      aksi: 'PINJAMAN-BAYAR-LINK pjr-1',
    }).length;

    const hasil = tautkanPembayaran(db, {
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-tanggal',
      tanggal: '2026-03-02',
    });
    expect(hasil.tersimpan).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/berbeda dari tanggal jurnal/i);
    expect(hasil.errors.join(' ')).toContain('2026-03-02');
    expect(hasil.errors.join(' ')).toContain('2026-03-01');
    expect(jumlahBayar(db)).toBe(sebelumBayar);
    expect(
      listAuditLog(db, { aksi: 'PINJAMAN-BAYAR-LINK pjr-1' }),
    ).toHaveLength(sebelumAudit);
  });

  it('menerima tanggal yang sama dengan tanggal jurnal', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    jurnalBayar(db, 'j-bayar-sama', { tanggal: '2026-03-01' });

    const hasil = tautkanPembayaran(db, {
      id: 'pby-sama',
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-sama',
      tanggal: '2026-03-01',
    });
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(hasil.pembayaran?.tanggal).toBe('2026-03-01');
    expect(
      listAuditLog(db, { aksi: 'PINJAMAN-BAYAR-LINK pjr-1' }),
    ).toHaveLength(1);
  });

  it('menolak pembayaran sebelum tanggal mulai pinjaman dan menyebut tanggal mulai', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    jurnalBayar(db, 'j-bayar-lampau', { tanggal: '2026-01-01' });

    const hasil = tautkanPembayaran(db, {
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-lampau',
    });
    expect(hasil.tersimpan).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(
      /sebelum tanggal mulai pinjaman 2026-01-02/i,
    );
    expect(jumlahBayar(db)).toBe(0);
    expect(
      listAuditLog(db, { aksi: 'PINJAMAN-BAYAR-LINK pjr-1' }),
    ).toHaveLength(0);
  });

  it('membatalkan insert bila audit gagal ditulis', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const a = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    jurnalBayar(db, 'j-bayar-audit-gagal');
    db.exec(`CREATE TRIGGER gagal_audit_pinjaman
      BEFORE INSERT ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'simulasi audit gagal');
      END`);

    const hasil = tautkanPembayaran(db, {
      id: 'pby-audit-gagal',
      pinjaman_id: 'pjr-1',
      angsuran_id: a?.id,
      jurnal_id: 'j-bayar-audit-gagal',
    });
    expect(hasil.tersimpan).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/simulasi audit gagal/i);
    expect(jumlahBayar(db)).toBe(0);
    expect(
      listAuditLog(db, { aksi: 'PINJAMAN-BAYAR-LINK pjr-1' }),
    ).toHaveLength(0);
  });
});

describe('DB-16b — skema tersimpan & foreign key', () => {
  it('tidak menyimpan saldo berjalan maupun nominal pembayaran duplikat', () => {
    const db = dbKas();
    const kolomPinjaman = (
      db.pragma('table_info(pinjaman)') as { name: string }[]
    ).map((k) => k.name);
    for (const nama of [
      'sisa_pokok',
      'saldo_pokok',
      'saldo_berjalan',
      'outstanding',
    ]) {
      expect(kolomPinjaman, nama).not.toContain(nama);
    }

    const kolomBayar = (
      db.pragma('table_info(pinjaman_bayar)') as { name: string }[]
    ).map((k) => k.name);
    for (const nama of ['pokok', 'bunga', 'denda', 'nominal', 'kas_keluar']) {
      expect(kolomBayar, nama).not.toContain(nama);
    }
  });

  it('menerapkan FK akun/jurnal dan cascade jadwal saat pinjaman dihapus', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);

    const fkAngsuran = db.pragma('foreign_key_list(pinjaman_angsuran)') as {
      table: string;
      from: string;
      on_delete: string;
    }[];
    expect(fkAngsuran).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'pinjaman',
          from: 'pinjaman_id',
          on_delete: 'CASCADE',
        }),
      ]),
    );
    const fkBayar = db.pragma('foreign_key_list(pinjaman_bayar)') as {
      table: string;
      from: string;
    }[];
    expect(fkBayar.map((f) => `${f.from}->${f.table}`)).toEqual(
      expect.arrayContaining([
        'pinjaman_id->pinjaman',
        'angsuran_id->pinjaman_angsuran',
        'jurnal_id->jurnal',
      ]),
    );

    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman_angsuran').get() as {
        n: number;
      }).n,
    ).toBe(12);
    db.prepare('DELETE FROM pinjaman WHERE id = ?').run('pjr-1');
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman_angsuran').get() as {
        n: number;
      }).n,
    ).toBe(0);
    expect(getPinjaman(db, 'pjr-1')).toBeNull();

    // FK akun juga dijaga DB bila repository dilewati.
    expect(() =>
      db
        .prepare(
          `INSERT INTO pinjaman
             (id, kreditur, akun_kas, akun_bunga, pokok_awal, sisa_pokok_awal,
              tanggal_mulai, tenor_bulan, jurnal_pencairan_id, catatan, created_at)
           VALUES ('pjr-fk', 'X', '9999', '5063', 1, 1, '2026-01-01', NULL,
                   NULL, '', '2026-01-01T00:00:00.000Z')`,
        )
        .run(),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });
});

// T2.3 — regresi pembayaran bunga saja.
//
// Pembayaran bunga tanpa pokok membuat jurnal berjenis HUTANG yang TIDAK
// memuat akun 2050. Heuristik lama (jenis HUTANG + akun 2050) karena itu
// menganggapnya jurnal biasa dan menawarkan pembatalan dari Transaksi.
// Capability backend harus memakai relasi `pinjaman_bayar.jurnal_id`.
describe('T2.3 — pembayaran bunga saja', () => {
  it('jurnal HUTANG tanpa 2050 dari API pembayaran ditolak dengan alasan Pinjaman', () => {
    const db = dbKas();
    jurnalPencairan(db);
    expect(buatPinjaman(db, inputPinjaman()).tersimpan).toBe(true);
    const angsuran = getPinjaman(db, 'pjr-1')?.angsuran?.[0];
    expect(angsuran).toBeDefined();

    // API asli membuat jurnal pembayaran: D 5063 / K kas, tanpa D 2050.
    const bayar = bayarAngsuranPinjaman(db, {
      id: 'pby-bunga-saja',
      jurnal_id: 'j-bayar-bunga-saja',
      pinjaman_id: 'pjr-1',
      angsuran_id: angsuran?.id,
      tanggal: '2026-03-01',
      akun_kas: '1001',
      pokok: 0,
      bunga: RP(100_000),
    });
    expect(bayar.tersimpan, bayar.errors.join(' ')).toBe(true);
    expect(bayar.jurnal?.id).toBe('j-bayar-bunga-saja');
    expect(bayar.rincian).toMatchObject({ pokok: 0, bunga: RP(100_000) });

    const detail = getJurnalDetail(db, 'j-bayar-bunga-saja');
    expect(detail).not.toBeNull();
    expect(detail?.jurnal.jenis).toBe('HUTANG');
    const akun = (detail?.baris ?? []).map((b) => b.akun_kode);
    expect(akun).toContain('5063');
    expect(akun).not.toContain('2050');

    // Heuristik lama gagal mendeteksi pinjaman karena tidak ada 2050.
    const heuristikLamaTerhubungPinjaman =
      detail?.jurnal.jenis === 'HUTANG' && akun.includes('2050');
    expect(heuristikLamaTerhubungPinjaman).toBe(false);

    const kemampuan = kemampuanKoreksiJurnal(db, {
      id: 'j-bayar-bunga-saja',
    });
    expect(kemampuan).toEqual({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL_PINJAMAN,
    });
    expect(kemampuan.alasan).toMatch(/Pinjaman/);

    // Debt pokok tidak berubah; pembayaran tercatat sebagai bunga saja.
    expect(getPinjaman(db, 'pjr-1')?.outstanding).toBe(RP(12_000_000));
    expect(getPembayaranPinjaman(db, 'pby-bunga-saja')).toMatchObject({
      jurnal_id: 'j-bayar-bunga-saja',
      pokok: 0,
      bunga: RP(100_000),
      dibatalkan: false,
    });
  });
});
