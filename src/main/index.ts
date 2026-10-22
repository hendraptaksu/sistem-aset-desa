import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { config as loadEnv } from 'dotenv';
import { join, dirname, basename } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import type Database from 'better-sqlite3';
import { openDb } from '../db/database.js';
import { seedDev } from '../db/seed-dev.js';
import {
  catatAudit,
  deleteAset,
  getAset,
  guardPeriodeTerkunci,
  insertAset,
  insertTransaksi,
  listAset,
  listAuditLogPage,
  listJurnalLengkap,
  listTransaksi,
  listTutupBuku,
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
import { KAS_KODES, COA } from '../db/coa.js';
import {
  labaTahun as labaTahunJurnal,
  neraca as neracaJurnal,
  saldoAkun,
  saldoSemuaKas as saldoSemuaKasJurnal,
} from '../core/reports.js';
import { listBarisJurnal } from '../db/laporan.js';
import { buildDashboardJurnal } from '../features/dashboard/dashboard.js';
import {
  autoBackupHarian,
  backupPraUpgrade,
  backupVacuumInto,
  lastAutoBackup,
  restoreDbAman,
} from '../features/export/export.js';
import type { Aset, Transaksi } from '../core/types.js';
import { tanggalKalenderValid, type JurnalInput } from '../core/posting.js';
import { buatJurnalSaldoAwal } from '../core/forms.js';
import {
  validasiBentukJurnalInput,
  validasiBentukPanjarClose,
  validasiBentukPanjarSerah,
  validasiBentukPihak,
  validasiBentukPostingPihak,
  validasiBentukSaldoAwal,
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

let db: Database.Database;
let win: BrowserWindow | null = null;

// Dev saja: baca .env di root repo agar PURA_DB bisa di-override.
// App production (isPackaged) selalu pakai userData/data/pura.db.
if (!app.isPackaged) loadEnv();

function dbPath(): string {
  if (process.env.PURA_DB) return process.env.PURA_DB;
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'pura.db');
}

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (error: string, perluAlasan = false, perluKonfirmasi = false) => ({
  ok: false as const,
  error,
  perluAlasan,
  perluKonfirmasi,
});
const uid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function registerIpc(): void {
  ipcMain.handle('coa:list', () => ok(COA));

  // Kunci aplikasi: sesi selalu terkunci saat app dibuka (sesi.terbuka=false awal).
  ipcMain.handle('lock:status', () => ok(statusKunci(db)));
  ipcMain.handle('lock:setup', (_e, pin: string) => {
    const err = setupPin(db, String(pin ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });
  ipcMain.handle('lock:unlock', (_e, pin: string) => {
    const err = bukaKunci(db, String(pin ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });
  ipcMain.handle('lock:lock', () => {
    kunciLagi();
    return ok({ terkunci: true });
  });
  ipcMain.handle('lock:change', (_e, lama: string, baru: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const err = ubahPin(db, String(lama ?? ''), String(baru ?? ''));
    return err ? fail(err) : ok({ diubah: true });
  });
  ipcMain.handle('lock:idle-set', (_e, menit: number) => {
    const k = perluBuka();
    if (k) return fail(k);
    const err = aturIdle(db, Number(menit));
    return err ? fail(err) : ok({ idleMenit: Number(menit) });
  });
  ipcMain.handle('lock:reset', (_e, kode: string, pinBaru: string) => {
    const err = resetPaksa(db, String(kode ?? ''), String(pinBaru ?? ''));
    return err ? fail(err) : ok({ terbuka: true });
  });

  // Gembok data: selain channel lock:* & coa:list, tolak bila PIN sudah di-setup
  // tapi sesi belum dibuka. Mencegah bypass via devtools (ancaman anak/iseng).
  // lock:change & lock:idle-set justru WAJIB terbuka → ikut dijaga di bawah.
  const perluBuka = (): string | null =>
    sudahSetupPin(db) && !sesi.terbuka ? 'Aplikasi terkunci. Buka dengan PIN dulu.' : null;

  // ---- Jurnal Umum & koreksi (P0-6) ----
  ipcMain.handle('jurnal:list', (_e, f: JurnalFilter = {}) => {
    const k = perluBuka();
    if (k) return fail(k);
    const filter: JurnalFilter = {
      mulai: typeof f?.mulai === 'string' && f.mulai ? f.mulai : undefined,
      sampai: typeof f?.sampai === 'string' && f.sampai ? f.sampai : undefined,
      jenis: typeof f?.jenis === 'string' && f.jenis ? f.jenis : undefined,
      akun_kode: typeof f?.akun_kode === 'string' && f.akun_kode ? f.akun_kode : undefined,
      limit: Number.isFinite(f?.limit) ? Number(f.limit) : undefined,
      offset: Number.isFinite(f?.offset) ? Number(f.offset) : undefined,
    };
    return ok(listJurnalLengkap(db, filter));
  });

  // ---- Simpan jurnal dari form terpandu (P1-1) ----
  // Satu-satunya jalur simpan jurnal baru di luar koreksi. Semua aturan bisnis
  // tetap di posting layer; handler hanya memeriksa bentuk input dari renderer.
  ipcMain.handle('jurnal:posting', (_e, input: unknown, opsi: unknown = {}) => {
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

      const hasil = postingJurnal(db, bentuk.input, { konfirmasiPeringatan });
      if (!hasil.tersimpan || !hasil.jurnal) {
        const pesan =
          hasil.errors.join(' ') ||
          hasil.peringatan.join(' ') ||
          'Jurnal gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) => m.includes('Periode sudah ditutup'));
        // Konfirmasi hanya untuk peringatan murni (mis. kas minus), bukan saat
        // masih ada error yang harus diperbaiki.
        const perluKonfirmasi = hasil.errors.length === 0 && hasil.perluKonfirmasi;
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }
      return ok({ jurnal: hasil.jurnal });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // ---- Wizard Saldo Awal (P1-6) ----
  // Hanya sekali, saat tabel jurnal masih kosong. Renderer mengirim form mentah
  // (tanggal + saldo per akun); main menyusun jurnal lewat builder murni yang
  // sama dengan pratinjau UI, lalu adapter DB memeriksa "masih kosong" secara
  // atomik sebelum menulis jurnal + audit SALDO-AWAL.
  ipcMain.handle('saldo-awal:status', () => {
    const k = perluBuka();
    return k ? fail(k) : ok(statusSaldoAwal(db));
  });

  ipcMain.handle('saldo-awal:posting', (_e, input: unknown, opsi: unknown = {}) => {
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

      const hasil = simpanSaldoAwal(db, jurnalInput, { konfirmasiPeringatan });
      if (!hasil.tersimpan || !hasil.jurnal) {
        const pesan =
          hasil.errors.join(' ') ||
          hasil.peringatan.join(' ') ||
          'Saldo awal gagal disimpan.';
        const perluAlasan = hasil.errors.some((m) => m.includes('Periode sudah ditutup'));
        const perluKonfirmasi = hasil.errors.length === 0 && hasil.perluKonfirmasi;
        return fail(pesan, perluAlasan, perluKonfirmasi);
      }
      return ok({ jurnal: hasil.jurnal });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle(
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
        const hasil = reverseJurnal(db, String(id ?? ''), String(alasan ?? ''), {
          id: typeof opsi?.id === 'string' ? opsi.id : undefined,
          tanggal: typeof opsi?.tanggal === 'string' ? opsi.tanggal : undefined,
          no_bukti: typeof opsi?.no_bukti === 'string' ? opsi.no_bukti : undefined,
          konfirmasiPeringatan: opsi?.konfirmasiPeringatan === true,
        });
        if (!hasil.tersimpan)
          return fail(
            hasil.errors.join(' ') || hasil.peringatan.join(' ') || 'Koreksi gagal disimpan.',
            false,
            hasil.perluKonfirmasi,
          );
        return ok({ jurnal: hasil.reversal });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  ipcMain.handle(
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
        const hasil = koreksiDanIsiUlang(
          db,
          String(id ?? ''),
          String(alasan ?? ''),
          input,
          {
            id: typeof opsi?.id === 'string' ? opsi.id : undefined,
            tanggal: typeof opsi?.tanggal === 'string' ? opsi.tanggal : undefined,
            no_bukti: typeof opsi?.no_bukti === 'string' ? opsi.no_bukti : undefined,
            konfirmasiPeringatan: opsi?.konfirmasiPeringatan === true,
          },
        );
        if (!hasil.tersimpan)
          return fail(
            hasil.errors.join(' ') || hasil.peringatan.join(' ') || 'Koreksi gagal disimpan.',
            false,
            hasil.perluKonfirmasi,
          );
        return ok({ reversal: hasil.reversal, jurnalBaru: hasil.jurnalBaru });
      } catch (e) {
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // ---- Piutang & Hutang + master pihak (P1-5) ----
  // Renderer tidak dipercaya: bentuk input dinormalisasi dulu, lalu adapter DB
  // memvalidasi lima alur baku + menyimpan jurnal/pemetaan pihak/audit atomik.
  ipcMain.handle('pihak:list', () => {
    const k = perluBuka();
    return k ? fail(k) : ok(listPihak(db));
  });

  ipcMain.handle('pihak:saldo', () => {
    const k = perluBuka();
    return k ? fail(k) : ok(saldoPerPihak(db));
  });

  ipcMain.handle('pihak:jurnal', (_e, id: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const pihakId = String(id ?? '').trim();
    if (!pihakId) return fail('Pihak wajib dipilih.');
    return ok(daftarJurnalPihak(db, pihakId));
  });

  ipcMain.handle('pihak:create', (_e, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const bentuk = validasiBentukPihak(input);
      if (!bentuk.ok) return fail(bentuk.error);
      const pihak = createPihak(db, bentuk.input);
      return ok({ id: pihak.id, pihak });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('pihak:update', (_e, id: string, input: unknown) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const pihakId = String(id ?? '').trim();
      if (!pihakId) return fail('Pihak yang akan diubah belum dipilih.');
      const bentuk = validasiBentukPihak(input);
      if (!bentuk.ok) return fail(bentuk.error);
      const pihak = updatePihak(db, pihakId, bentuk.input);
      return ok({ id: pihak.id, pihak });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('pihak:delete', (_e, id: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const pihakId = String(id ?? '').trim();
      if (!pihakId) return fail('Pihak yang akan dihapus belum dipilih.');
      deletePihak(db, pihakId);
      return ok({ id: pihakId });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('pihak:posting', (_e, req: unknown, opsi: unknown = {}) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);

      const bentuk = validasiBentukPostingPihak(req);
      if (!bentuk.ok) return fail(bentuk.error);

      const opts = typeof opsi === 'object' && opsi !== null ? opsi : {};
      const hasil = postingPihak(db, {
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
          hasil.errors.join(' ') ||
          hasil.peringatan.join(' ') ||
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
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  ipcMain.handle('transaksi:list', (_e, f: { mulai?: string; sampai?: string } = {}) => {
    const k = perluBuka();
    return k ? fail(k) : ok(listTransaksi(db, f));
  });

  ipcMain.handle('transaksi:create', (_e, input: TransaksiInput, alasan?: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const errs = validateTransaksiInput(input);
      if (errs.length) return fail(errs.join(' '));
      const lockedErr = guardPeriodeTerkunci(db, input.tanggal, alasan);
      if (lockedErr) return fail(lockedErr, true);
      const row: Transaksi = { id: uid('t'), ...input };
      const simpan = db.transaction(() => {
        insertTransaksi(db, row);
        if (alasan)
          catatAudit(db, { aksi: `CREATE ${row.id}`, alasan, baru: row });
      });
      simpan();
      return ok({ id: row.id });
    } catch (e) {
      return fail(String(e));
    }
  });

  ipcMain.handle('panjar:list', (_e, status?: 'OPEN' | 'CLOSED') => {
    const k = perluBuka();
    if (k) return fail(k);
    const filter = status === 'OPEN' || status === 'CLOSED' ? status : undefined;
    return ok(listPanjarV2(db, filter));
  });

  ipcMain.handle('panjar:items', (_e, id: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    if (typeof id !== 'string' || !id.trim())
      return fail('ID panjar wajib diisi.');
    return ok(listPanjarItemsV2(db, id.trim()));
  });

  ipcMain.handle(
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

        const hasil = serahkanPanjar(db, {
          ...bentuk.input,
          ...(alasanTeks ? { alasan: alasanTeks } : {}),
          konfirmasiPeringatan: konfirmasi,
        });
        if (!hasil.tersimpan || !hasil.panjar) {
          const pesan =
            hasil.errors.join(' ') ||
            hasil.peringatan.join(' ') ||
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
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  ipcMain.handle(
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

        const hasil = closePanjarV2(db, {
          id: bentuk.input.id,
          tanggalClose: bentuk.input.tanggalClose,
          items: bentuk.input.items,
          ...(alasanTeks ? { alasan: alasanTeks } : {}),
          konfirmasiKurang: opsi.konfirmasiKurang === true,
          konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        });
        if (!hasil.tersimpan || !hasil.panjar) {
          const pesan =
            hasil.errors.join(' ') ||
            hasil.peringatan.join(' ') ||
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
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  // ---- Inventaris Aset (non-keuangan, TIDAK kena kunci tutup buku) ----
  ipcMain.handle('aset:list', (_e, f: { jenis?: string; cari?: string } = {}) => {
    const k = perluBuka();
    return k ? fail(k) : ok(listAset(db, f));
  });

  ipcMain.handle('aset:create', (_e, input: AsetInput) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const errs = validateAsetInput(input);
      if (errs.length) return fail(errs.join(' '));
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
      insertAset(db, row);
      return ok({ id: row.id });
    } catch (e) {
      if (String(e).includes('UNIQUE constraint failed: aset.kode')) return fail('Kode aset sudah dipakai.');
      return fail(String(e));
    }
  });

  ipcMain.handle('aset:update', (_e, id: string, input: AsetInput) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const errs = validateAsetInput(input);
      if (errs.length) return fail(errs.join(' '));
      const lama = getAset(db, String(id));
      if (!lama) return fail('Aset tidak ditemukan.');
      updateAset(db, {
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
      return fail(String(e));
    }
  });

  ipcMain.handle('aset:delete', (_e, id: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      deleteAset(db, String(id));
      return ok({ id });
    } catch (e) {
      return fail(String(e));
    }
  });

  ipcMain.handle('tutup:list', () => {
    const k = perluBuka();
    if (k) return fail(k);
    // Laba pada riwayat dihitung ulang dari jurnal, bukan angka tersimpan.
    const baris = listBarisJurnal(db);
    return ok(
      listTutupBuku(db).map((t) => ({
        ...t,
        laba: labaTahunJurnal(baris, Number(t.tahun)),
      })),
    );
  });
  // P0-9: riwayat audit lengkap + filter tervalidasi (aksi/tanggal/pagination).
  ipcMain.handle('audit:list', (_e, f: AuditFilter = {}) => {
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
        return fail('Tanggal mulai tidak valid (YYYY-MM-DD).');
      if (sampai && !tanggalKalenderValid(sampai))
        return fail('Tanggal sampai tidak valid (YYYY-MM-DD).');
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
      return ok(listAuditLogPage(db, { aksi, mulai, sampai, limit, offset }));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
  ipcMain.handle('tutup:preview', (_e, tahun: number) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      return ok(previewTutupBuku(db, Number(tahun)));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
  ipcMain.handle(
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
        const hasil = tutupBuku(db, Number(input.tahun), {
          catatan: typeof input.catatan === 'string' ? input.catatan : '',
          backupPath: typeof input.backupPath === 'string' ? input.backupPath : '',
          konfirmasiTimpak: input.konfirmasiTimpak === true,
        });
        if (!hasil.tersimpan)
          return fail(
            hasil.errors.join(' ') ||
              hasil.peringatan.join(' ') ||
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
        return fail(e instanceof Error ? e.message : String(e));
      }
    },
  );

  ipcMain.handle('saldo:list', (_e, cutoff?: string) => {
    const k = perluBuka();
    if (k) return fail(k);
    const perKas = saldoSemuaKasJurnal(listBarisJurnal(db), KAS_KODES, cutoff);
    return ok({ perKas, total: Object.values(perKas).reduce((s, v) => s + v, 0) });
  });

  ipcMain.handle('neraca:get', (_e, cutoff: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return fail('Cut-off tidak valid (YYYY-MM-DD).');
      const baris = listBarisJurnal(db);
      const n = neracaJurnal(baris, {
        cutoff,
        tutup: listTutupBuku(db),
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
      return fail(String(e));
    }
  });

  ipcMain.handle('dashboard:get', (_e, cutoff: string) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff)) return fail('Cut-off tidak valid (YYYY-MM-DD).');
      const d = buildDashboardJurnal(listBarisJurnal(db), listTutupBuku(db), cutoff);
      return ok(d);
    } catch (e) {
      return fail(String(e));
    }
  });

  // Simpan buffer (xlsx/html) via save dialog. Renderer bangun buffer murni,
  // main hanya tulis file — sesuai handoff: builder tetap di renderer.
  ipcMain.handle(
    'file:save-buffer',
    async (_e, req: { bufferB64: string; defaultName: string; filters?: { name: string; extensions: string[] }[] }) => {
      try {
        const k = perluBuka();
        if (k) return fail(k);
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: req.defaultName,
          filters: req.filters,
        });
        if (canceled || !filePath) return ok({ saved: false, path: '' });
        writeFileSync(filePath, Buffer.from(req.bufferB64, 'base64'));
        return ok({ saved: true, path: filePath });
      } catch (e) {
        return fail(String(e));
      }
    },
  );

  // Simpan PDF langsung: render HTML laporan di hidden window lalu printToPDF.
  // Renderer membangun HTML via wrapPrintDocument(..., { autoPrint: false }).
  ipcMain.handle(
    'file:save-pdf',
    async (_e, req: { htmlB64: string; defaultName: string }) => {
      let pdfWin: BrowserWindow | null = null;
      try {
        const k = perluBuka();
        if (k) return fail(k);
        const html = Buffer.from(req.htmlB64, 'base64').toString('utf-8');
        if (!html.trim()) return fail('HTML laporan kosong.');
        const name = req.defaultName.endsWith('.pdf') ? req.defaultName : `${req.defaultName}.pdf`;
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: name,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        if (canceled || !filePath) return ok({ saved: false, path: '' });
        pdfWin = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
        await pdfWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        const pdf = await pdfWin.webContents.printToPDF({
          pageSize: 'A4',
          printBackground: true,
          margins: { top: 0.55, bottom: 0.55, left: 0.47, right: 0.47 },
        });
        writeFileSync(filePath, pdf);
        return ok({ saved: true, path: filePath });
      } catch (e) {
        return fail(String(e));
      } finally {
        pdfWin?.close();
      }
    },
  );

  // Backup manual .db via save dialog (VACUUM INTO — aman saat WAL terbuka).
  ipcMain.handle('backup:export', async () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const Stamp = new Date().toISOString().slice(0, 10);
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `pura-backup-${Stamp}.db`,
        filters: [{ name: 'SQLite DB', extensions: ['db'] }],
      });
      if (canceled || !filePath) return ok({ saved: false, path: '' });
      backupVacuumInto(db, filePath);
      catatAudit(db, {
        aksi: 'BACKUP-EXPORT',
        alasan: `Backup manual ke ${basename(filePath)}`,
        baru: { path: filePath, jenis: 'manual' },
      });
      return ok({ saved: true, path: filePath });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // Auto-backup internal untuk wizard Tutup Buku (tanpa dialog).
  ipcMain.handle('backup:auto', (_e, tahun: number) => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const dir = join(dirname(dbPath()), 'backups');
      mkdirSync(dir, { recursive: true });
      const dest = join(dir, `pura-${tahun}.db`);
      backupVacuumInto(db, dest);
      catatAudit(db, {
        aksi: 'BACKUP-AUTO',
        alasan: `Backup otomatis sebelum tutup buku ${tahun}`,
        baru: { path: dest, jenis: 'tutup-buku', tahun: Number(tahun) },
      });
      return ok({ path: dest });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });

  // Status backup otomatis harian terakhir (untuk Dashboard).
  ipcMain.handle('backup:status', () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const dir = join(dirname(dbPath()), 'backups');
      return ok({ path: lastAutoBackup(dir) });
    } catch (e) {
      return fail(String(e));
    }
  });

  // Restore .db via open dialog: validasi kandidat → cadangkan DB aktif →
  // tukar file atomik → buka ulang → audit. Kegagalan tidak merusak DB lama.
  ipcMain.handle('backup:import', async () => {
    try {
      const k = perluBuka();
      if (k) return fail(k);
      const { canceled, filePaths } = await dialog.showOpenDialog({
        filters: [{ name: 'SQLite DB', extensions: ['db'] }],
        properties: ['openFile'],
      });
      if (canceled || filePaths.length === 0) return ok({ restored: false, path: '' });
      const src = filePaths[0]!;
      const hasil = restoreDbAman(db, { dbPath: dbPath(), backupPath: src });
      db = hasil.db;
      if (!hasil.ok) return fail(hasil.error);
      try {
        catatAudit(db, {
          aksi: 'RESTORE',
          alasan: `Restore dari ${basename(src)}`,
          baru: {
            sumber: src,
            cadangan_sebelum_restore: hasil.preRestorePath,
            db_aktif: dbPath(),
          },
        });
      } catch (e) {
        console.warn('[restore] gagal menulis audit:', String(e));
      }
      return ok({ restored: true, path: dbPath(), preRestorePath: hasil.preRestorePath });
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  });
}

/**
 * Lokasi file preload berbeda antara dev dan hasil build.
 * electron-vite mengeluarkan `out/preload/index.mjs`, sedangkan Electron
 * butuh CJS (`index.js`/`.cjs`) — lihat `lib.formats` di electron.vite.config.ts.
 * Cari kandidat pertama yang ada agar window.api selalu termuat.
 */
function preloadPath(): string {
  const candidates = [
    join(__dirname, '../preload/index.cjs'),
    join(__dirname, '../preload/index.js'),
    join(__dirname, '../preload/index.mjs'),
    join(process.cwd(), 'out/preload/index.cjs'),
    join(process.cwd(), 'out/preload/index.js'),
    join(process.cwd(), 'out/preload/index.mjs'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Keuangan Pura Dalem Puri',
    webPreferences: { preload: preloadPath() },
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  win.on('closed', () => (win = null));
}

void app.whenReady().then(() => {
  const pathDb = dbPath();
  // Sebelum migrasi/reset skema: simpan DB lama (best-effort) agar tidak hilang.
  try {
    const p = backupPraUpgrade(pathDb);
    if (p) console.log(`[backup-upgrade] ${p}`);
  } catch (e) {
    console.warn('[backup-upgrade] gagal:', String(e));
  }
  db = openDb(pathDb);
  // Auto-backup harian 1x sehari (best-effort, jangan blokir app bila gagal).
  try {
    const p = autoBackupHarian(db, join(dirname(dbPath()), 'backups'), 7);
    console.log(`[backup-auto] ${p}`);
  } catch (e) {
    console.warn('[backup-auto] gagal:', String(e));
  }
  // Dev seeder: isi data dummy bervolume untuk uji laporan multi-halaman.
  // Hanya dev (!isPackaged) + flag .env; seedDev() hanya jalan bila DB kosong.
  if (!app.isPackaged && process.env.PURA_SEED_DEV === 'true') {
    const n = seedDev(db);
    if (n > 0) console.log(`[seed-dev] ${n} baris transaksi dummy dimasukkan.`);
  }
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
