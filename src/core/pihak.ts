// Logika murni Piutang & Hutang per pihak (P1-5) — tanpa DB/Electron.
//
// Dua kelompok fungsi:
// 1. `klasifikasiAlurPihak` memvalidasi bahwa sebuah jurnal memang salah satu
//    dari lima alur baku (bukan jurnal bebas yang kebetulan menyentuh 1050/2050).
// 2. `saldoPihak` / `ringkasanSaldoPihak` menghitung saldo per pihak HANYA dari
//    baris jurnal + metadata `jurnal_pihak`. Tidak ada saldo tersimpan.

import {
  AKUN_HUTANG,
  AKUN_PIUTANG,
  isAkunKas,
  isBeban,
} from '../db/coa.js';
import type { JurnalInput } from './posting.js';
import type { JurnalPihak, JurnalJenis, Pihak, PihakSaldo } from './types.js';

/** Lima alur baku form Piutang & Hutang. */
export type AlurPihak =
  | 'BERI_PINJAMAN'
  | 'TERIMA_PELUNASAN'
  | 'TERIMA_PINJAMAN'
  | 'BAYAR_HUTANG'
  | 'BELI_KREDIT';

export type KlasifikasiAlurPihak = {
  alur: AlurPihak;
  /** Akun pihak yang dipetakan: 1050 (piutang) atau 2050 (hutang). */
  akunPihak: typeof AKUN_PIUTANG | typeof AKUN_HUTANG;
  /** Akun lawan: kas/bank, atau akun BEBAN untuk beli kredit. */
  akunLawan: string;
  nominal: number;
};

/**
 * Validasi ketat lima alur (dipakai adapter DB/IPC agar renderer tidak bisa
 * menyelipkan jurnal piutang/hutang di luar alur yang disediakan form).
 *
 * Aturan:
 * - tepat 2 baris: satu debit dan satu kredit, nominal sama > 0;
 * - 1050 hanya untuk jenis PIUTANG, 2050 hanya untuk jenis HUTANG;
 * - sisi kas harus akun kas/bank; beli kredit memakai akun BEBAN.
 */
export function klasifikasiAlurPihak(input: JurnalInput): KlasifikasiAlurPihak {
  const baris = Array.isArray(input?.baris) ? input.baris : [];
  if (baris.length !== 2)
    throw new Error(
      'Jurnal Piutang/Hutang wajib tepat 2 baris: satu debit dan satu kredit.',
    );

  const debit = baris.filter((b) => Number.isInteger(b.debit) && b.debit > 0);
  const kredit = baris.filter((b) => Number.isInteger(b.kredit) && b.kredit > 0);
  if (debit.length !== 1 || kredit.length !== 1)
    throw new Error('Jurnal Piutang/Hutang harus berisi satu sisi debit dan satu sisi kredit.');

  const d = debit[0]!;
  const k = kredit[0]!;
  if (d.debit !== k.kredit)
    throw new Error('Jurnal Piutang/Hutang tidak seimbang: nominal debit dan kredit harus sama.');
  const nominal = d.debit;
  if (nominal <= 0) throw new Error('Nominal Piutang/Hutang harus lebih dari 0.');

  const akunDebit = String(d.akun_kode ?? '').trim();
  const akunKredit = String(k.akun_kode ?? '').trim();
  const jenis = String(input.header?.jenis ?? 'UMUM') as JurnalJenis;
  const hasil = (alur: AlurPihak, akunPihak: KlasifikasiAlurPihak['akunPihak'], akunLawan: string) => {
    const jenisWajib: JurnalJenis = akunPihak === AKUN_PIUTANG ? 'PIUTANG' : 'HUTANG';
    if (jenis !== jenisWajib)
      throw new Error(
        `Jenis jurnal ${jenis} tidak sesuai alur piutang/hutang. Gunakan jenis ${jenisWajib}.`,
    );
    return { alur, akunPihak, akunLawan, nominal };
  };

  if (akunDebit === AKUN_PIUTANG && isAkunKas(akunKredit))
    return hasil('BERI_PINJAMAN', AKUN_PIUTANG, akunKredit);
  if (isAkunKas(akunDebit) && akunKredit === AKUN_PIUTANG)
    return hasil('TERIMA_PELUNASAN', AKUN_PIUTANG, akunDebit);
  if (isAkunKas(akunDebit) && akunKredit === AKUN_HUTANG)
    return hasil('TERIMA_PINJAMAN', AKUN_HUTANG, akunDebit);
  if (akunDebit === AKUN_HUTANG && isAkunKas(akunKredit))
    return hasil('BAYAR_HUTANG', AKUN_HUTANG, akunKredit);
  if (isBeban(akunDebit) && akunKredit === AKUN_HUTANG)
    return hasil('BELI_KREDIT', AKUN_HUTANG, akunDebit);

  throw new Error(
    'Alur Piutang/Hutang tidak dikenal. Pilih salah satu: beri pinjaman, pelunasan piutang, ' +
      'terima pinjaman, bayar hutang, atau beli/perbaikan kredit (D beban / K 2050).',
  );
}

/** Baris jurnal minimal untuk perhitungan saldo pihak. */
export type BarisSaldoPihak = {
  jurnal_id?: string;
  tanggal?: string;
  akun_kode: string;
  debit: number;
  kredit: number;
};

export type SaldoPihak = {
  pihakId: string;
  /** 1050: debit − kredit. Positif = pihak masih berhutang kepada kita. */
  piutang: number;
  /** 2050: kredit − debit. Positif = kita masih berhutang kepada pihak. */
  hutang: number;
  /** piutang − hutang. */
  neto: number;
};

type Mutasi = { piutang: number; hutang: number };

/**
 * Akumulasi mutasi akun 1050/2050 per jurnal, s/d cutoff (inklusif).
 * `jurnal_pihak` dianggap sudah memuat pemetaan jurnal balik (reversal)
 * sehingga koreksi otomatis mengurangi saldo pihak.
 */
function mutasiPerJurnal(
  baris: readonly BarisSaldoPihak[],
  sampai?: string,
): Map<string, Mutasi> {
  const hasil = new Map<string, Mutasi>();
  for (const b of baris) {
    if (sampai && b.tanggal && b.tanggal > sampai) continue;
    const id = String(b.jurnal_id ?? '').trim();
    if (!id) continue;
    if (b.akun_kode !== AKUN_PIUTANG && b.akun_kode !== AKUN_HUTANG) continue;
    const cur = hasil.get(id) ?? { piutang: 0, hutang: 0 };
    if (b.akun_kode === AKUN_PIUTANG) {
      cur.piutang += b.debit - b.kredit;
    } else {
      cur.hutang += b.kredit - b.debit;
    }
    hasil.set(id, cur);
  }
  return hasil;
}

function saldoMap(
  baris: readonly BarisSaldoPihak[],
  mapping: readonly JurnalPihak[],
  sampai?: string,
): Map<string, Mutasi> {
  const mutasi = mutasiPerJurnal(baris, sampai);
  const hasil = new Map<string, Mutasi>();
  for (const m of mapping) {
    const pihakId = String(m.pihak_id ?? '').trim();
    if (!pihakId) continue;
    if (m.akun_kode !== AKUN_PIUTANG && m.akun_kode !== AKUN_HUTANG) continue;
    const nilai = mutasi.get(String(m.jurnal_id ?? '').trim());
    if (!nilai) continue;
    const cur = hasil.get(pihakId) ?? { piutang: 0, hutang: 0 };
    if (m.akun_kode === AKUN_PIUTANG) cur.piutang += nilai.piutang;
    else cur.hutang += nilai.hutang;
    hasil.set(pihakId, cur);
  }
  return hasil;
}

/** Saldo satu pihak s/d cutoff. */
export function saldoPihak(
  baris: readonly BarisSaldoPihak[],
  mapping: readonly JurnalPihak[],
  pihakId: string,
  sampai?: string,
): SaldoPihak {
  const id = String(pihakId ?? '').trim();
  const nilai = saldoMap(baris, mapping, sampai).get(id) ?? { piutang: 0, hutang: 0 };
  return {
    pihakId: id,
    piutang: nilai.piutang,
    hutang: nilai.hutang,
    neto: nilai.piutang - nilai.hutang,
  };
}

/** Ringkasan piutang/hutang semua pihak (termasuk yang saldonya nol). */
export function ringkasanSaldoPihak(
  baris: readonly BarisSaldoPihak[],
  mapping: readonly JurnalPihak[],
  daftarPihak: readonly Pihak[],
  sampai?: string,
): PihakSaldo[] {
  const saldo = saldoMap(baris, mapping, sampai);
  return daftarPihak.map((p) => {
    const nilai = saldo.get(p.id) ?? { piutang: 0, hutang: 0 };
    return {
      ...p,
      piutang: nilai.piutang,
      hutang: nilai.hutang,
      neto: nilai.piutang - nilai.hutang,
    };
  });
}
