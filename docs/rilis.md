# Rilis, Icon, dan Signing

Dokumen ini menjelaskan aset icon aplikasi dan jalur **code signing** untuk
installer Windows. Signing bersifat **opsional tetapi sangat disarankan**;
build tanpa sertifikat tetap berjalan, hanya akan memicu peringatan SmartScreen.

- **Diperbarui:** 2026-10-27
- **Target utama:** Windows (NSIS installer + portable)
- **Aset:** `build/icon.png`, `build/icon.ico`, `build/icon.icns`

---

## 1. Icon aplikasi

| File | Ukuran/format | Dipakai untuk |
|---|---|---|
| `build/icon.png` | 1024×1024 PNG RGBA | master, Linux, dan sumber semua ukuran |
| `build/icon.ico` | 16, 24, 32, 48, 64, 128, 256 px | executable & installer Windows |
| `build/icon.icns` | 16–1024 px | aplikasi macOS |

Konfigurasi ada di `package.json`:

```json
"win":   { "icon": "build/icon.ico" },
"mac":   { "icon": "build/icon.icns" },
"linux": { "icon": "build/icon.png" }
```

### Placeholder dan penggantian oleh pemilik

Repo belum memiliki aset desain resmi. Icon saat ini adalah **placeholder**
buatan: latar hijau tua dengan meru (tumpeng) emas, mengikuti warna aplikasi
pura. Pemilik dapat menggantinya kapan saja:

1. Siapkan PNG persegi **1024×1024** (disarankan memiliki area transparan di
   sudut; jangan memakai teks kecil karena akan hilang pada ukuran 16 px).
2. Ganti `build/icon.png` dengan file tersebut.
3. Jalankan generator (Python 3 standar, tanpa dependency npm):

   ```bash
   python3 build/generate-icons.py
   ```

   Generator membuat ulang `build/icon.ico` (multi-size) dan `build/icon.icns`
   (bila dijalankan di macOS dengan `iconutil`). Di Linux, `.icns` tidak dibuat;
   ganti file itu secara manual bila perlu.
4. Verifikasi:

   ```bash
   file build/icon.png build/icon.ico build/icon.icns
   sips -g pixelWidth -g pixelHeight build/icon.png build/icon.icns
   ```

Catatan: `icon.png` bukan sekadar lampiran — file ini ikut dibaca
electron-builder untuk Linux. Jangan menghapusnya setelah build Windows.

---

## 2. Signing Windows

### Status saat ini

- Konfigurasi signing **sudah disiapkan sebagai placeholder** di workflow
  `.github/workflows/build-win.yml` melalui `CSC_LINK` dan
  `CSC_KEY_PASSWORD`.
- **Belum ada sertifikat** di repo. Build CI saat ini menghasilkan installer
  **unsigned** dan tetap bisa diunduh/di-install.
- Sertifikat dan private key **tidak boleh** di-commit. `.gitignore` sudah
  mengabaikan `*.pfx`, `*.p12`, `*.pem`, `*.key`, `*.cer`, dan `*.b64`.

### Tindakan manual pemilik (wajib dilakukan di luar repo)

1. **Beli/ambil sertifikat code signing** dari Certificate Authority (mis.
   DigiCert, Sectigo, GlobalSign). Untuk Windows pilih **OV** atau **EV code
   signing**. Perhatikan: sejak 2023 banyak CA menerbitkan sertifikat pada
   hardware token/HSM dan tidak memberi file `.pfx` yang bisa diekspor. Jika
   CA memakai token/HSM atau layanan seperti Azure Trusted Signing, signing
   harus diatur terpisah (bukan lewat `CSC_LINK`); konsultasikan dengan CA.
2. Bila CA memberi file `.pfx`/`.p12` yang bisa diekspor, ubah ke base64:

   ```bash
   # macOS/Linux
   base64 -i sertifikat.pfx | tr -d '\n' > sertifikat.b64

   # PowerShell (Windows)
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("sertifikat.pfx")) |
     Set-Content -NoNewline sertifikat.b64
   ```

3. Buka repo GitHub → **Settings → Secrets and variables → Actions → New
   repository secret**, lalu isi:
   - `WIN_CSC_LINK` — isi base64 dari langkah 2 (electron-builder juga menerima
     URL/file path, tetapi base64 paling aman untuk CI).
   - `WIN_CSC_KEY_PASSWORD` — password file `.pfx`.
4. Hapus file `.pfx`/`.b64` dari laptop setelah diunggah, atau simpan di media
   terenkripsi. Jangan menaruhnya di folder repo.
5. Jalankan workflow **CI** (push ke `main`/`dev`, pull request, atau
   `workflow_dispatch`). Workflow meneruskan secret sebagai `CSC_LINK` dan
   `CSC_KEY_PASSWORD` ke `npm run dist:win`.
6. Verifikasi hasil di Windows:

   ```powershell
   Get-AuthenticodeSignature "dist\Keuangan Pura Dalem Puri-2.0.0-x64.exe" |
     Format-List Status, SignerCertificate
   ```

   `Status` harus **Valid**. Bisa juga dicek lewat Properties → Digital
   Signatures pada file `.exe`.

### Perilaku bila secret kosong

Workflow tetap menjalankan `npm run dist:win`. Jika `WIN_CSC_LINK` belum diisi,
GitHub Actions mengirim nilai kosong dan electron-builder melewati signing;
installer **unsigned** tetap dibuat dan diunggah sebagai artifact
`windows-installer`. Ini memudahkan pengujian sebelum sertifikat tersedia.

### Yang tidak dilakukan otomatis

- **macOS:** icon sudah disiapkan, tetapi CI tidak membangun/menandatangani
  aplikasi macOS. Notarization (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
  `APPLE_TEAM_ID`) belum dikonfigurasi.
- **Linux:** icon disiapkan; paket Linux tidak ditandatangani.
- **Reputasi SmartScreen:** sertifikat OV baru tetap bisa memunculkan
  peringatan sampai reputasi terbangun. Sertifikat EV umumnya langsung
  dipercaya, tetapi tetap bergantung pada kebijakan Microsoft.

---

## 3. Verifikasi build

Di mesin pengembangan (macOS/Linux) yang tidak memiliki toolchain Windows,
cukup validasi konfigurasi dan jalankan build aplikasi:

```bash
npm run typecheck
npm test
npm run build
```

`npm run dist:win` membutuhkan Windows atau wine dan **diuji di CI Windows**
(`build-win`). Artefak yang diharapkan: `dist/*.exe` (NSIS dan portable) serta
`dist/*.yml`. Periksa bahwa installer memakai icon baru dan, bila secret
signing diisi, tanda tangan valid seperti langkah 2.6.
