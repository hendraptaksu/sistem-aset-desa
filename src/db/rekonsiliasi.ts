// Adapter DB rekonsiliasi bank (P2-2).
//
// Tabel `rekonsiliasi_bank` HANYA menyimpan saldo menurut rekening koran,
// catatan, dan status selesai. Saldo buku, selisih, status cocok, dan daftar
// mutasi selalu dihitung ulang dari jurnal lewat core/rekonsiliasi.ts dan
// core/reports.ts — tidak ada angka turunan yang disimpan.

import type Database from 'better-sqlite3';
import { catatAudit, listAkun } from './repository.js';
import { listBarisJurnal } from './laporan.js';
import { saldoAkun, type BarisJurnalSumber } from '../core/reports.js';
import {
  hitungRekonsiliasi,
  normalisasiRekonsiliasi,
  ringkasMutasiRekonsiliasi,
  type MutasiRekonsiliasiBaris,
  type StatusRekonsiliasi,
} from '../core/rekonsiliasi.js';

export type RekonsiliasiDb = {
  id: string;
  akun_kode: string;
  tanggal: string;
  saldo_bank: number;
  catatan: string;
  selesai: boolean;
  created_at: string;
  selesai_at: string | null;
};

/** Baris riwayat + angka turunan yang dihitung ulang dari jurnal. */
export type RekonsiliasiTampil = RekonsiliasiDb & {
  akun_nama: string;
  saldo_buku: number;
  selisih: number;
  status: StatusRekonsiliasi;
  cocok: boolean;
};

/** Detail satu rekonsiliasi + mutasi jurnal pada rentangnya. */
export type RekonsiliasiDetail = RekonsiliasiTampil & {
  /** Tanggal awal mutasi: sehari setelah rekonsiliasi selesai sebelumnya, atau 1 Jan tahun berjalan. */
  mulai: string;
  saldo_awal: number;
  mutasi: MutasiRekonsiliasiBaris[];
  total_debit: number;
  total_kredit: number;
  /** saldo_akhir − saldo_awal; selalu sama dengan mutasi bersih pada rentang. */
  total_mutasi: number;
  saldo_akhir: number;
};

export type FilterRekonsiliasi = {
  akun_kode?: string;
  selesai?: boolean;
};

export type OpsiSelesaikanRekonsiliasi = {
  /** Boleh diisi untuk menambah/mengganti catatan saat menandai selesai. */
  catatan?: string;
};

const rowToRekonsiliasi = (r: Record<string, unknown>): RekonsiliasiDb => ({
  id: String(r.id),
  akun_kode: String(r.akun_kode),
  tanggal: String(r.tanggal),
  saldo_bank: Number(r.saldo_bank),
  catatan: String(r.catatan ?? ''),
  selesai: Number(r.selesai) === 1,
  created_at: String(r.created_at),
  selesai_at:
    r.selesai_at === null || r.selesai_at === undefined ? null : String(r.selesai_at),
});

function tampil(
  row: RekonsiliasiDb,
  baris: readonly BarisJurnalSumber[],
  akunNama: string,
): RekonsiliasiTampil {
  const saldoBuku = saldoAkun(baris, row.akun_kode, row.tanggal);
  const hitung = hitungRekonsiliasi({
    saldoBank: row.saldo_bank,
    saldoBuku,
  });
  return {
    ...row,
    akun_nama: akunNama,
    saldo_buku: hitung.saldoBuku,
    selisih: hitung.selisih,
    status: hitung.status,
    cocok: hitung.cocok,
  };
}

function namaAkun(db: Database.Database, kode: string): string {
  return listAkun(db).find((a) => a.kode === kode)?.nama ?? kode;
}

/**
 * Riwayat rekonsiliasi, urut tanggal terbaru. `saldo_buku`/`selisih` dihitung
 * dari jurnal s/d tanggal rekonsiliasi masing-masing (bukan angka tersimpan).
 */
export function listRekonsiliasi(
  db: Database.Database,
  filter: FilterRekonsiliasi = {},
): RekonsiliasiTampil[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.akun_kode !== undefined) {
    const kode = String(filter.akun_kode).trim();
    if (kode) {
      where.push('akun_kode = ?');
      params.push(kode);
    }
  }
  if (filter.selesai !== undefined) {
    where.push('selesai = ?');
    params.push(filter.selesai ? 1 : 0);
  }

  const rows = db
    .prepare(
      `SELECT * FROM rekonsiliasi_bank
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY tanggal DESC, created_at DESC, rowid DESC`,
    )
    .all(...params) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const daftar = rows.map(rowToRekonsiliasi);
  // Ambil baris jurnal satu kali, dibatasi s/d tanggal rekonsiliasi terbaru.
  const sampai = daftar.reduce((maks, r) => (r.tanggal > maks ? r.tanggal : maks), '');
  const baris = listBarisJurnal(db, { sampai });
  const nama = new Map(listAkun(db).map((a) => [a.kode, a.nama]));
  return daftar.map((r) => tampil(r, baris, nama.get(r.akun_kode) ?? r.akun_kode));
}

function ambilSatuTampil(
  db: Database.Database,
  id: string,
): RekonsiliasiTampil | null {
  const raw = db.prepare('SELECT * FROM rekonsiliasi_bank WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!raw) return null;
  const row = rowToRekonsiliasi(raw);
  const baris = listBarisJurnal(db, { sampai: row.tanggal });
  return tampil(row, baris, namaAkun(db, row.akun_kode));
}

/**
 * Simpan satu rekonsiliasi baru (saldo rekening koran) + audit `REKONSILIASI`.
 * Validasi akun kas/bank & tanggal kalender memakai fungsi murni core.
 */
export function buatRekonsiliasi(
  db: Database.Database,
  input: unknown,
): RekonsiliasiTampil {
  const normal = normalisasiRekonsiliasi(input, listAkun(db));
  if (!normal.ok) throw new Error(normal.error);
  const { akun_kode, tanggal, saldo_bank, catatan } = normal.input;

  const row: RekonsiliasiDb = {
    id: `rek-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    akun_kode,
    tanggal,
    saldo_bank,
    catatan,
    selesai: false,
    created_at: new Date().toISOString(),
    selesai_at: null,
  };

  const simpan = db.transaction(() => {
    db.prepare(
      `INSERT INTO rekonsiliasi_bank
         (id, akun_kode, tanggal, saldo_bank, catatan, selesai, created_at, selesai_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.akun_kode,
      row.tanggal,
      row.saldo_bank,
      row.catatan,
      row.selesai ? 1 : 0,
      row.created_at,
      row.selesai_at,
    );
    catatAudit(db, {
      aksi: 'REKONSILIASI',
      alasan:
        row.catatan ||
        `Rekonsiliasi bank ${row.akun_kode} tanggal ${row.tanggal}`,
      baru: row,
    });
  });
  simpan();

  const hasil = ambilSatuTampil(db, row.id);
  if (!hasil) throw new Error('Rekonsiliasi gagal dibaca setelah disimpan.');
  return hasil;
}

/**
 * Tandai rekonsiliasi selesai + audit `REKONSILIASI-SELESAI` berisi kondisi
 * lama/baru. Rekonsiliasi yang sudah selesai ditolak dengan pesan jelas agar
 * tidak ada penandaan ganda yang membingungkan.
 */
export function selesaikanRekonsiliasi(
  db: Database.Database,
  idInput: unknown,
  opsi: OpsiSelesaikanRekonsiliasi = {},
): RekonsiliasiTampil {
  const id = typeof idInput === 'string' ? idInput.trim() : '';
  if (!id) throw new Error('Rekonsiliasi yang akan diselesaikan belum dipilih.');

  let catatanBaru: string | undefined;
  if (opsi.catatan !== undefined) {
    if (typeof opsi.catatan !== 'string')
      throw new Error('Catatan rekonsiliasi tidak valid.');
    catatanBaru = opsi.catatan.trim();
    if (catatanBaru.length > 1000)
      throw new Error('Catatan rekonsiliasi maks. 1000 karakter.');
  }

  const selesaikan = db.transaction(() => {
    const raw = db.prepare('SELECT * FROM rekonsiliasi_bank WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!raw) throw new Error('Rekonsiliasi tidak ditemukan.');
    const lama = rowToRekonsiliasi(raw);
    if (lama.selesai)
      throw new Error(
        `Rekonsiliasi tanggal ${lama.tanggal} sudah ditandai selesai. Tidak perlu ditandai lagi.`,
      );

    const baru: RekonsiliasiDb = {
      ...lama,
      catatan: catatanBaru === undefined ? lama.catatan : catatanBaru,
      selesai: true,
      selesai_at: new Date().toISOString(),
    };
    db.prepare(
      `UPDATE rekonsiliasi_bank
       SET catatan = ?, selesai = 1, selesai_at = ?
       WHERE id = ?`,
    ).run(baru.catatan, baru.selesai_at, baru.id);
    catatAudit(db, {
      aksi: 'REKONSILIASI-SELESAI',
      alasan:
        baru.catatan ||
        `Rekonsiliasi bank ${baru.akun_kode} tanggal ${baru.tanggal} selesai`,
      lama,
      baru,
    });
    return baru;
  });
  selesaikan();

  const hasil = ambilSatuTampil(db, id);
  if (!hasil) throw new Error('Rekonsiliasi gagal dibaca setelah diselesaikan.');
  return hasil;
}

/** '2026-01-31' → '2026-02-01' untuk awal rentang mutasi setelah rekonsiliasi sebelumnya. */
function hariSetelah(tanggal: string): string {
  const d = new Date(`${tanggal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Detail rekonsiliasi: data tersimpan + saldo buku saat tanggal itu + selisih
 * + mutasi jurnal akun sejak rekonsiliasi selesai sebelumnya (atau 1 Jan
 * tahun berjalan) s/d tanggal rekonsiliasi. Semua angka berasal dari jurnal.
 */
export function getRekonsiliasiDetail(
  db: Database.Database,
  idInput: unknown,
): RekonsiliasiDetail | null {
  const id = typeof idInput === 'string' ? idInput.trim() : '';
  if (!id) return null;

  const raw = db.prepare('SELECT * FROM rekonsiliasi_bank WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!raw) return null;
  const row = rowToRekonsiliasi(raw);

  const daftarAkun = listAkun(db);
  const akun = daftarAkun.find((a) => a.kode === row.akun_kode);
  if (!akun) throw new Error(`Akun ${row.akun_kode} tidak dikenal.`);

  const baris = listBarisJurnal(db, { sampai: row.tanggal });
  const dasar = tampil(row, baris, akun.nama);

  const sebelumnya = db
    .prepare(
      `SELECT tanggal FROM rekonsiliasi_bank
       WHERE akun_kode = ? AND selesai = 1 AND tanggal < ?
       ORDER BY tanggal DESC, created_at DESC, rowid DESC
       LIMIT 1`,
    )
    .get(row.akun_kode, row.tanggal) as { tanggal: string } | undefined;
  const mulai = sebelumnya
    ? hariSetelah(String(sebelumnya.tanggal))
    : `${row.tanggal.slice(0, 4)}-01-01`;

  const ringkas = ringkasMutasiRekonsiliasi(
    baris,
    row.akun_kode,
    { mulai, sampai: row.tanggal },
    daftarAkun,
  );

  return {
    ...dasar,
    mulai,
    saldo_awal: ringkas.saldoAwal,
    mutasi: ringkas.rows,
    total_debit: ringkas.totalDebit,
    total_kredit: ringkas.totalKredit,
    total_mutasi: ringkas.totalMutasi,
    saldo_akhir: ringkas.saldoAkhir,
  };
}

export type { StatusRekonsiliasi };
