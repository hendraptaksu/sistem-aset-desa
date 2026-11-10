// Repository tipis di atas better-sqlite3. dipakai Agent A (write) & Agent B (read).
// Kunci longgar ditegakkan di sini: update/delete periode terkunci wajib alasan.

import type Database from 'better-sqlite3';
import { buatAuditLog } from '../core/audit.js';
import { isPeriodeTerkunci } from '../core/periode.js';
import {
  formatNomorBukti,
  nomorBuktiBerikutnya,
  tahunDariTanggal,
} from '../core/nomorBukti.js';
import {
  AWAL_TAHUN_BUKU_DIDUKUNG,
  DEFAULT_PENGATURAN,
  normalisasiPengaturan,
  validasiPengaturan,
  type PengaturanPembukuan,
} from '../core/pengaturan.js';
import { JENIS_JURNAL, tanggalKalenderValid } from '../core/posting.js';
import { parseRupiahToSen } from '../utils/format.js';
import { akhirHariLokalUtc, awalHariLokalUtc } from '../utils/tanggal.js';
import { kemampuanKoreksiJurnal } from './kemampuanKoreksi.js';
import {
  AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF,
  COA,
  KELOMPOK_KAS,
  KODE_KAS_TAMBAHAN_MAX,
  KODE_KAS_TAMBAHAN_MIN,
  PESAN_AKUN_LEGACY,
  POSISI_NORMAL,
  akunBolehDiposting,
  kodeKasDariDaftarAkun,
  type CoaTipe,
  type KelompokAkun,
  type PosisiNormal,
  type SumberAkun,
} from './coa.js';
import type {
  AuditLog,
  Jurnal,
  JurnalBaris,
  JurnalBarisInput,
  JurnalHeaderInput,
  JurnalPeran,
  TutupBuku,
  TutupBukuSnapshot,
} from '../core/types.js';

export type AkunDb = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
  posisi_normal: PosisiNormal;
  aktif: boolean;
  /** DB-14: dompet kas/bank (master DB). */
  is_kas: boolean;
  /** DB-14: kelompok akun (lihat `KelompokAkun`); '' bila belum ditentukan. */
  kelompok: KelompokAkun | '';
  /** DB-14: BAWAAN (COA statis/CSV) atau TAMBAHAN (dibuat operator). */
  sumber: SumberAkun;
};

const rowToAkun = (r: Record<string, unknown>): AkunDb => ({
  kode: String(r.kode),
  nama: String(r.nama),
  tipe: String(r.tipe) as CoaTipe,
  posisi_normal: String(r.posisi_normal) as PosisiNormal,
  aktif: Number(r.aktif) === 1,
  is_kas: Number(r.is_kas) === 1,
  kelompok: String(r.kelompok ?? '') as KelompokAkun | '',
  sumber: String(r.sumber ?? 'BAWAAN') === 'TAMBAHAN' ? 'TAMBAHAN' : 'BAWAAN',
});

/** Daftar akun dari master DB (hasil upsert COA saat openDb). */
export function listAkun(db: Database.Database, opts: { aktif?: boolean } = {}): AkunDb[] {
  const sql = opts.aktif === undefined
    ? 'SELECT * FROM akun ORDER BY kode'
    : 'SELECT * FROM akun WHERE aktif = ? ORDER BY kode';
  const rows = (opts.aktif === undefined
    ? db.prepare(sql).all()
    : db.prepare(sql).all(opts.aktif ? 1 : 0)) as Record<string, unknown>[];
  return rows.map(rowToAkun);
}

export function getAkun(db: Database.Database, kode: string): AkunDb | null {
  const r = db.prepare('SELECT * FROM akun WHERE kode = ?').get(kode) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToAkun(r) : null;
}

/**
 * DB-14: kode dompet dari master `akun` (bukan daftar statis). Default semua
 * akun `is_kas = 1` agar laporan historis tetap lengkap walau akun kelak
 * dinonaktifkan; `aktifSaja` dipakai form input baru.
 */
export function kodeKasDariDb(
  db: Database.Database,
  opsi: { aktifSaja?: boolean } = {},
): string[] {
  return kodeKasDariDaftarAkun(
    listAkun(db, opsi.aktifSaja ? { aktif: true } : {}),
  );
}

/** Kode dompet aktif untuk dropdown form (is_kas = 1 dan aktif = 1). */
export function kodeKasAktifDb(db: Database.Database): string[] {
  return kodeKasDariDb(db, { aktifSaja: true });
}

/** Tipe akun yang boleh ditambah operator dari layar Daftar Akun. */
export const TIPE_AKUN_TAMBAHAN: readonly CoaTipe[] = ['BEBAN', 'PENDAPATAN', 'AKTIVA'];

export type AkunBaruInput = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
  /** DB-14: wajib true untuk AKTIVA kas/bank baru. */
  is_kas?: boolean;
  /** DB-14: KAS/BANK/LPD untuk AKTIVA; BEBAN/PENDAPATAN untuk tipe lain. */
  kelompok?: string;
};

type AkunBaruBersih = {
  kode: string;
  nama: string;
  tipe: CoaTipe;
  is_kas: boolean;
  kelompok: KelompokAkun;
};

function validasiAkunBaru(input: AkunBaruInput): AkunBaruBersih {
  const kode = String(input?.kode ?? '').trim();
  const nama = String(input?.nama ?? '').trim();
  const tipe = String(input?.tipe ?? '').trim() as CoaTipe;
  const kelompokInput = String(input?.kelompok ?? '').trim().toUpperCase();

  if (!/^\d{4}$/.test(kode))
    throw new Error('Kode akun harus 4 digit angka, mis. 5011, 4043, atau 1101.');
  if (!nama) throw new Error('Nama akun wajib diisi.');
  if (nama.length > 100) throw new Error('Nama akun maks. 100 karakter.');
  if (!TIPE_AKUN_TAMBAHAN.includes(tipe))
    throw new Error(
      'Jenis akun tambahan harus BEBAN, PENDAPATAN, atau AKTIVA kas/bank.',
    );

  if (tipe === 'AKTIVA') {
    const nomor = Number(kode);
    if (
      !Number.isInteger(nomor) ||
      nomor < KODE_KAS_TAMBAHAN_MIN ||
      nomor > KODE_KAS_TAMBAHAN_MAX
    )
      throw new Error(
        `Akun kas/bank baru harus memakai kode ${KODE_KAS_TAMBAHAN_MIN}–${KODE_KAS_TAMBAHAN_MAX} (rentang kustom).`,
      );
    if (input?.is_kas !== true)
      throw new Error('Akun kas/bank baru wajib ditandai is_kas = 1.');
    if (!(KELOMPOK_KAS as readonly string[]).includes(kelompokInput))
      throw new Error('Kelompok akun kas/bank harus KAS, BANK, atau LPD.');
    return {
      kode,
      nama,
      tipe,
      is_kas: true,
      kelompok: kelompokInput as KelompokAkun,
    };
  }

  // BEBAN/PENDAPATAN tetap seperti sebelumnya. is_kas harus konsisten dengan
  // tipe dan kelompok tidak boleh bertentangan.
  const kelompokWajib: KelompokAkun = tipe === 'BEBAN' ? 'BEBAN' : 'PENDAPATAN';
  if (input?.is_kas === true)
    throw new Error(`Akun ${tipe} tidak boleh ditandai is_kas = 1.`);
  if (kelompokInput && kelompokInput !== kelompokWajib)
    throw new Error(`Kelompok akun ${tipe} harus ${kelompokWajib}.`);

  // Jaga struktur COA: beban 5xxx, pendapatan 4xxx.
  if (tipe === 'BEBAN' && !kode.startsWith('5'))
    throw new Error('Akun BEBAN harus memakai kode 5xxx, mis. 5011.');
  if (tipe === 'PENDAPATAN' && !kode.startsWith('4'))
    throw new Error('Akun PENDAPATAN harus memakai kode 4xxx, mis. 4043.');

  return {
    kode,
    nama,
    tipe,
    is_kas: false,
    kelompok: kelompokWajib,
  };
}

/**
 * Tambah akun COA baru ke master `akun`.
 *
 * - BEBAN/PENDAPATAN: perilaku lama (kode 5xxx/4xxx).
 * - DB-14 AKTIVA kas/bank/LPD: kode kustom 1100–1199, wajib `is_kas = true`,
 *   kelompok KAS/BANK/LPD, posisi normal DEBIT, sumber TAMBAHAN.
 *
 * Akun tambahan disimpan di database, bukan di kode statis. `coa:list` dan
 * seluruh laporan membaca master DB, sehingga akun langsung tersedia setelah
 * disimpan. Upsert COA statis saat `openDb` tidak menghapus/menimpa baris
 * tambahan.
 */
export function tambahAkun(db: Database.Database, input: AkunBaruInput): AkunDb {
  const bersih = validasiAkunBaru(input);
  const posisi_normal = POSISI_NORMAL[bersih.tipe];

  const simpan = db.transaction(() => {
    if (getAkun(db, bersih.kode))
      throw new Error(`Kode akun ${bersih.kode} sudah dipakai. Pilih kode lain.`);
    const namaDipakai = db
      .prepare('SELECT kode FROM akun WHERE nama = ? COLLATE NOCASE LIMIT 1')
      .get(bersih.nama) as { kode: string } | undefined;
    if (namaDipakai)
      throw new Error(
        `Nama akun "${bersih.nama}" sudah dipakai oleh kode ${namaDipakai.kode}. Gunakan nama yang membedakan.`,
      );

    db.prepare(
      `INSERT INTO akun (kode, nama, tipe, posisi_normal, aktif, is_kas, kelompok, sumber)
       VALUES (?, ?, ?, ?, 1, ?, ?, 'TAMBAHAN')`,
    ).run(
      bersih.kode,
      bersih.nama,
      bersih.tipe,
      posisi_normal,
      bersih.is_kas ? 1 : 0,
      bersih.kelompok,
    );

    const baru = getAkun(db, bersih.kode);
    catatAudit(db, {
      aksi: `AKUN-TAMBAH ${bersih.kode}`,
      alasan: 'Tambah akun COA',
      baru,
      ref_type: 'akun',
      ref_id: bersih.kode,
    });
  });
  simpan();

  const hasil = getAkun(db, bersih.kode);
  if (!hasil) throw new Error(`Akun ${bersih.kode} gagal dibaca setelah disimpan.`);
  return hasil;
}

/** Pastikan akun ada dan bukan akun bawaan (statis) sebelum diubah/dihapus. */
function pastikanAkunTambahan(db: Database.Database, kode: string): AkunDb {
  const kodeBersih = String(kode ?? '').trim();
  if (!/^\d{4}$/.test(kodeBersih))
    throw new Error('Kode akun harus 4 digit angka.');
  if (COA.some((a) => a.kode === kodeBersih))
    throw new Error(
      `Akun ${kodeBersih} adalah akun bawaan dan tidak bisa diubah namanya atau dihapus dari layar ini.`,
    );
  const akun = getAkun(db, kodeBersih);
  if (!akun) throw new Error(`Akun ${kodeBersih} tidak ditemukan.`);
  return akun;
}

/**
 * DB-15: akun mana pun yang ada di master boleh diaktifkan/nonaktifkan,
 * termasuk akun BAWAAN. Yang tetap ditolak hanya akun sistem yang dibutuhkan
 * wizard/alur (lihat `AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF`).
 */
function pastikanAkunBolehUbahStatus(db: Database.Database, kode: string): AkunDb {
  const kodeBersih = String(kode ?? '').trim();
  if (!/^\d{4}$/.test(kodeBersih))
    throw new Error('Kode akun harus 4 digit angka.');
  const akun = getAkun(db, kodeBersih);
  if (!akun) throw new Error(`Akun ${kodeBersih} tidak ditemukan.`);
  return akun;
}

function validasiNamaAkunSendiri(nama: string): string {
  const namaBersih = String(nama ?? '').trim();
  if (!namaBersih) throw new Error('Nama akun wajib diisi.');
  if (namaBersih.length > 100) throw new Error('Nama akun maks. 100 karakter.');
  return namaBersih;
}

/** Nama akun unik tanpa membedakan huruf besar/kecil (kecuali akun yang diedit). */
function pastikanNamaAkunUnik(
  db: Database.Database,
  nama: string,
  kecualiKode = '',
): void {
  const dipakai = db
    .prepare(
      'SELECT kode FROM akun WHERE nama = ? COLLATE NOCASE AND kode <> ? LIMIT 1',
    )
    .get(nama, kecualiKode) as { kode: string } | undefined;
  if (dipakai)
    throw new Error(
      `Nama akun "${nama}" sudah dipakai oleh kode ${dipakai.kode}. Gunakan nama yang membedakan.`,
    );
}

/** Ubah nama akun tambahan; kode & jenis akun tetap agar histori tidak berubah. */
export function ubahNamaAkun(
  db: Database.Database,
  kode: string,
  nama: string,
): AkunDb {
  const lama = pastikanAkunTambahan(db, kode);
  const namaBersih = validasiNamaAkunSendiri(nama);

  const simpan = db.transaction(() => {
    pastikanNamaAkunUnik(db, namaBersih, lama.kode);
    db.prepare('UPDATE akun SET nama = ? WHERE kode = ?').run(namaBersih, lama.kode);
    const baru = getAkun(db, lama.kode);
    catatAudit(db, {
      aksi: `AKUN-UBAH ${lama.kode}`,
      alasan: 'Ubah nama akun',
      lama,
      baru,
      ref_type: 'akun',
      ref_id: lama.kode,
    });
  });
  simpan();

  const hasil = getAkun(db, lama.kode);
  if (!hasil) throw new Error(`Akun ${lama.kode} gagal dibaca setelah diubah.`);
  return hasil;
}

/**
 * Aktif/nonaktifkan akun. Nonaktif = soft delete: akun tidak muncul di form
 * input baru, tetapi histori/laporan lama tetap memakai nama akun ini.
 *
 * DB-15: akun BAWAAN ikut boleh dinonaktifkan (mis. 5010 yang digantikan
 * 5060), tetapi akun sistem yang dibutuhkan wizard/alur tetap ditolak. Rename
 * dan hapus akun BAWAAN tetap ditolak oleh fungsi masing-masing. `alasan`
 * opsional dipakai untuk audit; bila kosong dipakai alasan standar yang
 * menyebut sumber akun dan tujuannya.
 */
export function setAkunAktif(
  db: Database.Database,
  kode: string,
  aktif: boolean,
  alasan?: string,
): AkunDb {
  const lama = pastikanAkunBolehUbahStatus(db, kode);
  if (!aktif && AKUN_SISTEM_TIDAK_BOLEH_NONAKTIF.has(lama.kode))
    throw new Error(
      `Akun ${lama.kode} ${lama.nama} adalah akun sistem yang dibutuhkan wizard/alur (saldo awal, panjar, utang usaha, atau pinjaman) sehingga tidak bisa dinonaktifkan. Bila akun ini terlanjur nonaktif, gunakan Aktifkan untuk memulihkannya.`,
    );
  if (lama.aktif === aktif) return lama;

  const sumber = lama.sumber === 'BAWAAN' ? 'bawaan' : 'tambahan';
  const alasanAudit =
    String(alasan ?? '').trim() ||
    (aktif
      ? `Aktifkan akun ${sumber} ${lama.kode} untuk form input baru`
      : `Nonaktifkan akun ${sumber} ${lama.kode} dari form input baru`);

  const simpan = db.transaction(() => {
    db.prepare('UPDATE akun SET aktif = ? WHERE kode = ?').run(aktif ? 1 : 0, lama.kode);
    const baru = getAkun(db, lama.kode);
    catatAudit(db, {
      aksi: `AKUN-${aktif ? 'AKTIF' : 'NONAKTIF'} ${lama.kode}`,
      alasan: alasanAudit,
      lama,
      baru,
      ref_type: 'akun',
      ref_id: lama.kode,
    });
  });
  simpan();

  const hasil = getAkun(db, lama.kode);
  if (!hasil) throw new Error(`Akun ${lama.kode} gagal dibaca setelah diubah.`);
  return hasil;
}

/**
 * Hapus permanen akun tambahan hanya bila belum pernah dipakai. Akun yang
 * sudah punya jurnal/panjar harus dinonaktifkan agar histori utuh.
 */
export function hapusAkun(
  db: Database.Database,
  kode: string,
): { kode: string } {
  const lama = pastikanAkunTambahan(db, kode);
  const referensi: { label: string; sql: string }[] = [
    { label: 'jurnal', sql: 'SELECT 1 FROM jurnal_baris WHERE akun_kode = ? LIMIT 1' },
    { label: 'panjar', sql: 'SELECT 1 FROM panjar_item WHERE kategori_baga = ? LIMIT 1' },
    {
      label: 'panjar (akun kas sumber)',
      sql: 'SELECT 1 FROM panjar WHERE akun_kas_sumber = ? LIMIT 1',
    },
    {
      label: 'pinjaman (akun kas)',
      sql: 'SELECT 1 FROM pinjaman WHERE akun_kas = ? LIMIT 1',
    },
    {
      label: 'pinjaman (akun bunga)',
      sql: 'SELECT 1 FROM pinjaman WHERE akun_bunga = ? LIMIT 1',
    },
  ];
  for (const r of referensi) {
    const ada = db.prepare(r.sql).get(lama.kode);
    if (ada)
      throw new Error(
        `Akun ${lama.kode} sudah dipakai di ${r.label}; tidak bisa dihapus permanen. ` +
          'Gunakan Nonaktifkan agar histori tetap utuh.',
      );
  }

  const simpan = db.transaction(() => {
    db.prepare('DELETE FROM akun WHERE kode = ?').run(lama.kode);
    catatAudit(db, {
      aksi: `AKUN-HAPUS ${lama.kode}`,
      alasan: 'Hapus akun yang belum dipakai',
      lama,
    });
  });
  simpan();
  return { kode: lama.kode };
}

// ---------------------------------------------------------------------------
// Jurnal double-entry (P0-2)
// ---------------------------------------------------------------------------

const DAFTAR_PERAN_JURNAL: readonly JurnalPeran[] = [
  'NORMAL',
  'OPENING',
  'OPENING_REPLACEMENT',
  'ADJUSTMENT',
];

export const PESAN_PERAN_JURNAL_TIDAK_DIKENAL =
  'Peran jurnal tidak dikenal. Gunakan NORMAL, OPENING, OPENING_REPLACEMENT, atau ADJUSTMENT.';

export const PESAN_REPLACES_TIDAK_SAH =
  'Relasi jurnal pengganti tidak sah: replaces_id tidak boleh menunjuk diri sendiri, ' +
  'harus menunjuk jurnal yang ada, dan hanya boleh untuk peran OPENING_REPLACEMENT atau ADJUSTMENT.';

export const PESAN_JENIS_PENGGANTI_TIDAK_COCOK =
  'Jenis jurnal pengganti harus sama dengan jurnal aslinya, kecuali pengganti SALDO_AWAL harus berjenis UMUM dengan peran OPENING_REPLACEMENT.';

const rowToJurnal = (r: Record<string, unknown>): Jurnal => ({
  id: String(r.id),
  tanggal: String(r.tanggal),
  no_bukti: String(r.no_bukti ?? ''),
  keterangan: String(r.keterangan),
  jenis: String(r.jenis) as Jurnal['jenis'],
  peran: String(r.peran ?? 'NORMAL') as Jurnal['peran'],
  grup_id: String(r.grup_id),
  reversal_of: r.reversal_of === null || r.reversal_of === undefined ? null : String(r.reversal_of),
  replaces_id:
    r.replaces_id === null || r.replaces_id === undefined
      ? null
      : String(r.replaces_id),
  created_at: String(r.created_at),
});

const rowToJurnalBaris = (r: Record<string, unknown>): JurnalBaris => ({
  id: Number(r.id),
  jurnal_id: String(r.jurnal_id),
  akun_kode: String(r.akun_kode),
  debit: Number(r.debit),
  kredit: Number(r.kredit),
  keterangan: String(r.keterangan ?? ''),
});

export type JurnalFilter = {
  mulai?: string;
  sampai?: string;
  jenis?: string;
  grup_id?: string;
  akun_kode?: string;
  reversal_of?: string;
  /**
   * Kata kunci bebas (P1-11): no. bukti, keterangan, kode/nama akun, atau
   * nominal rupiah (titik/koma/spasi diabaikan). Contoh "150000" cocok dengan
   * debit/kredit Rp 150.000 (tersimpan 15.000.000 sen).
   */
  cari?: string;
  limit?: number;
  offset?: number;
};

/**
 * Simpan satu jurnal + barisnya secara atomik SETELAH pemanggil memvalidasi
 * aturan posting (kunci periode, tanggal mulai, jenis, peringatan kas minus).
 * Aturan struktural yang tetap ditegakkan di sini: minimal 2 baris, tiap baris
 * hanya debit atau kredit > 0, akun harus ada di master `akun`, total debit =
 * total kredit, total > 0. Error dilempar dengan pesan berbahasa Indonesia.
 *
 * AKT-25: fungsi ini adalah jalur insert mentah dan sengaja TIDAK diekspor
 * sebagai `insertJurnal`. Pemakai yang sah hanya posting layer (`postingJurnal`
 * / `postingSaldoAwal`), koreksi yang sudah memvalidasi (`koreksiDanIsiUlang`),
 * seed dev, dan test. Input produksi wajib lewat `postingJurnal`.
 */
export function insertJurnalTervalidasi(
  db: Database.Database,
  header: JurnalHeaderInput,
  baris: JurnalBarisInput[],
  opsi: { akunNonaktifDiizinkan?: ReadonlySet<string> } = {},
): Jurnal {
  const id = String(header.id ?? '').trim();
  if (!id) throw new Error('ID jurnal wajib diisi.');
  if (!tanggalKalenderValid(String(header.tanggal ?? '')))
    throw new Error('Tanggal jurnal tidak valid (YYYY-MM-DD).');
  const keterangan = String(header.keterangan ?? '').trim();
  if (!keterangan) throw new Error('Keterangan jurnal wajib diisi.');
  if (!Array.isArray(baris) || baris.length < 2)
    throw new Error('Jurnal wajib memiliki minimal 2 baris (debit dan kredit).');
  if (getJurnal(db, id)) throw new Error(`Jurnal ${id} sudah ada.`);

  const jenis = header.jenis ?? 'UMUM';
  if (!JENIS_JURNAL.includes(jenis)) throw new Error('Jenis jurnal tidak dikenal.');

  // T-A00: peran & relasi pengganti eksplisit. Trigger DB menjadi backstop,
  // tetapi validasi di sini memberi pesan Indonesia yang lebih jelas.
  const peran = (header.peran ?? 'NORMAL') as JurnalPeran;
  if (!DAFTAR_PERAN_JURNAL.includes(peran))
    throw new Error(PESAN_PERAN_JURNAL_TIDAK_DIKENAL);
  const replacesId = String(header.replaces_id ?? '').trim() || null;
  if (replacesId) {
    if (replacesId === id || !['OPENING_REPLACEMENT', 'ADJUSTMENT'].includes(peran))
      throw new Error(PESAN_REPLACES_TIDAK_SAH);
    const asli = getJurnal(db, replacesId);
    if (!asli) throw new Error(PESAN_REPLACES_TIDAK_SAH);
    const sudahDiganti = db
      .prepare('SELECT id FROM jurnal WHERE replaces_id = ? LIMIT 1')
      .get(replacesId) as { id: string } | undefined;
    if (sudahDiganti)
      throw new Error(
        `Jurnal ${replacesId} sudah digantikan oleh jurnal ${sudahDiganti.id}; satu jurnal hanya boleh digantikan sekali.`,
      );
    const cocok =
      asli.jenis === 'SALDO_AWAL'
        ? jenis === 'UMUM' && peran === 'OPENING_REPLACEMENT'
        : jenis === asli.jenis &&
          (peran === 'OPENING_REPLACEMENT' || peran === 'ADJUSTMENT');
    if (!cocok) throw new Error(PESAN_JENIS_PENGGANTI_TIDAK_COCOK);
  }
  if (peran === 'OPENING_REPLACEMENT' && (!replacesId || jenis !== 'UMUM'))
    throw new Error(
      'Jurnal OPENING_REPLACEMENT wajib berjenis UMUM dan menunjuk jurnal yang digantikan melalui replaces_id.',
    );
  if (
    peran === 'OPENING' &&
    (jenis !== 'SALDO_AWAL' || Boolean(String(header.reversal_of ?? '').trim()))
  )
    throw new Error(
      'Jurnal OPENING wajib berjenis SALDO_AWAL dan tidak boleh mengisi reversal_of.',
    );

  // Tahun divalidasi di sini (tanggal sudah lolos tanggalKalenderValid) supaya
  // penomoran otomatis tidak pernah memakai tahun aneh.
  const tahunJurnal = tahunDariTanggal(String(header.tanggal));

  const noBukti = String(header.no_bukti ?? '').trim();
  if (noBukti) {
    // AUD-23: nomor bukti hanya unik dalam tahun yang sama. Nomor yang sama
    // boleh dipakai lagi di tahun berbeda (mis. JU-2026-0001 & JU-2025-0001).
    const dup = db
      .prepare(
        `SELECT id FROM jurnal
         WHERE no_bukti <> ''
           AND substr(tanggal, 1, 4) = ?
           AND no_bukti = ? COLLATE NOCASE
         LIMIT 1`,
      )
      .get(String(tahunJurnal), noBukti) as { id: string } | undefined;
    if (dup) throw new Error(`Nomor bukti ${noBukti} sudah dipakai jurnal ${dup.id}.`);
  }

  const reversalOf = header.reversal_of?.trim() || null;
  if (reversalOf) {
    const asli = getJurnal(db, reversalOf);
    if (!asli) throw new Error(`Jurnal yang dikoreksi (${reversalOf}) tidak ditemukan.`);
    // P0-6: jurnal balik tidak boleh dibalik lagi, dan satu jurnal hanya boleh
    // punya satu reversal. Penjagaan ini juga berlaku untuk pemanggil yang
    // melewati fungsi koreksi aplikasi.
    if (asli.reversal_of)
      throw new Error('Jurnal balik tidak boleh dibalik lagi. Koreksi jurnal aslinya.');
    const sudah = db
      .prepare('SELECT id FROM jurnal WHERE reversal_of = ? LIMIT 1')
      .get(reversalOf) as { id: string } | undefined;
    if (sudah)
      throw new Error(`Jurnal ${reversalOf} sudah dikoreksi oleh jurnal ${sudah.id}.`);
  }

  const cekAkun = db.prepare('SELECT kode, aktif FROM akun WHERE kode = ?');
  let totalDebit = 0;
  let totalKredit = 0;
  const bersih = baris.map((b, i) => {
    const akunKode = String(b.akun_kode ?? '').trim();
    const akunDb = cekAkun.get(akunKode) as { kode: string; aktif: number } | undefined;
    if (!akunKode || !akunDb)
      throw new Error(`Baris ${i + 1}: akun ${akunKode || '(kosong)'} tidak dikenal.`);
    // T-A04: akun nonaktif hanya boleh dipakai bila kodenya eksplisit diizinkan
    // oleh pemanggil internal yang sudah memverifikasi baris historis. Akun
    // legacy tetap ditolak karena pengecekan di bawah memperlakukannya aktif.
    const diizinkanNonaktif =
      Number(akunDb.aktif) !== 1 && opsi.akunNonaktifDiizinkan?.has(akunKode) === true;
    if (Number(akunDb.aktif) !== 1 && !diizinkanNonaktif)
      throw new Error(`Baris ${i + 1}: akun ${akunKode} sudah tidak aktif.`);
    if (
      !akunBolehDiposting(akunKode, Number(akunDb.aktif) === 1 || diizinkanNonaktif, {
        dikenal: true,
      })
    )
      throw new Error(`Baris ${i + 1}: akun ${akunKode} ${PESAN_AKUN_LEGACY}`);
    if (!Number.isSafeInteger(b.debit) || b.debit < 0)
      throw new Error(`Baris ${i + 1}: debit harus bilangan bulat ≥ 0.`);
    if (!Number.isSafeInteger(b.kredit) || b.kredit < 0)
      throw new Error(`Baris ${i + 1}: kredit harus bilangan bulat ≥ 0.`);
    if (b.debit > 0 && b.kredit > 0)
      throw new Error(`Baris ${i + 1}: isi salah satu saja — debit ATAU kredit.`);
    if (b.debit === 0 && b.kredit === 0)
      throw new Error(`Baris ${i + 1}: nominal debit/kredit harus lebih dari 0.`);
    totalDebit += b.debit;
    totalKredit += b.kredit;
    return {
      akun_kode: akunKode,
      debit: b.debit,
      kredit: b.kredit,
      keterangan: String(b.keterangan ?? '').trim(),
    };
  });
  if (totalDebit !== totalKredit)
    throw new Error(
      `Jurnal tidak seimbang: total debit ${totalDebit} ≠ total kredit ${totalKredit} (satuan sen).`,
    );
  if (totalDebit <= 0) throw new Error('Total jurnal harus lebih dari 0.');

  const row: Jurnal = {
    id,
    tanggal: header.tanggal,
    no_bukti: noBukti,
    keterangan,
    jenis,
    peran,
    grup_id: header.grup_id?.trim() || id,
    reversal_of: reversalOf,
    replaces_id: replacesId,
    created_at: header.created_at ?? new Date().toISOString(),
  };

  const simpan = db.transaction(() => {
    // P1-11/P1-13: nomor kosong diisi otomatis DI DALAM transaksi yang sama
    // dengan insert. Prefix & padding dibaca dari pengaturan pembukuan saat
    // nomor dibuat, sehingga nomor lama tidak berubah saat pengaturan diubah.
    if (!row.no_bukti) {
      const pengaturan = getPengaturanPembukuan(db);
      const terpakai = (
        db
          .prepare("SELECT no_bukti FROM jurnal WHERE no_bukti LIKE ? ESCAPE '\\'")
          .all(`${pengaturan.prefixNomorBukti}-${tahunJurnal}-%`) as {
          no_bukti: string;
        }[]
      ).map((r) => String(r.no_bukti));
      row.no_bukti = formatNomorBukti(
        tahunJurnal,
        nomorBuktiBerikutnya(
          tahunJurnal,
          terpakai,
          pengaturan.prefixNomorBukti,
          pengaturan.paddingNomorBukti,
        ),
        pengaturan.prefixNomorBukti,
        pengaturan.paddingNomorBukti,
      );
      const dup = db
        .prepare(
          `SELECT id FROM jurnal
           WHERE no_bukti <> ''
             AND substr(tanggal, 1, 4) = ?
             AND no_bukti = ? COLLATE NOCASE
           LIMIT 1`,
        )
        .get(String(tahunJurnal), row.no_bukti) as { id: string } | undefined;
      if (dup) throw new Error(`Nomor bukti ${row.no_bukti} sudah dipakai jurnal ${dup.id}.`);
    }
    db.prepare(
      `INSERT INTO jurnal
         (id, tanggal, no_bukti, keterangan, jenis, peran, grup_id,
          reversal_of, replaces_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.tanggal,
      row.no_bukti,
      row.keterangan,
      row.jenis,
      row.peran,
      row.grup_id,
      row.reversal_of,
      row.replaces_id,
      row.created_at,
    );
    const insBaris = db.prepare(
      `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const b of bersih)
      insBaris.run(row.id, b.akun_kode, b.debit, b.kredit, b.keterangan);
  });
  try {
    simpan();
  } catch (e) {
    // AUD-23: unique index per tahun adalah penjaga terakhir bila ada pemanggil
    // yang melewati validasi aplikasi. Pesan SQLite diterjemahkan ke Indonesia.
    const pesan = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed:.*(jurnal\.no_bukti|idx_jurnal_no_bukti)/i.test(pesan))
      throw new Error(`Nomor bukti ${row.no_bukti} sudah dipakai. Gunakan nomor bukti lain.`);
    throw e;
  }
  return row;
}

export function getJurnal(db: Database.Database, id: string): Jurnal | null {
  const r = db.prepare('SELECT * FROM jurnal WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToJurnal(r) : null;
}

export function listJurnalBaris(db: Database.Database, jurnalId: string): JurnalBaris[] {
  const rows = db
    .prepare('SELECT * FROM jurnal_baris WHERE jurnal_id = ? ORDER BY id')
    .all(jurnalId) as Record<string, unknown>[];
  return rows.map(rowToJurnalBaris);
}

/** Escape wildcard LIKE agar kata kunci operator dicari apa adanya. */
function escapeLike(teks: string): string {
  return teks.replace(/[\\%_]/g, '\\$&');
}

/**
 * Nominal rupiah dari kata kunci pencarian → sen. Awalan "Rp" dan spasi
 * diabaikan. Menerima format Indonesia (`1.500,50`) dan paste gaya AS
 * (`1,500.50`). Bukan nominal valid atau nol → null.
 */
function cariNominalSen(teks: string): number | null {
  let bersih = teks
    .trim()
    .replace(/^rp\.?\s*/i, '')
    .replace(/\s+/g, '');
  if (bersih === '') return null;
  // Normalisasi paste gaya AS: 1,500,000.50 → 1.500.000,50
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(bersih)) {
    bersih = bersih.replace(/,/g, '').replace('.', ',');
  }
  try {
    const sen = parseRupiahToSen(bersih);
    return sen > 0 && Number.isSafeInteger(sen) ? sen : null;
  } catch {
    return null;
  }
}

/** WHERE bersama untuk daftar & hitung jurnal (termasuk pencarian P1-11). */
function jurnalWhere(f: JurnalFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.mulai) { where.push('j.tanggal >= ?'); params.push(f.mulai); }
  if (f.sampai) { where.push('j.tanggal <= ?'); params.push(f.sampai); }
  if (f.jenis) { where.push('j.jenis = ?'); params.push(f.jenis); }
  if (f.grup_id) { where.push('j.grup_id = ?'); params.push(f.grup_id); }
  if (f.reversal_of) { where.push('j.reversal_of = ?'); params.push(f.reversal_of); }
  if (f.akun_kode) {
    where.push('EXISTS (SELECT 1 FROM jurnal_baris b WHERE b.jurnal_id = j.id AND b.akun_kode = ?)');
    params.push(f.akun_kode);
  }
  const cari = String(f.cari ?? '').trim();
  if (cari) {
    const like = `%${escapeLike(cari)}%`;
    const klausa = [
      "j.no_bukti LIKE ? ESCAPE '\\'",
      "j.keterangan LIKE ? ESCAPE '\\'",
      `EXISTS (
         SELECT 1 FROM jurnal_baris b
         JOIN akun a ON a.kode = b.akun_kode
         WHERE b.jurnal_id = j.id
           AND (b.akun_kode LIKE ? ESCAPE '\\' OR a.nama LIKE ? ESCAPE '\\')
       )`,
    ];
    params.push(like, like, like, like);
    const nominalSen = cariNominalSen(cari);
    if (nominalSen !== null) {
      klausa.push(
        'EXISTS (SELECT 1 FROM jurnal_baris bn WHERE bn.jurnal_id = j.id AND (bn.debit = ? OR bn.kredit = ?))',
      );
      params.push(nominalSen, nominalSen);
    }
    where.push(`(${klausa.join(' OR ')})`);
  }
  return {
    sql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

export function listJurnal(
  db: Database.Database,
  f: JurnalFilter = {},
): Jurnal[] {
  const where = jurnalWhere(f);
  const params = [...where.params];
  let sql = `SELECT j.* FROM jurnal j ${where.sql} ORDER BY j.tanggal, j.rowid`;
  if (f.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(Number.isFinite(f.limit) ? Math.max(0, Math.trunc(f.limit)) : 0);
    if (f.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(Number.isFinite(f.offset) ? Math.max(0, Math.trunc(f.offset)) : 0);
    }
  } else if (f.offset !== undefined) {
    sql += ' LIMIT -1 OFFSET ?';
    params.push(Number.isFinite(f.offset) ? Math.max(0, Math.trunc(f.offset)) : 0);
  }
  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToJurnal);
}

/** Jumlah jurnal yang cocok dengan filter (tanpa limit/offset), untuk pagination. */
export function hitungJurnal(db: Database.Database, f: JurnalFilter = {}): number {
  const where = jurnalWhere(f);
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM jurnal j ${where.sql}`)
    .get(...where.params) as { total: number };
  return Number(row.total);
}

/** Kepala + baris satu jurnal; null bila tidak ada. */
export function getJurnalDetail(
  db: Database.Database,
  id: string,
): { jurnal: Jurnal; baris: JurnalBaris[] } | null {
  const jurnal = getJurnal(db, id);
  return jurnal ? { jurnal, baris: listJurnalBaris(db, id) } : null;
}

export type JurnalLengkap = Jurnal & {
  baris: JurnalBaris[];
  total_debit: number;
  /** ID jurnal balik yang sudah ada untuk jurnal ini (null = belum dikoreksi). */
  reversal_id: string | null;
  /** T2.2: capability dari backend, bukan tebakan UI dari `jenis`/akun. */
  bisa_dibalik: boolean;
  bisa_dikoreksi: boolean;
  /** Alasan Indonesia bila aksi tidak boleh; null bila keduanya boleh. */
  alasan_tidak_bisa: string | null;
};

/**
 * Daftar jurnal beserta barisnya untuk layar Jurnal Umum (P0-6).
 * `reversal_id` menandai jurnal yang sudah dikoreksi, sedangkan
 * `bisa_dibalik`/`bisa_dikoreksi`/`alasan_tidak_bisa` (T2.2) memberi tombol
 * aksi aturan yang sama dengan backend. Jurnal dibaca ulang oleh helper agar
 * data renderer yang basi tidak membuka aksi yang pasti gagal.
 */
export function listJurnalLengkap(
  db: Database.Database,
  filter: JurnalFilter = {},
): JurnalLengkap[] {
  const ambilBaris = db.prepare(
    'SELECT * FROM jurnal_baris WHERE jurnal_id = ? ORDER BY id',
  );
  const ambilReversal = db.prepare(
    'SELECT id FROM jurnal WHERE reversal_of = ? ORDER BY rowid LIMIT 1',
  );
  return listJurnal(db, filter).map((jurnal) => {
    const baris = (ambilBaris.all(jurnal.id) as Record<string, unknown>[]).map(rowToJurnalBaris);
    const reversal = ambilReversal.get(jurnal.id) as { id: string } | undefined;
    const kemampuan = kemampuanKoreksiJurnal(db, { id: jurnal.id });
    return {
      ...jurnal,
      baris,
      total_debit: baris.reduce((s, b) => s + b.debit, 0),
      reversal_id: reversal ? String(reversal.id) : null,
      bisa_dibalik: kemampuan.bisaDibalik,
      bisa_dikoreksi: kemampuan.bisaDikoreksi,
      alasan_tidak_bisa: kemampuan.alasan,
    };
  });
}

/**
 * Halaman daftar jurnal + total server (P1-11). `rows` sudah dipotong oleh
 * LIMIT/OFFSET; `total` adalah jumlah seluruh baris yang cocok filter.
 */
export function listJurnalLengkapPage(
  db: Database.Database,
  filter: JurnalFilter = {},
): { rows: JurnalLengkap[]; total: number } {
  return {
    rows: listJurnalLengkap(db, filter),
    total: hitungJurnal(db, filter),
  };
}

/**
 * Saran nomor bukti berikutnya untuk pratinjau form (P1-11/P1-13). Hanya
 * membaca DB; penomoran final tetap dilakukan atomik oleh `insertJurnalTervalidasi`
 * lewat `postingJurnal`.
 * Prefix & padding mengikuti pengaturan pembukuan saat ini.
 */
export function saranNomorBukti(db: Database.Database, tanggal: string): string {
  const tahun = tahunDariTanggal(tanggal);
  const pengaturan = getPengaturanPembukuan(db);
  const terpakai = (
    db
      .prepare("SELECT no_bukti FROM jurnal WHERE no_bukti LIKE ? ESCAPE '\\'")
      .all(`${pengaturan.prefixNomorBukti}-${tahun}-%`) as {
      no_bukti: string;
    }[]
  ).map((r) => String(r.no_bukti));
  return formatNomorBukti(
    tahun,
    nomorBuktiBerikutnya(
      tahun,
      terpakai,
      pengaturan.prefixNomorBukti,
      pengaturan.paddingNomorBukti,
    ),
    pengaturan.prefixNomorBukti,
    pengaturan.paddingNomorBukti,
  );
}

export function listTutupBuku(db: Database.Database): TutupBuku[] {
  // Skema v1 tidak memiliki `tutup_buku.backup_path`.
  const rows = db
    .prepare('SELECT tahun, created_at, catatan FROM tutup_buku ORDER BY tahun')
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    tahun: Number(r.tahun),
    created_at: String(r.created_at),
    catatan: String(r.catatan ?? ''),
  }));
}

/**
 * Simpan/ubah penanda tutup buku. Angka laba sengaja TIDAK ditulis: sumber
 * laba selalu jurnal (P0-7). Pemanggil wajib sudah memvalidasi penimpaan.
 */
export function insertTutupBuku(db: Database.Database, t: TutupBuku): void {
  // `backup_path` tidak ada di skema v1.
  db.prepare(
    `INSERT INTO tutup_buku (tahun, created_at, catatan)
     VALUES (?, ?, ?)
     ON CONFLICT(tahun) DO UPDATE SET
       created_at = excluded.created_at,
       catatan = excluded.catatan`,
  ).run(t.tahun, t.created_at, t.catatan);
}

const rowToTutupBukuSnapshot = (r: Record<string, unknown>): TutupBukuSnapshot => ({
  id: Number(r.id),
  tahun: Number(r.tahun),
  versi: Number(r.versi),
  laba: Number(r.laba),
  total_aset: Number(r.total_aset),
  total_kewajiban: Number(r.total_kewajiban),
  total_ekuitas: Number(r.total_ekuitas),
  total_pasiva: Number(r.total_pasiva),
  selisih: Number(r.selisih),
  hash_jurnal: String(r.hash_jurnal),
  created_at: String(r.created_at),
});

/**
 * T-A00/T-A06 — tulis satu snapshot tutup buku. Tabel append-only: trigger
 * menolak UPDATE/DELETE, dan UNIQUE(tahun, versi) mencegah versi yang sama
 * tertimpa. Pemanggil (tutupBuku) menghitung versi berikutnya dan memanggil
 * fungsi ini di dalam transaksi yang sama dengan penanda + audit.
 */
export function insertTutupBukuSnapshot(
  db: Database.Database,
  snapshot: Omit<TutupBukuSnapshot, 'id'>,
): TutupBukuSnapshot {
  const info = db
    .prepare(
      `INSERT INTO tutup_buku_snapshot
         (tahun, versi, laba, total_aset, total_kewajiban, total_ekuitas,
          total_pasiva, selisih, hash_jurnal, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snapshot.tahun,
      snapshot.versi,
      snapshot.laba,
      snapshot.total_aset,
      snapshot.total_kewajiban,
      snapshot.total_ekuitas,
      snapshot.total_pasiva,
      snapshot.selisih,
      snapshot.hash_jurnal,
      snapshot.created_at,
    );
  const row = db
    .prepare('SELECT * FROM tutup_buku_snapshot WHERE id = ?')
    .get(Number(info.lastInsertRowid)) as Record<string, unknown>;
  return rowToTutupBukuSnapshot(row);
}

/** T-A00 — daftar snapshot tutup buku, terbaru/versi tertinggi lebih dulu. */
export function listTutupBukuSnapshot(
  db: Database.Database,
  tahun?: number,
): TutupBukuSnapshot[] {
  const rows = (
    tahun === undefined
      ? db
          .prepare(
            'SELECT * FROM tutup_buku_snapshot ORDER BY tahun DESC, versi DESC',
          )
          .all()
      : db
          .prepare(
            'SELECT * FROM tutup_buku_snapshot WHERE tahun = ? ORDER BY versi DESC',
          )
          .all(tahun)
  ) as Record<string, unknown>[];
  return rows.map(rowToTutupBukuSnapshot);
}

const rowToAuditLog = (r: Record<string, unknown>): AuditLog => ({
  id: String(r.id),
  tanggal: String(r.tanggal),
  aksi: String(r.aksi),
  alasan: String(r.alasan ?? ''),
  data_lama_json: String(r.data_lama_json ?? ''),
  data_baru_json: String(r.data_baru_json ?? ''),
  ref_type: String(r.ref_type ?? ''),
  ref_id: String(r.ref_id ?? ''),
});

export function insertAuditLog(db: Database.Database, a: AuditLog): void {
  db.prepare(
    `INSERT INTO audit_log
       (id, tanggal, aksi, alasan, data_lama_json, data_baru_json, ref_type, ref_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    a.id,
    a.tanggal,
    a.aksi,
    a.alasan,
    a.data_lama_json ?? '',
    a.data_baru_json ?? '',
    a.ref_type ?? '',
    a.ref_id ?? '',
  );
}

export type InputAudit = {
  aksi: string;
  alasan?: string;
  /** Kondisi sebelum operasi. */
  lama?: unknown;
  /** Kondisi sesudah operasi. */
  baru?: unknown;
  id?: string;
  tanggal?: string;
  /** DB-27: referensi objek terstruktur (default ''). */
  ref_type?: string;
  ref_id?: string;
};

/**
 * Helper audit terpusat (P0-9). Semua operasi yang wajib punya jejak audit
 * memakai fungsi ini supaya bentuk data sebelum/sesudah konsisten.
 * Pemanggil yang butuh atomik membungkusnya dalam `db.transaction`.
 */
export function catatAudit(db: Database.Database, input: InputAudit): AuditLog {
  const row = buatAuditLog(
    input.aksi,
    String(input.alasan ?? ''),
    input.lama,
    input.baru,
    {
      id: input.id,
      tanggal: input.tanggal,
      ref_type: input.ref_type,
      ref_id: input.ref_id,
    },
  );
  insertAuditLog(db, row);
  return row;
}

/** Filter riwayat audit; `aksi` dicocokkan persis atau sebagai awalan. */
export type AuditFilter = {
  aksi?: string;
  /**
   * DB-27: jenis & ID objek yang dirujuk (mis. 'jurnal' + 'j-1').
   * Dicocokkan persis; kosong = tidak memfilter.
   */
  ref_type?: string;
  ref_id?: string;
  /** Tanggal lokal WITA awal `YYYY-MM-DD` (inklusif). */
  mulai?: string;
  /** Tanggal lokal WITA akhir `YYYY-MM-DD` (inklusif). */
  sampai?: string;
  limit?: number;
  offset?: number;
};

function auditWhere(f: AuditFilter): { sql: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  const aksi = String(f.aksi ?? '').trim();
  if (aksi) {
    // Escape wildcard user agar filter teks tidak berubah jadi pola LIKE bebas.
    const escaped = aksi.replace(/[\\%_]/g, '\\$&');
    where.push("(aksi = ? OR aksi LIKE ? ESCAPE '\\')");
    params.push(aksi, `${escaped}%`);
  }
  // DB-27: filter referensi memakai kolom terstruktur, bukan LIKE pada aksi.
  const refType = String(f.ref_type ?? '').trim();
  if (refType) {
    where.push('ref_type = ?');
    params.push(refType);
  }
  const refId = String(f.ref_id ?? '').trim();
  if (refId) {
    where.push('ref_id = ?');
    params.push(refId);
  }
  // `tanggal` tersimpan ISO UTC; batas filter dikonversi dari tanggal lokal
  // agar audit pagi WITA tidak jatuh ke tanggal UTC hari sebelumnya.
  if (f.mulai) {
    where.push('tanggal >= ?');
    params.push(awalHariLokalUtc(f.mulai));
  }
  if (f.sampai) {
    where.push('tanggal < ?');
    params.push(akhirHariLokalUtc(f.sampai));
  }
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

function angkaAman(nilai: unknown, bawaan: number, min: number, maks: number): number {
  const n = Number(nilai);
  if (!Number.isFinite(n)) return bawaan;
  return Math.min(maks, Math.max(min, Math.trunc(n)));
}

/**
 * Daftar audit terbaru (default 200). Tetap mengembalikan array agar pemanggil
 * lama kompatibel; `listAuditLogPage` menambahkan total untuk pagination UI.
 */
export function listAuditLog(
  db: Database.Database,
  filter: AuditFilter | number = {},
): AuditLog[] {
  const f: AuditFilter = typeof filter === 'number' ? { limit: filter } : filter;
  const limit = angkaAman(f.limit, 200, 0, 1000);
  const offset = angkaAman(f.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const where = auditWhere(f);
  const rows = db
    .prepare(
      `SELECT * FROM audit_log ${where.sql}
       ORDER BY tanggal DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(...where.params, limit, offset) as Record<string, unknown>[];
  return rows.map(rowToAuditLog);
}

/** Jumlah baris audit yang cocok dengan filter (tanpa limit/offset). */
export function hitungAuditLog(db: Database.Database, filter: AuditFilter = {}): number {
  const where = auditWhere(filter);
  const row = db
    .prepare(`SELECT COUNT(*) AS total FROM audit_log ${where.sql}`)
    .get(...where.params) as { total: number };
  return Number(row.total);
}

/** Halaman audit + total, dipakai IPC `audit:list` dan UI Pengaturan. */
export function listAuditLogPage(
  db: Database.Database,
  filter: AuditFilter = {},
): { rows: AuditLog[]; total: number } {
  return {
    rows: listAuditLog(db, filter),
    total: hitungAuditLog(db, filter),
  };
}

/** Guard kunci longgar untuk edit/hapus baris lama. Return error jika alasan kurang. */
export function guardPeriodeTerkunci(
  db: Database.Database,
  tanggal: string,
  alasan?: string,
): string | null {
  const tutup = listTutupBuku(db);
  if (!isPeriodeTerkunci(tanggal, tutup)) return null;
  if (!alasan || alasan.trim().length < 5)
    return 'Periode sudah ditutup: wajib isi alasan ≥5 karakter (kunci longgar).';
  return null;
}

// --- Kunci aplikasi (PIN 6 digit, single-laptop). Key-value di tabel pengaturan. ---
export const KUNCI_PIN_SALT = 'pin_salt';
export const KUNCI_PIN_HASH = 'pin_hash';
export const KUNCI_RESET_SALT = 'reset_salt';
export const KUNCI_RESET_HASH = 'reset_hash';
export const KUNCI_IDLE_MENIT = 'idle_menit';
/** T2.8: lockout PIN bertahan setelah restart (bukan enkripsi DB). */
export const KUNCI_KEAMANAN_GAGAL = 'keamanan_gagal';
export const KUNCI_KEAMANAN_BLOKIR_SAMPAI = 'keamanan_blokir_sampai';

export function getPengaturan(db: Database.Database, kunci: string): string | null {
  const r = db.prepare('SELECT nilai FROM pengaturan WHERE kunci = ?').get(kunci) as {
    nilai: string;
  } | undefined;
  return r ? String(r.nilai) : null;
}

export function setPengaturan(db: Database.Database, kunci: string, nilai: string): void {
  db.prepare('INSERT INTO pengaturan (kunci, nilai) VALUES (?, ?) ON CONFLICT(kunci) DO UPDATE SET nilai = excluded.nilai').run(
    kunci,
    nilai,
  );
}

export function hapusPengaturan(db: Database.Database, kunci: string): void {
  db.prepare('DELETE FROM pengaturan WHERE kunci = ?').run(kunci);
}

export function sudahSetupPin(db: Database.Database): boolean {
  return getPengaturan(db, KUNCI_PIN_SALT) !== null && getPengaturan(db, KUNCI_PIN_HASH) !== null;
}

/** Instalasi lama (sebelum AUD-19) belum punya pasangan reset_salt/reset_hash. */
export function kodeDaruratDiatur(db: Database.Database): boolean {
  return getPengaturan(db, KUNCI_RESET_SALT) !== null && getPengaturan(db, KUNCI_RESET_HASH) !== null;
}

export function getIdleMenit(db: Database.Database, fallback = 30): number {
  const v = getPengaturan(db, KUNCI_IDLE_MENIT);
  const n = v === null ? NaN : Number(v);
  return Number.isInteger(n) ? n : fallback;
}

// --- Pengaturan pembukuan (P1-13). Tetap key-value di tabel `pengaturan`. ---
export const KUNCI_AKUNTANSI_NAMA_ENTITAS = 'akuntansi_nama_entitas';
export const KUNCI_AKUNTANSI_KOP_TAMBAHAN = 'akuntansi_kop_tambahan';
/**
 * Kunci lama tanggal mulai pembukuan. Dipertahankan untuk kompatibilitas
 * setting/data lama; sumber cut-over resmi laporan adalah `cutover_tanggal`.
 */
export const KUNCI_AKUNTANSI_TANGGAL_MULAI = 'akuntansi_tanggal_mulai';
/** T-A00: ID jurnal pembukaan aktif (OPENING/OPENING_REPLACEMENT). */
export const KUNCI_SALDO_AWAL_AKTIF_ID = 'saldo_awal_aktif_id';
/** T-A00: tanggal cut-over pembukuan efektif (sumber resmi laporan). */
export const KUNCI_CUTOVER_TANGGAL = 'cutover_tanggal';
/** T-A01: perubahan manual tanggal cut-over saat pembukaan aktif. */
export const PESAN_TANGGAL_CUTOVER_DIKUNCI =
  'Tanggal mulai/cut-over pembukuan tidak boleh diubah manual saat saldo awal aktif sudah ada. Gunakan Wizard Koreksi Saldo Awal untuk memindahkan tanggal mulai.';
export const KUNCI_AKUNTANSI_AWAL_TAHUN = 'akuntansi_awal_tahun_buku';
export const KUNCI_AKUNTANSI_PREFIX_BUKTI = 'akuntansi_prefix_bukti';
export const KUNCI_AKUNTANSI_PADDING_BUKTI = 'akuntansi_padding_bukti';

/**
 * Tanggal cut-over resmi untuk pembaca pengaturan. Sumber utamanya
 * `cutover_tanggal`; kunci lama `akuntansi_tanggal_mulai` hanya fallback data
 * lama. Nilai tidak valid diabaikan agar posting/laporan tidak memakai tanggal
 * rusak.
 */
function tanggalCutoverDariPengaturan(db: Database.Database): string {
  const primer = String(getPengaturan(db, KUNCI_CUTOVER_TANGGAL) ?? '').trim();
  if (primer && tanggalKalenderValid(primer)) return primer;
  return String(getPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI) ?? '').trim();
}

/** Tanggal jurnal pembukaan aktif; null bila belum ada/pointer tidak sah. */
function tanggalPembukaanAktif(db: Database.Database): string | null {
  const id = String(getPengaturan(db, KUNCI_SALDO_AWAL_AKTIF_ID) ?? '').trim();
  if (!id) return null;
  const row = db.prepare('SELECT tanggal FROM jurnal WHERE id = ?').get(id) as
    | { tanggal: string }
    | undefined;
  const tanggal = String(row?.tanggal ?? '').trim();
  return tanggal && tanggalKalenderValid(tanggal) ? tanggal : null;
}

/**
 * Baca pengaturan pembukuan lengkap. DB kosong / field belum pernah disimpan
 * otomatis memakai `DEFAULT_PENGATURAN` (kop lama, JU, 4 digit).
 */
export function getPengaturanPembukuan(
  db: Database.Database,
): PengaturanPembukuan {
  const tersimpan = normalisasiPengaturan({
    namaEntitas:
      getPengaturan(db, KUNCI_AKUNTANSI_NAMA_ENTITAS) ??
      DEFAULT_PENGATURAN.namaEntitas,
    kopTambahan: getPengaturan(db, KUNCI_AKUNTANSI_KOP_TAMBAHAN) ?? '',
    tanggalMulaiPembukuan: tanggalCutoverDariPengaturan(db),
    awalTahunBuku:
      getPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN) ??
      DEFAULT_PENGATURAN.awalTahunBuku,
    prefixNomorBukti:
      getPengaturan(db, KUNCI_AKUNTANSI_PREFIX_BUKTI) ??
      DEFAULT_PENGATURAN.prefixNomorBukti,
    paddingNomorBukti:
      getPengaturan(db, KUNCI_AKUNTANSI_PADDING_BUKTI) ??
      DEFAULT_PENGATURAN.paddingNomorBukti,
  });

  // T2.6: DB legacy masih bisa menyimpan awal tahun buku selain Januari
  // (mis. 7 dari versi lama). Aplikasi hanya mendukung Januari
  // (`AWAL_TAHUN_BUKU_DIDUKUNG`), jadi semua pembaca — dashboard, laporan,
  // dan penomoran bukti — harus menerima nilai ternormalisasi ini. Nilai
  // mentah di DB sengaja tidak diubah; save berikutnya menulis Januari.
  return {
    ...tersimpan,
    awalTahunBuku: AWAL_TAHUN_BUKU_DIDUKUNG,
  };
}

export type OpsiSimpanPengaturan = {
  alasan?: string;
  /**
   * AKT-03: izinkan mengosongkan tanggal mulai pembukuan saat sudah ada
   * jurnal. Tanpa opsi ini, pengosongan yang menghapus nilai lama ditolak.
   */
  konfirmasiKosongkanTanggalMulai?: boolean;
};

/**
 * Simpan pengaturan pembukuan secara atomik + audit `PENGATURAN-PEMBUKUAN`.
 * Data audit hanya berisi model pembukuan (tidak pernah PIN/salt/hash).
 * Melempar Error berbahasa Indonesia bila validasi gagal.
 */
export function simpanPengaturanPembukuan(
  db: Database.Database,
  input: unknown,
  opsi: OpsiSimpanPengaturan = {},
): PengaturanPembukuan {
  // DB-28/T2.6: awal tahun buku tidak lagi bisa dipilih operator. Validasi
  // tetap menolak nilai selain Januari (mis. input mentah 7 dari pemanggil
  // lama), lalu nilai yang disimpan selalu dipaksa Januari.
  const dinormalisasi = normalisasiPengaturan(input);
  const errors = validasiPengaturan(dinormalisasi);
  if (errors.length > 0) throw new Error(errors[0]!);

  const bersih: PengaturanPembukuan = {
    ...dinormalisasi,
    awalTahunBuku: AWAL_TAHUN_BUKU_DIDUKUNG,
  };

  const lama = getPengaturanPembukuan(db);
  const simpan = db.transaction(() => {
    // T-A01: setelah pembukaan aktif ada, tanggal mulai/cut-over hanya boleh
    // dipindahkan lewat Wizard Koreksi Saldo Awal. Simpan field lain tetap
    // diizinkan selama tanggal yang dikirim sama dengan tanggal pembukaan.
    const pembukaanAktif = tanggalPembukaanAktif(db);
    if (
      pembukaanAktif &&
      bersih.tanggalMulaiPembukuan !== pembukaanAktif
    ) {
      throw new Error(PESAN_TANGGAL_CUTOVER_DIKUNCI);
    }

    // AKT-03: setting tidak boleh bertentangan dengan jurnal yang sudah ada.
    // Batas bawah setelah jurnal paling awal akan membuat jurnal lama tidak
    // mungkin diposting ulang; mengosongkan nilai lama juga butuh konfirmasi.
    const jurnalPertama = db
      .prepare('SELECT tanggal FROM jurnal ORDER BY tanggal ASC, rowid ASC LIMIT 1')
      .get() as { tanggal: string } | undefined;
    if (jurnalPertama) {
      const tanggalAwal = String(jurnalPertama.tanggal);
      if (
        bersih.tanggalMulaiPembukuan &&
        bersih.tanggalMulaiPembukuan > tanggalAwal
      ) {
        throw new Error(
          `Tanggal mulai pembukuan (${bersih.tanggalMulaiPembukuan}) tidak boleh setelah jurnal paling awal (${tanggalAwal}).`,
        );
      }
      if (
        !bersih.tanggalMulaiPembukuan &&
        lama.tanggalMulaiPembukuan &&
        opsi.konfirmasiKosongkanTanggalMulai !== true
      ) {
        throw new Error(
          'Tanggal mulai pembukuan tidak boleh dikosongkan karena sudah ada jurnal. Konfirmasi khusus diperlukan.',
        );
      }
    }

    setPengaturan(db, KUNCI_AKUNTANSI_NAMA_ENTITAS, bersih.namaEntitas);
    setPengaturan(db, KUNCI_AKUNTANSI_KOP_TAMBAHAN, bersih.kopTambahan);
    setPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI, bersih.tanggalMulaiPembukuan);
    // T-A01: `cutover_tanggal` adalah sumber resmi laporan. Saat belum ada
    // pembukaan, simpan tanggal yang dipilih operator; saat pembukaan aktif
    // ada, nilainya wajib sama dengan tanggal pembukaan (dijaga di atas).
    setPengaturan(
      db,
      KUNCI_CUTOVER_TANGGAL,
      pembukaanAktif ?? bersih.tanggalMulaiPembukuan,
    );
    setPengaturan(db, KUNCI_AKUNTANSI_AWAL_TAHUN, String(bersih.awalTahunBuku));
    setPengaturan(db, KUNCI_AKUNTANSI_PREFIX_BUKTI, bersih.prefixNomorBukti);
    setPengaturan(db, KUNCI_AKUNTANSI_PADDING_BUKTI, String(bersih.paddingNomorBukti));

    catatAudit(db, {
      aksi: 'PENGATURAN-PEMBUKUAN',
      alasan: String(opsi.alasan ?? '').trim() || 'Pengaturan pembukuan diubah',
      lama,
      baru: bersih,
    });
  });
  simpan();
  return bersih;
}
