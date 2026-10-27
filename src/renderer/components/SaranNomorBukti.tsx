import { useEffect, useState } from 'react';
import { tanggalKalenderValid } from '../../core/posting.js';
import { api } from '../lib/api.js';

/**
 * Ambil saran nomor bukti berikutnya dari server setiap tanggal berubah
 * (P1-11). Saran hanya petunjuk: nomor final tetap diberikan atomik oleh
 * `insertJurnal` bila operator mengosongkan kolom.
 */
export function useSaranNomorBukti(tanggal: string): string | null {
  const [nomor, setNomor] = useState<string | null>(null);

  useEffect(() => {
    let aktif = true;
    if (!tanggalKalenderValid(tanggal)) {
      setNomor(null);
      return () => {
        aktif = false;
      };
    }
    // Tanggal berubah → saran lama tidak boleh menempel.
    setNomor(null);
    const timer = setTimeout(() => {
      api
        .jurnalNomorBerikutnya(tanggal)
        .then((r) => {
          if (aktif) setNomor(r.nomor);
        })
        .catch(() => {
          if (aktif) setNomor(null);
        });
    }, 120);
    return () => {
      aktif = false;
      clearTimeout(timer);
    };
  }, [tanggal]);

  return nomor;
}

/** Keterangan saran nomor yang dipakai semua form jurnal. */
export function SaranNomorBukti({
  tanggal,
  className = 'mt-1 text-helper text-stone-500',
}: {
  tanggal: string;
  className?: string;
}) {
  const nomor = useSaranNomorBukti(tanggal);
  return (
    <p className={className}>
      Pratinjau nomor bukti: <b>{nomor ?? 'otomatis saat disimpan'}</b>. Nomor
      boleh diedit; bila dikosongkan sistem memakai nomor berikutnya dan nomor
      wajib unik.
    </p>
  );
}
