// Parser & validator murni untuk impor jurnal dari Excel (P2-9).
//
// Modul ini TIDAK menyentuh database/Electron. Tugasnya hanya membaca workbook
// ExcelJS, menormalkan bentuk baris, lalu memvalidasi struktur + akun. Semua
// jurnal tetap disimpan lewat posting layer oleh `src/db/impor.ts`.
//
// Dua bentuk yang didukung:
// 1. Multi-baris (utama, sesuai template):
//      grup | tanggal | no_bukti | keterangan | akun | debit | kredit | catatan
//    Beberapa baris dengan `grup` sama digabung menjadi satu jurnal.
// 2. Sederhana per baris:
//      tanggal | keterangan | akun_debit | akun_kredit | nominal | no_bukti | catatan
//    Satu baris Excel = satu jurnal dua baris.
//
// Satuan nominal: input operator adalah RUPIAH (bukan sen); parser mengubahnya
// menjadi SEN agar sama dengan seluruh mesin akuntansi aplikasi.

import ExcelJS from 'exceljs';
import { COA, PESAN_AKUN_LEGACY, akunBolehDiposting } from '../../db/coa.js';
import { tanggalKalenderValid } from '../../core/posting.js';
import type { JurnalBarisInput, JurnalHeaderInput } from '../../core/types.js';
import { formatRp } from '../../utils/format.js';

/** Batas aman file & baris impor (dipakai IPC + parser). */
export const BATAS_UKURAN_IMPOR = 10 * 1024 * 1024; // 10 MB
export const BATAS_BARIS_IMPOR = 5000;

const SHEET_JURNAL = 'Jurnal';

export type StatusImpor = 'OK' | 'GAGAL';

/** Akun yang boleh dipakai; default seluruh COA resmi (aktif). */
export type AkunImpor = {
  kode: string;
  nama?: string;
  tipe?: string;
  aktif?: boolean;
};

export type HasilBarisImpor = {
  /** Nomor urut baris hasil (1..n), dipakai tabel hasil. */
  nomorBaris: number;
  /** Nomor baris asli di sheet Excel (1-based, termasuk header). */
  barisExcel: number;
  grup: string;
  /** Tanggal ISO YYYY-MM-DD bila valid; string mentah bila tidak valid. */
  tanggal: string;
  keterangan: string;
  akun: string;
  /** Nominal dalam SEN (sudah dikonversi dari rupiah). */
  debit: number;
  /** Nominal dalam SEN (sudah dikonversi dari rupiah). */
  kredit: number;
  catatan: string;
  status: StatusImpor;
  alasan: string;
  /** Hanya untuk bentuk sederhana: sisi jurnal yang dibuat parser. */
  sisi?: 'DEBIT' | 'KREDIT';
  /** Diisi setelah impor berhasil: jurnal & nomor bukti yang terbentuk. */
  jurnalId?: string;
  noBukti?: string;
};

export type HasilGrupImpor = {
  grup: string;
  tanggal: string;
  keterangan: string;
  no_bukti: string;
  status: StatusImpor;
  alasan: string;
  /** Nomor baris Excel yang menjadi anggota grup ini. */
  barisExcel: number[];
  totalDebit: number;
  totalKredit: number;
  seimbang: boolean;
  /** Peringatan validasi DB (mis. kas minus), belum error. */
  peringatan?: string[];
  /** true bila impor grup ini butuh konfirmasi operator (kas minus). */
  perluKonfirmasi?: boolean;
  /** Diisi setelah impor berhasil. */
  jurnalId?: string;
  noBuktiDibuat?: string;
  /**
   * Input siap-posting (id sengaja kosong; adapter DB yang membuat id unik).
   * Hanya diisi untuk grup yang lolos validasi parser.
   */
  input?: {
    header: JurnalHeaderInput;
    baris: JurnalBarisInput[];
  };
};

export type RingkasanImpor = {
  totalBaris: number;
  valid: number;
  gagal: number;
  totalDebit: number;
  totalKredit: number;
  seimbang: boolean;
  totalGrup: number;
  grupValid: number;
  grupGagal: number;
};

export type HasilParseImpor = {
  grup: HasilGrupImpor[];
  baris: HasilBarisImpor[];
  ringkasan: RingkasanImpor;
  /** Masalah tingkat file/sheet (bukan per baris). */
  errors: string[];
  namaFile?: string;
};

export type OpsiParseImpor = {
  /** Daftar akun valid. Default: COA resmi (semua aktif). */
  akun?: readonly AkunImpor[];
  namaFile?: string;
  /** Batas baris data (default 5000). */
  maksBaris?: number;
};

/** Normalisasi header: trim, lowercase, spasi → underscore. */
export function normalisasiHeader(nilai: unknown): string {
  return String(nilai ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** Pesan batas file/baris; null bila masih aman. */
export function validasiBatasImpor(input: {
  ukuran?: number;
  jumlahBaris?: number;
  maksUkuran?: number;
  maksBaris?: number;
}): string | null {
  const maksUkuran = input.maksUkuran ?? BATAS_UKURAN_IMPOR;
  const maksBaris = input.maksBaris ?? BATAS_BARIS_IMPOR;
  if (Number.isFinite(input.ukuran) && Number(input.ukuran) > maksUkuran) {
    return `Ukuran file terlalu besar (maksimal ${Math.round(maksUkuran / (1024 * 1024))} MB).`;
  }
  if (Number.isFinite(input.jumlahBaris) && Number(input.jumlahBaris) > maksBaris) {
    return `Jumlah baris terlalu banyak (maksimal ${new Intl.NumberFormat('id-ID').format(maksBaris)} baris).`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pembacaan sel
// ---------------------------------------------------------------------------

function teksNilai(nilai: unknown): string {
  if (nilai === null || nilai === undefined) return '';
  if (nilai instanceof Date) {
    return Number.isNaN(nilai.getTime()) ? '' : nilai.toISOString().slice(0, 10);
  }
  if (typeof nilai === 'string') return nilai.trim();
  if (typeof nilai === 'number' || typeof nilai === 'boolean') return String(nilai);
  if (typeof nilai === 'object') {
    const obj = nilai as Record<string, unknown>;
    // Cell rich text: { richText: [{ text }] }
    if (Array.isArray(obj.richText)) {
      return obj.richText
        .map((bagian) => String((bagian as { text?: unknown })?.text ?? ''))
        .join('')
        .trim();
    }
    // Formula: { formula, result } / shared formula.
    if ('result' in obj) return teksNilai(obj.result);
    // Hyperlink: { text, hyperlink }
    if ('text' in obj) return teksNilai(obj.text);
    if ('error' in obj) return '';
  }
  return '';
}

function teksSel(cell: ExcelJS.Cell): string {
  return teksNilai(cell.value);
}

/**
 * Tanggal dari sel: Date, serial Excel, YYYY-MM-DD, atau DD/MM/YYYY
 * (juga DD-MM-YYYY). Hasil ISO hanya bila benar-benar tanggal kalender.
 */
export function parseTanggalImpor(nilai: unknown): {
  iso: string;
  mentah: string;
  error?: string;
} {
  const mentah = teksNilai(nilai);
  if (!mentah) return { iso: '', mentah: '' };

  // Date object / serial Excel.
  if (nilai instanceof Date && !Number.isNaN(nilai.getTime())) {
    const iso = nilai.toISOString().slice(0, 10);
    return tanggalKalenderValid(iso)
      ? { iso, mentah }
      : { iso: '', mentah, error: `Tanggal "${mentah}" tidak valid.` };
  }
  if (typeof nilai === 'number' && Number.isFinite(nilai)) {
    const epoch = Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.round(nilai) * 86_400_000);
    const iso = d.toISOString().slice(0, 10);
    return tanggalKalenderValid(iso)
      ? { iso, mentah }
      : { iso: '', mentah, error: `Tanggal "${mentah}" tidak valid.` };
  }

  const teks = mentah.trim();
  let tahun = '';
  let bulan = '';
  let hari = '';
  const isoM = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(teks);
  const dmyM = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(teks);
  if (isoM) {
    tahun = isoM[1]!;
    bulan = isoM[2]!;
    hari = isoM[3]!;
  } else if (dmyM) {
    hari = dmyM[1]!;
    bulan = dmyM[2]!;
    tahun = dmyM[3]!;
  } else {
    return {
      iso: '',
      mentah,
      error: `Tanggal "${teks}" tidak valid. Gunakan format YYYY-MM-DD atau DD/MM/YYYY.`,
    };
  }

  const iso = `${tahun.padStart(4, '0')}-${bulan.padStart(2, '0')}-${hari.padStart(2, '0')}`;
  if (!tanggalKalenderValid(iso)) {
    return {
      iso: '',
      mentah,
      error: `Tanggal "${teks}" tidak valid (tanggal kalender tidak ada).`,
    };
  }
  return { iso, mentah };
}

/**
 * Nominal Rupiah dari sel → SEN. Menerima angka Excel atau teks seperti
 * "Rp 150.000", "1.500.000", "150000". Wajib bilangan bulat rupiah ≥ 0.
 */
export function parseNominalImpor(nilai: unknown): { sen: number; error?: string } {
  if (nilai === null || nilai === undefined || nilai === '') return { sen: 0 };

  if (typeof nilai === 'number') {
    if (!Number.isFinite(nilai)) return { sen: 0, error: 'Nominal tidak valid.' };
    if (nilai < 0) return { sen: 0, error: 'Nominal tidak boleh negatif.' };
    if (!Number.isInteger(nilai))
      return { sen: 0, error: 'Nominal harus bilangan bulat rupiah (tanpa sen).' };
    const sen = nilai * 100;
    if (!Number.isSafeInteger(sen)) return { sen: 0, error: 'Nominal terlalu besar.' };
    return { sen };
  }

  const teks = teksNilai(nilai);
  if (!teks) return { sen: 0 };
  let bersih = teks.replace(/^rp\.?\s*/i, '').replace(/\s+/g, '');
  if (!bersih) return { sen: 0, error: `Nominal "${teks}" tidak valid.` };
  if (bersih.startsWith('-') || (bersih.startsWith('(') && bersih.endsWith(')')))
    return { sen: 0, error: 'Nominal tidak boleh negatif.' };

  // Buang simbol mata uang lain / pemisah ribuan yang lazim.
  bersih = bersih.replace(/[^0-9.,]/g, '');
  if (!bersih) return { sen: 0, error: `Nominal "${teks}" tidak valid.` };

  const adaTitik = bersih.includes('.');
  const adaKoma = bersih.includes(',');
  let bulat = bersih;
  let desimal = '';
  if (adaTitik && adaKoma) {
    // Pemisah desimal = pemisah yang terakhir muncul.
    const iTitik = bersih.lastIndexOf('.');
    const iKoma = bersih.lastIndexOf(',');
    if (iKoma > iTitik) {
      bulat = bersih.slice(0, iKoma).replace(/[.,]/g, '');
      desimal = bersih.slice(iKoma + 1);
    } else {
      bulat = bersih.slice(0, iTitik).replace(/[.,]/g, '');
      desimal = bersih.slice(iTitik + 1);
    }
  } else if (adaTitik || adaKoma) {
    const pemisah = adaTitik ? '.' : ',';
    const bagian = bersih.split(pemisah);
    if (bagian.length > 2) {
      // 1.000.000 → seluruh pemisah adalah ribuan.
      bulat = bagian.join('');
    } else if (bagian[1]!.length === 3) {
      // 150.000 → ribuan (kebiasaan Indonesia).
      bulat = bagian.join('');
    } else {
      bulat = bagian[0]!;
      desimal = bagian[1]!;
    }
  }
  if (!/^\d*$/.test(bulat) || !/^\d*$/.test(desimal))
    return { sen: 0, error: `Nominal "${teks}" tidak valid.` };
  if (!bulat && !desimal) return { sen: 0, error: `Nominal "${teks}" tidak valid.` };
  if (/[1-9]/.test(desimal))
    return { sen: 0, error: 'Nominal harus bilangan bulat rupiah (tanpa sen).' };

  const rupiah = Number(bulat || '0');
  if (!Number.isSafeInteger(rupiah)) return { sen: 0, error: 'Nominal terlalu besar.' };
  const sen = rupiah * 100;
  if (!Number.isSafeInteger(sen)) return { sen: 0, error: 'Nominal terlalu besar.' };
  return { sen };
}

// ---------------------------------------------------------------------------
// Pembacaan sheet
// ---------------------------------------------------------------------------

type HeaderSheet = { barisHeader: number; kolom: Map<string, number> };

function bacaHeaderSheet(ws: ExcelJS.Worksheet): HeaderSheet | null {
  // Header biasanya baris pertama, tetapi beri ruang bila ada judul di atas.
  for (let nomor = 1; nomor <= Math.min(20, ws.rowCount || 0); nomor++) {
    const row = ws.getRow(nomor);
    const kolom = new Map<string, number>();
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const nama = normalisasiHeader(cell.value);
      if (nama && !kolom.has(nama)) kolom.set(nama, colNumber);
    });
    if (kolom.size === 0) continue;
    const multi =
      kolom.has('grup') && kolom.has('akun') && kolom.has('debit') && kolom.has('kredit');
    const sederhana =
      kolom.has('tanggal') &&
      kolom.has('keterangan') &&
      kolom.has('akun_debit') &&
      kolom.has('akun_kredit') &&
      kolom.has('nominal');
    if (multi || sederhana) return { barisHeader: nomor, kolom };
  }
  return null;
}

function cariSheetJurnal(wb: ExcelJS.Workbook): {
  ws: ExcelJS.Worksheet | null;
  header: HeaderSheet | null;
} {
  const bernama = wb.worksheets.find(
    (ws) => normalisasiHeader(ws.name) === normalisasiHeader(SHEET_JURNAL),
  );
  if (bernama) {
    const header = bacaHeaderSheet(bernama);
    if (header) return { ws: bernama, header };
  }
  for (const ws of wb.worksheets) {
    const header = bacaHeaderSheet(ws);
    if (header) return { ws, header };
  }
  return { ws: bernama ?? null, header: null };
}

/** Ambil nilai sel berdasarkan nama header; string kosong bila kolom tidak ada. */
function nilaiKolom(
  row: ExcelJS.Row,
  kolom: Map<string, number>,
  nama: string,
): unknown {
  const c = kolom.get(nama);
  return c === undefined ? undefined : row.getCell(c).value;
}

function angkaSel(row: ExcelJS.Row, kolom: Map<string, number>, nama: string): unknown {
  const c = kolom.get(nama);
  return c === undefined ? undefined : row.getCell(c).value;
}

type BarisMentah = {
  barisExcel: number;
  grup: string;
  tanggal: unknown;
  no_bukti: string;
  keterangan: string;
  akun: string;
  debit: unknown;
  kredit: unknown;
  catatan: string;
  akun_debit?: string;
  akun_kredit?: string;
  nominal?: unknown;
};

/** Buang baris yang seluruh kolom data pentingnya kosong. */
function barisKosong(b: BarisMentah): boolean {
  return (
    !b.grup &&
    !teksNilai(b.tanggal) &&
    !b.no_bukti &&
    !b.keterangan &&
    !b.akun &&
    !teksNilai(b.debit) &&
    !teksNilai(b.kredit) &&
    !b.catatan &&
    !b.akun_debit &&
    !b.akun_kredit &&
    !teksNilai(b.nominal)
  );
}

// ---------------------------------------------------------------------------
// Parser utama
// ---------------------------------------------------------------------------

export async function parseImporExcel(
  buffer: ArrayBuffer | Uint8Array | Buffer,
  opsi: OpsiParseImpor = {},
): Promise<HasilParseImpor> {
  const errors: string[] = [];
  const namaFile = opsi.namaFile;
  const akunValid = new Map(
    (opsi.akun ?? COA.map((a) => ({ ...a, aktif: true }))).map((a) => [
      String(a.kode).trim(),
      { ...a, aktif: a.aktif !== false },
    ]),
  );

  const wb = new ExcelJS.Workbook();
  try {
    // ExcelJS menerima Buffer/ArrayBuffer. Salin ke Uint8Array agar aman untuk
    // pemanggil renderer/test yang mengirim ArrayBuffer.
    const data =
      buffer instanceof Uint8Array
        ? buffer
        : buffer instanceof ArrayBuffer
          ? new Uint8Array(buffer)
          : new Uint8Array(buffer as ArrayBuffer);
    await wb.xlsx.load(data as unknown as ArrayBuffer);
  } catch (e) {
    return {
      grup: [],
      baris: [],
      ringkasan: ringkasanKosong(),
      errors: [
        'File Excel tidak bisa dibaca. Pastikan file berformat .xlsx dan tidak rusak.',
      ],
      ...(namaFile ? { namaFile } : {}),
    };
  }

  const { ws, header } = cariSheetJurnal(wb);
  if (!ws || !header) {
    return {
      grup: [],
      baris: [],
      ringkasan: ringkasanKosong(),
      errors: [
        `Sheet "${SHEET_JURNAL}" tidak ditemukan atau judul kolomnya tidak dikenal. Unduh ulang template agar formatnya benar.`,
      ],
      ...(namaFile ? { namaFile } : {}),
    };
  }

  const bentukSederhana =
    header.kolom.has('akun_debit') &&
    header.kolom.has('akun_kredit') &&
    header.kolom.has('nominal') &&
    !header.kolom.has('akun');

  const mentah: BarisMentah[] = [];
  const maksBaris = opsi.maksBaris ?? BATAS_BARIS_IMPOR;
  ws.eachRow({ includeEmpty: false }, (row, nomorBaris) => {
    if (nomorBaris <= header.barisHeader) return;
    const b: BarisMentah = {
      barisExcel: nomorBaris,
      grup: teksNilai(nilaiKolom(row, header.kolom, 'grup')),
      tanggal: nilaiKolom(row, header.kolom, 'tanggal'),
      no_bukti: teksNilai(nilaiKolom(row, header.kolom, 'no_bukti')),
      keterangan: teksNilai(nilaiKolom(row, header.kolom, 'keterangan')),
      akun: teksNilai(nilaiKolom(row, header.kolom, 'akun')),
      debit: angkaSel(row, header.kolom, 'debit'),
      kredit: angkaSel(row, header.kolom, 'kredit'),
      catatan: teksNilai(nilaiKolom(row, header.kolom, 'catatan')),
      ...(bentukSederhana
        ? {
            akun_debit: teksNilai(nilaiKolom(row, header.kolom, 'akun_debit')),
            akun_kredit: teksNilai(nilaiKolom(row, header.kolom, 'akun_kredit')),
            nominal: angkaSel(row, header.kolom, 'nominal'),
          }
        : {}),
    };
    if (!barisKosong(b)) mentah.push(b);
  });

  if (mentah.length === 0) {
    errors.push(
      'Tidak ada baris data di sheet "Jurnal". Isi minimal satu grup jurnal yang seimbang.',
    );
    return {
      grup: [],
      baris: [],
      ringkasan: ringkasanKosong(),
      errors,
      ...(namaFile ? { namaFile } : {}),
    };
  }
  const batas = validasiBatasImpor({ jumlahBaris: mentah.length, maksBaris });
  if (batas) {
    errors.push(batas);
    return {
      grup: [],
      baris: [],
      ringkasan: ringkasanKosong(),
      errors,
      ...(namaFile ? { namaFile } : {}),
    };
  }

  const hasil = bentukSederhana
    ? parseBentukSederhana(mentah, akunValid)
    : parseBentukMultiBaris(mentah, akunValid);

  return {
    grup: hasil.grup,
    baris: hasil.baris,
    ringkasan: hitungRingkasanImpor(hasil.grup, hasil.baris),
    errors: [...errors, ...hasil.errors],
    ...(namaFile ? { namaFile } : {}),
  };
}

/** Alias yang lebih pendek untuk pemanggil/test. */
export const parseBufferImpor = parseImporExcel;

function ringkasanKosong(): RingkasanImpor {
  return {
    totalBaris: 0,
    valid: 0,
    gagal: 0,
    totalDebit: 0,
    totalKredit: 0,
    seimbang: false,
    totalGrup: 0,
    grupValid: 0,
    grupGagal: 0,
  };
}

/** Hitung ringkasan dari grup & baris hasil (dipakai parser + adapter DB). */
export function hitungRingkasanImpor(
  grup: HasilGrupImpor[],
  baris: HasilBarisImpor[],
): RingkasanImpor {
  const totalDebit = baris.reduce((s, b) => s + (b.debit || 0), 0);
  const totalKredit = baris.reduce((s, b) => s + (b.kredit || 0), 0);
  return {
    totalBaris: baris.length,
    valid: baris.filter((b) => b.status === 'OK').length,
    gagal: baris.filter((b) => b.status === 'GAGAL').length,
    totalDebit,
    totalKredit,
    seimbang: totalDebit === totalKredit && totalDebit > 0,
    totalGrup: grup.length,
    grupValid: grup.filter((g) => g.status === 'OK').length,
    grupGagal: grup.filter((g) => g.status === 'GAGAL').length,
  };
}

// ---------------------------------------------------------------------------
// Bentuk multi-baris
// ---------------------------------------------------------------------------

function validasiAkun(
  kode: string,
  akunValid: Map<string, AkunImpor & { aktif: boolean }>,
): string | null {
  if (!kode) return 'Akun wajib diisi (kode akun, mis. 1001).';
  const akun = akunValid.get(kode);
  if (!akun) return `Akun ${kode} tidak ada di daftar akun (COA).`;
  if (akun.aktif === false) return `Akun ${kode} sudah tidak aktif.`;
  if (!akunBolehDiposting(kode, akun.aktif, { dikenal: true }))
    return `Akun ${kode} ${PESAN_AKUN_LEGACY}`;
  return null;
}

type GrupKerja = {
  kunci: string;
  grup: string;
  tanggal: string;
  tanggalMentah: string;
  keterangan: string;
  no_bukti: string;
  baris: {
    b: BarisMentah;
    akun: string;
    debit: number;
    kredit: number;
    catatan: string;
    errors: string[];
  }[];
  errors: string[];
};

function parseBentukMultiBaris(
  mentah: BarisMentah[],
  akunValid: Map<string, AkunImpor & { aktif: boolean }>,
): { grup: HasilGrupImpor[]; baris: HasilBarisImpor[]; errors: string[] } {
  const grupKerja: GrupKerja[] = [];
  const petaGrup = new Map<string, GrupKerja>();

  for (const b of mentah) {
    // `grup` wajib; baris tanpa grup dibuat grup tunggal agar errornya jelas.
    // Semua baris dengan label grup sama digabung, meskipun tidak berurutan.
    const kunci = b.grup || `__TANPA_GRUP_${b.barisExcel}`;
    let aktif = petaGrup.get(kunci);
    if (!aktif) {
      aktif = {
        kunci,
        grup: b.grup,
        tanggal: '',
        tanggalMentah: '',
        keterangan: '',
        no_bukti: '',
        baris: [],
        errors: [],
      };
      petaGrup.set(kunci, aktif);
      grupKerja.push(aktif);
      if (!b.grup) aktif.errors.push('Kolom "grup" wajib diisi untuk format multi-baris.');
    }

    const tanggal = parseTanggalImpor(b.tanggal);
    if (tanggal.iso) {
      if (aktif.tanggal && aktif.tanggal !== tanggal.iso) {
        if (!aktif.errors.includes('Tanggal dalam satu grup harus sama.'))
          aktif.errors.push('Tanggal dalam satu grup harus sama.');
      } else {
        aktif.tanggal = tanggal.iso;
      }
    } else if (tanggal.mentah) {
      if (!aktif.tanggalMentah) aktif.tanggalMentah = tanggal.mentah;
    }

    if (b.keterangan) {
      if (aktif.keterangan && aktif.keterangan !== b.keterangan) {
        if (!aktif.errors.includes('Keterangan dalam satu grup harus sama.'))
          aktif.errors.push('Keterangan dalam satu grup harus sama.');
      } else {
        aktif.keterangan = b.keterangan;
      }
    }

    if (b.no_bukti) {
      if (aktif.no_bukti && aktif.no_bukti.toLowerCase() !== b.no_bukti.toLowerCase()) {
        if (!aktif.errors.includes('Nomor bukti dalam satu grup harus sama.'))
          aktif.errors.push('Nomor bukti dalam satu grup harus sama.');
      } else {
        aktif.no_bukti = b.no_bukti;
      }
    }

    const errors: string[] = [];
    if (tanggal.error) errors.push(tanggal.error);
    const akunErr = validasiAkun(b.akun, akunValid);
    if (akunErr) errors.push(akunErr);

    const debit = parseNominalImpor(b.debit);
    const kredit = parseNominalImpor(b.kredit);
    if (debit.error) errors.push(`Debit: ${debit.error}`);
    if (kredit.error) errors.push(`Kredit: ${kredit.error}`);
    if (!debit.error && !kredit.error) {
      if (debit.sen > 0 && kredit.sen > 0)
        errors.push('Isi salah satu saja — debit ATAU kredit, tidak keduanya.');
      else if (debit.sen === 0 && kredit.sen === 0)
        errors.push('Nominal debit/kredit wajib lebih dari 0.');
    }

    aktif.baris.push({
      b,
      akun: b.akun,
      debit: debit.sen,
      kredit: kredit.sen,
      catatan: b.catatan,
      errors,
    });
  }

  // Validasi tingkat grup + duplikat nomor bukti antar grup.
  const hitungNoBukti = new Map<string, number>();
  for (const g of grupKerja) {
    const no = g.no_bukti.trim().toLowerCase();
    if (no) hitungNoBukti.set(no, (hitungNoBukti.get(no) ?? 0) + 1);
  }

  const grup: HasilGrupImpor[] = [];
  const baris: HasilBarisImpor[] = [];
  let nomor = 0;

  for (const g of grupKerja) {
    const errors = [...g.errors];
    if (!g.tanggal) {
      const pesan = g.tanggalMentah
        ? `Tanggal "${g.tanggalMentah}" tidak valid.`
        : 'Tanggal wajib diisi pada baris pertama grup.';
      if (!errors.includes(pesan)) errors.push(pesan);
    }
    if (!g.keterangan) {
      if (!errors.includes('Keterangan wajib diisi pada baris pertama grup.'))
        errors.push('Keterangan wajib diisi pada baris pertama grup.');
    }

    const totalDebit = g.baris.reduce((s, r) => s + (Number.isFinite(r.debit) ? r.debit : 0), 0);
    const totalKredit = g.baris.reduce((s, r) => s + (Number.isFinite(r.kredit) ? r.kredit : 0), 0);
    const adaErrorNominal = g.baris.some((r) =>
      r.errors.some(
        (e) =>
          e.toLowerCase().includes('debit') ||
          e.toLowerCase().includes('kredit') ||
          e.toLowerCase().includes('nominal'),
      ),
    );
    if (g.baris.length < 2) {
      errors.push('Satu grup jurnal minimal terdiri dari 2 baris (debit dan kredit).');
    }
    if (!adaErrorNominal && g.baris.length >= 2) {
      if (totalDebit !== totalKredit) {
        errors.push(
          `Grup tidak seimbang: total debit ${formatRp(totalDebit)} ≠ total kredit ${formatRp(
            totalKredit,
          )}.`,
        );
      } else if (totalDebit <= 0) {
        errors.push('Total jurnal harus lebih dari 0.');
      }
    }
    if (g.no_bukti && (hitungNoBukti.get(g.no_bukti.trim().toLowerCase()) ?? 0) > 1) {
      errors.push(`Nomor bukti ${g.no_bukti} dipakai lebih dari satu grup.`);
    }

    const status: StatusImpor =
      errors.length === 0 && g.baris.every((r) => r.errors.length === 0) ? 'OK' : 'GAGAL';
    const alasanGrup = [
      ...new Set([...errors, ...g.baris.flatMap((r) => r.errors)]),
    ].join(' ');
    for (const r of g.baris) {
      nomor++;
      const semuaError = [...r.errors, ...errors];
      const statusBaris: StatusImpor = semuaError.length === 0 ? 'OK' : 'GAGAL';
      baris.push({
        nomorBaris: nomor,
        barisExcel: r.b.barisExcel,
        grup: g.grup,
        tanggal: g.tanggal || parseTanggalImpor(r.b.tanggal).mentah,
        keterangan: g.keterangan,
        akun: r.akun,
        debit: r.debit,
        kredit: r.kredit,
        catatan: r.catatan,
        status: statusBaris,
        alasan: [...new Set(semuaError)].join(' '),
      });
    }

    grup.push({
      grup: g.grup,
      tanggal: g.tanggal,
      keterangan: g.keterangan,
      no_bukti: g.no_bukti,
      status,
      alasan: alasanGrup,
      barisExcel: g.baris.map((r) => r.b.barisExcel),
      totalDebit,
      totalKredit,
      seimbang: totalDebit === totalKredit && totalDebit > 0,
      ...(status === 'OK'
        ? {
            input: {
              header: {
                id: '',
                tanggal: g.tanggal,
                keterangan: g.keterangan,
                ...(g.no_bukti ? { no_bukti: g.no_bukti } : {}),
                jenis: 'UMUM' as const,
              },
              baris: g.baris.map((r) => ({
                akun_kode: r.akun,
                debit: r.debit,
                kredit: r.kredit,
                keterangan: r.catatan,
              })),
            },
          }
        : {}),
    });
  }

  return { grup, baris, errors: [] };
}

// ---------------------------------------------------------------------------
// Bentuk sederhana per baris
// ---------------------------------------------------------------------------

function parseBentukSederhana(
  mentah: BarisMentah[],
  akunValid: Map<string, AkunImpor & { aktif: boolean }>,
): { grup: HasilGrupImpor[]; baris: HasilBarisImpor[]; errors: string[] } {
  const grup: HasilGrupImpor[] = [];
  const baris: HasilBarisImpor[] = [];
  let nomor = 0;

  // Nomor bukti unik antar baris.
  const hitungNoBukti = new Map<string, number>();
  for (const b of mentah) {
    const no = b.no_bukti.trim().toLowerCase();
    if (no) hitungNoBukti.set(no, (hitungNoBukti.get(no) ?? 0) + 1);
  }

  for (const b of mentah) {
    const label = b.grup || b.no_bukti || `BARIS-${b.barisExcel}`;
    const errors: string[] = [];
    const tanggal = parseTanggalImpor(b.tanggal);
    if (tanggal.error) errors.push(tanggal.error);
    else if (!tanggal.iso) errors.push('Tanggal wajib diisi.');
    if (!b.keterangan) errors.push('Keterangan wajib diisi.');

    const akunDebit = String(b.akun_debit ?? '').trim();
    const akunKredit = String(b.akun_kredit ?? '').trim();
    const errDebit = validasiAkun(akunDebit, akunValid);
    const errKredit = validasiAkun(akunKredit, akunValid);
    if (errDebit) errors.push(`Akun debit: ${errDebit}`);
    if (errKredit) errors.push(`Akun kredit: ${errKredit}`);
    if (akunDebit && akunDebit === akunKredit)
      errors.push('Akun debit dan kredit tidak boleh sama.');

    const nominal = parseNominalImpor(b.nominal);
    if (nominal.error) errors.push(`Nominal: ${nominal.error}`);
    else if (nominal.sen <= 0) errors.push('Nominal wajib lebih dari 0.');
    if (b.no_bukti && (hitungNoBukti.get(b.no_bukti.trim().toLowerCase()) ?? 0) > 1)
      errors.push(`Nomor bukti ${b.no_bukti} dipakai lebih dari satu baris.`);

    const status: StatusImpor = errors.length === 0 ? 'OK' : 'GAGAL';
    const alasan = errors.join(' ');
    const total = status === 'OK' ? nominal.sen : 0;
    const grupNama = label;

    nomor++;
    baris.push({
      nomorBaris: nomor,
      barisExcel: b.barisExcel,
      grup: grupNama,
      tanggal: tanggal.iso || tanggal.mentah,
      keterangan: b.keterangan,
      akun: akunDebit,
      debit: total,
      kredit: 0,
      catatan: b.catatan,
      status,
      alasan,
      sisi: 'DEBIT',
    });
    nomor++;
    baris.push({
      nomorBaris: nomor,
      barisExcel: b.barisExcel,
      grup: grupNama,
      tanggal: tanggal.iso || tanggal.mentah,
      keterangan: b.keterangan,
      akun: akunKredit,
      debit: 0,
      kredit: total,
      catatan: '',
      status,
      alasan,
      sisi: 'KREDIT',
    });

    grup.push({
      grup: grupNama,
      tanggal: tanggal.iso,
      keterangan: b.keterangan,
      no_bukti: b.no_bukti,
      status,
      alasan,
      barisExcel: [b.barisExcel],
      totalDebit: total,
      totalKredit: total,
      seimbang: status === 'OK' && total > 0,
      ...(status === 'OK'
        ? {
            input: {
              header: {
                id: '',
                tanggal: tanggal.iso,
                keterangan: b.keterangan,
                ...(b.no_bukti ? { no_bukti: b.no_bukti } : {}),
                jenis: 'UMUM' as const,
              },
              baris: [
                { akun_kode: akunDebit, debit: total, kredit: 0, keterangan: b.catatan },
                { akun_kode: akunKredit, debit: 0, kredit: total, keterangan: '' },
              ],
            },
          }
        : {}),
    });
  }

  return { grup, baris, errors: [] };
}
