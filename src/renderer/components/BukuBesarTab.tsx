import { useEffect, useRef, useState } from 'react';
import { isAkunKasData, type Coa, type PosisiNormal } from '../../db/coa.js';
import {
  bukuBesarToWorkbook,
  periodeFile,
} from '../../features/export/workbooks.js';
import { bukuBesarPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, type BukuBesarHasil, type JurnalLengkap } from '../lib/api.js';
import {
  LABEL_TIPE_AKUN,
  labelSisiSaldo,
  sisiSaldo,
  toneSisiSaldo,
} from '../lib/tampilanLaporan.js';
import { Badge, BadgeMemperbarui, Card, ErrorBox, Field, Select } from './ui.js';
import { KontrolPeriode } from './KontrolPeriode.js';
import { DetailJurnalModal } from './DetailJurnalModal.js';
import { ExportActions } from './ExportActions.js';
import { ALASAN_EKSPOR_KOSONG, rentangTerbalik } from '../lib/tampilanLaporan.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';


function SisiSaldoBadge({
  saldo,
  posisiNormal,
}: {
  saldo: number;
  posisiNormal: PosisiNormal;
}) {
  const sisi = sisiSaldo(saldo, posisiNormal);
  return <Badge tone={toneSisiSaldo(sisi)}>{labelSisiSaldo(sisi)}</Badge>;
}

/**
 * AUD2-12: istilah Debit/Kredit tetap dipertahankan untuk akuntan, dengan
 * sub-label arah yang memudahkan bendahara membaca efek mutasi pada akun.
 * UI-A17: akun kas/bank tetap memakai "Masuk/Keluar" (uang masuk/keluar
 * dompet), akun lain (Beban, Piutang, Panjar, Kewajiban, ...) memakai
 * "Bertambah/Berkurang" agar "+ / Masuk" tidak muncul untuk akun non-kas.
 */
export function KepalaMutasi({
  posisiNormal,
  kasBank = false,
}: {
  posisiNormal: PosisiNormal;
  /** True hanya untuk akun kas/bank (kelompok KAS/BANK/LPD). */
  kasBank?: boolean;
}) {
  const masukKas = kasBank && posisiNormal === 'DEBIT';
  const debit = masukKas ? '+ / Masuk' : posisiNormal === 'DEBIT' ? '+ / Bertambah' : '- / Berkurang';
  const kredit = masukKas
    ? '- / Keluar'
    : posisiNormal === 'DEBIT'
      ? '- / Berkurang'
      : '+ / Bertambah';
  return (
    <>
      <th scope="col" className="py-2 pr-3 text-right">
        <span className="block">Debit</span>
        <span className="block text-helper font-normal text-stone-500">({debit})</span>
      </th>
      <th scope="col" className="py-2 pr-3 text-right">
        <span className="block">Kredit</span>
        <span className="block text-helper font-normal text-stone-500">({kredit})</span>
      </th>
    </>
  );
}

/**
 * UI-A03: periode sumber drill-down dari laporan yang diklik (Neraca / Neraca
 * Saldo). String kosong berarti tanpa batas, sama dengan filter Buku Besar.
 */
export type PeriodeBukuBesar = { mulai: string; sampai: string };

export function BukuBesarTab({
  akunAwal,
  periodeAwal,
}: {
  akunAwal?: string;
  /**
   * UI-A03: periode sumber drill-down; hanya nilai awal — rentang yang sudah
   * diubah operator tidak ditimpa selama drill-down berikutnya sama.
   */
  periodeAwal?: PeriodeBukuBesar;
}) {
  const [coa, setCoa] = useState<Coa[] | null>(null);
  const [akun, setAkun] = useState(akunAwal ?? '');
  const [mulai, setMulai] = useState(periodeAwal?.mulai ?? '');
  const [sampai, setSampai] = useState(periodeAwal?.sampai ?? '');
  const [data, setData] = useState<BukuBesarHasil | null>(null);
  const [detail, setDetail] = useState<JurnalLengkap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const detailBusyRef = useRef(false);

  // Muat daftar akun sekali; pilih 1001 bila ada agar operator langsung melihat kas.
  useEffect(() => {
    let aktif = true;
    api
      .coa()
      .then((daftar) => {
        if (!aktif) return;
        setCoa(daftar);
        setAkun((sebelumnya) => {
          if (sebelumnya && daftar.some((a) => a.kode === sebelumnya)) return sebelumnya;
          if (akunAwal && daftar.some((a) => a.kode === akunAwal)) return akunAwal;
          if (daftar.some((a) => a.kode === '1001')) return '1001';
          return daftar[0]?.kode ?? '';
        });
      })
      .catch((e) => {
        if (aktif) {
          setCoa([]);
          setErr(pesanError(e, PESAN_MUAT_GAGAL));
        }
      });
    return () => {
      aktif = false;
    };
    // akunAwal hanya dipakai saat daftar akun pertama kali dimuat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drill-down dari Neraca Saldo bisa mengganti akun saat tab sudah terbuka.
  useEffect(() => {
    if (akunAwal) setAkun(akunAwal);
  }, [akunAwal]);

  // UI-A03: drill-down juga membawa periode sumber (cut-off Neraca/Neraca
  // Saldo) agar saldo akhir dihitung dengan cut-off yang sama dengan angka
  // yang diklik. Nilai hanya awal: memakai string turunan sebagai dependensi
  // sehingga rentang yang sudah diubah operator tidak ditimpa tanpa alasan.
  const mulaiAwal = periodeAwal?.mulai ?? '';
  const sampaiAwal = periodeAwal?.sampai ?? '';
  useEffect(() => {
    setMulai(mulaiAwal);
  }, [mulaiAwal]);
  useEffect(() => {
    setSampai(sampaiAwal);
  }, [sampaiAwal]);

  // UI-11/UI-A10: rentang "dari" > "sampai" tidak boleh dikirim ke API. Guard
  // seragam dari lib bersama (perbandingan string ISO YYYY-MM-DD).
  const rentangTidakValid = rentangTerbalik(mulai, sampai);
  // UI-A10: fetch baru sedang berjalan sementara data lama masih tampil.
  const menyegarkan = memuat && data !== null;

  // Setiap perubahan akun/periode mengambil data baru dari main; tidak ada
  // saldo tersimpan di renderer.
  useEffect(() => {
    if (!akun) {
      setData(null);
      setMemuat(false);
      return;
    }
    if (rentangTidakValid) {
      // Hapus hasil lama agar laporan/export tidak menampilkan periode lain.
      setData(null);
      setErr(null);
      setMemuat(false);
      return;
    }
    let aktif = true;
    setMemuat(true);
    setErr(null);
    api
      .laporanBukuBesar({
        akun_kode: akun,
        ...(mulai ? { mulai } : {}),
        ...(sampai ? { sampai } : {}),
      })
      .then((hasil) => {
        if (aktif) setData(hasil);
      })
      .catch((e) => {
        if (aktif) {
          setData(null);
          setErr(pesanError(e, PESAN_MUAT_GAGAL));
        }
      })
      .finally(() => {
        if (aktif) setMemuat(false);
      });
    return () => {
      aktif = false;
    };
  }, [akun, mulai, sampai, rentangTidakValid]);

  async function bukaDetail(jurnalId: string): Promise<void> {
    if (!jurnalId || detailBusyRef.current) return;
    detailBusyRef.current = true;
    setErr(null);
    try {
      setDetail(await api.laporanJurnalDetail(jurnalId));
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      detailBusyRef.current = false;
    }
  }

  const akunTerpilih = coa?.find((a) => a.kode === akun) ?? null;
  const adaMutasi = (data?.rows.length ?? 0) > 0;
  // UI-A03: drill-down aktif berarti ada cut-off sumber yang diteruskan.
  const drilldownAktif = Boolean(sampaiAwal);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Buku Besar</h1>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Buku Besar menampilkan rincian uang masuk dan keluar untuk satu akun.
              Pilih akun dan periode, lalu klik baris mutasi untuk melihat jurnal asalnya.
              Semua saldo dihitung ulang dari jurnal, jadi angkanya selalu bisa diperiksa.
            </p>
          </div>
          <Badge tone="green">Dihitung dari jurnal</Badge>
        </div>
      </Card>

      <Card>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Field label="Akun">
            <Select
              value={akun}
              onChange={(e) => setAkun(e.target.value)}
              disabled={!coa || coa.length === 0}
            >
              {!coa && <option value="">Memuat akun…</option>}
              {coa?.length === 0 && <option value="">Belum ada akun</option>}
              {coa?.map((a) => (
                <option key={a.kode} value={a.kode}>
                  {a.kode} — {a.nama}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {/* UI-A10: kontrol periode bersama; preset "Semua tanggal" menggantikan
            tombol "Reset tanggal" (efeknya sama: rentang kosong = seluruh
            riwayat), termasuk nilai awal dari prop `periodeAwal` drill-down. */}
        <KontrolPeriode
          className="mt-3"
          mulai={mulai}
          sampai={sampai}
          onMulai={setMulai}
          onSampai={setSampai}
          namaLaporan="Buku Besar"
        />

        <p className="mt-2 text-helper text-stone-500">
          Kosongkan tanggal (preset “Semua tanggal”) untuk melihat seluruh riwayat. Saldo awal
          adalah saldo sebelum tanggal “Dari”; saldo akhir adalah saldo sampai tanggal
          “Sampai”.
        </p>

        {data && !rentangTidakValid && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`buku-besar-${data.kode}-${periodeFile(data.mulai, data.sampai)}`}
              judul={`Buku Besar ${data.kode} — ${data.nama}`}
              disabled={memuat || (data.rows.length === 0 && data.saldoAwal === 0)}
              alasanNonaktif={
                data.rows.length === 0 && data.saldoAwal === 0
                  ? ALASAN_EKSPOR_KOSONG
                  : undefined
              }
              buatWorkbook={(kop) => bukuBesarToWorkbook(data, kop)}
              buatDokumen={(kop) => bukuBesarPrintDoc(data, { kop })}
            />
          </div>
        )}

        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>

        {!coa && <p className="mt-3 text-stone-500">Memuat daftar akun…</p>}
        {coa && coa.length === 0 && !err && (
          <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
            Belum ada akun pada daftar akun (COA). Tambahkan akun terlebih dahulu sebelum
            membuka Buku Besar.
          </p>
        )}
        {coa && coa.length > 0 && !akun && (
          <p className="mt-3 text-stone-500">Pilih akun untuk menampilkan Buku Besar.</p>
        )}
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Buku Besar…</p>}
      </Card>

      {data && akunTerpilih && (
        <>
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">
                  {data.kode} — {data.nama}
                </h3>
                <p className="text-sm text-stone-600">
                  {LABEL_TIPE_AKUN[data.tipe]} · saldo normal{' '}
                  {data.posisi_normal === 'DEBIT' ? 'debit' : 'kredit'}
                  {data.mulai || data.sampai
                    ? ` · periode ${data.mulai ? formatTanggal(data.mulai) : 'awal'} s/d ${
                        data.sampai ? formatTanggal(data.sampai) : 'akhir'
                      }`
                    : ' · seluruh riwayat'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* UI-A03: saat drill-down, sebutkan cut-off sumber agar
                    angka ini jelas cocok dengan laporan asalnya. */}
                <span className="text-sm text-stone-600">
                  {drilldownAktif && data.sampai
                    ? `Saldo akhir (per ${formatTanggal(data.sampai)}):`
                    : 'Saldo akhir:'}
                </span>
                <span className="text-xl font-bold">{formatRp(data.saldoAkhir)}</span>
                <SisiSaldoBadge saldo={data.saldoAkhir} posisiNormal={data.posisi_normal} />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Saldo awal</div>
                <div className="text-lg font-bold">{formatRp(data.saldoAwal)}</div>
                <div className="mt-1">
                  <SisiSaldoBadge saldo={data.saldoAwal} posisiNormal={data.posisi_normal} />
                </div>
                <div className="mt-1 text-helper text-stone-500">
                  {data.mulai ? `sebelum ${formatTanggal(data.mulai)}` : 'tanpa batas awal'}
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Total debit</div>
                <div className="text-lg font-bold">{formatRp(data.totalDebit)}</div>
                <div className="mt-1 text-helper text-stone-500">mutasi dalam periode</div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Total kredit</div>
                <div className="text-lg font-bold">{formatRp(data.totalKredit)}</div>
                <div className="mt-1 text-helper text-stone-500">mutasi dalam periode</div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Saldo akhir</div>
                <div className="text-lg font-bold">{formatRp(data.saldoAkhir)}</div>
                <div className="mt-1">
                  <SisiSaldoBadge saldo={data.saldoAkhir} posisiNormal={data.posisi_normal} />
                </div>
                <div className="mt-1 text-helper text-stone-500">
                  {data.sampai ? `s/d ${formatTanggal(data.sampai)}` : 's/d akhir riwayat'}
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-bold">
                Mutasi akun <BadgeMemperbarui aktif={menyegarkan} />
              </h3>
              <span className="text-sm text-stone-600">
                {data.rows.length} baris · klik baris untuk melihat jurnal asal
              </span>
            </div>
            {/* UI-A10: data lama diredupkan + aria-busy saat hasil baru diambil. */}
            <div
              className={
                menyegarkan ? 'overflow-x-auto opacity-60 transition-opacity' : 'overflow-x-auto'
              }
              aria-busy={menyegarkan || undefined}
            >
              <table className="w-full text-left text-[15px]">
                {/* UI-A21: caption sr-only tanpa mengubah tampilan. */}
                <caption className="sr-only">
                  Rincian mutasi Buku Besar akun {data.kode} — {data.nama}
                </caption>
                <thead>
                  <tr className="border-b text-stone-500">
                    <th scope="col" className="py-2 pr-3">Tanggal</th>
                    <th scope="col" className="py-2 pr-3">No. Bukti</th>
                    <th scope="col" className="py-2 pr-3">Keterangan</th>
                    <KepalaMutasi
                      posisiNormal={data.posisi_normal}
                      kasBank={isAkunKasData(akunTerpilih ?? { kode: data.kode })}
                    />
                    <th scope="col" className="py-2 pr-3 text-right">Saldo</th>
                    <th scope="col" className="py-2">Sisi</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr
                      key={`${r.jurnal_id}-${r.baris_id ?? i}`}
                      className="cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50"
                      tabIndex={0}
                      title="Klik untuk melihat jurnal asal"
                      // UI-A21: baris diumumkan sebagai tombol dengan label
                      // yang menyebut jurnal mana yang akan dibuka.
                      role="button"
                      aria-label={`Buka detail jurnal ${formatTanggal(r.tanggal)}${
                        r.no_bukti ? ` · ${r.no_bukti}` : ''
                      } — ${r.keterangan || 'tanpa keterangan'}`}
                      onClick={() => void bukaDetail(r.jurnal_id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          void bukaDetail(r.jurnal_id);
                        }
                      }}
                    >
                      <td className="whitespace-nowrap py-2 pr-3">
                        {formatTanggal(r.tanggal)}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        {r.no_bukti || '—'}
                      </td>
                      <td className="py-2 pr-3">{r.keterangan || '—'}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.debit ? formatRp(r.debit) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.kredit ? formatRp(r.kredit) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right font-semibold">
                        {formatRp(r.saldo)}
                      </td>
                      <td className="py-2">
                        <SisiSaldoBadge
                          saldo={r.saldo}
                          posisiNormal={data.posisi_normal}
                        />
                      </td>
                    </tr>
                  ))}
                  {!adaMutasi && (
                    <tr>
                      <td colSpan={7} className="py-4 text-center text-stone-500">
                        Tidak ada mutasi pada periode ini. Saldo tetap{' '}
                        {formatRp(data.saldoAkhir)}.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={3} className="py-2 pr-3 text-right">
                      Total mutasi:
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalDebit)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalKredit)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.saldoAkhir)}
                    </td>
                    <td className="py-2">
                      <SisiSaldoBadge
                        saldo={data.saldoAkhir}
                        posisiNormal={data.posisi_normal}
                      />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
        </>
      )}

      {detail && (
        <DetailJurnalModal
          jurnal={detail}
          coa={coa ?? []}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
