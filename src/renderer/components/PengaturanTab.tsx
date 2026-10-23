import { useEffect, useRef, useState } from 'react';
import { IDLE_MAKS_MENIT, IDLE_MIN_MENIT } from '../../core/pin.js';
import {
  DEFAULT_PENGATURAN,
  MAKS_KOP_TAMBAHAN,
  MAKS_NAMA_ENTITAS,
  type PengaturanPembukuan,
} from '../../core/pengaturan.js';
import { formatNomorBukti } from '../../core/nomorBukti.js';
import type { AuditLog } from '../../core/types.js';
import {
  formatAksiAudit,
  formatJsonAudit,
  formatWaktuAudit,
} from '../../utils/auditDetail.js';
import { api } from '../lib/api.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';
import {
  Button,
  Card,
  DetailModal,
  ErrorBox,
  Field,
  Select,
  TextArea,
  TextInput,
} from './ui.js';

const OPSI_AKSI = [
  { value: '', label: 'Semua aksi' },
  { value: 'CREATE', label: 'Tambah jurnal / transaksi' },
  { value: 'REVERSAL', label: 'Koreksi jurnal (balik)' },
  { value: 'KOREKSI-ISI-ULANG', label: 'Koreksi & isi ulang' },
  { value: 'TUTUP', label: 'Tutup buku' },
  { value: 'SALDO-AWAL', label: 'Saldo awal' },
  { value: 'ASET', label: 'Inventaris aset' },
  { value: 'PANJAR', label: 'Panjar' },
  { value: 'BACKUP', label: 'Backup' },
  { value: 'RESTORE', label: 'Restore' },
  { value: 'PENGATURAN', label: 'Pengaturan' },
] as const;

const OPSI_LIMIT = [10, 25, 50, 100] as const;

const NAMA_BULAN = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
] as const;

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-stone-500">{label}: </span>
      <span className="font-medium break-all">{value}</span>
    </p>
  );
}

export function PengaturanTab({ idleAwal, onIdleBerubah }: { idleAwal: number; onIdleBerubah: (m: number) => void }) {
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulang, setUlang] = useState('');
  const [idle, setIdle] = useState(String(idleAwal));
  const [errPin, setErrPin] = useState<string | null>(null);
  const [okPin, setOkPin] = useState<string | null>(null);
  const [busyPin, setBusyPin] = useState(false);
  const busyPinRef = useRef(false);
  const [errIdle, setErrIdle] = useState<string | null>(null);
  const [okIdle, setOkIdle] = useState<string | null>(null);
  const [busyIdle, setBusyIdle] = useState(false);
  const busyIdleRef = useRef(false);

  // ---- Pengaturan pembukuan (P1-13) ----
  const [entitas, setEntitas] = useState(DEFAULT_PENGATURAN.namaEntitas);
  const [kopTambahan, setKopTambahan] = useState('');
  const [tanggalMulai, setTanggalMulai] = useState('');
  const [awalBulan, setAwalBulan] = useState(String(DEFAULT_PENGATURAN.awalTahunBuku));
  const [prefix, setPrefix] = useState(DEFAULT_PENGATURAN.prefixNomorBukti);
  const [padding, setPadding] = useState(String(DEFAULT_PENGATURAN.paddingNomorBukti));
  const [errPembukuan, setErrPembukuan] = useState<string | null>(null);
  const [okPembukuan, setOkPembukuan] = useState<string | null>(null);
  const [busyPembukuan, setBusyPembukuan] = useState(false);
  const [memuatPembukuan, setMemuatPembukuan] = useState(true);
  const busyPembukuanRef = useRef(false);

  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditErr, setAuditErr] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [fAksi, setFAksi] = useState('');
  const [fMulai, setFMulai] = useState('');
  const [fSampai, setFSampai] = useState('');
  const [limit, setLimit] = useState<number>(25);
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState<AuditLog | null>(null);

  const digit = (s: string) => s.replace(/\D/g, '').slice(0, 6);

  async function muatAudit() {
    setAuditLoading(true);
    setAuditErr(null);
    try {
      const r = await api.auditList({
        aksi: fAksi || undefined,
        mulai: fMulai || undefined,
        sampai: fSampai || undefined,
        limit,
        offset,
      });
      setAudit(r.rows);
      setAuditTotal(r.total);
    } catch (e) {
      setAuditErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setAuditLoading(false);
    }
  }

  useEffect(() => {
    void muatAudit();
    // Filter & pagination adalah satu-satunya pemicu muat ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fAksi, fMulai, fSampai, limit, offset]);

  function terapkanPembukuan(p: PengaturanPembukuan): void {
    setEntitas(p.namaEntitas);
    setKopTambahan(p.kopTambahan);
    setTanggalMulai(p.tanggalMulaiPembukuan);
    setAwalBulan(String(p.awalTahunBuku));
    setPrefix(p.prefixNomorBukti);
    setPadding(String(p.paddingNomorBukti));
  }

  // Tampilkan nilai tersimpan saat mount (bukan default form).
  useEffect(() => {
    let batal = false;
    void (async () => {
      setMemuatPembukuan(true);
      try {
        const p = await api.pengaturanGet();
        if (!batal) terapkanPembukuan(p);
      } catch (e) {
        if (!batal) setErrPembukuan(pesanError(e, PESAN_MUAT_GAGAL));
      } finally {
        if (!batal) setMemuatPembukuan(false);
      }
    })();
    return () => {
      batal = true;
    };
  }, []);

  // Bila jumlah baris menyusut (mis. filter berubah), jangan biarkan offset
  // melewati halaman terakhir.
  useEffect(() => {
    if (auditTotal > 0 && offset >= auditTotal)
      setOffset(Math.max(0, (Math.ceil(auditTotal / limit) - 1) * limit));
  }, [auditTotal, offset, limit]);

  async function gantiPin() {
    if (busyPinRef.current) return;
    setErrPin(null);
    setOkPin(null);
    if (baru !== ulang) {
      setErrPin('Ulangi PIN tidak sama.');
      return;
    }
    busyPinRef.current = true;
    setBusyPin(true);
    try {
      await api.lockChange(lama, baru);
      setOkPin('PIN berhasil diganti.');
      setLama('');
      setBaru('');
      setUlang('');
      void muatAudit();
    } catch (e) {
      setErrPin(pesanError(e));
    } finally {
      busyPinRef.current = false;
      setBusyPin(false);
    }
  }

  async function simpanIdle() {
    if (busyIdleRef.current) return;
    setErrIdle(null);
    setOkIdle(null);
    busyIdleRef.current = true;
    setBusyIdle(true);
    try {
      const r = await api.lockIdleSet(Number(idle));
      setOkIdle(`Auto-kunci disimpan: ${r.idleMenit} menit.`);
      onIdleBerubah(r.idleMenit);
      void muatAudit();
    } catch (e) {
      setErrIdle(pesanError(e));
    } finally {
      busyIdleRef.current = false;
      setBusyIdle(false);
    }
  }

  async function simpanPembukuan() {
    if (busyPembukuanRef.current) return;
    setErrPembukuan(null);
    setOkPembukuan(null);
    busyPembukuanRef.current = true;
    setBusyPembukuan(true);
    try {
      const hasil = await api.pengaturanSimpan({
        namaEntitas: entitas,
        kopTambahan,
        tanggalMulaiPembukuan: tanggalMulai,
        awalTahunBuku: Number(awalBulan),
        prefixNomorBukti: prefix,
        paddingNomorBukti: Number(padding),
      });
      terapkanPembukuan(hasil);
      setOkPembukuan('Pengaturan pembukuan disimpan.');
      void muatAudit();
    } catch (e) {
      setErrPembukuan(pesanError(e));
    } finally {
      busyPembukuanRef.current = false;
      setBusyPembukuan(false);
    }
  }

  const tahunContoh = new Date().getFullYear();
  let pratinjauNomor = '—';
  try {
    pratinjauNomor = formatNomorBukti(tahunContoh, 1, prefix, Number(padding));
  } catch {
    pratinjauNomor = '—';
  }

  const halaman = Math.floor(offset / limit) + 1;
  const totalHalaman = Math.max(1, Math.ceil(auditTotal / limit));

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-lg font-bold">Kunci Aplikasi (PIN)</h2>
        <p className="mb-3 text-sm text-stone-600">
          Aplikasi selalu minta PIN setiap dibuka. Ganti PIN bila perlu — PIN lama wajib benar.
        </p>
        <ErrorBox msg={errPin} />
        {okPin && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{okPin}</div>
        )}
        <div className="grid max-w-lg gap-3">
          <Field label="PIN lama">
            <TextInput type="password" inputMode="numeric" value={lama} onChange={(e) => setLama(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <Field label="PIN baru 6 digit">
            <TextInput type="password" inputMode="numeric" value={baru} onChange={(e) => setBaru(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <Field label="Ulangi PIN baru">
            <TextInput type="password" inputMode="numeric" value={ulang} onChange={(e) => setUlang(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <div>
            <Button
              disabled={busyPin || lama.length !== 6 || baru.length !== 6 || ulang !== baru}
              onClick={() => void gantiPin()}
            >
              {busyPin ? 'Menyimpan…' : 'Ganti PIN'}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Auto-kunci saat idle</h2>
        <p className="mb-3 text-sm text-stone-600">
          Aplikasi mengunci sendiri bila tidak dipakai. Atur {IDLE_MIN_MENIT}–{IDLE_MAKS_MENIT} menit.
        </p>
        <ErrorBox msg={errIdle} />
        {okIdle && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{okIdle}</div>
        )}
        <div className="flex max-w-lg items-end gap-2">
          <div className="flex-1">
            <Field label={`Idle (menit, ${IDLE_MIN_MENIT}–${IDLE_MAKS_MENIT})`}>
              <TextInput type="number" min={IDLE_MIN_MENIT} max={IDLE_MAKS_MENIT} value={idle} onChange={(e) => setIdle(e.target.value)} />
            </Field>
          </div>
          <Button disabled={busyIdle} onClick={() => void simpanIdle()}>
            {busyIdle ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Pengaturan Pembukuan</h2>
        <p className="mb-3 text-sm text-stone-600">
          Nama entitas dan kop tambahan dipakai di semua laporan Excel &amp; PDF.
          Nomor bukti baru mengikuti prefix dan jumlah digit di bawah; nomor lama
          tidak berubah.
        </p>
        <ErrorBox msg={errPembukuan} />
        {okPembukuan && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{okPembukuan}</div>
        )}
        {memuatPembukuan ? (
          <p className="text-sm text-stone-500">Memuat pengaturan…</p>
        ) : (
          <div className="grid max-w-2xl gap-3 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Nama entitas (kop laporan)">
                <TextInput
                  value={entitas}
                  maxLength={MAKS_NAMA_ENTITAS}
                  onChange={(e) => setEntitas(e.target.value)}
                  placeholder="PURA DALEM PURI PELIATAN"
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label={`Kop tambahan (opsional, maks. 2 baris / ${MAKS_KOP_TAMBAHAN} karakter)`}>
                <TextArea
                  value={kopTambahan}
                  maxLength={MAKS_KOP_TAMBAHAN}
                  rows={2}
                  onChange={(e) => setKopTambahan(e.target.value)}
                  placeholder={'cth: Jl. Raya Peliatan\nDesa Peliatan, Ubud'}
                />
              </Field>
            </div>
            <Field label="Tanggal mulai pembukuan (opsional)">
              <TextInput
                type="date"
                value={tanggalMulai}
                onChange={(e) => setTanggalMulai(e.target.value)}
              />
            </Field>
            <Field label="Awal tahun buku">
              <Select value={awalBulan} onChange={(e) => setAwalBulan(e.target.value)}>
                {NAMA_BULAN.map((nama, i) => (
                  <option key={nama} value={String(i + 1)}>
                    {i + 1} — {nama}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Prefix nomor bukti (1–8 huruf/angka)">
              <TextInput
                value={prefix}
                maxLength={8}
                onChange={(e) =>
                  setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))
                }
                placeholder="JU"
              />
            </Field>
            <Field label="Jumlah digit urutan (3–6)">
              <Select value={padding} onChange={(e) => setPadding(e.target.value)}>
                {[3, 4, 5, 6].map((n) => (
                  <option key={n} value={String(n)}>{n} digit</option>
                ))}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <p className="text-sm text-stone-600">
                Contoh nomor bukti: <span className="font-mono font-semibold">{pratinjauNomor}</span>
              </p>
            </div>
            <div className="md:col-span-2">
              <Button disabled={busyPembukuan} onClick={() => void simpanPembukuan()}>
                {busyPembukuan ? 'Menyimpan…' : 'Simpan Pengaturan Pembukuan'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Riwayat Audit</h2>
        <p className="mb-3 text-sm text-stone-600">
          Semua perubahan penting tercatat: jurnal, koreksi, tutup buku, aset, backup/restore,
          panjar, dan pengaturan. Data sebelum/sesudah bisa dibuka per baris.
        </p>

        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Aksi">
            <Select
              value={fAksi}
              onChange={(e) => {
                setFAksi(e.target.value);
                setOffset(0);
              }}
            >
              {OPSI_AKSI.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Dari tanggal">
            <TextInput
              type="date"
              value={fMulai}
              onChange={(e) => {
                setFMulai(e.target.value);
                setOffset(0);
              }}
            />
          </Field>
          <Field label="Sampai tanggal">
            <TextInput
              type="date"
              value={fSampai}
              onChange={(e) => {
                setFSampai(e.target.value);
                setOffset(0);
              }}
            />
          </Field>
          <Field label="Baris per halaman">
            <Select
              value={String(limit)}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
            >
              {OPSI_LIMIT.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </Select>
          </Field>
        </div>

        <ErrorBox msg={auditErr} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Waktu</th>
                <th className="py-2 pr-3">Aksi</th>
                <th className="py-2 pr-3">Alasan</th>
                <th className="py-2 pr-3">Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap py-2 pr-3">{formatWaktuAudit(a.tanggal)}</td>
                  <td className="py-2 pr-3">{formatAksiAudit(a.aksi)}</td>
                  <td className="py-2 pr-3">{a.alasan || '-'}</td>
                  <td className="py-2 pr-3">
                    <Button variant="ghost" onClick={() => setDetail(a)}>Lihat</Button>
                  </td>
                </tr>
              ))}
              {!auditLoading && audit.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-stone-500">
                    Belum ada catatan audit untuk filter ini.
                  </td>
                </tr>
              )}
              {auditLoading && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-stone-500">Memuat…</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-stone-600">
            Menampilkan {audit.length === 0 ? 0 : offset + 1}–{offset + audit.length} dari {auditTotal} catatan.
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              disabled={offset <= 0 || auditLoading}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Sebelumnya
            </Button>
            <span className="text-sm text-stone-600">Halaman {halaman}/{totalHalaman}</span>
            <Button
              variant="ghost"
              disabled={offset + limit >= auditTotal || auditLoading}
              onClick={() => setOffset(offset + limit)}
            >
              Berikutnya
            </Button>
          </div>
        </div>
      </Card>

      {detail && (
        <DetailModal title="Detail audit" onClose={() => setDetail(null)}>
          <Baris label="Waktu" value={formatWaktuAudit(detail.tanggal)} />
          <Baris label="Aksi" value={formatAksiAudit(detail.aksi)} />
          <Baris label="Alasan" value={detail.alasan || '-'} />
          <div>
            <p className="text-stone-500">Sebelum</p>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-50 p-2 text-xs">
              {formatJsonAudit(detail.data_lama_json)}
            </pre>
          </div>
          <div>
            <p className="text-stone-500">Sesudah</p>
            <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-50 p-2 text-xs">
              {formatJsonAudit(detail.data_baru_json)}
            </pre>
          </div>
        </DetailModal>
      )}
    </div>
  );
}
