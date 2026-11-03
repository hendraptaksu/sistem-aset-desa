// P2-7: integrasi handler IPC/main tanpa Electron runtime.
// Seluruh handler didaftarkan lewat `registerIpc(deps)` dengan dependensi palsu;
// alur create → reverse → tutup → backup → restore dijalankan pada DB sementara.

import type Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  'app:buka-folder',
  'app:info-lokasi',
  'audit:integritas',
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
  'jurnal:cari',
  'jurnal:koreksi-isi-ulang',
  'jurnal:list',
  'jurnal:nomor-berikutnya',
  'jurnal:posting',
  'jurnal:reverse',
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
  'panjar:batal',
  'panjar:batal-close',
  'panjar:close',
  'panjar:create',
  'panjar:items',
  'panjar:list',
  'pengaturan:get',
  'pengaturan:simpan',
  'pinjaman:bayar',
  'pinjaman:bayar-batal',
  'pinjaman:batal',
  'pinjaman:detail',
  'pinjaman:list',
  'pinjaman:mutasi',
  'pinjaman:pembayaran',
  'pinjaman:rekonsiliasi',
  'pinjaman:simpan',
  'saldo-awal:posting',
  'saldo-awal:status',
  'saldo:list',
  'tutup:create',
  'tutup:list',
  'tutup:preview',
  'transaksi:posting',
];

describe('P2-7 — registrasi handler IPC', () => {
  it('mendaftarkan seluruh 63 channel lewat deps.handle', () => {
    const env = buatEnv();
    expect(env.handlers.size).toBe(63);
    expect([...env.handlers.keys()].sort()).toEqual([...CHANNEL_IPC].sort());
    expect(CHANNEL_IPC).toHaveLength(63);
  });

  it('DB-31: channel rekonsiliasi bank sudah tidak terdaftar', () => {
    const env = buatEnv();
    expect([...env.handlers.keys()].filter((kanal) => kanal.startsWith('rekonsiliasi:'))).toEqual(
      [],
    );
  });

  it('DB-32: channel inventaris aset sudah tidak terdaftar', () => {
    const env = buatEnv();
    expect([...env.handlers.keys()].filter((kanal) => kanal.startsWith('aset:'))).toEqual([]);
  });

  it('DB-24: channel anggaran dan laporan:anggaran sudah tidak terdaftar', () => {
    const env = buatEnv();
    const kanal = [...env.handlers.keys()];
    expect(kanal.filter((k) => k.startsWith('anggaran:'))).toEqual([]);
    expect(kanal).not.toContain('laporan:anggaran');
  });

  it('DB-23b: channel pihak:* sudah tidak terdaftar', () => {
    const env = buatEnv();
    expect([...env.handlers.keys()].filter((kanal) => kanal.startsWith('pihak:'))).toEqual(
      [],
    );
  });
});

describe('DB-12 — IPC audit integritas read-only', () => {
  it('DB bersih: mengembalikan ok true tanpa temuan', async () => {
    const env = buatEnv();
    const hasil = await env.panggil('audit:integritas');

    expect(hasil.ok, hasil.error).toBe(true);
    expect(hasil.data).toMatchObject({
      ok: true,
      temuan: [],
      ringkasan: expect.stringMatching(/tidak ada temuan/i),
    });
  });

  it('DB rusak: mengembalikan temuan dan tidak menulis tabel apa pun', async () => {
    const env = buatEnv();
    const db = env.db();
    db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
       VALUES ('j-rusak', '2026-10-23', '', 'Korupsi', 'UMUM', 'j-rusak', NULL,
               '2026-10-29T00:00:00.000Z')`,
    ).run();
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-rusak', '1001', 1000, 0, '')`,
    ).run();
    db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES ('j-rusak', '4001', 0, 900, '')`,
    ).run();

    const tabel = ['akun', 'jurnal', 'jurnal_baris', 'audit_log', 'panjar', 'panjar_item'];
    const hitung = (): Record<string, number> =>
      Object.fromEntries(
        tabel.map((t) => [
          t,
          (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n,
        ]),
      );
    const sebelum = hitung();

    const hasil = await env.panggil('audit:integritas');
    const ulang = await env.panggil('audit:integritas');

    expect(hasil.ok, hasil.error).toBe(true);
    expect(hasil.data.ok).toBe(false);
    expect(hasil.data.temuan[0]).toMatchObject({ kode: 'JURNAL_TIDAK_SEIMBANG' });
    expect(hasil.data.ringkasan).toMatch(/1 temuan/i);
    expect(ulang.data).toEqual(hasil.data);
    expect(hitung()).toEqual(sebelum);
    expect(env.setDbCalls).toHaveLength(0);
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

  it('menambah akun bank 1100–1199 dan mengembalikan metadata di coa:list', async () => {
    const env = buatEnv();

    const tambah = await env.panggil('akun:tambah', {
      kode: '1101',
      nama: 'BANK BPD REKENING BARU',
      tipe: 'AKTIVA',
      is_kas: true,
      kelompok: 'BANK',
    });
    expect(tambah.ok, tambah.error).toBe(true);
    expect(tambah.data).toMatchObject({
      kode: '1101',
      tipe: 'AKTIVA',
      posisi_normal: 'DEBIT',
      is_kas: true,
      kelompok: 'BANK',
      sumber: 'TAMBAHAN',
    });

    const daftar = await env.panggil('coa:list');
    expect(daftar.ok, daftar.error).toBe(true);
    expect(
      daftar.data.find((a: { kode: string }) => a.kode === '1101'),
    ).toMatchObject({ is_kas: true, kelompok: 'BANK', sumber: 'TAMBAHAN' });

    const salah = await env.panggil('akun:tambah', {
      kode: '1102',
      nama: 'BANK TANPA PENANDA',
      tipe: 'AKTIVA',
      is_kas: false,
      kelompok: 'BANK',
    });
    expect(salah.ok).toBe(false);
    expect(salah.error).toMatch(/is_kas = 1/i);
  });
});

describe('DB-15 — nonaktifkan akun bawaan lewat IPC', () => {
  it('5010 boleh dinonaktifkan/diaktifkan, audit menyimpan alasan, rename/hapus tetap ditolak', async () => {
    const env = buatEnv();

    const nonaktif = await env.panggil('akun:set-aktif', '5010', false);
    expect(nonaktif.ok, nonaktif.error).toBe(true);
    expect(nonaktif.data).toMatchObject({
      kode: '5010',
      aktif: false,
      sumber: 'BAWAAN',
    });

    const daftar = await env.panggil('coa:list');
    expect(
      daftar.data.find((a: { kode: string }) => a.kode === '5010')?.aktif,
    ).toBe(false);

    const auditNonaktif = await env.panggil('audit:list', {
      aksi: 'AKUN-NONAKTIF',
    });
    expect(auditNonaktif.ok, auditNonaktif.error).toBe(true);
    const catatan = auditNonaktif.data.rows.find(
      (a: { aksi: string }) => a.aksi === 'AKUN-NONAKTIF 5010',
    );
    expect(catatan?.alasan).toMatch(/5010.*form input baru/i);

    const ubah = await env.panggil('akun:ubah', {
      kode: '5010',
      nama: 'UBAH AKUN BAWAAN',
    });
    expect(ubah.ok).toBe(false);
    expect(ubah.error).toMatch(/bawaan/i);

    const hapus = await env.panggil('akun:hapus', '5010');
    expect(hapus.ok).toBe(false);
    expect(hapus.error).toMatch(/bawaan/i);

    const aktif = await env.panggil('akun:set-aktif', '5010', true, 'Dipakai lagi');
    expect(aktif.ok, aktif.error).toBe(true);
    expect(aktif.data.aktif).toBe(true);

    const auditAktif = await env.panggil('audit:list', { aksi: 'AKUN-AKTIF' });
    expect(
      auditAktif.data.rows.some(
        (a: { aksi: string; alasan: string }) =>
          a.aksi === 'AKUN-AKTIF 5010' && a.alasan === 'Dipakai lagi',
      ),
    ).toBe(true);

    // DB-27: filter referensi terstruktur ikut terekspos lewat IPC.
    const auditRef = await env.panggil('audit:list', {
      ref_type: 'akun',
      ref_id: '5010',
    });
    expect(auditRef.ok, auditRef.error).toBe(true);
    expect(auditRef.data.rows).toHaveLength(2);
    expect(
      auditRef.data.rows.every(
        (a: { ref_type: string; ref_id: string }) =>
          a.ref_type === 'akun' && a.ref_id === '5010',
      ),
    ).toBe(true);
    expect(
      auditRef.data.rows.map((a: { aksi: string }) => a.aksi).sort(),
    ).toEqual(['AKUN-AKTIF 5010', 'AKUN-NONAKTIF 5010']);

    const statusSalah = await env.panggil('akun:set-aktif', '5010', 'false');
    expect(statusSalah.ok).toBe(false);
    expect(statusSalah.error).toMatch(/true\/false/i);
  });

  it('menolak nonaktif akun sistem 3000/1040/1050/2050', async () => {
    const env = buatEnv();
    for (const kode of ['3000', '1040', '1050', '2050']) {
      const hasil = await env.panggil('akun:set-aktif', kode, false);
      expect(hasil.ok, `akun ${kode}`).toBe(false);
      expect(hasil.error).toMatch(/akun sistem/i);
    }
    const daftar = await env.panggil('coa:list');
    for (const kode of ['3000', '1040', '1050', '2050']) {
      expect(
        daftar.data.find((a: { kode: string }) => a.kode === kode)?.aktif,
        `akun ${kode} tetap aktif`,
      ).toBe(true);
    }
  });
});

describe('DB-23a/DB-23b — akun 1050 data lama tetap butuh konfirmasi', () => {
  it('posting 1050 lama minta konfirmasi (bukan error) dan tetap terbaca', async () => {
    const env = buatEnv();
    const input = {
      header: {
        id: 'j-piutang-lama',
        tanggal: '2026-02-01',
        keterangan: 'Piutang lama (koreksi data)',
        jenis: 'UMUM',
      },
      baris: [D('1050', 100_000), K('3000', 100_000)],
    };

    const belum = await env.panggil('jurnal:posting', input, {
      konfirmasiTanpaSaldoAwal: true,
    });
    expect(belum.ok).toBe(false);
    expect(belum.error).toMatch(/1050.*data lama|alur piutang sudah dihapus/i);
    expect(belum.perluKonfirmasi).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toEqual([]);

    const lanjut = await env.panggil('jurnal:posting', input, {
      konfirmasiPeringatan: true,
      alasanPeringatan: 'Koreksi saldo piutang lama',
      konfirmasiTanpaSaldoAwal: true,
    });
    expect(lanjut.ok, lanjut.error).toBe(true);
    const daftar = await env.panggil('jurnal:list', {});
    expect(daftar.ok, daftar.error).toBe(true);
    expect(daftar.data).toHaveLength(1);
    expect(daftar.data[0]).toMatchObject({ id: 'j-piutang-lama' });

    const bb = await env.panggil('laporan:buku-besar', { akun_kode: '1050' });
    expect(bb.ok, bb.error).toBe(true);
    expect(bb.data.saldoAkhir).toBe(100_000);
  });
});

describe('P2-8 — info lokasi & buka folder', () => {
  it('mengembalikan lokasi deps dan hanya membuka dua folder tetap', async () => {
    const env = buatEnv();

    const info = await env.panggil('app:info-lokasi');
    expect(info.ok, info.error).toBe(true);
    expect(info.data).toEqual({
      mode: 'INSTALLED',
      dataDir: join(env.dir, 'data'),
      dbPath: join(env.dir, 'data', 'pura.db'),
      backupsDir: join(env.dir, 'data', 'backups'),
    });

    const buka = await env.panggil('app:buka-folder', 'backups');
    expect(buka.ok, buka.error).toBe(true);
    expect(buka.data).toEqual({
      opened: true,
      jenis: 'backups',
      path: join(env.dir, 'data', 'backups'),
    });
    expect(env.openPaths).toEqual([join(env.dir, 'data', 'backups')]);
    expect(existsSync(join(env.dir, 'data', 'backups'))).toBe(true);

    // Path dari renderer tidak pernah diterima, hanya dua nama folder tetap.
    for (const jenis of ['attachments', '../../etc', '/tmp', 'data/../../', '', null]) {
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

describe('AUD-11 / DB-37 — IPC backup lengkap (DB + manifest)', () => {
  it('membuat subfolder bertanggal berisi DB + manifest dan menulis audit', async () => {
    const env = buatEnv();
    await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-aud11',
          tanggal: '2026-10-23',
          keterangan: 'Jurnal sebelum backup lengkap',
        },
        baris: [D('1001', 75_000), K('4005', 75_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );

    const induk = join(env.dir, 'tujuan-backup');
    mkdirSync(induk, { recursive: true });
    env.openQueue.push({ canceled: false, filePaths: [induk] });
    const hasil = await env.panggil('backup:lengkap');
    expect(hasil.ok, hasil.error).toBe(true);

    // now() test = 2026-10-23T08:00Z = 16:00 WITA.
    const dest = join(induk, 'pura-backup-2026-10-23-1600');
    expect(hasil.data).toEqual({ saved: true, path: dest });
    expect(existsSync(join(dest, 'pura.db'))).toBe(true);
    expect(existsSync(join(dest, 'attachments'))).toBe(false);
    expect(readdirSync(dest).sort()).toEqual(['manifest.json', 'pura.db']);
    const manifest = JSON.parse(
      readFileSync(join(dest, 'manifest.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({ daftarFile: ['pura.db'] });
    expect(manifest).not.toHaveProperty('jumlahLampiran');

    const audit = await env.panggil('audit:list', { aksi: 'BACKUP-LENGKAP' });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.rows[0]).toMatchObject({ aksi: 'BACKUP-LENGKAP' });
    const dataBaru = JSON.parse(audit.data.rows[0].data_baru_json) as Record<
      string,
      unknown
    >;
    expect(dataBaru).toMatchObject({ path: dest });
    expect(dataBaru).not.toHaveProperty('jumlahLampiran');

    // Dialog batal = bukan error dan tidak membuat backup baru.
    const batal = await env.panggil('backup:lengkap');
    expect(batal.ok, batal.error).toBe(true);
    expect(batal.data).toEqual({ saved: false, path: '' });
  });
});

describe('AUD-12 / DB-37 — IPC restore lengkap (database)', () => {
  it('memulihkan DB, mencatat audit, dan mengunci sesi lagi', async () => {
    const env = buatEnv();
    expect((await env.panggil('lock:setup', '111111')).ok).toBe(true);

    const postingLama = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-aud12-lama',
          tanggal: '2026-10-23',
          keterangan: 'Jurnal sebelum backup lengkap',
        },
        baris: [D('1001', 80_000), K('4005', 80_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(postingLama.ok, postingLama.error).toBe(true);

    const induk = join(env.dir, 'tujuan-restore');
    mkdirSync(induk, { recursive: true });
    env.openQueue.push({ canceled: false, filePaths: [induk] });
    const backup = await env.panggil('backup:lengkap');
    expect(backup.ok, backup.error).toBe(true);
    expect(backup.data.saved).toBe(true);

    // Data aktif berubah setelah backup: jurnal tambahan.
    const postingBaru = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-aud12-baru',
          tanggal: '2026-10-23',
          keterangan: 'Jurnal setelah backup lengkap',
        },
        baris: [D('1001', 20_000), K('4005', 20_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(postingBaru.ok, postingBaru.error).toBe(true);

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
    });
    expect(hasil.data).not.toHaveProperty('jumlahLampiran');
    expect(hasil.data).not.toHaveProperty('preRestoreAttachmentsPath');
    expect(env.setDbCalls).toHaveLength(1);
    expect(env.setDbCalls[0]).toBe(env.db());
    expect(env.db()).not.toBe(dbSebelumRestore);
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
    const dataBaru = JSON.parse(audit.data.rows[0].data_baru_json) as Record<
      string,
      unknown
    >;
    expect(dataBaru).toMatchObject({
      sumber: backup.data.path,
      pre_restore_db: hasil.data.preRestorePath,
    });
    expect(dataBaru).not.toHaveProperty('pre_restore_attachments');
    expect(dataBaru).not.toHaveProperty('jumlahLampiran');

    // Dialog batal = bukan error dan tidak mengubah apa pun.
    const batal = await env.panggil('backup:restore-lengkap');
    expect(batal.ok, batal.error).toBe(true);
    expect(batal.data).toEqual({ restored: false, path: '' });
  });
});

describe('P2-7 — alur create → reverse → tutup → backup → restore', () => {
  it('menjalankan seluruh alur lewat handler saja, tanpa Electron', async () => {
    const env = buatEnv();

    // 1. Posting jurnal: nomor bukti otomatis.
    const posting = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-parkir-2026',
          tanggal: '2026-01-02',
          keterangan: 'Penerimaan parkir uji',
        },
        baris: [D('1001', 100_000), K('4005', 100_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
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
    const posting2025 = await env.panggil(
      'transaksi:posting',
      {
        header: {
          id: 'j-pendapatan-2025',
          tanggal: '2025-03-01',
          keterangan: 'Pendapatan tahun 2025',
          jenis: 'TERIMA',
        },
        baris: [D('1001', 5_000_000), K('4005', 5_000_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
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
    const impor = await env.panggil('backup:import', { konfirmasiRestoreDb: true });
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

    const pendapatan2025 = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-aud21b-2025',
          tanggal: '2025-03-01',
          keterangan: 'Pendapatan 2025',
        },
        baris: [D('1001', 5_000_000), K('4005', 5_000_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(pendapatan2025.ok, pendapatan2025.error).toBe(true);

    const beban2026 = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-aud21b-2026',
          tanggal: '2026-02-01',
          keterangan: 'Beban 2026',
        },
        baris: [D('5004', 1_000_000), K('1001', 1_000_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
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

describe('DB-16d — IPC bayar angsuran pinjaman', () => {
  it('membuat jurnal bayar, menandai lunas, dan menolak bayar ganda/selisih tanpa konfirmasi', async () => {
    const env = buatEnv();
    const saldo = await env.panggil('saldo-awal:posting', {
      tanggal: '2026-01-01',
      saldo: [{ akun_kode: '1001', nominal: 10_000_000 }],
    });
    expect(saldo.ok, saldo.error).toBe(true);

    const jadwal = [1, 2, 3].map((ke) => ({
      ke,
      jatuh_tempo: `2026-0${ke + 1}-01`,
      pokok: ke === 3 ? 4_000_000 : 3_000_000,
      bunga: 100_000,
      catatan: `Angsuran ${ke}`,
    }));
    const simpan = await env.panggil('pinjaman:simpan', {
      mode: 'PENCAIRAN',
      kreditur: 'LPD IPC Bayar',
      tanggal: '2026-01-02',
      akunKas: '1014',
      akunBunga: '5063',
      pokok: 10_000_000,
      tenor: 3,
      angsuran: jadwal,
    });
    expect(simpan.ok, simpan.error).toBe(true);
    const pinjamanId = simpan.data.pinjaman.id as string;
    const angsuran = simpan.data.pinjaman.angsuran as {
      id: number;
      ke: number;
      pokok: number;
      bunga: number;
    }[];

    const bayar = await env.panggil('pinjaman:bayar', {
      pinjamanId,
      angsuranId: angsuran[0].id,
      tanggal: '2026-03-01',
      akunKas: '1014',
      pokok: angsuran[0].pokok,
      bunga: angsuran[0].bunga,
      denda: 50_000,
      catatan: 'Angsuran pertama',
    });
    expect(bayar.ok, bayar.error).toBe(true);
    expect(bayar.data.jurnal).toMatchObject({ jenis: 'HUTANG' });
    expect(bayar.data.rincian).toEqual({
      pokok: 3_000_000,
      bunga: 100_000,
      denda: 50_000,
      kas_keluar: 3_150_000,
    });
    expect(bayar.data.pinjaman).toMatchObject({
      outstanding: 7_000_000,
      total_pokok_dibayar: 3_000_000,
    });
    expect(
      bayar.data.pinjaman.angsuran.find(
        (a: { id: number }) => a.id === angsuran[0].id,
      ),
    ).toMatchObject({ status: 'LUNAS', dibayar: true });

    const detail = await env.panggil('pinjaman:detail', pinjamanId);
    expect(detail.ok, detail.error).toBe(true);
    expect(detail.data.angsuran[0].status).toBe('LUNAS');

    const ganda = await env.panggil('pinjaman:bayar', {
      pinjamanId,
      angsuranId: angsuran[0].id,
      tanggal: '2026-04-01',
      akunKas: '1014',
      pokok: angsuran[0].pokok,
      bunga: angsuran[0].bunga,
    });
    expect(ganda.ok).toBe(false);
    expect(ganda.error).toMatch(/sudah lunas/i);

    const selisih = await env.panggil('pinjaman:bayar', {
      pinjamanId,
      angsuranId: angsuran[1].id,
      tanggal: '2026-04-01',
      akunKas: '1014',
      pokok: 2_500_000,
      bunga: 150_000,
    });
    expect(selisih.ok).toBe(false);
    expect(selisih.perluKonfirmasi).toBe(true);
    expect(selisih.error).toMatch(/berbeda dari jadwal/i);

    const dikonfirmasi = await env.panggil(
      'pinjaman:bayar',
      {
        pinjamanId,
        angsuranId: angsuran[1].id,
        tanggal: '2026-04-01',
        akunKas: '1014',
        pokok: 2_500_000,
        bunga: 150_000,
      },
      {
        konfirmasiSelisih: true,
        alasanSelisih: 'kesepakatan ulang dengan LPD',
      },
    );
    expect(dikonfirmasi.ok, dikonfirmasi.error).toBe(true);
    expect(dikonfirmasi.data.pinjaman.outstanding).toBe(4_500_000);
    expect(
      (await env.panggil('pinjaman:list')).data[0].angsuran[1].status,
    ).toBe('SEBAGIAN');
  });
});

describe('DB-16e — IPC mutasi pinjaman', () => {
  it('menolak pinjaman kosong, periode salah, dan rentang tanggal terbalik', async () => {
    const env = buatEnv();

    const tanpaPinjaman = await env.panggil('pinjaman:mutasi', {});
    expect(tanpaPinjaman.ok).toBe(false);
    expect(tanpaPinjaman.error).toMatch(/pinjaman/i);

    const periodeSalah = await env.panggil('pinjaman:mutasi', {
      pinjamanId: 'pjr-tidak-ada',
      periode: '2026-13',
    });
    expect(periodeSalah.ok).toBe(false);
    expect(periodeSalah.error).toMatch(/YYYY-MM/i);

    const terbalik = await env.panggil('pinjaman:mutasi', {
      pinjamanId: 'pjr-tidak-ada',
      mulai: '2026-12-31',
      sampai: '2026-01-01',
    });
    expect(terbalik.ok).toBe(false);
    expect(terbalik.error).toMatch(/sebelum|setelah/i);

    const tidakAda = await env.panggil('pinjaman:mutasi', {
      pinjamanId: 'pjr-tidak-ada',
      periode: '2026-03',
    });
    expect(tidakAda.ok).toBe(false);
    expect(tidakAda.error).toMatch(/tidak ditemukan/i);
  });
});

describe('DB-16f — IPC rekonsiliasi pinjaman', () => {
  it('mengembalikan daftar kosong dan menolak ID tidak valid/tidak ada', async () => {
    const env = buatEnv();

    const semua = await env.panggil('pinjaman:rekonsiliasi', {});
    expect(semua.ok, semua.error).toBe(true);
    expect(semua.data).toEqual([]);

    const kosong = await env.panggil('pinjaman:rekonsiliasi', { pinjamanId: ' ' });
    expect(kosong.ok).toBe(false);
    expect(kosong.error).toMatch(/pinjaman/i);

    const tipeSalah = await env.panggil('pinjaman:rekonsiliasi', {
      pinjamanId: 123,
    });
    expect(tipeSalah.ok).toBe(false);
    expect(tipeSalah.error).toMatch(/tidak valid/i);

    const tidakAda = await env.panggil('pinjaman:rekonsiliasi', {
      pinjamanId: 'pjr-tidak-ada',
    });
    expect(tidakAda.ok).toBe(false);
    expect(tidakAda.error).toMatch(/tidak ditemukan/i);
  });
});

describe('P2-7 — error handling IPC', () => {
  it('menolak jurnal tidak seimbang sebagai {ok:false}, bukan throw', async () => {
    const env = buatEnv();
    const hasil = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-tidak-seimbang',
          tanggal: '2026-01-02',
          keterangan: 'Uji jurnal tidak seimbang',
        },
        baris: [D('1001', 100_000), K('4005', 90_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );

    expect(hasil.ok).toBe(false);
    expect(hasil.error).toMatch(/tidak seimbang/i);
    expect((await env.panggil('jurnal:list', {})).data).toEqual([]);
  });

  it('menolak kandidat backup sampah dan tetap memakai DB lama', async () => {
    const env = buatEnv();
    const valid = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-aman',
          tanggal: '2026-01-02',
          keterangan: 'Jurnal sebelum restore gagal',
        },
        baris: [D('1001', 50_000), K('4005', 50_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(valid.ok, valid.error).toBe(true);

    const dbLama = env.db();
    const sampah = join(env.dir, 'sampah.db');
    writeFileSync(sampah, 'ini bukan database sqlite');
    env.openQueue.push({ canceled: false, filePaths: [sampah] });
    const impor = await env.panggil('backup:import', { konfirmasiRestoreDb: true });

    expect(impor.ok).toBe(false);
    expect(impor.error).toMatch(/tidak bisa dibaca|rusak/i);
    expect(env.setDbCalls).toHaveLength(1);
    expect(env.setDbCalls[0]).toBe(dbLama);
    expect(env.db()).toBe(dbLama);

    // DB lama masih bisa dibaca & ditulis lewat handler setelah restore gagal.
    const daftar = await env.panggil('jurnal:list', {});
    expect(daftar.data.map((j: { id: string }) => j.id)).toEqual(['j-aman']);

    const lanjut = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-setelah-gagal',
          tanggal: '2026-01-03',
          keterangan: 'Masih bisa menulis setelah restore gagal',
        },
        baris: [D('1001', 25_000), K('4005', 25_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(lanjut.ok, lanjut.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(2);
  });
});

describe('AKT-01 — jurnal:posting mewajibkan saldo awal pertama', () => {
  it('menolak jurnal pertama tanpa konfirmasi dan tidak menulis jurnal/audit', async () => {
    const env = buatEnv();
    const hasil = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-pertama',
        tanggal: '2026-01-02',
        keterangan: 'Jurnal pertama tanpa saldo awal',
      },
      baris: [D('1001', 100_000), K('4005', 100_000)],
    });

    expect(hasil.ok).toBe(false);
    expect(hasil.error).toBe(
      'Belum ada saldo awal. Isi Wizard Saldo Awal dulu, atau konfirmasi mulai tanpa saldo awal.',
    );
    expect(hasil.perluKonfirmasi).toBe(false);
    expect((await env.panggil('jurnal:list', {})).data).toEqual([]);
    expect((await env.panggil('audit:list', {})).data.rows).toEqual([]);
  });

  it('menyimpan jurnal pertama setelah operator mengonfirmasi mulai tanpa saldo awal', async () => {
    const env = buatEnv();
    const hasil = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-pertama',
          tanggal: '2026-01-02',
          keterangan: 'Jurnal pertama tanpa saldo awal',
        },
        baris: [D('1001', 100_000), K('4005', 100_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );

    expect(hasil.ok, hasil.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(1);
  });
});

describe('AKT-02 — IPC utang usaha/panjar ikut mewajibkan saldo awal pertama', () => {
  it('form utang usaha menolak jurnal pertama lalu menerima flag mulai tanpa', async () => {
    const env = buatEnv();
    const req = {
      header: {
        id: 'j-utang-akt02',
        tanggal: '2026-02-01',
        keterangan: 'Catat utang usaha ke Toko Uji AKT-02',
        jenis: 'HUTANG',
      },
      baris: [D('5003', 500_000), K('2060', 500_000)],
    };

    const ditolak = await env.panggil('transaksi:posting', req);
    expect(ditolak.ok).toBe(false);
    expect(ditolak.error).toMatch(/Belum ada saldo awal/);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(0);

    const lanjut = await env.panggil('transaksi:posting', req, {
      konfirmasiTanpaSaldoAwal: true,
    });
    expect(lanjut.ok, lanjut.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(1);
  });

  it('panjar:create menolak jurnal pertama lalu menerima flag mulai tanpa', async () => {
    const env = buatEnv();
    const input = {
      tanggal: '2026-02-01',
      penerima: 'Panitia Uji AKT-02',
      jumlah: 100_000,
      akunKasSumber: '1001',
    };

    const ditolak = await env.panggil('panjar:create', input, undefined, {
      konfirmasiPeringatan: true,
      alasanPeringatan: 'Kas minus disetujui pemilik',
    });
    expect(ditolak.ok).toBe(false);
    expect(ditolak.error).toMatch(/Belum ada saldo awal/);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(0);

    const lanjut = await env.panggil('panjar:create', input, undefined, {
      konfirmasiPeringatan: true,
      alasanPeringatan: 'Kas minus disetujui pemilik',
      konfirmasiTanpaSaldoAwal: true,
    });
    expect(lanjut.ok, lanjut.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(1);
  });
});

describe('DB-03 — jurnal:posting manual hanya UMUM, transaksi:posting untuk form terpandu', () => {
  it('menolak semua jenis dokumen di jalur manual tanpa menulis jurnal/audit', async () => {
    const env = buatEnv();
    const ditolak = [
      'PANJAR',
      'PIUTANG',
      'HUTANG',
      'REVERSAL',
      'SALDO_AWAL',
      'TERIMA',
      'BAYAR',
      'TRANSFER',
    ] as const;

    for (const jenis of ditolak) {
      const hasil = await env.panggil(
        'jurnal:posting',
        {
          header: {
            id: `j-db03-tolak-${jenis}`,
            tanggal: '2026-01-02',
            keterangan: `Jenis ${jenis} tidak boleh lewat Jurnal Umum`,
            jenis,
          },
          baris: [D('1001', 100_000), K('4005', 100_000)],
        },
        { konfirmasiTanpaSaldoAwal: true },
      );
      expect(hasil.ok, jenis).toBe(false);
      expect(hasil.error, jenis).toMatch(/hanya menerima jenis UMUM/i);
      expect(hasil.error, jenis).toContain(jenis);
      expect((await env.panggil('jurnal:list', {})).data, jenis).toEqual([]);
      expect((await env.panggil('audit:list', {})).data.rows, jenis).toEqual([]);
    }

    // Jalur manual tetap menerima UMUM dengan alur lama.
    const manual = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-db03-umum',
          tanggal: '2026-01-02',
          keterangan: 'Jurnal manual UMUM',
          jenis: 'UMUM',
        },
        baris: [D('1001', 100_000), K('4005', 100_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(manual.ok, manual.error).toBe(true);
    expect(manual.data.jurnal).toMatchObject({
      id: 'j-db03-umum',
      jenis: 'UMUM',
      no_bukti: 'JU-2026-0001',
    });
  });

  it('menyimpan Terima/Bayar/Transfer lewat transaksi:posting dengan nomor bukti + audit', async () => {
    const env = buatEnv();

    const terima = await env.panggil(
      'transaksi:posting',
      {
        header: {
          id: 'j-db03-terima',
          tanggal: '2026-01-02',
          keterangan: 'Pendapatan parkir DB-03',
          jenis: 'TERIMA',
        },
        baris: [D('1001', 100_000), K('4005', 100_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(terima.ok, terima.error).toBe(true);
    expect(terima.data.jurnal).toMatchObject({
      id: 'j-db03-terima',
      jenis: 'TERIMA',
      no_bukti: 'JU-2026-0001',
    });

    const bayar = await env.panggil('transaksi:posting', {
      header: {
        id: 'j-db03-bayar',
        tanggal: '2026-01-03',
        keterangan: 'Bayar listrik DB-03',
        jenis: 'BAYAR',
      },
      baris: [D('5010', 40_000), K('1001', 40_000)],
    });
    expect(bayar.ok, bayar.error).toBe(true);
    expect(bayar.data.jurnal).toMatchObject({
      id: 'j-db03-bayar',
      jenis: 'BAYAR',
      no_bukti: 'JU-2026-0002',
    });

    const pindah = await env.panggil('transaksi:posting', {
      header: {
        id: 'j-db03-pindah',
        tanggal: '2026-01-04',
        keterangan: 'Pindah kas DB-03',
        jenis: 'TRANSFER',
      },
      baris: [D('1029', 25_000), K('1001', 25_000)],
    });
    expect(pindah.ok, pindah.error).toBe(true);
    expect(pindah.data.jurnal).toMatchObject({
      id: 'j-db03-pindah',
      jenis: 'TRANSFER',
      no_bukti: 'JU-2026-0003',
    });

    const daftar = await env.panggil('jurnal:list', {});
    expect(daftar.ok, daftar.error).toBe(true);
    expect(daftar.data.map((j: { id: string }) => j.id)).toEqual([
      'j-db03-terima',
      'j-db03-bayar',
      'j-db03-pindah',
    ]);
    for (const jurnal of daftar.data as {
      id: string;
      total_debit: number;
      baris: { debit: number; kredit: number }[];
    }[]) {
      const debit = jurnal.baris.reduce((s, b) => s + b.debit, 0);
      const kredit = jurnal.baris.reduce((s, b) => s + b.kredit, 0);
      expect(debit, jurnal.id).toBe(jurnal.total_debit);
      expect(kredit, jurnal.id).toBe(debit);
      expect(debit, jurnal.id).toBeGreaterThan(0);
    }

    const audit = await env.panggil('audit:list', {});
    expect(audit.ok, audit.error).toBe(true);
    const aksi = (audit.data.rows as { aksi: string }[]).map((a) => a.aksi);
    for (const id of ['j-db03-terima', 'j-db03-bayar', 'j-db03-pindah']) {
      expect(aksi).toContain(`CREATE ${id}`);
    }
  });

  it('menolak UMUM/PANJAR/PIUTANG di transaksi:posting tanpa menulis apa pun', async () => {
    const env = buatEnv();
    for (const jenis of ['UMUM', 'PANJAR', 'PIUTANG'] as const) {
      const hasil = await env.panggil(
        'transaksi:posting',
        {
          header: {
            id: `j-db03-salah-jalur-${jenis}`,
            tanggal: '2026-01-02',
            keterangan: 'Jenis tidak sesuai jalur',
            jenis,
          },
          baris: [D('1001', 100_000), K('4005', 100_000)],
        },
        { konfirmasiTanpaSaldoAwal: true },
      );
      expect(hasil.ok, jenis).toBe(false);
      expect(hasil.error, jenis).toMatch(/hanya menerima jenis/i);
    }
    expect((await env.panggil('jurnal:list', {})).data).toEqual([]);
    expect((await env.panggil('audit:list', {})).data.rows).toEqual([]);
  });
});

describe('AKT-06 — transaksi:posting mewajibkan alasan saat konfirmasi peringatan', () => {
  it('menolak tanpa alasan, menerima dengan alasan, dan audit memuat override', async () => {
    const env = buatEnv();

    const awal = await env.panggil(
      'saldo-awal:posting',
      {
        tanggal: '2026-01-01',
        keterangan: 'Saldo awal AKT-06',
        saldo: [{ akun_kode: '1001', nominal: 100_000 }],
      },
      {},
    );
    expect(awal.ok, awal.error).toBe(true);

    const bayar = {
      header: {
        id: 'j-akt06-bayar',
        tanggal: '2026-01-02',
        keterangan: 'Bayar listrik melebihi kas',
        jenis: 'BAYAR',
      },
      baris: [D('5000', 150_000), K('1001', 150_000)],
    };

    const tanpa = await env.panggil('transaksi:posting', bayar, {
      konfirmasiPeringatan: true,
    });
    expect(tanpa.ok).toBe(false);
    expect(tanpa.error).toMatch(/alasan minimal 5 karakter/i);
    expect(tanpa.perluKonfirmasi).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(1);

    const pendek = await env.panggil('transaksi:posting', bayar, {
      konfirmasiPeringatan: true,
      alasanPeringatan: 'ok',
    });
    expect(pendek.ok).toBe(false);
    expect(pendek.error).toMatch(/alasan minimal 5 karakter/i);
    expect(pendek.perluKonfirmasi).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(1);

    const tersimpan = await env.panggil('transaksi:posting', bayar, {
      konfirmasiPeringatan: true,
      alasanPeringatan: 'Kas minus disetujui pemilik',
    });
    expect(tersimpan.ok, tersimpan.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(2);

    const audit = await env.panggil('audit:list', { aksi: 'CREATE j-akt06-bayar' });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.total).toBe(1);
    const data = JSON.parse(audit.data.rows[0].data_baru_json) as {
      peringatan: string[];
      konfirmasiPeringatan: boolean;
      alasanPeringatan: string;
    };
    expect(data.peringatan).toHaveLength(1);
    expect(data.peringatan.join(' ')).toMatch(/akan minus/);
    expect(data.konfirmasiPeringatan).toBe(true);
    expect(data.alasanPeringatan).toBe('Kas minus disetujui pemilik');
  });
});

describe('AKT-08 — IPC meneruskan alasan override overrun panjar', () => {
  it('panjar:close menolak overrun tanpa alasan dan audit memuat alasanKurang', async () => {
    const env = buatEnv();
    expect(
      (
        await env.panggil(
          'saldo-awal:posting',
          {
            tanggal: '2026-01-01',
            keterangan: 'Saldo awal AKT-08 panjar',
            saldo: [{ akun_kode: '1001', nominal: 1_000_000 }],
          },
          {},
        )
      ).ok,
    ).toBe(true);

    const buat = await env.panggil('panjar:create', {
      tanggal: '2026-01-02',
      penerima: 'Panitia AKT-08',
      jumlah: 200_000,
      akunKasSumber: '1001',
    });
    expect(buat.ok, buat.error).toBe(true);
    const id = buat.data.id as string;
    const close = {
      id,
      tanggalClose: '2026-01-03',
      items: [{ kategori_baga: '5004', nominal: 300_000 }],
      konfirmasiKurang: true,
    };

    const tanpa = await env.panggil('panjar:close', close);
    expect(tanpa.ok).toBe(false);
    expect(tanpa.error).toMatch(/melebihi panjar sebesar/i);
    expect(tanpa.error).toMatch(/alasan minimal 5 karakter/i);
    expect(tanpa.perluKonfirmasi).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(2);

    const alasan = 'Kekurangan panjar disetujui';
    const lanjut = await env.panggil('panjar:close', {
      ...close,
      alasanKurang: alasan,
    });
    expect(lanjut.ok, lanjut.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(3);

    const audit = await env.panggil('audit:list', { aksi: 'PANJAR-CLOSE' });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.total).toBe(1);
    const data = JSON.parse(audit.data.rows[0].data_baru_json) as {
      nominalKurang: number;
      alasanKurang: string;
    };
    expect(data.nominalKurang).toBe(100_000);
    expect(data.alasanKurang).toBe(alasan);
  });
});

describe('DB-21 — IPC pembatalan panjar OPEN', () => {
  it('menolak alasan pendek, membatalkan OPEN, dan mengekspos status DIBATALKAN', async () => {
    const env = buatEnv();
    expect(
      (
        await env.panggil('saldo-awal:posting', {
          tanggal: '2026-01-01',
          keterangan: 'Saldo awal DB-21',
          saldo: [{ akun_kode: '1001', nominal: 1_000_000 }],
        })
      ).ok,
    ).toBe(true);

    const buat = await env.panggil('panjar:create', {
      tanggal: '2026-01-02',
      penerima: 'Panitia DB-21',
      jumlah: 200_000,
      akunKasSumber: '1001',
    });
    expect(buat.ok, buat.error).toBe(true);
    const id = buat.data.id as string;

    const pendek = await env.panggil('panjar:batal', id, 'sala');
    expect(pendek.ok).toBe(false);
    expect(pendek.error).toMatch(/alasan.*minimal 5/i);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(2);

    const kosong = await env.panggil('panjar:batal', '  ', 'Salah serah panjang');
    expect(kosong.ok).toBe(false);
    expect(kosong.error).toMatch(/ID panjar/i);

    const batal = await env.panggil(
      'panjar:batal',
      id,
      'Salah serah ke panitia',
    );
    expect(batal.ok, batal.error).toBe(true);
    expect(batal.data.panjar).toMatchObject({
      id,
      status: 'DIBATALKAN',
      alasan_batal: 'Salah serah ke panitia',
    });
    expect(batal.data.jurnal).toMatchObject({
      jenis: 'REVERSAL',
      reversal_of: buat.data.panjar.jurnal_open_id,
    });

    expect((await env.panggil('panjar:list', 'OPEN')).data).toEqual([]);
    expect((await env.panggil('panjar:list', 'CLOSED')).data).toEqual([]);
    const dibatalkan = await env.panggil('panjar:list', 'DIBATALKAN');
    expect(dibatalkan.ok, dibatalkan.error).toBe(true);
    expect(dibatalkan.data).toHaveLength(1);
    expect(dibatalkan.data[0]).toMatchObject({ id, status: 'DIBATALKAN' });

    const close = await env.panggil('panjar:close', {
      id,
      tanggalClose: '2026-01-03',
      items: [{ kategori_baga: '5004', nominal: 100_000 }],
    });
    expect(close.ok).toBe(false);
    expect(close.error).toMatch(/sudah dibatalkan/i);

    const ulang = await env.panggil('panjar:batal', id, 'Coba batalkan lagi');
    expect(ulang.ok).toBe(false);
    expect(ulang.error).toMatch(/sudah dibatalkan/i);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(3);

    const audit = await env.panggil('audit:list', { aksi: 'PANJAR-BATAL' });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.total).toBe(1);
    const integritas = await env.panggil('audit:integritas');
    expect(integritas.ok, integritas.error).toBe(true);
    expect(integritas.data.ok).toBe(true);
  });
});

describe('AUD2-03 — IPC koreksi pertanggungjawaban panjar CLOSED', () => {
  it('membalik jurnal close, mengosongkan item, lalu mengizinkan close ulang', async () => {
    const env = buatEnv();
    expect(
      (
        await env.panggil('saldo-awal:posting', {
          tanggal: '2026-01-01',
          keterangan: 'Saldo awal AUD2-03',
          saldo: [{ akun_kode: '1001', nominal: 10_000_000 }],
        })
      ).ok,
    ).toBe(true);

    const buat = await env.panggil('panjar:create', {
      tanggal: '2026-01-02',
      penerima: 'Panitia AUD2-03',
      jumlah: 1_000_000,
      akunKasSumber: '1001',
    });
    expect(buat.ok, buat.error).toBe(true);
    const id = buat.data.id as string;

    const close = await env.panggil('panjar:close', {
      id,
      tanggalClose: '2026-01-03',
      items: [
        {
          kategori_baga: '5003',
          nominal: 900_000,
          nota_nomor: 'N-AUD2-03',
          toko: 'Toko Uji',
        },
      ],
    });
    expect(close.ok, close.error).toBe(true);
    const closeId = close.data.panjar.jurnal_close_id as string;

    const pendek = await env.panggil('panjar:batal-close', {
      id,
      alasan: 'sala',
    });
    expect(pendek.ok).toBe(false);
    expect(pendek.error).toMatch(/alasan.*minimal 5/i);

    const koreksi = await env.panggil('panjar:batal-close', {
      id,
      alasan: 'Salah kategori realisasi',
      tanggalBatal: '2026-01-03',
    });
    expect(koreksi.ok, koreksi.error).toBe(true);
    expect(koreksi.data.panjar).toMatchObject({
      id,
      status: 'OPEN',
      tanggal_close: null,
      jurnal_close_id: null,
    });
    expect(koreksi.data.jurnal).toMatchObject({
      jenis: 'REVERSAL',
      reversal_of: closeId,
      tanggal: '2026-01-03',
    });

    expect((await env.panggil('panjar:items', id)).data).toEqual([]);
    const open = await env.panggil('panjar:list', 'OPEN');
    expect(open.data).toHaveLength(1);
    expect(open.data[0]).toMatchObject({ id, status: 'OPEN' });
    expect((await env.panggil('panjar:list', 'CLOSED')).data).toEqual([]);

    const audit = await env.panggil('audit:list', {
      aksi: 'PANJAR-BATAL-CLOSE',
    });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.total).toBe(1);
    expect(audit.data.rows[0].alasan).toBe('Salah kategori realisasi');
    expect(audit.data.rows[0].data_lama_json).toContain('N-AUD2-03');

    const reclose = await env.panggil('panjar:close', {
      id,
      tanggalClose: '2026-01-04',
      items: [{ kategori_baga: '5010', nominal: 800_000 }],
    });
    expect(reclose.ok, reclose.error).toBe(true);
    expect(reclose.data.panjar.status).toBe('CLOSED');

    const integritas = await env.panggil('audit:integritas');
    expect(integritas.ok, integritas.error).toBe(true);
    expect(integritas.data.ok).toBe(true);
  });
});

describe('DB-23b — IPC mencatat utang usaha 2060 tanpa master pihak', () => {
  it('menyimpan catat utang + bayar utang dan tetap membaca 2050 lama', async () => {
    const env = buatEnv();
    expect(
      (
        await env.panggil('saldo-awal:posting', {
          tanggal: '2026-01-01',
          keterangan: 'Saldo awal utang usaha',
          saldo: [{ akun_kode: '1001', nominal: 1_000_000 }],
        })
      ).ok,
    ).toBe(true);

    const catat = await env.panggil('transaksi:posting', {
      header: {
        id: 'j-utang-catat',
        tanggal: '2026-01-02',
        keterangan: 'Beli bahan kredit — Toko Bangunan Jaya',
        jenis: 'HUTANG',
      },
      baris: [D('5003', 300_000), K('2060', 300_000)],
    });
    expect(catat.ok, catat.error).toBe(true);
    expect(catat.data.jurnal.jenis).toBe('HUTANG');
    expect(catat.data.jurnal.keterangan).toContain('Toko Bangunan Jaya');

    const bayar = await env.panggil('transaksi:posting', {
      header: {
        id: 'j-utang-bayar',
        tanggal: '2026-01-03',
        keterangan: 'Bayar utang usaha — Toko Bangunan Jaya',
        jenis: 'HUTANG',
      },
      baris: [D('2060', 200_000), K('1001', 200_000)],
    });
    expect(bayar.ok, bayar.error).toBe(true);

    // AUD2-04: 2050 adalah akun kontrol pinjaman dan tidak boleh diposting
    // lewat Jurnal Umum manual. Pinjaman lama tetap bisa dicatat lewat jalur
    // HUTANG terpandu; tidak ada master pihak baru, jadi tidak ada respons
    // `alur`/`akunPihak`.
    const ditolak = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-pinjam-2050-umum',
        tanggal: '2026-01-04',
        keterangan: 'Terima pinjaman lama — Koperasi Desa',
        jenis: 'UMUM',
      },
      baris: [D('1001', 500_000), K('2050', 500_000)],
    });
    expect(ditolak.ok).toBe(false);
    expect(ditolak.error).toMatch(
      /Akun 2050 HUTANG LAIN-LAIN adalah akun kontrol pinjaman/,
    );

    const pinjam = await env.panggil('transaksi:posting', {
      header: {
        id: 'j-pinjam-2050',
        tanggal: '2026-01-04',
        keterangan: 'Terima pinjaman lama — Koperasi Desa',
        jenis: 'HUTANG',
      },
      baris: [D('1001', 500_000), K('2050', 500_000)],
    });
    expect(pinjam.ok, pinjam.error).toBe(true);
    expect(pinjam.data).not.toHaveProperty('pihak');
    expect(pinjam.data).not.toHaveProperty('alur');

    const bb2060 = await env.panggil('laporan:buku-besar', { akun_kode: '2060' });
    expect(bb2060.ok, bb2060.error).toBe(true);
    expect(bb2060.data.saldoAkhir).toBe(100_000);
    const bb2050 = await env.panggil('laporan:buku-besar', { akun_kode: '2050' });
    expect(bb2050.ok, bb2050.error).toBe(true);
    expect(bb2050.data.saldoAkhir).toBe(500_000);

    // DB-33: tabel metadata pihak sudah dibuang dari skema.
    expect(
      env
        .db()
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'jurnal_pihak'")
        .get(),
    ).toBeUndefined();
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

describe('DB-09 — restore .db wajib konfirmasi lanjutan eksplisit', () => {
  it('menolak tanpa konfirmasi sebelum dialog, lalu berhasil saat dikonfirmasi', async () => {
    const env = buatEnv();
    const awal = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-db09-awal',
          tanggal: '2026-10-30',
          keterangan: 'Jurnal sebelum backup .db',
        },
        baris: [D('1001', 100_000), K('4007', 100_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(awal.ok, awal.error).toBe(true);

    const backupPath = join(env.dir, 'backup-db09.db');
    env.saveQueue.push({ canceled: false, filePath: backupPath });
    expect((await env.panggil('backup:export')).ok).toBe(true);

    const tambahan = await env.panggil(
      'jurnal:posting',
      {
        header: {
          id: 'j-db09-tambahan',
          tanggal: '2026-10-30',
          keterangan: 'Jurnal setelah backup .db',
        },
        baris: [D('1001', 25_000), K('4007', 25_000)],
      },
      { konfirmasiTanpaSaldoAwal: true },
    );
    expect(tambahan.ok, tambahan.error).toBe(true);

    const dbSebelum = env.db();
    env.openQueue.push({ canceled: false, filePaths: [backupPath] });

    const tanpaKonfirmasi = await env.panggil('backup:import');
    expect(tanpaKonfirmasi.ok).toBe(false);
    expect(tanpaKonfirmasi.perluKonfirmasi).toBe(true);
    expect(tanpaKonfirmasi.error).toMatch(/hanya memulihkan database/i);
    expect(tanpaKonfirmasi.error).toMatch(/manifest\.json/i);
    expect(tanpaKonfirmasi.error).toMatch(/Restore Lengkap/i);
    // Gate terjadi sebelum dialog: antrean dialog masih utuh dan DB belum diganti.
    expect(env.openQueue).toHaveLength(1);
    expect(env.setDbCalls).toHaveLength(0);
    expect(env.db()).toBe(dbSebelum);

    const hasil = await env.panggil('backup:import', {
      konfirmasiRestoreDb: true,
    });
    expect(hasil.ok, hasil.error).toBe(true);
    expect(hasil.data).toMatchObject({ restored: true });
    expect(env.setDbCalls).toHaveLength(1);
    expect((await env.panggil('jurnal:list', {})).data.map((j: { id: string }) => j.id)).toEqual([
      'j-db09-awal',
    ]);
  });
});

describe('DB-16c — IPC pinjaman LPD', () => {
  it('menyimpan pencairan, membaca list/detail, dan menolak input tidak sah', async () => {
    const env = buatEnv();
    const saldo = await env.panggil('saldo-awal:posting', {
      tanggal: '2026-01-01',
      saldo: [{ akun_kode: '1001', nominal: 10_000_000 }],
    });
    expect(saldo.ok, saldo.error).toBe(true);

    const jadwal = [1, 2, 3].map((ke) => ({
      ke,
      jatuh_tempo: `2026-0${ke + 1}-01`,
      pokok: ke === 3 ? 4_000_000 : 3_000_000,
      bunga: 100_000,
      catatan: `Angsuran ${ke}`,
    }));
    const input = {
      mode: 'PENCAIRAN',
      kreditur: 'LPD IPC',
      tanggal: '2026-01-02',
      akunKas: '1014',
      akunBunga: '5063',
      pokok: 10_000_000,
      tenor: 3,
      angsuran: jadwal,
    };

    const simpan = await env.panggil('pinjaman:simpan', input);
    expect(simpan.ok, simpan.error).toBe(true);
    expect(simpan.data.pinjaman).toMatchObject({
      kreditur: 'LPD IPC',
      pokok_awal: 10_000_000,
      sisa_pokok_awal: 10_000_000,
    });
    expect(simpan.data.jurnal).toMatchObject({ jenis: 'HUTANG' });
    expect(simpan.data.pinjaman.jurnal_pencairan_id).toBe(simpan.data.jurnal.id);

    const daftar = await env.panggil('pinjaman:list');
    expect(daftar.ok, daftar.error).toBe(true);
    expect(daftar.data).toHaveLength(1);
    expect(daftar.data[0].angsuran).toHaveLength(3);

    const detail = await env.panggil('pinjaman:detail', simpan.data.pinjaman.id);
    expect(detail.ok, detail.error).toBe(true);
    expect(detail.data.id).toBe(simpan.data.pinjaman.id);
    expect((await env.panggil('pinjaman:detail', 'tidak-ada')).ok).toBe(false);

    const modeSalah = await env.panggil('pinjaman:simpan', {
      ...input,
      mode: 'SALAH',
    });
    expect(modeSalah.ok).toBe(false);
    expect(modeSalah.error).toMatch(/mode pinjaman/i);

    const akunSalah = await env.panggil('pinjaman:simpan', {
      ...input,
      mode: 'BERJALAN',
      id: 'pjr-akun-salah',
      sisaPokok: 1_000_000,
      akunKas: '2050',
      angsuran: [
        { ke: 1, jatuh_tempo: '2026-02-01', pokok: 1_000_000, bunga: 0 },
      ],    });
    expect(akunSalah.ok).toBe(false);
    expect(akunSalah.error).toMatch(/akun kas/i);
    expect((await env.panggil('pinjaman:list')).data).toHaveLength(1);
  });

  it('DB-16g: pembayaran sebagian, pembatalan beralasan, dan pembatalan pencairan', async () => {
    const env = buatEnv();
    const saldo = await env.panggil('saldo-awal:posting', {
      tanggal: '2026-01-01',
      saldo: [{ akun_kode: '1001', nominal: 10_000_000 }],
    });
    expect(saldo.ok, saldo.error).toBe(true);
    const simpan = await env.panggil('pinjaman:simpan', {
      mode: 'PENCAIRAN',
      kreditur: 'LPD IPC Koreksi',
      tanggal: '2026-01-02',
      akunKas: '1014',
      akunBunga: '5063',
      pokok: 5_000_000,
      angsuran: [
        { ke: 1, jatuh_tempo: '2026-02-01', pokok: 5_000_000, bunga: 100_000 },
      ],
    });
    expect(simpan.ok, simpan.error).toBe(true);
    const p = simpan.data.pinjaman;
    const angsuran = p.angsuran[0];

    const setupPin = await env.panggil('lock:setup', '123456');
    expect(setupPin.ok, setupPin.error).toBe(true);
    sesi.terbuka = false;
    const terkunci = await env.panggil('pinjaman:bayar-batal', {
      id: 'bayar-belum-ada',
      alasan: 'alasan cukup panjang',
    });
    sesi.terbuka = true;
    expect(terkunci.ok).toBe(false);
    expect(terkunci.error).toMatch(/terkunci/i);

    const bayar = await env.panggil('pinjaman:bayar', {
      pinjamanId: p.id,
      angsuranId: angsuran.id,
      tanggal: '2026-02-01',
      akunKas: '1014',
      pokok: 2_000_000,
      bunga: 40_000,
    });
    expect(bayar.ok, bayar.error).toBe(true);
    expect(bayar.data.pinjaman.angsuran[0]).toMatchObject({
      status: 'SEBAGIAN',
      dibayar: false,
      pokok_dibayar: 2_000_000,
      bunga_dibayar: 40_000,
      sisa_pokok: 3_000_000,
      sisa_bunga: 60_000,
    });

    const daftarSebelumBatal = await env.panggil('pinjaman:pembayaran', p.id);
    expect(daftarSebelumBatal.ok, daftarSebelumBatal.error).toBe(true);
    expect(daftarSebelumBatal.data).toHaveLength(1);
    const pembayaran = daftarSebelumBatal.data[0];

    const alasanKosong = await env.panggil('pinjaman:bayar-batal', {
      id: pembayaran.id,
      alasan: '   ',
    });
    expect(alasanKosong.ok).toBe(false);
    expect(alasanKosong.error).toMatch(/alasan.*minimal 5/i);

    const belumBolehBatalPencairan = await env.panggil('pinjaman:batal', {
      id: p.id,
      alasan: 'pencatatan keliru',
    });
    expect(belumBolehBatalPencairan.ok).toBe(false);
    expect(belumBolehBatalPencairan.error).toMatch(/pembayaran.*aktif/i);

    const batalBayar = await env.panggil('pinjaman:bayar-batal', {
      id: pembayaran.id,
      alasan: 'salah input pembayaran',
      propertiTidakDikenal: 'harus diabaikan',
    });
    expect(batalBayar.ok, batalBayar.error).toBe(true);
    expect(batalBayar.data.pembayaran).toMatchObject({
      id: pembayaran.id,
      dibatalkan: true,
      jurnal_batal_id: batalBayar.data.jurnal.id,
    });
    expect(
      env.db()
        .prepare('SELECT COUNT(*) AS n FROM jurnal WHERE id = ?')
        .get(pembayaran.jurnal_id),
    ).toMatchObject({ n: 1 });

    const sesudahBatalBayar = await env.panggil('pinjaman:detail', p.id);
    expect(sesudahBatalBayar.data.angsuran[0]).toMatchObject({
      status: 'BELUM',
      dibayar: false,
      sisa_pokok: 5_000_000,
      sisa_bunga: 100_000,
    });
    const daftarSesudahBatal = await env.panggil('pinjaman:pembayaran', p.id);
    expect(daftarSesudahBatal.data[0].dibatalkan).toBe(true);

    const batalPencairan = await env.panggil('pinjaman:batal', {
      id: p.id,
      alasan: 'pencatatan pencairan keliru',
    });
    expect(batalPencairan.ok, batalPencairan.error).toBe(true);
    expect(batalPencairan.data.pinjaman).toMatchObject({
      id: p.id,
      status: 'DIBATALKAN',
      jurnal_batal_id: batalPencairan.data.jurnal.id,
      outstanding: 0,
    });
  });
});

describe('AUD2-07 — IPC panjar/pinjaman mewajibkan alasan peringatan', () => {
  it('panjar:create menolak tanpa/pendek alasan, menerima alasan valid, dan audit memuatnya', async () => {
    const env = buatEnv();
    const awal = await env.panggil('saldo-awal:posting', {
      tanggal: '2026-01-01',
      saldo: [{ akun_kode: '1001', nominal: 100_000 }],
    });
    expect(awal.ok, awal.error).toBe(true);

    const input = {
      tanggal: '2026-01-02',
      penerima: 'Panitia AUD2-07',
      jumlah: 150_000,
      akunKasSumber: '1001',
    };

    const belum = await env.panggil('panjar:create', input);
    expect(belum.ok).toBe(false);
    expect(belum.perluKonfirmasi).toBe(true);
    expect(belum.error).toMatch(/akan minus/);

    for (const alasanPeringatan of [undefined, '', '   ', 'ok']) {
      const ditolak = await env.panggil('panjar:create', input, undefined, {
        konfirmasiPeringatan: true,
        ...(alasanPeringatan === undefined ? {} : { alasanPeringatan }),
      });
      expect(ditolak.ok, String(alasanPeringatan)).toBe(false);
      expect(ditolak.error).toMatch(/alasan minimal 5 karakter/i);
      expect(ditolak.perluKonfirmasi).toBe(true);
    }
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(1);

    const alasan = 'Kas minus disetujui pemilik';
    const tersimpan = await env.panggil('panjar:create', input, undefined, {
      konfirmasiPeringatan: true,
      alasanPeringatan: alasan,
    });
    expect(tersimpan.ok, tersimpan.error).toBe(true);
    expect((await env.panggil('jurnal:list', {})).data).toHaveLength(2);

    const audit = await env.panggil('audit:list', { aksi: 'PANJAR-OPEN' });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.total).toBe(1);
    const data = JSON.parse(audit.data.rows[0].data_baru_json) as {
      alasanPeringatan?: string;
    };
    expect(data.alasanPeringatan).toBe(alasan);
  });

  it('pinjaman:simpan menolak tanpa/pendek alasan, menerima alasan valid, dan audit memuatnya', async () => {
    const env = buatEnv();
    const awal = await env.panggil('saldo-awal:posting', {
      tanggal: '2026-01-01',
      saldo: [{ akun_kode: '1001', nominal: 100_000 }],
    });
    expect(awal.ok, awal.error).toBe(true);
    const keluar = await env.panggil(
      'transaksi:posting',
      {
        header: {
          id: 'j-aud2-07-minus',
          tanggal: '2026-01-02',
          keterangan: 'Buat kas minus untuk AUD2-07',
          jenis: 'BAYAR',
        },
        baris: [D('5000', 200_000), K('1001', 200_000)],
      },
      { konfirmasiPeringatan: true, alasanPeringatan: 'Kas minus disetujui pemilik' },
    );
    expect(keluar.ok, keluar.error).toBe(true);

    const input = {
      mode: 'PENCAIRAN',
      kreditur: 'LPD AUD2-07',
      tanggal: '2026-01-03',
      akunKas: '1001',
      akunBunga: '5063',
      pokok: 50_000,
      tenor: 1,
      angsuran: [
        { ke: 1, jatuh_tempo: '2026-02-01', pokok: 50_000, bunga: 0, catatan: '' },
      ],
    };

    const belum = await env.panggil('pinjaman:simpan', input);
    expect(belum.ok).toBe(false);
    expect(belum.perluKonfirmasi).toBe(true);
    expect(belum.error).toMatch(/akan minus/);

    for (const alasanPeringatan of [undefined, '', '   ', 'ok']) {
      const ditolak = await env.panggil('pinjaman:simpan', input, {
        konfirmasiPeringatan: true,
        ...(alasanPeringatan === undefined ? {} : { alasanPeringatan }),
      });
      expect(ditolak.ok, String(alasanPeringatan)).toBe(false);
      expect(ditolak.error).toMatch(/alasan minimal 5 karakter/i);
      expect(ditolak.perluKonfirmasi).toBe(true);
    }

    const alasan = 'Kas minus disetujui pemilik';
    const tersimpan = await env.panggil('pinjaman:simpan', input, {
      konfirmasiPeringatan: true,
      alasanPeringatan: alasan,
    });
    expect(tersimpan.ok, tersimpan.error).toBe(true);
    const jurnalId = tersimpan.data.jurnal.id as string;

    const audit = await env.panggil('audit:list', { aksi: `CREATE ${jurnalId}` });
    expect(audit.ok, audit.error).toBe(true);
    expect(audit.data.total).toBe(1);
    const data = JSON.parse(audit.data.rows[0].data_baru_json) as {
      peringatan: string[];
      alasanPeringatan?: string;
    };
    expect(data.peringatan.join(' ')).toMatch(/akan minus/);
    expect(data.alasanPeringatan).toBe(alasan);
  });
});

describe('AUD2-01 — IPC laporan, kunci periode, dan saldo awal memakai akun DB', () => {
  it('akun 5011/1101 tambahan lolos Buku Besar, Saldo Awal, Kunci Periode, dan riwayat tutup', async () => {
    const env = buatEnv();

    const beban = await env.panggil('akun:tambah', {
      kode: '5011',
      nama: 'PENGELUARAN ARTOS',
      tipe: 'BEBAN',
    });
    expect(beban.ok, beban.error).toBe(true);
    const bank = await env.panggil('akun:tambah', {
      kode: '1101',
      nama: 'BANK BPD REKENING BARU',
      tipe: 'AKTIVA',
      is_kas: true,
      kelompok: 'BANK',
    });
    expect(bank.ok, bank.error).toBe(true);

    // Akun bank TAMBAHAN harus lolos builder Saldo Awal di main, bukan COA statis.
    const saldo = await env.panggil('saldo-awal:posting', {
      tanggal: '2025-01-01',
      saldo: [{ akun_kode: '1101', nominal: 10_000_000 }],
    });
    expect(saldo.ok, saldo.error).toBe(true);

    const posting = await env.panggil('jurnal:posting', {
      header: {
        id: 'j-aud2-01',
        tanggal: '2025-02-01',
        keterangan: 'Uji akun beban tambahan',
        jenis: 'UMUM',
      },
      baris: [D('5011', 250_000), K('1101', 250_000)],
    });
    expect(posting.ok, posting.error).toBe(true);

    const bukuBesar = await env.panggil('laporan:buku-besar', {
      akun_kode: '5011',
      sampai: '2025-12-31',
    });
    expect(bukuBesar.ok, bukuBesar.error).toBe(true);
    expect(bukuBesar.data).toMatchObject({
      kode: '5011',
      nama: 'PENGELUARAN ARTOS',
      totalDebit: 250_000,
      saldoAkhir: 250_000,
    });

    const pratinjau = await env.panggil('tutup:preview', 2025);
    expect(pratinjau.ok, pratinjau.error).toBe(true);
    expect(pratinjau.data).toMatchObject({
      tahun: 2025,
      boleh: true,
      laba: -250_000,
      labaDitahanSekarang: 0,
      sudahDitutup: false,
    });

    const tutup = await env.panggil('tutup:create', {
      tahun: 2025,
      catatan: 'Uji AUD2-01',
    });
    expect(tutup.ok, tutup.error).toBe(true);
    expect(tutup.data).toMatchObject({
      tahun: 2025,
      aksi: 'TUTUP',
      laba: -250_000,
    });

    const riwayat = await env.panggil('tutup:list');
    expect(riwayat.ok, riwayat.error).toBe(true);
    expect(riwayat.data).toHaveLength(1);
    expect(riwayat.data[0]).toMatchObject({ tahun: 2025, laba: -250_000 });
  });
});
