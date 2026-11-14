import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import {
  labaRugiToWorkbook,
  periodeFile,
} from '../../features/export/workbooks.js';
import { labaRugiPrintDoc } from '../../features/export/printAdapters.js';
import { formatRp } from '../../utils/format.js';
import { periodeBerjalan } from '../../utils/tanggal.js';
import { api, type LabaRugiHasil } from '../lib/api.js';
import {
  ALASAN_EKSPOR_KOSONG,
  badgeLabaRugi,
  labelPeriodeHasil,
  labelPeriodeLaporan,
  rentangTerbalik,
} from '../lib/tampilanLaporan.js';
import { Badge, BadgeMemperbarui, Card, ErrorBox } from './ui.js';
import { KontrolPeriode } from './KontrolPeriode.js';
import { ExportActions } from './ExportActions.js';
import { JurnalAkunModal } from './JurnalAkunModal.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';

type AkunDipilih = { kode: string; nama: string };

/**
 * Layar Laba Rugi (P1-9). Seluruh angka berasal dari `laporan:laba-rugi`
 * (core/reports.ts); tab ini tidak menghitung ulang laba dan tidak menyimpan
 * angka turunan. Klik baris akun untuk menelusuri jurnal asalnya.
 *
 * AKT-15: default filter = periode berjalan (1 Jan tahun ini s/d hari ini
 * WITA) agar konsisten dengan Dashboard/Neraca. `sekarang` hanya untuk test.
 * UI-A10: karena AUD-20 mengunci awal tahun buku ke Januari, periode berjalan
 * ini adalah rentang "tahun buku berjalan" yang sama dengan angka "Laba / Rugi
 * Tahun Berjalan" Dashboard; header laporan memakai periode dari data hasil.
 */
export function LabaRugiTab({ sekarang }: { sekarang?: Date | number }) {
  const [periodeAwal] = useState(() => periodeBerjalan(sekarang));
  const [mulai, setMulai] = useState(periodeAwal.mulai);
  const [sampai, setSampai] = useState(periodeAwal.sampai);
  const [data, setData] = useState<LabaRugiHasil | null>(null);
  const [coa, setCoa] = useState<Coa[]>([]);
  const [akunDipilih, setAkunDipilih] = useState<AkunDipilih | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);

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

  // DB-38: bila pembukuan dimulai di tengah tahun, default Laba Rugi tahun
  // pertama dimulai pada tanggal cut-over, bukan 1 Januari. Filter yang sudah
  // diubah operator tidak ditimpa.
  useEffect(() => {
    let aktif = true;
    api
      .pengaturanGet()
      .then((p) => {
        if (!aktif) return;
        const tanggalMulai = p.tanggalMulaiPembukuan;
        const tahun = periodeAwal.mulai.slice(0, 4);
        if (
          tanggalMulai &&
          tanggalMulai.startsWith(`${tahun}-`) &&
          tanggalMulai > periodeAwal.mulai &&
          tanggalMulai <= periodeAwal.sampai
        ) {
          setMulai((sebelum) => (sebelum === periodeAwal.mulai ? tanggalMulai : sebelum));
        }
      })
      .catch(() => {
        // Pengaturan gagal dimuat: tetap pakai periode berjalan 1 Januari.
      });
    return () => {
      aktif = false;
    };
  }, [periodeAwal.mulai, periodeAwal.sampai]);

  // UI-A10: rentang terbalik memblokir fetch (sama dengan Buku Besar) agar
  // laporan tidak menampilkan "LABA Rp 0 + SURPLUS" untuk rentang yang salah.
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
      .laporanLabaRugi({
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

  const pendapatan = data?.pendapatan.filter((b) => b.nominal !== 0) ?? [];
  const beban = data?.beban.filter((b) => b.nominal !== 0) ?? [];
  const badge = data ? badgeLabaRugi(data.defisit) : null;
  // UI-A10: teks bantu kontrol memakai input filter; header laporan di bawah
  // memakai DATA HASIL agar selalu cocok dengan angka yang tampil.
  const periodeFilter = labelPeriodeLaporan(mulai, sampai);
  const periodeHasil = data ? labelPeriodeHasil(data) : '';
  // UI-A10: refresh indicator — data lama masih tampil saat fetch baru berjalan.
  const menyegarkan = memuat && data !== null;
  // UI-A10: aturan ekspor kosong seragam (sama dengan Buku Besar/Arus Kas):
  // tidak ada pendapatan maupun beban sama sekali.
  const kosong = data !== null && data.totalPendapatan === 0 && data.totalBeban === 0;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-bold">
              Laba Rugi {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-stone-600">
              Laba Rugi membandingkan pendapatan dan beban pada satu periode.
              Angka dihitung ulang dari jurnal setiap kali layar dibuka — tidak ada
              angka laba yang disimpan.
            </p>
          </div>
          <Badge tone="green">Dihitung dari jurnal</Badge>
        </div>

        {data?.catatanTahunPertama && (
          <p
            className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
            data-testid="catatan-tahun-pertama"
          >
            {data.catatanTahunPertama}
          </p>
        )}

        {/* UI-A10: kontrol periode bersama (auto) dengan guard rentang seragam. */}
        <div className="mt-3">
          <KontrolPeriode
            mulai={mulai}
            sampai={sampai}
            onMulai={setMulai}
            onSampai={setSampai}
            namaLaporan="Laba Rugi"
            sekarang={sekarang}
          />
        </div>
        <p className="mt-2 text-helper text-stone-500">
          Periode aktif: {periodeFilter}. Klik “Semua tanggal” untuk melihat
          seluruh riwayat, atau kosongkan salah satu tanggal untuk membuka batas
          awal/akhir. Klik baris akun untuk melihat daftar jurnal pada periode
          ini, lalu klik jurnal untuk detail debit/kredit.
        </p>

        {data && (
          <div className="mt-3">
            <ExportActions
              namaDasar={`laba-rugi-${periodeFile(data.mulai, data.sampai)}`}
              judul="Laba Rugi"
              disabled={memuat || kosong}
              alasanNonaktif={kosong ? ALASAN_EKSPOR_KOSONG : undefined}
              buatWorkbook={(kop) => labaRugiToWorkbook(data, kop)}
              buatDokumen={(kop) => labaRugiPrintDoc(data, { kop })}
            />
          </div>
        )}

        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {memuat && !data && <p className="mt-3 text-stone-500">Memuat Laba Rugi…</p>}
      </Card>

      {data && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            {/* UI-A10: header dari data hasil, bukan input filter. */}
            <h3 className="flex items-center gap-2 font-bold">
              Periode {periodeHasil} <BadgeMemperbarui aktif={menyegarkan} />
            </h3>
            <span className="text-sm text-stone-600">
              {pendapatan.length + beban.length} akun bernominal
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
                Laba Rugi — pendapatan dan beban periode {periodeHasil}
              </caption>
              <thead>
                <tr className="border-b text-stone-500">
                  <th scope="col" className="py-2 pr-3">Kode</th>
                  <th scope="col" className="py-2 pr-3">Uraian</th>
                  <th scope="col" className="py-2 pr-3 text-right">Nominal</th>
                  <th scope="col" className="py-2" />
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th colSpan={4} scope="colgroup" className="pt-3 pb-1 text-left text-stone-700">
                    PENDAPATAN
                  </th>
                </tr>
                {pendapatan.map((b) => (
                  <tr
                    key={b.kode}
                    className="cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50"
                    tabIndex={0}
                    title={`Lihat jurnal akun ${b.kode} — ${b.nama}`}
                    // UI-A21: baris diumumkan sebagai tombol dengan label
                    // yang menyebut akun mana yang akan ditelusuri.
                    role="button"
                    aria-label={`Lihat jurnal akun ${b.kode} — ${b.nama}`}
                    onClick={() => setAkunDipilih({ kode: b.kode, nama: b.nama })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAkunDipilih({ kode: b.kode, nama: b.nama });
                      }
                    }}
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-semibold">{b.kode}</td>
                    <td className="py-2 pr-3">{b.nama}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(b.nominal)}
                    </td>
                    <td className="py-2 text-right text-stone-400">
                      {/* UI-A21: ikon hanya penunjuk arah; makna ada di
                          aria-label baris. */}
                      <ChevronRight size={16} aria-hidden="true" className="ml-auto" />
                    </td>
                  </tr>
                ))}
                {pendapatan.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-stone-500">
                      Tidak ada pendapatan pada periode ini.
                    </td>
                  </tr>
                )}
                <tr className="font-bold">
                  <td colSpan={2} className="py-2 pr-3 text-right">
                    Total Pendapatan
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {formatRp(data.totalPendapatan)}
                  </td>
                  <td />
                </tr>

                <tr>
                  <th colSpan={4} scope="colgroup" className="pt-3 pb-1 text-left text-stone-700">
                    BEBAN
                  </th>
                </tr>
                {beban.map((b) => (
                  <tr
                    key={b.kode}
                    className="cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50"
                    tabIndex={0}
                    title={`Lihat jurnal akun ${b.kode} — ${b.nama}`}
                    // UI-A21: baris diumumkan sebagai tombol dengan label
                    // yang menyebut akun mana yang akan ditelusuri.
                    role="button"
                    aria-label={`Lihat jurnal akun ${b.kode} — ${b.nama}`}
                    onClick={() => setAkunDipilih({ kode: b.kode, nama: b.nama })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setAkunDipilih({ kode: b.kode, nama: b.nama });
                      }
                    }}
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-semibold">{b.kode}</td>
                    <td className="py-2 pr-3">{b.nama}</td>
                    <td className="whitespace-nowrap py-2 pr-3 text-right">
                      {formatRp(b.nominal)}
                    </td>
                    <td className="py-2 text-right text-stone-400">
                      {/* UI-A21: ikon hanya penunjuk arah; makna ada di
                          aria-label baris. */}
                      <ChevronRight size={16} aria-hidden="true" className="ml-auto" />
                    </td>
                  </tr>
                ))}
                {beban.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-2 text-stone-500">
                      Tidak ada beban pada periode ini.
                    </td>
                  </tr>
                )}
                <tr className="font-bold">
                  <td colSpan={2} className="py-2 pr-3 text-right">
                    Total Beban
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-right">
                    {formatRp(data.totalBeban)}
                  </td>
                  <td />
                </tr>
                <tr className="border-t-2 font-bold">
                  <td colSpan={2} className="py-3 pr-3 text-right">
                    LABA / (DEFISIT)
                  </td>
                  <td className="whitespace-nowrap py-3 pr-3 text-right text-base">
                    {formatRp(data.laba)}
                  </td>
                  <td className="py-3">
                    {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-sm text-stone-600">
            Defisit ditampilkan dalam kurung, mis. {formatRp(-10_000_000)}. Laba bersih
            juga dapat diperiksa lewat jurnal setiap akun di atas.
          </p>
        </Card>
      )}

      {akunDipilih && (
        <JurnalAkunModal
          akunKode={akunDipilih.kode}
          akunNama={akunDipilih.nama}
          mulai={mulai || undefined}
          sampai={sampai || undefined}
          coa={coa}
          onClose={() => setAkunDipilih(null)}
        />
      )}
    </div>
  );
}
