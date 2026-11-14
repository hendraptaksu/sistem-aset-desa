// AUD-34 — error boundary renderer.
//
// Kesalahan render/lifecycle React tidak boleh meninggalkan layar kosong.
// Fallback menampilkan pesan ramah + tombol "Muat ulang"; detail teknis hanya
// masuk console (dan diredaksi agar PIN/hash tidak bocor ke log).

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './ui.js';
import { deskripsiError, redaksiLog, satuBaris } from '../../utils/logAman.js';

export const PESAN_ERROR_RENDERER =
  'Terjadi kesalahan tak terduga saat menampilkan halaman. Data yang sudah tersimpan tetap aman. Muat ulang aplikasi untuk melanjutkan.';

/** Bangun pesan console yang aman (satu baris, tanpa nilai sensitif). */
export function pesanErrorRenderer(
  error: unknown,
  componentStack?: string | null,
): string {
  const bagian = [`[renderer] error tak tertangani: ${deskripsiError(error)}`];
  const komponen = satuBaris(componentStack ?? '');
  if (komponen) bagian.push(`komponen: ${komponen}`);
  return redaksiLog(satuBaris(bagian.join(' | ')));
}

/** UI-A22: waktu kejadian gaya Indonesia, mis. '15/11/2026 14.30.05'. */
export function formatWaktuKejadian(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return (
    `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ` +
    `${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`
  );
}

/** Tampilan fallback yang juga dipakai test komponen (tanpa DOM). */
export function TampilanError({
  onMuatUlang,
  waktu,
}: {
  onMuatUlang: () => void;
  /** UI-A22: waktu kejadian dari ErrorBoundary; bila kosong, diambil saat render. */
  waktu?: string;
}) {
  const waktuTampil = waktu ?? formatWaktuKejadian(new Date());
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-stone-50 p-4 text-stone-900"
    >
      <div className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-700">
          <AlertTriangle size={24} />
        </div>
        <h1 className="text-lg font-bold">Tampilan bermasalah</h1>
        <p className="mt-2 text-[15px] text-stone-600">{PESAN_ERROR_RENDERER}</p>
        <p className="mt-2 text-sm text-stone-500">
          Bila masalah berulang, hubungi pendamping dan sebutkan waktu kejadian:{' '}
          <b className="text-stone-700">{waktuTampil}</b>.
        </p>
        <Button type="button" className="mt-5" onClick={onMuatUlang}>
          Muat ulang
        </Button>
      </div>
    </div>
  );
}

type Props = { children: ReactNode };
type State = { error: Error | null; waktu: string | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, waktu: null };

  static getDerivedStateFromError(error: unknown): State {
    // UI-A22: catat waktu saat error ditangkap agar operator bisa melaporkannya.
    return {
      error: error instanceof Error ? error : new Error(String(error)),
      waktu: formatWaktuKejadian(new Date()),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Console renderer adalah jejak yang tersedia tanpa menambah IPC baru.
    console.error(pesanErrorRenderer(error, info.componentStack));
  }

  private muatUlang = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <TampilanError
          onMuatUlang={this.muatUlang}
          waktu={this.state.waktu ?? undefined}
        />
      );
    }
    return this.props.children;
  }
}
