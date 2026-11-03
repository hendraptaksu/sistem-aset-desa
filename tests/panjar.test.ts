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
  batalPanjarV2,
  batalkanPertanggungjawabanPanjar,
  closePanjarV2,
  getPanjar,
  listPanjarItemsV2,
  listPanjarV2,
  serahkanPanjar,
} from '../src/db/panjar.js';
import { auditIntegritas } from '../src/db/integritas.js';
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
import {
  rekonsiliasiPanjar,
  totalPanjarPerAkun,
} from '../src/core/rekonsiliasiPanjar.js';
import { neracaSaldo, saldoAkun, totalKas } from '../src/core/reports.js';
import { AKUN_MODAL, KAS_KODES } from '../src/db/coa.js';
import type { JurnalBarisInput, Panjar, PanjarItem } from '../src/core/types.js';
import { PanjarTab, PeringatanTahunPertanggungjawaban } from '../src/renderer/components/PanjarTab.js';

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

  it('header tanggal/jumlah/akun kas sama dengan jurnal serah dan stabil saat close', () => {
    const db = dbKas();
    try {
      const hasil = serah(db);
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

      const sebelum = getPanjar(db, 'p1');
      const jurnalOpen = getJurnal(db, 'j-p1');
      const barisOpen = listJurnalBaris(db, 'j-p1');
      const debitPanjar = barisOpen
        .filter((b) => b.akun_kode === '1040')
        .reduce((t, b) => t + b.debit, 0);
      const kreditKas = barisOpen
        .filter((b) => b.akun_kode !== '1040' && b.kredit > 0)
        .reduce((t, b) => t + b.kredit, 0);

      expect(sebelum?.tanggal).toBe(jurnalOpen?.tanggal);
      expect(sebelum?.jumlah).toBe(debitPanjar);
      expect(sebelum?.jumlah).toBe(kreditKas);
      expect(barisOpen.map((b) => b.akun_kode)).toContain(sebelum?.akun_kas_sumber);

      const tutup = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-02-02',
        items: [{ akun: '5004', nominal: RP(1_000_000) }],
      });
      expect(tutup.tersimpan, tutup.errors.join(' ')).toBe(true);

      const sesudah = getPanjar(db, 'p1');
      expect(sesudah).toMatchObject({
        tanggal: sebelum?.tanggal,
        jumlah: sebelum?.jumlah,
        akun_kas_sumber: sebelum?.akun_kas_sumber,
        jurnal_open_id: sebelum?.jurnal_open_id,
        status: 'CLOSED',
      });
      expect(getJurnal(db, sesudah!.jurnal_open_id!)?.tanggal).toBe(sesudah?.tanggal);
      expect(auditIntegritas(db).ok).toBe(true);
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

describe('DB-18 — detail nota per baris panjar', () => {
  it('dua nota dengan akun sama menjadi dua panjar_item, jurnal close tetap agregat', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const hasil = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-01',
        items: [
          {
            kategori_baga: '5004',
            nominal: RP(300_000),
            nota_nomor: 'N-001',
            nota_tanggal: '2026-02-10',
            toko: 'Toko A',
            keterangan: 'konsumsi rapat 1',
          },
          {
            kategori_baga: '5004',
            nominal: RP(400_000),
            nota_nomor: 'N-002',
            nota_tanggal: '2026-02-11',
            toko: 'Toko B',
            keterangan: 'konsumsi rapat 2',
          },
        ],
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.totalRealisasi).toBe(RP(700_000));
      expect(hasil.sisa).toBe(RP(300_000));

      // Dua nota akun 5004 digabung menjadi SATU baris debit jurnal close.
      expect(ringkasBaris(hasil.panjar!.jurnal_close_id!, db)).toEqual([
        { akun: '5004', debit: RP(700_000), kredit: 0 },
        { akun: '1001', debit: RP(300_000), kredit: 0 },
        { akun: '1040', debit: 0, kredit: RP(1_000_000) },
      ]);

      const items = listPanjarItemsV2(db, 'p1');
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.kategori_baga)).toEqual(['5004', '5004']);
      expect(items[0]).toMatchObject({
        nominal: RP(300_000),
        nota_nomor: 'N-001',
        nota_tanggal: '2026-02-10',
        toko: 'Toko A',
        keterangan: 'konsumsi rapat 1',
        jurnal_id: hasil.panjar!.jurnal_close_id,
      });
      expect(items[1]).toMatchObject({
        nominal: RP(400_000),
        nota_nomor: 'N-002',
        nota_tanggal: '2026-02-11',
        toko: 'Toko B',
        keterangan: 'konsumsi rapat 2',
        jurnal_id: hasil.panjar!.jurnal_close_id,
      });
      expect(listPanjarV2(db, 'CLOSED')[0]).toMatchObject({
        total_realisasi: RP(700_000),
      });
    } finally {
      db.close();
    }
  });

  it('menolak tanggal nota tidak valid/melewati tanggal close dan field kepanjangan', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const jurnalSebelum = listJurnal(db).length;

      for (const [nota, pola] of [
        [{ nota_tanggal: '2026-03-02' }, /tidak boleh setelah/i],
        [{ nota_tanggal: '2026-02-31' }, /tanggal nota tidak valid/i],
        [{ toko: 'x'.repeat(201) }, /toko\/penerima maks\. 200/i],
        [{ nota_nomor: 'x'.repeat(101) }, /nomor nota maks\. 100/i],
        [{ keterangan: 'x'.repeat(501) }, /keterangan maks\. 500/i],
      ] as const) {
        const hasil = closePanjarV2(db, {
          id: 'p1',
          tanggalClose: '2026-03-01',
          items: [
            { kategori_baga: '5004', nominal: RP(100_000), ...nota },
          ],
        });
        expect(hasil.tersimpan, String(nota)).toBe(false);
        expect(hasil.errors.join(' ')).toMatch(pola);
        expect(getPanjar(db, 'p1')?.status).toBe('OPEN');
      }

      expect(listJurnal(db)).toHaveLength(jurnalSebelum);
      expect(listPanjarItemsV2(db, 'p1')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('tanpa field nota tetap sah (legacy) dan tersimpan sebagai string kosong', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const hasil = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-01',
        items: [{ kategori_baga: '5004', nominal: RP(500_000) }],
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(listPanjarItemsV2(db, 'p1')[0]).toMatchObject({
        nota_nomor: '',
        nota_tanggal: '',
        toko: '',
        keterangan: '',
      });
    } finally {
      db.close();
    }
  });

  it('form close menampilkan input nomor/tanggal nota, toko, dan keterangan', () => {
    const html = renderToStaticMarkup(createElement(PanjarTab));
    for (const label of [
      'Nomor nota',
      'Tanggal nota',
      'Toko / penerima nota',
      'Akun beban',
      'Nominal (Rp)',
      'Keterangan baris (opsional)',
      '+ Tambah baris nota',
    ]) {
      expect(html, label).toContain(label);
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

describe('AUD2-06 — peringatan tahun pertanggungjawaban', () => {
  it('menampilkan kotak kuning saat tahun realisasi beda dari panjar & nota', () => {
    const html = renderToStaticMarkup(
      createElement(PeringatanTahunPertanggungjawaban, {
        tanggalClose: '2026-01-10',
        tanggalPanjar: '2025-12-20',
        notaTanggal: ['2025-12-18', ''],
      }),
    );

    expect(html).toContain('Perhatian');
    expect(html).toContain('bg-amber-50');
    expect(html).toContain('20 Des 2025');
    expect(html).toContain('18 Des 2025');
    expect(html).toContain('Laba Rugi tahun 2026');
    expect(html).toContain('bukan tahun 2025');
  });

  it('menampilkan peringatan bila hanya tanggal nota yang beda tahun', () => {
    const html = renderToStaticMarkup(
      createElement(PeringatanTahunPertanggungjawaban, {
        tanggalClose: '2026-01-10',
        tanggalPanjar: '2026-01-05',
        notaTanggal: ['2025-12-31'],
      }),
    );

    expect(html).toContain('31 Des 2025');
    expect(html).toContain('Laba Rugi tahun 2026');
  });

  it('tidak menampilkan peringatan bila semua tahun sama', () => {
    const html = renderToStaticMarkup(
      createElement(PeringatanTahunPertanggungjawaban, {
        tanggalClose: '2026-01-10',
        tanggalPanjar: '2026-01-05',
        notaTanggal: ['2026-01-08', ''],
      }),
    );

    expect(html).toBe('');
  });
});

describe('DB-19 — rekonsiliasi item panjar vs jurnal close', () => {
  it('close normal lolos audit; total realisasi dan total per akun = SUM item', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const hasil = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-01',
        items: [
          {
            kategori_baga: '5004',
            nominal: RP(300_000),
            nota_nomor: 'N-001',
            toko: 'Toko A',
          },
          {
            kategori_baga: '5010',
            nominal: RP(200_000),
            nota_nomor: 'N-002',
            toko: 'Toko B',
          },
          {
            kategori_baga: '5004',
            nominal: RP(100_000),
            nota_nomor: 'N-003',
            toko: 'Toko A',
          },
        ],
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

      const items = listPanjarItemsV2(db, 'p1');
      const totalItem = items.reduce((s, it) => s + it.nominal, 0);
      expect(items).toHaveLength(3);
      // Field nota/toko/keterangan DB-18 tetap terekspos di daftar item.
      expect(items[0]).toMatchObject({
        kategori_baga: '5004',
        nota_nomor: 'N-001',
        toko: 'Toko A',
        keterangan: '',
      });
      expect(totalItem).toBe(RP(600_000));
      expect(totalPanjarPerAkun(items)).toEqual([
        { akun: '5004', nominal: RP(400_000) },
        { akun: '5010', nominal: RP(200_000) },
      ]);

      expect(getPanjar(db, 'p1')?.total_realisasi).toBe(totalItem);
      expect(listPanjarV2(db, 'CLOSED')[0]?.total_realisasi).toBe(totalItem);
      // Close normal tidak boleh menghasilkan temuan integritas apa pun.
      expect(auditIntegritas(db).temuan).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('close ditolak bila panjar_item berubah setelah insert (guard transaksi)', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      // Simulasikan jalur tulis lain yang mengubah nominal setelah insert.
      db.exec(`
        CREATE TRIGGER uji_drift_panjar_item
        AFTER INSERT ON panjar_item
        BEGIN
          UPDATE panjar_item SET nominal = nominal + 100 WHERE id = NEW.id;
        END;
      `);

      const hasil = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-01',
        items: [{ kategori_baga: '5004', nominal: RP(600_000) }],
      });

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/tidak cocok dengan jurnal close/i);
      expect(hasil.errors.join(' ')).toMatch(/5004/);
      // Rollback menyeluruh: jurnal close, status, item, dan audit tidak ada.
      expect(listJurnal(db)).toHaveLength(2); // saldo awal + serah
      expect(getPanjar(db, 'p1')?.status).toBe('OPEN');
      expect(listPanjarItemsV2(db, 'p1')).toHaveLength(0);
      expect(listAuditLog(db, { aksi: 'PANJAR-CLOSE' })).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('helper rekonsiliasi menolak item eksternal yang tidak cocok per akun', () => {
    const kodeBeban = new Set(['5004', '5010']);
    const baris = [
      { akun_kode: '5004', debit: RP(600_000) },
      { akun_kode: '5010', debit: RP(200_000) },
      { akun_kode: '1001', debit: RP(400_000) }, // sisa kas, bukan BEBAN
      { akun_kode: '1040', debit: 0 },
    ];

    const cocok = rekonsiliasiPanjar(
      [
        { akun: '5004', nominal: RP(400_000) },
        { akun: '5004', nominal: RP(200_000) },
        { akun: '5010', nominal: RP(200_000) },
      ],
      baris,
      kodeBeban,
    );
    expect(cocok).toMatchObject({
      ok: true,
      total_item: RP(800_000),
      total_jurnal: RP(800_000),
      selisih: 0,
      akun_selisih: [],
    });

    const nominalBeda = rekonsiliasiPanjar(
      [{ akun: '5004', nominal: RP(500_000) }],
      baris,
      kodeBeban,
    );
    expect(nominalBeda.ok).toBe(false);
    expect(nominalBeda.akun_selisih).toEqual([
      {
        akun: '5004',
        total_item: RP(500_000),
        total_jurnal: RP(600_000),
        selisih: -RP(100_000),
      },
      {
        akun: '5010',
        total_item: 0,
        total_jurnal: RP(200_000),
        selisih: -RP(200_000),
      },
    ]);

    const akunEkstra = rekonsiliasiPanjar(
      [
        { akun: '5004', nominal: RP(600_000) },
        { akun: '5010', nominal: RP(200_000) },
        { akun: '5011', nominal: RP(50_000) },
      ],
      baris,
      kodeBeban,
    );
    expect(akunEkstra.ok).toBe(false);
    expect(akunEkstra.akun_selisih).toEqual([
      {
        akun: '5011',
        total_item: RP(50_000),
        total_jurnal: 0,
        selisih: RP(50_000),
      },
    ]);
  });
});

describe('DB-21 — pembatalan panjar OPEN', () => {
  it('menampilkan filter Dibatalkan dan penjelasan tombol Batalkan', () => {
    const html = renderToStaticMarkup(createElement(PanjarTab));
    expect(html).toContain('Dibatalkan');
    expect(html).toContain('DIBATALKAN');
    expect(html).toContain('Batalkan');
    expect(html).toContain('alasan minimal 5 karakter');
    expect(html).toContain('jurnal serah asli tidak dihapus');
  });

  it('membatalkan OPEN: reversal D kas/K 1040, saldo pulih, jurnal asli utuh', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const barisSebelum = listBarisJurnal(db);
      expect(saldoAkun(barisSebelum, '1040')).toBe(RP(1_000_000));
      expect(totalKas(barisSebelum, KAS_KODES)).toBe(RP(9_000_000));
      const jurnalAsli = getJurnal(db, 'j-p1');
      const detailAsli = listJurnalBaris(db, 'j-p1');
      const jumlahJurnalSebelum = listJurnal(db).length;
      const auditOpen = listAuditLog(db, { aksi: 'PANJAR-OPEN' }).length;

      const hasil = batalPanjarV2(db, {
        id: 'p1',
        alasan: 'Salah serah ke panitia lain',
        jurnalId: 'j-batal-p1',
        tanggalBatal: '2026-02-02',
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.panjar).toMatchObject({
        id: 'p1',
        status: 'DIBATALKAN',
        jurnal_open_id: 'j-p1',
        jurnal_close_id: null,
        jurnal_batal_id: 'j-batal-p1',
        tanggal_batal: '2026-02-02',
        alasan_batal: 'Salah serah ke panitia lain',
      });
      expect(hasil.jurnal).toMatchObject({
        id: 'j-batal-p1',
        jenis: 'REVERSAL',
        grup_id: 'j-p1',
        reversal_of: 'j-p1',
        tanggal: '2026-02-02',
      });
      expect(hasil.jurnal?.keterangan).toMatch(/^KOREKSI: /);
      // AUD2-09: status tersimpan resmi DIBATALKAN, bukan OPEN + link.
      expect(db.prepare('SELECT status FROM panjar WHERE id = ?').get('p1')).toEqual({
        status: 'DIBATALKAN',
      });

      // Reversal menukar debit/kredit jurnal serah: D kas sumber / K 1040.
      expect(ringkasBaris('j-batal-p1', db)).toEqual([
        { akun: '1040', debit: 0, kredit: RP(1_000_000) },
        { akun: '1001', debit: RP(1_000_000), kredit: 0 },
      ]);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1040')).toBe(0);
      expect(saldoAkun(baris, '1001')).toBe(RP(10_000_000));
      expect(totalKas(baris, KAS_KODES)).toBe(RP(10_000_000));
      expect(neracaSaldo(baris).selisih).toBe(0);

      // Jurnal asli tidak diubah/dihapus.
      expect(getJurnal(db, 'j-p1')).toEqual(jurnalAsli);
      expect(listJurnalBaris(db, 'j-p1')).toEqual(detailAsli);
      expect(listJurnal(db)).toHaveLength(jumlahJurnalSebelum + 1);
      expect(listJurnal(db).map((j) => j.id)).toContain('j-p1');

      // Status publik: hilang dari OPEN/CLOSED, muncul di filter DIBATALKAN.
      expect(listPanjarV2(db, 'OPEN')).toEqual([]);
      expect(listPanjarV2(db, 'CLOSED')).toEqual([]);
      expect(listPanjarV2(db, 'DIBATALKAN')).toHaveLength(1);
      expect(listPanjarV2(db)[0]).toMatchObject({
        status: 'DIBATALKAN',
        jurnal_batal_id: 'j-batal-p1',
      });

      // Audit tetap punya jejak open, ditambah satu baris PANJAR-BATAL.
      const auditBatal = listAuditLog(db, { aksi: 'PANJAR-BATAL' });
      expect(auditBatal).toHaveLength(1);
      expect(auditBatal[0]).toMatchObject({
        aksi: 'PANJAR-BATAL p1',
        alasan: 'Salah serah ke panitia lain',
      });
      expect(auditBatal[0]?.data_baru_json).toContain('jurnal_batal_id');
      expect(listAuditLog(db, { aksi: 'PANJAR-OPEN' })).toHaveLength(auditOpen);
      expect(listAuditLog(db, { aksi: 'PANJAR-CLOSE' })).toHaveLength(0);
      expect(auditIntegritas(db).temuan).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('menolak close, close ganda, dan pembatalan ganda setelah dibatalkan', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      expect(
        batalPanjarV2(db, {
          id: 'p1',
          alasan: 'Salah serah ke panitia lain',
          jurnalId: 'j-batal-p1',
        }).tersimpan,
      ).toBe(true);
      const jumlahJurnal = listJurnal(db).length;

      const close = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-03-01',
        items: [{ kategori_baga: '5004', nominal: RP(100_000) }],
      });
      expect(close.tersimpan).toBe(false);
      expect(close.errors.join(' ')).toMatch(/sudah dibatalkan/i);

      const batalLagi = batalPanjarV2(db, {
        id: 'p1',
        alasan: 'Coba batalkan dua kali',
        jurnalId: 'j-batal-p1-lagi',
      });
      expect(batalLagi.tersimpan).toBe(false);
      expect(batalLagi.errors.join(' ')).toMatch(/sudah dibatalkan/i);
      expect(listJurnal(db)).toHaveLength(jumlahJurnal);
      expect(listPanjarItemsV2(db, 'p1')).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('menolak panjar CLOSED dan tidak menulis jurnal/audit', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      expect(
        closePanjarV2(db, {
          id: 'p1',
          tanggalClose: '2026-03-01',
          items: [{ kategori_baga: '5004', nominal: RP(1_000_000) }],
        }).tersimpan,
      ).toBe(true);
      const jumlahJurnal = listJurnal(db).length;
      const auditSebelum = listAuditLog(db).length;

      const hasil = batalPanjarV2(db, {
        id: 'p1',
        alasan: 'Salah serah setelah ditutup',
        jurnalId: 'j-batal-p1',
      });
      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/CLOSED|sudah dipertanggungjawabkan/i);
      expect(listJurnal(db)).toHaveLength(jumlahJurnal);
      expect(listAuditLog(db)).toHaveLength(auditSebelum);
      expect(getPanjar(db, 'p1')?.status).toBe('CLOSED');
    } finally {
      db.close();
    }
  });

  it('mewajibkan alasan >= 5 karakter dan menolak id kosong/tidak ada', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const jumlahJurnal = listJurnal(db).length;

      for (const alasan of ['', '   ', 'sala']) {
        const hasil = batalPanjarV2(db, {
          id: 'p1',
          alasan,
          jurnalId: 'j-batal-p1',
        });
        expect(hasil.tersimpan, alasan).toBe(false);
        expect(hasil.errors.join(' ')).toMatch(/alasan.*minimal 5/i);
      }
      expect(batalPanjarV2(db, { id: '', alasan: 'Salah serah' }).tersimpan).toBe(
        false,
      );
      expect(
        batalPanjarV2(db, { id: 'tidak-ada', alasan: 'Salah serah' }).errors.join(' '),
      ).toMatch(/tidak ditemukan/i);

      expect(listJurnal(db)).toHaveLength(jumlahJurnal);
      expect(getPanjar(db, 'p1')?.status).toBe('OPEN');
      expect(listAuditLog(db, { aksi: 'PANJAR-BATAL' })).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('migrasi/link batal lama tetap dibaca sebagai DIBATALKAN', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      expect(
        batalPanjarV2(db, {
          id: 'p1',
          alasan: 'Salah serah ke panitia lain',
          jurnalId: 'j-batal-p1',
        }).tersimpan,
      ).toBe(true);
      // Simulasi DB lama: link sudah ada, kolom status tetap OPEN.
      db.prepare("UPDATE panjar SET status = 'OPEN' WHERE id = 'p1'").run();
      expect(getPanjar(db, 'p1')).toMatchObject({
        status: 'DIBATALKAN',
        jurnal_batal_id: 'j-batal-p1',
      });
    } finally {
      db.close();
    }
  });
});

describe('AUD2-03 — koreksi pertanggungjawaban panjar CLOSED', () => {
  it('CLOSED_PANJAR_CORRECTION: reversal memulihkan 1040 & menghapus beban salah, lalu close ulang benar', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const close = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-02-05',
        items: [
          {
            kategori_baga: '5003',
            nominal: RP(900_000),
            nota_nomor: 'N-001',
            nota_tanggal: '2026-02-03',
            toko: 'Toko Uji',
            keterangan: 'salah kategori',
          },
        ],
      });
      expect(close.tersimpan, close.errors.join(' ')).toBe(true);
      const closeId = close.panjar!.jurnal_close_id!;
      const jurnalCloseSebelum = getJurnal(db, closeId);
      const barisCloseSebelum = listJurnalBaris(db, closeId);
      const jumlahJurnalSebelum = listJurnal(db).length;

      expect(saldoAkun(listBarisJurnal(db), '1040')).toBe(0);
      expect(saldoAkun(listBarisJurnal(db), '5003')).toBe(RP(900_000));

      const hasil = batalkanPertanggungjawabanPanjar(db, {
        id: 'p1',
        alasan: 'Salah kategori realisasi',
        tanggalBatal: '2026-02-05',
      });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.panjar).toMatchObject({
        id: 'p1',
        status: 'OPEN',
        tanggal_close: null,
        jurnal_close_id: null,
        total_realisasi: 0,
      });
      expect(hasil.panjar?.sisa).toBeUndefined();
      expect(hasil.panjar?.kurang).toBeUndefined();
      expect(hasil.jurnal).toMatchObject({
        jenis: 'REVERSAL',
        reversal_of: closeId,
        grup_id: jurnalCloseSebelum?.grup_id,
        tanggal: '2026-02-05',
      });

      // Reversal menukar close salah: D 1040 / K 5003 / K sisa kas.
      expect(ringkasBaris(hasil.jurnal!.id, db)).toEqual([
        { akun: '5003', debit: 0, kredit: RP(900_000) },
        { akun: '1001', debit: 0, kredit: RP(100_000) },
        { akun: '1040', debit: RP(1_000_000), kredit: 0 },
      ]);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1040')).toBe(RP(1_000_000));
      expect(saldoAkun(baris, '5003')).toBe(0);
      expect(saldoAkun(baris, '1001')).toBe(RP(9_000_000));

      // Item lama dihapus dari dokumen, tetapi jurnal close asli tetap utuh.
      expect(listPanjarItemsV2(db, 'p1')).toEqual([]);
      expect(getJurnal(db, closeId)).toEqual(jurnalCloseSebelum);
      expect(listJurnalBaris(db, closeId)).toEqual(barisCloseSebelum);
      expect(listJurnal(db)).toHaveLength(jumlahJurnalSebelum + 1);
      expect(listPanjarV2(db, 'OPEN')).toHaveLength(1);
      expect(listPanjarV2(db, 'CLOSED')).toEqual([]);

      // Audit menyimpan seluruh data item lama dan tautan jurnal yang dibalik.
      const audit = listAuditLog(db, { aksi: 'PANJAR-BATAL-CLOSE' });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        aksi: 'PANJAR-BATAL-CLOSE p1',
        alasan: 'Salah kategori realisasi',
        ref_type: 'panjar',
        ref_id: 'p1',
      });
      const dataLama = JSON.parse(audit[0]!.data_lama_json) as {
        panjar: Panjar;
        items: PanjarItem[];
      };
      expect(dataLama.panjar).toMatchObject({
        id: 'p1',
        status: 'CLOSED',
        jurnal_close_id: closeId,
      });
      expect(dataLama.items).toHaveLength(1);
      expect(dataLama.items[0]).toMatchObject({
        kategori_baga: '5003',
        nominal: RP(900_000),
        nota_nomor: 'N-001',
        nota_tanggal: '2026-02-03',
        toko: 'Toko Uji',
        keterangan: 'salah kategori',
        jurnal_id: closeId,
      });

      const reclose = closePanjarV2(db, {
        id: 'p1',
        tanggalClose: '2026-02-06',
        items: [{ kategori_baga: '5010', nominal: RP(800_000) }],
      });
      expect(reclose.tersimpan, reclose.errors.join(' ')).toBe(true);

      const barisAkhir = listBarisJurnal(db);
      expect(saldoAkun(barisAkhir, '1040')).toBe(0);
      expect(saldoAkun(barisAkhir, '5003')).toBe(0);
      expect(saldoAkun(barisAkhir, '5010')).toBe(RP(800_000));
      expect(listPanjarV2(db, 'CLOSED')[0]).toMatchObject({
        id: 'p1',
        total_realisasi: RP(800_000),
      });
      expect(auditIntegritas(db).ok).toBe(true);
    } finally {
      db.close();
    }
  });

  it('menampilkan penjelasan tombol Koreksi Pertanggungjawaban', () => {
    const html = renderToStaticMarkup(createElement(PanjarTab));
    expect(html).toContain('Koreksi Pertanggungjawaban');
    expect(html).toContain('rincian item');
    expect(html).toContain('tersimpan di audit');
    expect(html).toContain('kembali');
    expect(html).toContain('OPEN');
  });

  it('menolak panjar OPEN/tidak ada, alasan < 5 karakter, dan koreksi ganda', () => {
    const db = dbKas();
    try {
      expect(serah(db).tersimpan).toBe(true);
      const jumlahJurnal = listJurnal(db).length;

      expect(
        batalkanPertanggungjawabanPanjar(db, {
          id: 'p1',
          alasan: 'Salah kategori realisasi',
        }).errors.join(' '),
      ).toMatch(/CLOSED/i);
      expect(
        batalkanPertanggungjawabanPanjar(db, {
          id: '',
          alasan: 'Salah kategori realisasi',
        }).errors.join(' '),
      ).toMatch(/belum dipilih/i);
      expect(
        batalkanPertanggungjawabanPanjar(db, {
          id: 'tidak-ada',
          alasan: 'Salah kategori realisasi',
        }).errors.join(' '),
      ).toMatch(/tidak ditemukan/i);

      expect(
        closePanjarV2(db, {
          id: 'p1',
          tanggalClose: '2026-02-05',
          items: [{ kategori_baga: '5003', nominal: RP(900_000) }],
        }).tersimpan,
      ).toBe(true);
      const jumlahJurnalSetelahClose = listJurnal(db).length;

      for (const alasan of ['', '   ', 'sala']) {
        const hasil = batalkanPertanggungjawabanPanjar(db, {
          id: 'p1',
          alasan,
        });
        expect(hasil.tersimpan, alasan).toBe(false);
        expect(hasil.errors.join(' ')).toMatch(/alasan.*minimal 5/i);
      }
      expect(listJurnal(db)).toHaveLength(jumlahJurnalSetelahClose);
      expect(listAuditLog(db, { aksi: 'PANJAR-BATAL-CLOSE' })).toHaveLength(0);
      expect(getPanjar(db, 'p1')?.status).toBe('CLOSED');

      expect(
        batalkanPertanggungjawabanPanjar(db, {
          id: 'p1',
          alasan: 'Salah kategori realisasi',
        }).tersimpan,
      ).toBe(true);
      const koreksiLagi = batalkanPertanggungjawabanPanjar(db, {
        id: 'p1',
        alasan: 'Coba koreksi dua kali',
      });
      expect(koreksiLagi.tersimpan).toBe(false);
      expect(koreksiLagi.errors.join(' ')).toMatch(/CLOSED/i);
      expect(listJurnal(db)).toHaveLength(jumlahJurnalSetelahClose + 1);
      expect(listJurnal(db).length).toBeGreaterThan(jumlahJurnal);
    } finally {
      db.close();
    }
  });
});
