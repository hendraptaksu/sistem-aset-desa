import type { Coa, CoaTipe } from '../../db/coa.js';
import type { JurnalInput } from '../../core/posting.js';
import type { PengaturanPembukuanPublik } from '../../core/pengaturan.js';
import type { FormSaldoAwal } from '../../core/forms.js';
import type {
  AuditLog,
  Jurnal,
  JurnalBaris,
  JurnalBarisInput,
  JurnalHeaderInput,
  Panjar,
  PanjarItem,
  Pinjaman,
  PinjamanBayar,
  RincianPembayaranPinjaman,
  TutupBuku,
  TutupBukuSnapshot,
} from '../../core/types.js';
import type {
  ArusKasHasil,
  BukuBesarHasil,
  LabaRugiHasil,
  ModeNeracaSaldo,
  NeracaHasil,
  NeracaSaldoModeHasil,
} from '../../core/reports.js';
import type { MutasiPinjamanHasil } from '../../core/pinjamanMutasi.js';
import type { HasilRekonsiliasiPinjaman } from '../../core/pinjamanRekonsiliasi.js';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';
import type { HasilAuditIntegritas } from '../../db/integritas.js';
import type { LokasiData } from '../../main/lokasiData.js';

export type {
  ArusKasHasil,
  BukuBesarHasil,
  HasilAuditIntegritas,
  HasilRekonsiliasiPinjaman,
  LabaRugiHasil,
  ModeNeracaSaldo,
  MutasiPinjamanHasil,
  NeracaHasil,
  NeracaSaldoModeHasil,
};
export type { LokasiData };

/** Nama folder tetap yang boleh dibuka dari layar Pengaturan (P2-8). */
export type JenisFolderLokasiApi = 'data' | 'backups';

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; error: string; perluAlasan?: boolean; perluKonfirmasi?: boolean };
type Res<T> = Ok<T> | Fail;

/** Jurnal + baris, dipakai layar Jurnal Umum (P0-6). */
export type JurnalLengkap = Jurnal & {
  baris: JurnalBaris[];
  total_debit: number;
  reversal_id: string | null;
  /** T2.2: capability dari backend, bukan tebakan dari `jenis`/akun. */
  bisa_dibalik: boolean;
  bisa_dikoreksi: boolean;
  /** Alasan Indonesia bila aksi tidak boleh; null bila keduanya boleh. */
  alasan_tidak_bisa: string | null;
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

/** Filter periode layar Laba Rugi & Arus Kas (P1-9). */
export type FilterPeriodeApi = {
  mulai?: string;
  sampai?: string;
};

export type OpsiKoreksiApi = {
  id?: string;
  tanggal?: string;
  no_bukti?: string;
  konfirmasiPeringatan?: boolean;
};

/** Opsi simpan jurnal bersama untuk jalur manual dan form terpandu. */
export type OpsiPostingApi = {
  konfirmasiPeringatan?: boolean;
  /** AKT-07: alasan operator melanjutkan meski ada peringatan. */
  alasanPeringatan?: string;
  /** AKT-07: backend wajib menolak alasan <5 karakter. */
  wajibAlasanPeringatan?: boolean;
  /** AKT-02: semua pintu input UI mengirim true. */
  wajibSaldoAwal?: boolean;
  /** Operator memilih "mulai tanpa saldo awal" pada sesi ini. */
  konfirmasiTanpaSaldoAwal?: boolean;
};

/** Filter riwayat audit (P0-9). Tanggal YYYY-MM-DD, inklusif. */
export type AuditFilterApi = {
  aksi?: string;
  /** DB-27: referensi objek terstruktur. */
  ref_type?: string;
  ref_id?: string;
  mulai?: string;
  sampai?: string;
  limit?: number;
  offset?: number;
};

export type AuditLogPage = {
  rows: AuditLog[];
  total: number;
};

/** Mode wizard pinjaman LPD (DB-16c). */
export type ModePinjamanApi = 'PENCAIRAN' | 'BERJALAN';

/** Input wizard pinjaman LPD; jadwal diisi manual, bukan hasil amortisasi. */
export type PinjamanSimpanApi = {
  mode: ModePinjamanApi;
  id?: string;
  kreditur: string;
  tanggal: string;
  akunKas?: string;
  akunBunga?: string;
  pokok?: number;
  sisaPokok?: number;
  tenor?: number | null;
  catatan?: string;
  noBukti?: string;
  angsuran: {
    ke: number;
    jatuh_tempo: string;
    pokok: number;
    bunga: number;
    catatan?: string;
  }[];
};

/** Input pembayaran angsuran pinjaman LPD (DB-16d). */
export type PinjamanBayarApi = {
  id?: string;
  jurnalId?: string;
  pinjamanId: string;
  angsuranId: number;
  tanggal: string;
  akunKas: string;
  pokok?: number;
  bunga?: number;
  denda?: number;
  catatan?: string;
  noBukti?: string;
};

/** Opsi konfirmasi pembayaran angsuran (selisih jadwal / peringatan kas). */
export type OpsiBayarPinjamanApi = {
  konfirmasiSelisih?: boolean;
  alasanSelisih?: string;
  konfirmasiPeringatan?: boolean;
  alasanPeringatan?: string;
  /** T-B06: konfirmasi debit beban non-bunga (dihitung sebagai denda). */
  konfirmasiDendaLain?: boolean;
  alasanDendaLain?: string;
  konfirmasiTanpaSaldoAwal?: boolean;
};

/** Alasan pembatalan catatan pinjaman; opsi konfirmasi hanya untuk peringatan posting. */
export type OpsiBatalPinjamanApi = {
  konfirmasiPeringatan?: boolean;
  alasanPeringatan?: string;
};

/** Filter kartu hutang / mutasi bulanan pinjaman LPD (DB-16e). */
export type FilterMutasiPinjamanApi = {
  pinjamanId: string;
  /** Bulan `YYYY-MM`; kosongkan bila memakai rentang tanggal. */
  periode?: string;
  /** Tanggal `YYYY-MM-DD`; default tahun berjalan bila semuanya kosong. */
  mulai?: string;
  sampai?: string;
};

/** Pilihan rekonsiliasi pinjaman (DB-16f); kosong = seluruh pinjaman. */
export type FilterRekonsiliasiPinjamanApi = {
  pinjamanId?: string;
};

/** Status Wizard Saldo Awal (P1-6). */
export type StatusSaldoAwal = {
  boleh: boolean;
  jumlahJurnal: number;
  /** AUD2-02: tanggal jurnal paling awal; batas atas tanggal saldo awal. */
  tanggalMaksimal?: string;
  alasan?: string;
};

/** T1.8: saldo pembukaan aktif untuk prefill Wizard mode koreksi. */
export type SaldoAwalSaatIniApi = {
  tanggal: string;
  /** Hanya AKTIVA/KEWAJIBAN, sisi normal positif; 3000 MODAL tidak termasuk. */
  saldo: { akun_kode: string; nominal: number }[];
  keterangan?: string;
  /** Batas atas tanggal koreksi dari jurnal non-pembukaan paling awal. */
  tanggalMaksimal?: string;
};

/** Opsi koreksi saldo awal; `alasan` wajib >=5 karakter. */
export type OpsiKoreksiSaldoAwalApi = {
  alasan?: string;
  konfirmasiPeringatan?: boolean;
  alasanPeringatan?: string;
  wajibAlasanPeringatan?: boolean;
};

/** Riwayat tutup buku + laba snapshot yang disahkan saat periode dikunci. */
export type TutupBukuTampil = TutupBuku & {
  /** Laba snapshot bila ada; fallback laba live untuk data lama. */
  laba: number;
  /** Laba yang disahkan saat tutup; null bila belum ada snapshot. */
  labaSnapshot: number | null;
  /** Laba yang dihitung ulang dari jurnal saat ini. */
  labaLive: number;
  /** Snapshot versi terbaru untuk tahun ini. */
  snapshotTerbaru: TutupBukuSnapshot | null;
  /** Angka/hash live sudah berbeda dari snapshot terbaru. */
  snapshotBerubah: boolean;
  /** Rincian perbedaan snapshot vs live. */
  perbedaanSnapshot: string[];
  /** DB-38: catatan bila tahun ini adalah tahun pertama pembukuan parsial. */
  catatanTahunPertama?: string;
};

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
  /** Temuan audit integritas (kode + pesan); kosong berarti lolos audit. */
  temuanIntegritas: TemuanIntegritasTampil[];
  /** DB-38: catatan bila tahun ini adalah tahun pertama pembukuan parsial. */
  catatanTahunPertama?: string;
  /** T-A06: snapshot terbaru untuk tahun ini, bila sudah pernah ditutup. */
  snapshotTerbaru: TutupBukuSnapshot | null;
  /** T-A06: angka/hash live sudah berbeda dari snapshot terbaru. */
  snapshotBerubah: boolean;
  /** T-A06: rincian perbedaan snapshot vs live. */
  perbedaanSnapshot: string[];
  /** T-A06: versi snapshot yang akan ditulis bila tutup berhasil. */
  versiSnapshotBerikutnya: number;
};

export type TemuanIntegritasTampil = {
  kode: string;
  pesan: string;
};

export type TutupTersimpanData = {
  tahun: number;
  laba: number;
  labaDitahan: number;
  aksi: 'TUTUP' | 'TUTUP-ULANG';
  data: TutupBuku;
  snapshot: TutupBukuSnapshot | null;
  snapshotBerubah: boolean;
  perbedaanSnapshot: string[];
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
  /**
   * Pengaturan pembukuan (P1-13); hanya bisa dibaca saat PIN terbuka.
   * DB-28: kontrak publik tanpa `awalTahunBuku` (selalu Januari di server).
   */
  pengaturanGet: () => call<PengaturanPembukuanPublik>('pengaturan:get'),
  pengaturanSimpan: (input: PengaturanPembukuanPublik) =>
    call<PengaturanPembukuanPublik>('pengaturan:simpan', input),
  /** Lokasi data & backup aktual (P2-8); dipakai kartu Pengaturan. */
  infoLokasi: () => call<LokasiData>('app:info-lokasi'),
  /** Buka salah satu folder tetap di file manager; bukan path dari renderer. */
  bukaFolder: (jenis: JenisFolderLokasiApi) =>
    call<{ opened: boolean; jenis: JenisFolderLokasiApi; path: string }>(
      'app:buka-folder',
      jenis,
    ),
  coa: () => call<Coa[]>('coa:list'),
  /** Tambah akun Beban/Pendapatan/Kas-Bank baru ke master COA (DB-14). */
  akunTambah: (input: {
    kode: string;
    nama: string;
    tipe: CoaTipe;
    is_kas?: boolean;
    kelompok?: string;
  }) => call<Coa>('akun:tambah', input),
  /** Ubah nama akun tambahan; kode & jenis tetap. */
  akunUbah: (input: { kode: string; nama: string }) =>
    call<Coa>('akun:ubah', input),
  /**
   * Aktif/nonaktifkan akun (DB-15: termasuk akun bawaan; nonaktif = soft
   * delete). Akun sistem 3000/1040/1050/2050/2060/5063/5050 ditolak oleh backend.
   */
  akunSetAktif: (kode: string, aktif: boolean, alasan?: string) =>
    call<Coa>('akun:set-aktif', kode, aktif, alasan),
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
  /**
   * DB-03: simpan transaksi dari form terpandu. Hanya menerima jenis
   * TERIMA/BAYAR/TRANSFER/HUTANG; jurnal manual memakai `jurnalPosting`.
   */
  transaksiPosting: (
    input: JurnalInput,
    opsi: OpsiPostingApi = {},
  ) => call<{ jurnal: Jurnal }>('transaksi:posting', input, opsi),
  /**
   * DB-03: simpan jurnal manual Jurnal Umum. Backend menolak semua jenis
   * selain UMUM; dokumen lain harus lewat form/jalur khususnya.
   */
  jurnalPosting: (
    input: JurnalInput,
    opsi: OpsiPostingApi = {},
  ) => call<{ jurnal: Jurnal }>('jurnal:posting', input, opsi),
  jurnalReverse: (id: string, alasan: string, opsi: OpsiKoreksiApi = {}) =>
    call<{ jurnal: Jurnal }>('jurnal:reverse', id, alasan, opsi),
  /** Wizard Saldo Awal: sekali pakai, boleh disusulkan sebelum jurnal pertama (P1-6/AUD2-02). */
  saldoAwalStatus: () => call<StatusSaldoAwal>('saldo-awal:status'),
  saldoAwalPosting: (
    input: FormSaldoAwal,
    opsi: {
      konfirmasiPeringatan?: boolean;
      /** AKT-07: alasan operator melanjutkan meski ada peringatan. */
      alasanPeringatan?: string;
      /** AKT-07: backend wajib menolak alasan <5 karakter. */
      wajibAlasanPeringatan?: boolean;
      wajibSaldoAwal?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ) => call<{ jurnal: Jurnal }>('saldo-awal:posting', input, opsi),
  /** T1.8: saldo pembukaan aktif untuk prefill Wizard mode koreksi. */
  saldoAwalSaatIni: () =>
    call<SaldoAwalSaatIniApi>('saldo-awal:saat-ini'),
  /**
   * T1.7: koreksi saldo awal (Opsi A). Jurnal pembukaan lama dibalik dan
   * jurnal penyesuaian `UMUM` baru dibuat atomik; `alasan` wajib >=5 karakter.
   *
   * T1.8: mendukung bentuk `(input, { alasan, ...opsi })` yang dipakai wizard,
   * sekaligus bentuk lama `(input, alasan, opsi)` agar pemanggil lama tetap sah.
   */
  saldoAwalKoreksi: (
    input: FormSaldoAwal,
    alasanAtauOpsi: string | OpsiKoreksiSaldoAwalApi,
    opsi: OpsiKoreksiSaldoAwalApi = {},
  ) =>
    typeof alasanAtauOpsi === 'string'
      ? call<{ jurnal: Jurnal; reversal: Jurnal }>(
          'saldo-awal:koreksi',
          input,
          alasanAtauOpsi,
          opsi,
        )
      : call<{ jurnal: Jurnal; reversal: Jurnal }>(
          'saldo-awal:koreksi',
          input,
          alasanAtauOpsi,
        ),
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
  // ---- Panjar & tutup buku (P1-5) ----
  panjarList: (status?: 'OPEN' | 'CLOSED' | 'DIBATALKAN') =>
    call<Panjar[]>('panjar:list', status),
  panjarItems: (id: string) => call<PanjarItem[]>('panjar:items', id),
  /**
   * T-A11: catat panjar yang sudah beredar pada cut-over. Tidak membuat jurnal
   * baru; 1040 sudah ada di jurnal pembukaan.
   */
  panjarSaldoAwal: (
    input: {
      id?: string;
      jumlah: number;
      penerima?: string;
      akunKasSumber?: string;
      tanggal?: string;
      catatan?: string;
      alasan?: string;
    },
    alasan?: string,
  ) => call<{ panjar: Panjar }>('panjar:saldo-awal', input, alasan),
  /**
   * T-A11: hapus HANYA dokumen representasi saldo awal, tanpa jurnal balik.
   * Jurnal pembukaan tidak diubah; alasan wajib >= 5 karakter.
   */
  panjarBatalSaldoAwal: (id: string, alasan: string) =>
    call<{ id: string }>('panjar:batal-saldo-awal', id, alasan),
  /** DB-21: batalkan panjar OPEN; alasan wajib >= 5 karakter. */
  panjarBatal: (
    id: string,
    alasan: string,
    opsi: {
      tanggalBatal?: string;
      konfirmasiPeringatan?: boolean;
    } = {},
  ) => call<{ panjar: Panjar; jurnal?: Jurnal }>('panjar:batal', id, alasan, opsi),
  /** AUD2-03: koreksi pertanggungjawaban CLOSED lewat jurnal balik; alasan >= 5 karakter. */
  panjarBatalClose: (
    input: { id: string; alasan: string; tanggalBatal?: string },
    opsi: {
      konfirmasiPeringatan?: boolean;
      alasanPeringatan?: string;
    } = {},
  ) =>
    call<{ panjar: Panjar; jurnal?: Jurnal }>(
      'panjar:batal-close',
      input,
      opsi,
    ),
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
      alasanPeringatan?: string;
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
      items: {
        kategori_baga: string;
        nominal: number;
        /** DB-18: detail nota per baris; kosong = perilaku legacy. */
        nota_nomor?: string;
        nota_tanggal?: string;
        toko?: string;
        keterangan?: string;
      }[];
      konfirmasiKurang?: boolean;
      konfirmasiPeringatan?: boolean;
      /** AKT-08: alasan operator saat realisasi melebihi panjar. */
      alasanKurang?: string;
      /** AKT-08: alasan saat peringatan kas dari posting layer dikonfirmasi. */
      alasanPeringatan?: string;
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
  // ---- Pinjaman LPD (DB-16c) ----
  pinjamanList: () => call<Pinjaman[]>('pinjaman:list'),
  pinjamanDetail: (id: string) => call<Pinjaman>('pinjaman:detail', id),
  pinjamanSimpan: (
    input: PinjamanSimpanApi,
    opsi: OpsiPostingApi = {},
  ) =>
    call<{
      mode: ModePinjamanApi;
      pinjaman: Pinjaman;
      jurnal: Jurnal | null;
    }>('pinjaman:simpan', input, opsi),
  /** DB-16d: bayar satu angsuran; server membuat jurnal + link atomik. */
  pinjamanBayar: (
    input: PinjamanBayarApi,
    opsi: OpsiBayarPinjamanApi = {},
  ) =>
    call<{
      pembayaran: PinjamanBayar;
      jurnal: Jurnal;
      rincian?: RincianPembayaranPinjaman;
      selisih?: { pokok: number; bunga: number };
      pinjaman: Pinjaman | null;
    }>('pinjaman:bayar', input, opsi),
  /** Pembayaran per pinjaman, termasuk catatan yang sudah dibatalkan. */
  pinjamanPembayaran: (id: string) =>
    call<PinjamanBayar[]>('pinjaman:pembayaran', id),
  /** Membalik catatan pembayaran yang keliru; jurnal dan riwayat lama tetap ada. */
  pinjamanBayarBatal: (id: string, alasan: string, opsi: OpsiBatalPinjamanApi = {}) =>
    call<{
      pembayaran: PinjamanBayar;
      jurnal: Jurnal;
      pinjaman?: Pinjaman | null;
    }>('pinjaman:bayar-batal', { id, alasan }, opsi),
  /** Membalik pencairan yang keliru bila belum ada pembayaran aktif. */
  pinjamanBatal: (id: string, alasan: string, opsi: OpsiBatalPinjamanApi = {}) =>
    call<{
      pinjaman: Pinjaman;
      jurnal: Jurnal;
    }>('pinjaman:batal', { id, alasan }, opsi),
  /** DB-16e: kartu hutang / mutasi bulanan dari jurnal pembayaran tertaut. */
  pinjamanMutasi: (f: FilterMutasiPinjamanApi) =>
    call<MutasiPinjamanHasil>('pinjaman:mutasi', f),
  /**
   * DB-16f: status rekonsiliasi 2050 vs jadwal. Tanpa ID mengembalikan seluruh
   * pinjaman; dengan ID mengembalikan satu pinjaman. Hanya membaca.
   */
  pinjamanRekonsiliasi: (f: FilterRekonsiliasiPinjamanApi = {}) =>
    call<HasilRekonsiliasiPinjaman | HasilRekonsiliasiPinjaman[]>(
      'pinjaman:rekonsiliasi',
      f,
    ),
  pinjamanRekonsiliasiSemua: () =>
    call<HasilRekonsiliasiPinjaman[]>('pinjaman:rekonsiliasi', {}),
  tutupList: () => call<TutupBukuTampil[]>('tutup:list'),
  tutupPreview: (tahun: number) => call<TutupPreviewData>('tutup:preview', tahun),
  tutupCreate: (req: {
    tahun: number;
    catatan?: string;
    konfirmasiTimpak?: boolean;
  }) => call<TutupTersimpanData>('tutup:create', req),
  auditList: (f: AuditFilterApi = {}) => call<AuditLogPage>('audit:list', f),
  /** DB-12: audit integritas read-only; mengembalikan temuan + ringkasan. */
  auditIntegritas: () => call<HasilAuditIntegritas>('audit:integritas'),
  /**
   * T-A16: hasil audit yang dijalankan main saat startup/restore. `null` bila
   * audit belum tersedia atau gagal dibaca; tidak memicu audit/tulis DB baru.
   */
  auditAwal: () => call<HasilAuditIntegritas | null>('audit:awal'),
  saldo: (cutoff?: string) => call<{ perKas: Record<string, number>; total: number }>('saldo:list', cutoff),
  dashboard: (cutoff: string) => call<DashboardHasil>('dashboard:get', cutoff),
  saveBuffer: (req: { bufferB64: string; defaultName: string; filters?: { name: string; extensions: string[] }[] }) =>
    call<{ saved: boolean; path: string }>('file:save-buffer', req),
  /** Simpan PDF langsung (hidden window + printToPDF di main). HTML dari paginator P1-16. */
  savePdf: (req: { htmlB64: string; defaultName: string; landscape?: boolean }) =>
    call<{ saved: boolean; path: string }>('file:save-pdf', req),
  backupExport: () => call<{ saved: boolean; path: string }>('backup:export'),
  /** Backup lengkap satu folder: DB + manifest. */
  backupLengkap: () => call<{ saved: boolean; path: string }>('backup:lengkap'),
  backupAuto: (tahun: number) => call<{ path: string }>('backup:auto', tahun),
  backupStatus: () => call<{ path: string }>('backup:status'),
  /**
   * Restore `.db` (jalur lanjutan). Main menolak panggilan tanpa konfirmasi
   * eksplisit karena hanya database yang dipulihkan, tanpa validasi manifest.
   * T2.7: setelah sukses main mengunci sesi — renderer harus menampilkan layar
   * kunci, bukan memanggil `dashboard()` lagi.
   */
  backupImport: (konfirmasiRestoreDb: boolean) =>
    call<{ restored: boolean; path: string; preRestorePath?: string }>(
      'backup:import',
      { konfirmasiRestoreDb },
    ),
  /**
   * Restore lengkap: DB + manifest dari satu folder backup.
   * T2.7: sama seperti `backupImport`, sesi dikunci ulang setelah sukses.
   */
  backupRestoreLengkap: () =>
    call<{
      restored: boolean;
      path: string;
      preRestorePath?: string;
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
