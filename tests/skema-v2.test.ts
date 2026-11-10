// T-A00 — kontrak skema v2: peran/replaces_id, penunjuk pembukaan, snapshot,
// dan backstop trigger. Fokus test ini adalah model domain eksplisit yang
// dipakai tiket lanjutan (T-A01/T-A02/T-A03/T-A06/T-A11).

import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { buatJurnalSaldoAwal } from '../src/core/forms.js';
import type {
  JurnalHeaderInput,
  JurnalBarisInput,
} from '../src/core/types.js';
import {
  PESAN_REPLACES_JURNAL_DB,
  PESAN_SNAPSHOT_TUTUP_BUKU_DB,
  SCHEMA_VERSION,
  TABEL_AKTIF,
  openDb,
} from '../src/db/database.js';
import {
  getPembukaanAktif,
  getCutoverTanggal,
} from '../src/db/pembukaan.js';
import {
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  KUNCI_CUTOVER_TANGGAL,
  KUNCI_SALDO_AWAL_AKTIF_ID,
  getJurnal,
  getPengaturan,
  insertJurnalTervalidasi,
  insertTutupBukuSnapshot,
  listJurnal,
  listTutupBukuSnapshot,
  setPengaturan,
} from '../src/db/repository.js';
import { koreksiSaldoAwal, simpanSaldoAwal } from '../src/db/saldoAwal.js';
import { getPanjar, serahkanPanjar } from '../src/db/panjar.js';

const RP = (rupiah: number): number => rupiah * 100;
const WAKTU = '2026-01-01T00:00:00.000Z';

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

function header(over: Partial<JurnalHeaderInput> = {}): JurnalHeaderInput {
  return {
    id: over.id ?? 'j-uji',
    tanggal: over.tanggal ?? '2026-01-02',
    keterangan: over.keterangan ?? 'Jurnal uji',
    jenis: over.jenis ?? 'UMUM',
    ...over,
  };
}

function insertMentah(
  db: Database.Database,
  input: {
    id: string;
    jenis?: string;
    peran?: string;
    replaces_id?: string | null;
    reversal_of?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, peran, grup_id,
        reversal_of, replaces_id, created_at)
     VALUES (?, '2026-01-02', '', 'Uji', ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.jenis ?? 'UMUM',
    input.peran ?? 'NORMAL',
    input.id,
    input.reversal_of ?? null,
    input.replaces_id ?? null,
    WAKTU,
  );
}

function siapkanPembukaan(db: Database.Database): void {
  const hasil = simpanSaldoAwal(
    db,
    buatJurnalSaldoAwal({
      id: 'sa-2026-07',
      tanggal: '2026-07-01',
      saldo: [
        { akun_kode: '1001', nominal: RP(10_000_000) },
        { akun_kode: '2050', nominal: RP(2_000_000) },
      ],
    }).input,
  );
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
}

describe('T-A00 — skema v2 dasar', () => {
  it('DB baru memakai 12 tabel aktif dan versi 2', () => {
    const db = openDb(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(2);
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(2);
      expect(TABEL_AKTIF).toHaveLength(12);
      expect(TABEL_AKTIF).toContain('tutup_buku_snapshot');
      const kolomJurnal = (
        db.pragma('table_info(jurnal)') as { name: string }[]
      ).map((k) => k.name);
      expect(kolomJurnal).toContain('peran');
      expect(kolomJurnal).toContain('replaces_id');
      const kolomPanjar = (
        db.pragma('table_info(panjar)') as { name: string }[]
      ).map((k) => k.name);
      expect(kolomPanjar).toContain('sumber');
    } finally {
      db.close();
    }
  });

  it('simpanSaldoAwal menulis peran OPENING + penunjuk pembukaan/cut-over atomik', () => {
    const db = openDb(':memory:');
    try {
      siapkanPembukaan(db);
      const jurnal = getJurnal(db, 'sa-2026-07');
      expect(jurnal?.peran).toBe('OPENING');
      expect(jurnal?.replaces_id).toBeNull();
      expect(getPembukaanAktif(db)).toEqual({
        id: 'sa-2026-07',
        tanggal: '2026-07-01',
        peran: 'OPENING',
      });
      expect(getPengaturan(db, KUNCI_SALDO_AWAL_AKTIF_ID)).toBe('sa-2026-07');
      expect(getPengaturan(db, KUNCI_CUTOVER_TANGGAL)).toBe('2026-07-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe(
        '2026-07-01',
      );
      expect(getCutoverTanggal(db)).toBe('2026-07-01');

      // Fallback data lama: cutover_tanggal hilang, kunci lama tetap terbaca.
      db.prepare('DELETE FROM pengaturan WHERE kunci = ?').run(
        KUNCI_CUTOVER_TANGGAL,
      );
      expect(getCutoverTanggal(db)).toBe('2026-07-01');
    } finally {
      db.close();
    }
  });

  it('koreksi saldo awal memakai replaces_id + peran OPENING_REPLACEMENT', () => {
    const db = openDb(':memory:');
    try {
      siapkanPembukaan(db);
      const hasil = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal({
          tanggal: '2026-06-01',
          saldo: [{ akun_kode: '1001', nominal: RP(12_000_000) }],
        }).input,
        { alasan: 'Koreksi tanggal cut-over', sekarang: '2026-12-31' },
      );
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.jurnal?.peran).toBe('OPENING_REPLACEMENT');
      expect(hasil.jurnal?.jenis).toBe('UMUM');
      expect(hasil.jurnal?.replaces_id).toBe('sa-2026-07');
      expect(hasil.reversal?.peran).toBe('NORMAL');
      expect(hasil.reversal?.reversal_of).toBe('sa-2026-07');
      expect(getPembukaanAktif(db)).toMatchObject({
        id: hasil.jurnal?.id,
        tanggal: '2026-06-01',
        peran: 'OPENING_REPLACEMENT',
      });
      expect(getCutoverTanggal(db)).toBe('2026-06-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe(
        '2026-06-01',
      );
    } finally {
      db.close();
    }
  });

  it('getPembukaanAktif null bila pointer kosong atau menunjuk jurnal hilang', () => {
    const db = openDb(':memory:');
    try {
      expect(getPembukaanAktif(db)).toBeNull();
      setPengaturan(db, KUNCI_SALDO_AWAL_AKTIF_ID, 'tidak-ada');
      expect(getPembukaanAktif(db)).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('T-A00 — panjar sumber', () => {
  it('panjar baru default NORMAL dan CHECK menolak sumber lain', () => {
    const db = openDb(':memory:');
    try {
      const hasil = serahkanPanjar(db, {
        id: 'p-uji',
        jurnalId: 'j-panjar-uji',
        tanggal: '2026-01-05',
        penerima: 'Panitia Uji',
        jumlah: RP(100_000),
        akunKasSumber: '1001',
        konfirmasiPeringatan: true,
        alasanPeringatan: 'Uji kas minus',
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.panjar?.sumber).toBe('NORMAL');
      expect(getPanjar(db, 'p-uji')?.sumber).toBe('NORMAL');
      expect(() =>
        db
          .prepare(
            `INSERT INTO panjar
               (id, tanggal, penerima, jumlah, akun_kas_sumber, status, sumber,
                jurnal_open_id, created_at)
             VALUES ('p-liar', '2026-01-05', 'X', 100, '1001', 'OPEN', 'LIAR',
                     'j-panjar-uji', '2026-01-05T00:00:00.000Z')`,
          )
          .run(),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});

describe('T-A00 — backstop trigger jurnal', () => {
  it('menolak replaces_id menunjuk diri sendiri', () => {
    const db = openDb(':memory:');
    try {
      expect(() =>
        insertMentah(db, {
          id: 'j-self',
          peran: 'ADJUSTMENT',
          replaces_id: 'j-self',
        }),
      ).toThrow(PESAN_REPLACES_JURNAL_DB);
    } finally {
      db.close();
    }
  });

  it('menolak peran OPENING_REPLACEMENT tanpa replaces_id', () => {
    const db = openDb(':memory:');
    try {
      expect(() =>
        insertMentah(db, { id: 'j-repl', peran: 'OPENING_REPLACEMENT' }),
      ).toThrow(/OPENING_REPLACEMENT wajib/i);
    } finally {
      db.close();
    }
  });

  it('menolak OPENING yang bukan SALDO_AWAL', () => {
    const db = openDb(':memory:');
    try {
      expect(() => insertMentah(db, { id: 'j-open', peran: 'OPENING' })).toThrow(
        /OPENING wajib berjenis SALDO_AWAL/i,
      );
    } finally {
      db.close();
    }
  });

  it('menerima pengganti sah dan menolak pengganti kedua untuk jurnal yang sama', () => {
    const db = openDb(':memory:');
    try {
      insertMentah(db, { id: 'j-asal', jenis: 'BAYAR' });
      insertMentah(db, {
        id: 'j-pengganti',
        jenis: 'BAYAR',
        peran: 'ADJUSTMENT',
        replaces_id: 'j-asal',
      });
      expect(getJurnal(db, 'j-pengganti')?.replaces_id).toBe('j-asal');
      expect(() =>
        insertJurnalTervalidasi(
          db,
          header({
            id: 'j-pengganti-2',
            jenis: 'BAYAR',
            peran: 'ADJUSTMENT',
            replaces_id: 'j-asal',
          }),
          [D('1001', RP(1_000)), K('4005', RP(1_000))],
        ),
      ).toThrow(/sudah digantikan|sudah dipakai|UNIQUE/i);
    } finally {
      db.close();
    }
  });

  it('menolak pengganti berjenis berbeda dari aslinya, kecuali SALDO_AWAL→UMUM', () => {
    const db = openDb(':memory:');
    try {
      insertMentah(db, { id: 'j-asal', jenis: 'BAYAR' });
      expect(() =>
        insertMentah(db, {
          id: 'j-beda',
          jenis: 'TERIMA',
          peran: 'ADJUSTMENT',
          replaces_id: 'j-asal',
        }),
      ).toThrow(/Jenis jurnal pengganti harus sama/i);
    } finally {
      db.close();
    }
  });
});

describe('T-A00 — snapshot tutup buku append-only', () => {
  it('insert/list snapshot dan trigger menolak update/delete', () => {
    const db = openDb(':memory:');
    try {
      const snapshot = insertTutupBukuSnapshot(db, {
        tahun: 2026,
        versi: 1,
        laba: RP(1_000_000),
        total_aset: RP(10_000_000),
        total_kewajiban: RP(2_000_000),
        total_ekuitas: RP(8_000_000),
        total_pasiva: RP(10_000_000),
        selisih: 0,
        hash_jurnal: 'abc',
        created_at: WAKTU,
      });
      expect(snapshot.id).toBeGreaterThan(0);
      expect(listTutupBukuSnapshot(db, 2026)).toEqual([snapshot]);
      expect(listTutupBukuSnapshot(db)).toEqual([snapshot]);

      expect(() =>
        db
          .prepare('UPDATE tutup_buku_snapshot SET laba = 0 WHERE id = ?')
          .run(snapshot.id),
      ).toThrow(PESAN_SNAPSHOT_TUTUP_BUKU_DB);
      expect(() =>
        db
          .prepare('DELETE FROM tutup_buku_snapshot WHERE id = ?')
          .run(snapshot.id),
      ).toThrow(PESAN_SNAPSHOT_TUTUP_BUKU_DB);
      expect(() =>
        insertTutupBukuSnapshot(db, {
          tahun: 2026,
          versi: 1,
          laba: 0,
          total_aset: 0,
          total_kewajiban: 0,
          total_ekuitas: 0,
          total_pasiva: 0,
          selisih: 0,
          hash_jurnal: 'dup',
          created_at: WAKTU,
        }),
      ).toThrow();
    } finally {
      db.close();
    }
  });
});
