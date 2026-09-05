import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
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

const inputCls =
  'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-[15px] focus:border-emerald-600 focus:outline-none';

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={clsx(inputCls, props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={clsx(inputCls, props.className)} />;
}

export function Button({
  children,
  variant = 'primary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...props}
      className={clsx(
        'rounded-lg px-4 py-2 text-[15px] font-semibold whitespace-nowrap disabled:opacity-50',
        variant === 'primary' && 'bg-emerald-700 text-white hover:bg-emerald-800',
        variant === 'ghost' && 'border border-stone-300 bg-white hover:bg-stone-100',
        variant === 'danger' && 'bg-red-700 text-white hover:bg-red-800',
        props.className,
      )}
    >
      {children}
    </button>
  );
}

export function Badge({ children, tone = 'stone' }: { children: ReactNode; tone?: 'stone' | 'green' | 'amber' | 'red' }) {
  const tones: Record<string, string> = {
    stone: 'bg-stone-100 text-stone-700',
    green: 'bg-green-100 text-green-800',
    amber: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
  };
  return <span className={clsx('rounded-full px-2.5 py-0.5 text-sm font-semibold', tones[tone])}>{children}</span>;
}

export function ErrorBox({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800">{msg}</div>;
}

/** Input Rupiah: tampil grouping Indonesia, state berupa SEN (integer).
 * Desimal opsional — ketik '1500' jadi Rp 1.500,00; '1500,50' jadi Rp 1.500,50. */
export function CurrencyInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
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
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg">
        <h3 className="text-lg font-bold">Periode sudah ditutup</h3>
        <p className="mt-1 text-[15px] text-stone-600">
          Tanggal ini masuk tahun yang sudah tutup buku. Boleh tetap simpan, tapi wajib isi
          alasan — tercatat otomatis.
        </p>
        <div className="mt-3">
          <Field label="Alasan (min. 5 karakter)">
            <TextInput autoFocus onChange={(e) => (alasan = e.target.value)} placeholder="cth: koreksi struk susulan Desember" />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>Batal</Button>
          <Button onClick={() => alasan.trim().length >= 5 && onSubmit(alasan.trim())}>Tetap simpan</Button>
        </div>
      </div>
    </div>
  );
}
