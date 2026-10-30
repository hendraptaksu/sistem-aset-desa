// Validasi input murni (tanpa Electron/DB) — di-test di tests/ipc-validation.test.ts.

import { isBeban, type CoaTipe } from '../db/coa.js';
import {
  JENIS_JURNAL,
  tanggalKalenderValid,
  type JurnalInput,
} from '../core/posting.js';
import {
  normalisasiPengaturan,
  validasiPengaturan,
  type PengaturanPembukuan,
} from '../core/pengaturan.js';
import type { ModeNeracaSaldo } from '../core/reports.js';
import type {
  JurnalBarisInput,
  JurnalHeaderInput,
  JurnalJenis,
} from '../core/types.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../utils/pesanError.js';

export type PanjarItemInput = { kategori_baga: string; nominal: number };

/** Validasi lama; tetap dipakai test & sebagai jaring pengaman bentuk item. */
export function validatePanjarItems(items: PanjarItemInput[]): string[] {
  const err: string[] = [];
  if (!Array.isArray(items) || items.length === 0)
    return ['Rincian belanja masih kosong.'];
  items.forEach((it, i) => {
    if (!isBeban(it.kategori_baga)) err.push(`Baris ${i + 1}: Baga tidak valid.`);
    if (!Number.isInteger(it.nominal) || it.nominal <= 0) err.push(`Baris ${i + 1}: nominal harus > 0.`);
  });
  return err;
}

// ---------------------------------------------------------------------------
// Bentuk input Panjar v2 dari renderer (P1-4)
// ---------------------------------------------------------------------------

export type BentukPanjarSerah = {
  id?: string;
  tanggal: string;
  penerima: string;
  jumlah: number;
  akunKasSumber: string;
  keterangan?: string;
  noBukti?: string;
};

export type BentukPanjarClose = {
  id: string;
  tanggalClose: string;
  items: { kategori_baga: string; nominal: number }[];
};

type HasilBentuk<T> = { ok: true; input: T } | { ok: false; error: string };

export type { HasilBentuk };

const teksOpsional = (
  nilai: unknown,
  label: string,
  maks: number,
): { ok: true; nilai: string } | { ok: false; error: string } => {
  if (nilai === undefined || nilai === null) return { ok: true, nilai: '' };
  if (typeof nilai !== 'string')
    return { ok: false, error: `${label} tidak valid.` };
  const teks = nilai.trim();
  if (teks.length > maks)
    return { ok: false, error: `${label} maks. ${maks} karakter.` };
  return { ok: true, nilai: teks };
};

/** Normalisasi objek serah panjar; hanya field yang dikenal yang diteruskan. */
export function validasiBentukPanjarSerah(
  nilai: unknown,
): HasilBentuk<BentukPanjarSerah> {
  if (!objek(nilai)) return { ok: false, error: 'Data panjar tidak lengkap.' };

  const id = teksOpsional(nilai.id, 'ID panjar', 200);
  if (!id.ok) return id;
  const tanggal = teksOpsional(nilai.tanggal, 'Tanggal panjar', 10);
  if (!tanggal.ok) return tanggal;
  if (!tanggal.nilai) return { ok: false, error: 'Tanggal panjar wajib diisi.' };
  if (!tanggalKalenderValid(tanggal.nilai))
    return { ok: false, error: PESAN_TANGGAL_TIDAK_VALID };

  const penerima = teksOpsional(nilai.penerima, 'Nama penerima', 200);
  if (!penerima.ok) return penerima;
  if (!penerima.nilai) return { ok: false, error: 'Nama penerima panjar wajib diisi.' };

  const jumlah = nilai.jumlah;
  if (typeof jumlah !== 'number' || !Number.isSafeInteger(jumlah) || jumlah <= 0)
    return { ok: false, error: 'Jumlah panjar harus bilangan bulat lebih dari 0 (satuan sen).' };

  const akunKasSumber = teksOpsional(nilai.akunKasSumber, 'Akun kas sumber', 20);
  if (!akunKasSumber.ok) return akunKasSumber;
  if (!akunKasSumber.nilai)
    return { ok: false, error: 'Akun kas sumber panjar wajib dipilih.' };

  const keterangan = teksOpsional(nilai.keterangan, 'Keterangan', 1000);
  if (!keterangan.ok) return keterangan;
  const noBukti = teksOpsional(nilai.noBukti, 'Nomor bukti', 100);
  if (!noBukti.ok) return noBukti;

  return {
    ok: true,
    input: {
      ...(id.nilai ? { id: id.nilai } : {}),
      tanggal: tanggal.nilai,
      penerima: penerima.nilai,
      jumlah,
      akunKasSumber: akunKasSumber.nilai,
      ...(keterangan.nilai ? { keterangan: keterangan.nilai } : {}),
      ...(noBukti.nilai ? { noBukti: noBukti.nilai } : {}),
    },
  };
}

/** Normalisasi objek close panjar; item boleh memakai `akun` atau `kategori_baga`. */
export function validasiBentukPanjarClose(
  nilai: unknown,
): HasilBentuk<BentukPanjarClose> {
  if (!objek(nilai)) return { ok: false, error: 'Data pertanggungjawaban panjar tidak lengkap.' };

  const id = teksOpsional(nilai.id, 'ID panjar', 200);
  if (!id.ok) return id;
  if (!id.nilai) return { ok: false, error: 'Panjar yang akan ditutup belum dipilih.' };

  const tanggalClose = teksOpsional(nilai.tanggalClose, 'Tanggal realisasi', 10);
  if (!tanggalClose.ok) return tanggalClose;
  if (!tanggalClose.nilai)
    return { ok: false, error: 'Tanggal realisasi panjar wajib diisi.' };
  if (!tanggalKalenderValid(tanggalClose.nilai))
    return { ok: false, error: PESAN_TANGGAL_TIDAK_VALID };

  if (!Array.isArray(nilai.items))
    return { ok: false, error: 'Rincian realisasi panjar belum diisi.' };
  if (nilai.items.length === 0)
    return { ok: false, error: 'Rincian realisasi panjar masih kosong.' };
  if (nilai.items.length > 500)
    return { ok: false, error: 'Rincian realisasi panjar maksimal 500 baris.' };

  const items: { kategori_baga: string; nominal: number }[] = [];
  for (let i = 0; i < nilai.items.length; i += 1) {
    const it = nilai.items[i];
    if (!objek(it))
      return { ok: false, error: `Baris ${i + 1}: rincian tidak valid.` };
    const akun = teksOpsional(
      it.kategori_baga ?? it.akun,
      `Akun baris ${i + 1}`,
      20,
    );
    if (!akun.ok) return akun;
    if (!akun.nilai)
      return { ok: false, error: `Baris ${i + 1}: akun BEBAN belum dipilih.` };
    const nominal = it.nominal;
    if (typeof nominal !== 'number' || !Number.isSafeInteger(nominal) || nominal <= 0)
      return {
        ok: false,
        error: `Baris ${i + 1}: nominal harus bilangan bulat lebih dari 0.`,
      };
    items.push({ kategori_baga: akun.nilai, nominal });
  }

  return { ok: true, input: { id: id.nilai, tanggalClose: tanggalClose.nilai, items } };
}

// ---------------------------------------------------------------------------
// Bentuk input jurnal dari renderer (P1-1)
// ---------------------------------------------------------------------------

const MAKS_BARIS_JURNAL = 500;

const objek = (nilai: unknown): nilai is Record<string, unknown> =>
  typeof nilai === 'object' && nilai !== null && !Array.isArray(nilai);

export type BentukAkunBaru = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
};

/**
 * Bentuk input tambah akun dari renderer. Kode/prefix/keunikan tetap
 * divalidasi ulang di lapisan DB; di sini hanya bentuk yang aman.
 */
export function validasiBentukAkunBaru(
  nilai: unknown,
): HasilBentuk<BentukAkunBaru> {
  if (!objek(nilai)) return { ok: false, error: 'Data akun tidak lengkap.' };

  const kode = teksOpsional(nilai.kode, 'Kode akun', 4);
  if (!kode.ok) return kode;
  if (!/^\d{4}$/.test(kode.nilai))
    return { ok: false, error: 'Kode akun harus 4 digit angka, mis. 5011 atau 4043.' };

  const nama = teksOpsional(nilai.nama, 'Nama akun', 100);
  if (!nama.ok) return nama;
  if (!nama.nilai) return { ok: false, error: 'Nama akun wajib diisi.' };

  const tipe = teksOpsional(nilai.tipe, 'Jenis akun', 20);
  if (!tipe.ok) return tipe;
  if (tipe.nilai !== 'BEBAN' && tipe.nilai !== 'PENDAPATAN')
    return { ok: false, error: 'Jenis akun tambahan harus BEBAN atau PENDAPATAN.' };

  return {
    ok: true,
    input: { kode: kode.nilai, nama: nama.nilai, tipe: tipe.nilai },
  };
}

export type BentukAkunUbah = {
  kode: string;
  nama: string;
};

/** Bentuk input ubah nama akun; kode & jenis tidak boleh diubah. */
export function validasiBentukAkunUbah(
  nilai: unknown,
): HasilBentuk<BentukAkunUbah> {
  if (!objek(nilai)) return { ok: false, error: 'Data akun tidak lengkap.' };

  const kode = teksOpsional(nilai.kode, 'Kode akun', 4);
  if (!kode.ok) return kode;
  if (!/^\d{4}$/.test(kode.nilai))
    return { ok: false, error: 'Kode akun harus 4 digit angka.' };

  const nama = teksOpsional(nilai.nama, 'Nama akun', 100);
  if (!nama.ok) return nama;
  if (!nama.nilai) return { ok: false, error: 'Nama akun wajib diisi.' };

  return { ok: true, input: { kode: kode.nilai, nama: nama.nilai } };
}

/** Validasi kode akun untuk aksi aktif/nonaktif dan hapus. */
export function validasiKodeAkun(nilai: unknown): HasilBentuk<string> {
  const kode = teksOpsional(nilai, 'Kode akun', 4);
  if (!kode.ok) return kode;
  if (!/^\d{4}$/.test(kode.nilai))
    return { ok: false, error: 'Kode akun harus 4 digit angka.' };
  return { ok: true, input: kode.nilai };
}

export type HasilBentukJurnalInput =
  | { ok: true; input: JurnalInput }
  | { ok: false; error: string };

type OpsiBentukJurnal = {
  /** Form biasa wajib ID; koreksi boleh kosong karena main membuat ID unik. */
  idWajib: boolean;
  /**
   * Koreksi boleh memakai SALDO_AWAL, tetapi hanya bila jurnal asli juga
   * SALDO_AWAL. Aturan terakhir ditegakkan di `koreksiDanIsiUlang`.
   */
  izinkanSaldoAwal: boolean;
};

function validasiBentukJurnal(
  nilai: unknown,
  opsi: OpsiBentukJurnal,
): HasilBentukJurnalInput {
  if (!objek(nilai)) return { ok: false, error: 'Data jurnal tidak lengkap.' };
  if (!objek(nilai.header)) return { ok: false, error: 'Kepala jurnal tidak lengkap.' };
  if (!Array.isArray(nilai.baris)) return { ok: false, error: 'Daftar baris jurnal tidak lengkap.' };
  if (nilai.baris.length < 2)
    return { ok: false, error: 'Jurnal wajib memiliki minimal 2 baris (satu debit dan satu kredit).' };
  if (nilai.baris.length > MAKS_BARIS_JURNAL)
    return { ok: false, error: `Jurnal maksimal ${MAKS_BARIS_JURNAL} baris.` };

  const h = nilai.header;

  const id = h.id;
  let idBersih = '';
  if (id !== undefined && id !== null) {
    if (typeof id !== 'string')
      return {
        ok: false,
        error: opsi.idWajib ? 'ID jurnal wajib diisi.' : 'ID jurnal tidak valid.',
      };
    idBersih = id.trim();
  }
  if (!idBersih && opsi.idWajib)
    return { ok: false, error: 'ID jurnal wajib diisi.' };
  if (idBersih.length > 200) return { ok: false, error: 'ID jurnal terlalu panjang.' };

  const tanggal = h.tanggal;
  if (typeof tanggal !== 'string' || !tanggal.trim())
    return { ok: false, error: 'Tanggal jurnal wajib diisi.' };
  if (!tanggalKalenderValid(tanggal.trim()))
    return { ok: false, error: PESAN_TANGGAL_TIDAK_VALID };

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
    return {
      ok: false,
      error: opsi.izinkanSaldoAwal
        ? 'Jurnal pengganti tidak boleh mengacu ke jurnal lain.'
        : 'Jurnal balik harus dibuat lewat menu Koreksi.',
    };

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
      return {
        ok: false,
        error: opsi.izinkanSaldoAwal
          ? 'Jurnal pengganti tidak boleh berjenis REVERSAL.'
          : 'Jurnal balik harus dibuat lewat menu Koreksi.',
      };
    if (h.jenis === 'SALDO_AWAL' && !opsi.izinkanSaldoAwal)
      return {
        ok: false,
        error: 'Saldo awal harus dibuat lewat Wizard Saldo Awal, bukan form jurnal biasa.',
      };
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
    id: idBersih,
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

/**
 * Validasi bentuk data jurnal yang datang dari renderer sebelum masuk ke
 * posting layer. IPC tidak boleh mempercayai objek mentah: semua field
 * dinormalisasi dan hanya field yang dikenal yang diteruskan.
 *
 * `reversal_of` / `jenis=REVERSAL` sengaja ditolak karena jurnal balik wajib
 * lewat jalur koreksi (`jurnal:reverse`), bukan jalur simpan biasa.
 */
export function validasiBentukJurnalInput(nilai: unknown): HasilBentukJurnalInput {
  return validasiBentukJurnal(nilai, {
    idWajib: true,
    izinkanSaldoAwal: false,
  });
}

/**
 * AKT-22: bentuk input jurnal pengganti pada `jurnal:koreksi-isi-ulang`.
 * Sama ketatnya dengan form jurnal biasa, dengan dua pengecualian yang
 * disengaja:
 * - ID boleh kosong karena main membuat ID unik pengganti;
 * - SALDO_AWAL boleh pada bentuk, tetapi `koreksiDanIsiUlang` tetap menolak
 *   bila jurnal asli bukan SALDO_AWAL.
 * `REVERSAL`, `grup_id`, dan `reversal_of` tidak pernah diteruskan.
 */
export function validasiBentukKoreksiInput(
  nilai: unknown,
): HasilBentukJurnalInput {
  return validasiBentukJurnal(nilai, {
    idWajib: false,
    izinkanSaldoAwal: true,
  });
}

// ---------------------------------------------------------------------------
// Filter pencarian jurnal (P1-11)
// ---------------------------------------------------------------------------

export type FilterJurnalCari = {
  cari?: string;
  mulai?: string;
  sampai?: string;
  jenis?: string;
  akun_kode?: string;
  limit: number;
  offset: number;
};

/**
 * Normalisasi filter `jurnal:cari`. Limit wajib 1..200 dan offset >= 0 agar
 * renderer tidak bisa meminta seluruh tabel sekaligus tanpa batas.
 */
export function validasiFilterJurnalCari(
  nilai: unknown,
): HasilBentuk<FilterJurnalCari> {
  if (nilai === undefined || nilai === null)
    return { ok: true, input: { limit: 50, offset: 0 } };
  if (!objek(nilai)) return { ok: false, error: 'Data filter jurnal tidak lengkap.' };

  const cari = teksOpsional(nilai.cari, 'Kata kunci', 200);
  if (!cari.ok) return cari;
  const akun = teksOpsional(nilai.akun_kode, 'Akun', 20);
  if (!akun.ok) return akun;
  const jenis = teksOpsional(nilai.jenis, 'Jenis jurnal', 30);
  if (!jenis.ok) return jenis;
  if (jenis.nilai && !(JENIS_JURNAL as readonly string[]).includes(jenis.nilai))
    return { ok: false, error: 'Jenis jurnal tidak dikenal.' };

  const mulai = tanggalFilterLaporan(nilai.mulai);
  if (!mulai.ok) return mulai;
  const sampai = tanggalFilterLaporan(nilai.sampai);
  if (!sampai.ok) return sampai;
  if (mulai.input && sampai.input && mulai.input > sampai.input)
    return { ok: false, error: 'Tanggal mulai tidak boleh setelah tanggal sampai.' };

  let limit = 50;
  if (nilai.limit !== undefined && nilai.limit !== null && nilai.limit !== '') {
    if (
      typeof nilai.limit !== 'number' ||
      !Number.isInteger(nilai.limit) ||
      nilai.limit < 1 ||
      nilai.limit > 200
    )
      return { ok: false, error: 'Limit harus bilangan bulat 1–200.' };
    limit = nilai.limit;
  }

  let offset = 0;
  if (nilai.offset !== undefined && nilai.offset !== null && nilai.offset !== '') {
    if (
      typeof nilai.offset !== 'number' ||
      !Number.isInteger(nilai.offset) ||
      nilai.offset < 0
    )
      return { ok: false, error: 'Offset harus bilangan bulat ≥ 0.' };
    offset = nilai.offset;
  }

  return {
    ok: true,
    input: {
      ...(cari.nilai ? { cari: cari.nilai } : {}),
      ...(mulai.input ? { mulai: mulai.input } : {}),
      ...(sampai.input ? { sampai: sampai.input } : {}),
      ...(jenis.nilai ? { jenis: jenis.nilai } : {}),
      ...(akun.nilai ? { akun_kode: akun.nilai } : {}),
      limit,
      offset,
    },
  };
}

// ---------------------------------------------------------------------------
// Bentuk input Wizard Saldo Awal (P1-6)
// ---------------------------------------------------------------------------

export type BentukSaldoAwal = {
  tanggal: string;
  saldo: { akun_kode: string; nominal: number }[];
  keterangan?: string;
  noBukti?: string;
  id?: string;
  alasan?: string;
};

/**
 * Normalisasi input wizard dari renderer. Objek mentah tidak dipercaya:
 * hanya field yang dikenal yang diteruskan, nominal wajib integer sen >= 0,
 * dan jumlah baris dibatasi. Aturan akuntansi (jenis akun, modal otomatis)
 * tetap diperiksa oleh builder murni `buatJurnalSaldoAwal` di main.
 */
export function validasiBentukSaldoAwal(
  nilai: unknown,
): HasilBentuk<BentukSaldoAwal> {
  if (!objek(nilai)) return { ok: false, error: 'Data saldo awal tidak lengkap.' };

  const tanggal = teksOpsional(nilai.tanggal, 'Tanggal mulai pembukuan', 10);
  if (!tanggal.ok) return tanggal;
  if (!tanggal.nilai)
    return { ok: false, error: 'Tanggal mulai pembukuan wajib diisi.' };
  if (!tanggalKalenderValid(tanggal.nilai))
    return { ok: false, error: PESAN_TANGGAL_TIDAK_VALID };

  if (!Array.isArray(nilai.saldo))
    return { ok: false, error: 'Daftar saldo awal tidak lengkap.' };
  if (nilai.saldo.length === 0)
    return { ok: false, error: 'Daftar saldo awal masih kosong.' };
  if (nilai.saldo.length > 200)
    return { ok: false, error: 'Daftar saldo awal maksimal 200 baris.' };

  const saldo: { akun_kode: string; nominal: number }[] = [];
  for (let i = 0; i < nilai.saldo.length; i += 1) {
    const it = nilai.saldo[i];
    const no = i + 1;
    if (!objek(it)) return { ok: false, error: `Saldo awal baris ${no} tidak valid.` };

    if (typeof it.akun_kode !== 'string' || !it.akun_kode.trim())
      return { ok: false, error: `Saldo awal baris ${no}: akun belum dipilih.` };
    const akun = it.akun_kode.trim();
    if (akun.length > 20)
      return { ok: false, error: `Saldo awal baris ${no}: kode akun terlalu panjang.` };

    if (
      typeof it.nominal !== 'number' ||
      !Number.isSafeInteger(it.nominal) ||
      it.nominal < 0
    )
      return {
        ok: false,
        error: `Saldo awal baris ${no}: nominal harus bilangan bulat ≥ 0 (satuan sen).`,
      };

    saldo.push({ akun_kode: akun, nominal: it.nominal });
  }

  const keterangan = teksOpsional(nilai.keterangan, 'Keterangan', 1000);
  if (!keterangan.ok) return keterangan;
  const noBukti = teksOpsional(nilai.noBukti, 'Nomor bukti', 100);
  if (!noBukti.ok) return noBukti;
  const id = teksOpsional(nilai.id, 'ID saldo awal', 200);
  if (!id.ok) return id;
  const alasan = teksOpsional(nilai.alasan, 'Alasan', 500);
  if (!alasan.ok) return alasan;

  return {
    ok: true,
    input: {
      tanggal: tanggal.nilai,
      saldo,
      ...(keterangan.nilai ? { keterangan: keterangan.nilai } : {}),
      ...(noBukti.nilai ? { noBukti: noBukti.nilai } : {}),
      ...(id.nilai ? { id: id.nilai } : {}),
      ...(alasan.nilai ? { alasan: alasan.nilai } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Filter laporan Buku Besar & Neraca Saldo (P1-8)
// ---------------------------------------------------------------------------

export type FilterBukuBesar = {
  akun_kode: string;
  mulai?: string;
  sampai?: string;
};

/**
 * Tanggal filter boleh kosong, tetapi kalau diisi harus tanggal kalender
 * nyata. Pesan selalu seragam agar operator awam tidak bingung.
 */
function tanggalFilterLaporan(nilai: unknown): HasilBentuk<string> {
  if (nilai === undefined || nilai === null) return { ok: true, input: '' };
  if (typeof nilai !== 'string') return { ok: false, error: PESAN_TANGGAL_TIDAK_VALID };
  const teks = nilai.trim();
  if (!teks) return { ok: true, input: '' };
  if (!tanggalKalenderValid(teks))
    return { ok: false, error: PESAN_TANGGAL_TIDAK_VALID };
  return { ok: true, input: teks };
}

/** Dipakai main untuk tanggal opsional di luar filter laporan (mis. koreksi). */
export function validasiTanggalOpsional(nilai: unknown): HasilBentuk<string> {
  return tanggalFilterLaporan(nilai);
}

/**
 * Normalisasi filter Buku Besar / daftar jurnal per akun. Selain format,
 * urutan tanggal juga diperiksa agar rentang tidak terbalik.
 */
export function validasiFilterBukuBesar(nilai: unknown): HasilBentuk<FilterBukuBesar> {
  if (!objek(nilai)) return { ok: false, error: 'Data filter laporan tidak lengkap.' };

  const akun = teksOpsional(nilai.akun_kode, 'Akun', 20);
  if (!akun.ok) return akun;
  if (!akun.nilai) return { ok: false, error: 'Akun wajib dipilih.' };

  const mulai = tanggalFilterLaporan(nilai.mulai);
  if (!mulai.ok) return mulai;
  const sampai = tanggalFilterLaporan(nilai.sampai);
  if (!sampai.ok) return sampai;
  if (mulai.input && sampai.input && mulai.input > sampai.input)
    return { ok: false, error: 'Tanggal mulai tidak boleh setelah tanggal sampai.' };

  return {
    ok: true,
    input: {
      akun_kode: akun.nilai,
      ...(mulai.input ? { mulai: mulai.input } : {}),
      ...(sampai.input ? { sampai: sampai.input } : {}),
    },
  };
}

/** Cut-off Neraca Saldo wajib diisi dan harus tanggal kalender nyata. */
export function validasiCutoffLaporan(nilai: unknown): HasilBentuk<string> {
  const cutoff = tanggalFilterLaporan(nilai);
  if (!cutoff.ok) return cutoff;
  if (!cutoff.input) return { ok: false, error: 'Tanggal laporan wajib diisi.' };
  return { ok: true, input: cutoff.input };
}

export type FilterNeracaSaldo = {
  cutoff: string;
  mode: ModeNeracaSaldo;
};

/**
 * Bentuk request Neraca Saldo (AUD-21b):
 * `{ cutoff, mode: 'tahun' | 'kumulatif' }`.
 *
 * Pemanggil lama yang hanya mengirim string cut-off tetap diterima dan
 * memakai default aman `tahun` (bukan perilaku kumulatif lama). `mode` yang
 * tidak dikenal ditolak agar export tidak diam-diam memakai mode lain.
 */
export function validasiFilterNeracaSaldo(
  nilai: unknown,
): HasilBentuk<FilterNeracaSaldo> {
  if (typeof nilai === 'string') {
    const cutoff = validasiCutoffLaporan(nilai);
    if (!cutoff.ok) return cutoff;
    return { ok: true, input: { cutoff: cutoff.input, mode: 'tahun' } };
  }
  if (!objek(nilai))
    return { ok: false, error: 'Data laporan Neraca Saldo tidak lengkap.' };

  const cutoff = validasiCutoffLaporan(nilai.cutoff);
  if (!cutoff.ok) return cutoff;

  const mode = nilai.mode;
  if (mode !== undefined && mode !== 'tahun' && mode !== 'kumulatif')
    return {
      ok: false,
      error: 'Mode Neraca Saldo tidak valid. Pilih tahun berjalan atau kumulatif.',
    };

  return {
    ok: true,
    input: { cutoff: cutoff.input, mode: mode ?? 'tahun' },
  };
}

// ---------------------------------------------------------------------------
// Filter laporan Laba Rugi, Neraca, dan Arus Kas (P1-9)
// ---------------------------------------------------------------------------

export type FilterPeriodeLaporan = {
  mulai?: string;
  sampai?: string;
};

/**
 * Rentang periode laporan (Laba Rugi / Arus Kas). Kedua tanggal opsional,
 * tetapi bila diisi wajib tanggal kalender nyata dan urutannya tidak terbalik.
 */
export function validasiRentangLaporan(
  nilai: unknown,
): HasilBentuk<FilterPeriodeLaporan> {
  if (!objek(nilai)) return { ok: false, error: 'Data filter laporan tidak lengkap.' };

  const mulai = tanggalFilterLaporan(nilai.mulai);
  if (!mulai.ok) return mulai;
  const sampai = tanggalFilterLaporan(nilai.sampai);
  if (!sampai.ok) return sampai;
  if (mulai.input && sampai.input && mulai.input > sampai.input)
    return { ok: false, error: 'Tanggal mulai tidak boleh setelah tanggal sampai.' };

  return {
    ok: true,
    input: {
      ...(mulai.input ? { mulai: mulai.input } : {}),
      ...(sampai.input ? { sampai: sampai.input } : {}),
    },
  };
}

export type FilterNeracaLaporan = {
  cutoff: string;
};

/** Bentuk request Neraca: `{ cutoff }`, wajib tanggal kalender nyata. */
export function validasiFilterNeraca(
  nilai: unknown,
): HasilBentuk<FilterNeracaLaporan> {
  if (!objek(nilai))
    return { ok: false, error: 'Data laporan Neraca tidak lengkap.' };
  const cutoff = validasiCutoffLaporan(nilai.cutoff);
  if (!cutoff.ok) return cutoff;
  return { ok: true, input: { cutoff: cutoff.input } };
}

/** ID jurnal untuk drill-down detail; hanya string wajar yang diteruskan. */
export function validasiIdJurnal(nilai: unknown): HasilBentuk<string> {
  if (typeof nilai !== 'string' || !nilai.trim())
    return { ok: false, error: 'Jurnal wajib dipilih.' };
  const id = nilai.trim();
  if (id.length > 200) return { ok: false, error: 'ID jurnal terlalu panjang.' };
  return { ok: true, input: id };
}

// ---------------------------------------------------------------------------
// Pengaturan pembukuan (P1-13)
// ---------------------------------------------------------------------------

/**
 * Normalisasi + validasi bentuk pengaturan dari renderer. Hanya field yang
 * dikenal yang diteruskan; nilai mentah tidak pernah masuk DB.
 */
export function validasiBentukPengaturanPembukuan(
  nilai: unknown,
): HasilBentuk<PengaturanPembukuan> {
  if (!objek(nilai))
    return { ok: false, error: 'Data pengaturan pembukuan tidak lengkap.' };

  const input = normalisasiPengaturan(nilai);
  const errors = validasiPengaturan(input);
  if (errors.length > 0)
    return { ok: false, error: errors.join(' ') };

  return { ok: true, input };
}
