// Adapter DB Wizard Saldo Awal (P1-6).
//
// Prinsip:
// - Saldo awal hanya boleh dibuat SEKALI. Jurnal harian yang sudah ada tidak
//   menutup wizard, tetapi tanggal saldo awal tidak boleh setelah jurnal
//   paling awal agar tidak ada transaksi yang mendahului saldo awal.
// - Pemeriksaan eksistensi SALDO_AWAL, batas tanggal, dan penulisan jurnal
//   dilakukan DI DALAM transaksi DB yang sama (race-safe), bukan hanya di UI.
//   DB-04 menambahkan unique index sebagai penjaga terakhir.
// - Hasilnya tetap satu jurnal double-entry seimbang (jenis SALDO_AWAL); tidak
//   ada tabel saldo/angka turunan. Laporan selalu dihitung dari jurnal.
// - Audit `SALDO-AWAL` ditulis atomik bersama jurnal lewat `postingSaldoAwal`.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import {
  tanggalKalenderValid,
  validasiJurnal,
  type HasilValidasiJurnal,
  type JurnalInput,
} from '../core/posting.js';
import { buatAuditLog } from '../core/audit.js';
import { rencanaReversal } from '../core/reversal.js';
import type { Jurnal, JurnalHeaderInput } from '../core/types.js';
import { AKUN_MODAL, kodeKasDariDaftarAkun } from './coa.js';
import { listBarisJurnal } from './laporan.js';
import {
  KUNCI_AKUNTANSI_TANGGAL_MULAI,
  KUNCI_CUTOVER_TANGGAL,
  KUNCI_SALDO_AWAL_AKTIF_ID,
  getJurnalDetail,
  insertAuditLog,
  insertJurnalTervalidasi,
  listAkun,
  listJurnal,
  setPengaturan,
} from './repository.js';
import {
  PESAN_WAJIB_ALASAN_PERINGATAN,
  buatKonteksPosting,
  postingSaldoAwal,
  type HasilPosting,
} from './posting.js';

export const PESAN_SALDO_AWAL_SUDAH_ADA =
  'Saldo awal sudah pernah dibuat. Perbaikan saldo awal hanya bisa lewat alur koreksi saldo awal; jurnal biasa tidak menggantikannya.';

export const PESAN_KOREKSI_TANPA_SALDO_AWAL =
  'Belum ada saldo awal yang bisa dikoreksi. Isi Wizard Saldo Awal terlebih dahulu.';

export const PESAN_ALASAN_KOREKSI_MIN =
  'Alasan koreksi saldo awal wajib diisi minimal 5 karakter.';

export type StatusSaldoAwal = {
  boleh: boolean;
  jumlahJurnal: number;
  /**
   * AUD2-02: tanggal jurnal paling awal bila sudah ada jurnal. Wizard memakai
   * nilai ini sebagai batas atas tanggal saldo awal yang masih bisa disusulkan.
   */
  tanggalMaksimal?: string;
  /** Diisi bila tidak boleh; siap ditampilkan di UI. */
  alasan?: string;
};

export type OpsiSimpanSaldoAwal = {
  /** Operator sudah melihat peringatan (mis. kas minus) dan memilih lanjut. */
  konfirmasiPeringatan?: boolean;
  /** AKT-06: alasan operator melanjutkan meski ada peringatan. */
  alasanPeringatan?: string;
  /** AKT-06: diteruskan ke posting layer; wajib alasan ≥5 karakter. */
  wajibAlasanPeringatan?: boolean;
  /** AKT-02: diteruskan ke posting layer; jenis SALDO_AWAL selalu dikecualikan. */
  wajibSaldoAwal?: boolean;
  konfirmasiTanpaSaldoAwal?: boolean;
};

function hitungJurnal(db: Database.Database): number {
  const row = db.prepare('SELECT COUNT(*) AS total FROM jurnal').get() as { total: number };
  return Number(row.total);
}

/** Tanggal jurnal paling awal; `undefined` bila tabel jurnal masih kosong. */
function tanggalJurnalPertama(db: Database.Database): string | undefined {
  const row = db.prepare('SELECT MIN(tanggal) AS awal FROM jurnal').get() as {
    awal: string | null;
  };
  const awal = row.awal == null ? '' : String(row.awal).trim();
  return awal || undefined;
}

/**
 * DB-04: apakah jurnal SALDO_AWAL sudah pernah dibuat. Deteksi memakai
 * eksistensi baris (didukung `ux_jurnal_saldo_awal`), bukan jumlah seluruh
 * jurnal. Dengan demikian jurnal harian biasa tidak dianggap saldo awal.
 */
export function sudahAdaSaldoAwal(db: Database.Database): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM jurnal WHERE jenis = 'SALDO_AWAL' LIMIT 1").get(),
  );
}

/**
 * Status wizard untuk UI: terkunci hanya bila SALDO_AWAL sudah ada.
 * `jumlahJurnal` tetap jumlah seluruh jurnal agar informasi status transparan.
 * Bila sudah ada jurnal, `tanggalMaksimal` memberi batas atas tanggal saldo
 * awal yang masih boleh disusulkan (AUD2-02).
 */
export function statusSaldoAwal(db: Database.Database): StatusSaldoAwal {
  const jumlahJurnal = hitungJurnal(db);
  const tanggalMaksimal = tanggalJurnalPertama(db);
  const dasar = tanggalMaksimal
    ? { jumlahJurnal, tanggalMaksimal }
    : { jumlahJurnal };
  return sudahAdaSaldoAwal(db)
    ? {
        boleh: false,
        ...dasar,
        alasan: PESAN_SALDO_AWAL_SUDAH_ADA,
      }
    : { boleh: true, ...dasar };
}

export type SaldoAwalSaatIni = {
  /** Tanggal jurnal pembukaan yang sedang aktif (SALDO_AWAL asli atau UMUM pengganti). */
  tanggal: string;
  /**
   * Saldo per akun AKTIVA/KEWAJIBAN dalam sisi normal positif (AKTIVA = debit,
   * KEWAJIBAN = kredit). Akun 3000 MODAL tidak dikembalikan karena selalu
   * dihitung ulang oleh builder sebagai penyeimbang.
   */
  saldo: { akun_kode: string; nominal: number }[];
  keterangan?: string;
  /**
   * Batas atas tanggal koreksi: jurnal NON-pembukaan paling awal. Berbeda dari
   * `statusSaldoAwal.tanggalMaksimal` yang bisa tertahan di tanggal
   * `SALDO_AWAL` lama setelah koreksi memindahkan tanggal mulai ke lebih akhir.
   */
  tanggalMaksimal?: string;
};

/**
 * T1.8: data prefill Wizard mode koreksi.
 *
 * Sumbernya jurnal grup pembukaan yang sama (SALDO_AWAL asli + REVERSAL +
 * UMUM pengganti). Dengan menjumlahkan SELURUH baris grup, hasilnya tetap
 * benar setelah koreksi berulang: jurnal asli + balik saling meniadakan dan
 * hanya penyesuaian aktif yang tersisa.
 *
 * Mengembalikan `null` bila belum ada `SALDO_AWAL` (tidak ada yang bisa
 * dikoreksi); IPC mengubahnya menjadi pesan Indonesia yang jelas.
 */
export function saldoAwalSaatIni(
  db: Database.Database,
): SaldoAwalSaatIni | null {
  const awal = db
    .prepare(
      "SELECT id, grup_id FROM jurnal WHERE jenis = 'SALDO_AWAL' ORDER BY rowid LIMIT 1",
    )
    .get() as { id: string; grup_id: string } | undefined;
  if (!awal) return null;

  const grup = String(awal.grup_id || awal.id).trim();
  const dalamGrup = listJurnal(db, { grup_id: grup });
  const sudahDibalik = new Set(
    dalamGrup
      .map((j) => j.reversal_of)
      .filter((id): id is string => Boolean(id)),
  );
  const aktif = [...dalamGrup]
    .reverse()
    .find(
      (j) =>
        j.reversal_of == null &&
        (j.jenis === 'SALDO_AWAL' || j.jenis === 'UMUM') &&
        !sudahDibalik.has(j.id),
    );
  if (!aktif) return null;

  const tipeAkun = new Map(listAkun(db).map((a) => [a.kode, a.tipe]));
  const total = new Map<string, number>();
  for (const b of listBarisJurnal(db, { grup_id: grup })) {
    const tipe = tipeAkun.get(b.akun_kode);
    if (tipe !== 'AKTIVA' && tipe !== 'KEWAJIBAN') continue;
    if (b.akun_kode === AKUN_MODAL) continue;
    const delta = tipe === 'AKTIVA' ? b.debit - b.kredit : b.kredit - b.debit;
    total.set(b.akun_kode, (total.get(b.akun_kode) ?? 0) + delta);
  }

  const saldo = [...total]
    .filter(([, nominal]) => nominal > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([akun_kode, nominal]) => ({ akun_kode, nominal }));

  // Batas atas koreksi dihitung dari jurnal di luar grup pembukaan. Jangan
  // memakai MIN seluruh jurnal: jurnal SALDO_AWAL lama tetap bertanggal awal
  // walau koreksi sudah memindahkan tanggal mulai, sehingga prefill bisa
  // terjepit kembali ke tanggal lama.
  const rowBatas = db
    .prepare('SELECT MIN(tanggal) AS awal FROM jurnal WHERE grup_id <> ?')
    .get(grup) as { awal: string | null };
  const tanggalMaksimal =
    rowBatas.awal == null ? '' : String(rowBatas.awal).trim();

  return {
    tanggal: aktif.tanggal,
    saldo,
    ...(aktif.keterangan ? { keterangan: aktif.keterangan } : {}),
    ...(tanggalMaksimal ? { tanggalMaksimal } : {}),
  };
}

function hasilGagal(pesan: string): HasilPosting {
  const hasil: HasilValidasiJurnal = {
    boleh: false,
    errors: [pesan],
    peringatan: [],
    perluKonfirmasi: false,
  };
  return { ...hasil, tersimpan: false };
}

/**
 * Simpan saldo awal sebagai satu jurnal seimbang + audit SALDO-AWAL.
 *
 * AUD2-02: saldo awal tetap hanya sekali, tetapi boleh disusulkan setelah ada
 * jurnal harian selama tanggalnya tidak setelah jurnal paling awal. Semua
 * pemeriksaan (SALDO_AWAL sudah ada, batas tanggal) dan penulisan jurnal berada
 * dalam satu transaksi, sehingga dua penyimpanan bersamaan tidak bisa sama-sama
 * lolos; unique index `ux_jurnal_saldo_awal` menjadi penjaga terakhir.
 */
export function simpanSaldoAwal(
  db: Database.Database,
  input: JurnalInput,
  opsi: OpsiSimpanSaldoAwal = {},
): HasilPosting {
  if (!input || !input.header || !Array.isArray(input.baris))
    return hasilGagal('Data saldo awal tidak lengkap.');

  try {
    const simpan = db.transaction((): HasilPosting => {
      if (sudahAdaSaldoAwal(db)) return hasilGagal(PESAN_SALDO_AWAL_SUDAH_ADA);

      const tanggalSaldoAwal = String(input.header.tanggal ?? '').trim();
      const jurnalPertama = tanggalJurnalPertama(db);
      if (
        jurnalPertama &&
        tanggalKalenderValid(tanggalSaldoAwal) &&
        tanggalSaldoAwal > jurnalPertama
      ) {
        return hasilGagal(
          `Tanggal saldo awal (${tanggalSaldoAwal}) tidak boleh setelah transaksi paling awal (${jurnalPertama}).`,
        );
      }

      // T-A00: saldo awal resmi selalu berperan OPENING. `postingSaldoAwal`
      // memaksa jenis SALDO_AWAL; peran diteruskan ke insert jurnal.
      const inputPosting: JurnalInput = {
        ...input,
        header: {
          ...input.header,
          peran: 'OPENING',
          replaces_id: null,
        },
      };
      const hasil = postingSaldoAwal(db, inputPosting, {
        konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        alasanPeringatan: opsi.alasanPeringatan,
        wajibAlasanPeringatan: opsi.wajibAlasanPeringatan === true,
        wajibSaldoAwal: opsi.wajibSaldoAwal === true,
        konfirmasiTanpaSaldoAwal: opsi.konfirmasiTanpaSaldoAwal === true,
      });
      // T-A00/AKT-03: penunjuk pembukaan aktif, cut-over resmi, dan kunci
      // tanggal mulai lama ditulis ATOMIK bersama jurnal + audit. Bila salah
      // satu penulisan gagal, seluruh saldo awal dibatalkan.
      if (hasil.tersimpan && hasil.jurnal) {
        const tanggalMulai = String(
          hasil.jurnal.tanggal ?? input.header.tanggal ?? '',
        ).trim();
        setPengaturan(db, KUNCI_SALDO_AWAL_AKTIF_ID, hasil.jurnal.id);
        if (tanggalMulai) {
          setPengaturan(db, KUNCI_CUTOVER_TANGGAL, tanggalMulai);
          setPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI, tanggalMulai);
        }
      }
      return hasil;
    });
    return simpan();
  } catch (e) {
    return hasilGagal(
      `Saldo awal gagal disimpan: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export type OpsiKoreksiSaldoAwal = {
  /** Alasan operator; wajib >=5 karakter dan dipakai juga untuk kunci periode. */
  alasan: string;
  /** ID internal untuk test/determinisme; default dibuat otomatis. */
  idReversal?: string;
  idPengganti?: string;
  /** Operator sudah melihat peringatan (mis. kas minus) dan memilih lanjut. */
  konfirmasiPeringatan?: boolean;
  /** AKT-06: alasan konfirmasi peringatan. */
  alasanPeringatan?: string;
  /** AKT-06: wajibkan alasan >=5 karakter saat mengonfirmasi peringatan. */
  wajibAlasanPeringatan?: boolean;
  /** AKT-14: tanggal acuan untuk test; default tanggal lokal WITA. */
  sekarang?: string;
};

export type HasilKoreksiSaldoAwal = HasilPosting & {
  reversal?: Jurnal;
  /** Jurnal pembukaan yang dibalik (SALDO_AWAL pertama atau UMUM pengganti). */
  jurnalLama?: Jurnal;
};

function hasilGagalKoreksi(errors: string | string[]): HasilKoreksiSaldoAwal {
  return {
    boleh: false,
    errors: Array.isArray(errors) ? errors : [errors],
    peringatan: [],
    perluKonfirmasi: false,
    tersimpan: false,
  };
}

/**
 * T1.7 (Opsi A): koreksi saldo awal = reverse and re-post dalam SATU transaksi.
 *
 * Jurnal pembukaan aktif adalah jurnal `SALDO_AWAL`/`UMUM` di grup saldo awal
 * yang belum punya reversal. Koreksi pertama membalik `SALDO_AWAL`; koreksi
 * berikutnya membalik jurnal `UMUM` pengganti terakhir, sehingga
 * `ux_jurnal_reversal` tidak dilanggar dan jurnal lama tetap utuh.
 *
 * Jurnal pengganti selalu berjenis `UMUM` dengan `grup_id` yang sama dan
 * baris saldo koreksi PENUH (bukan delta). Unique index `ux_jurnal_saldo_awal`
 * tidak disentuh karena tidak pernah ada `SALDO_AWAL` kedua.
 *
 * Atomik: reversal + pengganti + audit + setting tanggal mulai berada dalam
 * satu transaksi. Bila salah satu langkah gagal, semuanya dibatalkan.
 */
export function koreksiSaldoAwal(
  db: Database.Database,
  input: JurnalInput,
  opsi: OpsiKoreksiSaldoAwal,
): HasilKoreksiSaldoAwal {
  const alasan = String(opsi?.alasan ?? '').trim();
  if (!input || !input.header || !Array.isArray(input.baris))
    return hasilGagalKoreksi('Data saldo awal tidak lengkap.');
  if (alasan.length < 5) return hasilGagalKoreksi(PESAN_ALASAN_KOREKSI_MIN);

  try {
    const koreksi = db.transaction((): HasilKoreksiSaldoAwal => {
      const saldoAwal = db
        .prepare(
          "SELECT id, grup_id FROM jurnal WHERE jenis = 'SALDO_AWAL' ORDER BY rowid LIMIT 1",
        )
        .get() as { id: string; grup_id: string } | undefined;
      if (!saldoAwal) return hasilGagalKoreksi(PESAN_KOREKSI_TANPA_SALDO_AWAL);

      const grup = String(saldoAwal.grup_id || saldoAwal.id).trim();
      const dalamGrup = listJurnal(db, { grup_id: grup });
      const sudahDibalik = new Set(
        dalamGrup
          .map((j) => j.reversal_of)
          .filter((id): id is string => Boolean(id)),
      );
      // Cari dari belakang: setelah koreksi, jurnal UMUM pengganti terakhir
      // adalah pembukaan aktif. Jurnal REVERSAL tidak pernah menjadi kandidat.
      const aktif = [...dalamGrup]
        .reverse()
        .find(
          (j) =>
            j.reversal_of == null &&
            (j.jenis === 'SALDO_AWAL' || j.jenis === 'UMUM') &&
            !sudahDibalik.has(j.id),
        );
      if (!aktif)
        return hasilGagalKoreksi('Jurnal pembukaan aktif tidak ditemukan.');

      const detail = getJurnalDetail(db, aktif.id);
      if (!detail)
        return hasilGagalKoreksi('Detail jurnal pembukaan aktif tidak ditemukan.');

      const idReversal =
        String(opsi.idReversal ?? '').trim() || `rev-${randomUUID()}`;
      const idPengganti =
        String(opsi.idPengganti ?? '').trim() || `j-${randomUUID()}`;

      const headerPengganti: JurnalHeaderInput = {
        ...input.header,
        id: idPengganti,
        tanggal: String(input.header.tanggal ?? '').trim(),
        keterangan:
          String(input.header.keterangan ?? '').trim() || 'Koreksi saldo awal',
        jenis: 'UMUM',
        // T-A00: relasi pengganti eksplisit, bukan ditebak dari grup/jenis.
        peran: 'OPENING_REPLACEMENT',
        grup_id: grup,
        reversal_of: null,
        replaces_id: aktif.id,
      };
      const pengganti: JurnalInput = {
        ...input,
        header: headerPengganti,
        baris: input.baris.map((b) => ({ ...b })),
        alasan,
      };

      const rencana = rencanaReversal({
        jurnal: aktif,
        baris: detail.baris,
        reversalAda: [],
        id: idReversal,
        tanggal: aktif.tanggal,
        alasan,
      });
      if (!rencana.boleh || !rencana.input)
        return hasilGagalKoreksi(rencana.errors);
      const balik = rencana.input;

      const tanggalBaru = String(headerPengganti.tanggal ?? '').trim();
      const tanggalBalik = String(balik.header.tanggal ?? '').trim();

      // Tanggal baru tidak boleh melewati transaksi non-pembukaan paling awal,
      // karena saldo awal adalah jangkar pembukuan. Tanggal masa depan tetap
      // ditolak validator melalui `sekarang`.
      if (tanggalKalenderValid(tanggalBaru)) {
        const row = db
          .prepare(
            'SELECT MIN(tanggal) AS awal FROM jurnal WHERE grup_id <> ?',
          )
          .get(grup) as { awal: string | null };
        const awalLuar = row.awal == null ? '' : String(row.awal).trim();
        if (awalLuar && tanggalBaru > awalLuar)
          return hasilGagalKoreksi(
            `Tanggal koreksi saldo awal (${tanggalBaru}) tidak boleh setelah transaksi paling awal (${awalLuar}).`,
          );
      }

      // KUNCI lama tidak dipakai sebagai batas bawah saat memvalidasi koreksi:
      // koreksi yang sah boleh memindahkan tanggal mulai ke lebih awal. Nilai
      // baru ditulis atomik setelah semua validasi lolos. Batas atas transaksi
      // dan tanggal masa depan tetap diperiksa.
      const konteks = (header: JurnalHeaderInput) => {
        const ctx = buatKonteksPosting(db, header, opsi.sekarang);
        ctx.koreksiSaldoAwal = true;
        ctx.tanggalMulaiPembukuan = '';
        return ctx;
      };
      const ctxBalik = konteks(balik.header);
      const ctxBaru = konteks(headerPengganti);

      const tambahDeltaKas = (
        saldo: Record<string, number>,
        baris: JurnalInput['baris'],
        kasKodes: ReadonlySet<string>,
      ): void => {
        for (const b of baris) {
          if (kasKodes.has(b.akun_kode))
            saldo[b.akun_kode] =
              (saldo[b.akun_kode] ?? 0) + b.debit - b.kredit;
        }
      };
      const kasBalik = new Set(kodeKasDariDaftarAkun(ctxBalik.akun ?? []));
      const kasBaru = new Set(kodeKasDariDaftarAkun(ctxBaru.akun ?? []));

      const saldoBalik: Record<string, number> = { ...(ctxBalik.saldoKas ?? {}) };
      if (tanggalBaru <= tanggalBalik)
        tambahDeltaKas(saldoBalik, pengganti.baris, kasBaru);
      const validasiBalik = validasiJurnal(balik, {
        ...ctxBalik,
        saldoKas: saldoBalik,
      });

      const saldoBaru: Record<string, number> = { ...(ctxBaru.saldoKas ?? {}) };
      if (tanggalBalik <= tanggalBaru)
        tambahDeltaKas(saldoBaru, balik.baris, kasBalik);
      const validasiBaru = validasiJurnal(pengganti, {
        ...ctxBaru,
        saldoKas: saldoBaru,
      });

      const errors = [
        ...validasiBalik.errors.map((e) => `Jurnal balik: ${e}`),
        ...validasiBaru.errors.map((e) => `Jurnal pengganti: ${e}`),
      ];
      const peringatan = [
        ...new Set([...validasiBalik.peringatan, ...validasiBaru.peringatan]),
      ];
      if (errors.length > 0)
        return {
          boleh: false,
          errors,
          peringatan,
          perluKonfirmasi: false,
          tersimpan: false,
        };
      if (peringatan.length > 0 && !opsi.konfirmasiPeringatan)
        return {
          boleh: true,
          errors: [],
          peringatan,
          perluKonfirmasi: true,
          tersimpan: false,
        };
      if (
        peringatan.length > 0 &&
        opsi.konfirmasiPeringatan === true &&
        opsi.wajibAlasanPeringatan === true &&
        String(opsi.alasanPeringatan ?? '').trim().length < 5
      )
        return {
          boleh: false,
          errors: [PESAN_WAJIB_ALASAN_PERINGATAN],
          peringatan,
          perluKonfirmasi: true,
          tersimpan: false,
        };

      const audit = buatAuditLog(
        'KOREKSI-SALDO-AWAL',
        alasan,
        { jurnal: aktif, baris: detail.baris },
        {
          jurnal: headerPengganti,
          baris: pengganti.baris,
          reversal: balik.header,
          reversal_baris: balik.baris,
        },
        { ref_type: 'jurnal', ref_id: aktif.id },
      );

      // Bila pengganti memakai nomor bukti eksplisit sedangkan reversal
      // otomatis, simpan pengganti dulu agar nomor otomatis memakai max+1.
      const penggantiDulu =
        !String(balik.header.no_bukti ?? '').trim() &&
        Boolean(String(headerPengganti.no_bukti ?? '').trim());

      let reversal: Jurnal;
      let jurnalBaru: Jurnal;
      if (penggantiDulu) {
        jurnalBaru = insertJurnalTervalidasi(db, headerPengganti, pengganti.baris);
        reversal = insertJurnalTervalidasi(db, balik.header, balik.baris);
      } else {
        reversal = insertJurnalTervalidasi(db, balik.header, balik.baris);
        jurnalBaru = insertJurnalTervalidasi(db, headerPengganti, pengganti.baris);
      }
      insertAuditLog(db, audit);
      // T-A00: penunjuk pembukaan aktif pindah ke jurnal pengganti dan
      // cut-over resmi mengikuti tanggal baru, atomik dengan jurnal/audit.
      setPengaturan(db, KUNCI_SALDO_AWAL_AKTIF_ID, jurnalBaru.id);
      if (tanggalBaru) {
        setPengaturan(db, KUNCI_CUTOVER_TANGGAL, tanggalBaru);
        setPengaturan(db, KUNCI_AKUNTANSI_TANGGAL_MULAI, tanggalBaru);
      }

      return {
        boleh: true,
        errors: [],
        peringatan,
        perluKonfirmasi: false,
        tersimpan: true,
        jurnal: jurnalBaru,
        reversal,
        jurnalLama: aktif,
      };
    });
    return koreksi();
  } catch (e) {
    return hasilGagalKoreksi(
      `Koreksi saldo awal gagal disimpan: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
