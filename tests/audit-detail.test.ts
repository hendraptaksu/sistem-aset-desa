// T11 Detail koreksi: parse aman data_lama_json (transaksi / panjar / rusak).
import { describe, expect, it } from 'vitest';
import { formatAksiAudit, parseAuditDetail } from '../src/utils/auditDetail.js';

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

  it('aksi tak dikenal tampil mentah', () => {
    expect(formatAksiAudit('EDIT t-1')).toBe('EDIT t-1');
  });
});
