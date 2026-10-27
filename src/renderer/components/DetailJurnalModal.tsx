import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import type { JurnalLengkap, LampiranJurnal } from '../lib/api.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { formatUkuranFile } from '../../core/lampiran.js';
import { api } from '../lib/api.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';
import { Badge, Button, Modal } from './ui.js';

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

function namaAkun(coa: Coa[], kode: string): string {
  const akun = coa.find((a) => a.kode === kode);
  return akun ? `${akun.kode} — ${akun.nama}` : kode;
}

const GAGAL_MUAT_LAMPIRAN =
  'Gagal memuat lampiran. Coba lagi; bila tetap gagal, hubungi pendamping.';
const GAGAL_UNGGAH_LAMPIRAN =
  'Gagal mengunggah lampiran. Coba lagi; bila tetap gagal, hubungi pendamping.';
const GAGAL_BUKA_LAMPIRAN =
  'Gagal membuka lampiran. Coba lagi; bila tetap gagal, hubungi pendamping.';
const GAGAL_HAPUS_LAMPIRAN =
  'Gagal menghapus lampiran. Coba lagi; bila tetap gagal, hubungi pendamping.';

/**
 * Modal detail jurnal bersama (Jurnal Umum + drill-down laporan).
 *
 * Fitur lama JurnalTab (Duplikat/Print) tetap tersedia lewat prop opsional
 * `onDuplikat`/`onPrint`; `children` disediakan untuk aksi tambahan pemanggil.
 * Bagian "Lampiran Bukti" memakai file di folder aplikasi (bukan blob DB).
 */
export function DetailJurnalModal({
  jurnal,
  coa,
  onClose,
  onDuplikat,
  onPrint,
  children,
}: {
  jurnal: JurnalLengkap;
  coa: Coa[];
  onClose: () => void;
  onDuplikat?: (jurnal: JurnalLengkap) => void;
  onPrint?: (jurnal: JurnalLengkap) => void;
  children?: ReactNode;
}) {
  const [lampiran, setLampiran] = useState<LampiranJurnal[] | null>(null);
  const [errLampiran, setErrLampiran] = useState<string | null>(null);
  const [infoLampiran, setInfoLampiran] = useState<string | null>(null);
  const [busyLampiran, setBusyLampiran] = useState(false);
  const [hapusTarget, setHapusTarget] = useState<LampiranJurnal | null>(null);
  const [preview, setPreview] = useState<{ dataUrl: string; namaAsli: string } | null>(
    null,
  );
  const busyRef = useRef(false);

  useEffect(() => {
    let aktif = true;
    setLampiran(null);
    setErrLampiran(null);
    setInfoLampiran(null);
    api
      .lampiranList(jurnal.id)
      .then((rows) => {
        if (aktif) setLampiran(rows);
      })
      .catch((e) => {
        if (!aktif) return;
        setLampiran([]);
        setErrLampiran(pesanError(e, GAGAL_MUAT_LAMPIRAN));
      });
    return () => {
      aktif = false;
    };
  }, [jurnal.id]);

  async function unggahLampiran(): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyLampiran(true);
    setErrLampiran(null);
    setInfoLampiran(null);
    try {
      const hasil = await api.lampiranUpload(jurnal.id);
      if (!hasil.saved) return;
      const baru = hasil.lampiran;
      if (baru) setLampiran((rows) => [...(rows ?? []), baru]);
      setInfoLampiran('Lampiran bukti tersimpan.');
    } catch (e) {
      setErrLampiran(pesanError(e, GAGAL_UNGGAH_LAMPIRAN));
    } finally {
      busyRef.current = false;
      setBusyLampiran(false);
    }
  }

  async function lihatLampiran(l: LampiranJurnal): Promise<void> {
    setErrLampiran(null);
    setInfoLampiran(null);
    try {
      const p = await api.lampiranPreview(l.id);
      if (p.dataUrl) {
        setPreview({ dataUrl: p.dataUrl, namaAsli: p.namaAsli });
      } else {
        setInfoLampiran(
          'Pratinjau tidak tersedia (file lebih dari 5 MB atau bukan gambar). Gunakan tombol Buka.',
        );
      }
    } catch (e) {
      setErrLampiran(pesanError(e, GAGAL_BUKA_LAMPIRAN));
    }
  }

  async function bukaLampiran(l: LampiranJurnal): Promise<void> {
    setErrLampiran(null);
    setInfoLampiran(null);
    try {
      await api.lampiranOpen(l.id);
    } catch (e) {
      setErrLampiran(pesanError(e, GAGAL_BUKA_LAMPIRAN));
    }
  }

  async function konfirmasiHapus(): Promise<void> {
    if (!hapusTarget || busyRef.current) return;
    const target = hapusTarget;
    busyRef.current = true;
    setBusyLampiran(true);
    setErrLampiran(null);
    setInfoLampiran(null);
    try {
      await api.lampiranDelete(target.id);
      setLampiran((rows) => (rows ?? []).filter((x) => x.id !== target.id));
      setInfoLampiran(`Lampiran ${target.nama_asli} dihapus.`);
      setHapusTarget(null);
    } catch (e) {
      setErrLampiran(pesanError(e, GAGAL_HAPUS_LAMPIRAN));
    } finally {
      busyRef.current = false;
      setBusyLampiran(false);
    }
  }

  return (
    <Modal judul="Detail Jurnal" onTutup={onClose} sibuk={busyLampiran} lebar="2xl">
      <div className="flex flex-wrap gap-2">
        {jurnal.reversal_of && <Badge tone="red">Jurnal balik</Badge>}
        {jurnal.reversal_id && <Badge tone="amber">Sudah dikoreksi</Badge>}
        {!jurnal.reversal_of && !jurnal.reversal_id && (
          <Badge tone="green">Aktif</Badge>
        )}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[15px]">
        <p>
          <span className="text-stone-500">Tanggal: </span>
          {formatTanggal(jurnal.tanggal)}
        </p>
        <p>
          <span className="text-stone-500">No. Bukti: </span>
          {jurnal.no_bukti || '—'}
        </p>
        <p>
          <span className="text-stone-500">Jenis: </span>
          {LABEL_JENIS[jurnal.jenis] ?? jurnal.jenis}
        </p>
        <p>
          <span className="text-stone-500">ID: </span>
          <span className="break-all">{jurnal.id}</span>
        </p>
      </div>
      <p className="mt-2 text-[15px]">
        <span className="text-stone-500">Keterangan: </span>
        {jurnal.keterangan}
      </p>
      {jurnal.reversal_of && (
        <p className="mt-1 text-sm text-stone-600">
          Jurnal ini membalik jurnal <b>{jurnal.reversal_of}</b>.
        </p>
      )}
      {jurnal.reversal_id && (
        <p className="mt-1 text-sm text-stone-600">
          Jurnal ini sudah dikoreksi oleh <b>{jurnal.reversal_id}</b>.
        </p>
      )}

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Akun</th>
              <th className="py-2 pr-3">Catatan</th>
              <th className="py-2 pr-3 text-right">Debit</th>
              <th className="py-2 text-right">Kredit</th>
            </tr>
          </thead>
          <tbody>
            {jurnal.baris.map((b) => (
              <tr key={b.id} className="border-b last:border-0">
                <td className="py-2 pr-3">{namaAkun(coa, b.akun_kode)}</td>
                <td className="py-2 pr-3 text-stone-600">{b.keterangan || '—'}</td>
                <td className="py-2 pr-3 text-right">
                  {b.debit ? formatRp(b.debit) : ''}
                </td>
                <td className="py-2 text-right">
                  {b.kredit ? formatRp(b.kredit) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td colSpan={2} className="py-2 pr-3 text-right">
                Total:
              </td>
              <td className="py-2 pr-3 text-right">{formatRp(jurnal.total_debit)}</td>
              <td className="py-2 text-right">{formatRp(jurnal.total_debit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="mt-4 rounded-lg border border-stone-200 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 className="font-bold">Lampiran Bukti</h4>
            <p className="text-helper text-stone-600">
              Foto JPG/JPEG/PNG/WEBP atau PDF, maksimal 10 MB.
            </p>
          </div>
          <Button
            variant="ghost"
            disabled={busyLampiran}
            onClick={() => void unggahLampiran()}
          >
            {busyLampiran ? 'Memproses…' : 'Unggah Lampiran'}
          </Button>
        </div>

        <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Lampiran disimpan di folder aplikasi dan <b>TIDAK ikut file backup .db</b>.
          Simpan file asli di tempat aman.
        </p>

        {errLampiran && (
          <div className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errLampiran}
          </div>
        )}
        {infoLampiran && (
          <div className="mt-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
            {infoLampiran}
          </div>
        )}

        {!lampiran && !errLampiran && (
          <p className="mt-2 text-sm text-stone-500">Memuat lampiran…</p>
        )}
        {lampiran && lampiran.length === 0 && !errLampiran && (
          <p className="mt-2 text-sm text-stone-500">Belum ada lampiran bukti.</p>
        )}

        {lampiran && lampiran.length > 0 && (
          <ul className="mt-2 divide-y divide-stone-200">
            {lampiran.map((l) => (
              <li
                key={l.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <div className="min-w-0">
                  <p className="break-all text-[15px] font-medium">{l.nama_asli}</p>
                  <p className="text-helper text-stone-500">
                    {formatUkuranFile(l.ukuran)} · diunggah{' '}
                    {formatTanggal(l.created_at.slice(0, 10))}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {l.mime.startsWith('image/') && (
                    <Button variant="ghost" onClick={() => void lihatLampiran(l)}>
                      Lihat
                    </Button>
                  )}
                  <Button variant="ghost" onClick={() => void bukaLampiran(l)}>
                    Buka
                  </Button>
                  <Button
                    variant="ghost"
                    className="text-red-700"
                    disabled={busyLampiran}
                    onClick={() => setHapusTarget(l)}
                  >
                    Hapus
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {children}
        {onDuplikat && (
          <Button variant="ghost" onClick={() => onDuplikat(jurnal)}>
            Duplikat
          </Button>
        )}
        {onPrint && (
          <Button variant="ghost" onClick={() => onPrint(jurnal)}>
            Pratinjau Cetak
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          Tutup
        </Button>
      </div>

      {preview && (
        <Modal
          judul={`Pratinjau: ${preview.namaAsli}`}
          onTutup={() => setPreview(null)}
          lebar="3xl"
        >
          <img
            src={preview.dataUrl}
            alt={preview.namaAsli}
            className="mx-auto max-h-[75vh] w-auto max-w-full"
          />
          <div className="mt-3 flex justify-end">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Tutup
            </Button>
          </div>
        </Modal>
      )}

      {hapusTarget && (
        <Modal
          judul="Hapus lampiran?"
          onTutup={() => setHapusTarget(null)}
          sibuk={busyLampiran}
          lebar="md"
        >
          <div className="space-y-2 text-[15px] text-stone-700">
            <p>
              File <b>{hapusTarget.nama_asli}</b> akan dihapus dari folder aplikasi
              beserta metadatanya.
            </p>
            <p className="text-sm text-stone-600">
              Jurnal tidak berubah. Tindakan ini tercatat di riwayat audit.
            </p>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              variant="ghost"
              disabled={busyLampiran}
              onClick={() => setHapusTarget(null)}
            >
              Batal
            </Button>
            <Button
              variant="danger"
              disabled={busyLampiran}
              onClick={() => void konfirmasiHapus()}
            >
              {busyLampiran ? 'Memproses…' : 'Ya, hapus lampiran'}
            </Button>
          </div>
        </Modal>
      )}
    </Modal>
  );
}
