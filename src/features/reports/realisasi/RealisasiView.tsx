import { useMemo, useState } from 'react';
import { formatRp } from '../../../utils/format.js';
import { MOCK_TRANSAKSI } from '../__mocks__/data.js';
import { realisasiToHtml, realisasiToWorkbook, workbookToBuffer, wrapPrintDocument } from '../../export/export.js';
import { buildRealisasi } from './realisasi.js';

export default function RealisasiView() {
  const [mulai, setMulai] = useState('2025-01-01');
  const [sampai, setSampai] = useState('2025-12-31');
  const hasil = useMemo(() => buildRealisasi(MOCK_TRANSAKSI, mulai || undefined, sampai || undefined), [mulai, sampai]);

  const unduhXlsx = async () => {
    const wb = await realisasiToWorkbook(hasil);
    const buf = await workbookToBuffer(wb);
    const blob = new Blob([buf.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'realisasi.xlsx';
    a.click();
  };
  const cetak = () => {
    const w = window.open('', '_blank');
    if (w) { w.document.write(wrapPrintDocument('Realisasi', realisasiToHtml(hasil))); w.document.close(); }
  };

  return (
    <div className="card">
      <h2>Realisasi Anggaran</h2>
      <div className="row noprint">
        <label className="field">Mulai<input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></label>
        <label className="field">Selesai<input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} /></label>
        <button className="primary" onClick={unduhXlsx}>Export .xlsx</button>
        <button className="ghost" onClick={cetak}>Print / PDF</button>
      </div>
      <h3>Pendapatan</h3>
      <table className="grid">
        <thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th></tr></thead>
        <tbody>
          {hasil.pendapatan.map((b) => <tr key={b.kode}><td>{b.kode}</td><td>{b.nama}</td><td className="num">{formatRp(b.nominal)}</td></tr>)}
          <tr><th colSpan={2}>Total Pendapatan</th><th className="num">{formatRp(hasil.totalPendapatan)}</th></tr>
        </tbody>
      </table>
      <h3>Beban per Baga</h3>
      <table className="grid">
        <thead><tr><th>Kode</th><th>Uraian</th><th>Nominal</th></tr></thead>
        <tbody>
          {hasil.beban.map((b) => <tr key={b.kode}><td>{b.kode}</td><td>{b.nama}</td><td className="num">{formatRp(b.nominal)}</td></tr>)}
          <tr><th colSpan={2}>Total Beban</th><th className="num">{formatRp(hasil.totalBeban)}</th></tr>
          <tr><th colSpan={2}>NET = Pendapatan - Beban</th><th className="num">{formatRp(hasil.net)}</th></tr>
        </tbody>
      </table>
    </div>
  );
}
