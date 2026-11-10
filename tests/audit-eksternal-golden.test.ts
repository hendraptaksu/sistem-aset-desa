// Audit eksternal — adaptasi checklist "golden standard" ke sistem ini.
//
// Yang diuji (sesuai konteks aplikasi):
// - Rupiah disimpan sebagai integer SEN, bukan float.
// - Tidak ada modul pajak/penjualan; contoh "sales tax" diganti jurnal
//   multi-baris biasa (aset + pendapatan + kewajiban).
// - Tanggal bisnis adalah tanggal kalender WITA (Asia/Makassar), bukan UTC.
// - Jurnal tersimpan bersifat immutable; koreksi memakai reversal.
// - SQLite berjalan sinkron dalam satu proses Electron, jadi "dua jendela
//   bersamaan" diuji sebagai dua posting berurutan yang tidak saling menimpa.
// - Refresh form tidak boleh menyimpan setengah jurnal; transaksi DB diuji
//   rollback total saat penulisan baris gagal di tengah jalan.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buatJurnalTerimaUang } from '../src/core/forms.js';
import {
  validasiJurnal,
  type AkunPosting,
  type PostingContext,
} from '../src/core/posting.js';
import { labaRugi, neracaSaldo, saldoAkun } from '../src/core/reports.js';
import { COA } from '../src/db/coa.js';
import { openDb } from '../src/db/database.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { postingJurnal } from '../src/db/posting.js';
import { getJurnalDetail } from '../src/db/repository.js';
import { reverseJurnal } from '../src/db/reversal.js';
import { parseCurrencyInput } from '../src/renderer/components/ui.js';
import { formatRp, parseRupiahToSen } from '../src/utils/format.js';
import { periodeBerjalan, tanggalLokal } from '../src/utils/tanggal.js';

const RP = (rupiah: number): number => rupiah * 100;
const SEKARANG = '2026-12-31';
const AKUN: AkunPosting[] = COA.map((a) => ({ ...a, aktif: true }));
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'pura-audit-eksternal-'));
  dirs.push(dir);
  return openDb(join(dir, 'pura.db'));
}

function konteks(over: Partial<PostingContext> = {}): PostingContext {
  return {
    akun: AKUN,
    tutupBuku: [],
    noBuktiTerpakai: [],
    saldoKas: {},
    ...over,
  };
}

/** Jurnal sederhana D kas / K pendapatan parkir. */
function postingPendapatan(
  db: ReturnType<typeof openDb>,
  id: string,
  tanggal: string,
  nominal: number,
  noBukti?: string,
) {
  return postingJurnal(
    db,
    {
      header: {
        id,
        tanggal,
        keterangan: `Uji ${id}`,
        ...(noBukti ? { no_bukti: noBukti } : {}),
      },
      baris: [
        { akun_kode: '1001', debit: nominal, kredit: 0 },
        { akun_kode: '4005', debit: 0, kredit: nominal },
      ],
    },
    { sekarang: SEKARANG },
  );
}

function jumlahTabel(db: ReturnType<typeof openDb>, tabel: 'jurnal' | 'jurnal_baris'): number {
  return Number(
    (db.prepare(`SELECT COUNT(*) AS n FROM ${tabel}`).get() as { n: number }).n,
  );
}

describe('Fase 1 — aturan matematika & akuntansi', () => {
  it('jurnal multi-baris selalu debit = kredit sampai ke sen', () => {
    const db = freshDb();
    try {
      // Analog contoh 500 pendapatan + 50 kewajiban + 550 aset, dalam Rupiah.
      const input = {
        header: {
          id: 'j-multi',
          tanggal: '2026-11-09',
          keterangan: 'Uji jurnal multi-baris',
          jenis: 'UMUM' as const,
        },
        baris: [
          { akun_kode: '1050', debit: RP(550_000), kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(500_000) },
          { akun_kode: '2060', debit: 0, kredit: RP(50_000) },
        ],
      };

      const hasil = postingJurnal(db, input, { sekarang: SEKARANG });
      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);

      const detail = getJurnalDetail(db, 'j-multi');
      const totalDebit = detail!.baris.reduce((s, b) => s + b.debit, 0);
      const totalKredit = detail!.baris.reduce((s, b) => s + b.kredit, 0);
      expect(totalDebit).toBe(RP(550_000));
      expect(totalKredit).toBe(RP(550_000));
      expect(totalDebit - totalKredit).toBe(0);

      const neraca = neracaSaldo(listBarisJurnal(db), SEKARANG);
      expect(neraca.seimbang).toBe(true);
      expect(neraca.selisih).toBe(0);
    } finally {
      db.close();
    }
  });

  it('menolak jurnal yang selisih 1 sen sekalipun', () => {
    const input = {
      header: { id: 'j-pincang', tanggal: '2026-11-09', keterangan: 'Uji pincang' },
      baris: [
        { akun_kode: '1001', debit: RP(550_000), kredit: 0 },
        // Tepat 1 sen lebih kecil, tetap bilangan bulat sen.
        { akun_kode: '4005', debit: 0, kredit: RP(550_000) - 1 },
      ],
    };

    const hasil = validasiJurnal(input, konteks());
    expect(hasil.boleh).toBe(false);
    expect(hasil.errors.join(' ')).toMatch(/tidak seimbang|bilangan bulat/i);
  });

  it('tiga nominal pecahan Rp 10,99 dijumlah tepat Rp 32,97 tanpa drift float', () => {
    const perItem = parseRupiahToSen('10,99');
    expect(perItem).toBe(1099);
    expect(parseCurrencyInput('10,99').sen).toBe(1099);

    // 0,1 + 0,2 = 0,3: dihitung dalam sen, bukan float Rupiah.
    expect(parseRupiahToSen('0,10') + parseRupiahToSen('0,20')).toBe(30);
    expect(formatRp(30)).toBe('Rp 0,30');

    const total = perItem * 3;
    expect(total).toBe(3297);
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(formatRp(total)).toBe('Rp 32,97');

    const db = freshDb();
    try {
      for (let i = 0; i < 3; i += 1) {
        const hasil = postingPendapatan(db, `j-pecahan-${i}`, '2026-03-05', perItem);
        expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      }
      const saldo = saldoAkun(listBarisJurnal(db), '4005');
      expect(saldo).toBe(3297);
      expect(formatRp(saldo)).toBe('Rp 32,97');
    } finally {
      db.close();
    }
  });

  it('menolak nol, negatif, pecahan, teks, dua sisi, dan tanggal kosong/tidak nyata', () => {
    const dasarHeader = { id: 'j-invalid', tanggal: '2026-11-09', keterangan: 'Uji invalid' };
    const kasus: Array<{ baris: unknown[]; pola: RegExp }> = [
      {
        baris: [
          { akun_kode: '1001', debit: 0, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(1_000) },
        ],
        pola: /lebih dari 0/i,
      },
      {
        baris: [
          { akun_kode: '1001', debit: -100, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(1_000) },
        ],
        pola: /bilangan bulat/i,
      },
      {
        baris: [
          { akun_kode: '1001', debit: 10.5, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(1_000) },
        ],
        pola: /bilangan bulat/i,
      },
      {
        baris: [
          { akun_kode: '1001', debit: '100' as unknown as number, kredit: 0 },
          { akun_kode: '4005', debit: 0, kredit: RP(1_000) },
        ],
        pola: /bilangan bulat/i,
      },
      {
        baris: [
          { akun_kode: '1001', debit: 100, kredit: 100 },
          { akun_kode: '4005', debit: 0, kredit: RP(1_000) },
        ],
        pola: /salah satu saja/i,
      },
    ];

    for (const { baris, pola } of kasus) {
      const hasil = validasiJurnal(
        { header: dasarHeader, baris: baris as never },
        konteks(),
      );
      expect(hasil.boleh, `kasus ${pola}`).toBe(false);
      expect(hasil.errors.join(' '), `kasus ${pola}`).toMatch(pola);
    }

    for (const tanggal of ['', '2026-02-31', '2026-13-01', 'bukan-tanggal']) {
      const hasil = validasiJurnal(
        {
          header: { ...dasarHeader, tanggal },
          baris: [
            { akun_kode: '1001', debit: RP(1_000), kredit: 0 },
            { akun_kode: '4005', debit: 0, kredit: RP(1_000) },
          ],
        },
        konteks(),
      );
      expect(hasil.boleh, `tanggal ${tanggal}`).toBe(false);
    }

    // Form builder juga menolak nominal tidak valid sebelum menyentuh DB.
    const formDasar = {
      tanggal: '2026-11-09',
      keterangan: 'Uji form',
      akunKas: '1001',
      akunLawan: '4005',
    };
    for (const nominal of [0, -RP(1), 10.5, Number.NaN]) {
      expect(() =>
        buatJurnalTerimaUang({ ...formDasar, nominal }),
      ).toThrow(/Nominal/);
    }
  });

  it('transaksi 23:59 WITA tanggal 31 Januari masuk periode Januari, bukan Februari', () => {
    // 2026-01-31T15:59:00Z = 2026-01-31 23:59 WITA.
    const akhirJanuari = new Date('2026-01-31T15:59:00Z');
    expect(tanggalLokal(akhirJanuari)).toBe('2026-01-31');
    expect(periodeBerjalan(akhirJanuari).sampai).toBe('2026-01-31');
    // 2026-01-31T16:00:00Z = 2026-02-01 00:00 WITA.
    expect(tanggalLokal(new Date('2026-01-31T16:00:00Z'))).toBe('2026-02-01');

    const db = freshDb();
    try {
      // Tanggal jurnal adalah tanggal bisnis WITA, tanpa konversi UTC.
      const jan = postingPendapatan(db, 'j-jan', tanggalLokal(akhirJanuari), RP(100_000));
      const feb = postingPendapatan(db, 'j-feb', '2026-02-01', RP(200_000));
      expect(jan.tersimpan, jan.errors.join(' ')).toBe(true);
      expect(feb.tersimpan, feb.errors.join(' ')).toBe(true);

      const baris = listBarisJurnal(db);
      const laporanJan = labaRugi(baris, { mulai: '2026-01-01', sampai: '2026-01-31' });
      const laporanFeb = labaRugi(baris, { mulai: '2026-02-01', sampai: '2026-02-28' });
      expect(laporanJan.totalPendapatan).toBe(RP(100_000));
      expect(laporanFeb.totalPendapatan).toBe(RP(200_000));
    } finally {
      db.close();
    }
  });
});

describe('Fase 2 — keamanan & integritas data', () => {
  it('jurnal lama tidak bisa diedit/dihapus; koreksi memakai jurnal balik', () => {
    const db = freshDb();
    try {
      const asli = postingPendapatan(db, 'j-asli', '2026-01-15', RP(100_000));
      expect(asli.tersimpan, asli.errors.join(' ')).toBe(true);

      expect(() =>
        db.prepare("UPDATE jurnal SET keterangan = 'Diubah' WHERE id = 'j-asli'").run(),
      ).toThrow(/tidak boleh diubah/i);
      expect(() =>
        db.prepare("DELETE FROM jurnal WHERE id = 'j-asli'").run(),
      ).toThrow(/tidak boleh dihapus/i);
      expect(() =>
        db
          .prepare("UPDATE jurnal_baris SET keterangan = 'Diubah' WHERE jurnal_id = 'j-asli'")
          .run(),
      ).toThrow(/tidak boleh diubah/i);
      expect(() =>
        db.prepare("DELETE FROM jurnal_baris WHERE jurnal_id = 'j-asli'").run(),
      ).toThrow(/tidak boleh dihapus/i);

      const balik = reverseJurnal(db, 'j-asli', 'Salah catat nominal', {
        id: 'j-balik-asli',
        tanggal: '2026-01-16',
      });
      expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);
      expect(getJurnalDetail(db, 'j-asli')?.jurnal.keterangan).toBe('Uji j-asli');
      expect(saldoAkun(listBarisJurnal(db), '4005')).toBe(0);

      const balikLagi = reverseJurnal(db, 'j-asli', 'Coba koreksi dua kali', {
        tanggal: '2026-01-17',
      });
      expect(balikLagi.tersimpan).toBe(false);
      expect(balikLagi.errors.join(' ')).toMatch(/sudah pernah dikoreksi/i);
    } finally {
      db.close();
    }
  });

  it('periode terkunci menolak jurnal tanpa alasan, menerima dengan alasan', () => {
    const db = freshDb();
    try {
      db.prepare(
        "INSERT INTO tutup_buku (tahun, created_at, catatan) VALUES (2025, ?, 'Uji kunci')",
      ).run('2026-01-01T00:00:00.000Z');

      const tanpaAlasan = postingPendapatan(db, 'j-terkunci-1', '2025-12-31', RP(10_000));
      expect(tanpaAlasan.tersimpan).toBe(false);
      expect(tanpaAlasan.errors.join(' ')).toMatch(/Periode sudah ditutup/i);

      const denganAlasan = postingJurnal(
        db,
        {
          header: {
            id: 'j-terkunci-2',
            tanggal: '2025-12-31',
            keterangan: 'Koreksi dari audit',
          },
          baris: [
            { akun_kode: '1001', debit: RP(10_000), kredit: 0 },
            { akun_kode: '4005', debit: 0, kredit: RP(10_000) },
          ],
          alasan: 'Koreksi dari audit',
        },
        { sekarang: SEKARANG },
      );
      expect(denganAlasan.tersimpan, denganAlasan.errors.join(' ')).toBe(true);
    } finally {
      db.close();
    }
  });

  it('dua pembuatan berurutan tidak saling menimpa dan punya ID/nomor bukti berbeda', () => {
    const db = freshDb();
    try {
      const a = buatJurnalTerimaUang({
        tanggal: '2026-01-20',
        keterangan: 'Transaksi A',
        akunKas: '1001',
        akunLawan: '4005',
        nominal: RP(10_000),
      });
      const b = buatJurnalTerimaUang({
        tanggal: '2026-01-20',
        keterangan: 'Transaksi B',
        akunKas: '1001',
        akunLawan: '4005',
        nominal: RP(20_000),
      });
      expect(a.header.id).not.toBe(b.header.id);

      const hasilA = postingJurnal(db, a, { sekarang: SEKARANG });
      const hasilB = postingJurnal(db, b, { sekarang: SEKARANG });
      expect(hasilA.tersimpan, hasilA.errors.join(' ')).toBe(true);
      expect(hasilB.tersimpan, hasilB.errors.join(' ')).toBe(true);
      expect(hasilA.jurnal?.no_bukti).not.toBe(hasilB.jurnal?.no_bukti);
      expect(hasilA.jurnal?.id).not.toBe(hasilB.jurnal?.id);
      expect(jumlahTabel(db, 'jurnal')).toBe(2);
      expect(saldoAkun(listBarisJurnal(db), '4005')).toBe(RP(30_000));

      // Nomor bukti duplikat di tahun yang sama tetap ditolak.
      const dup = postingPendapatan(db, 'j-dup', '2026-01-21', RP(1_000), hasilA.jurnal!.no_bukti);
      expect(dup.tersimpan).toBe(false);
      expect(dup.errors.join(' ')).toMatch(/sudah dipakai/i);
    } finally {
      db.close();
    }
  });

  it('kegagalan di tengah penulisan baris membatalkan seluruh jurnal (tanpa setengah data)', () => {
    const db = freshDb();
    try {
      // Simulasi gangguan saat baris kedua ditulis; posting harus rollback total.
      db.exec(`
        CREATE TRIGGER uji_gagal_tengah_transaksi
        BEFORE INSERT ON jurnal_baris
        WHEN NEW.akun_kode = '4005'
        BEGIN
          SELECT RAISE(ABORT, 'uji kegagalan tengah transaksi');
        END;
      `);

      const gagal = postingPendapatan(db, 'j-rollback', '2026-01-22', RP(15_000));
      expect(gagal.tersimpan).toBe(false);
      expect(gagal.errors.join(' ')).toMatch(/uji kegagalan tengah transaksi/i);
      expect(jumlahTabel(db, 'jurnal')).toBe(0);
      expect(jumlahTabel(db, 'jurnal_baris')).toBe(0);
    } finally {
      db.close();
    }
  });
});
