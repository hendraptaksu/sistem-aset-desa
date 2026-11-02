import { useEffect, useRef, useState } from 'react';
import { IDLE_MAKS_MENIT, IDLE_MIN_MENIT } from '../../core/pin.js';
import {
  AWAL_TAHUN_BUKU_DIDUKUNG,
  DEFAULT_PENGATURAN,
  MAKS_KOP_TAMBAHAN,
  MAKS_NAMA_ENTITAS,
  peringatanAwalTahunBukuLama,
  type PengaturanPembukuan,
} from '../../core/pengaturan.js';
import { formatNomorBukti } from '../../core/nomorBukti.js';
import type { AuditLog } from '../../core/types.js';
import {
  formatAksiAudit,
  formatWaktuAudit,
} from '../../utils/auditDetail.js';
import { tahunLokal } from '../../utils/tanggal.js';
import { api, type JenisFolderLokasiApi, type LokasiData } from '../lib/api.js';
import { AuditDetail } from './AuditDetail.js';
import { KodeDaruratModal } from './KodeDaruratModal.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';
import {
  Badge,
  Button,
  Card,
  DetailModal,
  ErrorBox,
  Field,
  KonfirmasiModal,
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
  { value: 'PANJAR', label: 'Panjar' },
  { value: 'BACKUP', label: 'Backup' },
  { value: 'RESTORE', label: 'Restore' },
  { value: 'PENGATURAN', label: 'Pengaturan' },
] as const;

const OPSI_LIMIT = [10, 25, 50, 100] as const;

/** DB-27: jenis referensi audit yang ditulis aplikasi. */
const OPSI_REF = [
  { value: '', label: 'Semua referensi' },
  { value: 'jurnal', label: 'Jurnal' },
  { value: 'panjar', label: 'Panjar' },
  { value: 'pinjaman', label: 'Pinjaman LPD' },
  { value: 'tutup_buku', label: 'Tutup buku' },
  { value: 'akun', label: 'Akun COA' },
] as const;

/**
 * Field awal tahun buku sengaja tidak berupa pilihan 1–12: sampai tahun buku
 * fiskal didukung penuh, semua laporan memakai Januari–Desember (AUD-20).
 */
export function BidangAwalTahunBuku() {
  return (
    <Field label="Awal tahun buku">
      <TextInput value="Januari (tahun kalender)" disabled readOnly />
      <p className="mt-1 text-sm text-stone-500">
        Tahun buku fiskal (mis. mulai Juli) belum didukung. Semua laporan memakai
        Januari–Desember.
      </p>
    </Field>
  );
}

/** Peringatan data lama; tidak pernah mengubah setting tersimpan. */
export function PeringatanAwalTahunBuku({
  awalTahunBuku,
}: {
  awalTahunBuku: number;
}) {
  const pesan = peringatanAwalTahunBukuLama(awalTahunBuku);
  if (!pesan) return null;
  return (
    <div
      role="alert"
      className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[15px] text-amber-900"
    >
      {pesan}
    </div>
  );
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-stone-500">{label}: </span>
      <span className="font-medium break-all">{value}</span>
    </p>
  );
}

/**
 * DB-26: saklar Mode lanjutan. Menyalakan wajib lewat konfirmasi karena menu
 * Jurnal Umum menampilkan debit/kredit mentah dan hanya untuk akuntan/pemeriksa.
 */
export function ModeLanjutanCard({
  aktif,
  onBerubah,
}: {
  aktif: boolean;
  onBerubah: (aktif: boolean) => void;
}) {
  const [konfirmasi, setKonfirmasi] = useState(false);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="mb-1 text-lg font-bold">Mode lanjutan</h2>
          <p className="text-sm text-stone-600">
            Untuk akuntan pendamping/pemeriksa. Mode ini menampilkan menu{' '}
            <b>Jurnal Umum</b> berisi jurnal debit/kredit untuk pemeriksaan.
            Operator harian tidak perlu membuka ini.
          </p>
        </div>
        <Badge tone={aktif ? 'green' : 'stone'}>
          {aktif ? 'Aktif' : 'Nonaktif'}
        </Badge>
      </div>

      {aktif ? (
        <>
          <p className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
            Menu <b>Jurnal Umum</b> tampil di grup <b>Data &amp; Sistem</b>.
            Jurnal tersimpan tidak boleh diedit/dihapus; koreksi memakai jurnal
            balik atau form terpandu, bukan mengubah jurnal lama.
          </p>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => onBerubah(false)}>
              Nonaktifkan Mode lanjutan
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
            <b>Jurnal Umum = tampilan debit/kredit untuk pemeriksaan. Operator
            harian tidak perlu membuka ini.</b>{' '}
            Koreksi tidak dilakukan dengan mengedit jurnal: gunakan jurnal balik
            atau form terpandu.
          </p>
          <div className="mt-3">
            <Button onClick={() => setKonfirmasi(true)}>
              Aktifkan Mode lanjutan
            </Button>
          </div>
        </>
      )}

      {konfirmasi && (
        <KonfirmasiModal
          judul="Aktifkan Mode lanjutan?"
          deskripsi={
            <>
              <p>
                Mode lanjutan menampilkan menu <b>Jurnal Umum</b>, yaitu tampilan
                jurnal debit/kredit mentah untuk pemeriksaan oleh akuntan
                pendamping/pemeriksa.
              </p>
              <p>
                Operator harian tidak perlu membuka menu ini. Jurnal yang sudah
                tersimpan tidak boleh diedit/dihapus; koreksi tetap memakai
                jurnal balik atau form terpandu.
              </p>
              <p>
                Aktifkan hanya bila Anda memahami risiko salah input jurnal
                manual.
              </p>
            </>
          }
          labelYa="Ya, aktifkan Mode lanjutan"
          variant="primary"
          onBatal={() => setKonfirmasi(false)}
          onKonfirmasi={() => {
            setKonfirmasi(false);
            onBerubah(true);
          }}
        />
      )}
    </Card>
  );
}

export function PengaturanTab({
  idleAwal,
  kodeDaruratDiatur,
  onIdleBerubah,
  modeLanjutan,
  onModeLanjutanBerubah,
}: {
  idleAwal: number;
  kodeDaruratDiatur: boolean;
  onIdleBerubah: (m: number) => void;
  modeLanjutan: boolean;
  onModeLanjutanBerubah: (aktif: boolean) => void;
}) {
  const [lama, setLama] = useState('');
  const [baru, setBaru] = useState('');
  const [ulang, setUlang] = useState('');
  const [idle, setIdle] = useState(String(idleAwal));
  const [errPin, setErrPin] = useState<string | null>(null);
  const [okPin, setOkPin] = useState<string | null>(null);
  const [busyPin, setBusyPin] = useState(false);
  const busyPinRef = useRef(false);

  // ---- Kode darurat per-install (AUD-19) ----
  const [kodeDiatur, setKodeDiatur] = useState(kodeDaruratDiatur);
  const [kodeBaru, setKodeBaru] = useState<string | null>(null);
  const [konfirmasiKode, setKonfirmasiKode] = useState(false);
  const [errKode, setErrKode] = useState<string | null>(null);
  const [okKode, setOkKode] = useState<string | null>(null);
  const [busyKode, setBusyKode] = useState(false);
  const busyKodeRef = useRef(false);

  useEffect(() => setKodeDiatur(kodeDaruratDiatur), [kodeDaruratDiatur]);
  const [errIdle, setErrIdle] = useState<string | null>(null);
  const [okIdle, setOkIdle] = useState<string | null>(null);
  const [busyIdle, setBusyIdle] = useState(false);
  const busyIdleRef = useRef(false);

  // ---- Pengaturan pembukuan (P1-13) ----
  const [entitas, setEntitas] = useState(DEFAULT_PENGATURAN.namaEntitas);
  const [kopTambahan, setKopTambahan] = useState('');
  const [tanggalMulai, setTanggalMulai] = useState('');
  const [awalTersimpan, setAwalTersimpan] = useState(
    DEFAULT_PENGATURAN.awalTahunBuku,
  );
  const [prefix, setPrefix] = useState(DEFAULT_PENGATURAN.prefixNomorBukti);
  const [padding, setPadding] = useState(String(DEFAULT_PENGATURAN.paddingNomorBukti));
  const [errPembukuan, setErrPembukuan] = useState<string | null>(null);
  const [okPembukuan, setOkPembukuan] = useState<string | null>(null);
  const [busyPembukuan, setBusyPembukuan] = useState(false);
  const [memuatPembukuan, setMemuatPembukuan] = useState(true);
  const busyPembukuanRef = useRef(false);

  // ---- Lokasi data & backup (P2-8) ----
  const [lokasi, setLokasi] = useState<LokasiData | null>(null);
  const [errLokasi, setErrLokasi] = useState<string | null>(null);
  const [folderSibuk, setFolderSibuk] = useState<JenisFolderLokasiApi | null>(null);

  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditErr, setAuditErr] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [fAksi, setFAksi] = useState('');
  const [fRefType, setFRefType] = useState('');
  const [fRefId, setFRefId] = useState('');
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
        ref_type: fRefType || undefined,
        ref_id: fRefId || undefined,
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
  }, [fAksi, fRefType, fRefId, fMulai, fSampai, limit, offset]);

  function terapkanPembukuan(p: PengaturanPembukuan): void {
    setEntitas(p.namaEntitas);
    setKopTambahan(p.kopTambahan);
    setTanggalMulai(p.tanggalMulaiPembukuan);
    setAwalTersimpan(p.awalTahunBuku);
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

  // Lokasi data aktual (P2-8): Portable vs Installer tidak boleh ditebak UI.
  useEffect(() => {
    let batal = false;
    void (async () => {
      try {
        const info = await api.infoLokasi();
        if (!batal) setLokasi(info);
      } catch (e) {
        if (!batal) setErrLokasi(pesanError(e, PESAN_MUAT_GAGAL));
      }
    })();
    return () => {
      batal = true;
    };
  }, []);

  async function bukaFolder(jenis: JenisFolderLokasiApi): Promise<void> {
    if (folderSibuk) return;
    setErrLokasi(null);
    setFolderSibuk(jenis);
    try {
      await api.bukaFolder(jenis);
    } catch (e) {
      setErrLokasi(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setFolderSibuk(null);
    }
  }

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

  async function buatKodeDaruratBaru() {
    if (busyKodeRef.current) return;
    setErrKode(null);
    setOkKode(null);
    busyKodeRef.current = true;
    setBusyKode(true);
    try {
      const r = await api.lockResetKode();
      setKonfirmasiKode(false);
      setKodeBaru(r.kodeDarurat);
      setKodeDiatur(true);
      setOkKode('Kode darurat baru dibuat. Kode lama tidak berlaku lagi.');
      void muatAudit();
    } catch (e) {
      setErrKode(pesanError(e));
    } finally {
      busyKodeRef.current = false;
      setBusyKode(false);
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
        awalTahunBuku: AWAL_TAHUN_BUKU_DIDUKUNG,
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

  const tahunContoh = tahunLokal();
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
      <h1 className="text-lg font-bold">Pengaturan</h1>
      <ModeLanjutanCard
        aktif={modeLanjutan}
        onBerubah={onModeLanjutanBerubah}
      />
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
        <h2 className="mb-1 text-lg font-bold">Kode Darurat</h2>
        <p className="mb-3 text-sm text-stone-600">
          Kode darurat dipakai bila PIN lupa. Kode hanya ditampilkan <b>sekali</b> saat
          dibuat, lalu yang tersimpan hanya hash — tidak ada salinan di database.
          Setelah diganti, kode lama langsung tidak berlaku.
        </p>
        <ErrorBox msg={errKode} />
        {okKode && (
          <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">
            {okKode}
          </div>
        )}
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px]">
          Status:{' '}
          <b>
            {kodeDiatur
              ? 'kode darurat sudah diatur untuk instalasi ini'
              : 'kode darurat belum diatur (instalasi lama)'}
          </b>
        </div>
        {!kodeDiatur && (
          <p className="mt-2 text-sm text-amber-800">
            Instalasi lama belum punya kode darurat. Atur sekarang sebelum PIN lupa —
            kode default lama sudah tidak berlaku.
          </p>
        )}
        <div className="mt-3">
          <Button disabled={busyKode} onClick={() => setKonfirmasiKode(true)}>
            {kodeDiatur ? 'Ganti kode darurat' : 'Atur kode darurat'}
          </Button>
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
        <PeringatanAwalTahunBuku awalTahunBuku={awalTersimpan} />
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
            <BidangAwalTahunBuku />
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
        <h2 className="mb-1 text-lg font-bold">Lokasi Data &amp; Backup</h2>
        <p className="mb-3 text-sm text-stone-600">
          Lokasi di bawah adalah lokasi yang benar-benar dipakai aplikasi ini. Pada versi
          <b> portable</b>, data ikut folder aplikasi (bukan AppData); pada versi
          <b> installer</b>, data ada di folder aplikasi Windows.
        </p>
        <ErrorBox msg={errLokasi} />
        {!lokasi && !errLokasi && (
          <p className="text-sm text-stone-500" role="status">Memuat lokasi data…</p>
        )}
        {lokasi && (
          <div className="space-y-3">
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px]">
              Mode: <b>
                {lokasi.mode === 'PORTABLE'
                  ? 'Portable — data di folder aplikasi (exe)'
                  : lokasi.mode === 'INSTALLED'
                    ? 'Installer — data di folder aplikasi Windows'
                    : 'Pengembangan (PURA_DB) — lokasi khusus'}
              </b>
            </div>

            <div className="space-y-2 text-[15px]">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b pb-2">
                <div className="min-w-0">
                  <p className="text-sm text-stone-500">Folder data</p>
                  <p className="break-all font-medium">{lokasi.dataDir}</p>
                </div>
                <Button variant="ghost" disabled={folderSibuk !== null} onClick={() => void bukaFolder('data')}>
                  {folderSibuk === 'data' ? 'Membuka…' : 'Buka Folder'}
                </Button>
              </div>
              <div className="border-b pb-2">
                <p className="text-sm text-stone-500">File database</p>
                <p className="break-all font-medium">{lokasi.dbPath}</p>
              </div>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm text-stone-500">Folder backup</p>
                  <p className="break-all font-medium">{lokasi.backupsDir}</p>
                </div>
                <Button variant="ghost" disabled={folderSibuk !== null} onClick={() => void bukaFolder('backups')}>
                  {folderSibuk === 'backups' ? 'Membuka…' : 'Buka Folder'}
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
              <p className="font-semibold">Cara backup manual yang disarankan:</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>Di Dashboard, tekan <b>Backup Lengkap</b> lalu simpan foldernya ke flashdisk/Drive.</li>
                <li>Simpan folder backup bertanggal, mis. <code>backup-2026-10-23</code>.</li>
                <li>Untuk memulihkan, gunakan <b>Restore Lengkap</b> dan pilih folder tersebut.</li>
              </ol>
              <p className="mt-2">
                <b>Backup Lengkap</b> berisi <code>pura.db</code> dan{' '}
                <code>manifest.json</code>; manifest itulah yang diperiksa saat
                Restore Lengkap.
              </p>
              <p className="mt-2">
                <b>Backup Export .db (lanjutan)</b> hanya berisi database, tanpa
                manifest. <b>Restore Import .db</b> juga hanya memulihkan database
                dan tidak memvalidasi manifest, sehingga selalu meminta konfirmasi
                tambahan. Pakai jalur ini hanya bila diminta pendamping.
              </p>
              <p className="mt-2">
                Backup otomatis harian sengaja berupa satu file{' '}
                <code>auto-YYYY-MM-DD.db</code> karena aplikasi tidak menyimpan
                file bukti terpisah. Backup otomatis bukan pengganti Backup Lengkap.
              </p>
              {lokasi.mode === 'PORTABLE' && (
                <p className="mt-2">
                  Jangan menjalankan dua salinan portable dari folder berbeda — keduanya
                  akan memakai data yang terpisah. Pilih satu folder tetap.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Riwayat Audit</h2>
        <p className="mb-3 text-sm text-stone-600">
          Semua perubahan penting tercatat: jurnal, koreksi, tutup buku, backup/restore,
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
          <Field label="Jenis referensi">
            <Select
              value={fRefType}
              onChange={(e) => {
                setFRefType(e.target.value);
                setOffset(0);
              }}
            >
              {OPSI_REF.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="ID referensi">
            <TextInput
              value={fRefId}
              placeholder="mis. j-... atau p-..."
              onChange={(e) => {
                setFRefId(e.target.value);
                setOffset(0);
              }}
            />
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
          <Baris
            label="Referensi"
            value={
              detail.ref_type || detail.ref_id
                ? `${detail.ref_type || '-'} / ${detail.ref_id || '-'}`
                : '-'
            }
          />
          <Baris label="Alasan" value={detail.alasan || '-'} />
          <div>
            <p className="text-stone-500">Sebelum</p>
            <AuditDetail json={detail.data_lama_json} />
          </div>
          <div>
            <p className="text-stone-500">Sesudah</p>
            <AuditDetail json={detail.data_baru_json} />
          </div>
        </DetailModal>
      )}

      {konfirmasiKode && (
        <KonfirmasiModal
          judul="Buat kode darurat baru?"
          deskripsi={
            <p>
              Kode darurat lama akan langsung <b>tidak berlaku</b>. Kode baru hanya
              ditampilkan sekali setelah dibuat — siapkan kertas untuk mencatatnya.
            </p>
          }
          labelYa="Ya, buat kode baru"
          sibuk={busyKode}
          onBatal={() => setKonfirmasiKode(false)}
          onKonfirmasi={() => void buatKodeDaruratBaru()}
        />
      )}

      {kodeBaru && (
        <KodeDaruratModal
          kode={kodeBaru}
          judul="Simpan kode darurat baru ini"
          onTutup={() => setKodeBaru(null)}
        />
      )}
    </div>
  );
}
