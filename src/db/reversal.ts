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
import { PESAN_REVERSAL, rencanaReversal } from '../core/reversal.js';
import type { Jurnal, JurnalHeaderInput } from '../core/types.js';
import type { HasilValidasiJurnal, JurnalInput } from '../core/posting.js';
import { validasiJurnal } from '../core/posting.js';
import { tanggalLokal } from '../utils/tanggal.js';
import {
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

const idBaru = (prefix: string): string => `${prefix}-${randomUUID()}`;

const hariIni = (): string => tanggalLokal();

/** Pesan saat jurnal merupakan bagian dari dokumen panjar (AUD-07). */
export const PESAN_REVERSAL_PANJAR =
  'Jurnal ini terhubung ke dokumen panjar. Reversal dari Jurnal Umum diblokir ' +
  'agar status panjar tidak basi. Gunakan modul Panjar.';

function hasilGagal(errors: string[]): HasilValidasiJurnal & { tersimpan: false } {
  return { boleh: false, errors, peringatan: [], perluKonfirmasi: false, tersimpan: false };
}

/** Jurnal balik yang sudah ada untuk `id` (dipakai menolak reversal ganda). */
function cariReversal(db: Database.Database, id: string): Pick<Jurnal, 'id'>[] {
  return listJurnal(db, { reversal_of: id });
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
  if (terhubungPanjar(db, idAsli))
    return { boleh: false, errors: [PESAN_REVERSAL_PANJAR] };

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
  );

  const simpan = db.transaction(() => {
    // Metadata subledger pihak sudah tidak ada sejak skema v12 (DB-23b/DB-33).
    // Reversal hanya membuat jurnal balik seperti biasa.
    return postingJurnal(db, rencana.input!, {
      konfirmasiPeringatan: opsi.konfirmasiPeringatan,
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
  );
  const auditBaru = buatAuditLog(
    `KOREKSI-ISI-ULANG ${id}`,
    alasan.trim(),
    { jurnal: detail.jurnal, baris: detail.baris },
    { jurnal: headerBaru, baris: baru.baris },
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

