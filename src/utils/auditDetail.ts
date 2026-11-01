// Parse aman data_lama_json/data_baru_json audit_log untuk popup detail.
// Bentuk yang dikenal: transaksi BKU lama, panjar lama, jurnal v2
// `{ jurnal, baris }`, dan panjar v2 `{ panjar, items?, jurnal?, baris? }`.
// Bentuk lain → teks mentah (JSON tetap ditampilkan rapi bila valid).

import { formatWaktuLokal } from './tanggal.js';

export type AuditBarisJurnal = {
  akun: string;
  keterangan: string;
  debit: number;
  kredit: number;
};

export type AuditJurnalView = {
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  jenis: string;
  baris: AuditBarisJurnal[];
  total_debit: number;
  total_kredit: number;
};

export type AuditItemPanjar = {
  akun: string;
  nominal: number;
};

export type AuditDetailView =
  | ({ kind: 'jurnal' } & AuditJurnalView)
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
      tanggal_close: string;
      penerima: string;
      jumlah: number;
      akun_kas_sumber: string;
      status: string;
      items: AuditItemPanjar[];
      total_realisasi: number | null;
      sisa: number | null;
      kurang: number | null;
      jurnal: AuditJurnalView | null;
    }
  | { kind: 'mentah'; teks: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const teks = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

const angka = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : 0;

const angkaOpsional = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

function jumlahBaris(baris: readonly AuditBarisJurnal[]): {
  debit: number;
  kredit: number;
} {
  return baris.reduce(
    (total, b) => ({
      debit: total.debit + b.debit,
      kredit: total.kredit + b.kredit,
    }),
    { debit: 0, kredit: 0 },
  );
}

/** Bentuk audit v2 posting jurnal: `{ jurnal, baris }`. */
function parseJurnalV2(raw: Record<string, unknown>): AuditJurnalView | null {
  const jurnal = raw.jurnal;
  if (!isObj(jurnal) || !Array.isArray(raw.baris)) return null;

  const baris = raw.baris.filter(isObj).map((b) => ({
    akun: teks(b.akun_kode) || teks(b.akun),
    keterangan: teks(b.keterangan),
    debit: angka(b.debit),
    kredit: angka(b.kredit),
  }));
  const total = jumlahBaris(baris);

  return {
    tanggal: teks(jurnal.tanggal),
    no_bukti: teks(jurnal.no_bukti),
    keterangan: teks(jurnal.keterangan),
    jenis: teks(jurnal.jenis),
    baris,
    total_debit: total.debit,
    total_kredit: total.kredit,
  };
}

function buatPanjar(
  panjar: Record<string, unknown>,
  itemsRaw: unknown,
  sumberNominal: Record<string, unknown>,
  jurnal: AuditJurnalView | null,
): Omit<Extract<AuditDetailView, { kind: 'panjar' }>, 'kind'> | null {
  if (typeof panjar.penerima !== 'string') return null;
  if (typeof panjar.jumlah !== 'number' || !Number.isFinite(panjar.jumlah)) {
    return null;
  }

  const items = Array.isArray(itemsRaw)
    ? itemsRaw.filter(isObj).map((it) => ({
        akun: teks(it.akun) || teks(it.kategori_baga),
        nominal: angka(it.nominal),
      }))
    : [];

  return {
    tanggal: teks(panjar.tanggal),
    tanggal_close: teks(panjar.tanggal_close),
    penerima: panjar.penerima,
    jumlah: panjar.jumlah,
    akun_kas_sumber: teks(panjar.akun_kas_sumber),
    status: teks(panjar.status) || '-',
    items,
    total_realisasi:
      angkaOpsional(sumberNominal.totalRealisasi) ??
      angkaOpsional(panjar.total_realisasi) ??
      angkaOpsional(panjar.totalRealisasi) ??
      null,
    sisa:
      angkaOpsional(sumberNominal.sisa) ??
      angkaOpsional(panjar.sisa) ??
      null,
    kurang:
      angkaOpsional(sumberNominal.kurang) ??
      angkaOpsional(panjar.kurang) ??
      null,
    jurnal,
  };
}

/** Bentuk audit v2 panjar: `{ panjar, items?, jurnal?, baris? }`. */
function parsePanjarV2(
  raw: Record<string, unknown>,
): Omit<Extract<AuditDetailView, { kind: 'panjar' }>, 'kind'> | null {
  if (!isObj(raw.panjar)) return null;
  return buatPanjar(raw.panjar, raw.items, raw, parseJurnalV2(raw));
}

export function parseAuditDetail(
  json: string | null | undefined,
): AuditDetailView {
  const teksJson = String(json ?? '');
  let raw: unknown;
  try {
    raw = JSON.parse(teksJson) as unknown;
  } catch {
    return { kind: 'mentah', teks: formatJsonAudit(json) };
  }
  if (!isObj(raw)) return { kind: 'mentah', teks: formatJsonAudit(json) };

  // Panjar v2 dicek lebih dulu karena PANJAR-CLOSE memuat panjar + jurnal
  // sekaligus; ringkasan panjar adalah konteks yang paling penting.
  const panjarV2 = parsePanjarV2(raw);
  if (panjarV2) return { kind: 'panjar', ...panjarV2 };

  const jurnalV2 = parseJurnalV2(raw);
  if (jurnalV2) return { kind: 'jurnal', ...jurnalV2 };

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

  // Panjar lama/bentuk langsung (data_lama PANJAR-CLOSE) tidak dibungkus
  // `panjar`. Wajib punya akun_kas_sumber agar objek lain tidak salah dikenali.
  if (
    typeof raw.tanggal === 'string' &&
    typeof raw.akun_kas_sumber === 'string'
  ) {
    const panjar = buatPanjar(raw, undefined, raw, null);
    if (panjar) return { kind: 'panjar', ...panjar };
  }

  return { kind: 'mentah', teks: formatJsonAudit(json) };
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
  const a = String(aksi ?? '');

  // Aksi spesifik harus dicek sebelum label generiknya.
  if (a.startsWith('TUTUP-ULANG')) return 'Tutup buku (ulang)';
  if (a.startsWith('TUTUP ')) return 'Tutup buku';
  if (a.startsWith('KOREKSI-ISI-ULANG')) return 'Koreksi & isi ulang jurnal';
  if (a.startsWith('REVERSAL')) return 'Koreksi jurnal (balik)';
  if (a.startsWith('CREATE t-')) return 'Tambah transaksi BKU';
  if (a.startsWith('CREATE ')) return 'Tambah jurnal';
  if (a.startsWith('SALDO-AWAL')) return 'Saldo awal';
  if (a.startsWith('ASET-CREATE')) return 'Tambah aset';
  if (a.startsWith('ASET-UPDATE')) return 'Ubah aset';
  if (a.startsWith('ASET-DELETE')) return 'Hapus aset';
  if (a.startsWith('PIHAK-CREATE')) return 'Tambah pihak';
  if (a.startsWith('PIHAK-UPDATE')) return 'Ubah pihak';
  if (a.startsWith('PIHAK-DELETE')) return 'Hapus pihak';
  if (a.startsWith('AKUN-TAMBAH')) return 'Tambah akun';
  if (a.startsWith('AKUN-UBAH')) return 'Ubah nama akun';
  if (a.startsWith('AKUN-NONAKTIF')) return 'Nonaktifkan akun';
  if (a.startsWith('AKUN-AKTIF')) return 'Aktifkan akun';
  if (a.startsWith('AKUN-HAPUS')) return 'Hapus akun';
  if (a.startsWith('PIUTANG-BERI-PINJAMAN')) return 'Beri pinjaman (piutang)';
  if (a.startsWith('PIUTANG-PELUNASAN')) return 'Terima pelunasan piutang';
  if (a.startsWith('HUTANG-TERIMA-PINJAMAN')) return 'Terima pinjaman (hutang)';
  if (a.startsWith('HUTANG-BAYAR')) return 'Bayar hutang';
  if (a.startsWith('HUTANG-BELI-KREDIT')) return 'Beli kredit (hutang)';
  if (a.startsWith('ANGGARAN')) return 'Ubah anggaran';
  if (a.startsWith('REKONSILIASI-SELESAI')) return 'Selesaikan rekonsiliasi bank';
  if (a.startsWith('REKONSILIASI')) return 'Rekonsiliasi bank';
  // Label audit lama modul Import Excel (dihapus DB-25); tetap dibaca agar
  // riwayat audit lama tidak kehilangan keterangan.
  if (a.startsWith('IMPORT')) return 'Impor Excel';
  if (a.startsWith('LAMPIRAN-TAMBAH')) return 'Tambah lampiran';
  if (a.startsWith('LAMPIRAN-HAPUS')) return 'Hapus lampiran';
  if (a.startsWith('PENGATURAN-SETUP-PIN')) return 'Buat PIN';
  if (a.startsWith('PENGATURAN-RESET-PIN')) return 'Reset PIN (kode darurat)';
  if (a.startsWith('PENGATURAN-KODE-DARURAT')) return 'Atur/ganti kode darurat';
  if (a.startsWith('PENGATURAN-PIN')) return 'Ganti PIN';
  if (a.startsWith('PENGATURAN-IDLE')) return 'Ubah auto-kunci';
  if (a.startsWith('PENGATURAN-PEMBUKUAN')) return 'Ubah pengaturan pembukuan';
  if (a.startsWith('PENGATURAN')) return 'Ubah pengaturan';
  if (a.startsWith('BACKUP-LENGKAP')) return 'Backup lengkap';
  if (a.startsWith('BACKUP-EXPORT')) return 'Backup manual';
  if (a.startsWith('BACKUP-AUTO')) return 'Backup otomatis';
  if (a.startsWith('BACKUP')) return 'Backup database';
  if (a.startsWith('RESTORE-KODE-DARURAT-DIPERTAHANKAN')) {
    return 'Restore database (kode darurat dipertahankan)';
  }
  if (a.startsWith('RESTORE-PIN-DIPERTAHANKAN')) {
    return 'Restore database (PIN dipertahankan)';
  }
  if (a.startsWith('RESTORE-LENGKAP')) return 'Restore lengkap';
  if (a.startsWith('RESTORE')) return 'Restore database';
  if (a.startsWith('PANJAR-OPEN')) return 'Panjar baru';
  if (a.startsWith('PANJAR-CLOSE')) return 'Tutup panjar';
  if (a.startsWith('PANJAR-BATAL')) return 'Batalkan panjar';
  if (a.startsWith('PINJAMAN-PENCAIRAN')) return 'Pencairan pinjaman LPD';
  if (a.startsWith('PINJAMAN-BAYAR')) return 'Pembayaran angsuran pinjaman LPD';
  if (a.startsWith('PINJAMAN-CREATE')) return 'Pinjaman LPD baru';
  return a;
}
