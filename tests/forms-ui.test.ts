// P1-1/P1-2/P1-3: kontrak builder form terpandu yang dipakai layar Transaksi.
// Fokus: akun kas/pendapatan/modal (Terima), akun beban (Bayar),
// perpindahan antar dompet kas/bank (Pindah Dana), nominal SEN, pratinjau
// seimbang, serta bentuk input IPC yang tidak boleh dipercaya mentah-mentah.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AKUN_MODAL,
  AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF,
  COA,
  KAS_KODES,
  type Coa,
} from '../src/db/coa.js';
import {
  buatJurnalBayar,
  buatJurnalPindahDana,
  buatJurnalTerimaUang,
  type FormBayar,
  type FormPindahDana,
  type FormTerimaUang,
} from '../src/core/forms.js';
import {
  validasiJurnal,
  type AkunPosting,
  type JurnalInput,
  type PostingContext,
} from '../src/core/posting.js';
import { validasiBentukJurnalInput, validasiBentukTransaksiInput } from '../src/main/validation.js';
import { openDb } from '../src/db/database.js';
import { postingJurnal } from '../src/db/posting.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { neracaSaldo, saldoAkun, totalKas } from '../src/core/reports.js';
import {
  labelTombolSaldoAwal,
  modeTombolSaldoAwal,
  TransaksiTab,
} from '../src/renderer/components/TransaksiTab.js';
import { FormTransaksiTerpandu } from '../src/renderer/components/TransaksiForm.js';
import { KonfirmasiModal } from '../src/renderer/components/ui.js';
import { SaldoAwalWizard } from '../src/renderer/components/SaldoAwalWizard.js';
import { akunBolehDinonaktifkan } from '../src/renderer/components/AkunTab.js';

const RP = (rupiah: number): number => rupiah * 100;
const AKUN: AkunPosting[] = COA.map((a) => ({ ...a, aktif: true }));

function konteks(over: Partial<PostingContext> = {}): PostingContext {
  return {
    akun: AKUN,
    tutupBuku: [],
    noBuktiTerpakai: [],
    saldoKas: {},
    ...over,
  };
}

function total(input: JurnalInput): { debit: number; kredit: number } {
  return input.baris.reduce(
    (t, b) => ({ debit: t.debit + b.debit, kredit: t.kredit + b.kredit }),
    { debit: 0, kredit: 0 },
  );
}

function dasar(over: Partial<FormTerimaUang> = {}): FormTerimaUang {
  return {
    tanggal: '2026-10-22',
    akunKas: '1001',
    akunLawan: '4005',
    nominal: RP(150_000),
    keterangan: 'Pendapatan parkir',
    ...over,
  };
}

describe('P1-1 — builder Terima Uang untuk form terpandu', () => {
  it('menyusun D kas / K pendapatan dan pratinjau totalnya seimbang', () => {
    const input = buatJurnalTerimaUang(
      dasar({ noBukti: '  JU-2026-0001  ' }),
    );

    expect(input.header).toMatchObject({
      tanggal: '2026-10-22',
      keterangan: 'Pendapatan parkir',
      jenis: 'TERIMA',
      no_bukti: 'JU-2026-0001',
    });
    expect(input.header.id).toBeTruthy();
    expect(input.baris).toEqual([
      { akun_kode: '1001', debit: RP(150_000), kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: RP(150_000) },
    ]);

    const jumlah = total(input);
    expect(jumlah.debit).toBe(RP(150_000));
    expect(jumlah.kredit).toBe(RP(150_000));
    expect(jumlah.debit).toBe(jumlah.kredit);

    const validasi = validasiJurnal(input, konteks({ saldoKas: { '1001': 0 } }));
    expect(validasi.errors).toEqual([]);
    expect(validasi.boleh).toBe(true);
  });

  it('menerima setoran modal 3000 sebagai sumber uang', () => {
    const input = buatJurnalTerimaUang(
      dasar({
        akunKas: '1029',
        akunLawan: AKUN_MODAL,
        nominal: RP(2_000_000),
        keterangan: 'Setoran modal pura',
      }),
    );

    expect(input.header.jenis).toBe('TERIMA');
    expect(input.baris).toEqual([
      { akun_kode: '1029', debit: RP(2_000_000), kredit: 0 },
      { akun_kode: AKUN_MODAL, debit: 0, kredit: RP(2_000_000) },
    ]);
    expect(total(input)).toEqual({ debit: RP(2_000_000), kredit: RP(2_000_000) });
    expect(validasiJurnal(input, konteks()).boleh).toBe(true);
  });

  it('menolak akun kas sebagai sumber uang dan nominal yang tidak valid', () => {
    // Pendapatan / modal saja; kas, panjar, dan beban bukan sumber Terima Uang.
    expect(() => buatJurnalTerimaUang(dasar({ akunLawan: '1029' }))).toThrow(
      /pendapatan atau 3000 MODAL/,
    );
    expect(() => buatJurnalTerimaUang(dasar({ akunLawan: '1040' }))).toThrow(
      /pendapatan atau 3000 MODAL/,
    );
    expect(() => buatJurnalTerimaUang(dasar({ akunLawan: '5000' }))).toThrow(
      /pendapatan atau 3000 MODAL/,
    );
    expect(() => buatJurnalTerimaUang(dasar({ akunKas: '4005' }))).toThrow(/kas\/bank/);
    expect(() => buatJurnalTerimaUang(dasar({ nominal: 0 }))).toThrow(/Nominal/);
    expect(() => buatJurnalTerimaUang(dasar({ nominal: -1 }))).toThrow(/Nominal/);
    expect(() => buatJurnalTerimaUang(dasar({ nominal: 1.5 }))).toThrow(/Nominal/);
    expect(() => buatJurnalTerimaUang(dasar({ keterangan: '   ' }))).toThrow(/Keterangan/);

    // Nomor bukti opsional: spasi saja tidak disimpan sebagai nomor.
    const tanpaBukti = buatJurnalTerimaUang(dasar({ noBukti: '   ' }));
    expect(tanpaBukti.header.no_bukti).toBeUndefined();

    // Alasan kunci periode diteruskan apa adanya ke posting layer.
    const denganAlasan = buatJurnalTerimaUang(
      dasar({ alasan: 'Koreksi struk susulan', noBukti: 'JU-2026-0009' }),
    );
    expect(denganAlasan.alasan).toBe('Koreksi struk susulan');
  });
});

describe('P1-1 — validasi bentuk input jurnal dari renderer', () => {
  const valid = {
    header: {
      id: 'j-form-1',
      tanggal: '2026-10-22',
      keterangan: 'Pendapatan parkir',
      no_bukti: 'JU-2026-0001',
      jenis: 'UMUM',
    },
    baris: [
      { akun_kode: '1001', debit: RP(150_000), kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: RP(150_000) },
    ],
  };

  it('menerima bentuk lengkap dan menormalisasi field opsional', () => {
    const hasil = validasiBentukJurnalInput({
      ...valid,
      header: { ...valid.header, no_bukti: '  JU-2026-0001  ', grup_id: 'diabaikan' },
      alasan: '  alasan uji  ',
      extra: 'diabaikan',
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect(hasil.input.header).toMatchObject({
      id: 'j-form-1',
      tanggal: '2026-10-22',
      keterangan: 'Pendapatan parkir',
      no_bukti: 'JU-2026-0001',
      jenis: 'UMUM',
    });
    expect(hasil.input.alasan).toBe('alasan uji');
    expect(hasil.input.header).not.toHaveProperty('grup_id');
    expect(hasil.input.baris).toHaveLength(2);
  });

  it('menolak objek mentah, baris tidak lengkap, dan nominal bukan integer', () => {
    expect(validasiBentukJurnalInput(null).ok).toBe(false);
    expect(validasiBentukJurnalInput({}).ok).toBe(false);
    expect(validasiBentukJurnalInput({ header: {}, baris: [] }).ok).toBe(false);
    expect(
      validasiBentukJurnalInput({ header: valid.header, baris: 'bukan-array' }).ok,
    ).toBe(false);
    expect(
      validasiBentukJurnalInput({
        header: valid.header,
        baris: [valid.baris[0]],
      }).ok,
    ).toBe(false);
    expect(
      validasiBentukJurnalInput({
        ...valid,
        baris: [valid.baris[0], { ...valid.baris[1], debit: 1.5, kredit: 0 }],
      }).ok,
    ).toBe(false);
    expect(
      validasiBentukJurnalInput({
        ...valid,
        baris: [
          valid.baris[0],
          { ...valid.baris[1], akun_kode: '   ' },
        ],
      }).ok,
    ).toBe(false);
  });

  it('menolak jalur jurnal balik lewat simpan biasa', () => {
    const reversal = validasiBentukJurnalInput({
      ...valid,
      header: { ...valid.header, reversal_of: 'j-lama' },
    });
    expect(reversal.ok).toBe(false);
    if (!reversal.ok) expect(reversal.error).toMatch(/menu Koreksi/);

    const jenisReversal = validasiBentukJurnalInput({
      ...valid,
      header: { ...valid.header, jenis: 'REVERSAL' },
    });
    expect(jenisReversal.ok).toBe(false);
    if (!jenisReversal.ok) expect(jenisReversal.error).toMatch(/menu Koreksi/);
  });

  it('DB-03: manual hanya menerima UMUM; transaksi terpandu memakai validator sendiri', () => {
    for (const jenis of [
      'PANJAR',
      'PIUTANG',
      'HUTANG',
      'TERIMA',
      'BAYAR',
      'TRANSFER',
      'SALDO_AWAL',
    ] as const) {
      const manual = validasiBentukJurnalInput({
        ...valid,
        header: { ...valid.header, jenis },
      });
      expect(manual.ok, jenis).toBe(false);
      if (!manual.ok) expect(manual.error).toMatch(/hanya menerima jenis UMUM/i);
    }

    for (const jenis of ['TERIMA', 'BAYAR', 'TRANSFER', 'HUTANG'] as const) {
      const terpandu = validasiBentukTransaksiInput({
        ...valid,
        header: { ...valid.header, jenis },
      });
      expect(terpandu.ok, jenis).toBe(true);
      if (terpandu.ok) expect(terpandu.input.header.jenis).toBe(jenis);
    }

    for (const jenis of ['UMUM', 'PANJAR', 'PIUTANG', 'REVERSAL', 'SALDO_AWAL'] as const) {
      const terpandu = validasiBentukTransaksiInput({
        ...valid,
        header: { ...valid.header, jenis },
      });
      expect(terpandu.ok, jenis).toBe(false);
    }
  });
});

describe('P1-1 — layar Transaksi', () => {
  it('merender header ramah, kartu Terima Uang aktif, dan pintasan menu lain', () => {
    // Smoke render tanpa Electron: efek IPC tidak berjalan di server render,
    // jadi yang diperiksa adalah struktur layar awal.
    const html = renderToStaticMarkup(
      createElement(TransaksiTab, { onBukaTab: () => {} }),
    );

    expect(html).toContain('Catat Transaksi Harian');
    expect(html).toContain('Terima Uang');
    expect(html).toContain('Pratinjau Jurnal (untuk diperiksa)');
    expect(html).not.toContain('Segera hadir');
    expect(html).not.toContain('Jenis lain menyusul');
    expect(html).toContain('Buka Buku Panjar');
    for (const label of [
      'Bayar',
      'Pindah Dana',
      'Catat Utang',
      'Bayar Utang',
      'Panjar',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Buka Hutang');
    expect(html).not.toContain('Piutang/Hutang');
    expect(html).not.toContain('Buka Piutang');
  });
});

function dasarBayar(over: Partial<FormBayar> = {}): FormBayar {
  return {
    tanggal: '2026-10-22',
    akunKas: '1001',
    akunLawan: '5010',
    nominal: RP(75_000),
    keterangan: 'Bayar listrik bulan Oktober',
    ...over,
  };
}

describe('P1-2 — builder Bayar/Beban untuk form terpandu', () => {
  it('menyusun D beban / K kas, total seimbang, dan lolos validasiJurnal', () => {
    const input = buatJurnalBayar(
      dasarBayar({ noBukti: '  JU-2026-0002  ' }),
    );

    expect(input.header).toMatchObject({
      tanggal: '2026-10-22',
      keterangan: 'Bayar listrik bulan Oktober',
      jenis: 'BAYAR',
      no_bukti: 'JU-2026-0002',
    });
    expect(input.header.id).toBeTruthy();
    expect(input.baris).toEqual([
      { akun_kode: '5010', debit: RP(75_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(75_000) },
    ]);

    const jumlah = total(input);
    expect(jumlah).toEqual({ debit: RP(75_000), kredit: RP(75_000) });
    expect(jumlah.debit).toBe(jumlah.kredit);

    const validasi = validasiJurnal(
      input,
      konteks({ saldoKas: { '1001': RP(500_000) } }),
    );
    expect(validasi.errors).toEqual([]);
    expect(validasi.boleh).toBe(true);
  });

  it('menolak lawan panjar 1040, aset lain 1050, hutang 2050, dan utang usaha 2060 di form Bayar', () => {
    // Akun-akun ini punya alur/dokumen sendiri; form Bayar terpandu tidak boleh
    // membuat jurnal tanpa dokumen panjar atau tanpa pihak.
    for (const akun of ['1040', '2050', '2060']) {
      expect(() => buatJurnalBayar(dasarBayar({ akunLawan: akun }))).toThrow(
        /tidak bisa dipakai di form Bayar terpandu/,
      );
      expect(() => buatJurnalBayar(dasarBayar({ akunLawan: akun }))).toThrow(
        /Buku Panjar.*Catat Utang/,
      );
    }
    // 1050 hanya aset lain lama; alur piutang sudah dihapus.
    expect(() => buatJurnalBayar(dasarBayar({ akunLawan: '1050' }))).toThrow(
      /aset lain lama/i,
    );
    expect(() => buatJurnalBayar(dasarBayar({ akunLawan: '1050' }))).toThrow(
      /alur piutang sudah dihapus/i,
    );
  });

  it('tetap menerima akun beban lain, mis. 5000 BIAYA KESEKRETARIATAN', () => {
    const input = buatJurnalBayar(
      dasarBayar({
        akunLawan: '5000',
        nominal: RP(1_250_000),
        keterangan: 'Beli alat tulis',
      }),
    );

    expect(input.header.jenis).toBe('BAYAR');
    expect(input.baris).toEqual([
      { akun_kode: '5000', debit: RP(1_250_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(1_250_000) },
    ]);
    expect(total(input)).toEqual({
      debit: RP(1_250_000),
      kredit: RP(1_250_000),
    });
    expect(
      validasiJurnal(input, konteks({ saldoKas: { '1001': RP(2_000_000) } })).boleh,
    ).toBe(true);
  });

  it('menolak lawan akun kas, akun tak dikenal, tanggal, dan nominal tidak valid', () => {
    // Pindah uang antar kas/bank bukan "Bayar" — arahkan ke form Pindah Dana.
    expect(() => buatJurnalBayar(dasarBayar({ akunLawan: '1029' }))).toThrow(
      /Pindah Dana/,
    );
    expect(() => buatJurnalBayar(dasarBayar({ akunLawan: '1001' }))).toThrow(
      /Pindah Dana/,
    );
    // Kas sumber wajib akun kas/bank.
    expect(() => buatJurnalBayar(dasarBayar({ akunKas: '5010' }))).toThrow(/kas\/bank/);
    expect(() => buatJurnalBayar(dasarBayar({ akunLawan: '9999' }))).toThrow(
      /tidak dikenal/,
    );

    expect(() => buatJurnalBayar(dasarBayar({ nominal: 0 }))).toThrow(/Nominal/);
    expect(() => buatJurnalBayar(dasarBayar({ nominal: -1 }))).toThrow(/Nominal/);
    expect(() => buatJurnalBayar(dasarBayar({ nominal: 1.5 }))).toThrow(/Nominal/);
    expect(() => buatJurnalBayar(dasarBayar({ nominal: Number.NaN }))).toThrow(
      /Nominal/,
    );
    expect(() => buatJurnalBayar(dasarBayar({ tanggal: '2026-02-31' }))).toThrow(
      /Tanggal/,
    );
    expect(() => buatJurnalBayar(dasarBayar({ keterangan: '   ' }))).toThrow(
      /Keterangan/,
    );

    // Nomor bukti opsional: spasi saja tidak disimpan sebagai nomor.
    expect(
      buatJurnalBayar(dasarBayar({ noBukti: '   ' })).header.no_bukti,
    ).toBeUndefined();
  });

  it('memberi peringatan kas minus dan tetap menolak jurnal tidak seimbang', () => {
    const input = buatJurnalBayar(dasarBayar({ nominal: RP(150_000) }));
    const peringatan = validasiJurnal(
      input,
      konteks({ saldoKas: { '1001': RP(100_000) } }),
    );

    // Kas minus = peringatan (boleh lanjut setelah konfirmasi), bukan error.
    expect(peringatan.errors).toEqual([]);
    expect(peringatan.boleh).toBe(true);
    expect(peringatan.perluKonfirmasi).toBe(true);
    expect(peringatan.peringatan.join(' ')).toMatch(/minus/);

    const pincang: JurnalInput = {
      ...input,
      baris: [
        input.baris[0]!,
        { ...input.baris[1]!, kredit: input.baris[1]!.kredit - 1 },
      ],
    };
    const hasilPincang = validasiJurnal(pincang, konteks());
    expect(hasilPincang.boleh).toBe(false);
    expect(hasilPincang.errors.join(' ')).toMatch(/tidak seimbang/);
  });
});

describe('P1-2 — layar Transaksi: kartu Bayar & form Bayar', () => {
  it('menampilkan kartu Bayar siap dipakai dan pintasan Panjar/Hutang', () => {
    // Smoke SSR: default tetap Terima Uang, tetapi kartu Bayar sudah aktif.
    const html = renderToStaticMarkup(
      createElement(TransaksiTab, { onBukaTab: () => {} }),
    );

    expect(html).toContain('Catat Transaksi Harian');
    const kartuBayar = html
      .split('<button')
      .find((s) => s.includes('>Bayar</span>'))
      ?.split('</button>')[0];
    expect(kartuBayar).toBeDefined();
    expect(kartuBayar).not.toContain('disabled');
    expect(kartuBayar).toContain('Siap dipakai');
    expect(html).toContain('Sedang dipakai');
    // Panjar menjadi pintasan tab; form utang ada langsung di tab Transaksi.
    const kartuPanjar = html
      .split('<button')
      .find((s) => s.includes('>Panjar</span>'))
      ?.split('</button>')[0];
    expect(kartuPanjar).toBeDefined();
    expect(kartuPanjar ?? '').not.toContain('disabled');
    expect(kartuPanjar).toContain('Buka Buku Panjar');
    expect(html).not.toContain('Segera hadir');
    for (const label of ['Pindah Dana', 'Catat Utang', 'Bayar Utang', 'Panjar']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Buka Hutang');
    expect(html).not.toContain('Piutang/Hutang');
  });

  it('merender form Bayar dengan label ramah dan pilihan akun non-kas', () => {
    // Form diekstrak agar bisa diuji langsung tanpa interaksi browser.
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'BAYAR',
        coa: COA,
        memuat: false,
      }),
    );

    expect(html).toContain('Bayar / Beban');
    expect(html).toContain('Uang keluar dari');
    expect(html).toContain('Untuk pembayaran');
    expect(html).toContain('Nominal');
    expect(html).toContain('Keterangan');
    expect(html).toContain('Pratinjau Jurnal (untuk diperiksa)');
    expect(html).toContain('5010 — BAGA SUAR (TELPON, LISTRIK, PDAM)');
    expect(html).not.toContain('Anggaran');
    expect(html).not.toContain('menyusul');
    expect(html).toContain('Untuk panjar gunakan menu Buku Panjar');
    expect(html).toContain('untuk pinjaman/utang gunakan kartu Catat Utang / Bayar Utang');
    // Hanya akun BEBAN yang menjadi lawan; panjar/utang punya kartu sendiri.
    expect(html).toContain('<optgroup label="Beban">');
    expect(html).not.toContain('<optgroup label="Hutang">');
    expect(html).not.toContain('Aset lain (panjar/piutang)');
    expect(html).not.toContain('1040 — UANG PANJAR');
    expect(html).not.toContain('1050 — PIUTANG LAIN LAIN');
    expect(html).not.toContain('2050 — HUTANG LAIN-LAIN');
    // Pendapatan & ekuitas tidak boleh menjadi lawan pembayaran.
    expect(html).not.toContain('PENDAPATAN PARKIR');
    expect(html).not.toContain('3000 — MODAL');
  });

  it('menampilkan lima akun DB-13 dan 5063 DB-13b di form Terima/Bayar, akun lama tetap ada', () => {
    const terima = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'TERIMA',
        coa: COA,
        memuat: false,
      }),
    );
    for (const label of [
      '4006 — PENDAPATAN PARKIR BPD (KHUSUS)',
      '4060 — PENDAPATAN WEWEDALAN (UPACARA)',
    ]) {
      expect(terima).toContain(label);
    }
    expect(terima).toContain('4005 — PENDAPATAN PARKIR');
    expect(terima).toContain('4008 — PENDAPATAN PUNIA');
    expect(terima).toContain('4041 — PENDAPATAN SESARI');

    const bayar = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'BAYAR',
        coa: COA,
        memuat: false,
      }),
    );
    for (const label of [
      '5060 — PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL)',
      '5061 — PENGELUARAN ARTOS (UPACARA)',
      '5062 — PENGELUARAN BANTEN RUTIN (HARIAN)',
      '5063 — BEBAN BUNGA PINJAMAN',
    ]) {
      expect(bayar).toContain(label);
    }
    expect(bayar).toContain('5010 — BAGA SUAR (TELPON, LISTRIK, PDAM)');
    expect(bayar).toContain('5004 — BAGA UPAKARA');
    expect(bayar).toContain('5050 — BIAYA LAIN-LAIN');
  });
});

function dasarPindah(over: Partial<FormPindahDana> = {}): FormPindahDana {
  return {
    tanggal: '2026-10-22',
    dari: '1014',
    ke: '1001',
    nominal: RP(250_000),
    keterangan: 'Pindah kas LPD ke Kas Bendahara',
    ...over,
  };
}

describe('P1-3 — builder Pindah Dana untuk form terpandu', () => {
  it('menyusun D tujuan / K asal, total seimbang, dan lolos validasiJurnal', () => {
    const input = buatJurnalPindahDana(
      dasarPindah({ noBukti: '  JU-2026-0003  ' }),
    );

    expect(input.header).toMatchObject({
      tanggal: '2026-10-22',
      keterangan: 'Pindah kas LPD ke Kas Bendahara',
      jenis: 'TRANSFER',
      no_bukti: 'JU-2026-0003',
    });
    expect(input.header.id).toBeTruthy();
    // Dana masuk ke tujuan (debit), keluar dari asal (kredit).
    expect(input.baris).toEqual([
      { akun_kode: '1001', debit: RP(250_000), kredit: 0 },
      { akun_kode: '1014', debit: 0, kredit: RP(250_000) },
    ]);

    const jumlah = total(input);
    expect(jumlah).toEqual({ debit: RP(250_000), kredit: RP(250_000) });
    expect(jumlah.debit).toBe(jumlah.kredit);

    const validasi = validasiJurnal(
      input,
      konteks({
        saldoKas: { '1014': RP(1_000_000), '1001': RP(50_000) },
      }),
    );
    expect(validasi.errors).toEqual([]);
    expect(validasi.peringatan).toEqual([]);
    expect(validasi.boleh).toBe(true);
  });

  it('menolak dari = ke, akun non-kas, dan nominal/tanggal/keterangan tidak valid', () => {
    expect(() => buatJurnalPindahDana(dasarPindah({ ke: '1014' }))).toThrow(
      /berbeda/,
    );
    // Kedua sisi wajib dompet kas/bank: 1040 panjar & 1050 aset lain bukan dompet.
    expect(() => buatJurnalPindahDana(dasarPindah({ dari: '4005' }))).toThrow(
      /kas\/bank/,
    );
    expect(() => buatJurnalPindahDana(dasarPindah({ dari: '1040' }))).toThrow(
      /kas\/bank/,
    );
    expect(() => buatJurnalPindahDana(dasarPindah({ ke: '1050' }))).toThrow(
      /kas\/bank/,
    );
    expect(() => buatJurnalPindahDana(dasarPindah({ ke: '9999' }))).toThrow(
      /kas\/bank/,
    );

    expect(() => buatJurnalPindahDana(dasarPindah({ nominal: 0 }))).toThrow(
      /Nominal/,
    );
    expect(() => buatJurnalPindahDana(dasarPindah({ nominal: -1 }))).toThrow(
      /Nominal/,
    );
    expect(() => buatJurnalPindahDana(dasarPindah({ nominal: 1.5 }))).toThrow(
      /Nominal/,
    );
    expect(() =>
      buatJurnalPindahDana(dasarPindah({ nominal: Number.NaN })),
    ).toThrow(/Nominal/);
    expect(() =>
      buatJurnalPindahDana(dasarPindah({ tanggal: '2026-02-31' })),
    ).toThrow(/Tanggal/);
    expect(() =>
      buatJurnalPindahDana(dasarPindah({ keterangan: '   ' })),
    ).toThrow(/Keterangan/);

    // No. bukti opsional: spasi saja tidak disimpan sebagai nomor.
    expect(
      buatJurnalPindahDana(dasarPindah({ noBukti: '   ' })).header.no_bukti,
    ).toBeUndefined();
  });

  it('kasus feedback LPD 1014 → Kas Bendahara 1001: saldo berpindah, total kas tetap', () => {
    const db = openDb(':memory:');
    try {
      // Saldo awal: LPD 1014 punya dana (lawan akun modal).
      const modal = postingJurnal(db, {
        header: {
          id: 'p1-3-modal',
          tanggal: '2026-01-01',
          no_bukti: 'P1-3-0001',
          keterangan: 'Saldo awal',
          jenis: 'SALDO_AWAL',
        },
        baris: [
          { akun_kode: '1014', debit: RP(1_000_000), kredit: 0 },
          { akun_kode: AKUN_MODAL, debit: 0, kredit: RP(1_000_000) },
        ],
      });
      expect(modal.tersimpan, modal.errors.join(' ')).toBe(true);

      const sebelum = listBarisJurnal(db);
      expect(saldoAkun(sebelum, '1014')).toBe(RP(1_000_000));
      expect(saldoAkun(sebelum, '1001')).toBe(0);
      const totalKasSebelum = totalKas(sebelum, KAS_KODES);
      expect(totalKasSebelum).toBe(RP(1_000_000));

      const hasil = postingJurnal(
        db,
        buatJurnalPindahDana({
          ...dasarPindah(),
          noBukti: 'P1-3-0002',
          id: 'p1-3-pindah',
        }),
      );
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.errors).toEqual([]);
      expect(hasil.peringatan).toEqual([]);

      const sesudah = listBarisJurnal(db);
      // Hanya posisi antar dompet yang berubah.
      expect(saldoAkun(sesudah, '1014')).toBe(RP(750_000));
      expect(saldoAkun(sesudah, '1001')).toBe(RP(250_000));
      expect(totalKas(sesudah, KAS_KODES)).toBe(totalKasSebelum);
      expect(totalKas(sesudah, KAS_KODES)).toBe(RP(1_000_000));

      // Neraca Saldo tetap seimbang setelah transfer.
      const ns = neracaSaldo(sesudah, '2026-12-31');
      expect(ns.selisih).toBe(0);
      expect(ns.totalDebit).toBe(ns.totalKredit);
    } finally {
      db.close();
    }
  });
});

describe('P1-12 — komponen konfirmasi aksi besar', () => {
  it('merender judul, akibat aksi, tombol Batal, dan tombol lanjut', () => {
    const html = renderToStaticMarkup(
      createElement(KonfirmasiModal, {
        judul: 'Hapus akun 5011?',
        deskripsi: 'Akun 5011 akan dihapus. Jurnal lama tetap memakai namanya.',
        labelYa: 'Ya, hapus',
        onBatal: () => {},
        onKonfirmasi: () => {},
      }),
    );
    expect(html).toContain('Hapus akun 5011?');
    expect(html).toContain('Akun 5011 akan dihapus.');
    expect(html).toContain('Batal');
    expect(html).toContain('Ya, hapus');
    expect(html).not.toContain('disabled=""');
  });

  it('menampilkan status sibuk dan menonaktifkan tombol aksi serta X', () => {
    const html = renderToStaticMarkup(
      createElement(KonfirmasiModal, {
        judul: 'Kunci periode?',
        deskripsi: 'Periode akan dikunci.',
        sibuk: true,
        onBatal: () => {},
        onKonfirmasi: () => {},
      }),
    );
    expect(html).toContain('Memproses…');
    // X di header + Batal + tombol aksi tidak boleh aktif saat memproses.
    expect((html.match(/disabled=""/g) ?? []).length).toBe(3);
  });
});

describe('P1-3 — layar Transaksi: kartu & form Pindah Dana', () => {
  it('mengaktifkan kartu Pindah Dana dan menyediakan pintasan Panjar/Hutang', () => {
    const html = renderToStaticMarkup(
      createElement(TransaksiTab, { onBukaTab: () => {} }),
    );

    const kartuPindah = html
      .split('<button')
      .find((s) => s.includes('>Pindah Dana</span>'))
      ?.split('</button>')[0];
    expect(kartuPindah).toBeDefined();
    expect(kartuPindah).not.toContain('disabled');
    expect(kartuPindah).toContain('Siap dipakai');
    expect(html).not.toContain('Segera hadir');
    for (const label of ['Panjar', 'Catat Utang', 'Bayar Utang']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Buka Hutang');
    expect(html).not.toContain('Piutang/Hutang');
  });

  it('menonaktifkan simpan dan menampilkan peringatan bila akun Dari = Ke', () => {
    const sumber = readFileSync(
      join(process.cwd(), 'src/renderer/components/TransaksiForm.tsx'),
      'utf8',
    );
    // Guard UI: formSah mensyaratkan dua dompet berbeda, tombol simpan memakai
    // formSah, dan pesan kesalahan ditampilkan di bawah pilihan Ke.
    expect(sumber).toContain('akunKas !== akunKe');
    expect(sumber).toContain('disabled={busy || memuat || !formSah}');
    expect(sumber).toContain('Akun Dari dan Ke harus berbeda');
  });

  it('merender form Pindah Dana dengan label Dari/Ke dan penjelasan total kas', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'PINDAH',
        coa: COA,
        memuat: false,
      }),
    );

    expect(html).toContain('Pindah Dana');
    expect(html).toContain('antar dompet kas/bank');
    expect(html).toContain('Total kas tidak berubah');
    expect(html).toContain('Total kas tetap');
    expect(html).toContain('>Dari<');
    expect(html).toContain('>Ke<');
    expect(html).toContain('Nominal');
    expect(html).toContain('Keterangan');
    expect(html).toContain('No. bukti (opsional)');
    expect(html).toContain('Pratinjau Jurnal (untuk diperiksa)');
    expect(html).toContain('Simpan Pindah Dana');
    // Pilihan awal: dua dompet berbeda, bukan akun non-kas.
    expect(html).toContain('1001 — KAS');
    expect(html).toContain('1010 — LPD 12.05163/DL/2020 KIOS');
    expect(html).not.toContain('1040 — UANG PANJAR');
    expect(html).not.toContain('3000 — MODAL');
    // Label UI memakai istilah Indonesia, bukan "Transfer".
    expect(html).not.toContain('Transfer');
  });
});

describe('DB-14 — akun bank/LPD baru di form kas', () => {
  const bankBaru: Coa = {
    kode: '1101',
    nama: 'BANK BPD REKENING BARU',
    tipe: 'AKTIVA',
    posisi_normal: 'DEBIT',
    aktif: true,
    is_kas: true,
    kelompok: 'BANK',
    sumber: 'TAMBAHAN',
  };

  it('builder Pindah Dana memakai is_kas dari master, bukan daftar statis', () => {
    const input = buatJurnalPindahDana({
      tanggal: '2026-10-22',
      dari: '1001',
      ke: '1101',
      nominal: RP(250_000),
      keterangan: 'Pindah ke rekening bank baru',
      daftarAkun: [...COA, bankBaru],
    });
    expect(input.baris).toEqual([
      { akun_kode: '1101', debit: RP(250_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(250_000) },
    ]);
  });

  it('form Pindah Dana menampilkan rekening bank tambahan sebagai pilihan kas', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'PINDAH',
        coa: [...COA, bankBaru],
        memuat: false,
      }),
    );
    expect(html).toContain('1101 — BANK BPD REKENING BARU');
  });

  it('fallback objek Coa lama tanpa is_kas tetap mengenali 1001 sebagai kas', () => {
    const lama = COA.filter((a) => !Object.hasOwn(a, 'is_kas'));
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'PINDAH',
        coa: lama,
        memuat: false,
      }),
    );
    expect(html).toContain('1001 — KAS');
  });

  it('form Daftar Akun menyediakan jenis AKTIVA, kelompok, dan penanda is_kas', () => {
    const sumber = readFileSync(
      join(process.cwd(), 'src/renderer/components/AkunTab.tsx'),
      'utf8',
    );
    expect(sumber).toContain("'AKTIVA'");
    expect(sumber).toContain('Kelompok akun');
    expect(sumber).toContain('is_kas');
    expect(sumber).toContain('KODE_KAS_TAMBAHAN_MIN');
  });
});

describe('DB-15 — akun nonaktif tidak muncul di form input baru', () => {
  const NONAKTIF = new Set(['5010', '1014', '2060']);
  const coaDenganNonaktif: Coa[] = COA.map((a) => ({
    ...a,
    aktif: !NONAKTIF.has(a.kode),
  }));

  it('form Bayar menyembunyikan beban 5010 yang dinonaktifkan', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'BAYAR',
        coa: coaDenganNonaktif,
        memuat: false,
      }),
    );

    expect(html).not.toContain('5010 — BAGA SUAR');
    expect(html).toContain('5060 — PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL)');
    expect(html).toContain('5004 — BAGA UPAKARA');
    expect(html).toContain('5050 — BIAYA LAIN-LAIN');
  });

  it('form Pindah Dana menyembunyikan dompet 1014 yang dinonaktifkan', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'PINDAH',
        coa: coaDenganNonaktif,
        memuat: false,
      }),
    );

    expect(html).not.toContain('1014 — LPD 12.005150/DL/2020');
    expect(html).toContain('1001 — KAS');
    expect(html).toContain('1010 — LPD 12.05163/DL/2020 KIOS');
  });

  it('form utang menyembunyikan beban/kas nonaktif', () => {
    const catat = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'CATAT_UTANG',
        coa: coaDenganNonaktif,
        memuat: false,
      }),
    );
    expect(catat).not.toContain('5010 — BAGA SUAR');
    expect(catat).toContain('5003 — BAGA WEWANGUNAN');

    const bayar = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'BAYAR_UTANG',
        coa: coaDenganNonaktif,
        memuat: false,
      }),
    );
    expect(bayar).not.toContain('1014 — LPD 12.005150/DL/2020');
    expect(bayar).toContain('1001 — KAS');
  });

  it('Saldo Awal hanya menawarkan akun aktif, bukan dompet/hutang nonaktif', () => {
    const html = renderToStaticMarkup(
      createElement(SaldoAwalWizard, {
        coa: coaDenganNonaktif,
        onClose: () => {},
        onSukses: () => {},
      }),
    );

    expect(html).not.toContain('1014 — LPD 12.005150/DL/2020');
    expect(html).not.toContain('2060 — HUTANG USAHA');
    expect(html).toContain('1001 — KAS');
    expect(html).toContain('1010 — LPD 12.05163/DL/2020 KIOS');
    expect(html).toContain('2050 — HUTANG LAIN-LAIN');
  });

  it('Buku Panjar hanya memakai dompet dan akun beban aktif di dropdown', () => {
    const sumber = readFileSync(
      join(process.cwd(), 'src/renderer/components/PanjarTab.tsx'),
      'utf8',
    );
    expect(sumber).toContain('isAkunKasData(c) && c.aktif !== false');
    expect(sumber).toContain("c.tipe === 'BEBAN' && c.aktif !== false");
  });

  it('hanya akun non-sistem yang mendapat tombol nonaktifkan', () => {
    expect([...AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF].sort()).toEqual([
      '1040',
      '1050',
      '2050',
      '3000',
    ]);
    expect(akunBolehDinonaktifkan({ kode: '5010' })).toBe(true);
    expect(akunBolehDinonaktifkan({ kode: '1001' })).toBe(true);
    for (const kode of ['3000', '1040', '1050', '2050']) {
      expect(akunBolehDinonaktifkan({ kode }), `akun sistem ${kode}`).toBe(false);
    }
  });
});

describe('T1.8 — tombol koreksi saldo awal di layar Transaksi', () => {
  it('hanya memilih Koreksi saat status sudah dimuat dan terkunci', () => {
    expect(modeTombolSaldoAwal(null)).toBe('awal');
    expect(labelTombolSaldoAwal(null)).toBe('Wizard Saldo Awal');

    expect(modeTombolSaldoAwal({ boleh: true, jumlahJurnal: 0 })).toBe('awal');
    expect(labelTombolSaldoAwal({ boleh: true, jumlahJurnal: 0 })).toBe(
      'Wizard Saldo Awal',
    );

    expect(modeTombolSaldoAwal({ boleh: false, jumlahJurnal: 1 })).toBe(
      'koreksi',
    );
    expect(labelTombolSaldoAwal({ boleh: false, jumlahJurnal: 1 })).toBe(
      'Koreksi Saldo Awal',
    );
  });

  it('sumber TransaksiTab memuat alur koreksi dan tidak membuat status boleh:true', () => {
    const sumber = readFileSync(
      join(process.cwd(), 'src/renderer/components/TransaksiTab.tsx'),
      'utf8',
    );
    expect(sumber).toContain('api.saldoAwalSaatIni()');
    expect(sumber).toContain('Koreksi Saldo Awal');
    expect(sumber).toContain('mode={wizardMode}');
    expect(sumber).toContain('modeTombolSaldoAwal(saldoStatus)');
    expect(sumber).not.toContain('boleh: true');
  });
});
