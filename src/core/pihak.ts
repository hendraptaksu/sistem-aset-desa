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
  /** Metadata opsional untuk daftar jurnal belum teralokasi. */
  no_bukti?: string;
  keterangan?: string;
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

/** Satu jurnal yang menyentuh 1050/2050 tetapi belum punya pihak. */
export type JurnalBelumTeralokasi = {
  jurnal_id: string;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  akun_kode: typeof AKUN_PIUTANG | typeof AKUN_HUTANG;
  /** Mutasi neto pada akun tersebut dalam posisi normal (bisa negatif untuk reversal). */
  nominal: number;
};

/**
 * Rekonsiliasi saldo akun 1050/2050 dengan `jurnal_pihak`.
 *
 * `teralokasi` = mutasi neto jurnal yang punya pemetaan pihak untuk akun itu.
 * `belum` = saldo akun − teralokasi, sehingga selalu:
 *   teralokasi + belum = saldo akun (posisi normal).
 *
 * Angka ini hanya untuk tampilan/laporan; TIDAK pernah disimpan ke DB.
 * Jurnal balik yang mewarisi pemetaan otomatis ikut teralokasi (nominalnya
 * negatif), sedangkan jurnal tanpa pemetaan tampil di `jurnalBelum`.
 */
export function rekonsiliasiPihak(
  baris: readonly BarisSaldoPihak[],
  mapping: readonly JurnalPihak[],
  sampai?: string,
): RekonsiliasiPihak {
  type MutasiJurnal = {
    jurnal_id: string;
    tanggal: string;
    no_bukti: string;
    keterangan: string;
    piutang: number;
    hutang: number;
  };

  const mutasi = new Map<string, MutasiJurnal>();
  let piutangAkun = 0;
  let hutangAkun = 0;

  baris.forEach((b, i) => {
    if (sampai && b.tanggal && b.tanggal > sampai) return;
    const kode = String(b.akun_kode ?? '').trim();
    if (kode !== AKUN_PIUTANG && kode !== AKUN_HUTANG) return;

    const jurnalId = String(b.jurnal_id ?? '').trim();
    // Baris tanpa ID tidak bisa dipetakan; pakai kunci unik agar totalnya
    // tetap muncul sebagai belum teralokasi, bukan hilang diam-diam.
    const kunci = jurnalId || `baris-${i + 1}`;
    const cur = mutasi.get(kunci) ?? {
      jurnal_id: jurnalId,
      tanggal: String(b.tanggal ?? ''),
      no_bukti: String(b.no_bukti ?? ''),
      keterangan: String(b.keterangan ?? ''),
      piutang: 0,
      hutang: 0,
    };
    if (!cur.tanggal && b.tanggal) cur.tanggal = String(b.tanggal);
    if (!cur.no_bukti && b.no_bukti) cur.no_bukti = String(b.no_bukti);
    if (!cur.keterangan && b.keterangan) cur.keterangan = String(b.keterangan);

    if (kode === AKUN_PIUTANG) {
      const nominal = b.debit - b.kredit;
      cur.piutang += nominal;
      piutangAkun += nominal;
    } else {
      const nominal = b.kredit - b.debit;
      cur.hutang += nominal;
      hutangAkun += nominal;
    }
    mutasi.set(kunci, cur);
  });

  const terpetakan = new Set<string>();
  for (const m of mapping) {
    const jurnalId = String(m.jurnal_id ?? '').trim();
    const kode = String(m.akun_kode ?? '').trim();
    if (!jurnalId) continue;
    if (kode !== AKUN_PIUTANG && kode !== AKUN_HUTANG) continue;
    terpetakan.add(`${jurnalId}\u0000${kode}`);
  }

  let piutangTeralokasi = 0;
  let hutangTeralokasi = 0;
  const jurnalBelum: JurnalBelumTeralokasi[] = [];

  for (const m of mutasi.values()) {
    const idPiutang = `${m.jurnal_id}\u0000${AKUN_PIUTANG}`;
    if (terpetakan.has(idPiutang)) {
      piutangTeralokasi += m.piutang;
    } else if (m.piutang !== 0) {
      jurnalBelum.push({
        jurnal_id: m.jurnal_id,
        tanggal: m.tanggal,
        no_bukti: m.no_bukti,
        keterangan: m.keterangan,
        akun_kode: AKUN_PIUTANG,
        nominal: m.piutang,
      });
    }

    const idHutang = `${m.jurnal_id}\u0000${AKUN_HUTANG}`;
    if (terpetakan.has(idHutang)) {
      hutangTeralokasi += m.hutang;
    } else if (m.hutang !== 0) {
      jurnalBelum.push({
        jurnal_id: m.jurnal_id,
        tanggal: m.tanggal,
        no_bukti: m.no_bukti,
        keterangan: m.keterangan,
        akun_kode: AKUN_HUTANG,
        nominal: m.hutang,
      });
    }
  }

  jurnalBelum.sort(
    (a, b) =>
      a.tanggal.localeCompare(b.tanggal) ||
      a.jurnal_id.localeCompare(b.jurnal_id) ||
      a.akun_kode.localeCompare(b.akun_kode),
  );

  // Selisih dihitung dari saldo akun − total teralokasi agar invariannya
  // eksplisit, bukan sekadar kebetulan jumlah daftar di atas.
  return {
    piutangAkun,
    hutangAkun,
    piutangTeralokasi,
    hutangTeralokasi,
    piutangBelum: piutangAkun - piutangTeralokasi,
    hutangBelum: hutangAkun - hutangTeralokasi,
    jurnalBelum,
  };
}

export type RekonsiliasiPihak = {
  /** Saldo 1050 dari jurnal (debit − kredit). */
  piutangAkun: number;
  /** Saldo 2050 dari jurnal (kredit − debit). */
  hutangAkun: number;
  piutangTeralokasi: number;
  hutangTeralokasi: number;
  piutangBelum: number;
  hutangBelum: number;
  jurnalBelum: JurnalBelumTeralokasi[];
};

/** Pesan inti saat jurnal menyentuh 1050/2050 tanpa pemetaan pihak. */
export const PESAN_PIHAK_BELUM_TERALOKASI =
  'Jurnal ini akan tampil sebagai belum teralokasi di Piutang & Hutang.';

/**
 * Peringatan (bukan error) untuk jalur Jurnal Umum/Import: jurnal yang memakai
 * 1050/2050 tanpa metadata pihak akan menambah selisih rekonsiliasi.
 */
export function peringatanPihakTanpaMapping(
  input: Pick<JurnalInput, 'baris'> | null | undefined,
): string[] {
  const baris = Array.isArray(input?.baris) ? input.baris : [];
  const akun = new Set<string>();
  for (const b of baris) {
    const kode = String(b?.akun_kode ?? '').trim();
    if (kode === AKUN_PIUTANG) akun.add('1050 Piutang');
    else if (kode === AKUN_HUTANG) akun.add('2050 Hutang');
  }
  if (akun.size === 0) return [];
  return [
    `Jurnal ini memakai akun ${[...akun].join(' dan ')} tanpa pihak. ` +
      `${PESAN_PIHAK_BELUM_TERALOKASI} Gunakan menu Piutang & Hutang agar saldo punya pihak.`,
  ];
}
