import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  RealisasiAnggaranBaris,
  RealisasiAnggaranHasil,
  TotalRealisasiAnggaran,
} from '../../core/anggaran.js';
import type { AnggaranAkunApi, AnggaranListData } from '../lib/api.js';
import { api } from '../lib/api.js';
import { useAksiSibuk } from '../lib/aksiSibuk.js';
import { formatPersen, formatRp, formatTanggal } from '../../utils/format.js';
import { tahunLokal } from '../../utils/tanggal.js';
import {
  PESAN_MUAT_GAGAL,
  PESAN_SIMPAN_GAGAL,
  pesanError,
} from '../../utils/pesanError.js';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  ErrorBox,
  Field,
  KonfirmasiModal,
  Select,
} from './ui.js';
import { ExportActions } from './ExportActions.js';
import { anggaranToWorkbook } from '../../features/export/workbooks.js';
import { anggaranPrintDoc } from '../../features/export/printAdapters.js';

const TAHUN_SEKARANG = tahunLokal();
const TAHUN_OPTIONS = Array.from({ length: 101 }, (_, i) => 2000 + i);

function statusAnggaran(lebih: boolean): string {
  return lebih ? 'Lebih' : 'Sesuai';
}

/** Progress bar + %; bar merah bila realisasi melebihi pagu. */
function SelPersen({ baris }: { baris: RealisasiAnggaranBaris }) {
  const lebar = Math.min(100, Math.max(0, baris.persen));
  return (
    <div className="flex min-w-[132px] items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-stone-200">
        <div
          className={`h-full ${baris.lebih ? 'bg-red-600' : 'bg-emerald-600'}`}
          style={{ width: `${lebar}%` }}
        />
      </div>
      <span className="tabular-nums">{formatPersen(baris.persen)}</span>
    </div>
  );
}

function BarisTotal({
  label,
  total,
}: {
  label: string;
  total: TotalRealisasiAnggaran;
}) {
  return (
    <tr className="border-t-2 border-stone-300 font-bold">
      <td colSpan={2} className="py-2 pr-3 text-right">
        {label}
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatRp(total.anggaran)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{formatRp(total.realisasi)}</td>
      <td
        className={`py-2 pr-3 text-right tabular-nums ${total.sisa < 0 ? 'text-red-700' : ''}`}
      >
        {formatRp(total.sisa)}
      </td>
      <td className="py-2 pr-3">
        <div className="flex min-w-[132px] items-center gap-2">
          <div className="h-2 w-16 overflow-hidden rounded-full bg-stone-200">
            <div
              className={`h-full ${total.lebih ? 'bg-red-600' : 'bg-emerald-600'}`}
              style={{ width: `${Math.min(100, Math.max(0, total.persen))}%` }}
            />
          </div>
          <span className="tabular-nums">{formatPersen(total.persen)}</span>
        </div>
      </td>
      <td className="py-2">
        <Badge tone={total.lebih ? 'red' : 'green'}>{statusAnggaran(total.lebih)}</Badge>
      </td>
    </tr>
  );
}

function TabelBagian({
  judul,
  rows,
  total,
}: {
  judul: string;
  rows: readonly RealisasiAnggaranBaris[];
  total: TotalRealisasiAnggaran;
}) {
  return (
    <div className="mt-4">
      <h3 className="mb-2 font-bold">{judul}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Kode</th>
              <th className="py-2 pr-3">Uraian</th>
              <th className="py-2 pr-3 text-right">Pagu</th>
              <th className="py-2 pr-3 text-right">Realisasi</th>
              <th className="py-2 pr-3 text-right">Sisa</th>
              <th className="py-2 pr-3">%</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.kode} className="border-b last:border-0">
                <td className="py-2 pr-3">{b.kode}</td>
                <td className="py-2 pr-3">{b.nama}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatRp(b.anggaran)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{formatRp(b.realisasi)}</td>
                <td
                  className={`py-2 pr-3 text-right tabular-nums ${
                    b.sisa < 0 ? 'font-semibold text-red-700' : ''
                  }`}
                >
                  {formatRp(b.sisa)}
                </td>
                <td className="py-2 pr-3">
                  <SelPersen baris={b} />
                </td>
                <td className="py-2">
                  <Badge tone={b.lebih ? 'red' : 'green'}>{statusAnggaran(b.lebih)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <BarisTotal label={`Total ${judul}`} total={total} />
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function InputPaguAkun({
  akun,
  nilai,
  disabled,
  onChange,
}: {
  akun: AnggaranAkunApi;
  nilai: number;
  disabled: boolean;
  onChange: (nominal: number) => void;
}) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr_10rem] items-center gap-2">
      <span className="text-sm text-stone-500">{akun.kode}</span>
      <span className="text-[15px]">{akun.nama}</span>
      <CurrencyInput value={nilai} onChange={onChange} disabled={disabled} />
      {!akun.aktif && (
        <span className="col-span-3 text-helper text-red-700">
          Akun tidak aktif — pagu lama tetap ditampilkan, tetapi tidak bisa diubah.
        </span>
      )}
    </div>
  );
}

export function RealisasiTab() {
  const [tahun, setTahun] = useState(TAHUN_SEKARANG);
  const [data, setData] = useState<AnggaranListData | null>(null);
  const [hasil, setHasil] = useState<RealisasiAnggaranHasil | null>(null);
  const [pagu, setPagu] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [konfirmasi, setKonfirmasi] = useState<{ jumlah: number } | null>(null);
  const seqRef = useRef(0);
  const { sibuk, jalankan } = useAksiSibuk();
  const nonaktif = sibuk || memuat;
  const dataSiap = data?.tahun === tahun;

  const terapkan = useCallback((list: AnggaranListData, laporan: RealisasiAnggaranHasil) => {
    setData(list);
    setHasil(laporan);
    const tersimpan = new Map(list.baris.map((b) => [b.akun_kode, b.nominal]));
    setPagu(
      Object.fromEntries(list.akun.map((a) => [a.kode, tersimpan.get(a.kode) ?? 0])),
    );
  }, []);

  const muat = useCallback(
    async (t: number) => {
      const seq = ++seqRef.current;
      setMemuat(true);
      setErr(null);
      setInfo(null);
      try {
        const [list, laporan] = await Promise.all([
          api.anggaranList(t),
          api.laporanAnggaran({ tahun: t }),
        ]);
        if (seq !== seqRef.current) return;
        terapkan(list, laporan);
      } catch (e) {
        if (seq === seqRef.current) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      } finally {
        if (seq === seqRef.current) setMemuat(false);
      }
    },
    [terapkan],
  );

  useEffect(() => {
    void muat(tahun);
  }, [muat, tahun]);

  const akunAktif = useMemo(
    () => (data?.akun ?? []).filter((a) => a.aktif),
    [data],
  );
  const totalPaguInput = useMemo(
    () => akunAktif.reduce((s, a) => s + (pagu[a.kode] ?? 0), 0),
    [akunAktif, pagu],
  );
  const akanMenimpa = useMemo(() => {
    if (!data) return [];
    const lama = new Map(data.baris.map((b) => [b.akun_kode, b.nominal]));
    return akunAktif.filter((a) => {
      const nilaiLama = lama.get(a.kode) ?? 0;
      return nilaiLama > 0 && (pagu[a.kode] ?? 0) !== nilaiLama;
    });
  }, [data, akunAktif, pagu]);

  async function simpanSekarang(): Promise<void> {
    if (!data || data.tahun !== tahun) return;
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      try {
        const baris = akunAktif.map((a) => ({
          akun_kode: a.kode,
          nominal: pagu[a.kode] ?? 0,
        }));
        await api.anggaranSimpan(
          { tahun, baris },
          { alasan: 'Pagu anggaran disimpan dari layar Anggaran & Realisasi' },
        );
        const [list, laporan] = await Promise.all([
          api.anggaranList(tahun),
          api.laporanAnggaran({ tahun }),
        ]);
        terapkan(list, laporan);
        setKonfirmasi(null);
        setInfo(`Pagu anggaran tahun ${tahun} tersimpan.`);
      } catch (e) {
        setErr(pesanError(e, PESAN_SIMPAN_GAGAL));
      }
    });
  }

  function mintaSimpan(): void {
    if (nonaktif || !dataSiap) return;
    if (akanMenimpa.length > 0) {
      setKonfirmasi({ jumlah: akanMenimpa.length });
      return;
    }
    void simpanSekarang();
  }

  const pendapatanInput = (data?.akun ?? []).filter(
    (a) => a.tipe === 'PENDAPATAN' && a.aktif,
  );
  const bebanInput = (data?.akun ?? []).filter((a) => a.tipe === 'BEBAN' && a.aktif);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Anggaran & Realisasi</h1>
            <p className="mt-1 text-[15px] text-stone-600">
              Pagu disimpan per tahun. Realisasi, sisa, dan persen selalu dihitung
              ulang dari jurnal — bukan angka yang disimpan.
            </p>
          </div>
          <Field label="Tahun anggaran">
            <Select
              value={tahun}
              disabled={nonaktif}
              onChange={(e) => setTahun(Number(e.target.value))}
            >
              {TAHUN_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <div className="mt-3 space-y-2">
          <ErrorBox msg={err} />
          {info && (
            <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800">
              {info}
            </div>
          )}
          {hasil && (
            <p className="text-sm text-stone-600">
              Periode realisasi:{' '}
              <b>
                {hasil.mulai ? formatTanggal(hasil.mulai) : 'awal'} s/d{' '}
                {hasil.sampai ? formatTanggal(hasil.sampai) : 'akhir'}
              </b>
              . Bila awal tahun buku bukan Januari, periode mengikuti pengaturan
              tahun buku.
            </p>
          )}
        </div>

        {hasil && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`anggaran-${tahun}`}
              judul={`Anggaran & Realisasi ${tahun}`}
              disabled={nonaktif}
              buatWorkbook={(kop) => anggaranToWorkbook(hasil, kop)}
              buatDokumen={(kop) => anggaranPrintDoc(hasil, { kop })}
            />
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-bold">Realisasi vs Pagu {tahun}</h3>
          {memuat && <span className="text-sm text-stone-500">Memuat…</span>}
        </div>
        {!hasil ? (
          <p className="mt-3 text-[15px] text-stone-500">Belum ada data untuk ditampilkan.</p>
        ) : (
          <>
            <TabelBagian
              judul="Pendapatan"
              rows={hasil.pendapatan}
              total={hasil.totalPendapatan}
            />
            <TabelBagian judul="Beban" rows={hasil.beban} total={hasil.totalBeban} />
            <div className="mt-4 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2 text-[15px] font-bold">
                <span>Total Anggaran & Realisasi</span>
                <span className="flex flex-wrap items-center gap-3 font-normal">
                  <span>Pagu: {formatRp(hasil.total.anggaran)}</span>
                  <span>Realisasi: {formatRp(hasil.total.realisasi)}</span>
                  <span className={hasil.total.sisa < 0 ? 'font-semibold text-red-700' : ''}>
                    Sisa: {formatRp(hasil.total.sisa)}
                  </span>
                  <Badge tone={hasil.total.lebih ? 'red' : 'green'}>
                    {statusAnggaran(hasil.total.lebih)}
                  </Badge>
                </span>
              </div>
            </div>
          </>
        )}
      </Card>

      <Card>
        <h3 className="font-bold">Input Pagu Anggaran {tahun}</h3>
        <p className="mt-1 text-[15px] text-stone-600">
          Isi pagu per akun pendapatan dan beban. Isi <b>0</b> untuk mengosongkan
          pagu akun tersebut. Pagu lama yang diubah akan dikonfirmasi lebih dulu.
        </p>

        {!data ? (
          <p className="mt-3 text-[15px] text-stone-500">Memuat akun…</p>
        ) : (
          <>
            <div className="mt-4 grid gap-x-8 gap-y-6 lg:grid-cols-2">
              <div>
                <h4 className="mb-2 font-semibold text-emerald-800">Pendapatan</h4>
                <div className="space-y-2">
                  {pendapatanInput.map((a) => (
                    <InputPaguAkun
                      key={a.kode}
                      akun={a}
                      nilai={pagu[a.kode] ?? 0}
                      disabled={nonaktif || !dataSiap}
                      onChange={(nominal) =>
                        setPagu((lama) => ({ ...lama, [a.kode]: nominal }))
                      }
                    />
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-2 font-semibold text-emerald-800">Beban</h4>
                <div className="space-y-2">
                  {bebanInput.map((a) => (
                    <InputPaguAkun
                      key={a.kode}
                      akun={a}
                      nilai={pagu[a.kode] ?? 0}
                      disabled={nonaktif || !dataSiap}
                      onChange={(nominal) =>
                        setPagu((lama) => ({ ...lama, [a.kode]: nominal }))
                      }
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <span className="text-[15px]">
                Total pagu diisi: <b>{formatRp(totalPaguInput)}</b>
              </span>
              <Button disabled={nonaktif || !dataSiap} onClick={mintaSimpan}>
                {sibuk ? 'Menyimpan…' : 'Simpan Pagu'}
              </Button>
            </div>
          </>
        )}
      </Card>

      {konfirmasi && (
        <KonfirmasiModal
          judul="Timpa pagu yang sudah ada?"
          deskripsi={
            <p>
              {konfirmasi.jumlah} akun sudah punya pagu dan nilainya akan diubah.
              Perubahan ini tercatat di riwayat audit. Lanjutkan?
            </p>
          }
          labelYa="Ya, timpa pagu"
          variant="primary"
          sibuk={sibuk}
          onBatal={() => setKonfirmasi(null)}
          onKonfirmasi={() => void simpanSekarang()}
        />
      )}
    </div>
  );
}
