// T1.7 — koreksi saldo awal (Opsi A).
//
// Fokus pembuktian:
// - Koreksi pertama membalik SALDO_AWAL aktif lalu membuat UMUM pengganti;
//   laporan dan Neraca memakai angka baru, status wizard tetap terkunci.
// - Koreksi berikutnya membalik UMUM pengganti terakhir, bukan SALDO_AWAL dua
//   kali (ux_jurnal_reversal tetap terjaga).
// - Reversal + pengganti + audit + setting tanggal mulai atomik: kegagalan
//   setelah reversal membatalkan seluruh koreksi.
// - Tanggal baru tidak boleh setelah transaksi non-pembukaan paling awal,
//   alasan wajib >=5 karakter, dan reversal generik SALDO_AWAL tetap ditolak.
// - Validasi tanggal tidak salah menolak karena KUNCI lama yang lebih besar.

import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  koreksiSaldoAwal,
  PESAN_ALASAN_KOREKSI_MIN,
  PESAN_KOREKSI_TANPA_SALDO_AWAL,
  simpanSaldoAwal,
  statusSaldoAwal,
} from '../src/db/saldoAwal.js';
import { postingJurnal } from '../src/db/posting.js';
import {
  PESAN_REVERSAL_SALDO_AWAL,
  reverseJurnal,
} from '../src/db/reversal.js';
import {
  getPengaturan,
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  listAuditLog,
  listJurnal,
  setPengaturan,
} from '../src/db/repository.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { buatJurnalSaldoAwal, type FormSaldoAwal } from '../src/core/forms.js';
import { neraca, neracaSaldo, saldoAkun } from '../src/core/reports.js';

const RP = (rupiah: number): number => rupiah * 100;
const SEKARANG = '2026-12-31';

function form(tanggal: string, saldo: FormSaldoAwal['saldo'], id?: string): FormSaldoAwal {
  return {
    ...(id ? { id } : {}),
    tanggal,
    saldo,
  };
}

function siapkanAwal(db: ReturnType<typeof openDb>) {
  const awal = simpanSaldoAwal(
    db,
    buatJurnalSaldoAwal(
      form('2026-01-01', [
        { akun_kode: '1001', nominal: RP(5_000_000) },
        { akun_kode: '2050', nominal: RP(1_000_000) },
      ], 'j-awal'),
    ).input,
  );
  expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
  return awal;
}

describe('T1.7 — koreksi saldo awal sukses', () => {
  it('membalik SALDO_AWAL, membuat UMUM pengganti, dan laporan memakai angka baru', () => {
    const db = openDb(':memory:');
    try {
      siapkanAwal(db);
      const sebelum = listBarisJurnal(db);
      expect(saldoAkun(sebelum, '1001')).toBe(RP(5_000_000));
      expect(saldoAkun(sebelum, '3000')).toBe(RP(4_000_000));

      const hasil = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-01', [
            { akun_kode: '1001', nominal: RP(8_000_000) },
            { akun_kode: '2050', nominal: RP(2_000_000) },
          ]),
        ).input,
        { alasan: 'Salah input saldo awal kas', sekarang: SEKARANG },
      );

      expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      expect(hasil.reversal).toMatchObject({
        jenis: 'REVERSAL',
        reversal_of: 'j-awal',
        grup_id: 'j-awal',
        tanggal: '2026-01-01',
      });
      expect(hasil.jurnal).toMatchObject({
        jenis: 'UMUM',
        peran: 'OPENING_REPLACEMENT',
        replaces_id: 'j-awal',
        reversal_of: null,
        grup_id: 'j-awal',
        tanggal: '2026-01-01',
      });
      expect(hasil.jurnalLama?.id).toBe('j-awal');

      const daftar = listJurnal(db);
      expect(daftar).toHaveLength(3);
      expect(
        daftar.filter((j) => j.jenis === 'SALDO_AWAL'),
      ).toHaveLength(1);
      expect(
        daftar.filter((j) => j.reversal_of === 'j-awal'),
      ).toHaveLength(1);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1001')).toBe(RP(8_000_000));
      expect(saldoAkun(baris, '2050')).toBe(RP(2_000_000));
      expect(saldoAkun(baris, '3000')).toBe(RP(6_000_000));
      const ns = neracaSaldo(baris, SEKARANG);
      expect(ns.selisih).toBe(0);
      expect(ns.seimbang).toBe(true);
      const n = neraca(baris, { cutoff: SEKARANG, tutup: [] });
      expect(n.balance).toBe(true);
      expect(n.totalAset).toBe(RP(8_000_000));
      expect(n.totalPasiva).toBe(RP(8_000_000));

      const audit = listAuditLog(db, { aksi: 'KOREKSI-SALDO-AWAL' });
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        aksi: 'KOREKSI-SALDO-AWAL',
        ref_type: 'jurnal',
        ref_id: 'j-awal',
        alasan: 'Salah input saldo awal kas',
      });
      const lama = JSON.parse(audit[0].data_lama_json) as {
        jurnal: { id: string };
        baris: unknown[];
      };
      const baru = JSON.parse(audit[0].data_baru_json) as {
        jurnal: { id: string };
        reversal: { id: string; reversal_of: string };
      };
      expect(lama.jurnal.id).toBe('j-awal');
      expect(lama.baris.length).toBeGreaterThanOrEqual(2);
      expect(baru.jurnal.id).toBe(hasil.jurnal?.id);
      expect(baru.reversal).toMatchObject({
        id: hasil.reversal?.id,
        reversal_of: 'j-awal',
      });

      const status = statusSaldoAwal(db);
      expect(status.boleh).toBe(false);
      expect(status.jumlahJurnal).toBe(3);
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe(
        '2026-01-01',
      );
    } finally {
      db.close();
    }
  });

  it('koreksi kedua membalik UMUM pengganti terakhir, bukan SALDO_AWAL lagi', () => {
    const db = openDb(':memory:');
    try {
      siapkanAwal(db);
      const pertama = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-01', [
            { akun_kode: '1001', nominal: RP(8_000_000) },
          ]),
        ).input,
        { alasan: 'Koreksi pertama', sekarang: SEKARANG },
      );
      expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);

      const kedua = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-02', [
            { akun_kode: '1001', nominal: RP(7_000_000) },
            { akun_kode: '1029', nominal: RP(1_000_000) },
          ]),
        ).input,
        { alasan: 'Koreksi kedua', sekarang: SEKARANG },
      );
      expect(kedua.tersimpan, kedua.errors.join(' ')).toBe(true);
      expect(kedua.jurnalLama?.id).toBe(pertama.jurnal?.id);
      expect(kedua.jurnalLama?.jenis).toBe('UMUM');
      expect(kedua.reversal?.reversal_of).toBe(pertama.jurnal?.id);
      expect(kedua.reversal?.jenis).toBe('REVERSAL');

      const daftar = listJurnal(db);
      expect(daftar).toHaveLength(5);
      // SALDO_AWAL asli hanya dibalik sekali.
      expect(
        daftar.filter((j) => j.reversal_of === 'j-awal'),
      ).toHaveLength(1);
      expect(
        daftar.filter((j) => j.jenis === 'SALDO_AWAL'),
      ).toHaveLength(1);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1001')).toBe(RP(7_000_000));
      expect(saldoAkun(baris, '1029')).toBe(RP(1_000_000));
      expect(saldoAkun(baris, '3000')).toBe(RP(8_000_000));
      expect(neracaSaldo(baris, SEKARANG).selisih).toBe(0);
      expect(listAuditLog(db, { aksi: 'KOREKSI-SALDO-AWAL' })).toHaveLength(2);
      expect(statusSaldoAwal(db).boleh).toBe(false);
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe(
        '2026-01-02',
      );
    } finally {
      db.close();
    }
  });
});

describe('T1.7 — atomik dan penolakan koreksi saldo awal', () => {
  it('kegagalan audit setelah reversal membatalkan jurnal, audit, dan setting', () => {
    const db = openDb(':memory:');
    try {
      siapkanAwal(db);
      const jumlahJurnal = listJurnal(db).length;
      const jumlahAudit = listAuditLog(db).length;
      const barisAwal = listBarisJurnal(db);
      const settingAwal = getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI);

      db.exec(`
        CREATE TRIGGER trg_uji_koreksi_abort
        BEFORE INSERT ON audit_log
        WHEN NEW.aksi = 'KOREKSI-SALDO-AWAL'
        BEGIN
          SELECT RAISE(ABORT, 'gagal uji audit koreksi');
        END;
      `);

      const hasil = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2025-12-31', [
            { akun_kode: '1001', nominal: RP(9_000_000) },
          ]),
        ).input,
        { alasan: 'Uji rollback atomik', sekarang: SEKARANG },
      );

      expect(hasil.tersimpan).toBe(false);
      expect(hasil.errors.join(' ')).toMatch(/gagal uji audit koreksi/);
      db.exec('DROP TRIGGER trg_uji_koreksi_abort');

      expect(listJurnal(db)).toHaveLength(jumlahJurnal);
      expect(listAuditLog(db)).toHaveLength(jumlahAudit);
      expect(
        listJurnal(db).some((j) => j.jenis === 'REVERSAL' || j.jenis === 'UMUM'),
      ).toBe(false);
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe(settingAwal);
      const barisSesudah = listBarisJurnal(db);
      expect(saldoAkun(barisSesudah, '1001')).toBe(
        saldoAkun(barisAwal, '1001'),
      );
      expect(statusSaldoAwal(db).jumlahJurnal).toBe(jumlahJurnal);
    } finally {
      db.close();
    }
  });

  it('menolak tanggal setelah transaksi non-pembukaan paling awal', () => {
    const db = openDb(':memory:');
    try {
      siapkanAwal(db);
      const harian = postingJurnal(
        db,
        {
          header: {
            id: 'j-harian',
            tanggal: '2026-01-10',
            no_bukti: 'JU-2026-0100',
            keterangan: 'Penerimaan harian',
            jenis: 'TERIMA',
          },
          baris: [
            { akun_kode: '1001', debit: RP(100_000), kredit: 0 },
            { akun_kode: '4005', debit: 0, kredit: RP(100_000) },
          ],
        },
        { sekarang: SEKARANG },
      );
      expect(harian.tersimpan, harian.errors.join(' ')).toBe(true);

      const jumlah = listJurnal(db).length;
      const terlaluAkhir = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-11', [
            { akun_kode: '1001', nominal: RP(3_000_000) },
          ]),
        ).input,
        { alasan: 'Tanggal terlalu akhir', sekarang: SEKARANG },
      );
      expect(terlaluAkhir.tersimpan).toBe(false);
      expect(terlaluAkhir.errors.join(' ')).toMatch(
        /tidak boleh setelah transaksi paling awal \(2026-01-10\)/,
      );
      expect(listJurnal(db)).toHaveLength(jumlah);

      // Tanggal baru boleh lebih awal dari KUNCI lama; KUNCI ikut diperbarui.
      setPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI, '2026-01-05');
      const lebihAwal = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-02', [
            { akun_kode: '1001', nominal: RP(4_000_000) },
          ]),
        ).input,
        { alasan: 'Pindahkan tanggal mulai lebih awal', sekarang: SEKARANG },
      );
      expect(lebihAwal.tersimpan, lebihAwal.errors.join(' ')).toBe(true);
      expect(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI)).toBe(
        '2026-01-02',
      );
    } finally {
      db.close();
    }
  });

  it('menolak alasan pendek dan koreksi tanpa SALDO_AWAL', () => {
    const db = openDb(':memory:');
    try {
      const tanpaAwal = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-01', [
            { akun_kode: '1001', nominal: RP(1_000_000) },
          ]),
        ).input,
        { alasan: 'Belum ada saldo', sekarang: SEKARANG },
      );
      expect(tanpaAwal.tersimpan).toBe(false);
      expect(tanpaAwal.errors).toContain(PESAN_KOREKSI_TANPA_SALDO_AWAL);
      expect(listJurnal(db)).toEqual([]);

      siapkanAwal(db);
      const jumlah = listJurnal(db).length;
      const pendek = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-01', [
            { akun_kode: '1001', nominal: RP(2_000_000) },
          ]),
        ).input,
        { alasan: 'sala', sekarang: SEKARANG },
      );
      expect(pendek.tersimpan).toBe(false);
      expect(pendek.errors).toContain(PESAN_ALASAN_KOREKSI_MIN);
      expect(listJurnal(db)).toHaveLength(jumlah);
      expect(listAuditLog(db, { aksi: 'KOREKSI-SALDO-AWAL' })).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('reversal generik SALDO_AWAL tetap ditolak dan tidak mengubah saldo awal', () => {
    const db = openDb(':memory:');
    try {
      siapkanAwal(db);
      const sebelum = listBarisJurnal(db);
      const jumlah = listJurnal(db).length;

      const balik = reverseJurnal(db, 'j-awal', 'Coba balik saldo awal', {
        id: 'j-balik-awal',
        tanggal: '2026-01-02',
      });
      expect(balik.tersimpan).toBe(false);
      expect(balik.errors).toContain(PESAN_REVERSAL_SALDO_AWAL);

      expect(listJurnal(db)).toHaveLength(jumlah);
      const sesudah = listBarisJurnal(db);
      expect(saldoAkun(sesudah, '1001')).toBe(saldoAkun(sebelum, '1001'));
      expect(saldoAkun(sesudah, '3000')).toBe(saldoAkun(sebelum, '3000'));
      expect(statusSaldoAwal(db).boleh).toBe(false);
    } finally {
      db.close();
    }
  });
});
