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
  AKUN_MODAL,
  AKUN_PANJAR,
  akun as cariAkunCoa,
  isAkunKas,
  type Coa,
} from '../db/coa.js';
import { tanggalKalenderValid, type JurnalInput } from './posting.js';
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
  /** Akun beban/hutang/akun lain yang dibayar (bukan akun kas). */
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
    throw new Error('Tanggal tidak valid. Gunakan tanggal kalender YYYY-MM-DD yang benar.');
  return nilai;
}

function wajibNominal(nominal: number): number {
  if (!Number.isInteger(nominal) || nominal <= 0)
    throw new Error('Nominal harus bilangan bulat lebih dari 0 (satuan sen).');
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
function akunCoa(kode: string, label: string): Coa {
  const nilai = wajibAkun(kode, label);
  const data = cariAkunCoa(nilai);
  if (!data) throw new Error(`${label} ${nilai} tidak dikenal di daftar akun.`);
  return data;
}

function akunKas(kode: string, label: string): string {
  const nilai = wajibAkun(kode, label);
  if (!isAkunKas(nilai)) throw new Error(`${label} ${nilai} bukan akun kas/bank.`);
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
  const kas = akunKas(form.akunKas, 'Akun kas penerima');
  const lawanData = akunCoa(form.akunLawan, 'Akun lawan');
  if (lawanData.tipe !== 'PENDAPATAN' && lawanData.kode !== AKUN_MODAL)
    throw new Error(
      'Akun lawan Terima Uang harus akun pendapatan atau 3000 MODAL (setoran modal).',
    );
  return susun(form, 'TERIMA', [debit(kas, nominal), kredit(lawanData.kode, nominal)]);
}

/**
 * Bayar/beban: **D akun lawan / K akun kas**.
 * Lawan boleh akun beban, hutang (2050), piutang (1050), atau akun non-kas lain.
 */
export function buatJurnalBayar(form: FormBayar): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const kas = akunKas(form.akunKas, 'Akun kas sumber');
  const lawanData = akunCoa(form.akunLawan, 'Akun lawan');
  if (isAkunKas(lawanData.kode))
    throw new Error(
      'Akun lawan Bayar bukan akun kas/bank. Untuk memindahkan uang antar kas, gunakan Pindah Dana.',
    );
  return susun(form, 'BAYAR', [debit(lawanData.kode, nominal), kredit(kas, nominal)]);
}

/**
 * Pindah dana antar kas/bank: **D akun tujuan / K akun asal**.
 * Kedua akun wajib akun kas/bank dan tidak boleh sama.
 */
export function buatJurnalPindahDana(form: FormPindahDana): JurnalInput {
  const nominal = wajibNominal(form.nominal);
  const dari = akunKas(form.dari, 'Akun asal');
  const ke = akunKas(form.ke, 'Akun tujuan');
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
  const kas = akunKas(form.akunKas, 'Akun kas sumber');
  return susun(form, 'PANJAR', [debit(AKUN_PANJAR, nominal), kredit(kas, nominal)]);
}

export type ItemPanjarClose = {
  /** Kode akun realisasi; wajib akun BEBAN (bukan kas/bank/1040). */
  akun: string;
  /** Nominal dalam sen; bilangan bulat > 0. */
  nominal: number;
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
  const kas = akunKas(form.akunKas, 'Akun kas sumber');

  if (!Array.isArray(form.items) || form.items.length === 0)
    throw new Error('Rincian realisasi panjar masih kosong. Tambah minimal satu baris beban.');

  // Gabungkan baris dengan akun sama agar pratinjau jurnal rapi dan tidak
  // menghasilkan debit ganda untuk akun yang sama.
  const perAkun = new Map<string, number>();
  form.items.forEach((it, i) => {
    const no = i + 1;
    if (!it || typeof it !== 'object')
      throw new Error(`Rincian realisasi baris ${no} tidak valid.`);
    const data = akunCoa(String(it.akun ?? ''), `Akun realisasi baris ${no}`);
    if (isAkunKas(data.kode))
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
