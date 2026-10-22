// Validasi input murni (tanpa Electron/DB) — di-test di tests/ipc-validation.test.ts.

import { AKUN_PANJAR, coaByKode, isAkunKas, isBeban } from '../db/coa.js';
import {
  JENIS_JURNAL,
  tanggalKalenderValid,
  type JurnalInput,
} from '../core/posting.js';
import type {
  JurnalBarisInput,
  JurnalHeaderInput,
  JurnalJenis,
} from '../core/types.js';

export type TransaksiInput = {
  tanggal: string;
  keterangan: string;
  akun_kas: string;
  kategori: string;
  masuk: number;
  keluar: number;
};

/** Kategori yang boleh dipilih user di form BKU (PANJAR sistem dikecualikan). */
export function kategoriBolehDipilih(kode: string): boolean {
  const c = coaByKode(kode);
  if (!c) return false;
  if (isAkunKas(kode)) return false;
  if (kode === AKUN_PANJAR) return false; // panjar punya alur sendiri
  if (kode === '3001' || kode === '3002') return false; // dihitung otomatis
  return true;
}

export function validateTransaksiInput(t: TransaksiInput): string[] {
  const err: string[] = [];
  if (!tanggalKalenderValid(t.tanggal)) err.push('Tanggal tidak valid (YYYY-MM-DD).');
  if (!t.keterangan.trim()) err.push('Keterangan wajib diisi.');
  if (!isAkunKas(t.akun_kas)) err.push('Akun Kas tidak dikenal.');
  if (!kategoriBolehDipilih(t.kategori)) err.push('Kategori tidak valid.');
  if (!Number.isInteger(t.masuk) || t.masuk < 0) err.push('Uang masuk harus bilangan bulat ≥ 0.');
  if (!Number.isInteger(t.keluar) || t.keluar < 0) err.push('Uang keluar harus bilangan bulat ≥ 0.');
  if (t.masuk + t.keluar <= 0) err.push('Nominal harus lebih dari 0.');
  if (t.masuk > 0 && t.keluar > 0) err.push('Isi salah satu: masuk ATAU keluar.');
  return err;
}

export type PanjarItemInput = { kategori_baga: string; nominal: number };

export function validatePanjarItems(items: PanjarItemInput[]): string[] {
  const err: string[] = [];
  if (items.length === 0) err.push('Rincian belanja masih kosong.');
  items.forEach((it, i) => {
    if (!isBeban(it.kategori_baga)) err.push(`Baris ${i + 1}: Baga tidak valid.`);
    if (!Number.isInteger(it.nominal) || it.nominal <= 0) err.push(`Baris ${i + 1}: nominal harus > 0.`);
  });
  return err;
}

export const ASET_JENIS = ['TANAH', 'BANGUNAN', 'LAINNYA'] as const;
export const ASET_KONDISI = ['BAIK', 'RUSAK_RINGAN', 'RUSAK_BERAT', 'TIDAK_DIKETAHUI'] as const;

export type AsetInput = {
  kode: string;
  nama: string;
  jenis: string;
  luas_m2: number | null;
  lokasi: string;
  status_hukum: string;
  tahun_perolehan: number | null;
  asal_usul: string;
  kondisi: string;
  keterangan: string;
  nilai_sen: number | null;
};

/** Validasi Inventaris Aset: nominal sengaja opsional (null = belum dinilai). */
export function validateAsetInput(a: AsetInput): string[] {
  const err: string[] = [];
  if (!a.kode.trim()) err.push('Kode aset wajib diisi.');
  else if (a.kode.trim().length > 32) err.push('Kode aset maks. 32 karakter.');
  if (!a.nama.trim()) err.push('Nama aset wajib diisi.');
  if (!(ASET_JENIS as readonly string[]).includes(a.jenis)) err.push('Jenis aset tidak valid.');
  if (!(ASET_KONDISI as readonly string[]).includes(a.kondisi)) err.push('Kondisi aset tidak valid.');
  if (a.luas_m2 !== null && (!Number.isFinite(a.luas_m2) || a.luas_m2 < 0 || a.luas_m2 > 1e9))
    err.push('Luas harus angka ≥ 0 (atau kosongkan).');
  const tahunIni = new Date().getFullYear();
  if (
    a.tahun_perolehan !== null &&
    (!Number.isInteger(a.tahun_perolehan) || a.tahun_perolehan < 1900 || a.tahun_perolehan > tahunIni + 1)
  )
    err.push('Tahun perolehan tidak valid (atau kosongkan).');
  if (a.nilai_sen !== null && (!Number.isInteger(a.nilai_sen) || a.nilai_sen < 0))
    err.push('Nilai harus bilangan bulat ≥ 0 (atau kosongkan bila belum dinilai).');
  for (const [label, v] of [
    ['Lokasi', a.lokasi],
    ['Status hukum', a.status_hukum],
    ['Asal-usul', a.asal_usul],
    ['Keterangan', a.keterangan],
  ] as const) {
    if (v.length > 500) err.push(`${label} maks. 500 karakter.`);
  }
  return err;
}

// ---------------------------------------------------------------------------
// Bentuk input jurnal dari renderer (P1-1)
// ---------------------------------------------------------------------------

const MAKS_BARIS_JURNAL = 500;

const objek = (nilai: unknown): nilai is Record<string, unknown> =>
  typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);

export type HasilBentukJurnalInput =
  | { ok: true; input: JurnalInput }
  | { ok: false; error: string };

/**
 * Validasi bentuk data jurnal yang datang dari renderer sebelum masuk ke
 * posting layer. IPC tidak boleh mempercayai objek mentah: semua field
 * dinormalisasi dan hanya field yang dikenal yang diteruskan.
 *
 * `reversal_of` / `jenis=REVERSAL` sengaja ditolak karena jurnal balik wajib
 * lewat jalur koreksi (`jurnal:reverse`), bukan jalur simpan biasa.
 */
export function validasiBentukJurnalInput(nilai: unknown): HasilBentukJurnalInput {
  if (!objek(nilai)) return { ok: false, error: 'Data jurnal tidak lengkap.' };
  if (!objek(nilai.header)) return { ok: false, error: 'Kepala jurnal tidak lengkap.' };
  if (!Array.isArray(nilai.baris)) return { ok: false, error: 'Daftar baris jurnal tidak lengkap.' };
  if (nilai.baris.length < 2)
    return { ok: false, error: 'Jurnal wajib memiliki minimal 2 baris (satu debit dan satu kredit).' };
  if (nilai.baris.length > MAKS_BARIS_JURNAL)
    return { ok: false, error: `Jurnal maksimal ${MAKS_BARIS_JURNAL} baris.` };

  const h = nilai.header;

  const id = h.id;
  if (typeof id !== 'string' || !id.trim())
    return { ok: false, error: 'ID jurnal wajib diisi.' };
  if (id.trim().length > 200) return { ok: false, error: 'ID jurnal terlalu panjang.' };

  const tanggal = h.tanggal;
  if (typeof tanggal !== 'string' || !tanggal.trim())
    return { ok: false, error: 'Tanggal jurnal wajib diisi.' };

  const keterangan = h.keterangan;
  if (typeof keterangan !== 'string' || !keterangan.trim())
    return { ok: false, error: 'Keterangan jurnal wajib diisi.' };
  if (keterangan.length > 1000)
    return { ok: false, error: 'Keterangan jurnal maks. 1000 karakter.' };

  if (
    h.reversal_of !== undefined &&
    h.reversal_of !== null &&
    String(h.reversal_of).trim() !== ''
  )
    return { ok: false, error: 'Jurnal balik harus dibuat lewat menu Koreksi.' };

  let noBukti = '';
  if (h.no_bukti !== undefined && h.no_bukti !== null) {
    if (typeof h.no_bukti !== 'string')
      return { ok: false, error: 'Nomor bukti tidak valid.' };
    noBukti = h.no_bukti.trim();
    if (noBukti.length > 100)
      return { ok: false, error: 'Nomor bukti maks. 100 karakter.' };
  }

  let jenis: JurnalJenis | undefined;
  if (h.jenis !== undefined && h.jenis !== null && h.jenis !== '') {
    if (
      typeof h.jenis !== 'string' ||
      !(JENIS_JURNAL as readonly string[]).includes(h.jenis)
    )
      return { ok: false, error: 'Jenis jurnal tidak dikenal.' };
    if (h.jenis === 'REVERSAL')
      return { ok: false, error: 'Jurnal balik harus dibuat lewat menu Koreksi.' };
    jenis = h.jenis as JurnalJenis;
  }

  let alasan = '';
  if (nilai.alasan !== undefined && nilai.alasan !== null) {
    if (typeof nilai.alasan !== 'string')
      return { ok: false, error: 'Alasan jurnal tidak valid.' };
    alasan = nilai.alasan.trim();
    if (alasan.length > 500)
      return { ok: false, error: 'Alasan maks. 500 karakter.' };
  }

  const baris: JurnalBarisInput[] = [];
  for (let i = 0; i < nilai.baris.length; i += 1) {
    const b = nilai.baris[i];
    const no = i + 1;
    if (!objek(b)) return { ok: false, error: `Baris ${no}: data tidak valid.` };

    const kode = b.akun_kode;
    if (typeof kode !== 'string' || !kode.trim())
      return { ok: false, error: `Baris ${no}: akun belum dipilih.` };
    if (kode.trim().length > 20)
      return { ok: false, error: `Baris ${no}: kode akun terlalu panjang.` };

    const debit = b.debit;
    const kredit = b.kredit;
    if (typeof debit !== 'number' || !Number.isSafeInteger(debit) || debit < 0)
      return { ok: false, error: `Baris ${no}: debit harus bilangan bulat ≥ 0.` };
    if (typeof kredit !== 'number' || !Number.isSafeInteger(kredit) || kredit < 0)
      return { ok: false, error: `Baris ${no}: kredit harus bilangan bulat ≥ 0.` };

    let ket = '';
    if (b.keterangan !== undefined && b.keterangan !== null) {
      if (typeof b.keterangan !== 'string')
        return { ok: false, error: `Baris ${no}: keterangan tidak valid.` };
      ket = b.keterangan.trim();
      if (ket.length > 500)
        return { ok: false, error: `Baris ${no}: keterangan maks. 500 karakter.` };
    }

    baris.push({
      akun_kode: kode.trim(),
      debit,
      kredit,
      ...(ket ? { keterangan: ket } : {}),
    });
  }

  const header: JurnalHeaderInput = {
    id: id.trim(),
    tanggal: tanggal.trim(),
    keterangan: keterangan.trim(),
    ...(noBukti ? { no_bukti: noBukti } : {}),
    ...(jenis ? { jenis } : {}),
  };

  return {
    ok: true,
    input: { header, baris, ...(alasan ? { alasan } : {}) },
  };
}
