// Kontrak data Agent A + Agent B. JANGAN diubah sepihak.
// Nominal disimpan sebagai integer dalam satuan SEN (1 Rp = 100 sen).

export type Panjar = {
  id: string;
  tanggal: string; // YYYY-MM-DD
  penerima: string;
  jumlah: number; // sen
  akun_kas_sumber: string;
  status: 'OPEN' | 'CLOSED';
  /** Tanggal pertanggungjawaban; null selama masih OPEN. */
  tanggal_close?: string | null;
  /** Jurnal serah (D 1040 / K kas sumber). */
  jurnal_open_id?: string | null;
  /** Jurnal pertanggungjawaban; null selama masih OPEN. */
  jurnal_close_id?: string | null;
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

// ---- Lampiran bukti jurnal (P2-4) ----
// HANYA metadata. Isi file disimpan di `<userData>/attachments`, bukan di DB,
// dan TIDAK ikut backup `.db`. `nama_simpan` relatif terhadap folder tersebut.
export type LampiranJurnal = {
  id: string;
  jurnal_id: string;
  nama_asli: string;
  nama_simpan: string;
  mime: string;
  ukuran: number; // byte
  created_at: string; // ISO datetime
};

// ---- Pihak & piutang/hutang (P1-5) ----
// `pihak` hanya master nama; `jurnal_pihak` hanya metadata penghubung.
// Saldo TIDAK disimpan — selalu dihitung dari baris jurnal 1050/2050.

export type Pihak = {
  id: string;
  nama: string;
  catatan: string;
  created_at: string; // ISO
};

export type JurnalPihak = {
  jurnal_id: string;
  pihak_id: string;
  /** 1050 PIUTANG LAIN LAIN atau 2050 HUTANG LAIN-LAIN. */
  akun_kode: string;
};

/** Saldo per pihak, turunan jurnal (bukan kolom tersimpan). */
export type PihakSaldo = Pihak & {
  /** 1050: debit − kredit (positif = masih menjadi piutang). */
  piutang: number;
  /** 2050: kredit − debit (positif = masih menjadi hutang). */
  hutang: number;
  /** piutang − hutang; negatif berarti kewajiban pihak lebih besar. */
  neto: number;
};

/** Riwayat jurnal satu pihak untuk layar drill-down. */
export type JurnalPihakTampil = Jurnal & {
  pihak_id: string;
  /** Akun pihak pada jurnal ini (1050/2050). */
  akun_pihak: string;
  /** Mutasi pada akun pihak tersebut. */
  debit: number;
  kredit: number;
  baris: JurnalBaris[];
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

// ---- Inventaris Aset (non-keuangan, terpisah dari BKU/Neraca) ----
// Tanah/bangunan druwe/hibah yang nilai nominalnya belum pasti dicatat di sini,
// BUKAN di BKU. `nilai_sen` opsional (null = belum dinilai) dan TIDAK ikut
// persamaan Neraca Aktiva=Pasiva (yang hanya hitung Kas+Piutang+Panjar).
export type AsetJenis = 'TANAH' | 'BANGUNAN' | 'LAINNYA';
export type AsetKondisi = 'BAIK' | 'RUSAK_RINGAN' | 'RUSAK_BERAT' | 'TIDAK_DIKETAHUI';

export type Aset = {
  id: string;
  kode: string; // kode inventaris unik, cth AST-001
  nama: string;
  jenis: AsetJenis;
  luas_m2: number | null;
  lokasi: string;
  status_hukum: string; // druwe / SHM / hibah / sewa / ...
  tahun_perolehan: number | null;
  asal_usul: string;
  kondisi: AsetKondisi;
  keterangan: string;
  nilai_sen: number | null; // null = belum dinilai (wajar untuk tanah/bangunan desa)
  created_at: string; // ISO
  updated_at: string; // ISO
};
