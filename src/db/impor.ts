// Adapter DB impor jurnal dari Excel (P2-9).
//
// Parser hanya menghasilkan data mentah + validasi struktur. Modul ini adalah
// satu-satunya jalur yang menulis jurnal hasil impor, dan tetap memakai
// `postingJurnal` agar semua aturan (seimbang, nomor bukti otomatis, kunci
// periode, kas minus, audit CREATE) berlaku sama seperti form biasa.
//
// Prinsip:
// - Satu grup = satu jurnal; transaksi DB per grup (postingJurnal atomik).
// - Grup yang gagal tidak menyimpan baris apa pun.
// - Kas/bank minus TIDAK diimpor diam-diam: butuh `konfirmasiPeringatan`.
// - Satu baris audit `IMPORT-EXCEL` berisi ringkasan; isi file tidak disimpan.

import type Database from 'better-sqlite3';
import { catatAudit } from './repository.js';
import { postingJurnal, validasiJurnalDb } from './posting.js';
import { peringatanPihakTanpaMapping } from '../core/pihak.js';
import type { JurnalInput } from '../core/posting.js';
import {
  PESAN_NO_BUKTI_IMPOR_WAJIB,
  hitungRingkasanImpor,
  type HasilBarisImpor,
  type HasilGrupImpor,
  type HasilParseImpor,
  type RingkasanImpor,
} from '../features/import/parser.js';

/**
 * AKT-24: alasan baku saat nomor bukti dari file sudah dipakai pada tahun yang
 * sama. Jangan menyimpan grup ini; impor ulang file yang sama harus aman.
 */
export const PESAN_NOMOR_BUKTI_DIPAKAI = 'GAGAL: nomor bukti sudah dipakai';

export type OpsiImporExcel = {
  /** Operator sudah menyetujui jurnal yang membuat kas/bank minus. */
  konfirmasiPeringatan?: boolean;
  /** Nama file untuk audit (bukan isi file). */
  namaFile?: string;
  /** AKT-02: impor termasuk pintu input yang mewajibkan saldo awal pertama. */
  wajibSaldoAwal?: boolean;
  /** Operator sudah memilih "mulai tanpa saldo awal" pada sesi ini. */
  konfirmasiTanpaSaldoAwal?: boolean;
  /** Waktu acuan yang bisa dipatok test. */
  now?: () => Date;
  /** Pembuat ID jurnal; default unik berbasis waktu + nomor grup. */
  buatId?: (grup: HasilGrupImpor, index: number) => string;
};

export type RingkasanImporExcel = RingkasanImpor & {
  grupBerhasil: number;
  grupGagal: number;
  jurnalDibuat: number;
  noBuktiDibuat: string[];
};

export type HasilImporExcel = {
  grup: HasilGrupImpor[];
  baris: HasilBarisImpor[];
  ringkasan: RingkasanImporExcel;
  errors: string[];
  namaFile?: string;
};

function unikAlasan(daftar: readonly string[]): string[] {
  const terlihat = new Set<string>();
  const hasil: string[] = [];
  for (const teks of daftar) {
    const bersih = String(teks ?? '').replace(/\s+/g, ' ').trim();
    if (!bersih) continue;
    const kunci = bersih.toLowerCase();
    if (terlihat.has(kunci)) continue;
    terlihat.add(kunci);
    hasil.push(bersih);
  }
  return hasil;
}

/** Nomor bukti sudah dipakai pada tahun yang sama (case-insensitive). */
function nomorBuktiSudahDipakai(
  db: Database.Database,
  noBukti: string,
  tanggal: string,
): boolean {
  const nomor = String(noBukti ?? '').trim();
  const tahun = String(tanggal ?? '').trim().slice(0, 4);
  if (!nomor || !/^\d{4}$/.test(tahun)) return false;
  const row = db
    .prepare(
      `SELECT id FROM jurnal
       WHERE no_bukti <> ''
         AND substr(tanggal, 1, 4) = ?
         AND no_bukti = ? COLLATE NOCASE
       LIMIT 1`,
    )
    .get(tahun, nomor) as { id: string } | undefined;
  return Boolean(row);
}

/** Baris-baris Excel milik satu grup (aman untuk bentuk sederhana). */
function barisMilikGrup(baris: HasilBarisImpor[], grup: HasilGrupImpor): HasilBarisImpor[] {
  return baris.filter((b) => grup.barisExcel.includes(b.barisExcel));
}

function tandaiBaris(
  baris: HasilBarisImpor[],
  grup: HasilGrupImpor,
  status: 'OK' | 'GAGAL',
  alasan: string,
  jurnal?: { id: string; no_bukti: string },
): void {
  for (const b of barisMilikGrup(baris, grup)) {
    b.status = status;
    if (status === 'GAGAL') b.alasan = unikAlasan([b.alasan, alasan]).join(' ');
    else b.alasan = '';
    if (jurnal) {
      b.jurnalId = jurnal.id;
      b.noBukti = jurnal.no_bukti;
    }
  }
}

/**
 * Validasi hasil parser terhadap DB TANPA menulis apa pun. Dipakai layar
 * pratinjau: memeriksa akun, kunci periode, nomor bukti duplikat, dan
 * peringatan kas minus lewat `validasiJurnalDb` (pintu aturan yang sama).
 */
export function validasiImporDariExcel(
  db: Database.Database,
  hasil: HasilParseImpor,
): HasilParseImpor {
  const grup: HasilGrupImpor[] = hasil.grup.map((g, i) => {
    const dasar: HasilGrupImpor = {
      ...g,
      barisExcel: [...g.barisExcel],
      ...(g.input
        ? {
            input: {
              header: { ...g.input.header },
              baris: g.input.baris.map((b) => ({ ...b })),
            },
          }
        : {}),
    };

    if (g.status !== 'OK' || !g.input) return dasar;

    const noBukti = String(g.no_bukti || g.input.header.no_bukti || '').trim();
    if (!noBukti) {
      return {
        ...dasar,
        status: 'GAGAL',
        alasan: unikAlasan([dasar.alasan, PESAN_NO_BUKTI_IMPOR_WAJIB]).join(' '),
      };
    }
    if (nomorBuktiSudahDipakai(db, noBukti, g.tanggal)) {
      return {
        ...dasar,
        status: 'GAGAL',
        alasan: `${PESAN_NOMOR_BUKTI_DIPAKAI} (${noBukti}).`,
      };
    }

    const input: JurnalInput = {
      header: {
        ...g.input.header,
        // ID tidak dipakai validator; beri nilai unik agar tidak pernah kosong.
        id: g.input.header.id || `preview-${i + 1}`,
        jenis: 'UMUM',
      },
      baris: g.input.baris.map((b) => ({ ...b })),
    };

    let validasi: ReturnType<typeof validasiJurnalDb>;
    try {
      validasi = validasiJurnalDb(db, input);
    } catch (e) {
      const pesan = e instanceof Error ? e.message : 'Validasi jurnal gagal.';
      return {
        ...dasar,
        status: 'GAGAL',
        alasan: unikAlasan([dasar.alasan, pesan]).join(' '),
      };
    }

    if (validasi.errors.length > 0) {
      return {
        ...dasar,
        status: 'GAGAL',
        alasan: unikAlasan([dasar.alasan, ...validasi.errors]).join(' '),
      };
    }

    const peringatanPihak = peringatanPihakTanpaMapping(input);
    return {
      ...dasar,
      status: 'OK',
      alasan: '',
      peringatan: unikAlasan([...validasi.peringatan, ...peringatanPihak]),
      perluKonfirmasi: validasi.perluKonfirmasi || peringatanPihak.length > 0,
    };
  });

  // Baris pada grup yang baru gagal karena pemeriksaan DB juga harus tampil
  // GAGAL beserta alasannya (cermin status grup di tabel pratinjau).
  const baris = hasil.baris.map((b) => ({ ...b }));
  for (const g of grup) {
    if (g.status === 'GAGAL') {
      tandaiBaris(baris, g, 'GAGAL', g.alasan);
    }
  }

  return {
    ...hasil,
    grup,
    baris,
    ringkasan: hitungRingkasanImpor(grup, baris),
    errors: [...hasil.errors],
  };
}

function buatIdImpor(now: Date, index: number): string {
  return `impor-${now.getTime()}-${index + 1}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Impor seluruh grup VALID ke DB. Grup yang gagal tidak disimpan. Mengembalikan
 * status per grup/baris + nomor bukti yang dibuat, serta menulis satu audit
 * ringkasan `IMPORT-EXCEL`.
 */
export function imporJurnalDariExcel(
  db: Database.Database,
  hasil: HasilParseImpor,
  opsi: OpsiImporExcel = {},
): HasilImporExcel {
  const namaFile = String(opsi.namaFile ?? hasil.namaFile ?? '').trim();
  const now = opsi.now?.() ?? new Date();
  const grup: HasilGrupImpor[] = [];
  const baris = hasil.baris.map((b) => ({ ...b }));
  const errors: string[] = [...hasil.errors];
  const noBuktiDibuat: string[] = [];
  let jurnalDibuat = 0;

  hasil.grup.forEach((g, i) => {
    if (g.status !== 'OK' || !g.input) {
      const alasan = g.alasan || 'Grup tidak valid dan tidak diimpor.';
      grup.push({ ...g, status: 'GAGAL', alasan });
      tandaiBaris(baris, g, 'GAGAL', alasan);
      return;
    }

    const noBukti = String(g.no_bukti || g.input.header.no_bukti || '').trim();
    if (!noBukti) {
      const alasan = PESAN_NO_BUKTI_IMPOR_WAJIB;
      grup.push({ ...g, status: 'GAGAL', alasan });
      tandaiBaris(baris, g, 'GAGAL', alasan);
      return;
    }

    // AKT-24: impor tidak boleh membuat nomor otomatis. Nomor dari file yang
    // sudah ada pada tahun yang sama ditolak sebelum posting, sehingga impor
    // ulang file yang sama tidak menambah jurnal baru.
    if (nomorBuktiSudahDipakai(db, noBukti, g.tanggal)) {
      const alasan = `${PESAN_NOMOR_BUKTI_DIPAKAI} (${noBukti}).`;
      grup.push({ ...g, status: 'GAGAL', alasan });
      tandaiBaris(baris, g, 'GAGAL', alasan);
      return;
    }

    const id = opsi.buatId?.(g, i) ?? buatIdImpor(now, i);
    const input: JurnalInput = {
      header: {
        ...g.input.header,
        no_bukti: noBukti,
        id,
        jenis: 'UMUM',
        created_at: now.toISOString(),
      },
      baris: g.input.baris.map((b) => ({ ...b })),
    };

    // AUD-09: impor belum mendukung kolom pihak. Minta konfirmasi operator
    // sebelum menyimpan jurnal 1050/2050 yang akan tampil belum teralokasi.
    const peringatanPihak = peringatanPihakTanpaMapping(input);
    if (peringatanPihak.length > 0 && opsi.konfirmasiPeringatan !== true) {
      const peringatan = unikAlasan([...(g.peringatan ?? []), ...peringatanPihak]);
      const alasan = `Perlu konfirmasi sebelum impor: ${peringatan.join(' ')}`;
      grup.push({
        ...g,
        status: 'GAGAL',
        alasan,
        peringatan,
        perluKonfirmasi: true,
      });
      tandaiBaris(baris, g, 'GAGAL', alasan);
      return;
    }

    try {
      // postingJurnal sudah atomik (satu transaksi DB). Bila gagal, tidak ada
      // jurnal/baris/audit CREATE yang tertinggal.
      const posting = postingJurnal(db, input, {
        konfirmasiPeringatan: opsi.konfirmasiPeringatan === true,
        wajibSaldoAwal: opsi.wajibSaldoAwal === true,
        konfirmasiTanpaSaldoAwal: opsi.konfirmasiTanpaSaldoAwal === true,
      });

      if (posting.tersimpan && posting.jurnal) {
        jurnalDibuat++;
        noBuktiDibuat.push(posting.jurnal.no_bukti);
        grup.push({
          ...g,
          status: 'OK',
          alasan: '',
          jurnalId: posting.jurnal.id,
          noBuktiDibuat: posting.jurnal.no_bukti,
          peringatan: unikAlasan([...posting.peringatan, ...peringatanPihak]),
          perluKonfirmasi: false,
        });
        tandaiBaris(baris, g, 'OK', '', {
          id: posting.jurnal.id,
          no_bukti: posting.jurnal.no_bukti,
        });
        return;
      }

      const peringatan = unikAlasan([...peringatanPihak, ...posting.peringatan]);
      const perluKonfirmasi = posting.errors.length === 0 && posting.perluKonfirmasi;
      const pesanDasar =
        unikAlasan([...posting.errors, ...peringatan]).join(' ') ||
        'Jurnal gagal disimpan.';
      const alasan = perluKonfirmasi
        ? `Perlu konfirmasi sebelum impor: ${pesanDasar}`
        : pesanDasar;
      grup.push({
        ...g,
        status: 'GAGAL',
        alasan,
        peringatan,
        perluKonfirmasi,
      });
      tandaiBaris(baris, g, 'GAGAL', alasan);
    } catch (e) {
      const pesan =
        e instanceof Error && e.message ? e.message : 'Jurnal gagal disimpan.';
      const alasan = `Gagal menyimpan grup: ${pesan}`;
      errors.push(alasan);
      grup.push({ ...g, status: 'GAGAL', alasan });
      tandaiBaris(baris, g, 'GAGAL', alasan);
    }
  });

  const grupBerhasil = grup.filter((g) => g.status === 'OK').length;
  const grupGagal = grup.length - grupBerhasil;
  // Total pada hasil impor hanya mencakup grup yang benar-benar tersimpan.
  const totalDebit = grup
    .filter((g) => g.status === 'OK')
    .reduce((s, g) => s + g.totalDebit, 0);
  const totalKredit = grup
    .filter((g) => g.status === 'OK')
    .reduce((s, g) => s + g.totalKredit, 0);
  const ringkasanDasar = hitungRingkasanImpor(grup, baris);
  const ringkasan: RingkasanImporExcel = {
    ...ringkasanDasar,
    totalDebit,
    totalKredit,
    seimbang: totalDebit === totalKredit && totalDebit > 0,
    grupBerhasil,
    grupGagal,
    jurnalDibuat,
    noBuktiDibuat,
  };

  // Audit ringkasan TIDAK menyimpan isi file — hanya nama file & angka hasil.
  try {
    catatAudit(db, {
      aksi: 'IMPORT-EXCEL',
      alasan: `Impor Excel ${namaFile || '(tanpa nama file)'}: ${grupBerhasil} jurnal berhasil, ${grupGagal} gagal`,
      baru: {
        nama_file: namaFile,
        grup_sukses: grupBerhasil,
        grup_gagal: grupGagal,
        jurnal_dibuat: jurnalDibuat,
        jumlah_baris: baris.length,
        nomor_bukti: noBuktiDibuat,
      },
      tanggal: now.toISOString(),
    });
  } catch (e) {
    errors.push(
      e instanceof Error
        ? `Jurnal tersimpan, tetapi audit ringkasan gagal ditulis: ${e.message}`
        : 'Jurnal tersimpan, tetapi audit ringkasan gagal ditulis.',
    );
  }

  return {
    grup,
    baris,
    ringkasan,
    errors,
    ...(namaFile ? { namaFile } : {}),
  };
}
