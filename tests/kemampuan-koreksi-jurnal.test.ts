// T2.1 — capability backend untuk tombol "Balik"/"Koreksi" di UI.
//
// Fokus:
// - UI tidak perlu (dan tidak boleh) menebak dari `jenis`/akun.
// - Jurnal dibaca ulang dari DB; data renderer yang basi tidak dipercaya.
// - Panjar & pinjaman memakai relasi tabel, termasuk pembayaran bunga saja
//   yang berjenis HUTANG tetapi tidak memuat akun 2050.

import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  insertJurnalTervalidasi,
  listJurnalLengkap,
} from '../src/db/repository.js';
import { PESAN_REVERSAL } from '../src/core/reversal.js';
import {
  kemampuanKoreksiJurnal,
  PESAN_REVERSAL_PANJAR,
  PESAN_REVERSAL_PINJAMAN,
  PESAN_REVERSAL_SALDO_AWAL,
  reverseJurnal,
} from '../src/db/reversal.js';
import {
  bayarAngsuranPinjaman,
  buatPinjaman,
  getPinjaman,
} from '../src/db/pinjaman.js';
import {
  batalPanjarV2,
  closePanjarV2,
  serahkanPanjar,
} from '../src/db/panjar.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const RP = (rupiah: number): number => rupiah * 100;

const dbs: ReturnType<typeof openDb>[] = [];

function freshDb(): ReturnType<typeof openDb> {
  const db = openDb(':memory:');
  dbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of dbs.splice(0)) {
    try {
      db.close();
    } catch {
      /* sudah ditutup test */
    }
  }
});

function pasangan(
  debit: string,
  kredit: string,
  nominal: number,
): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

function saldoAwal(
  db: ReturnType<typeof openDb>,
  nominal = RP(100_000_000),
): void {
  insertJurnalTervalidasi(
    db,
    {
      id: 'j-modal',
      tanggal: '2026-01-01',
      no_bukti: 'SA-2026-0001',
      keterangan: 'Saldo awal kas',
      jenis: 'SALDO_AWAL',
    },
    pasangan('1001', '3000', nominal),
  );
}

function jurnalUmum(
  db: ReturnType<typeof openDb>,
  id = 'j-umum',
  tanggal = '2026-01-02',
): void {
  insertJurnalTervalidasi(
    db,
    {
      id,
      tanggal,
      no_bukti: `JU-${id}`,
      keterangan: 'Uang parkir minggu I',
      jenis: 'UMUM',
    },
    pasangan('1001', '4005', RP(100_000)),
  );
}

function siapkanPanjar(
  db: ReturnType<typeof openDb>,
  { tutup = false }: { tutup?: boolean } = {},
): void {
  saldoAwal(db);
  const buka = serahkanPanjar(db, {
    id: 'p1',
    jurnalId: 'j-p1-open',
    tanggal: '2026-02-01',
    penerima: 'Panitia Piodalan',
    jumlah: RP(100_000),
    akunKasSumber: '1001',
    noBukti: 'PNJ-2026-0001',
  });
  expect(buka.tersimpan, buka.errors.join(' ')).toBe(true);

  if (!tutup) return;
  const close = closePanjarV2(db, {
    id: 'p1',
    tanggalClose: '2026-03-01',
    jurnalId: 'j-p1-close',
    items: [{ akun: '5004', nominal: RP(100_000) }],
  });
  expect(close.tersimpan, close.errors.join(' ')).toBe(true);
}

function siapkanPinjaman(db: ReturnType<typeof openDb>): void {
  saldoAwal(db);
  insertJurnalTervalidasi(
    db,
    {
      id: 'j-cair',
      tanggal: '2026-01-02',
      no_bukti: 'H-2026-0001',
      keterangan: 'Pencairan pinjaman LPD',
      jenis: 'HUTANG',
    },
    pasangan('1001', '2050', RP(12_000_000)),
  );

  const buat = buatPinjaman(db, {
    id: 'pjr-1',
    kreditur: 'LPD Desa Adat',
    akun_kas: '1001',
    akun_bunga: '5063',
    pokok_awal: RP(12_000_000),
    sisa_pokok_awal: RP(12_000_000),
    tanggal_mulai: '2026-01-02',
    tenor_bulan: 2,
    jurnal_pencairan_id: 'j-cair',
    angsuran: [
      {
        ke: 1,
        jatuh_tempo: '2026-03-01',
        pokok: RP(6_000_000),
        bunga: RP(100_000),
      },
      {
        ke: 2,
        jatuh_tempo: '2026-04-01',
        pokok: RP(6_000_000),
        bunga: RP(100_000),
      },
    ],
  });
  expect(buat.tersimpan, buat.errors.join(' ')).toBe(true);

  const angsuran = getPinjaman(db, 'pjr-1')?.angsuran ?? [];
  const bayarPokok = bayarAngsuranPinjaman(db, {
    id: 'pby-pokok',
    jurnal_id: 'j-bayar-pokok',
    pinjaman_id: 'pjr-1',
    angsuran_id: angsuran[0]?.id,
    tanggal: '2026-03-01',
    akun_kas: '1001',
    pokok: RP(1_000_000),
    bunga: RP(100_000),
  });
  expect(bayarPokok.tersimpan, bayarPokok.errors.join(' ')).toBe(true);

  // Bunga saja: pokok 0, sehingga jurnal HUTANG ini tidak punya baris 2050.
  const bayarBunga = bayarAngsuranPinjaman(db, {
    id: 'pby-bunga',
    jurnal_id: 'j-bayar-bunga',
    pinjaman_id: 'pjr-1',
    angsuran_id: angsuran[1]?.id,
    tanggal: '2026-04-01',
    akun_kas: '1001',
    pokok: 0,
    bunga: RP(100_000),
  });
  expect(bayarBunga.tersimpan, bayarBunga.errors.join(' ')).toBe(true);
}

describe('T2.1 — kemampuan koreksi jurnal', () => {
  it('jurnal UMUM biasa boleh dibalik dan dikoreksi', () => {
    const db = freshDb();
    jurnalUmum(db);

    expect(kemampuanKoreksiJurnal(db, { id: 'j-umum' })).toEqual({
      bisaDibalik: true,
      bisaDikoreksi: true,
      alasan: null,
    });
  });

  it('jurnal tidak ditemukan ditolak dengan alasan yang jelas', () => {
    const db = freshDb();

    expect(
      kemampuanKoreksiJurnal(db, { id: 'tidak-ada', jenis: 'UMUM' }),
    ).toEqual({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL.tidakDitemukan,
    });
    expect(kemampuanKoreksiJurnal(db, { id: '  ' })).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL.tidakDitemukan,
    });
    expect(kemampuanKoreksiJurnal(db, null)).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL.tidakDitemukan,
    });
  });

  it('jurnal REVERSAL dan jurnal yang sudah dikoreksi ditolak', () => {
    const db = freshDb();
    jurnalUmum(db);
    const balik = reverseJurnal(db, 'j-umum', 'Salah input nominal', {
      id: 'j-umum-balik',
      tanggal: '2026-01-03',
    });
    expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);

    expect(kemampuanKoreksiJurnal(db, { id: 'j-umum' })).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL.sudahDibalik,
    });
    expect(kemampuanKoreksiJurnal(db, { id: 'j-umum-balik' })).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL.asliBalik,
    });
  });

  it('saldo awal ditolak walau renderer mengaku jenis UMUM', () => {
    const db = freshDb();
    saldoAwal(db);

    // `jenis` dari pemanggil sengaja salah: helper wajib membaca ulang dari DB.
    expect(
      kemampuanKoreksiJurnal(db, { id: 'j-modal', jenis: 'UMUM' }),
    ).toEqual({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL_SALDO_AWAL,
    });
  });

  it('T-A02: jurnal pembukaan OPENING/OPENING_REPLACEMENT tidak ditawarkan koreksi generik', () => {
    const db = freshDb();

    insertJurnalTervalidasi(
      db,
      {
        id: 'j-opening',
        tanggal: '2026-01-01',
        no_bukti: 'SA-2026-0001',
        keterangan: 'Saldo awal berperan OPENING',
        jenis: 'SALDO_AWAL',
        peran: 'OPENING',
      },
      pasangan('1001', '3000', RP(1_000_000)),
    );

    insertJurnalTervalidasi(
      db,
      {
        id: 'j-asal',
        tanggal: '2026-01-02',
        no_bukti: 'JU-2026-0001',
        keterangan: 'Jurnal asal',
        jenis: 'UMUM',
      },
      pasangan('1001', '4005', RP(100_000)),
    );
    insertJurnalTervalidasi(
      db,
      {
        id: 'j-pengganti-pembukaan',
        tanggal: '2026-01-02',
        no_bukti: 'JU-2026-0002',
        keterangan: 'Pengganti pembukaan',
        jenis: 'UMUM',
        peran: 'OPENING_REPLACEMENT',
        replaces_id: 'j-asal',
      },
      pasangan('1001', '4005', RP(90_000)),
    );

    for (const id of ['j-opening', 'j-pengganti-pembukaan']) {
      expect(kemampuanKoreksiJurnal(db, { id })).toEqual({
        bisaDibalik: false,
        bisaDikoreksi: false,
        alasan: PESAN_REVERSAL_SALDO_AWAL,
      });
    }
  });

  it('jurnal open dan close panjar ditolak dengan alasan panjar', () => {
    const db = freshDb();
    siapkanPanjar(db, { tutup: true });

    for (const id of ['j-p1-open', 'j-p1-close']) {
      expect(kemampuanKoreksiJurnal(db, { id })).toMatchObject({
        bisaDibalik: false,
        bisaDikoreksi: false,
        alasan: PESAN_REVERSAL_PANJAR,
      });
    }

    // Jurnal batal panjar adalah REVERSAL; tetap tidak boleh dikoreksi dan
    // helper tidak boleh crash saat kolom `jurnal_batal_id` ikut diperiksa.
    // DB-21 hanya mengizinkan pembatalan panjar OPEN, jadi pakai DB terpisah.
    const dbBatal = freshDb();
    siapkanPanjar(dbBatal);
    const batal = batalPanjarV2(dbBatal, {
      id: 'p1',
      alasan: 'Salah serah ke panitia',
      jurnalId: 'j-batal-p1',
      tanggalBatal: '2026-03-02',
    });
    expect(batal.tersimpan, batal.errors.join(' ')).toBe(true);
    expect(kemampuanKoreksiJurnal(dbBatal, { id: 'j-batal-p1' })).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL.asliBalik,
    });
  });

  it('jurnal pencairan pinjaman ditolak dengan alasan pinjaman', () => {
    const db = freshDb();
    siapkanPinjaman(db);

    expect(kemampuanKoreksiJurnal(db, { id: 'j-cair' })).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL_PINJAMAN,
    });
  });

  it('pembayaran pokok+bunga dan bunga saja (pokok 0) terdeteksi lewat relasi', () => {
    const db = freshDb();
    siapkanPinjaman(db);

    // Pembayaran pokok+bunga memang memuat 2050.
    expect(kemampuanKoreksiJurnal(db, { id: 'j-bayar-pokok' })).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL_PINJAMAN,
    });

    // Pembayaran bunga saja: HUTANG tanpa 2050. Deteksi lama berbasis akun
    // akan salah mengizinkan; relasi `pinjaman_bayar.jurnal_id` tetap menolak.
    const akunBunga = (
      db
        .prepare('SELECT akun_kode FROM jurnal_baris WHERE jurnal_id = ?')
        .all('j-bayar-bunga') as { akun_kode: string }[]
    ).map((r) => r.akun_kode);
    expect(akunBunga).toContain('5063');
    expect(akunBunga).not.toContain('2050');

    expect(kemampuanKoreksiJurnal(db, { id: 'j-bayar-bunga' })).toMatchObject({
      bisaDibalik: false,
      bisaDikoreksi: false,
      alasan: PESAN_REVERSAL_PINJAMAN,
    });
  });

  it('DTO listJurnalLengkap membawa flag untuk UMUM, SALDO_AWAL, REVERSAL, dan yang sudah dikoreksi', () => {
    const db = freshDb();
    saldoAwal(db);
    jurnalUmum(db);
    jurnalUmum(db, 'j-umum-2', '2026-01-04');
    const balik = reverseJurnal(db, 'j-umum', 'Salah input nominal', {
      id: 'j-umum-balik',
      tanggal: '2026-01-03',
    });
    expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);

    const rows = listJurnalLengkap(db);
    const cari = (id: string) => {
      const row = rows.find((j) => j.id === id);
      expect(row, `jurnal ${id} harus ada`).toBeDefined();
      return row!;
    };

    expect(cari('j-umum-2')).toMatchObject({
      bisa_dibalik: true,
      bisa_dikoreksi: true,
      alasan_tidak_bisa: null,
    });
    expect(cari('j-modal')).toMatchObject({
      bisa_dibalik: false,
      bisa_dikoreksi: false,
      alasan_tidak_bisa: PESAN_REVERSAL_SALDO_AWAL,
    });
    expect(cari('j-umum-balik')).toMatchObject({
      bisa_dibalik: false,
      bisa_dikoreksi: false,
      alasan_tidak_bisa: PESAN_REVERSAL.asliBalik,
    });
    expect(cari('j-umum')).toMatchObject({
      bisa_dibalik: false,
      bisa_dikoreksi: false,
      alasan_tidak_bisa: PESAN_REVERSAL.sudahDibalik,
    });
  });

  it('DTO flag menolak panjar dan pinjaman (termasuk bunga saja)', () => {
    const dbPanjar = freshDb();
    siapkanPanjar(dbPanjar, { tutup: true });
    const panjarRows = listJurnalLengkap(dbPanjar);
    for (const id of ['j-p1-open', 'j-p1-close']) {
      expect(panjarRows.find((j) => j.id === id)).toMatchObject({
        bisa_dibalik: false,
        bisa_dikoreksi: false,
        alasan_tidak_bisa: PESAN_REVERSAL_PANJAR,
      });
    }

    const dbPinjaman = freshDb();
    siapkanPinjaman(dbPinjaman);
    const pinjamanRows = listJurnalLengkap(dbPinjaman);
    for (const id of ['j-cair', 'j-bayar-pokok', 'j-bayar-bunga']) {
      expect(pinjamanRows.find((j) => j.id === id)).toMatchObject({
        bisa_dibalik: false,
        bisa_dikoreksi: false,
        alasan_tidak_bisa: PESAN_REVERSAL_PINJAMAN,
      });
    }
  });

  it('jurnal UMUM di grup saldo awal tetap boleh dikoreksi', () => {
    const db = freshDb();
    insertJurnalTervalidasi(
      db,
      {
        id: 'j-awal-grup',
        tanggal: '2026-01-01',
        no_bukti: 'JU-2026-0001',
        keterangan: 'Saldo awal kas',
        jenis: 'SALDO_AWAL',
        grup_id: 'g-pembukaan',
      },
      pasangan('1001', '3000', RP(1_000_000)),
    );
    insertJurnalTervalidasi(
      db,
      {
        id: 'j-penyesuaian',
        tanggal: '2026-01-05',
        no_bukti: 'JU-2026-0002',
        keterangan: 'Penyesuaian pindah kas ke bank',
        jenis: 'UMUM',
        grup_id: 'g-pembukaan',
      },
      pasangan('1029', '1001', RP(50_000)),
    );

    expect(kemampuanKoreksiJurnal(db, { id: 'j-penyesuaian' })).toEqual({
      bisaDibalik: true,
      bisaDikoreksi: true,
      alasan: null,
    });
  });
});
