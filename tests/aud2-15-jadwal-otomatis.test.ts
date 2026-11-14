// AUD2-15 — generator jadwal angsuran otomatis di Pinjaman LPD.
//
// Fokus:
// - Pokok dibagi rata ke Rupiah penuh; baris terakhir menerima sisa sehingga
//   total selalu tepat sama dengan target pokok.
// - Jatuh tempo maju per bulan dengan aritmetika UTC yang aman untuk akhir
//   bulan dan tahun kabisat (tanpa pergeseran zona waktu).
// - Input bunga rencana + tombol generator hanya aktif saat target > 0 dan
//   tenor bulat >= 1, serta terpasang di form Pinjaman LPD.

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  buatJadwalAngsuranOtomatis,
  tambahBulanUtc,
} from '../src/core/pinjamanAngsuran.js';
import { openDb } from '../src/db/database.js';
import { buatPinjaman } from '../src/db/pinjaman.js';
import { formatRp } from '../src/utils/format.js';
import {
  KontrolJadwalOtomatis,
  PinjamanTab,
  bolehIsiJadwalOtomatis,
} from '../src/renderer/components/PinjamanTab.js';

const RP = (rupiah: number): number => rupiah * 100;
const TARGET = RP(10_000_000);

function renderKontrol(opsi: {
  targetPokok?: number;
  tenor?: string;
  bungaRencana?: number;
  busy?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(KontrolJadwalOtomatis, {
      targetPokok: opsi.targetPokok ?? 0,
      tenor: opsi.tenor ?? '12',
      bungaRencana: opsi.bungaRencana ?? 0,
      busy: opsi.busy ?? false,
      onBungaRencana: () => undefined,
      onIsi: () => undefined,
    }),
  );
}

describe('AUD2-15 — generator jadwal angsuran', () => {
  it('membagi pokok Rp 10.000.000 tenor 3 bulan sesuai tampilan Rupiah', () => {
    const rows = buatJadwalAngsuranOtomatis({
      targetPokok: TARGET,
      tenor: 3,
      tanggal: '2025-01-31',
      bunga: RP(100_000),
    });

    expect(rows.map((r) => r.ke)).toEqual([1, 2, 3]);
    // Nilai internal dalam sen; yang tampil ke operator adalah Rupiah di bawah.
    expect(rows.map((r) => r.pokok)).toEqual([
      333_333_300, 333_333_300, 333_333_400,
    ]);
    expect(rows.map((r) => formatRp(r.pokok))).toEqual([
      'Rp 3.333.333',
      'Rp 3.333.333',
      'Rp 3.333.334',
    ]);
    expect(rows.reduce((s, r) => s + r.pokok, 0)).toBe(TARGET);
    expect(rows.map((r) => r.jatuh_tempo)).toEqual([
      '2025-02-28',
      '2025-03-31',
      '2025-04-30',
    ]);
    expect(rows.every((r) => r.bunga === RP(100_000))).toBe(true);
    expect(rows.every((r) => r.catatan === '')).toBe(true);
  });

  it('selalu menghasilkan total pokok tepat untuk berbagai tenor', () => {
    for (const tenor of [1, 2, 3, 7, 12, 24, 60]) {
      const rows = buatJadwalAngsuranOtomatis({
        targetPokok: TARGET,
        tenor,
        tanggal: '2025-01-31',
      });
      expect(rows, `tenor ${tenor}`).toHaveLength(tenor);
      expect(
        rows.reduce((s, r) => s + r.pokok, 0),
        `total tenor ${tenor}`,
      ).toBe(TARGET);
      expect(rows.every((r) => Number.isSafeInteger(r.pokok))).toBe(true);
      expect(rows.at(-1)!.ke).toBe(tenor);
    }
  });

  it('mengisi bunga rencana ke semua baris dan nol bila tidak diisi', () => {
    const tanpaBunga = buatJadwalAngsuranOtomatis({
      targetPokok: TARGET,
      tenor: 2,
      tanggal: '2025-01-15',
    });
    expect(tanpaBunga.every((r) => r.bunga === 0)).toBe(true);

    const berbunga = buatJadwalAngsuranOtomatis({
      targetPokok: TARGET,
      tenor: 2,
      tanggal: '2025-01-15',
      bunga: RP(250_000),
    });
    expect(berbunga.every((r) => r.bunga === RP(250_000))).toBe(true);
  });

  it('menolak target pokok, tenor, atau bunga yang tidak valid', () => {
    for (const input of [
      { targetPokok: 0, tenor: 3 },
      { targetPokok: -1, tenor: 3 },
      { targetPokok: 1.5, tenor: 3 },
      { targetPokok: TARGET, tenor: 0 },
      { targetPokok: TARGET, tenor: -2 },
      { targetPokok: TARGET, tenor: 2.5 },
      { targetPokok: TARGET, tenor: 3, bunga: -1 },
      { targetPokok: TARGET, tenor: 3, bunga: 1.5 },
    ]) {
      expect(() =>
        buatJadwalAngsuranOtomatis({
          ...input,
          tanggal: '2025-01-31',
        }),
      ).toThrow(RangeError);
    }
  });
});

describe('AUD2-15 — jadwal otomatis lolos validasi pinjaman', () => {
  it('menerima jadwal otomatis normal tanpa baris nol atau tanggal mundur', () => {
    const db = openDb(':memory:');
    try {
      const rows = buatJadwalAngsuranOtomatis({
        targetPokok: TARGET,
        tenor: 12,
        tanggal: '2026-01-31',
        bunga: RP(100_000),
      });
      expect(rows.every((r) => r.pokok > 0)).toBe(true);
      expect(rows.every((r) => r.jatuh_tempo >= '2026-01-31')).toBe(true);

      const hasil = buatPinjaman(db, {
        kreditur: 'LPD Desa Adat',
        akun_kas: '1001',
        pokok_awal: TARGET,
        sisa_pokok_awal: TARGET,
        tanggal_mulai: '2026-01-31',
        tenor_bulan: 12,
        angsuran: rows,
      });

      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.pinjaman?.angsuran).toHaveLength(12);
      expect(hasil.pinjaman?.angsuran?.map((a) => a.jatuh_tempo)).toEqual(
        rows.map((r) => r.jatuh_tempo),
      );
      expect(
        hasil.pinjaman?.angsuran?.every(
          (a) => a.status === 'BELUM' && a.dibayar === false,
        ),
      ).toBe(true);
    } finally {
      db.close();
    }
  });
});

describe('AUD2-15 — tambah bulan UTC yang aman', () => {
  it('menjepit akhir bulan dan menangani tahun kabisat', () => {
    expect(tambahBulanUtc('2025-01-31', 0)).toBe('2025-01-31');
    expect(tambahBulanUtc('2025-01-31', 1)).toBe('2025-02-28');
    expect(tambahBulanUtc('2025-01-31', 2)).toBe('2025-03-31');
    expect(tambahBulanUtc('2024-01-31', 1)).toBe('2024-02-29');
    expect(tambahBulanUtc('2024-01-31', 2)).toBe('2024-03-31');
    expect(tambahBulanUtc('2025-03-31', 1)).toBe('2025-04-30');
    expect(tambahBulanUtc('2025-02-28', 1)).toBe('2025-03-28');
    expect(tambahBulanUtc('2025-12-31', 1)).toBe('2026-01-31');
  });

  it('tidak bergeser oleh zona waktu lokal mesin', () => {
    const tzAwal = process.env.TZ;
    try {
      for (const zona of [
        'UTC',
        'Asia/Makassar',
        'America/Los_Angeles',
        'Pacific/Kiritimati',
      ]) {
        process.env.TZ = zona;
        expect(tambahBulanUtc('2025-01-31', 1), zona).toBe('2025-02-28');
        expect(tambahBulanUtc('2025-03-31', 1), zona).toBe('2025-04-30');
      }
    } finally {
      if (tzAwal === undefined) delete process.env.TZ;
      else process.env.TZ = tzAwal;
    }
  });

  it('menolak tanggal atau jumlah bulan yang tidak valid', () => {
    expect(() => tambahBulanUtc('2025-02-30', 1)).toThrow(RangeError);
    expect(() => tambahBulanUtc('31-01-2025', 1)).toThrow(RangeError);
    expect(() => tambahBulanUtc('2025-01-31', 1.5)).toThrow(RangeError);
  });
});

describe('AUD2-15 — kontrol UI generator jadwal', () => {
  it('hanya aktif saat target pokok > 0 dan tenor bulat >= 1', () => {
    expect(bolehIsiJadwalOtomatis(TARGET, '3')).toBe(true);
    expect(bolehIsiJadwalOtomatis(TARGET, ' 12 ')).toBe(true);
    expect(bolehIsiJadwalOtomatis(TARGET, '')).toBe(false);
    expect(bolehIsiJadwalOtomatis(TARGET, '0')).toBe(false);
    expect(bolehIsiJadwalOtomatis(TARGET, '-1')).toBe(false);
    expect(bolehIsiJadwalOtomatis(TARGET, '2.5')).toBe(false);
    expect(bolehIsiJadwalOtomatis(0, '3')).toBe(false);
    expect(bolehIsiJadwalOtomatis(-1, '3')).toBe(false);
    expect(bolehIsiJadwalOtomatis(1.5, '3')).toBe(false);
  });

  it('menampilkan input bunga rencana, tombol, dan petunjuk jumlah baris', () => {
    const aktif = renderKontrol({
      targetPokok: TARGET,
      tenor: '3',
      bungaRencana: RP(100_000),
    });
    expect(aktif).toContain('Bunga rencana per bulan (Rp)');
    expect(aktif).toContain('>Isi Jadwal Otomatis dari Tenor</button>');
    expect(aktif).toContain('Membuat 3 baris');
    expect(aktif).toContain('Bunga rencana diisi ke setiap baris.');
    expect(aktif).not.toContain('disabled=""');

    const nonaktif = renderKontrol({ targetPokok: 0, tenor: '12' });
    expect(nonaktif).toContain('disabled=""');
    expect(nonaktif).toContain('tenor minimal 1 bulan');
    expect(nonaktif).not.toContain('Membuat 12 baris');
  });

  it('terpasang di bagian Jadwal angsuran pada form Pinjaman LPD', () => {
    const html = renderToStaticMarkup(createElement(PinjamanTab));
    expect(html).toContain('Jadwal angsuran (input manual)');
    expect(html).toContain('Bunga rencana per bulan (Rp)');
    expect(html).toContain('Isi Jadwal Otomatis dari Tenor');
    expect(html).toContain('+ Tambah angsuran');
  });

  it('menyambungkan generator ke state jadwal dan validasi total pokok', () => {
    const ui = readFileSync(
      new URL('../src/renderer/components/PinjamanTab.tsx', import.meta.url),
      'utf8',
    );
    expect(ui).toContain('buatJadwalAngsuranOtomatis');
    expect(ui).toContain('setJadwal(');
    expect(ui).toContain('cocokPokok');
    expect(ui).toContain('Ganti jadwal angsuran yang sudah ada?');
  });
});
