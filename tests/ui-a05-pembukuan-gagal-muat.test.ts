// UI-A27 kasus 7 (UI-A05): Simpan Pengaturan Pembukuan harus nonaktif saat
// pengaturan gagal dimuat (errPembukuan), agar setting tersimpan tidak
// tertimpa nilai default form — form ikut mati dan tombol "Coba muat ulang"
// jadi satu-satunya jalan keluar.
//
// Strategi: kegagalan IPC `pengaturanGet` tidak bisa dipicu lewat e2e (build
// uji selalu punya IPC asli yang berfungsi) dan `errPembukuan` adalah state
// internal PengaturanTab yang tidak bisa diset dari luar. Starness jalur
// gagal maka dikunci lewat uji sumber berikut; jalur bahagia (muat sukses →
// Simpan aktif) dikunci lewat e2e/ui-audit.test.mjs (cekPengaturanPembukuanSiap).

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sumber = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../src/renderer/components/PengaturanTab.tsx',
  ),
  'utf8',
);

describe('UI-A05 — form Pembukuan terkunci saat pengaturan gagal dimuat', () => {
  it('menurunkan pembukuanTerkunci langsung dari errPembukuan', () => {
    expect(sumber).toContain('const pembukuanTerkunci = errPembukuan !== null;');
  });

  it('menonaktifkan Simpan Pengaturan Pembukuan dengan alasan terlihat', () => {
    // Tombol Simpan wajib memasukkan pembukuanTerkunci ke disabled.
    expect(sumber).toContain('disabled={busyPembukuan || pembukuanTerkunci}');
    // Alasan mati tidak boleh senyap: title memakai alasanTombolNonaktif.
    expect(sumber).toContain("alasan: pembukuanTerkunci");
    expect(sumber).toContain("'Pengaturan gagal dimuat — coba muat ulang dulu.'");
  });

  it('menonaktifkan seluruh isian form pembukuan saat gagal muat', () => {
    // Nama entitas, kop tambahan, tanggal mulai, prefix nomor bukti, dan
    // select jumlah digit — lima kontrol isian memakai guard yang sama.
    const jumlah = sumber.split('disabled={pembukuanTerkunci}').length - 1;
    expect(jumlah).toBeGreaterThanOrEqual(5);
  });

  it('menyediakan tombol "Coba muat ulang" hanya saat gagal muat', () => {
    expect(sumber).toContain('{errPembukuan !== null && (');
    expect(sumber).toContain('Coba muat ulang');
  });

  it('gagal muat mengisi errPembukuan, bukan menimpa form dengan default', () => {
    expect(sumber).toContain('setErrPembukuan(pesanError(e, PESAN_MUAT_GAGAL));');
    // muatPembukuan sukses baru menerapkan nilai; catch hanya mengisi error.
    const mulai = sumber.indexOf('async function muatPembukuan');
    const akhir = sumber.indexOf('// Tampilkan nilai tersimpan saat mount');
    const muat = sumber.slice(mulai, akhir);
    const catchMuat = muat.slice(muat.indexOf('} catch (e) {'));
    expect(catchMuat).not.toContain('terapkanPembukuan');
  });
});
