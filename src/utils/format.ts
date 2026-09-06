// Satuan nominal aplikasi = SEN (integer). 1 Rp = 100 sen.

const rp2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatRp(sen: number): string {
  if (sen < 0) return `(Rp ${rp2.format(Math.abs(sen) / 100)})`;
  return `Rp ${rp2.format(sen / 100)}`;
}

const persen1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Persen gaya Indonesia: `4.7` → `'4,7%'`, `100` → `'100,0%'`. */
export function formatPersen(persen: number): string {
  return `${persen1.format(persen)}%`;
}

const ISO_TGL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** '2026-01-05' → '05-01-2026'. Input tak cocok dikembalikan apa adanya. */
export function formatTanggal(iso: string): string {
  const m = ISO_TGL.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Parse nominal gaya Indonesia ke SEN.
 * '1500' → 150000, '1.500' → 150000, '1500,50' → 150050, '' → 0.
 * Throw Error (pesan Indonesia) untuk huruf, >2 digit desimal, negatif.
 */
export function parseRupiahToSen(s: string): number {
  const t = s.trim();
  if (t === '') return 0;
  if (!/^[0-9.]+(,[0-9]{1,2})?$/.test(t)) throw new Error('Nominal tidak valid (cth: 1.500 atau 1.500,50).');
  const [bulat, koma = ''] = t.split(',');
  const digit = bulat!.replace(/\./g, '');
  if (digit === '') throw new Error('Nominal tidak valid (cth: 1.500 atau 1.500,50).');
  const rupiah = Number(digit);
  if (!Number.isSafeInteger(rupiah)) throw new Error('Nominal tidak valid (cth: 1.500 atau 1.500,50).');
  return rupiah * 100 + Number((koma + '00').slice(0, 2));
}
