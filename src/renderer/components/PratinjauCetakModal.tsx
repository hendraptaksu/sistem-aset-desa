import { useRef, useState } from 'react';
import type { PrintOrientation } from '../../features/export/printDoc.js';
import { infoPratinjauCetak } from '../../features/export/printDoc.js';
import { Badge, Button, ErrorBox, Modal } from './ui.js';

/**
 * Pratinjau cetak P1-16. Dokumen dirender di iframe `srcDoc`; dialog cetak
 * baru dibuka saat tombol "Cetak" ditekan dari React (parent), BUKAN otomatis.
 * Tidak ada inline script di dokumen cetak, sehingga aman terhadap CSP P1-15.
 */
export function PratinjauCetakModal({
  judul,
  html,
  jumlahHalaman,
  orientasi,
  onClose,
}: {
  judul: string;
  html: string;
  jumlahHalaman: number;
  orientasi: PrintOrientation;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [err, setErr] = useState<string | null>(null);

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
          Periksa dulu kop, periode, dan halaman. Dialog printer baru terbuka
          setelah tombol <b>Cetak</b> ditekan.
        </>
      }
      onTutup={onClose}
      maxWidth="72rem"
      className="flex h-[92vh] flex-col"
      isiClassName="flex min-h-0 flex-1 flex-col"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="green">{infoPratinjauCetak(jumlahHalaman, orientasi)}</Badge>
        <Badge tone="stone">
          {orientasi === 'landscape' ? 'A4 Landscape' : 'A4 Portrait'}
        </Badge>
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
