import { useState } from 'react';
import type ExcelJS from 'exceljs';
import {
  printLaporan,
  workbookToBuffer,
  wrapPrintDocument,
} from '../../features/export/workbooks.js';
import { api, strToB64, u8ToB64 } from '../lib/api.js';
import { Button, ErrorBox } from './ui.js';

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Tombol export bersama untuk semua layar laporan (P1-10).
 * Renderer hanya membangun workbook/HTML; penyimpanan file tetap di main
 * lewat `file:save-buffer` / `file:save-pdf` (tidak ada akses fs di renderer).
 */
export function ExportActions({
  namaDasar,
  judul,
  disabled = false,
  buatWorkbook,
  buatHtml,
  tampilkanPrint = true,
}: {
  /** Nama file tanpa ekstensi; sebaiknya sudah memuat periode/cut-off. */
  namaDasar: string;
  /** Judul dokumen untuk HTML/PDF. */
  judul: string;
  /** Data kosong / belum siap → semua tombol nonaktif. */
  disabled?: boolean;
  buatWorkbook: () => Promise<ExcelJS.Workbook>;
  buatHtml: () => string | Promise<string>;
  tampilkanPrint?: boolean;
}) {
  const [sibuk, setSibuk] = useState<null | 'excel' | 'pdf' | 'print'>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
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

  async function simpanPdf(): Promise<void> {
    if (nonaktif) return;
    setErr(null);
    setInfo(null);
    setSibuk('pdf');
    try {
      const html = await buatHtml();
      const dokumen = wrapPrintDocument(judul, html, { autoPrint: false });
      const hasil = await api.savePdf({
        htmlB64: strToB64(dokumen),
        defaultName: `${namaDasar}.pdf`,
      });
      setInfo(hasil.saved ? `Tersimpan: ${hasil.path}` : 'Penyimpanan dibatalkan.');
    } catch (e) {
      setErr(`Gagal menyimpan PDF. ${pesanError(e)}`);
    } finally {
      setSibuk(null);
    }
  }

  async function cetak(): Promise<void> {
    if (nonaktif) return;
    setErr(null);
    setInfo(null);
    setSibuk('print');
    try {
      printLaporan(judul, await buatHtml());
    } catch (e) {
      setErr(`Gagal membuka jendela cetak. ${pesanError(e)}`);
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
          <Button variant="ghost" disabled={nonaktif} onClick={() => void cetak()}>
            Print
          </Button>
        )}
      </div>
      {info && (
        <div className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          {info}
        </div>
      )}
      <ErrorBox msg={err} />
    </div>
  );
}
