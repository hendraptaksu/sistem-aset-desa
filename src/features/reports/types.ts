// Tipe laporan Pembantu. Angka selalu berasal dari jurnal (Buku Besar v2).

/** Baris tampilan Pembantu; dipetakan dari baris Buku Besar, bukan tabel lama. */
export type BarisPembantu = {
  id: string;
  tanggal: string;
  keterangan: string;
  masuk: number;
  keluar: number;
};

export type PembantuHasil = {
  kode: string;
  nama: string;
  rows: BarisPembantu[];
  totalMasuk: number;
  totalKeluar: number;
  /** Saldo sebelum periode (dari jurnal); opsional untuk pemanggil lama. */
  saldoAwal?: number;
  /** Saldo akhir, sudah termasuk saldo awal bila tersedia. */
  saldo: number;
  mulai?: string;
  sampai?: string;
};
