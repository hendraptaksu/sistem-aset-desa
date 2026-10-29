// P2-9 — import jurnal massal dari Excel.
// Fokus: template bisa dibaca ulang, parser memvalidasi per baris, dan adapter
// DB menyimpan lewat posting layer (tanpa Electron/jsdom, semua buffer di memori).

import ExcelJS from 'exceljs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COA } from '../src/db/coa.js';
import { openDb } from '../src/db/database.js';
import {
  imporJurnalDariExcel,
  validasiImporDariExcel,
  PESAN_NOMOR_BUKTI_DIPAKAI,
} from '../src/db/impor.js';
import { postingJurnal } from '../src/db/posting.js';
import {
  insertTutupBuku,
  listAuditLog,
  listJurnal,
  listJurnalBaris,
} from '../src/db/repository.js';
import {
  KOLOM_TEMPLATE_IMPOR,
  buatBufferTemplateImpor,
  buatTemplateImpor,
} from '../src/features/import/template.js';
import {
  BATAS_BARIS_IMPOR,
  BATAS_UKURAN_IMPOR,
  PESAN_NO_BUKTI_IMPOR_WAJIB,
  parseImporExcel,
  parseNominalImpor,
  parseTanggalImpor,
  validasiBatasImpor,
  type HasilParseImpor,
} from '../src/features/import/parser.js';

type BarisUji = Record<string, string | number>;

/** Bangun workbook .xlsx di memori; header default = kolom template. */
async function bufferDari(
  rows: BarisUji[],
  header: readonly string[] = KOLOM_TEMPLATE_IMPOR,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Jurnal');
  ws.addRow([...header]);
  for (const r of rows) {
    ws.addRow(header.map((k) => r[k] ?? ''));
  }
  const out = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array | ArrayBuffer;
  return out instanceof Uint8Array ? new Uint8Array(out) : new Uint8Array(out);
}

async function parse(rows: BarisUji[], opsi: Parameters<typeof parseImporExcel>[1] = {}) {
  return parseImporExcel(await bufferDari(rows), opsi);
}

const D = (akun: string, nominal: number | string) => ({
  akun,
  debit: nominal,
  kredit: '',
});
const K = (akun: string, nominal: number | string) => ({
  akun,
  debit: '',
  kredit: nominal,
});

function grup(
  nama: string,
  tanggal: string,
  keterangan: string,
  baris: BarisUji[],
  extra: Partial<BarisUji> = {},
): BarisUji[] {
  return baris.map((b, i) => ({
    grup: nama,
    tanggal: i === 0 ? tanggal : '',
    no_bukti: `BUKTI-${nama}`,
    keterangan: i === 0 ? keterangan : '',
    catatan: '',
    ...extra,
    ...b,
  }));
}

const dbBaru: { db: ReturnType<typeof openDb>; dir: string }[] = [];

function buatDb() {
  const dir = mkdtempSync(join(tmpdir(), 'pura-impor-'));
  const db = openDb(join(dir, 'pura.db'));
  const item = { db, dir };
  dbBaru.push(item);
  return item;
}

afterEach(() => {
  for (const { db, dir } of dbBaru.splice(0)) {
    try {
      if (db.open) db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function alasanSemua(hasil: HasilParseImpor): string {
  return hasil.baris.map((b) => b.alasan).join(' | ');
}

describe('P2-9 — template Excel', () => {
  it('round-trip: template bisa dibaca parser, 3 grup contoh valid & seimbang', async () => {
    const buffer = await buatBufferTemplateImpor();
    const hasil = await parseImporExcel(buffer, { namaFile: 'template.xlsx' });

    expect(hasil.errors).toEqual([]);
    expect(hasil.ringkasan.totalGrup).toBe(3);
    expect(hasil.ringkasan.grupValid).toBe(3);
    expect(hasil.ringkasan.grupGagal).toBe(0);
    expect(hasil.ringkasan.totalBaris).toBe(7);
    expect(hasil.ringkasan.seimbang).toBe(true);
    expect(hasil.ringkasan.totalDebit).toBe(135_500_000); // Rp 1.355.000 dalam sen
    expect(hasil.baris.every((b) => b.status === 'OK')).toBe(true);
    expect(hasil.grup.map((g) => g.barisExcel.length)).toEqual([2, 3, 2]);
    expect(hasil.grup[2]!.tanggal).toBe('2026-01-15'); // contoh DD/MM/YYYY
  });

  it('workbook punya sheet Jurnal, Petunjuk, dan Akun dengan daftar COA', async () => {
    const wb = buatTemplateImpor();
    expect(wb.getWorksheet('Jurnal')).toBeTruthy();
    expect(wb.getWorksheet('Petunjuk')).toBeTruthy();
    const akun = wb.getWorksheet('Akun');
    expect(akun).toBeTruthy();
    expect(akun!.getRow(1).values).toEqual([undefined, 'kode', 'nama', 'tipe']);
    const kode = new Set<string>();
    akun!.eachRow((row, n) => {
      if (n > 1) kode.add(String(row.getCell(1).value));
    });
    expect(kode.has('1001')).toBe(true);
    expect(kode.has('4005')).toBe(true);
    expect(kode.size).toBe(COA.length);
  });

  it('menandai no_bukti wajib dan mengisi contoh nomor di setiap grup', () => {
    const wb = buatTemplateImpor();
    const jurnal = wb.getWorksheet('Jurnal')!;
    const header = jurnal.getRow(1).values as unknown[];
    const kolomNoBukti = header.indexOf('no_bukti');
    expect(kolomNoBukti).toBeGreaterThan(0);
    expect(String(jurnal.getCell(1, kolomNoBukti).note)).toMatch(/wajib/i);

    const contoh = new Map<string, string>();
    jurnal.eachRow((row, n) => {
      if (n === 1) return;
      const nama = String(row.getCell(1).value ?? '').trim();
      const noBukti = String(row.getCell(kolomNoBukti).value ?? '').trim();
      if (nama && !contoh.has(nama)) contoh.set(nama, noBukti);
    });
    expect([...contoh.keys()]).toEqual(['CONTOH-1', 'CONTOH-2', 'CONTOH-3']);
    for (const [nama, noBukti] of contoh) {
      expect(noBukti, `contoh ${nama} harus punya no_bukti`).not.toBe('');
    }
    expect(new Set(contoh.values()).size).toBe(3);
  });
});

describe('AKT-29 — tanggal import tidak bergeser sehari', () => {
  it('Date tengah malam WITA tetap memakai tanggal lokal yang sama', () => {
    // 2026-01-14T16:00:00Z = 2026-01-15 00:00 WITA. toISOString() lama
    // menghasilkan 2026-01-14 sehingga tanggal impor mundur sehari.
    const tengahMalamWita = new Date('2026-01-14T16:00:00.000Z');
    expect(parseTanggalImpor(tengahMalamWita)).toMatchObject({
      iso: '2026-01-15',
      mentah: '2026-01-15',
    });
  });

  it('workbook serial 1904 dibaca dengan tanggal yang benar (didukung ExcelJS)', async () => {
    const wb = new ExcelJS.Workbook();
    wb.properties.date1904 = true;
    const ws = wb.addWorksheet('Jurnal');
    ws.addRow([...KOLOM_TEMPLATE_IMPOR]);
    ws.addRow(['G-1904', '', 'BUKTI-1904', 'Tanggal serial 1904', '1001', 10_000, '', '']);
    ws.addRow(['G-1904', '', '', '', '4005', '', 10_000, '']);
    // Sel tanggal asli (bukan serial mentah): ExcelJS mengonversi memakai
    // sistem 1904 saat membaca, jadi parser menerima Date yang sudah benar.
    ws.getCell(2, 2).value = new Date(Date.UTC(2026, 0, 15));
    ws.getCell(2, 2).numFmt = 'yyyy-mm-dd';

    const buffer = (await wb.xlsx.writeBuffer()) as unknown as Uint8Array;
    const hasil = await parseImporExcel(buffer, { namaFile: 'serial-1904.xlsx' });

    expect(hasil.errors).toEqual([]);
    expect(hasil.ringkasan.grupValid).toBe(1);
    expect(hasil.grup[0]!.tanggal).toBe('2026-01-15');
  });
});

describe('P2-9 — parser multi-baris', () => {
  it('menggabungkan grup 2 baris & 3 baris yang seimbang, fill-forward tanggal/keterangan/no bukti', async () => {
    const rows = [
      ...grup('G1', '2026-02-01', 'Terima parkir', [
        D('1001', 150_000),
        K('4005', 150_000),
      ], { no_bukti: 'JU-2026-0100' }),
      ...grup('G2', '2026-02-02', 'Bayar listrik & admin', [
        D('5010', 200_000),
        D('5040', 5_000),
        K('1001', 205_000),
      ]),
    ];
    const hasil = await parse(rows);

    expect(hasil.errors).toEqual([]);
    expect(hasil.ringkasan).toMatchObject({
      totalBaris: 5,
      valid: 5,
      gagal: 0,
      totalGrup: 2,
      grupValid: 2,
      grupGagal: 0,
      totalDebit: 35_500_000,
      totalKredit: 35_500_000,
      seimbang: true,
    });
    expect(hasil.grup[0]).toMatchObject({
      grup: 'G1',
      no_bukti: 'JU-2026-0100',
      status: 'OK',
      totalDebit: 15_000_000,
      totalKredit: 15_000_000,
    });
    // Baris kedua G1 hanya punya akun/nominal; tanggal/keterangan ikut baris pertama.
    const barisKedua = hasil.baris.find((b) => b.barisExcel === 3)!;
    expect(barisKedua.tanggal).toBe('2026-02-01');
    expect(barisKedua.keterangan).toBe('Terima parkir');
    expect(barisKedua.status).toBe('OK');
    // Grup tiga baris.
    expect(hasil.grup[1]!.barisExcel).toHaveLength(3);
    expect(hasil.grup[1]!.totalKredit).toBe(20_500_000);
  });

  it('grup tidak seimbang → semua baris grup GAGAL dengan alasan total debit/kredit', async () => {
    const hasil = await parse(
      grup('G-SALAH', '2026-02-03', 'Tidak seimbang', [
        D('1001', 100_000),
        K('4005', 90_000),
      ]),
    );

    expect(hasil.ringkasan.grupValid).toBe(0);
    expect(hasil.ringkasan.gagal).toBe(2);
    expect(hasil.baris.every((b) => b.status === 'GAGAL')).toBe(true);
    expect(alasanSemua(hasil)).toMatch(/tidak seimbang/i);
    expect(alasanSemua(hasil)).toMatch(/100\.000/);
    expect(alasanSemua(hasil)).toMatch(/90\.000/);
    expect(hasil.grup[0]!.input).toBeUndefined();
  });

  it('menolak tanggal kalender tidak ada (31 Feb) dan tanggal wajib', async () => {
    const hasil31 = await parse(
      grup('G-31FEB', '2026-02-31', 'Tanggal salah', [
        D('1001', 10_000),
        K('4005', 10_000),
      ]),
    );
    expect(hasil31.ringkasan.grupValid).toBe(0);
    expect(hasil31.baris.every((b) => b.status === 'GAGAL')).toBe(true);
    expect(alasanSemua(hasil31)).toMatch(/tidak valid/i);

    const tanpaTanggal = await parse(
      grup('G-TANPA-TGL', '', 'Tanpa tanggal', [
        D('1001', 10_000),
        K('4005', 10_000),
      ]),
    );
    expect(tanpaTanggal.ringkasan.grupValid).toBe(0);
    expect(alasanSemua(tanpaTanggal)).toMatch(/tanggal wajib/i);
  });

  it('menolak akun tidak ada dan akun nonaktif', async () => {
    const tidakAda = await parse(
      grup('G-AKUN', '2026-03-01', 'Akun tidak ada', [
        D('9999', 10_000),
        K('4005', 10_000),
      ]),
    );
    expect(tidakAda.ringkasan.grupValid).toBe(0);
    expect(alasanSemua(tidakAda)).toMatch(/9999 tidak ada/i);

    const akunNonaktif = COA.map((a) => ({
      ...a,
      aktif: a.kode !== '1001',
    }));
    const nonaktif = await parse(
      grup('G-NONAKTIF', '2026-03-01', 'Akun nonaktif', [
        D('1001', 10_000),
        K('4005', 10_000),
      ]),
      { akun: akunNonaktif },
    );
    expect(nonaktif.ringkasan.grupValid).toBe(0);
    expect(alasanSemua(nonaktif)).toMatch(/1001 sudah tidak aktif/i);
  });

  it('menolak akun legacy 3001/3002 di pratinjau impor', async () => {
    for (const kode of ['3001', '3002']) {
      const hasil = await parse(
        grup(`G-LEGACY-${kode}`, '2026-03-01', 'Akun legacy', [
          D('1001', 10_000),
          K(kode, 10_000),
        ]),
      );
      expect(hasil.ringkasan.grupValid).toBe(0);
      expect(alasanSemua(hasil)).toContain(kode);
      expect(alasanSemua(hasil)).toMatch(/legacy/i);
      expect(alasanSemua(hasil)).toMatch(/tidak boleh diposting/i);
    }
  });

  it('menolak baris dengan debit+kredit terisi dan baris kosong', async () => {
    const duaSisi = await parse(
      grup('G-DUA-SISI', '2026-03-02', 'Dua sisi', [
        { akun: '1001', debit: 10_000, kredit: 10_000 },
        { akun: '4005', debit: 0, kredit: 10_000 },
        { akun: '4005', debit: 10_000, kredit: 0 },
      ]),
    );
    expect(duaSisi.ringkasan.grupValid).toBe(0);
    expect(duaSisi.baris[0]!.alasan).toMatch(/salah satu/i);

    const kosong = await parse(
      grup('G-KOSONG', '2026-03-03', 'Nominal kosong', [
        { akun: '1001', debit: 0, kredit: 0 },
        { akun: '4005', debit: 0, kredit: 0 },
      ]),
    );
    expect(kosong.ringkasan.grupValid).toBe(0);
    expect(alasanSemua(kosong)).toMatch(/wajib lebih dari 0/i);
  });

  it('menerima nominal teks "Rp 150.000" dan mengubahnya ke sen', async () => {
    const hasil = await parse(
      grup('G-RP', '2026-03-04', 'Nominal teks', [
        D('1001', 'Rp 150.000'),
        K('4005', '150.000'),
      ]),
    );
    expect(hasil.ringkasan.grupValid).toBe(1);
    expect(hasil.grup[0]!.totalDebit).toBe(15_000_000);
    expect(hasil.grup[0]!.totalKredit).toBe(15_000_000);
    expect(parseNominalImpor('Rp 1.500.000').sen).toBe(150_000_000);
  });

  it('menolak nomor bukti yang dipakai lebih dari satu grup', async () => {
    const hasil = await parse([
      ...grup('G1', '2026-04-01', 'Satu', [D('1001', 10_000), K('4005', 10_000)], {
        no_bukti: 'JU-2026-0007',
      }),
      ...grup('G2', '2026-04-02', 'Dua', [D('1001', 20_000), K('4005', 20_000)], {
        no_bukti: 'JU-2026-0007',
      }),
    ]);
    expect(hasil.ringkasan.grupValid).toBe(0);
    expect(alasanSemua(hasil)).toMatch(/dipakai lebih dari satu grup/i);
  });

  it('mengizinkan nomor bukti sama dalam satu file bila tahunnya berbeda', async () => {
    const hasil = await parse([
      ...grup('G-2025', '2025-04-01', 'Tahun 2025', [D('1001', 10_000), K('4005', 10_000)], {
        no_bukti: 'JU-LINTAS-0002',
      }),
      ...grup('G-2026', '2026-04-01', 'Tahun 2026', [D('1001', 20_000), K('4005', 20_000)], {
        no_bukti: 'ju-lintas-0002',
      }),
    ]);
    expect(hasil.ringkasan.grupValid).toBe(2);
    expect(hasil.ringkasan.grupGagal).toBe(0);
  });

  it('menolak grup tanpa no_bukti dengan pesan wajib yang jelas', async () => {
    const hasil = await parse(
      grup('G-TANPA-BUKTI', '2026-04-03', 'Tanpa nomor bukti', [
        D('1001', 10_000),
        K('4005', 10_000),
      ], { no_bukti: '' }),
    );
    expect(hasil.ringkasan.grupValid).toBe(0);
    expect(hasil.grup[0]!.status).toBe('GAGAL');
    expect(hasil.grup[0]!.alasan).toBe(PESAN_NO_BUKTI_IMPOR_WAJIB);
    expect(hasil.baris.every((b) => b.status === 'GAGAL')).toBe(true);
    expect(hasil.baris.every((b) => b.alasan.includes(PESAN_NO_BUKTI_IMPOR_WAJIB))).toBe(true);
  });

  it('menolak bentuk sederhana tanpa no_bukti', async () => {
    const buffer = await bufferDari(
      [{ tanggal: '2026-05-02', keterangan: 'Tanpa bukti', akun_debit: '1001', akun_kredit: '4041', nominal: 75_000 }],
      ['tanggal', 'keterangan', 'akun_debit', 'akun_kredit', 'nominal'],
    );
    const hasil = await parseImporExcel(buffer);
    expect(hasil.ringkasan.grupValid).toBe(0);
    expect(alasanSemua(hasil)).toContain(PESAN_NO_BUKTI_IMPOR_WAJIB);
  });

  it('mendukung bentuk sederhana per baris (satu baris = satu jurnal)', async () => {
    const buffer = await bufferDari(
      [{ tanggal: '2026-05-01', no_bukti: 'JU-SIMPLE-0001', keterangan: 'Terima sesari', akun_debit: '1001', akun_kredit: '4041', nominal: 75_000 }],
      ['tanggal', 'no_bukti', 'keterangan', 'akun_debit', 'akun_kredit', 'nominal'],
    );
    const hasil = await parseImporExcel(buffer);
    expect(hasil.errors).toEqual([]);
    expect(hasil.ringkasan.grupValid).toBe(1);
    expect(hasil.grup[0]!.no_bukti).toBe('JU-SIMPLE-0001');
    expect(hasil.baris).toHaveLength(2);
    expect(hasil.baris.map((b) => b.sisi)).toEqual(['DEBIT', 'KREDIT']);
    expect(hasil.baris[0]).toMatchObject({ akun: '1001', debit: 7_500_000, status: 'OK' });
    expect(hasil.baris[1]).toMatchObject({ akun: '4041', kredit: 7_500_000, status: 'OK' });
  });
});

describe('P2-9 — batas aman file & baris', () => {
  it('helper menolak ukuran > 10 MB dan baris > 5.000', () => {
    expect(validasiBatasImpor({ ukuran: 100, jumlahBaris: 10 })).toBeNull();
    expect(validasiBatasImpor({ ukuran: BATAS_UKURAN_IMPOR + 1 })).toMatch(/10 MB/);
    expect(validasiBatasImpor({ jumlahBaris: BATAS_BARIS_IMPOR + 1 })).toMatch(/5\.000/);
  });

  it('parser menolak file yang melebihi batas baris', async () => {
    const rows = grup('G1', '2026-06-01', 'Batas', [
      D('1001', 10_000),
      K('4005', 10_000),
      D('1001', 1_000),
    ]);
    const hasil = await parse(rows, { maksBaris: 2 });
    expect(hasil.errors.join(' ')).toMatch(/maksimal 2 baris/i);
    expect(hasil.grup).toHaveLength(0);
    expect(hasil.ringkasan.totalBaris).toBe(0);
  });
});

describe('P2-9 — impor ke DB lewat posting layer', () => {
  it('2 grup valid tersimpan, grup tidak seimbang tidak tersimpan, memakai nomor bukti file, audit IMPORT-EXCEL ada', () => {
    const { db } = buatDb();
    const rows = [
      ...grup('G1', '2026-01-05', 'Terima parkir', [D('1001', 150_000), K('4005', 150_000)], {
        no_bukti: 'JU-2026-0101',
      }),
      ...grup('G2', '2026-01-06', 'Bayar listrik', [D('5010', 200_000), K('1001', 200_000)], {
        no_bukti: 'JU-2026-0102',
      }),
      ...grup('G-SALAH', '2026-01-07', 'Tidak seimbang', [D('1001', 50_000), K('4005', 40_000)]),
    ];

    return parse(rows).then((hasil) => {
      expect(hasil.ringkasan.grupValid).toBe(2);
      expect(hasil.ringkasan.grupGagal).toBe(1);

      const impor = imporJurnalDariExcel(db, hasil, {
        namaFile: 'impor-uji.xlsx',
        konfirmasiPeringatan: true,
      });
      expect(impor.ringkasan.jurnalDibuat).toBe(2);
      expect(impor.ringkasan.grupBerhasil).toBe(2);
      expect(impor.ringkasan.grupGagal).toBe(1);
      expect(impor.ringkasan.noBuktiDibuat).toEqual(['JU-2026-0101', 'JU-2026-0102']);
      expect(impor.ringkasan.totalDebit).toBe(35_000_000);
      expect(impor.ringkasan.seimbang).toBe(true);

      const jurnal = listJurnal(db);
      expect(jurnal).toHaveLength(2);
      expect(jurnal.map((j) => j.no_bukti)).toEqual(['JU-2026-0101', 'JU-2026-0102']);
      expect(jurnal.every((j) => j.jenis === 'UMUM')).toBe(true);
      expect(listJurnalBaris(db, jurnal[0]!.id)).toHaveLength(2);
      expect(listJurnalBaris(db, jurnal[1]!.id)).toHaveLength(2);

      // Audit ringkasan + audit CREATE dari postingJurnal tetap ada.
      const auditImpor = listAuditLog(db, { aksi: 'IMPORT-EXCEL' });
      expect(auditImpor).toHaveLength(1);
      const data = JSON.parse(auditImpor[0]!.data_baru_json) as Record<string, unknown>;
      expect(data).toMatchObject({
        nama_file: 'impor-uji.xlsx',
        grup_sukses: 2,
        grup_gagal: 1,
        jurnal_dibuat: 2,
      });
      expect(JSON.stringify(data)).not.toContain('Terima parkir');
      expect(listAuditLog(db, { aksi: 'CREATE' })).toHaveLength(2);
    });
  });

  it('pratinjau DB tidak menulis jurnal dan menandai duplikat no bukti', async () => {
    const { db } = buatDb();
    postingJurnal(db, {
      header: {
        id: 'j-lama',
        tanggal: '2026-01-01',
        keterangan: 'Jurnal lama',
        no_bukti: 'JU-2026-0500',
      },
      baris: [
        { akun_kode: '1001', debit: 10_000, kredit: 0 },
        { akun_kode: '4005', debit: 0, kredit: 10_000 },
      ],
    });
    const hasil = await parse(
      grup('G1', '2026-02-01', 'Nomor sama', [D('1001', 10_000), K('4005', 10_000)], {
        no_bukti: 'JU-2026-0500',
      }),
    );
    const preview = validasiImporDariExcel(db, hasil);
    expect(preview.grup[0]!.status).toBe('GAGAL');
    expect(preview.grup[0]!.alasan).toContain(PESAN_NOMOR_BUKTI_DIPAKAI);
    expect(preview.grup[0]!.alasan).toMatch(/JU-2026-0500/);
    expect(preview.baris.every((b) => b.status === 'GAGAL')).toBe(true);
    expect(listJurnal(db)).toHaveLength(1);
    expect(listAuditLog(db, { aksi: 'IMPORT-EXCEL' })).toHaveLength(0);
  });

  it('menolak duplikat no_bukti (tanpa beda huruf besar/kecil) saat impor dan tidak menambah jurnal', async () => {
    const { db } = buatDb();
    postingJurnal(db, {
      header: {
        id: 'j-lama',
        tanggal: '2026-01-01',
        keterangan: 'Jurnal lama',
        no_bukti: 'JU-2026-0500',
      },
      baris: [
        { akun_kode: '1001', debit: 10_000, kredit: 0 },
        { akun_kode: '4005', debit: 0, kredit: 10_000 },
      ],
    });
    const hasil = await parse(
      grup('G1', '2026-02-01', 'Nomor sama', [D('1001', 10_000), K('4005', 10_000)], {
        no_bukti: 'ju-2026-0500',
      }),
    );
    const impor = imporJurnalDariExcel(db, hasil, { namaFile: 'duplikat.xlsx' });
    expect(impor.ringkasan.jurnalDibuat).toBe(0);
    expect(impor.grup[0]!.status).toBe('GAGAL');
    expect(impor.grup[0]!.alasan).toContain(PESAN_NOMOR_BUKTI_DIPAKAI);
    expect(listJurnal(db)).toHaveLength(1);
  });

  it('impor ulang file yang sama gagal pada pratinjau dan tidak menggandakan jurnal', async () => {
    const { db } = buatDb();
    const buffer = await bufferDari(
      grup('G-REIMPOR', '2026-03-10', 'Impor ulang', [D('1001', 10_000), K('4005', 10_000)], {
        no_bukti: 'JU-2026-0200',
      }),
    );

    const pertama = await parseImporExcel(buffer, { namaFile: 'sama.xlsx' });
    const imporPertama = imporJurnalDariExcel(db, pertama, { namaFile: 'sama.xlsx' });
    expect(imporPertama.ringkasan.jurnalDibuat).toBe(1);
    expect(listJurnal(db)).toHaveLength(1);
    expect(listJurnal(db)[0]!.no_bukti).toBe('JU-2026-0200');

    const kedua = await parseImporExcel(buffer, { namaFile: 'sama.xlsx' });
    const preview = validasiImporDariExcel(db, kedua);
    expect(preview.grup[0]!.status).toBe('GAGAL');
    expect(preview.grup[0]!.alasan).toContain(PESAN_NOMOR_BUKTI_DIPAKAI);
    expect(preview.baris.every((b) => b.status === 'GAGAL')).toBe(true);

    const imporKedua = imporJurnalDariExcel(db, preview, { namaFile: 'sama.xlsx' });
    expect(imporKedua.ringkasan.jurnalDibuat).toBe(0);
    expect(imporKedua.ringkasan.grupBerhasil).toBe(0);
    expect(imporKedua.grup[0]!.status).toBe('GAGAL');
    expect(imporKedua.grup[0]!.alasan).toContain(PESAN_NOMOR_BUKTI_DIPAKAI);
    expect(listJurnal(db)).toHaveLength(1);
  });

  it('mengizinkan nomor bukti yang sama di tahun berbeda', async () => {
    const { db } = buatDb();
    const tahun2025 = await parse(
      grup('G-2025', '2025-06-01', 'Tahun 2025', [D('1001', 10_000), K('4005', 10_000)], {
        no_bukti: 'JU-LINTAS-0001',
      }),
    );
    const impor2025 = imporJurnalDariExcel(db, tahun2025, { namaFile: '2025.xlsx' });
    expect(impor2025.ringkasan.jurnalDibuat).toBe(1);

    const tahun2026 = await parse(
      grup('G-2026', '2026-06-01', 'Tahun 2026', [D('1001', 10_000), K('4005', 10_000)], {
        no_bukti: 'JU-LINTAS-0001',
      }),
    );
    const preview2026 = validasiImporDariExcel(db, tahun2026);
    expect(preview2026.grup[0]!.status).toBe('OK');

    const impor2026 = imporJurnalDariExcel(db, preview2026, { namaFile: '2026.xlsx' });
    expect(impor2026.ringkasan.jurnalDibuat).toBe(1);
    expect(listJurnal(db)).toHaveLength(2);
    expect(listJurnal(db).map((j) => j.no_bukti)).toEqual([
      'JU-LINTAS-0001',
      'JU-LINTAS-0001',
    ]);
  });

  it('menolak grup pada periode terkunci dengan alasan yang jelas', async () => {
    const { db } = buatDb();
    insertTutupBuku(db, {
      tahun: 2025,
      created_at: '2026-01-01T00:00:00.000Z',
      backup_path: '',
      catatan: 'Tahun 2025 sudah ditutup',
    });
    const hasil = await parse(
      grup('G-2025', '2025-03-01', 'Jurnal tahun lalu', [
        D('1001', 10_000),
        K('4005', 10_000),
      ]),
    );
    expect(hasil.ringkasan.grupValid).toBe(1);
    const impor = imporJurnalDariExcel(db, hasil, { namaFile: 'terkunci.xlsx' });
    expect(impor.ringkasan.jurnalDibuat).toBe(0);
    expect(impor.grup[0]!.status).toBe('GAGAL');
    expect(impor.grup[0]!.alasan).toMatch(/periode sudah ditutup/i);
    expect(listJurnal(db)).toHaveLength(0);
  });

  it('kas minus gagal tanpa konfirmasi, berhasil setelah konfirmasi operator', async () => {
    const { db } = buatDb();
    const rows = grup('G-KAS', '2026-07-01', 'Bayar dari kas kosong', [
      D('5010', 10_000),
      K('1001', 10_000),
    ]);
    const hasil = await parse(rows);

    const tanpa = imporJurnalDariExcel(db, hasil, { namaFile: 'kas.xlsx' });
    expect(tanpa.ringkasan.jurnalDibuat).toBe(0);
    expect(tanpa.grup[0]!.perluKonfirmasi).toBe(true);
    expect(tanpa.grup[0]!.alasan).toMatch(/konfirmasi/i);
    expect(listJurnal(db)).toHaveLength(0);

    const dengan = imporJurnalDariExcel(db, hasil, {
      namaFile: 'kas.xlsx',
      konfirmasiPeringatan: true,
    });
    expect(dengan.ringkasan.jurnalDibuat).toBe(1);
    expect(dengan.grup[0]!.status).toBe('OK');
    expect(listJurnal(db)).toHaveLength(1);
  });

  it('jurnal 1050 tanpa pihak minta konfirmasi agar tidak drift diam-diam', async () => {
    const { db } = buatDb();
    const hasil = await parse(
      grup('G-PIUTANG', '2026-02-01', 'Pinjaman tanpa pihak', [
        D('1050', 10_000),
        K('1001', 10_000),
      ]),
    );

    const preview = validasiImporDariExcel(db, hasil);
    expect(preview.grup[0]!.status).toBe('OK');
    expect(preview.grup[0]!.peringatan?.join(' ')).toMatch(
      /belum teralokasi di Piutang & Hutang/i,
    );
    expect(preview.grup[0]!.perluKonfirmasi).toBe(true);

    const tanpa = imporJurnalDariExcel(db, preview, { namaFile: 'pihak.xlsx' });
    expect(tanpa.ringkasan.jurnalDibuat).toBe(0);
    expect(tanpa.grup[0]!.perluKonfirmasi).toBe(true);
    expect(tanpa.grup[0]!.alasan).toMatch(/belum teralokasi/i);
    expect(listJurnal(db)).toHaveLength(0);

    const dengan = imporJurnalDariExcel(db, preview, {
      namaFile: 'pihak.xlsx',
      konfirmasiPeringatan: true,
    });
    expect(dengan.ringkasan.jurnalDibuat).toBe(1);
    expect(dengan.grup[0]!.status).toBe('OK');
    expect(dengan.grup[0]!.peringatan?.join(' ')).toMatch(
      /belum teralokasi di Piutang & Hutang/i,
    );
    expect(listJurnal(db)).toHaveLength(1);
  });
});
