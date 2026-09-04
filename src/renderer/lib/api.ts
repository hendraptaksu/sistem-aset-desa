import type { Coa } from '../../db/coa.js';
import type { Panjar, PanjarItem, Transaksi, TutupBuku } from '../../core/types.js';

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: string; perluAlasan?: boolean };
type Res<T> = Ok<T> | Fail;

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: unknown[]) => Promise<Res<never>> };
  }
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await window.api.invoke(channel, ...args)) as Res<T>;
  if (!res.ok) {
    const err = new Error(res.error) as Error & { perluAlasan?: boolean };
    err.perluAlasan = (res as Fail).perluAlasan;
    throw err;
  }
  return res.data;
}

export const api = {
  coa: () => call<Coa[]>('coa:list'),
  transaksiList: (f: { mulai?: string; sampai?: string } = {}) => call<Transaksi[]>('transaksi:list', f),
  transaksiCreate: (input: {
    tanggal: string;
    keterangan: string;
    akun_kas: string;
    kategori: string;
    masuk: number;
    keluar: number;
  }, alasan?: string) => call<{ id: string }>('transaksi:create', input, alasan),
  panjarList: (status?: 'OPEN' | 'CLOSED') => call<Panjar[]>('panjar:list', status),
  panjarItems: (id: string) => call<PanjarItem[]>('panjar:items', id),
  panjarCreate: (input: { tanggal: string; penerima: string; jumlah: number; akun_kas_sumber: string }, alasan?: string) =>
    call<{ id: string }>('panjar:create', input, alasan),
  panjarClose: (req: { id: string; tanggalClose: string; items: { kategori_baga: string; nominal: number }[] }, alasan?: string) =>
    call<{ totalRealisasi: number; sisa: number; kurang: number }>('panjar:close', req, alasan),
  tutupList: () => call<TutupBuku[]>('tutup:list'),
  saldo: (cutoff?: string) => call<{ perKas: Record<string, number>; total: number }>('saldo:list', cutoff),
};

export function isPerluAlasan(e: unknown): boolean {
  return (e as { perluAlasan?: boolean })?.perluAlasan === true;
}
