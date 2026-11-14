// P0-7: tutup buku & kunci periode tanpa angka laba tersimpan.
// Fokus: K2 (hanya tahun selesai), urut menaik, konfirmasi tutup ulang,
// audit, dan regresi "koreksi setelah tutup tidak membuat Neraca selisih".

import { describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/database.js';
import { AKUN_MODAL } from '../src/db/coa.js';
import {
  batalPanjarV2,
  closePanjarV2,
  serahkanPanjar,
} from '../src/db/panjar.js';
import {
  insertJurnalTervalidasi,
  insertTutupBuku,
  listAkun,
  listTutupBuku,
  listTutupBukuSnapshot,
  tambahAkun,
} from '../src/db/repository.js';
import { previewTutupBuku, tutupBuku } from '../src/db/tutup.js';
import {
  bandingkanSnapshotTutup,
  hitungHashJurnalTahun,
} from '../src/db/tutupSnapshot.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { postingJurnal } from '../src/db/posting.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
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
  insertJurnalTervalidasi(
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

/**
 * AUD2-06: DB dengan kas awal + satu panjar OPEN tertanggal 2025-12-20.
 * Saldo awal diperlukan agar jurnal serah panjar lolos guard posting.
 */
function dbPanjarOpen2025(): Database.Database {
  const db = freshDb();
  // T-A07: pakai jalur resmi saldo awal agar penunjuk pembukaan aktif dan
  // cut-over ikut tertulis; POSTING langsung SALDO_AWAL (tanpa penunjuk) kini
  // dilaporkan PEMBUKAAN_AKTIF_HILANG oleh audit.
  const awal = simpanSaldoAwal(db, {
    header: {
      id: 'saldo-awal-2025',
      tanggal: '2025-01-01',
      no_bukti: 'SA-2025',
      keterangan: 'Saldo awal uji guard panjar',
      jenis: 'SALDO_AWAL',
    },
    baris: [
      { akun_kode: '1001', debit: 10_000_000, kredit: 0 },
      { akun_kode: AKUN_MODAL, debit: 0, kredit: 10_000_000 },
    ],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

  const panjar = serahkanPanjar(db, {
    id: 'p-2025',
    jurnalId: 'j-p-2025',
    tanggal: '2025-12-20',
    penerima: 'Panitia Piodalan',
    jumlah: 1_000_000,
    akunKasSumber: '1001',
    noBukti: 'PANJAR-2025',
  });
  expect(panjar.tersimpan, panjar.errors.join(' ')).toBe(true);
  return db;
}

function audit(db: Database.Database): { aksi: string; alasan: string }[] {
  return db.prepare('SELECT aksi, alasan FROM audit_log ORDER BY rowid').all() as {
    aksi: string;
    alasan: string;
  }[];
}

/**
 * Korupsi langsung lewat SQL: kepala jurnal + dua baris yang total debit dan
 * kreditnya tidak sama. API aplikasi tidak pernah menghasilkan data ini.
 */
function korupsiJurnalTidakSeimbang(
  db: Database.Database,
  id: string,
  tanggal: string,
): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, ?, ?, ?, 'UMUM', ?, NULL, '2026-10-29T00:00:00.000Z')`,
  ).run(id, tanggal, `JU-${id}`, `Korupsi ${id}`, id);
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, '1001', 1000, 0, '')`,
  ).run(id);
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, '4005', 0, 900, '')`,
  ).run(id);
}

/**
 * Korupsi langsung lewat SQL: dua jurnal balik untuk satu jurnal asli.
 * Unique index v14 sengaja dihapus untuk mensimulasikan kerusakan file.
 */
function korupsiReversalGanda(db: Database.Database, idAsli: string): void {
  db.exec('DROP INDEX IF EXISTS ux_jurnal_reversal');
  const insJurnal = db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, '2025-03-01', ?, ?, ?, ?, ?, '2026-10-29T00:00:00.000Z')`,
  );
  const insBaris = db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, ?, ?, ?, '')`,
  );
  insJurnal.run(idAsli, `JU-${idAsli}`, 'Asli', 'UMUM', idAsli, null);
  insBaris.run(idAsli, '1001', 1_000, 0);
  insBaris.run(idAsli, '4005', 0, 1_000);
  for (const nomor of [1, 2]) {
    const idBalik = `${idAsli}-rev${nomor}`;
    insJurnal.run(
      idBalik,
      `JU-${idBalik}`,
      `Reversal ${nomor}`,
      'REVERSAL',
      idAsli,
      idAsli,
    );
    insBaris.run(idBalik, '4005', 1_000, 0);
    insBaris.run(idBalik, '1001', 0, 1_000);
  }
}

describe('P0-7 — validasi tutup buku (murni)', () => {
  it('menolak tahun berjalan/berikutnya dan bukan bilangan bulat (K2)', () => {
    const ctx = { sekarang: SEKARANG, tutup: [], tahunAdaJurnal: [] };
    expect(validasiTutupBuku(2025, ctx).boleh).toBe(true);
    expect(validasiTutupBuku(2026, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(2026, ctx).errors.join(' ')).toMatch(/sudah selesai/);
    expect(validasiTutupBuku(2027, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(2025.5, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(Number.NaN, ctx).boleh).toBe(false);
    expect(validasiTutupBuku(2025, ctx).batasTahun).toBe(2025);
  });

  it('menolak tutup buku yang tidak urut menaik', () => {
    const ctx = { sekarang: SEKARANG, tutup: [{ tahun: 2025 }], tahunAdaJurnal: [] };
    const hasil = validasiTutupBuku(2024, ctx);
    expect(hasil.boleh).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/berurutan menaik/);

    const naik = validasiTutupBuku(2026, {
      sekarang: '2027-01-02',
      tutup: [{ tahun: 2025 }],
      tahunAdaJurnal: [],
    });
    expect(naik.boleh).toBe(true);
  });

  it('menolak lompat tahun bila tahun sebelumnya punya jurnal (AKT-12)', () => {
    const ctx = {
      sekarang: SEKARANG,
      tutup: [],
      tahunAdaJurnal: [2023, 2024, 2025],
    };

    const lompat = validasiTutupBuku(2025, ctx);
    expect(lompat.boleh).toBe(false);
    expect(lompat.errors.join(' ')).toMatch(/berurutan/);
    expect(lompat.errors.join(' ')).toContain('2023, 2024');
    expect(lompat.errors.join(' ')).toContain('2025');

    expect(validasiTutupBuku(2024, { ...ctx, tutup: [{ tahun: 2023 }] }).boleh).toBe(true);
    expect(
      validasiTutupBuku(2025, {
        ...ctx,
        tutup: [{ tahun: 2023 }, { tahun: 2024 }],
      }).boleh,
    ).toBe(true);
  });

  it('tahun tanpa jurnal boleh dilewati dan tutup ulang tetap boleh (AKT-12)', () => {
    const ctx = {
      sekarang: SEKARANG,
      tutup: [{ tahun: 2022 }, { tahun: 2023 }],
      tahunAdaJurnal: [2022, 2023, 2025],
    };
    // 2024 tidak punya jurnal, jadi boleh dilewati.
    expect(validasiTutupBuku(2025, ctx).boleh).toBe(true);
    // Tahun tanpa jurnal juga boleh ditutup.
    expect(validasiTutupBuku(2024, ctx).boleh).toBe(true);

    // TUTUP-ULANG tidak menerapkan aturan urutan tahun lama.
    const ulang = validasiTutupBuku(2025, {
      sekarang: SEKARANG,
      tutup: [{ tahun: 2025 }],
      tahunAdaJurnal: [2023, 2025],
      konfirmasiTimpak: true,
    });
    expect(ulang.aksi).toBe('TUTUP-ULANG');
    expect(ulang.boleh).toBe(true);
  });

  it('tahun yang sudah ditutup wajib konfirmasi (TUTUP-ULANG)', () => {
    const ctx = {
      sekarang: SEKARANG,
      tutup: [{ tahun: 2025 }],
      tahunAdaJurnal: [2025],
    };
    const belum = validasiTutupBuku(2025, ctx);
    expect(belum.boleh).toBe(false);
    expect(belum.perluKonfirmasi).toBe(true);
    expect(belum.aksi).toBe('TUTUP-ULANG');
    expect(belum.peringatan.join(' ')).toMatch(/sudah pernah ditutup/);

    const sudah = validasiTutupBuku(2025, { ...ctx, konfirmasiTimpak: true });
    expect(sudah.boleh).toBe(true);
    expect(sudah.aksi).toBe('TUTUP-ULANG');
  });

  it('AUD2-06: menolak tahun yang masih punya panjar OPEN sampai 31 Des', () => {
    const ctx = {
      sekarang: SEKARANG,
      tutup: [],
      tahunAdaJurnal: [],
      panjarOpenTahun: [
        { id: 'p-2025', tanggal: '2025-12-20', penerima: 'Panitia Piodalan' },
      ],
    };

    const tutup2025 = validasiTutupBuku(2025, ctx);
    expect(tutup2025.boleh).toBe(false);
    expect(tutup2025.errors.join(' ')).toMatch(/panjar OPEN/i);
    expect(tutup2025.errors.join(' ')).toContain('Panitia Piodalan');
    expect(tutup2025.errors.join(' ')).toContain('20 Des 2025');
    expect(tutup2025.errors.join(' ')).toMatch(/selesaikan|batalkan/i);

    // Panjar OPEN tahun sebelumnya juga memblokir tahun berikutnya.
    const tutup2026 = validasiTutupBuku(2026, {
      ...ctx,
      sekarang: '2027-01-02',
    });
    expect(tutup2026.boleh).toBe(false);
    expect(tutup2026.errors.join(' ')).toContain('Panitia Piodalan');

    // Panjar bertanggal setelah 31 Des tahun yang dikunci tidak memblokir.
    const bedaTahun = validasiTutupBuku(2025, {
      ...ctx,
      panjarOpenTahun: [
        { id: 'p-2026', tanggal: '2026-01-05', penerima: 'Panitia Lain' },
      ],
    });
    expect(bedaTahun.boleh).toBe(true);

    // Tutup ulang juga tidak boleh melewati panjar yang masih OPEN.
    const ulang = validasiTutupBuku(2025, {
      ...ctx,
      tutup: [{ tahun: 2025 }],
      konfirmasiTimpak: true,
    });
    expect(ulang.boleh).toBe(false);
    expect(ulang.aksi).toBe('TUTUP-ULANG');
    expect(ulang.errors.join(' ')).toMatch(/panjar OPEN/i);
  });
});

describe('P0-7 — tutup buku di DB', () => {
  it('default sekarang mengikuti WITA, bukan UTC', () => {
    vi.useFakeTimers();
    try {
      // 2025-12-31T16:30:00Z = 2026-01-01 00:30 WITA.
      vi.setSystemTime(new Date('2025-12-31T16:30:00Z'));
      const db = freshDb();
      try {
        const pratinjau = previewTutupBuku(db, 2025);
        expect(pratinjau.batasTahun).toBe(2025);
        expect(pratinjau.boleh).toBe(true);
      } finally {
        db.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });

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
      });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.aksi).toBe('TUTUP');
      expect(hasil.laba).toBe(6_000_000);
      expect(hasil.data).toMatchObject({
        tahun: 2025,
        catatan: 'Sudah diperiksa akuntan',
      });
      // DB-28: path backup tidak lagi ditulis/ diekspos.
      expect(hasil.data).not.toHaveProperty('backup_path');

      const riwayat = listTutupBuku(db);
      expect(riwayat).toHaveLength(1);
      expect(riwayat[0]).toMatchObject({
        tahun: 2025,
        catatan: 'Sudah diperiksa akuntan',
      });
      expect(riwayat[0]).not.toHaveProperty('backup_path');
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

  it('menolak lompat tahun saat tahun sebelumnya punya jurnal (AKT-12)', () => {
    const db = freshDb();
    try {
      catat(db, 'j-2024', '2024-06-01', masuk('4005', 2_000_000));
      catat(db, 'j-2025', '2025-06-01', masuk('4005', 3_000_000));

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.boleh).toBe(false);
      expect(pratinjau.errors.join(' ')).toMatch(/berurutan/);
      expect(pratinjau.errors.join(' ')).toContain('2024');
      expect(pratinjau.sudahDitutup).toBe(false);

      const lompat = tutupBuku(db, 2025, { sekarang: SEKARANG });
      expect(lompat.tersimpan).toBe(false);
      expect(lompat.errors.join(' ')).toMatch(/Tahun 2024/);
      expect(listTutupBuku(db)).toHaveLength(0);
      expect(audit(db)).toHaveLength(0);

      expect(tutupBuku(db, 2024, { sekarang: SEKARANG }).tersimpan).toBe(true);
      expect(tutupBuku(db, 2025, { sekarang: SEKARANG }).tersimpan).toBe(true);
      expect(listTutupBuku(db).map((t) => t.tahun)).toEqual([2024, 2025]);
    } finally {
      db.close();
    }
  });

  it('boleh melewati tahun tanpa jurnal (AKT-12)', () => {
    const db = freshDb();
    try {
      catat(db, 'j-2023', '2023-05-01', masuk('4005', 1_000_000));
      catat(db, 'j-2025', '2025-05-01', masuk('4005', 2_000_000));

      expect(tutupBuku(db, 2023, { sekarang: SEKARANG }).tersimpan).toBe(true);
      expect(tutupBuku(db, 2025, { sekarang: SEKARANG }).tersimpan).toBe(true);
      expect(listTutupBuku(db).map((t) => t.tahun)).toEqual([2023, 2025]);
    } finally {
      db.close();
    }
  });

  it('tutup ulang tahun lama tetap boleh meski ada tahun lebih lama berjurnal (AKT-12)', () => {
    const db = freshDb();
    try {
      catat(db, 'j-2023', '2023-04-01', masuk('4005', 500_000));
      catat(db, 'j-2024', '2024-04-01', masuk('4005', 700_000));
      insertTutupBuku(db, {
        tahun: 2024,
        created_at: '2025-01-10T00:00:00.000Z',
        catatan: 'Tutup lama',
      });

      const belum = tutupBuku(db, 2024, { sekarang: SEKARANG });
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.errors).toEqual([]);

      const ulang = tutupBuku(db, 2024, {
        sekarang: SEKARANG,
        konfirmasiTimpak: true,
        catatan: 'Diulang',
      });
      expect(ulang.tersimpan).toBe(true);
      expect(ulang.aksi).toBe('TUTUP-ULANG');
      expect(ulang.data?.catatan).toBe('Diulang');
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

describe('AUD2-06 — guard cut-off panjar OPEN lintas tahun', () => {
  it('preview & simpan menolak 2025 selama panjar OPEN 2025-12-20', () => {
    const db = dbPanjarOpen2025();
    try {
      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.boleh).toBe(false);
      expect(pratinjau.errors.join(' ')).toMatch(/panjar OPEN/i);
      expect(pratinjau.errors.join(' ')).toContain('Panitia Piodalan');
      expect(pratinjau.errors.join(' ')).toContain('20 Des 2025');
      expect(pratinjau.errors.join(' ')).toMatch(/selesaikan|batalkan/i);
      expect(pratinjau.temuanIntegritas).toEqual([]);

      const hasil = tutupBuku(db, 2025, {
        sekarang: SEKARANG,
        catatan: 'Tidak boleh tersimpan',
      });
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toContain('Panitia Piodalan');
      expect(hasil.errors.join(' ')).toContain('20 Des 2025');
      expect(listTutupBuku(db)).toHaveLength(0);
      expect(audit(db).some((a) => a.aksi.startsWith('TUTUP'))).toBe(false);
    } finally {
      db.close();
    }
  });

  it('tutup 2025 berhasil setelah panjar dipertanggungjawabkan', () => {
    const db = dbPanjarOpen2025();
    try {
      const close = closePanjarV2(db, {
        id: 'p-2025',
        tanggalClose: '2026-01-10',
        items: [{ akun: '5004', nominal: 1_000_000 }],
      });
      expect(close.tersimpan, close.errors.join(' ')).toBe(true);

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.boleh, pratinjau.errors.join(' ')).toBe(true);
      const hasil = tutupBuku(db, 2025, { sekarang: SEKARANG });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(listTutupBuku(db).map((t) => t.tahun)).toEqual([2025]);
    } finally {
      db.close();
    }
  });

  it('tutup 2025 berhasil setelah panjar dibatalkan', () => {
    const db = dbPanjarOpen2025();
    try {
      const batal = batalPanjarV2(db, {
        id: 'p-2025',
        alasan: 'Salah serah ke panitia',
      });
      expect(batal.tersimpan, batal.errors.join(' ')).toBe(true);

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.boleh, pratinjau.errors.join(' ')).toBe(true);
      const hasil = tutupBuku(db, 2025, { sekarang: SEKARANG });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(listTutupBuku(db).map((t) => t.tahun)).toEqual([2025]);
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

describe('AKT-10 — tutup buku menolak jika audit integritas gagal', () => {
  it('preview menolak jurnal tidak seimbang yang dikorupsi lewat SQL', () => {
    const db = freshDb();
    try {
      catat(db, 'j-seimbang-2025', '2025-02-01', masuk('4005', 1_000_000));
      korupsiJurnalTidakSeimbang(db, 'j-rusak-2025', '2025-03-01');

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);

      expect(pratinjau.boleh).toBe(false);
      expect(pratinjau.perluKonfirmasi).toBe(false);
      expect(pratinjau.errors.join(' ')).toMatch(/audit integritas/i);
      expect(pratinjau.errors.join(' ')).toMatch(/tidak seimbang/i);
      expect(pratinjau.errors.join(' ')).toContain('JURNAL_TIDAK_SEIMBANG');
      expect(pratinjau.temuanIntegritas.map((t) => t.kode)).toContain(
        'JURNAL_TIDAK_SEIMBANG',
      );
      // Preview tidak menulis apa pun.
      expect(listTutupBuku(db)).toHaveLength(0);
      expect(audit(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('tutupBuku menolak dan tidak menulis penanda/audit saat audit gagal', () => {
    const db = freshDb();
    try {
      catat(db, 'j-seimbang-2025', '2025-02-01', masuk('4005', 1_000_000));
      korupsiJurnalTidakSeimbang(db, 'j-rusak-2025', '2025-03-01');
      const jumlahJurnal = db
        .prepare('SELECT COUNT(*) AS n FROM jurnal')
        .get() as { n: number };

      const hasil = tutupBuku(db, 2025, {
        sekarang: SEKARANG,
        catatan: 'Tidak boleh tersimpan',
      });

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.data).toBeUndefined();
      expect(hasil.errors.join(' ')).toMatch(/audit integritas/i);
      expect(hasil.errors.join(' ')).toMatch(/tidak seimbang/i);
      expect(hasil.errors.join(' ')).toContain('JURNAL_TIDAK_SEIMBANG');
      expect(hasil.temuanIntegritas.map((t) => t.kode)).toContain(
        'JURNAL_TIDAK_SEIMBANG',
      );

      // Tidak ada penanda tutup buku, audit, atau jurnal baru.
      expect(listTutupBuku(db)).toHaveLength(0);
      expect(audit(db)).toHaveLength(0);
      expect(db.prepare('SELECT COUNT(*) AS n FROM jurnal').get()).toEqual(jumlahJurnal);
    } finally {
      db.close();
    }
  });

  it('preview memakai pemeriksaan DB-12: reversal ganda memblokir tutup buku', () => {
    const db = freshDb();
    try {
      catat(db, 'j-seimbang-2025', '2025-02-01', masuk('4005', 1_000_000));
      korupsiReversalGanda(db, 'j-rusak-reversal');

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);

      expect(pratinjau.boleh).toBe(false);
      expect(pratinjau.errors.join(' ')).toContain('REVERSAL_GANDA');
      expect(pratinjau.temuanIntegritas.map((t) => t.kode)).toContain('REVERSAL_GANDA');
      expect(listTutupBuku(db)).toHaveLength(0);
      expect(audit(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('AUD2-01 — laba tahun & laba ditahan memakai master akun DB', () => {
  it('preview, tutup, dan labaDitahan mengenali akun BEBAN tambahan', () => {
    const db = freshDb();
    try {
      tambahAkun(db, {
        kode: '5011',
        nama: 'PENGELUARAN ARTOS',
        tipe: 'BEBAN',
      });

      catat(db, 'j-beban-2024', '2024-05-01', keluar('5011', 1_000_000));
      const tutup2024 = tutupBuku(db, 2024, { sekarang: SEKARANG });
      expect(tutup2024.tersimpan, tutup2024.errors.join(' ')).toBe(true);
      expect(tutup2024.laba).toBe(-1_000_000);

      catat(db, 'j-beban-2025', '2025-05-01', keluar('5011', 500_000));
      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.boleh, pratinjau.errors.join(' ')).toBe(true);
      expect(pratinjau.laba).toBe(-500_000);
      expect(pratinjau.labaDitahanSekarang).toBe(-1_000_000);
      expect(pratinjau.labaDitahanSesudah).toBe(-1_500_000);

      const hasil = tutupBuku(db, 2025, { sekarang: SEKARANG });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.laba).toBe(-500_000);
      expect(hasil.labaDitahan).toBe(-1_500_000);

      expect(
        labaDitahan(listBarisJurnal(db), listTutupBuku(db), listAkun(db)),
      ).toBe(-1_500_000);
    } finally {
      db.close();
    }
  });
});

describe('T-A06 — snapshot tutup buku immutable', () => {
  it('tutup sukses menulis laba, Neraca, hash, dan versi 1', () => {
    const db = freshDb();
    try {
      catat(db, 'j-pendapatan-2025', '2025-03-01', masuk('4005', 10_000_000));
      catat(db, 'j-beban-2025', '2025-04-01', keluar('5000', 4_000_000));

      const hasil = tutupBuku(db, 2025, { sekarang: SEKARANG });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

      const snapshot = listTutupBukuSnapshot(db, 2025);
      expect(snapshot).toHaveLength(1);
      expect(snapshot[0]).toMatchObject({
        tahun: 2025,
        versi: 1,
        laba: 6_000_000,
        total_aset: 6_000_000,
        total_kewajiban: 0,
        total_ekuitas: 6_000_000,
        total_pasiva: 6_000_000,
        selisih: 0,
      });
      expect(snapshot[0]!.hash_jurnal).toMatch(/^[0-9a-f]{64}$/);
      expect(snapshot[0]!.hash_jurnal).toBe(
        hitungHashJurnalTahun(db, 2025).hash_jurnal,
      );
      expect(hasil.snapshot).toMatchObject({ versi: 1, laba: 6_000_000 });
      expect(hasil.snapshotBerubah).toBe(false);
    } finally {
      db.close();
    }
  });

  it('TUTUP-ULANG menambah versi 2 tanpa menghapus versi 1', () => {
    const db = freshDb();
    try {
      catat(db, 'j-pendapatan-2025', '2025-03-01', masuk('4005', 10_000_000));
      catat(db, 'j-beban-2025', '2025-04-01', keluar('5000', 4_000_000));
      expect(tutupBuku(db, 2025, { sekarang: SEKARANG }).tersimpan).toBe(true);
      const versi1 = listTutupBukuSnapshot(db, 2025)[0]!;
      expect(versi1.versi).toBe(1);
      expect(versi1.laba).toBe(6_000_000);

      // Koreksi setelah tutup: snapshot lama tetap, angka live berubah.
      catat(db, 'j-koreksi-2025', '2025-12-31', masuk('4005', 1_000_000));
      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.snapshotTerbaru?.versi).toBe(1);
      expect(pratinjau.snapshotBerubah).toBe(true);
      expect(pratinjau.perbedaanSnapshot.length).toBeGreaterThan(0);
      expect(pratinjau.versiSnapshotBerikutnya).toBe(2);
      expect(pratinjau.temuanIntegritas.map((t) => t.kode)).toContain(
        'SNAPSHOT_TUTUP_BERUBAH',
      );

      // Konfirmasi TUTUP-ULANG tetap tersimpan walau snapshot berubah.
      const ulang = tutupBuku(db, 2025, {
        sekarang: SEKARANG,
        konfirmasiTimpak: true,
        catatan: 'Koreksi disahkan',
      });
      expect(ulang.tersimpan, ulang.errors.join(' ')).toBe(true);
      expect(ulang.snapshot?.versi).toBe(2);

      const semua = listTutupBukuSnapshot(db, 2025);
      expect(semua.map((s) => s.versi)).toEqual([2, 1]);
      const v2 = semua.find((s) => s.versi === 2)!;
      const v1 = semua.find((s) => s.versi === 1)!;
      expect(v2.laba).toBe(7_000_000);
      expect(v1).toEqual(versi1);
      expect(bandingkanSnapshotTutup(db, 2025).snapshot?.versi).toBe(2);
    } finally {
      db.close();
    }
  });

  it('penutupan gagal validasi tidak menulis snapshot/penanda/audit', () => {
    const db = freshDb();
    try {
      catat(db, 'j-seimbang-2025', '2025-02-01', masuk('4005', 1_000_000));
      korupsiJurnalTidakSeimbang(db, 'j-rusak-2025', '2025-03-01');

      const hasil = tutupBuku(db, 2025, { sekarang: SEKARANG });
      expect(hasil.tersimpan).toBe(false);
      expect(listTutupBuku(db)).toHaveLength(0);
      expect(listTutupBukuSnapshot(db)).toHaveLength(0);
      expect(audit(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('temuan integritas lain tetap memblokir walau snapshot sudah berubah', () => {
    const db = freshDb();
    try {
      catat(db, 'j-pendapatan-2025', '2025-03-01', masuk('4005', 10_000_000));
      expect(tutupBuku(db, 2025, { sekarang: SEKARANG }).tersimpan).toBe(true);
      catat(db, 'j-koreksi-2025', '2025-12-31', masuk('4005', 1_000_000));
      korupsiJurnalTidakSeimbang(db, 'j-rusak-2025', '2025-04-01');

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      expect(pratinjau.temuanIntegritas.map((t) => t.kode)).toEqual(
        expect.arrayContaining([
          'JURNAL_TIDAK_SEIMBANG',
          'SNAPSHOT_TUTUP_BERUBAH',
        ]),
      );
      expect(pratinjau.boleh).toBe(false);

      const ulang = tutupBuku(db, 2025, {
        sekarang: SEKARANG,
        konfirmasiTimpak: true,
      });
      expect(ulang.tersimpan).toBe(false);
      expect(ulang.errors.join(' ')).toContain('JURNAL_TIDAK_SEIMBANG');
      expect(listTutupBukuSnapshot(db, 2025)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('hash kanonik tidak bergantung pada urutan insert jurnal/baris', () => {
    const dbA = freshDb();
    const dbB = freshDb();
    try {
      catat(dbA, 'j-a', '2025-01-02', masuk('4005', 1_000_000));
      catat(dbA, 'j-b', '2025-01-01', masuk('4005', 2_000_000));
      catat(dbB, 'j-b', '2025-01-01', masuk('4005', 2_000_000));
      catat(dbB, 'j-a', '2025-01-02', masuk('4005', 1_000_000));

      expect(hitungHashJurnalTahun(dbA, 2025)).toEqual(
        hitungHashJurnalTahun(dbB, 2025),
      );
    } finally {
      dbA.close();
      dbB.close();
    }
  });
});

describe('T-A07 — tutup buku memakai temuan konsistensi laporan', () => {
  it('menolak tahun dengan Neraca/Neraca Saldo selisih walau setiap jurnal seimbang', () => {
    const db = freshDb();
    try {
      const awal = simpanSaldoAwal(db, {
        header: {
          id: 'sa-2025-ta07',
          tanggal: '2025-07-01',
          no_bukti: 'SA-2025-TA07',
          keterangan: 'Saldo awal cut-over 1 Juli 2025',
          jenis: 'SALDO_AWAL',
        },
        baris: [
          { akun_kode: '1001', debit: 10_000_000, kredit: 0 },
          { akun_kode: AKUN_MODAL, debit: 0, kredit: 10_000_000 },
        ],
      });
      expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

      // Jurnal seimbang per-jurnal, tetapi P&L-nya bertanggal sebelum cut-over
      // di luar grup pembukaan. Inilah fixture laporan: tidak ada
      // JURNAL_TIDAK_SEIMBANG, tetapi Neraca dan Neraca Saldo mode tahun tidak
      // seimbang sehingga tutup buku wajib diblokir.
      db.prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of,
            created_at)
         VALUES (?, ?, ?, ?, 'UMUM', ?, NULL,
                 '2026-10-29T00:00:00.000Z')`,
      ).run(
        'j-pl-pra-2025',
        '2025-06-15',
        'JU-TA07-PL',
        'P&L sebelum cut-over',
        'j-pl-pra-2025',
      );
      db.prepare(
        `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
         VALUES ('j-pl-pra-2025', '1001', 100000, 0, '')`,
      ).run();
      db.prepare(
        `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
         VALUES ('j-pl-pra-2025', '4005', 0, 100000, '')`,
      ).run();

      const pratinjau = previewTutupBuku(db, 2025, SEKARANG);
      const kode = pratinjau.temuanIntegritas.map((t) => t.kode);

      expect(pratinjau.boleh).toBe(false);
      expect(pratinjau.errors.join(' ')).toMatch(/audit integritas/i);
      expect(kode).toEqual(
        expect.arrayContaining([
          'NERACA_TIDAK_SEIMBANG',
          'NERACA_SALDO_SELISIH',
          'LABA_RUGI_SEBELUM_CUTOVER',
        ]),
      );
      expect(kode).not.toContain('JURNAL_TIDAK_SEIMBANG');

      const hasil = tutupBuku(db, 2025, {
        sekarang: SEKARANG,
        catatan: 'Tidak boleh tersimpan',
      });
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toContain('NERACA_TIDAK_SEIMBANG');
      expect(listTutupBuku(db)).toHaveLength(0);
      expect(audit(db).some((a) => a.aksi.startsWith('TUTUP'))).toBe(false);
    } finally {
      db.close();
    }
  });
});
