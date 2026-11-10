// Adapter DB untuk tutup buku (P0-7, AKT-10, T-A06).
//
// `tutup_buku` hanya menyimpan penanda tahun + created_at + catatan.
// Snapshot angka (laba + Neraca + hash jurnal) disimpan append-only di
// `tutup_buku_snapshot`: bukan sumber angka laporan, tetapi bukti angka yang
// disahkan saat tutup. Preview/riwayat tetap menghitung ulang dari jurnal untuk
// membandingkan snapshot dengan kondisi live.
//
// AKT-10: sebelum mengizinkan tutup buku, jalankan audit integritas. Temuan
// selain SNAPSHOT_TUTUP_BERUBAH menolak operasi tanpa menulis apa pun.
// SNAPSHOT_TUTUP_BERUBAH hanya peringatan kontrol agar TUTUP-ULANG yang
// dikonfirmasi tetap bisa mencatat snapshot versi baru.

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
import type { TutupBuku, TutupBukuSnapshot } from '../core/types.js';
import { tanggalLokal } from '../utils/tanggal.js';
import type { Coa } from './coa.js';
import {
  auditIntegritas,
  type HasilAuditIntegritas,
  type Temuan,
} from './integritas.js';
import { listBarisJurnal } from './laporan.js';
import { getCutoverTanggal } from './pembukaan.js';
import {
  insertAuditLog,
  insertTutupBuku,
  listAkun,
  listTutupBuku,
} from './repository.js';
import {
  bandingkanSnapshotTutup,
  buatSnapshotTutup,
  versiSnapshotBerikutnya,
} from './tutupSnapshot.js';

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
  /** T-A06: snapshot terbaru untuk tahun ini, bila sudah pernah ditutup. */
  snapshotTerbaru: TutupBukuSnapshot | null;
  /** T-A06: angka/hash live sudah berbeda dari snapshot terbaru. */
  snapshotBerubah: boolean;
  /** T-A06: rincian perbedaan snapshot vs live (kosong bila sama). */
  perbedaanSnapshot: string[];
  /** T-A06: versi snapshot yang akan ditulis bila tutup berhasil. */
  versiSnapshotBerikutnya: number;
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
  /** T-A06: snapshot yang baru ditulis saat tutup berhasil. */
  snapshot?: TutupBukuSnapshot;
  /** T-A06: status perbandingan setelah snapshot baru ditulis. */
  snapshotBerubah?: boolean;
  /** T-A06: rincian perbedaan snapshot vs live setelah penulisan. */
  perbedaanSnapshot?: string[];
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
 * Gabungkan validasi tahun dengan audit integritas. Temuan integritas selain
 * `SNAPSHOT_TUTUP_BERUBAH` memblokir tutup buku, termasuk tutup ulang.
 * `SNAPSHOT_TUTUP_BERUBAH` adalah temuan kontrol: tetap dilaporkan (UI wajib
 * menampilkan peringatan), tetapi tidak boleh memblokir TUTUP-ULANG yang sudah
 * dikonfirmasi. Penutupan pertama tidak terpengaruh karena snapshot belum ada.
 */
function validasiDenganIntegritas(
  validasi: HasilValidasiTutup,
  audit: HasilAuditIntegritas,
): HasilValidasiTutup & { temuanIntegritas: Temuan[] } {
  if (audit.ok) return { ...validasi, temuanIntegritas: [] };

  const temuanKontrol = audit.temuan.filter(
    (t) => t.kode === 'SNAPSHOT_TUTUP_BERUBAH',
  );
  const temuanMemblokir = audit.temuan.filter(
    (t) => t.kode !== 'SNAPSHOT_TUTUP_BERUBAH',
  );
  if (temuanMemblokir.length === 0) {
    return { ...validasi, temuanIntegritas: temuanKontrol };
  }

  return {
    ...validasi,
    boleh: false,
    perluKonfirmasi: false,
    errors: [
      ...validasi.errors,
      `Audit integritas akuntansi gagal. ${audit.ringkasan} Kunci periode diblokir sampai data diperbaiki.`,
      ...temuanMemblokir.map((t) => `[${t.kode}] ${t.pesan}`),
    ],
    temuanIntegritas: audit.temuan,
  };
}

function hitungLabaDitahan(
  baris: ReturnType<typeof listBarisJurnal>,
  daftar: ReadonlyArray<{ tahun: number }>,
  daftarAkun: readonly Coa[],
  cutover: string | null,
): number {
  return labaDitahanJurnal(
    baris,
    tahunTutupTerurut(daftar).map((tahun) => ({ tahun })),
    daftarAkun,
    cutover,
  );
}

/** DB-38: catatan tahun pertama parsial untuk tahun yang sedang dipreview. */
function catatanTahunPertama(
  db: Database.Database,
  tahun: number,
): string | undefined {
  if (!Number.isInteger(tahun)) return undefined;
  return (
    catatanTahunPertamaParsial(getCutoverTanggal(db), tahun) ?? undefined
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
  const cutover = getCutoverTanggal(db);
  const laba = Number.isInteger(angka)
    ? labaTahun(baris, angka, daftarAkun, cutover)
    : 0;
  const sudahDitutup = daftar.some((t) => Number(t.tahun) === angka);
  const perbandingan = Number.isInteger(angka)
    ? bandingkanSnapshotTutup(db, angka)
    : { snapshot: null, perbedaan: [], berubah: false };

  const tahunSesudah = new Set(tahunTutupTerurut(daftar));
  if (Number.isInteger(angka)) tahunSesudah.add(angka);
  const catatanParsial = catatanTahunPertama(db, angka);

  return {
    ...validasi,
    tahun: angka,
    laba,
    labaDitahanSekarang: hitungLabaDitahan(baris, daftar, daftarAkun, cutover),
    labaDitahanSesudah: hitungLabaDitahan(
      baris,
      [...tahunSesudah].map((t) => ({ tahun: t })),
      daftarAkun,
      cutover,
    ),
    sudahDitutup,
    snapshotTerbaru: perbandingan.snapshot,
    snapshotBerubah: perbandingan.berubah,
    perbedaanSnapshot: perbandingan.perbedaan,
    versiSnapshotBerikutnya: Number.isInteger(angka)
      ? versiSnapshotBerikutnya(db, angka)
      : 1,
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
  const cutover = getCutoverTanggal(db);
  const laba = Number.isInteger(angka)
    ? labaTahun(baris, angka, daftarAkun, cutover)
    : 0;
  const labaDitahanSekarang = hitungLabaDitahan(
    baris,
    daftar,
    daftarAkun,
    cutover,
  );
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
    const snapshot = buatSnapshotTutup(db, angka);
    insertAuditLog(db, audit);
    return snapshot;
  });
  const snapshot = simpan();

  const perbandinganSesudah = bandingkanSnapshotTutup(db, angka);
  const sesudah = [...daftar.filter((t) => Number(t.tahun) !== angka), data];
  return {
    ...validasi,
    tersimpan: true,
    laba,
    labaDitahan: hitungLabaDitahan(baris, sesudah, daftarAkun, cutover),
    data,
    snapshot,
    snapshotBerubah: perbandinganSesudah.berubah,
    perbedaanSnapshot: perbandinganSesudah.perbedaan,
    ...(catatanParsial ? { catatanTahunPertama: catatanParsial } : {}),
  };
}
