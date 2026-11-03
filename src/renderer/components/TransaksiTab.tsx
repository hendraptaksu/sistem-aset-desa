import { useCallback, useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HandCoins,
  Landmark,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import { formatTanggal } from '../../utils/format.js';
import { api, type StatusSaldoAwal } from '../lib/api.js';
import { Badge, Button, Card, ErrorBox, RING_FOKUS } from './ui.js';
import { FormTransaksiTerpandu, type JenisFormTransaksi } from './TransaksiForm.js';
import { SaldoAwalWizard } from './SaldoAwalWizard.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';

/** Tab lain yang bisa dibuka dari pintasan kartu jenis transaksi. */
type TabTujuanTransaksi = 'panjar' | 'pinjaman';

type KartuJenis = {
  id: JenisFormTransaksi | 'PANJAR' | 'PINJAMAN';
  label: string;
  keterangan: string;
  Icon: LucideIcon;
  /** Bila diisi, kartu membuka tab lain, bukan memilih form terpandu. */
  tujuan?: TabTujuanTransaksi;
};

// Lima jenis punya form terpandu; Panjar dicatat di menunya sendiri dan
// kartunya menjadi pintasan ke tab tersebut.
const KARTU_JENIS: KartuJenis[] = [
  {
    id: 'TERIMA',
    label: 'Terima Uang',
    keterangan: 'Uang masuk ke kas / bank',
    Icon: ArrowDownLeft,
  },
  {
    id: 'BAYAR',
    label: 'Bayar',
    keterangan: 'Belanja atau pembayaran',
    Icon: ArrowUpRight,
  },
  {
    id: 'PINDAH',
    label: 'Pindah Dana',
    keterangan: 'Antar kas / bank',
    Icon: ArrowLeftRight,
  },
  {
    id: 'CATAT_UTANG',
    label: 'Catat Utang',
    keterangan: 'Beli/perbaikan dibayar belakangan',
    Icon: Receipt,
  },
  {
    id: 'BAYAR_UTANG',
    label: 'Bayar Utang',
    keterangan: 'Pelunasan utang usaha 2060',
    Icon: HandCoins,
  },
  {
    id: 'PANJAR',
    label: 'Panjar',
    keterangan: 'Uang muka kegiatan',
    Icon: HandCoins,
    tujuan: 'panjar',
  },
  {
    id: 'PINJAMAN',
    label: 'Pinjaman LPD',
    keterangan: 'Pencairan baru / sudah berjalan',
    Icon: Landmark,
    tujuan: 'pinjaman',
  },
];

const bisaDipilih = (id: KartuJenis['id']): id is JenisFormTransaksi =>
  id !== 'PANJAR' && id !== 'PINJAMAN';

export function TransaksiTab({
  jenisAwal,
  onBukaTab,
}: {
  jenisAwal?: JenisFormTransaksi;
  onBukaTab: (tab: TabTujuanTransaksi) => void;
}) {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [jenis, setJenis] = useState<JenisFormTransaksi>(jenisAwal ?? 'TERIMA');
  const [saldoStatus, setSaldoStatus] = useState<StatusSaldoAwal | null>(null);
  const [statusSaldoErr, setStatusSaldoErr] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [pesanSaldo, setPesanSaldo] = useState<string | null>(null);

  const muatStatusSaldo = useCallback(async () => {
    try {
      setSaldoStatus(await api.saldoAwalStatus());
      setStatusSaldoErr(null);
    } catch (e) {
      setStatusSaldoErr(pesanError(e, PESAN_MUAT_GAGAL));
    }
  }, []);

  useEffect(() => {
    let aktif = true;
    void (async () => {
      try {
        const data = await api.coa();
        if (aktif) setCoa(data);
      } catch (e) {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      } finally {
        if (aktif) setMemuat(false);
      }
    })();
    return () => {
      aktif = false;
    };
  }, []);

  useEffect(() => {
    void muatStatusSaldo();
  }, [muatStatusSaldo]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Catat Transaksi Harian</h1>
            <p className="mt-1 max-w-2xl text-[15px] text-stone-600">
              Pilih jenis transaksi, isi beberapa kolom, lalu periksa pratinjau sebelum
              menyimpan. Sistem menyusun jurnal otomatis, jadi Anda tidak perlu menghitung
              sendiri.
            </p>
          </div>
          <Badge tone="green">Form terpandu</Badge>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Saldo Awal Pembukuan</h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Dipakai sekali saat mulai pembukuan nyata. Isi saldo kas/bank, hutang,
              dan aset lain per tanggal mulai; selisih otomatis menjadi modal sehingga
              terbentuk satu jurnal yang seimbang.
            </p>
            {statusSaldoErr && (
              <p className="mt-2 text-sm text-red-700">{statusSaldoErr}</p>
            )}
            {saldoStatus?.boleh && (
              <p className="mt-2 text-sm text-emerald-800">
                {saldoStatus.tanggalMaksimal
                  ? `Belum ada saldo awal. Wizard masih bisa dipakai dengan tanggal paling lambat ${formatTanggal(saldoStatus.tanggalMaksimal)} (mengikuti transaksi paling awal).`
                  : 'Belum ada saldo awal. Wizard Saldo Awal bisa dipakai satu kali.'}
              </p>
            )}
            {saldoStatus && !saldoStatus.boleh && (
              <p className="mt-2 text-sm text-stone-600">
                {saldoStatus.alasan ??
                  'Saldo awal sudah pernah dibuat. Gunakan koreksi/jurnal biasa.'}
              </p>
            )}
            {!saldoStatus && !statusSaldoErr && (
              <p className="mt-2 text-sm text-stone-500">Memeriksa status saldo awal…</p>
            )}
            {pesanSaldo && (
              <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
                {pesanSaldo}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge tone={saldoStatus?.boleh ? 'green' : 'stone'}>
              {saldoStatus?.boleh
                ? 'Belum ada saldo awal'
                : saldoStatus
                  ? 'Sudah ada saldo awal'
                  : 'Memuat status'}
            </Badge>
            <Button
              disabled={!saldoStatus?.boleh || memuat}
              title={
                saldoStatus && !saldoStatus.boleh
                  ? (saldoStatus.alasan ??
                    'Saldo awal sudah pernah dibuat. Gunakan koreksi/jurnal biasa.')
                  : undefined
              }
              onClick={() => setWizardOpen(true)}
            >
              Wizard Saldo Awal
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Jenis transaksi</h2>
        <p className="mt-1 text-sm text-stone-600">
          Pilih <b>Terima Uang</b>, <b>Bayar</b>, <b>Pindah Dana</b>, <b>Catat Utang</b>,
          atau <b>Bayar Utang</b> untuk mencatat lewat form terpandu. <b>Panjar</b>{' '}
          dan <b>Pinjaman LPD</b> dibuka dari kartu menunya sendiri. Saldo 2050 lama
          tetap terbaca di laporan.
        </p>
        {err && (
          <div className="mt-3">
            <ErrorBox msg={err} />
          </div>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {KARTU_JENIS.map(({ id, label, keterangan, Icon, tujuan }) => {
            const aktif = !tujuan && jenis === id;
            const tersedia = !tujuan && bisaDipilih(id);
            return (
              <button
                key={id}
                type="button"
                aria-pressed={tersedia ? aktif : undefined}
                onClick={() => {
                  if (tujuan) {
                    onBukaTab(tujuan);
                  } else if (bisaDipilih(id)) {
                    setJenis(id);
                  }
                }}
                className={clsx(
                  'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  RING_FOKUS,
                  aktif &&
                    'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm',
                  !aktif &&
                    'border-stone-200 bg-white text-stone-700 hover:border-emerald-300 hover:bg-emerald-50/40',
                )}
              >
                <span
                  className={clsx(
                    'rounded-lg p-2',
                    aktif
                      ? 'bg-emerald-700 text-white'
                      : 'bg-emerald-100 text-emerald-800',
                  )}
                >
                  <Icon size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block break-words font-bold xl:break-normal">{label}</span>
                  <span className="block text-helper">{keterangan}</span>
                  <span
                    className={clsx(
                      'mt-1 block text-helper font-semibold',
                      aktif ? 'text-emerald-700' : 'text-emerald-800',
                    )}
                  >
                    {aktif
                      ? 'Sedang dipakai'
                      : tujuan === 'panjar'
                        ? 'Buka Buku Panjar'
                        : tujuan === 'pinjaman'
                          ? 'Buka Pinjaman LPD'
                          : 'Siap dipakai'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {/* `key` memastikan isian form tidak tercampur saat berganti jenis. */}
      <FormTransaksiTerpandu
        key={jenis}
        jenis={jenis}
        coa={coa}
        memuat={memuat}
      />

      {wizardOpen && (
        <SaldoAwalWizard
          coa={coa}
          tanggalMaksimal={saldoStatus?.tanggalMaksimal}
          onClose={() => setWizardOpen(false)}
          onSukses={(pesan) => {
            setPesanSaldo(pesan);
            setWizardOpen(false);
            // Optimistis: tombol langsung terkunci walau refresh status gagal.
            setSaldoStatus((s) => ({
              ...(s ?? {}),
              boleh: false,
              jumlahJurnal: (s?.jumlahJurnal ?? 0) + 1,
              alasan:
                'Saldo awal sudah pernah dibuat. Gunakan koreksi/jurnal biasa.',
            }));
            void muatStatusSaldo();
          }}
        />
      )}
    </div>
  );
}
