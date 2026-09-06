import { useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Card, ErrorBox, Field, PinInput, TextInput } from './ui.js';

type Mode = 'buka' | 'setup' | 'reset';

export function LockScreen({ sudahSetup, onTerbuka }: { sudahSetup: boolean; onTerbuka: () => void }) {
  const [mode, setMode] = useState<Mode>(sudahSetup ? 'buka' : 'setup');
  const [pin, setPin] = useState('');
  const [baru, setBaru] = useState('');
  const [konfirmasi, setKonfirmasi] = useState('');
  const [kode, setKode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [gagal, setGagal] = useState(0);

  const hanyaDigit = (s: string) => s.replace(/\D/g, '').slice(0, 6);

  async function kirim(fn: () => Promise<unknown>) {
    setErr(null);
    setSibuk(true);
    try {
      await fn();
      onTerbuka();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSibuk(false);
    }
  }

  /** Unlock otomatis saat 6 digit lengkap — tanpa tombol. */
  const sedangBuka = useRef(false);
  async function bukaDengan(pinLengkap: string) {
    if (sedangBuka.current) return;
    if (!/^\d{6}$/.test(pinLengkap)) return;
    sedangBuka.current = true;
    setErr(null);
    setSibuk(true);
    try {
      await api.lockUnlock(pinLengkap);
      onTerbuka();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setPin('');
      setGagal((g) => g + 1);
    } finally {
      sedangBuka.current = false;
      setSibuk(false);
    }
  }

  function pindah(m: Mode) {
    setMode(m);
    setErr(null);
    setPin('');
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-emerald-950 p-4">
      <Card className="w-full max-w-sm text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <Lock size={24} />
        </div>
        <h1 className="text-lg font-bold">Keuangan Pura Dalem Puri</h1>
        <p className="mt-1 text-sm text-stone-600">
          {mode === 'setup'
            ? 'Buat PIN 6 digit agar hanya pengurus yang bisa membuka.'
            : mode === 'reset'
              ? 'Reset PIN dengan kode darurat dari dokumen bendahara.'
              : 'Masukkan PIN 6 digit — terbuka otomatis.'}
        </p>
        <div className="mt-4 space-y-3 text-left">
          <ErrorBox msg={err} />
          {mode === 'reset' && (
            <Field label="Kode darurat">
              <TextInput
                value={kode}
                onChange={(e) => setKode(e.target.value)}
                placeholder="cth: PURI-…"
                autoComplete="off"
              />
            </Field>
          )}
          {mode === 'buka' && (
            <div>
              <PinInput
                value={pin}
                disabled={sibuk}
                invalid={err !== null}
                invalidKey={gagal}
                onChange={setPin}
                onComplete={(v) => void bukaDengan(v)}
              />
              <p className="mt-2 text-center text-sm text-stone-500">
                {sibuk ? 'Membuka…' : 'Terbuka otomatis saat 6 digit lengkap.'}
              </p>
            </div>
          )}
          {mode === 'reset' && (
            <Field label="PIN baru 6 digit">
              <TextInput
                type="password"
                inputMode="numeric"
                autoFocus
                value={baru}
                onChange={(e) => setBaru(hanyaDigit(e.target.value))}
                placeholder="••••••"
              />
            </Field>
          )}
          {mode === 'setup' && (
            <>
              <Field label="PIN baru 6 digit">
                <TextInput
                  type="password"
                  inputMode="numeric"
                  autoFocus
                  value={baru}
                  onChange={(e) => setBaru(hanyaDigit(e.target.value))}
                  placeholder="••••••"
                />
              </Field>
              <Field label="Ulangi PIN">
                <TextInput
                  type="password"
                  inputMode="numeric"
                  value={konfirmasi}
                  onChange={(e) => setKonfirmasi(hanyaDigit(e.target.value))}
                  placeholder="••••••"
                />
              </Field>
            </>
          )}
          {mode === 'reset' && (
            <Field label="Ulangi PIN baru">
              <TextInput
                type="password"
                inputMode="numeric"
                value={konfirmasi}
                onChange={(e) => setKonfirmasi(hanyaDigit(e.target.value))}
                placeholder="••••••"
              />
            </Field>
          )}
          {mode === 'setup' && (
            <Button
              className="w-full"
              disabled={sibuk || baru.length !== 6 || konfirmasi !== baru}
              onClick={() => {
                if (baru !== konfirmasi) {
                  setErr('Ulangi PIN tidak sama.');
                  return;
                }
                void kirim(() => api.lockSetup(baru));
              }}
            >
              {sibuk ? 'Menyimpan…' : 'Simpan PIN'}
            </Button>
          )}
          {mode === 'reset' && (
            <Button
              className="w-full"
              disabled={sibuk || !kode.trim() || baru.length !== 6 || konfirmasi !== baru}
              onClick={() => {
                if (baru !== konfirmasi) {
                  setErr('Ulangi PIN tidak sama.');
                  return;
                }
                void kirim(() => api.lockReset(kode.trim(), baru));
              }}
            >
              {sibuk ? 'Mereset…' : 'Reset PIN'}
            </Button>
          )}
          <div className="flex justify-center gap-4 pt-1 text-sm">
            {mode === 'buka' && (
              <button type="button" className="text-emerald-700 underline" onClick={() => pindah('reset')}>
                Lupa PIN?
              </button>
            )}
            {mode !== 'buka' && sudahSetup && (
              <button type="button" className="text-emerald-700 underline" onClick={() => pindah('buka')}>
                Kembali
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
