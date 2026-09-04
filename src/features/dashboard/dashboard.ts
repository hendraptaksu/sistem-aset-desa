// Dashboard (read saja) — Saldo Kas Tunai, Total LPD, badge Balance.
// WAJIB baca dari query ledger (saldoKas/saldoSemuaKas/neraca), jangan hitung ulang beda cara.

import { LPD_KODES } from '../../db/coa.js';
import { neraca, saldoKas, saldoSemuaKas } from '../../core/ledger.js';
import type { Panjar, Transaksi, TutupBuku } from '../../core/types.js';

export { LPD_KODES };

export type DashboardHasil = {
  cutoff: string;
  kasTunai: number;
  totalLpd: number;
  rincianLpd: Record<string, number>;
  aktiva: number;
  pasiva: number;
  selisih: number;
  balance: boolean;
  badge: string;
};

export function buildDashboard(
  transaksi: Transaksi[],
  panjar: Panjar[],
  tutup: TutupBuku[],
  cutoff: string,
  kasKodes: string[],
): DashboardHasil {
  const kasTunai = saldoKas(transaksi, '1001', cutoff);
  const semua = saldoSemuaKas(transaksi, kasKodes, cutoff);
  const rincianLpd: Record<string, number> = {};
  for (const k of LPD_KODES) rincianLpd[k] = semua[k] ?? 0;
  const totalLpd = Object.values(rincianLpd).reduce((s, v) => s + v, 0);
  const n = neraca(transaksi, panjar, tutup, cutoff, kasKodes);
  return {
    cutoff,
    kasTunai,
    totalLpd,
    rincianLpd,
    aktiva: n.aktiva,
    pasiva: n.pasiva,
    selisih: n.selisih,
    balance: n.balance,
    badge: n.balance ? 'BALANCE' : `SELISIH ${n.selisih}`,
  };
}
