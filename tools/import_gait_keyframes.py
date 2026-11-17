#!/usr/bin/env python3
"""Interleave 3 separately DRAWN eight-pose sheets into a 24-frame atlas.

No tweening, limb warping or copied filler frames. Offset 0 contains frames
1,4,...22; offsets 1 and 2 contain their separately illustrated in-betweens.
Writes a candidate by default; the runtime asset is replaced only explicitly.
"""
from __future__ import annotations

import argparse
import hashlib
import math
from collections import deque
from pathlib import Path

from PIL import Image

from import_generated_sprites import chroma_key, fit_source_grid, keep_single_figure, normalize_atlas

# Floor annotations for the run pose guide: support, compression, push, flight.
# The 8-pose key sheet carries frames 1/4/7/10/13/16/19/22. Only registration is
# controlled here; all 24 different leg/arm drawings still come from image_gen.
RUN_FOOT_LIFTS = [0, 0, 0, 0, 0, 0, 0, 8, 17, 25, 17, 8] * 2

# These sheets contain body poses, not a baked jump trajectory. A standing
# serve stays grounded; the simulation lifts jumps and dives at runtime.
REGISTERED_POSE_ACTIONS = {"idle", "shuffle", "backpedal", "approach", "celebrate", "spike", "spikeFollow", "block", "serve", "jumpServe", "jumpServeFollow", "dive", "bump", "set", "backSet", "turn", "runTurn", "turnStop", "runBrake"}


def extract_eight_figures(keyed: Image.Image) -> list[Image.Image]:
    return extract_grid_figures(keyed, 4, 2)


def extract_grid_figures(keyed: Image.Image, cols: int, rows: int) -> list[Image.Image]:
    """Extract complete connected drawings, not imaginary grid rectangles.

    Raised fingertips can cross the empty row divider without touching any
    other figure. Cutting there destroys an otherwise intact drawing. Segment
    the source's actual alpha instead, and reject real canvas-edge clipping.
    This is extraction only: it neither paints nor reconstructs any pixels.
    """
    width, height = keyed.size
    alpha = keyed.getchannel("A").tobytes()
    seen = bytearray(width * height)
    figures: dict[int, tuple[int, Image.Image]] = {}
    for start, value in enumerate(alpha):
        if value <= 8 or seen[start]:
            continue
        seen[start] = 1
        queue = deque([start])
        points = []
        left, top, right, bottom = width, height, 0, 0
        while queue:
            index = queue.popleft()
            points.append(index)
            x, y = index % width, index // width
            left, top = min(left, x), min(top, y)
            right, bottom = max(right, x + 1), max(bottom, y + 1)
            for ny in range(max(0, y - 1), min(height, y + 2)):
                for nx in range(max(0, x - 1), min(width, x + 2)):
                    neighbour = ny * width + nx
                    if not seen[neighbour] and alpha[neighbour] > 8:
                        seen[neighbour] = 1
                        queue.append(neighbour)
        if len(points) < 1500:
            continue
        if left == 0 or top == 0 or right == width or bottom == height:
            raise ValueError("source athlete touches a real outer image edge; redraw required")
        key = min(cols-1, (left+right)*cols//(2*width)) + cols*min(rows-1, (top+bottom)*rows//(2*height))
        if key in figures:
            raise ValueError(f"multiple substantial figures in source cell {key + 1}")
        figure = Image.new("RGBA", (right - left, bottom - top))
        source_pixels, pixels = keyed.load(), figure.load()
        for index in points:
            x, y = index % width, index // width
            pixels[x - left, y - top] = source_pixels[x, y]
        figures[key] = len(points), figure
    if set(figures) != set(range(cols*rows)):
        raise ValueError(f"expected one complete athlete in each of {cols*rows} cells; found {sorted(figures)}")
    return [figures[key][1] for key in range(cols*rows)]


def interleave_attack(sources: list[Path], action: str, overrides: dict[int, tuple[Path, int]] | None = None, override_scale: float = 1.0) -> Image.Image:
    if not math.isfinite(override_scale) or not 0 < override_scale <= 1 or (override_scale != 1 and not overrides):
        raise ValueError("override scale must be in (0, 1] and requires pose overrides")
    drawings = []
    for source in sources:
        with Image.open(source) as raw:
            keyed = chroma_key(fit_source_grid(raw), cols=4, rows=2)
        drawings.append(extract_eight_figures(keyed))
    # Select complete independently authored alternatives before the ONE shared
    # fit. This is packing, never a painted/tweened correction of body parts.
    for frame, (source, pose) in (overrides or {}).items():
        if not 0 <= frame < 24 or not 0 <= pose < 8:
            raise ValueError("pose override requires frame 0..23 and source pose 0..7")
        with Image.open(source) as raw:
            alternatives = extract_eight_figures(chroma_key(fit_source_grid(raw), cols=4, rows=2))
        figure = alternatives[pose]
        if override_scale != 1:
            figure = figure.resize(tuple(max(1, round(d * override_scale)) for d in figure.size), Image.Resampling.LANCZOS)
        drawings[frame % 3][frame // 3] = figure
    # One shared fit for ALL 24 drawings, never per-pose bounding-box scaling.
    scale = min(1.0, 490 / max(max(p.size) for group in drawings for p in group))
    atlas = Image.new("RGBA", (3072, 2048))
    for offset, group in enumerate(drawings):
        for key, figure in enumerate(group):
            if scale < 1:
                figure = figure.resize(tuple(round(d * scale) for d in figure.size), Image.Resampling.LANCZOS)
            frame = key * 3 + offset
            # This drawn in-between overshot the following key's left palm.
            # Swap their order so the actual tossing hand rises monotonically;
            # both complete original drawings are preserved, with no warping.
            if action == "serve" and frame in (5, 6):
                frame = 11 - frame
            # The two victory chest-height drawings arrived in reverse hand
            # elevation order. Keep both, ordered waist -> sternum -> chin.
            if action == "celebrate" and frame in (4, 5):
                frame = 9 - frame
            # Reviewed contact sheets: order complete drawings by the actual
            # hand extension, not by their generator-assigned source cells.
            # Preserve each of the 24 illustrations exactly once.
            if action == "set":
                frame = {3: 4, 4: 3, 12: 10, 10: 11, 13: 12, 11: 13}.get(frame, frame)
            if action == "bump" and frame in (5, 6):
                frame = 11 - frame
            atlas.alpha_composite(figure, (frame % 6 * 512 + (512 - figure.width) // 2,
                                           frame // 6 * 512 + 506 - figure.height))
    return normalize_atlas(atlas, action, [0] * 24)


def extract_run_figure(keyed: Image.Image, key: int) -> Image.Image:
    """Recover the WHOLE drawing if its shoe crosses a virtual cell divider.

    There are no drawn divider lines in the source. Cutting exactly at 384px
    sliced a shoe and imported the exposed white interior as an edge. Use the
    existing 64px gutters as extraction overlap, then retain the one connected
    athlete. No pixels are invented and no part of the body is reshaped.
    """
    x, y = key % 4 * 384, key // 4 * 512
    cell = keep_single_figure(keyed.crop((x - 64, y, x + 448, y + 512)))
    box = cell.getchannel('A').getbbox()
    if box is None:
        raise ValueError(f'source figure {key + 1} is empty')
    # Unlike internal cell dividers, a cut at the real image edge cannot be
    # recovered by wider extraction. Require a source redraw in that case.
    if (key % 4 == 0 and box[0] <= 64) or (key % 4 == 3 and box[2] >= 448) or box[1] == 0 or box[3] == 512:
        raise ValueError(f'source figure {key + 1} touches an outer image/row edge')
    return cell


def interleave(sources: list[Path], action: str, overrides: dict[int, tuple[Path, int]] | None = None, override_scale: float = 1.0) -> Image.Image:
    if len(sources) != 3:
        raise ValueError("expected exactly three independently drawn eight-pose sheets")
    if action in REGISTERED_POSE_ACTIONS:
        return interleave_attack(sources, action, overrides, override_scale)
    if overrides:
        raise ValueError("pose overrides require registered eight-pose artwork")
    atlas = Image.new("RGBA", (3072, 2048), (0, 0, 0, 0))
    for offset, source in enumerate(sources):
        with Image.open(source) as raw:
            rgb = fit_source_grid(raw)
        keyed = chroma_key(rgb, cols=4, rows=2)
        for key in range(8):
            # Legacy walk stays byte-for-byte reproducible. Wider running
            # stances may cross a virtual source divider, so recover the full
            # connected drawing within the 512px cell instead of clipping it.
            wide = action == 'run'
            cell = extract_run_figure(keyed, key) if wide else keyed.crop(
                ((key % 4) * 384, (key // 4) * 512,
                 (key % 4 + 1) * 384, (key // 4 + 1) * 512))
            frame = key * 3 + offset
            atlas.alpha_composite(cell, ((frame % 6) * 512 + (0 if wide else 64), (frame // 6) * 512))
    if action == 'run':
        return normalize_atlas(atlas, action, RUN_FOOT_LIFTS)
    return normalize_atlas(atlas, action)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keys", type=Path, required=True)
    parser.add_argument("--between-1", type=Path, required=True)
    parser.add_argument("--between-2", type=Path, required=True)
    parser.add_argument("--action", choices=["walk", "run", *sorted(REGISTERED_POSE_ACTIONS)], default="walk")
    parser.add_argument("--shared-prefix", type=Path, help="For turnStop only: preserve the common first twelve runTurn drawings")
    parser.add_argument("--pose-override", action="append", default=[], metavar="FRAME=PATH#POSE",
                        help="Select a complete pose from another eight-pose source before uniform packing (zero-based)")
    parser.add_argument("--preserve-unselected-from", type=Path,
                        help="Keep every non-overridden runtime cell pixel-identical to this atlas")
    parser.add_argument("--override-scale", type=float, default=1.0,
                        help="One uniform source-resolution fit for all replacement drawings; no per-pose scaling")
    parser.add_argument("--out", type=Path, default=Path("artifacts/gait-key-direction/walk-candidate.png"))
    args = parser.parse_args()
    sources = [args.keys, args.between_1, args.between_2]
    if len({p.resolve() for p in sources}) != 3:
        parser.error("all three sources must be distinct, separately drawn sheets")
    if len({hashlib.sha256(p.read_bytes()).digest() for p in sources}) != 3:
        parser.error("duplicated source content cannot provide in-betweens")
    overrides = {}
    for spec in args.pose_override:
        try:
            frame, rest = spec.split("=", 1)
            path, pose = rest.rsplit("#", 1)
            frame, pose = int(frame), int(pose)
            if not 0 <= frame < 24 or not 0 <= pose < 8 or frame in overrides:
                raise ValueError("invalid or repeated override")
            overrides[frame] = (Path(path), pose)
        except ValueError:
            parser.error("use unique FRAME=PATH#POSE with frame 0..23 and pose 0..7")
    if args.preserve_unselected_from and (not overrides or args.action == "turnStop"):
        parser.error("--preserve-unselected-from requires pose overrides and cannot be combined with turnStop")
    if not math.isfinite(args.override_scale) or not 0 < args.override_scale <= 1 or (args.override_scale != 1 and not overrides):
        parser.error("--override-scale must be in (0, 1] and requires pose overrides")
    atlas = interleave(sources, args.action, overrides, args.override_scale)
    if args.preserve_unselected_from:
        with Image.open(args.preserve_unselected_from) as base:
            atlas = preserve_unselected(base, atlas, set(overrides))
    if args.action == "turnStop":
        if args.shared_prefix is None:
            parser.error("turnStop requires --shared-prefix with the runTurn runtime atlas")
        with Image.open(args.shared_prefix) as base:
            from import_single_pose_redraws import replace_cells
            # This is a branching action, not repeated filler: both outcomes
            # share the same first twelve poses, then twelve distinct endings.
            atlas = replace_cells(base, {i: atlas.crop((i % 6 * 512, i // 6 * 512,
                                                       (i % 6 + 1) * 512, (i // 6 + 1) * 512)) for i in range(12, 24)})
    elif args.shared_prefix is not None:
        parser.error("--shared-prefix is only supported for turnStop")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(args.out, optimize=True)
    print(f"{args.out}: {hashlib.sha256(args.out.read_bytes()).hexdigest()}")


def preserve_unselected(base: Image.Image, candidate: Image.Image, frames: set[int]) -> Image.Image:
    """A taller redraw must not silently rescale the already accepted cells.

    New drawings retain their shared packing scale. No body part is warped;
    untouched cells, including contact anchors, are copied byte for byte.
    """
    from import_single_pose_redraws import replace_cells
    if candidate.size != (3072, 2048) or candidate.mode != 'RGBA':
        raise ValueError('candidate must be a 3072x2048 RGBA atlas')
    return replace_cells(base, {i: candidate.crop((i % 6 * 512, i // 6 * 512,
                                                  (i % 6 + 1) * 512, (i // 6 + 1) * 512)) for i in frames})


if __name__ == "__main__":
    main()
