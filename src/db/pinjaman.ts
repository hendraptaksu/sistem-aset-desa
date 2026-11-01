// Repository pinjaman LPD (DB-16b).
//
// Prinsip sumber angka:
// - `pinjaman_angsuran` adalah RENCANA (pokok/bunga dari perjanjian LPD).
// - `pinjaman_bayar` hanya menautkan jurnal + angsuran. Nominal pokok/bunga/
//   denda TIDAK disimpan; semuanya dibaca dari baris jurnal pembayaran.
// - Outstanding = sisa_pokok_awal - SUM(debit 2050 pada jurnal bayar tertaut),
//   dihitung saat membaca dan tidak pernah disimpan sebagai kolom.
//
// Jurnal pencairan TIDAK dibuat di sini. Mode "sudah berjalan" memakai
// `jurnal_pencairan_id = null`; sisa pokok dianggap sudah ada di Saldo Awal 2050.

import type Database from 'better-sqlite3';
import { tanggalKalenderValid } from '../core/posting.js';
import type {
  Jurnal,
  JurnalBaris,
  Pinjaman,
  PinjamanAngsuran,
  PinjamanBayar,
  RincianPembayaranPinjaman,
} from '../core/types.js';
import { AKUN_HUTANG, akunBolehDiposting } from './coa.js';
import { getAkun, getJurnalDetail, listAkun } from './repository.js';

/** Akun bunga default DB-13b/DB-16a. */
export const AKUN_BUNGA_PINJAMAN_DEFAULT = '5063';

export type PinjamanAngsuranInput = {
  ke: number;
  jatuh_tempo?: string;
  /** Alias camelCase untuk pemanggil UI/test. */
  jatuhTempo?: string;
  pokok: number;
  bunga: number;
  catatan?: string;
};

export type BuatPinjamanInput = {
  /** Opsional; dibuat otomatis bila kosong. */
  id?: string;
  kreditur: string;
  akun_kas?: string;
  /** Alias camelCase. */
  akunKas?: string;
  /** Default 5063 BEBAN BUNGA PINJAMAN. */
  akun_bunga?: string;
  akunBunga?: string;
  pokok_awal?: number;
  pokokAwal?: number;
  /**
   * Sisa pokok saat pinjaman mulai. Default = pokok_awal (pencairan baru).
   * Untuk pinjaman yang sudah berjalan, isi sisa pokok dan `jurnal_pencairan_id`
   * null.
   */
  sisa_pokok_awal?: number;
  sisaPokokAwal?: number;
  tanggal_mulai?: string;
  tanggalMulai?: string;
  tenor_bulan?: number | null;
  tenorBulan?: number | null;
  /** Null/kosong = pinjaman sudah berjalan; tidak ada jurnal pencairan baru. */
  jurnal_pencairan_id?: string | null;
  jurnalPencairanId?: string | null;
  catatan?: string;
  created_at?: string;
  angsuran?: PinjamanAngsuranInput[];
  /** Alias untuk `angsuran`. */
  jadwal?: PinjamanAngsuranInput[];
};

export type HasilPinjaman = {
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  perluKonfirmasi: boolean;
  tersimpan: boolean;
  pinjaman?: Pinjaman;
};

export type TautkanPembayaranInput = {
  /** Opsional; dibuat otomatis bila kosong. */
  id?: string;
  pinjaman_id?: string;
  pinjamanId?: string;
  /** Null/kosong = pembayaran tanpa angsuran tertentu (mis. pelunasan). */
  angsuran_id?: number | null;
  angsuranId?: number | null;
  jurnal_id?: string;
  jurnalId?: string;
  /** Default = tanggal jurnal. */
  tanggal?: string;
  catatan?: string;
  created_at?: string;
};

export type HasilPembayaranPinjaman = {
  boleh: boolean;
  errors: string[];
  peringatan: string[];
  perluKonfirmasi: boolean;
  tersimpan: boolean;
  pembayaran?: PinjamanBayar;
};

type Row = Record<string, unknown>;

const kosong = {
  boleh: false,
  errors: [] as string[],
  peringatan: [] as string[],
  perluKonfirmasi: false,
  tersimpan: false,
};

function gagal(errors: string | string[]): HasilPinjaman {
  return { ...kosong, errors: Array.isArray(errors) ? errors : [errors] };
}

function gagalBayar(errors: string | string[]): HasilPembayaranPinjaman {
  return { ...kosong, errors: Array.isArray(errors) ? errors : [errors] };
}

function uid(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function')
    return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

const isInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v);

function teks(v: unknown): string {
  return String(v ?? '').trim();
}

function nullableTeks(v: unknown): string | null {
  const s = teks(v);
  return s ? s : null;
}

function angka(v: unknown): number {
  return Number(v ?? 0);
}

function rowToAngsuran(r: Row): PinjamanAngsuran {
  const bayarId = nullableTeks(r.pinjaman_bayar_id);
  return {
    id: angka(r.id),
    pinjaman_id: String(r.pinjaman_id),
    ke: angka(r.ke),
    jatuh_tempo: String(r.jatuh_tempo),
    pokok: angka(r.pokok),
    bunga: angka(r.bunga),
    catatan: String(r.catatan ?? ''),
    status: bayarId ? 'LUNAS' : 'BELUM',
    dibayar: bayarId !== null,
    pinjaman_bayar_id: bayarId,
    tanggal_bayar: nullableTeks(r.tanggal_bayar),
    jurnal_id: nullableTeks(r.jurnal_id),
  };
}

/** Baris pinjaman tanpa turunan; dipakai internal sebelum dilengkapi. */
function rowToPinjaman(r: Row): Pinjaman {
  return {
    id: String(r.id),
    kreditur: String(r.kreditur),
    akun_kas: String(r.akun_kas),
    akun_bunga: String(r.akun_bunga),
    pokok_awal: angka(r.pokok_awal),
    sisa_pokok_awal: angka(r.sisa_pokok_awal),
    tanggal_mulai: String(r.tanggal_mulai),
    tenor_bulan:
      r.tenor_bulan === null || r.tenor_bulan === undefined
        ? null
        : angka(r.tenor_bulan),
    jurnal_pencairan_id: nullableTeks(r.jurnal_pencairan_id),
    catatan: String(r.catatan ?? ''),
    created_at: String(r.created_at ?? ''),
  };
}

function daftarAngsuran(db: Database.Database, pinjamanId: string): PinjamanAngsuran[] {
  const rows = db
    .prepare(
      `SELECT a.*, pb.id AS pinjaman_bayar_id, pb.tanggal AS tanggal_bayar,
              pb.jurnal_id AS jurnal_id
         FROM pinjaman_angsuran a
         LEFT JOIN pinjaman_bayar pb ON pb.angsuran_id = a.id
        WHERE a.pinjaman_id = ?
        ORDER BY a.ke, a.id`,
    )
    .all(pinjamanId) as Row[];
  return rows.map(rowToAngsuran);
}

function jurnalSeimbang(detail: { jurnal: Jurnal; baris: JurnalBaris[] } | null): boolean {
  if (!detail || detail.baris.length < 2) return false;
  const totalDebit = detail.baris.reduce((s, b) => s + angka(b.debit), 0);
  const totalKredit = detail.baris.reduce((s, b) => s + angka(b.kredit), 0);
  return totalDebit > 0 && totalDebit === totalKredit;
}

/**
 * Rincian pembayaran dari baris jurnal:
 * - pokok = debit 2050;
 * - bunga = debit akun bunga pinjaman;
 * - denda = debit BEBAN lain (mis. 5050);
 * - kas keluar = kredit akun kas/bank.
 * Tidak membaca nominal dari `pinjaman_bayar`.
 */
export function rincianPembayaranDariJurnal(
  db: Database.Database,
  jurnalId: string,
  akunBunga: string,
): RincianPembayaranPinjaman {
  const detail = getJurnalDetail(db, jurnalId);
  if (!detail)
    return { pokok: 0, bunga: 0, denda: 0, kas_keluar: 0 };

  const akun = new Map(listAkun(db).map((a) => [a.kode, a]));
  const hasil: RincianPembayaranPinjaman = {
    pokok: 0,
    bunga: 0,
    denda: 0,
    kas_keluar: 0,
  };
  for (const b of detail.baris) {
    const kode = String(b.akun_kode);
    const debit = angka(b.debit);
    const kredit = angka(b.kredit);
    if (kode === AKUN_HUTANG) hasil.pokok += debit;
    if (kode === akunBunga) hasil.bunga += debit;
    else if (akun.get(kode)?.tipe === 'BEBAN') hasil.denda += debit;
    if (akun.get(kode)?.is_kas) hasil.kas_keluar += kredit;
  }
  return hasil;
}

function validasiJurnalPembayaran(
  db: Database.Database,
  jurnalId: string,
  akunBunga: string,
): { error: string | null; rincian: RincianPembayaranPinjaman } {
  const detail = getJurnalDetail(db, jurnalId);
  if (!detail)
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak ditemukan.`,
      rincian: { pokok: 0, bunga: 0, denda: 0, kas_keluar: 0 },
    };
  if (!jurnalSeimbang(detail))
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak seimbang (total debit harus sama dengan kredit).`,
      rincian: { pokok: 0, bunga: 0, denda: 0, kas_keluar: 0 },
    };

  const rincian = rincianPembayaranDariJurnal(db, jurnalId, akunBunga);
  if (rincian.pokok <= 0)
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak memuat debit 2050 untuk pokok pinjaman.`,
      rincian,
    };
  if (rincian.kas_keluar <= 0)
    return {
      error: `Jurnal pembayaran ${jurnalId} tidak memuat kredit kas/bank.`,
      rincian,
    };
  return { error: null, rincian };
}

function barisPembayaran(db: Database.Database, r: Row, akunBunga: string): PinjamanBayar {
  const jurnalId = String(r.jurnal_id);
  const rincian = rincianPembayaranDariJurnal(db, jurnalId, akunBunga);
  return {
    id: String(r.id),
    pinjaman_id: String(r.pinjaman_id),
    angsuran_id:
      r.angsuran_id === null || r.angsuran_id === undefined
        ? null
        : angka(r.angsuran_id),
    jurnal_id: jurnalId,
    tanggal: String(r.tanggal),
    catatan: String(r.catatan ?? ''),
    created_at: String(r.created_at ?? ''),
    pokok: rincian.pokok,
    bunga: rincian.bunga,
    denda: rincian.denda,
    kas_keluar: rincian.kas_keluar,
  };
}

function daftarPembayaran(db: Database.Database, pinjamanId: string): PinjamanBayar[] {
  const rows = db
    .prepare(
      `SELECT pb.*, p.akun_bunga
         FROM pinjaman_bayar pb
         JOIN pinjaman p ON p.id = pb.pinjaman_id
        WHERE pb.pinjaman_id = ?
        ORDER BY pb.tanggal, pb.id`,
    )
    .all(pinjamanId) as Row[];
  return rows.map((r) => barisPembayaran(db, r, String(r.akun_bunga)));
}

function lengkapiPinjaman(db: Database.Database, row: Row): Pinjaman {
  const pinjaman = rowToPinjaman(row);
  const angsuran = daftarAngsuran(db, pinjaman.id);
  const pembayaran = daftarPembayaran(db, pinjaman.id);
  const totalPokok = pembayaran.reduce((s, p) => s + p.pokok, 0);
  const totalBunga = pembayaran.reduce((s, p) => s + p.bunga, 0);
  const totalDenda = pembayaran.reduce((s, p) => s + p.denda, 0);
  return {
    ...pinjaman,
    outstanding: pinjaman.sisa_pokok_awal - totalPokok,
    total_pokok_dibayar: totalPokok,
    total_bunga_dibayar: totalBunga,
    total_denda_dibayar: totalDenda,
    angsuran,
  };
}

/**
 * Buat pinjaman + jadwal angsuran secara atomik. Jurnal pencairan TIDAK dibuat:
 * - pencairan baru: pemanggil sudah membuat/memposting jurnal dan mengirim ID-nya;
 * - sudah berjalan: `jurnal_pencairan_id` null, sisa pokok ada di Saldo Awal 2050.
 *
 * Validasi utama: akun kas aktif ber-`is_kas`, akun bunga aktif BEBAN, nominal
 * integer, tanggal valid, `ke` naik, tanggal jadwal tidak mundur, dan
 * SUM(pokok jadwal) = sisa_pokok_awal.
 */
export function buatPinjaman(
  db: Database.Database,
  input: BuatPinjamanInput,
): HasilPinjaman {
  const data = (input ?? {}) as BuatPinjamanInput;
  const errors: string[] = [];

  const id = teks(data.id) || uid('pjr');
  const kreditur = teks(data.kreditur);
  if (!kreditur) errors.push('Nama kreditur pinjaman wajib diisi.');
  else if (kreditur.length > 200)
    errors.push('Nama kreditur pinjaman maks. 200 karakter.');

  const akunKasKode = teks(data.akun_kas ?? data.akunKas);
  const akunKas = akunKasKode ? getAkun(db, akunKasKode) : null;
  if (
    !akunKas ||
    !akunKas.aktif ||
    akunKas.tipe !== 'AKTIVA' ||
    !akunKas.is_kas ||
    !akunBolehDiposting(akunKasKode, akunKas.aktif, { dikenal: true })
  )
    errors.push(
      'Akun kas pinjaman wajib akun AKTIVA kas/bank yang aktif (is_kas = 1).',
    );

  const akunBungaKode =
    teks(data.akun_bunga ?? data.akunBunga) || AKUN_BUNGA_PINJAMAN_DEFAULT;
  const akunBunga = getAkun(db, akunBungaKode);
  if (
    !akunBunga ||
    !akunBunga.aktif ||
    akunBunga.tipe !== 'BEBAN' ||
    !akunBolehDiposting(akunBungaKode, akunBunga.aktif, { dikenal: true })
  )
    errors.push(
      `Akun bunga pinjaman wajib akun BEBAN yang aktif (default ${AKUN_BUNGA_PINJAMAN_DEFAULT}).`,
    );

  const pokokAwal = data.pokok_awal ?? data.pokokAwal;
  if (!isInt(pokokAwal) || pokokAwal <= 0)
    errors.push('Pokok awal pinjaman harus bilangan bulat lebih dari 0 (satuan sen).');

  const sisaMentah = data.sisa_pokok_awal ?? data.sisaPokokAwal;
  const sisaPokokAwal = sisaMentah === undefined ? pokokAwal : sisaMentah;
  if (!isInt(sisaPokokAwal) || sisaPokokAwal < 0)
    errors.push('Sisa pokok awal harus bilangan bulat ≥ 0 (satuan sen).');
  else if (isInt(pokokAwal) && sisaPokokAwal > pokokAwal)
    errors.push('Sisa pokok awal tidak boleh melebihi pokok awal.');

  const tanggalMulai = teks(data.tanggal_mulai ?? data.tanggalMulai);
  if (!tanggalKalenderValid(tanggalMulai))
    errors.push('Tanggal mulai pinjaman tidak valid (YYYY-MM-DD).');

  const tenorMentah = data.tenor_bulan ?? data.tenorBulan;
  let tenorBulan: number | null = null;
  if (tenorMentah !== undefined && tenorMentah !== null) {
    if (!isInt(tenorMentah) || tenorMentah <= 0)
      errors.push('Tenor pinjaman harus bilangan bulat lebih dari 0 bulan.');
    else tenorBulan = tenorMentah;
  }

  const jurnalPencairanId = nullableTeks(
    data.jurnal_pencairan_id ?? data.jurnalPencairanId,
  );
  if (jurnalPencairanId) {
    const detail = getJurnalDetail(db, jurnalPencairanId);
    if (!detail)
      errors.push(`Jurnal pencairan ${jurnalPencairanId} tidak ditemukan.`);
    else if (!jurnalSeimbang(detail))
      errors.push(
        `Jurnal pencairan ${jurnalPencairanId} tidak seimbang (total debit harus sama dengan kredit).`,
      );
    else if (
      db
        .prepare('SELECT id FROM pinjaman WHERE jurnal_pencairan_id = ? LIMIT 1')
        .get(jurnalPencairanId)
    )
      errors.push(
        `Jurnal pencairan ${jurnalPencairanId} sudah ditautkan ke pinjaman lain.`,
      );
  }

  const jadwalMentah = data.angsuran ?? data.jadwal;
  const jadwal: {
    ke: number;
    jatuh_tempo: string;
    pokok: number;
    bunga: number;
    catatan: string;
  }[] = [];
  if (!Array.isArray(jadwalMentah) || jadwalMentah.length === 0) {
    errors.push('Jadwal angsuran wajib berisi minimal satu baris.');
  } else {
    let keSebelumnya = 0;
    let tanggalSebelumnya = '';
    for (let i = 0; i < jadwalMentah.length; i += 1) {
      const it = (jadwalMentah[i] ?? {}) as PinjamanAngsuranInput;
      const label = `Jadwal angsuran baris ${i + 1}`;
      const ke = it.ke;
      if (!isInt(ke) || ke <= 0) {
        errors.push(`${label}: nomor ke harus bilangan bulat lebih dari 0.`);
      } else if (ke <= keSebelumnya) {
        errors.push(
          `${label}: nomor ke harus naik dan tidak boleh ganda (${ke} setelah ${keSebelumnya}).`,
        );
      } else {
        keSebelumnya = ke;
      }

      const jatuhTempo = teks(it.jatuh_tempo ?? it.jatuhTempo);
      if (!tanggalKalenderValid(jatuhTempo)) {
        errors.push(`${label}: tanggal jatuh tempo tidak valid (YYYY-MM-DD).`);
      } else if (tanggalSebelumnya && jatuhTempo < tanggalSebelumnya) {
        errors.push(
          `${label}: tanggal jatuh tempo tidak boleh mundur dari baris sebelumnya (${tanggalSebelumnya}).`,
        );
      } else {
        tanggalSebelumnya = jatuhTempo;
      }

      if (!isInt(it.pokok) || it.pokok < 0)
        errors.push(`${label}: pokok harus bilangan bulat ≥ 0 (satuan sen).`);
      if (!isInt(it.bunga) || it.bunga < 0)
        errors.push(`${label}: bunga harus bilangan bulat ≥ 0 (satuan sen).`);

      jadwal.push({
        ke: Number(ke),
        jatuh_tempo: jatuhTempo,
        pokok: Number(it.pokok),
        bunga: Number(it.bunga),
        catatan: teks(it.catatan),
      });
    }

    if (
      isInt(sisaPokokAwal) &&
      jadwal.every((r) => isInt(r.pokok)) &&
      jadwal.reduce((s, r) => s + r.pokok, 0) !== sisaPokokAwal
    ) {
      const total = jadwal.reduce((s, r) => s + r.pokok, 0);
      errors.push(
        `Total pokok jadwal (${total}) harus sama dengan sisa pokok awal (${sisaPokokAwal}).`,
      );
    }
  }

  if (errors.length > 0) return gagal(errors);

  const pinjaman: Pinjaman = {
    id,
    kreditur,
    akun_kas: akunKasKode,
    akun_bunga: akunBungaKode,
    pokok_awal: pokokAwal as number,
    sisa_pokok_awal: sisaPokokAwal as number,
    tanggal_mulai: tanggalMulai,
    tenor_bulan: tenorBulan,
    jurnal_pencairan_id: jurnalPencairanId,
    catatan: teks(data.catatan),
    created_at: teks(data.created_at) || new Date().toISOString(),
  };

  try {
    const simpan = db.transaction(() => {
      const sudah = db
        .prepare('SELECT id FROM pinjaman WHERE id = ?')
        .get(id) as { id: string } | undefined;
      if (sudah) throw new Error(`Pinjaman ${id} sudah ada. Gunakan ID lain.`);

      db.prepare(
        `INSERT INTO pinjaman
           (id, kreditur, akun_kas, akun_bunga, pokok_awal, sisa_pokok_awal,
            tanggal_mulai, tenor_bulan, jurnal_pencairan_id, catatan, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pinjaman.id,
        pinjaman.kreditur,
        pinjaman.akun_kas,
        pinjaman.akun_bunga,
        pinjaman.pokok_awal,
        pinjaman.sisa_pokok_awal,
        pinjaman.tanggal_mulai,
        pinjaman.tenor_bulan,
        pinjaman.jurnal_pencairan_id,
        pinjaman.catatan,
        pinjaman.created_at,
      );

      const ins = db.prepare(
        `INSERT INTO pinjaman_angsuran
           (pinjaman_id, ke, jatuh_tempo, pokok, bunga, catatan)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const r of jadwal)
        ins.run(
          pinjaman.id,
          r.ke,
          r.jatuh_tempo,
          r.pokok,
          r.bunga,
          r.catatan,
        );
    });
    simpan();
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed: pinjaman\.jurnal_pencairan_id/i.test(pesan))
      return gagal(
        `Jurnal pencairan ${jurnalPencairanId ?? ''} sudah ditautkan ke pinjaman lain.`,
      );
    return gagal(`Pinjaman gagal disimpan: ${pesan}`);
  }

  return {
    ...kosong,
    boleh: true,
    tersimpan: true,
    pinjaman: getPinjaman(db, id) ?? pinjaman,
  };
}

/** Daftar pinjaman + jadwal + outstanding turunan (bukan kolom tersimpan). */
export function listPinjaman(db: Database.Database): Pinjaman[] {
  const rows = db
    .prepare('SELECT * FROM pinjaman ORDER BY tanggal_mulai, id')
    .all() as Row[];
  return rows.map((r) => lengkapiPinjaman(db, r));
}

export function getPinjaman(db: Database.Database, id: string): Pinjaman | null {
  const row = db
    .prepare('SELECT * FROM pinjaman WHERE id = ?')
    .get(teks(id)) as Row | undefined;
  return row ? lengkapiPinjaman(db, row) : null;
}

/** Outstanding turunan; null bila pinjaman tidak ada. */
export function hitungOutstandingPinjaman(
  db: Database.Database,
  id: string,
): number | null {
  return getPinjaman(db, id)?.outstanding ?? null;
}

/** Daftar pembayaran tertaut + nominal turunan dari jurnal. */
export function listPinjamanBayar(
  db: Database.Database,
  pinjamanId: string,
): PinjamanBayar[] {
  return daftarPembayaran(db, teks(pinjamanId));
}

export function getPembayaranPinjaman(
  db: Database.Database,
  id: string,
): PinjamanBayar | null {
  const row = db
    .prepare(
      `SELECT pb.*, p.akun_bunga
         FROM pinjaman_bayar pb
         JOIN pinjaman p ON p.id = pb.pinjaman_id
        WHERE pb.id = ?`,
    )
    .get(teks(id)) as Row | undefined;
  return row ? barisPembayaran(db, row, String(row.akun_bunga)) : null;
}

/**
 * Status angsuran diturunkan dari link pembayaran, bukan kolom tersimpan.
 * Pinjaman yang tidak ada mengembalikan daftar kosong.
 */
export function statusAngsuranPinjaman(
  db: Database.Database,
  pinjamanId: string,
): PinjamanAngsuran[] {
  return getPinjaman(db, pinjamanId)?.angsuran ?? [];
}

/**
 * Tautkan pembayaran ke pinjaman/angsuran. Hanya menyimpan link jurnal —
 * nominal pokok/bunga/denda dibaca dari jurnal saat laporan dibuka.
 *
 * Jurnal wajib sudah ada, seimbang, memuat debit 2050 (pokok) dan kredit kas.
 * Satu angsuran dan satu jurnal hanya boleh ditautkan sekali.
 */
export function tautkanPembayaran(
  db: Database.Database,
  input: TautkanPembayaranInput,
): HasilPembayaranPinjaman {
  const data = (input ?? {}) as TautkanPembayaranInput;
  const pinjamanId = teks(data.pinjaman_id ?? data.pinjamanId);
  if (!pinjamanId) return gagalBayar('Pinjaman yang dibayar belum dipilih.');

  const pinjaman = getPinjaman(db, pinjamanId);
  if (!pinjaman) return gagalBayar(`Pinjaman ${pinjamanId} tidak ditemukan.`);

  const jurnalId = teks(data.jurnal_id ?? data.jurnalId);
  if (!jurnalId)
    return gagalBayar('Jurnal pembayaran belum dipilih/dibuat.');

  const cekJurnal = validasiJurnalPembayaran(db, jurnalId, pinjaman.akun_bunga);
  if (cekJurnal.error) return gagalBayar(cekJurnal.error);

  const angsuranMentah = data.angsuran_id ?? data.angsuranId;
  let angsuranId: number | null = null;
  if (angsuranMentah !== undefined && angsuranMentah !== null && teks(angsuranMentah) !== '') {
    const n = Number(angsuranMentah);
    if (!Number.isSafeInteger(n) || n <= 0)
      return gagalBayar('ID angsuran tidak valid.');
    const baris = db
      .prepare(
        'SELECT id FROM pinjaman_angsuran WHERE id = ? AND pinjaman_id = ?',
      )
      .get(n, pinjamanId) as { id: number } | undefined;
    if (!baris)
      return gagalBayar(
        `Angsuran ${n} tidak ditemukan pada pinjaman ${pinjamanId}.`,
      );
    const sudah = db
      .prepare('SELECT id FROM pinjaman_bayar WHERE angsuran_id = ? LIMIT 1')
      .get(n) as { id: string } | undefined;
    if (sudah)
      return gagalBayar(
        `Angsuran ${n} sudah dibayar melalui pembayaran ${sudah.id}. ` +
          'Satu angsuran hanya boleh dibayar satu kali.',
      );
    angsuranId = n;
  }

  const jurnalTerpakai = db
    .prepare('SELECT id FROM pinjaman_bayar WHERE jurnal_id = ? LIMIT 1')
    .get(jurnalId) as { id: string } | undefined;
  if (jurnalTerpakai)
    return gagalBayar(
      `Jurnal ${jurnalId} sudah ditautkan ke pembayaran ${jurnalTerpakai.id}.`,
    );

  const detail = getJurnalDetail(db, jurnalId);
  const tanggal = teks(data.tanggal) || detail?.jurnal.tanggal || '';
  if (!tanggalKalenderValid(tanggal))
    return gagalBayar('Tanggal pembayaran tidak valid (YYYY-MM-DD).');

  const id = teks(data.id) || uid('pby');
  const pembayaran = {
    id,
    pinjaman_id: pinjamanId,
    angsuran_id: angsuranId,
    jurnal_id: jurnalId,
    tanggal,
    catatan: teks(data.catatan),
    created_at: teks(data.created_at) || new Date().toISOString(),
  };

  try {
    const simpan = db.transaction(() => {
      const sudah = db
        .prepare('SELECT id FROM pinjaman_bayar WHERE id = ?')
        .get(id) as { id: string } | undefined;
      if (sudah) throw new Error(`Pembayaran ${id} sudah ada. Gunakan ID lain.`);

      db.prepare(
        `INSERT INTO pinjaman_bayar
           (id, pinjaman_id, angsuran_id, jurnal_id, tanggal, catatan, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        pembayaran.id,
        pembayaran.pinjaman_id,
        pembayaran.angsuran_id,
        pembayaran.jurnal_id,
        pembayaran.tanggal,
        pembayaran.catatan,
        pembayaran.created_at,
      );
    });
    simpan();
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    if (/UNIQUE constraint failed: pinjaman_bayar\.jurnal_id/i.test(pesan))
      return gagalBayar(`Jurnal ${jurnalId} sudah ditautkan ke pembayaran lain.`);
    if (/UNIQUE constraint failed: pinjaman_bayar\.angsuran_id/i.test(pesan))
      return gagalBayar(
        `Angsuran ${angsuranId ?? ''} sudah dibayar. Satu angsuran hanya boleh dibayar sekali.`,
      );
    return gagalBayar(`Pembayaran pinjaman gagal disimpan: ${pesan}`);
  }

  return {
    ...kosong,
    boleh: true,
    tersimpan: true,
    pembayaran: getPembayaranPinjaman(db, id) ?? {
      ...pembayaran,
      ...cekJurnal.rincian,
    },
  };
}

/** Rincian nominal satu pembayaran (dibaca ulang dari jurnal), null bila tidak ada. */
export function rincianPembayaranPinjaman(
  db: Database.Database,
  pembayaranId: string,
): RincianPembayaranPinjaman | null {
  const p = getPembayaranPinjaman(db, pembayaranId);
  if (!p) return null;
  return {
    pokok: p.pokok,
    bunga: p.bunga,
    denda: p.denda,
    kas_keluar: p.kas_keluar,
  };
}

/** Alias DB-16d: pembayaran link-only memakai fungsi yang sama. */
export const catatPembayaran = tautkanPembayaran;
/** Alias Inggris untuk pemanggil baru. */
export const createPinjaman = buatPinjaman;
export const getPinjamanDetail = getPinjaman;
export const listPembayaranPinjaman = listPinjamanBayar;
export const hitungRincianPembayaran = rincianPembayaranPinjaman;
