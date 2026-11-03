import type { PinjamanAngsuranStatus } from './types.js';

/** Satu baris rencana angsuran yang dibuat generator jadwal otomatis. */
export type BarisJadwalAngsuran = {
  ke: number;
  jatuh_tempo: string;
  pokok: number;
  bunga: number;
  catatan: string;
};

const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;

function uraiTanggalUtc(tanggal: string): {
  tahun: number;
  bulan: number;
  hari: number;
} {
  const m = POLA_TANGGAL.exec(String(tanggal ?? ''));
  if (!m) throw new RangeError('Tanggal tidak valid.');
  const tahun = Number(m[1]);
  const bulan = Number(m[2]);
  const hari = Number(m[3]);
  const cek = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (
    tahun < 1900 ||
    tahun > 9999 ||
    cek.getUTCFullYear() !== tahun ||
    cek.getUTCMonth() !== bulan - 1 ||
    cek.getUTCDate() !== hari
  ) {
    throw new RangeError('Tanggal tidak valid.');
  }
  return { tahun, bulan, hari };
}

/**
 * Tambah `bulan` bulan kalender ke `YYYY-MM-DD` memakai aritmetika UTC.
 * Hari dijepit ke akhir bulan tujuan, mis. 31 Jan + 1 bulan → 28/29 Feb,
 * dan 31 Jan + 2 bulan → 31 Mar. Tidak bergantung zona waktu mesin.
 */
export function tambahBulanUtc(tanggal: string, bulan: number): string {
  if (!Number.isSafeInteger(bulan)) {
    throw new RangeError('Jumlah bulan tidak valid.');
  }
  const { tahun, bulan: bulanAwal, hari } = uraiTanggalUtc(tanggal);
  const target = new Date(Date.UTC(tahun, bulanAwal - 1 + bulan, 1));
  if (Number.isNaN(target.getTime())) {
    throw new RangeError('Tanggal hasil di luar rentang.');
  }
  const tahunTarget = target.getUTCFullYear();
  const bulanTarget = target.getUTCMonth();
  if (tahunTarget < 1900 || tahunTarget > 9999) {
    throw new RangeError('Tanggal hasil di luar rentang.');
  }
  const hariTerakhir = new Date(
    Date.UTC(tahunTarget, bulanTarget + 1, 0),
  ).getUTCDate();
  const hasil = new Date(
    Date.UTC(tahunTarget, bulanTarget, Math.min(hari, hariTerakhir)),
  );
  return `${hasil.getUTCFullYear()}-${String(hasil.getUTCMonth() + 1).padStart(2, '0')}-${String(hasil.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Buat `tenor` baris jadwal angsuran dari tanggal mulai.
 *
 * Pokok dibagi rata ke Rupiah penuh: `floor((targetPokok / N) / 100) * 100`
 * (targetPokok dalam sen). Baris terakhir menerima sisa agar total pokok
 * selalu tepat sama dengan target. Jatuh tempo baris `ke` = tanggal + `ke`
 * bulan. Bunga rencana (sen) diisi sama ke semua baris bila lebih dari 0.
 */
export function buatJadwalAngsuranOtomatis({
  targetPokok,
  tenor,
  tanggal,
  bunga = 0,
}: {
  targetPokok: number;
  tenor: number;
  tanggal: string;
  bunga?: number;
}): BarisJadwalAngsuran[] {
  if (!Number.isSafeInteger(targetPokok) || targetPokok <= 0) {
    throw new RangeError('Target pokok harus bilangan bulat lebih dari 0.');
  }
  if (!Number.isSafeInteger(tenor) || tenor <= 0) {
    throw new RangeError('Tenor harus bilangan bulat lebih dari 0.');
  }
  if (!Number.isSafeInteger(bunga) || bunga < 0) {
    throw new RangeError('Bunga rencana harus bilangan bulat ≥ 0.');
  }
  const pokokBaris = Math.floor(targetPokok / tenor / 100) * 100;
  return Array.from({ length: tenor }, (_, i) => {
    const ke = i + 1;
    return {
      ke,
      jatuh_tempo: tambahBulanUtc(tanggal, ke),
      pokok:
        ke === tenor ? targetPokok - pokokBaris * (tenor - 1) : pokokBaris,
      bunga,
      catatan: '',
    };
  });
}

/** Status berdasarkan kewajiban yang terselesaikan, bukan keberadaan kuitansi. */
export function ringkasanAngsuran(
  jadwal: { pokok: number; bunga: number },
  realisasi: { pokok: number; bunga: number; denda?: number },
): {
  status: PinjamanAngsuranStatus;
  dibayar: boolean;
  pokok_dibayar: number;
  bunga_dibayar: number;
  sisa_pokok: number;
  sisa_bunga: number;
} {
  const sisaPokok = Math.max(0, jadwal.pokok - realisasi.pokok);
  const sisaBunga = Math.max(0, jadwal.bunga - realisasi.bunga);
  const lunas = sisaPokok === 0 && sisaBunga === 0;
  return {
    status: lunas
      ? 'LUNAS'
      : realisasi.pokok > 0 || realisasi.bunga > 0 || (realisasi.denda ?? 0) > 0
        ? 'SEBAGIAN'
        : 'BELUM',
    dibayar: lunas,
    pokok_dibayar: realisasi.pokok,
    bunga_dibayar: realisasi.bunga,
    sisa_pokok: sisaPokok,
    sisa_bunga: sisaBunga,
  };
}
