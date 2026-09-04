import { useEffect, useState } from 'react';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';
import { formatRp } from '../../utils/format.js';
import { api } from '../lib/api.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);

export function DashboardTab() {
  const [cutoff, setCutoff] = useState(today());
  const [data, setData] = useState<DashboardHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function muat(c = cutoff) {
    setErr(null);
    try {
      setData(await api.dashboard(c));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function backup() {
    setErr(null);
    setInfo(null);
    try {
      const r = await api.backupExport();
      if (r.saved) setInfo(`Backup tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function restore() {
    setErr(null);
    setInfo(null);
    try {
      const r = await api.backupImport();
      if (r.restored) {
        setInfo(`Restore OK dari backup. Memuat ulang…`);
        await muat();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-lg font-bold">
          Dashboard{' '}
          {data && <Badge tone={data.balance ? 'green' : 'red'}>{data.badge}</Badge>}
        </h2>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Cut-off">
            <TextInput type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => void muat()}>Muat</Button>
          </div>
        </div>
      </Card>

      {data && (
        <Card>
          <table className="w-full text-left text-[15px]">
            <tbody>
              <tr className="border-b">
                <th className="py-2 pr-3">Saldo Kas Tunai (1001)</th>
                <td className="py-2 text-right">{formatRp(data.kasTunai)}</td>
              </tr>
              <tr className="border-b">
                <th className="py-2 pr-3">Total LPD</th>
                <td className="py-2 text-right">{formatRp(data.totalLpd)}</td>
              </tr>
              <tr className="border-b">
                <th className="py-2 pr-3">Aktiva</th>
                <td className="py-2 text-right">{formatRp(data.aktiva)}</td>
              </tr>
              <tr className="border-b">
                <th className="py-2 pr-3">Pasiva</th>
                <td className="py-2 text-right">{formatRp(data.pasiva)}</td>
              </tr>
            </tbody>
          </table>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-stone-600">Rincian LPD</summary>
            <table className="mt-2 w-full text-left text-[15px]">
              <tbody>
                {Object.entries(data.rincianLpd).map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-2 pr-3">{k}</td>
                    <td className="py-2 text-right">{formatRp(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
      )}

      <Card>
        <h3 className="mb-2 font-bold">Backup / Restore (.db)</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void backup()}>Backup Export .db</Button>
          <Button variant="ghost" onClick={() => void restore()}>Restore Import .db</Button>
        </div>
        <p className="mt-2 text-sm text-stone-600">
          Single-file SQLite lokal offline. Export untuk cadangan manual, import untuk pulihkan saat ganti laptop/pengurus.
        </p>
      </Card>
    </div>
  );
}
