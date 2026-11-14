// Guard path untuk backup: file DB yang sedang aktif (dan sidecar WAL/SHM-nya)
// tidak boleh menjadi tujuan `VACUUM INTO`. Bila tertimpa, koneksi SQLite tetap
// menulis ke inode lama sehingga jurnal baru hilang saat DB dibuka ulang.

import { realpathSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export const PESAN_BACKUP_KE_DB_AKTIF =
  'File database yang sedang aktif tidak boleh menjadi tujuan backup. ' +
  'Pilih nama file lain agar database aktif tidak tertimpa.';

type InfoInode = { dev: number; ino: number };

/** Path absolut dengan symlink diselesaikan bila file/parent-nya ada. */
function pathKanonik(path: string): string {
  const absolut = resolve(path);
  try {
    return realpathSync.native(absolut);
  } catch {
    // Tujuan belum ada/tidak bisa diakses: bandingkan path absolut saja.
    return absolut;
  }
}

/** Identitas inode file (mengikuti symlink), null bila bukan file biasa. */
function infoInode(path: string): InfoInode | null {
  try {
    const info = statSync(path);
    return info.isFile() ? { dev: info.dev, ino: info.ino } : null;
  } catch {
    return null;
  }
}

/**
 * Tolak tujuan backup yang menunjuk DB aktif atau `${dbPath}-wal`/`-shm`.
 *
 * Perbandingan memakai path kanonik (relatif vs absolut, symlink) dan inode
 * (hardlink), sehingga `./data/pura.db`, symlink, dan hardlink ke file aktif
 * semuanya tertolak.
 */
export function pastikanBukanFileDbAktif(dbPath: string, tujuan: string): void {
  const terlarang = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  const kanonikTujuan = pathKanonik(tujuan);
  for (const path of terlarang) {
    if (pathKanonik(path) === kanonikTujuan) throw new Error(PESAN_BACKUP_KE_DB_AKTIF);
  }

  const inodeTujuan = infoInode(tujuan);
  if (!inodeTujuan) return;
  for (const path of terlarang) {
    const inode = infoInode(path);
    if (inode && inode.dev === inodeTujuan.dev && inode.ino === inodeTujuan.ino) {
      throw new Error(PESAN_BACKUP_KE_DB_AKTIF);
    }
  }
}
