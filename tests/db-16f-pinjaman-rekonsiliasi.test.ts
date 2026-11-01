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
  getPinjaman,
  simpanPinjamanLpd,
} from '../src/db/pinjaman.js';
import {
  rekonsiliasiPinjaman,
  rekonsiliasiSemuaPinjaman,
} from '../src/db/pinjamanRekonsiliasi.js';
import { auditIntegritas } from '../src/db/integritas.js';
import { postingJurnal } from '../src/db/posting.js';
import { validasiBentukPinjamanRekonsiliasi } from '../src/main/validation.js';
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
    db.prepare('UPDATE pinjaman SET sisa_pokok_awal = ? WHERE id = ?').run(
      RP(12_500_000),
      pinjamanId,
    );

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

  it('pinjaman berjalan memakai sisa_pokok_awal sebagai saldo awal 2050', () => {
    const db = openDb(':memory:');
    dbTerbuka.push(db);
    const simpan = simpanPinjamanLpd(db, {
      id: 'pjr-berjalan-16f',
      mode: 'BERJALAN',
      kreditur: 'LPD Desa Adat',
      tanggal: '2026-01-01',
      sisaPokok: RP(5_000_000),
      akunBunga: '5063',
      angsuran: [
        {
          ke: 1,
          jatuh_tempo: '2026-02-01',
          pokok: RP(5_000_000),
          bunga: RP(100_000),
        },
      ],
    });
    expect(simpan.tersimpan, simpan.errors.join(' ')).toBe(true);

    const hasil = rekonsiliasiPinjaman(db, simpan.pinjaman!.id)!;
    expect(hasil).toMatchObject({
      gl: RP(5_000_000),
      jadwal: RP(5_000_000),
      selisih: 0,
      cocok: true,
    });
    expect(hasil.pesan).toMatch(/cocok/i);
    expect(kodeTemuan(db)).not.toContain('REKONSILIASI_PINJAMAN_SELISIH');
  });

  it('jurnal pembayaran salah akun tetap terdeteksi lewat selisih GL vs jadwal', () => {
    const { db, pinjamanId, angsuran } = siapkanFixture();
    const jurnal = postingJurnal(db, {
      header: {
        id: 'j-salah-akun',
        tanggal: '2026-02-05',
        keterangan: 'Pembayaran pokok salah akun (2060)',
        jenis: 'HUTANG',
      },
      baris: [D('2060', RP(3_000_000)), K('1014', RP(3_000_000))],
    });
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
    db.prepare('UPDATE pinjaman SET sisa_pokok_awal = ? WHERE id = ?').run(
      RP(12_500_000),
      pinjamanId,
    );

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
  const SUMBER = baca('docs/sumber-data-pinjaman.md');

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
    expect(PANDUAN).toContain('DB-16f');
    expect(PANDUAN).toContain('Rekonsiliasi 2050');
    expect(PANDUAN).toContain('tidak mengoreksi otomatis');
    expect(PANDUAN).toContain('Saldo Awal');

    expect(SUMBER).toContain('DB-16f');
    expect(SUMBER).toContain('REKONSILIASI_PINJAMAN_SELISIH');
    expect(SUMBER).toContain('2050 non-LPD');
    expect(SUMBER).toContain('pokok aktual');
  });
});
