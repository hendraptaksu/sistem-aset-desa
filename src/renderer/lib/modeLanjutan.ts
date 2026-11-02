// DB-26 — Mode lanjutan menyembunyikan Jurnal Umum dari operator harian.
// Preferensi bersifat per profil/browser dan disimpan seperti status lipat
// sidebar (localStorage), dengan default mati. Helper murni di bawah dipakai
// App/Pengaturan dan diuji tanpa DOM.

export const KUNCI_MODE_LANJUTAN = 'pura.mode.lanjutan';

/** Menu yang hanya boleh tampil saat Mode lanjutan aktif. */
export const MENU_MODE_LANJUTAN = ['jurnal'] as const;

/** Hanya butuh dua metode ini agar test bisa memakai penyimpanan palsu. */
export type PenyimpananMode = {
  getItem: (kunci: string) => string | null;
  setItem: (kunci: string, nilai: string) => void;
};

function penyimpananBrowser(): PenyimpananMode | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    // localStorage bisa diblokir; mode lanjutan tetap berfungsi tanpa persistensi.
    return null;
  }
}

/** Default mati: hanya nilai 'true' tersimpan yang menyalakan mode. */
export function bacaModeLanjutan(
  penyimpanan: PenyimpananMode | null = penyimpananBrowser(),
): boolean {
  if (!penyimpanan) return false;
  try {
    return penyimpanan.getItem(KUNCI_MODE_LANJUTAN) === 'true';
  } catch {
    return false;
  }
}

/** Tulis pilihan pengguna; kegagalan storage tidak boleh memblokir UI. */
export function simpanModeLanjutan(
  aktif: boolean,
  penyimpanan: PenyimpananMode | null = penyimpananBrowser(),
): void {
  if (!penyimpanan) return;
  try {
    penyimpanan.setItem(KUNCI_MODE_LANJUTAN, String(aktif));
  } catch {
    // Persistensi opsional; state React tetap mencerminkan pilihan saat ini.
  }
}

/** Jurnal Umum tidak pernah tampil di menu saat mode lanjutan mati. */
export function menuTerlihat(id: string, modeLanjutan: boolean): boolean {
  return modeLanjutan || !(MENU_MODE_LANJUTAN as readonly string[]).includes(id);
}

/**
 * Saat mode dimatikan, tab Jurnal tidak boleh tetap aktif tanpa jalan kembali.
 * Tab lain dibiarkan; tab Jurnal dipindah aman ke dashboard.
 */
export function tabSetelahModeLanjutan<T extends string>(
  tab: T,
  modeLanjutan: boolean,
): T | 'dashboard' {
  return !modeLanjutan && tab === 'jurnal' ? 'dashboard' : tab;
}
