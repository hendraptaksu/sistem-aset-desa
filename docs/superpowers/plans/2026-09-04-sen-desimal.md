# Sen + Format Indonesia Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simpan nominal dalam sen (integer), tampilkan rupiah 2 desimal + tanggal DD-MM-YYYY di seluruh UI/laporan.

**Architecture:** Kontrak satuan berubah (rupiah→sen), logika ledger tak tersentuh (agnostik satuan). Satu pintu format di `src/utils/format.ts`, satu pintu input desimal di `CurrencyInput`, fixtures ×100, tanpa migrasi DB (DB lama dihapus).

**Tech Stack:** TypeScript, better-sqlite3, Electron, React, vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-sen-desimal-design.md`

## Global Constraints

- Semua nominal unit test/prod adalah SEN integer; `Number.isInteger` tetap berlaku.
- Tidak ada migrasi DB: hapus file `.db` lama, jangan tulis kode migrasi.
- TIDAK ADA commit tanpa perintah eksplisit user.
- Setiap task diakhiri run `npx vitest run <file>` dan/atau `npx tsc --noEmit`.

---

### Task 1: Helper format (formatRp 2 desimal + formatTanggal + parseRupiahToSen)

**Files:**
- Modify: `src/utils/format.ts`
- Test: `tests/format.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `formatRp(sen: number): string`, `formatTanggal(iso: string): string`, `parseRupiahToSen(s: string): number` — dipakai Task 3, 4, 5.

- [ ] **Step 1: Write the failing test**

```ts
// tests/format.test.ts
import { describe, expect, it } from 'vitest';
import { formatRp, formatTanggal, parseRupiahToSen } from '../src/utils/format.js';

describe('formatRp sen → 2 desimal', () => {
  it('bulat tampil ,00', () => {
    expect(formatRp(150_000_000)).toBe('Rp 1.500.000,00');
    expect(formatRp(0)).toBe('Rp 0,00');
  });
  it('pecahan tampil', () => {
    expect(formatRp(150_050)).toBe('Rp 1.500,50');
  });
  it('negatif kurung', () => {
    expect(formatRp(-10_000_000)).toBe('(Rp 100.000,00)');
  });
});

describe('formatTanggal ISO → DD-MM-YYYY', () => {
  it('konversi benar', () => {
    expect(formatTanggal('2026-01-05')).toBe('05-01-2026');
  });
  it('input invalid dikembalikan apa adanya', () => {
    expect(formatTanggal('asal')).toBe('asal');
  });
});

describe('parseRupiahToSen gaya Indonesia', () => {
  it('bulat auto ×100', () => {
    expect(parseRupiahToSen('1500')).toBe(150_000);
    expect(parseRupiahToSen('1.500')).toBe(150_000);
    expect(parseRupiahToSen('')).toBe(0);
  });
  it('koma desimal', () => {
    expect(parseRupiahToSen('1500,50')).toBe(150_050);
    expect(parseRupiahToSen('1.500,50')).toBe(150_050);
  });
  it('invalid throw pesan Indonesia', () => {
    // Catatan: posisi titik ribuan TIDAK divalidasi ketat (per spec §3),
    // jadi '1.5.00,10' diterima sebagai 150010 sen — bukan invalid.
    for (const bad of ['abc', '1,234', '-5', ',50']) {
      expect(() => parseRupiahToSen(bad)).toThrowError();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/format.test.ts`
Expected: FAIL (functions do not exist / wrong output).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/utils/format.ts — ganti seluruh isi file
// Satuan nominal aplikasi = SEN (integer). 1 Rp = 100 sen.

const rp2 = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatRp(sen: number): string {
  if (sen < 0) return `(Rp ${rp2.format(Math.abs(sen) / 100)})`;
  return `Rp ${rp2.format(sen / 100)}`;
}

const ISO_TGL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** '2026-01-05' → '05-01-2026'. Input tak cocok dikembalikan apa adanya. */
export function formatTanggal(iso: string): string {
  const m = ISO_TGL.exec(iso);
  if (!m) return iso;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/**
 * Parse nominal gaya Indonesia ke SEN.
 * '1500' → 150000, '1.500' → 150000, '1500,50' → 150050, '' → 0.
 * Throw Error (pesan Indonesia) untuk huruf, >2 digit desimal, negatif.
 */
export function parseRupiahToSen(s: string): number {
  const t = s.trim();
  if (t === '') return 0;
  if (!/^[0-9.]+(,[0-9]{1,2})?$/.test(t)) throw new Error('Nominal tidak valid (cth: 1.500 atau 1.500,50).');
  const [bulat, koma = ''] = t.split(',');
  const rupiah = Number(bulat!.replace(/\./g, ''));
  if (!Number.isSafeInteger(rupiah)) throw new Error('Nominal tidak valid (cth: 1.500 atau 1.500,50).');
  return rupiah * 100 + Number((koma + '00').slice(0, 2));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/format.test.ts`
Expected: PASS (8 tests).

### Task 2: Kontrak satuan di types.ts

**Files:**
- Modify: `src/core/types.ts:1-3`

**Interfaces:**
- Consumes: nothing. Produces: kontrak terdokumentasi untuk semua task.

- [ ] **Step 1: Edit komentar kontrak**

```ts
// Kontrak data Agent A + Agent B. JANGAN diubah sepihak.
// Nominal disimpan sebagai integer dalam satuan SEN (1 Rp = 100 sen). Salah satu masuk/keluar = 0.
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task 3: CurrencyInput sadar sen + koma desimal

**Files:**
- Modify: `src/renderer/components/ui.tsx:64-77`
- Test: tercakup `tests/format.test.ts` Task 1 (parse); komponen diuji manual via dev.

**Interfaces:**
- Consumes: `parseRupiahToSen`, `formatRp` dari Task 1.
- Produces: `CurrencyInput` dengan kontrak SAMA (`{ value: number (sen); onChange: (sen: number) => void }`) — BkuTab/PanjarTab tak berubah.

- [ ] **Step 1: Ganti implementasi CurrencyInput**

```tsx
/** Input Rupiah: tampil grouping Indonesia, state berupa SEN (integer).
 * Desimal opsional — ketik '1500' jadi Rp 1.500,00; '1500,50' jadi Rp 1.500,50. */
export function CurrencyInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const [teks, setTeks] = useState<string | null>(null);
  const [fokus, setFokus] = useState(false);
  // Perubahan value dari luar (cth. reset form setelah submit) tersinkron saat blur.
  useEffect(() => {
    if (!fokus) setTeks(null);
  }, [value, fokus]);
  const shown = fokus && teks !== null ? teks : value === 0 ? '' : formatSenInput(value);
  return (
    <TextInput
      inputMode="decimal"
      placeholder="0"
      value={shown}
      onFocus={() => {
        setFokus(true);
        setTeks(value === 0 ? '' : formatSenInput(value));
      }}
      onBlur={() => {
        setFokus(false);
        setTeks(null);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setTeks(v);
        try {
          onChange(parseRupiahToSen(v));
        } catch {
          /* abaikan state ketik antara (cth. '1,') */
        }
      }}
    />
  );
}

/** SEN → teks input: '1.500' bila bulat, '1.500,50' bila pecahan. */
function formatSenInput(sen: number): string {
  const neg = sen < 0 ? '-' : '';
  const abs = Math.abs(sen);
  const rupiah = Math.floor(abs / 100);
  const sisa = abs % 100;
  const grup = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 }).format(rupiah);
  return sisa === 0 ? `${neg}${grup}` : `${neg}${grup},${String(sisa).padStart(2, '0')}`;
}
```

Tambahkan di `ui.tsx` baris 1-2: `import { useEffect, useState } from 'react';` dan `import { parseRupiahToSen } from '../../utils/format.js';` (`formatSenInput` didefinisikan lokal di file ini, bukan import).

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task 4: Tanggal DD-MM-YYYY di 6 titik tampil

**Files:**
- Modify import + 1 baris di tiap file:
  - `src/renderer/components/BkuTab.tsx:4,190`
  - `src/renderer/components/PembantuTab.tsx` (import formatRp + baris `{t.tanggal}`)
  - `src/renderer/components/PanjarTab.tsx` (import formatRp + 2 baris `p.tanggal`)
  - `src/features/export/workbooks.ts` (import formatRp + `<td>${t.tanggal}</td>` HTML + `ws.addRow([t.tanggal, ...])` xlsx)

**Interfaces:**
- Consumes: `formatTanggal` dari Task 1. Produces: tampilan konsisten.

- [ ] **Step 1: BkuTab.tsx** — ubah import `import { formatRp }` → `import { formatRp, formatTanggal }`, dan baris 190 `{t.tanggal}` → `{formatTanggal(t.tanggal)}`.
- [ ] **Step 2: PembantuTab.tsx** — pola sama: `{t.tanggal}` → `{formatTanggal(t.tanggal)}` + import.
- [ ] **Step 3: PanjarTab.tsx** — 2 lokasi: `{p.tanggal} — {p.penerima}` → `{formatTanggal(p.tanggal)} — {p.penerima}` dan `<td ...>{p.tanggal}</td>` → `<td ...>{formatTanggal(p.tanggal)}</td>` + import.
- [ ] **Step 4: workbooks.ts** — `<td>${t.tanggal}</td>` → `<td>${formatTanggal(t.tanggal)}</td>` dan `ws.addRow([t.tanggal, ...])` → `ws.addRow([formatTanggal(t.tanggal), ...])` + import. (`formatRp` di file ini tak berubah — otomatis 2 desimal.)
- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: exit 0.

### Task 5: Fixtures ×100 (mock + seed-dev)

**Files:**
- Modify: `src/features/reports/__mocks__/data.ts`, `src/db/seed-dev.ts`

**Interfaces:**
- Consumes: kontrak sen Task 2. Produces: fixtures valid untuk ekspektasi Task 6.

- [ ] **Step 1: data.ts — kalikan SEMUA literal nominal ×100** (tanggal, id, kode tak berubah):

```ts
export const MOCK_TRANSAKSI: Transaksi[] = [
  { id: 'm01', tanggal: '2025-01-05', keterangan: 'Modal awal', akun_kas: '1001', kategori: '3000', masuk: 1_000_000_000, keluar: 0 },
  { id: 'm02', tanggal: '2025-02-10', keterangan: 'Parkir', akun_kas: '1015', kategori: '4005', masuk: 500_000_000, keluar: 0 },
  { id: 'm03', tanggal: '2025-02-15', keterangan: 'Beji', akun_kas: '1016', kategori: '4001', masuk: 200_000_000, keluar: 0 },
  { id: 'm04', tanggal: '2025-03-01', keterangan: 'Kontrakan', akun_kas: '1001', kategori: '4007', masuk: 300_000_000, keluar: 0 },
  { id: 'm05', tanggal: '2025-03-05', keterangan: 'Kios', akun_kas: '1010', kategori: '4003', masuk: 150_000_000, keluar: 0 },
  { id: 'm06', tanggal: '2025-03-10', keterangan: 'Shuttle Bus', akun_kas: '1001', kategori: '4004', masuk: 75_000_000, keluar: 0 },
  { id: 'm07', tanggal: '2025-03-12', keterangan: 'Sesari', akun_kas: '1001', kategori: '4041', masuk: 50_000_000, keluar: 0 },
  { id: 'm08', tanggal: '2025-04-01', keterangan: 'Punia', akun_kas: '1001', kategori: '4008', masuk: 100_000_000, keluar: 0 },
  { id: 'm09', tanggal: '2025-04-05', keterangan: 'Pendapatan Lain-lain', akun_kas: '1029', kategori: '4050', masuk: 25_000_000, keluar: 0 },
  { id: 'm10', tanggal: '2025-03-15', keterangan: 'Belanja rutin pamitegep', akun_kas: '1001', kategori: '5002', masuk: 0, keluar: 80_000_000 },
  { id: 'm11', tanggal: '2025-04-10', keterangan: 'Renovasi wewangunan', akun_kas: '1029', kategori: '5003', masuk: 0, keluar: 200_000_000 },
  { id: 'm12', tanggal: '2025-03-12', keterangan: 'Upakara', akun_kas: '1001', kategori: '5004', masuk: 0, keluar: 200_000_000 },
  { id: 'm13', tanggal: '2025-04-12', keterangan: 'Transport wahana', akun_kas: '1015', kategori: '5005', masuk: 0, keluar: 100_000_000 },
  { id: 'm14', tanggal: '2025-04-15', keterangan: 'Rapat humas', akun_kas: '1001', kategori: '5006', masuk: 0, keluar: 60_000_000 },
  { id: 'm15', tanggal: '2025-04-18', keterangan: 'Listrik & PDAM', akun_kas: '1001', kategori: '5010', masuk: 0, keluar: 90_000_000 },
  { id: 'bku-p1-open', tanggal: '2025-04-01', keterangan: 'Panjar Panitia Piodalan', akun_kas: '1001', kategori: 'PANJAR', masuk: 0, keluar: 500_000_000 },
  { id: 'bku-p1-komp', tanggal: '2025-04-20', keterangan: 'Penyelesaian panjar Panitia Piodalan', akun_kas: '1001', kategori: 'PANJAR', masuk: 450_000_000, keluar: 0 },
  { id: 'bku-p1-real-1', tanggal: '2025-04-20', keterangan: 'Realisasi panjar Panitia Piodalan — 5004', akun_kas: '1001', kategori: '5004', masuk: 0, keluar: 450_000_000 },
  { id: 'bku-p1-sisa', tanggal: '2025-04-20', keterangan: 'Sisa panjar Panitia Piodalan', akun_kas: '1001', kategori: 'PANJAR', masuk: 50_000_000, keluar: 0 },
  { id: 'm20', tanggal: '2025-05-01', keterangan: 'Pinjaman warung', akun_kas: '1001', kategori: '2050', masuk: 100_000_000, keluar: 0 },
];

export const MOCK_PANJAR: Panjar[] = [
  { id: 'p1', tanggal: '2025-04-01', penerima: 'Panitia Piodalan', jumlah: 500_000_000, akun_kas_sumber: '1001', status: 'CLOSED' },
];
```

- [ ] **Step 2: seed-dev.ts — kalikan SEMUA literal `min`/`max` ×100** (21 template, cth. `min: 500_000, max: 6_000_000` → `min: 50_000_000, max: 600_000_000`), dan ubah pembulatan `Math.round((t.min + rnd() * (t.max - t.min)) / 25_000) * 25_000` → `Math.round((t.min + rnd() * (t.max - t.min)) / 2_500_000) * 2_500_000` (tetap langkah Rp25rb). Komentar `// Kode kas/kategori ...` dan tanggal tak berubah. `tests/seed-dev.test.ts` tak berubah (hanya hitung baris).

- [ ] **Step 3: Verify**

Run: `npx vitest run tests/seed-dev.test.ts`
Expected: PASS (fixtures baru tetap 240 baris valid — validasi integer sen lolos).

### Task 6: Ekspektasi test ×100 + format 2 desimal

**Files:**
- Modify: `tests/accuracy.test.ts`, `tests/reports.test.ts`
- `tests/ipc-validation.test.ts`: TAK BERUBAH (100_000/100/5/0 tetap integer valid dalam sen).

**Interfaces:**
- Consumes: fixtures Task 5, format Task 1. Produces: suite hijau.

- [ ] **Step 1: accuracy.test.ts — kalikan semua literal nominal ×100** (tahun/tanggal/id/count tak berubah):
  - Fixture: `masuk: 10_000_000` → `1_000_000_000`; `5_000_000` → `500_000_000`; `keluar: 2_000_000` → `200_000_000`; `jumlah: 5_000_000` → `500_000_000`.
  - T1: dua `10_000_000` → `1_000_000_000`. T2: `15_000_000` → `1_500_000_000`, dua `5_000_000` → `500_000_000`. T3: `13_000_000` → `1_300_000_000`, `3_000_000` → `300_000_000`.
  - T4: `10_000_000 - 2_000_000 - 5_000_000` → `1_000_000_000 - 200_000_000 - 500_000_000`; `5_000_000` → `500_000_000`; `13_000_000` → `1_300_000_000`; `3_000_000` → `300_000_000`.
  - T5: `4_500_000` → `450_000_000`; `500_000` → `50_000_000`; `3_500_000` → `350_000_000`; `8_500_000` → `850_000_000`; `5_000_000 - 6_500_000` → `500_000_000 - 650_000_000`; `6_000_000` → `600_000_000`; `2_000_000` → `200_000_000`.
  - T7: `5_000_000 - 2_000_000` → `500_000_000 - 200_000_000`.
  - T8 ganti blok ekspektasi persis menjadi:
```ts
    expect(formatRp(150_000_000)).toBe('Rp 1.500.000,00');
    expect(formatRp(-10_000_000)).toBe('(Rp 100.000,00)');
    expect(formatRp(0)).toBe('Rp 0,00');
```
  - T9: empat `1_000_000` → `100_000_000`; `13_000_000` → `1_300_000_000`; `3_000_000` → `300_000_000`.

- [ ] **Step 2: reports.test.ts — kalikan semua literal nominal ×100 + 2 string formatRp**:
  - B1: `21_250_000` → `2_125_000_000`; `13_800_000` → `1_380_000_000`; `7_450_000` → `745_000_000`; `6_500_000` → `650_000_000`; `-6_500_000` → `-650_000_000`; dua `5_000_000` → `500_000_000`; `10_000_000` → `1_000_000_000`.
  - B2: `14_000_000` → `1_400_000_000`; `11_800_000` → `1_180_000_000`; `2_200_000` → `220_000_000`; `5_000_000` → `500_000_000`; `6_500_000` → `650_000_000`; dua `7_000_000` → `700_000_000`.
  - B3: `2_200_000` → `220_000_000`; `(5_000_000 / 14_000_000)` → `(500_000_000 / 1_400_000_000)`; `(6_500_000 / 11_800_000)` → `(650_000_000 / 1_180_000_000)`; `-4_500_000` → `-450_000_000`; `'(Rp 4.500.000)'` → `'(Rp 4.500.000,00)'`; `formatRp(-100_000)` → `formatRp(-10_000_000)` dan `'(Rp 100.000)'` → `'(Rp 100.000,00)'`; `2_200_000` (cek silang) → `220_000_000`.
  - B4: `7_450_000` → `745_000_000`; `7_500_000` → `750_000_000`.
  - B5/B6: tak berubah (buffer length, count 20).

- [ ] **Step 3: Run full suite**

Run: `npm test`
Expected: semua file hijau (6 file: accuracy, ipc-validation, reports, seed-dev, save-pdf, format).

### Task 7: Verifikasi akhir + DB fresh

**Files:** none (run only).

- [ ] **Step 1: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: exit 0 + `out/` ter-build.

- [ ] **Step 2: Hapus DB dev lama + seed ulang via tsx**

Run: `rm -f ./data/pura-dev.db && PURA_DB=./data/pura-dev.db npx tsx -e "import { openDb } from './src/db/database.ts'; import { seedDev } from './src/db/seed-dev.ts'; import { listTransaksi } from './src/db/repository.js'; import { formatRp, formatTanggal } from './src/utils/format.ts'; const db = openDb(process.env.PURA_DB!); console.log('seed:', seedDev(db)); const r = listTransaksi(db)[0]!; console.log('contoh:', formatTanggal(r.tanggal), formatRp(r.masuk || r.keluar)); db.close();"`
Expected: `seed: 240` + contoh tanggal `DD-MM-YYYY` + `Rp ...,00`.

- [ ] **Step 3: Uji manual tercatat (user)**

Restart `npm run dev`, cek: tabel BKU tampil tanggal `DD-MM-YYYY` + `Rp ...,00`; input `1500` tersimpan tampil `Rp 1.500,00`; input `1500,50` tampil `Rp 1.500,50`; Simpan PDF multi-halaman rapi.
