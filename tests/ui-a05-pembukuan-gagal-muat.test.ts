// UI-A27 kasus 7 (UI-A05): Simpan Pengaturan Pembukuan harus nonaktif saat
// pengaturan gagal dimuat (errMuatPembukuan), agar setting tersimpan tidak
// tertimpa nilai default form — form ikut mati dan tombol "Coba muat ulang"
// jadi satu-satunya jalan keluar.
//
// UI-A28: kegagalan *simpan* tidak boleh ikut mengunci form. Kesalahan simpan
// memakai state terpisah (errSimpanPembukuan) supaya operator bisa memperbaiki
// isian dan mencoba lagi tanpa memuat ulang (yang akan membuang editannya).
//
// Strategi: kegagalan IPC `pengaturanGet` tidak bisa dipicu lewat e2e (build
// uji selalu punya IPC asli yang berfungsi) dan `errMuatPembukuan` adalah state
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
  it('menurunkan pembukuanTerkunci dari kegagalan muat, bukan kegagalan simpan', () => {
    expect(sumber).toContain('const pembukuanTerkunci = errMuatPembukuan !== null;');
    expect(sumber).toContain('setErrSimpanPembukuan');
  });

  it('menonaktifkan Simpan Pengaturan Pembukuan dengan alasan terlihat', () => {
    // Tombol Simpan wajib memasukkan pembukuanTerkunci ke disabled.
    expect(sumber).toContain(
      'disabled={busyPembukuan || pembukuanTerkunci || alasanSimpanPembukuan !== null}',
    );
    // Alasan mati tidak boleh senyap: title memakai alasanTombolNonaktif.
    expect(sumber).toContain('alasan: pembukuanTerkunci');
    expect(sumber).toContain("'Pengaturan gagal dimuat — coba muat ulang dulu.'");
  });

  it('menonaktifkan seluruh isian form pembukuan saat gagal muat', () => {
    // Nama entitas, kop tambahan, tanggal mulai, prefix nomor bukti, dan
    // select jumlah digit — lima kontrol isian memakai guard yang sama.
    const jumlah = sumber.split('disabled={pembukuanTerkunci}').length - 1;
    expect(jumlah).toBeGreaterThanOrEqual(5);
  });

  it('menyediakan tombol "Coba muat ulang" hanya saat gagal muat', () => {
    expect(sumber).toContain('{errMuatPembukuan !== null && (');
    expect(sumber).toContain('Coba muat ulang');
  });

  it('gagal muat mengisi errMuatPembukuan, bukan menimpa form dengan default', () => {
    expect(sumber).toContain('setErrMuatPembukuan(pesanError(e, PESAN_MUAT_GAGAL));');
    // muatPembukuan sukses baru menerapkan nilai; catch hanya mengisi error.
    const mulai = sumber.indexOf('async function muatPembukuan');
    const akhir = sumber.indexOf('// Tampilkan nilai tersimpan saat mount');
    const muat = sumber.slice(mulai, akhir);
    const catchMuat = muat.slice(muat.indexOf('} catch (e) {'));
    expect(catchMuat).not.toContain('terapkanPembukuan');
  });
});
