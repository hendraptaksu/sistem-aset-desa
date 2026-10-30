// AKT-09 / DB-12: audit integritas akuntansi.
//
// Modul ini hanya MEMBACA database lalu mengembalikan daftar temuan. Tidak ada
// perbaikan otomatis dan tidak ada angka turunan yang disimpan. Temuan bukan
// error: pemanggil (mis. tutup buku, backup, atau restore) yang memutuskan
// menolak operasi. Error SQL tetap dilempar bila database memang tidak bisa
// dibaca.
//
// Saldo kas negatif sengaja TIDAK diperiksa di sini: itu peringatan
// operasional yang sudah ditangani terpisah, bukan kerusakan integritas DB.
//
// DB-12 memperluas pemeriksaan AKT-09 tanpa membuat modul audit kedua:
// - jurnal tanpa baris dibedakan dari jurnal dengan satu baris;
// - pasangan reversal (ganda, reversal atas reversal, grup beda, asli hilang);
// - link panjar OPEN/CLOSED (jurnal open/close, tanggal close, item);
// - validitas tipe/posisi_normal/aktif pada master akun.
// Pemeriksaan lampiran dan anggaran sengaja tidak ada karena tabel/modulnya
// sudah dihapus (DB-33/DB-37/DB-24).

import type Database from 'better-sqlite3';
import { POSISI_NORMAL, type CoaTipe } from './coa.js';
import { formatRp } from '../utils/format.js';

export type KodeTemuan =
  | 'JURNAL_TANPA_BARIS'
  | 'JURNAL_TIDAK_SEIMBANG'
  | 'JURNAL_KURANG_DUA_BARIS'
  | 'REVERSAL_GANDA'
  | 'REVERSAL_ATAS_REVERSAL'
  | 'REVERSAL_TANPA_ASLI'
  | 'REVERSAL_GRUP_BERBEDA'
  | 'AKUN_TIDAK_DIKENAL'
  | 'AKUN_TIPE_TIDAK_VALID'
  | 'AKUN_POSISI_NORMAL_TIDAK_VALID'
  | 'AKUN_POSISI_NORMAL_TIDAK_COCOK'
  | 'AKUN_AKTIF_TIDAK_VALID'
  | 'BARIS_ORPHAN'
  | 'FOREIGN_KEY'
  | 'NOMOR_BUKTI_DUPLIKAT'
  | 'PANJAR_OPEN_TIDAK_LENGKAP'
  | 'PANJAR_CLOSED_TIDAK_LENGKAP'
  | 'PANJAR_OPEN_PUNYA_CLOSE';

/** Satu temuan integritas; `detail` berisi data mentah untuk diagnosis. */
export type Temuan = {
  kode: KodeTemuan;
  pesan: string;
  detail?: unknown;
};

export type HasilAuditIntegritas = {
  /** `true` hanya bila tidak ada temuan sama sekali. */
  ok: boolean;
  temuan: Temuan[];
  /** Ringkasan bahasa Indonesia yang memuat jumlah temuan. */
  ringkasan: string;
};

type BarisJurnal = {
  id: string;
  tanggal: string;
  no_bukti: string;
};

type BarisKurangDua = BarisJurnal & {
  jumlah_baris: number;
};

type BarisTidakSeimbang = {
  id: string;
  tanggal: string;
  no_bukti: string;
  debit: number;
  kredit: number;
};

type BarisAkunAsing = {
  baris_id: number;
  jurnal_id: string;
  akun_kode: string;
};

type BarisOrphan = {
  baris_id: number;
  jurnal_id: string;
};

type PelanggaranFk = {
  table: string;
  rowid: number | null;
  parent: string;
  fkid: number;
};

type NomorBuktiDuplikat = {
  tahun: string;
  no_bukti: string;
  jumlah: number;
};

type ReversalGanda = {
  reversal_of: string;
  jumlah: number;
  ids: string;
};

type ReversalAtasReversal = {
  reversal_id: string;
  reversal_of: string;
  asal_reversal_of: string;
};

type ReversalTanpaAsli = {
  id: string;
  reversal_of: string;
};

type ReversalGrupBerbeda = {
  reversal_id: string;
  reversal_of: string;
  grup_reversal: string;
  grup_asal: string;
};

type PanjarTidakKonsisten = {
  id: string;
  status: string;
  jurnal_open_id: string | null;
  jurnal_close_id: string | null;
  tanggal_close: string | null;
};

type PanjarClosedTidakLengkap = {
  id: string;
  status: string;
  jurnal_close_id: string | null;
  tanggal_close: string | null;
  jumlah_item: number;
};

type AkunTidakValid = {
  kode: string;
  nama: string;
  tipe: string;
  posisi_normal: string;
  aktif: number | string;
  tipe_aktif: string;
};

const DAFTAR_TIPE = Object.keys(POSISI_NORMAL) as CoaTipe[];
const TIPE_DIKENAL = new Set<string>(DAFTAR_TIPE);

/** Pesan daftar tipe valid agar operator/pendamping tahu nilai yang benar. */
const TIPE_VALID_TEKS = DAFTAR_TIPE.join(', ');

/**
 * Audit integritas akuntansi tingkat DB.
 *
 * Pemeriksaan:
 * 1. jurnal tanpa baris sama sekali (`JURNAL_TANPA_BARIS`);
 * 2. total debit = total kredit per jurnal (hanya jurnal yang punya baris);
 * 3. setiap jurnal punya minimal 2 baris (1 baris = `JURNAL_KURANG_DUA_BARIS`);
 * 4. setiap `akun_kode` baris ada di master `akun`;
 * 5. tidak ada baris yatim (`jurnal_id` tanpa kepala jurnal);
 * 6. semua foreign key lolos `PRAGMA foreign_key_check`;
 * 7. nomor bukti unik per tahun (kosong diabaikan);
 * 8. pasangan reversal valid: satu reversal per jurnal asli, asli ada dan
 *    bukan reversal, `grup_id` sama;
 * 9. status panjar konsisten dengan jurnal/tanggal close dan item-nya;
 * 10. master akun memakai tipe/posisi_normal yang valid dan `aktif` 0/1.
 *
 * Hasil selalu deterministik dan tidak mengubah database.
 */
export function auditIntegritas(db: Database.Database): HasilAuditIntegritas {
  const temuan: Temuan[] = [];

  const tanpaBaris = db
    .prepare(
      `SELECT j.id, j.tanggal, j.no_bukti
         FROM jurnal j
         LEFT JOIN jurnal_baris b ON b.jurnal_id = j.id
        GROUP BY j.id
       HAVING COUNT(b.id) = 0
        ORDER BY j.tanggal, j.id`,
    )
    .all() as BarisJurnal[];
  for (const r of tanpaBaris) {
    temuan.push({
      kode: 'JURNAL_TANPA_BARIS',
      pesan:
        `Jurnal ${r.id} tanggal ${r.tanggal} tidak punya baris sama sekali ` +
        `(jurnal tanpa baris).`,
      detail: r,
    });
  }

  const tidakSeimbang = db
    .prepare(
      `SELECT j.id, j.tanggal, j.no_bukti,
              SUM(b.debit) AS debit, SUM(b.kredit) AS kredit
         FROM jurnal j
         JOIN jurnal_baris b ON b.jurnal_id = j.id
        GROUP BY j.id
       HAVING SUM(b.debit) <> SUM(b.kredit)
        ORDER BY j.tanggal, j.id`,
    )
    .all() as BarisTidakSeimbang[];
  for (const r of tidakSeimbang) {
    temuan.push({
      kode: 'JURNAL_TIDAK_SEIMBANG',
      pesan:
        `Jurnal ${r.id} tanggal ${r.tanggal} tidak seimbang: ` +
        `debit ${formatRp(r.debit)} tidak sama dengan kredit ${formatRp(r.kredit)}.`,
      detail: r,
    });
  }

  const kurangDua = db
    .prepare(
      `SELECT j.id, j.tanggal, j.no_bukti, COUNT(b.id) AS jumlah_baris
         FROM jurnal j
         LEFT JOIN jurnal_baris b ON b.jurnal_id = j.id
        GROUP BY j.id
       HAVING COUNT(b.id) > 0 AND COUNT(b.id) < 2
        ORDER BY j.tanggal, j.id`,
    )
    .all() as BarisKurangDua[];
  for (const r of kurangDua) {
    temuan.push({
      kode: 'JURNAL_KURANG_DUA_BARIS',
      pesan:
        `Jurnal ${r.id} tanggal ${r.tanggal} hanya punya ${r.jumlah_baris} baris; ` +
        `minimal 2 baris (debit dan kredit).`,
      detail: r,
    });
  }

  const akunAsing = db
    .prepare(
      `SELECT b.id AS baris_id, b.jurnal_id, b.akun_kode
         FROM jurnal_baris b
         LEFT JOIN akun a ON a.kode = b.akun_kode
        WHERE a.kode IS NULL
        ORDER BY b.id`,
    )
    .all() as BarisAkunAsing[];
  for (const r of akunAsing) {
    temuan.push({
      kode: 'AKUN_TIDAK_DIKENAL',
      pesan:
        `Baris jurnal ${r.baris_id} pada jurnal ${r.jurnal_id} memakai akun ` +
        `${r.akun_kode} yang tidak terdaftar di master akun.`,
      detail: r,
    });
  }

  const barisOrphan = db
    .prepare(
      `SELECT b.id AS baris_id, b.jurnal_id
         FROM jurnal_baris b
         LEFT JOIN jurnal j ON j.id = b.jurnal_id
        WHERE j.id IS NULL
        ORDER BY b.id`,
    )
    .all() as BarisOrphan[];
  for (const r of barisOrphan) {
    temuan.push({
      kode: 'BARIS_ORPHAN',
      pesan:
        `Baris jurnal ${r.baris_id} merujuk jurnal ${r.jurnal_id} ` +
        `yang tidak ada (baris yatim).`,
      detail: r,
    });
  }

  const pelanggaranFk = db.pragma('foreign_key_check') as PelanggaranFk[];
  for (const r of pelanggaranFk) {
    temuan.push({
      kode: 'FOREIGN_KEY',
      pesan:
        `Pelanggaran foreign key: tabel ${r.table} baris ${r.rowid ?? '-'} ` +
        `merujuk tabel ${r.parent} yang tidak punya pasangan.`,
      detail: r,
    });
  }

  const nomorDuplikat = db
    .prepare(
      `SELECT substr(j.tanggal, 1, 4) AS tahun,
              j.no_bukti AS no_bukti,
              COUNT(*) AS jumlah
         FROM jurnal j
        WHERE j.no_bukti <> ''
        GROUP BY substr(j.tanggal, 1, 4), j.no_bukti COLLATE NOCASE
       HAVING COUNT(*) > 1
        ORDER BY tahun, no_bukti`,
    )
    .all() as NomorBuktiDuplikat[];
  for (const r of nomorDuplikat) {
    temuan.push({
      kode: 'NOMOR_BUKTI_DUPLIKAT',
      pesan:
        `Nomor bukti "${r.no_bukti}" dipakai ${r.jumlah} kali pada tahun ${r.tahun}; ` +
        `nomor bukti harus unik per tahun.`,
      detail: r,
    });
  }

  // DB-12: satu jurnal asli hanya boleh punya satu reversal. Unique index v14
  // mencegahnya lewat aplikasi; query ini menangkap korupsi SQL langsung.
  const reversalGanda = db
    .prepare(
      `SELECT reversal_of, COUNT(*) AS jumlah, GROUP_CONCAT(id, ', ') AS ids
         FROM jurnal
        WHERE reversal_of IS NOT NULL AND reversal_of <> ''
        GROUP BY reversal_of
       HAVING COUNT(*) > 1
        ORDER BY reversal_of`,
    )
    .all() as ReversalGanda[];
  for (const r of reversalGanda) {
    temuan.push({
      kode: 'REVERSAL_GANDA',
      pesan:
        `Jurnal ${r.reversal_of} punya ${r.jumlah} jurnal balik (${r.ids}); ` +
        `satu jurnal hanya boleh punya satu reversal.`,
      detail: r,
    });
  }

  const reversalAtasReversal = db
    .prepare(
      `SELECT r.id AS reversal_id, r.reversal_of AS reversal_of,
              a.reversal_of AS asal_reversal_of
         FROM jurnal r
         JOIN jurnal a ON a.id = r.reversal_of
        WHERE r.reversal_of IS NOT NULL AND r.reversal_of <> ''
          AND a.reversal_of IS NOT NULL AND a.reversal_of <> ''
        ORDER BY r.id`,
    )
    .all() as ReversalAtasReversal[];
  for (const r of reversalAtasReversal) {
    temuan.push({
      kode: 'REVERSAL_ATAS_REVERSAL',
      pesan:
        `Jurnal balik ${r.reversal_id} mengacu ke jurnal ${r.reversal_of} ` +
        `yang juga jurnal balik; reversal atas reversal tidak diizinkan.`,
      detail: r,
    });
  }

  const reversalTanpaAsli = db
    .prepare(
      `SELECT r.id, r.reversal_of
         FROM jurnal r
         LEFT JOIN jurnal a ON a.id = r.reversal_of
        WHERE r.reversal_of IS NOT NULL AND r.reversal_of <> ''
          AND a.id IS NULL
        ORDER BY r.id`,
    )
    .all() as ReversalTanpaAsli[];
  for (const r of reversalTanpaAsli) {
    temuan.push({
      kode: 'REVERSAL_TANPA_ASLI',
      pesan: `Jurnal balik ${r.id} mengacu ke jurnal ${r.reversal_of} yang tidak ada.`,
      detail: r,
    });
  }

  const reversalGrupBerbeda = db
    .prepare(
      `SELECT r.id AS reversal_id, r.reversal_of AS reversal_of,
              r.grup_id AS grup_reversal, a.grup_id AS grup_asal
         FROM jurnal r
         JOIN jurnal a ON a.id = r.reversal_of
        WHERE r.reversal_of IS NOT NULL AND r.reversal_of <> ''
          AND r.grup_id <> a.grup_id
        ORDER BY r.id`,
    )
    .all() as ReversalGrupBerbeda[];
  for (const r of reversalGrupBerbeda) {
    temuan.push({
      kode: 'REVERSAL_GRUP_BERBEDA',
      pesan:
        `Jurnal balik ${r.reversal_id} memakai grup "${r.grup_reversal}", ` +
        `berbeda dari grup jurnal asli ${r.reversal_of} ("${r.grup_asal}").`,
      detail: r,
    });
  }

  // DB-12: panjar masih dipakai (DB-18/19/20). Status OPEN wajib punya jurnal
  // serah dan belum punya penutup; CLOSED wajib punya jurnal close, tanggal,
  // dan minimal satu item pertanggungjawaban.
  const panjarOpenTanpaJurnal = db
    .prepare(
      `SELECT id, status, jurnal_open_id, jurnal_close_id, tanggal_close
         FROM panjar
        WHERE status = 'OPEN'
          AND (jurnal_open_id IS NULL OR jurnal_open_id = '')
        ORDER BY id`,
    )
    .all() as PanjarTidakKonsisten[];
  for (const r of panjarOpenTanpaJurnal) {
    temuan.push({
      kode: 'PANJAR_OPEN_TIDAK_LENGKAP',
      pesan: `Panjar ${r.id} berstatus OPEN tetapi jurnal serah (jurnal_open_id) masih kosong.`,
      detail: r,
    });
  }

  const panjarClosed = db
    .prepare(
      `SELECT p.id, p.status, p.jurnal_close_id, p.tanggal_close,
              COUNT(i.id) AS jumlah_item
         FROM panjar p
         LEFT JOIN panjar_item i ON i.panjar_id = p.id
        WHERE p.status = 'CLOSED'
        GROUP BY p.id
       HAVING (p.jurnal_close_id IS NULL OR p.jurnal_close_id = '')
           OR (p.tanggal_close IS NULL OR p.tanggal_close = '')
           OR COUNT(i.id) = 0
        ORDER BY p.id`,
    )
    .all() as PanjarClosedTidakLengkap[];
  for (const r of panjarClosed) {
    const kosong: string[] = [];
    if (!r.jurnal_close_id) kosong.push('jurnal_close_id');
    if (!r.tanggal_close) kosong.push('tanggal_close');
    const tanpaItem = Number(r.jumlah_item) === 0;
    const kosongTeks =
      kosong.length === 0
        ? ''
        : `${kosong.join(' dan ')} masih kosong${tanpaItem ? ' serta belum punya item pertanggungjawaban' : ''}`;
    const pesan = kosongTeks
      ? `Panjar ${r.id} berstatus CLOSED tetapi ${kosongTeks}.`
      : `Panjar ${r.id} berstatus CLOSED tetapi belum punya item pertanggungjawaban.`;
    temuan.push({
      kode: 'PANJAR_CLOSED_TIDAK_LENGKAP',
      pesan,
      detail: r,
    });
  }

  const panjarOpenDenganClose = db
    .prepare(
      `SELECT id, status, jurnal_open_id, jurnal_close_id, tanggal_close
         FROM panjar
        WHERE status = 'OPEN'
          AND (
            (jurnal_close_id IS NOT NULL AND jurnal_close_id <> '')
            OR (tanggal_close IS NOT NULL AND tanggal_close <> '')
          )
        ORDER BY id`,
    )
    .all() as PanjarTidakKonsisten[];
  for (const r of panjarOpenDenganClose) {
    const bagian: string[] = [];
    if (r.jurnal_close_id) bagian.push(`jurnal close ${r.jurnal_close_id}`);
    if (r.tanggal_close) bagian.push(`tanggal close ${r.tanggal_close}`);
    temuan.push({
      kode: 'PANJAR_OPEN_PUNYA_CLOSE',
      pesan: `Panjar ${r.id} berstatus OPEN tetapi sudah punya ${bagian.join(' dan ')}.`,
      detail: r,
    });
  }

  // DB-12: master akun adalah sumber laporan; typo tipe/posisi membuat akun
  // hilang dari Neraca/Laba Rugi. Trigger v15 mencegah lewat aplikasi, audit ini
  // menangkap korupsi SQL langsung (termasuk trigger yang hilang).
  const daftarAkun = db
    .prepare(
      `SELECT kode, nama, tipe, posisi_normal, aktif, typeof(aktif) AS tipe_aktif
         FROM akun
        ORDER BY kode`,
    )
    .all() as AkunTidakValid[];
  for (const a of daftarAkun) {
    if (!TIPE_DIKENAL.has(a.tipe)) {
      temuan.push({
        kode: 'AKUN_TIPE_TIDAK_VALID',
        pesan:
          `Akun ${a.kode} "${a.nama}" memiliki tipe "${a.tipe}" yang tidak dikenal; ` +
          `tipe harus salah satu ${TIPE_VALID_TEKS}.`,
        detail: a,
      });
    }

    const posisiDikenal = a.posisi_normal === 'DEBIT' || a.posisi_normal === 'KREDIT';
    if (!posisiDikenal) {
      temuan.push({
        kode: 'AKUN_POSISI_NORMAL_TIDAK_VALID',
        pesan:
          `Akun ${a.kode} "${a.nama}" memiliki posisi_normal "${a.posisi_normal}" ` +
          `yang tidak valid; harus DEBIT atau KREDIT.`,
        detail: a,
      });
    } else if (TIPE_DIKENAL.has(a.tipe)) {
      const seharusnya = POSISI_NORMAL[a.tipe as CoaTipe];
      if (seharusnya !== a.posisi_normal) {
        temuan.push({
          kode: 'AKUN_POSISI_NORMAL_TIDAK_COCOK',
          pesan:
            `Akun ${a.kode} "${a.nama}" bertipe ${a.tipe} tetapi posisi_normal ` +
            `${a.posisi_normal}; seharusnya ${seharusnya}.`,
          detail: a,
        });
      }
    }

    if (a.tipe_aktif !== 'integer' || (a.aktif !== 0 && a.aktif !== 1)) {
      temuan.push({
        kode: 'AKUN_AKTIF_TIDAK_VALID',
        pesan:
          `Akun ${a.kode} "${a.nama}" memiliki nilai aktif ${String(a.aktif)} ` +
          `(jenis ${a.tipe_aktif}); harus 0 atau 1.`,
        detail: a,
      });
    }
  }

  const ok = temuan.length === 0;
  return {
    ok,
    temuan,
    ringkasan: ok
      ? 'Tidak ada temuan integritas akuntansi.'
      : `Ditemukan ${temuan.length} temuan integritas akuntansi.`,
  };
}

/**
 * DB-12 — bentuk ringkas untuk IPC/pesan: satu baris `KODE: pesan` per temuan.
 * Wrapper tipis di atas `auditIntegritas`; tidak ada pemeriksaan atau tulisan
 * tambahan di sini.
 */
export function auditIntegritasDb(db: Database.Database): string[] {
  return auditIntegritas(db).temuan.map((t) => `${t.kode}: ${t.pesan}`);
}
