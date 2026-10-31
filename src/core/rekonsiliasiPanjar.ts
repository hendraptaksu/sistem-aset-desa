// DB-19: rekonsiliasi rincian `panjar_item` dengan jurnal close.
//
// Jurnal tetap sumber total. `panjar_item` hanyalah subledger detail nota, jadi
// saat close dan saat audit keduanya harus memakai aturan pembanding yang sama:
// total item per akun BEBAN = total debit akun BEBAN pada jurnal close.
//
// Modul ini murni (tanpa DB) agar bisa dipakai builder close, adapter DB, dan
// test tanpa jalur perhitungan yang berbeda.

/** Satu baris item panjar yang sudah dinormalisasi ke akun + nominal. */
export type ItemRekonsiliasiPanjar = {
  akun: string;
  nominal: number;
};

/** Baris jurnal yang relevan; hanya sisi debit yang dibandingkan. */
export type BarisRekonsiliasiPanjar = {
  akun_kode: string;
  debit: number;
};

/** Total item vs jurnal untuk satu akun; `selisih = item - jurnal`. */
export type AkunRekonsiliasiPanjar = {
  akun: string;
  total_item: number;
  total_jurnal: number;
  selisih: number;
};

export type HasilRekonsiliasiPanjar = {
  /** `true` bila total dan setiap akun cocok. */
  ok: boolean;
  total_item: number;
  total_jurnal: number;
  selisih: number;
  /** Semua akun yang muncul di item atau jurnal, diurutkan kode akun. */
  per_akun: AkunRekonsiliasiPanjar[];
  /** Hanya akun yang selisihnya bukan nol. */
  akun_selisih: AkunRekonsiliasiPanjar[];
};

/**
 * Bandingkan total `panjar_item` per akun dengan debit jurnal close.
 *
 * - Item dihitung untuk SEMUA akun (termasuk akun rusak/non-BEBAN) supaya
 *   korupsi akun tidak lolos diam-diam.
 * - Jurnal hanya dihitung pada akun yang ada di `kodeBeban` (master akun tipe
 *   BEBAN). Debit kas untuk sisa panjar dan kredit 1040/kas tidak ikut.
 */
export function rekonsiliasiPanjar(
  items: readonly ItemRekonsiliasiPanjar[],
  barisJurnal: readonly BarisRekonsiliasiPanjar[],
  kodeBeban: ReadonlySet<string>,
): HasilRekonsiliasiPanjar {
  const perItem = new Map<string, number>();
  for (const it of items) {
    const akun = String(it.akun ?? '').trim();
    if (!akun) continue;
    perItem.set(akun, (perItem.get(akun) ?? 0) + it.nominal);
  }

  const perJurnal = new Map<string, number>();
  for (const b of barisJurnal) {
    if (!kodeBeban.has(b.akun_kode) || b.debit <= 0) continue;
    perJurnal.set(b.akun_kode, (perJurnal.get(b.akun_kode) ?? 0) + b.debit);
  }

  const akun = [...new Set([...perItem.keys(), ...perJurnal.keys()])].sort();
  const per_akun: AkunRekonsiliasiPanjar[] = akun.map((kode) => {
    const totalItem = perItem.get(kode) ?? 0;
    const totalJurnal = perJurnal.get(kode) ?? 0;
    return {
      akun: kode,
      total_item: totalItem,
      total_jurnal: totalJurnal,
      selisih: totalItem - totalJurnal,
    };
  });

  let total_item = 0;
  for (const n of perItem.values()) total_item += n;
  let total_jurnal = 0;
  for (const n of perJurnal.values()) total_jurnal += n;
  const akun_selisih = per_akun.filter((a) => a.selisih !== 0);

  return {
    ok: akun_selisih.length === 0 && total_item === total_jurnal,
    total_item,
    total_jurnal,
    selisih: total_item - total_jurnal,
    per_akun,
    akun_selisih,
  };
}

export type TotalAkunPanjar = {
  akun: string;
  /** Jumlah nominal item akun ini (sen). */
  nominal: number;
};

/**
 * Ringkasan turunan total `panjar_item` per akun (bukan kolom tersimpan).
 * Dipakai UI rincian dan test agar angka per akun tidak dihitung ulang dengan
 * cara berbeda di setiap tempat.
 */
export function totalPanjarPerAkun(
  items: readonly { kategori_baga: string; nominal: number }[],
): TotalAkunPanjar[] {
  const perAkun = new Map<string, number>();
  for (const it of items) {
    const akun = String(it.kategori_baga ?? '').trim();
    if (!akun) continue;
    perAkun.set(akun, (perAkun.get(akun) ?? 0) + it.nominal);
  }
  return [...perAkun.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([akun, nominal]) => ({ akun, nominal }));
}
