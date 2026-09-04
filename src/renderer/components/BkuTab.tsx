import { useEffect, useMemo, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import type { Transaksi } from '../../core/types.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, isPerluAlasan } from '../lib/api.js';
import { Badge, Button, Card, CurrencyInput, ErrorBox, Field, LockModal, Select, TextInput } from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);
const PAGE = 20;

export function BkuTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [rows, setRows] = useState<Transaksi[]>([]);
  const [saldo, setSaldo] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [lockRetry, setLockRetry] = useState<null | ((alasan: string) => Promise<void>)>(null);

  // form
  const [tanggal, setTanggal] = useState(today());
  const [keterangan, setKeterangan] = useState('');
  const [akunKas, setAkunKas] = useState('1001');
  const [kategori, setKategori] = useState('4005');
  const [tipe, setTipe] = useState<'masuk' | 'keluar'>('masuk');
  const [nominal, setNominal] = useState(0);

  // filter
  const [cari, setCari] = useState('');
  const [fMulai, setFMulai] = useState('');
  const [fSampai, setFSampai] = useState('');
  const [fKas, setFKas] = useState('');
  const [fKat, setFKat] = useState('');
  const [page, setPage] = useState(0);

  const kasList = useMemo(() => coa.filter((c) => c.tipe === 'KAS'), [coa]);
  const katList = useMemo(
    () => coa.filter((c) => c.tipe !== 'KAS' && c.kode !== '3001' && c.kode !== '3002'),
    [coa],
  );
  const namaKode = useMemo(() => new Map(coa.map((c) => [c.kode, c.nama])), [coa]);

  async function refresh() {
    try {
      const [c, t, s] = await Promise.all([api.coa(), api.transaksiList(), api.saldo()]);
      setCoa(c);
      setRows(t);
      setSaldo(s.perKas);
    } catch (e) {
      setErr(String(e));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);

  const filtered = useMemo(() => {
    const q = cari.toLowerCase();
    return rows.filter(
      (t) =>
        (!q || t.keterangan.toLowerCase().includes(q)) &&
        (!fMulai || t.tanggal >= fMulai) &&
        (!fSampai || t.tanggal <= fSampai) &&
        (!fKas || t.akun_kas === fKas) &&
        (!fKat || t.kategori === fKat),
    );
  }, [rows, cari, fMulai, fSampai, fKas, fKat]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageRows = filtered.slice(page * PAGE, page * PAGE + PAGE);
  const totMasuk = filtered.reduce((s, t) => s + t.masuk, 0);
  const totKeluar = filtered.reduce((s, t) => s + t.keluar, 0);

  async function submit(alasan?: string) {
    setErr(null);
    const input = {
      tanggal,
      keterangan: keterangan.trim(),
      akun_kas: akunKas,
      kategori,
      masuk: tipe === 'masuk' ? nominal : 0,
      keluar: tipe === 'keluar' ? nominal : 0,
    };
    try {
      await api.transaksiCreate(input, alasan);
      setKeterangan('');
      setNominal(0);
      setLockRetry(null);
      await refresh();
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockRetry(() => (a: string) => submit(a));
      } else setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-2 text-lg font-bold">Saldo Kas Saat Ini</h2>
        <div className="flex flex-wrap gap-2">
          {kasList.map((k) => (
            <Badge key={k.kode} tone={(saldo[k.kode] ?? 0) < 0 ? 'red' : 'stone'}>
              {k.nama}: {formatRp(saldo[k.kode] ?? 0)}
            </Badge>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">Input Transaksi</h2>
        <ErrorBox msg={err} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Tanggal">
            <TextInput type="date" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
          </Field>
          <Field label="Keterangan">
            <TextInput value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="cth: Parkir minggu I" />
          </Field>
          <Field label="Dompet (Akun Kas)">
            <Select value={akunKas} onChange={(e) => setAkunKas(e.target.value)}>
              {kasList.map((k) => (
                <option key={k.kode} value={k.kode}>{k.kode} — {k.nama}</option>
              ))}
            </Select>
          </Field>
          <Field label="Untuk Apa (Kategori)">
            <Select value={kategori} onChange={(e) => setKategori(e.target.value)}>
              {(['PENDAPATAN', 'BEBAN'] as const).map((g) => (
                <optgroup key={g} label={g === 'PENDAPATAN' ? 'Pendapatan' : 'Pengeluaran / Baga'}>
                  {katList.filter((c) => c.tipe === g).map((c) => (
                    <option key={c.kode} value={c.kode}>{c.kode} — {c.nama}</option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Lainnya">
                {katList.filter((c) => c.tipe !== 'PENDAPATAN' && c.tipe !== 'BEBAN').map((c) => (
                  <option key={c.kode} value={c.kode}>{c.kode} — {c.nama}</option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Tipe">
            <div className="flex gap-4 py-2">
              <label className="flex items-center gap-1 text-[15px]">
                <input type="radio" checked={tipe === 'masuk'} onChange={() => setTipe('masuk')} /> Uang Masuk
              </label>
              <label className="flex items-center gap-1 text-[15px]">
                <input type="radio" checked={tipe === 'keluar'} onChange={() => setTipe('keluar')} /> Uang Keluar
              </label>
            </div>
          </Field>
          <Field label="Nominal (Rp)">
            <CurrencyInput value={nominal} onChange={setNominal} />
          </Field>
        </div>
        <div className="mt-3">
          <Button onClick={() => void submit()}>Simpan</Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-lg font-bold">Buku Kas Umum</h2>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <TextInput placeholder="Cari keterangan…" value={cari} onChange={(e) => { setCari(e.target.value); setPage(0); }} />
          <TextInput type="date" value={fMulai} onChange={(e) => { setFMulai(e.target.value); setPage(0); }} />
          <TextInput type="date" value={fSampai} onChange={(e) => { setFSampai(e.target.value); setPage(0); }} />
          <Select value={fKas} onChange={(e) => { setFKas(e.target.value); setPage(0); }}>
            <option value="">Semua dompet</option>
            {kasList.map((k) => <option key={k.kode} value={k.kode}>{k.nama}</option>)}
          </Select>
          <Select value={fKat} onChange={(e) => { setFKat(e.target.value); setPage(0); }}>
            <option value="">Semua kategori</option>
            {katList.map((c) => <option key={c.kode} value={c.kode}>{c.kode} — {c.nama}</option>)}
          </Select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Tanggal</th>
                <th className="py-2 pr-3">Keterangan</th>
                <th className="py-2 pr-3">Dompet</th>
                <th className="py-2 pr-3">Kategori</th>
                <th className="py-2 pr-3 text-right">Masuk</th>
                <th className="py-2 text-right">Keluar</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatTanggal(t.tanggal)}</td>
                  <td className="py-2 pr-3">{t.keterangan}</td>
                  <td className="py-2 pr-3">{namaKode.get(t.akun_kas) ?? t.akun_kas}</td>
                  <td className="py-2 pr-3">{t.kategori} — {namaKode.get(t.kategori) ?? ''}</td>
                  <td className="py-2 pr-3 text-right">{t.masuk ? formatRp(t.masuk) : ''}</td>
                  <td className="py-2 text-right">{t.keluar ? formatRp(t.keluar) : ''}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr><td colSpan={6} className="py-4 text-center text-stone-500">Belum ada transaksi.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td colSpan={4} className="py-2 pr-3 text-right">Total ({filtered.length} baris):</td>
                <td className="py-2 pr-3 text-right">{formatRp(totMasuk)}</td>
                <td className="py-2 text-right">{formatRp(totKeluar)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>‹ Prev</Button>
          <span className="text-sm text-stone-600">Hal {page + 1} / {pages}</span>
          <Button variant="ghost" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next ›</Button>
        </div>
      </Card>

      {lockRetry && <LockModal onCancel={() => setLockRetry(null)} onSubmit={(a) => void lockRetry(a)} />}
    </div>
  );
}
