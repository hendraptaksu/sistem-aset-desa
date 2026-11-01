// DB-31 — modul Rekonsiliasi Bank dihapus dari menu/UI, API renderer, dan
// validator main. Shell App baru merender menu setelah status kunci tersedia
// (butuh Electron), jadi kontrak yang dijaga di sini adalah sumber daftar
// tab/menu dan lapisan API yang dipakai tab tersebut.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

const APP = baca('src/renderer/App.tsx');
const API = baca('src/renderer/lib/api.ts');
const IPC = baca('src/main/ipc.ts');
const VALIDATION = baca('src/main/validation.ts');
const WORKBOOKS = baca('src/features/export/workbooks.ts');
const PRINT_ADAPTERS = baca('src/features/export/printAdapters.ts');
const AUDIT_DETAIL = baca('src/utils/auditDetail.ts');

describe('DB-31 — Rekonsiliasi Bank dihapus dari menu/UI', () => {
  it('tidak lagi punya tab, menu, render, atau komponen Rekonsiliasi Bank', () => {
    expect(APP).not.toContain('Rekonsiliasi Bank');
    expect(APP).not.toContain('RekonsiliasiBankTab');
    expect(APP).not.toContain("'rekonsiliasi'");
    for (const label of [
      'Dashboard',
      'Transaksi',
      'Buku Besar',
      'Neraca Saldo',
      'Tutup Buku',
      'Pengaturan',
    ]) {
      expect(APP, `menu "${label}" tetap ada`).toContain(label);
    }
  });

  it('tidak mengekspos tipe/API renderer atau validator rekonsiliasi bank', () => {
    expect(API).not.toContain('rekonsiliasi:');
    expect(API).not.toContain('RekonsiliasiTampil');
    expect(API).not.toContain('RekonsiliasiDetail');
    expect(API).not.toContain('StatusRekonsiliasi');
    expect(API).not.toContain('InputRekonsiliasiApi');
    expect(API).not.toContain('FilterRekonsiliasiApi');
    // DB-16f menambahkan validasi rekonsiliasi PINJAMAN (2050 vs jadwal), bukan
    // rekonsiliasi bank. Guard ini tetap memastikan validator bank tidak kembali.
    expect(VALIDATION).not.toContain('validasiBentukRekonsiliasi');
    expect(VALIDATION).not.toContain('InputRekonsiliasi');
  });

  it('file modul dan test rekonsiliasi bank sudah dihapus', () => {
    for (const path of [
      'src/renderer/components/RekonsiliasiBankTab.tsx',
      'src/core/rekonsiliasi.ts',
      'src/db/rekonsiliasi.ts',
      'tests/rekonsiliasi.test.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('label audit lama REKONSILIASI-* tetap tersedia', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('REKONSILIASI-SELESAI')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('REKONSILIASI')");
  });
});

describe('DB-32 — Inventaris Aset dihapus dari menu/UI', () => {
  it('tidak lagi punya tab, menu, render, atau komponen Inventaris Aset', () => {
    expect(APP).not.toContain('Inventaris Aset');
    expect(APP).not.toContain('AsetTab');
    expect(APP).not.toContain("'aset'");
    for (const label of [
      'Dashboard',
      'Transaksi',
      'Buku Panjar',
      'Buku Besar',
      'Neraca Saldo',
      'Laba Rugi',
      'Neraca',
      'Arus Kas',
      'Pengaturan',
    ]) {
      expect(APP, `menu "${label}" tetap ada`).toContain(label);
    }
  });

  it('tidak mengekspos tipe/API renderer, validator, atau export aset', () => {
    expect(API).not.toContain('aset:');
    expect(API).not.toContain('asetList');
    expect(API).not.toContain('asetCreate');
    expect(API).not.toContain('asetUpdate');
    expect(API).not.toContain('asetDelete');
    expect(VALIDATION).not.toContain('AsetInput');
    expect(VALIDATION).not.toContain('validateAsetInput');
    expect(WORKBOOKS).not.toContain('asetToWorkbook');
    expect(WORKBOOKS).not.toContain('asetToHtml');
    expect(WORKBOOKS).not.toContain('DAFTAR INVENTARIS ASET');
  });

  it('file modul dan test inventaris aset sudah dihapus', () => {
    for (const path of [
      'src/renderer/components/AsetTab.tsx',
      'tests/aset.test.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('label audit lama ASET-* tetap tersedia', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('ASET-CREATE')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('ASET-UPDATE')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('ASET-DELETE')");
  });
});

describe('DB-24 — Anggaran dihapus dari menu/UI', () => {
  it('tidak lagi punya tab, menu, render, atau komponen Anggaran', () => {
    expect(APP).not.toContain('Anggaran');
    expect(APP).not.toContain('RealisasiTab');
    expect(APP).not.toContain("'realisasi'");
    for (const label of [
      'Dashboard',
      'Transaksi',
      'Buku Besar',
      'Neraca Saldo',
      'Laba Rugi',
      'Neraca',
      'Arus Kas',
      'Pengaturan',
    ]) {
      expect(APP, `menu "${label}" tetap ada`).toContain(label);
    }
  });

  it('tidak mengekspos tipe/API renderer, validator, IPC, atau export anggaran', () => {
    expect(API).not.toMatch(/anggaran/i);
    expect(VALIDATION).not.toMatch(/anggaran/i);
    expect(IPC).not.toMatch(/anggaran/i);
    expect(WORKBOOKS).not.toMatch(/anggaran/i);
    expect(PRINT_ADAPTERS).not.toMatch(/anggaran/i);
  });

  it('file modul dan test anggaran sudah dihapus', () => {
    for (const path of [
      'src/renderer/components/RealisasiTab.tsx',
      'src/core/anggaran.ts',
      'src/db/anggaran.ts',
      'tests/anggaran.test.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('label audit lama ANGGARAN tetap tersedia', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('ANGGARAN')");
  });
});

describe('DB-25 — Import Excel dihapus dari menu/UI', () => {
  it('tidak lagi punya tab, menu, render, atau komponen Import Excel', () => {
    expect(APP).not.toContain('Import Excel');
    expect(APP).not.toContain('ImportExcelTab');
    expect(APP).not.toContain('FileSpreadsheet');
    expect(APP).not.toContain("'import'");
    for (const label of [
      'Dashboard',
      'Transaksi',
      'Daftar Akun',
      'Jurnal Umum',
      'Tutup Buku',
      'Pengaturan',
    ]) {
      expect(APP, `menu "${label}" tetap ada`).toContain(label);
    }
  });

  it('tidak mengekspos API/tipe renderer, IPC, parser, atau pesan error import', () => {
    expect(API).not.toContain('import:');
    expect(API).not.toContain('importTemplate');
    expect(API).not.toContain('importPreview');
    expect(API).not.toContain('importProses');
    expect(API).not.toContain('ImportPreviewData');
    expect(API).not.toContain('ImportProsesData');
    expect(API).not.toContain('HasilParseImpor');
    expect(API).not.toContain('HasilImporExcel');
    expect(IPC).not.toContain('import:');
    expect(IPC).not.toContain('bacaFileImpor');
    expect(IPC).not.toContain('GAGAL_IMPOR');
    expect(IPC).not.toContain('parseImporExcel');
    expect(VALIDATION).not.toContain('validasiImpor');
  });

  it('file modul dan test import Excel sudah dihapus', () => {
    for (const path of [
      'src/renderer/components/ImportExcelTab.tsx',
      'src/features/import/parser.ts',
      'src/features/import/template.ts',
      'src/db/impor.ts',
      'tests/impor-excel.test.ts',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('exceljs tetap tersedia untuk export/print', () => {
    const paket = JSON.parse(baca('package.json')) as {
      dependencies?: Record<string, string>;
    };
    expect(paket.dependencies?.exceljs).toBeTruthy();
    expect(WORKBOOKS).toContain("import ExcelJS from 'exceljs'");
  });

  it('label audit lama IMPORT-EXCEL tetap tersedia', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('IMPORT')");
  });
});

describe('DB-23b — master Pihak + jurnal_pihak dihapus dari UI/API', () => {
  const TRANSAKSI_TAB = baca('src/renderer/components/TransaksiTab.tsx');
  const TRANSAKSI_FORM = baca('src/renderer/components/TransaksiForm.tsx');
  const DASHBOARD = baca('src/renderer/components/DashboardTab.tsx');
  const REPOSITORY = baca('src/db/repository.ts');
  const REVERSAL = baca('src/db/reversal.ts');
  const PENGGUNA = baca('docs/panduan-pengguna.md');

  it('tidak lagi punya tab, menu, render, atau komponen Pihak/Hutang', () => {
    expect(APP).not.toContain('PihakTab');
    expect(APP).not.toContain("'pihak'");
    expect(APP).not.toContain('HandCoins');
    expect(existsSync(join(ROOT, 'src/renderer/components/PihakTab.tsx'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/core/pihak.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'src/db/pihak.ts'))).toBe(false);
    expect(existsSync(join(ROOT, 'tests/pihak.test.ts'))).toBe(false);
  });

  it('tidak mengekspos API/validator/IPC pihak:* atau pemetaan jurnal_pihak', () => {
    expect(API).not.toMatch(/pihak/i);
    expect(VALIDATION).not.toMatch(/pihak/i);
    expect(IPC).not.toMatch(/pihak:/i);
    expect(IPC).not.toContain('GAGAL_PIHAK');
    expect(IPC).not.toContain('peringatanPihakTanpaMapping');
    expect(REPOSITORY).not.toContain('jurnal_pihak');
    expect(REVERSAL).not.toContain('salinMappingPihak');
    expect(REVERSAL).not.toContain('jurnal_pihak');
  });

  it('form utang usaha sederhana tersedia di tab Transaksi dan Dashboard', () => {
    for (const label of ['Catat Utang', 'Bayar Utang']) {
      expect(TRANSAKSI_TAB, `kartu ${label}`).toContain(label);
      expect(DASHBOARD, `pintasan ${label}`).toContain(label);
    }
    expect(TRANSAKSI_FORM).toContain('Catat Utang Usaha');
    expect(TRANSAKSI_FORM).toContain('Bayar Utang Usaha');
    expect(TRANSAKSI_FORM).toContain('Utang Usaha (2060)');
    expect(TRANSAKSI_FORM).not.toContain('Pihak (wajib)');
    expect(APP).not.toContain('Buka Hutang');
  });

  it('dokumen pengguna tidak lagi menawarkan master Pihak, tetapi menjelaskan form utang', () => {
    expect(PENGGUNA).not.toMatch(/master pihak/i);
    expect(PENGGUNA).toContain('Catat Utang Usaha');
    expect(PENGGUNA).toContain('Bayar Utang Usaha');
    expect(PENGGUNA).toContain('2060');
    expect(PENGGUNA).toMatch(/nama kreditur|kreditur/i);
  });

  it('label audit lama PIHAK-* tetap tersedia untuk riwayat', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('PIHAK-CREATE')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('PIHAK-UPDATE')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('PIHAK-DELETE')");
  });
});

describe('DB-37 — modul Lampiran dihapus dari UI/API/IPC', () => {
  const DETAIL = baca('src/renderer/components/DetailJurnalModal.tsx');
  const DASHBOARD = baca('src/renderer/components/DashboardTab.tsx');
  const PENGATURAN = baca('src/renderer/components/PengaturanTab.tsx');

  it('detail jurnal tidak lagi punya tombol/modal lampiran', () => {
    expect(DETAIL).not.toMatch(/lampiran/i);
    expect(DETAIL).not.toContain('Unggah');
    expect(DETAIL).not.toContain('Pratinjau:');
    // Bagian inti detail jurnal tetap ada.
    expect(DETAIL).toContain('Detail Jurnal');
    expect(DETAIL).toContain('Tanggal:');
    expect(DETAIL).toContain('Total:');
  });

  it('API renderer dan IPC tidak mengekspos channel lampiran:*', () => {
    expect(API).not.toContain('lampiran:');
    expect(API).not.toContain('lampiranList');
    expect(API).not.toContain('jumlahLampiran');
    expect(IPC).not.toContain('lampiran:');
    expect(IPC).not.toContain('validasiIdLampiran');
    expect(VALIDATION).not.toContain('validasiIdLampiran');
  });

  it('backup/restore UI hanya menyebut database + manifest', () => {
    for (const layar of [DASHBOARD, PENGATURAN]) {
      expect(layar).not.toMatch(/lampiran/i);
      expect(layar).not.toContain('attachments');
    }
    expect(DASHBOARD).toContain('Backup Lengkap');
    expect(DASHBOARD).toContain('Restore Lengkap');
    expect(DASHBOARD).toContain('manifest.json');
  });

  it('modul, test, dan dokumen lampiran sudah dihapus', () => {
    for (const path of [
      'src/core/lampiran.ts',
      'src/db/lampiran.ts',
      'src/features/lampiran/lampiran.ts',
      'tests/lampiran.test.ts',
      'docs/lampiran-bukti.md',
    ]) {
      expect(existsSync(join(ROOT, path)), `${path} tidak ada`).toBe(false);
    }
  });

  it('label audit lama LAMPIRAN-* tetap tersedia untuk riwayat', () => {
    expect(AUDIT_DETAIL).toContain("a.startsWith('LAMPIRAN-TAMBAH')");
    expect(AUDIT_DETAIL).toContain("a.startsWith('LAMPIRAN-HAPUS')");
  });
});
