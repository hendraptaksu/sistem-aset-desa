import type { Coa } from '../../db/coa.js';
import type { JurnalLengkap } from '../lib/api.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { Badge, Button } from './ui.js';

const LABEL_JENIS: Record<string, string> = {
  UMUM: 'Jurnal Umum',
  TERIMA: 'Terima Uang',
  BAYAR: 'Bayar / Beban',
  TRANSFER: 'Pindah Dana',
  PANJAR: 'Panjar',
  PIUTANG: 'Piutang',
  HUTANG: 'Hutang',
  SALDO_AWAL: 'Saldo Awal',
  REVERSAL: 'Jurnal Balik',
};

function namaAkun(coa: Coa[], kode: string): string {
  const akun = coa.find((a) => a.kode === kode);
  return akun ? `${akun.kode} — ${akun.nama}` : kode;
}

/**
 * Modal detail jurnal untuk drill-down laporan (P1-8). Bentuknya mengikuti
 * modal Detail Jurnal di JurnalTab: no. bukti, tanggal, keterangan, status
 * koreksi, dan semua baris debit/kredit.
 */
export function DetailJurnalModal({
  jurnal,
  coa,
  onClose,
}: {
  jurnal: JurnalLengkap;
  coa: Coa[];
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h3 className="text-lg font-bold">Detail Jurnal</h3>
          <div className="flex flex-wrap gap-2">
            {jurnal.reversal_of && <Badge tone="red">Jurnal balik</Badge>}
            {jurnal.reversal_id && <Badge tone="amber">Sudah dikoreksi</Badge>}
            {!jurnal.reversal_of && !jurnal.reversal_id && (
              <Badge tone="green">Aktif</Badge>
            )}
          </div>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[15px]">
          <p>
            <span className="text-stone-500">Tanggal: </span>
            {formatTanggal(jurnal.tanggal)}
          </p>
          <p>
            <span className="text-stone-500">No. Bukti: </span>
            {jurnal.no_bukti || '—'}
          </p>
          <p>
            <span className="text-stone-500">Jenis: </span>
            {LABEL_JENIS[jurnal.jenis] ?? jurnal.jenis}
          </p>
          <p>
            <span className="text-stone-500">ID: </span>
            <span className="break-all">{jurnal.id}</span>
          </p>
        </div>
        <p className="mt-2 text-[15px]">
          <span className="text-stone-500">Keterangan: </span>
          {jurnal.keterangan}
        </p>
        {jurnal.reversal_of && (
          <p className="mt-1 text-sm text-stone-600">
            Jurnal ini membalik jurnal <b>{jurnal.reversal_of}</b>.
          </p>
        )}
        {jurnal.reversal_id && (
          <p className="mt-1 text-sm text-stone-600">
            Jurnal ini sudah dikoreksi oleh <b>{jurnal.reversal_id}</b>.
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-[15px]">
            <thead>
              <tr className="border-b text-stone-500">
                <th className="py-2 pr-3">Akun</th>
                <th className="py-2 pr-3">Catatan</th>
                <th className="py-2 pr-3 text-right">Debit</th>
                <th className="py-2 text-right">Kredit</th>
              </tr>
            </thead>
            <tbody>
              {jurnal.baris.map((b) => (
                <tr key={b.id} className="border-b last:border-0">
                  <td className="py-2 pr-3">{namaAkun(coa, b.akun_kode)}</td>
                  <td className="py-2 pr-3 text-stone-600">{b.keterangan || '—'}</td>
                  <td className="py-2 pr-3 text-right">
                    {b.debit ? formatRp(b.debit) : ''}
                  </td>
                  <td className="py-2 text-right">
                    {b.kredit ? formatRp(b.kredit) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold">
                <td colSpan={2} className="py-2 pr-3 text-right">
                  Total:
                </td>
                <td className="py-2 pr-3 text-right">{formatRp(jurnal.total_debit)}</td>
                <td className="py-2 text-right">{formatRp(jurnal.total_debit)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Tutup
          </Button>
        </div>
      </div>
    </div>
  );
}
