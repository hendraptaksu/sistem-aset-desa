import { useEffect, useState } from 'react';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';
import { pesanBackupBasi, ringkasanBackup } from '../../utils/backup.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api } from '../lib/api.js';
import { useAksiSibuk } from '../lib/aksiSibuk.js';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  KonfirmasiModal,
  TextInput,
} from './ui.js';
import { PESAN_MUAT_GAGAL, PESAN_PROSES_GAGAL, pesanError } from '../../utils/pesanError.js';

/** Tab yang bisa dibuka dari pintasan dashboard (P1-14). */
export type DashboardTabTujuan =
  | 'transaksi'
  | 'panjar'
  | 'pihak'
  | 'tutup'
  | 'jurnal';

/** Form terpandu yang langsung dipilih saat membuka tab Transaksi. */
export type DashboardFormTransaksi = 'TERIMA' | 'BAYAR' | 'PINDAH';

/** Banner amber AUD-13: backup lebih tua dari 2 hari. Null = tidak tampil. */
export function BannerBackupBasi({ usiaHari }: { usiaHari: number | null }) {
  const pesan = pesanBackupBasi(usiaHari);
  if (!pesan) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900"
    >
      <p className="font-semibold">{pesan}</p>
      <p className="mt-1 text-sm">
        Gunakan tombol Backup Export .db atau Backup Lengkap di bawah.
      </p>
    </div>
  );
}

export function DashboardTab({
  onBukaTab,
}: {
  onBukaTab: (tab: DashboardTabTujuan, form?: DashboardFormTransaksi) => void;
}) {
  const [cutoff, setCutoff] = useState(tanggalLokal());
  const [data, setData] = useState<DashboardHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [jenisSibuk, setJenisSibuk] = useState<
    null | 'muat' | 'backup' | 'backup-lengkap' | 'restore' | 'restore-lengkap'
  >(null);
  const [konfirmasiRestore, setKonfirmasiRestore] = useState(false);
  const [konfirmasiRestoreLengkap, setKonfirmasiRestoreLengkap] = useState(false);
  const { sibuk, jalankan } = useAksiSibuk();

  // Data backup bisa tidak tersedia/berformat asing; helper mengembalikan null
  // sehingga dashboard tidak crash dan banner hanya muncul saat benar-benar basi.
  const ringkasan = ringkasanBackup(data?.backupTerakhir, tanggalLokal());

  /** Muat data tanpa guard; pemanggil yang mengatur status sibuk. */
  async function muatData(c: string): Promise<void> {
    setData(await api.dashboard(c));
  }

  async function muat(c = cutoff): Promise<void> {
    if (!c) {
      setErr('Tanggal laporan wajib diisi.');
      return;
    }
    await jalankan(async () => {
      setErr(null);
      setJenisSibuk('muat');
      try {
        await muatData(c);
      } catch (e) {
        setErr(pesanError(e, PESAN_MUAT_GAGAL));
      } finally {
        setJenisSibuk(null);
      }
    });
  }

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function backup(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      setJenisSibuk('backup');
      try {
        const r = await api.backupExport();
        if (r.saved) setInfo(`Backup tersimpan: ${r.path}`);
      } catch (e) {
        setErr(pesanError(e, PESAN_PROSES_GAGAL));
      } finally {
        setJenisSibuk(null);
      }
    });
  }

  async function backupLengkap(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      setJenisSibuk('backup-lengkap');
      try {
        const r = await api.backupLengkap();
        if (r.saved) {
          setInfo(
            `Backup lengkap tersimpan: ${r.path} (${r.jumlahLampiran} lampiran)`,
          );
        }
      } catch (e) {
        setErr(pesanError(e, PESAN_PROSES_GAGAL));
      } finally {
        setJenisSibuk(null);
      }
    });
  }

  async function restore(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      setJenisSibuk('restore');
      setKonfirmasiRestore(false);
      try {
        const r = await api.backupImport();
        if (r.restored) {
          setInfo(
            `Restore OK. Cadangan data lama: ${r.preRestorePath ?? '-'}. Data dimuat ulang…`,
          );
          await muatData(cutoff);
        }
      } catch (e) {
        setErr(pesanError(e, PESAN_PROSES_GAGAL));
      } finally {
        setJenisSibuk(null);
      }
    });
  }

  async function restoreLengkap(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      setJenisSibuk('restore-lengkap');
      setKonfirmasiRestoreLengkap(false);
      try {
        const r = await api.backupRestoreLengkap();
        if (r.restored) {
          setInfo(
            `Restore lengkap OK (${r.jumlahLampiran} lampiran). Cadangan data lama: ${
              r.preRestorePath ?? '-'
            }; lampiran lama: ${r.preRestoreAttachmentsPath ?? '-'}. Data dimuat ulang…`,
          );
          await muatData(cutoff);
        }
      } catch (e) {
        setErr(pesanError(e, PESAN_PROSES_GAGAL));
      } finally {
        setJenisSibuk(null);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">
              Dashboard Akuntan{' '}
              {data && (
                <Badge tone={data.neracaSaldo.seimbang ? 'green' : 'red'}>
                  {data.neracaSaldo.seimbang ? 'Seimbang' : 'Selisih'}
                </Badge>
              )}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Semua angka dihitung ulang dari jurnal sampai tanggal laporan. Tidak ada
              saldo atau laba yang disimpan.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Per tanggal">
              <TextInput
                type="date"
                value={cutoff}
                onChange={(e) => setCutoff(e.target.value)}
              />
            </Field>
            <Button disabled={sibuk} onClick={() => void muat()}>
              {jenisSibuk === 'muat' ? 'Menampilkan…' : 'Tampilkan'}
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
        {info && (
          <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">
            {info}
          </div>
        )}
      </Card>

      {!data && !err && (
        <Card>
          <p className="text-stone-500" role="status">
            Memuat dashboard…
          </p>
        </Card>
      )}

      {data && (
        <>
          <BannerBackupBasi usiaHari={ringkasan.usiaHari} />

          {/* UI-14: aksi harian didahulukan agar terlihat di viewport pertama. */}
          <Card>
            <h3 className="text-base font-bold">Catat Transaksi / Pintasan</h3>
            <p className="mt-1 text-sm text-stone-600">
              Pilih alur yang paling dekat dengan kejadian. Sistem menyusun jurnal
              debit–kredit otomatis.
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <Button disabled={sibuk} onClick={() => onBukaTab('transaksi', 'TERIMA')}>
                Terima Uang
              </Button>
              <Button disabled={sibuk} onClick={() => onBukaTab('transaksi', 'BAYAR')}>
                Bayar
              </Button>
              <Button disabled={sibuk} onClick={() => onBukaTab('transaksi', 'PINDAH')}>
                Pindah Dana
              </Button>
              <Button disabled={sibuk} variant="ghost" onClick={() => onBukaTab('panjar')}>
                Panjar
              </Button>
              <Button disabled={sibuk} variant="ghost" onClick={() => onBukaTab('pihak')}>
                Hutang
              </Button>
              <Button disabled={sibuk} variant="ghost" onClick={() => onBukaTab('tutup')}>
                Tutup Buku
              </Button>
              <Button disabled={sibuk} variant="ghost" onClick={() => onBukaTab('jurnal')}>
                Jurnal Umum
              </Button>
            </div>
          </Card>

          {/* UI-03: jumlah kolom mengikuti lebar konten (bukan viewport) agar
              nominal tidak dipaksa muat di kartu sempit saat sidebar terbuka. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(350px,1fr))] gap-3">
            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Saldo Kas &amp; Bank</h3>
                  <p className="text-sm text-stone-600">Semua dompet kas/bank per tanggal laporan</p>
                </div>
                <Badge tone="green">Total</Badge>
              </div>
              <p className="mt-3 text-3xl font-bold text-emerald-900">
                {formatRp(data.kasBank.total)}
              </p>
              <details className="mt-3">
                <summary className="min-h-8 cursor-pointer py-1 text-sm font-semibold text-emerald-800">
                  Rincian per akun ({data.kasBank.rincian.length})
                </summary>
                <table className="mt-2 w-full text-left text-[15px]">
                  <tbody>
                    {data.kasBank.rincian.map((a) => (
                      <tr key={a.kode} className="border-b last:border-0">
                        <td className="py-2 pr-3">
                          <span className="font-mono text-sm text-stone-500">{a.kode}</span>{' '}
                          {a.nama}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          {formatRp(a.saldo)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </Card>

            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Laba / Rugi Tahun Berjalan</h3>
                  <p className="text-sm text-stone-600">{data.labaRugiBerjalan.labelPeriode}</p>
                </div>
                <Badge tone={data.labaRugiBerjalan.defisit ? 'red' : 'green'}>
                  {data.labaRugiBerjalan.badge}
                </Badge>
              </div>
              <p
                className={
                  data.labaRugiBerjalan.defisit
                    ? 'mt-3 text-3xl font-bold text-red-800'
                    : 'mt-3 text-3xl font-bold text-emerald-900'
                }
              >
                {formatRp(data.labaRugiBerjalan.laba)}
              </p>
              <p className="mt-1 text-sm text-stone-600">
                {data.labaRugiBerjalan.defisit
                  ? 'Beban lebih besar dari pendapatan pada periode ini.'
                  : 'Pendapatan dikurangi beban pada periode ini.'}
              </p>
              <dl className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-2 text-[15px]">
                <div className="min-w-0">
                  <dt className="text-sm text-stone-500">Total pendapatan</dt>
                  <dd className="font-semibold">{formatRp(data.labaRugiBerjalan.totalPendapatan)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-sm text-stone-500">Total beban</dt>
                  <dd className="font-semibold">{formatRp(data.labaRugiBerjalan.totalBeban)}</dd>
                </div>
              </dl>
            </Card>

            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Status Neraca Saldo</h3>
                  <p className="text-sm text-stone-600">Total debit harus sama dengan total kredit</p>
                </div>
                <Badge tone={data.neracaSaldo.seimbang ? 'green' : 'red'}>
                  {data.neracaSaldo.seimbang ? 'Seimbang' : 'Selisih'}
                </Badge>
              </div>
              <dl className="mt-3 space-y-2 text-[15px]">
                <div className="flex justify-between gap-3 border-b pb-2">
                  <dt className="text-stone-600">Total debit</dt>
                  <dd className="font-semibold">{formatRp(data.neracaSaldo.totalDebit)}</dd>
                </div>
                <div className="flex justify-between gap-3 border-b pb-2">
                  <dt className="text-stone-600">Total kredit</dt>
                  <dd className="font-semibold">{formatRp(data.neracaSaldo.totalKredit)}</dd>
                </div>
                {!data.neracaSaldo.seimbang && (
                  <div className="flex justify-between gap-3 text-red-800">
                    <dt>Selisih</dt>
                    <dd className="font-bold">{formatRp(data.neracaSaldo.selisih)}</dd>
                  </div>
                )}
              </dl>
              <p className="mt-2 text-sm text-stone-600">
                Bila selisih, jangan tutup buku. Periksa Jurnal Umum terlebih dahulu.
              </p>
            </Card>

            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Periode Buku</h3>
                  <p className="text-sm text-stone-600">{data.periode.status}</p>
                </div>
                <Badge tone={data.periode.tahunTerakhirDitutup ? 'amber' : 'stone'}>
                  {data.periode.tahunTerakhirDitutup
                    ? `Tutup ${data.periode.tahunTerakhirDitutup}`
                    : 'Belum tutup'}
                </Badge>
              </div>
              <dl className="mt-3 space-y-2 text-[15px]">
                <div className="flex justify-between gap-3 border-b pb-2">
                  <dt className="text-stone-600">Tahun terakhir ditutup</dt>
                  <dd className="font-semibold">
                    {data.periode.tahunTerakhirDitutup ?? 'Belum ada'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3 border-b pb-2">
                  <dt className="text-stone-600">Tahun terkunci</dt>
                  <dd className="font-semibold">
                    {data.periode.tahunTerkunci.length > 0
                      ? data.periode.tahunTerkunci.join(', ')
                      : 'Belum ada'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-600">Boleh ditutup s/d</dt>
                  <dd className="font-semibold">{data.periode.batasTahun}</dd>
                </div>
              </dl>
              <div className="mt-3">
                <Button
                  variant="ghost"
                  disabled={sibuk}
                  onClick={() => onBukaTab('tutup')}
                >
                  Buka Tutup Buku
                </Button>
              </div>
            </Card>

            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Jurnal Terakhir</h3>
                  <p className="text-sm text-stone-600">Jurnal terbaru s/d tanggal laporan</p>
                </div>
                {data.jurnalTerakhir && <Badge>{data.jurnalTerakhir.jenis}</Badge>}
              </div>
              {data.jurnalTerakhir ? (
                <div className="mt-3 space-y-1 text-[15px]">
                  <p className="text-lg font-bold">
                    {data.jurnalTerakhir.noBukti || '(tanpa nomor)'}
                  </p>
                  <p className="font-semibold text-stone-800">
                    {data.jurnalTerakhir.keterangan || '(tanpa keterangan)'}
                  </p>
                  <p className="text-stone-600">
                    Tanggal {formatTanggal(data.jurnalTerakhir.tanggal)} · Total{' '}
                    <span className="font-semibold">
                      {formatRp(data.jurnalTerakhir.total)}
                    </span>
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-stone-500">Belum ada jurnal s/d tanggal laporan.</p>
              )}
              <div className="mt-3">
                <Button
                  variant="ghost"
                  disabled={sibuk}
                  onClick={() => onBukaTab('jurnal')}
                >
                  Buka Jurnal Umum
                </Button>
              </div>
            </Card>

            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Backup Terakhir</h3>
                  <p className="text-sm text-stone-600">Cadangan otomatis harian</p>
                </div>
                <Badge tone={ringkasan.tone}>
                  {!data.backupTerakhir
                    ? 'Belum ada'
                    : ringkasan.tone === 'green'
                      ? 'Segar'
                      : ringkasan.tone === 'amber'
                        ? 'Basi'
                        : 'Tidak diketahui'}
                </Badge>
              </div>
              {data.backupTerakhir ? (
                <div className="mt-3 min-w-0">
                  <p
                    className="min-w-0 truncate font-semibold text-stone-800"
                    title={data.backupTerakhir}
                    data-testid="nama-file-backup"
                  >
                    {ringkasan.namaFile ?? '(nama file tidak diketahui)'}
                  </p>
                  <p className="mt-1 text-sm text-stone-600" data-testid="status-backup">
                    Backup terakhir: {ringkasan.label}
                    {ringkasan.tanggal && <> · tanggal {formatTanggal(ringkasan.tanggal)}</>}
                  </p>
                  <p className="mt-1 text-helper text-stone-500">
                    Arahkan kursor ke nama file untuk melihat path lengkap.
                  </p>
                </div>
              ) : (
                <p className="mt-3 text-stone-500" data-testid="status-backup">
                  Backup terakhir: belum ada. Gunakan tombol Backup di bawah.
                </p>
              )}
            </Card>
          </div>
        </>
      )}

      <Card>
        <h3 className="text-base font-bold">Backup / Restore</h3>
        <p className="mt-1 text-sm text-stone-600">
          Backup menyalin data tanpa mengubah data aktif. Pulihkan mengganti data
          yang sedang dipakai.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section
            aria-labelledby="judul-backup"
            className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4"
          >
            <h4 id="judul-backup" className="font-bold text-emerald-950">
              Backup
            </h4>
            <p className="mt-1 text-sm text-stone-600">
              Menyimpan salinan aman; data aktif tidak berubah.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="ghost" disabled={sibuk} onClick={() => void backup()}>
                {jenisSibuk === 'backup' ? 'Menyimpan backup…' : 'Backup Export .db'}
              </Button>
              <Button
                variant="ghost"
                disabled={sibuk}
                onClick={() => void backupLengkap()}
              >
                {jenisSibuk === 'backup-lengkap'
                  ? 'Membuat backup lengkap…'
                  : 'Backup Lengkap (DB + lampiran)'}
              </Button>
            </div>
            <p className="mt-3 text-sm text-stone-600">
              Backup lengkap menyimpan satu folder berisi <code>pura.db</code>, semua
              lampiran bukti, dan <code>manifest.json</code> — pakai ini untuk arsip
              atau pindah laptop. Backup Export .db hanya berisi database.
            </p>
          </section>

          <section
            aria-labelledby="judul-pulihkan"
            className="min-w-0 rounded-lg border border-red-300 bg-red-50 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 id="judul-pulihkan" className="font-bold text-red-900">
                Pulihkan
              </h4>
              <Badge tone="red">Menimpa data aktif</Badge>
            </div>
            <p className="mt-1 text-sm font-semibold text-red-900">
              Pilih hanya file atau folder backup yang Anda percaya.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="danger-outline"
                disabled={sibuk}
                onClick={() => setKonfirmasiRestore(true)}
              >
                {jenisSibuk === 'restore' ? 'Memulihkan…' : 'Restore Import .db'}
              </Button>
              <Button
                variant="danger-outline"
                disabled={sibuk}
                onClick={() => setKonfirmasiRestoreLengkap(true)}
              >
                {jenisSibuk === 'restore-lengkap'
                  ? 'Memulihkan lengkap…'
                  : 'Restore Lengkap (DB + lampiran)'}
              </Button>
            </div>
            <p className="mt-3 text-sm text-stone-700">
              Restore Import .db memulihkan database saja; lampiran tetap di folder
              aplikasi. Restore Lengkap memulihkan database <b>dan</b> lampiran dari
              folder hasil Backup Lengkap; data lama disimpan sebagai cadangan lebih
              dulu.
            </p>
          </section>
        </div>
        {jenisSibuk && (
          <p
            className={`mt-3 text-sm font-semibold ${
              jenisSibuk === 'restore' || jenisSibuk === 'restore-lengkap'
                ? 'text-red-800'
                : 'text-emerald-800'
            }`}
            role="status"
          >
            {jenisSibuk === 'backup'
              ? 'Sedang membuat backup…'
              : jenisSibuk === 'backup-lengkap'
                ? 'Sedang menyalin database dan lampiran…'
                : jenisSibuk === 'restore'
                  ? 'Sedang memulihkan data…'
                  : jenisSibuk === 'restore-lengkap'
                    ? 'Sedang memulihkan database dan lampiran…'
                    : 'Sedang memuat data…'}
          </p>
        )}
      </Card>

      {konfirmasiRestore && (
        <KonfirmasiModal
          judul="Pulihkan data dari backup?"
          deskripsi={
            <>
              <p>
                Data yang sekarang aktif akan <b>diganti</b> dengan isi file backup
                yang Anda pilih.
              </p>
              <p className="text-sm text-stone-600">
                Sistem membuat cadangan otomatis data saat ini lebih dulu. Setelah
                restore selesai, layar dimuat ulang. Pastikan file .db berasal dari
                aplikasi ini.
              </p>
            </>
          }
          labelYa="Pilih file & pulihkan"
          sibuk={sibuk}
          onBatal={() => setKonfirmasiRestore(false)}
          onKonfirmasi={() => void restore()}
        />
      )}

      {konfirmasiRestoreLengkap && (
        <KonfirmasiModal
          judul="Pulihkan database dan lampiran?"
          deskripsi={
            <>
              <p>
                Database <b>dan seluruh lampiran</b> yang sekarang aktif akan diganti
                dengan isi folder backup lengkap yang Anda pilih.
              </p>
              <p className="text-sm text-stone-600">
                Sistem mencadangkan database dan folder lampiran saat ini lebih dulu.
                Setelah restore selesai, layar dimuat ulang dan aplikasi terkunci
                kembali. Pastikan folder berisi <code>manifest.json</code>,{' '}
                <code>pura.db</code>, dan folder <code>attachments</code>.
              </p>
            </>
          }
          labelYa="Pilih folder & pulihkan"
          sibuk={sibuk}
          onBatal={() => setKonfirmasiRestoreLengkap(false)}
          onKonfirmasi={() => void restoreLengkap()}
        />
      )}
    </div>
  );
}
