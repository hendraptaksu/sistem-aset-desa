// AUD-33 — icon aplikasi dan placeholder signing.
// Test ini sengaja tidak memanggil `file`/`sips` supaya tetap jalan di CI
// Windows/Linux. Format PNG/ICO/ICNS diperiksa langsung dari header biner.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootDir = fileURLToPath(new URL('../', import.meta.url));
const baca = (path: string): Buffer => readFileSync(join(rootDir, path));
const teks = (path: string): string => baca(path).toString('utf8');

const PAKET = JSON.parse(teks('package.json')) as {
  build?: {
    win?: { icon?: string };
    mac?: { icon?: string };
    linux?: { icon?: string };
  };
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function bacaPng(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe('AUD-33 — icon aplikasi', () => {
  it('package.json menunjuk icon per platform dan file-nya ada', () => {
    expect(PAKET.build?.win?.icon).toBe('build/icon.ico');
    expect(PAKET.build?.mac?.icon).toBe('build/icon.icns');
    expect(PAKET.build?.linux?.icon).toBe('build/icon.png');
    for (const file of ['build/icon.png', 'build/icon.ico', 'build/icon.icns']) {
      expect(existsSync(join(rootDir, file)), `${file} ada`).toBe(true);
    }
  });

  it('icon.png adalah PNG RGBA minimal 512x512', () => {
    const png = baca('build/icon.png');
    const { width, height } = bacaPng(png);
    expect(width).toBeGreaterThanOrEqual(512);
    expect(height).toBe(width);
    expect(png.readUInt8(24)).toBe(8); // bit depth
    expect(png.readUInt8(25)).toBe(6); // RGBA
  });

  it('icon.ico memuat 16/32/48/64/128/256 dan setiap entry valid', () => {
    const ico = baca('build/icon.ico');
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1); // type icon
    const count = ico.readUInt16LE(4);
    expect(count).toBeGreaterThanOrEqual(6);

    const sizes: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      const width = ico.readUInt8(entry) || 256;
      const height = ico.readUInt8(entry + 1) || 256;
      const byteSize = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const payload = ico.subarray(offset, offset + byteSize);
      expect(width, `entry ${i}`).toBe(height);
      expect(offset + byteSize, `entry ${i} dalam file`).toBeLessThanOrEqual(ico.length);
      if (width >= 256) {
        expect(payload.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
        expect(payload.readUInt32BE(16)).toBe(256);
      } else {
        expect(payload.readUInt32LE(0)).toBe(40); // BITMAPINFOHEADER
        expect(payload.readInt32LE(4)).toBe(width);
        expect(payload.readInt32LE(8)).toBe(height * 2); // XOR + AND mask
      }
      sizes.push(width);
    }
    for (const size of [16, 32, 48, 64, 128, 256]) {
      expect(sizes, `ukuran ${size}`).toContain(size);
    }
  });

  it('icon.icns valid dan cocok dengan panjang file', () => {
    const icns = baca('build/icon.icns');
    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
  });
});

describe('AUD-33 — placeholder signing', () => {
  it('workflow Windows meneruskan secret signing tanpa hardcode', () => {
    const workflow = teks('.github/workflows/build-win.yml');
    expect(workflow).toContain('CSC_LINK: ${{ secrets.WIN_CSC_LINK }}');
    expect(workflow).toContain('CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}');
    expect(workflow).toContain('npm run dist:win');
    expect(workflow).not.toMatch(/BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
    expect(workflow).not.toMatch(/certificateFile:/);
  });

  it('dokumentasi rilis menjelaskan signing manual dan fallback unsigned', () => {
    const rilis = teks('docs/rilis.md');
    for (const istilah of [
      'WIN_CSC_LINK',
      'WIN_CSC_KEY_PASSWORD',
      'Tindakan manual pemilik',
      'unsigned',
      'build/icon.ico',
      'tidak boleh',
    ]) {
      expect(rilis, `docs/rilis.md memuat "${istilah}"`).toContain(istilah);
    }
    const gitignore = teks('.gitignore');
    for (const pola of ['*.pfx', '*.p12', '*.pem', '*.key']) {
      expect(gitignore, `.gitignore mengabaikan ${pola}`).toContain(pola);
    }
  });
});
