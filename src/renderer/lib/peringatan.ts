// AKT-07: guard sisi renderer untuk alasan konfirmasi peringatan posting.
//
// Peringatan (mis. kas minus) tetap boleh dilanjutkan, tetapi operator wajib
// menuliskan alasan minimal 5 karakter. Alasan ini BUKAN alasan kunci periode:
// alasan kunci dikirim lewat field jurnal `alasan`, sedangkan alasan peringatan
// lewat opsi IPC `alasanPeringatan` dan tercatat di audit.

export const MIN_ALASAN_PERINGATAN = 5;

export const PESAN_ALASAN_PERINGATAN_MIN =
  'Konfirmasi peringatan wajib disertai alasan minimal 5 karakter.';

export function rapikanAlasanPeringatan(
  alasan: string | null | undefined,
): string {
  return String(alasan ?? '').trim();
}

export function alasanPeringatanCukup(
  alasan: string | null | undefined,
): boolean {
  return rapikanAlasanPeringatan(alasan).length >= MIN_ALASAN_PERINGATAN;
}

export type OpsiPeringatanApi = {
  alasanPeringatan?: string;
  wajibAlasanPeringatan: true;
};

/**
 * Opsi IPC konfirmasi peringatan. `wajibAlasanPeringatan` selalu dikirim agar
 * backend menolak alasan yang kurang; alasan dikirim setelah di-trim. Modal di
 * UI sudah menonaktifkan tombol sebelum alasan mencapai 5 karakter.
 */
export function opsiPeringatanApi(
  alasan?: string | null,
): OpsiPeringatanApi {
  const bersih = rapikanAlasanPeringatan(alasan);
  return {
    ...(bersih ? { alasanPeringatan: bersih } : {}),
    wajibAlasanPeringatan: true,
  };
}
