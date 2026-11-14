// Logika form Jurnal Umum (P1-7) — murni, tanpa DB/Electron.
//
// Dipakai editor Jurnal Umum untuk akuntan pendamping: validasi multi-baris
// debit/kredit, builder jurnal seimbang, autocomplete akun, template, dan
// duplikat jurnal. Aturan bisnis final tetap dijalankan lagi oleh posting
// layer (P0-4) saat jurnal disimpan.
//
// Nominal selalu integer SEN. Baris yang benar-benar kosong (akun, keterangan,
// dan nominal kosong) diabaikan supaya baris tambahan yang belum diisi tidak
// membuat form dianggap salah.

import type { Coa } from '../db/coa.js';
import { tanggalKalenderValid, type JurnalInput } from './posting.js';
import type { JurnalBarisInput } from './types.js';
import { formatRp } from '../utils/format.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../utils/pesanError.js';
import { tanggalLokal } from '../utils/tanggal.js';

export type BarisJurnalForm = {
  akun_kode: string;
  debit: number;
  kredit: number;
  keterangan: string;
};

export type HasilValidasiBarisJurnal = {
  errors: string[];
  totalDebit: number;
  totalKredit: number;
  /** true bila baris sah dan total debit = total kredit > 0. */
  seimbang: boolean;
  /** true bila minimal 2 baris terisi dan semua baris terisi valid. */
  barisSah: boolean;
};

export type FormJurnalUmum = {
  id?: string;
  tanggal: string;
  keterangan: string;
  noBukti?: string;
  baris: BarisJurnalForm[];
  alasan?: string;
};

export type SisiJurnal = 'DEBIT' | 'KREDIT';

export type BarisTemplateJurnal = {
  akun_kode: string;
  sisi: SisiJurnal;
  /** Selalu 0: akuntan yang mengisi nominal sesuai bukti. */
  nominal: number;
  keterangan?: string;
};

export type TemplateJurnal = {
  id: string;
  nama: string;
  keterangan: string;
  baris: BarisTemplateJurnal[];
};

/** Baris kosong: tidak punya akun, keterangan, maupun nominal. */
function barisKosong(b: BarisJurnalForm | null | undefined): boolean {
  if (!b || typeof b !== 'object') return false;
  const akun = String(b.akun_kode ?? '').trim();
  const keterangan = String(b.keterangan ?? '').trim();
  const debitKosong = b.debit === undefined || b.debit === null || b.debit === 0;
  const kreditKosong = b.kredit === undefined || b.kredit === null || b.kredit === 0;
  return !akun && !keterangan && debitKosong && kreditKosong;
}

/**
 * Validasi baris form Jurnal Umum.
 *
 * - Baris kosong boleh diabaikan.
 * - Akun wajib diisi untuk baris yang tidak kosong.
 * - Debit/kredit wajib bilangan bulat >= 0 (sen); isi salah satu saja dan
 *   nilainya harus > 0.
 * - Minimal 2 baris sah agar jurnal bisa disimpan.
 */
export function validasiBarisJurnalForm(
  baris: readonly BarisJurnalForm[],
): HasilValidasiBarisJurnal {
  const errors: string[] = [];
  const daftar = Array.isArray(baris) ? baris : [];
  let totalDebit = 0;
  let totalKredit = 0;
  let jumlahSah = 0;

  daftar.forEach((b, i) => {
    const no = i + 1;
    if (!b || typeof b !== 'object') {
      errors.push(`Baris ${no}: data baris tidak valid.`);
      return;
    }
    if (barisKosong(b)) return;

    const akun = String(b.akun_kode ?? '').trim();
    let barisIniSah = true;
    if (!akun) {
      errors.push(`Baris ${no}: akun wajib dipilih.`);
      barisIniSah = false;
    }

    const debitOk = Number.isInteger(b.debit) && b.debit >= 0;
    const kreditOk = Number.isInteger(b.kredit) && b.kredit >= 0;
    if (!debitOk) {
      errors.push(`Baris ${no}: debit harus bilangan bulat ≥ 0 (satuan sen).`);
      barisIniSah = false;
    }
    if (!kreditOk) {
      errors.push(`Baris ${no}: kredit harus bilangan bulat ≥ 0 (satuan sen).`);
      barisIniSah = false;
    }

    if (debitOk && kreditOk) {
      if (b.debit > 0 && b.kredit > 0) {
        errors.push(`Baris ${no}: isi debit ATAU kredit, tidak keduanya.`);
        barisIniSah = false;
      } else if (b.debit === 0 && b.kredit === 0) {
        errors.push(`Baris ${no}: nominal debit atau kredit harus lebih dari 0.`);
        barisIniSah = false;
      } else {
        totalDebit += b.debit;
        totalKredit += b.kredit;
      }
    }

    if (barisIniSah) jumlahSah += 1;
  });

  if (jumlahSah < 2) {
    errors.push('Jurnal wajib memiliki minimal 2 baris sah (satu debit dan satu kredit).');
  }

  const barisSah = errors.length === 0 && jumlahSah >= 2;
  return {
    errors,
    totalDebit,
    totalKredit,
    // Jangan tampilkan "Seimbang" bila masih ada baris yang belum sah.
    seimbang: barisSah && totalDebit === totalKredit && totalDebit > 0,
    barisSah,
  };
}

let urutanId = 0;

/** ID jurnal unik; `crypto.randomUUID` tersedia di Node maupun renderer. */
function idJurnalBaru(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `j-${cryptoApi.randomUUID()}`;
  }
  urutanId += 1;
  return `j-${Date.now().toString(36)}-${urutanId.toString(36)}`;
}

/**
 * Susun `JurnalInput` seimbang berjenis UMUM dari form Jurnal Umum.
 * Melempar Error berbahasa Indonesia bila header/baris belum sah.
 */
export function buatJurnalUmumForm(form: FormJurnalUmum): JurnalInput {
  if (!form || typeof form !== 'object')
    throw new Error('Data jurnal tidak lengkap.');

  const tanggal = String(form.tanggal ?? '').trim();
  if (!tanggalKalenderValid(tanggal))
    throw new Error(PESAN_TANGGAL_TIDAK_VALID);

  const keterangan = String(form.keterangan ?? '').trim();
  if (!keterangan) throw new Error('Keterangan jurnal wajib diisi.');

  const daftar = Array.isArray(form.baris) ? form.baris : [];
  const hasil = validasiBarisJurnalForm(daftar);
  if (!hasil.barisSah || !hasil.seimbang) {
    const pesan = [...hasil.errors];
    if (hasil.barisSah && !hasil.seimbang) {
      pesan.push(
        `Jurnal tidak seimbang: total debit ${formatRp(hasil.totalDebit)} ≠ total kredit ${formatRp(hasil.totalKredit)}.`,
      );
    }
    throw new Error(pesan.join(' ') || 'Jurnal belum lengkap.');
  }

  const baris: JurnalBarisInput[] = daftar
    .filter((b) => !barisKosong(b))
    .map((b) => {
      const keteranganBaris = String(b.keterangan ?? '').trim();
      return {
        akun_kode: String(b.akun_kode ?? '').trim(),
        debit: b.debit,
        kredit: b.kredit,
        ...(keteranganBaris ? { keterangan: keteranganBaris } : {}),
      };
    });

  const id = String(form.id ?? '').trim() || idJurnalBaru();
  const noBukti = String(form.noBukti ?? '').trim();
  const alasan = String(form.alasan ?? '').trim();

  return {
    header: {
      id,
      tanggal,
      keterangan,
      jenis: 'UMUM',
      ...(noBukti ? { no_bukti: noBukti } : {}),
    },
    baris,
    ...(alasan ? { alasan } : {}),
  };
}

/** Normalisasi teks akun untuk pencocokan: huruf kecil, spasi & tanda hubung rapi. */
function normalAkun(teks: string): string {
  return teks
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\s*-\s*/g, '-')
    .toLowerCase();
}

/**
 * Cari akun COA dari teks autocomplete. Cocok untuk kode persis
 * (`1001`), format `1001 — KAS`, atau nama (`kas`), tanpa membedakan
 * huruf besar/kecil. Tidak ditemukan -> null.
 */
export function cariAkunDariTeks(coa: readonly Coa[], teks: string): Coa | null {
  if (!Array.isArray(coa)) return null;
  const dicari = normalAkun(String(teks ?? ''));
  if (!dicari) return null;

  for (const a of coa) {
    if (!a) continue;
    const kode = normalAkun(String(a.kode ?? ''));
    const nama = normalAkun(String(a.nama ?? ''));
    const lengkap = normalAkun(`${a.kode} — ${a.nama}`);
    const lengkapSpasi = normalAkun(`${a.kode} ${a.nama}`);
    if (dicari === kode || dicari === nama || dicari === lengkap || dicari === lengkapSpasi)
      return a;
  }
  return null;
}

/**
 * Template umum untuk akuntan. Semua nominal 0 agar akuntan mengisi sesuai
 * bukti; akun & sisinya sudah benar sehingga tinggal menyesuaikan.
 */
export const TEMPLATE_JURNAL: readonly TemplateJurnal[] = [
  {
    id: 'terima-pendapatan',
    nama: 'Terima pendapatan',
    keterangan: 'Penerimaan pendapatan',
    baris: [
      { akun_kode: '1001', sisi: 'DEBIT', nominal: 0, keterangan: 'Uang diterima' },
      { akun_kode: '4005', sisi: 'KREDIT', nominal: 0, keterangan: 'Pendapatan parkir' },
    ],
  },
  {
    id: 'bayar-beban',
    nama: 'Bayar beban',
    keterangan: 'Pembayaran beban',
    baris: [
      { akun_kode: '5010', sisi: 'DEBIT', nominal: 0, keterangan: 'Beban listrik/telpon/PDAM' },
      { akun_kode: '1001', sisi: 'KREDIT', nominal: 0, keterangan: 'Uang keluar' },
    ],
  },
  {
    id: 'pindah-dana',
    nama: 'Pindah dana',
    keterangan: 'Pindah dana antar kas/bank',
    baris: [
      { akun_kode: '1029', sisi: 'DEBIT', nominal: 0, keterangan: 'Dana masuk' },
      { akun_kode: '1001', sisi: 'KREDIT', nominal: 0, keterangan: 'Dana keluar' },
    ],
  },
  {
    id: 'bayar-utang-usaha',
    nama: 'Bayar utang usaha',
    keterangan: 'Pembayaran utang usaha',
    baris: [
      { akun_kode: '2060', sisi: 'DEBIT', nominal: 0, keterangan: 'Utang usaha dibayar' },
      { akun_kode: '1001', sisi: 'KREDIT', nominal: 0, keterangan: 'Kas sumber' },
    ],
  },
];

const hariIni = (): string => tanggalLokal();

/**
 * UI-A20: alasan tombol Duplikat nonaktif untuk jenis jurnal yang tidak boleh
 * dicatat ulang sebagai jurnal UMUM baru ber-tanggal hari ini. Saldo awal hanya
 * boleh diatur lewat wizard saldo awal; jurnal balik adalah produk alur koreksi
 * — menduplikatnya mencatat balikan ganda. undefined bila aksi boleh.
 */
export function alasanTidakBisaDuplikat(jurnal: { jenis?: string }): string | undefined {
  if (jurnal?.jenis === 'SALDO_AWAL')
    return 'Saldo awal tidak bisa diduplikat: saldo awal hanya boleh diatur lewat wizard saldo awal.';
  if (jurnal?.jenis === 'REVERSAL')
    return 'Jurnal balik tidak bisa diduplikat: buat penyesuaian baru lewat alur koreksi jurnal.';
  return undefined;
}

/** true bila tombol Duplikat boleh aktif untuk jurnal ini. */
export function bisaDuplikatJurnal(jurnal: { jenis?: string }): boolean {
  return alasanTidakBisaDuplikat(jurnal) === undefined;
}

/**
 * Isi form duplikat dari jurnal lama: baris & keterangan disalin, tanggal
 * menjadi hari ini, ID baru, dan nomor bukti dikosongkan. `reversal_of`
 * sengaja tidak pernah disalin — duplikat adalah jurnal UMUM baru.
 *
 * UI-A20: jurnal SALDO_AWAL/REVERSAL ditolak agar jalur programatik tetap aman
 * walau UI lupa menyembunyikan tombolnya.
 */
export function duplikatJurnalKeForm(jurnal: {
  id?: string;
  keterangan?: string;
  jenis?: string;
  baris: ReadonlyArray<{
    akun_kode: string;
    debit: number;
    kredit: number;
    keterangan?: string | null;
  }>;
}): FormJurnalUmum {
  if (!jurnal || typeof jurnal !== 'object' || !Array.isArray(jurnal.baris))
    throw new Error('Jurnal yang akan diduplikat tidak lengkap.');

  const alasanJenis = alasanTidakBisaDuplikat(jurnal);
  if (alasanJenis) throw new Error(alasanJenis);

  const baris: BarisJurnalForm[] = jurnal.baris.map((b) => ({
    akun_kode: String(b?.akun_kode ?? '').trim(),
    debit: Number(b?.debit ?? 0),
    kredit: Number(b?.kredit ?? 0),
    keterangan: String(b?.keterangan ?? ''),
  }));

  const cek = validasiBarisJurnalForm(baris);
  if (!cek.barisSah)
    throw new Error(
      `Jurnal sumber tidak bisa diduplikat: ${cek.errors.join(' ') || 'baris tidak sah.'}`,
    );

  return {
    id: idJurnalBaru(),
    tanggal: hariIni(),
    keterangan: String(jurnal.keterangan ?? '').trim(),
    noBukti: '',
    baris,
  };
}
