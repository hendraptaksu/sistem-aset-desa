// DB-16f — rekonsiliasi outstanding 2050 vs jadwal pinjaman LPD.
//
// Fokus:
// - pinjaman cocok: outstanding GL 2050 (jurnal tertaut) = sisa pokok awal -
//   pokok aktual dari jurnal pembayaran tertaut;
// - salah saldo awal/salah akun pembayaran menghasilkan selisih + temuan audit;
// - jurnal 2050 yang tidak tertaut tidak diatribusikan ke pinjaman (batas
//   perbandingan per pinjaman, bukan saldo total akun);
// - tidak ada jurnal/data yang berubah dan tidak ada koreksi otomatis;
// - validasi IPC/API serta penjaga sumber UI/dokumen.

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import {
  bayarAngsuranPinjaman,
  buatPinjaman,
  getPinjaman,
  simpanPinjamanLpd,
  tautkanPembayaran,
} from '../src/db/pinjaman.js';
import {
  rekonsiliasiPinjaman,
  rekonsiliasiSemuaPinjaman,
} from '../src/db/pinjamanRekonsiliasi.js';
import { auditIntegritas } from '../src/db/integritas.js';
import { postingJurnal } from '../src/db/posting.js';
import { insertJurnalTervalidasi } from '../src/db/repository.js';
import { reverseJurnal } from '../src/db/reversal.js';
import { validasiBentukPinjamanRekonsiliasi } from '../src/main/validation.js';
import { formatRp } from '../src/utils/format.js';
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

const dbTerbuka: Database.Database[] = [];

afterEach(() => {
  for (const db of dbTerbuka.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup */
    }
  }
});

type Fixture = {
  db: Database.Database;
  pinjamanId: string;
  angsuran: { id: number; ke: number }[];
};

/**
 * Pinjaman pencairan Rp 12 juta dengan 4 angsuran pokok Rp 3 juta + bunga
 * Rp 100 ribu. Saldo awal kas Rp 200 juta; pencairan D 1014 / K 2050.
 */
function siapkanFixture(): Fixture {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  const awal = postingJurnal(db, {
    header: {
      id: 'awal-16f',
      tanggal: '2026-01-01',
      no_bukti: 'SA-16F',
      keterangan: 'Saldo awal uji rekonsiliasi pinjaman',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', RP(200_000_000)), K(AKUN_MODAL, RP(200_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

  const total = RP(12_000_000);
  const simpan = simpanPinjamanLpd(db, {
    id: 'pjr-16f',
    mode: 'PENCAIRAN',
    kreditur: 'LPD Desa Adat',
    tanggal: '2026-01-02',
    akunKas: '1014',
    akunBunga: '5063',
    pokok: total,
    tenor: 4,
    catatan: 'Pinjaman uji DB-16f',
    angsuran: [1, 2, 3, 4].map((ke) => ({
      ke,
      jatuh_tempo: `2026-${String(ke + 1).padStart(2, '0')}-01`,
      pokok: RP(3_000_000),
      bunga: RP(100_000),
      catatan: `Angsuran ${ke}`,
    })),
  });
  expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);
  return {
    db,
    pinjamanId: simpan.pinjaman!.id,
    angsuran: (simpan.pinjaman!.angsuran ?? []).map((a) => ({
      id: a.id,
      ke: a.ke,
    })),
  };
}

/**
 * DB dengan Saldo Awal kas dan, bila diminta, kredit 2050. Modal dibuat
 * penyeimbang agar jurnal SALDO_AWAL tetap seimbang. Saldo 2050 negatif
 * (debit) dipakai untuk menguji arah tanda.
 */
function dbSaldoAwal2050(saldo2050 = 0): Database.Database {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  const kas = RP(200_000_000);
  const baris = [
    D('1001', kas),
    ...(saldo2050 > 0
      ? [K('2050', saldo2050)]
      : saldo2050 < 0
        ? [D('2050', -saldo2050)]
        : []),
    K(AKUN_MODAL, kas - saldo2050),
  ];
  const awal = postingJurnal(db, {
    header: {
      id: `awal-2050-${saldo2050}`,
      tanggal: '2026-01-01',
      no_bukti: `SA-2050-${saldo2050}`,
      keterangan: 'Saldo awal uji pinjaman berjalan',
      jenis: 'SALDO_AWAL',
    },
    baris,
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

function inputBerjalan(
  sisaPokok: number,
  id = 'pjr-berjalan-16f',
  tanggal = '2026-01-01',
): Parameters<typeof simpanPinjamanLpd>[1] {
  return {
    id,
    mode: 'BERJALAN',
    kreditur: 'LPD Desa Adat',
    tanggal,
    akunBunga: '5063',
    sisaPokok,
    angsuran: [
      {
        ke: 1,
        jatuh_tempo: '2026-02-01',
        pokok: sisaPokok,
        bunga: RP(100_000),
      },
    ],
  };
}

function bayarNormal(
  db: Database.Database,
  pinjamanId: string,
  angsuranId: number,
): void {
  const hasil = bayarAngsuranPinjaman(db, {
    id: 'pby-normal',
    jurnal_id: 'j-bayar-normal',
    pinjaman_id: pinjamanId,
    angsuran_id: angsuranId,
    tanggal: '2026-02-05',
    akun_kas: '1014',
    pokok: RP(3_000_000),
    bunga: RP(100_000),
    noBukti: 'B-16F',
  });
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
}

function hitungBaris(db: Database.Database, tabel: string): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).get() as { n: number }
  ).n;
}

function kodeTemuan(db: Database.Database): string[] {
  return auditIntegritas(db).temuan.map((t) => t.kode);
}

describe('DB-16f — rekonsiliasi per pinjaman', () => {
  it('pinjaman cocok: GL 2050 sama dengan jadwal setelah pembayaran normal', () => {
    const { db, pinjamanId, angsuran } = siapkanFixture();
    bayarNormal(db, pinjamanId, angsuran[0].id);

    const hasil = rekonsiliasiPinjaman(db, pinjamanId);
    expect(hasil).not.toBeNull();
    expect(Object.keys(hasil!).sort()).toEqual([
      'cocok',
      'gl',
      'jadwal',
      'pesan',
      'pinjaman_id',
      'selisih',
    ]);
    expect(hasil!).toMatchObject({
      pinjaman_id: pinjamanId,
      gl: RP(9_000_000),
      jadwal: RP(9_000_000),
      selisih: 0,
      cocok: true,
    });
    expect(hasil!.pesan).toMatch(/cocok/i);
    expect(hasil!.pesan).toContain('2050');
    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');
    expect(rekonsiliasiSemuaPinjaman(db)).toHaveLength(1);
  });

  it('mendeteksi saldo awal/jadwal yang tidak cocok dengan kredit 2050', () => {
    const { db, pinjamanId } = siapkanFixture();
    // Naikkan pokok dan sisa bersama-sama agar tetap lolos CHECK
    // `sisa_pokok_awal <= pokok_awal`; drift tetap terlihat dari GL jurnal.
    db.prepare(
      'UPDATE pinjaman SET pokok_awal = ?, sisa_pokok_awal = ? WHERE id = ?',
    ).run(RP(12_500_000), RP(12_500_000), pinjamanId);

    const hasil = rekonsiliasiPinjaman(db, pinjamanId)!;
    expect(hasil).toMatchObject({
      gl: RP(12_000_000),
      jadwal: RP(12_500_000),
      selisih: -RP(500_000),
      cocok: false,
    });
    expect(hasil.pesan).toMatch(/selisih/i);
    expect(hasil.pesan).toMatch(/tidak mengoreksi otomatis/i);

    const temuan = auditIntegritas(db).temuan.filter(
      (t) => t.kode === 'REKONSILIASI_PINJAMAN_SELISIH',
    );
    expect(temuan).toHaveLength(1);
    expect(temuan[0].pesan).toContain(pinjamanId);
    expect(temuan[0].detail).toMatchObject({
      pinjaman_id: pinjamanId,
      gl: RP(12_000_000),
      jadwal: RP(12_500_000),
      selisih: -RP(500_000),
    });
  });

  it('menolak pinjaman berjalan tanpa Saldo Awal 2050 dengan pesan jelas', () => {
    const db = openDb(':memory:');
    dbTerbuka.push(db);
    const sisa = RP(5_000_000);
    const simpan = simpanPinjamanLpd(db, inputBerjalan(sisa));

    expect(simpan.tersimpan).toBe(false);
    expect(simpan.errors).toContain(
      `Sisa pokok pinjaman berjalan (${formatRp(sisa)}) melebihi Saldo Awal ` +
        `akun 2050 HUTANG LAIN-LAIN (${formatRp(0)}). ` +
        'Isi atau koreksi Saldo Awal 2050 terlebih dahulu.',
    );
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman').get() as { n: number })
        .n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number })
        .n,
    ).toBe(0);
  });

  it('menolak bila total sisa pokok pinjaman berjalan melebihi Saldo Awal 2050', () => {
    const db = dbSaldoAwal2050(RP(5_000_000));
    const pertama = simpanPinjamanLpd(
      db,
      inputBerjalan(RP(3_000_000), 'pjr-berjalan-a'),
    );
    expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);

    const kedua = simpanPinjamanLpd(
      db,
      inputBerjalan(RP(3_000_000), 'pjr-berjalan-b', '2026-01-02'),
    );
    expect(kedua.tersimpan).toBe(false);
    expect(kedua.errors).toContain(
      `Sisa pokok pinjaman berjalan (${formatRp(RP(6_000_000))}) melebihi ` +
        `Saldo Awal akun 2050 HUTANG LAIN-LAIN (${formatRp(RP(5_000_000))}). ` +
        'Isi atau koreksi Saldo Awal 2050 terlebih dahulu.',
    );
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman').get() as { n: number })
        .n,
    ).toBe(1);
  });

  it('menerima pinjaman berjalan bila Saldo Awal 2050 cukup dan rekonsiliasi cocok', () => {
    const db = dbSaldoAwal2050(RP(5_000_000));
    const sisa = RP(5_000_000);
    const simpan = simpanPinjamanLpd(db, inputBerjalan(sisa));

    expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);
    const hasil = rekonsiliasiPinjaman(db, simpan.pinjaman!.id)!;
    expect(hasil).toMatchObject({
      gl: sisa,
      jadwal: sisa,
      selisih: 0,
      cocok: true,
    });
    expect(hasil.pesan).toMatch(/cocok/i);
    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');
  });

  it('membagi Saldo Awal 2050 ke beberapa pinjaman berjalan dan tetap cocok', () => {
    const db = dbSaldoAwal2050(RP(5_000_000));
    const a = simpanPinjamanLpd(
      db,
      inputBerjalan(RP(2_000_000), 'pjr-berjalan-a'),
    );
    const b = simpanPinjamanLpd(
      db,
      inputBerjalan(RP(3_000_000), 'pjr-berjalan-b', '2026-01-02'),
    );
    expect(a.tersimpan, a.errors.join(' ')).toBe(true);
    expect(b.tersimpan, b.errors.join(' ')).toBe(true);

    for (const [id, sisa] of [
      [a.pinjaman!.id, RP(2_000_000)],
      [b.pinjaman!.id, RP(3_000_000)],
    ] as const) {
      expect(rekonsiliasiPinjaman(db, id)).toMatchObject({
        gl: sisa,
        jadwal: sisa,
        selisih: 0,
        cocok: true,
      });
    }
    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');
  });

  it('pinjaman berjalan tetap cocok setelah pembayaran pokok', () => {
    const db = dbSaldoAwal2050(RP(5_000_000));
    const sisa = RP(5_000_000);
    const simpan = simpanPinjamanLpd(db, {
      ...inputBerjalan(sisa),
      angsuran: [
        {
          ke: 1,
          jatuh_tempo: '2026-02-01',
          pokok: sisa,
          bunga: 0,
        },
      ],
    });
    expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);
    const bayar = bayarAngsuranPinjaman(db, {
      id: 'pby-berjalan-16f',
      jurnal_id: 'j-bayar-berjalan-16f',
      pinjaman_id: simpan.pinjaman!.id,
      angsuran_id: simpan.pinjaman!.angsuran![0].id,
      tanggal: '2026-02-05',
      akun_kas: '1001',
      pokok: RP(2_000_000),
      bunga: 0,
    });
    expect(bayar.tersimpan, bayar.errors.join(' ')).toBe(true);

    expect(rekonsiliasiPinjaman(db, simpan.pinjaman!.id)).toMatchObject({
      gl: RP(3_000_000),
      jadwal: RP(3_000_000),
      selisih: 0,
      cocok: true,
    });
    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');
  });

  it('mendeteksi kekurangan GL 2050 agregat dari debit 2050 yang tidak tertaut', () => {
    const db = dbSaldoAwal2050(RP(5_000_000));
    const sisa = RP(5_000_000);
    const simpan = simpanPinjamanLpd(db, inputBerjalan(sisa));
    expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);

    const liar = postingJurnal(db, {
      header: {
        id: 'j-2050-liar-16f',
        tanggal: '2026-01-03',
        keterangan: 'Debit 2050 tanpa link pinjaman',
        jenis: 'HUTANG',
      },
      baris: [D('2050', RP(1_000_000)), K('1001', RP(1_000_000))],
    });
    expect(liar.tersimpan, liar.errors.join(' ')).toBe(true);

    // Per pinjaman tetap cocok karena debit liar tidak tertaut; ringkasan
    // agregat yang menangkap kekurangan GL 2050 terhadap outstanding pinjaman.
    expect(rekonsiliasiPinjaman(db, simpan.pinjaman!.id)).toMatchObject({
      gl: sisa,
      jadwal: sisa,
      selisih: 0,
      cocok: true,
    });
    const temuan = auditIntegritas(db).temuan.filter(
      (t) => t.kode === 'REKONSILIASI_PINJAMAN_SELISIH',
    );
    expect(temuan).toHaveLength(1);
    expect(temuan[0].detail).toMatchObject({
      gl_2050: RP(4_000_000),
      outstanding_pinjaman: sisa,
      kekurangan_gl: RP(1_000_000),
    });
    expect(temuan[0].pesan).toMatch(/kredit neto 2050 Buku Besar/i);
  });

  it('tidak menganggap kredit 2050 non-LPD sebagai selisih pinjaman', () => {
    const db = dbSaldoAwal2050(RP(5_000_000));
    const sisa = RP(5_000_000);
    const simpan = simpanPinjamanLpd(db, inputBerjalan(sisa));
    expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);

    const utangLain = postingJurnal(db, {
      header: {
        id: 'j-2050-non-lpd-16f',
        tanggal: '2026-01-03',
        keterangan: 'Utang non-LPD di 2050',
        jenis: 'HUTANG',
      },
      baris: [D('1001', RP(2_000_000)), K('2050', RP(2_000_000))],
    });
    expect(utangLain.tersimpan, utangLain.errors.join(' ')).toBe(true);

    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');
  });

  it('memakai Saldo Awal 2050 aktual, bukan sisa_pokok_awal, saat rekonsiliasi dipaksa lewat buatPinjaman', () => {
    const db = openDb(':memory:');
    dbTerbuka.push(db);
    const sisa = RP(5_000_000);
    const buat = buatPinjaman(db, {
      id: 'pjr-paksa-16f',
      kreditur: 'LPD Desa Adat',
      akun_kas: '1001',
      akun_bunga: '5063',
      pokok_awal: sisa,
      sisa_pokok_awal: sisa,
      tanggal_mulai: '2026-01-01',
      jurnal_pencairan_id: null,
      angsuran: [
        {
          ke: 1,
          jatuh_tempo: '2026-02-01',
          pokok: sisa,
          bunga: RP(100_000),
        },
      ],
    });
    expect(buat.tersimpan, buat.errors.join(' ')).toBe(true);

    const hasil = rekonsiliasiPinjaman(db, 'pjr-paksa-16f')!;
    expect(hasil).toMatchObject({
      gl: 0,
      jadwal: sisa,
      selisih: -sisa,
      cocok: false,
    });
    expect(hasil.pesan).toMatch(/Saldo Awal 2050/i);
    expect(rekonsiliasiSemuaPinjaman(db)).toEqual([
      expect.objectContaining({
        pinjaman_id: 'pjr-paksa-16f',
        cocok: false,
        gl: 0,
        jadwal: sisa,
        selisih: -sisa,
      }),
    ]);

    const temuan = auditIntegritas(db).temuan.filter(
      (t) => t.kode === 'REKONSILIASI_PINJAMAN_SELISIH',
    );
    expect(temuan.length).toBeGreaterThan(0);
    expect(temuan[0].detail).toMatchObject({
      pinjaman_id: 'pjr-paksa-16f',
      gl: 0,
      jadwal: sisa,
      selisih: -sisa,
    });
  });

  it('pinjaman berjalan dengan Saldo Awal 2050 debit (tanda terbalik) tetap ditolak', () => {
    const db = dbSaldoAwal2050(-RP(1_000_000));
    const simpan = simpanPinjamanLpd(db, inputBerjalan(RP(5_000_000)));
    expect(simpan.tersimpan).toBe(false);
    expect(simpan.errors.join(' ')).toMatch(
      /melebihi Saldo Awal akun 2050 HUTANG LAIN-LAIN/,
    );
    expect(simpan.errors.join(' ')).toContain(formatRp(-RP(1_000_000)));
  });

  it('T1.5: reversal SALDO_AWAL lewat jalur umum ditolak; pembalikan internal tetap mengurangi kredit neto 2050', () => {
    const db = dbSaldoAwal2050(RP(5_000_000));
    const id = `awal-2050-${RP(5_000_000)}`;
    const ditolak = reverseJurnal(db, id, 'Koreksi saldo awal pinjaman');
    expect(ditolak.tersimpan).toBe(false);
    expect(ditolak.errors.join(' ')).toMatch(/alur koreksi saldo awal/i);

    // T1.7 nanti menulis jurnal balik lewat alur internal. Saldo 2050 tetap
    // harus dihitung dari kredit neto, bukan dari status jurnal asli.
    insertJurnalTervalidasi(
      db,
      {
        id: 'balik-2050',
        tanggal: '2026-01-01',
        keterangan: 'Pembalikan saldo awal 2050',
        jenis: 'REVERSAL',
        grup_id: id,
        reversal_of: id,
      },
      [
        D('2050', RP(5_000_000)),
        D(AKUN_MODAL, RP(195_000_000)),
        K('1001', RP(200_000_000)),
      ],
    );

    const simpan = simpanPinjamanLpd(db, inputBerjalan(RP(5_000_000)));
    expect(simpan.tersimpan).toBe(false);
    expect(simpan.errors.join(' ')).toContain(
      `Saldo Awal akun 2050 HUTANG LAIN-LAIN (${formatRp(0)})`,
    );
  });

  it('jurnal pembayaran salah akun tetap terdeteksi lewat selisih GL vs jadwal', () => {
    const { db, pinjamanId, angsuran } = siapkanFixture();
    const jurnal = postingJurnal(
      db,
      {
        header: {
          id: 'j-salah-akun',
          tanggal: '2026-02-05',
          keterangan: 'Pembayaran pokok salah akun (2060)',
          jenis: 'HUTANG',
        },
        baris: [D('2060', RP(3_000_000)), K('1014', RP(3_000_000))],
      },
      // AUD2-10: debit 2060 tanpa saldo utang kini berperingatan dan butuh
      // konfirmasi; skenario rekonsiliasi ini sengaja memakai akun yang salah.
      { konfirmasiPeringatan: true },
    );
    expect(jurnal.tersimpan, jurnal.errors.join(' ')).toBe(true);

    // Simulasi link lama/rusak: service menolak jurnal tanpa debit 2050, jadi
    // baris link dibuat langsung untuk menguji deteksi.
    db.prepare(
      `INSERT INTO pinjaman_bayar
         (id, pinjaman_id, angsuran_id, jurnal_id, tanggal, catatan, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'pby-salah-akun',
      pinjamanId,
      angsuran[0].id,
      'j-salah-akun',
      '2026-02-05',
      'pokok salah akun',
      '2026-02-05T00:00:00.000Z',
    );

    const hasil = rekonsiliasiPinjaman(db, pinjamanId)!;
    expect(hasil).toMatchObject({
      gl: RP(12_000_000),
      jadwal: RP(9_000_000),
      selisih: RP(3_000_000),
      cocok: false,
    });
    expect(hasil.pesan).toMatch(/selisih/i);
    expect(kodeTemuan(db)).toContain('REKONSILIASI_PINJAMAN_SELISIH');
  });

  it('jurnal 2050 tanpa link dan utang non-LPD tidak diatribusikan ke pinjaman', () => {
    const { db, pinjamanId } = siapkanFixture();

    // Pembayaran pokok yang benar tetapi link pinjaman_bayar hilang.
    const bayar = postingJurnal(db, {
      header: {
        id: 'j-tanpa-link',
        tanggal: '2026-02-05',
        keterangan: 'Pembayaran pinjaman tanpa link',
        jenis: 'HUTANG',
      },
      baris: [D('2050', RP(3_000_000)), K('1014', RP(3_000_000))],
    });
    expect(bayar.tersimpan, bayar.errors.join(' ')).toBe(true);

    // Kredit 2050 lain untuk utang non-LPD; tidak boleh dianggap milik pinjaman.
    const utangLain = postingJurnal(db, {
      header: {
        id: 'j-utang-non-lpd',
        tanggal: '2026-02-06',
        keterangan: 'Utang non-LPD (bukan pinjaman)',
        jenis: 'HUTANG',
      },
      baris: [D('1001', RP(2_000_000)), K('2050', RP(2_000_000))],
    });
    expect(utangLain.tersimpan, utangLain.errors.join(' ')).toBe(true);

    const hasil = rekonsiliasiPinjaman(db, pinjamanId)!;
    expect(hasil).toMatchObject({
      gl: RP(12_000_000),
      jadwal: RP(12_000_000),
      selisih: 0,
      cocok: true,
    });

    const saldo2050 = (
      db
        .prepare(
          `SELECT COALESCE(SUM(kredit - debit), 0) AS n
             FROM jurnal_baris
            WHERE akun_kode = '2050'`,
        )
        .get() as { n: number }
    ).n;
    expect(saldo2050).toBe(RP(11_000_000));
    expect(saldo2050).not.toBe(hasil.gl);
    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');
  });

  it('tidak mengubah jurnal/data dan tidak menulis koreksi otomatis', () => {
    const { db, pinjamanId } = siapkanFixture();
    // Naikkan pokok dan sisa bersama-sama agar tetap lolos CHECK
    // `sisa_pokok_awal <= pokok_awal`; drift tetap terlihat dari GL jurnal.
    db.prepare(
      'UPDATE pinjaman SET pokok_awal = ?, sisa_pokok_awal = ? WHERE id = ?',
    ).run(RP(12_500_000), RP(12_500_000), pinjamanId);

    const tabel = [
      'jurnal',
      'jurnal_baris',
      'audit_log',
      'pinjaman',
      'pinjaman_angsuran',
      'pinjaman_bayar',
    ];
    const sebelum = Object.fromEntries(
      tabel.map((t) => [t, hitungBaris(db, t)]),
    );
    const pinjamanSebelum = getPinjaman(db, pinjamanId);

    const r1 = rekonsiliasiPinjaman(db, pinjamanId);
    const r2 = rekonsiliasiPinjaman(db, pinjamanId);
    expect(r1).toEqual(r2);
    expect(rekonsiliasiSemuaPinjaman(db)).toHaveLength(1);
    const audit1 = auditIntegritas(db);
    const audit2 = auditIntegritas(db);
    expect(audit1).toEqual(audit2);
    expect(
      audit1.temuan.some(
        (t) => t.kode === 'REKONSILIASI_PINJAMAN_SELISIH',
      ),
    ).toBe(true);

    const sesudah = Object.fromEntries(
      tabel.map((t) => [t, hitungBaris(db, t)]),
    );
    expect(sesudah).toEqual(sebelum);
    expect(getPinjaman(db, pinjamanId)).toEqual(pinjamanSebelum);
  });
});

describe('DB-16f — validasi, IPC, API, UI, dan dokumentasi', () => {
  const IPC = baca('src/main/ipc.ts');
  const VALIDATION = baca('src/main/validation.ts');
  const API = baca('src/renderer/lib/api.ts');
  const UI = baca('src/renderer/components/PinjamanTab.tsx');
  const PANDUAN = baca('docs/panduan-pengguna.md');
  const SUMBER = baca('docs/skema.md');

  it('memvalidasi ID pinjaman opsional dan menolak bentuk yang salah', () => {
    expect(validasiBentukPinjamanRekonsiliasi(undefined)).toEqual({
      ok: true,
      input: {},
    });
    expect(validasiBentukPinjamanRekonsiliasi(null)).toEqual({
      ok: true,
      input: {},
    });
    expect(validasiBentukPinjamanRekonsiliasi({})).toEqual({
      ok: true,
      input: {},
    });
    expect(
      validasiBentukPinjamanRekonsiliasi({ pinjamanId: 'pjr-16f' }),
    ).toEqual({
      ok: true,
      input: { pinjamanId: 'pjr-16f' },
    });
    expect(
      validasiBentukPinjamanRekonsiliasi({ pinjaman_id: ' pjr-16f ' }),
    ).toEqual({
      ok: true,
      input: { pinjamanId: 'pjr-16f' },
    });

    for (const [input, pola] of [
      [[], /tidak lengkap/i],
      ['pjr-16f', /tidak lengkap/i],
      [{ pinjamanId: ' ' }, /tidak valid|kosong/i],
      [{ pinjamanId: 123 }, /tidak valid/i],
      [{ pinjamanId: 'x'.repeat(201) }, /maks/i],
    ] as const) {
      const hasil = validasiBentukPinjamanRekonsiliasi(input);
      expect(hasil.ok, JSON.stringify(input)).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(pola);
    }
  });

  it('mendaftarkan channel pinjaman:rekonsiliasi dan API baca-saja', () => {
    expect(IPC).toContain("'pinjaman:rekonsiliasi'");
    expect(IPC).toContain('validasiBentukPinjamanRekonsiliasi');
    expect(IPC).toContain('rekonsiliasiPinjaman');
    expect(IPC).toContain('rekonsiliasiSemuaPinjaman');
    expect(VALIDATION).toContain('validasiBentukPinjamanRekonsiliasi');
    expect(API).toContain('pinjamanRekonsiliasi');
    expect(API).toContain('pinjamanRekonsiliasiSemua');
    expect(API).toContain("'pinjaman:rekonsiliasi'");
    expect(API).toContain('FilterRekonsiliasiPinjamanApi');
    expect(API).toContain('HasilRekonsiliasiPinjaman');
  });

  it('UI menampilkan status per pinjaman dan peringatan tanpa tombol koreksi', () => {
    expect(UI).toContain('Rekonsiliasi 2050 vs Jadwal Pinjaman');
    expect(UI).toContain('api.pinjamanRekonsiliasiSemua');
    expect(UI).toContain('GL 2050');
    expect(UI).toContain('Jadwal');
    expect(UI).toContain('Selisih');
    expect(UI).toContain('Cocok');
    expect(UI).toContain('tidak mengoreksi otomatis');
    expect(UI).toContain('tidak menyediakan tombol koreksi');
    expect(UI).not.toContain('Koreksi Rekonsiliasi');
  });

  it('dokumen menjelaskan rumus, batas per pinjaman, dan audit DB-16f', () => {
    expect(PANDUAN).toContain('Rekonsiliasi 2050');
    expect(PANDUAN).toContain('tidak mengoreksi otomatis');
    expect(PANDUAN).toContain('Saldo Awal');

    expect(SUMBER).toContain('DB-16f');
    expect(SUMBER).toContain('REKONSILIASI_PINJAMAN_SELISIH');
    expect(SUMBER).toContain('2050 non-LPD');
    expect(SUMBER).toContain('pokok aktual');
  });
});

describe('T-B09 — pelunasan tanpa angsuran_id tetap terlihat di audit', () => {
  const KODE = 'PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS';

  /**
   * Posting jurnal pelunasan (D 2050 pokok + D 5063 bunga + K 1014 kas) lalu
   * tautkan lewat `tautkanPembayaran` TANPA `angsuran_id`. Jalur ini hanya
   * mungkin lewat pustaka/library: IPC `bayarAngsuranPinjaman` wajib
   * `angsuran_id`, sedangkan skema dan `tautkanPembayaran` mengizinkan NULL.
   */
  function bayarPelunasanTanpaAngsuran(
    db: Database.Database,
    pokok: number,
    bunga: number,
    idJurnal = 'j-pelunasan-tb09',
    idPembayaran = 'pby-pelunasan-tb09',
  ): void {
    const jurnal = postingJurnal(db, {
      header: {
        id: idJurnal,
        tanggal: '2026-05-10',
        keterangan: 'Pelunasan sisa pokok dan bunga pinjaman',
        jenis: 'HUTANG',
      },
      baris: [
        D('2050', pokok),
        ...(bunga > 0 ? [D('5063', bunga)] : []),
        K('1014', pokok + bunga),
      ],
    }, {
      // Fixture uji tidak mendaftarkan Saldo Awal sebagai pointer aktif, jadi
      // baseline kas posting hanya jurnal pencairan; konfirmasi peringatan
      // saldo kas agar skenario pelunasan bisa diposting penuh.
      konfirmasiPeringatan: true,
      alasanPeringatan: 'Uji T-B09: saldo kas produksi cukup.',
    });
    expect(jurnal.tersimpan, jurnal.errors.join(' ')).toBe(true);

    const taut = tautkanPembayaran(db, {
      id: idPembayaran,
      pinjaman_id: 'pjr-16f',
      jurnal_id: idJurnal,
      catatan: 'Pelunasan tanpa link angsuran',
    });
    expect(taut.tersimpan, taut.errors.join(' ')).toBe(true);
  }

  it('outstanding 0 tetapi ada angsuran BELUM dilaporkan sebagai temuan integritas', () => {
    const { db, pinjamanId, angsuran } = siapkanFixture();
    bayarNormal(db, pinjamanId, angsuran[0].id);
    // Sisa pokok 9 juta + sisa bunga 3 x 100 ribu dilunaskan tanpa link angsuran.
    bayarPelunasanTanpaAngsuran(db, RP(9_000_000), RP(300_000));

    const pinjaman = getPinjaman(db, pinjamanId)!;
    expect(pinjaman.outstanding).toBe(0);
    expect((pinjaman.angsuran ?? []).map((a) => a.status)).toEqual([
      'LUNAS',
      'BELUM',
      'BELUM',
      'BELUM',
    ]);

    // Rekonsiliasi GL vs jadwal tetap cocok (GL 2050 = jadwal = 0), jadi tanpa
    // pemeriksaan T-B09 kondisi kontradiktif ini lolos diam-diam.
    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');

    const temuan = auditIntegritas(db).temuan.filter((t) => t.kode === KODE);
    expect(temuan).toHaveLength(1);
    expect(temuan[0]!.detail).toMatchObject({
      pinjaman_id: pinjamanId,
      outstanding: 0,
      angsuran_belum_lunas: [
        { ke: 2, status: 'BELUM', sisa_pokok: RP(3_000_000), sisa_bunga: RP(100_000) },
        { ke: 3, status: 'BELUM', sisa_pokok: RP(3_000_000), sisa_bunga: RP(100_000) },
        { ke: 4, status: 'BELUM', sisa_pokok: RP(3_000_000), sisa_bunga: RP(100_000) },
      ],
    });
    // Pesan bisa ditindaklanjuti operator: menyebut pinjaman dan penyebab umum.
    expect(temuan[0]!.pesan).toContain(pinjamanId);
    expect(temuan[0]!.pesan).toMatch(/angsuran_id/);
    expect(temuan[0]!.pesan).toMatch(/tidak mengoreksi otomatis/);

    // Pemeriksaan baca-saja: hasil audit stabil dan tidak mengubah data.
    expect(auditIntegritas(db)).toEqual(auditIntegritas(db));
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM pinjaman_bayar').get() as { n: number }).n,
    ).toBe(2);
  });

  it('alur normal: semua angsuran LUNAS dengan outstanding 0 tidak menghasilkan temuan', () => {
    const { db, pinjamanId, angsuran } = siapkanFixture();
    for (let i = 0; i < angsuran.length; i++) {
      const hasil = bayarAngsuranPinjaman(db, {
        id: `pby-normal-tb09-${i + 1}`,
        jurnal_id: `j-bayar-normal-tb09-${i + 1}`,
        pinjaman_id: pinjamanId,
        angsuran_id: angsuran[i]!.id,
        tanggal: `2026-0${i + 2}-05`,
        akun_kas: '1014',
        pokok: RP(3_000_000),
        bunga: RP(100_000),
        noBukti: `B-TB09-${i + 1}`,
      }, {
        konfirmasiPeringatan: true,
        alasanPeringatan: 'Uji T-B09: saldo kas produksi cukup.',
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    }

    const pinjaman = getPinjaman(db, pinjamanId)!;
    expect(pinjaman.outstanding).toBe(0);
    expect((pinjaman.angsuran ?? []).map((a) => a.status)).toEqual([
      'LUNAS',
      'LUNAS',
      'LUNAS',
      'LUNAS',
    ]);
    expect(kodeTemuan(db)).not.toContain(KODE);
  });

  it('outstanding masih tersisa dengan angsuran BELUM tidak menghasilkan temuan', () => {
    const { db, pinjamanId, angsuran } = siapkanFixture();
    bayarNormal(db, pinjamanId, angsuran[0].id);

    expect(getPinjaman(db, pinjamanId)!.outstanding).toBe(RP(9_000_000));
    expect(kodeTemuan(db)).not.toContain(KODE);
  });

  it('temuan bersifat kontrol non-blok di tutup buku dan terdokumentasi', () => {
    const TUTUP = baca('src/db/tutup.ts');
    expect(TUTUP).toContain('PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS');

    const PEMERIKSAAN = baca('docs/panduan-pemeriksaan.md');
    expect(PEMERIKSAAN).toContain('PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS');
    const PRINSIP = baca('docs/prinsip-akuntansi.md');
    expect(PRINSIP).toContain('PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS');
  });
});
