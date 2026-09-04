// Kontrak data Agent A + Agent B. JANGAN diubah sepihak.
// Rupiah disimpan sebagai integer (satuan Rp). Salah satu masuk/keluar = 0.

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
