// Satuan nominal aplikasi = SEN (integer). 1 Rp = 100 sen.

const rp0 = new Intl.NumberFormat('id-ID', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const rp2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Rupiah bulat tampil tanpa `,00`; pecahan sen tetap dua desimal.
 * Negatif memakai kurung gaya akuntansi, mis. `(Rp 1.500.000)`.
 * Ekspor Excel sengaja tidak memakai fungsi ini (lihat `NUMFMT_RP`). */
export function formatRp(sen: number): string {
  const abs = Math.abs(sen);
  const nominal = abs % 100 === 0 ? rp0.format(abs / 100) : rp2.format(abs / 100);
  return sen < 0 ? `(Rp ${nominal})` : `Rp ${nominal}`;
}

const persen1 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Persen gaya Indonesia: `4.7` → `'4,7%'`, `100` → `'100,0%'`. */
export function formatPersen(persen: number): string {
  return `${persen1.format(persen)}%`;
}

const ISO_TGL = /^(\d{4})-(\d{2})-(\d{2})$/;

const NAMA_BULAN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

/** '2026-01-05' → '5 Jan 2026'. Input tak cocok/di luar rentang dikembalikan apa adanya. */
export function formatTanggal(iso: string): string {
  const m = ISO_TGL.exec(iso);
  if (!m) return iso;
  const tahun = m[1]!;
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  const namaBulan = NAMA_BULAN[bulan - 1];
  if (!namaBulan || hari < 1 || hari > 31) return iso;
  return `${hari} ${namaBulan} ${tahun}`;
}

/**
 * Parse nominal final gaya Indonesia ke SEN (parser ketat).
 * '1500' → 150000, '1.500' → 150000, '1500,50' → 150050, '' → 0.
 * Throw Error (pesan Indonesia) untuk huruf, >2 digit desimal, negatif.
 * Dipakai pencarian jurnal; input live memakai `parseCurrencyInput` yang
 * menerima ketikan parsial (mis. koma di akhir).
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
