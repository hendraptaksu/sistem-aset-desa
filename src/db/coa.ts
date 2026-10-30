// SUMBER MESIN TUNGGAL COA (DB-13a): `KODE AKUN.csv`.
// Baris CSV (kolom NO, NAMA AKUN, KODE AKUN) dinormalisasi oleh test menjadi
// daftar kode+nama resmi client. File ini adalah turunan mesin dari CSV:
//
//   COA = seluruh baris `KODE AKUN.csv` + tepat `KODE_EKSTENSI_SISTEM`.
//
// Ekstensi sistem saat ini hanya 1040 UANG PANJAR (KAS DI MUKA) sesuai arah
// double-entry 2026-10-04 dan 2060 HUTANG USAHA (AKT-20) untuk memisahkan utang
// usaha dari pinjaman. `docs/KODE AKUN.xlsx` adalah **arsip client 48 akun** yang
// tidak boleh diubah tanpa persetujuan; xlsx bukan sumber mesin dan tidak ikut
// menerima akun baru. Akun baru (termasuk 5060/5061/5062/4060/4006 pada DB-13)
// ditambahkan ke CSV lalu ke COA, sehingga persamaan tetap CSV + 2 ekstensi.
// Rincian keputusan ada di `docs/sumber-coa.md`.
//
// Catatan:
// - Tidak ada kode 1000. Kas tunai = 1001 KAS.
// - Kode tidak berurutan rapat (ada lompatan nomor). JANGAN asumsikan rentang —
//   semua logika memakai `tipe` + `posisi_normal`, bukan rentang kode.
// - 1040 UANG PANJAR = aktiva non-kas (kas di muka), BUKAN dompet.
// - 1050 PIUTANG = aktiva non-kas. BUKAN dompet (isAkunKas('1050') = false).
// - 2050 HUTANG LAIN-LAIN = pinjaman/legacy; 2060 HUTANG USAHA = pembelian kredit.
// - 2060 adalah ekstensi sistem di luar CSV, seperti 1040. Baseline CSV resmi
//   48 akun; akun tambahan yang disetujui ditambahkan ke CSV di belakang baseline.
// - 3001 berlaku "MULAI 10 MARET 2018" (jangkar awal pembukuan).
// - Nama disalin persis dari CSV termasuk singkatan (SHUTLE, PEDAPATAN).

export type CoaTipe = 'AKTIVA' | 'KEWAJIBAN' | 'EKUITAS' | 'PENDAPATAN' | 'BEBAN';
export type PosisiNormal = 'DEBIT' | 'KREDIT';

export type Coa = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
  posisi_normal: PosisiNormal;
  /** Status dari master DB; akun statis tidak membawa field ini. */
  aktif?: boolean;
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
/**
 * Utang usaha (pembelian/perbaikan kredit) — AKT-20. Terpisah dari 2050 agar
 * pembayarannya masuk OPERASI, sedangkan pinjaman 2050 tetap PENDANAAN.
 */
export const AKUN_HUTANG_USAHA = '2060';
export const AKUN_MODAL = '3000';

/**
 * Kode akun yang sengaja berada di luar `KODE AKUN.csv` (ekstensi sistem).
 * Test COA menegakkan `COA = baris CSV + tepat daftar ini`; menambah kode di
 * sini juga wajib menambah akun di `COA` dan dokumentasi `docs/sumber-coa.md`.
 */
export const KODE_EKSTENSI_SISTEM: readonly string[] = [AKUN_PANJAR, AKUN_HUTANG_USAHA];

/**
 * Akun ekuitas legacy yang tetap ada di COA untuk membaca saldo/laporan lama,
 * tetapi tidak boleh dipakai sebagai baris jurnal baru. Saldo akun ini hanya
 * berasal dari baris jurnal data lama; v2 tidak menghitungnya dari tutup buku
 * atau surplus periode.
 */
export const AKUN_LEGACY_TIDAK_DIPOSTING: ReadonlySet<string> = new Set(['3001', '3002']);

/** Pesan seragam untuk penolakan akun legacy di UI/posting. */
export const PESAN_AKUN_LEGACY =
  'adalah akun legacy 3001/3002: saldonya hanya berasal dari data lama dan tidak boleh diposting; akun ini hanya untuk laporan.';

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
  akunBaru(AKUN_HUTANG_USAHA, 'HUTANG USAHA', 'KEWAJIBAN'),
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
 *
 * `opsi.dikenal` dipakai pemanggil yang sudah memastikan kode ada di master
 * DB (termasuk akun tambahan buatan operator). Tanpa opsi itu, fungsi tetap
 * hanya mengenali COA statis agar test lama dan pemanggil lama aman.
 */
export function akunBolehDiposting(
  kode: string,
  aktif = true,
  opsi: { dikenal?: boolean } = {},
): boolean {
  const kodeBersih = String(kode ?? '').trim();
  if (!kodeBersih || !aktif) return false;
  if (AKUN_LEGACY_TIDAK_DIPOSTING.has(kodeBersih)) return false;
  if (opsi.dikenal === true) return true;
  return Boolean(akun(kodeBersih));
}

export const isAkunKas = (kode: string): boolean => KAS_KODES.includes(kode);
export const isPendapatan = (kode: string): boolean => akun(kode)?.tipe === 'PENDAPATAN';
export const isBeban = (kode: string): boolean => akun(kode)?.tipe === 'BEBAN';
export const isAktiva = (kode: string): boolean => akun(kode)?.tipe === 'AKTIVA';
export const isKewajiban = (kode: string): boolean => akun(kode)?.tipe === 'KEWAJIBAN';
export const isEkuitas = (kode: string): boolean => akun(kode)?.tipe === 'EKUITAS';
export const isPiutang = (kode: string): boolean => kode === AKUN_PIUTANG;
/** Semua akun hutang: 2050 pinjaman/legacy dan 2060 utang usaha. */
export const isHutang = (kode: string): boolean =>
  kode === AKUN_HUTANG || kode === AKUN_HUTANG_USAHA;
export const isHutangPinjaman = (kode: string): boolean => kode === AKUN_HUTANG;
export const isHutangUsaha = (kode: string): boolean => kode === AKUN_HUTANG_USAHA;
export const HUTANG_KODES = COA.filter((c) => c.tipe === 'KEWAJIBAN').map((c) => c.kode);
