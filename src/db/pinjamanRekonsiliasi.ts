// DB-16f — adapter baca-saja rekonsiliasi 2050 vs jadwal pinjaman.
//
// Hanya SELECT. Tidak menulis/mengubah data, tidak ada koreksi otomatis, dan
// tidak ada angka turunan yang disimpan. Perhitungan tetap di
// `core/pinjamanRekonsiliasi.ts` agar audit, IPC, dan UI memakai rumus sama.
//
// Batas penting: rekonsiliasi per pinjaman HANYA memakai jurnal yang tertaut
// lewat `jurnal_pencairan_id` dan `pinjaman_bayar`. Saldo total akun 2050 juga
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

type RowPinjaman = {
  id: string;
  sisa_pokok_awal: number;
  jurnal_pencairan_id: string | null;
  akun_bunga: string;
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
        WHERE jurnal_id = ?
        ORDER BY id`,
    )
    .all(jurnalId) as BarisRekonsiliasiPinjaman[];
}

function pembayaranTertaut(
  db: Database.Database,
  pinjamanId: string,
): PembayaranRekonsiliasiPinjaman[] {
  const kepala = db
    .prepare(
      `SELECT id, jurnal_id
         FROM pinjaman_bayar
        WHERE pinjaman_id = ?
        ORDER BY tanggal, id`,
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
         LEFT JOIN jurnal_baris b ON b.jurnal_id = pb.jurnal_id
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
    baris: perPembayaran.get(String(p.id)) ?? [],
  }));
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
  const pinjaman = db
    .prepare(
      `SELECT id, sisa_pokok_awal, jurnal_pencairan_id, akun_bunga
         FROM pinjaman
        WHERE id = ?`,
    )
    .get(id) as RowPinjaman | undefined;
  if (!pinjaman) return null;

  const jurnalPencairanId = pinjaman.jurnal_pencairan_id
    ? String(pinjaman.jurnal_pencairan_id)
    : null;

  return hitungRekonsiliasiPinjaman({
    pinjaman_id: String(pinjaman.id),
    sisa_pokok_awal: Number(pinjaman.sisa_pokok_awal),
    jurnal_pencairan_id: jurnalPencairanId,
    baris_pencairan: barisPencairan(db, jurnalPencairanId),
    pembayaran: pembayaranTertaut(db, String(pinjaman.id)),
    akun_bunga: String(pinjaman.akun_bunga),
    akun_beban: akunBeban(db),
    akun_hutang: AKUN_HUTANG,
  });
}

/**
 * Rekonsiliasi seluruh pinjaman, terurut tanggal mulai + id. Dipakai audit
 * integritas dan IPC daftar; tidak mengubah data apa pun.
 */
export function rekonsiliasiSemuaPinjaman(
  db: Database.Database,
): HasilRekonsiliasiPinjaman[] {
  const rows = db
    .prepare('SELECT id FROM pinjaman ORDER BY tanggal_mulai, id')
    .all() as { id: string }[];
  const hasil: HasilRekonsiliasiPinjaman[] = [];
  for (const r of rows) {
    const satu = rekonsiliasiPinjaman(db, String(r.id));
    if (satu) hasil.push(satu);
  }
  return hasil;
}
