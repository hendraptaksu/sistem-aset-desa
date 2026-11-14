import { useEffect, useMemo, useState } from 'react';
import {
  AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF,
  COA,
  KELOMPOK_KAS,
  KODE_KAS_TAMBAHAN_MAX,
  KODE_KAS_TAMBAHAN_MIN,
  type Coa,
  type CoaTipe,
  type KelompokAkun,
} from '../../db/coa.js';
import { api } from '../lib/api.js';
import {
  ALASAN_SIBUK,
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  InfoBox,
  KonfirmasiModal,
  Select,
  TextInput,
} from './ui.js';
import { PESAN_MUAT_GAGAL, pesanError } from '../../utils/pesanError.js';

const LABEL_TIPE: Record<CoaTipe, string> = {
  AKTIVA: 'Aktiva',
  KEWAJIBAN: 'Kewajiban',
  EKUITAS: 'Ekuitas',
  PENDAPATAN: 'Pendapatan',
  BEBAN: 'Beban',
};

const TIPE_TAMBAHAN: CoaTipe[] = ['BEBAN', 'PENDAPATAN', 'AKTIVA'];
const KELOMPOK_TAMBAHAN: KelompokAkun[] = [...KELOMPOK_KAS];
const LABEL_KELOMPOK: Record<KelompokAkun, string> = {
  KAS: 'Kas',
  BANK: 'Bank',
  LPD: 'LPD',
  PANJAR: 'Panjar',
  PIUTANG: 'Piutang',
  HUTANG: 'Utang',
  EKUITAS: 'Ekuitas',
  PENDAPATAN: 'Pendapatan',
  BEBAN: 'Beban',
};

type StatusFilter = 'aktif' | 'nonaktif' | 'semua';
type JenisAksi = 'hapus' | 'nonaktif' | 'aktif';
type AksiTarget = { jenis: JenisAksi; akun: Coa };

/**
 * DB-15: akun sistem tetap ditampilkan tetapi tombol Nonaktifkan tidak boleh
 * muncul. Akun sistem yang terlanjur nonaktif tetap boleh diaktifkan kembali.
 */
export function akunBolehDinonaktifkan(a: Pick<Coa, 'kode'>): boolean {
  return !AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF.has(String(a.kode));
}

export function AkunTab() {
  const [daftar, setDaftar] = useState<Coa[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kode, setKode] = useState('');
  const [nama, setNama] = useState('');
  const [tipe, setTipe] = useState<CoaTipe>('BEBAN');
  const [kelompok, setKelompok] = useState<KelompokAkun>('BANK');
  const [editKode, setEditKode] = useState<string | null>(null);
  const [cari, setCari] = useState('');
  const [filterTipe, setFilterTipe] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('aktif');
  const [aksiTarget, setAksiTarget] = useState<AksiTarget | null>(null);

  const kodeBawaan = useMemo(() => new Set(COA.map((a) => a.kode)), []);

  async function muat(): Promise<void> {
    setErr(null);
    try {
      setDaftar(await api.coa());
    } catch (e) {
      setErr(pesanError(e, PESAN_MUAT_GAGAL));
    } finally {
      setMemuat(false);
    }
  }

  useEffect(() => {
    void muat();
  }, []);

  const tampil = useMemo(() => {
    const q = cari.trim().toLowerCase();
    return daftar
      .filter((a) => !filterTipe || a.tipe === filterTipe)
      .filter((a) => {
        if (statusFilter === 'semua') return true;
        if (statusFilter === 'aktif') return a.aktif !== false;
        return a.aktif === false;
      })
      .filter((a) => !q || `${a.kode} ${a.nama}`.toLowerCase().includes(q))
      .sort((a, b) => a.kode.localeCompare(b.kode));
  }, [cari, daftar, filterTipe, statusFilter]);

  const jumlahTambahan = daftar.filter((a) => !kodeBawaan.has(a.kode)).length;
  const jumlahNonaktif = daftar.filter((a) => a.aktif === false).length;

  function resetForm(): void {
    setEditKode(null);
    setKode('');
    setNama('');
    setTipe('BEBAN');
    setKelompok('BANK');
  }

  function mulaiUbah(a: Coa): void {
    setErr(null);
    setInfo(null);
    setEditKode(a.kode);
    setKode(a.kode);
    setNama(a.nama);
    setTipe(a.tipe === 'PENDAPATAN' ? 'PENDAPATAN' : a.tipe === 'AKTIVA' ? 'AKTIVA' : 'BEBAN');
    setKelompok(
      a.kelompok === 'KAS' || a.kelompok === 'BANK' || a.kelompok === 'LPD'
        ? a.kelompok
        : 'BANK',
    );
    document.getElementById('form-akun')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function simpan(): Promise<void> {
    if (busy) return;
    setErr(null);
    setInfo(null);

    const kodeBersih = kode.trim();
    const namaBersih = nama.trim();
    if (!editKode && !/^\d{4}$/.test(kodeBersih)) {
      setErr('Kode akun harus 4 digit angka, mis. 5011 atau 4043.');
      return;
    }
    if (!namaBersih) {
      setErr('Nama akun wajib diisi.');
      return;
    }
    if (!editKode) {
      if (tipe === 'AKTIVA') {
        const nomor = Number(kodeBersih);
        if (
          !Number.isInteger(nomor) ||
          nomor < KODE_KAS_TAMBAHAN_MIN ||
          nomor > KODE_KAS_TAMBAHAN_MAX
        ) {
          setErr(
            `Akun kas/bank baru harus memakai kode ${KODE_KAS_TAMBAHAN_MIN}–${KODE_KAS_TAMBAHAN_MAX}.`,
          );
          return;
        }
        if (!KELOMPOK_TAMBAHAN.includes(kelompok)) {
          setErr('Kelompok akun kas/bank harus KAS, BANK, atau LPD.');
          return;
        }
      }
      if (tipe === 'BEBAN' && !kodeBersih.startsWith('5')) {
        setErr('Akun BEBAN harus memakai kode 5xxx, mis. 5011.');
        return;
      }
      if (tipe === 'PENDAPATAN' && !kodeBersih.startsWith('4')) {
        setErr('Akun PENDAPATAN harus memakai kode 4xxx, mis. 4043.');
        return;
      }
      if (daftar.some((a) => a.kode === kodeBersih)) {
        setErr(`Kode akun ${kodeBersih} sudah dipakai. Pilih kode lain.`);
        return;
      }
    }
    if (
      daftar.some(
        (a) =>
          a.kode !== editKode &&
          a.nama.toLowerCase() === namaBersih.toLowerCase(),
      )
    ) {
      setErr(`Nama akun "${namaBersih}" sudah dipakai. Gunakan nama yang membedakan.`);
      return;
    }

    setBusy(true);
    try {
      if (editKode) {
        const hasil = await api.akunUbah({ kode: editKode, nama: namaBersih });
        setInfo(`Nama akun ${hasil.kode} diubah menjadi ${hasil.nama}.`);
      } else {
        const baru = await api.akunTambah({
          kode: kodeBersih,
          nama: namaBersih,
          tipe,
          is_kas: tipe === 'AKTIVA' ? true : false,
          kelompok:
            tipe === 'AKTIVA' ? kelompok : tipe === 'BEBAN' ? 'BEBAN' : 'PENDAPATAN',
        });
        setInfo(
          `Akun ${baru.kode} — ${baru.nama} tersimpan. Akun langsung tersedia di form transaksi, Jurnal Umum, dan laporan.`,
        );
        setStatusFilter('aktif');
      }
      resetForm();
      await muat();
    } catch (e) {
      setErr(pesanError(e, editKode ? 'Gagal mengubah nama akun.' : 'Gagal menambah akun.'));
    } finally {
      setBusy(false);
    }
  }

  async function jalankanAksi(): Promise<void> {
    if (!aksiTarget || busy) return;
    const { jenis, akun } = aksiTarget;
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      if (jenis === 'hapus') {
        await api.akunHapus(akun.kode);
        setInfo(`Akun ${akun.kode} — ${akun.nama} dihapus permanen.`);
      } else {
        const aktif = jenis === 'aktif';
        await api.akunSetAktif(
          akun.kode,
          aktif,
          aktif
            ? `Aktifkan kembali akun ${akun.kode} untuk form input baru`
            : `Nonaktifkan akun ${akun.kode} untuk form input baru`,
        );
        setInfo(
          aktif
            ? `Akun ${akun.kode} — ${akun.nama} diaktifkan kembali.`
            : `Akun ${akun.kode} — ${akun.nama} dinonaktifkan. Histori dan laporan lama tetap utuh.`,
        );
        setStatusFilter(aktif ? 'aktif' : 'nonaktif');
      }
      if (editKode === akun.kode) resetForm();
      setAksiTarget(null);
      await muat();
    } catch (e) {
      setErr(pesanError(e, 'Gagal memproses akun.'));
      setAksiTarget(null);
      document
        .getElementById('form-akun')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } finally {
      setBusy(false);
    }
  }

  const judulAksi =
    aksiTarget?.jenis === 'hapus'
      ? 'Hapus akun?'
      : aksiTarget?.jenis === 'nonaktif'
        ? 'Nonaktifkan akun?'
        : 'Aktifkan akun?';

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">Daftar Akun (COA)</h1>
            <p className="mt-1 max-w-3xl text-sm text-stone-600">
              Akun bawaan mengikuti <b>KODE AKUN.csv</b>. Tambahkan akun{' '}
              <b>Beban</b>, <b>Pendapatan</b>, atau <b>Kas/Bank/LPD</b> baru di sini;
              akun langsung muncul di form transaksi, Jurnal Umum, dan laporan.
              Akun bawaan yang tidak dipakai lagi boleh dinonaktifkan, kecuali akun
              sistem <b>3000/1040/1050/2050/2060/5063/5050</b>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="stone">{daftar.length} akun</Badge>
            <Badge tone="green">{jumlahTambahan} tambahan</Badge>
            {jumlahNonaktif > 0 && (
              <Badge tone="amber">{jumlahNonaktif} nonaktif</Badge>
            )}
          </div>
        </div>
        <p className="mt-2 text-helper text-amber-800">
          Akun kas/bank baru memakai kode kustom {KODE_KAS_TAMBAHAN_MIN}–{KODE_KAS_TAMBAHAN_MAX}
          {' '}agar tidak bentrok dengan daftar akun bawaan. Setelah disimpan, akun langsung
          muncul di Pindah Dana, Panjar, pembayaran, dan total kas.
        </p>
      </Card>

      <div id="form-akun">
        <Card>
          <h2 className="mb-1 text-lg font-bold">
            {editKode ? 'Ubah Nama Akun' : 'Tambah Akun'}
          </h2>
          <p className="mb-3 text-sm text-stone-600">
            {editKode
              ? 'Kode dan jenis akun tetap agar histori jurnal tidak berubah. Hanya nama yang bisa diperbaiki.'
              : 'Gunakan kode 4 digit yang belum dipakai. Beban 5xxx, pendapatan 4xxx, kas/bank/LPD baru 1100–1199.'}
          </p>
          <ErrorBox msg={err} />
          {info && (
            <InfoBox className="mb-2 text-[15px]">{info}</InfoBox>
          )}
          <div className="grid max-w-4xl gap-3 md:grid-cols-3">
            <Field label="Kode akun (4 digit)">
              <TextInput
                value={kode}
                inputMode="numeric"
                maxLength={4}
                disabled={busy || Boolean(editKode)}
                placeholder={
                  tipe === 'BEBAN'
                    ? 'cth: 5011'
                    : tipe === 'PENDAPATAN'
                      ? 'cth: 4043'
                      : 'cth: 1101'
                }
                onChange={(e) => setKode(e.target.value.replace(/\D/g, '').slice(0, 4))}
              />
            </Field>
            <Field label="Nama akun">
              <TextInput
                value={nama}
                maxLength={100}
                disabled={busy}
                placeholder={
                  tipe === 'BEBAN'
                    ? 'cth: BAGA SUAR (AIR, LISTRIK, TELEPON)'
                    : tipe === 'PENDAPATAN'
                      ? 'cth: PENDAPATAN WEWEDALAN'
                      : 'cth: BANK BPD REKENING BARU'
                }
                onChange={(e) => setNama(e.target.value)}
              />
            </Field>
            <Field label="Jenis akun">
              <Select
                value={tipe}
                disabled={busy || Boolean(editKode)}
                onChange={(e) => {
                  const nilai = e.target.value as CoaTipe;
                  setTipe(nilai);
                  if (nilai !== 'AKTIVA') setKelompok('BANK');
                }}
              >
                {TIPE_TAMBAHAN.map((t) => (
                  <option key={t} value={t}>
                    {LABEL_TIPE[t]}
                  </option>
                ))}
              </Select>
            </Field>
            {tipe === 'AKTIVA' ? (
              <>
                <Field label="Kelompok akun">
                  <Select
                    value={kelompok}
                    disabled={busy || Boolean(editKode)}
                    onChange={(e) => setKelompok(e.target.value as KelompokAkun)}
                  >
                    {KELOMPOK_TAMBAHAN.map((k) => (
                      <option key={k} value={k}>
                        {LABEL_KELOMPOK[k]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Dompet kas/bank">
                  <span className="text-[15px] text-stone-600">
                    Akun aktiva otomatis menjadi dompet kas/bank
                  </span>
                </Field>
              </>
            ) : (
              <Field label="Kelompok akun">
                <TextInput
                  value={tipe === 'BEBAN' ? 'BEBAN' : 'PENDAPATAN'}
                  disabled
                  onChange={() => {}}
                />
              </Field>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              disabled={busy}
              title={busy ? ALASAN_SIBUK : undefined}
              onClick={() => void simpan()}
            >
              {busy ? 'Menyimpan…' : editKode ? 'Simpan Perubahan' : 'Tambah Akun'}
            </Button>
            {editKode && (
              <Button variant="ghost" disabled={busy} onClick={resetForm}>
                Batal
              </Button>
            )}
            <span className="text-helper text-stone-500">
              Posisi normal mengikuti jenis: Beban/Kas = Debit, Pendapatan = Kredit.
            </span>
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Akun</h2>
            <p className="mt-1 text-sm text-stone-600">
              Akun tambahan bisa diubah namanya, dinonaktifkan, atau dihapus bila
              belum pernah dipakai. Akun bawaan boleh dinonaktifkan untuk form input
              baru, tetapi nama dan hapusnya tetap terkunci. Akun sistem{' '}
              <b>3000/1040/1050/2050/2060/5063/5050</b> tidak bisa dinonaktifkan.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Cari">
              <TextInput
                value={cari}
                onChange={(e) => setCari(e.target.value)}
                placeholder="Kode atau nama akun"
                className="!w-64"
              />
            </Field>
            <Field label="Jenis">
              <Select value={filterTipe} onChange={(e) => setFilterTipe(e.target.value)}>
                <option value="">Semua jenis</option>
                {Object.entries(LABEL_TIPE).map(([nilai, label]) => (
                  <option key={nilai} value={nilai}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Status">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="aktif">Aktif</option>
                <option value="nonaktif">Nonaktif</option>
                <option value="semua">Semua status</option>
              </Select>
            </Field>
          </div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Kode</th>
                <th className="py-2 pr-3">Nama</th>
                <th className="py-2 pr-3">Jenis</th>
                <th className="py-2 pr-3">Kelompok</th>
                <th className="py-2 pr-3">Posisi normal</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {tampil.map((a) => {
                const bawaan = a.sumber ? a.sumber === 'BAWAAN' : kodeBawaan.has(a.kode);
                const nonaktif = a.aktif === false;
                const sistem = !akunBolehDinonaktifkan(a);
                return (
                  <tr
                    key={a.kode}
                    className={`border-b last:border-0 ${nonaktif ? 'bg-stone-50 text-stone-500' : ''}`}
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-mono">{a.kode}</td>
                    <td className="py-2 pr-3">{a.nama}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{LABEL_TIPE[a.tipe]}</td>
                    <td className="whitespace-nowrap py-2 pr-3">
                      {a.kelompok ? LABEL_KELOMPOK[a.kelompok] : '—'}
                    </td>
                    <td className="whitespace-nowrap py-2 pr-3">{a.posisi_normal}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={nonaktif ? 'stone' : 'green'}>
                          {nonaktif ? 'Nonaktif' : 'Aktif'}
                        </Badge>
                        <Badge tone={bawaan ? 'stone' : 'green'}>
                          {bawaan ? 'Bawaan' : 'Tambahan'}
                        </Badge>
                        {sistem && <Badge tone="amber">Sistem</Badge>}
                        {a.is_kas && <Badge tone="amber">Kas/Bank</Badge>}
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {!bawaan && (
                          <Button variant="ghost" onClick={() => mulaiUbah(a)}>
                            Ubah
                          </Button>
                        )}
                        {nonaktif ? (
                          <Button
                            variant="ghost"
                            onClick={() => setAksiTarget({ jenis: 'aktif', akun: a })}
                          >
                            Aktifkan
                          </Button>
                        ) : sistem ? (
                          <span
                            className="px-2 py-1 text-right text-helper text-stone-500"
                            title="Akun sistem dibutuhkan wizard/alur dan tidak bisa dinonaktifkan."
                          >
                            Akun sistem
                            <span className="block">
                              tidak bisa dinonaktifkan
                            </span>
                          </span>
                        ) : (
                          <Button
                            variant="ghost"
                            onClick={() => setAksiTarget({ jenis: 'nonaktif', akun: a })}
                          >
                            Nonaktifkan
                          </Button>
                        )}
                        {!bawaan && (
                          <Button
                            variant="ghost"
                            onClick={() => setAksiTarget({ jenis: 'hapus', akun: a })}
                          >
                            Hapus
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {tampil.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-stone-500">
                    {memuat
                      ? 'Memuat daftar akun…'
                      : cari || filterTipe || statusFilter !== 'semua'
                        ? 'Tidak ada akun yang cocok dengan filter.'
                        : 'Belum ada akun.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-stone-500">
          Menampilkan {tampil.length} dari {daftar.length} akun.
        </p>
      </Card>

      {aksiTarget && (
        <KonfirmasiModal
          judul={judulAksi}
          deskripsi={
            aksiTarget.jenis === 'hapus' ? (
              <>
                Akun <b>{aksiTarget.akun.kode} — {aksiTarget.akun.nama}</b> akan
                dihapus permanen dan <b>tidak bisa dibatalkan</b>. Penghapusan
                hanya berhasil bila akun belum pernah dipakai di jurnal atau
                panjar. Bila sudah dipakai, gunakan <b>Nonaktifkan</b> agar
                histori dan laporan lama tetap utuh.
              </>
            ) : aksiTarget.jenis === 'nonaktif' ? (
              <>
                Akun <b>{aksiTarget.akun.kode} — {aksiTarget.akun.nama}</b> tidak
                akan muncul di form input baru. <b>Yang tetap:</b> jurnal dan
                laporan lama utuh dan bisa dibaca. Akun bawaan juga tidak bisa
                diubah namanya atau dihapus; status ini bisa diaktifkan kembali
                kapan saja.
              </>
            ) : (
              <>
                Akun <b>{aksiTarget.akun.kode} — {aksiTarget.akun.nama}</b> akan
                aktif kembali dan muncul di form input baru.
              </>
            )
          }
          labelYa={
            aksiTarget.jenis === 'hapus'
              ? 'Ya, hapus permanen'
              : aksiTarget.jenis === 'nonaktif'
                ? 'Ya, nonaktifkan'
                : 'Ya, aktifkan'
          }
          variant={aksiTarget.jenis === 'hapus' ? 'danger' : 'primary'}
          sibuk={busy}
          onBatal={() => setAksiTarget(null)}
          onKonfirmasi={() => void jalankanAksi()}
        />
      )}
    </div>
  );
}
