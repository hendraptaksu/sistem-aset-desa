// P2-7: integrasi handler IPC/main tanpa Electron runtime.
// Seluruh handler didaftarkan lewat `registerIpc(deps)` dengan dependensi palsu;
// alur create → reverse → tutup → backup → restore dijalankan pada DB sementara.

import type Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import { registerIpc, type IpcDeps } from '../src/main/ipc.js';
import { kunciLagi, operasiPanjangAktif, sesi } from '../src/main/kunci.js';

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
  openPaths: string[];
  panggil: (channel: string, ...args: any[]) => Promise<JawabanIpc>;
  panggilDari: (
    channel: string,
    event: unknown,
    ...args: any[]
  ) => Promise<JawabanIpc>;
  db: () => Database.Database;
  tutup: () => void;
};

const envs: Env[] = [];

function buatEnv(): Env {
  const dir = mkdtempSync(join(tmpdir(), 'pura-ipc-'));
  const dataDir = join(dir, 'data');
  const dbFile = join(dataDir, 'pura.db');
  let db = openDb(dbFile);
  const handlers = new Map<string, Handler>();
  const setDbCalls: Database.Database[] = [];
  const saveQueue: { canceled: boolean; filePath?: string }[] = [];
  const openQueue: { canceled: boolean; filePaths: string[] }[] = [];
  const openPaths: string[] = [];
  const lokasi = {
    mode: 'INSTALLED' as const,
    dataDir,
    dbPath: dbFile,
    attachmentsDir: join(dir, 'attachments'),
    backupsDir: join(dataDir, 'backups'),
  };
  const rendererFile = join(dir, 'out', 'renderer', 'index.html');
  const frameSah = { senderFrame: { url: pathToFileURL(rendererFile).href } };

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
    openPath: async (path) => {
      openPaths.push(path);
      return '';
    },
    lampiranDir: () => lokasi.attachmentsDir,
    lokasiData: () => lokasi,
    pengirim: { rendererFile },
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
    openPaths,
    panggil: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Channel ${channel} tidak terdaftar.`);
      return (await handler(frameSah, ...args)) as JawabanIpc;
    },
    panggilDari: async (channel, event, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`Channel ${channel} tidak terdaftar.`);
      return (await handler(event, ...args)) as JawabanIpc;
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
  sesi.terakhirAktivitas = 0;
  sesi.operasiPanjang = 0;
});

const D = (akun_kode: string, debit: number) => ({ akun_kode, debit, kredit: 0 });
const K = (akun_kode: string, kredit: number) => ({ akun_kode, debit: 0, kredit });

const CHANNEL_IPC = [
  'akun:hapus',
  'akun:set-aktif',
  'akun:tambah',
  'akun:ubah',
  'anggaran:list',
  'anggaran:simpan',
  'app:buka-folder',
  'app:info-lokasi',
  'aset:create',
  'aset:delete',
  'aset:list',
  'aset:update',
  'audit:list',
  'backup:auto',
  'backup:export',
  'backup:import',
  'backup:lengkap',
  'backup:restore-lengkap',
  'backup:status',
  'coa:list',
  'dashboard:get',
  'file:save-buffer',
  'file:save-pdf',
  'import:preview',
  'import:proses',
  'import:template',
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
  'lock:reset-code',
  'lock:setup',
  'lock:status',
  'lock:unlock',
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
  'pihak:rekon',
  'pihak:saldo',
  'pihak:update',
  'rekonsiliasi:create',
  'rekonsiliasi:detail',
  'rekonsiliasi:list',
  'rekonsiliasi:selesai',
  'saldo-awal:posting',
  'saldo-awal:status',
  'saldo:list',
  'tutup:create',
  'tutup:list',
  'tutup:preview',
];

describe('P2-7 — registrasi handler IPC', () => {
  it('mendaftarkan seluruh 77 channel lewat deps.handle', () => {
    const env = buatEnv();
    expect(env.handlers.size).toBe(77);
    expect([...env.handlers.keys()].sort()).toEqual([...CHANNEL_IPC].sort());
    expect(CHANNEL_IPC).toHaveLength(77);
  });
});

describe('Daftar Akun — tambah akun lewat IPC', () => {
  it('menambah akun BEBAN/PENDAPATAN dan menolak kode ganda', async () => {
    const env = buatEnv();

    const tambah = await env.panggil('akun:tambah', {
      kode: '5011',
      nama: 'PENGELUARAN ARTOS',
      tipe: 'BEBAN',
    });
    expect(tambah.ok, tambah.error).toBe(true);
    expect(tambah.data).toMatchObject({
      kode: '5011',
      nama: 'PENGELUARAN ARTOS',
      tipe: 'BEBAN',
      posisi_normal: 'DEBIT',
    });

    const daftar = await env.panggil('coa:list');
    expect(daftar.ok, daftar.error).toBe(true);
    expect(daftar.data.some((a: { kode: string }) => a.kode === '5011')).toBe(true);

    const ulang = await env.panggil('akun:tambah', {
      kode: '5011',
      nama: 'ARTOS LAIN',
      tipe: 'BEBAN',
    });
    expect(ulang.ok).toBe(false);
    expect(ulang.error).toMatch(/sudah dipakai/i);

    const ubah = await env.panggil('akun:ubah', {
      kode: '5011',
      nama: 'PENGELUARAN ARTOS BARU',
    });
    expect(ubah.ok, ubah.error).toBe(true);
    expect(ubah.data.nama).toBe('PENGELUARAN ARTOS BARU');

    const nonaktif = await env.panggil('akun:set-aktif', '5011', false);
    expect(nonaktif.ok, nonaktif.error).toBe(true);
    expect(nonaktif.data.aktif).toBe(false);

    const daftarNonaktif = await env.panggil('coa:list');
    expect(
      daftarNonaktif.data.find((a: { kode: string }) => a.kode === '5011')
        ?.aktif,
    ).toBe(false);

    const aktif = await env.panggil('akun:set-aktif', '5011', true);
    expect(aktif.ok, aktif.error).toBe(true);
    expect(aktif.data.aktif).toBe(true);

    const hapus = await env.panggil('akun:hapus', '5011');
    expect(hapus.ok, hapus.error).toBe(true);
    const daftarHapus = await env.panggil('coa:list');
    expect(daftarHapus.data.some((a: { kode: string }) => a.kode === '5011')).toBe(false);

    const ubahBawaan = await env.panggil('akun:ubah', {
      kode: '5010',
      nama: 'UBAH AKUN BAWAAN',
    });
    expect(ubahBawaan.ok).toBe(false);
    expect(ubahBawaan.error).toMatch(/bawaan/i);
  });
});

describe('AUD-09 — peringatan jurnal 1050/2050 tanpa pihak', () => {
  it('posting 1050 tanpa pihak minta konfirmasi (bukan error), lalu bisa disimpan', async () => {
    const env = buatEnv();
    const input = {
      header: {
        id: 'j-piutang-tanpa-pihak',
        tanggal: '2026-02-01',
        keterangan: 'Piutang tanpa pihak',
      },
      baris: [D('1050', 100_000), K('3000', 100_000)],
    };

    const belum = await env.panggil('jurnal:posting', input);
    expect(belum.ok).toBe(false);
    expect(belum.error).toMatch(/belum teralokasi di Piutang & Hutang/i);
    expect(belum.perluKonfirmasi).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toEqual([]);

    const lanjut = await env.panggil('jurnal:posting', input, {
      konfirmasiPeringatan: true,
    });
    expect(lanjut.ok, lanjut.error).toBe(true);

    const rekon = await env.panggil('pihak:rekon');
    expect(rekon.ok, rekon.error).toBe(true);
    expect(rekon.data).toMatchObject({
      piutangAkun: 100_000,
      piutangTeralokasi: 0,
      piutangBelum: 100_000,
    });
    expect(rekon.data.jurnalBelum).toHaveLength(1);
    expect(rekon.data.jurnalBelum[0]).toMatchObject({
      jurnal_id: 'j-piutang-tanpa-pihak',
      akun_kode: '1050',
      nominal: 100_000,
    });

    // Cutoff opsional tetap divalidasi sebagai tanggal kalender.
    const salah = await env.panggil('pihak:rekon', '2026-02-31');
    expect(salah.ok).toBe(false);
    expect(salah.error).toMatch(/tanggal/i);

    const cutoff = await env.panggil('pihak:rekon', '2025-12-31');
    expect(cutoff.ok, cutoff.error).toBe(true);
    expect(cutoff.data).toMatchObject({
      piutangAkun: 0,
      piutangBelum: 0,
    });
  });
});

describe('P2-8 — info lokasi & buka folder', () => {
  it('mengembalikan lokasi deps dan hanya membuka tiga folder tetap', async () => {
    const env = buatEnv();

    const info = await env.panggil('app:info-lokasi');
    expect(info.ok, info.error).toBe(true);
    expect(info.data).toEqual({
      mode: 'INSTALLED',
      dataDir: join(env.dir, 'data'),
      dbPath: join(env.dir, 'data', 'pura.db'),
      attachmentsDir: join(env.dir, 'attachments'),
      backupsDir: join(env.dir, 'data', 'backups'),
    });

    const buka = await env.panggil('app:buka-folder', 'attachments');
    expect(buka.ok, buka.error).toBe(true);
    expect(buka.data).toEqual({
      opened: true,
      jenis: 'attachments',
      path: join(env.dir, 'attachments'),
    });
    expect(env.openPaths).toEqual([join(env.dir, 'attachments')]);
    expect(existsSync(join(env.dir, 'attachments'))).toBe(true);

    // Path dari renderer tidak pernah diterima, hanya tiga nama folder tetap.
    for (const jenis of ['../../etc', '/tmp', 'data/../../', '', null]) {
      const salah = await env.panggil('app:buka-folder', jenis);
      expect(salah.ok).toBe(false);
    }
    expect(env.openPaths).toHaveLength(1);

    // Backup internal memakai folder backup dari lokasi yang sama.
    const auto = await env.panggil('backup:auto', 2025);
    expect(auto.ok, auto.error).toBe(true);
    expect(auto.data.path).toBe(join(env.dir, 'data', 'backups', 'pura-2025.db'));
    expect(existsSync(auto.data.path)).toBe(true);
  });
});

describe('AUD-17 — hardening backup:auto dan pengirim IPC', () => {
  it('menolak tahun backup yang bukan integer 1900..9999 tanpa membuat path', async () => {
    const env = buatEnv();
    for (const tahun of ['../../x', 'NaN', 0, 2026.5, 1899, 10000, NaN, null]) {
      const hasil = await env.panggil('backup:auto', tahun);
      expect(hasil.ok, `tahun ${String(tahun)} harus ditolak`).toBe(false);
      expect(hasil.error).toMatch(/tahun backup tidak valid/i);
    }
    expect(existsSync(join(env.dir, 'data', 'backups'))).toBe(false);

    const sah = await env.panggil('backup:auto', 2026);
    expect(sah.ok, sah.error).toBe(true);
    expect(sah.data.path).toBe(
      join(env.dir, 'data', 'backups', 'pura-2026.db'),
    );
    expect(existsSync(sah.data.path)).toBe(true);
  });

  it('menolak event dari frame asing/null dan menerima frame renderer', async () => {
    const env = buatEnv();

    const sah = await env.panggil('coa:list');
    expect(sah.ok, sah.error).toBe(true);

    for (const event of [
      { senderFrame: { url: 'https://jahat.test/' } },
      { senderFrame: { url: 'about:srcdoc' } },
      { senderFrame: null },
      {},
      null,
    ]) {
      const ditolak = await env.panggilDari('coa:list', event);
      expect(ditolak.ok).toBe(false);
      expect(ditolak.error).toMatch(/pengirim bukan aplikasi ini/i);
    }
  });
});

describe('AUD-11 — IPC backup lengkap (DB + lampiran)', () => {
  it('membuat subfolder bertanggal, menyalin lampiran, dan menulis audit', async () => {
    const env = buatEnv();
    await env.panggil('jurnal:posting', {
      header: {
        id: 'j-aud11',
        tanggal: '2026-10-23',
        keterangan: 'Jurnal sebelum backup lengkap',
      },
      baris: [D('1001', 75_000), K('4005', 75_000)],
    });

    const attachments = join(env.dir, 'attachments');
    mkdirSync(attachments, { recursive: true });
    writeFileSync(join(attachments, 'foto.jpg'), 'isi-foto');
    writeFileSync(join(attachments, 'bukti.pdf'), 'isi-pdf');

    const induk = join(env.dir, 'tujuan-backup');
    mkdirSync(induk, { recursive: true });
    env.openQueue.push({ canceled: false, filePaths: [induk] });
    const hasil = await env.panggil('backup:lengkap');
    expect(hasil.ok, hasil.error).toBe(true);

    // now() test = 2026-10-23T08:00Z = 16:00 WITA.
    const dest = join(induk, 'pura-backup-2026-10-23-1600');
    expect(hasil.data).toEqual({ saved: true, path: dest, jumlahLampiran: 2 });
    expect(existsSync(join(dest, 'pura.db'))).toBe(true);
    expect(existsSync(join(dest, 'attachments', 'foto.jpg'))).toBe(true);
    expect(existsSync(join(dest, 'attachments', 'bukti.pdf'))).toBe(true);
    const manifest = JSON.parse(
      readFileSync(join(dest, 'manifest.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ jumlahLampiran: 2 });

    const audit = await env.panggil('audit:list', { aksi: 'BACKUP-LENGKAP' });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.rows[0]).toMatchObject({ aksi: 'BACKUP-LENGKAP' });
    expect(JSON.parse(audit.data.rows[0].data_baru_json)).toMatchObject({
      path: dest,
      jumlahLampiran: 2,
    });

    // Dialog batal = bukan error dan tidak membuat backup baru.
    const batal = await env.panggil('backup:lengkap');
    expect(batal.ok, batal.error).toBe(true);
    expect(batal.data).toEqual({ saved: false, path: '', jumlahLampiran: 0 });
  });
});

describe('AUD-12 — IPC restore lengkap (DB + lampiran)', () => {
  it('memulihkan DB & lampiran, mencatat audit, dan mengunci sesi lagi', async () => {
    const env = buatEnv();
    expect((await env.panggil('lock:setup', '111111')).ok).toBe(true);

    const postingLama = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-aud12-lama',
        tanggal: '2026-10-23',
        keterangan: 'Jurnal sebelum backup lengkap',
      },
      baris: [D('1001', 80_000), K('4005', 80_000)],
    });
    expect(postingLama.ok, postingLama.error).toBe(true);

    const attachments = join(env.dir, 'attachments');
    mkdirSync(attachments, { recursive: true });
    writeFileSync(join(attachments, 'foto.jpg'), 'isi-foto');
    writeFileSync(join(attachments, 'bukti.pdf'), 'isi-pdf');

    const induk = join(env.dir, 'tujuan-restore');
    mkdirSync(induk, { recursive: true });
    env.openQueue.push({ canceled: false, filePaths: [induk] });
    const backup = await env.panggil('backup:lengkap');
    expect(backup.ok, backup.error).toBe(true);
    expect(backup.data.saved).toBe(true);

    // Data aktif berubah setelah backup: jurnal tambahan + lampiran berbeda.
    const postingBaru = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-aud12-baru',
        tanggal: '2026-10-23',
        keterangan: 'Jurnal setelah backup lengkap',
      },
      baris: [D('1001', 20_000), K('4005', 20_000)],
    });
    expect(postingBaru.ok, postingBaru.error).toBe(true);
    writeFileSync(join(attachments, 'foto.jpg'), 'setelah-backup');
    writeFileSync(join(attachments, 'baru.jpg'), 'lampiran-ekstra');

    const dbSebelumRestore = env.db();
    env.openQueue.push({ canceled: false, filePaths: [backup.data.path] });
    const hasil = await env.panggil('backup:restore-lengkap');
    expect(hasil.ok, hasil.error).toBe(true);
    expect(hasil.data).toMatchObject({
      restored: true,
      path: join(env.dir, 'data', 'pura.db'),
      preRestorePath: join(
        env.dir,
        'data',
        'backups',
        'pre-restore-2026-10-23-1600.db',
      ),
      preRestoreAttachmentsPath: join(
        env.dir,
        'attachments-pre-restore-2026-10-23-1600',
      ),
      jumlahLampiran: 2,
    });
    expect(env.setDbCalls).toHaveLength(1);
    expect(env.setDbCalls[0]).toBe(env.db());
    expect(env.db()).not.toBe(dbSebelumRestore);

    // Lampiran aktif kembali ke isi backup; lampiran lama tersimpan di cadangan.
    expect(readFileSync(join(attachments, 'foto.jpg'), 'utf-8')).toBe('isi-foto');
    expect(readFileSync(join(attachments, 'bukti.pdf'), 'utf-8')).toBe('isi-pdf');
    expect(existsSync(join(attachments, 'baru.jpg'))).toBe(false);
    expect(existsSync(hasil.data.preRestoreAttachmentsPath)).toBe(true);
    expect(
      readFileSync(join(hasil.data.preRestoreAttachmentsPath, 'foto.jpg'), 'utf-8'),
    ).toBe('setelah-backup');
    expect(
      readFileSync(join(hasil.data.preRestoreAttachmentsPath, 'baru.jpg'), 'utf-8'),
    ).toBe('lampiran-ekstra');
    expect(existsSync(hasil.data.preRestorePath)).toBe(true);

    // AUD-14: sesi terkunci lagi setelah restore; PIN aktif tetap berlaku.
    expect(sesi.terbuka).toBe(false);
    const terkunci = await env.panggil('audit:list', { aksi: 'RESTORE-LENGKAP' });
    expect(terkunci.ok).toBe(false);
    expect(terkunci.error).toMatch(/terkunci/i);
    expect((await env.panggil('lock:unlock', '111111')).ok).toBe(true);

    const daftarJurnal = await env.panggil('jurnal:list', {});
    expect(daftarJurnal.ok, daftarJurnal.error).toBe(true);
    expect(
      daftarJurnal.data.map((j: { id: string }) => j.id),
    ).toEqual(['j-aud12-lama']);

    const audit = await env.panggil('audit:list', { aksi: 'RESTORE-LENGKAP' });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.rows[0]).toMatchObject({ aksi: 'RESTORE-LENGKAP' });
    expect(JSON.parse(audit.data.rows[0].data_baru_json)).toMatchObject({
      sumber: backup.data.path,
      pre_restore_db: hasil.data.preRestorePath,
      pre_restore_attachments: hasil.data.preRestoreAttachmentsPath,
      jumlahLampiran: 2,
    });

    // Dialog batal = bukan error dan tidak mengubah apa pun.
    const batal = await env.panggil('backup:restore-lengkap');
    expect(batal.ok, batal.error).toBe(true);
    expect(batal.data).toEqual({ restored: false, path: '', jumlahLampiran: 0 });
  });
});

describe('P2-9 — import Excel lewat IPC', () => {
  it('unduh template → pratinjau tanpa menulis → proses membuat jurnal', async () => {
    const env = buatEnv();
    const target = join(env.dir, 'template-import.xlsx');

    env.saveQueue.push({ canceled: false, filePath: target });
    const template = await env.panggil('import:template');
    expect(template.ok, template.error).toBe(true);
    expect(template.data).toEqual({ saved: true, path: target });
    expect(existsSync(target)).toBe(true);

    // Dialog batal → {diproses:false}, bukan error.
    const batal = await env.panggil('import:preview');
    expect(batal.ok, batal.error).toBe(true);
    expect(batal.data).toMatchObject({ diproses: false });

    env.openQueue.push({ canceled: false, filePaths: [target] });
    const preview = await env.panggil('import:preview');
    expect(preview.ok, preview.error).toBe(true);
    expect(preview.data).toMatchObject({
      diproses: true,
      namaFile: 'template-import.xlsx',
    });
    expect(preview.data.hasil.ringkasan).toMatchObject({
      totalGrup: 3,
      grupValid: 3,
      seimbang: true,
    });
    // Pratinjau tidak boleh menulis jurnal.
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(0);

    const proses = await env.panggil('import:proses', target, {
      konfirmasiPeringatan: true,
    });
    expect(proses.ok, proses.error).toBe(true);
    expect(proses.data.hasil.ringkasan).toMatchObject({
      jurnalDibuat: 3,
      grupBerhasil: 3,
      grupGagal: 0,
    });
    const daftar = (await env.panggil('jurnal:list', {})).data;
    expect(daftar).toHaveLength(3);
    expect(daftar.map((j: { no_bukti: string }) => j.no_bukti)).toEqual(
      expect.arrayContaining(['JU-2026-0001', 'JU-2026-0002', 'JU-2026-0099']),
    );
    const audit = await env.panggil('audit:list', { aksi: 'IMPORT-EXCEL' });
    expect(audit.data.total).toBe(1);
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
      { cutoff: '2026-12-31', mode: 'kumulatif' },
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
      { cutoff: '2026-12-31', mode: 'kumulatif' },
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

describe('AUD-21b — IPC Neraca Saldo per mode', () => {
  it('default tahun, kumulatif eksplisit, dan pemanggil string lama tetap jalan', async () => {
    const env = buatEnv();

    const pendapatan2025 = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-aud21b-2025',
        tanggal: '2025-03-01',
        keterangan: 'Pendapatan 2025',
      },
      baris: [D('1001', 5_000_000), K('4005', 5_000_000)],
    });
    expect(pendapatan2025.ok, pendapatan2025.error).toBe(true);

    const beban2026 = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-aud21b-2026',
        tanggal: '2026-02-01',
        keterangan: 'Beban 2026',
      },
      baris: [D('5004', 1_000_000), K('1001', 1_000_000)],
    });
    expect(beban2026.ok, beban2026.error).toBe(true);

    // Tanpa mode = default aman tahun berjalan.
    const tahun = await env.panggil('laporan:neraca-saldo', {
      cutoff: '2026-12-31',
    });
    expect(tahun.ok, tahun.error).toBe(true);
    expect(tahun.data).toMatchObject({
      mode: 'tahun',
      mulai: '2026-01-01',
      sampai: '2026-12-31',
      labaDitahanSebelumPeriode: 5_000_000,
      totalPendapatan: 0,
      totalBeban: 1_000_000,
      labaPeriode: -1_000_000,
      seimbang: true,
    });
    expect(
      tahun.data.rows.some((r: { sintetis?: boolean }) => r.sintetis),
    ).toBe(true);

    // String cut-off lama tetap diterima dan memakai mode tahun.
    const lama = await env.panggil('laporan:neraca-saldo', '2026-12-31');
    expect(lama.ok, lama.error).toBe(true);
    expect(lama.data.mode).toBe('tahun');

    const kumulatif = await env.panggil('laporan:neraca-saldo', {
      cutoff: '2026-12-31',
      mode: 'kumulatif',
    });
    expect(kumulatif.ok, kumulatif.error).toBe(true);
    expect(kumulatif.data.mode).toBe('kumulatif');
    expect(
      kumulatif.data.rows.find((r: { kode: string }) => r.kode === '4005')?.saldo,
    ).toBe(5_000_000);
    expect(
      kumulatif.data.rows.find((r: { kode: string }) => r.kode === '5004')?.saldo,
    ).toBe(1_000_000);
    expect(kumulatif.data.totalDebit).toBe(kumulatif.data.totalKredit);
    expect(kumulatif.data.totalDebit).toBeGreaterThan(0);
    expect(
      kumulatif.data.rows.some((r: { sintetis?: boolean }) => r.sintetis),
    ).toBe(false);

    const modeSalah = await env.panggil('laporan:neraca-saldo', {
      cutoff: '2026-12-31',
      mode: 'semua',
    });
    expect(modeSalah.ok).toBe(false);
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

describe('AUD-19 — kode darurat per-install lewat IPC', () => {
  const POLA_KODE = /^(?:[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}-){3}[2-9ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

  it('setup mengembalikan kode sekali, rotate, lalu reset memakai hash baru', async () => {
    const env = buatEnv();
    const setup = await env.panggil('lock:setup', '111111');
    expect(setup.ok, setup.error).toBe(true);
    const kode = setup.data.kodeDarurat as string;
    expect(kode).toMatch(POLA_KODE);

    // Plaintext tidak disimpan di DB; respons setup berikut tidak membocorkan kode.
    const nilai = env
      .db()
      .prepare('SELECT nilai FROM pengaturan')
      .all() as { nilai: string }[];
    const semuaNilai = nilai.map((n) => n.nilai).join('\n');
    expect(semuaNilai).not.toContain(kode);
    expect(semuaNilai).not.toContain(kode.replace(/-/g, ''));
    const kedua = await env.panggil('lock:setup', '222222');
    expect(kedua.ok).toBe(false);
    expect(kedua.data).toBeUndefined();

    const rotate = await env.panggil('lock:reset-code');
    expect(rotate.ok, rotate.error).toBe(true);
    const kodeBaru = rotate.data.kodeDarurat as string;
    expect(kodeBaru).toMatch(POLA_KODE);
    expect(kodeBaru).not.toBe(kode);

    kunciLagi();
    const lama = await env.panggil('lock:reset', kode, '222222');
    expect(lama.ok).toBe(false);
    expect(lama.error).toMatch(/kode darurat salah/i);

    const baru = await env.panggil('lock:reset', kodeBaru, '222222');
    expect(baru.ok, baru.error).toBe(true);
    kunciLagi();
    expect((await env.panggil('lock:unlock', '222222')).ok).toBe(true);
  });

  it('rotate ditolak saat terkunci dan instalasi lama tanpa hash ditolak jelas', async () => {
    const env = buatEnv();
    expect((await env.panggil('lock:setup', '111111')).ok).toBe(true);
    kunciLagi();
    const terkunci = await env.panggil('lock:reset-code');
    expect(terkunci.ok).toBe(false);
    expect(terkunci.error).toMatch(/terkunci/i);

    // Simulasikan DB lama: belum ada reset_salt/reset_hash.
    env.db().prepare("DELETE FROM pengaturan WHERE kunci IN ('reset_salt', 'reset_hash')").run();
    const reset = await env.panggil('lock:reset', 'KODE-LAMA-TIDAK-BERLAKU', '222222');
    expect(reset.ok).toBe(false);
    expect(reset.error).toMatch(/kode darurat belum diatur/i);
    expect(reset.error).toMatch(/pengaturan/i);
  });
});

describe('AUD-18 — auto-lock main & aktivitas sesi', () => {
  it('lock:status (polling) tidak menyentuh aktivitas; IPC terjaga menyentuh', async () => {
    const env = buatEnv();
    expect((await env.panggil('lock:setup', '111111')).ok).toBe(true);

    sesi.terakhirAktivitas = 1;
    expect((await env.panggil('lock:status')).ok).toBe(true);
    expect(sesi.terakhirAktivitas).toBe(1);

    expect((await env.panggil('app:info-lokasi')).ok).toBe(true);
    expect(sesi.terakhirAktivitas).toBeGreaterThan(1);
  });

  it('IPC yang ditolak saat terkunci tidak dihitung aktivitas; unlock menyentuh', async () => {
    const env = buatEnv();
    expect((await env.panggil('lock:setup', '111111')).ok).toBe(true);
    kunciLagi();
    sesi.terakhirAktivitas = 1;

    const ditolak = await env.panggil('app:info-lokasi');
    expect(ditolak.ok).toBe(false);
    expect(ditolak.error).toMatch(/terkunci/i);
    expect(sesi.terakhirAktivitas).toBe(1);

    expect((await env.panggil('lock:unlock', '111111')).ok).toBe(true);
    expect(sesi.terakhirAktivitas).toBeGreaterThan(1);
  });

  it('tahanan auto-kunci backup dilepas setelah operasi selesai', async () => {
    const env = buatEnv();
    expect((await env.panggil('lock:setup', '111111')).ok).toBe(true);
    env.saveQueue.push({ canceled: false, filePath: join(env.dir, 'backup-aud18.db') });

    const backup = await env.panggil('backup:export');
    expect(backup.ok, backup.error).toBe(true);
    expect(operasiPanjangAktif()).toBe(false);
  });
});
