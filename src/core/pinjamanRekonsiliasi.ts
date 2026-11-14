// DB-16f — rekonsiliasi outstanding 2050 vs jadwal pinjaman LPD.
//
// Fungsi murni: TIDAK membaca DB dan TIDAK menulis apa pun. Adapter DB
// menyiapkan baris jurnal yang sudah dibatasi ke jurnal milik pinjaman ini.
//
// Dua angka yang dibandingkan:
//
// 1. `gl` = outstanding menurut jurnal 2050 yang TERTAUT ke pinjaman:
//    - pinjaman dengan jurnal pencairan (`jurnal_pencairan_id` terisi):
//      kredit neto 2050 pada jurnal pencairan dikurangi debit neto 2050 pada
//      seluruh jurnal pembayaran yang ditautkan lewat `pinjaman_bayar`;
//    - pinjaman berjalan (`jurnal_pencairan_id` null): bagian kredit neto 2050
//      dari grup jurnal `SALDO_AWAL` yang dialokasikan ke pinjaman ini,
//      dikurangi debit neto 2050 pada jurnal pembayaran tertaut. Nilai ini
//      berasal dari GL aktual, BUKAN salinan `sisa_pokok_awal`.
//
// 2. `jadwal` = `sisa_pokok_awal` dikurangi jumlah POKOK AKTUAL dari jurnal
//    pembayaran yang ditautkan. Pokok aktual diambil dari debit 2050 bila ada.
//    Bila jurnal pembayaran tidak memuat 2050 (mis. pokok salah akun), pokok
//    aktual dihitung dari sisa debit setelah bunga dan denda; dengan begitu
//    jurnal pembayaran yang salah akun tetap membuat outstanding jadwal turun
//    sementara GL 2050 tidak, sehingga selisihnya terdeteksi.
//
// JANGAN memakai saldo total akun 2050 sebagai pembanding: akun itu juga
// menampung utang non-LPD. Hanya jurnal yang tertaut ke pinjaman ini yang
// dihitung. Jurnal 2050 yang tidak tertaut (termasuk link pembayaran yang
// hilang) tidak bisa diatribusikan ke pinjaman dan tidak masuk perhitungan;
// rekonsiliasi ini tidak mengubah/menulis jurnal atau angka koreksi apa pun.

import { AKUN_HUTANG } from '../db/coa.js';
import { formatRp } from '../utils/format.js';

/** Satu baris jurnal yang relevan untuk rekonsiliasi. */
export type BarisRekonsiliasiPinjaman = {
  jurnal_id: string;
  akun_kode: string;
  debit: number;
  kredit: number;
};

/** Link `pinjaman_bayar` + seluruh baris jurnal pembayaran tertaut. */
export type PembayaranRekonsiliasiPinjaman = {
  id: string;
  jurnal_id: string;
  baris: readonly BarisRekonsiliasiPinjaman[];
  dibatalkan?: boolean;
};

export type PinjamanRekonsiliasiInput = {
  pinjaman_id: string;
  sisa_pokok_awal: number;
  /** Null = pinjaman sudah berjalan; sisa pokok ada di Saldo Awal 2050. */
  jurnal_pencairan_id: string | null;
  /** Baris jurnal pencairan; kosong untuk pinjaman berjalan/tanpa jurnal. */
  baris_pencairan: readonly BarisRekonsiliasiPinjaman[];
  /**
   * Bagian kredit neto 2050 dari grup `SALDO_AWAL` yang dialokasikan ke
   * pinjaman berjalan ini. Diisi adapter dari saldo GL aktual, bukan dari
   * `sisa_pokok_awal`. Untuk pinjaman pencairan nilainya diabaikan.
   */
  saldo_awal_2050?: number;
  /** Pembayaran yang ditautkan lewat `pinjaman_bayar`. */
  pembayaran: readonly PembayaranRekonsiliasiPinjaman[];
  /** Akun bunga pinjaman; dipakai memisahkan bunga dari pokok aktual. */
  akun_bunga: string;
  /** Kode semua akun BEBAN; dipakai memisahkan denda dari pokok aktual. */
  akun_beban: ReadonlySet<string>;
  /** Default 2050 HUTANG LAIN-LAIN; bisa di-override untuk test. */
  akun_hutang?: string;
  dibatalkan?: boolean;
};

export type HasilRekonsiliasiPinjaman = {
  pinjaman_id: string;
  /** Outstanding menurut jurnal 2050 yang tertaut ke pinjaman ini. */
  gl: number;
  /** Outstanding menurut sisa pokok awal - pokok aktual dari jurnal bayar. */
  jadwal: number;
  /** `gl - jadwal`; positif = GL 2050 lebih besar dari jadwal. */
  selisih: number;
  /** True hanya bila selisih tepat 0. */
  cocok: boolean;
  /** Penjelasan bahasa Indonesia; tidak pernah menyarankan koreksi otomatis. */
  pesan: string;
};

const angka = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Saldo normal kredit (kredit - debit) untuk satu akun pada sekumpulan baris. */
function saldoKreditAkun(
  baris: readonly BarisRekonsiliasiPinjaman[],
  akun: string,
): number {
  let total = 0;
  for (const b of baris) {
    if (String(b.akun_kode) !== akun) continue;
    total += angka(b.kredit) - angka(b.debit);
  }
  return total;
}

/**
 * Pokok aktual satu jurnal pembayaran.
 *
 * Jalur normal memakai debit neto 2050. Bila tidak ada 2050 (mis. salah akun),
 * pakai sisa debit setelah bunga dan denda agar pembayaran tetap terhitung
 * sebagai pengurang pokok di sisi jadwal. Nilai tidak pernah negatif.
 */
function pokokAktualPembayaran(
  baris: readonly BarisRekonsiliasiPinjaman[],
  akunBunga: string,
  akunBeban: ReadonlySet<string>,
  akunHutang: string,
): number {
  const debit2050 = -saldoKreditAkun(baris, akunHutang);
  if (debit2050 > 0) return debit2050;

  let totalDebit = 0;
  for (const b of baris) totalDebit += angka(b.debit);

  let bunga = 0;
  let denda = 0;
  for (const b of baris) {
    const kode = String(b.akun_kode);
    const neto = angka(b.debit) - angka(b.kredit);
    if (kode === akunBunga) bunga += neto;
    else if (akunBeban.has(kode)) denda += neto;
  }

  return Math.max(0, totalDebit - bunga - denda);
}

/**
 * Hitung rekonsiliasi satu pinjaman dari input murni.
 *
 * Selisih = GL 2050 - jadwal. Nilai tidak dibulatkan dan tidak ditulis ke DB.
 */
export function hitungRekonsiliasiPinjaman(
  input: PinjamanRekonsiliasiInput,
): HasilRekonsiliasiPinjaman {
  const akunHutang = input.akun_hutang ?? AKUN_HUTANG;
  const sisaPokokAwal = angka(input.sisa_pokok_awal);

  const pembayaran2050 = input.pembayaran.reduce(
    (total, p) => total + saldoKreditAkun(p.baris, akunHutang),
    0,
  );
  const pembayaranPokok = input.pembayaran.reduce(
    (total, p) =>
      total +
      (p.dibatalkan ? 0 : pokokAktualPembayaran(
        p.baris,
        input.akun_bunga,
        input.akun_beban,
        akunHutang,
      )),
    0,
  );

  // Pinjaman pencairan baru memakai kredit 2050 di jurnal pencairan sebagai
  // saldo awal. Pinjaman berjalan tidak punya jurnal pencairan: saldo awalnya
  // dibaca dari bagian GL 2050 grup SALDO_AWAL yang dialokasikan adapter,
  // bukan disalin dari header pinjaman. Nilai tidak boleh melebihi sisa pokok
  // awal pinjaman ini agar alokasi beberapa pinjaman tidak dobel.
  const glAwal = input.jurnal_pencairan_id
    ? saldoKreditAkun(input.baris_pencairan, akunHutang)
    : Math.min(sisaPokokAwal, Math.max(0, angka(input.saldo_awal_2050)));

  const gl = glAwal + pembayaran2050;
  const jadwal = (input.dibatalkan ? 0 : sisaPokokAwal) - pembayaranPokok;
  const selisih = gl - jadwal;
  const cocok = selisih === 0;

  let pesan: string;
  if (cocok) {
    pesan =
      `Outstanding GL 2050 dan jadwal pinjaman cocok: ${formatRp(gl)}. ` +
      `Angka hanya memakai jurnal yang tertaut ke pinjaman ini; ` +
      `saldo 2050 untuk utang non-LPD tidak ikut dibandingkan.`;
  } else {
    const arah =
      selisih > 0
        ? 'outstanding GL 2050 lebih besar dari jadwal'
        : 'outstanding GL 2050 lebih kecil dari jadwal';
    pesan =
      `Selisih ${formatRp(selisih)}: outstanding GL 2050 ${formatRp(gl)} ` +
      `vs jadwal ${formatRp(jadwal)} (${arah}). Periksa jurnal pencairan, ` +
      `jurnal pembayaran, atau Saldo Awal 2050. Aplikasi tidak mengoreksi otomatis.`;
  }

  return {
    pinjaman_id: input.pinjaman_id,
    gl,
    jadwal,
    selisih,
    cocok,
    pesan,
  };
}
