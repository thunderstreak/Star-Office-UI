#!/usr/bin/env python3
"""Repack serverroom spritesheet from a long strip into an 8x5 grid."""

import os
import importlib

ROOT = os.path.dirname(os.path.abspath(__file__))
IN_PATH = os.path.join(ROOT, "frontend", "serverroom-spritesheet.png")
OUT_PNG_PATH = os.path.join(ROOT, "frontend", "serverroom-spritesheet.png")
OUT_WEBP_PATH = os.path.join(ROOT, "frontend", "serverroom-spritesheet.webp")

FRAME_W = 180
FRAME_H = 251
FRAMES = 40
COLS = 8
ROWS = 5


def main() -> None:
    image_module = importlib.import_module("PIL.Image")
    img = image_module.open(IN_PATH).convert("RGBA")
    src_w, src_h = img.size

    expected_src_w = FRAME_W * FRAMES
    if src_w != expected_src_w or src_h != FRAME_H:
        raise SystemExit(
            f"Unexpected source size {img.size}, expected {(expected_src_w, FRAME_H)}"
        )

    out_w = FRAME_W * COLS
    out_h = FRAME_H * ROWS
    out = image_module.new("RGBA", (out_w, out_h), (0, 0, 0, 0))

    for i in range(FRAMES):
        src_x0 = i * FRAME_W
        frame = img.crop((src_x0, 0, src_x0 + FRAME_W, FRAME_H))
        row = i // COLS
        col = i % COLS
        out.paste(frame, (col * FRAME_W, row * FRAME_H))

    out.save(OUT_PNG_PATH)
    out.save(OUT_WEBP_PATH, format="WEBP", lossless=True)

    print(f"Wrote PNG: {OUT_PNG_PATH} ({out_w}x{out_h})")
    print(f"Wrote WebP: {OUT_WEBP_PATH} ({out_w}x{out_h})")


if __name__ == "__main__":
    main()
