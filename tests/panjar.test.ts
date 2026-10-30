// P1-4: Form Panjar — serah & pertanggungjawaban.
//
// Fokus pembuktian akuntansi:
// - Serah: D 1040 UANG PANJAR / K kas sumber (satu jurnal PANJAR).
// - Close pas: D beban / K 1040; 1040 kembali nol.
// - Close sisa: D beban + D kas sisa / K 1040.
// - Close kurang: butuh konfirmasi; D beban total / K 1040 jumlah panjar /
//   K kas sebesar kekurangan.
// - Metadata + panjar_item tersimpan, tanggal close divalidasi, close ganda
//   ditolak, Neraca Saldo selalu nol, audit PANJAR-OPEN/CLOSE tercatat.

import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DDL, openDb, SCHEMA_VERSION } from '../src/db/database.js';
import {
  closePanjarV2,
  getPanjar,
  listPanjarItemsV2,
  listPanjarV2,
  serahkanPanjar,
} from '../src/db/panjar.js';
import { postingJurnal } from '../src/db/posting.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import {
  getJurnal,
  listAuditLog,
  listJurnal,
  listJurnalBaris,
} from '../src/db/repository.js';
import {
  buatJurnalPanjarClose,
  buatJurnalPanjarSerah,
} from '../src/core/forms.js';
import { neracaSaldo, saldoAkun, totalKas } from '../src/core/reports.js';
import { AKUN_MODAL, KAS_KODES } from '../src/db/coa.js';
import type { JurnalBarisInput } from '../src/core/types.js';
import { PanjarTab } from '../src/renderer/components/PanjarTab.js';

const RP = (rupiah: number): number => rupiah * 100;

const D = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: nominal,
  kredit: 0,
});
const K = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: 0,
  kredit: nominal,
});

/** DB bersih + kas 1001 Rp 10.000.000 (lawan modal). */
function dbKas(): Database.Database {
  const db = openDb(':memory:');
  const awal = postingJurnal(db, {
    header: {
      id: 'awal',
      tanggal: '2026-01-01',
      no_bukti: 'P1-4-0000',
      keterangan: 'Saldo awal uji panjar',
      jenis: 'SALDO_AWAL',
    },
    baris: [D('1001', RP(10_000_000)), K(AKUN_MODAL, RP(10_000_000))],
  });
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return db;
}

function serah(
  db: Database.Database,
  id = 'p1',
  jumlah = RP(1_000_000),
): ReturnType<typeof serahkanPanjar> {
  return serahkanPanjar(db, {
    id,
    jurnalId: `j-${id}`,
    tanggal: '2026-02-01',
    penerima: 'Panitia Piodalan',
    jumlah,
    akunKasSumber: '1001',
    noBukti: `P1-4-${id}`,
  });
}

function ringkasBaris(jurnalId: string, db: Database.Database) {
  return listJurnalBaris(db, jurnalId).map((b) => ({
    akun: b.akun_kode,
    debit: b.debit,
    kredit: b.kredit,
  }));
}

describe('P1-4 — serah panjar', () => {
  it('membuat jurnal D 1040 / K kas, saldo 1040 naik, metadata OPEN tersimpan', () => {
    const db = dbKas();
    try {
      const hasil = serah(db);
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.panjar).toMatchObject({
        id: 'p1',
        status: 'OPEN',
        jumlah: RP(1_000_000),
        akun_kas_sumber: '1001',
        jurnal_open_id: 'j-p1',
        jurnal_close_id: null,
        tanggal_close: null,
      });

      const jurnal = getJurnal(db, 'j-p1');
      expect(jurnal).toMatchObject({ jenis: 'PANJAR', tanggal: '2026-02-01' });
      expect(ringkasBaris('j-p1', db)).toEqual([
        { akun: '1040', debit: RP(1_000_000), kredit: 0 },
        { akun: '1001', debit: 0, kredit: RP(1_000_000) },
      ]);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1040')).toBe(RP(1_000_000));
      expect(saldoAkun(baris, '1001')).toBe(RP(9_000_000));

      const daftar = listPanjarV2(db);
      expect(daftar).toHaveLength(1);
      expect(daftar[0]).toMatchObject({
        id: 'p1',
        status: 'OPEN',
        total_realisasi: 0,
      });
      expect(getPanjar(db, 'p1')?.jurnal_open_id).toBe('j-p1');
    } finally {
      db.close();
    }
  });

  it('menolak penerima kosong, jumlah tidak valid, dan kas sumber bukan kas', () => {
    const db = dbKas();
    try {
      expect(
        serahkanPanjar(db, {
          tanggal: '2026-02-01',
          penerima: '   ',
          jumlah: RP(10_000),
          akunKasSumber: '1001',
        }).errors.join(' '),
      ).toMatch(/penerima/i);
      expect(
        serahkanPanjar(db, {
          tanggal: '2026-02-01',
          penerima: 'Panitia',
          jumlah: 0,
          akunKasSumber: '1001',
        }).errors.join(' '),
      ).toMatch(/jumlah/i);
      expect(
        serahkanPanjar(db, {
          tanggal: '2026-02-01',
          penerima: 'Panitia',
          jumlah: 1.5,
          akunKasSumber: '1001',
        }).errors.join(' '),
      ).toMatch(/jumlah/i);
      expect(
        serahkanPanjar(db, {
          tanggal: '2026-02-01',
          penerima: 'Panitia',
          jumlah: RP(10_000),
          akunKasSumber: '5004',
        }).errors.join(' '),
      ).toMatch(/kas\/bank/);
      expect(listJurnal(db)).toHaveLength(1); // hanya saldo awal
      expect(listPanjarV2(db)).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

describe('P1-4 — pertanggungjawaban panjar', () => {
  it('close pas: D beban total / K 1040, 1040 kembali nol, item tersimpan', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const hasil = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-01',
        items: [
          { kategori_baga: '5004', nominal: RP(600_000) },
          { kategori_baga: '5010', nominal: RP(400_000) },
        ],
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.totalRealisasi).toBe(RP(1_000_000));
      expect(hasil.sisa).toBe(0);
      expect(hasil.kurang).toBe(0);
      expect(hasil.panjar).toMatchObject({
        status: 'CLOSED',
        tanggal_close: '2026-03-01',
      });

      const closeId = hasil.panjar?.jurnal_close_id;
      expect(closeId).toBeTruthy();
      expect(closeId).not.toBe('j-p1'); // jurnal close adalah jurnal baru
      expect(ringkasBaris(closeId!, db)).toEqual([
        { akun: '5004', debit: RP(600_000), kredit: 0 },
        { akun: '5010', debit: RP(400_000), kredit: 0 },
        { akun: '1040', debit: 0, kredit: RP(1_000_000) },
      ]);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1040')).toBe(0);
      // Pas: kas tidak berubah lagi setelah serah.
      expect(saldoAkun(baris, '1001')).toBe(RP(9_000_000));

      const items = listPanjarItemsV2(db, 'p1');
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.kategori_baga)).toEqual(['5004', '5010']);
      expect(items.every((i) => i.jurnal_id === closeId)).toBe(true);
      expect(items.every((i) => typeof i.id === 'number')).toBe(true);

      const daftar = listPanjarV2(db, 'CLOSED');
      expect(daftar[0]).toMatchObject({
        status: 'CLOSED',
        total_realisasi: RP(1_000_000),
        sisa: 0,
        kurang: 0,
      });
    } finally {
      db.close();
    }
  });

  it('close sisa: D beban + D kas sisa / K 1040, kas kembali', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const hasil = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-05',
        items: [{ kategori_baga: '5004', nominal: RP(600_000) }],
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.totalRealisasi).toBe(RP(600_000));
      expect(hasil.sisa).toBe(RP(400_000));
      expect(hasil.kurang).toBe(0);

      expect(ringkasBaris(hasil.panjar!.jurnal_close_id!, db)).toEqual([
        { akun: '5004', debit: RP(600_000), kredit: 0 },
        { akun: '1001', debit: RP(400_000), kredit: 0 },
        { akun: '1040', debit: 0, kredit: RP(1_000_000) },
      ]);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1040')).toBe(0);
      expect(saldoAkun(baris, '1001')).toBe(RP(9_400_000));
      expect(saldoAkun(baris, '5004')).toBe(RP(600_000));
    } finally {
      db.close();
    }
  });

  it('close kurang: wajib konfirmasi; D beban / K 1040 jumlah panjar / K kas kurang', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const jurnalSebelum = listJurnal(db).length;

      const tanpaKonfirmasi = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-10',
        items: [{ kategori_baga: '5004', nominal: RP(1_200_000) }],
      });
      expect(tanpaKonfirmasi.tersimpan).toBe(false);
      expect(tanpaKonfirmasi.perluKonfirmasi).toBe(true);
      expect(tanpaKonfirmasi.errors).toEqual([]);
      expect(tanpaKonfirmasi.peringatan.join(' ')).toMatch(/melebihi panjar/i);
      expect(tanpaKonfirmasi.kurang).toBe(RP(200_000));
      expect(listJurnal(db)).toHaveLength(jurnalSebelum);
      expect(getPanjar(db, 'p1')?.status).toBe('OPEN');

      // AKT-08: konfirmasi overrun tanpa alasan ditolak sebelum menulis
      // jurnal, item, maupun audit.
      const auditSebelum = listAuditLog(db, { aksi: 'PANJAR-CLOSE' }).length;
      const tanpaAlasan = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-10',
        items: [{ kategori_baga: '5004', nominal: RP(1_200_000) }],
        konfirmasiKurang: true,
      });
      expect(tanpaAlasan.tersimpan).toBe(false);
      expect(tanpaAlasan.errors.join(' ')).toMatch(/melebihi panjar sebesar/i);
      expect(tanpaAlasan.errors.join(' ')).toMatch(/alasan minimal 5 karakter/i);
      expect(listJurnal(db)).toHaveLength(jurnalSebelum);
      expect(getPanjar(db, 'p1')?.status).toBe('OPEN');
      expect(listPanjarItemsV2(db, 'p1')).toHaveLength(0);
      expect(listAuditLog(db, { aksi: 'PANJAR-CLOSE' })).toHaveLength(
        auditSebelum,
      );

      const alasan = 'Kekurangan disetujui panitia';
      const hasil = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-10',
        items: [{ kategori_baga: '5004', nominal: RP(1_200_000) }],
        konfirmasiKurang: true,
        alasanKurang: alasan,
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.kurang).toBe(RP(200_000));
      expect(hasil.sisa).toBe(0);

      expect(ringkasBaris(hasil.panjar!.jurnal_close_id!, db)).toEqual([
        { akun: '5004', debit: RP(1_200_000), kredit: 0 },
        { akun: '1040', debit: 0, kredit: RP(1_000_000) },
        { akun: '1001', debit: 0, kredit: RP(200_000) },
      ]);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1040')).toBe(0);
      expect(saldoAkun(baris, '1001')).toBe(RP(8_800_000));
      expect(saldoAkun(baris, '5004')).toBe(RP(1_200_000));
      expect(totalKas(baris, KAS_KODES)).toBe(RP(8_800_000));

      const audit = listAuditLog(db, { aksi: 'PANJAR-CLOSE' });
      expect(audit).toHaveLength(auditSebelum + 1);
      const data = JSON.parse(audit[0]!.data_baru_json) as {
        kurang: number;
        alasanKurang: string;
      };
      expect(data.kurang).toBe(RP(200_000));
      expect(data.alasanKurang).toBe(alasan);
    } finally {
      db.close();
    }
  });

  it('menolak tanggal close sebelum tanggal serah dan close ganda', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);

      const terlaluAwal = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-01-31',
        items: [{ kategori_baga: '5004', nominal: RP(100_000) }],
      });
      expect(terlaluAwal.tersimpan).toBe(false);
      expect(terlaluAwal.errors.join(' ')).toMatch(/tidak boleh sebelum/i);
      expect(listJurnal(db)).toHaveLength(2); // awal + serah
      expect(getPanjar(db, 'p1')?.status).toBe('OPEN');

      const pertama = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-02-01',
        items: [{ kategori_baga: '5004', nominal: RP(100_000) }],
      });
      expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);

      const kedua = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-02-02',
        items: [{ kategori_baga: '5004', nominal: RP(50_000) }],
      });
      expect(kedua.tersimpan).toBe(false);
      expect(kedua.errors.join(' ')).toMatch(/sudah ditutup/i);
      expect(listJurnal(db)).toHaveLength(3); // awal + serah + close
    } finally {
      db.close();
    }
  });

  it('Neraca Saldo selisih 0 dan audit PANJAR-OPEN/CLOSE tercatat', () => {
    const db = dbKas();
    try {
      expect(serah(db, 'p-sisa', RP(1_000_000)).tersimpan).toBe(true);
      expect(serah(db, 'p-kurang', RP(800_000)).tersimpan).toBe(true);
      expect(
        closePanjarV2(db, {
          id: 'p-sisa',
          tanggalClose: '2026-03-01',
          items: [{ kategori_baga: '5004', nominal: RP(700_000) }],
        }).tersimpan,
      ).toBe(true);
      expect(
        closePanjarV2(db, {
          id: 'p-kurang',
          tanggalClose: '2026-03-02',
          items: [{ kategori_baga: '5010', nominal: RP(900_000) }],
          konfirmasiKurang: true,
          alasanKurang: 'Kekurangan belanja disetujui',
        }).tersimpan,
      ).toBe(true);

      const baris = listBarisJurnal(db);
      const ns = neracaSaldo(baris);
      expect(ns.selisih).toBe(0);
      expect(ns.totalDebit).toBe(ns.totalKredit);
      expect(saldoAkun(baris, '1040')).toBe(0);

      const openAudit = listAuditLog(db, { aksi: 'PANJAR-OPEN' });
      const closeAudit = listAuditLog(db, { aksi: 'PANJAR-CLOSE' });
      expect(openAudit.length).toBeGreaterThanOrEqual(2);
      expect(closeAudit.length).toBeGreaterThanOrEqual(2);
      expect(openAudit[0]?.data_baru_json).toContain('jurnal_open_id');
      expect(closeAudit[0]?.data_baru_json).toContain('kategori_baga');
      expect(closeAudit[0]?.data_baru_json).toContain('totalRealisasi');
    } finally {
      db.close();
    }
  });
});

describe('P1-4 — builder murni buatJurnalPanjarClose', () => {
  it('menyusun pas, sisa, dan kurang dengan total seimbang', () => {
    const dasar = {
      tanggal: '2026-03-01',
      penerima: 'Panitia',
      akunKas: '1001',
      jumlahPanjar: RP(1_000_000),
    };

    const pas = buatJurnalPanjarClose({
      ...dasar,
      items: [
        { akun: '5004', nominal: RP(500_000) },
        { akun: '5010', nominal: RP(500_000) },
      ],
    });
    expect(pas.input.header.jenis).toBe('PANJAR');
    expect(pas.input.baris.map((b) => [b.akun_kode, b.debit, b.kredit])).toEqual([
      ['5004', RP(500_000), 0],
      ['5010', RP(500_000), 0],
      ['1040', 0, RP(1_000_000)],
    ]);
    expect(pas).toMatchObject({ totalRealisasi: RP(1_000_000), sisa: 0, kurang: 0 });
    expect(pas.perluKonfirmasi).toBe(false);

    const sisa = buatJurnalPanjarClose({
      ...dasar,
      items: [{ akun: '5004', nominal: RP(600_000) }],
    });
    expect(sisa.input.baris.map((b) => [b.akun_kode, b.debit, b.kredit])).toEqual([
      ['5004', RP(600_000), 0],
      ['1001', RP(400_000), 0],
      ['1040', 0, RP(1_000_000)],
    ]);
    expect(sisa).toMatchObject({ sisa: RP(400_000), kurang: 0 });

    const kurang = buatJurnalPanjarClose({
      ...dasar,
      items: [{ akun: '5004', nominal: RP(1_250_000) }],
    });
    expect(kurang.input.baris.map((b) => [b.akun_kode, b.debit, b.kredit])).toEqual([
      ['5004', RP(1_250_000), 0],
      ['1040', 0, RP(1_000_000)],
      ['1001', 0, RP(250_000)],
    ]);
    expect(kurang).toMatchObject({
      totalRealisasi: RP(1_250_000),
      sisa: 0,
      kurang: RP(250_000),
      perluKonfirmasi: true,
    });

    for (const hasil of [pas, sisa, kurang]) {
      const debit = hasil.input.baris.reduce((s, b) => s + b.debit, 0);
      const kredit = hasil.input.baris.reduce((s, b) => s + b.kredit, 0);
      expect(debit).toBe(kredit);
    }
  });

  it('menolak item kosong, akun kas/non-beban, nominal invalid, dan tanggal invalid', () => {
    const dasar = {
      tanggal: '2026-03-01',
      akunKas: '1001',
      jumlahPanjar: RP(1_000_000),
    };
    expect(() => buatJurnalPanjarClose({ ...dasar, items: [] })).toThrow(/kosong/i);
    expect(() =>
      buatJurnalPanjarClose({ ...dasar, items: [{ akun: '1001', nominal: 100 }] }),
    ).toThrow(/kas\/bank/i);
    expect(() =>
      buatJurnalPanjarClose({ ...dasar, items: [{ akun: '1040', nominal: 100 }] }),
    ).toThrow(/1040/i);
    expect(() =>
      buatJurnalPanjarClose({ ...dasar, items: [{ akun: '4005', nominal: 100 }] }),
    ).toThrow(/bukan akun BEBAN/i);
    expect(() =>
      buatJurnalPanjarClose({ ...dasar, items: [{ akun: '9999', nominal: 100 }] }),
    ).toThrow(/tidak dikenal/i);
    expect(() =>
      buatJurnalPanjarClose({ ...dasar, items: [{ akun: '5004', nominal: 0 }] }),
    ).toThrow(/Nominal/i);
    expect(() =>
      buatJurnalPanjarClose({ ...dasar, items: [{ akun: '5004', nominal: 1.5 }] }),
    ).toThrow(/Nominal/i);
    expect(() =>
      buatJurnalPanjarClose({ ...dasar, jumlahPanjar: 0, items: [{ akun: '5004', nominal: 100 }] }),
    ).toThrow(/Nominal/i);
    expect(() =>
      buatJurnalPanjarClose({
        ...dasar,
        tanggal: '2026-02-31',
        items: [{ akun: '5004', nominal: 100 }],
      }),
    ).toThrow(/Tanggal/i);
    // Builder tidak butuh data panjar; validasi tanggalClose >= tanggal serah
    // dilakukan adapter DB (lihat test di atas).
    expect(() =>
      buatJurnalPanjarSerah({
        tanggal: '2026-02-01',
        akunKas: '1001',
        nominal: RP(100_000),
        keterangan: 'Panjar',
      }),
    ).not.toThrow();
  });
});

describe('P1-4/DB-06 — metadata panjar v2 dipertahankan saat DB dibuka ulang', () => {
  it('tidak membuang panjar dari DB v8 hanya karena versinya lama', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-panjar-'));
    const path = join(dir, 'pura.db');
    try {
      // DB v8: skema panjar v2 sudah ada, termasuk metadata jurnal.
      const lama = new Database(path);
      lama.exec(DDL);
      const insAkun = lama.prepare(
        `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif)
         VALUES (?, ?, ?, ?, 1)`,
      );
      insAkun.run('1001', 'KAS', 'ASET', 'DEBIT');
      insAkun.run('1040', 'UANG PANJAR', 'ASET', 'DEBIT');
      insAkun.run('5004', 'BEBAN KONSUMSI', 'BEBAN', 'DEBIT');
      lama
        .prepare(
          `INSERT INTO jurnal
             (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
           VALUES ('j-p-lama', '2025-01-01', '', 'Panjar lama', 'PANJAR',
                   'j-p-lama', NULL, '2025-01-01T00:00:00.000Z')`,
        )
        .run();
      lama
        .prepare(
          `INSERT INTO panjar
             (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
              tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
           VALUES ('p-lama', '2025-01-01', 'Lama', 100, '1001', 'OPEN',
                   NULL, 'j-p-lama', NULL, '2025-01-01T00:00:00.000Z')`,
        )
        .run();
      lama
        .prepare(
          `INSERT INTO panjar_item (panjar_id, kategori_baga, nominal, jurnal_id)
           VALUES ('p-lama', '5004', 50, 'j-p-lama')`,
        )
        .run();
      lama.pragma('user_version = 8');
      lama.close();

      const db = openDb(path);
      try {
        expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
        expect(getPanjar(db, 'p-lama')).toMatchObject({
          status: 'OPEN',
          jurnal_open_id: 'j-p-lama',
        });
        expect(listPanjarV2(db).map((p) => p.id)).toEqual(['p-lama']);
        expect(listPanjarItemsV2(db, 'p-lama')).toHaveLength(1);

        expect(
          postingJurnal(db, {
            header: {
              id: 'm-awal',
              tanggal: '2026-01-01',
              no_bukti: 'P1-4-M000',
              keterangan: 'Modal',
              jenis: 'SALDO_AWAL',
            },
            baris: [D('1001', RP(5_000_000)), K(AKUN_MODAL, RP(5_000_000))],
          }).tersimpan,
        ).toBe(true);
        expect(
          serahkanPanjar(db, {
            id: 'p-v4',
            jurnalId: 'j-v4',
            tanggal: '2026-02-01',
            penerima: 'Panitia V4',
            jumlah: RP(500_000),
            akunKasSumber: '1001',
          }).tersimpan,
        ).toBe(true);
      } finally {
        db.close();
      }

      // Buka ulang: migrasi idempoten, metadata & item panjar v4 tidak hilang.
      const db2 = openDb(path);
      try {
        expect(Number(db2.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
        expect(getPanjar(db2, 'p-v4')).toMatchObject({
          status: 'OPEN',
          jumlah: RP(500_000),
          jurnal_open_id: 'j-v4',
        });
        expect(
          closePanjarV2(db2, {
            id: 'p-v4',
            tanggalClose: '2026-03-01',
            items: [{ kategori_baga: '5004', nominal: RP(200_000) }],
          }).tersimpan,
        ).toBe(true);
      } finally {
        db2.close();
      }

      const db3 = openDb(path);
      try {
        expect(getPanjar(db3, 'p-v4')?.status).toBe('CLOSED');
        expect(listPanjarItemsV2(db3, 'p-v4')).toHaveLength(1);
      } finally {
        db3.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('AKT-02 — close panjar menghormati guard saldo awal', () => {
  it('menolak close saat belum ada jurnal bila opsi wajibSaldoAwal aktif', () => {
    const db = openDb(':memory:');
    try {
      // Dokumen panjar tanpa jurnal open hanya mungkin dari data lama/rusak;
      // matikan FK sementara agar guard posting yang diuji, bukan FK.
      db.pragma('foreign_keys = OFF');
      db.prepare(
        `INSERT INTO panjar
           (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
            tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
         VALUES ('p-guard', '2026-02-01', 'Panitia Guard', ?, '1001', 'OPEN',
                 NULL, 'j-open-ghost', NULL, '2026-02-01T00:00:00.000Z')`,
      ).run(RP(100_000));
      db.pragma('foreign_keys = ON');

      const input = {
        id: 'p-guard',
        tanggalClose: '2026-02-02',
        items: [{ kategori_baga: '5004', nominal: RP(100_000) }],
        wajibSaldoAwal: true as const,
      };

      const ditolak = closePanjarV2(db, input);
      expect(ditolak.tersimpan).toBe(false);
      expect(ditolak.errors.join(' ')).toMatch(/Belum ada saldo awal/);
      expect(listJurnal(db)).toHaveLength(0);

      const lanjut = closePanjarV2(db, {
        ...input,
        konfirmasiTanpaSaldoAwal: true,
      });
      expect(lanjut.tersimpan, lanjut.errors.join(' ')).toBe(true);
      expect(listJurnal(db)).toHaveLength(1);
      expect(getPanjar(db, 'p-guard')?.status).toBe('CLOSED');
    } finally {
      db.close();
    }
  });
});

describe('AKT-08 — UI konfirmasi overrun tanpa checkbox', () => {
  it('mengganti centang setuju dengan permintaan alasan minimal 5 karakter', () => {
    const html = renderToStaticMarkup(createElement(PanjarTab));

    expect(html).toContain('Pertanggungjawaban Panjar');
    expect(html).not.toContain('Saya setuju kekurangan');
    expect(html).not.toContain('Centang persetujuan');
    expect(html).toContain('sistem akan meminta alasan minimal 5 karakter');
  });
});
