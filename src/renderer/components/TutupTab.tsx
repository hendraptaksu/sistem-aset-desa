import { useEffect, useState } from 'react';
import { formatRp } from '../../utils/format.js';
import { tahunLokal } from '../../utils/tanggal.js';
import {
  api,
  type TutupBukuTampil,
  type TutupPreviewData,
} from '../lib/api.js';
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
import {
  PESAN_MUAT_GAGAL,
  PESAN_PROSES_GAGAL,
  pesanError,
  pesanValidasi,
} from '../../utils/pesanError.js';

type Step = 1 | 2 | 3;

const TAHUN_BERJALAN = tahunLokal();
const TAHUN_TERAKHIR_BOLEH_DITUTUP = TAHUN_BERJALAN - 1;

export function TutupTab() {
  const [list, setList] = useState<TutupBukuTampil[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tahun, setTahun] = useState(TAHUN_TERAKHIR_BOLEH_DITUTUP);
  const [step, setStep] = useState<Step>(1);
  const [preview, setPreview] = useState<TutupPreviewData | null>(null);
  const [catatan, setCatatan] = useState('');
  const [konfirmasiOpen, setKonfirmasiOpen] = useState(false);
  const { sibuk, jalankan } = useAksiSibuk();
  const temuanKritis = (preview?.temuanIntegritas ?? []).filter(
    (t) => t.kode !== 'SNAPSHOT_TUTUP_BERUBAH',
  );
  const snapshot = preview?.snapshotTerbaru ?? null;
  const snapshotRingkas = snapshot ? (
    <div className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm">
      <p className="font-semibold">
        Snapshot Kunci Periode versi {snapshot.versi}
        {preview?.versiSnapshotBerikutnya !== undefined
          ? ` (versi berikutnya: ${preview.versiSnapshotBerikutnya})`
          : ''}
      </p>
      <p>Laba snapshot: {formatRp(snapshot.laba)}</p>
      <p>
        Total aset {formatRp(snapshot.total_aset)} · total pasiva{' '}
        {formatRp(snapshot.total_pasiva)} · selisih {formatRp(snapshot.selisih)}
      </p>
    </div>
  ) : null;

  async function refresh() {
    try {
      setList(await api.tutupList());
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function mulaiPreview(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      try {
        const r = await api.tutupPreview(tahun);
        setPreview(r);
        const temuan = r.temuanIntegritas ?? [];
        const kritis = temuan.filter(
          (t) => t.kode !== 'SNAPSHOT_TUTUP_BERUBAH',
        );
        if (kritis.length > 0) {
          setErr(
            pesanValidasi(r.errors) ||
              `Audit integritas gagal: ${kritis.map((t) => t.kode).join(', ')}`,
          );
          setStep(1);
          return;
        }
        if (!r.boleh && !r.perluKonfirmasi) {
          setErr(pesanValidasi(r.errors) || 'Tahun belum bisa dikunci.');
          setStep(1);
          return;
        }
        // Tahun yang sudah ditutup boleh dilanjutkan, tetapi langkah konfirmasi
        // akan menampilkan peringatan "tutup ulang" + perubahan snapshot.
        setStep(2);
      } catch (e) {
        setErr(pesanError(e, PESAN_MUAT_GAGAL));
      }
    });
  }

  async function autoBackup(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      try {
        await api.backupAuto(tahun);
        setStep(3);
      } catch (e) {
        setErr(pesanError(e, PESAN_PROSES_GAGAL));
      }
    });
  }

  async function konfirmasi(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      try {
        const r = await api.tutupCreate({
          tahun,
          catatan,
          konfirmasiTimpak: preview?.sudahDitutup === true,
        });
        setInfo(
          `Tahun ${r.tahun} ${r.aksi === 'TUTUP-ULANG' ? 'dikunci ulang' : 'dikunci'}. ` +
            `Laba ${formatRp(r.laba)}. Laba ditahan ${formatRp(r.labaDitahan)}. ` +
            'Backup otomatis sudah dibuat.',
        );
        setStep(1);
        setPreview(null);
        setCatatan('');
        await refresh();
      } catch (e) {
        setErr(pesanError(e, PESAN_PROSES_GAGAL));
      } finally {
        setKonfirmasiOpen(false);
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="mb-3 text-lg font-bold">Kunci Periode</h1>
        <ErrorBox msg={err} />
        {preview && temuanKritis.length > 0 && (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-800">
            <p className="font-semibold">
              Audit integritas akuntansi gagal. Kunci periode diblokir sampai data diperbaiki.
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {temuanKritis.map((t, i) => (
                <li key={`${t.kode}-${i}`}>
                  <b>{t.kode}</b>: {t.pesan}
                </li>
              ))}
            </ul>
          </div>
        )}
        {preview && snapshot && preview.snapshotBerubah && (
          <div
            className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
            data-testid="peringatan-snapshot-tutup"
          >
            <p className="font-semibold">
              Angka live sudah berbeda dari snapshot Kunci Periode versi {snapshot.versi}.
            </p>
            <p className="text-sm">
              Snapshot tidak diubah. Periksa apakah perbedaan berasal dari koreksi
              setelah tutup atau data rusak. TUTUP-ULANG yang dikonfirmasi tetap boleh
              mencatat snapshot versi baru.
            </p>
            {preview.perbedaanSnapshot.length > 0 && (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {preview.perbedaanSnapshot.map((p, i) => (
                  <li key={`${p}-${i}`}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <p className="mb-3 text-sm text-stone-600">
          Langkah {step}/3: {step === 1 ? 'Preview laba' : step === 2 ? 'Auto-backup .db' : 'Konfirmasi'}.
          Saat periode dikunci, snapshot laba + Neraca + hash jurnal disahkan dan disimpan permanen.
          Angka laporan tetap dihitung dari jurnal, jadi angka live bisa berbeda bila ada koreksi
          setelah tutup; perbedaannya akan diperingatkan di riwayat.
          Ini bukan jurnal penutup: tidak ada jurnal yang dibuat atau dipindahkan ke ekuitas.
          Tahun yang sudah selesai bisa dikoreksi dengan alasan, dan tercatat otomatis.
        </p>
        <p className="mb-3 text-sm text-stone-600">
          Tahun yang boleh dikunci: <b>≤ {TAHUN_TERAKHIR_BOLEH_DITUTUP}</b>. Tahun berjalan
          ({TAHUN_BERJALAN}) dan tahun berikutnya belum boleh dikunci.
        </p>

        {step === 1 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Tahun">
              <TextInput
                type="number"
                min={1900}
                max={TAHUN_TERAKHIR_BOLEH_DITUTUP}
                value={String(tahun)}
                onChange={(e) => {
                  setTahun(Number(e.target.value));
                  setPreview(null);
                }}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={sibuk} onClick={() => void mulaiPreview()}>
                {sibuk ? 'Memuat…' : 'Preview laba'}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && preview && (
          <div className="space-y-3">
            <p className="text-[15px]">
              Laba tahun {preview.tahun}: <b>{formatRp(preview.laba)}</b>
            </p>
            {snapshotRingkas}
            {preview.catatanTahunPertama && (
              <p
                className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900"
                data-testid="catatan-tahun-pertama-tutup"
              >
                {preview.catatanTahunPertama}
              </p>
            )}
            <p className="text-[15px]">
              Laba ditahan setelah dikunci: <b>{formatRp(preview.labaDitahanSesudah)}</b>
            </p>
            {preview.sudahDitutup && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800">
                Tahun {preview.tahun} sudah pernah dikunci. Melanjutkan akan memperbarui
                catatan dan tetap tercatat di audit sebagai <b>TUTUP-ULANG</b>.
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" disabled={sibuk} onClick={() => setStep(1)}>
                Kembali
              </Button>
              <Button disabled={sibuk} onClick={() => void autoBackup()}>
                {sibuk ? 'Memproses…' : 'Backup otomatis & lanjut'}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && preview && (
          <div className="space-y-3">
            <p className="text-[15px]">
              Laba tahun {preview.tahun}: <b>{formatRp(preview.laba)}</b>
              <br />
              <span className="text-stone-600">Backup otomatis sudah dibuat.</span>
            </p>
            {snapshotRingkas}
            <Field label="Catatan kunci periode (opsional)">
              <TextInput
                value={catatan}
                onChange={(e) => setCatatan(e.target.value)}
                placeholder="Contoh: kunci periode 2025, data sudah diperiksa akuntan"
              />
            </Field>
            {preview.sudahDitutup && (
              <p className="text-sm text-amber-700">
                Tahun ini akan dikunci ulang (TUTUP-ULANG).
              </p>
            )}
            <div className="flex gap-2">
              <Button variant="ghost" disabled={sibuk} onClick={() => setStep(2)}>
                Kembali
              </Button>
              <Button disabled={sibuk} onClick={() => setKonfirmasiOpen(true)}>
                {preview.sudahDitutup ? 'Konfirmasi kunci ulang' : 'Konfirmasi kunci periode'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Riwayat kunci periode</h3>
        <p className="mb-2 text-sm text-stone-600">
          Laba dan Neraca di bawah adalah snapshot yang disahkan saat tahun ditutup.
          Snapshot tidak berubah walau ada koreksi sesudahnya, sehingga angka live
          bisa berbeda dari angka yang disahkan.
        </p>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Tahun</th>
              <th className="py-2 pr-3 text-right">Laba</th>
              <th className="py-2 pr-3">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.tahun} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <Badge>{t.tahun}</Badge>
                  {t.snapshotTerbaru && (
                    <p className="mt-1 text-helper text-stone-500">
                      snapshot v{t.snapshotTerbaru.versi}
                    </p>
                  )}
                  {t.catatanTahunPertama && (
                    <p className="mt-1 text-helper text-amber-700">
                      tahun pertama (parsial)
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3 text-right">
                  {formatRp(t.laba)}
                  {t.snapshotTerbaru && (
                    <p className="mt-1 text-helper text-stone-500">
                      Aset {formatRp(t.snapshotTerbaru.total_aset)} · pasiva{' '}
                      {formatRp(t.snapshotTerbaru.total_pasiva)} · selisih{' '}
                      {formatRp(t.snapshotTerbaru.selisih)}
                    </p>
                  )}
                  {t.snapshotBerubah && (
                    <p className="mt-1 text-helper text-amber-700">
                      Angka live sudah berbeda (laba live {formatRp(t.labaLive)}).
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3 text-sm text-stone-700">
                  {t.catatan || '-'}
                  {t.snapshotBerubah && (
                    <p className="mt-1 text-helper text-amber-700">
                      Tinjau koreksi setelah tutup atau data rusak.
                    </p>
                  )}
                </td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-center text-stone-500">Belum pernah ada periode dikunci.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {konfirmasiOpen && preview && (
        <KonfirmasiModal
          judul={
            preview.sudahDitutup
              ? `Kunci ulang tahun ${preview.tahun}?`
              : `Kunci periode tahun ${preview.tahun}?`
          }
          deskripsi={
            <>
              <p>
                Laba tahun {preview.tahun}: <b>{formatRp(preview.laba)}</b>.
              </p>
              <p>
                Laba ditahan setelah dikunci:{' '}
                <b>{formatRp(preview.labaDitahanSesudah)}</b>.
              </p>
              {preview.catatanTahunPertama && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  {preview.catatanTahunPertama}
                </p>
              )}
              <p className="text-sm text-stone-600">
                Periode akan dikunci. Koreksi setelah ini tetap boleh, tetapi wajib
                alasan dan tercatat di audit. Backup otomatis sudah dibuat.
              </p>
              {preview.sudahDitutup && (
                <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                  Tahun ini sudah pernah dikunci. Melanjutkan akan mencatat{' '}
                  <b>TUTUP-ULANG</b>.
                </p>
              )}
            </>
          }
          labelYa={preview.sudahDitutup ? 'Ya, kunci ulang' : 'Ya, kunci periode'}
          sibuk={sibuk}
          onBatal={() => setKonfirmasiOpen(false)}
          onKonfirmasi={() => void konfirmasi()}
        />
      )}
    </div>
  );
}
