// T1.9 — regresi P0: bukti permanen empat reproduksi baseline.
//
// Empat reproduksi baseline sudah punya test fokus di file masing-masing:
// 1. Backup ke path DB aktif ditolak + jurnal baru bertahan
//    → tests/backup-restore.test.ts (T1.1)
// 2. DB v1 tanpa `jurnal_baris` ditolak tanpa membuat tabel kosong / mengubah file
//    → tests/skema-kompatibilitas.test.ts (T1.3)
// 3. Reversal `SALDO_AWAL` ditolak tanpa jurnal/audit baru dan saldo tetap
//    → tests/reversal.test.ts (T1.5)
// 4. Koreksi saldo awal mengubah laporan + audit bertambah + koreksi berulang
//    tidak melanggar unique index
//    → tests/saldo-awal-koreksi.test.ts (T1.7)
//
// File ini menutup celah yang belum dibuktikan test di atas: hasil koreksi dan
// penolakan reversal harus tetap utuh setelah DB file ditutup lalu dibuka ulang
// (skenario smoke T1.9 nomor 5), dan koreksi berulang SETELAH reopen tetap
// tidak melanggar `ux_jurnal_saldo_awal`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buatJurnalSaldoAwal, type FormSaldoAwal } from '../src/core/forms.js';
import { neracaSaldo, saldoAkun } from '../src/core/reports.js';
import { openDb } from '../src/db/database.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { listAuditLog, listJurnal } from '../src/db/repository.js';
import { PESAN_REVERSAL_SALDO_AWAL, reverseJurnal } from '../src/db/reversal.js';
import {
  koreksiSaldoAwal,
  simpanSaldoAwal,
  statusSaldoAwal,
} from '../src/db/saldoAwal.js';

const RP = (rupiah: number): number => rupiah * 100;
const SEKARANG = '2026-12-31';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tmpDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pura-t19-'));
  dirs.push(dir);
  return join(dir, 'pura.db');
}

function form(
  tanggal: string,
  saldo: FormSaldoAwal['saldo'],
  id?: string,
): FormSaldoAwal {
  return { ...(id ? { id } : {}), tanggal, saldo };
}

describe('T1.9 — regresi P0 bertahan setelah DB ditutup dan dibuka ulang', () => {
  it('koreksi saldo awal bertahan setelah reopen; koreksi berulang tetap sah', () => {
    const dbPath = tmpDbPath();

    // Sesi 1: saldo awal + koreksi pertama.
    let db = openDb(dbPath);
    try {
      const awal = simpanSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-01', [{ akun_kode: '1001', nominal: RP(5_000_000) }], 'j-awal'),
        ).input,
      );
      expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

      const pertama = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-01', [{ akun_kode: '1001', nominal: RP(8_000_000) }]),
        ).input,
        { alasan: 'Salah input saldo awal kas', sekarang: SEKARANG },
      );
      expect(pertama.tersimpan, pertama.errors.join(' ')).toBe(true);
      expect(listAuditLog(db, { aksi: 'KOREKSI-SALDO-AWAL' })).toHaveLength(1);
    } finally {
      db.close();
    }

    // Sesi 2: seluruh hasil koreksi masih ada setelah reopen.
    db = openDb(dbPath);
    try {
      expect(listJurnal(db)).toHaveLength(3);
      expect(listJurnal(db).filter((j) => j.jenis === 'SALDO_AWAL')).toHaveLength(1);
      expect(listJurnal(db).filter((j) => j.reversal_of === 'j-awal')).toHaveLength(1);

      const sesudahReopen = listBarisJurnal(db);
      expect(saldoAkun(sesudahReopen, '1001')).toBe(RP(8_000_000));
      expect(saldoAkun(sesudahReopen, '3000')).toBe(RP(8_000_000));
      expect(neracaSaldo(sesudahReopen, SEKARANG).selisih).toBe(0);
      expect(listAuditLog(db, { aksi: 'KOREKSI-SALDO-AWAL' })).toHaveLength(1);
      expect(statusSaldoAwal(db).boleh).toBe(false);

      // Koreksi kedua setelah reopen: membalik UMUM pengganti aktif, bukan
      // SALDO_AWAL dua kali, sehingga `ux_jurnal_saldo_awal`/`ux_jurnal_reversal`
      // tidak dilanggar.
      const kedua = koreksiSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form('2026-01-02', [
            { akun_kode: '1001', nominal: RP(7_000_000) },
            { akun_kode: '1029', nominal: RP(1_000_000) },
          ]),
        ).input,
        { alasan: 'Koreksi kedua setelah reopen', sekarang: SEKARANG },
      );
      expect(kedua.tersimpan, kedua.errors.join(' ')).toBe(true);
      expect(kedua.jurnalLama?.jenis).toBe('UMUM');
      expect(kedua.reversal?.reversal_of).toBe(kedua.jurnalLama?.id);

      const daftar = listJurnal(db);
      expect(daftar).toHaveLength(5);
      expect(daftar.filter((j) => j.jenis === 'SALDO_AWAL')).toHaveLength(1);
      expect(listAuditLog(db, { aksi: 'KOREKSI-SALDO-AWAL' })).toHaveLength(2);

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1001')).toBe(RP(7_000_000));
      expect(saldoAkun(baris, '1029')).toBe(RP(1_000_000));
      expect(saldoAkun(baris, '3000')).toBe(RP(8_000_000));
      expect(neracaSaldo(baris, SEKARANG).selisih).toBe(0);
    } finally {
      db.close();
    }

    // Sesi 3: koreksi kedua juga bertahan setelah reopen.
    db = openDb(dbPath);
    try {
      expect(listJurnal(db)).toHaveLength(5);
      expect(listAuditLog(db, { aksi: 'KOREKSI-SALDO-AWAL' })).toHaveLength(2);
      expect(saldoAkun(listBarisJurnal(db), '1001')).toBe(RP(7_000_000));
      expect(saldoAkun(listBarisJurnal(db), '3000')).toBe(RP(8_000_000));
    } finally {
      db.close();
    }
  });

  it('reversal saldo awal diblokir pada DB file dan tidak ada data berubah setelah reopen', () => {
    const dbPath = tmpDbPath();

    let db = openDb(dbPath);
    let jumlahJurnal = 0;
    let jumlahAudit = 0;
    let kasAwal = 0;
    let modalAwal = 0;
    try {
      const awal = simpanSaldoAwal(
        db,
        buatJurnalSaldoAwal(
          form(
            '2026-01-01',
            [
              { akun_kode: '1001', nominal: RP(5_000_000) },
              { akun_kode: '2050', nominal: RP(1_000_000) },
            ],
            'j-awal',
          ),
        ).input,
      );
      expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);

      jumlahJurnal = listJurnal(db).length;
      jumlahAudit = listAuditLog(db).length;
      const sebelum = listBarisJurnal(db);
      kasAwal = saldoAkun(sebelum, '1001');
      modalAwal = saldoAkun(sebelum, '3000');

      const balik = reverseJurnal(db, 'j-awal', 'Coba balik saldo awal', {
        id: 'j-balik-awal',
        tanggal: '2026-01-02',
      });
      expect(balik.tersimpan).toBe(false);
      expect(balik.errors).toContain(PESAN_REVERSAL_SALDO_AWAL);
      expect(listJurnal(db)).toHaveLength(jumlahJurnal);
      expect(listAuditLog(db)).toHaveLength(jumlahAudit);
      expect(statusSaldoAwal(db).boleh).toBe(false);
    } finally {
      db.close();
    }

    db = openDb(dbPath);
    try {
      expect(listJurnal(db)).toHaveLength(jumlahJurnal);
      expect(listAuditLog(db)).toHaveLength(jumlahAudit);
      expect(listJurnal(db).some((j) => j.jenis === 'REVERSAL')).toBe(false);

      const sesudah = listBarisJurnal(db);
      expect(saldoAkun(sesudah, '1001')).toBe(kasAwal);
      expect(saldoAkun(sesudah, '3000')).toBe(modalAwal);
      expect(neracaSaldo(sesudah, SEKARANG).selisih).toBe(0);
      expect(statusSaldoAwal(db).boleh).toBe(false);
    } finally {
      db.close();
    }
  });
});
