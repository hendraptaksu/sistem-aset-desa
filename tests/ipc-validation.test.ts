// P0-4: posting layer & aturan validasi bisnis.
// Fokus: validasi jurnal double-entry satu pintu (tanggal kalender, akun,
// keseimbangan, kunci periode, kas minus = peringatan, no bukti unik).
// Validasi single-entry lama tetap diuji sampai UI-nya pindah ke jurnal.

import { describe, expect, it } from 'vitest';
import { COA, type CoaTipe } from '../src/db/coa.js';
import {
  JENIS_JURNAL,
  tanggalKalenderValid,
  validasiJurnal,
  type AkunPosting,
  type PostingContext,
} from '../src/core/posting.js';
import type { JurnalBarisInput, JurnalHeaderInput, JurnalJenis } from '../src/core/types.js';
import {
  validasiBentukJurnalInput,
  validasiBentukPanjarClose,
  validasiBentukPanjarSerah,
  validasiBentukSaldoAwal,
  validasiCutoffLaporan,
  validasiFilterBukuBesar,
  validasiFilterJurnalCari,
  validasiFilterNeraca,
  validasiRentangLaporan,
  validasiTanggalOpsional,
  validatePanjarItems,
  validateTransaksiInput,
} from '../src/main/validation.js';
import {
  PESAN_SIMPAN_GAGAL,
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
} from '../src/utils/pesanError.js';

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

function header(over: Partial<JurnalHeaderInput> = {}): JurnalHeaderInput {
  return {
    id: 'j-uji',
    tanggal: '2026-03-12',
    keterangan: 'Terima uang parkir',
    no_bukti: 'JU-2026-0001',
    ...over,
  };
}

function pasangan(debit = '1001', kredit = '4005', nominal = 100_000): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

function jalankan(
  opts: { header?: Partial<JurnalHeaderInput>; baris?: JurnalBarisInput[]; alasan?: string } = {},
  ctxOver: Partial<PostingContext> = {},
) {
  return validasiJurnal(
    {
      header: header(opts.header),
      baris: opts.baris ?? pasangan(),
      alasan: opts.alasan,
    },
    konteks(ctxOver),
  );
}

const pesan = (hasil: ReturnType<typeof jalankan>): string => hasil.errors.join(' | ');

describe('P0-4 — tanggal kalender', () => {
  it('menerima tanggal nyata, termasuk 29 Feb tahun kabisat', () => {
    expect(tanggalKalenderValid('2026-02-28')).toBe(true);
    expect(tanggalKalenderValid('2028-02-29')).toBe(true);
    expect(tanggalKalenderValid('2026-12-31')).toBe(true);
    expect(jalankan({ header: { tanggal: '2028-02-29' } }).boleh).toBe(true);
  });

  it('menolak 31 Feb, 31 Apr, bulan 13, tanggal 0, dan format salah', () => {
    for (const tanggal of [
      '2026-02-31',
      '2026-04-31',
      '2026-13-01',
      '2026-01-00',
      '12-03-2026',
      '2026-2-3',
      '',
    ]) {
      expect(tanggalKalenderValid(tanggal), tanggal).toBe(false);
      expect(pesan(jalankan({ header: { tanggal } })), tanggal).toMatch(/Tanggal tidak valid/);
    }
    expect(tanggalKalenderValid('2027-02-29')).toBe(false); // bukan kabisat
  });
});

describe('P0-4 — akun & jenis akun', () => {
  it('menolak akun tidak dikenal dan akun nonaktif', () => {
    const tidakDikenal = jalankan({
      baris: [
        { akun_kode: '9999', debit: 100_000, kredit: 0 },
        { akun_kode: '4005', debit: 0, kredit: 100_000 },
      ],
    });
    expect(pesan(tidakDikenal)).toMatch(/akun 9999 tidak dikenal/);

    const nonaktif = jalankan(
      {},
      { akun: AKUN.map((a) => (a.kode === '4005' ? { ...a, aktif: false } : a)) },
    );
    expect(pesan(nonaktif)).toMatch(/sudah tidak aktif/);
    expect(nonaktif.boleh).toBe(false);
  });

  it('menolak tipe/posisi normal akun yang tidak konsisten dengan master', () => {
    const posisiSalah = jalankan(
      {},
      { akun: AKUN.map((a) => (a.kode === '4005' ? { ...a, posisi_normal: 'DEBIT' } : a)) },
    );
    expect(pesan(posisiSalah)).toMatch(/posisi normal/);

    const tipeAsing = jalankan(
      {},
      {
        akun: AKUN.map((a) =>
          a.kode === '4005' ? { ...a, tipe: 'LAINNYA' as CoaTipe } : a,
        ),
      },
    );
    expect(pesan(tipeAsing)).toMatch(/jenis akun/);
  });

  it('menjaga jenis jurnal konsisten dengan akun yang dipakai', () => {
    expect(
      pesan(jalankan({ header: { jenis: 'TRANSFER' }, baris: pasangan('5000', '1001') })),
    ).toMatch(/Pindah Dana hanya boleh memakai akun kas\/bank/);
    expect(
      pesan(jalankan({ header: { jenis: 'TRANSFER' }, baris: pasangan('1001', '1001') })),
    ).toMatch(/dua akun kas\/bank yang berbeda/);

    expect(
      pesan(jalankan({ header: { jenis: 'PANJAR' }, baris: pasangan('1001', '5004') })),
    ).toMatch(/1040 UANG PANJAR/);
    expect(
      pesan(jalankan({ header: { jenis: 'PIUTANG' }, baris: pasangan('1001', '4005') })),
    ).toMatch(/1050 PIUTANG/);
    expect(
      pesan(jalankan({ header: { jenis: 'HUTANG' }, baris: pasangan('1001', '4005') })),
    ).toMatch(/2050 HUTANG/);

    // Pasangan yang benar untuk tiap jenis tidak menghasilkan error jenis.
    expect(jalankan({ header: { jenis: 'TRANSFER' }, baris: pasangan('1029', '1001') }).boleh).toBe(true);
    expect(jalankan({ header: { jenis: 'PANJAR' }, baris: pasangan('1040', '1001') }).boleh).toBe(true);
    expect(jalankan({ header: { jenis: 'PIUTANG' }, baris: pasangan('1050', '1001') }).boleh).toBe(true);
    expect(jalankan({ header: { jenis: 'HUTANG' }, baris: pasangan('1001', '2050') }).boleh).toBe(true);
  });

  it('mengenal seluruh jenis jurnal dan menolak jenis asing', () => {
    expect(JENIS_JURNAL).toContain('REVERSAL');
    const asing = jalankan({ header: { jenis: 'NGARANG' as JurnalJenis } });
    expect(pesan(asing)).toMatch(/Jenis jurnal tidak dikenal/);
  });
});

describe('P0-4 — bentuk & keseimbangan jurnal', () => {
  it('menerima jurnal seimbang', () => {
    const hasil = jalankan();
    expect(hasil.errors).toEqual([]);
    expect(hasil.peringatan).toEqual([]);
    expect(hasil.boleh).toBe(true);
    expect(hasil.perluKonfirmasi).toBe(false);
  });

  it('menolak kurang dari 2 baris, nominal nol/negatif/bukan bulat, dan dua sisi sekaligus', () => {
    expect(pesan(jalankan({ baris: [] }))).toMatch(/minimal 2 baris/);
    expect(
      pesan(jalankan({ baris: [{ akun_kode: '1001', debit: 0, kredit: 0 }, { akun_kode: '4005', debit: 0, kredit: 0 }] })),
    ).toMatch(/harus lebih dari 0/);
    expect(
      pesan(jalankan({ baris: [{ akun_kode: '1001', debit: -1, kredit: 0 }, { akun_kode: '4005', debit: 0, kredit: -1 }] })),
    ).toMatch(/bilangan bulat/);
    expect(
      pesan(jalankan({ baris: [{ akun_kode: '1001', debit: 1.5, kredit: 0 }, { akun_kode: '4005', debit: 0, kredit: 1.5 }] })),
    ).toMatch(/bilangan bulat/);
    expect(
      pesan(jalankan({ baris: [{ akun_kode: '1001', debit: 100, kredit: 100 }, { akun_kode: '4005', debit: 100, kredit: 100 }] })),
    ).toMatch(/debit ATAU kredit/);
  });

  it('menolak jurnal tidak seimbang dengan pesan nominal yang mudah dibaca', () => {
    const hasil = jalankan({
      baris: [
        { akun_kode: '1001', debit: 100_000, kredit: 0 },
        { akun_kode: '4005', debit: 0, kredit: 90_000 },
      ],
    });
    expect(pesan(hasil)).toMatch(/tidak seimbang/);
    expect(pesan(hasil)).toMatch(/Rp 1\.000,00/);
    expect(pesan(hasil)).toMatch(/Rp 900,00/);
    expect(hasil.boleh).toBe(false);
  });

  it('menolak keterangan kosong', () => {
    expect(pesan(jalankan({ header: { keterangan: '   ' } }))).toMatch(/Keterangan wajib/);
  });
});

describe('P0-4 — kunci periode (longgar)', () => {
  const tutup2025 = [{ tahun: 2025 }];

  it('menolak tanggal di periode tutup tanpa alasan atau alasan < 5 karakter', () => {
    const tanpa = jalankan({ header: { tanggal: '2025-12-31' } }, { tutupBuku: tutup2025 });
    expect(pesan(tanpa)).toMatch(/Periode sudah ditutup/);

    const pendek = jalankan(
      { header: { tanggal: '2025-12-31' }, alasan: '  1234  ' },
      { tutupBuku: tutup2025 },
    );
    expect(pesan(pendek)).toMatch(/Periode sudah ditutup/);
  });

  it('menerima koreksi periode tutup dengan alasan ≥ 5 karakter', () => {
    const hasil = jalankan(
      { header: { tanggal: '2025-12-31' }, alasan: 'Koreksi struk Desember' },
      { tutupBuku: tutup2025 },
    );
    expect(hasil.errors).toEqual([]);
    expect(hasil.boleh).toBe(true);
  });

  it('tidak mengunci tanggal setelah tahun tutup terakhir', () => {
    const hasil = jalankan({ header: { tanggal: '2026-01-01' } }, { tutupBuku: tutup2025 });
    expect(hasil.errors).toEqual([]);
  });
});

describe('P0-4 — kas/bank minus = peringatan, bukan error', () => {
  it('memberi peringatan bila pengeluaran membuat kas minus', () => {
    const hasil = jalankan(
      { baris: pasangan('5000', '1001', 100_000) },
      { saldoKas: { '1001': 50_000 } },
    );
    expect(hasil.errors).toEqual([]);
    expect(hasil.boleh).toBe(true);
    expect(hasil.perluKonfirmasi).toBe(true);
    expect(hasil.peringatan.join(' ')).toMatch(/Kas\/Bank 1001 KAS akan minus/);
    expect(hasil.peringatan.join(' ')).toMatch(/Rp 500,00/);
  });

  it('tidak memberi peringatan bila saldo pas atau justru bertambah', () => {
    const pas = jalankan(
      { baris: pasangan('5000', '1001', 50_000) },
      { saldoKas: { '1001': 50_000 } },
    );
    expect(pas.peringatan).toEqual([]);

    const masuk = jalankan({ baris: pasangan('1001', '4005', 50_000) }, { saldoKas: { '1001': 0 } });
    expect(masuk.peringatan).toEqual([]);
  });

  it('hanya memeriksa akun kas/bank, bukan akun lain', () => {
    const hasil = jalankan(
      { baris: pasangan('5000', '1050', 100_000) },
      { saldoKas: { '1050': 0 } },
    );
    expect(hasil.peringatan).toEqual([]);
  });
});

describe('P0-4 — nomor bukti unik', () => {
  it('menolak nomor bukti yang sudah dipakai (tanpa membedakan huruf besar/kecil)', () => {
    const hasil = jalankan(
      { header: { no_bukti: 'ju-2026-0001' } },
      { noBuktiTerpakai: ['JU-2026-0001'] },
    );
    expect(pesan(hasil)).toMatch(/Nomor bukti ju-2026-0001 sudah dipakai/);
    expect(hasil.boleh).toBe(false);
  });

  it('mengizinkan no_bukti kosong berulang (masih draft)', () => {
    const hasil = jalankan(
      { header: { no_bukti: '  ' } },
      { noBuktiTerpakai: ['JU-2026-0001'] },
    );
    expect(hasil.errors).toEqual([]);
  });
});

describe('P0-4 — kombinasi aturan', () => {
  it('mengumpulkan semua error + peringatan dalam satu hasil', () => {
    const hasil = jalankan(
      {
        header: { tanggal: '2025-06-01', no_bukti: 'JU-2026-0001' },
        baris: [
          { akun_kode: '5010', debit: 100_000, kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: 50_000 },
        ],
      },
      {
        akun: AKUN.map((a) => (a.kode === '5010' ? { ...a, aktif: false } : a)),
        tutupBuku: [{ tahun: 2025 }],
        noBuktiTerpakai: ['JU-2026-0001'],
        saldoKas: { '1001': 10_000 },
      },
    );
    expect(hasil.errors.length).toBeGreaterThanOrEqual(4);
    expect(pesan(hasil)).toMatch(/sudah tidak aktif/);
    expect(pesan(hasil)).toMatch(/tidak seimbang/);
    expect(pesan(hasil)).toMatch(/Periode sudah ditutup/);
    expect(pesan(hasil)).toMatch(/sudah dipakai/);
    expect(hasil.peringatan).toHaveLength(1);
    expect(hasil.perluKonfirmasi).toBe(true);
    expect(hasil.boleh).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P1-12 — validasi tanggal kalender seragam di semua jalur IPC utama.
// ---------------------------------------------------------------------------

describe('P1-12 — tanggal kalender seragam', () => {
  const tanggalSalah = ['2026-02-31', '2026-04-31', '2026-13-01', '12-03-2026'];

  const jurnal = {
    header: {
      id: 'j-p1-12',
      tanggal: '2026-03-12',
      keterangan: 'Uji tanggal',
      no_bukti: 'JU-2026-9001',
      jenis: 'TERIMA',
    },
    baris: pasangan(),
  };

  it('menolak tanggal kalender salah di validator form jurnal', () => {
    for (const tanggal of tanggalSalah) {
      const hasil = validasiBentukJurnalInput({
        ...jurnal,
        header: { ...jurnal.header, tanggal },
      });
      expect(hasil.ok, tanggal).toBe(false);
      if (!hasil.ok) expect(hasil.error).toBe(PESAN_TANGGAL_TIDAK_VALID);
    }
    expect(validasiBentukJurnalInput(jurnal).ok).toBe(true);
    expect(
      validasiBentukJurnalInput({
        ...jurnal,
        header: { ...jurnal.header, tanggal: '2028-02-29' },
      }).ok,
    ).toBe(true);
  });

  it('menolak tanggal kalender salah di panjar, saldo awal, dan transaksi lama', () => {
    for (const tanggal of tanggalSalah) {
      const serah = validasiBentukPanjarSerah({
        tanggal,
        penerima: 'Panitia',
        jumlah: 100_000,
        akunKasSumber: '1001',
      });
      expect(serah.ok, tanggal).toBe(false);
      if (!serah.ok) expect(serah.error).toBe(PESAN_TANGGAL_TIDAK_VALID);

      const close = validasiBentukPanjarClose({
        id: 'p-1',
        tanggalClose: tanggal,
        items: [{ kategori_baga: '5004', nominal: 100_000 }],
      });
      expect(close.ok, tanggal).toBe(false);
      if (!close.ok) expect(close.error).toBe(PESAN_TANGGAL_TIDAK_VALID);

      const saldo = validasiBentukSaldoAwal({
        tanggal,
        saldo: [{ akun_kode: '1001', nominal: 100_000 }],
      });
      expect(saldo.ok, tanggal).toBe(false);
      if (!saldo.ok) expect(saldo.error).toBe(PESAN_TANGGAL_TIDAK_VALID);

      expect(
        validateTransaksiInput({
          tanggal,
          keterangan: 'Uji',
          akun_kas: '1001',
          kategori: '4001',
          masuk: 100_000,
          keluar: 0,
        }),
      ).toContain(PESAN_TANGGAL_TIDAK_VALID);
    }
  });

  it('menolak tanggal kalender salah di filter, cutoff, dan opsi koreksi', () => {
    for (const tanggal of tanggalSalah) {
      for (const hasil of [
        validasiFilterBukuBesar({ akun_kode: '1001', mulai: tanggal }),
        validasiFilterBukuBesar({ akun_kode: '1001', sampai: tanggal }),
        validasiCutoffLaporan(tanggal),
        validasiRentangLaporan({ mulai: tanggal }),
        validasiRentangLaporan({ sampai: tanggal }),
        validasiFilterNeraca({ cutoff: tanggal }),
        validasiFilterJurnalCari({ mulai: tanggal }),
        validasiFilterJurnalCari({ sampai: tanggal }),
        validasiTanggalOpsional(tanggal),
      ]) {
        expect(hasil.ok, tanggal).toBe(false);
        if (!hasil.ok) expect(hasil.error).toBe(PESAN_TANGGAL_TIDAK_VALID);
      }
    }

    // Tanggal kosong tetap diperbolehkan untuk filter opsional.
    expect(validasiRentangLaporan({}).ok).toBe(true);
    expect(validasiFilterBukuBesar({ akun_kode: '1001' }).ok).toBe(true);
    expect(validasiTanggalOpsional('').ok).toBe(true);
    expect(validasiCutoffLaporan('2028-02-29').ok).toBe(true);
  });

  it('menolak rentang tanggal terbalik dengan pesan sederhana', () => {
    const hasil = validasiRentangLaporan({
      mulai: '2026-12-31',
      sampai: '2026-01-01',
    });
    expect(hasil.ok).toBe(false);
    if (!hasil.ok)
      expect(hasil.error).toBe('Tanggal mulai tidak boleh setelah tanggal sampai.');
  });
});

describe('P1-12 — pesan teknis tidak bocor', () => {
  it('menyamarkan error SQLite dan TypeError dari jalur main', () => {
    expect(
      pesanError(new Error('SqliteError: UNIQUE constraint failed: jurnal.no_bukti')),
    ).toBe(PESAN_SIMPAN_GAGAL);
    expect(
      pesanError(new Error('TypeError: Cannot read properties of undefined')),
    ).toBe(PESAN_SIMPAN_GAGAL);
    expect(
      pesanError(new Error('/Users/taksu/app/src/main/index.ts:42:7')),
    ).toBe(PESAN_SIMPAN_GAGAL);
  });
});

// ---------------------------------------------------------------------------
// Validasi single-entry lama — tetap berlaku sampai tab BKU pindah ke jurnal.
// ---------------------------------------------------------------------------

const BASE = {
  tanggal: '2025-03-12',
  keterangan: 'Parkir',
  akun_kas: '1015',
  kategori: '4001',
  masuk: 100_000,
  keluar: 0,
};

describe('validasi single-entry lama', () => {
  it('input valid lolos dan tanggal kalender tetap dijaga', () => {
    expect(validateTransaksiInput(BASE)).toEqual([]);
    expect(validateTransaksiInput({ ...BASE, tanggal: '2025-02-31' }).length).toBeGreaterThan(0);
    expect(validateTransaksiInput({ ...BASE, tanggal: '12-03-2025' }).length).toBeGreaterThan(0);
    expect(validateTransaksiInput({ ...BASE, keterangan: '  ' }).length).toBeGreaterThan(0);
  });

  it('menolak nominal 0, dua sisi terisi, dan kategori sistem', () => {
    expect(validateTransaksiInput({ ...BASE, masuk: 0 }).length).toBeGreaterThan(0);
    expect(validateTransaksiInput({ ...BASE, masuk: 5, keluar: 5 }).length).toBeGreaterThan(0);
    expect(validateTransaksiInput({ ...BASE, kategori: 'PANJAR' }).length).toBeGreaterThan(0);
  });

  it('validatePanjarItems menolak rincian kosong/baga salah/nominal 0', () => {
    expect(validatePanjarItems([]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '4001', nominal: 100 }]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '5004', nominal: 0 }]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '5004', nominal: 100 }])).toEqual([]);
  });
});
