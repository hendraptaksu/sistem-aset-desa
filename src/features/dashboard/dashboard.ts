// Dashboard akuntan (P1-14) — semua angka diturunkan dari baris jurnal.
//
// Builder ini MURNI (tanpa DB/Electron). Satu-satunya sumber angka adalah
// `src/core/reports.ts`: saldoSemuaKas/rincianKas, labaRugi, neracaSaldo,
// dan neraca. Tidak ada angka yang disimpan atau dihitung dengan rumus lain.
// Path backup terakhir sengaja TIDAK dicari di sini; main menempelkannya lewat
// `denganBackupTerakhir` karena hanya main yang tahu folder backup.

import { COA, LPD_KODES, type Coa } from '../../db/coa.js';
import { rentangTahunBuku } from '../../core/pengaturan.js';
import {
  labaRugi,
  namaAkun,
  neraca,
  neracaSaldo as hitungNeracaSaldo,
  rincianKas,
  saldoAkun,
  saldoSemuaKas,
  totalKas,
  type BarisJurnalSumber,
} from '../../core/reports.js';
import type { JurnalJenis } from '../../core/types.js';

export { LPD_KODES };

export type DashboardKasBank = {
  total: number;
  rincian: { kode: string; nama: string; saldo: number }[];
};

export type DashboardLabaRugi = {
  /** Tanggal awal rentang laba berjalan (mengikuti awal tahun buku). */
  mulai: string;
  /** Cut-off laporan (inklusif). */
  sampai: string;
  /** Tahun awal tahun buku yang dipakai (bisa tahun sebelumnya bila lintas tahun). */
  tahunBuku: number;
  awalTahunBuku: number;
  /** Label siap tampil, cth. "1 Jan 2026 – 23 Okt 2026". */
  labelPeriode: string;
  totalPendapatan: number;
  totalBeban: number;
  /** totalPendapatan − totalBeban; negatif = defisit. */
  laba: number;
  defisit: boolean;
  badge: 'SURPLUS' | 'DEFISIT';
};

export type DashboardNeracaSaldo = {
  totalDebit: number;
  totalKredit: number;
  selisih: number;
  seimbang: boolean;
};

export type DashboardPeriode = {
  tahunTerakhirDitutup: number | null;
  tahunTerkunci: number[];
  /** Tahun terbesar yang boleh ditutup (tahun lalu menurut tanggal acuan). */
  batasTahun: number;
  /** Tahun berjalan yang masih terbuka pada cut-off. */
  tahunBerjalan: number;
  /** cth. "2025 terkunci · 2026 terbuka". */
  status: string;
};

export type DashboardJurnalTerakhir = {
  id: string;
  tanggal: string;
  noBukti: string;
  keterangan: string;
  total: number;
  jenis: JurnalJenis | string;
};

export type DashboardHasil = {
  cutoff: string;

  kasBank: DashboardKasBank;
  labaRugiBerjalan: DashboardLabaRugi;
  neracaSaldo: DashboardNeracaSaldo;
  periode: DashboardPeriode;
  jurnalTerakhir: DashboardJurnalTerakhir | null;
  /** Path backup otomatis terakhir; diisi main, bukan builder murni. */
  backupTerakhir?: string;

  // ---- Field lama yang masih dipakai test/API lain (kompatibilitas) ----
  kasTunai: number;
  totalLpd: number;
  rincianLpd: Record<string, number>;
  aktiva: number;
  pasiva: number;
  selisih: number;
  balance: boolean;
  badge: string;
};

export type DashboardOpsi = {
  /** Bulan awal tahun buku 1–12 (dari pengaturan pembukuan). */
  awalTahunBuku?: number;
  /** Tanggal acuan batas tutup buku; default = cutoff (mudah diuji). */
  sekarang?: string;
  /** Master akun dari DB (termasuk akun tambahan); default COA statis. */
  daftarAkun?: readonly Coa[];
};

const NAMA_BULAN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

/** Label pendek tanggal ISO, cth. '2026-01-01' → '1 Jan 2026'. */
function labelTanggal(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const bulan = NAMA_BULAN[Number(m[2]) - 1] ?? m[2];
  return `${Number(m[3])} ${bulan} ${m[1]}`;
}

function bulanDalamTahun(iso: string): number {
  return Number(iso.slice(5, 7));
}

/**
 * Rentang laba tahun berjalan menurut awal tahun buku. Bila tahun buku mulai
 * Desember dan cut-off berada di Jan–Nov, tahun buku dimulai pada tahun
 * sebelumnya (cth. cut-off 2026-06-30 → 2025-12-01 s/d 2026-06-30).
 */
export function rentangLabaBerjalan(
  cutoff: string,
  awalTahunBuku = 1,
): { mulai: string; sampai: string; tahunBuku: number; awalTahunBuku: number; labelPeriode: string } {
  const tahunCutoff = Number(cutoff.slice(0, 4));
  if (!Number.isInteger(tahunCutoff)) {
    throw new Error('Tanggal cut-off dashboard tidak valid.');
  }
  const awal =
    Number.isInteger(awalTahunBuku) && awalTahunBuku >= 1 && awalTahunBuku <= 12
      ? awalTahunBuku
      : 1;
  const tahunBuku = bulanDalamTahun(cutoff) < awal ? tahunCutoff - 1 : tahunCutoff;
  const { mulai } = rentangTahunBuku(tahunBuku, awal);
  return {
    mulai,
    sampai: cutoff,
    tahunBuku,
    awalTahunBuku: awal,
    labelPeriode: `${labelTanggal(mulai)} – ${labelTanggal(cutoff)}`,
  };
}

type KelompokJurnal = {
  id: string;
  tanggal: string;
  noBukti: string;
  keterangan: string;
  jenis: JurnalJenis | string;
  total: number;
  /** Indeks baris terakhir dalam input; dipakai untuk urutan tanggal sama. */
  indeksTerakhir: number;
};

/**
 * Jurnal terbaru s/d cut-off. Baris jurnal dikelompokkan per jurnal; bila
 * tanggal sama, jurnal yang barisnya muncul terakhir di input dianggap paling
 * baru (sesuai urutan input DB). Baris tanpa id/no bukti dianggap jurnal
 * tersendiri agar data uji minimal tetap aman.
 */
export function jurnalTerakhirSampai(
  baris: readonly BarisJurnalSumber[],
  cutoff: string,
): DashboardJurnalTerakhir | null {
  const grup = new Map<string, KelompokJurnal>();
  baris.forEach((b, indeks) => {
    if (b.tanggal > cutoff) return;
    const kunci =
      b.jurnal_id?.trim() ||
      (b.no_bukti?.trim() ? `bukti:${b.no_bukti.trim()}` : `baris:${indeks}`);
    const ada = grup.get(kunci);
    if (ada) {
      ada.total += b.debit;
      ada.indeksTerakhir = indeks;
      if (!ada.keterangan && b.keterangan) ada.keterangan = b.keterangan;
      if (!ada.noBukti && b.no_bukti) ada.noBukti = b.no_bukti;
      if (!ada.jenis && b.jenis) ada.jenis = b.jenis;
      return;
    }
    grup.set(kunci, {
      id: b.jurnal_id?.trim() || kunci,
      tanggal: b.tanggal,
      noBukti: b.no_bukti ?? '',
      keterangan: b.keterangan ?? '',
      jenis: b.jenis ?? 'UMUM',
      total: b.debit,
      indeksTerakhir: indeks,
    });
  });

  let terbaik: KelompokJurnal | null = null;
  for (const g of grup.values()) {
    if (
      !terbaik ||
      g.tanggal > terbaik.tanggal ||
      (g.tanggal === terbaik.tanggal && g.indeksTerakhir > terbaik.indeksTerakhir)
    ) {
      terbaik = g;
    }
  }
  if (!terbaik) return null;
  return {
    id: terbaik.id,
    tanggal: terbaik.tanggal,
    noBukti: terbaik.noBukti,
    keterangan: terbaik.keterangan,
    total: terbaik.total,
    jenis: terbaik.jenis,
  };
}

function tahunTutupUnik(tutup: ReadonlyArray<{ tahun: number }>): number[] {
  return [
    ...new Set(
      tutup
        .map((t) => Number(t.tahun))
        .filter((t) => Number.isInteger(t)),
    ),
  ].sort((a, b) => a - b);
}

function susunPeriode(
  tutup: ReadonlyArray<{ tahun: number }>,
  cutoff: string,
  sekarang: string,
): DashboardPeriode {
  const tahunTerkunci = tahunTutupUnik(tutup);
  const tahunTerakhirDitutup =
    tahunTerkunci.length > 0 ? tahunTerkunci[tahunTerkunci.length - 1]! : null;
  const tahunBerjalan = Number(cutoff.slice(0, 4));
  const tahunAcuan = Number(sekarang.slice(0, 4));
  const batasTahun = (Number.isInteger(tahunAcuan) ? tahunAcuan : tahunBerjalan) - 1;
  const status =
    tahunTerkunci.length === 0
      ? `Belum ada periode terkunci · ${tahunBerjalan} terbuka`
      : `${tahunTerkunci.join(', ')} terkunci · ${tahunBerjalan} terbuka`;
  return {
    tahunTerakhirDitutup,
    tahunTerkunci,
    batasTahun,
    tahunBerjalan,
    status,
  };
}

/**
 * Dashboard akuntan dari jurnal. Backup terakhir tidak dihitung di sini;
 * gunakan `denganBackupTerakhir` di main setelah hasil builder dibuat.
 */
export function buildDashboardJurnal(
  baris: readonly BarisJurnalSumber[],
  tutup: readonly { tahun: number }[],
  cutoff: string,
  opsi: DashboardOpsi = {},
): DashboardHasil {
  const coa = opsi.daftarAkun ?? COA;
  const kasTunai = saldoAkun(baris, '1001', cutoff, coa);
  const lpd = saldoSemuaKas(baris, LPD_KODES, cutoff, coa);
  const totalLpd = Object.values(lpd).reduce((s, v) => s + v, 0);
  const totalKasBank = totalKas(baris, undefined, cutoff, coa);
  const rincian = rincianKas(baris, cutoff, coa);
  const kasBank: DashboardKasBank = {
    total: totalKasBank,
    rincian: Object.entries(rincian).map(([kode, saldo]) => ({
      kode,
      nama: namaAkun(kode, coa),
      saldo,
    })),
  };

  const rentang = rentangLabaBerjalan(cutoff, opsi.awalTahunBuku ?? 1);
  const lr = labaRugi(baris, { mulai: rentang.mulai, sampai: rentang.sampai }, coa);
  const labaRugiBerjalan: DashboardLabaRugi = {
    ...rentang,
    totalPendapatan: lr.totalPendapatan,
    totalBeban: lr.totalBeban,
    laba: lr.laba,
    defisit: lr.defisit,
    badge: lr.defisit ? 'DEFISIT' : 'SURPLUS',
  };

  const ns = hitungNeracaSaldo(baris, cutoff, coa);
  const neracaSaldo: DashboardNeracaSaldo = {
    totalDebit: ns.totalDebit,
    totalKredit: ns.totalKredit,
    selisih: ns.selisih,
    seimbang: ns.seimbang,
  };

  const n = neraca(baris, { cutoff, tutup }, coa);
  const periode = susunPeriode(tutup, cutoff, opsi.sekarang ?? cutoff);

  return {
    cutoff,
    kasBank,
    labaRugiBerjalan,
    neracaSaldo,
    periode,
    jurnalTerakhir: jurnalTerakhirSampai(baris, cutoff),
    kasTunai,
    totalLpd,
    rincianLpd: lpd,
    aktiva: n.totalAset,
    pasiva: n.totalPasiva,
    selisih: ns.selisih,
    balance: ns.seimbang,
    badge: ns.seimbang ? 'BALANCE' : `SELISIH ${ns.selisih}`,
  };
}

/**
 * Tempelkan path backup otomatis terakhir (dari main) ke hasil dashboard.
 * Dipisah agar builder murni tidak pernah menyentuh filesystem.
 */
export function denganBackupTerakhir(
  dashboard: DashboardHasil,
  path: string,
): DashboardHasil {
  return { ...dashboard, backupTerakhir: path };
}
