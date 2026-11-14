// T-A14: satu command layer untuk semua penulisan jurnal.
//
// Fokus:
// - implementasi insert mentah bernama `insertJurnalInternal` + konteks wajib;
// - `insertJurnalTervalidasi` tetap ada HANYA untuk test/kompatibilitas;
// - tidak ada modul produksi di luar service yang diizinkan memakai raw insert;
// - jumlah jurnal/audit alur normal, pembukaan, dan koreksi tidak berkurang.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/database.js';
import {
  insertJurnalTervalidasi,
  listAuditLog,
} from '../src/db/repository.js';
import { postingJurnal } from '../src/db/posting.js';
import { koreksiDanIsiUlang } from '../src/db/reversal.js';
import { simpanSaldoAwal } from '../src/db/saldoAwal.js';
import type { JurnalBarisInput } from '../src/core/types.js';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const REPOSITORY = 'src/db/repository.ts';

/** Satu-satunya service produksi yang boleh memakai insert internal. */
const SERVICE_INSERT = [
  'src/db/posting.ts',
  'src/db/saldoAwal.ts',
  'src/db/reversal.ts',
  'src/db/seed-dev.ts',
] as const;

const dirs: string[] = [];

function freshDb(): ReturnType<typeof openDb> {
  const dir = mkdtempSync(join(tmpdir(), 'pura-arsitektur-jurnal-'));
  dirs.push(dir);
  return openDb(join(dir, 'pura.db'));
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Semua berkas TypeScript di `src/` (rekursif), path relatif dengan `/`. */
function daftarBerkasSrc(dir = SRC): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entri.name);
    if (entri.isDirectory()) {
      hasil.push(...daftarBerkasSrc(path));
    } else if (/\.(ts|tsx)$/.test(entri.name)) {
      hasil.push(relative(fileURLToPath(new URL('../', import.meta.url)), path).replaceAll('\\', '/'));
    }
  }
  return hasil;
}

function berkasYangMenyebut(berkas: readonly string[], pola: RegExp): string[] {
  return berkas.filter((rel) => pola.test(readFileSync(join(SRC, rel.replace(/^src\//, '')), 'utf8')));
}

function jumlahJurnal(db: ReturnType<typeof openDb>): number {
  return Number((db.prepare('SELECT COUNT(*) AS c FROM jurnal').get() as { c: number }).c);
}

function pasangan(
  debit: string,
  kredit: string,
  nominal: number,
): JurnalBarisInput[] {
  return [
    { akun_kode: debit, debit: nominal, kredit: 0 },
    { akun_kode: kredit, debit: 0, kredit: nominal },
  ];
}

describe('T-A14 — arsitektur penulisan jurnal', () => {
  it('hanya service yang diizinkan memakai insertJurnalInternal', () => {
    const berkas = daftarBerkasSrc();
    const pemakai = berkasYangMenyebut(berkas, /\binsertJurnalInternal\b/).filter(
      (rel) => rel !== REPOSITORY,
    );

    expect(pemakai.filter((rel) => !(SERVICE_INSERT as readonly string[]).includes(rel))).toEqual(
      [],
    );
    for (const service of SERVICE_INSERT) {
      expect(pemakai, `${service} harus menulis lewat insertJurnalInternal`).toContain(service);
    }
  });

  it('tidak ada modul produksi yang memakai wrapper test insertJurnalTervalidasi', () => {
    const pelanggaran = berkasYangMenyebut(
      daftarBerkasSrc(),
      /\binsertJurnalTervalidasi\b/,
    ).filter((rel) => rel !== REPOSITORY);

    expect(
      pelanggaran,
      `Modul produksi ini masih mengimpor/memakai insertJurnalTervalidasi: ${pelanggaran.join(', ')}`,
    ).toEqual([]);
  });

  it('repository tetap menyediakan insertJurnalInternal wajib konteks dan wrapper test', () => {
    const isi = readFileSync(join(SRC, 'db/repository.ts'), 'utf8');

    expect(isi).toMatch(/export function insertJurnalInternal\(/);
    expect(isi).toMatch(/konteks:\s*KonteksInsertJurnal/);
    expect(isi).toMatch(/export function insertJurnalTervalidasi\(/);
    expect(isi).toMatch(/sumber:\s*'TEST'/);
    expect(isi).toMatch(/JANGAN dipakai modul produksi/);
    expect(typeof insertJurnalTervalidasi).toBe('function');
  });

  it('wrapper test tetap bisa membuat jurnal untuk fixture', () => {
    const db = freshDb();
    try {
      const jurnal = insertJurnalTervalidasi(
        db,
        {
          id: 'j-fixture',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Fixture test',
        },
        pasangan('1001', '4005', 100_000),
      );

      expect(jurnal.id).toBe('j-fixture');
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('alur normal dan koreksi tidak mengurangi jumlah jurnal/audit', () => {
    const db = freshDb();
    try {
      const normal = postingJurnal(db, {
        header: {
          id: 'j-normal',
          tanggal: '2026-01-02',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Uang parkir minggu I',
          jenis: 'TERIMA',
        },
        baris: pasangan('1001', '4005', 100_000),
      });
      expect(normal.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toHaveLength(1);

      const koreksi = koreksiDanIsiUlang(
        db,
        'j-normal',
        'Nominal salah, seharusnya 80rb',
        {
          header: {
            id: 'j-normal-baru',
            tanggal: '2026-01-02',
            no_bukti: 'JU-2026-0002',
            keterangan: 'Uang parkir minggu I (koreksi)',
            jenis: 'TERIMA',
          },
          baris: pasangan('1001', '4005', 80_000),
        },
        { id: 'j-balik-normal' },
      );
      expect(koreksi.tersimpan).toBe(true);

      // Jurnal asli tetap ada + reversal + pengganti; audit dua baris.
      expect(jumlahJurnal(db)).toBe(3);
      expect(listAuditLog(db).map((a) => a.aksi).sort()).toEqual([
        'CREATE j-normal',
        'KOREKSI-ISI-ULANG j-normal',
        'REVERSAL j-normal',
      ]);
    } finally {
      db.close();
    }
  });

  it('alur pembukaan tetap menulis satu jurnal dan satu audit', () => {
    const db = freshDb();
    try {
      const hasil = simpanSaldoAwal(db, {
        header: {
          id: 'j-awal',
          tanggal: '2026-01-01',
          no_bukti: 'JU-2026-0001',
          keterangan: 'Saldo awal kas',
          jenis: 'SALDO_AWAL',
        },
        baris: pasangan('1001', '3000', 1_000_000),
      });

      expect(hasil.tersimpan).toBe(true);
      expect(jumlahJurnal(db)).toBe(1);
      expect(listAuditLog(db)).toHaveLength(1);
      expect(listAuditLog(db)[0]!.aksi).toBe('SALDO-AWAL j-awal');
    } finally {
      db.close();
    }
  });
});
