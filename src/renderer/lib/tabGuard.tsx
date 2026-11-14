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
 *
 * Kontrak pemakaian (UI-A24):
 * - Form yang bidangnya tetap terbuka saat navigasi (tab biasa) wajib
 *   menyinkronkan `dirty`. Hitung `dirty` sebagai derivasi dari state form
 *   (lihat `formBerisiData` di PinjamanTab, `adaIsian` di JurnalUmumEditor)
 *   alih-alih menyebarnya manual di banyak titik — aksi sekunder (tutup form
 *   lain, ganti mode, simpan aksi lain) tidak boleh bisa menghapus atau
 *   memalsukan status isian.
 * - Komponen yang dirender sebagai modal layar penuh menutupi navigasi tab
 *   (backdrop `fixed inset-0` di ui.tsx), jadi saat modal terbuka guard tidak
 *   pernah sempat dipicu: konfirmasi internal modal itulah yang berlaku saat
 *   menutupnya (mis. konfirmasi tutup KoreksiModal UI-A02 dan editor Jurnal
 *   Umum UI-A12). Modal seperti itu tidak wajib memakai guard; bila tetap
 *   memasangnya, guard hanya lapisan cadangan dan tetap harus dihitung dari
 *   state form.
 * - Auto-lock mengganti seluruh UI dengan layar kunci; App membersihkan
 *   `dirty` secara paksa dan layar kunci memberi tahu isian yang tertutup.
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
