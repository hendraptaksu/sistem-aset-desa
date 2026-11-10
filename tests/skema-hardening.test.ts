// T2.5 — Uji hardening skema v1 (CHECK/trigger T2.1–T2.4).
//
// Setiap kasus di bawah harus GAGAL bila CHECK/trigger yang diuji dihapus dari
// `src/db/database.ts`: baris yang seharusnya ditolak akan tersimpan tanpa
// error sehingga `expect(...).toThrow()` tidak terpenuhi.
//
// Trigger `jurnal` immutable hanya melarang UPDATE/DELETE, jadi fixture jurnal
// boleh memakai INSERT langsung seperti di sini.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  objekSkemaTidakSesuai,
  openDb,
  PESAN_JENIS_PENGGANTI_JURNAL_DB,
  PESAN_REVERSAL_JURNAL_DB,
  PESAN_TANGGAL_KALENDER_JURNAL_DB,
} from '../src/db/database.js';

const WAKTU = '2026-01-01T00:00:00.000Z';

let db: Database.Database;

const dirs: string[] = [];

function dirBaru(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-skema-hardening-'));
  dirs.push(dir);
  return dir;
}

/** Buka file DB mentah (tanpa `openDb`) lalu tutup rapi. */
function buatDbMentah(path: string, isi: (raw: Database.Database) => void): void {
  const raw = new Database(path);
  try {
    isi(raw);
  } finally {
    raw.close();
  }
}

beforeEach(() => {
  db = openDb(':memory:');
});

afterEach(() => {
  db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type JurnalInput = {
  id: string;
  tanggal?: string;
  no_bukti?: string;
  keterangan?: string;
  jenis?: string;
  peran?: string;
  grup_id?: string;
  reversal_of?: string | null;
  replaces_id?: string | null;
  created_at?: string;
};

/** INSERT jurnal yang valid kecuali field yang sengaja di-override. */
function insertJurnal(input: JurnalInput): string {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, peran, grup_id,
        reversal_of, replaces_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.tanggal ?? '2026-01-02',
    input.no_bukti ?? '',
    input.keterangan ?? `Jurnal ${input.id}`,
    input.jenis ?? 'UMUM',
    input.peran ?? 'NORMAL',
    input.grup_id ?? input.id,
    input.reversal_of ?? null,
    input.replaces_id ?? null,
    input.created_at ?? WAKTU,
  );
  return input.id;
}

type PanjarInput = {
  id: string;
  status?: 'OPEN' | 'CLOSED' | 'DIBATALKAN';
  jurnal_open_id: string;
  jurnal_close_id?: string | null;
  jurnal_batal_id?: string | null;
  tanggal_batal?: string | null;
  alasan_batal?: string;
  tanggal?: string;
  penerima?: string;
  jumlah?: number;
  akun_kas_sumber?: string;
  created_at?: string;
};

/** INSERT panjar dengan FK yang sudah dipenuhi lewat jurnal fixture. */
function insertPanjar(input: PanjarInput): string {
  db.prepare(
    `INSERT INTO panjar
       (id, tanggal, penerima, jumlah, akun_kas_sumber, status, tanggal_close,
        jurnal_open_id, jurnal_close_id, created_at, jurnal_batal_id,
        tanggal_batal, alasan_batal)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.tanggal ?? '2026-01-02',
    input.penerima ?? 'Penerima Uji',
    input.jumlah ?? 100_000,
    input.akun_kas_sumber ?? '1001',
    input.status ?? 'OPEN',
    null,
    input.jurnal_open_id,
    input.jurnal_close_id ?? null,
    input.created_at ?? WAKTU,
    input.jurnal_batal_id ?? null,
    input.tanggal_batal ?? null,
    input.alasan_batal ?? '',
  );
  return input.id;
}

type PinjamanInput = {
  id: string;
  pokok_awal?: number;
  sisa_pokok_awal?: number;
  akun_kas?: string;
  akun_bunga?: string;
  tanggal_mulai?: string;
  created_at?: string;
};

/** INSERT pinjaman dengan akun kas/bunga yang ada di seed COA. */
function insertPinjaman(input: PinjamanInput): string {
  db.prepare(
    `INSERT INTO pinjaman
       (id, kreditur, akun_kas, akun_bunga, pokok_awal, sisa_pokok_awal,
        tanggal_mulai, tenor_bulan, jurnal_pencairan_id, catatan, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, '', ?)`,
  ).run(
    input.id,
    'Kreditur Uji',
    input.akun_kas ?? '1001',
    input.akun_bunga ?? '5063',
    input.pokok_awal ?? 1_000_000,
    input.sisa_pokok_awal ?? 1_000_000,
    input.tanggal_mulai ?? '2026-01-02',
    input.created_at ?? WAKTU,
  );
  return input.id;
}

type AkunInput = {
  kode: string;
  nama: string;
  tipe?: string;
  posisi_normal?: string;
  aktif?: number;
  is_kas?: number;
  kelompok?: string;
  sumber?: string;
};

function insertAkun(input: AkunInput): string {
  db.prepare(
    `INSERT INTO akun
       (kode, nama, tipe, posisi_normal, aktif, is_kas, kelompok, sumber)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.kode,
    input.nama,
    input.tipe ?? 'AKTIVA',
    input.posisi_normal ?? 'DEBIT',
    input.aktif ?? 1,
    input.is_kas ?? 0,
    input.kelompok ?? '',
    input.sumber ?? 'TAMBAHAN',
  );
  return input.kode;
}

describe('T2.1 — CHECK konsistensi status panjar', () => {
  it('OPEN menolak jurnal_close_id yang terisi', () => {
    const open = insertJurnal({ id: 'j-open' });
    const close = insertJurnal({ id: 'j-close' });

    expect(() =>
      insertPanjar({
        id: 'p-open-salah',
        status: 'OPEN',
        jurnal_open_id: open,
        jurnal_close_id: close,
      }),
    ).toThrow();
  });

  it('CLOSED menolak tanpa jurnal_close_id', () => {
    const open = insertJurnal({ id: 'j-open' });

    expect(() =>
      insertPanjar({
        id: 'p-closed-salah',
        status: 'CLOSED',
        jurnal_open_id: open,
        jurnal_close_id: null,
      }),
    ).toThrow();
  });

  it('DIBATALKAN menolak alasan_batal kurang dari 5 karakter', () => {
    const open = insertJurnal({ id: 'j-open' });
    const batal = insertJurnal({ id: 'j-batal' });

    expect(() =>
      insertPanjar({
        id: 'p-batal-alasan-pendek',
        status: 'DIBATALKAN',
        jurnal_open_id: open,
        jurnal_batal_id: batal,
        tanggal_batal: '2026-01-03',
        alasan_batal: 'abc',
      }),
    ).toThrow();
  });

  it('DIBATALKAN lengkap (jurnal, tanggal, alasan >= 5) diterima', () => {
    const open = insertJurnal({ id: 'j-open' });
    const batal = insertJurnal({ id: 'j-batal' });

    const id = insertPanjar({
      id: 'p-batal-lengkap',
      status: 'DIBATALKAN',
      jurnal_open_id: open,
      jurnal_batal_id: batal,
      tanggal_batal: '2026-01-03',
      alasan_batal: 'salah input',
    });

    expect(
      db
        .prepare('SELECT status, alasan_batal FROM panjar WHERE id = ?')
        .get(id),
    ).toEqual({ status: 'DIBATALKAN', alasan_batal: 'salah input' });
  });

  it('OPEN normal diterima', () => {
    const open = insertJurnal({ id: 'j-open' });

    const id = insertPanjar({ id: 'p-open-benar', status: 'OPEN', jurnal_open_id: open });

    expect(
      db.prepare('SELECT status, jurnal_close_id, jurnal_batal_id FROM panjar WHERE id = ?').get(id),
    ).toEqual({ status: 'OPEN', jurnal_close_id: null, jurnal_batal_id: null });
  });
});

describe('T2.2 — CHECK pinjaman dan tutup buku', () => {
  it('pinjaman menolak sisa_pokok_awal lebih besar dari pokok_awal', () => {
    expect(() =>
      insertPinjaman({
        id: 'pin-salah',
        pokok_awal: 1_000_000,
        sisa_pokok_awal: 1_000_001,
      }),
    ).toThrow();
  });

  it('pinjaman dengan sisa_pokok_awal <= pokok_awal diterima', () => {
    const id = insertPinjaman({
      id: 'pin-benar',
      pokok_awal: 1_000_000,
      sisa_pokok_awal: 750_000,
    });

    expect(
      db
        .prepare('SELECT pokok_awal, sisa_pokok_awal FROM pinjaman WHERE id = ?')
        .get(id),
    ).toEqual({ pokok_awal: 1_000_000, sisa_pokok_awal: 750_000 });
  });

  it('tutup buku menolak tahun 1899 dan 10000, menerima 2026', () => {
    const insertTutup = db.prepare(
      'INSERT INTO tutup_buku (tahun, created_at, catatan) VALUES (?, ?, ?)',
    );

    expect(() => insertTutup.run(1899, WAKTU, '')).toThrow();
    expect(() => insertTutup.run(10_000, WAKTU, '')).toThrow();

    insertTutup.run(2026, WAKTU, 'tahun uji');
    expect(
      db.prepare('SELECT tahun, catatan FROM tutup_buku WHERE tahun = ?').get(2026),
    ).toEqual({ tahun: 2026, catatan: 'tahun uji' });
  });
});

describe('T2.3 — validasi tanggal dan reversal di trigger jurnal', () => {
  it('menolak tanggal yang formatnya benar tetapi bukan tanggal kalender', () => {
    expect(() => insertJurnal({ id: 'j-tgl-palsu', tanggal: '2026-02-30' })).toThrow(
      PESAN_TANGGAL_KALENDER_JURNAL_DB,
    );
  });

  it('menolak jenis REVERSAL tanpa reversal_of', () => {
    expect(() => insertJurnal({ id: 'j-reversal-tanpa-asal', jenis: 'REVERSAL' })).toThrow(
      PESAN_REVERSAL_JURNAL_DB,
    );
  });

  it('menolak jenis UMUM yang mengisi reversal_of', () => {
    const asli = insertJurnal({ id: 'j-asli' });

    expect(() =>
      insertJurnal({ id: 'j-umum-dengan-reversal', jenis: 'UMUM', reversal_of: asli }),
    ).toThrow(PESAN_REVERSAL_JURNAL_DB);
  });

  it('menerima jurnal valid dan REVERSAL valid yang menunjuk jurnal lain', () => {
    const asli = insertJurnal({ id: 'j-asli' });
    const balik = insertJurnal({
      id: 'j-balik',
      jenis: 'REVERSAL',
      reversal_of: asli,
      grup_id: asli,
    });

    expect(
      db.prepare('SELECT id, jenis, reversal_of FROM jurnal ORDER BY id').all(),
    ).toEqual([
      { id: 'j-asli', jenis: 'UMUM', reversal_of: null },
      { id: 'j-balik', jenis: 'REVERSAL', reversal_of: asli },
    ]);
    expect(balik).toBe('j-balik');
  });
});

describe('T-A02 — trigger menolak pengganti yang mengubah jenis', () => {
  it('menolak insert langsung pengganti berjenis berbeda dari jurnal asli', () => {
    const asli = insertJurnal({ id: 'j-bayar-asli', jenis: 'BAYAR' });

    expect(() =>
      insertJurnal({
        id: 'j-bayar-jadi-panjar',
        jenis: 'PANJAR',
        peran: 'ADJUSTMENT',
        replaces_id: asli,
      }),
    ).toThrow(PESAN_JENIS_PENGGANTI_JURNAL_DB);

    expect(
      db.prepare('SELECT COUNT(*) AS n FROM jurnal WHERE replaces_id IS NOT NULL').get(),
    ).toEqual({ n: 0 });
  });

  it('menerima pengganti berjenis sama dan SALDO_AWAL → UMUM lewat OPENING_REPLACEMENT', () => {
    const bayar = insertJurnal({ id: 'j-bayar-asli', jenis: 'BAYAR' });
    insertJurnal({
      id: 'j-bayar-pengganti',
      jenis: 'BAYAR',
      peran: 'ADJUSTMENT',
      replaces_id: bayar,
    });

    const awal = insertJurnal({ id: 'j-saldo-awal', jenis: 'SALDO_AWAL', peran: 'OPENING' });
    insertJurnal({
      id: 'j-saldo-awal-pengganti',
      jenis: 'UMUM',
      peran: 'OPENING_REPLACEMENT',
      replaces_id: awal,
    });

    expect(
      db
        .prepare('SELECT id, jenis, peran, replaces_id FROM jurnal WHERE replaces_id IS NOT NULL ORDER BY id')
        .all(),
    ).toEqual([
      { id: 'j-bayar-pengganti', jenis: 'BAYAR', peran: 'ADJUSTMENT', replaces_id: bayar },
      {
        id: 'j-saldo-awal-pengganti',
        jenis: 'UMUM',
        peran: 'OPENING_REPLACEMENT',
        replaces_id: awal,
      },
    ]);
  });
});

describe('T2.4 — CHECK metadata akun', () => {
  it('menolak sumber di luar BAWAAN/TAMBAHAN', () => {
    expect(() =>
      insertAkun({
        kode: '9901',
        nama: 'Akun Sumber Liar',
        sumber: 'LIAR',
      }),
    ).toThrow();
  });

  it('menolak kelompok di luar daftar resmi', () => {
    expect(() =>
      insertAkun({
        kode: '9902',
        nama: 'Akun Kelompok Liar',
        kelompok: 'LIAR',
        sumber: 'TAMBAHAN',
      }),
    ).toThrow();
  });

  it('menerima akun TAMBAHAN dengan kelompok BANK', () => {
    const kode = insertAkun({
      kode: '9903',
      nama: 'Bank Uji T2.5',
      tipe: 'AKTIVA',
      posisi_normal: 'DEBIT',
      kelompok: 'BANK',
      sumber: 'TAMBAHAN',
    });

    expect(
      db
        .prepare('SELECT sumber, kelompok, nama FROM akun WHERE kode = ?')
        .get(kode),
    ).toEqual({ sumber: 'TAMBAHAN', kelompok: 'BANK', nama: 'Bank Uji T2.5' });
  });
});

describe('T3.6 — self-check definisi index/trigger', () => {
  it('memulihkan trigger jurnal immutable yang di-drop dan aturan tetap aktif', () => {
    const path = join(dirBaru(), 'pura.db');

    const awal = openDb(path);
    awal
      .prepare(
        `INSERT INTO jurnal
           (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('j-uji', '2026-01-02', '', 'Jurnal uji T3.6', 'UMUM', 'g-uji', null, WAKTU);
    awal.close();

    // Tiru DB rusak: trigger hilang dari file.
    buatDbMentah(path, (raw) => {
      raw.exec('DROP TRIGGER trg_jurnal_immutable_update');
    });

    const db2 = openDb(path);
    try {
      expect(
        db2
          .prepare(
            "SELECT 1 AS ada FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_jurnal_immutable_update'",
          )
          .get(),
      ).toEqual({ ada: 1 });
      expect(() =>
        db2.prepare("UPDATE jurnal SET keterangan = 'diubah' WHERE id = 'j-uji'").run(),
      ).toThrow(/tidak boleh diubah/i);
    } finally {
      db2.close();
    }
  });

  it('memulihkan index aplikasi yang di-drop', () => {
    const path = join(dirBaru(), 'pura.db');
    openDb(path).close();

    buatDbMentah(path, (raw) => {
      raw.exec('DROP INDEX idx_jurnal_tanggal');
    });

    const db2 = openDb(path);
    try {
      const baris = db2
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_tanggal'")
        .get() as { sql: string } | undefined;
      expect(baris?.sql.toLowerCase()).toContain('on jurnal(tanggal)');
      expect(objekSkemaTidakSesuai(db2)).toEqual([]);
    } finally {
      db2.close();
    }
  });

  it('mendeteksi index dengan definisi salah lalu memperbaikinya saat openDb', () => {
    const path = join(dirBaru(), 'pura.db');
    openDb(path).close();

    // Tiru index bernama sama tetapi definisi salah.
    buatDbMentah(path, (raw) => {
      raw.exec('DROP INDEX idx_jurnal_tanggal');
      raw.exec('CREATE INDEX idx_jurnal_tanggal ON jurnal(keterangan)');
    });

    const raw = new Database(path);
    try {
      expect(objekSkemaTidakSesuai(raw)).toContain('idx_jurnal_tanggal');
    } finally {
      raw.close();
    }

    const db2 = openDb(path);
    try {
      const baris = db2
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_tanggal'")
        .get() as { sql: string } | undefined;
      const sql = baris?.sql.toLowerCase() ?? '';
      expect(sql).toContain('on jurnal(tanggal)');
      expect(sql).not.toContain('keterangan');
      expect(objekSkemaTidakSesuai(db2)).toEqual([]);
    } finally {
      db2.close();
    }
  });

  it('DB valid tidak melaporkan objek skema tidak sesuai dan tetap bisa dibuka', () => {
    const path = join(dirBaru(), 'pura.db');

    const awal = openDb(path);
    try {
      expect(objekSkemaTidakSesuai(awal)).toEqual([]);
    } finally {
      awal.close();
    }

    const db2 = openDb(path);
    try {
      expect(objekSkemaTidakSesuai(db2)).toEqual([]);
      expect(
        db2.prepare("SELECT 1 AS ada FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_tanggal'").get(),
      ).toEqual({ ada: 1 });
    } finally {
      db2.close();
    }
  });
});
