import { useMemo, useRef, useState } from 'react';
import { wrapPrintDocument } from '../../features/export/workbooks.js';
import { Badge, Button, ErrorBox } from './ui.js';

/**
 * Pratinjau dokumen cetak lama (P1-15). Beberapa tab masih memakai body HTML
 * dari builder lama; body itu dibungkus `wrapPrintDocument(..., autoPrint:false)`
 * lalu ditampilkan di iframe `srcDoc` TANPA inline script / popup window.
 * Tombol Cetak memanggil `contentWindow.print()` dari React (parent).
 */
export function PratinjauHtmlModal({
  judul,
  body,
  onClose,
}: {
  judul: string;
  body: string;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const html = useMemo(
    () => wrapPrintDocument(judul, body, { autoPrint: false }),
    [judul, body],
  );

  function cetak(): void {
    const win = iframeRef.current?.contentWindow;
    if (!win) {
      setErr('Gagal membuka dialog cetak. Tutup pratinjau lalu coba lagi.');
      return;
    }
    try {
      setErr(null);
      win.focus();
      win.print();
    } catch {
      setErr('Gagal membuka dialog cetak. Periksa pengaturan printer lalu coba lagi.');
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-3">
      <div className="flex h-[94vh] w-full max-w-6xl flex-col rounded-xl bg-white p-4 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
          <div>
            <h3 className="text-lg font-bold">Pratinjau Cetak — {judul}</h3>
            <p className="mt-1 text-sm text-stone-600">
              Periksa dulu isi dan halaman. Dialog printer baru terbuka setelah
              tombol <b>Cetak</b> ditekan; halaman ini tidak menjalankan skrip
              otomatis dari dokumen.
            </p>
          </div>
          <Badge tone="stone">A4 Portrait</Badge>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-stone-300 bg-stone-100">
          {/* AUD-17: iframe disandbox. allow-same-origin agar parent bisa
              memanggil contentWindow.print(); allow-modals agar dialog cetak
              tidak diblokir. Script/form/popup tetap dinonaktifkan. */}
          <iframe
            ref={iframeRef}
            title={`Pratinjau cetak ${judul}`}
            srcDoc={html}
            sandbox="allow-same-origin allow-modals"
            className="h-full w-full bg-white"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <ErrorBox msg={err} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose}>
              Tutup
            </Button>
            <Button onClick={cetak}>Cetak</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
