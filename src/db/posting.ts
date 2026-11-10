// Jembatan posting layer murni (core/posting.ts) dengan database.
// Semua jalur simpan jurnal untuk aplikasi sebaiknya lewat `postingJurnal()`,
// supaya aturan bisnis tidak tersebar di UI/IPC (P0-4).

import type Database from 'better-sqlite3';
import { AKUN_HUTANG_USAHA, kodeKasDariDaftarAkun } from './coa.js';
import { buatAuditLog } from '../core/audit.js';
import {
  getPengaturanPembukuan,
  insertAuditLog,
  insertJurnalTervalidasi,
  listAkun,
  listTutupBuku,
} from './repository.js';
import {
  validasiJurnal,
  type HasilValidasiJurnal,
  type JurnalInput,
  type PostingContext,
} from '../core/posting.js';
import type { AuditLog, Jurnal, JurnalBarisInput } from '../core/types.js';
import { tanggalLokal } from '../utils/tanggal.js';

export type OpsiPosting = {
  /** Internal: layanan koreksi telah memverifikasi asal grup saldo pembukaan. */
  koreksiSaldoAwal?: boolean;
  /** Operator sudah melihat peringatan (mis. kas minus) dan memilih lanjut. */
  konfirmasiPeringatan?: boolean;
  /** AKT-06: alasan operator melanjutkan meski ada peringatan. */
  alasanPeringatan?: string;
  /**
   * AKT-06: pintu input yang mewajibkan alasan ≥5 karakter saat konfirmasi
   * peringatan. Sejak AKT-08 jalur Panjar juga memakai ini.
   */
  wajibAlasanPeringatan?: boolean;
  /**
   * Pintu input yang mewajibkan saldo awal lebih dulu (AKT-01). Jurnal pertama
   * non-SALDO_AWAL ditolak selama belum ada jurnal sama sekali, kecuali operator
   * sudah memilih "mulai tanpa saldo awal".
   */
  wajibSaldoAwal?: boolean;
  /** Operator sudah mengonfirmasi memulai pembukuan tanpa saldo awal. */
  konfirmasiTanpaSaldoAwal?: boolean;
  /**
   * Baris audit yang ditulis ATOMIK bersama jurnal. Dipakai reversal (P0-6)
   * dan nanti operasi lain yang wajib punya jejak audit (P0-9).
   */
  audit?: AuditLog[];
  /**
   * AKT-14: tanggal acuan (YYYY-MM-DD) untuk menolak jurnal di masa depan.
   * Kosong = tanggal lokal WITA saat ini. Disediakan agar test tidak bergantung
   * tanggal mesin.
   */
  sekarang?: string;
  /**
   * T-A04: pengecualian sempit untuk koreksi histori. Hanya reversal/koreksi
   * yang sudah memverifikasi cermin/persis jurnal asli yang boleh mengisi ini.
   * Jalur input manual tidak pernah mengirim field ini.
   */
  akunNonaktifDiizinkan?: ReadonlySet<string>;
};

export const PESAN_WAJIB_SALDO_AWAL =
  'Belum ada saldo awal. Isi Wizard Saldo Awal dulu, atau konfirmasi mulai tanpa saldo awal.';

/** AKT-06: pesan saat konfirmasi peringatan tidak disertai alasan yang cukup. */
export const PESAN_WAJIB_ALASAN_PERINGATAN =
  'Konfirmasi peringatan wajib disertai alasan minimal 5 karakter.';

/**
 * Guard jurnal pertama (AKT-01/AKT-02). Dipanggil DI DALAM transaksi tulis agar
 * dua posting pertama tidak bisa sama-sama lolos. Saldo awal sendiri dan
 * pemanggil DB langsung tanpa opsi tetap kompatibel.
 */
export function pastikanWajibSaldoAwal(
  db: Database.Database,
  opsi: OpsiPosting,
  jenis: JurnalInput['header']['jenis'] | undefined = undefined,
): void {
  if (opsi.wajibSaldoAwal !== true) return;
  if (opsi.konfirmasiTanpaSaldoAwal === true) return;
  if (jenis === 'SALDO_AWAL') return;
  const row = db.prepare('SELECT COUNT(*) AS total FROM jurnal').get() as {
    total: number;
  };
  if (Number(row.total) === 0) throw new Error(PESAN_WAJIB_SALDO_AWAL);
}

export type HasilPosting = HasilValidasiJurnal & {
  tersimpan: boolean;
  jurnal?: Jurnal;
};

/** Ambil konteks DB yang dibutuhkan validator murni. */
export function buatKonteksPosting(
  db: Database.Database,
  header: JurnalInput['header'] | null | undefined,
  /** AKT-14: override tanggal acuan; default tanggal lokal WITA. */
  sekarang?: string,
): PostingContext {
  const tanggal = String(header?.tanggal ?? '').trim();
  const noBukti = String(header?.no_bukti ?? '').trim();
  // AUD-23: validasi duplikat hanya terhadap nomor di tahun yang sama. Validasi
  // tanggal tetap dilakukan di posting layer; query ini memakai prefix tahun
  // agar cocok dengan unique index `idx_jurnal_no_bukti_tahun`.
  const noBuktiTerpakai = noBukti
    ? (db
        .prepare(
          `SELECT no_bukti FROM jurnal
           WHERE no_bukti <> ''
             AND substr(tanggal, 1, 4) = ?
             AND no_bukti = ? COLLATE NOCASE`,
        )
        .all(tanggal.slice(0, 4), noBukti) as { no_bukti: string }[]).map((r) => String(r.no_bukti))
    : [];

  // AUD-10: saldo kas harus mencerminkan posisi pada tanggal jurnal, bukan
  // seluruh riwayat. Jurnal bertanggal setelah header tidak boleh "menutupi"
  // kas minus yang terjadi lebih dulu (mis. pengeluaran backdate).
  // DB-14: daftar dompet berasal dari master `akun` (is_kas=1), sehingga akun
  // bank/LPD baru ikut diperiksa peringatan kas minus.
  const daftarAkun = listAkun(db);
  const kasKodes = kodeKasDariDaftarAkun(daftarAkun);
  const setKas = new Set(kasKodes);
  const saldoKas: Record<string, number> = {};
  for (const kode of kasKodes) saldoKas[kode] = 0;
  const saldoRows = db
    .prepare(
      `SELECT b.akun_kode, COALESCE(SUM(b.debit - b.kredit), 0) AS saldo
       FROM jurnal_baris b JOIN jurnal j ON j.id = b.jurnal_id
       WHERE j.tanggal <= ?
       GROUP BY b.akun_kode`,
    )
    .all(tanggal) as { akun_kode: string; saldo: number }[];
  for (const r of saldoRows) {
    if (setKas.has(String(r.akun_kode))) saldoKas[String(r.akun_kode)] = Number(r.saldo);
  }
  // AUD2-10: saldo normal kredit 2060 HUTANG USAHA pada tanggal jurnal, yaitu
  // SUM(kredit - debit). Memakai cutoff dan sumber baris yang sama dengan saldo
  // kas; jurnal yang sedang divalidasi belum tersimpan sehingga delta-nya baru
  // ditambahkan di validator (tidak dobel).
  const saldoHutangUsaha = -Number(
    saldoRows.find((r) => String(r.akun_kode) === AKUN_HUTANG_USAHA)?.saldo ?? 0,
  );

  // AKT-04: backdate tidak boleh lolos hanya karena saldo pada tanggal jurnal
  // masih positif. Hitung minimum cumulative sum mutasi kas SETELAH tanggal
  // jurnal (mulai dari 0), per akun kas. Jurnal di tanggal yang sama sudah
  // termasuk `saldoKas`, jadi di sini hanya `j.tanggal > tanggal`. Agregasi per
  // jurnal (bukan per baris) agar debit/kredit dalam satu jurnal tidak sempat
  // menghasilkan minus semu; urutan tanggal + id menjaga determinisme.
  const kasMinimumSetelah: Record<string, number> = {};
  for (const kode of kasKodes) kasMinimumSetelah[kode] = 0;
  const setelahRows = db
    .prepare(
      `SELECT b.akun_kode, COALESCE(SUM(b.debit - b.kredit), 0) AS delta
       FROM jurnal_baris b JOIN jurnal j ON j.id = b.jurnal_id
       WHERE j.tanggal > ?
       GROUP BY b.akun_kode, j.id, j.tanggal
       ORDER BY j.tanggal ASC, j.id ASC`,
    )
    .all(tanggal) as { akun_kode: string; delta: number }[];
  const kumulatifSetelah = new Map<string, number>();
  for (const r of setelahRows) {
    const kode = String(r.akun_kode);
    if (!setKas.has(kode)) continue;
    const kumulatif = (kumulatifSetelah.get(kode) ?? 0) + Number(r.delta);
    kumulatifSetelah.set(kode, kumulatif);
    kasMinimumSetelah[kode] = Math.min(kasMinimumSetelah[kode] ?? 0, kumulatif);
  }

  return {
    akun: daftarAkun.map((a) => ({
      kode: a.kode,
      nama: a.nama,
      tipe: a.tipe,
      posisi_normal: a.posisi_normal,
      aktif: a.aktif,
      is_kas: a.is_kas,
      kelompok: a.kelompok,
      sumber: a.sumber,
    })),
    tutupBuku: listTutupBuku(db).map((t) => ({ tahun: Number(t.tahun) })),
    noBuktiTerpakai,
    saldoKas,
    saldoHutangUsaha,
    kasMinimumSetelah,
    // AKT-03: batas bawah pembukuan dibaca dari pengaturan. Nilai kosong tetap
    // kosong (bukan `tanggalMulaiEfektif` yang jatuh ke hari ini) agar data
    // lama tanpa setting tidak tiba-tiba kehilangan kemampuan backdate.
    tanggalMulaiPembukuan: getPengaturanPembukuan(db).tanggalMulaiPembukuan,
    // AKT-14: "hari ini" versi bisnis (WITA), bukan toISOString/UTC.
    sekarang: String(sekarang ?? '').trim() || tanggalLokal(),
  };
}

/** Validasi jurnal dengan konteks dari DB (tanpa menyimpan). */
export function validasiJurnalDb(
  db: Database.Database,
  input: JurnalInput | null | undefined,
  /** AKT-14: override tanggal acuan agar test tidak bergantung tanggal mesin. */
  opsi: Pick<
    OpsiPosting,
    'sekarang' | 'koreksiSaldoAwal' | 'akunNonaktifDiizinkan'
  > = {},
): HasilValidasiJurnal {
  return validasiJurnal(input, {
    ...buatKonteksPosting(db, input?.header, opsi.sekarang),
    koreksiSaldoAwal: opsi.koreksiSaldoAwal === true,
    akunNonaktifDiizinkan: opsi.akunNonaktifDiizinkan,
  });
}

/** Alasan konfirmasi peringatan yang sudah dinormalisasi (trim). */
function alasanPeringatanBersih(opsi: OpsiPosting): string {
  return String(opsi.alasanPeringatan ?? '').trim();
}

/**
 * AKT-06: data audit jurnal. Jurnal tanpa peringatan tetap memakai bentuk lama
 * `{ jurnal, baris }`; saat ada peringatan, override ikut tercatat.
 */
function dataAuditJurnal(
  jurnal: Jurnal,
  baris: JurnalBarisInput[],
  peringatan: string[],
  opsi: OpsiPosting,
): Record<string, unknown> {
  if (peringatan.length === 0) return { jurnal, baris };
  return {
    jurnal,
    baris,
    peringatan: [...peringatan],
    konfirmasiPeringatan: true,
    alasanPeringatan: alasanPeringatanBersih(opsi),
  };
}

type BuatAuditJurnal = (jurnal: Jurnal, hasil: HasilValidasiJurnal) => AuditLog;

/**
 * Inti `postingJurnal`/`postingSaldoAwal`: validasi, guard konfirmasi, lalu
 * tulis jurnal + audit dalam satu transaksi. `buatAudit` hanya dipakai bila
 * pemanggil tidak mengirim `opsi.audit` sendiri (mis. reversal).
 */
function postingJurnalInti(
  db: Database.Database,
  input: JurnalInput | null | undefined,
  opsi: OpsiPosting,
  buatAudit: BuatAuditJurnal,
): HasilPosting {
  const hasil = validasiJurnalDb(db, input, {
    sekarang: opsi.sekarang,
    koreksiSaldoAwal: opsi.koreksiSaldoAwal === true,
    akunNonaktifDiizinkan: opsi.akunNonaktifDiizinkan,
  });
  if (hasil.errors.length > 0) return { ...hasil, tersimpan: false };
  if (!input || !input.header || !Array.isArray(input.baris)) {
    // Jaring pengaman AKT-29: validator sudah menolak bentuk ini; jangan pernah
    // lanjut ke insert dengan header/baris yang tidak lengkap.
    return {
      ...hasil,
      tersimpan: false,
      errors: [...hasil.errors, 'Data jurnal tidak lengkap.'],
    };
  }
  if (hasil.peringatan.length > 0 && !opsi.konfirmasiPeringatan)
    return { ...hasil, tersimpan: false };

  // AKT-06: peringatan yang dikonfirmasi lewat pintu input tertentu wajib
  // punya alasan. Ditolak sebelum transaksi sehingga jurnal & audit tidak
  // tertulis sama sekali.
  if (
    hasil.peringatan.length > 0 &&
    opsi.konfirmasiPeringatan === true &&
    opsi.wajibAlasanPeringatan === true &&
    alasanPeringatanBersih(opsi).length < 5
  ) {
    return {
      ...hasil,
      tersimpan: false,
      errors: [...hasil.errors, PESAN_WAJIB_ALASAN_PERINGATAN],
      perluKonfirmasi: true,
    };
  }

  try {
    const simpan = db.transaction(() => {
      // AKT-01/AKT-02: cek dan tulis berada di transaksi yang sama agar dua
      // posting pertama tidak bisa sama-sama lolos. Saldo awal dikecualikan.
      pastikanWajibSaldoAwal(db, opsi, input.header.jenis);
      const jurnal = insertJurnalTervalidasi(db, input.header, input.baris, {
        akunNonaktifDiizinkan: opsi.akunNonaktifDiizinkan,
      });
      // P0-9: setiap jurnal baru otomatis diaudit. Reversal/koreksi sudah
      // mengirim `opsi.audit` sendiri, jadi tidak boleh dobel.
      const audit = opsi.audit === undefined ? [buatAudit(jurnal, hasil)] : opsi.audit;
      for (const a of audit) insertAuditLog(db, a);
      return jurnal;
    });
    const jurnal = simpan();
    return { ...hasil, tersimpan: true, jurnal };
  } catch (e) {
    return {
      ...hasil,
      tersimpan: false,
      errors: [...hasil.errors, e instanceof Error ? e.message : String(e)],
    };
  }
}

/**
 * Validasi + simpan jurnal dalam satu pintu.
 * - Error -> `tersimpan: false`, tidak ada baris yang ditulis.
 * - Peringatan + belum dikonfirmasi -> `tersimpan: false`, `perluKonfirmasi: true`.
 * - Peringatan + `konfirmasiPeringatan` -> tetap disimpan; bila
 *   `wajibAlasanPeringatan` aktif, alasan ≥5 karakter wajib diisi (AKT-06).
 */
export function postingJurnal(
  db: Database.Database,
  input: JurnalInput,
  opsi: OpsiPosting = {},
): HasilPosting {
  return postingJurnalInti(db, input, opsi, (jurnal, hasil) =>
    buatAuditLog(
      `CREATE ${jurnal.id}`,
      String(input.alasan ?? '').trim(),
      undefined,
      dataAuditJurnal(jurnal, input.baris, hasil.peringatan, opsi),
      { ref_type: 'jurnal', ref_id: jurnal.id },
    ),
  );
}

/**
 * Helper pemakaian nanti untuk Saldo Awal (belum ada endpoint/UI di P0-9).
 * Sama seperti `postingJurnal`, tetapi memaksa jenis SALDO_AWAL dan memberi
 * aksi audit khusus `SALDO-AWAL` agar mudah dibedakan dari jurnal biasa.
 */
export function postingSaldoAwal(
  db: Database.Database,
  input: JurnalInput,
  opsi: OpsiPosting = {},
): HasilPosting {
  // AKT-29: input/header null tidak boleh melempar sebelum validator sempat
  // mengembalikan daftar error.
  const dasar = input && typeof input === 'object' ? input : ({} as JurnalInput);
  const headerMentah = dasar.header;
  const header =
    headerMentah && typeof headerMentah === 'object'
      ? { ...headerMentah, jenis: 'SALDO_AWAL' as const }
      : headerMentah;
  return postingJurnalInti(db, { ...dasar, header } as JurnalInput, opsi, (jurnal, hasil) =>
    buatAuditLog(
      `SALDO-AWAL ${header.id}`,
      String(input?.alasan ?? 'Saldo awal').trim() || 'Saldo awal',
      undefined,
      dataAuditJurnal(jurnal, input?.baris ?? [], hasil.peringatan, opsi),
      { ref_type: 'jurnal', ref_id: jurnal.id },
    ),
  );
}
