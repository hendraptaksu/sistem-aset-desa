import type { PinjamanAngsuranStatus } from './types.js';

/** Status berdasarkan kewajiban yang terselesaikan, bukan keberadaan kuitansi. */
export function ringkasanAngsuran(
  jadwal: { pokok: number; bunga: number },
  realisasi: { pokok: number; bunga: number; denda?: number },
): {
  status: PinjamanAngsuranStatus;
  dibayar: boolean;
  pokok_dibayar: number;
  bunga_dibayar: number;
  sisa_pokok: number;
  sisa_bunga: number;
} {
  const sisaPokok = Math.max(0, jadwal.pokok - realisasi.pokok);
  const sisaBunga = Math.max(0, jadwal.bunga - realisasi.bunga);
  const lunas = sisaPokok === 0 && sisaBunga === 0;
  return {
    status: lunas
      ? 'LUNAS'
      : realisasi.pokok > 0 || realisasi.bunga > 0 || (realisasi.denda ?? 0) > 0
        ? 'SEBAGIAN'
        : 'BELUM',
    dibayar: lunas,
    pokok_dibayar: realisasi.pokok,
    bunga_dibayar: realisasi.bunga,
    sisa_pokok: sisaPokok,
    sisa_bunga: sisaBunga,
  };
}
