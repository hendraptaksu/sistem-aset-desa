// Kontrak data Agent A + Agent B. JANGAN diubah sepihak.
// Rupiah disimpan sebagai integer (satuan Rp). Salah satu masuk/keluar = 0.

export type AkunKasKode =
  | '1000' | '1010' | '1014' | '1015' | '1016' | '1017' | '1018' | '1028' | '1029';

export type Transaksi = {
  id: string;
  tanggal: string; // YYYY-MM-DD
  keterangan: string;
  akun_kas: string; // kode 1000-1029
  kategori: string; // 4001-4008 | 5002-5007 | 2050 | 3000
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
  kategori_baga: string; // 5002-5007
  nominal: number;
};

export type TutupBuku = {
  tahun: number;
  laba: number;
  created_at: string; // ISO
  backup_path: string;
};

export type AuditLog = {
  id: string;
  tanggal: string; // ISO
  aksi: string;
  alasan: string;
  data_lama_json: string;
};
