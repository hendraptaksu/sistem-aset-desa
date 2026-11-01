import { Fragment, useEffect, useMemo, useState } from 'react';
import { isAkunKasData } from '../../db/coa.js';
import type { Coa } from '../../db/coa.js';
import type { Pinjaman, PinjamanAngsuran } from '../../core/types.js';
import type { MutasiPinjamanHasil } from '../../core/pinjamanMutasi.js';
import type { HasilRekonsiliasiPinjaman } from '../../core/pinjamanRekonsiliasi.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal, tahunLokal } from '../../utils/tanggal.js';
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
 * Periode UI kartu hutang: satu tahun penuh bila bulan kosong, atau satu bulan
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
  // DB-16e — kartu hutang / mutasi bulanan.
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

  function toggleMutasiBulan(bulan: string): void {
    setMutasiBuka((prev) => ({ ...prev, [bulan]: !prev[bulan] }));
  }

  function pilihKartuHutang(id: string): void {
    setMutasiPinjamanId(id);
    setMutasiBuka({});
    setMutasiErr(null);
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
                        <div className="flex flex-wrap gap-1">
                          <Button variant="ghost" onClick={() => void toggleDetail(p.id)}>
                            {detailId === p.id ? 'Tutup jadwal' : 'Lihat jadwal'}
                          </Button>
                          <Button variant="ghost" onClick={() => pilihKartuHutang(p.id)}>
                            Kartu hutang
                          </Button>
                        </div>
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

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Rekonsiliasi 2050 vs Jadwal Pinjaman</h2>
            <p className="mt-1 max-w-3xl text-sm text-stone-600">
              Membandingkan outstanding menurut jurnal{' '}
              <b>2050 HUTANG LAIN-LAIN</b> yang tertaut ke pinjaman dengan{' '}
              <b>sisa pokok awal dikurangi pokok yang dibayar</b>. Hanya jurnal
              milik pinjaman ini yang dihitung; saldo 2050 untuk utang non-LPD
              dan jurnal yang belum ditautkan tidak ikut dibandingkan.
            </p>
          </div>
          <Badge tone={jumlahSelisihRekonsiliasi > 0 ? 'amber' : 'green'}>
            {rekonsiliasiBusy
              ? 'Memeriksa…'
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
              <thead>
                <tr className="border-b text-stone-500">
                  <th className="py-2 pr-3">Kreditur / ID</th>
                  <th className="py-2 pr-3 text-right">GL 2050</th>
                  <th className="py-2 pr-3 text-right">Jadwal</th>
                  <th className="py-2 pr-3 text-right">Selisih</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2">Keterangan</th>
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

        {!rekonsiliasiBusy &&
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
              Selisih berarti outstanding menurut jurnal 2050 berbeda dengan
              outstanding menurut jadwal. Periksa jurnal pencairan, jurnal
              pembayaran (termasuk akun pokok dan link pembayaran), atau Saldo
              Awal 2050. Aplikasi <b>tidak mengoreksi otomatis</b> dan
              tidak menyediakan tombol koreksi di sini; koreksi data lama dilakukan
              lewat jurnal koreksi/reversal oleh akuntan pendamping.
            </p>
          </div>
        )}
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-bold">Kartu Hutang / Mutasi Bulanan</h2>
            <p className="mt-1 max-w-3xl text-sm text-stone-600">
              Mutasi pokok, bunga, denda, dan kas keluar per bulan. Semua angka
              dihitung ulang dari baris jurnal pembayaran yang tertaut ke pinjaman;
              tidak ada saldo atau total bulanan yang disimpan di tabel pembayaran.
            </p>
          </div>
          <Badge tone="stone">DB-16e</Badge>
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
              {mutasi.pinjaman.kreditur} · {mutasi.periode.label} · outstanding
              seluruh riwayat <b>{formatRp(mutasi.outstanding)}</b>. Saldo akhir
              periode = saldo awal − pokok dibayar; saldo berantai bulan ke bulan.
            </p>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Bulan</th>
                    <th className="py-2 pr-3 text-right">Saldo awal</th>
                    <th className="py-2 pr-3 text-right">Pokok</th>
                    <th className="py-2 pr-3 text-right">Bunga</th>
                    <th className="py-2 pr-3 text-right">Denda</th>
                    <th className="py-2 pr-3 text-right">Kas keluar</th>
                    <th className="py-2 pr-3 text-right">Saldo akhir</th>
                    <th className="py-2 pr-3">Jurnal</th>
                    <th className="py-2">Detail</th>
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
                          <Button
                            variant="ghost"
                            disabled={b.pembayaran.length === 0}
                            onClick={() => toggleMutasiBulan(b.bulan)}
                          >
                            {mutasiBuka[b.bulan] ? 'Tutup' : 'Lihat jurnal'}
                          </Button>
                        </td>
                      </tr>
                      {mutasiBuka[b.bulan] && (
                        <tr className="border-b bg-stone-50 last:border-0">
                          <td colSpan={9} className="px-3 py-3">
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-stone-500">
                                  <th className="py-1 pr-3">No. bukti</th>
                                  <th className="py-1 pr-3">Tanggal jurnal</th>
                                  <th className="py-1 pr-3">Tanggal link</th>
                                  <th className="py-1 pr-3">Jurnal ID</th>
                                  <th className="py-1 pr-3 text-right">Pokok</th>
                                  <th className="py-1 pr-3 text-right">Bunga</th>
                                  <th className="py-1 pr-3 text-right">Denda</th>
                                  <th className="py-1 text-right">Kas keluar</th>
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
                                        ? 'sama'
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
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Ke</th>
                    <th className="py-2 pr-3">Jatuh tempo</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Pokok jadwal</th>
                    <th className="py-2 pr-3 text-right">Bunga jadwal</th>
                    <th className="py-2 pr-3 text-right">Pokok realisasi</th>
                    <th className="py-2 pr-3 text-right">Bunga realisasi</th>
                    <th className="py-2 pr-3 text-right">Selisih pokok</th>
                    <th className="py-2 pr-3 text-right">Selisih bunga</th>
                    <th className="py-2">Jurnal bayar</th>
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
                        <Badge tone={a.dibayar ? 'green' : 'stone'}>
                          {a.dibayar ? 'LUNAS' : 'BELUM'}
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
                            {a.tanggal_bayar && a.tanggal_bayar !== a.tanggal_jurnal && (
                              <div>link: {formatTanggal(a.tanggal_bayar)}</div>
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
  );
}





