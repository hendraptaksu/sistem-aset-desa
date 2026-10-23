import { useState } from 'react';
import type ExcelJS from 'exceljs';
import {
  renderPrintDocument,
  type PrintDoc,
  type PrintOrientation,
} from '../../features/export/printDoc.js';
import { workbookToBuffer } from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Button, ErrorBox } from './ui.js';
import { PratinjauCetakModal } from './PratinjauCetakModal.js';

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

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
  buatWorkbook: () => Promise<ExcelJS.Workbook>;
  /** Dokumen cetak P1-16 (model yang sama untuk pratinjau & PDF). */
  buatDokumen: () => PrintDoc | Promise<PrintDoc>;
  tampilkanPrint?: boolean;
}) {
  const [sibuk, setSibuk] = useState<null | 'excel' | 'pdf' | 'print'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pratinjau, setPratinjau] = useState<Pratinjau | null>(null);
  const nonaktif = disabled || sibuk !== null;

  async function exportExcel(): Promise<void> {
    if (nonaktif) return;
    setErr(null);
    setInfo(null);
    setSibuk('excel');
    try {
      const wb = await buatWorkbook();
      const buf = await workbookToBuffer(wb);
      const hasil = await api.saveBuffer({
        bufferB64: u8ToB64(buf),
        defaultName: `${namaDasar}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      setInfo(hasil.saved ? `Tersimpan: ${hasil.path}` : 'Penyimpanan dibatalkan.');
    } catch (e) {
      setErr(`Gagal membuat file Excel. ${pesanError(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function siapkanCetak(): Promise<Pratinjau> {
    const doc = await buatDokumen();
    return renderPrintDocument(doc);
  }

  async function simpanPdf(): Promise<void> {
    if (nonaktif) return;
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
      setInfo(hasil.saved ? `Tersimpan: ${hasil.path}` : 'Penyimpanan dibatalkan.');
    } catch (e) {
      setErr(`Gagal menyiapkan dokumen PDF. ${pesanError(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function bukaPratinjau(): Promise<void> {
    if (nonaktif) return;
    setErr(null);
    setInfo(null);
    setSibuk('print');
    try {
      setPratinjau(await siapkanCetak());
    } catch (e) {
      setErr(`Gagal membuat pratinjau cetak. ${pesanError(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={nonaktif} onClick={() => void exportExcel()}>
          {sibuk === 'excel' ? 'Menyiapkan Excel…' : 'Export Excel'}
        </Button>
        <Button variant="ghost" disabled={nonaktif} onClick={() => void simpanPdf()}>
          {sibuk === 'pdf' ? 'Menyiapkan PDF…' : 'Simpan PDF'}
        </Button>
        {tampilkanPrint && (
          <Button variant="ghost" disabled={nonaktif} onClick={() => void bukaPratinjau()}>
            {sibuk === 'print' ? 'Menyiapkan pratinjau…' : 'Pratinjau Cetak'}
          </Button>
        )}
      </div>
      {info && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          {info}
        </div>
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
