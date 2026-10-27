// Template impor jurnal Excel (P2-9) — builder murni, renderer-safe.
//
// Tidak ada `node:fs` di sini. Renderer membangun buffer lalu meminta main
// menyimpannya lewat IPC `import:template` (save dialog) atau test membacanya
// langsung di memori.
//
// Kolom sheet "Jurnal":
//   grup | tanggal | no_bukti | keterangan | akun | debit | kredit | catatan
//
// - `grup` mengelompokkan beberapa baris menjadi SATU jurnal.
// - `tanggal` ditulis sebagai TEKS YYYY-MM-DD agar tidak berubah menjadi serial
//   tanggal Excel.
// - `debit`/`kredit` adalah ANGKA RUPIAH (bukan sen); parser mengubahnya ke sen.
// - `akun` berisi kode akun COA, mis. 1001.
// - `no_bukti` opsional; kosong = sistem membuat `JU-<tahun>-<urut>`.

import ExcelJS from 'exceljs';
import { COA, type Coa } from '../../db/coa.js';
import { NUMFMT_RP } from '../export/workbooks.js';

export const NAMA_FILE_TEMPLATE_IMPOR = 'template-impor-jurnal.xlsx';
export const SHEET_JURNAL_IMPOR = 'Jurnal';
export const SHEET_AKUN_IMPOR = 'Akun';
export const SHEET_PETUNJUK_IMPOR = 'Petunjuk';

export const KOLOM_TEMPLATE_IMPOR = [
  'grup',
  'tanggal',
  'no_bukti',
  'keterangan',
  'akun',
  'debit',
  'kredit',
  'catatan',
] as const;

type ContohBaris = {
  grup: string;
  tanggal: string;
  no_bukti: string;
  keterangan: string;
  akun: string;
  debit: number;
  kredit: number;
  catatan: string;
};

/**
 * Contoh 3 grup: dua grup 2 baris dan satu grup 3 baris. Semua seimbang dan
 * memakai akun yang benar-benar ada di COA, sehingga bisa langsung diimpor
 * sebagai uji coba.
 */
const CONTOH: ContohBaris[] = [
  {
    grup: 'CONTOH-1',
    tanggal: '2026-01-05',
    no_bukti: '',
    keterangan: 'Penerimaan parkir bulan Januari',
    akun: '1001',
    debit: 150_000,
    kredit: 0,
    catatan: 'Uang masuk ke kas bendahara',
  },
  {
    grup: 'CONTOH-1',
    tanggal: '',
    no_bukti: '',
    keterangan: '',
    akun: '4005',
    debit: 0,
    kredit: 150_000,
    catatan: 'Pendapatan parkir',
  },
  {
    grup: 'CONTOH-2',
    tanggal: '2026-01-10',
    no_bukti: '',
    keterangan: 'Bayar listrik dan administrasi bank',
    akun: '5010',
    debit: 200_000,
    kredit: 0,
    catatan: 'Listrik pura',
  },
  {
    grup: 'CONTOH-2',
    tanggal: '',
    no_bukti: '',
    keterangan: '',
    akun: '5040',
    debit: 5_000,
    kredit: 0,
    catatan: 'Biaya administrasi bank',
  },
  {
    grup: 'CONTOH-2',
    tanggal: '',
    no_bukti: '',
    keterangan: '',
    akun: '1001',
    debit: 0,
    kredit: 205_000,
    catatan: 'Dibayar dari kas',
  },
  {
    grup: 'CONTOH-3',
    tanggal: '15/01/2026',
    no_bukti: 'JU-2026-0099',
    keterangan: 'Terima punia pembangunan',
    akun: '1029',
    debit: 1_000_000,
    kredit: 0,
    catatan: 'Masuk rekening BPD',
  },
  {
    grup: 'CONTOH-3',
    tanggal: '',
    no_bukti: '',
    keterangan: '',
    akun: '4008',
    debit: 0,
    kredit: 1_000_000,
    catatan: 'Pendapatan punia',
  },
];

function tulisHeader(ws: ExcelJS.Worksheet, judul: string[], lebar: number[]): void {
  const row = ws.addRow(judul);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF065F46' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 24;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  judul.forEach((_, i) => {
    ws.getColumn(i + 1).width = lebar[i] ?? 16;
  });
}

/** Workbook template impor (sheet Jurnal + Petunjuk + Akun). */
export function buatTemplateImpor(daftarAkun: readonly Coa[] = COA): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pura Dalem Puri';
  wb.created = new Date();
  wb.description =
    'Template impor jurnal massal. Satu grup = satu jurnal; total debit harus sama dengan total kredit.';

  // ---- Sheet Jurnal ----
  const jurnal = wb.addWorksheet(SHEET_JURNAL_IMPOR);
  tulisHeader(jurnal, [...KOLOM_TEMPLATE_IMPOR], [14, 14, 16, 38, 10, 14, 14, 38]);
  for (const contoh of CONTOH) {
    const row = jurnal.addRow([
      contoh.grup,
      contoh.tanggal,
      contoh.no_bukti,
      contoh.keterangan,
      contoh.akun,
      contoh.debit,
      contoh.kredit,
      contoh.catatan,
    ]);
    // Tanggal tetap teks, bukan sel tanggal Excel.
    row.getCell(2).numFmt = '@';
    row.getCell(5).numFmt = '@';
    row.getCell(6).numFmt = NUMFMT_RP;
    row.getCell(7).numFmt = NUMFMT_RP;
    row.alignment = { vertical: 'top', wrapText: true };
  }
  jurnal.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: KOLOM_TEMPLATE_IMPOR.length },
  };

  // ---- Sheet Petunjuk ----
  const petunjuk = wb.addWorksheet(SHEET_PETUNJUK_IMPOR);
  petunjuk.getColumn(1).width = 4;
  petunjuk.getColumn(2).width = 100;
  const judul = petunjuk.addRow(['', 'PETUNJUK IMPORT JURNAL DARI EXCEL']);
  judul.font = { bold: true, size: 14 };
  const langkah: string[] = [
    '1. Isi sheet "Jurnal". Satu grup (kolom grup) = satu jurnal. Beberapa baris dengan grup yang sama akan digabung.',
    '2. Kolom tanggal: tulis YYYY-MM-DD (contoh 2026-01-31) atau DD/MM/YYYY (contoh 31/01/2026). Tanggal 31 Feb akan ditolak.',
    '3. Tanggal, keterangan, dan no_bukti boleh hanya diisi di baris pertama grup; baris berikutnya boleh kosong (otomatis mengikuti).',
    '4. Kolom akun: isi KODE AKUN (bukan nama), mis. 1001. Lihat daftar di sheet "Akun".',
    '5. Kolom debit dan kredit: isi ANGKA RUPIAH pada SALAH SATU kolom saja. Jangan menulis "Rp" atau titik ribuan.',
    '6. Setiap grup minimal 2 baris dan total debit harus sama dengan total kredit. Grup yang tidak seimbang ditolak seluruhnya.',
    '7. Kolom no_bukti opsional. Bila kosong, sistem membuat nomor otomatis JU-<tahun>-<urut>. Bila diisi, nomor harus unik.',
    '8. Kolom catatan opsional: keterangan singkat untuk baris jurnal tersebut.',
    '9. Setelah diisi, simpan file .xlsx, lalu buka aplikasi → menu "Import Excel" → "Pilih & Pratinjau".',
    '10. Periksa hasil pratinjau per baris. Hanya grup yang valid yang bisa diimpor. Jurnal tersimpan tidak bisa diedit; koreksi lewat jurnal balik.',
    '',
    'Contoh di sheet "Jurnal" sudah seimbang dan boleh dipakai sebagai latihan. Hapus atau ganti sebelum mengimpor data sungguhan.',
    'Batas aman: ukuran file maksimal 10 MB dan maksimal 5.000 baris data.',
  ];
  for (const teks of langkah) {
    const row = petunjuk.addRow(['', teks]);
    row.alignment = { vertical: 'top', wrapText: true };
  }
  const format = petunjuk.addRow([
    '',
    'Bentuk sederhana (opsional): tanggal | keterangan | akun_debit | akun_kredit | nominal | no_bukti | catatan — satu baris = satu jurnal 2 baris.',
  ]);
  format.font = { italic: true };

  // ---- Sheet Akun ----
  const akun = wb.addWorksheet(SHEET_AKUN_IMPOR);
  tulisHeader(akun, ['kode', 'nama', 'tipe'], [12, 46, 16]);
  for (const a of daftarAkun) {
    const row = akun.addRow([a.kode, a.nama, a.tipe]);
    row.getCell(1).numFmt = '@';
  }
  akun.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 3 } };

  return wb;
}

/** Buffer template siap tulis; renderer-safe (Uint8Array, tanpa Node Buffer). */
export async function buatBufferTemplateImpor(
  daftarAkun: readonly Coa[] = COA,
): Promise<Uint8Array> {
  const wb = buatTemplateImpor(daftarAkun);
  const out = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
  return out instanceof Uint8Array ? new Uint8Array(out) : new Uint8Array(out);
}
