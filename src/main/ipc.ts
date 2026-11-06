// Registrasi seluruh handler IPC aplikasi (P2-7).
//
// Modul ini sengaja TIDAK mengimpor Electron runtime. Semua ketergantungan
// main-process (koneksi DB yang bisa berganti setelah restore, dialog native,
// tulis file, cetak PDF, buka file OS) masuk lewat `IpcDeps`
// sehingga seluruh alur create → reverse → tutup → backup → restore bisa
// diuji dengan vitest tanpa Electron.

import type Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  catatAudit,
  getPengaturanPembukuan,
  guardPeriodeTerkunci,
  hapusAkun,
  kodeKasDariDb,
  listAkun,
  listAuditLogPage,
  listJurnalLengkap,
  listJurnalLengkapPage,
  listTutupBuku,
  saranNomorBukti,
  setAkunAktif,
  simpanPengaturanPembukuan,
  tambahAkun,
  ubahNamaAkun,
  type AuditFilter,
  type JurnalFilter,
} from '../db/repository.js';
import { koreksiDanIsiUlang, reverseJurnal } from '../db/reversal.js';
import {
  PESAN_WAJIB_ALASAN_PERINGATAN,
  postingJurnal,
  validasiJurnalDb,
} from '../db/posting.js';
import {
  koreksiSaldoAwal,
  PESAN_ALASAN_KOREKSI_MIN,
  simpanSaldoAwal,
  statusSaldoAwal,
} from '../db/saldoAwal.js';
import {
  batalPanjarV2,
  batalkanPertanggungjawabanPanjar,
  closePanjarV2,
  listPanjarItemsV2,
  listPanjarV2,
  serahkanPanjar,
} from '../db/panjar.js';
import { previewTutupBuku, tutupBuku } from '../db/tutup.js';
import {
  bayarAngsuranPinjaman,
  batalkanPembayaranPinjaman,
  batalkanPinjaman,
  getPinjaman,
  listPinjamanBayar,
  laporanMutasiPinjaman,
  listPinjaman,
  simpanPinjamanLpd,
} from '../db/pinjaman.js';
import {
  rekonsiliasiPinjaman,
  rekonsiliasiSemuaPinjaman,
} from '../db/pinjamanRekonsiliasi.js';
import { auditIntegritas } from '../db/integritas.js';
import { AKUN_PIUTANG } from '../db/coa.js';
import {
  labaTahun as labaTahunJurnal,
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
import {
  buatBackupLengkap,
  stampBackupLokal,
} from '../features/export/backupLengkap.js';
import { restoreLengkap } from '../features/export/restoreLengkap.js';
import { pastikanBukanFileDbAktif } from '../features/export/pathAman.js';
import { tanggalKalenderValid, type JurnalInput } from '../core/posting.js';
import {
  catatanTahunPertamaParsial,
  pengaturanPublik,
} from '../core/pengaturan.js';
import { buatJurnalSaldoAwal } from '../core/forms.js';
import {
  PESAN_SIMPAN_GAGAL,
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
  pesanValidasi,
} from '../utils/pesanError.js';
import { tanggalLokal } from '../utils/tanggal.js';
import {
  validasiBentukJurnalInput,
  validasiBentukKoreksiInput,
  validasiAlasanAkun,
  validasiBentukAkunBaru,
  validasiBentukAkunUbah,
  validasiKodeAkun,
  validasiStatusAkunAktif,
  validasiBentukPanjarClose,
  validasiBentukPanjarSerah,
  validasiBentukPembatalanPertanggungjawabanPanjar,
  validasiBentukPengaturanPembukuan,
  validasiBentukPinjamanBayar,
  validasiBentukPembatalanPinjaman,
  validasiBentukPinjamanMutasi,
  validasiBentukPinjamanRekonsiliasi,
  validasiBentukPinjamanSimpan,
  validasiBentukSaldoAwal,
  validasiBentukTransaksiInput,
  validasiCutoffLaporan,
  validasiFilterBukuBesar,
  validasiFilterJurnalCari,
  validasiFilterNeraca,
  validasiFilterNeracaSaldo,
  validasiIdJurnal,
  validasiRentangLaporan,
  validasiTanggalOpsional,
} from './validation.js';
import {
  ambilKodeDaruratSekali,
  aturIdle,
  bukaKunci,
  gantiKodeDarurat,
  kunciLagi,
  resetPaksa,
  sentuhAktivitas,
  sesi,
  setupPin,
  statusKunci,
  tahanAutoKunci,
  ubahPin,
} from './kunci.js';
import { sudahSetupPin } from '../db/repository.js';
import type { LokasiData } from './lokasiData.js';
import type { LoggerApp } from './logApp.js';
import { pengirimDiizinkan, type KonteksNavigasi } from './windowSecurity.js';

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
  /** Lokasi data final (P2-8): folder data, DB, dan backup. */
  lokasiData(): LokasiData;
  /**
   * AUD-34: logger main untuk alur backup/restore. Opsional agar test IPC
   * tidak perlu menyiapkan file log.
   */
  log?: Pick<LoggerApp, 'info' | 'warn' | 'error'>;
  /** Waktu acuan yang bisa dipatok di test; default `new Date()`. */
  now?(): Date;
  /**
   * AUD-17: konteks pengirim IPC yang sah. Hanya frame renderer aplikasi
   * (file build atau dev origin) yang boleh memanggil handler.
   */
  pengirim: KonteksNavigasi;
};

export function registerIpc(deps: IpcDeps): void {
  const sekarang = (): Date => deps.now?.() ?? new Date();
  const tanggalSekarang = (): string => tanggalLokal(sekarang());

  const ok = <T>(data: T) => ({ ok: true as const, data });
  const fail = (error: string, perluAlasan = false, perluKonfirmasi = false) => ({
    ok: false as const,
    error,
    perluAlasan,
    perluKonfirmasi,
  });

  /** AKT-02: hanya `true` eksplisit dari renderer yang dianggap konfirmasi. */
  const bacaKonfirmasiTanpaSaldoAwal = (opsi: unknown): boolean =>
    typeof opsi === 'object' &&
    opsi !== null &&
    !Array.isArray(opsi) &&
    (opsi as { konfirmasiTanpaSaldoAwal?: unknown }).konfirmasiTanpaSaldoAwal === true;
  /**
   * DB-09: restore `.db` adalah jalur lanjutan yang hanya mengganti database.
   * Renderer wajib mengirim `true` eksplisit setelah dua peringatan; panggilan
   * langsung tanpa konfirmasi ditolak sebelum dialog file dibuka.
   */
  const bacaKonfirmasiRestoreDb = (opsi: unknown): boolean =>
    typeof opsi === 'object' &&
    opsi !== null &&
    !Array.isArray(opsi) &&
    (opsi as { konfirmasiRestoreDb?: unknown }).konfirmasiRestoreDb === true;
  /** AKT-06: hanya string dari renderer yang diteruskan sebagai alasan. */
  const bacaTeksOpsi = (opsi: unknown, kunci: string): string | undefined => {
    if (typeof opsi !== 'object' || opsi === null || Array.isArray(opsi)) return undefined;
    const nilai = (opsi as Record<string, unknown>)[kunci];
    return typeof nilai === 'string' ? nilai : undefined;
  };

  // AUD-17: setiap handler hanya boleh dipanggil frame renderer aplikasi.
  // Event tanpa senderFrame (frame hancur) atau dari iframe/halaman asing
  // ditolak sebelum listener menyentuh DB/dialog.
  //
  // AUD-18: backup/restore bisa memblokir main cukup lama. Selama operasi itu,
  // auto-lock ditahan agar sesi tidak terkunci di tengah proses yang sah.
  const CHANNEL_TAHAN_KUNCI = new Set([
    'backup:auto',
    'backup:export',
    'backup:import',
    'backup:lengkap',
    'backup:restore-lengkap',
  ]);

  const jalankanHandler = (channel: string, jalankan: () => unknown): unknown => {
    if (!CHANNEL_TAHAN_KUNCI.has(channel)) return jalankan();
    const selesaiTahan = tahanAutoKunci();
    try {
      const hasil = jalankan();
      if (hasil instanceof Promise) return hasil.finally(selesaiTahan);
      selesaiTahan();
      return hasil;
    } catch (e) {
      selesaiTahan();
      throw e;
    }
  };

  const daftarkan = (
    channel: string,
    listener: (event: unknown, ...args: any[]) => unknown,
  ): void => {
    deps.handle(channel, (event, ...args) => {
      const frame = (
        event as { senderFrame?: { url?: string | null } | null } | null
      )?.senderFrame;
      if (!pengirimDiizinkan(frame, deps.pengirim)) {
        return fail('Permintaan ditolak: pengirim bukan aplikasi ini.');
      }
      return jalankanHandler(channel, () => listener(event, ...args));
    });
  };

  // Error internal tidak pernah dikirim mentah ke renderer. Pesan bisnis yang
  // sudah berbahasa Indonesia tetap lolos lewat `pesanError`.
  const GAGAL_MUAT =
    'Terjadi kesalahan saat memuat data. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_KOREKSI =
    'Terjadi kesalahan saat menyimpan koreksi. Jurnal asli tidak diubah; coba lagi atau hubungi pendamping.';
  const GAGAL_PANJAR =
    'Terjadi kesalahan saat menyimpan panjar. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_PINJAMAN =
    'Terjadi kesalahan saat menyimpan pinjaman LPD. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_TUTUP =
    'Terjadi kesalahan saat memproses kunci periode. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_FILE = 'Gagal menyimpan file. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_BACKUP = 'Gagal membuat cadangan. Coba lagi; bila tetap gagal, hubungi pendamping.';
  const GAGAL_RESTORE =
    'Gagal memulihkan data. Data lama tetap dipakai; coba lagi atau hubungi pendamping.';
  // T1.2: pesan simpan sengaja tidak memuat kata teknis (mis. "database")
  // agar tidak diganti pesan generik oleh `pesanError`. Guard berlaku untuk
  // semua kanal simpan, bukan hanya backup.
  const PESAN_SIMPAN_KE_DB_AKTIF =
    'File DB yang sedang aktif tidak boleh menjadi tujuan simpan. Pilih nama file lain.';

  /** Tolak tujuan simpan yang menunjuk DB aktif atau sidecar `-wal`/`-shm`. */
  const pastikanTujuanBukanDbAktif = (filePath: string): void => {
    try {
      pastikanBukanFileDbAktif(deps.dbPath(), filePath);
    } catch {
      throw new Error(PESAN_SIMPAN_KE_DB_AKTIF);
    }
  };

  daftarkan('coa:list', () => ok(listAkun(deps.db())));
  daftarkan('akun:tambah', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukAkunBaru(input);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(tambahAkun(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, 'Gagal menambah akun.'));
    }
  });
  daftarkan('akun:ubah', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukAkunUbah(input);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(ubahNamaAkun(deps.db(), bentuk.input.kode, bentuk.input.nama));
    } catch (e) {
      return fail(pesanError(e, 'Gagal mengubah nama akun.'));
    }
  });
  daftarkan('akun:set-aktif', (_e, kode: unknown, aktif: unknown, alasan: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentukKode = validasiKodeAkun(kode);
      if (!bentukKode.ok) return fail(bentukKode.error);
      const bentukAktif = validasiStatusAkunAktif(aktif);
      if (!bentukAktif.ok) return fail(bentukAktif.error);
      const bentukAlasan = validasiAlasanAkun(alasan);
      if (!bentukAlasan.ok) return fail(bentukAlasan.error);
      return ok(
        setAkunAktif(
          deps.db(),
          bentukKode.input,
          bentukAktif.input,
          bentukAlasan.input,
        ),
      );
    } catch (e) {
      return fail(pesanError(e, 'Gagal mengubah status akun.'));
    }
  });
  daftarkan('akun:hapus', (_e, kode: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiKodeAkun(kode);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(hapusAkun(deps.db(), bentuk.input));
    } catch (e) {
      return fail(pesanError(e, 'Gagal menghapus akun.'));
    }
  });

  // Kunci aplikasi: sesi selalu terkunci saat app dibuka (sesi.terbuka=false awal).
  daftarkan('lock:status', () => ok(statusKunci(deps.db())));
  daftarkan('lock:setup', (_e, pin: string) => {
    const err = setupPin(deps.db(), String(pin ?? ''));
    if (err) return fail(err);
    // AUD-19: plaintext hanya ada di memori dan hanya ikut respons ini sekali.
    return ok({ terbuka: true, kodeDarurat: ambilKodeDaruratSekali() });
  });
  daftarkan('lock:unlock', (_e, pin: string) => {
    const err = bukaKunci(deps.db(), String(pin ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });
  daftarkan('lock:lock', () => {
    kunciLagi();
    return ok({ terkunci: true });
  });
  daftarkan('lock:change', (_e, lama: string, baru: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const err = ubahPin(deps.db(), String(lama ?? ''), String(baru ?? ''));
    return err ? fail(err) : ok({ diubah: true });
  });
  daftarkan('lock:idle-set', (_e, menit: number) => {
    const k = perluBuka();
    if (k) return fail(k);
    const err = aturIdle(deps.db(), Number(menit));
    return err ? fail(err) : ok({ idleMenit: Number(menit) });
  });
  daftarkan('lock:reset-code', () => {
    const k = perluBuka();
    if (k) return fail(k);
    return ok({ kodeDarurat: gantiKodeDarurat(deps.db()) });
  });
  daftarkan('lock:reset', (_e, kode: string, pinBaru: string) => {
    const err = resetPaksa(deps.db(), String(kode ?? ''), String(pinBaru ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });

  // Gembok data: selain channel lock:* & coa:list, tolak bila PIN sudah di-setup
  // tapi sesi belum dibuka. Mencegah bypass via devtools (ancaman anak/iseng).
  // lock:change & lock:idle-set justru WAJIB terbuka → ikut dijaga di bawah.
  // AUD-18: setiap pemanggilan yang lolos gembok dihitung sebagai aktivitas
  // nyata. lock:status (polling renderer) tidak lewat sini agar tidak menahan
  // sesi tetap terbuka saat operator meninggalkan laptop.
  const perluBuka = (): string | null => {
    if (sudahSetupPin(deps.db()) && !sesi.terbuka) {
      return 'Aplikasi terkunci. Buka dengan PIN dulu.';
    }
    sentuhAktivitas();
    return null;
  };

  // ---- Lokasi data & folder (P2-8) ----
  // Renderer hanya boleh meminta dua nama folder tetap; TIDAK PERNAH path.
  const JENIS_FOLDER_LOKASI = ['data', 'backups'] as const;
  type JenisFolderLokasi = (typeof JENIS_FOLDER_LOKASI)[number];
  const folderLokasi = (lokasi: LokasiData, jenis: JenisFolderLokasi): string => {
    if (jenis === 'data') return lokasi.dataDir;
    return lokasi.backupsDir;
  };

  daftarkan('app:info-lokasi', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(deps.lokasiData());
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('app:buka-folder', async (_e, jenis: unknown) => {
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
      // Folder backup mungkin belum ada pada pemakaian pertama.
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
  daftarkan('pengaturan:get', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      // DB-28: `awalTahunBuku` tetap dibaca internal untuk data lama, tetapi
      // tidak pernah diekspos ke kontrak renderer.
      return ok(pengaturanPublik(getPengaturanPembukuan(deps.db())));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('pengaturan:simpan', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPengaturanPembukuan(input);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(
        pengaturanPublik(simpanPengaturanPembukuan(deps.db(), bentuk.input)),
      );
    } catch (e) {
      return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
    }
  });

  // ---- Jurnal Umum & koreksi (P0-6) ----
  // Bentuk lama dipertahankan: mengembalikan array tanpa total. Layar baru
  // memakai `jurnal:cari` agar pagination memakai total dari server (P1-11).
  daftarkan('jurnal:list', (_e, f: JurnalFilter = {}) => {
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
  daftarkan('jurnal:cari', (_e, f: unknown = {}) => {
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

  // Saran nomor untuk pratinjau form; penomoran final tetap di postingJurnal.
  daftarkan('jurnal:nomor-berikutnya', (_e, tanggal: unknown) => {
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
  daftarkan('laporan:buku-besar', (_e, f: unknown = {}) => {
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

  daftarkan('laporan:neraca-saldo', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiFilterNeracaSaldo(input);
      if (!bentuk.ok) return fail(bentuk.error);
      return ok(
        laporanNeracaSaldo(
          deps.db(),
          bentuk.input.cutoff,
          bentuk.input.mode,
        ),
      );
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('laporan:jurnal-akun', (_e, f: unknown = {}) => {
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

  daftarkan('laporan:jurnal-detail', (_e, id: unknown) => {
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
  daftarkan('laporan:laba-rugi', (_e, f: unknown = {}) => {
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

  daftarkan('laporan:neraca', (_e, f: unknown = {}) => {
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

  daftarkan('laporan:arus-kas', (_e, f: unknown = {}) => {
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

  // ---- Simpan jurnal baru: dua pintu terpisah (DB-03) ----
  // `transaksi:posting` khusus form terpandu (TERIMA/BAYAR/TRANSFER/HUTANG),
  // sedangkan `jurnal:posting` khusus jurnal manual berjenis UMUM. Keduanya
  // memakai alur simpan yang sama agar nomor bukti, validasi, audit, dan bentuk
  // respons tidak berbeda. Semua aturan bisnis tetap di posting layer.
  const simpanJurnalBaru = (
    input: unknown,
    opsi: unknown,
    validasiBentuk: (nilai: unknown) => ReturnType<typeof validasiBentukJurnalInput>,
  ): unknown => {
    try {
      const k = perluBuka();
      if (k) return fail(k);

      const bentuk = validasiBentuk(input);
      if (!bentuk.ok) return fail(bentuk.error);

      const konfirmasiPeringatan =
        typeof opsi === 'object' &&
        opsi !== null &&
        !Array.isArray(opsi) &&
        (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;
      const konfirmasiTanpaSaldoAwal = bacaKonfirmasiTanpaSaldoAwal(opsi);

      // DB-23a/DB-23b: akun 1050 hanya dipertahankan untuk data lama. Jurnal
      // baru yang menyentuhnya minta konfirmasi (bukan error) agar tidak menjadi
      // pintu input piutang. Peringatan ini hanya untuk 1050; akun 2050/2060
      // kini dipakai form utang sederhana tanpa master pihak.
      // Hanya dicek saat belum dikonfirmasi dan tidak ada error lain, sehingga
      // pesan validasi asli tetap diutamakan.
      const peringatanAkunLama = bentuk.input.baris.some(
        (b) => String(b.akun_kode ?? '').trim() === AKUN_PIUTANG,
      )
        ? [
            'Jurnal memakai akun 1050 PIUTANG LAIN LAIN yang hanya dipertahankan ' +
              'untuk data lama; alur piutang sudah dihapus.',
          ]
        : [];
      if (!konfirmasiPeringatan && peringatanAkunLama.length > 0) {
        const validasi = validasiJurnalDb(deps.db(), bentuk.input);
        if (validasi.errors.length === 0) {
          return fail(
            pesanValidasi([...validasi.peringatan, ...peringatanAkunLama]),
            false,
            true,
          );
        }
      }

      const hasil = postingJurnal(deps.db(), bentuk.input, {
        konfirmasiPeringatan,
        // AKT-06: jurnal yang tetap disimpan meski ada peringatan wajib
        // menyertakan alasan; diteruskan ke audit data_baru_json.
        alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
        wajibAlasanPeringatan: true,
        // AKT-01: form transaksi/jurnal umum wajib punya saldo awal, kecuali
        // operator sudah menekan "mulai tanpa saldo awal" (diteruskan UI AKT-02).
        wajibSaldoAwal: true,
        konfirmasiTanpaSaldoAwal,
      });
      if (!hasil.tersimpan || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Jurnal gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) => m.includes('Periode sudah ditutup'));
        // Konfirmasi hanya untuk peringatan murni (mis. kas minus), bukan saat
        // masih ada error yang harus diperbaiki. AKT-06: alasan peringatan yang
        // kurang tetap minta konfirmasi ulang.
        const perluKonfirmasi =
          hasil.perluKonfirmasi &&
          (hasil.errors.length === 0 ||
            hasil.errors.every((m) => m === PESAN_WAJIB_ALASAN_PERINGATAN));
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }
      return ok({ jurnal: hasil.jurnal });
    } catch (e) {
      return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
    }
  };

  daftarkan('jurnal:posting', (_e, input: unknown, opsi: unknown = {}) =>
    simpanJurnalBaru(input, opsi, validasiBentukJurnalInput),
  );

  daftarkan('transaksi:posting', (_e, input: unknown, opsi: unknown = {}) =>
    simpanJurnalBaru(input, opsi, validasiBentukTransaksiInput),
  );

  // ---- Wizard Saldo Awal (P1-6) ----
  // Hanya sekali; setelah ada jurnal harian pun masih boleh disusulkan selama
  // tanggal saldo awal tidak setelah jurnal paling awal (AUD2-02). Renderer
  // mengirim form mentah (tanggal + saldo per akun); main menyusun jurnal lewat
  // builder murni yang sama dengan pratinjau UI, lalu adapter DB memeriksa
  // eksistensi SALDO_AWAL + batas tanggal secara atomik sebelum menulis jurnal
  // + audit SALDO-AWAL.
  daftarkan('saldo-awal:status', () => {
    const k = perluBuka();
    return k ? fail(k) : ok(statusSaldoAwal(deps.db()));
  });

  daftarkan('saldo-awal:posting', (_e, input: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);

      const bentuk = validasiBentukSaldoAwal(input);
      if (!bentuk.ok) return fail(bentuk.error);

      const jurnalInput = buatJurnalSaldoAwal({
        ...bentuk.input,
        daftarAkun: listAkun(deps.db()),
      }).input;
      const konfirmasiPeringatan =
        typeof opsi === 'object' &&
        opsi !== null &&
        !Array.isArray(opsi) &&
        (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;
      const konfirmasiTanpaSaldoAwal = bacaKonfirmasiTanpaSaldoAwal(opsi);

      const hasil = simpanSaldoAwal(deps.db(), jurnalInput, {
        konfirmasiPeringatan,
        // AKT-06: alasan konfirmasi peringatan ikut melewati adapter saldo awal.
        alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
        wajibAlasanPeringatan: true,
        // AKT-02: opsi diteruskan konsisten; jenis SALDO_AWAL selalu dikecualikan
        // dari guard sehingga wizard tetap bisa menjadi jurnal pertama.
        wajibSaldoAwal: true,
        konfirmasiTanpaSaldoAwal,
      });
      if (!hasil.tersimpan || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Saldo awal gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) => m.includes('Periode sudah ditutup'));
        const perluKonfirmasi =
          hasil.perluKonfirmasi &&
          (hasil.errors.length === 0 ||
            hasil.errors.every((m) => m === PESAN_WAJIB_ALASAN_PERINGATAN));
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }
      return ok({ jurnal: hasil.jurnal });
    } catch (e) {
      return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
    }
  });

  // T1.7: koreksi saldo awal (Opsi A) — reversal jurnal pembukaan aktif +
  // jurnal penyesuaian UMUM baru + audit, atomik di adapter DB. Renderer
  // mengirim form yang sama dengan wizard; builder/validator yang sama dipakai
  // agar aturan akun dan modal otomatis tidak bercabang.
  daftarkan(
    'saldo-awal:koreksi',
    (
      _e,
      input: unknown,
      alasanMentah: unknown = '',
      opsiMentah: unknown = {},
    ) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);

        const bentuk = validasiBentukSaldoAwal(input);
        if (!bentuk.ok) return fail(bentuk.error);

        // Dukung dua gaya pemanggilan: (input, alasan, opsi) dan
        // (input, opsi) dengan `alasan` di dalam input/opsi. `alasan` dari
        // argumen eksplisit tetap menang.
        const opsi =
          alasanMentah !== null &&
          typeof alasanMentah === 'object' &&
          !Array.isArray(alasanMentah)
            ? alasanMentah
            : opsiMentah;
        const alasan = String(
          (typeof alasanMentah === 'string' ? alasanMentah : '') ||
            bentuk.input.alasan ||
            bacaTeksOpsi(opsi, 'alasan') ||
            '',
        ).trim();
        if (alasan.length < 5) return fail(PESAN_ALASAN_KOREKSI_MIN);

        const jurnalInput = buatJurnalSaldoAwal({
          ...bentuk.input,
          alasan,
          daftarAkun: listAkun(deps.db()),
        }).input;
        const konfirmasiPeringatan =
          typeof opsi === 'object' &&
          opsi !== null &&
          !Array.isArray(opsi) &&
          (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan ===
            true;

        const hasil = koreksiSaldoAwal(deps.db(), jurnalInput, {
          alasan,
          konfirmasiPeringatan,
          alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
          wajibAlasanPeringatan: true,
          sekarang: tanggalSekarang(),
        });
        if (!hasil.tersimpan || !hasil.jurnal) {
          const pesan =
            pesanValidasi(hasil.errors) ||
            pesanValidasi(hasil.peringatan) ||
            'Koreksi saldo awal gagal disimpan.';
          const perluAlasan = hasil.errors.some((m) =>
            m.includes('Periode sudah ditutup'),
          );
          const perluKonfirmasi =
            hasil.perluKonfirmasi &&
            (hasil.errors.length === 0 ||
              hasil.errors.every(
                (m) => m === PESAN_WAJIB_ALASAN_PERINGATAN,
              ));
          return fail(pesan, perluAlasan, perluKonfirmasi);
        }
        return ok({ jurnal: hasil.jurnal, reversal: hasil.reversal });
      } catch (e) {
        return fail(pesanError(e, PESAN_SIMPAN_GAGAL));
      }
    },
  );

  daftarkan(
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

  daftarkan(
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
        const bentukId = validasiIdJurnal(id);
        if (!bentukId.ok) return fail(bentukId.error);
        // AKT-22: jangan percaya objek mentah. Validator bentuk yang sama
        // dengan jurnal biasa menolak ID/keterangan/no bukti kepanjangan,
        // field wajib kosong, REVERSAL, dan baris yang tidak valid.
        const bentuk = validasiBentukKoreksiInput(input);
        if (!bentuk.ok) return fail(bentuk.error);
        const tanggalJurnal = validasiTanggalOpsional(bentuk.input.header.tanggal);
        if (!tanggalJurnal.ok || !tanggalJurnal.input)
          return fail(PESAN_TANGGAL_TIDAK_VALID);
        const tanggal = validasiTanggalOpsional(opsi?.tanggal);
        if (!tanggal.ok) return fail(tanggal.error);
        const hasil = koreksiDanIsiUlang(
          deps.db(),
          bentukId.input,
          String(alasan ?? ''),
          bentuk.input,
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

  // ---- Utang usaha sederhana (DB-23b) ----
  // Form Catat/Bayar Utang Usaha memakai `transaksi:posting` dengan jenis
  // HUTANG; tidak ada lagi IPC master pihak / pemetaan `jurnal_pihak`.

  daftarkan('panjar:list', (_e, status?: 'OPEN' | 'CLOSED' | 'DIBATALKAN') => {
    const k = perluBuka();
    if (k) return fail(k);
    const filter =
      status === 'OPEN' || status === 'CLOSED' || status === 'DIBATALKAN'
        ? status
        : undefined;
    return ok(listPanjarV2(deps.db(), filter));
  });

  daftarkan('panjar:items', (_e, id: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    if (typeof id !== 'string' || !id.trim())
      return fail('ID panjar wajib diisi.');
    return ok(listPanjarItemsV2(deps.db(), id.trim()));
  });

  daftarkan(
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
          alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
          // AKT-02: serah panjar ikut mewajibkan saldo awal pertama.
          wajibSaldoAwal: true,
          konfirmasiTanpaSaldoAwal: bacaKonfirmasiTanpaSaldoAwal(opsi),
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
            hasil.perluKonfirmasi &&
            (hasil.errors.length === 0 ||
              hasil.errors.every((m) =>
                m.includes('wajib disertai alasan minimal 5 karakter'),
              ));
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

  daftarkan(
    'panjar:batal',
    (_e, id: unknown, alasan: unknown, opsi?: unknown) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        if (typeof id !== 'string' || !id.trim())
          return fail('ID panjar yang akan dibatalkan wajib diisi.');
        const alasanTeks = typeof alasan === 'string' ? alasan.trim() : '';
        if (alasanTeks.length < 5)
          return fail('Alasan pembatalan panjar wajib diisi minimal 5 karakter.');
        const konfirmasi =
          typeof opsi === 'object' &&
          opsi !== null &&
          !Array.isArray(opsi) &&
          (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;

        const hasil = batalPanjarV2(deps.db(), {
          id: id.trim(),
          alasan: alasanTeks,
          ...(bacaTeksOpsi(opsi, 'tanggalBatal')
            ? { tanggalBatal: bacaTeksOpsi(opsi, 'tanggalBatal')! }
            : {}),
          konfirmasiPeringatan: konfirmasi,
        });
        if (!hasil.tersimpan || !hasil.panjar) {
          const pesan =
            pesanValidasi(hasil.errors) ||
            pesanValidasi(hasil.peringatan) ||
            'Pembatalan panjar gagal disimpan.';
          const perluAlasan = hasil.errors.some((m) =>
            m.includes('Periode sudah ditutup'),
          );
          const perluKonfirmasi =
            hasil.errors.length === 0 && hasil.perluKonfirmasi;
          return fail(pesan, perluAlasan, perluKonfirmasi);
        }
        return ok({ panjar: hasil.panjar, jurnal: hasil.jurnal });
      } catch (e) {
        return fail(pesanError(e, GAGAL_PANJAR));
      }
    },
  );

  daftarkan(
    'panjar:batal-close',
    (_e, input: unknown, opsi: unknown = {}) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        const bentuk = validasiBentukPembatalanPertanggungjawabanPanjar(input);
        if (!bentuk.ok) return fail(bentuk.error);
        const konfirmasi =
          typeof opsi === 'object' &&
          opsi !== null &&
          !Array.isArray(opsi) &&
          (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;

        const hasil = batalkanPertanggungjawabanPanjar(deps.db(), {
          ...bentuk.input,
          konfirmasiPeringatan: konfirmasi,
          alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
        });
        if (!hasil.tersimpan || !hasil.panjar || !hasil.jurnal) {
          const pesan =
            pesanValidasi(hasil.errors) ||
            pesanValidasi(hasil.peringatan) ||
            'Koreksi pertanggungjawaban panjar gagal disimpan.';
          const perluAlasan = hasil.errors.some((m) =>
            m.includes('Periode sudah ditutup'),
          );
          return fail(pesan, perluAlasan, hasil.perluKonfirmasi === true);
        }
        return ok({ panjar: hasil.panjar, jurnal: hasil.jurnal });
      } catch (e) {
        return fail(pesanError(e, GAGAL_PANJAR));
      }
    },
  );

  daftarkan(
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
          alasanKurang?: unknown;
          alasanPeringatan?: unknown;
        };

        const hasil = closePanjarV2(deps.db(), {
          id: bentuk.input.id,
          tanggalClose: bentuk.input.tanggalClose,
          items: bentuk.input.items,
          ...(alasanTeks ? { alasan: alasanTeks } : {}),
          konfirmasiKurang: opsi.konfirmasiKurang === true,
          konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
          // AKT-08: alasan overrun dan peringatan kas diteruskan ke adapter.
          alasanKurang: bacaTeksOpsi(req, 'alasanKurang'),
          alasanPeringatan: bacaTeksOpsi(req, 'alasanPeringatan'),
          // AKT-02: pertanggungjawaban panjar juga menerima flag sesi yang sama.
          wajibSaldoAwal: true,
          konfirmasiTanpaSaldoAwal: bacaKonfirmasiTanpaSaldoAwal(req),
        });
        if (!hasil.tersimpan || !hasil.panjar) {
          const pesan =
            pesanValidasi(hasil.errors) ||
            pesanValidasi(hasil.peringatan) ||
            'Pertanggungjawaban panjar gagal disimpan.';
          const perluAlasan = hasil.errors.some((m) =>
            m.includes('Periode sudah ditutup'),
          );
          // AKT-08: alasan overrun yang kurang tetap meminta konfirmasi ulang.
          const perluKonfirmasi =
            hasil.perluKonfirmasi &&
            (hasil.errors.length === 0 ||
              hasil.errors.every((m) =>
                m.includes('wajib disertai alasan minimal 5 karakter'),
              ));
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

  // ---- Pinjaman LPD (DB-16c) ----
  daftarkan('pinjaman:list', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(listPinjaman(deps.db()));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('pinjaman:detail', (_e, id: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      if (typeof id !== 'string' || !id.trim())
        return fail('ID pinjaman wajib diisi.');
      if (id.trim().length > 200) return fail('ID pinjaman terlalu panjang.');
      const pinjaman = getPinjaman(deps.db(), id.trim());
      if (!pinjaman) return fail('Pinjaman tidak ditemukan.');
      return ok(pinjaman);
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('pinjaman:simpan', (_e, input: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPinjamanSimpan(input);
      if (!bentuk.ok) return fail(bentuk.error);

      const konfirmasi =
        typeof opsi === 'object' &&
        opsi !== null &&
        !Array.isArray(opsi) &&
        (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;

      const hasil = simpanPinjamanLpd(deps.db(), bentuk.input, {
        konfirmasiPeringatan: konfirmasi,
        alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
        // Pinjaman pencairan adalah transaksi baru; ikuti pintu input lain
        // yang mewajibkan saldo awal, kecuali operator sudah mengonfirmasi.
        wajibSaldoAwal: true,
        konfirmasiTanpaSaldoAwal: bacaKonfirmasiTanpaSaldoAwal(opsi),
      });
      if (!hasil.tersimpan || !hasil.pinjaman) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Pinjaman gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) =>
          m.includes('Periode sudah ditutup'),
        );
        const perluKonfirmasi =
          hasil.perluKonfirmasi &&
          (hasil.errors.length === 0 ||
            hasil.errors.every((m) =>
              m.includes('wajib disertai alasan minimal 5 karakter'),
            ));
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }
      return ok({
        mode: hasil.mode,
        pinjaman: hasil.pinjaman,
        jurnal: hasil.jurnal ?? null,
      });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PINJAMAN));
    }
  });

  daftarkan('pinjaman:bayar', (_e, input: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPinjamanBayar(input);
      if (!bentuk.ok) return fail(bentuk.error);

      const konfirmasiSelisih =
        typeof opsi === 'object' &&
        opsi !== null &&
        !Array.isArray(opsi) &&
        (opsi as { konfirmasiSelisih?: unknown }).konfirmasiSelisih === true;
      const konfirmasiPeringatan =
        typeof opsi === 'object' &&
        opsi !== null &&
        !Array.isArray(opsi) &&
        (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true;

      const hasil = bayarAngsuranPinjaman(deps.db(), bentuk.input, {
        konfirmasiSelisih,
        alasanSelisih: bacaTeksOpsi(opsi, 'alasanSelisih'),
        konfirmasiPeringatan,
        alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
        wajibSaldoAwal: true,
        konfirmasiTanpaSaldoAwal: bacaKonfirmasiTanpaSaldoAwal(opsi),
      });
      if (!hasil.tersimpan || !hasil.pembayaran || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Pembayaran angsuran gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) =>
          m.includes('Periode sudah ditutup'),
        );
        return fail(pesan, perluAlasan, hasil.perluKonfirmasi === true);
      }
      return ok({
        pembayaran: hasil.pembayaran,
        jurnal: hasil.jurnal,
        rincian: hasil.rincian,
        selisih: hasil.selisih,
        pinjaman:
          getPinjaman(deps.db(), hasil.pembayaran.pinjaman_id) ?? null,
      });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PINJAMAN));
    }
  });

  daftarkan('pinjaman:pembayaran', (_e, id: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      if (typeof id !== 'string' || !id.trim())
        return fail('ID pinjaman wajib diisi.');
      if (id.trim().length > 200) return fail('ID pinjaman terlalu panjang.');
      if (!getPinjaman(deps.db(), id.trim())) return fail('Pinjaman tidak ditemukan.');
      return ok(listPinjamanBayar(deps.db(), id.trim()));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('pinjaman:bayar-batal', (_e, input: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPembatalanPinjaman(input);
      if (!bentuk.ok) return fail(bentuk.error);
      const hasil = batalkanPembayaranPinjaman(deps.db(), bentuk.input, {
        konfirmasiPeringatan:
          typeof opsi === 'object' && opsi !== null && !Array.isArray(opsi) &&
          (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true,
        alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
      });
      if (!hasil.tersimpan || !hasil.pembayaran || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Pembatalan catatan pembayaran gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) =>
          m.includes('Periode sudah ditutup'),
        );
        return fail(pesan, perluAlasan, hasil.perluKonfirmasi === true);
      }
      return ok({
        pembayaran: hasil.pembayaran,
        jurnal: hasil.jurnal,
        pinjaman: getPinjaman(deps.db(), hasil.pembayaran.pinjaman_id) ?? null,
      });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PINJAMAN));
    }
  });

  daftarkan('pinjaman:batal', (_e, input: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPembatalanPinjaman(input);
      if (!bentuk.ok) return fail(bentuk.error);
      const hasil = batalkanPinjaman(deps.db(), bentuk.input, {
        konfirmasiPeringatan:
          typeof opsi === 'object' && opsi !== null && !Array.isArray(opsi) &&
          (opsi as { konfirmasiPeringatan?: unknown }).konfirmasiPeringatan === true,
        alasanPeringatan: bacaTeksOpsi(opsi, 'alasanPeringatan'),
      });
      if (!hasil.tersimpan || !hasil.pinjaman || !hasil.jurnal) {
        const pesan =
          pesanValidasi(hasil.errors) ||
          pesanValidasi(hasil.peringatan) ||
          'Pembatalan catatan pencairan gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) =>
          m.includes('Periode sudah ditutup'),
        );
        return fail(pesan, perluAlasan, hasil.perluKonfirmasi === true);
      }
      return ok({ pinjaman: hasil.pinjaman, jurnal: hasil.jurnal });
    } catch (e) {
      return fail(pesanError(e, GAGAL_PINJAMAN));
    }
  });

  daftarkan('pinjaman:mutasi', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPinjamanMutasi(input);
      if (!bentuk.ok) return fail(bentuk.error);
      if (!getPinjaman(deps.db(), bentuk.input.pinjamanId))
        return fail('Pinjaman tidak ditemukan.');
      return ok(
        laporanMutasiPinjaman(deps.db(), bentuk.input.pinjamanId, {
          ...(bentuk.input.periode ? { periode: bentuk.input.periode } : {}),
          ...(bentuk.input.mulai ? { mulai: bentuk.input.mulai } : {}),
          ...(bentuk.input.sampai ? { sampai: bentuk.input.sampai } : {}),
          sekarang: tanggalSekarang(),
        }),
      );
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('pinjaman:rekonsiliasi', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPinjamanRekonsiliasi(input);
      if (!bentuk.ok) return fail(bentuk.error);

      if (bentuk.input.pinjamanId) {
        const hasil = rekonsiliasiPinjaman(deps.db(), bentuk.input.pinjamanId);
        if (!hasil) return fail('Pinjaman tidak ditemukan.');
        return ok(hasil);
      }

      // Tanpa ID: status seluruh pinjaman untuk tabel rekonsiliasi di UI.
      return ok(rekonsiliasiSemuaPinjaman(deps.db()));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });

  daftarkan('tutup:list', () => {
    const k = perluBuka();
    if (k) return fail(k);
    // Laba pada riwayat dihitung ulang dari jurnal, bukan angka tersimpan.
    const baris = listBarisJurnal(deps.db());
    const daftarAkun = listAkun(deps.db());
    const tanggalMulai = getPengaturanPembukuan(deps.db()).tanggalMulaiPembukuan;
    return ok(
      listTutupBuku(deps.db()).map((t) => {
        const tahun = Number(t.tahun);
        const catatanTahunPertama =
          catatanTahunPertamaParsial(tanggalMulai, tahun) ?? undefined;
        return {
          ...t,
          laba: labaTahunJurnal(baris, tahun, daftarAkun),
          ...(catatanTahunPertama ? { catatanTahunPertama } : {}),
        };
      }),
    );
  });
  // P0-9: riwayat audit lengkap + filter tervalidasi (aksi/tanggal/pagination).
  daftarkan('audit:list', (_e, f: AuditFilter = {}) => {
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
      // DB-27: referensi terstruktur; nilai kosong berarti tidak memfilter.
      const ref_type =
        typeof f?.ref_type === 'string' && f.ref_type.trim()
          ? f.ref_type.trim().slice(0, 40)
          : undefined;
      const ref_id =
        typeof f?.ref_id === 'string' && f.ref_id.trim()
          ? f.ref_id.trim().slice(0, 120)
          : undefined;
      const angka = (v: unknown, bawaan: number): number => {
        if (v === undefined || v === null || v === '') return bawaan;
        const n = Number(v);
        return Number.isFinite(n) ? n : bawaan;
      };
      const limit = Math.min(500, Math.max(1, Math.trunc(angka(f?.limit, 50))));
      const offset = Math.max(0, Math.trunc(angka(f?.offset, 0)));
      return ok(
        listAuditLogPage(deps.db(), {
          aksi,
          ref_type,
          ref_id,
          mulai,
          sampai,
          limit,
          offset,
        }),
      );
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });
  // DB-12: audit integritas read-only untuk layar/pesan. Handler ini hanya
  // membaca; tidak ada catatAudit, perbaikan, atau penulisan apa pun.
  daftarkan('audit:integritas', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(auditIntegritas(deps.db()));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });
  daftarkan('tutup:preview', (_e, tahun: number) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(previewTutupBuku(deps.db(), Number(tahun), tanggalSekarang()));
    } catch (e) {
      return fail(pesanError(e, GAGAL_MUAT));
    }
  });
  daftarkan(
    'tutup:create',
    (
      _e,
      req:
        | number
        | {
            tahun: number;
            catatan?: string;
            konfirmasiTimpak?: boolean;
          },
    ) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        // Bentuk angka lama tetap diterima; `backupPath` lama diabaikan
        // (DB-28: path backup tidak lagi disimpan/diekspos).
        const input =
          typeof req === 'number' ? { tahun: req } : (req ?? {});
        const hasil = tutupBuku(deps.db(), Number(input.tahun), {
          catatan: typeof input.catatan === 'string' ? input.catatan : '',
          konfirmasiTimpak: input.konfirmasiTimpak === true,
          // Tanggal acuan K2 dapat dipatok test; default tetap hari ini.
          sekarang: tanggalSekarang(),
        });
        if (!hasil.tersimpan)
          return fail(
            pesanValidasi(hasil.errors) ||
              pesanValidasi(hasil.peringatan) ||
              'Kunci periode gagal disimpan.',
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

  daftarkan('saldo:list', (_e, cutoff?: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const tanggal = validasiTanggalOpsional(cutoff);
    if (!tanggal.ok) return fail(tanggal.error);
    const perKas = saldoSemuaKasJurnal(
      listBarisJurnal(deps.db()),
      kodeKasDariDb(deps.db()),
      tanggal.input || undefined,
      listAkun(deps.db()),
    );
    return ok({ perKas, total: Object.values(perKas).reduce((s, v) => s + v, 0) });
  });

  daftarkan('dashboard:get', (_e, cutoff: unknown) => {
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
          daftarAkun: listAkun(deps.db()),
          tanggalMulaiPembukuan: pengaturan.tanggalMulaiPembukuan,
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
  daftarkan(
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
        pastikanTujuanBukanDbAktif(filePath);
        deps.writeFile(filePath, Buffer.from(req.bufferB64, 'base64'));
        return ok({ saved: true, path: filePath });
      } catch (e) {
        return fail(pesanError(e, GAGAL_FILE));
      }
    },
  );

  // Simpan PDF langsung: render HTML laporan di hidden window lalu printToPDF.
  // Renderer mengirim HTML paginator P1-16 (tanpa script, halaman eksplisit).
  daftarkan(
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
        pastikanTujuanBukanDbAktif(filePath);
        await deps.printPdf(html, filePath, req.landscape === true);
        return ok({ saved: true, path: filePath });
      } catch (e) {
        return fail(pesanError(e, GAGAL_FILE));
      }
    },
  );

  // Backup manual .db via save dialog (VACUUM INTO — aman saat WAL terbuka).
  daftarkan('backup:export', async () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const Stamp = tanggalSekarang();
      const { canceled, filePath } = await deps.dialog.showSaveDialog({
        defaultPath: `pura-backup-${Stamp}.db`,
        filters: [{ name: 'SQLite DB', extensions: ['db'] }],
      });
      if (canceled || !filePath) return ok({ saved: false, path: '' });
      pastikanTujuanBukanDbAktif(filePath);
      backupVacuumInto(deps.db(), filePath);
      catatAudit(deps.db(), {
        aksi: 'BACKUP-EXPORT',
        alasan: `Backup manual ke ${basename(filePath)}`,
        baru: { path: filePath, jenis: 'manual' },
      });
      deps.log?.info(`Backup manual dibuat: ${basename(filePath)}`);
      return ok({ saved: true, path: filePath });
    } catch (e) {
      deps.log?.error('Backup manual gagal', e);
      return fail(pesanError(e, GAGAL_BACKUP));
    }
  });

  // Backup lengkap: satu folder berisi DB (VACUUM INTO) + manifest.
  // Folder induk dipilih user; subfolder memakai waktu lokal WITA.
  daftarkan('backup:lengkap', async () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const { canceled, filePaths } = await deps.dialog.showOpenDialog({
        properties: ['openDirectory', 'createDirectory'],
        title: 'Pilih folder induk untuk backup lengkap',
      });
      if (canceled || !filePaths?.[0]) return ok({ saved: false, path: '' });

      const stamp = stampBackupLokal(sekarang());
      let destDir = join(filePaths[0], `pura-backup-${stamp}`);
      // Nama folder tetap `pura-backup-YYYY-MM-DD-HHmm`; hanya bila folder itu
      // sudah berisi (backup lain pada menit yang sama) tambahkan urutan.
      for (let n = 2; existsSync(destDir) && readdirSync(destDir).length > 0; n += 1) {
        destDir = join(filePaths[0], `pura-backup-${stamp}-${n}`);
      }

      const hasil = buatBackupLengkap({
        db: deps.db(),
        dbPath: deps.dbPath(),
        destDir,
      });
      catatAudit(deps.db(), {
        aksi: 'BACKUP-LENGKAP',
        alasan: `Backup lengkap ke ${basename(hasil.destDir)}`,
        baru: {
          path: hasil.destDir,
          ukuranDb: hasil.manifest.ukuranDb,
        },
      });
      deps.log?.info(`Backup lengkap dibuat: ${basename(hasil.destDir)}`);
      return ok({
        saved: true,
        path: hasil.destDir,
      });
    } catch (e) {
      deps.log?.error('Backup lengkap gagal', e);
      return fail(pesanError(e, GAGAL_BACKUP));
    }
  });

  // Auto-backup internal untuk wizard Tutup Buku (tanpa dialog).
  daftarkan('backup:auto', (_e, tahun: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      // AUD-17: tahun dari renderer tidak boleh masuk path mentah. Normalisasi
      // ke integer 1900..9999 agar `../../x`/NaN/desimal tidak bisa keluar
      // folder backup.
      const n = Number(tahun);
      if (!Number.isInteger(n) || n < 1900 || n > 9999)
        return fail('Tahun backup tidak valid.');
      const dir = deps.lokasiData().backupsDir;
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, `pura-${n}.db`);
      backupVacuumInto(deps.db(), dest);
      catatAudit(deps.db(), {
        aksi: 'BACKUP-AUTO',
        alasan: `Backup otomatis sebelum kunci periode ${n}`,
        baru: { path: dest, jenis: 'tutup-buku', tahun: n },
      });
      deps.log?.info(`Backup otomatis tutup buku ${n} dibuat: ${basename(dest)}`);
      return ok({ path: dest });
    } catch (e) {
      deps.log?.error('Backup otomatis gagal', e);
      return fail(pesanError(e, GAGAL_BACKUP));
    }
  });

  // Status backup otomatis harian terakhir (untuk Dashboard).
  daftarkan('backup:status', () => {
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
  // DB-09: jalur ini sengaja dipertahankan sebagai alternatif lanjutan. Ia
  // hanya memulihkan database dan tidak memvalidasi `manifest.json` seperti
  // Restore Lengkap, jadi renderer wajib mengirim konfirmasi eksplisit.
  daftarkan('backup:import', async (_e, opsi: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      if (!bacaKonfirmasiRestoreDb(opsi)) {
        return fail(
          'Restore .db adalah jalur lanjutan dan berisiko: hanya memulihkan database, tanpa validasi manifest.json. Gunakan Restore Lengkap bila tersedia. Konfirmasi peringatan terlebih dahulu.',
          false,
          true,
        );
      }
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
      if (!hasil.ok) {
        deps.log?.warn(`Restore dibatalkan: ${hasil.error}`);
        return fail(hasil.error);
      }
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
        deps.log?.warn('[restore] gagal menulis audit', e);
      }
      // AUD-14: sesi lama tidak boleh tetap terbuka setelah data berganti.
      kunciLagi();
      deps.log?.info(
        `Restore berhasil dari ${basename(src)}; cadangan pra-restore: ${basename(hasil.preRestorePath)}`,
      );
      return ok({ restored: true, path: deps.dbPath(), preRestorePath: hasil.preRestorePath });
    } catch (e) {
      deps.log?.error('Restore gagal', e);
      return fail(pesanError(e, GAGAL_RESTORE));
    }
  });

  // AUD-12 / DB-37: restore satu folder backup lengkap (DB + manifest).
  // Folder `attachments` dari backup lama diabaikan; hanya database yang
  // dipulihkan. restoreLengkap mengembalikan DB lama bila penukaran gagal.
  daftarkan('backup:restore-lengkap', async () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const { canceled, filePaths } = await deps.dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: 'Pilih folder backup lengkap (berisi manifest.json)',
      });
      if (canceled || !filePaths?.[0]) return ok({ restored: false, path: '' });

      const sumber = filePaths[0]!;
      const hasil = restoreLengkap({
        db: deps.db(),
        dbPath: deps.dbPath(),
        backupDir: sumber,
        dirBackup: deps.lokasiData().backupsDir,
        stamp: stampBackupLokal(sekarang()),
      });
      deps.setDb(hasil.db);
      if (!hasil.ok) {
        deps.log?.warn(`Restore lengkap dibatalkan: ${hasil.error}`);
        return fail(hasil.error);
      }

      try {
        catatAudit(deps.db(), {
          aksi: 'RESTORE-LENGKAP',
          alasan: `Restore lengkap dari ${basename(sumber)}`,
          baru: {
            sumber,
            pre_restore_db: hasil.preRestorePath,
          },
        });
      } catch (e) {
        deps.log?.warn('[restore-lengkap] gagal menulis audit', e);
      }
      // AUD-14: sesi lama tidak boleh tetap terbuka setelah data berganti.
      kunciLagi();
      deps.log?.info(
        `Restore lengkap berhasil dari ${basename(sumber)}; cadangan pra-restore: ${basename(hasil.preRestorePath)}`,
      );
      return ok({
        restored: true,
        path: deps.dbPath(),
        preRestorePath: hasil.preRestorePath,
      });
    } catch (e) {
      deps.log?.error('Restore lengkap gagal', e);
      return fail(pesanError(e, GAGAL_RESTORE));
    }
  });
}
