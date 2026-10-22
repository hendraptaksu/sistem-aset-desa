// Kontrak data Agent A + Agent B. JANGAN diubah sepihak.
// Nominal disimpan sebagai integer dalam satuan SEN (1 Rp = 100 sen). Salah satu masuk/keluar = 0.

export type AkunKasKode =
  | '1001' | '1010' | '1014' | '1015' | '1016' | '1017' | '1018'
  | '1019' | '1020' | '1021' | '1028' | '1029' | '1030' | '1031' | '1032' | '1036';

export type Transaksi = {
  id: string;
  tanggal: string; // YYYY-MM-DD
  keterangan: string;
  akun_kas: string; // kode KAS (lihat KAS_KODES di db/coa.ts — sumber kebenaran)
  kategori: string; // PENDAPATAN | BEBAN | 1050 PIUTANG | 2050 HUTANG | 3000 MODAL
  masuk: number;
  keluar: number;
};

export type Panjar = {
  id: string;
  tanggal: string; // YYYY-MM-DD
  penerima: string;
  jumlah: number;
  akun_kas_sumber: string;
  status: 'OPEN' | 'CLOSED';
};

export type PanjarItem = {
  panjar_id: string;
  kategori_baga: string; // kode BEBAN (lihat BEBAN_KODES di db/coa.ts)
  nominal: number;
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
  data_lama_json: string;
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
