// P2-4 — lampiran bukti jurnal.
//
// Fokus kontrak:
// - aturan murni: ekstensi/MIME/ukuran, nama file simpan aman, format ukuran;
// - file disimpan di folder lampiran (temp dir saat test), bukan blob DB;
// - urutan simpan file → metadata; metadata gagal = file yatim dibersihkan;
// - metadata DB: tambah/list/get/hapus, jurnal wajib ada, unik nama_simpan,
//   audit LAMPIRAN-TAMBAH / LAMPIRAN-HAPUS tanpa isi file;
// - DB v7 lama terbuka, tabel lampiran dibuat, user_version naik ke versi skema (kini v10).

import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import { insertJurnalTervalidasi, listAuditLog } from '../src/db/repository.js';
import {
  getLampiran,
  hapusLampiran,
  listLampiran,
  tambahLampiran,
} from '../src/db/lampiran.js';
import {
  MAKS_PREVIEW_LAMPIRAN,
  MAKS_UKURAN_LAMPIRAN,
  formatUkuranFile,
  mimeDariNama,
  namaSimpanAman,
  normalisasiEkstensi,
  validasiLampiran,
} from '../src/core/lampiran.js';
import {
  bacaFileLampiran,
  dataUrlLampiran,
  folderLampiranDefault,
  hapusFileLampiran,
  pathFileLampiran,
  simpanFileLampiran,
  simpanLampiranDenganMetadata,
} from '../src/features/lampiran/lampiran.js';

const dirs: string[] = [];

function tmpDir(prefix = 'pura-lampiran-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tulisFile(dir: string, nama: string, isi: Buffer | string): string {
  const path = join(dir, nama);
  writeFileSync(path, isi);
  return path;
}

function freshDb(): ReturnType<typeof openDb> {
  return openDb(join(tmpDir(), 'pura.db'));
}

function buatJurnal(db: ReturnType<typeof openDb>, id = 'j-1'): string {
  insertJurnalTervalidasi(
    db,
    {
      id,
      tanggal: '2026-01-05',
      keterangan: `Jurnal uji ${id}`,
    },
    [
      { akun_kode: '1001', debit: 100_000, kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: 100_000 },
    ],
  );
  return id;
}

describe('P2-4 — aturan murni lampiran', () => {
  it('menerima jpg/jpeg/png/webp/pdf dan menormalkan ekstensi + MIME', () => {
    const kasus: [string, string, string][] = [
      ['kuitansi.JPG', 'jpg', 'image/jpeg'],
      ['kuitansi.JPEG', 'jpeg', 'image/jpeg'],
      ['foto.png', 'png', 'image/png'],
      ['foto.WebP', 'webp', 'image/webp'],
      ['dokumen.PDF', 'pdf', 'application/pdf'],
    ];
    for (const [nama, ekstensi, mime] of kasus) {
      const hasil = validasiLampiran({ namaAsli: nama, ukuran: 1234 });
      expect(hasil.ok).toBe(true);
      if (!hasil.ok) continue;
      expect(hasil.ekstensi).toBe(ekstensi);
      expect(hasil.mime).toBe(mime);
      expect(hasil.namaAsli).toBe(nama);
    }

    expect(normalisasiEkstensi(' FOTO.JPG ')).toBe('jpg');
    expect(normalisasiEkstensi('tanpa-ekstensi')).toBe('');
    expect(mimeDariNama('foto.jpg')).toBe('image/jpeg');
    expect(mimeDariNama('foto.txt')).toBeNull();
  });

  it('menolak ekstensi lain, file kosong, ukuran > 10 MB, dan MIME tidak cocok', () => {
    expect(validasiLampiran({ namaAsli: 'nota.txt', ukuran: 10 })).toEqual({
      ok: false,
      error: expect.stringMatching(/tidak didukung/i),
    });
    expect(validasiLampiran({ namaAsli: 'tanpa-ekstensi', ukuran: 10 }).ok).toBe(false);
    expect(validasiLampiran({ namaAsli: '', ukuran: 10 }).ok).toBe(false);
    expect(validasiLampiran({ namaAsli: 'foto.jpg', ukuran: 0 }).ok).toBe(false);
    expect(
      validasiLampiran({ namaAsli: 'foto.jpg', ukuran: MAKS_UKURAN_LAMPIRAN + 1 }).ok,
    ).toBe(false);
    expect(validasiLampiran({ namaAsli: 'foto.jpg', ukuran: -1 }).ok).toBe(false);
    expect(validasiLampiran({ namaAsli: 'foto.jpg', ukuran: 1.5 }).ok).toBe(false);
    expect(
      validasiLampiran({ namaAsli: 'foto.jpg', ukuran: 100, mime: 'image/png' }).ok,
    ).toBe(false);
    // Alias OS non-standar tetap diterima selama ekstensinya jelas.
    expect(
      validasiLampiran({ namaAsli: 'foto.jpg', ukuran: 100, mime: 'image/jpg' }).ok,
    ).toBe(true);
    expect(
      validasiLampiran({ namaAsli: 'foto.jpg', ukuran: 100, mime: 'IMAGE/JPEG; charset=binary' })
        .ok,
    ).toBe(true);
  });

  it('namaSimpanAman hanya menghasilkan nama file aman dan menolak traversal', () => {
    expect(namaSimpanAman('lamp-1', 'kuitansi.JPG')).toBe('lamp-1.jpg');
    expect(namaSimpanAman('lamp_2', 'nota.pdf')).toBe('lamp_2.pdf');

    for (const nama of ['../evil.jpg', '/evil.jpg', 'evil\\x.jpg', '..\\evil.jpg', '']) {
      expect(() => namaSimpanAman('lamp-1', nama)).toThrow(/tidak aman|wajib diisi/i);
    }
    for (const id of ['', '../lamp', 'lamp/1', 'lamp\\1', 'lamp 1', 'lamp.1']) {
      expect(() => namaSimpanAman(id, 'foto.jpg')).toThrow(/ID lampiran/i);
    }
    expect(() => namaSimpanAman('lamp-1', 'foto.txt')).toThrow(/tidak didukung/i);
  });

  it('formatUkuranFile memakai satuan B/KB/MB gaya Indonesia', () => {
    expect(formatUkuranFile(0)).toBe('0 B');
    expect(formatUkuranFile(512)).toBe('512 B');
    expect(formatUkuranFile(1024)).toBe('1 KB');
    expect(formatUkuranFile(1536)).toBe('1,5 KB');
    expect(formatUkuranFile(1048576)).toBe('1 MB');
    expect(formatUkuranFile(10 * 1024 * 1024)).toBe('10 MB');
    expect(formatUkuranFile(-5)).toBe('0 B');
  });
});

describe('P2-4 — file helper di folder sementara', () => {
  it('menyimpan file secara atomik, membaca kembali, dan menghapusnya', () => {
    const root = tmpDir();
    const dir = folderLampiranDefault(root);
    expect(dir).toBe(join(root, 'attachments'));

    const isi = Buffer.from('isi kuitansi uji');
    const sumber = tulisFile(root, 'kuitansi.JPG', isi);
    const hasil = simpanFileLampiran(dir, sumber, 'kuitansi.JPG', 'lamp-1');

    expect(hasil).toEqual({
      namaSimpan: 'lamp-1.jpg',
      namaAsli: 'kuitansi.JPG',
      mime: 'image/jpeg',
      ukuran: isi.length,
    });
    expect(bacaFileLampiran(dir, 'lamp-1.jpg')).toEqual(isi);
    expect(pathFileLampiran(dir, 'lamp-1.jpg')).toBe(join(dir, 'lamp-1.jpg'));
    expect(dataUrlLampiran(dir, 'lamp-1.jpg', 'image/jpeg')).toBe(
      `data:image/jpeg;base64,${isi.toString('base64')}`,
    );
    // Tidak ada file .tmp yang tertinggal.
    expect(readdirSync(dir)).toEqual(['lamp-1.jpg']);

    expect(hapusFileLampiran(dir, 'lamp-1.jpg')).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
    expect(hapusFileLampiran(dir, 'lamp-1.jpg')).toBe(true);
  });

  it('menolak path traversal pada simpan/baca/hapus', () => {
    const root = tmpDir();
    const dir = folderLampiranDefault(root);
    const sumber = tulisFile(root, 'kuitansi.jpg', 'x');

    expect(() => simpanFileLampiran(dir, sumber, '../evil.jpg', 'lamp-1')).toThrow(
      /tidak aman/i,
    );
    expect(() => bacaFileLampiran(dir, '../pura.db')).toThrow(/tidak aman/i);
    expect(() => bacaFileLampiran(dir, '/etc/passwd')).toThrow(/tidak aman/i);
    expect(() => bacaFileLampiran(dir, 'evil\\x.jpg')).toThrow(/tidak aman/i);
    expect(hapusFileLampiran(dir, '../evil.jpg')).toBe(false);
    // Folder attachments belum dibuat karena file pertama ditolak sebelum copy;
    // yang penting tidak ada file di luar folder tujuan.
    expect(existsSync(dir)).toBe(false);
    expect(existsSync(join(root, 'evil.jpg'))).toBe(false);
  });

  it('PDF tidak di-inline dan gambar > 5 MB tidak dipratinjau', () => {
    const root = tmpDir();
    const dir = folderLampiranDefault(root);

    const pdfSumber = tulisFile(root, 'dokumen.pdf', Buffer.from('%PDF-1.4 uji'));
    simpanFileLampiran(dir, pdfSumber, 'dokumen.pdf', 'lamp-pdf');
    expect(dataUrlLampiran(dir, 'lamp-pdf.pdf', 'application/pdf')).toBeNull();

    const besar = MAKS_PREVIEW_LAMPIRAN + 1;
    const imgSumber = tulisFile(root, 'besar.jpg', Buffer.alloc(besar, 1));
    simpanFileLampiran(dir, imgSumber, 'besar.jpg', 'lamp-besar');
    expect(dataUrlLampiran(dir, 'lamp-besar.jpg', 'image/jpeg')).toBeNull();
  });

  it('membersihkan file yatim bila metadata gagal ditulis', () => {
    const root = tmpDir();
    const dir = folderLampiranDefault(root);
    const sumber = tulisFile(root, 'kuitansi.jpg', 'isi');

    expect(() =>
      simpanLampiranDenganMetadata(dir, sumber, 'kuitansi.jpg', 'lamp-gagal', () => {
        throw new Error('metadata gagal');
      }),
    ).toThrow('metadata gagal');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('file yatim juga dibersihkan saat adapter DB menolak metadata', () => {
    const db = freshDb();
    try {
      const root = tmpDir();
      const dir = folderLampiranDefault(root);
      const sumber = tulisFile(root, 'kuitansi.jpg', 'isi');

      expect(() =>
        simpanLampiranDenganMetadata(dir, sumber, 'kuitansi.jpg', 'lamp-1', (file) =>
          tambahLampiran(db, {
            id: 'lamp-1',
            jurnal_id: 'jurnal-tidak-ada',
            nama_asli: file.namaAsli,
            nama_simpan: file.namaSimpan,
            mime: file.mime,
            ukuran: file.ukuran,
          }),
        ),
      ).toThrow(/Jurnal tidak ditemukan/i);
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('P2-4 — metadata lampiran di DB', () => {
  it('menambah, membaca, daftar, dan menghapus metadata + audit', () => {
    const db = freshDb();
    try {
      buatJurnal(db, 'j-1');
      const meta = tambahLampiran(db, {
        id: 'lamp-a',
        jurnal_id: 'j-1',
        nama_asli: 'kuitansi.jpg',
        nama_simpan: 'lamp-a.jpg',
        mime: 'image/jpeg',
        ukuran: 2048,
        created_at: '2026-01-06T10:00:00.000Z',
      });

      expect(meta).toEqual({
        id: 'lamp-a',
        jurnal_id: 'j-1',
        nama_asli: 'kuitansi.jpg',
        nama_simpan: 'lamp-a.jpg',
        mime: 'image/jpeg',
        ukuran: 2048,
        created_at: '2026-01-06T10:00:00.000Z',
      });
      expect(getLampiran(db, 'lamp-a')).toEqual(meta);
      expect(listLampiran(db, 'j-1')).toEqual([meta]);
      expect(listLampiran(db, 'j-lain')).toEqual([]);

      const tambah = listAuditLog(db).filter((a) => a.aksi === 'LAMPIRAN-TAMBAH');
      expect(tambah).toHaveLength(1);
      expect(tambah[0]!.data_baru_json).toContain('kuitansi.jpg');
      expect(tambah[0]!.data_baru_json).toContain('lamp-a.jpg');
      expect(tambah[0]!.data_baru_json).not.toContain('base64');

      const dihapus = hapusLampiran(db, 'lamp-a');
      expect(dihapus).toEqual(meta);
      expect(getLampiran(db, 'lamp-a')).toBeNull();
      expect(listLampiran(db, 'j-1')).toEqual([]);
      expect(hapusLampiran(db, 'lamp-a')).toBeNull();

      const hapus = listAuditLog(db).filter((a) => a.aksi === 'LAMPIRAN-HAPUS');
      expect(hapus).toHaveLength(1);
      expect(hapus[0]!.data_lama_json).toContain('kuitansi.jpg');
      expect(hapus[0]!.data_lama_json).not.toContain('base64');
    } finally {
      db.close();
    }
  });

  it('menolak metadata tanpa jurnal dan nama_simpan duplikat', () => {
    const db = freshDb();
    try {
      buatJurnal(db, 'j-1');
      buatJurnal(db, 'j-2');

      expect(() =>
        tambahLampiran(db, {
          id: 'lamp-x',
          jurnal_id: 'j-tidak-ada',
          nama_asli: 'foto.jpg',
          nama_simpan: 'lamp-x.jpg',
          mime: 'image/jpeg',
          ukuran: 100,
        }),
      ).toThrow(/Jurnal tidak ditemukan/i);

      tambahLampiran(db, {
        id: 'lamp-a',
        jurnal_id: 'j-1',
        nama_asli: 'kuitansi.jpg',
        nama_simpan: 'lamp-a.jpg',
        mime: 'image/jpeg',
        ukuran: 100,
      });

      // Metadata kedua sengaja memakai nama_simpan yang sama → UNIQUE index.
      expect(() =>
        tambahLampiran(db, {
          id: 'lamp-b',
          jurnal_id: 'j-2',
          nama_asli: 'kuitansi-lain.jpg',
          nama_simpan: 'lamp-a.jpg',
          mime: 'image/jpeg',
          ukuran: 200,
        }),
      ).toThrow(/sudah dipakai/i);

      expect(listLampiran(db, 'j-1')).toHaveLength(1);
      expect(listLampiran(db, 'j-2')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('menolak metadata dengan nama file tidak aman atau MIME tidak cocok', () => {
    const db = freshDb();
    try {
      buatJurnal(db, 'j-1');
      const dasar = {
        id: 'lamp-a',
        jurnal_id: 'j-1',
        nama_asli: 'kuitansi.jpg',
        mime: 'image/jpeg',
        ukuran: 100,
      };
      expect(() =>
        tambahLampiran(db, { ...dasar, nama_simpan: '../lamp-a.jpg' }),
      ).toThrow(/tidak aman/i);
      expect(() =>
        tambahLampiran(db, { ...dasar, nama_simpan: 'lamp-a.png' }),
      ).toThrow(/tidak cocok/i);
      expect(() =>
        tambahLampiran(db, { ...dasar, nama_asli: 'kuitansi.txt', nama_simpan: 'lamp-a.txt' }),
      ).toThrow(/tidak didukung/i);
    } finally {
      db.close();
    }
  });
});

describe('P2-4 — migrasi v7 → v10', () => {
  it('membuat tabel lampiran_jurnal + index, menaikkan user_version, data lama awet', () => {
    const dir = tmpDir('pura-lampiran-migrasi-');
    const path = join(dir, 'pura.db');

    const lama = new Database(path);
    lama.exec(`
      CREATE TABLE pengaturan (kunci TEXT PRIMARY KEY, nilai TEXT NOT NULL DEFAULT '');
      INSERT INTO pengaturan (kunci, nilai) VALUES ('uji-lama', 'tetap');
      PRAGMA user_version = 7;
    `);
    lama.close();

    const db = openDb(path);
    try {
      expect(SCHEMA_VERSION).toBe(10);
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(10);
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lampiran_jurnal'",
          )
          .get(),
      ).toBeTruthy();
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_lampiran_jurnal'",
          )
          .get(),
      ).toBeTruthy();
      expect(
        (db.prepare("SELECT nilai FROM pengaturan WHERE kunci = 'uji-lama'").get() as {
          nilai: string;
        }).nilai,
      ).toBe('tetap');
    } finally {
      db.close();
    }

    // Idempoten: buka ulang tidak error dan versi tetap v9.
    const db2 = openDb(path);
    try {
      expect(Number(db2.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
      expect(
        db2
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lampiran_jurnal'",
          )
          .get(),
      ).toBeTruthy();
    } finally {
      db2.close();
    }
  });
});
