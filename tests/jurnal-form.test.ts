// P1-7: logika form Jurnal Umum (validasi multi-baris, builder, autocomplete,
// template, duplikat) + smoke UI editor dan layar Jurnal Umum.
// Semua nominal dalam SEN; jurnal tetap satu pintu lewat posting layer.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { COA } from '../src/db/coa.js';
import {
  TEMPLATE_JURNAL,
  buatJurnalUmumForm,
  cariAkunDariTeks,
  duplikatJurnalKeForm,
  validasiBarisJurnalForm,
  type BarisJurnalForm,
} from '../src/core/jurnalForm.js';
import type { JurnalInput } from '../src/core/posting.js';
import type { Jurnal } from '../src/core/types.js';
import { openDb } from '../src/db/database.js';
import { postingJurnal } from '../src/db/posting.js';
import { listJurnalLengkap } from '../src/db/repository.js';
import { JurnalTab } from '../src/renderer/components/JurnalTab.js';
import { JurnalUmumEditor } from '../src/renderer/components/JurnalUmumEditor.js';
import { jurnalToHtml } from '../src/features/export/workbooks.js';
import { tanggalLokal } from '../src/utils/tanggal.js';

const RP = (rupiah: number): number => rupiah * 100;

const baris = (over: Partial<BarisJurnalForm> = {}): BarisJurnalForm => ({
  akun_kode: '1001',
  debit: 0,
  kredit: 0,
  keterangan: '',
  ...over,
});

const seimbang: BarisJurnalForm[] = [
  baris({ akun_kode: '1001', debit: RP(150_000) }),
  baris({ akun_kode: '4005', kredit: RP(150_000) }),
];

const total = (input: JurnalInput): { debit: number; kredit: number } =>
  input.baris.reduce(
    (t, b) => ({ debit: t.debit + b.debit, kredit: t.kredit + b.kredit }),
    { debit: 0, kredit: 0 },
  );

describe('P1-7 — validasi baris Jurnal Umum', () => {
  it('menerima dua baris sah yang seimbang dan menjumlahkan total', () => {
    const hasil = validasiBarisJurnalForm(seimbang);

    expect(hasil.errors).toEqual([]);
    expect(hasil.totalDebit).toBe(RP(150_000));
    expect(hasil.totalKredit).toBe(RP(150_000));
    expect(hasil.barisSah).toBe(true);
    expect(hasil.seimbang).toBe(true);
  });

  it('menandai belum seimbang tanpa menyalahkan baris yang sah', () => {
    const hasil = validasiBarisJurnalForm([
      baris({ akun_kode: '1001', debit: RP(150_000) }),
      baris({ akun_kode: '4005', kredit: RP(100_000) }),
    ]);

    expect(hasil.errors).toEqual([]);
    expect(hasil.barisSah).toBe(true);
    expect(hasil.seimbang).toBe(false);
    expect(hasil.totalDebit).not.toBe(hasil.totalKredit);
  });

  it('mengabaikan baris kosong (termasuk baris tambahan yang belum diisi)', () => {
    const hasil = validasiBarisJurnalForm([
      ...seimbang,
      baris({ akun_kode: '' }),
      baris({ akun_kode: '', keterangan: '   ' }),
    ]);

    expect(hasil.errors).toEqual([]);
    expect(hasil.barisSah).toBe(true);
    expect(hasil.seimbang).toBe(true);
  });

  it('menolak satu baris yang mengisi debit dan kredit sekaligus', () => {
    const hasil = validasiBarisJurnalForm([
      baris({ akun_kode: '1001', debit: RP(100_000), kredit: RP(100_000) }),
      baris({ akun_kode: '4005', kredit: RP(100_000) }),
    ]);

    expect(hasil.errors.join(' ')).toMatch(/debit ATAU kredit/i);
    expect(hasil.barisSah).toBe(false);
    expect(hasil.seimbang).toBe(false);
  });

  it('menolak nominal negatif, pecahan, dan nol', () => {
    const negatif = validasiBarisJurnalForm([
      baris({ akun_kode: '1001', debit: -1 }),
      baris({ akun_kode: '4005', kredit: RP(100_000) }),
    ]);
    expect(negatif.errors.join(' ')).toMatch(/bilangan bulat/i);

    const pecahan = validasiBarisJurnalForm([
      baris({ akun_kode: '1001', debit: 1.5 }),
      baris({ akun_kode: '4005', kredit: 1.5 }),
    ]);
    expect(pecahan.errors.join(' ')).toMatch(/bilangan bulat/i);

    const nol = validasiBarisJurnalForm([
      baris({ akun_kode: '1001', debit: 0, kredit: 0 }),
      baris({ akun_kode: '4005', debit: 0, kredit: 0 }),
    ]);
    expect(nol.errors.join(' ')).toMatch(/harus lebih dari 0/i);
    expect(nol.barisSah).toBe(false);
  });

  it('mewajibkan akun dan minimal dua baris sah', () => {
    const tanpaAkun = validasiBarisJurnalForm([
      baris({ akun_kode: '   ', debit: RP(100_000) }),
      baris({ akun_kode: '4005', kredit: RP(100_000) }),
    ]);
    expect(tanpaAkun.errors.join(' ')).toMatch(/akun wajib dipilih/i);
    expect(tanpaAkun.barisSah).toBe(false);

    const satuBaris = validasiBarisJurnalForm([
      baris({ akun_kode: '1001', debit: RP(100_000) }),
    ]);
    expect(satuBaris.errors.join(' ')).toMatch(/minimal 2 baris/i);
    expect(satuBaris.barisSah).toBe(false);
  });
});

describe('P1-7 — builder jurnal umum', () => {
  it('menyusun JurnalInput UMUM yang seimbang dengan nomor bukti opsional', () => {
    const input = buatJurnalUmumForm({
      id: 'j-umum-1',
      tanggal: '2026-10-23',
      keterangan: '  Penerimaan parkir  ',
      noBukti: '  JU-2026-0001  ',
      baris: seimbang,
    });

    expect(input.header).toMatchObject({
      id: 'j-umum-1',
      tanggal: '2026-10-23',
      keterangan: 'Penerimaan parkir',
      jenis: 'UMUM',
      no_bukti: 'JU-2026-0001',
    });
    expect(input.baris).toEqual([
      { akun_kode: '1001', debit: RP(150_000), kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: RP(150_000) },
    ]);
    expect(total(input)).toEqual({
      debit: RP(150_000),
      kredit: RP(150_000),
    });

    const tanpaBukti = buatJurnalUmumForm({
      tanggal: '2026-10-23',
      keterangan: 'Tanpa nomor bukti',
      noBukti: '   ',
      baris: seimbang,
    });
    expect(tanpaBukti.header.no_bukti).toBeUndefined();
    expect(tanpaBukti.header.id).toBeTruthy();
  });

  it('menolak jurnal tidak seimbang, header tidak sah, dan baris kosong', () => {
    expect(() =>
      buatJurnalUmumForm({
        tanggal: '2026-10-23',
        keterangan: 'Tidak seimbang',
        baris: [
          baris({ akun_kode: '1001', debit: RP(100_000) }),
          baris({ akun_kode: '4005', kredit: RP(90_000) }),
        ],
      }),
    ).toThrow(/tidak seimbang/i);

    expect(() =>
      buatJurnalUmumForm({
        tanggal: '2026-02-31',
        keterangan: 'Tanggal salah',
        baris: seimbang,
      }),
    ).toThrow(/Tanggal/i);

    expect(() =>
      buatJurnalUmumForm({
        tanggal: '2026-10-23',
        keterangan: '   ',
        baris: seimbang,
      }),
    ).toThrow(/Keterangan/i);

    expect(() =>
      buatJurnalUmumForm({
        tanggal: '2026-10-23',
        keterangan: 'Kurang baris',
        baris: [baris({ akun_kode: '1001', debit: RP(100_000) })],
      }),
    ).toThrow(/minimal 2 baris/i);
  });

  it('bisa disimpan lewat postingJurnal dan audit tercatat', () => {
    const db = openDb(':memory:');
    try {
      const input = buatJurnalUmumForm({
        id: 'j-p1-7-db',
        tanggal: '2026-10-23',
        keterangan: 'Penerimaan parkir',
        noBukti: 'P1-7-0001',
        baris: seimbang,
      });
      const hasil = postingJurnal(db, input);
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.errors).toEqual([]);
      expect(hasil.jurnal).toMatchObject({
        id: 'j-p1-7-db',
        jenis: 'UMUM',
        no_bukti: 'P1-7-0001',
      });

      const daftar = listJurnalLengkap(db);
      expect(daftar).toHaveLength(1);
      expect(daftar[0]!.jenis).toBe('UMUM');
      expect(daftar[0]!.total_debit).toBe(RP(150_000));
      expect(daftar[0]!.baris).toHaveLength(2);

      const audit = db
        .prepare('SELECT aksi FROM audit_log ORDER BY rowid')
        .all() as { aksi: string }[];
      expect(audit.some((a) => a.aksi.includes('j-p1-7-db'))).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('P1-7 — autocomplete akun', () => {
  it('mencocokkan kode, nama, dan format kode — nama tanpa membedakan huruf', () => {
    expect(cariAkunDariTeks(COA, '1001')?.kode).toBe('1001');
    expect(cariAkunDariTeks(COA, ' kas ')?.kode).toBe('1001');
    expect(cariAkunDariTeks(COA, '1001 — KAS')?.kode).toBe('1001');
    expect(cariAkunDariTeks(COA, '1001 - kas')?.kode).toBe('1001');
    expect(
      cariAkunDariTeks(COA, 'BAGA SUAR (TELPON, LISTRIK, PDAM)')?.kode,
    ).toBe('5010');
    expect(cariAkunDariTeks(COA, '2050 — HUTANG LAIN-LAIN')?.kode).toBe('2050');
  });

  it('mengembalikan null untuk teks kosong / tidak dikenal', () => {
    expect(cariAkunDariTeks(COA, '')).toBeNull();
    expect(cariAkunDariTeks(COA, '9999')).toBeNull();
    expect(cariAkunDariTeks(COA, 'akun karangan')).toBeNull();
  });
});

describe('P1-7 — template & duplikat jurnal', () => {
  it('menyediakan minimal 4 template umum dengan akun, sisi, dan nominal 0', () => {
    expect(TEMPLATE_JURNAL.length).toBeGreaterThanOrEqual(4);
    const nama = TEMPLATE_JURNAL.map((t) => t.nama.toLowerCase()).join(' | ');
    expect(nama).toMatch(/terima pendapatan/);
    expect(nama).toMatch(/bayar beban/);
    expect(nama).toMatch(/pindah dana/);
    expect(nama).toMatch(/serah panjar/);

    for (const template of TEMPLATE_JURNAL) {
      expect(template.baris.length).toBeGreaterThanOrEqual(2);
      const sisi = new Set(template.baris.map((b) => b.sisi));
      expect(sisi.has('DEBIT')).toBe(true);
      expect(sisi.has('KREDIT')).toBe(true);
      for (const b of template.baris) {
        expect(b.nominal).toBe(0);
        expect(COA.some((a) => a.kode === b.akun_kode)).toBe(true);
      }
    }
  });

  it('menduplikat baris lama ke form baru: tanggal hari ini, id baru, no bukti kosong', () => {
    const asal: Jurnal & {
      baris: {
        akun_kode: string;
        debit: number;
        kredit: number;
        keterangan: string;
      }[];
    } = {
      id: 'j-lama',
      tanggal: '2025-12-31',
      no_bukti: 'JU-2025-0099',
      keterangan: 'Penerimaan parkir lama',
      jenis: 'UMUM',
      grup_id: 'j-lama',
      reversal_of: null,
      created_at: '2025-12-31T10:00:00.000Z',
      baris: [
        {
          akun_kode: '1001',
          debit: RP(150_000),
          kredit: 0,
          keterangan: 'Kas',
        },
        {
          akun_kode: '4005',
          debit: 0,
          kredit: RP(150_000),
          keterangan: 'Pendapatan',
        },
      ],
    };

    const form = duplikatJurnalKeForm(asal);
    expect(form.id).toBeTruthy();
    expect(form.id).not.toBe(asal.id);
    expect(form.tanggal).toBe(tanggalLokal());
    expect(form.noBukti).toBe('');
    expect(form.keterangan).toBe(asal.keterangan);
    expect(form.baris).toEqual([
      { akun_kode: '1001', debit: RP(150_000), kredit: 0, keterangan: 'Kas' },
      {
        akun_kode: '4005',
        debit: 0,
        kredit: RP(150_000),
        keterangan: 'Pendapatan',
      },
    ]);
    expect(form).not.toHaveProperty('reversal_of');

    const input = buatJurnalUmumForm(form);
    expect(input.header.jenis).toBe('UMUM');
    expect(input.header.no_bukti).toBeUndefined();
  });
});

describe('P1-7 — smoke UI Jurnal Umum', () => {
  const baca = (path: string): string =>
    readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf-8');

  it('menampilkan tombol besar + Jurnal Baru hanya pada mode akuntan', () => {
    const modeAkuntan = renderToStaticMarkup(createElement(JurnalTab));
    expect(modeAkuntan).toContain('+ Jurnal Baru');
    expect(modeAkuntan).toContain('Mode akuntan');
    expect(modeAkuntan).toContain('Jurnal Umum');
    expect(modeAkuntan).toContain('>Jurnal Umum</span>');

    const modeOperator = renderToStaticMarkup(
      createElement(JurnalTab, { modeAkuntan: false }),
    );
    expect(modeOperator).not.toContain('+ Jurnal Baru');
  });

  it('DB-03: editor menampilkan badge Jurnal Umum tanpa pemilih jenis dokumen', () => {
    const html = renderToStaticMarkup(
      createElement(JurnalUmumEditor, {
        coa: COA,
        onBatal: () => undefined,
        onSelesai: () => undefined,
      }),
    );
    expect(html).toContain('>Jurnal Umum</span>');
    expect(html).toContain('Jalur manual ini hanya menyimpan jurnal UMUM.');

    const editorSrc = baca('src/renderer/components/JurnalUmumEditor.tsx');
    expect(editorSrc).not.toMatch(/jenis/i);
    expect(editorSrc).not.toContain('value={jenis}');
    expect(editorSrc).toContain('api.jurnalPosting');

    const formSrc = baca('src/renderer/components/TransaksiForm.tsx');
    expect(formSrc).toContain('api.transaksiPosting');
    expect(formSrc).not.toContain('api.jurnalPosting');
  });

  it('merender editor multi-baris dengan autocomplete, template, dan tombol simpan nonaktif', () => {
    const html = renderToStaticMarkup(
      createElement(JurnalUmumEditor, {
        coa: COA,
        onBatal: () => undefined,
        onSelesai: () => undefined,
      }),
    );

    expect(html).toContain('Jurnal Baru');
    expect(html).toContain('JU-2026-0001');
    expect(html).toContain('Pratinjau nomor bukti');
    expect(html).toContain('otomatis saat disimpan');
    expect(html).toContain('Template jurnal');
    expect(html).toContain('daftar-akun-jurnal-umum');
    expect(html).toContain('1001 — KAS');
    expect(html).toContain('3000 — MODAL');
    // Akun legacy tetap ada di COA/laporan, tetapi tidak menjadi pilihan posting.
    expect(html).not.toContain('3001 —');
    expect(html).not.toContain('3002 —');
    expect(html).toContain('Belum seimbang');

    const tombolSimpan = html
      .split('<button')
      .find((s) => s.includes('>Simpan Jurnal</button>'));
    expect(tombolSimpan).toBeDefined();
    expect(tombolSimpan).toContain('disabled');
  });

  it('menghasilkan HTML print jurnal dengan kop, nomor bukti, dan total', () => {
    const html = jurnalToHtml(
      {
        id: 'j-cetak',
        tanggal: '2026-10-23',
        no_bukti: 'JU-2026-0001',
        keterangan: 'Penerimaan parkir',
        baris: [
          {
            akun_kode: '1001',
            debit: RP(150_000),
            kredit: 0,
            keterangan: 'Kas',
          },
          {
            akun_kode: '4005',
            debit: 0,
            kredit: RP(150_000),
            keterangan: 'Pendapatan',
          },
        ],
      },
      COA,
    );

    expect(html).toContain('PURA DALEM PURI PELIATAN');
    expect(html).toContain('JURNAL UMUM');
    expect(html).toContain('JU-2026-0001');
    expect(html).toContain('1001 — KAS');
    expect(html).toContain('Rp 150.000');
    expect(html).toContain('TOTAL');
  });
});
