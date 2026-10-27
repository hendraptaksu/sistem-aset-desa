// AUD-34 — helper log yang aman dipakai renderer maupun main.
//
// Log hanya untuk diagnosis teknis. Jangan pernah mengirim PIN, hash, isi
// jurnal, atau data pribadi ke log. Semua teks tetap dilewatkan `redaksiLog`
// sebagai jaring pengaman terakhir agar nilai rahasia yang tidak sengaja ikut
// di pesan error tidak tersimpan permanen.

/** Kunci yang nilainya tidak boleh masuk log. */
const KUNCI_SENSITIF =
  String.raw`pin(?:\s*(?:baru|lama))?|pinBaru|pinLama|password|passphrase|kata[\s_-]*sandi|kataSandi|hash|salt|token|secret|rahasia`;

const POLA_NILAI_SENSITIF = new RegExp(
  String.raw`(["']?(?:${KUNCI_SENSITIF})["']?)\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)`,
  'gi',
);

/** Hash/salt heksadesimal panjang (mis. SHA-256) tidak pernah ditulis utuh. */
const POLA_HEX_PANJANG = /\b[a-f0-9]{32,}\b/gi;

const POLA_BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const POLA_BASIC = /\bBasic\s+[A-Za-z0-9+/=]+/gi;

/**
 * Samarkan nilai rahasia yang berbentuk `kunci: nilai` / `kunci=nilai`,
 * bearer token, dan hash panjang. Teks biasa tidak diubah sehingga log tetap
 * berguna (mis. nama file backup, mode lokasi data, kode error).
 */
export function redaksiLog(teks: string): string {
  return String(teks ?? '')
    .replace(POLA_NILAI_SENSITIF, '$1=[disunting]')
    .replace(POLA_BEARER, 'Bearer [disunting]')
    .replace(POLA_BASIC, 'Basic [disunting]')
    .replace(POLA_HEX_PANJANG, '[disunting]');
}

/** Ratakan teks menjadi satu baris agar satu kejadian = satu baris log. */
export function satuBaris(teks: string): string {
  return String(teks ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Deskripsi error untuk log (bukan untuk layar operator). Stack dipertahankan
 * karena justru itu yang dibutuhkan pendamping; nilai sensitif disamarkan
 * setelahnya oleh `redaksiLog`.
 */
export function deskripsiError(error: unknown): string {
  if (error instanceof Error) {
    const nama = error.name || 'Error';
    const pesan = error.message ? `${nama}: ${error.message}` : nama;
    return error.stack && error.stack.trim() ? error.stack : pesan;
  }
  if (typeof error === 'string') return error;
  if (error === undefined) return 'undefined';
  if (error === null) return 'null';
  if (
    typeof error === 'number' ||
    typeof error === 'boolean' ||
    typeof error === 'bigint'
  ) {
    return String(error);
  }
  if (typeof error === 'symbol') return error.toString();
  try {
    return JSON.stringify(error);
  } catch {
    return Object.prototype.toString.call(error);
  }
}
