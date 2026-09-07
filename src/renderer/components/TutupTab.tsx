import { useEffect, useState } from 'react';
import type { AuditLog, TutupBuku } from '../../core/types.js';
import { formatRp, formatTanggal } from '../../utils/format.js';
import { formatAksiAudit, parseAuditDetail } from '../../utils/auditDetail.js';
import { api } from '../lib/api.js';
import { Badge, Button, Card, DetailModal, ErrorBox, Field, TextInput } from './ui.js';

type Step = 1 | 2 | 3;

function Baris({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-stone-500">{label}: </span>
      <span className="font-medium break-all">{value}</span>
    </p>
  );
}

export function TutupTab() {
  const [list, setList] = useState<TutupBuku[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [step, setStep] = useState<Step>(1);
  const [laba, setLaba] = useState<number | null>(null);
  const [backupPath, setBackupPath] = useState('');
  const [detail, setDetail] = useState<AuditLog | null>(null);
  const detailView = detail ? parseAuditDetail(detail.data_lama_json) : null;

  async function refresh() {
    try {
      const [t, a] = await Promise.all([api.tutupList(), api.auditList()]);
      setList(t);
      setAudit(a);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function preview() {
    setErr(null);
    setInfo(null);
    try {
      const r = await api.tutupPreview(tahun);
      setLaba(r.laba);
      setStep(2);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function autoBackup() {
    setErr(null);
    try {
      const r = await api.backupAuto(tahun);
      setBackupPath(r.path);
      setStep(3);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  async function konfirmasi() {
    setErr(null);
    setInfo(null);
    try {
      const r = await api.tutupCreate(tahun, backupPath);
      setInfo(`Tahun ${r.tahun} ditutup. Laba ${formatRp(r.laba)}. Backup: ${backupPath || '-'}`);
      setStep(1);
      setLaba(null);
      setBackupPath('');
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-3 text-lg font-bold">Tutup Buku (wizard)</h2>
        <ErrorBox msg={err} />
        {info && <div className="mb-2 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-green-800">{info}</div>}
        <p className="mb-3 text-sm text-stone-600">
          Langkah {step}/3: {step === 1 ? 'Preview laba' : step === 2 ? 'Auto-backup .db' : 'Konfirmasi'}.
          Data tahun lalu masih bisa diubah dengan mencantumkan alasan, dan tercatat otomatis.
        </p>

        {step === 1 && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="Tahun">
              <TextInput
                type="number"
                value={String(tahun)}
                onChange={(e) => setTahun(Number(e.target.value))}
              />
            </Field>
            <div className="flex items-end">
              <Button onClick={() => void preview()}>Preview laba</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <p className="text-[15px]">
              Laba tahun {tahun}: <b>{laba !== null ? formatRp(laba) : '-'}</b>
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>Kembali</Button>
              <Button onClick={() => void autoBackup()}>Backup otomatis & lanjut</Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-[15px]">
              Laba tahun {tahun}: <b>{laba !== null ? formatRp(laba) : '-'}</b>
              <br />
              Backup: <span className="break-all text-stone-600">{backupPath}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setStep(2)}>Kembali</Button>
              <Button onClick={() => void konfirmasi()}>Konfirmasi tutup buku</Button>
            </div>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Riwayat tutup buku</h3>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Tahun</th>
              <th className="py-2 pr-3 text-right">Laba</th>
              <th className="py-2 pr-3">Backup</th>
            </tr>
          </thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.tahun} className="border-b last:border-0">
                <td className="py-2 pr-3"><Badge>{t.tahun}</Badge></td>
                <td className="py-2 pr-3 text-right">{formatRp(t.laba)}</td>
                <td className="py-2 pr-3 break-all text-sm text-stone-600">{t.backup_path || '-'}</td>
              </tr>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-center text-stone-500">Belum pernah tutup buku.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <h3 className="mb-2 font-bold">Riwayat Perubahan (koreksi periode tutup)</h3>
        <table className="w-full text-left text-[15px]">
          <thead>
            <tr className="border-b text-stone-500">
              <th className="py-2 pr-3">Tanggal</th>
              <th className="py-2 pr-3">Aksi</th>
              <th className="py-2 pr-3">Alasan</th>
              <th className="py-2 pr-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((a) => (
              <tr key={a.id} className="border-b last:border-0">
                <td className="py-2 pr-3 whitespace-nowrap">{formatTanggal(a.tanggal.slice(0, 10))}</td>
                <td className="py-2 pr-3 break-all">{formatAksiAudit(a.aksi)}</td>
                <td className="py-2 pr-3">{a.alasan}</td>
                <td className="py-2 pr-3">
                  <Button variant="ghost" onClick={() => setDetail(a)}>Lihat</Button>
                </td>
              </tr>
            ))}
            {audit.length === 0 && (
              <tr><td colSpan={4} className="py-4 text-center text-stone-500">Belum ada koreksi periode tutup.</td></tr>
            )}
          </tbody>
        </table>
      </Card>

      {detail && (
        <DetailModal title="Detail koreksi" onClose={() => setDetail(null)}>
          <Baris label="Tanggal catat" value={formatTanggal(detail.tanggal.slice(0, 10))} />
          <Baris label="Aksi" value={formatAksiAudit(detail.aksi)} />
          <Baris label="Alasan" value={detail.alasan} />
          {detailView?.kind === 'transaksi' && (
            <>
              <Baris label="Tanggal transaksi" value={formatTanggal(detailView.tanggal)} />
              <Baris label="Keterangan" value={detailView.keterangan} />
              <Baris label="Dompet" value={detailView.akun_kas} />
              <Baris label="Kategori" value={detailView.kategori} />
              <Baris label="Masuk" value={detailView.masuk ? formatRp(detailView.masuk) : '-'} />
              <Baris label="Keluar" value={detailView.keluar ? formatRp(detailView.keluar) : '-'} />
            </>
          )}
          {detailView?.kind === 'panjar' && (
            <>
              <Baris label="Tanggal panjar" value={formatTanggal(detailView.tanggal)} />
              <Baris label="Penerima" value={detailView.penerima} />
              <Baris label="Jumlah" value={formatRp(detailView.jumlah)} />
              <Baris label="Diambil dari" value={detailView.akun_kas_sumber} />
              <Baris label="Status" value={detailView.status} />
            </>
          )}
          {detailView?.kind === 'mentah' && (
            <p className="break-all text-sm text-stone-600">{detailView.teks || '-'}</p>
          )}
        </DetailModal>
      )}
    </div>
  );
}
