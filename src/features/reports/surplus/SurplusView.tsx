import { useMemo, useState } from 'react';
import { formatRp } from '../../../utils/format.js';
import { MOCK_TRANSAKSI } from '../__mocks__/data.js';
import { surplusToHtml, surplusToWorkbook, workbookToBuffer, wrapPrintDocument } from '../../export/export.js';
import { buildSurplus } from './surplus.js';

export default function SurplusView() {
  const [mulai, setMulai] = useState('2025-01-01');
  const [sampai, setSampai] = useState('2025-12-31');
  const hasil = useMemo(() => buildSurplus(MOCK_TRANSAKSI, mulai || undefined, sampai || undefined), [mulai, sampai]);

  const unduhXlsx = async () => {
    const wb = await surplusToWorkbook(hasil);
    const buf = await workbookToBuffer(wb);
    const blob = new Blob([buf.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'surplus.xlsx';
    a.click();
  };
  const cetak = () => {
    const w = window.open('', '_blank');
    if (w) { w.document.write(wrapPrintDocument('Surplus', surplusToHtml(hasil))); w.document.close(); }
  };

  return (
    <div className="card">
      <h2>Surplus / (Defisit)</h2>
      <div className="row noprint">
        <label className="field">Mulai<input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></label>
        <label className="field">Selesai<input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} /></label>
        <button className="primary" onClick={unduhXlsx}>Export .xlsx</button>
        <button className="ghost" onClick={cetak}>Print / PDF</button>
      </div>
      <table className="grid">
        <thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th><th>%</th></tr></thead>
        <tbody>
          <tr><th colSpan={4}>PENDAPATAN</th></tr>
          {hasil.pendapatan.map((b) => (
            <tr key={b.kode}><td>{b.kode}</td><td>{b.nama}</td><td className="num">{formatRp(b.nominal)}</td><td className="num">{b.persen.toFixed(1)}%</td></tr>
          ))}
          <tr><th colSpan={2}>Total Pendapatan</th><th className="num">{formatRp(hasil.totalPendapatan)}</th><th></th></tr>
          <tr><th colSpan={4}>BEBAN</th></tr>
          {hasil.beban.map((b) => (
            <tr key={b.kode}><td>{b.kode}</td><td>{b.nama}</td><td className="num">{formatRp(b.nominal)}</td><td className="num">{b.persen.toFixed(1)}%</td></tr>
          ))}
          <tr><th colSpan={2}>Total Beban</th><th className="num">{formatRp(hasil.totalBeban)}</th><th></th></tr>
          <tr><th colSpan={2}>SURPLUS / (DEFISIT)</th><th className="num">{formatRp(hasil.surplus)}</th><th></th></tr>
        </tbody>
      </table>
      {hasil.defisit && <p>Defisit ditampilkan dalam kurung, mis. {formatRp(-100_000)}.</p>}
    </div>
  );
}
