// DB-12 — audit integritas saat startup.
//
// Audit startup hanya mencatat, tidak menulis DB, dan tidak boleh menghalangi
// aplikasi dibuka. Modul auditnya tetap `src/db/integritas.ts` (AKT-09/DB-12).

import type Database from 'better-sqlite3';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { openDb } from '../src/db/database.js';
import type {
  HasilAuditIntegritas,
  KodeTemuan,
} from '../src/db/integritas.js';
import {
  KODE_AUDIT_KRITIS,
  auditIntegritasSaatMulai,
  ringkasanAuditAwal,
} from '../src/main/auditAwal.js';
import { AuditAwalBanner } from '../src/renderer/components/AuditAwalBanner.js';

const WAKTU = '2026-10-30T00:00:00.000Z';

function loggerPalsu() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
  };
}

/** Korupsi langsung lewat SQL: total debit ≠ kredit. */
function buatJurnalTidakSeimbang(db: Database.Database): void {
  db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES ('j-rusak', '2026-01-02', '', 'Korupsi', 'UMUM', 'j-rusak', NULL, ?)`,
  ).run(WAKTU);
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES ('j-rusak', '1001', 1000, 0, '')`,
  ).run();
  db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES ('j-rusak', '4001', 0, 900, '')`,
  ).run();
}

describe('DB-12 — audit integritas saat mulai', () => {
  it('DB bersih: mengembalikan hasil ok dan mencatat info', () => {
    const db = openDb(':memory:');
    const log = loggerPalsu();
    try {
      const hasil = auditIntegritasSaatMulai(db, log);
      expect(hasil?.ok).toBe(true);
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining('lolos audit integritas'),
      );
      expect(log.warn).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('DB rusak: mencatat warning berisi kode/pesan tetapi tidak melempar', () => {
    const db = openDb(':memory:');
    const log = loggerPalsu();
    try {
      buatJurnalTidakSeimbang(db);
      const jumlahJurnal = db.prepare('SELECT COUNT(*) AS n FROM jurnal').get();

      expect(() => auditIntegritasSaatMulai(db, log)).not.toThrow();
      const hasil = auditIntegritasSaatMulai(db, log);

      expect(hasil?.ok).toBe(false);
      expect(hasil?.temuan.map((t) => t.kode)).toContain('JURNAL_TIDAK_SEIMBANG');
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringMatching(/JURNAL_TIDAK_SEIMBANG.*tidak seimbang/i),
      );
      // Audit tidak mengubah data.
      expect(db.prepare('SELECT COUNT(*) AS n FROM jurnal').get()).toEqual(jumlahJurnal);
    } finally {
      db.close();
    }
  });

  it('audit gagal dibaca (DB tertutup) tetap tidak melempar dan dicatat sebagai warning', () => {
    const db = openDb(':memory:');
    db.close();
    const log = loggerPalsu();

    expect(() => auditIntegritasSaatMulai(db, log)).not.toThrow();
    expect(auditIntegritasSaatMulai(db, log)).toBeNull();
    expect(log.warn).toHaveBeenCalled();
  });

  it('logger opsional: hasil tetap dikembalikan tanpa logger', () => {
    const db = openDb(':memory:');
    try {
      expect(auditIntegritasSaatMulai(db)?.ok).toBe(true);
    } finally {
      db.close();
    }
  });
});

function hasilPalsu(kode: KodeTemuan[]): HasilAuditIntegritas {
  return {
    ok: kode.length === 0,
    ringkasan:
      kode.length === 0
        ? 'Audit integritas: tidak ada temuan.'
        : `Audit integritas: ${kode.length} temuan.`,
    temuan: kode.map((k, i) => ({ kode: k, pesan: `Pesan temuan ${i + 1}` })),
  };
}

describe('T-A16 — ringkasan banner audit awal', () => {
  it('DB bersih / hasil tidak tersedia tidak menampilkan banner', () => {
    expect(ringkasanAuditAwal(null)).toBeNull();
    expect(ringkasanAuditAwal(undefined)).toBeNull();
    expect(ringkasanAuditAwal(hasilPalsu([]))).toBeNull();
  });

  it('membatasi temuan teratas maksimal 5 tetapi jumlah tetap total', () => {
    const hasil = hasilPalsu([
      'JURNAL_TIDAK_SEIMBANG',
      'JURNAL_TANPA_BARIS',
      'REVERSAL_GANDA',
      'AKUN_TIDAK_DIKENAL',
      'PANJAR_OPEN_TIDAK_LENGKAP',
      'NOMOR_BUKTI_DUPLIKAT',
      'BARIS_ORPHAN',
    ]);
    const ringkasan = ringkasanAuditAwal(hasil);
    expect(ringkasan).not.toBeNull();
    expect(ringkasan?.jumlahTemuan).toBe(7);
    expect(ringkasan?.temuanTampil).toHaveLength(5);
    expect(ringkasan?.temuanTampil.map((t) => t.kode)).toEqual([
      'JURNAL_TIDAK_SEIMBANG',
      'JURNAL_TANPA_BARIS',
      'REVERSAL_GANDA',
      'AKUN_TIDAK_DIKENAL',
      'PANJAR_OPEN_TIDAK_LENGKAP',
    ]);
  });

  it('menandai kode kritis unik dan membedakan temuan non-kritis', () => {
    const kritis = ringkasanAuditAwal(
      hasilPalsu([
        'NERACA_TIDAK_SEIMBANG',
        'SNAPSHOT_TUTUP_BERUBAH',
        'NERACA_TIDAK_SEIMBANG',
        'JURNAL_TANPA_BARIS',
      ]),
    );
    expect(kritis?.adaKritis).toBe(true);
    expect(kritis?.kodeKritis).toEqual([
      'NERACA_TIDAK_SEIMBANG',
      'SNAPSHOT_TUTUP_BERUBAH',
    ]);
    expect(KODE_AUDIT_KRITIS).toContain('PEMBUKAAN_AKTIF_HILANG');

    const biasa = ringkasanAuditAwal(hasilPalsu(['JURNAL_TANPA_BARIS']));
    expect(biasa?.adaKritis).toBe(false);
    expect(biasa?.kodeKritis).toEqual([]);
  });

  it('hasil audit startup yang rusak bisa diringkas tanpa melempar', () => {
    const db = openDb(':memory:');
    try {
      buatJurnalTidakSeimbang(db);
      const hasil = auditIntegritasSaatMulai(db, loggerPalsu());
      const ringkasan = ringkasanAuditAwal(hasil);
      expect(ringkasan?.jumlahTemuan).toBeGreaterThan(0);
      expect(ringkasan?.temuanTampil[0]).toMatchObject({
        kode: 'JURNAL_TIDAK_SEIMBANG',
      });
    } finally {
      db.close();
    }
  });
});

describe('T-A16 — banner audit awal', () => {
  it('temuan kritis memakai peringatan merah dan tombol Buka Audit', () => {
    const ringkasan = ringkasanAuditAwal(
      hasilPalsu(['NERACA_TIDAK_SEIMBANG', 'JURNAL_TANPA_BARIS']),
    );
    const html = renderToStaticMarkup(
      createElement(AuditAwalBanner, {
        ringkasan,
        onBukaAudit: () => {},
        onTutup: () => {},
      }),
    );
    expect(html).toContain('masalah kritis');
    expect(html).toContain('bg-red-50');
    expect(html).toContain('NERACA_TIDAK_SEIMBANG');
    expect(html).toContain('Kode kritis: NERACA_TIDAK_SEIMBANG');
    expect(html).toContain('Buka Audit');
    expect(html).toContain('Abaikan');
  });

  it('temuan non-kritis memakai peringatan kuning', () => {
    const ringkasan = ringkasanAuditAwal(hasilPalsu(['JURNAL_TANPA_BARIS']));
    const html = renderToStaticMarkup(
      createElement(AuditAwalBanner, {
        ringkasan,
        onBukaAudit: () => {},
        onTutup: () => {},
      }),
    );
    expect(html).toContain('Audit integritas menemukan masalah');
    expect(html).not.toContain('masalah kritis');
    expect(html).toContain('bg-amber-50');
    expect(html).toContain('JURNAL_TANPA_BARIS');
  });

  it('tanpa ringkasan tidak merender apa pun', () => {
    expect(
      renderToStaticMarkup(
        createElement(AuditAwalBanner, {
          ringkasan: null,
          onBukaAudit: () => {},
          onTutup: () => {},
        }),
      ),
    ).toBe('');
  });
});
