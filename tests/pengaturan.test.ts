// P1-13 — pengaturan pembukuan: model murni, repository + audit, nomor bukti
// mengikuti prefix/padding, dan kop laporan (XLSX + HTML/PDF).
// Tanpa Electron/jsdom.
import Database from 'better-sqlite3';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  getJurnal,
  getPengaturan,
  getPengaturanPembukuan,
  insertJurnalTervalidasi,
  KUNCI_AKUNTANSI_AWAL_TAHUN,
  listAuditLog,
  saranNomorBukti,
  setPengaturan,
  simpanPengaturanPembukuan,
} from '../src/db/repository.js';
import { setupPin } from '../src/main/kunci.js';
import {
  AWAL_TAHUN_BUKU_DIDUKUNG,
  DEFAULT_PENGATURAN,
  PESAN_AWAL_TAHUN_BUKU_FISKAL,
  kopDariPengaturan,
  normalisasiPengaturan,
  peringatanAwalTahunBukuLama,
  rentangTahunBuku,
  tanggalMulaiEfektif,
  validasiPengaturan,
  type PengaturanPembukuan,
} from '../src/core/pengaturan.js';
import { formatNomorBukti } from '../src/core/nomorBukti.js';
import {
  KOP_ORG_NAMA,
  jurnalDaftarToHtml,
  jurnalToWorkbook,
  type JurnalTampil,
} from '../src/features/export/workbooks.js';
import { jurnalPrintDoc } from '../src/features/export/printAdapters.js';
import { renderPrintHtml } from '../src/features/export/printDoc.js';
import { validasiBentukPengaturanPembukuan } from '../src/main/validation.js';
import {
  BidangAwalTahunBuku,
  PeringatanAwalTahunBuku,
} from '../src/renderer/components/PengaturanTab.js';

const pasangan = (debit: string, kredit: string, nominal = 100_000) => [
  { akun_kode: debit, debit: nominal, kredit: 0 },
  { akun_kode: kredit, debit: 0, kredit: nominal },
];

const jurnalUji: JurnalTampil[] = [
  {
    id: 'j-uji',
    tanggal: '2026-01-02',
    no_bukti: 'JU-2026-0001',
    keterangan: 'Uji kop',
    jenis: 'TERIMA',
    baris: [
      { akun_kode: '1001', debit: 100_000, kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: 100_000 },
    ],
  },
];

function dbKosong(): Database.Database {
  return openDb(':memory:');
}

describe('P1-13 — model pengaturan pembukuan', () => {
  it('default lengkap terbaca saat DB kosong', () => {
    const db = dbKosong();
    try {
      expect(getPengaturanPembukuan(db)).toEqual(DEFAULT_PENGATURAN);
      expect(DEFAULT_PENGATURAN).toEqual({
        namaEntitas: 'PURA DALEM PURI PELIATAN',
        kopTambahan: '',
        tanggalMulaiPembukuan: '',
        awalTahunBuku: 1,
        prefixNomorBukti: 'JU',
        paddingNomorBukti: 4,
      });
    } finally {
      db.close();
    }
  });

  it('menormalkan spasi, huruf prefix, dan tipe angka', () => {
    expect(
      normalisasiPengaturan({
        namaEntitas: '  PURA   UJI  ',
        kopTambahan: '  Jl. A  \r\n  Desa B  ',
        tanggalMulaiPembukuan: ' 2026-01-02 ',
        awalTahunBuku: '7',
        prefixNomorBukti: ' bkm ',
        paddingNomorBukti: '5',
      }),
    ).toEqual({
      namaEntitas: 'PURA UJI',
      kopTambahan: 'Jl. A\nDesa B',
      tanggalMulaiPembukuan: '2026-01-02',
      awalTahunBuku: 7,
      prefixNomorBukti: 'BKM',
      paddingNomorBukti: 5,
    });
  });

  it('menolak prefix, padding, awal tahun buku fiskal, dan tanggal kalender yang salah', () => {
    const kasus: { input: Partial<PengaturanPembukuan>; pola: RegExp }[] = [
      { input: { prefixNomorBukti: 'JU/' }, pola: /Prefix nomor bukti/ },
      { input: { prefixNomorBukti: '' }, pola: /Prefix nomor bukti/ },
      { input: { paddingNomorBukti: 2 }, pola: /digit nomor bukti/ },
      { input: { paddingNomorBukti: 7 }, pola: /digit nomor bukti/ },
      { input: { awalTahunBuku: 0 }, pola: /Tahun buku fiskal belum didukung/ },
      { input: { awalTahunBuku: 7 }, pola: /Tahun buku fiskal belum didukung/ },
      { input: { awalTahunBuku: 13 }, pola: /Tahun buku fiskal belum didukung/ },
      { input: { tanggalMulaiPembukuan: '2026-02-31' }, pola: /Tanggal mulai/ },
      { input: { kopTambahan: 'a\nb\nc' }, pola: /2 baris/ },
      { input: { kopTambahan: 'x'.repeat(161) }, pola: /160 karakter/ },
    ];
    for (const { input, pola } of kasus) {
      const errors = validasiPengaturan({ ...DEFAULT_PENGATURAN, ...input });
      expect(errors.join(' '), JSON.stringify(input)).toMatch(pola);
    }
    expect(validasiPengaturan(DEFAULT_PENGATURAN)).toEqual([]);
  });

  it('hanya menerima awal tahun buku Januari (1), termasuk dari form string', () => {
    expect(AWAL_TAHUN_BUKU_DIDUKUNG).toBe(1);
    expect(validasiPengaturan({ ...DEFAULT_PENGATURAN, awalTahunBuku: 1 })).toEqual([]);
    expect(validasiPengaturan({ ...DEFAULT_PENGATURAN, awalTahunBuku: '1' })).toEqual([]);
    expect(
      validasiPengaturan({ ...DEFAULT_PENGATURAN, awalTahunBuku: 7 }),
    ).toEqual([PESAN_AWAL_TAHUN_BUKU_FISKAL]);
    expect(PESAN_AWAL_TAHUN_BUKU_FISKAL).toMatch(/Januari/);
    expect(PESAN_AWAL_TAHUN_BUKU_FISKAL).toMatch(/fiskal belum didukung/);
  });

  it('rentang tahun buku benar untuk awal Januari dan Desember (lintas tahun)', () => {
    expect(rentangTahunBuku(2026, 1)).toEqual({
      mulai: '2026-01-01',
      sampai: '2026-12-31',
    });
    expect(rentangTahunBuku(2026, 12)).toEqual({
      mulai: '2026-12-01',
      sampai: '2027-11-30',
    });
    expect(rentangTahunBuku(2026, 7)).toEqual({
      mulai: '2026-07-01',
      sampai: '2027-06-30',
    });
    expect(() => rentangTahunBuku(2026, 13)).toThrow(/Awal tahun buku/);
  });

  it('tanggalMulaiEfektif memakai hari ini hanya bila belum diisi', () => {
    expect(tanggalMulaiEfektif({ tanggalMulaiPembukuan: '' }, '2026-10-23')).toBe(
      '2026-10-23',
    );
    expect(tanggalMulaiEfektif({ tanggalMulaiPembukuan: '2026-01-02' }, '2026-10-23')).toBe(
      '2026-01-02',
    );
    expect(tanggalMulaiEfektif('', '2026-10-23')).toBe('2026-10-23');
  });
});

describe('P1-13 — simpan/baca + audit', () => {
  it('validasi bentuk IPC menolak objek mentah yang salah dan menormalkan yang benar', () => {
    expect(validasiBentukPengaturanPembukuan(null).ok).toBe(false);
    expect(validasiBentukPengaturanPembukuan('teks').ok).toBe(false);
    expect(
      validasiBentukPengaturanPembukuan({
        ...DEFAULT_PENGATURAN,
        paddingNomorBukti: 7,
      }).ok,
    ).toBe(false);

    const hasil = validasiBentukPengaturanPembukuan({
      ...DEFAULT_PENGATURAN,
      namaEntitas: ' pura uji ',
      prefixNomorBukti: 'bkm',
    });
    expect(hasil.ok).toBe(true);
    if (hasil.ok) {
      expect(hasil.input.namaEntitas).toBe('pura uji');
      expect(hasil.input.prefixNomorBukti).toBe('BKM');
    }
  });

  it('menyimpan lalu membaca ulang nilai lengkap', () => {
    const db = dbKosong();
    try {
      const baru: PengaturanPembukuan = {
        ...DEFAULT_PENGATURAN,
        namaEntitas: 'PURA UJI',
        kopTambahan: 'Jl. Uji 1\nDesa Uji',
        tanggalMulaiPembukuan: '2026-01-02',
        awalTahunBuku: 1,
        prefixNomorBukti: 'BKM',
        paddingNomorBukti: 5,
      };
      expect(simpanPengaturanPembukuan(db, baru)).toEqual(baru);
      expect(getPengaturanPembukuan(db)).toEqual(baru);
    } finally {
      db.close();
    }
  });

  it('DB lama berisi awal tahun 7 tidak diubah otomatis dan bisa disimpan ulang ke 1', () => {
    const db = dbKosong();
    try {
      setPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN, '7');

      const lama = getPengaturanPembukuan(db);
      expect(lama.awalTahunBuku).toBe(7);
      expect(getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN)).toBe('7');
      expect(peringatanAwalTahunBukuLama(lama.awalTahunBuku)).toMatch(/bulan 7/);
      expect(validasiPengaturan(lama)).toEqual([PESAN_AWAL_TAHUN_BUKU_FISKAL]);

      // Simpan tanpa mengubah 7 harus ditolak; DB tetap 7 (tidak auto-migrasi).
      expect(() => simpanPengaturanPembukuan(db, lama)).toThrow(
        /Tahun buku fiskal belum didukung/,
      );
      expect(getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN)).toBe('7');

      expect(
        simpanPengaturanPembukuan(db, { ...lama, awalTahunBuku: 1 }),
      ).toEqual(DEFAULT_PENGATURAN);
      expect(getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN)).toBe('1');
      expect(getPengaturanPembukuan(db)).toEqual(DEFAULT_PENGATURAN);
    } finally {
      db.close();
    }
  });

  it('menulis tepat 1 audit PENGATURAN-PEMBUKUAN dengan data lama/baru tanpa PIN', () => {
    const db = dbKosong();
    try {
      expect(setupPin(db, '123456')).toBeNull();
      const hash = getPengaturan(db, 'pin_hash')!;
      const sebelum = listAuditLog(db).length;
      const baru = {
        ...DEFAULT_PENGATURAN,
        namaEntitas: 'PURA UJI',
        prefixNomorBukti: 'KK',
        paddingNomorBukti: 6,
      };
      simpanPengaturanPembukuan(db, baru);

      const rows = listAuditLog(db);
      expect(rows.length).toBe(sebelum + 1);
      const audit = rows[0]!;
      expect(audit.aksi).toBe('PENGATURAN-PEMBUKUAN');
      expect(JSON.parse(audit.data_lama_json)).toEqual(DEFAULT_PENGATURAN);
      expect(JSON.parse(audit.data_baru_json)).toEqual(baru);

      const teks = `${audit.data_lama_json} ${audit.data_baru_json}`;
      expect(teks).not.toContain(hash);
      for (const rahasia of ['pin_hash', 'pin_salt', '123456']) {
        expect(teks).not.toContain(rahasia);
      }
    } finally {
      db.close();
    }
  });

  it('menolak input tidak sah tanpa menyimpan apa pun', () => {
    const db = dbKosong();
    try {
      expect(() =>
        simpanPengaturanPembukuan(db, {
          ...DEFAULT_PENGATURAN,
          paddingNomorBukti: 9,
        }),
      ).toThrow(/digit nomor bukti/);
      expect(getPengaturanPembukuan(db)).toEqual(DEFAULT_PENGATURAN);
      expect(listAuditLog(db)).toEqual([]);
    } finally {
      db.close();
    }
  });
});

describe('P1-13 — nomor bukti mengikuti prefix/padding', () => {
  it('memakai prefix & padding kustom, tetap unik/urut; nomor lama tidak berubah', () => {
    const db = dbKosong();
    try {
      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        prefixNomorBukti: 'BKM',
        paddingNomorBukti: 3,
      });
      expect(saranNomorBukti(db, '2026-01-02')).toBe('BKM-2026-001');

      const j1 = insertJurnalTervalidasi(
        db,
        { id: 'j1', tanggal: '2026-01-02', keterangan: 'Masuk 1' },
        pasangan('1001', '4005'),
      );
      const j2 = insertJurnalTervalidasi(
        db,
        { id: 'j2', tanggal: '2026-01-03', keterangan: 'Masuk 2' },
        pasangan('1001', '4005'),
      );
      expect([j1.no_bukti, j2.no_bukti]).toEqual(['BKM-2026-001', 'BKM-2026-002']);

      // Ganti prefix: pencarian urutan mulai dari prefix baru (bukan menimpa
      // nomor lama).
      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        prefixNomorBukti: 'KK',
        paddingNomorBukti: 4,
      });
      expect(saranNomorBukti(db, '2026-02-01')).toBe('KK-2026-0001');
      const j3 = insertJurnalTervalidasi(
        db,
        { id: 'j3', tanggal: '2026-02-01', keterangan: 'Masuk 3' },
        pasangan('1001', '4005'),
      );
      expect(j3.no_bukti).toBe('KK-2026-0001');
      expect(getJurnal(db, 'j1')!.no_bukti).toBe('BKM-2026-001');
      expect(getJurnal(db, 'j2')!.no_bukti).toBe('BKM-2026-002');

      // Kembali ke BKM: lanjut dari max BKM yang sudah ada.
      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        prefixNomorBukti: 'BKM',
        paddingNomorBukti: 3,
      });
      expect(saranNomorBukti(db, '2026-03-01')).toBe('BKM-2026-003');

      const semua = db
        .prepare('SELECT no_bukti FROM jurnal ORDER BY rowid')
        .all() as { no_bukti: string }[];
      expect(new Set(semua.map((r) => r.no_bukti)).size).toBe(semua.length);
    } finally {
      db.close();
    }
  });

  it('formatNomorBukti mendukung padding 3–6 tanpa memotong urutan besar', () => {
    expect(formatNomorBukti(2026, 1, 'BKM', 3)).toBe('BKM-2026-001');
    expect(formatNomorBukti(2026, 1, 'KK', 6)).toBe('KK-2026-000001');
    expect(formatNomorBukti(2026, 10_000, 'KK', 6)).toBe('KK-2026-010000');
    expect(() => formatNomorBukti(2026, 1, 'JU/', 4)).toThrow(/Prefix nomor bukti/);
    expect(() => formatNomorBukti(2026, 1, 'JU', 7)).toThrow(/digit nomor bukti/);
  });

  it('memperbesar padding tetap melanjutkan urutan lama (tidak mundur)', () => {
    const db = dbKosong();
    try {
      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        prefixNomorBukti: 'BKM',
        paddingNomorBukti: 3,
      });
      insertJurnalTervalidasi(
        db,
        { id: 'jp1', tanggal: '2026-01-02', keterangan: 'Masuk 1' },
        pasangan('1001', '4005'),
      );
      insertJurnalTervalidasi(
        db,
        { id: 'jp2', tanggal: '2026-01-03', keterangan: 'Masuk 2' },
        pasangan('1001', '4005'),
      );

      simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        prefixNomorBukti: 'BKM',
        paddingNomorBukti: 6,
      });
      expect(saranNomorBukti(db, '2026-02-01')).toBe('BKM-2026-000003');
    } finally {
      db.close();
    }
  });
});

describe('P1-13 — kop laporan memakai pengaturan tersimpan', () => {
  it('builder XLSX memakai nama entitas + kop tambahan, default tetap lama', async () => {
    const db = dbKosong();
    try {
      const p = simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        namaEntitas: 'PURA UJI',
        kopTambahan: 'Jl. Uji 1\nDesa Uji',
      });
      const kop = kopDariPengaturan(p);
      const wb = await jurnalToWorkbook(jurnalUji, [], { kop });
      const ws = wb.worksheets[0]!;
      expect(ws.getRow(1).getCell(1).value).toBe('PURA UJI');
      expect(ws.getRow(2).getCell(1).value).toBe('Jl. Uji 1');
      expect(ws.getRow(3).getCell(1).value).toBe('Desa Uji');
      expect(ws.getRow(4).getCell(1).value).toBe('JURNAL UMUM');

      const wbDefault = await jurnalToWorkbook(jurnalUji);
      expect(wbDefault.worksheets[0]!.getRow(1).getCell(1).value).toBe(KOP_ORG_NAMA);
    } finally {
      db.close();
    }
  });

  it('renderPrintHtml (pratinjau/PDF) memakai nama entitas + kop tambahan', () => {
    const db = dbKosong();
    try {
      const p = simpanPengaturanPembukuan(db, {
        ...DEFAULT_PENGATURAN,
        namaEntitas: 'PURA UJI',
        kopTambahan: 'Jl. Uji 1\nDesa Uji',
      });
      const kop = kopDariPengaturan(p);
      const doc = jurnalPrintDoc(jurnalUji, [], {
        kop,
        tanggalCetak: '2026-10-23',
      });
      const html = renderPrintHtml(doc);
      expect(html).toContain('PURA UJI');
      expect(html).toContain('Jl. Uji 1');
      expect(html).toContain('Desa Uji');
      expect(html).not.toContain(KOP_ORG_NAMA);

      const htmlLama = jurnalDaftarToHtml(jurnalUji, []);
      expect(htmlLama).toContain(KOP_ORG_NAMA);
      expect(htmlLama).not.toContain('PURA UJI');
    } finally {
      db.close();
    }
  });
});

describe('AUD-20 — UI awal tahun buku terkunci Januari', () => {
  it('menampilkan Januari (tahun kalender) tanpa pilihan 1–12', () => {
    const html = renderToStaticMarkup(createElement(BidangAwalTahunBuku));
    expect(html).toContain('Awal tahun buku');
    expect(html).toContain('Januari (tahun kalender)');
    expect(html).toContain('Tahun buku fiskal');
    expect(html).not.toContain('Februari');
    expect(html).not.toContain('<select');
  });

  it('memperingatkan data lama bulan 7 dan meminta simpan ulang, tanpa mengubah data', () => {
    const html = renderToStaticMarkup(
      createElement(PeringatanAwalTahunBuku, { awalTahunBuku: 7 }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('bulan 7');
    expect(html).toContain('Simpan Pengaturan Pembukuan');
    expect(html).toContain('tidak diubah otomatis');
    expect(
      renderToStaticMarkup(
        createElement(PeringatanAwalTahunBuku, { awalTahunBuku: 1 }),
      ),
    ).toBe('');
  });
});
