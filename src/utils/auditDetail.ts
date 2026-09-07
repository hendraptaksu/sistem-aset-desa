// Parse aman data_lama_json audit_log untuk popup detail koreksi.
// Dua bentuk yang ditulis main: Transaksi BKU & Panjar. Selain itu → mentah.

export type AuditDetailView =
  | {
      kind: 'transaksi';
      tanggal: string;
      keterangan: string;
      akun_kas: string;
      kategori: string;
      masuk: number;
      keluar: number;
    }
  | {
      kind: 'panjar';
      tanggal: string;
      penerima: string;
      jumlah: number;
      akun_kas_sumber: string;
      status: string;
    }
  | { kind: 'mentah'; teks: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function parseAuditDetail(json: string): AuditDetailView {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    return { kind: 'mentah', teks: json };
  }
  if (!isObj(raw)) return { kind: 'mentah', teks: json };

  if (
    typeof raw.tanggal === 'string' &&
    typeof raw.keterangan === 'string' &&
    typeof raw.akun_kas === 'string' &&
    typeof raw.kategori === 'string' &&
    typeof raw.masuk === 'number' &&
    typeof raw.keluar === 'number'
  ) {
    return {
      kind: 'transaksi',
      tanggal: raw.tanggal,
      keterangan: raw.keterangan,
      akun_kas: raw.akun_kas,
      kategori: raw.kategori,
      masuk: raw.masuk,
      keluar: raw.keluar,
    };
  }

  if (
    typeof raw.tanggal === 'string' &&
    typeof raw.penerima === 'string' &&
    typeof raw.jumlah === 'number' &&
    typeof raw.akun_kas_sumber === 'string'
  ) {
    return {
      kind: 'panjar',
      tanggal: raw.tanggal,
      penerima: raw.penerima,
      jumlah: raw.jumlah,
      akun_kas_sumber: raw.akun_kas_sumber,
      status: typeof raw.status === 'string' ? raw.status : '-',
    };
  }

  return { kind: 'mentah', teks: json };
}

/** Label ramah untuk kolom Aksi audit_log (id teknis disembunyikan). */
export function formatAksiAudit(aksi: string): string {
  if (aksi.startsWith('CREATE t-')) return 'Tambah transaksi BKU';
  if (aksi.startsWith('PANJAR-OPEN p-')) return 'Panjar baru';
  if (aksi.startsWith('PANJAR-CLOSE p-')) return 'Tutup panjar';
  return aksi;
}
