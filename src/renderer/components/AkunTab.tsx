import { useEffect, useMemo, useState } from 'react';
import { COA, type Coa, type CoaTipe } from '../../db/coa.js';
import { api } from '../lib/api.js';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
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

const TIPE_TAMBAHAN: Extract<CoaTipe, 'BEBAN' | 'PENDAPATAN'>[] = [
  'BEBAN',
  'PENDAPATAN',
];

type StatusFilter = 'aktif' | 'nonaktif' | 'semua';
type JenisAksi = 'hapus' | 'nonaktif' | 'aktif';
type AksiTarget = { jenis: JenisAksi; akun: Coa };

export function AkunTab() {
  const [daftar, setDaftar] = useState<Coa[]>([]);
  const [memuat, setMemuat] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [kode, setKode] = useState('');
  const [nama, setNama] = useState('');
  const [tipe, setTipe] = useState<Extract<CoaTipe, 'BEBAN' | 'PENDAPATAN'>>('BEBAN');
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
  }

  function mulaiUbah(a: Coa): void {
    setErr(null);
    setInfo(null);
    setEditKode(a.kode);
    setKode(a.kode);
    setNama(a.nama);
    setTipe(a.tipe === 'PENDAPATAN' ? 'PENDAPATAN' : 'BEBAN');
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
        });
        setInfo(
          `Akun ${baru.kode} — ${baru.nama} tersimpan. Akun langsung tersedia di form transaksi, Jurnal Umum, laporan, dan template impor.`,
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
        await api.akunSetAktif(akun.kode, aktif);
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
              <b>Beban</b> atau <b>Pendapatan</b> baru di sini; akun langsung muncul
              di form transaksi, Jurnal Umum, laporan, dan template impor.
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
          Catatan: akun kas/bank dan akun neraca lain belum bisa ditambah dari layar
          ini. Untuk akun kas/bank baru, hubungi pengembang agar penanda kas ikut diatur.
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
              : 'Gunakan kode 4 digit yang belum dipakai. Beban memakai awalan 5, pendapatan memakai awalan 4.'}
          </p>
          <ErrorBox msg={err} />
          {info && (
            <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-[15px] text-green-800">
              {info}
            </div>
          )}
          <div className="grid max-w-4xl gap-3 md:grid-cols-3">
            <Field label="Kode akun (4 digit)">
              <TextInput
                value={kode}
                inputMode="numeric"
                maxLength={4}
                disabled={busy || Boolean(editKode)}
                placeholder={tipe === 'BEBAN' ? 'cth: 5011' : 'cth: 4043'}
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
                    : 'cth: PENDAPATAN WEWEDALAN'
                }
                onChange={(e) => setNama(e.target.value)}
              />
            </Field>
            <Field label="Jenis akun">
              <Select
                value={tipe}
                disabled={busy || Boolean(editKode)}
                onChange={(e) => {
                  const nilai = e.target.value;
                  setTipe(nilai === 'PENDAPATAN' ? 'PENDAPATAN' : 'BEBAN');
                }}
              >
                {TIPE_TAMBAHAN.map((t) => (
                  <option key={t} value={t}>
                    {LABEL_TIPE[t]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button disabled={busy} onClick={() => void simpan()}>
              {busy ? 'Menyimpan…' : editKode ? 'Simpan Perubahan' : 'Tambah Akun'}
            </Button>
            {editKode && (
              <Button variant="ghost" disabled={busy} onClick={resetForm}>
                Batal
              </Button>
            )}
            <span className="text-helper text-stone-500">
              Posisi normal mengikuti jenis: Beban = Debit, Pendapatan = Kredit.
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
              belum pernah dipakai. Akun bawaan tidak bisa diubah dari layar ini.
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
                <th className="py-2 pr-3">Posisi normal</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {tampil.map((a) => {
                const bawaan = kodeBawaan.has(a.kode);
                const nonaktif = a.aktif === false;
                return (
                  <tr
                    key={a.kode}
                    className={`border-b last:border-0 ${nonaktif ? 'bg-stone-50 text-stone-500' : ''}`}
                  >
                    <td className="whitespace-nowrap py-2 pr-3 font-mono">{a.kode}</td>
                    <td className="py-2 pr-3">{a.nama}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{LABEL_TIPE[a.tipe]}</td>
                    <td className="whitespace-nowrap py-2 pr-3">{a.posisi_normal}</td>
                    <td className="py-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={nonaktif ? 'stone' : 'green'}>
                          {nonaktif ? 'Nonaktif' : 'Aktif'}
                        </Badge>
                        <Badge tone={bawaan ? 'stone' : 'green'}>
                          {bawaan ? 'Bawaan' : 'Tambahan'}
                        </Badge>
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      {bawaan ? (
                        <span className="text-stone-400">—</span>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-1">
                          <Button variant="ghost" onClick={() => mulaiUbah(a)}>
                            Ubah
                          </Button>
                          {nonaktif ? (
                            <Button
                              variant="ghost"
                              onClick={() => setAksiTarget({ jenis: 'aktif', akun: a })}
                            >
                              Aktifkan
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => setAksiTarget({ jenis: 'nonaktif', akun: a })}
                            >
                              Nonaktifkan
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            onClick={() => setAksiTarget({ jenis: 'hapus', akun: a })}
                          >
                            Hapus
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {tampil.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-stone-500">
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
                dihapus permanen. Penghapusan hanya berhasil bila akun belum pernah
                dipakai di jurnal atau panjar. Bila sudah dipakai,
                gunakan <b>Nonaktifkan</b>.
              </>
            ) : aksiTarget.jenis === 'nonaktif' ? (
              <>
                Akun <b>{aksiTarget.akun.kode} — {aksiTarget.akun.nama}</b> tidak
                akan muncul di form input baru. Jurnal dan laporan lama
                tetap utuh dan bisa dibaca.
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
