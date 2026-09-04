// Adapter sumber data: mock (dev/browser) vs SQLite asli (Node/Electron).
// Keduanya memenuhi interface yang sama — logika laporan TIDAK berubah,
// tinggal ganti import. Contoh:
//   import { getTransaksiMock } from './__mocks__/data.js';      // dev/browser
//   import { listTransaksi } from '../../../db/repository.js';   // DB asli:
//     const getTransaksi: GetTransaksi = (f) => listTransaksi(db, f ?? {});

import type Database from 'better-sqlite3';
import { listTransaksi } from '../../db/repository.js';
import type { Transaksi } from '../../core/types.js';
import type { TransaksiFilter } from './__mocks__/data.js';

export type { TransaksiFilter };
export type DbGetter = (filter?: TransaksiFilter) => Transaksi[];

/** Bungkus repository SQLite jadi getter yang setara dengan getTransaksiMock. */
export function makeDbGetter(db: Database.Database): DbGetter {
  return (filter = {}) => listTransaksi(db, filter);
}
