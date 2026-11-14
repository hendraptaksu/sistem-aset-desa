// T3.7 — Benchmark laporan pada DB besar (±10.000 jurnal / 50.000 baris).
//
// Jalankan: npm run benchmark
//
// Script ini membuat DB sementara (bukan data aplikasi), mengisi jurnal
// seimbang secara langsung dalam satu transaksi, lalu mengukur lima operasi
// laporan yang dipakai UI/export. Exit non-zero bila salah satu operasi
// melewati 5.000 ms agar regresi performa tidak lolos diam-diam.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/database.js';
import {
  laporanArusKas,
  laporanBukuBesar,
  laporanLabaRugi,
  laporanNeracaSaldo,
  listBarisJurnal,
} from '../src/db/laporan.js';
import { listTutupBuku } from '../src/db/repository.js';
import { buildDashboardJurnal } from '../src/features/dashboard/dashboard.js';

const JUMLAH_JURNAL = 10_000;
const BARIS_PER_JURNAL = 5;
const BATAS_MS = 5_000;
const CUTOFF = '2026-12-31';
const MULAI_TAHUN = '2026-01-01';

/** Tanggal tersebar ±3 tahun agar filter tanggal benar-benar teruji. */
function tanggalKe(ke: number): string {
  const hari = ke % 1096;
  return new Date(Date.UTC(2024, 0, 1) + hari * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

type BarisSeed = {
  akun_kode: string;
  debit: number;
  kredit: number;
  keterangan: string;
};

/**
 * Lima baris seimbang per jurnal:
 *   D 1001 = n, D 5010 = n/2
 *   K 4005 = n, K 3000 = 3n/10, K 2050 = 2n/10
 * Total debit = total kredit = 1,5n. n kelipatan 10.000 agar semua pecahan
 * pembagian tetap bilangan bulat (sen).
 */
function barisSeimbang(i: number): BarisSeed[] {
  const n = 100_000 + (i % 50) * 10_000;
  return [
    { akun_kode: '1001', debit: n, kredit: 0, keterangan: 'Kas masuk' },
    { akun_kode: '5010', debit: n / 2, kredit: 0, keterangan: 'Beban operasional' },
    { akun_kode: '4005', debit: 0, kredit: n, keterangan: 'Pendapatan' },
    { akun_kode: '3000', debit: 0, kredit: (n * 3) / 10, keterangan: 'Modal' },
    { akun_kode: '2050', debit: 0, kredit: (n * 2) / 10, keterangan: 'Utang' },
  ];
}

function seed(db: ReturnType<typeof openDb>, jumlahJurnal: number): void {
  const insJurnal = db.prepare(
    `INSERT INTO jurnal
       (id, tanggal, no_bukti, keterangan, jenis, grup_id, reversal_of, created_at)
     VALUES (?, ?, '', ?, 'UMUM', ?, NULL, ?)`,
  );
  const insBaris = db.prepare(
    `INSERT INTO jurnal_baris (jurnal_id, akun_kode, debit, kredit, keterangan)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const waktu = '2026-01-01T00:00:00.000Z';
  const isi = db.transaction(() => {
    for (let i = 0; i < jumlahJurnal; i += 1) {
      const id = `bench-${String(i + 1).padStart(6, '0')}`;
      insJurnal.run(id, tanggalKe(i), `Jurnal benchmark ${i + 1}`, id, waktu);
      for (const b of barisSeimbang(i)) {
        insBaris.run(id, b.akun_kode, b.debit, b.kredit, b.keterangan);
      }
    }
  });
  isi();
}

type HasilUkur = { nama: string; ms: number };

function ukur(nama: string, operasi: () => unknown): HasilUkur {
  const mulai = performance.now();
  operasi();
  return { nama, ms: performance.now() - mulai };
}

function main(): void {
  const dir = mkdtempSync(join(tmpdir(), 'pura-benchmark-'));
  const path = join(dir, 'pura.db');
  const db = openDb(path);
  try {
    const mulaiSeed = performance.now();
    seed(db, JUMLAH_JURNAL);
    const msSeed = performance.now() - mulaiSeed;

    const hasil: HasilUkur[] = [
      ukur('Dashboard (query + builder)', () =>
        buildDashboardJurnal(listBarisJurnal(db), listTutupBuku(db), CUTOFF),
      ),
      ukur('Neraca Saldo', () => laporanNeracaSaldo(db, CUTOFF)),
      ukur('Laba Rugi', () =>
        laporanLabaRugi(db, { mulai: MULAI_TAHUN, sampai: CUTOFF }),
      ),
      ukur('Arus Kas', () =>
        laporanArusKas(db, { mulai: MULAI_TAHUN, sampai: CUTOFF }),
      ),
      ukur('Buku Besar (akun 1001)', () => laporanBukuBesar(db, '1001')),
    ];

    const jumlahBaris = (
      db.prepare('SELECT COUNT(*) AS n FROM jurnal_baris').get() as { n: number }
    ).n;

    console.log(
      `Seed ${JUMLAH_JURNAL.toLocaleString('id-ID')} jurnal / ` +
        `${jumlahBaris.toLocaleString('id-ID')} baris: ${msSeed.toFixed(1)} ms`,
    );
    console.log('');
    console.log('Operasi                          Waktu (ms)');
    console.log('-------------------------------  ----------');
    for (const h of hasil) {
      console.log(`${h.nama.padEnd(31)}  ${h.ms.toFixed(1).padStart(10)}`);
    }
    console.log('');
    console.log(`Batas per operasi: ${BATAS_MS} ms`);

    const gagal = hasil.filter((h) => h.ms > BATAS_MS);
    if (gagal.length > 0) {
      console.error(
        `GAGAL: ${gagal.map((h) => `${h.nama} ${h.ms.toFixed(1)} ms`).join(', ')} melewati batas.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log('OK: semua operasi di bawah batas.');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
