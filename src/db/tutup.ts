// Adapter DB untuk tutup buku (P0-7, AKT-10).
//
// `tutup_buku` hanya menyimpan penanda tahun + created_at + catatan. Kolom
// legacy `backup_path` sudah dibuang oleh rebuild STRICT v23 (AUD2-09).
// Laba tidak pernah disimpan; preview/riwayat selalu menghitung ulang
// dari jurnal lewat mesin laporan (P0-5).
//
// AKT-10: sebelum mengizinkan tutup buku, jalankan audit integritas. Bila ada
// jurnal tidak seimbang/akun asing/kerusakan lain, operasi ditolak tanpa
// menulis apa pun.

import type Database from 'better-sqlite3';
import { buatAuditLog } from '../core/audit.js';
import {
  labaDitahan as labaDitahanJurnal,
  validasiTutupBuku,
  tahunTutupTerurut,
  type HasilValidasiTutup,
} from '../core/tutup.js';
import { labaTahun } from '../core/reports.js';
import { catatanTahunPertamaParsial } from '../core/pengaturan.js';
import type { TutupBuku } from '../core/types.js';
import { tanggalLokal } from '../utils/tanggal.js';
import type { Coa } from './coa.js';
import {
  auditIntegritas,
  type HasilAuditIntegritas,
  type Temuan,
} from './integritas.js';
import { listBarisJurnal } from './laporan.js';
import {
  getPengaturanPembukuan,
  insertAuditLog,
  insertTutupBuku,
  listAkun,
  listTutupBuku,
} from './repository.js';

export type TutupPreview = HasilValidasiTutup & {
  tahun: number;
  /** Laba tahun yang akan ditutup, dihitung dari jurnal. */
  laba: number;
  /** Akumulasi laba tahun-tahun yang sudah ditutup saat ini. */
  labaDitahanSekarang: number;
  /** Akumulasi laba ditahan bila tahun ini ikut ditutup. */
  labaDitahanSesudah: number;
  sudahDitutup: boolean;
  /** Temuan audit integritas; kosong berarti DB lolos audit. */
  temuanIntegritas: Temuan[];
  /** DB-38: catatan bila tahun ini adalah tahun pertama pembukuan parsial. */
  catatanTahunPertama?: string;
};

export type OpsiTutupBuku = {
  /** Catatan bebas untuk riwayat (boleh kosong). */
  catatan?: string;
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
  /** Temuan audit integritas; kosong berarti DB lolos audit. */
  temuanIntegritas: Temuan[];
  /** DB-38: catatan bila tahun ini adalah tahun pertama pembukuan parsial. */
  catatanTahunPertama?: string;
};

const hariIni = (): string => tanggalLokal();

/** Tahun-tahun yang memiliki jurnal (distinct), urut menaik. */
function bacaTahunAdaJurnal(db: Database.Database): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT substr(tanggal, 1, 4) AS tahun
       FROM jurnal
       ORDER BY tahun`,
    )
    .all() as { tahun: string }[];
  return rows
    .map((r) => Number(r.tahun))
    .filter((t) => Number.isInteger(t))
    .sort((a, b) => a - b);
}

/**
 * AUD2-06: panjar OPEN aktif (belum dipertanggungjawabkan & belum dibatalkan)
 * yang harus dicek sebelum tahun buku dikunci.
 */
function bacaPanjarOpenAktif(
  db: Database.Database,
): { id: string; tanggal: string; penerima: string }[] {
  return db
    .prepare(
      `SELECT id, tanggal, penerima
         FROM panjar
        WHERE status = 'OPEN'
          AND (jurnal_batal_id IS NULL OR jurnal_batal_id = '')
        ORDER BY tanggal, id`,
    )
    .all() as { id: string; tanggal: string; penerima: string }[];
}

/**
 * Gabungkan validasi tahun dengan audit integritas. Temuan apa pun membuat
 * tutup buku diblokir, termasuk tutup ulang; konfirmasi operator tidak boleh
 * melewati kerusakan data.
 */
function validasiDenganIntegritas(
  validasi: HasilValidasiTutup,
  audit: HasilAuditIntegritas,
): HasilValidasiTutup & { temuanIntegritas: Temuan[] } {
  if (audit.ok) return { ...validasi, temuanIntegritas: [] };

  return {
    ...validasi,
    boleh: false,
    perluKonfirmasi: false,
    errors: [
      ...validasi.errors,
      `Audit integritas akuntansi gagal. ${audit.ringkasan} Kunci periode diblokir sampai data diperbaiki.`,
      ...audit.temuan.map((t) => `[${t.kode}] ${t.pesan}`),
    ],
    temuanIntegritas: audit.temuan,
  };
}

function hitungLabaDitahan(
  baris: ReturnType<typeof listBarisJurnal>,
  daftar: ReadonlyArray<{ tahun: number }>,
  daftarAkun: readonly Coa[],
): number {
  return labaDitahanJurnal(
    baris,
    tahunTutupTerurut(daftar).map((tahun) => ({ tahun })),
    daftarAkun,
  );
}

/** DB-38: catatan tahun pertama parsial untuk tahun yang sedang dipreview. */
function catatanTahunPertama(
  db: Database.Database,
  tahun: number,
): string | undefined {
  if (!Number.isInteger(tahun)) return undefined;
  return (
    catatanTahunPertamaParsial(
      getPengaturanPembukuan(db).tanggalMulaiPembukuan,
      tahun,
    ) ?? undefined
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
  const tahunAdaJurnal = bacaTahunAdaJurnal(db);
  const panjarOpenTahun = bacaPanjarOpenAktif(db);
  const angka = Number(tahun);
  const validasi = validasiDenganIntegritas(
    validasiTutupBuku(angka, {
      sekarang,
      tutup: daftar,
      tahunAdaJurnal,
      panjarOpenTahun,
    }),
    auditIntegritas(db),
  );
  const baris = listBarisJurnal(db);
  const daftarAkun = listAkun(db);
  const laba = Number.isInteger(angka) ? labaTahun(baris, angka, daftarAkun) : 0;
  const sudahDitutup = daftar.some((t) => Number(t.tahun) === angka);

  const tahunSesudah = new Set(tahunTutupTerurut(daftar));
  if (Number.isInteger(angka)) tahunSesudah.add(angka);
  const catatanParsial = catatanTahunPertama(db, angka);

  return {
    ...validasi,
    tahun: angka,
    laba,
    labaDitahanSekarang: hitungLabaDitahan(baris, daftar, daftarAkun),
    labaDitahanSesudah: hitungLabaDitahan(
      baris,
      [...tahunSesudah].map((t) => ({ tahun: t })),
      daftarAkun,
    ),
    sudahDitutup,
    ...(catatanParsial ? { catatanTahunPertama: catatanParsial } : {}),
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
  const tahunAdaJurnal = bacaTahunAdaJurnal(db);
  const panjarOpenTahun = bacaPanjarOpenAktif(db);
  const angka = Number(tahun);
  const validasi = validasiDenganIntegritas(
    validasiTutupBuku(angka, {
      sekarang,
      tutup: daftar,
      tahunAdaJurnal,
      panjarOpenTahun,
      konfirmasiTimpak: opsi.konfirmasiTimpak === true,
    }),
    auditIntegritas(db),
  );
  const baris = listBarisJurnal(db);
  const daftarAkun = listAkun(db);
  const laba = Number.isInteger(angka) ? labaTahun(baris, angka, daftarAkun) : 0;
  const labaDitahanSekarang = hitungLabaDitahan(baris, daftar, daftarAkun);
  const catatanParsial = catatanTahunPertama(db, angka);

  if (!validasi.boleh) {
    return {
      ...validasi,
      tersimpan: false,
      laba,
      labaDitahan: labaDitahanSekarang,
      ...(catatanParsial ? { catatanTahunPertama: catatanParsial } : {}),
    };
  }

  const lama = daftar.find((t) => Number(t.tahun) === angka) ?? null;
  const catatan = String(opsi.catatan ?? '').trim();
  const data: TutupBuku = {
    tahun: angka,
    created_at: new Date().toISOString(),
    catatan,
  };
  const alasan =
    catatan ||
    (validasi.aksi === 'TUTUP-ULANG'
      ? `Kunci ulang tahun ${angka}`
      : `Kunci periode tahun ${angka}`);
  const audit = buatAuditLog(
    `${validasi.aksi} ${angka}`,
    alasan,
    lama ?? undefined,
    data,
    { ref_type: 'tutup_buku', ref_id: String(angka) },
  );

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
    labaDitahan: hitungLabaDitahan(baris, sesudah, daftarAkun),
    data,
    ...(catatanParsial ? { catatanTahunPertama: catatanParsial } : {}),
  };
}
