import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { isAkunKasData } from '../../db/coa.js';
import type { Coa } from '../../db/coa.js';
import {
  buatJurnalPanjarClose,
  buatJurnalPanjarSerah,
  type HasilPanjarClose,
} from '../../core/forms.js';
import { tanggalKalenderValid, type JurnalInput } from '../../core/posting.js';
import { totalPanjarPerAkun } from '../../core/rekonsiliasiPanjar.js';
import type { Panjar, PanjarItem } from '../../core/types.js';
import {
  panjarToWorkbook,
  periodeFile,
  rentangDariRows,
} from '../../features/export/workbooks.js';
import { panjarPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import {
  api,
  isPerluAlasan,
  isPerluKonfirmasi,
  type SaldoAwalSaatIniApi,
} from '../lib/api.js';
import {
  MIN_ALASAN_PERINGATAN,
  PESAN_ALASAN_PERINGATAN_MIN,
  alasanPeringatanCukup,
  rapikanAlasanPeringatan,
} from '../lib/peringatan.js';
import {
  adalahErrorSaldoAwal,
  opsiSaldoAwal,
  tandaiMulaiTanpaSaldoAwal,
} from '../lib/saldoAwal.js';
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
  LockModal,
  Modal,
  PeringatanModal,
  Select,
  TextInput,
} from './ui.js';
import { SaldoAwalGuard } from './SaldoAwalGuard.js';
import { PetunjukAkunKembar } from './PetunjukAkunKembar.js';
import { ExportActions } from './ExportActions.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';
import {
  PESAN_MUAT_GAGAL,
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
} from '../../utils/pesanError.js';

type ItemRow = {
  kategori_baga: string;
  nominal: number;
  nota_nomor: string;
  nota_tanggal: string;
  toko: string;
  keterangan: string;
};

function barisItemBaru(notaTanggal = ''): ItemRow {
  return {
    kategori_baga: '5004',
    nominal: 0,
    nota_nomor: '',
    nota_tanggal: notaTanggal,
    toko: '',
    keterangan: '',
  };
}

/** Bentuk item yang dikirim ke IPC; detail nota kosong tetap boleh (legacy). */
function itemKeInput(it: ItemRow) {
  return {
    kategori_baga: it.kategori_baga,
    nominal: it.nominal,
    nota_nomor: it.nota_nomor.trim(),
    nota_tanggal: it.nota_tanggal.trim(),
    toko: it.toko.trim(),
    keterangan: it.keterangan.trim(),
  };
}

type Pratinjau = {
  input: JurnalInput | null;
  error: string | null;
};

/** Tabel pratinjau jurnal yang sama untuk serah & pertanggungjawaban. */
function TabelPratinjau({
  input,
  labelBaris,
}: {
  input: JurnalInput;
  labelBaris: (index: number, akun: string, debit: number, kredit: number) => string;
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
              <td className="py-2 pr-3">{labelBaris(i, b.akun_kode, b.debit, b.kredit)}</td>
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

/** Tahun dari tanggal ISO; null bila format tidak valid. */
function tahunDariIso(tanggal: string): string | null {
  const m = /^(\d{4})-\d{2}-\d{2}$/.exec(String(tanggal ?? '').trim());
  return m ? m[1]! : null;
}

/**
 * AUD2-06: peringatan bila realisasi berada di tahun yang berbeda dari panjar
 * atau nota. Beban selalu masuk Laba Rugi tahun `tanggalClose`, bukan tahun
 * panjar/nota, sehingga operator perlu memastikan tanggalnya memang disengaja.
 */
export function PeringatanTahunPertanggungjawaban({
  tanggalClose,
  tanggalPanjar,
  notaTanggal,
}: {
  tanggalClose: string;
  tanggalPanjar: string;
  notaTanggal: readonly string[];
}) {
  const tahunClose = tahunDariIso(tanggalClose);
  if (!tahunClose) return null;

  const tahunPanjar = tahunDariIso(tanggalPanjar);
  const panjarBeda = tahunPanjar !== null && tahunPanjar !== tahunClose;
  const notaBeda = notaTanggal
    .map((tanggal) => ({
      tanggal: String(tanggal ?? '').trim(),
      tahun: tahunDariIso(tanggal),
    }))
    .filter(
      (n): n is { tanggal: string; tahun: string } =>
        n.tahun !== null && n.tahun !== tahunClose,
    );

  if (!panjarBeda && notaBeda.length === 0) return null;

  const rincian: string[] = [];
  if (panjarBeda) {
    rincian.push(
      `panjar diserahkan ${formatTanggal(tanggalPanjar)} (tahun ${tahunPanjar})`,
    );
  }
  if (notaBeda.length > 0) {
    const tanggalNota = [...new Set(notaBeda.map((n) => formatTanggal(n.tanggal)))].join(
      ', ',
    );
    const tahunNota = [...new Set(notaBeda.map((n) => n.tahun))].join(', ');
    rincian.push(`tanggal nota ${tanggalNota} berada di tahun ${tahunNota}`);
  }
  const tahunLain = [
    ...new Set([
      ...(panjarBeda && tahunPanjar ? [tahunPanjar] : []),
      ...notaBeda.map((n) => n.tahun),
    ]),
  ].join(', ');

  return (
    <div
      role="status"
      className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900"
    >
      <p className="font-semibold">
        Perhatian: tahun realisasi berbeda dari tahun panjar/nota.
      </p>
      <p className="mt-1">
        Tanggal realisasi {formatTanggal(tanggalClose)} berada di tahun{' '}
        <b>{tahunClose}</b>, sedangkan {rincian.join(' dan ')}. Beban akan masuk
        ke <b>Laba Rugi tahun {tahunClose}</b>, bukan tahun {tahunLain}. Pastikan
        tanggal realisasi memang disengaja.
      </p>
    </div>
  );
}

/** DB-21: konfirmasi pembatalan panjar OPEN dengan alasan wajib. */
function BatalPanjarModal({
  target,
  sibuk,
  pesanError,
  onCancel,
  onSubmit,
}: {
  target: Panjar;
  sibuk: boolean;
  pesanError: string | null;
  onCancel: () => void;
  onSubmit: (alasan: string) => void;
}) {
  const [alasan, setAlasan] = useState('');
  const cukup = alasanPeringatanCukup(alasan);

  return (
    <Modal
      judul="Batalkan panjar?"
      deskripsi={
        <div className="space-y-2 text-[15px] text-stone-700">
          <p>
            Panjar <b>{target.penerima}</b> sebesar{' '}
            <b>{formatRp(target.jumlah)}</b> akan dibatalkan. Sistem membuat
            jurnal balik sehingga kas sumber bertambah dan Uang Panjar (1040)
            kembali seperti sebelum panjar.
          </p>
          <p>
            Jurnal serah asli tetap tersimpan; status panjar menjadi{' '}
            <b>DIBATALKAN</b> dan tidak bisa dipertanggungjawabkan lagi. Tulis
            alasan minimal {MIN_ALASAN_PERINGATAN} karakter — alasan ini tercatat
            di audit.
          </p>
        </div>
      }
      onTutup={onCancel}
      sibuk={sibuk}
      lebar="md"
    >
      <Field label={`Alasan pembatalan (min. ${MIN_ALASAN_PERINGATAN} karakter)`}>
        <TextInput
          autoFocus
          value={alasan}
          disabled={sibuk}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="cth: salah serah ke panitia lain"
        />
      </Field>
      {pesanError && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800"
        >
          {pesanError}
        </p>
      )}
      {!cukup && (
        <p className="mt-1 text-helper text-stone-500">
          Alasan minimal {MIN_ALASAN_PERINGATAN} karakter setelah spasi di awal
          dan akhir diabaikan.
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={sibuk} onClick={onCancel}>
          Batal
        </Button>
        <Button
          variant="danger"
          disabled={sibuk || !cukup}
          onClick={() => {
            if (!cukup) return;
            onSubmit(rapikanAlasanPeringatan(alasan));
          }}
        >
          {sibuk ? 'Membatalkan…' : 'Ya, batalkan panjar'}
        </Button>
      </div>
    </Modal>
  );
}

/**
 * T-A11: pembatalan khusus dokumen representasi panjar saldo awal. Tidak ada
 * jurnal balik; jurnal pembukaan tidak boleh dibalik dari menu Panjar.
 */
function BatalPanjarSaldoAwalModal({
  target,
  sibuk,
  pesanError,
  onCancel,
  onSubmit,
}: {
  target: Panjar;
  sibuk: boolean;
  pesanError: string | null;
  onCancel: () => void;
  onSubmit: (alasan: string) => void;
}) {
  const [alasan, setAlasan] = useState('');
  const cukup = alasanPeringatanCukup(alasan);

  return (
    <Modal
      judul="Batalkan panjar saldo awal?"
      deskripsi={
        <div className="space-y-2 text-[15px] text-stone-700">
          <p>
            Dokumen representasi saldo awal untuk <b>{target.penerima}</b>{' '}
            sebesar <b>{formatRp(target.jumlah)}</b> akan dihapus.
          </p>
          <p>
            Tidak ada jurnal balik. Jurnal pembukaan <b>{target.jurnal_open_id}</b>{' '}
            tetap utuh dan tidak diubah dari menu Panjar. Bila saldo 1040 di
            jurnal pembukaan memang salah, perbaiki lewat <b>Wizard Koreksi
            Saldo Awal</b>; audit integritas akan menampilkan selisih selama
            saldo itu belum dikoreksi.
          </p>
          <p>
            Hanya boleh untuk panjar saldo awal berstatus Terbuka tanpa item
            realisasi. Tulis alasan minimal {MIN_ALASAN_PERINGATAN} karakter —
            alasan ini tercatat di audit.
          </p>
        </div>
      }
      onTutup={onCancel}
      sibuk={sibuk}
      lebar="md"
    >
      <Field label={`Alasan pembatalan (min. ${MIN_ALASAN_PERINGATAN} karakter)`}>
        <TextInput
          autoFocus
          value={alasan}
          disabled={sibuk}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="cth: saldo awal 1040 sudah tidak beredar"
        />
      </Field>
      {pesanError && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800"
        >
          {pesanError}
        </p>
      )}
      {!cukup && (
        <p className="mt-1 text-helper text-stone-500">
          Alasan minimal {MIN_ALASAN_PERINGATAN} karakter setelah spasi di awal
          dan akhir diabaikan.
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={sibuk} onClick={onCancel}>
          Batal
        </Button>
        <Button
          variant="danger"
          disabled={sibuk || !cukup}
          onClick={() => {
            if (!cukup) return;
            onSubmit(rapikanAlasanPeringatan(alasan));
          }}
        >
          {sibuk ? 'Menghapus…' : 'Ya, hapus representasi'}
        </Button>
      </div>
    </Modal>
  );
}

/** AUD2-03: konfirmasi koreksi pertanggungjawaban panjar CLOSED. */
function KoreksiPertanggungjawabanModal({
  target,
  sibuk,
  pesanError,
  perluKonfirmasi,
  onCancel,
  onSubmit,
}: {
  target: Panjar;
  sibuk: boolean;
  pesanError: string | null;
  perluKonfirmasi: boolean;
  onCancel: () => void;
  onSubmit: (alasan: string, konfirmasiPeringatan: boolean) => void;
}) {
  const [alasan, setAlasan] = useState('');
  const cukup = alasanPeringatanCukup(alasan);

  return (
    <Modal
      judul="Koreksi pertanggungjawaban?"
      deskripsi={
        <div className="space-y-2 text-[15px] text-stone-700">
          <p>
            Pertanggungjawaban panjar <b>{target.penerima}</b> sebesar{' '}
            <b>{formatRp(target.jumlah)}</b> akan dibatalkan lewat jurnal balik.
            Uang Panjar (1040) kembali sebesar panjar dan beban dari rincian lama
            kembali nol.
          </p>
          <p>
            Rincian nota lama dihapus dari dokumen ini, tetapi seluruh datanya
            tetap tersimpan di audit. Panjar kembali <b>Terbuka</b> agar rincian
            yang benar bisa diisi ulang. Jurnal close asli tidak diubah/dihapus.
          </p>
          <p>
            Tulis alasan minimal {MIN_ALASAN_PERINGATAN} karakter — alasan ini
            tercatat di audit.
          </p>
        </div>
      }
      onTutup={onCancel}
      sibuk={sibuk}
      lebar="md"
    >
      <Field label={`Alasan koreksi (min. ${MIN_ALASAN_PERINGATAN} karakter)`}>
        <TextInput
          autoFocus
          value={alasan}
          disabled={sibuk}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="cth: salah akun beban, seharusnya 5010"
        />
      </Field>
      {pesanError && (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800"
        >
          {pesanError}
        </p>
      )}
      {perluKonfirmasi && (
        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
          Jurnal balik memunculkan peringatan posting. Periksa pesan di atas,
          lalu klik tombol di bawah sekali lagi untuk tetap melanjutkan.
        </p>
      )}
      {!cukup && (
        <p className="mt-1 text-helper text-stone-500">
          Alasan minimal {MIN_ALASAN_PERINGATAN} karakter setelah spasi di awal
          dan akhir diabaikan.
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={sibuk} onClick={onCancel}>
          Batal
        </Button>
        <Button
          variant={perluKonfirmasi ? 'danger' : 'primary'}
          disabled={sibuk || !cukup}
          onClick={() => {
            if (!cukup) return;
            onSubmit(rapikanAlasanPeringatan(alasan), perluKonfirmasi);
          }}
        >
          {sibuk
            ? 'Memproses…'
            : perluKonfirmasi
              ? 'Ya, tetap koreksi'
              : 'Koreksi pertanggungjawaban'}
        </Button>
      </div>
    </Modal>
  );
}

export function PanjarTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [list, setList] = useState<Panjar[]>([]);
  // UI-A14: status memuat + gagal muat daftar tampil di kartu Daftar Panjar
  // sendiri, bukan di kartu form; empty state hanya setelah muat sukses.
  const [memuatDaftar, setMemuatDaftar] = useState(true);
  const [errDaftar, setErrDaftar] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [errClose, setErrClose] = useState<string | null>(null);
  const [infoClose, setInfoClose] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<'' | 'OPEN' | 'CLOSED' | 'DIBATALKAN'>('');
  const [batalTarget, setBatalTarget] = useState<Panjar | null>(null);
  const [busyBatal, setBusyBatal] = useState(false);
  const busyBatalRef = useRef(false);
  const [errBatal, setErrBatal] = useState<string | null>(null);
  const [infoBatal, setInfoBatal] = useState<string | null>(null);
  const [batalSaldoAwalTarget, setBatalSaldoAwalTarget] =
    useState<Panjar | null>(null);
  const [koreksiTarget, setKoreksiTarget] = useState<Panjar | null>(null);
  const [busyKoreksi, setBusyKoreksi] = useState(false);
  const busyKoreksiRef = useRef(false);
  const [errKoreksi, setErrKoreksi] = useState<string | null>(null);
  const [infoKoreksi, setInfoKoreksi] = useState<string | null>(null);
  const [perluKonfirmasiKoreksi, setPerluKonfirmasiKoreksi] = useState(false);
  const [lockRetry, setLockRetry] = useState<null | ((alasan: string) => Promise<void>)>(null);
  const [saldoAwalOpen, setSaldoAwalOpen] = useState(false);
  const saldoAwalTargetRef = useRef<'OPEN' | 'CLOSE'>('OPEN');
  const saldoAwalPendingRef = useRef<{
    konfirmasiPeringatan?: boolean;
    alasanPeringatan?: string;
  }>({});

  // T-A11: pembukaan aktif + form panjar saldo awal.
  const [pembukaan, setPembukaan] = useState<SaldoAwalSaatIniApi | null>(null);
  const [saJumlah, setSaJumlah] = useState(0);
  const [saPenerima, setSaPenerima] = useState('');
  const [saSumber, setSaSumber] = useState('1001');
  const [saCatatan, setSaCatatan] = useState('');
  const [busySaldoAwal, setBusySaldoAwal] = useState(false);
  const busySaldoAwalRef = useRef(false);
  const [errSaldoAwal, setErrSaldoAwal] = useState<string | null>(null);
  const [infoSaldoAwal, setInfoSaldoAwal] = useState<string | null>(null);

  // Form serah
  const [tanggal, setTanggal] = useState(tanggalLokal());
  const [penerima, setPenerima] = useState('');
  const [jumlah, setJumlah] = useState(0);
  const [sumber, setSumber] = useState('1001');
  const [keterangan, setKeterangan] = useState('');
  const [noBukti, setNoBukti] = useState('');
  const [busyOpen, setBusyOpen] = useState(false);
  const busyOpenRef = useRef(false);
  const [pesanKonfirmasiSerah, setPesanKonfirmasiSerah] = useState<string | null>(null);
  const [errorKonfirmasiSerah, setErrorKonfirmasiSerah] = useState<string | null>(null);
  // Alasan periode terkunci disimpan agar retry konfirmasi kas minus tidak
  // kehilangan alasan yang sudah diisi operator.
  const alasanOpenRef = useRef('');

  // Form pertanggungjawaban
  const [closeId, setCloseId] = useState('');
  const [tanggalClose, setTanggalClose] = useState(tanggalLokal());
  const [items, setItems] = useState<ItemRow[]>([barisItemBaru()]);
  const [busyClose, setBusyClose] = useState(false);
  const busyCloseRef = useRef(false);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const [errorKonfirmasi, setErrorKonfirmasi] = useState<string | null>(null);
  const alasanCloseRef = useRef('');
  // UI-A01: target baru yang menunggu konfirmasi sebelum rincian nota lama
  // dikosongkan. `target: null` berarti operator memilih "— pilih panjar —".
  const [gantiTargetPending, setGantiTargetPending] = useState<{
    target: Panjar | null;
  } | null>(null);

  // Rincian item di daftar
  const [detailId, setDetailId] = useState('');
  const [detailItems, setDetailItems] = useState<Record<string, PanjarItem[]>>({});
  const [detailBusy, setDetailBusy] = useState('');
  const detailBusyRef = useRef(false);
  // UI-A11: gagal muat rincian ditampilkan di baris rinciannya, bukan di kartu
  // lain yang jauh dari tombol "Lihat rincian".
  const [errDetail, setErrDetail] = useState<string | null>(null);

  // UI-08: serah dan pertanggungjawaban adalah dua form di tab yang sama.
  // Status kotor disimpan terpisah agar simpan sukses pada satu form tidak
  // menghapus peringatan untuk form lain yang masih berisi.
  const { setDirty } = useTabGuard();
  const [serahDirty, setSerahDirty] = useState(false);
  const [closeDirty, setCloseDirty] = useState(false);

  useEffect(() => {
    setDirty(serahDirty || closeDirty);
  }, [serahDirty, closeDirty, setDirty]);

  // Tab di-unmount saat pindah; jangan biarkan status kotor bocor ke tab lain.
  useEffect(() => () => setDirty(false), [setDirty]);

  const kasList = useMemo(
    () => coa.filter((c) => isAkunKasData(c) && c.aktif !== false),
    [coa],
  );
  const bagaList = useMemo(
    () => coa.filter((c) => c.tipe === 'BEBAN' && c.aktif !== false),
    [coa],
  );
  const namaAkun = useMemo(() => new Map(coa.map((c) => [c.kode, c.nama])), [coa]);
  const labelAkun = (kode: string): string => namaAkun.get(kode) ?? kode;

  async function refresh() {
    setMemuatDaftar(true);
    try {
      const [c, p, sa] = await Promise.all([
        api.coa(),
        // UI-A14: gagal muat daftar ditandai di kartu daftar sendiri, bukan
        // di kartu form yang jauh di atas.
        api.panjarList().catch((e) => {
          setErrDaftar(pesanError(e, PESAN_MUAT_GAGAL));
          return null;
        }),
        // Belum ada pembukaan aktif bukan error: tombol saldo awal disembunyikan.
        api.saldoAwalSaatIni().catch(() => null),
      ]);
      setCoa(c);
      setPembukaan(sa);
      if (p !== null) {
        setErrDaftar(null);
        setList(p);
      }
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setMemuatDaftar(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (coa.length === 0) return;
    const pertama = coa.find(
      (c) => isAkunKasData(c) && c.aktif !== false,
    )?.kode;
    if (pertama)
      setSumber((sebelum) =>
        namaAkun.has(sebelum) && kasList.some((k) => k.kode === sebelum)
          ? sebelum
          : pertama,
      );
  }, [coa, namaAkun, kasList]);

  useEffect(() => {
    if (kasList.length === 0) return;
    setSaSumber((sebelum) =>
      kasList.some((k) => k.kode === sebelum) ? sebelum : kasList[0]!.kode,
    );
  }, [kasList]);

  const shown = list.filter((p) => !fStatus || p.status === fStatus);
  // UI-A14: baris daftar hanya dirender setelah muat sukses dan tidak gagal.
  const daftarSiap = !memuatDaftar && !errDaftar;
  const openList = list.filter((p) => p.status === 'OPEN');
  const closeTarget = openList.find((p) => p.id === closeId);

  const saldo1040Pembukaan =
    pembukaan?.saldo.find((a) => a.akun_kode === '1040')?.nominal ?? 0;
  const adaDokumenSaldoAwal = list.some((p) => p.sumber === 'SALDO_AWAL');
  const formSaldoAwalSah =
    Boolean(pembukaan) &&
    !adaDokumenSaldoAwal &&
    Number.isInteger(saJumlah) &&
    saJumlah > 0 &&
    saJumlah <= saldo1040Pembukaan &&
    Boolean(saSumber);
  // UI-A13: tombol panjar saldo awal tidak boleh mati tanpa alasan; cabang
  // pembukaan/dokumen sudah dijelaskan blok teks di atas tombol.
  const alasanSaldoAwalNonaktif = !formSaldoAwalSah
    ? !saSumber
      ? 'Pilih kas sumber di jurnal pembukaan.'
      : !(Number.isInteger(saJumlah) && saJumlah > 0)
        ? 'Isi jumlah panjar beredar (di atas nol).'
        : saJumlah > saldo1040Pembukaan
          ? `Jumlah melebihi maksimal 1040 yang bisa direpresentasikan (${formatRp(saldo1040Pembukaan)}).`
          : null
    : null;
  const totalRealisasi = items.reduce((s, i) => s + i.nominal, 0);
  const selisih = closeTarget ? closeTarget.jumlah - totalRealisasi : 0;
  const sisa = Math.max(0, selisih);
  const kurang = Math.max(0, -selisih);

  const pratinjauSerah = useMemo<Pratinjau>(() => {
    if (!tanggal || !penerima.trim() || !sumber || !Number.isInteger(jumlah) || jumlah <= 0)
      return { input: null, error: null };
    try {
      return {
        input: buatJurnalPanjarSerah({
          tanggal,
          akunKas: sumber,
          nominal: jumlah,
          keterangan: keterangan.trim() || `Serah panjar ${penerima.trim()}`,
          daftarAkun: coa,
          ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
        }),
        error: null,
      };
    } catch (e) {
      return {
        input: null,
        error: pesanError(e),
      };
    }
  }, [tanggal, penerima, sumber, jumlah, keterangan, noBukti, coa]);

  const pratinjauClose = useMemo<{ hasil: HasilPanjarClose | null; error: string | null }>(() => {
    if (!closeTarget || totalRealisasi <= 0) return { hasil: null, error: null };
    try {
      return {
        hasil: buatJurnalPanjarClose({
          tanggal: tanggalClose,
          penerima: closeTarget.penerima,
          akunKas: closeTarget.akun_kas_sumber,
          jumlahPanjar: closeTarget.jumlah,
          items: items.map((it) => ({
            akun: it.kategori_baga,
            nominal: it.nominal,
            nota_nomor: it.nota_nomor.trim(),
            nota_tanggal: it.nota_tanggal.trim(),
            toko: it.toko.trim(),
            keterangan: it.keterangan.trim(),
          })),
          keterangan: `Pertanggungjawaban panjar ${closeTarget.penerima}`,
          daftarAkun: coa,
        }),
        error: null,
      };
    } catch (e) {
      return {
        hasil: null,
        error: pesanError(e),
      };
    }
  }, [closeTarget, totalRealisasi, tanggalClose, items, coa]);

  const formSerahSah =
    tanggalKalenderValid(tanggal) &&
    Boolean(penerima.trim()) &&
    Boolean(sumber) &&
    Number.isInteger(jumlah) &&
    jumlah > 0;

  const formCloseSah =
    Boolean(closeTarget) &&
    tanggalKalenderValid(tanggalClose) &&
    totalRealisasi > 0 &&
    pratinjauClose.error === null;

  async function submitOpen(
    alasan?: string,
    opsi: {
      konfirmasiPeringatan?: boolean;
      alasanPeringatan?: string;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ): Promise<void> {
    if (busyOpenRef.current) return;
    setErr(null);
    setInfo(null);
    setLockRetry(null);
    // Saat operator mengirim alasan dari modal, biarkan modal tetap terbuka
    // sampai hasil backend diketahui agar penolakan bisa langsung diperbaiki.
    if (opsi.konfirmasiPeringatan !== true) {
      setPesanKonfirmasiSerah(null);
      setErrorKonfirmasiSerah(null);
    }
    setSaldoAwalOpen(false);

    if (!formSerahSah) {
      setErr(
        tanggalKalenderValid(tanggal)
          ? 'Lengkapi penerima, nominal, dan sumber kas terlebih dahulu.'
          : PESAN_TANGGAL_TIDAK_VALID,
      );
      return;
    }

    const alasanPeringatan = rapikanAlasanPeringatan(opsi.alasanPeringatan);
    if (
      opsi.konfirmasiPeringatan === true &&
      !alasanPeringatanCukup(alasanPeringatan)
    ) {
      setPesanKonfirmasiSerah(
        (sebelum) => sebelum ?? PESAN_ALASAN_PERINGATAN_MIN,
      );
      setErrorKonfirmasiSerah(PESAN_ALASAN_PERINGATAN_MIN);
      return;
    }

    if (alasan !== undefined) alasanOpenRef.current = alasan;
    const alasanPakai = alasan ?? (alasanOpenRef.current || undefined);

    saldoAwalTargetRef.current = 'OPEN';
    saldoAwalPendingRef.current = { ...opsi };
    busyOpenRef.current = true;
    setBusyOpen(true);
    try {
      const r = await api.panjarCreate(
        {
          tanggal,
          penerima: penerima.trim(),
          jumlah,
          akunKasSumber: sumber,
          ...(keterangan.trim() ? { keterangan: keterangan.trim() } : {}),
          ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
        },
        alasanPakai,
        {
          konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
          ...(opsi.konfirmasiPeringatan === true && alasanPeringatan
            ? { alasanPeringatan }
            : {}),
          ...opsiSaldoAwal(opsi.konfirmasiTanpaSaldoAwal === true),
        },
      );
      alasanOpenRef.current = '';
      setPesanKonfirmasiSerah(null);
      setErrorKonfirmasiSerah(null);
      setPenerima('');
      setJumlah(0);
      setKeterangan('');
      setNoBukti('');
      setSerahDirty(false);
      await refresh();
      setInfo(
        `Panjar untuk ${r.panjar.penerima} tersimpan` +
          `${r.jurnal?.no_bukti ? ` (${r.jurnal.no_bukti})` : ''} — ${formatRp(r.panjar.jumlah)}. ` +
          'Kas berkurang, Uang Panjar (1040) bertambah.',
      );
    } catch (e) {
      if (adalahErrorSaldoAwal(e)) {
        setPesanKonfirmasiSerah(null);
        setErrorKonfirmasiSerah(null);
        setSaldoAwalOpen(true);
      } else if (isPerluAlasan(e)) {
        setPesanKonfirmasiSerah(null);
        setErrorKonfirmasiSerah(null);
        setLockRetry(() => (a: string) => submitOpen(a));
      } else if (isPerluKonfirmasi(e)) {
        const pesan = pesanError(e);
        setPesanKonfirmasiSerah((sebelum) => sebelum ?? pesan);
        // Penolakan "alasan kurang" ditampilkan di dalam modal agar operator
        // bisa langsung memperbaiki isian yang sama.
        setErrorKonfirmasiSerah(
          opsi.konfirmasiPeringatan === true ? pesan : null,
        );
      } else {
        setPesanKonfirmasiSerah(null);
        setErrorKonfirmasiSerah(null);
        setErr(pesanError(e));
      }
    } finally {
      busyOpenRef.current = false;
      setBusyOpen(false);
    }
  }

  async function submitClose(
    alasan?: string,
    opsi: {
      konfirmasiPeringatan?: boolean;
      konfirmasiKurang?: boolean;
      alasanKurang?: string;
      alasanPeringatan?: string;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ): Promise<void> {
    if (busyCloseRef.current) return;
    setErrClose(null);
    setInfoClose(null);
    setLockRetry(null);
    const konfirmasi =
      opsi.konfirmasiPeringatan === true || opsi.konfirmasiKurang === true;
    // Saat operator mengirim alasan dari modal, biarkan modal tetap terbuka
    // sampai hasil backend diketahui agar penolakan bisa langsung diperbaiki.
    if (!konfirmasi) {
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
    }
    setSaldoAwalOpen(false);

    if (!closeTarget) {
      setErrClose('Pilih panjar yang akan dipertanggungjawabkan.');
      return;
    }
    if (!formCloseSah) {
      setErrClose(
        tanggalKalenderValid(tanggalClose)
          ? 'Lengkapi rincian beban terlebih dahulu.'
          : PESAN_TANGGAL_TIDAK_VALID,
      );
      return;
    }
    if (kurang > 0 && opsi.konfirmasiKurang !== true) {
      setPesanKonfirmasi(
        `Realisasi melebihi panjar sebesar ${formatRp(kurang)}. Tulis alasan minimal ` +
          `${MIN_ALASAN_PERINGATAN} karakter untuk tetap menyimpan.`,
      );
      setErrorKonfirmasi(null);
      return;
    }

    const alasanKonfirmasi = rapikanAlasanPeringatan(
      opsi.alasanPeringatan ?? opsi.alasanKurang,
    );
    if (konfirmasi && !alasanPeringatanCukup(alasanKonfirmasi)) {
      setPesanKonfirmasi((sebelum) => sebelum ?? PESAN_ALASAN_PERINGATAN_MIN);
      setErrorKonfirmasi(PESAN_ALASAN_PERINGATAN_MIN);
      return;
    }

    if (alasan !== undefined) alasanCloseRef.current = alasan;
    const alasanPakai = alasan ?? (alasanCloseRef.current || undefined);

    saldoAwalTargetRef.current = 'CLOSE';
    saldoAwalPendingRef.current = { ...opsi };
    busyCloseRef.current = true;
    setBusyClose(true);
    try {
      const r = await api.panjarClose(
        {
          id: closeTarget.id,
          tanggalClose,
          items: items.map(itemKeInput),
          konfirmasiKurang: opsi.konfirmasiKurang === true,
          konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
          ...(konfirmasi
            ? {
                alasanKurang: alasanKonfirmasi,
                alasanPeringatan: alasanKonfirmasi,
              }
            : {}),
          ...opsiSaldoAwal(opsi.konfirmasiTanpaSaldoAwal === true),
        },
        alasanPakai,
      );
      alasanCloseRef.current = '';
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
      setCloseId('');
      setItems([barisItemBaru()]);
      setDetailId('');
      setDetailItems({});
      setCloseDirty(false);
      await refresh();
      // UI-A11: info koreksi lama tidak boleh menempel di seksi PJ saat form
      // ini dipakai untuk pertanggungjawaban normal.
      setInfoKoreksi(null);
      setInfoClose(
        `Pertanggungjawaban tersimpan. Belanja ${formatRp(r.totalRealisasi)}` +
          (r.sisa > 0 ? `, sisa ${formatRp(r.sisa)} kembali ke kas.` : '') +
          (r.kurang > 0 ? `, kurang ${formatRp(r.kurang)} dibayar dari kas sumber.` : '.'),
      );
    } catch (e) {
      if (adalahErrorSaldoAwal(e)) {
        setSaldoAwalOpen(true);
      } else if (isPerluAlasan(e)) {
        // Alasan kunci periode terpisah; opsi konfirmasi (termasuk alasan
        // overrun/peringatan) dipertahankan agar tidak diminta ulang.
        const opsiLanjut = { ...opsi };
        setLockRetry(() => (a: string) => submitClose(a, opsiLanjut));
      } else if (isPerluKonfirmasi(e)) {
        const pesan = pesanError(e);
        setPesanKonfirmasi((sebelum) => sebelum ?? pesan);
        setErrorKonfirmasi(konfirmasi ? pesan : null);
      } else {
        setErrClose(pesanError(e));
      }
    } finally {
      busyCloseRef.current = false;
      setBusyClose(false);
    }
  }

  async function submitBatal(alasan: string): Promise<void> {
    if (!batalTarget || busyBatalRef.current) return;
    const alasanBersih = rapikanAlasanPeringatan(alasan);
    setErrBatal(null);
    if (!alasanPeringatanCukup(alasanBersih)) {
      setErrBatal('Alasan pembatalan panjar wajib diisi minimal 5 karakter.');
      return;
    }
    setLockRetry(null);
    busyBatalRef.current = true;
    setBusyBatal(true);
    try {
      const r = await api.panjarBatal(batalTarget.id, alasanBersih);
      // UI-A01: bila panjar yang dibatalkan sedang jadi target form
      // pertanggungjawaban, kosongkan form itu agar isian lama tidak menggantung.
      const pjDikosongkan = closeId === batalTarget.id;
      setBatalTarget(null);
      setErrBatal(null);
      setDetailId('');
      setDetailItems({});
      if (pjDikosongkan) kosongkanFormClose();
      await refresh();
      setInfoBatal(
        `Panjar untuk ${r.panjar.penerima} dibatalkan. Jurnal balik dibuat; ` +
          `Uang Panjar (1040) dan kas sumber kembali seperti sebelum panjar. ` +
          `Jurnal asli tetap tersimpan.` +
          (pjDikosongkan ? ' Form pertanggungjawaban terkait dikosongkan.' : ''),
      );
    } catch (e) {
      if (isPerluAlasan(e)) {
        // Alasan pembatalan (>= 5 karakter) yang sama juga memenuhi kunci
        // periode, jadi operator tidak perlu mengetik ulang.
        setLockRetry(() => (a: string) => submitBatal(a));
      } else {
        setErrBatal(pesanError(e));
      }
    } finally {
      busyBatalRef.current = false;
      setBusyBatal(false);
    }
  }

  async function submitSaldoAwal(): Promise<void> {
    if (busySaldoAwalRef.current) return;
    setErrSaldoAwal(null);
    setInfoSaldoAwal(null);
    if (!pembukaan) {
      setErrSaldoAwal(
        'Belum ada jurnal pembukaan aktif. Catat saldo awal lebih dahulu.',
      );
      return;
    }
    if (!Number.isInteger(saJumlah) || saJumlah <= 0) {
      setErrSaldoAwal('Jumlah panjar saldo awal wajib lebih dari 0.');
      return;
    }
    if (saJumlah > saldo1040Pembukaan) {
      setErrSaldoAwal(
        `Jumlah melebihi saldo 1040 jurnal pembukaan (${formatRp(
          saldo1040Pembukaan,
        )}).`,
      );
      return;
    }
    busySaldoAwalRef.current = true;
    setBusySaldoAwal(true);
    try {
      const r = await api.panjarSaldoAwal({
        jumlah: saJumlah,
        tanggal: pembukaan.tanggal,
        akunKasSumber: saSumber,
        ...(saPenerima.trim() ? { penerima: saPenerima.trim() } : {}),
        ...(saCatatan.trim() ? { catatan: saCatatan.trim() } : {}),
      });
      setSaJumlah(0);
      setSaPenerima('');
      setSaCatatan('');
      await refresh();
      setInfoSaldoAwal(
        `Panjar saldo awal ${formatRp(r.panjar.jumlah)} untuk ` +
          `${r.panjar.penerima} tercatat tanpa jurnal baru. Debit 1040 sudah ada ` +
          `di jurnal pembukaan ${r.panjar.jurnal_open_id}.`,
      );
    } catch (e) {
      setErrSaldoAwal(pesanError(e));
    } finally {
      busySaldoAwalRef.current = false;
      setBusySaldoAwal(false);
    }
  }

  async function submitBatalSaldoAwal(alasan: string): Promise<void> {
    if (!batalSaldoAwalTarget || busyBatalRef.current) return;
    const alasanBersih = rapikanAlasanPeringatan(alasan);
    setErrBatal(null);
    if (!alasanPeringatanCukup(alasanBersih)) {
      setErrBatal(
        'Alasan pembatalan panjar saldo awal wajib diisi minimal 5 karakter.',
      );
      return;
    }
    setLockRetry(null);
    busyBatalRef.current = true;
    setBusyBatal(true);
    try {
      await api.panjarBatalSaldoAwal(batalSaldoAwalTarget.id, alasanBersih);
      const target = batalSaldoAwalTarget;
      // UI-A01: bila dokumen yang dihapus sedang jadi target form
      // pertanggungjawaban, kosongkan form itu juga.
      const pjDikosongkan = closeId === target.id;
      setBatalSaldoAwalTarget(null);
      setErrBatal(null);
      setDetailId('');
      setDetailItems({});
      if (pjDikosongkan) kosongkanFormClose();
      await refresh();
      setInfoBatal(
        `Dokumen panjar saldo awal untuk ${target.penerima} dihapus. ` +
          'Tidak ada jurnal balik; jurnal pembukaan tidak diubah. Bila saldo ' +
          '1040 pembukaan memang salah, koreksi lewat Wizard Koreksi Saldo Awal.' +
          (pjDikosongkan ? ' Form pertanggungjawaban terkait dikosongkan.' : ''),
      );
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockRetry(() => (a: string) => submitBatalSaldoAwal(a));
      } else {
        setErrBatal(pesanError(e));
      }
    } finally {
      busyBatalRef.current = false;
      setBusyBatal(false);
    }
  }

  async function submitKoreksi(
    alasan: string,
    konfirmasiPeringatan = false,
  ): Promise<void> {
    if (!koreksiTarget || busyKoreksiRef.current) return;
    const alasanBersih = rapikanAlasanPeringatan(alasan);
    setErrKoreksi(null);
    if (!alasanPeringatanCukup(alasanBersih)) {
      setErrKoreksi(
        'Alasan koreksi pertanggungjawaban wajib diisi minimal 5 karakter.',
      );
      return;
    }
    const target = koreksiTarget;
    setLockRetry(null);
    busyKoreksiRef.current = true;
    setBusyKoreksi(true);
    try {
      const r = await api.panjarBatalClose(
        { id: target.id, alasan: alasanBersih },
        konfirmasiPeringatan
          ? { konfirmasiPeringatan: true, alasanPeringatan: alasanBersih }
          : {},
      );
      setKoreksiTarget(null);
      setErrKoreksi(null);
      setPerluKonfirmasiKoreksi(false);
      setDetailId('');
      setDetailItems({});
      await refresh();

      // Muat panjar yang baru dibuka ke form pertanggungjawaban. Tanggal lama
      // dipakai lagi bila masih valid agar koreksi tidak menggeser periode.
      const tanggalIsi =
        target.tanggal_close && target.tanggal_close >= target.tanggal
          ? target.tanggal_close
          : tanggalLokal() < target.tanggal
            ? target.tanggal
            : tanggalLokal();
      setCloseId(target.id);
      setTanggalClose(tanggalIsi);
      setItems([barisItemBaru(tanggalIsi)]);
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
      setErrClose(null);
      setInfoClose(null);
      setCloseDirty(false);
      setInfoKoreksi(
        `Pertanggungjawaban ${target.penerima} dikoreksi. Jurnal balik ` +
          `${r.jurnal?.no_bukti || r.jurnal?.id || ''} dibuat; Uang Panjar ` +
          `(1040) kembali ${formatRp(target.jumlah)} dan beban lama kembali nol. ` +
          'Rincian item lama tersimpan di audit. Panjar sudah dimuat ke form ' +
          'pertanggungjawaban untuk diisi ulang.',
      );
      if (typeof document !== 'undefined') {
        document.getElementById('panjar-pertanggungjawaban')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockRetry(
          () => (a: string) => submitKoreksi(a, konfirmasiPeringatan),
        );
      } else if (isPerluKonfirmasi(e)) {
        setPerluKonfirmasiKoreksi(true);
        setErrKoreksi(pesanError(e));
      } else {
        setErrKoreksi(pesanError(e));
      }
    } finally {
      busyKoreksiRef.current = false;
      setBusyKoreksi(false);
    }
  }

  /** UI-A01: isi ulang form pertanggungjawaban untuk panjar target baru. */
  function terapkanTargetClose(p: Panjar): void {
    setCloseId(p.id);
    setTanggalClose(tanggalLokal() < p.tanggal ? p.tanggal : tanggalLokal());
    setItems([barisItemBaru()]);
    setPesanKonfirmasi(null);
    setErrorKonfirmasi(null);
    setErrClose(null);
    setInfoClose(null);
    // Prefill terprogram (bukan ketikan operator) tidak menandai form kotor.
    // Memilih target lain juga mengganti seluruh rincian form ini.
    setCloseDirty(false);
    // Gulir ke form pertanggungjawaban (operator awam tidak perlu mencari).
    if (typeof document !== 'undefined') {
      document.getElementById('panjar-pertanggungjawaban')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }

  /** UI-A01: kembalikan form pertanggungjawaban ke keadaan kosong awal. */
  function kosongkanFormClose(): void {
    setCloseId('');
    setItems([barisItemBaru()]);
    setPesanKonfirmasi(null);
    setErrorKonfirmasi(null);
    setErrClose(null);
    setInfoClose(null);
    setCloseDirty(false);
  }

  function pilihUntukClose(p: Panjar) {
    // UI-A01: ganti target saat form masih kotor wajib konfirmasi dulu agar
    // rincian nota yang sudah diketik operator tidak hilang diam-diam.
    if (closeDirty && p.id !== closeId) {
      setGantiTargetPending({ target: p });
      return;
    }
    terapkanTargetClose(p);
  }

  function ubahItem(i: number, patch: Partial<ItemRow>): void {
    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setCloseDirty(true);
  }

  async function toggleDetail(id: string) {
    if (detailBusyRef.current) return;
    if (detailId === id) {
      setDetailId('');
      setErrDetail(null);
      return;
    }
    setDetailId(id);
    setErrDetail(null);
    if (detailItems[id]) return;
    detailBusyRef.current = true;
    setDetailBusy(id);
    try {
      const its = await api.panjarItems(id);
      setDetailItems((prev) => ({ ...prev, [id]: its }));
    } catch (e) {
      setErrDetail(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      detailBusyRef.current = false;
      setDetailBusy('');
    }
  }

  /** Data export = panjar yang sedang ditampilkan + rincian itemnya. */
  async function dataPanjarExport() {
    return Promise.all(
      shown.map(async (p) => ({
        ...p,
        items: detailItems[p.id] ?? (await api.panjarItems(p.id)),
      })),
    );
  }

  const rentangPanjar = rentangDariRows(shown);
  const namaDasarPanjar = `panjar-${fStatus ? `${fStatus.toLowerCase()}-` : ''}${periodeFile(
    rentangPanjar.mulai,
    rentangPanjar.sampai,
  )}`;

  const labelSerah = (index: number, akun: string): string =>
    index === 0 ? `Uang Panjar (1040) — bertambah` : `Kas sumber — ${labelAkun(akun)} berkurang`;

  const labelClose = (
    _index: number,
    akun: string,
    debit: number,
    kredit: number,
  ): string => {
    if (akun === '1040') return 'Uang Panjar (1040) — dihabiskan';
    if (closeTarget && akun === closeTarget.akun_kas_sumber && debit > 0)
      return `Sisa kembali ke kas — ${labelAkun(akun)}`;
    if (closeTarget && akun === closeTarget.akun_kas_sumber && kredit > 0)
      return `Kekurangan dibayar dari kas — ${labelAkun(akun)}`;
    return `Beban — ${labelAkun(akun)}`;
  };

  function mulaiTanpaSaldoAwal(): void {
    tandaiMulaiTanpaSaldoAwal();
    setSaldoAwalOpen(false);
    const opsi = {
      ...saldoAwalPendingRef.current,
      konfirmasiTanpaSaldoAwal: true,
    };
    if (saldoAwalTargetRef.current === 'CLOSE') void submitClose(undefined, opsi);
    else void submitOpen(undefined, opsi);
  }

  function saldoAwalTersimpan(_pesan: string): void {
    setSaldoAwalOpen(false);
    if (saldoAwalTargetRef.current === 'CLOSE')
      void submitClose(undefined, saldoAwalPendingRef.current);
    else void submitOpen(undefined, saldoAwalPendingRef.current);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">Panjar (Uang Muka)</h1>
            <p className="mt-1 max-w-3xl text-[15px] text-stone-600">
              Serahkan uang muka untuk panitia/kegiatan, lalu catat pertanggungjawabannya.
              Sistem menyusun jurnal otomatis: uang panjar dicatat sebagai aset 1040,
              bukan langsung sebagai beban.
            </p>
          </div>
          <Badge tone="green">Jurnal otomatis seimbang</Badge>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Serahkan Panjar</h2>
        <p className="mb-3 text-sm text-stone-600">
          Isi siapa penerimanya, berapa uangnya, dan dari kas mana uang diambil.
        </p>
        <ErrorBox msg={err} />
        {info && (
          <InfoBox className="mb-2">{info}</InfoBox>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Tanggal panjar">
            <TextInput
              type="date"
              value={tanggal}
              disabled={busyOpen}
              onChange={(e) => {
                setTanggal(e.target.value);
                setSerahDirty(true);
              }}
            />
          </Field>
          <Field label="Penerima / panitia">
            <TextInput
              value={penerima}
              disabled={busyOpen}
              placeholder="cth: Panitia Piodalan"
              onChange={(e) => {
                setPenerima(e.target.value);
                setSerahDirty(true);
              }}
            />
          </Field>
          <Field label="Jumlah panjar (Rp)">
            <CurrencyInput
              value={jumlah}
              disabled={busyOpen}
              onChange={(n) => {
                setJumlah(n);
                setSerahDirty(true);
              }}
            />
          </Field>
          <Field label="Diambil dari kas / bank">
            <Select
              value={sumber}
              disabled={busyOpen}
              onChange={(e) => {
                setSumber(e.target.value);
                setSerahDirty(true);
              }}
            >
              {kasList.map((k) => (
                <option key={k.kode} value={k.kode}>
                  {k.kode} — {k.nama}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Keterangan (opsional)">
            <TextInput
              value={keterangan}
              disabled={busyOpen}
              placeholder="cth: Panjar kegiatan piodalan"
              onChange={(e) => {
                setKeterangan(e.target.value);
                setSerahDirty(true);
              }}
            />
          </Field>
          <div>
            <Field label="No. bukti (opsional)">
              <TextInput
                value={noBukti}
                disabled={busyOpen}
                placeholder="cth: JU-2026-0001 — boleh kosong"
                onChange={(e) => {
                  setNoBukti(e.target.value);
                  setSerahDirty(true);
                }}
              />
            </Field>
            <SaranNomorBukti tanggal={tanggal} />
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <h3 className="font-bold">Pratinjau Jurnal Serah Panjar</h3>
          <p className="mt-1 text-sm text-stone-600">
            Uang keluar dari kas, tetapi belum menjadi beban — dicatat sebagai Uang Panjar
            (1040) sampai dipertanggungjawabkan.
          </p>
          {pratinjauSerah.error ? (
            <p className="mt-2 text-sm text-red-700">{pratinjauSerah.error}</p>
          ) : pratinjauSerah.input ? (
            <TabelPratinjau input={pratinjauSerah.input} labelBaris={labelSerah} />
          ) : (
            <p className="mt-2 text-sm text-stone-500">
              Pratinjau muncul setelah penerima, jumlah, dan sumber kas diisi.
            </p>
          )}
        </div>

        {pesanKonfirmasiSerah && (
          <PeringatanModal
            pesan={pesanKonfirmasiSerah}
            pesanError={errorKonfirmasiSerah}
            sibuk={busyOpen}
            onCancel={() => {
              setPesanKonfirmasiSerah(null);
              setErrorKonfirmasiSerah(null);
            }}
            onSubmit={(alasan) => {
              void submitOpen(undefined, {
                konfirmasiPeringatan: true,
                alasanPeringatan: alasan,
              });
            }}
          />
        )}

        <div className="mt-4">
          <Button
            disabled={busyOpen || !formSerahSah}
            onClick={() => void submitOpen()}
          >
            {busyOpen ? 'Menyimpan…' : 'Serahkan Panjar'}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="mb-1 text-lg font-bold">Panjar Saldo Awal (Cut-over)</h2>
            <p className="text-sm text-stone-600">
              Bila saat pembukaan masih ada uang panjar yang beredar, catat
              dokumennya di sini. Sistem <b>tidak membuat jurnal baru</b> karena
              debit 1040 sudah ada di jurnal pembukaan; dokumen ini hanya
              representasi agar saldo 1040 bisa direkonsiliasi.
            </p>
          </div>
          {adaDokumenSaldoAwal && <Badge tone="stone">Sudah tercatat</Badge>}
        </div>
        <ErrorBox msg={errSaldoAwal} />
        {infoSaldoAwal && (
          <InfoBox className="mb-2 mt-2">{infoSaldoAwal}</InfoBox>
        )}
        {!pembukaan ? (
          <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px] text-stone-600">
            Belum ada jurnal pembukaan aktif. Catat atau koreksi saldo awal
            terlebih dahulu; setelah itu alur ini muncul otomatis.
          </p>
        ) : adaDokumenSaldoAwal ? (
          <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px] text-stone-700">
            Jurnal pembukaan {pembukaan.tanggal} sudah punya satu dokumen panjar
            saldo awal. Satu jurnal pembukaan hanya boleh punya satu dokumen;
            gunakan tombol pembatalan khusus di daftar bila representasi itu
            salah.
          </p>
        ) : saldo1040Pembukaan <= 0 ? (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
            Jurnal pembukaan aktif tidak memuat saldo 1040 Uang Panjar, sehingga
            tidak ada panjar saldo awal yang bisa dicatat. Periksa jurnal
            pembukaan atau alur koreksi saldo awal.
          </p>
        ) : (
          <>
            <p className="mt-2 text-sm text-stone-600">
              Tanggal mengikuti jurnal pembukaan <b>{pembukaan.tanggal}</b>.
              Maksimal 1040 yang bisa direpresentasikan:{' '}
              <b>{formatRp(saldo1040Pembukaan)}</b>.
            </p>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Penerima / panitia (opsional)">
                <TextInput
                  value={saPenerima}
                  disabled={busySaldoAwal}
                  placeholder="cth: Panitia yang masih memegang panjar"
                  onChange={(e) => setSaPenerima(e.target.value)}
                />
              </Field>
              <Field label="Jumlah panjar beredar (Rp)">
                <CurrencyInput
                  value={saJumlah}
                  disabled={busySaldoAwal}
                  onChange={(n) => setSaJumlah(n)}
                />
              </Field>
              <Field label="Kas sumber di jurnal pembukaan">
                <Select
                  value={saSumber}
                  disabled={busySaldoAwal}
                  onChange={(e) => setSaSumber(e.target.value)}
                >
                  {kasList.map((k) => (
                    <option key={k.kode} value={k.kode}>
                      {k.kode} — {k.nama}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="mt-3">
              <Field label="Catatan (opsional, tercatat di audit)">
                <TextInput
                  value={saCatatan}
                  disabled={busySaldoAwal}
                  placeholder="cth: panjar kegiatan yang belum dipertanggungjawabkan"
                  onChange={(e) => setSaCatatan(e.target.value)}
                />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button
                disabled={busySaldoAwal || !formSaldoAwalSah}
                title={alasanTombolNonaktif({
                  sibuk: busySaldoAwal,
                  alasan: alasanSaldoAwalNonaktif,
                })}
                onClick={() => void submitSaldoAwal()}
              >
                {busySaldoAwal ? 'Menyimpan…' : 'Catat Panjar Saldo Awal'}
              </Button>
              <span className="text-sm text-stone-500">
                Tidak ada jurnal serah baru; 1040 pembukaan dihitung satu kali.
              </span>
            </div>
          </>
        )}
      </Card>

      <Card>
        <div id="panjar-pertanggungjawaban">
          <h2 className="mb-1 text-lg font-bold">Pertanggungjawaban Panjar</h2>
          <p className="mb-3 text-sm text-stone-600">
            Pilih panjar yang masih terbuka, masukkan rincian belanja per jenis (baga), lalu
            periksa sisa atau kekurangannya. Uang panjar (1040) akan kembali nol.
          </p>
        </div>
        <ErrorBox msg={errClose} />
        {infoClose && (
          <InfoBox className="mb-2">{infoClose}</InfoBox>
        )}
        {/* UI-A11: hasil koreksi ditampilkan di seksi form PJ — layar sudah
            digulir ke sini setelah koreksi, jadi info muncul dekat aksinya. */}
        {infoKoreksi && (
          <InfoBox className="mb-2">{infoKoreksi}</InfoBox>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Panjar yang dipertanggungjawabkan">
            <Select
              value={closeId}
              disabled={busyClose}
              onChange={(e) => {
                const p = openList.find((x) => x.id === e.target.value);
                if (p) pilihUntukClose(p);
                else if (closeDirty) {
                  // UI-A01: mengosongkan target juga menyembunyikan grid nota,
                  // jadi form yang masih berisi wajib dikonfirmasi dulu.
                  setGantiTargetPending({ target: null });
                } else {
                  setCloseId('');
                  setCloseDirty(false);
                }
              }}
            >
              <option value="">— pilih panjar —</option>
              {openList.map((p) => (
                <option key={p.id} value={p.id}>
                  {formatTanggal(p.tanggal)} — {p.penerima} — {formatRp(p.jumlah)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tanggal realisasi / belanja">
            <TextInput
              type="date"
              value={tanggalClose}
              min={closeTarget?.tanggal}
              disabled={busyClose}
              onChange={(e) => {
                setTanggalClose(e.target.value);
                setCloseDirty(true);
              }}
            />
          </Field>
        </div>

        {closeTarget && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px]">
            Panjar dari <b>{labelAkun(closeTarget.akun_kas_sumber)}</b> sebesar{' '}
            <b>{formatRp(closeTarget.jumlah)}</b>.
          </div>
        )}

        {closeTarget && (
          <PeringatanTahunPertanggungjawaban
            tanggalClose={tanggalClose}
            tanggalPanjar={closeTarget.tanggal}
            notaTanggal={items.map((it) => it.nota_tanggal)}
          />
        )}

        {/* UI-A01: grid nota hanya tampil saat ada panjar target. Sebelum
            target dipilih tidak ada isian yang bisa hilang diam-diam. */}
        {closeTarget && (
          <div className="mt-3 space-y-3">
            {items.map((it, i) => (
              <div
                key={i}
                className="rounded-xl border border-stone-200 bg-stone-50 p-3"
              >
                <div className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_150px_1fr_auto]">
                  <Field label="Nomor nota">
                    <TextInput
                      value={it.nota_nomor}
                      disabled={busyClose}
                      placeholder="cth: 001/NOTA/2026"
                      onChange={(e) => ubahItem(i, { nota_nomor: e.target.value })}
                    />
                  </Field>
                  <Field label="Tanggal nota">
                    <TextInput
                      type="date"
                      value={it.nota_tanggal}
                      max={tanggalClose || undefined}
                      disabled={busyClose}
                      onChange={(e) => ubahItem(i, { nota_tanggal: e.target.value })}
                    />
                  </Field>
                  <Field label="Toko / penerima nota">
                    <TextInput
                      value={it.toko}
                      disabled={busyClose}
                      placeholder="cth: Toko Bangunan Jaya"
                      onChange={(e) => ubahItem(i, { toko: e.target.value })}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    disabled={busyClose || items.length === 1}
                    onClick={() => {
                      setItems((xs) => xs.filter((_, j) => j !== i));
                      setCloseDirty(true);
                    }}
                  >
                    Hapus
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_180px_1fr]">
                  <Field label="Akun beban">
                    <Select
                      value={it.kategori_baga}
                      disabled={busyClose}
                      onChange={(e) => ubahItem(i, { kategori_baga: e.target.value })}
                    >
                      {bagaList.map((b) => (
                        <option key={b.kode} value={b.kode}>
                          {b.kode} — {b.nama}
                        </option>
                      ))}
                    </Select>
                    <PetunjukAkunKembar kode={it.kategori_baga} />
                  </Field>
                  <Field label="Nominal (Rp)">
                    <CurrencyInput
                      value={it.nominal}
                      disabled={busyClose}
                      onChange={(n) => ubahItem(i, { nominal: n })}
                    />
                  </Field>
                  <Field label="Keterangan baris (opsional)">
                    <TextInput
                      value={it.keterangan}
                      disabled={busyClose}
                      placeholder="cth: beli bahan bangunan"
                      onChange={(e) => ubahItem(i, { keterangan: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            ))}
            <Button
              variant="ghost"
              disabled={busyClose}
              onClick={() => {
                setItems((xs) => [...xs, barisItemBaru(tanggalClose)]);
                setCloseDirty(true);
              }}
            >
              + Tambah baris nota
            </Button>
          </div>
        )}

        {closeTarget && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[15px]">
            {/* UI-A01: sisa/kurang hanya masuk akal setelah ada rincian nota. */}
            {totalRealisasi > 0 ? (
              <>
                <p>
                  Total belanja: <b>{formatRp(totalRealisasi)}</b> dari panjar{' '}
                  <b>{formatRp(closeTarget.jumlah)}</b>.
                </p>
                {selisih > 0 && (
                  <p className="mt-1 font-semibold text-green-700">
                    Sisa {formatRp(sisa)} — kembali ke kas sumber dan mengurangi Uang Panjar.
                  </p>
                )}
                {selisih < 0 && (
                  <p className="mt-1 font-semibold text-red-700">
                    Kurang {formatRp(kurang)} — dibayar dari kas sumber.
                  </p>
                )}
                {selisih === 0 && (
                  <p className="mt-1 font-semibold">Pas — tidak ada sisa/kurang.</p>
                )}
              </>
            ) : (
              <p className="text-stone-500">
                Belum ada rincian belanja. Isi nota untuk melihat sisa/kurang.
              </p>
            )}
          </div>
        )}

        {kurang > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900">
            <p>
              Kekurangan <b>{formatRp(kurang)}</b> akan dibayar dari kas sumber{' '}
              <b>{labelAkun(closeTarget?.akun_kas_sumber ?? '')}</b>. Sistem tidak
              memblokir, tetapi saat menyimpan Anda wajib menulis alasan minimal{' '}
              {MIN_ALASAN_PERINGATAN} karakter dan alasan itu tercatat di audit.
            </p>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <h3 className="font-bold">Pratinjau Jurnal Pertanggungjawaban</h3>
          <p className="mt-1 text-sm text-stone-600">
            Debit = belanja/sisa, kredit = Uang Panjar (1040) dan kekurangan bila ada. Total
            debit dan kredit harus sama.
          </p>
          {pratinjauClose.error ? (
            <p className="mt-2 text-sm text-red-700">{pratinjauClose.error}</p>
          ) : pratinjauClose.hasil ? (
            <TabelPratinjau input={pratinjauClose.hasil.input} labelBaris={labelClose} />
          ) : (
            <p className="mt-2 text-sm text-stone-500">
              Pratinjau muncul setelah panjar dipilih dan rincian belanja diisi.
            </p>
          )}
        </div>

        {pesanKonfirmasi && (
          <PeringatanModal
            pesan={pesanKonfirmasi}
            pesanError={errorKonfirmasi}
            sibuk={busyClose}
            onCancel={() => {
              setPesanKonfirmasi(null);
              setErrorKonfirmasi(null);
            }}
            onSubmit={(alasan) => {
              void submitClose(undefined, {
                konfirmasiKurang: true,
                konfirmasiPeringatan: true,
                alasanKurang: alasan,
                alasanPeringatan: alasan,
              });
            }}
          />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busyClose || !formCloseSah} onClick={() => void submitClose()}>
            {busyClose ? 'Menyimpan…' : 'Simpan Pertanggungjawaban'}
          </Button>
          <span className="text-sm text-stone-500">
            Setelah disimpan, 1040 untuk panjar ini kembali nol. Bila realisasi melebihi
            panjar, sistem akan meminta alasan minimal {MIN_ALASAN_PERINGATAN} karakter.
          </span>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <h2 className="shrink-0 whitespace-nowrap text-lg font-bold">Daftar Panjar</h2>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <Select
              value={fStatus}
              onChange={(e) =>
                setFStatus(e.target.value as '' | 'OPEN' | 'CLOSED' | 'DIBATALKAN')
              }
            >
              <option value="">Semua status</option>
              {/* UI-A17: istilah filter = istilah badge daftar (Terbuka/
                  Selesai/Dibatalkan), bukan Belum/Sudah. */}
              <option value="OPEN">Terbuka</option>
              <option value="CLOSED">Selesai</option>
              <option value="DIBATALKAN">Dibatalkan</option>
            </Select>
            <ExportActions
              namaDasar={namaDasarPanjar}
              judul="Panjar (Uang Muka)"
              disabled={shown.length === 0}
              buatWorkbook={(kop) =>
                dataPanjarExport().then((daftar) => panjarToWorkbook(daftar, coa, kop))
              }
              buatDokumen={(kop) =>
                dataPanjarExport().then((daftar) => panjarPrintDoc(daftar, coa, { kop }))
              }
            />
          </div>
        </div>
        <ErrorBox msg={errBatal} />
        {infoBatal && (
          <InfoBox className="mb-2">{infoBatal}</InfoBox>
        )}
        <ErrorBox msg={errKoreksi} />
        {/* UI-A18: paragraf ±10 baris diringkas jadi 3 bullet pendek. */}
        <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-stone-600">
          <li>
            <b>Terbuka</b> bisa dibatalkan lewat <b>Batalkan</b>: kas kembali via
            jurnal balik (1040 nol), wajib alasan minimal{' '}
            {MIN_ALASAN_PERINGATAN} karakter, status jadi <b>Dibatalkan</b>;
            jurnal serah asli tidak dihapus.
          </li>
          <li>
            <b>Selesai</b> yang salah input dikoreksi lewat{' '}
            <b>Koreksi Pertanggungjawaban</b>: jurnal balik dibuat, panjar
            kembali <b>Terbuka</b> untuk diisi ulang; rincian item lama dihapus
            dari dokumen tetapi tersimpan di audit.
          </li>
          <li>
            Berlabel <b>Saldo awal</b> (representasi 1040 dari jurnal pembukaan):
            ditutup lewat alur normal setelah ada realisasi; pembatalannya tanpa
            jurnal balik.
          </li>
        </ul>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Tanggal</th>
                <th className="py-2 pr-3">Penerima</th>
                <th className="py-2 pr-3">Sumber</th>
                <th className="py-2 pr-3 text-right">Jumlah</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3 text-right">Realisasi / sisa</th>
                <th className="py-2">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {memuatDaftar && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-stone-500">
                    Memuat daftar panjar…
                  </td>
                </tr>
              )}
              {!memuatDaftar && errDaftar && (
                <tr>
                  <td colSpan={7} className="py-2">
                    {/* UI-A14: gagal muat daftar tampil di kartu ini sendiri,
                        bukan di kartu form. */}
                    <ErrorBox msg={errDaftar} />
                  </td>
                </tr>
              )}
              {daftarSiap && shown.map((p) => {
                const realisasi = p.total_realisasi ?? 0;
                const realisasiPerAkun =
                  detailId === p.id ? totalPanjarPerAkun(detailItems[p.id] ?? []) : [];
                return (
                  <Fragment key={p.id}>
                    <tr className="border-b last:border-0 align-top">
                      <td className="py-2 pr-3 whitespace-nowrap">{formatTanggal(p.tanggal)}</td>
                      <td className="py-2 pr-3">{p.penerima}</td>
                      <td className="py-2 pr-3">{labelAkun(p.akun_kas_sumber)}</td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {formatRp(p.jumlah)}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge
                          tone={
                            p.status === 'OPEN'
                              ? 'amber'
                              : p.status === 'CLOSED'
                                ? 'green'
                                : 'red'
                          }
                        >
                          {p.status === 'OPEN'
                            ? 'Terbuka'
                            : p.status === 'CLOSED'
                              ? 'Selesai'
                              : 'Dibatalkan'}
                        </Badge>
                        {p.sumber === 'SALDO_AWAL' && (
                          <div className="mt-1">
                            <Badge tone="stone">Saldo awal</Badge>
                          </div>
                        )}
                        {p.status === 'DIBATALKAN' && p.tanggal_batal && (
                          <div className="mt-1 text-helper text-stone-500">
                            {formatTanggal(p.tanggal_batal)}
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {p.status === 'CLOSED' ? (
                          <>
                            <div>{formatRp(realisasi)}</div>
                            {(p.kurang ?? 0) > 0 ? (
                              <div className="text-helper font-semibold text-red-700">
                                kurang {formatRp(p.kurang ?? 0)}
                              </div>
                            ) : (
                              <div className="text-helper text-green-700">
                                sisa {formatRp(p.sisa ?? 0)}
                              </div>
                            )}
                          </>
                        ) : (
                          <span className="text-stone-500">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {p.status === 'OPEN' && (
                            <Button variant="ghost" onClick={() => pilihUntukClose(p)}>
                              Pertanggungjawaban
                            </Button>
                          )}
                          {p.status === 'OPEN' && p.sumber !== 'SALDO_AWAL' && (
                            <Button
                              variant="danger"
                              disabled={busyBatal}
                              onClick={() => {
                                setErrBatal(null);
                                setInfoBatal(null);
                                setBatalTarget(p);
                              }}
                            >
                              Batalkan
                            </Button>
                          )}
                          {p.status === 'OPEN' && p.sumber === 'SALDO_AWAL' && (
                            <Button
                              variant="danger"
                              disabled={busyBatal}
                              onClick={() => {
                                setErrBatal(null);
                                setInfoBatal(null);
                                setBatalSaldoAwalTarget(p);
                              }}
                            >
                              Batalkan saldo awal
                            </Button>
                          )}
                          {p.status === 'CLOSED' && (
                            <Button
                              variant="ghost"
                              disabled={busyKoreksi}
                              onClick={() => {
                                setErrKoreksi(null);
                                setInfoKoreksi(null);
                                setPerluKonfirmasiKoreksi(false);
                                setKoreksiTarget(p);
                              }}
                            >
                              Koreksi Pertanggungjawaban
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => void toggleDetail(p.id)}>
                            {detailId === p.id ? 'Tutup rincian' : 'Lihat rincian'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {detailId === p.id && (
                      <tr className="border-b bg-stone-50 last:border-0">
                        <td colSpan={7} className="px-3 py-3">
                          {/* UI-A11: gagal muat rincian tampil di baris ini,
                              dekat tombol "Lihat rincian" yang dipakai. */}
                          <ErrorBox msg={errDetail} />
                          {detailBusy === p.id ? (
                            <p className="text-stone-500">Memuat rincian…</p>
                          ) : errDetail ? null : (detailItems[p.id]?.length ?? 0) > 0 ? (
                            <>
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="text-stone-500">
                                    <th className="py-1 pr-3">No. nota</th>
                                    <th className="py-1 pr-3">Tgl nota</th>
                                    <th className="py-1 pr-3">Toko / penerima</th>
                                    <th className="py-1 pr-3">Jenis belanja</th>
                                    <th className="py-1 pr-3 text-right">Nominal</th>
                                    <th className="py-1 pr-3">Keterangan</th>
                                    <th className="py-1">Jurnal</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {detailItems[p.id]!.map((it) => (
                                    <tr key={it.id ?? `${it.kategori_baga}-${it.nominal}`}>
                                      <td className="py-1 pr-3">{it.nota_nomor || '—'}</td>
                                      <td className="py-1 pr-3 whitespace-nowrap">
                                        {it.nota_tanggal ? formatTanggal(it.nota_tanggal) : '—'}
                                      </td>
                                      <td className="py-1 pr-3">{it.toko || '—'}</td>
                                      <td className="py-1 pr-3">{labelAkun(it.kategori_baga)}</td>
                                      <td className="py-1 pr-3 text-right">
                                        {formatRp(it.nominal)}
                                      </td>
                                      <td className="py-1 pr-3">{it.keterangan || '—'}</td>
                                      <td className="py-1 text-xs text-stone-500">
                                        {it.jurnal_id ?? '—'}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                              <div className="mt-3 flex flex-wrap items-start gap-x-4 gap-y-1 border-t pt-2 text-sm">
                                <span className="font-semibold">Total per akun:</span>
                                {realisasiPerAkun.map((a) => (
                                  <span key={a.akun}>
                                    {labelAkun(a.akun)} = {formatRp(a.nominal)}
                                  </span>
                                ))}
                                <span className="font-semibold">
                                  Total realisasi = {formatRp(realisasi)}
                                </span>
                              </div>
                            </>
                          ) : (
                            <p className="text-stone-500">
                              Belum ada rincian. Rincian muncul setelah pertanggungjawaban
                              disimpan.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {/* UI-A14: bedakan benar-benar kosong dengan filter yang tidak
                  menemukan apa pun. */}
              {daftarSiap && shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-stone-500">
                    {fStatus
                      ? 'Tidak ada panjar yang cocok dengan filter.'
                      : 'Belum ada panjar.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {batalTarget && (
        <BatalPanjarModal
          target={batalTarget}
          sibuk={busyBatal}
          pesanError={errBatal}
          onCancel={() => {
            if (busyBatal) return;
            setBatalTarget(null);
            setErrBatal(null);
          }}
          onSubmit={(alasan) => void submitBatal(alasan)}
        />
      )}

      {batalSaldoAwalTarget && (
        <BatalPanjarSaldoAwalModal
          target={batalSaldoAwalTarget}
          sibuk={busyBatal}
          pesanError={errBatal}
          onCancel={() => {
            if (busyBatal) return;
            setBatalSaldoAwalTarget(null);
            setErrBatal(null);
          }}
          onSubmit={(alasan) => void submitBatalSaldoAwal(alasan)}
        />
      )}

      {koreksiTarget && (
        <KoreksiPertanggungjawabanModal
          target={koreksiTarget}
          sibuk={busyKoreksi}
          pesanError={errKoreksi}
          perluKonfirmasi={perluKonfirmasiKoreksi}
          onCancel={() => {
            if (busyKoreksi) return;
            setKoreksiTarget(null);
            setErrKoreksi(null);
            setPerluKonfirmasiKoreksi(false);
          }}
          onSubmit={(alasan, konfirmasi) =>
            void submitKoreksi(alasan, konfirmasi)
          }
        />
      )}

      {gantiTargetPending && (
        <KonfirmasiModal
          judul="Ganti panjar?"
          deskripsi="Rincian yang sudah diisi akan kosong."
          labelYa="Ya, ganti panjar"
          sibuk={busyClose}
          onBatal={() => setGantiTargetPending(null)}
          onKonfirmasi={() => {
            const target = gantiTargetPending.target;
            setGantiTargetPending(null);
            if (target) terapkanTargetClose(target);
            else kosongkanFormClose();
          }}
        />
      )}

      {lockRetry && (
        <LockModal
          onCancel={() => {
            alasanOpenRef.current = '';
            alasanCloseRef.current = '';
            setLockRetry(null);
          }}
          onSubmit={(a) => {
            setLockRetry(null);
            void lockRetry(a);
          }}
        />
      )}

      <SaldoAwalGuard
        terbuka={saldoAwalOpen}
        coa={coa}
        sibuk={saldoAwalTargetRef.current === 'CLOSE' ? busyClose : busyOpen}
        onBatal={() => setSaldoAwalOpen(false)}
        onMulaiTanpa={mulaiTanpaSaldoAwal}
        onSaldoAwalTersimpan={saldoAwalTersimpan}
      />
    </div>
  );
}
