import { useEffect, useMemo, useRef, useState } from 'react';
import { AKUN_HUTANG, AKUN_MODAL, isAkunKas, type Coa } from '../../db/coa.js';
import {
  buatJurnalBayar,
  buatJurnalTerimaUang,
  type DasarFormJurnal,
} from '../../core/forms.js';
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

/** Jenis transaksi yang sudah punya form terpandu. */
export type JenisFormTransaksi = 'TERIMA' | 'BAYAR';

/** Kolom yang sama untuk Terima Uang & Bayar (kas + akun lawan). */
type FormTransaksi = DasarFormJurnal & {
  akunKas: string;
  akunLawan: string;
};

type GrupAkun = { label: string; akun: Coa[] };

type KonfigurasiForm = {
  judul: string;
  deskripsi: string;
  labelKas: string;
  labelLawan: string;
  hintLawan: string;
  placeholderKeterangan: string;
  labelKasBaris: string;
  labelLawanBaris: string;
  /** Posisi akun kas di baris jurnal: kas bisa di debit (Terima) atau kredit (Bayar). */
  posisiKas: 'DEBIT' | 'KREDIT';
  buat: (form: FormTransaksi) => JurnalInput;
  grupLawan: (coa: Coa[]) => GrupAkun[];
  akunLawanAwal: (coa: Coa[]) => string;
};

const today = (): string => new Date().toISOString().slice(0, 10);

/** Pilihan awal akun lawan Bayar: 5010/5000 (beban), lalu hutang. */
function akunLawanAwalBayar(coa: Coa[]): string {
  const beban = coa.filter((a) => a.tipe === 'BEBAN');
  return (
    beban.find((a) => a.kode === '5010')?.kode ??
    beban.find((a) => a.kode === '5000')?.kode ??
    beban[0]?.kode ??
    coa.find((a) => a.kode === AKUN_HUTANG)?.kode ??
    ''
  );
}

const KONFIG: Record<JenisFormTransaksi, KonfigurasiForm> = {
  TERIMA: {
    judul: 'Terima Uang',
    deskripsi:
      'Catat uang yang masuk ke kas atau bank. Isi sumber uangnya — pendapatan usaha/punia, atau setoran modal.',
    labelKas: 'Uang masuk ke',
    labelLawan: 'Sumber uang',
    hintLawan:
      'Pilih akun pendapatan. Bila uangnya setoran modal, pilih 3000 MODAL.',
    placeholderKeterangan: 'cth: Pendapatan parkir bulan Oktober',
    labelKasBaris: 'Uang masuk',
    labelLawanBaris: 'Sumber',
    posisiKas: 'DEBIT',
    buat: buatJurnalTerimaUang,
    grupLawan: (coa) => {
      const pendapatan = coa.filter((a) => a.tipe === 'PENDAPATAN');
      const modal = coa.find((a) => a.kode === AKUN_MODAL);
      const grup: GrupAkun[] = [];
      if (pendapatan.length > 0) grup.push({ label: 'Pendapatan', akun: pendapatan });
      if (modal) grup.push({ label: 'Setoran modal', akun: [modal] });
      return grup;
    },
    akunLawanAwal: (coa) =>
      (coa.find((a) => a.tipe === 'PENDAPATAN') ??
        coa.find((a) => a.kode === AKUN_MODAL))?.kode ?? '',
  },
  BAYAR: {
    judul: 'Bayar / Beban',
    deskripsi:
      'Catat uang yang keluar dari kas atau bank untuk belanja, biaya, atau melunasi hutang. Sistem menyusun jurnalnya otomatis.',
    labelKas: 'Uang keluar dari',
    labelLawan: 'Untuk pembayaran',
    hintLawan:
      'Pilih akun beban untuk belanja/biaya, atau 2050 HUTANG untuk melunasi hutang.',
    placeholderKeterangan: 'cth: Bayar listrik bulan Oktober',
    labelKasBaris: 'Uang keluar',
    labelLawanBaris: 'Pembayaran',
    posisiKas: 'KREDIT',
    buat: buatJurnalBayar,
    grupLawan: (coa) => {
      const beban = coa.filter((a) => a.tipe === 'BEBAN');
      const hutang = coa.filter((a) => a.tipe === 'KEWAJIBAN');
      // Akun non-kas lain yang relevan (panjar/piutang). Kas dilarang di sini.
      const asetLain = coa.filter(
        (a) => a.tipe === 'AKTIVA' && !isAkunKas(a.kode),
      );
      const grup: GrupAkun[] = [];
      if (beban.length > 0) grup.push({ label: 'Beban', akun: beban });
      if (hutang.length > 0) grup.push({ label: 'Hutang', akun: hutang });
      if (asetLain.length > 0)
        grup.push({ label: 'Aset lain (panjar/piutang)', akun: asetLain });
      return grup;
    },
    akunLawanAwal: akunLawanAwalBayar,
  },
};

export function FormTransaksiTerpandu({
  jenis,
  coa,
  memuat = false,
}: {
  jenis: JenisFormTransaksi;
  coa: Coa[];
  memuat?: boolean;
}) {
  const konfigurasi = KONFIG[jenis];

  const [tanggal, setTanggal] = useState(today());
  const [akunKas, setAkunKas] = useState(
    () => coa.find((a) => isAkunKas(a.kode))?.kode ?? '',
  );
  const [akunLawan, setAkunLawan] = useState(() => konfigurasi.akunLawanAwal(coa));
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState('');
  const [noBukti, setNoBukti] = useState('');

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);

  // COA dimuat async oleh TransaksiTab. Isi pilihan awal saat datanya tiba,
  // tanpa menimpa pilihan yang sudah dibuat operator.
  useEffect(() => {
    const kasPertama = coa.find((a) => isAkunKas(a.kode))?.kode ?? '';
    setAkunKas((sebelum) => sebelum || kasPertama);
    const lawanAwal = konfigurasi.akunLawanAwal(coa);
    setAkunLawan((sebelum) => sebelum || lawanAwal);
  }, [coa, konfigurasi]);

  const kasList = useMemo(() => coa.filter((a) => isAkunKas(a.kode)), [coa]);
  const grupLawan = useMemo(
    () => konfigurasi.grupLawan(coa),
    [coa, konfigurasi],
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
    if (!akunKas || !akunLawan)
      return { input: null as JurnalInput | null, error: null };
    if (!Number.isInteger(nominal) || nominal <= 0)
      return { input: null as JurnalInput | null, error: null };
    try {
      return {
        input: konfigurasi.buat({
          tanggal,
          akunKas,
          akunLawan,
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
  }, [akunKas, akunLawan, keterangan, konfigurasi, nominal, tanggal]);

  const totalDebit = pratinjau.input?.baris.reduce((s, b) => s + b.debit, 0) ?? 0;
  const totalKredit = pratinjau.input?.baris.reduce((s, b) => s + b.kredit, 0) ?? 0;

  const formSah =
    tanggalKalenderValid(tanggal) &&
    Boolean(akunKas) &&
    Boolean(akunLawan) &&
    Number.isInteger(nominal) &&
    nominal > 0 &&
    Boolean(keterangan.trim());

  const labelBaris = (i: number): string => {
    const kas = `${konfigurasi.labelKasBaris} — ${labelAkun(akunKas)}`;
    const lawan = `${konfigurasi.labelLawanBaris} — ${labelAkun(akunLawan)}`;
    const kasDiBarisIni = konfigurasi.posisiKas === 'DEBIT' ? i === 0 : i === 1;
    return kasDiBarisIni ? kas : lawan;
  };

  async function simpan(
    opsi: { alasan?: string; konfirmasi?: boolean } = {},
  ): Promise<void> {
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
      input = konfigurasi.buat({
        tanggal,
        akunKas,
        akunLawan,
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
      await api.jurnalPosting(input, {
        konfirmasiPeringatan: opsi.konfirmasi === true,
      });
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
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">{konfigurasi.judul}</h2>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            {konfigurasi.deskripsi}
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

        <Field label={konfigurasi.labelKas}>
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

        <Field label={konfigurasi.labelLawan}>
          <Select
            value={akunLawan}
            disabled={busy || memuat}
            onChange={(e) => setAkunLawan(e.target.value)}
          >
            <option value="">— Pilih {konfigurasi.labelLawan.toLowerCase()} —</option>
            {grupLawan.map((grup) => (
              <optgroup key={grup.label} label={grup.label}>
                {grup.akun.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.kode} — {a.nama}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <span className="mt-1 block text-xs text-stone-500">
            {konfigurasi.hintLawan}
          </span>
          {jenis === 'BAYAR' && (
            <span className="mt-1 block text-xs text-stone-500">
              Anggaran: belum diatur (fitur anggaran menyusul).
            </span>
          )}
        </Field>

        <Field label="Nominal">
          <CurrencyInput value={nominal} onChange={setNominal} />
        </Field>

        <Field label="Keterangan">
          <TextInput
            value={keterangan}
            disabled={busy}
            placeholder={konfigurasi.placeholderKeterangan}
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
                    <td className="py-2 pr-3">{labelBaris(i)}</td>
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

      {lockOpen && (
        <LockModal
          onCancel={() => setLockOpen(false)}
          onSubmit={(alasan) => {
            setLockOpen(false);
            void simpan({ alasan });
          }}
        />
      )}
    </Card>
  );
}
