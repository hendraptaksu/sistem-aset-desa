import { useEffect, useMemo, useState } from 'react';
import type { Transaksi } from '../../core/types.js';
import { formatRp } from '../../utils/format.js';
import { buildSurplus } from '../../features/reports/surplus/surplus.js';
import {
  printLaporan,
  surplusToHtml,
  surplusToWorkbook,
  workbookToBuffer,
  wrapPrintDocument,
} from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';

export function SurplusTab() {
  const [rows, setRows] = useState<Transaksi[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [mulai, setMulai] = useState('');
  const [sampai, setSampai] = useState('');

  async function muat() {
    setErr(null);
    setInfo(null);
    try {
      const t = await api.transaksiList({
        ...(mulai ? { mulai } : {}),
        ...(sampai ? { sampai } : {}),
      });
      setRows(t);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mulai, sampai]);

  const hasil = useMemo(
    () => buildSurplus(rows, mulai || undefined, sampai || undefined),
    [rows, mulai, sampai],
  );

  async function exportXlsx() {
    setErr(null);
    setInfo(null);
    try {
      const wb = await surplusToWorkbook(hasil);
      const buf = await workbookToBuffer(wb);
      const r = await api.saveBuffer({
        bufferB64: u8ToB64(new Uint8Array(buf)),
        defaultName: 'surplus.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function simpanHtml() {
    setErr(null);
    setInfo(null);
    try {
      const html = wrapPrintDocument('Surplus', surplusToHtml(hasil));
      const r = await api.saveBuffer({
        bufferB64: strToB64(html),
        defaultName: 'surplus.html',
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-lg font-bold">
          Surplus / (Defisit){' '}
          <Badge tone={hasil.defisit ? 'red' : 'green'}>{hasil.defisit ? 'DEFISIT' : 'SURPLUS'}</Badge>
        </h2>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Mulai">
            <TextInput type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} />
          </Field>
          <Field label="Sampai">
            <TextInput type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button onClick={() => void muat()}>Muat</Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void exportXlsx()}>Export .xlsx</Button>
          <Button variant="ghost" onClick={() => printLaporan('Surplus', surplusToHtml(hasil))}>Print / PDF</Button>
          <Button variant="ghost" onClick={() => void simpanHtml()}>Simpan HTML</Button>
        </div>
      </Card>

      <Card>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Kode</th>
              <th className="py-2 pr-3">Uraian</th>
              <th className="py-2 text-right">Nominal</th>
              <th className="py-2 text-right">%</th>
            </tr>
          </thead>
          <tbody>
            <tr><th colSpan={4} className="py-2">PENDAPATAN</th></tr>
            {hasil.pendapatan.map((b) => (
              <tr key={b.kode} className="border-b last:border-0">
                <td className="py-2 pr-3">{b.kode}</td>
                <td className="py-2 pr-3">{b.nama}</td>
                <td className="py-2 text-right">{formatRp(b.nominal)}</td>
                <td className="py-2 text-right">{b.persen.toFixed(1)}%</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2} className="py-2 pr-3 text-right">Total Pendapatan</td>
              <td className="py-2 text-right">{formatRp(hasil.totalPendapatan)}</td>
              <td />
            </tr>
            <tr><th colSpan={4} className="py-2">BEBAN</th></tr>
            {hasil.beban.map((b) => (
              <tr key={b.kode} className="border-b last:border-0">
                <td className="py-2 pr-3">{b.kode}</td>
                <td className="py-2 pr-3">{b.nama}</td>
                <td className="py-2 text-right">{formatRp(b.nominal)}</td>
                <td className="py-2 text-right">{b.persen.toFixed(1)}%</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2} className="py-2 pr-3 text-right">Total Beban</td>
              <td className="py-2 text-right">{formatRp(hasil.totalBeban)}</td>
              <td />
            </tr>
            <tr className="font-bold">
              <td colSpan={2} className="py-2 pr-3 text-right">SURPLUS / (DEFISIT)</td>
              <td className="py-2 text-right">{formatRp(hasil.surplus)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        {hasil.defisit && (
          <p className="mt-2 text-sm text-stone-600">
            Defisit ditampilkan dalam kurung, mis. {formatRp(-100_000)}.
          </p>
        )}
      </Card>
    </div>
  );
}
