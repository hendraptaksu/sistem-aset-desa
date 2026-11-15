import { useEffect, useRef, useState } from 'react';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';
import { pesanBackupBasi, ringkasanBackup } from '../../utils/backup.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api } from '../lib/api.js';
import { useAksiSibuk } from '../lib/aksiSibuk.js';
import {
  ALASAN_SIBUK,
  Badge,
  Button,
  Card,
  ErrorBox,
  InfoBox,
  KonfirmasiModal,
} from './ui.js';
import { KontrolPeriode } from './KontrolPeriode.js';
import { LABEL_JENIS } from '../lib/tampilanLaporan.js';
import { PESAN_MUAT_GAGAL, PESAN_PROSES_GAGAL, pesanError } from '../../utils/pesanError.js';

/** Tab yang bisa dibuka dari pintasan dashboard (P1-14). */
export type DashboardTabTujuan =
  | 'transaksi'
  | 'panjar'
  | 'tutup'
  | 'jurnal';

/** Form terpandu yang langsung dipilih saat membuka tab Transaksi. */
export type DashboardFormTransaksi =
  | 'TERIMA'
  | 'BAYAR'
  | 'PINDAH'
  | 'CATAT_UTANG'
  | 'BAYAR_UTANG';

/** Jenis jalur restore yang dipakai untuk menyusun pesan sukses. */
export type JenisRestore = 'db' | 'lengkap';

/**
 * T2.7: pesan sukses restore yang dibawa ke layar kunci. Main sudah memanggil
 * `kunciLagi()` setelah restore, jadi renderer tidak boleh memuat dashboard
 * lagi; pesan ini memastikan pengguna tahu data lama sudah dicadangkan.
 */
export function pesanRestoreSukses(jenis: JenisRestore): string {
  const label = jenis === 'lengkap' ? 'Pulihkan lengkap' : 'Pulihkan';
  return `${label} berhasil. Data lama sudah dicadangkan otomatis. Aplikasi dikunci ulang; masukkan PIN untuk melanjutkan.`;
}

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
        Gunakan tombol <b>Backup Lengkap</b> (disarankan), atau Backup file data
        (lanjutan).
      </p>
    </div>
  );
}

/**
 * T3.3: peringatan permanen di kartu Backup / Pulihkan. File `.db` (termasuk
 * hasil Backup Lengkap) tidak dienkripsi; PIN hanya melindungi UI aplikasi.
 * Ditampilkan sebagai teks terlihat, bukan tooltip, agar tidak terlewat.
 */
export function PeringatanBackupTidakTerenkripsi() {
  return (
    <div
      role="note"
      data-testid="peringatan-backup-tidak-terenkripsi"
      className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p className="font-bold">File backup tidak terenkripsi.</p>
      <p className="mt-1">
        PIN hanya melindungi aplikasi, bukan isi file. Siapa pun yang memegang
        file atau folder backup dapat membacanya tanpa PIN. Simpan backup di
        media/disk yang terenkripsi, jangan unggah ke cloud publik, dan hapus
        salinan lama yang tidak diperlukan.
      </p>
    </div>
  );
}

/**
 * T3.8: konfirmasi backup yang menjelaskan apa yang berubah dan apa yang tetap.
 * Backup tidak menimpa data aktif, jadi nadanya informatif (bukan peringatan
 * merah) dan pilihan aman tetap fokus awal.
 */
export function KonfirmasiBackup({
  jenis,
  sibuk = false,
  onBatal,
  onKonfirmasi,
}: {
  jenis: 'lengkap' | 'db';
  sibuk?: boolean;
  onBatal: () => void;
  onKonfirmasi: () => void;
}) {
  const lengkap = jenis === 'lengkap';
  return (
    <KonfirmasiModal
      judul={lengkap ? 'Buat backup lengkap?' : 'Buat backup file data?'}
      deskripsi={
        <>
          <p>
            {lengkap ? (
              <>
                <b>Backup Lengkap</b> membuat folder baru berisi seluruh data
                aplikasi beserta keterangan versinya di lokasi yang Anda pilih.
              </>
            ) : (
              <>
                <b>Backup file data</b> membuat satu file berisi seluruh data
                aplikasi, tanpa keterangan versi, di lokasi yang Anda pilih.
              </>
            )}
          </p>
          <p>
            <b>Yang berubah:</b> hanya salinan backup baru di folder tujuan.{' '}
            <b>Yang tetap:</b> data aktif, jurnal, dan pengaturan tidak
            disentuh; backup lama tidak dihapus.
          </p>
          {/* UI-A18: peringatan tak-terenkripsi cukup sekali di kartu
              (kotak PeringatanBackupTidakTerenkripsi), tidak diulang di sini. */}
        </>
      }
      labelYa={lengkap ? 'Pilih folder & buat backup' : 'Pilih file & buat backup'}
      variant="primary"
      sibuk={sibuk}
      onBatal={onBatal}
      onKonfirmasi={onKonfirmasi}
    />
  );
}

/** T3.8: konfirmasi restore .db (jalur lanjutan tanpa validasi manifest). */
export function KonfirmasiRestoreDb({
  sibuk = false,
  onBatal,
  onKonfirmasi,
}: {
  sibuk?: boolean;
  onBatal: () => void;
  onKonfirmasi: () => void;
}) {
  return (
    <KonfirmasiModal
      judul="Pulihkan dari file data?"
      deskripsi={
        <>
          <p>
            Data yang sekarang aktif akan <b>diganti</b> dengan isi file data
            yang Anda pilih. Jurnal, saldo awal, pengaturan, dan audit mengikuti
            file tersebut. Cara ini <b>mengganti data tanpa memeriksa
            keterangan backup</b>; <b>Pulihkan Lengkap</b> lebih disarankan bila
            folder backup masih tersedia.
          </p>
          <p>
            <b>Yang tetap:</b> PIN aplikasi dipertahankan, file backup sumber
            tidak diubah, dan data saat ini dicadangkan otomatis sebelum
            diganti. Setelah selesai, aplikasi dikunci dan Anda perlu memasukkan
            PIN.
          </p>
          <p className="text-sm text-stone-600">
            Bila hasil pemulihan tidak sesuai, pulihkan cadangan otomatis lewat
            jalur yang sama. Pastikan file berasal dari aplikasi ini dan Anda
            memang ingin memakai cara lanjutan ini.
          </p>
        </>
      }
      labelYa="Pilih file & pulihkan"
      sibuk={sibuk}
      onBatal={onBatal}
      onKonfirmasi={onKonfirmasi}
    />
  );
}

/** T3.8: konfirmasi restore lengkap (DB + validasi manifest). */
export function KonfirmasiRestoreLengkap({
  sibuk = false,
  onBatal,
  onKonfirmasi,
}: {
  sibuk?: boolean;
  onBatal: () => void;
  onKonfirmasi: () => void;
}) {
  return (
    <KonfirmasiModal
      judul="Pulihkan dari backup lengkap?"
      deskripsi={
        <>
          <p>
            Data yang sekarang aktif akan <b>diganti</b> dengan isi folder
            backup lengkap yang Anda pilih. Jurnal, saldo awal, pengaturan, dan
            audit mengikuti isi backup. Ini jalur yang <b>disarankan</b>.
          </p>
          <p>
            <b>Yang tetap:</b> PIN aplikasi dipertahankan, file backup sumber
            tidak diubah, dan data saat ini dicadangkan otomatis sebelum
            diganti. Aplikasi memeriksa keterangan backup sebelum memulihkan.
            Setelah selesai, aplikasi dikunci dan Anda perlu memasukkan PIN.
          </p>
          <p className="text-sm text-stone-600">
            Bila hasil pemulihan tidak sesuai, pulihkan cadangan otomatis.
            Pastikan folder backup berasal dari aplikasi versi ini.
          </p>
        </>
      }
      labelYa="Pilih folder & pulihkan"
      sibuk={sibuk}
      onBatal={onBatal}
      onKonfirmasi={onKonfirmasi}
    />
  );
}


export function DashboardTab({
  onBukaTab,
  modeLanjutan = false,
  onRestoreSelesai,
}: {
  onBukaTab: (tab: DashboardTabTujuan, form?: DashboardFormTransaksi) => void;
  /** DB-26: pintasan Jurnal Umum hanya tersedia setelah Mode lanjutan aktif. */
  modeLanjutan?: boolean;
  /**
   * T2.7: dipanggil tepat setelah restore sukses agar App langsung memuat
   * ulang status kunci dan menampilkan layar PIN tanpa menunggu polling.
   */
  onRestoreSelesai?: (pesan: string) => void;
}) {
  const [cutoff, setCutoff] = useState(tanggalLokal());
  const [data, setData] = useState<DashboardHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [jenisSibuk, setJenisSibuk] = useState<
    null | 'muat' | 'backup' | 'backup-lengkap' | 'restore' | 'restore-lengkap'
  >(null);
  const [konfirmasiRestoreFinal, setKonfirmasiRestoreFinal] = useState(false);
  const [konfirmasiRestoreLengkap, setKonfirmasiRestoreLengkap] = useState(false);
  const [konfirmasiBackup, setKonfirmasiBackup] = useState<null | 'lengkap' | 'db'>(null);
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

  // UI-A26: error lama tidak lagi relevan saat tanggal laporan diganti —
  // kosongkan segera agar tidak muncul di bawah tanggal yang baru.
  function ubahCutoff(c: string): void {
    setCutoff(c);
    setErr(null);
  }

  useEffect(() => {
    void muat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Error aksi backup/pulihkan tampil di kartu atas; gulirkan ke sana agar
  // operator yang sedang di kartu bawah tidak melewatkannya.
  useEffect(() => {
    if (!err) return;
    const el = errorRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
  }, [err]);

  async function backup(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      setJenisSibuk('backup');
      try {
        const r = await api.backupExport();
        if (r.saved) {
          // UI-A18: peringatan "media yang aman" cukup sekali di kartu ini
          // (kotak PeringatanBackupTidakTerenkripsi), jadi tidak diulang di sini.
          setInfo(`Backup tersimpan: ${r.path}. Data aktif tidak berubah.`);
        } else {
          // UI-A11: dialog file dibatalkan — jangan diam saja, operator perlu
          // tahu tidak ada file yang dibuat.
          setInfo('Backup dibatalkan. Tidak ada file yang dibuat.');
        }
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
          // UI-A18: peringatan "media yang aman" cukup sekali di kartu ini.
          setInfo(`Backup lengkap tersimpan: ${r.path}. Data aktif tidak berubah.`);
        } else {
          // UI-A11: dialog folder dibatalkan — tidak ada backup baru.
          setInfo('Backup lengkap dibatalkan. Tidak ada file yang dibuat.');
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
      setKonfirmasiRestoreFinal(false);
      try {
        // DB-09: konfirmasi eksplisit wajib; main menolak tanpa ini.
        const r = await api.backupImport(true);
        if (r.restored) {
          // T2.7: main sudah mengunci sesi. Jangan memuat dashboard lagi
          // (permintaan akan ditolak atau menampilkan data stale); langsung
          // serahkan pesan ke App agar layar kunci muncul.
          const pesan = pesanRestoreSukses('db');
          setInfo(pesan);
          onRestoreSelesai?.(pesan);
        } else {
          // UI-A11: dialog file dibatalkan — data aktif tidak disentuh.
          setInfo('Pulihkan dibatalkan. Data aktif tidak berubah.');
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
          // T2.7: sama seperti restore .db — sesi dikunci main, jadi jangan
          // panggil `muatData`; App akan segera menampilkan layar kunci.
          const pesan = pesanRestoreSukses('lengkap');
          setInfo(pesan);
          onRestoreSelesai?.(pesan);
        } else {
          // UI-A11: dialog folder dibatalkan — data aktif tidak disentuh.
          setInfo('Pulihkan lengkap dibatalkan. Data aktif tidak berubah.');
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
              Ringkasan Pembukuan{' '}
              {data && (
                <Badge tone={data.balance ? 'green' : 'red'}>
                  {data.balance ? 'Neraca seimbang' : 'Neraca selisih'}
                </Badge>
              )}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Semua angka dihitung ulang dari jurnal sampai tanggal laporan.
              {data ? ` Angka yang tampil per ${formatTanggal(data.cutoff)}.` : ''}
            </p>
          </div>
          {/* UI-A10: kontrol periode bersama, pola manual (klik Tampilkan). */}
          <KontrolPeriode
            mode="cutoff"
            cutoff={cutoff}
            onCutoff={ubahCutoff}
            onTerapkan={() => void muat()}
            labelTerapkan={jenisSibuk === 'muat' ? 'Menampilkan…' : 'Tampilkan'}
            sibuk={sibuk}
          />
        </div>
        <div
          ref={errorRef}
          tabIndex={-1}
          className="mt-3 scroll-mt-24 focus:outline-none"
        >
          <ErrorBox msg={err} />
        </div>
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
            <h3 className="text-base font-bold">Pintasan Transaksi</h3>
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
              <Button
                disabled={sibuk}
                variant="ghost"
                onClick={() => onBukaTab('transaksi', 'CATAT_UTANG')}
              >
                Catat Utang
              </Button>
              <Button
                disabled={sibuk}
                variant="ghost"
                onClick={() => onBukaTab('transaksi', 'BAYAR_UTANG')}
              >
                Bayar Utang
              </Button>
            </div>
          </Card>

          {/* UI-03: jumlah kolom mengikuti lebar konten (bukan viewport) agar
              nominal tidak dipaksa muat di kartu sempit saat sidebar terbuka. */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(350px,100%),1fr))] gap-3">
            <Card className="min-w-0">
              {/* UI-A26: badge "Total" dihapus — statis tanpa makna (angka di
                  bawah sudah jelas merupakan total). */}
              <div>
                <h3 className="text-base font-bold">Saldo Kas &amp; Bank</h3>
                <p className="text-sm text-stone-600">Semua dompet kas/bank per tanggal laporan</p>
              </div>
              {/* UI-A26: angka utama laporan memakai satu skala text-2xl di
                  seluruh layar (Dashboard, Buku Besar, Arus Kas, Laba Rugi,
                  Neraca, Neraca Saldo). */}
              <p className="mt-3 text-2xl font-bold text-emerald-900">
                {formatRp(data.kasBank.total)}
              </p>
              <details className="mt-3">
                <summary className="min-h-8 cursor-pointer py-1 text-sm font-semibold text-emerald-800">
                  Rincian per akun ({data.kasBank.rincian.length})
                </summary>
                <table className="mt-2 w-full text-left text-[15px]">
                  <thead>
                    <tr className="border-b text-stone-500">
                      <th scope="col" className="py-2 pr-3">Dompet kas / bank</th>
                      <th scope="col" className="py-2 text-right">Saldo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.kasBank.rincian.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-3 text-stone-500">
                          Belum ada dompet kas/bank.
                        </td>
                      </tr>
                    )}
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
              {data.labaRugiBerjalan.catatanTahunPertama && (
                <p
                  className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                  data-testid="catatan-tahun-pertama-dashboard"
                >
                  {data.labaRugiBerjalan.catatanTahunPertama}
                </p>
              )}
              <p
                className={
                  data.labaRugiBerjalan.defisit
                    ? 'mt-3 text-2xl font-bold text-red-800'
                    : 'mt-3 text-2xl font-bold text-emerald-900'
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
              {data.neracaSaldo.seimbang && !data.balance && (
                <div
                  role="alert"
                  data-testid="peringatan-neraca-tidak-balance"
                  className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
                >
                  <p className="font-bold">Neraca tidak seimbang.</p>
                  <p className="mt-1">
                    Neraca Saldo seimbang, tetapi Neraca selisih{' '}
                    {formatRp(data.selisih)}. Jangan kunci periode; periksa
                    jurnal pembukaan/saldo awal dan Jurnal Umum.
                  </p>
                </div>
              )}
              <p className="mt-2 text-sm text-stone-600">
                Bila selisih, jangan kunci periode. Periksa Jurnal Umum terlebih dahulu.
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
                    ? `Tahun ${data.periode.tahunTerakhirDitutup} terkunci`
                    : 'Belum dikunci'}
                </Badge>
              </div>
              <dl className="mt-3 space-y-2 text-[15px]">
                <div className="flex justify-between gap-3 border-b pb-2">
                  <dt className="text-stone-600">Tahun terkunci</dt>
                  <dd className="font-semibold">
                    {data.periode.tahunTerkunci.length > 0
                      ? data.periode.tahunTerkunci.join(', ')
                      : 'Belum ada'}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-stone-600">Tahun terakhir yang boleh dikunci</dt>
                  <dd className="font-semibold">{data.periode.batasTahun}</dd>
                </div>
              </dl>
              <div className="mt-3">
                <Button
                  variant="ghost"
                  disabled={sibuk}
                  onClick={() => onBukaTab('tutup')}
                >
                  Buka menu Kunci Periode
                </Button>
              </div>
            </Card>

            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Jurnal Terakhir</h3>
                  <p className="text-sm text-stone-600">Jurnal terbaru s/d tanggal laporan</p>
                </div>
                {data.jurnalTerakhir && (
                  <Badge>
                    {LABEL_JENIS[data.jurnalTerakhir.jenis] ?? data.jurnalTerakhir.jenis}
                  </Badge>
                )}
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
              {modeLanjutan && (
                <div className="mt-3">
                  <Button
                    variant="ghost"
                    disabled={sibuk}
                    onClick={() => onBukaTab('jurnal')}
                  >
                    Buka Jurnal Umum
                  </Button>
                </div>
              )}
            </Card>

            <Card className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-base font-bold">Backup Terakhir</h3>
                  <p className="text-sm text-stone-600">
                    Backup otomatis harian
                  </p>
                </div>
                <Badge tone={ringkasan.tone}>
                  {!data.backupTerakhir
                    ? 'Belum ada'
                    : ringkasan.tone === 'green'
                      ? 'Baru'
                      : ringkasan.tone === 'amber'
                        ? 'Perlu backup'
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
                    Backup terakhir:{' '}
                    {ringkasan.tanggal
                      ? `${formatTanggal(ringkasan.tanggal)} (${ringkasan.label})`
                      : ringkasan.label}
                  </p>
                  {/* UI-A26: path lengkap kini bisa diklik, bukan hanya via
                      title hover (yang tidak terjangkau papan ketik/sentuh). */}
                  <details className="mt-1 min-w-0">
                    <summary className="cursor-pointer text-helper text-stone-500">
                      Lihat lokasi backup
                    </summary>
                    <p
                      className="mt-1 break-all font-mono text-xs text-stone-500"
                      data-testid="path-backup"
                    >
                      {data.backupTerakhir}
                    </p>
                  </details>
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
        <h3 className="text-base font-bold">Backup / Pulihkan</h3>
        <p className="mt-1 text-sm text-stone-600">
          Backup membuat salinan baru tanpa mengubah data aktif. Pulihkan
          mengganti seluruh data aktif dengan isi backup; data lama dicadangkan
          otomatis.
        </p>
        <PeringatanBackupTidakTerenkripsi />
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <section
            aria-labelledby="judul-backup"
            className="min-w-0 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4"
          >
            <h4 id="judul-backup" className="font-bold text-emerald-950">
              Backup
            </h4>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={sibuk}
                title={sibuk ? ALASAN_SIBUK : undefined}
                onClick={() => setKonfirmasiBackup('lengkap')}
              >
                {jenisSibuk === 'backup-lengkap'
                  ? 'Membuat backup lengkap…'
                  : 'Backup Lengkap (disarankan)'}
              </Button>
              <Button
                variant="ghost"
                disabled={sibuk}
                title={sibuk ? ALASAN_SIBUK : undefined}
                onClick={() => setKonfirmasiBackup('db')}
              >
                {jenisSibuk === 'backup' ? 'Menyimpan backup…' : 'Backup file data (lanjutan)'}
              </Button>
            </div>
            <p className="mt-3 text-sm text-stone-600">
              <b>Backup Lengkap</b> menyimpan satu folder berisi seluruh data
              dan keterangan versi untuk arsip atau pindah laptop.{' '}
              <b>Backup file data</b> hanya berisi satu file data.
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
              Pilih hanya file atau folder backup yang Anda percaya. Data lama
              dicadangkan lebih dulu secara otomatis.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="danger"
                disabled={sibuk}
                title={sibuk ? ALASAN_SIBUK : undefined}
                onClick={() => setKonfirmasiRestoreLengkap(true)}
              >
                {jenisSibuk === 'restore-lengkap'
                  ? 'Memulihkan lengkap…'
                  : 'Pulihkan Lengkap (disarankan)'}
              </Button>
              <Button
                variant="danger-outline"
                disabled={sibuk}
                title={sibuk ? ALASAN_SIBUK : undefined}
                onClick={() => setKonfirmasiRestoreFinal(true)}
              >
                {jenisSibuk === 'restore' ? 'Memulihkan…' : 'Pulihkan file data (lanjutan)'}
              </Button>
            </div>
            <p className="mt-3 text-sm text-stone-700">
              <b>Pulihkan Lengkap</b> memeriksa keterangan backup.{' '}
              <b>Pulihkan file data</b> mengganti data tanpa pemeriksaan itu.
            </p>
          </section>
        </div>
        {/* UI-A11: hasil backup/restore (sukses maupun dibatalkan) juga tampil
            di kartu ini, dekat tombolnya — operator tidak harus menggulir ke
            kartu atas untuk melihat hasilnya. */}
        {info && (
          <InfoBox className="mt-3" testId="info-backup-restore">
            {info}
          </InfoBox>
        )}
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
                ? 'Sedang menyalin data…'
                : jenisSibuk === 'restore'
                  ? 'Sedang memulihkan data…'
                  : jenisSibuk === 'restore-lengkap'
                    ? 'Sedang memulihkan data…'
                    : 'Sedang memuat data…'}
          </p>
        )}
      </Card>

      {konfirmasiBackup && (
        <KonfirmasiBackup
          jenis={konfirmasiBackup}
          sibuk={sibuk}
          onBatal={() => setKonfirmasiBackup(null)}
          onKonfirmasi={() => {
            const jenis = konfirmasiBackup;
            setKonfirmasiBackup(null);
            if (jenis === 'lengkap') void backupLengkap();
            else void backup();
          }}
        />
      )}

      {konfirmasiRestoreFinal && (
        <KonfirmasiRestoreDb
          sibuk={sibuk}
          onBatal={() => setKonfirmasiRestoreFinal(false)}
          onKonfirmasi={() => void restore()}
        />
      )}

      {konfirmasiRestoreLengkap && (
        <KonfirmasiRestoreLengkap
          sibuk={sibuk}
          onBatal={() => setKonfirmasiRestoreLengkap(false)}
          onKonfirmasi={() => void restoreLengkap()}
        />
      )}
    </div>
  );
}
