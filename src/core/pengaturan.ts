// Pengaturan pembukuan (P1-13) — model murni tanpa DB/Electron.
//
// Disimpan di tabel key-value `pengaturan` oleh repository. Modul ini hanya
// menormalkan & memvalidasi bentuk, plus helper tanggal tahun buku. Semua nilai
// default sengaja sama dengan kop lama agar export/test lama tidak berubah.

import { tanggalKalenderValid } from './posting.js';

export type PengaturanPembukuan = {
  /** Nama organisasi di kop semua laporan. */
  namaEntitas: string;
  /** Baris tambahan kop (alamat/keterangan), maks. 2 baris / 160 karakter. */
  kopTambahan: string;
  /** Tanggal mulai pembukuan YYYY-MM-DD; kosong = belum diisi. */
  tanggalMulaiPembukuan: string;
  /** Bulan awal tahun buku (1–12). */
  awalTahunBuku: number;
  /** Prefix nomor bukti, 1–8 huruf kapital/angka. */
  prefixNomorBukti: string;
  /** Jumlah digit urutan nomor bukti (3–6). */
  paddingNomorBukti: number;
};

/** Kop ringkas untuk builder XLSX/print; `tambahan` boleh kosong. */
export type KopOrganisasi = {
  nama: string;
  tambahan?: string;
};

export const DEFAULT_PENGATURAN: PengaturanPembukuan = {
  namaEntitas: 'PURA DALEM PURI PELIATAN',
  kopTambahan: '',
  tanggalMulaiPembukuan: '',
  awalTahunBuku: 1,
  prefixNomorBukti: 'JU',
  paddingNomorBukti: 4,
};

export const MAKS_NAMA_ENTITAS = 120;
export const MAKS_KOP_TAMBAHAN = 160;
export const MAKS_BARIS_KOP = 2;

function objek(nilai: unknown): nilai is Record<string, unknown> {
  return typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);
}

/** Ambil field kanonis atau alias (renderer lama/API baru). */
function ambil(input: Record<string, unknown>, ...kunci: string[]): unknown {
  for (const k of kunci) {
    if (input[k] !== undefined && input[k] !== null) return input[k];
  }
  return undefined;
}

function teksRapi(nilai: unknown): string {
  return String(nilai ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalisasi baris kop: CRLF → LF, spasi berlebih dirapikan, baris kosong
 * dibuang. Baris > 2 sengaja TIDAK dipotong agar validasi bisa menolaknya.
 */
export function normalisasiKopTambahan(nilai: unknown): string {
  return String(nilai ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((b) => b.replace(/[ \t]+/g, ' ').trim())
    .filter((b) => b.length > 0)
    .join('\n');
}

function angkaAtauBawaan(nilai: unknown, bawaan: number): number {
  if (nilai === undefined || nilai === null) return bawaan;
  if (typeof nilai === 'string' && nilai.trim() === '') return bawaan;
  return Number(nilai);
}

/**
 * Bentuk baku pengaturan dari input apa pun. Field yang hilang memakai default;
 * string di-trim, prefix diubah ke huruf kapital. Tidak melempar error —
 * pemanggil memakai `validasiPengaturan` untuk menolak nilai yang salah.
 */
export function normalisasiPengaturan(input: unknown): PengaturanPembukuan {
  const sumber = objek(input) ? input : {};

  const namaMentah = ambil(sumber, 'namaEntitas', 'nama_entitas', 'entitas');
  const kopMentah = ambil(sumber, 'kopTambahan', 'kop_tambahan');
  const tanggalMentah = ambil(
    sumber,
    'tanggalMulaiPembukuan',
    'tanggal_mulai_pembukuan',
    'tanggal_mulai',
  );
  const awalMentah = ambil(sumber, 'awalTahunBuku', 'awal_tahun_buku', 'awalBulan');
  const prefixMentah = ambil(
    sumber,
    'prefixNomorBukti',
    'prefix_nomor_bukti',
    'prefix_bukti',
    'prefix',
  );
  const paddingMentah = ambil(
    sumber,
    'paddingNomorBukti',
    'padding_nomor_bukti',
    'padding_bukti',
    'padding',
  );

  return {
    namaEntitas:
      namaMentah === undefined
        ? DEFAULT_PENGATURAN.namaEntitas
        : teksRapi(namaMentah),
    kopTambahan: kopMentah === undefined ? '' : normalisasiKopTambahan(kopMentah),
    tanggalMulaiPembukuan:
      tanggalMentah === undefined ? '' : String(tanggalMentah).trim(),
    awalTahunBuku: angkaAtauBawaan(awalMentah, DEFAULT_PENGATURAN.awalTahunBuku),
    prefixNomorBukti:
      prefixMentah === undefined
        ? DEFAULT_PENGATURAN.prefixNomorBukti
        : String(prefixMentah).trim().toUpperCase(),
    paddingNomorBukti: angkaAtauBawaan(
      paddingMentah,
      DEFAULT_PENGATURAN.paddingNomorBukti,
    ),
  };
}

/**
 * Validasi pengaturan pembukuan. Selalu menormalkan dulu agar pesan konsisten
 * (mis. prefix huruf kecil otomatis dianggap kapital). Return daftar pesan
 * bahasa Indonesia; array kosong = sah.
 */
export function validasiPengaturan(input: unknown): string[] {
  const p = normalisasiPengaturan(input);
  const errors: string[] = [];

  if (!p.namaEntitas) {
    errors.push('Nama entitas wajib diisi.');
  } else if (p.namaEntitas.length > MAKS_NAMA_ENTITAS) {
    errors.push(`Nama entitas maks. ${MAKS_NAMA_ENTITAS} karakter.`);
  }

  const barisKop = p.kopTambahan ? p.kopTambahan.split('\n') : [];
  if (barisKop.length > MAKS_BARIS_KOP) {
    errors.push(`Kop tambahan maks. ${MAKS_BARIS_KOP} baris.`);
  }
  if (p.kopTambahan.length > MAKS_KOP_TAMBAHAN) {
    errors.push(`Kop tambahan maks. ${MAKS_KOP_TAMBAHAN} karakter.`);
  }

  if (p.tanggalMulaiPembukuan && !tanggalKalenderValid(p.tanggalMulaiPembukuan)) {
    errors.push(
      'Tanggal mulai pembukuan tidak valid. Gunakan format YYYY-MM-DD dan tanggal yang benar.',
    );
  }

  if (
    !Number.isInteger(p.awalTahunBuku) ||
    p.awalTahunBuku < 1 ||
    p.awalTahunBuku > 12
  ) {
    errors.push('Awal tahun buku harus bulan 1–12.');
  }

  if (!/^[A-Z0-9]{1,8}$/.test(p.prefixNomorBukti)) {
    errors.push(
      'Prefix nomor bukti harus 1–8 huruf kapital atau angka (contoh: JU).',
    );
  }

  if (
    !Number.isInteger(p.paddingNomorBukti) ||
    p.paddingNomorBukti < 3 ||
    p.paddingNomorBukti > 6
  ) {
    errors.push('Jumlah digit nomor bukti harus bilangan bulat 3–6.');
  }

  return errors;
}

function duaDigit(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Rentang tahun buku untuk bulan awal tertentu.
 * Contoh awal Januari: 2026-01-01 s/d 2026-12-31.
 * Contoh awal Desember: 2026-12-01 s/d 2027-11-30 (lintas tahun).
 */
export function rentangTahunBuku(
  tahun: number,
  awalBulan: number,
): { mulai: string; sampai: string } {
  if (!Number.isInteger(tahun) || tahun < 1000 || tahun > 9999) {
    throw new Error('Tahun buku harus 4 digit (contoh: 2026).');
  }
  if (!Number.isInteger(awalBulan) || awalBulan < 1 || awalBulan > 12) {
    throw new Error('Awal tahun buku harus bulan 1–12.');
  }

  const mulai = `${tahun}-${duaDigit(awalBulan)}-01`;
  // Hari ke-0 dari bulan ke-(awalBulan + 12) = hari terakhir bulan ke-11
  // setelah awal tahun buku.
  const akhir = new Date(Date.UTC(tahun, awalBulan - 1 + 12, 0));
  const sampai = `${akhir.getUTCFullYear()}-${duaDigit(
    akhir.getUTCMonth() + 1,
  )}-${duaDigit(akhir.getUTCDate())}`;
  return { mulai, sampai };
}

/**
 * Tanggal mulai pembukuan yang dipakai sebagai batas bawah default filter/kop.
 * Bila belum diisi, pakai tanggal hari ini (bukan memaksa menolak jurnal lama).
 */
export function tanggalMulaiEfektif(
  pengaturan:
    | Pick<PengaturanPembukuan, 'tanggalMulaiPembukuan'>
    | string
    | null
    | undefined,
  hariIni = new Date().toISOString().slice(0, 10),
): string {
  const nilai =
    typeof pengaturan === 'string'
      ? pengaturan
      : pengaturan?.tanggalMulaiPembukuan;
  const teks = String(nilai ?? '').trim();
  return teks || hariIni;
}

/** Model pengaturan → kop builder XLSX/print. */
export function kopDariPengaturan(p: PengaturanPembukuan): KopOrganisasi {
  const nama = p.namaEntitas.trim() || DEFAULT_PENGATURAN.namaEntitas;
  const tambahan = normalisasiKopTambahan(p.kopTambahan);
  return { nama, ...(tambahan ? { tambahan } : {}) };
}
