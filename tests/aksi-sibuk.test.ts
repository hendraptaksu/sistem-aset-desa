// P1-12: guard anti double-submit murni (tanpa jsdom).
// Ref harus dikunci secara sinkron sehingga klik kedua tidak mengirim IPC dua kali.

import { describe, expect, it } from 'vitest';
import { guardSibuk, type RefSibuk } from '../src/renderer/lib/aksiSibuk.js';

describe('P1-12 — guardSibuk', () => {
  it('hanya menjalankan aksi pertama dan mengabaikan klik kedua', async () => {
    const ref: RefSibuk = { current: false };
    let jumlahJalan = 0;
    let selesai: () => void = () => {};
    const tunda = new Promise<void>((resolve) => {
      selesai = resolve;
    });

    const pertama = guardSibuk(ref, async () => {
      jumlahJalan += 1;
      await tunda;
      return 'pertama';
    });
    const kedua = guardSibuk(ref, async () => {
      jumlahJalan += 1;
      return 'kedua';
    });

    expect(ref.current).toBe(true);
    expect(await kedua).toBeUndefined();
    expect(jumlahJalan).toBe(1);

    selesai();
    expect(await pertama).toBe('pertama');
    expect(ref.current).toBe(false);
    expect(jumlahJalan).toBe(1);
  });

  it('membuka kunci lagi setelah aksi gagal sehingga operator bisa mencoba ulang', async () => {
    const ref: RefSibuk = { current: false };
    await expect(
      guardSibuk(ref, async () => {
        throw new Error('Gagal menyimpan.');
      }),
    ).rejects.toThrow('Gagal menyimpan.');
    expect(ref.current).toBe(false);

    const hasil = await guardSibuk(ref, async () => 'coba lagi');
    expect(hasil).toBe('coba lagi');
    expect(ref.current).toBe(false);
  });
});
