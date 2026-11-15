import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { neracaHasilToWorkbook } from '../../features/export/workbooks.js';
import { neracaPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api, type NeracaHasil, type NeracaSaldoModeHasil } from '../lib/api.js';
import { badgeNeracaSaldo } from '../lib/tampilanLaporan.js';
import type { PeriodeBukuBesar } from './BukuBesarTab.js';
import { Badge, Card, ErrorBox, TombolBaris } from './ui.js';
import { KontrolPeriode } from './KontrolPeriode.js';
import { ExportActions } from './ExportActions.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';

/**
 * Layar Neraca (P1-9). Aset, kewajiban, dan ekuitas berasal langsung dari
 * `laporan:neraca` (core/reports.ts), termasuk laba ditahan dan laba berjalan
 * yang dihitung ulang dari jurnal. Badge status memakai `laporan:neraca-saldo`.
 */
export function NeracaTab({
  onBukaBukuBesar,
  sekarang,
}: {
  // UI-A03: callback juga membawa periode sumber (cut-off Neraca) agar Buku
  // Besar menghitung saldo dengan cut-off yang sama dengan angka yang diklik.
  onBukaBukuBesar?: (akunKode: string, periode: PeriodeBukuBesar) => void;
  /** UI-A10: tanggal acuan preset "Hari ini"; hanya untuk test. */
  sekarang?: Date | number;
}) {
  const [cutoff, setCutoff] = useState(tanggalLokal());
  const [data, setData] = useState<NeracaHasil | null>(null);
  const [neracaSaldo, setNeracaSaldo] = useState<NeracaSaldoModeHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

  useEffect(() => {
    if (!cutoff) {
      setData(null);
      setNeracaSaldo(null);
      setMemuat(false);
      setErr(null);
      return;
    }
    let aktif = true;
    setMemuat(true);
    setErr(null);
    Promise.allSettled([
      api.laporanNeraca(cutoff),
      // Badge Neraca memakai saldo kumulatif s/d cut-off, bukan P&L tahun saja.
      api.laporanNeracaSaldo({ cutoff, mode: 'kumulatif' }),
    ])
      .then(([utama, badge]) => {
        if (!aktif) return;
        if (utama.status === 'fulfilled') {
          setData(utama.value);
        } else {
          setData(null);
          setErr(pesanError(utama.reason, PESAN_MUAT_GAGAL));
        }
        // Badge hanya pelengkap; kegagalannya tidak boleh mengosongkan Neraca.
        setNeracaSaldo(badge.status === 'fulfilled' ? badge.value : null);
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

  // UI-A03: saldo Neraca kumulatif s/d cut-off, jadi Buku Besar dipotong di
  // cut-off tanpa batas awal agar saldo akhirnya sama dengan angka di sini.
  // UI-A10: cut-off dipakai dari DATA HASIL agar drill-down membawa cut-off
  // yang sama dengan angka yang sedang tampil, bukan nilai input terbaru.
  function periodeSumber(): PeriodeBukuBesar {
    return { mulai: '', sampai: data?.cutoff ?? cutoff };
  }

  function barisAkun(a: { kode: string; nama: string; saldo: number }) {
    return (
      <tr
        key={a.kode}
        className={
          onBukaBukuBesar
            ? 'cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50'
            : 'border-b align-top last:border-0'
        }
        title={onBukaBukuBesar ? `Buka Buku Besar ${a.kode} — ${a.nama}` : undefined}
        // UI-A28: klik baris hanya pintasan mouse; target Tab/pembaca layar
        // adalah tombol di kolom terakhir (bila drill-down tersedia).
        onClick={() => onBukaBukuBesar?.(a.kode, periodeSumber())}
      >
        <td className="whitespace-nowrap py-2 pr-3 font-semibold">{a.kode}</td>
        <td className="py-2 pr-3">{a.nama}</td>
        <td className="whitespace-nowrap py-2 pr-3 text-right">{formatRp(a.saldo)}</td>
        <td className="py-2 text-right">
          {onBukaBukuBesar && (
            <TombolBaris
              label={`Buka Buku Besar akun ${a.kode} — ${a.nama}`}
              onClick={() => onBukaBukuBesar(a.kode, periodeSumber())}
            >
              <ChevronRight size={16} aria-hidden="true" />
            </TombolBaris>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold">
            {/* UI-A10: cut-off header dari data hasil, bukan input. */}
            Neraca per {data ? formatTanggal(data.cutoff) : '—'}{' '}
            {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Aset, kewajiban, dan ekuitas pada satu tanggal. Klik akun untuk membuka
            Buku Besar.
          </p>
        </div>

        {data?.catatanTahunPertama && (
          <p
            className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
            data-testid="catatan-tahun-pertama"
          >
            {data.catatanTahunPertama}
          </p>
        )}

        {/* UI-A10: kontrol periode bersama mode cutoff (preset "Hari ini"). */}
        <div className="mt-3">
          <KontrolPeriode
            mode="cutoff"
            cutoff={cutoff}
            onCutoff={setCutoff}
            sekarang={sekarang}
          />
        </div>
        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`neraca-${data.cutoff}`}
              judul={`Neraca per ${formatTanggal(data.cutoff)}`}
              disabled={memuat}
              buatWorkbook={(kop) => neracaHasilToWorkbook(data, kop)}
              buatDokumen={(kop) => neracaPrintDoc(data, { kop })}
            />
          </div>
        )}
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Neraca…</p>}
      </Card>

      {data && (
        <>
          <Card>
            <h3 className="mb-2 font-bold">ASET — {formatRp(data.totalAset)}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
                <caption className="sr-only">
                  Neraca — Aset per {formatTanggal(data.cutoff)}
                </caption>
                <thead>
                  <tr className="border-b text-stone-500">
                    <th scope="col" className="py-2 pr-3">Kode</th>
                    <th scope="col" className="py-2 pr-3">Akun</th>
                    <th scope="col" className="py-2 pr-3 text-right">Saldo</th>
                    <th scope="col" className="py-2" />
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
                    {/* UI-A26: angka utama laporan satu skala text-2xl. */}
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-2xl">
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
                {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
                <caption className="sr-only">
                  Neraca — Kewajiban per {formatTanggal(data.cutoff)}
                </caption>
                <thead>
                  <tr className="border-b text-stone-500">
                    <th scope="col" className="py-2 pr-3">Kode</th>
                    <th scope="col" className="py-2 pr-3">Akun</th>
                    <th scope="col" className="py-2 pr-3 text-right">Saldo</th>
                    <th scope="col" className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {kewajiban.map(barisAkun)}
                  {kewajiban.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-stone-500">
                        {/* UI-A26: teks kosong diseragamkan dengan bagian Aset. */}
                        Belum ada kewajiban bersaldo sampai tanggal ini.
                      </td>
                    </tr>
                  )}
                  <tr className="font-bold">
                    <td colSpan={2} className="py-2 pr-3 text-right">
                      Total Kewajiban
                    </td>
                    {/* UI-A26: angka utama laporan satu skala text-2xl. */}
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-2xl">
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
                {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
                <caption className="sr-only">
                  Neraca — Ekuitas per {formatTanggal(data.cutoff)}
                </caption>
                <thead>
                  <tr className="border-b text-stone-500">
                    <th scope="col" className="py-2 pr-3">Kode</th>
                    <th scope="col" className="py-2 pr-3">Akun</th>
                    <th scope="col" className="py-2 pr-3 text-right">Saldo</th>
                    <th scope="col" className="py-2" />
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
                      Laba berjalan (1 Januari s/d tanggal laporan)
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
                    {/* UI-A26: angka utama laporan satu skala text-2xl. */}
                    <td className="whitespace-nowrap py-2 pr-3 text-right text-2xl">
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
                <h3 className="font-bold">Total Kewajiban + Ekuitas</h3>
                <p className="text-sm text-stone-600">
                  Jumlah kewajiban dan ekuitas, termasuk laba berjalan.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone="stone">Aset {formatRp(data.totalAset)}</Badge>
                <Badge tone="stone">
                  Kewajiban + Ekuitas {formatRp(data.totalPasiva)}
                </Badge>
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
