import { useState } from 'react';
import { IDLE_MAKS_MENIT, IDLE_MIN_MENIT } from '../../core/pin.js';
import { api } from '../lib/api.js';
import { Button, Card, ErrorBox, Field, TextInput } from './ui.js';

export function PengaturanTab({ idleAwal, onIdleBerubah }: { idleAwal: number; onIdleBerubah: (m: number) => void }) {
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulang, setUlang] = useState('');
  const [idle, setIdle] = useState(String(idleAwal));
  const [errPin, setErrPin] = useState<string | null>(null);
  const [okPin, setOkPin] = useState<string | null>(null);
  const [errIdle, setErrIdle] = useState<string | null>(null);
  const [okIdle, setOkIdle] = useState<string | null>(null);

  const digit = (s: string) => s.replace(/\D/g, '').slice(0, 6);

  async function gantiPin() {
    setErrPin(null);
    setOkPin(null);
    if (baru !== ulang) {
      setErrPin('Ulangi PIN tidak sama.');
      return;
    }
    try {
      await api.lockChange(lama, baru);
      setOkPin('PIN berhasil diganti.');
      setLama('');
      setBaru('');
      setUlang('');
    } catch (e) {
      setErrPin(e instanceof Error ? e.message : String(e));
    }
  }

  async function simpanIdle() {
    setErrIdle(null);
    setOkIdle(null);
    try {
      const r = await api.lockIdleSet(Number(idle));
      setOkIdle(`Auto-kunci disimpan: ${r.idleMenit} menit.`);
      onIdleBerubah(r.idleMenit);
    } catch (e) {
      setErrIdle(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-lg font-bold">Kunci Aplikasi (PIN)</h2>
        <p className="mb-3 text-sm text-stone-600">
          Aplikasi selalu minta PIN setiap dibuka. Ganti PIN bila perlu — PIN lama wajib benar.
        </p>
        <ErrorBox msg={errPin} />
        {okPin && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{okPin}</div>
        )}
        <div className="grid max-w-lg gap-3">
          <Field label="PIN lama">
            <TextInput type="password" inputMode="numeric" value={lama} onChange={(e) => setLama(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <Field label="PIN baru 6 digit">
            <TextInput type="password" inputMode="numeric" value={baru} onChange={(e) => setBaru(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <Field label="Ulangi PIN baru">
            <TextInput type="password" inputMode="numeric" value={ulang} onChange={(e) => setUlang(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <div>
            <Button disabled={lama.length !== 6 || baru.length !== 6 || ulang !== baru} onClick={() => void gantiPin()}>
              Ganti PIN
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Auto-kunci saat idle</h2>
        <p className="mb-3 text-sm text-stone-600">
          Aplikasi mengunci sendiri bila tidak dipakai. Atur {IDLE_MIN_MENIT}–{IDLE_MAKS_MENIT} menit.
        </p>
        <ErrorBox msg={errIdle} />
        {okIdle && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{okIdle}</div>
        )}
        <div className="flex max-w-lg items-end gap-2">
          <div className="flex-1">
            <Field label={`Idle (menit, ${IDLE_MIN_MENIT}–${IDLE_MAKS_MENIT})`}>
              <TextInput type="number" min={IDLE_MIN_MENIT} max={IDLE_MAKS_MENIT} value={idle} onChange={(e) => setIdle(e.target.value)} />
            </Field>
          </div>
          <Button onClick={() => void simpanIdle()}>Simpan</Button>
        </div>
      </Card>
    </div>
  );
}
