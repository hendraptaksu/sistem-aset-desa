// T11 Detail koreksi: parse aman data_lama_json (transaksi / panjar / jurnal v2).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  formatAksiAudit,
  formatJsonAudit,
  formatWaktuAudit,
  parseAuditDetail,
} from '../src/utils/auditDetail.js';
import { AuditDetail } from '../src/renderer/components/AuditDetail.js';

describe('T11 parseAuditDetail', () => {
  it('transaksi BKU dikenali dengan field lengkap', () => {
    const json = JSON.stringify({
      id: 't-1',
      tanggal: '2025-12-05',
      keterangan: 'Parkir susulan',
      akun_kas: '1015',
      kategori: '4005',
      masuk: 50000000,
      keluar: 0,
    });
    const v = parseAuditDetail(json);
    expect(v.kind).toBe('transaksi');
    if (v.kind === 'transaksi') {
      expect(v.tanggal).toBe('2025-12-05');
      expect(v.keterangan).toBe('Parkir susulan');
      expect(v.masuk).toBe(50000000);
    }
  });

  it('panjar dikenali dengan field lengkap', () => {
    const json = JSON.stringify({
      id: 'p-1',
      tanggal: '2025-12-06',
      penerima: 'Panitia Piodalan',
      jumlah: 500000000,
      akun_kas_sumber: '1001',
      status: 'OPEN',
    });
    const v = parseAuditDetail(json);
    expect(v.kind).toBe('panjar');
    if (v.kind === 'panjar') {
      expect(v.penerima).toBe('Panitia Piodalan');
      expect(v.jumlah).toBe(500000000);
    }
  });

  it('JSON rusak fallback mentah tanpa throw', () => {
    const v = parseAuditDetail('bukan-json{{{');
    expect(v.kind).toBe('mentah');
    if (v.kind === 'mentah') expect(v.teks).toBe('bukan-json{{{');
  });

  it('bentuk tak dikenal fallback mentah', () => {
    const v = parseAuditDetail('{}');
    expect(v.kind).toBe('mentah');
  });

  it('jurnal v2 { jurnal, baris } dikenali lengkap', () => {
    const json = JSON.stringify({
      jurnal: {
        id: 'j-1',
        tanggal: '2025-12-05',
        no_bukti: 'JU-2025-0001',
        keterangan: 'Pendapatan parkir',
        jenis: 'TERIMA',
      },
      baris: [
        { akun_kode: '1001', debit: 50_000_000, kredit: 0, keterangan: 'Kas' },
        { akun_kode: '4005', debit: 0, kredit: 50_000_000, keterangan: '' },
      ],
    });
    const v = parseAuditDetail(json);
    expect(v.kind).toBe('jurnal');
    if (v.kind === 'jurnal') {
      expect(v.tanggal).toBe('2025-12-05');
      expect(v.no_bukti).toBe('JU-2025-0001');
      expect(v.keterangan).toBe('Pendapatan parkir');
      expect(v.baris).toHaveLength(2);
      expect(v.baris[0]).toMatchObject({ akun: '1001', debit: 50_000_000 });
      expect(v.total_debit).toBe(50_000_000);
      expect(v.total_kredit).toBe(50_000_000);
    }
  });

  it('panjar v2 { panjar, items } dikenali lengkap', () => {
    const json = JSON.stringify({
      panjar: {
        id: 'p-1',
        tanggal: '2025-12-06',
        tanggal_close: '2025-12-10',
        penerima: 'Panitia Piodalan',
        jumlah: 500_000_000,
        akun_kas_sumber: '1001',
        status: 'CLOSED',
        total_realisasi: 450_000_000,
      },
      items: [
        { kategori_baga: '5004', nominal: 300_000_000 },
        { akun: '5007', nominal: 150_000_000 },
      ],
      totalRealisasi: 450_000_000,
      sisa: 50_000_000,
      kurang: 0,
    });
    const v = parseAuditDetail(json);
    expect(v.kind).toBe('panjar');
    if (v.kind === 'panjar') {
      expect(v.penerima).toBe('Panitia Piodalan');
      expect(v.jumlah).toBe(500_000_000);
      expect(v.status).toBe('CLOSED');
      expect(v.tanggal_close).toBe('2025-12-10');
      expect(v.items).toEqual([
        { akun: '5004', nominal: 300_000_000 },
        { akun: '5007', nominal: 150_000_000 },
      ]);
      expect(v.total_realisasi).toBe(450_000_000);
      expect(v.sisa).toBe(50_000_000);
      expect(v.kurang).toBe(0);
      expect(v.jurnal).toBeNull();
    }
  });

  it('panjar tutup dengan jurnal terkait menampilkan keduanya', () => {
    const json = JSON.stringify({
      panjar: {
        tanggal: '2025-12-06',
        penerima: 'Panitia Piodalan',
        jumlah: 500_000_000,
        akun_kas_sumber: '1001',
        status: 'CLOSED',
      },
      items: [{ kategori_baga: '5004', nominal: 500_000_000 }],
      jurnal: {
        tanggal: '2025-12-10',
        no_bukti: 'JU-2025-0002',
        keterangan: 'Pertanggungjawaban panjar',
      },
      baris: [
        { akun_kode: '5004', debit: 500_000_000, kredit: 0 },
        { akun_kode: '1040', debit: 0, kredit: 500_000_000 },
      ],
    });
    const v = parseAuditDetail(json);
    expect(v.kind).toBe('panjar');
    if (v.kind === 'panjar') {
      expect(v.jurnal?.no_bukti).toBe('JU-2025-0002');
      expect(v.jurnal?.total_kredit).toBe(500_000_000);
    }
  });

  it('JSON null/rusak/bentuk v2 tidak lengkap tidak pernah throw', () => {
    for (const json of [
      '',
      '   ',
      'null',
      '[]',
      'bukan-json{{{',
      '{"jurnal":null,"baris":[]}',
      '{"jurnal":{},"baris":"bukan-array"}',
      '{"panjar":{},"items":[]}',
    ]) {
      expect(() => parseAuditDetail(json)).not.toThrow();
      expect(parseAuditDetail(json).kind).toBe('mentah');
    }
  });

  it('baris jurnal rusak dinormalisasi tanpa crash', () => {
    const v = parseAuditDetail(
      JSON.stringify({
        jurnal: { tanggal: 123, no_bukti: null, keterangan: 'Tetap tampil' },
        baris: [null, 'x', { akun_kode: 1001, debit: 'salah', kredit: 5_000 }],
      }),
    );
    expect(v.kind).toBe('jurnal');
    if (v.kind === 'jurnal') {
      expect(v.tanggal).toBe('');
      expect(v.keterangan).toBe('Tetap tampil');
      expect(v.baris).toHaveLength(1);
      expect(v.baris[0]).toEqual({
        akun: '',
        keterangan: '',
        debit: 0,
        kredit: 5_000,
      });
    }
  });
});

describe('T11a format detail audit sebelum/sesudah', () => {
  it('JSON kosong/rusak/null aman tanpa throw', () => {
    expect(formatJsonAudit('')).toBe('-');
    expect(formatJsonAudit('   ')).toBe('-');
    expect(formatJsonAudit('bukan-json{{{')).toBe('bukan-json{{{');
    expect(formatJsonAudit('null')).toBe('null');
    expect(formatJsonAudit(undefined)).toBe('-');
  });

  it('objek diformat rapi dan string JSON ditampilkan sebagai teks', () => {
    expect(formatJsonAudit('{"id":"j-1","baris":[1,2]}')).toContain('\n');
    expect(formatJsonAudit('{"id":"j-1"}')).toContain('"id": "j-1"');
    expect(formatJsonAudit('"PIN diganti"')).toBe('PIN diganti');
  });

  it('waktu ISO diformat ringkas dalam WITA, nilai aneh tetap aman', () => {
    expect(formatWaktuAudit('2026-10-22T14:05:00.000Z')).toBe('2026-10-22 22:05');
    expect(formatWaktuAudit('2026-10-22T23:30:00Z')).toBe('2026-10-23 07:30');
    expect(formatWaktuAudit('bukan-waktu')).toBe('bukan-waktu');
  });
});

describe('T12 formatAksiAudit', () => {
  it('CREATE t-… → Tambah transaksi BKU', () => {
    expect(formatAksiAudit('CREATE t-1788665578796-505652')).toBe('Tambah transaksi BKU');
  });

  it('PANJAR-OPEN p-… → Panjar baru', () => {
    expect(formatAksiAudit('PANJAR-OPEN p-1788665578796-123456')).toBe('Panjar baru');
  });

  it('PANJAR-CLOSE p-… → Tutup panjar', () => {
    expect(formatAksiAudit('PANJAR-CLOSE p-1788665578796-123456')).toBe('Tutup panjar');
  });

  it('TUTUP / TUTUP-ULANG → label tutup buku', () => {
    expect(formatAksiAudit('TUTUP 2025')).toBe('Tutup buku');
    expect(formatAksiAudit('TUTUP-ULANG 2025')).toBe('Tutup buku (ulang)');
  });

  it('aksi P0-9 memakai label ramah', () => {
    expect(formatAksiAudit('CREATE j-1')).toBe('Tambah jurnal');
    expect(formatAksiAudit('REVERSAL j-1')).toBe('Koreksi jurnal (balik)');
    expect(formatAksiAudit('KOREKSI-ISI-ULANG j-1')).toBe('Koreksi & isi ulang jurnal');
    expect(formatAksiAudit('SALDO-AWAL j-1')).toBe('Saldo awal');
    expect(formatAksiAudit('ASET-CREATE a-1')).toBe('Tambah aset');
    expect(formatAksiAudit('ASET-UPDATE a-1')).toBe('Ubah aset');
    expect(formatAksiAudit('ASET-DELETE a-1')).toBe('Hapus aset');
    expect(formatAksiAudit('BACKUP-AUTO')).toBe('Backup otomatis');
    expect(formatAksiAudit('BACKUP-EXPORT')).toBe('Backup manual');
    expect(formatAksiAudit('RESTORE')).toBe('Restore database');
    expect(formatAksiAudit('PENGATURAN-IDLE')).toBe('Ubah auto-kunci');
  });

  it('aksi pihak, piutang, dan hutang memakai label ramah', () => {
    expect(formatAksiAudit('PIHAK-CREATE pihak-1')).toBe('Tambah pihak');
    expect(formatAksiAudit('PIHAK-UPDATE pihak-1')).toBe('Ubah pihak');
    expect(formatAksiAudit('PIHAK-DELETE pihak-1')).toBe('Hapus pihak');
    expect(formatAksiAudit('PIUTANG-BERI-PINJAMAN j-1')).toBe(
      'Beri pinjaman (piutang)',
    );
    expect(formatAksiAudit('PIUTANG-PELUNASAN j-2')).toBe(
      'Terima pelunasan piutang',
    );
    expect(formatAksiAudit('HUTANG-TERIMA-PINJAMAN j-3')).toBe(
      'Terima pinjaman (hutang)',
    );
    expect(formatAksiAudit('HUTANG-BAYAR j-4')).toBe('Bayar hutang');
    expect(formatAksiAudit('HUTANG-BELI-KREDIT j-5')).toBe(
      'Beli kredit (hutang)',
    );
  });

  it('aksi anggaran, rekonsiliasi, impor, dan lampiran berlabel', () => {
    expect(formatAksiAudit('ANGGARAN')).toBe('Ubah anggaran');
    expect(formatAksiAudit('REKONSILIASI')).toBe('Rekonsiliasi bank');
    expect(formatAksiAudit('REKONSILIASI-SELESAI')).toBe(
      'Selesaikan rekonsiliasi bank',
    );
    expect(formatAksiAudit('IMPORT-EXCEL')).toBe('Impor Excel');
    expect(formatAksiAudit('LAMPIRAN-TAMBAH')).toBe('Tambah lampiran');
    expect(formatAksiAudit('LAMPIRAN-HAPUS')).toBe('Hapus lampiran');
  });

  it('aksi PIN, pengaturan pembukuan, backup/restore lengkap berlabel', () => {
    expect(formatAksiAudit('PENGATURAN-SETUP-PIN')).toBe('Buat PIN');
    expect(formatAksiAudit('PENGATURAN-PIN')).toBe('Ganti PIN');
    expect(formatAksiAudit('PENGATURAN-RESET-PIN')).toBe(
      'Reset PIN (kode darurat)',
    );
    expect(formatAksiAudit('PENGATURAN-KODE-DARURAT')).toBe(
      'Atur/ganti kode darurat',
    );
    expect(formatAksiAudit('PENGATURAN-PEMBUKUAN')).toBe(
      'Ubah pengaturan pembukuan',
    );
    expect(formatAksiAudit('BACKUP-LENGKAP')).toBe('Backup lengkap');
    expect(formatAksiAudit('RESTORE-LENGKAP')).toBe('Restore lengkap');
    expect(formatAksiAudit('RESTORE-PIN-DIPERTAHANKAN')).toBe(
      'Restore database (PIN dipertahankan)',
    );
    expect(formatAksiAudit('RESTORE-KODE-DARURAT-DIPERTAHANKAN')).toBe(
      'Restore database (kode darurat dipertahankan)',
    );
  });

  it('aksi tak dikenal tampil mentah', () => {
    expect(formatAksiAudit('EDIT t-1')).toBe('EDIT t-1');
    expect(formatAksiAudit('')).toBe('');
  });
});

describe('T11b komponen AuditDetail human-readable', () => {
  it('jurnal v2 dirender sebagai ringkasan + tabel, bukan JSON mentah', () => {
    const json = JSON.stringify({
      jurnal: {
        tanggal: '2025-12-05',
        no_bukti: 'JU-2025-0001',
        keterangan: 'Pendapatan parkir',
      },
      baris: [
        { akun_kode: '1001', debit: 50_000_000, kredit: 0 },
        { akun_kode: '4005', debit: 0, kredit: 50_000_000 },
      ],
    });
    const html = renderToStaticMarkup(createElement(AuditDetail, { json }));
    expect(html).toContain('JU-2025-0001');
    expect(html).toContain('Pendapatan parkir');
    expect(html).toContain('5 Des 2025');
    expect(html).toContain('KAS');
    expect(html).toContain('PENDAPATAN PARKIR');
    expect(html).toContain('Debit');
    expect(html).toContain('Kredit');
    expect(html).toContain('Total');
    expect(html).not.toContain('&quot;baris&quot;');
  });

  it('panjar v2 menampilkan penerima, jumlah, status, dan rincian', () => {
    const json = JSON.stringify({
      panjar: {
        tanggal: '2025-12-06',
        penerima: 'Panitia Piodalan',
        jumlah: 500_000_000,
        akun_kas_sumber: '1001',
        status: 'CLOSED',
      },
      items: [{ kategori_baga: '5004', nominal: 500_000_000 }],
    });
    const html = renderToStaticMarkup(createElement(AuditDetail, { json }));
    expect(html).toContain('Panitia Piodalan');
    expect(html).toContain('Ditutup');
    expect(html).toContain('1001');
    expect(html).toContain('5004');
    expect(html).toContain('BAGA UPAKARA');
    expect(html).toContain('Rincian realisasi');
  });

  it('JSON rusak/null tetap dirender aman di <pre>', () => {
    const rusak = renderToStaticMarkup(
      createElement(AuditDetail, { json: 'bukan-json{{{' }),
    );
    expect(rusak).toContain('<pre');
    expect(rusak).toContain('bukan-json{{{');

    const kosong = renderToStaticMarkup(
      createElement(AuditDetail, { json: null }),
    );
    expect(kosong).toContain('<pre');
    expect(kosong).toContain('-');
  });
});
