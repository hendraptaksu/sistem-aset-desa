# Windows Build Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hasilkan installer Windows (.exe NSIS + portable) via GitHub Actions `windows-latest`.

**Architecture:** Tambah `electron-builder` sebagai packager di atas output `electron-vite build` (`out/`). CI native Windows menangani rebuild `better-sqlite3` otomatis, tanpa cross-compile dari Mac.

**Tech Stack:** electron 44, electron-vite 5, electron-builder, better-sqlite3 13, GitHub Actions (windows-latest, Node 20/22).

**Spec:** PRD.md §4 (SQLite local file, userData/data/pura.db — sudah compliant di `src/main/index.ts:40-45`); tidak ada spec builder sebelumnya.

## Global Constraints

- DB production selalu `app.getPath('userData')/data/pura.db` — jangan ubah path di task mana pun.
- `better-sqlite3` adalah native module — jangan bundle ke asar tanpa `asarUnpack`; biarkan electron-builder rebuild.
- App adalah offline-first standalone — workflow tidak boleh menambah dependency cloud/runtime.
- Node CI pakai versi yang kompatibel Electron 44 (Node 20 LTS).

---

### Task 1: Tambah electron-builder + config Windows di package.json

**Files:**
- Modify: `package.json:1-47`
- Test: tidak ada unit test — verifikasi via `npx electron-builder --help` dan `npm run build`

**Interfaces:**
- Consumes: script `build` existing (`electron-vite build` → `out/main`, `out/preload`, `out/renderer`).
- Produces: script `dist`, `dist:win` dan blok `build` yang dipakai Task 2 (workflow).

- [ ] **Step 1: Install electron-builder sebagai devDependency**

Run: `npm install --save-dev electron-builder`
Expected: `package.json` bertambah `electron-builder` di devDependencies; `package-lock.json` terupdate.

- [ ] **Step 2: Tambah metadata + blok build + scripts**

Edit `package.json` menjadi (sesuaikan versi electron-builder yang terinstall):

```json
{
  "name": "sistem-aset-desa",
  "version": "1.0.0",
  "description": "Aplikasi Pembukuan Keuangan Pura Dalem Puri (offline-first)",
  "main": "./out/main/index.js",
  "author": "Pura Dalem Puri",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "dist": "npm run build && electron-builder",
    "dist:win": "npm run build && electron-builder --win --publish never"
  },
  "build": {
    "appId": "id.or.puradalempuri.keuangan",
    "productName": "Keuangan Pura Dalem Puri",
    "directories": { "output": "dist" },
    "files": [
      "out/**/*",
      "package.json"
    ],
    "asarUnpack": [
      "**/*.node"
    ],
    "win": {
      "target": ["nsis", "portable"]
    },
    "nsis": {
      "oneClick": false,
      "perMachine": false,
      "allowToChangeInstallationDirectory": true,
      "createDesktopShortcut": true,
      "createStartMenuShortcut": true,
      "shortcutName": "Keuangan Pura Dalem Puri"
    },
    "portable": {
      "artifactName": "${productName}-${version}-portable.${ext}"
    }
  }
}
```

Catatan: `files` sengaja hanya `out/**` + `package.json` agar `data/*.db` dan `.env` tidak ikut ter-package. `asarUnpack *.node` agar `better-sqlite3` native binding tetap terbaca dari asar.

- [ ] **Step 3: Verifikasi vite build masih lolos**

Run: `npm run build`
Expected: PASS, folder `out/main`, `out/preload`, `out/renderer` terisi.

- [ ] **Step 4: Verifikasi electron-builder terbaca**

Run: `npx electron-builder --help`
Expected: PASS (help tercetak, tidak ada error config).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: tambah electron-builder config Windows (nsis + portable)"
```

### Task 2: Workflow GitHub Actions build-win.yml

**Files:**
- Create: `.github/workflows/build-win.yml`
- Test: validasi YAML + dry-run logika (tidak perlu runner Windows lokal)

**Interfaces:**
- Consumes: script `dist:win` dari Task 1.
- Produces: artifact `windows-installer` berisi `dist/*.exe`.

- [ ] **Step 1: Buat file workflow**

Isi `.github/workflows/build-win.yml`:

```yaml
name: Build Windows

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:
  release:
    types: [created]

jobs:
  build-win:
    runs-on: windows-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm ci

      - run: npm run typecheck
      - run: npm run test -- --run 2>/dev/null || npm test
      - run: npm run dist:win

      - uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: |
            dist/*.exe
            dist/*.yml
          if-no-files-found: error

      - name: Upload ke GitHub Release
        if: github.event_name == 'release'
        uses: softprops/action-gh-release@v2
        with:
          files: dist/*.exe
```

Alasan tiap baris: `windows-latest` = build native sehingga `better-sqlite3` prebuilt/rebuild Windows benar; `npm ci` = reproducible; typecheck+test = gate sebelum packaging; `upload-artifact` = .exe bisa diunduh dari tab Actions tanpa menunggu Release; blok Release = lampirkan .exe otomatis saat buat Release di GitHub.

- [ ] **Step 2: Validasi YAML parse**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/build-win.yml')); print('YAML OK')"`
Expected: `YAML OK`. Jika `pyyaml` belum ada: `pip install pyyaml` atau cek via `node -e` dengan parser setara.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/build-win.yml
git commit -m "ci: tambah workflow build Windows (windows-latest)"
```

### Task 3: Repo remote + cara pakai (tanpa code, dokumentasi lisan ke user)

**Files:** tidak ada (operasi git + GitHub UI).

- [ ] **Step 1: Buat repo GitHub kosong** (user, via github.com/new atau `gh repo create`). Contoh: `taksu/sistem-aset-desa` private/public bebas.
- [ ] **Step 2: Sambungkan remote lokal yang saat ini kosong (`git remote -v` kosong)**

```bash
git remote add origin git@github.com:ORG/NAMA-REPO.git
git push -u origin main
```

- [ ] **Step 3: Ambil .exe** — buka tab Actions → run "Build Windows" → download artifact `windows-installer` (berisi Setup .exe NSIS + portable .exe). Untuk distribusi resmi: buat Release (Tags → Create release) → workflow otomatis melampirkan .exe ke Release.
- [ ] **Step 4 (opsional, nanti): Tambah icon** — taruh `build/icon.ico` (256x256) dan tambah `"win": { "icon": "build/icon.ico" }`. Tanpa ini build tetap jalan dengan icon default Electron. Jangan block release pertama untuk icon.
- [ ] **Step 5 (opsional, nanti): Code signing** — tanpa sertifikat, Windows SmartScreen akan menampilkan warning "Unknown publisher" (klik More info → Run anyway). Butuh sertifikat code-signing berbayar untuk hilangkan warning; tidak wajib untuk pemakaian internal pura.
