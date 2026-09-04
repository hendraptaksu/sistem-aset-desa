// SUMBER KEBENARAN: KODE AKUN.csv (dokumen resmi client, 2026-09-04).
// Menggantikan COA PRD §2 yang ternyata berbeda (nama + mapping + cakupan).
// Catatan:
// - Tidak ada kode 1000. Kas tunai = 1001 KAS.
// - Kode tidak berurutan rapat (cth. tidak ada 4006). JANGAN asumsikan rentang —
//   semua logika memakai `tipe`, bukan rentang kode.
// - 1050 PIUTANG = aktiva non-kas. Dicatat di sisi KATEGORI (simetris dengan
//   2050 HUTANG): keluar = pinjaman diberikan (piutang naik), masuk = pelunasan
//   diterima (piutang turun). BUKAN dompet (isKas('1050') = false).
// - 3001 berlaku "MULAI 10 MARET 2018" (jangkar awal pembukuan).
// - Nama disalin persis dari CSV termasuk singkatan (SHUTLE, PEDAPATAN).

export type CoaTipe = 'KAS' | 'PIUTANG' | 'HUTANG' | 'MODAL' | 'PENDAPATAN' | 'BEBAN';

export type Coa = { kode: string; nama: string; tipe: CoaTipe };

export const COA: Coa[] = [
  // Kas & Bank (1xxx, kecuali 1050)
  { kode: '1001', nama: 'KAS', tipe: 'KAS' },
  { kode: '1010', nama: 'LPD 12.05163/DL/2020 KIOS', tipe: 'KAS' },
  { kode: '1014', nama: 'LPD 12.005150/DL/2020', tipe: 'KAS' },
  { kode: '1015', nama: 'LPD 12.05165/DL/2020 PARKIR', tipe: 'KAS' },
  { kode: '1016', nama: 'LPD 12.05167/DL/2020 BEJI', tipe: 'KAS' },
  { kode: '1017', nama: 'LPD 12.03905/DL/2018 SHUTLE BUS', tipe: 'KAS' },
  { kode: '1018', nama: 'LPD 12.05164/DL/2020 TOILET', tipe: 'KAS' },
  { kode: '1019', nama: 'LPD BUNGA DEPOSITO 14.15498', tipe: 'KAS' },
  { kode: '1020', nama: 'LPD BUNGA DEPOSITO 14.15946', tipe: 'KAS' },
  { kode: '1021', nama: 'LPD BUNGA DEPOSITO 14.16005', tipe: 'KAS' },
  { kode: '1028', nama: 'KSU USAHA MANDIRI 1519', tipe: 'KAS' },
  { kode: '1029', nama: 'BANK BPD UBUD 0190202182457', tipe: 'KAS' },
  { kode: '1030', nama: 'LPD DEPOSITO 15498/SSB/V/2020', tipe: 'KAS' },
  { kode: '1031', nama: 'LPD DEPOSITO 15946/SSB/LPB/X/2020', tipe: 'KAS' },
  { kode: '1032', nama: 'LPD DEPOSITO 16005/SSB/LPB/XI/2020', tipe: 'KAS' },
  { kode: '1036', nama: 'LPD 12.06558 PUNIA PIODALAN', tipe: 'KAS' },
  // Piutang (aktiva non-kas)
  { kode: '1050', nama: 'PIUTANG LAIN LAIN', tipe: 'PIUTANG' },
  // Hutang
  { kode: '2050', nama: 'HUTANG LAIN-LAIN', tipe: 'HUTANG' },
  // Modal
  { kode: '3000', nama: 'MODAL', tipe: 'MODAL' },
  { kode: '3001', nama: 'SALDO KUMULATIF MULAI 10 MARET 2018', tipe: 'MODAL' },
  { kode: '3002', nama: 'SALDO BERJALAN', tipe: 'MODAL' },
  // Pendapatan
  { kode: '4001', nama: 'PENDAPATAN BEJI', tipe: 'PENDAPATAN' },
  { kode: '4002', nama: 'PENDAPATAN TOILET', tipe: 'PENDAPATAN' },
  { kode: '4003', nama: 'PEDAPATAN KIOS', tipe: 'PENDAPATAN' },
  { kode: '4004', nama: 'PENDAPATAN SHUTLE BUS', tipe: 'PENDAPATAN' },
  { kode: '4005', nama: 'PENDAPATAN PARKIR', tipe: 'PENDAPATAN' },
  { kode: '4007', nama: 'PENDAPATAN KONTRAKAN', tipe: 'PENDAPATAN' },
  { kode: '4008', nama: 'PENDAPATAN PUNIA', tipe: 'PENDAPATAN' },
  { kode: '4009', nama: 'PENDAPATAN BUNGA BANK', tipe: 'PENDAPATAN' },
  { kode: '4020', nama: 'PENDAPATAN LABA PURA', tipe: 'PENDAPATAN' },
  { kode: '4041', nama: 'PENDAPATAN SESARI', tipe: 'PENDAPATAN' },
  { kode: '4042', nama: 'DANA PEMBANGUNAN / SHU DARI LPD', tipe: 'PENDAPATAN' },
  { kode: '4050', nama: 'PENDAPATAN LAIN LAIN', tipe: 'PENDAPATAN' },
  // Beban / Baga
  { kode: '5000', nama: 'BIAYA KESEKRETARIATAN', tipe: 'BEBAN' },
  { kode: '5001', nama: 'BAGA KASUKERTAN', tipe: 'BEBAN' },
  { kode: '5002', nama: 'BAGA PAMITEGEP', tipe: 'BEBAN' },
  { kode: '5003', nama: 'BAGA WEWANGUNAN', tipe: 'BEBAN' },
  { kode: '5004', nama: 'BAGA UPAKARA', tipe: 'BEBAN' },
  { kode: '5005', nama: 'BAGA WAHANA', tipe: 'BEBAN' },
  { kode: '5006', nama: 'BAGA HUMAS', tipe: 'BEBAN' },
  { kode: '5007', nama: 'BAGA BOGA', tipe: 'BEBAN' },
  { kode: '5008', nama: 'BAGA WEWALEN/DEKORASI', tipe: 'BEBAN' },
  { kode: '5009', nama: 'BAGA MERERESIK', tipe: 'BEBAN' },
  { kode: '5010', nama: 'BAGA SUAR (TELPON, LISTRIK, PDAM)', tipe: 'BEBAN' },
  { kode: '5030', nama: 'BIAYA PIODALAN', tipe: 'BEBAN' },
  { kode: '5031', nama: 'BIAYA PROYEK', tipe: 'BEBAN' },
  { kode: '5040', nama: 'BIAYA ADMINISTRASI DAN PAJAK BANK', tipe: 'BEBAN' },
  { kode: '5050', nama: 'BIAYA LAIN-LAIN', tipe: 'BEBAN' },
];

export const KAS_KODES = COA.filter((c) => c.tipe === 'KAS').map((c) => c.kode);
/** Rekening LPD (untuk grup "Total Saldo LPD" di dashboard). */
export const LPD_KODES = COA.filter((c) => c.tipe === 'KAS' && c.nama.includes('LPD')).map((c) => c.kode);
export const PENDAPATAN_KODES = COA.filter((c) => c.tipe === 'PENDAPATAN').map((c) => c.kode);
export const BEBAN_KODES = COA.filter((c) => c.tipe === 'BEBAN').map((c) => c.kode);

export const coaByKode = (kode: string): Coa | undefined => COA.find((c) => c.kode === kode);
export const isKas = (kode: string): boolean => KAS_KODES.includes(kode);
export const isPiutang = (kode: string): boolean => kode === '1050';
export const isPendapatan = (kode: string): boolean => PENDAPATAN_KODES.includes(kode);
export const isBeban = (kode: string): boolean => BEBAN_KODES.includes(kode);
