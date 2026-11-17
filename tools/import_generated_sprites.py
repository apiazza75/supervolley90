#!/usr/bin/env python3
"""Import ImageGen sprite sheets into the strict Super Volley 90 atlas format.

Image generators reliably preserve a 6x4 storyboard, but they do not reliably
write an alpha channel.  The accepted source convention is therefore a flat
magenta background.  This importer removes that background with a soft chroma
key, decontaminates anti-aliased edge pixels, and writes the exact 3072x2048
RGBA atlas consumed by ``src/render/sprites.ts``.

Usage::

    python3 tools/import_generated_sprites.py \
      --sheet spike=/path/to/spike.png \
      --sheet block=/path/to/block.png

Only explicitly supplied actions are replaced.  The original generated files
are never modified.
"""

from __future__ import annotations

import argparse
import hashlib
import math
from collections import deque
from pathlib import Path

from PIL import Image


ACTIONS = {
    "idle",
    "walk",
    "shuffle",
    "backpedal",
    "run",
    "approach",
    "spike",
    "spikeFollow",
    "block",
    "bump",
    "set",
    "backSet",
    "turn",
    "runTurn",
    "turnStop",
    "runBrake",
    "dive",
    "serve",
    "jumpServe",
    "jumpServeFollow",
    "celebrate",
}
COLS = 6
ROWS = 4
SOURCE_WIDTH = 1536
SOURCE_HEIGHT = 1024
TARGET_WIDTH = 3072
TARGET_HEIGHT = 2048
CELL = 512
SAFE_SPAN = 456
GROUND_LINE = 470

# Legacy 6x4 imports use per-cell grounded registration for these actions.
# The new run's 3x8 drawn sources supply explicit foot_lifts and override this
# default: running has a brief flight phase even without a gameplay jump.
FULLY_GROUNDED = {
    "idle",
    "walk",
    "shuffle",
    "backpedal",
    "run",
    "approach",
    "bump",
    "set",
    "backSet",
    "turn",
    "runTurn",
    "turnStop",
    "runBrake",
    "serve",
    "celebrate",
}


def parse_sheet(value: str) -> tuple[str, Path]:
    if "=" not in value:
        raise argparse.ArgumentTypeError("expected ACTION=/path/to/image.png")
    action, raw_path = value.split("=", 1)
    if action not in ACTIONS:
        raise argparse.ArgumentTypeError(f"unknown action {action!r}")
    path = Path(raw_path).expanduser()
    if not path.is_file():
        raise argparse.ArgumentTypeError(f"missing source image: {path}")
    return action, path


def fit_source_grid(image: Image.Image) -> Image.Image:
    """Normalize ImageGen's occasional 1535px result without distorting cells."""

    # Preserve a genuinely supplied alpha channel. Some generators instead
    # paint a checkerboard into an opaque RGB image; that is NOT transparency
    # and deliberately still fails the magenta-source check below.
    rgba = image.convert("RGBA")
    rgb = rgba if rgba.getchannel("A").getextrema()[0] < 255 else rgba.convert("RGB")
    if rgb.height != SOURCE_HEIGHT or rgb.width not in {SOURCE_WIDTH - 1, SOURCE_WIDTH}:
        raise ValueError(
            f"expected {SOURCE_WIDTH}x{SOURCE_HEIGHT} ImageGen sheet "
            f"(1535px width is tolerated); got {rgb.width}x{rgb.height}"
        )
    if rgb.width == SOURCE_WIDTH:
        return rgb
    # Extend the final background column rather than stretching all 24 poses.
    out = Image.new(rgb.mode, (SOURCE_WIDTH, SOURCE_HEIGHT))
    out.paste(rgb, (0, 0))
    out.paste(rgb.crop((rgb.width - 1, 0, rgb.width, rgb.height)), (rgb.width, 0))
    return out


def magenta_score(r: int, g: int, b: int) -> float:
    """Return a high value for the pink/magenta background family."""

    return min(r, b) - g - abs(r - b) * 0.45


def cell_backgrounds(image: Image.Image, cols: int = COLS, rows: int = ROWS) -> list[tuple[int, int, int]]:
    """Measure the generated background per cell for edge decontamination."""

    pix = image.load()
    cell_w = image.width // cols
    cell_h = image.height // rows
    colours: list[tuple[int, int, int]] = []
    for row in range(rows):
        for col in range(cols):
            samples: list[tuple[int, int, int]] = []
            x0 = col * cell_w
            y0 = row * cell_h
            # Sparse samples cover the slight ImageGen vignette while excluding
            # the player. More than 80% of every accepted source is background.
            for y in range(y0 + 2, y0 + cell_h - 2, 8):
                for x in range(x0 + 2, x0 + cell_w - 2, 8):
                    colour = pix[x, y]
                    if magenta_score(*colour) > 130:
                        samples.append(colour)
            if not samples:
                raise ValueError(f"cell {row * cols + col + 1} has no magenta key background")
            samples.sort(key=lambda c: c[0] + c[1] + c[2])
            colours.append(samples[len(samples) // 2])
    return colours


def chroma_key(image: Image.Image, cols: int = COLS, rows: int = ROWS) -> Image.Image:
    """Convert the generated magenta field into genuine, clean alpha."""

    if image.mode == "RGBA" and image.getchannel("A").getextrema()[0] < 255:
        return image.copy()
    backgrounds = cell_backgrounds(image, cols, rows)
    src = image.load()
    out = Image.new("RGBA", image.size, (0, 0, 0, 0))
    dst = out.load()
    cell_w = image.width // cols
    cell_h = image.height // rows

    # Background scores are around 175..240; authored pixels are normally
    # below 20.  The soft interval preserves ink anti-aliasing without leaving
    # a coloured halo.
    opaque_score = 54.0
    transparent_score = 150.0
    for y in range(image.height):
        row = min(rows - 1, y // cell_h)
        for x in range(image.width):
            col = min(cols - 1, x // cell_w)
            r, g, b = src[x, y]
            score = magenta_score(r, g, b)
            if score >= transparent_score:
                continue
            if score <= opaque_score:
                dst[x, y] = (r, g, b, 255)
                continue

            alpha = (transparent_score - score) / (transparent_score - opaque_score)
            alpha = max(0.0, min(1.0, alpha))
            br, bg, bb = backgrounds[row * cols + col]
            # Undo the magenta mixed into the generator's anti-aliased edge.
            rr = round((r - (1.0 - alpha) * br) / max(alpha, 1e-6))
            gg = round((g - (1.0 - alpha) * bg) / max(alpha, 1e-6))
            bb2 = round((b - (1.0 - alpha) * bb) / max(alpha, 1e-6))
            dst[x, y] = (
                max(0, min(255, rr)),
                max(0, min(255, gg)),
                max(0, min(255, bb2)),
                round(alpha * 255),
            )
    return out


def keep_single_figure(cell: Image.Image) -> Image.Image:
    """Remove detached generator debris while preserving one authored body."""

    alpha = cell.getchannel("A")
    pix = alpha.load()
    seen = bytearray(CELL * CELL)
    components: list[list[int]] = []
    for y in range(CELL):
        for x in range(CELL):
            start = y * CELL + x
            if seen[start] or pix[x, y] <= 8:
                continue
            seen[start] = 1
            q: deque[int] = deque([start])
            component: list[int] = []
            while q:
                index = q.popleft()
                component.append(index)
                px = index % CELL
                py = index // CELL
                for ny in range(max(0, py - 1), min(CELL, py + 2)):
                    for nx in range(max(0, px - 1), min(CELL, px + 2)):
                        neighbour = ny * CELL + nx
                        if seen[neighbour] or pix[nx, ny] <= 8:
                            continue
                        seen[neighbour] = 1
                        q.append(neighbour)
            components.append(component)
    if not components:
        raise ValueError("generated cell contains no player pixels")
    keep = max(components, key=len)
    if len(keep) < 1500:
        raise ValueError(f"largest generated cell component is too small: {len(keep)} pixels")
    mask = bytearray(CELL * CELL)
    for index in keep:
        mask[index] = 1
    out = cell.copy()
    data = out.load()
    for y in range(CELL):
        for x in range(CELL):
            if not mask[y * CELL + x]:
                data[x, y] = (0, 0, 0, 0)
    return out


def kit_root_x(cell: Image.Image, box: tuple[int, int, int, int]) -> float:
    """Estimate the body's root from the stable blue uniform, not its limbs.

    Bounding-box centres swing towards an extended arm or leg.  The blue
    shirt/shorts stay around the pelvis in every pose, so their median x is a
    much more stable registration point for a generated storyboard.
    """

    pixels = cell.load()
    xs: list[int] = []
    left, top, right, bottom = box
    for y in range(top, bottom):
        for x in range(left, right):
            r, g, b, a = pixels[x, y]
            if a <= 32:
                continue
            if b >= 55 and b >= r + 18 and b >= g + 12:
                xs.append(x)
    if len(xs) < 64:
        return (left + right) / 2
    xs.sort()
    return float(xs[len(xs) // 2])


def normalize_atlas(image: Image.Image, action: str, foot_lifts: list[float] | None = None) -> Image.Image:
    """Register every pose on one body root and one safe 470px baseline.

    Image generators compose each storyboard cell independently.  Even when
    the anatomy is correct, the pelvis can wander by more than one hundred
    pixels and the feet by dozens.  Drawing those cells at a fixed canvas
    origin turns that layout noise into teleporting and floor bounce.  This
    pass removes the layout noise while preserving authored jump height.
    """

    if foot_lifts is not None and (
        len(foot_lifts) != COLS * ROWS
        or any(not math.isfinite(n) or n < 0 or n > 120 for n in foot_lifts)
    ):
        raise ValueError("foot_lifts must contain 24 finite, non-negative source-pixel offsets <= 120")

    cells: list[Image.Image] = []
    boxes: list[tuple[int, int, int, int]] = []
    for frame in range(COLS * ROWS):
        x = (frame % COLS) * CELL
        y = (frame // COLS) * CELL
        cell = keep_single_figure(image.crop((x, y, x + CELL, y + CELL)))
        box = cell.getchannel("A").getbbox()
        if box is None:
            raise ValueError(f"generated frame {frame + 1} is empty after cleanup")
        cells.append(cell)
        boxes.append(box)

    roots_x = [kit_root_x(cell, box) for cell, box in zip(cells, boxes)]
    bottoms = [box[3] - 1 for box in boxes]
    sorted_bottoms = sorted(bottoms)
    authored_ground = sorted_bottoms[
        min(len(sorted_bottoms) - 1, int(len(sorted_bottoms) * 0.9))
    ]
    # Registration metadata places an already drawn pose relative to its floor.
    # It never stretches a limb or fabricates a missing in-between drawing.
    source_grounds = [
        bottom + foot_lifts[i] if foot_lifts is not None
        else bottom if action in FULLY_GROUNDED else authored_ground
        for i, bottom in enumerate(bottoms)
    ]

    # Scale around the authored ground line, not around the cell centre.  This
    # guarantees that a high spike/block frame cannot force grounded frames
    # below the cell (the previous implementation did exactly that).
    max_width = max(box[2] - box[0] for box in boxes)
    scale = min(1.0, SAFE_SPAN / max_width)
    for box, source_ground in zip(boxes, source_grounds):
        above = max(1, source_ground - box[1])
        below = max(0, box[3] - 1 - source_ground)
        scale = min(scale, (GROUND_LINE - 10) / above)
        if below:
            scale = min(scale, (CELL - 10 - GROUND_LINE) / below)
    scale = max(0.1, min(1.0, scale))

    atlas = Image.new("RGBA", (TARGET_WIDTH, TARGET_HEIGHT), (0, 0, 0, 0))
    for frame, (cell, box, root_x, source_ground) in enumerate(
        zip(cells, boxes, roots_x, source_grounds)
    ):
        size = max(1, round(CELL * scale))
        scaled = cell.resize((size, size), Image.Resampling.LANCZOS)
        x_offset = round(CELL / 2 - root_x * scale)
        y_offset = round(GROUND_LINE - source_ground * scale)
        shifted = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        shifted.alpha_composite(scaled, (x_offset, y_offset))
        final_box = shifted.getchannel("A").getbbox()
        if final_box is None:
            raise ValueError(f"generated frame {frame + 1} vanished during registration")
        if final_box[0] < 6 or final_box[1] < 6 or final_box[2] > CELL - 6 or final_box[3] > CELL - 6:
            raise ValueError(
                f"generated frame {frame + 1} violates safe cell margin after registration: {final_box}"
            )
        atlas.alpha_composite(shifted, ((frame % COLS) * CELL, (frame // COLS) * CELL))
    return atlas


def import_sheet(action: str, source: Path, destination: Path, frames: list[int] | None = None) -> tuple[str, str]:
    before = hashlib.sha256(destination.read_bytes()).hexdigest()[:16] if destination.exists() else "missing"
    source_grid = fit_source_grid(Image.open(source))
    # Resize while the image still has its generated background. Chroma-keying
    # afterwards removes the resampling blend instead of baking a pink fringe.
    large = source_grid.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS)
    keyed = normalize_atlas(chroma_key(large), action)
    if frames is not None:
        # A targeted redraw must not silently replace the other 23 drawings.
        # Both sheets already use the exact same cell/root/ground contract.
        with Image.open(destination) as existing:
            if existing.size != (TARGET_WIDTH, TARGET_HEIGHT) or existing.mode != "RGBA":
                raise ValueError("partial import requires an existing strict RGBA atlas")
            merged = existing.copy()
        for frame in frames:
            x, y = (frame % COLS) * CELL, (frame // COLS) * CELL
            rectangle = (x, y, x + CELL, y + CELL)
            merged.paste(keyed.crop(rectangle), rectangle)
        keyed = merged
    destination.parent.mkdir(parents=True, exist_ok=True)
    keyed.save(destination, format="PNG", optimize=True)
    after = hashlib.sha256(destination.read_bytes()).hexdigest()[:16]
    return before, after


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--sheet",
        action="append",
        type=parse_sheet,
        required=True,
        metavar="ACTION=PNG",
        help="generated 6x4 sheet to import (repeat for multiple actions)",
    )
    parser.add_argument("--out", type=Path, default=Path("public/sprites"))
    parser.add_argument("--frame", type=int, action="append", choices=range(1, 25),
                        help="replace only this one-based frame; repeat if needed")
    args = parser.parse_args()
    if args.frame and len(args.sheet) != 1:
        parser.error("--frame requires exactly one --sheet")

    seen: set[str] = set()
    for action, source in args.sheet:
        if action in seen:
            raise SystemExit(f"duplicate --sheet action: {action}")
        seen.add(action)
        destination = args.out / f"{action}.png"
        before, after = import_sheet(action, source, destination,
                                    [f - 1 for f in args.frame] if args.frame else None)
        print(f"{action:11} {before} -> {after}  {destination}")


if __name__ == "__main__":
    main()
