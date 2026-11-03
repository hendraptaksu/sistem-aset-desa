// P0-4: integrasi posting layer dengan SQLite.
// Fokus: satu pintu simpan jurnal, index no_bukti unik parsial, peringatan kas
// minus butuh konfirmasi, kunci periode, dan akun nonaktif.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  buatKonteksPosting,
  postingJurnal,
  postingSaldoAwal,
  validasiJurnalDb,
} from '../src/db/posting.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
import {
  getJurnalDetail,
  getPengaturanPembukuan,
  insertJurnalTervalidasi,
  listAuditLog,
  listJurnal,
  simpanPengaturanPembukuan,
} from '../src/db/repository.js';
import * as repository from '../src/db/repository.js';
import { DEFAULT_PENGATURAN } from '../src/core/pengaturan.js';
import {
  PESAN_INPUT_JURNAL_TIDAK_VALID,
  PESAN_JURNAL_PENUTUP_MANUAL,
  validasiJurnal,
  type JurnalInput,
} from '../src/core/posting.js';
import {
  buatJurnalCatatUtangUsaha,
  buatJurnalTerimaUang,
} from '../src/core/forms.js';
import { serahkanPanjar } from '../src/db/panjar.js';
import type { JurnalBarisInput, JurnalHeaderInput } from '../src/core/types.js';

const dirs: string[] = [];

function freshDb(): { dir: string; db: ReturnType<typeof openDb> } {
  const dir = mkdtempSync(join(tmpdir(), 'pura-posting-'));
  dirs.push(dir);
  return { dir, db: openDb(join(dir, 'pura.db')) };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function header(over: Partial<JurnalHeaderInput> = {}): JurnalHeaderInput {
  return {
    id: 'j-uji',
    tanggal: '2026-01-02',
    keterangan: 'Terima uang parkir',
    no_bukti: 'JU-2026-0001',
    ...over,
  };
}

function pasangan(debit = '1001', kredit = '4005', nominal = 100_000): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

function jumlahJurnal(db: ReturnType<typeof openDb>): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM jurnal').get() as { c: number }).c;
}

describe('P0-4 — satu pintu posting jurnal', () => {
  it('menyimpan jurnal seimbang dan menyediakan index no_bukti unik per tahun', () => {
    const { db } = freshDb();
    try {
      const idx = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_no_bukti_tahun'",
        )
        .get() as { sql: string } | undefined;
      expect(idx, 'index no_bukti per tahun harus ada').toBeTruthy();
      expect(idx!.sql).toMatch(/UNIQUE INDEX/);
      expect(idx!.sql).toMatch(/substr\(tanggal,\s*1,\s*4\)/);
      expect(idx!.sql).toMatch(/COLLATE NOCASE/);
      expect(idx!.sql).toMatch(/WHERE no_bukti <> ''/);
      expect(
        db
          .prepare(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_jurnal_no_bukti'",
          )
          .get(),
        'index global lama harus sudah dibuang',
      ).toBeUndefined();

      const hasil = postingJurnal(db, { header: header(), baris: pasangan() });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.errors).toEqual([]);
      expect(hasil.peringatan).toEqual([]);
      expect(hasil.jurnal).toMatchObject({
        id: 'j-uji',
        no_bukti: 'JU-2026-0001',
        tanggal: '2026-01-02',
      });

      const detail = getJurnalDetail(db, 'j-uji');
      expect(detail?.baris).toHaveLength(2);
      expect(detail?.baris[0]).toMatchObject({ akun_kode: '1001', debit: 100_000 });
      expect(detail?.baris[1]).toMatchObject({ akun_kode: '4005', kredit: 100_000 });
    } finally {
      db.close();
    }
  });

  it('menolak komponen arus kas lintas kategori sebelum jurnal ditulis', () => {
    const { db } = freshDb();
    try {
      const input: JurnalInput = {
        header: header({ id: 'j-arus-ambigu', jenis: 'UMUM' }),
        baris: [
          { akun_kode: '1001', debit: 50_000, kredit: 0 },
          { akun_kode: '1050', debit: 100_000, kredit: 0 },
          { akun_kode: '2050', debit: 0, kredit: 150_000 },
        ],
      };

      const validasi = validasiJurnalDb(db, input);
      expect(validasi.boleh).toBe(false);
      expect(validasi.errors.join(' ')).toMatch(/komponen arus masuk dan keluar lintas kategori/i);
      expect(validasi.errors.join(' ')).toMatch(/jurnal terpisah/i);

      const hasil = postingJurnal(db, input);
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/jurnal terpisah/i);
      expect(jumlahJurnal(db)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get()).toEqual({ c: 0 });

      const pembukaan = validasiJurnalDb(db, {
        header: header({ id: 'j-opening-mixed', jenis: 'SALDO_AWAL' }),
        baris: input.baris,
      });
      expect(pembukaan.boleh, pembukaan.errors.join(' ')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('menolak jurnal tidak seimbang / tanggal 31 Feb dan tidak menulis baris apa pun', () => {
    const { db } = freshDb();
    try {
      const tidakSeimbang = postingJurnal(db, {
        header: header({ id: 'j-salah' }),
        baris: [
          { akun_kode: '1001', debit: 100_000, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: 90_000 },
        ],
      });
      expect(tidakSeimbang.tersimpan).toBe(false);
      expect(tidakSeimbang.errors.join(' ')).toMatch(/tidak seimbang/);

      const tanggalSalah = postingJurnal(db, {
        header: header({ id: 'j-tanggal', tanggal: '2026-02-31' }),
        baris: pasangan(),
      });
      expect(tanggalSalah.tersimpan).toBe(false);
      expect(tanggalSalah.errors.join(' ')).toMatch(/Tanggal tidak valid/);

      expect(jumlahJurnal(db)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get()).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('menolak nomor bukti duplikat (case-insensitive) lewat validasi, repository, dan index', () => {
    const { db } = freshDb();
    try {
      expect(postingJurnal(db, { header: header(), baris: pasangan() }).tersimpan).toBe(true);

      const duplikat = postingJurnal(db, {
        header: header({ id: 'j-kedua', no_bukti: 'ju-2026-0001' }),
        baris: pasangan('1029', '4005'),
      });
      expect(duplikat.tersimpan).toBe(false);
      expect(duplikat.errors.join(' ')).toMatch(/sudah dipakai/);
      expect(jumlahJurnal(db)).toBe(1);

      expect(() =>
        insertJurnalTervalidasi(db, header({ id: 'j-ketiga' }), pasangan('1029', '4005')),
      ).toThrow(/sudah dipakai/);

      // Penjaga terakhir: INSERT mentah tetap ditolak unique index parsial.
      expect(() =>
        db
          .prepare(
            `INSERT INTO jurnal (id, tanggal, no_bukti, keterangan, jenis, grup_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run('j-mentah', '2026-01-03', 'JU-2026-0001', 'Duplikat mentah', 'UMUM', 'j-mentah', '2026-01-03T00:00:00.000Z'),
      ).toThrow(/UNIQUE/);
    } finally {
      db.close();
    }
  });

  it('mengizinkan beberapa jurnal draft tanpa no_bukti', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, { header: header({ id: 'j-a', no_bukti: '' }), baris: pasangan() }).tersimpan,
      ).toBe(true);
      expect(
        postingJurnal(db, { header: header({ id: 'j-b', no_bukti: '' }), baris: pasangan('1029', '4005') })
          .tersimpan,
      ).toBe(true);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('menolak akun nonaktif baik lewat posting layer maupun repository', () => {
    const { db } = freshDb();
    try {
      db.prepare("UPDATE akun SET aktif = 0 WHERE kode = '4005'").run();

      const hasil = validasiJurnalDb(db, { header: header(), baris: pasangan() });
      expect(hasil.boleh).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/sudah tidak aktif/);

      expect(postingJurnal(db, { header: header(), baris: pasangan() }).tersimpan).toBe(false);
      expect(() => insertJurnalTervalidasi(db, header(), pasangan())).toThrow(/tidak aktif/);
      expect(jumlahJurnal(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('menolak akun legacy 3001/3002 di semua pintu, tetapi 3000 tetap boleh', () => {
    const { db } = freshDb();
    try {
      for (const kode of ['3001', '3002']) {
        const input = { header: header(), baris: pasangan('1001', kode) };

        const validasi = validasiJurnalDb(db, input);
        expect(validasi.boleh).toBe(false);
        expect(validasi.errors.join(' ')).toContain(kode);
        expect(validasi.errors.join(' ')).toMatch(/legacy/i);
        expect(validasi.errors.join(' ')).toMatch(/tidak boleh diposting/i);

        expect(postingJurnal(db, input).tersimpan).toBe(false);
        expect(() => insertJurnalTervalidasi(db, input.header, input.baris)).toThrow(
          /tidak boleh diposting/,
        );
      }
      expect(jumlahJurnal(db)).toBe(0);

      // 3000 MODAL tetap sah untuk setoran modal/saldo awal.
      const modal = postingJurnal(db, {
        header: header({ keterangan: 'Setoran modal', jenis: 'SALDO_AWAL' }),
        baris: pasangan('1001', '3000'),
      });
      expect(modal.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe('P0-4 — peringatan kas minus', () => {
  it('menahan simpan sampai operator mengonfirmasi, lalu menyimpan', () => {
    const { db } = freshDb();
    try {
      const awal = postingJurnal(db, {
        header: header({
          id: 'j-modal',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Saldo awal kas',
          jenis: 'SALDO_AWAL',
        }),
        baris: pasangan('1001', '3000', 100_000),
      });
      expect(awal.tersimpan).toBe(true);

      const bayar = {
        header: header({
          id: 'j-bayar',
          no_bukti: 'JU-2026-0002',
          keterangan: 'Bayar listrik',
          jenis: 'BAYAR' as const,
        }),
        baris: pasangan('5000', '1001', 150_000),
      };

      const belumKonfirmasi = postingJurnal(db, bayar);
      expect(belumKonfirmasi.tersimpan).toBe(false);
      expect(belumKonfirmasi.errors).toEqual([]);
      expect(belumKonfirmasi.perluKonfirmasi).toBe(true);
      expect(belumKonfirmasi.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(1);

      const dikonfirmasi = postingJurnal(db, bayar, { konfirmasiPeringatan: true });
      expect(dikonfirmasi.tersimpan).toBe(true);
      expect(dikonfirmasi.peringatan).toHaveLength(1);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe('AKT-06 — audit override peringatan + alasan', () => {
  /** Kas 1001 Rp1.000; pengeluaran Rp1.500 memicu peringatan kas minus. */
  function siapkanKasMinus(db: ReturnType<typeof openDb>) {
    const awal = postingJurnal(db, {
      header: header({
        id: 'j-modal-akt06',
        tanggal: '2026-01-01',
        no_bukti: 'JU-2026-0300',
        keterangan: 'Saldo awal kas AKT-06',
        jenis: 'SALDO_AWAL',
      }),
      baris: pasangan('1001', '3000', 100_000),
    });
    expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
    return {
      header: header({
        id: 'j-minus-akt06',
        tanggal: '2026-01-02',
        no_bukti: 'JU-2026-0301',
        keterangan: 'Bayar listrik melebihi kas',
        jenis: 'BAYAR' as const,
      }),
      baris: pasangan('5000', '1001', 150_000),
    };
  }

  it('menolak konfirmasi kas minus tanpa alasan dan tidak menulis jurnal/audit', () => {
    const { db } = freshDb();
    try {
      const bayar = siapkanKasMinus(db);
      const auditSebelum = listAuditLog(db).length;

      const tanpa = postingJurnal(db, bayar, {
        konfirmasiPeringatan: true,
        wajibAlasanPeringatan: true,
      });
      expect(tanpa.tersimpan).toBe(false);
      expect(tanpa.perluKonfirmasi).toBe(true);
      expect(tanpa.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);
      expect(tanpa.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toHaveLength(auditSebelum);

      const pendek = postingJurnal(db, bayar, {
        konfirmasiPeringatan: true,
        wajibAlasanPeringatan: true,
        alasanPeringatan: 'ok',
      });
      expect(pendek.tersimpan).toBe(false);
      expect(pendek.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toHaveLength(auditSebelum);
    } finally {
      db.close();
    }
  });

  it('menyimpan dengan alasan ≥5 karakter dan audit memuat peringatan + alasan', () => {
    const { db } = freshDb();
    try {
      const bayar = siapkanKasMinus(db);

      const hasil = postingJurnal(db, bayar, {
        konfirmasiPeringatan: true,
        wajibAlasanPeringatan: true,
        alasanPeringatan: '  Kas minus disetujui pemilik  ',
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.peringatan).toHaveLength(1);
      expect(jumlahJurnal(db)).toBe(2);

      const audit = listAuditLog(db, { aksi: 'CREATE j-minus-akt06' });
      expect(audit).toHaveLength(1);
      const data = JSON.parse(audit[0]!.data_baru_json) as {
        jurnal: { id: string };
        baris: unknown[];
        peringatan: string[];
        konfirmasiPeringatan: boolean;
        alasanPeringatan: string;
      };
      expect(data.jurnal.id).toBe('j-minus-akt06');
      expect(data.baris).toHaveLength(2);
      expect(data.peringatan).toEqual(hasil.peringatan);
      expect(data.peringatan.join(' ')).toMatch(/akan minus/);
      expect(data.konfirmasiPeringatan).toBe(true);
      expect(data.alasanPeringatan).toBe('Kas minus disetujui pemilik');
    } finally {
      db.close();
    }
  });

  it('audit CREATE jurnal tanpa peringatan tetap berbentuk generik', () => {
    const { db } = freshDb();
    try {
      const hasil = postingJurnal(db, {
        header: header({ id: 'j-tanpa-peringatan', no_bukti: 'JU-2026-0310' }),
        baris: pasangan('1001', '4005'),
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.peringatan).toEqual([]);

      const audit = listAuditLog(db, { aksi: 'CREATE j-tanpa-peringatan' });
      expect(audit).toHaveLength(1);
      const data = JSON.parse(audit[0]!.data_baru_json) as Record<string, unknown>;
      expect(Object.keys(data).sort()).toEqual(['baris', 'jurnal']);
      expect(data).not.toHaveProperty('peringatan');
      expect(data).not.toHaveProperty('konfirmasiPeringatan');
      expect(data).not.toHaveProperty('alasanPeringatan');
    } finally {
      db.close();
    }
  });

  it('saldo awal meneruskan alasan lewat adapter dan mencatat override di audit', () => {
    const { db } = freshDb();
    try {
      const input = {
        header: header({
          id: 'sa-minus-akt06',
          tanggal: '2026-01-01',
          no_bukti: 'SA-2026-0001',
          keterangan: 'Saldo awal dengan kas minus',
          jenis: 'SALDO_AWAL' as const,
        }),
        baris: [
          { akun_kode: '5000', debit: 150_000, kredit: 0 },
          { akun_kode: '1001', debit: 0, kredit: 150_000 },
        ],
      };

      const ditolak = simpanSaldoAwal(db, input, {
        konfirmasiPeringatan: true,
        wajibAlasanPeringatan: true,
      });
      expect(ditolak.tersimpan).toBe(false);
      expect(ditolak.perluKonfirmasi).toBe(true);
      expect(ditolak.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);
      expect(jumlahJurnal(db)).toBe(0);
      expect(listAuditLog(db)).toEqual([]);

      const tersimpan = simpanSaldoAwal(db, input, {
        konfirmasiPeringatan: true,
        wajibAlasanPeringatan: true,
        alasanPeringatan: 'Saldo awal minus disetujui',
      });
      expect(tersimpan.tersimpan, tersimpan.errors.join(' ')).toBe(true);
      expect(tersimpan.peringatan).toHaveLength(1);
      expect(jumlahJurnal(db)).toBe(1);

      const audit = listAuditLog(db, { aksi: 'SALDO-AWAL sa-minus-akt06' });
      expect(audit).toHaveLength(1);
      const data = JSON.parse(audit[0]!.data_baru_json) as {
        jurnal: { id: string; jenis: string };
        peringatan: string[];
        konfirmasiPeringatan: boolean;
        alasanPeringatan: string;
      };
      expect(data.jurnal.id).toBe('sa-minus-akt06');
      expect(data.jurnal.jenis).toBe('SALDO_AWAL');
      expect(data.peringatan).toEqual(tersimpan.peringatan);
      expect(data.konfirmasiPeringatan).toBe(true);
      expect(data.alasanPeringatan).toBe('Saldo awal minus disetujui');
    } finally {
      db.close();
    }
  });
});

describe('AUD-10 — peringatan kas minus memakai saldo per tanggal jurnal', () => {
  it('pengeluaran backdate dievaluasi dengan saldo tanggalnya, bukan saldo masa depan', () => {
    const { db } = freshDb();
    try {
      // Kas Februari Rp 1.000; kas 15 Januari masih 0.
      const feb = postingJurnal(db, {
        header: header({
          id: 'j-feb',
          tanggal: '2026-02-01',
          no_bukti: 'JU-2026-0002',
          keterangan: 'Penerimaan Februari',
        }),
        baris: pasangan('1001', '4005', 100_000),
      });
      expect(feb.tersimpan).toBe(true);

      const backdate = {
        header: header({
          id: 'j-jan',
          tanggal: '2026-01-15',
          no_bukti: 'JU-2026-0003',
          keterangan: 'Pengeluaran backdate',
          jenis: 'BAYAR' as const,
        }),
        baris: pasangan('5000', '1001', 20_000),
      };

      const validasi = validasiJurnalDb(db, backdate);
      expect(validasi.boleh).toBe(true);
      expect(validasi.peringatan.join(' ')).toMatch(/akan minus/);

      const belum = postingJurnal(db, backdate);
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(belum.peringatan.join(' ')).toMatch(/akan minus/);
      expect(jumlahJurnal(db)).toBe(1);

      const lanjut = postingJurnal(db, backdate, { konfirmasiPeringatan: true });
      expect(lanjut.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('transaksi maju normal tetap tanpa peringatan palsu', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, {
          header: header({ id: 'j-modal', no_bukti: 'JU-2026-0010', keterangan: 'Modal awal' }),
          baris: pasangan('1001', '3000', 100_000),
        }).tersimpan,
      ).toBe(true);

      const maju = postingJurnal(db, {
        header: header({
          id: 'j-maju',
          tanggal: '2026-01-15',
          no_bukti: 'JU-2026-0011',
          keterangan: 'Bayar listrik',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 20_000),
      });
      expect(maju.errors).toEqual([]);
      expect(maju.peringatan).toEqual([]);
      expect(maju.perluKonfirmasi).toBe(false);
      expect(maju.tersimpan).toBe(true);
    } finally {
      db.close();
    }
  });

  it('saldo dihitung per akun kas, bukan total semua dompet', () => {
    const { db } = freshDb();
    try {
      // Bank 1029 punya saldo, kas 1001 tidak.
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-bank',
            no_bukti: 'JU-2026-0020',
            keterangan: 'Penerimaan via bank',
          }),
          baris: pasangan('1029', '4005', 100_000),
        }).tersimpan,
      ).toBe(true);

      const hasil = validasiJurnalDb(db, {
        header: header({
          id: 'j-kas',
          tanggal: '2026-01-20',
          no_bukti: 'JU-2026-0021',
          keterangan: 'Bayar dari kas',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 20_000),
      });
      expect(hasil.boleh).toBe(true);
      expect(hasil.peringatan.join(' ')).toMatch(/Kas\/Bank 1001/);
    } finally {
      db.close();
    }
  });
});

describe('AKT-04 — peringatan kas minus untuk tanggal setelah jurnal', () => {
  it('memperingatkan backdate yang membuat kas minus di tanggal setelahnya', () => {
    const { db } = freshDb();
    try {
      // 1 Jan kas Rp 1.000.
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-awal',
            tanggal: '2026-01-01',
            no_bukti: 'JU-2026-0100',
            keterangan: 'Saldo awal kas',
            jenis: 'SALDO_AWAL',
          }),
          baris: pasangan('1001', '3000', 100_000),
        }).tersimpan,
      ).toBe(true);

      // 10 Jan keluar Rp 800 -> kas tersisa Rp 200.
      const keluar10 = postingJurnal(db, {
        header: header({
          id: 'j-10',
          tanggal: '2026-01-10',
          no_bukti: 'JU-2026-0101',
          keterangan: 'Bayar 10 Januari',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 80_000),
      });
      expect(keluar10.tersimpan).toBe(true);
      expect(keluar10.peringatan).toEqual([]);

      // Backdate 5 Jan keluar Rp 300: saldo pada 5 Jan masih Rp 700 (positif),
      // tetapi setelah pengeluaran 10 Jan kas menjadi minus Rp 100.
      const backdate = {
        header: header({
          id: 'j-05',
          tanggal: '2026-01-05',
          no_bukti: 'JU-2026-0102',
          keterangan: 'Bayar backdate 5 Januari',
          jenis: 'BAYAR' as const,
        }),
        baris: pasangan('5000', '1001', 30_000),
      };

      const validasi = validasiJurnalDb(db, backdate);
      expect(validasi.boleh).toBe(true);
      expect(validasi.perluKonfirmasi).toBe(true);
      expect(validasi.peringatan).toHaveLength(1);
      expect(validasi.peringatan[0]).toMatch(/Kas\/Bank 1001/);
      expect(validasi.peringatan[0]).toMatch(/akan minus Rp 100(?!\d|[.,]\d)/);

      const belum = postingJurnal(db, backdate);
      expect(belum.tersimpan).toBe(false);
      expect(belum.perluKonfirmasi).toBe(true);
      expect(jumlahJurnal(db)).toBe(2);

      const lanjut = postingJurnal(db, backdate, { konfirmasiPeringatan: true });
      expect(lanjut.tersimpan, lanjut.errors.join(' ')).toBe(true);
      expect(jumlahJurnal(db)).toBe(3);
    } finally {
      db.close();
    }
  });

  it('tidak memperingatkan bila kas cukup sampai tanggal setelahnya', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-awal',
            tanggal: '2026-01-01',
            no_bukti: 'JU-2026-0110',
            keterangan: 'Saldo awal kas',
            jenis: 'SALDO_AWAL',
          }),
          baris: pasangan('1001', '3000', 200_000),
        }).tersimpan,
      ).toBe(true);
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-10',
            tanggal: '2026-01-10',
            no_bukti: 'JU-2026-0111',
            keterangan: 'Bayar 10 Januari',
            jenis: 'BAYAR',
          }),
          baris: pasangan('5000', '1001', 80_000),
        }).tersimpan,
      ).toBe(true);

      // Rp 2.000 - Rp 300 - Rp 800 = Rp 900, tetap positif.
      const validasi = validasiJurnalDb(db, {
        header: header({
          id: 'j-05',
          tanggal: '2026-01-05',
          no_bukti: 'JU-2026-0112',
          keterangan: 'Bayar backdate 5 Januari',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 30_000),
      });
      expect(validasi.boleh).toBe(true);
      expect(validasi.peringatan).toEqual([]);
      expect(validasi.perluKonfirmasi).toBe(false);
    } finally {
      db.close();
    }
  });

  it('tetap tanpa peringatan saat tidak ada mutasi setelahnya dan saldo cukup', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-awal',
            tanggal: '2026-01-01',
            no_bukti: 'JU-2026-0120',
            keterangan: 'Saldo awal kas',
            jenis: 'SALDO_AWAL',
          }),
          baris: pasangan('1001', '3000', 100_000),
        }).tersimpan,
      ).toBe(true);

      const validasi = validasiJurnalDb(db, {
        header: header({
          id: 'j-05',
          tanggal: '2026-01-05',
          no_bukti: 'JU-2026-0121',
          keterangan: 'Bayar 5 Januari',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 30_000),
      });
      expect(validasi.boleh).toBe(true);
      expect(validasi.peringatan).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('mempertahankan perilaku lama saat tidak ada mutasi setelahnya dan saldo minus', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-awal',
            tanggal: '2026-01-01',
            no_bukti: 'JU-2026-0130',
            keterangan: 'Saldo awal kas',
            jenis: 'SALDO_AWAL',
          }),
          baris: pasangan('1001', '3000', 100_000),
        }).tersimpan,
      ).toBe(true);

      const validasi = validasiJurnalDb(db, {
        header: header({
          id: 'j-05',
          tanggal: '2026-01-05',
          no_bukti: 'JU-2026-0131',
          keterangan: 'Bayar 5 Januari',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 120_000),
      });
      expect(validasi.boleh).toBe(true);
      expect(validasi.peringatan).toHaveLength(1);
      expect(validasi.peringatan[0]).toMatch(/akan minus Rp 200(?!\d|[.,]\d)/);
      expect(validasi.perluKonfirmasi).toBe(true);
    } finally {
      db.close();
    }
  });

  it('hanya satu peringatan dengan nominal minus terburuk bila tanggal jurnal sudah minus', () => {
    const { db } = freshDb();
    try {
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-awal',
            tanggal: '2026-01-01',
            no_bukti: 'JU-2026-0140',
            keterangan: 'Saldo awal kas',
            jenis: 'SALDO_AWAL',
          }),
          baris: pasangan('1001', '3000', 100_000),
        }).tersimpan,
      ).toBe(true);
      expect(
        postingJurnal(db, {
          header: header({
            id: 'j-10',
            tanggal: '2026-01-10',
            no_bukti: 'JU-2026-0141',
            keterangan: 'Bayar 10 Januari',
            jenis: 'BAYAR',
          }),
          baris: pasangan('5000', '1001', 80_000),
        }).tersimpan,
      ).toBe(true);

      // Di tanggal jurnal: Rp 1.000 - Rp 1.200 = minus Rp 200.
      // Setelah 10 Jan: minus Rp 200 - Rp 800 = minus Rp 1.000 (terburuk).
      const validasi = validasiJurnalDb(db, {
        header: header({
          id: 'j-05',
          tanggal: '2026-01-05',
          no_bukti: 'JU-2026-0142',
          keterangan: 'Bayar backdate 5 Januari',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 120_000),
      });
      expect(validasi.peringatan).toHaveLength(1);
      expect(validasi.peringatan[0]).toMatch(/akan minus Rp 1\.000(?!\d|[.,]\d)/);
      expect(validasi.peringatan[0]).not.toMatch(/Rp 200(?!\d|[.,]\d)/);
    } finally {
      db.close();
    }
  });
});

describe('AKT-01 — jurnal pertama wajib saldo awal / konfirmasi', () => {
  const PESAN_WAJIB_SALDO_AWAL =
    'Belum ada saldo awal. Isi Wizard Saldo Awal dulu, atau konfirmasi mulai tanpa saldo awal.';

  it('menolak jurnal normal pertama tanpa konfirmasi dan tidak menulis jurnal/audit', () => {
    const { db } = freshDb();
    try {
      const hasil = postingJurnal(
        db,
        { header: header(), baris: pasangan() },
        { wajibSaldoAwal: true },
      );

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors).toEqual([PESAN_WAJIB_SALDO_AWAL]);
      expect(jumlahJurnal(db)).toBe(0);
      expect(db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get()).toEqual({ c: 0 });
      // Guard berjalan di transaksi yang sama; gagal berarti audit pun tidak ditulis.
      expect(listAuditLog(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('menyimpan jurnal pertama bila operator memilih mulai tanpa saldo awal', () => {
    const { db } = freshDb();
    try {
      const hasil = postingJurnal(
        db,
        { header: header(), baris: pasangan() },
        { wajibSaldoAwal: true, konfirmasiTanpaSaldoAwal: true },
      );

      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  it('mengizinkan jurnal berikutnya setelah saldo awal, dan saldo awal sendiri tidak terkena guard', () => {
    const { db } = freshDb();
    try {
      const saldoAwal = postingSaldoAwal(
        db,
        {
          header: header({
            id: 'j-saldo-awal',
            tanggal: '2026-01-01',
            no_bukti: 'SA-2026-0001',
            keterangan: 'Saldo awal pembukuan',
            jenis: 'SALDO_AWAL',
          }),
          baris: pasangan('1001', '3000', 1_000_000),
        },
        { wajibSaldoAwal: true },
      );
      expect(saldoAwal.tersimpan, saldoAwal.errors.join(' ')).toBe(true);

      const berikutnya = postingJurnal(
        db,
        {
          header: header({ id: 'j-setelah-saldo-awal', no_bukti: 'JU-2026-0001' }),
          baris: pasangan('1029', '4005'),
        },
        { wajibSaldoAwal: true },
      );
      expect(berikutnya.tersimpan, berikutnya.errors.join(' ')).toBe(true);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe('P0-4 — kunci periode via DB', () => {
  it('menolak tanggal periode tutup tanpa alasan, menerima dengan alasan', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        'INSERT INTO tutup_buku (tahun, created_at, catatan) VALUES (?, ?, ?)',
      ).run(2025, '2026-01-01T00:00:00.000Z', 'Uji kunci');

      const koreksi = {
        header: header({
          id: 'j-koreksi',
          tanggal: '2025-12-31',
          no_bukti: 'JU-2025-0001',
          keterangan: 'Koreksi Desember',
        }),
        baris: pasangan('1001', '4005', 10_000),
      };

      const tanpaAlasan = postingJurnal(db, koreksi);
      expect(tanpaAlasan.tersimpan).toBe(false);
      expect(tanpaAlasan.errors.join(' ')).toMatch(/Periode sudah ditutup/);

      const denganAlasan = postingJurnal(db, { ...koreksi, alasan: 'Koreksi struk Desember' });
      expect(denganAlasan.tersimpan).toBe(true);
      expect(denganAlasan.jurnal?.tanggal).toBe('2025-12-31');
    } finally {
      db.close();
    }
  });

  it('tidak mengunci tahun berjalan setelah tutup 2025', () => {
    const { db } = freshDb();
    try {
      db.prepare(
        'INSERT INTO tutup_buku (tahun, created_at, catatan) VALUES (?, ?, ?)',
      ).run(2025, '2026-01-01T00:00:00.000Z', '');

      const hasil = postingJurnal(db, {
        header: header({ id: 'j-2026', tanggal: '2026-01-01', no_bukti: 'JU-2026-0009' }),
        baris: pasangan('1001', '4005', 10_000),
      });
      expect(hasil.tersimpan).toBe(true);
      expect(hasil.errors).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('AKT-03 — tanggal mulai pembukuan sebagai batas bawah', () => {
  const settingMulai = (tanggalMulaiPembukuan: string) => ({
    ...DEFAULT_PENGATURAN,
    tanggalMulaiPembukuan,
  });

  it('menolak jurnal sebelum batas, menerima tepat pada batas, dan tidak menulis apa pun saat ditolak', () => {
    const { db } = freshDb();
    try {
      simpanPengaturanPembukuan(db, settingMulai('2025-01-01'));
      const auditSebelum = listAuditLog(db).length;

      const ditolak = postingJurnal(db, {
        header: header({
          id: 'j-sebelum-batas',
          tanggal: '2024-12-31',
          no_bukti: 'JU-2024-0001',
        }),
        baris: pasangan(),
      });
      expect(ditolak.tersimpan).toBe(false);
      expect(ditolak.errors).toContain(
        'Tanggal jurnal sebelum tanggal mulai pembukuan (2025-01-01).',
      );
      expect(jumlahJurnal(db)).toBe(0);
      expect(listAuditLog(db)).toHaveLength(auditSebelum);

      const diterima = postingJurnal(db, {
        header: header({
          id: 'j-tepat-batas',
          tanggal: '2025-01-01',
          no_bukti: 'JU-2025-0001',
        }),
        baris: pasangan(),
      });
      expect(diterima.tersimpan, diterima.errors.join(' ')).toBe(true);
      expect(diterima.jurnal?.tanggal).toBe('2025-01-01');
      expect(jumlahJurnal(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('setting kosong tidak membatasi tanggal (kompatibel data lama)', () => {
    const { db } = freshDb();
    try {
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('');

      const hasil = postingJurnal(db, {
        header: header({
          id: 'j-tanpa-batas',
          tanggal: '2020-01-02',
          no_bukti: 'JU-2020-0001',
        }),
        baris: pasangan(),
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(jumlahJurnal(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('SALDO_AWAL bertanggal lain tidak terkena batas', () => {
    const { db } = freshDb();
    try {
      simpanPengaturanPembukuan(db, settingMulai('2025-01-01'));

      const hasil = postingSaldoAwal(db, {
        header: header({
          id: 'j-saldo-awal-2024',
          tanggal: '2024-12-31',
          no_bukti: 'SA-2024-0001',
          keterangan: 'Saldo awal pembukuan',
          jenis: 'SALDO_AWAL',
        }),
        baris: pasangan('1001', '3000', 1_000_000),
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.jurnal?.tanggal).toBe('2024-12-31');
      expect(jumlahJurnal(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  it('menolak setting setelah jurnal paling awal, tetapi menerima tanggal yang sama', () => {
    const { db } = freshDb();
    try {
      insertJurnalTervalidasi(
        db,
        { id: 'j-awal', tanggal: '2025-01-02', keterangan: 'Jurnal pertama' },
        pasangan('1001', '4005'),
      );

      expect(() =>
        simpanPengaturanPembukuan(db, settingMulai('2025-01-03')),
      ).toThrow(/setelah jurnal paling awal \(2025-01-02\)/);
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('');

      const sama = simpanPengaturanPembukuan(db, settingMulai('2025-01-02'));
      expect(sama.tanggalMulaiPembukuan).toBe('2025-01-02');
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('2025-01-02');
    } finally {
      db.close();
    }
  });

  it('mengosongkan setting lama saat ada jurnal butuh konfirmasi khusus', () => {
    const { db } = freshDb();
    try {
      insertJurnalTervalidasi(
        db,
        { id: 'j-awal', tanggal: '2025-01-02', keterangan: 'Jurnal pertama' },
        pasangan('1001', '4005'),
      );
      simpanPengaturanPembukuan(db, settingMulai('2025-01-02'));

      expect(() =>
        simpanPengaturanPembukuan(db, settingMulai('')),
      ).toThrow(/tidak boleh dikosongkan karena sudah ada jurnal/);
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('2025-01-02');

      const dikosongkan = simpanPengaturanPembukuan(db, settingMulai(''), {
        konfirmasiKosongkanTanggalMulai: true,
      });
      expect(dikosongkan.tanggalMulaiPembukuan).toBe('');
      expect(getPengaturanPembukuan(db).tanggalMulaiPembukuan).toBe('');
    } finally {
      db.close();
    }
  });
});

describe('AKT-14 — tolak tanggal jurnal di masa depan', () => {
  const SEKARANG = '2026-01-10';
  const PESAN = 'Tanggal jurnal tidak boleh di masa depan.';

  it('menerima tanggal hari ini dan menolak tanggal besok lewat validasi, posting, dan tanpa menulis audit', () => {
    const { db } = freshDb();
    try {
      const hariIni = {
        header: header({ id: 'j-hari-ini', tanggal: SEKARANG, no_bukti: 'JU-2026-0400' }),
        baris: pasangan(),
      };

      const validasiHariIni = validasiJurnalDb(db, hariIni, { sekarang: SEKARANG });
      expect(validasiHariIni.boleh, validasiHariIni.errors.join(' ')).toBe(true);
      expect(validasiHariIni.errors).not.toContain(PESAN);

      const tersimpan = postingJurnal(db, hariIni, { sekarang: SEKARANG });
      expect(tersimpan.tersimpan, tersimpan.errors.join(' ')).toBe(true);
      expect(tersimpan.errors).not.toContain(PESAN);
      expect(jumlahJurnal(db)).toBe(1);

      const besok = {
        header: header({ id: 'j-besok', tanggal: '2026-01-11', no_bukti: 'JU-2026-0401' }),
        baris: pasangan(),
      };
      const validasiBesok = validasiJurnalDb(db, besok, { sekarang: SEKARANG });
      expect(validasiBesok.boleh).toBe(false);
      expect(validasiBesok.errors).toContain(PESAN);

      const auditSebelum = listAuditLog(db).length;
      const ditolak = postingJurnal(db, besok, { sekarang: SEKARANG });
      expect(ditolak.tersimpan).toBe(false);
      expect(ditolak.errors).toContain(PESAN);
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toHaveLength(auditSebelum);
    } finally {
      db.close();
    }
  });

  it('konteks default memakai tanggal lokal WITA, bukan UTC', () => {
    vi.useFakeTimers();
    try {
      // 23:30 UTC = 07:30 WITA tanggal berikutnya.
      vi.setSystemTime(new Date('2026-10-23T23:30:00Z'));
      const { db } = freshDb();
      try {
        const ctx = buatKonteksPosting(db, header());
        expect(ctx.sekarang).toBe('2026-10-24');
      } finally {
        db.close();
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('AKT-16 — larang jurnal penutup manual P&L → ekuitas', () => {
  it.each([
    ['pendapatan → ekuitas', '4005', '3000'],
    ['beban → ekuitas', '5000', '3000'],
    ['ekuitas → beban', '3000', '5000'],
  ])(
    'menolak %s dengan pesan penutup manual dan tidak menulis jurnal/audit',
    (_, debit, kredit) => {
      const { db } = freshDb();
      try {
        const input = {
          header: header({
            id: `j-tutup-${debit}-${kredit}`,
            no_bukti: '',
            keterangan: 'Penutup manual',
          }),
          baris: pasangan(debit, kredit),
        };

        const validasi = validasiJurnalDb(db, input);
        expect(validasi.boleh).toBe(false);
        expect(validasi.errors).toContain(PESAN_JURNAL_PENUTUP_MANUAL);

        const hasil = postingJurnal(db, input);
        expect(hasil.tersimpan).toBe(false);
        expect(hasil.errors).toContain(PESAN_JURNAL_PENUTUP_MANUAL);
        expect(jumlahJurnal(db)).toBe(0);
        expect(db.prepare('SELECT COUNT(*) AS c FROM jurnal_baris').get()).toEqual({ c: 0 });
        expect(listAuditLog(db)).toEqual([]);
      } finally {
        db.close();
      }
    },
  );

  it('tetap mengizinkan jurnal P&L murni, beban dibayar kas, dan modal murni', () => {
    const { db } = freshDb();
    try {
      // Modal murni: D kas / K 3000 (tanpa P&L).
      const modal = postingJurnal(db, {
        header: header({
          id: 'j-modal-akt16',
          no_bukti: 'JU-2026-0501',
          keterangan: 'Setoran modal',
        }),
        baris: pasangan('1001', '3000', 1_000_000),
      });
      expect(modal.tersimpan, modal.errors.join(' ')).toBe(true);

      // P&L murni: D kas / K pendapatan (tanpa ekuitas).
      const pendapatan = postingJurnal(db, {
        header: header({
          id: 'j-pendapatan-akt16',
          no_bukti: 'JU-2026-0502',
          keterangan: 'Terima uang parkir',
        }),
        baris: pasangan('1001', '4005', 50_000),
      });
      expect(pendapatan.tersimpan, pendapatan.errors.join(' ')).toBe(true);

      // Beban dibayar kas, bukan ditutup ke ekuitas.
      const beban = postingJurnal(db, {
        header: header({
          id: 'j-beban-akt16',
          no_bukti: 'JU-2026-0503',
          keterangan: 'Bayar listrik',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 25_000),
      });
      expect(beban.tersimpan, beban.errors.join(' ')).toBe(true);

      expect(jumlahJurnal(db)).toBe(3);
    } finally {
      db.close();
    }
  });

  it('mengizinkan alur dua jurnal untuk beban dibayar pemilik: beban/kas lalu kas/modal', () => {
    const { db } = freshDb();
    try {
      const modal = postingJurnal(db, {
        header: header({
          id: 'j-modal-pemilik',
          no_bukti: 'JU-2026-0510',
          keterangan: 'Setoran modal pemilik',
        }),
        baris: pasangan('1001', '3000', 200_000),
      });
      expect(modal.tersimpan, modal.errors.join(' ')).toBe(true);

      const beban = postingJurnal(db, {
        header: header({
          id: 'j-beban-pemilik',
          no_bukti: 'JU-2026-0511',
          keterangan: 'Beban dibayar pemilik',
          jenis: 'BAYAR',
        }),
        baris: pasangan('5000', '1001', 75_000),
      });
      expect(beban.tersimpan, beban.errors.join(' ')).toBe(true);
      expect(jumlahJurnal(db)).toBe(2);
    } finally {
      db.close();
    }
  });

  it('SALDO_AWAL pertama boleh memuat akun P&L; SALDO_AWAL kedua ditolak DB', () => {
    const { db } = freshDb();
    try {
      const saldoAwal = postingSaldoAwal(db, {
        header: header({
          id: 'j-saldo-awal-akt16',
          tanggal: '2026-01-01',
          no_bukti: 'SA-2026-0501',
          keterangan: 'Saldo awal',
          jenis: 'SALDO_AWAL',
        }),
        baris: pasangan('5000', '3000', 10_000),
      });
      expect(saldoAwal.tersimpan, saldoAwal.errors.join(' ')).toBe(true);

      // DB-04: partial unique index hanya mengizinkan satu jurnal SALDO_AWAL.
      const campuran = postingSaldoAwal(db, {
        header: header({
          id: 'j-saldo-awal-campuran',
          tanggal: '2026-01-01',
          no_bukti: 'SA-2026-0502',
          keterangan: 'Saldo awal campuran',
          jenis: 'SALDO_AWAL',
        }),
        baris: pasangan('1001', '3000', 1_000_000),
      });
      expect(campuran.tersimpan).toBe(false);
      expect(campuran.errors.join(' ')).toMatch(/UNIQUE|saldo awal/i);

      expect(jumlahJurnal(db)).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe('AKT-25 — insert mentah tidak memakai nama publik netral', () => {
  it('repository hanya mengekspor insertJurnalTervalidasi, bukan insertJurnal', () => {
    // Jalur produksi wajib lewat postingJurnal/koreksi. Nama `insertJurnal`
    // sengaja tidak ada agar pemanggil baru tidak mengira insert mentah aman.
    expect('insertJurnal' in repository).toBe(false);
    expect(typeof repository.insertJurnalTervalidasi).toBe('function');
  });
});

describe('AKT-29 — ketahanan validasi input & nominal aman', () => {
  it('input/header/baris null dikembalikan sebagai error validasi, bukan exception', () => {
    const { db } = freshDb();
    try {
      const ctx = buatKonteksPosting(db, header());

      expect(() => validasiJurnal(null, ctx)).not.toThrow();
      const kosong = validasiJurnal(null, ctx);
      expect(kosong.boleh).toBe(false);
      expect(kosong.errors).toContain(PESAN_INPUT_JURNAL_TIDAK_VALID);

      const tanpaHeader = validasiJurnal(
        { header: null, baris: pasangan() } as unknown as JurnalInput,
        ctx,
      );
      expect(tanpaHeader.boleh).toBe(false);
      expect(tanpaHeader.errors).toContain(PESAN_INPUT_JURNAL_TIDAK_VALID);

      const barisNull = validasiJurnal(
        { header: header(), baris: [null, undefined] } as unknown as JurnalInput,
        ctx,
      );
      expect(barisNull.boleh).toBe(false);
      expect(barisNull.errors.join(' ')).toMatch(/Baris 1/);
      expect(barisNull.errors.join(' ')).toMatch(/Baris 2/);

      // postingJurnal juga tidak boleh melempar sebelum validator mengembalikan
      // error, dan tidak boleh menulis jurnal/audit apa pun.
      const postingNull = postingJurnal(db, null as unknown as JurnalInput);
      expect(postingNull.tersimpan).toBe(false);
      expect(postingNull.errors.length).toBeGreaterThan(0);

      const postingTanpaHeader = postingJurnal(db, {
        header: null,
        baris: pasangan(),
      } as unknown as JurnalInput);
      expect(postingTanpaHeader.tersimpan).toBe(false);
      expect(postingTanpaHeader.errors.length).toBeGreaterThan(0);

      expect(jumlahJurnal(db)).toBe(0);
      expect(listAuditLog(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('menolak nominal di luar safe integer di posting, form, repository, panjar, dan utang usaha', () => {
    const { db } = freshDb();
    try {
      // 2^53 adalah integer menurut Number.isInteger, tetapi bukan safe integer.
      const tidakAman = Number.MAX_SAFE_INTEGER + 1;
      const input = {
        header: header({ id: 'j-besar', no_bukti: 'JU-2026-9999' }),
        baris: pasangan('1001', '4005', tidakAman),
      };

      const validasi = validasiJurnalDb(db, input);
      expect(validasi.boleh).toBe(false);
      expect(validasi.errors.join(' ')).toMatch(/Baris 1: debit/);
      expect(validasi.errors.join(' ')).toMatch(/Baris 2: kredit/);

      const hasil = postingJurnal(db, input);
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/bilangan bulat/);
      expect(jumlahJurnal(db)).toBe(0);

      expect(() => insertJurnalTervalidasi(db, input.header, input.baris)).toThrow(
        /bilangan bulat/,
      );

      expect(() =>
        buatJurnalTerimaUang({
          tanggal: '2026-01-02',
          nominal: tidakAman,
          keterangan: 'Nominal tidak aman',
          akunKas: '1001',
          akunLawan: '4005',
        }),
      ).toThrow(/bilangan bulat/);

      const panjar = serahkanPanjar(db, {
        tanggal: '2026-01-02',
        penerima: 'Uji nominal',
        jumlah: tidakAman,
        akunKasSumber: '1001',
      });
      expect(panjar.tersimpan).toBe(false);
      expect(panjar.errors.join(' ')).toMatch(/bilangan bulat/);

      expect(() =>
        buatJurnalCatatUtangUsaha({
          tanggal: '2026-01-02',
          nominal: tidakAman,
          keterangan: 'Nominal tidak aman',
          akunBeban: '5003',
        }),
      ).toThrow(/bilangan bulat/);

      expect(jumlahJurnal(db)).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('AUD2-04 — akun kontrol panjar/pinjaman dikunci dari Jurnal Umum', () => {
  const PESAN_1040 =
    'Akun 1040 UANG PANJAR adalah akun kontrol panjar dan tidak boleh diposting lewat Jurnal Umum. Gunakan menu Buku Panjar.';
  const PESAN_2050 =
    'Akun 2050 HUTANG LAIN-LAIN adalah akun kontrol pinjaman dan tidak boleh diposting lewat Jurnal Umum. Gunakan menu Pinjaman LPD (atau 2060 HUTANG USAHA untuk utang usaha).';

  it('menolak UMUM yang memakai 1040/2050 dengan pesan tepat dan tidak menulis jurnal', () => {
    const { db } = freshDb();
    try {
      const ctx = buatKonteksPosting(db, header({ jenis: 'UMUM' }));

      const panjar = validasiJurnal(
        {
          header: header({ id: 'j-umum-1040', jenis: 'UMUM' }),
          baris: pasangan('1040', '1001'),
        },
        ctx,
      );
      expect(panjar.boleh).toBe(false);
      expect(panjar.errors).toContain(PESAN_1040);

      const pinjaman = validasiJurnal(
        {
          header: header({ id: 'j-umum-2050', jenis: 'UMUM' }),
          baris: pasangan('1001', '2050'),
        },
        ctx,
      );
      expect(pinjaman.boleh).toBe(false);
      expect(pinjaman.errors).toContain(PESAN_2050);

      const hasil = postingJurnal(db, {
        header: header({ id: 'j-umum-kontrol', jenis: 'UMUM' }),
        baris: [
          { akun_kode: '1040', debit: 100_000, kredit: 0 },
          { akun_kode: '2050', debit: 0, kredit: 100_000 },
        ],
      });
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors).toContain(PESAN_1040);
      expect(hasil.errors).toContain(PESAN_2050);
      expect(jumlahJurnal(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  it('mengizinkan PANJAR/HUTANG/SALDO_AWAL/REVERSAL dan konteks koreksi saldo awal', () => {
    const { db } = freshDb();
    try {
      const ctx = buatKonteksPosting(db, header());
      const kasus: [label: string, input: JurnalInput][] = [
        [
          'PANJAR',
          {
            header: header({ id: 'j-panjar', jenis: 'PANJAR' }),
            baris: pasangan('1040', '1001'),
          },
        ],
        [
          'HUTANG',
          {
            header: header({ id: 'j-hutang', jenis: 'HUTANG' }),
            baris: pasangan('1001', '2050'),
          },
        ],
        [
          'SALDO_AWAL',
          {
            header: header({ id: 'j-saldo-awal', jenis: 'SALDO_AWAL' }),
            baris: [
              { akun_kode: '1040', debit: 100_000, kredit: 0 },
              { akun_kode: '1001', debit: 50_000, kredit: 0 },
              { akun_kode: '2050', debit: 0, kredit: 150_000 },
            ],
          },
        ],
        [
          'REVERSAL 1040',
          {
            header: header({ id: 'j-reversal-panjar', jenis: 'REVERSAL' }),
            baris: pasangan('1001', '1040'),
          },
        ],
        [
          'REVERSAL 2050',
          {
            header: header({ id: 'j-reversal-pinjaman', jenis: 'REVERSAL' }),
            baris: pasangan('2050', '1001'),
          },
        ],
      ];

      for (const [label, input] of kasus) {
        const hasil = validasiJurnal(input, ctx);
        expect(hasil.errors, `${label}: ${hasil.errors.join(' ')}`).toEqual([]);
        expect(hasil.boleh, label).toBe(true);
      }

      const koreksi = validasiJurnal(
        {
          header: header({ id: 'j-koreksi-saldo-awal', jenis: 'UMUM' }),
          baris: [
            { akun_kode: '1040', debit: 100_000, kredit: 0 },
            { akun_kode: '2050', debit: 0, kredit: 100_000 },
          ],
        },
        { ...ctx, koreksiSaldoAwal: true },
      );
      expect(koreksi.errors, koreksi.errors.join(' ')).toEqual([]);
      expect(koreksi.boleh).toBe(true);
    } finally {
      db.close();
    }
  });
});
