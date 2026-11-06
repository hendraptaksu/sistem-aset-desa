import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../src/db/database.js';
import { postingJurnal } from '../src/db/posting.js';
import {
  simpanPinjamanLpd, bayarAngsuranPinjaman, getPinjaman,
  batalkanPembayaranPinjaman, batalkanPinjaman, laporanMutasiPinjaman,
  listPinjamanBayar,
} from '../src/db/pinjaman.js';
import {
  reverseJurnal,
  koreksiDanIsiUlang,
  PESAN_REVERSAL_SALDO_AWAL,
} from '../src/db/reversal.js';
import { auditIntegritas } from '../src/db/integritas.js';
import { laporanNeraca, laporanArusKas } from '../src/db/laporan.js';
import { rekonsiliasiPinjaman } from '../src/db/pinjamanRekonsiliasi.js';

const RP = (n: number) => n * 100;
const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach((db) => db.close()));

function fixture() {
  const db = openDb(':memory:');
  dbs.push(db);
  expect(postingJurnal(db, {
    header: { id: 'awal', tanggal: '2025-01-01', jenis: 'SALDO_AWAL', keterangan: 'Kas awal' },
    baris: [
      { akun_kode: '1001', debit: RP(20_000_000), kredit: 0 },
      { akun_kode: '3000', debit: 0, kredit: RP(20_000_000) },
    ],
  }).tersimpan).toBe(true);
  const loan = simpanPinjamanLpd(db, {
    id: 'loan', mode: 'PENCAIRAN', kreditur: 'LPD Uji', tanggal: '2025-02-01',
    akunKas: '1001', pokok: RP(10_000_000), tenor: 1,
    angsuran: [{ ke: 1, jatuh_tempo: '2025-03-01', pokok: RP(10_000_000), bunga: RP(100_000) }],
  });
  expect(loan.tersimpan, loan.errors.join(' ')).toBe(true);
  const angsuranId = loan.pinjaman!.angsuran![0].id;
  function bayar(id: string, pokok = 10_000_000, bunga = 100_000, tanggal = '2025-03-01') {
    return bayarAngsuranPinjaman(db, {
      id, jurnal_id: `j-${id}`, pinjaman_id: 'loan', angsuran_id: angsuranId,
      tanggal, akun_kas: '1001', pokok: RP(pokok), bunga: RP(bunga), denda: 0,
    });
  }
  return { db, loan, bayar, angsuranId };
}

function jumlahJurnal(db: Database.Database) {
  return (db.prepare('SELECT COUNT(*) AS n FROM jurnal').get() as { n: number }).n;
}

function harapkanSaldo(db: Database.Database, nominalRp: number) {
  const p = getPinjaman(db, 'loan')!;
  const gl = laporanNeraca(db, '2025-12-31').kewajiban.find((a) => a.kode === '2050')!.saldo;
  expect(p.outstanding).toBe(RP(nominalRp));
  expect(gl).toBe(p.outstanding);
  expect(rekonsiliasiPinjaman(db, 'loan')).toMatchObject({ gl, jadwal: gl, cocok: true });
  expect(auditIntegritas(db)).toMatchObject({ ok: true, temuan: [] });
}

describe('regresi audit — pinjaman dan jurnal tetap konsisten', () => {
  it('menolak reversal dan isi ulang generik untuk pencairan maupun pembayaran', () => {
    const { db, loan, bayar } = fixture();
    expect(bayar('bayar').tersimpan).toBe(true);
    const sebelum = jumlahJurnal(db);
    for (const id of [loan.jurnal!.id, 'j-bayar']) {
      expect(reverseJurnal(db, id, 'Salah pencatatan')).toMatchObject({ tersimpan: false });
      expect(koreksiDanIsiUlang(db, id, 'Salah pencatatan', {
        header: { id: 'pengganti', tanggal: '2025-03-01', keterangan: 'Pengganti', jenis: 'UMUM' },
        baris: [{ akun_kode: '1001', debit: RP(1), kredit: 0 }, { akun_kode: '4008', debit: 0, kredit: RP(1) }],
      }).tersimpan).toBe(false);
    }
    expect(jumlahJurnal(db)).toBe(sebelum);
    harapkanSaldo(db, 0);
  });

  it('bunga saja tetap sebagian; cicilan pokok dapat dilanjutkan sampai lunas', () => {
    const { db, bayar } = fixture();
    expect(bayar('bunga', 0, 100_000).tersimpan).toBe(true);
    expect(getPinjaman(db, 'loan')!.angsuran![0]).toMatchObject({
      status: 'SEBAGIAN', dibayar: false, sisa_pokok: RP(10_000_000), sisa_bunga: 0,
    });
    expect(bayar('pokok1', 4_000_000, 0).tersimpan).toBe(true);
    expect(getPinjaman(db, 'loan')!.angsuran![0]).toMatchObject({ status: 'SEBAGIAN', sisa_pokok: RP(6_000_000) });
    expect(bayar('pokok2', 6_000_000, 0).tersimpan).toBe(true);
    expect(getPinjaman(db, 'loan')!.angsuran).toHaveLength(1);
    expect(getPinjaman(db, 'loan')!.angsuran![0]).toMatchObject({
      status: 'LUNAS', dibayar: true, jumlah_pembayaran: 3, sisa_pokok: 0, sisa_bunga: 0,
      jurnal_id: null,
    });
    const mutasi = laporanMutasiPinjaman(db, 'loan', { periode: '2025-03' });
    expect(mutasi.jadwal[0]).toMatchObject({ pokok_realisasi: RP(10_000_000), bunga_realisasi: RP(100_000), dibayar: true });
    expect(mutasi.total_kas_keluar).toBe(RP(10_100_000));
    harapkanSaldo(db, 0);
  });

  it('pembatalan mengembalikan sisa angsuran, histori tetap ada dan bisa diinput ulang', () => {
    const { db, bayar } = fixture();
    expect(bayar('salah').tersimpan).toBe(true);
    const batal = batalkanPembayaranPinjaman(db, { id: 'salah', alasan: 'Nominal salah dicatat' });
    expect(batal.tersimpan, batal.errors.join(' ')).toBe(true);
    expect(batal.jurnal!.reversal_of).toBe('j-salah');
    expect(batal.jurnal!.tanggal).toBe('2025-03-01');
    expect(listPinjamanBayar(db, 'loan')).toMatchObject([{ id: 'salah', dibatalkan: true }]);
    expect(getPinjaman(db, 'loan')!.angsuran![0]).toMatchObject({ status: 'BELUM', jumlah_pembayaran: 0 });
    const mutasi = laporanMutasiPinjaman(db, 'loan', { periode: '2025-03' });
    expect(mutasi.total_pokok).toBe(0);
    expect(mutasi.total_bunga).toBe(0);
    expect(mutasi.total_kas_keluar).toBe(0);
    expect(mutasi.bulanan[0].pembayaran).toHaveLength(2);
    harapkanSaldo(db, 10_000_000);
    expect(bayar('benar').tersimpan).toBe(true);
    harapkanSaldo(db, 0);
  });

  it('membatalkan pencairan setelah seluruh catatan pembayaran dibatalkan', () => {
    const { db, bayar } = fixture();
    expect(bayar('bayar').tersimpan).toBe(true);
    expect(batalkanPinjaman(db, { id: 'loan', alasan: 'Pencairan ternyata batal' }).tersimpan).toBe(false);
    expect(batalkanPembayaranPinjaman(db, { id: 'bayar', alasan: 'Pembayaran salah dicatat' }).tersimpan).toBe(true);
    const batal = batalkanPinjaman(db, { id: 'loan', alasan: 'Pencairan salah dicatat' });
    expect(batal.tersimpan, batal.errors.join(' ')).toBe(true);
    expect(batal.pinjaman).toMatchObject({ status: 'DIBATALKAN', outstanding: 0 });
    expect(bayar('lagi').tersimpan).toBe(false);
    const jumlah = jumlahJurnal(db);
    expect(batalkanPinjaman(db, { id: 'loan', alasan: 'Pembatalan berulang' }).tersimpan).toBe(false);
    expect(jumlahJurnal(db)).toBe(jumlah);
    expect(laporanMutasiPinjaman(db, 'loan', { periode: '2025-03' }).outstanding).toBe(0);
    const arus = laporanArusKas(db, { mulai: '2025-01-01', sampai: '2025-12-31' });
    expect(arus.kenaikan).toBe(0);
    expect(arus.operasi).toMatchObject({ masuk: 0, keluar: 0 });
    expect(arus.pendanaan).toMatchObject({ masuk: 0, keluar: 0 });
    harapkanSaldo(db, 0);
  });

  it('rollback pembatalan jika pencatatan audit gagal', () => {
    const { db } = fixture();
    db.exec(`CREATE TRIGGER uji_audit_batal BEFORE INSERT ON audit_log
      WHEN NEW.aksi LIKE 'PINJAMAN-BATAL %' BEGIN SELECT RAISE(ABORT, 'uji gagal audit'); END`);
    const jumlah = jumlahJurnal(db);
    const hasil = batalkanPinjaman(db, { id: 'loan', alasan: 'Catatan pencairan salah' });
    expect(hasil.tersimpan).toBe(false);
    expect(jumlahJurnal(db)).toBe(jumlah);
    expect(getPinjaman(db, 'loan')!.status).toBe('AKTIF');
    harapkanSaldo(db, 10_000_000);
  });

  it('menolak pembayaran pokok melebihi sisa tanpa menambah jurnal', () => {
    const { db, bayar } = fixture();
    expect(bayar('sebagian', 6_000_000, 0).tersimpan).toBe(true);
    const jumlah = jumlahJurnal(db);
    expect(bayar('lebih', 5_000_000, 0).errors.join(' ')).toMatch(/melebihi sisa pokok/);
    expect(jumlahJurnal(db)).toBe(jumlah);
    harapkanSaldo(db, 4_000_000);
  });

  it('pembatalan yang membuat kas minus wajib konfirmasi dan alasan nyata', () => {
    const { db } = fixture();
    expect(postingJurnal(db, {
      header: { id: 'belanja', tanggal: '2025-03-01', jenis: 'BAYAR', keterangan: 'Belanja seluruh kas' },
      baris: [
        { akun_kode: '5003', debit: RP(30_000_000), kredit: 0 },
        { akun_kode: '1001', debit: 0, kredit: RP(30_000_000) },
      ],
    }).tersimpan).toBe(true);
    const input = { id: 'loan', alasan: 'Pencairan keliru dicatat' };
    const jumlah = jumlahJurnal(db);
    expect(batalkanPinjaman(db, input)).toMatchObject({ tersimpan: false, perluKonfirmasi: true });
    expect(batalkanPinjaman(db, input, { konfirmasiPeringatan: true }).tersimpan).toBe(false);
    expect(jumlahJurnal(db)).toBe(jumlah);
    expect(batalkanPinjaman(db, input, {
      konfirmasiPeringatan: true, alasanPeringatan: 'Saldo pembukaan akan direkonsiliasi akuntan',
    }).tersimpan).toBe(true);
    const audit = db.prepare("SELECT data_baru_json FROM audit_log WHERE aksi LIKE 'CREATE %' ORDER BY rowid DESC LIMIT 1").get() as { data_baru_json: string };
    expect(audit.data_baru_json).toContain('Saldo pembukaan akan direkonsiliasi akuntan');
  });

  it('retry pembayaran sebagian dengan ID yang sama tidak membuat cicilan ganda', () => {
    const { db, bayar } = fixture();
    expect(bayar('retry', 1_000_000, 0).tersimpan).toBe(true);
    const jumlah = jumlahJurnal(db);
    expect(bayar('retry', 1_000_000, 0).tersimpan).toBe(false);
    expect(jumlahJurnal(db)).toBe(jumlah);
    expect(listPinjamanBayar(db, 'loan')).toHaveLength(1);
    harapkanSaldo(db, 9_000_000);
  });

  it('mutasi per tanggal mengakumulasi cicilan yang sudah terjadi saja', () => {
    const { db, bayar } = fixture();
    expect(bayar('maret', 4_000_000, 100_000).tersimpan).toBe(true);
    expect(bayar('april', 6_000_000, 0, '2025-04-01').tersimpan).toBe(true);
    expect(laporanMutasiPinjaman(db, 'loan', { periode: '2025-03' }).jadwal[0]).toMatchObject({
      pokok_realisasi: RP(4_000_000), bunga_realisasi: RP(100_000), dibayar: false,
    });
    expect(laporanMutasiPinjaman(db, 'loan', { periode: '2025-04' }).jadwal[0]).toMatchObject({
      pokok_realisasi: RP(10_000_000), dibayar: true,
    });
  });

  it('baseline v1: index angsuran non-unique dan pembayaran kedua untuk angsuran sama dapat disimpan', () => {
    const { db, bayar } = fixture();
    expect(bayar('lama', 4_000_000, 100_000).tersimpan).toBe(true);

    const index = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_pinjaman_bayar_angsuran'",
      )
      .get() as { sql: string } | undefined;
    expect(index?.sql).toBeTruthy();
    expect(index!.sql).toMatch(/CREATE INDEX/i);
    expect(index!.sql).not.toMatch(/UNIQUE/i);

    const jumlah = jumlahJurnal(db);
    expect(bayar('lanjutan', 6_000_000, 0).tersimpan).toBe(true);
    expect(jumlahJurnal(db)).toBe(jumlah + 1);
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM jurnal WHERE id IN ('j-lama', 'j-lanjutan')").get(),
    ).toEqual({ n: 2 });
    expect(listPinjamanBayar(db, 'loan')).toHaveLength(2);
    harapkanSaldo(db, 0);
  });

  it('T1.5: koreksi saldo pembukaan lewat jalur umum ditolak; arus kas memakai saldo awal asli', () => {
    const db = openDb(':memory:');
    dbs.push(db);
    const baris = (panjar: number) => [
      { akun_kode: '1001', debit: RP(20_000_000), kredit: 0 },
      { akun_kode: '1040', debit: RP(panjar), kredit: 0 },
      { akun_kode: '2050', debit: 0, kredit: RP(3_000_000) },
      { akun_kode: '2060', debit: 0, kredit: RP(2_000_000) },
      { akun_kode: '3000', debit: 0, kredit: RP(15_000_000 + panjar) },
    ];
    expect(postingJurnal(db, {
      header: { id: 'pembukaan', tanggal: '2025-01-01', jenis: 'SALDO_AWAL', keterangan: 'Pembukaan' },
      baris: baris(1_000_000),
    }).tersimpan).toBe(true);
    const jurnalBiasa = postingJurnal(db, {
      header: { id: 'grup-palsu', tanggal: '2025-01-01', jenis: 'UMUM', grup_id: 'pembukaan', keterangan: 'Grup bukan izin koreksi' },
      baris: baris(2_000_000),
    });
    expect(jurnalBiasa.tersimpan).toBe(false);

    // T1.5: jalur umum tidak boleh membalik SALDO_AWAL. Sampai alur koreksi
    // saldo awal tersedia (T1.7/T1.8), jurnal asli dan laporan tetap utuh.
    const sebelum = jumlahJurnal(db);
    const koreksi = koreksiDanIsiUlang(db, 'pembukaan', 'Saldo panjar sebenarnya dua juta', {
      header: { id: 'pembukaan-benar', tanggal: '2025-01-01', jenis: 'UMUM', keterangan: 'Pembukaan benar' },
      baris: baris(2_000_000),
    });
    expect(koreksi.tersimpan).toBe(false);
    expect(koreksi.errors).toContain(PESAN_REVERSAL_SALDO_AWAL);
    expect(jumlahJurnal(db)).toBe(sebelum);

    const arus = laporanArusKas(db, { mulai: '2025-01-01', sampai: '2025-12-31' });
    expect(arus.saldoAwal).toBe(RP(20_000_000));
    expect(arus.totalMasuk).toBe(0);
    expect(arus.totalKeluar).toBe(0);
    expect(arus.saldoAkhir).toBe(RP(20_000_000));
  });
});
