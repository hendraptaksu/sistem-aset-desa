// Helper tanggal bisnis berbasis zona waktu aplikasi (WITA).
// Aman untuk main + renderer: hanya memakai Date/Intl, tanpa Node/Electron API.
// Tanggal bisnis TIDAK boleh diambil dari toISOString() karena itu UTC.

export const ZONA_WAKTU_APP = 'Asia/Makassar';

const cacheTanggal = new Map<string, Intl.DateTimeFormat>();
const cacheWaktu = new Map<string, Intl.DateTimeFormat>();

function formatterTanggal(timeZone: string): Intl.DateTimeFormat {
  let formatter = cacheTanggal.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    cacheTanggal.set(timeZone, formatter);
  }
  return formatter;
}

function formatterWaktu(timeZone: string): Intl.DateTimeFormat {
  let formatter = cacheWaktu.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      // h23 memastikan tengah malam tampil 00:xx, bukan 24:xx.
      hourCycle: 'h23',
    });
    cacheWaktu.set(timeZone, formatter);
  }
  return formatter;
}

function keDate(now?: Date | number): Date {
  if (now === undefined) return new Date();
  return typeof now === 'number' ? new Date(now) : now;
}

function pastikanValid(tanggal: Date): Date {
  if (Number.isNaN(tanggal.getTime())) throw new RangeError('Tanggal tidak valid.');
  return tanggal;
}

function bagianTanggal(
  formatter: Intl.DateTimeFormat,
  tanggal: Date,
): Record<string, string> {
  const bagian: Record<string, string> = {};
  for (const part of formatter.formatToParts(tanggal)) {
    if (part.type !== 'literal') bagian[part.type] = part.value;
  }
  return bagian;
}

/** Tanggal bisnis lokal `YYYY-MM-DD` (default WITA). */
export function tanggalLokal(now?: Date | number, timeZone = ZONA_WAKTU_APP): string {
  const bagian = bagianTanggal(formatterTanggal(timeZone), pastikanValid(keDate(now)));
  return `${bagian.year}-${bagian.month}-${bagian.day}`;
}

/** Tahun bisnis lokal (default WITA). */
export function tahunLokal(now?: Date | number, timeZone = ZONA_WAKTU_APP): number {
  const bagian = bagianTanggal(formatterTanggal(timeZone), pastikanValid(keDate(now)));
  return Number(bagian.year);
}

/**
 * Waktu audit ISO → `YYYY-MM-DD HH:mm` dalam zona lokal (default WITA).
 * Input yang tidak bisa diparse dikembalikan apa adanya.
 */
export function formatWaktuLokal(iso: string, timeZone = ZONA_WAKTU_APP): string {
  const tanggal = new Date(iso);
  if (Number.isNaN(tanggal.getTime())) return String(iso ?? '');
  const bagian = bagianTanggal(formatterWaktu(timeZone), tanggal);
  return `${bagian.year}-${bagian.month}-${bagian.day} ${bagian.hour}:${bagian.minute}`;
}

const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Pecah `YYYY-MM-DD` menjadi komponen kalender yang valid. */
function komponenTanggal(tanggal: string): {
  tahun: number;
  bulan: number;
  hari: number;
} {
  const m = POLA_TANGGAL.exec(String(tanggal ?? ''));
  if (!m) throw new RangeError('Tanggal tidak valid.');
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  const cek = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (
    tahun < 1900 ||
    tahun > 9999 ||
    cek.getUTCFullYear() !== tahun ||
    cek.getUTCMonth() !== bulan - 1 ||
    cek.getUTCDate() !== hari
  ) {
    throw new RangeError('Tanggal tidak valid.');
  }
  return { tahun, bulan, hari };
}

/**
 * Tengah malam lokal → instant UTC, tanpa bergantung zona waktu mesin.
 * Offset dihitung dari `Intl` untuk zona aplikasi (WITA tidak punya DST).
 */
function tengahMalamLokalKeUtc(
  tahun: number,
  bulan: number,
  hari: number,
  timeZone: string,
): Date {
  const tebakan = Date.UTC(tahun, bulan - 1, hari);
  const bagian = bagianTanggal(formatterWaktu(timeZone), new Date(tebakan));
  const lokalSebagaiUtc = Date.UTC(
    Number(bagian.year),
    Number(bagian.month) - 1,
    Number(bagian.day),
    Number(bagian.hour),
    Number(bagian.minute),
  );
  return new Date(tebakan - (lokalSebagaiUtc - tebakan));
}

/**
 * Batas bawah (inklusif) satu tanggal lokal dalam ISO UTC.
 * Contoh WITA: `2026-10-23` → `2026-10-22T16:00:00.000Z`.
 */
export function awalHariLokalUtc(tanggal: string, timeZone = ZONA_WAKTU_APP): string {
  const { tahun, bulan, hari } = komponenTanggal(tanggal);
  return tengahMalamLokalKeUtc(tahun, bulan, hari, timeZone).toISOString();
}

/**
 * Batas atas eksklusif satu tanggal lokal dalam ISO UTC
 * (setara 23:59:59.999 lokal). Contoh WITA: `2026-10-23` →
 * `2026-10-23T16:00:00.000Z`.
 */
export function akhirHariLokalUtc(tanggal: string, timeZone = ZONA_WAKTU_APP): string {
  const { tahun, bulan, hari } = komponenTanggal(tanggal);
  return tengahMalamLokalKeUtc(tahun, bulan, hari + 1, timeZone).toISOString();
}
