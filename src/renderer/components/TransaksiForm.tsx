import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AKUN_MODAL, isAkunKas, type Coa } from '../../db/coa.js';
import {
  buatJurnalBayar,
  buatJurnalPindahDana,
  buatJurnalTerimaUang,
  type DasarFormJurnal,
} from '../../core/forms.js';
import { tanggalKalenderValid, type JurnalInput } from '../../core/posting.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api, isPerluAlasan, isPerluKonfirmasi } from '../lib/api.js';
import {
  adalahErrorSaldoAwal,
  opsiSaldoAwal,
  tandaiMulaiTanpaSaldoAwal,
} from '../lib/saldoAwal.js';
import { useTabGuard } from '../lib/tabGuard.js';
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
import { SaldoAwalGuard } from './SaldoAwalGuard.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';
import {
  PESAN_PROSES_GAGAL,
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
} from '../../utils/pesanError.js';

/** Jenis transaksi yang sudah punya form terpandu. */
export type JenisFormTransaksi = 'TERIMA' | 'BAYAR' | 'PINDAH';

/** Kolom yang sama untuk Terima Uang & Bayar (kas + akun lawan). */
type FormTransaksi = DasarFormJurnal & {
  akunKas: string;
  akunLawan: string;
};

/** Nilai mentah form; dipetakan ke builder sesuai jenis transaksi. */
type NilaiForm = {
  tanggal: string;
  akunKas: string;
  akunLawan: string;
  akunKe: string;
  nominal: number;
  keterangan: string;
  noBukti?: string;
  alasan?: string;
};

type GrupAkun = { label: string; akun: Coa[] };

type KonfigurasiDasar = {
  judul: string;
  deskripsi: string;
  placeholderKeterangan: string;
  /** Dipakai pratinjau saat keterangan masih kosong (simpan tetap wajib isi). */
  keteranganPratinjau: string;
  labelTombol: string;
};

type KonfigurasiKasLawan = KonfigurasiDasar & {
  mode: 'KAS_LAWAN';
  labelKas: string;
  labelLawan: string;
  hintLawan: string;
  labelKasBaris: string;
  labelLawanBaris: string;
  /** Posisi akun kas di baris jurnal: kas bisa di debit (Terima) atau kredit (Bayar). */
  posisiKas: 'DEBIT' | 'KREDIT';
  buat: (form: FormTransaksi) => JurnalInput;
  grupLawan: (coa: Coa[]) => GrupAkun[];
  akunLawanAwal: (coa: Coa[]) => string;
  infoTambahan?: string;
};

type KonfigurasiPindah = KonfigurasiDasar & {
  mode: 'PINDAH';
};

type KonfigurasiForm = KonfigurasiKasLawan | KonfigurasiPindah;


/** Pilihan awal akun lawan Bayar: 5010/5000, lalu beban pertama. */
function akunLawanAwalBayar(coa: Coa[]): string {
  const beban = coa.filter((a) => a.tipe === 'BEBAN' && a.aktif !== false);
  return (
    beban.find((a) => a.kode === '5010')?.kode ??
    beban.find((a) => a.kode === '5000')?.kode ??
    beban[0]?.kode ??
    ''
  );
}

const KONFIG: Record<JenisFormTransaksi, KonfigurasiForm> = {
  TERIMA: {
    mode: 'KAS_LAWAN',
    judul: 'Terima Uang',
    deskripsi:
      'Catat uang yang masuk ke kas atau bank. Isi sumber uangnya — pendapatan usaha/punia, atau setoran modal.',
    labelKas: 'Uang masuk ke',
    labelLawan: 'Sumber uang',
    hintLawan:
      'Pilih akun pendapatan. Bila uangnya setoran modal, pilih 3000 MODAL.',
    placeholderKeterangan: 'cth: Pendapatan parkir bulan Oktober',
    keteranganPratinjau: 'Transaksi harian',
    labelTombol: 'Simpan Transaksi',
    labelKasBaris: 'Uang masuk',
    labelLawanBaris: 'Sumber',
    posisiKas: 'DEBIT',
    buat: buatJurnalTerimaUang,
    grupLawan: (coa) => {
      const pendapatan = coa.filter((a) => a.tipe === 'PENDAPATAN' && a.aktif !== false);
      const modal = coa.find((a) => a.kode === AKUN_MODAL);
      const grup: GrupAkun[] = [];
      if (pendapatan.length > 0) grup.push({ label: 'Pendapatan', akun: pendapatan });
      if (modal) grup.push({ label: 'Setoran modal', akun: [modal] });
      return grup;
    },
    akunLawanAwal: (coa) =>
      (coa.find((a) => a.tipe === 'PENDAPATAN' && a.aktif !== false) ??
        coa.find((a) => a.kode === AKUN_MODAL))?.kode ?? '',
  },
  BAYAR: {
    mode: 'KAS_LAWAN',
    judul: 'Bayar / Beban',
    deskripsi:
      'Catat uang yang keluar dari kas atau bank untuk belanja atau biaya. Sistem menyusun jurnalnya otomatis.',
    labelKas: 'Uang keluar dari',
    labelLawan: 'Untuk pembayaran',
    hintLawan:
      'Pilih akun beban untuk belanja/biaya. Untuk panjar gunakan menu Buku Panjar; untuk piutang/hutang gunakan menu Piutang & Hutang.',
    placeholderKeterangan: 'cth: Bayar listrik bulan Oktober',
    keteranganPratinjau: 'Transaksi harian',
    labelTombol: 'Simpan Transaksi',
    labelKasBaris: 'Uang keluar',
    labelLawanBaris: 'Pembayaran',
    posisiKas: 'KREDIT',
    buat: buatJurnalBayar,
    grupLawan: (coa) => {
      const beban = coa.filter((a) => a.tipe === 'BEBAN' && a.aktif !== false);
      return beban.length > 0 ? [{ label: 'Beban', akun: beban }] : [];
    },
    akunLawanAwal: akunLawanAwalBayar,
    infoTambahan: 'Pagu anggaran diatur di menu Anggaran.',
  },
  PINDAH: {
    mode: 'PINDAH',
    judul: 'Pindah Dana',
    deskripsi:
      'Pindahkan uang antar dompet kas/bank — misalnya dari LPD ke Kas Bendahara. Total kas tidak berubah; hanya saldo tiap dompet yang berpindah.',
    placeholderKeterangan: 'cth: Pindah kas LPD ke Kas Bendahara',
    keteranganPratinjau: 'Pindah dana',
    labelTombol: 'Simpan Pindah Dana',
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
  const pindah = konfigurasi.mode === 'PINDAH';
  const kasAwal = coa.find((a) => isAkunKas(a.kode) && a.aktif !== false)?.kode ?? '';
  const { setDirty } = useTabGuard();

  // UI-07: isian yang ditinggalkan hanya boleh menandai tab ini kotor. Saat
  // form di-unmount (pindah tab/ganti jenis), bersihkan agar tidak bocor.
  useEffect(() => () => setDirty(false), [setDirty]);

  const [tanggal, setTanggal] = useState(tanggalLokal());
  const [akunKas, setAkunKas] = useState(kasAwal);
  const [akunLawan, setAkunLawan] = useState(() =>
    konfigurasi.mode === 'KAS_LAWAN' ? konfigurasi.akunLawanAwal(coa) : '',
  );
  const [akunKe, setAkunKe] = useState(
    () =>
      coa.find((a) => isAkunKas(a.kode) && a.aktif !== false && a.kode !== kasAwal)?.kode ?? '',
  );
  const [nominal, setNominal] = useState(0);
  const [keterangan, setKeterangan] = useState('');
  const [noBukti, setNoBukti] = useState('');

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  // UI-13: penanda agar ringkasan error tetap difokuskan walau pesannya sama.
  const [errorSeq, setErrorSeq] = useState(0);
  const [info, setInfo] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    tone: 'success' | 'error';
    pesan: string;
  } | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const nominalRef = useRef<HTMLDivElement | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const [saldoAwalOpen, setSaldoAwalOpen] = useState(false);
  const saldoAwalPendingRef = useRef<{
    alasan?: string;
    konfirmasi?: boolean;
  }>({});

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  // Pesan detail tetap di atas form. Saat gagal, pindahkan fokus ke ringkasan
  // itu agar pengguna yang berada di dekat tombol simpan langsung membacanya.
  useEffect(() => {
    if (!err) return;
    const ringkasan = errorRef.current;
    if (!ringkasan) return;
    ringkasan.focus({ preventScroll: true });
    ringkasan.scrollIntoView({ block: 'center' });
  }, [err, errorSeq]);

  // COA dimuat async oleh TransaksiTab. Isi pilihan awal saat datanya tiba,
  // tanpa menimpa pilihan yang sudah dibuat operator.
  useEffect(() => {
    const kasAktif = coa.filter((a) => isAkunKas(a.kode) && a.aktif !== false);
    const kasPertama = kasAktif[0]?.kode ?? '';
    setAkunKas((sebelum) =>
      kasAktif.some((a) => a.kode === sebelum) ? sebelum : kasPertama,
    );
    if (konfigurasi.mode === 'KAS_LAWAN') {
      const pilihan = konfigurasi.grupLawan(coa).flatMap((g) => g.akun);
      const lawanAwal = konfigurasi.akunLawanAwal(coa);
      setAkunLawan((sebelum) =>
        pilihan.some((a) => a.kode === sebelum) ? sebelum : lawanAwal,
      );
    } else {
      const tujuanAwal =
        kasAktif.find((a) => a.kode !== kasPertama)?.kode ?? '';
      setAkunKe((sebelum) =>
        kasAktif.some((a) => a.kode === sebelum) ? sebelum : tujuanAwal,
      );
    }
  }, [coa, konfigurasi]);

  const kasList = useMemo(
    () => coa.filter((a) => isAkunKas(a.kode) && a.aktif !== false),
    [coa],
  );
  const grupLawan = useMemo(
    () => (konfigurasi.mode === 'KAS_LAWAN' ? konfigurasi.grupLawan(coa) : []),
    [coa, konfigurasi],
  );
  const namaAkun = useMemo(
    () => new Map(coa.map((a) => [a.kode, `${a.kode} — ${a.nama}`])),
    [coa],
  );
  const labelAkun = (kode: string): string => namaAkun.get(kode) ?? kode;

  const susunJurnal = useCallback(
    (nilai: NilaiForm): JurnalInput => {
      if (konfigurasi.mode === 'PINDAH') {
        return buatJurnalPindahDana({
          tanggal: nilai.tanggal,
          dari: nilai.akunKas,
          ke: nilai.akunKe,
          nominal: nilai.nominal,
          keterangan: nilai.keterangan,
          daftarAkun: coa,
          ...(nilai.noBukti ? { noBukti: nilai.noBukti } : {}),
          ...(nilai.alasan ? { alasan: nilai.alasan } : {}),
        });
      }
      return konfigurasi.buat({
        tanggal: nilai.tanggal,
        akunKas: nilai.akunKas,
        akunLawan: nilai.akunLawan,
        nominal: nilai.nominal,
        keterangan: nilai.keterangan,
        daftarAkun: coa,
        ...(nilai.noBukti ? { noBukti: nilai.noBukti } : {}),
        ...(nilai.alasan ? { alasan: nilai.alasan } : {}),
      });
    },
    [coa, konfigurasi],
  );

  // Pratinjau memakai builder yang sama dengan yang dipakai saat menyimpan.
  const pratinjau = useMemo(() => {
    if (!tanggalKalenderValid(tanggal))
      return { input: null as JurnalInput | null, error: PESAN_TANGGAL_TIDAK_VALID };
    if (pindah) {
      if (!akunKas || !akunKe)
        return { input: null as JurnalInput | null, error: null };
    } else if (!akunKas || !akunLawan) {
      return { input: null as JurnalInput | null, error: null };
    }
    if (!Number.isInteger(nominal) || nominal <= 0)
      return { input: null as JurnalInput | null, error: null };
    try {
      return {
        input: susunJurnal({
          tanggal,
          akunKas,
          akunLawan,
          akunKe,
          nominal,
          // Keterangan boleh belum diisi saat pratinjau; saat simpan wajib.
          keterangan: keterangan.trim() || konfigurasi.keteranganPratinjau,
        }),
        error: null,
      };
    } catch (e) {
      return {
        input: null as JurnalInput | null,
        error: pesanError(e, PESAN_PROSES_GAGAL),
      };
    }
  }, [
    akunKas,
    akunKe,
    akunLawan,
    keterangan,
    konfigurasi.keteranganPratinjau,
    nominal,
    pindah,
    susunJurnal,
    tanggal,
  ]);

  const totalDebit = pratinjau.input?.baris.reduce((s, b) => s + b.debit, 0) ?? 0;
  const totalKredit = pratinjau.input?.baris.reduce((s, b) => s + b.kredit, 0) ?? 0;

  const akunLengkap = pindah
    ? Boolean(akunKas && akunKe && akunKas !== akunKe)
    : Boolean(akunKas && akunLawan);
  const formSah =
    tanggalKalenderValid(tanggal) &&
    akunLengkap &&
    Number.isInteger(nominal) &&
    nominal > 0 &&
    Boolean(keterangan.trim());

  const labelBaris = (i: number): string => {
    if (konfigurasi.mode === 'PINDAH') {
      const tujuan = `Tujuan (masuk) — ${labelAkun(akunKe)}`;
      const asal = `Asal (keluar) — ${labelAkun(akunKas)}`;
      return i === 0 ? tujuan : asal;
    }
    const kas = `${konfigurasi.labelKasBaris} — ${labelAkun(akunKas)}`;
    const lawan = `${konfigurasi.labelLawanBaris} — ${labelAkun(akunLawan)}`;
    const kasDiBarisIni = konfigurasi.posisiKas === 'DEBIT' ? i === 0 : i === 1;
    return kasDiBarisIni ? kas : lawan;
  };

  function tampilkanToast(berikut: {
    tone: 'success' | 'error';
    pesan: string;
  }): void {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast(berikut);
    if (berikut.tone === 'success') {
      toastTimerRef.current = setTimeout(() => {
        setToast(null);
        toastTimerRef.current = null;
      }, 6_000);
    }
  }

  // Error tetap ditampilkan lengkap di ringkasan atas; toast hanya penanda
  // visual singkat (tanpa live-region) agar tidak diumumkan dua kali.
  function tampilkanError(pesan: string): void {
    setErr(pesan);
    setErrorSeq((n) => n + 1);
    tampilkanToast({
      tone: 'error',
      pesan: 'Gagal menyimpan. Lihat detail di atas.',
    });
  }

  async function simpan(
    opsi: {
      alasan?: string;
      konfirmasi?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ): Promise<void> {
    if (busyRef.current) return;
    setErr(null);
    setInfo(null);
    setPesanKonfirmasi(null);
    setLockOpen(false);
    setSaldoAwalOpen(false);
    setToast(null);
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    if (!formSah) {
      tampilkanError('Lengkapi tanggal, akun, nominal, dan keterangan terlebih dahulu.');
      return;
    }

    let input: JurnalInput;
    try {
      input = susunJurnal({
        tanggal,
        akunKas,
        akunLawan,
        akunKe,
        nominal,
        keterangan: keterangan.trim(),
        noBukti: noBukti.trim(),
        ...(opsi.alasan ? { alasan: opsi.alasan } : {}),
      });
    } catch (e) {
      tampilkanError(pesanError(e));
      return;
    }

    const nominalTersimpan = nominal;
    saldoAwalPendingRef.current = {
      ...(opsi.alasan ? { alasan: opsi.alasan } : {}),
      ...(opsi.konfirmasi ? { konfirmasi: true } : {}),
    };
    busyRef.current = true;
    setBusy(true);
    try {
      const hasil = await api.jurnalPosting(input, {
        konfirmasiPeringatan: opsi.konfirmasi === true,
        ...opsiSaldoAwal(opsi.konfirmasiTanpaSaldoAwal === true),
      });
      const nomorTersimpan = hasil.jurnal.no_bukti;
      setInfo(
        `${pindah ? 'Pindah Dana' : 'Transaksi'} ${formatTanggal(tanggal)} tersimpan${nomorTersimpan ? ` (${nomorTersimpan})` : ''} — ${formatRp(nominalTersimpan)}. Jurnal otomatis sudah dibuat.`,
      );
      tampilkanToast({
        tone: 'success',
        pesan: pindah ? 'Pindah Dana tersimpan.' : 'Transaksi tersimpan.',
      });
      // Tanggal & akun tetap; hanya isian yang mudah berulang yang dikosongkan.
      setNominal(0);
      setKeterangan('');
      setNoBukti('');
      // UI-07: simpan sukses = tidak ada isian yang perlu diperingatkan.
      setDirty(false);
      // UI-13: fokuskan Nominal setelah reset ter-commit agar entri berikutnya
      // bisa langsung diketik. Dua rAF memberi ruang commit React + paint.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          nominalRef.current?.querySelector('input')?.focus();
        });
      });
    } catch (e) {
      if (adalahErrorSaldoAwal(e)) {
        setSaldoAwalOpen(true);
      } else if (isPerluAlasan(e)) {
        setLockOpen(true);
      } else if (isPerluKonfirmasi(e) && !opsi.konfirmasi) {
        setPesanKonfirmasi(pesanError(e));
      } else {
        tampilkanError(pesanError(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function mulaiTanpaSaldoAwal(): void {
    tandaiMulaiTanpaSaldoAwal();
    setSaldoAwalOpen(false);
    void simpan({
      ...saldoAwalPendingRef.current,
      konfirmasiTanpaSaldoAwal: true,
    });
  }

  function saldoAwalTersimpan(_pesan: string): void {
    setSaldoAwalOpen(false);
    // Saldo awal sudah tersimpan; ulangi penyimpanan transaksi yang tertunda.
    void simpan(saldoAwalPendingRef.current);
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
        <div className="flex flex-wrap gap-2">
          <Badge tone="green">Jurnal otomatis seimbang</Badge>
          {pindah && <Badge tone="amber">Total kas tetap</Badge>}
        </div>
      </div>

      <div
        ref={errorRef}
        tabIndex={-1}
        className="mt-3 scroll-mt-24 focus:outline-none"
      >
        <ErrorBox msg={err} />
      </div>
      {info && (
        <div
          role="status"
          className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800"
        >
          {info}
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="Tanggal">
          <TextInput
            type="date"
            value={tanggal}
            disabled={busy}
            onChange={(e) => {
              setTanggal(e.target.value);
              setDirty(true);
            }}
          />
        </Field>

        {konfigurasi.mode === 'PINDAH' ? (
          <>
            <Field label="Dari">
              <Select
                value={akunKas}
                disabled={busy || memuat}
                onChange={(e) => {
                  setAkunKas(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="">— Pilih kas / bank —</option>
                {kasList.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.kode} — {a.nama}
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-helper text-stone-500">
                Dompet asal — uang keluar dari akun ini.
              </span>
            </Field>

            <Field label="Ke">
              <Select
                value={akunKe}
                disabled={busy || memuat}
                onChange={(e) => {
                  setAkunKe(e.target.value);
                  setDirty(true);
                }}
              >
                <option value="">— Pilih kas / bank —</option>
                {kasList.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.kode} — {a.nama}
                  </option>
                ))}
              </Select>
              <span className="mt-1 block text-helper text-stone-500">
                Dompet tujuan — uang masuk ke akun ini. Total kas tidak berubah.
              </span>
              {akunKas && akunKe && akunKas === akunKe && (
                <span className="mt-1 block text-helper text-red-700">
                  Akun Dari dan Ke harus berbeda — pilih dua dompet kas/bank
                  yang berbeda.
                </span>
              )}
            </Field>
          </>
        ) : (
          <>
            <Field label={konfigurasi.labelKas}>
              <Select
                value={akunKas}
                disabled={busy || memuat}
                onChange={(e) => {
                  setAkunKas(e.target.value);
                  setDirty(true);
                }}
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
                onChange={(e) => {
                  setAkunLawan(e.target.value);
                  setDirty(true);
                }}
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
              <span className="mt-1 block text-helper text-stone-500">
                {konfigurasi.hintLawan}
              </span>
              {konfigurasi.infoTambahan && (
                <span className="mt-1 block text-helper text-stone-500">
                  {konfigurasi.infoTambahan}
                </span>
              )}
            </Field>
          </>
        )}

        <Field label="Nominal">
          <div ref={nominalRef}>
            <CurrencyInput
              value={nominal}
              onChange={(nilai) => {
                setNominal(nilai);
                setDirty(true);
              }}
            />
          </div>
        </Field>

        <Field label="Keterangan">
          <TextInput
            value={keterangan}
            disabled={busy}
            placeholder={konfigurasi.placeholderKeterangan}
            onChange={(e) => {
              setKeterangan(e.target.value);
              setDirty(true);
            }}
          />
        </Field>

        <div>
          <Field label="No. bukti (opsional)">
            <TextInput
              value={noBukti}
              disabled={busy}
              placeholder="cth: JU-2026-0001 — boleh dikosongkan"
              onChange={(e) => {
                setNoBukti(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <SaranNomorBukti tanggal={tanggal} />
        </div>
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
        {pindah && (
          <p className="mt-1 text-sm text-stone-600">
            Debit = dompet tujuan, kredit = dompet asal. Total kas tidak berubah.
          </p>
        )}

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
          {busy ? 'Menyimpan…' : konfigurasi.labelTombol}
        </Button>
        <span className="text-sm text-stone-500">
          Setelah tersimpan, transaksi langsung masuk ke laporan dari jurnal.
        </span>
      </div>

      {/* Toast visual ringkas agar terlihat dari dasar form. Live-region tetap
          hanya satu: info detail di atas (status) dan ErrorBox (alert). */}
      {toast && (
        <div
          data-testid="transaksi-toast"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-30 flex justify-end px-4"
        >
          <div
            className={`max-w-sm rounded-lg border px-3 py-2 text-[15px] font-semibold shadow-lg ${
              toast.tone === 'success'
                ? 'border-green-300 bg-green-50 text-green-800'
                : 'border-red-300 bg-red-50 text-red-800'
            }`}
          >
            {toast.pesan}
          </div>
        </div>
      )}

      {lockOpen && (
        <LockModal
          onCancel={() => setLockOpen(false)}
          onSubmit={(alasan) => {
            setLockOpen(false);
            void simpan({ ...saldoAwalPendingRef.current, alasan });
          }}
        />
      )}

      <SaldoAwalGuard
        terbuka={saldoAwalOpen}
        coa={coa}
        sibuk={busy}
        onBatal={() => setSaldoAwalOpen(false)}
        onMulaiTanpa={mulaiTanpaSaldoAwal}
        onSaldoAwalTersimpan={saldoAwalTersimpan}
      />
    </Card>
  );
}
