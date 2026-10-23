import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookMarked,
  BookOpen,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  HandCoins,
  LayoutDashboard,
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
import { JurnalTab } from './components/JurnalTab.js';
import { BukuBesarTab } from './components/BukuBesarTab.js';
import { NeracaSaldoTab } from './components/NeracaSaldoTab.js';
import { AsetTab } from './components/AsetTab.js';
import { PanjarTab } from './components/PanjarTab.js';
import { PihakTab } from './components/PihakTab.js';
import { PembantuTab } from './components/PembantuTab.js';
import { RealisasiTab } from './components/RealisasiTab.js';
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
import { PengaturanTab } from './components/PengaturanTab.js';
import { DEFAULT_PENGATURAN } from '../core/pengaturan.js';
import { api, type LockStatus } from './lib/api.js';

type TabId = 'dashboard' | 'transaksi' | 'jurnal' | 'buku-besar' | 'neraca-saldo' | 'aset' | 'panjar' | 'pihak' | 'pembantu' | 'realisasi' | 'laba-rugi' | 'neraca' | 'arus-kas' | 'tutup' | 'pengaturan';

const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'transaksi', label: 'Transaksi', Icon: ArrowLeftRight },
  { id: 'jurnal', label: 'Jurnal Umum', Icon: BookOpen },
  { id: 'buku-besar', label: 'Buku Besar', Icon: BookMarked },
  { id: 'neraca-saldo', label: 'Neraca Saldo', Icon: ListChecks },
  { id: 'aset', label: 'Inventaris Aset', Icon: Building2 },
  { id: 'panjar', label: 'Buku Panjar', Icon: Wallet },
  { id: 'pihak', label: 'Piutang & Hutang', Icon: HandCoins },
  { id: 'pembantu', label: 'Pembantu', Icon: NotebookText },
  { id: 'realisasi', label: 'Realisasi', Icon: BarChart3 },
  { id: 'laba-rugi', label: 'Laba Rugi', Icon: TrendingUp },
  { id: 'neraca', label: 'Neraca', Icon: Scale },
  { id: 'arus-kas', label: 'Arus Kas', Icon: Banknote },
  { id: 'tutup', label: 'Tutup Buku', Icon: Lock },
  { id: 'pengaturan', label: 'Pengaturan', Icon: Settings },
];

export function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [lock, setLock] = useState<LockStatus | null>(null);
  const [namaEntitas, setNamaEntitas] = useState(DEFAULT_PENGATURAN.namaEntitas);
  // Drill-down Neraca Saldo → Buku Besar akun yang diklik (P1-8).
  const [akunBukuBesar, setAkunBukuBesar] = useState<string | undefined>();
  // Pintasan dashboard → form terpandu yang langsung dipilih (P1-14).
  const [jenisTransaksiAwal, setJenisTransaksiAwal] =
    useState<DashboardFormTransaksi>('TERIMA');

  const bukaDariDashboard = useCallback(
    (tab: DashboardTabTujuan, form?: DashboardFormTransaksi) => {
      if (form) setJenisTransaksiAwal(form);
      setTab(tab);
    },
    [],
  );

  const refreshLock = useCallback(async () => {
    try {
      setLock(await api.lockStatus());
    } catch {
      // IPC belum siap (dev tanpa preload) → anggap terbuka agar UI tetap bisa dipakai.
      setLock({ sudahSetup: false, terbuka: true, idleMenit: 30, gagal: 0, blokirDetik: 0 });
    }
  }, []);

  useEffect(() => {
    void refreshLock();
  }, [refreshLock]);

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

  // Auto-kunci saat idle: timer di-reset oleh aktivitas. Tanpa tombol kunci manual.
  useEffect(() => {
    if (!lock?.terbuka || !lock.sudahSetup) return;
    let timer: ReturnType<typeof setTimeout>;
    const mulai = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void api.lockLock().finally(() => {
          setTab('dashboard');
          void refreshLock();
        });
      }, lock.idleMenit * 60_000);
    };
    const acara = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'] as const;
    mulai();
    for (const a of acara) window.addEventListener(a, mulai, { passive: true });
    return () => {
      clearTimeout(timer);
      for (const a of acara) window.removeEventListener(a, mulai);
    };
  }, [lock?.terbuka, lock?.sudahSetup, lock?.idleMenit, refreshLock]);

  if (!lock) {
    return <div className="flex min-h-screen items-center justify-center text-stone-500">Memuat…</div>;
  }
  if (lock.sudahSetup && !lock.terbuka) {
    return <LockScreen sudahSetup={lock.sudahSetup} onTerbuka={() => void refreshLock()} />;
  }
  // Belum setup PIN → wajib buat dulu (gembok depan aktif sejak awal).
  if (!lock.sudahSetup) {
    return <LockScreen sudahSetup={false} onTerbuka={() => void refreshLock()} />;
  }

  return (
    <div className="flex min-h-screen bg-stone-50 text-stone-900">
      <aside
        className={clsx(
          'sticky top-0 flex h-screen shrink-0 flex-col bg-emerald-950 text-white transition-all',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className={clsx('flex items-center border-b border-white/10 p-3', collapsed ? 'justify-center' : 'justify-between')}>
          {!collapsed && <span className="px-1 text-sm font-bold tracking-wide text-emerald-100">MENU</span>}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Buka menu' : 'Lipat menu'}
            title={collapsed ? 'Buka menu' : 'Lipat menu'}
            className="rounded-lg p-2 text-emerald-100 hover:bg-white/10 hover:text-white"
          >
            {collapsed ? <ChevronsRight size={20} /> : <ChevronsLeft size={20} />}
          </button>
        </div>
        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              title={collapsed ? label : undefined}
              aria-label={label}
              aria-current={tab === id ? 'page' : undefined}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[15px] font-semibold transition-colors',
                collapsed && 'justify-center px-0',
                tab === id ? 'bg-white/15 text-white' : 'text-emerald-100/80 hover:bg-white/10 hover:text-white',
              )}
            >
              <Icon size={20} className="shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          ))}
        </nav>
      </aside>
      <main className="min-h-screen min-w-0 flex-1 overflow-y-auto">
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
          <div className="px-6 py-6">
            {tab === 'transaksi' && <TransaksiTab jenisAwal={jenisTransaksiAwal} />}
            {tab === 'jurnal' && <JurnalTab />}
            {tab === 'buku-besar' && <BukuBesarTab akunAwal={akunBukuBesar} />}
            {tab === 'neraca-saldo' && (
              <NeracaSaldoTab
                onBukaBukuBesar={(kode) => {
                  setAkunBukuBesar(kode);
                  setTab('buku-besar');
                }}
              />
            )}
            {tab === 'aset' && <AsetTab />}
            {tab === 'panjar' && <PanjarTab />}
            {tab === 'pihak' && <PihakTab />}
            {tab === 'pembantu' && <PembantuTab />}
            {tab === 'realisasi' && <RealisasiTab />}
            {tab === 'laba-rugi' && <LabaRugiTab />}
            {tab === 'neraca' && (
              <NeracaTab
                onBukaBukuBesar={(kode) => {
                  setAkunBukuBesar(kode);
                  setTab('buku-besar');
                }}
              />
            )}
            {tab === 'arus-kas' && <ArusKasTab />}
            {tab === 'tutup' && <TutupTab />}
            {tab === 'pengaturan' && (
              <PengaturanTab
                idleAwal={lock.idleMenit}
                onIdleBerubah={(m) => setLock((l) => (l ? { ...l, idleMenit: m } : l))}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
