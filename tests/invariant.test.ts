// P0-10: invariant & gerbang kualitas double-entry.
//
// Bukti utama "correctness" (arah akuntansi §7): apa pun operasinya, Neraca
// Saldo selalu selisih nol. Test ini memakai DB `:memory:` + posting layer
// (bukan SQL mentah), sehingga aturan bisnis yang diuji sama dengan yang
// dipakai aplikasi.
//
// 1. Rangkaian 200 operasi acak-deterministik: terima uang, bayar, transfer,
//    panjar serah + pertanggungjawaban, reversal, dan tutup buku 2025.
//    Setelah SETIAP operasi sukses: total debit = total kredit, selisih 0.
// 2. DB v2 fresh: skema lengkap tanpa tabel single-entry, seedDev, semua
//    laporan jalan, Neraca seimbang.
// 3. Koreksi (reversal + jurnal pengganti) setelah tutup buku tidak pernah
//    membuat selisih.
// 4. Builder form terpandu (P1-1..P1-4) menghasilkan jurnal seimbang dan
//    bisa disimpan tanpa pengetahuan debit/kredit.

import { describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, SCHEMA_VERSION } from '../src/db/database.js';
import { postingJurnal } from '../src/db/posting.js';
import { koreksiDanIsiUlang, reverseJurnal } from '../src/db/reversal.js';
import { tutupBuku } from '../src/db/tutup.js';
import { listBarisJurnal } from '../src/db/laporan.js';
import { listJurnal, listTutupBuku } from '../src/db/repository.js';
import { seedDev, SEED_DEV_JURNAL_COUNT } from '../src/db/seed-dev.js';
import {
  bukuBesar,
  labaRugi,
  neraca,
  neracaSaldo,
  saldoAkun,
  arusKas,
} from '../src/core/reports.js';
import {
  buatJurnalBayar,
  buatJurnalPanjarSerah,
  buatJurnalPindahDana,
  buatJurnalTerimaUang,
} from '../src/core/forms.js';
import type { JurnalInput } from '../src/core/posting.js';
import type { Jurnal, JurnalBarisInput, JurnalJenis } from '../src/core/types.js';
import { COA } from '../src/db/coa.js';

const RP = (rupiah: number): number => rupiah * 100;

/** PRNG deterministik (mulberry32) — hasil test sama di setiap mesin. */
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

const totalJurnal = (db: Database.Database): number =>
  (db.prepare('SELECT COUNT(*) AS c FROM jurnal').get() as { c: number }).c;

function pastikanSeimbang(db: Database.Database, konteks: string): void {
  const baris = listBarisJurnal(db);
  const ns = neracaSaldo(baris);
  expect(ns.selisih, `${konteks}: selisih Neraca Saldo`).toBe(0);
  expect(ns.totalDebit, `${konteks}: total debit`).toBe(ns.totalKredit);
  expect(ns.seimbang, `${konteks}: badge seimbang`).toBe(true);
  const totalDebitBaris = baris.reduce((s, b) => s + b.debit, 0);
  const totalKreditBaris = baris.reduce((s, b) => s + b.kredit, 0);
  expect(totalDebitBaris, `${konteks}: debit baris = kredit baris`).toBe(totalKreditBaris);
}

function jurnalSeimbang(input: JurnalInput, nominal: number, konteks: string): void {
  let debit = 0;
  let kredit = 0;
  for (const b of input.baris) {
    expect(Number.isInteger(b.debit), `${konteks}: debit bulat`).toBe(true);
    expect(Number.isInteger(b.kredit), `${konteks}: kredit bulat`).toBe(true);
    expect(b.debit === 0 || b.kredit === 0, `${konteks}: satu sisi per baris`).toBe(true);
    expect(b.debit > 0 || b.kredit > 0, `${konteks}: nominal baris > 0`).toBe(true);
    debit += b.debit;
    kredit += b.kredit;
  }
  expect(debit, `${konteks}: debit = kredit`).toBe(kredit);
  expect(debit, `${konteks}: total = nominal`).toBe(nominal);
}

const D = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: nominal,
  kredit: 0,
});
const K = (akun: string, nominal: number): JurnalBarisInput => ({
  akun_kode: akun,
  debit: 0,
  kredit: nominal,
});

describe('P0-10 — 200 operasi acak-deterministik tetap seimbang', () => {
  it('Neraca Saldo nol setelah setiap operasi sukses; jurnal pincang ditolak', () => {
    const db = openDb(':memory:');
    try {
      // Saldo awal cukup untuk sebagian besar operasi; kas minus tetap diuji
      // lewat cabang khusus di bawah (konfirmasi sadar).
      const awal = postingJurnal(db, {
        header: {
          id: 'inv-awal',
          tanggal: '2025-01-01',
          no_bukti: 'INV-2025-0000',
          keterangan: 'Saldo awal uji invariant',
          jenis: 'SALDO_AWAL',
        },
        baris: [D('1001', RP(20_000_000)), D('1029', RP(20_000_000)), K('3000', RP(40_000_000))],
      });
      expect(awal.tersimpan, awal.errors.join(' ')).toBe(true);
      pastikanSeimbang(db, 'saldo awal');

      const rnd = mulberry32(20261022);
      const kas = ['1001', '1029', '1015'] as const;
      const pendapatan = ['4005', '4001', '4041', '4008'] as const;
      const beban = ['5000', '5010', '5004', '5003'] as const;

      let seq = 0;
      let panjarSisa = 0;
      let sudahTutup = false;
      const bisaDireversal: Jurnal[] = [];
      const jenisTerpakai = new Set<JurnalJenis>();

      const alasan = (): string | undefined =>
        sudahTutup ? 'Uji koreksi setelah tutup buku 2025' : undefined;

      /**
       * Simpan lewat satu pintu. Peringatan kas minus (bukan error) diuji:
       * percobaan pertama harus tertahan, lalu disimpan setelah konfirmasi.
       */
      const simpan = (input: JurnalInput, label: string): Jurnal => {
        const pertama = postingJurnal(db, input);
        if (!pertama.tersimpan && pertama.perluKonfirmasi) {
          expect(pertama.errors, `${label}: peringatan bukan error`).toEqual([]);
          const lanjut = postingJurnal(db, input, { konfirmasiPeringatan: true });
          expect(lanjut.tersimpan, `${label}: ${lanjut.errors.join(' ')}`).toBe(true);
          return lanjut.jurnal!;
        }
        expect(pertama.tersimpan, `${label}: ${pertama.errors.join(' ')}`).toBe(true);
        return pertama.jurnal!;
      };

      for (let i = 0; i < 200; i++) {
        // Tutup buku 2025 (tahun selesai, K2) di tengah rangkaian; sesudahnya
        // semua jurnal 2025 wajib beralasan (kunci periode longgar).
        if (i === 170) {
          const tutup = tutupBuku(db, 2025, {
            sekarang: '2026-10-22',
            catatan: 'Tutup buku uji invariant',
          });
          expect(tutup.tersimpan, tutup.errors.join(' ')).toBe(true);
          expect(tutup.aksi).toBe('TUTUP');
          expect(listTutupBuku(db)).toHaveLength(1);
          sudahTutup = true;
          pastikanSeimbang(db, `operasi #${i + 1} (tutup buku)`);
          continue;
        }

        const tanggal = `2025-${String(1 + Math.floor(rnd() * 12)).padStart(2, '0')}-${String(
          1 + Math.floor(rnd() * 27),
        ).padStart(2, '0')}`;
        const nominal = Math.max(100_000, Math.floor((rnd() * 50_000_000) / 100_000) * 100_000);
        seq += 1;
        const noBukti = `INV-2025-${String(seq).padStart(4, '0')}`;
        const id = `inv-${String(seq).padStart(4, '0')}`;

        const dasar = {
          tanggal,
          nominal,
          keterangan: `Operasi uji #${seq}`,
          noBukti,
          id,
          alasan: alasan(),
        };

        const operasi = i % 8;

        if (operasi === 6) {
          // Jurnal pincang harus ditolak dan tidak menulis apa pun.
          const sebelum = totalJurnal(db);
          const pincang = postingJurnal(db, {
            header: {
              id: `${id}-pincang`,
              tanggal,
              no_bukti: `${noBukti}-P`,
              keterangan: 'Sengaja tidak seimbang',
              jenis: 'UMUM',
            },
            baris: [D('1001', nominal), K('4005', nominal - 100)],
            alasan: alasan(),
          });
          expect(pincang.tersimpan).toBe(false);
          expect(pincang.errors.join(' ')).toMatch(/tidak seimbang/);
          expect(totalJurnal(db)).toBe(sebelum);
          continue;
        }

        if (operasi === 7) {
          // Kas minus: ditahan sampai operator mengonfirmasi (uji kedua arah).
          const sumber = '1010'; // saldo nol, pasti minus bila dipakai membayar
          const input = buatJurnalBayar({
            ...dasar,
            akunKas: sumber,
            akunLawan: pick(rnd, beban),
          });
          const belum = postingJurnal(db, input);
          expect(belum.tersimpan).toBe(false);
          expect(belum.perluKonfirmasi).toBe(true);
          expect(belum.peringatan.join(' ')).toMatch(/akan minus/);
          const konfirmasi = postingJurnal(db, input, { konfirmasiPeringatan: true });
          expect(konfirmasi.tersimpan, konfirmasi.errors.join(' ')).toBe(true);
          jenisTerpakai.add(input.header.jenis!);
          pastikanSeimbang(db, `operasi #${i + 1} (kas minus dikonfirmasi)`);
          continue;
        }

        let input: JurnalInput;
        if (operasi === 0 || operasi === 4) {
          input = buatJurnalTerimaUang({
            ...dasar,
            akunKas: pick(rnd, kas),
            akunLawan: rnd() < 0.15 ? '3000' : pick(rnd, pendapatan),
          });
        } else if (operasi === 1 || operasi === 5) {
          input = buatJurnalBayar({
            ...dasar,
            akunKas: pick(rnd, ['1001', '1029']),
            akunLawan: rnd() < 0.2 ? '2050' : pick(rnd, beban),
          });
        } else if (operasi === 2) {
          const dari = pick(rnd, ['1001', '1029']);
          const ke = dari === '1001' ? '1029' : '1001';
          input = buatJurnalPindahDana({ ...dasar, dari, ke });
        } else {
          // Panjar: serah bila belum ada, pertanggungjawaban bila ada sisa.
          if (panjarSisa <= 0 || rnd() < 0.5) {
            input = buatJurnalPanjarSerah({
              ...dasar,
              akunKas: pick(rnd, ['1001', '1029']),
            });
            panjarSisa += nominal;
          } else {
            const realisasi = Math.floor((panjarSisa * Math.floor(rnd() * 10)) / 10);
            const sisa = panjarSisa - realisasi;
            const baris: JurnalBarisInput[] = [];
            if (realisasi > 0) baris.push(D(pick(rnd, beban), realisasi));
            if (sisa > 0) baris.push(D('1001', sisa));
            baris.push(K('1040', panjarSisa));
            input = {
              header: {
                id,
                tanggal,
                keterangan: `Pertanggungjawaban panjar #${seq}`,
                no_bukti: noBukti,
                jenis: 'PANJAR',
              },
              baris,
              alasan: alasan(),
            };
            panjarSisa = 0;
          }
        }

        const jurnal = simpan(input, `operasi #${i + 1}`);
        jenisTerpakai.add(input.header.jenis!);
        if (['TERIMA', 'BAYAR', 'TRANSFER'].includes(input.header.jenis!))
          bisaDireversal.push(jurnal);
        pastikanSeimbang(db, `operasi #${i + 1}`);

        // Reversal sesekali: jurnal asli tetap ada, saldo kembali, tetap nol.
        if (operasi === 3 && bisaDireversal.length > 0 && rnd() < 0.5) {
          const target = bisaDireversal.shift()!;
          const balik = reverseJurnal(db, target.id, 'Koreksi uji invariant', {
            id: `rev-${target.id}`,
            tanggal: sudahTutup ? '2025-12-31' : tanggal,
            konfirmasiPeringatan: true,
          });
          expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);
          expect(balik.reversal?.reversal_of).toBe(target.id);
          jenisTerpakai.add('REVERSAL');
          pastikanSeimbang(db, `operasi #${i + 1} (reversal)`);
        }
      }

      // Seluruh cabang operasi benar-benar teruji.
      for (const jenis of ['TERIMA', 'BAYAR', 'TRANSFER', 'PANJAR', 'REVERSAL'] as const) {
        expect(jenisTerpakai.has(jenis), `jenis ${jenis} belum teruji`).toBe(true);
      }
      expect(listJurnal(db).length).toBeGreaterThan(150);
      expect(listTutupBuku(db)[0]?.tahun).toBe(2025);
      pastikanSeimbang(db, 'akhir rangkaian 200 operasi');

      // Jurnal pincang ditolak juga di luar loop, termasuk jurnal 1 baris.
      const sebelum = totalJurnal(db);
      const satuBaris = postingJurnal(db, {
        header: {
          id: 'inv-satu-baris',
          tanggal: '2025-06-01',
          keterangan: 'Satu baris',
          jenis: 'UMUM',
        },
        baris: [D('1001', RP(1_000))],
        alasan: 'Uji setelah tutup buku',
      });
      expect(satuBaris.tersimpan).toBe(false);
      expect(satuBaris.errors.join(' ')).toMatch(/minimal 2 baris/);
      expect(totalJurnal(db)).toBe(sebelum);
      pastikanSeimbang(db, 'setelah percobaan jurnal pincang');
    } finally {
      db.close();
    }
  });
});

describe('P0-10 — DB v2 fresh + seed dev', () => {
  it('skema lengkap tanpa tabel single-entry, laporan jalan, Neraca seimbang', () => {
    const db = openDb(':memory:');
    try {
      const tabel = (
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
          name: string;
        }[]
      ).map((t) => t.name);
      for (const wajib of [
        'jurnal',
        'jurnal_baris',
        'akun',
        'audit_log',
        'tutup_buku',
        'panjar',
        'panjar_item',
      ]) {
        expect(tabel, `tabel ${wajib} wajib ada`).toContain(wajib);
      }
      for (const lama of ['transaksi', 'coa']) {
        expect(tabel, `tabel single-entry ${lama} tidak boleh ada`).not.toContain(lama);
      }
      expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION);

      expect(seedDev(db)).toBe(SEED_DEV_JURNAL_COUNT);
      const baris = listBarisJurnal(db);
      expect(baris.length).toBeGreaterThan(SEED_DEV_JURNAL_COUNT);

      const ns = neracaSaldo(baris);
      expect(ns.selisih).toBe(0);
      expect(ns.totalDebit).toBe(ns.totalKredit);
      expect(ns.totalDebit).toBeGreaterThan(0);

      // Buku Besar semua akun COA harus bisa dibuka.
      for (const a of COA) {
        const bb = bukuBesar(baris, a.kode);
        expect(bb.kode).toBe(a.kode);
        expect(bb.saldoAkhir).toBe(saldoAkun(baris, a.kode));
      }
      const bbKas = bukuBesar(baris, '1001');
      expect(bbKas.rows.length).toBeGreaterThan(0);
      expect(bbKas.saldoAkhir).toBeGreaterThan(0);

      const lr = labaRugi(baris);
      expect(lr.totalPendapatan).toBeGreaterThan(0);
      expect(lr.totalBeban).toBeGreaterThan(0);
      expect(lr.laba).toBe(lr.totalPendapatan - lr.totalBeban);

      const n = neraca(baris, { cutoff: '2026-12-31', tutup: listTutupBuku(db) });
      expect(n.selisih).toBe(0);
      expect(n.balance).toBe(true);
      expect(n.totalAset).toBe(n.totalPasiva);

      const ak = arusKas(baris, { mulai: '2026-01-01', sampai: '2026-12-31' });
      expect(ak.saldoAwal).toBe(0);
      expect(ak.saldoAkhir).toBeGreaterThan(0);
      expect(ak.saldoAkhir).toBe(n.totalAset - saldoAkun(baris, '1040', '2026-12-31') - saldoAkun(baris, '1050', '2026-12-31'));
    } finally {
      db.close();
    }
  });
});

describe('P0-10 — koreksi setelah tutup buku tidak pernah selisih', () => {
  it('reversal + jurnal pengganti di periode terkunci tetap seimbang', () => {
    const db = openDb(':memory:');
    try {
      const modal = postingJurnal(db, {
        header: {
          id: 'k-modal',
          tanggal: '2025-01-01',
          no_bukti: 'K-2025-0001',
          keterangan: 'Modal awal',
          jenis: 'SALDO_AWAL',
        },
        baris: [D('1001', RP(10_000_000)), K('3000', RP(10_000_000))],
      });
      expect(modal.tersimpan).toBe(true);

      const parkir = postingJurnal(db, {
        header: {
          id: 'k-parkir',
          tanggal: '2025-03-01',
          no_bukti: 'K-2025-0002',
          keterangan: 'Pendapatan parkir',
          jenis: 'TERIMA',
        },
        baris: [D('1001', RP(1_000_000)), K('4005', RP(1_000_000))],
      });
      expect(parkir.tersimpan).toBe(true);

      const listrik = postingJurnal(db, {
        header: {
          id: 'k-listrik',
          tanggal: '2025-04-01',
          no_bukti: 'K-2025-0003',
          keterangan: 'Beban listrik',
          jenis: 'BAYAR',
        },
        baris: [D('5010', RP(250_000)), K('1001', RP(250_000))],
      });
      expect(listrik.tersimpan).toBe(true);

      const tutup = tutupBuku(db, 2025, {
        sekarang: '2026-10-22',
        catatan: 'Tutup 2025 sebelum koreksi',
      });
      expect(tutup.tersimpan).toBe(true);
      const tutupRef = listTutupBuku(db);
      expect(neraca(listBarisJurnal(db), { cutoff: '2026-12-31', tutup: tutupRef }).balance).toBe(
        true,
      );

      // Reversal saja, tanggal di periode terkunci + alasan.
      const balik = reverseJurnal(db, 'k-listrik', 'Beban listrik salah catat', {
        id: 'k-listrik-balik',
        tanggal: '2025-12-31',
      });
      expect(balik.tersimpan, balik.errors.join(' ')).toBe(true);
      expect(neracaSaldo(listBarisJurnal(db), '2025-12-31').selisih).toBe(0);
      expect(neracaSaldo(listBarisJurnal(db), '2026-12-31').selisih).toBe(0);

      // Koreksi & isi ulang: reversal + pengganti dalam satu alur atomik.
      const koreksi = koreksiDanIsiUlang(
        db,
        'k-parkir',
        'Nominal parkir salah, seharusnya 900rb',
        {
          header: {
            id: 'k-parkir-baru',
            tanggal: '2025-03-01',
            no_bukti: 'K-2025-0004',
            keterangan: 'Pendapatan parkir (koreksi)',
            jenis: 'TERIMA',
          },
          baris: [D('1001', RP(900_000)), K('4005', RP(900_000))],
        },
        { id: 'k-parkir-balik', tanggal: '2025-12-31' },
      );
      expect(koreksi.tersimpan, koreksi.errors.join(' ')).toBe(true);
      expect(koreksi.reversal?.reversal_of).toBe('k-parkir');
      expect(koreksi.jurnalBaru?.id).toBe('k-parkir-baru');

      for (const cutoff of ['2025-12-31', '2026-06-30', '2026-12-31']) {
        const ns = neracaSaldo(listBarisJurnal(db), cutoff);
        expect(ns.selisih, `cutoff ${cutoff}`).toBe(0);
        expect(ns.totalDebit, `cutoff ${cutoff}`).toBe(ns.totalKredit);
        const n = neraca(listBarisJurnal(db), { cutoff, tutup: tutupRef });
        expect(n.selisih, `Neraca ${cutoff}`).toBe(0);
        expect(n.balance, `Neraca ${cutoff}`).toBe(true);
      }

      // Jurnal asli tetap ada; angka berasal dari jurnal, bukan snapshot.
      expect(listJurnal(db).map((j) => j.id)).toEqual(
        expect.arrayContaining(['k-parkir', 'k-parkir-balik', 'k-parkir-baru', 'k-listrik']),
      );
      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '4005', '2026-12-31')).toBe(RP(900_000));
      expect(saldoAkun(baris, '5010', '2026-12-31')).toBe(0);
    } finally {
      db.close();
    }
  });
});

describe('P0-10 — builder form terpandu (P1-1..P1-4)', () => {
  it('tiap builder menghasilkan jurnal seimbang, akun & nominal benar', () => {
    const terima = buatJurnalTerimaUang({
      tanggal: '2026-01-02',
      akunKas: '1001',
      akunLawan: '4005',
      nominal: RP(100_000),
      keterangan: 'Uang parkir minggu I',
      noBukti: 'JU-2026-0001',
      id: 'form-terima',
    });
    expect(terima.header).toMatchObject({
      id: 'form-terima',
      tanggal: '2026-01-02',
      no_bukti: 'JU-2026-0001',
      keterangan: 'Uang parkir minggu I',
      jenis: 'TERIMA',
    });
    expect(terima.baris).toEqual([
      { akun_kode: '1001', debit: RP(100_000), kredit: 0 },
      { akun_kode: '4005', debit: 0, kredit: RP(100_000) },
    ]);
    jurnalSeimbang(terima, RP(100_000), 'terima uang');

    const modal = buatJurnalTerimaUang({
      tanggal: '2026-01-01',
      akunKas: '1029',
      akunLawan: '3000',
      nominal: RP(5_000_000),
      keterangan: 'Setoran modal',
      id: 'form-modal',
    });
    expect(modal.header.jenis).toBe('TERIMA');
    expect(modal.baris).toEqual([
      { akun_kode: '1029', debit: RP(5_000_000), kredit: 0 },
      { akun_kode: '3000', debit: 0, kredit: RP(5_000_000) },
    ]);
    jurnalSeimbang(modal, RP(5_000_000), 'setoran modal');

    const bayar = buatJurnalBayar({
      tanggal: '2026-01-03',
      akunKas: '1001',
      akunLawan: '5010',
      nominal: RP(75_000),
      keterangan: 'Bayar listrik',
      id: 'form-bayar',
    });
    expect(bayar.header.jenis).toBe('BAYAR');
    expect(bayar.baris).toEqual([
      { akun_kode: '5010', debit: RP(75_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(75_000) },
    ]);
    jurnalSeimbang(bayar, RP(75_000), 'bayar');

    const pindah = buatJurnalPindahDana({
      tanggal: '2026-01-04',
      dari: '1001',
      ke: '1029',
      nominal: RP(1_000_000),
      keterangan: 'Pindah kas ke bank',
      id: 'form-pindah',
    });
    expect(pindah.header.jenis).toBe('TRANSFER');
    expect(pindah.baris).toEqual([
      { akun_kode: '1029', debit: RP(1_000_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(1_000_000) },
    ]);
    jurnalSeimbang(pindah, RP(1_000_000), 'pindah dana');

    const panjar = buatJurnalPanjarSerah({
      tanggal: '2026-01-05',
      akunKas: '1001',
      nominal: RP(300_000),
      keterangan: 'Serah panjar piodalan',
      id: 'form-panjar',
      alasan: 'Panjar untuk panitia',
    });
    expect(panjar.header.jenis).toBe('PANJAR');
    expect(panjar.alasan).toBe('Panjar untuk panitia');
    expect(panjar.baris).toEqual([
      { akun_kode: '1040', debit: RP(300_000), kredit: 0 },
      { akun_kode: '1001', debit: 0, kredit: RP(300_000) },
    ]);
    jurnalSeimbang(panjar, RP(300_000), 'panjar serah');
  });

  it('bisa disimpan lewat posting layer tanpa pengetahuan debit/kredit', () => {
    const db = openDb(':memory:');
    try {
      const daftar = [
        buatJurnalTerimaUang({
          tanggal: '2026-01-01',
          akunKas: '1001',
          akunLawan: '3000',
          nominal: RP(1_000_000),
          keterangan: 'Modal awal',
          noBukti: 'F-2026-0001',
          id: 'f-modal',
        }),
        buatJurnalTerimaUang({
          tanggal: '2026-01-02',
          akunKas: '1001',
          akunLawan: '4005',
          nominal: RP(200_000),
          keterangan: 'Parkir',
          noBukti: 'F-2026-0002',
          id: 'f-terima',
        }),
        buatJurnalBayar({
          tanggal: '2026-01-03',
          akunKas: '1001',
          akunLawan: '5000',
          nominal: RP(100_000),
          keterangan: 'Alat tulis',
          noBukti: 'F-2026-0003',
          id: 'f-bayar',
        }),
        buatJurnalPindahDana({
          tanggal: '2026-01-04',
          dari: '1001',
          ke: '1029',
          nominal: RP(300_000),
          keterangan: 'Setor ke bank',
          noBukti: 'F-2026-0004',
          id: 'f-pindah',
        }),
        buatJurnalPanjarSerah({
          tanggal: '2026-01-05',
          akunKas: '1001',
          nominal: RP(150_000),
          keterangan: 'Panjar',
          noBukti: 'F-2026-0005',
          id: 'f-panjar',
        }),
      ];

      for (const input of daftar) {
        const hasil = postingJurnal(db, input);
        expect(hasil.tersimpan, hasil.errors.join(' ')).toBe(true);
      }

      const baris = listBarisJurnal(db);
      expect(saldoAkun(baris, '1001')).toBe(RP(650_000));
      expect(saldoAkun(baris, '1029')).toBe(RP(300_000));
      expect(saldoAkun(baris, '1040')).toBe(RP(150_000));
      expect(saldoAkun(baris, '4005')).toBe(RP(200_000));
      expect(saldoAkun(baris, '5000')).toBe(RP(100_000));
      expect(neracaSaldo(baris).selisih).toBe(0);
      const n = neraca(baris, '2026-12-31');
      expect(n.balance).toBe(true);
    } finally {
      db.close();
    }
  });

  it('menolak input tidak valid dengan pesan berbahasa Indonesia', () => {
    const terima = {
      tanggal: '2026-01-02',
      akunKas: '1001',
      akunLawan: '4005',
      nominal: RP(10_000),
      keterangan: 'Uji',
    };

    expect(() => buatJurnalTerimaUang({ ...terima, tanggal: '2026-02-31' })).toThrow(/Tanggal/);
    expect(() => buatJurnalTerimaUang({ ...terima, tanggal: '02-01-2026' })).toThrow(/Tanggal/);
    expect(() => buatJurnalTerimaUang({ ...terima, nominal: 0 })).toThrow(/Nominal/);
    expect(() => buatJurnalTerimaUang({ ...terima, nominal: -1 })).toThrow(/Nominal/);
    expect(() => buatJurnalTerimaUang({ ...terima, nominal: 1.5 })).toThrow(/Nominal/);
    expect(() => buatJurnalTerimaUang({ ...terima, keterangan: '   ' })).toThrow(/Keterangan/);
    expect(() => buatJurnalTerimaUang({ ...terima, akunKas: '' })).toThrow(/Akun kas/);
    expect(() => buatJurnalTerimaUang({ ...terima, akunKas: '4005' })).toThrow(/kas\/bank/);
    expect(() => buatJurnalTerimaUang({ ...terima, akunLawan: '5000' })).toThrow(
      /pendapatan atau 3000 MODAL/,
    );
    expect(() => buatJurnalTerimaUang({ ...terima, akunLawan: '9999' })).toThrow(/tidak dikenal/);

    expect(() =>
      buatJurnalBayar({ ...terima, akunLawan: '1029' }),
    ).toThrow(/Pindah Dana/);
    expect(() =>
      buatJurnalPindahDana({ ...terima, dari: '1001', ke: '1001' }),
    ).toThrow(/berbeda/);
    expect(() =>
      buatJurnalPindahDana({ ...terima, dari: '1001', ke: '5000' }),
    ).toThrow(/kas\/bank/);
    expect(() => buatJurnalPanjarSerah({ ...terima, akunKas: '5000' })).toThrow(/kas\/bank/);

    // Builder seimbang tetap bisa dipakai untuk periode terkunci dengan alasan.
    const terkunci = buatJurnalBayar({
      ...terima,
      akunLawan: '5000',
      alasan: 'Koreksi periode terkunci',
    });
    expect(terkunci.alasan).toBe('Koreksi periode terkunci');
    jurnalSeimbang(terkunci, RP(10_000), 'bayar terkunci');
  });
});
