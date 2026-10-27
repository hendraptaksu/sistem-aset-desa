// Modul Inventaris Aset: validasi opsional-nilai + CRUD repo + isolasi dari
// laporan keuangan v2 (core/reports) + export kop.
import { describe, expect, it } from 'vitest';
import { validateAsetInput } from '../src/main/validation.js';
import { openDb } from '../src/db/database.js';
import {
  deleteAset,
  getAset,
  insertAset,
  insertJurnal,
  listAset,
  updateAset,
} from '../src/db/repository.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { labaRugi, neraca, neracaSaldo } from '../src/core/reports.js';
import { asetToHtml, asetToWorkbook, KOP_ORG_NAMA, workbookToBuffer } from '../src/features/export/workbooks.js';
import type { Aset } from '../src/core/types.js';

const BASE = {
  kode: 'AST-001',
  nama: 'Tanah Pura Kangin',
  jenis: 'TANAH',
  luas_m2: 500,
  lokasi: 'Banjar Peliatan',
  status_hukum: 'druwe',
  tahun_perolehan: 2010,
  asal_usul: 'hibah krama',
  kondisi: 'BAIK',
  keterangan: '',
  nilai_sen: null as number | null,
};

function asetRow(over: Partial<Aset> = {}): Aset {
  const now = new Date().toISOString();
  return {
    id: `a-${Math.random().toString(36).slice(2)}`,
    kode: 'AST-001', nama: 'Tanah Pura Kangin', jenis: 'TANAH',
    luas_m2: 500, lokasi: 'Banjar', status_hukum: 'druwe',
    tahun_perolehan: 2010, asal_usul: 'hibah', kondisi: 'BAIK',
    keterangan: '', nilai_sen: null, created_at: now, updated_at: now,
    ...over,
  };
}

describe('validateAsetInput', () => {
  it('lolos tanpa nilai (kasus tanah/bangunan belum pasti nominalnya)', () => {
    expect(validateAsetInput(BASE)).toEqual([]);
  });
  it('lolos dengan nilai opsional', () => {
    expect(validateAsetInput({ ...BASE, nilai_sen: 100_000_000 })).toEqual([]);
  });
  it('menolak kode/nama kosong, jenis/kondisi salah, angka invalid', () => {
    expect(validateAsetInput({ ...BASE, kode: '  ' }).length).toBeGreaterThan(0);
    expect(validateAsetInput({ ...BASE, nama: '' }).length).toBeGreaterThan(0);
    expect(validateAsetInput({ ...BASE, jenis: 'SAWAH' }).length).toBeGreaterThan(0);
    expect(validateAsetInput({ ...BASE, kondisi: 'BAGUS' }).length).toBeGreaterThan(0);
    expect(validateAsetInput({ ...BASE, luas_m2: -1 }).length).toBeGreaterThan(0);
    expect(validateAsetInput({ ...BASE, tahun_perolehan: 1800 }).length).toBeGreaterThan(0);
    expect(validateAsetInput({ ...BASE, nilai_sen: -5 }).length).toBeGreaterThan(0);
  });
});

describe('repository aset', () => {
  it('CRUD + filter jenis/cari + kode unik', () => {
    const db = openDb(':memory:');
    insertAset(db, asetRow({ id: 'a1', kode: 'AST-001', nama: 'Tanah Kangin', jenis: 'TANAH' }));
    insertAset(db, asetRow({ id: 'a2', kode: 'AST-002', nama: 'Bale Kulkul', jenis: 'BANGUNAN', lokasi: 'Pura' }));
    expect(listAset(db)).toHaveLength(2);
    expect(listAset(db, { jenis: 'TANAH' })).toHaveLength(1);
    expect(listAset(db, { cari: 'kulkul' })).toHaveLength(1);
    expect(getAset(db, 'a1')?.nama).toBe('Tanah Kangin');

    updateAset(db, { ...getAset(db, 'a1')!, nama: 'Tanah Kangin Wetan', nilai_sen: 250_000_000 });
    expect(getAset(db, 'a1')?.nilai_sen).toBe(250_000_000);

    expect(() => insertAset(db, asetRow({ id: 'a3', kode: 'AST-001' }))).toThrow();
    deleteAset(db, 'a2');
    expect(listAset(db)).toHaveLength(1);
  });
});

const RP = (rupiah: number): number => rupiah * 100;

/** Jurnal double-entry seimbang: satu modal awal + satu beban upakara. */
function isiJurnalDasar(db: ReturnType<typeof openDb>): void {
  insertJurnal(
    db,
    {
      id: 'j-modal',
      tanggal: '2025-01-01',
      no_bukti: 'JU-2025-0001',
      keterangan: 'Modal awal',
    },
    [
      { akun_kode: '1001', debit: RP(1_000_000), kredit: 0 },
      { akun_kode: '3000', debit: 0, kredit: RP(1_000_000) },
    ],
  );
  insertJurnal(
    db,
    {
      id: 'j-beban',
      tanggal: '2025-02-01',
      no_bukti: 'JU-2025-0002',
      keterangan: 'Beban upakara',
    },
    [
      { akun_kode: '5004', debit: RP(40_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(40_000) },
    ],
  );
}

describe('isolasi aset dari laporan keuangan (core/reports v2)', () => {
  it('jurnal modal + beban menghasilkan Laba Rugi & Neraca yang diharapkan', () => {
    const db = openDb(':memory:');
    isiJurnalDasar(db);
    const baris = listBarisJurnal(db);

    // Laba Rugi: tidak ada pendapatan, beban Rp 40.000 → defisit Rp 40.000.
    const lr = labaRugi(baris, { mulai: '2025-01-01', sampai: '2025-12-31' });
    expect(lr.totalPendapatan).toBe(0);
    expect(lr.totalBeban).toBe(RP(40_000));
    expect(lr.laba).toBe(-RP(40_000));
    expect(lr.defisit).toBe(true);

    // Neraca: kas Rp 960.000 = modal Rp 1.000.000 − defisit Rp 40.000.
    const n = neraca(baris, '2025-12-31');
    expect(n.totalAset).toBe(RP(960_000));
    expect(n.totalKewajiban).toBe(0);
    expect(n.totalEkuitasAkun).toBe(RP(1_000_000));
    expect(n.labaBerjalan).toBe(-RP(40_000));
    expect(n.totalEkuitas).toBe(RP(960_000));
    expect(n.totalPasiva).toBe(RP(960_000));
    expect(n.selisih).toBe(0);
    expect(n.balance).toBe(true);

    // Neraca Saldo juga harus seimbang: debit 1001+5004 = kredit 3000.
    const ns = neracaSaldo(baris, '2025-12-31');
    expect(ns.totalDebit).toBe(RP(1_000_000));
    expect(ns.totalKredit).toBe(RP(1_000_000));
    expect(ns.selisih).toBe(0);
    expect(ns.seimbang).toBe(true);
  });

  it('aset dengan nilai_sen besar tidak mengubah Laba Rugi/Neraca', () => {
    const db = openDb(':memory:');
    isiJurnalDasar(db);

    const sebelumBaris = listBarisJurnal(db);
    const sebelumLr = labaRugi(sebelumBaris, { mulai: '2025-01-01', sampai: '2025-12-31' });
    const sebelumNeraca = neraca(sebelumBaris, '2025-12-31');

    // Nilai aset sengaja sangat besar: tetap data inventaris, bukan jurnal.
    insertAset(
      db,
      asetRow({
        id: 'a-besar',
        kode: 'AST-900',
        nama: 'Tanah Nilai Besar',
        nilai_sen: 999_999_999_999_999,
      }),
    );
    insertAset(
      db,
      asetRow({
        id: 'a-null',
        kode: 'AST-901',
        nama: 'Bangunan Belum Dinilai',
        jenis: 'BANGUNAN',
        nilai_sen: null,
      }),
    );

    // Aset benar-benar tersimpan di tabel inventaris...
    expect(listAset(db).map((a) => [a.kode, a.nilai_sen])).toEqual([
      ['AST-900', 999_999_999_999_999],
      ['AST-901', null],
    ]);

    // ...dan tidak menambah/mengubah baris jurnal apa pun.
    const sesudahBaris = listBarisJurnal(db);
    expect(sesudahBaris).toHaveLength(sebelumBaris.length);
    expect(sesudahBaris).toEqual(sebelumBaris);

    // Karena itu Laba Rugi dan Neraca identik sebelum vs sesudah input aset.
    expect(labaRugi(sesudahBaris, { mulai: '2025-01-01', sampai: '2025-12-31' })).toEqual(
      sebelumLr,
    );
    expect(neraca(sesudahBaris, '2025-12-31')).toEqual(sebelumNeraca);
  });
});

describe('export aset', () => {
  it('workbook ber-kop + buffer tidak kosong; html tampil "belum dinilai"', async () => {
    const rows = [
      asetRow({ id: 'a1', kode: 'AST-001', nama: 'Tanah Kangin', nilai_sen: null }),
      asetRow({ id: 'a2', kode: 'AST-002', nama: 'Bale', jenis: 'BANGUNAN', nilai_sen: 500_000_000 }),
    ];
    const wb = await asetToWorkbook(rows);
    expect(wb.getWorksheet('Inventaris Aset')?.getCell('A1').value).toBe(KOP_ORG_NAMA);
    const buf = await workbookToBuffer(wb);
    expect(buf.length).toBeGreaterThan(1000);
    const html = asetToHtml(rows);
    expect(html).toContain(KOP_ORG_NAMA);
    expect(html).toContain('belum dinilai');
    expect(html).toContain('AST-001');
  });
});
