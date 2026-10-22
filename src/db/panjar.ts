// Adapter DB panjar v2 (P1-4).
//
// Panjar adalah dokumen operasional: serah uang muka lalu pertanggungjawaban.
// Semua angka akuntansi tetap berasal dari JURNAL:
// - Serah: D 1040 UANG PANJAR / K kas sumber.
// - Close: D rincian beban (+ D kas bila sisa) / K 1040; bila realisasi lebih
//   besar dari panjar, kekurangan dibayar dari kas sumber (K kas).
// Tabel `panjar`/`panjar_item` hanya menyimpan metadata dokumen + rincian item,
// TIDAK menyimpan saldo/laba/realisasi turunan.

import type Database from 'better-sqlite3';
import {
  buatJurnalPanjarClose,
  buatJurnalPanjarSerah,
  type HasilPanjarClose,
  type ItemPanjarClose,
} from '../core/forms.js';
import { buatAuditLog } from '../core/ledger.js';
import {
  tanggalKalenderValid,
  type HasilValidasiJurnal,
  type JurnalInput,
} from '../core/posting.js';
import type { Jurnal, Panjar, PanjarItem } from '../core/types.js';
import { formatRp } from '../utils/format.js';
import { isAkunKas } from './coa.js';
import { postingJurnal } from './posting.js';

export type SerahPanjarInput = {
  /** ID dokumen panjar; opsional (dibuat otomatis). */
  id?: string;
  /** ID jurnal serah; opsional (dibuat otomatis, berguna untuk test). */
  jurnalId?: string;
  tanggal: string;
  penerima: string;
  jumlah: number; // sen
  akunKasSumber?: string;
  /** Alias bentuk IPC/handler lama; `akunKasSumber` lebih diutamakan. */
  akun_kas_sumber?: string;
  /** Alias nama builder (dipakai sebagian test/internal). */
  akunKas?: string;
  keterangan?: string;
  noBukti?: string;
  alasan?: string;
  konfirmasiPeringatan?: boolean;
};

export type ItemCloseInput = {
  /** Nama field baru; `kategori_baga` diterima untuk kompatibilitas IPC lama. */
  akun?: string;
  kategori_baga?: string;
  nominal: number;
};

export type ClosePanjarInput = {
  id: string;
  tanggalClose: string;
  items: ItemCloseInput[];
  alasan?: string;
  /** Operator sudah menyetujui kekurangan dibayar dari kas sumber. */
  konfirmasiKurang?: boolean;
  /** Operator sudah menyetujui peringatan posting (mis. kas akan minus). */
  konfirmasiPeringatan?: boolean;
  /** ID jurnal close; opsional (dibuat otomatis, berguna untuk test). */
  jurnalId?: string;
};

export type HasilPanjar = HasilValidasiJurnal & {
  tersimpan: boolean;
  panjar?: Panjar;
  jurnal?: Jurnal;
  totalRealisasi?: number;
  sisa?: number;
  kurang?: number;
};

function gagal(pesan: string, extra: Partial<HasilPanjar> = {}): HasilPanjar {
  return {
    boleh: false,
    errors: [pesan],
    peringatan: [],
    perluKonfirmasi: false,
    tersimpan: false,
    ...extra,
  };
}

function uid(prefix: string): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function')
    return `${prefix}-${cryptoApi.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

type RowPanjar = Record<string, unknown>;

function rowToPanjar(r: RowPanjar, totalRealisasi: number): Panjar {
  const jumlah = Number(r.jumlah);
  const status = String(r.status) === 'CLOSED' ? 'CLOSED' : 'OPEN';
  const p: Panjar = {
    id: String(r.id),
    tanggal: String(r.tanggal),
    penerima: String(r.penerima),
    jumlah,
    akun_kas_sumber: String(r.akun_kas_sumber),
    status,
    tanggal_close: r.tanggal_close === null || r.tanggal_close === undefined
      ? null
      : String(r.tanggal_close),
    jurnal_open_id: String(r.jurnal_open_id ?? ''),
    jurnal_close_id: r.jurnal_close_id === null || r.jurnal_close_id === undefined
      ? null
      : String(r.jurnal_close_id),
    created_at: String(r.created_at ?? ''),
    total_realisasi: totalRealisasi,
  };
  if (status === 'CLOSED') {
    p.sisa = Math.max(0, jumlah - totalRealisasi);
    p.kurang = Math.max(0, totalRealisasi - jumlah);
  }
  return p;
}

/**
 * Serahkan panjar: validasi → posting jurnal D1040/K kas → simpan metadata +
 * audit `PANJAR-OPEN`, semuanya atomik. Jurnal gagal = metadata tidak ditulis.
 */
export function serahkanPanjar(
  db: Database.Database,
  input: SerahPanjarInput,
): HasilPanjar {
  const penerima = String(input?.penerima ?? '').trim();
  if (!penerima) return gagal('Nama penerima panjar wajib diisi.');
  if (penerima.length > 200) return gagal('Nama penerima panjar maks. 200 karakter.');
  if (!Number.isInteger(input?.jumlah) || input.jumlah <= 0)
    return gagal('Jumlah panjar harus bilangan bulat lebih dari 0 (satuan sen).');
  const akunKasSumber = String(
    input?.akunKasSumber ?? input?.akun_kas_sumber ?? input?.akunKas ?? '',
  ).trim();
  if (!isAkunKas(akunKasSumber))
    return gagal('Akun kas sumber panjar wajib akun kas/bank yang dikenal.');

  const id = String(input.id ?? '').trim() || uid('p');
  if (getPanjar(db, id)) return gagal(`Panjar ${id} sudah ada. Gunakan ID lain.`);
  const jurnalId = String(input.jurnalId ?? '').trim() || uid('j');
  const tanggal = String(input.tanggal ?? '').trim();
  const keterangan =
    String(input.keterangan ?? '').trim() || `Serah panjar ${penerima}`;

  let jurnalInput: JurnalInput;
  try {
    jurnalInput = buatJurnalPanjarSerah({
      tanggal,
      akunKas: akunKasSumber,
      nominal: input.jumlah,
      keterangan,
      id: jurnalId,
      ...(input.noBukti ? { noBukti: input.noBukti } : {}),
      ...(input.alasan ? { alasan: input.alasan } : {}),
    });
  } catch (e) {
    return gagal(e instanceof Error ? e.message : String(e));
  }

  const createdAt = new Date().toISOString();
  const panjar: Panjar = {
    id,
    tanggal,
    penerima,
    jumlah: input.jumlah,
    akun_kas_sumber: akunKasSumber,
    status: 'OPEN',
    tanggal_close: null,
    jurnal_open_id: jurnalId,
    jurnal_close_id: null,
    created_at: createdAt,
  };

  const audit = buatAuditLog(
    `PANJAR-OPEN ${id}`,
    String(input.alasan ?? '').trim(),
    undefined,
    { panjar, jurnal: jurnalInput.header, baris: jurnalInput.baris },
  );

  try {
    const simpan = db.transaction(() => {
      const hasil = postingJurnal(db, jurnalInput, {
        konfirmasiPeringatan: input.konfirmasiPeringatan === true,
        audit: [audit],
      });
      if (!hasil.tersimpan || !hasil.jurnal) return hasil;

      db.prepare(
        `INSERT INTO panjar
           (id, tanggal, penerima, jumlah, akun_kas_sumber, status,
            tanggal_close, jurnal_open_id, jurnal_close_id, created_at)
         VALUES (?, ?, ?, ?, ?, 'OPEN', NULL, ?, NULL, ?)`,
      ).run(id, tanggal, penerima, input.jumlah, panjar.akun_kas_sumber, jurnalId, createdAt);

      return { ...hasil, panjar };
    });
    return simpan();
  } catch (e) {
    return gagal(
      `Panjar gagal disimpan: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Pertanggungjawaban panjar. Menolak panjar yang tidak ada / sudah CLOSED,
 * tanggal close sebelum tanggal serah, dan kekurangan tanpa konfirmasi.
 * Jurnal close, update status, item, dan audit ditulis atomik.
 */
export function closePanjarV2(
  db: Database.Database,
  input: ClosePanjarInput,
): HasilPanjar {
  const id = String(input?.id ?? '').trim();
  if (!id) return gagal('Panjar yang akan dipertanggungjawabkan belum dipilih.');

  const panjar = getPanjar(db, id);
  if (!panjar) return gagal(`Panjar ${id} tidak ditemukan.`);
  if (panjar.status === 'CLOSED')
    return gagal('Panjar ini sudah ditutup dan tidak bisa ditutup dua kali.');

  const tanggalClose = String(input.tanggalClose ?? '').trim();
  if (!tanggalKalenderValid(tanggalClose))
    return gagal('Tanggal realisasi panjar tidak valid (YYYY-MM-DD).');
  if (tanggalClose < panjar.tanggal)
    return gagal(
      `Tanggal realisasi (${tanggalClose}) tidak boleh sebelum tanggal panjar (${panjar.tanggal}).`,
    );

  if (!Array.isArray(input.items) || input.items.length === 0)
    return gagal('Rincian realisasi panjar masih kosong. Tambah minimal satu baris beban.');

  const items: ItemPanjarClose[] = [];
  for (let i = 0; i < input.items.length; i += 1) {
    const it = input.items[i];
    const akun = String(it?.akun ?? it?.kategori_baga ?? '').trim();
    const nominal = it?.nominal as unknown;
    if (!akun)
      return gagal(`Rincian realisasi baris ${i + 1}: akun BEBAN belum dipilih.`);
    if (typeof nominal !== 'number' || !Number.isInteger(nominal) || nominal <= 0)
      return gagal(`Rincian realisasi baris ${i + 1}: nominal harus bilangan bulat > 0.`);
    items.push({ akun, nominal });
  }

  let rencana: HasilPanjarClose;
  try {
    rencana = buatJurnalPanjarClose({
      tanggal: tanggalClose,
      penerima: panjar.penerima,
      akunKas: panjar.akun_kas_sumber,
      jumlahPanjar: panjar.jumlah,
      items,
      ...(input.alasan ? { alasan: input.alasan } : {}),
      ...(input.jurnalId ? { id: input.jurnalId } : {}),
    });
  } catch (e) {
    return gagal(e instanceof Error ? e.message : String(e));
  }

  if (rencana.kurang > 0 && input.konfirmasiKurang !== true) {
    const pesan =
      `Realisasi melebihi panjar sebesar ${formatRp(rencana.kurang)}. ` +
      'Kekurangan akan dibayar dari kas sumber. Konfirmasi dulu bila memang benar.';
    return {
      boleh: true,
      errors: [],
      peringatan: [pesan],
      perluKonfirmasi: true,
      tersimpan: false,
      totalRealisasi: rencana.totalRealisasi,
      sisa: rencana.sisa,
      kurang: rencana.kurang,
    };
  }

  const jurnalId = rencana.input.header.id;
  const closedPanjar: Panjar = {
    ...panjar,
    status: 'CLOSED',
    tanggal_close: tanggalClose,
    jurnal_close_id: jurnalId,
    total_realisasi: rencana.totalRealisasi,
    sisa: rencana.sisa,
    kurang: rencana.kurang,
  };
  const audit = buatAuditLog(
    `PANJAR-CLOSE ${id}`,
    String(input.alasan ?? '').trim(),
    panjar,
    {
      panjar: closedPanjar,
      items: items.map((it) => ({
        panjar_id: id,
        kategori_baga: it.akun,
        nominal: it.nominal,
        jurnal_id: jurnalId,
      })),
      jurnal: rencana.input.header,
      baris: rencana.input.baris,
      totalRealisasi: rencana.totalRealisasi,
      sisa: rencana.sisa,
      kurang: rencana.kurang,
    },
  );

  try {
    const simpan = db.transaction(() => {
      const hasil = postingJurnal(db, rencana.input, {
        konfirmasiPeringatan: input.konfirmasiPeringatan === true,
        audit: [audit],
      });
      if (!hasil.tersimpan || !hasil.jurnal) {
        return {
          ...hasil,
          totalRealisasi: rencana.totalRealisasi,
          sisa: rencana.sisa,
          kurang: rencana.kurang,
        };
      }

      const update = db
        .prepare(
          `UPDATE panjar
             SET status = 'CLOSED', tanggal_close = ?, jurnal_close_id = ?
           WHERE id = ? AND status = 'OPEN'`,
        )
        .run(tanggalClose, jurnalId, id);
      if (Number(update.changes) !== 1)
        throw new Error('Panjar sudah ditutup oleh proses lain. Muat ulang daftar panjar.');

      const ins = db.prepare(
        `INSERT INTO panjar_item (panjar_id, kategori_baga, nominal, jurnal_id)
         VALUES (?, ?, ?, ?)`,
      );
      for (const it of items) ins.run(id, it.akun, it.nominal, jurnalId);

      return {
        ...hasil,
        panjar: closedPanjar,
        totalRealisasi: rencana.totalRealisasi,
        sisa: rencana.sisa,
        kurang: rencana.kurang,
      };
    });
    return simpan();
  } catch (e) {
    return gagal(
      `Pertanggungjawaban panjar gagal disimpan: ${e instanceof Error ? e.message : String(e)}`,
      {
        totalRealisasi: rencana.totalRealisasi,
        sisa: rencana.sisa,
        kurang: rencana.kurang,
      },
    );
  }
}

/** Daftar panjar + ringkasan realisasi (dihitung dari item, bukan kolom). */
export function listPanjarV2(
  db: Database.Database,
  status?: 'OPEN' | 'CLOSED',
): Panjar[] {
  const sql = `
    SELECT p.*, COALESCE(SUM(i.nominal), 0) AS total_realisasi
    FROM panjar p
    LEFT JOIN panjar_item i ON i.panjar_id = p.id
    ${status ? 'WHERE p.status = ?' : ''}
    GROUP BY p.id
    ORDER BY p.tanggal, p.id
  `;
  const rows = (status
    ? db.prepare(sql).all(status)
    : db.prepare(sql).all()) as RowPanjar[];
  return rows.map((r) => rowToPanjar(r, Number(r.total_realisasi ?? 0)));
}

export function getPanjar(db: Database.Database, id: string): Panjar | null {
  const r = db
    .prepare(
      `SELECT p.*, COALESCE((
         SELECT SUM(i.nominal) FROM panjar_item i WHERE i.panjar_id = p.id
       ), 0) AS total_realisasi
       FROM panjar p WHERE p.id = ?`,
    )
    .get(id) as RowPanjar | undefined;
  return r ? rowToPanjar(r, Number(r.total_realisasi ?? 0)) : null;
}

/** Rincian item panjar, termasuk id dan jurnal pertanggungjawaban. */
export function listPanjarItemsV2(
  db: Database.Database,
  panjarId: string,
): PanjarItem[] {
  const rows = db
    .prepare(
      `SELECT id, panjar_id, kategori_baga, nominal, jurnal_id
       FROM panjar_item WHERE panjar_id = ? ORDER BY id`,
    )
    .all(panjarId) as RowPanjar[];
  return rows.map((r) => ({
    id: Number(r.id),
    panjar_id: String(r.panjar_id),
    kategori_baga: String(r.kategori_baga),
    nominal: Number(r.nominal),
    jurnal_id: String(r.jurnal_id),
  }));
}
