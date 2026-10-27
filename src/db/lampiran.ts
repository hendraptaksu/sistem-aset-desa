// P2-4 — adapter metadata lampiran bukti jurnal.
//
// DB hanya menyimpan metadata; isi file ada di `<userData>/attachments`.
// `nama_simpan` adalah nama file relatif (bukan path absolut), sehingga DB
// aman dipindah/backup tanpa membawa path mesin lama.
//
// Audit memakai `LAMPIRAN-TAMBAH` / `LAMPIRAN-HAPUS` dan hanya mencatat
// metadata — tidak pernah isi file/base64.

import type Database from 'better-sqlite3';
import {
  mimeDariNama,
  validasiLampiran,
} from '../core/lampiran.js';
import type { LampiranJurnal } from '../core/types.js';
import { catatAudit, getJurnal } from './repository.js';

const rowToLampiran = (r: Record<string, unknown>): LampiranJurnal => ({
  id: String(r.id),
  jurnal_id: String(r.jurnal_id),
  nama_asli: String(r.nama_asli),
  nama_simpan: String(r.nama_simpan),
  mime: String(r.mime),
  ukuran: Number(r.ukuran),
  created_at: String(r.created_at),
});

/** Metadata semua lampiran satu jurnal, urut waktu unggah. */
export function listLampiran(
  db: Database.Database,
  jurnalId: string,
): LampiranJurnal[] {
  const rows = db
    .prepare(
      `SELECT * FROM lampiran_jurnal
       WHERE jurnal_id = ?
       ORDER BY created_at, rowid`,
    )
    .all(jurnalId) as Record<string, unknown>[];
  return rows.map(rowToLampiran);
}

/** Satu metadata lampiran; null bila tidak ada. */
export function getLampiran(
  db: Database.Database,
  id: string,
): LampiranJurnal | null {
  const r = db.prepare('SELECT * FROM lampiran_jurnal WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return r ? rowToLampiran(r) : null;
}

export type InputLampiran = {
  id: string;
  jurnal_id: string;
  nama_asli: string;
  nama_simpan: string;
  mime: string;
  ukuran: number;
  created_at?: string;
};

function normalisasiMetadata(
  db: Database.Database,
  input: InputLampiran,
): LampiranJurnal {
  const id = typeof input?.id === 'string' ? input.id.trim() : '';
  if (!id) throw new Error('ID lampiran wajib diisi.');
  if (id.length > 200) throw new Error('ID lampiran terlalu panjang.');
  if (/[\r\n\0]/.test(id)) throw new Error('ID lampiran tidak valid.');

  const jurnalId =
    typeof input?.jurnal_id === 'string' ? input.jurnal_id.trim() : '';
  if (!jurnalId) throw new Error('Jurnal lampiran wajib dipilih.');
  if (!getJurnal(db, jurnalId)) {
    throw new Error('Jurnal tidak ditemukan. Lampiran tidak bisa disimpan.');
  }

  const cek = validasiLampiran({
    namaAsli: input?.nama_asli,
    ukuran: input?.ukuran,
    mime: input?.mime,
  });
  if (!cek.ok) throw new Error(cek.error);

  const namaSimpan =
    typeof input?.nama_simpan === 'string' ? input.nama_simpan.trim() : '';
  if (!namaSimpan) throw new Error('Nama file simpan lampiran wajib diisi.');
  if (
    namaSimpan.includes('/') ||
    namaSimpan.includes('\\') ||
    namaSimpan.includes('..') ||
    namaSimpan.includes('\0') ||
    /[\r\n]/.test(namaSimpan)
  ) {
    throw new Error('Nama file simpan lampiran tidak aman.');
  }
  // Aplikasi selalu memakai `<id>.<ekstensi>`, tetapi adapter hanya menuntut
  // nama file relatif yang aman + MIME cocok. Keunikan nama file ditegakkan
  // oleh UNIQUE index di DB (diuji terpisah).
  if (mimeDariNama(namaSimpan) !== cek.mime) {
    throw new Error('Jenis file lampiran tidak cocok dengan nama file simpan.');
  }

  return {
    id,
    jurnal_id: jurnalId,
    nama_asli: cek.namaAsli,
    nama_simpan: namaSimpan,
    mime: cek.mime,
    ukuran: cek.ukuran,
    created_at:
      typeof input?.created_at === 'string' && input.created_at.trim()
        ? input.created_at.trim()
        : new Date().toISOString(),
  };
}

/**
 * Simpan metadata lampiran + audit dalam satu transaksi. Jurnal harus ada;
 * `nama_simpan` unik. File fisik sudah harus tersalin sebelum fungsi ini
 * dipanggil — bila insert/audit gagal, pemanggil (simpanLampiranDenganMetadata)
 * menghapus file agar tidak yatim.
 */
export function tambahLampiran(
  db: Database.Database,
  input: InputLampiran,
): LampiranJurnal {
  const row = normalisasiMetadata(db, input);

  const simpan = db.transaction(() => {
    try {
      db.prepare(
        `INSERT INTO lampiran_jurnal
           (id, jurnal_id, nama_asli, nama_simpan, mime, ukuran, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        row.id,
        row.jurnal_id,
        row.nama_asli,
        row.nama_simpan,
        row.mime,
        row.ukuran,
        row.created_at,
      );
    } catch (e) {
      if (String(e).includes('UNIQUE constraint failed: lampiran_jurnal.nama_simpan')) {
        throw new Error('Nama file lampiran sudah dipakai. Coba unggah ulang.');
      }
      if (String(e).includes('UNIQUE constraint failed: lampiran_jurnal.id')) {
        throw new Error('Lampiran dengan ID tersebut sudah terdaftar.');
      }
      throw e;
    }
    catatAudit(db, {
      aksi: 'LAMPIRAN-TAMBAH',
      alasan: `Lampiran ${row.nama_asli} diunggah untuk jurnal ${row.jurnal_id}`,
      baru: row,
    });
  });
  simpan();
  return row;
}

/**
 * Hapus metadata + audit atomik, kembalikan metadata yang dihapus (null bila
 * tidak ada). File fisik dihapus best-effort oleh pemanggil setelah transaksi.
 */
export function hapusLampiran(
  db: Database.Database,
  id: string,
): LampiranJurnal | null {
  const hapus = db.transaction(() => {
    const lama = getLampiran(db, id);
    if (!lama) return null;
    db.prepare('DELETE FROM lampiran_jurnal WHERE id = ?').run(lama.id);
    catatAudit(db, {
      aksi: 'LAMPIRAN-HAPUS',
      alasan: `Lampiran ${lama.nama_asli} dihapus dari jurnal ${lama.jurnal_id}`,
      lama,
    });
    return lama;
  });
  return hapus();
}
