// DB-38: cut-over pembukuan di tengah tahun.
//
// Skenario nyata: pura mulai memakai aplikasi pada 2026-07-01. Tahun buku tetap
// Januari–Desember, sehingga 2026 adalah **tahun pertama (parsial)**: hanya
// transaksi 2026-07-01 s/d 2026-12-31 yang masuk Laba Rugi 2026. Laba sebelum
// cut-over sudah masuk saldo awal/ekuitas dan tidak boleh dicatat sebagai P&L.
//
// Semua nominal SEN. Angka harapan dihitung manual.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/database.js';
import {
  getPengaturanPembukuan,
  insertJurnalTervalidasi,
  listAuditLog,
  listJurnal,
  listTutupBuku,
  simpanPengaturanPembukuan,
} from '../src/db/repository.js';
import { buatJurnalSaldoAwal } from '../src/core/forms.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
import { postingJurnal } from '../src/db/posting.js';
import { listBarisJurnal, laporanLabaRugi, laporanNeraca } from '../src/db/laporan.js';
import { previewTutupBuku, tutupBuku } from '../src/db/tutup.js';
import { labaRugiPrintDoc } from '../src/features/export/printAdapters.js';
import {
  catatanTahunPertamaParsial,
  DEFAULT_PENGATURAN,
  tahunPertamaParsial,
  validasiPengaturan,
} from '../src/core/pengaturan.js';
import { labaRugi, labaTahun, neraca } from '../src/core/reports.js';
import type { JurnalBarisInput, JurnalJenis } from '../src/core/types.js';
import { validasiBentukSaldoAwal } from '../src/main/validation.js';

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

const CUTOVER = '2026-07-01';

function catat(
  db: Database.Database,
  id: string,
  tanggal: string,
  baris: JurnalBarisInput[],
  jenis: JurnalJenis = 'UMUM',
): ReturnType<typeof postingJurnal> {
  return postingJurnal(
    db,
    {
      header: {
        id,
        tanggal,
        no_bukti: `JU-${id}`,
        keterangan: `Uji ${id}`,
        jenis,
      },
      baris,
    },
    // Tanggal acuan uji tidak boleh memblokir jurnal 2026/2027 sebagai masa depan.
    { sekarang: '2028-01-01' },
  );
}

function dbMulaiTengahTahun(): Database.Database {
  const db = openDb(':memory:');
  // Tanggal cut-over diisi lebih dulu; wizard saldo awal juga menulis ulang
  // tanggal yang sama secara atomik.
  simpanPengaturanPembukuan(db, {
    ...DEFAULT_PENGATURAN,
    tanggalMulaiPembukuan: CUTOVER,
  });

  const awal = buatJurnalSaldoAwal({
    id: 'sa-2026-07',
    tanggal: CUTOVER,
    keterangan: 'Saldo awal cut-over 1 Juli 2026',
    noBukti: 'SA-2026-0001',
    saldo: [
      { akun_kode: '1001', nominal: RP(150_000_000) },
      { akun_kode: '2050', nominal: RP(40_000_000) },
    ],
  });
  const hasil = simpanSaldoAwal(db, awal.input);
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  return db;
}

function catatAktivitas2026(db: Database.Database): void {
  // Pendapatan Juli–Desember 2026 = Rp 30.000.000.
  expect(
    catat(db, 'r-jul', '2026-07-10', [D('1001', RP(10_000_000)), K('4005', RP(10_000_000))])
      .tersimpan,
  ).toBe(true);
  expect(
    catat(db, 'r-sep', '2026-09-05', [D('1029', RP(15_000_000)), K('4005', RP(15_000_000))])
      .tersimpan,
  ).toBe(true);
  expect(
    catat(db, 'r-des', '2026-12-20', [D('1001', RP(5_000_000)), K('4005', RP(5_000_000))])
      .tersimpan,
  ).toBe(true);

  // Beban Juli–Desember 2026 = Rp 10.000.000.
  expect(
    catat(db, 'e-agu', '2026-08-01', [D('5010', RP(4_000_000)), K('1001', RP(4_000_000))])
      .tersimpan,
  ).toBe(true);
  expect(
    catat(db, 'e-upakara', '2026-11-11', [D('5004', RP(6_000_000)), K('1001', RP(6_000_000))])
      .tersimpan,
  ).toBe(true);
}

function catatAktivitas2027(db: Database.Database): void {
  expect(
    catat(db, 'r-2027', '2027-01-05', [D('1001', RP(7_000_000)), K('4005', RP(7_000_000))])
      .tersimpan,
  ).toBe(true);
  expect(
    catat(db, 'e-2027', '2027-02-02', [D('5010', RP(2_000_000)), K('1001', RP(2_000_000))])
      .tersimpan,
  ).toBe(true);
}

describe('DB-38 — helper tahun pertama parsial', () => {
  it('hanya menandai tahun cut-over setelah 1 Januari', () => {
    expect(tahunPertamaParsial(CUTOVER, 2026)).toBe(true);
    expect(tahunPertamaParsial(CUTOVER, 2027)).toBe(false);
    expect(tahunPertamaParsial('2026-01-01', 2026)).toBe(false);
    expect(tahunPertamaParsial('', 2026)).toBe(false);
    expect(tahunPertamaParsial('2026-02-31', 2026)).toBe(false);

    const catatan = catatanTahunPertamaParsial(CUTOVER, 2026);
    expect(catatan).toContain('tahun pertama (parsial)');
    expect(catatan).toContain('2026-07-01');
    expect(catatan).toContain('bukan Laba Rugi 2026');
    expect(catatanTahunPertamaParsial(CUTOVER, 2027)).toBeNull();
    expect(catatanTahunPertamaParsial('2026-01-01', 2026)).toBeNull();
  });

  it('pengaturan dan form saldo awal menerima tanggal cut-over', () => {
    expect(
      validasiPengaturan({
        ...DEFAULT_PENGATURAN,
        tanggalMulaiPembukuan: CUTOVER,
      }),
    ).toEqual([]);
    const bentuk = validasiBentukSaldoAwal({
      tanggal: CUTOVER,
      saldo: [{ akun_kode: '1001', nominal: RP(1_000_000) }],
    });
    expect(bentuk.ok).toBe(true);
  });
});

describe('DB-38 — cut-over 1 Juli 2026', () => {
  it('laba 2026 hanya Juli–Desember, bukan Januari–Juni atau 2025', () => {
    const db = dbMulaiTengahTahun();
    try {
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe(CUTOVER);
      catatAktivitas2026(db);
      const baris = listBarisJurnal(db);

      expect(labaTahun(baris, 2026, undefined, CUTOVER)).toBe(RP(20_000_000));
      expect(labaTahun(baris, 2025, undefined, CUTOVER)).toBe(0);
      const lr = labaRugi(baris, { mulai: CUTOVER, sampai: '2026-12-31' });
      expect(lr.totalPendapatan).toBe(RP(30_000_000));
      expect(lr.totalBeban).toBe(RP(10_000_000));
      expect(lr.laba).toBe(RP(20_000_000));
      expect(lr.pendapatan.find((b) => b.kode === '4005')?.nominal).toBe(RP(30_000_000));
      expect(lr.beban.find((b) => b.kode === '5010')?.nominal).toBe(RP(4_000_000));
      expect(lr.beban.find((b) => b.kode === '5004')?.nominal).toBe(RP(6_000_000));

      // Jurnal saldo awal hanya akun neraca: tidak ada P&L yang ikut.
      expect(lr.pendapatan.every((b) => b.kode.startsWith('4'))).toBe(true);
      expect(lr.beban.every((b) => b.kode.startsWith('5'))).toBe(true);
    } finally {
      db.close();
    }
  });

  it('jurnal P&L sebelum cut-over ditolak dan tidak masuk tahun berjalan', () => {
    const db = dbMulaiTengahTahun();
    try {
      const sebelum = catat(db, 'palsu-juni', '2026-06-30', [
        D('5004', RP(1_000_000)),
        K('1001', RP(1_000_000)),
      ]);
      expect(sebelum.tersimpan).toBe(false);
      expect(sebelum.errors).toContain(
        `Tanggal jurnal sebelum tanggal mulai pembukuan (${CUTOVER}).`,
      );
      expect(labaTahun(listBarisJurnal(db), 2026, undefined, CUTOVER)).toBe(0);

      // Saldo awal tidak boleh berisi akun P&L; laba pra-cut-over masuk modal.
      expect(() =>
        buatJurnalSaldoAwal({
          tanggal: CUTOVER,
          saldo: [{ akun_kode: '4005', nominal: RP(1_000_000) }],
        }),
      ).toThrow(/AKTIVA atau KEWAJIBAN/);
    } finally {
      db.close();
    }
  });

  it('data lama P&L pra-cut-over tidak dihitung sebagai laba 2026', () => {
    const db = dbMulaiTengahTahun();
    try {
      // Simulasi data lama/cut-over yang lolos dari guard posting: P&L Juni
      // sebelum saldo awal 1 Juli. Entri ini tidak boleh menjadi laba 2026.
      insertJurnalTervalidasi(
        db,
        {
          id: 'lama-juni',
          tanggal: '2026-06-30',
          no_bukti: 'JU-LAMA-2026',
          keterangan: 'Beban lama sebelum cut-over',
          jenis: 'UMUM',
        },
        [D('5004', RP(1_000_000)), K('1001', RP(1_000_000))],
      );
      catatAktivitas2026(db);
      const baris = listBarisJurnal(db);

      expect(labaTahun(baris, 2026, undefined, CUTOVER)).toBe(RP(20_000_000));
      const lr = labaRugi(baris, { mulai: '2026-01-01', sampai: '2026-12-31' }, undefined, CUTOVER);
      expect(lr.totalBeban).toBe(RP(10_000_000));
      expect(lr.laba).toBe(RP(20_000_000));
    } finally {
      db.close();
    }
  });

  it('Neraca 2026-12-31 seimbang dengan saldo awal + laba parsial', () => {
    const db = dbMulaiTengahTahun();
    try {
      catatAktivitas2026(db);
      const baris = listBarisJurnal(db);

      const n = neraca(baris, { cutoff: '2026-12-31', tutup: [] }, undefined, CUTOVER);
      expect(n.balance).toBe(true);
      expect(n.selisih).toBe(0);
      // Aset awal 150jt + laba 20jt; kewajiban tetap 40jt; modal awal 110jt.
      expect(n.totalAset).toBe(RP(170_000_000));
      expect(n.totalKewajiban).toBe(RP(40_000_000));
      expect(n.totalEkuitasAkun).toBe(RP(110_000_000));
      expect(n.labaBerjalan).toBe(RP(20_000_000));
      expect(n.labaDitahan).toBe(0);
      expect(n.labaBelumDitutup).toBe(0);
      expect(n.totalEkuitas).toBe(RP(130_000_000));
      expect(n.totalPasiva).toBe(RP(170_000_000));

      const sebelumCutover = neraca(baris, { cutoff: CUTOVER, tutup: [] }, undefined, CUTOVER);
      expect(sebelumCutover.balance).toBe(true);
      expect(sebelumCutover.labaBerjalan).toBe(0);
      expect(sebelumCutover.totalAset).toBe(RP(150_000_000));

      const laporan = laporanNeraca(db, '2026-12-31');
      expect(laporan.balance).toBe(true);
      expect(laporan.labaBerjalan).toBe(RP(20_000_000));
      expect(laporan.catatanTahunPertama).toMatch(/tahun pertama \(parsial\)/i);
    } finally {
      db.close();
    }
  });

  it('laporan Laba Rugi adapter memberi catatan tahun pertama parsial', () => {
    const db = dbMulaiTengahTahun();
    try {
      catatAktivitas2026(db);
      const laporan = laporanLabaRugi(db, {
        mulai: CUTOVER,
        sampai: '2026-12-31',
      });
      expect(laporan.laba).toBe(RP(20_000_000));
      expect(laporan.catatanTahunPertama).toMatch(/tahun pertama \(parsial\)/i);
      expect(laporan.catatanTahunPertama).toContain(CUTOVER);
      // Tanpa batas akhir dan untuk tahun berikutnya, catatan parsial tidak
      // boleh salah tempel.
      expect(
        laporanLabaRugi(db, { mulai: CUTOVER }).catatanTahunPertama,
      ).toMatch(/tahun pertama \(parsial\)/i);
      expect(
        laporanLabaRugi(db, {
          mulai: '2027-01-01',
          sampai: '2027-12-31',
        }).catatanTahunPertama,
      ).toBeUndefined();

      const cetak = labaRugiPrintDoc(laporan);
      expect(
        cetak.blok.some(
          (b) =>
            b.jenis === 'paragraf' &&
            b.teks.includes('tahun pertama (parsial)'),
        ),
      ).toBe(true);
    } finally {
      db.close();
    }
  });

  it('jurnal 2027 memisahkan tahun; tutup 2026 parsial tanpa jurnal penutup', () => {
    const db = dbMulaiTengahTahun();
    try {
      catatAktivitas2026(db);
      catatAktivitas2027(db);
      const sebelumTutup = listJurnal(db);
      const jumlahSebelum = sebelumTutup.length;

      const baris = listBarisJurnal(db);
      expect(labaTahun(baris, 2026, undefined, CUTOVER)).toBe(RP(20_000_000));
      expect(labaTahun(baris, 2027, undefined, CUTOVER)).toBe(RP(5_000_000));

      // Neraca 2026 tidak terpengaruh jurnal 2027.
      const n2026 = neraca(baris, { cutoff: '2026-12-31', tutup: [] }, undefined, CUTOVER);
      expect(n2026.totalAset).toBe(RP(170_000_000));
      expect(n2026.labaBerjalan).toBe(RP(20_000_000));
      expect(n2026.balance).toBe(true);

      // Pada 2027, laba 2026 yang belum dikunci tetap di labaBelumDitutup.
      const n2027 = neraca(baris, { cutoff: '2027-12-31', tutup: [] }, undefined, CUTOVER);
      expect(n2027.labaDitahan).toBe(0);
      expect(n2027.labaBelumDitutup).toBe(RP(20_000_000));
      expect(n2027.labaBerjalan).toBe(RP(5_000_000));
      expect(n2027.balance).toBe(true);

      const pratinjau = previewTutupBuku(db, 2026, '2027-02-01');
      expect(pratinjau.boleh, pratinjau.errors.join(' ')).toBe(true);
      expect(pratinjau.laba).toBe(RP(20_000_000));
      expect(pratinjau.catatanTahunPertama).toMatch(/tahun pertama \(parsial\)/i);

      const hasil = tutupBuku(db, 2026, {
        sekarang: '2027-02-01',
        catatan: 'Kunci tahun pertama parsial',
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.laba).toBe(RP(20_000_000));
      expect(hasil.labaDitahan).toBe(RP(20_000_000));
      expect(hasil.catatanTahunPertama).toMatch(/tahun pertama \(parsial\)/i);
      expect(listTutupBuku(db).map((t) => t.tahun)).toEqual([2026]);

      // AKT-16/DB-38: kunci periode tidak membuat jurnal penutup.
      expect(listJurnal(db)).toHaveLength(jumlahSebelum);
      expect(listJurnal(db).map((j) => j.id)).toEqual(sebelumTutup.map((j) => j.id));
      expect(listAuditLog(db, { aksi: 'TUTUP 2026' })).toHaveLength(1);

      const sesudah = neraca(
        baris,
        {
          cutoff: '2027-12-31',
          tutup: listTutupBuku(db),
        },
        undefined,
        CUTOVER,
      );
      expect(sesudah.labaDitahan).toBe(RP(20_000_000));
      expect(sesudah.labaBelumDitutup).toBe(0);
      expect(sesudah.labaBerjalan).toBe(RP(5_000_000));
      expect(sesudah.balance).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('DB-38 — dokumentasi cut-over', () => {
  const baca = (nama: string): string =>
    readFileSync(fileURLToPath(new URL(`../docs/${nama}`, import.meta.url)), 'utf-8');

  it('panduan pengguna dan prinsip akuntansi menjelaskan cut-over + tahun parsial', () => {
    for (const dokumen of ['panduan-pengguna.md', 'prinsip-akuntansi.md']) {
      const teks = baca(dokumen);
      expect(teks, dokumen).toContain('tahun pertama (parsial)');
      expect(teks, dokumen).toMatch(/cut-over/i);
    }
    const pengguna = baca('panduan-pengguna.md');
    expect(pengguna).toContain('2026-07-01');
    expect(pengguna).toContain('3000 MODAL');
    expect(pengguna).toMatch(/jangan memasukkan\s+akun pendapatan/i);
    expect(pengguna).toMatch(/normal, bukan error/i);
    expect(pengguna).toMatch(/tidak membuat jurnal penutup/i);
  });
});
