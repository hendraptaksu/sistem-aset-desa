// Seeder DEV v2: data dummy berupa JURNAL SEIMBANG untuk uji laporan multi-halaman.
// Aktif via PURA_SEED_DEV=true di .env — hanya dev, lihat src/main/index.ts.
// HANYA mengisi bila tabel `jurnal` kosong: tidak pernah menimpa data asli.
// Deterministik (mulberry32 seed tetap) agar tiap fresh DB hasilnya identik.

import type Database from 'better-sqlite3';
import { akun } from './coa.js';
import { insertJurnal } from './repository.js';
import type { JurnalBarisInput, JurnalJenis } from '../core/types.js';

/** Jumlah jurnal (bukan baris) yang dihasilkan seed. */
export const SEED_DEV_JURNAL_COUNT = 240;

const TAHUN = 2026;

const AKUN_KAS_PENERIMAAN = ['1001', '1015', '1016', '1017', '1018', '1029'] as const;
const AKUN_PENDAPATAN = [
  '4001', '4002', '4003', '4004', '4005', '4007', '4008', '4009', '4041',
] as const;
const AKUN_BEBAN = [
  '5000', '5003', '5004', '5006', '5007', '5009', '5010', '5030', '5031',
] as const;

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

const pick = <T>(rnd: () => number, arr: readonly T[]): T =>
  arr[Math.floor(rnd() * arr.length)]!;

/** Nominal bulat Rp 10.000-an dalam satuan sen. */
function nominal(rnd: () => number, min: number, max: number): number {
  const raw = min + rnd() * (max - min);
  return Math.max(min, Math.round(raw / 1_000_000) * 1_000_000);
}

const debit = (akun_kode: string, nominalSen: number, keterangan = ''): JurnalBarisInput => ({
  akun_kode,
  debit: nominalSen,
  kredit: 0,
  keterangan,
});
const kredit = (akun_kode: string, nominalSen: number, keterangan = ''): JurnalBarisInput => ({
  akun_kode,
  debit: 0,
  kredit: nominalSen,
  keterangan,
});

/**
 * Isi DB kosong dengan jurnal dummy yang selalu seimbang:
 * saldo awal/modal, pendapatan, beban, transfer, piutang, hutang,
 * serta panjar open + close selama Januari–Juni 2026.
 *
 * Return jumlah jurnal yang dimasukkan, atau 0 bila `jurnal` sudah berisi.
 */
export function seedDev(db: Database.Database, jumlah = SEED_DEV_JURNAL_COUNT): number {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM jurnal').get() as { c: number };
  if (c > 0) return 0;
  if (!Number.isInteger(jumlah) || jumlah <= 0) return 0;

  const rnd = mulberry32(20261022);
  const saldoKas: Record<string, number> = { '1001': 0, '1029': 0 };
  let seq = 0;
  let panjarSisa = 0;
  let piutangSisa = 0;
  let hutangSisa = 0;

  const tanggalUntuk = (i: number): string => {
    // 240 jurnal tersebar merata Jan–Jun 2026 (181 hari).
    const hari = Math.floor((i * 180) / Math.max(1, jumlah - 1));
    return new Date(Date.UTC(TAHUN, 0, 1 + hari)).toISOString().slice(0, 10);
  };

  const catat = (
    i: number,
    jenis: JurnalJenis,
    keterangan: string,
    baris: JurnalBarisInput[],
    grupId?: string,
  ): void => {
    seq += 1;
    const tanggal = tanggalUntuk(i);
    insertJurnal(
      db,
      {
        id: `seed-${String(seq).padStart(4, '0')}`,
        tanggal,
        no_bukti: `JU-${TAHUN}-${String(seq).padStart(4, '0')}`,
        keterangan,
        jenis,
        grup_id: grupId,
        created_at: `${tanggal}T08:00:00.000Z`,
      },
      baris,
    );
  };

  const namaAkun = (kode: string): string => akun(kode)?.nama ?? kode;

  const terima = (i: number): void => {
    const kas = pick(rnd, AKUN_KAS_PENERIMAAN);
    const pendapatan = pick(rnd, AKUN_PENDAPATAN);
    const n = nominal(rnd, 25_000_000, 400_000_000);
    saldoKas[kas] = (saldoKas[kas] ?? 0) + n;
    catat(i, 'TERIMA', `Penerimaan ${namaAkun(pendapatan)} #${i + 1}`, [
      debit(kas, n),
      kredit(pendapatan, n),
    ]);
  };

  const bayar = (i: number): void => {
    const beban = pick(rnd, AKUN_BEBAN);
    let sumber = i % 2 === 0 ? '1001' : '1029';
    let n = nominal(rnd, 20_000_000, 250_000_000);
    if ((saldoKas[sumber] ?? 0) < n) sumber = sumber === '1001' ? '1029' : '1001';
    const tersedia = saldoKas[sumber] ?? 0;
    if (tersedia <= 0) {
      terima(i);
      return;
    }
    n = Math.min(n, tersedia);
    saldoKas[sumber] = tersedia - n;
    catat(i, 'BAYAR', `Pembayaran ${namaAkun(beban)} #${i + 1}`, [
      debit(beban, n),
      kredit(sumber, n),
    ]);
  };

  const transfer = (i: number): void => {
    const dari = i % 2 === 0 ? '1001' : '1029';
    const ke = dari === '1001' ? '1029' : '1001';
    const tersedia = saldoKas[dari] ?? 0;
    const n = Math.min(nominal(rnd, 50_000_000, 300_000_000), tersedia);
    if (n <= 0) {
      terima(i);
      return;
    }
    saldoKas[dari] = tersedia - n;
    saldoKas[ke] = (saldoKas[ke] ?? 0) + n;
    catat(i, 'TRANSFER', `Pindah dana ${namaAkun(dari)} → ${namaAkun(ke)} #${i + 1}`, [
      debit(ke, n),
      kredit(dari, n),
    ]);
  };

  const simpan = db.transaction(() => {
    // 1) Saldo awal: kas tunai + bank, lawannya modal.
    const modalKas = 10_000_000_000;
    const modalBank = 25_000_000_000;
    catat(0, 'SALDO_AWAL', 'Saldo awal kas dan bank', [
      debit('1001', modalKas, 'Kas tunai'),
      debit('1029', modalBank, 'Bank BPD'),
      kredit('3000', modalKas + modalBank, 'Modal awal'),
    ]);
    saldoKas['1001'] = modalKas;
    saldoKas['1029'] = modalBank;

    for (let i = 1; i < jumlah; i++) {
      const pos = i % 60;
      const siklus = Math.floor(i / 60) + 1;

      // 2) Panjar: serah (D 1040 / K kas) lalu pertanggungjawaban
      //    (D beban + sisa kas / K 1040) pada jurnal berikutnya, grup sama.
      if (pos === 20) {
        const sumber = (saldoKas['1001'] ?? 0) > 0 ? '1001' : '1029';
        const n = Math.min(nominal(rnd, 100_000_000, 300_000_000), saldoKas[sumber] ?? 0);
        if (n > 0) {
          saldoKas[sumber] = (saldoKas[sumber] ?? 0) - n;
          panjarSisa = n;
          catat(
            i,
            'PANJAR',
            `Serah panjar #${siklus}`,
            [debit('1040', n, 'Uang panjar'), kredit(sumber, n, 'Sumber panjar')],
            `g-panjar-${String(siklus).padStart(2, '0')}`,
          );
        } else {
          terima(i);
        }
        continue;
      }
      if (pos === 21) {
        if (panjarSisa > 0) {
          const beban = pick(rnd, AKUN_BEBAN);
          const realisasi = Math.floor((panjarSisa * 0.85) / 1_000_000) * 1_000_000;
          const sisa = panjarSisa - realisasi;
          const baris: JurnalBarisInput[] = [
            debit(beban, realisasi, 'Realisasi belanja'),
            kredit('1040', realisasi, 'Uang panjar terpakai'),
          ];
          if (sisa > 0) {
            baris.push(debit('1001', sisa, 'Sisa panjar kembali'));
            baris.push(kredit('1040', sisa, 'Sisa panjar'));
          }
          saldoKas['1001'] = (saldoKas['1001'] ?? 0) + sisa;
          panjarSisa = 0;
          catat(
            i,
            'PANJAR',
            `Pertanggungjawaban panjar #${siklus}`,
            baris,
            `g-panjar-${String(siklus).padStart(2, '0')}`,
          );
        } else {
          terima(i);
        }
        continue;
      }

      // 3) Piutang: beri pinjaman lalu pelunasan sebagian/penuh.
      if (pos === 5 || pos === 50) {
        const sumber = (saldoKas['1001'] ?? 0) > 0 ? '1001' : '1029';
        const n = Math.min(nominal(rnd, 50_000_000, 200_000_000), saldoKas[sumber] ?? 0);
        if (n > 0) {
          saldoKas[sumber] = (saldoKas[sumber] ?? 0) - n;
          piutangSisa += n;
          catat(
            i,
            'PIUTANG',
            `Pinjaman kepada pihak lain #${i + 1}`,
            [debit('1050', n, 'Piutang'), kredit(sumber, n, 'Kas keluar')],
            `g-piutang-${String(siklus).padStart(2, '0')}-${pos >= 50 ? '2' : '1'}`,
          );
        } else {
          terima(i);
        }
        continue;
      }
      if (pos === 6 || pos === 51) {
        if (piutangSisa > 0) {
          const n = Math.min(nominal(rnd, 50_000_000, 200_000_000), piutangSisa);
          piutangSisa -= n;
          saldoKas['1001'] = (saldoKas['1001'] ?? 0) + n;
          catat(
            i,
            'PIUTANG',
            `Pelunasan piutang #${i + 1}`,
            [debit('1001', n, 'Kas masuk'), kredit('1050', n, 'Pelunasan piutang')],
            `g-piutang-${String(siklus).padStart(2, '0')}-${pos >= 50 ? '2' : '1'}`,
          );
        } else {
          terima(i);
        }
        continue;
      }

      // 4) Hutang: terima pinjaman lalu bayar sebagian.
      if (pos === 15) {
        const n = nominal(rnd, 100_000_000, 500_000_000);
        hutangSisa += n;
        saldoKas['1029'] = (saldoKas['1029'] ?? 0) + n;
        catat(
          i,
          'HUTANG',
          `Terima pinjaman #${i + 1}`,
          [debit('1029', n, 'Kas bank'), kredit('2050', n, 'Hutang')],
          `g-hutang-${String(siklus).padStart(2, '0')}`,
        );
        continue;
      }
      if (pos === 16) {
        if (hutangSisa > 0) {
          const n = Math.min(nominal(rnd, 100_000_000, 500_000_000), hutangSisa);
          hutangSisa -= n;
          saldoKas['1029'] = (saldoKas['1029'] ?? 0) - n;
          catat(
            i,
            'HUTANG',
            `Bayar hutang #${i + 1}`,
            [debit('2050', n, 'Pelunasan hutang'), kredit('1029', n, 'Kas bank')],
            `g-hutang-${String(siklus).padStart(2, '0')}`,
          );
        } else {
          terima(i);
        }
        continue;
      }

      // 5) Pindah dana antar dompet.
      if (pos === 9 || pos === 35) {
        transfer(i);
        continue;
      }

      // 6) Sisanya pendapatan/beban harian.
      if (pos === 3 || pos === 25 || pos === 40 || pos === 55 || i % 5 === 0) bayar(i);
      else terima(i);
    }
  });
  simpan();

  return jumlah;
}
