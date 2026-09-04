import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import type Database from 'better-sqlite3';
import { openDb } from '../db/database.js';
import {
  closePanjar,
  guardPeriodeTerkunci,
  insertAuditLog,
  insertPanjar,
  insertTransaksi,
  insertTutupBuku,
  listPanjar,
  listPanjarItems,
  listTransaksi,
  listTutupBuku,
} from '../db/repository.js';
import { KAS_KODES, COA } from '../db/coa.js';
import {
  buatAuditLog,
  labaTahun,
  panjarCloseToTransaksi,
  panjarOpenToTransaksi,
  saldoSemuaKas,
} from '../core/ledger.js';
import type { Panjar, Transaksi } from '../core/types.js';
import { validatePanjarItems, validateTransaksiInput, type TransaksiInput } from './validation.js';

let db: Database.Database;
let win: BrowserWindow | null = null;

function dbPath(): string {
  if (process.env.PURA_DB) return process.env.PURA_DB;
  const dir = join(app.getPath('userData'), 'data');
  mkdirSync(dir, { recursive: true });
  return join(dir, 'pura.db');
}

const ok = <T>(data: T) => ({ ok: true as const, data });
const fail = (error: string, perluAlasan = false) => ({ ok: false as const, error, perluAlasan });
const uid = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

function registerIpc(): void {
  ipcMain.handle('coa:list', () => ok(COA));

  ipcMain.handle('transaksi:list', (_e, f: { mulai?: string; sampai?: string } = {}) =>
    ok(listTransaksi(db, f)),
  );

  ipcMain.handle('transaksi:create', (_e, input: TransaksiInput, alasan?: string) => {
    try {
      const errs = validateTransaksiInput(input);
      if (errs.length) return fail(errs.join(' '));
      const lockedErr = guardPeriodeTerkunci(db, input.tanggal, alasan);
      if (lockedErr) return fail(lockedErr, true);
      const row: Transaksi = { id: uid('t'), ...input };
      insertTransaksi(db, row);
      if (alasan) insertAuditLog(db, buatAuditLog(`CREATE ${row.id}`, alasan, row));
      return ok({ id: row.id });
    } catch (e) {
      return fail(String(e));
    }
  });

  ipcMain.handle('panjar:list', (_e, status?: 'OPEN' | 'CLOSED') => ok(listPanjar(db, status)));

  ipcMain.handle('panjar:items', (_e, id: string) => ok(listPanjarItems(db, id)));

  ipcMain.handle(
    'panjar:create',
    (
      _e,
      input: { tanggal: string; penerima: string; jumlah: number; akun_kas_sumber: string },
      alasan?: string,
    ) => {
      try {
        if (!input.penerima.trim()) return fail('Nama penerima wajib diisi.');
        if (!Number.isInteger(input.jumlah) || input.jumlah <= 0)
          return fail('Jumlah panjar harus > 0.');
        const lockedErr = guardPeriodeTerkunci(db, input.tanggal, alasan);
        if (lockedErr) return fail(lockedErr, true);
        const p: Panjar = { id: uid('p'), status: 'OPEN', ...input };
        insertPanjar(db, p);
        insertTransaksi(db, panjarOpenToTransaksi(p));
        if (alasan) insertAuditLog(db, buatAuditLog(`PANJAR-OPEN ${p.id}`, alasan, p));
        return ok({ id: p.id });
      } catch (e) {
        return fail(String(e));
      }
    },
  );

  ipcMain.handle(
    'panjar:close',
    (
      _e,
      req: {
        id: string;
        tanggalClose: string;
        items: { kategori_baga: string; nominal: number }[];
      },
      alasan?: string,
    ) => {
      try {
        const errs = validatePanjarItems(req.items);
        if (errs.length) return fail(errs.join(' '));
        const lockedErr = guardPeriodeTerkunci(db, req.tanggalClose, alasan);
        if (lockedErr) return fail(lockedErr, true);
        const p = listPanjar(db).find((x) => x.id === req.id);
        if (!p) return fail('Panjar tidak ditemukan.');
        if (p.status === 'CLOSED') return fail('Panjar sudah closed.');
        const close = panjarCloseToTransaksi(
          p,
          req.items.map((it) => ({ panjar_id: p.id, ...it })),
          req.tanggalClose,
        );
        const rows = [...close.bebanRows, close.kompensasiRow, ...(close.sisaRow ? [close.sisaRow] : [])];
        closePanjar(db, p.id, rows);
        if (alasan) insertAuditLog(db, buatAuditLog(`PANJAR-CLOSE ${p.id}`, alasan, p));
        const totalRealisasi = req.items.reduce((s, i) => s + i.nominal, 0);
        return ok({
          totalRealisasi,
          sisa: close.sisaRow?.masuk ?? 0,
          kurang: Math.max(0, totalRealisasi - p.jumlah),
        });
      } catch (e) {
        return fail(String(e));
      }
    },
  );

  ipcMain.handle('tutup:list', () => ok(listTutupBuku(db)));
  ipcMain.handle('tutup:preview', (_e, tahun: number) =>
    ok({ tahun, laba: labaTahun(listTransaksi(db), tahun) }),
  );
  ipcMain.handle('tutup:create', (_e, tahun: number, backupPath = '') => {
    try {
      const laba = labaTahun(listTransaksi(db), tahun);
      insertTutupBuku(db, { tahun, laba, created_at: new Date().toISOString(), backup_path: backupPath });
      return ok({ tahun, laba });
    } catch (e) {
      return fail(String(e));
    }
  });

  ipcMain.handle('saldo:list', (_e, cutoff?: string) => {
    const tx = listTransaksi(db);
    const perKas = saldoSemuaKas(tx, KAS_KODES, cutoff);
    return ok({ perKas, total: Object.values(perKas).reduce((s, v) => s + v, 0) });
  });
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'Keuangan Pura Dalem Puri',
    webPreferences: { preload: join(__dirname, '../preload/index.js') },
  });
  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  win.on('closed', () => (win = null));
}

void app.whenReady().then(() => {
  db = openDb(dbPath());
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
