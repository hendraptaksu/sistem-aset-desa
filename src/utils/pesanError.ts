// Pesan error ramah operator awam (P1-12).
//
// Semua error dari main/IPC maupun renderer harus melewati helper ini sebelum
// ditampilkan. Operator utama bukan programmer: pesan SQLite, TypeError, path
// file, atau stack trace tidak boleh bocor ke layar. Pesan bisnis yang sudah
// berbahasa Indonesia tetap dipertahankan apa adanya.

export const PESAN_SIMPAN_GAGAL =
  'Terjadi kesalahan saat menyimpan. Coba lagi; bila tetap gagal, hubungi pendamping.';

export const PESAN_PROSES_GAGAL =
  'Terjadi kesalahan saat memproses permintaan. Coba lagi; bila tetap gagal, hubungi pendamping.';

export const PESAN_MUAT_GAGAL =
  'Terjadi kesalahan saat memuat data. Coba lagi; bila tetap gagal, hubungi pendamping.';

/** Satu-satunya pesan tanggal yang dipakai form, filter, dan IPC. */
export const PESAN_TANGGAL_TIDAK_VALID =
  'Tanggal belum diisi atau tidak valid. Pilih tanggal dari kalender.';

const MAKS_PESAN = 400;

/**
 * Pola yang menandakan pesan teknis (bukan kalimat bisnis Indonesia).
 * Sengaja dibuat luas: lebih baik operator melihat pesan generik daripada
 * detail internal database/runtime.
 */
const POLA_TEKNIS: readonly RegExp[] = [
  /SQLITE_[A-Z_]+/i,
  /SqliteError/i,
  /constraint failed/i,
  /UNIQUE constraint/i,
  /no such (table|column|function|index)/i,
  /undefined is not/i,
  /cannot read propert/i,
  /is not a function/i,
  /\bis not defined\b/i,
  /\bis not a constructor\b/i,
  /\b(TypeError|ReferenceError|RangeError|SyntaxError|EvalError|URIError)\b/,
  /\b(EACCES|ENOENT|EBUSY|EPERM|ENOSPC|EPIPE|ETIMEDOUT|ENOTFOUND|ECONN[A-Z]+|ERR_[A-Z_]+)\b/,
  /\b(error|failed|failure|invalid|unexpected|cannot|unable|timeout|network|denied|segfault|database|locked)\b/i,
  /\bdisk (i\/o|full)\b/i,
  /node_modules/i,
  /\/Users\//,
  /\b[A-Za-z]:\\/,
  /\/(?:private|var|tmp|home|opt)\//,
  /\.(ts|tsx|js|mjs|cjs):\d+(:\d+)?/,
  /\bat\s+[^\n]+\s+\([^)]*:\d+:\d+\)/,
  /integrity_check/i,
];

function teksAman(teks: string): boolean {
  if (!teks || teks.length > MAKS_PESAN) return false;
  if (/[\r\n]/.test(teks)) return false; // pesan operator cukup satu baris
  return !POLA_TEKNIS.some((pola) => pola.test(teks));
}

/**
 * Ubah error apa pun menjadi pesan yang aman ditampilkan.
 *
 * - `Error` dengan pesan bisnis Indonesia yang aman → pesan itu.
 * - Error teknis (SQLite/TypeError/path/stack) atau non-Error → `fallback`.
 */
export function pesanError(e: unknown, fallback: string = PESAN_SIMPAN_GAGAL): string {
  const cadangan = String(fallback ?? '').trim() || PESAN_SIMPAN_GAGAL;
  if (e instanceof Error) {
    const mentah = String(e.message ?? '');
    // Stack trace / pesan multi-baris tidak boleh disusun ulang menjadi kalimat.
    if (/[\r\n]/.test(mentah)) return cadangan;
    const pesan = mentah.replace(/\s+/g, ' ').trim();
    if (teksAman(pesan)) return pesan;
  }
  return cadangan;
}

/**
 * Gabungkan pesan validasi: buang kosong & duplikat, batasi jumlah agar kotak
 * error tetap terbaca. Mengembalikan string kosong bila tidak ada pesan.
 */
export function pesanValidasi(errors: readonly string[] | null | undefined, maks = 5): string {
  if (!Array.isArray(errors)) return '';
  const batas = Number.isInteger(maks) && maks > 0 ? maks : 5;
  const terlihat = new Set<string>();
  const unik: string[] = [];
  for (const nilai of errors) {
    if (typeof nilai !== 'string') continue;
    const teks = nilai.replace(/\s+/g, ' ').trim();
    if (!teks) continue;
    const kunci = teks.toLowerCase();
    if (terlihat.has(kunci)) continue;
    terlihat.add(kunci);
    unik.push(teks);
  }
  if (unik.length === 0) return '';
  const tampil = unik.slice(0, batas);
  const sisa = unik.length - tampil.length;
  if (sisa > 0) tampil.push(`(dan ${sisa} pesan lainnya)`);
  return tampil.join(' ');
}
