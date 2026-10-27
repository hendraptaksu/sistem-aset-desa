// UI-02 — ukuran minimum & default jendela utama. Fungsi murni agar bisa
// diuji tanpa menjalankan Electron; `createWindow` hanya meneruskan work area
// layar aktif dari `screen.getPrimaryDisplay().workAreaSize`.

export type UkuranLayar = {
  width: number;
  height: number;
};

export const MIN_LEBAR_JENDELA = 1024;
export const MIN_TINGGI_JENDELA = 680;
export const DEFAULT_LEBAR_JENDELA = 1240;
export const DEFAULT_TINGGI_JENDELA = 760;

/** Jarak aman dari tiap tepi work area (dikurangi 2× per dimensi). */
export const MARGIN_LAYAR_PX = 16;

export type OpsiUkuranJendela = {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
};

/**
 * Batas ruang yang tersedia di work area. Work area Windows sudah mengecualikan
 * taskbar, jadi tinggi efektif 1366×768 biasanya hanya ~728 px.
 */
function batasKerja(ukuran: number | undefined, margin: number): number {
  if (ukuran === undefined || !Number.isFinite(ukuran) || ukuran <= 0) return 0;
  return Math.floor(ukuran - margin * 2);
}

function dimensi(
  nilaiDefault: number,
  nilaiMinimum: number,
  batas: number,
): number {
  // Tanpa info layar yang valid, pakai default; jangan pernah menghasilkan
  // window lebih kecil dari minimum yang dijanjikan ke pengguna.
  if (batas <= 0) return nilaiDefault;
  return Math.max(nilaiMinimum, Math.min(nilaiDefault, batas));
}

/**
 * Opsi `width`/`height`/`minWidth`/`minHeight` untuk BrowserWindow utama.
 * Default 1240×760, tetapi diperkecil agar muat di work area (mis. 1366×768)
 * dengan margin kecil. Minimum tetap 1024×680 agar layout tidak rusak.
 */
export function opsiUkuranJendela(workArea?: Partial<UkuranLayar>): OpsiUkuranJendela {
  const lebarKerja = batasKerja(workArea?.width, MARGIN_LAYAR_PX);
  const tinggiKerja = batasKerja(workArea?.height, MARGIN_LAYAR_PX);
  return {
    width: dimensi(DEFAULT_LEBAR_JENDELA, MIN_LEBAR_JENDELA, lebarKerja),
    height: dimensi(DEFAULT_TINGGI_JENDELA, MIN_TINGGI_JENDELA, tinggiKerja),
    minWidth: MIN_LEBAR_JENDELA,
    minHeight: MIN_TINGGI_JENDELA,
  };
}
