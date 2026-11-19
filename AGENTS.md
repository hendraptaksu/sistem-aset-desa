# AGENTS.md

Petunjuk wajib untuk agent (ZCode/Codex/atau AI assistant lain) yang bekerja di repo ini.

## Aturan Branch — WAJIB DIPATUHI

### `main` adalah branch produksi/release

- **Jangan melakukan perubahan kode langsung di `main`**: tidak ada edit file, commit fitur/bugfix, atau commit pengembangan di `main`.
- `main` hanya menerima:
  - **merge commit** dari `dev` saat rilis (atas permintaan eksplisit user),
  - **merge commit** dari `hotfix/*` untuk darurat produksi (lihat bagian *Bypass*),
  - **tag rilis** (mis. `v2.0.0`) yang menandai commit produksi.
- Version bump (`package.json`, `package-lock.json`) dan changelog ditulis di **`dev`** sebagai commit `chore(release): vX.Y.Z`, lalu di-merge ke `main`. Jangan membuat commit rilis langsung di `main`.
- Tag rilis selalu dibuat di `main`, bukan di `dev`.
- Jangan pernah push ke `main` tanpa diminta secara eksplisit.

### Branch kerja

- Branch default untuk pekerjaan sehari-hari adalah **`dev`**.
- Untuk pekerjaan yang lebih besar/terisolasi, buat branch dari `dev`, misalnya:
  - `feat/<nama-fitur>`
  - `fix/<nama-bug>`
  - `chore/<nama-pekerjaan>`

### Prosedur saat memulai sesi/pekerjaan

1. Selalu cek branch aktif terlebih dahulu:
   ```bash
   git branch --show-current
   ```
2. **Jika berada di `main`:**
   - Anggap user secara tidak sengaja berada di `main`. **Peringatkan user** dengan jelas bahwa `main` adalah branch produksi dan perubahan kode tidak boleh dilakukan langsung di sana.
   - Jika working tree **bersih** (tidak ada perubahan yang belum di-commit), agent boleh **berinisiatif langsung pindah ke `dev`** (`git switch dev`) tanpa perlu menunggu persetujuan, lalu informasikan kepada user.
   - Jika working tree **tidak bersih** (ada perubahan yang belum di-commit di `main`), **jangan pindah branch otomatis** — peringatkan user dan tanyakan dulu: simpan (stash/commit ke branch lain) atau buang perubahan tersebut.
3. **Jika berada di `dev` atau branch lain:** lanjutkan pekerjaan seperti biasa.

### Selama sesi berjalan

- Sebelum commit, pastikan sekali lagi branch aktif bukan `main` (kecuali merge rilis/hotfix yang diminta eksplisit).
- Jika karena alasan tertentu checkout/operasi git membuat sesi berakhir di `main`, kembalikan ke branch kerja sebelum melanjutkan.
- Jangan mengubah (checkout/reset/rebase) branch `main` kecuali sebagai bagian dari proses rilis/hotfix yang diminta secara eksplisit.

## Alur Release (konteks)

```
feat/fix/chore ──merge──▶ dev ──merge (release)──▶ main ──tag vX.Y.Z──▶ GitHub Release
```

- **Integrasi rutin:** merge ke `dev`.
- **Release produksi:** hanya saat user meminta:
  1. Siapkan changelog + version bump di `dev`, commit `chore(release): vX.Y.Z`.
  2. Verifikasi (`npm run typecheck`, `npm test`, `npm run build`).
  3. Merge `dev` → `main` memakai merge commit (`--no-ff`), lalu push `dev` dan `main`.
  4. Buat tag `vX.Y.Z` **di `main`** dan push tag.
  5. Buat GitHub Release; event `release` memicu workflow yang membangun installer.
  Checklist teknis ada di `docs/rilis.md`.

## Bypass: hotfix produksi

Boleh, tetapi hanya sebagai **jalur darurat yang eksplisit**, bukan kebiasaan:

- **Kapan:** perbaikan produksi mendesak sementara `dev` berisi pekerjaan setengah jadi.
- **Prosedur:**
  1. Minta persetujuan sadar dari user (mis. "ya, saya tahu ini bypass").
  2. Buat branch dari `main`: `git switch main && git switch -c hotfix/<nama>`.
  3. Jaga scope tetap kecil dan sertakan test.
  4. Merge ke `main`, tag patch (`vX.Y.(Z+1)`), push tag, buat release.
  5. **Wajib back-merge `main` → `dev`** setelahnya agar `dev` tidak divergen.
- **Larangan:** jangan menjadikan bypass sebagai default karena malas membuat branch, jangan commit fitur di `main`, dan jangan meninggalkan `main` dan `dev` divergen.
