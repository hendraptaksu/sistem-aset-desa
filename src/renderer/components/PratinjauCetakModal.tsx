import { useRef, useState } from 'react';
import type { PrintOrientation } from '../../features/export/printDoc.js';
import { infoPratinjauCetak } from '../../features/export/printDoc.js';
import { Badge, Button, ErrorBox } from './ui.js';

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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-3">
      <div className="flex h-[94vh] w-full max-w-6xl flex-col rounded-xl bg-white p-4 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-3">
          <div>
            <h3 className="text-lg font-bold">Pratinjau Cetak — {judul}</h3>
            <p className="mt-1 text-sm text-stone-600">
              Periksa dulu kop, periode, dan halaman. Dialog printer baru terbuka
              setelah tombol <b>Cetak</b> ditekan.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">{infoPratinjauCetak(jumlahHalaman, orientasi)}</Badge>
            <Badge tone="stone">
              {orientasi === 'landscape' ? 'A4 Landscape' : 'A4 Portrait'}
            </Badge>
          </div>
        </div>

        <div className="mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-stone-300 bg-stone-100">
          <iframe
            ref={iframeRef}
            title={`Pratinjau cetak ${judul}`}
            srcDoc={html}
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
