// Parse aman data_lama_json audit_log untuk popup detail koreksi.
// Dua bentuk yang ditulis main: Transaksi BKU & Panjar. Selain itu → mentah.

import { formatWaktuLokal } from './tanggal.js';

export type AuditDetailView =
  | {
      kind: 'transaksi';
      tanggal: string;
      keterangan: string;
      akun_kas: string;
      kategori: string;
      masuk: number;
      keluar: number;
    }
  | {
      kind: 'panjar';
      tanggal: string;
      penerima: string;
      jumlah: number;
      akun_kas_sumber: string;
      status: string;
    }
  | { kind: 'mentah'; teks: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseAuditDetail(json: string): AuditDetailView {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    return { kind: 'mentah', teks: json };
  }
  if (!isObj(raw)) return { kind: 'mentah', teks: json };

  if (
    typeof raw.tanggal === 'string' &&
    typeof raw.keterangan === 'string' &&
    typeof raw.akun_kas === 'string' &&
    typeof raw.kategori === 'string' &&
    typeof raw.masuk === 'number' &&
    typeof raw.keluar === 'number'
  ) {
    return {
      kind: 'transaksi',
      tanggal: raw.tanggal,
      keterangan: raw.keterangan,
      akun_kas: raw.akun_kas,
      kategori: raw.kategori,
      masuk: raw.masuk,
      keluar: raw.keluar,
    };
  }

  if (
    typeof raw.tanggal === 'string' &&
    typeof raw.penerima === 'string' &&
    typeof raw.jumlah === 'number' &&
    typeof raw.akun_kas_sumber === 'string'
  ) {
    return {
      kind: 'panjar',
      tanggal: raw.tanggal,
      penerima: raw.penerima,
      jumlah: raw.jumlah,
      akun_kas_sumber: raw.akun_kas_sumber,
      status: typeof raw.status === 'string' ? raw.status : '-',
    };
  }

  return { kind: 'mentah', teks: json };
}

/**
 * Format data JSON audit untuk detail sebelum/sesudah.
 * Aman untuk string kosong maupun JSON rusak (tidak pernah melempar error).
 */
export function formatJsonAudit(json: string | null | undefined): string {
  const teks = String(json ?? '').trim();
  if (!teks) return '-';
  try {
    const data = JSON.parse(teks) as unknown;
    if (typeof data === 'string') return data || '-';
    return JSON.stringify(data, null, 2) ?? teks;
  } catch {
    return teks;
  }
}

/** Ringkasan satu baris untuk tabel; JSON kosong/rusak tetap aman. */
export function ringkasAudit(json: string | null | undefined, maks = 90): string {
  const teks = formatJsonAudit(json).replace(/\s+/g, ' ').trim();
  if (teks === '-') return '-';
  return teks.length > maks ? `${teks.slice(0, maks)}…` : teks;
}

/** Waktu audit ISO → teks lokal ringkas (YYYY-MM-DD HH:mm), fallback mentah. */
export function formatWaktuAudit(iso: string): string {
  return formatWaktuLokal(String(iso ?? ''));
}

/** Label ramah untuk kolom Aksi audit_log (id teknis disembunyikan). */
export function formatAksiAudit(aksi: string): string {
  if (aksi.startsWith('TUTUP-ULANG ')) return 'Tutup buku (ulang)';
  if (aksi.startsWith('TUTUP ')) return 'Tutup buku';
  if (aksi.startsWith('KOREKSI-ISI-ULANG ')) return 'Koreksi & isi ulang jurnal';
  if (aksi.startsWith('REVERSAL ')) return 'Koreksi jurnal (balik)';
  if (aksi.startsWith('CREATE t-')) return 'Tambah transaksi BKU';
  if (aksi.startsWith('CREATE ')) return 'Tambah jurnal';
  if (aksi.startsWith('SALDO-AWAL')) return 'Saldo awal';
  if (aksi.startsWith('ASET-CREATE')) return 'Tambah aset';
  if (aksi.startsWith('ASET-UPDATE')) return 'Ubah aset';
  if (aksi.startsWith('ASET-DELETE')) return 'Hapus aset';
  if (aksi.startsWith('BACKUP')) return 'Backup database';
  if (aksi.startsWith('RESTORE')) return 'Restore database';
  if (aksi.startsWith('PENGATURAN')) return 'Ubah pengaturan';
  if (aksi.startsWith('PANJAR-OPEN')) return 'Panjar baru';
  if (aksi.startsWith('PANJAR-CLOSE')) return 'Tutup panjar';
  return aksi;
}
