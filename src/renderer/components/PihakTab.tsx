import { useEffect, useMemo, useRef, useState } from 'react';
import { clsx } from 'clsx';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  HandCoins,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import { isAkunKas } from '../../db/coa.js';
import {
  buatJurnalBayarHutang,
  buatJurnalBeliKredit,
  buatJurnalBeriPinjaman,
  buatJurnalTerimaPelunasanPiutang,
  buatJurnalTerimaPinjaman,
  type HasilJurnalPihak,
} from '../../core/forms.js';
import { tanggalKalenderValid, type JurnalInput } from '../../core/posting.js';
import type { AlurPihak } from '../../core/pihak.js';
import type { JurnalPihakTampil, Pihak, PihakSaldo } from '../../core/types.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, isPerluAlasan, isPerluKonfirmasi } from '../lib/api.js';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  ErrorBox,
  Field,
  KonfirmasiModal,
  LockModal,
  Select,
  TextInput,
} from './ui.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';
import {
  PESAN_MUAT_GAGAL,
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
} from '../../utils/pesanError.js';

const today = (): string => new Date().toISOString().slice(0, 10);

type InfoAlur = {
  judul: string;
  ringkas: string;
  deskripsi: string;
  labelKas: string;
  labelNominal: string;
  placeholder: string;
  pesanSukses: string;
  Icon: LucideIcon;
};

const ALUR_INFO: Record<AlurPihak, InfoAlur> = {
  BERI_PINJAMAN: {
    judul: 'Beri Pinjaman',
    ringkas: 'Uang kita dipinjamkan ke pihak',
    deskripsi:
      'Uang keluar dari kas/bank, tetapi bukan beban — dicatat sebagai Piutang (1050). ' +
      'Saat pihak mengembalikan uang, pakai alur Terima Pelunasan.',
    labelKas: 'Uang pinjaman diambil dari',
    labelNominal: 'Jumlah yang dipinjamkan',
    placeholder: 'cth: Pinjaman ke Banjar untuk kegiatan',
    pesanSukses:
      'Kas berkurang dan Piutang (1050) bertambah. Modal tidak berubah.',
    Icon: HandCoins,
  },
  TERIMA_PELUNASAN: {
    judul: 'Terima Pelunasan Piutang',
    ringkas: 'Pihak mengembalikan pinjaman',
    deskripsi:
      'Uang masuk kembali ke kas/bank dan Piutang (1050) berkurang. ' +
      'Bila jumlahnya melebihi saldo piutang pihak, sistem hanya memberi peringatan.',
    labelKas: 'Uang pelunasan masuk ke',
    labelNominal: 'Jumlah pelunasan',
    placeholder: 'cth: Pelunasan pinjaman dari Banjar',
    pesanSukses:
      'Kas bertambah dan Piutang (1050) berkurang. Modal tidak berubah.',
    Icon: ArrowDownLeft,
  },
  TERIMA_PINJAMAN: {
    judul: 'Terima Pinjaman',
    ringkas: 'Kita meminjam uang dari pihak',
    deskripsi:
      'Uang masuk ke kas/bank dan menjadi Hutang (2050) kepada pihak. ' +
      'Ini menambah kewajiban, bukan pendapatan — modal tidak berubah.',
    labelKas: 'Uang pinjaman masuk ke',
    labelNominal: 'Jumlah pinjaman diterima',
    placeholder: 'cth: Pinjaman dari LPD untuk perbaikan',
    pesanSukses:
      'Kas bertambah dan Hutang (2050) bertambah. Modal tidak berubah.',
    Icon: Users,
  },
  BAYAR_HUTANG: {
    judul: 'Bayar Hutang',
    ringkas: 'Kita melunasi pinjaman ke pihak',
    deskripsi:
      'Kas/bank berkurang dan Hutang (2050) berkurang. ' +
      'Bila pembayaran melebihi saldo hutang pihak, sistem hanya memberi peringatan.',
    labelKas: 'Uang pembayaran keluar dari',
    labelNominal: 'Jumlah yang dibayar',
    placeholder: 'cth: Bayar hutang perbaikan gedung tahap 1',
    pesanSukses:
      'Kas berkurang dan Hutang (2050) berkurang. Modal tidak berubah.',
    Icon: ArrowUpRight,
  },
  BELI_KREDIT: {
    judul: 'Beli / Perbaikan Barang Kredit',
    ringkas: 'Barang/perbaikan dibayar belakangan',
    deskripsi:
      'Kasus perbaikan gedung: beban langsung masuk Laba Rugi, dan Hutang (2050) ' +
      'bertambah. Modal (3000) TIDAK tersentuh — hutang dilunasi lewat alur Bayar Hutang.',
    labelKas: '',
    labelNominal: 'Nilai barang / perbaikan',
    placeholder: 'cth: Perbaikan gedung — bahan dan tukang, dibayar bulan depan',
    pesanSukses:
      'Beban bertambah (Laba Rugi turun) dan Hutang (2050) bertambah. Modal tidak berubah.',
    Icon: Building2,
  },
};

const URUTAN_ALUR: AlurPihak[] = [
  'BERI_PINJAMAN',
  'TERIMA_PELUNASAN',
  'TERIMA_PINJAMAN',
  'BAYAR_HUTANG',
  'BELI_KREDIT',
];

function TabelPratinjau({
  input,
  labelBaris,
}: {
  input: JurnalInput;
  labelBaris: (akun: string, debit: number, kredit: number) => string;
}) {
  const totalDebit = input.baris.reduce((s, b) => s + b.debit, 0);
  const totalKredit = input.baris.reduce((s, b) => s + b.kredit, 0);
  return (
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
          {input.baris.map((b, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-2 pr-3">{labelBaris(b.akun_kode, b.debit, b.kredit)}</td>
              <td className="py-2 pr-3 text-right">{b.debit ? formatRp(b.debit) : '—'}</td>
              <td className="py-2 text-right">{b.kredit ? formatRp(b.kredit) : '—'}</td>
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
      {totalDebit === totalKredit && totalDebit > 0 && (
        <div className="mt-2">
          <Badge tone="green">Seimbang</Badge>
        </div>
      )}
    </div>
  );
}

export function PihakTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [pihak, setPihak] = useState<Pihak[]>([]);
  const [saldo, setSaldo] = useState<PihakSaldo[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Master pihak
  const [namaBaru, setNamaBaru] = useState('');
  const [catatanBaru, setCatatanBaru] = useState('');
  const [editId, setEditId] = useState('');
  const [editNama, setEditNama] = useState('');
  const [editCatatan, setEditCatatan] = useState('');
  const [busyMaster, setBusyMaster] = useState(false);
  const busyMasterRef = useRef(false);
  const [hapusTarget, setHapusTarget] = useState<Pihak | null>(null);

  // Riwayat per pihak
  const [riwayatId, setRiwayatId] = useState('');
  const [riwayat, setRiwayat] = useState<JurnalPihakTampil[]>([]);
  const [busyRiwayat, setBusyRiwayat] = useState(false);
  const busyRiwayatRef = useRef(false);

  // Form transaksi pihak
  const [alur, setAlur] = useState<AlurPihak>('BERI_PINJAMAN');
  const [tanggal, setTanggal] = useState(today());
  const [pihakId, setPihakId] = useState('');
  const [akunKas, setAkunKas] = useState('1001');
  const [akunBeban, setAkunBeban] = useState('5003');
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState('');
  const [noBukti, setNoBukti] = useState('');
  const [setujuLebih, setSetujuLebih] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const alasanRef = useRef('');
  const [errForm, setErrForm] = useState<string | null>(null);
  const [infoForm, setInfoForm] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);

  const infoAlur = ALUR_INFO[alur];
  const kasList = useMemo(() => coa.filter((a) => isAkunKas(a.kode)), [coa]);
  const bebanList = useMemo(() => coa.filter((a) => a.tipe === 'BEBAN'), [coa]);
  const namaAkun = useMemo(
    () => new Map(coa.map((a) => [a.kode, `${a.kode} — ${a.nama}`])),
    [coa],
  );
  const labelAkun = (kode: string): string => namaAkun.get(kode) ?? kode;

  const muat = async (): Promise<void> => {
    setErr(null);
    try {
      const [c, p, s] = await Promise.all([
        api.coa(),
        api.pihakList(),
        api.pihakSaldo(),
      ]);
      setCoa(c);
      setPihak(p);
      setSaldo(s);
      setPihakId((sebelum) => (p.some((x) => x.id === sebelum) ? sebelum : ''));
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setMemuat(false);
    }
  };

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (coa.length === 0) return;
    const kasPertama = coa.find((a) => isAkunKas(a.kode))?.kode;
    if (kasPertama) setAkunKas((sebelum) => sebelum || kasPertama);
    const bebanWewangunan = coa.find((a) => a.kode === '5003' && a.tipe === 'BEBAN');
    const bebanPertama = bebanWewangunan ?? coa.find((a) => a.tipe === 'BEBAN');
    if (bebanPertama) setAkunBeban((sebelum) => sebelum || bebanPertama.kode);
  }, [coa]);

  const saldoTerpilih = saldo.find((s) => s.id === pihakId);
  const saldoRelevan =
    alur === 'BERI_PINJAMAN' || alur === 'TERIMA_PELUNASAN'
      ? (saldoTerpilih?.piutang ?? 0)
      : (saldoTerpilih?.hutang ?? 0);

  const lebihSaldo =
    (alur === 'TERIMA_PELUNASAN' && nominal > saldoRelevan) ||
    (alur === 'BAYAR_HUTANG' && nominal > saldoRelevan);
  const selisihLebih = lebihSaldo ? nominal - saldoRelevan : 0;

  const saldoSesudah =
    alur === 'BERI_PINJAMAN' || alur === 'TERIMA_PINJAMAN' || alur === 'BELI_KREDIT'
      ? saldoRelevan + nominal
      : saldoRelevan - nominal;

  const pratinjau = useMemo<{ hasil: HasilJurnalPihak | null; error: string | null }>(() => {
    if (!pihakId) return { hasil: null, error: null };
    if (!tanggalKalenderValid(tanggal))
      return { hasil: null, error: PESAN_TANGGAL_TIDAK_VALID };
    if (!Number.isInteger(nominal) || nominal <= 0) return { hasil: null, error: null };

    const dasar = {
      tanggal,
      pihakId,
      nominal,
      keterangan: keterangan.trim() || infoAlur.placeholder,
      ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
    };
    try {
      if (alur === 'BELI_KREDIT') {
        return { hasil: buatJurnalBeliKredit({ ...dasar, akunBeban }), error: null };
      }
      const buat =
        alur === 'BERI_PINJAMAN'
          ? buatJurnalBeriPinjaman
          : alur === 'TERIMA_PELUNASAN'
            ? buatJurnalTerimaPelunasanPiutang
            : alur === 'TERIMA_PINJAMAN'
              ? buatJurnalTerimaPinjaman
              : buatJurnalBayarHutang;
      return { hasil: buat({ ...dasar, akunKas }), error: null };
    } catch (e) {
      return { hasil: null, error: pesanError(e) };
    }
  }, [akunBeban, akunKas, alur, infoAlur.placeholder, keterangan, noBukti, nominal, pihakId, tanggal]);

  const formSah =
    tanggalKalenderValid(tanggal) &&
    Boolean(pihakId) &&
    Number.isInteger(nominal) &&
    nominal > 0 &&
    Boolean(keterangan.trim()) &&
    pratinjau.hasil !== null &&
    pratinjau.error === null;

  const labelBaris = (akun: string, debit: number, kredit: number): string => {
    const tambah = debit > 0;
    if (akun === '1050') return `Piutang (1050) — ${tambah ? 'bertambah' : 'berkurang'}`;
    if (akun === '2050') return `Hutang (2050) — ${tambah ? 'berkurang' : 'bertambah'}`;
    if (isAkunKas(akun))
      return `Kas/Bank — ${labelAkun(akun)} ${tambah ? 'bertambah' : 'berkurang'}`;
    return `Beban — ${labelAkun(akun)} ${tambah ? 'bertambah' : 'berkurang'}`;
  };

  function pilihAlur(baru: AlurPihak): void {
    setAlur(baru);
    setPesanKonfirmasi(null);
    setErrForm(null);
    setInfoForm(null);
    setLockOpen(false);
    setSetujuLebih(false);
    alasanRef.current = '';
  }

  function bangunInput(alasan?: string): HasilJurnalPihak {
    const dasar = {
      tanggal,
      pihakId,
      nominal,
      keterangan: keterangan.trim(),
      ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
      ...(alasan ? { alasan } : {}),
    };
    if (alur === 'BELI_KREDIT') return buatJurnalBeliKredit({ ...dasar, akunBeban });
    if (alur === 'BERI_PINJAMAN') return buatJurnalBeriPinjaman({ ...dasar, akunKas });
    if (alur === 'TERIMA_PELUNASAN')
      return buatJurnalTerimaPelunasanPiutang({ ...dasar, akunKas });
    if (alur === 'TERIMA_PINJAMAN') return buatJurnalTerimaPinjaman({ ...dasar, akunKas });
    return buatJurnalBayarHutang({ ...dasar, akunKas });
  }

  async function simpan(
    opsi: { alasan?: string; konfirmasi?: boolean } = {},
  ): Promise<void> {
    if (busyRef.current) return;
    setErrForm(null);
    setInfoForm(null);
    setPesanKonfirmasi(null);
    setLockOpen(false);

    if (!formSah) {
      setErrForm(
        'Lengkapi tanggal, pihak, nominal, keterangan, dan akun yang diminta terlebih dahulu.',
      );
      return;
    }
    if (lebihSaldo && !setujuLebih) {
      setErrForm(
        `Nominal melebihi saldo ${alur === 'TERIMA_PELUNASAN' ? 'piutang' : 'hutang'} ` +
          `sebesar ${formatRp(selisihLebih)}. Centang pernyataan konfirmasi di bawah bila memang benar.`,
      );
      return;
    }

    if (opsi.alasan !== undefined) alasanRef.current = opsi.alasan;
    const alasan = opsi.alasan ?? (alasanRef.current || undefined);

    let hasil: HasilJurnalPihak;
    try {
      hasil = bangunInput(alasan);
    } catch (e) {
      setErrForm(pesanError(e));
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const tersimpan = await api.pihakPosting(
        { pihakId: hasil.pihakId, input: hasil.input },
        {
          konfirmasiPeringatan: opsi.konfirmasi === true,
          konfirmasiSaldo: opsi.konfirmasi === true,
        },
      );
      alasanRef.current = '';
      setNominal(0);
      setKeterangan('');
      setNoBukti('');
      setSetujuLebih(false);
      await muat();
      setInfoForm(
        `${infoAlur.judul} senilai ${formatRp(nominal)} untuk ` +
          `${pihak.find((p) => p.id === pihakId)?.nama ?? 'pihak'} tersimpan` +
          `${tersimpan.jurnal?.no_bukti ? ` (${tersimpan.jurnal.no_bukti})` : ''}. ` +
          infoAlur.pesanSukses,
      );
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockOpen(true);
      } else if (isPerluKonfirmasi(e) && !opsi.konfirmasi) {
        setPesanKonfirmasi(pesanError(e));
      } else {
        setErrForm(pesanError(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function tambahPihak(): Promise<void> {
    if (busyMasterRef.current) return;
    setErr(null);
    setInfo(null);
    if (!namaBaru.trim()) {
      setErr('Nama pihak wajib diisi.');
      return;
    }
    busyMasterRef.current = true;
    setBusyMaster(true);
    try {
      const r = await api.pihakCreate({
        nama: namaBaru.trim(),
        catatan: catatanBaru.trim(),
      });
      setNamaBaru('');
      setCatatanBaru('');
      await muat();
      setPihakId(r.id);
      setInfo(`Pihak "${r.pihak.nama}" ditambahkan.`);
    } catch (e) {
      setErr(pesanError(e));
    } finally {
      busyMasterRef.current = false;
      setBusyMaster(false);
    }
  }

  function mulaiEdit(p: Pihak): void {
    setEditId(p.id);
    setEditNama(p.nama);
    setEditCatatan(p.catatan);
    setErr(null);
    setInfo(null);
  }

  async function simpanEdit(): Promise<void> {
    if (busyMasterRef.current || !editId) return;
    setErr(null);
    setInfo(null);
    busyMasterRef.current = true;
    setBusyMaster(true);
    try {
      const r = await api.pihakUpdate(editId, {
        nama: editNama.trim(),
        catatan: editCatatan.trim(),
      });
      setEditId('');
      await muat();
      setInfo(`Pihak "${r.pihak.nama}" diperbarui.`);
    } catch (e) {
      setErr(pesanError(e));
    } finally {
      busyMasterRef.current = false;
      setBusyMaster(false);
    }
  }

  function mintaHapusPihak(p: Pihak): void {
    setHapusTarget(p);
  }

  async function hapusPihak(p: Pihak): Promise<void> {
    if (busyMasterRef.current) return;
    setErr(null);
    setInfo(null);
    busyMasterRef.current = true;
    setBusyMaster(true);
    try {
      await api.pihakDelete(p.id);
      if (riwayatId === p.id) {
        setRiwayatId('');
        setRiwayat([]);
      }
      if (pihakId === p.id) setPihakId('');
      await muat();
      setInfo(`Pihak "${p.nama}" dihapus.`);
    } catch (e) {
      setErr(pesanError(e));
    } finally {
      busyMasterRef.current = false;
      setBusyMaster(false);
    }
  }

  async function konfirmasiHapusPihak(): Promise<void> {
    if (!hapusTarget) return;
    const target = hapusTarget;
    await hapusPihak(target);
    setHapusTarget(null);
  }

  async function bukaRiwayat(id: string): Promise<void> {
    if (busyRiwayatRef.current) return;
    if (riwayatId === id) {
      setRiwayatId('');
      setRiwayat([]);
      return;
    }
    setRiwayatId(id);
    busyRiwayatRef.current = true;
    setBusyRiwayat(true);
    try {
      setRiwayat(await api.pihakJurnal(id));
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      busyRiwayatRef.current = false;
      setBusyRiwayat(false);
    }
  }

  const riwayatSaldo = saldo.find((s) => s.id === riwayatId);
  const totalDebitRiwayat = riwayat.reduce((s, j) => s + j.debit, 0);
  const totalKreditRiwayat = riwayat.reduce((s, j) => s + j.kredit, 0);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Piutang &amp; Hutang</h1>
            <p className="mt-1 max-w-3xl text-[15px] text-stone-600">
              Catat pinjaman, pelunasan, dan hutang kepada pihak (orang/lembaga). Semua
              transaksi otomatis menjadi jurnal seimbang. <b>Untuk pembelian/perbaikan
              gedung secara kredit</b>, pilih alur Beli/Perbaikan Kredit: beban masuk
              Laba Rugi, hutang bertambah, dan <b>modal (3000) tidak berubah</b>.
            </p>
          </div>
          <Badge tone="green">Saldo dihitung dari jurnal</Badge>
        </div>
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {info && (
          <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800">
            {info}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-bold">Daftar Pihak</h2>
        <p className="mt-1 text-sm text-stone-600">
          Pihak wajib dipilih untuk setiap transaksi piutang/hutang. Saldo di bawah
          dihitung dari jurnal 1050/2050, bukan angka yang diketik manual.
        </p>

        <div className="mt-3 grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_1.3fr_auto]">
          <Field label="Nama pihak (orang/lembaga)">
            <TextInput
              value={namaBaru}
              disabled={busyMaster}
              placeholder="cth: Banjar / LPD / Toko Bangunan"
              onChange={(e) => setNamaBaru(e.target.value)}
            />
          </Field>
          <Field label="Catatan (opsional)">
            <TextInput
              value={catatanBaru}
              disabled={busyMaster}
              placeholder="cth: kontak / alamat / keperluan"
              onChange={(e) => setCatatanBaru(e.target.value)}
            />
          </Field>
          <Button disabled={busyMaster || !namaBaru.trim()} onClick={() => void tambahPihak()}>
            {busyMaster ? 'Menyimpan…' : '+ Tambah Pihak'}
          </Button>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Nama</th>
                <th className="py-2 pr-3">Catatan</th>
                <th className="py-2 pr-3 text-right">Piutang (1050)</th>
                <th className="py-2 pr-3 text-right">Hutang (2050)</th>
                <th className="py-2">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {pihak.map((p) => {
                const s = saldo.find((x) => x.id === p.id);
                const sedangEdit = editId === p.id;
                return (
                  <tr key={p.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      {sedangEdit ? (
                        <TextInput
                          value={editNama}
                          disabled={busyMaster}
                          onChange={(e) => setEditNama(e.target.value)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => void bukaRiwayat(p.id)}
                          className="text-left font-semibold text-emerald-800 underline-offset-2 hover:underline"
                          title="Lihat riwayat jurnal pihak ini"
                        >
                          {p.nama}
                        </button>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {sedangEdit ? (
                        <TextInput
                          value={editCatatan}
                          disabled={busyMaster}
                          onChange={(e) => setEditCatatan(e.target.value)}
                        />
                      ) : (
                        <span className="text-stone-600">{p.catatan || '—'}</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {formatRp(s?.piutang ?? 0)}
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap">
                      {formatRp(s?.hutang ?? 0)}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        {sedangEdit ? (
                          <>
                            <Button
                              disabled={busyMaster || !editNama.trim()}
                              onClick={() => void simpanEdit()}
                            >
                              {busyMaster ? 'Menyimpan…' : 'Simpan'}
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busyMaster}
                              onClick={() => setEditId('')}
                            >
                              Batal
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" onClick={() => mulaiEdit(p)}>
                              Ubah
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={busyMaster}
                              onClick={() => mintaHapusPihak(p)}
                            >
                              Hapus
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pihak.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-stone-500">
                    Belum ada pihak. Tambahkan nama pihak terlebih dahulu.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {riwayatId && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">
                Riwayat Jurnal — {riwayatSaldo?.nama ?? pihak.find((p) => p.id === riwayatId)?.nama ?? ''}
              </h2>
              <p className="mt-1 text-sm text-stone-600">
                Klik nama pihak lain untuk berpindah riwayat. Saldo dihitung ulang dari
                seluruh jurnal pihak ini.
              </p>
            </div>
            <Button variant="ghost" onClick={() => { setRiwayatId(''); setRiwayat([]); }}>
              Tutup riwayat
            </Button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[15px] md:grid-cols-4">
            <div className="rounded-lg border bg-stone-50 px-3 py-2">
              Piutang saat ini <b className="block">{formatRp(riwayatSaldo?.piutang ?? 0)}</b>
            </div>
            <div className="rounded-lg border bg-stone-50 px-3 py-2">
              Hutang saat ini <b className="block">{formatRp(riwayatSaldo?.hutang ?? 0)}</b>
            </div>
            <div className="rounded-lg border bg-stone-50 px-3 py-2">
              Jumlah jurnal <b className="block">{riwayat.length}</b>
            </div>
            <div className="rounded-lg border bg-stone-50 px-3 py-2">
              Total mutasi <b className="block">{formatRp(totalDebitRiwayat)}</b>
              <span className="text-xs text-stone-500">debit {formatRp(totalKreditRiwayat)} kredit</span>
            </div>
          </div>
          {busyRiwayat ? (
            <p className="mt-3 text-stone-500">Memuat riwayat…</p>
          ) : riwayat.length === 0 ? (
            <p className="mt-3 text-stone-500">Belum ada jurnal untuk pihak ini.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">No. bukti</th>
                    <th className="py-2 pr-3">Keterangan</th>
                    <th className="py-2 pr-3">Akun pihak</th>
                    <th className="py-2 pr-3 text-right">Debit</th>
                    <th className="py-2 pr-3 text-right">Kredit</th>
                    <th className="py-2">Jenis</th>
                  </tr>
                </thead>
                <tbody>
                  {riwayat.map((j) => (
                    <tr key={j.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatTanggal(j.tanggal)}</td>
                      <td className="py-2 pr-3">{j.no_bukti || '—'}</td>
                      <td className="py-2 pr-3">{j.keterangan}</td>
                      <td className="py-2 pr-3">{labelAkun(j.akun_pihak)}</td>
                      <td className="py-2 pr-3 text-right">{j.debit ? formatRp(j.debit) : '—'}</td>
                      <td className="py-2 pr-3 text-right">{j.kredit ? formatRp(j.kredit) : '—'}</td>
                      <td className="py-2">{j.jenis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-bold">Catat Transaksi Pihak</h2>
        <p className="mt-1 max-w-3xl text-sm text-stone-600">
          Pilih alur yang sesuai. Isi pihak, nominal, dan keterangan; pratinjau jurnal
          muncul sebelum disimpan. Operator tidak perlu menghitung debit/kredit.
        </p>

        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {URUTAN_ALUR.map((id) => {
            const info = ALUR_INFO[id];
            const aktif = alur === id;
            const Icon = info.Icon;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={aktif}
                onClick={() => pilihAlur(id)}
                className={clsx(
                  'flex items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                  aktif
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-950 shadow-sm'
                    : 'border-stone-200 bg-white text-stone-700 hover:border-emerald-300 hover:bg-emerald-50/40',
                )}
              >
                <span
                  className={clsx(
                    'rounded-lg p-2',
                    aktif ? 'bg-emerald-700 text-white' : 'bg-emerald-100 text-emerald-800',
                  )}
                >
                  <Icon size={22} />
                </span>
                <span className="min-w-0">
                  <span className="block font-bold">{info.judul}</span>
                  <span className="block text-xs">{info.ringkas}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
          <h3 className="font-bold">{infoAlur.judul}</h3>
          <p className="mt-1 max-w-3xl text-sm text-stone-700">{infoAlur.deskripsi}</p>
          <p className="mt-1 text-xs font-semibold text-emerald-800">
            {alur === 'BELI_KREDIT'
              ? 'D Beban / K Hutang (2050) — bukan D Modal. Modal hanya berubah lewat setoran/penarikan modal atau Saldo Awal.'
              : 'Piutang/hutang selalu punya pihak. Jurnal otomatis seimbang dan bisa diperiksa di Jurnal Umum.'}
          </p>
        </div>

        <div className="mt-3">
          <ErrorBox msg={errForm} />
        </div>
        {infoForm && (
          <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800">
            {infoForm}
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

          <Field label="Pihak (wajib)">
            <Select
              value={pihakId}
              disabled={busy || memuat}
              onChange={(e) => {
                setPihakId(e.target.value);
                setSetujuLebih(false);
                setPesanKonfirmasi(null);
                setErrForm(null);
              }}
            >
              <option value="">— Pilih pihak —</option>
              {pihak.map((p) => {
                const s = saldo.find((x) => x.id === p.id);
                return (
                  <option key={p.id} value={p.id}>
                    {p.nama} — piutang {formatRp(s?.piutang ?? 0)} / hutang{' '}
                    {formatRp(s?.hutang ?? 0)}
                  </option>
                );
              })}
            </Select>
            {pihak.length === 0 && (
              <span className="mt-1 block text-xs text-red-700">
                Belum ada pihak. Tambahkan dulu di daftar pihak di atas.
              </span>
            )}
          </Field>

          {alur !== 'BELI_KREDIT' ? (
            <Field label={infoAlur.labelKas}>
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
          ) : (
            <Field label="Akun beban (untuk Laba Rugi)">
              <Select
                value={akunBeban}
                disabled={busy || memuat}
                onChange={(e) => setAkunBeban(e.target.value)}
              >
                <option value="">— Pilih akun beban —</option>
                {bebanList.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.kode} — {a.nama}
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-xs text-stone-500">
                Contoh perbaikan gedung: 5003 BAGA WEWANGUNAN. Tidak ada uang kas yang
                keluar sekarang; hutang bertambah.
              </span>
            </Field>
          )}

          <Field label={infoAlur.labelNominal}>
            <CurrencyInput value={nominal} onChange={(n) => { setNominal(n); setSetujuLebih(false); }} />
          </Field>

          <Field label="Keterangan">
            <TextInput
              value={keterangan}
              disabled={busy}
              placeholder={infoAlur.placeholder}
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </Field>

          <div>
            <Field label="No. bukti (opsional)">
              <TextInput
                value={noBukti}
                disabled={busy}
                placeholder="cth: JU-2026-0001 — boleh dikosongkan"
                onChange={(e) => setNoBukti(e.target.value)}
              />
            </Field>
            <SaranNomorBukti tanggal={tanggal} />
          </div>
        </div>

        {saldoTerpilih && (
          <div className="mt-3 grid grid-cols-1 gap-2 text-[15px] md:grid-cols-3">
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
              Saldo pihak saat ini:{' '}
              <b>{formatRp(saldoRelevan)}</b>{' '}
              <span className="text-xs text-stone-500">
                ({alur === 'BERI_PINJAMAN' || alur === 'TERIMA_PELUNASAN' ? 'piutang 1050' : 'hutang 2050'})
              </span>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
              Setelah transaksi: <b>{formatRp(saldoSesudah)}</b>
            </div>
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
              {alur === 'BELI_KREDIT'
                ? 'Modal (3000) tidak berubah'
                : 'Modal (3000) tidak tersentuh'}
            </div>
          </div>
        )}

        {lebihSaldo && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="text-[15px] font-semibold">Perhatian: melebihi saldo pihak</p>
            <p className="mt-1 text-[15px]">
              {alur === 'TERIMA_PELUNASAN' ? 'Pelunasan' : 'Pembayaran'} melebihi saldo{' '}
              {alur === 'TERIMA_PELUNASAN' ? 'piutang' : 'hutang'} sebesar{' '}
              <b>{formatRp(selisihLebih)}</b>. Saldo setelah transaksi menjadi{' '}
              <b>{formatRp(saldoSesudah)}</b>. Sistem tidak memblokir, tetapi periksa
              kembali bila ini bukan koreksi.
            </p>
            <label className="mt-2 flex items-start gap-2 text-[15px]">
              <input
                type="checkbox"
                className="mt-1"
                checked={setujuLebih}
                disabled={busy}
                onChange={(e) => setSetujuLebih(e.target.checked)}
              />
              <span>
                Saya sudah memeriksa dan tetap ingin menyimpan transaksi ini.
              </span>
            </label>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Pratinjau Jurnal (untuk diperiksa)</h3>
            {pratinjau.hasil && (
              <Badge tone="green">Jurnal otomatis seimbang</Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            Debit = sisi kiri, kredit = sisi kanan. Jurnal inilah yang akan disimpan dan
            menjadi sumber laporan.
          </p>
          {pratinjau.error ? (
            <p className="mt-2 text-sm text-red-700">{pratinjau.error}</p>
          ) : pratinjau.hasil ? (
            <TabelPratinjau input={pratinjau.hasil.input} labelBaris={labelBaris} />
          ) : (
            <p className="mt-2 text-sm text-stone-500">
              Pratinjau muncul setelah pihak, nominal, dan akun diisi.
            </p>
          )}
        </div>

        {pesanKonfirmasi && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="text-[15px] font-semibold">Perlu konfirmasi</p>
            <p className="mt-1 text-[15px]">{pesanKonfirmasi}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  setSetujuLebih(true);
                  void simpan({ konfirmasi: true });
                }}
              >
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
            {busy ? 'Menyimpan…' : `Simpan ${infoAlur.judul}`}
          </Button>
          <span className="text-sm text-stone-500">
            Setelah tersimpan, laporan langsung berubah dan jurnal bisa diperiksa di tab
            Jurnal Umum.
          </span>
        </div>

        {lockOpen && (
          <LockModal
            onCancel={() => {
              alasanRef.current = '';
              setLockOpen(false);
            }}
            onSubmit={(alasan) => {
              setLockOpen(false);
              void simpan({ alasan });
            }}
          />
        )}
      </Card>

      {hapusTarget && (
        <KonfirmasiModal
          judul="Hapus pihak?"
          deskripsi={
            <>
              <p>
                Pihak <b>{hapusTarget.nama}</b> akan dihapus dari daftar.
              </p>
              <p className="text-sm text-stone-600">
                Pihak yang sudah dipakai jurnal tidak bisa dihapus. Riwayat jurnal
                tetap aman dan tidak berubah.
              </p>
            </>
          }
          labelYa="Ya, hapus"
          sibuk={busyMaster}
          onBatal={() => setHapusTarget(null)}
          onKonfirmasi={() => void konfirmasiHapusPihak()}
        />
      )}
    </div>
  );
}
