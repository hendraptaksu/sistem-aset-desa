import { useRef, useState } from 'react';
import type ExcelJS from 'exceljs';
import {
  renderPrintDocument,
  type PrintDoc,
  type PrintOrientation,
} from '../../features/export/printDoc.js';
import { KOP_ORG_NAMA, workbookToBuffer } from '../../features/export/workbooks.js';
import { kopDariPengaturan, type KopOrganisasi } from '../../core/pengaturan.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Button, ErrorBox, InfoBox } from './ui.js';
import { PratinjauCetakModal } from './PratinjauCetakModal.js';
import { pesanError } from '../../utils/pesanError.js';


type Pratinjau = {
  html: string;
  jumlahHalaman: number;
  orientasi: PrintOrientation;
};

/**
 * Tombol export bersama untuk semua layar laporan (P1-10/P1-16).
 * Renderer hanya membangun workbook/HTML; penyimpanan file tetap di main
 * lewat `file:save-buffer` / `file:save-pdf` (tidak ada akses fs di renderer).
 * Tombol Print sekarang membuka PRATINJAU; PDF memakai HTML paginator yang sama.
 */
export function ExportActions({
  namaDasar,
  judul,
  disabled = false,
  alasanNonaktif,
  buatWorkbook,
  buatDokumen,
  tampilkanPrint = true,
}: {
  /** Nama file tanpa ekstensi; sebaiknya sudah memuat periode/cut-off. */
  namaDasar: string;
  /** Judul dokumen untuk pratinjau/PDF. */
  judul: string;
  /** Data kosong / belum siap → semua tombol nonaktif. */
  disabled?: boolean;
  /** UI-A10: alasan yang tampil saat tombol nonaktif (mis. laporan kosong). */
  alasanNonaktif?: string;
  /** Builder menerima kop dari pengaturan pembukuan (P1-13). */
  buatWorkbook: (kop: KopOrganisasi) => Promise<ExcelJS.Workbook>;
  /** Dokumen cetak P1-16 (model yang sama untuk pratinjau & PDF). */
  buatDokumen: (kop: KopOrganisasi) => PrintDoc | Promise<PrintDoc>;
  tampilkanPrint?: boolean;
}) {
  const [sibuk, setSibuk] = useState<null | 'excel' | 'pdf' | 'print'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<{ pesan: string; path: string | null } | null>(null);
  const [bukaSibuk, setBukaSibuk] = useState<null | 'file' | 'folder'>(null);
  const [pratinjau, setPratinjau] = useState<Pratinjau | null>(null);
  const busyRef = useRef(false);
  const nonaktif = disabled || sibuk !== null;

  /** Kop laporan dari pengaturan saat aksi dijalankan (fallback kop lama). */
  async function kopSaatIni(): Promise<KopOrganisasi> {
    try {
      return kopDariPengaturan(await api.pengaturanGet());
    } catch {
      return { nama: KOP_ORG_NAMA };
    }
  }

  async function exportExcel(): Promise<void> {
    if (nonaktif || busyRef.current) return;
    busyRef.current = true;
    setErr(null);
    setInfo(null);
    setSibuk('excel');
    try {
      const kop = await kopSaatIni();
      const wb = await buatWorkbook(kop);
      const buf = await workbookToBuffer(wb);
      const hasil = await api.saveBuffer({
        bufferB64: u8ToB64(buf),
        defaultName: `${namaDasar}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      setInfo(
        hasil.saved
          ? { pesan: `Tersimpan: ${hasil.path}`, path: hasil.path }
          : { pesan: 'Penyimpanan dibatalkan.', path: null },
      );
    } catch (e) {
      setErr(
        pesanError(
          e,
          'Gagal membuat file Excel. Coba lagi; bila tetap gagal, hubungi pendamping.',
        ),
      );
    } finally {
      busyRef.current = false;
      setSibuk(null);
    }
  }

  async function siapkanCetak(): Promise<Pratinjau> {
    const kop = await kopSaatIni();
    const doc = await buatDokumen(kop);
    const dokumen: PrintDoc = {
      ...doc,
      kop: doc.kop ?? kop.nama,
      ...(doc.kopTambahan !== undefined
        ? { kopTambahan: doc.kopTambahan }
        : kop.tambahan
          ? { kopTambahan: kop.tambahan }
          : {}),
    };
    return renderPrintDocument(dokumen);
  }

  async function simpanPdf(): Promise<void> {
    if (nonaktif || busyRef.current) return;
    busyRef.current = true;
    setErr(null);
    setInfo(null);
    setSibuk('pdf');
    try {
      const hasilCetak = await siapkanCetak();
      const hasil = await api.savePdf({
        htmlB64: strToB64(hasilCetak.html),
        defaultName: `${namaDasar}.pdf`,
        landscape: hasilCetak.orientasi === 'landscape',
      });
      setInfo(
        hasil.saved
          ? { pesan: `Tersimpan: ${hasil.path}`, path: hasil.path }
          : { pesan: 'Penyimpanan dibatalkan.', path: null },
      );
    } catch (e) {
      setErr(
        pesanError(
          e,
          'Gagal menyiapkan dokumen PDF. Coba lagi; bila tetap gagal, hubungi pendamping.',
        ),
      );
    } finally {
      busyRef.current = false;
      setSibuk(null);
    }
  }

  async function bukaPratinjau(): Promise<void> {
    if (nonaktif || busyRef.current) return;
    busyRef.current = true;
    setErr(null);
    setInfo(null);
    setSibuk('print');
    try {
      setPratinjau(await siapkanCetak());
    } catch (e) {
      setErr(
        pesanError(
          e,
          'Gagal membuat pratinjau cetak. Coba lagi; bila tetap gagal, hubungi pendamping.',
        ),
      );
    } finally {
      busyRef.current = false;
      setSibuk(null);
    }
  }

  /**
   * Buka hasil ekspor lewat main: `shell.openPath` (aplikasi bawaan) atau
   * `shell.showItemInFolder` (file manager). Keduanya lintas platform;
   * renderer tidak pernah menyentuh fs/shell langsung.
   */
  async function bukaHasil(jenis: 'file' | 'folder'): Promise<void> {
    if (!info?.path || bukaSibuk !== null) return;
    setErr(null);
    setBukaSibuk(jenis);
    try {
      if (jenis === 'file') await api.openExport(info.path);
      else await api.showExport(info.path);
    } catch (e) {
      setErr(
        pesanError(
          e,
          'File tidak bisa dibuka. Coba lagi; bila tetap gagal, hubungi pendamping.',
        ),
      );
    } finally {
      setBukaSibuk(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="ghost"
          disabled={nonaktif}
          title={nonaktif ? alasanNonaktif : undefined}
          onClick={() => void exportExcel()}
        >
          {sibuk === 'excel' ? 'Menyiapkan Excel…' : 'Ekspor Excel'}
        </Button>
        <Button
          variant="ghost"
          disabled={nonaktif}
          title={nonaktif ? alasanNonaktif : undefined}
          onClick={() => void simpanPdf()}
        >
          {sibuk === 'pdf' ? 'Menyiapkan PDF…' : 'Simpan PDF'}
        </Button>
        {tampilkanPrint && (
          <Button
            variant="ghost"
            disabled={nonaktif}
            title={nonaktif ? alasanNonaktif : undefined}
            onClick={() => void bukaPratinjau()}
          >
            {sibuk === 'print' ? 'Menyiapkan pratinjau…' : 'Pratinjau Cetak'}
          </Button>
        )}
      </div>
      {info && (
        <InfoBox className="text-sm">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="break-all">{info.pesan}</span>
            {info.path && (
              <>
                <Button
                  variant="ghost"
                  className="px-3 py-1"
                  disabled={bukaSibuk !== null}
                  onClick={() => void bukaHasil('file')}
                >
                  {bukaSibuk === 'file' ? 'Membuka…' : 'Buka file'}
                </Button>
                <Button
                  variant="ghost"
                  className="px-3 py-1"
                  disabled={bukaSibuk !== null}
                  onClick={() => void bukaHasil('folder')}
                >
                  {bukaSibuk === 'folder' ? 'Membuka…' : 'Tampilkan di folder'}
                </Button>
              </>
            )}
          </div>
        </InfoBox>
      )}
      <ErrorBox msg={err} />

      {pratinjau && (
        <PratinjauCetakModal
          judul={judul}
          html={pratinjau.html}
          jumlahHalaman={pratinjau.jumlahHalaman}
          orientasi={pratinjau.orientasi}
          onClose={() => setPratinjau(null)}
        />
      )}
    </div>
  );
}
