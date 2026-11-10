// DB-27 — referensi audit terstruktur (`ref_type`/`ref_id`) pada skema v1.
//
// Fokus:
// - setiap aksi baru menyimpan referensi objek atomik bersama aksinya;
// - filter ref memakai kolom terstruktur (bukan LIKE pada aksi) dan tetap
//   menghormati tanggal/pagination;
// - baris audit tanpa referensi tetap tampil;
// - `audit_log` tetap append-only.

import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb, SCHEMA_VERSION } from '../src/db/database.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import {
  AKUN_BUNGA_PINJAMAN_DEFAULT,
  bayarAngsuranPinjaman,
  simpanPinjamanLpd,
} from '../src/db/pinjaman.js';
import {
  closePanjarV2,
  serahkanPanjar,
} from '../src/db/panjar.js';
import { postingJurnal } from '../src/db/posting.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
import {
  catatAudit,
  hitungAuditLog,
  insertAuditLog,
  listAuditLog,
  listAuditLogPage,
  tambahAkun,
  setAkunAktif,
} from '../src/db/repository.js';
import { reverseJurnal } from '../src/db/reversal.js';
import { tutupBuku } from '../src/db/tutup.js';
import type { AuditLog, JurnalBarisInput } from '../src/core/types.js';

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
  // T-A07: jalur resmi menulis penunjuk pembukaan aktif + cut-over.
  const awal = simpanSaldoAwal(db, {
    header: {
      id: 'awal-db27',
      tanggal: '2026-01-01',
      no_bukti: 'SA-DB27',
      keterangan: 'Saldo awal uji referensi audit',
    },
    baris: [D('1001', RP(100_000_000)), K(AKUN_MODAL, RP(100_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

function auditRow(
  over: Partial<AuditLog> & Pick<AuditLog, 'id' | 'tanggal' | 'aksi'>,
): AuditLog {
  return {
    alasan: '',
    data_lama_json: '',
    data_baru_json: '',
    ...over,
  };
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

describe('DB-27 — referensi aksi baru', () => {
  it('posting jurnal, saldo awal, dan reversal memakai ref jurnal/id', () => {
    const db = dbKas();
    try {
      const posting = postingJurnal(db, {
        header: {
          id: 'j-parkir',
          tanggal: '2026-01-02',
          no_bukti: 'JU-DB27',
          keterangan: 'Parkir',
        },
        baris: [D('1001', RP(50_000)), K('4005', RP(50_000))],
      });
      expect(posting.tersimpan, posting.errors.join(' ')).toBe(true);

      const awal = listAuditLog(db).find((a) => a.aksi === 'SALDO-AWAL awal-db27')!;
      expect(awal).toMatchObject({ ref_type: 'jurnal', ref_id: 'awal-db27' });

      const create = listAuditLog(db).find((a) => a.aksi === 'CREATE j-parkir')!;
      expect(create).toMatchObject({ ref_type: 'jurnal', ref_id: 'j-parkir' });

      const balik = reverseJurnal(db, 'j-parkir', 'Nominal salah', {
        id: 'j-balik-db27',
        tanggal: '2026-01-03',
      });
      expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);

      // Reversal menunjuk jurnal ASLI, bukan jurnal balik.
      const rows = listAuditLog(db, { ref_type: 'jurnal', ref_id: 'j-parkir' });
      expect(rows.map((a) => a.aksi).sort()).toEqual(['CREATE j-parkir', 'REVERSAL j-parkir']);
      expect(rows.every((a) => a.ref_type === 'jurnal' && a.ref_id === 'j-parkir')).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });

  it('panjar open/close memakai ref panjar/id dan tidak tercampur ref jurnal', () => {
    const db = dbKas();
    try {
      const open = serahkanPanjar(db, {
        id: 'p-db27',
        jurnalId: 'j-panjar-db27',
        tanggal: '2026-02-01',
        penerima: 'Panitia Piodalan',
        jumlah: RP(1_000_000),
        akunKasSumber: '1001',
        noBukti: 'PJ-DB27',
      });
      expect(open.tersimpan, open.errors.join(' ')).toBe(true);

      const close = closePanjarV2(db, {
        id: 'p-db27',
        tanggalClose: '2026-02-02',
        items: [{ akun: '5004', nominal: RP(1_000_000) }],
      });
      expect(close.tersimpan, close.errors.join(' ')).toBe(true);

      const rows = listAuditLog(db, { ref_type: 'panjar', ref_id: 'p-db27' });
      expect(rows.map((a) => a.aksi).sort()).toEqual([
        'PANJAR-CLOSE p-db27',
        'PANJAR-OPEN p-db27',
      ]);
      expect(rows.every((a) => a.ref_type === 'panjar' && a.ref_id === 'p-db27')).toBe(
        true,
      );

      // Audit serah panjar sudah diwakili aksi PANJAR-OPEN; postingJurnal
      // tidak menulis audit CREATE tambahan saat menerima audit eksplisit.
      expect(
        listAuditLog(db, { ref_type: 'jurnal', ref_id: 'j-panjar-db27' }),
      ).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('pinjaman create/pencairan/bayar memakai ref pinjaman/id', () => {
    const db = dbKas();
    try {
      const total = RP(12_000_000);
      const buat = simpanPinjamanLpd(db, {
        id: 'pjr-db27',
        mode: 'PENCAIRAN',
        kreditur: 'LPD Desa Adat',
        tanggal: '2026-01-02',
        akunKas: '1001',
        akunBunga: AKUN_BUNGA_PINJAMAN_DEFAULT,
        pokok: total,
        tenor: 3,
        catatan: 'Uji referensi audit pinjaman',
        angsuran: [
          { ke: 1, jatuh_tempo: '2026-02-01', pokok: RP(4_000_000), bunga: RP(100_000) },
          { ke: 2, jatuh_tempo: '2026-03-01', pokok: RP(4_000_000), bunga: RP(100_000) },
          { ke: 3, jatuh_tempo: '2026-04-01', pokok: RP(4_000_000), bunga: RP(100_000) },
        ],
      });
      expect(buat.tersimpan, buat.errors.join(' ')).toBe(true);
      const angsuran = buat.pinjaman!.angsuran![0]!;

      const bayar = bayarAngsuranPinjaman(db, {
        id: 'pby-db27',
        jurnal_id: 'j-bayar-db27',
        pinjaman_id: 'pjr-db27',
        angsuran_id: angsuran.id,
        tanggal: '2026-02-01',
        akun_kas: '1001',
        pokok: RP(4_000_000),
        bunga: RP(100_000),
        denda: 0,
        catatan: 'Bayar angsuran uji',
      });
      expect(bayar.tersimpan, bayar.errors.join(' ')).toBe(true);

      const rows = listAuditLog(db, { ref_type: 'pinjaman', ref_id: 'pjr-db27' });
      expect(rows.map((a) => a.aksi).sort()).toEqual([
        'PINJAMAN-BAYAR pjr-db27',
        'PINJAMAN-CREATE pjr-db27',
        'PINJAMAN-PENCAIRAN pjr-db27',
      ]);
      expect(rows.every((a) => a.ref_type === 'pinjaman' && a.ref_id === 'pjr-db27')).toBe(
        true,
      );
    } finally {
      db.close();
    }
  });

  it('tutup buku dan akun add/activate memakai ref masing-masing', () => {
    const db = dbKas();
    try {
      expect(tutupBuku(db, 2026, { sekarang: '2027-01-02' }).tersimpan).toBe(true);
      expect(
        listAuditLog(db, { ref_type: 'tutup_buku', ref_id: '2026' }).map((a) => a.aksi),
      ).toEqual(['TUTUP 2026']);

      tambahAkun(db, {
        kode: '1101',
        nama: 'BANK UJI DB27',
        tipe: 'AKTIVA',
        is_kas: true,
        kelompok: 'BANK',
      });
      setAkunAktif(db, '1101', false, 'Uji referensi akun');
      const akun = listAuditLog(db, { ref_type: 'akun', ref_id: '1101' });
      expect(akun.map((a) => a.aksi).sort()).toEqual([
        'AKUN-NONAKTIF 1101',
        'AKUN-TAMBAH 1101',
      ]);
      expect(akun.every((a) => a.ref_type === 'akun' && a.ref_id === '1101')).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('DB-27 — filter referensi', () => {
  it('mencocokkan ref persis, bukan LIKE, dan menghormati tanggal/pagination', () => {
    const db = openDb(':memory:');
    try {
      insertAuditLog(
        db,
        auditRow({
          id: 'r1',
          tanggal: '2026-01-05T08:00:00.000Z',
          aksi: 'CREATE j-1',
          ref_type: 'jurnal',
          ref_id: 'j-1',
        }),
      );
      insertAuditLog(
        db,
        auditRow({
          id: 'r2',
          tanggal: '2026-01-10T08:00:00.000Z',
          aksi: 'REVERSAL j-1',
          ref_type: 'jurnal',
          ref_id: 'j-1',
        }),
      );
      insertAuditLog(
        db,
        auditRow({
          id: 'r3',
          tanggal: '2026-02-01T08:00:00.000Z',
          aksi: 'CREATE j-10',
          ref_type: 'jurnal',
          ref_id: 'j-10',
        }),
      );
      insertAuditLog(
        db,
        auditRow({
          id: 'r4',
          tanggal: '2026-02-05T08:00:00.000Z',
          aksi: 'PANJAR-OPEN p-1',
          ref_type: 'panjar',
          ref_id: 'j-1',
        }),
      );
      insertAuditLog(
        db,
        auditRow({
          id: 'lama',
          tanggal: '2026-02-10T08:00:00.000Z',
          aksi: 'CREATE j-lama',
        }),
      );

      // Exact match: j-1 tidak mengambil j-10 walau berawalan sama.
      expect(
        listAuditLog(db, { ref_type: 'jurnal', ref_id: 'j-1' }).map((a) => a.id),
      ).toEqual(['r2', 'r1']);
      expect(
        listAuditLog(db, { ref_type: 'panjar', ref_id: 'j-1' }).map((a) => a.id),
      ).toEqual(['r4']);
      expect(listAuditLog(db, { ref_id: 'j-1' }).map((a) => a.id)).toEqual([
        'r4',
        'r2',
        'r1',
      ]);
      expect(listAuditLog(db, { ref_type: 'jurnal' }).map((a) => a.id)).toEqual([
        'r3',
        'r2',
        'r1',
      ]);

      expect(
        listAuditLog(db, {
          ref_type: 'jurnal',
          ref_id: 'j-1',
          mulai: '2026-01-01',
          sampai: '2026-01-31',
        }).map((a) => a.id),
      ).toEqual(['r2', 'r1']);

      const halaman = listAuditLogPage(db, {
        ref_type: 'jurnal',
        ref_id: 'j-1',
        limit: 1,
        offset: 1,
      });
      expect(halaman.total).toBe(2);
      expect(halaman.rows.map((a) => a.id)).toEqual(['r1']);
      expect(hitungAuditLog(db, { ref_type: 'jurnal', ref_id: 'j-1' })).toBe(2);

      // Baris legacy tanpa ref tetap tampil saat tidak memfilter ref.
      const semua = listAuditLog(db);
      expect(semua.map((a) => a.id)).toContain('lama');
      expect(semua.find((a) => a.id === 'lama')).toMatchObject({
        ref_type: '',
        ref_id: '',
      });
    } finally {
      db.close();
    }
  });

  it('insertAuditLog/catatAudit memberi default ref kosong tanpa mengubah call site lama', () => {
    const db = openDb(':memory:');
    try {
      insertAuditLog(
        db,
        auditRow({
          id: 'legacy-insert',
          tanggal: '2026-01-01T00:00:00.000Z',
          aksi: 'CREATE j-lama',
        }),
      );
      catatAudit(db, {
        id: 'legacy-catat',
        tanggal: '2026-01-02T00:00:00.000Z',
        aksi: 'BACKUP-AUTO',
        alasan: 'Uji default',
      });
      const rows = listAuditLog(db);
      expect(rows).toHaveLength(2);
      expect(rows.every((a) => a.ref_type === '' && a.ref_id === '')).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('DB-27 — audit append-only pada skema v1', () => {
  it('mencatat versi skema 1 dan menolak perubahan/penghapusan baris audit', () => {
    const db = openDb(':memory:');
    try {
      expect(SCHEMA_VERSION).toBe(2);
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(2);

      insertAuditLog(
        db,
        auditRow({
          id: 'audit-v1',
          tanggal: '2026-01-01T00:00:00.000Z',
          aksi: 'CREATE j-lama',
          alasan: 'Audit lama',
          data_lama_json: '{"x":1}',
          data_baru_json: '{"y":2}',
        }),
      );

      const tersimpan = listAuditLog(db)[0]!;
      expect(tersimpan).toMatchObject({
        id: 'audit-v1',
        aksi: 'CREATE j-lama',
        alasan: 'Audit lama',
        data_lama_json: '{"x":1}',
        data_baru_json: '{"y":2}',
        ref_type: '',
        ref_id: '',
      });

      expect(() =>
        db.prepare("UPDATE audit_log SET alasan = 'diubah' WHERE id = 'audit-v1'").run(),
      ).toThrow(/tidak boleh diubah/i);
      expect(() =>
        db.prepare("DELETE FROM audit_log WHERE id = 'audit-v1'").run(),
      ).toThrow(/tidak boleh dihapus/i);
      expect(listAuditLog(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
