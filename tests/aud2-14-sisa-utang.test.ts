// AUD2-14 — sisa Utang Usaha (2060) langsung di form Bayar Utang.
//
// Fokus:
// - Form BAYAR_UTANG memuat saldo 2060 s/d tanggal yang dipilih.
// - Kotak info menampilkan saldo dengan format Rupiah dan tombol pengisi
//   nominal hanya saat saldo > 0.
// - Hasil tanggal lama tidak boleh menimpa hasil tanggal yang lebih baru.
// - Gagal memuat tidak mengganggu form (pesan hanya di kotak info).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AKUN_HUTANG_USAHA, COA } from '../src/db/coa.js';
import type { BukuBesarHasil } from '../src/core/reports.js';

const bukuBesar = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/lib/api.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/renderer/lib/api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      laporanBukuBesar: bukuBesar,
    },
  };
});

import {
  FormTransaksiTerpandu,
  SisaUtangUsahaInfo,
  buatPemuatSisaUtang,
  muatSisaUtangUsaha,
  nominalSisaUtang,
  type StatusSisaUtang,
} from '../src/renderer/components/TransaksiForm.js';

const RP = (rupiah: number): number => rupiah * 100;

function renderInfo(
  status: StatusSisaUtang,
  onIsi: (nominal: number) => void = () => undefined,
): string {
  return renderToStaticMarkup(
    createElement(SisaUtangUsahaInfo, { status, onIsi }),
  );
}

function tertunda<T>(): {
  promise: Promise<T>;
  resolve: (nilai: T) => void;
  reject: (alasan: unknown) => void;
} {
  let resolve!: (nilai: T) => void;
  let reject!: (alasan: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  bukuBesar.mockReset();
});

describe('AUD2-14 — kotak sisa Utang Usaha', () => {
  it('menampilkan saldo 2060 dan tombol pengisi nominal saat saldo > 0', () => {
    const html = renderInfo({
      status: 'sukses',
      saldoAkhir: RP(1_500_000),
    });

    expect(html).toContain(
      'Sisa Utang Usaha (2060) saat ini: Rp 1.500.000',
    );
    expect(html).toContain('>Isi sesuai sisa utang</button>');
  });

  it('tidak menawarkan pengisi nominal saat saldo nol', () => {
    const html = renderInfo({ status: 'sukses', saldoAkhir: 0 });

    expect(html).toContain('Sisa Utang Usaha (2060) saat ini: Rp 0');
    expect(html).toContain('Tidak ada sisa utang usaha (2060)');
    expect(html).not.toContain('Isi sesuai sisa utang');
  });

  it('menjelaskan saldo negatif tanpa tombol pengisi nominal', () => {
    const html = renderInfo({
      status: 'sukses',
      saldoAkhir: RP(-150_000),
    });

    expect(html).toContain('Sisa Utang Usaha (2060) saat ini: (Rp 150.000)');
    expect(html).toContain('tidak menunjukkan utang yang perlu dibayar');
    expect(html).not.toContain('Isi sesuai sisa utang');
  });

  it('menampilkan status memuat dan gagal tanpa merusak form', () => {
    expect(renderInfo({ status: 'memuat' })).toContain(
      'Memuat sisa Utang Usaha (2060)…',
    );

    const gagal = renderInfo({
      status: 'gagal',
      pesan: 'Koneksi ke database terputus.',
    });
    expect(gagal).toContain('Sisa Utang Usaha (2060) gagal dimuat.');
    expect(gagal).toContain('Koneksi ke database terputus.');
    expect(gagal).toContain('Form tetap bisa diisi manual.');
    expect(gagal).not.toContain('Isi sesuai sisa utang');
  });

  it('mengisi nominal persis sebesar saldo akhir (dalam sen)', () => {
    expect(nominalSisaUtang(RP(1_500_000))).toBe(RP(1_500_000));
    expect(nominalSisaUtang(0)).toBeNull();
    expect(nominalSisaUtang(RP(-1))).toBeNull();
    expect(nominalSisaUtang(1_500_000.5)).toBeNull();
  });
});

describe('AUD2-14 — pemuatan saldo 2060', () => {
  it('memanggil laporan buku besar 2060 sampai tanggal yang dipilih', async () => {
    bukuBesar.mockResolvedValueOnce({
      kode: AKUN_HUTANG_USAHA,
      saldoAkhir: RP(1_500_000),
    } as unknown as BukuBesarHasil);

    await expect(muatSisaUtangUsaha('2026-11-03')).resolves.toBe(
      RP(1_500_000),
    );
    expect(bukuBesar).toHaveBeenCalledWith({
      akun_kode: '2060',
      sampai: '2026-11-03',
    });
  });

  it('memuat ulang untuk setiap tanggal yang diminta', async () => {
    const ambil = vi.fn().mockResolvedValue(RP(100_000));
    const pemuat = buatPemuatSisaUtang(ambil);

    await pemuat.muat('2026-11-01');
    await pemuat.muat('2026-11-02');

    expect(ambil.mock.calls.map(([tanggal]) => tanggal)).toEqual([
      '2026-11-01',
      '2026-11-02',
    ]);
  });

  it('mengabaikan hasil tanggal lama yang datang setelah tanggal baru', async () => {
    const lama = tertunda<number>();
    const baru = tertunda<number>();
    const pemuat = buatPemuatSisaUtang((tanggal) =>
      tanggal === '2026-11-01' ? lama.promise : baru.promise,
    );

    const hasilLama = pemuat.muat('2026-11-01');
    const hasilBaru = pemuat.muat('2026-11-03');

    baru.resolve(RP(900_000));
    await expect(hasilBaru).resolves.toBe(RP(900_000));

    lama.resolve(RP(100_000));
    await expect(hasilLama).resolves.toBeNull();
  });

  it('membatalkan hasil yang masih berjalan saat form ditinggalkan', async () => {
    const berjalan = tertunda<number>();
    const pemuat = buatPemuatSisaUtang(() => berjalan.promise);

    const hasil = pemuat.muat('2026-11-03');
    pemuat.batalkan();
    berjalan.resolve(RP(500_000));

    await expect(hasil).resolves.toBeNull();
  });
});

describe('AUD2-14 — integrasi form Bayar Utang', () => {
  it('form BAYAR_UTANG menampilkan kotak sisa utang di atas isian', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'BAYAR_UTANG',
        coa: COA,
        memuat: false,
      }),
    );

    expect(html).toContain('Bayar Utang Usaha');
    expect(html).toContain('data-testid="sisa-utang-usaha"');
    expect(html).toContain('Memuat sisa Utang Usaha (2060)…');
    expect(html.indexOf('data-testid="sisa-utang-usaha"')).toBeLessThan(
      html.indexOf('Pratinjau Jurnal (untuk diperiksa)'),
    );
  });

  it('form jenis lain tidak menampilkan kotak sisa utang', () => {
    const html = renderToStaticMarkup(
      createElement(FormTransaksiTerpandu, {
        jenis: 'TERIMA',
        coa: COA,
        memuat: false,
      }),
    );

    expect(html).not.toContain('Sisa Utang Usaha (2060)');
  });
});
