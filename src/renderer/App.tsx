import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookMarked,
  BookOpen,
  Building2,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  FileSpreadsheet,
  HandCoins,
  Landmark,
  LayoutDashboard,
  List,
  ListChecks,
  Lock,
  NotebookText,
  Scale,
  Settings,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { TransaksiTab } from './components/TransaksiTab.js';
import { AkunTab } from './components/AkunTab.js';
import { JurnalTab } from './components/JurnalTab.js';
import { BukuBesarTab } from './components/BukuBesarTab.js';
import { NeracaSaldoTab } from './components/NeracaSaldoTab.js';
import { AsetTab } from './components/AsetTab.js';
import { PanjarTab } from './components/PanjarTab.js';
import { PihakTab } from './components/PihakTab.js';
import { PembantuTab } from './components/PembantuTab.js';
import { RealisasiTab } from './components/RealisasiTab.js';
import { RekonsiliasiBankTab } from './components/RekonsiliasiBankTab.js';
import { ImportExcelTab } from './components/ImportExcelTab.js';
import { LabaRugiTab } from './components/LabaRugiTab.js';
import { ArusKasTab } from './components/ArusKasTab.js';
import { NeracaTab } from './components/NeracaTab.js';
import { TutupTab } from './components/TutupTab.js';
import { DashboardTab } from './components/DashboardTab.js';
import type {
  DashboardFormTransaksi,
  DashboardTabTujuan,
} from './components/DashboardTab.js';
import { LockScreen } from './components/LockScreen.js';
import { KodeDaruratModal } from './components/KodeDaruratModal.js';
import { PengaturanTab } from './components/PengaturanTab.js';
import { Button, RING_FOKUS_GELAP } from './components/ui.js';
import { DEFAULT_PENGATURAN } from '../core/pengaturan.js';
import { api, type LockStatus } from './lib/api.js';
import { useAksiSibuk } from './lib/aksiSibuk.js';
import { UnsavedChangesProvider, useTabGuard } from './lib/tabGuard.js';

type TabId = 'dashboard' | 'transaksi' | 'akun' | 'jurnal' | 'buku-besar' | 'neraca-saldo' | 'aset' | 'panjar' | 'pihak' | 'pembantu' | 'realisasi' | 'rekonsiliasi' | 'import' | 'laba-rugi' | 'neraca' | 'arus-kas' | 'tutup' | 'pengaturan';

const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'transaksi', label: 'Transaksi', Icon: ArrowLeftRight },
  { id: 'akun', label: 'Daftar Akun', Icon: List },
  { id: 'jurnal', label: 'Jurnal Umum', Icon: BookOpen },
  { id: 'buku-besar', label: 'Buku Besar', Icon: BookMarked },
  { id: 'neraca-saldo', label: 'Neraca Saldo', Icon: ListChecks },
  { id: 'aset', label: 'Inventaris Aset', Icon: Building2 },
  { id: 'panjar', label: 'Buku Panjar', Icon: Wallet },
  { id: 'pihak', label: 'Piutang & Hutang', Icon: HandCoins },
  { id: 'pembantu', label: 'Buku Pembantu', Icon: NotebookText },
  { id: 'realisasi', label: 'Anggaran', Icon: BarChart3 },
  { id: 'rekonsiliasi', label: 'Rekonsiliasi Bank', Icon: Landmark },
  { id: 'import', label: 'Import Excel', Icon: FileSpreadsheet },
  { id: 'laba-rugi', label: 'Laba Rugi', Icon: TrendingUp },
  { id: 'neraca', label: 'Neraca', Icon: Scale },
  { id: 'arus-kas', label: 'Arus Kas', Icon: Banknote },
  { id: 'tutup', label: 'Tutup Buku', Icon: Lock },
  { id: 'pengaturan', label: 'Pengaturan', Icon: Settings },
];

// UI-04: kelompok menu sidebar. TabId, label, dan urutan TABS di atas tidak
// berubah; kelompok hanya menentukan cara item ditampilkan. Pengaturan tidak
// masuk kelompok karena dipin di footer sidebar (selalu terlihat).
type GrupId = 'harian' | 'laporan' | 'data';

const GRUP_MENU: {
  id: GrupId;
  label: string;
  defaultTerbuka: boolean;
  item: TabId[];
}[] = [
  {
    id: 'harian',
    label: 'Harian',
    defaultTerbuka: true,
    item: ['dashboard', 'transaksi', 'panjar', 'pihak', 'jurnal'],
  },
  {
    id: 'laporan',
    label: 'Laporan',
    defaultTerbuka: false,
    item: [
      'buku-besar',
      'neraca-saldo',
      'laba-rugi',
      'neraca',
      'arus-kas',
      'realisasi',
      'rekonsiliasi',
      'pembantu',
      'aset',
    ],
  },
  {
    id: 'data',
    label: 'Data & Sistem',
    defaultTerbuka: true,
    item: ['akun', 'import', 'tutup'],
  },
];

const TAB_BY_ID = Object.fromEntries(TABS.map((t) => [t.id, t])) as Record<TabId, (typeof TABS)[number]>;

const GRUP_DARI_TAB: Partial<Record<TabId, GrupId>> = Object.fromEntries(
  GRUP_MENU.flatMap((g) => g.item.map((id) => [id, g.id] as const)),
);

const BUKA_AWAL: Record<GrupId, boolean> = {
  harian: GRUP_MENU[0].defaultTerbuka,
  laporan: GRUP_MENU[1].defaultTerbuka,
  data: GRUP_MENU[2].defaultTerbuka,
};

// UI-05: status lipat sidebar disimpan per profil. Nilai hanya ditulis saat
// pengguna menekan tombol lipat, sehingga default otomatis tidak menimpa
// pilihan manual pada kunjungan berikutnya.
const KUNCI_LIPAT_SIDEBAR = 'pura.sidebar.collapsed';
const LEBAR_OTOMATIS_LIPAT = 1200;

function bacaStatusLipatAwal(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const tersimpan = window.localStorage.getItem(KUNCI_LIPAT_SIDEBAR);
    if (tersimpan === 'true') return true;
    if (tersimpan === 'false') return false;
  } catch {
    // localStorage bisa diblokir; abaikan dan pakai default berdasarkan lebar.
  }
  return window.innerWidth < LEBAR_OTOMATIS_LIPAT;
}

/**
 * UI-07: provider guard membungkus shell agar form transaksi bisa menandai
 * isian yang belum disimpan dan navigasi bisa meminta konfirmasi.
 */
export function App() {
  return (
    <UnsavedChangesProvider>
      <AppShell />
    </UnsavedChangesProvider>
  );
}

function AppShell() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const { dirty, setDirty, konfirmasiTinggalkan } = useTabGuard();
  // UI-01: main adalah satu-satunya area scroll; posisi direset setelah tab
  // berganti (bukan saat modal/detail dibuka-tutup atau tab yang sama diklik).
  const mainRef = useRef<HTMLElement | null>(null);
  const tabRef = useRef<TabId>('dashboard');
  // UI-07: ref menjaga `pindahTab` tetap stabil walau status dirty berubah
  // (efek auto-lock bergantung pada identitas `pindahTab`).
  const dirtyRef = useRef(dirty);
  // UI-06: hanya fokuskan konten bila perpindahan tab dipicu keyboard. Modalitas
  // input terakhir dilacak global agar klik mouse tidak merampas fokus pengguna.
  const modalitasTerakhirRef = useRef<'keyboard' | 'pointer'>('pointer');
  // UI-05: baca status tersimpan/default lebar sekali saat mount. Jangan
  // menimpa pilihan manual saat resize; pengguna yang mengubah lebar tidak
  // boleh memaksa ulang status lipat.
  const [collapsed, setCollapsed] = useState(bacaStatusLipatAwal);
  // UI-05: isyarat masih ada item di bawah area nav yang terlihat.
  const navRef = useRef<HTMLElement | null>(null);
  const navIsiRef = useRef<HTMLDivElement | null>(null);
  const [adaMenuDiBawah, setAdaMenuDiBawah] = useState(false);
  // UI-04: status buka/tutup kelompok menu + ref item untuk menjaga tab aktif
  // tetap terlihat saat kelompok dibuka atau sidebar dilipat.
  const [bukaGrup, setBukaGrup] = useState<Record<GrupId, boolean>>(BUKA_AWAL);
  const itemRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});
  const tabSebelumnya = useRef<TabId>('dashboard');
  const perluGulirAktif = useRef(false);
  const [lock, setLock] = useState<LockStatus | null>(null);
  // AUD-19: plaintext kode darurat hanya hidup di state ini sampai modal ditutup.
  const [kodeDaruratBaru, setKodeDaruratBaru] = useState<string | null>(null);
  const [namaEntitas, setNamaEntitas] = useState(DEFAULT_PENGATURAN.namaEntitas);
  const { sibuk: mengunci, jalankan: jalankanKunci } = useAksiSibuk();
  // Drill-down Neraca Saldo → Buku Besar akun yang diklik (P1-8).
  const [akunBukuBesar, setAkunBukuBesar] = useState<string | undefined>();
  // Pintasan dashboard → form terpandu yang langsung dipilih (P1-14).
  const [jenisTransaksiAwal, setJenisTransaksiAwal] =
    useState<DashboardFormTransaksi>('TERIMA');

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const lakukanPindah = useCallback((id: TabId) => {
    if (tabRef.current === id) return;
    const dariKeyboard = modalitasTerakhirRef.current === 'keyboard';
    tabRef.current = id;
    setTab(id);
    // Setelah commit React, gulir area konten kembali ke atas. rAF dipakai agar
    // tidak memaksa window.scrollTo dan tidak berkedip saat render tab baru.
    requestAnimationFrame(() => {
      const main = mainRef.current;
      if (!main) return;
      main.scrollTop = 0;
      // UI-06: jangan rebut fokus saat modal terbuka atau navigasi lewat mouse.
      if (dariKeyboard && !document.querySelector('[aria-modal="true"]')) {
        main.focus({ preventScroll: true });
      }
    });
  }, []);

  // UI-07: tab yang sama tidak pernah memicu dialog atau reset scroll. Opsi
  // `paksa` dipakai auto-lock karena layar PIN akan mengganti seluruh UI.
  const pindahTab = useCallback(
    (id: TabId, opsi?: { paksa?: boolean }) => {
      if (tabRef.current === id) return;
      if (dirtyRef.current && !opsi?.paksa) {
        konfirmasiTinggalkan(() => lakukanPindah(id));
        return;
      }
      lakukanPindah(id);
    },
    [konfirmasiTinggalkan, lakukanPindah],
  );

  // UI-06: catat modalitas input terakhir. `keydown` selalu mendahului klik
  // yang dipicu Enter/Space, sedangkan `pointerdown` mendahului klik mouse.
  useEffect(() => {
    const tandaiKeyboard = () => {
      modalitasTerakhirRef.current = 'keyboard';
    };
    const tandaiPointer = () => {
      modalitasTerakhirRef.current = 'pointer';
    };
    window.addEventListener('keydown', tandaiKeyboard, true);
    window.addEventListener('pointerdown', tandaiPointer, true);
    return () => {
      window.removeEventListener('keydown', tandaiKeyboard, true);
      window.removeEventListener('pointerdown', tandaiPointer, true);
    };
  }, []);

  // UI-06: judul jendela mencerminkan tab aktif; efek ini juga memasang judul
  // Dashboard saat aplikasi pertama kali dibuka.
  useEffect(() => {
    document.title = `${TAB_BY_ID[tab].label} — Keuangan Pura Dalem Puri`;
  }, [tab]);

  // UI-04: saat tab berubah, buka kelompok yang memuat tab aktif. Efek hanya
  // berjalan saat pindah tab, jadi pengguna tetap bisa menutup kelompok aktif
  // secara sengaja tanpa langsung dibuka ulang.
  useEffect(() => {
    if (tabSebelumnya.current === tab) return;
    tabSebelumnya.current = tab;
    perluGulirAktif.current = true;
    const grup = GRUP_DARI_TAB[tab];
    if (grup) setBukaGrup((prev) => (prev[grup] ? prev : { ...prev, [grup]: true }));
  }, [tab]);

  // Buka/lipat sidebar mengubah tinggi item; tab aktif harus tetap terlihat.
  useEffect(() => {
    perluGulirAktif.current = true;
  }, [collapsed]);

  // Gulir item aktif ke viewport nav setelah render. Hanya dipicu oleh pindah
  // tab, buka kelompok aktif, atau lipat sidebar — bukan setiap toggle kelompok.
  useEffect(() => {
    if (!perluGulirAktif.current) return;
    const el = itemRefs.current[tab];
    // Kelompok tertutup belum punya kotak layout; tunggu render setelah dibuka.
    if (!el || el.getClientRects().length === 0) return;
    perluGulirAktif.current = false;
    el.scrollIntoView({ block: 'nearest' });
  }, [tab, bukaGrup, collapsed]);

  const toggleGrup = (id: GrupId) => {
    const akanTerbuka = !bukaGrup[id];
    // Saat kelompok aktif dibuka kembali, pastikan tab aktif langsung terlihat.
    if (akanTerbuka && GRUP_DARI_TAB[tab] === id) perluGulirAktif.current = true;
    setBukaGrup((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // UI-05: tulis pilihan manual ke localStorage saat tombol lipat ditekan.
  // Nilai default (termasuk lipat otomatis karena lebar < 1200 px) tidak
  // pernah ditulis agar pilihan pengguna tidak tertimpa pada kunjungan lain.
  const toggleLipat = () => {
    const berikutnya = !collapsed;
    setCollapsed(berikutnya);
    try {
      window.localStorage.setItem(KUNCI_LIPAT_SIDEBAR, String(berikutnya));
    } catch {
      // Persistensi bersifat opsional; sidebar tetap berfungsi tanpa storage.
    }
  };

  const periksaGulirNav = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    setAdaMenuDiBawah(nav.scrollHeight - nav.scrollTop - nav.clientHeight > 1);
  }, []);

  // UI-05: gradien hanya muncul bila masih ada item di bawah viewport nav.
  // Scroll listener menangani gulir pengguna; ResizeObserver menangani
  // perubahan tinggi window, buka/tutup kelompok, dan lipat sidebar.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    periksaGulirNav();
    nav.addEventListener('scroll', periksaGulirNav, { passive: true });
    const pengamat =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(periksaGulirNav);
    if (pengamat) {
      pengamat.observe(nav);
      if (navIsiRef.current) pengamat.observe(navIsiRef.current);
    }
    return () => {
      nav.removeEventListener('scroll', periksaGulirNav);
      pengamat?.disconnect();
    };
    // Nav baru ter-mount setelah layar PIN terbuka; ikutkan status lock agar
    // listener/observer dipasang saat nav benar-benar ada.
  }, [periksaGulirNav, lock?.sudahSetup, lock?.terbuka]);

  useEffect(() => {
    periksaGulirNav();
  }, [bukaGrup, collapsed, periksaGulirNav]);

  const bukaDariDashboard = useCallback(
    (tab: DashboardTabTujuan, form?: DashboardFormTransaksi) => {
      if (form) setJenisTransaksiAwal(form);
      pindahTab(tab);
    },
    [pindahTab],
  );

  const refreshLock = useCallback(async () => {
    try {
      setLock(await api.lockStatus());
    } catch {
      // IPC belum siap (dev tanpa preload) → anggap terbuka agar UI tetap bisa dipakai.
      setLock({
        sudahSetup: false,
        terbuka: true,
        idleMenit: 30,
        gagal: 0,
        blokirDetik: 0,
        kodeDaruratDiatur: false,
      });
    }
  }, []);

  /** Sukses setup/unlock/reset: optimistis buka UI, lalu sinkronkan status main. */
  const tanganiTerbuka = useCallback(
    (kodeDarurat?: string) => {
      if (kodeDarurat) setKodeDaruratBaru(kodeDarurat);
      setLock((l) =>
        l
          ? {
              ...l,
              sudahSetup: true,
              terbuka: true,
              kodeDaruratDiatur: kodeDarurat ? true : l.kodeDaruratDiatur,
            }
          : l,
      );
      void refreshLock();
    },
    [refreshLock],
  );

  // AUD-18: keputusan lock ada di main (idle/suspend). Renderer hanya polling
  // status; saat main mengunci, layar PIN muncul tanpa menunggu aksi user.
  // Polling tidak boleh menahan sesi: `lock:status` tidak dihitung aktivitas.
  useEffect(() => {
    void refreshLock();
    const cekStatus = (): void => {
      void api
        .lockStatus()
        .then(setLock)
        .catch(() => {
          // Gagal sesaat (mis. main sibuk restore) → pertahankan status terakhir.
        });
    };
    const timer = setInterval(cekStatus, 30_000);
    window.addEventListener('focus', cekStatus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', cekStatus);
    };
  }, [refreshLock]);

  const kunciSekarang = useCallback(
    () =>
      jalankanKunci(async () => {
        try {
          await api.lockLock();
        } finally {
          await refreshLock();
        }
      }),
    [jalankanKunci, refreshLock],
  );

  // Kop layar mengikuti nama entitas tersimpan (P1-13); gagal = pakai default.
  useEffect(() => {
    if (!lock?.terbuka) return;
    let batal = false;
    void api
      .pengaturanGet()
      .then((p) => {
        if (!batal) setNamaEntitas(p.namaEntitas || DEFAULT_PENGATURAN.namaEntitas);
      })
      .catch(() => {
        /* biarkan nama default bila IPC belum siap */
      });
    return () => {
      batal = true;
    };
  }, [lock?.terbuka]);

  // Auto-kunci lokal untuk respons cepat; main tetap penjaga utama (AUD-18).
  useEffect(() => {
    if (!lock?.terbuka || !lock.sudahSetup) return;
    let timer: ReturnType<typeof setTimeout>;
    const mulai = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void api.lockLock().finally(() => {
          // UI-07: jangan biarkan dialog guard menutupi layar PIN. Pindah ke
          // dashboard dengan paksa dan bersihkan status dirty karena semua UI
          // akan diganti layar kunci.
          setDirty(false);
          pindahTab('dashboard', { paksa: true });
          void refreshLock();
        });
      }, lock.idleMenit * 60_000);
    };
    const acara = ['mousemove', 'keydown', 'mousedown', 'touchstart'] as const;
    mulai();
    for (const a of acara) window.addEventListener(a, mulai, { passive: true });
    // Sejak UI-01 konten digulir di dalam `main`; scroll tidak bubble ke window,
    // jadi tangkap di fase capture agar menggulir tetap dihitung sebagai aktivitas.
    window.addEventListener('scroll', mulai, { passive: true, capture: true });
    return () => {
      clearTimeout(timer);
      for (const a of acara) window.removeEventListener(a, mulai);
      window.removeEventListener('scroll', mulai, true);
    };
  }, [lock?.terbuka, lock?.sudahSetup, lock?.idleMenit, refreshLock, pindahTab, setDirty]);

  if (!lock) {
    return <div className="flex min-h-screen items-center justify-center text-stone-500">Memuat…</div>;
  }
  if (lock.sudahSetup && !lock.terbuka) {
    return <LockScreen sudahSetup={lock.sudahSetup} onTerbuka={tanganiTerbuka} />;
  }
  // Belum setup PIN → wajib buat dulu (gembok depan aktif sejak awal).
  if (!lock.sudahSetup) {
    return <LockScreen sudahSetup={false} onTerbuka={tanganiTerbuka} />;
  }

  const renderItem = (id: TabId) => {
    const { label, Icon } = TAB_BY_ID[id];
    return (
      <button
        key={id}
        ref={(el) => { itemRefs.current[id] = el; }}
        type="button"
        onClick={() => pindahTab(id)}
        title={label}
        aria-label={label}
        aria-current={tab === id ? 'page' : undefined}
        className={clsx(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-semibold transition-colors',
          RING_FOKUS_GELAP,
          collapsed && 'justify-center px-0',
          tab === id ? 'bg-white/15 text-white' : 'text-emerald-100/80 hover:bg-white/10 hover:text-white',
        )}
      >
        <Icon size={20} aria-hidden="true" className="shrink-0" />
        {!collapsed && <span className="truncate">{label}</span>}
      </button>
    );
  };

  return (
    <div className="relative flex h-screen overflow-hidden bg-stone-50 text-stone-900">
      {/* UI-06: elemen fokus pertama; tersembunyi untuk pembaca layar sampai
          menerima fokus keyboard, lalu tampil di atas konten. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-emerald-950 focus:px-4 focus:py-2.5 focus:text-sm focus:font-semibold focus:text-white focus:shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:ring-offset-2"
      >
        Lewati ke konten
      </a>
      <aside
        className={clsx(
          'flex h-screen shrink-0 flex-col bg-emerald-950 text-white transition-all',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={clsx('flex items-center border-b border-white/10 p-3', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && <span className="px-1 text-sm font-bold tracking-wide text-emerald-100">MENU</span>}
          <button
            type="button"
            onClick={toggleLipat}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Buka menu' : 'Lipat menu'}
            title={collapsed ? 'Buka menu' : 'Lipat menu'}
            className={`rounded-lg p-2 text-emerald-100 hover:bg-white/10 hover:text-white ${RING_FOKUS_GELAP}`}
          >
            {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          </button>
        </div>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <nav
            ref={navRef}
            aria-label="Menu utama"
            className="min-h-0 flex-1 overflow-y-auto p-3"
          >
            <div ref={navIsiRef} className="flex flex-col gap-1">
              {GRUP_MENU.map((grup, index) => (
                <Fragment key={grup.id}>
                  <div>
                    {!collapsed && (
                      <button
                        type="button"
                        onClick={() => toggleGrup(grup.id)}
                        aria-expanded={bukaGrup[grup.id]}
                        aria-controls={`menu-grup-${grup.id}`}
                        title={bukaGrup[grup.id] ? `Sembunyikan ${grup.label}` : `Tampilkan ${grup.label}`}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-emerald-300 transition-colors hover:bg-white/5 hover:text-white ${RING_FOKUS_GELAP}`}
                      >
                        <span>{grup.label}</span>
                        <ChevronDown
                          size={14}
                          aria-hidden="true"
                          className={clsx(
                            'shrink-0 transition-transform',
                            !bukaGrup[grup.id] && '-rotate-90',
                          )}
                        />
                      </button>
                    )}
                    <div
                      id={`menu-grup-${grup.id}`}
                      role="group"
                      aria-label={grup.label}
                      className={clsx(
                        'flex-col gap-1',
                        collapsed || bukaGrup[grup.id] ? 'flex' : 'hidden',
                        !collapsed && 'mt-1',
                      )}
                    >
                      {grup.item.map((id) => renderItem(id))}
                    </div>
                  </div>
                  {collapsed && index < GRUP_MENU.length - 1 && (
                    <div
                      role="separator"
                      aria-orientation="horizontal"
                      className="my-1 border-t border-white/15"
                    />
                  )}
                </Fragment>
              ))}
            </div>
          </nav>
          {/* UI-05: isyarat scroll; pointer-events-none agar item di bawahnya
              tetap bisa diklik dan tidak menambah scrollbar kedua. */}
          <div
            aria-hidden="true"
            data-testid="sidebar-scroll-shadow"
            className={clsx(
              'pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-emerald-950 via-emerald-950/70 to-transparent transition-opacity',
              adaMenuDiBawah ? 'opacity-100' : 'opacity-0',
            )}
          />
        </div>
        {/* UI-04/UI-05: Pengaturan dipin di luar nav yang scroll agar selalu
            terlihat; footer tidak boleh ikut menyusut. */}
        <div className="shrink-0 border-t border-white/10 p-3">{renderItem('pengaturan')}</div>
      </aside>
      <main
        ref={mainRef}
        id="main-content"
        tabIndex={-1}
        data-testid="app-scroll"
        className="min-w-0 flex-1 overflow-y-auto"
      >
        <header className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-stone-200 bg-white px-6 py-3 shadow-sm">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-stone-700">{TAB_BY_ID[tab].label}</p>
            <p className="truncate text-helper text-stone-500">
              {namaEntitas.trim() || 'Data lokal'}
            </p>
          </div>
          <Button
            variant="ghost"
            className="flex shrink-0 items-center gap-2"
            onClick={() => void kunciSekarang()}
            disabled={mengunci}
            title="Kunci aplikasi sekarang"
            aria-label="Kunci aplikasi"
          >
            <Lock size={16} />
            {mengunci ? 'Mengunci…' : 'Kunci'}
          </Button>
        </header>
        {tab === 'dashboard' ? (
          <>
            <div className="bg-emerald-950 px-6 pb-6 pt-6 text-white">
              <h1 className="text-xl font-bold">{namaEntitas}</h1>
              <p className="text-sm text-emerald-200">Pembukuan offline — Jurnal Umum, Panjar, Piutang &amp; Hutang, Aset, Laba Rugi, Neraca, Arus Kas</p>
            </div>
            <div className="px-6 py-4">
              <DashboardTab onBukaTab={bukaDariDashboard} />
            </div>
          </>
        ) : (
          <div className="overflow-x-clip px-6 py-6">
            {tab === 'transaksi' && (
              <TransaksiTab jenisAwal={jenisTransaksiAwal} onBukaTab={pindahTab} />
            )}
            {tab === 'akun' && <AkunTab />}
            {tab === 'jurnal' && <JurnalTab />}
            {tab === 'buku-besar' && <BukuBesarTab akunAwal={akunBukuBesar} />}
            {tab === 'neraca-saldo' && (
              <NeracaSaldoTab
                onBukaBukuBesar={(kode) => {
                  setAkunBukuBesar(kode);
                  pindahTab('buku-besar');
                }}
              />
            )}
            {tab === 'aset' && <AsetTab />}
            {tab === 'panjar' && <PanjarTab />}
            {tab === 'pihak' && <PihakTab />}
            {tab === 'pembantu' && <PembantuTab />}
            {tab === 'realisasi' && <RealisasiTab />}
            {tab === 'rekonsiliasi' && <RekonsiliasiBankTab />}
            {tab === 'import' && <ImportExcelTab />}
            {tab === 'laba-rugi' && <LabaRugiTab />}
            {tab === 'neraca' && (
              <NeracaTab
                onBukaBukuBesar={(kode) => {
                  setAkunBukuBesar(kode);
                  pindahTab('buku-besar');
                }}
              />
            )}
            {tab === 'arus-kas' && <ArusKasTab />}
            {tab === 'tutup' && <TutupTab />}
            {tab === 'pengaturan' && (
              <PengaturanTab
                idleAwal={lock.idleMenit}
                kodeDaruratDiatur={lock.kodeDaruratDiatur}
                onIdleBerubah={(m) => setLock((l) => (l ? { ...l, idleMenit: m } : l))}
              />
            )}
          </div>
        )}
      </main>
      {kodeDaruratBaru && (
        <KodeDaruratModal
          kode={kodeDaruratBaru}
          onTutup={() => setKodeDaruratBaru(null)}
        />
      )}
    </div>
  );
}
