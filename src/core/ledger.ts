// Pure functions akuntansi — tanpa dependency DB/Electron.
// Semua filter tanggal memakai string YYYY-MM-DD (perbandingan leksikografis aman).

import { isBeban, isKas, isPendapatan } from '../db/coa.js';
import type { AuditLog, Panjar, PanjarItem, Transaksi, TutupBuku } from './types.js';

export const yearOf = (tanggal: string): number => Number(tanggal.slice(0, 4));

/** Saldo satu dompet kas s/d cut-off (inklusif). */
export function saldoKas(transaksi: Transaksi[], akunKas: string, cutoff?: string): number {
  return transaksi
    .filter((t) => t.akun_kas === akunKas && (!cutoff || t.tanggal <= cutoff))
    .reduce((s, t) => s + t.masuk - t.keluar, 0);
}

/** Saldo semua dompet kas. */
export function saldoSemuaKas(
  transaksi: Transaksi[],
  kasKodes: string[],
  cutoff?: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of kasKodes) out[k] = saldoKas(transaksi, k, cutoff);
  return out;
}

/** Total per kategori (untuk Pembantu / Realisasi / Surplus). */
export function totalPerKategori(
  transaksi: Transaksi[],
  mulai?: string,
  sampai?: string,
): Record<string, { masuk: number; keluar: number; neto: number }> {
  const out: Record<string, { masuk: number; keluar: number; neto: number }> = {};
  for (const t of transaksi) {
    if (mulai && t.tanggal < mulai) continue;
    if (sampai && t.tanggal > sampai) continue;
    const cur = out[t.kategori] ?? { masuk: 0, keluar: 0, neto: 0 };
    cur.masuk += t.masuk;
    cur.keluar += t.keluar;
    cur.neto = cur.masuk - cur.keluar;
    out[t.kategori] = cur;
  }
  return out;
}

export function totalPendapatan(transaksi: Transaksi[], mulai?: string, sampai?: string): number {
  return transaksi
    .filter(
      (t) =>
        isPendapatan(t.kategori) && (!mulai || t.tanggal >= mulai) && (!sampai || t.tanggal <= sampai),
    )
    .reduce((s, t) => s + t.masuk - t.keluar, 0);
}

export function totalBeban(transaksi: Transaksi[], mulai?: string, sampai?: string): number {
  return transaksi
    .filter(
      (t) => isBeban(t.kategori) && (!mulai || t.tanggal >= mulai) && (!sampai || t.tanggal <= sampai),
    )
    .reduce((s, t) => s + t.keluar - t.masuk, 0);
}

/** Surplus/(Defisit) periode bebas = Pendapatan - Beban. Negatif = defisit. */
export function surplus(transaksi: Transaksi[], mulai?: string, sampai?: string): number {
  return totalPendapatan(transaksi, mulai, sampai) - totalBeban(transaksi, mulai, sampai);
}

/** Total hutang 2050 s/d cut-off. Masuk = tambah hutang, keluar = bayar hutang. */
export function totalHutang(transaksi: Transaksi[], cutoff?: string): number {
  return transaksi
    .filter((t) => t.kategori === '2050' && (!cutoff || t.tanggal <= cutoff))
    .reduce((s, t) => s + t.masuk - t.keluar, 0);
}

/** Total piutang 1050 s/d cut-off. Keluar = pinjaman diberikan, masuk = pelunasan. */
export function totalPiutang(transaksi: Transaksi[], cutoff?: string): number {
  return transaksi
    .filter((t) => t.kategori === '1050' && (!cutoff || t.tanggal <= cutoff))
    .reduce((s, t) => s + t.keluar - t.masuk, 0);
}

/** Modal awal 3000 s/d cut-off (biasanya sekali di awal). */
export function totalModalAwal(transaksi: Transaksi[], cutoff?: string): number {
  return transaksi
    .filter((t) => t.kategori === '3000' && (!cutoff || t.tanggal <= cutoff))
    .reduce((s, t) => s + t.masuk - t.keluar, 0);
}

export type Neraca = {
  cutoff: string;
  aktiva: number;
  aktivaRinci: { kas: Record<string, number>; piutang: number; panjarOpen: number };
  hutang: number;
  modalAwal: number;
  kumulatif: number;
  berjalan: number;
  pasiva: number;
  selisih: number;
  balance: boolean;
};

/**
 * Neraca per cut-off.
 * Aktiva = SUM saldo kas + Piutang 1050 + Panjar OPEN.
 * Pasiva = Hutang + Modal + Kumulatif + Berjalan.
 * Kumulatif = SUM laba tahun < tahun(cutoff) dari tutup_buku. Berjalan = laba 01-01 s/d cutoff.
 */
export function neraca(
  transaksi: Transaksi[],
  panjar: Panjar[],
  tutup: TutupBuku[],
  cutoff: string,
  kasKodes: string[],
): Neraca {
  const kas = saldoSemuaKas(transaksi, kasKodes, cutoff);
  const totalKas = Object.values(kas).reduce((s, v) => s + v, 0);
  const panjarOpen = panjar
    .filter((p) => p.status === 'OPEN' && p.tanggal <= cutoff)
    .reduce((s, p) => s + p.jumlah, 0);
  const piutang = totalPiutang(transaksi, cutoff);
  const aktiva = totalKas + piutang + panjarOpen;

  const tahun = yearOf(cutoff);
  const kumulatif = tutup.filter((t) => t.tahun < tahun).reduce((s, t) => s + t.laba, 0);
  const berjalan = surplus(transaksi, `${tahun}-01-01`, cutoff);
  const hutang = totalHutang(transaksi, cutoff);
  const modalAwal = totalModalAwal(transaksi, cutoff);
  const pasiva = hutang + modalAwal + kumulatif + berjalan;
  const selisih = aktiva - pasiva;
  return {
    cutoff,
    aktiva,
    aktivaRinci: { kas, piutang, panjarOpen },
    hutang,
    modalAwal,
    kumulatif,
    berjalan,
    pasiva,
    selisih,
    balance: selisih === 0,
  };
}

/** Hitung laba setahun untuk Tutup Buku. */
export function labaTahun(transaksi: Transaksi[], tahun: number): number {
  return surplus(transaksi, `${tahun}-01-01`, `${tahun}-12-31`);
}

// ---- Panjar ----

/**
 * Kategori sistem untuk arus Panjar (BUKAN akun COA, tidak masuk 4xxx/5xxx).
 * Dipakai agar mutasi panjar menggerakkan Kas TANPA dihitung sebagai
 * Pendapatan/Beban di Surplus & Realisasi. Laporan boleh menampilkannya
 * sebagai baris "Mutasi Panjar" atau mengabaikannya.
 */
export const PANJAR_KATEGORI = 'PANJAR';

/** Baris BKU yang harus dibuat saat Panjar OPEN: keluar dari kas sumber. */
export function panjarOpenToTransaksi(p: Panjar, keterangan?: string): Transaksi {
  return {
    id: `bku-${p.id}-open`,
    tanggal: p.tanggal,
    keterangan: keterangan ?? `Panjar ${p.penerima}`,
    akun_kas: p.akun_kas_sumber,
    kategori: PANJAR_KATEGORI,
    masuk: 0,
    keluar: p.jumlah,
  };
}

export type PanjarCloseResult = {
  /** Baris Beban per Baga (keluar riil dari kas). */
  bebanRows: Transaksi[];
  /** Baris kompensasi: menghabiskan aset Panjar (masuk, kategori PANJAR). */
  kompensasiRow: Transaksi;
  /** Sisa kembali ke kas (masuk, kategori PANJAR). Null jika pas/kurang. */
  sisaRow: Transaksi | null;
};

/**
 * Saat CLOSE: realisasi belanja jadi baris Beban per Baga (keluar riil),
 * diimbangi baris kompensasi kategori PANJAR (aset panjar habis, kas netral),
 * plus sisa kembali jika belanja < panjar.
 * Invarian kas: OPEN keluar J; CLOSE net = -(R) + min(R,J) [+ S jika sisa]
 * = -R (sisa) atau -J-E = -R (kurang, E=R-J tertinggal di kas secara otomatis
 * lewat baris beban — TIDAK perlu baris kurang terpisah).
 * Invarian neraca: Aktiva Δ = -R, Berjalan Δ = -R → tetap BALANCE.
 */
export function panjarCloseToTransaksi(
  p: Panjar,
  items: PanjarItem[],
  tanggalClose: string,
): PanjarCloseResult {
  const totalRealisasi = items.reduce((s, i) => s + i.nominal, 0);
  const bebanRows: Transaksi[] = items.map((it, idx) => ({
    id: `bku-${p.id}-real-${idx + 1}`,
    tanggal: tanggalClose,
    keterangan: `Realisasi panjar ${p.penerima} — ${it.kategori_baga}`,
    akun_kas: p.akun_kas_sumber,
    kategori: it.kategori_baga,
    masuk: 0,
    keluar: it.nominal,
  }));
  const kompensasi = Math.min(totalRealisasi, p.jumlah);
  const kompensasiRow: Transaksi = {
    id: `bku-${p.id}-komp`,
    tanggal: tanggalClose,
    keterangan: `Penyelesaian panjar ${p.penerima}`,
    akun_kas: p.akun_kas_sumber,
    kategori: PANJAR_KATEGORI,
    masuk: kompensasi,
    keluar: 0,
  };
  const sisa = p.jumlah - totalRealisasi;
  const sisaRow: Transaksi | null =
    sisa > 0
      ? {
          id: `bku-${p.id}-sisa`,
          tanggal: tanggalClose,
          keterangan: `Sisa panjar ${p.penerima}`,
          akun_kas: p.akun_kas_sumber,
          kategori: PANJAR_KATEGORI,
          masuk: sisa,
          keluar: 0,
        }
      : null;
  return { bebanRows, kompensasiRow, sisaRow };
}

// ---- Kunci longgar ----

/** Tahun terakhir yang sudah tutup. Null = belum pernah tutup. */
export function tahunTutupTerakhir(tutup: TutupBuku[]): number | null {
  if (tutup.length === 0) return null;
  return Math.max(...tutup.map((t) => t.tahun));
}

/** Apakah tanggal masuk periode terkunci (<= 31-12 tahun tutup terakhir)? */
export function isPeriodeTerkunci(tanggal: string, tutup: TutupBuku[]): boolean {
  const last = tahunTutupTerakhir(tutup);
  if (last === null) return false;
  return tanggal <= `${last}-12-31`;
}

/**
 * Validasi simpan dengan kunci longgar: boleh simpan, tapi jika periode terkunci
 * wajib ada alasan (dicatat ke audit_log oleh caller).
 */
export function validasiSimpanLonggar(
  tanggal: string,
  tutup: TutupBuku[],
  alasan?: string,
): { boleh: boolean; perluAlasan: boolean; error?: string } {
  if (!isPeriodeTerkunci(tanggal, tutup)) return { boleh: true, perluAlasan: false };
  if (!alasan || alasan.trim().length < 5)
    return { boleh: false, perluAlasan: true, error: 'Periode sudah ditutup: wajib isi alasan ≥5 karakter.' };
  return { boleh: true, perluAlasan: true };
}

export function buatAuditLog(aksi: string, alasan: string, dataLama: unknown): AuditLog {
  return {
    id: `audit-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    tanggal: new Date().toISOString(),
    aksi,
    alasan,
    data_lama_json: JSON.stringify(dataLama),
  };
}

export { isKas };
