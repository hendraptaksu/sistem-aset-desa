// Tutup buku (P0-7) — fungsi murni, tanpa DB/Electron.
//
// Prinsip arah akuntansi §3: tutup buku HANYA penanda + kunci periode +
// catatan. Tidak ada angka laba yang disimpan sebagai sumber perhitungan.
// Laba tahun tutup dan laba ditahan selalu dihitung ulang dari jurnal.
//
// K2: hanya tahun yang sudah selesai (<= tahun lalu) yang boleh ditutup.

import { labaTahun, type BarisJurnalSumber } from './reports.js';
import { tahunLokal } from '../utils/tanggal.js';

export type TutupBukuRef = { tahun: number };

export type KonteksValidasiTutup = {
  /** Tanggal hari ini (YYYY-MM-DD); dipakai untuk batas tahun berjalan. */
  sekarang: string;
  /** Tahun-tahun yang sudah ditutup. */
  tutup: ReadonlyArray<TutupBukuRef>;
  /** Tahun-tahun yang memiliki jurnal, untuk cegah lompat tahun. */
  tahunAdaJurnal: ReadonlyArray<number>;
  /** Operator sudah menyetujui penimpaan tahun yang sudah ditutup. */
  konfirmasiTimpak?: boolean;
};

export type AksiTutup = 'TUTUP' | 'TUTUP-ULANG';

export type HasilValidasiTutup = {
  /** true bila boleh disimpan (termasuk tutup ulang yang sudah dikonfirmasi). */
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  /** true bila tahun sudah ditutup dan operator belum mengonfirmasi penimpaan. */
  perluKonfirmasi: boolean;
  aksi: AksiTutup;
  /** Tahun terakhir yang sudah ditutup (null = belum pernah). */
  tahunTerakhir: number | null;
  /** Tahun terbesar yang boleh ditutup saat ini (tahun lalu). */
  batasTahun: number;
};

const tahunDariTanggal = (tanggal: string, fallback: number): number => {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(tanggal ?? ''));
  const tahun = m ? Number(m[1]) : NaN;
  return Number.isInteger(tahun) ? tahun : fallback;
};

/** Daftar tahun tutup yang valid, unik, urut menaik. */
export function tahunTutupTerurut(tutup: ReadonlyArray<TutupBukuRef>): number[] {
  return [
    ...new Set(
      (tutup ?? [])
        .map((t) => Number(t.tahun))
        .filter((t) => Number.isInteger(t)),
    ),
  ].sort((a, b) => a - b);
}

/** Daftar tahun jurnal yang valid, unik, urut menaik. */
export function tahunJurnalTerurut(tahunAdaJurnal: ReadonlyArray<number>): number[] {
  return [
    ...new Set(
      (tahunAdaJurnal ?? [])
        .map((t) => Number(t))
        .filter((t) => Number.isInteger(t)),
    ),
  ].sort((a, b) => a - b);
}

/**
 * Validasi satu aksi tutup buku.
 *
 * Aturan:
 * 1. Tahun bilangan bulat yang masuk akal.
 * 2. Tahun <= tahun lalu (K2); tahun berjalan/berikutnya ditolak.
 * 3. Tahun baru harus lebih besar dari tahun tutup terakhir (urut menaik).
 * 4. Penutupan baru ditolak bila ada tahun lebih lama yang punya jurnal tetapi
 *    belum ditutup (AKT-12). Tahun tanpa jurnal boleh dilewati. Aturan ini
 *    tidak berlaku untuk tutup ulang tahun yang sudah ditutup.
 * 5. Tahun yang sudah ditutup boleh ditimpa, tetapi wajib konfirmasi
 *    (`aksi = TUTUP-ULANG`).
 */
export function validasiTutupBuku(
  tahun: number,
  ctx: KonteksValidasiTutup,
): HasilValidasiTutup {
  const tahunSekarang = tahunDariTanggal(ctx.sekarang, tahunLokal());
  const batasTahun = tahunSekarang - 1;
  const daftar = tahunTutupTerurut(ctx.tutup);
  const tahunTerakhir = daftar.length > 0 ? daftar[daftar.length - 1]! : null;

  const errors: string[] = [];
  const peringatan: string[] = [];
  const angka = Number(tahun);

  if (!Number.isInteger(angka)) {
    errors.push('Tahun kunci periode harus bilangan bulat.');
  } else if (angka < 1900 || angka > 9999) {
    errors.push('Tahun kunci periode tidak valid.');
  } else if (angka > batasTahun) {
    errors.push(
      `Kunci periode hanya untuk tahun yang sudah selesai (maksimal ${batasTahun}). Tahun ${angka} belum selesai.`,
    );
  }

  const sudahDitutup = Number.isInteger(angka) && daftar.includes(angka);
  const aksi: AksiTutup = sudahDitutup ? 'TUTUP-ULANG' : 'TUTUP';

  if (errors.length === 0) {
    if (sudahDitutup) {
      if (!ctx.konfirmasiTimpak) {
        peringatan.push(
          `Tahun ${angka} sudah pernah ditutup. Konfirmasi untuk menutup ulang dan memperbarui catatannya.`,
        );
      }
    } else if (tahunTerakhir !== null && angka < tahunTerakhir) {
      errors.push(
        `Kunci periode harus berurutan menaik. Tahun ${tahunTerakhir} sudah ditutup; tahun ${angka} sudah lewat.`,
      );
    } else {
      const belumDitutup = tahunJurnalTerurut(ctx.tahunAdaJurnal).filter(
        (t) => t < angka && !daftar.includes(t),
      );
      if (belumDitutup.length > 0) {
        const daftarTahun = belumDitutup.join(', ');
        errors.push(
          `Kunci periode harus berurutan. Tahun ${daftarTahun} memiliki jurnal tetapi belum ditutup; kunci tahun tersebut lebih dulu sebelum ${angka}.`,
        );
      }
    }
  }

  const perluKonfirmasi = errors.length === 0 && sudahDitutup && !ctx.konfirmasiTimpak;

  return {
    boleh: errors.length === 0 && !perluKonfirmasi,
    errors,
    peringatan,
    perluKonfirmasi,
    aksi,
    tahunTerakhir,
    batasTahun,
  };
}

/**
 * Laba ditahan = akumulasi laba tahun-tahun yang sudah ditutup, dihitung
 * ulang dari jurnal. Bukan angka tersimpan.
 */
export function labaDitahan(
  baris: readonly BarisJurnalSumber[],
  tutup: ReadonlyArray<TutupBukuRef>,
): number {
  return tahunTutupTerurut(tutup).reduce((total, tahun) => total + labaTahun(baris, tahun), 0);
}
