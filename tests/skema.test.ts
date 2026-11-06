// T4.9 — kontrak dokumentasi skema baseline v1 terhadap skema aktif.
//
// Test ini membaca `docs/skema.md` lalu membandingkannya dengan database baru
// (`openDb(':memory:')`), bukan dengan database dev/produksi. Tujuannya:
// - setiap tabel dan kolom yang didokumentasikan benar-benar ada;
// - tidak ada tabel/kolom aktif yang lupa didokumentasikan;
// - tabel modul lama yang sudah dihapus tidak muncul lagi sebagai tabel aktif.
//
// Format yang dijaga: heading `### \`nama_tabel\`` diikuti tabel Markdown yang
// barisnya diawali `| \`nama_kolom\` |`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  SCHEMA_VERSION,
  TABEL_AKTIF,
  openDb,
} from '../src/db/database.js';

/** Tabel modul lama yang sudah dihapus dan tidak boleh muncul lagi. */
const TABEL_LEGACY = [
  'transaksi',
  'coa',
  'pihak',
  'jurnal_pihak',
  'aset',
  'anggaran',
  'rekonsiliasi_bank',
  'lampiran_jurnal',
] as const;

const SKEMA = readFileSync(
  fileURLToPath(new URL('../docs/skema.md', import.meta.url)),
  'utf-8',
);

interface TabelSkema {
  nama: string;
  kolom: string[];
}

/** Ambil heading tabel + kolom dari tabel Markdown di bawah heading tersebut. */
function parseTabelSkema(markdown: string): TabelSkema[] {
  const hasil: TabelSkema[] = [];
  let aktif: TabelSkema | undefined;
  let dalamTabelKolom = false;

  for (const baris of markdown.split(/\r?\n/)) {
    const heading = baris.match(/^### `([a-z_]+)`\s*$/);
    if (heading) {
      aktif = { nama: heading[1], kolom: [] };
      hasil.push(aktif);
      dalamTabelKolom = false;
      continue;
    }
    if (baris.startsWith('## ')) {
      aktif = undefined;
      dalamTabelKolom = false;
      continue;
    }
    if (!aktif) continue;

    if (/^\| Kolom \|/.test(baris)) {
      dalamTabelKolom = true;
      continue;
    }
    if (!dalamTabelKolom) continue;
    if (!baris.startsWith('|')) {
      dalamTabelKolom = false;
      continue;
    }
    const kolom = baris.match(/^\| `([a-z_]+)` \|/);
    if (kolom) aktif.kolom.push(kolom[1]);
  }
  return hasil;
}

function namaTabelAktif(db: Database.Database): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((r) => r.name);
}

function kolomTabel(db: Database.Database, tabel: string): string[] {
  return (db.pragma(`table_info(${tabel})`) as { name: string }[]).map(
    (k) => k.name,
  );
}

function strictTabel(db: Database.Database, tabel: string): number {
  const row = (
    db.pragma('table_list') as { schema: string; name: string; strict: number }[]
  ).find((r) => r.schema === 'main' && r.name === tabel);
  return Number(row?.strict ?? -1);
}

describe('Skema baseline — docs/skema.md cocok dengan skema aktif', () => {
  it('mendokumentasikan tepat 11 tabel aktif dan tidak ada tabel lain', () => {
    const db = openDb(':memory:');
    try {
      const diDb = namaTabelAktif(db);
      const diSkema = parseTabelSkema(SKEMA).map((t) => t.nama);

      expect(diDb).toHaveLength(11);
      expect([...diSkema].sort()).toEqual(diDb);
    } finally {
      db.close();
    }
  });

  it('seluruh 11 tabel aktif STRICT dan tidak punya kolom backup_path', () => {
    const db = openDb(':memory:');
    try {
      expect([...TABEL_AKTIF].sort()).toEqual(namaTabelAktif(db));
      for (const tabel of TABEL_AKTIF) {
        expect(strictTabel(db, tabel), `${tabel} harus STRICT`).toBe(1);
      }
      expect(kolomTabel(db, 'tutup_buku')).toEqual([
        'tahun',
        'created_at',
        'catatan',
      ]);
      expect(SKEMA).not.toContain('| `backup_path` |');
    } finally {
      db.close();
    }
  });

  it('setiap tabel di dokumen memuat seluruh kolom yang benar-benar ada, tanpa kolom hantu', () => {
    const db = openDb(':memory:');
    try {
      for (const tabel of parseTabelSkema(SKEMA)) {
        expect(tabel.kolom, `kolom skema ${tabel.nama}`).toEqual(
          kolomTabel(db, tabel.nama),
        );
      }
    } finally {
      db.close();
    }
  });

  it('tidak mendokumentasikan tabel modul lama yang sudah dihapus', () => {
    for (const tabel of TABEL_LEGACY) {
      expect(SKEMA, `heading tabel lama ${tabel}`).not.toContain(
        `### \`${tabel}\``,
      );
      expect(SKEMA, `nama tabel lama ${tabel}`).not.toContain(`\`${tabel}\``);
    }
  });

  it('menjelaskan sumber angka, panjar, pinjaman, STRICT, dan unique nama akun', () => {
    for (const istilah of [
      'jurnal_baris',
      '`jurnal` + `jurnal_baris`',
      'satu-satunya sumber angka',
      'Tidak ada tabel saldo/laba tersimpan',
      'panjar_item',
      'pinjaman_angsuran',
      'pinjaman_bayar',
      'rencana',
      'realisasi',
      'STRICT',
      'created_at',
      'ux_akun_nama_nocase',
      'COLLATE NOCASE',
    ]) {
      expect(SKEMA, `dokumen skema memuat "${istilah}"`).toContain(istilah);
    }
  });

  it('menyebut skema baseline v1 dan versi skema aktif aplikasi', () => {
    expect(SKEMA).toContain('Skema baseline');
    expect(SKEMA).toContain('Skema aktif');
    expect(SKEMA).toContain(`SCHEMA_VERSION = ${SCHEMA_VERSION}`);
    expect(SCHEMA_VERSION).toBe(1);
  });
});
