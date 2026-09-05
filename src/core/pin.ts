// Validasi murni fitur Kunci Aplikasi (PIN 6 digit + idle timeout).
// Dipakai renderer (form) & main (IPC guard). Tanpa dependensi Node agar
// bisa di-bundle ke renderer. Hashing ada di src/main/kunci.ts.

export const PIN_RE = /^\d{6}$/;
export const IDLE_DEFAULT_MENIT = 30;
export const IDLE_MIN_MENIT = 5;
export const IDLE_MAKS_MENIT = 120;
export const MAKS_GAGAL = 5;
export const TUNDA_BLOKIR_MS = 60_000;

export function validasiPin(pin: string): string | null {
  if (!PIN_RE.test(pin)) return 'PIN harus tepat 6 digit angka (0-9).';
  return null;
}

export function validasiIdleMenit(menit: number): string | null {
  if (!Number.isInteger(menit)) return 'Idle harus bilangan menit bulat.';
  if (menit < IDLE_MIN_MENIT || menit > IDLE_MAKS_MENIT)
    return `Idle ${IDLE_MIN_MENIT}–${IDLE_MAKS_MENIT} menit.`;
  return null;
}
