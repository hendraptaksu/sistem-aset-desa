import { useEffect, useMemo, useState } from 'react';
import type { Transaksi } from '../../core/types.js';
import { formatRp } from '../../utils/format.js';
import { buildRealisasi } from '../../features/reports/realisasi/realisasi.js';
import {
  printLaporan,
  realisasiToHtml,
  realisasiToWorkbook,
  workbookToBuffer,
  wrapPrintDocument,
} from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Button, Card, ErrorBox, Field, TextInput } from './ui.js';

export function RealisasiTab() {
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
    () => buildRealisasi(rows, mulai || undefined, sampai || undefined),
    [rows, mulai, sampai],
  );

  async function exportXlsx() {
    setErr(null);
    setInfo(null);
    try {
      const wb = await realisasiToWorkbook(hasil);
      const buf = await workbookToBuffer(wb);
      const r = await api.saveBuffer({
        bufferB64: u8ToB64(new Uint8Array(buf)),
        defaultName: 'realisasi.xlsx',
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
      const html = wrapPrintDocument('Realisasi', realisasiToHtml(hasil));
      const r = await api.saveBuffer({
        bufferB64: strToB64(html),
        defaultName: 'realisasi.html',
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
        <h2 className="mb-3 text-lg font-bold">Realisasi Anggaran</h2>
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
          <Button variant="ghost" onClick={() => printLaporan('Realisasi', realisasiToHtml(hasil))}>Print / PDF</Button>
          <Button variant="ghost" onClick={() => void simpanHtml()}>Simpan HTML</Button>
        </div>
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Pendapatan</h3>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Kode</th>
              <th className="py-2 pr-3">Uraian</th>
              <th className="py-2 text-right">Nominal</th>
            </tr>
          </thead>
          <tbody>
            {hasil.pendapatan.map((b) => (
              <tr key={b.kode} className="border-b last:border-0">
                <td className="py-2 pr-3">{b.kode}</td>
                <td className="py-2 pr-3">{b.nama}</td>
                <td className="py-2 text-right">{formatRp(b.nominal)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2} className="py-2 pr-3 text-right">Total Pendapatan</td>
              <td className="py-2 text-right">{formatRp(hasil.totalPendapatan)}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Beban per Baga</h3>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Kode</th>
              <th className="py-2 pr-3">Uraian</th>
              <th className="py-2 text-right">Nominal</th>
            </tr>
          </thead>
          <tbody>
            {hasil.beban.map((b) => (
              <tr key={b.kode} className="border-b last:border-0">
                <td className="py-2 pr-3">{b.kode}</td>
                <td className="py-2 pr-3">{b.nama}</td>
                <td className="py-2 text-right">{formatRp(b.nominal)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td colSpan={2} className="py-2 pr-3 text-right">Total Beban</td>
              <td className="py-2 text-right">{formatRp(hasil.totalBeban)}</td>
            </tr>
            <tr className="font-bold">
              <td colSpan={2} className="py-2 pr-3 text-right">NET = Pendapatan − Beban</td>
              <td className="py-2 text-right">{formatRp(hasil.net)}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </div>
  );
}
