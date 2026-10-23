// P0-2: skema & repository jurnal double-entry.
// Fokus: jurnal seimbang tersimpan atomik, input tidak sah ditolak,
// migrasi `user_version` aman untuk DB lama (POC, tanpa migrasi data).

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import {
  getJurnal,
  getJurnalDetail,
  hitungJurnal,
  insertJurnal,
  listJurnal,
  listJurnalBaris,
  listJurnalLengkapPage,
  saranNomorBukti,
} from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { koreksiDanIsiUlang, reverseJurnal } from '../src/db/reversal.js';
import { closePanjarV2, serahkanPanjar } from '../src/db/panjar.js';
import { createPihak, postingPihak } from '../src/db/pihak.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const dirs: string[] = [];

function freshDb(): { dir: string; path: string; db: ReturnType<typeof openDb> } {
  const dir = mkdtempSync(join(tmpdir(), 'pura-jurnal-'));
  dirs.push(dir);
  const path = join(dir, 'pura.db');
  return { dir, path, db: openDb(path) };
}

function versi(db: ReturnType<typeof openDb>): number {
  return Number(db.pragma('user_version', { simple: true }));
}

const pasangan = (akunDebit: string, akunKredit: string, nominal = 100_000): JurnalBarisInput[] => [
  { akun_kode: akunDebit, debit: nominal, kredit: 0 },
  { akun_kode: akunKredit, debit: 0, kredit: nominal },
];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P0-2 — skema jurnal double-entry', () => {
  it('membuat tabel jurnal + jurnal_baris dan menaikkan user_version ke versi skema', () => {
    const { db } = freshDb();
    try {
      expect(SCHEMA_VERSION).toBe(6);
      expect(versi(db)).toBe(SCHEMA_VERSION);
      const tabel = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('jurnal', 'jurnal_baris') ORDER BY name",
        )
        .all() as { name: string }[];
      expect(tabel.map((t) => t.name)).toEqual(['jurnal', 'jurnal_baris']);
      const index = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_jurnal%' ORDER BY name",
        )
        .all() as { name: string }[];
      expect(index.map((i) => i.name)).toEqual(
        expect.arrayContaining([
          'idx_jurnal_baris_akun',
          'idx_jurnal_baris_jurnal',
          'idx_jurnal_grup',
          'idx_jurnal_tanggal',
        ]),
      );

      // P0-3: DB fresh tidak lagi membuat tabel single-entry lama.
      // P1-4: `panjar`/`panjar_item` bentuk v2 justru wajib ada.
      const lama = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('transaksi', 'coa')",
        )
        .all();
      expect(lama).toEqual([]);
      const panjarV2 = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('panjar', 'panjar_item') ORDER BY name",
        )
        .all() as { name: string }[];
      expect(panjarV2.map((t) => t.name)).toEqual(['panjar', 'panjar_item']);
    } finally {
      db.close();
    }
  });

  it('menyimpan jurnal seimbang: grup_id default = id, created_at ISO, baris urut', () => {
    const { db } = freshDb();
    try {
      const jurnal = insertJurnal(
        db,
        {
          id: 'j-parkir-1',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Terima uang parkir',
        },
        pasangan('1001', '4005'),
      );

      expect(jurnal).toMatchObject({
        id: 'j-parkir-1',
        tanggal: '2026-01-02',
        no_bukti: 'JU-2026-0001',
        keterangan: 'Terima uang parkir',
        jenis: 'UMUM',
        grup_id: 'j-parkir-1',
        reversal_of: null,
      });
      expect(new Date(jurnal.created_at).toISOString()).toBe(jurnal.created_at);

      expect(getJurnal(db, 'j-parkir-1')).toEqual(jurnal);
      const detail = getJurnalDetail(db, 'j-parkir-1');
      expect(detail?.baris).toHaveLength(2);
      expect(detail?.baris[0]).toMatchObject({
        jurnal_id: 'j-parkir-1',
        akun_kode: '1001',
        debit: 100_000,
        kredit: 0,
        keterangan: '',
      });
      expect(detail?.baris[1]).toMatchObject({
        akun_kode: '4005',
        debit: 0,
        kredit: 100_000,
      });
      expect(detail!.baris[0]!.id).toBeLessThan(detail!.baris[1]!.id);
      expect(getJurnalDetail(db, 'tidak-ada')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('menolak jurnal tidak seimbang / <2 baris / nominal 0 & atomik (tidak ada sisa baris)', () => {
    const { db } = freshDb();
    try {
      const kasus: JurnalBarisInput[][] = [
        [], // kosong
        [{ akun_kode: '1001', debit: 100_000, kredit: 0 }], // 1 baris
        // tidak seimbang
        [
          { akun_kode: '1001', debit: 100_000, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 90_000 },
        ],
        // nominal nol
        [
          { akun_kode: '1001', debit: 0, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 0 },
        ],
        // negatif
        [
          { akun_kode: '1001', debit: -1, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: -1 },
        ],
        // bukan bilangan bulat
        [
          { akun_kode: '1001', debit: 1.5, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 1.5 },
        ],
        // dua sisi sekaligus
        [
          { akun_kode: '1001', debit: 100, kredit: 100 },
          { akun_kode: '4005', debit: 100, kredit: 100 },
        ],
        // akun tidak dikenal
        pasangan('1001', '9999'),
      ];

      for (const baris of kasus) {
        expect(() =>
          insertJurnal(
            db,
            { id: `j-gagal-${kasus.indexOf(baris)}`, tanggal: '2026-01-02', keterangan: 'Uji' },
            baris,
          ),
        ).toThrow();
      }
      expect(listJurnal(db)).toEqual([]);
      expect(
        db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get(),
      ).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('menolak keterangan kosong, tanggal tidak valid, dan ID duplikat', () => {
    const { db } = freshDb();
    try {
      expect(() =>
        insertJurnal(db, { id: 'j-a', tanggal: '2026-01-02', keterangan: '   ' }, pasangan('1001', '4005')),
      ).toThrow(/Keterangan/);
      expect(() =>
        insertJurnal(db, { id: 'j-b', tanggal: '02-01-2026', keterangan: 'Salah format' }, pasangan('1001', '4005')),
      ).toThrow(/Tanggal/);

      insertJurnal(db, { id: 'j-c', tanggal: '2026-01-02', keterangan: 'Asli' }, pasangan('1001', '4005'));
      expect(() =>
        insertJurnal(db, { id: 'j-c', tanggal: '2026-01-03', keterangan: 'Duplikat' }, pasangan('1029', '4005')),
      ).toThrow(/sudah ada/);
      expect(listJurnal(db)).toHaveLength(1);
      expect(listJurnalBaris(db, 'j-c')).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('mendukung grup, reversal_of, created_at eksplisit, dan menolak referensi reversal asing', () => {
    const { db } = freshDb();
    try {
      insertJurnal(
        db,
        {
          id: 'j-asli',
          tanggal: '2026-02-01',
          keterangan: 'Beli alat',
          grup_id: 'g-beli-alat',
          created_at: '2026-02-01T10:00:00.000Z',
        },
        pasangan('5003', '1001'),
      );
      const reversal = insertJurnal(
        db,
        {
          id: 'j-balik',
          tanggal: '2026-02-02',
          keterangan: 'KOREKSI: beli alat',
          grup_id: 'g-beli-alat',
          reversal_of: 'j-asli',
        },
        pasangan('1001', '5003'),
      );
      expect(reversal.reversal_of).toBe('j-asli');
      expect(reversal.grup_id).toBe('g-beli-alat');

      expect(() =>
        insertJurnal(
          db,
          { id: 'j-asing', tanggal: '2026-02-03', keterangan: 'Salah', reversal_of: 'tidak-ada' },
          pasangan('1001', '4005'),
        ),
      ).toThrow(/tidak ditemukan/);
    } finally {
      db.close();
    }
  });

  it('listJurnal mendukung filter periode, jenis, grup, akun, dan pagination', () => {
    const { db } = freshDb();
    try {
      insertJurnal(db, { id: 'j-1', tanggal: '2026-01-05', keterangan: 'Parkir', jenis: 'TERIMA', grup_id: 'g-pendapatan' }, pasangan('1001', '4005'));
      insertJurnal(db, { id: 'j-2', tanggal: '2026-02-10', keterangan: 'Listrik', jenis: 'BAYAR' }, pasangan('5010', '1001'));
      insertJurnal(db, { id: 'j-3', tanggal: '2026-02-20', keterangan: 'Beji', jenis: 'TERIMA', grup_id: 'g-pendapatan' }, pasangan('1001', '4001'));
      insertJurnal(db, { id: 'j-4', tanggal: '2026-03-01', keterangan: 'Pindah dana', jenis: 'TRANSFER' }, pasangan('1029', '1001'));

      const ids = (f: Parameters<typeof listJurnal>[1] = {}) => listJurnal(db, f).map((j) => j.id);
      expect(ids()).toEqual(['j-1', 'j-2', 'j-3', 'j-4']);
      expect(ids({ mulai: '2026-02-01' })).toEqual(['j-2', 'j-3', 'j-4']);
      expect(ids({ sampai: '2026-02-20' })).toEqual(['j-1', 'j-2', 'j-3']);
      expect(ids({ jenis: 'TERIMA' })).toEqual(['j-1', 'j-3']);
      expect(ids({ grup_id: 'g-pendapatan' })).toEqual(['j-1', 'j-3']);
      expect(ids({ akun_kode: '5010' })).toEqual(['j-2']);
      expect(ids({ limit: 2 })).toEqual(['j-1', 'j-2']);
      expect(ids({ limit: 1, offset: 2 })).toEqual(['j-3']);
      expect(ids({ offset: 2 })).toEqual(['j-3', 'j-4']);
      expect(ids({ limit: 0 })).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('P1-11 — nomor bukti JU otomatis & pencarian jurnal', () => {
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

  it('insertJurnal tanpa no_bukti mengisi JU-tahun-0001 lalu 0002, per tahun terpisah', () => {
    const { db } = freshDb();
    try {
      const satu = insertJurnal(
        db,
        { id: 'j-auto-1', tanggal: '2026-01-02', keterangan: 'Pertama' },
        pasangan('1001', '4005'),
      );
      const dua = insertJurnal(
        db,
        { id: 'j-auto-2', tanggal: '2026-03-04', keterangan: 'Kedua' },
        pasangan('1029', '4005'),
      );
      const tahunLalu = insertJurnal(
        db,
        { id: 'j-auto-3', tanggal: '2025-12-31', keterangan: 'Tahun lain' },
        pasangan('1001', '4005'),
      );
      const tiga = insertJurnal(
        db,
        { id: 'j-auto-4', tanggal: '2026-12-31', keterangan: 'Ketiga' },
        pasangan('1001', '4005'),
      );

      expect(satu.no_bukti).toBe('JU-2026-0001');
      expect(dua.no_bukti).toBe('JU-2026-0002');
      expect(tahunLalu.no_bukti).toBe('JU-2025-0001');
      expect(tiga.no_bukti).toBe('JU-2026-0003');

      // Nomor eksplisit operator dipakai apa adanya (bukan dipaksa JU).
      const manual = insertJurnal(
        db,
        {
          id: 'j-manual',
          tanggal: '2026-06-01',
          no_bukti: 'BKM-2026-0099',
          keterangan: 'Nomor manual',
        },
        pasangan('1001', '4005'),
      );
      expect(manual.no_bukti).toBe('BKM-2026-0099');
    } finally {
      db.close();
    }
  });

  it('max+1 setelah celah, saran form ikut bergerak, dan nomor duplikat ditolak', () => {
    const { db } = freshDb();
    try {
      insertJurnal(
        db,
        {
          id: 'j-gap',
          tanggal: '2026-01-01',
          no_bukti: 'JU-2026-0005',
          keterangan: 'Nomor loncat',
        },
        pasangan('1001', '4005'),
      );
      expect(saranNomorBukti(db, '2026-07-01')).toBe('JU-2026-0006');

      const auto = insertJurnal(
        db,
        { id: 'j-auto', tanggal: '2026-07-02', keterangan: 'Setelah celah' },
        pasangan('1001', '4005'),
      );
      expect(auto.no_bukti).toBe('JU-2026-0006');
      expect(saranNomorBukti(db, '2026-07-03')).toBe('JU-2026-0007');

      // Nomor lama (0005) dan nomor baru (0006) tidak boleh dipakai ulang.
      expect(() =>
        insertJurnal(
          db,
          {
            id: 'j-dup-lama',
            tanggal: '2026-07-04',
            no_bukti: 'ju-2026-0005',
            keterangan: 'Duplikat lama',
          },
          pasangan('1001', '4005'),
        ),
      ).toThrow(/sudah dipakai/);
      expect(() =>
        insertJurnal(
          db,
          {
            id: 'j-dup-baru',
            tanggal: '2026-07-05',
            no_bukti: 'JU-2026-0006',
            keterangan: 'Duplikat baru',
          },
          pasangan('1001', '4005'),
        ),
      ).toThrow(/sudah dipakai/);

      // Tanggal kalender/tahun tidak valid tidak menghasilkan nomor.
      expect(() => saranNomorBukti(db, '2026-02-31')).toThrow(/Tanggal tidak valid/);
      expect(() => saranNomorBukti(db, '2026-2-3')).toThrow(/Tanggal tidak valid/);
    } finally {
      db.close();
    }
  });

  it('semua jalur simpan mendapat nomor: posting, reversal, koreksi isi ulang, panjar, pihak', () => {
    const { db } = freshDb();
    try {
      const posting = postingJurnal(db, {
        header: { id: 'j-posting', tanggal: '2026-01-01', keterangan: 'Posting form' },
        baris: [D('1001', 10_000_000), K('3000', 10_000_000)],
      });
      expect(posting.tersimpan, posting.errors.join(' ')).toBe(true);
      expect(posting.jurnal?.no_bukti).toBe('JU-2026-0001');

      const reversal = reverseJurnal(db, 'j-posting', 'Koreksi uji P1-11', {
        id: 'j-balik',
        tanggal: '2026-01-02',
      });
      expect(reversal.tersimpan, reversal.errors.join(' ')).toBe(true);
      expect(reversal.reversal?.no_bukti).toBe('JU-2026-0002');
      // Jurnal asli tidak berubah nomornya.
      expect(getJurnal(db, 'j-posting')?.no_bukti).toBe('JU-2026-0001');
    } finally {
      db.close();
    }
  });

  it('wizard saldo awal juga mendapat nomor otomatis', () => {
    const { db } = freshDb();
    try {
      const hasil = simpanSaldoAwal(db, {
        header: {
          id: 'j-saldo-awal',
          tanggal: '2026-01-01',
          keterangan: 'Saldo awal pembukuan',
        },
        baris: [D('1001', 10_000_000), K('3000', 10_000_000)],
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.jurnal?.no_bukti).toBe('JU-2026-0001');
    } finally {
      db.close();
    }
  });

  it('koreksi & isi ulang memberi nomor baru untuk balik dan pengganti', () => {
    const { db } = freshDb();
    try {
      insertJurnal(
        db,
        {
          id: 'j-asli',
          tanggal: '2026-01-01',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Jurnal asli',
        },
        pasangan('1001', '4005', 50_000),
      );
      const hasil = koreksiDanIsiUlang(
        db,
        'j-asli',
        'Nominal salah input',
        {
          header: {
            id: 'j-baru',
            tanggal: '2026-01-01',
            keterangan: 'Jurnal pengganti',
          },
          baris: pasangan('1001', '4005', 45_000),
        },
        { id: 'j-balik', tanggal: '2026-01-02' },
      );
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.reversal?.no_bukti).toBe('JU-2026-0002');
      expect(hasil.jurnalBaru?.no_bukti).toBe('JU-2026-0003');
      expect(getJurnal(db, 'j-asli')?.no_bukti).toBe('JU-2026-0001');
    } finally {
      db.close();
    }
  });

  it('nomor pengganti pilihan operator tidak ditabrak nomor balik otomatis', () => {
    const { db } = freshDb();
    try {
      insertJurnal(
        db,
        {
          id: 'j-asli',
          tanggal: '2026-01-01',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Jurnal asli',
        },
        pasangan('1001', '4005', 50_000),
      );
      const hasil = koreksiDanIsiUlang(
        db,
        'j-asli',
        'Perbaiki nomor bukti',
        {
          header: {
            id: 'j-baru',
            tanggal: '2026-01-01',
            no_bukti: 'JU-2026-0002',
            keterangan: 'Jurnal pengganti',
          },
          baris: pasangan('1001', '4005', 60_000),
        },
        { id: 'j-balik', tanggal: '2026-01-02' },
      );
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.jurnalBaru?.no_bukti).toBe('JU-2026-0002');
      expect(hasil.reversal?.no_bukti).toBe('JU-2026-0003');
      expect(getJurnal(db, 'j-asli')?.no_bukti).toBe('JU-2026-0001');
    } finally {
      db.close();
    }
  });

  it('panjar dan pihak juga otomatis JU (serah, close, piutang)', () => {
    const { db } = freshDb();
    try {
      insertJurnal(
        db,
        {
          id: 'j-modal',
          tanggal: '2026-01-01',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Saldo awal kas',
        },
        [D('1001', 10_000_000), K('3000', 10_000_000)],
      );

      const panjar = serahkanPanjar(db, {
        id: 'p-1',
        tanggal: '2026-02-01',
        penerima: 'Panitia Piodalan',
        jumlah: 100_000,
        akunKasSumber: '1001',
      });
      expect(panjar.tersimpan, panjar.errors.join(' ')).toBe(true);
      expect(panjar.jurnal?.no_bukti).toBe('JU-2026-0002');

      const tutup = closePanjarV2(db, {
        id: 'p-1',
        tanggalClose: '2026-02-02',
        items: [{ akun: '5004', nominal: 80_000 }],
      });
      expect(tutup.tersimpan, tutup.errors.join(' ')).toBe(true);
      expect(tutup.jurnal?.no_bukti).toBe('JU-2026-0003');

      const pihak = createPihak(db, { nama: 'Banjar Uji' });
      const pinjam = postingPihak(db, {
        pihakId: pihak.id,
        input: {
          header: {
            id: 'j-pinjam',
            tanggal: '2026-03-01',
            keterangan: 'Beri pinjaman',
            jenis: 'PIUTANG',
          },
          baris: [D('1050', 500_000), K('1001', 500_000)],
        },
      });
      expect(pinjam.tersimpan, pinjam.errors.join(' ')).toBe(true);
      expect(pinjam.jurnal?.no_bukti).toBe('JU-2026-0004');
    } finally {
      db.close();
    }
  });

  function dbPencarian(): ReturnType<typeof openDb> {
    const { db } = freshDb();
    insertJurnal(
      db,
      {
        id: 'j-parkir',
        tanggal: '2026-01-05',
        no_bukti: 'JU-2026-0001',
        keterangan: 'Penerimaan parkir bulan Januari',
        jenis: 'TERIMA',
      },
      [D('1001', 15_000_000), K('4005', 15_000_000)],
    );
    insertJurnal(
      db,
      {
        id: 'j-listrik',
        tanggal: '2026-02-10',
        no_bukti: 'JU-2026-0002',
        keterangan: 'Bayar listrik kantor',
        jenis: 'BAYAR',
      },
      [D('5010', 5_000_000), K('1001', 5_000_000)],
    );
    insertJurnal(
      db,
      {
        id: 'j-transfer',
        tanggal: '2026-03-01',
        no_bukti: 'JU-2026-0003',
        keterangan: 'Pindah dana ke bank',
        jenis: 'TRANSFER',
      },
      [D('1029', 7_500_000), K('1001', 7_500_000)],
    );
    insertJurnal(
      db,
      {
        id: 'j-panjar',
        tanggal: '2026-04-01',
        no_bukti: 'BKM-2026-0001',
        keterangan: 'Serah panjar piodalan',
        jenis: 'PANJAR',
      },
      [D('1040', 2_000_000), K('1001', 2_000_000)],
    );
    insertJurnal(
      db,
      {
        id: 'j-piutang',
        tanggal: '2026-05-01',
        no_bukti: 'JU-2026-0004',
        keterangan: 'Beri pinjaman Banjar',
        jenis: 'PIUTANG',
      },
      [D('1050', 9_000_000), K('1001', 9_000_000)],
    );
    insertJurnal(
      db,
      {
        id: 'j-beji',
        tanggal: '2026-06-01',
        no_bukti: 'JU-2026-0005',
        keterangan: 'Pendapatan beji',
        jenis: 'TERIMA',
      },
      [D('1001', 3_000_000), K('4001', 3_000_000)],
    );
    insertJurnal(
      db,
      {
        id: 'j-toilet',
        tanggal: '2026-07-01',
        no_bukti: 'JU-2026-0006',
        keterangan: 'Pendapatan toilet',
        jenis: 'TERIMA',
      },
      [D('1001', 1_000_000), K('4002', 1_000_000)],
    );
    return db;
  }

  it('mencari no bukti, keterangan, kode/nama akun, dan nominal rupiah', () => {
    const db = dbPencarian();
    try {
      const ids = (cari: string, f: Parameters<typeof listJurnalLengkapPage>[1] = {}) =>
        listJurnalLengkapPage(db, { ...f, cari }).rows.map((j) => j.id);

      expect(ids('JU-2026-0002')).toEqual(['j-listrik']);
      expect(ids('BKM-2026')).toEqual(['j-panjar']);
      expect(ids('parkir')).toEqual(['j-parkir']);
      expect(ids('5010')).toEqual(['j-listrik']);
      expect(ids('listrik')).toEqual(['j-listrik']);
      expect(ids('UANG PANJAR')).toEqual(['j-panjar']);
      expect(ids('PIUTANG LAIN')).toEqual(['j-piutang']);
      // Input rupiah: titik/spasi diabaikan → cocok dengan nominal sen di DB.
      expect(ids('150000')).toEqual(['j-parkir']);
      expect(ids('150.000')).toEqual(['j-parkir']);
      expect(ids('Rp 150.000')).toEqual(['j-parkir']);
      expect(ids('20.000')).toEqual(['j-panjar']);
      // Wildcard LIKE diperlakukan sebagai teks biasa.
      expect(ids('%')).toEqual([]);
      expect(ids('_')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('menggabungkan kata kunci dengan filter tanggal & jenis serta total server', () => {
    const db = dbPencarian();
    try {
      const hasil = listJurnalLengkapPage(db, {
        cari: 'pindah',
        mulai: '2026-02-01',
        sampai: '2026-03-31',
        jenis: 'TRANSFER',
      });
      expect(hasil.rows.map((j) => j.id)).toEqual(['j-transfer']);
      expect(hasil.total).toBe(1);
      expect(hitungJurnal(db, { cari: 'pindah' })).toBe(1);
      expect(hitungJurnal(db)).toBe(7);

      const diLuarRentang = listJurnalLengkapPage(db, {
        cari: 'pindah',
        mulai: '2026-04-01',
      });
      expect(diLuarRentang.rows).toEqual([]);
      expect(diLuarRentang.total).toBe(0);
    } finally {
      db.close();
    }
  });

  it('pagination server tidak menduplikasi / menghilangkan jurnal antar halaman', () => {
    const db = dbPencarian();
    try {
      const semua = listJurnalLengkapPage(db, { limit: 200 }).rows.map((j) => j.id);
      expect(semua).toHaveLength(7);

      const halaman = [
        listJurnalLengkapPage(db, { limit: 3, offset: 0 }),
        listJurnalLengkapPage(db, { limit: 3, offset: 3 }),
        listJurnalLengkapPage(db, { limit: 3, offset: 6 }),
      ];
      expect(halaman.map((h) => h.total)).toEqual([7, 7, 7]);
      const gabungan = halaman.flatMap((h) => h.rows.map((j) => j.id));
      expect(gabungan).toEqual(semua);
      expect(new Set(gabungan).size).toBe(7);
      expect(halaman[2]!.rows).toHaveLength(1);

      const cariPaged = listJurnalLengkapPage(db, {
        cari: 'pendapatan',
        limit: 1,
        offset: 1,
      });
      // Cocok lewat nama akun 4005/4001/4002 → tiga jurnal, urut tanggal.
      expect(cariPaged.total).toBe(3);
      expect(cariPaged.rows.map((j) => j.id)).toEqual(['j-beji']);
    } finally {
      db.close();
    }
  });
});

describe('P0-3 — reset DB lama (POC, tanpa migrasi data)', () => {
  it('membuang tabel single-entry, mempertahankan pengaturan & aset, idempoten', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-migrasi-'));
    dirs.push(dir);
    const path = join(dir, 'lama.db');

    // Simulasi DB v1 (single-entry) sebelum reset POC.
    const lama = new Database(path);
    lama.exec(`
      CREATE TABLE coa (kode TEXT PRIMARY KEY, nama TEXT NOT NULL, tipe TEXT NOT NULL);
      CREATE TABLE transaksi (
        id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, keterangan TEXT NOT NULL,
        akun_kas TEXT NOT NULL, kategori TEXT NOT NULL,
        masuk INTEGER NOT NULL DEFAULT 0, keluar INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE panjar (
        id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, penerima TEXT NOT NULL,
        jumlah INTEGER NOT NULL, akun_kas_sumber TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN'
      );
      CREATE TABLE panjar_item (
        panjar_id TEXT NOT NULL, kategori_baga TEXT NOT NULL, nominal INTEGER NOT NULL
      );
      CREATE TABLE tutup_buku (
        tahun INTEGER PRIMARY KEY, laba INTEGER NOT NULL,
        created_at TEXT NOT NULL, backup_path TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL DEFAULT '');
      CREATE TABLE aset (
        id TEXT PRIMARY KEY, kode TEXT NOT NULL UNIQUE, nama TEXT NOT NULL,
        jenis TEXT NOT NULL DEFAULT 'LAINNYA', luas_m2 REAL, lokasi TEXT NOT NULL DEFAULT '',
        status_hukum TEXT NOT NULL DEFAULT '', tahun_perolehan INTEGER,
        asal_usul TEXT NOT NULL DEFAULT '', kondisi TEXT NOT NULL DEFAULT 'BAIK',
        keterangan TEXT NOT NULL DEFAULT '', nilai_sen INTEGER,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 0;
    `);
    lama.prepare("INSERT INTO pengaturan (kunci, nilai) VALUES ('pin_salt', 'lama')").run();
    lama
      .prepare(
        "INSERT INTO transaksi (id, tanggal, keterangan, akun_kas, kategori, masuk, keluar) VALUES ('t-lama', '2025-12-31', 'Data lama', '1001', '4005', 123, 0)",
      )
      .run();
    lama
      .prepare(
        `INSERT INTO aset (id, kode, nama, jenis, lokasi, status_hukum, asal_usul,
          kondisi, keterangan, created_at, updated_at)
         VALUES ('a-lama', 'AST-001', 'Tanah Druwe', 'TANAH', 'Puri', 'druwe', '',
          'BAIK', '', '2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.000Z')`,
      )
      .run();
    lama.prepare("INSERT INTO tutup_buku (tahun, laba, created_at) VALUES (2025, 999, '2025-12-31T00:00:00.000Z')").run();
    lama.close();

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);

      const tabel = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => t.name);
      for (const usang of ['transaksi', 'coa']) {
        expect(tabel, `tabel ${usang} harus dibuang`).not.toContain(usang);
      }
      // P1-4: panjar v1 dibuang lalu dibuat ulang dalam bentuk v2 (metadata
      // jurnal_open_id) — data lamanya tetap tidak dimigrasi.
      expect(tabel).toEqual(expect.arrayContaining(['panjar', 'panjar_item']));
      const kolomPanjar = (db.pragma('table_info(panjar)') as { name: string }[]).map(
        (k) => k.name,
      );
      expect(kolomPanjar).toContain('jurnal_open_id');
      expect(
        (db.prepare('SELECT COUNT(*) AS c FROM panjar').get() as { c: number }).c,
      ).toBe(0);

      // PIN & inventaris aset dipertahankan.
      expect(db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'pin_salt'").get()).toEqual({ nilai: 'lama' });
      expect(db.prepare("SELECT kode, nama FROM aset WHERE id = 'a-lama'").get()).toEqual({
        kode: 'AST-001',
        nama: 'Tanah Druwe',
      });

      // tutup_buku lama (punya `laba`) diganti bentuk v2 tanpa angka laba tersimpan.
      const kolom = (db.pragma('table_info(tutup_buku)') as { name: string }[]).map((k) => k.name);
      expect(kolom).toEqual(expect.arrayContaining(['tahun', 'created_at', 'backup_path', 'catatan']));
      expect(kolom).not.toContain('laba');

      expect(listJurnal(db)).toEqual([]);
      expect(() =>
        insertJurnal(db, { id: 'j-baru', tanggal: '2026-01-01', keterangan: 'Setelah reset' }, pasangan('1001', '4005')),
      ).not.toThrow();
    } finally {
      db.close();
    }

    // Buka ulang: reset idempoten, jurnal tetap ada.
    const db2 = openDb(path);
    try {
      expect(versi(db2)).toBe(SCHEMA_VERSION);
      expect(listJurnal(db2).map((j) => j.id)).toEqual(['j-baru']);
    } finally {
      db2.close();
    }
  });

  it('DB v2 awal (P0-2) yang masih membawa tabel lama ikut dibersihkan', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-migrasi-v2-'));
    dirs.push(dir);
    const path = join(dir, 'p0-2.db');

    // DB v2 P0-2: user_version sudah 2, tetapi tabel single-entry masih ada.
    const lama = new Database(path);
    lama.exec(`
      CREATE TABLE transaksi (
        id TEXT PRIMARY KEY, tanggal TEXT NOT NULL, keterangan TEXT NOT NULL,
        akun_kas TEXT NOT NULL, kategori TEXT NOT NULL,
        masuk INTEGER NOT NULL DEFAULT 0, keluar INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE coa (kode TEXT PRIMARY KEY, nama TEXT NOT NULL, tipe TEXT NOT NULL);
      PRAGMA user_version = 2;
    `);
    lama.prepare("INSERT INTO transaksi (id, tanggal, keterangan, akun_kas, kategori) VALUES ('t-lama', '2026-01-01', 'Lama', '1001', '4005')").run();
    lama.close();

    const db = openDb(path);
    try {
      expect(versi(db)).toBe(SCHEMA_VERSION);
      const tabel = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
      ).map((t) => t.name);
      expect(tabel).not.toContain('transaksi');
      expect(tabel).not.toContain('coa');
      expect(tabel).toEqual(expect.arrayContaining(['akun', 'jurnal', 'jurnal_baris']));
    } finally {
      db.close();
    }
  });
});
