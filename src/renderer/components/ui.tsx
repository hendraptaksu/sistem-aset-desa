import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { parseRupiahToSen } from '../../utils/format.js';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-xl border bg-white p-5 shadow-sm', className)}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-600">{label}</span>
      {children}
    </label>
  );
}

/** UI-19: indikator fokus keyboard yang sama untuk kontrol terang. */
export const RING_FOKUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2';

/** UI-19: varian untuk sidebar gelap agar ring tetap terlihat. */
export const RING_FOKUS_GELAP =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-950';

const inputCls = `w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px] focus:border-emerald-600 focus:outline-none ${RING_FOKUS}`;

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={clsx(inputCls, 'min-h-[4.5rem]', props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputCls, props.className)} />;
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'danger-outline';
}) {
  return (
    <button
      {...props}
      className={clsx(
        'rounded-lg px-4 py-2 text-[15px] font-semibold whitespace-nowrap disabled:opacity-50',
        RING_FOKUS,
        variant === 'primary' && 'bg-emerald-700 text-white hover:bg-emerald-800',
        variant === 'ghost' && 'border border-stone-300 bg-white hover:bg-stone-100',
        variant === 'danger' && 'bg-red-700 text-white hover:bg-red-800',
        variant === 'danger-outline' &&
          'border border-red-300 bg-white text-red-800 hover:bg-red-50',
        props.className,
      )}
    >
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = 'stone',
}: {
  children: ReactNode;
  tone?: 'stone' | 'green' | 'amber' | 'red';
}) {
  const tones: Record<string, string> = {
    stone: 'bg-stone-100 text-stone-700',
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
  };
  return <span className={clsx('rounded-full px-2.5 py-0.5 text-sm font-semibold', tones[tone])}>{children}</span>;
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div
      role="alert"
      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800"
    >
      {msg}
    </div>
  );
}

/** Input PIN 6 kotak ala m-banking. Keyboard fisik: ketik maju otomatis,
 * Backspace mundur/hapus, paste 6 digit langsung terisi. Nilai berupa
 * string digit; `onComplete` dipanggil sekali saat lengkap. */
export function PinInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = true,
  invalid = false,
  invalidKey = 0,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  invalid?: boolean;
  invalidKey?: number;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Setelah gagal (value dikosongkan parent), fokus kembali ke kotak pertama.
  useEffect(() => {
    if (value === '' && !disabled) refs.current[0]?.focus();
  }, [value, disabled, invalidKey]);

  const lengkap = (v: string): boolean => new RegExp(`^\\d{${length}}$`).test(v);

  function isiPada(index: number, digit: string): void {
    const next = [...digits];
    next[index] = digit;
    const gabung = next.join('').slice(0, length);
    onChange(gabung);
    if (lengkap(gabung)) {
      refs.current[index]?.blur();
      onComplete?.(gabung);
    } else if (index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  function hapusPada(index: number): void {
    const next = [...digits];
    next[index] = '';
    onChange(next.join('').slice(0, length));
  }

  return (
    <div key={invalidKey} className={clsx('flex justify-center gap-2', invalid && 'animate-pin-shake')}>
      {digits.map((d, i) => (
        <input
          // eslint-disable-next-line no-return-assign
          key={i} ref={(el) => { refs.current[i] = el; }}
          type="password"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          disabled={disabled}
          value={d}
          aria-label={`Digit PIN ke-${i + 1}`}
          onFocus={(e) => e.target.select()}
          onChange={(e) => {
            const digit = e.target.value.replace(/\D/g, '').slice(-1);
            if (!digit) return;
            isiPada(i, digit);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              if (digits[i]) {
                hapusPada(i);
              } else if (i > 0) {
                refs.current[i - 1]?.focus();
                hapusPada(i - 1);
              }
            } else if (e.key === 'Delete') {
              e.preventDefault();
              hapusPada(i);
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              refs.current[i - 1]?.focus();
            } else if (e.key === 'ArrowRight') {
              e.preventDefault();
              refs.current[i + 1]?.focus();
            }
          }}
          onPaste={(e) => {
            const tempel = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
            if (!tempel) return;
            e.preventDefault();
            onChange(tempel);
            if (lengkap(tempel)) {
              refs.current[length - 1]?.blur();
              onComplete?.(tempel);
            } else {
              refs.current[tempel.length]?.focus();
            }
          }}
          className={clsx(
            'h-12 w-11 rounded-lg border bg-white text-center text-xl font-bold',
            'focus:border-emerald-600 focus:outline-none',
            RING_FOKUS,
            invalid ? 'border-red-400' : 'border-stone-300',
            disabled && 'opacity-60',
          )}
        />
      ))}
    </div>
  );
}

/** Input Rupiah: tampil grouping Indonesia, state berupa SEN (integer).
 * Desimal opsional — ketik '1500' jadi Rp 1.500,00; '1500,50' jadi Rp 1.500,50. */
export function CurrencyInput({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  const [teks, setTeks] = useState<string | null>(null);
  const [fokus, setFokus] = useState(false);
  // Perubahan value dari luar (cth. reset form setelah submit) tersinkron saat blur.
  useEffect(() => {
    if (!fokus) setTeks(null);
  }, [value, fokus]);
  const shown = fokus && teks !== null ? teks : value === 0 ? '' : formatSenInput(value);
  return (
    <TextInput
      inputMode="decimal"
      placeholder="0"
      disabled={disabled}
      value={shown}
      onFocus={() => {
        setFokus(true);
        setTeks(value === 0 ? '' : formatSenInput(value));
      }}
      onBlur={() => {
        setFokus(false);
        setTeks(null);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setTeks(v);
        try {
          onChange(parseRupiahToSen(v));
        } catch {
          /* abaikan state ketik antara (cth. '1,') */
        }
      }}
    />
  );
}

/** SEN → teks input: '1.500' bila bulat, '1.500,50' bila pecahan. */
function formatSenInput(sen: number): string {
  const neg = sen < 0 ? '-' : '';
  const abs = Math.abs(sen);
  const rupiah = Math.floor(abs / 100);
  const sisa = abs % 100;
  const grup = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(rupiah);
  return sisa === 0 ? `${neg}${grup}` : `${neg}${grup},${String(sisa).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Modal bersama (UI-09)
//
// Fokus dikelola lewat tumpukan module-level, bukan listener per komponen:
// hanya modal teratas yang menerima Escape/Tab. Modal baru dirender lewat
// portal agar tidak terpotong area scroll konten dan selalu berada di atas
// header aplikasi (minimal z-40).
// ---------------------------------------------------------------------------

const SELEKTOR_FOKUS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(',');

function elemenFokusable(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(SELEKTOR_FOKUS)).filter((el) => {
    if (el.hasAttribute('disabled') || el.closest('[inert]')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const gaya = window.getComputedStyle(el);
    return (
      gaya.display !== 'none' &&
      gaya.visibility !== 'hidden' &&
      el.getClientRects().length > 0
    );
  });
}

type EntriModal = {
  dialog: HTMLElement;
  sibuk: () => boolean;
  tutup: () => void;
};

const tumpukanModal: EntriModal[] = [];
let pendengarModalTerpasang = false;
/** Elemen terakhir yang benar-benar menerima fokus; dipakai bila pemicu
 * menjadi disabled/body saat modal dibuka dari proses async. */
let fokusTerakhir: HTMLElement | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener(
    'focusin',
    (e) => {
      if (e.target instanceof HTMLElement && e.target !== document.body) {
        fokusTerakhir = e.target;
      }
    },
    true,
  );
}

function tanganiTombolModal(e: KeyboardEvent): void {
  const atas = tumpukanModal[tumpukanModal.length - 1];
  if (!atas || !atas.dialog.isConnected) return;

  if (e.key === 'Escape') {
    // Jangan biarkan handler di latar ikut menutup sesuatu saat modal aktif.
    e.stopPropagation();
    if (atas.sibuk()) return;
    e.preventDefault();
    atas.tutup();
    return;
  }

  if (e.key !== 'Tab') return;
  const fokusable = elemenFokusable(atas.dialog);
  if (fokusable.length === 0) {
    e.preventDefault();
    atas.dialog.focus({ preventScroll: true });
    return;
  }

  const pertama = fokusable[0]!;
  const terakhir = fokusable[fokusable.length - 1]!;
  const aktif = document.activeElement;
  const diDalam = aktif instanceof Node && atas.dialog.contains(aktif);

  if (e.shiftKey) {
    if (!diDalam || aktif === pertama) {
      e.preventDefault();
      terakhir.focus({ preventScroll: true });
    }
  } else if (!diDalam || aktif === terakhir) {
    e.preventDefault();
    pertama.focus({ preventScroll: true });
  }
}

/** Cegah fokus programatik/klik latar keluar dari modal teratas. */
function tanganiFokusModal(e: FocusEvent): void {
  const atas = tumpukanModal[tumpukanModal.length - 1];
  if (!atas || !atas.dialog.isConnected) return;
  if (e.target instanceof Node && atas.dialog.contains(e.target)) return;
  const fokusable = elemenFokusable(atas.dialog);
  (fokusable[0] ?? atas.dialog).focus({ preventScroll: true });
}

function pastikanPendengarModal(): void {
  if (pendengarModalTerpasang) return;
  pendengarModalTerpasang = true;
  document.addEventListener('keydown', tanganiTombolModal, true);
  document.addEventListener('focusin', tanganiFokusModal, true);
}

const LEBAR_MODAL = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
} as const;

const KedalamanModal = createContext(0);

export type ModalProps = {
  /** Judul terlihat; juga menjadi nama aksesibel dialog. */
  judul: ReactNode;
  /** Penjelasan singkat di bawah judul (opsional). */
  deskripsi?: ReactNode;
  onTutup: () => void;
  /** Saat sibuk, Escape/backdrop/tombol X tidak menutup modal. */
  sibuk?: boolean;
  children: ReactNode;
  className?: string;
  /** Kelas untuk area isi di bawah judul, mis. agar iframe bisa flex-1. */
  isiClassName?: string;
  /** Lebar panel standar; abaikan bila `maxWidth` diisi. */
  lebar?: keyof typeof LEBAR_MODAL;
  /** Nilai CSS max-width khusus, mis. '42rem'. */
  maxWidth?: string;
};

export function Modal({
  judul,
  deskripsi,
  onTutup,
  sibuk = false,
  children,
  className,
  isiClassName,
  lebar = 'lg',
  maxWidth,
}: ModalProps) {
  const idDasar = useId();
  const idJudul = `${idDasar}-judul`;
  const idDeskripsi = `${idDasar}-deskripsi`;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  /** Diambil saat render pertama, sebelum autoFocus/commit memindahkan fokus. */
  const pemicuRef = useRef<HTMLElement | null | undefined>(undefined);
  const sibukRef = useRef(sibuk);
  const tutupRef = useRef(onTutup);
  const kedalaman = useContext(KedalamanModal);

  sibukRef.current = sibuk;
  tutupRef.current = onTutup;

  if (pemicuRef.current === undefined && typeof document !== 'undefined') {
    const aktif = document.activeElement;
    const kandidat =
      aktif instanceof HTMLElement && aktif !== document.body
        ? aktif
        : fokusTerakhir;
    pemicuRef.current = kandidat?.isConnected ? kandidat : null;
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Nilai pemicu sudah diambil saat render; autoFocus di dalam dialog bisa
    // lebih dulu memindahkan fokus sebelum effect berjalan.

    const entri: EntriModal = {
      dialog,
      sibuk: () => sibukRef.current,
      tutup: () => tutupRef.current(),
    };
    tumpukanModal.push(entri);
    pastikanPendengarModal();

    const fokusable = elemenFokusable(dialog);
    const fokusAwal =
      fokusable.find((el) => el.hasAttribute('autofocus')) ??
      fokusable.find((el) => el.matches('input, select, textarea')) ??
      fokusable[0] ??
      dialog;
    fokusAwal.focus({ preventScroll: true });

    return () => {
      const indeks = tumpukanModal.indexOf(entri);
      const teratas = indeks === tumpukanModal.length - 1;
      if (indeks >= 0) tumpukanModal.splice(indeks, 1);
      // Modal yang ditutup di bawah modal lain tidak boleh merebut fokus.
      if (!teratas) return;
      const pemicu = pemicuRef.current;
      if (!pemicu?.isConnected) return;
      const aktif = document.activeElement;
      const fokusMasihDiModal =
        aktif === null ||
        aktif === document.body ||
        !dialog.isConnected ||
        dialog.contains(aktif);
      if (fokusMasihDiModal) pemicu.focus({ preventScroll: true });
    };
    // Cukup sekali saat modal terpasang. Nilai sibuk/onTutup dibaca lewat ref
    // agar perubahan props tidak memasang ulang tumpukan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isi = (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: 40 + Math.min(kedalaman, 10) }}
      onClick={(e) => {
        if (e.target !== e.currentTarget || sibuk) return;
        onTutup();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idJudul}
        {...(deskripsi ? { 'aria-describedby': idDeskripsi } : {})}
        tabIndex={-1}
        data-modal="true"
        className={clsx(
          'max-h-[92vh] w-full overflow-y-auto rounded-xl bg-white p-5 shadow-xl outline-none',
          maxWidth ? undefined : LEBAR_MODAL[lebar],
          className,
        )}
        style={maxWidth ? { maxWidth } : undefined}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={idJudul} className="break-words text-lg font-bold">
              {judul}
            </h2>
            {deskripsi && (
              <div id={idDeskripsi} className="mt-1 text-sm text-stone-600">
                {deskripsi}
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Tutup dialog"
            title="Tutup dialog"
            disabled={sibuk}
            onClick={onTutup}
            className={`-m-1 shrink-0 rounded-lg p-1.5 text-xl leading-none text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-40 ${RING_FOKUS}`}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        <div className={clsx('mt-3', isiClassName)}>
          <KedalamanModal.Provider value={kedalaman + 1}>{children}</KedalamanModal.Provider>
        </div>
      </div>
    </div>
  );

  // renderToStaticMarkup tidak punya document; tetap tampilkan markup agar
  // kontrak modal (judul, field, tombol) bisa diuji tanpa DOM.
  if (typeof document === 'undefined') return isi;
  return createPortal(isi, document.body);
}

/** Modal alasan untuk periode terkunci (kunci longgar). */
export function LockModal({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (alasan: string) => void;
}) {
  let alasan = '';
  return (
    <Modal
      judul="Periode sudah ditutup"
      deskripsi="Tanggal ini masuk tahun yang sudah tutup buku. Boleh tetap simpan, tapi wajib isi alasan — tercatat otomatis."
      onTutup={onCancel}
      lebar="md"
    >
      <Field label="Alasan (min. 5 karakter)">
        <TextInput
          autoFocus
          onChange={(e) => (alasan = e.target.value)}
          placeholder="cth: koreksi struk susulan Desember"
        />
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Batal</Button>
        <Button onClick={() => alasan.trim().length >= 5 && onSubmit(alasan.trim())}>Tetap simpan</Button>
      </div>
    </Modal>
  );
}

/**
 * Konfirmasi aksi besar (tutup buku, restore, koreksi, hapus).
 *
 * Memakai Modal bersama sehingga berada di atas modal lain dan memakai bahasa
 * operator awam: judul singkat, akibat aksi, lalu tombol Batal / Ya, lanjutkan.
 */
export function KonfirmasiModal({
  judul,
  deskripsi,
  labelYa = 'Ya, lanjutkan',
  labelBatal = 'Batal',
  variant = 'danger',
  sibuk = false,
  onBatal,
  onKonfirmasi,
}: {
  judul: string;
  deskripsi: ReactNode;
  labelYa?: string;
  labelBatal?: string;
  variant?: 'primary' | 'danger';
  sibuk?: boolean;
  onBatal: () => void;
  onKonfirmasi: () => void;
}) {
  return (
    <Modal
      judul={judul}
      deskripsi={<div className="space-y-2 text-[15px] text-stone-700">{deskripsi}</div>}
      onTutup={onBatal}
      sibuk={sibuk}
      lebar="md"
    >
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={sibuk} onClick={onBatal}>
          {labelBatal}
        </Button>
        <Button variant={variant} disabled={sibuk} onClick={onKonfirmasi}>
          {sibuk ? 'Memproses…' : labelYa}
        </Button>
      </div>
    </Modal>
  );
}

/** Modal baca-saja generik (dipakai popup detail koreksi). */
export function DetailModal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Modal judul={title} onTutup={onClose} lebar="2xl">
      <div className="space-y-1.5 text-[15px]">{children}</div>
      <div className="mt-4 flex justify-end">
        <Button variant="ghost" onClick={onClose}>Tutup</Button>
      </div>
    </Modal>
  );
}
