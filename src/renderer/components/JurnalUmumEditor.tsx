import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Coa } from '../../db/coa.js';
import { akunBolehDiposting } from '../../db/coa.js';
import {
  TEMPLATE_JURNAL,
  buatJurnalUmumForm,
  cariAkunDariTeks,
  validasiBarisJurnalForm,
  type BarisJurnalForm,
  type FormJurnalUmum,
} from '../../core/jurnalForm.js';
import { tanggalKalenderValid } from '../../core/posting.js';
import { formatRp } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { api, isPerluAlasan, isPerluKonfirmasi } from '../lib/api.js';
import {
  PESAN_ALASAN_PERINGATAN_MIN,
  alasanPeringatanCukup,
  opsiPeringatanApi,
  rapikanAlasanPeringatan,
} from '../lib/peringatan.js';
import {
  adalahErrorSaldoAwal,
  opsiSaldoAwal,
  tandaiMulaiTanpaSaldoAwal,
} from '../lib/saldoAwal.js';
import {
  Badge,
  Button,
  CurrencyInput,
  ErrorBox,
  Field,
  KonfirmasiModal,
  LockModal,
  Modal,
  PeringatanModal,
  Select,
  TextInput,
} from './ui.js';
import { SaldoAwalGuard } from './SaldoAwalGuard.js';
import { SaranNomorBukti } from './SaranNomorBukti.js';
import { pesanError } from '../../utils/pesanError.js';

type BarisEditor = BarisJurnalForm & {
  key: number;
  akun_teks: string;
};

const DAFTAR_AKUN_ID = 'daftar-akun-jurnal-umum';

const kosong = (): Omit<BarisEditor, 'key'> => ({
  akun_kode: '',
  akun_teks: '',
  debit: 0,
  kredit: 0,
  keterangan: '',
});

function barisEditorKosong(b: BarisEditor): boolean {
  return (
    !b.akun_teks.trim() &&
    !b.akun_kode.trim() &&
    !b.keterangan.trim() &&
    b.debit === 0 &&
    b.kredit === 0
  );
}

/**
 * Editor Jurnal Umum (P1-7) untuk akuntan pendamping.
 *
 * Multi-baris debit/kredit dengan total live, autocomplete COA, template,
 * duplikat, serta keyboard-friendly (Tab/Enter/Esc). Penyimpanan tetap lewat
 * `api.jurnalPosting` (jalur manual) dan selalu UMUM; semua aturan bisnis ada
 * di posting layer. Dokumen TERIMA/BAYAR/TRANSFER/HUTANG, panjar, saldo awal,
 * dan koreksi memakai jalurnya masing-masing.
 */
export function JurnalUmumEditor({
  coa,
  awal,
  onBatal,
  onSelesai,
}: {
  coa: Coa[];
  /** Form awal (mis. hasil duplikat jurnal lama). Kosong = jurnal baru. */
  awal?: FormJurnalUmum;
  onBatal: () => void;
  onSelesai: (pesan: string) => void;
}) {
  const labelAkun = (kode: string): string => {
    const a = coa.find((x) => x.kode === kode);
    return a ? `${a.kode} — ${a.nama}` : kode;
  };

  /**
   * Pilihan autocomplete hanya akun yang boleh diposting. Label & tampilan
   * tetap memakai `coa` lengkap agar akun legacy pada jurnal lama masih bisa
   * dibaca (mis. saat duplikat).
   */
  const coaPosting = useMemo(
    () => coa.filter((a) => akunBolehDiposting(a.kode, a.aktif !== false, { dikenal: true })),
    [coa],
  );

  const [tanggal, setTanggal] = useState(awal?.tanggal ?? tanggalLokal());
  const [keterangan, setKeterangan] = useState(awal?.keterangan ?? '');
  const [noBukti, setNoBukti] = useState(awal?.noBukti ?? '');
  const [templateId, setTemplateId] = useState('');
  const [rows, setRows] = useState<BarisEditor[]>(() => {
    const sumber =
      awal && awal.baris.length > 0
        ? awal.baris
        : [kosong(), kosong()];
    return sumber.map((b, i) => ({
      key: i + 1,
      akun_kode: String(b.akun_kode ?? '').trim(),
      akun_teks:
        String(b.akun_kode ?? '').trim()
          ? labelAkun(String(b.akun_kode).trim())
          : '',
      debit: b.debit,
      kredit: b.kredit,
      keterangan: String(b.keterangan ?? ''),
    }));
  });
  const keyRef = useRef(rows.length + 1);
  const fokusRef = useRef<number | null>(null);
  const [tersentuh, setTersentuh] = useState<boolean[]>(() =>
    rows.map(() => false),
  );

  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  /**
   * Alasan periode terkunci dipertahankan agar konfirmasi kas minus tidak
   * menghapusnya. Alasan peringatan punya ref sendiri (AKT-07) karena kedua
   * alasan dikirim lewat jalur berbeda.
   */
  const alasanPeriodeRef = useRef('');
  const alasanPeringatanRef = useRef('');
  const [err, setErr] = useState<string | null>(null);
  const [pesanKonfirmasi, setPesanKonfirmasi] = useState<string | null>(null);
  const [errorKonfirmasi, setErrorKonfirmasi] = useState<string | null>(null);
  const [lockOpen, setLockOpen] = useState(false);
  const [konfirmasiTutup, setKonfirmasiTutup] = useState(false);
  /** UI-A12: template yang menunggu konfirmasi karena baris sudah berisi. */
  const [templateTunda, setTemplateTunda] = useState<string | null>(null);
  const [saldoAwalOpen, setSaldoAwalOpen] = useState(false);
  const saldoAwalPendingRef = useRef<{
    konfirmasi?: boolean;
  }>({});

  // COA bisa datang setelah editor dirender (mis. duplikat saat daftar akun
  // belum termuat). Lengkapi teks kode—nama tanpa menimpa isian manual.
  useEffect(() => {
    if (coa.length === 0) return;
    setRows((prev) =>
      prev.map((r) => {
        if (!r.akun_kode) return r;
        const teks = labelAkun(r.akun_kode);
        if (r.akun_teks === teks || r.akun_teks === r.akun_kode)
          return { ...r, akun_teks: teks };
        return r;
      }),
    );
    // Hanya saat daftar COA berubah; labelAkun diturunkan dari coa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coa]);

  // Fokus ke baris baru setelah React selesai merender.
  useEffect(() => {
    if (fokusRef.current === null) return;
    const el = document.getElementById(
      `akun-jurnal-baris-${fokusRef.current}`,
    ) as HTMLInputElement | null;
    fokusRef.current = null;
    el?.focus();
  }, [rows.length]);

  const barisForm = useMemo<BarisJurnalForm[]>(
    () =>
      rows.map(({ akun_kode, debit, kredit, keterangan: ket }) => ({
        akun_kode,
        debit,
        kredit,
        keterangan: ket,
      })),
    [rows],
  );
  const validasi = useMemo(
    () => validasiBarisJurnalForm(barisForm),
    [barisForm],
  );

  const adaIsian =
    Boolean(keterangan.trim()) ||
    Boolean(noBukti.trim()) ||
    tanggal !== tanggalLokal() ||
    rows.some((r) => !barisEditorKosong(r));
  const headerSah =
    tanggalKalenderValid(tanggal) && Boolean(keterangan.trim());
  const formSah = headerSah && validasi.barisSah && validasi.seimbang;

  function mintaTutup(): void {
    if (busyRef.current) return;
    if (adaIsian) {
      setKonfirmasiTutup(true);
      return;
    }
    onBatal();
  }

  function ubahBaris(index: number, patch: Partial<BarisEditor>): void {
    setRows((prev) =>
      prev.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  }

  function ubahAkunTeks(index: number, teks: string): void {
    const ditemukan = cariAkunDariTeks(coaPosting, teks);
    ubahBaris(index, {
      akun_teks: teks,
      akun_kode: ditemukan ? ditemukan.kode : '',
    });
    setTersentuh((prev) => {
      const next = [...prev];
      next[index] = false;
      return next;
    });
  }

  function blurAkun(index: number): void {
    setTersentuh((prev) => {
      const next = [...prev];
      next[index] = true;
      return next;
    });
    const r = rows[index];
    if (!r) return;
    const ditemukan = cariAkunDariTeks(coaPosting, r.akun_teks);
    if (ditemukan) {
      ubahBaris(index, {
        akun_kode: ditemukan.kode,
        akun_teks: labelAkun(ditemukan.kode),
      });
    } else {
      ubahBaris(index, { akun_kode: '' });
    }
  }

  function tambahBaris(fokus = false): void {
    const index = rows.length;
    if (fokus) fokusRef.current = index;
    setRows((prev) => [
      ...prev,
      { key: keyRef.current++, ...kosong() },
    ]);
    setTersentuh((prev) => [...prev, false]);
  }

  function hapusBaris(index: number): void {
    if (rows.length <= 2) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
    setTersentuh((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * UI-A12: memilih template tidak boleh diam-diam menimpa baris yang sudah
   * diisi. Baris masih kosong → langsung diterapkan; baris berisi → minta
   * konfirmasi dulu, pilihan select dibatalkan bila operator menolak.
   */
  function mintaTerapkanTemplate(id: string): void {
    if (!TEMPLATE_JURNAL.some((t) => t.id === id)) {
      setTemplateId(id);
      return;
    }
    if (rows.some((r) => !barisEditorKosong(r))) {
      setTemplateTunda(id);
      return;
    }
    terapkanTemplate(id);
  }

  function terapkanTemplate(id: string): void {
    setTemplateId(id);
    const template = TEMPLATE_JURNAL.find((t) => t.id === id);
    if (!template) return;
    setRows(
      template.baris.map((b) => ({
        key: keyRef.current++,
        akun_kode: b.akun_kode,
        akun_teks: labelAkun(b.akun_kode),
        debit: b.sisi === 'DEBIT' ? b.nominal : 0,
        kredit: b.sisi === 'KREDIT' ? b.nominal : 0,
        keterangan: b.keterangan ?? '',
      })),
    );
    setTersentuh(template.baris.map(() => false));
    if (!keterangan.trim()) setKeterangan(template.keterangan);
  }

  function handleRowKeyDown(
    e: React.KeyboardEvent<HTMLTableRowElement>,
    index: number,
  ): void {
    if (e.key !== 'Enter') return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.tagName === 'SELECT') return;
    // Biarkan datalist native menangani Enter saat akun belum dipilih.
    if (
      target.hasAttribute('list') &&
      !rows[index]?.akun_kode
    )
      return;
    e.preventDefault();
    if (index === rows.length - 1) tambahBaris(true);
    else
      (
        document.getElementById(
          `akun-jurnal-baris-${index + 1}`,
        ) as HTMLInputElement | null
      )?.focus();
  }

  async function simpan(
    opsi: {
      alasan?: string;
      alasanPeringatan?: string;
      konfirmasi?: boolean;
      konfirmasiTanpaSaldoAwal?: boolean;
    } = {},
  ): Promise<void> {
    if (busyRef.current) return;
    setErr(null);
    // Selama operator mengirim alasan dari modal, biarkan modal terbuka agar
    // penolakan backend bisa ditampilkan dan diperbaiki di tempat yang sama.
    if (opsi.konfirmasi !== true) {
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
    }
    setLockOpen(false);
    setSaldoAwalOpen(false);

    if (!formSah) {
      setErr(
        'Jurnal belum bisa disimpan. Isi tanggal, keterangan, minimal 2 baris akun, dan pastikan debit = kredit.',
      );
      return;
    }

    // AKT-07: alasan kunci periode (`alasan`) dan alasan peringatan
    // (`alasanPeringatan`) dipisah dan sama-sama dipertahankan saat retry.
    const alasanPeriode = rapikanAlasanPeringatan(
      opsi.alasan ?? alasanPeriodeRef.current,
    );
    if (opsi.alasan) alasanPeriodeRef.current = opsi.alasan;
    const alasanPeringatan = rapikanAlasanPeringatan(
      opsi.alasanPeringatan ?? alasanPeringatanRef.current,
    );
    if (opsi.alasanPeringatan) alasanPeringatanRef.current = opsi.alasanPeringatan;

    if (opsi.konfirmasi === true && !alasanPeringatanCukup(alasanPeringatan)) {
      setPesanKonfirmasi((sebelum) => sebelum ?? PESAN_ALASAN_PERINGATAN_MIN);
      setErrorKonfirmasi(PESAN_ALASAN_PERINGATAN_MIN);
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const input = buatJurnalUmumForm({
        ...(awal?.id ? { id: awal.id } : {}),
        tanggal,
        keterangan: keterangan.trim(),
        noBukti: noBukti.trim(),
        baris: barisForm,
        ...(alasanPeriode ? { alasan: alasanPeriode } : {}),
      });
      saldoAwalPendingRef.current = {
        ...(opsi.konfirmasi ? { konfirmasi: true } : {}),
      };
      const hasil = await api.jurnalPosting(input, {
        konfirmasiPeringatan: opsi.konfirmasi === true,
        ...opsiPeringatanApi(
          opsi.konfirmasi === true ? alasanPeringatan : undefined,
        ),
        ...opsiSaldoAwal(opsi.konfirmasiTanpaSaldoAwal === true),
      });
      setPesanKonfirmasi(null);
      setErrorKonfirmasi(null);
      const nomor = hasil.jurnal.no_bukti || 'tanpa nomor bukti';
      onSelesai(
        `Jurnal ${nomor} tersimpan — debit = kredit ${formatRp(validasi.totalDebit)}.`,
      );
    } catch (e) {
      if (adalahErrorSaldoAwal(e)) {
        setPesanKonfirmasi(null);
        setErrorKonfirmasi(null);
        setSaldoAwalOpen(true);
      } else if (isPerluAlasan(e)) {
        setPesanKonfirmasi(null);
        setErrorKonfirmasi(null);
        setLockOpen(true);
      } else if (isPerluKonfirmasi(e)) {
        const pesan = pesanError(e);
        setPesanKonfirmasi((sebelum) => sebelum ?? pesan);
        setErrorKonfirmasi(opsi.konfirmasi === true ? pesan : null);
      } else {
        setPesanKonfirmasi(null);
        setErrorKonfirmasi(null);
        setErr(pesanError(e));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function mulaiTanpaSaldoAwal(): void {
    tandaiMulaiTanpaSaldoAwal();
    setSaldoAwalOpen(false);
    void simpan({
      ...saldoAwalPendingRef.current,
      konfirmasiTanpaSaldoAwal: true,
    });
  }

  function saldoAwalTersimpan(_pesan: string): void {
    setSaldoAwalOpen(false);
    void simpan(saldoAwalPendingRef.current);
  }

  return (
    <Modal
      judul={awal?.id ? 'Duplikat Jurnal' : 'Jurnal Baru'}
      deskripsi="Mode lanjutan: isi beberapa baris debit dan kredit. Sistem hanya menyimpan bila minimal 2 baris sah dan total debit = total kredit."
      onTutup={mintaTutup}
      sibuk={busy}
      maxWidth="64rem"
    >
      <div className="-mt-1">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge tone="stone">Jurnal Umum</Badge>
          <span className="text-sm text-stone-600">
            Jalur manual ini hanya menyimpan jurnal UMUM.
          </span>
        </div>
        <ErrorBox msg={err} />
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <Field label="Tanggal">
            <TextInput
              type="date"
              value={tanggal}
              disabled={busy}
              onChange={(e) => {
                setTanggal(e.target.value);
                alasanPeriodeRef.current = '';
              }}
            />
          </Field>
          <div>
            <Field label="No. bukti (opsional)">
              <TextInput
                value={noBukti}
                disabled={busy}
                placeholder="JU-2026-0001"
                onChange={(e) => setNoBukti(e.target.value)}
              />
            </Field>
            <SaranNomorBukti tanggal={tanggal} />
          </div>
          <div>
            <Field label="Template jurnal (opsional)">
              <Select
                value={templateId}
                disabled={busy}
                onChange={(e) => mintaTerapkanTemplate(e.target.value)}
              >
                <option value="">— Pilih template —</option>
                {TEMPLATE_JURNAL.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nama}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-1 text-helper text-stone-500">
              Template mengisi ulang baris dengan nominal 0; isi nominal sesuai
              bukti.
            </p>
          </div>
        </div>

        <div className="mt-3">
          <Field label="Keterangan">
            <TextInput
              value={keterangan}
              disabled={busy}
              placeholder="cth: Penerimaan pendapatan parkir bulan Oktober"
              onChange={(e) => setKeterangan(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold">Baris Jurnal</h3>
              <p className="text-sm text-stone-600">
                Ketik kode atau nama akun (mis. <b>1001</b> atau{' '}
                <b>Kas</b>), lalu Tab ke kolom debit/kredit. Enter di baris
                terakhir menambah baris baru.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => tambahBaris(true)}
            >
              <span className="inline-flex items-center gap-1.5">
                <Plus size={16} /> Tambah baris
              </span>
            </Button>
          </div>

          <datalist id={DAFTAR_AKUN_ID}>
            {coaPosting.map((a) => (
              <option key={a.kode} value={`${a.kode} — ${a.nama}`}>
                {a.tipe}
              </option>
            ))}
          </datalist>

          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead>
                <tr className="border-b text-stone-500">
                  <th className="py-2 pr-2">Akun</th>
                  <th className="w-36 py-2 pr-2 text-right">Debit (Rp)</th>
                  <th className="w-36 py-2 pr-2 text-right">Kredit (Rp)</th>
                  <th className="py-2 pr-2">Keterangan baris</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((b, i) => {
                  const akunSalah =
                    tersentuh[i] &&
                    !b.akun_kode &&
                    (Boolean(b.akun_teks.trim()) ||
                      b.debit > 0 ||
                      b.kredit > 0 ||
                      Boolean(b.keterangan.trim()));
                  return (
                    <tr
                      key={b.key}
                      className="border-b align-top last:border-0"
                      onKeyDown={(e) => handleRowKeyDown(e, i)}
                    >
                      <td className="py-2 pr-2">
                        <TextInput
                          id={`akun-jurnal-baris-${i}`}
                          list={DAFTAR_AKUN_ID}
                          aria-label={`Akun baris ${i + 1}`}
                          className={akunSalah ? 'border-red-400' : undefined}
                          value={b.akun_teks}
                          disabled={busy}
                          autoComplete="off"
                          placeholder="kode atau nama akun"
                          onChange={(e) => ubahAkunTeks(i, e.target.value)}
                          onBlur={() => blurAkun(i)}
                        />
                        {akunSalah && (
                          <span className="mt-1 block text-helper text-red-700">
                            Akun tidak dikenal atau tidak boleh diposting
                            (akun legacy/nonaktif). Pilih dari daftar akun.
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <CurrencyInput
                          value={b.debit}
                          disabled={busy}
                          onChange={(n) => ubahBaris(i, { debit: n })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <CurrencyInput
                          value={b.kredit}
                          disabled={busy}
                          onChange={(n) => ubahBaris(i, { kredit: n })}
                        />
                      </td>
                      <td className="py-2 pr-2">
                        <TextInput
                          aria-label={`Keterangan baris ${i + 1}`}
                          value={b.keterangan}
                          disabled={busy}
                          placeholder="opsional"
                          onChange={(e) =>
                            ubahBaris(i, { keterangan: e.target.value })
                          }
                        />
                      </td>
                      <td className="py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          aria-label={`Hapus baris ${i + 1}`}
                          disabled={busy || rows.length <= 2}
                          onClick={() => hapusBaris(i)}
                        >
                          <Trash2 size={16} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t font-bold">
                  <td className="py-2 pr-2 text-right">Total</td>
                  <td className="py-2 pr-2 text-right">
                    {formatRp(validasi.totalDebit)}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {formatRp(validasi.totalKredit)}
                  </td>
                  <td className="py-2 pr-2">
                    {validasi.seimbang ? (
                      <Badge tone="green">Seimbang</Badge>
                    ) : (
                      <Badge tone="red">Belum seimbang</Badge>
                    )}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-stone-600">
              Debit {formatRp(validasi.totalDebit)} · Kredit{' '}
              {formatRp(validasi.totalKredit)}
            </span>
            <span className="text-stone-500">
              {validasi.seimbang
                ? 'Siap disimpan.'
                : 'Tombol simpan aktif setelah minimal 2 baris sah dan debit = kredit.'}
            </span>
          </div>

          {adaIsian && validasi.errors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-red-700">
              {validasi.errors.map((pesan) => (
                <li key={pesan}>{pesan}</li>
              ))}
            </ul>
          )}
        </div>

        {pesanKonfirmasi && (
          <PeringatanModal
            pesan={pesanKonfirmasi}
            pesanError={errorKonfirmasi}
            sibuk={busy}
            onCancel={() => {
              setPesanKonfirmasi(null);
              setErrorKonfirmasi(null);
            }}
            onSubmit={(alasan) => {
              void simpan({ konfirmasi: true, alasanPeringatan: alasan });
            }}
          />
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button
            type="button"
            disabled={busy || !formSah}
            onClick={() => void simpan()}
          >
            {busy ? 'Menyimpan…' : 'Simpan Jurnal'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={mintaTutup}
          >
            Batal
          </Button>
          <span className="text-sm text-stone-500">
            Jurnal tersimpan lewat jalur posting yang sama dengan form terpandu;
            audit tercatat otomatis.
          </span>
        </div>

        {lockOpen && (
          <LockModal
            onCancel={() => setLockOpen(false)}
            onSubmit={(alasan) => {
              setLockOpen(false);
              void simpan({ ...saldoAwalPendingRef.current, alasan });
            }}
          />
        )}

        <SaldoAwalGuard
          terbuka={saldoAwalOpen}
          coa={coa}
          sibuk={busy}
          onBatal={() => setSaldoAwalOpen(false)}
          onMulaiTanpa={mulaiTanpaSaldoAwal}
          onSaldoAwalTersimpan={saldoAwalTersimpan}
        />

        {templateTunda !== null && (
          <KonfirmasiModal
            judul="Terapkan template?"
            deskripsi="Baris yang sudah diisi akan ditimpa oleh baris template. Isian yang belum disimpan akan hilang."
            labelYa="Ya, terapkan template"
            sibuk={busy}
            onBatal={() => setTemplateTunda(null)}
            onKonfirmasi={() => {
              const id = templateTunda;
              setTemplateTunda(null);
              terapkanTemplate(id);
            }}
          />
        )}

        {konfirmasiTutup && (
          <KonfirmasiModal
            judul="Tutup editor Jurnal Umum?"
            deskripsi="Isian yang belum disimpan akan hilang. Jurnal yang sudah tersimpan tidak terpengaruh."
            labelYa="Ya, tutup editor"
            sibuk={busy}
            onBatal={() => setKonfirmasiTutup(false)}
            onKonfirmasi={() => {
              setKonfirmasiTutup(false);
              // Tutup konfirmasi lebih dulu agar tumpukan modal mengembalikan
              // fokus ke tombol editor, lalu editor mengembalikannya ke pemicu.
              window.setTimeout(onBatal, 0);
            }}
          />
        )}
    </Modal>
  );
}
