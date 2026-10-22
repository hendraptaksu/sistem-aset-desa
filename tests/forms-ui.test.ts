// P1-1: kontrak builder Terima Uang yang dipakai layar Transaksi.
// Fokus: akun kas/pendapatan/modal, nominal SEN, pratinjau seimbang, serta
// bentuk input IPC yang tidak boleh dipercaya mentah-mentah.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AKUN_MODAL, COA } from '../src/db/coa.js';
import { buatJurnalTerimaUang, type FormTerimaUang } from '../src/core/forms.js';
import {
  validasiJurnal,
  type AkunPosting,
  type JurnalInput,
  type PostingContext,
} from '../src/core/posting.js';
import { validasiBentukJurnalInput } from '../src/main/validation.js';
import { TransaksiTab } from '../src/renderer/components/TransaksiTab.js';

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
      jenis: 'TERIMA',
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
      jenis: 'TERIMA',
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
});

describe('P1-1 — layar Transaksi', () => {
  it('merender header ramah, kartu Terima Uang aktif, dan slot segera hadir', () => {
    // Smoke render tanpa Electron: efek IPC tidak berjalan di server render,
    // jadi yang diperiksa adalah struktur layar awal.
    const html = renderToStaticMarkup(createElement(TransaksiTab));

    expect(html).toContain('Catat Transaksi Harian');
    expect(html).toContain('Terima Uang');
    expect(html).toContain('Pratinjau Jurnal (untuk diperiksa)');
    expect(html).toContain('Segera hadir');
    for (const label of ['Bayar', 'Pindah Dana', 'Panjar', 'Piutang/Hutang']) {
      expect(html).toContain(label);
    }
  });
});
