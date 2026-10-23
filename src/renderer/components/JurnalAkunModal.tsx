import { useEffect, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { api, type JurnalLengkap } from '../lib/api.js';
import { Badge, Button } from './ui.js';
import { DetailJurnalModal } from './DetailJurnalModal.js';

function pesanError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Daftar jurnal yang menyentuh satu akun pada periode laporan (drill-down
 * P1-9). Klik satu jurnal untuk membuka DetailJurnalModal dengan seluruh
 * baris debit/kredit. Tidak ada angka yang dihitung ulang di sini: daftar dan
 * nominal per akun berasal dari `laporan:jurnal-akun`.
 */
export function JurnalAkunModal({
  akunKode,
  akunNama,
  mulai,
  sampai,
  coa,
  onClose,
}: {
  akunKode: string;
  akunNama: string;
  mulai?: string;
  sampai?: string;
  coa: Coa[];
  onClose: () => void;
}) {
  const [daftar, setDaftar] = useState<JurnalLengkap[] | null>(null);
  const [detail, setDetail] = useState<JurnalLengkap | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let aktif = true;
    setErr(null);
    setDaftar(null);
    api
      .laporanJurnalAkun({
        akun_kode: akunKode,
        ...(mulai ? { mulai } : {}),
        ...(sampai ? { sampai } : {}),
      })
      .then((hasil) => {
        if (aktif) setDaftar(hasil);
      })
      .catch((e) => {
        if (aktif) {
          setDaftar([]);
          setErr(pesanError(e));
        }
      });
    return () => {
      aktif = false;
    };
  }, [akunKode, mulai, sampai]);

  function nominalAkun(jurnal: JurnalLengkap): { debit: number; kredit: number } {
    let debit = 0;
    let kredit = 0;
    for (const b of jurnal.baris) {
      if (b.akun_kode !== akunKode) continue;
      debit += b.debit;
      kredit += b.kredit;
    }
    return { debit, kredit };
  }

  return (
    <>
      <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
        <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white p-5 shadow-lg">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-bold">Jurnal akun {akunKode}</h3>
              <p className="text-sm text-stone-600">{akunNama}</p>
              <p className="mt-1 text-sm text-stone-600">
                Periode: {mulai ? formatTanggal(mulai) : 'awal'} s/d{' '}
                {sampai ? formatTanggal(sampai) : 'akhir'} · klik jurnal untuk melihat
                debit/kredit lengkap.
              </p>
            </div>
            <Badge tone="green">Dihitung dari jurnal</Badge>
          </div>

          {err && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-[15px] text-red-800">
              {err}
            </div>
          )}
          {!daftar && !err && (
            <p className="mt-3 text-stone-500">Memuat daftar jurnal…</p>
          )}
          {daftar && daftar.length === 0 && !err && (
            <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
              Tidak ada jurnal untuk akun ini pada periode tersebut.
            </p>
          )}

          {daftar && daftar.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[15px]">
                <thead>
                  <tr className="border-b text-stone-500">
                    <th className="py-2 pr-3">Tanggal</th>
                    <th className="py-2 pr-3">No. Bukti</th>
                    <th className="py-2 pr-3">Keterangan</th>
                    <th className="py-2 pr-3 text-right">Debit</th>
                    <th className="py-2 text-right">Kredit</th>
                  </tr>
                </thead>
                <tbody>
                  {daftar.map((j) => {
                    const n = nominalAkun(j);
                    return (
                      <tr
                        key={j.id}
                        className="cursor-pointer border-b align-top last:border-0 hover:bg-emerald-50"
                        tabIndex={0}
                        title="Klik untuk melihat detail jurnal"
                        onClick={() => setDetail(j)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setDetail(j);
                          }
                        }}
                      >
                        <td className="whitespace-nowrap py-2 pr-3">
                          {formatTanggal(j.tanggal)}
                        </td>
                        <td className="whitespace-nowrap py-2 pr-3">
                          {j.no_bukti || '—'}
                        </td>
                        <td className="py-2 pr-3">{j.keterangan || '—'}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-right">
                          {n.debit ? formatRp(n.debit) : ''}
                        </td>
                        <td className="whitespace-nowrap py-2 text-right">
                          {n.kredit ? formatRp(n.kredit) : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>
      </div>

      {detail && (
        <DetailJurnalModal
          jurnal={detail}
          coa={coa}
          onClose={() => setDetail(null)}
        />
      )}
    </>
  );
}
