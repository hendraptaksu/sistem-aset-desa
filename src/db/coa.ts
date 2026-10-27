// SUMBER KEBENARAN: KODE AKUN.csv (dokumen resmi client, 2026-09-04),
// ditambah 1040 UANG PANJAR (KAS DI MUKA) sesuai arah double-entry 2026-10-04.
// Catatan:
// - Tidak ada kode 1000. Kas tunai = 1001 KAS.
// - Kode tidak berurutan rapat (cth. tidak ada 4006). JANGAN asumsikan rentang —
//   semua logika memakai `tipe` + `posisi_normal`, bukan rentang kode.
// - 1040 UANG PANJAR = aktiva non-kas (kas di muka), BUKAN dompet.
// - 1050 PIUTANG = aktiva non-kas. BUKAN dompet (isAkunKas('1050') = false).
// - 3001 berlaku "MULAI 10 MARET 2018" (jangkar awal pembukuan).
// - Nama disalin persis dari CSV termasuk singkatan (SHUTLE, PEDAPATAN).

export type CoaTipe = 'AKTIVA' | 'KEWAJIBAN' | 'EKUITAS' | 'PENDAPATAN' | 'BEBAN';
export type PosisiNormal = 'DEBIT' | 'KREDIT';

export type Coa = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
  posisi_normal: PosisiNormal;
};

/** AKTIVA & BEBAN bersaldo normal DEBIT; KEWAJIBAN, EKUITAS & PENDAPATAN KREDIT. */
export const POSISI_NORMAL: Record<CoaTipe, PosisiNormal> = {
  AKTIVA: 'DEBIT',
  KEWAJIBAN: 'KREDIT',
  EKUITAS: 'KREDIT',
  PENDAPATAN: 'KREDIT',
  BEBAN: 'DEBIT',
};

export const AKUN_PANJAR = '1040';
export const AKUN_PIUTANG = '1050';
export const AKUN_HUTANG = '2050';
export const AKUN_MODAL = '3000';

/**
 * Akun ekuitas legacy yang tetap ada di COA untuk membaca saldo/laporan lama,
 * tetapi tidak boleh dipakai sebagai baris jurnal baru. Nilainya turunan
 * (kumulatif dari tutup buku & surplus periode), bukan hasil posting manual.
 */
export const AKUN_LEGACY_TIDAK_DIPOSTING: ReadonlySet<string> = new Set(['3001', '3002']);

/** Pesan seragam untuk penolakan akun legacy di UI/posting/import. */
export const PESAN_AKUN_LEGACY =
  'adalah akun legacy 3001/3002 (saldo turunan) dan tidak boleh diposting; akun ini hanya untuk laporan.';

/** Dompet kas/bank (AKTIVA yang boleh dipakai sebagai akun kas). BUKAN 1040/1050. */
const KODE_KAS = new Set([
  '1001',
  '1010', '1014', '1015', '1016', '1017', '1018', '1019', '1020', '1021',
  '1028', '1029', '1030', '1031', '1032', '1036',
]);

const akunBaru = (kode: string, nama: string, tipe: CoaTipe): Coa => ({
  kode,
  nama,
  tipe,
  posisi_normal: POSISI_NORMAL[tipe],
});

export const COA: Coa[] = [
  // Kas & Bank (AKTIVA, normal DEBIT) — kecuali 1040/1050
  akunBaru('1001', 'KAS', 'AKTIVA'),
  akunBaru('1010', 'LPD 12.05163/DL/2020 KIOS', 'AKTIVA'),
  akunBaru('1014', 'LPD 12.005150/DL/2020', 'AKTIVA'),
  akunBaru('1015', 'LPD 12.05165/DL/2020 PARKIR', 'AKTIVA'),
  akunBaru('1016', 'LPD 12.05167/DL/2020 BEJI', 'AKTIVA'),
  akunBaru('1017', 'LPD 12.03905/DL/2018 SHUTLE BUS', 'AKTIVA'),
  akunBaru('1018', 'LPD 12.05164/DL/2020 TOILET', 'AKTIVA'),
  akunBaru('1019', 'LPD BUNGA DEPOSITO 14.15498', 'AKTIVA'),
  akunBaru('1020', 'LPD BUNGA DEPOSITO 14.15946', 'AKTIVA'),
  akunBaru('1021', 'LPD BUNGA DEPOSITO 14.16005', 'AKTIVA'),
  akunBaru('1028', 'KSU USAHA MANDIRI 1519', 'AKTIVA'),
  akunBaru('1029', 'BANK BPD UBUD 0190202182457', 'AKTIVA'),
  akunBaru('1030', 'LPD DEPOSITO 15498/SSB/V/2020', 'AKTIVA'),
  akunBaru('1031', 'LPD DEPOSITO 15946/SSB/LPB/X/2020', 'AKTIVA'),
  akunBaru('1032', 'LPD DEPOSITO 16005/SSB/LPB/XI/2020', 'AKTIVA'),
  akunBaru('1036', 'LPD 12.06558 PUNIA PIODALAN', 'AKTIVA'),
  // Uang panjar (kas di muka) — tambahan yang disetujui arah double-entry.
  akunBaru(AKUN_PANJAR, 'UANG PANJAR (KAS DI MUKA)', 'AKTIVA'),
  // Piutang (aktiva non-kas)
  akunBaru(AKUN_PIUTANG, 'PIUTANG LAIN LAIN', 'AKTIVA'),
  // Hutang
  akunBaru(AKUN_HUTANG, 'HUTANG LAIN-LAIN', 'KEWAJIBAN'),
  // Modal / ekuitas
  akunBaru(AKUN_MODAL, 'MODAL', 'EKUITAS'),
  akunBaru('3001', 'SALDO KUMULATIF MULAI 10 MARET 2018', 'EKUITAS'),
  akunBaru('3002', 'SALDO BERJALAN', 'EKUITAS'),
  // Pendapatan
  akunBaru('4001', 'PENDAPATAN BEJI', 'PENDAPATAN'),
  akunBaru('4002', 'PENDAPATAN TOILET', 'PENDAPATAN'),
  akunBaru('4003', 'PEDAPATAN KIOS', 'PENDAPATAN'),
  akunBaru('4004', 'PENDAPATAN SHUTLE BUS', 'PENDAPATAN'),
  akunBaru('4005', 'PENDAPATAN PARKIR', 'PENDAPATAN'),
  akunBaru('4007', 'PENDAPATAN KONTRAKAN', 'PENDAPATAN'),
  akunBaru('4008', 'PENDAPATAN PUNIA', 'PENDAPATAN'),
  akunBaru('4009', 'PENDAPATAN BUNGA BANK', 'PENDAPATAN'),
  akunBaru('4020', 'PENDAPATAN LABA PURA', 'PENDAPATAN'),
  akunBaru('4041', 'PENDAPATAN SESARI', 'PENDAPATAN'),
  akunBaru('4042', 'DANA PEMBANGUNAN / SHU DARI LPD', 'PENDAPATAN'),
  akunBaru('4050', 'PENDAPATAN LAIN LAIN', 'PENDAPATAN'),
  // Beban / Baga
  akunBaru('5000', 'BIAYA KESEKRETARIATAN', 'BEBAN'),
  akunBaru('5001', 'BAGA KASUKERTAN', 'BEBAN'),
  akunBaru('5002', 'BAGA PAMITEGEP', 'BEBAN'),
  akunBaru('5003', 'BAGA WEWANGUNAN', 'BEBAN'),
  akunBaru('5004', 'BAGA UPAKARA', 'BEBAN'),
  akunBaru('5005', 'BAGA WAHANA', 'BEBAN'),
  akunBaru('5006', 'BAGA HUMAS', 'BEBAN'),
  akunBaru('5007', 'BAGA BOGA', 'BEBAN'),
  akunBaru('5008', 'BAGA WEWALEN/DEKORASI', 'BEBAN'),
  akunBaru('5009', 'BAGA MERERESIK', 'BEBAN'),
  akunBaru('5010', 'BAGA SUAR (TELPON, LISTRIK, PDAM)', 'BEBAN'),
  akunBaru('5030', 'BIAYA PIODALAN', 'BEBAN'),
  akunBaru('5031', 'BIAYA PROYEK', 'BEBAN'),
  akunBaru('5040', 'BIAYA ADMINISTRASI DAN PAJAK BANK', 'BEBAN'),
  akunBaru('5050', 'BIAYA LAIN-LAIN', 'BEBAN'),
];

/** Semua dompet kas/bank. 1040 (panjar) & 1050 (piutang) sengaja TIDAK termasuk. */
export const KAS_KODES = COA.filter((c) => c.tipe === 'AKTIVA' && KODE_KAS.has(c.kode)).map(
  (c) => c.kode,
);
/** Rekening LPD (untuk grup "Total Saldo LPD" di dashboard). */
export const LPD_KODES = COA.filter(
  (c) => KODE_KAS.has(c.kode) && c.nama.includes('LPD'),
).map((c) => c.kode);
export const AKTIVA_KODES = COA.filter((c) => c.tipe === 'AKTIVA').map((c) => c.kode);
export const KEWAJIBAN_KODES = COA.filter((c) => c.tipe === 'KEWAJIBAN').map((c) => c.kode);
export const EKUITAS_KODES = COA.filter((c) => c.tipe === 'EKUITAS').map((c) => c.kode);
export const PENDAPATAN_KODES = COA.filter((c) => c.tipe === 'PENDAPATAN').map((c) => c.kode);
export const BEBAN_KODES = COA.filter((c) => c.tipe === 'BEBAN').map((c) => c.kode);

/** Cari akun berdasarkan kode. */
export const akun = (kode: string): Coa | undefined => COA.find((c) => c.kode === kode);

/**
 * Apakah akun boleh dipakai sebagai baris jurnal baru.
 *
 * - `3001`/`3002` selalu ditolak: akun legacy, saldonya turunan.
 * - Akun nonaktif ditolak. COA statis tidak menyimpan status; pemanggil yang
 *   punya status dari master DB harus meneruskannya lewat `aktif`.
 * - Akun tetap ada di COA & laporan agar saldo lama bisa diperiksa.
 */
export function akunBolehDiposting(kode: string, aktif = true): boolean {
  const kodeBersih = String(kode ?? '').trim();
  if (!kodeBersih || !aktif) return false;
  const a = akun(kodeBersih);
  if (!a) return false;
  return !AKUN_LEGACY_TIDAK_DIPOSTING.has(a.kode);
}

export const isAkunKas = (kode: string): boolean => KAS_KODES.includes(kode);
export const isPendapatan = (kode: string): boolean => akun(kode)?.tipe === 'PENDAPATAN';
export const isBeban = (kode: string): boolean => akun(kode)?.tipe === 'BEBAN';
export const isAktiva = (kode: string): boolean => akun(kode)?.tipe === 'AKTIVA';
export const isKewajiban = (kode: string): boolean => akun(kode)?.tipe === 'KEWAJIBAN';
export const isEkuitas = (kode: string): boolean => akun(kode)?.tipe === 'EKUITAS';
export const isPiutang = (kode: string): boolean => kode === AKUN_PIUTANG;
export const isHutang = (kode: string): boolean => kode === AKUN_HUTANG;
