import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { isAkunKasData } from '../../db/coa.js';
import type { Coa } from '../../db/coa.js';
import type { Pinjaman, PinjamanAngsuran, PinjamanBayar } from '../../core/types.js';
import {
  buatJadwalAngsuranOtomatis,
  type BarisJadwalAngsuran,
} from '../../core/pinjamanAngsuran.js';
import type { MutasiPinjamanHasil } from '../../core/pinjamanMutasi.js';
import type { HasilRekonsiliasiPinjaman } from '../../core/pinjamanRekonsiliasi.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal, tahunLokal } from '../../utils/tanggal.js';
import { api, isPerluKonfirmasi, type ModePinjamanApi } from '../lib/api.js';
import {
  PESAN_ALASAN_PERINGATAN_MIN,
  alasanPeringatanCukup,
  rapikanAlasanPeringatan,
} from '../lib/peringatan.js';
import { useTabGuard } from '../lib/tabGuard.js';
import {
  alasanTombolNonaktif,
  Badge,
  Button,
  Card,
  CurrencyInput,
  ErrorBox,
  Field,
  InfoBox,
  KonfirmasiModal,
  Modal,
  PeringatanModal,
  Select,
  TextArea,
  TextInput,
} from './ui.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';

type BarisJadwal = BarisJadwalAngsuran;

function barisBaru(ke: number, tanggal = ''): BarisJadwal {
  return { ke, jatuh_tempo: tanggal, pokok: 0, bunga: 0, catatan: '' };
}

/** Baris jadwal dianggap berisi bila operator mengisi salah satu kolomnya. */
function jadwalBerisiData(rows: BarisJadwal[]): boolean {
  return rows.some(
    (r) =>
      r.jatuh_tempo !== '' ||
      r.pokok !== 0 ||
      r.bunga !== 0 ||
      r.catatan.trim() !== '',
  );
}

/** Tenor bawaan form; nilai selain ini dihitung sebagai isian operator. */
const TENOR_AWAL = '12';

/** UI-A25: batas keras baris generator; di atas ini tombol dinonaktifkan
 * supaya typo tenor tidak merender ribuan baris dan membuat UI tampak hang. */
const TENOR_MAKS_GENERATOR = 360;

/** UI-A25: di atas ambang ini generator meminta konfirmasi sebelum membuat baris. */
const TENOR_AMBATANG_KONFIRMASI = 60;

/** Alasan generator dinonaktifkan/ditolak karena tenor melampaui batas keras. */
const PESAN_TENOR_MELAMPAUI_BATAS =
  `Tenor maksimal ${TENOR_MAKS_GENERATOR} bulan untuk generator jadwal.`;

/** UI-A25: benar bila isian tenor adalah bilangan bulat di atas batas keras. */
function tenorMelampauiBatas(tenor: string): boolean {
  const n = Number(tenor.trim());
  return Number.isSafeInteger(n) && n > TENOR_MAKS_GENERATOR;
}

/**
 * UI-A24: form pinjaman utama dianggap berisi data bila ada field yang
 * bernilai selain bawaan (kreditur, pokok/sisa pokok, tenor, catatan,
 * no. bukti, bunga rencana, jadwal, tanggal selain hari ini). Dipakai sebagai
 * satu-satunya sumber flag dirty tab-guard sehingga aksi lain (ganti mode,
 * buka/tutup form bayar, simpan bayar) tidak bisa lagi menghapus atau
 * memalsukan status isian utama. Pilihan akun tidak dihitung karena nilainya
 * selalu diisi ulang otomatis dari COA saat tab dipasang.
 */
function formBerisiData(f: {
  mode: ModePinjamanApi;
  tanggal: string;
  kreditur: string;
  pokok: number;
  sisaPokok: number;
  tenor: string;
  catatan: string;
  noBukti: string;
  bungaRencana: number;
  jadwal: BarisJadwal[];
}): boolean {
  return (
    f.kreditur.trim() !== '' ||
    f.catatan.trim() !== '' ||
    f.noBukti.trim() !== '' ||
    f.tanggal !== tanggalLokal() ||
    (f.mode === 'PENCAIRAN' ? f.pokok !== 0 : f.sisaPokok !== 0) ||
    f.bungaRencana !== 0 ||
    f.tenor.trim() !== TENOR_AWAL ||
    jadwalBerisiData(f.jadwal)
  );
}

/** Tombol generator aktif hanya saat target pokok > 0 dan tenor bulat 1..360
 * (UI-A25: lebih dari 360 baris membuat form berat, jadi generator ditolak). */
export function bolehIsiJadwalOtomatis(
  targetPokok: number,
  tenor: string,
): boolean {
  const teks = tenor.trim();
  if (!teks) return false;
  const n = Number(teks);
  return (
    Number.isSafeInteger(targetPokok) &&
    targetPokok > 0 &&
    Number.isSafeInteger(n) &&
    n >= 1 &&
    n <= TENOR_MAKS_GENERATOR
  );
}

/** Input bunga rencana + tombol pengisi jadwal dari tenor (AUD2-15). */
export function KontrolJadwalOtomatis({
  targetPokok,
  tenor,
  bungaRencana,
  busy,
  onBungaRencana,
  onIsi,
}: {
  targetPokok: number;
  tenor: string;
  bungaRencana: number;
  busy: boolean;
  onBungaRencana: (nominal: number) => void;
  onIsi: () => void;
}) {
  const aktif = bolehIsiJadwalOtomatis(targetPokok, tenor);
  // UI-A25: tenor di atas batas keras menonaktifkan tombol dengan alasan yang
  // tampak (title) dan dijelaskan di petunjuk di bawah tombol.
  const kelebihanTenor = tenorMelampauiBatas(tenor);
  return (
    <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Field label="Bunga rencana per bulan (Rp)">
            <CurrencyInput
              value={bungaRencana}
              disabled={busy}
              onChange={onBungaRencana}
            />
          </Field>
        </div>
        <Button
          disabled={busy || !aktif}
          title={kelebihanTenor ? PESAN_TENOR_MELAMPAUI_BATAS : undefined}
          onClick={onIsi}
        >
          Isi Jadwal Otomatis dari Tenor
        </Button>
      </div>
      <p className="mt-2 text-sm text-stone-600">
        {aktif
          ? `Membuat ${Number(tenor)} baris: pokok dibagi rata ke Rupiah penuh, ` +
            'baris terakhir menerima sisa, dan jatuh tempo maju satu bulan per baris.'
          : kelebihanTenor
            ? PESAN_TENOR_MELAMPAUI_BATAS
            : 'Isi pokok pinjaman (atau sisa pokok) dan tenor minimal 1 bulan untuk mengaktifkan pengisian otomatis.'}
        {bungaRencana > 0
          ? ' Bunga rencana diisi ke setiap baris.'
          : ' Bunga rencana boleh dikosongkan (0).'}
      </p>
    </div>
  );
}

/** State form bayar angsuran (DB-16d). */
type FormBayar = {
  id: string;
  pinjaman: Pinjaman;
  angsuran: PinjamanAngsuran;
  tanggal: string;
  akunKas: string;
  pokok: number;
  bunga: number;
  denda: number;
  catatan: string;
};

type TargetPembatalan =
  | { jenis: 'pembayaran'; pinjaman: Pinjaman; pembayaran: PinjamanBayar }
  | { jenis: 'pencairan'; pinjaman: Pinjaman };

function sisaAngsuran(a: PinjamanAngsuran): {
  pokokDibayar: number;
  bungaDibayar: number;
  sisaPokok: number;
  sisaBunga: number;
  status: 'BELUM' | 'SEBAGIAN' | 'LUNAS';
} {
  const pokokDibayar = a.pokok_dibayar ?? (a.dibayar ? a.pokok : 0);
  const bungaDibayar = a.bunga_dibayar ?? (a.dibayar ? a.bunga : 0);
  const sisaPokok = a.sisa_pokok ?? Math.max(0, a.pokok - pokokDibayar);
  const sisaBunga = a.sisa_bunga ?? Math.max(0, a.bunga - bungaDibayar);
  return {
    pokokDibayar,
    bungaDibayar,
    sisaPokok,
    sisaBunga,
    status: a.status ?? (a.dibayar ? 'LUNAS' : 'BELUM'),
  };
}

function pinjamanDibatalkan(p: Pinjaman): boolean {
  return p.status === 'DIBATALKAN';
}

/** UI-A12: identitas target pembatalan; dipakai untuk memutuskan apakah alasan
 * yang sudah diketik boleh dipertahankan saat modal dibuka ulang. */
function kunciTargetPembatalan(target: TargetPembatalan): string {
  return target.jenis === 'pembayaran'
    ? `pembayaran:${target.pinjaman.id}:${target.pembayaran.id}`
    : `pencairan:${target.pinjaman.id}`;
}

const NAMA_BULAN_PENDEK = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
] as const;

/** `2026-03` → `Mar 2026`; input lain dikembalikan apa adanya. */
function labelBulanMutasi(bulan: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(bulan);
  if (!m) return bulan;
  const nama = NAMA_BULAN_PENDEK[Number(m[2]) - 1];
  return nama ? `${nama} ${m[1]}` : bulan;
}

/**
 * Periode UI kartu utang: satu tahun penuh bila bulan kosong, atau satu bulan
 * penuh. Mengembalikan null bila tahun/bulan belum valid.
 */
function batasPeriodeMutasi(
  tahun: string,
  bulan: string,
): { mulai: string; sampai: string } | null {
  if (!/^\d{4}$/.test(tahun)) return null;
  const y = Number(tahun);
  if (y < 1900 || y > 9999) return null;
  if (!bulan) return { mulai: `${tahun}-01-01`, sampai: `${tahun}-12-31` };
  const m = Number(bulan);
  if (!Number.isSafeInteger(m) || m < 1 || m > 12) return null;
  const kunci = `${tahun}-${String(m).padStart(2, '0')}`;
  const akhir = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    mulai: `${kunci}-01`,
    sampai: `${kunci}-${String(akhir).padStart(2, '0')}`,
  };
}

export function PinjamanTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [list, setList] = useState<Pinjaman[]>([]);
  // UI-A14: status memuat + gagal muat daftar tampil di kartu Daftar Pinjaman
  // sendiri, bukan di kartu form; empty state hanya setelah muat sukses.
  const [memuatDaftar, setMemuatDaftar] = useState(true);
  const [errDaftar, setErrDaftar] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // UI-A15: penahan klik-ganda untuk simpan() sama seperti form lain — state
  // `busy` saja tidak cukup cepat untuk klik ganda sebelum render ulang.
  const busyRef = useRef(false);
  const [mode, setMode] = useState<ModePinjamanApi>('PENCAIRAN');
  const [tanggal, setTanggal] = useState(tanggalLokal());
  const [kreditur, setKreditur] = useState('');
  const [pokok, setPokok] = useState(0);
  const [sisaPokok, setSisaPokok] = useState(0);
  const [akunKas, setAkunKas] = useState('');
  const [akunBunga, setAkunBunga] = useState('5063');
  const [tenor, setTenor] = useState('12');
  const [catatan, setCatatan] = useState('');
  const [noBukti, setNoBukti] = useState('');
  const [jadwal, setJadwal] = useState<BarisJadwal[]>([barisBaru(1)]);
  const [bungaRencana, setBungaRencana] = useState(0);
  const [konfirmasiJadwalOtomatis, setKonfirmasiJadwalOtomatis] = useState(false);
  // UI-A25: konfirmasi terpisah untuk tenor besar (61..360 baris) sebelum
  // generator benar-benar merender baris jadwalnya.
  const [konfirmasiJadwalBesar, setKonfirmasiJadwalBesar] = useState(false);
  // UI-A25: hasil sukses generator diumumkan inline di dekat seksi jadwal,
  // bukan lewat info simpan di kepala form.
  const [infoJadwal, setInfoJadwal] = useState<string | null>(null);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const [errorKonfirmasi, setErrorKonfirmasi] = useState<string | null>(null);
  const [detailId, setDetailId] = useState('');
  const [detail, setDetail] = useState<Record<string, Pinjaman>>({});
  const [pembayaran, setPembayaran] = useState<Record<string, PinjamanBayar[]>>({});
  const [detailBusy, setDetailBusy] = useState('');
  // UI-A06 — feedback aksi di seksi detail (gagal muat, bayar angsuran,
  // pembatalan) dirender di seksi detail, bukan di kartu Catat Pinjaman atas.
  const [errDetail, setErrDetail] = useState<string | null>(null);
  const [infoBayar, setInfoBayar] = useState<string | null>(null);
  const [infoBatal, setInfoBatal] = useState<string | null>(null);
  const [bayar, setBayar] = useState<FormBayar | null>(null);
  const [bayarAlasan, setBayarAlasan] = useState('');
  const [bayarPerluKonfirmasi, setBayarPerluKonfirmasi] = useState(false);
  const [bayarErr, setBayarErr] = useState<string | null>(null);
  const [bayarBusy, setBayarBusy] = useState(false);
  const bayarBusyRef = useRef(false);
  /**
   * UI-A12: form bayar dianggap "berisi" begitu operator mengubah salah satu
   * isian dari prefill (pokok/bunga sisa, tanggal hari ini, akun kas bawaan).
   * Prefill murni tidak dihitung isian sehingga pindah target tanpa mengedit
   * tetap langsung. `bayarTunda` menampung target baru yang menunggu
   * konfirmasi penggantian.
   */
  const [bayarTersentuh, setBayarTersentuh] = useState(false);
  const [bayarTunda, setBayarTunda] = useState<{
    pinjaman: Pinjaman;
    angsuran: PinjamanAngsuran;
  } | null>(null);
  const [targetPembatalan, setTargetPembatalan] = useState<TargetPembatalan | null>(null);
  const [alasanPembatalan, setAlasanPembatalan] = useState('');
  const [batalPerluKonfirmasi, setBatalPerluKonfirmasi] = useState(false);
  const [batalErr, setBatalErr] = useState<string | null>(null);
  const [batalBusy, setBatalBusy] = useState(false);
  const batalBusyRef = useRef(false);
  /**
   * UI-A12: alasan pembatalan tinggal di state tab dan tidak dibuang saat
   * modal ditutup lewat latar/Escape/Tutup. Ref ini mengingat target terakhir
   * yang dibuka, sehingga membuka ulang modal untuk target yang sama
   * mempertahankan alasan, sementara target berbeda tetap mulai kosong.
   */
  const kunciTargetBatalRef = useRef<string | null>(null);
  // DB-16e — kartu utang / mutasi bulanan.
  const [mutasiPinjamanId, setMutasiPinjamanId] = useState('');
  const [mutasiTahun, setMutasiTahun] = useState(String(tahunLokal()));
  const [mutasiBulan, setMutasiBulan] = useState('');
  const [mutasi, setMutasi] = useState<MutasiPinjamanHasil | null>(null);
  const [mutasiBusy, setMutasiBusy] = useState(false);
  const [mutasiErr, setMutasiErr] = useState<string | null>(null);
  const [mutasiBuka, setMutasiBuka] = useState<Record<string, boolean>>({});
  // DB-16f — rekonsiliasi 2050 vs jadwal (baca-saja).
  const [rekonsiliasi, setRekonsiliasi] = useState<HasilRekonsiliasiPinjaman[]>([]);
  const [rekonsiliasiBusy, setRekonsiliasiBusy] = useState(false);
  const [rekonsiliasiErr, setRekonsiliasiErr] = useState<string | null>(null);
  const { setDirty } = useTabGuard();

  const kasList = useMemo(
    () => coa.filter((c) => isAkunKasData(c) && c.aktif !== false),
    [coa],
  );
  const bungaList = useMemo(
    () => coa.filter((c) => c.tipe === 'BEBAN' && c.aktif !== false),
    [coa],
  );
  const namaAkun = useMemo(
    () => new Map(coa.map((c) => [c.kode, c.nama])),
    [coa],
  );
  const labelAkun = (kode: string): string => namaAkun.get(kode) ?? kode;
  const targetPokok = mode === 'PENCAIRAN' ? pokok : sisaPokok;
  const totalPokokJadwal = jadwal.reduce((s, r) => s + (r.pokok || 0), 0);
  const cocokPokok =
    targetPokok > 0 && Number.isSafeInteger(targetPokok) && totalPokokJadwal === targetPokok;
  const batasMutasi = batasPeriodeMutasi(mutasiTahun, mutasiBulan);
  const jumlahSelisihRekonsiliasi = rekonsiliasi.filter((r) => !r.cocok).length;
  // UI-A14: baris daftar hanya dirender setelah muat sukses dan tidak gagal.
  const daftarSiap = !memuatDaftar && !errDaftar;
  // UI-A23: flag sibuk gabungan untuk aksi daftar (buka jadwal, kartu utang);
  // selama simpan pinjaman, bayar angsuran, atau pembatalan berjalan, aksi
  // daftar mati dengan alasan jelas, bukan diabaikan diam-diam.
  const sibukAksiDaftar = busy || bayarBusy || batalBusy;
  // UI-A24: flag dirty tab adalah derivasi isi form, bukan status yang diset
  // manual di banyak titik. Form pinjaman utama dihitung dari field-fieldnya
  // (formBerisiData); form bayar ikut dihitung hanya saat operator mengubah
  // isian dari prefill (prefill murni tidak dihitung isian — UI-A12).
  const dirtyKini =
    formBerisiData({
      mode,
      tanggal,
      kreditur,
      pokok,
      sisaPokok,
      tenor,
      catatan,
      noBukti,
      bungaRencana,
      jadwal,
    }) || (bayar !== null && bayarTersentuh);

  useEffect(() => {
    setDirty(dirtyKini);
  }, [dirtyKini, setDirty]);

  useEffect(() => {
    let aktif = true;
    void (async () => {
      try {
        const [c, p] = await Promise.all([
          api.coa(),
          // UI-A14: gagal muat daftar ditandai di kartu daftar sendiri, bukan
          // di kartu form.
          api.pinjamanList().catch((e) => {
            if (aktif) setErrDaftar(pesanError(e, PESAN_MUAT_GAGAL));
            return null;
          }),
        ]);
        if (!aktif) return;
        setCoa(c);
        if (p !== null) setList(p);
      } catch (e) {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      } finally {
        if (aktif) setMemuatDaftar(false);
      }
    })();
    return () => {
      aktif = false;
    };
  }, []);

  useEffect(() => {
    if (coa.length === 0) return;
    const kasPertama = kasList[0]?.kode ?? '';
    setAkunKas((sebelum) =>
      sebelum && kasList.some((k) => k.kode === sebelum) ? sebelum : kasPertama,
    );
    setAkunBunga((sebelum) => {
      if (bungaList.some((b) => b.kode === sebelum)) return sebelum;
      if (bungaList.some((b) => b.kode === '5063')) return '5063';
      return bungaList[0]?.kode ?? '';
    });
  }, [coa, kasList, bungaList]);

  useEffect(() => {
    setMutasiPinjamanId((sebelum) => {
      if (sebelum && list.some((p) => p.id === sebelum)) return sebelum;
      return list[0]?.id ?? '';
    });
  }, [list]);

  useEffect(() => {
    if (!mutasiPinjamanId || !batasMutasi) {
      setMutasi(null);
      setMutasiBusy(false);
      return;
    }
    let aktif = true;
    setMutasiBusy(true);
    setMutasiErr(null);
    void (async () => {
      try {
        const hasil = await api.pinjamanMutasi({
          pinjamanId: mutasiPinjamanId,
          ...batasMutasi,
        });
        if (aktif) setMutasi(hasil);
      } catch (e) {
        if (aktif) {
          setMutasi(null);
          setMutasiErr(pesanError(e, PESAN_MUAT_GAGAL));
        }
      } finally {
        if (aktif) setMutasiBusy(false);
      }
    })();
    return () => {
      aktif = false;
    };
  }, [mutasiPinjamanId, mutasiTahun, mutasiBulan, list]);

  useEffect(() => {
    let aktif = true;
    if (list.length === 0) {
      setRekonsiliasi([]);
      setRekonsiliasiBusy(false);
      setRekonsiliasiErr(null);
      return () => {
        aktif = false;
      };
    }
    setRekonsiliasiBusy(true);
    setRekonsiliasiErr(null);
    void (async () => {
      try {
        const hasil = await api.pinjamanRekonsiliasiSemua();
        if (aktif) setRekonsiliasi(hasil);
      } catch (e) {
        if (aktif) {
          setRekonsiliasi([]);
          setRekonsiliasiErr(pesanError(e, PESAN_MUAT_GAGAL));
        }
      } finally {
        if (aktif) setRekonsiliasiBusy(false);
      }
    })();
    return () => {
      aktif = false;
    };
  }, [list]);

  // UI-A24: nilai dirty sudah disinkronkan derivasi di atas; yang tersisa
  // hanyalah membersihkan status saat tab di-unmount agar tidak bocor ke tab
  // lain (pola yang sama dengan PanjarTab dan TransaksiForm).
  useEffect(() => () => setDirty(false), [setDirty]);

  async function refresh(): Promise<void> {
    // UI-A14: memuat ulang daftar setelah aksi menampilkan status memuat dan
    // gagal muat di kartu daftar sendiri, bukan di kartu form.
    setMemuatDaftar(true);
    try {
      setList(await api.pinjamanList());
      setErrDaftar(null);
      setErr(null);
    } catch (e) {
      setErrDaftar(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setMemuatDaftar(false);
    }
  }

  async function muatDetail(id: string): Promise<void> {
    const [d, bayarList] = await Promise.all([
      api.pinjamanDetail(id),
      api.pinjamanPembayaran(id),
    ]);
    setDetail((prev) => ({ ...prev, [id]: d }));
    setPembayaran((prev) => ({ ...prev, [id]: bayarList }));
  }

  function resetForm(): void {
    setKreditur('');
    setPokok(0);
    setSisaPokok(0);
    setCatatan('');
    setNoBukti('');
    setJadwal([barisBaru(1)]);
    setBungaRencana(0);
    setKonfirmasiJadwalOtomatis(false);
    setKonfirmasiJadwalBesar(false);
    setInfoJadwal(null);
    setPesanKonfirmasi(null);
    setErrorKonfirmasi(null);
    // UI-A24: dirty tidak direset manual; setelah state kosong, derivasi
    // formBerisiData otomatis menandai tab bersih.
  }

  async function simpan(alasanPeringatan?: string): Promise<void> {
    if (busyRef.current) return;
    const konfirmasi = alasanPeringatan !== undefined;
    setErr(null);
    setInfo(null);
    if (!konfirmasi) {
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
    }
    if (!kreditur.trim()) {
      setErr('Nama kreditur/LPD wajib diisi.');
      return;
    }
    if (mode === 'PENCAIRAN' && !akunKas) {
      setErr('Akun kas penerima pinjaman wajib dipilih.');
      return;
    }
    if (!akunBunga) {
      setErr('Akun bunga pinjaman wajib dipilih.');
      return;
    }
    if (!cocokPokok) {
      setErr(
        `Total pokok jadwal (${formatRp(totalPokokJadwal)}) harus sama dengan ` +
          `${mode === 'PENCAIRAN' ? 'pokok pinjaman' : 'sisa pokok'} ` +
          `(${formatRp(targetPokok)}).`,
      );
      return;
    }
    if (jadwal.some((r) => !r.jatuh_tempo)) {
      setErr('Setiap baris jadwal wajib memiliki tanggal jatuh tempo.');
      return;
    }
    const tenorAngka = tenor.trim() ? Number(tenor) : null;
    if (tenorAngka !== null && (!Number.isSafeInteger(tenorAngka) || tenorAngka <= 0)) {
      setErr('Tenor pinjaman harus bilangan bulat lebih dari 0 bulan.');
      return;
    }

    const alasanBersih = rapikanAlasanPeringatan(alasanPeringatan);
    if (konfirmasi && !alasanPeringatanCukup(alasanBersih)) {
      setPesanKonfirmasi(
        (sebelum) => sebelum ?? PESAN_ALASAN_PERINGATAN_MIN,
      );
      setErrorKonfirmasi(PESAN_ALASAN_PERINGATAN_MIN);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const r = await api.pinjamanSimpan(
        {
          mode,
          kreditur: kreditur.trim(),
          tanggal,
          ...(mode === 'PENCAIRAN' ? { akunKas, pokok } : { sisaPokok }),
          akunBunga,
          tenor: tenorAngka,
          catatan: catatan.trim(),
          ...(mode === 'PENCAIRAN' && noBukti.trim()
            ? { noBukti: noBukti.trim() }
            : {}),
          angsuran: jadwal.map((row) => ({
            ke: row.ke,
            jatuh_tempo: row.jatuh_tempo,
            pokok: row.pokok,
            bunga: row.bunga,
            catatan: row.catatan.trim(),
          })),
        },
        konfirmasi
          ? { konfirmasiPeringatan: true, alasanPeringatan: alasanBersih }
          : {},
      );
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
      setInfo(
        `${mode === 'PENCAIRAN' ? 'Pencairan' : 'Pinjaman berjalan'} ` +
          `${r.pinjaman.kreditur} tersimpan` +
          `${r.jurnal?.no_bukti ? ` (${r.jurnal.no_bukti})` : ''} — ` +
          `${formatRp(r.pinjaman.sisa_pokok_awal)}. ` +
          (r.jurnal
            ? 'Jurnal D kas / K 2050 dibuat seimbang.'
            : 'Tidak ada jurnal pencairan baru; sisa pokok memakai Saldo Awal 2050.'),
      );
      resetForm();
      setDetailId('');
      setDetail({});
      await refresh();
    } catch (e) {
      if (isPerluKonfirmasi(e)) {
        const pesan = pesanError(e);
        setPesanKonfirmasi((sebelum) => sebelum ?? pesan);
        // Penolakan "alasan kurang" tetap di dalam modal agar bisa diperbaiki.
        setErrorKonfirmasi(konfirmasi ? pesan : null);
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

  function ubahMode(berikut: ModePinjamanApi): void {
    setMode(berikut);
    setErr(null);
    setInfo(null);
    setInfoJadwal(null);
    setPesanKonfirmasi(null);
    setErrorKonfirmasi(null);
    // UI-A24: ganti mode tidak lagi memalsukan dirty; flag mengikuti isi form
    // lewat formBerisiData sehingga form kosong tetap bersih.
  }

  function ubahJadwal(i: number, patch: Partial<BarisJadwal>): void {
    setJadwal((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function tambahJadwal(): void {
    setJadwal((rows) => {
      const ke = rows.reduce((maks, r) => Math.max(maks, r.ke), 0) + 1;
      return [...rows, barisBaru(ke)];
    });
  }

  function hapusJadwal(i: number): void {
    setJadwal((rows) => rows.filter((_, j) => j !== i));
  }

  function terapkanJadwalOtomatis(): void {
    const n = Number(tenor);
    setInfoJadwal(null);
    if (!bolehIsiJadwalOtomatis(targetPokok, tenor)) {
      // UI-A25: jalur modal bisa tercapai meski tombol nonaktif (tenor berubah
      // selagi modal terbuka), jadi batas keras dicek ulang dengan pesan pas.
      setErr(
        tenorMelampauiBatas(tenor)
          ? PESAN_TENOR_MELAMPAUI_BATAS
          : 'Isi pokok pinjaman (atau sisa pokok) dan tenor minimal 1 bulan sebelum mengisi jadwal otomatis.',
      );
      setKonfirmasiJadwalOtomatis(false);
      setKonfirmasiJadwalBesar(false);
      return;
    }
    if (!tanggal) {
      setErr('Tanggal mulai jadwal wajib diisi sebelum mengisi jadwal otomatis.');
      setKonfirmasiJadwalOtomatis(false);
      setKonfirmasiJadwalBesar(false);
      return;
    }
    try {
      setJadwal(
        buatJadwalAngsuranOtomatis({
          targetPokok,
          tenor: n,
          tanggal,
          bunga: bungaRencana,
        }),
      );
      setErr(null);
      setInfoJadwal(
        `Jadwal ${n} baris berhasil diisi. Periksa tanggal dan bunga sebelum menyimpan.`,
      );
    } catch (e) {
      setErr(pesanError(e));
    } finally {
      setKonfirmasiJadwalOtomatis(false);
      setKonfirmasiJadwalBesar(false);
    }
  }

  function mintaIsiJadwalOtomatis(): void {
    const n = Number(tenor);
    // UI-A25: tenor besar (61..360) dikonfirmasi dulu agar UI tidak seketika
    // merender ratusan baris tanpa persetujuan operator.
    if (n > TENOR_AMBATANG_KONFIRMASI && n <= TENOR_MAKS_GENERATOR) {
      setKonfirmasiJadwalBesar(true);
      return;
    }
    if (jadwalBerisiData(jadwal)) {
      setKonfirmasiJadwalOtomatis(true);
      return;
    }
    terapkanJadwalOtomatis();
  }

  /** UI-A25: lanjut setelah konfirmasi tenor besar; peringatan ganti jadwal
   * yang sudah berisi tetap ditanyakan sebelum generator menimpanya. */
  function lanjutSetelahKonfirmasiJadwalBesar(): void {
    setKonfirmasiJadwalBesar(false);
    if (jadwalBerisiData(jadwal)) {
      setKonfirmasiJadwalOtomatis(true);
      return;
    }
    terapkanJadwalOtomatis();
  }

  async function toggleDetail(id: string): Promise<void> {
    if (detailId === id) {
      setDetailId('');
      return;
    }
    setDetailId(id);
    // UI-A06: buka seksi detail selalu mulai bersih agar hasil aksi pinjaman
    // lain tidak ikut tampil di seksi ini.
    setErrDetail(null);
    setInfoBayar(null);
    setInfoBatal(null);
    if (detail[id] && pembayaran[id]) return;
    setDetailBusy(id);
    try {
      await muatDetail(id);
    } catch (e) {
      setErrDetail(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setDetailBusy('');
    }
  }

  function mulaiBayar(p: Pinjaman, a: PinjamanAngsuran): void {
    if (pinjamanDibatalkan(p) || sisaAngsuran(a).status === 'LUNAS') return;
    // UI-A12: form bayar yang sudah diedit tidak boleh ditimpa diam-diam saat
    // operator klik "Bayar Angsuran" baris lain; minta konfirmasi dulu.
    if (
      bayar &&
      bayarTersentuh &&
      (bayar.pinjaman.id !== p.id || bayar.angsuran.id !== a.id)
    ) {
      setBayarTunda({ pinjaman: p, angsuran: a });
      return;
    }
    isiFormBayar(p, a);
  }

  function isiFormBayar(p: Pinjaman, a: PinjamanAngsuran): void {
    const sisa = sisaAngsuran(a);
    const akun =
      kasList.some((k) => k.kode === p.akun_kas)
        ? p.akun_kas
        : (kasList[0]?.kode ?? '');
    setBayar({
      id: globalThis.crypto.randomUUID(),
      pinjaman: p,
      angsuran: a,
      tanggal: tanggalLokal(),
      akunKas: akun,
      pokok: sisa.sisaPokok,
      bunga: sisa.sisaBunga,
      denda: 0,
      catatan: '',
    });
    setBayarAlasan('');
    setBayarPerluKonfirmasi(false);
    setBayarErr(null);
    setBayarTersentuh(false);
    setInfoBayar(null);
    setInfoBatal(null);
    // UI-A24: membuka form bayar tidak lagi menandai tab dirty; prefill murni
    // bukan isian (UI-A12) dan derivasi dirty mengikuti bayarTersentuh.
  }

  function batalBayar(): void {
    setBayar(null);
    setBayarAlasan('');
    setBayarPerluKonfirmasi(false);
    setBayarErr(null);
    setBayarTersentuh(false);
    // UI-A24: pembatalan form bayar tidak boleh menghapus guard isian form
    // pinjaman utama yang belum disimpan; derivasi dirty yang memutuskan.
  }

  function ubahBayar(patch: Partial<FormBayar>): void {
    setBayar((b) => (b ? { ...b, ...patch } : b));
    setBayarTersentuh(true);
    setBayarPerluKonfirmasi(false);
    setBayarErr(null);
  }

  async function simpanBayar(konfirmasi = false): Promise<void> {
    if (!bayar || bayarBusyRef.current) return;
    setBayarErr(null);
    setInfoBayar(null);
    setInfoBatal(null);
    const { pokok, bunga, denda } = bayar;
    if (
      !Number.isSafeInteger(pokok) ||
      !Number.isSafeInteger(bunga) ||
      !Number.isSafeInteger(denda) ||
      pokok < 0 ||
      bunga < 0 ||
      denda < 0
    ) {
      setBayarErr('Pokok, bunga, dan denda harus bilangan bulat ≥ 0.');
      return;
    }
    const total = pokok + bunga + denda;
    if (total <= 0) {
      setBayarErr('Total pembayaran (pokok + bunga + denda) harus lebih dari 0.');
      return;
    }
    if (!bayar.akunKas) {
      setBayarErr('Akun kas/bank pembayaran wajib dipilih.');
      return;
    }
    if (!bayar.tanggal) {
      setBayarErr('Tanggal pembayaran wajib diisi.');
      return;
    }
    const sisa = sisaAngsuran(bayar.angsuran);
    if (pokok > sisa.sisaPokok) {
      setBayarErr(
        `Pokok tidak boleh melebihi sisa angsuran ${formatRp(sisa.sisaPokok)}.`,
      );
      return;
    }
    const bungaMelebihiSisa = bunga > sisa.sisaBunga;
    const alasan = bayarAlasan.trim();
    if (konfirmasi && (bungaMelebihiSisa || bayarPerluKonfirmasi) && alasan.length < 5) {
      setBayarErr('Alasan konfirmasi wajib diisi minimal 5 karakter.');
      return;
    }

    bayarBusyRef.current = true;
    setBayarBusy(true);
    const idPinjaman = bayar.pinjaman.id;
    const ke = bayar.angsuran.ke;
    try {
      const r = await api.pinjamanBayar(
        {
          id: bayar.id,
          pinjamanId: idPinjaman,
          angsuranId: bayar.angsuran.id,
          tanggal: bayar.tanggal,
          akunKas: bayar.akunKas,
          pokok,
          bunga,
          denda,
          catatan: bayar.catatan.trim(),
        },
        konfirmasi
          ? {
              ...(bungaMelebihiSisa
                ? { konfirmasiSelisih: true, alasanSelisih: alasan }
                : {}),
              ...(bayarPerluKonfirmasi
                ? { konfirmasiPeringatan: true, alasanPeringatan: alasan }
                : {}),
              // T-B06: debit beban non-bunga dihitung denda; konfirmasi
              // operator diteruskan (server hanya menghormati flag bila
              // debitnya benar-benar ada pada jurnal pembayaran).
              ...(bayarPerluKonfirmasi
                ? { konfirmasiDendaLain: true, alasanDendaLain: alasan }
                : {}),
            }
          : {},
      );
      setInfoBatal(null);
      setInfoBayar(
        `Bayar angsuran ke-${ke} ${bayar.pinjaman.kreditur} tersimpan ` +
          `(${r.jurnal.no_bukti || r.jurnal.id}) — ${formatRp(total)}. ` +
          `Sisa pokok sekarang ${formatRp(r.pinjaman?.outstanding ?? 0)}.`,
      );
      // UI-A06: form bayar (posisi operator saat ini) menutup setelah tersimpan;
      // gulir ke banner hasil di seksi detail agar konfirmasi terlihat dan
      // operator tidak mencatat pembayaran dua kali.
      if (typeof document !== 'undefined') {
        document
          .getElementById(`pinjaman-detail-${idPinjaman}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setBayar(null);
      setBayarAlasan('');
      setBayarPerluKonfirmasi(false);
      setBayarTersentuh(false);
      // UI-A24: dirty tidak direset manual di sini; form utama yang masih
      // berisi tetap terjaga oleh derivasi formBerisiData.
      await refresh();
      try {
        await muatDetail(idPinjaman);
      } catch {
        /* daftar sudah diperbarui; detail akan dimuat lagi saat dibuka */
      }
    } catch (e) {
      if (isPerluKonfirmasi(e)) {
        setBayarPerluKonfirmasi(true);
        setBayarErr(pesanError(e));
      } else {
        setBayarErr(pesanError(e));
      }
    } finally {
      bayarBusyRef.current = false;
      setBayarBusy(false);
    }
  }

  function bukaPembatalan(target: TargetPembatalan): void {
    const kunci = kunciTargetPembatalan(target);
    const samaTarget = kunciTargetBatalRef.current === kunci;
    kunciTargetBatalRef.current = kunci;
    setTargetPembatalan(target);
    // Target sama: pertahankan alasan yang sudah diketik. Target lain:
    // alasan milik target lama tidak boleh terbawa.
    if (!samaTarget) setAlasanPembatalan('');
    setBatalPerluKonfirmasi(false);
    setBatalErr(null);
    setInfoBayar(null);
    setInfoBatal(null);
  }

  async function simpanPembatalan(konfirmasi = false): Promise<void> {
    if (!targetPembatalan || batalBusyRef.current) return;
    const alasan = alasanPembatalan.trim();
    setBatalErr(null);
    if (alasan.length < 5) {
      setBatalErr('Alasan pembatalan wajib diisi minimal 5 karakter.');
      return;
    }
    batalBusyRef.current = true;
    setBatalBusy(true);
    const idPinjaman = targetPembatalan.pinjaman.id;
    try {
      if (targetPembatalan.jenis === 'pembayaran') {
        const r = await api.pinjamanBayarBatal(
          targetPembatalan.pembayaran.id,
          alasan,
          konfirmasi
            ? { konfirmasiPeringatan: true, alasanPeringatan: alasan }
            : {},
        );
        // UI-A16: tampilkan nomor angsuran (ke-N), bukan ID baris DB mentah.
        const angsuranId = targetPembatalan.pembayaran.angsuran_id;
        const keAngsuran =
          targetPembatalan.pinjaman.angsuran?.find((a) => a.id === angsuranId)
            ?.ke ?? angsuranId;
        setInfoBatal(
          `Catatan pembayaran angsuran ${keAngsuran == null ? 'tanpa jadwal' : `ke-${keAngsuran}`} ` +
            `dibatalkan. Jurnal balik ${r.jurnal.no_bukti || r.jurnal.id} dibuat pada tanggal jurnal asli; ` +
            'jurnal dan riwayat asal tetap tersimpan. Catat ulang pembayaran yang benar bila diperlukan.',
        );
      } else {
        const r = await api.pinjamanBatal(
          idPinjaman,
          alasan,
          konfirmasi
            ? { konfirmasiPeringatan: true, alasanPeringatan: alasan }
            : {},
        );
        setInfoBatal(
          `Catatan pencairan ${r.pinjaman.kreditur} dibatalkan. Jurnal balik ` +
            `${r.jurnal.no_bukti || r.jurnal.id} dibuat pada tanggal jurnal asli; ` +
            'jurnal dan riwayat asal tetap tersimpan.',
        );
      }
      setInfoBayar(null);
      // UI-A06: modal pembatalan menutup setelah sukses; gulir ke banner hasil
      // di seksi detail (dekat tombol pembatalan) agar operator melihatnya.
      if (typeof document !== 'undefined') {
        document
          .getElementById(`pinjaman-detail-${idPinjaman}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      setTargetPembatalan(null);
      setAlasanPembatalan('');
      // Target sudah berhasil dibatalkan; alasan tidak boleh terbawa ke
      // pembukaan modal berikutnya untuk catatan lain.
      kunciTargetBatalRef.current = null;
      setBatalPerluKonfirmasi(false);
      await refresh();
      try {
        await muatDetail(idPinjaman);
      } catch {
        /* daftar sudah diperbarui; detail dan pembayaran dimuat saat dibuka */
      }
    } catch (e) {
      if (isPerluKonfirmasi(e)) {
        setBatalPerluKonfirmasi(true);
        setBatalErr(pesanError(e));
      } else {
        setBatalErr(pesanError(e));
      }
    } finally {
      batalBusyRef.current = false;
      setBatalBusy(false);
    }
  }

  function toggleMutasiBulan(bulan: string): void {
    setMutasiBuka((prev) => ({ ...prev, [bulan]: !prev[bulan] }));
  }

  function pilihKartuHutang(id: string): void {
    setMutasiPinjamanId(id);
    setMutasiBuka({});
    setMutasiErr(null);
    // UI-A07: kartu mutasi berada jauh di bawah daftar pinjaman; tanpa gulir,
    // klik tombol "Kartu utang" terasa tidak bereaksi. Tunggu commit render
    // dulu (requestAnimationFrame, pola pilihJenis di TransaksiTab) agar
    // posisi kartu sudah terukur, lalu gulir ke sana dengan menghormati
    // preferensi reduced-motion.
    if (typeof document === 'undefined') return;
    window.requestAnimationFrame(() => {
      const target = document.getElementById('kartu-hutang');
      if (!target) return;
      const halus = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      target.scrollIntoView({ behavior: halus ? 'smooth' : 'auto', block: 'start' });
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Pinjaman LPD</h1>
            <p className="mt-1 max-w-3xl text-[15px] text-stone-600">
              Catat pinjaman dari LPD dan jadwal angsurannya. Pilih{' '}
              <b>Pencairan baru</b> bila uang pinjaman baru diterima, atau{' '}
              <b>Sudah berjalan</b> bila pinjaman sudah ada sebelum aplikasi dipakai.
              Jadwal diisi manual dari perjanjian LPD; aplikasi tidak menghitung
              amortisasi sendiri.
            </p>
          </div>
          <Badge tone="green">Jurnal otomatis seimbang</Badge>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Catat Pinjaman LPD</h2>
        <p className="mb-3 text-sm text-stone-600">
          Mode pencairan baru membuat jurnal <b>D kas / K 2050 HUTANG LAIN-LAIN</b>.
          Mode sudah berjalan tidak membuat jurnal baru.
        </p>

        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Mode pinjaman">
          {(
            [
              ['PENCAIRAN', 'Pencairan baru', 'Uang pinjaman baru diterima'],
              ['BERJALAN', 'Sudah berjalan', 'Sisa pokok sudah ada di Saldo Awal'],
            ] as const
          ).map(([id, label, ket]) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              disabled={busy}
              onClick={() => ubahMode(id)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                mode === id
                  ? 'border-emerald-600 bg-emerald-50 text-emerald-950'
                  : 'border-stone-200 bg-white text-stone-700 hover:border-emerald-300'
              }`}
            >
              <span className="block font-bold">{label}</span>
              <span className="block text-helper text-stone-600">{ket}</span>
            </button>
          ))}
        </div>

        <ErrorBox msg={err} />
        {info && (
          <InfoBox className="mb-2">{info}</InfoBox>
        )}

        {mode === 'BERJALAN' && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
            <p className="font-semibold">Peringatan Saldo Awal 2050</p>
            <p className="mt-1">
              Sisa pokok pinjaman ini <b>harus sudah tercatat sebagai kredit 2050
              HUTANG LAIN-LAIN di Saldo Awal</b>. Modul ini tidak membuat jurnal
              pencairan baru; membuat jurnal lagi akan membuat kas dan utang dobel.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label={mode === 'PENCAIRAN' ? 'Tanggal pencairan' : 'Tanggal mulai jadwal'}>
            <TextInput
              type="date"
              value={tanggal}
              disabled={busy}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </Field>
          <Field label="Kreditur / LPD">
            <TextInput
              value={kreditur}
              disabled={busy}
              placeholder="cth: LPD Desa Adat"
              onChange={(e) => setKreditur(e.target.value)}
            />
          </Field>
          {mode === 'PENCAIRAN' ? (
            <Field label="Pokok pinjaman (Rp)">
              <CurrencyInput
                value={pokok}
                disabled={busy}
                onChange={(n) => setPokok(n)}
              />
            </Field>
          ) : (
            <Field label="Sisa pokok saat ini (Rp)">
              <CurrencyInput
                value={sisaPokok}
                disabled={busy}
                onChange={(n) => setSisaPokok(n)}
              />
            </Field>
          )}
          {mode === 'PENCAIRAN' && (
            <Field label="Akun kas / bank penerima">
              <Select
                value={akunKas}
                disabled={busy}
                onChange={(e) => setAkunKas(e.target.value)}
              >
                {kasList.map((k) => (
                  <option key={k.kode} value={k.kode}>
                    {k.kode} — {k.nama}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Akun bunga (default 5063)">
            <Select
              value={akunBunga}
              disabled={busy}
              onChange={(e) => setAkunBunga(e.target.value)}
            >
              {bungaList.map((b) => (
                <option key={b.kode} value={b.kode}>
                  {b.kode} — {b.nama}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tenor (bulan, opsional)">
            <TextInput
              type="number"
              min={1}
              value={tenor}
              disabled={busy}
              placeholder="cth: 12"
              onChange={(e) => setTenor(e.target.value)}
            />
          </Field>
          <Field label="Catatan (opsional)">
            <TextInput
              value={catatan}
              disabled={busy}
              placeholder="cth: pinjaman untuk pembangunan"
              onChange={(e) => setCatatan(e.target.value)}
            />
          </Field>
          {mode === 'PENCAIRAN' && (
            <Field label="No. bukti jurnal (opsional)">
              <TextInput
                value={noBukti}
                disabled={busy}
                placeholder="cth: JU-2026-0001 — boleh kosong"
                onChange={(e) => setNoBukti(e.target.value)}
              />
            </Field>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">Jadwal angsuran (input manual)</h3>
              <p className="mt-1 text-sm text-stone-600">
                Isi manual, atau bagi rata pokok otomatis dari tenor lalu sesuaikan
                sebelum menyimpan. Jatuh tempo otomatis maju satu bulan per baris.
                Total pokok jadwal harus sama dengan{' '}
                {mode === 'PENCAIRAN' ? 'pokok pinjaman' : 'sisa pokok'}.
              </p>
            </div>
            <Badge tone={cocokPokok ? 'green' : 'amber'}>
              Total pokok {formatRp(totalPokokJadwal)}
            </Badge>
          </div>

          <KontrolJadwalOtomatis
            targetPokok={targetPokok}
            tenor={tenor}
            bungaRencana={bungaRencana}
            busy={busy}
            onBungaRencana={(n) => setBungaRencana(n)}
            onIsi={mintaIsiJadwalOtomatis}
          />

          {infoJadwal && <InfoBox className="mt-3">{infoJadwal}</InfoBox>}

          <div className="mt-3 space-y-2">
            {jadwal.map((row, i) => (
              <div
                key={`${row.ke}-${i}`}
                className="grid grid-cols-1 items-end gap-2 rounded-lg border border-stone-200 bg-white p-2 md:grid-cols-[70px_150px_1fr_1fr_1fr_auto]"
              >
                <Field label="Ke">
                  <TextInput
                    type="number"
                    min={1}
                    value={String(row.ke)}
                    disabled={busy}
                    onChange={(e) => ubahJadwal(i, { ke: Number(e.target.value) })}
                  />
                </Field>
                <Field label="Jatuh tempo">
                  <TextInput
                    type="date"
                    value={row.jatuh_tempo}
                    disabled={busy}
                    onChange={(e) => ubahJadwal(i, { jatuh_tempo: e.target.value })}
                  />
                </Field>
                <Field label="Pokok (Rp)">
                  <CurrencyInput
                    value={row.pokok}
                    disabled={busy}
                    ariaLabel={`Pokok angsuran baris ${row.ke || i + 1}`}
                    onChange={(n) => ubahJadwal(i, { pokok: n })}
                  />
                </Field>
                <Field label="Bunga (Rp)">
                  <CurrencyInput
                    value={row.bunga}
                    disabled={busy}
                    ariaLabel={`Bunga angsuran baris ${row.ke || i + 1}`}
                    onChange={(n) => ubahJadwal(i, { bunga: n })}
                  />
                </Field>
                <Field label="Catatan baris">
                  <TextInput
                    value={row.catatan}
                    disabled={busy}
                    placeholder="opsional"
                    onChange={(e) => ubahJadwal(i, { catatan: e.target.value })}
                  />
                </Field>
                <Button
                  variant="ghost"
                  disabled={busy || jadwal.length === 1}
                  onClick={() => hapusJadwal(i)}
                >
                  Hapus
                </Button>
              </div>
            ))}
            <Button variant="ghost" disabled={busy} onClick={tambahJadwal}>
              + Tambah angsuran
            </Button>
          </div>

          <div className="mt-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[15px]">
            <p>
              Target pokok: <b>{formatRp(targetPokok)}</b> · Total jadwal:{' '}
              <b>{formatRp(totalPokokJadwal)}</b>
            </p>
            {!cocokPokok && (
              <p className="mt-1 font-semibold text-red-700">
                Total pokok jadwal belum sama dengan{' '}
                {mode === 'PENCAIRAN' ? 'pokok pinjaman' : 'sisa pokok'}. Server akan
                menolak simpan sampai angkanya cocok.
              </p>
            )}
            {cocokPokok && (
              <p className="mt-1 font-semibold text-green-700">
                Total pokok jadwal sudah cocok.
              </p>
            )}
          </div>
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
              void simpan(alasan);
            }}
          />
        )}

        {konfirmasiJadwalOtomatis && (
          <KonfirmasiModal
            judul="Ganti jadwal angsuran yang sudah ada?"
            deskripsi={
              <>
                Jadwal yang sekarang berisi {jadwal.length} baris akan diganti
                dengan <b>{Number(tenor)} baris</b> baru dari tenor. Perubahan
                manual yang belum disimpan akan hilang.
              </>
            }
            labelYa="Ya, isi ulang jadwal"
            labelBatal="Batal"
            variant="danger"
            sibuk={busy}
            onBatal={() => setKonfirmasiJadwalOtomatis(false)}
            onKonfirmasi={terapkanJadwalOtomatis}
          />
        )}

        {konfirmasiJadwalBesar && (
          <KonfirmasiModal
            judul="Buat jadwal dari tenor besar?"
            deskripsi={`Akan membuat ${Number(tenor)} baris jadwal — lanjutkan?`}
            labelYa="Ya, buat jadwal"
            labelBatal="Batal"
            variant="primary"
            sibuk={busy}
            onBatal={() => setKonfirmasiJadwalBesar(false)}
            onKonfirmasi={lanjutSetelahKonfirmasiJadwalBesar}
          />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busy || !cocokPokok} onClick={() => void simpan()}>
            {busy ? 'Menyimpan…' : 'Simpan Pinjaman LPD'}
          </Button>
          <span className="text-sm text-stone-500">
            {mode === 'PENCAIRAN'
              ? 'Jurnal pencairan dibuat otomatis dan atomik bersama pinjaman + jadwal.'
              : 'Mode sudah berjalan tidak membuat jurnal pencairan baru.'}
          </span>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Daftar Pinjaman LPD</h2>
            <p className="mt-1 text-sm text-stone-600">
              Sisa pokok (outstanding) dihitung dari sisa pokok awal dikurangi pokok
              yang sudah dibayar menurut jurnal. Jadwal adalah rencana, bukan saldo.
            </p>
          </div>
          {/* UI-A14: jumlah pinjaman hanya diklaim setelah daftar termuat. */}
          <Badge tone="stone">
            {memuatDaftar ? 'Memuat…' : errDaftar ? '—' : `${list.length} pinjaman`}
          </Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
            <caption className="sr-only">Daftar pinjaman dan sisa pokok</caption>
            <thead>
              <tr className="border-b text-stone-500">
                <th scope="col" className="py-2 pr-3">Tanggal mulai</th>
                <th scope="col" className="py-2 pr-3">Kreditur / LPD</th>
                <th scope="col" className="py-2 pr-3">Kas</th>
                <th scope="col" className="py-2 pr-3 text-right">Pokok awal</th>
                <th scope="col" className="py-2 pr-3 text-right">Sisa awal</th>
                <th scope="col" className="py-2 pr-3 text-right">Sisa pokok (outstanding)</th>
                <th scope="col" className="py-2 pr-3">Sumber jurnal</th>
                <th scope="col" className="py-2">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {memuatDaftar && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-stone-500">
                    Memuat daftar pinjaman…
                  </td>
                </tr>
              )}
              {!memuatDaftar && errDaftar && (
                <tr>
                  <td colSpan={8} className="py-2">
                    {/* UI-A14: gagal muat daftar tampil di kartu ini sendiri,
                        bukan di kartu form. */}
                    <ErrorBox msg={errDaftar} />
                  </td>
                </tr>
              )}
              {daftarSiap && list.map((p) => {
                const d = detail[p.id];
                const jadwalTampil = d?.angsuran ?? p.angsuran ?? [];
                const daftarBayar = pembayaran[p.id] ?? [];
                const pembayaranAktif = daftarBayar.filter((b) => !b.dibatalkan);
                const pinjamanBatal = pinjamanDibatalkan(p);
                const bolehBatalPencairan =
                  !pinjamanBatal &&
                  Boolean(p.jurnal_pencairan_id) &&
                  pembayaran[p.id] !== undefined &&
                  pembayaranAktif.length === 0 &&
                  bayar?.pinjaman.id !== p.id;
                return (
                  <Fragment key={p.id}>
                    <tr className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatTanggal(p.tanggal_mulai)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-semibold">{p.kreditur}</div>
                        {pinjamanBatal && (
                          <Badge tone="red">DIBATALKAN</Badge>
                        )}
                        {p.catatan && (
                          <div className="text-helper text-stone-500">{p.catatan}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3">{labelAkun(p.akun_kas)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {formatRp(p.pokok_awal)}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {formatRp(p.sisa_pokok_awal)}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {formatRp(p.outstanding ?? p.sisa_pokok_awal)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={p.jurnal_pencairan_id ? 'green' : 'amber'}>
                          {p.jurnal_pencairan_id ? 'Pencairan baru' : 'Saldo awal'}
                        </Badge>
                        <div className="mt-1 text-helper text-stone-500">
                          {p.jurnal_pencairan_id ?? 'tanpa jurnal pencairan'}
                        </div>
                        {p.jurnal_batal_id && (
                          <div className="mt-1 text-helper text-stone-500">
                            Jurnal balik: {p.jurnal_batal_id}
                          </div>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {/* UI-A21: ekspander diumumkan pembaca layar dengan
                              aria-expanded dan mengaitkan konten via
                              aria-controls. */}
                          <Button
                            variant="ghost"
                            aria-expanded={detailId === p.id}
                            aria-controls={`pinjaman-jadwal-${p.id}`}
                            disabled={sibukAksiDaftar}
                            title={alasanTombolNonaktif({ sibuk: sibukAksiDaftar })}
                            onClick={() => void toggleDetail(p.id)}
                          >
                            {detailId === p.id ? 'Tutup jadwal' : 'Lihat jadwal'}
                          </Button>
                          {/* UI-A07: tombol pinjaman yang kartunya sedang
                              tampil disorot agar jelas kartu milik baris mana;
                              pilihan lain otomatis kembali ke ghost. */}
                          <Button
                            variant={mutasiPinjamanId === p.id ? 'primary' : 'ghost'}
                            disabled={sibukAksiDaftar}
                            title={alasanTombolNonaktif({ sibuk: sibukAksiDaftar })}
                            onClick={() => pilihKartuHutang(p.id)}
                          >
                            Kartu utang
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {detailId === p.id && (
                      <tr className="border-b bg-stone-50 last:border-0">
                        {/* UI-A21: id konten yang dirujuk aria-controls
                            tombol "Lihat jadwal". */}
                        <td colSpan={8} id={`pinjaman-jadwal-${p.id}`} className="px-3 py-3">
                          {/* UI-A06: jangkar gulir + banner hasil aksi seksi
                              detail (gagal muat, bayar angsuran, pembatalan). */}
                          <div id={`pinjaman-detail-${p.id}`}>
                            <ErrorBox msg={errDetail} />
                            {infoBayar && (
                              <InfoBox className="mb-2">{infoBayar}</InfoBox>
                            )}
                            {infoBatal && (
                              <InfoBox className="mb-2">{infoBatal}</InfoBox>
                            )}
                          </div>
                          {detailBusy === p.id ? (
                            <p className="text-stone-500">Memuat jadwal…</p>
                          ) : jadwalTampil.length > 0 ? (
                            <table className="w-full text-left text-sm">
                              <caption className="sr-only">
                                Jadwal angsuran {p.kreditur}
                              </caption>
                              <thead>
                                <tr className="text-stone-500">
                                  <th scope="col" className="py-1 pr-3">Ke</th>
                                  <th scope="col" className="py-1 pr-3">Jatuh tempo</th>
                                  <th scope="col" className="py-1 pr-3 text-right">Pokok</th>
                                  <th scope="col" className="py-1 pr-3 text-right">Bunga</th>
                                  <th scope="col" className="py-1 pr-3">Status</th>
                                  <th scope="col" className="py-1 pr-3">Catatan</th>
                                  <th scope="col" className="py-1">Tindakan</th>
                                </tr>
                              </thead>
                              <tbody>
                                {jadwalTampil.map((a) => {
                                  const sisa = sisaAngsuran(a);
                                  const jumlahBayar = pembayaranAktif.filter(
                                    (b) => b.angsuran_id === a.id,
                                  ).length;
                                  return (
                                  <tr key={a.id ?? a.ke}>
                                    <td className="py-1 pr-3">{a.ke}</td>
                                    <td className="py-1 pr-3 whitespace-nowrap">
                                      {formatTanggal(a.jatuh_tempo)}
                                    </td>
                                    <td className="py-1 pr-3 text-right">
                                      {formatRp(a.pokok)}
                                    </td>
                                    <td className="py-1 pr-3 text-right">
                                      {formatRp(a.bunga)}
                                    </td>
                                    <td className="py-1 pr-3">
                                      <Badge
                                        tone={
                                          sisa.status === 'LUNAS'
                                            ? 'green'
                                            : sisa.status === 'SEBAGIAN'
                                              ? 'amber'
                                              : 'stone'
                                        }
                                      >
                                        {sisa.status}
                                      </Badge>
                                      <div className="mt-1 text-helper text-stone-600">
                                        <div>
                                          Pokok dibayar {formatRp(sisa.pokokDibayar)} · sisa{' '}
                                          {formatRp(sisa.sisaPokok)}
                                        </div>
                                        <div>
                                          Bunga dibayar {formatRp(sisa.bungaDibayar)} · sisa{' '}
                                          {formatRp(sisa.sisaBunga)}
                                        </div>
                                        {jumlahBayar > 0 && (
                                          <div>{jumlahBayar} catatan pembayaran</div>
                                        )}
                                      </div>
                                      {a.tanggal_bayar && (
                                        <div className="mt-1 text-helper text-stone-500">
                                          {formatTanggal(a.tanggal_bayar)}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-1">{a.catatan || '—'}</td>
                                    <td className="py-1">
                                      {sisa.status === 'LUNAS' || pinjamanBatal ? (
                                        <span className="text-helper text-stone-500">
                                          {pinjamanBatal ? 'Pinjaman dibatalkan' : 'Sudah lunas'}
                                        </span>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          disabled={bayarBusy || batalBusy}
                                          onClick={() => mulaiBayar(p, a)}
                                        >
                                          {sisa.status === 'SEBAGIAN' ? 'Lanjut Bayar' : 'Bayar Angsuran'}
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-stone-500">Belum ada jadwal angsuran.</p>
                          )}

                          <div className="mt-4 rounded-lg border border-stone-200 bg-white p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <h3 className="font-semibold">Riwayat pembayaran</h3>
                                <p className="text-sm text-stone-600">
                                  Setiap pembayaran memiliki jurnal sendiri; pembatalan
                                  menyimpan jurnal balik dan tidak menghapus riwayat.
                                </p>
                              </div>
                              <Badge tone="stone">
                                {/* UI-A14: jumlah catatan hanya setelah data
                                    pembayaran benar-benar termuat. */}
                                {detailBusy === p.id
                                  ? 'Memuat…'
                                  : pembayaran[p.id] !== undefined
                                    ? `${daftarBayar.length} catatan`
                                    : '—'}
                              </Badge>
                            </div>
                            {/* UI-A14: saat memuat tampilkan status memuat,
                                bukan klaim "belum ada pembayaran"; saat gagal
                                muat detail, jangan klaim kosong — errDetail
                                sudah tampil di jangkar atas seksi detail. */}
                            {detailBusy === p.id ? (
                              <p className="mt-2 text-sm text-stone-500">
                                Memuat riwayat pembayaran…
                              </p>
                            ) : daftarBayar.length > 0 ? (
                              <div className="mt-3 overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                  <caption className="sr-only">
                                    Riwayat pembayaran {p.kreditur}
                                  </caption>
                                  <thead>
                                    <tr className="text-stone-500">
                                      <th scope="col" className="py-1 pr-3">Tanggal</th>
                                      <th scope="col" className="py-1 pr-3">Angsuran</th>
                                      <th scope="col" className="py-1 pr-3 text-right">Pokok</th>
                                      <th scope="col" className="py-1 pr-3 text-right">Bunga</th>
                                      <th scope="col" className="py-1 pr-3 text-right">Kas keluar</th>
                                      <th scope="col" className="py-1 pr-3">Status / jurnal</th>
                                      <th scope="col" className="py-1">Tindakan</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {daftarBayar.map((b) => (
                                      <tr key={b.id} className="border-t align-top">
                                        <td className="py-1 pr-3 whitespace-nowrap">
                                          {formatTanggal(b.tanggal)}
                                        </td>
                                        <td className="py-1 pr-3">
                                          {b.angsuran_id == null
                                            ? 'Tanpa jadwal'
                                            : `Ke-${jadwalTampil.find((a) => a.id === b.angsuran_id)?.ke ?? b.angsuran_id}`}
                                        </td>
                                        <td className="py-1 pr-3 text-right">{formatRp(b.pokok)}</td>
                                        <td className="py-1 pr-3 text-right">{formatRp(b.bunga)}</td>
                                        <td className="py-1 pr-3 text-right">{formatRp(b.kas_keluar)}</td>
                                        <td className="py-1 pr-3">
                                          {b.dibatalkan ? (
                                            <>
                                              <Badge tone="red">DIBATALKAN</Badge>
                                              <div className="mt-1 text-xs text-stone-500">
                                                Jurnal balik: {b.jurnal_batal_id ?? '—'}
                                              </div>
                                            </>
                                          ) : (
                                            <span className="text-xs text-stone-600">
                                              Aktif · jurnal {b.jurnal_id}
                                            </span>
                                          )}
                                        </td>
                                        <td className="py-1">
                                          {!b.dibatalkan && !pinjamanBatal && (
                                            <Button
                                              variant="ghost"
                                                disabled={
                                                  batalBusy ||
                                                  bayarBusy ||
                                                  bayar?.pinjaman.id === p.id
                                                }
                                              onClick={() =>
                                                bukaPembatalan({
                                                  jenis: 'pembayaran',
                                                  pinjaman: p,
                                                  pembayaran: b,
                                                })
                                              }
                                            >
                                              Batalkan catatan pembayaran
                                            </Button>
                                          )}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : pembayaran[p.id] !== undefined ? (
                              <p className="mt-2 text-sm text-stone-500">
                                Belum ada pembayaran tercatat.
                              </p>
                            ) : null}
                            <div className="mt-3 border-t pt-3">
                              {bolehBatalPencairan ? (
                                <Button
                                  variant="danger-outline"
                                  disabled={batalBusy || bayarBusy}
                                  onClick={() => bukaPembatalan({ jenis: 'pencairan', pinjaman: p })}
                                >
                                  Batalkan catatan pencairan
                                </Button>
                              ) : p.jurnal_pencairan_id && !pinjamanBatal ? (
                                <p className="text-sm text-stone-500">
                                  Pencairan dapat dibatalkan setelah tidak ada pembayaran aktif.
                                </p>
                              ) : !p.jurnal_pencairan_id ? (
                                <p className="text-sm text-stone-500">
                                  Pinjaman sudah berjalan tidak memiliki jurnal pencairan untuk dibatalkan.
                                </p>
                              ) : null}
                            </div>
                          </div>

                          {bayar && bayar.pinjaman.id === p.id && (
                            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <h3 className="font-bold">
                                    Bayar angsuran ke-{bayar.angsuran.ke}
                                  </h3>
                                  <p className="mt-1 text-sm text-stone-600">
                                    Form diisi dengan sisa pokok dan bunga. Anda
                                    dapat membayar sebagian lalu melanjutkan nanti;
                                    pokok tidak boleh melebihi sisa, dan bunga di atas
                                    sisa memerlukan konfirmasi serta alasan.
                                  </p>
                                </div>
                                <Badge
                                  tone={
                                    bayar.pokok + bayar.bunga + bayar.denda > 0
                                      ? 'green'
                                      : 'amber'
                                  }
                                >
                                  Total {formatRp(bayar.pokok + bayar.bunga + bayar.denda)}
                                </Badge>
                              </div>

                              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                                <Field label="Tanggal bayar">
                                  <TextInput
                                    type="date"
                                    value={bayar.tanggal}
                                    disabled={bayarBusy}
                                    onChange={(e) =>
                                      ubahBayar({ tanggal: e.target.value })
                                    }
                                  />
                                </Field>
                                <Field label="Akun kas / bank">
                                  <Select
                                    value={bayar.akunKas}
                                    disabled={bayarBusy}
                                    onChange={(e) =>
                                      ubahBayar({ akunKas: e.target.value })
                                    }
                                  >
                                    {kasList.map((k) => (
                                      <option key={k.kode} value={k.kode}>
                                        {k.kode} — {k.nama}
                                      </option>
                                    ))}
                                  </Select>
                                </Field>
                                <Field label="Catatan (opsional)">
                                  <TextInput
                                    value={bayar.catatan}
                                    disabled={bayarBusy}
                                    placeholder="cth: angsuran bulan ini"
                                    onChange={(e) =>
                                      ubahBayar({ catatan: e.target.value })
                                    }
                                  />
                                </Field>
                                <Field label="Pokok dibayar (Rp)">
                                  <CurrencyInput
                                    value={bayar.pokok}
                                    disabled={bayarBusy}
                                    onChange={(n) => ubahBayar({ pokok: n })}
                                  />
                                </Field>
                                <Field label="Bunga dibayar (Rp)">
                                  <CurrencyInput
                                    value={bayar.bunga}
                                    disabled={bayarBusy}
                                    onChange={(n) => ubahBayar({ bunga: n })}
                                  />
                                </Field>
                                <Field label="Denda (Rp, opsional)">
                                  <CurrencyInput
                                    value={bayar.denda}
                                    disabled={bayarBusy}
                                    onChange={(n) => ubahBayar({ denda: n })}
                                  />
                                </Field>
                              </div>

                              <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                                <p>
                                  Sisa saat ini: pokok{' '}
                                  <b>{formatRp(sisaAngsuran(bayar.angsuran).sisaPokok)}</b>{' '}
                                  · bunga{' '}
                                  <b>{formatRp(sisaAngsuran(bayar.angsuran).sisaBunga)}</b>
                                </p>
                                <p className="mt-1">
                                  Rencana awal: pokok <b>{formatRp(bayar.angsuran.pokok)}</b>{' '}
                                  · bunga <b>{formatRp(bayar.angsuran.bunga)}</b>
                                </p>
                                <p className="mt-1">
                                  Jurnal: <b>D 2050 pokok + D {labelAkun(p.akun_bunga)}{' '}
                                  bunga + D 5050 denda / K kas total</b>
                                </p>
                                {bayar.bunga > sisaAngsuran(bayar.angsuran).sisaBunga && (
                                  <p className="mt-1 font-semibold text-amber-800">
                                    Bunga melebihi sisa yang tercatat. Konfirmasi dengan
                                    alasan diperlukan; jadwal tidak berubah.
                                  </p>
                                )}
                              </div>

                              {(bayarPerluKonfirmasi ||
                                bayar.bunga > sisaAngsuran(bayar.angsuran).sisaBunga) && (
                                <div className="mt-3">
                                  <Field label="Alasan konfirmasi (wajib ≥ 5 karakter)">
                                    <TextArea
                                      value={bayarAlasan}
                                      disabled={bayarBusy}
                                      placeholder="cth: pembulatan sesuai kesepakatan LPD"
                                      onChange={(e) => {
                                        setBayarAlasan(e.target.value);
                                        setBayarTersentuh(true);
                                      }}
                                    />
                                  </Field>
                                </div>
                              )}

                              {!bayarPerluKonfirmasi && <ErrorBox msg={bayarErr} />}

                              {bayarPerluKonfirmasi && (
                                <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900">
                                  <p className="font-semibold">Perlu konfirmasi</p>
                                  <p className="mt-1">{bayarErr}</p>
                                  <div className="mt-2 flex flex-wrap gap-2">
                                    <Button
                                      disabled={bayarBusy || bayarAlasan.trim().length < 5}
                                      onClick={() => void simpanBayar(true)}
                                    >
                                      Ya, bayar dengan konfirmasi
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      disabled={bayarBusy}
                                      onClick={() => {
                                        setBayarPerluKonfirmasi(false);
                                        setBayarErr(null);
                                      }}
                                    >
                                      Ubah isian
                                    </Button>
                                  </div>
                                </div>
                              )}

                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                <Button
                                  disabled={
                                    bayarBusy ||
                                    !bayar.akunKas ||
                                    bayar.pokok + bayar.bunga + bayar.denda <= 0 ||
                                    bayar.pokok > sisaAngsuran(bayar.angsuran).sisaPokok
                                  }
                                  title={alasanTombolNonaktif({
                                    sibuk: bayarBusy,
                                    alasan: !bayar.akunKas
                                      ? 'Pilih akun kas/bank dulu.'
                                      : bayar.pokok + bayar.bunga + bayar.denda <= 0
                                        ? 'Isi pokok, bunga, atau denda yang dibayar (di atas nol).'
                                        : bayar.pokok >
                                            sisaAngsuran(bayar.angsuran).sisaPokok
                                          ? `Pokok melebihi sisa pinjaman (${formatRp(sisaAngsuran(bayar.angsuran).sisaPokok)}); kurangi jumlah pokok.`
                                          : null,
                                  })}
                                  onClick={() => void simpanBayar()}
                                >
                                  {bayarBusy ? 'Menyimpan…' : 'Bayar Angsuran'}
                                </Button>
                                {/* UI-A13: kasus pokok > sisa paling sering
                                    mengejutkan operator; tunjukkan alasannya. */}
                                {bayar.pokok >
                                  sisaAngsuran(bayar.angsuran).sisaPokok && (
                                  <span className="text-sm font-semibold text-amber-800">
                                    Pokok dibayar melebihi sisa pinjaman — kurangi
                                    jumlah pokok.
                                  </span>
                                )}
                                <Button
                                  variant="ghost"
                                  disabled={bayarBusy}
                                  onClick={batalBayar}
                                >
                                  Batal
                                </Button>
                                <span className="text-sm text-stone-500">
                                  Pembayaran dapat dicatat beberapa kali sampai pokok
                                  dan bunga angsuran lunas; setiap catatan membuat
                                  jurnal seimbang tersendiri.
                                </span>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {daftarSiap && list.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-4 text-center text-stone-500">
                    Belum ada pinjaman LPD.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Rekonsiliasi 2050 vs Jadwal Pinjaman</h2>
            <p className="mt-1 max-w-3xl text-sm text-stone-600">
              Membandingkan sisa pokok (outstanding) menurut jurnal{' '}
              <b>2050 HUTANG LAIN-LAIN</b> yang tertaut ke pinjaman dengan{' '}
              <b>sisa pokok awal dikurangi pokok yang dibayar</b>. Hanya jurnal
              milik pinjaman ini yang dihitung; saldo 2050 untuk utang non-LPD
              dan jurnal yang belum ditautkan tidak ikut dibandingkan.
            </p>
          </div>
          <Badge tone={jumlahSelisihRekonsiliasi > 0 ? 'amber' : 'green'}>
            {/* UI-A14: selama daftar pinjaman masih dimuat, belum bisa
                diklaim "Semua cocok". */}
            {rekonsiliasiBusy
              ? 'Memeriksa…'
              : memuatDaftar
                ? 'Memuat…'
                : jumlahSelisihRekonsiliasi > 0
                  ? `${jumlahSelisihRekonsiliasi} selisih`
                  : 'Semua cocok'}
          </Badge>
        </div>

        {rekonsiliasiBusy && (
          <p className="mt-2 text-sm text-stone-500">Menghitung rekonsiliasi…</p>
        )}
        <ErrorBox msg={rekonsiliasiErr} />

        {!rekonsiliasiBusy && rekonsiliasi.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
              <caption className="sr-only">
                Rekonsiliasi saldo jurnal 2050 vs jadwal pinjaman
              </caption>
              <thead>
                <tr className="border-b text-stone-500">
                  <th scope="col" className="py-2 pr-3">Kreditur / ID</th>
                  <th scope="col" className="py-2 pr-3 text-right">Saldo jurnal 2050</th>
                  <th scope="col" className="py-2 pr-3 text-right">Jadwal</th>
                  <th scope="col" className="py-2 pr-3 text-right">Selisih</th>
                  <th scope="col" className="py-2 pr-3">Status</th>
                  <th scope="col" className="py-2">Keterangan</th>
                </tr>
              </thead>
              <tbody>
                {rekonsiliasi.map((r) => {
                  const p = list.find((x) => x.id === r.pinjaman_id);
                  return (
                    <tr
                      key={r.pinjaman_id}
                      className="border-b align-top last:border-0"
                    >
                      <td className="py-2 pr-3">
                        <div className="font-semibold">
                          {p?.kreditur ?? r.pinjaman_id}
                        </div>
                        <div className="text-helper font-mono text-stone-500">
                          {r.pinjaman_id}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {formatRp(r.gl)}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {formatRp(r.jadwal)}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right whitespace-nowrap ${
                          r.cocok ? '' : 'font-semibold text-amber-800'
                        }`}
                      >
                        {formatRp(r.selisih)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge tone={r.cocok ? 'green' : 'amber'}>
                          {r.cocok ? 'Cocok' : 'Selisih'}
                        </Badge>
                      </td>
                      <td className="py-2 text-sm text-stone-600">{r.pesan}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* UI-A14: jangan klaim kosong selama daftar pinjaman masih dimuat. */}
        {!rekonsiliasiBusy &&
          !memuatDaftar &&
          rekonsiliasi.length === 0 &&
          !rekonsiliasiErr && (
            <p className="mt-2 text-sm text-stone-500">
              Belum ada pinjaman LPD untuk direkonsiliasi.
            </p>
          )}

        {jumlahSelisihRekonsiliasi > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
            <p className="font-semibold">Ada selisih yang perlu diperiksa</p>
            <p className="mt-1">
              Selisih berarti sisa pokok (outstanding) menurut jurnal 2050 berbeda
              dengan sisa pokok menurut jadwal. Periksa jurnal pencairan, jurnal
              pembayaran (termasuk akun pokok dan link pembayaran), atau Saldo
              Awal 2050. Aplikasi <b>tidak mengoreksi otomatis</b> dan
              tidak menyediakan tombol koreksi di sini; koreksi data lama dilakukan
              lewat jurnal koreksi/reversal oleh akuntan pendamping.
            </p>
          </div>
        )}
      </Card>

      {/* UI-A07: jangkar gulir untuk tombol "Kartu utang" di daftar pinjaman;
          kartu mutasi berada jauh di bawah sehingga tanpa gulir klik terasa
          tidak bereaksi. scroll-mt-24 menambal header sticky aplikasi. */}
      <div id="kartu-hutang" className="scroll-mt-24">
        <Card>
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold">Kartu Utang / Mutasi Bulanan</h2>
              <p className="mt-1 max-w-3xl text-sm text-stone-600">
                Mutasi pokok, bunga, denda, dan kas keluar per bulan. Semua angka
                dihitung ulang dari baris jurnal pembayaran yang tertaut ke pinjaman;
                tidak ada saldo atau total bulanan yang disimpan di tabel pembayaran.
              </p>
            </div>
            <Badge tone="stone">Dihitung dari jurnal</Badge>
          </div>
  
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Field label="Pinjaman">
              <Select
                value={mutasiPinjamanId}
                disabled={list.length === 0}
                onChange={(e) => pilihKartuHutang(e.target.value)}
              >
                {list.length === 0 && <option value="">Belum ada pinjaman</option>}
                {list.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.kreditur} — {formatRp(p.outstanding ?? p.sisa_pokok_awal)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tahun">
              <TextInput
                inputMode="numeric"
                maxLength={4}
                value={mutasiTahun}
                disabled={mutasiBusy}
                placeholder="cth: 2026"
                onChange={(e) => setMutasiTahun(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </Field>
            <Field label="Bulan (kosong = satu tahun)">
              <Select
                value={mutasiBulan}
                disabled={mutasiBusy}
                onChange={(e) => setMutasiBulan(e.target.value)}
              >
                <option value="">Semua bulan</option>
                {NAMA_BULAN_PENDEK.map((nama, i) => (
                  <option key={nama} value={String(i + 1).padStart(2, '0')}>
                    {nama}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
  
          {!batasMutasi && (
            <p className="mt-2 text-sm font-semibold text-red-700">
              Tahun wajib 4 digit (1900–9999) dan bulan harus valid.
            </p>
          )}
          {mutasiBusy && <p className="mt-2 text-sm text-stone-500">Menghitung mutasi…</p>}
          <ErrorBox msg={mutasiErr} />
  
          {mutasi && (
            <>
              <div className="mt-4 grid grid-cols-2 gap-2 text-[15px] md:grid-cols-6">
                {[
                  ['Saldo awal periode', mutasi.saldo_awal_periode],
                  ['Pokok dibayar', mutasi.total_pokok],
                  ['Bunga dibayar', mutasi.total_bunga],
                  ['Denda dibayar', mutasi.total_denda],
                  ['Total kas keluar', mutasi.total_kas_keluar],
                  ['Saldo akhir periode', mutasi.saldo_akhir_periode],
                ].map(([label, nilai]) => (
                  <div
                    key={String(label)}
                    className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2"
                  >
                    <div className="text-helper text-stone-500">{label}</div>
                    <div className="font-semibold whitespace-nowrap">
                      {formatRp(Number(nilai))}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-sm text-stone-600">
                {mutasi.pinjaman.kreditur} · {mutasi.periode.label} · sisa pokok
                (outstanding) seluruh riwayat <b>{formatRp(mutasi.outstanding)}</b>.
                Saldo akhir periode = saldo awal − pokok dibayar; saldo berantai
                bulan ke bulan.
              </p>
  
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-[15px]">
                  {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
                  <caption className="sr-only">
                    Kartu hutang bulanan {mutasi.pinjaman.kreditur}
                  </caption>
                  <thead>
                    <tr className="border-b text-stone-500">
                      <th scope="col" className="py-2 pr-3">Bulan</th>
                      <th scope="col" className="py-2 pr-3 text-right">Saldo awal</th>
                      <th scope="col" className="py-2 pr-3 text-right">Pokok</th>
                      <th scope="col" className="py-2 pr-3 text-right">Bunga</th>
                      <th scope="col" className="py-2 pr-3 text-right">Denda</th>
                      <th scope="col" className="py-2 pr-3 text-right">Kas keluar</th>
                      <th scope="col" className="py-2 pr-3 text-right">Saldo akhir</th>
                      <th scope="col" className="py-2 pr-3">Jurnal</th>
                      <th scope="col" className="py-2">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mutasi.bulanan.map((b) => (
                      <Fragment key={b.bulan}>
                        <tr className="border-b align-top last:border-0">
                          <td className="py-2 pr-3 whitespace-nowrap font-semibold">
                            {labelBulanMutasi(b.bulan)}
                          </td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap">
                            {formatRp(b.saldo_awal)}
                          </td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap">
                            {formatRp(b.pokok)}
                          </td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap">
                            {formatRp(b.bunga)}
                          </td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap">
                            {formatRp(b.denda)}
                          </td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap">
                            {formatRp(b.kas_keluar)}
                          </td>
                          <td className="py-2 pr-3 text-right whitespace-nowrap font-semibold">
                            {formatRp(b.saldo_akhir)}
                          </td>
                          <td className="py-2 pr-3 text-stone-600">
                            {b.jurnal_ids.length} jurnal
                          </td>
                          <td className="py-2">
                            {/* UI-A21: ekspander diumumkan pembaca layar dengan
                                aria-expanded dan mengaitkan konten via
                                aria-controls. */}
                            <Button
                              variant="ghost"
                              disabled={b.pembayaran.length === 0}
                              title={alasanTombolNonaktif({
                                alasan:
                                  b.pembayaran.length === 0
                                    ? 'Belum ada pembayaran tercatat pada bulan ini.'
                                    : null,
                              })}
                              aria-expanded={Boolean(mutasiBuka[b.bulan])}
                              aria-controls={`pinjaman-mutasi-${b.bulan}`}
                              onClick={() => toggleMutasiBulan(b.bulan)}
                            >
                              {mutasiBuka[b.bulan] ? 'Tutup' : 'Lihat jurnal'}
                            </Button>
                            {b.pembayaran.length === 0 && (
                              <span className="mt-1 block text-helper text-stone-500">
                                Belum ada pembayaran tercatat.
                              </span>
                            )}
                          </td>
                        </tr>
                        {mutasiBuka[b.bulan] && (
                          <tr className="border-b bg-stone-50 last:border-0">
                            {/* UI-A21: id konten yang dirujuk aria-controls. */}
                            <td
                              colSpan={9}
                              id={`pinjaman-mutasi-${b.bulan}`}
                              className="px-3 py-3"
                            >
                              <table className="w-full text-left text-sm">
                                <caption className="sr-only">
                                  Rincian jurnal pembayaran bulan{' '}
                                  {labelBulanMutasi(b.bulan)}
                                </caption>
                                <thead>
                                  <tr className="text-stone-500">
                                    <th scope="col" className="py-1 pr-3">No. bukti</th>
                                    <th scope="col" className="py-1 pr-3">Tanggal jurnal</th>
                                    <th scope="col" className="py-1 pr-3">Tanggal catat</th>
                                    <th scope="col" className="py-1 pr-3">Jurnal ID</th>
                                    <th scope="col" className="py-1 pr-3 text-right">Pokok</th>
                                    <th scope="col" className="py-1 pr-3 text-right">Bunga</th>
                                    <th scope="col" className="py-1 pr-3 text-right">Denda</th>
                                    <th scope="col" className="py-1 text-right">Kas keluar</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {b.pembayaran.map((p) => (
                                    <tr key={p.pembayaran_id}>
                                      <td className="py-1 pr-3">
                                        {p.no_bukti || '(tanpa no. bukti)'}
                                      </td>
                                      <td className="py-1 pr-3 whitespace-nowrap">
                                        {formatTanggal(p.tanggal)}
                                      </td>
                                      <td className="py-1 pr-3 whitespace-nowrap">
                                        {p.tanggal_bayar === p.tanggal
                                          ? 'sama dengan jurnal'
                                          : formatTanggal(p.tanggal_bayar)}
                                      </td>
                                      <td className="py-1 pr-3 font-mono text-helper">
                                        {p.jurnal_id}
                                      </td>
                                      <td className="py-1 pr-3 text-right">
                                        {formatRp(p.pokok)}
                                      </td>
                                      <td className="py-1 pr-3 text-right">
                                        {formatRp(p.bunga)}
                                      </td>
                                      <td className="py-1 pr-3 text-right">
                                        {formatRp(p.denda)}
                                      </td>
                                      <td className="py-1 text-right">
                                        {formatRp(p.kas_keluar)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
  
              <div className="mt-6 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="font-bold">Jadwal vs Realisasi</h3>
                  <p className="mt-1 text-sm text-stone-600">
                    Jadwal adalah rencana perjanjian; realisasi dibaca dari jurnal
                    yang ditautkan ke angsuran. Selisih negatif berarti kurang bayar.
                    Jadwal tidak diubah oleh realisasi.
                  </p>
                </div>
                {mutasi.jadwal.length > 0 && (
                  <Badge
                    tone={
                      mutasi.jadwal.some((a) => !a.dibayar) ? 'amber' : 'green'
                    }
                  >
                    {mutasi.jadwal.filter((a) => a.dibayar).length}/
                    {mutasi.jadwal.length} angsuran lunas
                  </Badge>
                )}
              </div>
  
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[15px]">
                  {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
                  <caption className="sr-only">
                    Jadwal vs realisasi angsuran {mutasi.pinjaman.kreditur}
                  </caption>
                  <thead>
                    <tr className="border-b text-stone-500">
                      <th scope="col" className="py-2 pr-3">Ke</th>
                      <th scope="col" className="py-2 pr-3">Jatuh tempo</th>
                      <th scope="col" className="py-2 pr-3">Status</th>
                      <th scope="col" className="py-2 pr-3 text-right">Pokok jadwal</th>
                      <th scope="col" className="py-2 pr-3 text-right">Bunga jadwal</th>
                      <th scope="col" className="py-2 pr-3 text-right">Pokok realisasi</th>
                      <th scope="col" className="py-2 pr-3 text-right">Bunga realisasi</th>
                      <th scope="col" className="py-2 pr-3 text-right">Selisih pokok</th>
                      <th scope="col" className="py-2 pr-3 text-right">Selisih bunga</th>
                      <th scope="col" className="py-2">Jurnal bayar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mutasi.jadwal.map((a) => (
                      <tr key={a.angsuran_id} className="border-b align-top last:border-0">
                        <td className="py-2 pr-3">{a.ke}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          {formatTanggal(a.jatuh_tempo)}
                        </td>
                        <td className="py-2 pr-3">
                          {/* UI-A17: status turunan sama dengan Daftar (BELUM/
                              SEBAGIAN/LUNAS), bukan hanya dibayar penuh. */}
                          <Badge
                            tone={
                              a.status === 'LUNAS'
                                ? 'green'
                                : a.status === 'SEBAGIAN'
                                  ? 'amber'
                                  : 'stone'
                            }
                          >
                            {a.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          {formatRp(a.pokok_jadwal)}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          {formatRp(a.bunga_jadwal)}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          {formatRp(a.pokok_realisasi)}
                        </td>
                        <td className="py-2 pr-3 text-right whitespace-nowrap">
                          {formatRp(a.bunga_realisasi)}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right whitespace-nowrap ${
                            a.selisih_pokok !== 0 ? 'font-semibold text-amber-800' : ''
                          }`}
                        >
                          {formatRp(a.selisih_pokok)}
                        </td>
                        <td
                          className={`py-2 pr-3 text-right whitespace-nowrap ${
                            a.selisih_bunga !== 0 ? 'font-semibold text-amber-800' : ''
                          }`}
                        >
                          {formatRp(a.selisih_bunga)}
                        </td>
                        <td className="py-2 text-helper">
                          {a.jurnal_id ? (
                            <>
                              <div className="font-semibold text-stone-700">
                                {a.no_bukti || '(tanpa no. bukti)'}
                              </div>
                              <div>
                                {a.tanggal_jurnal
                                  ? formatTanggal(a.tanggal_jurnal)
                                  : '—'}
                              </div>
                              <div className="font-mono">{a.jurnal_id}</div>
                              {a.jumlah_pembayaran > 1 && (
                                <div className="font-semibold text-amber-800">
                                  dibayar dalam {a.jumlah_pembayaran} catatan pembayaran
                                </div>
                              )}
                              {a.tanggal_bayar && a.tanggal_bayar !== a.tanggal_jurnal && (
                                <div>catat: {formatTanggal(a.tanggal_bayar)}</div>
                              )}
                            </>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))}
                    {mutasi.jadwal.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-4 text-center text-stone-500">
                          Tidak ada jadwal angsuran pada periode ini.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>
      </div>
      {bayarTunda && (
        <KonfirmasiModal
          judul="Ganti target bayar angsuran?"
          deskripsi={`Form bayar angsuran yang sedang diisi akan ditimpa dengan target baru: angsuran ke-${bayarTunda.angsuran.ke} ${bayarTunda.pinjaman.kreditur}. Isian yang belum disimpan akan hilang.`}
          labelYa="Ya, ganti target"
          sibuk={bayarBusy}
          onBatal={() => setBayarTunda(null)}
          onKonfirmasi={() => {
            const tunda = bayarTunda;
            setBayarTunda(null);
            isiFormBayar(tunda.pinjaman, tunda.angsuran);
          }}
        />
      )}
      {targetPembatalan && (
        <Modal
          judul={
            targetPembatalan.jenis === 'pembayaran'
              ? 'Batalkan catatan pembayaran'
              : 'Batalkan catatan pencairan'
          }
          deskripsi={
            <div className="space-y-2">
              <p>
                Gunakan hanya untuk membetulkan catatan yang keliru. Sistem membuat
                jurnal balik pada tanggal jurnal asli dan menyimpan jurnal serta
                riwayat awal.
              </p>
              <p>
                Pembatalan ini bukan catatan bahwa uang benar-benar dikembalikan.
                Bila uang memang diterima atau dibayar kembali, catat transaksi
                sebenarnya secara terpisah.
              </p>
            </div>
          }
          onTutup={() => {
            setTargetPembatalan(null);
            setBatalErr(null);
            setBatalPerluKonfirmasi(false);
          }}
          sibuk={batalBusy}
          lebar="md"
        >
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              {targetPembatalan.jenis === 'pembayaran'
                ? `Pinjaman: ${targetPembatalan.pinjaman.kreditur}; jurnal pembayaran: ${targetPembatalan.pembayaran.jurnal_id}.`
                : `Pinjaman: ${targetPembatalan.pinjaman.kreditur}; jurnal pencairan: ${targetPembatalan.pinjaman.jurnal_pencairan_id}.`}
            </p>
            <Field label="Alasan pembetulan (wajib ≥ 5 karakter)">
              <TextArea
                autoFocus
                value={alasanPembatalan}
                disabled={batalBusy}
                placeholder="cth: pembayaran tercatat dua kali"
                onChange={(e) => setAlasanPembatalan(e.target.value)}
              />
            </Field>
            <ErrorBox msg={batalErr} />
            {batalPerluKonfirmasi && (
              <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                Peringatan posting perlu dikonfirmasi. Alasan yang sama akan dicatat
                sebagai alasan operator pada jurnal balik.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                disabled={batalBusy}
                onClick={() => {
                  setTargetPembatalan(null);
                  setBatalErr(null);
                  setBatalPerluKonfirmasi(false);
                }}
              >
                Tutup
              </Button>
              <Button
                variant="danger"
                disabled={batalBusy || alasanPembatalan.trim().length < 5}
                onClick={() => void simpanPembatalan(batalPerluKonfirmasi)}
              >
                {batalBusy
                  ? 'Menyimpan…'
                  : batalPerluKonfirmasi
                    ? 'Ya, lanjut buat jurnal balik'
                    : 'Batalkan catatan'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}





