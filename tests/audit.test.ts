// P0-9: audit log lengkap — data sebelum/sesudah, filter, dan kewajiban audit
// untuk operasi yang sudah ada (jurnal, koreksi, tutup, aset, pengaturan, backup).
// Viewer lengkapnya ada di tab Pengaturan (bukan Tutup Buku).
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, openDb } from '../src/db/database.js';
import {
  catatAudit,
  deleteAset,
  hitungAuditLog,
  insertAset,
  insertAuditLog,
  insertJurnal,
  listAuditLog,
  listAuditLogPage,
  updateAset,
} from '../src/db/repository.js';
import { postingJurnal, postingSaldoAwal } from '../src/db/posting.js';
import { koreksiDanIsiUlang, reverseJurnal } from '../src/db/reversal.js';
import { tutupBuku } from '../src/db/tutup.js';
import { autoBackupHarian } from '../src/features/export/export.js';
import { aturIdle, resetPaksa, setupPin, sesi, ubahPin } from '../src/main/kunci.js';
import { buatAuditLog, jsonAuditAman } from '../src/core/ledger.js';
import type { Aset, AuditLog } from '../src/core/types.js';

function dbKosong(): Database.Database {
  return openDb(':memory:');
}

function auditRow(over: Partial<AuditLog> & Pick<AuditLog, 'id' | 'tanggal' | 'aksi'>): AuditLog {
  return {
    alasan: '',
    data_lama_json: '',
    data_baru_json: '',
    ...over,
  };
}

const pasangan = (debit: string, kredit: string, nominal = 100_000) => [
  { akun_kode: debit, debit: nominal, kredit: 0 },
  { akun_kode: kredit, debit: 0, kredit: nominal },
];

describe('T10 listAuditLog', () => {
  it('kembali urut tanggal DESC, kosong bila belum ada', () => {
    const db = dbKosong();
    expect(listAuditLog(db)).toEqual([]);

    const a1: AuditLog = {
      id: 'audit-1',
      tanggal: '2026-01-10T10:00:00.000Z',
      aksi: 'CREATE t-1',
      alasan: 'Koreksi struk susulan Desember',
      data_lama_json: '{}',
      data_baru_json: '{}',
    };
    const a2: AuditLog = {
      id: 'audit-2',
      tanggal: '2026-02-15T10:00:00.000Z',
      aksi: 'CREATE t-2',
      alasan: 'Susulan parkir Januari',
      data_lama_json: '{}',
      data_baru_json: '{}',
    };
    insertAuditLog(db, a1);
    insertAuditLog(db, a2);

    const rows = listAuditLog(db);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.id).toBe('audit-2');
    expect(rows[1]!.id).toBe('audit-1');
    expect(rows[0]!.alasan).toBe('Susulan parkir Januari');
  });

  it('menyimpan data lama & data baru yang aman untuk string/objek/null', () => {
    const db = dbKosong();
    catatAudit(db, {
      id: 'audit-json',
      tanggal: '2026-03-01T00:00:00.000Z',
      aksi: 'ASET-UPDATE a-1',
      alasan: 'Ubah nama',
      lama: { nama: 'Lama' },
      baru: { nama: 'Baru' },
    });
    const row = listAuditLog(db)[0]!;
    expect(row.data_baru_json).not.toBe('');
    expect(JSON.parse(row.data_lama_json)).toEqual({ nama: 'Lama' });
    expect(JSON.parse(row.data_baru_json)).toEqual({ nama: 'Baru' });

    expect(jsonAuditAman(undefined)).toBe('');
    expect(jsonAuditAman(null)).toBe('null');
    expect(jsonAuditAman('{"a":1}')).toBe('{"a":1}');
    expect(JSON.parse(jsonAuditAman('teks biasa'))).toBe('teks biasa');

    const sirkular: Record<string, unknown> = {};
    sirkular.self = sirkular;
    expect(() => buatAuditLog('UJI', '', sirkular, null)).not.toThrow();

    db.close();
  });
});

describe('T10a filter audit: aksi, tanggal, limit, offset', () => {
  function isi(db: Database.Database): void {
    const rows: AuditLog[] = [
      auditRow({ id: 'a1', tanggal: '2026-01-05T08:00:00.000Z', aksi: 'CREATE j-1' }),
      auditRow({ id: 'a2', tanggal: '2026-01-10T08:00:00.000Z', aksi: 'REVERSAL j-1' }),
      auditRow({ id: 'a3', tanggal: '2026-02-01T08:00:00.000Z', aksi: 'REVERSAL j-2' }),
      auditRow({ id: 'a4', tanggal: '2026-02-15T08:00:00.000Z', aksi: 'ASET-CREATE a-1' }),
      auditRow({ id: 'a5', tanggal: '2026-03-01T08:00:00.000Z', aksi: 'PENGATURAN-IDLE' }),
    ];
    for (const r of rows) insertAuditLog(db, r);
  }

  it('filter aksi cocok persis maupun sebagai awalan', () => {
    const db = dbKosong();
    isi(db);
    expect(listAuditLog(db, { aksi: 'REVERSAL' }).map((r) => r.id)).toEqual(['a3', 'a2']);
    expect(listAuditLog(db, { aksi: 'REVERSAL j-1' }).map((r) => r.id)).toEqual(['a2']);
    expect(listAuditLog(db, { aksi: 'ASET' }).map((r) => r.id)).toEqual(['a4']);
    db.close();
  });

  it('filter tanggal mulai/sampai inklusif', () => {
    const db = dbKosong();
    isi(db);
    expect(
      listAuditLog(db, { mulai: '2026-02-01', sampai: '2026-02-28' }).map((r) => r.id),
    ).toEqual(['a4', 'a3']);
    expect(listAuditLog(db, { mulai: '2026-02-02' }).map((r) => r.id)).toEqual(['a5', 'a4']);
    db.close();
  });

  it('filter tanggal memakai hari lokal WITA, bukan tanggal UTC', () => {
    const db = dbKosong();
    try {
      // 2026-10-22T23:30Z = 2026-10-23 07:30 WITA.
      insertAuditLog(
        db,
        auditRow({ id: 'pagi', tanggal: '2026-10-22T23:30:00.000Z', aksi: 'CREATE j-pagi' }),
      );
      expect(
        listAuditLog(db, { mulai: '2026-10-23', sampai: '2026-10-23' }).map((r) => r.id),
      ).toEqual(['pagi']);
      expect(listAuditLog(db, { mulai: '2026-10-22', sampai: '2026-10-22' })).toEqual([]);
      expect(listAuditLog(db, { sampai: '2026-10-22' })).toEqual([]);
      expect(listAuditLog(db, { mulai: '2026-10-23' }).map((r) => r.id)).toEqual(['pagi']);
    } finally {
      db.close();
    }
  });

  it('batas hari lokal: awal inklusif, akhir eksklusif', () => {
    const db = dbKosong();
    try {
      const rows: AuditLog[] = [
        auditRow({ id: 'b1', tanggal: '2026-10-22T15:59:59.999Z', aksi: 'CREATE j-1' }),
        auditRow({ id: 'b2', tanggal: '2026-10-22T16:00:00.000Z', aksi: 'CREATE j-2' }),
        auditRow({ id: 'b3', tanggal: '2026-10-23T15:59:59.999Z', aksi: 'CREATE j-3' }),
        auditRow({ id: 'b4', tanggal: '2026-10-23T16:00:00.000Z', aksi: 'CREATE j-4' }),
      ];
      for (const r of rows) insertAuditLog(db, r);
      expect(
        listAuditLog(db, { mulai: '2026-10-23', sampai: '2026-10-23' }).map((r) => r.id),
      ).toEqual(['b3', 'b2']);
    } finally {
      db.close();
    }
  });

  it('limit/offset aman + total dihitung dari filter (bukan dari halaman)', () => {
    const db = dbKosong();
    isi(db);
    const halaman = listAuditLogPage(db, { limit: 2, offset: 2 });
    expect(halaman.total).toBe(5);
    expect(halaman.rows.map((r) => r.id)).toEqual(['a3', 'a2']);
    expect(hitungAuditLog(db, { aksi: 'REVERSAL' })).toBe(2);
    expect(listAuditLog(db, { limit: -5 as number }).length).toBe(0);
    expect(listAuditLog(db, { limit: 2, offset: 99 })).toEqual([]);
    db.close();
  });
});

describe('T10b migrasi audit_log v2 → v3', () => {
  it('menambah data_baru_json idempoten tanpa menghapus audit lama', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-audit-migrasi-'));
    try {
      const path = join(dir, 'lama.db');
      const lama = new Database(path);
      lama.exec(`
        CREATE TABLE audit_log (
          id TEXT PRIMARY KEY,
          tanggal TEXT NOT NULL,
          aksi TEXT NOT NULL,
          alasan TEXT NOT NULL,
          data_lama_json TEXT NOT NULL DEFAULT ''
        );
        PRAGMA user_version = 2;
      `);
      lama
        .prepare('INSERT INTO audit_log (id, tanggal, aksi, alasan, data_lama_json) VALUES (?, ?, ?, ?, ?)')
        .run('audit-lama', '2026-01-01T00:00:00.000Z', 'CREATE j-lama', 'Lama', '{"x":1}');
      lama.close();

      const db = openDb(path);
      try {
        const kolom = (db.pragma('table_info(audit_log)') as { name: string }[]).map((k) => k.name);
        expect(kolom).toContain('data_baru_json');
        expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);
        expect(listAuditLog(db)[0]).toMatchObject({
          id: 'audit-lama',
          data_lama_json: '{"x":1}',
          data_baru_json: '',
        });
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('P0-9 — operasi wajib menghasilkan audit', () => {
  it('posting jurnal menulis CREATE + header/baris di data baru, gagal tidak menulis', () => {
    const db = dbKosong();
    try {
      const gagal = postingJurnal(db, {
        header: { id: 'j-salah', tanggal: '2026-02-31', keterangan: 'Tanggal salah' },
        baris: pasangan('1001', '4005'),
      });
      expect(gagal.tersimpan).toBe(false);
      expect(listAuditLog(db)).toEqual([]);

      const hasil = postingJurnal(db, {
        header: { id: 'j-baru', tanggal: '2026-01-02', keterangan: 'Uang parkir' },
        baris: pasangan('1001', '4005', 50_000),
      });
      expect(hasil.tersimpan).toBe(true);

      const audit = listAuditLog(db);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.aksi).toBe('CREATE j-baru');
      const baru = JSON.parse(audit[0]!.data_baru_json) as {
        jurnal: { id: string };
        baris: unknown[];
      };
      expect(baru.jurnal.id).toBe('j-baru');
      expect(baru.baris).toHaveLength(2);
    } finally {
      db.close();
    }
  });

  it('saldo awal memakai helper audit khusus (belum ada endpoint)', () => {
    const db = dbKosong();
    try {
      const hasil = postingSaldoAwal(db, {
        header: { id: 'j-awal', tanggal: '2026-01-01', keterangan: 'Saldo awal kas' },
        baris: pasangan('1001', '3000', 1_000_000),
      });
      expect(hasil.tersimpan).toBe(true);
      const audit = listAuditLog(db);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.aksi).toBe('SALDO-AWAL j-awal');
      expect(JSON.parse(audit[0]!.data_baru_json)).toMatchObject({
        jurnal: { id: 'j-awal', jenis: 'SALDO_AWAL' },
      });
    } finally {
      db.close();
    }
  });

  it('reversal & koreksi isi ulang menyimpan data lama dan data baru', () => {
    const db = dbKosong();
    try {
      insertJurnal(
        db,
        { id: 'j-modal', tanggal: '2026-01-01', no_bukti: 'JU-MODAL', keterangan: 'Modal' },
        pasangan('1001', '3000', 1_000_000),
      );
      insertJurnal(
        db,
        { id: 'j-parkir', tanggal: '2026-01-02', no_bukti: 'JU-PARKIR', keterangan: 'Parkir' },
        pasangan('1001', '4005', 100_000),
      );

      const balik = reverseJurnal(db, 'j-parkir', 'Salah nominal', {
        id: 'j-balik',
        tanggal: '2026-01-03',
      });
      expect(balik.tersimpan).toBe(true);
      const auditBalik = listAuditLog(db)[0]!;
      expect(auditBalik.aksi).toBe('REVERSAL j-parkir');
      expect(JSON.parse(auditBalik.data_lama_json)).toMatchObject({ jurnal: { id: 'j-parkir' } });
      expect(JSON.parse(auditBalik.data_baru_json)).toMatchObject({
        jurnal: { id: 'j-balik', reversal_of: 'j-parkir' },
      });

      insertJurnal(
        db,
        { id: 'j-parkir-2', tanggal: '2026-01-05', no_bukti: 'JU-PARKIR-2', keterangan: 'Parkir 2' },
        pasangan('1001', '4005', 90_000),
      );
      const koreksi = koreksiDanIsiUlang(
        db,
        'j-parkir-2',
        'Nominal salah, seharusnya 80rb',
        {
          header: {
            id: 'j-parkir-baru',
            tanggal: '2026-01-05',
            no_bukti: 'JU-PARKIR-BARU',
            keterangan: 'Parkir 2 (koreksi)',
          },
          baris: pasangan('1001', '4005', 80_000),
        },
        { id: 'j-balik-2', tanggal: '2026-01-06' },
      );
      expect(koreksi.tersimpan).toBe(true);
      const auditKoreksi = listAuditLog(db).find(
        (a) => a.aksi === 'KOREKSI-ISI-ULANG j-parkir-2',
      )!;
      expect(auditKoreksi).toBeTruthy();
      expect(JSON.parse(auditKoreksi.data_lama_json)).toMatchObject({
        jurnal: { id: 'j-parkir-2' },
      });
      expect(JSON.parse(auditKoreksi.data_baru_json)).toMatchObject({
        jurnal: { id: 'j-parkir-baru' },
      });
    } finally {
      db.close();
    }
  });

  it('tutup buku & tutup ulang menyimpan kondisi sebelum/sesudah', () => {
    const db = dbKosong();
    try {
      insertJurnal(
        db,
        { id: 'j-2025', tanggal: '2025-12-01', keterangan: 'Pendapatan 2025' },
        pasangan('1001', '4005', 1_000_000),
      );
      expect(
        tutupBuku(db, 2025, { sekarang: '2026-10-22', catatan: 'Pertama' }).tersimpan,
      ).toBe(true);
      const pertama = listAuditLog(db)[0]!;
      expect(pertama.aksi).toBe('TUTUP 2025');
      expect(pertama.data_lama_json).toBe('');
      expect(JSON.parse(pertama.data_baru_json)).toMatchObject({ tahun: 2025, catatan: 'Pertama' });

      expect(
        tutupBuku(db, 2025, {
          sekarang: '2026-10-22',
          catatan: 'Kedua',
          konfirmasiTimpak: true,
        }).tersimpan,
      ).toBe(true);
      const ulang = listAuditLog(db)[0]!;
      expect(ulang.aksi).toBe('TUTUP-ULANG 2025');
      expect(JSON.parse(ulang.data_lama_json)).toMatchObject({ tahun: 2025, catatan: 'Pertama' });
      expect(JSON.parse(ulang.data_baru_json)).toMatchObject({ tahun: 2025, catatan: 'Kedua' });
    } finally {
      db.close();
    }
  });

  it('CRUD aset menulis data lama & baru, atomik dengan operasinya', () => {
    const db = dbKosong();
    try {
      const now = '2026-01-01T00:00:00.000Z';
      const aset: Aset = {
        id: 'a-1',
        kode: 'AST-001',
        nama: 'Tanah Lama',
        jenis: 'TANAH',
        luas_m2: 100,
        lokasi: 'Pura',
        status_hukum: 'druwe',
        tahun_perolehan: 2010,
        asal_usul: 'hibah',
        kondisi: 'BAIK',
        keterangan: '',
        nilai_sen: null,
        created_at: now,
        updated_at: now,
      };
      insertAset(db, aset);
      updateAset(db, { ...aset, nama: 'Tanah Baru', updated_at: '2026-01-02T00:00:00.000Z' });
      deleteAset(db, aset.id);

      const audit = listAuditLog(db);
      expect(audit.map((a) => a.aksi.split(' ')[0])).toEqual([
        'ASET-DELETE',
        'ASET-UPDATE',
        'ASET-CREATE',
      ]);
      const tambah = audit.find((a) => a.aksi.startsWith('ASET-CREATE'))!;
      expect(tambah.data_lama_json).toBe('');
      expect(JSON.parse(tambah.data_baru_json)).toMatchObject({ kode: 'AST-001', nama: 'Tanah Lama' });
      const ubah = audit.find((a) => a.aksi.startsWith('ASET-UPDATE'))!;
      expect(JSON.parse(ubah.data_lama_json)).toMatchObject({ nama: 'Tanah Lama' });
      expect(JSON.parse(ubah.data_baru_json)).toMatchObject({ nama: 'Tanah Baru' });
      const hapus = audit.find((a) => a.aksi.startsWith('ASET-DELETE'))!;
      expect(JSON.parse(hapus.data_lama_json)).toMatchObject({ nama: 'Tanah Baru' });
      // Tidak ada aset tersisa: audit tidak menghidupkan kembali baris.
      expect(db.prepare('SELECT COUNT(*) AS c FROM aset').get()).toEqual({ c: 0 });
    } finally {
      db.close();
    }
  });

  it('ubah PIN/reset/idle tercatat tanpa menyimpan PIN atau hash', () => {
    const db = dbKosong();
    try {
      sesi.terbuka = false;
      expect(setupPin(db, '123456')).toBeNull();
      expect(ubahPin(db, '123456', '654321')).toBeNull();
      expect(aturIdle(db, 45)).toBeNull();
      process.env.PURA_RESET_CODE = 'KODE-UJI-AUDIT';
      expect(resetPaksa(db, 'KODE-UJI-AUDIT', '777777')).toBeNull();

      const rows = listAuditLog(db).filter((a) => a.aksi.startsWith('PENGATURAN'));
      expect(rows.map((a) => a.aksi)).toEqual(
        expect.arrayContaining([
          'PENGATURAN-SETUP-PIN',
          'PENGATURAN-PIN',
          'PENGATURAN-IDLE',
          'PENGATURAN-RESET-PIN',
        ]),
      );
      const idle = rows.find((a) => a.aksi === 'PENGATURAN-IDLE')!;
      expect(JSON.parse(idle.data_lama_json)).toEqual({ idleMenit: 30 });
      expect(JSON.parse(idle.data_baru_json)).toEqual({ idleMenit: 45 });

      const teksAudit = rows.map((a) => `${a.data_lama_json}${a.data_baru_json}`).join(' ');
      for (const rahasia of ['123456', '654321', '777777', 'pin_hash', 'pin_salt']) {
        expect(teksAudit).not.toContain(rahasia);
      }
    } finally {
      delete process.env.PURA_RESET_CODE;
      db.close();
    }
  });

  it('auto backup harian menulis audit BACKUP-AUTO', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pura-audit-backup-'));
    const db = dbKosong();
    try {
      const dest = autoBackupHarian(db, dir, 7, '2026-09-09');
      const audit = listAuditLog(db);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.aksi).toBe('BACKUP-AUTO');
      expect(JSON.parse(audit[0]!.data_baru_json)).toMatchObject({ path: dest, hari: '2026-09-09' });

      // Panggilan kedua di hari yang sama tidak membuat audit ganda.
      autoBackupHarian(db, dir, 7, '2026-09-09');
      expect(listAuditLog(db)).toHaveLength(1);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
