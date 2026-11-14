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

/**
 * T-B04: penyusun rencana reversal (`rencanaReversal`) hanya boleh dipanggil:
 * - `src/core/reversal.ts` — definisi murni;
 * - `src/db/reversal.ts` — helper `postingReversalTertaut` + jalur generik;
 * - `src/db/saldoAwal.ts` — wizard koreksi saldo awal menulis balik+pengganti
 *   lewat `insertJurnalInternal` dengan `sumber` eksplisit (bukan postingJurnal).
 */
const PEMAKAI_RENCANA_REVERSAL = [
  'src/core/reversal.ts',
  'src/db/reversal.ts',
  'src/db/saldoAwal.ts',
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

/**
 * Ekstrak isi setiap pemanggilan `namaFungsi(...)` pada satu berkas sumber,
 * kurung seimbang, untuk pemeriksaan statis opsi pemanggilan.
 */
function ekstrakPanggilan(
  isiBerkas: string,
  namaFungsi: string,
): { baris: number; isi: string }[] {
  const hasil: { baris: number; isi: string }[] = [];
  const pola = new RegExp(`\\b${namaFungsi}\\s*\\(`, 'g');
  let cocok: RegExpExecArray | null;
  while ((cocok = pola.exec(isiBerkas)) !== null) {
    const mulai = cocok.index + cocok[0].length;
    let kedalaman = 1;
    let akhir = mulai;
    while (akhir < isiBerkas.length && kedalaman > 0) {
      const karakter = isiBerkas[akhir];
      if (karakter === '(') kedalaman += 1;
      else if (karakter === ')') kedalaman -= 1;
      akhir += 1;
    }
    if (kedalaman !== 0) continue; // kurung tidak seimbang — bukan panggilan utuh.
    const isiPanggilan = isiBerkas.slice(mulai, akhir - 1);
    const baris = isiBerkas.slice(0, cocok.index).split('\n').length;
    hasil.push({ baris, isi: isiPanggilan });
  }
  return hasil;
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

  it('T-B04 — penyusun rencana reversal hanya boleh dipanggil helper reversal', () => {
    const pemakai = berkasYangMenyebut(
      daftarBerkasSrc(),
      /\brencanaReversal\s*\(/,
    ).filter((rel) => !(PEMAKAI_RENCANA_REVERSAL as readonly string[]).includes(rel));

    expect(
      pemakai,
      `Modul produksi ini menyusun rencana reversal sendiri; wajib lewat helper ` +
        `postingReversalTertaut di src/db/reversal.ts: ${pemakai.join(', ')}`,
    ).toEqual([]);
  });

  it('T-B04 — pemanggil postingJurnal untuk jurnal balik wajib mengirim mode REVERSAL', () => {
    const pelanggaran: string[] = [];
    for (const rel of daftarBerkasSrc()) {
      const isiBerkas = readFileSync(join(SRC, rel.replace(/^src\//, '')), 'utf8');
      for (const panggilan of ekstrakPanggilan(isiBerkas, 'postingJurnal')) {
        // Jurnal balik dikenali dari:
        // - header jenis REVERSAL eksplisit (aturan berlaku di semua berkas);
        // - input rencana reversal — hanya mungkin di src/db/reversal.ts karena
        //   test sebelumnya membatasi pemanggil `rencanaReversal` ke helper.
        const membalikJurnal =
          /jenis:\s*'REVERSAL'/.test(panggilan.isi) ||
          (/rencana\s*\.\s*input/.test(panggilan.isi) && rel === 'src/db/reversal.ts');
        if (membalikJurnal && !/mode:\s*'REVERSAL'/.test(panggilan.isi))
          pelanggaran.push(`${rel}:${panggilan.baris}`);
      }
    }

    expect(
      pelanggaran,
      `Pemanggilan postingJurnal jurnal balik tanpa mode REVERSAL menyimpan ` +
        `sumber 'POSTING' dan menyamarkan asal koreksi: ${pelanggaran.join(', ')}`,
    ).toEqual([]);
  });
});
