// AUD2-16 — petunjuk pembeda akun kembar di form input.
//
// COA client menyimpan akun lama sekaligus akun tambahan yang mirip. Petunjuk
// ini hanya membantu operator memilih secara konsisten; data COA dan arsip
// client tidak diubah. Akun di luar daftar ini tidak menampilkan petunjuk.

export type KodeAkunKembar =
  | '5010'
  | '5060'
  | '5004'
  | '5062'
  | '5003'
  | '5031'
  | '4005'
  | '4006'
  | '4008'
  | '4041'
  | '4060';

export const PETUNJUK_AKUN_KEMBAR: Readonly<Record<KodeAkunKembar, string>> = {
  '5010':
    'Tips: 5010 untuk tagihan listrik/air/telepon. Bila pura memakai 5060 PENGELUARAN AIR, LISTRIK, TELEPON (OPERASIONAL), pakai akun yang sama setiap bulan agar laporan konsisten.',
  '5060':
    'Tips: 5060 untuk pengeluaran operasional listrik/air/telepon. Jangan campur dengan 5010 BAGA SUAR; pilih satu akun dan pakai konsisten setiap bulan.',
  '5004':
    'Tips: 5004 untuk upakara/acara. Bila belanja banten rutin harian, gunakan 5062 PENGELUARAN BANTEN RUTIN (HARIAN) dan pakai pola yang sama setiap bulan agar laporan konsisten.',
  '5062':
    'Tips: 5062 untuk banten rutin harian. Untuk upakara/acara gunakan 5004 BAGA UPAKARA; jangan berganti-ganti agar rincian beban konsisten.',
  '5003':
    'Tips: 5003 untuk belanja bangunan/perbaikan rutin. Bila pekerjaan berupa proyek tersendiri, gunakan 5031 BIAYA PROYEK agar tidak tercampur dan laporan konsisten.',
  '5031':
    'Tips: 5031 untuk proyek/pekerjaan tersendiri. Belanja bangunan rutin tetap di 5003 BAGA WEWANGUNAN; pisahkan keduanya secara konsisten.',
  '4005':
    'Tips: 4005 untuk pendapatan parkir umum. Setoran parkir khusus BPD gunakan 4006 PENDAPATAN PARKIR BPD (KHUSUS); jangan campur keduanya.',
  '4006':
    'Tips: 4006 hanya untuk pendapatan parkir BPD (khusus). Parkir umum gunakan 4005 PENDAPATAN PARKIR; catat sumbernya secara konsisten.',
  '4008':
    'Tips: 4008 untuk punia umum. Sesari gunakan 4041 PENDAPATAN SESARI dan wewedalan upacara gunakan 4060 PENDAPATAN WEWEDALAN (UPACARA); pisahkan sesuai sumbernya.',
  '4041':
    'Tips: 4041 khusus pendapatan sesari. Punia umum gunakan 4008 PENDAPATAN PUNIA dan wewedalan upacara gunakan 4060; pilih akun sesuai sumber dana agar konsisten.',
  '4060':
    'Tips: 4060 khusus wewedalan upacara. Punia umum gunakan 4008 PENDAPATAN PUNIA dan sesari gunakan 4041 PENDAPATAN SESARI; jangan menumpuk semua ke satu akun agar konsisten.',
};

/**
 * Petunjuk kontekstual untuk kode akun kembar, atau `null` bila akun tidak
 * memiliki pasangan mirip. Kode di-trim agar nilai kosong/ber-spasi aman.
 */
export function petunjukAkunKembar(
  kode: string | null | undefined,
): string | null {
  const bersih = String(kode ?? '').trim();
  if (!bersih) return null;
  return PETUNJUK_AKUN_KEMBAR[bersih as KodeAkunKembar] ?? null;
}
