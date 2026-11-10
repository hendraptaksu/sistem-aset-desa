// T-A16: ringkasan hasil audit startup untuk banner renderer.
//
// Modul ini murni (tanpa akses DB/Electron) agar aman diimpor renderer dan
// main process. Sumber temuan tetap `src/db/integritas.ts`; di sini hanya
// memilih temuan teratas dan menandai kode kritis, tanpa mengubah/memperbaiki
// data apa pun.

import type {
  HasilAuditIntegritas,
  KodeTemuan,
  Temuan,
} from '../db/integritas.js';

/**
 * Temuan yang menandakan angka laporan/pembukaan tidak dapat dipercaya.
 * Banner memberi warna merah bila salah satu kode ini muncul; temuan lain
 * tetap ditampilkan sebagai peringatan kuning.
 */
export const KODE_AUDIT_KRITIS = [
  'NERACA_TIDAK_SEIMBANG',
  'NERACA_SALDO_SELISIH',
  'SNAPSHOT_TUTUP_BERUBAH',
  'PEMBUKAAN_AKTIF_HILANG',
  'CUTOVER_TIDAK_KONSISTEN',
] as const satisfies readonly KodeTemuan[];

export type KodeAuditKritis = (typeof KODE_AUDIT_KRITIS)[number];

const HIMPUNAN_KRITIS = new Set<string>(KODE_AUDIT_KRITIS);

/** `true` bila temuan termasuk kategori kritis yang butuh peringatan kuat. */
export function temuanKritis(temuan: Pick<Temuan, 'kode'>): boolean {
  return HIMPUNAN_KRITIS.has(temuan.kode);
}

export type RingkasanAuditAwal = {
  /** Jumlah seluruh temuan, bukan hanya yang ditampilkan. */
  jumlahTemuan: number;
  /** Maksimal 5 temuan teratas (kode + pesan) untuk banner. */
  temuanTampil: Temuan[];
  /** Kode kritis unik yang muncul; kosong berarti semua temuan non-kritis. */
  kodeKritis: KodeTemuan[];
  /** `true` bila ada setidaknya satu temuan kritis. */
  adaKritis: boolean;
};

/**
 * Ringkas hasil audit startup untuk banner. Mengembalikan `null` bila audit
 * tidak tersedia atau tidak ada temuan, sehingga DB bersih tidak menampilkan
 * gangguan apa pun.
 */
export function ringkasanAuditAwal(
  hasil: HasilAuditIntegritas | null | undefined,
  maksTemuan = 5,
): RingkasanAuditAwal | null {
  if (!hasil || hasil.temuan.length === 0) return null;

  const batas = Math.max(0, Math.trunc(maksTemuan));
  const kodeKritis = [
    ...new Set(
      hasil.temuan.map((t) => t.kode).filter((kode) => HIMPUNAN_KRITIS.has(kode)),
    ),
  ] as KodeTemuan[];

  return {
    jumlahTemuan: hasil.temuan.length,
    temuanTampil: hasil.temuan.slice(0, batas),
    kodeKritis,
    adaKritis: kodeKritis.length > 0,
  };
}
