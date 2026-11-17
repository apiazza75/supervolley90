#!/usr/bin/env python3
"""Remove residual white matte from static sprite sheets.

This is the non-browser fallback for tools/sanitize-sprites-v3.ts. It works per
512 px cell, so enclosed matte between legs can be fixed without touching the
rest of the sheet.
"""

from __future__ import annotations

import hashlib
import argparse
import json
from collections import deque
from pathlib import Path

from PIL import Image


ACTIONS = [
    "idle", "ready-retreat", "ready-lateral",
    "walk",
    "run",
    "run-passing",
    "approach",
    "approach-plant",
    *[f"approach-steps-{i}" for i in range(1,10)],
    "spike",
    "block",
    "block-landing-between",
    "block-descent",
    "bump",
    "bump-moving-entry",
    "set",
    "set-return",
    "dive",
    "dive-impact",
    "dive-turn",
    "serve",
    "serve-toss-release",
    "serve-follow-between",
    "backset-recovery",
    "jumpServe",
    "jump-serve-rise",
    "turn-stop-between",
    "celebrate",
]

CELL = 512
ROOT = Path("public/sprites")
REPORT = Path("artifacts/sprite-sanitize-pil.json")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def near_white(px: tuple[int, int, int, int]) -> bool:
    r, g, b, a = px
    # Residual matte from sprite generation is usually a semi-opaque,
    # low-saturation off-white fringe. Solid whites in the authored art
    # (socks, kneepads, jersey highlights) must survive; the edge fringe must
    # not, because it flashes as white dirt on the parquet and in leg gaps.
    return 120 <= a < 220 and min(r, g, b) >= 222 and max(r, g, b) - min(r, g, b) <= 34


def hard_white(px: tuple[int, int, int, int]) -> bool:
    r, g, b, a = px
    return a >= 200 and min(r, g, b) >= 238 and max(r, g, b) - min(r, g, b) <= 24


def low_alpha_pale_matte(px: tuple[int, int, int, int]) -> bool:
    r, g, b, a = px
    return 40 <= a < 220 and min(r, g, b) >= 218 and max(r, g, b) - min(r, g, b) <= 34


def browser_premultiplied_matte_candidate(px: tuple[int, int, int, int]) -> bool:
    r, g, b, a = px
    return 120 <= a < 220 and min(r, g, b) >= 218 and max(r, g, b) - min(r, g, b) <= 30


def transparent(px: tuple[int, int, int, int]) -> bool:
    return px[3] < 40


def body_colour(px: tuple[int, int, int, int]) -> bool:
    r, g, b, a = px
    return a >= 180 and not (min(r, g, b) >= 218 and max(r, g, b) - min(r, g, b) <= 38)


def nearest_body(pix, w: int, h: int, x: int, y: int) -> tuple[int, int, int, int] | None:
    for radius in range(1, 9):
        for yy in range(max(0, y - radius), min(h, y + radius + 1)):
            for xx in range(max(0, x - radius), min(w, x + radius + 1)):
                if abs(xx - x) != radius and abs(yy - y) != radius:
                    continue
                c = pix[xx, yy]
                if body_colour(c):
                    return c
    return None


def sanitize_cell(img: Image.Image, ox: int, oy: int) -> tuple[int, int]:
    pix = img.load()
    seen: set[tuple[int, int]] = set()
    repainted = 0
    cleared = 0
    x0, x1 = ox, min(ox + CELL, img.width)
    y0, y1 = oy, min(oy + CELL, img.height)

    for sy in range(y0, y1):
        for sx in range(x0, x1):
            if (sx, sy) in seen or not near_white(pix[sx, sy]):
                continue

            q: deque[tuple[int, int]] = deque([(sx, sy)])
            seen.add((sx, sy))
            comp: list[tuple[int, int]] = []
            touches_cell_edge = False
            touches_alpha_edge = False
            while q:
                x, y = q.popleft()
                comp.append((x, y))
                if x in (x0, x1 - 1) or y in (y0, y1 - 1):
                    touches_cell_edge = True
                for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                    if nx < x0 or nx >= x1 or ny < y0 or ny >= y1:
                        touches_alpha_edge = True
                        continue
                    if transparent(pix[nx, ny]):
                        touches_alpha_edge = True
                    if (nx, ny) not in seen and near_white(pix[nx, ny]):
                        seen.add((nx, ny))
                        q.append((nx, ny))

            ys = [p[1] - y0 for p in comp]
            lower_body = max(ys) > CELL * 0.45
            small_enclosed = len(comp) <= 9000 and lower_body and not touches_cell_edge
            if not (touches_alpha_edge or small_enclosed):
                continue

            for x, y in comp:
                colour = nearest_body(pix, img.width, img.height, x, y)
                if colour is None:
                    pix[x, y] = (255, 255, 255, 0)
                    cleared += 1
                else:
                    pix[x, y] = colour
                    repainted += 1

    return repainted, cleared


def touches_transparency(pix, w: int, h: int, x: int, y: int) -> bool:
    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        if nx < 0 or nx >= w or ny < 0 or ny >= h:
            return True
        if transparent(pix[nx, ny]):
            return True
    return False


def enclosed_by_body(pix, w: int, h: int, x: int, y: int) -> bool:
    cell_x0 = (x // CELL) * CELL
    cell_x1 = min(cell_x0 + CELL, w)
    cell_y0 = (y // CELL) * CELL
    local_y = y - cell_y0
    if local_y < CELL * 0.34:
        return False

    left = any(body_colour(pix[xx, y]) for xx in range(max(cell_x0, x - 28), x))
    right = any(body_colour(pix[xx, y]) for xx in range(x + 1, min(cell_x1, x + 29)))
    if left and right:
        return True

    for yy in range(max(cell_y0 + int(CELL * 0.34), y - 8), min(h, y + 9)):
        left = any(body_colour(pix[xx, yy]) for xx in range(max(cell_x0, x - 20), x))
        right = any(body_colour(pix[xx, yy]) for xx in range(x + 1, min(cell_x1, x + 21)))
        if left and right:
            return True
    return False


def sanitize_hard_white_edges(img: Image.Image) -> tuple[int, int]:
    """Remove only hard-white pixels exposed on a transparent edge.

    Interior white details remain intact. The failed QC pixels are edge leaks:
    tiny hard-white antialiasing specks adjacent to transparency, which flash
    as white dirt when the player moves over the court.
    """
    pix = img.load()
    repainted = 0
    cleared = 0
    fixes: list[tuple[int, int, tuple[int, int, int, int] | None]] = []
    for y in range(img.height):
        for x in range(img.width):
            if not hard_white(pix[x, y]) or not touches_transparency(pix, img.width, img.height, x, y):
                continue
            fixes.append((x, y, nearest_body(pix, img.width, img.height, x, y)))

    for x, y, colour in fixes:
        if colour is None:
            pix[x, y] = (255, 255, 255, 0)
            cleared += 1
        else:
            pix[x, y] = colour
            repainted += 1
    return repainted, cleared


def sanitize_low_alpha_enclosed_matte(img: Image.Image) -> tuple[int, int]:
    """Catch browser-visible matte that Pillow's source-alpha scan misses.

    Canvas decode can expose tiny low-alpha pale pixels as near-white matte.
    Only enclosed lower-body pixels are touched, so the authored outer manga
    keyline and internal uniform highlights are preserved.
    """
    pix = img.load()
    fixes: list[tuple[int, int, tuple[int, int, int, int] | None]] = []
    for y in range(img.height):
        for x in range(img.width):
            if not low_alpha_pale_matte(pix[x, y]):
                continue
            if not touches_transparency(pix, img.width, img.height, x, y):
                continue
            if not enclosed_by_body(pix, img.width, img.height, x, y):
                continue
            fixes.append((x, y, nearest_body(pix, img.width, img.height, x, y)))

    repainted = 0
    cleared = 0
    for x, y, colour in fixes:
        if colour is None:
            pix[x, y] = (255, 255, 255, 0)
            cleared += 1
        else:
            pix[x, y] = colour
            repainted += 1
    return repainted, cleared


def sanitize_browser_matte_candidates(img: Image.Image) -> tuple[int, int]:
    """Repaint tiny pale semi-alpha pixels before Canvas can expose them.

    Browser canvas decoding/premultiplication can turn a source pixel that is
    harmless in Pillow into a near-white matte candidate.  These pixels are
    rare in the current sheets; repainting them to the nearest body colour is
    safer than leaving single-frame white dirt between legs during motion.
    """
    pix = img.load()
    fixes: list[tuple[int, int, tuple[int, int, int, int] | None]] = []
    for y in range(img.height):
        for x in range(img.width):
            if not browser_premultiplied_matte_candidate(pix[x, y]):
                continue
            colour = nearest_body(pix, img.width, img.height, x, y)
            fixes.append((x, y, colour))

    repainted = 0
    cleared = 0
    for x, y, colour in fixes:
        if colour is None:
            pix[x, y] = (255, 255, 255, 0)
            cleared += 1
        else:
            pix[x, y] = colour
            repainted += 1
    return repainted, cleared


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--action', action='append', choices=ACTIONS)
    parser.add_argument('--out', type=Path, default=REPORT)
    args = parser.parse_args()
    report = {}
    for action in args.action or ACTIONS:
        path = ROOT / f"{action}.png"
        before = digest(path)
        img = Image.open(path).convert("RGBA")
        repainted = 0
        cleared = 0
        for oy in range(0, img.height, CELL):
            for ox in range(0, img.width, CELL):
                r, c = sanitize_cell(img, ox, oy)
                repainted += r
                cleared += c
        r, c = sanitize_hard_white_edges(img)
        repainted += r
        cleared += c
        r, c = sanitize_low_alpha_enclosed_matte(img)
        repainted += r
        cleared += c
        r, c = sanitize_browser_matte_candidates(img)
        repainted += r
        cleared += c
        img.save(path)
        after = digest(path)
        report[action] = {
            "before": before,
            "after": after,
            "repainted": repainted,
            "cleared": cleared,
        }
        print(
            f"{action:11} {before} -> {after}  "
            f"repainted {repainted}, cleared {cleared}"
        )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
