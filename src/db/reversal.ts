// Koreksi jurnal lewat jalur DB (P0-6).
//
// - `reverseJurnal`         : buat satu jurnal balik + audit, atomik.
// - `koreksiDanIsiUlang`    : jurnal balik + jurnal pengganti + audit, atomik.
//
// Jurnal asli tidak pernah diubah/dihapus. Semua aturan validasi tetap lewat
// posting layer (P0-4), sehingga kunci periode, nomor bukti unik, dan peringatan
// kas minus berlaku sama seperti jurnal biasa.

import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { kodeKasDariDaftarAkun } from './coa.js';
import { buatAuditLog } from '../core/audit.js';
import {
  PESAN_REVERSAL,
  PESAN_REVERSAL_SALDO_AWAL,
  rencanaReversal,
} from '../core/reversal.js';
import type { Jurnal, JurnalHeaderInput } from '../core/types.js';
import type { HasilValidasiJurnal, JurnalInput } from '../core/posting.js';
import { validasiJurnal } from '../core/posting.js';
import { tanggalLokal } from '../utils/tanggal.js';
import {
  getJurnal,
  getJurnalDetail,
  insertAuditLog,
  insertJurnalTervalidasi,
  listJurnal,
} from './repository.js';
import {
  buatKonteksPosting,
  postingJurnal,
  type HasilPosting,
} from './posting.js';

export type OpsiReversal = {
  /** ID jurnal balik; default dibuat otomatis. */
  id?: string;
  /** Tanggal jurnal balik; default tanggal jurnal asli agar periode tidak bergeser. */
  tanggal?: string;
  /** Nomor bukti jurnal balik; opsional dan wajib unik bila diisi. */
  no_bukti?: string;
  /** Operator sudah melihat peringatan (mis. kas minus) dan memilih lanjut. */
  konfirmasiPeringatan?: boolean;
};

export type HasilReversal = HasilPosting & {
  reversal?: Jurnal;
};

export type HasilKoreksi = HasilPosting & {
  reversal?: Jurnal;
  jurnalBaru?: Jurnal;
};

/** Cukup `{ id }`; `jenis` boleh ikut tetapi selalu diabaikan (dibaca ulang dari DB). */
export type JurnalUntukKoreksi = Pick<Jurnal, 'id'> &
  Partial<Pick<Jurnal, 'jenis'>>;

/**
 * T2.1: hasil capability untuk UI. `alasan` null berarti kedua aksi boleh;
 * selain itu berisi pesan Indonesia yang siap ditampilkan sebagai tooltip.
 */
export type KemampuanKoreksiJurnal = {
  bisaDibalik: boolean;
  bisaDikoreksi: boolean;
  alasan: string | null;
};

export { PESAN_REVERSAL_SALDO_AWAL };

const idBaru = (prefix: string): string => `${prefix}-${randomUUID()}`;

const hariIni = (): string => tanggalLokal();

/** Pesan saat jurnal merupakan bagian dari dokumen panjar (AUD-07). */
export const PESAN_REVERSAL_PANJAR =
  'Jurnal ini terhubung ke dokumen panjar. Reversal dari Jurnal Umum diblokir ' +
  'agar status panjar tidak basi. Gunakan modul Panjar.';

export const PESAN_REVERSAL_PINJAMAN =
  'Jurnal ini terhubung ke pinjaman. Gunakan Batalkan catatan pembayaran ' +
  'atau Batalkan catatan pencairan di menu Pinjaman LPD, lalu input ulang.';

/**
 * Pesan capability (T2.1). Isinya sengaja memakai pesan jalur reversal yang
 * sudah ada agar UI dan backend tidak memberi alasan yang berbeda.
 */
export const PESAN_KOREKSI_JURNAL = {
  tidakDitemukan: PESAN_REVERSAL.tidakDitemukan,
  jurnalBalik: PESAN_REVERSAL.asliBalik,
  sudahDikoreksi: PESAN_REVERSAL.sudahDibalik,
  saldoAwal: PESAN_REVERSAL_SALDO_AWAL,
  panjar: PESAN_REVERSAL_PANJAR,
  pinjaman: PESAN_REVERSAL_PINJAMAN,
} as const;

function hasilGagal(errors: string[]): HasilValidasiJurnal & { tersimpan: false } {
  return { boleh: false, errors, peringatan: [], perluKonfirmasi: false, tersimpan: false };
}

/** Jurnal balik yang sudah ada untuk `id` (dipakai menolak reversal ganda). */
function cariReversal(db: Database.Database, id: string): Pick<Jurnal, 'id'>[] {
  return listJurnal(db, { reversal_of: id });
}

/** Grup diperoleh dari jurnal asli di DB; bukan penanda dari renderer. */
function anggotaSaldoAwal(db: Database.Database, jurnal: Jurnal): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM jurnal WHERE jenis = 'SALDO_AWAL' AND grup_id = ? LIMIT 1",
  ).get(jurnal.grup_id));
}

/**
 * Jurnal serah/pertanggungjawaban panjar tidak boleh direversal dari Jurnal
 * Umum: status `panjar` akan basi (mis. tetap CLOSED padahal 1040 bersaldo).
 * Koreksi panjar harus lewat modul Panjar.
 */
function terhubungPanjar(db: Database.Database, idJurnal: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM panjar
         WHERE jurnal_open_id = ? OR jurnal_close_id = ?
         LIMIT 1`,
      )
      .get(idJurnal, idJurnal),
  );
}

/**
 * T2.1: versi pemeriksaan panjar untuk capability. `jurnal_batal_id` ikut
 * diperiksa agar jurnal pembatalan panjar tidak pernah ditawarkan sebagai
 * jurnal biasa. Fungsi terpisah dipakai supaya pesan `reverseJurnal` publik
 * untuk jurnal batal (yang memang REVERSAL) tidak berubah (DB-21).
 */
function terhubungPanjarTermasukBatal(
  db: Database.Database,
  idJurnal: string,
): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM panjar
         WHERE jurnal_open_id = ? OR jurnal_close_id = ? OR jurnal_batal_id = ?
         LIMIT 1`,
      )
      .get(idJurnal, idJurnal, idJurnal),
  );
}

/** Jurnal sudah punya balik? Dipakai capability dan koreksi isi ulang. */
function punyaReversal(db: Database.Database, idJurnal: string): boolean {
  return Boolean(
    db
      .prepare('SELECT 1 FROM jurnal WHERE reversal_of = ? LIMIT 1')
      .get(idJurnal),
  );
}

/**
 * Relasi tabel adalah satu-satunya sumber kebenaran pinjaman (T2.1/T2.3).
 * Jangan menebak dari `jenis === 'HUTANG'` atau akun 2050: pembayaran bunga
 * saja berjenis HUTANG tanpa baris 2050, tetapi tetap milik modul Pinjaman.
 */
function terhubungPinjaman(db: Database.Database, idJurnal: string): boolean {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM pinjaman WHERE jurnal_pencairan_id = ?
         UNION ALL SELECT 1 FROM pinjaman_bayar WHERE jurnal_id = ?
         LIMIT 1`,
      )
      .get(idJurnal, idJurnal),
  );
}

function rencanaUntuk(
  db: Database.Database,
  idAsli: string,
  alasan: string,
  opsi: OpsiReversal,
) {
  // Ambil detail lebih dulu: tanggal default reversal mengikuti tanggal jurnal
  // asli supaya koreksi tidak menggeser laba ke tahun berjalan.
  const detail = getJurnalDetail(db, idAsli);

  // Cek sebelum menyusun rencana agar kedua jalur (reversal & isi ulang)
  // berhenti tanpa menyentuh jurnal/audit.
  //
  // T1.5: hanya jurnal yang berjenis SALDO_AWAL yang ditolak. Jurnal UMUM
  // (mis. penyesuaian) dalam grup yang sama tetap boleh dikoreksi lewat jalur
  // biasa; pengecekan per-jurnal ini sengaja tidak memblokir seluruh grup.
  if (detail?.jurnal.jenis === 'SALDO_AWAL')
    return { boleh: false, errors: [PESAN_REVERSAL_SALDO_AWAL] };

  if (terhubungPanjar(db, idAsli))
    return { boleh: false, errors: [PESAN_REVERSAL_PANJAR] };

  if (terhubungPinjaman(db, idAsli))
    return { boleh: false, errors: [PESAN_REVERSAL_PINJAMAN] };

  return rencanaReversal({
    jurnal: detail?.jurnal ?? null,
    baris: detail?.baris ?? [],
    reversalAda: cariReversal(db, idAsli),
    id: String(opsi.id ?? '').trim() || idBaru('rev'),
    // Tanggal eksplisit tetap menang (termasuk lintas tahun); tanpa tanggal,
    // pakai tanggal jurnal asli. `hariIni()` hanya cadangan bila jurnal tidak
    // ditemukan — rencana akan tetap ditolak oleh validasi.
    tanggal: String(opsi.tanggal ?? '').trim() || detail?.jurnal.tanggal || hariIni(),
    alasan,
    no_bukti: opsi.no_bukti,
  });
}

/**
 * T2.1: satu sumber aturan untuk UI/IPC — jangan menebak dari `jenis` dan akun.
 *
 * Parameter boleh objek ringkas `{ id, jenis }` atau `Jurnal`. Nilai `jenis`
 * dari renderer selalu diabaikan: jurnal dibaca ulang dari DB agar data render
 * yang basi/dimanipulasi tidak membuka tombol yang pasti ditolak backend.
 *
 * `bisaDibalik` dan `bisaDikoreksi` memakai aturan yang sama untuk sekarang:
 * koreksi isi ulang juga menulis jurnal balik (`koreksiDanIsiUlang`), jadi
 * keduanya selalu ditolak/diizinkan bersama. Bila nanti ada jalur koreksi yang
 * tidak memerlukan reversal, pisahkan aturannya di sini — bukan di UI.
 */
export function kemampuanKoreksiJurnal(
  db: Database.Database,
  jurnal: JurnalUntukKoreksi | null | undefined,
): KemampuanKoreksiJurnal {
  const tolak = (alasan: string): KemampuanKoreksiJurnal => ({
    bisaDibalik: false,
    bisaDikoreksi: false,
    alasan,
  });

  const id = String(jurnal?.id ?? '').trim();
  const asli = id ? getJurnal(db, id) : null;
  if (!asli) return tolak(PESAN_KOREKSI_JURNAL.tidakDitemukan);

  // Reversal tidak boleh dibalik lagi, termasuk jurnal batal panjar/pinjaman.
  if (asli.jenis === 'REVERSAL' || asli.reversal_of)
    return tolak(PESAN_KOREKSI_JURNAL.jurnalBalik);
  if (punyaReversal(db, asli.id))
    return tolak(PESAN_KOREKSI_JURNAL.sudahDikoreksi);

  // Subledger: koreksi wajib lewat modul asalnya agar status dokumen tidak basi.
  if (terhubungPanjarTermasukBatal(db, asli.id))
    return tolak(PESAN_KOREKSI_JURNAL.panjar);
  if (terhubungPinjaman(db, asli.id))
    return tolak(PESAN_KOREKSI_JURNAL.pinjaman);

  // Saldo awal hanya boleh dikoreksi lewat wizard koreksi saldo awal (T1.8).
  if (asli.jenis === 'SALDO_AWAL')
    return tolak(PESAN_KOREKSI_JURNAL.saldoAwal);

  return { bisaDibalik: true, bisaDikoreksi: true, alasan: null };
}

/** Gabungkan dua daftar tanpa duplikat (menjaga pesan peringatan tetap ringkas). */
const gabungUnik = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];

/**
 * Buat jurnal balik untuk `idAsli`.
 *
 * Jurnal baru menukar debit/kredit, memakai `grup_id` yang sama,
 * `reversal_of = idAsli`, jenis `REVERSAL`, dan keterangan `KOREKSI: ...`.
 * Alasan wajib >= 5 karakter, juga dipakai untuk kunci periode.
 */
export function reverseJurnal(
  db: Database.Database,
  idAsli: string,
  alasan: string,
  opsi: OpsiReversal = {},
): HasilReversal {
  const id = String(idAsli ?? '').trim();
  const rencana = rencanaUntuk(db, id, alasan, opsi);
  if (!rencana.boleh || !rencana.input) return hasilGagal(rencana.errors);

  const detail = getJurnalDetail(db, id)!;
  const audit = buatAuditLog(
    `REVERSAL ${id}`,
    alasan.trim(),
    { jurnal: detail.jurnal, baris: detail.baris },
    {
      jurnal: rencana.input.header,
      baris: rencana.input.baris,
      reversal_id: rencana.input.header.id,
    },
    { ref_type: 'jurnal', ref_id: id },
  );

  const simpan = db.transaction(() => {
    // Metadata subledger pihak sudah tidak ada sejak skema v12 (DB-23b/DB-33).
    // Reversal hanya membuat jurnal balik seperti biasa.
    return postingJurnal(db, rencana.input!, {
      konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
      alasanPeringatan: alasan.trim(),
      wajibAlasanPeringatan: true,
      koreksiSaldoAwal: anggotaSaldoAwal(db, detail.jurnal),
      audit: [audit],
    });
  });
  const hasil = simpan();
  return { ...hasil, reversal: hasil.jurnal };
}

/**
 * Koreksi & isi ulang dalam SATU alur atomik:
 * jurnal balik + jurnal pengganti + audit. Bila jurnal pengganti gagal
 * divalidasi/disimpan, jurnal balik ikut batal (tidak ada koreksi setengah jadi).
 */
export function koreksiDanIsiUlang(
  db: Database.Database,
  idAsli: string,
  alasan: string,
  inputBaru: JurnalInput,
  opsi: OpsiReversal = {},
): HasilKoreksi {
  const id = String(idAsli ?? '').trim();
  const rencana = rencanaUntuk(db, id, alasan, opsi);
  if (!rencana.boleh || !rencana.input) return hasilGagal(rencana.errors);

  // Baca jurnal asli sekali: jenis & grup_id pengganti wajib mengikuti aslinya,
  // bukan input renderer (AKT-22). Reversal tidak boleh mengarah ke jenis
  // REVERSAL palsu, dan SALDO_AWAL hanya sah bila jurnal asli juga SALDO_AWAL.
  const detail = getJurnalDetail(db, id);
  if (!detail) return hasilGagal([PESAN_REVERSAL.tidakDitemukan]);

  const jenisPengganti = inputBaru?.header?.jenis;
  if (jenisPengganti === 'REVERSAL')
    return hasilGagal(['Jurnal pengganti tidak boleh berjenis REVERSAL.']);
  if (jenisPengganti === 'SALDO_AWAL' && detail.jurnal.jenis !== 'SALDO_AWAL')
    return hasilGagal([
      'Jurnal pengganti berjenis SALDO_AWAL hanya boleh bila jurnal asli juga SALDO_AWAL.',
    ]);

  const headerBaru: JurnalHeaderInput = {
    ...inputBaru.header,
    id: String(inputBaru.header?.id ?? '').trim() || idBaru('j'),
    // Pengganti tetap satu grup dengan jurnal asli + jurnal balik agar
    // penelusuran (drill-down) menunjukkan satu peristiwa koreksi utuh.
    // Nilai dari renderer selalu diabaikan: grup yang diubah dari luar akan
    // memutus rantai koreksi dan menyamarkan audit.
    grup_id: detail.jurnal.grup_id,
    reversal_of: null,
  };
  if (headerBaru.id === id)
    return hasilGagal(['ID jurnal pengganti harus berbeda dari jurnal asli.']);
  if (inputBaru.header?.reversal_of)
    return hasilGagal(['Jurnal pengganti tidak boleh mengacu ke jurnal lain.']);

  const baru: JurnalInput = {
    ...inputBaru,
    header: headerBaru,
    // Alasan koreksi yang sama juga memenuhi syarat kunci periode bila tanggal
    // jurnal pengganti berada di tahun yang sudah ditutup.
    alasan: String(inputBaru.alasan ?? '').trim() || alasan.trim(),
  };

  // AUD-10: jurnal balik dan pengganti bisa bertanggal berbeda. Masing-masing
  // harus dievaluasi dengan saldo kas pada tanggalnya sendiri — bukan satu ctx
  // untuk dua tanggal. Jurnal yang tanggalnya lebih dulu ikut diperhitungkan
  // bila jatuh pada/sebelum tanggal jurnal yang sedang divalidasi, karena
  // keduanya tersimpan atomik dalam transaksi yang sama.
  const ctxBalik = buatKonteksPosting(db, rencana.input.header);
  const ctxBaru = buatKonteksPosting(db, headerBaru);
  const koreksiSaldoAwal = anggotaSaldoAwal(db, detail.jurnal);
  ctxBalik.koreksiSaldoAwal = koreksiSaldoAwal;
  ctxBaru.koreksiSaldoAwal = koreksiSaldoAwal;
  const tanggalBalik = String(rencana.input.header.tanggal ?? '').trim();
  const tanggalBaru = String(headerBaru.tanggal ?? '').trim();

  const tambahDeltaKas = (
    saldo: Record<string, number>,
    baris: JurnalInput['baris'],
    kasKodes: ReadonlySet<string>,
  ): void => {
    for (const b of baris) {
      if (kasKodes.has(b.akun_kode))
        saldo[b.akun_kode] = (saldo[b.akun_kode] ?? 0) + b.debit - b.kredit;
    }
  };
  // DB-14: dompet mengikuti master akun pada konteks masing-masing tanggal.
  const kasBalik = new Set(kodeKasDariDaftarAkun(ctxBalik.akun ?? []));
  const kasBaru = new Set(kodeKasDariDaftarAkun(ctxBaru.akun ?? []));

  const saldoBalik: Record<string, number> = { ...(ctxBalik.saldoKas ?? {}) };
  if (tanggalBaru <= tanggalBalik) tambahDeltaKas(saldoBalik, baru.baris, kasBaru);
  const validasiBalik = validasiJurnal(rencana.input, { ...ctxBalik, saldoKas: saldoBalik });

  const saldoBaru: Record<string, number> = { ...(ctxBaru.saldoKas ?? {}) };
  if (tanggalBalik <= tanggalBaru) tambahDeltaKas(saldoBaru, rencana.input.baris, kasBalik);
  const validasiBaru = validasiJurnal(baru, { ...ctxBaru, saldoKas: saldoBaru });

  const errors = [
    ...validasiBalik.errors.map((e) => `Jurnal balik: ${e}`),
    ...validasiBaru.errors.map((e) => `Jurnal pengganti: ${e}`),
  ];
  const peringatan = gabungUnik(validasiBalik.peringatan, validasiBaru.peringatan);
  if (errors.length > 0)
    return { boleh: false, errors, peringatan, perluKonfirmasi: false, tersimpan: false };
  if (peringatan.length > 0 && !opsi.konfirmasiPeringatan)
    return { boleh: true, errors: [], peringatan, perluKonfirmasi: true, tersimpan: false };

  const auditBalik = buatAuditLog(
    `REVERSAL ${id}`,
    alasan.trim(),
    { jurnal: detail.jurnal, baris: detail.baris },
    {
      jurnal: rencana.input.header,
      baris: rencana.input.baris,
      reversal_id: rencana.input.header.id,
    },
    { ref_type: 'jurnal', ref_id: id },
  );
  const auditBaru = buatAuditLog(
    `KOREKSI-ISI-ULANG ${id}`,
    alasan.trim(),
    { jurnal: detail.jurnal, baris: detail.baris },
    { jurnal: headerBaru, baris: baru.baris },
    { ref_type: 'jurnal', ref_id: id },
  );

  // Bila operator mengisi nomor pengganti tetapi membiarkan nomor balik
  // otomatis, simpan pengganti lebih dulu. Nomor balik otomatis akan memakai
  // max+1 setelah nomor pilihan operator, bukan menabraknya (P1-11).
  const penggantiDulu =
    !String(rencana.input.header.no_bukti ?? '').trim() &&
    Boolean(String(headerBaru.no_bukti ?? '').trim());

  try {
    const simpan = db.transaction(() => {
      let reversal: Jurnal;
      let jurnalBaru: Jurnal;
      if (penggantiDulu) {
        jurnalBaru = insertJurnalTervalidasi(db, headerBaru, baru.baris);
        reversal = insertJurnalTervalidasi(db, rencana.input!.header, rencana.input!.baris);
      } else {
        reversal = insertJurnalTervalidasi(db, rencana.input!.header, rencana.input!.baris);
        jurnalBaru = insertJurnalTervalidasi(db, headerBaru, baru.baris);
      }
      insertAuditLog(db, auditBalik);
      insertAuditLog(db, auditBaru);
      return { reversal, jurnalBaru };
    });
    const { reversal, jurnalBaru } = simpan();
    return {
      boleh: true,
      errors: [],
      peringatan,
      perluKonfirmasi: false,
      tersimpan: true,
      reversal,
      jurnalBaru,
      jurnal: jurnalBaru,
    };
  } catch (e) {
    return {
      boleh: false,
      errors: [e instanceof Error ? e.message : String(e)],
      peringatan,
      perluKonfirmasi: false,
      tersimpan: false,
    };
  }
}

