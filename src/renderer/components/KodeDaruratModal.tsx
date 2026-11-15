import { useState } from 'react';
import { Button, KonfirmasiModal, Modal } from './ui.js';

/**
 * Modal “tampil sekali” untuk kode darurat per-install (AUD-19).
 *
 * Plaintext hanya diterima lewat props dari respons IPC; modal ini tidak pernah
 * membacanya dari database. Setelah ditutup, kode tidak bisa ditampilkan lagi —
 * pengguna harus mencatatnya sekarang atau membuat kode baru di Pengaturan.
 *
 * UI-A26: dibangun di atas Modal bersama agar dapat focus trap, tombol Escape,
 * dan pengembalian fokus ke pemicu seperti modal lain di aplikasi.
 *
 * UI-A28: kode ini satu-satunya salinan. Escape/backdrop/X tidak boleh langsung
 * membuangnya; minta konfirmasi lebih dulu dan sediakan tombol salin.
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
  const [konfirmasiTutup, setKonfirmasiTutup] = useState(false);
  const [statusSalin, setStatusSalin] = useState<'idle' | 'ok' | 'gagal'>('idle');

  async function salin(): Promise<void> {
    try {
      await navigator.clipboard.writeText(kode);
      setStatusSalin('ok');
    } catch {
      setStatusSalin('gagal');
    }
  }

  return (
    <>
      <Modal
        judul={judul}
        onTutup={() => setKonfirmasiTutup(true)}
        lebar="lg"
      >
        <p className="text-[15px] text-stone-700">
          Kode ini hanya ditampilkan <b>satu kali</b>. Tidak ada salinan lain di
          aplikasi — catat sekarang dan simpan di tempat aman.
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
            <li>Simpan di tempat terpisah dari laptop, bukan di folder aplikasi.</li>
            <li>Jangan mengirimnya lewat chat atau menempelkannya di laptop.</li>
          </ol>
          <p className="mt-2">
            Kode lama (bila ada) langsung tidak berlaku setelah kode baru dibuat.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <p className="mr-auto text-sm text-stone-600" role="status">
            {statusSalin === 'ok'
              ? 'Kode disalin. Tempel di tempat aman, lalu hapus dari clipboard.'
              : statusSalin === 'gagal'
                ? 'Gagal menyalin otomatis. Catat kode secara manual.'
                : ''}
          </p>
          <Button variant="ghost" autoFocus onClick={() => void salin()}>
            Salin kode
          </Button>
          <Button onClick={onTutup}>Saya sudah mencatat</Button>
        </div>
      </Modal>
      {konfirmasiTutup && (
        <KonfirmasiModal
          judul="Tutup tanpa mencatat kode?"
          deskripsi="Kode darurat tidak bisa ditampilkan lagi. Bila kode ini belum dicatat, Anda tidak bisa memulihkan akses saat PIN lupa."
          labelYa="Ya, tutup"
          labelBatal="Kembali ke kode"
          onBatal={() => setKonfirmasiTutup(false)}
          onKonfirmasi={onTutup}
        />
      )}
    </>
  );
}
