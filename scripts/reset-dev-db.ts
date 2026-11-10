// T-A00 — reset DB dev dengan backup, TANPA menghapus data tanpa salinan.
//
// Jalankan: npm run db:reset-dev
// Opsional: npm run db:reset-dev -- /path/ke/pura-dev.db
//
// Langkah:
// 1. File DB (default data/pura-dev.db) beserta -wal/-shm dipindahkan (rename)
//    ke data/backups/pre-reset-<timestamp>.db (sidecar memakai sufiks sama).
// 2. DB baru v2 kosong dibuat lewat `openDb` (termasuk seed COA).
//
// Script ini tidak pernah menghapus file; bila pemindahan gagal, proses
// berhenti sebelum menyentuh langkah berikutnya.

import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openDb } from '../src/db/database.js';

function capWaktu(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

function pindahkanJikaAda(sumber: string, tujuan: string): boolean {
  if (!existsSync(sumber)) return false;
  renameSync(sumber, tujuan);
  return true;
}

const argumen = process.argv[2]?.trim();
const pathDb = resolve(
  argumen || process.env.PURA_DB || join('data', 'pura-dev.db'),
);

if (pathDb === ':memory:') {
  console.error('Reset DB dev tidak berlaku untuk database :memory:.');
  process.exit(1);
}

if (!existsSync(pathDb)) {
  console.log(`Tidak ada file DB dev di ${pathDb}.`);
  console.log('Membuat database v2 baru yang kosong...');
  openDb(pathDb).close();
  console.log(`Database v2 baru dibuat: ${pathDb}`);
  process.exit(0);
}

const folderBackup = join(dirname(pathDb), 'backups');
mkdirSync(folderBackup, { recursive: true });
const tujuan = join(folderBackup, `pre-reset-${capWaktu()}.db`);

// Pindahkan sidecar lebih dulu agar isi WAL tidak tertinggal tanpa DB.
const sidecar = ['-wal', '-shm'].filter((sufiks) =>
  pindahkanJikaAda(`${pathDb}${sufiks}`, `${tujuan}${sufiks}`),
);
pindahkanJikaAda(pathDb, tujuan);

console.log(`DB lama dipindahkan ke: ${tujuan}`);
if (sidecar.length > 0)
  console.log(`Sidecar ikut dipindahkan: ${sidecar.join(', ')}`);
console.log('Membuat database v2 baru yang kosong...');
openDb(pathDb).close();
console.log(`Database v2 baru dibuat: ${pathDb}`);
