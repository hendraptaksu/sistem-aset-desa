import { useMemo, useRef, useState } from 'react';
import { wrapPrintDocument } from '../../features/export/workbooks.js';
import { Badge, Button, ErrorBox, Modal } from './ui.js';

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
    <Modal
      judul={`Pratinjau Cetak — ${judul}`}
      deskripsi={
        <>
          Periksa dulu isi dan halaman. Dialog printer baru terbuka setelah
          tombol <b>Cetak</b> ditekan.
        </>
      }
      onTutup={onClose}
      maxWidth="72rem"
      className="flex h-[92vh] flex-col"
      isiClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
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
          tabIndex={-1}
          onLoad={(e) => {
            // Fokus bisa masuk ke dokumen iframe lewat klik; teruskan Escape
            // ke modal induk agar dialog tetap bisa ditutup dari keyboard.
            e.currentTarget.contentDocument?.addEventListener('keydown', (ev) => {
              if (ev.key !== 'Escape') return;
              ev.preventDefault();
              onClose();
            });
          }}
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
    </Modal>
  );
}
