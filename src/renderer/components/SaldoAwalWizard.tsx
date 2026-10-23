import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { AKUN_MODAL, isAkunKas, type Coa } from '../../db/coa.js';
import { buatJurnalSaldoAwal, type FormSaldoAwal } from '../../core/forms.js';
import { tanggalKalenderValid } from '../../core/posting.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, isPerluAlasan, isPerluKonfirmasi } from '../lib/api.js';
import {
  Badge,
  Button,
  CurrencyInput,
  ErrorBox,
  Field,
  LockModal,
  Select,
  TextInput,
} from './ui.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';
import {
  PESAN_TANGGAL_TIDAK_VALID,
  pesanError,
} from '../../utils/pesanError.js';

type BarisSaldo = {
  key: number;
  akun: string;
  nominal: number;
};

type GrupAkun = {
  label: string;
  akun: Coa[];
};

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Wizard Saldo Awal (P1-6) — dipakai sekali saat mulai pembukuan nyata.
 *
 * Operator mengisi saldo per akun, bukan debit/kredit. Selisih aktiva −
 * kewajiban otomatis menjadi baris 3000 MODAL sehingga pratinjau selalu satu
 * jurnal seimbang. Simpan hanya mengirim form mentah; main menyusun ulang
 * jurnal dengan builder yang sama dan adapter DB memastikan tabel jurnal kosong.
 */
export function SaldoAwalWizard({
  coa,
  onClose,
  onSukses,
}: {
  coa: Coa[];
  onClose: () => void;
  onSukses: (pesan: string) => void;
}) {
  const akunRelevan = useMemo(
    () => coa.filter((a) => a.tipe === 'AKTIVA' || a.tipe === 'KEWAJIBAN'),
    [coa],
  );
  const akunAwal =
    akunRelevan.find((a) => a.kode === '1001')?.kode ??
    akunRelevan.find((a) => isAkunKas(a.kode))?.kode ??
    akunRelevan[0]?.kode ??
    '';

  const keyRef = useRef(2);
  const [tanggal, setTanggal] = useState(today());
  const [rows, setRows] = useState<BarisSaldo[]>([
    { key: 1, akun: akunAwal, nominal: 0 },
  ]);
  const [keterangan, setKeterangan] = useState('');
  const [noBukti, setNoBukti] = useState('');

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState<string | null>(null);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);

  // COA dimuat async oleh TransaksiTab; isi baris pertama bila baru tiba.
  useEffect(() => {
    if (!akunAwal) return;
    setRows((prev) => prev.map((r) => (r.akun ? r : { ...r, akun: akunAwal })));
  }, [akunAwal]);

  const grupAkun = useMemo<GrupAkun[]>(() => {
    const kas = akunRelevan.filter((a) => isAkunKas(a.kode));
    const asetLain = akunRelevan.filter(
      (a) => a.tipe === 'AKTIVA' && !isAkunKas(a.kode),
    );
    const kewajiban = akunRelevan.filter((a) => a.tipe === 'KEWAJIBAN');
    const grup: GrupAkun[] = [];
    if (kas.length > 0) grup.push({ label: 'Kas / Bank', akun: kas });
    if (asetLain.length > 0)
      grup.push({ label: 'Piutang & aset lain', akun: asetLain });
    if (kewajiban.length > 0) grup.push({ label: 'Hutang', akun: kewajiban });
    return grup;
  }, [akunRelevan]);

  const hasil = useMemo(() => {
    if (!tanggalKalenderValid(tanggal))
      return {
        data: null as ReturnType<typeof buatJurnalSaldoAwal> | null,
        error: PESAN_TANGGAL_TIDAK_VALID,
      };
    const saldo = rows.map((r) => ({ akun_kode: r.akun, nominal: r.nominal }));
    if (!saldo.some((s) => Number.isInteger(s.nominal) && s.nominal > 0))
      return {
        data: null as ReturnType<typeof buatJurnalSaldoAwal> | null,
        error: null,
      };
    try {
      return {
        data: buatJurnalSaldoAwal({
          tanggal,
          saldo,
          ...(keterangan.trim() ? { keterangan: keterangan.trim() } : {}),
          ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
        }),
        error: null,
      };
    } catch (e) {
      return {
        data: null as ReturnType<typeof buatJurnalSaldoAwal> | null,
        error: pesanError(e),
      };
    }
  }, [tanggal, rows, keterangan, noBukti]);

  const formSah = Boolean(hasil.data);

  const labelAkun = (kode: string): string => {
    if (kode === AKUN_MODAL) return '3000 — MODAL (penyeimbang otomatis)';
    const a = coa.find((x) => x.kode === kode);
    return a ? `${a.kode} — ${a.nama}` : kode;
  };

  function tambahBaris(): void {
    const dipakai = new Set(rows.map((r) => r.akun));
    const berikut =
      akunRelevan.find((a) => !dipakai.has(a.kode))?.kode ??
      akunRelevan[0]?.kode ??
      '';
    setRows((prev) => [
      ...prev,
      { key: keyRef.current++, akun: berikut, nominal: 0 },
    ]);
  }

  function hapusBaris(key: number): void {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.key !== key)));
  }

  async function simpan(
    opsi: { alasan?: string; konfirmasi?: boolean } = {},
  ): Promise<void> {
    if (busyRef.current) return;
    setErr(null);
    setPesanKonfirmasi(null);
    setLockOpen(false);

    if (!formSah || !hasil.data) {
      setErr(
        'Isi minimal satu saldo dengan nominal lebih dari 0, lalu periksa tanggal mulai pembukuan.',
      );
      return;
    }

    const form: FormSaldoAwal = {
      tanggal,
      saldo: rows.map((r) => ({ akun_kode: r.akun, nominal: r.nominal })),
      ...(keterangan.trim() ? { keterangan: keterangan.trim() } : {}),
      ...(noBukti.trim() ? { noBukti: noBukti.trim() } : {}),
      ...(opsi.alasan ? { alasan: opsi.alasan } : {}),
    };
    const total = hasil.data.input.baris.reduce((s, b) => s + b.debit, 0);

    busyRef.current = true;
    setBusy(true);
    try {
      const res = await api.saldoAwalPosting(form, {
        konfirmasiPeringatan: opsi.konfirmasi === true,
      });
      onSukses(
        `Saldo awal ${formatTanggal(tanggal)} tersimpan — satu jurnal seimbang ${formatRp(total)} (${res.jurnal.no_bukti || res.jurnal.id}).`,
      );
    } catch (e) {
      if (isPerluAlasan(e)) {
        setLockOpen(true);
      } else if (isPerluKonfirmasi(e) && !opsi.konfirmasi) {
        setPesanKonfirmasi(pesanError(e));
      } else {
        setErr(pesanError(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-4 w-full max-w-3xl rounded-xl bg-white p-5 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Wizard Saldo Awal</h2>
            <p className="mt-1 max-w-2xl text-[15px] text-stone-600">
              Dipakai sekali saat mulai pembukuan nyata. Isi saldo kas/bank, piutang,
              hutang, dan aset lain per tanggal mulai. Selisih otomatis menjadi modal,
              jadi Anda tidak perlu menghitung debit/kredit.
            </p>
          </div>
          <button
            type="button"
            aria-label="Tutup wizard saldo awal"
            disabled={busy}
            onClick={onClose}
            className="rounded-lg p-2 text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>

        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Tanggal mulai pembukuan (tanggal jangkar)">
            <TextInput
              type="date"
              value={tanggal}
              disabled={busy}
              onChange={(e) => setTanggal(e.target.value)}
            />
          </Field>
          <Field label="Keterangan (opsional)">
            <TextInput
              value={keterangan}
              disabled={busy}
              placeholder="cth: Saldo awal pembukuan 2026"
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </Field>
          <div>
            <Field label="No. bukti (opsional)">
              <TextInput
                value={noBukti}
                disabled={busy}
                placeholder="cth: JU-2026-0001 — boleh dikosongkan"
                onChange={(e) => setNoBukti(e.target.value)}
              />
            </Field>
            <SaranNomorBukti tanggal={tanggal} />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">Saldo per akun</h3>
              <p className="text-sm text-stone-600">
                Hanya kas/bank, piutang, hutang, dan aset lain. Pendapatan, beban, dan
                modal tidak diisi di sini.
              </p>
            </div>
            <Button
              variant="ghost"
              disabled={busy || akunRelevan.length === 0}
              onClick={tambahBaris}
            >
              <span className="inline-flex items-center gap-1.5">
                <Plus size={16} /> Tambah akun
              </span>
            </Button>
          </div>

          <div className="mt-2 space-y-2">
            {rows.map((r, i) => (
              <div
                key={r.key}
                className="grid grid-cols-1 gap-2 rounded-lg border border-stone-200 bg-stone-50 p-2 sm:grid-cols-[minmax(0,1fr)_180px_auto]"
              >
                <Select
                  aria-label={`Akun saldo awal baris ${i + 1}`}
                  value={r.akun}
                  disabled={busy}
                  onChange={(e) =>
                    setRows((prev) =>
                      prev.map((x) =>
                        x.key === r.key ? { ...x, akun: e.target.value } : x,
                      ),
                    )
                  }
                >
                  <option value="">— Pilih akun —</option>
                  {grupAkun.map((grup) => (
                    <optgroup key={grup.label} label={grup.label}>
                      {grup.akun.map((a) => (
                        <option key={a.kode} value={a.kode}>
                          {a.kode} — {a.nama}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
                <div>
                  <CurrencyInput
                    value={r.nominal}
                    onChange={(n) =>
                      setRows((prev) =>
                        prev.map((x) =>
                          x.key === r.key ? { ...x, nominal: n } : x,
                        ),
                      )
                    }
                  />
                  <span className="mt-1 block text-xs text-stone-500">Saldo (Rp)</span>
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Hapus akun saldo awal baris ${i + 1}`}
                  disabled={busy || rows.length <= 1}
                  onClick={() => hapusBaris(r.key)}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-bold">Pratinjau Jurnal (untuk diperiksa)</h3>
            {hasil.data && (
              <Badge tone="green">
                Seimbang — debit = kredit
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-stone-600">
            Baris di bawah ini yang akan disimpan sebagai satu jurnal. Operator tidak
            perlu mengubahnya; akuntan pendamping bisa memeriksa debit dan kredit di
            sini.
          </p>

          {hasil.data && (
            <>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="rounded-lg border border-emerald-200 bg-white p-2">
                  <div className="text-xs font-semibold text-stone-500">
                    Total aktiva (debit)
                  </div>
                  <div className="font-bold">{formatRp(hasil.data.totalAktiva)}</div>
                </div>
                <div className="rounded-lg border border-emerald-200 bg-white p-2">
                  <div className="text-xs font-semibold text-stone-500">
                    Total kewajiban (kredit)
                  </div>
                  <div className="font-bold">
                    {formatRp(hasil.data.totalKewajiban)}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-white p-2">
                  <div className="text-xs font-semibold text-stone-500">
                    Selisih ke 3000 MODAL
                  </div>
                  <div className="font-bold">
                    {formatRp(Math.abs(hasil.data.selisih))}
                  </div>
                </div>
              </div>
              <p className="mt-2 text-sm text-stone-600">
                {hasil.data.selisih > 0
                  ? `Aktiva lebih besar ${formatRp(hasil.data.selisih)}. Selisih otomatis dicatat sebagai kredit ke 3000 MODAL (menambah modal).`
                  : hasil.data.selisih < 0
                    ? `Kewajiban lebih besar ${formatRp(-hasil.data.selisih)}. Selisih otomatis dicatat sebagai debit ke 3000 MODAL (mengurangi modal).`
                    : 'Total aktiva dan kewajiban sudah sama; tidak perlu baris modal.'}
              </p>

              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-[15px]">
                  <thead>
                    <tr className="border-b text-stone-500">
                      <th className="py-2 pr-3">Akun</th>
                      <th className="py-2 pr-3 text-right">Debit</th>
                      <th className="py-2 text-right">Kredit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hasil.data.input.baris.map((b, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-3">{labelAkun(b.akun_kode)}</td>
                        <td className="py-2 pr-3 text-right">
                          {b.debit ? formatRp(b.debit) : '—'}
                        </td>
                        <td className="py-2 text-right">
                          {b.kredit ? formatRp(b.kredit) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t font-bold">
                      <td className="py-2 pr-3">Total</td>
                      <td className="py-2 pr-3 text-right">
                        {formatRp(
                          hasil.data.input.baris.reduce((s, b) => s + b.debit, 0),
                        )}
                      </td>
                      <td className="py-2 text-right">
                        {formatRp(
                          hasil.data.input.baris.reduce((s, b) => s + b.kredit, 0),
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          )}

          {hasil.error ? (
            <p className="mt-2 text-sm text-red-700">{hasil.error}</p>
          ) : !hasil.data ? (
            <p className="mt-2 text-sm text-stone-500">
              Pratinjau muncul setelah tanggal dan minimal satu saldo diisi.
            </p>
          ) : null}
        </div>

        {pesanKonfirmasi && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-900">
            <p className="text-[15px] font-semibold">Perlu konfirmasi</p>
            <p className="mt-1 text-[15px]">{pesanKonfirmasi}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => void simpan({ konfirmasi: true })}>
                Ya, tetap simpan
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setPesanKonfirmasi(null)}
              >
                Batal
              </Button>
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button disabled={busy || !formSah} onClick={() => void simpan()}>
            {busy ? 'Menyimpan…' : 'Simpan Saldo Awal'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Batal
          </Button>
          <span className="text-sm text-stone-500">
            Setelah tersimpan, wizard terkunci karena pembukuan sudah dimulai.
          </span>
        </div>

        {lockOpen && (
          <LockModal
            onCancel={() => setLockOpen(false)}
            onSubmit={(alasan) => {
              setLockOpen(false);
              void simpan({ alasan });
            }}
          />
        )}
      </div>
    </div>
  );
}
