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
import { isAkunKas } from './coa.js';
import { buatAuditLog } from '../core/ledger.js';
import { rencanaReversal } from '../core/reversal.js';
import type { Jurnal, JurnalHeaderInput } from '../core/types.js';
import type { HasilValidasiJurnal, JurnalInput } from '../core/posting.js';
import { validasiJurnal } from '../core/posting.js';
import {
  getJurnalDetail,
  insertAuditLog,
  insertJurnal,
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
  /** Tanggal jurnal balik; default hari ini (koreksi tidak mengubah periode lama). */
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

const hariIni = (): string => new Date().toISOString().slice(0, 10);

function hasilGagal(errors: string[]): HasilValidasiJurnal & { tersimpan: false } {
  return { boleh: false, errors, peringatan: [], perluKonfirmasi: false, tersimpan: false };
}

/** Jurnal balik yang sudah ada untuk `id` (dipakai menolak reversal ganda). */
function cariReversal(db: Database.Database, id: string): Pick<Jurnal, 'id'>[] {
  return listJurnal(db, { reversal_of: id });
}

/**
 * Salin metadata pihak dari jurnal asli ke jurnal baru (balik/pengganti).
 * Hanya akun yang benar-benar ada di jurnal tujuan yang disalin, sehingga
 * koreksi yang mengganti 1050 menjadi akun beban tidak meninggalkan pemetaan
 * yatim. Jurnal tersimpan sendiri tidak pernah diubah.
 */
function salinMappingPihak(
  db: Database.Database,
  dariJurnalId: string,
  keJurnalId: string,
): void {
  const rows = db
    .prepare(
      `SELECT jp.pihak_id, jp.akun_kode
       FROM jurnal_pihak jp
       WHERE jp.jurnal_id = ?
         AND EXISTS (
           SELECT 1 FROM jurnal_baris b
           WHERE b.jurnal_id = ? AND b.akun_kode = jp.akun_kode
         )`,
    )
    .all(dariJurnalId, keJurnalId) as { pihak_id: string; akun_kode: string }[];
  if (rows.length === 0) return;
  const ins = db.prepare(
    `INSERT OR IGNORE INTO jurnal_pihak (jurnal_id, pihak_id, akun_kode)
     VALUES (?, ?, ?)`,
  );
  for (const r of rows) ins.run(keJurnalId, String(r.pihak_id), String(r.akun_kode));
}

function rencanaUntuk(
  db: Database.Database,
  idAsli: string,
  alasan: string,
  opsi: OpsiReversal,
) {
  const detail = getJurnalDetail(db, idAsli);
  return rencanaReversal({
    jurnal: detail?.jurnal ?? null,
    baris: detail?.baris ?? [],
    reversalAda: cariReversal(db, idAsli),
    id: String(opsi.id ?? '').trim() || idBaru('rev'),
    tanggal: String(opsi.tanggal ?? '').trim() || hariIni(),
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
    const hasil = postingJurnal(db, rencana.input!, {
      konfirmasiPeringatan: opsi.konfirmasiPeringatan,
      audit: [audit],
    });
    if (hasil.tersimpan && hasil.jurnal)
      salinMappingPihak(db, id, hasil.jurnal.id);
    return hasil;
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

  const headerBaru: JurnalHeaderInput = {
    ...inputBaru.header,
    id: String(inputBaru.header?.id ?? '').trim() || idBaru('j'),
    // Pengganti tetap satu grup dengan jurnal asli + jurnal balik agar
    // penelusuran (drill-down) menunjukkan satu peristiwa koreksi utuh.
    grup_id: String(inputBaru.header?.grup_id ?? '').trim() || rencana.input.header.grup_id,
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

  // Validasi jurnal balik tanpa peringatan kas: dalam alur isi ulang,
  // peringatan yang relevan adalah saldo AKHIR setelah jurnal pengganti.
  const ctx = buatKonteksPosting(db, rencana.input.header);
  const validasiBalik = validasiJurnal(rencana.input, { ...ctx, saldoKas: undefined });
  const saldoSetelahBalik: Record<string, number> = { ...(ctx.saldoKas ?? {}) };
  for (const b of rencana.input.baris) {
    if (isAkunKas(b.akun_kode))
      saldoSetelahBalik[b.akun_kode] =
        (saldoSetelahBalik[b.akun_kode] ?? 0) + b.debit - b.kredit;
  }
  const validasiBaru = validasiJurnal(baru, { ...ctx, saldoKas: saldoSetelahBalik });

  const errors = [
    ...validasiBalik.errors.map((e) => `Jurnal balik: ${e}`),
    ...validasiBaru.errors.map((e) => `Jurnal pengganti: ${e}`),
  ];
  const peringatan = gabungUnik(validasiBalik.peringatan, validasiBaru.peringatan);
  if (errors.length > 0)
    return { boleh: false, errors, peringatan, perluKonfirmasi: false, tersimpan: false };
  if (peringatan.length > 0 && !opsi.konfirmasiPeringatan)
    return { boleh: true, errors: [], peringatan, perluKonfirmasi: true, tersimpan: false };

  const detail = getJurnalDetail(db, id)!;
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

  try {
    const simpan = db.transaction(() => {
      const reversal = insertJurnal(db, rencana.input!.header, rencana.input!.baris);
      const jurnalBaru = insertJurnal(db, headerBaru, baru.baris);
      // Metadata pihak ikut ke jurnal balik & pengganti (bila akunnya masih ada),
      // supaya saldo per pihak tetap mencerminkan koreksi.
      salinMappingPihak(db, id, reversal.id);
      salinMappingPihak(db, id, jurnalBaru.id);
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

