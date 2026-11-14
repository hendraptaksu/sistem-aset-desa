import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import type { ArusKasHasil } from '../../core/reports.js';
import {
  arusKasToWorkbook,
  periodeFile,
} from '../../features/export/workbooks.js';
import { arusKasPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { periodeBerjalan } from '../../utils/tanggal.js';
import { api, type JurnalLengkap } from '../lib/api.js';
import {
  ALASAN_EKSPOR_KOSONG,
  labelKelompokArusKas,
  labelPeriodeHasil,
  labelPeriodeLaporan,
  rentangTerbalik,
} from '../lib/tampilanLaporan.js';
import { Badge, BadgeMemperbarui, Card, ErrorBox } from './ui.js';
import { KontrolPeriode } from './KontrolPeriode.js';
import { DetailJurnalModal } from './DetailJurnalModal.js';
import { ExportActions } from './ExportActions.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';


const KELOMPOK: {
  kunci: 'operasi' | 'investasi' | 'pendanaan' | 'transfer';
  label: string;
  keterangan: string;
}[] = [
  { kunci: 'operasi', label: 'Operasi', keterangan: 'Pendapatan, beban, panjar, utang usaha' },
  { kunci: 'investasi', label: 'Investasi', keterangan: 'Perpindahan aset non-kas (termasuk 1050 lama)' },
  { kunci: 'pendanaan', label: 'Pendanaan', keterangan: 'Pinjaman dan modal' },
  { kunci: 'transfer', label: 'Transfer', keterangan: 'Pindah dana antar dompet (neto 0)' },
];

/**
 * Layar Arus Kas (P1-9). Semua angka berasal dari `laporan:arus-kas`
 * (core/reports.ts); transfer antar dompet tidak dihitung sebagai arus masuk
 * atau keluar. Klik baris mutasi untuk membuka detail jurnal asalnya.
 *
 * AKT-15: default filter = periode berjalan (1 Jan tahun ini s/d hari ini
 * WITA) agar konsisten dengan Dashboard/Neraca. `sekarang` hanya untuk test.
 * UI-A10: karena AUD-20 mengunci awal tahun buku ke Januari, periode berjalan
 * ini adalah rentang "tahun buku berjalan" yang sama dengan angka Dashboard;
 * header laporan memakai periode dari data hasil.
 */
export function ArusKasTab({ sekarang }: { sekarang?: Date | number }) {
  const [periodeAwal] = useState(() => periodeBerjalan(sekarang));
  const [mulai, setMulai] = useState(periodeAwal.mulai);
  const [sampai, setSampai] = useState(periodeAwal.sampai);
  const [data, setData] = useState<ArusKasHasil | null>(null);
  const [coa, setCoa] = useState<Coa[]>([]);
  const [detail, setDetail] = useState<JurnalLengkap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const detailBusyRef = useRef(false);

  useEffect(() => {
    let aktif = true;
    api
      .coa()
      .then((daftar) => {
        if (aktif) setCoa(daftar);
      })
      .catch(() => {
        if (aktif) setCoa([]);
      });
    return () => {
      aktif = false;
    };
  }, []);

  // UI-A10: rentang terbalik memblokir fetch (sama dengan Buku Besar/Laba
  // Rugi) agar laporan tidak menampilkan angka nol untuk rentang yang salah.
  const rentangTidakValid = rentangTerbalik(mulai, sampai);

  useEffect(() => {
    let aktif = true;
    if (rentangTidakValid) {
      // Hapus hasil lama agar tabel/export tidak menampilkan periode lain.
      setData(null);
      setErr(null);
      setMemuat(false);
      return;
    }
    setMemuat(true);
    setErr(null);
    api
      .laporanArusKas({
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
  }, [mulai, sampai, rentangTidakValid]);

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

  function namaLawan(lawan: string[]): string {
    if (lawan.length === 0) return '—';
    return lawan
      .map((kode) => coa.find((a) => a.kode === kode)?.nama ?? kode)
      .join(', ');
  }

  // UI-A10: teks bantu kontrol memakai input filter; header laporan memakai
  // DATA HASIL agar selalu cocok dengan angka yang tampil.
  const periodeFilter = labelPeriodeLaporan(mulai, sampai);
  const periodeHasil = data ? labelPeriodeHasil(data) : '';
  // UI-A10: refresh indicator — data lama masih tampil saat fetch baru berjalan.
  const menyegarkan = memuat && data !== null;
  // UI-A10: aturan ekspor kosong seragam (sama dengan Buku Besar).
  const kosong = data !== null && data.rows.length === 0 && data.saldoAwal === 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Arus Kas</h1>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Arus Kas menampilkan uang yang masuk dan keluar dari semua dompet
              kas/bank pada satu periode. Pindah dana antar dompet tidak dihitung
              sebagai uang masuk atau keluar. Semua angka dihitung ulang dari jurnal.
            </p>
          </div>
          <Badge tone="green">Dihitung dari jurnal</Badge>
        </div>

        {/* UI-A10: kontrol periode bersama (auto) dengan guard rentang seragam. */}
        <div className="mt-3">
          <KontrolPeriode
            mulai={mulai}
            sampai={sampai}
            onMulai={setMulai}
            onSampai={setSampai}
            namaLaporan="Arus Kas"
            sekarang={sekarang}
          />
        </div>
        <p className="mt-2 text-helper text-stone-500">
          Periode aktif: {periodeFilter}. Klik “Semua tanggal” untuk melihat
          seluruh riwayat. Saldo awal dihitung dari jurnal sebelum tanggal “Dari”.
          Klik baris mutasi untuk melihat jurnal asal dan nomor buktinya.
        </p>
        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`arus-kas-${periodeFile(data.mulai, data.sampai)}`}
              judul="Arus Kas"
              disabled={memuat || kosong}
              alasanNonaktif={kosong ? ALASAN_EKSPOR_KOSONG : undefined}
              buatWorkbook={(kop) => arusKasToWorkbook(data, kop)}
              buatDokumen={(kop) => arusKasPrintDoc(data, { kop })}
            />
          </div>
        )}
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Arus Kas…</p>}
      </Card>

      {data && (
        <>
          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              {/* UI-A10: header dari data hasil, bukan input filter. */}
              <h3 className="flex items-center gap-2 font-bold">
                Ringkasan periode {periodeHasil} <BadgeMemperbarui aktif={menyegarkan} />
              </h3>
              <span className="text-sm text-stone-600">
                {data.rows.length} baris mutasi kas
              </span>
            </div>
            <div className={`grid grid-cols-2 gap-3 ${data.penyesuaianSaldoAwal !== 0 ? 'md:grid-cols-3 xl:grid-cols-6' : 'md:grid-cols-5'}`}>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Saldo awal</div>
                <div className="text-lg font-bold">{formatRp(data.saldoAwal)}</div>
              </div>
              {data.penyesuaianSaldoAwal !== 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-sm text-amber-800">Saldo pembukaan / penyesuaian</div>
                  <div className="text-lg font-bold text-amber-900">
                    {formatRp(data.penyesuaianSaldoAwal)}
                  </div>
                </div>
              )}
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Total masuk</div>
                <div className="text-lg font-bold text-emerald-700">
                  {formatRp(data.totalMasuk)}
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Total keluar</div>
                <div className="text-lg font-bold text-red-700">
                  {formatRp(data.totalKeluar)}
                </div>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="text-sm text-stone-600">Kenaikan / (penurunan)</div>
                <div className="text-lg font-bold">{formatRp(data.kenaikan)}</div>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="text-sm text-emerald-800">Saldo akhir</div>
                <div className="text-lg font-bold text-emerald-900">
                  {formatRp(data.saldoAkhir)}
                </div>
                <div className="mt-1 text-helper text-emerald-800">
                  saldo awal + penyesuaian pembukaan + kenaikan
                </div>
              </div>
            </div>
          </Card>

          <Card>
            <h3 className="mb-2 font-bold">Kelompok Arus Kas</h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
              {KELOMPOK.map(({ kunci, label, keterangan }) => {
                const k = data[kunci];
                return (
                  <div
                    key={kunci}
                    className="rounded-lg border border-stone-200 bg-stone-50 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{label}</span>
                      <Badge tone={kunci === 'transfer' ? 'amber' : 'stone'}>
                        {formatRp(k.neto)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-helper text-stone-500">{keterangan}</div>
                    <div className="mt-2 text-sm text-stone-600">
                      Masuk {formatRp(k.masuk)} · Keluar {formatRp(k.keluar)}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-helper text-stone-500">
              Transfer antar dompet ditampilkan terpisah dan tidak menambah total
              masuk/keluar, supaya uang yang sama tidak dihitung dua kali.
            </p>
          </Card>

          <Card>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-bold">Mutasi kas per dompet</h3>
              <span className="text-sm text-stone-600">
                klik baris untuk melihat jurnal asal
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
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">No. Bukti</th>
                    <th className="py-2 pr-3">Keterangan</th>
                    <th className="py-2 pr-3">Dompet</th>
                    <th className="py-2 pr-3">Lawan akun</th>
                    <th className="py-2 pr-3">Kelompok</th>
                    <th className="py-2 pr-3 text-right">Masuk</th>
                    <th className="py-2 pr-3 text-right">Keluar</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => (
                    <tr
                      key={`${r.jurnal_id}-${r.akun_kode}-${i}`}
                      className={
                        r.jurnal_id
                          ? 'cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50'
                          : 'border-b align-top last:border-0'
                      }
                      tabIndex={r.jurnal_id ? 0 : undefined}
                      title={r.jurnal_id ? 'Klik untuk melihat jurnal asal' : undefined}
                      onClick={() => void bukaDetail(r.jurnal_id)}
                      onKeyDown={(e) => {
                        if (!r.jurnal_id) return;
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
                      <td className="py-2 pr-3">
                        {r.akun_kode} — {r.akun_nama}
                      </td>
                      <td className="py-2 pr-3">{namaLawan(r.lawan)}</td>
                      <td className="whitespace-nowrap py-2 pr-3">
                        <Badge tone={r.kelompok === 'TRANSFER' ? 'amber' : 'stone'}>
                          {labelKelompokArusKas(r.kelompok)}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.masuk ? formatRp(r.masuk) : ''}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-right">
                        {r.keluar ? formatRp(r.keluar) : ''}
                      </td>
                      <td className="py-2 text-right text-stone-400">
                        {r.jurnal_id && <ChevronRight size={16} className="ml-auto" />}
                      </td>
                    </tr>
                  ))}
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="py-4 text-center text-stone-500">
                        Tidak ada mutasi kas pada periode ini.
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className="font-bold">
                    <td colSpan={6} className="py-2 pr-3 text-right">
                      Total arus (tanpa transfer):
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalMasuk)}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(data.totalKeluar)}
                    </td>
                    <td />
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
          coa={coa}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}
