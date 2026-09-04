import { useState } from 'react';
import { clsx } from 'clsx';
import {
  BarChart3,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Lock,
  NotebookText,
  Scale,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { BkuTab } from './components/BkuTab.js';
import { PanjarTab } from './components/PanjarTab.js';
import { PembantuTab } from './components/PembantuTab.js';
import { RealisasiTab } from './components/RealisasiTab.js';
import { SurplusTab } from './components/SurplusTab.js';
import { NeracaTab } from './components/NeracaTab.js';
import { TutupTab } from './components/TutupTab.js';
import { DashboardTab } from './components/DashboardTab.js';

type TabId = 'dashboard' | 'bku' | 'panjar' | 'pembantu' | 'realisasi' | 'surplus' | 'neraca' | 'tutup';

const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'bku', label: 'Buku Kas Umum', Icon: BookOpen },
  { id: 'panjar', label: 'Buku Panjar', Icon: Wallet },
  { id: 'pembantu', label: 'Pembantu', Icon: NotebookText },
  { id: 'realisasi', label: 'Realisasi', Icon: BarChart3 },
  { id: 'surplus', label: 'Surplus', Icon: TrendingUp },
  { id: 'neraca', label: 'Neraca', Icon: Scale },
  { id: 'tutup', label: 'Tutup Buku', Icon: Lock },
];

export function App() {
  const [tab, setTab] = useState<TabId>('dashboard');
  const [collapsed, setCollapsed] = useState(false);
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
              <h1 className="text-xl font-bold">Keuangan Pura Dalem Puri Peliatan</h1>
              <p className="text-sm text-emerald-200">Pembukuan offline — BKU, Panjar, Laporan, Neraca</p>
            </div>
            <div className="px-6 py-4">
              <DashboardTab />
            </div>
          </>
        ) : (
          <div className="px-6 py-6">
            {tab === 'bku' && <BkuTab />}
            {tab === 'panjar' && <PanjarTab />}
            {tab === 'pembantu' && <PembantuTab />}
            {tab === 'realisasi' && <RealisasiTab />}
            {tab === 'surplus' && <SurplusTab />}
            {tab === 'neraca' && <NeracaTab />}
            {tab === 'tutup' && <TutupTab />}
          </div>
        )}
      </main>
    </div>
  );
}
