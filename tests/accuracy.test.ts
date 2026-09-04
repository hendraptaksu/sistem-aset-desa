// Test akurasi PROGRESS.md (T1-T8). Pure ledger + SQLite repository.
// Skenario angka: modal 10jt → parkir +5jt → upakara -2jt → panjar 5jt → realisasi 4,5jt.

import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  buatAuditLog,
  isPeriodeTerkunci,
  labaTahun,
  neraca,
  panjarCloseToTransaksi,
  panjarOpenToTransaksi,
  saldoKas,
  surplus,
  validasiSimpanLonggar,
} from '../src/core/ledger.js';
import type { Panjar, Transaksi, TutupBuku } from '../src/core/types.js';
import { openDb } from '../src/db/database.js';
import { KAS_KODES } from '../src/db/coa.js';
import {
  closePanjar,
  guardPeriodeTerkunci,
  insertAuditLog,
  insertPanjar,
  insertTransaksi,
  insertTutupBuku,
  listTutupBuku,
  listTransaksi,
} from '../src/db/repository.js';
import { formatRp } from '../src/utils/format.js';

const MODAL: Transaksi = { id: 't0', tanggal: '2025-01-05', keterangan: 'Modal awal', akun_kas: '1000', kategori: '3000', masuk: 10_000_000, keluar: 0 };
const PARKIR: Transaksi = { id: 't1', tanggal: '2025-02-10', keterangan: 'Parkir', akun_kas: '1015', kategori: '4001', masuk: 5_000_000, keluar: 0 };
const UPAKARA: Transaksi = { id: 't2', tanggal: '2025-03-12', keterangan: 'Upakara', akun_kas: '1000', kategori: '5004', masuk: 0, keluar: 2_000_000 };
const PANJAR: Panjar = { id: 'p1', tanggal: '2025-04-01', penerima: 'Panitia Piodalan', jumlah: 5_000_000, akun_kas_sumber: '1000', status: 'OPEN' };

function dbSeeded(): Database.Database {
  const db = openDb(':memory:');
  insertTransaksi(db, MODAL);
  insertTransaksi(db, PARKIR);
  insertTransaksi(db, UPAKARA);
  insertPanjar(db, PANJAR);
  insertTransaksi(db, panjarOpenToTransaksi(PANJAR));
  return db;
}

describe('T1 modal awal balance', () => {
  it('aktiva = pasiva = 10jt', () => {
    const n = neraca([MODAL], [], [], '2025-01-31', KAS_KODES);
    expect(n.aktiva).toBe(10_000_000);
    expect(n.pasiva).toBe(10_000_000);
    expect(n.balance).toBe(true);
  });
});

describe('T2 parkir masuk', () => {
  it('aktiva & berjalan naik 5jt, tetap balance', () => {
    const tx = [MODAL, PARKIR];
    const n = neraca(tx, [], [], '2025-02-28', KAS_KODES);
    expect(n.aktiva).toBe(15_000_000);
    expect(n.berjalan).toBe(5_000_000);
    expect(n.balance).toBe(true);
    expect(saldoKas(tx, '1015', '2025-02-28')).toBe(5_000_000);
  });
});

describe('T3 upakara keluar', () => {
  it('aktiva turun 2jt, berjalan 3jt, balance', () => {
    const tx = [MODAL, PARKIR, UPAKARA];
    const n = neraca(tx, [], [], '2025-03-31', KAS_KODES);
    expect(n.aktiva).toBe(13_000_000);
    expect(n.berjalan).toBe(3_000_000);
    expect(n.balance).toBe(true);
  });
});

describe('T4 panjar open', () => {
  it('kas turun 5jt tapi aktiva tetap (pindah ke panjar)', () => {
    const db = dbSeeded();
    const tx = listTransaksi(db);
    expect(saldoKas(tx, '1000', '2025-04-30')).toBe(10_000_000 - 2_000_000 - 5_000_000);
    const n = neraca(tx, [{ ...PANJAR }], [], '2025-04-30', KAS_KODES);
    expect(n.aktivaRinci.panjarOpen).toBe(5_000_000);
    expect(n.aktiva).toBe(13_000_000);
    expect(n.balance).toBe(true);
    expect(surplus(tx, '2025-01-01', '2025-04-30')).toBe(3_000_000); // open tidak jadi beban
  });
});

describe('T5 panjar close', () => {
  it('beban 4,5jt + sisa 500rb kembali, balance', () => {
    const db = dbSeeded();
    const close = panjarCloseToTransaksi(PANJAR, [{ panjar_id: 'p1', kategori_baga: '5004', nominal: 4_500_000 }], '2025-04-20');
    expect(close.sisaRow?.masuk).toBe(500_000);
    closePanjar(db, 'p1', [...close.bebanRows, close.kompensasiRow, ...(close.sisaRow ? [close.sisaRow] : [])]);
    const tx = listTransaksi(db);
    expect(saldoKas(tx, '1000', '2025-04-30')).toBe(3_500_000);
    const n = neraca(tx, [{ ...PANJAR, status: 'CLOSED' }], [], '2025-04-30', KAS_KODES);
    expect(n.aktiva).toBe(8_500_000);
    expect(n.berjalan).toBe(5_000_000 - 6_500_000);
    expect(n.balance).toBe(true);
  });

  it('kasus kurang: realisasi 6jt dari panjar 5jt', () => {
    const db = dbSeeded();
    const close = panjarCloseToTransaksi(PANJAR, [{ panjar_id: 'p1', kategori_baga: '5004', nominal: 6_000_000 }], '2025-04-20');
    expect(close.sisaRow).toBeNull();
    closePanjar(db, 'p1', [...close.bebanRows, close.kompensasiRow]);
    const tx = listTransaksi(db);
    // kas tunai: 10-2-5 (open) -6 (beban) +5 (komp) = 2jt
    expect(saldoKas(tx, '1000', '2025-04-30')).toBe(2_000_000);
    const n = neraca(tx, [{ ...PANJAR, status: 'CLOSED' }], [], '2025-04-30', KAS_KODES);
    expect(n.balance).toBe(true);
  });
});

describe('T6 neraca mid-year & akhir tahun', () => {
  it('balance di dua cut-off', () => {
    const db = dbSeeded();
    const tx = listTransaksi(db);
    for (const cutoff of ['2025-06-30', '2025-12-31']) {
      const n = neraca(tx, [{ ...PANJAR }], [], cutoff, KAS_KODES);
      expect(n.balance).toBe(true);
    }
  });
});

describe('T7 tutup buku + kunci longgar', () => {
  it('tutup 2025, kumulatif 2026 = laba 2025, edit lama wajib alasan + audit', () => {
    const db = dbSeeded();
    const tx = listTransaksi(db);
    const laba = labaTahun(tx, 2025);
    expect(laba).toBe(5_000_000 - 2_000_000);
    const tutup: TutupBuku = { tahun: 2025, laba, created_at: new Date().toISOString(), backup_path: '/tmp/backup.db' };
    insertTutupBuku(db, tutup);
    expect(listTutupBuku(db)).toHaveLength(1);

    // Neraca 2026: kumulatif = laba 2025
    const n26 = neraca(tx, [{ ...PANJAR }], [tutup], '2026-01-31', KAS_KODES);
    expect(n26.kumulatif).toBe(laba);
    expect(n26.balance).toBe(true);
    expect(isPeriodeTerkunci('2025-06-01', [tutup])).toBe(true);
    expect(isPeriodeTerkunci('2026-01-05', [tutup])).toBe(false);

    // Tanpa alasan → ditolak
    expect(validasiSimpanLonggar('2025-06-01', [tutup]).boleh).toBe(false);
    expect(guardPeriodeTerkunci(db, '2025-06-01')).not.toBeNull();
    // Dengan alasan → boleh + audit tercatat
    expect(validasiSimpanLonggar('2025-06-01', [tutup], 'Koreksi struk susulan Desember').boleh).toBe(true);
    expect(guardPeriodeTerkunci(db, '2025-06-01', 'Koreksi struk susulan Desember')).toBeNull();
    insertAuditLog(db, buatAuditLog('EDIT t2', 'Koreksi struk susulan Desember', UPAKARA));
    const n26b = neraca(tx, [{ ...PANJAR }], [tutup], '2026-01-31', KAS_KODES);
    expect(n26b.balance).toBe(true);
  });
});

describe('T8 format rupiah', () => {
  it('negatif pakai kurung', () => {
    expect(formatRp(1_500_000)).toBe('Rp 1.500.000');
    expect(formatRp(-100_000)).toBe('(Rp 100.000)');
    expect(formatRp(0)).toBe('Rp 0');
  });
});
