import { useEffect, useRef, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import type { JurnalBarisInput } from '../../core/types.js';
import {
  duplikatJurnalKeForm,
  type FormJurnalUmum,
} from '../../core/jurnalForm.js';
import { JENIS_JURNAL, tanggalKalenderValid } from '../../core/posting.js';
import { ALASAN_REVERSAL_MIN } from '../../core/reversal.js';
import {
  jurnalToWorkbook,
  periodeFile,
  rentangDariRows,
} from '../../features/export/workbooks.js';
import {
  jurnalDetailPrintDoc,
  jurnalPrintDoc,
} from '../../features/export/printAdapters.js';
import {
  renderPrintDocument,
  type PrintDoc,
  type PrintOrientation,
} from '../../features/export/printDoc.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, isPerluKonfirmasi, type JurnalLengkap } from '../lib/api.js';
import { useTabGuard } from '../lib/tabGuard.js';
import {
  Badge,
  Button,
  Card,
  CurrencyInput,
  ErrorBox,
  Field,
  KonfirmasiModal,
  Modal,
  Select,
  TextInput,
} from './ui.js';
import { ExportActions } from './ExportActions.js';
import { DetailJurnalModal } from './DetailJurnalModal.js';
import { JurnalUmumEditor } from './JurnalUmumEditor.js';
import { PratinjauCetakModal } from './PratinjauCetakModal.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';
import { PESAN_MUAT_GAGAL, PESAN_PROSES_GAGAL, pesanError } from '../../utils/pesanError.js';

const PAGE = 25;

const LABEL_JENIS: Record<string, string> = {
  UMUM: 'Jurnal Umum',
  TERIMA: 'Terima Uang',
  BAYAR: 'Bayar / Beban',
  TRANSFER: 'Pindah Dana',
  PANJAR: 'Panjar',
  PIUTANG: 'Piutang',
  HUTANG: 'Hutang',
  SALDO_AWAL: 'Saldo Awal',
  REVERSAL: 'Jurnal Balik',
};

const namaAkun = (coa: Coa[], kode: string): string => {
  const a = coa.find((x) => x.kode === kode);
  return a ? `${a.kode} — ${a.nama}` : kode;
};

type BarisForm = {
  akun_kode: string;
  sisi: 'DEBIT' | 'KREDIT';
  nominal: number;
  keterangan: string;
};

export function JurnalTab({
  modeAkuntan = true,
}: {
  /**
   * Layar Jurnal Umum memang layar akuntan pendamping. Prop ini memungkinkan
   * penempatan di layar operator tanpa tombol input jurnal manual.
   */
  modeAkuntan?: boolean;
}) {
  const [coa, setCoa] = useState<Coa[]>([]);
  const [daftar, setDaftar] = useState<JurnalLengkap[]>([]);
  const [total, setTotal] = useState(0);
  const [memuat, setMemuat] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [cari, setCari] = useState('');
  /** Kata kunci yang sudah di-debounce dan dikirim ke server. */
  const [cariServer, setCariServer] = useState('');
  const [fMulai, setFMulai] = useState('');
  const [fSampai, setFSampai] = useState('');
  const [fJenis, setFJenis] = useState('');
  const [page, setPage] = useState(0);
  /** Naikkan untuk memuat ulang halaman setelah simpan/koreksi. */
  const [versi, setVersi] = useState(0);

  const [detail, setDetail] = useState<JurnalLengkap | null>(null);
  const [koreksi, setKoreksi] = useState<JurnalLengkap | null>(null);
  const [editor, setEditor] = useState<{ awal?: FormJurnalUmum } | null>(null);
  const [pratinjau, setPratinjau] = useState<{
    judul: string;
    html: string;
    jumlahHalaman: number;
    orientasi: PrintOrientation;
  } | null>(null);

  function bukaPratinjau(doc: PrintDoc): void {
    try {
      setErr(null);
      const hasil = renderPrintDocument(doc);
      setPratinjau({ judul: doc.judul, ...hasil });
    } catch (e) {
      setErr(`Gagal membuat pratinjau cetak. ${pesanError(e, PESAN_PROSES_GAGAL)}`);
    }
  }

  function bukaEditor(awal?: FormJurnalUmum): void {
    setErr(null);
    setInfo(null);
    setEditor({ ...(awal ? { awal } : {}) });
  }

  function bukaDuplikat(jurnal: JurnalLengkap): void {
    try {
      const awal = duplikatJurnalKeForm(jurnal);
      setDetail(null);
      bukaEditor(awal);
    } catch (e) {
      setErr(pesanError(e, PESAN_PROSES_GAGAL));
    }
  }

  function refresh() {
    setVersi((v) => v + 1);
  }

  useEffect(() => {
    let aktif = true;
    api
      .coa()
      .then((c) => {
        if (aktif) setCoa(c);
      })
      .catch((e) => {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      });
    return () => {
      aktif = false;
    };
  }, []);

  // UI-11: rentang "dari" > "sampai" tidak boleh dikirim ke API. Bandingkan
  // string ISO (YYYY-MM-DD) agar urutannya sama dengan urutan tanggal.
  const rentangTidakValid = Boolean(fMulai && fSampai && fMulai > fSampai);

  // Debounce kata kunci; filter tanggal/jenis langsung memicu muat.
  useEffect(() => {
    const timer = setTimeout(() => {
      setCariServer(cari.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [cari]);

  useEffect(() => {
    let aktif = true;
    if (rentangTidakValid) {
      // Kosongkan hasil agar total/paginasi/export tidak memakai data lama.
      setDaftar([]);
      setTotal(0);
      setErr(null);
      setMemuat(false);
      return () => {
        aktif = false;
      };
    }
    setMemuat(true);
    api
      .jurnalCari({
        ...(cariServer ? { cari: cariServer } : {}),
        ...(fMulai ? { mulai: fMulai } : {}),
        ...(fSampai ? { sampai: fSampai } : {}),
        ...(fJenis ? { jenis: fJenis } : {}),
        limit: PAGE,
        offset: page * PAGE,
      })
      .then((r) => {
        if (!aktif) return;
        setDaftar(r.rows);
        setTotal(r.total);
        const halamanMaks = Math.max(0, Math.ceil(r.total / PAGE) - 1);
        if (page > halamanMaks) setPage(halamanMaks);
      })
      .catch((e) => {
        if (aktif) setErr(pesanError(e, PESAN_MUAT_GAGAL));
      })
      .finally(() => {
        if (aktif) setMemuat(false);
      });
    return () => {
      aktif = false;
    };
  }, [cariServer, fMulai, fSampai, fJenis, page, versi, rentangTidakValid]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const pageRows = daftar;
  const totalHalaman = pageRows.reduce((s, j) => s + j.total_debit, 0);
  const awalTampil = total === 0 ? 0 : page * PAGE + 1;
  const akhirTampil = page * PAGE + pageRows.length;
  const adaFilter = Boolean(cariServer || fMulai || fSampai || fJenis);

  const resetHalaman = () => setPage(0);
  const rentangFiltered = rentangDariRows(pageRows);
  const namaDasarJurnal = `jurnal-umum-${periodeFile(
    fMulai || rentangFiltered.mulai,
    fSampai || rentangFiltered.sampai,
  )}`;
  const opsiPeriodeJurnal = {
    ...(fMulai ? { mulai: fMulai } : {}),
    ...(fSampai ? { sampai: fSampai } : {}),
  };
  const filterServer = {
    ...(cariServer ? { cari: cariServer } : {}),
    ...(fMulai ? { mulai: fMulai } : {}),
    ...(fSampai ? { sampai: fSampai } : {}),
    ...(fJenis ? { jenis: fJenis } : {}),
  };

  /** Export/print memuat SEMUA hasil filter (bukan hanya halaman aktif). */
  async function muatSemuaJurnal(): Promise<JurnalLengkap[]> {
    // Jaring pengaman: tombol export sudah nonaktif saat rentang tidak valid.
    if (rentangTidakValid) return [];
    const ukuran = 200;
    const semua: JurnalLengkap[] = [];
    let offset = 0;
    for (let putaran = 0; putaran < 500; putaran += 1) {
      const r = await api.jurnalCari({ ...filterServer, limit: ukuran, offset });
      semua.push(...r.rows);
      offset += r.rows.length;
      if (r.rows.length === 0 || offset >= r.total) break;
    }
    return semua;
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Jurnal Umum</h2>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Semua transaksi tercatat sebagai jurnal debit–kredit. Kalau ada yang salah,
              jangan dihapus: pakai tombol <b>Koreksi</b>. Jurnal asli tetap disimpan untuk
              pemeriksaan, dan sistem membuat jurnal baliknya.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">Neraca Saldo selalu dihitung dari jurnal</Badge>
            {modeAkuntan && (
              <>
                <Badge tone="amber">Mode akuntan</Badge>
                <Button
                  type="button"
                  className="px-5 py-3 text-base"
                  onClick={() => bukaEditor()}
                >
                  + Jurnal Baru
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <ErrorBox msg={err} />
        {info && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">
            {info}
          </div>
        )}
        {/* UI-11: 2×2 di layar sempit, 5 kolom di >=1280 dengan search 2 kolom. */}
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <div className="xl:col-span-2">
            <Field label="Cari">
              <TextInput
                placeholder="No. bukti, keterangan, akun, nominal…"
                value={cari}
                onChange={(e) => setCari(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Dari tanggal">
            <TextInput
              type="date"
              value={fMulai}
              aria-invalid={rentangTidakValid || undefined}
              aria-describedby={
                rentangTidakValid ? 'jurnal-rentang-tanggal-error' : undefined
              }
              onChange={(e) => {
                setFMulai(e.target.value);
                resetHalaman();
              }}
            />
          </Field>
          <Field label="Sampai tanggal">
            <TextInput
              type="date"
              value={fSampai}
              aria-invalid={rentangTidakValid || undefined}
              aria-describedby={
                rentangTidakValid ? 'jurnal-rentang-tanggal-error' : undefined
              }
              onChange={(e) => {
                setFSampai(e.target.value);
                resetHalaman();
              }}
            />
          </Field>
          <Field label="Jenis">
            <Select
              value={fJenis}
              onChange={(e) => {
                setFJenis(e.target.value);
                resetHalaman();
              }}
            >
              <option value="">Semua jenis</option>
              {JENIS_JURNAL.map((j) => (
                <option key={j} value={j}>
                  {LABEL_JENIS[j] ?? j}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {rentangTidakValid && (
          <p
            id="jurnal-rentang-tanggal-error"
            role="alert"
            className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          >
            Tanggal “Dari” tidak boleh setelah “Sampai”. Perbaiki rentang tanggal
            untuk menampilkan jurnal.
          </p>
        )}

        <div className="mb-3">
          <ExportActions
            namaDasar={namaDasarJurnal}
            judul="Jurnal Umum"
            disabled={total === 0 || memuat || rentangTidakValid}
            buatWorkbook={async (kop) =>
              jurnalToWorkbook(await muatSemuaJurnal(), coa, {
                ...opsiPeriodeJurnal,
                kop,
              })
            }
            buatDokumen={async (kop) =>
              jurnalPrintDoc(await muatSemuaJurnal(), coa, {
                ...opsiPeriodeJurnal,
                kop,
              })
            }
          />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Tanggal</th>
                <th className="py-2 pr-3">No. Bukti</th>
                <th className="py-2 pr-3">Keterangan</th>
                <th className="py-2 pr-3">Jenis</th>
                <th className="py-2 pr-3 text-right">Total</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((j) => {
                const terkunci = Boolean(j.reversal_of) || Boolean(j.reversal_id);
                // UI-12: nomor bukti dipakai sebagai konteks aksi baris. Jurnal lama
                // bisa tanpa no. bukti; tanggal + potongan id menjaga nama tetap unik.
                const nomorBuktiAksesibel =
                  j.no_bukti?.trim() || `${formatTanggal(j.tanggal)} ${j.id.slice(0, 12)}`;
                return (
                  <tr key={j.id} className="border-b align-top last:border-0">
                    <td className="whitespace-nowrap py-2 pr-3">{formatTanggal(j.tanggal)}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{j.no_bukti || '—'}</td>
                    <td className="py-2 pr-3">
                      <div>{j.keterangan}</div>
                      <div className="text-xs text-stone-500">{j.id}</div>
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{LABEL_JENIS[j.jenis] ?? j.jenis}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">{formatRp(j.total_debit)}</td>
                    <td className="py-2 pr-3">
                      {j.reversal_of ? (
                        <Badge tone="red">Jurnal balik</Badge>
                      ) : j.reversal_id ? (
                        <Badge tone="amber">Sudah dikoreksi</Badge>
                      ) : (
                        <Badge tone="stone">Aktif</Badge>
                      )}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          aria-label={`Lihat jurnal ${nomorBuktiAksesibel}`}
                          onClick={() => setDetail(j)}
                        >
                          Lihat
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Koreksi jurnal ${nomorBuktiAksesibel}`}
                          disabled={terkunci}
                          title={
                            terkunci
                              ? 'Jurnal balik / jurnal yang sudah dikoreksi tidak bisa dikoreksi lagi.'
                              : undefined
                          }
                          onClick={() => {
                            setErr(null);
                            setInfo(null);
                            setKoreksi(j);
                          }}
                        >
                          Koreksi
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-stone-500">
                    {memuat
                      ? 'Memuat jurnal…'
                      : rentangTidakValid
                        ? 'Perbaiki rentang tanggal untuk menampilkan jurnal.'
                        : adaFilter
                          ? 'Tidak ada jurnal yang cocok dengan filter.'
                          : 'Belum ada jurnal.'}
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td colSpan={4} className="py-2 pr-3 text-right">
                  Total halaman ({pageRows.length} jurnal):
                </td>
                <td className="py-2 pr-3 text-right">{formatRp(totalHalaman)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <Button variant="ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ‹ Prev
          </Button>
          <span className="text-sm text-stone-600">
            Menampilkan {awalTampil}–{akhirTampil} dari {total} jurnal · Hal{' '}
            {page + 1} / {pages}
          </span>
          <Button
            variant="ghost"
            disabled={page + 1 >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next ›
          </Button>
        </div>
      </Card>

      {detail && (
        <DetailJurnalModal
          jurnal={detail}
          coa={coa}
          onClose={() => setDetail(null)}
          onDuplikat={bukaDuplikat}
          onPrint={(jurnal) => {
            // Pratinjau cetak belum memakai Modal bersama (UI-10) dan masih
            // z-30, jadi tutup detail dulu agar pratinjau tidak tertutup
            // modal detail yang kini minimal z-40.
            setDetail(null);
            bukaPratinjau(jurnalDetailPrintDoc(jurnal, coa));
          }}
        />
      )}

      {koreksi && (
        <KoreksiModal
          jurnal={koreksi}
          coa={coa}
          onBatal={() => setKoreksi(null)}
          onSelesai={(pesan) => {
            setKoreksi(null);
            setInfo(pesan);
            setPage(0);
            refresh();
          }}
        />
      )}

      {editor && (
        <JurnalUmumEditor
          coa={coa}
          awal={editor.awal}
          onBatal={() => setEditor(null)}
          onSelesai={(pesan) => {
            setEditor(null);
            setInfo(pesan);
            setPage(0);
            refresh();
          }}
        />
      )}

      {pratinjau && (
        <PratinjauCetakModal
          judul={pratinjau.judul}
          html={pratinjau.html}
          jumlahHalaman={pratinjau.jumlahHalaman}
          orientasi={pratinjau.orientasi}
          onClose={() => setPratinjau(null)}
        />
      )}
    </div>
  );
}

function KoreksiModal({
  jurnal,
  coa,
  onBatal,
  onSelesai,
}: {
  jurnal: JurnalLengkap;
  coa: Coa[];
  onBatal: () => void;
  onSelesai: (pesan: string) => void;
}) {
  const [langkah, setLangkah] = useState<'alasan' | 'isi-ulang'>('alasan');
  const [alasan, setAlasan] = useState('');
  // Default satu periode dengan jurnal asli: koreksi tidak menggeser laba
  // tahunan ke tahun berjalan. Operator tetap bisa mengubah tanggalnya.
  const [tanggalBalik, setTanggalBalik] = useState(jurnal.tanggal);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [pending, setPending] = useState<null | 'balik' | 'isi-ulang'>(null);
  const [konfirmasiFinal, setKonfirmasiFinal] = useState<null | 'balik' | 'isi-ulang'>(
    null,
  );
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState('');

  // UI-08: Koreksi adalah modal di dalam tab Jurnal. Isian yang belum disimpan
  // harus memicu guard saat pindah tab; status dibersihkan saat modal ditutup
  // agar Batal/Escape/klik latar tidak memunculkan dialog guard ganda.
  const { setDirty } = useTabGuard();
  useEffect(() => () => setDirty(false), [setDirty]);

  // Form isi ulang: terisi data lama supaya operator tinggal membetulkan typo.
  const [tanggal, setTanggal] = useState(jurnal.tanggal);
  const [keterangan, setKeterangan] = useState(jurnal.keterangan);
  const [noBukti, setNoBukti] = useState('');
  const [baris, setBaris] = useState<BarisForm[]>(() =>
    jurnal.baris.map((b) => ({
      akun_kode: b.akun_kode,
      sisi: b.debit > 0 ? 'DEBIT' : 'KREDIT',
      nominal: b.debit > 0 ? b.debit : b.kredit,
      keterangan: b.keterangan,
    })),
  );

  const totalDebit = baris
    .filter((b) => b.sisi === 'DEBIT')
    .reduce((s, b) => s + b.nominal, 0);
  const totalKredit = baris
    .filter((b) => b.sisi === 'KREDIT')
    .reduce((s, b) => s + b.nominal, 0);
  const seimbang = totalDebit === totalKredit && totalDebit > 0;
  const alasanSah = alasan.trim().length >= ALASAN_REVERSAL_MIN;
  const dataBarisSah =
    baris.length >= 2 && baris.every((b) => Boolean(b.akun_kode) && b.nominal > 0);
  const formSah =
    alasanSah &&
    tanggalKalenderValid(tanggal) &&
    Boolean(keterangan.trim()) &&
    dataBarisSah &&
    seimbang;
  const bedaTahun =
    tanggalKalenderValid(tanggalBalik) &&
    tanggalKalenderValid(tanggal) &&
    tanggalBalik.slice(0, 4) !== tanggal.slice(0, 4);

  function ubahBaris(index: number, patch: Partial<BarisForm>) {
    setBaris((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function tambahBaris() {
    setBaris((rows) => [
      ...rows,
      { akun_kode: coa[0]?.kode ?? '', sisi: 'DEBIT', nominal: 0, keterangan: '' },
    ]);
    setDirty(true);
  }

  function hapusBaris(index: number) {
    if (baris.length <= 2) return;
    setBaris((rows) => rows.filter((_, i) => i !== index));
    setDirty(true);
  }

  /** Batal yang disengaja: bersihkan guard sebelum modal di-unmount. */
  function batal(): void {
    setDirty(false);
    onBatal();
  }

  async function kirimBalik(konfirmasi = false) {
    if (busyRef.current) return;
    setErr(null);
    setPending(null);
    setKonfirmasiFinal(null);
    busyRef.current = true;
    setBusy(true);
    try {
      await api.jurnalReverse(jurnal.id, alasan.trim(), {
        tanggal: tanggalBalik,
        konfirmasiPeringatan: konfirmasi,
      });
      setDirty(false);
      onSelesai(
        `Jurnal balik untuk ${jurnal.no_bukti || jurnal.id} tersimpan. Jurnal asli tetap ada.`,
      );
    } catch (e) {
      if (isPerluKonfirmasi(e) && !konfirmasi) {
        setPending('balik');
        setPesanKonfirmasi(pesanError(e));
      } else {
        setErr(pesanError(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function kirimIsiUlang(konfirmasi = false) {
    if (busyRef.current) return;
    setErr(null);
    setPending(null);
    setKonfirmasiFinal(null);
    busyRef.current = true;
    setBusy(true);
    try {
      const isi: JurnalBarisInput[] = baris.map((b) => ({
        akun_kode: b.akun_kode,
        debit: b.sisi === 'DEBIT' ? b.nominal : 0,
        kredit: b.sisi === 'KREDIT' ? b.nominal : 0,
        keterangan: b.keterangan.trim(),
      }));
      const hasil = await api.jurnalKoreksiIsiUlang(
        jurnal.id,
        alasan.trim(),
        {
          header: {
            // Dikosongkan: main membuat ID jurnal yang unik.
            id: '',
            tanggal,
            keterangan: keterangan.trim(),
            no_bukti: noBukti.trim(),
            jenis: jurnal.jenis,
          },
          baris: isi,
        },
        { tanggal: tanggalBalik, konfirmasiPeringatan: konfirmasi },
      );
      setDirty(false);
      onSelesai(
        `Koreksi tersimpan: jurnal balik ${hasil.reversal.id} + jurnal pengganti ${hasil.jurnalBaru.id}. Jurnal asli tetap ada.`,
      );
    } catch (e) {
      if (isPerluKonfirmasi(e) && !konfirmasi) {
        setPending('isi-ulang');
        setPesanKonfirmasi(pesanError(e));
      } else {
        setErr(pesanError(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      judul="Koreksi Jurnal"
      deskripsi={
        <span className="text-[15px]">
          Jurnal asli <b>tidak dihapus</b>. Sistem membuat jurnal balik (debit dan
          kredit ditukar), lalu Anda bisa mengisi ulang data yang benar. Semua
          koreksi tercatat di riwayat audit.
        </span>
      }
      onTutup={batal}
      sibuk={busy}
      lebar="3xl"
    >
      <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
        Jurnal balik mengikuti tanggal asli. Jika periode terkunci, isi alasan minimal{' '}
        {ALASAN_REVERSAL_MIN} karakter.
      </p>
      <div className="mt-3 rounded-lg border border-stone-200 bg-stone-50 p-3 text-[15px]">
          <p className="font-semibold">{jurnal.keterangan}</p>
          <p className="text-sm text-stone-600">
            {formatTanggal(jurnal.tanggal)} · {jurnal.no_bukti || 'tanpa nomor bukti'} ·{' '}
            {formatRp(jurnal.total_debit)}
          </p>
        </div>

        <ErrorBox msg={err} />

        {bedaTahun && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="font-semibold">Tanggal jurnal balik dan pengganti berbeda tahun.</p>
            <p className="mt-1 text-[15px]">
              Laba Rugi tahunan akan terdistorsi: pembalikan dicatat di tahun{' '}
              {tanggalBalik.slice(0, 4)}, sedangkan jurnal pengganti dicatat di tahun{' '}
              {tanggal.slice(0, 4)}. Total ekuitas tetap benar, tetapi laba tiap tahun tidak
              mencerminkan koreksi. Sebaiknya samakan tahunnya dengan jurnal asli.
            </p>
          </div>
        )}

        {langkah === 'alasan' ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label={`Alasan koreksi (min. ${ALASAN_REVERSAL_MIN} karakter)`}>
                <TextInput
                  autoFocus
                  value={alasan}
                  placeholder="cth: salah ketik nominal, seharusnya Rp 80.000"
                  onChange={(e) => {
                    setAlasan(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Tanggal jurnal balik">
                <TextInput
                  type="date"
                  value={tanggalBalik}
                  onChange={(e) => {
                    setTanggalBalik(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
            </div>

            <h4 className="mt-4 font-bold">Pratinjau jurnal balik</h4>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Akun</th>
                    <th className="py-2 pr-3 text-right">Debit</th>
                    <th className="py-2 text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {jurnal.baris.map((b) => (
                    <tr key={b.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{namaAkun(coa, b.akun_kode)}</td>
                      <td className="py-2 pr-3 text-right">{b.kredit ? formatRp(b.kredit) : ''}</td>
                      <td className="py-2 text-right">{b.debit ? formatRp(b.debit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {pending === 'balik' && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <p className="text-[15px]">{pesanKonfirmasi}</p>
                <div className="mt-2 flex gap-2">
                  <Button disabled={busy} onClick={() => void kirimBalik(true)}>
                    Tetap simpan
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                    Batal
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={batal}>
                Batal
              </Button>
              <Button
                variant="ghost"
                disabled={busy || !alasanSah || !tanggalKalenderValid(tanggalBalik)}
                onClick={() => setKonfirmasiFinal('balik')}
              >
                {busy ? 'Menyimpan…' : 'Jurnal balik saja'}
              </Button>
              <Button
                disabled={busy || !alasanSah || !tanggalKalenderValid(tanggalBalik)}
                onClick={() => {
                  setErr(null);
                  setLangkah('isi-ulang');
                }}
              >
                Koreksi & isi ulang
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
              <Field label="Tanggal jurnal pengganti">
                <TextInput
                  type="date"
                  value={tanggal}
                  onChange={(e) => {
                    setTanggal(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="Keterangan">
                <TextInput
                  value={keterangan}
                  onChange={(e) => {
                    setKeterangan(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
              <Field label="No. bukti baru (opsional)">
                <TextInput
                  value={noBukti}
                  placeholder="kosongkan untuk nomor otomatis"
                  onChange={(e) => {
                    setNoBukti(e.target.value);
                    setDirty(true);
                  }}
                />
              </Field>
            </div>
            <SaranNomorBukti tanggal={tanggal} />
            <p className="mt-1 text-helper text-stone-500">
              Nomor bukti lama tetap menempel di jurnal asli. Nomor baru otomatis
              memakai urutan berikutnya dan tidak boleh sama.
            </p>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-2">Akun</th>
                    <th className="py-2 pr-2">Sisi</th>
                    <th className="py-2 pr-2 text-right">Nominal (Rp)</th>
                    <th className="py-2 pr-2">Catatan baris</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {baris.map((b, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 pr-2">
                        <Select
                          value={b.akun_kode}
                          onChange={(e) => ubahBaris(i, { akun_kode: e.target.value })}
                        >
                          {coa.map((a) => (
                            <option key={a.kode} value={a.kode}>
                              {a.kode} — {a.nama}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-2 pr-2">
                        <Select
                          value={b.sisi}
                          onChange={(e) =>
                            ubahBaris(i, { sisi: e.target.value as 'DEBIT' | 'KREDIT' })
                          }
                        >
                          <option value="DEBIT">Debit</option>
                          <option value="KREDIT">Kredit</option>
                        </Select>
                      </td>
                      <td className="py-2 pr-2">
                        <CurrencyInput
                          value={b.nominal}
                          onChange={(n) => ubahBaris(i, { nominal: n })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <TextInput
                          value={b.keterangan}
                          onChange={(e) => ubahBaris(i, { keterangan: e.target.value })}
                        />
                      </td>
                      <td className="py-2">
                        <Button
                          variant="ghost"
                          disabled={baris.length <= 2}
                          onClick={() => hapusBaris(i)}
                        >
                          Hapus
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={2} className="py-2 pr-2 text-right">Total:</td>
                    <td className="py-2 pr-2 text-right">{formatRp(totalDebit)}</td>
                    <td colSpan={2} className="py-2 text-sm">
                      {seimbang ? (
                        <Badge tone="green">Seimbang</Badge>
                      ) : (
                        <Badge tone="red">
                          Debit {formatRp(totalDebit)} ≠ Kredit {formatRp(totalKredit)}
                        </Badge>
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-2">
              <Button variant="ghost" onClick={tambahBaris}>+ Tambah baris</Button>
            </div>

            {pending === 'isi-ulang' && (
              <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
                <p className="text-[15px]">{pesanKonfirmasi}</p>
                <div className="mt-2 flex gap-2">
                  <Button disabled={busy} onClick={() => void kirimIsiUlang(true)}>
                    Tetap simpan
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => setPending(null)}>
                    Batal
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => setLangkah('alasan')}>
                Kembali
              </Button>
              <Button variant="ghost" disabled={busy} onClick={batal}>
                Batal
              </Button>
              <Button
                disabled={busy || !formSah}
                onClick={() => setKonfirmasiFinal('isi-ulang')}
              >
                {busy ? 'Menyimpan…' : 'Simpan koreksi'}
              </Button>
            </div>
          </>
        )}

        {konfirmasiFinal && (
          <KonfirmasiModal
            judul={
              konfirmasiFinal === 'balik'
                ? 'Simpan jurnal balik?'
                : 'Simpan koreksi & isi ulang?'
            }
            deskripsi={
              <>
                <p>
                  No. bukti: <b>{jurnal.no_bukti || 'tanpa nomor'}</b>
                </p>
                <p>Tanggal: <b>{formatTanggal(jurnal.tanggal)}</b></p>
                <p>Nominal: <b>{formatRp(jurnal.total_debit)}</b></p>
                <p>Alasan: <b>{alasan.trim()}</b></p>
                {konfirmasiFinal === 'isi-ulang' && (
                  <p>
                    Jurnal pengganti: <b>{formatTanggal(tanggal)}</b> —{' '}
                    <b>{formatRp(totalDebit)}</b>
                  </p>
                )}
                <p className="text-sm text-stone-600">
                  Jurnal asli tetap disimpan. Tindakan ini tercatat di riwayat audit
                  dan tidak bisa dibatalkan.
                </p>
              </>
            }
            labelYa={
              konfirmasiFinal === 'balik' ? 'Ya, simpan jurnal balik' : 'Ya, simpan koreksi'
            }
            sibuk={busy}
            onBatal={() => setKonfirmasiFinal(null)}
            onKonfirmasi={() => {
              const aksi = konfirmasiFinal;
              setKonfirmasiFinal(null);
              if (aksi === 'balik') void kirimBalik();
              else void kirimIsiUlang();
            }}
          />
        )}
    </Modal>
  );
}
