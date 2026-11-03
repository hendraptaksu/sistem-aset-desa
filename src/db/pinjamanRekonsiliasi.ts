// DB-16f — adapter baca-saja rekonsiliasi 2050 vs jadwal pinjaman.
//
// Hanya SELECT. Tidak menulis/mengubah data, tidak ada koreksi otomatis, dan
// tidak ada angka turunan yang disimpan. Perhitungan tetap di
// `core/pinjamanRekonsiliasi.ts` agar audit, IPC, dan UI memakai rumus sama.
//
// Batas penting: rekonsiliasi per pinjaman HANYA memakai jurnal yang tertaut
// lewat `jurnal_pencairan_id` dan `pinjaman_bayar`, beserta jurnal pembaliknya.
// Saldo total akun 2050 juga
// berisi utang non-LPD, jadi tidak boleh dipakai sebagai pembanding. Jurnal
// 2050 tanpa link (termasuk link pembayaran yang hilang) tidak dapat
// diatribusikan ke pinjaman dan tidak dihitung di sini.

import type Database from 'better-sqlite3';
import { AKUN_HUTANG } from './coa.js';
import {
  hitungRekonsiliasiPinjaman,
  type BarisRekonsiliasiPinjaman,
  type HasilRekonsiliasiPinjaman,
  type PembayaranRekonsiliasiPinjaman,
} from '../core/pinjamanRekonsiliasi.js';

export type { HasilRekonsiliasiPinjaman } from '../core/pinjamanRekonsiliasi.js';

/** Ringkasan kredit neto 2050 grup SALDO_AWAL vs sisa pokok pinjaman berjalan. */
export type RekonsiliasiSaldoAwal2050 = {
  /** Kredit neto 2050 pada grup jurnal SALDO_AWAL (bisa negatif bila debit). */
  saldo_awal_2050: number;
  /** Total sisa_pokok_awal seluruh pinjaman BERJALAN. */
  total_sisa_pokok_berjalan: number;
  /** Positif = Saldo Awal 2050 kurang dari kebutuhan pinjaman berjalan. */
  kekurangan: number;
  /** True bila Saldo Awal 2050 mencukupi seluruh pinjaman berjalan. */
  cocok: boolean;
};

/** Ringkasan saldo kredit neto 2050 Buku Besar vs outstanding seluruh pinjaman. */
export type RekonsiliasiGl2050Pinjaman = {
  /** Kredit neto 2050 seluruh Buku Besar (termasuk utang non-LPD). */
  gl_2050: number;
  /** Total outstanding jadwal seluruh pinjaman aktif. */
  outstanding_pinjaman: number;
  /** `gl_2050 - outstanding_pinjaman`; positif = GL lebih besar. */
  selisih: number;
  /** Positif = GL 2050 kurang dari outstanding pinjaman. */
  kekurangan: number;
  /** True bila GL 2050 tidak kurang dari outstanding pinjaman. */
  cocok: boolean;
};

/**
 * AUD2-05 — kredit neto akun 2050 pada grup jurnal `SALDO_AWAL`.
 *
 * Satu grup dapat berisi jurnal asli, reversal, dan pengganti. Nilai dihitung
 * dari `jurnal_baris` (kredit - debit) sehingga pembalikan otomatis mengurangi
 * saldo pembukaan; tidak ada angka saldo yang disimpan. Jika belum ada jurnal
 * `SALDO_AWAL`, hasilnya 0.
 */
export function saldoAwal2050(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(b.kredit - b.debit), 0) AS saldo
         FROM jurnal_baris b
         JOIN jurnal j ON j.id = b.jurnal_id
        WHERE b.akun_kode = ?
          AND j.grup_id IN (
            SELECT DISTINCT grup_id FROM jurnal WHERE jenis = 'SALDO_AWAL'
          )`,
    )
    .get(AKUN_HUTANG) as { saldo: number } | undefined;
  return Number(row?.saldo ?? 0) || 0;
}

/**
 * AUD2-05 — total `sisa_pokok_awal` seluruh pinjaman `BERJALAN`
 * (`jurnal_pencairan_id` null). Pinjaman berjalan tidak punya jurnal pencairan
 * sehingga saldo awalnya wajib berasal dari Saldo Awal 2050.
 */
export function totalSisaPokokBerjalan(db: Database.Database): number {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(sisa_pokok_awal), 0) AS total
         FROM pinjaman
        WHERE jurnal_pencairan_id IS NULL OR jurnal_pencairan_id = ''`,
    )
    .get() as { total: number } | undefined;
  return Number(row?.total ?? 0) || 0;
}

type RowPinjaman = {
  id: string;
  sisa_pokok_awal: number;
  jurnal_pencairan_id: string | null;
  akun_bunga: string;
  tanggal_mulai: string;
};

type RowBaris = {
  jurnal_id: string;
  akun_kode: string;
  debit: number;
  kredit: number;
};

type RowPembayaran = {
  id: string;
  jurnal_id: string;
  dibatalkan: number;
};

type RowPembayaranBaris = RowBaris & {
  pembayaran_id: string;
};

const teks = (v: unknown): string => String(v ?? '').trim();

function akunBeban(db: Database.Database): Set<string> {
  return new Set(
    (
      db
        .prepare("SELECT kode FROM akun WHERE tipe = 'BEBAN' ORDER BY kode")
        .all() as { kode: string }[]
    ).map((a) => a.kode),
  );
}

function barisPencairan(
  db: Database.Database,
  jurnalId: string | null,
): BarisRekonsiliasiPinjaman[] {
  if (!jurnalId) return [];
  return db
    .prepare(
      `SELECT jurnal_id, akun_kode, debit, kredit
         FROM jurnal_baris
        WHERE jurnal_id = ? OR jurnal_id IN (SELECT id FROM jurnal WHERE reversal_of = ?)
        ORDER BY id`,
    )
    .all(jurnalId, jurnalId) as BarisRekonsiliasiPinjaman[];
}

function pembayaranTertaut(
  db: Database.Database,
  pinjamanId: string,
): PembayaranRekonsiliasiPinjaman[] {
  const kepala = db
    .prepare(
      `SELECT pb.id, pb.jurnal_id,
              EXISTS(SELECT 1 FROM jurnal r WHERE r.reversal_of = pb.jurnal_id) AS dibatalkan
         FROM pinjaman_bayar pb
        WHERE pb.pinjaman_id = ?
        ORDER BY pb.tanggal, pb.id`,
    )
    .all(pinjamanId) as RowPembayaran[];
  if (kepala.length === 0) return [];

  // LEFT JOIN: link lama dengan jurnal hilang tetap muncul sebagai pembayaran
  // tanpa baris, bukan membuat adapter crash. Temuan tautan yatim ditangani
  // pemeriksaan integritas lain.
  const baris = db
    .prepare(
      `SELECT pb.id AS pembayaran_id, b.jurnal_id, b.akun_kode, b.debit, b.kredit
         FROM pinjaman_bayar pb
         LEFT JOIN jurnal j ON j.id = pb.jurnal_id OR j.reversal_of = pb.jurnal_id
         LEFT JOIN jurnal_baris b ON b.jurnal_id = j.id
        WHERE pb.pinjaman_id = ?
        ORDER BY pb.tanggal, pb.id, b.id`,
    )
    .all(pinjamanId) as RowPembayaranBaris[];

  const perPembayaran = new Map<string, BarisRekonsiliasiPinjaman[]>();
  for (const b of baris) {
    if (!b.jurnal_id) continue; // LEFT JOIN tanpa baris
    const daftar = perPembayaran.get(b.pembayaran_id);
    const item: BarisRekonsiliasiPinjaman = {
      jurnal_id: String(b.jurnal_id),
      akun_kode: String(b.akun_kode),
      debit: Number(b.debit),
      kredit: Number(b.kredit),
    };
    if (daftar) daftar.push(item);
    else perPembayaran.set(b.pembayaran_id, [item]);
  }

  return kepala.map((p) => ({
    id: String(p.id),
    jurnal_id: String(p.jurnal_id),
    dibatalkan: Boolean(p.dibatalkan),
    baris: perPembayaran.get(String(p.id)) ?? [],
  }));
}

function daftarPinjaman(db: Database.Database): RowPinjaman[] {
  return db
    .prepare(
      `SELECT id, sisa_pokok_awal, jurnal_pencairan_id, akun_bunga, tanggal_mulai
         FROM pinjaman
        ORDER BY tanggal_mulai, id`,
    )
    .all() as RowPinjaman[];
}

/**
 * Alokasi kredit neto 2050 grup `SALDO_AWAL` ke pinjaman berjalan.
 *
 * Saldo pembukaan 2050 adalah satu angka GL, bukan angka per pinjaman. Agar
 * beberapa pinjaman berjalan tidak saling menyalin seluruh saldo, alokasi
 * diberikan berurutan (tanggal mulai + id) maksimal sebesar `sisa_pokok_awal`
 * masing-masing. Kekurangan selalu membuat pinjaman terakhir berselisih,
 * sedangkan kelebihan (mis. 2050 non-LPD) tidak diatribusikan ke pinjaman.
 */
function alokasiSaldoAwal2050(
  db: Database.Database,
  rows: readonly RowPinjaman[],
): Map<string, number> {
  let tersisa = Math.max(0, saldoAwal2050(db));
  const hasil = new Map<string, number>();
  for (const p of rows) {
    if (p.jurnal_pencairan_id) continue;
    const kebutuhan = Math.max(0, Number(p.sisa_pokok_awal) || 0);
    const alokasi = Math.min(kebutuhan, tersisa);
    hasil.set(String(p.id), alokasi);
    tersisa -= alokasi;
  }
  return hasil;
}

function rekonsiliasiSatu(
  db: Database.Database,
  pinjaman: RowPinjaman,
  alokasiAwal: number,
): HasilRekonsiliasiPinjaman {
  const jurnalPencairanId = pinjaman.jurnal_pencairan_id
    ? String(pinjaman.jurnal_pencairan_id)
    : null;

  return hitungRekonsiliasiPinjaman({
    pinjaman_id: String(pinjaman.id),
    sisa_pokok_awal: Number(pinjaman.sisa_pokok_awal),
    jurnal_pencairan_id: jurnalPencairanId,
    baris_pencairan: barisPencairan(db, jurnalPencairanId),
    saldo_awal_2050: alokasiAwal,
    pembayaran: pembayaranTertaut(db, String(pinjaman.id)),
    akun_bunga: String(pinjaman.akun_bunga),
    akun_beban: akunBeban(db),
    akun_hutang: AKUN_HUTANG,
    dibatalkan: jurnalPencairanId !== null && Boolean(
      db.prepare('SELECT 1 FROM jurnal WHERE reversal_of = ?').get(jurnalPencairanId),
    ),
  });
}

/**
 * Rekonsiliasi satu pinjaman. `null` bila pinjaman tidak ditemukan.
 * Pembacaan murni; pemanggil tidak perlu transaksi dan tidak ada yang ditulis.
 */
export function rekonsiliasiPinjaman(
  db: Database.Database,
  pinjamanId: string,
): HasilRekonsiliasiPinjaman | null {
  const id = teks(pinjamanId);
  const rows = daftarPinjaman(db);
  const pinjaman = rows.find((p) => String(p.id) === id);
  if (!pinjaman) return null;
  const alokasi = alokasiSaldoAwal2050(db, rows);
  return rekonsiliasiSatu(db, pinjaman, alokasi.get(id) ?? 0);
}

/**
 * Rekonsiliasi seluruh pinjaman, terurut tanggal mulai + id. Dipakai audit
 * integritas dan IPC daftar; tidak mengubah data apa pun.
 */
export function rekonsiliasiSemuaPinjaman(
  db: Database.Database,
): HasilRekonsiliasiPinjaman[] {
  const rows = daftarPinjaman(db);
  const alokasi = alokasiSaldoAwal2050(db, rows);
  return rows.map((p) =>
    rekonsiliasiSatu(db, p, alokasi.get(String(p.id)) ?? 0),
  );
}

/**
 * AUD2-05 — periksa kecukupan Saldo Awal 2050 untuk seluruh pinjaman berjalan.
 *
 * Perbandingan memakai kredit neto 2050 dari grup `SALDO_AWAL` (bukan seluruh
 * akun 2050, yang juga menampung utang non-LPD) terhadap total
 * `sisa_pokok_awal` pinjaman `BERJALAN`. Rekonsiliasi per pinjaman memakai
 * alokasi saldo yang sama; ringkasan ini menangkap kekurangan agregat agar
 * tidak ada pinjaman berjalan yang lolos tanpa Saldo Awal. Baca-saja.
 */
export function rekonsiliasiSaldoAwal2050(
  db: Database.Database,
): RekonsiliasiSaldoAwal2050 {
  const saldo = saldoAwal2050(db);
  const total = totalSisaPokokBerjalan(db);
  const kekurangan = Math.max(0, total - saldo);
  return {
    saldo_awal_2050: saldo,
    total_sisa_pokok_berjalan: total,
    kekurangan,
    cocok: kekurangan === 0,
  };
}

/**
 * AUD2-05 — bandingkan kredit neto 2050 seluruh Buku Besar dengan outstanding
 * seluruh pinjaman aktif.
 *
 * Pemeriksaan ini sengaja satu arah: hanya kekurangan GL yang dianggap
 * temuan. Kelebihan GL dapat berasal dari utang non-LPD yang sah, sehingga
 * tidak dipakai untuk menyatakan pinjaman selisih. Pemanggil (audit integritas)
 * membatasi pemakaian ringkasan ini pada basis pinjaman berjalan agar tidak
 * mengubah batas per pinjaman DB-16f. Baca-saja.
 */
export function rekonsiliasiGl2050(
  db: Database.Database,
): RekonsiliasiGl2050Pinjaman {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(kredit - debit), 0) AS saldo
         FROM jurnal_baris
        WHERE akun_kode = ?`,
    )
    .get(AKUN_HUTANG) as { saldo: number } | undefined;
  const gl = Number(row?.saldo ?? 0) || 0;
  const outstanding = rekonsiliasiSemuaPinjaman(db).reduce(
    (total, hasil) => total + hasil.jadwal,
    0,
  );
  const kekurangan = Math.max(0, outstanding - gl);
  return {
    gl_2050: gl,
    outstanding_pinjaman: outstanding,
    selisih: gl - outstanding,
    kekurangan,
    cocok: kekurangan === 0,
  };
}
