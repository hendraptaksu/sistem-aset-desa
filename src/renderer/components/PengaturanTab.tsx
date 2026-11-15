import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { IDLE_MAKS_MENIT, IDLE_MIN_MENIT } from '../../core/pin.js';
import {
  DEFAULT_PENGATURAN,
  MAKS_KOP_TAMBAHAN,
  MAKS_NAMA_ENTITAS,
  type PengaturanPembukuanPublik,
} from '../../core/pengaturan.js';
import { formatNomorBukti } from '../../core/nomorBukti.js';
import { temuanKritis } from '../../core/auditAwalRingkasan.js';
import type { HasilAuditIntegritas } from '../../db/integritas.js';
import type { AuditLog } from '../../core/types.js';
import {
  formatAksiAudit,
  formatWaktuAudit,
} from '../../utils/auditDetail.js';
import { tanggalLokal, tahunLokal } from '../../utils/tanggal.js';
import { api, type JenisFolderLokasiApi, type LokasiData } from '../lib/api.js';
import { AuditDetail } from './AuditDetail.js';
import { KodeDaruratModal } from './KodeDaruratModal.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';
import {
  ALASAN_SIBUK,
  alasanTombolNonaktif,
  Badge,
  Button,
  Card,
  DetailModal,
  ErrorBox,
  Field,
  InfoBox,
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
  { value: 'TUTUP', label: 'Kunci periode' },
  { value: 'SALDO-AWAL', label: 'Saldo awal' },
  { value: 'PANJAR', label: 'Panjar' },
  { value: 'BACKUP', label: 'Backup' },
  { value: 'RESTORE', label: 'Pulihkan' },
  { value: 'PENGATURAN', label: 'Pengaturan' },
] as const;

const OPSI_LIMIT = [10, 25, 50, 100] as const;

/** DB-27: jenis referensi audit yang ditulis aplikasi. */
const OPSI_REF = [
  { value: '', label: 'Semua referensi' },
  { value: 'jurnal', label: 'Jurnal' },
  { value: 'panjar', label: 'Panjar' },
  { value: 'pinjaman', label: 'Pinjaman LPD' },
  { value: 'tutup_buku', label: 'Kunci periode' },
  { value: 'akun', label: 'Akun' },
] as const;

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-stone-500">{label}: </span>
      <span className="font-medium break-all">{value}</span>
    </p>
  );
}

/** Data mentah temuan untuk diagnosis; pola `<pre>` sama dengan AuditDetail. */
function TeksDetail({ detail }: { detail: unknown }) {
  let teks: string;
  try {
    teks = JSON.stringify(detail, null, 2) ?? String(detail);
  } catch {
    teks = String(detail);
  }
  return (
    <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-50 p-2 text-xs">
      {teks}
    </pre>
  );
}

/**
 * UI-A08: tempat melihat ulang hasil audit integritas (kode temuan, pesan,
 * dan data mentah). Banner startup hanya pemberitahuan ringkas; kartu ini
 * yang merender daftar lengkap `api.auditIntegritas()`.
 *
 * Muat manual via tombol, bukan otomatis: audit memindai seluruh database
 * (puluhan query) dan tab Pengaturan sering dibuka untuk keperluan lain, jadi
 * tidak ada IPC berat yang berjalan tanpa diminta. Hasil ditampilkan sampai
 * dijalankan ulang.
 */
export function AuditIntegritasCard() {
  const [hasil, setHasil] = useState<HasilAuditIntegritas | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const sibukRef = useRef(false);

  async function jalankanAudit(): Promise<void> {
    if (sibukRef.current) return;
    sibukRef.current = true;
    setSibuk(true);
    setErr(null);
    try {
      setHasil(await api.auditIntegritas());
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      sibukRef.current = false;
      setSibuk(false);
    }
  }

  const temuan = hasil?.temuan ?? [];
  const adaKritis = temuan.some((t) => temuanKritis(t));

  return (
    <div id="audit-integritas" className="scroll-mt-24">
      <Card>
        <h2 className="mb-1 text-lg font-bold">Audit Integritas</h2>
        <p className="mb-3 text-sm text-stone-600">
          Pemeriksaan konsistensi pembukuan: jurnal seimbang, panjar, pinjaman,
          dan Ringkasan terkunci. Audit hanya membaca data, tidak mengubah apa pun.
        </p>
        <ErrorBox msg={err} />
        {!hasil && !err && (
          <p className="text-sm text-stone-500" role="status">
            Belum diperiksa pada sesi ini. Temuan saat aplikasi dibuka muncul di
            banner; jalankan audit di sini untuk melihat daftar lengkapnya.
          </p>
        )}        {hasil && temuan.length === 0 && (
          <InfoBox className="text-sm">
            <p className="font-semibold">Lolos audit integritas.</p>
            <p>{hasil.ringkasan}</p>
          </InfoBox>
        )}
        {hasil && temuan.length > 0 && (
          <div
            className={clsx(
              'rounded-lg border px-3 py-2 text-sm',
              adaKritis
                ? 'border-red-300 bg-red-50 text-red-800'
                : 'border-amber-300 bg-amber-50 text-amber-900',
            )}
          >
            <p className="font-semibold">{hasil.ringkasan}</p>
            <ul className="mt-2 space-y-2">
              {temuan.map((t, i) => (
                <li key={`${t.kode}-${i}`} className="break-words">
                  <div className="flex flex-wrap items-center gap-2">
                    {temuanKritis(t) && <Badge tone="red">Kritis</Badge>}
                  </div>
                  <p>{t.pesan}</p>
                  <details className="mt-1 text-stone-600">
                    <summary className="cursor-pointer text-helper">
                      Detail teknis (untuk pendamping)
                    </summary>
                    <p className="mt-1 font-mono text-xs">{t.kode}</p>
                    {t.detail != null && <TeksDetail detail={t.detail} />}
                  </details>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3">
          <Button disabled={sibuk} onClick={() => void jalankanAudit()}>
            {sibuk
              ? 'Memeriksa…'
              : hasil
                ? 'Jalankan ulang audit'
                : 'Jalankan audit integritas'}
          </Button>
        </div>
      </Card>
    </div>
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
            Untuk akuntan pendamping atau pemeriksa. Menampilkan menu{' '}
            <b>Jurnal Umum</b> berisi jurnal debit/kredit mentah.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge tone={aktif ? 'green' : 'stone'}>
            {aktif ? 'Aktif' : 'Nonaktif'}
          </Badge>
          {aktif ? (
            <Button variant="ghost" onClick={() => onBerubah(false)}>
              Nonaktifkan mode lanjutan
            </Button>
          ) : (
            <Button onClick={() => setKonfirmasi(true)}>
              Aktifkan mode lanjutan
            </Button>
          )}
        </div>
      </div>

      {konfirmasi && (
        <KonfirmasiModal
          judul="Aktifkan mode lanjutan?"
          deskripsi={
            <p>
              Menu <b>Jurnal Umum</b> menampilkan jurnal debit/kredit mentah
              untuk pemeriksaan. Jurnal tersimpan tidak bisa diedit; koreksi
              memakai jurnal balik atau form terpandu.
            </p>
          }
          labelYa="Ya, aktifkan mode lanjutan"
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
  onPembukuanBerubah,
}: {
  idleAwal: number;
  kodeDaruratDiatur: boolean;
  onIdleBerubah: (m: number) => void;
  modeLanjutan: boolean;
  onModeLanjutanBerubah: (aktif: boolean) => void;
  /** Dipanggil setelah nama entitas/kop tersimpan agar shell ikut diperbarui. */
  onPembukuanBerubah?: () => void;
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
  const [tanggalMulaiTersimpan, setTanggalMulaiTersimpan] = useState('');
  const [konfirmasiKosongkanTanggal, setKonfirmasiKosongkanTanggal] = useState(false);
  const [prefix, setPrefix] = useState(DEFAULT_PENGATURAN.prefixNomorBukti);
  const [padding, setPadding] = useState(String(DEFAULT_PENGATURAN.paddingNomorBukti));
  const [errMuatPembukuan, setErrMuatPembukuan] = useState<string | null>(null);
  const [errSimpanPembukuan, setErrSimpanPembukuan] = useState<string | null>(null);
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
  // UI-A04: penanda permintaan muat riwayat audit. Respons yang kembali saat
  // penanda sudah bergeser dianggap basi agar hasil terakhir selalu sesuai
  // filter terakhir di layar.
  const idPermintaan = useRef(0);

  const digit = (s: string) => s.replace(/\D/g, '').slice(0, 6);

  // UI-A04: setiap mulai muat naikkan penanda; respons basi tidak boleh
  // menimpa hasil lebih baru.
  async function muatAudit() {
    const id = ++idPermintaan.current;
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
      if (id !== idPermintaan.current) return;
      setAudit(r.rows);
      setAuditTotal(r.total);
    } catch (e) {
      if (id !== idPermintaan.current) return;
      setAuditErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      if (id === idPermintaan.current) setAuditLoading(false);
    }
  }

  useEffect(() => {
    // UI-A04: debounce 250 ms (pola serupa SaranNomorBukti) supaya filter teks
    // tidak menembak IPC per ketikan huruf.
    const timer = setTimeout(() => {
      void muatAudit();
    }, 250);
    return () => clearTimeout(timer);
    // Filter & pagination adalah satu-satunya pemicu muat ulang.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fAksi, fRefType, fRefId, fMulai, fSampai, limit, offset]);

  function terapkanPembukuan(p: PengaturanPembukuanPublik): void {
    setEntitas(p.namaEntitas);
    setKopTambahan(p.kopTambahan);
    setTanggalMulai(p.tanggalMulaiPembukuan);
    setTanggalMulaiTersimpan(p.tanggalMulaiPembukuan);
    setPrefix(p.prefixNomorBukti);
    setPadding(String(p.paddingNomorBukti));
  }

  // UI-A05: muat pengaturan pembukuan; dipakai saat mount dan tombol "Coba
  // muat ulang". Sukses → errPembukuan dibersihkan dan form kembali normal
  // dengan data asli. Penanda batal mencegah respons lambat mengisi state
  // setelah komponen dilepas.
  const batalMuatPembukuan = useRef(false);

  async function muatPembukuan(): Promise<void> {
    batalMuatPembukuan.current = false;
    setErrMuatPembukuan(null);
    setMemuatPembukuan(true);
    try {
      const p = await api.pengaturanGet();
      if (batalMuatPembukuan.current) return;
      terapkanPembukuan(p);
    } catch (e) {
      if (batalMuatPembukuan.current) return;
      setErrMuatPembukuan(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      if (!batalMuatPembukuan.current) setMemuatPembukuan(false);
    }
  }

  // Tampilkan nilai tersimpan saat mount (bukan default form). Muat hanya
  // sekali saat mount; muat ulang dipicu tombol "Coba muat ulang".
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    void muatPembukuan();
    return () => {
      batalMuatPembukuan.current = true;
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
      setErrPin('PIN ulangan belum sama dengan PIN baru.');
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
      setOkIdle(`Kunci otomatis disimpan: ${r.idleMenit} menit.`);
      onIdleBerubah(r.idleMenit);
      void muatAudit();
    } catch (e) {
      setErrIdle(pesanError(e));
    } finally {
      busyIdleRef.current = false;
      setBusyIdle(false);
    }
  }

  async function simpanPembukuan(konfirmasiKosongkan = false) {
    if (busyPembukuanRef.current) return;
    if (!konfirmasiKosongkan && !tanggalMulai && tanggalMulaiTersimpan) {
      setKonfirmasiKosongkanTanggal(true);
      return;
    }
    setErrSimpanPembukuan(null);
    setOkPembukuan(null);
    busyPembukuanRef.current = true;
    setBusyPembukuan(true);
    try {
      const hasil = await api.pengaturanSimpan(
        {
          namaEntitas: entitas,
          kopTambahan,
          tanggalMulaiPembukuan: tanggalMulai,
          prefixNomorBukti: prefix,
          paddingNomorBukti: Number(padding),
        },
        { konfirmasiKosongkanTanggalMulai: konfirmasiKosongkan },
      );
      terapkanPembukuan(hasil);
      setOkPembukuan('Pengaturan pembukuan disimpan.');
      setErrSimpanPembukuan(null);
      onPembukuanBerubah?.();
      void muatAudit();
    } catch (e) {
      setErrSimpanPembukuan(pesanError(e));
    } finally {
      busyPembukuanRef.current = false;
      setBusyPembukuan(false);
    }
  }

  const tahunContoh = tahunLokal();
  // UI-A26: awalan kosong ditolak backend; tampilkan alasan yang sama di
  // pratinjau agar tidak tampak seperti mode "tanpa awalan" yang valid.
  let pratinjauNomor: string;
  if (!prefix.trim()) {
    pratinjauNomor = 'Awalan belum diisi — isi 1–8 huruf/angka.';
  } else {
    try {
      pratinjauNomor = formatNomorBukti(tahunContoh, 1, prefix, Number(padding));
    } catch {
      pratinjauNomor = '—';
    }
  }

  // UI-A05: bila pengaturan gagal dimuat, semua input pembukuan mati dan
  // Simpan nonaktif agar setting tersimpan tidak tertimpa nilai default form.
  // Kegagalan simpan tidak mengunci form — operator cukup memperbaiki isian.
  const pembukuanTerkunci = errMuatPembukuan !== null;
  const barisKop = kopTambahan.split('\n').length;
  const alasanSimpanPembukuan = !entitas.trim()
    ? 'Nama entitas belum diisi.'
    : !prefix.trim()
      ? 'Awalan nomor bukti belum diisi.'
      : barisKop > 2
        ? 'Kop tambahan maksimal 2 baris.'
        : tanggalMulai > tanggalLokal()
          ? 'Tanggal mulai pembukuan tidak boleh di masa depan.'
          : null;

  const halaman = Math.floor(offset / limit) + 1;
  const totalHalaman = Math.max(1, Math.ceil(auditTotal / limit));

  return (
    <div className="space-y-4">
      <h1 className="sr-only">Pengaturan</h1>
      <ModeLanjutanCard
        aktif={modeLanjutan}
        onBerubah={onModeLanjutanBerubah}
      />
      <Card>
        <h2 className="mb-1 text-lg font-bold">Kunci Aplikasi (PIN)</h2>
        <p className="mb-3 text-sm text-stone-600">
          Aplikasi meminta PIN setiap kali dibuka. Untuk mengganti PIN, isi PIN lama,
          PIN baru, lalu ulangi PIN baru.
        </p>
        <ErrorBox msg={errPin} />
        {okPin && (
          <InfoBox className="mb-2">{okPin}</InfoBox>
        )}
        <div className="grid max-w-lg gap-3">
          {/* UI-A22: autoComplete membantu manajer sandi membedakan PIN lama/baru. */}
          <Field label="PIN lama">
            <TextInput type="password" inputMode="numeric" autoComplete="current-password" value={lama} onChange={(e) => setLama(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <Field label="PIN baru 6 digit">
            <TextInput type="password" inputMode="numeric" autoComplete="new-password" value={baru} onChange={(e) => setBaru(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <Field label="Ulangi PIN baru">
            <TextInput type="password" inputMode="numeric" autoComplete="new-password" value={ulang} onChange={(e) => setUlang(digit(e.target.value))} placeholder="••••••" />
          </Field>
          <div>
            <Button
              disabled={busyPin || lama.length !== 6 || baru.length !== 6 || ulang !== baru}
              title={
                busyPin
                  ? ALASAN_SIBUK
                  : 'Isi PIN lama, PIN baru, dan ulangi PIN baru (masing-masing 6 digit).'
              }
              onClick={() => void gantiPin()}
            >
              {busyPin ? 'Menyimpan…' : 'Ganti PIN'}
            </Button>
            {(lama.length !== 6 || baru.length !== 6 || ulang !== baru) && (
              <p className="mt-1 text-helper text-stone-500" role="status">
                {lama.length !== 6
                  ? 'PIN lama harus 6 digit.'
                  : baru.length !== 6
                    ? 'PIN baru harus 6 digit.'
                    : 'PIN ulangan belum sama dengan PIN baru.'}
              </p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Kode Darurat</h2>
        <p className="mb-3 text-sm text-stone-600">
          Kode darurat dipakai bila PIN lupa. Kode hanya ditampilkan <b>sekali</b>
          saat dibuat — catat dan simpan di tempat aman. Setelah diganti, kode lama
          langsung tidak berlaku.
        </p>
        <ErrorBox msg={errKode} />
        {okKode && (
          <InfoBox className="mb-2">{okKode}</InfoBox>
        )}
        <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px]">
          Status:{' '}
          <b>
            {kodeDiatur ? 'Kode darurat sudah diatur' : 'Kode darurat belum diatur'}
          </b>
        </div>
        <div className="mt-3">
          <Button
            disabled={busyKode}
            title={busyKode ? ALASAN_SIBUK : undefined}
            onClick={() => setKonfirmasiKode(true)}
          >
            {kodeDiatur ? 'Ganti kode darurat' : 'Atur kode darurat'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Kunci otomatis</h2>
        <p className="mb-3 text-sm text-stone-600">
          Aplikasi mengunci sendiri setelah tidak ada aktivitas selama{' '}
          {IDLE_MIN_MENIT}–{IDLE_MAKS_MENIT} menit.
        </p>
        <ErrorBox msg={errIdle} />
        {okIdle && (
          <InfoBox className="mb-2">{okIdle}</InfoBox>
        )}
        <div className="flex max-w-lg items-end gap-2">
          <div className="flex-1">
            <Field label={`Menit tanpa aktivitas (${IDLE_MIN_MENIT}–${IDLE_MAKS_MENIT})`}>
              <TextInput type="number" min={IDLE_MIN_MENIT} max={IDLE_MAKS_MENIT} value={idle} onChange={(e) => setIdle(e.target.value)} />
            </Field>
          </div>
          <Button
            disabled={busyIdle}
            title={busyIdle ? ALASAN_SIBUK : undefined}
            onClick={() => void simpanIdle()}
          >
            {busyIdle ? 'Menyimpan…' : 'Simpan'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Pengaturan Pembukuan</h2>
        <p className="mb-3 text-sm text-stone-600">
          Nama entitas dan kop tambahan dipakai di semua laporan Excel &amp; PDF.
          Nomor bukti baru mengikuti awalan dan jumlah digit di bawah; nomor lama
          tidak berubah.
        </p>
        <ErrorBox msg={errMuatPembukuan} />
        {okPembukuan && (
          <InfoBox className="mb-2">{okPembukuan}</InfoBox>
        )}
        {errMuatPembukuan !== null && (
          <div className="mb-2">
            <Button variant="ghost" disabled={memuatPembukuan} onClick={() => void muatPembukuan()}>
              Coba muat ulang
            </Button>
          </div>
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
                  disabled={pembukuanTerkunci}
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
                  disabled={pembukuanTerkunci}
                  onChange={(e) => setKopTambahan(e.target.value)}
                  placeholder={'cth: Jl. Raya Peliatan\nDesa Peliatan, Ubud'}
                />
              </Field>
            </div>
            <Field label="Tanggal mulai pembukuan (opsional)">
              <TextInput
                type="date"
                value={tanggalMulai}
                max={tanggalLokal()}
                disabled={pembukuanTerkunci}
                onChange={(e) => setTanggalMulai(e.target.value)}
              />
            </Field>
            <Field label="Awalan nomor bukti (1–8 huruf/angka)">
              <TextInput
                value={prefix}
                maxLength={8}
                disabled={pembukuanTerkunci}
                onChange={(e) =>
                  setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))
                }
                placeholder="JU"
              />
            </Field>
            <Field label="Jumlah digit urutan (3–6)">
              <Select value={padding} disabled={pembukuanTerkunci} onChange={(e) => setPadding(e.target.value)}>
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
              <ErrorBox msg={errSimpanPembukuan} />
              <Button
                disabled={busyPembukuan || pembukuanTerkunci || alasanSimpanPembukuan !== null}
                title={alasanTombolNonaktif({
                  sibuk: busyPembukuan,
                  alasan: pembukuanTerkunci
                    ? 'Pengaturan gagal dimuat — coba muat ulang dulu.'
                    : alasanSimpanPembukuan,
                })}
                onClick={() => void simpanPembukuan()}
              >
                {busyPembukuan ? 'Menyimpan…' : 'Simpan Pengaturan Pembukuan'}
              </Button>
              {!busyPembukuan && alasanSimpanPembukuan && (
                <p className="text-helper text-stone-500" role="status">
                  {alasanSimpanPembukuan}
                </p>
              )}
            </div>
          </div>
        )}
        {konfirmasiKosongkanTanggal && (
          <KonfirmasiModal
            judul="Kosongkan tanggal mulai pembukuan?"
            deskripsi="Tanggal mulai dipakai sebagai batas bawah transaksi. Bila dikosongkan, aplikasi tidak lagi menolak transaksi sebelum tanggal itu."
            labelYa="Ya, kosongkan"
            labelBatal="Batal"
            onBatal={() => setKonfirmasiKosongkanTanggal(false)}
            onKonfirmasi={() => {
              setKonfirmasiKosongkanTanggal(false);
              void simpanPembukuan(true);
            }}
          />
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-lg font-bold">Lokasi Data &amp; Backup</h2>
        <p className="mb-3 text-sm text-stone-600">
          Lokasi di bawah adalah lokasi yang benar-benar dipakai aplikasi ini.
          Versi portable menyimpan data di folder aplikasi; versi installer
          menyimpannya di folder data pengguna Windows.
        </p>
        <ErrorBox msg={errLokasi} />
        {!lokasi && !errLokasi && (
          <p className="text-sm text-stone-500" role="status">Memuat lokasi data…</p>
        )}
        {lokasi && (
          <div className="space-y-3">
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[15px]">
              Penyimpanan data:{' '}
              <b>
                {lokasi.mode === 'PORTABLE'
                  ? 'Portable — di folder aplikasi'
                  : lokasi.mode === 'INSTALLED'
                    ? 'Installer — di folder data pengguna'
                    : 'Lokasi khusus — ditentukan saat aplikasi dijalankan'}
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
                <p className="text-sm text-stone-500">File data</p>
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
                <li>Beri nama folder bertanggal, mis. <code>backup-2026-10-23</code>.</li>
                <li>Untuk memulihkan, gunakan <b>Pulihkan Lengkap</b> dan pilih folder tersebut.</li>
              </ol>
              <p className="mt-2">
                <b>Backup file data (lanjutan)</b> berisi satu file data tanpa
                keterangan versi; <b>Pulihkan file data (lanjutan)</b> juga tidak
                memeriksa keterangan backup. Backup otomatis harian bukan
                pengganti Backup Lengkap.
              </p>
              {lokasi.mode === 'PORTABLE' && (
                <p className="mt-2">
                  Jangan menjalankan dua salinan portable dari folder berbeda —
                  keduanya memakai data terpisah. Pilih satu folder tetap.
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* UI-A08: hasil audit integritas dirender di kartu tersendiri di atas
          Riwayat Audit (status kini vs catatan sejarah); banner startup
          menunjuk ke kartu ini lewat jangkar #audit-integritas. */}
      <AuditIntegritasCard />

      <Card>
        <h2 className="mb-1 text-lg font-bold">Riwayat Audit</h2>
        <p className="mb-3 text-sm text-stone-600">
          Semua perubahan penting tercatat: jurnal, koreksi, kunci periode, backup/pulihkan,
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

        {/* UI-A16: filter ID referensi adalah jargon internal — sembunyikan
            di bagian lanjutan untuk pendamping. */}
        <details className="mb-3">
          <summary className="min-h-8 cursor-pointer py-1 text-sm font-semibold text-stone-700">
            Filter lanjutan (untuk pendamping)
          </summary>
          <div className="mt-2 max-w-sm">
            <Field label="ID referensi">
              <TextInput
                value={fRefId}
                placeholder="Tempel ID dari pendamping"
                onChange={(e) => {
                  setFRefId(e.target.value);
                  setOffset(0);
                }}
              />
            </Field>
          </div>
        </details>

        <ErrorBox msg={auditErr} />
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th scope="col" className="py-2 pr-3">Waktu</th>
                <th scope="col" className="py-2 pr-3">Aksi</th>
                <th scope="col" className="py-2 pr-3">Alasan</th>
                <th scope="col" className="py-2 pr-3">Detail</th>
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
            <span className="text-sm text-stone-600">Halaman {halaman} dari {totalHalaman}</span>
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
