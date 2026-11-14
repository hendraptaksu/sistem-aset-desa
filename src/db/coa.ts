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
// menerima akun baru. Enam akun tambahan sudah ditambahkan ke CSV lalu ke COA:
// lima akun DB-13 (5060/5061/5062/4060/4006) dan 5063 BEBAN BUNGA PINJAMAN
// (DB-13b), sehingga persamaan tetap CSV (54 baris) + 2 ekstensi = 56 akun.
// Rincian keputusan ada di `docs/skema.md` (sumber COA) dan
// `docs/prinsip-akuntansi.md`.
//
// Catatan:
// - Tidak ada kode 1000. Kas tunai = 1001 KAS.
// - Kode tidak berurutan rapat (ada lompatan nomor). JANGAN asumsikan rentang —
//   semua logika memakai `tipe` + `posisi_normal`, bukan rentang kode.
// - 1040 UANG PANJAR = aktiva non-kas (kas di muka), BUKAN dompet.
// - 1050 PIUTANG = aktiva non-kas. BUKAN dompet (isAkunKas('1050') = false).
// - 2050 HUTANG LAIN-LAIN = pinjaman/legacy; 2060 HUTANG USAHA = pembelian kredit.
// - 2060 adalah ekstensi sistem di luar CSV, seperti 1040. Baseline CSV resmi
//   48 akun; lima akun DB-13 dan 5063 DB-13b ditambahkan di belakang baseline
//   menjadi 54 baris.
// - Enam akun tambahan itu adalah TAMBAHAN, bukan pengganti akun lama. Nama
//   diberi pembeda agar operator tidak salah pilih: 5010/5050/5004/4008/4041/
//   4005 tetap ada dan tetap aktif.
// - 5063 BEBAN BUNGA PINJAMAN adalah akun bunga pinjaman LPD (default untuk
//   DB-16); 5050 BIAYA LAIN-LAIN tetap ada untuk biaya lain dan denda.
// - 3001 berlaku "MULAI 10 MARET 2018" (jangkar awal pembukuan).
// - Nama disalin persis dari CSV termasuk singkatan (SHUTLE, PEDAPATAN).

export type CoaTipe = 'AKTIVA' | 'KEWAJIBAN' | 'EKUITAS' | 'PENDAPATAN' | 'BEBAN';
export type PosisiNormal = 'DEBIT' | 'KREDIT';

/**
 * Kelompok akun (DB-14). Nilai ini disimpan di `akun.kelompok` dan hanya
 * dipakai untuk tampilan/pengelompokan dompet — bukan pengganti `tipe`.
 *
 * Nilai resmi: `KAS`, `BANK`, `LPD`, `PANJAR`, `PIUTANG`, `HUTANG`, `EKUITAS`,
 * `PENDAPATAN`, `BEBAN`. String kosong dipakai untuk akun tambahan AKTIVA yang
 * bukan dompet (mis. aset lain buatan operator).
 */
export type KelompokAkun =
  | 'KAS'
  | 'BANK'
  | 'LPD'
  | 'PANJAR'
  | 'PIUTANG'
  | 'HUTANG'
  | 'EKUITAS'
  | 'PENDAPATAN'
  | 'BEBAN';

/** Daftar nilai `kelompok` yang diizinkan di DB-14. */
export const KELOMPOK_AKUN: readonly KelompokAkun[] = [
  'KAS',
  'BANK',
  'LPD',
  'PANJAR',
  'PIUTANG',
  'HUTANG',
  'EKUITAS',
  'PENDAPATAN',
  'BEBAN',
];

/** Kelompok yang menandakan akun dompet kas/bank (wajib `is_kas = 1`). */
export const KELOMPOK_KAS: readonly KelompokAkun[] = ['KAS', 'BANK', 'LPD'];

/**
 * DB-14: rentang kode khusus akun kas/bank/LPD buatan operator. Rentang ini
 * sengaja tidak dipakai COA statis/CSV agar tidak bentrok dengan akun client.
 */
export const KODE_KAS_TAMBAHAN_MIN = 1100;
export const KODE_KAS_TAMBAHAN_MAX = 1199;

/** Asal akun (DB-14): `BAWAAN` = COA statis/CSV, `TAMBAHAN` = dibuat operator. */
export type SumberAkun = 'BAWAAN' | 'TAMBAHAN';

export type Coa = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
  posisi_normal: PosisiNormal;
  /** Status dari master DB; akun statis tidak membawa field ini. */
  aktif?: boolean;
  /**
   * DB-14: dompet kas/bank dari master DB. Akun statis tidak membawa field ini;
   * pemakai harus memakai `isAkunKasData()` agar fallback ke daftar statis.
   */
  is_kas?: boolean;
  /** DB-14: kelompok akun dari master DB (lihat `KelompokAkun`). */
  kelompok?: KelompokAkun | '';
  /** DB-14: asal akun dari master DB. */
  sumber?: SumberAkun;
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
 * Akun bunga pinjaman LPD (DB-13b/DB-16a). Didefinisikan di sini agar daftar
 * akun sistem tidak perlu mengimpor `db/pinjaman.ts` (menghindari siklus).
 */
export const AKUN_BUNGA_PINJAMAN = '5063';
/**
 * Akun denda/biaya lain pinjaman (DB-16a/DB-16d). 5050 BIAYA LAIN-LAIN tetap
 * dipakai untuk biaya lain dan komponen denda pembayaran pinjaman.
 */
export const AKUN_DENDA_PINJAMAN = '5050';

/**
 * DB-15/T2.4: akun sistem yang tetap harus aktif karena alur/wizard memakainya
 * sebagai akun tetap. Akun ini boleh dibaca di histori, tetapi TIDAK boleh
 * dinonaktifkan dari layar Daftar Akun:
 * - 3000 MODAL: baris penyeimbang otomatis Saldo Awal dan sumber setoran modal.
 * - 1040 UANG PANJAR: akun wajib jurnal serah/close panjar.
 * - 1050 PIUTANG: akun data lama yang masih dibaca laporan/drill-down
 *   (legacy read; alur input baru sudah dihapus DB-23a).
 * - 2050 HUTANG LAIN-LAIN: akun pinjaman/utang yang dipakai alur utang dan
 *   modul pinjaman LPD (DB-16).
 * - 2060 HUTANG USAHA: akun wajib alur utang usaha/pembelian kredit (AKT-20).
 * - 5063 BEBAN BUNGA PINJAMAN: akun bunga default modul pinjaman LPD.
 * - 5050 BIAYA LAIN-LAIN: akun denda default pembayaran pinjaman.
 *
 * Akun di luar daftar ini — termasuk akun bawaan lain — boleh dinonaktifkan
 * untuk form input baru. Reaktivasi tetap diizinkan agar DB lama yang sudah
 * terlanjur memiliki akun sistem nonaktif bisa dipulihkan.
 */
export const AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF: ReadonlySet<string> = new Set([
  AKUN_MODAL,
  AKUN_PANJAR,
  AKUN_PIUTANG,
  AKUN_HUTANG,
  AKUN_HUTANG_USAHA,
  AKUN_BUNGA_PINJAMAN,
  AKUN_DENDA_PINJAMAN,
]);

/**
 * Kode akun yang sengaja berada di luar `KODE AKUN.csv` (ekstensi sistem).
 * Test COA menegakkan `COA = baris CSV + tepat daftar ini`; menambah kode di
 * sini juga wajib menambah akun di `COA` dan dokumentasi `docs/skema.md`.
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

/** Kelompok default menurut tipe untuk akun di luar COA (DB-14). */
export function kelompokDariTipe(tipe: CoaTipe): KelompokAkun | '' {
  switch (tipe) {
    case 'KEWAJIBAN':
      return 'HUTANG';
    case 'EKUITAS':
      return 'EKUITAS';
    case 'PENDAPATAN':
      return 'PENDAPATAN';
    case 'BEBAN':
      return 'BEBAN';
    default:
      // AKTIVA di luar COA belum tentu dompet; kelompok dibiarkan kosong.
      return '';
  }
}

/**
 * Metadata DB-14 untuk akun bawaan (COA statis). Mengikuti pemetaan yang
 * disepakati: 1001 = KAS; akun LPD = LPD; dompet lain = BANK; 1040 PANJAR;
 * 1050 PIUTANG; 2050/2060 HUTANG; ekuitas = EKUITAS; 4xxx PENDAPATAN; 5xxx BEBAN.
 */
export function metadataAkunBawaan(
  akunCoa: Pick<Coa, 'kode' | 'nama' | 'tipe'>,
): { is_kas: boolean; kelompok: KelompokAkun | ''; sumber: SumberAkun } {
  const kode = String(akunCoa.kode);
  if (KODE_KAS.has(kode)) {
    return {
      is_kas: true,
      kelompok: kode === '1001' ? 'KAS' : akunCoa.nama.includes('LPD') ? 'LPD' : 'BANK',
      sumber: 'BAWAAN',
    };
  }
  if (kode === AKUN_PANJAR) return { is_kas: false, kelompok: 'PANJAR', sumber: 'BAWAAN' };
  if (kode === AKUN_PIUTANG) return { is_kas: false, kelompok: 'PIUTANG', sumber: 'BAWAAN' };
  if (kode === AKUN_HUTANG || kode === AKUN_HUTANG_USAHA)
    return { is_kas: false, kelompok: 'HUTANG', sumber: 'BAWAAN' };
  return {
    is_kas: false,
    kelompok: kelompokDariTipe(akunCoa.tipe),
    sumber: 'BAWAAN',
  };
}

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
  akunBaru('4006', 'PENDAPATAN PARKIR BPD (KHUSUS)', 'PENDAPATAN'),
  akunBaru('4007', 'PENDAPATAN KONTRAKAN', 'PENDAPATAN'),
  akunBaru('4008', 'PENDAPATAN PUNIA', 'PENDAPATAN'),
  akunBaru('4009', 'PENDAPATAN BUNGA BANK', 'PENDAPATAN'),
  akunBaru('4020', 'PENDAPATAN LABA PURA', 'PENDAPATAN'),
  akunBaru('4041', 'PENDAPATAN SESARI', 'PENDAPATAN'),
  akunBaru('4042', 'DANA PEMBANGUNAN / SHU DARI LPD', 'PENDAPATAN'),
  akunBaru('4050', 'PENDAPATAN LAIN LAIN', 'PENDAPATAN'),
  akunBaru('4060', 'PENDAPATAN WEWEDALAN (UPACARA)', 'PENDAPATAN'),
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
  // Enam akun tambahan di atas baseline 48, bukan pengganti akun lama.
  akunBaru('5060', 'PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL)', 'BEBAN'),
  akunBaru('5061', 'PENGELUARAN ARTOS (UPACARA)', 'BEBAN'),
  akunBaru('5062', 'PENGELUARAN BANTEN RUTIN (HARIAN)', 'BEBAN'),
  // DB-13b: akun bunga pinjaman LPD (default DB-16); 5050 tetap BIAYA LAIN-LAIN.
  akunBaru('5063', 'BEBAN BUNGA PINJAMAN', 'BEBAN'),
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

/**
 * DB-14: apakah objek akun adalah dompet kas/bank. Memakai `is_kas` dari master
 * DB bila tersedia; objek lama tanpa field itu jatuh ke daftar statis
 * `isAkunKas()` agar test/pemanggil lama tetap aman.
 */
export function isAkunKasData(
  data: { kode: string; is_kas?: boolean } | null | undefined,
): boolean {
  if (!data) return false;
  return typeof data.is_kas === 'boolean' ? data.is_kas : isAkunKas(String(data.kode));
}

/**
 * Kode dompet dari daftar akun master. `aktifSaja` dipakai form input baru;
 * laporan historis memakai default `false` agar akun yang dinonaktifkan tetap
 * masuk total kas lama.
 */
export function kodeKasDariDaftarAkun(
  daftar: readonly { kode: string; is_kas?: boolean; aktif?: boolean }[],
  opsi: { aktifSaja?: boolean } = {},
): string[] {
  return daftar
    .filter((a) => isAkunKasData(a) && (!opsi.aktifSaja || a.aktif !== false))
    .map((a) => String(a.kode));
}

/** Kode rekening LPD dari daftar akun master (kelompok LPD). */
export function kodeLpdDariDaftarAkun(
  daftar: readonly {
    kode: string;
    is_kas?: boolean;
    nama?: string;
    kelompok?: KelompokAkun | '';
  }[],
): string[] {
  return daftar
    .filter((a) => {
      if (!isAkunKasData(a)) return false;
      if (a.kelompok) return a.kelompok === 'LPD';
      return String(a.nama ?? '').includes('LPD');
    })
    .map((a) => String(a.kode));
}

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
