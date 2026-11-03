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
  validasiAlasanAkun,
  validasiBentukJurnalInput,
  validasiBentukKoreksiInput,
  validasiBentukPanjarClose,
  validasiBentukPanjarSerah,
  validasiBentukPembatalanPertanggungjawabanPanjar,
  validasiBentukSaldoAwal,
  validasiBentukTransaksiInput,
  validasiCutoffLaporan,
  validasiFilterBukuBesar,
  validasiFilterJurnalCari,
  validasiFilterNeraca,
  validasiFilterNeracaSaldo,
  validasiKodeAkun,
  validasiRentangLaporan,
  validasiStatusAkunAktif,
  validasiTanggalOpsional,
  validatePanjarItems,
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
    ).toMatch(/2050 HUTANG LAIN-LAIN.*2060 HUTANG USAHA/);

    // Pasangan yang benar untuk tiap jenis tidak menghasilkan error jenis.
    expect(jalankan({ header: { jenis: 'TRANSFER' }, baris: pasangan('1029', '1001') }).boleh).toBe(true);
    expect(jalankan({ header: { jenis: 'PANJAR' }, baris: pasangan('1040', '1001') }).boleh).toBe(true);
    expect(jalankan({ header: { jenis: 'PIUTANG' }, baris: pasangan('1050', '1001') }).boleh).toBe(true);
    expect(jalankan({ header: { jenis: 'HUTANG' }, baris: pasangan('1001', '2050') }).boleh).toBe(true);
    expect(jalankan({ header: { jenis: 'HUTANG' }, baris: pasangan('1001', '2060') }).boleh).toBe(true);
  });

  it('menolak jurnal ber-kas yang memuat 2050 dan 2060 sekaligus, tetapi reklasifikasi non-kas boleh', () => {
    const campuran = jalankan({
      header: { jenis: 'UMUM' },
      baris: [
        { akun_kode: '2050', debit: 100_000, kredit: 0 },
        { akun_kode: '2060', debit: 0, kredit: 50_000 },
        { akun_kode: '1001', debit: 0, kredit: 50_000 },
      ],
    });
    expect(pesan(campuran)).toMatch(/Pisahkan pembayaran utang usaha dan pinjaman/);

    // AUD2-04: 2050 adalah akun kontrol pinjaman, jadi reklasifikasi lewat
    // Jurnal Umum manual ikut ditolak. Reklasifikasi non-kas tetap bisa dicatat
    // lewat jenis internal HUTANG.
    const reklasUmum = jalankan({
      header: { jenis: 'UMUM' },
      baris: [
        { akun_kode: '2050', debit: 100_000, kredit: 0 },
        { akun_kode: '2060', debit: 0, kredit: 100_000 },
      ],
    });
    expect(pesan(reklasUmum)).toMatch(
      /Akun 2050 HUTANG LAIN-LAIN adalah akun kontrol pinjaman/,
    );
    expect(reklasUmum.boleh).toBe(false);

    const reklas = jalankan({
      header: { jenis: 'HUTANG' },
      baris: [
        { akun_kode: '2050', debit: 100_000, kredit: 0 },
        { akun_kode: '2060', debit: 0, kredit: 100_000 },
      ],
    });
    expect(reklas.errors).toEqual([]);
    expect(reklas.boleh).toBe(true);
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
    expect(pesan(hasil)).toMatch(/Rp 1\.000(?!\d|[.,]\d)/);
    expect(pesan(hasil)).toMatch(/Rp 900(?!\d|[.,]\d)/);
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
    expect(hasil.peringatan.join(' ')).toMatch(/Rp 500(?!\d|[.,]\d)/);
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
// DB-03 — pemisahan validator jalur manual vs form terpandu di IPC.
// ---------------------------------------------------------------------------

describe('DB-03 — jalur manual hanya UMUM, transaksi terpandu hanya dokumennya', () => {
  function bentuk(jenis?: JurnalJenis, baris = pasangan()) {
    return {
      header: header({
        ...(jenis ? { jenis } : {}),
      }),
      baris,
    };
  }

  it('manual menerima UMUM dan header tanpa jenis (dinormalisasi UMUM)', () => {
    for (const input of [bentuk('UMUM'), bentuk()]) {
      const hasil = validasiBentukJurnalInput(input);
      expect(hasil.ok).toBe(true);
      if (hasil.ok) expect(hasil.input.header.jenis).toBe('UMUM');
    }
  });

  it('manual menolak PANJAR/PIUTANG/HUTANG/TERIMA/BAYAR/TRANSFER/SALDO_AWAL/REVERSAL', () => {
    const ditolak: JurnalJenis[] = [
      'PANJAR',
      'PIUTANG',
      'HUTANG',
      'TERIMA',
      'BAYAR',
      'TRANSFER',
      'SALDO_AWAL',
      'REVERSAL',
    ];
    for (const jenis of ditolak) {
      const hasil = validasiBentukJurnalInput(bentuk(jenis));
      expect(hasil.ok, jenis).toBe(false);
      if (!hasil.ok) {
        expect(hasil.error, jenis).toMatch(/hanya menerima jenis UMUM/i);
        expect(hasil.error, jenis).toContain(jenis);
      }
    }
  });

  it('transaksi terpandu menerima TERIMA/BAYAR/TRANSFER/HUTANG', () => {
    for (const jenis of ['TERIMA', 'BAYAR', 'TRANSFER', 'HUTANG'] as const) {
      const hasil = validasiBentukTransaksiInput(bentuk(jenis));
      expect(hasil.ok, jenis).toBe(true);
      if (hasil.ok) expect(hasil.input.header.jenis).toBe(jenis);
    }
  });

  it('transaksi terpandu menolak UMUM, PANJAR, PIUTANG, SALDO_AWAL, REVERSAL, dan jenis kosong', () => {
    for (const input of [
      bentuk('UMUM'),
      bentuk('PANJAR'),
      bentuk('PIUTANG'),
      bentuk('SALDO_AWAL'),
      bentuk('REVERSAL'),
      bentuk(),
    ]) {
      const hasil = validasiBentukTransaksiInput(input);
      expect(hasil.ok).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(/hanya menerima jenis/i);
    }
  });

  it('jenis asing tetap mendapat pesan jenis tidak dikenal', () => {
    const manual = validasiBentukJurnalInput(bentuk('NGARANG' as JurnalJenis));
    expect(manual.ok).toBe(false);
    if (!manual.ok) expect(manual.error).toMatch(/Jenis jurnal tidak dikenal/i);
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
      jenis: 'UMUM',
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

  it('AUD-21b: mode Neraca Saldo default tahun dan bentuk lama tetap diterima', () => {
    expect(validasiFilterNeracaSaldo({ cutoff: '2026-10-27' })).toEqual({
      ok: true,
      input: { cutoff: '2026-10-27', mode: 'tahun' },
    });
    expect(
      validasiFilterNeracaSaldo({ cutoff: '2026-10-27', mode: 'kumulatif' }),
    ).toEqual({
      ok: true,
      input: { cutoff: '2026-10-27', mode: 'kumulatif' },
    });
    // Pemanggil lama hanya mengirim string cut-off: tetap jalan, mode aman.
    expect(validasiFilterNeracaSaldo('2026-10-27')).toEqual({
      ok: true,
      input: { cutoff: '2026-10-27', mode: 'tahun' },
    });
  });

  it('AUD-21b: menolak mode tak dikenal dan cut-off tidak valid', () => {
    for (const nilai of [
      { cutoff: '2026-10-27', mode: 'semua' },
      { cutoff: '2026-10-27', mode: 1 },
      { cutoff: '2026-02-30', mode: 'tahun' },
      { mode: 'tahun' },
      '2026-02-30',
      null,
    ]) {
      const hasil = validasiFilterNeracaSaldo(nilai);
      expect(hasil.ok, JSON.stringify(nilai)).toBe(false);
    }
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

describe('AKT-22 — bentuk input koreksi & isi ulang', () => {
  const koreksi = {
    header: {
      id: '',
      tanggal: '2026-03-12',
      keterangan: 'Jurnal pengganti',
      no_bukti: 'JU-2026-9002',
      jenis: 'TERIMA',
    },
    baris: pasangan(),
  };

  it('menerima ID kosong (dibuat main) dan tidak meneruskan grup/reversal_of', () => {
    const hasil = validasiBentukKoreksiInput({
      ...koreksi,
      header: {
        ...koreksi.header,
        id: '   ',
        no_bukti: '  JU-2026-9002  ',
        grup_id: 'g-diabaikan',
        reversal_of: null,
      },
      alasan: '  koreksi nominal  ',
      extra: 'diabaikan',
    });
    expect(hasil.ok).toBe(true);
    if (!hasil.ok) return;

    expect(hasil.input.header).toMatchObject({
      id: '',
      tanggal: '2026-03-12',
      keterangan: 'Jurnal pengganti',
      no_bukti: 'JU-2026-9002',
      jenis: 'TERIMA',
    });
    expect(hasil.input.header).not.toHaveProperty('grup_id');
    expect(hasil.input.header).not.toHaveProperty('reversal_of');
    expect(hasil.input.alasan).toBe('koreksi nominal');
  });

  it('menolak ID/keterangan/no bukti yang terlalu panjang', () => {
    for (const header of [
      { ...koreksi.header, id: 'j'.repeat(201) },
      { ...koreksi.header, keterangan: 'k'.repeat(1001) },
      { ...koreksi.header, no_bukti: 'B'.repeat(101) },
    ]) {
      const hasil = validasiBentukKoreksiInput({ ...koreksi, header });
      expect(hasil.ok).toBe(false);
    }
  });

  it('menolak field wajib kosong, jenis REVERSAL, dan baris tidak valid', () => {
    expect(
      validasiBentukKoreksiInput({
        ...koreksi,
        header: { ...koreksi.header, keterangan: '   ' },
      }).ok,
    ).toBe(false);
    expect(
      validasiBentukKoreksiInput({
        ...koreksi,
        header: { ...koreksi.header, tanggal: '' },
      }).ok,
    ).toBe(false);
    expect(
      validasiBentukKoreksiInput({
        ...koreksi,
        header: { ...koreksi.header, jenis: 'REVERSAL' },
      }).ok,
    ).toBe(false);
    expect(
      validasiBentukKoreksiInput({
        ...koreksi,
        header: { ...koreksi.header, reversal_of: 'j-lain' },
      }).ok,
    ).toBe(false);
    expect(
      validasiBentukKoreksiInput({ ...koreksi, baris: [koreksi.baris[0]] }).ok,
    ).toBe(false);
    expect(
      validasiBentukKoreksiInput({
        ...koreksi,
        baris: [koreksi.baris[0], { ...koreksi.baris[1], debit: 1.5, kredit: 0 }],
      }).ok,
    ).toBe(false);
  });

  it('mengizinkan SALDO_AWAL pada bentuk; keputusan akhir di DB', () => {
    const hasil = validasiBentukKoreksiInput({
      ...koreksi,
      header: { ...koreksi.header, jenis: 'SALDO_AWAL' },
      baris: pasangan('1001', '3000'),
    });
    expect(hasil.ok).toBe(true);
    if (hasil.ok) expect(hasil.input.header.jenis).toBe('SALDO_AWAL');
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

describe('DB-15 — bentuk IPC status akun', () => {
  it('menerima kode 4 digit, status boolean, dan alasan opsional', () => {
    expect(validasiKodeAkun(' 5010 ')).toEqual({ ok: true, input: '5010' });
    expect(validasiStatusAkunAktif(false)).toEqual({ ok: true, input: false });
    expect(validasiStatusAkunAktif(true)).toEqual({ ok: true, input: true });
    expect(validasiAlasanAkun(undefined)).toEqual({ ok: true, input: '' });
    expect(validasiAlasanAkun('  Digantikan 5060  ')).toEqual({
      ok: true,
      input: 'Digantikan 5060',
    });
  });

  it('menolak kode/status/alasan dengan bentuk salah', () => {
    expect(validasiKodeAkun('300')).toMatchObject({ ok: false });
    expect(validasiKodeAkun('30a0')).toMatchObject({ ok: false });
    expect(validasiStatusAkunAktif('false')).toMatchObject({
      ok: false,
      error: expect.stringMatching(/true\/false/i),
    });
    expect(validasiStatusAkunAktif(0)).toMatchObject({ ok: false });
    expect(validasiAlasanAkun(123)).toMatchObject({ ok: false });
    expect(validasiAlasanAkun('x'.repeat(201))).toMatchObject({
      ok: false,
      error: expect.stringMatching(/maks\. 200/i),
    });
  });
});

// ---------------------------------------------------------------------------
// Validasi legacy panjar — bentuk item masih dipakai sebagai jaring pengaman.
// ---------------------------------------------------------------------------

describe('validasi legacy panjar', () => {
  it('validatePanjarItems menolak rincian kosong/baga salah/nominal 0', () => {
    expect(validatePanjarItems([]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '4001', nominal: 100 }]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '5004', nominal: 0 }]).length).toBeGreaterThan(0);
    expect(validatePanjarItems([{ kategori_baga: '5004', nominal: 100 }])).toEqual([]);
  });
});

describe('DB-18 — validasi bentuk close panjar dengan detail nota', () => {
  it('meneruskan field nota yang valid dan mengizinkan field kosong (legacy)', () => {
    const denganNota = validasiBentukPanjarClose({
      id: 'p-1',
      tanggalClose: '2026-03-01',
      items: [
        {
          kategori_baga: '5004',
          nominal: 100_000,
          nota_nomor: 'N-001',
          nota_tanggal: '2026-02-10',
          toko: 'Toko A',
          keterangan: 'konsumsi',
        },
      ],
    });
    expect(denganNota.ok).toBe(true);
    if (denganNota.ok)
      expect(denganNota.input.items[0]).toEqual({
        kategori_baga: '5004',
        nominal: 100_000,
        nota_nomor: 'N-001',
        nota_tanggal: '2026-02-10',
        toko: 'Toko A',
        keterangan: 'konsumsi',
      });

    const legacy = validasiBentukPanjarClose({
      id: 'p-1',
      tanggalClose: '2026-03-01',
      items: [{ kategori_baga: '5004', nominal: 100_000 }],
    });
    expect(legacy.ok).toBe(true);
    if (legacy.ok)
      expect(legacy.input.items[0]).toMatchObject({
        nota_nomor: '',
        nota_tanggal: '',
        toko: '',
        keterangan: '',
      });
  });

  it('menolak tanggal nota setelah tanggal close, tanggal salah, dan teks kepanjangan', () => {
    const dasar = {
      id: 'p-1',
      tanggalClose: '2026-03-01',
      items: [{ kategori_baga: '5004', nominal: 100_000 }],
    };
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ nota_tanggal: '2026-03-02' }, /tidak boleh setelah/i],
      [{ nota_tanggal: '2026-02-31' }, /tanggal nota tidak valid/i],
      [{ nota_nomor: 'x'.repeat(101) }, /nomor nota maks\. 100/i],
      [{ toko: 'x'.repeat(201) }, /toko\/penerima maks\. 200/i],
      [{ keterangan: 'x'.repeat(501) }, /keterangan maks\. 500/i],
    ];
    for (const [nota, pola] of cases) {
      const hasil = validasiBentukPanjarClose({
        ...dasar,
        items: [{ ...dasar.items[0], ...nota }],
      });
      expect(hasil.ok, String(nota)).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(pola);
    }
  });
});

describe('AUD2-03 — validasi bentuk koreksi pertanggungjawaban panjar', () => {
  it('menormalisasi id/alasan/tanggal dan menolak bentuk tidak aman', () => {
    const lengkap = validasiBentukPembatalanPertanggungjawabanPanjar({
      id: '  p-1  ',
      alasan: '  Salah kategori realisasi  ',
      tanggalBatal: ' 2026-02-05 ',
    });
    expect(lengkap.ok).toBe(true);
    if (lengkap.ok)
      expect(lengkap.input).toEqual({
        id: 'p-1',
        alasan: 'Salah kategori realisasi',
        tanggalBatal: '2026-02-05',
      });

    const tanpaTanggal = validasiBentukPembatalanPertanggungjawabanPanjar({
      id: 'p-1',
      alasan: 'Salah kategori realisasi',
    });
    expect(tanpaTanggal.ok).toBe(true);
    if (tanpaTanggal.ok)
      expect(tanpaTanggal.input).toEqual({
        id: 'p-1',
        alasan: 'Salah kategori realisasi',
      });

    const cases: [unknown, RegExp][] = [
      [null, /tidak lengkap/i],
      [{}, /wajib dipilih/i],
      [{ id: 'p-1', alasan: 'sala' }, /minimal 5/i],
      [
        { id: 'p-1', alasan: 'Salah kategori', tanggalBatal: '2026-02-31' },
        /tanggal/i,
      ],
      [
        { id: 'p-1', alasan: 'Salah kategori', tanggalBatal: 20260205 },
        /tanggal/i,
      ],
    ];
    for (const [nilai, pola] of cases) {
      const hasil = validasiBentukPembatalanPertanggungjawabanPanjar(nilai);
      expect(hasil.ok, String(nilai)).toBe(false);
      if (!hasil.ok) expect(hasil.error).toMatch(pola);
    }
  });
});
