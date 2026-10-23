// Registrasi seluruh handler IPC aplikasi (P2-7).
//
// Modul ini sengaja TIDAK mengimpor Electron runtime. Semua ketergantungan
// main-process (koneksi DB yang bisa berganti setelah restore, dialog native,
// tulis file, cetak PDF, buka file OS, folder lampiran) masuk lewat `IpcDeps`
// sehingga seluruh alur create → reverse → tutup → backup → restore bisa
// diuji dengan vitest tanpa Electron.

import type Database from 'better-sqlite3';
import { mkdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  catatAudit,
  deleteAset,
  getAset,
  getJurnal,
  getPengaturanPembukuan,
  guardPeriodeTerkunci,
  insertAset,
  insertTransaksi,
  listAkun,
  listAset,
  listAuditLogPage,
  listJurnalLengkap,
  listJurnalLengkapPage,
  listTransaksi,
  listTutupBuku,
  saranNomorBukti,
  simpanPengaturanPembukuan,
  updateAset,
  type AuditFilter,
  type JurnalFilter,
} from '../db/repository.js';
import { koreksiDanIsiUlang, reverseJurnal } from '../db/reversal.js';
import { postingJurnal } from '../db/posting.js';
import { simpanSaldoAwal, statusSaldoAwal } from '../db/saldoAwal.js';
import {
  closePanjarV2,
  listPanjarItemsV2,
  listPanjarV2,
  serahkanPanjar,
} from '../db/panjar.js';
import {
  createPihak,
  daftarJurnalPihak,
  deletePihak,
  listPihak,
  postingPihak,
  saldoPerPihak,
  updatePihak,
} from '../db/pihak.js';
import { previewTutupBuku, tutupBuku } from '../db/tutup.js';
import {
  getAnggaranTahun,
  laporanRealisasiAnggaran,
  simpanAnggaran,
} from '../db/anggaran.js';
import {
  buatRekonsiliasi,
  getRekonsiliasiDetail,
  listRekonsiliasi,
  selesaikanRekonsiliasi,
} from '../db/rekonsiliasi.js';
import {
  getLampiran,
  hapusLampiran,
  listLampiran,
  tambahLampiran,
} from '../db/lampiran.js';
import {
  dataUrlLampiran,
  hapusFileLampiran,
  pathFileLampiran,
  simpanLampiranDenganMetadata,
} from '../features/lampiran/lampiran.js';
import { validasiLampiran } from '../core/lampiran.js';
import { KAS_KODES, COA } from '../db/coa.js';
import {
  labaTahun as labaTahunJurnal,
  neraca as neracaJurnal,
  saldoAkun,
  saldoSemuaKas as saldoSemuaKasJurnal,
} from '../core/reports.js';
import {
  laporanArusKas,
  laporanBukuBesar,
  laporanDetailJurnal,
  laporanJurnalAkun,
  laporanLabaRugi,
  laporanNeraca,
  laporanNeracaSaldo,
  listBarisJurnal,
} from '../db/laporan.js';
import { buildDashboardJurnal, denganBackupTerakhir } from '../features/dashboard/dashboard.js';
import {
  backupVacuumInto,
  lastAutoBackup,
  restoreDbAman,
} from '../features/export/export.js';
import type { Aset, Transaksi } from '../core/types.js';
import { tanggalKalenderValid, type JurnalInput } from '../core/posting.js';
import { buatJurnalSaldoAwal } from '../core/forms.js';
import { rentangTahunBuku } from '../core/pengaturan.js';
import {
  PESAN_SIMPAN_GAGAL,
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
  pesanValidasi,
} from '../utils/pesanError.js';
import {
  validasiBentukJurnalInput,
  validasiBentukAnggaranList,
  validasiBentukAnggaranSimpan,
  validasiBentukPanjarClose,
  validasiBentukPanjarSerah,
  validasiBentukPengaturanPembukuan,
  validasiBentukPihak,
  validasiBentukPostingPihak,
  validasiBentukRekonsiliasiCreate,
  validasiBentukRekonsiliasiList,
  validasiBentukRekonsiliasiSelesai,
  validasiBentukSaldoAwal,
  validasiCutoffLaporan,
  validasiFilterAnggaran,
  validasiFilterBukuBesar,
  validasiFilterJurnalCari,
  validasiFilterNeraca,
  validasiIdJurnal,
  validasiIdLampiran,
  validasiIdRekonsiliasi,
  validasiRentangLaporan,
  validasiTanggalOpsional,
  validateAsetInput,
  validateTransaksiInput,
  type AsetInput,
  type TransaksiInput,
} from './validation.js';
import {
  aturIdle,
  bukaKunci,
  kunciLagi,
  resetPaksa,
  sesi,
  setupPin,
  statusKunci,
  ubahPin,
} from './kunci.js';
import { sudahSetupPin } from '../db/repository.js';
import type { LokasiData } from './lokasiData.js';

export type IpcDeps = {
  handle(
    channel: string,
    listener: (event: unknown, ...args: any[]) => unknown,
  ): void;
  /** Koneksi aktif; selalu dibaca ulang karena restore dapat menggantinya. */
  db(): Database.Database;
  setDb(db: Database.Database): void;
  dbPath(): string;
  dialog: {
    showSaveDialog(opts: any): Promise<{ canceled: boolean; filePath?: string }>;
    showOpenDialog(opts: any): Promise<{ canceled: boolean; filePaths: string[] }>;
  };
  writeFile(path: string, data: Buffer): void;
  /**
   * Render HTML ke PDF dan tulis ke `filePath` (implementasi BrowserWindow
   * tetap di main/index.ts). `landscape` mengikuti kebutuhan laporan.
   */
  printPdf(html: string, filePath: string, landscape?: boolean): Promise<void>;
  /** `shell.openPath`; string kosong = berhasil, selain itu pesan galat OS. */
  openPath(path: string): Promise<string>;
  lampiranDir(): string;
  /** Lokasi data final (P2-8): folder data, DB, lampiran, backup. */
  lokasiData(): LokasiData;
  /** Waktu acuan yang bisa dipatok di test; default `new Date()`. */
  now?(): Date;
};

export function registerIpc(deps: IpcDeps): void {
  const sekarang = (): Date => deps.now?.() ?? new Date();
  const tanggalSekarang = (): string => sekarang().toISOString().slice(0, 10);

  const ok = <T>(data: T) => ({ ok: true as const, data });
  const fail = (error: string, perluAlasan = false, perluKonfirmasi = false) => ({
    ok: false as const,
    error,
    perluAlasan,
    perluKonfirmasi,
  });
  const uid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  // Error internal tidak pernah dikirim mentah ke renderer. Pesan bisnis yang
  // sudah berbahasa Indonesia tetap lolos lewat `pesanError`.
  const GAGAL_MUAT =
    'Terjadi kesalahan saat memuat data. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_KOREKSI =
    'Terjadi kesalahan saat menyimpan koreksi. Jurnal asli tidak diubah; coba lagi atau hubungi pendamping.';
  const GAGAL_PIHAK =
    'Terjadi kesalahan saat menyimpan data pihak. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_PANJAR =
    'Terjadi kesalahan saat menyimpan panjar. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_ASET =
    'Terjadi kesalahan saat menyimpan data aset. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_ANGGARAN =
    'Terjadi kesalahan saat menyimpan pagu anggaran. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_REKONSILIASI =
    'Terjadi kesalahan saat memproses rekonsiliasi bank. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_LAMPIRAN =
    'Terjadi kesalahan saat memproses lampiran. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_TUTUP =
    'Terjadi kesalahan saat memproses tutup buku. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_FILE = 'Gagal menyimpan file. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_BACKUP = 'Gagal membuat cadangan. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_RESTORE =
    'Gagal memulihkan data. Data lama tetap dipakai; coba lagi atau hubungi pendamping.';

  deps.handle('coa:list', () => ok(COA));

  // Kunci aplikasi: sesi selalu terkunci saat app dibuka (sesi.terbuka=false awal).
  deps.handle('lock:status', () => ok(statusKunci(deps.db())));
  deps.handle('lock:setup', (_e, pin: string) => {
    const err = setupPin(deps.db(), String(pin ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });
  deps.handle('lock:unlock', (_e, pin: string) => {
    const err = bukaKunci(deps.db(), String(pin ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });
  deps.handle('lock:lock', () => {
    kunciLagi();
    return ok({ terkunci: true });
  });
  deps.handle('lock:change', (_e, lama: string, baru: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const err = ubahPin(deps.db(), String(lama ?? ''), String(baru ?? ''));
    return err ? fail(err) : ok({ diubah: true });
  });
  deps.handle('lock:idle-set', (_e, menit: number) => {
    const k = perluBuka();
    if (k) return fail(k);
    const err = aturIdle(deps.db(), Number(menit));
    return err ? fail(err) : ok({ idleMenit: Number(menit) });
  });
  deps.handle('lock:reset', (_e, kode: string, pinBaru: string) => {
    const err = resetPaksa(deps.db(), String(kode ?? ''), String(pinBaru ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });

  // Gembok data: selain channel lock:* & coa:list, tolak bila PIN sudah di-setup
  // tapi sesi belum dibuka. Mencegah bypass via devtools (ancaman anak/iseng).
  // lock:change & lock:idle-set justru WAJIB terbuka → ikut dijaga di bawah.
  const perluBuka = (): string | null =>
    sudahSetupPin(deps.db()) && !sesi.terbuka ? 'Aplikasi terkunci. Buka dengan PIN dulu.' : null;

  // ---- Lokasi data & folder (P2-8) ----
  // Renderer hanya boleh meminta tiga nama folder tetap; TIDAK PERNAH path.
  const JENIS_FOLDER_LOKASI = ['data', 'backups', 'attachments'] as const;
  type JenisFolderLokasi = (typeof JENIS_FOLDER_LOKASI)[number];
  const folderLokasi = (lokasi: LokasiData, jenis: JenisFolderLokasi): string => {
    if (jenis === 'data') return lokasi.dataDir;
    if (jenis === 'backups') return lokasi.backupsDir;
    return lokasi.attachmentsDir;
  };

  deps.handle('app:info-lokasi', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(deps.lokasiData());
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('app:buka-folder', async (_e, jenis: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      if (
        typeof jenis !== 'string' ||
        !(JENIS_FOLDER_LOKASI as readonly string[]).includes(jenis)
      ) {
        return fail('Folder yang diminta tidak dikenal.');
      }
      const lokasi = deps.lokasiData();
      const folder = folderLokasi(lokasi, jenis as JenisFolderLokasi);
      // Folder backup/lampiran mungkin belum ada pada pemakaian pertama.
      mkdirSync(folder, { recursive: true });
      const galat = await deps.openPath(folder);
      if (galat) return fail('Folder tidak bisa dibuka. Coba lagi atau hubungi pendamping.');
      return ok({ opened: true, jenis, path: folder });
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // ---- Pengaturan pembukuan (P1-13) ----
  // Semua perubahan wajib lewat PIN terbuka; repository yang menulis audit
  // sebelum/sesudah dan tidak pernah menyertakan PIN.
  deps.handle('pengaturan:get', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(getPengaturanPembukuan(deps.db()));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('pengaturan:simpan', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPengaturanPembukuan(input);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(simpanPengaturanPembukuan(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
    }
  });

  // ---- Jurnal Umum & koreksi (P0-6) ----
  // Bentuk lama dipertahankan: mengembalikan array tanpa total. Layar baru
  // memakai `jurnal:cari` agar pagination memakai total dari server (P1-11).
  deps.handle('jurnal:list', (_e, f: JurnalFilter = {}) => {
    const k = perluBuka();
    if (k) return fail(k);
    const mulai = validasiTanggalOpsional(f?.mulai);
    if (!mulai.ok) return fail(mulai.error);
    const sampai = validasiTanggalOpsional(f?.sampai);
    if (!sampai.ok) return fail(sampai.error);
    if (mulai.input && sampai.input && mulai.input > sampai.input)
      return fail('Tanggal mulai tidak boleh setelah tanggal sampai.');
    const filter: JurnalFilter = {
      mulai: mulai.input || undefined,
      sampai: sampai.input || undefined,
      jenis: typeof f?.jenis === 'string' && f.jenis ? f.jenis : undefined,
      akun_kode: typeof f?.akun_kode === 'string' && f.akun_kode ? f.akun_kode : undefined,
      cari:
        typeof f?.cari === 'string' && f.cari.trim()
          ? f.cari.trim().slice(0, 200)
          : undefined,
      limit: Number.isFinite(f?.limit) ? Number(f.limit) : undefined,
      offset: Number.isFinite(f?.offset) ? Number(f.offset) : undefined,
    };
    return ok(listJurnalLengkap(deps.db(), filter));
  });

  // P1-11: pencarian + pagination server-side. Limit 1..200 & offset >= 0
  // divalidasi di helper murni (tanpa Electron) agar bisa diuji terpisah.
  deps.handle('jurnal:cari', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiFilterJurnalCari(f);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(listJurnalLengkapPage(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // Saran nomor untuk pratinjau form; penomoran final tetap di insertJurnal.
  deps.handle('jurnal:nomor-berikutnya', (_e, tanggal: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const teks = typeof tanggal === 'string' ? tanggal.trim() : '';
      if (!tanggalKalenderValid(teks))
        return fail(PESAN_TANGGAL_TIDAK_VALID);
      return ok({ nomor: saranNomorBukti(deps.db(), teks) });
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // ---- Laporan Buku Besar & Neraca Saldo + drill-down (P1-8) ----
  // Semua angka dihitung ulang dari jurnal oleh core/reports.ts. Handler hanya
  // menormalkan bentuk filter dan memvalidasi tanggal kalender.
  deps.handle('laporan:buku-besar', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiFilterBukuBesar(f);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(
        laporanBukuBesar(deps.db(), bentuk.input.akun_kode, {
          mulai: bentuk.input.mulai,
          sampai: bentuk.input.sampai,
        }),
      );
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('laporan:neraca-saldo', (_e, cutoff: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiCutoffLaporan(cutoff);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(laporanNeracaSaldo(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('laporan:jurnal-akun', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiFilterBukuBesar(f);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(
        laporanJurnalAkun(deps.db(), bentuk.input.akun_kode, {
          mulai: bentuk.input.mulai,
          sampai: bentuk.input.sampai,
        }),
      );
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('laporan:jurnal-detail', (_e, id: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiIdJurnal(id);
      if (!bentuk.ok) return fail(bentuk.error);
      const detail = laporanDetailJurnal(deps.db(), bentuk.input);
      if (!detail) return fail('Jurnal tidak ditemukan.');
      return ok(detail);
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // ---- Layar Laba Rugi, Neraca, Arus Kas (P1-9) ----
  // Angka tetap 100% dari core/reports.ts. Handler hanya memvalidasi bentuk
  // filter dan tanggal kalender; tidak ada perhitungan ulang di main/renderer.
  deps.handle('laporan:laba-rugi', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiRentangLaporan(f);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(laporanLabaRugi(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('laporan:neraca', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiFilterNeraca(f);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(laporanNeraca(deps.db(), bentuk.input.cutoff));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('laporan:arus-kas', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiRentangLaporan(f);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(laporanArusKas(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // ---- Pagu anggaran & realisasi (P2-1) ----
  // Hanya pagu yang disimpan. Realisasi dihitung ulang dari baris jurnal oleh
  // core/anggaran.ts → labaRugi(); tidak ada angka realisasi tersimpan.
  deps.handle('anggaran:list', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukAnggaranList(f);
      if (!bentuk.ok) return fail(bentuk.error);
      const ringkas = getAnggaranTahun(deps.db(), bentuk.input.tahun);
      const akun = listAkun(deps.db()).filter(
        (a) => a.tipe === 'PENDAPATAN' || a.tipe === 'BEBAN',
      );
      return ok({ ...ringkas, akun });
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('anggaran:simpan', (_e, f: unknown = {}, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukAnggaranSimpan(f);
      if (!bentuk.ok) return fail(bentuk.error);
      const alasan =
        typeof opsi === 'object' && opsi !== null && !Array.isArray(opsi)
          ? String((opsi as { alasan?: unknown }).alasan ?? '').trim().slice(0, 500)
          : '';
      const baris = simpanAnggaran(deps.db(), bentuk.input.tahun, bentuk.input.baris, {
        alasan,
      });
      return ok({
        tahun: bentuk.input.tahun,
        baris,
        total: baris.reduce((s, b) => s + b.nominal, 0),
      });
    } catch (e) {
      return fail(pesanError(e, GAGAL_ANGGARAN));
    }
  });

  // Default periode mengikuti awal tahun buku (P1-13). Dengan pengaturan
  // bawaan Januari hasilnya tetap 1 Jan–31 Des seperti tiket; bila awal tahun
  // buku diubah (mis. Juli), laporan memakai tahun buku yang sama dengan
  // dashboard agar pagu & realisasi tidak terpotong di tengah periode.
  deps.handle('laporan:anggaran', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiFilterAnggaran(f);
      if (!bentuk.ok) return fail(bentuk.error);
      const { awalTahunBuku } = getPengaturanPembukuan(deps.db());
      const bawaan = rentangTahunBuku(bentuk.input.tahun, awalTahunBuku);
      return ok(
        laporanRealisasiAnggaran(deps.db(), {
          tahun: bentuk.input.tahun,
          mulai: bentuk.input.mulai ?? bawaan.mulai,
          sampai: bentuk.input.sampai ?? bawaan.sampai,
        }),
      );
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // ---- Rekonsiliasi bank (P2-2) ----
  // Hanya saldo menurut rekening koran yang disimpan. Saldo buku, selisih,
  // status cocok, dan daftar mutasi selalu dihitung ulang dari jurnal oleh
  // core/rekonsiliasi.ts + core/reports.ts.
  deps.handle('rekonsiliasi:list', (_e, f: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukRekonsiliasiList(f);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(listRekonsiliasi(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('rekonsiliasi:detail', (_e, id: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiIdRekonsiliasi(id);
      if (!bentuk.ok) return fail(bentuk.error);
      const detail = getRekonsiliasiDetail(deps.db(), bentuk.input);
      if (!detail) return fail('Rekonsiliasi tidak ditemukan.');
      return ok(detail);
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('rekonsiliasi:create', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukRekonsiliasiCreate(input);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(buatRekonsiliasi(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_REKONSILIASI));
    }
  });

  deps.handle('rekonsiliasi:selesai', (_e, id: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentukId = validasiIdRekonsiliasi(id);
      if (!bentukId.ok) return fail(bentukId.error);
      const bentukOpsi = validasiBentukRekonsiliasiSelesai(opsi);
      if (!bentukOpsi.ok) return fail(bentukOpsi.error);
      return ok(selesaikanRekonsiliasi(deps.db(), bentukId.input, bentukOpsi.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_REKONSILIASI));
    }
  });

  // ---- Simpan jurnal dari form terpandu (P1-1) ----
  // Satu-satunya jalur simpan jurnal baru di luar koreksi. Semua aturan bisnis
  // tetap di posting layer; handler hanya memeriksa bentuk input dari renderer.
  deps.handle('jurnal:posting', (_e, input: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);

      const bentuk = validasiBentukJurnalInput(input);
      if (!bentuk.ok) return fail(bentuk.error);

      const konfirmasiPeringatan =
        typeof opsi === 'object' &&
        opsi !== null &&
        !Array.isArray(opsi) &&
        (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;

      const hasil = postingJurnal(deps.db(), bentuk.input, { konfirmasiPeringatan });
      if (!hasil.tersimpan || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Jurnal gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) => m.includes('Periode sudah ditutup'));
        // Konfirmasi hanya untuk peringatan murni (mis. kas minus), bukan saat
        // masih ada error yang harus diperbaiki.
        const perluKonfirmasi = hasil.errors.length === 0 && hasil.perluKonfirmasi;
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }
      return ok({ jurnal: hasil.jurnal });
    } catch (e) {
      return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
    }
  });

  // ---- Wizard Saldo Awal (P1-6) ----
  // Hanya sekali, saat tabel jurnal masih kosong. Renderer mengirim form mentah
  // (tanggal + saldo per akun); main menyusun jurnal lewat builder murni yang
  // sama dengan pratinjau UI, lalu adapter DB memeriksa "masih kosong" secara
  // atomik sebelum menulis jurnal + audit SALDO-AWAL.
  deps.handle('saldo-awal:status', () => {
    const k = perluBuka();
    return k ? fail(k) : ok(statusSaldoAwal(deps.db()));
  });

  deps.handle('saldo-awal:posting', (_e, input: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);

      const bentuk = validasiBentukSaldoAwal(input);
      if (!bentuk.ok) return fail(bentuk.error);

      const jurnalInput = buatJurnalSaldoAwal(bentuk.input).input;
      const konfirmasiPeringatan =
        typeof opsi === 'object' &&
        opsi !== null &&
        !Array.isArray(opsi) &&
        (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;

      const hasil = simpanSaldoAwal(deps.db(), jurnalInput, { konfirmasiPeringatan });
      if (!hasil.tersimpan || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Saldo awal gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) => m.includes('Periode sudah ditutup'));
        const perluKonfirmasi = hasil.errors.length === 0 && hasil.perluKonfirmasi;
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }
      return ok({ jurnal: hasil.jurnal });
    } catch (e) {
      return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
    }
  });

  deps.handle(
    'jurnal:reverse',
    (
      _e,
      id: string,
      alasan: string,
      opsi: { id?: string; tanggal?: string; no_bukti?: string; konfirmasiPeringatan?: boolean } = {},
    ) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        const tanggal = validasiTanggalOpsional(opsi?.tanggal);
        if (!tanggal.ok) return fail(tanggal.error);
        const hasil = reverseJurnal(deps.db(), String(id ?? ''), String(alasan ?? ''), {
          id: typeof opsi?.id === 'string' ? opsi.id : undefined,
          tanggal: tanggal.input || undefined,
          no_bukti: typeof opsi?.no_bukti === 'string' ? opsi.no_bukti : undefined,
          konfirmasiPeringatan: opsi?.konfirmasiPeringatan === true,
        });
        if (!hasil.tersimpan)
          return fail(
            pesanValidasi(hasil.errors) ||
              pesanValidasi(hasil.peringatan) ||
              'Koreksi gagal disimpan.',
            false,
            hasil.perluKonfirmasi,
          );
        return ok({ jurnal: hasil.reversal });
      } catch (e) {
        return fail(pesanError(e, GAGAL_KOREKSI));
      }
    },
  );

  deps.handle(
    'jurnal:koreksi-isi-ulang',
    (
      _e,
      id: string,
      alasan: string,
      input: JurnalInput,
      opsi: { id?: string; tanggal?: string; no_bukti?: string; konfirmasiPeringatan?: boolean } = {},
    ) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        if (!input || !input.header || !Array.isArray(input.baris))
          return fail('Data jurnal pengganti tidak lengkap.');
        const tanggalJurnal = validasiTanggalOpsional(input.header.tanggal);
        if (!tanggalJurnal.ok || !tanggalJurnal.input)
          return fail(PESAN_TANGGAL_TIDAK_VALID);
        const tanggal = validasiTanggalOpsional(opsi?.tanggal);
        if (!tanggal.ok) return fail(tanggal.error);
        const hasil = koreksiDanIsiUlang(
          deps.db(),
          String(id ?? ''),
          String(alasan ?? ''),
          input,
          {
            id: typeof opsi?.id === 'string' ? opsi.id : undefined,
            tanggal: tanggal.input || undefined,
            no_bukti: typeof opsi?.no_bukti === 'string' ? opsi.no_bukti : undefined,
            konfirmasiPeringatan: opsi?.konfirmasiPeringatan === true,
          },
        );
        if (!hasil.tersimpan)
          return fail(
            pesanValidasi(hasil.errors) ||
              pesanValidasi(hasil.peringatan) ||
              'Koreksi gagal disimpan.',
            false,
            hasil.perluKonfirmasi,
          );
        return ok({ reversal: hasil.reversal, jurnalBaru: hasil.jurnalBaru });
      } catch (e) {
        return fail(pesanError(e, GAGAL_KOREKSI));
      }
    },
  );

  // ---- Lampiran bukti jurnal (P2-4) ----
  // Renderer hanya mengirim ID jurnal/lampiran, TIDAK PERNAH path absolut.
  // File fisik disimpan di `<userData>/attachments`; DB hanya metadata.
  deps.handle('lampiran:list', (_e, jurnalId: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiIdJurnal(jurnalId);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(listLampiran(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('lampiran:upload', async (_e, jurnalId: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiIdJurnal(jurnalId);
      if (!bentuk.ok) return fail(bentuk.error);
      if (!getJurnal(deps.db(), bentuk.input)) return fail('Jurnal tidak ditemukan.');

      const { canceled, filePaths } = await deps.dialog.showOpenDialog({
        title: 'Pilih lampiran bukti jurnal',
        filters: [
          { name: 'Foto atau PDF', extensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'] },
        ],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return ok({ saved: false });

      const sumber = filePaths[0]!;
      const namaAsli = basename(sumber);
      let ukuran = 0;
      try {
        ukuran = statSync(sumber).size;
      } catch {
        return fail('File lampiran tidak bisa dibaca. Coba pilih file lain.');
      }
      // Validasi awal sebelum menyalin file besar ke folder aplikasi.
      const cek = validasiLampiran({ namaAsli, ukuran });
      if (!cek.ok) return fail(cek.error);

      const id = uid('lamp');
      const dir = deps.lampiranDir();
      const meta = simpanLampiranDenganMetadata(
        dir,
        sumber,
        namaAsli,
        id,
        (file) =>
          tambahLampiran(deps.db(), {
            id,
            jurnal_id: bentuk.input,
            nama_asli: file.namaAsli,
            nama_simpan: file.namaSimpan,
            mime: file.mime,
            ukuran: file.ukuran,
          }),
      );
      return ok({ saved: true, lampiran: meta });
    } catch (e) {
      return fail(pesanError(e, GAGAL_LAMPIRAN));
    }
  });

  deps.handle('lampiran:preview', (_e, id: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiIdLampiran(id);
      if (!bentuk.ok) return fail(bentuk.error);
      const meta = getLampiran(deps.db(), bentuk.input);
      if (!meta) return fail('Lampiran tidak ditemukan.');

      // PDF tidak di-inline; renderer memakai tombol Buka (aplikasi OS).
      if (!meta.mime.startsWith('image/')) {
        return ok({ mime: meta.mime, namaAsli: meta.nama_asli });
      }
      let dataUrl: string | null = null;
      try {
        dataUrl = dataUrlLampiran(deps.lampiranDir(), meta.nama_simpan, meta.mime);
      } catch (e) {
        return fail(pesanError(e, 'File lampiran tidak ditemukan di folder aplikasi.'));
      }
      return ok({
        mime: meta.mime,
        namaAsli: meta.nama_asli,
        ...(dataUrl ? { dataUrl } : {}),
      });
    } catch (e) {
      return fail(pesanError(e, GAGAL_LAMPIRAN));
    }
  });

  deps.handle('lampiran:open', async (_e, id: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiIdLampiran(id);
      if (!bentuk.ok) return fail(bentuk.error);
      const meta = getLampiran(deps.db(), bentuk.input);
      if (!meta) return fail('Lampiran tidak ditemukan.');

      // pathFileLampiran memvalidasi nama relatif & memastikan file ada di
      // dalam folder attachments sebelum dibuka.
      const path = pathFileLampiran(deps.lampiranDir(), meta.nama_simpan);
      const galat = await deps.openPath(path);
      if (galat) {
        return fail('File lampiran tidak bisa dibuka. Pastikan aplikasi pembukanya tersedia.');
      }
      return ok({ opened: true });
    } catch (e) {
      return fail(pesanError(e, GAGAL_LAMPIRAN));
    }
  });

  deps.handle('lampiran:delete', (_e, id: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiIdLampiran(id);
      if (!bentuk.ok) return fail(bentuk.error);
      const meta = hapusLampiran(deps.db(), bentuk.input);
      if (!meta) return fail('Lampiran tidak ditemukan.');
      // Metadata + audit sudah terhapus atomik; file dihapus best-effort.
      hapusFileLampiran(deps.lampiranDir(), meta.nama_simpan);
      return ok({ deleted: true, id: meta.id });
    } catch (e) {
      return fail(pesanError(e, GAGAL_LAMPIRAN));
    }
  });

  // ---- Piutang & Hutang + master pihak (P1-5) ----
  // Renderer tidak dipercaya: bentuk input dinormalisasi dulu, lalu adapter DB
  // memvalidasi lima alur baku + menyimpan jurnal/pemetaan pihak/audit atomik.
  deps.handle('pihak:list', () => {
    const k = perluBuka();
    return k ? fail(k) : ok(listPihak(deps.db()));
  });

  deps.handle('pihak:saldo', () => {
    const k = perluBuka();
    return k ? fail(k) : ok(saldoPerPihak(deps.db()));
  });

  deps.handle('pihak:jurnal', (_e, id: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const pihakId = String(id ?? '').trim();
    if (!pihakId) return fail('Pihak wajib dipilih.');
    return ok(daftarJurnalPihak(deps.db(), pihakId));
  });

  deps.handle('pihak:create', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPihak(input);
      if (!bentuk.ok) return fail(bentuk.error);
      const pihak = createPihak(deps.db(), bentuk.input);
      return ok({ id: pihak.id, pihak });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PIHAK));
    }
  });

  deps.handle('pihak:update', (_e, id: string, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const pihakId = String(id ?? '').trim();
      if (!pihakId) return fail('Pihak yang akan diubah belum dipilih.');
      const bentuk = validasiBentukPihak(input);
      if (!bentuk.ok) return fail(bentuk.error);
      const pihak = updatePihak(deps.db(), pihakId, bentuk.input);
      return ok({ id: pihak.id, pihak });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PIHAK));
    }
  });

  deps.handle('pihak:delete', (_e, id: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const pihakId = String(id ?? '').trim();
      if (!pihakId) return fail('Pihak yang akan dihapus belum dipilih.');
      deletePihak(deps.db(), pihakId);
      return ok({ id: pihakId });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PIHAK));
    }
  });

  deps.handle('pihak:posting', (_e, req: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);

      const bentuk = validasiBentukPostingPihak(req);
      if (!bentuk.ok) return fail(bentuk.error);

      const opts = typeof opsi === 'object' && opsi !== null ? opsi : {};
      const hasil = postingPihak(deps.db(), {
        pihakId: bentuk.input.pihakId,
        input: bentuk.input.input,
        konfirmasiPeringatan:
          (opts as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true,
        konfirmasiSaldo:
          (opts as { konfirmasiSaldo?: unknown }).konfirmasiSaldo === true ||
          (opts as { konfirmasi?: unknown }).konfirmasi === true,
      });

      if (!hasil.tersimpan || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Transaksi piutang/hutang gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) =>
          m.includes('Periode sudah ditutup'),
        );
        const perluKonfirmasi =
          hasil.errors.length === 0 && hasil.perluKonfirmasi;
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }

      return ok({
        jurnal: hasil.jurnal,
        pihak: hasil.pihak,
        alur: hasil.alur,
        akunPihak: hasil.akunPihak,
        saldoSebelum: hasil.saldoSebelum,
        saldoSesudah: hasil.saldoSesudah,
      });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PIHAK));
    }
  });

  deps.handle('transaksi:list', (_e, f: { mulai?: string; sampai?: string } = {}) => {
    const k = perluBuka();
    if (k) return fail(k);
    const bentuk = validasiRentangLaporan(f);
    if (!bentuk.ok) return fail(bentuk.error);
    return ok(listTransaksi(deps.db(), bentuk.input));
  });

  deps.handle('transaksi:create', (_e, input: TransaksiInput, alasan?: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const errs = validateTransaksiInput(input);
      if (errs.length) return fail(pesanValidasi(errs));
      const lockedErr = guardPeriodeTerkunci(deps.db(), input.tanggal, alasan);
      if (lockedErr) return fail(lockedErr, true);
      const row: Transaksi = { id: uid('t'), ...input };
      const simpan = deps.db().transaction(() => {
        insertTransaksi(deps.db(), row);
        if (alasan)
          catatAudit(deps.db(), { aksi: `CREATE ${row.id}`, alasan, baru: row });
      });
      simpan();
      return ok({ id: row.id });
    } catch (e) {
      return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
    }
  });

  deps.handle('panjar:list', (_e, status?: 'OPEN' | 'CLOSED') => {
    const k = perluBuka();
    if (k) return fail(k);
    const filter = status === 'OPEN' || status === 'CLOSED' ? status : undefined;
    return ok(listPanjarV2(deps.db(), filter));
  });

  deps.handle('panjar:items', (_e, id: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    if (typeof id !== 'string' || !id.trim())
      return fail('ID panjar wajib diisi.');
    return ok(listPanjarItemsV2(deps.db(), id.trim()));
  });

  deps.handle(
    'panjar:create',
    (_e, input: unknown, alasan?: unknown, opsi?: unknown) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);

        const bentuk = validasiBentukPanjarSerah(input);
        if (!bentuk.ok) return fail(bentuk.error);
        const alasanTeks = typeof alasan === 'string' ? alasan : undefined;
        const konfirmasi =
          typeof opsi === 'object' &&
          opsi !== null &&
          (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;

        const hasil = serahkanPanjar(deps.db(), {
          ...bentuk.input,
          ...(alasanTeks ? { alasan: alasanTeks } : {}),
          konfirmasiPeringatan: konfirmasi,
        });
        if (!hasil.tersimpan || !hasil.panjar) {
          const pesan =
            pesanValidasi(hasil.errors) ||
            pesanValidasi(hasil.peringatan) ||
            'Panjar gagal disimpan.';
          const perluAlasan = hasil.errors.some((m) =>
            m.includes('Periode sudah ditutup'),
          );
          const perluKonfirmasi =
            hasil.errors.length === 0 && hasil.perluKonfirmasi;
          return fail(pesan, perluAlasan, perluKonfirmasi);
        }
        return ok({
          id: hasil.panjar.id,
          panjar: hasil.panjar,
          jurnal: hasil.jurnal,
        });
      } catch (e) {
        return fail(pesanError(e, GAGAL_PANJAR));
      }
    },
  );

  deps.handle(
    'panjar:close',
    (_e, req: unknown, alasan?: unknown) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);

        const bentuk = validasiBentukPanjarClose(req);
        if (!bentuk.ok) return fail(bentuk.error);
        const alasanTeks = typeof alasan === 'string' ? alasan : undefined;
        const opsi = req as {
          konfirmasiKurang?: unknown;
          konfirmasiPeringatan?: unknown;
        };

        const hasil = closePanjarV2(deps.db(), {
          id: bentuk.input.id,
          tanggalClose: bentuk.input.tanggalClose,
          items: bentuk.input.items,
          ...(alasanTeks ? { alasan: alasanTeks } : {}),
          konfirmasiKurang: opsi.konfirmasiKurang === true,
          konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        });
        if (!hasil.tersimpan || !hasil.panjar) {
          const pesan =
            pesanValidasi(hasil.errors) ||
            pesanValidasi(hasil.peringatan) ||
            'Pertanggungjawaban panjar gagal disimpan.';
          const perluAlasan = hasil.errors.some((m) =>
            m.includes('Periode sudah ditutup'),
          );
          const perluKonfirmasi =
            hasil.errors.length === 0 && hasil.perluKonfirmasi;
          return fail(pesan, perluAlasan, perluKonfirmasi);
        }
        return ok({
          totalRealisasi: hasil.totalRealisasi ?? 0,
          sisa: hasil.sisa ?? 0,
          kurang: hasil.kurang ?? 0,
          panjar: hasil.panjar,
          jurnal: hasil.jurnal,
        });
      } catch (e) {
        return fail(pesanError(e, GAGAL_PANJAR));
      }
    },
  );

  // ---- Inventaris Aset (non-keuangan, TIDAK kena kunci tutup buku) ----
  deps.handle('aset:list', (_e, f: { jenis?: string; cari?: string } = {}) => {
    const k = perluBuka();
    return k ? fail(k) : ok(listAset(deps.db(), f));
  });

  deps.handle('aset:create', (_e, input: AsetInput) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const errs = validateAsetInput(input);
      if (errs.length) return fail(pesanValidasi(errs));
      const now = new Date().toISOString();
      const row: Aset = {
        id: uid('a'),
        kode: input.kode.trim(),
        nama: input.nama.trim(),
        jenis: input.jenis as Aset['jenis'],
        luas_m2: input.luas_m2,
        lokasi: input.lokasi.trim(),
        status_hukum: input.status_hukum.trim(),
        tahun_perolehan: input.tahun_perolehan,
        asal_usul: input.asal_usul.trim(),
        kondisi: input.kondisi as Aset['kondisi'],
        keterangan: input.keterangan.trim(),
        nilai_sen: input.nilai_sen,
        created_at: now,
        updated_at: now,
      };
      insertAset(deps.db(), row);
      return ok({ id: row.id });
    } catch (e) {
      if (String(e).includes('UNIQUE constraint failed: aset.kode')) return fail('Kode aset sudah dipakai.');
      return fail(pesanError(e, GAGAL_ASET));
    }
  });

  deps.handle('aset:update', (_e, id: string, input: AsetInput) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const errs = validateAsetInput(input);
      if (errs.length) return fail(pesanValidasi(errs));
      const lama = getAset(deps.db(), String(id));
      if (!lama) return fail('Aset tidak ditemukan.');
      updateAset(deps.db(), {
        ...lama,
        kode: input.kode.trim(),
        nama: input.nama.trim(),
        jenis: input.jenis as Aset['jenis'],
        luas_m2: input.luas_m2,
        lokasi: input.lokasi.trim(),
        status_hukum: input.status_hukum.trim(),
        tahun_perolehan: input.tahun_perolehan,
        asal_usul: input.asal_usul.trim(),
        kondisi: input.kondisi as Aset['kondisi'],
        keterangan: input.keterangan.trim(),
        nilai_sen: input.nilai_sen,
        updated_at: new Date().toISOString(),
      });
      return ok({ id });
    } catch (e) {
      if (String(e).includes('UNIQUE constraint failed: aset.kode')) return fail('Kode aset sudah dipakai.');
      return fail(pesanError(e, GAGAL_ASET));
    }
  });

  deps.handle('aset:delete', (_e, id: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      deleteAset(deps.db(), String(id));
      return ok({ id });
    } catch (e) {
      return fail(pesanError(e, GAGAL_ASET));
    }
  });

  deps.handle('tutup:list', () => {
    const k = perluBuka();
    if (k) return fail(k);
    // Laba pada riwayat dihitung ulang dari jurnal, bukan angka tersimpan.
    const baris = listBarisJurnal(deps.db());
    return ok(
      listTutupBuku(deps.db()).map((t) => ({
        ...t,
        laba: labaTahunJurnal(baris, Number(t.tahun)),
      })),
    );
  });
  // P0-9: riwayat audit lengkap + filter tervalidasi (aksi/tanggal/pagination).
  deps.handle('audit:list', (_e, f: AuditFilter = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const tanggalFilter = (v: unknown): string | undefined => {
        if (typeof v !== 'string' || !v.trim()) return undefined;
        return v.trim();
      };
      const mulai = tanggalFilter(f?.mulai);
      const sampai = tanggalFilter(f?.sampai);
      if (mulai && !tanggalKalenderValid(mulai))
        return fail(PESAN_TANGGAL_TIDAK_VALID);
      if (sampai && !tanggalKalenderValid(sampai))
        return fail(PESAN_TANGGAL_TIDAK_VALID);
      if (mulai && sampai && mulai > sampai)
        return fail('Tanggal mulai tidak boleh setelah tanggal sampai.');
      const aksi =
        typeof f?.aksi === 'string' && f.aksi.trim()
          ? f.aksi.trim().slice(0, 120)
          : undefined;
      const angka = (v: unknown, bawaan: number): number => {
        if (v === undefined || v === null || v === '') return bawaan;
        const n = Number(v);
        return Number.isFinite(n) ? n : bawaan;
      };
      const limit = Math.min(500, Math.max(1, Math.trunc(angka(f?.limit, 50))));
      const offset = Math.max(0, Math.trunc(angka(f?.offset, 0)));
      return ok(listAuditLogPage(deps.db(), { aksi, mulai, sampai, limit, offset }));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });
  deps.handle('tutup:preview', (_e, tahun: number) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(previewTutupBuku(deps.db(), Number(tahun), tanggalSekarang()));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });
  deps.handle(
    'tutup:create',
    (
      _e,
      req:
        | number
        | {
            tahun: number;
            catatan?: string;
            backupPath?: string;
            konfirmasiTimpak?: boolean;
          },
      backupPathLama = '',
    ) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        // Dukungan bentuk lama (tahun, backupPath) + bentuk baru (objek).
        const input =
          typeof req === 'number'
            ? { tahun: req, backupPath: String(backupPathLama ?? '') }
            : (req ?? {});
        const hasil = tutupBuku(deps.db(), Number(input.tahun), {
          catatan: typeof input.catatan === 'string' ? input.catatan : '',
          backupPath: typeof input.backupPath === 'string' ? input.backupPath : '',
          konfirmasiTimpak: input.konfirmasiTimpak === true,
          // Tanggal acuan K2 dapat dipatok test; default tetap hari ini.
          sekarang: tanggalSekarang(),
        });
        if (!hasil.tersimpan)
          return fail(
            pesanValidasi(hasil.errors) ||
              pesanValidasi(hasil.peringatan) ||
              'Tutup buku gagal disimpan.',
            false,
            hasil.perluKonfirmasi,
          );
        return ok({
          tahun: hasil.data!.tahun,
          laba: hasil.laba,
          labaDitahan: hasil.labaDitahan,
          aksi: hasil.aksi,
          data: hasil.data,
        });
      } catch (e) {
        return fail(pesanError(e, GAGAL_TUTUP));
      }
    },
  );

  deps.handle('saldo:list', (_e, cutoff?: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const tanggal = validasiTanggalOpsional(cutoff);
    if (!tanggal.ok) return fail(tanggal.error);
    const perKas = saldoSemuaKasJurnal(
      listBarisJurnal(deps.db()),
      KAS_KODES,
      tanggal.input || undefined,
    );
    return ok({ perKas, total: Object.values(perKas).reduce((s, v) => s + v, 0) });
  });

  deps.handle('neraca:get', (_e, cutoff: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      if (!tanggalKalenderValid(cutoff))
        return fail(PESAN_TANGGAL_TIDAK_VALID);
      const baris = listBarisJurnal(deps.db());
      const n = neracaJurnal(baris, {
        cutoff,
        tutup: listTutupBuku(deps.db()),
      });
      // Bentuk kompatibel untuk tab Neraca lama (P1-9 akan memakai bentuk
      // rinci per akun dari mesin laporan).
      const kas: Record<string, number> = {};
      for (const kode of KAS_KODES) kas[kode] = saldoAkun(baris, kode, cutoff);
      const modalAwal = n.ekuitas.find((a) => a.kode === '3000')?.saldo ?? 0;
      return ok({
        cutoff,
        aktiva: n.totalAset,
        aktivaRinci: {
          kas,
          piutang: n.aset.find((a) => a.kode === '1050')?.saldo ?? 0,
          panjarOpen: n.aset.find((a) => a.kode === '1040')?.saldo ?? 0,
        },
        hutang: n.totalKewajiban,
        modalAwal,
        // Semua ekuitas selain modal + laba tahun lampau (turunan jurnal).
        kumulatif: n.totalEkuitasAkun - modalAwal + n.labaDitahan + n.labaBelumDitutup,
        berjalan: n.labaBerjalan,
        pasiva: n.totalPasiva,
        selisih: n.selisih,
        balance: n.balance,
      });
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  deps.handle('dashboard:get', (_e, cutoff: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      // Cut-off wajib tanggal kalender nyata (P1-12/P1-14).
      const bentuk = validasiCutoffLaporan(cutoff);
      if (!bentuk.ok) return fail(bentuk.error);
      const pengaturan = getPengaturanPembukuan(deps.db());
      const d = buildDashboardJurnal(
        listBarisJurnal(deps.db()),
        listTutupBuku(deps.db()),
        bentuk.input,
        {
          awalTahunBuku: pengaturan.awalTahunBuku,
          // Batas tutup buku mengikuti hari ini, bukan cut-off pelaporan.
          sekarang: tanggalSekarang(),
        },
      );
      const dirBackup = deps.lokasiData().backupsDir;
      return ok(denganBackupTerakhir(d, lastAutoBackup(dirBackup)));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // Simpan buffer (xlsx/html) via save dialog. Renderer bangun buffer murni,
  // main hanya tulis file — sesuai handoff: builder tetap di renderer.
  deps.handle(
    'file:save-buffer',
    async (_e, req: { bufferB64: string; defaultName: string; filters?: { name: string; extensions: string[] }[] }) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        const { canceled, filePath } = await deps.dialog.showSaveDialog({
          defaultPath: req.defaultName,
          filters: req.filters,
        });
        if (canceled || !filePath) return ok({ saved: false, path: '' });
        deps.writeFile(filePath, Buffer.from(req.bufferB64, 'base64'));
        return ok({ saved: true, path: filePath });
      } catch (e) {
        return fail(pesanError(e, GAGAL_FILE));
      }
    },
  );

  // Simpan PDF langsung: render HTML laporan di hidden window lalu printToPDF.
  // Renderer mengirim HTML paginator P1-16 (tanpa script, halaman eksplisit).
  deps.handle(
    'file:save-pdf',
    async (_e, req: { htmlB64: string; defaultName: string; landscape?: boolean }) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        const html = Buffer.from(req.htmlB64, 'base64').toString('utf-8');
        if (!html.trim()) return fail('HTML laporan kosong.');
        const name = req.defaultName.endsWith('.pdf') ? req.defaultName : `${req.defaultName}.pdf`;
        const { canceled, filePath } = await deps.dialog.showSaveDialog({
          defaultPath: name,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (canceled || !filePath) return ok({ saved: false, path: '' });
        await deps.printPdf(html, filePath, req.landscape === true);
        return ok({ saved: true, path: filePath });
      } catch (e) {
        return fail(pesanError(e, GAGAL_FILE));
      }
    },
  );

  // Backup manual .db via save dialog (VACUUM INTO — aman saat WAL terbuka).
  deps.handle('backup:export', async () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const Stamp = tanggalSekarang();
      const { canceled, filePath } = await deps.dialog.showSaveDialog({
        defaultPath: `pura-backup-${Stamp}.db`,
        filters: [{ name: 'SQLite DB', extensions: ['db'] }],
      });
      if (canceled || !filePath) return ok({ saved: false, path: '' });
      backupVacuumInto(deps.db(), filePath);
      catatAudit(deps.db(), {
        aksi: 'BACKUP-EXPORT',
        alasan: `Backup manual ke ${basename(filePath)}`,
        baru: { path: filePath, jenis: 'manual' },
      });
      return ok({ saved: true, path: filePath });
    } catch (e) {
      return fail(pesanError(e, GAGAL_BACKUP));
    }
  });

  // Auto-backup internal untuk wizard Tutup Buku (tanpa dialog).
  deps.handle('backup:auto', (_e, tahun: number) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const dir = deps.lokasiData().backupsDir;
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, `pura-${tahun}.db`);
      backupVacuumInto(deps.db(), dest);
      catatAudit(deps.db(), {
        aksi: 'BACKUP-AUTO',
        alasan: `Backup otomatis sebelum tutup buku ${tahun}`,
        baru: { path: dest, jenis: 'tutup-buku', tahun: Number(tahun) },
      });
      return ok({ path: dest });
    } catch (e) {
      return fail(pesanError(e, GAGAL_BACKUP));
    }
  });

  // Status backup otomatis harian terakhir (untuk Dashboard).
  deps.handle('backup:status', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const dir = deps.lokasiData().backupsDir;
      return ok({ path: lastAutoBackup(dir) });
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  // Restore .db via open dialog: validasi kandidat → cadangkan DB aktif →
  // tukar file atomik → buka ulang → audit. Kegagalan tidak merusak DB lama.
  deps.handle('backup:import', async () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const { canceled, filePaths } = await deps.dialog.showOpenDialog({
        filters: [{ name: 'SQLite DB', extensions: ['db'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return ok({ restored: false, path: '' });
      const src = filePaths[0]!;
      const hasil = restoreDbAman(deps.db(), {
        dbPath: deps.dbPath(),
        backupPath: src,
        dirBackup: deps.lokasiData().backupsDir,
      });
      deps.setDb(hasil.db);
      if (!hasil.ok) return fail(hasil.error);
      try {
        catatAudit(deps.db(), {
          aksi: 'RESTORE',
          alasan: `Restore dari ${basename(src)}`,
          baru: {
            sumber: src,
            cadangan_sebelum_restore: hasil.preRestorePath,
            db_aktif: deps.dbPath(),
          },
        });
      } catch (e) {
        console.warn('[restore] gagal menulis audit:', String(e));
      }
      return ok({ restored: true, path: deps.dbPath(), preRestorePath: hasil.preRestorePath });
    } catch (e) {
      return fail(pesanError(e, GAGAL_RESTORE));
    }
  });
}
