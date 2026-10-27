// P2-4 — penyimpanan file lampiran bukti jurnal.
//
// File fisik tinggal di `<userData>/attachments`, sedangkan DB hanya menyimpan
// metadata (nama file relatif). Modul ini sengaja tidak mengimpor Electron:
// semua fungsi menerima folder dari pemanggil, sehingga bisa diuji dengan
// folder sementara. Main yang menentukan folder default lewat
// `folderLampiranDefault(app.getPath('userData'))`.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import {
  MAKS_PREVIEW_LAMPIRAN,
  mimeDariNama,
  namaSimpanAman,
  validasiLampiran,
} from '../../core/lampiran.js';

export type HasilSimpanFileLampiran = {
  namaSimpan: string;
  namaAsli: string;
  mime: string;
  ukuran: number;
};

/** Folder lampiran standar di dalam folder data aplikasi (userData). */
export function folderLampiranDefault(userDataDir: string): string {
  return join(userDataDir, 'attachments');
}

function pathDiDalamFolder(dir: string, namaSimpan: string): string {
  if (typeof namaSimpan !== 'string' || !namaSimpan.trim())
    throw new Error('Nama file lampiran tidak valid.');
  if (
    namaSimpan !== basename(namaSimpan) ||
    namaSimpan.includes('/') ||
    namaSimpan.includes('\\') ||
    namaSimpan.includes('..') ||
    namaSimpan.includes('\0')
  ) {
    throw new Error('Nama file lampiran tidak aman.');
  }

  const dasar = resolve(dir);
  const tujuan = resolve(dasar, namaSimpan);
  if (tujuan !== join(dasar, namaSimpan) || !tujuan.startsWith(`${dasar}${sep}`)) {
    throw new Error('Nama file lampiran tidak aman.');
  }
  return tujuan;
}

/**
 * Path absolut file lampiran untuk dibuka dengan aplikasi OS. Hanya menerima
 * `nama_simpan` (relatif) dari DB — renderer tidak pernah mengirim path.
 */
export function pathFileLampiran(dir: string, namaSimpan: string): string {
  const path = pathDiDalamFolder(dir, namaSimpan);
  if (!existsSync(path)) {
    throw new Error('File lampiran tidak ditemukan di folder aplikasi.');
  }
  return path;
}

/**
 * Salin file sumber ke folder lampiran secara atomik: tulis ke file `.tmp` di
 * folder yang sama lalu `rename` ke nama final. Bila gagal, file sementara dan
 * file final yang terlanjur dibuat dibersihkan (tidak ada file setengah jadi).
 */
export function simpanFileLampiran(
  dir: string,
  sumberPath: string,
  namaAsli: string,
  id: string,
): HasilSimpanFileLampiran {
  if (typeof sumberPath !== 'string' || !sumberPath.trim())
    throw new Error('File lampiran tidak bisa dibaca.');

  const sumber = resolve(sumberPath);
  let info: ReturnType<typeof statSync>;
  try {
    info = statSync(sumber);
  } catch {
    throw new Error('File lampiran tidak bisa dibaca. Coba pilih file lain.');
  }
  if (!info.isFile()) throw new Error('Lampiran harus berupa file, bukan folder.');

  const cek = validasiLampiran({ namaAsli, ukuran: info.size });
  if (!cek.ok) throw new Error(cek.error);

  const namaSimpan = namaSimpanAman(id, cek.namaAsli);
  mkdirSync(dir, { recursive: true });
  const tujuan = pathDiDalamFolder(dir, namaSimpan);
  if (existsSync(tujuan)) {
    throw new Error('File lampiran dengan nama yang sama sudah ada.');
  }

  const tmp = join(
    dir,
    `.tmp-${namaSimpan}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );

  try {
    copyFileSync(sumber, tmp);
    renameSync(tmp, tujuan);
    const ukuran = statSync(tujuan).size;
    return { namaSimpan, namaAsli: cek.namaAsli, mime: cek.mime, ukuran };
  } catch (e) {
    // Jangan tinggalkan file yatim, baik file sementara maupun final.
    rmSync(tmp, { force: true });
    rmSync(tujuan, { force: true });
    if (e instanceof Error && e.message.includes('File lampiran')) throw e;
    throw new Error('Gagal menyalin file lampiran ke folder aplikasi.');
  }
}

/** Baca isi file lampiran (untuk pratinjau/test); path selalu divalidasi. */
export function bacaFileLampiran(dir: string, namaSimpan: string): Buffer {
  return readFileSync(pathFileLampiran(dir, namaSimpan));
}

/** Hapus file lampiran best-effort; path tidak aman atau file hilang = false. */
export function hapusFileLampiran(dir: string, namaSimpan: string): boolean {
  try {
    const path = pathDiDalamFolder(dir, namaSimpan);
    rmSync(path, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Data URL untuk pratinjau gambar inline. PDF dan file > 5 MB tidak di-inline
 * (renderer memakai tombol Buka / aplikasi OS). Null bila tidak bisa dipratinjau.
 */
export function dataUrlLampiran(
  dir: string,
  namaSimpan: string,
  mime?: string,
): string | null {
  const mimeMentah = (mime ?? mimeDariNama(namaSimpan) ?? '').trim().toLowerCase();
  const mimeFinal = mimeMentah === 'image/jpg' ? 'image/jpeg' : mimeMentah;
  if (!mimeFinal.startsWith('image/')) return null;

  const path = pathFileLampiran(dir, namaSimpan);
  const info = statSync(path);
  if (info.size > MAKS_PREVIEW_LAMPIRAN) return null;

  return `data:${mimeFinal};base64,${readFileSync(path).toString('base64')}`;
}

/**
 * Urutan aman unggah: simpan file dulu, baru tulis metadata. Bila metadata
 * gagal (validasi DB/audit/unique), file yang sudah tersalin dihapus lagi agar
 * tidak ada lampiran yatim tanpa metadata.
 */
export function simpanLampiranDenganMetadata<T>(
  dir: string,
  sumberPath: string,
  namaAsli: string,
  id: string,
  simpanMetadata: (file: HasilSimpanFileLampiran) => T,
): T {
  let file: HasilSimpanFileLampiran | null = null;
  try {
    file = simpanFileLampiran(dir, sumberPath, namaAsli, id);
    return simpanMetadata(file);
  } catch (e) {
    if (file) hapusFileLampiran(dir, file.namaSimpan);
    throw e;
  }
}
