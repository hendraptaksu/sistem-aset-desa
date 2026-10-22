import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HandCoins,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import { api } from '../lib/api.js';
import { Badge, Card, ErrorBox } from './ui.js';
import { FormTransaksiTerpandu, type JenisFormTransaksi } from './TransaksiForm.js';

type KartuJenis = {
  id: JenisFormTransaksi | 'PANJAR' | 'PIUTANG';
  label: string;
  keterangan: string;
  Icon: LucideIcon;
  siap: boolean;
};

// Slot jenis transaksi dibuat konsisten sejak awal; P1-4..P1-5 akan mengisi
// tombol yang sekarang masih "segera hadir".
const KARTU_JENIS: KartuJenis[] = [
  {
    id: 'TERIMA',
    label: 'Terima Uang',
    keterangan: 'Uang masuk ke kas / bank',
    Icon: ArrowDownLeft,
    siap: true,
  },
  {
    id: 'BAYAR',
    label: 'Bayar',
    keterangan: 'Belanja atau pembayaran',
    Icon: ArrowUpRight,
    siap: true,
  },
  {
    id: 'PINDAH',
    label: 'Pindah Dana',
    keterangan: 'Antar kas / bank',
    Icon: ArrowLeftRight,
    siap: true,
  },
  {
    id: 'PANJAR',
    label: 'Panjar',
    keterangan: 'Uang muka kegiatan',
    Icon: HandCoins,
    siap: false,
  },
  {
    id: 'PIUTANG',
    label: 'Piutang/Hutang',
    keterangan: 'Pinjam, utang, pelunasan',
    Icon: Users,
    siap: false,
  },
];

const bisaDipilih = (id: KartuJenis['id']): id is JenisFormTransaksi =>
  id === 'TERIMA' || id === 'BAYAR' || id === 'PINDAH';

export function TransaksiTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [jenis, setJenis] = useState<JenisFormTransaksi>('TERIMA');

  useEffect(() => {
    let aktif = true;
    void (async () => {
      try {
        const data = await api.coa();
        if (aktif) setCoa(data);
      } catch (e) {
        if (aktif) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (aktif) setMemuat(false);
      }
    })();
    return () => {
      aktif = false;
    };
  }, []);

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
        <h2 className="text-lg font-bold">Jenis transaksi</h2>
        <p className="mt-1 text-sm text-stone-600">
          Untuk sekarang, <b>Terima Uang</b>, <b>Bayar</b>, dan <b>Pindah Dana</b>{' '}
          sudah bisa dipakai. Jenis lain menyusul.
        </p>
        {err && (
          <div className="mt-3">
            <ErrorBox msg={err} />
          </div>
        )}
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {KARTU_JENIS.map(({ id, label, keterangan, Icon, siap }) => {
            const aktif = jenis === id;
            const tersedia = siap && bisaDipilih(id);
            return (
              <button
                key={id}
                type="button"
                disabled={!tersedia}
                aria-pressed={aktif}
                onClick={() => {
                  if (bisaDipilih(id)) setJenis(id);
                }}
                className={clsx(
                  'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  aktif &&
                    'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm',
                  !aktif &&
                    tersedia &&
                    'border-stone-200 bg-white text-stone-700 hover:border-emerald-300 hover:bg-emerald-50/40',
                  !tersedia &&
                    'cursor-not-allowed border-stone-200 bg-stone-50 text-stone-400',
                )}
              >
                <span
                  className={clsx(
                    'rounded-lg p-2',
                    aktif
                      ? 'bg-emerald-700 text-white'
                      : tersedia
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-stone-200 text-stone-500',
                  )}
                >
                  <Icon size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">{label}</span>
                  <span className="block text-xs">{keterangan}</span>
                  <span
                    className={clsx(
                      'mt-1 block text-xs font-semibold',
                      aktif
                        ? 'text-emerald-700'
                        : tersedia
                          ? 'text-emerald-800'
                          : 'text-stone-400',
                    )}
                  >
                    {!tersedia ? 'Segera hadir' : aktif ? 'Sedang dipakai' : 'Siap dipakai'}
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
    </div>
  );
}
