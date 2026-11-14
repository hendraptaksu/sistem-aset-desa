# AGENTS.md

Petunjuk wajib untuk agent (ZCode/Codex/atau AI assistant lain) yang bekerja di repo ini.

## Aturan Branch — WAJIB DIPATUHI

### `main` adalah branch produksi/release

- **DILARANG** melakukan pekerjaan apa pun di `main`: tidak boleh edit file, commit, atau merge langsung ke `main`.
- `main` hanya digunakan untuk **production/release**. Perubahan masuk ke `main` hanya lewat merge dari `dev` saat release, dengan permintaan eksplisit dari user.
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
   - Anggap user secara tidak sengaja berada di `main`. **Peringatkan user** dengan jelas bahwa `main` adalah branch produksi dan bukan tempat bekerja.
   - Jika working tree **bersih** (tidak ada perubahan yang belum di-commit), agent boleh **berinisiatif langsung pindah ke `dev`** (`git switch dev`) tanpa perlu menunggu persetujuan, lalu informasikan kepada user.
   - Jika working tree **tidak bersih** (ada perubahan yang belum di-commit di `main`), **jangan pindah branch otomatis** — peringatkan user dan tanyakan dulu: simpan (stash/commit ke branch lain) atau buang perubahan tersebut.
3. **Jika berada di `dev` atau branch lain:** lanjutkan pekerjaan seperti biasa.

### Selama sesi berjalan

- Sebelum commit, pastikan sekali lagi branch aktif bukan `main`.
- Jika karena alasan tertentu checkout/operasi git membuat sesi berakhir di `main`, kembalikan ke branch kerja sebelum melanjutkan.
- Jangan mengubah (checkout/reset/rebase) branch `main` kecuali user meminta proses release secara eksplisit.

## Alur Release (konteks)

```
feat/fix/chore ──merge──▶ dev ──merge (release, atas permintaan user)──▶ main
```

- Integrasi rutin: merge ke `dev`.
- Release produksi: hanya saat user meminta, merge `dev` → `main`.
