import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, type NeracaSaldoHasil } from '../lib/api.js';
import { LABEL_TIPE_AKUN } from '../lib/tampilanLaporan.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';

const today = (): string => new Date().toISOString().slice(0, 10);

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function NeracaSaldoTab({
  onBukaBukuBesar,
}: {
  onBukaBukuBesar: (akunKode: string) => void;
}) {
  const [cutoff, setCutoff] = useState(today());
  const [data, setData] = useState<NeracaSaldoHasil | null>(null);
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
      .laporanNeracaSaldo(cutoff)
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
  }, [cutoff]);

  const belumAdaMutasi = Boolean(data && data.rows.every((r) => !r.adaMutasi));

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
            <Button variant="ghost" onClick={() => setCutoff(today())}>
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
        <p className="mt-2 text-xs text-stone-500">
          Klik baris akun untuk membuka Buku Besar akun tersebut dan menelusuri jurnal asalnya.
        </p>
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
            <h3 className="font-bold">
              Saldo per {formatTanggal(data.cutoff ?? cutoff)}
            </h3>
            <span className="text-sm text-stone-600">{data.rows.length} akun</span>
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
                {data.rows.map((r) => (
                  <tr
                    key={r.kode}
                    className="cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50"
                    tabIndex={0}
                    title={`Buka Buku Besar ${r.kode} — ${r.nama}`}
                    onClick={() => onBukaBukuBesar(r.kode)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onBukaBukuBesar(r.kode);
                      }
                    }}
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-semibold">{r.kode}</td>
                    <td className="py-2 pr-3">{r.nama}</td>
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
                      <ChevronRight size={16} className="ml-auto" />
                    </td>
                  </tr>
                ))}
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
        </Card>
      )}
    </div>
  );
}
