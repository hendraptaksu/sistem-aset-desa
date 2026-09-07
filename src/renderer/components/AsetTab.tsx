import { useEffect, useMemo, useState } from 'react';
import type { Aset } from '../../core/types.js';
import { formatRp } from '../../utils/format.js';
import { asetToHtml, asetToWorkbook, printLaporan, workbookToBuffer, wrapPrintDocument } from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Badge, Button, Card, CurrencyInput, ErrorBox, Field, Select, TextInput } from './ui.js';

const JENIS = ['TANAH', 'BANGUNAN', 'LAINNYA'] as const;
const KONDISI = ['BAIK', 'RUSAK_RINGAN', 'RUSAK_BERAT', 'TIDAK_DIKETAHUI'] as const;

const KOSONG = {
  kode: '', nama: '', jenis: 'TANAH', luas: '', lokasi: '',
  status_hukum: '', tahun: '', asal_usul: '', kondisi: 'BAIK', keterangan: '',
};

export function AsetTab() {
  const [list, setList] = useState<Aset[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [fJenis, setFJenis] = useState('');
  const [form, setForm] = useState({ ...KOSONG });
  const [adaNilai, setAdaNilai] = useState(false);
  const [nilai, setNilai] = useState(0);
  const [editId, setEditId] = useState<string | null>(null);

  async function refresh() {
    try {
      setErr(null);
      setList(await api.asetList());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => { void refresh(); }, []);

  const shown = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return list.filter((a) =>
      (!fJenis || a.jenis === fJenis) &&
      (!q || `${a.kode} ${a.nama} ${a.lokasi}`.toLowerCase().includes(q)));
  }, [list, cari, fJenis]);

  const totalDinilai = useMemo(
    () => shown.filter((a) => a.nilai_sen !== null).reduce((s, a) => s + (a.nilai_sen ?? 0), 0),
    [shown],
  );

  function isiEdit(a: Aset) {
    setEditId(a.id);
    setForm({
      kode: a.kode, nama: a.nama, jenis: a.jenis, luas: a.luas_m2 === null ? '' : String(a.luas_m2),
      lokasi: a.lokasi, status_hukum: a.status_hukum,
      tahun: a.tahun_perolehan === null ? '' : String(a.tahun_perolehan),
      asal_usul: a.asal_usul, kondisi: a.kondisi, keterangan: a.keterangan,
    });
    setAdaNilai(a.nilai_sen !== null);
    setNilai(a.nilai_sen ?? 0);
    window.scrollTo({ top: 0 });
  }

  function resetForm() {
    setEditId(null);
    setForm({ ...KOSONG });
    setAdaNilai(false);
    setNilai(0);
  }

  async function submit() {
    setErr(null); setInfo(null);
    const luas_m2 = form.luas.trim() === '' ? null : Number(form.luas.replace(',', '.'));
    const tahun_perolehan = form.tahun.trim() === '' ? null : Number(form.tahun);
    const input = {
      kode: form.kode, nama: form.nama, jenis: form.jenis,
      luas_m2: luas_m2 !== null && Number.isFinite(luas_m2) ? luas_m2 : null,
      lokasi: form.lokasi, status_hukum: form.status_hukum,
      tahun_perolehan: tahun_perolehan !== null && Number.isInteger(tahun_perolehan) ? tahun_perolehan : null,
      asal_usul: form.asal_usul, kondisi: form.kondisi, keterangan: form.keterangan,
      nilai_sen: adaNilai ? nilai : null,
    };
    try {
      if (editId) {
        await api.asetUpdate(editId, input);
        setInfo('Aset diperbarui.');
      } else {
        await api.asetCreate(input);
        setInfo('Aset tersimpan — tidak mengubah BKU/Neraca.');
      }
      resetForm();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function hapus(id: string) {
    if (!confirm('Hapus aset ini dari inventaris? (tidak mengubah BKU/Neraca)')) return;
    setErr(null); setInfo(null);
    try {
      await api.asetDelete(id);
      if (editId === id) resetForm();
      await refresh();
      setInfo('Aset dihapus.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportXlsx() {
    setErr(null); setInfo(null);
    try {
      const wb = await asetToWorkbook(shown);
      const buf = await workbookToBuffer(wb);
      const r = await api.saveBuffer({
        bufferB64: u8ToB64(new Uint8Array(buf)),
        defaultName: 'inventaris-aset.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function simpanPdf() {
    setErr(null); setInfo(null);
    try {
      const html = wrapPrintDocument('Inventaris Aset', asetToHtml(shown), { autoPrint: false });
      const r = await api.savePdf({ htmlB64: strToB64(html), defaultName: 'inventaris-aset.pdf' });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  const set = (k: keyof typeof KOSONG) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-lg font-bold">{editId ? 'Ubah Aset' : 'Tambah Aset (Tanah / Bangunan)'}</h2>
        <p className="mb-3 text-sm text-stone-500">
          Inventaris non-keuangan — nilai boleh dikosongkan bila belum pasti. Tidak masuk BKU maupun Neraca.
        </p>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Kode *">
            <TextInput value={form.kode} onChange={set('kode')} placeholder="cth: AST-001" />
          </Field>
          <Field label="Nama *">
            <TextInput value={form.nama} onChange={set('nama')} placeholder="cth: Tanah Pura Kangin" />
          </Field>
          <Field label="Jenis">
            <Select value={form.jenis} onChange={set('jenis')}>
              {JENIS.map((j) => <option key={j} value={j}>{j}</option>)}
            </Select>
          </Field>
          <Field label="Kondisi">
            <Select value={form.kondisi} onChange={set('kondisi')}>
              {KONDISI.map((k) => <option key={k} value={k}>{k}</option>)}
            </Select>
          </Field>
          <Field label="Luas (m², opsional)">
            <TextInput value={form.luas} onChange={set('luas')} placeholder="cth: 500" inputMode="decimal" />
          </Field>
          <Field label="Lokasi">
            <TextInput value={form.lokasi} onChange={set('lokasi')} placeholder="cth: Banjar Peliatan" />
          </Field>
          <Field label="Status hukum">
            <TextInput value={form.status_hukum} onChange={set('status_hukum')} placeholder="druwe / SHM / hibah" />
          </Field>
          <Field label="Tahun perolehan">
            <TextInput value={form.tahun} onChange={set('tahun')} placeholder="cth: 2010" inputMode="numeric" />
          </Field>
          <Field label="Asal-usul">
            <TextInput value={form.asal_usul} onChange={set('asal_usul')} placeholder="cth: hibah krama" />
          </Field>
          <Field label="Keterangan">
            <TextInput value={form.keterangan} onChange={set('keterangan')} placeholder="catatan tambahan" />
          </Field>
          <Field label="Nilai (opsional)">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={adaNilai} onChange={(e) => setAdaNilai(e.target.checked)} aria-label="Ada nilai" />
              <span className="w-40"><CurrencyInput value={nilai} onChange={setNilai} /></span>
            </div>
          </Field>
        </div>
        <div className="mt-3 flex gap-2">
          <Button onClick={() => void submit()}>{editId ? 'Simpan Perubahan' : 'Simpan Aset'}</Button>
          {editId && <Button variant="ghost" onClick={resetForm}>Batal</Button>}
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-bold">Daftar Aset ({shown.length})</h2>
          <TextInput value={cari} onChange={(e) => setCari(e.target.value)} placeholder="Cari kode/nama/lokasi" className="!w-52" />
          <Select value={fJenis} onChange={(e) => setFJenis(e.target.value)} className="!w-40">
            <option value="">Semua jenis</option>
            {JENIS.map((j) => <option key={j} value={j}>{j}</option>)}
          </Select>
        </div>
        <div className="mb-3 flex flex-wrap gap-2">
          <Button variant="ghost" onClick={() => void exportXlsx()}>Export .xlsx</Button>
          <Button variant="ghost" onClick={() => printLaporan('Inventaris Aset', asetToHtml(shown))}>Print / PDF</Button>
          <Button variant="ghost" onClick={() => void simpanPdf()}>Simpan PDF</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Kode</th>
                <th className="py-2 pr-3">Nama</th>
                <th className="py-2 pr-3">Jenis</th>
                <th className="py-2 pr-3">Lokasi</th>
                <th className="py-2 pr-3">Status/Kondisi</th>
                <th className="py-2 pr-3 text-right">Nilai</th>
                <th className="py-2">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 font-semibold whitespace-nowrap">{a.kode}</td>
                  <td className="py-2 pr-3">{a.nama}</td>
                  <td className="py-2 pr-3"><Badge tone={a.jenis === 'TANAH' ? 'green' : a.jenis === 'BANGUNAN' ? 'amber' : 'stone'}>{a.jenis}</Badge></td>
                  <td className="py-2 pr-3">{a.lokasi || '—'}</td>
                  <td className="py-2 pr-3 text-sm">{a.status_hukum || '—'} / {a.kondisi}</td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {a.nilai_sen === null ? <span className="text-stone-400">belum dinilai</span> : formatRp(a.nilai_sen)}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <Button variant="ghost" onClick={() => isiEdit(a)}>Ubah</Button>{' '}
                    <Button variant="danger" onClick={() => void hapus(a.id)}>Hapus</Button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && <tr><td colSpan={7} className="py-4 text-center text-stone-500">Belum ada aset.</td></tr>}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td colSpan={5} className="py-2 pr-3 text-right">Total yang sudah dinilai</td>
                <td className="py-2 pr-3 text-right">{formatRp(totalDinilai)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
