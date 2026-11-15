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
import { ALASAN_EKSPOR_KOSONG, LABEL_TIPE_AKUN } from '../lib/tampilanLaporan.js';
import type { PeriodeBukuBesar } from './BukuBesarTab.js';
import { Badge, Button, Card, ErrorBox } from './ui.js';
import { KontrolPeriode } from './KontrolPeriode.js';
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
  sekarang,
}: {
  // UI-A03: callback juga membawa periode sumber agar Buku Besar menghitung
  // saldo dengan cut-off/awal tahun buku yang sama dengan angka yang diklik.
  onBukaBukuBesar: (akunKode: string, periode: PeriodeBukuBesar) => void;
  /** UI-A10: tanggal acuan preset "Hari ini"; hanya untuk test. */
  sekarang?: Date | number;
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

  // UI-A03: periode sumber diteruskan ke Buku Besar agar cut-off sama dengan
  // angka yang diklik. Mode tahun memakai awal tahun buku dari hasil laporan
  // (1 Januari tahun cut-off; laporan memakai util tahun buku di core); mode
  // kumulatif hanya dipotong di cut-off tanpa batas awal.
  const periodeSumber: PeriodeBukuBesar = !data
    ? { mulai: '', sampai: cutoff }
    : data.mode === 'tahun'
      ? { mulai: data.mulai, sampai: data.sampai }
      : { mulai: '', sampai: data.cutoff ?? cutoff };

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
            <h1 className="text-lg font-bold">Neraca Saldo</h1>
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
        {/* UI-A10: kontrol periode bersama mode cutoff (preset "Hari ini"). */}
        <KontrolPeriode
          mode="cutoff"
          cutoff={cutoff}
          onCutoff={setCutoff}
          sekarang={sekarang}
          tambahan={
            data ? (
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="stone">Debit {formatRp(data.totalDebit)}</Badge>
                <Badge tone="stone">Kredit {formatRp(data.totalKredit)}</Badge>
              </div>
            ) : undefined
          }
        />
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
        <p className="mt-2 text-helper text-stone-500">
          {mode === 'tahun'
            ? 'Pendapatan dan beban hanya dihitung dari 1 Januari pada tahun tanggal laporan. Laba tahun sebelumnya diringkas pada baris “Laba ditahan sebelum periode”.'
            : 'Semua saldo sejak awal dihitung kumulatif; laba tahun lalu tetap tampil sebagai pendapatan/beban pada trial balance ini.'}
        </p>
        <p className="mt-2 text-helper text-stone-500">
          Klik baris akun untuk membuka Buku Besar akun tersebut dan menelusuri jurnal asalnya.
        </p>
        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={namaDasar}
              judul={judulExport}
              disabled={memuat || data.rows.length === 0}
              alasanNonaktif={data.rows.length === 0 ? ALASAN_EKSPOR_KOSONG : undefined}
              buatWorkbook={(kop) => neracaSaldoToWorkbook(data, kop)}
              buatDokumen={(kop) => neracaSaldoPrintDoc(data, { kop })}
            />
          </div>
        )}
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
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
              {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
              <caption className="sr-only">
                Neraca Saldo — daftar saldo semua akun · {judulPeriode}
              </caption>
              <thead>
                <tr className="border-b text-stone-500">
                  <th scope="col" className="py-2 pr-3">Kode</th>
                  <th scope="col" className="py-2 pr-3">Nama Akun</th>
                  <th scope="col" className="py-2 pr-3">Tipe</th>
                  <th scope="col" className="py-2 pr-3 text-right">Debit</th>
                  <th scope="col" className="py-2 pr-3 text-right">Kredit</th>
                  <th scope="col" className="py-2 pr-3 text-right">Saldo</th>
                  <th scope="col" className="py-2" />
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
                      // UI-A21: baris akun diumumkan sebagai tombol dengan
                      // label yang menyebut akun tujuan; baris sintetis
                      // tidak interaktif sehingga tanpa role.
                      role={sintetis ? undefined : 'button'}
                      aria-label={
                        sintetis
                          ? undefined
                          : `Buka Buku Besar akun ${r.kode} — ${r.nama}`
                      }
                      onClick={
                        sintetis ? undefined : () => onBukaBukuBesar(r.kode, periodeSumber)
                      }
                      onKeyDown={
                        sintetis
                          ? undefined
                          : (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                onBukaBukuBesar(r.kode, periodeSumber);
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
                          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-helper font-semibold not-italic text-amber-900">
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
                        {!sintetis && (
                          // UI-A21: ikon hanya penunjuk arah; makna ada di
                          // aria-label baris.
                          <ChevronRight size={16} aria-hidden="true" className="ml-auto" />
                        )}
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
                  {/* UI-A26: angka utama laporan satu skala text-2xl. */}
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-2xl">
                    {formatRp(data.totalDebit)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right text-2xl">
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
            <p className="mt-2 text-helper text-stone-500">
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
