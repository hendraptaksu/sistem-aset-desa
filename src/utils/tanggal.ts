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
