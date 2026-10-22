import type { Coa } from '../../db/coa.js';
import type { JurnalInput } from '../../core/posting.js';
import type { FormSaldoAwal } from '../../core/forms.js';
import type { AlurPihak, SaldoPihak } from '../../core/pihak.js';
import type {
  Aset,
  AuditLog,
  Jurnal,
  JurnalBaris,
  JurnalBarisInput,
  JurnalHeaderInput,
  JurnalPihakTampil,
  Panjar,
  PanjarItem,
  Pihak,
  PihakSaldo,
  Transaksi,
  TutupBuku,
} from '../../core/types.js';
import type { Neraca } from '../../core/ledger.js';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: string; perluAlasan?: boolean; perluKonfirmasi?: boolean };
type Res<T> = Ok<T> | Fail;

/** Jurnal + baris, dipakai layar Jurnal Umum (P0-6). */
export type JurnalLengkap = Jurnal & {
  baris: JurnalBaris[];
  total_debit: number;
  reversal_id: string | null;
};

export type OpsiKoreksiApi = {
  id?: string;
  tanggal?: string;
  no_bukti?: string;
  konfirmasiPeringatan?: boolean;
};

/** Filter riwayat audit (P0-9). Tanggal YYYY-MM-DD, inklusif. */
export type AuditFilterApi = {
  aksi?: string;
  mulai?: string;
  sampai?: string;
  limit?: number;
  offset?: number;
};

export type AuditLogPage = {
  rows: AuditLog[];
  total: number;
};

/** Status Wizard Saldo Awal (P1-6). */
export type StatusSaldoAwal = {
  boleh: boolean;
  jumlahJurnal: number;
  alasan?: string;
};

/** Riwayat tutup buku + laba yang dihitung ulang dari jurnal. */
export type TutupBukuTampil = TutupBuku & { laba: number };

export type TutupPreviewData = {
  tahun: number;
  laba: number;
  labaDitahanSekarang: number;
  labaDitahanSesudah: number;
  sudahDitutup: boolean;
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  perluKonfirmasi: boolean;
  aksi: 'TUTUP' | 'TUTUP-ULANG';
  tahunTerakhir: number | null;
  batasTahun: number;
};

export type TutupTersimpanData = {
  tahun: number;
  laba: number;
  labaDitahan: number;
  aksi: 'TUTUP' | 'TUTUP-ULANG';
  data: TutupBuku;
};

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
    const err = new Error(res.error) as Error & {
      perluAlasan?: boolean;
      perluKonfirmasi?: boolean;
    };
    err.perluAlasan = (res as Fail).perluAlasan;
    err.perluKonfirmasi = (res as Fail).perluKonfirmasi;
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
  jurnalList: (
    f: { mulai?: string; sampai?: string; jenis?: string; akun_kode?: string; limit?: number; offset?: number } = {},
  ) => call<JurnalLengkap[]>('jurnal:list', f),
  /** Simpan jurnal dari form terpandu (P1-1). Aturan bisnis ada di posting layer. */
  jurnalPosting: (
    input: JurnalInput,
    opsi: { konfirmasiPeringatan?: boolean } = {},
  ) => call<{ jurnal: Jurnal }>('jurnal:posting', input, opsi),
  jurnalReverse: (id: string, alasan: string, opsi: OpsiKoreksiApi = {}) =>
    call<{ jurnal: Jurnal }>('jurnal:reverse', id, alasan, opsi),
  /** Wizard Saldo Awal: hanya bisa dipakai saat belum ada jurnal (P1-6). */
  saldoAwalStatus: () => call<StatusSaldoAwal>('saldo-awal:status'),
  saldoAwalPosting: (
    input: FormSaldoAwal,
    opsi: { konfirmasiPeringatan?: boolean } = {},
  ) => call<{ jurnal: Jurnal }>('saldo-awal:posting', input, opsi),
  jurnalKoreksiIsiUlang: (
    id: string,
    alasan: string,
    input: { header: JurnalHeaderInput; baris: JurnalBarisInput[] },
    opsi: OpsiKoreksiApi = {},
  ) =>
    call<{ reversal: Jurnal; jurnalBaru: Jurnal }>(
      'jurnal:koreksi-isi-ulang',
      id,
      alasan,
      input,
      opsi,
    ),
  // ---- Piutang & Hutang + master pihak (P1-5) ----
  pihakList: () => call<Pihak[]>('pihak:list'),
  pihakSaldo: () => call<PihakSaldo[]>('pihak:saldo'),
  pihakJurnal: (pihakId: string) =>
    call<JurnalPihakTampil[]>('pihak:jurnal', pihakId),
  pihakCreate: (input: { nama: string; catatan?: string }) =>
    call<{ id: string; pihak: Pihak }>('pihak:create', input),
  pihakUpdate: (id: string, input: { nama: string; catatan?: string }) =>
    call<{ id: string; pihak: Pihak }>('pihak:update', id, input),
  pihakDelete: (id: string) => call<{ id: string }>('pihak:delete', id),
  pihakPosting: (
    req: { pihakId: string; input: JurnalInput },
    opsi: { konfirmasiPeringatan?: boolean; konfirmasiSaldo?: boolean } = {},
  ) =>
    call<{
      jurnal: Jurnal;
      pihak?: Pihak;
      alur?: AlurPihak;
      akunPihak?: string;
      saldoSebelum?: SaldoPihak;
      saldoSesudah?: SaldoPihak;
    }>('pihak:posting', req, opsi),
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
  panjarCreate: (
    input: {
      tanggal: string;
      penerima: string;
      jumlah: number;
      akunKasSumber: string;
      keterangan?: string;
      noBukti?: string;
    },
    alasan?: string,
    opsi: { konfirmasiPeringatan?: boolean } = {},
  ) =>
    call<{ id: string; panjar: Panjar; jurnal?: Jurnal }>(
      'panjar:create',
      input,
      alasan,
      opsi,
    ),
  panjarClose: (
    req: {
      id: string;
      tanggalClose: string;
      items: { kategori_baga: string; nominal: number }[];
      konfirmasiKurang?: boolean;
      konfirmasiPeringatan?: boolean;
    },
    alasan?: string,
  ) =>
    call<{
      totalRealisasi: number;
      sisa: number;
      kurang: number;
      panjar: Panjar;
      jurnal?: Jurnal;
    }>('panjar:close', req, alasan),
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
  tutupList: () => call<TutupBukuTampil[]>('tutup:list'),
  tutupPreview: (tahun: number) => call<TutupPreviewData>('tutup:preview', tahun),
  tutupCreate: (req: {
    tahun: number;
    catatan?: string;
    backupPath?: string;
    konfirmasiTimpak?: boolean;
  }) => call<TutupTersimpanData>('tutup:create', req),
  auditList: (f: AuditFilterApi = {}) => call<AuditLogPage>('audit:list', f),
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
  backupStatus: () => call<{ path: string }>('backup:status'),
  backupImport: () => call<{ restored: boolean; path: string; preRestorePath?: string }>('backup:import'),
};

export function isPerluAlasan(e: unknown): boolean {
  return (e as { perluAlasan?: boolean })?.perluAlasan === true;
}

/** Peringatan (mis. kas minus) yang menunggu konfirmasi operator. */
export function isPerluKonfirmasi(e: unknown): boolean {
  return (e as { perluKonfirmasi?: boolean })?.perluKonfirmasi === true;
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
