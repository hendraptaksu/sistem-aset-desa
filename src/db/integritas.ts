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
// DB-34 menambahkan:
// - jenis jurnal wajib salah satu JENIS_JURNAL;
// - baris reversal wajib cermin persis jurnal asli (akun, nominal, sisi tukar);
// - kode akun 4 digit dan nama tidak kosong (legacy di luar trigger v15);
// - baris jurnal tidak boleh negatif, dua sisi, atau tanpa sisi positif.
// AUD2-08 menambahkan:
// - debit/kredit baris jurnal wajib bertipe INTEGER (bukan REAL/pecahan).
// Pemeriksaan lampiran dan anggaran sengaja tidak ada karena tabel/modulnya
// sudah dihapus (DB-33/DB-37/DB-24).
// DB-16f menambahkan rekonsiliasi outstanding 2050 vs jadwal pinjaman per
// pinjaman. Perbandingan hanya memakai jurnal yang tertaut ke pinjaman itu,
// BUKAN saldo total 2050, karena akun 2050 juga menampung utang non-LPD.
// AUD2-05 menambahkan validasi Saldo Awal 2050 untuk pinjaman berjalan serta
// ringkasan agregat: kredit neto 2050 Buku Besar tidak boleh kurang dari
// outstanding seluruh pinjaman aktif. Kelebihan GL tetap bukan temuan karena
// dapat berasal dari utang non-LPD.
// T-B09 menambahkan temuan `PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS`:
// outstanding pinjaman 0 tetapi masih ada angsuran BELUM/SEBAGIAN (hanya
// mungkin lewat pembayaran pelunasan tanpa `angsuran_id` dari pustaka/SQL).
// Kondisi aneh tetapi tidak merusak GL, jadi temuannya non-blok.
// T-A07 memeriksa konsistensi LAPORAN dan penunjuk pembukaan, bukan hanya
// per-jurnal:
// - Neraca dan Neraca Saldo (mode kumulatif & tahun) dihitung dengan mesin
//   laporan yang sama dengan UI, memakai cutoff jurnal terakhir/hari ini;
// - hubungan `pengaturan.cutover_tanggal` dengan jurnal pembukaan aktif;
// - keberadaan penunjuk pembukaan saat jurnal SALDO_AWAL masih ada;
// - P&L sebelum cut-over di luar grup pembukaan dan P&L di jurnal pembukaan.
// Seluruh pemeriksaan tetap READ-ONLY dan tidak pernah menulis audit log/angka.

import type Database from 'better-sqlite3';
import { JENIS_JURNAL, tanggalKalenderValid } from '../core/posting.js';
import { neraca, neracaSaldo, neracaSaldoPeriode } from '../core/reports.js';
import { AKUN_PANJAR, POSISI_NORMAL, type CoaTipe } from './coa.js';
import { formatRp } from '../utils/format.js';
import { tanggalLokal } from '../utils/tanggal.js';
import { listBarisJurnal } from './laporan.js';
import { rekonsiliasiPanjarTersimpan } from './panjarRekonsiliasi.js';
import {
  getCutoverEksplisit,
  getCutoverTanggal,
  getPembukaanAktif,
} from './pembukaan.js';
// T-B09: kondisi pelunasan tanpa link angsuran dibaca lewat jalur yang sama
// dengan UI (`listPinjaman`) agar temuan memakai outstanding dan status
// angsuran yang persis sama dengan yang dilihat operator. Tidak ada pintu
// tulis di sini; `listPinjaman` murni SELECT.
import { listPinjaman } from './pinjaman.js';
import {
  rekonsiliasiGl2050,
  rekonsiliasiSaldoAwal2050,
  rekonsiliasiSemuaPinjaman,
} from './pinjamanRekonsiliasi.js';
import {
  KUNCI_SALDO_AWAL_AKTIF_ID,
  getPengaturan,
  listAkun,
  listTutupBuku,
} from './repository.js';
import { bandingkanSnapshotTutup } from './tutupSnapshot.js';

export type KodeTemuan =
  | 'JURNAL_TANPA_BARIS'
  | 'JURNAL_TIDAK_SEIMBANG'
  | 'JURNAL_KURANG_DUA_BARIS'
  | 'JURNAL_JENIS_TIDAK_DIKENAL'
  | 'REVERSAL_GANDA'
  | 'REVERSAL_ATAS_REVERSAL'
  | 'REVERSAL_TANPA_ASLI'
  | 'REVERSAL_GRUP_BERBEDA'
  | 'REVERSAL_BARIS_TIDAK_CERMIN'
  | 'AKUN_TIDAK_DIKENAL'
  | 'AKUN_KODE_TIDAK_VALID'
  | 'AKUN_NAMA_KOSONG'
  | 'AKUN_TIPE_TIDAK_VALID'
  | 'AKUN_POSISI_NORMAL_TIDAK_VALID'
  | 'AKUN_POSISI_NORMAL_TIDAK_COCOK'
  | 'AKUN_AKTIF_TIDAK_VALID'
  | 'BARIS_DUA_SISI'
  | 'BARIS_NILAI_NEGATIF'
  | 'BARIS_NILAI_PECAHAN'
  | 'BARIS_TANPA_SISI'
  | 'BARIS_ORPHAN'
  | 'FOREIGN_KEY'
  | 'NOMOR_BUKTI_DUPLIKAT'
  | 'PANJAR_OPEN_TIDAK_LENGKAP'
  | 'PANJAR_CLOSED_TIDAK_LENGKAP'
  | 'PANJAR_OPEN_PUNYA_CLOSE'
  | 'PANJAR_OPEN_PUNYA_ITEM'
  | 'PANJAR_HEADER_TIDAK_COCOK'
  | 'PANJAR_ITEM_TIDAK_COCOK'
  | 'PANJAR_BATAL_TIDAK_LENGKAP'
  | 'PANJAR_BATAL_GANDA'
  | 'PANJAR_BATAL_TIDAK_KONSISTEN'
  | 'PANJAR_OPENING_TIDAK_LENGKAP'
  | 'REKONSILIASI_PANJAR_GL_SELISIH'
  | 'REKONSILIASI_PINJAMAN_SELISIH'
  | 'PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS'
  | 'SNAPSHOT_TUTUP_BERUBAH'
  | 'NERACA_TIDAK_SEIMBANG'
  | 'NERACA_SALDO_SELISIH'
  | 'CUTOVER_TIDAK_KONSISTEN'
  | 'PEMBUKAAN_AKTIF_HILANG'
  | 'LABA_RUGI_SEBELUM_CUTOVER'
  | 'SALDO_AWAL_MEMUAT_LABA_RUGI';

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

type JurnalJenisTidakDikenal = {
  id: string;
  tanggal: string;
  no_bukti: string;
  jenis: string;
};

type NilaiSisi = { debit: number; kredit: number };

type ReversalBarisTidakCermin = {
  reversal_id: string;
  reversal_of: string;
  akun_hilang: string[];
  akun_ekstra: string[];
  akun_nilai_beda: {
    akun: string;
    asli_debit: number;
    asli_kredit: number;
    balik_debit: number;
    balik_kredit: number;
  }[];
  total_debit: number;
  total_kredit: number;
  alasan: string[];
};

type BarisJurnalTidakValid = {
  baris_id: number;
  jurnal_id: string;
  akun_kode: string;
  debit: number;
  kredit: number;
  tipe_debit: string;
  tipe_kredit: string;
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

type PanjarOpenDenganItem = {
  id: string;
  status: string;
  jumlah_item: number;
};

type PanjarHeaderTidakCocok = {
  id: string;
  jurnal_open_id: string;
  tanggal: string;
  tanggal_jurnal: string;
  jumlah: number;
  debit_panjar: number;
  akun_kas_sumber: string;
  akun_kredit: string | null;
  kredit_kas: number;
  alasan: string[];
};

type PanjarItemTidakCocok = {
  id: string;
  jurnal_close_id: string;
  total_item: number;
  total_jurnal: number;
  selisih: number;
  akun_selisih: {
    akun: string;
    total_item: number;
    total_jurnal: number;
    selisih: number;
  }[];
};

type PanjarBatalTidakKonsisten = {
  id: string;
  status: string;
  jurnal_open_id: string | null;
  jurnal_batal_id: string | null;
  tanggal_batal: string | null;
  alasan_batal: string;
  jurnal_close_id: string | null;
  tanggal_close: string | null;
  jumlah_item: number;
  batal_jenis: string | null;
  batal_reversal_of: string | null;
  alasan: string[];
};

type PanjarBatalGanda = {
  jurnal_batal_id: string;
  jumlah: number;
  ids: string;
};

type PanjarOpeningTidakLengkap = {
  id?: string;
  jurnal_open_id: string;
  status?: string;
  jumlah?: number;
  debit_neto?: number;
  peran?: string | null;
  alasan: string[];
};

type RekonsiliasiPanjarGlSelisih = {
  akun: string;
  saldo_gl: number;
  total_panjar: number;
  selisih: number;
};

type AkunTidakValid = {
  kode: string;
  nama: string;
  tipe: string;
  posisi_normal: string;
  aktif: number | string;
  tipe_aktif: string;
};

type NeracaTidakSeimbang = {
  cutoff: string;
  total_aset: number;
  total_pasiva: number;
  selisih: number;
};

type NeracaSaldoSelisih = {
  mode: 'kumulatif' | 'tahun';
  cutoff: string;
  total_debit: number;
  total_kredit: number;
  selisih: number;
};

type CutoverTidakKonsisten = {
  cutover_tanggal: string;
  pembukaan_id: string;
  tanggal_pembukaan: string;
};

type PembukaanAktifHilang = {
  penunjuk: string | null;
  jurnal_saldo_awal: string[];
  alasan: string;
};

type LabaRugiSebelumCutover = {
  cutover_tanggal: string;
  jurnal_id: string;
  tanggal: string;
  grup_id: string;
  akun_kode: string;
  tipe: string;
  debit: number;
  kredit: number;
};

type SaldoAwalMemuatLabaRugi = {
  jurnal_id: string;
  tanggal: string;
  akun: { akun_kode: string; tipe: string; debit: number; kredit: number }[];
};

const DAFTAR_TIPE = Object.keys(POSISI_NORMAL) as CoaTipe[];
const TIPE_DIKENAL = new Set<string>(DAFTAR_TIPE);

/** Pesan daftar tipe valid agar operator/pendamping tahu nilai yang benar. */
const TIPE_VALID_TEKS = DAFTAR_TIPE.join(', ');

const JENIS_DIKENAL = new Set<string>(JENIS_JURNAL);

/** Nama jenis resmi untuk pesan temuan. */
const JENIS_VALID_TEKS = JENIS_JURNAL.join(', ');

/**
 * Pemeriksaan tabel opsional. Backup lama (v2/v3) belum tentu punya tabel
 * panjar; bentuk panjar pra-v4 juga tidak punya kolom link jurnal. Audit tidak
 * boleh gagal hanya karena tabel/kolom itu belum ada.
 */
function tabelAda(db: Database.Database, nama: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(nama),
  );
}

function kolomTabel(db: Database.Database, nama: string): Set<string> {
  return new Set(
    (db.pragma(`table_info(${nama})`) as { name: string }[]).map((k) => k.name),
  );
}

function punyaSemuaKolom(kolom: Set<string>, wajib: readonly string[]): boolean {
  return wajib.every((k) => kolom.has(k));
}

/** Tanggal jurnal terakhir, atau `null` bila belum ada jurnal bertanggal sah. */
function tanggalJurnalTerakhir(db: Database.Database): string | null {
  const row = db.prepare('SELECT MAX(tanggal) AS terakhir FROM jurnal').get() as
    | { terakhir: string | null }
    | undefined;
  const teks = String(row?.terakhir ?? '').trim();
  return tanggalKalenderValid(teks) ? teks : null;
}

/** ID seluruh jurnal SALDO_AWAL (urut insert) untuk pemeriksaan penunjuk. */
function daftarJurnalSaldoAwal(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT id FROM jurnal WHERE jenis = 'SALDO_AWAL' ORDER BY rowid")
      .all() as { id: string }[]
  ).map((r) => String(r.id));
}

/**
 * Grup jurnal pembukaan: grup jurnal pembukaan aktif bila ada, fallback ke
 * grup SALDO_AWAL pertama. Dipakai untuk mengecualikan baris pembukaan dari
 * pemeriksaan P&L pra-cut-over.
 */
function grupPembukaan(
  db: Database.Database,
  pembukaanId: string | null,
): string | null {
  const bacaGrup = (idJurnal: string): string | null => {
    const row = db
      .prepare('SELECT grup_id FROM jurnal WHERE id = ?')
      .get(idJurnal) as { grup_id: string | null } | undefined;
    if (!row) return null;
    const grup = String(row.grup_id ?? '').trim();
    return grup || idJurnal;
  };

  if (pembukaanId) return bacaGrup(pembukaanId);
  const awal = db
    .prepare("SELECT id FROM jurnal WHERE jenis = 'SALDO_AWAL' ORDER BY rowid LIMIT 1")
    .get() as { id: string } | undefined;
  return awal ? bacaGrup(String(awal.id)) : null;
}

/**
 * Alasan penunjuk `saldo_awal_aktif_id` tidak menunjuk jurnal pembukaan yang
 * masih aktif; `null` berarti penunjuk sah. Pemeriksaan ini sengaja tidak
 * memakai `MIN(tanggal)`/tebakan grup: hanya relasi eksplisit yang dinilai.
 */
function alasanPembukaanTidakAktif(
  db: Database.Database,
  penunjuk: string,
): string | null {
  if (!penunjuk) return 'penunjuk jurnal saldo awal masih kosong';
  const row = db
    .prepare('SELECT id, tanggal, peran FROM jurnal WHERE id = ?')
    .get(penunjuk) as
    | { id: string; tanggal: string; peran: string | null }
    | undefined;
  if (!row) return 'jurnal saldo awal yang ditunjuk sudah tidak ada';
  if (!tanggalKalenderValid(String(row.tanggal ?? '')))
    return 'jurnal saldo awal tidak punya tanggal yang valid';

  const peran = String(row.peran ?? 'NORMAL');
  if (peran !== 'OPENING' && peran !== 'OPENING_REPLACEMENT')
    return 'jurnal yang ditunjuk bukan jurnal saldo awal yang aktif';

  const balik = db
    .prepare('SELECT id FROM jurnal WHERE reversal_of = ? ORDER BY rowid LIMIT 1')
    .get(penunjuk) as { id: string } | undefined;
  if (balik) return 'jurnal saldo awal yang ditunjuk sudah dibalik';

  const pengganti = db
    .prepare('SELECT id FROM jurnal WHERE replaces_id = ? ORDER BY rowid LIMIT 1')
    .get(penunjuk) as { id: string } | undefined;
  if (pengganti)
    return `jurnal ${penunjuk} sudah digantikan oleh ${String(pengganti.id)}`;

  return null;
}

/** Agregat debit/kredit per akun; baris ganda dijumlahkan agar tidak false positive. */
function petaSisiJurnal(
  db: Database.Database,
  jurnalId: string,
): Map<string, NilaiSisi> {
  const rows = db
    .prepare(
      `SELECT akun_kode, SUM(debit) AS debit, SUM(kredit) AS kredit
         FROM jurnal_baris
        WHERE jurnal_id = ?
        GROUP BY akun_kode
        ORDER BY akun_kode`,
    )
    .all(jurnalId) as { akun_kode: string; debit: number; kredit: number }[];
  return new Map(
    rows.map((r) => [
      r.akun_kode,
      { debit: Number(r.debit), kredit: Number(r.kredit) },
    ]),
  );
}

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
 *    bukan reversal, `grup_id` sama, dan baris cermin persis (akun/nominal
 *    sama dengan debit/kredit tertukar, total seimbang, tidak kosong);
 * 9. status panjar konsisten dengan jurnal/tanggal close dan item-nya (OPEN
 *    tanpa close/item, CLOSED punya jurnal close/tanggal/item);
 * 10. DB-20: header `panjar` (tanggal, jumlah, akun_kas_sumber) sama dengan
 *     jurnal serah;
 * 11. DB-19: total `panjar_item` per akun BEBAN sama dengan debit BEBAN jurnal
 *     close (helper yang sama dengan `closePanjarV2`);
 * 12. DB-21: panjar yang dibatalkan punya jurnal balik REVERSAL yang valid,
 *     tanggal/alasan, tetap tersimpan OPEN, tanpa close/item; link batal
 *     yatim/duplikat dilaporkan;
 * 13. master akun memakai tipe/posisi_normal yang valid dan `aktif` 0/1;
 * 14. DB-34: `jurnal.jenis` wajib salah satu `JENIS_JURNAL`;
 * 15. DB-34/AUD2-08: baris `jurnal_baris` bertipe INTEGER, tidak negatif,
 *     tidak mengisi dua sisi, dan punya tepat satu sisi positif;
 * 16. DB-34: kode akun tepat 4 digit dan nama tidak kosong (legacy);
 * 17. DB-16f: outstanding 2050 yang tertaut ke pinjaman sama dengan outstanding
 *     jadwal (selisih != 0 menjadi temuan, tanpa koreksi otomatis);
 * 18. AUD2-04: saldo normal debit 1040 di Buku Besar sama dengan total panjar
 *     OPEN aktif (selisih != 0 menjadi REKONSILIASI_PANJAR_GL_SELISIH);
 * 19. T-A07: Neraca pada cutoff jurnal terakhir/hari ini seimbang
 *     (`NERACA_TIDAK_SEIMBANG`);
 * 20. T-A07: Neraca Saldo mode kumulatif dan tahun seimbang
 *     (`NERACA_SALDO_SELISIH` per mode);
 * 21. T-A07: `cutover_tanggal` sama dengan tanggal pembukaan aktif
 *     (`CUTOVER_TIDAK_KONSISTEN`);
 * 22. T-A07: ada SALDO_AWAL tetapi penunjuk pembukaan aktif kosong/tidak sah
 *     (`PEMBUKAAN_AKTIF_HILANG`);
 * 23. T-A07: P&L sebelum cut-over di luar grup pembukaan
 *     (`LABA_RUGI_SEBELUM_CUTOVER`);
 * 24. T-A07: jurnal pembukaan memuat PENDAPATAN/BEBAN
 *     (`SALDO_AWAL_MEMUAT_LABA_RUGI`);
 * 25. T-A06: snapshot tutup buku berbeda dari data live
 *     (`SNAPSHOT_TUTUP_BERUBAH`, temuan kontrol, tidak memblokir TUTUP-ULANG).
 *
 * Pemeriksaan panjar dan pinjaman dilewati dengan aman bila tabel/kolom belum
 * ada (backup v2/v3, atau backup lama sebelum tabel pinjaman v20). Pemeriksaan
 * laporan juga tidak melempar error bila laporan tidak bisa dihitung; temuan
 * struktural lain sudah melaporkan penyebabnya.
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
        `Jurnal ${r.no_bukti || 'tanpa nomor bukti'} tanggal ${r.tanggal} tidak punya baris sama sekali ` +
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
        `Jurnal ${r.no_bukti || 'tanpa nomor bukti'} tanggal ${r.tanggal} tidak seimbang: ` +
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
        `Jurnal ${r.no_bukti || 'tanpa nomor bukti'} tanggal ${r.tanggal} hanya punya ${r.jumlah_baris} baris; ` +
        `minimal 2 baris (debit dan kredit).`,
      detail: r,
    });
  }

  // DB-34: trigger v14 menolak jenis di luar JENIS_JURNAL lewat aplikasi. Audit
  // tetap memeriksa DB legacy/korupsi SQL langsung, termasuk saat trigger hilang.
  const jenisTidakDikenal = (
    db
      .prepare(
        `SELECT id, tanggal, no_bukti, jenis
           FROM jurnal
          ORDER BY tanggal, id`,
      )
      .all() as JurnalJenisTidakDikenal[]
  ).filter((r) => !JENIS_DIKENAL.has(String(r.jenis)));
  for (const r of jenisTidakDikenal) {
    temuan.push({
      kode: 'JURNAL_JENIS_TIDAK_DIKENAL',
      pesan:
        `Jurnal ${r.no_bukti || 'tanpa nomor bukti'} tanggal ${r.tanggal} memakai jenis "${String(r.jenis)}" ` +
        `yang tidak dikenal; jenis harus salah satu ${JENIS_VALID_TEKS}.`,
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
        `Ada baris jurnal dengan akun ${r.akun_kode} yang tidak terdaftar di ` +
        `Daftar Akun.`,
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
        `Ada baris jurnal yang merujuk jurnal yang tidak ada (baris yatim).`,
      detail: r,
    });
  }

  // DB-34: CHECK/trigger v9 mencegah nilai negatif dan dua sisi positif lewat
  // aplikasi. AUD2-08: trigger juga menolak nilai REAL/pecahan, tetapi audit
  // tetap memeriksa legacy/korupsi SQL langsung (termasuk saat trigger hilang).
  // Setiap baris hanya menghasilkan satu kode agar diagnosis tidak berulang:
  // pecahan lebih dulu, lalu negatif, lalu dua sisi, lalu tidak punya sisi.
  const barisTidakValid = db
    .prepare(
      `SELECT id AS baris_id, jurnal_id, akun_kode, debit, kredit,
              typeof(debit) AS tipe_debit, typeof(kredit) AS tipe_kredit
         FROM jurnal_baris
        WHERE typeof(debit) <> 'integer' OR typeof(kredit) <> 'integer'
           OR debit < 0 OR kredit < 0
           OR (debit > 0 AND kredit > 0)
           OR NOT (debit > 0 OR kredit > 0)
        ORDER BY id`,
    )
    .all() as BarisJurnalTidakValid[];
  for (const r of barisTidakValid) {
    const debit = Number(r.debit);
    const kredit = Number(r.kredit);
    const pecahan = r.tipe_debit !== 'integer' || r.tipe_kredit !== 'integer';
    const negatif = debit < 0 || kredit < 0;
    const duaSisi = debit > 0 && kredit > 0;
    const kode = pecahan
      ? 'BARIS_NILAI_PECAHAN'
      : negatif
        ? 'BARIS_NILAI_NEGATIF'
        : duaSisi
          ? 'BARIS_DUA_SISI'
          : 'BARIS_TANPA_SISI';
    const pesan = pecahan
      ? `Baris jurnal pada akun ${r.akun_kode} punya nilai pecahan ` +
        `(debit ${String(debit)}, kredit ${String(kredit)}); debit dan kredit ` +
        `wajib bilangan bulat rupiah.`
      : negatif
        ? `Baris jurnal pada akun ${r.akun_kode} punya nilai negatif ` +
          `(debit ${formatRp(debit)}, kredit ${formatRp(kredit)}); nilai tidak boleh negatif.`
        : duaSisi
          ? `Baris jurnal pada akun ${r.akun_kode} mengisi debit dan kredit ` +
            `sekaligus (${formatRp(debit)} dan ${formatRp(kredit)}); isi salah satu sisi saja.`
          : `Baris jurnal pada akun ${r.akun_kode} tidak punya sisi positif ` +
            `(debit ${formatRp(debit)}, kredit ${formatRp(kredit)}); isi tepat satu sisi.`;
    temuan.push({ kode, pesan, detail: r });
  }

  const pelanggaranFk = db.pragma('foreign_key_check') as PelanggaranFk[];
  for (const r of pelanggaranFk) {
    temuan.push({
      kode: 'FOREIGN_KEY',
      pesan:
        `Pelanggaran keterkaitan data: isi tabel ${r.table} merujuk tabel ` +
        `${r.parent} yang tidak punya pasangan.`,
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
        `Ada jurnal dengan ${r.jumlah} jurnal balik; satu jurnal hanya boleh ` +
        `punya satu jurnal balik.`,
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
        `Ada jurnal balik yang mengacu ke jurnal balik lain; jurnal balik atas ` +
        `jurnal balik tidak diizinkan.`,
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
      pesan: `Ada jurnal balik yang mengacu ke jurnal asli yang tidak ada.`,
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
        `Ada jurnal balik yang memakai grup berbeda dari jurnal aslinya.`,
      detail: r,
    });
  }

  // DB-34: reversal adalah satu-satunya jalur koreksi, jadi barisnya wajib
  // cermin persis jurnal asli. Debit/kredit dipertukarkan, akun dan nominal
  // sama, urutan bebas, dan baris ganda per akun dijumlahkan lebih dulu.
  // Jurnal asli yang hilang sudah dilaporkan REVERSAL_TANPA_ASLI, jadi di sini
  // hanya pasangan yang benar-benar ada yang dibandingkan.
  const pasanganReversal = db
    .prepare(
      `SELECT r.id AS reversal_id, r.reversal_of AS reversal_of
         FROM jurnal r
         JOIN jurnal a ON a.id = r.reversal_of
        WHERE r.reversal_of IS NOT NULL AND r.reversal_of <> ''
        ORDER BY r.id`,
    )
    .all() as { reversal_id: string; reversal_of: string }[];
  for (const pasangan of pasanganReversal) {
    const asli = petaSisiJurnal(db, pasangan.reversal_of);
    const balik = petaSisiJurnal(db, pasangan.reversal_id);
    const alasan: string[] = [];
    if (asli.size === 0) alasan.push('jurnal asli tidak punya baris');
    if (balik.size === 0) alasan.push('jurnal balik tidak punya baris');

    const akunHilang = [...asli.keys()].filter((akun) => !balik.has(akun)).sort();
    const akunEkstra = [...balik.keys()].filter((akun) => !asli.has(akun)).sort();
    if (akunHilang.length > 0)
      alasan.push(`akun tidak ada di jurnal balik: ${akunHilang.join(', ')}`);
    if (akunEkstra.length > 0)
      alasan.push(`akun ekstra di jurnal balik: ${akunEkstra.join(', ')}`);

    const akunNilaiBeda: ReversalBarisTidakCermin['akun_nilai_beda'] = [];
    for (const akun of [...asli.keys()].filter((k) => balik.has(k)).sort()) {
      const a = asli.get(akun)!;
      const b = balik.get(akun)!;
      if (b.debit !== a.kredit || b.kredit !== a.debit) {
        akunNilaiBeda.push({
          akun,
          asli_debit: a.debit,
          asli_kredit: a.kredit,
          balik_debit: b.debit,
          balik_kredit: b.kredit,
        });
      }
    }
    for (const beda of akunNilaiBeda) {
      alasan.push(
        `akun ${beda.akun}: asli D ${formatRp(beda.asli_debit)} / K ` +
          `${formatRp(beda.asli_kredit)} vs balik D ${formatRp(beda.balik_debit)} / K ` +
          `${formatRp(beda.balik_kredit)}`,
      );
    }

    let totalDebit = 0;
    let totalKredit = 0;
    for (const nilai of balik.values()) {
      totalDebit += nilai.debit;
      totalKredit += nilai.kredit;
    }
    if (totalDebit !== totalKredit) {
      alasan.push(
        `total debit ${formatRp(totalDebit)} tidak sama dengan total kredit ` +
          `${formatRp(totalKredit)}`,
      );
    }
    if (alasan.length === 0) continue;

    const detail: ReversalBarisTidakCermin = {
      reversal_id: pasangan.reversal_id,
      reversal_of: pasangan.reversal_of,
      akun_hilang: akunHilang,
      akun_ekstra: akunEkstra,
      akun_nilai_beda: akunNilaiBeda,
      total_debit: totalDebit,
      total_kredit: totalKredit,
      alasan,
    };
    temuan.push({
      kode: 'REVERSAL_BARIS_TIDAK_CERMIN',
      pesan:
        `Jurnal balik ${pasangan.reversal_id} tidak mencerminkan jurnal asli ` +
        `${pasangan.reversal_of}: ${alasan.join('; ')}.`,
      detail,
    });
  }

  // DB-12: panjar masih dipakai (DB-18/19/20). Status OPEN wajib punya jurnal
  // serah dan belum punya penutup; CLOSED wajib punya jurnal close, tanggal,
  // dan minimal satu item pertanggungjawaban.
  //
  // DB-34: backup lama v2/v3 belum punya tabel panjar, dan panjar bentuk
  // pra-v4 tidak punya kolom link jurnal. Pemeriksaan panjar dilewati bila
  // tabel/kolom belum lengkap; tabel legacy tetap utuh dan tidak dianggap rusak.
  const adaTabelPanjar = tabelAda(db, 'panjar');
  const kolomPanjar = adaTabelPanjar ? kolomTabel(db, 'panjar') : new Set<string>();
  const panjarV2 =
    adaTabelPanjar &&
    punyaSemuaKolom(kolomPanjar, [
      'id',
      'status',
      'tanggal',
      'jumlah',
      'akun_kas_sumber',
      'jurnal_open_id',
      'jurnal_close_id',
      'tanggal_close',
    ]);
  const panjarItemV2 =
    tabelAda(db, 'panjar_item') &&
    punyaSemuaKolom(kolomTabel(db, 'panjar_item'), [
      'panjar_id',
      'kategori_baga',
      'nominal',
      'jurnal_id',
    ]);
  const panjarLengkap = panjarV2 && panjarItemV2;
  // T-A11: dokumen opening hanya bisa diperiksa bila kolom `sumber` ada.
  // Backup/DB lama tanpa kolom ini tidak dianggap rusak.
  const panjarSumberSiap = panjarV2 && kolomPanjar.has('sumber');
  // Baris legacy yang dibatalkan masih berstatus OPEN tetapi punya
  // jurnal_batal_id. Jangan perlakukan sebagai panjar OPEN aktif.
  const filterBatal = kolomPanjar.has('jurnal_batal_id')
    ? " AND (jurnal_batal_id IS NULL OR jurnal_batal_id = '')"
    : '';
  const filterBatalP = kolomPanjar.has('jurnal_batal_id')
    ? " AND (p.jurnal_batal_id IS NULL OR p.jurnal_batal_id = '')"
    : '';

  const panjarOpenTanpaJurnal = panjarV2
    ? (db
        .prepare(
          `SELECT id, status, jurnal_open_id, jurnal_close_id, tanggal_close
             FROM panjar
            WHERE status = 'OPEN'${filterBatal}
              AND (jurnal_open_id IS NULL OR jurnal_open_id = '')
            ORDER BY id`,
        )
        .all() as PanjarTidakKonsisten[])
    : [];
  for (const r of panjarOpenTanpaJurnal) {
    temuan.push({
      kode: 'PANJAR_OPEN_TIDAK_LENGKAP',
      pesan: `Ada panjar berstatus Terbuka tetapi jurnal serahnya masih kosong.`,
      detail: r,
    });
  }

  const panjarClosed = panjarLengkap
    ? (db
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
        .all() as PanjarClosedTidakLengkap[])
    : [];
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
      ? `Ada panjar berstatus Selesai tetapi ${kosongTeks}.`
      : `Ada panjar berstatus Selesai tetapi belum punya item pertanggungjawaban.`;
    temuan.push({
      kode: 'PANJAR_CLOSED_TIDAK_LENGKAP',
      pesan,
      detail: r,
    });
  }

  const panjarOpenDenganClose = panjarV2
    ? (db
        .prepare(
          `SELECT id, status, jurnal_open_id, jurnal_close_id, tanggal_close
             FROM panjar
            WHERE status = 'OPEN'${filterBatal}
              AND (
                (jurnal_close_id IS NOT NULL AND jurnal_close_id <> '')
                OR (tanggal_close IS NOT NULL AND tanggal_close <> '')
              )
            ORDER BY id`,
        )
        .all() as PanjarTidakKonsisten[])
    : [];
  for (const r of panjarOpenDenganClose) {
    const bagian: string[] = [];
    if (r.jurnal_close_id) bagian.push('jurnal penutup');
    if (r.tanggal_close) bagian.push('tanggal penutupan');
    temuan.push({
      kode: 'PANJAR_OPEN_PUNYA_CLOSE',
      pesan: `Ada panjar berstatus Terbuka tetapi sudah punya ${bagian.join(' dan ')}.`,
      detail: r,
    });
  }

  // DB-19: panjar OPEN belum boleh punya item pertanggungjawaban. Item hanya
  // ditulis saat close, jadi adanya item berarti drift/duplikasi data.
  const panjarOpenDenganItem = panjarLengkap
    ? (db
        .prepare(
          `SELECT p.id, p.status, COUNT(i.id) AS jumlah_item
             FROM panjar p
             JOIN panjar_item i ON i.panjar_id = p.id
            WHERE p.status = 'OPEN'${filterBatalP}
            GROUP BY p.id
           HAVING COUNT(i.id) > 0
            ORDER BY p.id`,
        )
        .all() as PanjarOpenDenganItem[])
    : [];
  for (const r of panjarOpenDenganItem) {
    temuan.push({
      kode: 'PANJAR_OPEN_PUNYA_ITEM',
      pesan:
        `Ada panjar berstatus Terbuka tetapi sudah punya ${r.jumlah_item} rincian ` +
        `pertanggungjawaban; rincian hanya boleh ada setelah panjar ditutup.`,
      detail: r,
    });
  }

  // DB-21/AUD2-09: panjar yang dibatalkan wajib punya jurnal balik yang valid,
  // tanggal dan alasan, status tersimpan DIBATALKAN (baris legacy OPEN tetap
  // diterima), serta tidak punya close/item. Tautan yatim/duplikat dan status
  // yang tidak konsisten dilaporkan tanpa perbaikan otomatis. Panjar OPEN
  // non-batal tetap memakai pemeriksaan lama di atas.
  //
  // Audit juga dipakai untuk memvalidasi kandidat backup. Bagian batal
  // dilewati bila kolomnya belum lengkap (bukan error) agar audit tetap aman
  // pada file yang belum memiliki metadata pembatalan.
  const adaKolomBatal =
    panjarLengkap &&
    ['jurnal_batal_id', 'tanggal_batal', 'alasan_batal'].every((k) =>
      kolomPanjar.has(k),
    );
  const panjarBatal = adaKolomBatal
    ? (db
        .prepare(
          `SELECT p.id, p.status, p.jurnal_open_id, p.jurnal_batal_id,
                  p.tanggal_batal, p.alasan_batal, p.jurnal_close_id,
                  p.tanggal_close,
                  COUNT(i.id) AS jumlah_item,
                  j.jenis AS batal_jenis,
                  j.reversal_of AS batal_reversal_of
             FROM panjar p
             LEFT JOIN jurnal j ON j.id = p.jurnal_batal_id
             LEFT JOIN panjar_item i ON i.panjar_id = p.id
            WHERE p.jurnal_batal_id IS NOT NULL AND p.jurnal_batal_id <> ''
            GROUP BY p.id
            ORDER BY p.id`,
        )
        .all() as Omit<PanjarBatalTidakKonsisten, 'alasan'>[])
    : [];
  for (const r of panjarBatal) {
    const alasan: string[] = [];
    if (!r.batal_jenis) {
      alasan.push('jurnal balik tidak ditemukan');
    } else {
      if (r.batal_jenis !== 'REVERSAL')
        alasan.push('jurnal balik bukan jurnal koreksi');
      if (r.batal_reversal_of !== r.jurnal_open_id)
        alasan.push('jurnal balik tidak membalik jurnal serah');
    }
    if (!r.tanggal_batal)
      alasan.push('tanggal pembatalan masih kosong');
    if (String(r.alasan_batal ?? '').trim().length < 5)
      alasan.push('alasan pembatalan kurang dari 5 karakter');
    if (r.status !== 'OPEN' && r.status !== 'DIBATALKAN')
      alasan.push('status panjar tidak sesuai');
    if (r.jurnal_close_id)
      alasan.push('masih punya jurnal penutup');
    if (r.tanggal_close)
      alasan.push('masih punya tanggal penutupan');
    if (Number(r.jumlah_item) > 0)
      alasan.push(`masih punya ${r.jumlah_item} rincian pertanggungjawaban`);
    if (alasan.length === 0) continue;

    if (!r.batal_jenis) {
      temuan.push({
        kode: 'PANJAR_BATAL_TIDAK_LENGKAP',
        pesan:
          `Ada panjar yang dibatalkan tetapi jurnal baliknya tidak ditemukan.`,
        detail: { ...r, alasan },
      });
      continue;
    }
    temuan.push({
      kode: 'PANJAR_BATAL_TIDAK_KONSISTEN',
      pesan: `Ada panjar yang dibatalkan tidak konsisten: ${alasan.join('; ')}.`,
      detail: { ...r, alasan },
    });
  }

  const panjarBatalGanda = adaKolomBatal
    ? (db
        .prepare(
          `SELECT jurnal_batal_id, COUNT(*) AS jumlah, GROUP_CONCAT(id, ', ') AS ids
             FROM panjar
            WHERE jurnal_batal_id IS NOT NULL AND jurnal_batal_id <> ''
            GROUP BY jurnal_batal_id
           HAVING COUNT(*) > 1
            ORDER BY jurnal_batal_id`,
        )
        .all() as PanjarBatalGanda[])
    : [];
  for (const r of panjarBatalGanda) {
    temuan.push({
      kode: 'PANJAR_BATAL_GANDA',
      pesan:
        `Satu jurnal batal dipakai ${r.jumlah} panjar; ` +
        `satu jurnal batal hanya boleh dipakai satu dokumen panjar.`,
      detail: r,
    });
  }

  // DB-20: header panjar adalah cermin jurnal serah, bukan sumber angka kedua.
  // Tanggal/jumlah/akun kas harus sama dengan jurnal open. Jurnal yang hilang
  // sudah dilaporkan lewat FK/PANJAR_OPEN_TIDAK_LENGKAP, jadi query ini hanya
  // memeriksa panjar yang tautan jurnal serahnya benar-benar ada.
  const selectSumberPanjar = panjarSumberSiap ? 'p.sumber' : "'NORMAL'";
  const panjarHeader = panjarV2
    ? (db
        .prepare(
      `SELECT p.id, ${selectSumberPanjar} AS sumber,
              p.tanggal, p.jumlah, p.akun_kas_sumber, p.jurnal_open_id,
              j.tanggal AS tanggal_jurnal,
              COALESCE((
                SELECT SUM(b.debit)
                  FROM jurnal_baris b
                 WHERE b.jurnal_id = p.jurnal_open_id
                   AND b.akun_kode = '${AKUN_PANJAR}'
              ), 0) AS debit_panjar,
              COALESCE((
                SELECT SUM(b.kredit)
                  FROM jurnal_baris b
                 WHERE b.jurnal_id = p.jurnal_open_id
                   AND b.akun_kode = p.akun_kas_sumber
              ), 0) AS kredit_kas,
              (
                SELECT GROUP_CONCAT(DISTINCT b.akun_kode)
                  FROM jurnal_baris b
                 WHERE b.jurnal_id = p.jurnal_open_id
                   AND b.kredit > 0
                   AND b.akun_kode <> '${AKUN_PANJAR}'
              ) AS akun_kredit
         FROM panjar p
         JOIN jurnal j ON j.id = p.jurnal_open_id
        ORDER BY p.id`,
    )
    .all() as {
    id: string;
    sumber: string;
    tanggal: string;
    jumlah: number;
    akun_kas_sumber: string;
    jurnal_open_id: string;
    tanggal_jurnal: string;
    debit_panjar: number;
    kredit_kas: number;
    akun_kredit: string | null;
  }[])
    : [];
  for (const r of panjarHeader) {
    const jumlah = Number(r.jumlah);
    const debitPanjar = Number(r.debit_panjar);
    const kreditKas = Number(r.kredit_kas);
    const alasan: string[] = [];
    if (r.tanggal !== r.tanggal_jurnal)
      alasan.push(`tanggal header ${r.tanggal} vs jurnal ${r.tanggal_jurnal}`);
    if (jumlah !== debitPanjar)
      alasan.push(
        `jumlah header ${formatRp(jumlah)} vs debit ${AKUN_PANJAR} jurnal ` +
          `${formatRp(debitPanjar)}`,
      );
    // T-A11: jurnal pembukaan tidak selalu mengkredit kas sumber; bisa
    // dikredit modal/akun neraca lain. Untuk SALDO_AWAL, `akun_kas_sumber`
    // hanya tujuan pengembalian sisa saat close, jadi jangan dibandingkan
    // dengan kredit jurnal pembukaan. Jumlah vs debit 1040 tetap diperiksa.
    if (
      r.sumber !== 'SALDO_AWAL' &&
      (r.akun_kredit !== r.akun_kas_sumber || kreditKas !== jumlah)
    )
      alasan.push(
        `akun kas header ${r.akun_kas_sumber} (${formatRp(jumlah)}) vs kredit ` +
          `jurnal ${r.akun_kredit ?? '-'} (${formatRp(kreditKas)})`,
      );
    if (alasan.length === 0) continue;
    const detail: PanjarHeaderTidakCocok = {
      id: r.id,
      jurnal_open_id: r.jurnal_open_id,
      tanggal: r.tanggal,
      tanggal_jurnal: r.tanggal_jurnal,
      jumlah,
      debit_panjar: debitPanjar,
      akun_kas_sumber: r.akun_kas_sumber,
      akun_kredit: r.akun_kredit,
      kredit_kas: kreditKas,
      alasan,
    };
    temuan.push({
      kode: 'PANJAR_HEADER_TIDAK_COCOK',
      pesan:
        `Ada panjar yang header-nya tidak cocok dengan jurnal serah: ${alasan.join('; ')}.`,
      detail,
    });
  }

  // T-A11: dokumen panjar `SALDO_AWAL` adalah representasi bagian 1040 yang
  // sudah ada di jurnal pembukaan, bukan jurnal serah kedua. Periksa
  // konsistensi dokumennya saja; kasus 1040 pembukaan TANPA dokumen opening
  // tetap menjadi tanggung jawab REKONSILIASI_PANJAR_GL_SELISIH di bawah agar
  // tidak ada temuan ganda.
  if (panjarSumberSiap) {
    const openingRows = db
      .prepare(
        `SELECT p.id, p.status, p.jumlah, p.jurnal_open_id, p.jurnal_batal_id,
                j.peran
           FROM panjar p
           LEFT JOIN jurnal j ON j.id = p.jurnal_open_id
          WHERE p.sumber = 'SALDO_AWAL'
          ORDER BY p.id`,
      )
      .all() as {
      id: string;
      status: string;
      jumlah: number;
      jurnal_open_id: string;
      jurnal_batal_id: string | null;
      peran: string | null;
    }[];

    for (const r of openingRows) {
      const alasan: string[] = [];
      if (!String(r.jurnal_open_id ?? '').trim()) {
        alasan.push('jurnal serah panjar masih kosong');
      } else if (!r.peran) {
        alasan.push('jurnal serah panjar tidak ditemukan');
      } else if (
        r.peran !== 'OPENING' &&
        r.peran !== 'OPENING_REPLACEMENT'
      ) {
        alasan.push('jurnal yang ditunjuk bukan jurnal saldo awal yang aktif');
      }
      if (alasan.length === 0) continue;
      const detail: PanjarOpeningTidakLengkap = {
        id: r.id,
        jurnal_open_id: r.jurnal_open_id,
        status: r.status,
        jumlah: Number(r.jumlah),
        peran: r.peran,
        alasan,
      };
      temuan.push({
        kode: 'PANJAR_OPENING_TIDAK_LENGKAP',
        pesan:
          `Panjar saldo awal menunjuk jurnal yang bukan jurnal saldo awal yang sah: ` +
          `${alasan.join('; ')}.`,
        detail,
      });
    }

    const openingOpen = db
      .prepare(
        `SELECT p.jurnal_open_id, SUM(p.jumlah) AS total_open
           FROM panjar p
           JOIN jurnal j ON j.id = p.jurnal_open_id
          WHERE p.sumber = 'SALDO_AWAL'
            AND p.status = 'OPEN'${filterBatalP}
            AND j.peran IN ('OPENING', 'OPENING_REPLACEMENT')
          GROUP BY p.jurnal_open_id
          ORDER BY p.jurnal_open_id`,
      )
      .all() as { jurnal_open_id: string; total_open: number }[];

    for (const r of openingOpen) {
      const totalOpen = Number(r.total_open);
      const debitNeto = Number(
        (
          db
            .prepare(
              `SELECT COALESCE(SUM(debit - kredit), 0) AS saldo
                 FROM jurnal_baris
                WHERE jurnal_id = ? AND akun_kode = ?`,
            )
            .get(r.jurnal_open_id, AKUN_PANJAR) as { saldo: number }
        ).saldo,
      );
      if (totalOpen <= debitNeto) continue;
      const alasan = [
        `total panjar saldo awal yang masih terbuka ${formatRp(totalOpen)} melebihi debit neto ` +
          `1040 jurnal saldo awal ${formatRp(debitNeto)}`,
      ];
      const detail: PanjarOpeningTidakLengkap = {
        jurnal_open_id: r.jurnal_open_id,
        jumlah: totalOpen,
        debit_neto: debitNeto,
        alasan,
      };
      temuan.push({
        kode: 'PANJAR_OPENING_TIDAK_LENGKAP',
        pesan:
          `Panjar saldo awal pada jurnal ${r.jurnal_open_id} tidak lengkap: ` +
          `${alasan[0]}.`,
        detail,
      });
    }

    const adaOpeningOpen = openingRows.some(
      (r) =>
        r.status === 'OPEN' &&
        (r.jurnal_batal_id === null || r.jurnal_batal_id === ''),
    );
    if (adaOpeningOpen) {
      const aktif = getPembukaanAktif(db);
      if (
        aktif === null ||
        (aktif.peran !== 'OPENING' && aktif.peran !== 'OPENING_REPLACEMENT')
      ) {
        const alasan = [
          aktif
            ? `penunjuk pembukaan aktif menunjuk ${aktif.id} berperan ${aktif.peran}`
            : 'penunjuk pembukaan aktif kosong atau tidak valid',
        ];
        const detail: PanjarOpeningTidakLengkap = {
          jurnal_open_id: '',
          alasan,
        };
        temuan.push({
          kode: 'PANJAR_OPENING_TIDAK_LENGKAP',
          pesan:
            'Ada panjar saldo awal berstatus OPEN tetapi ' +
            `${alasan[0]}. Perbaiki penunjuk pembukaan sebelum cut-over dipakai.`,
          detail,
        });
      } else {
        // T-B02: pointer pembukaan aktif sah, jadi setiap panjar OPEN wajib
        // menunjuk jurnal yang sama. Koreksi saldo awal memindahkan penunjuk
        // ke jurnal pengganti tanpa mengubah dokumen panjar; pointer basi
        // membuat close panjar mengkredit 1040 di atas pembukaan yang sudah
        // dibalik. Saldo GL bisa saja masih cocok, jadi pemeriksaan ini tidak
        // bergantung pada REKONSILIASI_PANJAR_GL_SELISIH.
        for (const r of openingRows) {
          if (r.status !== 'OPEN') continue;
          if (r.jurnal_batal_id !== null && r.jurnal_batal_id !== '') continue;
          if (r.jurnal_open_id === aktif.id) continue;
          const alasan = [
            `menunjuk jurnal ${r.jurnal_open_id} sedangkan pembukaan aktif ` +
              `adalah ${aktif.id} (${aktif.tanggal})`,
          ];
          const detail: PanjarOpeningTidakLengkap = {
            id: r.id,
            jurnal_open_id: r.jurnal_open_id,
            status: r.status,
            jumlah: Number(r.jumlah),
            alasan,
          };
          temuan.push({
            kode: 'PANJAR_OPENING_TIDAK_LENGKAP',
            pesan:
              `Panjar saldo awal menunjuk jurnal saldo awal yang sudah tidak aktif — ` +
              'jurnal pembukaan lama sudah dibalik atau digantikan koreksi saldo awal. ' +
              'Perbarui lewat Koreksi Saldo Awal sebelum panjar ini ditutup.',
            detail,
          });
        }
      }
    }
  }

  // DB-19: jurnal close adalah sumber total. Untuk panjar CLOSED yang sudah
  // punya item dan jurnal close, total item per akun BEBAN wajib sama dengan
  // debit BEBAN jurnal close. Memakai helper yang sama dengan closePanjarV2.
  // Kasus item kosong/jurnal kosong sudah dilaporkan oleh pemeriksaan di atas,
  // jadi di sini hanya panjar yang lengkap (menghindari temuan ganda).
  const panjarClosedLengkap = panjarLengkap
    ? (db
        .prepare(
          `SELECT p.id, p.jurnal_close_id, COUNT(i.id) AS jumlah_item
             FROM panjar p
             JOIN panjar_item i ON i.panjar_id = p.id
            WHERE p.status = 'CLOSED'
              AND p.jurnal_close_id IS NOT NULL AND p.jurnal_close_id <> ''
            GROUP BY p.id
           HAVING COUNT(i.id) > 0
            ORDER BY p.id`,
        )
        .all() as { id: string; jurnal_close_id: string; jumlah_item: number }[])
    : [];
  for (const r of panjarClosedLengkap) {
    const hasil = rekonsiliasiPanjarTersimpan(db, r.id);
    if (!hasil || hasil.ok) continue;
    const detail: PanjarItemTidakCocok = {
      id: r.id,
      jurnal_close_id: r.jurnal_close_id,
      total_item: hasil.total_item,
      total_jurnal: hasil.total_jurnal,
      selisih: hasil.selisih,
      akun_selisih: hasil.akun_selisih,
    };
    const rincian = hasil.akun_selisih
      .map(
        (a) =>
          `${a.akun} item ${formatRp(a.total_item)} vs jurnal ${formatRp(a.total_jurnal)} ` +
          `(selisih ${formatRp(a.selisih)})`,
      )
      .join('; ');
    temuan.push({
      kode: 'PANJAR_ITEM_TIDAK_COCOK',
      pesan:
        `Ada panjar yang total rinciannya tidak cocok dengan jurnal penutup: ` +
        `${rincian || `selisih ${formatRp(hasil.selisih)}`}.`,
      detail,
    });
  }

  // AUD2-04: 1040 adalah akun kontrol subledger panjar. Saldo normal debit GL
  // (seluruh baris 1040, termasuk SALDO_AWAL/reversal) wajib sama dengan total
  // panjar OPEN yang belum dibatalkan. Selisih berarti ada jurnal 1040 liar
  // atau data panjar tidak sinkron; audit hanya melaporkan, tidak mengoreksi
  // dan tidak menyimpan angka turunan. Backup sebelum v19 belum punya kolom
  // jurnal_batal_id, jadi pemeriksaan dilewati agar data legacy tidak dianggap
  // rusak hanya karena bentuknya lebih lama.
  const panjarGlSiap =
    adaTabelPanjar &&
    punyaSemuaKolom(kolomPanjar, ['status', 'jumlah', 'jurnal_batal_id']);
  if (panjarGlSiap) {
    const saldoGl = Number(
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(debit - kredit), 0) AS saldo
               FROM jurnal_baris
              WHERE akun_kode = ?`,
          )
          .get(AKUN_PANJAR) as { saldo: number }
      ).saldo,
    );
    const totalPanjarOpen = Number(
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(jumlah), 0) AS total
               FROM panjar
              WHERE status = 'OPEN'
                AND (jurnal_batal_id IS NULL OR jurnal_batal_id = '')`,
          )
          .get() as { total: number }
      ).total,
    );
    const selisih = saldoGl - totalPanjarOpen;
    if (selisih !== 0) {
      const detail: RekonsiliasiPanjarGlSelisih = {
        akun: AKUN_PANJAR,
        saldo_gl: saldoGl,
        total_panjar: totalPanjarOpen,
        selisih,
      };
      temuan.push({
        kode: 'REKONSILIASI_PANJAR_GL_SELISIH',
        pesan:
          `Saldo normal debit akun ${AKUN_PANJAR} UANG PANJAR di Buku Besar ` +
          `${formatRp(saldoGl)} tidak sama dengan total panjar yang masih terbuka ` +
          `${formatRp(totalPanjarOpen)} (selisih ${formatRp(selisih)}). ` +
          'Periksa baris jurnal 1040 liar atau data panjar; jurnal 1040 hanya ' +
          'boleh berasal dari menu Buku Panjar.',
        detail,
      });
    }
  }

  // T-A06: bandingkan snapshot yang disahkan saat tutup buku dengan kondisi
  // jurnal sekarang. Temuan ini bersifat KONTROL: read-only, tidak mengubah
  // snapshot, dan pemanggil (tutupBuku) boleh melanjutkan TUTUP-ULANG yang
  // dikonfirmasi. Backup lama tanpa tabel snapshot melewati pemeriksaan ini.
  if (tabelAda(db, 'tutup_buku_snapshot')) {
    const tahunSnapshot = db
      .prepare(
        `SELECT DISTINCT tahun
           FROM tutup_buku_snapshot
          ORDER BY tahun`,
      )
      .all() as { tahun: number }[];
    for (const { tahun } of tahunSnapshot) {
      try {
        const beda = bandingkanSnapshotTutup(db, Number(tahun));
        if (!beda.snapshot || !beda.berubah) continue;
        const utama = beda.perbedaan.slice(0, 4).join('; ');
        temuan.push({
          kode: 'SNAPSHOT_TUTUP_BERUBAH',
          pesan:
            `Snapshot tutup buku tahun ${tahun} versi ${beda.snapshot.versi} ` +
            `berbeda dari data jurnal saat ini: ${utama}. ` +
            'Snapshot tidak diubah; periksa apakah perbedaan berasal dari ' +
            'koreksi setelah tutup atau data rusak.',
          detail: {
            tahun: Number(tahun),
            versi: beda.snapshot.versi,
            perbedaan: beda.perbedaan,
            snapshot: beda.snapshot,
            live: beda.live,
          },
        });
      } catch {
        // Laporan tidak bisa dihitung (mis. akun asing); temuan integritas
        // lain pada pemeriksaan akun/jurnal sudah melaporkan penyebabnya.
      }
    }
  }

  // T-A07: konsistensi penunjuk pembukaan dan cut-over resmi. Pemeriksaan ini
  // hanya memakai relasi eksplisit (`saldo_awal_aktif_id`, `cutover_tanggal`,
  // `jurnal.peran`) — tidak menebak dari MIN(tanggal) SALDO_AWAL.
  const idsSaldoAwal = daftarJurnalSaldoAwal(db);
  const penunjukPembukaan = String(
    getPengaturan(db, KUNCI_SALDO_AWAL_AKTIF_ID) ?? '',
  ).trim();
  const pembukaanAktif = getPembukaanAktif(db);
  const alasanPenunjuk =
    penunjukPembukaan.length > 0
      ? alasanPembukaanTidakAktif(db, penunjukPembukaan)
      : idsSaldoAwal.length > 0
        ? 'penunjuk saldo_awal_aktif_id masih kosong'
        : null;

  if (idsSaldoAwal.length > 0 && alasanPenunjuk) {
    const detail: PembukaanAktifHilang = {
      penunjuk: penunjukPembukaan || null,
      jurnal_saldo_awal: idsSaldoAwal,
      alasan: alasanPenunjuk,
    };
    temuan.push({
      kode: 'PEMBUKAAN_AKTIF_HILANG',
      pesan:
        `Ada jurnal SALDO_AWAL tetapi ${alasanPenunjuk}. ` +
        'Penunjuk jurnal saldo awal aktif wajib menunjuk jurnal saldo awal ' +
        'yang belum dibalik atau digantikan. Perbaiki lewat Koreksi Saldo Awal; ' +
        'jangan membuat jurnal pembukaan baru atau mengubah jurnal lama.',
      detail,
    });
  }

  const cutoverEksplisit = getCutoverEksplisit(db);
  if (
    cutoverEksplisit.eksplisit &&
    cutoverEksplisit.tanggal &&
    pembukaanAktif &&
    cutoverEksplisit.tanggal !== pembukaanAktif.tanggal
  ) {
    const detail: CutoverTidakKonsisten = {
      cutover_tanggal: cutoverEksplisit.tanggal,
      pembukaan_id: pembukaanAktif.id,
      tanggal_pembukaan: pembukaanAktif.tanggal,
    };
    temuan.push({
      kode: 'CUTOVER_TIDAK_KONSISTEN',
      pesan:
        `Tanggal cut-over resmi (${cutoverEksplisit.tanggal}) berbeda dari tanggal ` +
        `jurnal pembukaan aktif ${pembukaanAktif.id} (${pembukaanAktif.tanggal}). ` +
        'Jangan mengubah tanggal cut-over manual; jalankan Wizard Koreksi Saldo Awal ' +
        'agar penunjuk pembukaan dan tanggal cut-over diperbarui bersama.',
      detail,
    });
  }

  const cutover = getCutoverTanggal(db);
  const grup = grupPembukaan(
    db,
    alasanPenunjuk === null ? pembukaanAktif?.id ?? null : null,
  );

  // T-A07: P&L sebelum cut-over resmi di luar grup pembukaan membuat Laba Rugi
  // tahun pertama dan Neraca tidak konsisten. Baris milik grup pembukaan
  // dikecualikan agar jurnal pembukaan sendiri tidak menjadi false positive;
  // P&L di dalam pembukaan dilaporkan terpisah oleh
  // SALDO_AWAL_MEMUAT_LABA_RUGI.
  if (cutover) {
    const params: unknown[] = [cutover];
    const filterGrup = grup ? 'AND (j.grup_id IS NULL OR j.grup_id <> ?)' : '';
    if (grup) params.push(grup);
    const barisPraCutover = db
      .prepare(
        `SELECT j.id AS jurnal_id, j.tanggal AS tanggal, j.grup_id AS grup_id,
                b.akun_kode AS akun_kode, a.tipe AS tipe,
                b.debit AS debit, b.kredit AS kredit
           FROM jurnal_baris b
           JOIN jurnal j ON j.id = b.jurnal_id
           JOIN akun a ON a.kode = b.akun_kode
          WHERE a.tipe IN ('PENDAPATAN', 'BEBAN')
            AND j.tanggal < ?
            ${filterGrup}
          ORDER BY j.tanggal, j.id, b.id`,
      )
      .all(...params) as Omit<LabaRugiSebelumCutover, 'cutover_tanggal'>[];
    for (const r of barisPraCutover) {
      const detail: LabaRugiSebelumCutover = {
        cutover_tanggal: cutover,
        jurnal_id: String(r.jurnal_id),
        tanggal: String(r.tanggal),
        grup_id: String(r.grup_id ?? ''),
        akun_kode: String(r.akun_kode),
        tipe: String(r.tipe),
        debit: Number(r.debit),
        kredit: Number(r.kredit),
      };
      temuan.push({
        kode: 'LABA_RUGI_SEBELUM_CUTOVER',
        pesan:
          `Baris ${detail.akun_kode} (${detail.tipe}) pada jurnal ${detail.jurnal_id} ` +
          `tanggal ${detail.tanggal} berada sebelum cut-over resmi ` +
          `${cutover} dan di luar grup pembukaan. Pindahkan atau benahi baris ` +
          'ini lewat Wizard Koreksi Saldo Awal; P&L sebelum cut-over tidak boleh ' +
          'dilaporkan sebagai laba tahun pertama.',
        detail,
      });
    }
  }

  // T-A07: jurnal pembukaan aktif tidak boleh memuat PENDAPATAN/BEBAN. Ini
  // menangkap data lama/direct SQL sebelum T-A05 (validator aplikasi sudah
  // menolak, tetapi backup/data lama bisa lolos). Bila penunjuk tidak sah,
  // seluruh jurnal SALDO_AWAL diperiksa agar masalah tetap terlihat.
  const kandidatPembukaan =
    alasanPenunjuk === null && pembukaanAktif
      ? [pembukaanAktif.id]
      : idsSaldoAwal;
  for (const idJurnal of kandidatPembukaan) {
    const barisPembukaan = db
      .prepare(
        `SELECT b.akun_kode AS akun_kode, a.tipe AS tipe,
                b.debit AS debit, b.kredit AS kredit
           FROM jurnal_baris b
           JOIN akun a ON a.kode = b.akun_kode
          WHERE b.jurnal_id = ?
            AND a.tipe IN ('PENDAPATAN', 'BEBAN')
          ORDER BY b.id`,
      )
      .all(idJurnal) as {
      akun_kode: string;
      tipe: string;
      debit: number;
      kredit: number;
    }[];
    if (barisPembukaan.length === 0) continue;
    const jurnal = db
      .prepare('SELECT tanggal FROM jurnal WHERE id = ?')
      .get(idJurnal) as { tanggal: string } | undefined;
    const detail: SaldoAwalMemuatLabaRugi = {
      jurnal_id: idJurnal,
      tanggal: String(jurnal?.tanggal ?? ''),
      akun: barisPembukaan.map((b) => ({
        akun_kode: String(b.akun_kode),
        tipe: String(b.tipe),
        debit: Number(b.debit),
        kredit: Number(b.kredit),
      })),
    };
    const daftarAkunPl = detail.akun
      .map((b) => `${b.akun_kode} ${b.tipe}`)
      .join(', ');
    temuan.push({
      kode: 'SALDO_AWAL_MEMUAT_LABA_RUGI',
      pesan:
        `Jurnal pembukaan ${idJurnal} tanggal ${detail.tanggal} memuat akun laba rugi ` +
        `(${daftarAkunPl}). Saldo awal hanya boleh memuat AKTIVA, KEWAJIBAN, dan ` +
        'EKUITAS (modal penyeimbang). Perbaiki lewat Wizard Koreksi Saldo Awal.',
      detail,
    });
  }

  // T-A07: pemeriksaan laporan memakai mesin yang sama dengan UI. Satu kali
  // baca baris/akun/tutup, lalu hitung Neraca + Neraca Saldo kumulatif/tahun.
  // Cutoff memakai tanggal jurnal terakhir; DB tanpa jurnal memakai tanggal
  // lokal hari ini sehingga hasilnya nol dan tidak menimbulkan false positive.
  // Bila laporan tidak bisa dihitung (mis. akun asing), temuan struktural lain
  // sudah melaporkan penyebabnya; audit tidak boleh melempar error.
  const cutoff = tanggalJurnalTerakhir(db) ?? tanggalLokal();
  let barisLaporan: ReturnType<typeof listBarisJurnal> | null = null;
  let akunLaporan: ReturnType<typeof listAkun> | null = null;
  let tutupLaporan: ReturnType<typeof listTutupBuku> | null = null;
  try {
    barisLaporan = listBarisJurnal(db);
    akunLaporan = listAkun(db);
    tutupLaporan = listTutupBuku(db);
  } catch {
    barisLaporan = null;
  }

  if (barisLaporan && akunLaporan && tutupLaporan) {
    try {
      const posisi = neraca(
        barisLaporan,
        { cutoff, tutup: tutupLaporan },
        akunLaporan,
        cutover,
      );
      if (posisi.selisih !== 0) {
        const detail: NeracaTidakSeimbang = {
          cutoff,
          total_aset: posisi.totalAset,
          total_pasiva: posisi.totalPasiva,
          selisih: posisi.selisih,
        };
        temuan.push({
          kode: 'NERACA_TIDAK_SEIMBANG',
          pesan:
            `Neraca per ${cutoff} tidak seimbang: total aset ` +
            `${formatRp(posisi.totalAset)} vs total pasiva ` +
            `${formatRp(posisi.totalPasiva)} (selisih ` +
            `${formatRp(posisi.selisih)}). Periksa jurnal, cut-over, dan saldo awal; ` +
            'jangan menutup periode sebelum laporan seimbang.',
          detail,
        });
      }
    } catch {
      // Penyebab (mis. akun asing) sudah dilaporkan pemeriksaan akun/jurnal.
    }

    try {
      const kumulatif = neracaSaldo(barisLaporan, cutoff, akunLaporan);
      if (kumulatif.selisih !== 0) {
        const detail: NeracaSaldoSelisih = {
          mode: 'kumulatif',
          cutoff,
          total_debit: kumulatif.totalDebit,
          total_kredit: kumulatif.totalKredit,
          selisih: kumulatif.selisih,
        };
        temuan.push({
          kode: 'NERACA_SALDO_SELISIH',
          pesan:
            `Neraca Saldo mode kumulatif per ${cutoff} selisih ` +
            `${formatRp(kumulatif.selisih)} (debit ` +
            `${formatRp(kumulatif.totalDebit)} vs kredit ` +
            `${formatRp(kumulatif.totalKredit)}). Periksa baris jurnal yang tidak ` +
            'seimbang atau saldo yang tidak masuk laporan.',
          detail,
        });
      }
    } catch {
      // idem: kesalahan struktural sudah dilaporkan di atas.
    }

    try {
      const tahun = neracaSaldoPeriode(barisLaporan, {
        mulai: `${cutoff.slice(0, 4)}-01-01`,
        sampai: cutoff,
        daftarAkun: akunLaporan,
        cutover,
      });
      if (tahun.selisih !== 0) {
        const detail: NeracaSaldoSelisih = {
          mode: 'tahun',
          cutoff,
          total_debit: tahun.totalDebit,
          total_kredit: tahun.totalKredit,
          selisih: tahun.selisih,
        };
        temuan.push({
          kode: 'NERACA_SALDO_SELISIH',
          pesan:
            `Neraca Saldo mode tahun per ${cutoff} selisih ` +
            `${formatRp(tahun.selisih)} (debit ${formatRp(tahun.totalDebit)} vs ` +
            `kredit ${formatRp(tahun.totalKredit)}). Periksa P&L sebelum cut-over ` +
            'dan baris jurnal yang tidak seimbang; jangan menutup periode.',
          detail,
        });
      }
    } catch {
      // idem.
    }
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
    if (typeof a.kode !== 'string' || !/^[0-9]{4}$/.test(a.kode)) {
      temuan.push({
        kode: 'AKUN_KODE_TIDAK_VALID',
        pesan:
          `Akun "${String(a.kode)}" memiliki kode yang tidak valid; ` +
          `kode akun harus tepat 4 digit angka.`,
        detail: a,
      });
    }

    if (typeof a.nama !== 'string' || a.nama.trim().length === 0) {
      temuan.push({
        kode: 'AKUN_NAMA_KOSONG',
        pesan: `Akun ${String(a.kode)} memiliki nama kosong; nama akun wajib diisi.`,
        detail: a,
      });
    }

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

  // DB-16f: bandingkan outstanding 2050 per pinjaman dengan jadwal. Hanya
  // jurnal yang tertaut ke pinjaman (pencairan + pinjaman_bayar) yang dipakai.
  // Saldo total 2050 sengaja TIDAK dibandingkan karena akun itu juga berisi
  // utang non-LPD; jurnal 2050 tanpa link tidak dapat diatribusikan ke pinjaman.
  // Temuan hanya muncul saat selisih != 0; tidak ada koreksi otomatis.
  //
  // Backup lama (v2/v3) belum punya tabel pinjaman, dan backup sebelum v20
  // belum punya seluruh kolom. Pemeriksaan dilewati bila bentuknya belum
  // lengkap, sama seperti pemeriksaan panjar opsional di atas.
  const adaTabelPinjaman =
    tabelAda(db, 'pinjaman') &&
    tabelAda(db, 'pinjaman_bayar') &&
    tabelAda(db, 'jurnal_baris');
  const pinjamanLengkap =
    adaTabelPinjaman &&
    punyaSemuaKolom(kolomTabel(db, 'pinjaman'), [
      'id',
      'sisa_pokok_awal',
      'jurnal_pencairan_id',
      'akun_bunga',
    ]) &&
    punyaSemuaKolom(kolomTabel(db, 'pinjaman_bayar'), [
      'id',
      'pinjaman_id',
      'jurnal_id',
      'tanggal',
    ]);

  if (pinjamanLengkap) {
    let adaTemuanPinjaman = false;
    for (const rekonsiliasi of rekonsiliasiSemuaPinjaman(db)) {
      if (rekonsiliasi.cocok) continue;
      adaTemuanPinjaman = true;
      temuan.push({
        kode: 'REKONSILIASI_PINJAMAN_SELISIH',
        pesan:
          `Rekonsiliasi pinjaman ${rekonsiliasi.pinjaman_id} tidak cocok: ` +
          `${rekonsiliasi.pesan} ` +
          'Angka hanya membandingkan jurnal yang tertaut ke pinjaman ini, ' +
          'bukan seluruh saldo 2050 (utang non-LPD tidak ikut).',
        detail: {
          pinjaman_id: rekonsiliasi.pinjaman_id,
          gl: rekonsiliasi.gl,
          jadwal: rekonsiliasi.jadwal,
          selisih: rekonsiliasi.selisih,
        },
      });
    }

    // AUD2-05: ringkasan agregat memastikan kredit neto 2050 grup SALDO_AWAL
    // mencukupi total sisa pokok seluruh pinjaman berjalan, dan kredit neto
    // 2050 Buku Besar tidak kurang dari outstanding seluruh pinjaman aktif.
    // Bila per pinjaman sudah melaporkan selisih, temuan agregat tidak
    // diduplikasi. Kelebihan GL tidak dianggap temuan karena dapat berasal dari
    // utang non-LPD; hanya kekurangan yang dilaporkan.
    const agregat = rekonsiliasiSaldoAwal2050(db);
    const agregatGl = rekonsiliasiGl2050(db);
    if (
      !adaTemuanPinjaman &&
      agregat.total_sisa_pokok_berjalan > 0 &&
      (agregat.kekurangan > 0 || agregatGl.kekurangan > 0)
    ) {
      const bagian: string[] = [];
      if (agregat.kekurangan > 0)
        bagian.push(
          `Saldo Awal 2050 ${formatRp(agregat.saldo_awal_2050)} tidak ` +
            `mencukupi total sisa pokok pinjaman berjalan ` +
            `${formatRp(agregat.total_sisa_pokok_berjalan)} ` +
            `(kekurangan ${formatRp(agregat.kekurangan)})`,
        );
      if (agregatGl.kekurangan > 0)
        bagian.push(
          `kredit neto 2050 Buku Besar ${formatRp(agregatGl.gl_2050)} kurang ` +
            `dari outstanding seluruh pinjaman aktif ` +
            `${formatRp(agregatGl.outstanding_pinjaman)} ` +
            `(kekurangan ${formatRp(agregatGl.kekurangan)})`,
        );
      temuan.push({
        kode: 'REKONSILIASI_PINJAMAN_SELISIH',
        pesan:
          `${bagian.join('; ')}. Isi atau koreksi Saldo Awal 2050 terlebih ` +
          'dahulu; aplikasi tidak mengoreksi otomatis.',
        detail: {
          saldo_awal_2050: agregat.saldo_awal_2050,
          total_sisa_pokok_berjalan: agregat.total_sisa_pokok_berjalan,
          kekurangan_saldo_awal: agregat.kekurangan,
          gl_2050: agregatGl.gl_2050,
          outstanding_pinjaman: agregatGl.outstanding_pinjaman,
          selisih: agregatGl.selisih,
          kekurangan_gl: agregatGl.kekurangan,
        },
      });
    }

    // T-B09: skema mengizinkan `pinjaman_bayar.angsuran_id` NULL (pelunasan)
    // dan `tautkanPembayaran` mendukungnya, tetapi alur itu tidak diekspos
    // IPC/UI. Bila ada (hanya mungkin lewat akses pustaka/SQL), outstanding
    // bisa 0 sementara angsuran masih BELUM/SEBAGIAN — kondisi tampak
    // kontradiktif bagi pemeriksa dan tidak tertangkap rekonsiliasi GL vs
    // jadwal di atas. Periksaan baca-saja memakai `listPinjaman` (jalur yang
    // sama dengan UI) sehingga outstanding dan status angsuran yang dilaporkan
    // persis sama dengan yang dilihat operator; perhitungan outstanding tidak
    // diubah. Kondisi ini aneh tetapi tidak merusak GL, jadi temuannya
    // non-blok (lihat kebijakan temuan kontrol di db/tutup.ts).
    if (tabelAda(db, 'pinjaman_angsuran')) {
      for (const pinjaman of listPinjaman(db)) {
        if (pinjaman.status !== 'AKTIF' || pinjaman.outstanding !== 0) continue;
        const belumLunas = (pinjaman.angsuran ?? []).filter(
          (a) => a.status !== 'LUNAS',
        );
        if (belumLunas.length === 0) continue;
        const rincianAngsuran = belumLunas
          .map(
            (a) =>
              `ke-${a.ke} ${a.status} (sisa pokok ${formatRp(a.sisa_pokok ?? 0)}, ` +
              `sisa bunga ${formatRp(a.sisa_bunga ?? 0)})`,
          )
          .join('; ');
        temuan.push({
          kode: 'PINJAMAN_OUTSTANDING_NOL_ANGSURAN_BELUM_LUNAS',
          pesan:
            `Pinjaman ${pinjaman.id} (${pinjaman.kreditur}) sudah lunas ` +
            `menurut outstanding (sisa pokok 0), tetapi masih ada ` +
            `${belumLunas.length} angsuran berstatus bukan LUNAS: ` +
            `${rincianAngsuran}. Penyebab umum: pembayaran pelunasan tanpa ` +
            '`angsuran_id` (tidak diekspos di UI/IPC) atau cicilan yang tidak ' +
            'pernah dilengkapi. Periksa daftar pembayaran pinjaman ini dan ' +
            'tautkan/perbaiki lewat modul pinjaman; audit tidak mengoreksi ' +
            'otomatis.',
          detail: {
            pinjaman_id: pinjaman.id,
            outstanding: pinjaman.outstanding,
            angsuran_belum_lunas: belumLunas.map((a) => ({
              id: a.id,
              ke: a.ke,
              status: a.status,
              sisa_pokok: a.sisa_pokok ?? 0,
              sisa_bunga: a.sisa_bunga ?? 0,
            })),
          },
        });
      }
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
