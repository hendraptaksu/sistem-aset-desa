import { useEffect, useMemo, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import { PANJAR_KATEGORI } from '../../core/ledger.js';
import type { Transaksi } from '../../core/types.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { buildPembantu } from '../../features/reports/pembantu/pembantu.js';
import {
  pembantuToHtml,
  pembantuToWorkbook,
  printLaporan,
  workbookToBuffer,
  wrapPrintDocument,
} from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Badge, Button, Card, ErrorBox, Field, Select, TextInput } from './ui.js';

export function PembantuTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [rows, setRows] = useState<Transaksi[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [kode, setKode] = useState('1001');
  const [mulai, setMulai] = useState('');
  const [sampai, setSampai] = useState('');

  useEffect(() => {
    api.coa().then(setCoa).catch((e) => setErr(String(e)));
  }, []);

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
    () =>
      buildPembantu(rows, {
        kode,
        mulai: mulai || undefined,
        sampai: sampai || undefined,
      }),
    [rows, kode, mulai, sampai],
  );

  async function exportXlsx() {
    setErr(null);
    setInfo(null);
    try {
      const wb = await pembantuToWorkbook(hasil);
      const buf = await workbookToBuffer(wb);
      const r = await api.saveBuffer({
        bufferB64: u8ToB64(new Uint8Array(buf)),
        defaultName: `pembantu-${kode}.xlsx`,
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
    try {
      const html = wrapPrintDocument(`Pembantu ${kode}`, pembantuToHtml(hasil), { autoPrint: false });
      const r = await api.savePdf({ htmlB64: strToB64(html), defaultName: `pembantu-${kode}.pdf` });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-lg font-bold">Buku Pembantu — {hasil.kode} {hasil.nama}</h2>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Kode">
            <Select value={kode} onChange={(e) => setKode(e.target.value)}>
              {coa.map((c) => (
                <option key={c.kode} value={c.kode}>{c.kode} — {c.nama}</option>
              ))}
              <option value={PANJAR_KATEGORI}>PANJAR — Mutasi Panjar</option>
            </Select>
          </Field>
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={() => void exportXlsx()}>Export .xlsx</Button>
          <Button variant="ghost" onClick={() => printLaporan(`Pembantu ${kode}`, pembantuToHtml(hasil))}>Print / PDF</Button>
          <Button variant="ghost" onClick={() => void simpanPdf()}>Simpan PDF</Button>
          <Badge tone={hasil.rows.length > 0 ? 'stone' : 'amber'}>{hasil.rows.length} baris</Badge>
        </div>
      </Card>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Tanggal</th>
                <th className="py-2 pr-3">Keterangan</th>
                <th className="py-2 pr-3 text-right">Masuk</th>
                <th className="py-2 text-right">Keluar</th>
              </tr>
            </thead>
            <tbody>
              {hasil.rows.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatTanggal(t.tanggal)}</td>
                  <td className="py-2 pr-3">{t.keterangan}</td>
                  <td className="py-2 pr-3 text-right">{t.masuk ? formatRp(t.masuk) : ''}</td>
                  <td className="py-2 text-right">{t.keluar ? formatRp(t.keluar) : ''}</td>
                </tr>
              ))}
              {hasil.rows.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-stone-500">Tidak ada baris.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td colSpan={2} className="py-2 pr-3 text-right">TOTAL:</td>
                <td className="py-2 pr-3 text-right">{formatRp(hasil.totalMasuk)}</td>
                <td className="py-2 text-right">{formatRp(hasil.totalKeluar)}</td>
              </tr>
              <tr className="font-bold">
                <td colSpan={3} className="py-2 pr-3 text-right">SALDO AKHIR:</td>
                <td className="py-2 text-right">{formatRp(hasil.saldo)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
