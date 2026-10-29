// Pagu anggaran & realisasi (P2-1) — fungsi murni, tanpa DB/Electron.
//
// Yang disimpan hanyalah PAGU per akun per tahun (tabel `anggaran`).
// Realisasi, sisa, dan persen TIDAK pernah disimpan: semuanya dihitung ulang
// dari baris jurnal lewat labaRugi()/saldoAkun() di core/reports.ts. Itulah
// sebabnya koreksi jurnal langsung mengubah laporan tanpa angka basi.
//
// Nominal selalu integer SEN. Hanya akun PENDAPATAN dan BEBAN yang boleh
// dianggarkan; akun aktiva/kewajiban/ekuitas tidak masuk laporan ini.

import { COA, type Coa } from '../db/coa.js';
import { labaRugi, type BarisJurnalSumber } from './reports.js';

export const PESAN_TAHUN_ANGGARAN =
  'Tahun anggaran harus bilangan bulat 2000–2100.';

/** Akun COA dari DB boleh membawa flag aktif; COA statis tidak. */
export type AkunAnggaran = Coa & { aktif?: boolean };

/** Satu baris pagu seperti yang disimpan/dikirim (tanpa metadata waktu). */
export type AnggaranBaris = {
  tahun: number;
  akun_kode: string;
  nominal: number;
};

/** Input minimal simpan pagu (tahun ada di request, bukan di tiap baris). */
export type AnggaranBarisInput = {
  akun_kode: string;
  nominal: number;
};

/** Tipe akun yang boleh dianggarkan. */
export type TipeAnggaran = 'PENDAPATAN' | 'BEBAN';

export type RealisasiAnggaranBaris = {
  kode: string;
  nama: string;
  tipe: TipeAnggaran;
  /** Pagu tersimpan (SEN); 0 = belum dianggarkan. */
  anggaran: number;
  /** Saldo akun dalam periode, positif = sesuai posisi normal (SEN). */
  realisasi: number;
  /** anggaran − realisasi; negatif = realisasi melebihi pagu. */
  sisa: number;
  /** realisasi / anggaran × 100; 0 bila pagu 0. */
  persen: number;
  /** true bila realisasi > anggaran (termasuk pagu 0 dengan realisasi > 0). */
  lebih: boolean;
};

export type TotalRealisasiAnggaran = {
  anggaran: number;
  realisasi: number;
  sisa: number;
  persen: number;
  lebih: boolean;
};

export type RealisasiAnggaranHasil = {
  mulai?: string;
  sampai?: string;
  pendapatan: RealisasiAnggaranBaris[];
  beban: RealisasiAnggaranBaris[];
  totalPendapatan: TotalRealisasiAnggaran;
  totalBeban: TotalRealisasiAnggaran;
  /** Gabungan pendapatan + beban. */
  total: TotalRealisasiAnggaran;
};

/** Validasi tahun anggaran; melempar Error berbahasa Indonesia. */
export function validasiTahunAnggaran(nilai: unknown): number {
  const tahun = typeof nilai === 'number' ? nilai : Number(nilai);
  if (!Number.isInteger(tahun) || tahun < 2000 || tahun > 2100) {
    throw new Error(PESAN_TAHUN_ANGGARAN);
  }
  return tahun;
}

function objek(nilai: unknown): nilai is Record<string, unknown> {
  return typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);
}

/** Opsi validasi pagu; `izinkanNonaktif` hanya untuk membaca pagu tersimpan. */
export type OpsiValidasiBarisAnggaran = {
  /**
   * Default false (input form): akun nonaktif ditolak.
   * true dipakai saat memuat pagu tersimpan di laporan: akun yang sudah
   * dinonaktifkan tetap harus menghasilkan laporan, selama kodenya masih
   * dikenal di COA, tipenya benar, dan nominalnya valid.
   */
  izinkanNonaktif?: boolean;
};

/**
 * Validasi semantik baris pagu:
 * - akun ada di master & aktif (kecuali `izinkanNonaktif` untuk pagu tersimpan);
 * - hanya akun PENDAPATAN/BEBAN;
 * - nominal integer SEN >= 0;
 * - akun tidak boleh duplikat dalam satu request.
 *
 * Mengembalikan baris yang sudah dinormalisasi (kode di-trim, urut kode).
 * Melempar Error berbahasa Indonesia bila ada yang tidak valid.
 */
export function validasiBarisAnggaran(
  baris: unknown,
  daftarAkun: readonly AkunAnggaran[] = COA,
  opsi: OpsiValidasiBarisAnggaran = {},
): AnggaranBarisInput[] {
  if (!Array.isArray(baris)) {
    throw new Error('Daftar pagu anggaran tidak lengkap.');
  }
  if (baris.length > 500) {
    throw new Error('Daftar pagu anggaran maksimal 500 akun.');
  }

  const petaAkun = new Map(daftarAkun.map((a) => [a.kode, a]));
  const terlihat = new Set<string>();
  const hasil: AnggaranBarisInput[] = [];

  baris.forEach((nilai, indeks) => {
    if (!objek(nilai)) {
      throw new Error(`Baris anggaran ke-${indeks + 1} tidak valid.`);
    }
    const kode = typeof nilai.akun_kode === 'string' ? nilai.akun_kode.trim() : '';
    if (!kode) {
      throw new Error(`Akun pada baris anggaran ke-${indeks + 1} wajib diisi.`);
    }
    if (terlihat.has(kode)) {
      throw new Error(`Akun ${kode} muncul lebih dari sekali dalam satu tahun.`);
    }
    terlihat.add(kode);

    const akun = petaAkun.get(kode);
    if (!akun) throw new Error(`Akun ${kode} tidak dikenal.`);
    if (opsi.izinkanNonaktif !== true && akun.aktif === false) {
      throw new Error(`Akun ${kode} tidak aktif.`);
    }
    if (akun.tipe !== 'PENDAPATAN' && akun.tipe !== 'BEBAN') {
      throw new Error(
        `Akun ${kode} bukan akun pendapatan/beban; anggaran hanya untuk pendapatan dan beban.`,
      );
    }

    const nominal = nilai.nominal;
    if (typeof nominal !== 'number' || !Number.isSafeInteger(nominal) || nominal < 0) {
      throw new Error(
        `Nominal anggaran akun ${kode} harus bilangan bulat ≥ 0 (satuan sen).`,
      );
    }

    hasil.push({ akun_kode: kode, nominal });
  });

  return hasil.sort((a, b) => a.akun_kode.localeCompare(b.akun_kode));
}

function totalDari(rows: readonly RealisasiAnggaranBaris[]): TotalRealisasiAnggaran {
  const anggaran = rows.reduce((s, r) => s + r.anggaran, 0);
  const realisasi = rows.reduce((s, r) => s + r.realisasi, 0);
  const sisa = anggaran - realisasi;
  return {
    anggaran,
    realisasi,
    sisa,
    persen: anggaran > 0 ? (realisasi / anggaran) * 100 : 0,
    lebih: realisasi > anggaran,
  };
}

/**
 * Hitung realisasi vs pagu untuk satu periode.
 *
 * Realisasi per akun diambil dari `labaRugi()` — bukan rumus baru — sehingga
 * total pendapatan/beban di layar ini selalu sama dengan layar Laba Rugi.
 * Akun PENDAPATAN/BEBAN yang belum punya pagu tetap ditampilkan dengan
 * anggaran 0 (supaya operator bisa melihat realisasi yang belum dianggarkan).
 */
export function hitungRealisasiAnggaran(
  anggaran: readonly AnggaranBaris[],
  barisJurnal: readonly BarisJurnalSumber[],
  rentang: { mulai?: string; sampai?: string } = {},
  daftarAkun: readonly AkunAnggaran[] = COA,
): RealisasiAnggaranHasil {
  const pagu = new Map(
    validasiBarisAnggaran(
      anggaran.map((a) => ({ akun_kode: a.akun_kode, nominal: a.nominal })),
      daftarAkun,
      // Pagu tersimpan tetap dibaca walau akunnya sudah dinonaktifkan.
      // Kode harus dikenal, tipe harus PENDAPATAN/BEBAN, nominal tetap valid.
      { izinkanNonaktif: true },
    ).map((a) => [a.akun_kode, a.nominal]),
  );

  const lr = labaRugi(barisJurnal, rentang, daftarAkun);

  const ubah = (b: { kode: string; nama: string; nominal: number }, tipe: TipeAnggaran) => {
    const nilaiPagu = pagu.get(b.kode) ?? 0;
    const realisasi = b.nominal;
    const sisa = nilaiPagu - realisasi;
    return {
      kode: b.kode,
      nama: b.nama,
      tipe,
      anggaran: nilaiPagu,
      realisasi,
      sisa,
      persen: nilaiPagu > 0 ? (realisasi / nilaiPagu) * 100 : 0,
      lebih: realisasi > nilaiPagu,
    } satisfies RealisasiAnggaranBaris;
  };

  const pendapatan = lr.pendapatan.map((b) => ubah(b, 'PENDAPATAN'));
  const beban = lr.beban.map((b) => ubah(b, 'BEBAN'));

  return {
    ...(rentang.mulai ? { mulai: rentang.mulai } : {}),
    ...(rentang.sampai ? { sampai: rentang.sampai } : {}),
    pendapatan,
    beban,
    totalPendapatan: totalDari(pendapatan),
    totalBeban: totalDari(beban),
    total: totalDari([...pendapatan, ...beban]),
  };
}
