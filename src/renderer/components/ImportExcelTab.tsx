// Tab Import Excel (P2-9).
//
// Alur operator awam:
//   1. Unduh Template
//   2. Isi file (satu grup = satu jurnal, total debit = kredit)
//   3. Pilih & Pratinjau (tidak menulis DB)
//   4. Impor N Jurnal Valid (konfirmasi + hasil per baris)
//
// Semua penyimpanan file dan pembacaan file dilakukan di main lewat IPC.
// Renderer hanya menampilkan hasil; tidak ada fs dan tidak ada window.confirm.

import { useMemo, useState } from 'react';
import type { HasilBarisImpor, HasilParseImpor } from '../../features/import/parser.js';
import type { HasilImporExcel } from '../../db/impor.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { pesanError, PESAN_MUAT_GAGAL } from '../../utils/pesanError.js';
import { api } from '../lib/api.js';
import {
  adalahErrorSaldoAwal,
  opsiSaldoAwal,
  tandaiMulaiTanpaSaldoAwal,
} from '../lib/saldoAwal.js';
import { useAksiSibuk } from '../lib/aksiSibuk.js';
import { Badge, Button, Card, ErrorBox, KonfirmasiModal } from './ui.js';
import { SaldoAwalGuard } from './SaldoAwalGuard.js';

function tanggalTampil(tanggal: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(tanggal) ? formatTanggal(tanggal) : tanggal || '—';
}

function KotakRingkasan({ label, nilai, keterangan }: { label: string; nilai: string; keterangan?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="text-sm text-stone-600">{label}</div>
      <div className="text-lg font-bold tabular-nums">{nilai}</div>
      {keterangan && <div className="mt-1 text-helper text-stone-500">{keterangan}</div>}
    </div>
  );
}

function TabelHasilImpor({ baris }: { baris: HasilBarisImpor[] }) {
  if (baris.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px] text-stone-600">
        Tidak ada baris untuk ditampilkan.
      </p>
    );
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[1120px] text-left text-[14px]">
        <thead>
          <tr className="border-b text-stone-500">
            <th className="py-2 pr-2">Baris Excel</th>
            <th className="py-2 pr-2">Grup</th>
            <th className="py-2 pr-2">Tanggal</th>
            <th className="py-2 pr-2">Keterangan</th>
            <th className="py-2 pr-2">Akun</th>
            <th className="py-2 pr-2 text-right">Debit</th>
            <th className="py-2 pr-2 text-right">Kredit</th>
            <th className="py-2 pr-2">Status</th>
            <th className="py-2">Alasan</th>
          </tr>
        </thead>
        <tbody>
          {baris.map((b, i) => (
            <tr
              key={`${b.nomorBaris}-${b.barisExcel}-${b.akun}-${b.sisi ?? i}`}
              className="border-b align-top last:border-0"
            >
              <td className="whitespace-nowrap py-2 pr-2 tabular-nums">{b.barisExcel}</td>
              <td className="max-w-[130px] py-2 pr-2 font-semibold">{b.grup || '—'}</td>
              <td className="whitespace-nowrap py-2 pr-2">{tanggalTampil(b.tanggal)}</td>
              <td className="max-w-[220px] py-2 pr-2">{b.keterangan || '—'}</td>
              <td className="whitespace-nowrap py-2 pr-2">
                {b.akun || '—'}
                {b.sisi && <span className="ml-1 text-xs text-stone-500">({b.sisi})</span>}
              </td>
              <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                {b.debit > 0 ? formatRp(b.debit) : '—'}
              </td>
              <td className="whitespace-nowrap py-2 pr-2 text-right tabular-nums">
                {b.kredit > 0 ? formatRp(b.kredit) : '—'}
              </td>
              <td className="whitespace-nowrap py-2 pr-2">
                <Badge tone={b.status === 'OK' ? 'green' : 'red'}>{b.status}</Badge>
              </td>
              <td className="max-w-[300px] py-2 text-stone-700">{b.alasan || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ImportExcelTab() {
  const [hasil, setHasil] = useState<HasilParseImpor | null>(null);
  const [hasilImpor, setHasilImpor] = useState<HasilImporExcel | null>(null);
  const [filePath, setFilePath] = useState('');
  const [namaFile, setNamaFile] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [izinkanPeringatan, setIzinkanPeringatan] = useState(false);
  const [saldoAwalOpen, setSaldoAwalOpen] = useState(false);
  const { sibuk, jalankan } = useAksiSibuk();

  const grupPeringatan = useMemo(
    () => (hasil?.grup ?? []).filter((g) => (g.peringatan?.length ?? 0) > 0),
    [hasil],
  );
  const grupValid = hasil?.ringkasan.grupValid ?? 0;
  const totalValid = useMemo(() => {
    const daftar = (hasil?.grup ?? []).filter((g) => g.status === 'OK');
    return {
      debit: daftar.reduce((s, g) => s + g.totalDebit, 0),
      kredit: daftar.reduce((s, g) => s + g.totalKredit, 0),
    };
  }, [hasil]);

  async function unduhTemplate(): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      try {
        const data = await api.importTemplate();
        setInfo(
          data.saved
            ? `Template tersimpan: ${data.path}`
            : 'Penyimpanan template dibatalkan.',
        );
      } catch (e) {
        setErr(
          pesanError(
            e,
            'Gagal menyimpan template. Coba lagi; bila tetap gagal, hubungi pendamping.',
          ),
        );
      }
    });
  }

  async function pratinjau(path?: string): Promise<void> {
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      setHasilImpor(null);
      try {
        const data = await api.importPreview(path);
        if (!data.diproses || !data.hasil) {
          setInfo('Pemilihan file dibatalkan.');
          return;
        }
        setHasil(data.hasil);
        setFilePath(data.filePath);
        setNamaFile(data.namaFile);
        if (data.hasil.ringkasan.grupValid === 0) {
          setErr(
            data.hasil.errors.length > 0
              ? data.hasil.errors.join(' ')
              : 'Tidak ada grup jurnal yang valid. Perbaiki file sesuai alasan per baris, lalu pratinjau ulang.',
          );
        }
      } catch (e) {
        setErr(pesanError(e, PESAN_MUAT_GAGAL));
      }
    });
  }

  function mintaImpor(): void {
    if (sibuk || !hasil || grupValid === 0 || hasilImpor) return;
    setIzinkanPeringatan(false);
    setErr(null);
    setInfo(null);
    setKonfirmasi(true);
  }

  async function prosesImpor(): Promise<void> {
    setKonfirmasi(false);
    setSaldoAwalOpen(false);
    await jalankan(async () => {
      setErr(null);
      setInfo(null);
      try {
        const data = await api.importProses(filePath || undefined, {
          konfirmasiPeringatan: izinkanPeringatan,
          ...opsiSaldoAwal(),
        });
        if (!data.diproses || !data.hasil) {
          setInfo('Pemilihan file dibatalkan.');
          return;
        }
        setHasilImpor(data.hasil);
        setNamaFile(data.namaFile);
        setFilePath(data.filePath);
        const r = data.hasil.ringkasan;
        setInfo(
          `Import selesai: ${r.jurnalDibuat} jurnal dibuat, ${r.grupGagal} grup gagal. Jurnal bisa dilihat di tab Jurnal Umum.`,
        );
        if (data.hasil.errors.length > 0) setErr(data.hasil.errors.join(' '));
      } catch (e) {
        if (adalahErrorSaldoAwal(e)) {
          setSaldoAwalOpen(true);
        } else {
          setErr(
            pesanError(
              e,
              'Gagal mengimpor jurnal. Periksa file, lalu coba lagi atau hubungi pendamping.',
            ),
          );
        }
      }
    });
  }

  function mulaiTanpaSaldoAwal(): void {
    tandaiMulaiTanpaSaldoAwal();
    setSaldoAwalOpen(false);
    void prosesImpor();
  }

  function saldoAwalTersimpan(_pesan: string): void {
    setSaldoAwalOpen(false);
    void prosesImpor();
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-bold">Import Excel</h1>
            <p className="mt-1 max-w-3xl text-[15px] text-stone-600">
              Untuk memasukkan banyak jurnal sekaligus dari pembukuan lama atau catatan
              Excel. Setiap grup di file menjadi satu jurnal; sistem tetap memeriksa
              keseimbangan, akun, periode, dan nomor bukti sebelum menyimpan.
            </p>
          </div>
          <Badge tone="amber">Tidak mengubah jurnal tersimpan</Badge>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="text-sm font-bold text-emerald-800">1. Unduh template</div>
            <p className="mt-1 text-sm text-stone-600">
              Buka file .xlsx, baca sheet Petunjuk, dan lihat contoh yang sudah terisi.
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="text-sm font-bold text-emerald-800">2. Isi data</div>
            <p className="mt-1 text-sm text-stone-600">
              Satu grup = satu jurnal. Total debit harus sama dengan total kredit.
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="text-sm font-bold text-emerald-800">3. Pilih &amp; pratinjau</div>
            <p className="mt-1 text-sm text-stone-600">
              Sistem menampilkan hasil per baris. Pratinjau belum menyimpan apa pun.
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 p-3">
            <div className="text-sm font-bold text-emerald-800">4. Impor yang valid</div>
            <p className="mt-1 text-sm text-stone-600">
              Hanya grup valid yang disimpan. Nomor bukti kosong dibuat otomatis.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
          <Button variant="ghost" disabled={sibuk} onClick={() => void unduhTemplate()}>
            {sibuk ? 'Memproses…' : 'Unduh Template'}
          </Button>
          <Button disabled={sibuk} onClick={() => void pratinjau()}>
            {sibuk ? 'Memproses…' : 'Pilih & Pratinjau'}
          </Button>
          {hasil && (
            <Button
              variant="ghost"
              disabled={sibuk}
              onClick={() => void pratinjau(filePath || undefined)}
            >
              Muat Ulang Pratinjau
            </Button>
          )}
        </div>

        <div className="mt-3 space-y-2">
          <ErrorBox msg={err} />
          {info && (
            <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800">
              {info}
            </div>
          )}
        </div>
      </Card>

      {hasil && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Pratinjau: {namaFile || 'file Excel'}</h3>
              <p className="text-sm text-stone-600">
                {filePath ? `File: ${filePath}` : 'File belum dipilih.'}
              </p>
            </div>
            <Badge tone={hasil.ringkasan.seimbang ? 'green' : 'red'}>
              {hasil.ringkasan.seimbang ? 'Total debit = kredit' : 'Total belum seimbang'}
            </Badge>
          </div>

          {hasil.errors.length > 0 && (
            <div className="mt-3">
              <ErrorBox msg={hasil.errors.join(' ')} />
            </div>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KotakRingkasan label="Total baris" nilai={String(hasil.ringkasan.totalBaris)} />
            <KotakRingkasan
              label="Grup valid"
              nilai={String(hasil.ringkasan.grupValid)}
              keterangan={`dari ${hasil.ringkasan.totalGrup} grup`}
            />
            <KotakRingkasan
              label="Grup gagal"
              nilai={String(hasil.ringkasan.grupGagal)}
              keterangan={hasil.ringkasan.gagal > 0 ? `${hasil.ringkasan.gagal} baris gagal` : 'Semua baris valid'}
            />
            <KotakRingkasan label="Total debit" nilai={formatRp(hasil.ringkasan.totalDebit)} />
            <KotakRingkasan label="Total kredit" nilai={formatRp(hasil.ringkasan.totalKredit)} />
            <KotakRingkasan
              label="Status"
              nilai={hasil.ringkasan.seimbang ? 'Seimbang' : 'Belum seimbang'}
              keterangan="Dihitung dari seluruh baris"
            />
          </div>

          {!hasilImpor && grupPeringatan.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
              <div className="font-semibold">
                {grupPeringatan.length} grup membutuhkan konfirmasi (mis. kas/bank
                minus atau piutang/hutang tanpa pihak)
              </div>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {grupPeringatan.slice(0, 5).map((g) => (
                  <li key={`${g.grup}-${g.barisExcel.join('-')}`}>
                    {g.grup || '(tanpa nama)'}: {(g.peringatan ?? []).join(' ')}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-sm">
                Grup tersebut tidak diimpor bila Anda tidak mencentang izin pada
                konfirmasi impor.
              </p>
            </div>
          )}

          <TabelHasilImpor baris={hasil.baris} />

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-sm text-stone-600">
              Grup valid akan disimpan sebagai jurnal permanen. Koreksi nanti dilakukan
              lewat jurnal balik, bukan edit/hapus.
            </p>
            <Button
              disabled={sibuk || grupValid === 0 || Boolean(hasilImpor)}
              onClick={mintaImpor}
            >
              {sibuk
                ? 'Memproses…'
                : hasilImpor
                  ? 'Sudah Diimpor — Muat Ulang untuk File Baru'
                  : grupValid === 0
                    ? 'Tidak Ada Jurnal Valid'
                    : `Impor ${grupValid} Jurnal Valid`}
            </Button>
          </div>
        </Card>
      )}

      {hasilImpor && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold">Hasil Import</h3>
              <p className="text-sm text-stone-600">
                {hasilImpor.ringkasan.jurnalDibuat} jurnal dibuat,{' '}
                {hasilImpor.ringkasan.grupGagal} grup gagal. Jurnal bisa dilihat di tab
                Jurnal Umum.
              </p>
            </div>
            <Badge tone={hasilImpor.ringkasan.grupGagal === 0 ? 'green' : 'amber'}>
              {hasilImpor.ringkasan.grupGagal === 0 ? 'Semua grup berhasil' : 'Sebagian gagal'}
            </Badge>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <KotakRingkasan
              label="Jurnal dibuat"
              nilai={String(hasilImpor.ringkasan.jurnalDibuat)}
            />
            <KotakRingkasan
              label="Grup berhasil"
              nilai={String(hasilImpor.ringkasan.grupBerhasil)}
            />
            <KotakRingkasan
              label="Grup gagal"
              nilai={String(hasilImpor.ringkasan.grupGagal)}
            />
            <KotakRingkasan
              label="Total debit tersimpan"
              nilai={formatRp(hasilImpor.ringkasan.totalDebit)}
            />
          </div>

          {hasilImpor.ringkasan.noBuktiDibuat.length > 0 && (
            <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2">
              <div className="text-sm font-semibold text-green-900">Nomor bukti dibuat:</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {hasilImpor.ringkasan.noBuktiDibuat.map((no) => (
                  <Badge key={no} tone="green">
                    {no}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {hasilImpor.grup.some((g) => g.perluKonfirmasi) && (
            <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900">
              Sebagian grup gagal karena membutuhkan konfirmasi (kas/bank minus atau
              piutang/hutang tanpa pihak). Periksa saldo dan file, lalu pratinjau ulang
              sebelum mencoba lagi.
            </div>
          )}

          {hasilImpor.errors.length > 0 && (
            <div className="mt-3">
              <ErrorBox msg={hasilImpor.errors.join(' ')} />
            </div>
          )}

          <TabelHasilImpor baris={hasilImpor.baris} />

          <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
            <Button variant="ghost" disabled={sibuk} onClick={() => void pratinjau(filePath || undefined)}>
              Muat Ulang Pratinjau
            </Button>
            <Button
              variant="ghost"
              disabled={sibuk}
              onClick={() => {
                setHasilImpor(null);
                setHasil(null);
                setFilePath('');
                setNamaFile('');
                setErr(null);
                setInfo(null);
              }}
            >
              Mulai File Baru
            </Button>
          </div>
        </Card>
      )}

      {konfirmasi && hasil && (
        <KonfirmasiModal
          judul={`Impor ${grupValid} jurnal ke pembukuan?`}
          deskripsi={
            <>
              <p>
                File <b>{namaFile || 'Excel'}</b> berisi <b>{grupValid} grup valid</b>{' '}
                dengan total debit <b>{formatRp(totalValid.debit)}</b> dan total kredit{' '}
                <b>{formatRp(totalValid.kredit)}</b>.
              </p>
              <p>
                Jurnal yang tersimpan bersifat permanen. Setelah impor, koreksi dilakukan
                lewat jurnal balik, bukan edit atau hapus.
              </p>
              {grupPeringatan.length > 0 && (
                <label className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-sm">
                  <input
                    type="checkbox"
                    checked={izinkanPeringatan}
                    onChange={(e) => setIzinkanPeringatan(e.target.checked)}
                    className="mt-0.5 h-4 w-4"
                  />
                  <span>
                    Saya sudah memeriksa {grupPeringatan.length} grup yang memberi
                    peringatan (kas/bank minus atau piutang/hutang belum teralokasi)
                    dan mengizinkannya bila memang benar.
                  </span>
                </label>
              )}
            </>
          }
          labelYa="Ya, impor sekarang"
          labelBatal="Batal"
          variant="primary"
          sibuk={sibuk}
          onBatal={() => setKonfirmasi(false)}
          onKonfirmasi={() => void prosesImpor()}
        />
      )}

      <SaldoAwalGuard
        terbuka={saldoAwalOpen}
        sibuk={sibuk}
        onBatal={() => setSaldoAwalOpen(false)}
        onMulaiTanpa={mulaiTanpaSaldoAwal}
        onSaldoAwalTersimpan={saldoAwalTersimpan}
      />
    </div>
  );
}
