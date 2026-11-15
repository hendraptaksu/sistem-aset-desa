// T2.7 — setelah restore sukses, main mengunci sesi dan renderer harus segera
// menampilkan layar kunci. Dashboard tidak boleh memanggil `muatData` lagi.

import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { LockScreen } from '../src/renderer/components/LockScreen.js';
import { pesanRestoreSukses } from '../src/renderer/components/DashboardTab.js';

const ROOT = process.cwd();
const baca = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

function renderLock(pesan?: string, blokirDetik?: number): string {
  return renderToStaticMarkup(
    createElement(LockScreen, {
      sudahSetup: true,
      onTerbuka: () => {},
      pesan,
      blokirDetik,
    }),
  );
}

describe('T2.7 — pesan restore di layar kunci', () => {
  it('menampilkan kotak info bila prop pesan diisi', () => {
    const pesan = pesanRestoreSukses('lengkap');
    const html = renderLock(pesan);

    expect(html).toContain('data-testid="pesan-restore"');
    expect(html).toMatch(/Pulihkan lengkap berhasil/);
    expect(html).toMatch(/dicadangkan otomatis/i);
    expect(html).toMatch(/dikunci ulang/i);
    // Alur PIN tetap utuh.
    expect(html).toMatch(/Masukkan PIN 6 digit/);
  });

  it('tidak menampilkan kotak info tanpa prop pesan', () => {
    const html = renderLock();
    expect(html).not.toContain('data-testid="pesan-restore"');
    expect(html).not.toMatch(/Cadangan data lama/i);
    expect(html).toMatch(/Masukkan PIN 6 digit/);
  });

  it('pesanRestoreSukses menyebut pemulihan berhasil dan cadangan otomatis', () => {
    expect(pesanRestoreSukses('db')).toBe(
      'Pulihkan berhasil. Data lama sudah dicadangkan otomatis. Aplikasi dikunci ulang; masukkan PIN untuk melanjutkan.',
    );
    expect(pesanRestoreSukses('lengkap')).toBe(
      'Pulihkan lengkap berhasil. Data lama sudah dicadangkan otomatis. Aplikasi dikunci ulang; masukkan PIN untuk melanjutkan.',
    );
  });
});

describe('UI-A22 — blokir PIN di layar kunci', () => {
  it('saat diblokir: PinInput mati dan hitung mundur tidak diumumkan tiap detik', () => {
    const html = renderLock(undefined, 60);
    expect(html).toMatch(/Terlalu banyak salah — coba lagi dalam/);
    expect(html).toContain('aria-live="off"');
    expect(html).not.toMatch(/role="status"[^>]*>[^<]*Terlalu banyak/);
    // Enam kotak PIN semuanya disabled selama blokir.
    expect((html.match(/disabled=""/g) ?? []).length).toBe(6);
  });

  it('tanpa blokir: PinInput aktif dan teks "terbuka otomatis" hanya satu tempat', () => {
    const html = renderLock();
    expect(html).not.toMatch(/Coba lagi dalam/);
    expect(html).toMatch(/Terbuka otomatis saat 6 digit lengkap/);
    expect(html).not.toMatch(/disabled=""/);
    // Deskripsi atas tidak mengulang teks yang sama dengan baris status PIN.
    expect((html.match(/[Tt]erbuka otomatis/g) ?? []).length).toBe(1);
    expect(html).toMatch(/Masukkan PIN 6 digit\./);
  });
});

describe('T2.7 — jalur sukses DashboardTab tidak memuat dashboard lagi', () => {
  const dashboard = baca('src/renderer/components/DashboardTab.tsx');
  const awalRestore = dashboard.indexOf('async function restore()');
  const awalRestoreLengkap = dashboard.indexOf('async function restoreLengkap()');

  it('restore .db memanggil callback dan tidak memanggil muatData', () => {
    expect(awalRestore).toBeGreaterThan(-1);
    expect(awalRestoreLengkap).toBeGreaterThan(awalRestore);
    const badan = dashboard.slice(awalRestore, awalRestoreLengkap);

    expect(badan).toContain('pesanRestoreSukses');
    expect(badan).toContain('onRestoreSelesai?.(pesan)');
    // Tidak ada pemanggilan `muatData(...)`, bukan sekadar kata di komentar.
    expect(badan).not.toMatch(/muatData\s*\(/);
  });

  it('restore lengkap memanggil callback dan tidak memanggil muatData', () => {
    expect(awalRestoreLengkap).toBeGreaterThan(-1);
    const akhir = dashboard.indexOf('return (', awalRestoreLengkap);
    expect(akhir).toBeGreaterThan(awalRestoreLengkap);
    const badan = dashboard.slice(awalRestoreLengkap, akhir);

    expect(badan).toContain('pesanRestoreSukses');
    expect(badan).toContain('onRestoreSelesai?.(pesan)');
    expect(badan).not.toMatch(/muatData\s*\(/);
  });
});
