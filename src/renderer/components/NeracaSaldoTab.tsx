import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type {
  ModeNeracaSaldo,
  NeracaSaldoModeHasil,
} from '../../core/reports.js';
import {
  neracaSaldoToWorkbook,
  periodeFile,
} from '../../features/export/workbooks.js';
import { neracaSaldoPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api } from '../lib/api.js';
import { LABEL_TIPE_AKUN } from '../lib/tampilanLaporan.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';
import { ExportActions } from './ExportActions.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';

const LABEL_MODE: Record<ModeNeracaSaldo, string> = {
  tahun: 'Tahun berjalan',
  kumulatif: 'Kumulatif sejak awal',
};

function barisSintetis(
  r: NeracaSaldoModeHasil['rows'][number],
): boolean {
  return 'sintetis' in r && r.sintetis;
}

export function NeracaSaldoTab({
  onBukaBukuBesar,
}: {
  onBukaBukuBesar: (akunKode: string) => void;
}) {
  const [cutoff, setCutoff] = useState(tanggalLokal());
  const [mode, setMode] = useState<ModeNeracaSaldo>('tahun');
  const [data, setData] = useState<NeracaSaldoModeHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

  useEffect(() => {
    if (!cutoff) {
      setData(null);
      return;
    }
    let aktif = true;
    setMemuat(true);
    setErr(null);
    api
      .laporanNeracaSaldo({ cutoff, mode })
      .then((hasil) => {
        if (aktif) setData(hasil);
      })
      .catch((e) => {
        if (aktif) {
          setData(null);
          setErr(pesanError(e, PESAN_MUAT_GAGAL));
        }
      })
      .finally(() => {
        if (aktif) setMemuat(false);
      });
    return () => {
      aktif = false;
    };
  }, [cutoff, mode]);

  const belumAdaMutasi = Boolean(data && data.rows.every((r) => !r.adaMutasi));
  const adaLabaDitahan = Boolean(data?.rows.some(barisSintetis));

  const judulPeriode = data
    ? data.mode === 'tahun'
      ? `Tahun buku ${data.sampai.slice(0, 4)} · ${formatTanggal(data.mulai)} s/d ${formatTanggal(data.sampai)}`
      : `Saldo per ${formatTanggal(data.cutoff ?? cutoff)}`
    : '';

  const namaDasar = data
    ? data.mode === 'tahun'
      ? `neraca-saldo-tahun-${periodeFile(data.mulai, data.sampai)}`
      : `neraca-saldo-${data.cutoff ?? cutoff}`
    : `neraca-saldo-${cutoff}`;

  const judulExport = data
    ? data.mode === 'tahun'
      ? `Neraca Saldo Tahun Buku ${data.sampai.slice(0, 4)}`
      : 'Neraca Saldo Kumulatif'
    : 'Neraca Saldo';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Neraca Saldo</h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Neraca Saldo adalah daftar saldo semua akun pada satu tanggal. Total debit
              harus sama dengan total kredit. Kalau berbeda, berarti ada jurnal yang tidak
              seimbang dan perlu diperiksa di Jurnal Umum.
            </p>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Pilih <b>Tahun berjalan</b> untuk trial balance tahun buku saja, atau{' '}
              <b>Kumulatif sejak awal</b> untuk seluruh riwayat.
            </p>
          </div>
          {data && (
            <Badge tone={data.seimbang ? 'green' : 'red'}>
              {data.seimbang
                ? 'Seimbang'
                : `Selisih ${formatRp(data.selisih)}`}
            </Badge>
          )}
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Cut-off (sampai tanggal)">
            <TextInput
              type="date"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button variant="ghost" onClick={() => setCutoff(tanggalLokal())}>
              Hari ini
            </Button>
          </div>
          <div className="flex items-end">
            {data && (
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="stone">Debit {formatRp(data.totalDebit)}</Badge>
                <Badge tone="stone">Kredit {formatRp(data.totalKredit)}</Badge>
              </div>
            )}
          </div>
        </div>
        <div
          className="mt-3 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Mode Neraca Saldo"
        >
          <span className="text-sm font-medium text-stone-600">Mode:</span>
          {(Object.keys(LABEL_MODE) as ModeNeracaSaldo[]).map((m) => (
            <Button
              key={m}
              variant={mode === m ? 'primary' : 'ghost'}
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
            >
              {LABEL_MODE[m]}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          {mode === 'tahun'
            ? 'Pendapatan dan beban hanya dihitung dari 1 Januari tahun cut-off. Laba tahun sebelumnya diringkas pada baris “Laba ditahan sebelum periode”.'
            : 'Semua saldo sejak awal dihitung kumulatif; laba tahun lalu tetap tampil sebagai pendapatan/beban pada trial balance ini.'}
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Klik baris akun untuk membuka Buku Besar akun tersebut dan menelusuri jurnal asalnya.
        </p>
        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={namaDasar}
              judul={judulExport}
              disabled={memuat || data.rows.length === 0}
              buatWorkbook={(kop) => neracaSaldoToWorkbook(data, kop)}
              buatDokumen={(kop) => neracaSaldoPrintDoc(data, { kop })}
            />
          </div>
        )}
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {!cutoff && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            Isi tanggal cut-off terlebih dahulu.
          </p>
        )}
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Neraca Saldo…</p>}
      </Card>

      {data && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">{judulPeriode}</h3>
              <p className="text-sm text-stone-600">
                Mode: {LABEL_MODE[data.mode ?? 'kumulatif']} · {data.rows.length} baris
              </p>
            </div>
            <Badge tone={data.mode === 'tahun' ? 'amber' : 'stone'}>
              {data.mode === 'tahun' ? 'Tahun buku' : 'Kumulatif'}
            </Badge>
          </div>
          {belumAdaMutasi && (
            <p className="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Belum ada mutasi jurnal sampai tanggal ini. Semua saldo masih nol.
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead>
                <tr className="border-b text-stone-500">
                  <th className="py-2 pr-3">Kode</th>
                  <th className="py-2 pr-3">Nama Akun</th>
                  <th className="py-2 pr-3">Tipe</th>
                  <th className="py-2 pr-3 text-right">Debit</th>
                  <th className="py-2 pr-3 text-right">Kredit</th>
                  <th className="py-2 pr-3 text-right">Saldo</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const sintetis = barisSintetis(r);
                  return (
                    <tr
                      key={sintetis ? 'laba-ditahan-sebelum-periode' : r.kode}
                      className={
                        sintetis
                          ? 'border-b bg-amber-50/60 align-top italic last:border-0'
                          : 'cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50'
                      }
                      tabIndex={sintetis ? undefined : 0}
                      title={
                        sintetis
                          ? 'Laba bersih sebelum periode; bukan akun COA'
                          : `Buka Buku Besar ${r.kode} — ${r.nama}`
                      }
                      onClick={sintetis ? undefined : () => onBukaBukuBesar(r.kode)}
                      onKeyDown={
                        sintetis
                          ? undefined
                          : (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onBukaBukuBesar(r.kode);
                              }
                            }
                      }
                    >
                      <td className="whitespace-nowrap py-2 pr-3 font-semibold">
                        {r.kode || '—'}
                      </td>
                      <td className="py-2 pr-3">
                        {r.nama}
                        {sintetis && (
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold not-italic text-amber-900">
                            sintetis
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {LABEL_TIPE_AKUN[r.tipe]}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.debit ? formatRp(r.debit) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.kredit ? formatRp(r.kredit) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold">
                        {formatRp(r.saldo)}
                      </td>
                      <td className="py-2 text-right text-stone-400">
                        {!sintetis && <ChevronRight size={16} className="ml-auto" />}
                      </td>
                    </tr>
                  );
                })}
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-4 text-center text-stone-500">
                      Belum ada akun pada daftar akun (COA).
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={3} className="py-2 pr-3 text-right">
                    Total:
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {formatRp(data.totalDebit)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {formatRp(data.totalKredit)}
                  </td>
                  <td colSpan={2} className="py-2 pr-3">
                    {data.seimbang ? (
                      <Badge tone="green">Seimbang</Badge>
                    ) : (
                      <Badge tone="red">Selisih {formatRp(data.selisih)}</Badge>
                    )}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          {adaLabaDitahan && data.mode === 'tahun' && (
            <p className="mt-2 text-xs text-stone-500">
              “Laba ditahan sebelum periode” adalah laba bersih sebelum{' '}
              {formatTanggal(data.mulai)}. Baris ini sintetis (bukan akun COA) dan
              hanya muncul pada mode tahun berjalan.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
