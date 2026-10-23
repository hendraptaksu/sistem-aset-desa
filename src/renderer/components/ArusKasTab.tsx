import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import type { ArusKasHasil } from '../../core/reports.js';
import {
  arusKasToHtml,
  arusKasToWorkbook,
  periodeFile,
} from '../../features/export/workbooks.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, type JurnalLengkap } from '../lib/api.js';
import { labelKelompokArusKas } from '../lib/tampilanLaporan.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';
import { DetailJurnalModal } from './DetailJurnalModal.js';
import { ExportActions } from './ExportActions.js';

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const KELOMPOK: {
  kunci: 'operasi' | 'investasi' | 'pendanaan' | 'transfer';
  label: string;
  keterangan: string;
}[] = [
  { kunci: 'operasi', label: 'Operasi', keterangan: 'Pendapatan, beban, piutang, panjar' },
  { kunci: 'investasi', label: 'Investasi', keterangan: 'Perpindahan aset non-kas' },
  { kunci: 'pendanaan', label: 'Pendanaan', keterangan: 'Hutang dan modal' },
  { kunci: 'transfer', label: 'Transfer', keterangan: 'Pindah dana antar dompet (neto 0)' },
];

/**
 * Layar Arus Kas (P1-9). Semua angka berasal dari `laporan:arus-kas`
 * (core/reports.ts); transfer antar dompet tidak dihitung sebagai arus masuk
 * atau keluar. Klik baris mutasi untuk membuka detail jurnal asalnya.
 */
export function ArusKasTab() {
  const [mulai, setMulai] = useState('');
  const [sampai, setSampai] = useState('');
  const [data, setData] = useState<ArusKasHasil | null>(null);
  const [coa, setCoa] = useState<Coa[]>([]);
  const [detail, setDetail] = useState<JurnalLengkap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

  useEffect(() => {
    let aktif = true;
    api
      .coa()
      .then((daftar) => {
        if (aktif) setCoa(daftar);
      })
      .catch(() => {
        if (aktif) setCoa([]);
      });
    return () => {
      aktif = false;
    };
  }, []);

  useEffect(() => {
    let aktif = true;
    setMemuat(true);
    setErr(null);
    api
      .laporanArusKas({
        ...(mulai ? { mulai } : {}),
        ...(sampai ? { sampai } : {}),
      })
      .then((hasil) => {
        if (aktif) setData(hasil);
      })
      .catch((e) => {
        if (aktif) {
          setData(null);
          setErr(pesanError(e));
        }
      })
      .finally(() => {
        if (aktif) setMemuat(false);
      });
    return () => {
      aktif = false;
    };
  }, [mulai, sampai]);

  async function bukaDetail(jurnalId: string): Promise<void> {
    if (!jurnalId) return;
    setErr(null);
    try {
      setDetail(await api.laporanJurnalDetail(jurnalId));
    } catch (e) {
      setErr(pesanError(e));
    }
  }

  function namaLawan(lawan: string[]): string {
    if (lawan.length === 0) return '—';
    return lawan
      .map((kode) => coa.find((a) => a.kode === kode)?.nama ?? kode)
      .join(', ');
  }

  const periode =
    !mulai && !sampai
      ? 'seluruh riwayat'
      : `${mulai ? formatTanggal(mulai) : 'awal'} s/d ${
          sampai ? formatTanggal(sampai) : 'akhir'
        }`;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Arus Kas</h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Arus Kas menampilkan uang yang masuk dan keluar dari semua dompet
              kas/bank pada satu periode. Pindah dana antar dompet tidak dihitung
              sebagai uang masuk atau keluar. Semua angka dihitung ulang dari jurnal.
            </p>
          </div>
          <Badge tone="green">Dihitung dari jurnal</Badge>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Dari tanggal (opsional)">
            <TextInput
              type="date"
              value={mulai}
              onChange={(e) => setMulai(e.target.value)}
            />
          </Field>
          <Field label="Sampai tanggal (opsional)">
            <TextInput
              type="date"
              value={sampai}
              onChange={(e) => setSampai(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() => {
                setMulai('');
                setSampai('');
              }}
            >
              Semua tanggal
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Saldo awal dihitung dari jurnal sebelum tanggal “Dari”. Klik baris mutasi
          untuk melihat jurnal asal dan nomor buktinya.
        </p>
        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`arus-kas-${periodeFile(data.mulai, data.sampai)}`}
              judul="Arus Kas"
              disabled={memuat}
              buatWorkbook={() => arusKasToWorkbook(data)}
              buatHtml={() => arusKasToHtml(data)}
            />
          </div>
        )}
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Arus Kas…</p>}
      </Card>

      {data && (
        <>
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">Ringkasan periode {periode}</h3>
              <span className="text-sm text-stone-600">
                {data.rows.length} baris mutasi kas
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Saldo awal</div>
                <div className="text-lg font-bold">{formatRp(data.saldoAwal)}</div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Total masuk</div>
                <div className="text-lg font-bold text-emerald-700">
                  {formatRp(data.totalMasuk)}
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Total keluar</div>
                <div className="text-lg font-bold text-red-700">
                  {formatRp(data.totalKeluar)}
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Kenaikan / (penurunan)</div>
                <div className="text-lg font-bold">{formatRp(data.kenaikan)}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-sm text-emerald-800">Saldo akhir</div>
                <div className="text-lg font-bold text-emerald-900">
                  {formatRp(data.saldoAkhir)}
                </div>
                <div className="mt-1 text-xs text-emerald-800">
                  saldo awal + kenaikan
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">Kelompok Arus Kas</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              {KELOMPOK.map(({ kunci, label, keterangan }) => {
                const k = data[kunci];
                return (
                  <div
                    key={kunci}
                    className="rounded-lg border border-stone-200 bg-stone-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{label}</span>
                      <Badge tone={kunci === 'transfer' ? 'amber' : 'stone'}>
                        {formatRp(k.neto)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-stone-500">{keterangan}</div>
                    <div className="mt-2 text-sm text-stone-600">
                      Masuk {formatRp(k.masuk)} · Keluar {formatRp(k.keluar)}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Transfer antar dompet ditampilkan terpisah dan tidak menambah total
              masuk/keluar, supaya uang yang sama tidak dihitung dua kali.
            </p>
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">Mutasi kas per dompet</h3>
              <span className="text-sm text-stone-600">
                klik baris untuk melihat jurnal asal
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">No. Bukti</th>
                    <th className="py-2 pr-3">Keterangan</th>
                    <th className="py-2 pr-3">Dompet</th>
                    <th className="py-2 pr-3">Lawan akun</th>
                    <th className="py-2 pr-3">Kelompok</th>
                    <th className="py-2 pr-3 text-right">Masuk</th>
                    <th className="py-2 pr-3 text-right">Keluar</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr
                      key={`${r.jurnal_id}-${r.akun_kode}-${i}`}
                      className={
                        r.jurnal_id
                          ? 'cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50'
                          : 'border-b align-top last:border-0'
                      }
                      tabIndex={r.jurnal_id ? 0 : undefined}
                      title={r.jurnal_id ? 'Klik untuk melihat jurnal asal' : undefined}
                      onClick={() => void bukaDetail(r.jurnal_id)}
                      onKeyDown={(e) => {
                        if (!r.jurnal_id) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void bukaDetail(r.jurnal_id);
                        }
                      }}
                    >
                      <td className="whitespace-nowrap py-2 pr-3">
                        {formatTanggal(r.tanggal)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {r.no_bukti || '—'}
                      </td>
                      <td className="py-2 pr-3">{r.keterangan || '—'}</td>
                      <td className="py-2 pr-3">
                        {r.akun_kode} — {r.akun_nama}
                      </td>
                      <td className="py-2 pr-3">{namaLawan(r.lawan)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        <Badge tone={r.kelompok === 'TRANSFER' ? 'amber' : 'stone'}>
                          {labelKelompokArusKas(r.kelompok)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.masuk ? formatRp(r.masuk) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.keluar ? formatRp(r.keluar) : ''}
                      </td>
                      <td className="py-2 text-right text-stone-400">
                        {r.jurnal_id && <ChevronRight size={16} className="ml-auto" />}
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-4 text-center text-stone-500">
                        Tidak ada mutasi kas pada periode ini.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={6} className="py-2 pr-3 text-right">
                      Total arus (tanpa transfer):
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalMasuk)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalKeluar)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {detail && (
        <DetailJurnalModal
          jurnal={detail}
          coa={coa}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
