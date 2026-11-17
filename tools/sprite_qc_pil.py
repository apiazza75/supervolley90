#!/usr/bin/env python3
"""Pillow fallback for sprite white-matte leak QC.

The user-visible defect is not only pure white. Anti-aliased sprite generation
can leave a pale matte halo between the legs: visually white enough to flash on
the parquet, but not bright enough to trip a strict 238/238/238 check. Count
both hard white holes and softer near-white matte pixels that touch
transparency.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image


ACTIONS = [
    "idle",
    "ready-retreat",
    "ready-lateral",
    "walk",
    "shuffle",
    "run",
    "run-passing",
    "approach",
    "approach-plant",
    *[f"approach-steps-{i}" for i in range(1,10)],
    "spike",
    "spike-rise",
    "spike-cock",
    "spike-descent",
    "backpedal-entry",
    "spikeFollow",
    "block",
    "block-landing",
    "block-landing-between",
    "block-descent",
    "bump",
    "bump-follow",
    "bump-preparation",
    "bump-release",
    "bump-release-early",
    "bump-moving-entry",
    "celebrate-follow",
    "set",
    "set-entry",
    "set-return",
    "backSet",
    "turn",
    "backpedal", "runTurn", "turnStop", "runBrake",
    "turn-stop-between",
    "dive",
    "dive-recovery",
    "dive-floor",
    "dive-rise",
    "dive-impact",
    "dive-turn",
    "serve",
    "serve-toss-release",
    "serve-follow-between",
    "backset-recovery",
    "serve-swing",
    "serve-follow",
    "serve-charge-release",
    "walk-release",
    "walk-arm-release",
    "jumpServe",
    "jump-serve-entry",
    "jump-serve-toss",
    "jump-serve-rise",
    "jumpServeFollow",
    "celebrate",
]

ROOT = Path("public/sprites")
OUT = Path("artifacts/sprite-qc-pil.json")
HARD_WHITE_BUDGET = 0
MATTE_BUDGET = 0
CELL = 512


def touches_transparency(data, w: int, h: int, x: int, y: int) -> bool:
    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        if nx < 0 or nx >= w or ny < 0 or ny >= h:
            return True
        if data[nx, ny][3] < 40:
            return True
    return False


def body_colour(px: tuple[int, int, int, int]) -> bool:
    r, g, b, a = px
    if a < 150:
        return False
    # Exclude the pale tones intentionally used for socks/knee pads/highlights;
    # they are not useful as silhouette walls around a leaked white matte.
    return not (min(r, g, b) >= 218 and max(r, g, b) - min(r, g, b) <= 38)


def enclosed_by_body(data, w: int, h: int, x: int, y: int) -> bool:
    cell_x0 = (x // CELL) * CELL
    cell_x1 = min(cell_x0 + CELL, w)
    cell_y0 = (y // CELL) * CELL
    local_y = y - cell_y0
    if local_y < CELL * 0.34:
        return False

    left = any(body_colour(data[xx, y]) for xx in range(max(cell_x0, x - 28), x))
    right = any(body_colour(data[xx, y]) for xx in range(x + 1, min(cell_x1, x + 29)))
    if left and right:
        return True

    # A narrow vertical slit between legs can be bounded diagonally rather than
    # on the exact same scanline. Check a tiny lower-body neighbourhood before
    # treating the pixel as harmless external trim.
    for yy in range(max(cell_y0 + int(CELL * 0.34), y - 8), min(h, y + 9)):
        left = any(body_colour(data[xx, yy]) for xx in range(max(cell_x0, x - 20), x))
        right = any(body_colour(data[xx, yy]) for xx in range(x + 1, min(cell_x1, x + 21)))
        if left and right:
            return True
    return False


def hard_white_leak_pixel(data, w: int, h: int, x: int, y: int) -> bool:
    r, g, b, a = data[x, y]
    if a < 200 or r < 238 or g < 238 or b < 238:
        return False
    return touches_transparency(data, w, h, x, y)


def matte_leak_pixel(data, w: int, h: int, x: int, y: int) -> bool:
    r, g, b, a = data[x, y]
    if a < 120 or a >= 220:
        return False
    # Pale, low-saturation matte remnants. This excludes uniforms, socks and
    # highlights, but catches the off-white fringe left by background removal.
    if min(r, g, b) < 222 or max(r, g, b) - min(r, g, b) > 30:
        return False
    return touches_transparency(data, w, h, x, y) and enclosed_by_body(data, w, h, x, y)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=ROOT)
    parser.add_argument('--out', type=Path, default=OUT)
    parser.add_argument('--action', action='append', choices=ACTIONS)
    args = parser.parse_args()
    report = {}
    hard_total = 0
    matte_total = 0
    for action in args.action or ACTIONS:
        img = Image.open(args.root / f"{action}.png").convert("RGBA")
        pix = img.load()
        hard = 0
        matte = 0
        for y in range(img.height):
            for x in range(img.width):
                if hard_white_leak_pixel(pix, img.width, img.height, x, y):
                    hard += 1
                if matte_leak_pixel(pix, img.width, img.height, x, y):
                    matte += 1
        hard_total += hard
        matte_total += matte
        report[action] = {
            "hardWhiteLeakPixels": hard,
            "nearWhiteMattePixels": matte,
            "width": img.width,
            "height": img.height,
        }
        print(f"{action:11} hard white: {hard:5}  near-white matte: {matte:5}")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(f"total hard white leak pixels: {hard_total}")
    print(f"total near-white matte pixels: {matte_total}")
    if hard_total > HARD_WHITE_BUDGET:
        raise SystemExit(f"hard white leak budget exceeded: {hard_total} > {HARD_WHITE_BUDGET}")
    if matte_total > MATTE_BUDGET:
        raise SystemExit(f"near-white matte budget exceeded: {matte_total} > {MATTE_BUDGET}")


if __name__ == "__main__":
    main()
