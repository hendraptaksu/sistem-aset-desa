// P2-4 — aturan murni lampiran bukti jurnal.
//
// Lampiran adalah FILE di folder aplikasi (`userData/attachments`), bukan blob
// di DB. Modul ini hanya mengurus aturan nama/ekstensi/mime/ukuran supaya
// renderer, main, dan adapter DB memakai aturan yang sama. Tidak mengimpor
// Electron maupun `node:fs` agar aman diuji tanpa runtime Electron.

export const MAKS_UKURAN_LAMPIRAN = 10 * 1024 * 1024; // 10 MB
/** Batas pratinjau inline di renderer; file lebih besar dibuka via aplikasi OS. */
export const MAKS_PREVIEW_LAMPIRAN = 5 * 1024 * 1024; // 5 MB

export const EKSTENSI_LAMPIRAN = ['jpg', 'jpeg', 'png', 'webp', 'pdf'] as const;
export type EkstensiLampiran = (typeof EKSTENSI_LAMPIRAN)[number];

const MIME_PER_EKSTENSI: Record<EkstensiLampiran, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
};

export const PESAN_NAMA_LAMPIRAN_KOSONG = 'Nama file lampiran wajib diisi.';
export const PESAN_NAMA_LAMPIRAN_TIDAK_AMAN = 'Nama file lampiran tidak aman.';
export const PESAN_JENIS_LAMPIRAN =
  'Jenis file tidak didukung. Gunakan foto JPG/JPEG/PNG/WEBP atau PDF.';
export const PESAN_UKURAN_LAMPIRAN = 'Ukuran lampiran maksimal 10 MB.';
export const PESAN_FILE_KOSONG = 'File lampiran kosong.';
export const PESAN_MIME_LAMPIRAN = 'Jenis file (MIME) tidak cocok dengan ekstensi lampiran.';

export type HasilValidasiLampiran =
  | {
      ok: true;
      namaAsli: string;
      ekstensi: EkstensiLampiran;
      mime: string;
      ukuran: number;
    }
  | { ok: false; error: string };

/** Ekstensi lowercase tanpa titik; string kosong bila tidak ada ekstensi. */
export function normalisasiEkstensi(namaAsli: string): string {
  if (typeof namaAsli !== 'string') return '';
  const nama = namaAsli.trim();
  const titik = nama.lastIndexOf('.');
  if (titik < 0 || titik === nama.length - 1) return '';
  return nama.slice(titik + 1).toLowerCase();
}

/** MIME resmi untuk nama file yang didukung; null bila ekstensi tidak dikenal. */
export function mimeDariNama(namaAsli: string): string | null {
  const ekstensi = normalisasiEkstensi(namaAsli);
  return (MIME_PER_EKSTENSI as Record<string, string>)[ekstensi] ?? null;
}

function ekstensiDidukung(ekstensi: string): ekstensi is EkstensiLampiran {
  return (EKSTENSI_LAMPIRAN as readonly string[]).includes(ekstensi);
}

function normalisasiMime(mime: string): string {
  const bersih = mime.trim().toLowerCase().split(';')[0]?.trim() ?? '';
  // Sebagian sistem operasi masih mengirim alias non-standar ini.
  return bersih === 'image/jpg' ? 'image/jpeg' : bersih;
}

function cekNama(namaAsli: unknown): { ok: true; nama: string } | { ok: false; error: string } {
  if (typeof namaAsli !== 'string') return { ok: false, error: PESAN_NAMA_LAMPIRAN_KOSONG };
  const nama = namaAsli.trim();
  if (!nama) return { ok: false, error: PESAN_NAMA_LAMPIRAN_KOSONG };
  // Nama asli hanya untuk ditampilkan; tetap tolak separator/traversal agar
  // tidak ada pemanggil yang menganggapnya path.
  if (
    nama.includes('/') ||
    nama.includes('\\') ||
    nama.includes('..') ||
    nama.includes('\0') ||
    /[\r\n]/.test(nama)
  ) {
    return { ok: false, error: PESAN_NAMA_LAMPIRAN_TIDAK_AMAN };
  }
  return { ok: true, nama };
}

/**
 * Validasi lampiran dari dialog unggah. Ekstensi menentukan MIME resmi; `mime`
 * opsional hanya untuk memastikan file yang dikirim pemanggil cocok.
 */
export function validasiLampiran(input: {
  namaAsli: string;
  ukuran: number;
  mime?: string;
}): HasilValidasiLampiran {
  const nama = cekNama(input?.namaAsli);
  if (!nama.ok) return nama;

  const ukuran = input?.ukuran;
  if (typeof ukuran !== 'number' || !Number.isSafeInteger(ukuran) || ukuran < 0) {
    return { ok: false, error: 'Ukuran file lampiran tidak valid.' };
  }
  if (ukuran === 0) return { ok: false, error: PESAN_FILE_KOSONG };
  if (ukuran > MAKS_UKURAN_LAMPIRAN) return { ok: false, error: PESAN_UKURAN_LAMPIRAN };

  const ekstensi = normalisasiEkstensi(nama.nama);
  if (!ekstensiDidukung(ekstensi)) return { ok: false, error: PESAN_JENIS_LAMPIRAN };
  const mimeResmi = MIME_PER_EKSTENSI[ekstensi];

  if (input.mime !== undefined && input.mime !== null) {
    if (typeof input.mime !== 'string') {
      return { ok: false, error: PESAN_MIME_LAMPIRAN };
    }
    const mime = normalisasiMime(input.mime);
    if (mime && mime !== mimeResmi) {
      return { ok: false, error: PESAN_MIME_LAMPIRAN };
    }
  }

  return {
    ok: true,
    namaAsli: nama.nama,
    ekstensi,
    mime: mimeResmi,
    ukuran,
  };
}

/**
 * Nama file fisik yang aman & deterministik: `<id>.<ekstensi>`. Nama asli
 * sengaja TIDAK dipakai sebagai nama file, sehingga path traversal, spasi,
 * karakter aneh, dan tabrakan nama tidak mungkin terjadi. ID hanya boleh huruf,
 * angka, `-`, `_`; argumen tidak aman ditolak dengan error Indonesia.
 */
export function namaSimpanAman(id: string, namaAsli: string): string {
  const idAman = typeof id === 'string' ? id.trim() : '';
  if (!idAman) throw new Error('ID lampiran wajib diisi.');
  if (idAman.length > 120) throw new Error('ID lampiran terlalu panjang.');
  if (!/^[A-Za-z0-9_-]+$/.test(idAman))
    throw new Error('ID lampiran tidak aman (hanya huruf, angka, - dan _).');

  const nama = cekNama(namaAsli);
  if (!nama.ok) throw new Error(nama.error);
  const ekstensi = normalisasiEkstensi(nama.nama);
  if (!ekstensiDidukung(ekstensi)) throw new Error(PESAN_JENIS_LAMPIRAN);

  return `${idAman}.${ekstensi}`;
}

const formatAngka = new Intl.NumberFormat('id-ID', {
  maximumFractionDigits: 1,
});

/** Ukuran file untuk UI: byte/KB/MB dengan desimal gaya Indonesia. */
export function formatUkuranFile(bytes: number): string {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '0 B';
  if (n < 1024) return `${Math.trunc(n)} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${formatAngka.format(kb)} KB`;
  return `${formatAngka.format(kb / 1024)} MB`;
}
