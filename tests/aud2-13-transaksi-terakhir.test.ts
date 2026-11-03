// AUD2-13 — tabel transaksi terakhir + koreksi cepat di halaman Transaksi.
//
// Fokus:
// - 10 jurnal terbaru dimuat dari `jurnalCari` dan diurutkan terbaru di atas.
// - Kolom/aksi tabel memakai data jurnal (nominal dari baris debit).
// - Jurnal panjar/pinjaman/tidak aktif tidak menawarkan pembatalan cepat.
// - Pembatalan mengirim alasan >= 5 karakter ke `api.jurnalReverse`.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AKUN_HUTANG } from '../src/db/coa.js';
import type { JurnalBaris } from '../src/core/types.js';
import type { JurnalLengkap } from '../src/renderer/lib/api.js';

const cari = vi.hoisted(() => vi.fn());
const reverse = vi.hoisted(() => vi.fn());

vi.mock('../src/renderer/lib/api.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/renderer/lib/api.js')>();
  return {
    ...actual,
    api: {
      ...actual.api,
      jurnalCari: cari,
      jurnalReverse: reverse,
    },
  };
});

import {
  BatalkanJurnalModal,
  TransaksiTab,
  TransaksiTerakhirCard,
  alasanPembatalanCukup,
  batalkanJurnal,
  bisaDibatalkan,
  muatTransaksiTerakhir,
  nominalJurnal,
} from '../src/renderer/components/TransaksiTab.js';

function baris(
  akun: string,
  debit: number,
  kredit = 0,
  id = 1,
): JurnalBaris {
  return {
    id,
    jurnal_id: 'j',
    akun_kode: akun,
    debit,
    kredit,
    keterangan: '',
  };
}

function jurnal(
  id: string,
  over: Partial<JurnalLengkap> = {},
): JurnalLengkap {
  const nominal = 15_000_000;
  return {
    id,
    tanggal: '2026-11-01',
    no_bukti: `JU-${id}`,
    keterangan: `Transaksi ${id}`,
    jenis: 'UMUM',
    grup_id: id,
    reversal_of: null,
    created_at: '2026-11-01T00:00:00.000Z',
    baris: [
      baris('1001', nominal, 0, 1),
      baris('4005', 0, nominal, 2),
    ],
    total_debit: nominal,
    reversal_id: null,
    ...over,
  };
}

function renderKartu(
  daftar: JurnalLengkap[],
  opsi: {
    memuat?: boolean;
    err?: string | null;
    info?: string | null;
  } = {},
): string {
  return renderToStaticMarkup(
    createElement(TransaksiTerakhirCard, {
      daftar,
      memuat: opsi.memuat ?? false,
      err: opsi.err ?? null,
      info: opsi.info ?? null,
      onLihat: () => undefined,
      onBatalkan: () => undefined,
    }),
  );
}

beforeEach(() => {
  cari.mockReset();
  reverse.mockReset();
});

describe('AUD2-13 — kartu transaksi terakhir', () => {
  it('menampilkan kolom, nominal, status, dan aksi untuk jurnal aktif', () => {
    const html = renderKartu([
      jurnal('j1', { jenis: 'TERIMA', no_bukti: 'JU-2026-0001' }),
      jurnal('j2', { jenis: 'PANJAR', no_bukti: 'PJ-2026-0001' }),
    ]);

    expect(html).toContain('Transaksi Terakhir yang Dicatat');
    expect(html).toContain('Tanggal');
    expect(html).toContain('No. Bukti');
    expect(html).toContain('Jenis');
    expect(html).toContain('Keterangan');
    expect(html).toContain('Nominal');
    expect(html).toContain('Status');
    expect(html).toContain('Terima Uang');
    expect(html).toContain('Rp 150.000');
    expect(html).toContain('Aktif');
    expect(html).toContain('>Lihat</button>');
    // Hanya jurnal aktif non-panjar yang boleh dibatalkan cepat.
    expect(html.match(/Batalkan \/ Salah Input/g)).toHaveLength(1);
  });

  it('menandai jurnal balik / sudah dikoreksi tanpa tombol pembatalan', () => {
    const html = renderKartu([
      jurnal('rev', { jenis: 'REVERSAL', reversal_of: 'j1' }),
      jurnal('lama', { reversal_id: 'rev' }),
    ]);

    expect(html).toContain('Jurnal balik');
    expect(html).toContain('Sudah dikoreksi');
    expect(html).not.toContain('Batalkan / Salah Input');
  });

  it('menampilkan status memuat, kosong, dan gagal memuat', () => {
    expect(renderKartu([], { memuat: true })).toContain(
      'Memuat transaksi terakhir…',
    );
    expect(renderKartu([])).toContain('Belum ada transaksi yang dicatat.');
    expect(renderKartu([], { err: 'Gagal memuat jurnal.' })).toContain(
      'Transaksi terakhir gagal dimuat.',
    );
  });

  it('halaman Transaksi memuat kartu ini tanpa menyebut Mode Lanjutan', () => {
    const html = renderToStaticMarkup(
      createElement(TransaksiTab, { onBukaTab: () => undefined }),
    );
    expect(html).toContain('Transaksi Terakhir yang Dicatat');
    expect(html).not.toContain('Mode Lanjutan');
  });
});

describe('AUD2-13 — aturan pembatalan cepat', () => {
  it('hanya jurnal aktif non-panjar/pinjaman yang boleh dibatalkan', () => {
    expect(bisaDibatalkan(jurnal('umum'))).toBe(true);
    expect(
      bisaDibatalkan(jurnal('terima', { jenis: 'TERIMA' })),
    ).toBe(true);
    expect(bisaDibatalkan(jurnal('panjar', { jenis: 'PANJAR' }))).toBe(false);
    expect(
      bisaDibatalkan(jurnal('saldo-awal', { jenis: 'SALDO_AWAL' })),
    ).toBe(false);
    expect(
      bisaDibatalkan(jurnal('balik', { jenis: 'REVERSAL', reversal_of: 'x' })),
    ).toBe(false);
    expect(bisaDibatalkan(jurnal('koreksi', { reversal_id: 'rev' }))).toBe(
      false,
    );

    // HUTANG 2050 = pinjaman LPD; HUTANG 2060 = utang usaha biasa.
    expect(
      bisaDibatalkan(
        jurnal('pinjaman', {
          jenis: 'HUTANG',
          baris: [baris(AKUN_HUTANG, 150_000)],
        }),
      ),
    ).toBe(false);
    expect(
      bisaDibatalkan(
        jurnal('utang-usaha', {
          jenis: 'HUTANG',
          baris: [baris('2060', 150_000)],
        }),
      ),
    ).toBe(true);
  });

  it('menghitung nominal dari total debit baris', () => {
    expect(
      nominalJurnal(
        jurnal('j1', {
          total_debit: 999,
          baris: [baris('1001', 100_000), baris('5000', 50_000)],
        }),
      ),
    ).toBe(150_000);
    expect(nominalJurnal({ baris: [], total_debit: 123_400 })).toBe(123_400);
  });

  it('mewajibkan alasan minimal 5 karakter', () => {
    expect(alasanPembatalanCukup('ok')).toBe(false);
    expect(alasanPembatalanCukup('  ok  ')).toBe(false);
    expect(alasanPembatalanCukup('salah')).toBe(true);
    expect(alasanPembatalanCukup('  salah ketik  ')).toBe(true);
  });
});

describe('AUD2-13 — pemuatan & pengiriman pembatalan', () => {
  it('memuat 10 jurnal terbaru dan mengurutkan yang paling baru di atas', async () => {
    cari.mockResolvedValueOnce({
      rows: [jurnal('j1'), jurnal('j2'), jurnal('j3')],
      total: 3,
    });

    const hasil = await muatTransaksiTerakhir();

    expect(cari).toHaveBeenCalledTimes(1);
    expect(cari).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    expect(hasil.map((j) => j.id)).toEqual(['j3', 'j2', 'j1']);
  });

  it('mengambil halaman terakhir bila jurnal lebih dari 10', async () => {
    const awal = Array.from({ length: 10 }, (_, i) => jurnal(`j${i + 1}`));
    cari
      .mockResolvedValueOnce({ rows: awal, total: 12 })
      .mockResolvedValueOnce({
        rows: [jurnal('j11'), jurnal('j12')],
        total: 12,
      });

    const hasil = await muatTransaksiTerakhir();

    expect(cari).toHaveBeenNthCalledWith(1, { limit: 10, offset: 0 });
    expect(cari).toHaveBeenNthCalledWith(2, { limit: 10, offset: 2 });
    expect(hasil.map((j) => j.id)).toEqual(['j12', 'j11']);
  });

  it('memanggil jurnalReverse dengan alasan yang sudah dirapikan', async () => {
    reverse.mockResolvedValue({ jurnal: jurnal('rev') });

    await batalkanJurnal({ id: 'j1' }, '  salah ketik nominal  ');
    expect(reverse).toHaveBeenCalledWith('j1', 'salah ketik nominal');

    await batalkanJurnal({ id: 'j2' }, 'kas minus disetujui', true);
    expect(reverse).toHaveBeenCalledWith('j2', 'kas minus disetujui', {
      konfirmasiPeringatan: true,
    });

    await expect(batalkanJurnal({ id: 'j3' }, 'ok')).rejects.toThrow(
      /minimal 5 karakter/,
    );
    expect(reverse).toHaveBeenCalledTimes(2);
  });

  it('modal pembatalan meminta alasan dan menyebut jurnal asli tidak dihapus', () => {
    const html = renderToStaticMarkup(
      createElement(BatalkanJurnalModal, {
        jurnal: jurnal('j1'),
        onBatal: () => undefined,
        onSelesai: () => undefined,
      }),
    );

    expect(html).toContain('Batalkan / Salah Input');
    expect(html).toContain('Alasan pembatalan (min. 5 karakter)');
    expect(html).toContain('tidak dihapus');
    expect(html).toContain('Batalkan Transaksi');
    expect(html).toContain('Transaksi j1');
  });
});
