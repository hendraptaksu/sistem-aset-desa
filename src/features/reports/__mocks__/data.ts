// Mock Agent B — 20 baris dummy mengikuti kontrak Transaksi + COA PRD §2.
// Dipakai untuk UI dev + test tanpa menunggu DB. Saat schema asli ada,
// tinggal ganti import getTransaksi → repository.listTransaksi(db); logika tidak berubah.
// READ-ONLY terhadap skema: file ini TIDAK menyentuh src/db/schema.

import type { Panjar, Transaksi, TutupBuku } from '../../../core/types.js';

export const MOCK_TRANSAKSI: Transaksi[] = [
  { id: 'm01', tanggal: '2025-01-05', keterangan: 'Modal awal', akun_kas: '1000', kategori: '3000', masuk: 10_000_000, keluar: 0 },
  { id: 'm02', tanggal: '2025-02-10', keterangan: 'Parkir', akun_kas: '1015', kategori: '4001', masuk: 5_000_000, keluar: 0 },
  { id: 'm03', tanggal: '2025-02-15', keterangan: 'Air Beji', akun_kas: '1016', kategori: '4002', masuk: 2_000_000, keluar: 0 },
  { id: 'm04', tanggal: '2025-03-01', keterangan: 'Sewa Tanah', akun_kas: '1000', kategori: '4003', masuk: 3_000_000, keluar: 0 },
  { id: 'm05', tanggal: '2025-03-05', keterangan: 'Sewa Toko/Kios', akun_kas: '1010', kategori: '4004', masuk: 1_500_000, keluar: 0 },
  { id: 'm06', tanggal: '2025-03-10', keterangan: 'Wewedalan Krame', akun_kas: '1000', kategori: '4005', masuk: 750_000, keluar: 0 },
  { id: 'm07', tanggal: '2025-03-12', keterangan: 'Sesari', akun_kas: '1000', kategori: '4006', masuk: 500_000, keluar: 0 },
  { id: 'm08', tanggal: '2025-04-01', keterangan: 'Punia', akun_kas: '1000', kategori: '4007', masuk: 1_000_000, keluar: 0 },
  { id: 'm09', tanggal: '2025-04-05', keterangan: 'Pendapatan Lain-lain', akun_kas: '1029', kategori: '4008', masuk: 250_000, keluar: 0 },
  { id: 'm10', tanggal: '2025-03-15', keterangan: 'Belanja rutin pamitegep', akun_kas: '1000', kategori: '5002', masuk: 0, keluar: 800_000 },
  { id: 'm11', tanggal: '2025-04-10', keterangan: 'Renovasi wewangunan', akun_kas: '1029', kategori: '5003', masuk: 0, keluar: 2_000_000 },
  { id: 'm12', tanggal: '2025-03-12', keterangan: 'Upakara', akun_kas: '1000', kategori: '5004', masuk: 0, keluar: 2_000_000 },
  { id: 'm13', tanggal: '2025-04-12', keterangan: 'Transport wahana', akun_kas: '1015', kategori: '5005', masuk: 0, keluar: 1_000_000 },
  { id: 'm14', tanggal: '2025-04-15', keterangan: 'Rapat humas', akun_kas: '1000', kategori: '5006', masuk: 0, keluar: 600_000 },
  { id: 'm15', tanggal: '2025-04-18', keterangan: 'Listrik & ATK', akun_kas: '1000', kategori: '5007', masuk: 0, keluar: 900_000 },
  // Mutasi panjar (kategori sistem PANJAR — ekslusif dari Pendapatan/Beban)
  { id: 'bku-p1-open', tanggal: '2025-04-01', keterangan: 'Panjar Panitia Piodalan', akun_kas: '1000', kategori: 'PANJAR', masuk: 0, keluar: 5_000_000 },
  { id: 'bku-p1-komp', tanggal: '2025-04-20', keterangan: 'Penyelesaian panjar Panitia Piodalan', akun_kas: '1000', kategori: 'PANJAR', masuk: 4_500_000, keluar: 0 },
  { id: 'bku-p1-real-1', tanggal: '2025-04-20', keterangan: 'Realisasi panjar Panitia Piodalan — 5004', akun_kas: '1000', kategori: '5004', masuk: 0, keluar: 4_500_000 },
  { id: 'bku-p1-sisa', tanggal: '2025-04-20', keterangan: 'Sisa panjar Panitia Piodalan', akun_kas: '1000', kategori: 'PANJAR', masuk: 500_000, keluar: 0 },
  // Hutang (2050) — masuk menambah hutang, TIDAK masuk Surplus
  { id: 'm20', tanggal: '2025-05-01', keterangan: 'Pinjaman warung', akun_kas: '1000', kategori: '2050', masuk: 1_000_000, keluar: 0 },
];

export const MOCK_PANJAR: Panjar[] = [
  { id: 'p1', tanggal: '2025-04-01', penerima: 'Panitia Piodalan', jumlah: 5_000_000, akun_kas_sumber: '1000', status: 'CLOSED' },
];

export const MOCK_TUTUP: TutupBuku[] = [];

export type TransaksiFilter = {
  mulai?: string;
  sampai?: string;
  akun_kas?: string;
  kategori?: string;
};

/** Interface getTransaksi(filter) — mock & repository.listTransaksi(db) sama-sama memenuhi ini. */
export type GetTransaksi = (filter?: TransaksiFilter) => Transaksi[];

function matchRange(tanggal: string, mulai?: string, sampai?: string): boolean {
  if (mulai && tanggal < mulai) return false;
  if (sampai && tanggal > sampai) return false;
  return true;
}

/** Query di atas mock lewat interface getTransaksi(filter). */
export function getTransaksiMock(filter: TransaksiFilter = {}): Transaksi[] {
  return MOCK_TRANSAKSI.filter(
    (t) =>
      matchRange(t.tanggal, filter.mulai, filter.sampai) &&
      (!filter.akun_kas || t.akun_kas === filter.akun_kas) &&
      (!filter.kategori || t.kategori === filter.kategori),
  ).sort((a, b) => (a.tanggal < b.tanggal ? -1 : a.tanggal > b.tanggal ? 1 : 0));
}
