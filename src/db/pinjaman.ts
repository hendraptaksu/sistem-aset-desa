// Repository pinjaman LPD (DB-16b).
//
// Prinsip sumber angka:
// - `pinjaman_angsuran` adalah RENCANA (pokok/bunga dari perjanjian LPD).
// - `pinjaman_bayar` hanya menautkan jurnal + angsuran. Nominal pokok/bunga/
//   denda TIDAK disimpan; semuanya dibaca dari baris jurnal pembayaran.
// - Outstanding = sisa_pokok_awal - pokok pembayaran aktif. Pembatalan
//   diturunkan dari jurnal reversal; pencairan dibatalkan bersaldo awal 0.
//   Saldo dihitung saat membaca dan tidak disimpan sebagai kolom.
//
// Tabel pinjaman* adalah bagian skema baseline v1 dan sudah STRICT (lihat DDL
// di database.ts). Jangan mengubah bentuk tabel tanpa menaikkan
// SCHEMA_VERSION. Kontrak skema: `docs/skema.md`.
//
// `buatPinjaman` hanya menyimpan parameter + jadwal. Jurnal pencairan dibuat
// oleh `simpanPinjamanLpd` (mode PENCAIRAN) dalam transaksi yang sama. Mode
// "sudah berjalan" memakai `jurnal_pencairan_id = null`; sisa pokok dianggap
// sudah ada di Saldo Awal 2050.

import type Database from 'better-sqlite3';
import { tanggalKalenderValid } from '../core/posting.js';
import type { JurnalInput } from '../core/posting.js';
import { buatJurnalPinjamanPencairan } from '../core/forms.js';
import type {
  Jurnal,
  JurnalBaris,
  JurnalBarisInput,
  Pinjaman,
  PinjamanAngsuran,
  PinjamanBayar,
  RincianPembayaranPinjaman,
} from '../core/types.js';
import {
  AKUN_BUNGA_PINJAMAN,
  AKUN_DENDA_PINJAMAN,
  AKUN_HUTANG,
  akunBolehDiposting,
} from './coa.js';
import {
  saldoAwal2050,
  totalSisaPokokBerjalan,
} from './pinjamanRekonsiliasi.js';
import { postingJurnal } from './posting.js';
import { catatAudit, getAkun, getJurnalDetail, listAkun } from './repository.js';
import { formatRp } from '../utils/format.js';
import { tanggalLokal } from '../utils/tanggal.js';
import { ringkasanAngsuran } from '../core/pinjamanAngsuran.js';
import { postingReversalTertaut } from './reversal.js';
import {
  hitungMutasiPinjaman,
  periodeMutasiPinjaman,
  type FilterPeriodeMutasiPinjaman,
  type MutasiPinjamanHasil,
  type PembayaranMutasiPinjaman,
  type BarisMutasiJurnal,
} from '../core/pinjamanMutasi.js';

/**
 * Akun bunga default DB-13b/DB-16a. Alias dari konstanta `coa.ts` agar modul
 * pinjaman dan daftar akun sistem memakai satu sumber tanpa impor melingkar.
 */
export const AKUN_BUNGA_PINJAMAN_DEFAULT = AKUN_BUNGA_PINJAMAN;

/**
 * Akun denda default DB-16a: 5050 BIAYA LAIN-LAIN. Ticket DB-16d memakai
 * akun ini untuk komponen denda; konfigurasi per pinjaman dapat ditambah nanti
 * tanpa mengubah skema (nominal tetap dibaca dari baris jurnal).
 */
export const AKUN_DENDA_PINJAMAN_DEFAULT = AKUN_DENDA_PINJAMAN;

export type PinjamanAngsuranInput = {
  ke: number;
  jatuh_tempo?: string;
  /** Alias camelCase untuk pemanggil UI/test. */
  jatuhTempo?: string;
  pokok: number;
  bunga: number;
  catatan?: string;
};

export type BuatPinjamanInput = {
  /** Opsional; dibuat otomatis bila kosong. */
  id?: string;
  kreditur: string;
  akun_kas?: string;
  /** Alias camelCase. */
  akunKas?: string;
  /** Default 5063 BEBAN BUNGA PINJAMAN. */
  akun_bunga?: string;
  akunBunga?: string;
  pokok_awal?: number;
  pokokAwal?: number;
  /**
   * Sisa pokok saat pinjaman mulai. Default = pokok_awal (pencairan baru).
   * Untuk pinjaman yang sudah berjalan, isi sisa pokok dan `jurnal_pencairan_id`
   * null.
   */
  sisa_pokok_awal?: number;
  sisaPokokAwal?: number;
  tanggal_mulai?: string;
  tanggalMulai?: string;
  tenor_bulan?: number | null;
  tenorBulan?: number | null;
  /** Null/kosong = pinjaman sudah berjalan; tidak ada jurnal pencairan baru. */
  jurnal_pencairan_id?: string | null;
  jurnalPencairanId?: string | null;
  catatan?: string;
  created_at?: string;
  angsuran?: PinjamanAngsuranInput[];
  /** Alias untuk `angsuran`. */
  jadwal?: PinjamanAngsuranInput[];
};

export type HasilPinjaman = {
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  perluKonfirmasi: boolean;
  tersimpan: boolean;
  pinjaman?: Pinjaman;
};

/** Mode wizard pinjaman LPD (DB-16c). */
export type ModePinjamanLpd = 'PENCAIRAN' | 'BERJALAN';

/**
 * Input wizard pinjaman LPD. Mode pencairan membuat jurnal D kas / K 2050;
 * mode berjalan hanya menyimpan sisa pokok + jadwal tanpa jurnal baru.
 */
export type SimpanPinjamanLpdInput = {
  id?: string;
  mode: ModePinjamanLpd | string;
  kreditur: string;
  /** Tanggal pencairan (mode baru) atau tanggal mulai jadwal (mode berjalan). */
  tanggal?: string;
  tanggal_mulai?: string;
  tanggalMulai?: string;
  /** Wajib mode pencairan; mode berjalan memakai kas aktif pertama dari DB. */
  akun_kas?: string;
  akunKas?: string;
  akun_bunga?: string;
  akunBunga?: string;
  /** Pokok pencairan (mode baru). */
  pokok?: number;
  pokok_awal?: number;
  pokokAwal?: number;
  /** Sisa pokok saat mulai (mode berjalan); menjadi pokok_awal juga. */
  sisa_pokok?: number;
  sisa_pokok_awal?: number;
  sisaPokok?: number;
  sisaPokokAwal?: number;
  tenor_bulan?: number | null;
  tenorBulan?: number | null;
  /** Alias bentuk IPC/UI. */
  tenor?: number | null;
  catatan?: string;
  noBukti?: string;
  /**
   * Alasan operator bila tanggal pencairan berada di periode yang sudah
   * dikunci. Diteruskan sebagai `alasan` jurnal agar kunci periode longgar
   * tetap bisa dipakai tanpa melemahkan validasi.
   */
  alasan?: string;
  angsuran?: PinjamanAngsuranInput[];
  jadwal?: PinjamanAngsuranInput[];
};

export type OpsiSimpanPinjamanLpd = {
  konfirmasiPeringatan?: boolean;
  alasanPeringatan?: string;
  wajibSaldoAwal?: boolean;
  konfirmasiTanpaSaldoAwal?: boolean;
  /** Tanggal acuan validasi posting (test deterministik). */
  sekarang?: string;
};

export type HasilSimpanPinjamanLpd = HasilPinjaman & {
  mode?: ModePinjamanLpd;
  /** Jurnal pencairan yang dibuat; null untuk mode berjalan. */
  jurnal?: Jurnal | null;
};

export type TautkanPembayaranInput = {
  /** Opsional; dibuat otomatis bila kosong. */
  id?: string;
  pinjaman_id?: string;
  pinjamanId?: string;
  /** Null/kosong = pembayaran tanpa angsuran tertentu (mis. pelunasan). */
  angsuran_id?: number | null;
  angsuranId?: number | null;
  jurnal_id?: string;
  jurnalId?: string;
  /** Default = tanggal jurnal. */
  tanggal?: string;
  catatan?: string;
  created_at?: string;
};

/**
 * Opsi taut jurnal pembayaran (link-only). T-B06: pembayaran yang memuat
 * debit BEBAN selain akun bunga pinjaman (dan bukan 5050) wajib konfirmasi
 * operator + alasan sebelum ditulis.
 */
export type OpsiTautkanPembayaran = {
  /** Operator sudah mengonfirmasi debit beban non-bunga (dihitung denda). */
  konfirmasiDendaLain?: boolean;
  /** Wajib ≥5 karakter saat jurnal memuat debit beban non-bunga. */
  alasanDendaLain?: string;
};

export type HasilPembayaranPinjaman = {
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  perluKonfirmasi: boolean;
  tersimpan: boolean;
  pembayaran?: PinjamanBayar;
};

/**
 * Input pembayaran angsuran. Nominal boleh 0 per komponen, total wajib > 0.
 * Pembayaran sebagian mengurangi sisa; bunga di atas sisa jadwal wajib
 * `konfirmasiSelisih` + `alasanSelisih`. Pokok melebihi sisa ditolak.
 */
export type BayarAngsuranPinjamanInput = {
  /** ID pembayaran; opsional, dibuat otomatis bila kosong. */
  id?: string;
  /** ID jurnal; opsional, dibuat otomatis bila kosong (berguna untuk test). */
  jurnal_id?: string;
  jurnalId?: string;
  pinjaman_id?: string;
  pinjamanId?: string;
  angsuran_id?: number;
  angsuranId?: number;
  tanggal?: string;
  akun_kas?: string;
  akunKas?: string;
  pokok?: number;
  bunga?: number;
  denda?: number;
  catatan?: string;
  noBukti?: string;
  created_at?: string;
  /**
   * Alasan operator bila tanggal pembayaran berada di periode yang sudah
   * dikunci. Bila kosong, alasan selisih/peringatan yang sudah ada dipakai
   * sebagai alasan jurnal.
   */
  alasan?: string;
  /** Alias konfirmasi di dalam input (selain opsi argumen). */
  konfirmasiSelisih?: boolean;
  alasanSelisih?: string;
  /** T-B06: alias konfirmasi debit beban non-bunga di dalam input. */
  konfirmasiDendaLain?: boolean;
  alasanDendaLain?: string;
};

export type OpsiBayarAngsuranPinjaman = {
  /** Operator sudah melihat selisih pokok/bunga vs jadwal. */
  konfirmasiSelisih?: boolean;
  /** Wajib ≥5 karakter saat nominal berbeda dari jadwal. */
  alasanSelisih?: string;
  /** Konfirmasi peringatan posting (mis. saldo kas minus). */
  konfirmasiPeringatan?: boolean;
  alasanPeringatan?: string;
  /** T-B06: operator sudah mengonfirmasi debit beban non-bunga (dihitung denda). */
  konfirmasiDendaLain?: boolean;
  /** Wajib ≥5 karakter saat pembayaran memuat debit beban non-bunga. */
  alasanDendaLain?: string;
  wajibSaldoAwal?: boolean;
  konfirmasiTanpaSaldoAwal?: boolean;
  /** Tanggal acuan validasi posting (test deterministik). */
  sekarang?: string;
};

export type HasilBayarAngsuranPinjaman = HasilPembayaranPinjaman & {
  jurnal?: Jurnal;
  rincian?: RincianPembayaranPinjaman;
  /** Selisih realisasi terhadap jadwal (hanya informatif; jadwal tidak diubah). */
  selisih?: { pokok: number; bunga: number };
};

type Row = Record<string, unknown>;

const kosong = {
  boleh: false,
  errors: [] as string[],
  peringatan: [] as string[],
  perluKonfirmasi: false,
  tersimpan: false,
};

function gagal(errors: string | string[]): HasilPinjaman {
  return { ...kosong, errors: Array.isArray(errors) ? errors : [errors] };
}

function gagalBayar(errors: string | string[]): HasilPembayaranPinjaman {
  return { ...kosong, errors: Array.isArray(errors) ? errors : [errors] };
}

function validasiSisaPembayaran(
  pinjaman: Pinjaman,
  angsuran: PinjamanAngsuran | undefined,
  pokok: number,
): string[] {
  if (pinjaman.status === 'DIBATALKAN') return ['Pinjaman sudah dibatalkan.'];
  const errors: string[] = [];
  if (angsuran?.dibayar) errors.push(`Angsuran ke-${angsuran.ke} sudah lunas.`);
  if (pokok > (pinjaman.outstanding ?? 0))
    errors.push('Pokok pembayaran melebihi sisa pokok pinjaman.');
  if (angsuran && pokok > (angsuran.sisa_pokok ?? angsuran.pokok))
    errors.push('Pokok pembayaran melebihi sisa pokok angsuran. Bayar angsuran berikutnya secara terpisah.');
  return errors;
}

function uid(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function')
    return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v);

function teks(v: unknown): string {
  return String(v ?? '').trim();
}

function nullableTeks(v: unknown): string | null {
  const s = teks(v);
  return s ? s : null;
}

function angka(v: unknown): number {
  return Number(v ?? 0);
}

function rowToAngsuran(r: Row): PinjamanAngsuran {
  const bayarId = nullableTeks(r.pinjaman_bayar_id);
  return {
    id: angka(r.id),
    pinjaman_id: String(r.pinjaman_id),
    ke: angka(r.ke),
    jatuh_tempo: String(r.jatuh_tempo),
    pokok: angka(r.pokok),
    bunga: angka(r.bunga),
    catatan: String(r.catatan ?? ''),
    status: 'BELUM',
    dibayar: false,
    pinjaman_bayar_id: bayarId,
    tanggal_bayar: nullableTeks(r.tanggal_bayar),
    jurnal_id: nullableTeks(r.jurnal_id),
  };
}

/** Baris pinjaman tanpa turunan; dipakai internal sebelum dilengkapi. */
function rowToPinjaman(r: Row): Pinjaman {
  return {
    id: String(r.id),
    kreditur: String(r.kreditur),
    akun_kas: String(r.akun_kas),
    akun_bunga: String(r.akun_bunga),
    pokok_awal: angka(r.pokok_awal),
    sisa_pokok_awal: angka(r.sisa_pokok_awal),
    tanggal_mulai: String(r.tanggal_mulai),
    tenor_bulan:
      r.tenor_bulan === null || r.tenor_bulan === undefined
        ? null
        : angka(r.tenor_bulan),
    jurnal_pencairan_id: nullableTeks(r.jurnal_pencairan_id),
    catatan: String(r.catatan ?? ''),
    created_at: String(r.created_at ?? ''),
  };
}

function daftarAngsuran(
  db: Database.Database,
  pinjamanId: string,
  pembayaran: PinjamanBayar[],
): PinjamanAngsuran[] {
  const rows = db
    .prepare(
      `SELECT a.*
         FROM pinjaman_angsuran a
        WHERE a.pinjaman_id = ?
        ORDER BY a.ke, a.id`,
    )
    .all(pinjamanId) as Row[];
  return rows.map((r) => {
    const a = rowToAngsuran(r);
    const aktif = pembayaran.filter((p) => p.angsuran_id === a.id && !p.dibatalkan);
    const realisasi = aktif.reduce(
      (s, p) => ({ pokok: s.pokok + p.pokok, bunga: s.bunga + p.bunga, denda: s.denda + p.denda }),
      { pokok: 0, bunga: 0, denda: 0 },
    );
    // Referensi tunggal hanya ketika benar-benar ada satu kuitansi aktif.
    const satu = aktif.length === 1 ? aktif[0] : undefined;
    return {
      ...a,
      ...ringkasanAngsuran(a, realisasi),
      jumlah_pembayaran: aktif.length,
      pinjaman_bayar_id: satu?.id ?? null,
      tanggal_bayar: satu?.tanggal ?? null,
      jurnal_id: satu?.jurnal_id ?? null,
    };
  });
}

function jurnalPembatalan(db: Database.Database, jurnalId: string): Jurnal | null {
  return (db.prepare('SELECT * FROM jurnal WHERE reversal_of = ? LIMIT 1').get(jurnalId) as Jurnal | undefined) ?? null;
}

function jurnalSeimbang(detail: { jurnal: Jurnal; baris: JurnalBaris[] } | null): boolean {
  if (!detail || detail.baris.length < 2) return false;
  const totalDebit = detail.baris.reduce((s, b) => s + angka(b.debit), 0);
  const totalKredit = detail.baris.reduce((s, b) => s + angka(b.kredit), 0);
  return totalDebit > 0 && totalDebit === totalKredit;
}

/**
 * Rincian pembayaran dari baris jurnal (NETO, sama dengan rumus mutasi):
 * - pokok = debit - kredit 2050;
 * - bunga = debit - kredit akun bunga pinjaman;
 * - denda = debit - kredit BEBAN lain (mis. 5050);
 * - kas keluar = kredit - debit akun kas/bank.
 * Tidak membaca nominal dari `pinjaman_bayar`.
 *
 * T-B05: neto adalah jaring pengaman agar outstanding header tetap sama
 * dengan mutasi/rekonsiliasi bila ada data lama yang memuat dua sisi 2050.
 * Jurnal baru dengan 2050 debit dan kredit sekaligus ditolak di
 * `validasiJurnalPembayaran`.
 */
export function rincianPembayaranDariJurnal(
  db: Database.Database,
  jurnalId: string,
  akunBunga: string,
): RincianPembayaranPinjaman {
  const detail = getJurnalDetail(db, jurnalId);
  if (!detail)
    return { pokok: 0, bunga: 0, denda: 0, kas_keluar: 0 };

  const akun = new Map(listAkun(db).map((a) => [a.kode, a]));
  const hasil: RincianPembayaranPinjaman = {
    pokok: 0,
    bunga: 0,
    denda: 0,
    kas_keluar: 0,
  };
  for (const b of detail.baris) {
    const kode = String(b.akun_kode);
    const debit = angka(b.debit);
    const kredit = angka(b.kredit);
    if (kode === AKUN_HUTANG) hasil.pokok += debit - kredit;
    if (kode === akunBunga) hasil.bunga += debit - kredit;
    else if (akun.get(kode)?.tipe === 'BEBAN') hasil.denda += debit - kredit;
    if (akun.get(kode)?.is_kas) hasil.kas_keluar += kredit - debit;
  }
  return hasil;
}

function validasiJurnalPembayaran(
  db: Database.Database,
  jurnalId: string,
  akunBunga: string,
): { error: string | null; rincian: RincianPembayaranPinjaman } {
  const detail = getJurnalDetail(db, jurnalId);
  if (!detail)
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak ditemukan.`,
      rincian: { pokok: 0, bunga: 0, denda: 0, kas_keluar: 0 },
    };
  if (!jurnalSeimbang(detail))
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak seimbang (total debit harus sama dengan kredit).`,
      rincian: { pokok: 0, bunga: 0, denda: 0, kas_keluar: 0 },
    };

  // T-B05: baris 2050 wajib satu sisi saja (debit pokok), konsisten dengan
  // builder pembayaran. Jurnal yang menaruh debit DAN kredit 2050 sekaligus
  // membuat rincian pembayaran tidak bisa dibaca konsisten; tolak di pintu.
  let debit2050 = 0;
  let kredit2050 = 0;
  for (const b of detail.baris) {
    if (String(b.akun_kode) !== AKUN_HUTANG) continue;
    debit2050 += angka(b.debit);
    kredit2050 += angka(b.kredit);
  }
  if (debit2050 > 0 && kredit2050 > 0)
    return {
      error:
        `Jurnal pembayaran ${jurnalId} memuat debit dan kredit ${AKUN_HUTANG} sekaligus. ` +
        `Baris ${AKUN_HUTANG} pada jurnal pembayaran pinjaman hanya boleh satu sisi ` +
        `(debit untuk pokok). Perbaiki jurnalnya agar hanya memuat debit ${AKUN_HUTANG}, ` +
        `lalu tautkan kembali sebagai pembayaran.`,
      rincian: { pokok: 0, bunga: 0, denda: 0, kas_keluar: 0 },
    };

  const rincian = rincianPembayaranDariJurnal(db, jurnalId, akunBunga);
  if (detail.jurnal.reversal_of || jurnalPembatalan(db, jurnalId))
    return { error: 'Jurnal balik atau jurnal yang sudah dibatalkan tidak dapat ditautkan sebagai pembayaran.', rincian };
  if (rincian.pokok <= 0)
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak memuat debit 2050 untuk pokok pinjaman.`,
      rincian,
    };
  if (rincian.kas_keluar <= 0)
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak memuat kredit kas/bank.`,
      rincian,
    };
  return { error: null, rincian };
}

/** Satu akun BEBAN lain (bukan akun bunga pinjaman) beserta debit neto-nya. */
type BebanLain = { kode: string; nama: string; neto: number };

/**
 * T-B06: kumpulkan akun BEBAN selain akun bunga pinjaman dan 5050 (denda dari
 * modul sendiri) dari baris jurnal, beserta debit neto per akun. Klasifikasi
 * denda TIDAK diubah — daftar ini hanya bahan peringatan konfirmasi operator.
 */
function daftarBebanLain(
  db: Database.Database,
  baris: readonly { akun_kode: unknown; debit: unknown; kredit: unknown }[],
  akunBunga: string,
): BebanLain[] {
  const netoPerAkun = new Map<string, number>();
  for (const b of baris) {
    const kode = String(b.akun_kode);
    if (kode === akunBunga || kode === AKUN_DENDA_PINJAMAN_DEFAULT) continue;
    if (getAkun(db, kode)?.tipe !== 'BEBAN') continue;
    const neto = angka(b.debit) - angka(b.kredit);
    if (neto > 0) netoPerAkun.set(kode, (netoPerAkun.get(kode) ?? 0) + neto);
  }
  return [...netoPerAkun.entries()].map(([kode, neto]) => ({
    kode,
    nama: getAkun(db, kode)?.nama ?? kode,
    neto,
  }));
}

/** Peringatan konfirmasi untuk debit BEBAN non-bunga (T-B06), gaya repo. */
function pesanBebanLain(daftar: BebanLain[]): string {
  const rincianAkun = daftar
    .map((d) => `${d.nama} (${d.kode}) ${formatRp(d.neto)}`)
    .join(', ');
  return (
    `Ada debit beban ${rincianAkun} yang bukan akun bunga pinjaman ini; ` +
    'akan dihitung sebagai denda dan status angsuran mungkin tidak terpenuhi. ' +
    'Periksa jurnalnya (bunga seharusnya memakai akun bunga pinjaman), ' +
    'lalu konfirmasi bila pembayaran memang sengaja diberikan.'
  );
}

function barisPembayaran(db: Database.Database, r: Row, akunBunga: string): PinjamanBayar {
  const jurnalId = String(r.jurnal_id);
  const rincian = rincianPembayaranDariJurnal(db, jurnalId, akunBunga);
  const batal = jurnalPembatalan(db, jurnalId);
  return {
    id: String(r.id),
    pinjaman_id: String(r.pinjaman_id),
    angsuran_id:
      r.angsuran_id === null || r.angsuran_id === undefined
        ? null
        : angka(r.angsuran_id),
    jurnal_id: jurnalId,
    tanggal: String(r.tanggal),
    catatan: String(r.catatan ?? ''),
    created_at: String(r.created_at ?? ''),
    pokok: rincian.pokok,
    bunga: rincian.bunga,
    denda: rincian.denda,
    kas_keluar: rincian.kas_keluar,
    dibatalkan: batal !== null,
    jurnal_batal_id: batal?.id ?? null,
  };
}

function daftarPembayaran(db: Database.Database, pinjamanId: string): PinjamanBayar[] {
  const rows = db
    .prepare(
      `SELECT pb.*, p.akun_bunga
         FROM pinjaman_bayar pb
         JOIN pinjaman p ON p.id = pb.pinjaman_id
        WHERE pb.pinjaman_id = ?
        ORDER BY pb.tanggal, pb.id`,
    )
    .all(pinjamanId) as Row[];
  return rows.map((r) => barisPembayaran(db, r, String(r.akun_bunga)));
}

function lengkapiPinjaman(db: Database.Database, row: Row): Pinjaman {
  const pinjaman = rowToPinjaman(row);
  const pembayaran = daftarPembayaran(db, pinjaman.id);
  const angsuran = daftarAngsuran(db, pinjaman.id, pembayaran);
  const aktif = pembayaran.filter((p) => !p.dibatalkan);
  const totalPokok = aktif.reduce((s, p) => s + p.pokok, 0);
  const totalBunga = aktif.reduce((s, p) => s + p.bunga, 0);
  const totalDenda = aktif.reduce((s, p) => s + p.denda, 0);
  const batal = pinjaman.jurnal_pencairan_id
    ? jurnalPembatalan(db, pinjaman.jurnal_pencairan_id)
    : null;
  const saldoAwal = batal ? 0 : pinjaman.sisa_pokok_awal;
  return {
    ...pinjaman,
    status: batal ? 'DIBATALKAN' : 'AKTIF',
    jurnal_batal_id: batal?.id ?? null,
    outstanding: saldoAwal - totalPokok,
    total_pokok_dibayar: totalPokok,
    total_bunga_dibayar: totalBunga,
    total_denda_dibayar: totalDenda,
    angsuran,
  };
}

/**
 * Buat pinjaman + jadwal angsuran secara atomik. Jurnal pencairan TIDAK dibuat:
 * - pencairan baru: pemanggil sudah membuat/memposting jurnal dan mengirim ID-nya;
 * - sudah berjalan: `jurnal_pencairan_id` null, sisa pokok ada di Saldo Awal 2050.
 *
 * Validasi utama: akun kas aktif ber-`is_kas`, akun bunga aktif BEBAN, nominal
 * integer, tanggal valid, `ke` naik, tanggal jadwal tidak mundur, dan
 * SUM(pokok jadwal) = sisa_pokok_awal.
 */
export function buatPinjaman(
  db: Database.Database,
  input: BuatPinjamanInput,
): HasilPinjaman {
  const data = (input ?? {}) as BuatPinjamanInput;
  const errors: string[] = [];

  const id = teks(data.id) || uid('pjr');
  const kreditur = teks(data.kreditur);
  if (!kreditur) errors.push('Nama kreditur pinjaman wajib diisi.');
  else if (kreditur.length > 200)
    errors.push('Nama kreditur pinjaman maks. 200 karakter.');

  const akunKasKode = teks(data.akun_kas ?? data.akunKas);
  const akunKas = akunKasKode ? getAkun(db, akunKasKode) : null;
  if (
    !akunKas ||
    !akunKas.aktif ||
    akunKas.tipe !== 'AKTIVA' ||
    !akunKas.is_kas ||
    !akunBolehDiposting(akunKasKode, akunKas.aktif, { dikenal: true })
  )
    errors.push(
      'Akun kas pinjaman wajib akun AKTIVA kas/bank yang aktif (is_kas = 1).',
    );

  const akunBungaKode =
    teks(data.akun_bunga ?? data.akunBunga) || AKUN_BUNGA_PINJAMAN_DEFAULT;
  const akunBunga = getAkun(db, akunBungaKode);
  if (
    !akunBunga ||
    !akunBunga.aktif ||
    akunBunga.tipe !== 'BEBAN' ||
    !akunBolehDiposting(akunBungaKode, akunBunga.aktif, { dikenal: true })
  )
    errors.push(
      `Akun bunga pinjaman wajib akun BEBAN yang aktif (default ${AKUN_BUNGA_PINJAMAN_DEFAULT}).`,
    );

  const pokokAwal = data.pokok_awal ?? data.pokokAwal;
  if (!isInt(pokokAwal) || pokokAwal <= 0)
    errors.push('Pokok awal pinjaman harus bilangan bulat lebih dari 0 (satuan sen).');

  const sisaMentah = data.sisa_pokok_awal ?? data.sisaPokokAwal;
  const sisaPokokAwal = sisaMentah === undefined ? pokokAwal : sisaMentah;
  if (!isInt(sisaPokokAwal) || sisaPokokAwal < 0)
    errors.push('Sisa pokok awal harus bilangan bulat ≥ 0 (satuan sen).');
  else if (isInt(pokokAwal) && sisaPokokAwal > pokokAwal)
    errors.push('Sisa pokok awal tidak boleh melebihi pokok awal.');

  const tanggalMulai = teks(data.tanggal_mulai ?? data.tanggalMulai);
  const tanggalMulaiValid = tanggalKalenderValid(tanggalMulai);
  if (!tanggalMulaiValid)
    errors.push('Tanggal mulai pinjaman tidak valid (YYYY-MM-DD).');

  const tenorMentah = data.tenor_bulan ?? data.tenorBulan;
  let tenorBulan: number | null = null;
  if (tenorMentah !== undefined && tenorMentah !== null) {
    if (!isInt(tenorMentah) || tenorMentah <= 0)
      errors.push('Tenor pinjaman harus bilangan bulat lebih dari 0 bulan.');
    else tenorBulan = tenorMentah;
  }

  const jurnalPencairanId = nullableTeks(
    data.jurnal_pencairan_id ?? data.jurnalPencairanId,
  );
  if (jurnalPencairanId) {
    const detail = getJurnalDetail(db, jurnalPencairanId);
    if (!detail)
      errors.push(`Jurnal pencairan ${jurnalPencairanId} tidak ditemukan.`);
    else if (!jurnalSeimbang(detail))
      errors.push(
        `Jurnal pencairan ${jurnalPencairanId} tidak seimbang (total debit harus sama dengan kredit).`,
      );
    else if (
      db
        .prepare('SELECT id FROM pinjaman WHERE jurnal_pencairan_id = ? LIMIT 1')
        .get(jurnalPencairanId)
    )
      errors.push(
        `Jurnal pencairan ${jurnalPencairanId} sudah ditautkan ke pinjaman lain.`,
      );
  }

  const jadwalMentah = data.angsuran ?? data.jadwal;
  const jadwal: {
    ke: number;
    jatuh_tempo: string;
    pokok: number;
    bunga: number;
    catatan: string;
  }[] = [];
  if (!Array.isArray(jadwalMentah) || jadwalMentah.length === 0) {
    errors.push('Jadwal angsuran wajib berisi minimal satu baris.');
  } else {
    let keSebelumnya = 0;
    let tanggalSebelumnya = '';
    for (let i = 0; i < jadwalMentah.length; i += 1) {
      const it = (jadwalMentah[i] ?? {}) as PinjamanAngsuranInput;
      const label = `Jadwal angsuran baris ${i + 1}`;
      const ke = it.ke;
      if (!isInt(ke) || ke <= 0) {
        errors.push(`${label}: nomor ke harus bilangan bulat lebih dari 0.`);
      } else if (ke <= keSebelumnya) {
        errors.push(
          `${label}: nomor ke harus naik dan tidak boleh ganda (${ke} setelah ${keSebelumnya}).`,
        );
      } else {
        keSebelumnya = ke;
      }

      const jatuhTempo = teks(it.jatuh_tempo ?? it.jatuhTempo);
      if (!tanggalKalenderValid(jatuhTempo)) {
        errors.push(`${label}: tanggal jatuh tempo tidak valid (YYYY-MM-DD).`);
      } else {
        if (tanggalMulaiValid && jatuhTempo < tanggalMulai) {
          errors.push(
            `${label}: tanggal jatuh tempo ${jatuhTempo} tidak boleh sebelum tanggal mulai pinjaman ${tanggalMulai}.`,
          );
        }
        if (tanggalSebelumnya && jatuhTempo < tanggalSebelumnya) {
          errors.push(
            `${label}: tanggal jatuh tempo tidak boleh mundur dari baris sebelumnya (${tanggalSebelumnya}).`,
          );
        } else {
          tanggalSebelumnya = jatuhTempo;
        }
      }

      if (!isInt(it.pokok) || it.pokok < 0)
        errors.push(`${label}: pokok harus bilangan bulat ≥ 0 (satuan sen).`);
      if (!isInt(it.bunga) || it.bunga < 0)
        errors.push(`${label}: bunga harus bilangan bulat ≥ 0 (satuan sen).`);
      if (isInt(it.pokok) && isInt(it.bunga) && it.pokok === 0 && it.bunga === 0)
        errors.push(
          `${label}: pokok dan bunga tidak boleh sama-sama 0; baris tanpa kewajiban bukan angsuran. Bila baris ini hasil jadwal otomatis: minimal pokok per bulan Rp 1 (sen 100); kecilkan tenor atau besarkan pokok.`,
        );

      jadwal.push({
        ke: Number(ke),
        jatuh_tempo: jatuhTempo,
        pokok: Number(it.pokok),
        bunga: Number(it.bunga),
        catatan: teks(it.catatan),
      });
    }

    if (
      isInt(sisaPokokAwal) &&
      jadwal.every((r) => isInt(r.pokok)) &&
      jadwal.reduce((s, r) => s + r.pokok, 0) !== sisaPokokAwal
    ) {
      const total = jadwal.reduce((s, r) => s + r.pokok, 0);
      errors.push(
        `Total pokok jadwal (${total}) harus sama dengan sisa pokok awal (${sisaPokokAwal}).`,
      );
    }
  }

  if (errors.length > 0) return gagal(errors);

  const pinjaman: Pinjaman = {
    id,
    kreditur,
    akun_kas: akunKasKode,
    akun_bunga: akunBungaKode,
    pokok_awal: pokokAwal as number,
    sisa_pokok_awal: sisaPokokAwal as number,
    tanggal_mulai: tanggalMulai,
    tenor_bulan: tenorBulan,
    jurnal_pencairan_id: jurnalPencairanId,
    catatan: teks(data.catatan),
    created_at: teks(data.created_at) || new Date().toISOString(),
  };

  try {
    const simpan = db.transaction(() => {
      const sudah = db
        .prepare('SELECT id FROM pinjaman WHERE id = ?')
        .get(id) as { id: string } | undefined;
      if (sudah) throw new Error(`Pinjaman ${id} sudah ada. Gunakan ID lain.`);

      db.prepare(
        `INSERT INTO pinjaman
           (id, kreditur, akun_kas, akun_bunga, pokok_awal, sisa_pokok_awal,
            tanggal_mulai, tenor_bulan, jurnal_pencairan_id, catatan, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pinjaman.id,
        pinjaman.kreditur,
        pinjaman.akun_kas,
        pinjaman.akun_bunga,
        pinjaman.pokok_awal,
        pinjaman.sisa_pokok_awal,
        pinjaman.tanggal_mulai,
        pinjaman.tenor_bulan,
        pinjaman.jurnal_pencairan_id,
        pinjaman.catatan,
        pinjaman.created_at,
      );

      const ins = db.prepare(
        `INSERT INTO pinjaman_angsuran
           (pinjaman_id, ke, jatuh_tempo, pokok, bunga, catatan)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of jadwal)
        ins.run(
          pinjaman.id,
          r.ke,
          r.jatuh_tempo,
          r.pokok,
          r.bunga,
          r.catatan,
        );
    });
    simpan();
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed: pinjaman\.jurnal_pencairan_id/i.test(pesan))
      return gagal(
        `Jurnal pencairan ${jurnalPencairanId ?? ''} sudah ditautkan ke pinjaman lain.`,
      );
    return gagal(`Pinjaman gagal disimpan: ${pesan}`);
  }

  return {
    ...kosong,
    boleh: true,
    tersimpan: true,
    pinjaman: getPinjaman(db, id) ?? pinjaman,
  };
}

class GagalPinjamanLpd extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(' '));
    this.errors = errors;
  }
}

/** Kas aktif pertama dari master DB; dipakai mode berjalan yang tidak mengisi kas. */
export function akunKasAktifPertama(db: Database.Database): string | null {
  const row = db
    .prepare(
      `SELECT kode FROM akun
        WHERE aktif = 1 AND is_kas = 1 AND tipe = 'AKTIVA'
        ORDER BY kode LIMIT 1`,
    )
    .get() as { kode: string } | undefined;
  return row ? String(row.kode) : null;
}

/**
 * Wizard DB-16c: simpan pinjaman dari dua mode.
 *
 * - `PENCAIRAN`: dalam SATU transaksi, posting jurnal **D kas / K 2050**
 *   (jenis HUTANG, keterangan memuat kreditur), lalu simpan pinjaman + jadwal
 *   dengan `jurnal_pencairan_id` terisi. Bila jadwal/pinjaman gagal, seluruh
 *   transaksi dibatalkan sehingga jurnal tidak tertinggal.
 * - `BERJALAN`: tidak membuat jurnal; `jurnal_pencairan_id = null` dan
 *   `pokok_awal = sisa_pokok_awal = sisa pokok`. Sisa pokok harus sudah ada
 *   di Saldo Awal 2050 (UI menampilkan peringatan).
 *
 * `buatPinjaman` tetap menjadi validator bisnis terakhir untuk akun, nominal,
 * tanggal, dan total jadwal. Audit `PINJAMAN-CREATE` selalu ditulis; mode
 * pencairan menambah `PINJAMAN-PENCAIRAN`.
 */
export function simpanPinjamanLpd(
  db: Database.Database,
  input: SimpanPinjamanLpdInput,
  opsi: OpsiSimpanPinjamanLpd = {},
): HasilSimpanPinjamanLpd {
  const data = (input ?? {}) as SimpanPinjamanLpdInput;
  const modeMentah = teks(data.mode).toUpperCase();
  if (modeMentah !== 'PENCAIRAN' && modeMentah !== 'BERJALAN')
    return {
      ...gagal('Mode pinjaman harus PENCAIRAN (pencairan baru) atau BERJALAN (sudah berjalan).'),
    };
  const mode: ModePinjamanLpd = modeMentah;

  const kreditur = teks(data.kreditur);
  const tanggal = teks(data.tanggal ?? data.tanggal_mulai ?? data.tanggalMulai);
  const akunBunga = teks(data.akun_bunga ?? data.akunBunga) || AKUN_BUNGA_PINJAMAN_DEFAULT;
  const pokokMentah = data.pokok ?? data.pokok_awal ?? data.pokokAwal;
  const sisaMentah =
    data.sisa_pokok ??
    data.sisa_pokok_awal ??
    data.sisaPokok ??
    data.sisaPokokAwal;
  const nominalAwal = mode === 'PENCAIRAN' ? pokokMentah : sisaMentah;
  const nominal = isInt(nominalAwal) ? nominalAwal : 0;

  let akunKas = teks(data.akun_kas ?? data.akunKas);
  if (!akunKas && mode === 'BERJALAN') {
    const bawaan = akunKasAktifPertama(db);
    if (bawaan) akunKas = bawaan;
  }

  const jadwal = data.angsuran ?? data.jadwal;

  try {
    const simpan = db.transaction((): HasilSimpanPinjamanLpd => {
      let jurnal: Jurnal | null = null;
      let jurnalId: string | null = null;

      if (mode === 'PENCAIRAN') {
        // AKT-06/kunci longgar: alasan yang sama dengan konfirmasi peringatan
        // juga memenuhi syarat koreksi periode terkunci untuk jurnal pencairan.
        const alasanJurnal = teks(data.alasan) || teks(opsi.alasanPeringatan);
        let inputJurnal: JurnalInput;
        try {
          inputJurnal = buatJurnalPinjamanPencairan({
            tanggal,
            nominal,
            keterangan: teks(data.catatan),
            kreditur,
            akunKas,
            ...(teks(data.noBukti) ? { noBukti: teks(data.noBukti) } : {}),
            ...(alasanJurnal ? { alasan: alasanJurnal } : {}),
            daftarAkun: listAkun(db),
          });
        } catch (e) {
          return {
            ...gagal(e instanceof Error ? e.message : String(e)),
            mode,
            jurnal: null,
          };
        }

        const posting = postingJurnal(db, inputJurnal, {
          konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
          alasanPeringatan: opsi.alasanPeringatan,
          wajibAlasanPeringatan: true,
          wajibSaldoAwal: opsi.wajibSaldoAwal === true,
          konfirmasiTanpaSaldoAwal: opsi.konfirmasiTanpaSaldoAwal === true,
          sekarang: opsi.sekarang,
        });
        if (!posting.tersimpan || !posting.jurnal) {
          return {
            ...kosong,
            errors: posting.errors,
            peringatan: posting.peringatan,
            perluKonfirmasi: posting.perluKonfirmasi,
            mode,
            jurnal: null,
          };
        }
        jurnal = posting.jurnal;
        jurnalId = jurnal.id;
      }

      const totalBerjalan =
        mode === 'BERJALAN' ? totalSisaPokokBerjalan(db) + nominal : 0;

      const hasil = buatPinjaman(db, {
        ...(teks(data.id) ? { id: teks(data.id) } : {}),
        kreditur,
        akun_kas: akunKas,
        akun_bunga: akunBunga,
        pokok_awal: nominal,
        sisa_pokok_awal: nominal,
        tanggal_mulai: tanggal,
        tenor_bulan:
          data.tenor ?? data.tenor_bulan ?? data.tenorBulan ?? null,
        jurnal_pencairan_id: jurnalId,
        catatan: teks(data.catatan),
        angsuran: jadwal ?? [],
      });
      // Jangan `return` gagal di sini: transaksi luar harus di-rollback agar
      // jurnal pencairan yang sudah diposting tidak tertinggal.
      if (!hasil.tersimpan || !hasil.pinjaman)
        throw new GagalPinjamanLpd(
          hasil.errors.length > 0 ? hasil.errors : ['Pinjaman gagal disimpan.'],
        );

      // AUD2-05: pinjaman berjalan tidak membuat jurnal pencairan. Sisa
      // pokoknya wajib sudah tercatat sebagai kredit neto 2050 pada grup
      // SALDO_AWAL; jika tidak, Neraca 2050 akan minus tanpa terlihat di
      // rekonsiliasi. Pemeriksaan dilakukan setelah validasi bentuk pinjaman
      // agar error akun/jadwal tetap tampil lebih dulu; lemparan ini
      // membatalkan seluruh transaksi.
      if (mode === 'BERJALAN') {
        const saldoAwal = saldoAwal2050(db);
        if (totalBerjalan > saldoAwal)
          throw new GagalPinjamanLpd([
            `Sisa pokok pinjaman berjalan (${formatRp(totalBerjalan)}) ` +
              `melebihi Saldo Awal akun 2050 HUTANG LAIN-LAIN ` +
              `(${formatRp(saldoAwal)}). Isi atau koreksi Saldo Awal 2050 ` +
              'terlebih dahulu.',
          ]);
      }

      const pinjaman = hasil.pinjaman;
      catatAudit(db, {
        aksi: `PINJAMAN-CREATE ${pinjaman.id}`,
        alasan: `Buat pinjaman LPD ${pinjaman.kreditur}`,
        baru: { pinjaman, jurnal },
        ref_type: 'pinjaman',
        ref_id: pinjaman.id,
      });
      if (mode === 'PENCAIRAN' && jurnal) {
        catatAudit(db, {
          aksi: `PINJAMAN-PENCAIRAN ${pinjaman.id}`,
          alasan: `Pencairan pinjaman LPD ${pinjaman.kreditur}`,
          baru: { pinjaman_id: pinjaman.id, jurnal },
          ref_type: 'pinjaman',
          ref_id: pinjaman.id,
        });
      }

      return {
        ...kosong,
        boleh: true,
        tersimpan: true,
        mode,
        pinjaman: getPinjaman(db, pinjaman.id) ?? pinjaman,
        jurnal,
      };
    });
    return simpan();
  } catch (e) {
    if (e instanceof GagalPinjamanLpd)
      return { ...gagal(e.errors), mode };
    return {
      ...gagal(`Pinjaman gagal disimpan: ${e instanceof Error ? e.message : String(e)}`),
      mode,
    };
  }
}

/** Daftar pinjaman + jadwal + outstanding turunan (bukan kolom tersimpan). */
export function listPinjaman(db: Database.Database): Pinjaman[] {
  const rows = db
    .prepare('SELECT * FROM pinjaman ORDER BY tanggal_mulai, id')
    .all() as Row[];
  return rows.map((r) => lengkapiPinjaman(db, r));
}

export function getPinjaman(db: Database.Database, id: string): Pinjaman | null {
  const row = db
    .prepare('SELECT * FROM pinjaman WHERE id = ?')
    .get(teks(id)) as Row | undefined;
  return row ? lengkapiPinjaman(db, row) : null;
}

/** Outstanding turunan; null bila pinjaman tidak ada. */
export function hitungOutstandingPinjaman(
  db: Database.Database,
  id: string,
): number | null {
  return getPinjaman(db, id)?.outstanding ?? null;
}

/** Daftar pembayaran tertaut + nominal turunan dari jurnal. */
export function listPinjamanBayar(
  db: Database.Database,
  pinjamanId: string,
): PinjamanBayar[] {
  return daftarPembayaran(db, teks(pinjamanId));
}

/**
 * DB-16e: filter kartu hutang. `periode` = `YYYY-MM`, atau `mulai`/`sampai`
 * (YYYY-MM-DD). Tanpa filter dipakai tahun berjalan dari `sekarang`.
 */
export type FilterMutasiPinjaman = FilterPeriodeMutasiPinjaman & {
  /** Tanggal acuan default tahun berjalan; dipakai test agar deterministik. */
  sekarang?: string;
};

type RowMutasiBayar = {
  id: string;
  jurnal_id: string;
  angsuran_id: number | null;
  tanggal_bayar: string;
  catatan: string;
  jurnal_tanggal: string;
  no_bukti: string;
  keterangan: string;
};

type RowMutasiBaris = {
  jurnal_id: string;
  akun_kode: string;
  debit: number;
  kredit: number;
};

/**
 * Adapter DB untuk kartu hutang / mutasi bulanan pinjaman LPD (DB-16e).
 *
 * Hanya mengambil link `pinjaman_bayar` + baris jurnal yang ditautkan. Tidak
 * ada nominal atau saldo bulanan yang dibaca/ditulis ke tabel pembayaran;
 * seluruh perhitungan diserahkan ke `core/pinjamanMutasi.ts`.
 */
export function laporanMutasiPinjaman(
  db: Database.Database,
  pinjamanId: string,
  filter: FilterMutasiPinjaman = {},
): MutasiPinjamanHasil {
  const pinjaman = getPinjaman(db, teks(pinjamanId));
  if (!pinjaman) throw new Error(`Pinjaman ${teks(pinjamanId)} tidak ditemukan.`);

  const periode = periodeMutasiPinjaman(
    {
      ...(filter.periode ? { periode: filter.periode } : {}),
      ...(filter.mulai ? { mulai: filter.mulai } : {}),
      ...(filter.sampai ? { sampai: filter.sampai } : {}),
    },
    filter.sekarang ?? tanggalLokal(),
  );

  const pembayaranRows = db
    .prepare(
      `SELECT pb.id, pb.jurnal_id, pb.angsuran_id,
              pb.tanggal AS tanggal_bayar, pb.catatan,
              j.tanggal AS jurnal_tanggal, j.no_bukti, j.keterangan
         FROM pinjaman_bayar pb
         JOIN jurnal j ON j.id = pb.jurnal_id
        WHERE pb.pinjaman_id = ?
        ORDER BY j.tanggal, j.rowid, pb.id`,
    )
    .all(pinjaman.id) as RowMutasiBayar[];

  const barisRows = db
    .prepare(
      `SELECT b.jurnal_id, b.akun_kode, b.debit, b.kredit
         FROM pinjaman_bayar pb
         JOIN jurnal_baris b ON b.jurnal_id = pb.jurnal_id
        WHERE pb.pinjaman_id = ?
        ORDER BY b.jurnal_id, b.id`,
    )
    .all(pinjaman.id) as RowMutasiBaris[];

  const pembayaran: PembayaranMutasiPinjaman[] = pembayaranRows.map((r) => ({
    id: String(r.id),
    jurnal_id: String(r.jurnal_id),
    tanggal: String(r.jurnal_tanggal),
    tanggal_bayar: String(r.tanggal_bayar),
    angsuran_id:
      r.angsuran_id === null || r.angsuran_id === undefined
        ? null
        : angka(r.angsuran_id),
    catatan: String(r.catatan ?? ''),
    no_bukti: String(r.no_bukti ?? ''),
    keterangan: String(r.keterangan ?? ''),
  }));

  const baris: BarisMutasiJurnal[] = barisRows.map((r) => ({
    jurnal_id: String(r.jurnal_id),
    akun_kode: String(r.akun_kode),
    debit: angka(r.debit),
    kredit: angka(r.kredit),
  }));

  // Pembatalan juga kejadian jurnal: tampilkan lawannya agar mutasi dan GL
  // cocok pada setiap periode, bukan menghapus kuitansi asli dari histori.
  for (const r of pembayaranRows) {
    const batal = jurnalPembatalan(db, r.jurnal_id);
    if (!batal) continue;
    pembayaran.push({
      id: `${r.id}:batal`, jurnal_id: batal.id, tanggal: batal.tanggal,
      tanggal_bayar: batal.tanggal, angsuran_id: r.angsuran_id,
      catatan: 'Pembatalan catatan pembayaran', no_bukti: batal.no_bukti,
      keterangan: batal.keterangan,
    });
    for (const b of getJurnalDetail(db, batal.id)?.baris ?? [])
      baris.push({ jurnal_id: batal.id, akun_kode: b.akun_kode, debit: b.debit, kredit: b.kredit });
  }

  return hitungMutasiPinjaman({
    pinjaman: {
      id: pinjaman.id,
      kreditur: pinjaman.kreditur,
      akun_bunga: pinjaman.akun_bunga,
      sisa_pokok_awal: pinjaman.status === 'DIBATALKAN' ? 0 : pinjaman.sisa_pokok_awal,
      tanggal_mulai: pinjaman.tanggal_mulai,
    },
    jadwal: (pinjaman.angsuran ?? []).map((a) => ({
      id: a.id,
      ke: a.ke,
      jatuh_tempo: a.jatuh_tempo,
      pokok: a.pokok,
      bunga: a.bunga,
      catatan: a.catatan,
    })),
    pembayaran,
    baris,
    akun: listAkun(db),
    periode,
  });
}

/** Alias pendek untuk pemanggil baru. */
export const mutasiPinjaman = laporanMutasiPinjaman;
export const getMutasiPinjaman = laporanMutasiPinjaman;

export function getPembayaranPinjaman(
  db: Database.Database,
  id: string,
): PinjamanBayar | null {
  const row = db
    .prepare(
      `SELECT pb.*, p.akun_bunga
         FROM pinjaman_bayar pb
         JOIN pinjaman p ON p.id = pb.pinjaman_id
        WHERE pb.id = ?`,
    )
    .get(teks(id)) as Row | undefined;
  return row ? barisPembayaran(db, row, String(row.akun_bunga)) : null;
}

/**
 * Status angsuran diturunkan dari akumulasi nominal aktif, bukan kolom tersimpan.
 * Pinjaman yang tidak ada mengembalikan daftar kosong.
 */
export function statusAngsuranPinjaman(
  db: Database.Database,
  pinjamanId: string,
): PinjamanAngsuran[] {
  return getPinjaman(db, pinjamanId)?.angsuran ?? [];
}

/**
 * Tautkan pembayaran ke pinjaman/angsuran. Hanya menyimpan link jurnal —
 * nominal pokok/bunga/denda dibaca dari jurnal saat laporan dibuka.
 *
 * Jurnal wajib sudah ada, seimbang, memuat debit 2050 (pokok) dan kredit kas.
 * Baris 2050 hanya boleh satu sisi (debit pokok); jurnal dua sisi ditolak
 * (T-B05). Satu jurnal hanya boleh ditautkan sekali; satu angsuran boleh dicicil.
 */
export function tautkanPembayaran(
  db: Database.Database,
  input: TautkanPembayaranInput,
  opsi: OpsiTautkanPembayaran = {},
): HasilPembayaranPinjaman {
  const data = (input ?? {}) as TautkanPembayaranInput;
  const pinjamanId = teks(data.pinjaman_id ?? data.pinjamanId);
  if (!pinjamanId) return gagalBayar('Pinjaman yang dibayar belum dipilih.');

  const pinjaman = getPinjaman(db, pinjamanId);
  if (!pinjaman) return gagalBayar(`Pinjaman ${pinjamanId} tidak ditemukan.`);

  const jurnalId = teks(data.jurnal_id ?? data.jurnalId);
  if (!jurnalId)
    return gagalBayar('Jurnal pembayaran belum dipilih/dibuat.');

  const cekJurnal = validasiJurnalPembayaran(db, jurnalId, pinjaman.akun_bunga);
  if (cekJurnal.error) return gagalBayar(cekJurnal.error);

  const angsuranMentah = data.angsuran_id ?? data.angsuranId;
  let angsuranId: number | null = null;
  if (angsuranMentah !== undefined && angsuranMentah !== null && teks(angsuranMentah) !== '') {
    const n = Number(angsuranMentah);
    if (!Number.isSafeInteger(n) || n <= 0)
      return gagalBayar('ID angsuran tidak valid.');
    const baris = db
      .prepare(
        'SELECT id FROM pinjaman_angsuran WHERE id = ? AND pinjaman_id = ?',
      )
      .get(n, pinjamanId) as { id: number } | undefined;
    if (!baris)
      return gagalBayar(
        `Angsuran ${n} tidak ditemukan pada pinjaman ${pinjamanId}.`,
      );
    angsuranId = n;
  }

  const jurnalTerpakai = db
    .prepare('SELECT id FROM pinjaman_bayar WHERE jurnal_id = ? LIMIT 1')
    .get(jurnalId) as { id: string } | undefined;
  if (jurnalTerpakai)
    return gagalBayar(
      `Jurnal ${jurnalId} sudah ditautkan ke pembayaran ${jurnalTerpakai.id}.`,
    );

  const detail = getJurnalDetail(db, jurnalId);
  // T-B06: debit BEBAN selain akun bunga pinjaman (dan bukan 5050 denda modul)
  // dihitung sebagai denda sehingga sisa bunga bisa tidak pernah nol dan
  // status angsuran tidak terpenuhi. Peringatan + konfirmasi operator wajib
  // sebelum ada tulisan; klasifikasi denda sendiri tidak diubah agar angka
  // laporan tetap.
  const bebanLain = daftarBebanLain(db, detail?.baris ?? [], pinjaman.akun_bunga);
  const konfirmasiDendaLain = opsi.konfirmasiDendaLain === true;
  const alasanDendaLain = teks(opsi.alasanDendaLain);
  if (bebanLain.length > 0) {
    if (!konfirmasiDendaLain)
      return { ...gagalBayar(pesanBebanLain(bebanLain)), perluKonfirmasi: true };
    if (alasanDendaLain.length < 5)
      return {
        ...gagalBayar(
          'Konfirmasi debit beban non-bunga wajib disertai alasan minimal 5 karakter.',
        ),
        perluKonfirmasi: true,
      };
  }
  // Tanggal pembayaran selalu mengikuti jurnal yang ditautkan. Pemanggil yang
  // mengirim tanggal berbeda ditolak agar laporan pinjaman tidak menyimpang
  // diam-diam dari jurnalnya.
  const tanggalJurnal = teks(detail?.jurnal.tanggal);
  const tanggalInput = teks(data.tanggal);
  if (tanggalInput && tanggalInput !== tanggalJurnal)
    return gagalBayar(
      `Tanggal pembayaran ${tanggalInput} berbeda dari tanggal jurnal ` +
        `${jurnalId} (${tanggalJurnal}). Gunakan tanggal jurnal atau perbaiki jurnalnya.`,
    );
  const tanggal = tanggalJurnal;
  if (!tanggalKalenderValid(tanggal))
    return gagalBayar('Tanggal pembayaran tidak valid (YYYY-MM-DD).');
  if (tanggal < pinjaman.tanggal_mulai)
    return gagalBayar(
      `Tanggal pembayaran ${tanggal} tidak boleh sebelum tanggal mulai ` +
        `pinjaman ${pinjaman.tanggal_mulai}.`,
    );

  const id = teks(data.id) || uid('pby');
  const pembayaran = {
    id,
    pinjaman_id: pinjamanId,
    angsuran_id: angsuranId,
    jurnal_id: jurnalId,
    tanggal,
    catatan: teks(data.catatan),
    created_at: teks(data.created_at) || new Date().toISOString(),
  };

  try {
    const simpan = db.transaction(() => {
      const terkini = getPinjaman(db, pinjamanId)!;
      const errors = validasiSisaPembayaran(
        terkini, terkini.angsuran?.find((a) => a.id === angsuranId), cekJurnal.rincian.pokok,
      );
      if (errors.length) throw new Error(errors.join(' '));
      const sudah = db
        .prepare('SELECT id FROM pinjaman_bayar WHERE id = ?')
        .get(id) as { id: string } | undefined;
      if (sudah) throw new Error(`Pembayaran ${id} sudah ada. Gunakan ID lain.`);

      db.prepare(
        `INSERT INTO pinjaman_bayar
           (id, pinjaman_id, angsuran_id, jurnal_id, tanggal, catatan, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pembayaran.id,
        pembayaran.pinjaman_id,
        pembayaran.angsuran_id,
        pembayaran.jurnal_id,
        pembayaran.tanggal,
        pembayaran.catatan,
        pembayaran.created_at,
      );

      // Audit wajib satu kali dan satu transaksi dengan insert di atas; bila
      // audit gagal, tautan pembayaran ikut dibatalkan.
      catatAudit(db, {
        aksi: `PINJAMAN-BAYAR-LINK ${pinjamanId}`,
        alasan:
          `Menautkan jurnal pembayaran ${jurnalId} ke pinjaman ${pinjamanId}.` +
          (bebanLain.length > 0
            ? ` Debit beban non-bunga dikonfirmasi${alasanDendaLain ? `: ${alasanDendaLain}` : ''}.`
            : ''),
        baru: {
          pinjaman_id: pembayaran.pinjaman_id,
          angsuran_id: pembayaran.angsuran_id,
          jurnal_id: pembayaran.jurnal_id,
          tanggal: pembayaran.tanggal,
          pokok: cekJurnal.rincian.pokok,
          bunga: cekJurnal.rincian.bunga,
          denda: cekJurnal.rincian.denda,
          // T-B06: pembayaran memuat debit beban non-bunga yang dikonfirmasi.
          ...(bebanLain.length > 0
            ? {
                dendaLainDikonfirmasi: true,
                akunDendaLain: bebanLain,
                ...(alasanDendaLain ? { alasanDendaLain } : {}),
              }
            : {}),
        },
        ref_type: 'pinjaman_bayar',
        ref_id: pembayaran.id,
      });
    });
    simpan();
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed: pinjaman_bayar\.jurnal_id/i.test(pesan))
      return gagalBayar(`Jurnal ${jurnalId} sudah ditautkan ke pembayaran lain.`);
    // T-B10: tidak ada handler UNIQUE `angsuran_id` — DDL sengaja membolehkan
    // `angsuran_id` ganda untuk cicilan (lihat docstring di atas).
    return gagalBayar(`Pembayaran pinjaman gagal disimpan: ${pesan}`);
  }

  return {
    ...kosong,
    boleh: true,
    tersimpan: true,
    pembayaran: getPembayaranPinjaman(db, id) ?? {
      ...pembayaran,
      ...cekJurnal.rincian,
    },
  };
}

/** Rincian nominal satu pembayaran (dibaca ulang dari jurnal), null bila tidak ada. */
export function rincianPembayaranPinjaman(
  db: Database.Database,
  pembayaranId: string,
): RincianPembayaranPinjaman | null {
  const p = getPembayaranPinjaman(db, pembayaranId);
  if (!p) return null;
  return {
    pokok: p.pokok,
    bunga: p.bunga,
    denda: p.denda,
    kas_keluar: p.kas_keluar,
  };
}

class GagalBayarAngsuran extends Error {
  readonly errors: string[];
  readonly peringatan: string[];
  readonly perluKonfirmasi: boolean;

  constructor(
    errors: string[],
    peringatan: string[] = [],
    perluKonfirmasi = false,
  ) {
    super(errors.join(' ') || peringatan.join(' '));
    this.errors = errors;
    this.peringatan = peringatan;
    this.perluKonfirmasi = perluKonfirmasi;
  }
}

/**
 * DB-16d: bayar satu angsuran pinjaman LPD.
 *
 * Satu pembayaran = satu jurnal seimbang yang diposting lewat `postingJurnal`:
 * D 2050 pokok + D akun bunga + D 5050 denda / K kas total. Komponen boleh 0,
 * tetapi total wajib > 0. `pinjaman_bayar` hanya menyimpan link jurnal +
 * angsuran; tidak ada kolom nominal (DB-36).
 *
 * Pembayaran sebagian tidak memerlukan konfirmasi selisih. Bunga di atas
 * sisa jadwal wajib `konfirmasiSelisih` + `alasanSelisih` (≥5 karakter).
 * Jadwal tidak diubah; alasan ikut di keterangan jurnal dan audit.
 */
export function bayarAngsuranPinjaman(
  db: Database.Database,
  input: BayarAngsuranPinjamanInput,
  opsi: OpsiBayarAngsuranPinjaman = {},
): HasilBayarAngsuranPinjaman {
  const data = (input ?? {}) as BayarAngsuranPinjamanInput;
  const errors: string[] = [];

  const pinjamanId = teks(data.pinjaman_id ?? data.pinjamanId);
  const pinjaman = pinjamanId ? getPinjaman(db, pinjamanId) : null;
  if (!pinjamanId) errors.push('Pinjaman yang dibayar belum dipilih.');
  else if (!pinjaman) errors.push(`Pinjaman ${pinjamanId} tidak ditemukan.`);

  const angsuranMentah = data.angsuran_id ?? data.angsuranId;
  const angsuranId = Number(angsuranMentah);
  if (
    angsuranMentah === undefined ||
    angsuranMentah === null ||
    teks(angsuranMentah) === '' ||
    !Number.isSafeInteger(angsuranId) ||
    angsuranId <= 0
  )
    errors.push('Angsuran yang dibayar belum dipilih.');
  const angsuran = pinjaman?.angsuran?.find((a) => a.id === angsuranId);
  if (pinjaman && angsuranId > 0 && !angsuran)
    errors.push(
      `Angsuran ${angsuranId} tidak ditemukan pada pinjaman ${pinjamanId}.`,
    );

  const bacaKomponen = (
    nilai: unknown,
    fallback: number,
    label: string,
  ): number | null => {
    if (nilai === undefined || nilai === null || teks(nilai) === '')
      return fallback;
    if (typeof nilai !== 'number' || !Number.isSafeInteger(nilai) || nilai < 0) {
      errors.push(`${label} harus bilangan bulat ≥ 0 (satuan sen).`);
      return null;
    }
    return nilai;
  };
  const sisaPokok = angsuran?.sisa_pokok ?? angsuran?.pokok ?? 0;
  const sisaBunga = angsuran?.sisa_bunga ?? angsuran?.bunga ?? 0;
  const pokok = bacaKomponen(data.pokok, sisaPokok, 'Pokok pembayaran');
  const bunga = bacaKomponen(data.bunga, sisaBunga, 'Bunga pembayaran');
  const denda = bacaKomponen(data.denda, 0, 'Denda pembayaran');
  const total =
    pokok !== null && bunga !== null && denda !== null
      ? pokok + bunga + denda
      : 0;
  if (pokok !== null && bunga !== null && denda !== null && total <= 0)
    errors.push(
      'Total pembayaran (pokok + bunga + denda) harus lebih dari 0.',
    );

  const tanggal = teks(data.tanggal);
  if (!tanggalKalenderValid(tanggal))
    errors.push('Tanggal pembayaran tidak valid (YYYY-MM-DD).');
  if (pinjaman && tanggal < pinjaman.tanggal_mulai)
    errors.push('Tanggal pembayaran tidak boleh sebelum tanggal mulai pinjaman.');
  if (pinjaman && pokok !== null)
    errors.push(...validasiSisaPembayaran(pinjaman, angsuran, pokok));

  const akunKasKode = teks(data.akun_kas ?? data.akunKas);
  const akunKas = akunKasKode ? getAkun(db, akunKasKode) : null;
  if (
    !akunKas ||
    !akunKas.aktif ||
    akunKas.tipe !== 'AKTIVA' ||
    !akunKas.is_kas ||
    !akunBolehDiposting(akunKasKode, akunKas.aktif, { dikenal: true })
  )
    errors.push(
      'Akun kas/bank pembayaran wajib akun AKTIVA kas aktif (is_kas = 1).',
    );

  const akunBungaKode =
    pinjaman?.akun_bunga ?? AKUN_BUNGA_PINJAMAN_DEFAULT;
  const akunBunga = getAkun(db, akunBungaKode);
  if (
    !akunBunga ||
    !akunBunga.aktif ||
    akunBunga.tipe !== 'BEBAN' ||
    !akunBolehDiposting(akunBungaKode, akunBunga.aktif, { dikenal: true })
  )
    errors.push(
      `Akun bunga pinjaman ${akunBungaKode} wajib akun BEBAN yang aktif.`,
    );

  const akunHutang = getAkun(db, AKUN_HUTANG);
  if (
    !akunHutang ||
    !akunHutang.aktif ||
    akunHutang.tipe !== 'KEWAJIBAN' ||
    !akunBolehDiposting(AKUN_HUTANG, akunHutang.aktif, { dikenal: true })
  )
    errors.push(
      `Akun ${AKUN_HUTANG} HUTANG LAIN-LAIN wajib ada, aktif, dan bertipe KEWAJIBAN.`,
    );

  const akunDendaKode = AKUN_DENDA_PINJAMAN_DEFAULT;
  if ((denda ?? 0) > 0) {
    const akunDenda = getAkun(db, akunDendaKode);
    if (
      !akunDenda ||
      !akunDenda.aktif ||
      akunDenda.tipe !== 'BEBAN' ||
      !akunBolehDiposting(akunDendaKode, akunDenda.aktif, { dikenal: true })
    )
      errors.push(
        `Akun denda ${akunDendaKode} BIAYA LAIN-LAIN wajib akun BEBAN yang aktif.`,
      );
  }

  const konfirmasiSelisih =
    opsi.konfirmasiSelisih === true || data.konfirmasiSelisih === true;
  const alasanSelisih = teks(opsi.alasanSelisih ?? data.alasanSelisih);
  const alasanPeringatan = teks(opsi.alasanPeringatan);
  const konfirmasiDendaLain =
    opsi.konfirmasiDendaLain === true || data.konfirmasiDendaLain === true;
  const alasanDendaLain = teks(opsi.alasanDendaLain ?? data.alasanDendaLain);
  // Kunci periode longgar: alasan eksplisit menang, lalu alasan selisih, lalu
  // alasan konfirmasi peringatan. Tanpa ini pembayaran bertanggal periode
  // terkunci selalu ditolak karena tidak ada kanal alasan yang sampai ke jurnal.
  const alasanJurnal =
    teks(data.alasan) || alasanSelisih || alasanPeringatan;
  const selisih = {
    pokok: (pokok ?? 0) - sisaPokok,
    bunga: (bunga ?? 0) - sisaBunga,
  };
  if (errors.length > 0) return { ...gagalBayar(errors), selisih };

  // Cicilan sebagian adalah alur biasa. Bunga di atas sisa jadwal perlu alasan.
  const berbedaJadwal = angsuran !== undefined && selisih.bunga > 0;
  if (berbedaJadwal) {
    const rincianSelisih =
      `Pokok ${formatRp(pokok ?? 0)} vs sisa jadwal ${formatRp(sisaPokok)}; ` +
      `bunga ${formatRp(bunga ?? 0)} vs sisa jadwal ${formatRp(sisaBunga)}.`;
    if (!konfirmasiSelisih)
      return {
        ...gagalBayar(
          `${rincianSelisih} Nominal berbeda dari jadwal. Konfirmasi selisih ` +
            'dan isi alasan; jadwal tidak akan diubah.',
        ),
        perluKonfirmasi: true,
        selisih,
      };
    if (alasanSelisih.length < 5)
      return {
        ...gagalBayar(
          'Konfirmasi selisih wajib disertai alasan minimal 5 karakter. ' +
            'Jadwal tidak akan diubah.',
        ),
        perluKonfirmasi: true,
        selisih,
      };
  }

  // Validasi di atas menjamin pinjaman, angsuran, dan komponen ada.
  const p = pinjaman as Pinjaman;
  const a = angsuran as PinjamanAngsuran;
  const nilaiPokok = pokok as number;
  const nilaiBunga = bunga as number;
  const nilaiDenda = denda as number;
  const totalBayar = nilaiPokok + nilaiBunga + nilaiDenda;

  const baris: JurnalBarisInput[] = [];
  if (nilaiPokok > 0)
    baris.push({ akun_kode: AKUN_HUTANG, debit: nilaiPokok, kredit: 0 });
  if (nilaiBunga > 0)
    baris.push({ akun_kode: akunBungaKode, debit: nilaiBunga, kredit: 0 });
  if (nilaiDenda > 0)
    baris.push({ akun_kode: akunDendaKode, debit: nilaiDenda, kredit: 0 });
  baris.push({
    akun_kode: akunKasKode,
    debit: 0,
    kredit: totalBayar,
  });

  // T-B06: baris yang dibangun sendiri selalu memakai akun bunga pinjaman dan
  // 5050, sehingga peringatan ini tidak pernah muncul pada alur normal; tetap
  // dipasang sebagai jaring pengaman bila komposisi baris berubah. Konfirmasi
  // diperiksa sebelum transaksi sehingga tidak ada tulisan saat menunggu.
  const bebanLain = daftarBebanLain(db, baris, akunBungaKode);
  if (bebanLain.length > 0) {
    if (!konfirmasiDendaLain)
      return {
        ...gagalBayar(pesanBebanLain(bebanLain)),
        perluKonfirmasi: true,
        selisih,
      };
    if (alasanDendaLain.length < 5)
      return {
        ...gagalBayar(
          'Konfirmasi debit beban non-bunga wajib disertai alasan minimal 5 karakter.',
        ),
        perluKonfirmasi: true,
        selisih,
      };
  }

  const id = teks(data.id) || uid('pby');
  const jurnalId = teks(data.jurnal_id ?? data.jurnalId) || uid('j-bayar-pinjaman');
  const catatan = teks(data.catatan);
  const noBukti = teks(data.noBukti);

  const bagianKeterangan = [
    catatan,
    alasanSelisih ? `alasan selisih: ${alasanSelisih}` : '',
    bebanLain.length > 0 && alasanDendaLain
      ? `debit beban non-bunga dikonfirmasi: ${alasanDendaLain}`
      : '',
  ].filter(Boolean);
  const keterangan =
    `Pembayaran angsuran ke-${a.ke} pinjaman LPD ${p.kreditur}` +
    (bagianKeterangan.length > 0 ? ` — ${bagianKeterangan.join('; ')}` : '');

  const inputJurnal: JurnalInput = {
    header: {
      id: jurnalId,
      tanggal,
      keterangan,
      jenis: 'HUTANG',
      ...(noBukti ? { no_bukti: noBukti } : {}),
    },
    baris,
    ...(alasanJurnal ? { alasan: alasanJurnal } : {}),
    // Bunga/denda saja (pokok 0) tetap jurnal HUTANG tanpa baris 2050.
    ...(nilaiPokok === 0
      ? { konteks: 'PINJAMAN_BAYAR' as const }
      : {}),
  };

  const created_at = teks(data.created_at) || new Date().toISOString();

  try {
    const simpan = db.transaction((): HasilBayarAngsuranPinjaman => {
      // Cek ulang sisa di transaksi yang sama dengan penulisan pembayaran.
      const terkini = getPinjaman(db, p.id)!;
      const errorsSisa = validasiSisaPembayaran(
        terkini, terkini.angsuran?.find((it) => it.id === a.id), nilaiPokok,
      );
      if (errorsSisa.length) throw new GagalBayarAngsuran(errorsSisa);
      const jurnalTerpakai = db
        .prepare('SELECT id FROM pinjaman_bayar WHERE jurnal_id = ? LIMIT 1')
        .get(jurnalId) as { id: string } | undefined;
      if (jurnalTerpakai)
        throw new GagalBayarAngsuran([
          `Jurnal ${jurnalId} sudah ditautkan ke pembayaran ${jurnalTerpakai.id}.`,
        ]);

      const posting = postingJurnal(db, inputJurnal, {
        konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        alasanPeringatan,
        wajibAlasanPeringatan: true,
        wajibSaldoAwal: opsi.wajibSaldoAwal === true,
        konfirmasiTanpaSaldoAwal: opsi.konfirmasiTanpaSaldoAwal === true,
        sekarang: opsi.sekarang,
      });
      if (!posting.tersimpan || !posting.jurnal)
        throw new GagalBayarAngsuran(
          posting.errors.length > 0 ? posting.errors : posting.peringatan,
          posting.peringatan,
          posting.perluKonfirmasi,
        );

      db.prepare(
        `INSERT INTO pinjaman_bayar
           (id, pinjaman_id, angsuran_id, jurnal_id, tanggal, catatan, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        p.id,
        a.id,
        jurnalId,
        tanggal,
        catatan,
        created_at,
      );

      catatAudit(db, {
        aksi: `PINJAMAN-BAYAR ${p.id}`,
        alasan:
          `Pembayaran angsuran ke-${a.ke} pinjaman LPD ${p.kreditur}` +
          (alasanSelisih ? `; alasan selisih: ${alasanSelisih}` : '') +
          (bebanLain.length > 0
            ? `; debit beban non-bunga dikonfirmasi${alasanDendaLain ? `: ${alasanDendaLain}` : ''}`
            : ''),
        baru: {
          pinjaman_id: p.id,
          angsuran_id: a.id,
          pembayaran_id: id,
          jurnal: posting.jurnal,
          pokok: nilaiPokok,
          bunga: nilaiBunga,
          denda: nilaiDenda,
          total: totalBayar,
          ...(alasanSelisih ? { alasanSelisih } : {}),
          // T-B06: pembayaran memuat debit beban non-bunga yang dikonfirmasi.
          ...(bebanLain.length > 0
            ? {
                dendaLainDikonfirmasi: true,
                akunDendaLain: bebanLain,
                ...(alasanDendaLain ? { alasanDendaLain } : {}),
              }
            : {}),
        },
        ref_type: 'pinjaman',
        ref_id: p.id,
      });

      return {
        ...kosong,
        boleh: true,
        tersimpan: true,
        pembayaran: getPembayaranPinjaman(db, id) ?? undefined,
        jurnal: posting.jurnal,
        rincian: rincianPembayaranDariJurnal(db, jurnalId, akunBungaKode),
        selisih,
      };
    });
    return simpan();
  } catch (e) {
    if (e instanceof GagalBayarAngsuran) {
      const pesan = e.errors.length > 0 ? e.errors : e.peringatan;
      return {
        ...gagalBayar(pesan),
        peringatan: e.peringatan,
        perluKonfirmasi: e.perluKonfirmasi,
        selisih,
      };
    }
    const pesan = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed: pinjaman_bayar\.jurnal_id/i.test(pesan))
      return {
        ...gagalBayar(`Jurnal ${jurnalId} sudah ditautkan ke pembayaran lain.`),
        selisih,
      };
    // T-B10: tidak ada handler UNIQUE `angsuran_id` — DDL sengaja membolehkan
    // `angsuran_id` ganda untuk cicilan (cicilan sebagian adalah alur biasa).
    return {
      ...gagalBayar(`Pembayaran pinjaman gagal disimpan: ${pesan}`),
      selisih,
    };
  }
}

export type BatalCatatanPinjamanInput = { id: string; alasan: string };
export type OpsiBatalCatatanPinjaman = {
  konfirmasiPeringatan?: boolean;
  alasanPeringatan?: string;
};

/**
 * Koreksi catatan salah: reversal pada tanggal asli, tanpa menghapus kuitansi.
 * Status dan saldo langsung mengikuti jurnal; input pengganti melalui form biasa.
 */
function batalkanCatatanPinjaman(
  db: Database.Database,
  jenis: 'bayar' | 'pencairan',
  input: BatalCatatanPinjamanInput,
  opsi: OpsiBatalCatatanPinjaman,
): HasilPinjaman & { pembayaran?: PinjamanBayar; jurnal?: Jurnal } {
  try {
    return db.transaction(() => {
      const id = teks(input?.id);
      const alasan = teks(input?.alasan);
      if (!id || alasan.length < 5)
        return gagal('Pilih catatan dan isi alasan pembatalan minimal 5 karakter.');
      const pembayaran = jenis === 'bayar' ? getPembayaranPinjaman(db, id) : null;
      const pinjaman = getPinjaman(db, pembayaran?.pinjaman_id ?? id);
      if (!pinjaman || (jenis === 'bayar' && !pembayaran))
        return gagal('Catatan pinjaman tidak ditemukan.');
      const jurnalId = pembayaran?.jurnal_id ?? pinjaman.jurnal_pencairan_id;
      if (!jurnalId)
        return gagal('Pinjaman berjalan berasal dari saldo awal. Koreksi saldo awal bersama akuntan pendamping.');
      if (jurnalPembatalan(db, jurnalId)) return gagal('Catatan ini sudah dibatalkan.');
      if (jenis === 'pencairan' && daftarPembayaran(db, pinjaman.id).some((p) => !p.dibatalkan))
        return gagal('Batalkan catatan pembayaran yang masih aktif sebelum membatalkan pencairan.');
      // T-B04: satu pintu jurnal balik tertaut — helper menyusun rencana
      // REVERSAL (grup & `reversal_of` dari jurnal asli, default tanggal
      // jurnal asli), mengirim `mode: 'REVERSAL'` sehingga sumber insert
      // `REVERSAL`, dan menulis audit otomatis posting layer di transaksi ini.
      const posting = postingReversalTertaut(db, jurnalId, alasan, {
        id: uid('j-batal-pinjaman'),
        konfirmasiPeringatan: opsi.konfirmasiPeringatan,
        alasanPeringatan: opsi.alasanPeringatan,
      });
      if (!posting.tersimpan || !posting.jurnal) return { ...posting };
      catatAudit(db, {
        aksi: `${jenis === 'bayar' ? 'PINJAMAN-BAYAR-BATAL' : 'PINJAMAN-BATAL'} ${pinjaman.id}`,
        alasan,
        lama: { pinjaman, pembayaran },
        baru: { jurnal: posting.jurnal, pembayaran_id: pembayaran?.id ?? null },
        ref_type: 'pinjaman',
        ref_id: pinjaman.id,
      });
      return {
        ...posting,
        pinjaman: getPinjaman(db, pinjaman.id)!,
        ...(pembayaran ? { pembayaran: getPembayaranPinjaman(db, pembayaran.id)! } : {}),
      };
    })();
  } catch (e) {
    return gagal(`Pembatalan gagal disimpan: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function batalkanPembayaranPinjaman(
  db: Database.Database, input: BatalCatatanPinjamanInput, opsi: OpsiBatalCatatanPinjaman = {},
): HasilPembayaranPinjaman & { jurnal?: Jurnal } {
  return batalkanCatatanPinjaman(db, 'bayar', input, opsi);
}

export function batalkanPinjaman(
  db: Database.Database, input: BatalCatatanPinjamanInput, opsi: OpsiBatalCatatanPinjaman = {},
): HasilPinjaman & { jurnal?: Jurnal } {
  return batalkanCatatanPinjaman(db, 'pencairan', input, opsi);
}

/** Alias DB-16d: pembayaran link-only memakai fungsi yang sama. */
export const catatPembayaran = tautkanPembayaran;
/** Alias Indonesia untuk pemanggil baru. */
export const bayarAngsuran = bayarAngsuranPinjaman;
export const bayarPinjaman = bayarAngsuranPinjaman;
export const createPinjaman = buatPinjaman;
export const getPinjamanDetail = getPinjaman;
export const listPembayaranPinjaman = listPinjamanBayar;
export const hitungRincianPembayaran = rincianPembayaranPinjaman;

// DB-16f: re-export adapter rekonsiliasi agar pemanggil modul pinjaman cukup
// memakai satu pintu. Implementasi tetap di `pinjamanRekonsiliasi.ts` dan
// perhitungan murni di `core/pinjamanRekonsiliasi.ts`.
export {
  rekonsiliasiPinjaman,
  rekonsiliasiSemuaPinjaman,
} from './pinjamanRekonsiliasi.js';
export type { HasilRekonsiliasiPinjaman } from '../core/pinjamanRekonsiliasi.js';
