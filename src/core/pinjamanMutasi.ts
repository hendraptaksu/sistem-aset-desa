// DB-16e — Kartu hutang / mutasi bulanan pinjaman LPD.
//
// Fungsi murni: TIDAK membaca DB dan TIDAK menulis apa pun. Input sudah
// disiapkan adapter DB dari `pinjaman_bayar` (link-only) + `jurnal_baris`.
//
// Prinsip angka:
// - Pokok = neto debit 2050 pada jurnal pembayaran yang tertaut.
// - Bunga = neto debit akun bunga pinjaman.
// - Denda = neto debit akun BEBAN lain (biasanya 5050).
// - Kas keluar = kredit akun kas/bank pada jurnal pembayaran.
// - Saldo awal/akhir bulan adalah TURUNAN, bukan kolom tersimpan. Saldo awal
//   periode = sisa_pokok_awal - pokok jurnal yang tanggalnya sebelum periode.
// - Tanggal periode memakai tanggal jurnal, bukan tanggal link pembayaran.
//
// Jadwal vs realisasi membandingkan `pinjaman_angsuran` (rencana) dengan
// nominal jurnal yang ditautkan ke angsuran tersebut (realisasi). Jadwal tidak
// pernah diubah oleh realisasi.

import { AKUN_HUTANG, type Coa } from '../db/coa.js';

const POLA_BULAN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

const NAMA_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

/** Satu baris jurnal yang sudah dibatasi ke jurnal pembayaran tertaut. */
export type BarisMutasiJurnal = {
  jurnal_id: string;
  akun_kode: string;
  debit: number;
  kredit: number;
};

/** Link `pinjaman_bayar` + metadata kepala jurnal (bukan nominal). */
export type PembayaranMutasiPinjaman = {
  id: string;
  jurnal_id: string;
  /** Tanggal jurnal; dipakai untuk periode laporan. */
  tanggal: string;
  /** Tanggal link pembayaran; boleh berbeda dari tanggal jurnal. */
  tanggal_bayar?: string;
  angsuran_id: number | null;
  catatan?: string;
  no_bukti?: string;
  keterangan?: string;
};

/** Rencana angsuran yang dibandingkan dengan realisasi jurnal. */
export type AngsuranMutasiPinjaman = {
  id: number;
  ke: number;
  jatuh_tempo: string;
  pokok: number;
  bunga: number;
  catatan?: string;
};

export type FilterPeriodeMutasiPinjaman = {
  /** Bulan `YYYY-MM`; prioritas di atas `mulai`/`sampai`. */
  periode?: string;
  /** Tanggal kalender `YYYY-MM-DD`; boleh hanya salah satu. */
  mulai?: string;
  sampai?: string;
};

export type ModePeriodeMutasiPinjaman = 'bulan' | 'tahun' | 'rentang';

export type PeriodeMutasiPinjaman = {
  mode: ModePeriodeMutasiPinjaman;
  mulai: string;
  sampai: string;
  label: string;
  /** Terisi bila mode = bulan. */
  bulan?: string;
};

/** Rincian satu pembayaran; nominal SELALU dari baris jurnal. */
export type RincianMutasiPembayaran = {
  pembayaran_id: string;
  jurnal_id: string;
  /** Tanggal jurnal (dasar periode). */
  tanggal: string;
  /** Tanggal link pembayaran. */
  tanggal_bayar: string;
  no_bukti: string;
  keterangan: string;
  catatan: string;
  angsuran_id: number | null;
  pokok: number;
  bunga: number;
  denda: number;
  kas_keluar: number;
};

export type MutasiPinjamanBulanan = {
  bulan: string;
  mulai: string;
  sampai: string;
  saldo_awal: number;
  pokok: number;
  bunga: number;
  denda: number;
  kas_keluar: number;
  saldo_akhir: number;
  jurnal_ids: string[];
  pembayaran: RincianMutasiPembayaran[];
};

export type JadwalRealisasiPinjaman = {
  angsuran_id: number;
  ke: number;
  jatuh_tempo: string;
  catatan: string;
  pokok_jadwal: number;
  bunga_jadwal: number;
  pokok_realisasi: number;
  bunga_realisasi: number;
  denda_realisasi: number;
  /** realisasi - jadwal; negatif = kurang bayar. */
  selisih_pokok: number;
  selisih_bunga: number;
  dibayar: boolean;
  pembayaran_id: string | null;
  jurnal_id: string | null;
  no_bukti: string | null;
  tanggal_bayar: string | null;
  tanggal_jurnal: string | null;
};

export type MutasiPinjamanInput = {
  pinjaman: {
    id: string;
    kreditur: string;
    akun_bunga: string;
    sisa_pokok_awal: number;
    tanggal_mulai: string;
  };
  jadwal: readonly AngsuranMutasiPinjaman[];
  pembayaran: readonly PembayaranMutasiPinjaman[];
  baris: readonly BarisMutasiJurnal[];
  akun: readonly Coa[];
  periode: PeriodeMutasiPinjaman;
};

export type MutasiPinjamanHasil = {
  pinjaman: MutasiPinjamanInput['pinjaman'];
  periode: PeriodeMutasiPinjaman;
  /** Saldo pokok pada awal periode. */
  saldo_awal_periode: number;
  total_pokok: number;
  total_bunga: number;
  total_denda: number;
  total_kas_keluar: number;
  /** Saldo pokok pada akhir periode. */
  saldo_akhir_periode: number;
  /**
   * Outstanding seluruh riwayat (sisa_pokok_awal - semua pokok jurnal
   * tertaut). Sama dengan `Pinjaman.outstanding` saat data konsisten.
   */
  outstanding: number;
  bulanan: MutasiPinjamanBulanan[];
  jadwal: JadwalRealisasiPinjaman[];
};

const angka = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const dua = (n: number): string => String(n).padStart(2, '0');

function tanggalKalenderValid(tanggal: string): boolean {
  const m = POLA_TANGGAL.exec(tanggal);
  if (!m) return false;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  if (tahun < 1900 || tahun > 9999) return false;
  const cek = new Date(Date.UTC(tahun, bulan - 1, hari));
  return (
    cek.getUTCFullYear() === tahun &&
    cek.getUTCMonth() === bulan - 1 &&
    cek.getUTCDate() === hari
  );
}

function hariTerakhirBulan(tahun: number, bulan: number): number {
  return new Date(Date.UTC(tahun, bulan, 0)).getUTCDate();
}

/**
 * Normalisasi filter periode. Default = tahun berjalan dari `sekarang`.
 *
 * - `periode: 'YYYY-MM'` → satu bulan penuh.
 * - `mulai`/`sampai` → rentang tanggal (boleh hanya salah satu; sisi yang
 *   kosong memakai awal/akhir tahun yang sama).
 * - Tanpa filter → 1 Januari s/d 31 Desember tahun `sekarang`.
 */
export function periodeMutasiPinjaman(
  filter: FilterPeriodeMutasiPinjaman = {},
  sekarang: string,
): PeriodeMutasiPinjaman {
  const bulan = String(filter.periode ?? '').trim();
  const mulaiMentah = String(filter.mulai ?? '').trim();
  const sampaiMentah = String(filter.sampai ?? '').trim();

  if (bulan) {
    if (!POLA_BULAN.test(bulan))
      throw new Error('Periode mutasi harus berformat YYYY-MM.');
    const tahun = Number(bulan.slice(0, 4));
    if (tahun < 1900 || tahun > 9999)
      throw new Error('Tahun periode mutasi tidak valid (1900–9999).');
    const nomorBulan = Number(bulan.slice(5, 7));
    return {
      mode: 'bulan',
      mulai: `${bulan}-01`,
      sampai: `${bulan}-${dua(hariTerakhirBulan(tahun, nomorBulan))}`,
      label: `${NAMA_BULAN[nomorBulan - 1]} ${tahun}`,
      bulan,
    };
  }

  if (mulaiMentah || sampaiMentah) {
    if (mulaiMentah && !tanggalKalenderValid(mulaiMentah))
      throw new Error('Tanggal mulai mutasi tidak valid (YYYY-MM-DD).');
    if (sampaiMentah && !tanggalKalenderValid(sampaiMentah))
      throw new Error('Tanggal sampai mutasi tidak valid (YYYY-MM-DD).');

    const acuan = mulaiMentah || sampaiMentah;
    const tahun = acuan.slice(0, 4);
    const mulai = mulaiMentah || `${tahun}-01-01`;
    const sampai = sampaiMentah || `${tahun}-12-31`;
    if (mulai > sampai)
      throw new Error('Tanggal mulai mutasi tidak boleh setelah tanggal sampai.');

    const setahunPenuh = mulai.endsWith('-01-01') && sampai.endsWith('-12-31');
    return {
      mode: setahunPenuh ? 'tahun' : 'rentang',
      mulai,
      sampai,
      label: setahunPenuh
        ? `Tahun ${mulai.slice(0, 4)}`
        : `${mulai} s/d ${sampai}`,
    };
  }

  if (!tanggalKalenderValid(sekarang))
    throw new Error('Tanggal acuan mutasi tidak valid (YYYY-MM-DD).');
  const tahun = sekarang.slice(0, 4);
  return {
    mode: 'tahun',
    mulai: `${tahun}-01-01`,
    sampai: `${tahun}-12-31`,
    label: `Tahun ${tahun}`,
  };
}

type BarisPerBulan = {
  bulan: string;
  mulai: string;
  sampai: string;
};

function daftarBulan(periode: PeriodeMutasiPinjaman): BarisPerBulan[] {
  const hasil: BarisPerBulan[] = [];
  let tahun = Number(periode.mulai.slice(0, 4));
  let bulan = Number(periode.mulai.slice(5, 7));
  const tahunAkhir = Number(periode.sampai.slice(0, 4));
  const bulanAkhir = Number(periode.sampai.slice(5, 7));

  while (tahun < tahunAkhir || (tahun === tahunAkhir && bulan <= bulanAkhir)) {
    const kunci = `${tahun}-${dua(bulan)}`;
    const awal = `${kunci}-01`;
    const akhir = `${kunci}-${dua(hariTerakhirBulan(tahun, bulan))}`;
    hasil.push({
      bulan: kunci,
      mulai: awal > periode.mulai ? awal : periode.mulai,
      sampai: akhir < periode.sampai ? akhir : periode.sampai,
    });
    bulan += 1;
    if (bulan > 12) {
      bulan = 1;
      tahun += 1;
    }
  }
  return hasil;
}

function rincianDariJurnal(
  jurnalId: string,
  petaBaris: Map<string, BarisMutasiJurnal[]>,
  petaAkun: Map<string, Coa>,
  akunBunga: string,
): { pokok: number; bunga: number; denda: number; kas_keluar: number } {
  let pokok = 0;
  let bunga = 0;
  let denda = 0;
  let kasKeluar = 0;

  for (const b of petaBaris.get(jurnalId) ?? []) {
    const kode = String(b.akun_kode);
    const debit = angka(b.debit);
    const kredit = angka(b.kredit);

    if (kode === AKUN_HUTANG) pokok += debit - kredit;
    if (kode === akunBunga) bunga += debit - kredit;
    else if (petaAkun.get(kode)?.tipe === 'BEBAN') denda += debit - kredit;
    if (petaAkun.get(kode)?.is_kas) kasKeluar += kredit;
  }

  return { pokok, bunga, denda, kas_keluar: kasKeluar };
}

/**
 * Hitung kartu hutang bulanan + jadwal vs realisasi dari input murni.
 * Saldo awal bulan pertama memakai seluruh pembayaran sebelum periode, lalu
 * mengalir bulan ke bulan sampai saldo akhir.
 */
export function hitungMutasiPinjaman(
  input: MutasiPinjamanInput,
): MutasiPinjamanHasil {
  const periode = input.periode;
  if (!tanggalKalenderValid(periode.mulai) || !tanggalKalenderValid(periode.sampai))
    throw new Error('Periode mutasi tidak valid (YYYY-MM-DD).');
  if (periode.mulai > periode.sampai)
    throw new Error('Periode mutasi tidak boleh terbalik.');

  const petaAkun = new Map(input.akun.map((a) => [a.kode, a]));
  const petaBaris = new Map<string, BarisMutasiJurnal[]>();
  for (const b of input.baris) {
    const daftar = petaBaris.get(b.jurnal_id);
    if (daftar) daftar.push(b);
    else petaBaris.set(b.jurnal_id, [b]);
  }

  const pembayaran: RincianMutasiPembayaran[] = input.pembayaran
    .map((p) => ({
      pembayaran_id: p.id,
      jurnal_id: p.jurnal_id,
      tanggal: p.tanggal,
      tanggal_bayar: p.tanggal_bayar || p.tanggal,
      no_bukti: String(p.no_bukti ?? ''),
      keterangan: String(p.keterangan ?? ''),
      catatan: String(p.catatan ?? ''),
      angsuran_id: p.angsuran_id,
      ...rincianDariJurnal(
        p.jurnal_id,
        petaBaris,
        petaAkun,
        input.pinjaman.akun_bunga,
      ),
    }))
    .sort(
      (a, b) =>
        a.tanggal.localeCompare(b.tanggal) ||
        a.jurnal_id.localeCompare(b.jurnal_id),
    );

  const totalPokokSemua = pembayaran.reduce((s, p) => s + p.pokok, 0);
  const outstanding = input.pinjaman.sisa_pokok_awal - totalPokokSemua;
  const pokokSebelumPeriode = pembayaran
    .filter((p) => p.tanggal < periode.mulai)
    .reduce((s, p) => s + p.pokok, 0);

  let saldo = input.pinjaman.sisa_pokok_awal - pokokSebelumPeriode;
  const saldoAwalPeriode = saldo;
  const bulanan: MutasiPinjamanBulanan[] = daftarBulan(periode).map((b) => {
    const dalamBulan = pembayaran.filter(
      (p) => p.tanggal >= b.mulai && p.tanggal <= b.sampai,
    );
    const pokok = dalamBulan.reduce((s, p) => s + p.pokok, 0);
    const bunga = dalamBulan.reduce((s, p) => s + p.bunga, 0);
    const denda = dalamBulan.reduce((s, p) => s + p.denda, 0);
    const kasKeluar = dalamBulan.reduce((s, p) => s + p.kas_keluar, 0);
    const saldoAwal = saldo;
    const saldoAkhir = saldoAwal - pokok;
    saldo = saldoAkhir;
    return {
      bulan: b.bulan,
      mulai: b.mulai,
      sampai: b.sampai,
      saldo_awal: saldoAwal,
      pokok,
      bunga,
      denda,
      kas_keluar: kasKeluar,
      saldo_akhir: saldoAkhir,
      jurnal_ids: [...new Set(dalamBulan.map((p) => p.jurnal_id))],
      pembayaran: dalamBulan,
    };
  });

  const totalPokok = bulanan.reduce((s, b) => s + b.pokok, 0);
  const totalBunga = bulanan.reduce((s, b) => s + b.bunga, 0);
  const totalDenda = bulanan.reduce((s, b) => s + b.denda, 0);
  const totalKasKeluar = bulanan.reduce((s, b) => s + b.kas_keluar, 0);

  const perAngsuran = new Map<number, RincianMutasiPembayaran>();
  for (const p of pembayaran) {
    if (p.angsuran_id !== null && !perAngsuran.has(p.angsuran_id))
      perAngsuran.set(p.angsuran_id, p);
  }

  const jadwal: JadwalRealisasiPinjaman[] = input.jadwal
    .filter((a) => {
      const p = perAngsuran.get(a.id);
      const jatuhTempoDalamPeriode =
        a.jatuh_tempo >= periode.mulai && a.jatuh_tempo <= periode.sampai;
      const dibayarDalamPeriode =
        p !== undefined && p.tanggal >= periode.mulai && p.tanggal <= periode.sampai;
      return jatuhTempoDalamPeriode || dibayarDalamPeriode;
    })
    .map((a) => {
      const p = perAngsuran.get(a.id);
      const pokokRealisasi = p?.pokok ?? 0;
      const bungaRealisasi = p?.bunga ?? 0;
      return {
        angsuran_id: a.id,
        ke: a.ke,
        jatuh_tempo: a.jatuh_tempo,
        catatan: String(a.catatan ?? ''),
        pokok_jadwal: a.pokok,
        bunga_jadwal: a.bunga,
        pokok_realisasi: pokokRealisasi,
        bunga_realisasi: bungaRealisasi,
        denda_realisasi: p?.denda ?? 0,
        selisih_pokok: pokokRealisasi - a.pokok,
        selisih_bunga: bungaRealisasi - a.bunga,
        dibayar: p !== undefined,
        pembayaran_id: p?.pembayaran_id ?? null,
        jurnal_id: p?.jurnal_id ?? null,
        no_bukti: p ? p.no_bukti : null,
        tanggal_bayar: p?.tanggal_bayar ?? null,
        tanggal_jurnal: p?.tanggal ?? null,
      };
    })
    .sort(
      (a, b) =>
        a.jatuh_tempo.localeCompare(b.jatuh_tempo) || a.ke - b.ke,
    );

  return {
    pinjaman: input.pinjaman,
    periode,
    saldo_awal_periode: saldoAwalPeriode,
    total_pokok: totalPokok,
    total_bunga: totalBunga,
    total_denda: totalDenda,
    total_kas_keluar: totalKasKeluar,
    saldo_akhir_periode: saldo,
    outstanding,
    bulanan,
    jadwal,
  };
}
