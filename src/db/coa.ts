// Seed COA persis PRD §2. Catatan: grup "1000-AKTIVA" dipisah dari akun "1000 Kas Tunai"
// agar tidak tabrakan kode (grup = prefix, akun = kode penuh).

export type CoaTipe = 'KAS' | 'HUTANG' | 'MODAL' | 'PENDAPATAN' | 'BEBAN';

export type Coa = { kode: string; nama: string; tipe: CoaTipe };

export const COA: Coa[] = [
  // Aktiva — dompet (1000-1029)
  { kode: '1000', nama: 'Kas Tunai', tipe: 'KAS' },
  { kode: '1010', nama: 'LPD Kios', tipe: 'KAS' },
  { kode: '1014', nama: 'LPD Utama', tipe: 'KAS' },
  { kode: '1015', nama: 'LPD Parkir', tipe: 'KAS' },
  { kode: '1016', nama: 'LPD Beji', tipe: 'KAS' },
  { kode: '1017', nama: 'LPD Shuttle Bus', tipe: 'KAS' },
  { kode: '1018', nama: 'LPD Toilet', tipe: 'KAS' },
  { kode: '1028', nama: 'KSU Usaha Mandiri', tipe: 'KAS' },
  { kode: '1029', nama: 'Bank BPD Ubud', tipe: 'KAS' },
  // Pasiva
  { kode: '2050', nama: 'Hutang Lain-Lain', tipe: 'HUTANG' },
  // Ekuitas
  { kode: '3000', nama: 'Modal / Saldo Awal', tipe: 'MODAL' },
  { kode: '3001', nama: 'Saldo Kumulatif', tipe: 'MODAL' },
  { kode: '3002', nama: 'Saldo Berjalan', tipe: 'MODAL' },
  // Pendapatan
  { kode: '4001', nama: 'Pendapatan Parkir', tipe: 'PENDAPATAN' },
  { kode: '4002', nama: 'Air Beji', tipe: 'PENDAPATAN' },
  { kode: '4003', nama: 'Sewa Tanah', tipe: 'PENDAPATAN' },
  { kode: '4004', nama: 'Sewa Toko/Kios', tipe: 'PENDAPATAN' },
  { kode: '4005', nama: 'Wewedalan Krame', tipe: 'PENDAPATAN' },
  { kode: '4006', nama: 'Sesari', tipe: 'PENDAPATAN' },
  { kode: '4007', nama: 'Punia', tipe: 'PENDAPATAN' },
  { kode: '4008', nama: 'Pendapatan Lain-lain', tipe: 'PENDAPATAN' },
  // Beban per Baga
  { kode: '5002', nama: 'Baga Pamitegep', tipe: 'BEBAN' },
  { kode: '5003', nama: 'Baga Wewangunan', tipe: 'BEBAN' },
  { kode: '5004', nama: 'Baga Upakara / Piodalan', tipe: 'BEBAN' },
  { kode: '5005', nama: 'Baga Wahana', tipe: 'BEBAN' },
  { kode: '5006', nama: 'Biaya Humas / Rapat / Besuk', tipe: 'BEBAN' },
  { kode: '5007', nama: 'Biaya Operasional', tipe: 'BEBAN' },
];

export const KAS_KODES = COA.filter((c) => c.tipe === 'KAS').map((c) => c.kode);
export const PENDAPATAN_KODES = COA.filter((c) => c.tipe === 'PENDAPATAN').map((c) => c.kode);
export const BEBAN_KODES = COA.filter((c) => c.tipe === 'BEBAN').map((c) => c.kode);

export const coaByKode = (kode: string): Coa | undefined => COA.find((c) => c.kode === kode);
export const isKas = (kode: string): boolean => KAS_KODES.includes(kode);
export const isPendapatan = (kode: string): boolean => PENDAPATAN_KODES.includes(kode);
export const isBeban = (kode: string): boolean => BEBAN_KODES.includes(kode);
