// P1-8: data layar Buku Besar & Neraca Saldo + drill-down.
// Fokus: saldo awal/mutasi/saldo akhir konsisten dengan saldoAkun, daftar
// jurnal per akun hanya berisi jurnal yang menyentuh akun itu, detail jurnal
// memuat semua baris, dan validasi tanggal/cut-off memakai kalender nyata.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COA } from '../src/db/coa.js';
import { openDb } from '../src/db/database.js';
import { insertJurnal } from '../src/db/repository.js';
import {
  laporanBukuBesar,
  laporanDetailJurnal,
  laporanJurnalAkun,
  laporanNeracaSaldo,
  listBarisJurnal,
} from '../src/db/laporan.js';
import { seedDev } from '../src/db/seed-dev.js';
import { saldoAkun } from '../src/core/reports.js';
import {
  validasiCutoffLaporan,
  validasiFilterBukuBesar,
  validasiIdJurnal,
} from '../src/main/validation.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../src/utils/pesanError.js';
import {
  labelSisiSaldo,
  sisiSaldo,
  toneSisiSaldo,
} from '../src/renderer/lib/tampilanLaporan.js';

const RP = (rupiah: number): number => rupiah * 100;

const dirs: string[] = [];

function freshDb(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), 'pura-laporan-ui-'));
  dirs.push(dir);
  return openDb(join(dir, 'pura.db'));
}

function isiContoh(db: ReturnType<typeof openDb>): void {
  insertJurnal(
    db,
    { id: 'j-1', tanggal: '2025-01-01', no_bukti: 'JU-2025-0001', keterangan: 'Saldo awal' },
    [
      { akun_kode: '1001', debit: RP(10_000_000), kredit: 0 },
      { akun_kode: '3000', debit: 0, kredit: RP(10_000_000) },
    ],
  );
  insertJurnal(
    db,
    { id: 'j-2', tanggal: '2025-02-01', no_bukti: 'JU-2025-0002', keterangan: 'Pendapatan parkir' },
    [
      { akun_kode: '1001', debit: RP(5_000_000), kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: RP(5_000_000) },
    ],
  );
  insertJurnal(
    db,
    { id: 'j-3', tanggal: '2025-03-01', no_bukti: 'JU-2025-0003', keterangan: 'Beban upakara' },
    [
      { akun_kode: '5004', debit: RP(2_000_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(2_000_000) },
    ],
  );
  // Jurnal 2026 yang TIDAK menyentuh 1001.
  insertJurnal(
    db,
    { id: 'j-4', tanggal: '2026-01-15', no_bukti: 'JU-2026-0001', keterangan: 'Parkir bank' },
    [
      { akun_kode: '1029', debit: RP(700_000), kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: RP(700_000) },
    ],
  );
  insertJurnal(
    db,
    { id: 'j-5', tanggal: '2026-02-01', no_bukti: 'JU-2026-0002', keterangan: 'Bayar listrik' },
    [
      { akun_kode: '5010', debit: RP(200_000), kredit: 0 },
      { akun_kode: '1029', debit: 0, kredit: RP(200_000) },
    ],
  );
  insertJurnal(
    db,
    { id: 'j-6', tanggal: '2026-03-01', no_bukti: 'JU-2026-0003', keterangan: 'Serah panjar' },
    [
      { akun_kode: '1040', debit: RP(1_000_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(1_000_000) },
    ],
  );
  // Tiga baris: dua sisi debit (beban + sisa kas) dan satu kredit panjar.
  insertJurnal(
    db,
    {
      id: 'j-7',
      tanggal: '2026-03-05',
      no_bukti: 'JU-2026-0004',
      keterangan: 'Pertanggungjawaban panjar',
    },
    [
      { akun_kode: '5003', debit: RP(600_000), kredit: 0 },
      { akun_kode: '1001', debit: RP(400_000), kredit: 0 },
      { akun_kode: '1040', debit: 0, kredit: RP(1_000_000) },
    ],
  );
  insertJurnal(
    db,
    { id: 'j-8', tanggal: '2026-04-01', no_bukti: 'JU-2026-0005', keterangan: 'Terima pinjaman' },
    [
      { akun_kode: '1029', debit: RP(2_000_000), kredit: 0 },
      { akun_kode: '2050', debit: 0, kredit: RP(2_000_000) },
    ],
  );
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('P1-8 — data Buku Besar per akun', () => {
  it('saldo awal + mutasi + saldo akhir konsisten dengan saldoAkun', () => {
    const db = freshDb();
    try {
      isiContoh(db);
      const semuaBaris = listBarisJurnal(db);
      const bb = laporanBukuBesar(db, '1001', {
        mulai: '2026-01-01',
        sampai: '2026-12-31',
      });

      expect(bb.kode).toBe('1001');
      expect(bb.saldoAwal).toBe(RP(13_000_000));
      expect(bb.saldoAwal).toBe(saldoAkun(semuaBaris, '1001', '2025-12-31'));

      expect(bb.rows.map((r) => r.jurnal_id)).toEqual(['j-6', 'j-7']);
      expect(bb.rows.map((r) => r.saldo)).toEqual([
        RP(12_000_000),
        RP(12_400_000),
      ]);
      expect(bb.totalDebit).toBe(RP(400_000));
      expect(bb.totalKredit).toBe(RP(1_000_000));
      expect(bb.saldoAkhir).toBe(RP(12_400_000));
      expect(bb.saldoAkhir).toBe(saldoAkun(semuaBaris, '1001', '2026-12-31'));

      // Saldo awal + (debit − kredit) = saldo akhir untuk akun normal debit.
      expect(bb.saldoAwal + bb.totalDebit - bb.totalKredit).toBe(bb.saldoAkhir);
    } finally {
      db.close();
    }
  });

  it('akun kredit normal menampilkan saldo positif sesuai posisi normal', () => {
    const db = freshDb();
    try {
      isiContoh(db);
      const bb = laporanBukuBesar(db, '2050');
      expect(bb.posisi_normal).toBe('KREDIT');
      expect(bb.saldoAwal).toBe(0);
      expect(bb.rows).toHaveLength(1);
      expect(bb.rows[0]).toMatchObject({
        jurnal_id: 'j-8',
        kredit: RP(2_000_000),
        saldo: RP(2_000_000),
        posisi: 'KREDIT',
      });
      expect(bb.saldoAwal + bb.totalKredit - bb.totalDebit).toBe(bb.saldoAkhir);
    } finally {
      db.close();
    }
  });

  it('akun tanpa mutasi tetap aman: baris kosong dan saldo nol', () => {
    const db = freshDb();
    try {
      isiContoh(db);
      const bb = laporanBukuBesar(db, '1050', {
        mulai: '2026-01-01',
        sampai: '2026-12-31',
      });
      expect(bb.rows).toEqual([]);
      expect(bb.totalDebit).toBe(0);
      expect(bb.totalKredit).toBe(0);
      expect(bb.saldoAwal).toBe(0);
      expect(bb.saldoAkhir).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('P1-8 — Neraca Saldo per cut-off', () => {
  it('semua akun COA tampil, total debit = kredit, dan selisih nol', () => {
    const db = freshDb();
    try {
      isiContoh(db);
      const baris = listBarisJurnal(db);
      const ns = laporanNeracaSaldo(db, '2026-12-31');

      expect(ns.rows).toHaveLength(COA.length);
      expect(ns.totalDebit).toBe(ns.totalKredit);
      expect(ns.selisih).toBe(0);
      expect(ns.seimbang).toBe(true);

      const kas = ns.rows.find((r) => r.kode === '1001');
      expect(kas).toMatchObject({
        nama: 'KAS',
        tipe: 'AKTIVA',
        debit: RP(12_400_000),
        kredit: 0,
        saldo: RP(12_400_000),
        adaMutasi: true,
      });
      expect(kas?.saldo).toBe(saldoAkun(baris, '1001', '2026-12-31'));

      const hutang = ns.rows.find((r) => r.kode === '2050');
      expect(hutang).toMatchObject({
        debit: 0,
        kredit: RP(2_000_000),
        saldo: RP(2_000_000),
      });
    } finally {
      db.close();
    }
  });

  it('cut-off inklusif: jurnal sesudah tanggal tidak ikut dihitung', () => {
    const db = freshDb();
    try {
      isiContoh(db);
      const sebelum = laporanNeracaSaldo(db, '2026-03-04');
      const sesudah = laporanNeracaSaldo(db, '2026-03-05');
      expect(sebelum.rows.find((r) => r.kode === '1040')?.saldo).toBe(RP(1_000_000));
      expect(sesudah.rows.find((r) => r.kode === '1040')?.saldo).toBe(0);
      expect(sebelum.seimbang).toBe(true);
      expect(sesudah.seimbang).toBe(true);
    } finally {
      db.close();
    }
  });

  it('dataset seed dev tetap seimbang lewat adapter laporan', () => {
    const db = freshDb();
    try {
      seedDev(db);
      const ns = laporanNeracaSaldo(db, '2026-12-31');
      expect(ns.seimbang).toBe(true);
      expect(ns.selisih).toBe(0);
      expect(ns.totalDebit).toBeGreaterThan(0);
      expect(ns.totalDebit).toBe(ns.totalKredit);
    } finally {
      db.close();
    }
  });

  it('DB tanpa jurnal: semua akun nol dan Neraca Saldo tetap seimbang', () => {
    const db = freshDb();
    try {
      const ns = laporanNeracaSaldo(db, '2026-12-31');
      expect(ns.rows).toHaveLength(COA.length);
      expect(ns.rows.every((r) => r.saldo === 0 && r.debit === 0 && r.kredit === 0)).toBe(true);
      expect(ns.rows.every((r) => !r.adaMutasi)).toBe(true);
      expect(ns.seimbang).toBe(true);
      expect(ns.selisih).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('P1-8 — drill-down jurnal', () => {
  it('daftar jurnal per akun hanya berisi jurnal yang menyentuh akun itu', () => {
    const db = freshDb();
    try {
      isiContoh(db);
      const daftar = laporanJurnalAkun(db, '1001', {
        mulai: '2026-01-01',
        sampai: '2026-12-31',
      });
      expect(daftar.map((j) => j.id)).toEqual(['j-6', 'j-7']);
      for (const j of daftar) {
        expect(j.baris.some((b) => b.akun_kode === '1001')).toBe(true);
      }
      // j-4 dan j-5 tidak menyentuh 1001, jadi tidak boleh muncul.
      expect(daftar.some((j) => j.id === 'j-4' || j.id === 'j-5')).toBe(false);

      // Filter tanggal juga berlaku pada daftar jurnal.
      const hanyaMaret = laporanJurnalAkun(db, '1001', {
        mulai: '2026-03-01',
        sampai: '2026-03-31',
      });
      expect(hanyaMaret.map((j) => j.id)).toEqual(['j-6', 'j-7']);
      const setelahMaret = laporanJurnalAkun(db, '1001', { mulai: '2026-03-06' });
      expect(setelahMaret).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('detail jurnal memuat semua baris debit/kredit dan status koreksi', () => {
    const db = freshDb();
    try {
      isiContoh(db);
      const detail = laporanDetailJurnal(db, 'j-7');
      expect(detail).not.toBeNull();
      expect(detail).toMatchObject({
        id: 'j-7',
        no_bukti: 'JU-2026-0004',
        tanggal: '2026-03-05',
        keterangan: 'Pertanggungjawaban panjar',
        total_debit: RP(1_000_000),
        reversal_of: null,
        reversal_id: null,
      });
      expect(detail!.baris.map((b) => b.akun_kode)).toEqual(['5003', '1001', '1040']);
      expect(detail!.baris.map((b) => b.debit)).toEqual([
        RP(600_000),
        RP(400_000),
        0,
      ]);
      expect(detail!.baris.map((b) => b.kredit)).toEqual([0, 0, RP(1_000_000)]);
      expect(laporanDetailJurnal(db, 'tidak-ada')).toBeNull();
    } finally {
      db.close();
    }
  });
});

describe('P1-8 — validasi tanggal/cut-off laporan', () => {
  it('menolak tanggal yang formatnya benar tetapi tidak ada di kalender', () => {
    const mulai = validasiFilterBukuBesar({
      akun_kode: '1001',
      mulai: '2026-02-31',
    });
    expect(mulai.ok).toBe(false);
    if (!mulai.ok) expect(mulai.error).toBe(PESAN_TANGGAL_TIDAK_VALID);

    const cutoff = validasiCutoffLaporan('2026-04-31');
    expect(cutoff.ok).toBe(false);
    if (!cutoff.ok) expect(cutoff.error).toBe(PESAN_TANGGAL_TIDAK_VALID);
  });

  it('menerima tanggal kalender nyata termasuk 29 Februari kabisat', () => {
    const cutoff = validasiCutoffLaporan('2028-02-29');
    expect(cutoff).toEqual({ ok: true, input: '2028-02-29' });

    const filter = validasiFilterBukuBesar({
      akun_kode: '1001',
      mulai: '2026-01-01',
      sampai: '2026-12-31',
    });
    expect(filter).toEqual({
      ok: true,
      input: { akun_kode: '1001', mulai: '2026-01-01', sampai: '2026-12-31' },
    });
  });

  it('menolak akun kosong, rentang terbalik, cut-off kosong, dan ID jurnal kosong', () => {
    expect(validasiFilterBukuBesar({ akun_kode: '' }).ok).toBe(false);
    expect(
      validasiFilterBukuBesar({
        akun_kode: '1001',
        mulai: '2026-12-31',
        sampai: '2026-01-01',
      }).ok,
    ).toBe(false);
    expect(validasiCutoffLaporan('').ok).toBe(false);
    expect(validasiIdJurnal('   ').ok).toBe(false);
  });
});

describe('P1-8 — helper tampilan sisi saldo', () => {
  it('menentukan sisi sesuai posisi normal dan sisi lawan untuk saldo negatif', () => {
    expect(sisiSaldo(100, 'DEBIT')).toBe('DEBIT');
    expect(sisiSaldo(-100, 'DEBIT')).toBe('KREDIT');
    expect(sisiSaldo(100, 'KREDIT')).toBe('KREDIT');
    expect(sisiSaldo(-100, 'KREDIT')).toBe('DEBIT');
    expect(sisiSaldo(0, 'DEBIT')).toBeNull();
    expect(labelSisiSaldo(null)).toBe('Nol');
    expect(toneSisiSaldo('DEBIT')).toBe('green');
    expect(toneSisiSaldo('KREDIT')).toBe('amber');
  });
});
