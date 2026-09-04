import { useState } from 'react';
import DashboardView from './features/dashboard/DashboardView.js';
import PembantuView from './features/reports/pembantu/PembantuView.js';
import RealisasiView from './features/reports/realisasi/RealisasiView.js';
import SurplusView from './features/reports/surplus/SurplusView.js';

type Tab = 'dashboard' | 'pembantu' | 'realisasi' | 'surplus';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');
  return (
    <div className="wrap">
      <h1>Pura Dalem Puri — Pembukuan (Agent B: Baca + Laporan + Export)</h1>
      <p>Mock 20 baris · filter tanggal benar · Rupiah via formatRp · Export .xlsx + Print/PDF.</p>
      <nav className="tabs">
        {(['dashboard', 'pembantu', 'realisasi', 'surplus'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'dashboard' ? 'Dashboard' : t === 'pembantu' ? 'Buku Pembantu' : t === 'realisasi' ? 'Realisasi' : 'Surplus / (Defisit)'}
          </button>
        ))}
      </nav>
      {tab === 'dashboard' && <DashboardView />}
      {tab === 'pembantu' && <PembantuView />}
      {tab === 'realisasi' && <RealisasiView />}
      {tab === 'surplus' && <SurplusView />}
    </div>
  );
}
