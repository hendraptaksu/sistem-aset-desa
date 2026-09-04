import { useState } from 'react';
import { clsx } from 'clsx';
import { BkuTab } from './components/BkuTab.js';
import { PanjarTab } from './components/PanjarTab.js';

export function App() {
  const [tab, setTab] = useState<'bku' | 'panjar'>('bku');
  return (
    <div className="min-h-screen bg-stone-100 text-stone-900">
      <header className="border-b bg-amber-900 px-6 py-4 text-white">
        <h1 className="text-xl font-bold">Keuangan Pura Dalem Puri Peliatan</h1>
        <p className="text-sm text-amber-200">Pembukuan offline — Buku Kas Umum & Panjar</p>
      </header>
      <nav className="flex gap-2 px-6 pt-4">
        {(
          [
            ['bku', 'Buku Kas Umum'],
            ['panjar', 'Buku Panjar'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'rounded-t-lg px-5 py-2 text-[16px] font-semibold',
              tab === id ? 'bg-stone-100 text-amber-900 underline underline-offset-4' : 'bg-stone-200 text-stone-500 hover:bg-stone-300',
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      <main className="px-6 py-4">{tab === 'bku' ? <BkuTab /> : <PanjarTab />}</main>
    </div>
  );
}
