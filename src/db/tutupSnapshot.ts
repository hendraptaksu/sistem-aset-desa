// T-A06 — pembaca/penulis snapshot tutup buku.
//
// Snapshot BUKAN sumber angka laporan: laba dan Neraca tetap dihitung ulang
// dari jurnal. Modul ini menyimpan hasil pembacaan saat tutup buku agar
// riwayat dapat diaudit, lalu membandingkannya dengan kondisi jurnal saat ini.
// Semua penulisan snapshot dilakukan oleh pemanggil (tutupBuku) di dalam
// transaksi yang sama dengan penanda tutup buku.

import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { labaTahun, neraca } from '../core/reports.js';
import { formatRp } from '../utils/format.js';
import type { TutupBukuSnapshot } from '../core/types.js';
import { listBarisJurnal } from './laporan.js';
import { getCutoverTanggal } from './pembukaan.js';
import {
  insertTutupBukuSnapshot,
  listAkun,
  listTutupBuku,
  listTutupBukuSnapshot,
} from './repository.js';

export type AngkaSnapshotTutup = {
  laba: number;
  total_aset: number;
  total_kewajiban: number;
  total_ekuitas: number;
  total_pasiva: number;
  selisih: number;
};

export type LiveSnapshotTutup = AngkaSnapshotTutup & {
  hash_jurnal: string;
  jumlah_jurnal: number;
};

export type PerbandinganSnapshotTutup = {
  snapshot: TutupBukuSnapshot | null;
  live: LiveSnapshotTutup;
  perbedaan: string[];
  berubah: boolean;
};

type BarisHash = {
  jurnal_id: string;
  baris_id: number;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  jenis: string;
  peran: string;
  grup_id: string;
  reversal_of: string | null;
  replaces_id: string | null;
  akun_kode: string;
  debit: number;
  kredit: number;
  keterangan_baris: string;
};

type JurnalHash = {
  id: string;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  jenis: string;
  peran: string;
  grup_id: string;
  reversal_of: string | null;
  replaces_id: string | null;
  baris: Array<{
    akun_kode: string;
    debit: number;
    kredit: number;
    keterangan: string;
  }>;
};

function bandingkanTeks(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function ambilBarisTahun(
  db: Database.Database,
  tahun: number,
): BarisHash[] {
  if (!Number.isInteger(tahun)) return [];
  return db
    .prepare(
      `SELECT
         j.id AS jurnal_id,
         b.id AS baris_id,
         j.tanggal AS tanggal,
         j.no_bukti AS no_bukti,
         j.keterangan AS keterangan,
         j.jenis AS jenis,
         j.peran AS peran,
         j.grup_id AS grup_id,
         j.reversal_of AS reversal_of,
         j.replaces_id AS replaces_id,
         b.akun_kode AS akun_kode,
         b.debit AS debit,
         b.kredit AS kredit,
         b.keterangan AS keterangan_baris
       FROM jurnal_baris b
       JOIN jurnal j ON j.id = b.jurnal_id
      WHERE j.tanggal >= ? AND j.tanggal <= ?
      ORDER BY j.id, b.id`,
    )
    .all(`${tahun}-01-01`, `${tahun}-12-31`) as BarisHash[];
}

/**
 * Hash SHA-256 kanonik seluruh kepala + baris jurnal bertanggal tahun itu.
 * Urutan tidak bergantung pada rowid/urutan query: jurnal diurutkan menurut id,
 * baris menurut id baris, dan payload dibentuk eksplisit (bukan SELECT *).
 */
export function hitungHashJurnalTahun(
  db: Database.Database,
  tahun: number,
): { hash_jurnal: string; jumlah_jurnal: number } {
  const rows = ambilBarisTahun(db, tahun);
  const peta = new Map<string, JurnalHash>();

  for (const r of rows) {
    let jurnal = peta.get(r.jurnal_id);
    if (!jurnal) {
      jurnal = {
        id: String(r.jurnal_id),
        tanggal: String(r.tanggal),
        no_bukti: String(r.no_bukti ?? ''),
        keterangan: String(r.keterangan ?? ''),
        jenis: String(r.jenis ?? ''),
        peran: String(r.peran ?? ''),
        grup_id: String(r.grup_id ?? ''),
        reversal_of: r.reversal_of ?? null,
        replaces_id: r.replaces_id ?? null,
        baris: [],
      };
      peta.set(r.jurnal_id, jurnal);
    }
    jurnal.baris.push({
      akun_kode: String(r.akun_kode),
      debit: Number(r.debit),
      kredit: Number(r.kredit),
      keterangan: String(r.keterangan_baris ?? ''),
    });
  }

  const kanonik = [...peta.values()]
    .sort((a, b) => bandingkanTeks(a.id, b.id))
    .map((j) => ({
      ...j,
      baris: j.baris
        .slice()
        .sort((a, b) =>
          bandingkanTeks(
            `${a.akun_kode}\u0000${a.debit}\u0000${a.kredit}\u0000${a.keterangan}`,
            `${b.akun_kode}\u0000${b.debit}\u0000${b.kredit}\u0000${b.keterangan}`,
          ),
        ),
    }));

  const hash_jurnal = createHash('sha256')
    .update(JSON.stringify(kanonik), 'utf8')
    .digest('hex');

  return { hash_jurnal, jumlah_jurnal: kanonik.length };
}

/**
 * Angka yang disahkan saat tutup: laba tahun tersebut + Neraca pada cutoff
 * `YYYY-12-31` dengan daftar tutup buku saat ini. `total_ekuitas` memakai
 * `NeracaHasil.totalEkuitas` (termasuk laba ditahan/berjalan), bukan hanya
 * saldo akun ekuitas.
 */
export function hitungAngkaSnapshotTutup(
  db: Database.Database,
  tahun: number,
): AngkaSnapshotTutup {
  const cutoff = `${tahun}-12-31`;
  const baris = listBarisJurnal(db, { sampai: cutoff });
  const daftarAkun = listAkun(db);
  const cutover = getCutoverTanggal(db);
  const laba = labaTahun(baris, tahun, daftarAkun, cutover);
  const posisi = neraca(
    baris,
    { cutoff, tutup: listTutupBuku(db) },
    daftarAkun,
    cutover,
  );

  return {
    laba,
    total_aset: posisi.totalAset,
    total_kewajiban: posisi.totalKewajiban,
    total_ekuitas: posisi.totalEkuitas,
    total_pasiva: posisi.totalPasiva,
    selisih: posisi.selisih,
  };
}

/** Snapshot terbaru (versi tertinggi) untuk satu tahun, atau null. */
export function snapshotTerbaruTutup(
  db: Database.Database,
  tahun: number,
): TutupBukuSnapshot | null {
  return listTutupBukuSnapshot(db, tahun)[0] ?? null;
}

/** Nomor versi berikutnya: 1 bila belum ada snapshot. */
export function versiSnapshotBerikutnya(
  db: Database.Database,
  tahun: number,
): number {
  const semua = listTutupBukuSnapshot(db, tahun);
  const versiTerbesar = semua.reduce(
    (maks, snapshot) => Math.max(maks, Number(snapshot.versi)),
    0,
  );
  return versiTerbesar + 1;
}

/**
 * Bandingkan snapshot terbaru dengan angka + hash live. Bila belum ada
 * snapshot, `berubah` selalu false (penutupan pertama tidak bisa "berubah").
 */
export function bandingkanSnapshotTutup(
  db: Database.Database,
  tahun: number,
): PerbandinganSnapshotTutup {
  const snapshot = snapshotTerbaruTutup(db, tahun);
  const angkaLive = hitungAngkaSnapshotTutup(db, tahun);
  const hashLive = hitungHashJurnalTahun(db, tahun);
  const live: LiveSnapshotTutup = { ...angkaLive, ...hashLive };

  if (!snapshot) {
    return { snapshot: null, live, perbedaan: [], berubah: false };
  }

  const perbedaan: string[] = [];
  const angka: Array<[keyof AngkaSnapshotTutup, string]> = [
    ['laba', 'Laba tahun'],
    ['total_aset', 'Total aset'],
    ['total_kewajiban', 'Total kewajiban'],
    ['total_ekuitas', 'Total ekuitas'],
    ['total_pasiva', 'Total pasiva'],
    ['selisih', 'Selisih Neraca'],
  ];
  for (const [field, label] of angka) {
    if (Number(snapshot[field]) !== Number(live[field])) {
      perbedaan.push(
        `${label}: snapshot ${formatRp(Number(snapshot[field]))}, ` +
          `live ${formatRp(Number(live[field]))}`,
      );
    }
  }
  if (snapshot.hash_jurnal !== live.hash_jurnal) {
    perbedaan.push(
      `Hash jurnal berubah (snapshot ${snapshot.hash_jurnal.slice(0, 12)}…, ` +
        `live ${live.hash_jurnal.slice(0, 12)}…)`,
    );
  }

  return {
    snapshot,
    live,
    perbedaan,
    berubah: perbedaan.length > 0,
  };
}

/**
 * Hitung lalu tulis snapshot versi berikutnya. WAJIB dipanggil di dalam
 * transaksi `tutupBuku`, supaya penanda + snapshot + audit atomik.
 */
export function buatSnapshotTutup(
  db: Database.Database,
  tahun: number,
): TutupBukuSnapshot {
  const angka = hitungAngkaSnapshotTutup(db, tahun);
  const { hash_jurnal } = hitungHashJurnalTahun(db, tahun);
  return insertTutupBukuSnapshot(db, {
    tahun,
    versi: versiSnapshotBerikutnya(db, tahun),
    ...angka,
    hash_jurnal,
    created_at: new Date().toISOString(),
  });
}
