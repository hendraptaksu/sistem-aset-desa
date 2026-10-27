// Adapter DB master pihak + posting Piutang/Hutang (P1-5).
//
// Prinsip:
// - `pihak` hanya master nama; `jurnal_pihak` hanya metadata penghubung.
// - Saldo per pihak TIDAK disimpan — dihitung dari baris jurnal 1050/2050.
// - Jurnal baru + pemetaan pihak + audit ditulis atomik lewat satu transaksi.
// - Pelunasan/pembayaran melebihi saldo pihak hanya PERINGATAN (bisa
//   dikonfirmasi), bukan blokir.

import type Database from 'better-sqlite3';
import {
  klasifikasiAlurPihak,
  rekonsiliasiPihak as hitungRekonsiliasiPihak,
  ringkasanSaldoPihak,
  saldoPihak,
  type AlurPihak,
  type RekonsiliasiPihak,
  type SaldoPihak,
} from '../core/pihak.js';
import { buatAuditLog } from '../core/audit.js';
import type { HasilValidasiJurnal, JurnalInput } from '../core/posting.js';
import type {
  Jurnal,
  JurnalPihak,
  JurnalPihakTampil,
  Pihak,
  PihakSaldo,
} from '../core/types.js';
import { formatRp } from '../utils/format.js';
import { listBarisJurnal } from './laporan.js';
import { postingJurnal, validasiJurnalDb } from './posting.js';
import { getJurnal, insertAuditLog, listJurnalBaris } from './repository.js';

export type PihakInput = {
  nama: string;
  catatan?: string;
};

export type PostingPihakInput = {
  pihakId: string;
  input: JurnalInput;
  /** Operator sudah melihat peringatan kas minus. */
  konfirmasiPeringatan?: boolean;
  /** Operator sudah melihat peringatan pelunasan/pembayaran melebihi saldo. */
  konfirmasiSaldo?: boolean;
  /** Alias ringkas untuk `konfirmasiSaldo` (dipakai sebagian test/pemanggil). */
  konfirmasi?: boolean;
};

export type HasilPostingPihak = HasilValidasiJurnal & {
  tersimpan: boolean;
  jurnal?: Jurnal;
  pihak?: Pihak;
  alur?: AlurPihak;
  akunPihak?: string;
  saldoSebelum?: SaldoPihak;
  saldoSesudah?: SaldoPihak;
};

const AKSI_AUDIT: Record<AlurPihak, string> = {
  BERI_PINJAMAN: 'PIUTANG-BERI-PINJAMAN',
  TERIMA_PELUNASAN: 'PIUTANG-PELUNASAN',
  TERIMA_PINJAMAN: 'HUTANG-TERIMA-PINJAMAN',
  BAYAR_HUTANG: 'HUTANG-BAYAR',
  BELI_KREDIT: 'HUTANG-BELI-KREDIT',
};

function uid(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function')
    return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

type RowPihak = Record<string, unknown>;

function rowToPihak(r: RowPihak): Pihak {
  return {
    id: String(r.id),
    nama: String(r.nama),
    catatan: String(r.catatan ?? ''),
    created_at: String(r.created_at ?? ''),
  };
}

function bersihNama(nama: unknown): string {
  const teks = String(nama ?? '').trim();
  if (!teks) throw new Error('Nama pihak wajib diisi.');
  if (teks.length > 200) throw new Error('Nama pihak maks. 200 karakter.');
  return teks;
}

function bersihCatatan(catatan: unknown): string {
  const teks = String(catatan ?? '').trim();
  if (teks.length > 1000) throw new Error('Catatan pihak maks. 1000 karakter.');
  return teks;
}

function namaDipakai(db: Database.Database, nama: string, kecualiId = ''): boolean {
  const row = db
    .prepare('SELECT id FROM pihak WHERE nama = ? COLLATE NOCASE AND id <> ? LIMIT 1')
    .get(nama, kecualiId) as { id: string } | undefined;
  return Boolean(row);
}

function bacaMapping(db: Database.Database, pihakId?: string): JurnalPihak[] {
  const sql = pihakId
    ? 'SELECT jurnal_id, pihak_id, akun_kode FROM jurnal_pihak WHERE pihak_id = ? ORDER BY jurnal_id'
    : 'SELECT jurnal_id, pihak_id, akun_kode FROM jurnal_pihak ORDER BY jurnal_id';
  const rows = (pihakId
    ? db.prepare(sql).all(pihakId)
    : db.prepare(sql).all()) as RowPihak[];
  return rows.map((r) => ({
    jurnal_id: String(r.jurnal_id),
    pihak_id: String(r.pihak_id),
    akun_kode: String(r.akun_kode),
  }));
}

/** Daftar pihak (master), urut nama tanpa membedakan huruf besar/kecil. */
export function listPihak(db: Database.Database): Pihak[] {
  const rows = db
    .prepare('SELECT * FROM pihak ORDER BY nama COLLATE NOCASE, id')
    .all() as RowPihak[];
  return rows.map(rowToPihak);
}

export function getPihak(db: Database.Database, id: string): Pihak | null {
  const r = db.prepare('SELECT * FROM pihak WHERE id = ?').get(String(id ?? '')) as
    | RowPihak
    | undefined;
  return r ? rowToPihak(r) : null;
}

/** Tambah pihak + audit, atomik. Nama unik tanpa membedakan huruf besar/kecil. */
export function createPihak(
  db: Database.Database,
  input: PihakInput & { id?: string; created_at?: string },
): Pihak {
  const nama = bersihNama(input?.nama);
  const catatan = bersihCatatan(input?.catatan);
  const id = String(input?.id ?? '').trim() || uid('ph');
  if (getPihak(db, id)) throw new Error(`Pihak ${id} sudah ada. Gunakan ID lain.`);
  if (namaDipakai(db, nama))
    throw new Error(`Nama pihak "${nama}" sudah dipakai. Gunakan nama lain atau bedakan.`);

  const row: Pihak = {
    id,
    nama,
    catatan,
    created_at: String(input?.created_at ?? '').trim() || new Date().toISOString(),
  };
  const simpan = db.transaction(() => {
    db.prepare(
      'INSERT INTO pihak (id, nama, catatan, created_at) VALUES (?, ?, ?, ?)',
    ).run(row.id, row.nama, row.catatan, row.created_at);
    insertAuditLog(
      db,
      buatAuditLog(`PIHAK-CREATE ${row.id}`, `Tambah pihak ${row.nama}`, undefined, row),
    );
  });
  try {
    simpan();
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: pihak.nama'))
      throw new Error(`Nama pihak "${nama}" sudah dipakai. Gunakan nama lain atau bedakan.`);
    throw e;
  }
  return row;
}

/** Ubah nama/catatan pihak + audit. ID tidak berubah. */
export function updatePihak(
  db: Database.Database,
  id: string,
  input: PihakInput,
): Pihak {
  const lama = getPihak(db, id);
  if (!lama) throw new Error('Pihak tidak ditemukan.');
  const nama = bersihNama(input?.nama);
  const catatan = bersihCatatan(input?.catatan);
  if (namaDipakai(db, nama, lama.id))
    throw new Error(`Nama pihak "${nama}" sudah dipakai. Gunakan nama lain atau bedakan.`);

  const baru: Pihak = { ...lama, nama, catatan };
  const simpan = db.transaction(() => {
    db.prepare('UPDATE pihak SET nama = ?, catatan = ? WHERE id = ?').run(
      baru.nama,
      baru.catatan,
      baru.id,
    );
    insertAuditLog(
      db,
      buatAuditLog(`PIHAK-UPDATE ${baru.id}`, `Ubah pihak ${baru.nama}`, lama, baru),
    );
  });
  try {
    simpan();
  } catch (e) {
    if (String(e).includes('UNIQUE constraint failed: pihak.nama'))
      throw new Error(`Nama pihak "${nama}" sudah dipakai. Gunakan nama lain atau bedakan.`);
    throw e;
  }
  return baru;
}

/**
 * Hapus pihak yang BELUM dipakai jurnal. Pihak yang sudah punya riwayat
 * piutang/hutang tidak boleh dihapus agar jejak audit & laporan tidak yatim.
 */
export function deletePihak(db: Database.Database, id: string): Pihak {
  const lama = getPihak(db, id);
  if (!lama) throw new Error('Pihak tidak ditemukan.');
  const dipakai = db
    .prepare('SELECT 1 FROM jurnal_pihak WHERE pihak_id = ? LIMIT 1')
    .get(lama.id);
  if (dipakai)
    throw new Error(
      `Pihak "${lama.nama}" sudah dipakai jurnal piutang/hutang dan tidak boleh dihapus. ` +
        'Ubah namanya bila perlu, atau biarkan riwayatnya tetap ada.',
    );
  const simpan = db.transaction(() => {
    db.prepare('DELETE FROM pihak WHERE id = ?').run(lama.id);
    insertAuditLog(
      db,
      buatAuditLog(`PIHAK-DELETE ${lama.id}`, `Hapus pihak ${lama.nama}`, lama, undefined),
    );
  });
  simpan();
  return lama;
}

/** Saldo piutang/hutang semua pihak, dihitung dari jurnal. */
export function saldoPerPihak(db: Database.Database): PihakSaldo[] {
  return ringkasanSaldoPihak(listBarisJurnal(db), bacaMapping(db), listPihak(db));
}

/**
 * Rekonsiliasi saldo akun 1050/2050 vs jurnal yang sudah dipetakan ke pihak.
 * Hanya membaca jurnal + `jurnal_pihak`; selisih tidak pernah disimpan.
 */
export function rekonsiliasiPihakDb(
  db: Database.Database,
  sampai?: string,
): RekonsiliasiPihak {
  return hitungRekonsiliasiPihak(listBarisJurnal(db), bacaMapping(db), sampai);
}

/** Riwayat jurnal satu pihak + baris lengkap (untuk drill-down UI). */
export function daftarJurnalPihak(
  db: Database.Database,
  pihakId: string,
): JurnalPihakTampil[] {
  const id = String(pihakId ?? '').trim();
  if (!id) return [];
  const rows = db
    .prepare(
      `SELECT j.id AS jurnal_id, jp.akun_kode AS akun_pihak
       FROM jurnal_pihak jp
       JOIN jurnal j ON j.id = jp.jurnal_id
       WHERE jp.pihak_id = ?
       ORDER BY j.tanggal, j.rowid`,
    )
    .all(id) as { jurnal_id: string; akun_pihak: string }[];

  return rows.flatMap((r) => {
    const jurnal = getJurnal(db, String(r.jurnal_id));
    if (!jurnal) return [];
    const baris = listJurnalBaris(db, jurnal.id);
    const akun = String(r.akun_pihak);
    const mutasi = baris.filter((b) => b.akun_kode === akun);
    return [
      {
        ...jurnal,
        pihak_id: id,
        akun_pihak: akun,
        debit: mutasi.reduce((s, b) => s + b.debit, 0),
        kredit: mutasi.reduce((s, b) => s + b.kredit, 0),
        baris,
      },
    ];
  });
}

function gagal(
  pesan: string,
  extra: Partial<HasilPostingPihak> = {},
): HasilPostingPihak {
  return {
    boleh: false,
    errors: [pesan],
    peringatan: [],
    perluKonfirmasi: false,
    tersimpan: false,
    ...extra,
  };
}

/**
 * Simpan jurnal dari form Piutang/Hutang + pemetaan pihak + audit, atomik.
 *
 * Alur:
 * 1. Pihak wajib ada.
 * 2. Jurnal harus tepat salah satu dari lima alur baku (klasifikasi ketat).
 * 3. Validasi posting layer (tanggal, keseimbangan, kas minus, kunci periode).
 * 4. Pelunasan/pembayaran melebihi saldo pihak → `perluKonfirmasi` (tidak blokir).
 * 5. Tulis jurnal + `jurnal_pihak` + audit dalam satu transaksi.
 */
export function postingPihak(
  db: Database.Database,
  input: PostingPihakInput,
): HasilPostingPihak {
  const pihakId = String(input?.pihakId ?? '').trim();
  if (!pihakId) return gagal('Pihak wajib dipilih untuk transaksi piutang/hutang.');
  const pihak = getPihak(db, pihakId);
  if (!pihak) return gagal('Pihak yang dipilih tidak ditemukan. Muat ulang daftar pihak.');

  if (!input.input || !input.input.header || !Array.isArray(input.input.baris))
    return gagal('Data jurnal piutang/hutang tidak lengkap.');

  let klasifikasi: ReturnType<typeof klasifikasiAlurPihak>;
  try {
    klasifikasi = klasifikasiAlurPihak(input.input);
  } catch (e) {
    return gagal(e instanceof Error ? e.message : String(e));
  }

  const validasi = validasiJurnalDb(db, input.input);
  if (validasi.errors.length > 0) return { ...validasi, tersimpan: false };

  const saldoSebelum = saldoPihak(
    listBarisJurnal(db),
    bacaMapping(db, pihakId),
    pihakId,
  );

  const peringatan = [...validasi.peringatan];
  let melebihiSaldo = false;
  if (klasifikasi.alur === 'TERIMA_PELUNASAN' || klasifikasi.alur === 'BAYAR_HUTANG') {
    const saldoRelevan =
      klasifikasi.alur === 'TERIMA_PELUNASAN' ? saldoSebelum.piutang : saldoSebelum.hutang;
    if (klasifikasi.nominal > saldoRelevan) {
      melebihiSaldo = true;
      const lebih = klasifikasi.nominal - saldoRelevan;
      const label = klasifikasi.alur === 'TERIMA_PELUNASAN' ? 'saldo piutang' : 'saldo hutang';
      peringatan.push(
        `${klasifikasi.alur === 'TERIMA_PELUNASAN' ? 'Pelunasan' : 'Pembayaran'} ` +
          `melebihi ${label} ${pihak.nama} sebesar ${formatRp(lebih)}. ` +
          `Saldo saat ini ${formatRp(saldoRelevan)}; setelah transaksi menjadi minus. ` +
          'Periksa kembali — boleh lanjut dengan konfirmasi.',
      );
    }
  }

  const perluSaldo =
    melebihiSaldo && input.konfirmasiSaldo !== true && input.konfirmasi !== true;
  const perluKas = validasi.peringatan.length > 0 && input.konfirmasiPeringatan !== true;
  if (perluSaldo || perluKas) {
    return {
      ...validasi,
      peringatan,
      perluKonfirmasi: true,
      tersimpan: false,
      pihak,
      alur: klasifikasi.alur,
      akunPihak: klasifikasi.akunPihak,
      saldoSebelum,
    };
  }

  const alasan = String(input.input.alasan ?? '').trim();
  try {
    const simpan = db.transaction(() => {
      // `audit: []` mencegah audit generik; audit spesifik alur ditulis setelah
      // pemetaan pihak agar data "sesudah" memuat saldo yang benar.
      const hasil = postingJurnal(db, input.input, {
        konfirmasiPeringatan: true,
        audit: [],
      });
      if (!hasil.tersimpan || !hasil.jurnal) {
        return {
          ...hasil,
          peringatan,
          pihak,
          alur: klasifikasi.alur,
          akunPihak: klasifikasi.akunPihak,
          saldoSebelum,
        };
      }

      db.prepare(
        'INSERT INTO jurnal_pihak (jurnal_id, pihak_id, akun_kode) VALUES (?, ?, ?)',
      ).run(hasil.jurnal.id, pihakId, klasifikasi.akunPihak);

      const saldoSesudah = saldoPihak(
        listBarisJurnal(db),
        bacaMapping(db, pihakId),
        pihakId,
      );
      insertAuditLog(
        db,
        buatAuditLog(
          `${AKSI_AUDIT[klasifikasi.alur]} ${hasil.jurnal.id}`,
          alasan,
          { pihak, saldo: saldoSebelum },
          {
            pihak,
            akun_kode: klasifikasi.akunPihak,
            alur: klasifikasi.alur,
            jurnal: hasil.jurnal,
            baris: input.input.baris,
            saldo: saldoSesudah,
          },
        ),
      );

      return {
        ...hasil,
        peringatan,
        tersimpan: true,
        jurnal: hasil.jurnal,
        pihak,
        alur: klasifikasi.alur,
        akunPihak: klasifikasi.akunPihak,
        saldoSebelum,
        saldoSesudah,
      };
    });
    return simpan();
  } catch (e) {
    return gagal(
      `Transaksi piutang/hutang gagal disimpan: ${e instanceof Error ? e.message : String(e)}`,
      {
        peringatan,
        pihak,
        alur: klasifikasi.alur,
        akunPihak: klasifikasi.akunPihak,
        saldoSebelum,
      },
    );
  }
}
