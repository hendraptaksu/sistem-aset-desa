import { useEffect, useRef, useState } from 'react';
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
  InfoBox,
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

export function TutupTab() {
  // UI-A26: tahun berjalan dihitung saat render, bukan konstanta modul yang
  // bisa basi bila aplikasi tetap terbuka melewati pergantian tahun.
  const tahunBerjalan = tahunLokal();
  const tahunTerakhirBolehDitutup = tahunBerjalan - 1;
  const [list, setList] = useState<TutupBukuTampil[]>([]);
  // UI-A14: status memuat + gagal muat riwayat tampil di kartu riwayat sendiri,
  // bukan di kartu Kunci Periode; empty state hanya setelah muat sukses.
  const [memuatRiwayat, setMemuatRiwayat] = useState(true);
  const [errRiwayat, setErrRiwayat] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tahunInput, setTahunInput] = useState(() => String(tahunLokal() - 1));
  const [step, setStep] = useState<Step>(1);
  const [preview, setPreview] = useState<TutupPreviewData | null>(null);
  const [catatan, setCatatan] = useState('');
  const [konfirmasiOpen, setKonfirmasiOpen] = useState(false);
  const { sibuk, jalankan } = useAksiSibuk();
  // UI-A26: backup otomatis per tahun hanya dibuat sekali; bolak-balik langkah
  // 2↔3 tidak membuat ulang backup untuk tahun yang sama.
  const backupTahunRef = useRef<number | null>(null);
  const tahunDipilih = Number(tahunInput);
  const tahunAktifRef = useRef(tahunDipilih);
  useEffect(() => {
    tahunAktifRef.current = tahunDipilih;
  }, [tahunDipilih]);
  // Tahun berubah = preview/backup/catatan tahun lama tidak boleh terbawa.
  useEffect(() => {
    setPreview(null);
    setStep(1);
    setCatatan('');
    backupTahunRef.current = null;
  }, [tahunInput]);
  const temuanKritis = (preview?.temuanIntegritas ?? []).filter(
    (t) => t.kode !== 'SNAPSHOT_TUTUP_BERUBAH',
  );
  const snapshot = preview?.snapshotTerbaru ?? null;
  // UI-A14: baris riwayat hanya dirender setelah muat sukses dan tidak gagal.
  const riwayatSiap = !memuatRiwayat && !errRiwayat;
  const snapshotRingkas = snapshot ? (
    <div className="rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm">
      <p className="font-semibold">
        Ringkasan terkunci versi {snapshot.versi}
        {preview?.versiSnapshotBerikutnya !== undefined
          ? ` (versi berikutnya: ${preview.versiSnapshotBerikutnya})`
          : ''}
      </p>
      <p>Laba: {formatRp(snapshot.laba)}</p>
      <p>
        {/* UI-A17: total_pasiva = kewajiban + ekuitas, bukan kewajiban saja,
            jadi labelnya dijelaskan; "Kewajiban" dipakai untuk liabilities. */}
        Total aset {formatRp(snapshot.total_aset)} · kewajiban + ekuitas{' '}
        {formatRp(snapshot.total_pasiva)} · selisih {formatRp(snapshot.selisih)}
      </p>
    </div>
  ) : null;

  async function refresh() {
    setMemuatRiwayat(true);
    try {
      setList(await api.tutupList());
      setErrRiwayat(null);
    } catch (e) {
      setErrRiwayat(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setMemuatRiwayat(false);
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
        const tahun = tahunDipilih;
        const r = await api.tutupPreview(tahun);
        // Abaikan respons basi bila operator sudah mengganti tahun.
        if (tahunAktifRef.current !== tahun) return;
        setPreview(r);
        const temuan = r.temuanIntegritas ?? [];
        const kritis = temuan.filter(
          (t) => t.kode !== 'SNAPSHOT_TUTUP_BERUBAH',
        );
        if (kritis.length > 0) {
          setErr(
            pesanValidasi(r.errors) ||
              'Pemeriksaan data menemukan masalah yang harus diperbaiki sebelum periode dikunci. Buka Pengaturan → Audit Integritas untuk rinciannya.',
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
      // Backup mengikuti tahun yang benar-benar dipratinjau, bukan isian yang
      // mungkin sudah berubah.
      const tahun = preview?.tahun ?? tahunDipilih;
      // Guard tahun sama: backup untuk tahun ini sudah pernah dibuat, jadi
      // kembali dari langkah 3 lalu lanjut lagi tidak membuat backup baru.
      if (backupTahunRef.current === tahun) {
        setStep(3);
        return;
      }
      try {
        await api.backupAuto(tahun);
        backupTahunRef.current = tahun;
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
          tahun: preview?.tahun ?? tahunDipilih,
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
        // Kunci ulang setelah koreksi wajib memakai backup baru.
        backupTahunRef.current = null;
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
        <h1 className="text-xl font-bold">Kunci Periode</h1>
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
              Angka saat ini sudah berbeda dari Ringkasan terkunci.
            </p>
            <p className="text-sm">
              Ringkasan terkunci tidak diubah. Periksa apakah perbedaan berasal dari
              koreksi setelah dikunci atau data rusak. Kunci ulang tetap boleh
              dilakukan dengan konfirmasi.
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
        {info && <InfoBox className="mb-2">{info}</InfoBox>}
        {/* UI-A18: paragraf 4 konsep diringkas; detail "bukan jurnal penutup"
            dipindah ke blok bantuan agar tidak menjadi dinding teks. */}
        <p className="mb-3 mt-2 text-sm text-stone-600">
          Saat periode dikunci, laba dan Neraca disahkan sebagai{' '}
          <b>Ringkasan terkunci</b>. Angka saat ini tetap dihitung dari jurnal, jadi
          koreksi setelah dikunci bisa membuat angka berbeda; perbedaannya
          diperingatkan di riwayat.
        </p>
        <details className="mb-3 text-sm text-stone-600">
          <summary className="cursor-pointer font-semibold">
            Apakah kunci periode membuat jurnal penutup?
          </summary>
          <p className="mt-1">
            Tidak. Tidak ada jurnal yang dibuat atau dipindahkan ke ekuitas.
            Koreksi untuk tahun yang sudah dikunci tetap boleh dengan alasan dan
            tercatat di riwayat audit.
          </p>
        </details>
        <ol className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Langkah kunci periode">
          {(
            [
              [1, 'Pratinjau laba'],
              [2, 'Backup otomatis'],
              [3, 'Konfirmasi'],
            ] as [Step, string][]
          ).map(([n, label]) => (
            <li
              key={n}
              aria-current={step === n ? 'step' : undefined}
              className={step === n ? 'font-semibold text-stone-800' : 'text-stone-500'}
            >
              {n}. {label}
            </li>
          ))}
        </ol>
        <p className="mb-3 text-sm text-stone-600">
          Tahun terakhir yang boleh dikunci: <b>{tahunTerakhirBolehDitutup}</b>.
          Tahun berjalan ({tahunBerjalan}) dan sesudahnya belum boleh dikunci.
        </p>

        {step === 1 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Tahun">
              <TextInput
                type="number"
                min={1900}
                max={tahunTerakhirBolehDitutup}
                value={tahunInput}
                disabled={sibuk}
                onChange={(e) => {
                  setTahunInput(e.target.value);
                  setPreview(null);
                  // Tahun ganti = konteks ganti; backup langkah 2 lama tidak berlaku.
                  backupTahunRef.current = null;
                }}
              />
            </Field>
            <div className="flex items-end">
              <Button disabled={sibuk} onClick={() => void mulaiPreview()}>
                {sibuk ? 'Memuat…' : 'Pratinjau laba'}
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
        <h2 className="mb-2 font-bold">Riwayat kunci periode</h2>
        <p className="mb-2 text-sm text-stone-600">
          Ringkasan terkunci saat tahun dikunci. Angkanya tidak berubah walau ada
          koreksi setelahnya, sehingga angka saat ini bisa berbeda.
        </p>
        <div className="overflow-x-auto">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th scope="col" className="py-2 pr-3">Tahun</th>
              <th scope="col" className="py-2 pr-3 text-right">Laba</th>
              <th scope="col" className="py-2 pr-3">Catatan</th>
            </tr>
          </thead>
          <tbody>
            {memuatRiwayat && (
              <tr>
                <td colSpan={3} className="py-4 text-center text-stone-500">
                  Memuat riwayat kunci periode…
                </td>
              </tr>
            )}
            {!memuatRiwayat && errRiwayat && (
              <tr>
                <td colSpan={3} className="py-2">
                  {/* UI-A14: gagal muat riwayat tampil di kartu ini sendiri,
                      bukan di kartu Kunci Periode. */}
                  <ErrorBox msg={errRiwayat} />
                </td>
              </tr>
            )}
            {riwayatSiap && list.map((t) => (
              <tr key={t.tahun} className="border-b last:border-0">
                <td className="py-2 pr-3">
                  <Badge>{t.tahun}</Badge>
                  {t.snapshotTerbaru && (
                    <p className="mt-1 text-helper text-stone-500">
                      Ringkasan terkunci
                    </p>
                  )}
                  {t.catatanTahunPertama && (
                    <p className="mt-1 text-helper text-amber-700">
                      Tahun pertama (parsial)
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3 text-right">
                  {formatRp(t.laba)}
                  {t.snapshotTerbaru && (
                    <p className="mt-1 text-helper text-stone-500">
                      Aset {formatRp(t.snapshotTerbaru.total_aset)} · kewajiban +{' '}
                      ekuitas {formatRp(t.snapshotTerbaru.total_pasiva)} · selisih{' '}
                      {formatRp(t.snapshotTerbaru.selisih)}
                    </p>
                  )}
                  {t.snapshotBerubah && (
                    <p className="mt-1 text-helper text-amber-700">
                      Angka saat ini sudah berbeda (laba saat ini {formatRp(t.labaLive)}).
                    </p>
                  )}
                </td>
                <td className="py-2 pr-3 text-sm text-stone-700">
                  {t.catatan || '-'}
                  {t.snapshotBerubah && (
                    <p className="mt-1 text-helper text-amber-700">
                      Periksa koreksi setelah dikunci atau data yang perlu
                      diperbaiki.
                    </p>
                  )}
                </td>
              </tr>
            ))}
            {riwayatSiap && list.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-center text-stone-500">Belum ada periode yang dikunci.</td></tr>
            )}
          </tbody>
        </table>
        </div>
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
