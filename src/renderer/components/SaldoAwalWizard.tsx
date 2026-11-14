import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { AKUN_MODAL, isAkunKasData, type Coa } from '../../db/coa.js';
import { buatJurnalSaldoAwal, type FormSaldoAwal } from '../../core/forms.js';
import { tanggalKalenderValid } from '../../core/posting.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api, isPerluAlasan, isPerluKonfirmasi } from '../lib/api.js';
import {
  PESAN_ALASAN_PERINGATAN_MIN,
  alasanPeringatanCukup,
  opsiPeringatanApi,
  rapikanAlasanPeringatan,
} from '../lib/peringatan.js';
import {
  ALASAN_SIBUK,
  Badge,
  Button,
  CurrencyInput,
  ErrorBox,
  Field,
  KonfirmasiModal,
  LockModal,
  Modal,
  PeringatanModal,
  Select,
  TextInput,
} from './ui.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';
import {
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
} from '../../utils/pesanError.js';

type BarisSaldo = {
  key: number;
  akun: string;
  nominal: number;
};

type GrupAkun = {
  label: string;
  akun: Coa[];
};

/** Prefill dari `saldo-awal:saat-ini` saat wizard dipakai untuk koreksi. */
export type SaldoAwalPrefill = {
  tanggal: string;
  saldo: { akun_kode: string; nominal: number }[];
  keterangan?: string;
};

export const MIN_ALASAN_KOREKSI = 5;
export const PESAN_ALASAN_KOREKSI_MIN =
  'Alasan koreksi wajib diisi minimal 5 karakter.';

/** Tanggal default wizard: hari ini (atau tanggal saldo aktif), dijepit ke batas. */
function tanggalAwalWizard(
  tanggalMaksimal?: string,
  tanggalSaldoAwal?: string,
): string {
  const tanggalAktif = String(tanggalSaldoAwal ?? '').trim();
  if (tanggalKalenderValid(tanggalAktif)) return tanggalAktif;
  const hariIni = tanggalLokal();
  const maks = String(tanggalMaksimal ?? '').trim();
  return tanggalKalenderValid(maks) && hariIni > maks ? maks : hariIni;
}

/** Baris awal wizard: prefill saldo aktif bila ada, atau satu baris kosong. */
function barisAwalWizard(
  saldo: SaldoAwalPrefill['saldo'] | undefined,
  akunAwal: string,
): BarisSaldo[] {
  const rows = (saldo ?? [])
    .map((s, i) => ({
      key: i + 1,
      akun: String(s?.akun_kode ?? '').trim(),
      nominal: Number(s?.nominal ?? 0),
    }))
    .filter(
      (r) =>
        r.akun !== '' &&
        Number.isSafeInteger(r.nominal) &&
        r.nominal > 0,
    );
  return rows.length > 0 ? rows : [{ key: 1, akun: akunAwal, nominal: 0 }];
}

/** T3.8: alasan tombol Simpan nonaktif, dipakai sebagai title + teks terlihat. */
export function alasanSimpanSaldoAwal(opsi: {
  busy: boolean;
  formSah: boolean;
  modeKoreksi: boolean;
  alasanKoreksiCukup: boolean;
}): string | undefined {
  if (opsi.busy) return ALASAN_SIBUK;
  if (opsi.formSah && (!opsi.modeKoreksi || opsi.alasanKoreksiCukup)) {
    return undefined;
  }
  if (opsi.modeKoreksi && !opsi.alasanKoreksiCukup) {
    return PESAN_ALASAN_KOREKSI_MIN;
  }
  return 'Isi minimal satu saldo lebih dari 0 dan tanggal yang valid.';
}

/**
 * T3.8: konfirmasi simpan/koreksi saldo awal. Menjelaskan apa yang berubah,
 * apa yang tetap, dan langkah berikutnya bila hasilnya perlu diperbaiki.
 */
export function KonfirmasiSimpanSaldoAwal({
  mode,
  tanggal,
  total,
  sibuk = false,
  onBatal,
  onKonfirmasi,
}: {
  mode: 'awal' | 'koreksi';
  tanggal: string;
  total: number;
  sibuk?: boolean;
  onBatal: () => void;
  onKonfirmasi: () => void;
}) {
  const koreksi = mode === 'koreksi';
  return (
    <KonfirmasiModal
      judul={koreksi ? 'Simpan koreksi saldo awal?' : 'Simpan saldo awal sekarang?'}
      deskripsi={
        <>
          <p>
            {koreksi ? (
              <>
                Saldo awal per <b>{formatTanggal(tanggal)}</b> akan dikoreksi
                menjadi total <b>{formatRp(total)}</b>. Sistem membuat jurnal
                balik untuk jurnal pembukaan aktif, lalu jurnal penyesuaian baru.
              </>
            ) : (
              <>
                Satu jurnal saldo awal seimbang sebesar{' '}
                <b>{formatRp(total)}</b> per <b>{formatTanggal(tanggal)}</b> akan
                dibuat.
              </>
            )}
          </p>
          <p>
            <b>Yang berubah:</b> laporan dan saldo akun mengikuti jurnal baru.{' '}
            <b>Yang tetap:</b> jurnal lama tidak dihapus dan tetap tersimpan di
            audit; koreksi berikutnya juga membuat jurnal balik, bukan mengedit
            jurnal lama.
          </p>
          <p className="text-sm text-stone-600">
            {koreksi
              ? 'Bila hasilnya masih keliru, buka Koreksi Saldo Awal lagi dan isi alasan baru.'
              : 'Setelah tersimpan, wizard saldo awal terkunci. Bila ada kekeliruan, gunakan tombol Koreksi Saldo Awal dengan alasan; jurnal lama tetap tersimpan.'}
          </p>
        </>
      }
      labelYa={koreksi ? 'Ya, simpan koreksi' : 'Ya, simpan saldo awal'}
      sibuk={sibuk}
      onBatal={onBatal}
      onKonfirmasi={onKonfirmasi}
    />
  );
}

/**
 * Wizard Saldo Awal (P1-6) — dipakai sekali saat mulai pembukuan nyata.
 *
 * Operator mengisi saldo per akun, bukan debit/kredit. Selisih aktiva −
 * kewajiban otomatis menjadi baris 3000 MODAL sehingga pratinjau selalu satu
 * jurnal seimbang. Simpan hanya mengirim form mentah; main menyusun ulang
 * jurnal dengan builder yang sama dan adapter DB memastikan saldo awal belum
 * pernah dibuat serta tanggalnya tidak setelah jurnal paling awal.
 */
export function SaldoAwalWizard({
  coa,
  tanggalMaksimal,
  mode = 'awal',
  saldoAwal,
  onClose,
  onSukses,
}: {
  coa: Coa[];
  /** AUD2-02: batas atas tanggal (jurnal paling awal); kosong = belum ada jurnal. */
  tanggalMaksimal?: string;
  /** T1.8: `koreksi` memakai reverse-and-repost jurnal lama, bukan edit biasa. */
  mode?: 'awal' | 'koreksi';
  /** T1.8: prefill tanggal/saldo/keterangan saat mode koreksi. */
  saldoAwal?: SaldoAwalPrefill;
  onClose: () => void;
  onSukses: (pesan: string) => void;
}) {
  const modeKoreksi = mode === 'koreksi';
  // DB-15: dropdown hanya menawarkan akun aktif. Akun yang dinonaktifkan tetap
  // tersedia di histori/laporan, tetapi bukan untuk jurnal saldo awal baru.
  const akunAktif = useMemo(() => coa.filter((a) => a.aktif !== false), [coa]);
  const batasTanggal = useMemo(() => {
    const maks = String(tanggalMaksimal ?? '').trim();
    return tanggalKalenderValid(maks) ? maks : undefined;
  }, [tanggalMaksimal]);
  const akunRelevan = useMemo(
    () =>
      akunAktif.filter((a) => a.tipe === 'AKTIVA' || a.tipe === 'KEWAJIBAN'),
    [akunAktif],
  );
  const akunAwal =
    akunRelevan.find((a) => a.kode === '1001')?.kode ??
    akunRelevan.find((a) => isAkunKasData(a))?.kode ??
    akunRelevan[0]?.kode ??
    '';

  const barisAwal = useMemo(
    () => barisAwalWizard(saldoAwal?.saldo, akunAwal),
    [saldoAwal, akunAwal],
  );
  const keyRef = useRef(barisAwal.length + 1);
  const [tanggal, setTanggal] = useState(() =>
    tanggalAwalWizard(tanggalMaksimal, modeKoreksi ? saldoAwal?.tanggal : undefined),
  );
  const [rows, setRows] = useState<BarisSaldo[]>(barisAwal);
  const [keterangan, setKeterangan] = useState(saldoAwal?.keterangan ?? '');
  const [noBukti, setNoBukti] = useState('');
  /** T1.8: alasan koreksi wajib; terpisah dari alasan kunci periode/peringatan. */
  const [alasanKoreksi, setAlasanKoreksi] = useState('');

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const [errorKonfirmasi, setErrorKonfirmasi] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [konfirmasiSimpan, setKonfirmasiSimpan] = useState(false);
  /** UI-A12: konfirmasi buang isian saat menutup wizard yang sudah diisi. */
  const [konfirmasiTutup, setKonfirmasiTutup] = useState(false);
  /** AKT-07: alasan kunci periode dan alasan peringatan dipisah. */
  const alasanPeriodeRef = useRef('');
  const alasanPeringatanRef = useRef('');
  const konfirmasiPendingRef = useRef<{ konfirmasi?: boolean }>({});

  // COA dimuat async oleh TransaksiTab; isi baris pertama bila baru tiba.
  useEffect(() => {
    if (!akunAwal) return;
    setRows((prev) => prev.map((r) => (r.akun ? r : { ...r, akun: akunAwal })));
  }, [akunAwal]);

  // Bila batas tanggal tiba setelah wizard terbuka, jepit tanggal yang sudah
  // terlanjur melewati batas agar tombol simpan tidak mengirim isian mustahil.
  useEffect(() => {
    if (!batasTanggal) return;
    setTanggal((prev) =>
      tanggalKalenderValid(prev) && prev > batasTanggal ? batasTanggal : prev,
    );
  }, [batasTanggal]);

  const grupAkun = useMemo<GrupAkun[]>(() => {
    const kas = akunRelevan.filter((a) => isAkunKasData(a));
    const asetLain = akunRelevan.filter(
      (a) => a.tipe === 'AKTIVA' && !isAkunKasData(a),
    );
    const kewajiban = akunRelevan.filter((a) => a.tipe === 'KEWAJIBAN');
    const grup: GrupAkun[] = [];
    if (kas.length > 0) grup.push({ label: 'Kas / Bank', akun: kas });
    if (asetLain.length > 0)
      grup.push({ label: 'Aset lain', akun: asetLain });
    if (kewajiban.length > 0) grup.push({ label: 'Utang', akun: kewajiban });
    return grup;
  }, [akunRelevan]);

  const hasil = useMemo(() => {
    if (!tanggalKalenderValid(tanggal))
      return {
        data: null as ReturnType<typeof buatJurnalSaldoAwal> | null,
        error: PESAN_TANGGAL_TIDAK_VALID,
      };
    if (batasTanggal && tanggal > batasTanggal)
      return {
        data: null as ReturnType<typeof buatJurnalSaldoAwal> | null,
        error: `Tanggal saldo awal (${tanggal}) tidak boleh setelah transaksi paling awal (${batasTanggal}).`,
      };
    const saldo = rows.map((r) => ({ akun_kode: r.akun, nominal: r.nominal }));
    if (!saldo.some((s) => Number.isInteger(s.nominal) && s.nominal > 0))
      return {
        data: null as ReturnType<typeof buatJurnalSaldoAwal> | null,
        error: null,
      };
    try {
      return {
        data: buatJurnalSaldoAwal({
          tanggal,
          saldo,
          daftarAkun: akunAktif,
          ...(keterangan.trim() ? { keterangan: keterangan.trim() } : {}),
          ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
        }),
        error: null,
      };
    } catch (e) {
      return {
        data: null as ReturnType<typeof buatJurnalSaldoAwal> | null,
        error: pesanError(e),
      };
    }
  }, [tanggal, rows, keterangan, noBukti, akunAktif, batasTanggal]);

  const formSah = Boolean(hasil.data);
  const alasanKoreksiBersih = alasanKoreksi.trim();
  const alasanKoreksiCukup =
    alasanKoreksiBersih.length >= MIN_ALASAN_KOREKSI;
  const bolehSimpan =
    formSah && (!modeKoreksi || alasanKoreksiCukup);
  const totalSaldoAwal = hasil.data
    ? hasil.data.input.baris.reduce((s, b) => s + b.debit, 0)
    : 0;
  const alasanSimpanTidakAktif = alasanSimpanSaldoAwal({
    busy,
    formSah,
    modeKoreksi,
    alasanKoreksiCukup,
  });

  const labelAkun = (kode: string): string => {
    if (kode === AKUN_MODAL) return '3000 — MODAL (penyeimbang otomatis)';
    const a = coa.find((x) => x.kode === kode);
    return a ? `${a.kode} — ${a.nama}` : kode;
  };

  /**
   * UI-A12: definisi "wizard berisi isian yang akan hilang". Nilai bawaan
   * (baris kas pertama bernominal 0, tanggal jangkar, prefill koreksi yang
   * berasal dari saldo tersimpan) tidak dihitung sebagai isian; hanya
   * perubahan operator yang menghitung, sehingga menutup wizard yang baru
   * dibuka tanpa disentuh tidak menimbulkan konfirmasi palsu.
   */
  const adaIsianSaldoAwal = useMemo(() => {
    if (alasanKoreksi.trim() !== '') return true;
    if (noBukti.trim() !== '') return true;
    if (keterangan.trim() !== (saldoAwal?.keterangan ?? '').trim()) return true;
    // Bandingkan dengan nilai bawaan yang dihitung ulang (bukan snapshot saat
    // mount) agar penjepitan tanggal yang terlambat tiba tidak dianggap isian.
    if (
      tanggal !==
      tanggalAwalWizard(
        tanggalMaksimal,
        modeKoreksi ? saldoAwal?.tanggal : undefined,
      )
    )
      return true;
    const isi = rows.map((r) => ({ akun: r.akun, nominal: r.nominal }));
    const dasar = barisAwal.map((r) => ({ akun: r.akun, nominal: r.nominal }));
    return JSON.stringify(isi) !== JSON.stringify(dasar);
  }, [
    alasanKoreksi,
    noBukti,
    keterangan,
    saldoAwal,
    tanggal,
    tanggalMaksimal,
    modeKoreksi,
    rows,
    barisAwal,
  ]);

  function mintaTutup(): void {
    if (busyRef.current) return;
    if (adaIsianSaldoAwal) {
      setKonfirmasiTutup(true);
      return;
    }
    onClose();
  }

  function tambahBaris(): void {
    const dipakai = new Set(rows.map((r) => r.akun));
    const berikut =
      akunRelevan.find((a) => !dipakai.has(a.kode))?.kode ??
      akunRelevan[0]?.kode ??
      '';
    setRows((prev) => [
      ...prev,
      { key: keyRef.current++, akun: berikut, nominal: 0 },
    ]);
  }

  function hapusBaris(key: number): void {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  async function simpan(
    opsi: {
      alasan?: string;
      alasanPeringatan?: string;
      konfirmasi?: boolean;
    } = {},
  ): Promise<void> {
    if (busyRef.current) return;
    setErr(null);
    // Modal konfirmasi tetap terbuka saat mengirim alasan agar penolakan
    // backend dapat ditampilkan dan diperbaiki tanpa mengulang dari awal.
    if (opsi.konfirmasi !== true) {
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
    }
    setLockOpen(false);

    if (modeKoreksi && !alasanKoreksiCukup) {
      setErr(PESAN_ALASAN_KOREKSI_MIN);
      return;
    }

    if (!formSah || !hasil.data) {
      setErr(
        'Isi minimal satu saldo dengan nominal lebih dari 0, lalu periksa tanggal mulai pembukuan.',
      );
      return;
    }

    // AKT-07: dua alasan berbeda — kunci periode (`alasan`) dan peringatan
    // (`alasanPeringatan`) — dipertahankan bersama selama retry.
    const alasanPeriode = rapikanAlasanPeringatan(
      opsi.alasan ?? alasanPeriodeRef.current,
    );
    if (opsi.alasan) alasanPeriodeRef.current = opsi.alasan;
    const alasanPeringatan = rapikanAlasanPeringatan(
      opsi.alasanPeringatan ?? alasanPeringatanRef.current,
    );
    if (opsi.alasanPeringatan) alasanPeringatanRef.current = opsi.alasanPeringatan;

    if (opsi.konfirmasi === true && !alasanPeringatanCukup(alasanPeringatan)) {
      setPesanKonfirmasi((sebelum) => sebelum ?? PESAN_ALASAN_PERINGATAN_MIN);
      setErrorKonfirmasi(PESAN_ALASAN_PERINGATAN_MIN);
      return;
    }

    const form: FormSaldoAwal = {
      tanggal,
      saldo: rows.map((r) => ({ akun_kode: r.akun, nominal: r.nominal })),
      ...(keterangan.trim() ? { keterangan: keterangan.trim() } : {}),
      ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
      ...(alasanPeriode ? { alasan: alasanPeriode } : {}),
    };
    const total = hasil.data.input.baris.reduce((s, b) => s + b.debit, 0);

    konfirmasiPendingRef.current = {
      ...(opsi.konfirmasi ? { konfirmasi: true } : {}),
    };
    busyRef.current = true;
    setBusy(true);
    try {
      const konfirmasiPeringatan = opsi.konfirmasi === true;
      if (modeKoreksi) {
        const res = await api.saldoAwalKoreksi(form, {
          alasan: alasanKoreksiBersih,
          konfirmasiPeringatan,
          ...opsiPeringatanApi(
            konfirmasiPeringatan ? alasanPeringatan : undefined,
          ),
        });
        setPesanKonfirmasi(null);
        setErrorKonfirmasi(null);
        onSukses(
          `Saldo awal ${formatTanggal(tanggal)} dikoreksi — jurnal lama tetap tersimpan di audit; jurnal penyesuaian baru ${formatRp(total)} (${res.jurnal.no_bukti || res.jurnal.id}) tercatat.`,
        );
      } else {
        const res = await api.saldoAwalPosting(form, {
          konfirmasiPeringatan,
          ...opsiPeringatanApi(
            konfirmasiPeringatan ? alasanPeringatan : undefined,
          ),
          // AKT-02: opsi ini konsisten dengan pintu input lain; jenis SALDO_AWAL
          // tetap dikecualikan dari guard sehingga wizard bisa menjadi jurnal pertama.
          wajibSaldoAwal: true,
        });
        setPesanKonfirmasi(null);
        setErrorKonfirmasi(null);
        onSukses(
          `Saldo awal ${formatTanggal(tanggal)} tersimpan — satu jurnal seimbang ${formatRp(total)} (${res.jurnal.no_bukti || res.jurnal.id}).`,
        );
      }
    } catch (e) {
      if (isPerluAlasan(e)) {
        setPesanKonfirmasi(null);
        setErrorKonfirmasi(null);
        setLockOpen(true);
      } else if (isPerluKonfirmasi(e)) {
        const pesan = pesanError(e);
        setPesanKonfirmasi((sebelum) => sebelum ?? pesan);
        setErrorKonfirmasi(opsi.konfirmasi === true ? pesan : null);
      } else {
        setPesanKonfirmasi(null);
        setErrorKonfirmasi(null);
        setErr(pesanError(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      judul={modeKoreksi ? 'Koreksi Saldo Awal' : 'Wizard Saldo Awal'}
      deskripsi={
        modeKoreksi
          ? 'Perbaiki saldo awal yang sudah tersimpan. Sistem membalik jurnal pembukaan lama lalu membuat jurnal penyesuaian baru; jurnal lama tidak dihapus dan tetap tersimpan di audit.'
          : 'Dipakai sekali saat mulai pembukuan nyata. Isi saldo kas/bank, utang, dan aset lain per tanggal mulai. Selisih otomatis menjadi modal, jadi Anda tidak perlu menghitung debit/kredit.'
      }
      onTutup={mintaTutup}
      sibuk={busy}
      lebar="3xl"
    >
      <div className="mt-1">
        <ErrorBox msg={err} />
      </div>
      {modeKoreksi && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Jurnal lama tetap tersimpan di audit. Koreksi membuat jurnal balik dan
          jurnal penyesuaian baru, bukan menghapus atau mengedit jurnal asli.
        </div>
      )}

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Tanggal mulai pembukuan (tanggal acuan)">
            <TextInput
              type="date"
              value={tanggal}
              max={batasTanggal}
              disabled={busy}
              onChange={(e) => setTanggal(e.target.value)}
            />
            {batasTanggal && (
              <span className="mt-1 block text-helper text-stone-500">
                Maksimal {formatTanggal(batasTanggal)} karena sudah ada transaksi
                pada tanggal tersebut.
              </span>
            )}
          </Field>
          {modeKoreksi && (
            <div className="md:col-span-2">
              <Field label="Alasan koreksi (wajib, minimal 5 karakter)">
                <TextInput
                  value={alasanKoreksi}
                  disabled={busy}
                  placeholder="cth: Saldo kas salah input saat pembukuan awal"
                  onChange={(e) => setAlasanKoreksi(e.target.value)}
                />
                <span className="mt-1 block text-helper text-stone-500">
                  Alasan ini dicatat di audit bersama jurnal lama dan jurnal
                  penyesuaian baru.
                </span>
              </Field>
            </div>
          )}
          <Field label="Keterangan (opsional)">
            <TextInput
              value={keterangan}
              disabled={busy}
              placeholder="cth: Saldo awal pembukuan 2026"
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

        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">Saldo per akun</h3>
              <p className="text-sm text-stone-600">
                Hanya kas/bank, utang, dan aset lain. Pendapatan, beban, dan modal
                tidak diisi di sini.
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy || akunRelevan.length === 0}
              onClick={tambahBaris}
            >
              <span className="inline-flex items-center gap-1.5">
                <Plus size={16} /> Tambah akun
              </span>
            </Button>
          </div>

          <div className="mt-2 space-y-2">
            {rows.map((r, i) => {
              // UI-A22: nama akun dipilih untuk label aksesibel nominal.
              const namaPilih = grupAkun
                .flatMap((grup) => grup.akun)
                .find((a) => a.kode === r.akun)?.nama;
              return (
                <div
                  key={r.key}
                  className="grid grid-cols-1 gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
                >
                  <Select
                    aria-label={`Akun saldo awal baris ${i + 1}`}
                    value={r.akun}
                    disabled={busy}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.key === r.key ? { ...x, akun: e.target.value } : x,
                        ),
                      )
                    }
                  >
                    <option value="">— Pilih akun —</option>
                    {grupAkun.map((grup) => (
                      <optgroup key={grup.label} label={grup.label}>
                        {grup.akun.map((a) => (
                          <option key={a.kode} value={a.kode}>
                            {a.kode} — {a.nama}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </Select>
                  <div>
                    <CurrencyInput
                      value={r.nominal}
                      disabled={busy}
                      ariaLabel={
                        r.akun
                          ? `Saldo akun ${r.akun}${namaPilih ? ` — ${namaPilih}` : ''} (baris ${i + 1})`
                          : `Saldo awal baris ${i + 1}`
                      }
                      onChange={(n) =>
                        setRows((prev) =>
                          prev.map((x) =>
                            x.key === r.key ? { ...x, nominal: n } : x,
                          ),
                        )
                      }
                    />
                    <span className="mt-1 block text-helper text-stone-500">Saldo (Rp)</span>
                  </div>
                  <Button
                    variant="ghost"
                    aria-label={`Hapus akun saldo awal baris ${i + 1}`}
                    disabled={busy || rows.length <= 1}
                    onClick={() => hapusBaris(r.key)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Pratinjau Jurnal (untuk diperiksa)</h3>
            {hasil.data && (
              <Badge tone="green">
                Seimbang — debit = kredit
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            Baris di bawah ini yang akan disimpan sebagai satu jurnal. Operator tidak
            perlu mengubahnya; akuntan pendamping bisa memeriksa debit dan kredit di
            sini.
          </p>

          {hasil.data && (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-emerald-200 bg-white p-2">
                  <div className="text-helper font-semibold text-stone-500">
                    Total aktiva (debit)
                  </div>
                  <div className="font-bold">{formatRp(hasil.data.totalAktiva)}</div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-white p-2">
                  <div className="text-helper font-semibold text-stone-500">
                    Total kewajiban (kredit)
                  </div>
                  <div className="font-bold">
                    {formatRp(hasil.data.totalKewajiban)}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-white p-2">
                  <div className="text-helper font-semibold text-stone-500">
                    Selisih ke 3000 MODAL
                  </div>
                  <div className="font-bold">
                    {formatRp(Math.abs(hasil.data.selisih))}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-sm text-stone-600">
                {hasil.data.selisih > 0
                  ? `Aktiva lebih besar ${formatRp(hasil.data.selisih)}. Selisih otomatis dicatat sebagai kredit ke 3000 MODAL (menambah modal).`
                  : hasil.data.selisih < 0
                    ? `Kewajiban lebih besar ${formatRp(-hasil.data.selisih)}. Selisih otomatis dicatat sebagai debit ke 3000 MODAL (mengurangi modal).`
                    : 'Total aktiva dan kewajiban sudah sama; tidak perlu baris modal.'}
              </p>

              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[15px]">
                  <thead>
                    <tr className="border-b text-stone-500">
                      <th className="py-2 pr-3">Akun</th>
                      <th className="py-2 pr-3 text-right">Debit</th>
                      <th className="py-2 text-right">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hasil.data.input.baris.map((b, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-3">{labelAkun(b.akun_kode)}</td>
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
                      <td className="py-2 pr-3 text-right">
                        {formatRp(
                          hasil.data.input.baris.reduce((s, b) => s + b.debit, 0),
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {formatRp(
                          hasil.data.input.baris.reduce((s, b) => s + b.kredit, 0),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {hasil.error ? (
            <p className="mt-2 text-sm text-red-700">{hasil.error}</p>
          ) : !hasil.data ? (
            <p className="mt-2 text-sm text-stone-500">
              Pratinjau muncul setelah tanggal dan minimal satu saldo diisi.
            </p>
          ) : null}
        </div>

        {pesanKonfirmasi && (
          <PeringatanModal
            pesan={pesanKonfirmasi}
            pesanError={errorKonfirmasi}
            sibuk={busy}
            onCancel={() => {
              setPesanKonfirmasi(null);
              setErrorKonfirmasi(null);
            }}
            onSubmit={(alasan) => {
              void simpan({ konfirmasi: true, alasanPeringatan: alasan });
            }}
          />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            disabled={busy || !bolehSimpan}
            title={alasanSimpanTidakAktif}
            onClick={() => setKonfirmasiSimpan(true)}
          >
            {busy
              ? 'Menyimpan…'
              : modeKoreksi
                ? 'Simpan Koreksi'
                : 'Simpan Saldo Awal'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={mintaTutup}>
            Batal
          </Button>
          {alasanSimpanTidakAktif ? (
            <span className="text-sm text-stone-500">{alasanSimpanTidakAktif}</span>
          ) : modeKoreksi ? (
            <span className="text-sm text-stone-500">
              Saldo awal akan dikoreksi tanpa menghapus jurnal lama.
            </span>
          ) : (
            <span className="text-sm text-stone-500">
              Setelah tersimpan, wizard terkunci karena pembukuan sudah dimulai.
            </span>
          )}
        </div>

        {konfirmasiSimpan && (
          <KonfirmasiSimpanSaldoAwal
            mode={modeKoreksi ? 'koreksi' : 'awal'}
            tanggal={tanggal}
            total={totalSaldoAwal}
            sibuk={busy}
            onBatal={() => setKonfirmasiSimpan(false)}
            onKonfirmasi={() => {
              setKonfirmasiSimpan(false);
              void simpan();
            }}
          />
        )}

        {lockOpen && (
          <LockModal
            onCancel={() => setLockOpen(false)}
            onSubmit={(alasan) => {
              setLockOpen(false);
              void simpan({ ...konfirmasiPendingRef.current, alasan });
            }}
          />
        )}

        {konfirmasiTutup && (
          <KonfirmasiModal
            judul="Buang isian saldo awal?"
            deskripsi="Isian saldo awal yang belum disimpan akan hilang. Data yang sudah tersimpan sebelumnya tidak terpengaruh."
            labelYa="Ya, buang isian"
            sibuk={busy}
            onBatal={() => setKonfirmasiTutup(false)}
            onKonfirmasi={() => {
              setKonfirmasiTutup(false);
              // Tutup konfirmasi lebih dulu agar tumpukan modal mengembalikan
              // fokus ke wizard, lalu wizard mengembalikannya ke pemicu.
              window.setTimeout(onClose, 0);
            }}
          />
        )}
    </Modal>
  );
}
