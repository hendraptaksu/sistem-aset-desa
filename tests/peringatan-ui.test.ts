// AKT-07: alasan konfirmasi peringatan posting.
// Fokus: guard 5 karakter, payload opsi IPC (wajib alasan + alasan bersih),
// render modal alasan, dan pemisahan dari alasan kunci periode (LockModal).

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MIN_ALASAN_PERINGATAN,
  PESAN_ALASAN_PERINGATAN_MIN,
  alasanPeringatanCukup,
  opsiPeringatanApi,
  rapikanAlasanPeringatan,
} from '../src/renderer/lib/peringatan.js';
import {
  LockModal,
  PeringatanModal,
} from '../src/renderer/components/ui.js';

function tombol(html: string, label: string): string | undefined {
  return html
    .split('<button')
    .find((s) => s.includes(`>${label}</button>`));
}

describe('AKT-07 — guard alasan peringatan', () => {
  it('mewajibkan minimal 5 karakter setelah spasi tepi dibuang', () => {
    expect(MIN_ALASAN_PERINGATAN).toBe(5);
    expect(alasanPeringatanCukup('')).toBe(false);
    expect(alasanPeringatanCukup('    ')).toBe(false);
    expect(alasanPeringatanCukup('ok')).toBe(false);
    expect(alasanPeringatanCukup('  kas minus  ')).toBe(true);
    expect(rapikanAlasanPeringatan('  kas minus  ')).toBe('kas minus');
    expect(PESAN_ALASAN_PERINGATAN_MIN).toMatch(/minimal 5 karakter/i);
  });

  it('membentuk payload IPC yang selalu mewajibkan alasan', () => {
    expect(opsiPeringatanApi('  Kas minus disetujui pemilik  ')).toEqual({
      alasanPeringatan: 'Kas minus disetujui pemilik',
      wajibAlasanPeringatan: true,
    });
    // Alasan kosong tidak dikirim sebagai string kosong, tetapi kewajiban tetap
    // aktif sehingga backend menolak konfirmasi tanpa alasan.
    expect(opsiPeringatanApi('   ')).toEqual({ wajibAlasanPeringatan: true });
    expect(opsiPeringatanApi(undefined)).toEqual({
      wajibAlasanPeringatan: true,
    });
  });
});

describe('AKT-07 — modal alasan konfirmasi peringatan', () => {
  it('menampilkan peringatan, field alasan, dan tombol konfirmasi nonaktif', () => {
    const html = renderToStaticMarkup(
      createElement(PeringatanModal, {
        pesan: 'Jurnal akan membuat saldo kas 1001 minus Rp 50.000,00.',
        onCancel: () => undefined,
        onSubmit: () => undefined,
      }),
    );

    expect(html).toContain('Konfirmasi peringatan');
    expect(html).toContain(
      'Jurnal akan membuat saldo kas 1001 minus Rp 50.000,00.',
    );
    expect(html).toContain(
      `Alasan tetap menyimpan (min. ${MIN_ALASAN_PERINGATAN} karakter)`,
    );
    expect(html).toContain('tercatat di audit');
    expect(html).toContain('Batal');

    const ya = tombol(html, 'Ya, tetap simpan');
    expect(ya).toBeDefined();
    // Modal baru terbuka tanpa alasan: tombol tidak boleh bisa diklik.
    expect(ya).toContain('disabled');
  });

  it('menampilkan penolakan backend agar operator memperbaiki alasan', () => {
    const html = renderToStaticMarkup(
      createElement(PeringatanModal, {
        pesan: 'Kas akan minus.',
        pesanError: PESAN_ALASAN_PERINGATAN_MIN,
        onCancel: () => undefined,
        onSubmit: () => undefined,
      }),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain(PESAN_ALASAN_PERINGATAN_MIN);
    expect(tombol(html, 'Ya, tetap simpan')).toContain('disabled');
  });

  it('tetap memisahkan alasan kunci periode di LockModal', () => {
    const html = renderToStaticMarkup(
      createElement(LockModal, {
        onCancel: () => undefined,
        onSubmit: () => undefined,
      }),
    );

    expect(html).toContain('Periode sudah ditutup');
    expect(html).toContain('Alasan (min. 5 karakter)');
    expect(html).toContain('koreksi struk susulan Desember');
    expect(html).not.toContain('Konfirmasi peringatan');
    expect(html).not.toContain('Ya, tetap simpan');
  });
});
