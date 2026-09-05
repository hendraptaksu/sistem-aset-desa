import { useEffect, useState } from 'react';
import type { Neraca } from '../../core/ledger.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import {
  neracaToHtml,
  neracaToWorkbook,
  printLaporan,
  workbookToBuffer,
  wrapPrintDocument,
} from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);

export function NeracaTab() {
  const [cutoff, setCutoff] = useState(today());
  const [data, setData] = useState<Neraca | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function muat(c = cutoff) {
    setErr(null);
    try {
      const n = await api.neraca(c);
      setData(n);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exportXlsx() {
    setErr(null);
    setInfo(null);
    if (!data) return;
    try {
      const wb = await neracaToWorkbook(data);
      const buf = await workbookToBuffer(wb);
      const r = await api.saveBuffer({
        bufferB64: u8ToB64(new Uint8Array(buf)),
        defaultName: `neraca-${cutoff}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function simpanPdf() {
    setErr(null);
    setInfo(null);
    if (!data) return;
    try {
      const html = wrapPrintDocument(`Neraca ${cutoff}`, neracaToHtml(data), { autoPrint: false });
      const r = await api.savePdf({ htmlB64: strToB64(html), defaultName: `neraca-${cutoff}.pdf` });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-lg font-bold">
          Neraca per {formatTanggal(cutoff)}{' '}
          {data && <Badge tone={data.balance ? 'green' : 'red'}>{data.balance ? 'BALANCE' : `SELISIH ${formatRp(data.selisih)}`}</Badge>}
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
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="ghost" disabled={!data} onClick={() => data && printLaporan(`Neraca ${formatTanggal(cutoff)}`, neracaToHtml(data))}>Print / PDF</Button>
          <Button variant="ghost" disabled={!data} onClick={() => void exportXlsx()}>Export .xlsx</Button>
          <Button variant="ghost" disabled={!data} onClick={() => void simpanPdf()}>Simpan PDF</Button>
        </div>
      </Card>

      {data && (
        <>
          <Card>
            <h3 className="mb-2 font-bold">Aktiva — {formatRp(data.aktiva)}</h3>
            <table className="w-full text-left text-[15px]">
              <tbody>
                {Object.entries(data.aktivaRinci.kas).map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-2 pr-3">Kas {k}</td>
                    <td className="py-2 text-right">{formatRp(v)}</td>
                  </tr>
                ))}
                <tr className="border-b">
                  <td className="py-2 pr-3">Piutang 1050</td>
                  <td className="py-2 text-right">{formatRp(data.aktivaRinci.piutang)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-3">Panjar OPEN</td>
                  <td className="py-2 text-right">{formatRp(data.aktivaRinci.panjarOpen)}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 pr-3 text-right">Total Aktiva</td>
                  <td className="py-2 text-right">{formatRp(data.aktiva)}</td>
                </tr>
              </tbody>
            </table>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">Pasiva — {formatRp(data.pasiva)}</h3>
            <table className="w-full text-left text-[15px]">
              <tbody>
                <tr className="border-b">
                  <td className="py-2 pr-3">Hutang 2050</td>
                  <td className="py-2 text-right">{formatRp(data.hutang)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-3">Modal awal 3000</td>
                  <td className="py-2 text-right">{formatRp(data.modalAwal)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-3">Kumulatif 3001</td>
                  <td className="py-2 text-right">{formatRp(data.kumulatif)}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 pr-3">Berjalan 3002 (Jan s/d cut-off)</td>
                  <td className="py-2 text-right">{formatRp(data.berjalan)}</td>
                </tr>
                <tr className="font-bold">
                  <td className="py-2 pr-3 text-right">Total Pasiva</td>
                  <td className="py-2 text-right">{formatRp(data.pasiva)}</td>
                </tr>
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}
