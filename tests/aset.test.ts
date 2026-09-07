// Modul Inventaris Aset: validasi opsional-nilai + CRUD repo + isolasi dari Neraca + export kop.
import { describe, expect, it } from 'vitest';
import { validateAsetInput } from '../src/main/validation.js';
import { openDb } from '../src/db/database.js';
import { deleteAset, getAset, insertAset, listAset, updateAset } from '../src/db/repository.js';
import { neraca } from '../src/core/ledger.js';
import { KAS_KODES } from '../src/db/coa.js';
import { asetToHtml, asetToWorkbook, KOP_ORG_NAMA, workbookToBuffer } from '../src/features/export/workbooks.js';
import type { Aset, Transaksi } from '../src/core/types.js';

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

  it('isolasi: aset tidak mengubah Neraca (Aktiva=Pasiva tetap)', () => {
    const MODAL: Transaksi = { id: 't0', tanggal: '2025-01-05', keterangan: 'Modal', akun_kas: '1001', kategori: '3000', masuk: 1_000_000_000, keluar: 0 };
    const sebelum = neraca([MODAL], [], [], '2025-12-31', KAS_KODES);
    const db = openDb(':memory:');
    insertAset(db, asetRow({ id: 'a9', kode: 'AST-009', nilai_sen: null }));
    insertAset(db, asetRow({ id: 'a10', kode: 'AST-010', nilai_sen: 99_999_999_999 }));
    const sesudah = neraca([MODAL], [], [], '2025-12-31', KAS_KODES);
    expect(sesudah.aktiva).toBe(sebelum.aktiva);
    expect(sesudah.balance).toBe(true);
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
