// Logika murni Piutang & Hutang per pihak (P1-5) — tanpa DB/Electron.
//
// Dua kelompok fungsi:
// 1. `klasifikasiAlurPihak` memvalidasi bahwa sebuah jurnal memang salah satu
//    dari enam alur baku (bukan jurnal bebas yang kebetulan menyentuh
//    1050/2050/2060).
// 2. `saldoPihak` / `ringkasanSaldoPihak` menghitung saldo per pihak HANYA dari
//    baris jurnal + metadata `jurnal_pihak`. Tidak ada saldo tersimpan.
//
// AKT-20: 2050 = pinjaman/legacy, 2060 = utang usaha. Total hutang pihak adalah
// 2050 + 2060; rincian per akun tetap tersedia agar overbalance diperiksa pada
// akun yang benar.

import {
  AKUN_HUTANG,
  AKUN_HUTANG_USAHA,
  AKUN_PIUTANG,
  COA,
  isAkunKas,
  isBeban,
  type Coa,
} from '../db/coa.js';
import type { JurnalInput } from './posting.js';
import type { JurnalPihak, JurnalJenis, Pihak, PihakSaldo } from './types.js';

/** Enam alur baku form Piutang & Hutang. */
export type AlurPihak =
  | 'BERI_PINJAMAN'
  | 'TERIMA_PELUNASAN'
  | 'TERIMA_PINJAMAN'
  | 'BAYAR_HUTANG'
  | 'BELI_KREDIT'
  | 'BAYAR_UTANG_USAHA';

export type KlasifikasiAlurPihak = {
  alur: AlurPihak;
  /** Akun pihak yang dipetakan: 1050 (piutang), 2050 (pinjaman), atau 2060 (utang usaha). */
  akunPihak: typeof AKUN_PIUTANG | typeof AKUN_HUTANG | typeof AKUN_HUTANG_USAHA;
  /** Akun lawan: kas/bank, atau akun BEBAN untuk beli kredit. */
  akunLawan: string;
  nominal: number;
};

/**
 * Validasi ketat enam alur (dipakai adapter DB/IPC agar renderer tidak bisa
 * menyelipkan jurnal piutang/hutang di luar alur yang disediakan form).
 *
 * Aturan:
 * - tepat 2 baris: satu debit dan satu kredit, nominal sama > 0;
 * - 1050 hanya untuk jenis PIUTANG, 2050/2060 hanya untuk jenis HUTANG;
 * - sisi kas harus akun kas/bank; beli kredit memakai akun BEBAN.
 * - D beban / K 2050 tetap diterima sebagai BELI_KREDIT legacy agar jurnal lama
 *   tidak rusak; form baru selalu memakai 2060.
 */
export function klasifikasiAlurPihak(
  input: JurnalInput,
  daftarAkun: readonly Coa[] = COA,
): KlasifikasiAlurPihak {
  const baris = Array.isArray(input?.baris) ? input.baris : [];
  if (baris.length !== 2)
    throw new Error(
      'Jurnal Piutang/Hutang wajib tepat 2 baris: satu debit dan satu kredit.',
    );

  const debit = baris.filter((b) => Number.isSafeInteger(b.debit) && b.debit > 0);
  const kredit = baris.filter((b) => Number.isSafeInteger(b.kredit) && b.kredit > 0);
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
  const bebanDebit =
    isBeban(akunDebit) || daftarAkun.find((a) => a.kode === akunDebit)?.tipe === 'BEBAN';
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
  if (akunDebit === AKUN_HUTANG_USAHA && isAkunKas(akunKredit))
    return hasil('BAYAR_UTANG_USAHA', AKUN_HUTANG_USAHA, akunKredit);
  if (bebanDebit && akunKredit === AKUN_HUTANG_USAHA)
    return hasil('BELI_KREDIT', AKUN_HUTANG_USAHA, akunDebit);
  if (bebanDebit && akunKredit === AKUN_HUTANG)
    return hasil('BELI_KREDIT', AKUN_HUTANG, akunDebit);

  throw new Error(
    'Alur Piutang/Hutang tidak dikenal. Pilih salah satu: beri pinjaman, pelunasan piutang, ' +
      'terima pinjaman, bayar pinjaman, bayar utang usaha, atau beli/perbaikan kredit ' +
      '(D beban / K 2060).',
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
  /** Total hutang kepada pihak: pinjaman (2050) + utang usaha (2060). */
  hutang: number;
  /** 2050: kredit − debit. Positif = pinjaman yang masih harus dibayar. */
  pinjaman: number;
  /** 2060: kredit − debit. Positif = utang usaha yang masih harus dibayar. */
  hutangUsaha: number;
  /** piutang − hutang. */
  neto: number;
};

type Mutasi = { piutang: number; pinjaman: number; hutangUsaha: number };

/**
 * Akumulasi mutasi akun 1050/2050/2060 per jurnal, s/d cutoff (inklusif).
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
    const kode = String(b.akun_kode ?? '').trim();
    if (
      kode !== AKUN_PIUTANG &&
      kode !== AKUN_HUTANG &&
      kode !== AKUN_HUTANG_USAHA
    )
      continue;
    const cur = hasil.get(id) ?? { piutang: 0, pinjaman: 0, hutangUsaha: 0 };
    if (kode === AKUN_PIUTANG) {
      cur.piutang += b.debit - b.kredit;
    } else if (kode === AKUN_HUTANG) {
      cur.pinjaman += b.kredit - b.debit;
    } else {
      cur.hutangUsaha += b.kredit - b.debit;
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
    const kode = String(m.akun_kode ?? '').trim();
    if (
      kode !== AKUN_PIUTANG &&
      kode !== AKUN_HUTANG &&
      kode !== AKUN_HUTANG_USAHA
    )
      continue;
    const nilai = mutasi.get(String(m.jurnal_id ?? '').trim());
    if (!nilai) continue;
    const cur = hasil.get(pihakId) ?? { piutang: 0, pinjaman: 0, hutangUsaha: 0 };
    if (kode === AKUN_PIUTANG) cur.piutang += nilai.piutang;
    else if (kode === AKUN_HUTANG) cur.pinjaman += nilai.pinjaman;
    else cur.hutangUsaha += nilai.hutangUsaha;
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
  const nilai = saldoMap(baris, mapping, sampai).get(id) ?? {
    piutang: 0,
    pinjaman: 0,
    hutangUsaha: 0,
  };
  const hutang = nilai.pinjaman + nilai.hutangUsaha;
  return {
    pihakId: id,
    piutang: nilai.piutang,
    hutang,
    pinjaman: nilai.pinjaman,
    hutangUsaha: nilai.hutangUsaha,
    neto: nilai.piutang - hutang,
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
    const nilai = saldo.get(p.id) ?? { piutang: 0, pinjaman: 0, hutangUsaha: 0 };
    const hutang = nilai.pinjaman + nilai.hutangUsaha;
    return {
      ...p,
      piutang: nilai.piutang,
      hutang,
      pinjaman: nilai.pinjaman,
      hutangUsaha: nilai.hutangUsaha,
      neto: nilai.piutang - hutang,
    };
  });
}

/** Satu jurnal yang menyentuh 1050/2050/2060 tetapi belum punya pihak. */
export type JurnalBelumTeralokasi = {
  jurnal_id: string;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  akun_kode: typeof AKUN_PIUTANG | typeof AKUN_HUTANG | typeof AKUN_HUTANG_USAHA;
  /** Mutasi neto pada akun tersebut dalam posisi normal (bisa negatif untuk reversal). */
  nominal: number;
};

/**
 * Rekonsiliasi saldo akun 1050/2050/2060 dengan `jurnal_pihak`.
 *
 * `teralokasi` = mutasi neto jurnal yang punya pemetaan pihak untuk akun itu.
 * `belum` = saldo akun − teralokasi, sehingga selalu:
 *   teralokasi + belum = saldo akun (posisi normal).
 *
 * `hutangAkun`/`hutang**` khusus 2050 (pinjaman) agar kompatibel dengan
 * pemanggil lama; 2060 punya field `hutangUsaha**` terpisah. Tidak ada angka
 * yang disimpan ke DB.
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
    hutangUsaha: number;
  };

  const mutasi = new Map<string, MutasiJurnal>();
  let piutangAkun = 0;
  let hutangAkun = 0;
  let hutangUsahaAkun = 0;

  baris.forEach((b, i) => {
    if (sampai && b.tanggal && b.tanggal > sampai) return;
    const kode = String(b.akun_kode ?? '').trim();
    if (
      kode !== AKUN_PIUTANG &&
      kode !== AKUN_HUTANG &&
      kode !== AKUN_HUTANG_USAHA
    )
      return;

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
      hutangUsaha: 0,
    };
    if (!cur.tanggal && b.tanggal) cur.tanggal = String(b.tanggal);
    if (!cur.no_bukti && b.no_bukti) cur.no_bukti = String(b.no_bukti);
    if (!cur.keterangan && b.keterangan) cur.keterangan = String(b.keterangan);

    if (kode === AKUN_PIUTANG) {
      const nominal = b.debit - b.kredit;
      cur.piutang += nominal;
      piutangAkun += nominal;
    } else if (kode === AKUN_HUTANG) {
      const nominal = b.kredit - b.debit;
      cur.hutang += nominal;
      hutangAkun += nominal;
    } else {
      const nominal = b.kredit - b.debit;
      cur.hutangUsaha += nominal;
      hutangUsahaAkun += nominal;
    }
    mutasi.set(kunci, cur);
  });

  const terpetakan = new Set<string>();
  for (const m of mapping) {
    const jurnalId = String(m.jurnal_id ?? '').trim();
    const kode = String(m.akun_kode ?? '').trim();
    if (!jurnalId) continue;
    if (
      kode !== AKUN_PIUTANG &&
      kode !== AKUN_HUTANG &&
      kode !== AKUN_HUTANG_USAHA
    )
      continue;
    terpetakan.add(`${jurnalId}\u0000${kode}`);
  }

  let piutangTeralokasi = 0;
  let hutangTeralokasi = 0;
  let hutangUsahaTeralokasi = 0;
  const jurnalBelum: JurnalBelumTeralokasi[] = [];

  const catatBelum = (
    m: MutasiJurnal,
    kode: JurnalBelumTeralokasi['akun_kode'],
    nominal: number,
  ): void => {
    if (nominal === 0) return;
    jurnalBelum.push({
      jurnal_id: m.jurnal_id,
      tanggal: m.tanggal,
      no_bukti: m.no_bukti,
      keterangan: m.keterangan,
      akun_kode: kode,
      nominal,
    });
  };

  for (const m of mutasi.values()) {
    const idPiutang = `${m.jurnal_id}\u0000${AKUN_PIUTANG}`;
    if (terpetakan.has(idPiutang)) {
      piutangTeralokasi += m.piutang;
    } else {
      catatBelum(m, AKUN_PIUTANG, m.piutang);
    }

    const idHutang = `${m.jurnal_id}\u0000${AKUN_HUTANG}`;
    if (terpetakan.has(idHutang)) {
      hutangTeralokasi += m.hutang;
    } else {
      catatBelum(m, AKUN_HUTANG, m.hutang);
    }

    const idHutangUsaha = `${m.jurnal_id}\u0000${AKUN_HUTANG_USAHA}`;
    if (terpetakan.has(idHutangUsaha)) {
      hutangUsahaTeralokasi += m.hutangUsaha;
    } else {
      catatBelum(m, AKUN_HUTANG_USAHA, m.hutangUsaha);
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
    hutangUsahaAkun,
    piutangTeralokasi,
    hutangTeralokasi,
    hutangUsahaTeralokasi,
    piutangBelum: piutangAkun - piutangTeralokasi,
    hutangBelum: hutangAkun - hutangTeralokasi,
    hutangUsahaBelum: hutangUsahaAkun - hutangUsahaTeralokasi,
    jurnalBelum,
  };
}

export type RekonsiliasiPihak = {
  /** Saldo 1050 dari jurnal (debit − kredit). */
  piutangAkun: number;
  /** Saldo 2050 dari jurnal (kredit − debit) — pinjaman/legacy. */
  hutangAkun: number;
  /** Saldo 2060 dari jurnal (kredit − debit) — utang usaha. */
  hutangUsahaAkun: number;
  piutangTeralokasi: number;
  hutangTeralokasi: number;
  hutangUsahaTeralokasi: number;
  piutangBelum: number;
  hutangBelum: number;
  hutangUsahaBelum: number;
  jurnalBelum: JurnalBelumTeralokasi[];
};

/** Pesan inti saat jurnal menyentuh 1050/2050/2060 tanpa pemetaan pihak. */
export const PESAN_PIHAK_BELUM_TERALOKASI =
  'Jurnal ini akan tampil sebagai belum teralokasi di Piutang & Hutang.';

/**
 * Peringatan (bukan error) untuk jalur Jurnal Umum/Import: jurnal yang memakai
 * 1050/2050/2060 tanpa metadata pihak akan menambah selisih rekonsiliasi.
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
    else if (kode === AKUN_HUTANG_USAHA) akun.add('2060 Utang Usaha');
  }
  if (akun.size === 0) return [];
  return [
    `Jurnal ini memakai akun ${[...akun].join(' dan ')} tanpa pihak. ` +
      `${PESAN_PIHAK_BELUM_TERALOKASI} Gunakan menu Piutang & Hutang agar saldo punya pihak.`,
  ];
}
