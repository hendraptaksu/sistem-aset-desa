// T-A01 — satukan sumber tanggal cut-over pembukaan aktif.
//
// Regresi utama: koreksi saldo awal memindahkan tanggal mulai, tetapi laporan
// tidak boleh memakai tanggal `SALDO_AWAL` lama. Semua laporan DB (Laba Rugi,
// Neraca, Neraca Saldo, tutup buku, dashboard) harus membaca `cutover_tanggal`
// resmi yang ditulis atomik oleh `simpanSaldoAwal`/`koreksiSaldoAwal`.
//
// Skenario tiket:
// 1. Saldo awal 2026-07-01 D 1001 Kas / K 3000 Modal Rp100.000.000.
// 2. Koreksi saldo awal ke 2026-06-01.
// 3. Posting pendapatan 2026-06-15 Rp10.000.000.
// 4. Laba Rugi 2026 = Rp10.000.000 dan semua laporan seimbang.

import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  getCutoverTanggal,
  getPembukaanAktif,
} from '../src/db/pembukaan.js';
import {
  listBarisJurnal,
  laporanLabaRugi,
  laporanNeraca,
  laporanNeracaSaldo,
} from '../src/db/laporan.js';
import { postingJurnal } from '../src/db/posting.js';
import {
  getPengaturanPembukuan,
  getPengaturan,
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  KUNCI_CUTOVER_TANGGAL,
  listAkun,
  listTutupBuku,
  PESAN_TANGGAL_CUTOVER_DIKUNCI,
  setPengaturan,
  simpanPengaturanPembukuan,
  insertJurnalTervalidasi,
} from '../src/db/repository.js';
import { koreksiSaldoAwal, simpanSaldoAwal } from '../src/db/saldoAwal.js';
import { previewTutupBuku } from '../src/db/tutup.js';
import { buatJurnalSaldoAwal } from '../src/core/forms.js';
import { DEFAULT_PENGATURAN } from '../src/core/pengaturan.js';
import { buildDashboardJurnal } from '../src/features/dashboard/dashboard.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const RP = (rupiah: number): number => rupiah * 100;
const SEKARANG = '2026-12-31';

function simpanAwal(db: ReturnType<typeof openDb>, tanggal: string, id = 'sa-awal') {
  const hasil = simpanSaldoAwal(
    db,
    buatJurnalSaldoAwal({
      id,
      tanggal,
      saldo: [{ akun_kode: '1001', nominal: RP(100_000_000) }],
    }).input,
  );
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  return hasil;
}

function koreksi(
  db: ReturnType<typeof openDb>,
  tanggal: string,
  alasan = 'Koreksi tanggal cut-over saldo awal',
) {
  const hasil = koreksiSaldoAwal(
    db,
    buatJurnalSaldoAwal({
      tanggal,
      saldo: [{ akun_kode: '1001', nominal: RP(100_000_000) }],
    }).input,
    { alasan, sekarang: SEKARANG },
  );
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  return hasil;
}

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

function postingPendapatan(
  db: ReturnType<typeof openDb>,
  id: string,
  tanggal: string,
  nominal: number,
) {
  const hasil = postingJurnal(
    db,
    {
      header: {
        id,
        tanggal,
        no_bukti: `JU-${id}`,
        keterangan: 'Pendapatan uji cut-over',
        jenis: 'TERIMA',
      },
      baris: [D('1001', nominal), K('4005', nominal)],
    },
    { sekarang: SEKARANG },
  );
  expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
  return hasil;
}

describe('T-A01 — koreksi saldo awal ke tanggal lebih awal', () => {
  it('laporan memakai cut-over resmi 2026-06-01, bukan tanggal SALDO_AWAL lama', () => {
    const db = openDb(':memory:');
    try {
      simpanAwal(db, '2026-07-01');
      expect(getCutoverTanggal(db)).toBe('2026-07-01');

      koreksi(db, '2026-06-01');

      // Penunjuk pembukaan + cut-over + kunci lama harus konsisten.
      expect(getCutoverTanggal(db)).toBe('2026-06-01');
      expect(getPembukaanAktif(db)).toMatchObject({ tanggal: '2026-06-01' });
      expect(getPengaturan(db, KUNCI_CUTOVER_TANGGAL)).toBe('2026-06-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe('2026-06-01');

      postingPendapatan(db, 'j-pendapatan-juni', '2026-06-15', RP(10_000_000));

      const baris = listBarisJurnal(db);

      // Laba Rugi 2026: hanya pendapatan setelah cut-over aktif.
      const lr = laporanLabaRugi(db, {
        mulai: '2026-01-01',
        sampai: '2026-12-31',
      });
      expect(lr.totalPendapatan).toBe(RP(10_000_000));
      expect(lr.laba).toBe(RP(10_000_000));

      // Neraca: aset 110jt = pasiva 110jt (modal 100jt + laba 10jt).
      const n = laporanNeraca(db, '2026-12-31');
      expect(n.totalAset).toBe(RP(110_000_000));
      expect(n.totalAset).toBe(n.totalPasiva);
      expect(n.selisih).toBe(0);
      expect(n.balance).toBe(true);

      // Neraca Saldo mode tahun dan kumulatif sama-sama seimbang.
      const tahun = laporanNeracaSaldo(db, '2026-12-31', 'tahun');
      expect(tahun.selisih).toBe(0);
      expect(tahun.seimbang).toBe(true);
      const kumulatif = laporanNeracaSaldo(db, '2026-12-31', 'kumulatif');
      expect(kumulatif.selisih).toBe(0);
      expect(kumulatif.seimbang).toBe(true);

      // Dashboard memakai cut-over eksplisit yang sama.
      const dashboard = buildDashboardJurnal(
        baris,
        listTutupBuku(db),
        '2026-12-31',
        {
          sekarang: SEKARANG,
          daftarAkun: listAkun(db),
          tanggalMulaiPembukuan:
            getPengaturanPembukuan(db).tanggalMulaiPembukuan,
          cutoverTanggal: getCutoverTanggal(db),
        },
      );
      expect(dashboard.labaRugiBerjalan.laba).toBe(RP(10_000_000));
      expect(dashboard.balance).toBe(true);
      expect(dashboard.aktiva).toBe(RP(110_000_000));
      expect(dashboard.pasiva).toBe(RP(110_000_000));
      expect(dashboard.aktiva).toBe(dashboard.pasiva);

      // Pratinjau tutup buku memakai cut-over resmi yang sama.
      const pratinjau = previewTutupBuku(db, 2026, '2027-01-15');
      expect(pratinjau.laba).toBe(RP(10_000_000));
      expect(pratinjau.catatanTahunPertama).toMatch(/tahun pertama \(parsial\)/i);
    } finally {
      db.close();
    }
  });

  it('P&L sebelum cut-over aktif tidak ikut dihitung sebagai laba tahun berjalan', () => {
    const db = openDb(':memory:');
    try {
      simpanAwal(db, '2026-07-01');
      koreksi(db, '2026-06-01');
      postingPendapatan(db, 'j-pendapatan-juni', '2026-06-15', RP(10_000_000));

      // Data lama/pra-cut-over (mis. sisa DB lama) tidak boleh menjadi P&L
      // tahun pertama. Ditulis langsung agar melewati guard posting.
      insertJurnalTervalidasi(
        db,
        {
          id: 'lama-mei',
          tanggal: '2026-05-20',
          no_bukti: 'JU-LAMA-MEI',
          keterangan: 'Beban lama sebelum cut-over',
          jenis: 'UMUM',
        },
        [D('5004', RP(2_000_000)), K('1001', RP(2_000_000))],
      );

      const lr = laporanLabaRugi(db, {
        mulai: '2026-01-01',
        sampai: '2026-12-31',
      });
      expect(lr.totalBeban).toBe(0);
      expect(lr.laba).toBe(RP(10_000_000));
    } finally {
      db.close();
    }
  });
});

describe('T-A01 — sumber resmi cut-over_tanggal', () => {
  it('cutover_tanggal menang atas kunci lama yang basi, termasuk batas posting', () => {
    const db = openDb(':memory:');
    try {
      simpanAwal(db, '2026-07-01');
      koreksi(db, '2026-06-01');

      // Simulasikan kunci lama tertinggal di tanggal SALDO_AWAL lama.
      setPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI, '2026-07-01');

      expect(getCutoverTanggal(db)).toBe('2026-06-01');
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('2026-06-01');

      // Posting 2026-06-15 harus lolos karena batas bawah membaca cut-over
      // resmi, bukan kunci lama 2026-07-01.
      postingPendapatan(db, 'j-pendapatan-juni', '2026-06-15', RP(10_000_000));
      expect(
        laporanLabaRugi(db, { mulai: '2026-01-01', sampai: '2026-12-31' }).laba,
      ).toBe(RP(10_000_000));
    } finally {
      db.close();
    }
  });
});

describe('T-A01 — koreksi saldo awal ke tanggal lebih akhir', () => {  it('memindahkan penunjuk pembukaan + cut-over dan laporan mengikuti', () => {
    const db = openDb(':memory:');
    try {
      simpanAwal(db, '2026-07-01');
      koreksi(db, '2026-08-01', 'Geser cut-over ke awal Agustus');

      expect(getCutoverTanggal(db)).toBe('2026-08-01');
      expect(getPembukaanAktif(db)).toMatchObject({ tanggal: '2026-08-01' });
      expect(getPengaturan(db, KUNCI_CUTOVER_TANGGAL)).toBe('2026-08-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe('2026-08-01');

      postingPendapatan(db, 'j-pendapatan-september', '2026-09-15', RP(10_000_000));

      expect(
        laporanLabaRugi(db, { mulai: '2026-01-01', sampai: '2026-12-31' }).laba,
      ).toBe(RP(10_000_000));
      const n = laporanNeraca(db, '2026-12-31');
      expect(n.selisih).toBe(0);
      expect(n.balance).toBe(true);
      expect(n.totalAset).toBe(RP(110_000_000));
    } finally {
      db.close();
    }
  });
});

describe('T-A01 — pengaturan tidak boleh memindahkan cut-over manual', () => {
  it('menolak tanggal berbeda dari pembukaan aktif dan tidak menulis apa pun', () => {
    const db = openDb(':memory:');
    try {
      simpanAwal(db, '2026-07-01');
      const namaAwal = getPengaturanPembukuan(db).namaEntitas;

      expect(() =>
        simpanPengaturanPembukuan(db, {
          ...DEFAULT_PENGATURAN,
          namaEntitas: 'PURA UJI',
          tanggalMulaiPembukuan: '2026-06-01',
        }),
      ).toThrow(PESAN_TANGGAL_CUTOVER_DIKUNCI);
      expect(PESAN_TANGGAL_CUTOVER_DIKUNCI).toMatch(/Wizard Koreksi Saldo Awal/);

      // Transaksi batal: tanggal, cut-over, dan nama entitas tidak berubah.
      expect(getCutoverTanggal(db)).toBe('2026-07-01');
      expect(getPengaturan(db, KUNCI_CUTOVER_TANGGAL)).toBe('2026-07-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe('2026-07-01');
      expect(getPengaturanPembukuan(db).namaEntitas).toBe(namaAwal);

      // Mengosongkan tanggal juga merupakan perubahan manual: ditolak.
      expect(() =>
        simpanPengaturanPembukuan(db, {
          ...DEFAULT_PENGATURAN,
          tanggalMulaiPembukuan: '',
        }),
      ).toThrow(PESAN_TANGGAL_CUTOVER_DIKUNCI);
    } finally {
      db.close();
    }
  });

  it('tetap mengizinkan penyimpanan field lain bila tanggal tidak berubah', () => {
    const db = openDb(':memory:');
    try {
      simpanAwal(db, '2026-07-01');
      const hasil = simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        namaEntitas: 'PURA UJI',
        tanggalMulaiPembukuan: '2026-07-01',
      });
      expect(hasil.namaEntitas).toBe('PURA UJI');
      expect(getPengaturan(db, KUNCI_CUTOVER_TANGGAL)).toBe('2026-07-01');
      expect(getCutoverTanggal(db)).toBe('2026-07-01');
    } finally {
      db.close();
    }
  });

  it('sebelum saldo awal ada, tanggal mulai disimpan ke cutover_tanggal resmi', () => {
    const db = openDb(':memory:');
    try {
      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        tanggalMulaiPembukuan: '2026-07-01',
      });
      expect(getPengaturan(db, KUNCI_CUTOVER_TANGGAL)).toBe('2026-07-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe('2026-07-01');
      expect(getCutoverTanggal(db)).toBe('2026-07-01');

      // Belum ada pembukaan: operator masih boleh mengubah tanggal.
      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        tanggalMulaiPembukuan: '2026-06-01',
      });
      expect(getPengaturan(db, KUNCI_CUTOVER_TANGGAL)).toBe('2026-06-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe('2026-06-01');
      expect(getCutoverTanggal(db)).toBe('2026-06-01');
    } finally {
      db.close();
    }
  });
});
