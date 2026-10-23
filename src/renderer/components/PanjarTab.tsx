import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { isAkunKas } from '../../db/coa.js';
import type { Coa } from '../../db/coa.js';
import {
  buatJurnalPanjarClose,
  buatJurnalPanjarSerah,
  type HasilPanjarClose,
} from '../../core/forms.js';
import type { JurnalInput } from '../../core/posting.js';
import type { Panjar, PanjarItem } from '../../core/types.js';
import {
  panjarToWorkbook,
  periodeFile,
  rentangDariRows,
} from '../../features/export/workbooks.js';
import { panjarPrintDoc } from '../../features/export/printAdapters.js';
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
import { ExportActions } from './ExportActions.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';

const today = () => new Date().toISOString().slice(0, 10);

type ItemRow = { kategori_baga: string; nominal: number };

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

export function PanjarTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [list, setList] = useState<Panjar[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [errClose, setErrClose] = useState<string | null>(null);
  const [infoClose, setInfoClose] = useState<string | null>(null);
  const [fStatus, setFStatus] = useState<'' | 'OPEN' | 'CLOSED'>('');
  const [lockRetry, setLockRetry] = useState<null | ((alasan: string) => Promise<void>)>(null);

  // Form serah
  const [tanggal, setTanggal] = useState(today());
  const [penerima, setPenerima] = useState('');
  const [jumlah, setJumlah] = useState(0);
  const [sumber, setSumber] = useState('1001');
  const [keterangan, setKeterangan] = useState('');
  const [noBukti, setNoBukti] = useState('');
  const [busyOpen, setBusyOpen] = useState(false);
  const [pesanKonfirmasiSerah, setPesanKonfirmasiSerah] = useState<string | null>(null);
  // Alasan periode terkunci disimpan agar retry konfirmasi kas minus tidak
  // kehilangan alasan yang sudah diisi operator.
  const alasanOpenRef = useRef('');

  // Form pertanggungjawaban
  const [closeId, setCloseId] = useState('');
  const [tanggalClose, setTanggalClose] = useState(today());
  const [items, setItems] = useState<ItemRow[]>([{ kategori_baga: '5004', nominal: 0 }]);
  const [setujuKurang, setSetujuKurang] = useState(false);
  const [busyClose, setBusyClose] = useState(false);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const alasanCloseRef = useRef('');

  // Rincian item di daftar
  const [detailId, setDetailId] = useState('');
  const [detailItems, setDetailItems] = useState<Record<string, PanjarItem[]>>({});
  const [detailBusy, setDetailBusy] = useState('');

  const kasList = useMemo(() => coa.filter((c) => isAkunKas(c.kode)), [coa]);
  const bagaList = useMemo(() => coa.filter((c) => c.tipe === 'BEBAN'), [coa]);
  const namaAkun = useMemo(() => new Map(coa.map((c) => [c.kode, c.nama])), [coa]);
  const labelAkun = (kode: string): string => namaAkun.get(kode) ?? kode;

  async function refresh() {
    try {
      const [c, p] = await Promise.all([api.coa(), api.panjarList()]);
      setCoa(c);
      setList(p);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    if (coa.length === 0) return;
    const pertama = coa.find((c) => isAkunKas(c.kode))?.kode;
    if (pertama) setSumber((sebelum) => (sebelum && namaAkun.has(sebelum) ? sebelum : pertama));
  }, [coa, namaAkun]);

  const shown = list.filter((p) => !fStatus || p.status === fStatus);
  const openList = list.filter((p) => p.status === 'OPEN');
  const closeTarget = openList.find((p) => p.id === closeId);
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
          ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
        }),
        error: null,
      };
    } catch (e) {
      return {
        input: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [tanggal, penerima, sumber, jumlah, keterangan, noBukti]);

  const pratinjauClose = useMemo<{ hasil: HasilPanjarClose | null; error: string | null }>(() => {
    if (!closeTarget || totalRealisasi <= 0) return { hasil: null, error: null };
    try {
      return {
        hasil: buatJurnalPanjarClose({
          tanggal: tanggalClose,
          penerima: closeTarget.penerima,
          akunKas: closeTarget.akun_kas_sumber,
          jumlahPanjar: closeTarget.jumlah,
          items: items.map((it) => ({ akun: it.kategori_baga, nominal: it.nominal })),
          keterangan: `Pertanggungjawaban panjar ${closeTarget.penerima}`,
        }),
        error: null,
      };
    } catch (e) {
      return {
        hasil: null,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, [closeTarget, totalRealisasi, tanggalClose, items]);

  const formSerahSah =
    Boolean(tanggal) &&
    Boolean(penerima.trim()) &&
    Boolean(sumber) &&
    Number.isInteger(jumlah) &&
    jumlah > 0;

  const formCloseSah =
    Boolean(closeTarget) &&
    Boolean(tanggalClose) &&
    totalRealisasi > 0 &&
    pratinjauClose.error === null;

  async function submitOpen(
    alasan?: string,
    opsi: { konfirmasiPeringatan?: boolean } = {},
  ): Promise<void> {
    if (busyOpen) return;
    setErr(null);
    setInfo(null);
    setLockRetry(null);
    setPesanKonfirmasiSerah(null);

    if (!formSerahSah) {
      setErr('Lengkapi tanggal, penerima, nominal, dan sumber kas terlebih dahulu.');
      return;
    }

    if (alasan !== undefined) alasanOpenRef.current = alasan;
    const alasanPakai = alasan ?? (alasanOpenRef.current || undefined);

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
        opsi,
      );
      alasanOpenRef.current = '';
      setPenerima('');
      setJumlah(0);
      setKeterangan('');
      setNoBukti('');
      await refresh();
      setInfo(
        `Panjar untuk ${r.panjar.penerima} tersimpan` +
          `${r.jurnal?.no_bukti ? ` (${r.jurnal.no_bukti})` : ''} — ${formatRp(r.panjar.jumlah)}. ` +
          'Kas berkurang, Uang Panjar (1040) bertambah.',
      );
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockRetry(() => (a: string) => submitOpen(a));
      } else if (isPerluKonfirmasi(e) && !opsi.konfirmasiPeringatan) {
        setPesanKonfirmasiSerah(e instanceof Error ? e.message : String(e));
      } else {
        setErr(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusyOpen(false);
    }
  }

  async function submitClose(
    alasan?: string,
    opsi: { konfirmasiPeringatan?: boolean } = {},
  ): Promise<void> {
    if (busyClose) return;
    setErrClose(null);
    setInfoClose(null);
    setLockRetry(null);
    setPesanKonfirmasi(null);

    if (!closeTarget) {
      setErrClose('Pilih panjar yang akan dipertanggungjawabkan.');
      return;
    }
    if (!formCloseSah) {
      setErrClose('Lengkapi tanggal realisasi dan rincian beban terlebih dahulu.');
      return;
    }
    if (kurang > 0 && !setujuKurang) {
      setErrClose(
        `Realisasi melebihi panjar sebesar ${formatRp(kurang)}. Centang persetujuan ` +
          'bahwa kekurangan dibayar dari kas sumber sebelum menyimpan.',
      );
      return;
    }

    if (alasan !== undefined) alasanCloseRef.current = alasan;
    const alasanPakai = alasan ?? (alasanCloseRef.current || undefined);

    setBusyClose(true);
    try {
      const r = await api.panjarClose(
        {
          id: closeTarget.id,
          tanggalClose,
          items,
          konfirmasiKurang: kurang > 0 && setujuKurang,
          konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        },
        alasanPakai,
      );
      alasanCloseRef.current = '';
      setCloseId('');
      setItems([{ kategori_baga: '5004', nominal: 0 }]);
      setSetujuKurang(false);
      setDetailId('');
      setDetailItems({});
      await refresh();
      setInfoClose(
        `Pertanggungjawaban tersimpan. Belanja ${formatRp(r.totalRealisasi)}` +
          (r.sisa > 0 ? `, sisa ${formatRp(r.sisa)} kembali ke kas.` : '') +
          (r.kurang > 0 ? `, kurang ${formatRp(r.kurang)} dibayar dari kas sumber.` : '.'),
      );
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockRetry(() => (a: string) => submitClose(a));
      } else if (isPerluKonfirmasi(e) && !opsi.konfirmasiPeringatan) {
        setPesanKonfirmasi(e instanceof Error ? e.message : String(e));
      } else {
        setErrClose(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusyClose(false);
    }
  }

  function pilihUntukClose(p: Panjar) {
    setCloseId(p.id);
    setTanggalClose(today() < p.tanggal ? p.tanggal : today());
    setItems([{ kategori_baga: '5004', nominal: 0 }]);
    setSetujuKurang(false);
    setPesanKonfirmasi(null);
    setErrClose(null);
    setInfoClose(null);
    // Gulir ke form pertanggungjawaban (operator awam tidak perlu mencari).
    if (typeof document !== 'undefined') {
      document.getElementById('panjar-pertanggungjawaban')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }
  }

  async function toggleDetail(id: string) {
    if (detailId === id) {
      setDetailId('');
      return;
    }
    setDetailId(id);
    if (detailItems[id]) return;
    setDetailBusy(id);
    try {
      const its = await api.panjarItems(id);
      setDetailItems((prev) => ({ ...prev, [id]: its }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
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
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">
            {info}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Tanggal panjar">
            <TextInput
              type="date"
              value={tanggal}
              disabled={busyOpen}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </Field>
          <Field label="Penerima / panitia">
            <TextInput
              value={penerima}
              disabled={busyOpen}
              placeholder="cth: Panitia Piodalan"
              onChange={(e) => setPenerima(e.target.value)}
            />
          </Field>
          <Field label="Jumlah panjar (Rp)">
            <CurrencyInput value={jumlah} onChange={setJumlah} />
          </Field>
          <Field label="Diambil dari kas / bank">
            <Select value={sumber} disabled={busyOpen} onChange={(e) => setSumber(e.target.value)}>
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
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </Field>
          <div>
            <Field label="No. bukti (opsional)">
              <TextInput
                value={noBukti}
                disabled={busyOpen}
                placeholder="cth: JU-2026-0001 — boleh kosong"
                onChange={(e) => setNoBukti(e.target.value)}
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
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="text-[15px] font-semibold">Perlu konfirmasi</p>
            <p className="mt-1 text-[15px]">{pesanKonfirmasiSerah}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                disabled={busyOpen}
                onClick={() => void submitOpen(undefined, { konfirmasiPeringatan: true })}
              >
                Ya, tetap serahkan
              </Button>
              <Button
                variant="ghost"
                disabled={busyOpen}
                onClick={() => setPesanKonfirmasiSerah(null)}
              >
                Batal
              </Button>
            </div>
          </div>
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
        <div id="panjar-pertanggungjawaban">
          <h2 className="mb-1 text-lg font-bold">Pertanggungjawaban Panjar</h2>
          <p className="mb-3 text-sm text-stone-600">
            Pilih panjar yang masih terbuka, masukkan rincian belanja per jenis (baga), lalu
            periksa sisa atau kekurangannya. Uang panjar (1040) akan kembali nol.
          </p>
        </div>
        <ErrorBox msg={errClose} />
        {infoClose && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">
            {infoClose}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Panjar yang dipertanggungjawabkan">
            <Select
              value={closeId}
              disabled={busyClose}
              onChange={(e) => {
                const p = openList.find((x) => x.id === e.target.value);
                if (p) pilihUntukClose(p);
                else setCloseId('');
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
              onChange={(e) => setTanggalClose(e.target.value)}
            />
          </Field>
        </div>

        {closeTarget && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px]">
            Panjar dari <b>{labelAkun(closeTarget.akun_kas_sumber)}</b> sebesar{' '}
            <b>{formatRp(closeTarget.jumlah)}</b>.
          </div>
        )}

        <div className="mt-3 space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid grid-cols-1 items-end gap-2 md:grid-cols-[1fr_180px_auto]">
              <Field label={i === 0 ? 'Jenis belanja (baga)' : ''}>
                <Select
                  value={it.kategori_baga}
                  disabled={busyClose}
                  onChange={(e) =>
                    setItems((xs) =>
                      xs.map((x, j) =>
                        j === i ? { ...x, kategori_baga: e.target.value } : x,
                      ),
                    )
                  }
                >
                  {bagaList.map((b) => (
                    <option key={b.kode} value={b.kode}>
                      {b.kode} — {b.nama}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={i === 0 ? 'Nominal (Rp)' : ''}>
                <CurrencyInput
                  value={it.nominal}
                  onChange={(n) =>
                    setItems((xs) => xs.map((x, j) => (j === i ? { ...x, nominal: n } : x)))
                  }
                />
              </Field>
              <Button
                variant="ghost"
                disabled={busyClose || items.length === 1}
                onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}
              >
                ✕
              </Button>
            </div>
          ))}
          <Button
            variant="ghost"
            disabled={busyClose}
            onClick={() => setItems((xs) => [...xs, { kategori_baga: '5004', nominal: 0 }])}
          >
            + Tambah baris belanja
          </Button>
        </div>

        {closeTarget && (
          <div className="mt-3 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[15px]">
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
            {selisih === 0 && <p className="mt-1 font-semibold">Pas — tidak ada sisa/kurang.</p>}
          </div>
        )}

        {kurang > 0 && (
          <label className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900">
            <input
              type="checkbox"
              className="mt-1"
              checked={setujuKurang}
              disabled={busyClose}
              onChange={(e) => setSetujuKurang(e.target.checked)}
            />
            <span>
              Saya setuju kekurangan <b>{formatRp(kurang)}</b> dibayar dari kas sumber{' '}
              <b>{labelAkun(closeTarget?.akun_kas_sumber ?? '')}</b>.
            </span>
          </label>
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
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="text-[15px] font-semibold">Perlu konfirmasi</p>
            <p className="mt-1 text-[15px]">{pesanKonfirmasi}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                disabled={busyClose}
                onClick={() => void submitClose(undefined, { konfirmasiPeringatan: true })}
              >
                Ya, tetap simpan
              </Button>
              <Button
                variant="ghost"
                disabled={busyClose}
                onClick={() => setPesanKonfirmasi(null)}
              >
                Batal
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busyClose || !formCloseSah} onClick={() => void submitClose()}>
            {busyClose ? 'Menyimpan…' : 'Simpan Pertanggungjawaban'}
          </Button>
          <span className="text-sm text-stone-500">
            Setelah disimpan, 1040 untuk panjar ini kembali nol.
          </span>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <h2 className="shrink-0 whitespace-nowrap text-lg font-bold">Daftar Panjar</h2>
          <div className="flex flex-col items-start gap-2 md:items-end">
            <Select
              value={fStatus}
              onChange={(e) => setFStatus(e.target.value as '' | 'OPEN' | 'CLOSED')}
            >
              <option value="">Semua status</option>
              <option value="OPEN">Belum dipertanggungjawabkan</option>
              <option value="CLOSED">Sudah dipertanggungjawabkan</option>
            </Select>
            <ExportActions
              namaDasar={namaDasarPanjar}
              judul="Panjar (Uang Muka)"
              disabled={shown.length === 0}
              buatWorkbook={() =>
                dataPanjarExport().then((daftar) => panjarToWorkbook(daftar, coa))
              }
              buatDokumen={() =>
                dataPanjarExport().then((daftar) => panjarPrintDoc(daftar, coa))
              }
            />
          </div>
        </div>
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
              {shown.map((p) => {
                const realisasi = p.total_realisasi ?? 0;
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
                        <Badge tone={p.status === 'OPEN' ? 'amber' : 'green'}>
                          {p.status === 'OPEN' ? 'Belum' : 'Sudah'}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 text-right whitespace-nowrap">
                        {p.status === 'CLOSED' ? (
                          <>
                            <div>{formatRp(realisasi)}</div>
                            {(p.kurang ?? 0) > 0 ? (
                              <div className="text-xs font-semibold text-red-700">
                                kurang {formatRp(p.kurang ?? 0)}
                              </div>
                            ) : (
                              <div className="text-xs text-green-700">
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
                          <Button variant="ghost" onClick={() => void toggleDetail(p.id)}>
                            {detailId === p.id ? 'Tutup rincian' : 'Lihat rincian'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {detailId === p.id && (
                      <tr className="border-b bg-stone-50 last:border-0">
                        <td colSpan={7} className="px-3 py-3">
                          {detailBusy === p.id ? (
                            <p className="text-stone-500">Memuat rincian…</p>
                          ) : (detailItems[p.id]?.length ?? 0) > 0 ? (
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-stone-500">
                                  <th className="py-1 pr-3">Jenis belanja</th>
                                  <th className="py-1 pr-3 text-right">Nominal</th>
                                  <th className="py-1">Jurnal</th>
                                </tr>
                              </thead>
                              <tbody>
                                {detailItems[p.id]!.map((it) => (
                                  <tr key={it.id ?? `${it.kategori_baga}-${it.nominal}`}>
                                    <td className="py-1 pr-3">{labelAkun(it.kategori_baga)}</td>
                                    <td className="py-1 pr-3 text-right">
                                      {formatRp(it.nominal)}
                                    </td>
                                    <td className="py-1 text-xs text-stone-500">
                                      {it.jurnal_id ?? '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
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
              {shown.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-stone-500">
                    Belum ada panjar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

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
    </div>
  );
}
