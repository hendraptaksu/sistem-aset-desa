// AUD-16: layar pemulihan saat database gagal dibuka.
//
// Modul ini sengaja murni (tanpa Electron) agar pesan dan alur retry bisa
// diuji tanpa runtime GUI. Main process hanya menyediakan dialog, folder
// backup, dan aksi keluar lewat dependency injection.

export const JUDUL_PEMULIHAN_DB = 'Pemulihan Database';
export const PESAN_GAGAL_BUKA_DB = 'Database tidak dapat dibuka';
export const TOMBOL_BUKA_BACKUP = 'Buka folder backup';
export const TOMBOL_COBA_LAGI = 'Coba lagi';
export const TOMBOL_KELUAR = 'Keluar';

export type AksiPemulihanDb = 'bukaBackup' | 'cobaLagi' | 'keluar';

/** Urutan tombol dialog: 0 = buka backup, 1 = coba lagi, 2 = keluar. */
export function aksiPemulihanDariRespons(respons: number): AksiPemulihanDb {
  if (respons === 0) return 'bukaBackup';
  if (respons === 1) return 'cobaLagi';
  // Respons di luar jendela (misalnya dialog ditutup) selalu aman: keluar.
  return 'keluar';
}

function lokasiTampil(lokasi: string): string {
  const teks =
    typeof lokasi === 'string' ? lokasi.replace(/[\r\n]+/g, ' ').trim() : '';
  return teks || '(lokasi tidak diketahui)';
}

/** Kode error hanya dipakai untuk memilih petunjuk umum, tidak pernah ditampilkan. */
function kodeError(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const kode = (error as { code?: unknown }).code;
  return typeof kode === 'string' && /^[A-Z][A-Z0-9_]{1,31}$/.test(kode) ? kode : '';
}

function petunjukAman(error: unknown): string {
  const kode = kodeError(error);
  if (kode === 'SQLITE_NOTADB' || kode === 'SQLITE_CORRUPT' || kode === 'SQLITE_FORMAT') {
    return 'File database tampaknya rusak atau bukan file database SQLite.';
  }
  if (kode === 'ENOSPC' || kode === 'SQLITE_FULL') {
    return 'Ruang penyimpanan mungkin penuh. Kosongkan sebagian ruang disk lalu coba lagi.';
  }
  if (kode === 'EACCES' || kode === 'EPERM' || kode === 'EROFS') {
    return 'Aplikasi tidak punya izin menulis ke lokasi database.';
  }
  if (kode === 'EBUSY' || kode === 'SQLITE_BUSY' || kode === 'SQLITE_LOCKED') {
    return 'File database sedang dipakai proses lain atau terkunci.';
  }
  return 'File database mungkin rusak, sedang dipakai aplikasi lain, atau tidak dapat ditulis.';
}

/** Teks error hanya untuk deteksi internal; tidak pernah ditampilkan. */
function teksError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const pesan = (error as { message?: unknown }).message;
    if (typeof pesan === 'string') return pesan;
  }
  return '';
}

function dbTidakKompatibel(error: unknown): boolean {
  const teks = teksError(error).toLowerCase();
  return teks.includes('tidak kompatibel') || teks.includes('hanya mendukung skema');
}

/**
 * Pesan khusus untuk DB lama yang valid tetapi berskema tidak didukung.
 * Tidak menyebut "rusak" karena file lama belum tentu bermasalah: aplikasi
 * sengaja tidak memigrasikannya.
 */
function pesanDbTidakKompatibel(lokasi: string): string {
  return [
    'Data Anda tidak dihapus oleh aplikasi.',
    'Database ini dibuat oleh aplikasi versi lama dengan skema yang tidak didukung. Aplikasi ini hanya mendukung skema v1.',
    `Pindahkan atau hapus file database di lokasi berikut, lalu jalankan aplikasi lagi: ${lokasiTampil(lokasi)}`,
    'Bila data lama masih dibutuhkan, salin file tersebut ke tempat lain sebelum memindahkan atau menghapusnya.',
    'Bila masih gagal, klik "Keluar" lalu hubungi pendamping.',
  ].join('\n');
}

/**
 * Pesan layar pemulihan yang ramah operator.
 *
 * `error` TIDAK pernah disalin ke pesan: stack trace, SQL, path internal, dan
 * kode SQLite mentah tidak boleh terlihat oleh pengguna. Hanya kode error yang
 * dikenal yang dipetakan menjadi petunjuk umum. Path database aktif selalu
 * ditampilkan agar operator tahu file mana yang harus dipulihkan.
 */
export function pesanGagalBukaDb(error: unknown, lokasi: string): string {
  if (dbTidakKompatibel(error)) return pesanDbTidakKompatibel(lokasi);
  return [
    'Data Anda tidak dihapus oleh aplikasi.',
    petunjukAman(error),
    `Lokasi database: ${lokasiTampil(lokasi)}`,
    'Buka folder backup, salin file backup yang diinginkan ke lokasi database di atas, lalu klik "Coba lagi".',
    'Bila masih gagal, klik "Keluar" lalu hubungi pendamping.',
  ].join('\n');
}

export type OpsiBukaDbDenganPemulihan<T> = {
  /** Percobaan membuka database; boleh melempar error. */
  buka: () => T;
  /** Tampilkan layar pemulihan dan kembalikan pilihan pengguna. */
  tanya: (error: unknown) => Promise<AksiPemulihanDb>;
  /** Buka folder backup untuk pengguna. */
  bukaFolderBackup: () => Promise<void>;
  /** Dipanggil sekali bila pengguna memilih Keluar. */
  keluar: () => void;
};

/**
 * Buka database dengan layar pemulihan.
 *
 * Retry HANYA terjadi setelah pengguna menekan "Coba lagi"; tidak ada retry
 * otomatis berulang. Pilihan "Buka folder backup" membuka folder lalu
 * menampilkan layar yang sama lagi, sehingga pengguna tetap bisa memilih
 * "Coba lagi" atau "Keluar". Mengembalikan `null` bila pengguna keluar.
 */
export async function bukaDbDenganPemulihan<T>(
  opsi: OpsiBukaDbDenganPemulihan<T>,
): Promise<T | null> {
  for (;;) {
    try {
      return opsi.buka();
    } catch (error) {
      let aksi = await opsi.tanya(error);
      while (aksi === 'bukaBackup') {
        await opsi.bukaFolderBackup();
        aksi = await opsi.tanya(error);
      }
      if (aksi === 'keluar') {
        opsi.keluar();
        return null;
      }
    }
  }
}
