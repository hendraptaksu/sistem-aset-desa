import { useEffect, useState } from 'react';
import type { DashboardHasil } from '../../features/dashboard/dashboard.js';
import { formatRp } from '../../utils/format.js';
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

const today = () => new Date().toISOString().slice(0, 10);

export function DashboardTab() {
  const [cutoff, setCutoff] = useState(today());
  const [data, setData] = useState<DashboardHasil | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [autoPath, setAutoPath] = useState<string>('');
  const [jenisSibuk, setJenisSibuk] = useState<null | 'muat' | 'backup' | 'restore'>(
    null,
  );
  const [konfirmasiRestore, setKonfirmasiRestore] = useState(false);
  const { sibuk, jalankan } = useAksiSibuk();

  /** Muat data tanpa guard; pemanggil yang mengatur status sibuk. */
  async function muatData(c: string): Promise<void> {
    setData(await api.dashboard(c));
    try {
      const s = await api.backupStatus();
      setAutoPath(s.path);
    } catch {
      /* status backup best-effort, jangan tutupi dashboard */
    }
  }

  async function muat(c = cutoff): Promise<void> {
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

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-lg font-bold">
          Dashboard{' '}
          {data && <Badge tone={data.balance ? 'green' : 'red'}>{data.badge}</Badge>}
        </h2>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Cut-off">
            <TextInput type="date" value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button disabled={sibuk} onClick={() => void muat()}>
              {jenisSibuk === 'muat' ? 'Memuat…' : 'Muat'}
            </Button>
          </div>
        </div>
      </Card>

      {data && (
        <Card>
          <table className="w-full text-left text-[15px]">
            <tbody>
              <tr className="border-b">
                <th className="py-2 pr-3">Saldo Kas Tunai (1001)</th>
                <td className="py-2 text-right">{formatRp(data.kasTunai)}</td>
              </tr>
              <tr className="border-b">
                <th className="py-2 pr-3">Total LPD</th>
                <td className="py-2 text-right">{formatRp(data.totalLpd)}</td>
              </tr>
              <tr className="border-b">
                <th className="py-2 pr-3">Aktiva</th>
                <td className="py-2 text-right">{formatRp(data.aktiva)}</td>
              </tr>
              <tr className="border-b">
                <th className="py-2 pr-3">Pasiva</th>
                <td className="py-2 text-right">{formatRp(data.pasiva)}</td>
              </tr>
            </tbody>
          </table>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-stone-600">Rincian LPD</summary>
            <table className="mt-2 w-full text-left text-[15px]">
              <tbody>
                {Object.entries(data.rincianLpd).map(([k, v]) => (
                  <tr key={k} className="border-b last:border-0">
                    <td className="py-2 pr-3">{k}</td>
                    <td className="py-2 text-right">{formatRp(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </Card>
      )}

      <Card>
        <h3 className="mb-2 font-bold">Backup / Restore (.db)</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" disabled={sibuk} onClick={() => void backup()}>
            {jenisSibuk === 'backup' ? 'Menyimpan backup…' : 'Backup Export .db'}
          </Button>
          <Button variant="ghost" disabled={sibuk} onClick={() => setKonfirmasiRestore(true)}>
            {jenisSibuk === 'restore' ? 'Memulihkan…' : 'Restore Import .db'}
          </Button>
        </div>
        {jenisSibuk && (
          <p className="mt-2 text-sm font-semibold text-emerald-800" role="status">
            {jenisSibuk === 'backup'
              ? 'Sedang membuat backup…'
              : jenisSibuk === 'restore'
                ? 'Sedang memulihkan data…'
                : 'Sedang memuat data…'}
          </p>
        )}
        <p className="mt-2 text-sm text-stone-600">
          Single-file SQLite lokal offline. Export untuk cadangan manual, import untuk pulihkan saat ganti laptop/pengurus.
        </p>
        <p className="mt-1 text-sm text-stone-600">
          Backup otomatis terakhir: {autoPath ? autoPath.split(/[\\/]/).pop() : '—'}
        </p>
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
    </div>
  );
}
