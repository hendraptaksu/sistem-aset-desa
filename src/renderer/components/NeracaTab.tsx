import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { neracaHasilToWorkbook } from '../../features/export/workbooks.js';
import { neracaPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, type NeracaHasil, type NeracaSaldoHasil } from '../lib/api.js';
import { badgeNeracaSaldo } from '../lib/tampilanLaporan.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';
import { ExportActions } from './ExportActions.js';

const today = (): string => new Date().toISOString().slice(0, 10);

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Layar Neraca (P1-9). Aset, kewajiban, dan ekuitas berasal langsung dari
 * `laporan:neraca` (core/reports.ts), termasuk laba ditahan dan laba berjalan
 * yang dihitung ulang dari jurnal. Badge status memakai `laporan:neraca-saldo`.
 */
export function NeracaTab({
  onBukaBukuBesar,
}: {
  onBukaBukuBesar?: (akunKode: string) => void;
}) {
  const [cutoff, setCutoff] = useState(today());
  const [data, setData] = useState<NeracaHasil | null>(null);
  const [neracaSaldo, setNeracaSaldo] = useState<NeracaSaldoHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

  useEffect(() => {
    if (!cutoff) {
      setData(null);
      setNeracaSaldo(null);
      return;
    }
    let aktif = true;
    setMemuat(true);
    setErr(null);
    Promise.all([api.laporanNeraca(cutoff), api.laporanNeracaSaldo(cutoff)])
      .then(([n, ns]) => {
        if (!aktif) return;
        setData(n);
        setNeracaSaldo(ns);
      })
      .catch((e) => {
        if (!aktif) return;
        setData(null);
        setNeracaSaldo(null);
        setErr(pesanError(e));
      })
      .finally(() => {
        if (aktif) setMemuat(false);
      });
    return () => {
      aktif = false;
    };
  }, [cutoff]);

  const badge = neracaSaldo ? badgeNeracaSaldo(neracaSaldo) : null;
  const aset = data?.aset.filter((a) => a.saldo !== 0) ?? [];
  const kewajiban = data?.kewajiban.filter((a) => a.saldo !== 0) ?? [];
  const ekuitas = data?.ekuitas.filter((a) => a.saldo !== 0) ?? [];

  function barisAkun(a: { kode: string; nama: string; saldo: number }) {
    return (
      <tr
        key={a.kode}
        className={
          onBukaBukuBesar
            ? 'cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50'
            : 'border-b align-top last:border-0'
        }
        tabIndex={onBukaBukuBesar ? 0 : undefined}
        title={onBukaBukuBesar ? `Buka Buku Besar ${a.kode} — ${a.nama}` : undefined}
        onClick={() => onBukaBukuBesar?.(a.kode)}
        onKeyDown={(e) => {
          if (!onBukaBukuBesar) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onBukaBukuBesar(a.kode);
          }
        }}
      >
        <td className="whitespace-nowrap py-2 pr-3 font-semibold">{a.kode}</td>
        <td className="py-2 pr-3">{a.nama}</td>
        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatRp(a.saldo)}</td>
        <td className="py-2 text-right text-stone-400">
          {onBukaBukuBesar && <ChevronRight size={16} className="ml-auto" />}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              Neraca per {cutoff ? formatTanggal(cutoff) : '—'}{' '}
              {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Neraca menunjukkan aset, kewajiban, dan ekuitas pada satu tanggal.
              Laba ditahan dan laba berjalan dihitung ulang dari jurnal — tidak ada
              angka laba yang disimpan. Klik akun untuk membuka Buku Besar.
            </p>
          </div>
          <Badge tone="green">Dihitung dari jurnal</Badge>
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Cut-off (sampai tanggal)">
            <TextInput
              type="date"
              value={cutoff}
              onChange={(e) => setCutoff(e.target.value)}
            />
          </Field>
          <div className="flex items-end">
            <Button variant="ghost" onClick={() => setCutoff(today())}>
              Hari ini
            </Button>
          </div>
          <div className="flex items-end">
            {neracaSaldo && (
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="stone">Debit {formatRp(neracaSaldo.totalDebit)}</Badge>
                <Badge tone="stone">Kredit {formatRp(neracaSaldo.totalKredit)}</Badge>
              </div>
            )}
          </div>
        </div>
        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`neraca-${data.cutoff}`}
              judul={`Neraca per ${formatTanggal(data.cutoff)}`}
              disabled={memuat}
              buatWorkbook={() => neracaHasilToWorkbook(data)}
              buatDokumen={() => neracaPrintDoc(data)}
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
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Neraca…</p>}
      </Card>

      {data && (
        <>
          <Card>
            <h3 className="mb-2 font-bold">ASET — {formatRp(data.totalAset)}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Kode</th>
                    <th className="py-2 pr-3">Akun</th>
                    <th className="py-2 pr-3 text-right">Saldo</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {aset.map(barisAkun)}
                  {aset.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-stone-500">
                        Belum ada aset bersaldo sampai tanggal ini.
                      </td>
                    </tr>
                  )}
                  <tr className="font-bold">
                    <td colSpan={2} className="py-2 pr-3 text-right">
                      Total Aset
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalAset)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">
              KEWAJIBAN — {formatRp(data.totalKewajiban)}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Kode</th>
                    <th className="py-2 pr-3">Akun</th>
                    <th className="py-2 pr-3 text-right">Saldo</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {kewajiban.map(barisAkun)}
                  {kewajiban.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-stone-500">
                        Tidak ada kewajiban sampai tanggal ini.
                      </td>
                    </tr>
                  )}
                  <tr className="font-bold">
                    <td colSpan={2} className="py-2 pr-3 text-right">
                      Total Kewajiban
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalKewajiban)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">EKUITAS — {formatRp(data.totalEkuitas)}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Kode</th>
                    <th className="py-2 pr-3">Akun</th>
                    <th className="py-2 pr-3 text-right">Saldo</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {ekuitas.map(barisAkun)}
                  <tr className="border-b">
                    <td className="py-2 pr-3 font-semibold">—</td>
                    <td className="py-2 pr-3">Laba ditahan (tahun sudah tutup)</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.labaDitahan)}
                    </td>
                    <td />
                  </tr>
                  {data.labaBelumDitutup !== 0 && (
                    <tr className="border-b">
                      <td className="py-2 pr-3 font-semibold">—</td>
                      <td className="py-2 pr-3">Laba tahun lampau belum ditutup</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {formatRp(data.labaBelumDitutup)}
                      </td>
                      <td />
                    </tr>
                  )}
                  <tr className="border-b">
                    <td className="py-2 pr-3 font-semibold">—</td>
                    <td className="py-2 pr-3">
                      Laba berjalan (1 Januari s/d cut-off)
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.labaBerjalan)}
                    </td>
                    <td />
                  </tr>
                  <tr className="font-bold">
                    <td colSpan={2} className="py-2 pr-3 text-right">
                      Total Ekuitas
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalEkuitas)}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-bold">Total Pasiva</h3>
                <p className="text-sm text-stone-600">
                  Kewajiban + ekuitas, termasuk laba yang dihitung dari jurnal.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="stone">Aset {formatRp(data.totalAset)}</Badge>
                <Badge tone="stone">Pasiva {formatRp(data.totalPasiva)}</Badge>
                {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
              </div>
            </div>
            {!data.balance && (
              <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
                Selisih Neraca: {formatRp(data.selisih)}. Periksa jurnal yang tidak
                seimbang di Jurnal Umum.
              </p>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
