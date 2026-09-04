import { useMemo, useState } from 'react';
import { KAS_KODES } from '../../db/coa.js';
import { formatRp } from '../../utils/format.js';
import { MOCK_PANJAR, MOCK_TRANSAKSI, MOCK_TUTUP } from '../reports/__mocks__/data.js';
import { buildDashboard } from './dashboard.js';

export default function DashboardView() {
  const [cutoff, setCutoff] = useState('2025-12-31');
  const d = useMemo(
    () => buildDashboard(MOCK_TRANSAKSI, MOCK_PANJAR, MOCK_TUTUP, cutoff, KAS_KODES),
    [cutoff],
  );
  return (
    <div className="card">
      <h2>Dashboard</h2>
      <div className="row">
        <label className="field">Cut-off<input type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} /></label>
        <span className={`badge ${d.balance ? 'ok' : 'warn'}`}>{d.badge}</span>
      </div>
      <table className="grid">
        <tbody>
          <tr><th>Saldo Kas Tunai (1000)</th><td className="num">{formatRp(d.kasTunai)}</td></tr>
          <tr><th>Total LPD</th><td className="num">{formatRp(d.totalLpd)}</td></tr>
          <tr><th>Aktiva</th><td className="num">{formatRp(d.aktiva)}</td></tr>
          <tr><th>Pasiva</th><td className="num">{formatRp(d.pasiva)}</td></tr>
        </tbody>
      </table>
      <details><summary>Rincian LPD</summary>
        <table className="grid"><tbody>
          {Object.entries(d.rincianLpd).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{formatRp(v)}</td></tr>)}
        </tbody></table>
      </details>
    </div>
  );
}
