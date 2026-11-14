// Guard saldo awal sisi renderer (AKT-02).
//
// Backend menolak jurnal pertama bila belum ada saldo awal dan operator belum
// memilih "mulai tanpa saldo awal". Renderer memakai helper ini untuk:
// - mendeteksi pesan tersebut agar tidak menjadi error buntu;
// - menyimpan pilihan "mulai tanpa" selama sesi aplikasi;
// - selalu mengirim `wajibSaldoAwal: true` + flag konfirmasi ke IPC.

const KUNCI_SESI = 'sistem-aset-desa:mulai-tanpa-saldo-awal';

/** Cadangan bila sessionStorage tidak tersedia (mis. SSR/test). */
let pilihanMulaiTanpaMemori = false;

export function sudahMulaiTanpaSaldoAwal(): boolean {
  if (pilihanMulaiTanpaMemori) return true;
  try {
    if (typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(KUNCI_SESI) === '1';
    }
  } catch {
    // Akses storage bisa diblokir; anggap belum memilih.
  }
  return false;
}

/** Pilihan berlaku untuk sesi aplikasi, bukan hanya satu form. */
export function tandaiMulaiTanpaSaldoAwal(): void {
  pilihanMulaiTanpaMemori = true;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(KUNCI_SESI, '1');
    }
  } catch {
    // Cadangan memori tetap dipakai.
  }
}

/** Saldo awal sudah diisi: pilihan "mulai tanpa" tidak relevan lagi. */
export function lupakanMulaiTanpaSaldoAwal(): void {
  pilihanMulaiTanpaMemori = false;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(KUNCI_SESI);
    }
  } catch {
    // Tidak ada yang perlu dilakukan.
  }
}

/** Error backend "Belum ada saldo awal..." harus membuka modal, bukan error buntu. */
export function adalahErrorSaldoAwal(e: unknown): boolean {
  const pesan = e instanceof Error ? e.message : String(e ?? '');
  return /belum ada saldo awal/i.test(pesan);
}

/** Opsi IPC yang selalu dikirim setiap pintu input. */
export function opsiSaldoAwal(konfirmasiEksplisit = false): {
  wajibSaldoAwal: true;
  konfirmasiTanpaSaldoAwal: boolean;
} {
  return {
    wajibSaldoAwal: true,
    konfirmasiTanpaSaldoAwal:
      konfirmasiEksplisit || sudahMulaiTanpaSaldoAwal(),
  };
}
