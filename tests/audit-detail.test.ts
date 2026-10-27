// T11 Detail koreksi: parse aman data_lama_json (transaksi / panjar / rusak).
import { describe, expect, it } from 'vitest';
import {
  formatAksiAudit,
  formatJsonAudit,
  formatWaktuAudit,
  parseAuditDetail,
} from '../src/utils/auditDetail.js';

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
    expect(formatAksiAudit('BACKUP-AUTO')).toBe('Backup database');
    expect(formatAksiAudit('BACKUP-EXPORT')).toBe('Backup database');
    expect(formatAksiAudit('RESTORE')).toBe('Restore database');
    expect(formatAksiAudit('PENGATURAN-IDLE')).toBe('Ubah pengaturan');
  });

  it('aksi tak dikenal tampil mentah', () => {
    expect(formatAksiAudit('EDIT t-1')).toBe('EDIT t-1');
  });
});
