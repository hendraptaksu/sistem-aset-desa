// Model dokumen cetak murni + paginator (tanpa DOM / Electron).
//
// P1-16: semua laporan dicetak lewat satu model dokumen yang sama. Halaman
// dibuat EKSPLISIT (satu <div class="halaman"> per halaman), sehingga nomor
// "Halaman X dari Y" pasti dan header tabel bisa diulang di tiap halaman.
// Tidak ada inline script di dokumen: tombol Cetak di renderer memanggil
// iframe.contentWindow.print() dari React (aman untuk CSP P1-15).

import { formatTanggal } from '../../utils/format.js';
import { tanggalLokal } from '../../utils/tanggal.js';
import { KOP_ORG_NAMA } from './workbooks.js';

export type PrintOrientation = 'portrait' | 'landscape';
export type PrintAlign = 'left' | 'center' | 'right';

/** Kolom tabel. `width` relatif (persen); dinormalisasi agar total 100%. */
export type PrintColumn = {
  label: string;
  align?: PrintAlign;
  width: number;
};

export type PrintRowKind = 'data' | 'seksi' | 'subtotal' | 'total';

/**
 * Satu baris tabel. `sel` = teks yang tampil (sudah diformat, mis. Rupiah).
 * `nilai` = angka asli untuk pemeriksaan/test — nominal dalam SEN, persen
 * dalam skala 0..100. Ini BUKAN sumber perhitungan; adapter selalu memakai
 * hasil core/reports.ts.
 */
export type PrintRow = {
  sel: readonly string[];
  nilai?: readonly (number | null)[];
  tebal?: boolean;
  jenis?: PrintRowKind;
};

export type PrintTable = {
  /** Judul ringkas tabel (dipakai di halaman lanjutan bila perlu). */
  judul?: string;
  kolom: readonly PrintColumn[];
  baris: readonly PrintRow[];
  /** Baris total/status; hanya dicetak sekali di akhir tabel. */
  footer?: readonly PrintRow[];
};

export type PrintKeyValue = {
  label: string;
  nilai: string;
  /** Angka asli (SEN) untuk pemeriksaan, bukan untuk render. */
  nilaiAngka?: number;
};

export type PrintBlock =
  | { jenis: 'heading'; teks: string }
  | { jenis: 'paragraf'; teks: string }
  | { jenis: 'keyValue'; baris: readonly PrintKeyValue[] }
  | { jenis: 'tabel'; tabel: PrintTable };

export type PrintDoc = {
  judul: string;
  /** Periode/cut-off, mis. "PERIODE 1 Jan 2026 s/d 31 Des 2026". */
  subjudul?: string;
  /** Default KOP_ORG_NAMA. */
  kop?: string;
  /** Baris tambahan di bawah nama entitas (maks. 2 baris, P1-13). */
  kopTambahan?: string;
  /** Tanggal cetak ISO YYYY-MM-DD; default tanggal hari ini. */
  tanggalCetak?: string;
  orientasi?: PrintOrientation;
  blok: readonly PrintBlock[];
};

export type PrintPage = {
  nomor: number;
  totalHalaman: number;
  /** true = halaman lanjutan (kop ringkas). */
  lanjutan: boolean;
  blok: readonly PrintBlock[];
};

export type PrintRenderOptions = {
  /**
   * Maksimum baris isi per halaman dalam satuan baris satu-lapis. Baris yang
   * teksnya membungkus dihitung beberapa slot. Default 27/17.
   */
  barisPerHalaman?: number;
  /** Override tanggal cetak (ISO). */
  tanggalCetak?: string;
};

export type HasilRenderPrint = {
  html: string;
  jumlahHalaman: number;
  orientasi: PrintOrientation;
};

/** Default baris per halaman: portrait 27, landscape 17 (baris satu-lapis). */
export function barisPerHalamanDefault(orientasi: PrintOrientation): number {
  return orientasi === 'landscape' ? 17 : 27;
}

/** Lebar area isi halaman (mm) setelah padding 10–12mm kiri/kanan. */
const LEBAR_ISI_MM: Record<PrintOrientation, number> = {
  portrait: 190,
  landscape: 273,
};
/** Padding kiri+kanan sel tabel (2 × 1.4mm pada CSS cetak). */
const PADDING_SEL_MM = 2.8;
/**
 * Tambahan bobot per baris teks lanjutan relatif terhadap satu baris tabel
 * (line-height 3.7mm dibagi tinggi baris satu-lapis 8.1mm).
 */
const BOBOT_BARIS_TAMBAHAN = 0.46;

/**
 * Perkiraan lebar karakter Times New Roman 8.5pt (mm). Dipisah per kategori
 * agar nominal Rupiah yang panjang tidak dianggap membungkus, sementara nama
 * akun kapital tetap dihitung lebar (konservatif).
 */
function lebarKarakterMm(ch: string): number {
  if (ch === ' ') return 0.9;
  if (/[0-9]/.test(ch)) return 1.4;
  if (/[.,:%()/+\-]/.test(ch)) return 1.2;
  if (ch === ch.toUpperCase()) return 1.75;
  return 1.35;
}

function lebarTeksMm(teks: string): number {
  let lebar = 0;
  for (const ch of teks) lebar += lebarKarakterMm(ch);
  return lebar;
}

/**
 * Perkiraan jumlah baris teks setelah pembungkusan kata pada lebar kolom.
 * `overflow-wrap:anywhere` membuat kata panjang ikut dipecah per karakter.
 */
function perkiraanJumlahBaris(teks: string, lebarKolomMm: number): number {
  const isi = String(teks ?? '').trim();
  if (!isi) return 1;
  const muat = Math.max(1, lebarKolomMm - PADDING_SEL_MM);
  if (lebarTeksMm(isi) <= muat) return 1;

  let baris = 1;
  let kolom = 0;
  for (const kata of isi.split(/\s+/)) {
    const lebarKata = lebarTeksMm(kata);
    // Kata lebih panjang dari satu baris: pecah per karakter.
    if (lebarKata > muat) {
      if (kolom > 0) baris += 1;
      let sisa = lebarKata;
      while (sisa > muat) {
        baris += 1;
        sisa -= muat;
      }
      kolom = sisa;
      continue;
    }
    const perlu = kolom === 0 ? lebarKata : kolom + 0.9 + lebarKata;
    if (perlu > muat) {
      baris += 1;
      kolom = lebarKata;
    } else {
      kolom = perlu;
    }
  }
  return baris;
}

/**
 * Bobot tinggi satu baris tabel dalam satuan baris satu-lapis. Baris yang
 * teksnya membungkus memakai lebih dari satu slot sehingga tidak menabrak
 * footer halaman.
 */
function bobotBaris(
  row: PrintRow,
  kolom: readonly PrintColumn[],
  orientasi: PrintOrientation,
): number {
  const total = kolom.reduce((s, k) => s + (Number.isFinite(k.width) ? Math.max(0, k.width) : 0), 0);
  const dasar = total > 0 ? total : kolom.length;
  const lebarIsi = LEBAR_ISI_MM[orientasi];
  let maks = 1;
  kolom.forEach((k, i) => {
    const bobot = Number.isFinite(k.width) ? Math.max(0, k.width) : 0;
    const lebarKolom = dasar > 0 ? (bobot / dasar) * lebarIsi : lebarIsi / kolom.length;
    const garis = perkiraanJumlahBaris(row.sel[i] ?? '', lebarKolom);
    maks = Math.max(maks, 1 + (garis - 1) * BOBOT_BARIS_TAMBAHAN);
  });
  return maks;
}

type HalamanKerja = { blok: PrintBlock[]; terpakai: number };

type PotonganTabel = {
  baris: PrintRow[];
  footer?: PrintRow[];
  bobot: number;
  kapasitas: number;
};

/**
 * Bagi satu tabel menjadi potongan halaman berdasarkan bobot tinggi baris.
 * `sisaKapasitas` = ruang yang masih tersedia di halaman aktif (satuan baris
 * satu-lapis). Footer hanya ditaruh di potongan terakhir dan ikut dihitung,
 * sehingga total tidak pernah terpisah dari baris data terakhir bila muat.
 */
function potongTabel(
  tabel: PrintTable,
  sisaKapasitas: number,
  kapasitas: number,
  orientasi: PrintOrientation,
): PotonganTabel[] {
  const data = tabel.baris.map((row) => ({
    row,
    bobot: bobotBaris(row, tabel.kolom, orientasi),
  }));
  const footer = (tabel.footer ?? []).map((row) => ({
    row,
    bobot: bobotBaris(row, tabel.kolom, orientasi),
  }));
  const bobotFooter = footer.reduce((s, b) => s + b.bobot, 0);
  if (data.length === 0 && footer.length === 0) {
    return [{ baris: [], bobot: 0, kapasitas }];
  }

  // 1) Bagi baris data menjadi halaman. Halaman pertama memakai sisa ruang
  //    halaman aktif; halaman berikutnya memakai kapasitas penuh. Setiap
  //    halaman minimal memuat satu baris agar tidak ada baris yang hilang.
  const potongan: PotonganTabel[] = [];
  let batas = Math.max(1, sisaKapasitas > 0 ? sisaKapasitas : kapasitas);
  let indeks = 0;
  while (indeks < data.length) {
    const baris: PrintRow[] = [];
    let bobot = 0;
    while (indeks < data.length) {
      const item = data[indeks]!;
      if (baris.length > 0 && bobot + item.bobot > batas) break;
      baris.push(item.row);
      bobot += item.bobot;
      indeks += 1;
      if (bobot >= batas) break;
    }
    potongan.push({ baris, bobot, kapasitas: batas });
    batas = kapasitas;
  }

  if (footer.length === 0) return potongan;
  if (potongan.length === 0) {
    potongan.push({ baris: [], bobot: 0, kapasitas: batas });
  }

  // 2) Footer hanya sekali, di halaman terakhir bila masih muat. Bila tidak,
  //    footer mendapat halaman sendiri (tidak memotong footer).
  const akhir = potongan[potongan.length - 1]!;
  if (akhir.bobot + bobotFooter <= akhir.kapasitas) {
    akhir.footer = footer.map((f) => f.row);
    akhir.bobot += bobotFooter;
  } else {
    potongan.push({
      baris: [],
      footer: footer.map((f) => f.row),
      bobot: bobotFooter,
      kapasitas,
    });
  }

  // 3) Hindari halaman terakhir yang hanya berisi footer bila memungkinkan:
  //    pindahkan satu baris data dari halaman sebelumnya.
  const terakhir = potongan[potongan.length - 1]!;
  if (terakhir.baris.length === 0 && footer.length > 0 && potongan.length > 1) {
    const sebelumnya = potongan[potongan.length - 2]!;
    const kandidat = sebelumnya.baris[sebelumnya.baris.length - 1];
    const bobotKandidat = kandidat
      ? bobotBaris(kandidat, tabel.kolom, orientasi)
      : 0;
    if (
      sebelumnya.baris.length > 1 &&
      bobotKandidat + bobotFooter <= terakhir.kapasitas
    ) {
      const pindah = sebelumnya.baris.pop()!;
      sebelumnya.bobot -= bobotKandidat;
      terakhir.baris.push(pindah);
      terakhir.bobot += bobotKandidat;
    }
  }
  return potongan;
}

/** Pecah dokumen menjadi halaman eksplisit, deterministik dari jumlah baris. */
export function paginatePrintDoc(
  doc: PrintDoc,
  opts: PrintRenderOptions = {},
): PrintPage[] {
  const orientasi = doc.orientasi ?? 'portrait';
  const kapasitas = Math.max(
    1,
    Math.floor(opts.barisPerHalaman ?? barisPerHalamanDefault(orientasi)),
  );
  const halaman: HalamanKerja[] = [];
  let aktif: HalamanKerja;

  const halamanBaru = (): HalamanKerja => {
    const h: HalamanKerja = { blok: [], terpakai: 0 };
    halaman.push(h);
    return h;
  };
  aktif = halamanBaru();

  const butuhHalamanBaru = (unit: number): void => {
    if (aktif.terpakai > 0 && aktif.terpakai + unit > kapasitas) aktif = halamanBaru();
  };

  const tambahTabel = (tabel: PrintTable): void => {
    if (aktif.terpakai >= kapasitas && aktif.blok.length > 0) aktif = halamanBaru();
    // Tabel tanpa baris data (mis. daftar kosong) tetap harus memuat footer
    // utuh; pindahkan ke halaman baru bila sisa ruang tidak cukup.
    if (tabel.baris.length === 0 && aktif.blok.length > 0) {
      const bobotFooter = (tabel.footer ?? []).reduce(
        (s, row) => s + bobotBaris(row, tabel.kolom, orientasi),
        0,
      );
      if (aktif.terpakai + bobotFooter > kapasitas) aktif = halamanBaru();
    }
    const sisa = kapasitas - aktif.terpakai;
    const potongan = potongTabel(tabel, sisa, kapasitas, orientasi);
    potongan.forEach((p, i) => {
      if (i > 0) aktif = halamanBaru();
      aktif.blok.push({
        jenis: 'tabel',
        tabel: {
          ...tabel,
          baris: p.baris,
          // Jangan biarkan footer asli ikut di setiap potongan halaman.
          footer: p.footer,
        },
      });
      aktif.terpakai += p.bobot;
    });
  };

  for (const blok of doc.blok) {
    if (blok.jenis === 'heading' || blok.jenis === 'paragraf') {
      const unit =
        blok.jenis === 'paragraf'
          ? perkiraanJumlahBaris(blok.teks, LEBAR_ISI_MM[orientasi])
          : 1;
      butuhHalamanBaru(unit);
      aktif.blok.push(blok);
      aktif.terpakai += unit;
      continue;
    }

    if (blok.jenis === 'keyValue') {
      const baris = blok.baris;
      if (baris.length === 0) continue;
      if (aktif.terpakai > 0 && aktif.terpakai + baris.length > kapasitas) {
        aktif = halamanBaru();
      }
      let mulai = 0;
      while (mulai < baris.length) {
        const muat = kapasitas - aktif.terpakai;
        if (muat <= 0) {
          aktif = halamanBaru();
          continue;
        }
        const ambil = Math.min(muat, baris.length - mulai);
        aktif.blok.push({
          jenis: 'keyValue',
          baris: baris.slice(mulai, mulai + ambil),
        });
        aktif.terpakai += ambil;
        mulai += ambil;
        if (mulai < baris.length) aktif = halamanBaru();
      }
      continue;
    }

    tambahTabel(blok.tabel);
  }

  const total = halaman.length;
  return halaman.map((h, i) => ({
    nomor: i + 1,
    totalHalaman: total,
    lanjutan: i > 0,
    blok: h.blok,
  }));
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function lebarKolom(kolom: readonly PrintColumn[]): string[] {
  const positif = kolom.map((k) => (Number.isFinite(k.width) ? Math.max(0, k.width) : 0));
  const total = positif.reduce((s, w) => s + w, 0);
  const bobot = total > 0 ? positif : kolom.map(() => 1);
  const dasar = total > 0 ? total : kolom.length;
  return bobot.map((w) => {
    const persen = (w / dasar) * 100;
    const teks = persen.toFixed(3).replace(/\.?0+$/, '');
    return `${teks}%`;
  });
}

function renderBaris(row: PrintRow, kolom: readonly PrintColumn[]): string {
  const kelas = [
    row.jenis && row.jenis !== 'data' ? `baris-${row.jenis}` : '',
    row.tebal ? 'tebal' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const sel = kolom
    .map((k, i) => {
      const align = k.align ?? 'left';
      return `<td style="text-align:${align}">${esc(row.sel[i] ?? '')}</td>`;
    })
    .join('');
  return `<tr${kelas ? ` class="${kelas}"` : ''}>${sel}</tr>`;
}

function renderTabel(tabel: PrintTable): string {
  const kolom = tabel.kolom;
  if (kolom.length === 0) return '';
  const lebar = lebarKolom(kolom);
  const colgroup = `<colgroup>${lebar
    .map((w) => `<col style="width:${w}">`)
    .join('')}</colgroup>`;
  const thead = `<thead><tr>${kolom
    .map(
      (k) =>
        `<th style="text-align:${k.align ?? 'left'}">${esc(k.label)}</th>`,
    )
    .join('')}</tr></thead>`;
  const body = tabel.baris.map((r) => renderBaris(r, kolom)).join('');
  const tbody = `<tbody>${
    body ||
    `<tr><td colspan="${kolom.length}" class="sel-kosong">Tidak ada data.</td></tr>`
  }</tbody>`;
  const tfoot =
    tabel.footer && tabel.footer.length > 0
      ? `<tfoot>${tabel.footer.map((r) => renderBaris(r, kolom)).join('')}</tfoot>`
      : '';
  return `<table class="tabel-cetak" style="table-layout:fixed;width:100%">${colgroup}${thead}${tbody}${tfoot}</table>`;
}

function renderBlok(blok: PrintBlock): string {
  if (blok.jenis === 'heading') {
    return `<h3 class="blok-heading">${esc(blok.teks)}</h3>`;
  }
  if (blok.jenis === 'paragraf') {
    return `<p class="blok-paragraf">${esc(blok.teks)}</p>`;
  }
  if (blok.jenis === 'keyValue') {
    return `<div class="kv">${blok.baris
      .map(
        (b) =>
          `<div class="kv-baris"><span class="kv-label">${esc(b.label)}</span><span class="kv-nilai">${esc(b.nilai)}</span></div>`,
      )
      .join('')}</div>`;
  }
  return renderTabel(blok.tabel);
}

function renderKop(doc: PrintDoc, lanjutan: boolean): string {
  const org = doc.kop ?? KOP_ORG_NAMA;
  const tambahan = String(doc.kopTambahan ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, 2);
  return `<header class="kop ${lanjutan ? 'kop-ringkas' : 'kop-lengkap'}">
<div class="kop-org">${esc(org)}</div>
${tambahan.map((t) => `<div class="kop-tambahan">${esc(t)}</div>`).join('\n')}
<div class="kop-judul">${esc(doc.judul)}</div>
${doc.subjudul ? `<div class="kop-periode">${esc(doc.subjudul)}</div>` : ''}
</header>`;
}

function tanggalCetakEfektif(doc: PrintDoc, opts: PrintRenderOptions): string {
  const iso = opts.tanggalCetak ?? doc.tanggalCetak ?? tanggalLokal();
  return formatTanggal(iso);
}

/** CSS dokumen cetak. Diekspor agar P1-15 (CSP) / P2-8 (SOP) bisa merujuk. */
export const PRINT_DOC_CSS = `
@page{size:A4 portrait;margin:0}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:#fff}
body{font-family:"Times New Roman",Georgia,serif;font-size:10pt;color:#111}
.halaman{width:210mm;height:297mm;padding:12mm 10mm;display:flex;flex-direction:column;page-break-after:always;break-after:page;background:#fff}
.halaman:last-child{page-break-after:auto;break-after:auto}
.halaman.landscape{width:297mm;height:210mm;padding:10mm 12mm}
.halaman.landscape + .halaman.landscape{page-break-before:always;break-before:page}
.isi{flex:1 1 auto;min-height:0}
.kop{text-align:center;line-height:1.35;margin-bottom:8px}
.kop-lengkap{border-bottom:2px solid #111;padding-bottom:6px}
.kop-ringkas{border-bottom:1px solid #777;padding-bottom:4px;margin-bottom:6px}
.kop-org{font-weight:700;font-size:14pt;letter-spacing:.3px}
.kop-ringkas .kop-org{font-size:10pt}
.kop-tambahan{font-size:9pt}
.kop-ringkas .kop-tambahan{font-size:8pt}
.kop-judul{font-weight:700;font-size:12pt;text-transform:uppercase}
.kop-ringkas .kop-judul{font-size:9.5pt}
.kop-periode{font-size:9.5pt}
.kop-ringkas .kop-periode{font-size:8.5pt}
.blok-heading{font-size:11pt;margin:8px 0 4px;page-break-after:avoid;break-after:avoid}
.blok-paragraf{font-size:9.5pt;margin:3px 0 6px;line-height:1.35}
.kv{font-size:9pt;margin:4px 0 7px}
.kv-baris{display:flex;gap:6px;border-bottom:1px dotted #ccc;padding:1.5px 0}
.kv-label{flex:0 0 38%;color:#333}
.kv-nilai{flex:1 1 auto;text-align:right;font-weight:600}
.tabel-cetak{width:100%;table-layout:fixed;border-collapse:collapse;font-size:8.5pt;margin:2px 0 8px}
.tabel-cetak th,.tabel-cetak td{border:1px solid #555;padding:2.2mm 1.4mm;vertical-align:top;overflow-wrap:anywhere;word-wrap:break-word;white-space:normal}
.tabel-cetak thead{display:table-header-group}
.tabel-cetak tfoot{display:table-footer-group}
.tabel-cetak tr{page-break-inside:avoid;break-inside:avoid}
.tabel-cetak th{background:#eee;font-weight:700}
.tabel-cetak .baris-seksi td{background:#f3f3f3;font-weight:700}
.tabel-cetak .baris-subtotal td,.tabel-cetak .baris-total td,.tabel-cetak .tebal td{font-weight:700}
.tabel-cetak .sel-kosong{text-align:center;color:#555}
.kaki-halaman{margin-top:auto;padding-top:4px;border-top:1px solid #999;display:flex;justify-content:space-between;gap:8px;font-size:8pt;color:#333}
@media print{html,body{background:#fff}.halaman{box-shadow:none}}
`;

/** Render HTML lengkap (satu div per halaman) + info pagination. */
export function renderPrintDocument(
  doc: PrintDoc,
  opts: PrintRenderOptions = {},
): HasilRenderPrint {
  const orientasi = doc.orientasi ?? 'portrait';
  const halaman = paginatePrintDoc(doc, opts);
  const tanggal = tanggalCetakEfektif(doc, opts);
  const css = PRINT_DOC_CSS.replace(
    '@page{size:A4 portrait;margin:0}',
    `@page{size:A4 ${orientasi};margin:0}`,
  );
  const isiHalaman = halaman
    .map((h) => {
      const blok = h.blok.map(renderBlok).join('\n');
      return `<div class="halaman${orientasi === 'landscape' ? ' landscape' : ''}" data-halaman="${h.nomor}">
${renderKop(doc, h.lanjutan)}
<div class="isi">${blok}</div>
<footer class="kaki-halaman"><span>Tanggal cetak: ${esc(tanggal)}</span><span>Halaman ${h.nomor} dari ${h.totalHalaman}</span></footer>
</div>`;
    })
    .join('\n');
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.judul)}</title>
<style>${css}</style>
</head>
<body>
<div class="dokumen-cetak">
${isiHalaman}
</div>
</body>
</html>`;
  return { html, jumlahHalaman: halaman.length, orientasi };
}

/** Kontrak utama P1-16: dokumen → HTML cetak lengkap. */
export function renderPrintHtml(doc: PrintDoc, opts: PrintRenderOptions = {}): string {
  return renderPrintDocument(doc, opts).html;
}

/** Jumlah halaman tanpa merender HTML (untuk info pratinjau/test). */
export function jumlahHalamanCetak(
  doc: PrintDoc,
  opts: PrintRenderOptions = {},
): number {
  return paginatePrintDoc(doc, opts).length;
}

/** Cari baris tabel berdasarkan teks di kolom pertama/kedua (test & UI). */
export function cariBarisCetak(doc: PrintDoc, teks: string): PrintRow | undefined {
  for (const blok of doc.blok) {
    if (blok.jenis !== 'tabel') continue;
    const semua = [...blok.tabel.baris, ...(blok.tabel.footer ?? [])];
    const found = semua.find((r) => r.sel.some((s) => s === teks));
    if (found) return found;
  }
  return undefined;
}

/** Info ringkas untuk modal pratinjau. */
export function infoPratinjauCetak(
  jumlahHalaman: number,
  orientasi: PrintOrientation,
): string {
  const kertas = orientasi === 'landscape' ? 'A4 Landscape' : 'A4 Portrait';
  const total = Math.max(1, jumlahHalaman);
  return `${total} halaman · ${kertas}`;
}
