import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import {
  labaRugiToWorkbook,
  periodeFile,
} from '../../features/export/workbooks.js';
import { labaRugiPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, type LabaRugiHasil } from '../lib/api.js';
import { badgeLabaRugi } from '../lib/tampilanLaporan.js';
import { Badge, Button, Card, ErrorBox, Field, TextInput } from './ui.js';
import { ExportActions } from './ExportActions.js';
import { JurnalAkunModal } from './JurnalAkunModal.js';

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type AkunDipilih = { kode: string; nama: string };

/**
 * Layar Laba Rugi (P1-9). Seluruh angka berasal dari `laporan:laba-rugi`
 * (core/reports.ts); tab ini tidak menghitung ulang laba dan tidak menyimpan
 * angka turunan. Klik baris akun untuk menelusuri jurnal asalnya.
 */
export function LabaRugiTab() {
  const [mulai, setMulai] = useState('');
  const [sampai, setSampai] = useState('');
  const [data, setData] = useState<LabaRugiHasil | null>(null);
  const [coa, setCoa] = useState<Coa[]>([]);
  const [akunDipilih, setAkunDipilih] = useState<AkunDipilih | null>(null);
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
      .laporanLabaRugi({
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

  const pendapatan = data?.pendapatan.filter((b) => b.nominal !== 0) ?? [];
  const beban = data?.beban.filter((b) => b.nominal !== 0) ?? [];
  const badge = data ? badgeLabaRugi(data.defisit) : null;
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
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              Laba Rugi {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Laba Rugi membandingkan pendapatan dan beban pada satu periode.
              Angka dihitung ulang dari jurnal setiap kali layar dibuka — tidak ada
              angka laba yang disimpan.
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
          Kosongkan tanggal untuk melihat seluruh riwayat. Klik baris akun untuk
          melihat daftar jurnal pada periode ini, lalu klik jurnal untuk detail
          debit/kredit.
        </p>

        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`laba-rugi-${periodeFile(data.mulai, data.sampai)}`}
              judul="Laba Rugi"
              disabled={memuat}
              buatWorkbook={() => labaRugiToWorkbook(data)}
              buatDokumen={() => labaRugiPrintDoc(data)}
            />
          </div>
        )}

        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Laba Rugi…</p>}
      </Card>

      {data && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Periode {periode}</h3>
            <span className="text-sm text-stone-600">
              {pendapatan.length + beban.length} akun bernominal
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead>
                <tr className="border-b text-stone-500">
                  <th className="py-2 pr-3">Kode</th>
                  <th className="py-2 pr-3">Uraian</th>
                  <th className="py-2 pr-3 text-right">Nominal</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th colSpan={4} className="pt-3 pb-1 text-left text-stone-700">
                    PENDAPATAN
                  </th>
                </tr>
                {pendapatan.map((b) => (
                  <tr
                    key={b.kode}
                    className="cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50"
                    tabIndex={0}
                    title={`Lihat jurnal akun ${b.kode} — ${b.nama}`}
                    onClick={() => setAkunDipilih({ kode: b.kode, nama: b.nama })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAkunDipilih({ kode: b.kode, nama: b.nama });
                      }
                    }}
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-semibold">{b.kode}</td>
                    <td className="py-2 pr-3">{b.nama}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(b.nominal)}
                    </td>
                    <td className="py-2 text-right text-stone-400">
                      <ChevronRight size={16} className="ml-auto" />
                    </td>
                  </tr>
                ))}
                {pendapatan.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-stone-500">
                      Tidak ada pendapatan pada periode ini.
                    </td>
                  </tr>
                )}
                <tr className="font-bold">
                  <td colSpan={2} className="py-2 pr-3 text-right">
                    Total Pendapatan
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {formatRp(data.totalPendapatan)}
                  </td>
                  <td />
                </tr>

                <tr>
                  <th colSpan={4} className="pt-3 pb-1 text-left text-stone-700">
                    BEBAN
                  </th>
                </tr>
                {beban.map((b) => (
                  <tr
                    key={b.kode}
                    className="cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50"
                    tabIndex={0}
                    title={`Lihat jurnal akun ${b.kode} — ${b.nama}`}
                    onClick={() => setAkunDipilih({ kode: b.kode, nama: b.nama })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAkunDipilih({ kode: b.kode, nama: b.nama });
                      }
                    }}
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-semibold">{b.kode}</td>
                    <td className="py-2 pr-3">{b.nama}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(b.nominal)}
                    </td>
                    <td className="py-2 text-right text-stone-400">
                      <ChevronRight size={16} className="ml-auto" />
                    </td>
                  </tr>
                ))}
                {beban.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-stone-500">
                      Tidak ada beban pada periode ini.
                    </td>
                  </tr>
                )}
                <tr className="font-bold">
                  <td colSpan={2} className="py-2 pr-3 text-right">
                    Total Beban
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {formatRp(data.totalBeban)}
                  </td>
                  <td />
                </tr>
                <tr className="border-t-2 font-bold">
                  <td colSpan={2} className="py-3 pr-3 text-right">
                    LABA / (DEFISIT)
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3 text-right text-base">
                    {formatRp(data.laba)}
                  </td>
                  <td className="py-3">
                    {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-stone-600">
            Defisit ditampilkan dalam kurung, mis. {formatRp(-10_000_000)}. Laba bersih
            juga dapat diperiksa lewat jurnal setiap akun di atas.
          </p>
        </Card>
      )}

      {akunDipilih && (
        <JurnalAkunModal
          akunKode={akunDipilih.kode}
          akunNama={akunDipilih.nama}
          mulai={mulai || undefined}
          sampai={sampai || undefined}
          coa={coa}
          onClose={() => setAkunDipilih(null)}
        />
      )}
    </div>
  );
}
