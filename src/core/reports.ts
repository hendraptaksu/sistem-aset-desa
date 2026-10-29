// Mesin laporan double-entry (P0-5) — fungsi murni, tanpa DB/Electron.
//
// Satu-satunya sumber angka adalah baris jurnal (`jurnal_baris` + tanggal
// kepala jurnal). Tidak ada saldo/laba tersimpan: semua dihitung ulang setiap
// laporan dibuka. Itulah yang menjaga Neraca Saldo selalu nol walaupun ada
// koreksi setelah tutup buku.
//
// Input minimal satu baris: `{ tanggal, akun_kode, debit, kredit }`. Detail
// (jurnal_id, no_bukti, keterangan) opsional dan hanya dipakai untuk
// drill-down/tampilan. Nominal selalu integer SEN.

import {
  AKUN_HUTANG_USAHA,
  AKUN_PANJAR,
  AKUN_PIUTANG,
  COA,
  KAS_KODES,
  isAkunKas,
  type Coa,
  type PosisiNormal,
} from '../db/coa.js';
import type { JurnalJenis } from './types.js';

/** Baris jurnal datar (kepala + baris) yang dipakai semua laporan. */
export type BarisJurnalSumber = {
  jurnal_id?: string;
  baris_id?: number;
  tanggal: string; // YYYY-MM-DD
  no_bukti?: string;
  /** Keterangan kepala jurnal. */
  keterangan?: string;
  /** Keterangan baris (bila ada), lebih spesifik dari kepala. */
  keterangan_baris?: string;
  jenis?: JurnalJenis;
  grup_id?: string;
  reversal_of?: string | null;
  akun_kode: string;
  debit: number;
  kredit: number;
};

const petaAkun = (daftar: readonly Coa[]): Map<string, Coa> =>
  new Map(daftar.map((a) => [a.kode, a]));

function cariAkun(kode: string, daftar: readonly Coa[]): Coa {
  const a = daftar.find((x) => x.kode === kode);
  if (!a) throw new Error(`Akun ${kode} tidak dikenal di COA.`);
  return a;
}

function resolveAkun(akun: string | Coa, daftar: readonly Coa[]): Coa {
  return typeof akun === 'string' ? cariAkun(akun, daftar) : akun;
}

const dalamRentang = (tanggal: string, mulai?: string, sampai?: string): boolean =>
  (!mulai || tanggal >= mulai) && (!sampai || tanggal <= sampai);

/** Saldo bertanda normal: positif = sesuai posisi normal akun. */
function saldoNormal(
  baris: readonly BarisJurnalSumber[],
  akun: Coa,
  sampai?: string,
): number {
  let debit = 0;
  let kredit = 0;
  for (const b of baris) {
    if (b.akun_kode !== akun.kode) continue;
    if (sampai && b.tanggal > sampai) continue;
    debit += b.debit;
    kredit += b.kredit;
  }
  return akun.posisi_normal === 'DEBIT' ? debit - kredit : kredit - debit;
}

/**
 * Saldo satu akun s/d cut-off (inklusif), dalam posisi normal akun.
 * AKTIVA/BEBAN: debit − kredit. KEWAJIBAN/EKUITAS/PENDAPATAN: kredit − debit.
 * Contoh: saldo 2050 HUTANG Rp 2.000.000 → 200_000_000 (sen), bukan negatif.
 */
export function saldoAkun(
  baris: readonly BarisJurnalSumber[],
  akun: string | Coa,
  sampai?: string,
  daftarAkun: readonly Coa[] = COA,
): number {
  return saldoNormal(baris, resolveAkun(akun, daftarAkun), sampai);
}

/** Saldo semua dompet kas/bank s/d cut-off, per kode akun. */
export function saldoSemuaKas(
  baris: readonly BarisJurnalSumber[],
  kasKodes: readonly string[] = KAS_KODES,
  sampai?: string,
  daftarAkun: readonly Coa[] = COA,
): Record<string, number> {
  const peta = petaAkun(daftarAkun);
  const hasil: Record<string, number> = {};
  for (const kode of kasKodes) {
    const a = peta.get(kode);
    hasil[kode] = a ? saldoNormal(baris, a, sampai) : 0;
  }
  return hasil;
}

/** Total saldo semua dompet kas/bank s/d cut-off. */
export function totalKas(
  baris: readonly BarisJurnalSumber[],
  kasKodes: readonly string[] = KAS_KODES,
  sampai?: string,
  daftarAkun: readonly Coa[] = COA,
): number {
  return Object.values(saldoSemuaKas(baris, kasKodes, sampai, daftarAkun)).reduce(
    (s, v) => s + v,
    0,
  );
}

// ---------------------------------------------------------------------------
// Buku Besar
// ---------------------------------------------------------------------------

export type BukuBesarOpsi = {
  mulai?: string;
  sampai?: string;
};

export type BukuBesarBaris = {
  jurnal_id: string;
  baris_id: number | null;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  debit: number;
  kredit: number;
  /** Saldo berjalan, positif = posisi normal akun. */
  saldo: number;
  /** Sisi saldo berjalan (null bila nol). */
  posisi: PosisiNormal | null;
};

export type BukuBesarHasil = {
  kode: string;
  nama: string;
  tipe: Coa['tipe'];
  posisi_normal: PosisiNormal;
  mulai?: string;
  sampai?: string;
  saldoAwal: number;
  rows: BukuBesarBaris[];
  totalDebit: number;
  totalKredit: number;
  saldoAkhir: number;
};

/**
 * Buku Besar satu akun. `saldoAwal` = akumulasi sebelum `mulai`; baris mutasi
 * dalam rentang menampilkan saldo berjalan; `saldoAkhir` = saldo s/d `sampai`
 * dan harus sama dengan `saldoAkun(..., sampai)`.
 */
export function bukuBesar(
  baris: readonly BarisJurnalSumber[],
  akun: string | Coa,
  opsi: BukuBesarOpsi = {},
  daftarAkun: readonly Coa[] = COA,
): BukuBesarHasil {
  const a = resolveAkun(akun, daftarAkun);
  const { mulai, sampai } = opsi;
  const arah = a.posisi_normal === 'DEBIT' ? 1 : -1;
  const saldoAwal = mulai ? saldoNormal(baris, a, hariSebelum(mulai)) : 0;

  const dipilih = baris
    .map((b, urutan) => ({ b, urutan }))
    .filter(({ b }) => b.akun_kode === a.kode && dalamRentang(b.tanggal, mulai, sampai))
    // Sort stabil: tanggal, lalu urutan input (tanggal sama tetap sesuai jurnal).
    .sort((x, y) =>
      x.b.tanggal < y.b.tanggal ? -1 : x.b.tanggal > y.b.tanggal ? 1 : x.urutan - y.urutan,
    );

  let saldo = saldoAwal;
  let totalDebit = 0;
  let totalKredit = 0;
  const rows: BukuBesarBaris[] = dipilih.map(({ b }) => {
    totalDebit += b.debit;
    totalKredit += b.kredit;
    saldo += (b.debit - b.kredit) * arah;
    const posisi: PosisiNormal | null =
      saldo === 0 ? null : saldo > 0 ? a.posisi_normal : lawan(a.posisi_normal);
    return {
      jurnal_id: b.jurnal_id ?? '',
      baris_id: b.baris_id ?? null,
      tanggal: b.tanggal,
      no_bukti: b.no_bukti ?? '',
      keterangan: b.keterangan_baris || b.keterangan || '',
      debit: b.debit,
      kredit: b.kredit,
      saldo,
      posisi,
    };
  });

  return {
    kode: a.kode,
    nama: a.nama,
    tipe: a.tipe,
    posisi_normal: a.posisi_normal,
    mulai,
    sampai,
    saldoAwal,
    rows,
    totalDebit,
    totalKredit,
    saldoAkhir: saldo,
  };
}

const lawan = (p: PosisiNormal): PosisiNormal => (p === 'DEBIT' ? 'KREDIT' : 'DEBIT');

/** '2026-01-01' → '2025-12-31' (aman untuk filter string YYYY-MM-DD). */
function hariSebelum(tanggal: string): string {
  const d = new Date(`${tanggal}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Neraca Saldo
// ---------------------------------------------------------------------------

export type NeracaSaldoOpsi = {
  cutoff?: string;
  /** true = hanya akun yang saldonya tidak nol (default semua akun COA). */
  hanyaAdaSaldo?: boolean;
};

export type NeracaSaldoBaris = {
  kode: string;
  nama: string;
  tipe: Coa['tipe'];
  posisi_normal: PosisiNormal;
  /** Saldo akhir dalam posisi normal akun (selalu positif bila sesuai sisi). */
  saldo: number;
  /** Kolom debit neraca saldo (saldo mentah debit > 0). */
  debit: number;
  /** Kolom kredit neraca saldo (saldo mentah kredit > 0). */
  kredit: number;
  /** Ada minimal satu baris jurnal akun ini s/d cutoff (walau neto nol). */
  adaMutasi: boolean;
};

export type NeracaSaldoHasil = {
  cutoff?: string;
  rows: NeracaSaldoBaris[];
  totalDebit: number;
  totalKredit: number;
  /** totalDebit − totalKredit; wajib 0 untuk jurnal yang seimbang. */
  selisih: number;
  seimbang: boolean;
};

/**
 * Neraca Saldo s/d cutoff. Kolom debit/kredit diisi dari saldo mentah
 * (debit − kredit); total keduanya wajib sama. `selisih` diekspos agar UI
 * bisa menampilkan badge "seimbang/selisih" tanpa menghitung ulang.
 */
export function neracaSaldo(
  baris: readonly BarisJurnalSumber[],
  cutoffAtauOpsi: string | NeracaSaldoOpsi = {},
  daftarAkun: readonly Coa[] = COA,
): NeracaSaldoHasil {
  const opsi: NeracaSaldoOpsi =
    typeof cutoffAtauOpsi === 'string' ? { cutoff: cutoffAtauOpsi } : cutoffAtauOpsi;
  const { cutoff, hanyaAdaSaldo = false } = opsi;

  const debitMentah = new Map<string, number>();
  const kreditMentah = new Map<string, number>();
  const adaMutasi = new Set<string>();
  for (const b of baris) {
    if (cutoff && b.tanggal > cutoff) continue;
    debitMentah.set(b.akun_kode, (debitMentah.get(b.akun_kode) ?? 0) + b.debit);
    kreditMentah.set(b.akun_kode, (kreditMentah.get(b.akun_kode) ?? 0) + b.kredit);
    adaMutasi.add(b.akun_kode);
  }

  const rows: NeracaSaldoBaris[] = [];
  for (const a of [...daftarAkun].sort((x, y) => x.kode.localeCompare(y.kode))) {
    const debit = debitMentah.get(a.kode) ?? 0;
    const kredit = kreditMentah.get(a.kode) ?? 0;
    const mentah = debit - kredit;
    // Saldo normal = mentah untuk akun normal debit, dibalik untuk normal kredit.
    const saldo = a.posisi_normal === 'DEBIT' ? mentah : -mentah;
    if (hanyaAdaSaldo && saldo === 0) continue;
    rows.push({
      kode: a.kode,
      nama: a.nama,
      tipe: a.tipe,
      posisi_normal: a.posisi_normal,
      saldo,
      debit: mentah > 0 ? mentah : 0,
      kredit: mentah < 0 ? -mentah : 0,
      adaMutasi: adaMutasi.has(a.kode),
    });
  }

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalKredit = rows.reduce((s, r) => s + r.kredit, 0);
  const selisih = totalDebit - totalKredit;
  return { cutoff, rows, totalDebit, totalKredit, selisih, seimbang: selisih === 0 };
}

// ---------------------------------------------------------------------------
// Neraca Saldo per tahun buku
// ---------------------------------------------------------------------------

export const NAMA_LABA_DITAHAN_SEBELUM_PERIODE = 'Laba ditahan sebelum periode';

export type NeracaSaldoPeriodeOpsi = {
  /** Awal periode inklusif (YYYY-MM-DD), biasanya 1 Januari. */
  mulai: string;
  /** Akhir periode inklusif (YYYY-MM-DD). */
  sampai: string;
  /** true = hanya akun yang saldonya tidak nol (default semua akun COA). */
  hanyaAdaSaldo?: boolean;
  /** Master COA; default COA bawaan. */
  daftarAkun?: readonly Coa[];
};

/** Baris Neraca Saldo periode; `sintetis` menandai laba ditahan non-akun COA. */
export type NeracaSaldoPeriodeBaris = NeracaSaldoBaris & {
  /** true = baris sintetis "Laba ditahan sebelum periode", bukan akun COA. */
  sintetis: boolean;
};

export type NeracaSaldoPeriodeHasil = {
  mulai: string;
  sampai: string;
  rows: NeracaSaldoPeriodeBaris[];
  totalDebit: number;
  totalKredit: number;
  /** totalDebit − totalKredit; wajib 0 untuk jurnal yang seimbang. */
  selisih: number;
  seimbang: boolean;
  /**
   * Laba bersih sebelum `mulai` yang menjadi baris sintetis
   * "Laba ditahan sebelum periode". Positif = laba (kredit), negatif = defisit
   * (debit). Nol bila tidak ada P&L sebelum periode.
   */
  labaDitahanSebelumPeriode: number;
  /** Laba bersih PENDAPATAN − BEBAN dalam `mulai..sampai`. Negatif = defisit. */
  labaPeriode: number;
  /** Total pendapatan hanya dalam `mulai..sampai`. */
  totalPendapatan: number;
  /** Total beban hanya dalam `mulai..sampai`. */
  totalBeban: number;
};

/** Mode tampilan/export Neraca Saldo (AUD-21b). */
export type ModeNeracaSaldo = 'tahun' | 'kumulatif';

/**
 * Hasil Neraca Saldo untuk UI/export.
 *
 * `mode` wajib ada pada hasil baru. Mode kumulatif opsional agar hasil
 * `neracaSaldo()` lama (tanpa mode) tetap bisa dipakai builder export.
 */
export type NeracaSaldoModeHasil =
  | (NeracaSaldoHasil & { mode?: 'kumulatif' })
  | (NeracaSaldoPeriodeHasil & { mode: 'tahun' });

/**
 * Neraca Saldo untuk satu tahun buku/periode.
 *
 * - AKTIVA/KEWAJIBAN/EKUITAS: saldo kumulatif s/d `sampai`.
 * - PENDAPATAN/BEBAN: hanya mutasi `mulai..sampai`, sehingga laba tahun lalu
 *   tidak muncul lagi sebagai pendapatan/beban tahun berjalan.
 * - Laba bersih sebelum `mulai` ditaruh di satu baris sintetis
 *   "Laba ditahan sebelum periode" (kredit bila laba, debit bila defisit),
 *   agar total debit = total kredit tanpa mengubah baris jurnal.
 *
 * Asumsi: belum ada jurnal penutup manual ke akun ekuitas 3000/3001/3002.
 * Bila nanti tutup buku memposting laba ke akun ekuitas tersebut, laba yang
 * sudah dipindah harus dikeluarkan dari baris sintetis agar tidak dobel.
 * Fungsi ini murni: tidak membaca/menulis angka tersimpan.
 */
export function neracaSaldoPeriode(
  baris: readonly BarisJurnalSumber[],
  opsi: NeracaSaldoPeriodeOpsi,
): NeracaSaldoPeriodeHasil {
  const { mulai, sampai, hanyaAdaSaldo = false, daftarAkun = COA } = opsi;
  if (!mulai || !sampai) {
    throw new Error('Neraca Saldo periode membutuhkan tanggal mulai dan sampai.');
  }
  if (mulai > sampai) {
    throw new Error(`Rentang periode tidak valid: ${mulai} > ${sampai}.`);
  }

  const peta = petaAkun(daftarAkun);
  // Akun asing tidak boleh diabaikan diam-diam: total bisa tampak seimbang
  // padahal ada saldo yang tidak masuk laporan (sama seperti neraca()).
  for (const b of baris) {
    if (b.tanggal > sampai) continue;
    if (!peta.has(b.akun_kode)) {
      throw new Error(`Akun ${b.akun_kode} pada jurnal tidak dikenal di COA.`);
    }
  }

  const debit = new Map<string, number>();
  const kredit = new Map<string, number>();
  const adaMutasi = new Set<string>();
  for (const b of baris) {
    if (b.tanggal > sampai) continue;
    const a = peta.get(b.akun_kode)!;
    // Akun P&L hanya periode berjalan; saldo P&L lama sudah diwakili baris
    // sintetis laba ditahan. Akun neraca tetap kumulatif.
    if ((a.tipe === 'PENDAPATAN' || a.tipe === 'BEBAN') && b.tanggal < mulai) continue;
    debit.set(b.akun_kode, (debit.get(b.akun_kode) ?? 0) + b.debit);
    kredit.set(b.akun_kode, (kredit.get(b.akun_kode) ?? 0) + b.kredit);
    adaMutasi.add(b.akun_kode);
  }

  const rows: NeracaSaldoPeriodeBaris[] = [];
  let totalPendapatan = 0;
  let totalBeban = 0;
  for (const a of [...daftarAkun].sort((x, y) => x.kode.localeCompare(y.kode))) {
    const d = debit.get(a.kode) ?? 0;
    const k = kredit.get(a.kode) ?? 0;
    const mentah = d - k;
    // Saldo normal = mentah untuk akun normal debit, dibalik untuk normal kredit.
    // Normalisasi -0 → 0 agar hasil aman dibandingkan/diserialisasi UI.
    const saldo = mentah === 0 ? 0 : a.posisi_normal === 'DEBIT' ? mentah : -mentah;
    if (a.tipe === 'PENDAPATAN') totalPendapatan += saldo;
    else if (a.tipe === 'BEBAN') totalBeban += saldo;
    if (hanyaAdaSaldo && saldo === 0) continue;
    rows.push({
      kode: a.kode,
      nama: a.nama,
      tipe: a.tipe,
      posisi_normal: a.posisi_normal,
      saldo,
      debit: mentah > 0 ? mentah : 0,
      kredit: mentah < 0 ? -mentah : 0,
      adaMutasi: adaMutasi.has(a.kode),
      sintetis: false,
    });
  }

  const labaDitahanSebelumPeriode = labaRugi(
    baris,
    { sampai: hariSebelum(mulai) },
    daftarAkun,
  ).laba;
  if (labaDitahanSebelumPeriode !== 0) {
    const laba = labaDitahanSebelumPeriode;
    const sintetis: NeracaSaldoPeriodeBaris = {
      kode: '',
      nama: NAMA_LABA_DITAHAN_SEBELUM_PERIODE,
      tipe: 'EKUITAS',
      posisi_normal: 'KREDIT',
      saldo: laba,
      debit: laba < 0 ? -laba : 0,
      kredit: laba > 0 ? laba : 0,
      adaMutasi: true,
      sintetis: true,
    };
    // Tempatkan di bagian ekuitas, tepat sebelum akun PENDAPATAN/BEBAN pertama.
    // Bila semua baris P&L tersaring (hanyaAdaSaldo), taruh di akhir.
    const indexPnl = rows.findIndex(
      (r) => r.tipe === 'PENDAPATAN' || r.tipe === 'BEBAN',
    );
    if (indexPnl === -1) rows.push(sintetis);
    else rows.splice(indexPnl, 0, sintetis);
  }

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalKredit = rows.reduce((s, r) => s + r.kredit, 0);
  const selisih = totalDebit - totalKredit;
  return {
    mulai,
    sampai,
    rows,
    totalDebit,
    totalKredit,
    selisih,
    seimbang: selisih === 0,
    labaDitahanSebelumPeriode,
    labaPeriode: totalPendapatan - totalBeban,
    totalPendapatan,
    totalBeban,
  };
}

// ---------------------------------------------------------------------------
// Laba Rugi
// ---------------------------------------------------------------------------

export type RentangLaporan = {
  mulai?: string;
  sampai?: string;
};

export type LabaRugiBaris = {
  kode: string;
  nama: string;
  /** Positif = menambah laba (pendapatan) / mengurangi laba (beban). */
  nominal: number;
};

export type LabaRugiHasil = {
  mulai?: string;
  sampai?: string;
  pendapatan: LabaRugiBaris[];
  beban: LabaRugiBaris[];
  totalPendapatan: number;
  totalBeban: number;
  /** Pendapatan − Beban. Negatif = defisit. */
  laba: number;
  labaBersih: number;
  defisit: boolean;
};

/**
 * Laba Rugi periode. Hanya akun PENDAPATAN dan BEBAN yang dihitung;
 * akun aktiva/kewajiban/ekuitas tidak pernah masuk laba.
 */
export function labaRugi(
  baris: readonly BarisJurnalSumber[],
  rentang: RentangLaporan = {},
  daftarAkun: readonly Coa[] = COA,
): LabaRugiHasil {
  const { mulai, sampai } = rentang;
  const pendapatan: LabaRugiBaris[] = [];
  const beban: LabaRugiBaris[] = [];
  let totalPendapatan = 0;
  let totalBeban = 0;

  for (const a of [...daftarAkun].sort((x, y) => x.kode.localeCompare(y.kode))) {
    if (a.tipe !== 'PENDAPATAN' && a.tipe !== 'BEBAN') continue;
    const nominal = saldoNormal(
      baris.filter((b) => dalamRentang(b.tanggal, mulai, sampai)),
      a,
    );
    if (a.tipe === 'PENDAPATAN') {
      pendapatan.push({ kode: a.kode, nama: a.nama, nominal });
      totalPendapatan += nominal;
    } else {
      beban.push({ kode: a.kode, nama: a.nama, nominal });
      totalBeban += nominal;
    }
  }

  const laba = totalPendapatan - totalBeban;
  return {
    mulai,
    sampai,
    pendapatan,
    beban,
    totalPendapatan,
    totalBeban,
    laba,
    labaBersih: laba,
    defisit: laba < 0,
  };
}

/** Laba satu tahun kalender (1 Jan – 31 Des), dari jurnal. */
export function labaTahun(
  baris: readonly BarisJurnalSumber[],
  tahun: number,
  daftarAkun: readonly Coa[] = COA,
): number {
  return labaRugi(
    baris,
    { mulai: `${tahun}-01-01`, sampai: `${tahun}-12-31` },
    daftarAkun,
  ).laba;
}

// ---------------------------------------------------------------------------
// Neraca
// ---------------------------------------------------------------------------

export type NeracaOpsi = {
  cutoff: string;
  /**
   * Tahun yang sudah ditutup (P0-7). Bila diberikan, laba tahun-tahun
   * tersebut masuk `labaDitahan`; tahun lampau yang belum ditutup tetap
   * dihitung dan ditaruh di `labaBelumDitutup` agar Neraca tidak selisih.
   * Bila tidak diberikan, seluruh laba tahun lampau dianggap laba ditahan
   * (turunan dari jurnal, bukan angka tersimpan).
   */
  tutup?: ReadonlyArray<{ tahun: number }>;
};

export type NeracaBaris = {
  kode: string;
  nama: string;
  saldo: number;
};

export type NeracaHasil = {
  cutoff: string;
  aset: NeracaBaris[];
  kewajiban: NeracaBaris[];
  /** Saldo akun ekuitas (3000/3001/3002/...). */
  ekuitas: NeracaBaris[];
  totalAset: number;
  totalKewajiban: number;
  totalEkuitasAkun: number;
  /** Laba tahun-tahun yang sudah tutup (atau seluruh tahun lampau bila `tutup` tidak diberikan). */
  labaDitahan: number;
  /** Laba tahun lampau yang belum ditutup (hanya bila `tutup` diberikan). */
  labaBelumDitutup: number;
  /** Laba 1 Jan tahun cutoff s/d cutoff. */
  labaBerjalan: number;
  totalEkuitas: number;
  totalPasiva: number;
  selisih: number;
  balance: boolean;
  /** Alias istilah lama agar pemanggil UI lama tetap kompatibel. */
  aktiva: number;
  pasiva: number;
};

/**
 * Neraca per cutoff. Aset = Kewajiban + Ekuitas, dengan laba berjalan dan
 * laba ditahan dihitung dari jurnal (tidak ada angka laba tersimpan).
 */
export function neraca(
  baris: readonly BarisJurnalSumber[],
  cutoffAtauOpsi: string | NeracaOpsi,
  daftarAkun: readonly Coa[] = COA,
): NeracaHasil {
  const opsi: NeracaOpsi =
    typeof cutoffAtauOpsi === 'string' ? { cutoff: cutoffAtauOpsi } : cutoffAtauOpsi;
  const { cutoff, tutup } = opsi;
  const peta = petaAkun(daftarAkun);

  const aset: NeracaBaris[] = [];
  const kewajiban: NeracaBaris[] = [];
  const ekuitas: NeracaBaris[] = [];
  let totalAset = 0;
  let totalKewajiban = 0;
  let totalEkuitasAkun = 0;

  for (const a of [...daftarAkun].sort((x, y) => x.kode.localeCompare(y.kode))) {
    const saldo = saldoNormal(baris, a, cutoff);
    if (a.tipe === 'AKTIVA') {
      aset.push({ kode: a.kode, nama: a.nama, saldo });
      totalAset += saldo;
    } else if (a.tipe === 'KEWAJIBAN') {
      kewajiban.push({ kode: a.kode, nama: a.nama, saldo });
      totalKewajiban += saldo;
    } else if (a.tipe === 'EKUITAS') {
      ekuitas.push({ kode: a.kode, nama: a.nama, saldo });
      totalEkuitasAkun += saldo;
    }
  }

  const tahunCutoff = Number(cutoff.slice(0, 4));
  let tahunAwal = tahunCutoff;
  for (const b of baris) {
    if (b.tanggal > cutoff) continue;
    const t = Number(b.tanggal.slice(0, 4));
    if (Number.isInteger(t) && t < tahunAwal) tahunAwal = t;
  }

  const tahunTutup = new Set((tutup ?? []).map((t) => Number(t.tahun)));
  const adaInfoTutup = tutup !== undefined;
  let labaDitahan = 0;
  let labaBelumDitutup = 0;
  for (let tahun = tahunAwal; tahun < tahunCutoff; tahun++) {
    const laba = labaTahun(baris, tahun, daftarAkun);
    if (!adaInfoTutup || tahunTutup.has(tahun)) labaDitahan += laba;
    else labaBelumDitutup += laba;
  }

  const labaBerjalan = labaRugi(
    baris,
    { mulai: `${tahunCutoff}-01-01`, sampai: cutoff },
    daftarAkun,
  ).laba;
  const totalEkuitas =
    totalEkuitasAkun + labaDitahan + labaBelumDitutup + labaBerjalan;
  const totalPasiva = totalKewajiban + totalEkuitas;
  const selisih = totalAset - totalPasiva;

  // Pastikan akun yang muncul di baris memang ada di master; mencegah
  // laporan "balance" palsu karena akun asing diabaikan diam-diam.
  for (const b of baris) {
    if (b.tanggal > cutoff) continue;
    if (!peta.has(b.akun_kode))
      throw new Error(`Akun ${b.akun_kode} pada jurnal tidak dikenal di COA.`);
  }

  return {
    cutoff,
    aset,
    kewajiban,
    ekuitas,
    totalAset,
    totalKewajiban,
    totalEkuitasAkun,
    labaDitahan,
    labaBelumDitutup,
    labaBerjalan,
    totalEkuitas,
    totalPasiva,
    selisih,
    balance: selisih === 0,
    aktiva: totalAset,
    pasiva: totalPasiva,
  };
}

// ---------------------------------------------------------------------------
// Arus Kas
// ---------------------------------------------------------------------------

export type KelompokArusKas = 'OPERASI' | 'INVESTASI' | 'PENDANAAN' | 'TRANSFER';

export type ArusKasOpsi = {
  mulai?: string;
  sampai?: string;
  /** Default seluruh dompet kas/bank (KAS_KODES). */
  kasKodes?: readonly string[];
};

export type ArusKasBaris = {
  tanggal: string;
  jurnal_id: string;
  no_bukti: string;
  keterangan: string;
  akun_kode: string;
  akun_nama: string;
  /** Kas masuk (debit akun kas/bank). */
  masuk: number;
  /** Kas keluar (kredit akun kas/bank). */
  keluar: number;
  /** Akun lawan pada jurnal yang sama (untuk drill-down). */
  lawan: string[];
  kelompok: KelompokArusKas;
};

export type ArusKasKelompok = {
  masuk: number;
  keluar: number;
  neto: number;
};

export type ArusKasHasil = {
  mulai?: string;
  sampai?: string;
  saldoAwal: number;
  totalMasuk: number;
  totalKeluar: number;
  /** totalMasuk − totalKeluar (mutasi transfer antar kas tidak dihitung dua kali). */
  kenaikan: number;
  saldoAkhir: number;
  operasi: ArusKasKelompok;
  investasi: ArusKasKelompok;
  pendanaan: ArusKasKelompok;
  transfer: ArusKasKelompok;
  rows: ArusKasBaris[];
};

const kosongKelompok = (): ArusKasKelompok => ({ masuk: 0, keluar: 0, neto: 0 });

function tambahKelompok(k: ArusKasKelompok, masuk: number, keluar: number): void {
  k.masuk += masuk;
  k.keluar += keluar;
  k.neto = k.masuk - k.keluar;
}

/**
 * Arus Kas metode langsung: setiap mutasi akun kas/bank dalam periode menjadi
 * satu baris, dikelompokkan menurut akun lawan:
 * - pendapatan/beban/panjar/utang usaha (2060) → OPERASI
 * - piutang (1050, AKTIVA non-kas) → INVESTASI
 * - kewajiban pinjaman/modal (2050/ekuitas) → PENDANAAN
 * - perpindahan antar dompet kas (tanpa akun lawan non-kas) → TRANSFER,
 *   tidak dihitung sebagai arus masuk/keluar (neto 0) agar total tidak dobel.
 * - jurnal campuran (kas masuk dan keluar sekaligus dengan akun non-kas)
 *   dipecah: porsi `min(kas masuk, kas keluar)` menjadi TRANSFER, sisanya
 *   masuk kelompok sesuai sifat akun non-kas.
 *
 * `saldoAwal`/`saldoAkhir` adalah total seluruh dompet kas/bank, sehingga
 * `saldoAkhir = saldoAwal + kenaikan` konsisten dengan Buku Besar.
 */
export function arusKas(
  baris: readonly BarisJurnalSumber[],
  opsi: ArusKasOpsi = {},
  daftarAkun: readonly Coa[] = COA,
): ArusKasHasil {
  const { mulai, sampai, kasKodes = KAS_KODES } = opsi;
  const peta = petaAkun(daftarAkun);
  const kodeKas = new Set(kasKodes);
  const saldoAwal = mulai
    ? Object.values(
        saldoSemuaKas(baris, kasKodes, hariSebelum(mulai), daftarAkun),
      ).reduce((s, v) => s + v, 0)
    : 0;

  // Kelompokkan baris dalam periode per jurnal. Jurnal tanpa id (data uji
  // minimal) memakai no_bukti, lalu indeks baris sebagai kunci cadangan.
  const grup = new Map<string, { b: BarisJurnalSumber; urutan: number }[]>();
  baris.forEach((b, urutan) => {
    if (!dalamRentang(b.tanggal, mulai, sampai)) return;
    const kunci =
      b.jurnal_id?.trim() ||
      (b.no_bukti?.trim() ? `bukti:${b.no_bukti.trim()}` : `baris:${urutan}`);
    const isi = grup.get(kunci) ?? [];
    isi.push({ b, urutan });
    grup.set(kunci, isi);
  });

  const operasi = kosongKelompok();
  const investasi = kosongKelompok();
  const pendanaan = kosongKelompok();
  const transfer = kosongKelompok();
  const rows: ArusKasBaris[] = [];

  for (const isi of grup.values()) {
    const kas = isi.filter(({ b }) => kodeKas.has(b.akun_kode));
    if (kas.length === 0) continue;
    const nonKas = isi.filter(({ b }) => !kodeKas.has(b.akun_kode));
    const lawan = [...new Set(nonKas.map(({ b }) => b.akun_kode))];
    const jenisLawan = lawan.map((kode) => peta.get(kode)).filter((a): a is Coa => Boolean(a));

    if (nonKas.length === 0) {
      // Pindah dana antar dompet: tampilkan sebagai transfer, neto 0.
      const semuaKas = [...new Set(kas.map(({ b: x }) => x.akun_kode))];
      for (const { b } of kas) {
        const masuk = b.debit;
        const keluar = b.kredit;
        const a = peta.get(b.akun_kode);
        rows.push({
          tanggal: b.tanggal,
          jurnal_id: b.jurnal_id ?? '',
          no_bukti: b.no_bukti ?? '',
          keterangan: b.keterangan_baris || b.keterangan || '',
          akun_kode: b.akun_kode,
          akun_nama: a?.nama ?? b.akun_kode,
          masuk,
          keluar,
          lawan: semuaKas.filter((kode) => kode !== b.akun_kode),
          kelompok: 'TRANSFER',
        });
        tambahKelompok(transfer, masuk, keluar);
      }
      continue;
    }

    const kelompok: KelompokArusKas = jenisLawan.some(
      (a) =>
        a.kode === AKUN_HUTANG_USAHA ||
        a.tipe === 'PENDAPATAN' ||
        a.tipe === 'BEBAN' ||
        a.kode === AKUN_PANJAR,
    )
      ? 'OPERASI'
      : jenisLawan.some((a) => a.tipe === 'KEWAJIBAN' || a.tipe === 'EKUITAS')
        ? 'PENDANAAN'
        : jenisLawan.some((a) => a.tipe === 'AKTIVA' || a.kode === AKUN_PIUTANG)
          ? 'INVESTASI'
          : 'OPERASI';

    // Satu jurnal bisa memuat perpindahan antar dompet sekaligus arus nyata.
    // Contoh: D bank 100 / D beban 5 / K kas 105 berisi transfer bank→kas 100
    // dan biaya operasi 5, bukan operasi masuk 100 + keluar 105.
    //
    // Neto per dompet dihitung lebih dulu (debit−kredit). Porsi transfer adalah
    // min(total neto masuk, total neto keluar); sisanya adalah arus nyata yang
    // dikelompokkan menurut sifat akun non-kas.
    //
    // Alokasi porsi transfer dilakukan berurutan (FIFO) mengikuti urutan baris
    // jurnal: dompet masuk pertama menyerap porsi transfer lebih dulu, begitu
    // pula dompet keluar. Sisa alokasi tiap arah dihitung terpisah agar kedua
    // sisi transfer selalu sama besar. Konsekuensinya deterministik, tanpa
    // pecahan, dan transfer tiap dompet tidak pernah melebihi neto kasnya.
    const perKas = new Map<string, { masuk: number; keluar: number; pertama: BarisJurnalSumber }>();
    for (const { b } of kas) {
      const cur = perKas.get(b.akun_kode) ?? { masuk: 0, keluar: 0, pertama: b };
      cur.masuk += b.debit;
      cur.keluar += b.kredit;
      perKas.set(b.akun_kode, cur);
    }

    let totalNetoMasuk = 0;
    let totalNetoKeluar = 0;
    for (const v of perKas.values()) {
      const neto = v.masuk - v.keluar;
      if (neto > 0) totalNetoMasuk += neto;
      else if (neto < 0) totalNetoKeluar -= neto;
    }
    const porsiTransfer = Math.min(totalNetoMasuk, totalNetoKeluar);
    let sisaTransferMasuk = porsiTransfer;
    let sisaTransferKeluar = porsiTransfer;

    type AlokasiKas = {
      pertama: BarisJurnalSumber;
      /** Arus nyata (bukan transfer) per dompet. */
      masuk: number;
      keluar: number;
      transferMasuk: number;
      transferKeluar: number;
    };
    const alokasi = new Map<string, AlokasiKas>();
    for (const [kode, v] of perKas) {
      const neto = v.masuk - v.keluar;
      const isi: AlokasiKas = {
        pertama: v.pertama,
        masuk: 0,
        keluar: 0,
        transferMasuk: 0,
        transferKeluar: 0,
      };
      if (neto > 0) {
        isi.transferMasuk = Math.min(sisaTransferMasuk, neto);
        sisaTransferMasuk -= isi.transferMasuk;
        isi.masuk = neto - isi.transferMasuk;
      } else if (neto < 0) {
        const bruto = -neto;
        isi.transferKeluar = Math.min(sisaTransferKeluar, bruto);
        sisaTransferKeluar -= isi.transferKeluar;
        isi.keluar = bruto - isi.transferKeluar;
      }
      alokasi.set(kode, isi);
    }
    const kodeTransfer = [...alokasi]
      .filter(([, v]) => v.transferMasuk > 0 || v.transferKeluar > 0)
      .map(([kode]) => kode);

    for (const [kode, v] of alokasi) {
      const a = peta.get(kode);
      const dasar = {
        tanggal: v.pertama.tanggal,
        jurnal_id: v.pertama.jurnal_id ?? '',
        no_bukti: v.pertama.no_bukti ?? '',
        keterangan: v.pertama.keterangan_baris || v.pertama.keterangan || '',
        akun_kode: kode,
        akun_nama: a?.nama ?? kode,
      };
      if (v.transferMasuk > 0 || v.transferKeluar > 0) {
        rows.push({
          ...dasar,
          masuk: v.transferMasuk,
          keluar: v.transferKeluar,
          lawan: kodeTransfer.filter((x) => x !== kode),
          kelompok: 'TRANSFER',
        });
        tambahKelompok(transfer, v.transferMasuk, v.transferKeluar);
      }
      if (v.masuk > 0 || v.keluar > 0) {
        rows.push({
          ...dasar,
          masuk: v.masuk,
          keluar: v.keluar,
          lawan,
          kelompok,
        });
        const target =
          kelompok === 'PENDANAAN'
            ? pendanaan
            : kelompok === 'INVESTASI'
              ? investasi
              : operasi;
        tambahKelompok(target, v.masuk, v.keluar);
      }
    }
  }

  rows.sort((x, y) =>
    x.tanggal < y.tanggal ? -1 : x.tanggal > y.tanggal ? 1 : 0,
  );
  // Transfer antar dompet bukan arus masuk/keluar; hanya dipajang terpisah.
  const nonTransfer = rows.filter((r) => r.kelompok !== 'TRANSFER');
  const totalMasuk = nonTransfer.reduce((s, r) => s + r.masuk, 0);
  const totalKeluar = nonTransfer.reduce((s, r) => s + r.keluar, 0);
  const kenaikan = totalMasuk - totalKeluar;
  return {
    mulai,
    sampai,
    saldoAwal,
    totalMasuk,
    totalKeluar,
    kenaikan,
    saldoAkhir: saldoAwal + kenaikan,
    operasi,
    investasi,
    pendanaan,
    transfer,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Helper tampilan
// ---------------------------------------------------------------------------

/** Nama akun dari daftar COA; fallback ke kode. */
export function namaAkun(kode: string, daftarAkun: readonly Coa[] = COA): string {
  return daftarAkun.find((a) => a.kode === kode)?.nama ?? kode;
}

/** Saldo seluruh akun kas/bank (bukan 1040/1050) per cut-off. */
export function rincianKas(
  baris: readonly BarisJurnalSumber[],
  cutoff?: string,
  daftarAkun: readonly Coa[] = COA,
): Record<string, number> {
  return saldoSemuaKas(baris, KAS_KODES.filter((k) => isAkunKas(k)), cutoff, daftarAkun);
}
