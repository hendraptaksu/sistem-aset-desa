import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isAkunKas, type Coa } from '../../db/coa.js';
import {
  hitungRekonsiliasi,
  LABEL_STATUS_REKONSILIASI,
  type StatusRekonsiliasi,
} from '../../core/rekonsiliasi.js';
import { tanggalKalenderValid } from '../../core/posting.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import {
  PESAN_MUAT_GAGAL,
  PESAN_SIMPAN_GAGAL,
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
} from '../../utils/pesanError.js';
import {
  api,
  type JurnalLengkap,
  type RekonsiliasiDetail,
  type RekonsiliasiTampil,
} from '../lib/api.js';
import { useAksiSibuk } from '../lib/aksiSibuk.js';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  ErrorBox,
  Field,
  KonfirmasiModal,
  Select,
  TextArea,
  TextInput,
} from './ui.js';
import { DetailJurnalModal } from './DetailJurnalModal.js';

const TONE_STATUS: Record<StatusRekonsiliasi, 'green' | 'amber' | 'red'> = {
  COCOK: 'green',
  LEBIH: 'amber',
  KURANG: 'red',
};

/** Badge Cocok/Lebih/Kurang + nominal selisih (nilai absolut, bahasa operator). */
function StatusSelisih({
  status,
  selisih,
}: {
  status: StatusRekonsiliasi;
  selisih: number;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Badge tone={TONE_STATUS[status]}>{LABEL_STATUS_REKONSILIASI[status]}</Badge>
      <span className="tabular-nums">{formatRp(Math.abs(selisih))}</span>
    </span>
  );
}

function KotakAngka({
  label,
  nilai,
  keterangan,
}: {
  label: string;
  nilai: string;
  keterangan?: string;
}) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="text-sm text-stone-600">{label}</div>
      <div className="text-lg font-bold tabular-nums">{nilai}</div>
      {keterangan && <div className="mt-1 text-xs text-stone-500">{keterangan}</div>}
    </div>
  );
}

export function RekonsiliasiBankTab() {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [memuatCoa, setMemuatCoa] = useState(true);

  const [akun, setAkun] = useState('');
  const [tanggal, setTanggal] = useState(tanggalLokal);
  const [saldoBank, setSaldoBank] = useState(0);
  const [catatan, setCatatan] = useState('');
  const [saldoBuku, setSaldoBuku] = useState<number | null>(null);
  const [memuatSaldo, setMemuatSaldo] = useState(false);

  const [riwayat, setRiwayat] = useState<RekonsiliasiTampil[]>([]);
  const [memuatRiwayat, setMemuatRiwayat] = useState(false);
  const [filterAkun, setFilterAkun] = useState('');
  const [filterSelesai, setFilterSelesai] = useState<'SEMUA' | 'BELUM' | 'SELESAI'>(
    'SEMUA',
  );

  const [detail, setDetail] = useState<RekonsiliasiDetail | null>(null);
  const [detailJurnal, setDetailJurnal] = useState<JurnalLengkap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [konfirmasiSimpan, setKonfirmasiSimpan] = useState<{
    selisih: number;
    status: StatusRekonsiliasi;
  } | null>(null);
  const [konfirmasiSelesai, setKonfirmasiSelesai] =
    useState<RekonsiliasiTampil | null>(null);

  const { sibuk, jalankan } = useAksiSibuk();
  const detailJurnalBusyRef = useRef(false);

  const akunKas = useMemo(() => coa.filter((a) => isAkunKas(a.kode)), [coa]);

  // Muat seluruh COA sekali; dropdown hanya menampilkan akun kas/bank.
  useEffect(() => {
    let aktif = true;
    setMemuatCoa(true);
    api
      .coa()
      .then((daftar) => {
        if (!aktif) return;
        setCoa(daftar);
        setAkun((sebelumnya) => {
          const kas = daftar.filter((a) => isAkunKas(a.kode));
          if (kas.some((a) => a.kode === sebelumnya)) return sebelumnya;
          return kas.find((a) => a.kode === '1001')?.kode ?? kas[0]?.kode ?? '';
        });
      })
      .catch((e) => {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      })
      .finally(() => {
        if (aktif) setMemuatCoa(false);
      });
    return () => {
      aktif = false;
    };
  }, []);

  // Saldo buku selalu diambil dari Buku Besar (dihitung dari jurnal).
  useEffect(() => {
    if (!akun || !tanggalKalenderValid(tanggal)) {
      setSaldoBuku(null);
      setMemuatSaldo(false);
      return;
    }
    let aktif = true;
    setMemuatSaldo(true);
    api
      .laporanBukuBesar({ akun_kode: akun, sampai: tanggal })
      .then((hasil) => {
        if (aktif) setSaldoBuku(hasil.saldoAkhir);
      })
      .catch((e) => {
        if (aktif) {
          setSaldoBuku(null);
          setErr(pesanError(e, PESAN_MUAT_GAGAL));
        }
      })
      .finally(() => {
        if (aktif) setMemuatSaldo(false);
      });
    return () => {
      aktif = false;
    };
  }, [akun, tanggal]);

  const muatRiwayat = useCallback(async () => {
    setMemuatRiwayat(true);
    try {
      setRiwayat(
        await api.rekonsiliasiList({
          ...(filterAkun ? { akun_kode: filterAkun } : {}),
          ...(filterSelesai === 'SEMUA'
            ? {}
            : { selesai: filterSelesai === 'SELESAI' }),
        }),
      );
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setMemuatRiwayat(false);
    }
  }, [filterAkun, filterSelesai]);

  useEffect(() => {
    void muatRiwayat();
  }, [muatRiwayat]);

  const hasil = useMemo(
    () =>
      saldoBuku === null
        ? null
        : hitungRekonsiliasi({ saldoBank, saldoBuku }),
    [saldoBank, saldoBuku],
  );

  function mintaSimpan(): void {
    if (sibuk || memuatSaldo) return;
    setErr(null);
    setInfo(null);
    if (!akun) {
      setErr('Pilih akun kas/bank terlebih dahulu.');
      return;
    }
    if (!tanggalKalenderValid(tanggal)) {
      setErr(PESAN_TANGGAL_TIDAK_VALID);
      return;
    }
    if (!Number.isSafeInteger(saldoBank) || saldoBank < 0) {
      setErr('Saldo menurut rekening koran harus bilangan bulat ≥ 0.');
      return;
    }
    if (saldoBuku === null) {
      setErr('Saldo buku belum selesai dihitung. Coba lagi sebentar.');
      return;
    }
    if (hasil && hasil.selisih !== 0 && !catatan.trim()) {
      setErr(
        'Saldo bank dan saldo buku belum cocok. Isi catatan/alasan selisih terlebih dahulu.',
      );
      return;
    }
    if (hasil && hasil.selisih !== 0) {
      setKonfirmasiSimpan({ selisih: hasil.selisih, status: hasil.status });
      return;
    }
    void simpanSekarang();
  }

  async function simpanSekarang(): Promise<void> {
    if (!akun || !tanggalKalenderValid(tanggal) || saldoBuku === null) return;
    setKonfirmasiSimpan(null);
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      try {
        await api.rekonsiliasiCreate({
          akun_kode: akun,
          tanggal,
          saldo_bank: saldoBank,
          catatan: catatan.trim(),
        });
        setInfo(
          `Rekonsiliasi ${formatTanggal(tanggal)} untuk ${akun} tersimpan. Saldo buku tetap dihitung dari jurnal.`,
        );
        setCatatan('');
        setSaldoBank(0);
        await muatRiwayat();
      } catch (e) {
        setErr(pesanError(e, PESAN_SIMPAN_GAGAL));
      }
    });
  }

  async function bukaDetail(row: RekonsiliasiTampil): Promise<void> {
    if (sibuk) return;
    setErr(null);
    try {
      setDetail(await api.rekonsiliasiDetail(row.id));
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    }
  }

  async function bukaJurnal(jurnalId: string): Promise<void> {
    if (!jurnalId || detailJurnalBusyRef.current) return;
    detailJurnalBusyRef.current = true;
    setErr(null);
    try {
      setDetailJurnal(await api.laporanJurnalDetail(jurnalId));
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      detailJurnalBusyRef.current = false;
    }
  }

  async function tandaiSelesai(row: RekonsiliasiTampil): Promise<void> {
    setKonfirmasiSelesai(null);
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      try {
        await api.rekonsiliasiSelesai(row.id);
        setInfo(
          `Rekonsiliasi ${formatTanggal(row.tanggal)} untuk ${row.akun_kode} ditandai selesai.`,
        );
        await muatRiwayat();
        if (detail?.id === row.id) {
          setDetail(await api.rekonsiliasiDetail(row.id));
        }
      } catch (e) {
        setErr(pesanError(e, PESAN_SIMPAN_GAGAL));
      }
    });
  }

  const akunTerpilih = akunKas.find((a) => a.kode === akun);
  const bisaSimpan = !sibuk && !memuatSaldo && saldoBuku !== null && Boolean(akun);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Rekonsiliasi Bank</h2>
            <p className="mt-1 max-w-2xl text-[15px] text-stone-600">
              Masukkan saldo menurut rekening koran/buku tabungan pada tanggal tertentu.
              Saldo buku, selisih, dan daftar mutasi dihitung ulang dari jurnal — bukan
              angka yang disimpan.
            </p>
          </div>
          <Badge tone="green">Dihitung dari jurnal</Badge>
        </div>
      </Card>

      <Card>
        <h3 className="font-bold">Bandingkan Saldo</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Akun kas/bank">
            <Select
              value={akun}
              disabled={sibuk || memuatCoa}
              onChange={(e) => setAkun(e.target.value)}
            >
              {memuatCoa && <option value="">Memuat akun…</option>}
              {!memuatCoa && akunKas.length === 0 && (
                <option value="">Belum ada akun kas/bank</option>
              )}
              {akunKas.map((a) => (
                <option key={a.kode} value={a.kode}>
                  {a.kode} — {a.nama}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tanggal rekonsiliasi">
            <TextInput
              type="date"
              value={tanggal}
              disabled={sibuk}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </Field>
          <Field label="Saldo menurut rekening koran">
            <CurrencyInput
              value={saldoBank}
              onChange={setSaldoBank}
              disabled={sibuk}
            />
          </Field>
          <Field label="Catatan / alasan selisih (opsional)">
            <TextArea
              value={catatan}
              disabled={sibuk}
              onChange={(e) => setCatatan(e.target.value)}
              placeholder="cth: biaya admin bank belum tercatat"
              className="min-h-[2.75rem]"
            />
          </Field>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KotakAngka
            label="Saldo buku (dari jurnal)"
            nilai={
              memuatSaldo
                ? 'Menghitung…'
                : saldoBuku === null
                  ? '—'
                  : formatRp(saldoBuku)
            }
            keterangan={
              akunTerpilih && tanggalKalenderValid(tanggal)
                ? `${akunTerpilih.kode} — ${akunTerpilih.nama} s/d ${formatTanggal(tanggal)}`
                : 'Pilih akun dan tanggal'
            }
          />
          <KotakAngka
            label="Saldo bank (rekening koran)"
            nilai={formatRp(saldoBank)}
            keterangan="Angka yang akan disimpan"
          />
          <KotakAngka
            label="Selisih"
            nilai={hasil ? formatRp(Math.abs(hasil.selisih)) : '—'}
            keterangan={
              hasil && hasil.selisih !== 0
                ? hasil.selisih > 0
                  ? 'Bank lebih besar dari buku'
                  : 'Bank lebih kecil dari buku'
                : 'Bank dan buku sama'
            }
          />
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="text-sm text-stone-600">Status</div>
            <div className="mt-1">
              {hasil ? (
                <StatusSelisih status={hasil.status} selisih={hasil.selisih} />
              ) : (
                <span className="text-stone-500">—</span>
              )}
            </div>
            <div className="mt-1 text-xs text-stone-500">
              {hasil?.cocok
                ? 'Saldo bank sama dengan saldo buku.'
                : 'Boleh disimpan dengan catatan/alasan.'}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <ErrorBox msg={err} />
          {info && (
            <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800">
              {info}
            </div>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-sm text-stone-600">
            Bila selisih ≠ 0, isi catatan/alasan lalu konfirmasi. Data tersimpan sebagai
            dokumen pemeriksaan; jurnal tidak diubah.
          </p>
          <Button disabled={!bisaSimpan} onClick={mintaSimpan}>
            {sibuk ? 'Menyimpan…' : 'Simpan Rekonsiliasi'}
          </Button>
        </div>
      </Card>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-bold">Riwayat Rekonsiliasi</h3>
            <p className="text-sm text-stone-600">
              Saldo buku pada kolom riwayat dihitung dari jurnal s/d tanggal rekonsiliasi.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Akun">
              <Select
                value={filterAkun}
                onChange={(e) => setFilterAkun(e.target.value)}
              >
                <option value="">Semua akun</option>
                {akunKas.map((a) => (
                  <option key={a.kode} value={a.kode}>
                    {a.kode} — {a.nama}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={filterSelesai}
                onChange={(e) =>
                  setFilterSelesai(e.target.value as 'SEMUA' | 'BELUM' | 'SELESAI')
                }
              >
                <option value="SEMUA">Semua</option>
                <option value="BELUM">Belum selesai</option>
                <option value="SELESAI">Selesai</option>
              </Select>
            </Field>
          </div>
        </div>

        {memuatRiwayat && riwayat.length === 0 ? (
          <p className="mt-3 text-stone-500">Memuat riwayat rekonsiliasi…</p>
        ) : riwayat.length === 0 ? (
          <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px] text-stone-600">
            Belum ada rekonsiliasi untuk filter ini.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-[15px]">
              <thead>
                <tr className="border-b text-stone-500">
                  <th className="py-2 pr-3">Akun</th>
                  <th className="py-2 pr-3">Tanggal</th>
                  <th className="py-2 pr-3 text-right">Saldo Bank</th>
                  <th className="py-2 pr-3 text-right">Saldo Buku</th>
                  <th className="py-2 pr-3">Selisih</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Catatan</th>
                  <th className="py-2">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {riwayat.map((r) => (
                  <tr key={r.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-semibold">{r.akun_kode}</div>
                      <div className="text-sm text-stone-600">{r.akun_nama}</div>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {formatTanggal(r.tanggal)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                      {formatRp(r.saldo_bank)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                      {formatRp(r.saldo_buku)}
                    </td>
                    <td className="py-2 pr-3">
                      <StatusSelisih status={r.status} selisih={r.selisih} />
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={r.selesai ? 'green' : 'amber'}>
                        {r.selesai ? 'Selesai' : 'Belum selesai'}
                      </Badge>
                      {r.selesai_at && (
                        <div className="mt-1 text-xs text-stone-500">
                          {formatTanggal(r.selesai_at.slice(0, 10))}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[220px] py-2 pr-3 text-stone-700">
                      {r.catatan || '—'}
                    </td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-2">
                        <Button variant="ghost" onClick={() => void bukaDetail(r)}>
                          Lihat Mutasi
                        </Button>
                        {!r.selesai && (
                          <Button
                            disabled={sibuk}
                            onClick={() => setKonfirmasiSelesai(r)}
                          >
                            Tandai Selesai
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {detail && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">
                Detail Rekonsiliasi {detail.akun_kode} — {formatTanggal(detail.tanggal)}
              </h3>
              <p className="text-sm text-stone-600">
                Mutasi jurnal {formatTanggal(detail.mulai)} s/d{' '}
                {formatTanggal(detail.tanggal)} · klik baris untuk melihat jurnal asal.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusSelisih status={detail.status} selisih={detail.selisih} />
              <Button variant="ghost" onClick={() => setDetail(null)}>
                Tutup
              </Button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KotakAngka
              label="Saldo awal mutasi"
              nilai={formatRp(detail.saldo_awal)}
              keterangan={`sebelum ${formatTanggal(detail.mulai)}`}
            />
            <KotakAngka
              label="Total mutasi jurnal"
              nilai={formatRp(detail.total_mutasi)}
              keterangan={`debit ${formatRp(detail.total_debit)} · kredit ${formatRp(
                detail.total_kredit,
              )}`}
            />
            <KotakAngka
              label="Saldo buku saat itu"
              nilai={formatRp(detail.saldo_buku)}
              keterangan={`s/d ${formatTanggal(detail.tanggal)}`}
            />
            <KotakAngka
              label="Saldo bank (rekening koran)"
              nilai={formatRp(detail.saldo_bank)}
              keterangan={detail.selesai ? 'Sudah ditandai selesai' : 'Belum selesai'}
            />
          </div>

          {detail.mutasi.length === 0 ? (
            <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px] text-stone-600">
              Tidak ada mutasi jurnal pada rentang ini.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">No. Bukti</th>
                    <th className="py-2 pr-3">Keterangan</th>
                    <th className="py-2 pr-3 text-right">Debit</th>
                    <th className="py-2 pr-3 text-right">Kredit</th>
                    <th className="py-2 text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.mutasi.map((m, i) => (
                    <tr
                      key={`${m.jurnal_id}-${m.baris_id ?? i}`}
                      className={
                        m.jurnal_id
                          ? 'cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50'
                          : 'border-b align-top last:border-0'
                      }
                      tabIndex={m.jurnal_id ? 0 : undefined}
                      title={m.jurnal_id ? 'Klik untuk melihat jurnal asal' : undefined}
                      onClick={() => void bukaJurnal(m.jurnal_id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void bukaJurnal(m.jurnal_id);
                        }
                      }}
                    >
                      <td className="whitespace-nowrap py-2 pr-3">
                        {formatTanggal(m.tanggal)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {m.no_bukti || '—'}
                      </td>
                      <td className="py-2 pr-3">{m.keterangan || '—'}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                        {m.debit ? formatRp(m.debit) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                        {m.kredit ? formatRp(m.kredit) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right font-semibold tabular-nums">
                        {formatRp(m.saldo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={3} className="py-2 pr-3 text-right">
                      Total mutasi:
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                      {formatRp(detail.total_debit)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right tabular-nums">
                      {formatRp(detail.total_kredit)}
                    </td>
                    <td className="whitespace-nowrap py-2 text-right tabular-nums">
                      {formatRp(detail.saldo_akhir)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="mt-2 text-xs text-stone-500">
            Saldo akhir {formatRp(detail.saldo_akhir)} − saldo awal{' '}
            {formatRp(detail.saldo_awal)} = total mutasi {formatRp(detail.total_mutasi)}.
          </p>
        </Card>
      )}

      {konfirmasiSimpan && (
        <KonfirmasiModal
          judul="Saldo bank dan saldo buku belum cocok"
          deskripsi={
            <>
              <p>
                Selisih {formatRp(Math.abs(konfirmasiSimpan.selisih))} (
                {LABEL_STATUS_REKONSILIASI[konfirmasiSimpan.status]}). Bank dan buku
                belum sama.
              </p>
              <p>
                Catatan/alasan yang tersimpan: <b>{catatan.trim() || '—'}</b>
              </p>
              <p>
                Rekonsiliasi tetap boleh disimpan sebagai dokumen pemeriksaan. Jurnal
                tidak diubah dan saldo buku tetap dihitung dari jurnal.
              </p>
            </>
          }
          labelYa="Ya, simpan dengan selisih"
          variant="primary"
          sibuk={sibuk}
          onBatal={() => setKonfirmasiSimpan(null)}
          onKonfirmasi={() => void simpanSekarang()}
        />
      )}

      {konfirmasiSelesai && (
        <KonfirmasiModal
          judul="Tandai rekonsiliasi selesai?"
          deskripsi={
            <p>
              Rekonsiliasi {konfirmasiSelesai.akun_kode} tanggal{' '}
              {formatTanggal(konfirmasiSelesai.tanggal)} akan ditandai selesai. Tindakan
              ini tercatat di riwayat audit dan tidak mengubah jurnal.
            </p>
          }
          labelYa="Ya, tandai selesai"
          variant="primary"
          sibuk={sibuk}
          onBatal={() => setKonfirmasiSelesai(null)}
          onKonfirmasi={() => void tandaiSelesai(konfirmasiSelesai)}
        />
      )}

      {detailJurnal && (
        <DetailJurnalModal
          jurnal={detailJurnal}
          coa={coa}
          onClose={() => setDetailJurnal(null)}
        />
      )}
    </div>
  );
}
