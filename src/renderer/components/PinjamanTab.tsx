import { Fragment, useEffect, useMemo, useState } from 'react';
import { isAkunKasData } from '../../db/coa.js';
import type { Coa } from '../../db/coa.js';
import type { Pinjaman, PinjamanAngsuran } from '../../core/types.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api, isPerluKonfirmasi, type ModePinjamanApi } from '../lib/api.js';
import { useTabGuard } from '../lib/tabGuard.js';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  ErrorBox,
  Field,
  Select,
  TextArea,
  TextInput,
} from './ui.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';

type BarisJadwal = {
  ke: number;
  jatuh_tempo: string;
  pokok: number;
  bunga: number;
  catatan: string;
};

function barisBaru(ke: number, tanggal = ''): BarisJadwal {
  return { ke, jatuh_tempo: tanggal, pokok: 0, bunga: 0, catatan: '' };
}

/** State form bayar angsuran (DB-16d). */
type FormBayar = {
  pinjaman: Pinjaman;
  angsuran: PinjamanAngsuran;
  tanggal: string;
  akunKas: string;
  pokok: number;
  bunga: number;
  denda: number;
  catatan: string;
};

export function PinjamanTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [list, setList] = useState<Pinjaman[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const [detailId, setDetailId] = useState('');
  const [detail, setDetail] = useState<Record<string, Pinjaman>>({});
  const [detailBusy, setDetailBusy] = useState('');
  const [bayar, setBayar] = useState<FormBayar | null>(null);
  const [bayarAlasan, setBayarAlasan] = useState('');
  const [bayarPerluKonfirmasi, setBayarPerluKonfirmasi] = useState(false);
  const [bayarErr, setBayarErr] = useState<string | null>(null);
  const [bayarBusy, setBayarBusy] = useState(false);
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

  useEffect(() => {
    let aktif = true;
    void (async () => {
      try {
        const [c, p] = await Promise.all([api.coa(), api.pinjamanList()]);
        if (!aktif) return;
        setCoa(c);
        setList(p);
      } catch (e) {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
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
    setDirty(false);
    return () => setDirty(false);
  }, [setDirty]);

  async function refresh(): Promise<void> {
    try {
      setList(await api.pinjamanList());
      setErr(null);
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    }
  }

  function resetForm(): void {
    setKreditur('');
    setPokok(0);
    setSisaPokok(0);
    setCatatan('');
    setNoBukti('');
    setJadwal([barisBaru(1)]);
    setPesanKonfirmasi(null);
    setDirty(false);
  }

  async function simpan(konfirmasi = false): Promise<void> {
    if (busy) return;
    setErr(null);
    setInfo(null);
    if (!konfirmasi) setPesanKonfirmasi(null);
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
        konfirmasi ? { konfirmasiPeringatan: true, alasanPeringatan: 'Konfirmasi operator' } : {},
      );
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
      if (isPerluKonfirmasi(e)) setPesanKonfirmasi(pesanError(e));
      else setErr(pesanError(e));
    } finally {
      setBusy(false);
    }
  }

  function ubahMode(berikut: ModePinjamanApi): void {
    setMode(berikut);
    setErr(null);
    setInfo(null);
    setPesanKonfirmasi(null);
    setDirty(true);
  }

  function ubahJadwal(i: number, patch: Partial<BarisJadwal>): void {
    setJadwal((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function tambahJadwal(): void {
    setJadwal((rows) => {
      const ke = rows.reduce((maks, r) => Math.max(maks, r.ke), 0) + 1;
      return [...rows, barisBaru(ke)];
    });
    setDirty(true);
  }

  function hapusJadwal(i: number): void {
    setJadwal((rows) => rows.filter((_, j) => j !== i));
    setDirty(true);
  }

  async function toggleDetail(id: string): Promise<void> {
    if (detailId === id) {
      setDetailId('');
      return;
    }
    setDetailId(id);
    if (detail[id]) return;
    setDetailBusy(id);
    try {
      const d = await api.pinjamanDetail(id);
      setDetail((prev) => ({ ...prev, [id]: d }));
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setDetailBusy('');
    }
  }

  function mulaiBayar(p: Pinjaman, a: PinjamanAngsuran): void {
    const akun =
      kasList.some((k) => k.kode === p.akun_kas)
        ? p.akun_kas
        : (kasList[0]?.kode ?? '');
    setBayar({
      pinjaman: p,
      angsuran: a,
      tanggal: tanggalLokal(),
      akunKas: akun,
      pokok: a.pokok,
      bunga: a.bunga,
      denda: 0,
      catatan: '',
    });
    setBayarAlasan('');
    setBayarPerluKonfirmasi(false);
    setBayarErr(null);
    setInfo(null);
    setDirty(true);
  }

  function batalBayar(): void {
    setBayar(null);
    setBayarAlasan('');
    setBayarPerluKonfirmasi(false);
    setBayarErr(null);
    setDirty(false);
  }

  function ubahBayar(patch: Partial<FormBayar>): void {
    setBayar((b) => (b ? { ...b, ...patch } : b));
    setBayarPerluKonfirmasi(false);
    setBayarErr(null);
    setDirty(true);
  }

  async function simpanBayar(konfirmasi = false): Promise<void> {
    if (!bayar || bayarBusy) return;
    setBayarErr(null);
    setInfo(null);
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
    const alasan = bayarAlasan.trim();
    if (konfirmasi && alasan.length < 5) {
      setBayarErr('Alasan konfirmasi wajib diisi minimal 5 karakter.');
      return;
    }

    setBayarBusy(true);
    const idPinjaman = bayar.pinjaman.id;
    const ke = bayar.angsuran.ke;
    try {
      const r = await api.pinjamanBayar(
        {
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
              konfirmasiSelisih: true,
              alasanSelisih: alasan,
              konfirmasiPeringatan: true,
              alasanPeringatan: alasan,
            }
          : {},
      );
      setInfo(
        `Bayar angsuran ke-${ke} ${bayar.pinjaman.kreditur} tersimpan ` +
          `(${r.jurnal.no_bukti || r.jurnal.id}) — ${formatRp(total)}. ` +
          `Outstanding sekarang ${formatRp(r.pinjaman?.outstanding ?? 0)}.`,
      );
      setBayar(null);
      setBayarAlasan('');
      setBayarPerluKonfirmasi(false);
      setDirty(false);
      await refresh();
      try {
        const d = await api.pinjamanDetail(idPinjaman);
        setDetail((prev) => ({ ...prev, [idPinjaman]: d }));
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
      setBayarBusy(false);
    }
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
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">
            {info}
          </div>
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
              onChange={(e) => {
                setTanggal(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Kreditur / LPD">
            <TextInput
              value={kreditur}
              disabled={busy}
              placeholder="cth: LPD Desa Adat"
              onChange={(e) => {
                setKreditur(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          {mode === 'PENCAIRAN' ? (
            <Field label="Pokok pinjaman (Rp)">
              <CurrencyInput
                value={pokok}
                onChange={(n) => {
                  setPokok(n);
                  setDirty(true);
                }}
              />
            </Field>
          ) : (
            <Field label="Sisa pokok saat ini (Rp)">
              <CurrencyInput
                value={sisaPokok}
                onChange={(n) => {
                  setSisaPokok(n);
                  setDirty(true);
                }}
              />
            </Field>
          )}
          {mode === 'PENCAIRAN' && (
            <Field label="Akun kas / bank penerima">
              <Select
                value={akunKas}
                disabled={busy}
                onChange={(e) => {
                  setAkunKas(e.target.value);
                  setDirty(true);
                }}
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
              onChange={(e) => {
                setAkunBunga(e.target.value);
                setDirty(true);
              }}
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
              onChange={(e) => {
                setTenor(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          <Field label="Catatan (opsional)">
            <TextInput
              value={catatan}
              disabled={busy}
              placeholder="cth: pinjaman untuk pembangunan"
              onChange={(e) => {
                setCatatan(e.target.value);
                setDirty(true);
              }}
            />
          </Field>
          {mode === 'PENCAIRAN' && (
            <Field label="No. bukti jurnal (opsional)">
              <TextInput
                value={noBukti}
                disabled={busy}
                placeholder="cth: JU-2026-0001 — boleh kosong"
                onChange={(e) => {
                  setNoBukti(e.target.value);
                  setDirty(true);
                }}
              />
            </Field>
          )}
        </div>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-bold">Jadwal angsuran (input manual)</h3>
              <p className="mt-1 text-sm text-stone-600">
                Isi nomor ke, jatuh tempo, pokok, dan bunga sesuai perjanjian LPD.
                Sistem tidak menghitung sendiri. Total pokok jadwal harus sama dengan{' '}
                {mode === 'PENCAIRAN' ? 'pokok pinjaman' : 'sisa pokok'}.
              </p>
            </div>
            <Badge tone={cocokPokok ? 'green' : 'amber'}>
              Total pokok {formatRp(totalPokokJadwal)}
            </Badge>
          </div>

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
                    onChange={(n) => ubahJadwal(i, { pokok: n })}
                  />
                </Field>
                <Field label="Bunga (Rp)">
                  <CurrencyInput
                    value={row.bunga}
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
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-[15px] text-amber-900">
            <p className="font-semibold">Perlu konfirmasi</p>
            <p className="mt-1">{pesanKonfirmasi}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void simpan(true)}>
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
              Outstanding dihitung dari sisa pokok awal dikurangi pokok yang sudah
              dibayar menurut jurnal. Jadwal adalah rencana, bukan saldo.
            </p>
          </div>
          <Badge tone="stone">{list.length} pinjaman</Badge>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Tanggal mulai</th>
                <th className="py-2 pr-3">Kreditur / LPD</th>
                <th className="py-2 pr-3">Kas</th>
                <th className="py-2 pr-3 text-right">Pokok awal</th>
                <th className="py-2 pr-3 text-right">Sisa awal</th>
                <th className="py-2 pr-3 text-right">Outstanding</th>
                <th className="py-2 pr-3">Sumber jurnal</th>
                <th className="py-2">Tindakan</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const d = detail[p.id];
                const jadwalTampil = d?.angsuran ?? p.angsuran ?? [];
                return (
                  <Fragment key={p.id}>
                    <tr className="border-b align-top last:border-0">
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {formatTanggal(p.tanggal_mulai)}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-semibold">{p.kreditur}</div>
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
                      </td>
                      <td className="py-2">
                        <Button variant="ghost" onClick={() => void toggleDetail(p.id)}>
                          {detailId === p.id ? 'Tutup jadwal' : 'Lihat jadwal'}
                        </Button>
                      </td>
                    </tr>
                    {detailId === p.id && (
                      <tr className="border-b bg-stone-50 last:border-0">
                        <td colSpan={8} className="px-3 py-3">
                          {detailBusy === p.id ? (
                            <p className="text-stone-500">Memuat jadwal…</p>
                          ) : jadwalTampil.length > 0 ? (
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-stone-500">
                                  <th className="py-1 pr-3">Ke</th>
                                  <th className="py-1 pr-3">Jatuh tempo</th>
                                  <th className="py-1 pr-3 text-right">Pokok</th>
                                  <th className="py-1 pr-3 text-right">Bunga</th>
                                  <th className="py-1 pr-3">Status</th>
                                  <th className="py-1 pr-3">Jurnal bayar</th>
                                  <th className="py-1 pr-3">Catatan</th>
                                  <th className="py-1">Tindakan</th>
                                </tr>
                              </thead>
                              <tbody>
                                {jadwalTampil.map((a) => (
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
                                      <Badge tone={a.status === 'LUNAS' ? 'green' : 'stone'}>
                                        {a.status}
                                      </Badge>
                                      {a.tanggal_bayar && (
                                        <div className="mt-1 text-helper text-stone-500">
                                          {formatTanggal(a.tanggal_bayar)}
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-1 pr-3 text-xs text-stone-500">
                                      {a.jurnal_id ?? '—'}
                                    </td>
                                    <td className="py-1">{a.catatan || '—'}</td>
                                    <td className="py-1">
                                      {a.dibayar ? (
                                        <span className="text-helper text-stone-500">
                                          Sudah lunas
                                        </span>
                                      ) : (
                                        <Button
                                          variant="ghost"
                                          disabled={bayarBusy}
                                          onClick={() => mulaiBayar(p, a)}
                                        >
                                          Bayar Angsuran
                                        </Button>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-stone-500">Belum ada jadwal angsuran.</p>
                          )}

                          {bayar && bayar.pinjaman.id === p.id && (
                            <div className="mt-4 rounded-xl border border-emerald-200 bg-white p-4">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <h3 className="font-bold">
                                    Bayar angsuran ke-{bayar.angsuran.ke}
                                  </h3>
                                  <p className="mt-1 text-sm text-stone-600">
                                    Prefill pokok dan bunga dari jadwal. Nominal boleh
                                    diubah, tetapi bila berbeda dari jadwal wajib
                                    dikonfirmasi dengan alasan; jadwal tidak ikut
                                    berubah.
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
                                    onChange={(n) => ubahBayar({ pokok: n })}
                                  />
                                </Field>
                                <Field label="Bunga dibayar (Rp)">
                                  <CurrencyInput
                                    value={bayar.bunga}
                                    onChange={(n) => ubahBayar({ bunga: n })}
                                  />
                                </Field>
                                <Field label="Denda (Rp, opsional)">
                                  <CurrencyInput
                                    value={bayar.denda}
                                    onChange={(n) => ubahBayar({ denda: n })}
                                  />
                                </Field>
                              </div>

                              <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
                                <p>
                                  Jadwal: pokok <b>{formatRp(bayar.angsuran.pokok)}</b>{' '}
                                  · bunga <b>{formatRp(bayar.angsuran.bunga)}</b>
                                </p>
                                <p className="mt-1">
                                  Jurnal: <b>D 2050 pokok + D {labelAkun(p.akun_bunga)}{' '}
                                  bunga + D 5050 denda / K kas total</b>
                                </p>
                                {(bayar.pokok !== bayar.angsuran.pokok ||
                                  bayar.bunga !== bayar.angsuran.bunga) && (
                                  <p className="mt-1 font-semibold text-amber-800">
                                    Nominal berbeda dari jadwal. Server akan meminta
                                    konfirmasi dan alasan; jadwal tetap tidak berubah.
                                  </p>
                                )}
                              </div>

                              {(bayarPerluKonfirmasi ||
                                bayar.pokok !== bayar.angsuran.pokok ||
                                bayar.bunga !== bayar.angsuran.bunga) && (
                                <div className="mt-3">
                                  <Field label="Alasan selisih / konfirmasi (wajib ≥ 5 karakter)">
                                    <TextArea
                                      value={bayarAlasan}
                                      disabled={bayarBusy}
                                      placeholder="cth: pembulatan sesuai kesepakatan LPD"
                                      onChange={(e) => setBayarAlasan(e.target.value)}
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
                                      disabled={bayarBusy}
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
                                      Periksa lagi
                                    </Button>
                                  </div>
                                </div>
                              )}

                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                <Button
                                  disabled={
                                    bayarBusy ||
                                    !bayar.akunKas ||
                                    bayar.pokok + bayar.bunga + bayar.denda <= 0
                                  }
                                  onClick={() => void simpanBayar()}
                                >
                                  {bayarBusy ? 'Menyimpan…' : 'Bayar Angsuran'}
                                </Button>
                                <Button
                                  variant="ghost"
                                  disabled={bayarBusy}
                                  onClick={batalBayar}
                                >
                                  Batal
                                </Button>
                                <span className="text-sm text-stone-500">
                                  Satu angsuran hanya bisa dibayar sekali; jurnal
                                  dibuat seimbang dan tertaut otomatis.
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
              {list.length === 0 && (
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
    </div>
  );
}





