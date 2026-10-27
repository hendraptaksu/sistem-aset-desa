// Kunci periode longgar (tutup buku) — murni, tanpa dependency DB/Electron.

/** Tahun terakhir yang sudah tutup. Null = belum pernah tutup. */
export function tahunTutupTerakhir(tutup: ReadonlyArray<{ tahun: number }>): number | null {
  if (tutup.length === 0) return null;
  return Math.max(...tutup.map((t) => t.tahun));
}

/** Apakah tanggal masuk periode terkunci (<= 31-12 tahun tutup terakhir)? */
export function isPeriodeTerkunci(
  tanggal: string,
  tutup: ReadonlyArray<{ tahun: number }>,
): boolean {
  const last = tahunTutupTerakhir(tutup);
  if (last === null) return false;
  return tanggal <= `${last}-12-31`;
}

/**
 * Validasi simpan dengan kunci longgar: boleh simpan, tapi jika periode terkunci
 * wajib ada alasan (dicatat ke audit_log oleh caller).
 */
export function validasiSimpanLonggar(
  tanggal: string,
  tutup: ReadonlyArray<{ tahun: number }>,
  alasan?: string,
): { boleh: boolean; perluAlasan: boolean; error?: string } {
  if (!isPeriodeTerkunci(tanggal, tutup)) return { boleh: true, perluAlasan: false };
  if (!alasan || alasan.trim().length < 5)
    return { boleh: false, perluAlasan: true, error: 'Periode sudah ditutup: wajib isi alasan ≥5 karakter.' };
  return { boleh: true, perluAlasan: true };
}
