// P1-6: Wizard Saldo Awal.
//
// Fokus pembuktian:
// - Satu jurnal seimbang dari saldo per akun; selisih otomatis ke 3000 MODAL.
// - Kas/bank + piutang + hutang + aset lain, baik selisih positif maupun negatif.
// - Neraca Saldo nol, Neraca seimbang, Laba Rugi & Arus Kas tetap jalan.
// - Hanya boleh sekali: status berubah dan simpan kedua/ketiga ditolak,
//   termasuk bila sudah ada jurnal balik. Tidak ada angka saldo tersimpan.
// - Audit SALDO-AWAL memuat jurnal + baris.
// - Akun pendapatan/beban/ekuitas/3000, nominal invalid, dan daftar kosong ditolak.
// - Bentuk input IPC ketat; jalur jurnal biasa tidak bisa membuat SALDO_AWAL.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { openDb } from '../src/db/database.js';
import {
  PESAN_SALDO_AWAL_SUDAH_ADA,
  simpanSaldoAwal,
  statusSaldoAwal,
} from '../src/db/saldoAwal.js';
import { postingJurnal } from '../src/db/posting.js';
import { reverseJurnal } from '../src/db/reversal.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import {
  getPengaturan,
  getPengaturanPembukuan,
  insertJurnalTervalidasi,
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  listAuditLog,
  listJurnal,
  simpanPengaturanPembukuan,
} from '../src/db/repository.js';
import { DEFAULT_PENGATURAN } from '../src/core/pengaturan.js';
import { buatJurnalSaldoAwal, type FormSaldoAwal } from '../src/core/forms.js';
import { arusKas, labaRugi, neraca, neracaSaldo, saldoAkun } from '../src/core/reports.js';
import { AKUN_MODAL, COA } from '../src/db/coa.js';
import type { JurnalBarisInput } from '../src/core/types.js';
import {
  validasiBentukJurnalInput,
  validasiBentukSaldoAwal,
} from '../src/main/validation.js';
import { SaldoAwalWizard } from '../src/renderer/components/SaldoAwalWizard.js';
import { SaldoAwalGuard } from '../src/renderer/components/SaldoAwalGuard.js';
import { TransaksiTab } from '../src/renderer/components/TransaksiTab.js';
import {
  adalahErrorSaldoAwal,
  lupakanMulaiTanpaSaldoAwal,
  opsiSaldoAwal,
  tandaiMulaiTanpaSaldoAwal,
} from '../src/renderer/lib/saldoAwal.js';

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

function total(input: { baris: JurnalBarisInput[] }): { debit: number; kredit: number } {
  return input.baris.reduce(
    (t, b) => ({ debit: t.debit + b.debit, kredit: t.kredit + b.kredit }),
    { debit: 0, kredit: 0 },
  );
}

/** Form lengkap: kas, bank, aset lain lama 1050, panjar, dan hutang. */
function formLengkap(): FormSaldoAwal {
  return {
    tanggal: '2026-01-01',
    keterangan: 'Saldo awal pembukuan 2026',
    noBukti: 'JU-2026-0000',
    id: 'j-saldo-awal',
    saldo: [
      { akun_kode: '1001', nominal: RP(5_000_000) },
      { akun_kode: '1029', nominal: RP(10_000_000) },
      { akun_kode: '1050', nominal: RP(2_000_000) },
      { akun_kode: '1040', nominal: RP(500_000) },
      { akun_kode: '2050', nominal: RP(1_000_000) },
    ],
  };
}

describe('P1-6 — builder saldo awal murni', () => {
  it('menyusun satu jurnal seimbang; selisih positif menjadi kredit 3000 MODAL', () => {
    const hasil = buatJurnalSaldoAwal(formLengkap());

    expect(hasil.totalAktiva).toBe(RP(17_500_000));
    expect(hasil.totalKewajiban).toBe(RP(1_000_000));
    expect(hasil.selisih).toBe(RP(16_500_000));
    expect(hasil.akunModal).toBe(AKUN_MODAL);
    expect(hasil.input.header).toMatchObject({
      id: 'j-saldo-awal',
      tanggal: '2026-01-01',
      no_bukti: 'JU-2026-0000',
      keterangan: 'Saldo awal pembukuan 2026',
      jenis: 'SALDO_AWAL',
    });
    expect(hasil.input.baris).toEqual([
      D('1001', RP(5_000_000)),
      D('1029', RP(10_000_000)),
      D('1050', RP(2_000_000)),
      D('1040', RP(500_000)),
      K('2050', RP(1_000_000)),
      K(AKUN_MODAL, RP(16_500_000)),
    ]);

    const jumlah = total(hasil.input);
    expect(jumlah.debit).toBe(jumlah.kredit);
    expect(jumlah.debit).toBe(RP(17_500_000));
  });

  it('selisih negatif menjadi debit 3000 MODAL dan tanpa modal bila sudah sama', () => {
    // Kas + aset lain lama 1050 + panjar + hutang, dengan kewajiban lebih besar.
    const negatif = buatJurnalSaldoAwal({
      tanggal: '2026-01-01',
      saldo: [
        { akun_kode: '1001', nominal: RP(1_000_000) },
        { akun_kode: '1050', nominal: RP(500_000) },
        { akun_kode: '1040', nominal: RP(500_000) },
        { akun_kode: '2050', nominal: RP(4_000_000) },
      ],
    });
    expect(negatif.totalAktiva).toBe(RP(2_000_000));
    expect(negatif.totalKewajiban).toBe(RP(4_000_000));
    expect(negatif.selisih).toBe(-RP(2_000_000));
    expect(negatif.input.baris).toEqual([
      D('1001', RP(1_000_000)),
      D('1050', RP(500_000)),
      D('1040', RP(500_000)),
      K('2050', RP(4_000_000)),
      D(AKUN_MODAL, RP(2_000_000)),
    ]);
    expect(total(negatif.input)).toEqual({
      debit: RP(4_000_000),
      kredit: RP(4_000_000),
    });

    const pas = buatJurnalSaldoAwal({
      tanggal: '2026-01-01',
      saldo: [
        { akun_kode: '1001', nominal: RP(1_000_000) },
        { akun_kode: '2050', nominal: RP(1_000_000) },
      ],
    });
    expect(pas.selisih).toBe(0);
    expect(pas.input.baris).toEqual([
      D('1001', RP(1_000_000)),
      K('2050', RP(1_000_000)),
    ]);
    expect(pas.input.baris.some((b) => b.akun_kode === AKUN_MODAL)).toBe(false);
  });

  it('mengabaikan baris 0 dan menggabungkan akun ganda agar jurnal rapi', () => {
    const hasil = buatJurnalSaldoAwal({
      tanggal: '2026-01-01',
      saldo: [
        { akun_kode: '1001', nominal: RP(1_000_000) },
        { akun_kode: ' 1001 ', nominal: RP(500_000) },
        { akun_kode: '1029', nominal: 0 },
      ],
    });
    expect(hasil.input.baris).toEqual([
      D('1001', RP(1_500_000)),
      K(AKUN_MODAL, RP(1_500_000)),
    ]);
  });

  it('menolak akun pendapatan/beban/ekuitas/3000, nominal invalid, dan daftar kosong', () => {
    const dasar = { tanggal: '2026-01-01' };
    expect(() => buatJurnalSaldoAwal({ ...dasar, saldo: [] })).toThrow(/kosong/);
    expect(() =>
      buatJurnalSaldoAwal({ ...dasar, saldo: [{ akun_kode: '1001', nominal: 0 }] }),
    ).toThrow(/nominal lebih dari 0/);

    for (const kode of ['4005', '5000', '3001']) {
      expect(() =>
        buatJurnalSaldoAwal({
          ...dasar,
          saldo: [{ akun_kode: kode, nominal: RP(100_000) }],
        }),
      ).toThrow(/AKTIVA atau KEWAJIBAN/);
    }
    expect(() =>
      buatJurnalSaldoAwal({
        ...dasar,
        saldo: [{ akun_kode: '3000', nominal: RP(100_000) }],
      }),
    ).toThrow(/3000 MODAL/);
    expect(() =>
      buatJurnalSaldoAwal({
        ...dasar,
        saldo: [{ akun_kode: '9999', nominal: RP(100_000) }],
      }),
    ).toThrow(/tidak dikenal/);

    for (const nominal of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        buatJurnalSaldoAwal({
          ...dasar,
          saldo: [{ akun_kode: '1001', nominal }],
        }),
      ).toThrow(/Nominal/);
    }

    expect(() =>
      buatJurnalSaldoAwal({
        tanggal: '2026-02-31',
        saldo: [{ akun_kode: '1001', nominal: RP(100_000) }],
      }),
    ).toThrow(/Tanggal/);
    expect(() =>
      buatJurnalSaldoAwal({
        ...dasar,
        saldo: [{ akun_kode: '  ', nominal: RP(100_000) }],
      }),
    ).toThrow(/wajib dipilih/);
  });
});

describe('P1-6 — adapter DB & status sekali pakai', () => {
  it('menyimpan satu jurnal, Neraca Saldo nol, laporan jalan, audit SALDO-AWAL tercatat', () => {
    const db = openDb(':memory:');
    try {
      expect(statusSaldoAwal(db)).toEqual({ boleh: true, jumlahJurnal: 0 });

      const preview = buatJurnalSaldoAwal(formLengkap());
      const hasil = simpanSaldoAwal(db, preview.input);
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.errors).toEqual([]);
      expect(hasil.jurnal?.jenis).toBe('SALDO_AWAL');
      expect(hasil.jurnal?.id).toBe('j-saldo-awal');

      const daftar = listJurnal(db);
      expect(daftar).toHaveLength(1);
      expect(daftar[0]!.jenis).toBe('SALDO_AWAL');
      // Tidak ada tabel saldo: angka hanya ada di jurnal_baris.
      const tabelSaldo = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND lower(name) LIKE '%saldo%'",
        )
        .all() as { name: string }[];
      expect(tabelSaldo).toEqual([]);

      const status = statusSaldoAwal(db);
      expect(status.boleh).toBe(false);
      expect(status.jumlahJurnal).toBe(1);
      expect(status.alasan).toBe(PESAN_SALDO_AWAL_SUDAH_ADA);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1001')).toBe(RP(5_000_000));
      expect(saldoAkun(baris, '1029')).toBe(RP(10_000_000));
      expect(saldoAkun(baris, '1050')).toBe(RP(2_000_000));
      expect(saldoAkun(baris, '1040')).toBe(RP(500_000));
      expect(saldoAkun(baris, '2050')).toBe(RP(1_000_000));
      expect(saldoAkun(baris, AKUN_MODAL)).toBe(RP(16_500_000));

      const ns = neracaSaldo(baris, '2026-12-31');
      expect(ns.selisih).toBe(0);
      expect(ns.seimbang).toBe(true);
      expect(ns.totalDebit).toBe(ns.totalKredit);

      const n = neraca(baris, { cutoff: '2026-12-31', tutup: [] });
      expect(n.balance).toBe(true);
      expect(n.selisih).toBe(0);
      expect(n.totalAset).toBe(n.totalPasiva);
      expect(n.totalAset).toBe(RP(17_500_000));

      const lr = labaRugi(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });
      expect(lr.totalPendapatan).toBe(0);
      expect(lr.totalBeban).toBe(0);
      expect(lr.laba).toBe(0);

      const ak = arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });
      expect(ak.saldoAwal).toBe(0);
      expect(ak.saldoAkhir).toBe(RP(15_000_000)); // 1001 + 1029; 1040 bukan dompet
      expect(ak.kenaikan).toBe(RP(15_000_000));

      const audit = listAuditLog(db, { aksi: 'SALDO-AWAL' });
      expect(audit).toHaveLength(1);
      expect(audit[0]!.aksi).toBe('SALDO-AWAL j-saldo-awal');
      const baru = JSON.parse(audit[0]!.data_baru_json) as {
        jurnal: { id: string; jenis: string };
        baris: unknown[];
      };
      expect(baru.jurnal.id).toBe('j-saldo-awal');
      expect(baru.jurnal.jenis).toBe('SALDO_AWAL');
      expect(baru.baris).toHaveLength(preview.input.baris.length);
    } finally {
      db.close();
    }
  });

  it('selisih negatif (debit 3000 MODAL) tetap Neraca Saldo nol dan Neraca seimbang', () => {
    const db = openDb(':memory:');
    try {
      const preview = buatJurnalSaldoAwal({
        tanggal: '2026-01-01',
        saldo: [
          { akun_kode: '1001', nominal: RP(1_000_000) },
          { akun_kode: '1050', nominal: RP(500_000) },
          { akun_kode: '2050', nominal: RP(4_000_000) },
        ],
      });
      expect(preview.selisih).toBe(-RP(2_500_000));
      expect(preview.input.baris).toContainEqual(D(AKUN_MODAL, RP(2_500_000)));

      const hasil = simpanSaldoAwal(db, preview.input);
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, AKUN_MODAL)).toBe(-RP(2_500_000));
      expect(neracaSaldo(baris, '2026-12-31').selisih).toBe(0);
      const n = neraca(baris, { cutoff: '2026-12-31', tutup: [] });
      expect(n.balance).toBe(true);
      expect(n.selisih).toBe(0);
      expect(n.totalAset).toBe(RP(1_500_000));
      expect(n.totalPasiva).toBe(RP(1_500_000));
    } finally {
      db.close();
    }
  });

  it('menolak dijalankan dua kali; status tetap "sudah ada jurnal"', () => {
    const db = openDb(':memory:');
    try {
      const pertama = simpanSaldoAwal(db, buatJurnalSaldoAwal(formLengkap()).input);
      expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);

      const kedua = simpanSaldoAwal(
        db,
        buatJurnalSaldoAwal({
          id: 'j-saldo-awal-2',
          tanggal: '2026-01-01',
          saldo: [{ akun_kode: '1001', nominal: RP(99_000_000) }],
        }).input,
      );
      expect(kedua.tersimpan).toBe(false);
      expect(kedua.errors.join(' ')).toMatch(/belum ada jurnal/);

      expect(listJurnal(db)).toHaveLength(1);
      expect(listAuditLog(db, { aksi: 'SALDO-AWAL' })).toHaveLength(1);
      expect(statusSaldoAwal(db)).toMatchObject({
        boleh: false,
        jumlahJurnal: 1,
        alasan: PESAN_SALDO_AWAL_SUDAH_ADA,
      });
    } finally {
      db.close();
    }
  });

  it('menolak bila sudah ada jurnal biasa/balik meski bukan buatan wizard', () => {
    const db = openDb(':memory:');
    try {
      insertJurnalTervalidasi(
        db,
        {
          id: 'j-lama',
          tanggal: '2026-01-01',
          no_bukti: 'JU-LAMA',
          keterangan: 'Jurnal lama',
        },
        [D('1001', RP(1_000_000)), K(AKUN_MODAL, RP(1_000_000))],
      );
      expect(statusSaldoAwal(db).boleh).toBe(false);

      const sebelumBalik = simpanSaldoAwal(
        db,
        buatJurnalSaldoAwal({
          tanggal: '2026-01-01',
          saldo: [{ akun_kode: '1001', nominal: RP(2_000_000) }],
        }).input,
      );
      expect(sebelumBalik.tersimpan).toBe(false);

      const balik = reverseJurnal(db, 'j-lama', 'Uji jurnal balik', {
        id: 'j-lama-balik',
        tanggal: '2026-01-02',
      });
      expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);
      expect(statusSaldoAwal(db).boleh).toBe(false);

      const sesudahBalik = simpanSaldoAwal(
        db,
        buatJurnalSaldoAwal({
          id: 'j-saldo-awal-3',
          tanggal: '2026-01-01',
          saldo: [{ akun_kode: '1001', nominal: RP(3_000_000) }],
        }).input,
      );
      expect(sesudahBalik.tersimpan).toBe(false);
      expect(listJurnal(db)).toHaveLength(2); // jurnal lama + balik, bukan saldo awal baru
    } finally {
      db.close();
    }
  });

  it('jurnal biasa setelah saldo awal tidak bisa membuat saldo awal lagi', () => {
    const db = openDb(':memory:');
    try {
      const awal = simpanSaldoAwal(db, buatJurnalSaldoAwal(formLengkap()).input);
      expect(awal.tersimpan).toBe(true);

      const harian = postingJurnal(db, {
        header: {
          id: 'j-harian',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Pendapatan parkir',
          jenis: 'TERIMA',
        },
        baris: [D('1001', RP(100_000)), K('4005', RP(100_000))],
      });
      expect(harian.tersimpan, harian.errors.join(' ')).toBe(true);

      expect(statusSaldoAwal(db)).toMatchObject({ boleh: false, jumlahJurnal: 2 });
      const lagi = simpanSaldoAwal(
        db,
        buatJurnalSaldoAwal({
          id: 'j-saldo-awal-4',
          tanggal: '2026-01-01',
          saldo: [{ akun_kode: '1001', nominal: RP(1_000) }],
        }).input,
      );
      expect(lagi.tersimpan).toBe(false);
      expect(listJurnal(db)).toHaveLength(2);
    } finally {
      db.close();
    }
  });
});

describe('AKT-03 — saldo awal menjadi tanggal mulai pembukuan', () => {
  it('menulis setting dalam transaksi yang sama dan menolak jurnal sebelum tanggal saldo awal', () => {
    const db = openDb(':memory:');
    try {
      const preview = buatJurnalSaldoAwal({
        id: 'j-awal-2025',
        tanggal: '2025-01-01',
        keterangan: 'Saldo awal pembukuan 2025',
        noBukti: 'SA-2025-0001',
        saldo: [{ akun_kode: '1001', nominal: RP(5_000_000) }],
      });
      const hasil = simpanSaldoAwal(db, preview.input);
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('2025-01-01');
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe('2025-01-01');

      const ditolak = postingJurnal(db, {
        header: {
          id: 'j-sebelum',
          tanggal: '2024-12-31',
          no_bukti: 'JU-2024-0001',
          keterangan: 'Jurnal sebelum saldo awal',
          jenis: 'UMUM',
        },
        baris: [D('1001', RP(100_000)), K('4005', RP(100_000))],
      });
      expect(ditolak.tersimpan).toBe(false);
      expect(ditolak.errors).toContain(
        'Tanggal jurnal sebelum tanggal mulai pembukuan (2025-01-01).',
      );
      expect(listJurnal(db)).toHaveLength(1);

      const diterima = postingJurnal(db, {
        header: {
          id: 'j-tepat',
          tanggal: '2025-01-01',
          no_bukti: 'JU-2025-0001',
          keterangan: 'Jurnal tepat pada tanggal mulai',
          jenis: 'UMUM',
        },
        baris: [D('1001', RP(100_000)), K('4005', RP(100_000))],
      });
      expect(diterima.tersimpan, diterima.errors.join(' ')).toBe(true);
      expect(listJurnal(db)).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('SALDO_AWAL bertanggal lain dikecualikan dari batas dan memperbarui setting', () => {
    const db = openDb(':memory:');
    try {
      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        tanggalMulaiPembukuan: '2025-01-01',
      });

      const hasil = simpanSaldoAwal(
        db,
        buatJurnalSaldoAwal({
          id: 'j-awal-2024',
          tanggal: '2024-12-31',
          keterangan: 'Saldo awal pembukuan 2024',
          noBukti: 'SA-2024-0001',
          saldo: [{ akun_kode: '1001', nominal: RP(3_000_000) }],
        }).input,
      );
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.jurnal?.tanggal).toBe('2024-12-31');
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('2024-12-31');
    } finally {
      db.close();
    }
  });
});

describe('P1-6 — validasi bentuk input IPC & UI', () => {
  it('menormalisasi form wizard dan menolak bentuk mentah/nominal invalid', () => {
    const valid = validasiBentukSaldoAwal({
      tanggal: '2026-01-01',
      saldo: [
        { akun_kode: '1001', nominal: RP(1_000_000) },
        { akun_kode: '2050', nominal: 0 },
      ],
      keterangan: '  Saldo awal  ',
      noBukti: '  JU-2026-0000  ',
      alasan: '  mulai pembukuan  ',
      ekstra: 'diabaikan',
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.input).toMatchObject({
      tanggal: '2026-01-01',
      keterangan: 'Saldo awal',
      noBukti: 'JU-2026-0000',
      alasan: 'mulai pembukuan',
    });
    expect(valid.input.saldo).toHaveLength(2);

    expect(validasiBentukSaldoAwal(null).ok).toBe(false);
    expect(validasiBentukSaldoAwal({}).ok).toBe(false);
    expect(validasiBentukSaldoAwal({ tanggal: '2026-01-01' }).ok).toBe(false);
    expect(
      validasiBentukSaldoAwal({ tanggal: '2026-01-01', saldo: [] }).ok,
    ).toBe(false);
    expect(
      validasiBentukSaldoAwal({
        tanggal: '2026-01-01',
        saldo: [{ akun_kode: '  ', nominal: RP(1_000) }],
      }).ok,
    ).toBe(false);
    for (const nominal of [-1, 1.5, Number.NaN]) {
      expect(
        validasiBentukSaldoAwal({
          tanggal: '2026-01-01',
          saldo: [{ akun_kode: '1001', nominal }],
        }).ok,
      ).toBe(false);
    }
  });

  it('menolak SALDO_AWAL lewat jalur jurnal biasa (harus lewat wizard)', () => {
    const hasil = validasiBentukJurnalInput({
      header: {
        id: 'j-awal',
        tanggal: '2026-01-01',
        keterangan: 'Saldo awal',
        jenis: 'SALDO_AWAL',
      },
      baris: [D('1001', RP(1_000_000)), K(AKUN_MODAL, RP(1_000_000))],
    });
    expect(hasil.ok).toBe(false);
    if (!hasil.ok) expect(hasil.error).toMatch(/Wizard Saldo Awal/);
  });

  it('merender wizard: akun relevan, ringkasan selisih, pratinjau, dan tombol simpan', () => {
    const html = renderToStaticMarkup(
      createElement(SaldoAwalWizard, {
        coa: COA,
        onClose: () => undefined,
        onSukses: () => undefined,
      }),
    );

    expect(html).toContain('Wizard Saldo Awal');
    expect(html).toContain('Tanggal mulai pembukuan');
    expect(html).toContain('Saldo per akun');
    expect(html).toContain('Kas / Bank');
    expect(html).toContain('Aset lain');
    expect(html).not.toContain('Piutang &amp; aset lain');
    expect(html).toContain('Hutang');
    expect(html).toContain('Saldo (Rp)');
    expect(html).toContain('Pratinjau Jurnal');
    expect(html).toContain('Simpan Saldo Awal');
    // Hanya akun relevan yang muncul (kas, panjar/aset lain lama, hutang).
    expect(html).toContain('1001 — KAS');
    expect(html).toContain('1040 — UANG PANJAR');
    expect(html).toContain('1050 — PIUTANG LAIN LAIN');
    expect(html).toContain('2050 — HUTANG LAIN-LAIN');
    // Operator tidak perlu melihat akun laba/rugi/modal di wizard saldo awal.
    expect(html).not.toContain('PENDAPATAN PARKIR');
    expect(html).not.toContain('BAGA SUAR');
    expect(html).not.toContain('3000 — MODAL');
  });

  it('layar Transaksi menampilkan tombol wizard dan status awal', () => {
    const html = renderToStaticMarkup(
      createElement(TransaksiTab, { onBukaTab: () => {} }),
    );
    expect(html).toContain('Saldo Awal Pembukuan');
    expect(html).toContain('Wizard Saldo Awal');
    expect(html).toContain('Memeriksa status jurnal');
    const tombol = html
      .split('<button')
      .find((s) => s.includes('>Wizard Saldo Awal</button>'));
    expect(tombol).toBeDefined();
    // SSR belum menjalankan efek IPC → status belum diketahui, tombol aman disabled.
    expect(tombol).toContain('disabled');
  });
});

describe('AKT-02 — modal guard saldo awal', () => {
  it('menampilkan pesan dan dua pilihan saat jurnal pertama ditolak backend', () => {
    const html = renderToStaticMarkup(
      createElement(SaldoAwalGuard, {
        terbuka: true,
        onBatal: () => undefined,
        onMulaiTanpa: () => undefined,
        onSaldoAwalTersimpan: () => undefined,
      }),
    );

    expect(html).toContain(
      'Belum ada saldo awal. Isi saldo awal dulu, atau mulai tanpa saldo awal.',
    );
    expect(html).toContain('Isi Saldo Awal');
    expect(html).toContain('Mulai tanpa saldo awal');
    expect(html).toContain('Batal');
  });

  it('tidak merender modal saat tertutup', () => {
    const html = renderToStaticMarkup(
      createElement(SaldoAwalGuard, {
        terbuka: false,
        onBatal: () => undefined,
        onMulaiTanpa: () => undefined,
        onSaldoAwalTersimpan: () => undefined,
      }),
    );
    expect(html).toBe('');
  });

  it('mendeteksi error backend dan meneruskan flag sesi ke opsi IPC', () => {
    lupakanMulaiTanpaSaldoAwal();
    expect(adalahErrorSaldoAwal(new Error('Belum ada saldo awal. Isi dulu.'))).toBe(
      true,
    );
    expect(adalahErrorSaldoAwal(new Error('Jurnal tidak seimbang'))).toBe(false);
    expect(opsiSaldoAwal()).toEqual({
      wajibSaldoAwal: true,
      konfirmasiTanpaSaldoAwal: false,
    });

    tandaiMulaiTanpaSaldoAwal();
    // Pilihan tersimpan untuk sesi: form berikutnya tidak menampilkan modal lagi.
    expect(opsiSaldoAwal()).toEqual({
      wajibSaldoAwal: true,
      konfirmasiTanpaSaldoAwal: true,
    });

    lupakanMulaiTanpaSaldoAwal();
    expect(opsiSaldoAwal().konfirmasiTanpaSaldoAwal).toBe(false);
  });
});
