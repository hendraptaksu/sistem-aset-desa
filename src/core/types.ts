// Kontrak data Agent A + Agent B. JANGAN diubah sepihak.
// Nominal disimpan sebagai integer dalam satuan SEN (1 Rp = 100 sen).

export type Panjar = {
  id: string;
  tanggal: string; // YYYY-MM-DD
  penerima: string;
  jumlah: number; // sen
  akun_kas_sumber: string;
  /**
   * Status publik. Sejak v23 (AUD2-09) `DIBATALKAN` disimpan resmi di
   * `panjar.status`; baris legacy dengan `jurnal_batal_id` tetap dibaca
   * sebagai DIBATALKAN.
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

// ---- Pinjaman LPD (DB-16b) ----
// `pinjaman` hanya menyimpan parameter perjanjian. Jadwal adalah RENCANA;
// realisasi pokok/bunga/denda selalu dibaca dari jurnal pembayaran yang
// ditautkan lewat `pinjaman_bayar`. Tidak ada saldo berjalan yang disimpan.

/** Status angsuran diturunkan dari nominal pembayaran aktif terhadap jadwal. */
export type PinjamanAngsuranStatus = 'BELUM' | 'SEBAGIAN' | 'LUNAS';

export type PinjamanAngsuran = {
  id: number;
  pinjaman_id: string;
  ke: number;
  jatuh_tempo: string; // YYYY-MM-DD
  pokok: number; // sen, rencana
  bunga: number; // sen, rencana
  catatan: string;
  /** Turunan: LUNAS bila ada `pinjaman_bayar.angsuran_id` yang menunjuk baris ini. */
  status: PinjamanAngsuranStatus;
  dibayar: boolean;
  pinjaman_bayar_id: string | null;
  tanggal_bayar: string | null;
  jurnal_id: string | null;
  /** Turunan pembayaran aktif; nominal tetap bersumber dari jurnal. */
  pokok_dibayar?: number;
  bunga_dibayar?: number;
  sisa_pokok?: number;
  sisa_bunga?: number;
  jumlah_pembayaran?: number;
};

export type Pinjaman = {
  id: string;
  kreditur: string;
  akun_kas: string;
  akun_bunga: string;
  pokok_awal: number; // sen
  /** Sisa pokok saat pinjaman mulai; sama dengan pokok_awal untuk pencairan baru. */
  sisa_pokok_awal: number; // sen
  tanggal_mulai: string; // YYYY-MM-DD
  tenor_bulan: number | null;
  /** Null = pinjaman sudah berjalan/saldo awal; tidak ada jurnal pencairan baru. */
  jurnal_pencairan_id: string | null;
  catatan: string;
  created_at: string;
  /**
   * TURUNAN, tidak pernah disimpan:
   * `sisa_pokok_awal - SUM(debit 2050 pada jurnal pembayaran tertaut)`.
   */
  outstanding?: number;
  total_pokok_dibayar?: number;
  total_bunga_dibayar?: number;
  total_denda_dibayar?: number;
  /** Jadwal rencana + status turunan, terurut `ke`. */
  angsuran?: PinjamanAngsuran[];
  /** Pembatalan diturunkan dari jurnal balik pencairan, bukan saldo tersimpan. */
  status?: 'AKTIF' | 'DIBATALKAN';
  jurnal_batal_id?: string | null;
};

/** Nominal pembayaran yang DIBACA dari baris jurnal, bukan kolom tersimpan. */
export type RincianPembayaranPinjaman = {
  pokok: number;
  bunga: number;
  denda: number;
  kas_keluar: number;
};

export type PinjamanBayar = {
  id: string;
  pinjaman_id: string;
  angsuran_id: number | null;
  jurnal_id: string;
  tanggal: string;
  catatan: string;
  created_at: string;
  /** Semua nominal di bawah ini turunan dari jurnal, bukan kolom tabel. */
  pokok: number;
  bunga: number;
  denda: number;
  kas_keluar: number;
  /** Histori asli dipertahankan ketika catatan pembayaran dibatalkan. */
  dibatalkan?: boolean;
  jurnal_batal_id?: string | null;
};

export type TutupBuku = {
  tahun: number;
  created_at: string; // ISO
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
  /**
   * DB-27: jenis objek yang dirujuk audit (mis. 'jurnal', 'panjar',
   * 'pinjaman', 'tutup_buku', 'akun'). '' = baris legacy tanpa referensi.
   */
  ref_type?: string;
  /** ID objek yang dirujuk; '' bila tidak ada. */
  ref_id?: string;
};
