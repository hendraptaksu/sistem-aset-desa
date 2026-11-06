// T2.5 — Matriks alur × akun sistem nonaktif.
//
// T2.4 sudah memblokir deaktivasi akun sistem lewat API (`setAkunAktif`), tetapi
// DB legacy bisa saja sudah membawa `akun.aktif = 0`. Test ini meniru kondisi
// itu dengan `UPDATE akun SET aktif = 0` langsung (trigger tetap aktif dan
// mengizinkan aktif 0), lalu memastikan SETIAP alur yang memakai akun tersebut
// berhenti dengan error validasi yang jelas — bukan crash dan bukan data
// setengah jadi.
//
// Matriks yang diuji (UJI = ada kasus eksplisit, N/A = alur memang tidak
// memakai akun itu sebagai akun tetap):
//
// | Alur \ akun       | 3000 | 1040 | 1050 | 2050 | 2060 | 5063 | 5050 | kas 1001 |
// | ----------------- | ---- | ---- | ---- | ---- | ---- | ---- | ---- | -------- |
// | Saldo awal        | UJI  | N/A  | N/A  | N/A  | N/A  | N/A  | N/A  | UJI      |
// | Panjar            | N/A  | UJI  | N/A  | N/A  | N/A  | N/A  | N/A  | N/A      |
// | Utang usaha       | N/A  | N/A  | N/A  | N/A  | UJI  | N/A  | N/A  | N/A      |
// | Pinjaman LPD      | N/A  | N/A  | N/A  | UJI* | N/A  | UJI  | UJI  | N/A      |
// | Jurnal terpandu   | N/A  | N/A**| N/A  | N/A  | UJI  | N/A  | N/A  | UJI      |
// | Legacy PIUTANG    | N/A  | N/A  | UJI  | N/A  | N/A  | N/A  | N/A  | N/A      |
//
// Catatan matriks:
// - `UJI*` 2050 diuji pada pencairan pinjaman (D kas / K 2050). Pembayaran
//   angsuran juga memeriksa 2050, tetapi kasus minimum tiket ada di pencairan.
// - `N/A**` 1040 sengaja tidak dipakai di jurnal terpandu: 1040 adalah akun
//   kontrol yang hanya boleh disentuh modul Panjar (alur Panjar di atas sudah
//   menguji 1040 nonaktif).
// - 1050: input baru memang sudah legacy/tidak dipakai. Jalur jurnal PIUTANG
//   lama masih ada di posting layer, jadi ikut diuji agar akun legacy nonaktif
//   juga gagal dengan pesan jelas, bukan lolos diam-diam.
//
// Setiap kasus memeriksa: `tersimpan:false` (bukan throw tak tertangani),
// pesan memuat kode akun + status aktif, dan jumlah jurnal/baris jurnal/audit/
// baris dokumen tidak berubah.

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import {
  getAkun,
  listAkun,
  listJurnal,
  listJurnalBaris,
} from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { serahkanPanjar } from '../src/db/panjar.js';
import { simpanSaldoAwal, statusSaldoAwal } from '../src/db/saldoAwal.js';
import {
  bayarAngsuranPinjaman,
  getPinjaman,
  listPinjaman,
  simpanPinjamanLpd,
} from '../src/db/pinjaman.js';
import {
  buatJurnalBayarUtangUsaha,
  buatJurnalCatatUtangUsaha,
  buatJurnalSaldoAwal,
  buatJurnalTerimaUang,
} from '../src/core/forms.js';
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

afterEach(() => {
  for (const db of dbTerbuka.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup test */
    }
  }
});

function bukaDb(): Database.Database {
  const db = openDb(':memory:');
  dbTerbuka.push(db);
  return db;
}

/** DB dengan saldo awal kas 1001 Rp 10.000.000. */
function dbKas(): Database.Database {
  const db = bukaDb();
  const awal = postingJurnal(
    db,
    {
      header: {
        id: 'awal-t25',
        tanggal: '2026-01-01',
        no_bukti: 'SA-T25',
        keterangan: 'Saldo awal uji T2.5',
        jenis: 'SALDO_AWAL',
      },
      baris: [D('1001', RP(10_000_000)), K(AKUN_MODAL, RP(10_000_000))],
    },
    { sekarang: '2026-12-31' },
  );
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

/** Simulasi DB legacy: akun sistem sudah nonaktif sebelum aplikasi dibuka. */
function nonaktifkan(db: Database.Database, kode: string): void {
  db.prepare('UPDATE akun SET aktif = 0 WHERE kode = ?').run(kode);
  expect(getAkun(db, kode)?.aktif, `akun ${kode} harus nonaktif`).toBe(false);
}

type Snapshot = Record<string, number>;

const TABEL_DOKUMEN = [
  'jurnal',
  'jurnal_baris',
  'audit_log',
  'panjar',
  'panjar_item',
  'pinjaman',
  'pinjaman_angsuran',
  'pinjaman_bayar',
] as const;

function snapshot(db: Database.Database): Snapshot {
  const hasil: Snapshot = {};
  for (const tabel of TABEL_DOKUMEN) {
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM ${tabel}`)
      .get() as { n: number };
    hasil[tabel] = Number(row.n);
  }
  return hasil;
}

function expectTidakBerubah(db: Database.Database, sebelum: Snapshot): void {
  expect(snapshot(db)).toEqual(sebelum);
}

type HasilDitolak = { tersimpan: boolean; errors: string[] };

/** Jalankan aksi dan tegaskan tidak ada exception yang lolos ke pemanggil. */
function jalankan<T>(aksi: () => T): T {
  let hasil: T | undefined;
  expect(() => {
    hasil = aksi();
  }).not.toThrow();
  return hasil as T;
}

/**
 * Penolakan harus berupa hasil validasi: `tersimpan:false`, ada pesan, pesan
 * menyebut kode akun, dan menjelaskan status aktif/nonaktif.
 */
function harapkanDitolak(hasil: HasilDitolak, kode: string): string {
  expect(hasil.tersimpan).toBe(false);
  const pesan = hasil.errors.join(' ');
  expect(hasil.errors.length, 'harus ada pesan error').toBeGreaterThan(0);
  expect(pesan).toContain(kode);
  expect(pesan).toMatch(/tidak aktif|nonaktif|wajib.*aktif/i);
  return pesan;
}

function dbPinjamanSiap(): {
  db: Database.Database;
  pinjamanId: string;
  angsuranId: number;
} {
  const db = dbKas();
  const total = RP(3_000_000);
  const hasil = simpanPinjamanLpd(
    db,
    {
      id: 'pjr-t25',
      mode: 'PENCAIRAN',
      kreditur: 'LPD Desa Adat',
      tanggal: '2026-01-02',
      akunKas: '1001',
      akunBunga: '5063',
      pokok: total,
      tenor: 3,
      catatan: 'Pinjaman uji T2.5',
      angsuran: [
        {
          ke: 1,
          jatuh_tempo: '2026-02-01',
          pokok: RP(1_000_000),
          bunga: RP(100_000),
        },
        {
          ke: 2,
          jatuh_tempo: '2026-03-01',
          pokok: RP(1_000_000),
          bunga: RP(100_000),
        },
        {
          ke: 3,
          jatuh_tempo: '2026-04-01',
          pokok: RP(1_000_000),
          bunga: RP(100_000),
        },
      ],
    },
    { sekarang: '2026-12-31' },
  );
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  const pinjaman = getPinjaman(db, 'pjr-t25');
  expect(pinjaman).not.toBeNull();
  const angsuranId = pinjaman?.angsuran?.[0]?.id;
  expect(angsuranId).toBeDefined();
  return { db, pinjamanId: 'pjr-t25', angsuranId: angsuranId as number };
}

// ---------------------------------------------------------------------------
// Saldo awal
// ---------------------------------------------------------------------------

describe('T2.5 — saldo awal dengan akun sistem nonaktif', () => {
  it('3000 MODAL nonaktif: saldo awal ditolak, jurnal/audit tidak bertambah', () => {
    const db = bukaDb(); // belum ada saldo awal
    nonaktifkan(db, '3000');
    const sebelum = snapshot(db);

    const input = jalankan(() =>
      buatJurnalSaldoAwal({
        tanggal: '2026-01-01',
        keterangan: 'Saldo awal dengan modal nonaktif',
        id: 'j-awal-3000-nonaktif',
        saldo: [{ akun_kode: '1001', nominal: RP(5_000_000) }],
        daftarAkun: listAkun(db),
      }).input,
    );
    const hasil = jalankan(() => simpanSaldoAwal(db, input));

    const pesan = harapkanDitolak(hasil, '3000');
    expect(pesan).toMatch(/tidak aktif/i);
    expect(statusSaldoAwal(db).boleh).toBe(true);
    expectTidakBerubah(db, sebelum);
  });

  it('kunci temporal matriks menunjukkan tidak ada error bawaan untuk saldo awal bersih', () => {
    // Penjaga agar kasus di atas tidak lulus karena alasan lain (mis. validasi
    // tanggal/wajib saldo awal): DB baru dengan akun aktif harus bisa menyimpan.
    const db = bukaDb();
    const input = jalankan(() =>
      buatJurnalSaldoAwal({
        tanggal: '2026-01-01',
        keterangan: 'Saldo awal kontrol T2.5',
        id: 'j-awal-kontrol',
        saldo: [{ akun_kode: '1001', nominal: RP(5_000_000) }],
        daftarAkun: listAkun(db),
      }).input,
    );
    const hasil = jalankan(() => simpanSaldoAwal(db, input));
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(statusSaldoAwal(db).boleh).toBe(false);
  });

  it('akun aset 1001 nonaktif: saldo awal ditolak jelas, bukan crash', () => {
    const db = bukaDb();
    nonaktifkan(db, '1001');
    const sebelum = snapshot(db);

    const input = jalankan(() =>
      buatJurnalSaldoAwal({
        tanggal: '2026-01-01',
        keterangan: 'Saldo awal dengan kas nonaktif',
        id: 'j-awal-1001-nonaktif',
        saldo: [{ akun_kode: '1001', nominal: RP(5_000_000) }],
        daftarAkun: listAkun(db),
      }).input,
    );
    const hasil = jalankan(() => simpanSaldoAwal(db, input));

    const pesan = harapkanDitolak(hasil, '1001');
    expect(pesan).toMatch(/tidak aktif/i);
    expectTidakBerubah(db, sebelum);
  });
});

// ---------------------------------------------------------------------------
// Panjar
// ---------------------------------------------------------------------------

describe('T2.5 — panjar dengan 1040 nonaktif', () => {
  it('serah panjar ditolak; tidak ada panjar, item, jurnal, atau audit setengah jadi', () => {
    const db = dbKas();
    nonaktifkan(db, '1040');
    const sebelum = snapshot(db);

    const hasil = jalankan(() =>
      serahkanPanjar(db, {
        id: 'p-t25',
        jurnalId: 'j-p-t25',
        tanggal: '2026-02-01',
        penerima: 'Panitia Piodalan',
        jumlah: RP(1_000_000),
        akunKasSumber: '1001',
        noBukti: 'P-T25',
      }),
    );

    const pesan = harapkanDitolak(hasil, '1040');
    expect(pesan).toMatch(/tidak aktif/i);
    expect(hasil.panjar).toBeUndefined();
    expectTidakBerubah(db, sebelum);
  });
});

// ---------------------------------------------------------------------------
// Utang usaha
// ---------------------------------------------------------------------------

describe('T2.5 — utang usaha dengan 2060 nonaktif', () => {
  it('catat utang usaha ditolak jelas tanpa jurnal', () => {
    const db = dbKas();
    nonaktifkan(db, '2060');
    const sebelum = snapshot(db);

    const input = jalankan(() =>
      buatJurnalCatatUtangUsaha({
        tanggal: '2026-02-01',
        keterangan: 'Perbaikan gedung — utang ke Toko Jaya',
        nominal: RP(300_000),
        akunBeban: '5003',
        id: 'j-catat-utang-t25',
        daftarAkun: listAkun(db),
      }),
    );
    const hasil = jalankan(() => postingJurnal(db, input, { sekarang: '2026-12-31' }));

    const pesan = harapkanDitolak(hasil, '2060');
    expect(pesan).toMatch(/tidak aktif/i);
    expectTidakBerubah(db, sebelum);
  });

  it('bayar utang usaha ditolak jelas tanpa jurnal', () => {
    const db = dbKas();
    nonaktifkan(db, '2060');
    const sebelum = snapshot(db);

    const input = jalankan(() =>
      buatJurnalBayarUtangUsaha({
        tanggal: '2026-02-10',
        keterangan: 'Bayar utang ke Toko Jaya',
        nominal: RP(200_000),
        akunKas: '1001',
        id: 'j-bayar-utang-t25',
        daftarAkun: listAkun(db),
      }),
    );
    const hasil = jalankan(() => postingJurnal(db, input, { sekarang: '2026-12-31' }));

    const pesan = harapkanDitolak(hasil, '2060');
    expect(pesan).toMatch(/tidak aktif/i);
    expectTidakBerubah(db, sebelum);
  });
});

// ---------------------------------------------------------------------------
// Pinjaman LPD
// ---------------------------------------------------------------------------

describe('T2.5 — pinjaman dengan akun sistem nonaktif', () => {
  it('2050 nonaktif: pencairan pinjaman ditolak tanpa jurnal/pinjaman setengah jadi', () => {
    const db = dbKas();
    nonaktifkan(db, '2050');
    const sebelum = snapshot(db);

    const hasil = jalankan(() =>
      simpanPinjamanLpd(
        db,
        {
          id: 'pjr-2050-nonaktif',
          mode: 'PENCAIRAN',
          kreditur: 'LPD Desa Adat',
          tanggal: '2026-01-02',
          akunKas: '1001',
          akunBunga: '5063',
          pokok: RP(3_000_000),
          tenor: 3,
          catatan: 'Pencairan dengan 2050 nonaktif',
          angsuran: [
            {
              ke: 1,
              jatuh_tempo: '2026-02-01',
              pokok: RP(3_000_000),
              bunga: RP(100_000),
            },
          ],
        },
        { sekarang: '2026-12-31' },
      ),
    );

    const pesan = harapkanDitolak(hasil, '2050');
    expect(pesan).toMatch(/tidak aktif/i);
    expect(hasil.jurnal).toBeNull();
    expect(getPinjaman(db, 'pjr-2050-nonaktif')).toBeNull();
    expectTidakBerubah(db, sebelum);
  });

  it('5063 BEBAN BUNGA PINJAMAN nonaktif: pembayaran angsuran ditolak tanpa jurnal', () => {
    const { db, pinjamanId, angsuranId } = dbPinjamanSiap();
    nonaktifkan(db, '5063');
    const sebelum = snapshot(db);

    const hasil = jalankan(() =>
      bayarAngsuranPinjaman(
        db,
        {
          id: 'pby-5063-nonaktif',
          jurnal_id: 'j-bayar-5063-nonaktif',
          pinjaman_id: pinjamanId,
          angsuran_id: angsuranId,
          tanggal: '2026-02-01',
          akun_kas: '1001',
          pokok: RP(1_000_000),
          bunga: RP(100_000),
        },
        { sekarang: '2026-12-31' },
      ),
    );

    const pesan = harapkanDitolak(hasil, '5063');
    expect(pesan).toMatch(/aktif/i);
    expect(hasil.jurnal).toBeUndefined();
    expectTidakBerubah(db, sebelum);
  });

  it('5050 BIAYA LAIN-LAIN nonaktif: pembayaran dengan denda ditolak tanpa jurnal', () => {
    const { db, pinjamanId, angsuranId } = dbPinjamanSiap();
    nonaktifkan(db, '5050');
    const sebelum = snapshot(db);

    const hasil = jalankan(() =>
      bayarAngsuranPinjaman(
        db,
        {
          id: 'pby-5050-nonaktif',
          jurnal_id: 'j-bayar-5050-nonaktif',
          pinjaman_id: pinjamanId,
          angsuran_id: angsuranId,
          tanggal: '2026-02-01',
          akun_kas: '1001',
          pokok: RP(1_000_000),
          bunga: RP(100_000),
          denda: RP(10_000),
        },
        { sekarang: '2026-12-31' },
      ),
    );

    const pesan = harapkanDitolak(hasil, '5050');
    expect(pesan).toMatch(/aktif/i);
    expect(hasil.jurnal).toBeUndefined();
    expectTidakBerubah(db, sebelum);
  });

  it('kontrol: pinjaman dengan semua akun sistem aktif tetap bisa dibayar', () => {
    const { db, pinjamanId, angsuranId } = dbPinjamanSiap();
    const hasil = jalankan(() =>
      bayarAngsuranPinjaman(
        db,
        {
          id: 'pby-kontrol-t25',
          jurnal_id: 'j-bayar-kontrol-t25',
          pinjaman_id: pinjamanId,
          angsuran_id: angsuranId,
          tanggal: '2026-02-01',
          akun_kas: '1001',
          pokok: RP(1_000_000),
          bunga: RP(100_000),
        },
        { sekarang: '2026-12-31' },
      ),
    );
    expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
    expect(listPinjaman(db)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Jurnal terpandu
// ---------------------------------------------------------------------------

describe('T2.5 — jurnal terpandu dengan akun nonaktif', () => {
  it('2060 nonaktif pada Catat Utang Usaha terpandu: ditolak jelas tanpa jurnal', () => {
    const db = dbKas();
    nonaktifkan(db, '2060');
    const sebelum = snapshot(db);

    const input = jalankan(() =>
      buatJurnalCatatUtangUsaha({
        tanggal: '2026-02-01',
        keterangan: 'Catat utang lewat form terpandu',
        nominal: RP(150_000),
        akunBeban: '5003',
        id: 'j-guided-2060',
        daftarAkun: listAkun(db),
      }),
    );
    const hasil = jalankan(() => postingJurnal(db, input, { sekarang: '2026-12-31' }));

    const pesan = harapkanDitolak(hasil, '2060');
    expect(pesan).toMatch(/tidak aktif/i);
    expectTidakBerubah(db, sebelum);
  });

  it('akun kas 1001 nonaktif pada Terima Uang terpandu: ditolak jelas tanpa jurnal', () => {
    const db = dbKas();
    nonaktifkan(db, '1001');
    const sebelum = snapshot(db);

    const input = jalankan(() =>
      buatJurnalTerimaUang({
        tanggal: '2026-02-01',
        keterangan: 'Terima pendapatan parkir',
        nominal: RP(50_000),
        akunKas: '1001',
        akunLawan: '4005',
        id: 'j-guided-kas',
        daftarAkun: listAkun(db),
      }),
    );
    const hasil = jalankan(() => postingJurnal(db, input, { sekarang: '2026-12-31' }));

    const pesan = harapkanDitolak(hasil, '1001');
    expect(pesan).toMatch(/tidak aktif/i);
    expectTidakBerubah(db, sebelum);
  });
});

// ---------------------------------------------------------------------------
// 1050 — jalur legacy yang masih ada di posting layer
// ---------------------------------------------------------------------------

describe('T2.5 — 1050 PIUTANG legacy nonaktif', () => {
  it('jurnal PIUTANG lama ditolak jelas saat 1050 nonaktif (input baru N/A)', () => {
    const db = dbKas();
    nonaktifkan(db, '1050');
    const sebelum = snapshot(db);

    const hasil = jalankan(() =>
      postingJurnal(
        db,
        {
          header: {
            id: 'j-piutang-legacy-t25',
            tanggal: '2026-02-01',
            keterangan: 'Jurnal piutang data lama',
            jenis: 'PIUTANG',
          },
          baris: [D('1050', RP(250_000)), K('1001', RP(250_000))],
        },
        { sekarang: '2026-12-31' },
      ),
    );

    const pesan = harapkanDitolak(hasil, '1050');
    expect(pesan).toMatch(/tidak aktif/i);
    // Jalur 1050 memang legacy; yang penting tidak ada jurnal setengah jadi.
    expect(listJurnal(db).some((j) => j.id === 'j-piutang-legacy-t25')).toBe(false);
    expect(listJurnalBaris(db, 'j-piutang-legacy-t25')).toEqual([]);
    expectTidakBerubah(db, sebelum);
  });
});
