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
import {
  MIN_ALASAN_PERINGATAN,
  alasanPeringatanCukup,
  rapikanAlasanPeringatan,
} from '../lib/peringatan.js';

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

/**
 * UI-A10: penanda refresh laporan — data lama masih tampil tetapi hasil baru
 * sedang diambil. Dipasangkan dengan `aria-busy` + opacity pada area tabel di
 * tab laporan agar pembaca layar tahu isinya sedang diperbarui.
 */
export function BadgeMemperbarui({ aktif }: { aktif: boolean }) {
  if (!aktif) return null;
  return <Badge tone="amber">Memperbarui…</Badge>;
}

/**
 * T3.8: error harus diumumkan pembaca layar. `role="alert"` sudah implisit
 * assertive, tetapi `aria-live` ditulis eksplisit agar perilakunya tidak
 * bergantung pada dukungan AT terhadap role tersebut.
 */
export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800"
    >
      {msg}
    </div>
  );
}

/** T3.8: satu alasan baku saat aksi dinonaktifkan karena proses lain. */
export const ALASAN_SIBUK = 'Tunggu proses yang sedang berjalan selesai.';

/**
 * T3.8: alasan yang ditampilkan pada tombol nonaktif. Tombol berisiko tidak
 * boleh mati tanpa penjelasan; kembalikan `undefined` hanya bila aksi boleh.
 */
export function alasanTombolNonaktif(opsi: {
  sibuk?: boolean;
  alasan?: string | false | null;
}): string | undefined {
  if (opsi.sibuk) return ALASAN_SIBUK;
  if (typeof opsi.alasan === 'string' && opsi.alasan.trim()) {
    return opsi.alasan.trim();
  }
  return opsi.alasan === false ? 'Aksi ini belum bisa dipakai.' : undefined;
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

const rpInput = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });
// 13 digit rupiah ×100 masih bilangan aman.
// 20 = 13 digit + 4 titik ribuan + koma + 2 digit desimal.
const MAX_DIGIT_RUPIAH = 13;
const MAX_PANJANG_INPUT = 20;

/** Cari pemisah desimal pada teks nominal.
 * - Koma/titik diikuti 1–2 digit di akhir → desimal.
 * - Koma diikuti 3+ digit setelah titik ribuan → desimal tidak valid; potong 2 digit.
 * - Koma diikuti 3 digit tanpa titik ribuan → pemisah ribuan (paste `100,000`).
 * - Koma di akhir dipertahankan agar desimal bisa diketik bertahap. */
function cariDesimal(bersih: string): { index: number; frac: string } | null {
  if (bersih.endsWith(',')) {
    return { index: bersih.length - 1, frac: '' };
  }
  const pendek = /([.,])(\d{1,2})$/.exec(bersih);
  if (pendek) return { index: pendek.index, frac: pendek[2]! };
  const panjang = /([.,])(\d{3,})$/.exec(bersih);
  if (panjang) {
    const index = panjang.index;
    const sebelum = bersih.slice(0, index);
    // Desimal lebih dari 2 digit: pertahankan dua digit pertama.
    if (panjang[1] === ',' && sebelum.includes('.')) {
      return { index, frac: panjang[2]!.slice(0, 2) };
    }
    if (panjang[1] === '.' && sebelum.includes(',')) {
      return { index, frac: panjang[2]!.slice(0, 2) };
    }
  }
  return null;
}

/** Baca ketikan/paste CurrencyInput.
 * - '150000' → { tampil: '150.000', sen: 15_000_000 }
 * - '1.500,50' → { tampil: '1.500,50', sen: 150_050 }
 * - '100,000' → { tampil: '100.000', sen: 10_000_000 } (paste gaya AS)
 * - '1.500,505' → { tampil: '1.500,50', sen: 150_050 } (desimal >2 digit dipotong) */
export function parseCurrencyInput(teks: string): { tampil: string; sen: number } {
  const bersih = teks.replace(/[^\d.,]/g, '');
  if (bersih === '') return { tampil: '', sen: 0 };

  const desimal = cariDesimal(bersih);
  const intPart = desimal ? bersih.slice(0, desimal.index) : bersih;
  const frac = desimal?.frac ?? '';
  const digit = intPart.replace(/\D/g, '').slice(0, MAX_DIGIT_RUPIAH);
  if (digit === '') return { tampil: '', sen: 0 };

  const rupiah = Number(digit);
  const sen = rupiah * 100 + Number((frac + '00').slice(0, 2));
  const tampil = desimal ? `${rpInput.format(rupiah)},${frac}` : rpInput.format(rupiah);
  return { tampil, sen };
}

/** Input Rupiah: tampil grouping Indonesia, state berupa SEN (integer).
 * Mendukung nominal bulat maupun pecahan sen: mengetik '1.500,50' →
 * onChange(150050). */
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
  const terakhirDikirim = useRef(value);
  // Sinkronkan value dari luar: saat blur (reset form) maupun saat fokus
  // (mis. parent mengoreksi nominal), tanpa menimpa ketikan sendiri.
  useEffect(() => {
    if (!fokus) {
      setTeks(null);
      terakhirDikirim.current = value;
      return;
    }
    if (value !== terakhirDikirim.current) {
      terakhirDikirim.current = value;
      setTeks(value === 0 ? '' : formatSenInput(value));
    }
  }, [value, fokus]);
  const shown = fokus && teks !== null ? teks : value === 0 ? '' : formatSenInput(value);
  return (
    <TextInput
      inputMode="numeric"
      placeholder="0"
      maxLength={MAX_PANJANG_INPUT}
      disabled={disabled}
      value={shown}
      onFocus={() => {
        setFokus(true);
        setTeks(value === 0 ? '' : formatSenInput(value));
        terakhirDikirim.current = value;
      }}
      onBlur={() => {
        setFokus(false);
        setTeks(null);
        terakhirDikirim.current = value;
      }}
      onChange={(e) => {
        const { tampil, sen } = parseCurrencyInput(e.target.value);
        setTeks(tampil);
        terakhirDikirim.current = sen;
        onChange(sen);
      }}
    />
  );
}

/** SEN → teks input saat tidak fokus: '1.500' bila bulat, '1.500,50' bila pecahan. */
function formatSenInput(sen: number): string {
  const neg = sen < 0 ? '-' : '';
  const abs = Math.abs(sen);
  const rupiah = Math.floor(abs / 100);
  const sisa = abs % 100;
  const grup = rpInput.format(rupiah);
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

/**
 * T3.8: prioritas fokus awal modal. Penanda `data-fokus-awal` menang (dipakai
 * tombol Batal pada konfirmasi berisiko), lalu elemen ber-`autoFocus`, field
 * isian, kontrol pertama, dan dialog itu sendiri sebagai cadangan.
 */
export function pilihFokusAwal<
  T extends { hasAttribute(nama: string): boolean; matches(selektor: string): boolean },
>(fokusable: readonly T[], dialog: T): T {
  return (
    fokusable.find((el) => el.hasAttribute('data-fokus-awal')) ??
    fokusable.find((el) => el.hasAttribute('autofocus')) ??
    fokusable.find((el) => el.matches('input, select, textarea')) ??
    fokusable[0] ??
    dialog
  );
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
    const fokusAwal = pilihFokusAwal(fokusable, dialog);
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
        aria-busy={sibuk || undefined}
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
            title={sibuk ? 'Tunggu proses selesai sebelum menutup' : 'Tutup dialog'}
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
  // State React, bukan variabel biasa: re-render parent saat modal terbuka
  // tidak lagi mengosongkan alasan (closure lama menangkap nilai awal).
  const [alasan, setAlasan] = useState('');
  const cukup = alasan.trim().length >= 5;

  return (
    <Modal
      judul="Periode sudah ditutup"
      deskripsi="Tanggal ini masuk tahun yang sudah dikunci lewat Kunci Periode. Boleh tetap simpan, tapi wajib isi alasan — tercatat otomatis."
      onTutup={onCancel}
      lebar="md"
    >
      <Field label="Alasan (min. 5 karakter)">
        <TextInput
          autoFocus
          value={alasan}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="cth: koreksi struk susulan Desember"
        />
      </Field>
      {!cukup && (
        <p className="mt-1 text-helper text-stone-500">Alasan minimal 5 karakter.</p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Batal</Button>
        <Button
          disabled={!cukup}
          onClick={() => {
            if (!cukup) return;
            onSubmit(alasan.trim());
          }}
        >
          Tetap simpan
        </Button>
      </div>
    </Modal>
  );
}

/**
 * AKT-07: modal alasan saat operator tetap menyimpan meski ada peringatan
 * (mis. kas minus). Terpisah dari `LockModal` yang meminta alasan kunci
 * periode; alasan di sini dikirim sebagai `alasanPeringatan` ke audit.
 */
export function PeringatanModal({
  pesan,
  pesanError,
  sibuk = false,
  onCancel,
  onSubmit,
}: {
  /** Ringkasan peringatan dari backend (mis. saldo kas akan minus). */
  pesan: ReactNode;
  /** Penolakan backend karena alasan kurang; ditampilkan agar bisa diperbaiki. */
  pesanError?: string | null;
  sibuk?: boolean;
  onCancel: () => void;
  onSubmit: (alasan: string) => void;
}) {
  const [alasan, setAlasan] = useState('');
  const cukup = alasanPeringatanCukup(alasan);

  return (
    <Modal
      judul="Konfirmasi peringatan"
      deskripsi={
        <div className="space-y-2 text-[15px] text-stone-700">
          <p>{pesan}</p>
          <p>
            Anda boleh tetap menyimpan, tetapi wajib menuliskan alasan minimal{' '}
            {MIN_ALASAN_PERINGATAN} karakter. Alasan ini tercatat di audit.
          </p>
        </div>
      }
      onTutup={onCancel}
      sibuk={sibuk}
      lebar="md"
    >
      <Field
        label={`Alasan tetap menyimpan (min. ${MIN_ALASAN_PERINGATAN} karakter)`}
      >
        <TextInput
          autoFocus
          value={alasan}
          disabled={sibuk}
          onChange={(e) => setAlasan(e.target.value)}
          placeholder="cth: kas minus disetujui pemilik"
        />
      </Field>
      {pesanError && (
        <p
          role="alert"
          aria-live="assertive"
          aria-atomic="true"
          className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800"
        >
          {pesanError}
        </p>
      )}
      {!cukup && (
        <p className="mt-1 text-helper text-stone-500">
          Alasan minimal {MIN_ALASAN_PERINGATAN} karakter setelah spasi di awal
          dan akhir diabaikan.
        </p>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" disabled={sibuk} onClick={onCancel}>
          Batal
        </Button>
        <Button
          disabled={sibuk || !cukup}
          onClick={() => {
            if (!cukup) return;
            onSubmit(rapikanAlasanPeringatan(alasan));
          }}
        >
          Ya, tetap simpan
        </Button>
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
        {/* T3.8: fokus awal ke pilihan aman (Batal), bukan tombol destruktif. */}
        <Button
          variant="ghost"
          autoFocus
          data-fokus-awal="true"
          disabled={sibuk}
          onClick={onBatal}
        >
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
