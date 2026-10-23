// P2-7: integrasi handler IPC/main tanpa Electron runtime.
// Seluruh handler didaftarkan lewat `registerIpc(deps)` dengan dependensi palsu;
// alur create → reverse → tutup → backup → restore dijalankan pada DB sementara.

import type Database from 'better-sqlite3';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { registerIpc, type IpcDeps } from '../src/main/ipc.js';
import { sesi } from '../src/main/kunci.js';

type Handler = (event: unknown, ...args: any[]) => unknown;

type JawabanIpc = {
  ok: boolean;
  data?: any;
  error?: string;
  perluAlasan?: boolean;
  perluKonfirmasi?: boolean;
};

type Env = {
  dir: string;
  handlers: Map<string, Handler>;
  setDbCalls: Database.Database[];
  saveQueue: { canceled: boolean; filePath?: string }[];
  openQueue: { canceled: boolean; filePaths: string[] }[];
  panggil: (channel: string, ...args: any[]) => Promise<JawabanIpc>;
  db: () => Database.Database;
  tutup: () => void;
};

const envs: Env[] = [];

function buatEnv(): Env {
  const dir = mkdtempSync(join(tmpdir(), 'pura-ipc-'));
  const dbFile = join(dir, 'pura.db');
  let db = openDb(dbFile);
  const handlers = new Map<string, Handler>();
  const setDbCalls: Database.Database[] = [];
  const saveQueue: { canceled: boolean; filePath?: string }[] = [];
  const openQueue: { canceled: boolean; filePaths: string[] }[] = [];

  const deps: IpcDeps = {
    handle: (channel, listener) => handlers.set(channel, listener),
    db: () => db,
    setDb: (d) => {
      db = d;
      setDbCalls.push(d);
    },
    dbPath: () => dbFile,
    dialog: {
      showSaveDialog: async () => saveQueue.shift() ?? { canceled: true },
      showOpenDialog: async () => openQueue.shift() ?? { canceled: true, filePaths: [] },
    },
    writeFile: (path, data) => writeFileSync(path, data),
    printPdf: async (html, path) => {
      writeFileSync(path, Buffer.from(html, 'utf-8'));
    },
    openPath: async () => '',
    lampiranDir: () => join(dir, 'attachments'),
    // Tanggal tetap agar K2 (tutup hanya tahun selesai) deterministik.
    now: () => new Date('2026-10-23T08:00:00.000Z'),
  };

  // DB temp belum punya PIN, jadi gembok data terbuka; tetap set sesi eksplisit.
  sesi.terbuka = true;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
  registerIpc(deps);

  const env: Env = {
    dir,
    handlers,
    setDbCalls,
    saveQueue,
    openQueue,
    panggil: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Channel ${channel} tidak terdaftar.`);
      return (await handler({}, ...args)) as JawabanIpc;
    },
    db: () => db,
    tutup: () => {
      if (db.open) db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
  envs.push(env);
  return env;
}

afterEach(() => {
  for (const env of envs.splice(0)) env.tutup();
  // Jangan biarkan status sesi PIN bocor ke test file lain.
  sesi.terbuka = false;
  sesi.gagal = 0;
  sesi.blokirSampai = 0;
});

const D = (akun_kode: string, debit: number) => ({ akun_kode, debit, kredit: 0 });
const K = (akun_kode: string, kredit: number) => ({ akun_kode, debit: 0, kredit });

const CHANNEL_IPC = [
  'anggaran:list',
  'anggaran:simpan',
  'aset:create',
  'aset:delete',
  'aset:list',
  'aset:update',
  'audit:list',
  'backup:auto',
  'backup:export',
  'backup:import',
  'backup:status',
  'coa:list',
  'dashboard:get',
  'file:save-buffer',
  'file:save-pdf',
  'jurnal:cari',
  'jurnal:koreksi-isi-ulang',
  'jurnal:list',
  'jurnal:nomor-berikutnya',
  'jurnal:posting',
  'jurnal:reverse',
  'lampiran:delete',
  'lampiran:list',
  'lampiran:open',
  'lampiran:preview',
  'lampiran:upload',
  'laporan:anggaran',
  'laporan:arus-kas',
  'laporan:buku-besar',
  'laporan:jurnal-akun',
  'laporan:jurnal-detail',
  'laporan:laba-rugi',
  'laporan:neraca',
  'laporan:neraca-saldo',
  'lock:change',
  'lock:idle-set',
  'lock:lock',
  'lock:reset',
  'lock:setup',
  'lock:status',
  'lock:unlock',
  'neraca:get',
  'panjar:close',
  'panjar:create',
  'panjar:items',
  'panjar:list',
  'pengaturan:get',
  'pengaturan:simpan',
  'pihak:create',
  'pihak:delete',
  'pihak:jurnal',
  'pihak:list',
  'pihak:posting',
  'pihak:saldo',
  'pihak:update',
  'rekonsiliasi:create',
  'rekonsiliasi:detail',
  'rekonsiliasi:list',
  'rekonsiliasi:selesai',
  'saldo-awal:posting',
  'saldo-awal:status',
  'saldo:list',
  'transaksi:create',
  'transaksi:list',
  'tutup:create',
  'tutup:list',
  'tutup:preview',
];

describe('P2-7 — registrasi handler IPC', () => {
  it('mendaftarkan seluruh 67 channel lama lewat deps.handle', () => {
    const env = buatEnv();
    expect(env.handlers.size).toBe(67);
    expect([...env.handlers.keys()].sort()).toEqual([...CHANNEL_IPC].sort());
    expect(CHANNEL_IPC).toHaveLength(67);
  });
});

describe('P2-7 — alur create → reverse → tutup → backup → restore', () => {
  it('menjalankan seluruh alur lewat handler saja, tanpa Electron', async () => {
    const env = buatEnv();

    // 1. Posting jurnal: nomor bukti otomatis.
    const posting = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-parkir-2026',
        tanggal: '2026-01-02',
        keterangan: 'Penerimaan parkir uji',
      },
      baris: [D('1001', 100_000), K('4005', 100_000)],
    });
    expect(posting.ok, posting.error).toBe(true);
    expect(posting.data.jurnal).toMatchObject({
      id: 'j-parkir-2026',
      no_bukti: 'JU-2026-0001',
      keterangan: 'Penerimaan parkir uji',
    });

    // 2. Reverse: jurnal balik tersimpan, jurnal asli tetap ada, saldo nol.
    const reverse = await env.panggil(
      'jurnal:reverse',
      'j-parkir-2026',
      'Salah input nominal',
      { id: 'rev-parkir-2026', tanggal: '2026-01-03' },
    );
    expect(reverse.ok, reverse.error).toBe(true);
    expect(reverse.data.jurnal).toMatchObject({
      id: 'rev-parkir-2026',
      jenis: 'REVERSAL',
      reversal_of: 'j-parkir-2026',
    });

    const neracaSetelahReverse = await env.panggil(
      'laporan:neraca-saldo',
      '2026-12-31',
    );
    expect(neracaSetelahReverse.ok, neracaSetelahReverse.error).toBe(true);
    expect(neracaSetelahReverse.data.selisih).toBe(0);
    expect(neracaSetelahReverse.data.totalDebit).toBe(0);
    expect(neracaSetelahReverse.data.totalKredit).toBe(0);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(2);

    // 3. Tutup buku tahun lalu (2025): preview + create + audit.
    const posting2025 = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-pendapatan-2025',
        tanggal: '2025-03-01',
        keterangan: 'Pendapatan tahun 2025',
        jenis: 'TERIMA',
      },
      baris: [D('1001', 5_000_000), K('4005', 5_000_000)],
    });
    expect(posting2025.ok, posting2025.error).toBe(true);
    expect(posting2025.data.jurnal.no_bukti).toBe('JU-2025-0001');

    const preview = await env.panggil('tutup:preview', 2025);
    expect(preview.ok, preview.error).toBe(true);
    expect(preview.data).toMatchObject({
      tahun: 2025,
      boleh: true,
      laba: 5_000_000,
      sudahDitutup: false,
    });

    const tutup = await env.panggil('tutup:create', {
      tahun: 2025,
      catatan: 'Sudah diperiksa akuntan',
    });
    expect(tutup.ok, tutup.error).toBe(true);
    expect(tutup.data).toMatchObject({
      tahun: 2025,
      aksi: 'TUTUP',
      laba: 5_000_000,
      data: { tahun: 2025, catatan: 'Sudah diperiksa akuntan' },
    });

    const riwayatTutup = await env.panggil('tutup:list');
    expect(riwayatTutup.ok, riwayatTutup.error).toBe(true);
    expect(riwayatTutup.data).toHaveLength(1);
    expect(riwayatTutup.data[0]).toMatchObject({ tahun: 2025, laba: 5_000_000 });

    const auditTutup = await env.panggil('audit:list', { aksi: 'TUTUP' });
    expect(auditTutup.ok, auditTutup.error).toBe(true);
    expect(auditTutup.data.rows.map((a: { aksi: string }) => a.aksi)).toContain(
      'TUTUP 2025',
    );
    const auditReverse = await env.panggil('audit:list', { aksi: 'REVERSAL' });
    expect(
      auditReverse.data.rows.map((a: { aksi: string }) => a.aksi),
    ).toContain('REVERSAL j-parkir-2026');

    // 4. Backup manual ke file nyata di folder temp.
    const backupPath = join(env.dir, 'backup.db');
    env.saveQueue.push({ canceled: false, filePath: backupPath });
    const ekspor = await env.panggil('backup:export');
    expect(ekspor.ok, ekspor.error).toBe(true);
    expect(ekspor.data).toEqual({ saved: true, path: backupPath });
    expect(existsSync(backupPath)).toBe(true);

    // 5. Restore: koneksi DB diganti lewat deps.setDb, data tetap utuh.
    const dbSebelumRestore = env.db();
    env.openQueue.push({ canceled: false, filePaths: [backupPath] });
    const impor = await env.panggil('backup:import');
    expect(impor.ok, impor.error).toBe(true);
    expect(impor.data).toMatchObject({ restored: true });
    expect(env.setDbCalls).toHaveLength(1);
    expect(env.setDbCalls[0]).toBe(env.db());
    expect(env.db()).not.toBe(dbSebelumRestore);

    const daftarSetelahRestore = await env.panggil('jurnal:list', {});
    expect(daftarSetelahRestore.ok, daftarSetelahRestore.error).toBe(true);
    expect(
      daftarSetelahRestore.data.map((j: { id: string }) => j.id),
    ).toEqual(
      expect.arrayContaining(['j-parkir-2026', 'rev-parkir-2026', 'j-pendapatan-2025']),
    );
    expect((await env.panggil('tutup:list')).data).toHaveLength(1);

    const neracaSetelahRestore = await env.panggil(
      'laporan:neraca-saldo',
      '2026-12-31',
    );
    expect(neracaSetelahRestore.ok, neracaSetelahRestore.error).toBe(true);
    expect(neracaSetelahRestore.data.selisih).toBe(0);
    expect(neracaSetelahRestore.data.totalDebit).toBe(
      neracaSetelahRestore.data.totalKredit,
    );

    // 6. Pencarian jurnal setelah restore menemukan jurnal asli.
    const cari = await env.panggil('jurnal:cari', { cari: 'Penerimaan parkir' });
    expect(cari.ok, cari.error).toBe(true);
    expect(cari.data.total).toBe(2);
    expect(cari.data.rows.map((j: { id: string }) => j.id)).toEqual(
      expect.arrayContaining(['j-parkir-2026', 'rev-parkir-2026']),
    );
  });
});

describe('P2-7 — error handling IPC', () => {
  it('menolak jurnal tidak seimbang sebagai {ok:false}, bukan throw', async () => {
    const env = buatEnv();
    const hasil = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-tidak-seimbang',
        tanggal: '2026-01-02',
        keterangan: 'Uji jurnal tidak seimbang',
      },
      baris: [D('1001', 100_000), K('4005', 90_000)],
    });

    expect(hasil.ok).toBe(false);
    expect(hasil.error).toMatch(/tidak seimbang/i);
    expect((await env.panggil('jurnal:list', {})).data).toEqual([]);
  });

  it('menolak kandidat backup sampah dan tetap memakai DB lama', async () => {
    const env = buatEnv();
    const valid = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-aman',
        tanggal: '2026-01-02',
        keterangan: 'Jurnal sebelum restore gagal',
      },
      baris: [D('1001', 50_000), K('4005', 50_000)],
    });
    expect(valid.ok, valid.error).toBe(true);

    const dbLama = env.db();
    const sampah = join(env.dir, 'sampah.db');
    writeFileSync(sampah, 'ini bukan database sqlite');
    env.openQueue.push({ canceled: false, filePaths: [sampah] });
    const impor = await env.panggil('backup:import');

    expect(impor.ok).toBe(false);
    expect(impor.error).toMatch(/tidak bisa dibaca|rusak/i);
    expect(env.setDbCalls).toHaveLength(1);
    expect(env.setDbCalls[0]).toBe(dbLama);
    expect(env.db()).toBe(dbLama);

    // DB lama masih bisa dibaca & ditulis lewat handler setelah restore gagal.
    const daftar = await env.panggil('jurnal:list', {});
    expect(daftar.data.map((j: { id: string }) => j.id)).toEqual(['j-aman']);

    const lanjut = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-setelah-gagal',
        tanggal: '2026-01-03',
        keterangan: 'Masih bisa menulis setelah restore gagal',
      },
      baris: [D('1001', 25_000), K('4005', 25_000)],
    });
    expect(lanjut.ok, lanjut.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(2);
  });
});
