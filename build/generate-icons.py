#!/usr/bin/env python3
"""Generator ikon placeholder Keuangan Pura Dalem Puri.

Skrip ini sengaja memakai Python standar (zlib/struct) tanpa dependency npm
atau Pillow. Jalankan dari root repo:

    python3 build/generate-icons.py

Output:
    build/icon.png   1024x1024 (master, dipakai Linux/macOS)
    build/icon.ico   16/24/32/48/64/128/256 (Windows)
    build/icon.icns  16..1024 (macOS, hanya bila `iconutil` tersedia)

Ikon ini placeholder hijau-emas (meru) karena repo belum punya aset desain.
Pemilik boleh mengganti `build/icon.png` dengan PNG 1024x1024 lalu menjalankan
ulang skrip ini, atau langsung mengganti file .ico/.icns.
"""

from __future__ import annotations

import math
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

SIZE = 1024
CENTER = SIZE / 2

# Palet: hijau tua pura + emas.
BG_TOP = (30, 107, 74)
BG_BOTTOM = (6, 43, 28)
RING = (226, 191, 105)
MAST = (196, 148, 60)
DOOR = (9, 47, 31)

# Meru (tumpeng) di dalam kanvas 1024x1024.
BASE_Y0, BASE_Y1 = 768.0, 834.0
BASE_HW_TOP, BASE_HW_BOTTOM = 240.0, 268.0
STEP_Y0, STEP_Y1 = 834.0, 862.0
STEP_HW_TOP, STEP_HW_BOTTOM = 286.0, 300.0
TIERS = [
    # (y atas, y bawah, half-width atas, half-width bawah)
    (668.0, 748.0, 198.0, 230.0),
    (570.0, 650.0, 146.0, 176.0),
    (460.0, 540.0, 96.0, 122.0),
]
SPIRE_Y0, SPIRE_Y1 = 330.0, 460.0
SPIRE_HW0, SPIRE_HW1 = 42.0, 7.0
FINIAL_Y = 316.0
FINIAL_R = 23.0
MAST_Y0, MAST_Y1 = 440.0, 780.0
MAST_HW = 22.0
DOOR_Y0, DOOR_Y1 = 798.0, 834.0
DOOR_HW = 36.0


def clamp(value: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return lo if value < lo else hi if value > hi else value


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        round(a[0] + (b[0] - a[0]) * t),
        round(a[1] + (b[1] - a[1]) * t),
        round(a[2] + (b[2] - a[2]) * t),
    )


def gold(y: float) -> tuple[int, int, int]:
    """Emas dengan highlight di atas dan bayangan di bawah."""
    if y <= 300:
        return (250, 232, 176)
    if y >= 840:
        return (196, 148, 60)
    if y <= 560:
        return mix((250, 232, 176), (235, 201, 112), (y - 300) / 260)
    return mix((235, 201, 112), (196, 148, 60), (y - 560) / 280)


def background(y: float, x: float) -> tuple[int, int, int]:
    base = mix(BG_TOP, BG_BOTTOM, clamp((y - 32) / (SIZE - 64)))
    # Glow lembut di belakang meru.
    dist = math.hypot(x - CENTER, y - 450.0)
    glow = clamp(1.0 - dist / 700.0) ** 2
    return (
        min(255, base[0] + int(18 * glow)),
        min(255, base[1] + int(24 * glow)),
        min(255, base[2] + int(12 * glow)),
    )


def sd_round_rect(x: float, y: float, cx: float, cy: float, hw: float, hh: float, r: float) -> float:
    """Signed distance dengan nilai positif di dalam bentuk."""
    qx = abs(x - cx) - (hw - r)
    qy = abs(y - cy) - (hh - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return r - outside - inside


def coverage(d: float) -> float:
    """Signed distance (positif di dalam) -> coverage 1px anti-alias."""
    return clamp(d + 0.5)


class Canvas:
    def __init__(self) -> None:
        self.pixels = bytearray(SIZE * SIZE * 4)

    def blend(self, index: int, color: tuple[int, int, int], alpha: float) -> None:
        if alpha <= 0:
            return
        if alpha >= 1:
            self.pixels[index] = color[0]
            self.pixels[index + 1] = color[1]
            self.pixels[index + 2] = color[2]
            self.pixels[index + 3] = 255
            return
        pixels = self.pixels
        dst_a = pixels[index + 3] / 255.0
        out_a = alpha + dst_a * (1.0 - alpha)
        if out_a <= 0:
            return
        for channel in range(3):
            dst = pixels[index + channel] / 255.0
            out = (color[channel] / 255.0) * alpha + dst * dst_a * (1.0 - alpha)
            pixels[index + channel] = round(clamp(out / out_a) * 255)
        pixels[index + 3] = round(out_a * 255)

    def rounded_rect(
        self,
        cx: float,
        cy: float,
        hw: float,
        hh: float,
        radius: float,
        color,
        alpha: float = 1.0,
        ring_width: float = 0.0,
    ) -> None:
        x0 = max(0, int(cx - hw - 2))
        x1 = min(SIZE, int(cx + hw + 3))
        y0 = max(0, int(cy - hh - 2))
        y1 = min(SIZE, int(cy + hh + 3))
        for y in range(y0, y1):
            row = y * SIZE * 4
            py = y + 0.5
            for x in range(x0, x1):
                d = sd_round_rect(x + 0.5, py, cx, cy, hw, hh, radius)
                if ring_width > 0:
                    d = ring_width / 2 - abs(d)
                cov = coverage(d)
                if cov <= 0:
                    continue
                tint = color(py) if callable(color) else color
                self.blend(row + x * 4, tint, cov * alpha)

    def circle(self, cx: float, cy: float, radius: float, color, alpha: float = 1.0) -> None:
        x0 = max(0, int(cx - radius - 2))
        x1 = min(SIZE, int(cx + radius + 3))
        y0 = max(0, int(cy - radius - 2))
        y1 = min(SIZE, int(cy + radius + 3))
        for y in range(y0, y1):
            row = y * SIZE * 4
            for x in range(x0, x1):
                d = radius - math.hypot(x + 0.5 - cx, y + 0.5 - cy)
                cov = coverage(d)
                if cov <= 0:
                    continue
                tint = color(y + 0.5) if callable(color) else color
                self.blend(row + x * 4, tint, cov * alpha)

    def trapezoid(
        self,
        x_center: float,
        y0: float,
        y1: float,
        hw0: float,
        hw1: float,
        color,
        alpha: float = 1.0,
    ) -> None:
        max_hw = max(hw0, hw1)
        x0 = max(0, int(x_center - max_hw - 2))
        x1 = min(SIZE, int(x_center + max_hw + 3))
        yy0 = max(0, int(y0 - 2))
        yy1 = min(SIZE, int(y1 + 3))
        span = y1 - y0
        for y in range(yy0, yy1):
            row = y * SIZE * 4
            py = y + 0.5
            t = clamp((py - y0) / span)
            half = hw0 + (hw1 - hw0) * t
            dy = min(py - y0, y1 - py)
            for x in range(x0, x1):
                dx = half - abs(x + 0.5 - x_center)
                cov = coverage(min(dx, dy))
                if cov <= 0:
                    continue
                tint = color(py) if callable(color) else color
                self.blend(row + x * 4, tint, cov * alpha)

    def to_rgba(self) -> bytes:
        return bytes(self.pixels)


def render() -> bytes:
    canvas = Canvas()

    # Latar rounded-square penuh dengan gradient hijau + glow.
    margin = 32.0
    base = bytearray(SIZE * SIZE * 4)
    for y in range(SIZE):
        row = y * SIZE * 4
        py = y + 0.5
        for x in range(SIZE):
            d = sd_round_rect(
                x + 0.5, py, CENTER, CENTER, CENTER - margin, CENTER - margin, 210.0
            )
            cov = coverage(d)
            if cov <= 0:
                continue
            idx = row + x * 4
            r, g, b = background(py, x + 0.5)
            base[idx] = r
            base[idx + 1] = g
            base[idx + 2] = b
            base[idx + 3] = round(cov * 255)
    canvas.pixels = base

    # Cincin emas tipis di dalam tepi.
    canvas.rounded_rect(
        CENTER,
        CENTER,
        CENTER - 54.0,
        CENTER - 54.0,
        188.0,
        RING,
        alpha=0.42,
        ring_width=6.0,
    )

    # Tiang tengah, lalu tier meru menutupinya di bagian yang padat.
    canvas.rounded_rect(CENTER, (MAST_Y0 + MAST_Y1) / 2, MAST_HW, (MAST_Y1 - MAST_Y0) / 2, 8.0, MAST)
    for tier in TIERS:
        canvas.trapezoid(CENTER, *tier, gold)
    # Dasar candi + undakan bawah.
    canvas.trapezoid(CENTER, BASE_Y0, BASE_Y1, BASE_HW_TOP, BASE_HW_BOTTOM, gold)
    canvas.trapezoid(CENTER, STEP_Y0, STEP_Y1, STEP_HW_TOP, STEP_HW_BOTTOM, gold)
    # Spire + finial.
    canvas.trapezoid(CENTER, SPIRE_Y0, SPIRE_Y1, SPIRE_HW1, SPIRE_HW0, gold)
    canvas.circle(CENTER, FINIAL_Y, FINIAL_R, gold)
    # Pintu masuk gelap di dasar.
    canvas.circle(CENTER, DOOR_Y0, DOOR_HW, DOOR)
    canvas.rounded_rect(CENTER, (DOOR_Y0 + DOOR_Y1) / 2, DOOR_HW, (DOOR_Y1 - DOOR_Y0) / 2, 6.0, DOOR)

    return canvas.to_rgba()


def resize(rgba: bytes, src_size: int, dst_size: int) -> bytes:
    """Box filter dengan alpha premultiplied supaya tepi tidak kotor."""
    scale = src_size / dst_size
    out = bytearray(dst_size * dst_size * 4)
    for dy in range(dst_size):
        sy0 = dy * scale
        sy1 = (dy + 1) * scale
        for dx in range(dst_size):
            sx0 = dx * scale
            sx1 = (dx + 1) * scale
            acc_r = acc_g = acc_b = acc_a = 0.0
            weight = 0.0
            y = int(sy0)
            while y < sy1:
                wy = min(y + 1, sy1) - max(y, sy0)
                x = int(sx0)
                while x < sx1:
                    wx = min(x + 1, sx1) - max(x, sx0)
                    w = wx * wy
                    idx = (y * src_size + x) * 4
                    a = rgba[idx + 3] / 255.0
                    acc_r += rgba[idx] / 255.0 * a * w
                    acc_g += rgba[idx + 1] / 255.0 * a * w
                    acc_b += rgba[idx + 2] / 255.0 * a * w
                    acc_a += a * w
                    weight += w
                    x += 1
                y += 1
            out_idx = (dy * dst_size + dx) * 4
            if acc_a <= 0:
                continue
            out[out_idx] = round(clamp(acc_r / acc_a) * 255)
            out[out_idx + 1] = round(clamp(acc_g / acc_a) * 255)
            out[out_idx + 2] = round(clamp(acc_b / acc_a) * 255)
            out[out_idx + 3] = round(clamp(acc_a / weight) * 255)
    return bytes(out)


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + tag
        + data
        + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    )


def encode_png(rgba: bytes, size: int) -> bytes:
    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)  # filter: none
        raw.extend(rgba[y * stride : (y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + png_chunk(b"IEND", b"")
    )


def bmp_icon_image(rgba: bytes, size: int) -> bytes:
    """Gambar ICO format DIB 32-bit + AND mask (kompatibel Windows lama)."""
    xor = bytearray()
    for y in range(size - 1, -1, -1):
        row = y * size * 4
        for x in range(size):
            idx = row + x * 4
            xor.extend((rgba[idx + 2], rgba[idx + 1], rgba[idx], rgba[idx + 3]))
    mask_row_bytes = ((size + 31) // 32) * 4
    mask = bytearray()
    for y in range(size - 1, -1, -1):
        row = y * size * 4
        bits = bytearray(mask_row_bytes)
        for x in range(size):
            if rgba[row + x * 4 + 3] < 128:
                bits[x // 8] |= 0x80 >> (x % 8)
        mask.extend(bits)
    header = struct.pack(
        "<IiiHHIIiiII",
        40,
        size,
        size * 2,
        1,
        32,
        0,
        len(xor) + len(mask),
        0,
        0,
        0,
        0,
    )
    return header + bytes(xor) + bytes(mask)


def encode_ico(rgba: bytes, size: int, sizes: list[int]) -> bytes:
    images: list[tuple[int, bytes]] = []
    for icon_size in sizes:
        resized = rgba if icon_size == size else resize(rgba, size, icon_size)
        if icon_size >= 256:
            payload = encode_png(resized, icon_size)
        else:
            payload = bmp_icon_image(resized, icon_size)
        images.append((icon_size, payload))

    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = bytearray()
    body = bytearray()
    for icon_size, payload in images:
        width = 0 if icon_size >= 256 else icon_size
        height = 0 if icon_size >= 256 else icon_size
        entries.extend(
            struct.pack(
                "<BBBBHHII",
                width,
                height,
                0,
                0,
                1,
                32,
                len(payload),
                offset + len(body),
            )
        )
        body.extend(payload)
    return header + bytes(entries) + bytes(body)


def main() -> int:
    here = os.path.dirname(os.path.abspath(__file__))
    rgba = render()

    png_path = os.path.join(here, "icon.png")
    with open(png_path, "wb") as handle:
        handle.write(encode_png(rgba, SIZE))
    print(f"PNG  {png_path} ({SIZE}x{SIZE})")

    sizes = [16, 24, 32, 48, 64, 128, 256]
    ico_path = os.path.join(here, "icon.ico")
    with open(ico_path, "wb") as handle:
        handle.write(encode_ico(rgba, SIZE, sizes))
    print(f"ICO  {ico_path} ({', '.join(str(s) for s in sizes)})")

    iconutil = shutil.which("iconutil")
    if iconutil is None:
        print("ICNS dilewati: `iconutil` tidak tersedia (bukan macOS).")
        return 0

    icns_path = os.path.join(here, "icon.icns")
    with tempfile.TemporaryDirectory(prefix="pura-iconset-") as temp_dir:
        iconset = os.path.join(temp_dir, "icon.iconset")
        os.makedirs(iconset)
        needed = {
            "icon_16x16.png": 16,
            "icon_16x16@2x.png": 32,
            "icon_32x32.png": 32,
            "icon_32x32@2x.png": 64,
            "icon_128x128.png": 128,
            "icon_128x128@2x.png": 256,
            "icon_256x256.png": 256,
            "icon_256x256@2x.png": 512,
            "icon_512x512.png": 512,
            "icon_512x512@2x.png": 1024,
        }
        for name, icon_size in needed.items():
            data = rgba if icon_size == SIZE else resize(rgba, SIZE, icon_size)
            with open(os.path.join(iconset, name), "wb") as handle:
                handle.write(encode_png(data, icon_size))
        subprocess.run(
            [iconutil, "-c", "icns", iconset, "-o", icns_path],
            check=True,
        )
    print(f"ICNS {icns_path} (16..1024)" )
    return 0


if __name__ == "__main__":
    sys.exit(main())
