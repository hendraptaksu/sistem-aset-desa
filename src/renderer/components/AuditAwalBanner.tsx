// T-A16: banner ringkas temuan audit integritas yang dijalankan saat startup.
//
// Banner tidak memblokir aplikasi dan tidak menawarkan perbaikan otomatis.
// Tujuannya hanya agar operator melihat temuan tanpa harus membuka log.
//
// UI-A08: banner hanyalah pemberitahuan awal; tempat melihat ulang seluruh
// temuan adalah kartu "Audit Integritas" di tab Pengaturan (tombol banner
// membuka kartu itu). Menutup banner temuan kritis wajib lewat konfirmasi
// agar temuan tidak hilang karena satu klik tanpa sengaja.

import { useState } from 'react';
import { AlertTriangle, ShieldAlert, X } from 'lucide-react';
import { clsx } from 'clsx';
import type { RingkasanAuditAwal } from '../../core/auditAwalRingkasan.js';
import { Badge, Button, KonfirmasiModal, RING_FOKUS } from './ui.js';

export function AuditAwalBanner({
  ringkasan,
  onBukaAudit,
  onTutup,
}: {
  ringkasan: RingkasanAuditAwal | null;
  onBukaAudit: () => void;
  onTutup: () => void;
}) {
  // UI-A08: hanya penutupan temuan kritis yang lewat konfirmasi; state ini
  // tidak berpengaruh pada banner non-kritis yang boleh ditutup langsung.
  const [konfirmasiTutup, setKonfirmasiTutup] = useState(false);

  if (!ringkasan || ringkasan.jumlahTemuan === 0) return null;

  const kritis = ringkasan.adaKritis;
  const Icon = kritis ? ShieldAlert : AlertTriangle;
  const sisa = ringkasan.jumlahTemuan - ringkasan.temuanTampil.length;

  return (
    <section
      role="alert"
      aria-live="polite"
      aria-label="Temuan audit integritas saat aplikasi mulai"
      data-testid="audit-awal-banner"
      className={clsx(
        'rounded-xl border p-4 shadow-sm',
        kritis
          ? 'border-red-300 bg-red-50 text-red-950'
          : 'border-amber-300 bg-amber-50 text-amber-950',
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <Icon
            size={22}
            aria-hidden="true"
            className={clsx('mt-0.5 shrink-0', kritis ? 'text-red-700' : 'text-amber-700')}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">
                {kritis
                  ? 'Audit integritas menemukan masalah kritis'
                  : 'Audit integritas menemukan masalah'}
              </h2>
              <Badge tone={kritis ? 'red' : 'amber'}>
                {ringkasan.jumlahTemuan} temuan
              </Badge>
            </div>
            <p className="mt-1 text-sm">
              Ditemukan saat aplikasi mulai. Data tidak diubah otomatis; periksa sebelum
              melanjutkan pembukuan.
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {ringkasan.temuanTampil.map((temuan, index) => (
                <li key={`${temuan.kode}-${index}`} className="break-words">
                  <span>{temuan.pesan}</span>
                </li>
              ))}
            </ul>
            {sisa > 0 && (
              <p className="mt-1 text-sm font-medium">
                +{sisa} temuan lain. Buka Audit Integritas untuk memeriksa semuanya.
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant={kritis ? 'danger' : 'primary'}
                onClick={onBukaAudit}
              >
                Buka Audit Integritas
              </Button>
              {/* UI-A08: temuan kritis tidak bisa diabaikan satu klik —
                  tutup wajib lewat konfirmasi agar operator menyadari risiko. */}
              <Button
                variant="ghost"
                onClick={kritis ? () => setKonfirmasiTutup(true) : onTutup}
              >
                Abaikan
              </Button>
            </div>
          </div>
        </div>
        {/* UI-A08: tombol X disembunyikan untuk temuan kritis supaya tidak ada
            jalur menutup tanpa konfirmasi; kartu Pengaturan tetap tempat
            melihat ulang temuan sampai sesi berakhir. */}
        {!kritis && (
          <button
            type="button"
            onClick={onTutup}
            aria-label="Tutup peringatan audit"
            title="Tutup peringatan audit"
            className={clsx(
              'shrink-0 rounded-lg p-1.5 text-amber-800 hover:bg-black/5',
              RING_FOKUS,
            )}
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>
      {konfirmasiTutup && (
        <KonfirmasiModal
          judul="Abaikan peringatan audit kritis?"
          deskripsi={
            <>
              <p>
                Temuan kritis berarti angka laporan tidak dapat dipercaya.
                Menutup peringatan ini hanya berlaku untuk sesi sekarang dan
                tidak memperbaiki data.
              </p>
              <p>
                Seluruh temuan tetap bisa dilihat kapan saja di{' '}
                <b>Pengaturan → Audit Integritas</b>.
              </p>
            </>
          }
          labelYa="Ya, abaikan untuk sesi ini"
          onBatal={() => setKonfirmasiTutup(false)}
          onKonfirmasi={() => {
            setKonfirmasiTutup(false);
            onTutup();
          }}
        />
      )}
    </section>
  );
}
