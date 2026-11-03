import { petunjukAkunKembar } from '../lib/petunjukAkun.js';

/**
 * Teks bantu di bawah dropdown akun. Komponen ini murni mengikuti prop `kode`,
 * sehingga petunjuk otomatis berganti atau hilang saat operator memilih akun
 * lain. Akun tanpa kembaran tidak merender apa pun.
 */
export function PetunjukAkunKembar({
  kode,
}: {
  kode: string | null | undefined;
}) {
  const pesan = petunjukAkunKembar(kode);
  if (!pesan) return null;

  return (
    <span
      role="note"
      data-petunjuk-akun={String(kode ?? '').trim()}
      className="mt-1 block rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5 text-helper text-stone-600"
    >
      {pesan}
    </span>
  );
}
