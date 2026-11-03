import { useEffect, useState } from 'react';
import type { Coa } from '../../db/coa.js';
import { api } from '../lib/api.js';
import { lupakanMulaiTanpaSaldoAwal } from '../lib/saldoAwal.js';
import { pesanError } from '../../utils/pesanError.js';
import { Button, ErrorBox, Modal } from './ui.js';
import { SaldoAwalWizard } from './SaldoAwalWizard.js';

/**
 * Modal guard saldo awal (AKT-02).
 *
 * Dipakai semua pintu input saat backend menolak jurnal pertama. Operator bisa
 * langsung membuka Wizard Saldo Awal atau memilih mulai tanpa saldo awal;
 * pilihan terakhir diteruskan ke backend oleh form pemanggil.
 */
export function SaldoAwalGuard({
  terbuka,
  sibuk = false,
  coa: coaAwal,
  onBatal,
  onMulaiTanpa,
  onSaldoAwalTersimpan,
}: {
  terbuka: boolean;
  sibuk?: boolean;
  /** COA yang sudah dimuat tab; bila kosong guard memuat sendiri. */
  coa?: Coa[];
  onBatal: () => void;
  onMulaiTanpa: () => void;
  onSaldoAwalTersimpan: (pesan: string) => void;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [coa, setCoa] = useState<Coa[]>(coaAwal ?? []);
  const [memuatCoa, setMemuatCoa] = useState(false);
  const [tanggalMaksimal, setTanggalMaksimal] = useState<string | undefined>();
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (terbuka) return;
    setWizardOpen(false);
    setTanggalMaksimal(undefined);
    setErr(null);
  }, [terbuka]);

  useEffect(() => {
    if (!coaAwal || coaAwal.length === 0) return;
    setCoa(coaAwal);
  }, [coaAwal]);

  async function bukaWizard(): Promise<void> {
    setErr(null);
    setMemuatCoa(true);
    try {
      // AUD2-02: batas tanggal ikut dimuat agar wizard dari guard pun tidak
      // menawarkan tanggal setelah jurnal pertama. Kegagalan status tidak
      // memblokir wizard; backend tetap memvalidasi saat menyimpan.
      const [daftarCoa, status] = await Promise.all([
        coa.length > 0 ? Promise.resolve(coa) : api.coa(),
        api.saldoAwalStatus().catch(() => null),
      ]);
      if (coa.length === 0) setCoa(daftarCoa);
      setTanggalMaksimal(status?.tanggalMaksimal);
      setWizardOpen(true);
    } catch (e) {
      setErr(
        pesanError(
          e,
          'Gagal memuat daftar akun untuk Wizard Saldo Awal. Coba lagi atau hubungi pendamping.',
        ),
      );
    } finally {
      setMemuatCoa(false);
    }
  }

  if (!terbuka) return null;

  if (wizardOpen) {
    return (
      <SaldoAwalWizard
        coa={coa}
        tanggalMaksimal={tanggalMaksimal}
        onClose={() => setWizardOpen(false)}
        onSukses={(pesan) => {
          setWizardOpen(false);
          lupakanMulaiTanpaSaldoAwal();
          onSaldoAwalTersimpan(pesan);
        }}
      />
    );
  }

  return (
    <Modal
      judul="Belum ada saldo awal"
      deskripsi="Jurnal pertama menentukan titik mulai pembukuan. Pilih salah satu agar catatan keuangan tidak kehilangan saldo awal."
      onTutup={onBatal}
      sibuk={sibuk}
    >
      <p className="text-[15px] text-stone-700">
        Belum ada saldo awal. Isi saldo awal dulu, atau mulai tanpa saldo awal.
      </p>
      {err && (
        <div className="mt-3">
          <ErrorBox msg={err} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={sibuk || memuatCoa} onClick={() => void bukaWizard()}>
          {memuatCoa ? 'Memuat…' : 'Isi Saldo Awal'}
        </Button>
        <Button variant="ghost" disabled={sibuk} onClick={onMulaiTanpa}>
          Mulai tanpa saldo awal
        </Button>
        <Button variant="ghost" disabled={sibuk} onClick={onBatal}>
          Batal
        </Button>
      </div>
    </Modal>
  );
}
