// Builder form terpandu (P0-10 / dipakai P1-1..P1-4).
//
// Fungsi murni tanpa DB/Electron: operator awam cukup mengisi tanggal, akun,
// nominal, dan keterangan. Builder menyusun jurnal double-entry yang seimbang
// (debit = kredit) sehingga UI tidak perlu tahu istilah debit/kredit.
//
// Semua nominal dalam satuan SEN dan wajib bilangan bulat > 0. Kesalahan
// dilempar sebagai `Error` berbahasa Indonesia; validasi bisnis lengkap tetap
// dijalankan lagi oleh posting layer (P0-4) saat jurnal disimpan.

import {
  AKUN_HUTANG,
  AKUN_HUTANG_USAHA,
  AKUN_MODAL,
  AKUN_PANJAR,
  AKUN_PIUTANG,
  COA,
  isAkunKasData,
  type Coa,
} from '../db/coa.js';
import { tanggalKalenderValid, type JurnalInput } from './posting.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../utils/pesanError.js';
import type { JurnalBarisInput, JurnalJenis } from './types.js';

/** Kolom dasar yang sama untuk semua form terpandu. */
export type DasarFormJurnal = {
  /** Tanggal kalender YYYY-MM-DD. */
  tanggal: string;
  /** Nominal dalam sen; bilangan bulat > 0. */
  nominal: number;
  keterangan: string;
  /** Nomor bukti opsional (cth. JU-2026-0001). Wajib unik saat disimpan. */
  noBukti?: string;
  /** ID jurnal; bila kosong dibuat otomatis (tetap unik saat disimpan). */
  id?: string;
  /** Alasan wajib diisi bila tanggal berada di periode yang sudah ditutup. */
  alasan?: string;
  /**
   * Daftar akun dari master DB (termasuk akun tambahan operator). Default
   * COA statis agar pemanggil/test lama tetap kompatibel.
   */
  daftarAkun?: readonly Coa[];
};

export type FormTerimaUang = DasarFormJurnal & {
  /** Kas/bank yang menerima uang. */
  akunKas: string;
  /** Akun pendapatan, atau 3000 MODAL untuk setoran modal. */
  akunLawan: string;
};

export type FormBayar = DasarFormJurnal & {
  /** Kas/bank sumber pembayaran. */
  akunKas: string;
  /** Akun BEBAN yang dibayar. Panjar/hutang punya menu sendiri. */
  akunLawan: string;
};

export type FormPindahDana = DasarFormJurnal & {
  /** Akun kas/bank asal. */
  dari: string;
  /** Akun kas/bank tujuan; wajib berbeda dari `dari`. */
  ke: string;
};

export type FormPanjarSerah = DasarFormJurnal & {
  /** Kas/bank sumber uang panjar. */
  akunKas: string;
};

let urutanId = 0;

/** ID unik sederhana; `crypto.randomUUID` tersedia di Node maupun renderer. */
function idOtomatis(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `j-${cryptoApi.randomUUID()}`;
  }
  urutanId += 1;
  return `j-${Date.now().toString(36)}-${urutanId.toString(36)}`;
}

function wajibTanggal(tanggal: string): string {
  const nilai = String(tanggal ?? '').trim();
  if (!tanggalKalenderValid(nilai))
    throw new Error(PESAN_TANGGAL_TIDAK_VALID);
  return nilai;
}

function wajibNominal(nominal: number): number {
  if (!Number.isSafeInteger(nominal) || nominal <= 0)
    throw new Error('Nominal harus lebih dari 0.');
  return nominal;
}

function wajibKeterangan(keterangan: string): string {
  const nilai = String(keterangan ?? '').trim();
  if (!nilai) throw new Error('Keterangan wajib diisi.');
  return nilai;
}

function wajibAkun(kode: string, label: string): string {
  const nilai = String(kode ?? '').trim();
  if (!nilai) throw new Error(`${label} wajib dipilih.`);
  return nilai;
}

/** Akun harus ada di COA; pesan menyebut label form agar mudah dipahami. */
function akunCoa(kode: string, label: string, daftarAkun: readonly Coa[] = COA): Coa {
  const nilai = wajibAkun(kode, label);
  const data = daftarAkun.find((a) => a.kode === nilai);
  if (!data) throw new Error(`${label} ${nilai} tidak dikenal di daftar akun.`);
  return data;
}

function akunKas(kode: string, label: string, daftarAkun: readonly Coa[] = COA): string {
  const nilai = wajibAkun(kode, label);
  const data = daftarAkun.find((a) => a.kode === nilai);
  if (!data) throw new Error(`${label} ${nilai} bukan akun kas/bank.`);
  // DB-14: pakai penanda is_kas dari master DB; objek lama jatuh ke daftar statis.
  if (!isAkunKasData(data)) throw new Error(`${label} ${nilai} bukan akun kas/bank.`);
  return nilai;
}

function debit(akun_kode: string, nominal: number): JurnalBarisInput {
  return { akun_kode, debit: nominal, kredit: 0 };
}

function kredit(akun_kode: string, nominal: number): JurnalBarisInput {
  return { akun_kode, debit: 0, kredit: nominal };
}

function susun(
  dasar: DasarFormJurnal,
  jenis: JurnalJenis,
  baris: JurnalBarisInput[],
): JurnalInput {
  const tanggal = wajibTanggal(dasar.tanggal);
  const nominal = wajibNominal(dasar.nominal);
  const keterangan = wajibKeterangan(dasar.keterangan);
  const id = String(dasar.id ?? '').trim() || idOtomatis();
  const noBukti = String(dasar.noBukti ?? '').trim();
  const alasan = String(dasar.alasan ?? '').trim();

  // Jaring pengaman terakhir: builder tidak boleh menghasilkan jurnal pincang.
  const totalDebit = baris.reduce((s, b) => s + b.debit, 0);
  const totalKredit = baris.reduce((s, b) => s + b.kredit, 0);
  if (totalDebit !== totalKredit || totalDebit !== nominal)
    throw new Error('Jurnal form tidak seimbang. Periksa kembali nominal dan akun.');

  return {
    header: {
      id,
      tanggal,
      keterangan,
      ...(noBukti ? { no_bukti: noBukti } : {}),
      jenis,
    },
    baris,
    ...(alasan ? { alasan } : {}),
  };
}

/**
 * Terima uang: **D akun kas / K akun lawan**.
 * Lawan harus akun PENDAPATAN atau 3000 MODAL (setoran modal).
 */
export function buatJurnalTerimaUang(form: FormTerimaUang): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas penerima', form.daftarAkun);
  const lawanData = akunCoa(form.akunLawan, 'Akun lawan', form.daftarAkun);
  if (lawanData.tipe !== 'PENDAPATAN' && lawanData.kode !== AKUN_MODAL)
    throw new Error(
      'Akun lawan Terima Uang harus akun pendapatan atau 3000 MODAL (setoran modal).',
    );
  return susun(form, 'TERIMA', [debit(kas, nominal), kredit(lawanData.kode, nominal)]);
}

/**
 * Bayar/beban: **D akun lawan / K akun kas**.
 * Form terpandu ini hanya menerima akun BEBAN. Panjar (1040), aset lain lama
 * (1050), hutang pinjaman (2050), dan utang usaha (2060) tidak bisa dipakai di
 * sini. Jurnal Umum tetap boleh memakai akun-akun tersebut lewat jalur akuntan
 * (DB-03 akan membatasinya lebih lanjut).
 */
export function buatJurnalBayar(form: FormBayar): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas sumber', form.daftarAkun);
  const lawanData = akunCoa(form.akunLawan, 'Akun lawan', form.daftarAkun);
  if (isAkunKasData(lawanData))
    throw new Error(
      'Akun lawan Bayar bukan akun kas/bank. Untuk memindahkan uang antar kas, gunakan Pindah Dana.',
    );
  if (lawanData.kode === AKUN_PIUTANG)
    throw new Error(
      `Akun lawan Bayar ${lawanData.kode} — ${lawanData.nama} adalah aset lain lama; ` +
        'alur piutang sudah dihapus. Gunakan kartu Catat Utang / Bayar Utang ' +
        'untuk utang usaha, atau Jurnal Umum hanya untuk koreksi data lama.',
    );
  if (
    lawanData.kode === AKUN_PANJAR ||
    lawanData.kode === AKUN_HUTANG ||
    lawanData.kode === AKUN_HUTANG_USAHA
  )
    throw new Error(
      `Akun lawan Bayar ${lawanData.kode} — ${lawanData.nama} tidak bisa dipakai di form Bayar terpandu. ` +
        'Untuk panjar gunakan menu Buku Panjar; untuk pinjaman/utang gunakan kartu Catat Utang / Bayar Utang.',
    );
  if (lawanData.tipe !== 'BEBAN')
    throw new Error(
      `Akun lawan Bayar harus akun BEBAN; ${lawanData.kode} — ${lawanData.nama} bukan akun beban.`,
    );
  return susun(form, 'BAYAR', [debit(lawanData.kode, nominal), kredit(kas, nominal)]);
}

/**
 * Pindah dana antar kas/bank: **D akun tujuan / K akun asal**.
 * Kedua akun wajib akun kas/bank dan tidak boleh sama.
 */
export function buatJurnalPindahDana(form: FormPindahDana): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const dari = akunKas(form.dari, 'Akun asal', form.daftarAkun);
  const ke = akunKas(form.ke, 'Akun tujuan', form.daftarAkun);
  if (dari === ke)
    throw new Error('Pindah Dana harus memakai akun asal dan tujuan yang berbeda.');
  return susun(form, 'TRANSFER', [debit(ke, nominal), kredit(dari, nominal)]);
}

/**
 * Serah panjar: **D 1040 UANG PANJAR / K akun kas**.
 * Pertanggungjawaban/sisa panjar dibuat terpisah oleh form Panjar (P1-4).
 */
export function buatJurnalPanjarSerah(form: FormPanjarSerah): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas sumber', form.daftarAkun);
  return susun(form, 'PANJAR', [debit(AKUN_PANJAR, nominal), kredit(kas, nominal)]);
}

// ---------------------------------------------------------------------------
// Pinjaman LPD (DB-16c)
// ---------------------------------------------------------------------------

export type FormPinjamanPencairan = DasarFormJurnal & {
  /** Kas/bank yang menerima pencairan pinjaman. */
  akunKas: string;
  /** Nama LPD/kreditur; selalu masuk keterangan jurnal. */
  kreditur: string;
};

/**
 * Pencairan pinjaman LPD: **D akun kas penerima / K 2050 HUTANG LAIN-LAIN**.
 *
 * Jurnal ini hanya dibuat untuk mode "Pencairan baru". Pinjaman yang sudah
 * berjalan memakai saldo awal 2050 dan tidak boleh membuat jurnal baru.
 * Keterangan selalu memuat nama kreditur agar mudah ditelusuri.
 */
export function buatJurnalPinjamanPencairan(
  form: FormPinjamanPencairan,
): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas penerima', form.daftarAkun);
  const kreditur = String(form.kreditur ?? '').trim();
  if (!kreditur) throw new Error('Nama kreditur/LPD wajib diisi.');
  const catatan = String(form.keterangan ?? '').trim();
  const keterangan =
    catatan && catatan.toLowerCase().includes(kreditur.toLowerCase())
      ? catatan
      : `Pencairan pinjaman LPD ${kreditur}${catatan ? ` — ${catatan}` : ''}`;
  return susun({ ...form, keterangan }, 'HUTANG', [
    debit(kas, nominal),
    kredit(AKUN_HUTANG, nominal),
  ]);
}

// ---------------------------------------------------------------------------
// Form utang usaha sederhana (DB-23b)
// ---------------------------------------------------------------------------
// Master pihak + `jurnal_pihak` sudah dihapus dari UI/API. Utang usaha non-LPD
// cukup memakai nama kreditur di keterangan. Pinjaman LPD akan memakai modul
// LPD tersendiri (DB-16); akun 2050 lama tetap terbaca di laporan.

/** Catat utang usaha: **D akun BEBAN / K 2060 HUTANG USAHA**. */
export type FormCatatUtangUsaha = DasarFormJurnal & {
  /** Akun BEBAN, mis. 5003 BAGA WEWANGUNAN. */
  akunBeban: string;
};

/** Bayar utang usaha: **D 2060 HUTANG USAHA / K kas**. */
export type FormBayarUtangUsaha = DasarFormJurnal & {
  akunKas: string;
};

/**
 * Catat pembelian/perbaikan yang dibayar belakangan: **D BEBAN / K 2060**.
 * Beban masuk Laba Rugi, utang usaha masuk Neraca, modal (3000) TIDAK berubah.
 * Nama kreditur ditulis bebas di `keterangan`; tidak ada master pihak.
 */
export function buatJurnalCatatUtangUsaha(form: FormCatatUtangUsaha): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const beban = akunCoa(form.akunBeban, 'Akun beban', form.daftarAkun);
  if (isAkunKasData(beban) || beban.kode === AKUN_PANJAR)
    throw new Error(
      `Akun ${beban.kode} bukan akun BEBAN. Pilih akun beban, mis. 5003 BAGA WEWANGUNAN.`,
    );
  if (
    beban.kode === AKUN_PIUTANG ||
    beban.kode === AKUN_HUTANG ||
    beban.kode === AKUN_HUTANG_USAHA
  )
    throw new Error(
      `Akun ${beban.kode} bukan akun BEBAN. Pilih akun beban untuk mencatat utang usaha.`,
    );
  if (beban.tipe !== 'BEBAN')
    throw new Error(
      `Akun ${beban.kode} — ${beban.nama} bukan akun BEBAN. Catat utang usaha harus memakai akun BEBAN.`,
    );
  return susun(form, 'HUTANG', [
    debit(beban.kode, nominal),
    kredit(AKUN_HUTANG_USAHA, nominal),
  ]);
}

/**
 * Bayar utang usaha: **D 2060 HUTANG USAHA / K kas**.
 * Pembayaran ini masuk kelompok Operasi di laporan Arus Kas.
 */
export function buatJurnalBayarUtangUsaha(form: FormBayarUtangUsaha): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas sumber', form.daftarAkun);
  return susun(form, 'HUTANG', [
    debit(AKUN_HUTANG_USAHA, nominal),
    kredit(kas, nominal),
  ]);
}

// ---------------------------------------------------------------------------
// Wizard Saldo Awal (P1-6)
// ---------------------------------------------------------------------------
// Dipakai SEKALI saat mulai pembukuan nyata. Operator cukup mengisi saldo per
// akun (kas/bank, aset lain, hutang); selisih otomatis menjadi baris
// penyeimbang 3000 MODAL. Hasilnya tetap satu jurnal double-entry biasa —
// tidak ada tabel saldo atau angka turunan yang disimpan.

export type BarisSaldoAwal = {
  /** Akun AKTIVA (kas/bank, 1040, 1050 lama, ...) atau KEWAJIBAN (2050/2060, ...). */
  akun_kode: string;
  /** Nominal dalam sen; bilangan bulat >= 0. Baris 0 diabaikan. */
  nominal: number;
};

export type FormSaldoAwal = {
  /** Tanggal jangkar / tanggal mulai pembukuan (YYYY-MM-DD). */
  tanggal: string;
  /**
   * Saldo per akun. Akun 3000 MODAL TIDAK boleh diisi di sini: modal selalu
   * dihitung otomatis sebagai penyeimbang.
   */
  saldo: BarisSaldoAwal[];
  keterangan?: string;
  noBukti?: string;
  id?: string;
  alasan?: string;
  /** Daftar akun master DB; default COA statis agar pemanggil lama aman. */
  daftarAkun?: readonly Coa[];
};

export type HasilSaldoAwal = {
  input: JurnalInput;
  /** Total saldo akun AKTIVA (debit), tanpa baris modal. */
  totalAktiva: number;
  /** Total saldo akun KEWAJIBAN (kredit), tanpa baris modal. */
  totalKewajiban: number;
  /** totalAktiva - totalKewajiban; positif = modal dikredit, negatif = modal didebit. */
  selisih: number;
  akunModal: string;
};

/**
 * Susun satu jurnal saldo awal yang seimbang.
 *
 * Aturan:
 * - Tanggal kalender valid; minimal satu baris bernominal > 0.
 * - Hanya akun AKTIVA/KEWAJIBAN. PENDAPATAN/BEBAN/EKUITAS ditolak karena saldo
 *   awal bukan transaksi laba/rugi; 3000 MODAL hanya boleh muncul otomatis.
 * - Baris bernominal 0 diabaikan; akun ganda digabung agar jurnal rapi.
 * - Selisih aktiva - kewajiban menjadi baris penyeimbang 3000 MODAL:
 *   selisih positif -> kredit modal, negatif -> debit modal, nol -> tanpa modal.
 */
export function buatJurnalSaldoAwal(form: FormSaldoAwal): HasilSaldoAwal {
  const tanggal = wajibTanggal(form.tanggal);
  const daftarAkun = form.daftarAkun ?? COA;
  if (!Array.isArray(form.saldo) || form.saldo.length === 0)
    throw new Error('Saldo awal masih kosong. Isi minimal satu akun dengan nominal lebih dari 0.');

  // Gabungkan akun yang sama supaya pratinjau jurnal tidak memiliki baris
  // ganda untuk satu akun. Baris 0 diabaikan lebih dulu.
  const perAkun = new Map<string, number>();
  form.saldo.forEach((it, i) => {
    const no = i + 1;
    if (!it || typeof it !== 'object')
      throw new Error(`Saldo awal baris ${no} tidak valid.`);
    const kode = String(it.akun_kode ?? '').trim();
    if (!kode) throw new Error(`Akun saldo awal baris ${no} wajib dipilih.`);
    if (kode === AKUN_MODAL)
      throw new Error(
        'Akun 3000 MODAL diisi otomatis sebagai penyeimbang. Jangan memasukkan 3000 di daftar saldo.',
      );
    const data = daftarAkun.find((a) => a.kode === kode);
    if (!data)
      throw new Error(`Akun saldo awal baris ${no} (${kode}) tidak dikenal di daftar akun.`);
    if (data.tipe !== 'AKTIVA' && data.tipe !== 'KEWAJIBAN')
      throw new Error(
        `Akun saldo awal baris ${no} (${kode} — ${data.nama}) harus akun AKTIVA atau KEWAJIBAN. ` +
          'Pendapatan, beban, dan ekuitas tidak boleh dimasukkan; modal diisi otomatis.',
      );
    const nominal = it.nominal;
    if (typeof nominal !== 'number' || !Number.isSafeInteger(nominal) || nominal < 0)
      throw new Error(
        `Nominal saldo awal baris ${no} harus bilangan bulat ≥ 0 (satuan sen).`,
      );
    if (nominal === 0) return;
    perAkun.set(kode, (perAkun.get(kode) ?? 0) + nominal);
  });

  if (perAkun.size === 0)
    throw new Error('Isi minimal satu saldo dengan nominal lebih dari 0.');

  let totalAktiva = 0;
  let totalKewajiban = 0;
  const baris: JurnalBarisInput[] = [];
  for (const [kode, nominal] of perAkun) {
    const data = daftarAkun.find((a) => a.kode === kode);
    if (!data) continue; // sudah diperiksa di atas; jaring pengaman tipe
    if (data.tipe === 'AKTIVA') {
      baris.push(debit(kode, nominal));
      totalAktiva += nominal;
    } else {
      baris.push(kredit(kode, nominal));
      totalKewajiban += nominal;
    }
  }

  const selisih = totalAktiva - totalKewajiban;
  if (selisih > 0) baris.push(kredit(AKUN_MODAL, selisih));
  else if (selisih < 0) baris.push(debit(AKUN_MODAL, -selisih));

  // Minimal 2 baris: satu akun + baris modal, atau dua akun berbeda.
  if (baris.length < 2)
    throw new Error('Jurnal saldo awal minimal 2 baris (satu debit dan satu kredit).');

  const input = susun(
    {
      tanggal,
      nominal: Math.max(totalAktiva, totalKewajiban),
      keterangan: String(form.keterangan ?? '').trim() || 'Saldo awal pembukuan',
      noBukti: form.noBukti,
      id: form.id,
      alasan: form.alasan,
    },
    'SALDO_AWAL',
    baris,
  );

  return { input, totalAktiva, totalKewajiban, selisih, akunModal: AKUN_MODAL };
}

// DB-18: detail nota per baris panjar. Field opsional agar data/form lama tetap
// sah; nilai kosong disimpan sebagai string kosong di `panjar_item`.
export const MAKS_NOTA_NOMOR = 100;
export const MAKS_NOTA_TOKO = 200;
export const MAKS_NOTA_KETERANGAN = 500;

export type NotaPanjarInput = {
  nota_nomor?: unknown;
  nota_tanggal?: unknown;
  toko?: unknown;
  keterangan?: unknown;
};

export type NotaPanjar = {
  nota_nomor: string;
  /** YYYY-MM-DD, atau '' bila tidak diisi (legacy). */
  nota_tanggal: string;
  toko: string;
  keterangan: string;
};

export type HasilNormalisasiNota =
  | { ok: true; nota: NotaPanjar }
  | { ok: false; error: string };

/**
 * Normalisasi + validasi server-side field nota panjar (DB-18).
 * Field yang tidak dikirim tetap boleh kosong (perilaku legacy). Bila tanggal
 * nota diisi, bentuk kalender wajib valid dan tidak boleh setelah tanggal
 * realisasi/close.
 */
export function normalisasiNotaPanjar(
  nilai: NotaPanjarInput | null | undefined,
  opts: { tanggalClose?: string; label?: string } = {},
): HasilNormalisasiNota {
  const label = opts.label ?? 'Rincian realisasi';
  const baca = (
    field: keyof NotaPanjarInput,
    nama: string,
    maks: number,
  ): { ok: true; nilai: string } | { ok: false; error: string } => {
    const mentah = nilai?.[field];
    if (mentah === undefined || mentah === null) return { ok: true, nilai: '' };
    if (typeof mentah !== 'string')
      return { ok: false, error: `${label}: ${nama} tidak valid.` };
    const teks = mentah.trim();
    if (teks.length > maks)
      return { ok: false, error: `${label}: ${nama} maks. ${maks} karakter.` };
    return { ok: true, nilai: teks };
  };

  const nomor = baca('nota_nomor', 'nomor nota', MAKS_NOTA_NOMOR);
  if (!nomor.ok) return nomor;
  const tanggal = baca('nota_tanggal', 'tanggal nota', 10);
  if (!tanggal.ok) return tanggal;
  const toko = baca('toko', 'toko/penerima', MAKS_NOTA_TOKO);
  if (!toko.ok) return toko;
  const keterangan = baca('keterangan', 'keterangan', MAKS_NOTA_KETERANGAN);
  if (!keterangan.ok) return keterangan;

  if (tanggal.nilai) {
    if (!tanggalKalenderValid(tanggal.nilai))
      return {
        ok: false,
        error: `${label}: tanggal nota tidak valid (YYYY-MM-DD).`,
      };
    const tanggalClose = String(opts.tanggalClose ?? '').trim();
    if (tanggalKalenderValid(tanggalClose) && tanggal.nilai > tanggalClose)
      return {
        ok: false,
        error:
          `${label}: tanggal nota (${tanggal.nilai}) tidak boleh setelah ` +
          `tanggal realisasi (${tanggalClose}).`,
      };
  }

  return {
    ok: true,
    nota: {
      nota_nomor: nomor.nilai,
      nota_tanggal: tanggal.nilai,
      toko: toko.nilai,
      keterangan: keterangan.nilai,
    },
  };
}

export type ItemPanjarClose = {
  /** Kode akun realisasi; wajib akun BEBAN (bukan kas/bank/1040). */
  akun: string;
  /** Nominal dalam sen; bilangan bulat > 0. */
  nominal: number;
  /** DB-18: detail nota; opsional untuk data/form lama. */
  nota_nomor?: string;
  nota_tanggal?: string;
  toko?: string;
  keterangan?: string;
};

export type FormPanjarClose = {
  /** Tanggal pertanggungjawaban (YYYY-MM-DD). */
  tanggal: string;
  /** Nama penerima panjar; hanya dipakai untuk keterangan otomatis. */
  penerima?: string;
  /** Kas/bank sumber panjar yang menerima sisa / membayar kekurangan. */
  akunKas: string;
  /** Jumlah panjar yang diserahkan (sen), harus > 0. */
  jumlahPanjar: number;
  /** Rincian realisasi per akun BEBAN. */
  items: ItemPanjarClose[];
  keterangan?: string;
  noBukti?: string;
  id?: string;
  alasan?: string;
  /** Daftar akun dari master DB; default COA statis. */
  daftarAkun?: readonly Coa[];
};

export type HasilPanjarClose = {
  input: JurnalInput;
  /** Total realisasi belanja (sen). */
  totalRealisasi: number;
  /** Uang panjar yang kembali ke kas (0 bila pas atau kurang). */
  sisa: number;
  /** Kekurangan yang dibayar dari kas sumber (0 bila pas atau sisa). */
  kurang: number;
  /** true bila realisasi melebihi panjar dan operator wajib mengonfirmasi. */
  perluKonfirmasi: boolean;
};

/**
 * Pertanggungjawaban panjar (close). Menghasilkan jurnal yang selalu
 * seimbang dan menghabiskan saldo 1040 untuk panjar tersebut:
 *
 * - Realisasi ≤ panjar: **D masing-masing beban + D kas (sisa) / K 1040**.
 * - Realisasi > panjar:  **D masing-masing beban / K 1040 (panjar) + K kas (kurang)**.
 *
 * `perluKonfirmasi` hanya menandai kekurangan; peringatan kas minus tetap
 * ditangani posting layer saat jurnal disimpan.
 */
export function buatJurnalPanjarClose(form: FormPanjarClose): HasilPanjarClose {
  const tanggal = wajibTanggal(form.tanggal);
  const jumlahPanjar = wajibNominal(form.jumlahPanjar);
  const kas = akunKas(form.akunKas, 'Akun kas sumber', form.daftarAkun);

  if (!Array.isArray(form.items) || form.items.length === 0)
    throw new Error('Rincian realisasi panjar masih kosong. Tambah minimal satu baris beban.');

  // Gabungkan baris dengan akun sama agar pratinjau jurnal rapi dan tidak
  // menghasilkan debit ganda untuk akun yang sama.
  const perAkun = new Map<string, number>();
  form.items.forEach((it, i) => {
    const no = i + 1;
    if (!it || typeof it !== 'object')
      throw new Error(`Rincian realisasi baris ${no} tidak valid.`);
    const nota = normalisasiNotaPanjar(it, {
      tanggalClose: tanggal,
      label: `Rincian realisasi baris ${no}`,
    });
    if (!nota.ok) throw new Error(nota.error);
    const data = akunCoa(String(it.akun ?? ''), `Akun realisasi baris ${no}`, form.daftarAkun);
    if (isAkunKasData(data))
      throw new Error(
        `Akun realisasi baris ${no} (${data.kode}) adalah kas/bank. Realisasi panjar harus memakai akun BEBAN.`,
      );
    if (data.kode === AKUN_PANJAR)
      throw new Error(
        `Akun realisasi baris ${no} tidak boleh 1040 UANG PANJAR. Pilih akun BEBAN untuk belanja.`,
      );
    if (data.tipe !== 'BEBAN')
      throw new Error(
        `Akun realisasi baris ${no} (${data.kode} — ${data.nama}) bukan akun BEBAN.`,
      );
    const nominal = wajibNominal(it.nominal);
    perAkun.set(data.kode, (perAkun.get(data.kode) ?? 0) + nominal);
  });

  const totalRealisasi = [...perAkun.values()].reduce((s, n) => s + n, 0);
  if (totalRealisasi <= 0)
    throw new Error('Total realisasi panjar harus lebih dari 0.');

  const sisa = Math.max(0, jumlahPanjar - totalRealisasi);
  const kurang = Math.max(0, totalRealisasi - jumlahPanjar);

  const baris: JurnalBarisInput[] = [];
  for (const [akunBeban, nominal] of perAkun) baris.push(debit(akunBeban, nominal));
  if (sisa > 0) baris.push(debit(kas, sisa));
  baris.push(kredit(AKUN_PANJAR, jumlahPanjar));
  if (kurang > 0) baris.push(kredit(kas, kurang));

  const namaPenerima = String(form.penerima ?? '').trim();
  const keterangan =
    String(form.keterangan ?? '').trim() ||
    `Pertanggungjawaban panjar${namaPenerima ? ` ${namaPenerima}` : ''}`;

  const input = susun(
    {
      tanggal,
      // Total jurnal = sisi yang lebih besar; susun() memverifikasi debit =
      // kredit = nominal.
      nominal: Math.max(totalRealisasi, jumlahPanjar),
      keterangan,
      noBukti: form.noBukti,
      id: form.id,
      alasan: form.alasan,
    },
    'PANJAR',
    baris,
  );

  return {
    input,
    totalRealisasi,
    sisa,
    kurang,
    perluKonfirmasi: kurang > 0,
  };
}
