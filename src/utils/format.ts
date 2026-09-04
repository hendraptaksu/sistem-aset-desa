// Format Rupiah: Rp 1.500.000, negatif (defisit) wajib (Rp 100.000) — PRD §4.

const rp = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export function formatRp(n: number): string {
  if (n < 0) return `(Rp ${rp.format(Math.abs(n))})`;
  return `Rp ${rp.format(n)}`;
}
