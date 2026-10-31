// DB-21 — kontrak API renderer untuk pembatalan panjar.
//
// Preload hanya mengekspos `window.api.invoke`; test ini memastikan argumen
// channel/urutan yang dikirim `api.panjarBatal` sesuai handler IPC dan error
// `perluAlasan` tetap diteruskan sebagai properti Error.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/renderer/lib/api.js';
import type { Panjar } from '../src/core/types.js';

const PANJAR: Panjar = {
  id: 'p-1',
  tanggal: '2026-02-01',
  penerima: 'Panitia Uji',
  jumlah: 100_000,
  akun_kas_sumber: '1001',
  status: 'DIBATALKAN',
  tanggal_close: null,
  jurnal_open_id: 'j-open',
  jurnal_close_id: null,
  jurnal_batal_id: 'j-batal',
  tanggal_batal: '2026-02-02',
  alasan_batal: 'Salah serah ke panitia',
  created_at: '2026-02-01T00:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('DB-21 — API panjar:batal', () => {
  it('mengirim id, alasan, dan opsi tanggal lewat channel panjar:batal', async () => {
    const invoke = vi.fn(async () => ({
      ok: true as const,
      data: {
        panjar: PANJAR,
        jurnal: {
          id: 'j-batal',
          tanggal: '2026-02-02',
          no_bukti: '',
          keterangan: 'KOREKSI: Serah panjar',
          jenis: 'REVERSAL',
          grup_id: 'j-open',
          reversal_of: 'j-open',
          created_at: '2026-02-02T00:00:00.000Z',
        },
      },
    }));
    vi.stubGlobal('window', { api: { invoke } });

    const hasil = await api.panjarBatal('p-1', 'Salah serah ke panitia', {
      tanggalBatal: '2026-02-02',
    });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      'panjar:batal',
      'p-1',
      'Salah serah ke panitia',
      { tanggalBatal: '2026-02-02' },
    );
    expect(hasil.panjar.status).toBe('DIBATALKAN');
    expect(hasil.jurnal?.jenis).toBe('REVERSAL');
  });

  it('meneruskan penolakan backend beserta flag perluAlasan/perluKonfirmasi', async () => {
    vi.stubGlobal('window', {
      api: {
        invoke: vi.fn(async () => ({
          ok: false as const,
          error: 'Periode sudah ditutup. Isi alasan pembatalan.',
          perluAlasan: true,
        })),
      },
    });

    await expect(api.panjarBatal('p-1', 'Salah serah')).rejects.toMatchObject({
      message: 'Periode sudah ditutup. Isi alasan pembatalan.',
      perluAlasan: true,
    });
  });
});
