// Posting layer (P0-4): aturan bisnis jurnal double-entry, satu pintu.
// Fungsi murni — tanpa DB/Electron. Pemanggil (main/IPC/test) menyiapkan `ctx`
// dari database: master akun, tahun tutup buku, nomor bukti terpakai, saldo kas.
//
// Prinsip:
// - Error = jurnal tidak boleh disimpan.
// - Peringatan = boleh disimpan, tetapi operator wajib konfirmasi (mis. kas minus).

import {
  AKUN_HUTANG,
  AKUN_HUTANG_USAHA,
  PESAN_AKUN_LEGACY,
  POSISI_NORMAL,
  akunBolehDiposting,
  isAkunKas,
  type CoaTipe,
  type PosisiNormal,
} from '../db/coa.js';
import { validasiSimpanLonggar } from './periode.js';
import type { JurnalBarisInput, JurnalHeaderInput, JurnalJenis } from './types.js';
import { formatRp } from '../utils/format.js';
import { PESAN_TANGGAL_TIDAK_VALID } from '../utils/pesanError.js';

export const JENIS_JURNAL: readonly JurnalJenis[] = [
  'UMUM',
  'TERIMA',
  'BAYAR',
  'TRANSFER',
  'PANJAR',
  'PIUTANG',
  'HUTANG',
  'SALDO_AWAL',
  'REVERSAL',
];

const TIPE_AKUN: readonly CoaTipe[] = ['AKTIVA', 'KEWAJIBAN', 'EKUITAS', 'PENDAPATAN', 'BEBAN'];

/** Akun master yang dipakai validator (bentuk aman untuk fungsi murni). */
export type AkunPosting = {
  kode: string;
  nama?: string;
  tipe: CoaTipe;
  posisi_normal?: PosisiNormal;
  aktif: boolean;
};

/** Konteks DB yang dibutuhkan posting layer, sudah diambil pemanggil. */
export type PostingContext = {
  akun: AkunPosting[];
  /** Tahun yang sudah ditutup. Tanggal <= 31 Des tahun terakhir butuh alasan. */
  tutupBuku?: ReadonlyArray<{ tahun: number }>;
  /** Nomor bukti yang sudah dipakai (boleh kosong). */
  noBuktiTerpakai?: readonly string[];
  /** Saldo kas/bank saat ini dalam sen, per kode akun. */
  saldoKas?: Readonly<Record<string, number>>;
  /**
   * AKT-04: minimum cumulative sum (≤ 0) mutasi kas pada tanggal SETELAH
   * tanggal jurnal, per kode akun kas. Menunjukkan tambahan terburuk yang bisa
   * menimpa saldo pada tanggal jurnal (mis. pengeluaran backdate). Kosong = 0.
   */
  kasMinimumSetelah?: Record<string, number>;
  /**
   * AKT-03: batas bawah tanggal jurnal (YYYY-MM-DD) dari pengaturan pembukuan.
   * Kosong/tidak valid = tidak ada batas (kompatibel data lama).
   */
  tanggalMulaiPembukuan?: string;
  /**
   * AKT-14: tanggal acuan "hari ini" (YYYY-MM-DD) untuk menolak jurnal di masa
   * depan. Kosong/tidak valid = pemeriksaan dilewati (kompatibel pemanggil lama
   * dan test murni). `buatKonteksPosting` mengisinya dengan `tanggalLokal()`.
   */
  sekarang?: string;
};

/** AKT-14: pesan penolakan tanggal jurnal setelah hari ini. */
export const PESAN_TANGGAL_MASA_DEPAN = 'Tanggal jurnal tidak boleh di masa depan.';

/**
 * AKT-29: input yang tidak berbentuk objek jurnal ditolak lewat hasil validasi,
 * bukan exception, agar pemanggil IPC/UI tetap mendapat daftar error.
 */
export const PESAN_INPUT_JURNAL_TIDAK_VALID =
  'Data jurnal tidak valid: header jurnal wajib diisi.';

/** AKT-16: pesan penolakan jurnal penutup manual (P&L dicampur ekuitas). */
export const PESAN_JURNAL_PENUTUP_MANUAL =
  'Jurnal penutup manual tidak didukung. Tutup buku hanya penanda; gunakan menu Tutup Buku. Untuk pembayaran beban oleh pemilik, buat dua jurnal: beban/kas lalu kas/modal.';

export type JurnalInput = {
  header: JurnalHeaderInput;
  baris: JurnalBarisInput[];
  /** Wajib diisi bila tanggal berada di periode yang sudah ditutup. */
  alasan?: string;
};

export type HasilValidasiJurnal = {
  /** true bila tidak ada error (peringatan tetap boleh). */
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  /** true bila ada peringatan yang wajib dikonfirmasi sebelum simpan. */
  perluKonfirmasi: boolean;
};

const TGL = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Tanggal kalender sungguhan (YYYY-MM-DD). Bukan sekadar regex/Date.parse:
 * `2026-02-31` ditolak, `2028-02-29` diterima (tahun kabisat).
 */
export function tanggalKalenderValid(tanggal: string): boolean {
  const m = TGL.exec(String(tanggal ?? ''));
  if (!m) return false;
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  if (tahun < 1900 || tahun > 9999 || bulan < 1 || bulan > 12 || hari < 1) return false;
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  return (
    d.getUTCFullYear() === tahun && d.getUTCMonth() === bulan - 1 && d.getUTCDate() === hari
  );
}

const labelAkun = (a: AkunPosting | undefined, kode: string): string =>
  a?.nama ? `${kode} ${a.nama}` : kode;

/**
 * Validasi lengkap satu jurnal sebelum disimpan.
 *
 * Urutan aturan:
 * 1. Tanggal kalender nyata, tidak sebelum tanggal mulai pembukuan (kecuali
 *    SALDO_AWAL), tidak setelah hari ini (AKT-14), keterangan, minimal 2 baris.
 * 2. Akun ada, aktif, bukan akun legacy 3001/3002, tipe/posisi normal
 *    konsisten, nominal sen valid.
 * 3. Jenis jurnal konsisten dengan akun (TRANSFER kas/bank; PANJAR 1040;
 *    PIUTANG 1050; HUTANG 2050 pinjaman atau 2060 utang usaha).
 * 4. Jurnal penutup manual (P&L + ekuitas) ditolak, kecuali SALDO_AWAL.
 * 4b. Jurnal ber-kas yang memuat 2050 dan 2060 sekaligus ditolak agar tidak
 *    ada satu jurnal dengan dua kelompok arus kas; reklasifikasi non-kas tetap
 *    diperbolehkan (AKT-20).
 * 5. Total debit = total kredit dan > 0.
 * 6. Periode terkunci wajib alasan >= 5 karakter.
 * 7. Kas/bank akan minus -> peringatan (bukan error).
 * 8. Nomor bukti duplikat ditolak.
 */
export function validasiJurnal(
  input: JurnalInput | null | undefined,
  ctx: PostingContext,
): HasilValidasiJurnal {
  const errors: string[] = [];
  const peringatan: string[] = [];
  const konteks = (ctx ?? {}) as PostingContext;
  const headerMentah = input?.header;
  const headerObj =
    headerMentah !== null && typeof headerMentah === 'object'
      ? (headerMentah as Partial<JurnalHeaderInput>)
      : null;
  if (!headerObj) errors.push(PESAN_INPUT_JURNAL_TIDAK_VALID);
  const header: Partial<JurnalHeaderInput> = headerObj ?? {};
  const tanggal = String(header.tanggal ?? '').trim();
  const jenis = String(header.jenis ?? 'UMUM') as JurnalJenis;
  const baris = Array.isArray(input?.baris) ? input.baris : [];
  const alasan = String(input?.alasan ?? '').trim();

  // ---- 1. Kepala jurnal ----
  if (!tanggalKalenderValid(tanggal))
    errors.push(PESAN_TANGGAL_TIDAK_VALID);

  // AKT-03: tanggal mulai pembukuan adalah batas bawah. SALDO_AWAL dikecualikan
  // agar wizard tetap bisa memakai tanggal yang berbeda; setting kosong/tidak
  // valid tidak membatasi apa pun (kompatibel data lama).
  const tanggalMulai = String(konteks.tanggalMulaiPembukuan ?? '').trim();
  if (
    jenis !== 'SALDO_AWAL' &&
    tanggalKalenderValid(tanggalMulai) &&
    tanggalKalenderValid(tanggal) &&
    tanggal < tanggalMulai
  ) {
    errors.push(
      `Tanggal jurnal sebelum tanggal mulai pembukuan (${tanggalMulai}).`,
    );
  }

  // AKT-14: tanggal setelah hari ini ditolak. Perbandingan string aman karena
  // keduanya sudah lolos validasi kalender berformat YYYY-MM-DD. Tanggal hari
  // ini tetap diterima; ctx.sekarang kosong (pemanggil lama/fungsi murni) tidak
  // membatasi apa pun.
  const sekarang = String(konteks.sekarang ?? '').trim();
  if (
    tanggalKalenderValid(sekarang) &&
    tanggalKalenderValid(tanggal) &&
    tanggal > sekarang
  ) {
    errors.push(PESAN_TANGGAL_MASA_DEPAN);
  }

  if (!String(header.keterangan ?? '').trim()) errors.push('Keterangan wajib diisi.');
  if (baris.length < 2)
    errors.push('Jurnal wajib memiliki minimal 2 baris (satu debit dan satu kredit).');

  const daftarAkun = Array.isArray(konteks.akun) ? konteks.akun : [];
  const petaAkun = new Map(daftarAkun.map((a) => [a.kode, a]));

  const deltaKas = new Map<string, number>();
  let totalDebit = 0;
  let totalKredit = 0;
  let adaNominalSalah = false;

  // ---- 2. Baris: akun, tipe, nominal ----
  baris.forEach((b, i) => {
    const no = i + 1;
    // AKT-29: baris null/undefined tidak boleh membuat validator melempar.
    const item = b !== null && typeof b === 'object' ? b : ({} as JurnalBarisInput);
    const kode = String(item.akun_kode ?? '').trim();
    const akunBaris = petaAkun.get(kode);

    if (!kode) errors.push(`Baris ${no}: akun belum dipilih.`);
    else if (!akunBaris) errors.push(`Baris ${no}: akun ${kode} tidak dikenal.`);
    else if (!akunBaris.aktif) errors.push(`Baris ${no}: akun ${labelAkun(akunBaris, kode)} sudah tidak aktif.`);
    else if (!akunBolehDiposting(kode, akunBaris.aktif, { dikenal: true }))
      errors.push(`Baris ${no}: akun ${labelAkun(akunBaris, kode)} ${PESAN_AKUN_LEGACY}`);

    if (akunBaris) {
      if (!TIPE_AKUN.includes(akunBaris.tipe))
        errors.push(`Baris ${no}: jenis akun ${labelAkun(akunBaris, kode)} tidak dikenal.`);
      else if (
        akunBaris.posisi_normal &&
        akunBaris.posisi_normal !== POSISI_NORMAL[akunBaris.tipe]
      )
        errors.push(
          `Baris ${no}: posisi normal akun ${labelAkun(akunBaris, kode)} tidak sesuai jenisnya.`,
        );
    }

    const debit = item.debit;
    const kredit = item.kredit;
    const debitOk = Number.isSafeInteger(debit) && debit >= 0;
    const kreditOk = Number.isSafeInteger(kredit) && kredit >= 0;
    if (!debitOk) errors.push(`Baris ${no}: debit harus bilangan bulat ≥ 0.`);
    if (!kreditOk) errors.push(`Baris ${no}: kredit harus bilangan bulat ≥ 0.`);

    if (!debitOk || !kreditOk) {
      adaNominalSalah = true;
      return;
    }
    if (debit > 0 && kredit > 0) {
      errors.push(`Baris ${no}: isi salah satu saja — debit ATAU kredit.`);
      adaNominalSalah = true;
      return;
    }
    if (debit === 0 && kredit === 0) {
      errors.push(`Baris ${no}: nominal debit/kredit harus lebih dari 0.`);
      adaNominalSalah = true;
      return;
    }

    totalDebit += debit;
    totalKredit += kredit;
    if (akunBaris && isAkunKas(kode))
      deltaKas.set(kode, (deltaKas.get(kode) ?? 0) + debit - kredit);
  });

  // ---- 3. Jenis jurnal konsisten dengan akun yang dipakai ----
  if (!JENIS_JURNAL.includes(jenis)) {
    errors.push('Jenis jurnal tidak dikenal.');
  } else {
    const kodeSah = baris
      .map((b) => String(b?.akun_kode ?? '').trim())
      .filter((kode) => petaAkun.has(kode));

    if (jenis === 'TRANSFER') {
      const bukanKas = kodeSah.filter((kode) => !isAkunKas(kode));
      if (bukanKas.length > 0)
        errors.push('Jurnal Pindah Dana hanya boleh memakai akun kas/bank.');
      const kasUnik = new Set(kodeSah.filter((kode) => isAkunKas(kode)));
      if (kasUnik.size < 2)
        errors.push('Pindah Dana harus memakai dua akun kas/bank yang berbeda.');
    }
    if (jenis === 'PANJAR' && !kodeSah.includes('1040'))
      errors.push('Jurnal Panjar wajib memakai akun 1040 UANG PANJAR (KAS DI MUKA).');
    if (jenis === 'PIUTANG' && !kodeSah.includes('1050'))
      errors.push('Jurnal Piutang wajib memakai akun 1050 PIUTANG LAIN LAIN.');
    if (jenis === 'HUTANG' && !kodeSah.includes(AKUN_HUTANG) && !kodeSah.includes(AKUN_HUTANG_USAHA))
      errors.push(
        'Jurnal Hutang wajib memakai akun 2050 HUTANG LAIN-LAIN (pinjaman) atau 2060 HUTANG USAHA (utang usaha).',
      );
  }

  // ---- 3a. Jurnal campuran 2050 + 2060 (AKT-20) ----
  // Satu jurnal ber-kas tidak boleh memuat dua kelompok arus kas sekaligus.
  // Jurnal reklasifikasi D 2050 / K 2060 tanpa kas tetap diperbolehkan.
  if (jenis !== 'SALDO_AWAL') {
    const kodeSah = baris
      .map((b) => String(b?.akun_kode ?? '').trim())
      .filter((kode) => petaAkun.has(kode));
    const adaKas = kodeSah.some((kode) => isAkunKas(kode));
    if (
      adaKas &&
      kodeSah.includes(AKUN_HUTANG) &&
      kodeSah.includes(AKUN_HUTANG_USAHA)
    )
      errors.push(
        'Satu jurnal tidak boleh memuat 2050 (pinjaman) dan 2060 (utang usaha) sekaligus bila ada kas. ' +
          'Pisahkan pembayaran utang usaha dan pinjaman ke jurnal terpisah.',
      );
  }

  // ---- 3b. Larangan jurnal penutup manual (AKT-16) ----
  // P&L dan ekuitas dalam satu jurnal adalah bentuk penutup manual: laba tahun
  // berjalan dan riwayat tutup buku menjadi 0 walau neraca tetap balance.
  // SALDO_AWAL dikecualikan karena bukan operasi P&L (saldo awal ekuitas tetap
  // sah). Bila nanti dibutuhkan alur penutup resmi, tambahkan jenis `PENUTUP`
  // tersendiri — jangan melonggarkan aturan ini diam-diam.
  if (jenis !== 'SALDO_AWAL') {
    const tipeDipakai = new Set<CoaTipe>();
    for (const b of baris) {
      const akunBaris = petaAkun.get(String(b?.akun_kode ?? '').trim());
      if (akunBaris) tipeDipakai.add(akunBaris.tipe);
    }
    const adaLabaRugi = tipeDipakai.has('PENDAPATAN') || tipeDipakai.has('BEBAN');
    if (adaLabaRugi && tipeDipakai.has('EKUITAS'))
      errors.push(PESAN_JURNAL_PENUTUP_MANUAL);
  }

  // ---- 4. Keseimbangan ----
  if (!adaNominalSalah && baris.length >= 2) {
    if (totalDebit !== totalKredit)
      errors.push(
        `Jurnal tidak seimbang: total debit ${formatRp(totalDebit)} ≠ total kredit ${formatRp(totalKredit)}.`,
      );
    else if (totalDebit <= 0) errors.push('Total jurnal harus lebih dari 0.');
  }

  // ---- 5. Kunci periode (longgar: alasan >= 5 karakter) ----
  if (tanggalKalenderValid(tanggal)) {
    const kunci = validasiSimpanLonggar(tanggal, konteks.tutupBuku ?? [], alasan);
    if (!kunci.boleh && kunci.error) errors.push(kunci.error);
  }

  // ---- 6. Kas/bank minus: peringatan, bukan error ----
  // AKT-04: yang dinilai adalah saldo TERBURUK, yaitu saldo pada tanggal jurnal
  // ditambah minimum cumulative sum mutasi setelah tanggal itu. Dengan begitu
  // jurnal backdate tetap diperingatkan bila membuat kas minus di tanggal
  // berikutnya, dan hanya ada satu pesan per akun (nominal minus terburuk).
  if (konteks.saldoKas) {
    for (const [kode, delta] of deltaKas) {
      const saldoAwal = konteks.saldoKas[kode];
      if (saldoAwal === undefined || delta === 0) continue;
      const saldoTerburuk = saldoAwal + delta + (konteks.kasMinimumSetelah?.[kode] ?? 0);
      if (saldoTerburuk < 0) {
        peringatan.push(
          `Kas/Bank ${labelAkun(petaAkun.get(kode), kode)} akan minus ${formatRp(-saldoTerburuk)}. Periksa kembali — boleh lanjut dengan konfirmasi.`,
        );
      }
    }
  }

  // ---- 7. Nomor bukti unik ----
  const noBukti = String(header.no_bukti ?? '').trim();
  if (noBukti) {
    const dipakai = new Set(
      (konteks.noBuktiTerpakai ?? []).map((n) => String(n).trim().toLowerCase()),
    );
    if (dipakai.has(noBukti.toLowerCase()))
      errors.push(`Nomor bukti ${noBukti} sudah dipakai. Gunakan nomor bukti lain.`);
  }

  return {
    boleh: errors.length === 0,
    errors,
    peringatan,
    perluKonfirmasi: peringatan.length > 0,
  };
}
