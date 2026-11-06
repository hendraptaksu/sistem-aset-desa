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

function renderLock(pesan?: string): string {
  return renderToStaticMarkup(
    createElement(LockScreen, {
      sudahSetup: true,
      onTerbuka: () => {},
      pesan,
    }),
  );
}

describe('T2.7 — pesan restore di layar kunci', () => {
  it('menampilkan kotak info bila prop pesan diisi', () => {
    const pesan = pesanRestoreSukses(
      'lengkap',
      '/data/backups/pre-restore-2026-11-06-1000.db',
    );
    const html = renderLock(pesan);

    expect(html).toContain('data-testid="pesan-restore"');
    expect(html).toMatch(/Restore lengkap OK/);
    expect(html).toContain('/data/backups/pre-restore-2026-11-06-1000.db');
    expect(html).toMatch(/Cadangan data lama/i);
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

  it('pesanRestoreSukses menyebut jalur restore dan cadangan pra-restore', () => {
    expect(pesanRestoreSukses('db', '/backups/pre-restore-a.db')).toBe(
      'Restore OK. Cadangan data lama: /backups/pre-restore-a.db. Aplikasi dikunci ulang; masukkan PIN untuk melanjutkan.',
    );
    expect(pesanRestoreSukses('lengkap', null)).toContain(
      'Restore lengkap OK. Cadangan data lama: -.',
    );
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
