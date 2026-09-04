import { useMemo, useState } from 'react';
import { COA } from '../../../db/coa.js';
import { formatRp } from '../../../utils/format.js';
import { MOCK_TRANSAKSI } from '../__mocks__/data.js';
import { pembantuToHtml, pembantuToWorkbook, workbookToBuffer, wrapPrintDocument } from '../../export/export.js';
import { buildPembantu } from './pembantu.js';

export default function PembantuView() {
  const [kode, setKode] = useState('1010');
  const [mulai, setMulai] = useState('2025-01-01');
  const [sampai, setSampai] = useState('2025-12-31');
  const hasil = useMemo(() => buildPembantu(MOCK_TRANSAKSI, {
    kode, mulai: mulai || undefined, sampai: sampai || undefined,
  }), [kode, mulai, sampai]);

  const unduhXlsx = async () => {
    const wb = await pembantuToWorkbook(hasil);
    const buf = await workbookToBuffer(wb);
    const blob = new Blob([buf.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pembantu-${kode}.xlsx`;
    a.click();
  };
  const cetak = () => {
    const w = window.open('', '_blank');
    if (w) { w.document.write(wrapPrintDocument(`Pembantu ${kode}`, pembantuToHtml(hasil))); w.document.close(); }
  };

  return (
    <div className="card">
      <h2>Buku Pembantu — {hasil.kode} {hasil.nama}</h2>
      <div className="row noprint">
        <label className="field">Kode<select value={kode} onChange={(e) => setKode(e.target.value)}>
          {COA.map((c) => <option key={c.kode} value={c.kode}>{c.kode} — {c.nama}</option>)}
          <option value="PANJAR">PANJAR — Mutasi Panjar</option>
        </select></label>
        <label className="field">Mulai<input type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} /></label>
        <label className="field">Selesai<input type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} /></label>
        <button className="primary" onClick={unduhXlsx}>Export .xlsx</button>
        <button className="ghost" onClick={cetak}>Print / PDF</button>
      </div>
      <table className="grid">
        <thead><tr><th>Tanggal</th><th>Keterangan</th><th>Masuk</th><th>Keluar</th></tr></thead>
        <tbody>
          {hasil.rows.map((t) => (
            <tr key={t.id}><td>{t.tanggal}</td><td>{t.keterangan}</td>
              <td className="num">{t.masuk === 0 ? '—' : formatRp(t.masuk)}</td>
              <td className="num">{t.keluar === 0 ? '—' : formatRp(t.keluar)}</td></tr>
          ))}
        </tbody>
        <tfoot>
          <tr><th colSpan={2}>TOTAL</th><th className="num">{formatRp(hasil.totalMasuk)}</th><th className="num">{formatRp(hasil.totalKeluar)}</th></tr>
          <tr><th colSpan={3}>SALDO AKHIR</th><th className="num">{formatRp(hasil.saldo)}</th></tr>
        </tfoot>
      </table>
    </div>
  );
}
