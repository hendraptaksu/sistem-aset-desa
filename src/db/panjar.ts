// Adapter DB panjar v2 (P1-4).
//
// Panjar adalah dokumen operasional: serah uang muka lalu pertanggungjawaban.
// Semua angka akuntansi tetap berasal dari JURNAL:
// - Serah: D 1040 UANG PANJAR / K kas sumber.
// - Close: D rincian beban (+ D kas bila sisa) / K 1040; bila realisasi lebih
//   besar dari panjar, kekurangan dibayar dari kas sumber (K kas).
// Tabel `panjar`/`panjar_item` hanya menyimpan metadata dokumen + rincian item,
// TIDAK menyimpan saldo/laba/realisasi turunan.
//
// DB-20 — header `panjar` yang SENGAJA disimpan:
// - tanggal, jumlah, akun_kas_sumber: cermin jurnal serah (D 1040 / K kas
//   sumber) agar daftar/detail tidak perlu join setiap saat; wajib sama dengan
//   jurnal open dan tidak boleh diubah terpisah.
// - status, tanggal_close, jurnal_open_id, jurnal_close_id, created_at:
//   status operasional dokumen dan tautan jurnal.
// Nilai TURUNAN (tidak disimpan, dihitung dari item + jurnal):
// total_realisasi = SUM(panjar_item.nominal), sisa, dan kurang. `panjar_item`
// adalah detail nota dan tidak boleh di-drop. Audit `PANJAR_HEADER_TIDAK_COCOK`
// menangkap drift header terhadap jurnal serah yang di-seed lewat SQL.

import type Database from 'better-sqlite3';
import {
  buatJurnalPanjarClose,
  buatJurnalPanjarSerah,
  normalisasiNotaPanjar,
  type HasilPanjarClose,
  type ItemPanjarClose,
} from '../core/forms.js';
import { buatAuditLog } from '../core/audit.js';
import {
  tanggalKalenderValid,
  type HasilValidasiJurnal,
  type JurnalInput,
} from '../core/posting.js';
import { rencanaReversal } from '../core/reversal.js';
import type { Jurnal, Panjar, PanjarItem } from '../core/types.js';
import { formatRp } from '../utils/format.js';
import { isAkunKasData } from './coa.js';
import { getAkun, getJurnalDetail, listAkun, listJurnal } from './repository.js';
import { postingJurnal } from './posting.js';
import { rekonsiliasiPanjar } from '../core/rekonsiliasiPanjar.js';
import type { HasilRekonsiliasiPanjar } from '../core/rekonsiliasiPanjar.js';
import { rekonsiliasiPanjarTersimpan } from './panjarRekonsiliasi.js';

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
  /** AKT-02: pintu input mewajibkan saldo awal untuk jurnal pertama. */
  wajibSaldoAwal?: boolean;
  /** Operator sudah memilih "mulai tanpa saldo awal" pada sesi ini. */
  konfirmasiTanpaSaldoAwal?: boolean;
};

export type ItemCloseInput = {
  /** Nama field baru; `kategori_baga` diterima untuk kompatibilitas IPC lama. */
  akun?: string;
  kategori_baga?: string;
  nominal: number;
  /** DB-18: detail nota opsional; kosong = perilaku legacy. */
  nota_nomor?: string;
  nota_tanggal?: string;
  toko?: string;
  keterangan?: string;
};

export type ClosePanjarInput = {
  id: string;
  tanggalClose: string;
  items: ItemCloseInput[];
  alasan?: string;
  /** Operator sudah menyetujui kekurangan dibayar dari kas sumber. */
  konfirmasiKurang?: boolean;
  /** AKT-08: alasan operator saat realisasi melebihi panjar. */
  alasanKurang?: string;
  /** AKT-08: alasan operator saat peringatan posting (mis. kas minus) dikonfirmasi. */
  alasanPeringatan?: string;
  /** Operator sudah menyetujui peringatan posting (mis. kas akan minus). */
  konfirmasiPeringatan?: boolean;
  /** AKT-02: pintu input mewajibkan saldo awal untuk jurnal pertama. */
  wajibSaldoAwal?: boolean;
  /** Operator sudah memilih "mulai tanpa saldo awal" pada sesi ini. */
  konfirmasiTanpaSaldoAwal?: boolean;
  /** ID jurnal close; opsional (dibuat otomatis, berguna untuk test). */
  jurnalId?: string;
};

export type BatalPanjarInput = {
  id: string;
  /** Wajib >= 5 karakter; disimpan di `alasan_batal` dan audit. */
  alasan: string;
  /** Tanggal jurnal balik; default tanggal jurnal serah agar satu periode. */
  tanggalBatal?: string;
  /** ID jurnal balik; opsional (dibuat otomatis, berguna untuk test). */
  jurnalId?: string;
  /** Operator sudah menyetujui peringatan posting (mis. kas minus). */
  konfirmasiPeringatan?: boolean;
};

export type StatusPanjar = 'OPEN' | 'CLOSED' | 'DIBATALKAN';

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

/** DB-19: pesan selisih per akun yang dipakai closePanjarV2. */
function pesanSelisihRekonsiliasi(hasil: HasilRekonsiliasiPanjar): string {
  const rincian = hasil.akun_selisih
    .map(
      (a) =>
        `${a.akun} item ${formatRp(a.total_item)} vs jurnal ${formatRp(a.total_jurnal)} ` +
        `(selisih ${formatRp(a.selisih)})`,
    )
    .join('; ');
  return (
    'Rincian realisasi panjar tidak cocok dengan jurnal close: ' +
    `${rincian || 'total item dan jurnal berbeda'}. Pertanggungjawaban dibatalkan.`
  );
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
  const jurnalBatalId =
    r.jurnal_batal_id === null || r.jurnal_batal_id === undefined
      ? null
      : String(r.jurnal_batal_id);
  // Status publik diturunkan: kolom `status` sengaja tetap OPEN/CLOSED agar
  // CHECK lama tidak perlu rebuild tabel. Baris yang punya jurnal batal
  // ditampilkan DIBATALKAN.
  const status: Panjar['status'] =
    jurnalBatalId !== null && jurnalBatalId !== ''
      ? 'DIBATALKAN'
      : String(r.status) === 'CLOSED'
        ? 'CLOSED'
        : 'OPEN';
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
    jurnal_batal_id: jurnalBatalId,
    tanggal_batal: r.tanggal_batal === null || r.tanggal_batal === undefined
      ? null
      : String(r.tanggal_batal),
    alasan_batal: String(r.alasan_batal ?? ''),
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
  if (!Number.isSafeInteger(input?.jumlah) || input.jumlah <= 0)
    return gagal('Jumlah panjar harus bilangan bulat lebih dari 0 (satuan sen).');
  const akunKasSumber = String(
    input?.akunKasSumber ?? input?.akun_kas_sumber ?? input?.akunKas ?? '',
  ).trim();
  if (!isAkunKasData(getAkun(db, akunKasSumber)))
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
      daftarAkun: listAkun(db),
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
        wajibSaldoAwal: input.wajibSaldoAwal === true,
        konfirmasiTanpaSaldoAwal: input.konfirmasiTanpaSaldoAwal === true,
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
  if (panjar.jurnal_batal_id)
    return gagal(
      'Panjar ini sudah dibatalkan dan tidak bisa dipertanggungjawabkan. ' +
        'Panjar yang dibatalkan bersifat final; buat panjar baru bila uang diserahkan lagi.',
    );
  if (panjar.status === 'CLOSED')
    return gagal('Panjar ini sudah ditutup dan tidak bisa ditutup dua kali.');
  if (panjar.status !== 'OPEN')
    return gagal('Hanya panjar berstatus OPEN yang bisa dipertanggungjawabkan.');

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
    if (typeof nominal !== 'number' || !Number.isSafeInteger(nominal) || nominal <= 0)
      return gagal(`Rincian realisasi baris ${i + 1}: nominal harus bilangan bulat > 0.`);
    const nota = normalisasiNotaPanjar(it, {
      tanggalClose,
      label: `Rincian realisasi baris ${i + 1}`,
    });
    if (!nota.ok) return gagal(nota.error);
    items.push({ akun, nominal, ...nota.nota });
  }

  const daftarAkun = listAkun(db);
  let rencana: HasilPanjarClose;
  try {
    rencana = buatJurnalPanjarClose({
      tanggal: tanggalClose,
      penerima: panjar.penerima,
      akunKas: panjar.akun_kas_sumber,
      jumlahPanjar: panjar.jumlah,
      items,
      daftarAkun,
      ...(input.alasan ? { alasan: input.alasan } : {}),
      ...(input.jurnalId ? { id: input.jurnalId } : {}),
    });
  } catch (e) {
    return gagal(e instanceof Error ? e.message : String(e));
  }

  // DB-19: jurnal adalah sumber total. Bandingkan item yang akan disimpan
  // dengan debit BEBAN jurnal close memakai helper yang sama dengan audit.
  // Normalnya selalu cocok karena keduanya berasal dari `items`; guard ini
  // menangkap drift/duplicate code path sebelum ada yang ditulis.
  const kodeBeban = new Set(
    daftarAkun.filter((a) => a.tipe === 'BEBAN').map((a) => a.kode),
  );
  const cekRencana = rekonsiliasiPanjar(
    items.map((it) => ({ akun: it.akun, nominal: it.nominal })),
    rencana.input.baris,
    kodeBeban,
  );
  if (!cekRencana.ok) {
    return gagal(pesanSelisihRekonsiliasi(cekRencana), {
      totalRealisasi: rencana.totalRealisasi,
      sisa: rencana.sisa,
      kurang: rencana.kurang,
    });
  }

  const alasanKurang = String(input.alasanKurang ?? '').trim();
  const alasanPeringatan = String(input.alasanPeringatan ?? '').trim();
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

  // AKT-08: overrun adalah aturan adapter, bukan `validasiJurnal`. Alasan wajib
  // ada sebelum transaksi tulis agar jurnal + audit tidak tersimpan.
  if (
    rencana.kurang > 0 &&
    input.konfirmasiKurang === true &&
    alasanKurang.length < 5
  ) {
    const pesan =
      `Realisasi melebihi panjar sebesar ${formatRp(rencana.kurang)}. ` +
      'Konfirmasi kekurangan wajib disertai alasan minimal 5 karakter.';
    return {
      boleh: false,
      errors: [pesan],
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
        nota_nomor: it.nota_nomor ?? '',
        nota_tanggal: it.nota_tanggal ?? '',
        toko: it.toko ?? '',
        keterangan: it.keterangan ?? '',
      })),
      jurnal: rencana.input.header,
      baris: rencana.input.baris,
      totalRealisasi: rencana.totalRealisasi,
      sisa: rencana.sisa,
      kurang: rencana.kurang,
      ...(rencana.kurang > 0
        ? { nominalKurang: rencana.kurang, alasanKurang }
        : {}),
      ...(alasanPeringatan ? { alasanPeringatan } : {}),
    },
  );

  try {
    const simpan = db.transaction(() => {
      const hasil = postingJurnal(db, rencana.input, {
        konfirmasiPeringatan: input.konfirmasiPeringatan === true,
        // AKT-08: peringatan kas dari posting layer wajib alasan, diteruskan
        // dari input panjar dan dicatat di audit.
        alasanPeringatan,
        wajibAlasanPeringatan: true,
        wajibSaldoAwal: input.wajibSaldoAwal === true,
        konfirmasiTanpaSaldoAwal: input.konfirmasiTanpaSaldoAwal === true,
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
        `INSERT INTO panjar_item
           (panjar_id, kategori_baga, nominal, jurnal_id,
            nota_nomor, nota_tanggal, toko, keterangan)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const it of items)
        ins.run(
          id,
          it.akun,
          it.nominal,
          jurnalId,
          it.nota_nomor ?? '',
          it.nota_tanggal ?? '',
          it.toko ?? '',
          it.keterangan ?? '',
        );

      // DB-19: verifikasi ulang dari `panjar_item` yang benar-benar tersimpan
      // terhadap jurnal close. Helper sama dengan audit; selisih melempar error
      // sehingga seluruh transaksi (jurnal/metadata/item/audit) rollback.
      const cekTersimpan = rekonsiliasiPanjarTersimpan(db, id);
      if (!cekTersimpan || !cekTersimpan.ok) {
        throw new Error(
          cekTersimpan
            ? pesanSelisihRekonsiliasi(cekTersimpan)
            : 'Jurnal close panjar tidak ditemukan saat rekonsiliasi.',
        );
      }

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

/**
 * DB-21 — batalkan panjar yang masih OPEN.
 *
 * Alur atomik:
 * 1. validasi status OPEN, belum pernah dibatalkan, alasan >= 5 karakter;
 * 2. susun reversal jurnal serah (tukar debit/kredit sehingga D kas / K 1040)
 *    lewat `rencanaReversal` — bukan `reverseJurnal`, supaya guard Jurnal Umum
 *    `PESAN_REVERSAL_PANJAR` tidak dilonggarkan untuk pengguna umum;
 * 3. posting reversal berjenis REVERSAL dengan grup & `reversal_of` jurnal
 *    serah, lalu tautkan `jurnal_batal_id`/`tanggal_batal`/`alasan_batal` dan
 *    tulis audit `PANJAR-BATAL`. Jurnal asli tidak pernah diubah/dihapus.
 *
 * Status kolom tetap OPEN (CHECK lama); status publik DIBATALKAN diturunkan
 * dari `jurnal_batal_id`.
 */
export function batalPanjarV2(
  db: Database.Database,
  input: BatalPanjarInput,
): HasilPanjar {
  const id = String(input?.id ?? '').trim();
  if (!id) return gagal('Panjar yang akan dibatalkan belum dipilih.');

  const panjar = getPanjar(db, id);
  if (!panjar) return gagal(`Panjar ${id} tidak ditemukan.`);
  if (panjar.jurnal_batal_id)
    return gagal(
      `Panjar ${id} sudah dibatalkan` +
        (panjar.tanggal_batal ? ` pada ${panjar.tanggal_batal}` : '') +
        `. Pembatalan tidak bisa diulang.`,
    );
  if (panjar.status === 'CLOSED')
    return gagal(
      'Panjar ini sudah dipertanggungjawabkan (CLOSED) dan tidak bisa dibatalkan. ' +
        'DB-21 hanya menangani panjar OPEN; koreksi panjar CLOSED perlu alur terpisah.',
    );
  if (panjar.status !== 'OPEN')
    return gagal('Hanya panjar berstatus OPEN yang bisa dibatalkan.');

  const alasan = String(input?.alasan ?? '').trim();
  if (alasan.length < 5)
    return gagal('Alasan pembatalan panjar wajib diisi minimal 5 karakter.');

  const jurnalOpenId = String(panjar.jurnal_open_id ?? '').trim();
  if (!jurnalOpenId)
    return gagal(
      `Panjar ${id} tidak punya jurnal serah (jurnal_open_id kosong), sehingga ` +
        'tidak ada jurnal yang bisa dibalik. Perbaiki data panjar lebih dulu.',
    );

  const detail = getJurnalDetail(db, jurnalOpenId);
  if (!detail)
    return gagal(
      `Jurnal serah ${jurnalOpenId} untuk panjar ${id} tidak ditemukan. ` +
        'Pembatalan dibatalkan agar tidak ada jurnal balik tanpa asli.',
    );

  const tanggalBatal =
    String(input?.tanggalBatal ?? '').trim() || String(panjar.tanggal);
  const jurnalBatalId = String(input?.jurnalId ?? '').trim() || uid('jb');
  const rencana = rencanaReversal({
    jurnal: detail.jurnal,
    baris: detail.baris,
    reversalAda: listJurnal(db, { reversal_of: jurnalOpenId }),
    id: jurnalBatalId,
    tanggal: tanggalBatal,
    alasan,
  });
  if (!rencana.boleh || !rencana.input)
    return gagal(
      rencana.errors.join(' ') ||
        'Jurnal balik pembatalan panjar gagal disusun.',
    );

  const dibatalkan: Panjar = {
    ...panjar,
    status: 'DIBATALKAN',
    jurnal_batal_id: jurnalBatalId,
    tanggal_batal: tanggalBatal,
    alasan_batal: alasan,
  };
  const audit = buatAuditLog(
    `PANJAR-BATAL ${id}`,
    alasan,
    panjar,
    {
      panjar: dibatalkan,
      jurnal: rencana.input.header,
      baris: rencana.input.baris,
      jurnal_batal_id: jurnalBatalId,
      reversal_of: jurnalOpenId,
    },
  );

  try {
    const simpan = db.transaction(() => {
      const hasil = postingJurnal(db, rencana.input!, {
        konfirmasiPeringatan: input.konfirmasiPeringatan === true,
        audit: [audit],
      });
      if (!hasil.tersimpan || !hasil.jurnal) return hasil;

      // Guard status + link batal di WHERE agar dua proses tidak bisa
      // membatalkan/menutup panjar yang sama secara bersamaan.
      const update = db
        .prepare(
          `UPDATE panjar
              SET jurnal_batal_id = ?, tanggal_batal = ?, alasan_batal = ?
            WHERE id = ?
              AND status = 'OPEN'
              AND (jurnal_batal_id IS NULL OR jurnal_batal_id = '')`,
        )
        .run(jurnalBatalId, tanggalBatal, alasan, id);
      if (Number(update.changes) !== 1)
        throw new Error(
          'Panjar sudah dibatalkan atau ditutup oleh proses lain. Muat ulang daftar panjar.',
        );

      return { ...hasil, panjar: dibatalkan };
    });
    return simpan();
  } catch (e) {
    return gagal(
      `Pembatalan panjar gagal disimpan: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Daftar panjar + ringkasan realisasi (dihitung dari item, bukan kolom). */
export function listPanjarV2(
  db: Database.Database,
  status?: StatusPanjar,
): Panjar[] {
  let where = '';
  if (status === 'OPEN')
    where =
      "WHERE p.status = 'OPEN' AND (p.jurnal_batal_id IS NULL OR p.jurnal_batal_id = '')";
  else if (status === 'CLOSED')
    where =
      "WHERE p.status = 'CLOSED' AND (p.jurnal_batal_id IS NULL OR p.jurnal_batal_id = '')";
  else if (status === 'DIBATALKAN')
    where = "WHERE p.jurnal_batal_id IS NOT NULL AND p.jurnal_batal_id <> ''";

  const sql = `
    SELECT p.*, COALESCE(SUM(i.nominal), 0) AS total_realisasi
    FROM panjar p
    LEFT JOIN panjar_item i ON i.panjar_id = p.id
    ${where}
    GROUP BY p.id
    ORDER BY p.tanggal, p.id
  `;
  const rows = db.prepare(sql).all() as RowPanjar[];
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
      `SELECT id, panjar_id, kategori_baga, nominal, jurnal_id,
              nota_nomor, nota_tanggal, toko, keterangan
       FROM panjar_item WHERE panjar_id = ? ORDER BY id`,
    )
    .all(panjarId) as RowPanjar[];
  return rows.map((r) => ({
    id: Number(r.id),
    panjar_id: String(r.panjar_id),
    kategori_baga: String(r.kategori_baga),
    nominal: Number(r.nominal),
    jurnal_id: String(r.jurnal_id),
    nota_nomor: String(r.nota_nomor ?? ''),
    nota_tanggal: String(r.nota_tanggal ?? ''),
    toko: String(r.toko ?? ''),
    keterangan: String(r.keterangan ?? ''),
  }));
}
