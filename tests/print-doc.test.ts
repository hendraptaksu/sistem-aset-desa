// P1-16 — model dokumen cetak, paginator, adapter laporan, dan pratinjau.
// Fokus kontrak:
// - halaman A4 EKSPLISIT + nomor "Halaman X dari Y" berurutan;
// - header tabel berulang, tidak ada baris data hilang/dobel;
// - baris tidak terbelah, kolom memakai table-layout fixed + colgroup;
// - adapter memakai angka SEN dari core/reports.ts (bukan parse string Rupiah);
// - pratinjau & PDF memakai HTML paginator yang sama, tanpa inline script.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { COA } from '../src/db/coa.js';
import {
  arusKas,
  bukuBesar,
  labaRugi,
  neraca,
  neracaSaldo,
  neracaSaldoPeriode,
  type BarisJurnalSumber,
} from '../src/core/reports.js';
import type { Panjar } from '../src/core/types.js';
import type { JurnalTampil, PanjarTampil } from '../src/features/export/workbooks.js';
import {
  cariBarisCetak,
  infoPratinjauCetak,
  jumlahHalamanCetak,
  paginatePrintDoc,
  renderPrintDocument,
  renderPrintHtml,
  type PrintDoc,
} from '../src/features/export/printDoc.js';
import {
  arusKasPrintDoc,
  bukuBesarPrintDoc,
  jurnalPrintDoc,
  labaRugiPrintDoc,
  neracaPrintDoc,
  neracaSaldoPrintDoc,
  panjarPrintDoc,
} from '../src/features/export/printAdapters.js';
import { PratinjauCetakModal } from '../src/renderer/components/PratinjauCetakModal.js';
import { ExportActions } from '../src/renderer/components/ExportActions.js';

const RP = (rupiah: number): number => rupiah * 100;

const baris: BarisJurnalSumber[] = [
  {
    jurnal_id: 'j-modal',
    tanggal: '2025-01-01',
    no_bukti: 'JU-2025-0001',
    keterangan: 'Saldo awal',
    jenis: 'SALDO_AWAL',
    akun_kode: '1001',
    debit: RP(100_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-modal',
    tanggal: '2025-01-01',
    no_bukti: 'JU-2025-0001',
    keterangan: 'Saldo awal',
    jenis: 'SALDO_AWAL',
    akun_kode: '3000',
    debit: 0,
    kredit: RP(100_000_000),
  },
  {
    jurnal_id: 'j-r2025',
    tanggal: '2025-03-01',
    no_bukti: 'JU-2025-0002',
    keterangan: 'Pendapatan parkir 2025',
    jenis: 'TERIMA',
    akun_kode: '1001',
    debit: RP(10_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-r2025',
    tanggal: '2025-03-01',
    no_bukti: 'JU-2025-0002',
    keterangan: 'Pendapatan parkir 2025',
    jenis: 'TERIMA',
    akun_kode: '4005',
    debit: 0,
    kredit: RP(10_000_000),
  },
  {
    jurnal_id: 'j-e2025',
    tanggal: '2025-04-01',
    no_bukti: 'JU-2025-0003',
    keterangan: 'Beban upakara 2025',
    jenis: 'BAYAR',
    akun_kode: '5004',
    debit: RP(4_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-e2025',
    tanggal: '2025-04-01',
    no_bukti: 'JU-2025-0003',
    keterangan: 'Beban upakara 2025',
    jenis: 'BAYAR',
    akun_kode: '1001',
    debit: 0,
    kredit: RP(4_000_000),
  },
  {
    jurnal_id: 'j-r2026',
    tanggal: '2026-01-15',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Pendapatan parkir',
    jenis: 'TERIMA',
    akun_kode: '1001',
    debit: RP(2_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-r2026',
    tanggal: '2026-01-15',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Pendapatan parkir',
    jenis: 'TERIMA',
    akun_kode: '4005',
    debit: 0,
    kredit: RP(2_000_000),
  },
  {
    jurnal_id: 'j-e2026',
    tanggal: '2026-02-01',
    no_bukti: 'JU-2026-0002',
    keterangan: 'Bayar listrik',
    jenis: 'BAYAR',
    akun_kode: '5010',
    debit: RP(500_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-e2026',
    tanggal: '2026-02-01',
    no_bukti: 'JU-2026-0002',
    keterangan: 'Bayar listrik',
    jenis: 'BAYAR',
    akun_kode: '1001',
    debit: 0,
    kredit: RP(500_000),
  },
  {
    jurnal_id: 'j-transfer',
    tanggal: '2026-02-10',
    no_bukti: 'JU-2026-0003',
    keterangan: 'Pindah dana ke kas',
    jenis: 'TRANSFER',
    akun_kode: '1001',
    debit: RP(1_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-transfer',
    tanggal: '2026-02-10',
    no_bukti: 'JU-2026-0003',
    keterangan: 'Pindah dana ke kas',
    jenis: 'TRANSFER',
    akun_kode: '1029',
    debit: 0,
    kredit: RP(1_000_000),
  },
  {
    jurnal_id: 'j-hutang',
    tanggal: '2026-03-01',
    no_bukti: 'JU-2026-0004',
    keterangan: 'Terima pinjaman',
    jenis: 'HUTANG',
    akun_kode: '1029',
    debit: RP(3_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-hutang',
    tanggal: '2026-03-01',
    no_bukti: 'JU-2026-0004',
    keterangan: 'Terima pinjaman',
    jenis: 'HUTANG',
    akun_kode: '2050',
    debit: 0,
    kredit: RP(3_000_000),
  },
  {
    jurnal_id: 'j-bayar-hutang',
    tanggal: '2026-03-10',
    no_bukti: 'JU-2026-0005',
    keterangan: 'Bayar hutang',
    jenis: 'BAYAR',
    akun_kode: '2050',
    debit: RP(1_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-bayar-hutang',
    tanggal: '2026-03-10',
    no_bukti: 'JU-2026-0005',
    keterangan: 'Bayar hutang',
    jenis: 'BAYAR',
    akun_kode: '1029',
    debit: 0,
    kredit: RP(1_000_000),
  },
  {
    jurnal_id: 'j-panjar-buka',
    tanggal: '2026-04-01',
    no_bukti: 'JU-2026-0006',
    keterangan: 'Serah panjar',
    jenis: 'PANJAR',
    akun_kode: '1040',
    debit: RP(1_000_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-panjar-buka',
    tanggal: '2026-04-01',
    no_bukti: 'JU-2026-0006',
    keterangan: 'Serah panjar',
    jenis: 'PANJAR',
    akun_kode: '1001',
    debit: 0,
    kredit: RP(1_000_000),
  },
  {
    jurnal_id: 'j-panjar-tutup',
    tanggal: '2026-04-05',
    no_bukti: 'JU-2026-0007',
    keterangan: 'Pertanggungjawaban panjar',
    jenis: 'PANJAR',
    akun_kode: '5003',
    debit: RP(600_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-panjar-tutup',
    tanggal: '2026-04-05',
    no_bukti: 'JU-2026-0007',
    keterangan: 'Pertanggungjawaban panjar',
    jenis: 'PANJAR',
    akun_kode: '1001',
    debit: RP(400_000),
    kredit: 0,
  },
  {
    jurnal_id: 'j-panjar-tutup',
    tanggal: '2026-04-05',
    no_bukti: 'JU-2026-0007',
    keterangan: 'Pertanggungjawaban panjar',
    jenis: 'PANJAR',
    akun_kode: '1040',
    debit: 0,
    kredit: RP(1_000_000),
  },
];

const bb = bukuBesar(baris, '1001', { mulai: '2026-01-01', sampai: '2026-12-31' });
const ns = neracaSaldo(baris, '2026-12-31');
const nsTahun = {
  mode: 'tahun' as const,
  ...neracaSaldoPeriode(baris, {
    mulai: '2026-01-01',
    sampai: '2026-12-31',
  }),
};
const nsTanpaCutoff = { ...neracaSaldo(baris), mode: 'kumulatif' as const };
const lr = labaRugi(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });
const lrDefisit = labaRugi(baris, { mulai: '2026-02-01', sampai: '2026-02-28' });
const n = neraca(baris, '2026-12-31');
const ak = arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });

const jurnal: JurnalTampil[] = [
  {
    id: 'j-r2026',
    tanggal: '2026-01-15',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Pendapatan parkir',
    jenis: 'TERIMA',
    reversal_id: 'j-reversal',
    baris: [
      { akun_kode: '1001', debit: RP(2_000_000), kredit: 0, keterangan: 'Kas masuk' },
      { akun_kode: '4005', debit: 0, kredit: RP(2_000_000), keterangan: 'Pendapatan' },
    ],
  },
  {
    id: 'j-reversal',
    tanggal: '2026-05-01',
    no_bukti: 'JU-2026-0008',
    keterangan: 'KOREKSI: pendapatan parkir',
    jenis: 'REVERSAL',
    reversal_of: 'j-r2026',
    baris: [
      { akun_kode: '4005', debit: RP(2_000_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(2_000_000) },
    ],
  },
];

const panjar: PanjarTampil[] = [
  {
    id: 'p-1',
    tanggal: '2026-04-01',
    penerima: 'Panitia Piodalan',
    jumlah: RP(1_000_000),
    akun_kas_sumber: '1001',
    status: 'CLOSED',
    tanggal_close: '2026-04-05',
    total_realisasi: RP(600_000),
    sisa: RP(400_000),
    kurang: 0,
    items: [
      {
        panjar_id: 'p-1',
        kategori_baga: '5003',
        nominal: RP(600_000),
        jurnal_id: 'j-panjar-tutup',
      },
    ],
  },
  {
    id: 'p-2',
    tanggal: '2026-05-01',
    penerima: 'Panitia Karya',
    jumlah: RP(500_000),
    akun_kas_sumber: '1001',
    status: 'OPEN',
    items: [],
  },
];

function tabelPertama(doc: PrintDoc) {
  const blok = doc.blok.find((b) => b.jenis === 'tabel');
  if (!blok || blok.jenis !== 'tabel') throw new Error('Dokumen tidak punya tabel');
  return blok.tabel;
}

describe('P1-16 — paginator dokumen cetak', () => {
  const barisBanyak = Array.from({ length: 305 }, (_, i) => ({
    sel: [`Baris-${String(i + 1).padStart(3, '0')}`, `Keterangan unik ${i + 1}`],
    nilai: [i + 1, null],
  }));

  const doc: PrintDoc = {
    judul: 'UJI PAGINATION',
    subjudul: 'PERIODE 01-01-2026 s/d 31-12-2026',
    tanggalCetak: '2026-10-23',
    orientasi: 'portrait',
    blok: [
      {
        jenis: 'tabel',
        tabel: {
          kolom: [
            { label: 'Baris', width: 20 },
            { label: 'Kolom Unik Header', width: 80 },
          ],
          baris: barisBanyak,
          footer: [
            {
              sel: ['TOTAL', '305 baris'],
              nilai: [305, null],
              jenis: 'total',
              tebal: true,
            },
          ],
        },
      },
    ],
  };
  const opsi = { barisPerHalaman: 30 };

  it('300+ baris menghasilkan lebih dari 1 halaman dengan nomor berurutan', () => {
    const halaman = paginatePrintDoc(doc, opsi);
    expect(halaman.length).toBe(11);
    expect(jumlahHalamanCetak(doc, opsi)).toBe(11);

    const hasil = renderPrintDocument(doc, opsi);
    expect(hasil.jumlahHalaman).toBe(11);
    expect(hasil.orientasi).toBe('portrait');

    const nomor = [...hasil.html.matchAll(/Halaman (\d+) dari (\d+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    expect(nomor).toHaveLength(11);
    expect(nomor.map(([x]) => x)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(nomor.every(([, total]) => total === 11)).toBe(true);

    const halamanDiv = hasil.html.match(/class="halaman(?:\s+landscape)?"/g) ?? [];
    expect(halamanDiv).toHaveLength(11);
  });

  it('header tabel muncul di setiap halaman; tidak ada baris hilang/dobel', () => {
    const html = renderPrintHtml(doc, opsi);
    const header = html.match(/Kolom Unik Header/g) ?? [];
    expect(header).toHaveLength(11);

    for (let i = 1; i <= 305; i++) {
      const teks = `Baris-${String(i).padStart(3, '0')}`;
      const jumlah = html.split(teks).length - 1;
      expect(jumlah, `baris ${teks} harus tepat sekali`).toBe(1);
    }
    expect((html.match(/TOTAL/g) ?? []).length).toBe(1);
    expect(html).toContain('305 baris');
  });

  it('kop, periode, tanggal cetak, dan kop ringkas ada di halaman lanjutan', () => {
    const html = renderPrintHtml(doc, opsi);
    expect((html.match(/PURA DALEM PURI PELIATAN/g) ?? []).length).toBe(11);
    expect((html.match(/PERIODE 01-01-2026 s\/d 31-12-2026/g) ?? []).length).toBe(11);
    expect((html.match(/Tanggal cetak: 23 Okt 2026/g) ?? []).length).toBe(11);
    expect(html.match(/class="kop kop-lengkap"/g) ?? []).toHaveLength(1);
    expect(html.match(/class="kop kop-ringkas"/g) ?? []).toHaveLength(10);
  });

  it('memakai halaman A4 eksplisit, table-layout fixed, colgroup, dan baris tidak terbelah', () => {
    const html = renderPrintHtml(doc, opsi);
    expect(html).toContain('@page{size:A4 portrait;margin:0}');
    expect(html).toContain('table-layout:fixed');
    expect(html).toContain('<colgroup>');
    expect(html).toMatch(/<col style="width:\d+(?:\.\d+)?%">/);
    expect(html).toContain('page-break-inside:avoid');
    expect(html).toContain('break-inside:avoid');
    expect(html).toContain('page-break-after:always');
    // Dokumen tidak boleh memakai inline script (aman untuk CSP P1-15).
    expect(html).not.toContain('<script');
    expect(html).not.toContain('window.print');
  });

  it('landscape untuk Buku Besar, portrait untuk laporan lain', () => {
    const bbDoc = bukuBesarPrintDoc(bb, { tanggalCetak: '2026-10-23' });
    const bbHtml = renderPrintHtml(bbDoc);
    expect(bbDoc.orientasi).toBe('landscape');
    expect(bbHtml).toContain('@page{size:A4 landscape;margin:0}');
    expect(bbHtml).toContain('class="halaman landscape"');

    const portraitDocs = [
      jurnalPrintDoc(jurnal, COA, { tanggalCetak: '2026-10-23' }),
      neracaSaldoPrintDoc(ns, { tanggalCetak: '2026-10-23' }),
      labaRugiPrintDoc(lr, { tanggalCetak: '2026-10-23' }),
      neracaPrintDoc(n, { tanggalCetak: '2026-10-23' }),
      arusKasPrintDoc(ak, { tanggalCetak: '2026-10-23' }),
      panjarPrintDoc(panjar, COA, { tanggalCetak: '2026-10-23' }),
    ];
    for (const d of portraitDocs) {
      const html = renderPrintHtml(d);
      expect(html).toContain('@page{size:A4 portrait;margin:0}');
      expect(html).not.toContain('@page{size:A4 landscape;margin:0}');
    }
  });
});

describe('P1-16 — adapter memakai angka core/reports (SEN)', () => {
  it('Jurnal Umum: subtotal per jurnal + total keseluruhan numerik', () => {
    const doc = jurnalPrintDoc(jurnal, COA, {
      mulai: '2026-01-01',
      sampai: '2026-12-31',
      tanggalCetak: '2026-10-23',
    });
    const tabel = tabelPertama(doc);
    expect(tabel.baris).toHaveLength(6); // 4 baris jurnal + 2 subtotal
    const subtotal = cariBarisCetak(doc, 'Subtotal JU-2026-0001')!;
    expect(subtotal.nilai?.[4]).toBe(RP(2_000_000));
    expect(subtotal.nilai?.[5]).toBe(RP(2_000_000));
    const total = tabel.footer?.[0]!;
    expect(total.nilai?.[4]).toBe(RP(4_000_000));
    expect(total.nilai?.[5]).toBe(RP(4_000_000));
    expect(typeof total.nilai?.[4]).toBe('number');
    expect(renderPrintHtml(doc)).toContain('TOTAL KESELURUHAN');
  });

  it('Buku Besar: saldo awal, mutasi, total debit/kredit, saldo akhir', () => {
    const doc = bukuBesarPrintDoc(bb, { tanggalCetak: '2026-10-23' });
    const tabel = tabelPertama(doc);
    expect(tabel.baris).toHaveLength(bb.rows.length + 1);
    expect(tabel.baris[0]!.nilai?.[5]).toBe(bb.saldoAwal);
    const total = tabel.footer?.find((r) => r.sel[0] === 'TOTAL MUTASI')!;
    expect(total.nilai?.[3]).toBe(bb.totalDebit);
    expect(total.nilai?.[4]).toBe(bb.totalKredit);
    expect(total.nilai?.[5]).toBe(bb.saldoAkhir);
    const akhir = tabel.footer?.find((r) => r.sel[0] === 'SALDO AKHIR')!;
    expect(akhir.nilai?.[5]).toBe(bb.saldoAkhir);
    expect(doc.orientasi).toBe('landscape');
  });

  it('Neraca Saldo: semua akun + total + status seimbang', () => {
    const doc = neracaSaldoPrintDoc(ns, { tanggalCetak: '2026-10-23' });
    const tabel = tabelPertama(doc);
    expect(tabel.baris).toHaveLength(ns.rows.length);
    const total = tabel.footer?.find((r) => r.sel[0] === 'TOTAL')!;
    expect(total.nilai?.[3]).toBe(ns.totalDebit);
    expect(total.nilai?.[4]).toBe(ns.totalKredit);
    const status = tabel.footer?.find((r) => r.sel[0] === 'STATUS')!;
    expect(status.sel[1]).toBe('Seimbang');
    expect(status.nilai?.[5]).toBe(ns.selisih);
    expect(renderPrintHtml(doc)).toContain('Seimbang');
  });

  it('Neraca Saldo mode tahun: subjudul tahun buku + baris laba ditahan', () => {
    const doc = neracaSaldoPrintDoc(nsTahun, { tanggalCetak: '2026-10-27' });
    const tabel = tabelPertama(doc);
    expect(doc.subjudul).toBe('TAHUN BUKU 1 Jan 2026 s/d 31 Des 2026');
    expect(tabel.baris).toHaveLength(nsTahun.rows.length);

    const labaDitahan = cariBarisCetak(doc, 'Laba ditahan sebelum periode')!;
    expect(labaDitahan.nilai?.[4]).toBe(RP(6_000_000));
    expect(labaDitahan.nilai?.[3]).toBe(0);
    expect(labaDitahan.tebal).toBe(true);

    const total = tabel.footer?.find((r) => r.sel[0] === 'TOTAL')!;
    expect(total.nilai?.[3]).toBe(nsTahun.totalDebit);
    expect(total.nilai?.[4]).toBe(nsTahun.totalKredit);
    const status = tabel.footer?.find((r) => r.sel[0] === 'STATUS')!;
    expect(status.sel[1]).toBe('Seimbang');

    // Kontrak lama tanpa mode & tanpa cutoff tetap memakai label kumulatif.
    expect(neracaSaldoPrintDoc(nsTanpaCutoff).subjudul).toBe('SEMUA PERIODE');
    expect(renderPrintHtml(doc)).toContain('Laba ditahan sebelum periode');
  });

  it('Laba Rugi: total pendapatan/beban/laba + defisit dalam kurung', () => {
    const doc = labaRugiPrintDoc(lr, { tanggalCetak: '2026-10-23' });
    const tabel = tabelPertama(doc);
    const totalPendapatan = cariBarisCetak(doc, 'Total Pendapatan')!;
    const totalBeban = cariBarisCetak(doc, 'Total Beban')!;
    const laba = tabel.footer?.[0]!;
    expect(totalPendapatan.nilai?.[2]).toBe(lr.totalPendapatan);
    expect(totalBeban.nilai?.[2]).toBe(lr.totalBeban);
    expect(laba.nilai?.[2]).toBe(lr.laba);

    const htmlDefisit = renderPrintHtml(labaRugiPrintDoc(lrDefisit, { tanggalCetak: '2026-10-23' }));
    expect(htmlDefisit).toContain('(Rp 500.000,00)');
  });

  it('Neraca: aset/kewajiban/ekuitas, laba turunan, total aset/pasiva', () => {
    const doc = neracaPrintDoc(n, { tanggalCetak: '2026-10-23' });
    const tabel = tabelPertama(doc);
    expect(cariBarisCetak(doc, 'Total Aset')?.nilai?.[2]).toBe(n.totalAset);
    expect(cariBarisCetak(doc, 'Total Kewajiban')?.nilai?.[2]).toBe(n.totalKewajiban);
    expect(cariBarisCetak(doc, 'Total Ekuitas')?.nilai?.[2]).toBe(n.totalEkuitas);
    expect(cariBarisCetak(doc, 'Laba ditahan (tahun sudah tutup)')?.nilai?.[2]).toBe(n.labaDitahan);
    expect(cariBarisCetak(doc, 'Laba tahun lampau belum ditutup')?.nilai?.[2]).toBe(n.labaBelumDitutup);
    expect(cariBarisCetak(doc, 'Laba berjalan (1 Januari s/d tanggal laporan)')?.nilai?.[2]).toBe(n.labaBerjalan);
    const totalPasiva = tabel.footer?.find((r) => r.sel[1] === 'TOTAL PASIVA')!;
    expect(totalPasiva.nilai?.[2]).toBe(n.totalPasiva);
    expect(renderPrintHtml(doc)).toContain('TOTAL PASIVA');
  });

  it('Arus Kas: ringkasan kelompok + tabel mutasi + total', () => {
    const doc = arusKasPrintDoc(ak, { tanggalCetak: '2026-10-23' });
    const tabel = doc.blok.filter((b) => b.jenis === 'tabel');
    expect(tabel).toHaveLength(2);
    const ringkasan = (tabel[0] as Extract<(typeof tabel)[number], { jenis: 'tabel' }>).tabel;
    const mutasi = (tabel[1] as Extract<(typeof tabel)[number], { jenis: 'tabel' }>).tabel;
    expect(cariBarisCetak(doc, 'Operasi')?.nilai?.[3]).toBe(ak.operasi.neto);
    expect(cariBarisCetak(doc, 'Investasi')?.nilai?.[3]).toBe(ak.investasi.neto);
    expect(cariBarisCetak(doc, 'Pendanaan')?.nilai?.[3]).toBe(ak.pendanaan.neto);
    expect(cariBarisCetak(doc, 'Transfer')?.nilai?.[3]).toBe(ak.transfer.neto);
    expect(mutasi.baris).toHaveLength(ak.rows.length);
    expect(mutasi.footer?.[0]!.nilai?.[4]).toBe(ak.totalMasuk);
    expect(mutasi.footer?.[0]!.nilai?.[5]).toBe(ak.totalKeluar);
    expect(ringkasan.baris.some((r) => r.sel[0] === 'Saldo akhir')).toBe(true);
  });

  it('Panjar: daftar + rincian item + total numerik', () => {
    const doc = panjarPrintDoc(panjar, COA, { tanggalCetak: '2026-10-23' });
    const tabel = doc.blok.filter((b) => b.jenis === 'tabel');
    expect(tabel).toHaveLength(2);
    const daftar = (tabel[0] as Extract<(typeof tabel)[number], { jenis: 'tabel' }>).tabel;
    const rincian = (tabel[1] as Extract<(typeof tabel)[number], { jenis: 'tabel' }>).tabel;
    expect(daftar.baris).toHaveLength(panjar.length);
    const total = daftar.footer?.[0]!;
    expect(total.nilai?.[3]).toBe(RP(1_500_000));
    expect(total.nilai?.[5]).toBe(RP(600_000));
    expect(total.nilai?.[6]).toBe(RP(900_000));
    expect(total.nilai?.[7]).toBe(0);
    expect(rincian.baris.some((r) => r.sel[1] === 'Subtotal Panitia Piodalan')).toBe(true);
    expect(
      rincian.baris.some((r) => r.sel[1] === 'Belum ada rincian pertanggungjawaban'),
    ).toBe(true);
    expect(typeof total.nilai?.[3]).toBe('number');
  });

  it('tipe PanjarTampil tetap kompatibel dengan Panjar', () => {
    const p: PanjarTampil = panjar[0]!;
    const dasar: Panjar = p;
    expect(dasar.id).toBe('p-1');
  });
});

describe('P1-16 — pratinjau & PDF memakai HTML yang sama', () => {
  it('renderPrintHtml = renderPrintDocument.html, tanpa auto-print', () => {
    const doc = neracaSaldoPrintDoc(ns, { tanggalCetak: '2026-10-23' });
    const hasil = renderPrintDocument(doc);
    expect(renderPrintHtml(doc)).toBe(hasil.html);
    expect(hasil.html).not.toContain('<script');
    expect(hasil.html).not.toContain('window.print');
    expect(hasil.html).toContain('@page{size:A4 portrait;margin:0}');
  });

  it('info pratinjau menyebut halaman dan orientasi', () => {
    expect(infoPratinjauCetak(3, 'landscape')).toBe('Halaman 1 dari 3 · A4 Landscape');
    expect(infoPratinjauCetak(0, 'portrait')).toBe('Halaman 1 dari 1 · A4 Portrait');
  });

  it('modal pratinjau menampilkan iframe, info halaman, Cetak, dan Tutup', () => {
    const html = renderToStaticMarkup(
      createElement(PratinjauCetakModal, {
        judul: 'Neraca Saldo',
        html: '<p>dokumen</p>',
        jumlahHalaman: 3,
        orientasi: 'landscape',
        onClose: () => undefined,
      }),
    );
    expect(html).toContain('<iframe');
    expect(html).toContain('sandbox="allow-same-origin allow-modals"');
    expect(html).not.toContain('allow-scripts');
    expect(html).toContain('Pratinjau Cetak — Neraca Saldo');
    expect(html).toContain('Halaman 1 dari 3');
    expect(html).toContain('A4 Landscape');
    expect(html).toContain('Cetak');
    expect(html).toContain('Tutup');
  });

  it('ExportActions memakai tombol Pratinjau Cetak (bukan Print lama)', () => {
    const html = renderToStaticMarkup(
      createElement(ExportActions, {
        namaDasar: 'uji',
        judul: 'Uji',
        buatWorkbook: async () => {
          throw new Error('tidak dipanggil saat render');
        },
        buatDokumen: () => neracaSaldoPrintDoc(ns),
      }),
    );
    expect(html).toContain('Export Excel');
    expect(html).toContain('Simpan PDF');
    expect(html).toContain('Pratinjau Cetak');
    expect(html).not.toContain('>Print<');
  });
});
