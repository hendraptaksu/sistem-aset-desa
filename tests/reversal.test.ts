// P0-6: koreksi = jurnal balik (reversal) + opsi "Koreksi & isi ulang".
// Fokus: jurnal asli tidak pernah diubah, saldo kembali ke posisi semula,
// reversal ganda/reversal atas reversal ditolak, kunci periode dihormati,
// dan alur isi ulang atomik (gagal = tidak ada koreksi setengah jadi).

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  getJurnalDetail,
  insertJurnalTervalidasi,
  listAuditLog,
  listJurnal,
  listJurnalLengkap,
} from '../src/db/repository.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import {
  koreksiDanIsiUlang,
  PESAN_REVERSAL_PANJAR,
  reverseJurnal,
} from '../src/db/reversal.js';
import {
  closePanjarV2,
  getPanjar,
  serahkanPanjar,
} from '../src/db/panjar.js';
import { neracaSaldo, labaTahun, saldoAkun } from '../src/core/reports.js';
import {
  PESAN_REVERSAL,
  rencanaReversal,
  type RencanaReversalInput,
} from '../src/core/reversal.js';
import type { Jurnal, JurnalBaris, JurnalBarisInput } from '../src/core/types.js';

const RP = (rupiah: number): number => rupiah * 100;

const dirs: string[] = [];

function freshDb(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), 'pura-reversal-'));
  dirs.push(dir);
  return openDb(join(dir, 'pura.db'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function pasangan(debit: string, kredit: string, nominal: number): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

function modal(db: ReturnType<typeof openDb>, nominal = RP(1_000_000)): void {
  insertJurnalTervalidasi(
    db,
    {
      id: 'j-modal',
      tanggal: '2026-01-01',
      no_bukti: 'JU-2026-0001',
      keterangan: 'Saldo awal kas',
      jenis: 'SALDO_AWAL',
    },
    pasangan('1001', '3000', nominal),
  );
}

function parkir(db: ReturnType<typeof openDb>, nominal = RP(100_000)): void {
  insertJurnalTervalidasi(
    db,
    {
      id: 'j-parkir',
      tanggal: '2026-01-02',
      no_bukti: 'JU-2026-0002',
      keterangan: 'Uang parkir minggu I',
      jenis: 'TERIMA',
    },
    pasangan('1001', '4005', nominal),
  );
}

function jumlahJurnal(db: ReturnType<typeof openDb>): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM jurnal').get() as { c: number }).c;
}

// ---------------------------------------------------------------------------
// Bagian murni: rencana jurnal balik
// ---------------------------------------------------------------------------

const JURNAL_ASLI: Jurnal = {
  id: 'j-asli',
  tanggal: '2026-01-02',
  no_bukti: 'JU-2026-0002',
  keterangan: 'Uang parkir',
  jenis: 'TERIMA',
  grup_id: 'g-parkir',
  reversal_of: null,
  created_at: '2026-01-02T08:00:00.000Z',
};

const BARIS_ASLI: JurnalBaris[] = [
  {
    id: 1,
    jurnal_id: 'j-asli',
    akun_kode: '1001',
    debit: RP(100_000),
    kredit: 0,
    keterangan: 'Kas masuk',
  },
  {
    id: 2,
    jurnal_id: 'j-asli',
    akun_kode: '4005',
    debit: 0,
    kredit: RP(100_000),
    keterangan: 'Pendapatan parkir',
  },
];

function rencana(over: Partial<RencanaReversalInput> = {}) {
  return rencanaReversal({
    jurnal: JURNAL_ASLI,
    baris: BARIS_ASLI,
    reversalAda: [],
    id: 'j-balik',
    tanggal: '2026-01-03',
    alasan: 'Salah input nominal',
    ...over,
  });
}

describe('P0-6 — rencana jurnal balik (murni)', () => {
  it('menukar debit/kredit, memakai grup yang sama, dan berjenis REVERSAL', () => {
    const r = rencana();
    expect(r.boleh).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.input?.header).toMatchObject({
      id: 'j-balik',
      tanggal: '2026-01-03',
      jenis: 'REVERSAL',
      grup_id: 'g-parkir',
      reversal_of: 'j-asli',
      keterangan: 'KOREKSI: Uang parkir — Salah input nominal',
    });
    expect(r.input?.baris).toEqual([
      { akun_kode: '1001', debit: 0, kredit: RP(100_000), keterangan: 'Kas masuk' },
      { akun_kode: '4005', debit: RP(100_000), kredit: 0, keterangan: 'Pendapatan parkir' },
    ]);
    expect(r.input?.alasan).toBe('Salah input nominal');
  });

  it('menolak alasan pendek, tanggal salah, jurnal tidak ada, dan baris kurang', () => {
    expect(rencana({ alasan: 'sala' }).errors).toContain(PESAN_REVERSAL.alasanPendek);
    expect(rencana({ tanggal: '2026-02-31' }).errors).toContain(PESAN_REVERSAL.tanggalSalah);
    expect(rencana({ jurnal: null }).errors).toContain(PESAN_REVERSAL.tidakDitemukan);
    expect(rencana({ baris: [] }).errors).toContain(PESAN_REVERSAL.barisKurang);
    expect(rencana({ id: '  ' }).errors).toContain(PESAN_REVERSAL.idKosong);
  });

  it('menolak reversal ganda dan reversal atas jurnal balik', () => {
    expect(rencana({ reversalAda: [{ id: 'j-balik-lama' }] }).errors).toContain(
      PESAN_REVERSAL.sudahDibalik,
    );
    expect(
      rencana({ jurnal: { ...JURNAL_ASLI, reversal_of: 'j-asli-lain' } }).errors,
    ).toContain(PESAN_REVERSAL.asliBalik);
  });
});

// ---------------------------------------------------------------------------
// Bagian DB: reversal & koreksi isi ulang
// ---------------------------------------------------------------------------

describe('P0-6 — reversal di database', () => {
  it('saldo kembali ke sebelum jurnal asli; jurnal asli tetap ada; audit tercatat', () => {
    const db = freshDb();
    try {
      modal(db);
      parkir(db);
      expect(saldoAkun(listBarisJurnal(db), '4005', '2026-12-31')).toBe(RP(100_000));
      expect(saldoAkun(listBarisJurnal(db), '1001', '2026-12-31')).toBe(RP(1_100_000));

      const hasil = reverseJurnal(db, 'j-parkir', 'Salah input nominal', {
        id: 'j-balik-parkir',
        tanggal: '2026-01-05',
      });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.errors).toEqual([]);
      expect(hasil.reversal).toMatchObject({
        id: 'j-balik-parkir',
        tanggal: '2026-01-05',
        jenis: 'REVERSAL',
        grup_id: 'j-parkir',
        reversal_of: 'j-parkir',
      });

      // Jurnal asli tidak dihapus/diubah.
      expect(getJurnalDetail(db, 'j-parkir')?.jurnal).toMatchObject({
        keterangan: 'Uang parkir minggu I',
        reversal_of: null,
      });
      const detailBalik = getJurnalDetail(db, 'j-balik-parkir');
      expect(detailBalik?.baris).toEqual([
        expect.objectContaining({ akun_kode: '1001', debit: 0, kredit: RP(100_000) }),
        expect.objectContaining({ akun_kode: '4005', debit: RP(100_000), kredit: 0 }),
      ]);

      // Saldo pendapatan kembali nol; kas kembali ke modal awal.
      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '4005', '2026-12-31')).toBe(0);
      expect(saldoAkun(baris, '1001', '2026-12-31')).toBe(RP(1_000_000));
      expect(neracaSaldo(baris, '2026-12-31').selisih).toBe(0);
      expect(listJurnal(db).map((j) => j.id)).toEqual(['j-modal', 'j-parkir', 'j-balik-parkir']);

      // Data untuk layar Jurnal Umum: status koreksi ikut terbaca.
      const lengkap = listJurnalLengkap(db);
      expect(lengkap.find((j) => j.id === 'j-parkir')).toMatchObject({
        reversal_id: 'j-balik-parkir',
        total_debit: RP(100_000),
      });
      expect(lengkap.find((j) => j.id === 'j-balik-parkir')).toMatchObject({
        reversal_of: 'j-parkir',
        reversal_id: null,
      });

      const audit = listAuditLog(db);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ aksi: 'REVERSAL j-parkir', alasan: 'Salah input nominal' });
    } finally {
      db.close();
    }
  });

  it('tanpa tanggal eksplisit, reversal memakai tanggal jurnal asli (tidak menggeser laba)', () => {
    const db = freshDb();
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-pendapatan-2025',
          tanggal: '2025-06-15',
          no_bukti: 'JU-2025-0100',
          keterangan: 'Pendapatan 2025',
          jenis: 'TERIMA',
        },
        pasangan('1001', '4005', RP(100)),
      );

      const sebelum = listBarisJurnal(db);
      expect(labaTahun(sebelum, 2025)).toBe(RP(100));
      expect(labaTahun(sebelum, 2026)).toBe(0);

      const hasil = reverseJurnal(db, 'j-pendapatan-2025', 'Salah input pendapatan');
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.reversal?.tanggal).toBe('2025-06-15');

      // Balik di tahun yang sama: laba 2025 kembali nol, 2026 tidak berubah.
      const sesudah = listBarisJurnal(db);
      expect(labaTahun(sesudah, 2025)).toBe(0);
      expect(labaTahun(sesudah, 2026)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('tanggal reversal eksplisit tetap dihormati walau berbeda tahun dari jurnal asli', () => {
    const db = freshDb();
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-pendapatan-2025',
          tanggal: '2025-06-15',
          no_bukti: 'JU-2025-0100',
          keterangan: 'Pendapatan 2025',
          jenis: 'TERIMA',
        },
        pasangan('1001', '4005', RP(100)),
      );

      const hasil = reverseJurnal(db, 'j-pendapatan-2025', 'Koreksi lintas tahun', {
        tanggal: '2026-01-10',
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.reversal?.tanggal).toBe('2026-01-10');

      const sesudah = listBarisJurnal(db);
      expect(labaTahun(sesudah, 2025)).toBe(RP(100));
      expect(labaTahun(sesudah, 2026)).toBe(-RP(100));
    } finally {
      db.close();
    }
  });

  it('menolak reversal ganda dan reversal atas jurnal balik (repository & service)', () => {
    const db = freshDb();
    try {
      modal(db);
      parkir(db);
      expect(
        reverseJurnal(db, 'j-parkir', 'Salah input', { id: 'j-balik-1', tanggal: '2026-01-05' })
          .tersimpan,
      ).toBe(true);

      const ganda = reverseJurnal(db, 'j-parkir', 'Coba lagi', {
        id: 'j-balik-2',
        tanggal: '2026-01-06',
      });
      expect(ganda.tersimpan).toBe(false);
      expect(ganda.errors.join(' ')).toMatch(/sudah pernah dikoreksi/);

      const atasBalik = reverseJurnal(db, 'j-balik-1', 'Balik lagi', {
        id: 'j-balik-3',
        tanggal: '2026-01-07',
      });
      expect(atasBalik.tersimpan).toBe(false);
      expect(atasBalik.errors.join(' ')).toMatch(/jurnal balik/i);

      // Penjagaan terakhir di repository bila service dilewati.
      expect(() =>
        insertJurnalTervalidasi(
          db,
          {
            id: 'j-balik-mentah',
            tanggal: '2026-01-08',
            keterangan: 'Reversal ganda manual',
            reversal_of: 'j-parkir',
          },
          pasangan('4005', '1001', RP(100_000)),
        ),
      ).toThrow(/sudah dikoreksi/);

      expect(jumlahJurnal(db)).toBe(3);
      expect(listAuditLog(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('menghormati kunci periode: reversal bertanggal tahun terkunci wajib beralasan', () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan) VALUES (?, ?, ?, ?)',
      ).run(2025, '2026-01-01T00:00:00.000Z', '', 'Uji kunci');

      insertJurnalTervalidasi(
        db,
        {
          id: 'j-lama',
          tanggal: '2025-12-20',
          no_bukti: 'JU-2025-0001',
          keterangan: 'Penerimaan lama',
        },
        pasangan('1001', '4005', RP(50_000)),
      );

      // Alasan koreksi selalu wajib; alasan yang sama memenuhi kunci periode.
      const hasil = reverseJurnal(db, 'j-lama', 'Koreksi struk Desember', {
        id: 'j-lama-balik',
        tanggal: '2025-12-31',
      });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.reversal?.tanggal).toBe('2025-12-31');

      // Tanpa alasan yang memenuhi syarat, service tidak menyimpan apa pun.
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-lama-2',
          tanggal: '2025-12-21',
          no_bukti: 'JU-2025-0003',
          keterangan: 'Penerimaan lama 2',
        },
        pasangan('1001', '4005', RP(25_000)),
      );
      const tanpaAlasan = reverseJurnal(db, 'j-lama-2', 'sala', {
        id: 'j-lama-2-balik',
        tanggal: '2025-12-31',
      });
      expect(tanpaAlasan.tersimpan).toBe(false);
      expect(tanpaAlasan.errors.join(' ')).toMatch(/minimal 5 karakter/);
      expect(jumlahJurnal(db)).toBe(3);
    } finally {
      db.close();
    }
  });

  it('peringatan kas minus wajib dikonfirmasi dulu, baru menyimpan', () => {
    const db = freshDb();
    try {
      parkir(db); // kas 100rb dari pendapatan
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-belanja',
          tanggal: '2026-01-03',
          no_bukti: 'JU-2026-0003',
          keterangan: 'Belanja habiskan kas',
          jenis: 'BAYAR',
        },
        pasangan('5000', '1001', RP(100_000)),
      );

      const belum = reverseJurnal(db, 'j-parkir', 'Salah catat pendapatan', {
        id: 'j-balik-parkir',
        tanggal: '2026-01-04',
      });
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(2);

      const lanjut = reverseJurnal(db, 'j-parkir', 'Salah catat pendapatan', {
        id: 'j-balik-parkir',
        tanggal: '2026-01-04',
        konfirmasiPeringatan: true,
      });
      expect(lanjut.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(3);
    } finally {
      db.close();
    }
  });
});

describe('P0-6 — koreksi & isi ulang', () => {
  it('membuat reversal + jurnal pengganti dalam satu alur, audit dua baris', () => {
    const db = freshDb();
    try {
      modal(db);
      parkir(db);

      const hasil = koreksiDanIsiUlang(
        db,
        'j-parkir',
        'Nominal salah, seharusnya 80rb',
        {
          header: {
            id: 'j-parkir-baru',
            tanggal: '2026-01-02',
            no_bukti: 'JU-2026-0099',
            keterangan: 'Uang parkir minggu I (koreksi)',
            jenis: 'TERIMA',
          },
          baris: pasangan('1001', '4005', RP(80_000)),
        },
        { id: 'j-balik-parkir', tanggal: '2026-01-05' },
      );

      expect(hasil.tersimpan).toBe(true);
      expect(hasil.reversal).toMatchObject({
        reversal_of: 'j-parkir',
        jenis: 'REVERSAL',
        grup_id: 'j-parkir',
      });
      expect(hasil.jurnalBaru).toMatchObject({
        id: 'j-parkir-baru',
        reversal_of: null,
        grup_id: 'j-parkir',
      });

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '4005', '2026-12-31')).toBe(RP(80_000));
      expect(saldoAkun(baris, '1001', '2026-12-31')).toBe(RP(1_080_000));
      expect(neracaSaldo(baris, '2026-12-31').selisih).toBe(0);

      // Jurnal asli tetap ada; jumlah = modal + asli + reversal + pengganti.
      expect(getJurnalDetail(db, 'j-parkir')).not.toBeNull();
      expect(jumlahJurnal(db)).toBe(4);
      const audit = listAuditLog(db);
      expect(audit.map((a) => a.aksi).sort()).toEqual([
        'KOREKSI-ISI-ULANG j-parkir',
        'REVERSAL j-parkir',
      ]);
    } finally {
      db.close();
    }
  });

  it('AKT-22: grup pengganti selalu ikut jurnal asli dan input grup diabaikan', () => {
    const db = freshDb();
    try {
      modal(db);
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-parkir-grup',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0010',
          keterangan: 'Parkir dengan grup khusus',
          jenis: 'TERIMA',
          grup_id: 'g-parkir-asli',
        },
        pasangan('1001', '4005', RP(100_000)),
      );

      const hasil = koreksiDanIsiUlang(
        db,
        'j-parkir-grup',
        'Nominal salah, seharusnya 90rb',
        {
          header: {
            id: 'j-parkir-grup-baru',
            tanggal: '2026-01-02',
            no_bukti: 'JU-2026-0011',
            keterangan: 'Parkir (koreksi)',
            jenis: 'TERIMA',
            grup_id: 'g-palsu-dari-luar',
            reversal_of: null,
          },
          baris: pasangan('1001', '4005', RP(90_000)),
        },
        { id: 'j-parkir-grup-balik', tanggal: '2026-01-05' },
      );

      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.jurnalBaru).toMatchObject({
        grup_id: 'g-parkir-asli',
        reversal_of: null,
        jenis: 'TERIMA',
      });
      expect(hasil.reversal).toMatchObject({
        grup_id: 'g-parkir-asli',
        reversal_of: 'j-parkir-grup',
        jenis: 'REVERSAL',
      });
    } finally {
      db.close();
    }
  });

  it('AKT-22: menolak pengganti berjenis REVERSAL tanpa menulis jurnal/audit', () => {
    const db = freshDb();
    try {
      modal(db);
      parkir(db);
      const sebelum = jumlahJurnal(db);

      const hasil = koreksiDanIsiUlang(
        db,
        'j-parkir',
        'Nominal salah, seharusnya 80rb',
        {
          header: {
            id: 'j-parkir-baru',
            tanggal: '2026-01-02',
            keterangan: 'Pengganti berjenis reversal palsu',
            jenis: 'REVERSAL',
          },
          baris: pasangan('1001', '4005', RP(80_000)),
        },
        { id: 'j-balik-parkir', tanggal: '2026-01-05' },
      );

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/REVERSAL/);
      expect(jumlahJurnal(db)).toBe(sebelum);
      expect(getJurnalDetail(db, 'j-balik-parkir')).toBeNull();
      expect(getJurnalDetail(db, 'j-parkir-baru')).toBeNull();
      expect(listAuditLog(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('AKT-22: SALDO_AWAL pengganti hanya boleh bila jurnal asli SALDO_AWAL', () => {
    const db = freshDb();
    try {
      modal(db);
      parkir(db);
      const sebelum = jumlahJurnal(db);

      const ditolak = koreksiDanIsiUlang(
        db,
        'j-parkir',
        'Ubah jenis menjadi saldo awal',
        {
          header: {
            id: 'j-parkir-jadi-awal',
            tanggal: '2026-01-02',
            keterangan: 'Parkir diubah jadi saldo awal',
            jenis: 'SALDO_AWAL',
          },
          baris: pasangan('1001', '4005', RP(80_000)),
        },
        { id: 'j-balik-parkir', tanggal: '2026-01-05' },
      );

      expect(ditolak.tersimpan).toBe(false);
      expect(ditolak.errors.join(' ')).toMatch(/SALDO_AWAL/);
      expect(jumlahJurnal(db)).toBe(sebelum);
      expect(getJurnalDetail(db, 'j-balik-parkir')).toBeNull();
      expect(getJurnalDetail(db, 'j-parkir-jadi-awal')).toBeNull();
      expect(listAuditLog(db)).toEqual([]);

      const diterima = koreksiDanIsiUlang(
        db,
        'j-modal',
        'Nominal saldo awal salah, seharusnya 900rb',
        {
          header: {
            id: 'j-modal-baru',
            tanggal: '2026-01-01',
            keterangan: 'Saldo awal kas (koreksi)',
            jenis: 'SALDO_AWAL',
          },
          baris: pasangan('1001', '3000', RP(900_000)),
        },
        { id: 'j-modal-balik', tanggal: '2026-01-01' },
      );

      expect(diterima.tersimpan, diterima.errors.join(' ')).toBe(true);
      expect(diterima.jurnalBaru).toMatchObject({
        grup_id: 'j-modal',
        reversal_of: null,
        jenis: 'SALDO_AWAL',
      });
    } finally {
      db.close();
    }
  });

  it('atomik: bila jurnal pengganti gagal, reversal dan audit batal', () => {
    const db = freshDb();
    try {
      modal(db);
      parkir(db);
      const sebelum = jumlahJurnal(db);

      // Validasi lolos, tetapi ID pengganti bentrok dengan jurnal yang sudah
      // ada → insert gagal setelah reversal ditulis; transaksi harus rollback.
      const bentrok = koreksiDanIsiUlang(
        db,
        'j-parkir',
        'Nominal salah',
        {
          header: {
            id: 'j-modal',
            tanggal: '2026-01-02',
            keterangan: 'Pengganti bentrok',
          },
          baris: pasangan('1001', '4005', RP(80_000)),
        },
        { id: 'j-balik-parkir', tanggal: '2026-01-05' },
      );
      expect(bentrok.tersimpan).toBe(false);
      expect(bentrok.errors.join(' ')).toMatch(/sudah ada/);
      expect(jumlahJurnal(db)).toBe(sebelum);
      expect(getJurnalDetail(db, 'j-balik-parkir')).toBeNull();
      expect(listAuditLog(db)).toEqual([]);

      // Nomor bukti duplikat juga ditolak sebelum menulis apa pun.
      const duplikatBukti = koreksiDanIsiUlang(
        db,
        'j-parkir',
        'Nominal salah',
        {
          header: {
            id: 'j-parkir-baru',
            tanggal: '2026-01-02',
            no_bukti: 'JU-2026-0002',
            keterangan: 'Pengganti nomor lama',
          },
          baris: pasangan('1001', '4005', RP(80_000)),
        },
        { id: 'j-balik-parkir', tanggal: '2026-01-05' },
      );
      expect(duplikatBukti.tersimpan).toBe(false);
      expect(duplikatBukti.errors.join(' ')).toMatch(/sudah dipakai/);
      expect(jumlahJurnal(db)).toBe(sebelum);
    } finally {
      db.close();
    }
  });

  it('isi ulang dengan tanggal periode terkunci memakai alasan koreksi yang sama', () => {
    const db = freshDb();
    try {
      db.prepare(
        'INSERT INTO tutup_buku (tahun, created_at, backup_path, catatan) VALUES (?, ?, ?, ?)',
      ).run(2025, '2026-01-01T00:00:00.000Z', '', '');

      insertJurnalTervalidasi(
        db,
        {
          id: 'j-lama',
          tanggal: '2025-12-20',
          no_bukti: 'JU-2025-0001',
          keterangan: 'Penerimaan lama',
        },
        pasangan('1001', '4005', RP(50_000)),
      );

      const hasil = koreksiDanIsiUlang(
        db,
        'j-lama',
        'Koreksi nominal Desember',
        {
          header: {
            id: 'j-lama-baru',
            tanggal: '2025-12-20',
            no_bukti: 'JU-2025-0003',
            keterangan: 'Penerimaan lama (koreksi)',
          },
          baris: pasangan('1001', '4005', RP(45_000)),
        },
        { id: 'j-lama-balik', tanggal: '2025-12-31' },
      );
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.jurnalBaru?.tanggal).toBe('2025-12-20');
      expect(listAuditLog(db)).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('koreksi dengan kedua tanggal di tahun yang sama menjaga laba tahunan', () => {
    const db = freshDb();
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-2025',
          tanggal: '2025-06-15',
          no_bukti: 'JU-2025-0100',
          keterangan: 'Pendapatan 2025',
          jenis: 'TERIMA',
        },
        pasangan('1001', '4005', RP(100)),
      );

      const hasil = koreksiDanIsiUlang(
        db,
        'j-2025',
        'Nominal salah, seharusnya 120',
        {
          header: {
            id: 'j-2025-baru',
            tanggal: '2025-06-15',
            no_bukti: 'JU-2025-0101',
            keterangan: 'Pendapatan 2025 (koreksi)',
            jenis: 'TERIMA',
          },
          baris: pasangan('1001', '4005', RP(120)),
        },
        // Default baru: jurnal balik memakai tanggal jurnal asli (satu periode).
        { id: 'j-2025-balik', tanggal: '2025-06-15' },
      );

      expect(hasil.tersimpan).toBe(true);
      const baris = listBarisJurnal(db);
      expect(labaTahun(baris, 2025)).toBe(RP(120));
      expect(labaTahun(baris, 2026)).toBe(0);
      expect(saldoAkun(baris, '1001', '2026-12-31')).toBe(RP(120));
      expect(neracaSaldo(baris, '2026-12-31')).toMatchObject({
        selisih: 0,
        seimbang: true,
      });
    } finally {
      db.close();
    }
  });

  it('skenario lama: balik 2026 + pengganti 2025 menggeser laba antartahun', () => {
    const db = freshDb();
    try {
      modal(db);
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-beban-2025',
          tanggal: '2025-06-15',
          no_bukti: 'JU-2025-0200',
          keterangan: 'Beban 2025',
          jenis: 'BAYAR',
        },
        pasangan('5000', '1001', RP(100)),
      );

      // Skenario lama (default tanggal balik = hari ini): jurnal beban 2025
      // Rp 100 dikoreksi menjadi Rp 120, tetapi baliknya jatuh di 2026.
      // 2025 = -100 (asli) - 120 (pengganti) = -220 → turun Rp 100 dari -120.
      // 2026 = +100 (pembalikan beban) → naik Rp 100 dari 0.
      const hasil = koreksiDanIsiUlang(
        db,
        'j-beban-2025',
        'Nominal salah, seharusnya 120',
        {
          header: {
            id: 'j-beban-2025-baru',
            tanggal: '2025-06-15',
            no_bukti: 'JU-2025-0201',
            keterangan: 'Beban 2025 (koreksi)',
            jenis: 'BAYAR',
          },
          baris: pasangan('5000', '1001', RP(120)),
        },
        // AUD-10: pengganti dievaluasi pada saldo 15 Jun 2025. Kas 2025 baru
        // -Rp 100 (modal masuk 2026), jadi pengganti Rp 120 membuat kas minus
        // dan operator wajib mengonfirmasi.
        {
          id: 'j-beban-2025-balik',
          tanggal: '2026-01-10',
          konfirmasiPeringatan: true,
        },
      );

      expect(hasil.peringatan.join(' ')).toMatch(/akan minus/);
      expect(hasil.tersimpan).toBe(true);
      const baris = listBarisJurnal(db);
      expect(labaTahun(baris, 2025)).toBe(-RP(220));
      expect(labaTahun(baris, 2026)).toBe(RP(100));
      // Total tetap seimbang, jadi distorsi tahunan tidak terlihat di Neraca Saldo.
      expect(neracaSaldo(baris, '2026-12-31')).toMatchObject({
        selisih: 0,
        seimbang: true,
      });
    } finally {
      db.close();
    }
  });

  // AUD-10: saldo kas untuk validasi koreksi harus dihitung pada tanggal
  // masing-masing jurnal (balik dan pengganti), bukan satu saldo bersama.
  it('pengganti backdate memakai saldo tanggalnya, bukan saldo tanggal balik', () => {
    const db = freshDb();
    try {
      // Kas 1 Jan Rp 500.
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-modal-kecil',
          tanggal: '2026-01-01',
          no_bukti: 'JU-2026-0300',
          keterangan: 'Modal awal kecil',
          jenis: 'SALDO_AWAL',
        },
        pasangan('1001', '3000', RP(500)),
      );
      // Beban asli Rp 100 (1 Feb) + penerimaan Rp 1.000 (1 Mar) membuat saldo
      // pada tanggal balik (1 Apr) terlihat cukup.
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-beban-asli',
          tanggal: '2026-02-01',
          no_bukti: 'JU-2026-0301',
          keterangan: 'Beban asli',
          jenis: 'BAYAR',
        },
        pasangan('5000', '1001', RP(100)),
      );
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-masuk-mar',
          tanggal: '2026-03-01',
          no_bukti: 'JU-2026-0302',
          keterangan: 'Penerimaan Maret',
          jenis: 'TERIMA',
        },
        pasangan('1001', '4005', RP(1_000)),
      );

      const pengganti = {
        header: {
          id: 'j-beban-baru',
          tanggal: '2026-01-15',
          no_bukti: 'JU-2026-0303',
          keterangan: 'Beban koreksi (backdate)',
          jenis: 'BAYAR' as const,
        },
        baris: pasangan('5000', '1001', RP(800)),
      };

      // 15 Jan kas hanya Rp 500 → pengganti Rp 800 minus. Saldo 1 Apr tidak
      // boleh dipakai karena pengganti bertanggal 15 Jan.
      const belum = koreksiDanIsiUlang(
        db,
        'j-beban-asli',
        'Nominal salah, seharusnya 800',
        pengganti,
        { id: 'j-beban-balik', tanggal: '2026-04-01' },
      );
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(3);

      const lanjut = koreksiDanIsiUlang(
        db,
        'j-beban-asli',
        'Nominal salah, seharusnya 800',
        pengganti,
        {
          id: 'j-beban-balik',
          tanggal: '2026-04-01',
          konfirmasiPeringatan: true,
        },
      );
      expect(lanjut.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(5);
    } finally {
      db.close();
    }
  });

  it('jurnal balik dievaluasi pada tanggal balik, bukan tanggal pengganti', () => {
    const db = freshDb();
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-modal-kecil',
          tanggal: '2026-01-01',
          no_bukti: 'JU-2026-0310',
          keterangan: 'Modal awal kecil',
          jenis: 'SALDO_AWAL',
        },
        pasangan('1001', '3000', RP(100)),
      );
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-masuk-asli',
          tanggal: '2026-01-05',
          no_bukti: 'JU-2026-0311',
          keterangan: 'Penerimaan asli',
          jenis: 'TERIMA',
        },
        pasangan('1001', '4005', RP(100)),
      );
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-belanja',
          tanggal: '2026-01-10',
          no_bukti: 'JU-2026-0312',
          keterangan: 'Belanja habiskan kas',
          jenis: 'BAYAR',
        },
        pasangan('5000', '1001', RP(200)),
      );

      // Balik 20 Jan: kas saat itu 0 → minus Rp 100. Pengganti baru 1 Mei,
      // jadi tidak boleh menutupi minus pada tanggal balik.
      const belum = koreksiDanIsiUlang(
        db,
        'j-masuk-asli',
        'Nominal salah, seharusnya 700',
        {
          header: {
            id: 'j-masuk-baru',
            tanggal: '2026-05-01',
            no_bukti: 'JU-2026-0313',
            keterangan: 'Penerimaan koreksi',
            jenis: 'TERIMA',
          },
          baris: pasangan('1001', '4005', RP(700)),
        },
        { id: 'j-masuk-balik', tanggal: '2026-01-20' },
      );
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(3);

      const lanjut = koreksiDanIsiUlang(
        db,
        'j-masuk-asli',
        'Nominal salah, seharusnya 700',
        {
          header: {
            id: 'j-masuk-baru',
            tanggal: '2026-05-01',
            no_bukti: 'JU-2026-0313',
            keterangan: 'Penerimaan koreksi',
            jenis: 'TERIMA',
          },
          baris: pasangan('1001', '4005', RP(700)),
        },
        {
          id: 'j-masuk-balik',
          tanggal: '2026-01-20',
          konfirmasiPeringatan: true,
        },
      );
      expect(lanjut.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(5);
    } finally {
      db.close();
    }
  });
});

// ---------------------------------------------------------------------------
// AUD-07: jurnal panjar tidak boleh direversal dari Jurnal Umum
// ---------------------------------------------------------------------------

function siapkanPanjar(db: ReturnType<typeof openDb>): void {
  modal(db);
  const hasil = serahkanPanjar(db, {
    id: 'p1',
    jurnalId: 'j-p1-open',
    tanggal: '2026-02-01',
    penerima: 'Panitia Piodalan',
    jumlah: RP(100_000),
    akunKasSumber: '1001',
    noBukti: 'PNJ-2026-0001',
  });
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
}

function tutupPanjar(db: ReturnType<typeof openDb>): void {
  const hasil = closePanjarV2(db, {
    id: 'p1',
    tanggalClose: '2026-03-01',
    jurnalId: 'j-p1-close',
    items: [{ akun: '5004', nominal: RP(100_000) }],
  });
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
}

describe('AUD-07 — reversal jurnal yang terhubung ke panjar diblokir', () => {
  it('menolak reversal jurnal open panjar tanpa menulis jurnal/audit', () => {
    const db = freshDb();
    try {
      siapkanPanjar(db);
      const sebelum = jumlahJurnal(db);

      const hasil = reverseJurnal(db, 'j-p1-open', 'Koreksi panjar', {
        id: 'j-balik-p1-open',
        tanggal: '2026-03-02',
      });

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors).toContain(PESAN_REVERSAL_PANJAR);
      expect(jumlahJurnal(db)).toBe(sebelum);
      expect(getJurnalDetail(db, 'j-balik-p1-open')).toBeNull();
      expect(getPanjar(db, 'p1')).toMatchObject({
        status: 'OPEN',
        jurnal_open_id: 'j-p1-open',
        jurnal_close_id: null,
      });
      expect(listAuditLog(db).map((a) => a.aksi)).toEqual(['PANJAR-OPEN p1']);
    } finally {
      db.close();
    }
  });

  it('menolak reversal jurnal close panjar dan status panjar tetap CLOSED', () => {
    const db = freshDb();
    try {
      siapkanPanjar(db);
      tutupPanjar(db);
      const sebelum = jumlahJurnal(db);

      const hasil = reverseJurnal(db, 'j-p1-close', 'Koreksi panjar', {
        id: 'j-balik-p1-close',
        tanggal: '2026-03-02',
      });

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors).toContain(PESAN_REVERSAL_PANJAR);
      expect(jumlahJurnal(db)).toBe(sebelum);
      expect(getJurnalDetail(db, 'j-balik-p1-close')).toBeNull();
      expect(getPanjar(db, 'p1')).toMatchObject({
        status: 'CLOSED',
        jurnal_close_id: 'j-p1-close',
      });
      // Tanpa reversal, saldo 1040 tetap nol (tidak kembali seperti bug AUD-07).
      expect(saldoAkun(listBarisJurnal(db), '1040', '2026-12-31')).toBe(0);
    } finally {
      db.close();
    }
  });

  it('menolak koreksi & isi ulang jurnal panjar', () => {
    const db = freshDb();
    try {
      siapkanPanjar(db);
      const sebelum = jumlahJurnal(db);

      const hasil = koreksiDanIsiUlang(
        db,
        'j-p1-open',
        'Koreksi panjar',
        {
          header: {
            id: 'j-p1-baru',
            tanggal: '2026-03-02',
            no_bukti: 'PNJ-2026-0002',
            keterangan: 'Serah panjar (koreksi)',
            jenis: 'PANJAR',
          },
          baris: pasangan('1040', '1001', RP(100_000)),
        },
        { id: 'j-balik-p1-open', tanggal: '2026-03-02' },
      );

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors).toContain(PESAN_REVERSAL_PANJAR);
      expect(jumlahJurnal(db)).toBe(sebelum);
      expect(getJurnalDetail(db, 'j-p1-baru')).toBeNull();
      expect(getPanjar(db, 'p1')?.status).toBe('OPEN');
    } finally {
      db.close();
    }
  });

  it('jurnal biasa yang tidak terhubung panjar tetap bisa direverse', () => {
    const db = freshDb();
    try {
      modal(db);
      parkir(db);

      const hasil = reverseJurnal(db, 'j-parkir', 'Salah input nominal', {
        id: 'j-balik-parkir',
        tanggal: '2026-01-05',
      });

      expect(hasil.tersimpan).toBe(true);
      expect(hasil.reversal).toMatchObject({
        id: 'j-balik-parkir',
        reversal_of: 'j-parkir',
        jenis: 'REVERSAL',
      });
      expect(saldoAkun(listBarisJurnal(db), '4005', '2026-12-31')).toBe(0);
    } finally {
      db.close();
    }
  });
});
