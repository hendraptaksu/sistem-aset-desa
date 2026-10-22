// P0-7: tutup buku & kunci periode tanpa angka laba tersimpan.
// Fokus: K2 (hanya tahun selesai), urut menaik, konfirmasi tutup ulang,
// audit, dan regresi "koreksi setelah tutup tidak membuat Neraca selisih".

import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/database.js';
import { insertJurnal, listTutupBuku } from '../src/db/repository.js';
import { previewTutupBuku, tutupBuku } from '../src/db/tutup.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { postingJurnal } from '../src/db/posting.js';
import { labaDitahan, validasiTutupBuku } from '../src/core/tutup.js';
import { neraca, neracaSaldo } from '../src/core/reports.js';
import type { JurnalBarisInput, JurnalJenis } from '../src/core/types.js';

const SEKARANG = '2026-10-22';

function freshDb(): Database.Database {
  return openDb(':memory:');
}

function catat(
  db: Database.Database,
  id: string,
  tanggal: string,
  baris: JurnalBarisInput[],
  jenis: JurnalJenis = 'UMUM',
): void {
  insertJurnal(
    db,
    {
      id,
      tanggal,
      no_bukti: `JU-${id}`,
      keterangan: `Uji ${id}`,
      jenis,
    },
    baris,
  );
}

const masuk = (akun: string, nominal: number): JurnalBarisInput[] => [
  { akun_kode: '1001', debit: nominal, kredit: 0 },
  { akun_kode: akun, debit: 0, kredit: nominal },
];

const keluar = (akun: string, nominal: number): JurnalBarisInput[] => [
  { akun_kode: akun, debit: nominal, kredit: 0 },
  { akun_kode: '1001', debit: 0, kredit: nominal },
];

function audit(db: Database.Database): { aksi: string; alasan: string }[] {
  return db.prepare('SELECT aksi, alasan FROM audit_log ORDER BY rowid').all() as {
    aksi: string;
    alasan: string;
  }[];
}

describe('P0-7 — validasi tutup buku (murni)', () => {
  it('menolak tahun berjalan/berikutnya dan bukan bilangan bulat (K2)', () => {
    const ctx = { sekarang: SEKARANG, tutup: [] };
    expect(validasiTutupBuku(2025, ctx).boleh).toBe(true);
    expect(validasiTutupBuku(2026, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(2026, ctx).errors.join(' ')).toMatch(/sudah selesai/);
    expect(validasiTutupBuku(2027, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(2025.5, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(Number.NaN, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(2025, ctx).batasTahun).toBe(2025);
  });

  it('menolak tutup buku yang tidak urut menaik', () => {
    const ctx = { sekarang: SEKARANG, tutup: [{ tahun: 2025 }] };
    const hasil = validasiTutupBuku(2024, ctx);
    expect(hasil.boleh).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/berurutan menaik/);

    const naik = validasiTutupBuku(2026, { sekarang: '2027-01-02', tutup: [{ tahun: 2025 }] });
    expect(naik.boleh).toBe(true);
  });

  it('tahun yang sudah ditutup wajib konfirmasi (TUTUP-ULANG)', () => {
    const ctx = { sekarang: SEKARANG, tutup: [{ tahun: 2025 }] };
    const belum = validasiTutupBuku(2025, ctx);
    expect(belum.boleh).toBe(false);
    expect(belum.perluKonfirmasi).toBe(true);
    expect(belum.aksi).toBe('TUTUP-ULANG');
    expect(belum.peringatan.join(' ')).toMatch(/sudah pernah ditutup/);

    const sudah = validasiTutupBuku(2025, { ...ctx, konfirmasiTimpak: true });
    expect(sudah.boleh).toBe(true);
    expect(sudah.aksi).toBe('TUTUP-ULANG');
  });
});

describe('P0-7 — tutup buku di DB', () => {
  it('menyimpan penanda + catatan + audit, tanpa kolom laba', () => {
    const db = freshDb();
    try {
      catat(db, 'j-pendapatan-2025', '2025-03-01', masuk('4005', 10_000_000));
      catat(db, 'j-beban-2025', '2025-04-01', keluar('5000', 4_000_000));

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.boleh).toBe(true);
      expect(pratinjau.laba).toBe(6_000_000);
      expect(pratinjau.sudahDitutup).toBe(false);

      const hasil = tutupBuku(db, 2025, {
        sekarang: SEKARANG,
        catatan: 'Sudah diperiksa akuntan',
        backupPath: '/tmp/pura-2025.db',
      });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.aksi).toBe('TUTUP');
      expect(hasil.laba).toBe(6_000_000);
      expect(hasil.data).toMatchObject({
        tahun: 2025,
        catatan: 'Sudah diperiksa akuntan',
        backup_path: '/tmp/pura-2025.db',
      });

      const riwayat = listTutupBuku(db);
      expect(riwayat).toHaveLength(1);
      expect(riwayat[0]).toMatchObject({
        tahun: 2025,
        catatan: 'Sudah diperiksa akuntan',
        backup_path: '/tmp/pura-2025.db',
      });
      // Laba tidak pernah disimpan sebagai angka.
      expect(riwayat[0]).not.toHaveProperty('laba');
      const kolom = (db.pragma('table_info(tutup_buku)') as { name: string }[]).map((k) => k.name);
      expect(kolom).not.toContain('laba');

      expect(audit(db)).toEqual([
        { aksi: 'TUTUP 2025', alasan: 'Sudah diperiksa akuntan' },
      ]);
    } finally {
      db.close();
    }
  });

  it('menolak tahun berjalan dan tahun yang tidak urut, tanpa menulis audit', () => {
    const db = freshDb();
    try {
      const sekarang = tutupBuku(db, 2026, { sekarang: SEKARANG });
      expect(sekarang.tersimpan).toBe(false);
      expect(sekarang.errors.join(' ')).toMatch(/sudah selesai/);

      catat(db, 'j-2025', '2025-12-01', masuk('4005', 1_000_000));
      expect(tutupBuku(db, 2025, { sekarang: SEKARANG }).tersimpan).toBe(true);

      const mundur = tutupBuku(db, 2024, { sekarang: SEKARANG });
      expect(mundur.tersimpan).toBe(false);
      expect(mundur.errors.join(' ')).toMatch(/berurutan menaik/);

      expect(audit(db)).toHaveLength(1);
      expect(audit(db)[0]!.aksi).toBe('TUTUP 2025');
    } finally {
      db.close();
    }
  });

  it('tutup ulang wajib konfirmasi dan tercatat sebagai TUTUP-ULANG', () => {
    const db = freshDb();
    try {
      catat(db, 'j-2025', '2025-12-01', masuk('4005', 1_000_000));
      expect(tutupBuku(db, 2025, { sekarang: SEKARANG, catatan: 'Pertama' }).tersimpan).toBe(true);

      const belum = tutupBuku(db, 2025, { sekarang: SEKARANG, catatan: 'Kedua' });
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.aksi).toBe('TUTUP-ULANG');
      expect(audit(db)).toHaveLength(1);

      const ulang = tutupBuku(db, 2025, {
        sekarang: SEKARANG,
        catatan: 'Kedua',
        konfirmasiTimpak: true,
      });
      expect(ulang.tersimpan).toBe(true);
      expect(ulang.data?.catatan).toBe('Kedua');
      expect(audit(db).map((a) => a.aksi)).toEqual(['TUTUP 2025', 'TUTUP-ULANG 2025']);
    } finally {
      db.close();
    }
  });
});

describe('P0-7 — koreksi setelah tutup buku', () => {
  it('tidak membuat Neraca 2026 selisih (regresi bug v1)', () => {
    const db = freshDb();
    try {
      catat(db, 'j-pendapatan-2025', '2025-03-01', masuk('4005', 10_000_000));
      catat(db, 'j-beban-2025', '2025-04-01', keluar('5000', 4_000_000));
      expect(tutupBuku(db, 2025, { sekarang: SEKARANG, catatan: 'Tutup 2025' }).tersimpan).toBe(true);

      const sebelum = neraca(listBarisJurnal(db), {
        cutoff: '2026-12-31',
        tutup: listTutupBuku(db),
      });
      expect(sebelum.balance).toBe(true);
      expect(sebelum.labaDitahan).toBe(6_000_000);
      expect(sebelum.labaBerjalan).toBe(0);
      expect(neracaSaldo(listBarisJurnal(db), '2026-12-31').selisih).toBe(0);

      // Koreksi susulan 2025 tanpa alasan ditolak oleh kunci periode...
      const tanpaAlasan = postingJurnal(db, {
        header: {
          id: 'j-koreksi-tanpa-alasan',
          tanggal: '2025-12-31',
          no_bukti: 'JU-KOR-1',
          keterangan: 'Koreksi pendapatan Desember',
        },
        baris: masuk('4005', 1_000_000),
      });
      expect(tanpaAlasan.tersimpan).toBe(false);
      expect(tanpaAlasan.errors.join(' ')).toMatch(/Periode sudah ditutup/);

      // ...dan diterima dengan alasan (kunci longgar), tanpa menghapus jurnal asli.
      const koreksi = postingJurnal(db, {
        header: {
          id: 'j-koreksi-2025',
          tanggal: '2025-12-31',
          no_bukti: 'JU-KOR-2',
          keterangan: 'Koreksi pendapatan Desember',
        },
        baris: masuk('4005', 1_000_000),
        alasan: 'Koreksi bukti pendapatan Desember',
      });
      expect(koreksi.tersimpan).toBe(true);

      const sesudah = neraca(listBarisJurnal(db), {
        cutoff: '2026-12-31',
        tutup: listTutupBuku(db),
      });
      expect(sesudah.balance).toBe(true);
      expect(sesudah.selisih).toBe(0);
      expect(sesudah.labaDitahan).toBe(7_000_000);

      const neracaSaldoSesudah = neracaSaldo(listBarisJurnal(db), '2026-12-31');
      expect(neracaSaldoSesudah.selisih).toBe(0);
      expect(neracaSaldoSesudah.totalDebit).toBe(neracaSaldoSesudah.totalKredit);

      // Penanda tutup buku tidak berubah dan tetap tanpa angka laba.
      expect(listTutupBuku(db)).toHaveLength(1);
      expect(listTutupBuku(db)[0]).not.toHaveProperty('laba');

      // Laba ditahan turunan = laba 2025 versi terbaru.
      expect(labaDitahan(listBarisJurnal(db), listTutupBuku(db))).toBe(7_000_000);
    } finally {
      db.close();
    }
  });
});
