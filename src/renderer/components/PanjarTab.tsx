import { useEffect, useMemo, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import type { Panjar } from '../../core/types.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, isPerluAlasan } from '../lib/api.js';
import { Badge, Button, Card, CurrencyInput, ErrorBox, Field, LockModal, Select, TextInput } from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);

type ItemRow = { kategori_baga: string; nominal: number };

export function PanjarTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [list, setList] = useState<Panjar[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<'' | 'OPEN' | 'CLOSED'>('');
  const [lockRetry, setLockRetry] = useState<null | ((alasan: string) => Promise<void>)>(null);

  // form open
  const [tanggal, setTanggal] = useState(today());
  const [penerima, setPenerima] = useState('');
  const [jumlah, setJumlah] = useState(0);
  const [sumber, setSumber] = useState('1001');

  // close flow
  const [closeId, setCloseId] = useState('');
  const [tanggalClose, setTanggalClose] = useState(today());
  const [items, setItems] = useState<ItemRow[]>([{ kategori_baga: '5004', nominal: 0 }]);

  const kasList = useMemo(() => coa.filter((c) => c.tipe === 'KAS'), [coa]);
  const bagaList = useMemo(() => coa.filter((c) => c.tipe === 'BEBAN'), [coa]);
  const namaKas = useMemo(() => new Map(kasList.map((c) => [c.kode, c.nama])), [kasList]);

  async function refresh() {
    try {
      const [c, p] = await Promise.all([api.coa(), api.panjarList()]);
      setCoa(c);
      setList(p);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  const shown = list.filter((p) => !fStatus || p.status === fStatus);
  const openList = list.filter((p) => p.status === 'OPEN');
  const totalRealisasi = items.reduce((s, i) => s + i.nominal, 0);
  const closeTarget = openList.find((p) => p.id === closeId);
  const selisih = closeTarget ? closeTarget.jumlah - totalRealisasi : 0;

  async function submitOpen(alasan?: string) {
    setErr(null);
    setInfo(null);
    try {
      await api.panjarCreate({ tanggal, penerima: penerima.trim(), jumlah, akun_kas_sumber: sumber }, alasan);
      setPenerima('');
      setJumlah(0);
      setLockRetry(null);
      await refresh();
      setInfo('Panjar tersimpan — Kas berkurang otomatis.');
    } catch (e) {
      if (isPerluAlasan(e)) setLockRetry(() => (a: string) => submitOpen(a));
      else setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function submitClose(alasan?: string) {
    setErr(null);
    setInfo(null);
    if (!closeId) {
      setErr('Pilih panjar yang akan di-close.');
      return;
    }
    try {
      const r = await api.panjarClose({ id: closeId, tanggalClose, items }, alasan);
      setLockRetry(null);
      setCloseId('');
      setItems([{ kategori_baga: '5004', nominal: 0 }]);
      await refresh();
      setInfo(
        `Panjar closed. Belanja ${formatRp(r.totalRealisasi)}` +
          (r.sisa > 0 ? `, sisa ${formatRp(r.sisa)} kembali ke kas.` : '') +
          (r.kurang > 0 ? `, kurang ${formatRp(r.kurang)} terambil dari kas.` : ''),
      );
    } catch (e) {
      if (isPerluAlasan(e)) setLockRetry(() => (a: string) => submitClose(a));
      else setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-lg font-bold">Panjar Baru (Uang Muka)</h2>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Tanggal Panjar">
            <TextInput type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </Field>
          <Field label="Penerima / Panitia">
            <TextInput value={penerima} onChange={(e) => setPenerima(e.target.value)} placeholder="cth: Panitia Piodalan" />
          </Field>
          <Field label="Jumlah (Rp)">
            <CurrencyInput value={jumlah} onChange={setJumlah} />
          </Field>
          <Field label="Diambil dari">
            <Select value={sumber} onChange={(e) => setSumber(e.target.value)}>
              {kasList.map((k) => <option key={k.kode} value={k.kode}>{k.kode} — {k.nama}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-3">
          <Button onClick={() => void submitOpen()}>Serahkan Panjar</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">Pertanggungjawaban (Close)</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Pilih Panjar OPEN">
            <Select value={closeId} onChange={(e) => setCloseId(e.target.value)}>
              <option value="">— pilih —</option>
              {openList.map((p) => (
                <option key={p.id} value={p.id}>{formatTanggal(p.tanggal)} — {p.penerima} — {formatRp(p.jumlah)}</option>
              ))}
            </Select>
          </Field>
          <Field label="Tanggal Realisasi">
            <TextInput type="date" value={tanggalClose} onChange={(e) => setTanggalClose(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_160px_auto] items-end gap-2">
              <Field label={i === 0 ? 'Baga' : ''}>
                <Select value={it.kategori_baga} onChange={(e) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, kategori_baga: e.target.value } : x)))}>
                  {bagaList.map((b) => <option key={b.kode} value={b.kode}>{b.kode} — {b.nama}</option>)}
                </Select>
              </Field>
              <Field label={i === 0 ? 'Nominal (Rp)' : ''}>
                <CurrencyInput value={it.nominal} onChange={(n) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, nominal: n } : x)))} />
              </Field>
              <Button variant="ghost" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} disabled={items.length === 1}>✕</Button>
            </div>
          ))}
          <Button variant="ghost" onClick={() => setItems((xs) => [...xs, { kategori_baga: '5004', nominal: 0 }])}>+ Tambah baris</Button>
        </div>
        {closeTarget && (
          <p className="mt-2 text-[15px]">
            Total belanja: <b>{formatRp(totalRealisasi)}</b> dari panjar {formatRp(closeTarget.jumlah)} →{' '}
            {selisih > 0 && <span className="font-semibold text-green-700">sisa {formatRp(selisih)} kembali</span>}
            {selisih < 0 && <span className="font-semibold text-red-700">kurang {formatRp(-selisih)}</span>}
            {selisih === 0 && <span className="font-semibold">pas</span>}
          </p>
        )}
        <div className="mt-3">
          <Button onClick={() => void submitClose()}>Close Panjar</Button>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="shrink-0 text-lg font-bold whitespace-nowrap">Daftar Panjar</h2>
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value as '' | 'OPEN' | 'CLOSED')}>
            <option value="">Semua</option>
            <option value="OPEN">Open</option>
            <option value="CLOSED">Closed</option>
          </Select>
        </div>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Tanggal</th>
              <th className="py-2 pr-3">Penerima</th>
              <th className="py-2 pr-3">Sumber</th>
              <th className="py-2 pr-3 text-right">Jumlah</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr key={p.id} className="border-b last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap">{formatTanggal(p.tanggal)}</td>
                <td className="py-2 pr-3">{p.penerima}</td>
                <td className="py-2 pr-3">{namaKas.get(p.akun_kas_sumber) ?? p.akun_kas_sumber}</td>
                <td className="py-2 pr-3 text-right">{formatRp(p.jumlah)}</td>
                <td className="py-2"><Badge tone={p.status === 'OPEN' ? 'amber' : 'green'}>{p.status}</Badge></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-stone-500">Belum ada panjar.</td></tr>}
          </tbody>
        </table>
      </Card>

      {lockRetry && <LockModal onCancel={() => setLockRetry(null)} onSubmit={(a) => void lockRetry(a)} />}
    </div>
  );
}
