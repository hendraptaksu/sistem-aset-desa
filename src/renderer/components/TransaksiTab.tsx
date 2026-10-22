import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  HandCoins,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { AKUN_MODAL, isAkunKas, type Coa } from '../../db/coa.js';
import { buatJurnalTerimaUang } from '../../core/forms.js';
import { tanggalKalenderValid, type JurnalInput } from '../../core/posting.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, isPerluAlasan, isPerluKonfirmasi } from '../lib/api.js';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  ErrorBox,
  Field,
  LockModal,
  Select,
  TextInput,
} from './ui.js';

const today = () => new Date().toISOString().slice(0, 10);

type KartuJenis = {
  id: 'TERIMA' | 'BAYAR' | 'PINDAH' | 'PANJAR' | 'PIUTANG';
  label: string;
  keterangan: string;
  Icon: LucideIcon;
  siap: boolean;
};

// Slot jenis transaksi dibuat konsisten sejak awal; P1-2..P1-5 akan mengisi
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
    siap: false,
  },
  {
    id: 'PINDAH',
    label: 'Pindah Dana',
    keterangan: 'Antar kas / bank',
    Icon: ArrowLeftRight,
    siap: false,
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

export function TransaksiTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Form Terima Uang
  const [tanggal, setTanggal] = useState(today());
  const [akunKas, setAkunKas] = useState('');
  const [sumber, setSumber] = useState('');
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState('');
  const [noBukti, setNoBukti] = useState('');

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);

  useEffect(() => {
    let aktif = true;
    void (async () => {
      try {
        const data = await api.coa();
        if (aktif) {
          setCoa(data);
          // Pilihan awal: kas pertama (1001 KAS) dan pendapatan pertama.
          const kasPertama = data.find((a) => isAkunKas(a.kode));
          const sumberPertama = data.find(
            (a) => a.tipe === 'PENDAPATAN' || a.kode === AKUN_MODAL,
          );
          if (kasPertama) setAkunKas((sebelum) => sebelum || kasPertama.kode);
          if (sumberPertama) setSumber((sebelum) => sebelum || sumberPertama.kode);
        }
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

  const kasList = useMemo(() => coa.filter((a) => isAkunKas(a.kode)), [coa]);
  const sumberList = useMemo(
    () => coa.filter((a) => a.tipe === 'PENDAPATAN' || a.kode === AKUN_MODAL),
    [coa],
  );
  const pendapatanList = useMemo(
    () => sumberList.filter((a) => a.tipe === 'PENDAPATAN'),
    [sumberList],
  );
  const akunModal = useMemo(
    () => sumberList.find((a) => a.kode === AKUN_MODAL),
    [sumberList],
  );

  const namaAkun = useMemo(
    () => new Map(coa.map((a) => [a.kode, `${a.kode} — ${a.nama}`])),
    [coa],
  );
  const labelAkun = (kode: string): string => namaAkun.get(kode) ?? kode;

  // Pratinjau memakai builder yang sama dengan yang dipakai saat menyimpan.
  const pratinjau = useMemo(() => {
    if (!tanggalKalenderValid(tanggal))
      return { input: null as JurnalInput | null, error: 'Tanggal belum valid.' };
    if (!akunKas || !sumber) return { input: null as JurnalInput | null, error: null };
    if (!Number.isInteger(nominal) || nominal <= 0)
      return { input: null as JurnalInput | null, error: null };
    try {
      return {
        input: buatJurnalTerimaUang({
          tanggal,
          akunKas,
          akunLawan: sumber,
          nominal,
          // Keterangan boleh belum diisi saat pratinjau; saat simpan wajib.
          keterangan: keterangan.trim() || 'Transaksi harian',
        }),
        error: null,
      };
    } catch (e) {
      return {
        input: null as JurnalInput | null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [akunKas, keterangan, nominal, sumber, tanggal]);

  const totalDebit = pratinjau.input?.baris.reduce((s, b) => s + b.debit, 0) ?? 0;
  const totalKredit = pratinjau.input?.baris.reduce((s, b) => s + b.kredit, 0) ?? 0;

  const formSah =
    tanggalKalenderValid(tanggal) &&
    Boolean(akunKas) &&
    Boolean(sumber) &&
    Number.isInteger(nominal) &&
    nominal > 0 &&
    Boolean(keterangan.trim());

  async function simpan(opsi: { alasan?: string; konfirmasi?: boolean } = {}): Promise<void> {
    if (busyRef.current) return;
    setErr(null);
    setInfo(null);
    setPesanKonfirmasi(null);
    setLockOpen(false);

    if (!formSah) {
      setErr('Lengkapi tanggal, akun, nominal, dan keterangan terlebih dahulu.');
      return;
    }

    let input: JurnalInput;
    try {
      input = buatJurnalTerimaUang({
        tanggal,
        akunKas,
        akunLawan: sumber,
        nominal,
        keterangan: keterangan.trim(),
        noBukti: noBukti.trim(),
        ...(opsi.alasan ? { alasan: opsi.alasan } : {}),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }

    const nominalTersimpan = nominal;
    const noBuktiTersimpan = noBukti.trim();
    busyRef.current = true;
    setBusy(true);
    try {
      await api.jurnalPosting(input, { konfirmasiPeringatan: opsi.konfirmasi === true });
      setInfo(
        `Transaksi ${formatTanggal(tanggal)} tersimpan${noBuktiTersimpan ? ` (${noBuktiTersimpan})` : ''} — ${formatRp(nominalTersimpan)}. Jurnal otomatis sudah dibuat.`,
      );
      // Tanggal & akun tetap; hanya isian yang mudah berulang yang dikosongkan.
      setNominal(0);
      setKeterangan('');
      setNoBukti('');
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockOpen(true);
      } else if (isPerluKonfirmasi(e) && !opsi.konfirmasi) {
        setPesanKonfirmasi(e instanceof Error ? e.message : String(e));
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

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
          Untuk sekarang, <b>Terima Uang</b> sudah bisa dipakai. Jenis lain menyusul.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {KARTU_JENIS.map(({ id, label, keterangan, Icon, siap }) => {
            const aktif = id === 'TERIMA';
            return (
              <button
                key={id}
                type="button"
                disabled={!siap}
                aria-pressed={aktif}
                onClick={() => {
                  if (siap) {
                    setErr(null);
                    setInfo(null);
                  }
                }}
                className={clsx(
                  'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  aktif
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                    : 'border-stone-200 bg-stone-50 text-stone-400',
                  !siap && 'cursor-not-allowed',
                )}
              >
                <span
                  className={clsx(
                    'rounded-lg p-2',
                    aktif ? 'bg-emerald-700 text-white' : 'bg-stone-200 text-stone-500',
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
                      aktif ? 'text-emerald-700' : 'text-stone-400',
                    )}
                  >
                    {aktif ? 'Siap dipakai' : 'Segera hadir'}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Terima Uang</h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Catat uang yang masuk ke kas atau bank. Isi sumber uangnya — pendapatan
              usaha/punia, atau setoran modal.
            </p>
          </div>
          <Badge tone="green">Jurnal otomatis seimbang</Badge>
        </div>

        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {info && (
          <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800">
            {info}
          </div>
        )}

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Tanggal">
            <TextInput
              type="date"
              value={tanggal}
              disabled={busy}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </Field>

          <Field label="Uang masuk ke">
            <Select
              value={akunKas}
              disabled={busy || memuat}
              onChange={(e) => setAkunKas(e.target.value)}
            >
              <option value="">— Pilih kas / bank —</option>
              {kasList.map((a) => (
                <option key={a.kode} value={a.kode}>
                  {a.kode} — {a.nama}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Sumber uang">
            <Select
              value={sumber}
              disabled={busy || memuat}
              onChange={(e) => setSumber(e.target.value)}
            >
              <option value="">— Pilih sumber uang —</option>
              {pendapatanList.length > 0 && (
                <optgroup label="Pendapatan">
                  {pendapatanList.map((a) => (
                    <option key={a.kode} value={a.kode}>
                      {a.kode} — {a.nama}
                    </option>
                  ))}
                </optgroup>
              )}
              {akunModal && (
                <optgroup label="Setoran modal">
                  <option value={akunModal.kode}>
                    {akunModal.kode} — {akunModal.nama}
                  </option>
                </optgroup>
              )}
            </Select>
            <span className="mt-1 block text-xs text-stone-500">
              Pilih akun pendapatan. Bila uangnya setoran modal, pilih 3000 MODAL.
            </span>
          </Field>

          <Field label="Nominal">
            <CurrencyInput value={nominal} onChange={setNominal} />
          </Field>

          <Field label="Keterangan">
            <TextInput
              value={keterangan}
              disabled={busy}
              placeholder="cth: Pendapatan parkir bulan Oktober"
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </Field>

          <Field label="No. bukti (opsional)">
            <TextInput
              value={noBukti}
              disabled={busy}
              placeholder="cth: JU-2026-0001 — boleh dikosongkan"
              onChange={(e) => setNoBukti(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Pratinjau Jurnal (untuk diperiksa)</h3>
            {pratinjau.input && totalDebit === totalKredit && totalDebit > 0 && (
              <Badge tone="green">Seimbang</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            Baris di bawah ini yang akan disimpan. Operator tidak perlu mengubahnya;
            akuntan pendamping bisa memeriksa debit dan kredit di sini.
          </p>

          {pratinjau.error ? (
            <p className="mt-2 text-sm text-red-700">{pratinjau.error}</p>
          ) : pratinjau.input ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Keterangan</th>
                    <th className="py-2 pr-3 text-right">Debit</th>
                    <th className="py-2 text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {pratinjau.input.baris.map((b, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-3">
                        {i === 0
                          ? `Uang masuk — ${labelAkun(akunKas)}`
                          : `Sumber — ${labelAkun(sumber)}`}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {b.debit ? formatRp(b.debit) : '—'}
                      </td>
                      <td className="py-2 text-right">
                        {b.kredit ? formatRp(b.kredit) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t font-bold">
                    <td className="py-2 pr-3">Total</td>
                    <td className="py-2 pr-3 text-right">{formatRp(totalDebit)}</td>
                    <td className="py-2 text-right">{formatRp(totalKredit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="mt-2 text-sm text-stone-500">
              Pratinjau muncul setelah tanggal, akun, dan nominal diisi.
            </p>
          )}
        </div>

        {pesanKonfirmasi && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="text-[15px] font-semibold">Perlu konfirmasi</p>
            <p className="mt-1 text-[15px]">{pesanKonfirmasi}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void simpan({ konfirmasi: true })}>
                Ya, tetap simpan
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setPesanKonfirmasi(null)}
              >
                Batal
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busy || memuat || !formSah} onClick={() => void simpan()}>
            {busy ? 'Menyimpan…' : 'Simpan Transaksi'}
          </Button>
          <span className="text-sm text-stone-500">
            Setelah tersimpan, transaksi langsung masuk ke laporan dari jurnal.
          </span>
        </div>
      </Card>

      {lockOpen && (
        <LockModal
          onCancel={() => setLockOpen(false)}
          onSubmit={(alasan) => {
            setLockOpen(false);
            void simpan({ alasan });
          }}
        />
      )}
    </div>
  );
}
