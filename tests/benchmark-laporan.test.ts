// T3.7 — Benchmark ringan & regression query plan laporan.
//
// Dataset sengaja kecil (±500 jurnal / 2.500 baris) agar test tetap cepat di
// CI, tetapi cukup untuk memastikan lima operasi laporan selesai jauh di bawah
// batas dan query utama memakai index yang kanonik.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  laporanArusKas,
  laporanBukuBesar,
  laporanLabaRugi,
  laporanNeracaSaldo,
  listBarisJurnal,
} from '../src/db/laporan.js';
import { listTutupBuku } from '../src/db/repository.js';
import { buildDashboardJurnal } from '../src/features/dashboard/dashboard.js';

const JUMLAH_JURNAL = 500;
const CUTOFF = '2026-12-31';
const MULAI_TAHUN = '2026-01-01';
const BATAS_PER_OPERASI_MS = 5_000;
const BATAS_TOTAL_MS = 15_000;

function tanggalKe(ke: number): string {
  // Test hanya 500 jurnal; pakai langkah 2 hari agar tanggal tersebar ±3 tahun
  // (termasuk 2026) sehingga filter periode benar-benar menghasilkan data.
  const hari = (ke * 2) % 1096;
  return new Date(Date.UTC(2024, 0, 1) + hari * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function seed(db: ReturnType<typeof openDb>, jumlahJurnal: number): void {
  const insJurnal = db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, ?, '', ?, 'UMUM', ?, NULL, ?)`,
  );
  const insBaris = db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const waktu = '2026-01-01T00:00:00.000Z';
  const isi = db.transaction(() => {
    for (let i = 0; i < jumlahJurnal; i += 1) {
      const id = `bench-${String(i + 1).padStart(4, '0')}`;
      insJurnal.run(id, tanggalKe(i), `Jurnal benchmark ${i + 1}`, id, waktu);
      const n = 100_000 + (i % 50) * 10_000;
      // Lima baris seimbang: D 1,5n = K 1,5n.
      insBaris.run(id, '1001', n, 0, 'Kas masuk');
      insBaris.run(id, '5010', n / 2, 0, 'Beban operasional');
      insBaris.run(id, '4005', 0, n, 'Pendapatan');
      insBaris.run(id, '3000', 0, (n * 3) / 10, 'Modal');
      insBaris.run(id, '2050', 0, (n * 2) / 10, 'Utang');
    }
  });
  isi();
}

describe('T3.7 — benchmark ringan lima operasi laporan', () => {
  const db = openDb(':memory:');

  beforeAll(() => {
    seed(db, JUMLAH_JURNAL);
  });

  afterAll(() => {
    db.close();
  });

  it('semua operasi selesai di bawah threshold dan menghasilkan data', () => {
    const ukur = (operasi: () => unknown): number => {
      const mulai = performance.now();
      operasi();
      return performance.now() - mulai;
    };

    const semuaMulai = performance.now();
    const msDashboard = ukur(() =>
      buildDashboardJurnal(listBarisJurnal(db), listTutupBuku(db), CUTOFF),
    );
    const msNeracaSaldo = ukur(() => laporanNeracaSaldo(db, CUTOFF));
    const msLabaRugi = ukur(() =>
      laporanLabaRugi(db, { mulai: MULAI_TAHUN, sampai: CUTOFF }),
    );
    const msArusKas = ukur(() =>
      laporanArusKas(db, { mulai: MULAI_TAHUN, sampai: CUTOFF }),
    );
    const msBukuBesar = ukur(() => laporanBukuBesar(db, '1001'));
    const msTotal = performance.now() - semuaMulai;

    // Hasil tidak kosong: dataset benar-benar terbaca oleh semua jalur.
    const baris = listBarisJurnal(db);
    expect(baris).toHaveLength(JUMLAH_JURNAL * 5);

    const dashboard = buildDashboardJurnal(baris, listTutupBuku(db), CUTOFF);
    expect(dashboard.jurnalTerakhir).not.toBeNull();
    expect(dashboard.kasBank.rincian.length).toBeGreaterThan(0);

    const neracaSaldo = laporanNeracaSaldo(db, CUTOFF);
    expect(neracaSaldo.rows.length).toBeGreaterThan(0);

    const labaRugi = laporanLabaRugi(db, { mulai: MULAI_TAHUN, sampai: CUTOFF });
    expect(labaRugi.totalPendapatan).toBeGreaterThan(0);

    const arusKas = laporanArusKas(db, { mulai: MULAI_TAHUN, sampai: CUTOFF });
    expect(arusKas.rows.length).toBeGreaterThan(0);

    const bukuBesar = laporanBukuBesar(db, '1001');
    expect(bukuBesar.rows.length).toBeGreaterThan(0);

    const waktu = {
      dashboard: msDashboard,
      neracaSaldo: msNeracaSaldo,
      labaRugi: msLabaRugi,
      arusKas: msArusKas,
      bukuBesar: msBukuBesar,
    };
    for (const [nama, ms] of Object.entries(waktu)) {
      expect(ms, `${nama} ${ms.toFixed(1)} ms`).toBeLessThan(BATAS_PER_OPERASI_MS);
    }
    expect(msTotal).toBeLessThan(BATAS_TOTAL_MS);
  });
});

describe('T3.7 — query plan memakai index kanonik', () => {
  const db = openDb(':memory:');

  afterAll(() => {
    db.close();
  });

  function detailPlan(sql: string, ...params: unknown[]): string {
    const rows = db
      .prepare(`EXPLAIN QUERY PLAN ${sql}`)
      .all(...params) as { detail: string }[];
    return rows.map((r) => r.detail).join(' | ');
  }

  it('filter tanggal jurnal memakai idx_jurnal_tanggal', () => {
    const plan = detailPlan('SELECT * FROM jurnal WHERE tanggal <= ?', '2026-12-31');
    expect(plan).toContain('idx_jurnal_tanggal');
  });

  it('baris per jurnal memakai idx_jurnal_baris_jurnal', () => {
    const plan = detailPlan(
      'SELECT * FROM jurnal_baris WHERE jurnal_id = ?',
      'bench-0001',
    );
    expect(plan).toContain('idx_jurnal_baris_jurnal');
  });

  it('audit terbaru s/d tanggal memakai index audit tanggal', () => {
    const plan = detailPlan(
      'SELECT * FROM audit_log WHERE tanggal <= ? ORDER BY tanggal DESC',
      '2026-12-31T23:59:59.999Z',
    );
    expect(plan).toMatch(/idx_audit_tanggal|idx_audit_/);
  });
});
