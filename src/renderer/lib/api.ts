import type { Coa } from '../../db/coa.js';
import type { Aset, Panjar, PanjarItem, Transaksi, TutupBuku } from '../../core/types.js';
import type { Neraca } from '../../core/ledger.js';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: string; perluAlasan?: boolean };
type Res<T> = Ok<T> | Fail;

declare global {
  interface Window {
    api: { invoke: (channel: string, ...args: unknown[]) => Promise<Res<never>> };
  }
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!window.api?.invoke) {
    throw new Error('IPC preload belum termuat (window.api kosong) — restart aplikasi via npm run dev.');
  }
  const res = (await window.api.invoke(channel, ...args)) as Res<T>;
  if (!res.ok) {
    const err = new Error(res.error) as Error & { perluAlasan?: boolean };
    err.perluAlasan = (res as Fail).perluAlasan;
    throw err;
  }
  return res.data;
}

export type LockStatus = {
  sudahSetup: boolean;
  terbuka: boolean;
  idleMenit: number;
  gagal: number;
  blokirDetik: number;
};

export const api = {
  lockStatus: () => call<LockStatus>('lock:status'),
  lockSetup: (pin: string) => call<{ terbuka: boolean }>('lock:setup', pin),
  lockUnlock: (pin: string) => call<{ terbuka: boolean }>('lock:unlock', pin),
  lockLock: () => call<{ terkunci: boolean }>('lock:lock'),
  lockChange: (lama: string, baru: string) => call<{ diubah: boolean }>('lock:change', lama, baru),
  lockIdleSet: (menit: number) => call<{ idleMenit: number }>('lock:idle-set', menit),
  lockReset: (kode: string, pinBaru: string) =>
    call<{ terbuka: boolean }>('lock:reset', kode, pinBaru),
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
  asetList: (f: { jenis?: string; cari?: string } = {}) => call<Aset[]>('aset:list', f),
  asetCreate: (input: {
    kode: string; nama: string; jenis: string; luas_m2: number | null; lokasi: string;
    status_hukum: string; tahun_perolehan: number | null; asal_usul: string; kondisi: string;
    keterangan: string; nilai_sen: number | null;
  }) => call<{ id: string }>('aset:create', input),
  asetUpdate: (id: string, input: {
    kode: string; nama: string; jenis: string; luas_m2: number | null; lokasi: string;
    status_hukum: string; tahun_perolehan: number | null; asal_usul: string; kondisi: string;
    keterangan: string; nilai_sen: number | null;
  }) => call<{ id: string }>('aset:update', id, input),
  asetDelete: (id: string) => call<{ id: string }>('aset:delete', id),
  tutupList: () => call<TutupBuku[]>('tutup:list'),
  tutupPreview: (tahun: number) => call<{ tahun: number; laba: number }>('tutup:preview', tahun),
  tutupCreate: (tahun: number, backupPath = '') =>
    call<{ tahun: number; laba: number }>('tutup:create', tahun, backupPath),
  saldo: (cutoff?: string) => call<{ perKas: Record<string, number>; total: number }>('saldo:list', cutoff),
  neraca: (cutoff: string) => call<Neraca>('neraca:get', cutoff),
  dashboard: (cutoff: string) => call<DashboardHasil>('dashboard:get', cutoff),
  saveBuffer: (req: { bufferB64: string; defaultName: string; filters?: { name: string; extensions: string[] }[] }) =>
    call<{ saved: boolean; path: string }>('file:save-buffer', req),
  /** Simpan PDF langsung (hidden window + printToPDF di main). HTML dari wrapPrintDocument(..., { autoPrint: false }). */
  savePdf: (req: { htmlB64: string; defaultName: string }) =>
    call<{ saved: boolean; path: string }>('file:save-pdf', req),
  backupExport: () => call<{ saved: boolean; path: string }>('backup:export'),
  backupAuto: (tahun: number) => call<{ path: string }>('backup:auto', tahun),
  backupImport: () => call<{ restored: boolean; path: string }>('backup:import'),
};

export function isPerluAlasan(e: unknown): boolean {
  return (e as { perluAlasan?: boolean })?.perluAlasan === true;
}

/** Uint8Array → base64 untuk kirim buffer xlsx/html ke main via IPC. */
export function u8ToB64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

/** String UTF-8 → base64 (untuk simpan HTML print). */
export function strToB64(s: string): string {
  return u8ToB64(new TextEncoder().encode(s));
}
