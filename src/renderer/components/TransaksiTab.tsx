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
import { AKUN_HUTANG, type Coa } from '../../db/coa.js';
import { ALASAN_REVERSAL_MIN } from '../../core/reversal.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import {
  api,
  isPerluKonfirmasi,
  type JurnalLengkap,
  type StatusSaldoAwal,
} from '../lib/api.js';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Modal,
  RING_FOKUS,
  TextInput,
} from './ui.js';
import { DetailJurnalModal } from './DetailJurnalModal.js';
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

const LABEL_JENIS: Record<string, string> = {
  UMUM: 'Jurnal Umum',
  TERIMA: 'Terima Uang',
  BAYAR: 'Bayar / Beban',
  TRANSFER: 'Pindah Dana',
  PANJAR: 'Panjar',
  PIUTANG: 'Piutang',
  HUTANG: 'Hutang',
  SALDO_AWAL: 'Saldo Awal',
  REVERSAL: 'Jurnal Balik',
};

/**
 * Jenis yang boleh dibatalkan cepat dari halaman Transaksi. Panjar dan
 * pinjaman sengaja tidak masuk: koreksinya harus lewat modul asalnya agar
 * status dokumen ikut diperbarui.
 */
const JENIS_BISA_DIBATALKAN = new Set([
  'UMUM',
  'TERIMA',
  'BAYAR',
  'TRANSFER',
  'PIUTANG',
  'HUTANG',
]);

/** Nominal transaksi = jumlah debit baris; fallback total_debit bila kosong. */
export function nominalJurnal(
  jurnal: Pick<JurnalLengkap, 'total_debit' | 'baris'>,
): number {
  const baris = Array.isArray(jurnal.baris) ? jurnal.baris : [];
  if (baris.length > 0) {
    return baris.reduce((total, b) => total + Number(b.debit || 0), 0);
  }
  const total = Number(jurnal.total_debit);
  return Number.isFinite(total) ? total : 0;
}

/** Pinjaman LPD memakai akun 2050; jurnal HUTANG biasa (2060) tetap boleh. */
export function jurnalTerhubungPinjaman(
  jurnal: Pick<JurnalLengkap, 'jenis' | 'baris'>,
): boolean {
  return (
    jurnal.jenis === 'HUTANG' &&
    (jurnal.baris ?? []).some((b) => b.akun_kode === AKUN_HUTANG)
  );
}

/** Hanya jurnal aktif dan bukan dokumen panjar/pinjaman yang boleh dibatalkan. */
export function bisaDibatalkan(
  jurnal: Pick<JurnalLengkap, 'jenis' | 'baris' | 'reversal_of' | 'reversal_id'>,
): boolean {
  if (jurnal.reversal_of || jurnal.reversal_id) return false;
  if (!JENIS_BISA_DIBATALKAN.has(jurnal.jenis)) return false;
  return !jurnalTerhubungPinjaman(jurnal);
}

export function alasanPembatalanCukup(alasan: string): boolean {
  return String(alasan ?? '').trim().length >= ALASAN_REVERSAL_MIN;
}

/**
 * Ambil 10 jurnal terbaru. `jurnalCari` mengurutkan naik, jadi halaman
 * terakhir diambil bila jumlah jurnal melebihi batas lalu dibalik agar yang
 * paling baru tampil di atas.
 */
export async function muatTransaksiTerakhir(
  limit = 10,
): Promise<JurnalLengkap[]> {
  const awal = await api.jurnalCari({ limit, offset: 0 });
  let rows = awal.rows;
  if (awal.total > rows.length) {
    const halaman = await api.jurnalCari({
      limit,
      offset: Math.max(0, awal.total - limit),
    });
    rows = halaman.rows;
  }
  return [...rows].reverse();
}

/** Kirim pembatalan dengan alasan tervalidasi (>= 5 karakter). */
export async function batalkanJurnal(
  jurnal: Pick<JurnalLengkap, 'id'>,
  alasan: string,
  konfirmasiPeringatan = false,
) {
  const teks = String(alasan ?? '').trim();
  if (!alasanPembatalanCukup(teks)) {
    throw new Error(
      `Alasan pembatalan wajib diisi minimal ${ALASAN_REVERSAL_MIN} karakter.`,
    );
  }
  if (konfirmasiPeringatan) {
    return api.jurnalReverse(jurnal.id, teks, { konfirmasiPeringatan: true });
  }
  return api.jurnalReverse(jurnal.id, teks);
}

/** Kartu daftar transaksi terakhir; dipisah agar mudah diuji tanpa IPC. */
export function TransaksiTerakhirCard({
  daftar,
  memuat,
  err,
  info,
  onLihat,
  onBatalkan,
}: {
  daftar: JurnalLengkap[];
  memuat: boolean;
  err: string | null;
  info: string | null;
  onLihat: (jurnal: JurnalLengkap) => void;
  onBatalkan: (jurnal: JurnalLengkap) => void;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Transaksi Terakhir yang Dicatat</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Sepuluh transaksi terbaru. Periksa detailnya atau batalkan bila ada
            salah ketik nominal/keterangan tanpa berpindah menu.
          </p>
        </div>
        <Badge tone="stone">10 terbaru</Badge>
      </div>

      {info && (
        <div
          role="status"
          className="mt-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800"
        >
          {info}
        </div>
      )}
      {err && (
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Tanggal</th>
              <th className="py-2 pr-3">No. Bukti</th>
              <th className="py-2 pr-3">Jenis</th>
              <th className="py-2 pr-3">Keterangan</th>
              <th className="py-2 pr-3 text-right">Nominal</th>
              <th className="py-2 pr-3">Status</th>
              <th className="py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {daftar.map((jurnal) => {
              const konteks =
                jurnal.no_bukti?.trim() ||
                `${formatTanggal(jurnal.tanggal)} ${jurnal.id.slice(0, 12)}`;
              return (
                <tr key={jurnal.id} className="border-b align-top last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3">
                    {formatTanggal(jurnal.tanggal)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {jurnal.no_bukti || '—'}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {LABEL_JENIS[jurnal.jenis] ?? jurnal.jenis}
                  </td>
                  <td className="py-2 pr-3">{jurnal.keterangan}</td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {formatRp(nominalJurnal(jurnal))}
                  </td>
                  <td className="py-2 pr-3">
                    {jurnal.reversal_of ? (
                      <Badge tone="red">Jurnal balik</Badge>
                    ) : jurnal.reversal_id ? (
                      <Badge tone="amber">Sudah dikoreksi</Badge>
                    ) : (
                      <Badge tone="stone">Aktif</Badge>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        variant="ghost"
                        aria-label={`Lihat transaksi ${konteks}`}
                        onClick={() => onLihat(jurnal)}
                      >
                        Lihat
                      </Button>
                      {bisaDibatalkan(jurnal) && (
                        <Button
                          variant="danger-outline"
                          aria-label={`Batalkan transaksi ${konteks}`}
                          onClick={() => onBatalkan(jurnal)}
                        >
                          Batalkan / Salah Input
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {daftar.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 text-center text-stone-500">
                  {memuat
                    ? 'Memuat transaksi terakhir…'
                    : err
                      ? 'Transaksi terakhir gagal dimuat.'
                      : 'Belum ada transaksi yang dicatat.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-helper text-stone-500">
        Pembatalan tidak menghapus jurnal asli; sistem membuat jurnal balik dan
        mencatat alasannya di riwayat audit.
      </p>
    </Card>
  );
}

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

  const [daftarJurnal, setDaftarJurnal] = useState<JurnalLengkap[]>([]);
  const [memuatJurnal, setMemuatJurnal] = useState(true);
  const [errJurnal, setErrJurnal] = useState<string | null>(null);
  const [infoJurnal, setInfoJurnal] = useState<string | null>(null);
  const [versiJurnal, setVersiJurnal] = useState(0);
  const [detailJurnal, setDetailJurnal] = useState<JurnalLengkap | null>(null);
  const [batalJurnal, setBatalJurnal] = useState<JurnalLengkap | null>(null);

  const muatJurnal = useCallback(() => {
    setVersiJurnal((versi) => versi + 1);
  }, []);

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

  useEffect(() => {
    let aktif = true;
    setMemuatJurnal(true);
    setErrJurnal(null);
    muatTransaksiTerakhir()
      .then((rows) => {
        if (aktif) setDaftarJurnal(rows);
      })
      .catch((e) => {
        if (aktif) setErrJurnal(pesanError(e, PESAN_MUAT_GAGAL));
      })
      .finally(() => {
        if (aktif) setMemuatJurnal(false);
      });
    return () => {
      aktif = false;
    };
  }, [versiJurnal]);

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
        onTersimpan={muatJurnal}
      />

      <TransaksiTerakhirCard
        daftar={daftarJurnal}
        memuat={memuatJurnal}
        err={errJurnal}
        info={infoJurnal}
        onLihat={setDetailJurnal}
        onBatalkan={setBatalJurnal}
      />

      {detailJurnal && (
        <DetailJurnalModal
          jurnal={detailJurnal}
          coa={coa}
          onClose={() => setDetailJurnal(null)}
        />
      )}

      {batalJurnal && (
        <BatalkanJurnalModal
          jurnal={batalJurnal}
          onBatal={() => setBatalJurnal(null)}
          onSelesai={(pesan) => {
            setBatalJurnal(null);
            setInfoJurnal(pesan);
            muatJurnal();
          }}
        />
      )}

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
            muatJurnal();
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal pembatalan cepat. Jurnal asli tidak dihapus: backend membuat jurnal
 * balik dan menyimpan alasan di audit. Peringatan (mis. kas minus) tetap harus
 * dikonfirmasi operator sebelum dikirim ulang.
 */
export function BatalkanJurnalModal({
  jurnal,
  onBatal,
  onSelesai,
}: {
  jurnal: JurnalLengkap;
  onBatal: () => void;
  onSelesai: (pesan: string) => void;
}) {
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [perluKonfirmasi, setPerluKonfirmasi] = useState(false);
  const cukup = alasanPembatalanCukup(alasan);

  async function kirim(konfirmasi = false): Promise<void> {
    if (busy) return;
    if (!cukup) {
      setErr(`Alasan pembatalan wajib diisi minimal ${ALASAN_REVERSAL_MIN} karakter.`);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await batalkanJurnal(jurnal, alasan, konfirmasi);
      onSelesai(
        `Transaksi ${jurnal.no_bukti || jurnal.id} dibatalkan. Jurnal balik sudah dibuat dan jurnal asli tetap tersimpan.`,
      );
    } catch (e) {
      if (isPerluKonfirmasi(e) && !konfirmasi) {
        setPerluKonfirmasi(true);
        setErr(pesanError(e));
      } else {
        setErr(pesanError(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      judul="Batalkan / Salah Input"
      deskripsi={
        <span className="text-[15px]">
          Jurnal asli <b>tidak dihapus</b>. Sistem membuat jurnal balik dan
          mencatat alasan pembatalan di riwayat audit.
        </span>
      }
      onTutup={onBatal}
      sibuk={busy}
      lebar="md"
    >
      <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-[15px]">
        <p className="font-semibold">{jurnal.keterangan}</p>
        <p className="text-sm text-stone-600">
          {formatTanggal(jurnal.tanggal)} · {jurnal.no_bukti || 'tanpa nomor bukti'} ·{' '}
          {formatRp(nominalJurnal(jurnal))}
        </p>
      </div>

      <div className="mt-3">
        <ErrorBox msg={err} />
      </div>

      {perluKonfirmasi ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
          <p className="text-[15px]">
            Pembatalan ini memicu peringatan. Periksa kembali, lalu konfirmasi
            bila tetap ingin melanjutkan.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setPerluKonfirmasi(false);
                setErr(null);
              }}
            >
              Periksa lagi
            </Button>
            <Button
              variant="danger"
              disabled={busy || !cukup}
              onClick={() => void kirim(true)}
            >
              {busy ? 'Membatalkan…' : 'Tetap batalkan'}
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3">
            <Field label={`Alasan pembatalan (min. ${ALASAN_REVERSAL_MIN} karakter)`}>
              <TextInput
                autoFocus
                value={alasan}
                disabled={busy}
                placeholder="cth: salah ketik nominal, seharusnya Rp 80.000"
                onChange={(e) => {
                  setAlasan(e.target.value);
                  setErr(null);
                }}
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={onBatal}>
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={busy || !cukup}
              onClick={() => void kirim()}
            >
              {busy ? 'Membatalkan…' : 'Batalkan Transaksi'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
