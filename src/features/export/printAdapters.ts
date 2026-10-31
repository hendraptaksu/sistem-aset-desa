// Adapter cetak P1-16: hasil laporan core/reports.ts → PrintDoc.
// TIDAK menghitung ulang laporan. Semua total diambil dari hasil laporan;
// format Rupiah hanya untuk teks yang tampil, sedangkan `nilai` menyimpan
// angka SEN asli agar bisa diperiksa test/UI.

import type { Coa, PosisiNormal } from '../../db/coa.js';
import type {
  ArusKasHasil,
  BukuBesarHasil,
  LabaRugiHasil,
  NeracaHasil,
  NeracaSaldoModeHasil,
} from '../../core/reports.js';
import { formatPersen, formatRp, formatTanggal } from '../../utils/format.js';
import type { KopOrganisasi } from '../../core/pengaturan.js';
import {
  kopPeriodeCutoff,
  kopPeriodeEfektif,
  kopPeriodeNeracaSaldo,
  type JurnalTampil,
  type PanjarTampil,
} from './workbooks.js';
import type { PrintDoc, PrintRow, PrintTable } from './printDoc.js';

const LABEL_JENIS: Record<string, string> = {
  UMUM: 'Jurnal Umum',
  TERIMA: 'Terima Uang',
  BAYAR: 'Bayar / Beban',
  TRANSFER: 'Pindah Dana',
  PANJAR: 'Panjar',
  PIUTANG: 'Piutang',
  HUTANG: 'Hutang',
  SALDO_AWAL: 'Saldo Awal',
  REVERSAL: 'Jurnal Balik',
};

const LABEL_TIPE_COA: Record<Coa['tipe'], string> = {
  AKTIVA: 'Aktiva',
  KEWAJIBAN: 'Kewajiban',
  EKUITAS: 'Ekuitas',
  PENDAPATAN: 'Pendapatan',
  BEBAN: 'Beban',
};

const LABEL_KELOMPOK_ARUS_KAS: Record<ArusKasHasil['rows'][number]['kelompok'], string> = {
  OPERASI: 'Operasi',
  INVESTASI: 'Investasi',
  PENDANAAN: 'Pendanaan',
  TRANSFER: 'Transfer',
};

function namaAkun(coa: readonly Coa[], kode: string): string {
  const a = coa.find((x) => x.kode === kode);
  return a ? `${a.kode} — ${a.nama}` : kode;
}

function labelJenis(jenis?: string): string {
  return jenis ? (LABEL_JENIS[jenis] ?? jenis) : '';
}

function statusKoreksi(j: JurnalTampil): string {
  if (j.reversal_of) return 'Jurnal balik';
  if (j.reversal_id) return 'Sudah dikoreksi';
  return 'Aktif';
}

function labelSisi(saldo: number, posisiNormal: PosisiNormal): string {
  if (saldo === 0) return 'Nol';
  if (saldo > 0) return posisiNormal === 'DEBIT' ? 'Debit' : 'Kredit';
  return posisiNormal === 'DEBIT' ? 'Kredit' : 'Debit';
}

function fraksi(nominal: number, dasar: number): number {
  return dasar === 0 ? 0 : nominal / dasar;
}

function baris(
  sel: readonly string[],
  nilai?: readonly (number | null)[],
  jenis?: PrintRow['jenis'],
  tebal = false,
): PrintRow {
  return {
    sel,
    ...(nilai ? { nilai } : {}),
    ...(jenis ? { jenis } : {}),
    ...(tebal ? { tebal } : {}),
  };
}

/** Field kop dokumen dari pengaturan pembukuan (P1-13); kosong = default. */
function opsiKop(kop?: KopOrganisasi): Pick<PrintDoc, 'kop' | 'kopTambahan'> {
  if (!kop) return {};
  const nama = String(kop.nama ?? '').trim();
  const tambahan = String(kop.tambahan ?? '').trim();
  return {
    ...(nama ? { kop: nama } : {}),
    ...(tambahan ? { kopTambahan: tambahan } : {}),
  };
}

/** Jurnal Umum (satu/banyak jurnal) + subtotal per jurnal + total keseluruhan. */
export function jurnalPrintDoc(
  jurnal: JurnalTampil | readonly JurnalTampil[],
  coa: readonly Coa[] = [],
  opts: { mulai?: string; sampai?: string; tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  const daftar: readonly JurnalTampil[] = Array.isArray(jurnal)
    ? jurnal
    : [jurnal as JurnalTampil];
  const rows: PrintRow[] = [];
  let grandDebit = 0;
  let grandKredit = 0;

  for (const j of daftar) {
    const noBukti = j.no_bukti?.trim() || j.id || 'tanpa nomor';
    let subDebit = 0;
    let subKredit = 0;
    for (const b of j.baris) {
      subDebit += b.debit;
      subKredit += b.kredit;
      rows.push(
        baris(
          [
            formatTanggal(j.tanggal),
            noBukti,
            namaAkun(coa, b.akun_kode),
            b.keterangan?.trim() || j.keterangan,
            b.debit ? formatRp(b.debit) : '',
            b.kredit ? formatRp(b.kredit) : '',
            labelJenis(j.jenis),
            statusKoreksi(j),
          ],
          [null, null, null, null, b.debit, b.kredit, null, null],
        ),
      );
    }
    rows.push(
      baris(
        ['', '', '', `Subtotal ${noBukti}`, formatRp(subDebit), formatRp(subKredit), '', ''],
        [null, null, null, null, subDebit, subKredit, null, null],
        'subtotal',
        true,
      ),
    );
    grandDebit += subDebit;
    grandKredit += subKredit;
  }

  const tabel: PrintTable = {
    judul: 'JURNAL UMUM',
    kolom: [
      { label: 'Tanggal', width: 9 },
      { label: 'No. Bukti', width: 11 },
      { label: 'Akun', width: 20, align: 'left' },
      { label: 'Keterangan', width: 22, align: 'left' },
      { label: 'Debit', width: 11, align: 'right' },
      { label: 'Kredit', width: 11, align: 'right' },
      { label: 'Jenis', width: 8, align: 'center' },
      { label: 'Status', width: 8, align: 'center' },
    ],
    baris: rows,
    footer: [
      baris(
        [
          '',
          '',
          '',
          'TOTAL KESELURUHAN',
          formatRp(grandDebit),
          formatRp(grandKredit),
          '',
          '',
        ],
        [null, null, null, null, grandDebit, grandKredit, null, null],
        'total',
        true,
      ),
    ],
  };

  return {
    judul: 'JURNAL UMUM',
    subjudul: kopPeriodeEfektif(opts.mulai, opts.sampai, daftar),
    ...(opts.tanggalCetak ? { tanggalCetak: opts.tanggalCetak } : {}),
    ...opsiKop(opts.kop),
    orientasi: 'portrait',
    blok:
      daftar.length === 0
        ? [
            { jenis: 'paragraf', teks: 'Belum ada jurnal pada periode ini.' },
            { jenis: 'tabel', tabel },
          ]
        : [{ jenis: 'tabel', tabel }],
  };
}

/** Buku Besar satu akun — LANDSCAPE, saldo awal/mutasi/saldo akhir. */
export function bukuBesarPrintDoc(
  bb: BukuBesarHasil,
  opts: { tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  const rows: PrintRow[] = [
    baris(
      [
        'Saldo awal',
        '',
        bb.mulai ? `sebelum ${formatTanggal(bb.mulai)}` : 'tanpa batas awal',
        formatRp(0),
        formatRp(0),
        formatRp(bb.saldoAwal),
        labelSisi(bb.saldoAwal, bb.posisi_normal),
      ],
      [null, null, null, 0, 0, bb.saldoAwal, null],
      'data',
      true,
    ),
  ];
  for (const r of bb.rows) {
    rows.push(
      baris(
        [
          formatTanggal(r.tanggal),
          r.no_bukti || '—',
          r.keterangan || '—',
          formatRp(r.debit),
          formatRp(r.kredit),
          formatRp(r.saldo),
          labelSisi(r.saldo, bb.posisi_normal),
        ],
        [null, null, null, r.debit, r.kredit, r.saldo, null],
      ),
    );
  }

  const tabel: PrintTable = {
    judul: `BUKU BESAR — ${bb.kode} ${bb.nama}`,
    kolom: [
      { label: 'Tanggal', width: 10 },
      { label: 'No. Bukti', width: 12 },
      { label: 'Keterangan', width: 34 },
      { label: 'Debit', width: 11, align: 'right' },
      { label: 'Kredit', width: 11, align: 'right' },
      { label: 'Saldo', width: 12, align: 'right' },
      { label: 'Sisi', width: 10, align: 'center' },
    ],
    baris: rows,
    footer: [
      baris(
        [
          'TOTAL MUTASI',
          '',
          '',
          formatRp(bb.totalDebit),
          formatRp(bb.totalKredit),
          formatRp(bb.saldoAkhir),
          labelSisi(bb.saldoAkhir, bb.posisi_normal),
        ],
        [null, null, null, bb.totalDebit, bb.totalKredit, bb.saldoAkhir, null],
        'total',
        true,
      ),
      baris(
        ['SALDO AKHIR', '', '', formatRp(0), formatRp(0), formatRp(bb.saldoAkhir), labelSisi(bb.saldoAkhir, bb.posisi_normal)],
        [null, null, null, 0, 0, bb.saldoAkhir, null],
        'total',
        true,
      ),
    ],
  };

  return {
    judul: `BUKU BESAR — ${bb.kode} ${bb.nama}`,
    subjudul: kopPeriodeEfektif(bb.mulai, bb.sampai, bb.rows),
    ...(opts.tanggalCetak ? { tanggalCetak: opts.tanggalCetak } : {}),
    ...opsiKop(opts.kop),
    orientasi: 'landscape',
    blok: [
      {
        jenis: 'keyValue',
        baris: [
          { label: 'Akun', nilai: `${bb.kode} — ${bb.nama}` },
          { label: 'Saldo awal', nilai: formatRp(bb.saldoAwal), nilaiAngka: bb.saldoAwal },
          { label: 'Total debit', nilai: formatRp(bb.totalDebit), nilaiAngka: bb.totalDebit },
          { label: 'Total kredit', nilai: formatRp(bb.totalKredit), nilaiAngka: bb.totalKredit },
          { label: 'Saldo akhir', nilai: formatRp(bb.saldoAkhir), nilaiAngka: bb.saldoAkhir },
        ],
      },
      { jenis: 'tabel', tabel },
    ],
  };
}

/** Neraca Saldo — semua akun + total + status seimbang/selisih. */
export function neracaSaldoPrintDoc(
  ns: NeracaSaldoModeHasil,
  opts: { tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  const rows = ns.rows.map((r) => {
    const sintetis = 'sintetis' in r && r.sintetis;
    return baris(
      [r.kode, r.nama, LABEL_TIPE_COA[r.tipe], formatRp(r.debit), formatRp(r.kredit), formatRp(r.saldo)],
      [null, null, null, r.debit, r.kredit, r.saldo],
      undefined,
      sintetis,
    );
  });
  const tabel: PrintTable = {
    judul: 'NERACA SALDO',
    kolom: [
      { label: 'Kode', width: 10 },
      { label: 'Nama Akun', width: 36 },
      { label: 'Tipe', width: 14, align: 'center' },
      { label: 'Debit', width: 13, align: 'right' },
      { label: 'Kredit', width: 13, align: 'right' },
      { label: 'Saldo', width: 14, align: 'right' },
    ],
    baris: rows,
    footer: [
      baris(
        ['TOTAL', '', '', formatRp(ns.totalDebit), formatRp(ns.totalKredit), formatRp(0)],
        [null, null, null, ns.totalDebit, ns.totalKredit, 0],
        'total',
        true,
      ),
      baris(
        ['STATUS', ns.seimbang ? 'Seimbang' : 'Selisih', '', formatRp(0), formatRp(0), formatRp(ns.selisih)],
        [null, null, null, 0, 0, ns.selisih],
        'total',
        true,
      ),
    ],
  };
  return {
    judul: 'NERACA SALDO',
    subjudul: kopPeriodeNeracaSaldo(ns),
    ...(opts.tanggalCetak ? { tanggalCetak: opts.tanggalCetak } : {}),
    ...opsiKop(opts.kop),
    orientasi: 'portrait',
    blok: [{ jenis: 'tabel', tabel }],
  };
}

/** Laba Rugi — pendapatan, beban, total, laba/defisit + persen. */
export function labaRugiPrintDoc(
  lr: LabaRugiHasil,
  opts: { tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  const pendapatan = lr.pendapatan.filter((b) => b.nominal !== 0);
  const beban = lr.beban.filter((b) => b.nominal !== 0);
  const rows: PrintRow[] = [];

  rows.push(baris(['', 'PENDAPATAN', '', ''], undefined, 'seksi', true));
  for (const b of pendapatan) {
    const persen = fraksi(b.nominal, lr.totalPendapatan) * 100;
    rows.push(
      baris([b.kode, b.nama, formatRp(b.nominal), formatPersen(persen)], [null, null, b.nominal, persen]),
    );
  }
  const persenTotalPendapatan = lr.totalPendapatan === 0 ? 0 : 100;
  rows.push(
    baris(
      ['', 'Total Pendapatan', formatRp(lr.totalPendapatan), formatPersen(persenTotalPendapatan)],
      [null, null, lr.totalPendapatan, persenTotalPendapatan],
      'subtotal',
      true,
    ),
  );

  rows.push(baris(['', 'BEBAN', '', ''], undefined, 'seksi', true));
  for (const b of beban) {
    const persen = fraksi(b.nominal, lr.totalPendapatan) * 100;
    rows.push(
      baris([b.kode, b.nama, formatRp(b.nominal), formatPersen(persen)], [null, null, b.nominal, persen]),
    );
  }
  const persenTotalBeban = fraksi(lr.totalBeban, lr.totalPendapatan) * 100;
  rows.push(
    baris(
      ['', 'Total Beban', formatRp(lr.totalBeban), formatPersen(persenTotalBeban)],
      [null, null, lr.totalBeban, persenTotalBeban],
      'subtotal',
      true,
    ),
  );

  const persenLaba = fraksi(lr.laba, lr.totalPendapatan) * 100;
  const tabel: PrintTable = {
    judul: 'LABA RUGI',
    kolom: [
      { label: 'Kode', width: 12 },
      { label: 'Uraian', width: 56 },
      { label: 'Nominal', width: 20, align: 'right' },
      { label: '%', width: 12, align: 'right' },
    ],
    baris: rows,
    footer: [
      baris(
        ['', 'LABA / (DEFISIT)', formatRp(lr.laba), formatPersen(persenLaba)],
        [null, null, lr.laba, persenLaba],
        'total',
        true,
      ),
    ],
  };

  return {
    judul: 'LABA RUGI',
    subjudul: kopPeriodeEfektif(lr.mulai, lr.sampai),
    ...(opts.tanggalCetak ? { tanggalCetak: opts.tanggalCetak } : {}),
    ...opsiKop(opts.kop),
    orientasi: 'portrait',
    blok: [{ jenis: 'tabel', tabel }],
  };
}

/** Neraca — aset, kewajiban, ekuitas + laba turunan + total aset/pasiva. */
export function neracaPrintDoc(
  n: NeracaHasil,
  opts: { tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  const rows: PrintRow[] = [];
  const bagian = (judul: string, daftar: { kode: string; nama: string; saldo: number }[]): void => {
    rows.push(baris(['', judul, ''], undefined, 'seksi', true));
    for (const a of daftar.filter((x) => x.saldo !== 0)) {
      rows.push(baris([a.kode, a.nama, formatRp(a.saldo)], [null, null, a.saldo]));
    }
  };

  bagian('ASET', n.aset);
  rows.push(
    baris(['', 'Total Aset', formatRp(n.totalAset)], [null, null, n.totalAset], 'subtotal', true),
  );
  bagian('KEWAJIBAN', n.kewajiban);
  rows.push(
    baris(
      ['', 'Total Kewajiban', formatRp(n.totalKewajiban)],
      [null, null, n.totalKewajiban],
      'subtotal',
      true,
    ),
  );
  bagian('EKUITAS', n.ekuitas);
  rows.push(
    baris(['—', 'Laba ditahan (tahun sudah tutup)', formatRp(n.labaDitahan)], [null, null, n.labaDitahan]),
    baris(
      ['—', 'Laba tahun lampau belum ditutup', formatRp(n.labaBelumDitutup)],
      [null, null, n.labaBelumDitutup],
    ),
    baris(
      ['—', 'Laba berjalan (1 Januari s/d tanggal laporan)', formatRp(n.labaBerjalan)],
      [null, null, n.labaBerjalan],
    ),
    baris(
      ['', 'Total Ekuitas', formatRp(n.totalEkuitas)],
      [null, null, n.totalEkuitas],
      'subtotal',
      true,
    ),
  );

  const statusText = n.balance ? 'SEIMBANG' : 'SELISIH';
  const tabel: PrintTable = {
    judul: 'NERACA',
    kolom: [
      { label: 'Kode', width: 10 },
      { label: 'Uraian', width: 66 },
      { label: 'Nominal', width: 24, align: 'right' },
    ],
    baris: rows,
    footer: [
      baris(['', 'TOTAL PASIVA', formatRp(n.totalPasiva)], [null, null, n.totalPasiva], 'total', true),
      baris(['STATUS', statusText, formatRp(n.selisih)], [null, null, n.selisih], 'total', true),
    ],
  };

  return {
    judul: 'NERACA',
    subjudul: `${kopPeriodeCutoff(n.cutoff)} — ${statusText}`,
    ...(opts.tanggalCetak ? { tanggalCetak: opts.tanggalCetak } : {}),
    ...opsiKop(opts.kop),
    orientasi: 'portrait',
    blok: [{ jenis: 'tabel', tabel }],
  };
}

/** Arus Kas — ringkasan kelompok + tabel mutasi kas + total. */
export function arusKasPrintDoc(
  ak: ArusKasHasil,
  opts: { tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  const ringkasanRows: PrintRow[] = [
    baris(
      ['Operasi', formatRp(ak.operasi.masuk), formatRp(ak.operasi.keluar), formatRp(ak.operasi.neto)],
      [null, ak.operasi.masuk, ak.operasi.keluar, ak.operasi.neto],
    ),
    baris(
      ['Investasi', formatRp(ak.investasi.masuk), formatRp(ak.investasi.keluar), formatRp(ak.investasi.neto)],
      [null, ak.investasi.masuk, ak.investasi.keluar, ak.investasi.neto],
    ),
    baris(
      ['Pendanaan', formatRp(ak.pendanaan.masuk), formatRp(ak.pendanaan.keluar), formatRp(ak.pendanaan.neto)],
      [null, ak.pendanaan.masuk, ak.pendanaan.keluar, ak.pendanaan.neto],
    ),
    baris(
      ['Transfer', formatRp(ak.transfer.masuk), formatRp(ak.transfer.keluar), formatRp(ak.transfer.neto)],
      [null, ak.transfer.masuk, ak.transfer.keluar, ak.transfer.neto],
    ),
    baris(['Saldo awal', formatRp(0), formatRp(0), formatRp(ak.saldoAwal)], [null, 0, 0, ak.saldoAwal], 'subtotal', true),
    baris(
      ['Total masuk', formatRp(ak.totalMasuk), formatRp(0), formatRp(ak.totalMasuk)],
      [null, ak.totalMasuk, 0, ak.totalMasuk],
      'subtotal',
      true,
    ),
    baris(
      ['Total keluar', formatRp(0), formatRp(ak.totalKeluar), formatRp(-ak.totalKeluar)],
      [null, 0, ak.totalKeluar, -ak.totalKeluar],
      'subtotal',
      true,
    ),
    baris(
      ['Kenaikan / (penurunan)', formatRp(0), formatRp(0), formatRp(ak.kenaikan)],
      [null, 0, 0, ak.kenaikan],
      'subtotal',
      true,
    ),
    baris(
      ['Saldo akhir', formatRp(0), formatRp(0), formatRp(ak.saldoAkhir)],
      [null, 0, 0, ak.saldoAkhir],
      'total',
      true,
    ),
  ];

  const ringkasan: PrintTable = {
    judul: 'RINGKASAN KELOMPOK',
    kolom: [
      { label: 'Kelompok', width: 40 },
      { label: 'Masuk', width: 20, align: 'right' },
      { label: 'Keluar', width: 20, align: 'right' },
      { label: 'Neto', width: 20, align: 'right' },
    ],
    baris: ringkasanRows,
  };

  const mutasiRows = ak.rows.map((r) =>
    baris(
      [
        formatTanggal(r.tanggal),
        r.no_bukti || '—',
        r.keterangan || '—',
        `${r.akun_kode} — ${r.akun_nama}`,
        formatRp(r.masuk),
        formatRp(r.keluar),
        r.lawan.length ? r.lawan.join(', ') : '—',
        LABEL_KELOMPOK_ARUS_KAS[r.kelompok],
      ],
      [null, null, null, null, r.masuk, r.keluar, null, null],
    ),
  );

  const mutasi: PrintTable = {
    judul: 'MUTASI KAS',
    kolom: [
      { label: 'Tanggal', width: 9 },
      { label: 'No. Bukti', width: 11 },
      { label: 'Keterangan', width: 20 },
      { label: 'Akun', width: 17 },
      { label: 'Masuk', width: 10, align: 'right' },
      { label: 'Keluar', width: 10, align: 'right' },
      { label: 'Lawan', width: 15 },
      { label: 'Kelompok', width: 8, align: 'center' },
    ],
    baris: mutasiRows,
    footer: [
      baris(
        [
          'TOTAL ARUS (tanpa transfer)',
          '',
          '',
          '',
          formatRp(ak.totalMasuk),
          formatRp(ak.totalKeluar),
          '',
          '',
        ],
        [null, null, null, null, ak.totalMasuk, ak.totalKeluar, null, null],
        'total',
        true,
      ),
    ],
  };

  return {
    judul: 'ARUS KAS',
    subjudul: kopPeriodeEfektif(ak.mulai, ak.sampai, ak.rows),
    ...(opts.tanggalCetak ? { tanggalCetak: opts.tanggalCetak } : {}),
    ...opsiKop(opts.kop),
    orientasi: 'portrait',
    blok: [
      { jenis: 'heading', teks: 'RINGKASAN KELOMPOK' },
      { jenis: 'tabel', tabel: ringkasan },
      { jenis: 'heading', teks: 'MUTASI KAS' },
      { jenis: 'tabel', tabel: mutasi },
    ],
  };
}

/** Panjar — daftar panjar + rincian item pertanggungjawaban. */
export function panjarPrintDoc(
  daftar: readonly PanjarTampil[],
  coa: readonly Coa[] = [],
  opts: { tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  const rows: PrintRow[] = [];
  let totalJumlah = 0;
  let totalRealisasi = 0;
  let totalSisa = 0;
  let totalKurang = 0;

  for (const p of daftar) {
    const realisasi =
      p.total_realisasi ?? (p.items ?? []).reduce((s, it) => s + it.nominal, 0);
    const sisa = p.sisa ?? Math.max(0, p.jumlah - realisasi);
    const kurang = p.kurang ?? Math.max(0, realisasi - p.jumlah);
    rows.push(
      baris(
        [
          formatTanggal(p.tanggal),
          p.penerima,
          namaAkun(coa, p.akun_kas_sumber),
          formatRp(p.jumlah),
          p.status === 'OPEN'
            ? 'Belum'
            : p.status === 'CLOSED'
              ? 'Sudah'
              : 'DIBATALKAN',
          formatRp(realisasi),
          formatRp(sisa),
          formatRp(kurang),
          p.status === 'CLOSED'
            ? `Ditutup ${p.tanggal_close ? formatTanggal(p.tanggal_close) : ''}`.trim()
            : p.status === 'DIBATALKAN'
              ? `Dibatalkan ${p.tanggal_batal ? formatTanggal(p.tanggal_batal) : ''}`.trim()
              : 'Masih terbuka',
        ],
        [null, null, null, p.jumlah, null, realisasi, sisa, kurang, null],
      ),
    );
    totalJumlah += p.jumlah;
    totalRealisasi += realisasi;
    totalSisa += sisa;
    totalKurang += kurang;
  }

  const daftarTabel: PrintTable = {
    judul: 'PANJAR (UANG MUKA)',
    kolom: [
      { label: 'Tanggal', width: 9 },
      { label: 'Penerima', width: 16 },
      { label: 'Sumber', width: 17 },
      { label: 'Jumlah', width: 10, align: 'right' },
      { label: 'Status', width: 8, align: 'center' },
      { label: 'Realisasi', width: 10, align: 'right' },
      { label: 'Sisa', width: 9, align: 'right' },
      { label: 'Kurang', width: 9, align: 'right' },
      { label: 'Keterangan', width: 12 },
    ],
    baris: rows,
    footer: [
      baris(
        [
          'TOTAL',
          '',
          '',
          formatRp(totalJumlah),
          '',
          formatRp(totalRealisasi),
          formatRp(totalSisa),
          formatRp(totalKurang),
          '',
        ],
        [null, null, null, totalJumlah, null, totalRealisasi, totalSisa, totalKurang, null],
        'total',
        true,
      ),
    ],
  };

  const rincianRows: PrintRow[] = [];
  let totalRincian = 0;
  for (const p of daftar) {
    const items = p.items ?? [];
    const labelPanjar = `${formatTanggal(p.tanggal)} — ${p.penerima}`;
    if (items.length === 0) {
      rincianRows.push(
        baris(
          [labelPanjar, 'Belum ada rincian pertanggungjawaban', '', ''],
          [null, null, 0, null],
        ),
      );
      continue;
    }
    let subtotal = 0;
    for (const it of items) {
      subtotal += it.nominal;
      rincianRows.push(
        baris(
          [labelPanjar, namaAkun(coa, it.kategori_baga), formatRp(it.nominal), it.jurnal_id || '—'],
          [null, null, it.nominal, null],
        ),
      );
    }
    totalRincian += subtotal;
    rincianRows.push(
      baris(['', `Subtotal ${p.penerima}`, formatRp(subtotal), ''], [null, null, subtotal, null], 'subtotal', true),
    );
  }

  const rincianTabel: PrintTable = {
    judul: 'RINCIAN PERTANGGUNGJAWABAN',
    kolom: [
      { label: 'Panjar', width: 30 },
      { label: 'Jenis Belanja', width: 40 },
      { label: 'Nominal', width: 18, align: 'right' },
      { label: 'Jurnal', width: 12 },
    ],
    baris: rincianRows,
    footer: [
      baris(
        ['', 'TOTAL REALISASI', formatRp(totalRincian), ''],
        [null, null, totalRincian, null],
        'total',
        true,
      ),
    ],
  };

  return {
    judul: 'PANJAR (UANG MUKA)',
    subjudul: kopPeriodeEfektif(undefined, undefined, daftar),
    ...(opts.tanggalCetak ? { tanggalCetak: opts.tanggalCetak } : {}),
    ...opsiKop(opts.kop),
    orientasi: 'portrait',
    blok: [
      { jenis: 'tabel', tabel: daftarTabel },
      { jenis: 'heading', teks: 'RINCIAN PERTANGGUNGJAWABAN' },
      { jenis: 'tabel', tabel: rincianTabel },
    ],
  };
}

/** Jurnal satu bukti untuk tombol pratinjau di detail Jurnal Umum. */
export function jurnalDetailPrintDoc(
  jurnal: JurnalTampil,
  coa: readonly Coa[] = [],
  opts: { tanggalCetak?: string; kop?: KopOrganisasi } = {},
): PrintDoc {
  return jurnalPrintDoc(jurnal, coa, opts);
}
