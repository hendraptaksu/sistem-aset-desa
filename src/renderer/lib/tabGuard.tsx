import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { KonfirmasiModal } from '../components/ui.js';

type TabGuard = {
  dirty: boolean;
  setDirty: (dirty: boolean) => void;
  konfirmasiTinggalkan: (lanjut: () => void) => void;
};

/**
 * Guard ringan untuk isian yang belum disimpan.
 *
 * Provider global menyimpan status `dirty` dan merender satu dialog konfirmasi
 * saat navigasi diminta. Fallback no-op dipakai agar komponen form tetap bisa
 * dirender terisolasi (mis. test SSR); di aplikasi selalu ada provider.
 */
const TabGuardContext = createContext<TabGuard>({
  dirty: false,
  setDirty: () => {
    /* tanpa provider, guard tidak aktif */
  },
  konfirmasiTinggalkan: (lanjut) => lanjut(),
});

export function useTabGuard(): TabGuard {
  return useContext(TabGuardContext);
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirtyState] = useState(false);
  const [lanjut, setLanjut] = useState<(() => void) | null>(null);

  const setDirty = useCallback((nilai: boolean) => {
    setDirtyState(nilai);
    // Form bersih berarti tidak ada isian yang perlu dikonfirmasi. Tutup juga
    // dialog yang mungkin masih terbuka (mis. auto-lock mengganti seluruh UI).
    if (!nilai) setLanjut(null);
  }, []);

  const konfirmasiTinggalkan = useCallback((aksi: () => void) => {
    setLanjut(() => aksi);
  }, []);

  const tetapDiSini = useCallback(() => {
    setLanjut(null);
  }, []);

  const tinggalkan = useCallback(() => {
    const aksi = lanjut;
    setDirty(false);
    setLanjut(null);
    aksi?.();
  }, [lanjut, setDirty]);

  const nilai = useMemo(
    () => ({ dirty, setDirty, konfirmasiTinggalkan }),
    [dirty, setDirty, konfirmasiTinggalkan],
  );

  return (
    <TabGuardContext.Provider value={nilai}>
      {children}
      {lanjut && (
        <KonfirmasiModal
          judul="Isian belum disimpan"
          deskripsi="Isian di halaman ini akan hilang jika Anda pindah. Tinggalkan halaman?"
          labelBatal="Tetap di sini"
          labelYa="Tinggalkan"
          variant="danger"
          onBatal={tetapDiSini}
          onKonfirmasi={tinggalkan}
        />
      )}
    </TabGuardContext.Provider>
  );
}
