import type { Coa, CoaTipe } from '../../db/coa.js';
import type { JurnalInput } from '../../core/posting.js';
import type { PengaturanPembukuan } from '../../core/pengaturan.js';
import type { FormSaldoAwal } from '../../core/forms.js';
import type { AlurPihak, RekonsiliasiPihak, SaldoPihak } from '../../core/pihak.js';
import type { RealisasiAnggaranHasil } from '../../core/anggaran.js';
import type { StatusRekonsiliasi } from '../../core/rekonsiliasi.js';
import type {
  RekonsiliasiDetail,
  RekonsiliasiTampil,
} from '../../db/rekonsiliasi.js';
import type {
  Aset,
  AuditLog,
  Jurnal,
  JurnalBaris,
  JurnalBarisInput,
  JurnalHeaderInput,
  JurnalPihakTampil,
  LampiranJurnal,
  Panjar,
  PanjarItem,
  Pihak,
  PihakSaldo,
  TutupBuku,
} from '../../core/types.js';
import type {
  ArusKasHasil,
  BukuBesarHasil,
  LabaRugiHasil,
  ModeNeracaSaldo,
  NeracaHasil,
  NeracaSaldoModeHasil,
} from '../../core/reports.js';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';
import type { HasilParseImpor } from '../../features/import/parser.js';
import type { HasilImporExcel } from '../../db/impor.js';
import type { LokasiData } from '../../main/lokasiData.js';

export type {
  ArusKasHasil,
  BukuBesarHasil,
  HasilImporExcel,
  HasilParseImpor,
  LabaRugiHasil,
  LampiranJurnal,
  ModeNeracaSaldo,
  NeracaHasil,
  NeracaSaldoModeHasil,
  RealisasiAnggaranHasil,
  RekonsiliasiDetail,
  RekonsiliasiTampil,
  StatusRekonsiliasi,
};
export type { LokasiData };

/** Nama folder tetap yang boleh dibuka dari layar Pengaturan (P2-8). */
export type JenisFolderLokasiApi = 'data' | 'backups' | 'attachments';

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: string; perluAlasan?: boolean; perluKonfirmasi?: boolean };
type Res<T> = Ok<T> | Fail;

/** Jurnal + baris, dipakai layar Jurnal Umum (P0-6). */
export type JurnalLengkap = Jurnal & {
  baris: JurnalBaris[];
  total_debit: number;
  reversal_id: string | null;
};

/** Filter layar Buku Besar / daftar jurnal per akun (P1-8). */
export type FilterBukuBesarApi = {
  akun_kode: string;
  mulai?: string;
  sampai?: string;
};

/** Filter Neraca Saldo per cut-off dan mode tahun/kumulatif (AUD-21b). */
export type FilterNeracaSaldoApi = {
  cutoff: string;
  mode?: ModeNeracaSaldo;
};

/** Filter pencarian jurnal server-side (P1-11). */
export type FilterJurnalCariApi = {
  cari?: string;
  mulai?: string;
  sampai?: string;
  jenis?: string;
  akun_kode?: string;
  limit?: number;
  offset?: number;
};

/** Halaman jurnal + total seluruh hasil filter (untuk pagination). */
export type JurnalCariPage = {
  rows: JurnalLengkap[];
  total: number;
};

/** Pratinjau lampiran; `dataUrl` hanya tersedia untuk gambar ≤ 5 MB. */
export type PreviewLampiranApi = {
  dataUrl?: string;
  mime: string;
  namaAsli: string;
};

/** Hasil dialog unggah lampiran; `saved:false` = operator membatalkan. */
export type UploadLampiranApi = {
  saved: boolean;
  lampiran?: LampiranJurnal;
};

/** Filter periode layar Laba Rugi & Arus Kas (P1-9). */
export type FilterPeriodeApi = {
  mulai?: string;
  sampai?: string;
};

/** Pagu tersimpan satu akun per tahun (P2-1). */
export type AnggaranTersimpan = {
  tahun: number;
  akun_kode: string;
  nominal: number;
  created_at: string;
  updated_at: string;
};

/** Akun COA + flag aktif untuk layar input pagu. */
export type AnggaranAkunApi = Coa & { aktif: boolean };

/** Data `anggaran:list`: pagu tersimpan + seluruh akun PENDAPATAN/BEBAN. */
export type AnggaranListData = {
  tahun: number;
  baris: AnggaranTersimpan[];
  total: number;
  akun: AnggaranAkunApi[];
};

export type SimpanAnggaranApi = {
  tahun: number;
  baris: { akun_kode: string; nominal: number }[];
};

export type HasilSimpanAnggaranApi = {
  tahun: number;
  baris: AnggaranTersimpan[];
  total: number;
};

export type FilterLaporanAnggaranApi = {
  tahun: number;
  mulai?: string;
  sampai?: string;
};

/** Filter riwayat rekonsiliasi bank (P2-2). */
export type FilterRekonsiliasiApi = {
  akun_kode?: string;
  selesai?: boolean;
};

/** Input rekonsiliasi baru; saldo_bank dalam SEN (integer ≥ 0). */
export type InputRekonsiliasiApi = {
  akun_kode: string;
  tanggal: string;
  saldo_bank: number;
  catatan?: string;
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

/** Hasil dialog pratinjau import Excel; `diproses:false` = operator batal. */
export type ImportPreviewData = {
  diproses: boolean;
  filePath: string;
  namaFile: string;
  hasil?: HasilParseImpor;
};

/** Hasil proses import Excel; `diproses:false` = operator batal. */
export type ImportProsesData = {
  diproses: boolean;
  filePath: string;
  namaFile: string;
  hasil?: HasilImporExcel;
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
  kodeDaruratDiatur: boolean;
};

export const api = {
  lockStatus: () => call<LockStatus>('lock:status'),
  /** Respons setup memuat kode darurat plaintext sekali (tidak pernah dibaca dari DB). */
  lockSetup: (pin: string) =>
    call<{ terbuka: boolean; kodeDarurat?: string | null }>('lock:setup', pin),
  lockUnlock: (pin: string) => call<{ terbuka: boolean }>('lock:unlock', pin),
  lockLock: () => call<{ terkunci: boolean }>('lock:lock'),
  lockChange: (lama: string, baru: string) => call<{ diubah: boolean }>('lock:change', lama, baru),
  lockIdleSet: (menit: number) => call<{ idleMenit: number }>('lock:idle-set', menit),
  /** Rotasi kode darurat; plaintext hanya dikembalikan sekali untuk modal. */
  lockResetKode: () => call<{ kodeDarurat: string }>('lock:reset-code'),
  lockReset: (kode: string, pinBaru: string) =>
    call<{ terbuka: boolean }>('lock:reset', kode, pinBaru),
  /** Pengaturan pembukuan (P1-13); hanya bisa dibaca saat PIN terbuka. */
  pengaturanGet: () => call<PengaturanPembukuan>('pengaturan:get'),
  pengaturanSimpan: (input: PengaturanPembukuan) =>
    call<PengaturanPembukuan>('pengaturan:simpan', input),
  /** Lokasi data & backup aktual (P2-8); dipakai kartu Pengaturan. */
  infoLokasi: () => call<LokasiData>('app:info-lokasi'),
  /** Buka salah satu folder tetap di file manager; bukan path dari renderer. */
  bukaFolder: (jenis: JenisFolderLokasiApi) =>
    call<{ opened: boolean; jenis: JenisFolderLokasiApi; path: string }>(
      'app:buka-folder',
      jenis,
    ),
  coa: () => call<Coa[]>('coa:list'),
  /** Tambah akun Beban/Pendapatan baru ke master COA (P2). */
  akunTambah: (input: { kode: string; nama: string; tipe: CoaTipe }) =>
    call<Coa>('akun:tambah', input),
  /** Ubah nama akun tambahan; kode & jenis tetap. */
  akunUbah: (input: { kode: string; nama: string }) =>
    call<Coa>('akun:ubah', input),
  /** Aktif/nonaktifkan akun tambahan (nonaktif = soft delete). */
  akunSetAktif: (kode: string, aktif: boolean) =>
    call<Coa>('akun:set-aktif', kode, aktif),
  /** Hapus permanen akun tambahan yang belum pernah dipakai. */
  akunHapus: (kode: string) => call<{ kode: string }>('akun:hapus', kode),
  jurnalList: (
    f: FilterJurnalCariApi = {},
  ) => call<JurnalLengkap[]>('jurnal:list', f),
  /** Pencarian jurnal + pagination server-side (P1-11). */
  jurnalCari: (f: FilterJurnalCariApi = {}) =>
    call<JurnalCariPage>('jurnal:cari', f),
  /** Saran nomor bukti berikutnya untuk tanggal tertentu (P1-11). */
  jurnalNomorBerikutnya: (tanggal: string) =>
    call<{ nomor: string }>('jurnal:nomor-berikutnya', tanggal),
  /** Buku Besar per akun; saldo awal/berjalan/akhir dihitung dari jurnal. */
  laporanBukuBesar: (f: FilterBukuBesarApi) =>
    call<BukuBesarHasil>('laporan:buku-besar', f),
  /**
   * Neraca Saldo per cut-off; `seimbang`/`selisih` dihitung di core.
   * String cut-off lama tetap diterima (mode default tahun).
   */
  laporanNeracaSaldo: (input: string | FilterNeracaSaldoApi) =>
    call<NeracaSaldoModeHasil>('laporan:neraca-saldo', input),
  /** Drill-down: jurnal yang menyentuh akun, lengkap dengan semua barisnya. */
  laporanJurnalAkun: (f: FilterBukuBesarApi) =>
    call<JurnalLengkap[]>('laporan:jurnal-akun', f),
  /** Drill-down: detail satu jurnal + seluruh baris debit/kredit. */
  laporanJurnalDetail: (id: string) =>
    call<JurnalLengkap>('laporan:jurnal-detail', id),
  /** Laba Rugi periode dari mesin laporan (P1-9). */
  laporanLabaRugi: (f: FilterPeriodeApi = {}) =>
    call<LabaRugiHasil>('laporan:laba-rugi', f),
  /** Neraca per cut-off, termasuk laba ditahan dari daftar tutup buku. */
  laporanNeraca: (cutoff: string) =>
    call<NeracaHasil>('laporan:neraca', { cutoff }),
  /** Arus Kas metode langsung per periode (P1-9). */
  laporanArusKas: (f: FilterPeriodeApi = {}) =>
    call<ArusKasHasil>('laporan:arus-kas', f),
  /** Pagu + akun PENDAPATAN/BEBAN untuk input tahun terpilih (P2-1). */
  anggaranList: (tahun: number) =>
    call<AnggaranListData>('anggaran:list', { tahun }),
  /** Simpan pagu (upsert; nominal 0 menghapus pagu akun tersebut). */
  anggaranSimpan: (f: SimpanAnggaranApi, opsi: { alasan?: string } = {}) =>
    call<HasilSimpanAnggaranApi>('anggaran:simpan', f, opsi),
  /** Realisasi vs pagu; realisasi dihitung dari jurnal (bukan angka tersimpan). */
  laporanAnggaran: (f: FilterLaporanAnggaranApi) =>
    call<RealisasiAnggaranHasil>('laporan:anggaran', f),
  /** Riwayat rekonsiliasi bank; saldo buku/selisih dihitung dari jurnal (P2-2). */
  rekonsiliasiList: (f: FilterRekonsiliasiApi = {}) =>
    call<RekonsiliasiTampil[]>('rekonsiliasi:list', f),
  /** Detail + mutasi jurnal sejak rekonsiliasi selesai sebelumnya (P2-2). */
  rekonsiliasiDetail: (id: string) =>
    call<RekonsiliasiDetail>('rekonsiliasi:detail', id),
  /** Simpan saldo menurut rekening koran; tidak menyimpan saldo buku/selisih. */
  rekonsiliasiCreate: (input: InputRekonsiliasiApi) =>
    call<RekonsiliasiTampil>('rekonsiliasi:create', input),
  /** Tandai selesai; audit mencatat kondisi lama/baru. */
  rekonsiliasiSelesai: (id: string, opsi: { catatan?: string } = {}) =>
    call<RekonsiliasiTampil>('rekonsiliasi:selesai', id, opsi),
  /** Simpan jurnal dari form terpandu (P1-1). Aturan bisnis ada di posting layer. */
  jurnalPosting: (
    input: JurnalInput,
    opsi: {
      konfirmasiPeringatan?: boolean;
      /** AKT-02: semua pintu input UI mengirim true. */
      wajibSaldoAwal?: boolean;
      /** Operator memilih "mulai tanpa saldo awal" pada sesi ini. */
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ) => call<{ jurnal: Jurnal }>('jurnal:posting', input, opsi),
  jurnalReverse: (id: string, alasan: string, opsi: OpsiKoreksiApi = {}) =>
    call<{ jurnal: Jurnal }>('jurnal:reverse', id, alasan, opsi),
  /** Wizard Saldo Awal: hanya bisa dipakai saat belum ada jurnal (P1-6). */
  saldoAwalStatus: () => call<StatusSaldoAwal>('saldo-awal:status'),
  saldoAwalPosting: (
    input: FormSaldoAwal,
    opsi: {
      konfirmasiPeringatan?: boolean;
      wajibSaldoAwal?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
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
  // ---- Lampiran bukti jurnal (P2-4) ----
  /** Metadata lampiran satu jurnal; file fisik ada di folder aplikasi. */
  lampiranList: (jurnalId: string) =>
    call<LampiranJurnal[]>('lampiran:list', jurnalId),
  /** Dialog unggah di main; batalkan = `{ saved:false }`. */
  lampiranUpload: (jurnalId: string) =>
    call<UploadLampiranApi>('lampiran:upload', jurnalId),
  /** Pratinjau gambar inline (≤ 5 MB); PDF hanya metadata, buka via OS. */
  lampiranPreview: (id: string) =>
    call<PreviewLampiranApi>('lampiran:preview', id),
  /** Buka file lampiran dengan aplikasi OS; path divalidasi di main. */
  lampiranOpen: (id: string) =>
    call<{ opened: boolean }>('lampiran:open', id),
  /** Hapus metadata + file (best-effort); audit LAMPIRAN-HAPUS. */
  lampiranDelete: (id: string) =>
    call<{ deleted: boolean; id: string }>('lampiran:delete', id),
  // ---- Piutang & Hutang + master pihak (P1-5) ----
  pihakList: () => call<Pihak[]>('pihak:list'),
  pihakSaldo: () => call<PihakSaldo[]>('pihak:saldo'),
  /** Rekonsiliasi saldo akun 1050/2050 vs jurnal yang sudah dipetakan ke pihak. */
  pihakRekon: (sampai?: string) =>
    call<RekonsiliasiPihak>('pihak:rekon', sampai),
  pihakJurnal: (pihakId: string) =>
    call<JurnalPihakTampil[]>('pihak:jurnal', pihakId),
  pihakCreate: (input: { nama: string; catatan?: string }) =>
    call<{ id: string; pihak: Pihak }>('pihak:create', input),
  pihakUpdate: (id: string, input: { nama: string; catatan?: string }) =>
    call<{ id: string; pihak: Pihak }>('pihak:update', id, input),
  pihakDelete: (id: string) => call<{ id: string }>('pihak:delete', id),
  pihakPosting: (
    req: { pihakId: string; input: JurnalInput },
    opsi: {
      konfirmasiPeringatan?: boolean;
      konfirmasiSaldo?: boolean;
      wajibSaldoAwal?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ) =>
    call<{
      jurnal: Jurnal;
      pihak?: Pihak;
      alur?: AlurPihak;
      akunPihak?: string;
      saldoSebelum?: SaldoPihak;
      saldoSesudah?: SaldoPihak;
    }>('pihak:posting', req, opsi),
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
    opsi: {
      konfirmasiPeringatan?: boolean;
      wajibSaldoAwal?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
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
      wajibSaldoAwal?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
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
  dashboard: (cutoff: string) => call<DashboardHasil>('dashboard:get', cutoff),
  // ---- Import jurnal massal dari Excel (P2-9) ----
  /** Unduh template .xlsx lewat save dialog; batal = `{saved:false}`. */
  importTemplate: () => call<{ saved: boolean; path: string }>('import:template'),
  /**
   * Pilih file (atau kirim path hasil preview untuk "Muat ulang"), parse +
   * validasi DB tanpa menulis jurnal. Batal = `{diproses:false}`.
   */
  importPreview: (filePath?: string) =>
    call<ImportPreviewData>('import:preview', filePath),
  /** Impor grup valid; file diparse ulang di main. Batal = `{diproses:false}`. */
  importProses: (
    filePath?: string,
    opsi: {
      konfirmasiPeringatan?: boolean;
      wajibSaldoAwal?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ) => call<ImportProsesData>('import:proses', filePath, opsi),
  saveBuffer: (req: { bufferB64: string; defaultName: string; filters?: { name: string; extensions: string[] }[] }) =>
    call<{ saved: boolean; path: string }>('file:save-buffer', req),
  /** Simpan PDF langsung (hidden window + printToPDF di main). HTML dari paginator P1-16. */
  savePdf: (req: { htmlB64: string; defaultName: string; landscape?: boolean }) =>
    call<{ saved: boolean; path: string }>('file:save-pdf', req),
  backupExport: () => call<{ saved: boolean; path: string }>('backup:export'),
  /** Backup lengkap satu folder: DB + lampiran + manifest. */
  backupLengkap: () =>
    call<{ saved: boolean; path: string; jumlahLampiran: number }>('backup:lengkap'),
  backupAuto: (tahun: number) => call<{ path: string }>('backup:auto', tahun),
  backupStatus: () => call<{ path: string }>('backup:status'),
  backupImport: () => call<{ restored: boolean; path: string; preRestorePath?: string }>('backup:import'),
  /** Restore lengkap: DB + lampiran + manifest dari satu folder backup. */
  backupRestoreLengkap: () =>
    call<{
      restored: boolean;
      path: string;
      preRestorePath?: string;
      preRestoreAttachmentsPath?: string;
      jumlahLampiran: number;
    }>('backup:restore-lengkap'),
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
