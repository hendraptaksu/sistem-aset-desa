// Kontrak data Agent A + Agent B. JANGAN diubah sepihak.
// Nominal disimpan sebagai integer dalam satuan SEN (1 Rp = 100 sen).

export type Panjar = {
  id: string;
  tanggal: string; // YYYY-MM-DD
  penerima: string;
  jumlah: number; // sen
  akun_kas_sumber: string;
  /**
   * Status publik. `DIBATALKAN` diturunkan dari `jurnal_batal_id` (kolom DB
   * tetap OPEN/CLOSED agar CHECK lama tidak perlu rebuild).
   */
  status: 'OPEN' | 'CLOSED' | 'DIBATALKAN';
  /** Tanggal pertanggungjawaban; null selama masih OPEN. */
  tanggal_close?: string | null;
  /** Jurnal serah (D 1040 / K kas sumber). */
  jurnal_open_id?: string | null;
  /** Jurnal pertanggungjawaban; null selama masih OPEN. */
  jurnal_close_id?: string | null;
  /** DB-21: jurnal balik saat panjar OPEN dibatalkan; null bila tidak. */
  jurnal_batal_id?: string | null;
  /** DB-21: tanggal jurnal balik pembatalan. */
  tanggal_batal?: string | null;
  /** DB-21: alasan pembatalan yang juga tercatat di audit. */
  alasan_batal?: string;
  created_at?: string; // ISO
  /**
   * Ringkasan TURUNAN untuk daftar UI (dihitung dari `panjar_item`), bukan
   * kolom tersimpan. Sumber angka laporan tetap jurnal.
   */
  total_realisasi?: number;
  sisa?: number;
  kurang?: number;
};

export type PanjarItem = {
  /** Auto-increment; opsional agar bentuk lama tetap kompatibel. */
  id?: number;
  panjar_id: string;
  kategori_baga: string; // kode BEBAN (lihat BEBAN_KODES di db/coa.ts)
  nominal: number; // sen
  /**
   * DB-18: detail nota per baris pertanggungjawaban. Baris lama/legacy boleh
   * berisi string kosong; jurnal close tetap agregat per akun.
   */
  nota_nomor: string;
  nota_tanggal: string; // YYYY-MM-DD atau '' untuk data legacy
  toko: string;
  keterangan: string;
  /** Jurnal pertanggungjawaban yang memuat realisasi item ini. */
  jurnal_id?: string | null;
};

// ---- Jurnal double-entry (sumber kebenaran akuntansi) ----
// `jurnal` = kepala (satu transaksi/bukti); `jurnal_baris` = sisi debit/kredit.
// Nominal integer SEN. Setiap baris hanya boleh salah satu: debit > 0 atau kredit > 0.
export type JurnalJenis =
  | 'UMUM'
  | 'TERIMA'
  | 'BAYAR'
  | 'TRANSFER'
  | 'PANJAR'
  | 'PIUTANG'
  | 'HUTANG'
  | 'SALDO_AWAL'
  | 'REVERSAL';

export type Jurnal = {
  id: string;
  tanggal: string; // YYYY-MM-DD
  no_bukti: string; // cth JU-2026-0001 (boleh kosong saat masih draft)
  keterangan: string;
  jenis: JurnalJenis;
  grup_id: string; // default = id jurnal; reversal berbagi grup dengan aslinya
  reversal_of: string | null; // id jurnal yang dikoreksi (null = jurnal biasa)
  created_at: string; // ISO datetime
};

export type JurnalBaris = {
  id: number; // autoincrement, urutan input
  jurnal_id: string;
  akun_kode: string;
  debit: number; // sen
  kredit: number; // sen
  keterangan: string;
};

/** Input baris jurnal; `id` & `jurnal_id` diisi repository. */
export type JurnalBarisInput = Omit<JurnalBaris, 'id' | 'jurnal_id' | 'keterangan'> & {
  keterangan?: string;
};

/** Input kepala jurnal; `grup_id` default = id, `created_at` default = sekarang. */
export type JurnalHeaderInput = {
  id: string;
  tanggal: string;
  keterangan: string;
  no_bukti?: string;
  jenis?: JurnalJenis;
  grup_id?: string;
  reversal_of?: string | null;
  created_at?: string;
};

export type TutupBuku = {
  tahun: number;
  created_at: string; // ISO
  backup_path: string;
  catatan: string;
  /**
   * @deprecated Model v2 TIDAK menyimpan laba. Field ini hanya disisakan agar
   * test/model single-entry lama tetap terbaca; kode laporan v2 selalu
   * menghitung laba dari jurnal (`core/reports.ts`).
   */
  laba?: number;
};

export type AuditLog = {
  id: string;
  tanggal: string; // ISO
  aksi: string;
  alasan: string;
  /** JSON kondisi sebelum operasi ('' = tidak ada data lama). */
  data_lama_json: string;
  /** JSON kondisi sesudah operasi ('' = tidak ada data baru). */
  data_baru_json: string;
};
