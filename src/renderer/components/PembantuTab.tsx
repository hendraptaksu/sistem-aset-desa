import { useEffect, useMemo, useRef, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import type { PembantuHasil } from '../../features/reports/types.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { pembantuDariBukuBesar } from '../../features/reports/pembantu/pembantu.js';
import {
  pembantuToHtml,
  pembantuToWorkbook,
  workbookToBuffer,
  wrapPrintDocument,
} from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64, type BukuBesarHasil } from '../lib/api.js';
import { Badge, Button, Card, ErrorBox, Field, Select, TextInput } from './ui.js';
import { PratinjauHtmlModal } from './PratinjauHtmlModal.js';
import {
  PESAN_MUAT_GAGAL,
  PESAN_PROSES_GAGAL,
  pesanError,
} from '../../utils/pesanError.js';

export function PembantuTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [data, setData] = useState<BukuBesarHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [kode, setKode] = useState('1001');
  const [mulai, setMulai] = useState('');
  const [sampai, setSampai] = useState('');
  const [memuat, setMemuat] = useState(false);
  const [sibuk, setSibuk] = useState(false);
  const [muatUlang, setMuatUlang] = useState(0);
  const busyRef = useRef(false);
  const [pratinjau, setPratinjau] = useState<{ judul: string; body: string } | null>(null);

  // Daftar akun untuk pilihan kode; pilih 1001 KAS bila tersedia.
  useEffect(() => {
    let aktif = true;
    api
      .coa()
      .then((daftar) => {
        if (!aktif) return;
        setCoa(daftar);
        setKode((sebelumnya) =>
          daftar.some((c) => c.kode === sebelumnya) ? sebelumnya : (daftar[0]?.kode ?? ''),
        );
      })
      .catch((e) => {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      });
    return () => {
      aktif = false;
    };
  }, []);

  // Sumber angka = jurnal (Buku Besar), bukan tabel single-entry lama.
  useEffect(() => {
    if (!kode) {
      setData(null);
      return;
    }
    let aktif = true;
    setMemuat(true);
    setErr(null);
    setInfo(null);
    setData(null);
    api
      .laporanBukuBesar({
        akun_kode: kode,
        ...(mulai ? { mulai } : {}),
        ...(sampai ? { sampai } : {}),
      })
      .then((hasil) => {
        if (aktif) setData(hasil);
      })
      .catch((e) => {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      })
      .finally(() => {
        if (aktif) setMemuat(false);
      });
    return () => {
      aktif = false;
    };
  }, [kode, mulai, sampai, muatUlang]);

  function muat(): void {
    setMuatUlang((n) => n + 1);
  }

  const hasil = useMemo<PembantuHasil>(() => {
    if (data) return pembantuDariBukuBesar(data);
    return {
      kode,
      nama: coa.find((c) => c.kode === kode)?.nama ?? kode,
      rows: [],
      totalMasuk: 0,
      totalKeluar: 0,
      saldo: 0,
      mulai: mulai || undefined,
      sampai: sampai || undefined,
    };
  }, [data, kode, coa, mulai, sampai]);

  // Saldo berjalan per baris, dimulai dari saldo awal periode.
  const barisTampil = useMemo(() => {
    let saldo = hasil.saldoAwal ?? 0;
    return hasil.rows.map((t) => {
      saldo += t.masuk - t.keluar;
      return { ...t, saldoJalan: saldo };
    });
  }, [hasil]);

  async function exportXlsx() {
    if (busyRef.current) return;
    busyRef.current = true;
    setSibuk(true);
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
      setErr(pesanError(e, PESAN_PROSES_GAGAL));
    } finally {
      busyRef.current = false;
      setSibuk(false);
    }
  }

  async function simpanPdf() {
    if (busyRef.current) return;
    busyRef.current = true;
    setSibuk(true);
    setErr(null);
    setInfo(null);
    try {
      const html = wrapPrintDocument(`Pembantu ${kode}`, pembantuToHtml(hasil), { autoPrint: false });
      const r = await api.savePdf({ htmlB64: strToB64(html), defaultName: `pembantu-${kode}.pdf` });
      if (r.saved) setInfo(`Tersimpan: ${r.path}`);
    } catch (e) {
      setErr(pesanError(e, PESAN_PROSES_GAGAL));
    } finally {
      busyRef.current = false;
      setSibuk(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="mb-3 text-lg font-bold">Buku Pembantu — {hasil.kode} {hasil.nama}</h1>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Kode">
            <Select value={kode} onChange={(e) => setKode(e.target.value)}>
              {coa.map((c) => (
                <option key={c.kode} value={c.kode}>{c.kode} — {c.nama}</option>
              ))}
            </Select>
          </Field>
          <Field label="Mulai">
            <TextInput type="date" value={mulai} onChange={(e) => setMulai(e.target.value)} />
          </Field>
          <Field label="Sampai">
            <TextInput type="date" value={sampai} onChange={(e) => setSampai(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button disabled={memuat || sibuk || !kode} onClick={muat}>
              {memuat ? 'Memuat…' : 'Muat'}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            disabled={memuat || sibuk || !kode}
            onClick={() => void exportXlsx()}
          >
            {sibuk ? 'Memproses…' : 'Export .xlsx'}
          </Button>
          <Button
            variant="ghost"
            disabled={memuat || sibuk || !kode}
            onClick={() =>
              setPratinjau({
                judul: `Pembantu ${kode}`,
                body: pembantuToHtml(hasil),
              })
            }
          >
            Print / PDF
          </Button>
          <Button
            variant="ghost"
            disabled={memuat || sibuk || !kode}
            onClick={() => void simpanPdf()}
          >
            {sibuk ? 'Memproses…' : 'Simpan PDF'}
          </Button>
          <Badge tone={hasil.rows.length > 0 ? 'stone' : 'amber'}>{hasil.rows.length} baris</Badge>
        </div>
      </Card>

      <Card>
        {memuat && <p className="mb-2 text-sm text-stone-500">Memuat data jurnal…</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Tanggal</th>
                <th className="py-2 pr-3">Keterangan</th>
                <th className="py-2 pr-3 text-right">Masuk</th>
                <th className="py-2 pr-3 text-right">Keluar</th>
                <th className="py-2 text-right">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {barisTampil.map((t) => (
                <tr key={t.id} className="border-b last:border-0">
                  <td className="py-2 pr-3 whitespace-nowrap">{formatTanggal(t.tanggal)}</td>
                  <td className="py-2 pr-3">{t.keterangan}</td>
                  <td className="py-2 pr-3 text-right">{t.masuk ? formatRp(t.masuk) : ''}</td>
                  <td className="py-2 pr-3 text-right">{t.keluar ? formatRp(t.keluar) : ''}</td>
                  <td className="py-2 text-right">{formatRp(t.saldoJalan)}</td>
                </tr>
              ))}
              {hasil.rows.length === 0 && !memuat && (
                <tr><td colSpan={5} className="py-4 text-center text-stone-500">Tidak ada baris.</td></tr>
              )}
            </tbody>
            <tfoot>
              {hasil.saldoAwal !== undefined && (
                <tr>
                  <td colSpan={4} className="py-2 pr-3 text-right">SALDO AWAL:</td>
                  <td className="py-2 text-right">{formatRp(hasil.saldoAwal)}</td>
                </tr>
              )}
              <tr className="font-bold">
                <td colSpan={2} className="py-2 pr-3 text-right">TOTAL:</td>
                <td className="py-2 pr-3 text-right">{formatRp(hasil.totalMasuk)}</td>
                <td className="py-2 text-right">{formatRp(hasil.totalKeluar)}</td>
                <td className="py-2 text-right" />
              </tr>
              <tr className="font-bold">
                <td colSpan={4} className="py-2 pr-3 text-right">SALDO AKHIR:</td>
                <td className="py-2 text-right">{formatRp(hasil.saldo)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {pratinjau && (
        <PratinjauHtmlModal
          judul={pratinjau.judul}
          body={pratinjau.body}
          onClose={() => setPratinjau(null)}
        />
      )}
    </div>
  );
}
