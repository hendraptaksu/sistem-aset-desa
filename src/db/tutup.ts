// Adapter DB untuk tutup buku (P0-7).
//
// `tutup_buku` hanya menyimpan penanda tahun + created_at + backup_path +
// catatan. Laba tidak pernah disimpan; preview/riwayat selalu menghitung ulang
// dari jurnal lewat mesin laporan (P0-5).

import type Database from 'better-sqlite3';
import { buatAuditLog } from '../core/ledger.js';
import {
  labaDitahan as labaDitahanJurnal,
  validasiTutupBuku,
  tahunTutupTerurut,
  type HasilValidasiTutup,
} from '../core/tutup.js';
import { labaTahun } from '../core/reports.js';
import type { TutupBuku } from '../core/types.js';
import { listBarisJurnal } from './laporan.js';
import { insertAuditLog, insertTutupBuku, listTutupBuku } from './repository.js';

export type TutupPreview = HasilValidasiTutup & {
  tahun: number;
  /** Laba tahun yang akan ditutup, dihitung dari jurnal. */
  laba: number;
  /** Akumulasi laba tahun-tahun yang sudah ditutup saat ini. */
  labaDitahanSekarang: number;
  /** Akumulasi laba ditahan bila tahun ini ikut ditutup. */
  labaDitahanSesudah: number;
  sudahDitutup: boolean;
};

export type OpsiTutupBuku = {
  /** Catatan bebas untuk riwayat (boleh kosong). */
  catatan?: string;
  /** Path backup yang dibuat wizard sebelum tutup buku. */
  backupPath?: string;
  /** Setuju menimpa tahun yang sudah pernah ditutup. */
  konfirmasiTimpak?: boolean;
  /** Tanggal acuan batas tahun; default hari ini. */
  sekarang?: string;
};

export type HasilTutupBuku = HasilValidasiTutup & {
  tersimpan: boolean;
  laba: number;
  labaDitahan: number;
  data?: TutupBuku;
};

const hariIni = (): string => new Date().toISOString().slice(0, 10);

function hitungLabaDitahan(
  baris: ReturnType<typeof listBarisJurnal>,
  daftar: ReadonlyArray<{ tahun: number }>,
): number {
  return labaDitahanJurnal(
    baris,
    tahunTutupTerurut(daftar).map((tahun) => ({ tahun })),
  );
}

/**
 * Pratinjau tutup buku tanpa menulis apa pun. Selalu mengembalikan hasil
 * validasi (bukan melempar error) agar UI bisa menampilkan pesan yang jelas.
 */
export function previewTutupBuku(
  db: Database.Database,
  tahun: number,
  sekarang = hariIni(),
): TutupPreview {
  const daftar = listTutupBuku(db);
  const angka = Number(tahun);
  const validasi = validasiTutupBuku(angka, { sekarang, tutup: daftar });
  const baris = listBarisJurnal(db);
  const laba = Number.isInteger(angka) ? labaTahun(baris, angka) : 0;
  const sudahDitutup = daftar.some((t) => Number(t.tahun) === angka);

  const tahunSesudah = new Set(tahunTutupTerurut(daftar));
  if (Number.isInteger(angka)) tahunSesudah.add(angka);

  return {
    ...validasi,
    tahun: angka,
    laba,
    labaDitahanSekarang: hitungLabaDitahan(baris, daftar),
    labaDitahanSesudah: hitungLabaDitahan(baris, [...tahunSesudah].map((t) => ({ tahun: t }))),
    sudahDitutup,
  };
}

/**
 * Tutup buku: validasi -> simpan penanda + audit, atomik.
 * Tidak menulis jurnal penutup dan tidak menyimpan angka laba.
 */
export function tutupBuku(
  db: Database.Database,
  tahun: number,
  opsi: OpsiTutupBuku = {},
): HasilTutupBuku {
  const sekarang = opsi.sekarang ?? hariIni();
  const daftar = listTutupBuku(db);
  const angka = Number(tahun);
  const validasi = validasiTutupBuku(angka, {
    sekarang,
    tutup: daftar,
    konfirmasiTimpak: opsi.konfirmasiTimpak === true,
  });
  const baris = listBarisJurnal(db);
  const laba = Number.isInteger(angka) ? labaTahun(baris, angka) : 0;
  const labaDitahanSekarang = hitungLabaDitahan(baris, daftar);

  if (!validasi.boleh) {
    return {
      ...validasi,
      tersimpan: false,
      laba,
      labaDitahan: labaDitahanSekarang,
    };
  }

  const lama = daftar.find((t) => Number(t.tahun) === angka) ?? null;
  const catatan = String(opsi.catatan ?? '').trim();
  const data: TutupBuku = {
    tahun: angka,
    created_at: new Date().toISOString(),
    backup_path: String(opsi.backupPath ?? ''),
    catatan,
  };
  const alasan =
    catatan ||
    (validasi.aksi === 'TUTUP-ULANG'
      ? `Tutup ulang tahun ${angka}`
      : `Tutup buku tahun ${angka}`);
  const audit = buatAuditLog(`${validasi.aksi} ${angka}`, alasan, {
    lama,
    baru: data,
  });

  const simpan = db.transaction(() => {
    insertTutupBuku(db, data);
    insertAuditLog(db, audit);
  });
  simpan();

  const sesudah = [...daftar.filter((t) => Number(t.tahun) !== angka), data];
  return {
    ...validasi,
    tersimpan: true,
    laba,
    labaDitahan: hitungLabaDitahan(baris, sesudah),
    data,
  };
}
