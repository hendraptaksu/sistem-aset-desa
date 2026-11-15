import { useId, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { periodeBerjalan, tanggalLokal } from '../../utils/tanggal.js';
import { rentangTerbalik } from '../lib/tampilanLaporan.js';
import { ALASAN_SIBUK, Button, Field, TextInput } from './ui.js';

/**
 * UI-A10: kontrol periode bersama untuk semua layar laporan, menggantikan
 * empat pola kontrol yang berbeda (manual "Tampilkan" / auto + "Hari ini" /
 * "Reset tanggal" / "Semua tanggal").
 *
 * Dua mode:
 * - `rentang` (default): tanggal mulai/sampai + preset Hari ini / Bulan ini /
 *   Tahun berjalan (tahun buku) / Semua tanggal. "Semua tanggal" mengosongkan
 *   kedua tanggal (= tanpa batas, seluruh riwayat) dan menggantikan tombol
 *   "Reset tanggal" Buku Besar.
 * - `cutoff`: satu tanggal "Per tanggal" (Dashboard / Neraca / Neraca Saldo)
 *   dengan preset "Hari ini".
 *
 * Guard rentang terbalik selalu aktif dan seragam: kotak amber + `role=alert`
 * + `aria-invalid` pada input yang bermasalah. Nilai (mulai/sampai/cutoff)
 * dikendalikan parent (controlled); pengambilan data tetap di tab (auto lewat
 * effect, atau manual lewat `onTerapkan`).
 *
 * Default preset tahun buku: AUD-20 mengunci awal tahun buku ke Januari, jadi
 * "Tahun berjalan (tahun buku)" = 1 Januari s/d hari ini (WITA) — rentang yang
 * sama dengan "Laba / Rugi Tahun Berjalan" di Dashboard.
 */

/** Preset rentang tanggal yang disediakan KontrolPeriode (UI-A10). */
export type PresetRentang = 'hari-ini' | 'bulan-ini' | 'tahun-buku' | 'semua';

const PRESET_RENTANG: { kunci: PresetRentang; label: string; title: string }[] = [
  { kunci: 'hari-ini', label: 'Hari ini', title: 'Rentang satu hari (hari ini saja).' },
  { kunci: 'bulan-ini', label: 'Bulan ini', title: 'Dari tanggal 1 bulan ini s/d hari ini.' },
  {
    kunci: 'tahun-buku',
    label: 'Tahun berjalan (tahun buku)',
    title: 'Dari 1 Januari tahun buku berjalan s/d hari ini (WITA).',
  },
  {
    kunci: 'semua',
    label: 'Semua tanggal',
    title: 'Hapus batas tanggal untuk menampilkan seluruh riwayat.',
  },
];

/** Nilai rentang untuk tiap preset; tanggal memakai zona aplikasi (WITA). */
export function nilaiPresetRentang(
  kunci: PresetRentang,
  sekarang?: Date | number,
): { mulai: string; sampai: string } {
  const hariIni = tanggalLokal(sekarang);
  switch (kunci) {
    case 'hari-ini':
      return { mulai: hariIni, sampai: hariIni };
    case 'bulan-ini':
      return { mulai: `${hariIni.slice(0, 7)}-01`, sampai: hariIni };
    case 'tahun-buku':
      // AUD-20: awal tahun buku yang didukung hanya Januari, jadi tahun buku
      // berjalan sama dengan periode berjalan 1 Januari s/d hari ini.
      return periodeBerjalan(sekarang);
    case 'semua':
      // Rentang kosong = tanpa batas awal/akhir ("seluruh riwayat").
      return { mulai: '', sampai: '' };
  }
}

/** Props dasar kedua mode KontrolPeriode. */
type DasarKontrolPeriode = {
  /** Mode manual (Dashboard): dipanggil tombol terapkan. Tanpa ini, kontrol
   * berjalan auto (perubahan langsung memicu fetch di tab). */
  onTerapkan?: () => void;
  /** Label tombol terapkan; default "Tampilkan". */
  labelTerapkan?: string;
  /** Nonaktifkan tombol terapkan saat proses lain berjalan. */
  sibuk?: boolean;
  /** Tanggal acuan preset (default: sekarang); diisi test SSR. */
  sekarang?: Date | number;
  /** Nama laporan pada pesan guard rentang terbalik. */
  namaLaporan?: string;
  /** Node tambahan di baris preset (mis. badge Debit/Kredit Neraca Saldo). */
  tambahan?: ReactNode;
  className?: string;
};

export type KontrolPeriodeProps = DasarKontrolPeriode &
  (
    | {
        mode?: 'rentang';
        mulai: string;
        sampai: string;
        onMulai: (v: string) => void;
        onSampai: (v: string) => void;
      }
    | {
        mode: 'cutoff';
        cutoff: string;
        onCutoff: (v: string) => void;
      }
  );

export function KontrolPeriode(props: KontrolPeriodeProps) {
  return props.mode === 'cutoff' ? (
    <KontrolCutoff {...props} />
  ) : (
    <KontrolRentang {...props} />
  );
}

/** Tombol terapkan + hint pola manual; tanpa tombol bila `onTerapkan` kosong. */
function TombolTerapkan({
  onTerapkan,
  labelTerapkan = 'Tampilkan',
  sibuk = false,
}: Pick<DasarKontrolPeriode, 'onTerapkan' | 'labelTerapkan' | 'sibuk'>) {
  if (!onTerapkan) return null;
  return (
    <>
      <Button
        disabled={sibuk}
        title={sibuk ? ALASAN_SIBUK : undefined}
        onClick={onTerapkan}
      >
        {labelTerapkan}
      </Button>
      {/* UI-A10: hint pola manual dekat tombolnya (Dashboard). */}
      <span className="pb-2 text-helper text-stone-500">
        Ubah tanggal lalu klik “Tampilkan”.
      </span>
    </>
  );
}

/** Kotak amber guard seragam; `id` untuk aria-describedby input terkait. */
function KotakAmber({ id, pesan }: { id: string; pesan: string }) {
  return (
    <p
      id={id}
      role="alert"
      className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
    >
      {pesan}
    </p>
  );
}

function KontrolRentang({
  mulai,
  sampai,
  onMulai,
  onSampai,
  onTerapkan,
  labelTerapkan,
  sibuk,
  sekarang,
  namaLaporan = 'laporan',
  tambahan,
  className,
}: DasarKontrolPeriode & {
  mulai: string;
  sampai: string;
  onMulai: (v: string) => void;
  onSampai: (v: string) => void;
}) {
  const idGalat = useId();
  // UI-A10: guard seragam; perbandingan string ISO sama dengan urutan tanggal.
  const invalid = rentangTerbalik(mulai, sampai);

  return (
    <div className={clsx('min-w-0', className)}>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <Field label="Dari tanggal">
          <TextInput
            type="date"
            value={mulai}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? idGalat : undefined}
            onChange={(e) => onMulai(e.target.value)}
          />
        </Field>
        <Field label="Sampai tanggal">
          <TextInput
            type="date"
            value={sampai}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? idGalat : undefined}
            onChange={(e) => onSampai(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          {PRESET_RENTANG.map((p) => {
            const nilai = nilaiPresetRentang(p.kunci, sekarang);
            const aktif = mulai === nilai.mulai && sampai === nilai.sampai;
            return (
              <Button
                key={p.kunci}
                variant="ghost"
                className={
                  aktif
                    ? '!border-emerald-600 !bg-emerald-50 text-emerald-950'
                    : undefined
                }
                aria-pressed={aktif}
                title={p.title}
                onClick={() => {
                  onMulai(nilai.mulai);
                  onSampai(nilai.sampai);
                }}
              >
                {p.label}
              </Button>
            );
          })}
          {tambahan}
          <TombolTerapkan
            onTerapkan={onTerapkan}
            labelTerapkan={labelTerapkan}
            sibuk={sibuk}
          />
        </div>
      </div>
      {invalid && (
        <KotakAmber
          id={idGalat}
          pesan={`Tanggal “Dari” tidak boleh setelah “Sampai”. Perbaiki rentang tanggal untuk menampilkan ${namaLaporan}.`}
        />
      )}
    </div>
  );
}

function KontrolCutoff({
  cutoff,
  onCutoff,
  onTerapkan,
  labelTerapkan,
  sibuk,
  sekarang,
  tambahan,
  className,
}: DasarKontrolPeriode & {
  cutoff: string;
  onCutoff: (v: string) => void;
}) {
  const idGalat = useId();
  // Guard cutoff kosong: laporan "per tanggal" tidak punya arti tanpa tanggal.
  const kosong = !cutoff;

  return (
    <div className={clsx('min-w-0', className)}>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
        <Field label="Per tanggal">
          <TextInput
            type="date"
            value={cutoff}
            aria-invalid={kosong || undefined}
            aria-describedby={kosong ? idGalat : undefined}
            onChange={(e) => onCutoff(e.target.value)}
          />
        </Field>
        <div className="flex flex-wrap items-end gap-2">
          <Button
            variant="ghost"
            className={
              cutoff === tanggalLokal(sekarang)
                ? '!border-emerald-600 !bg-emerald-50 text-emerald-950'
                : undefined
            }
            aria-pressed={cutoff === tanggalLokal(sekarang)}
            title="Set tanggal laporan ke hari ini."
            onClick={() => onCutoff(tanggalLokal(sekarang))}
          >
            Hari ini
          </Button>
          {tambahan}
          <TombolTerapkan
            onTerapkan={onTerapkan}
            labelTerapkan={labelTerapkan}
            sibuk={sibuk}
          />
        </div>
      </div>
      {kosong && <KotakAmber id={idGalat} pesan="Isi tanggal laporan terlebih dahulu." />}
    </div>
  );
}
