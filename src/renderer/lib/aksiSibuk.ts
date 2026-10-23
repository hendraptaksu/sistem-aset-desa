// Guard anti double-submit (P1-12).
//
// Klik ganda pada tombol async bisa mengirim dua IPC sebelum React sempat
// merender ulang state `disabled`. Ref diperiksa secara sinkron sehingga aksi
// kedua langsung diabaikan. Perilaku sukses/gagal aksi pertama tidak berubah.

import { useCallback, useRef, useState } from 'react';

export type RefSibuk = { current: boolean };

/**
 * Jalankan `aksi` hanya bila belum ada aksi berjalan pada `ref`.
 * Mengembalikan `undefined` bila klik diabaikan.
 */
export async function guardSibuk<T>(
  ref: RefSibuk,
  aksi: () => Promise<T>,
): Promise<T | undefined> {
  if (!ref || ref.current) return undefined;
  ref.current = true;
  try {
    return await aksi();
  } finally {
    ref.current = false;
  }
}

/**
 * Hook praktis untuk komponen: menyediakan `sibuk` (untuk disabled/label) dan
 * `jalankan` (guard ref + set state). Satu hook biasanya dipakai per aksi;
 * bila satu komponen punya beberapa aksi, gunakan satu hook bersama agar semua
 * tombol nonaktif selama aksi berjalan.
 */
export function useAksiSibuk(): {
  sibuk: boolean;
  jalankan: <T>(aksi: () => Promise<T>) => Promise<T | undefined>;
  ref: React.MutableRefObject<boolean>;
} {
  const ref = useRef(false);
  const [sibuk, setSibuk] = useState(false);

  const jalankan = useCallback(
    async <T,>(aksi: () => Promise<T>): Promise<T | undefined> => {
      if (ref.current) return undefined;
      ref.current = true;
      setSibuk(true);
      try {
        return await aksi();
      } finally {
        ref.current = false;
        setSibuk(false);
      }
    },
    [],
  );

  return { sibuk, jalankan, ref };
}
