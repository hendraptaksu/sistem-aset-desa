import { akun } from '../../db/coa.js';
import {
  parseAuditDetail,
  type AuditBarisJurnal,
  type AuditJurnalView,
  type AuditItemPanjar,
} from '../../utils/auditDetail.js';
import { formatRp, formatTanggal } from '../../utils/format.js';

function namaAkun(kode: string): string | null {
  if (!kode) return null;
  const info = akun(kode);
  return info ? info.nama : null;
}

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-stone-500">{label}: </span>
      <span className="font-medium break-all">{value}</span>
    </p>
  );
}

function SelAkun({ kode, keterangan }: { kode: string; keterangan?: string }) {
  const nama = namaAkun(kode);
  return (
    <td className="py-1.5 pr-3 align-top">
      <span className="font-medium">{kode || '-'}</span>
      {nama && <span className="block text-helper text-stone-500">{nama}</span>}
      {keterangan && <span className="block text-helper text-stone-500">{keterangan}</span>}
    </td>
  );
}

function TabelJurnal({ jurnal }: { jurnal: AuditJurnalView }) {
  return (
    <div className="mt-1 max-h-56 overflow-auto rounded-lg border">
      {/* UI-15/UI-A22: nominal jurnal adalah konten keputusan, bukan metadata. */}
      <table className="w-full text-left text-helper">
        <thead className="sticky top-0 bg-stone-50 text-stone-600">
          <tr>
            <th className="py-1.5 pr-3 pl-2">Akun</th>
            <th className="py-1.5 pr-3 text-right">Debit</th>
            <th className="py-1.5 pr-2 text-right">Kredit</th>
          </tr>
        </thead>
        <tbody>
          {jurnal.baris.map((b: AuditBarisJurnal, i) => (
            <tr key={i} className="border-t">
              <SelAkun kode={b.akun} keterangan={b.keterangan} />
              <td className="py-1.5 pr-3 text-right align-top whitespace-nowrap">
                {b.debit ? formatRp(b.debit) : '-'}
              </td>
              <td className="py-1.5 pr-2 text-right align-top whitespace-nowrap">
                {b.kredit ? formatRp(b.kredit) : '-'}
              </td>
            </tr>
          ))}
          {jurnal.baris.length === 0 && (
            <tr>
              <td colSpan={3} className="px-2 py-2 text-center text-stone-500">
                Tidak ada baris jurnal.
              </td>
            </tr>
          )}
          {jurnal.baris.length > 0 && (
            <tr className="border-t bg-stone-50 font-semibold">
              <td className="py-1.5 pr-3 pl-2">Total</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">
                {formatRp(jurnal.total_debit)}
              </td>
              <td className="py-1.5 pr-2 text-right whitespace-nowrap">
                {formatRp(jurnal.total_kredit)}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DetailJurnal({ jurnal }: { jurnal: AuditJurnalView }) {
  return (
    <div className="space-y-1">
      <Baris label="Tanggal" value={formatTanggal(jurnal.tanggal) || '-'} />
      <Baris label="No. bukti" value={jurnal.no_bukti || '-'} />
      <Baris label="Keterangan" value={jurnal.keterangan || '-'} />
      <TabelJurnal jurnal={jurnal} />
    </div>
  );
}

function TabelItemPanjar({ items }: { items: AuditItemPanjar[] }) {
  return (
    <div className="mt-1 max-h-56 overflow-auto rounded-lg border">
      <table className="w-full text-left text-helper">
        <thead className="sticky top-0 bg-stone-50 text-stone-600">
          <tr>
            <th className="py-1.5 pr-3 pl-2">Akun realisasi</th>
            <th className="py-1.5 pr-2 text-right">Nominal</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-t">
              <SelAkun kode={it.akun} />
              <td className="py-1.5 pr-2 text-right align-top whitespace-nowrap">
                {formatRp(it.nominal)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_PANJAR: Record<string, string> = {
  OPEN: 'Terbuka',
  CLOSED: 'Ditutup',
  DIBATALKAN: 'Dibatalkan',
};

function DetailPanjar({
  detail,
}: {
  detail: Extract<ReturnType<typeof parseAuditDetail>, { kind: 'panjar' }>;
}) {
  return (
    <div className="space-y-1">
      <Baris label="Tanggal" value={formatTanggal(detail.tanggal) || '-'} />
      {detail.tanggal_close && (
        <Baris
          label="Tanggal ditutup"
          value={formatTanggal(detail.tanggal_close)}
        />
      )}
      <Baris label="Penerima" value={detail.penerima || '-'} />
      <Baris label="Jumlah" value={formatRp(detail.jumlah)} />
      <Baris
        label="Akun kas sumber"
        value={detail.akun_kas_sumber || '-'}
      />
      <Baris
        label="Status"
        value={STATUS_PANJAR[detail.status] ?? (detail.status || '-')}
      />
      {detail.total_realisasi !== null && (
        <Baris label="Total realisasi" value={formatRp(detail.total_realisasi)} />
      )}
      {detail.sisa !== null && detail.sisa > 0 && (
        <Baris label="Sisa" value={formatRp(detail.sisa)} />
      )}
      {detail.kurang !== null && detail.kurang > 0 && (
        <Baris label="Kurang" value={formatRp(detail.kurang)} />
      )}
      {detail.items.length > 0 && (
        <div>
          <p className="text-stone-500">Rincian realisasi</p>
          <TabelItemPanjar items={detail.items} />
        </div>
      )}
      {detail.jurnal && (
        <div className="pt-1">
          <p className="text-stone-500">Jurnal terkait</p>
          <DetailJurnal jurnal={detail.jurnal} />
        </div>
      )}
    </div>
  );
}

/**
 * Detail audit human-readable. Bentuk v2 jurnal/panjar dirender sebagai
 * ringkasan + tabel; bentuk tak dikenal (termasuk JSON rusak) jatuh ke `<pre>`.
 */
export function AuditDetail({ json }: { json: string | null | undefined }) {
  const detail = parseAuditDetail(json);

  if (detail.kind === 'jurnal') return <DetailJurnal jurnal={detail} />;

  if (detail.kind === 'panjar') return <DetailPanjar detail={detail} />;

  if (detail.kind === 'transaksi') {
    return (
      <div className="space-y-1">
        <Baris label="Tanggal" value={formatTanggal(detail.tanggal) || '-'} />
        <Baris label="Keterangan" value={detail.keterangan || '-'} />
        <Baris label="Akun kas" value={detail.akun_kas || '-'} />
        <Baris label="Kategori" value={detail.kategori || '-'} />
        <Baris label="Masuk" value={detail.masuk ? formatRp(detail.masuk) : '-'} />
        <Baris label="Keluar" value={detail.keluar ? formatRp(detail.keluar) : '-'} />
      </div>
    );
  }

  return (
    <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-stone-50 p-2 text-helper">
      {detail.teks || '-'}
    </pre>
  );
}
