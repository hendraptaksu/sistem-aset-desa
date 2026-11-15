import { Button, Modal } from './ui.js';

/**
 * Modal “tampil sekali” untuk kode darurat per-install (AUD-19).
 *
 * Plaintext hanya diterima lewat props dari respons IPC; modal ini tidak pernah
 * membacanya dari database. Setelah ditutup, kode tidak bisa ditampilkan lagi —
 * pengguna harus mencatatnya sekarang atau membuat kode baru di Pengaturan.
 *
 * UI-A26: dibangun di atas Modal bersama agar dapat focus trap, tombol Escape,
 * dan pengembalian fokus ke pemicu seperti modal lain di aplikasi.
 */
export function KodeDaruratModal({
  kode,
  onTutup,
  judul = 'Simpan kode darurat ini',
}: {
  kode: string;
  onTutup: () => void;
  judul?: string;
}) {
  return (
    <Modal judul={judul} onTutup={onTutup} lebar="lg">
      <p className="text-[15px] text-stone-700">
        Kode ini hanya ditampilkan <b>satu kali</b>. Tidak ada salinan lain di
        aplikasi atau database — yang tersimpan hanya hash.
      </p>
      <div
        data-testid="kode-darurat"
        className="mt-3 select-all break-all rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-3 text-center font-mono text-xl font-bold tracking-wider text-emerald-950"
      >
        {kode}
      </div>
      <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
        <p className="font-semibold">Lakukan sekarang:</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>Tulis kode ini di kertas atau dokumen fisik.</li>
          <li>Simpan terpisah dari laptop, jangan di folder data/aplikasi.</li>
          <li>Jangan kirim lewat chat atau menempelkannya di laptop.</li>
        </ol>
        <p className="mt-2">
          Kode lama (bila ada) langsung tidak berlaku setelah kode baru dibuat.
        </p>
      </div>
      <div className="mt-4 flex justify-end">
        <Button autoFocus onClick={onTutup}>
          Saya sudah mencatat
        </Button>
      </div>
    </Modal>
  );
}
