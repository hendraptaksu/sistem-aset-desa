// Seeder DEV: data dummy bervolume untuk uji laporan multi-halaman (PDF).
// Aktif via PURA_SEED_DEV=true di .env — hanya dev, lihat src/main/index.ts.
// HANYA mengisi bila tabel transaksi kosong: tidak pernah menimpa data asli.
// Deterministik (mulberry32 seed tetap) agar tiap fresh DB hasilnya identik.

import type Database from 'better-sqlite3';

export const SEED_DEV_ROW_COUNT = 240;

type Arah = 'masuk' | 'keluar';
type Template = {
  teks: string[];
  kas: string[];
  kat: string[];
  arah: Arah;
  min: number;
  max: number;
  bobot: number;
};

// Kode kas/kategori disalin dari src/db/coa.ts agar valid terhadap validasi BKU.
const TEMPLATES: Template[] = [
  { teks: ['Parkir', 'Parkir odalan', 'Parkir minggu'], kas: ['1001', '1015'], kat: ['4005'], arah: 'masuk', min: 50_000_000, max: 600_000_000, bobot: 22 },
  { teks: ['Sesari', 'Sesari piodalan'], kas: ['1001'], kat: ['4041'], arah: 'masuk', min: 30_000_000, max: 400_000_000, bobot: 14 },
  { teks: ['Punia', 'Punia sukarela'], kas: ['1001', '1036'], kat: ['4008'], arah: 'masuk', min: 20_000_000, max: 300_000_000, bobot: 12 },
  { teks: ['Sewa kios', 'Kontrakan kios'], kas: ['1010'], kat: ['4003', '4007'], arah: 'masuk', min: 100_000_000, max: 500_000_000, bobot: 8 },
  { teks: ['Retribusi toilet', 'Toilet umum'], kas: ['1018'], kat: ['4002'], arah: 'masuk', min: 30_000_000, max: 250_000_000, bobot: 8 },
  { teks: ['Tirta beji', 'Pemasukan beji'], kas: ['1016'], kat: ['4001'], arah: 'masuk', min: 30_000_000, max: 250_000_000, bobot: 6 },
  { teks: ['Shuttle bus', 'Tiket shuttle'], kas: ['1017'], kat: ['4004'], arah: 'masuk', min: 50_000_000, max: 400_000_000, bobot: 6 },
  { teks: ['Bunga bank', 'Bunga deposito'], kas: ['1029', '1019'], kat: ['4009'], arah: 'masuk', min: 20_000_000, max: 150_000_000, bobot: 4 },
  { teks: ['Upakara', 'Banten piodalan', 'Sarana upacara'], kas: ['1001'], kat: ['5004'], arah: 'keluar', min: 50_000_000, max: 600_000_000, bobot: 16 },
  { teks: ['Listrik & wifi', 'Telpon & PDAM'], kas: ['1001'], kat: ['5010'], arah: 'keluar', min: 30_000_000, max: 150_000_000, bobot: 10 },
  { teks: ['Mereresik', 'Kebersihan pura'], kas: ['1001'], kat: ['5009'], arah: 'keluar', min: 20_000_000, max: 100_000_000, bobot: 8 },
  { teks: ['Kesekretariatan', 'ATK & fotokopi'], kas: ['1001'], kat: ['5000'], arah: 'keluar', min: 15_000_000, max: 100_000_000, bobot: 8 },
  { teks: ['Boga', 'Konsumsi rapat'], kas: ['1001'], kat: ['5007'], arah: 'keluar', min: 30_000_000, max: 200_000_000, bobot: 6 },
  { teks: ['Wewangunan', 'Perbaikan pelinggih'], kas: ['1001', '1029'], kat: ['5003', '5031'], arah: 'keluar', min: 100_000_000, max: 800_000_000, bobot: 6 },
  { teks: ['Piodalan', 'Biaya karya'], kas: ['1001'], kat: ['5030'], arah: 'keluar', min: 100_000_000, max: 700_000_000, bobot: 5 },
  { teks: ['Humas', 'Tamu & publikasi'], kas: ['1001'], kat: ['5006'], arah: 'keluar', min: 20_000_000, max: 150_000_000, bobot: 4 },
  { teks: ['Pinjaman dana kegiatan', 'Talangan baga'], kas: ['1001'], kat: ['1050'], arah: 'keluar', min: 50_000_000, max: 300_000_000, bobot: 2 },
  { teks: ['Pelunasan piutang'], kas: ['1001'], kat: ['1050'], arah: 'masuk', min: 50_000_000, max: 300_000_000, bobot: 2 },
  { teks: ['Pinjaman talangan', 'Hutang sementara'], kas: ['1001'], kat: ['2050'], arah: 'masuk', min: 100_000_000, max: 500_000_000, bobot: 2 },
  { teks: ['Pembayaran hutang'], kas: ['1001'], kat: ['2050'], arah: 'keluar', min: 100_000_000, max: 500_000_000, bobot: 2 },
  { teks: ['Setoran modal'], kas: ['1029'], kat: ['3000'], arah: 'masuk', min: 200_000_000, max: 1_000_000_000, bobot: 1 },
];

const TOTAL_BOBOT = TEMPLATES.reduce((s, t) => s + t.bobot, 0);

/** PRNG deterministik agar hasil seed selalu sama untuk DB fresh. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rnd: () => number, arr: T[]): T => arr[Math.floor(rnd() * arr.length)]!;

function pickTemplate(rnd: () => number): Template {
  let r = rnd() * TOTAL_BOBOT;
  for (const t of TEMPLATES) {
    r -= t.bobot;
    if (r <= 0) return t;
  }
  return TEMPLATES[0]!;
}

/**
 * Isi DB kosong dengan data dummy. Return jumlah baris dimasukkan
 * (0 bila tabel transaksi sudah berisi — tidak pernah menimpa).
 */
export function seedDev(db: Database.Database, rows = SEED_DEV_ROW_COUNT): number {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM transaksi').get() as { c: number };
  if (c > 0) return 0;
  const rnd = mulberry32(20260904);
  const ins = db.prepare(
    'INSERT INTO transaksi (id, tanggal, keterangan, akun_kas, kategori, masuk, keluar) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const tx = db.transaction(() => {
    for (let i = 0; i < rows; i++) {
      const t = pickTemplate(rnd);
      // Tanggal menanjak 2026-01-01 → 2026-05-31 (±1–2 baris/hari).
      const day = Math.floor((i * 151) / rows);
      const tanggal = new Date(Date.UTC(2026, 0, 1 + day)).toISOString().slice(0, 10);
      const kas = pick(rnd, t.kas);
      const kat = pick(rnd, t.kat);
      const nominal = Math.round((t.min + rnd() * (t.max - t.min)) / 2_500_000) * 2_500_000;
      const keterangan = `${pick(rnd, t.teks)} #${i + 1}`;
      const id = `seed-${String(i + 1).padStart(4, '0')}`;
      if (t.arah === 'masuk') ins.run(id, tanggal, keterangan, kas, kat, nominal, 0);
      else ins.run(id, tanggal, keterangan, kas, kat, 0, nominal);
    }
  });
  tx();
  return rows;
}
