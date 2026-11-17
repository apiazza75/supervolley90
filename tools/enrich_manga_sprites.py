#!/usr/bin/env python3
"""Add missing in-between frames to the authored manga sprite sheets.

This deliberately does not redraw the players from a procedural rig.  It keeps
the existing manga art as source material and edits only selected cells where
the sheet has held/duplicate poses.  The goal is to remove visual stutter while
preserving the approved silhouette, palette, face/hair detail and outlines.

It also builds the locomotion sheets that were missing from the first manga
pass.  `approach.png` is an attack run-up; using it for every small positional
adjustment made players look like they were sprinting all the time.  `walk.png`
and `run.png` are derived from the authored approach frames, with separate
timing, body lean and footfall cadence, so the renderer can choose a real
walking cycle, a normal run or the committed attack approach.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


CELL = 512
ROOT = Path("public/sprites")
OUT = Path("artifacts/sprite-enrich-manga.json")


@dataclass(frozen=True)
class Transform:
    scale_x: float = 1.0
    scale_y: float = 1.0
    shift_x: float = 0.0
    shift_y: float = 0.0
    shear_x: float = 0.0
    alpha: float = 1.0
    shadow: float = 0.0


@dataclass(frozen=True)
class SplitTransform:
    """Whole-drawing edit plus an independent lower-body stride edit.

    The source material is still the manga cell.  The extra split is needed for
    walk frames: scaling the entire sprint pose down made a smaller sprint, not
    a walk.  Compressing the leg band separately keeps the torso/face/shirt
    detail intact while giving positional movement a short, grounded step.
    """

    upper_scale_x: float = 1.0
    upper_scale_y: float = 1.0
    lower_scale_x: float = 1.0
    lower_scale_y: float = 1.0
    upper_shift_x: float = 0.0
    lower_shift_x: float = 0.0
    shift_y: float = 0.0
    shear_x: float = 0.0
    shadow: float = 0.0


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()[:16]


def frame_box(cell: Image.Image) -> tuple[int, int, int, int] | None:
    alpha = cell.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > 24 else 0).getbbox()
    if not bbox:
        return None
    left, top, right, bottom = bbox
    pad = 10
    return (
        max(0, left - pad),
        max(0, top - pad),
        min(CELL, right + pad),
        min(CELL, bottom + pad),
    )


def frame_digest(cell: Image.Image) -> str:
    # Alpha-composite on transparent black first, so equivalent transparent RGB
    # noise does not make a frame look unique.
    clean = Image.new("RGBA", cell.size, (0, 0, 0, 0))
    clean.alpha_composite(cell)
    return hashlib.sha256(clean.tobytes()).hexdigest()


def distinct_frames(sheet: Image.Image) -> int:
    return len({frame_digest(get_cell(sheet, frame)) for frame in range(24)})


def transformed_subject(cell: Image.Image, tr: Transform) -> Image.Image:
    bbox = frame_box(cell)
    if bbox is None:
        return cell

    subject = cell.crop(bbox)
    sw, sh = subject.size
    nw = max(1, int(round(sw * tr.scale_x)))
    nh = max(1, int(round(sh * tr.scale_y)))
    subject = subject.resize((nw, nh), Image.Resampling.BICUBIC)

    if abs(tr.shear_x) > 0.001:
        extra = int(abs(tr.shear_x) * nh) + 4
        sheared = Image.new("RGBA", (nw + extra * 2, nh), (0, 0, 0, 0))
        matrix = (1, tr.shear_x, extra if tr.shear_x < 0 else 0, 0, 1, 0)
        subject = subject.transform(sheared.size, Image.Transform.AFFINE, matrix, Image.Resampling.BICUBIC)

    if tr.alpha < 0.999:
        r, g, b, a = subject.split()
        a = a.point(lambda v: int(v * tr.alpha))
        subject = Image.merge("RGBA", (r, g, b, a))

    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))

    if tr.shadow:
        shadow_w = max(18, int((bbox[2] - bbox[0]) * (0.28 + tr.shadow * 0.16)))
        shadow_h = max(5, int(shadow_w * 0.18))
        shadow = Image.new("RGBA", (shadow_w, shadow_h), (0, 0, 0, int(42 * tr.shadow)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, int(shadow_h * 0.45))))
        sx = int((bbox[0] + bbox[2]) * 0.5 - shadow_w * 0.5 + tr.shift_x * 0.25)
        sy = min(CELL - shadow_h - 8, max(0, bbox[3] - shadow_h + 3))
        out.alpha_composite(shadow, (sx, sy))

    left = int(round((bbox[0] + bbox[2]) * 0.5 - subject.width * 0.5 + tr.shift_x))
    # Keep the feet/baseline stable unless a jump/action frame intentionally
    # asks for a vertical shift.  This prevents the character from skating.
    top = int(round(bbox[3] - subject.height + tr.shift_y))
    out.alpha_composite(subject, (left, top))
    return out


def split_transformed_subject(cell: Image.Image, tr: SplitTransform) -> Image.Image:
    bbox = frame_box(cell)
    if bbox is None:
        return cell

    subject = cell.crop(bbox)
    sw, sh = subject.size
    # Slight overlap hides the cut through shorts/hips and keeps the manga
    # outline continuous after the independent lower-body stride edit.
    split_y = max(1, min(sh - 2, int(sh * 0.53)))
    overlap = max(6, int(sh * 0.035))
    upper = subject.crop((0, 0, sw, min(sh, split_y + overlap)))
    lower = subject.crop((0, max(0, split_y - overlap), sw, sh))

    def resize_part(part: Image.Image, sx: float, sy: float) -> Image.Image:
        w = max(1, int(round(part.width * sx)))
        h = max(1, int(round(part.height * sy)))
        return part.resize((w, h), Image.Resampling.BICUBIC)

    upper = resize_part(upper, tr.upper_scale_x, tr.upper_scale_y)
    lower = resize_part(lower, tr.lower_scale_x, tr.lower_scale_y)

    if abs(tr.shear_x) > 0.001:
        extra = int(abs(tr.shear_x) * upper.height) + 4
        matrix = (1, tr.shear_x, extra if tr.shear_x < 0 else 0, 0, 1, 0)
        upper = upper.transform((upper.width + extra * 2, upper.height), Image.Transform.AFFINE, matrix, Image.Resampling.BICUBIC)

    composed_w = max(upper.width, lower.width) + 36
    composed_h = max(sh, upper.height + lower.height - overlap * 2)
    composed = Image.new("RGBA", (composed_w, composed_h), (0, 0, 0, 0))
    center = composed_w * 0.5
    upper_x = int(round(center - upper.width * 0.5 + tr.upper_shift_x))
    lower_x = int(round(center - lower.width * 0.5 + tr.lower_shift_x))
    lower_y = max(0, composed_h - lower.height)
    upper_y = max(0, lower_y + overlap - upper.height)
    composed.alpha_composite(lower, (lower_x, lower_y))
    composed.alpha_composite(upper, (upper_x, upper_y))

    out = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    if tr.shadow:
        shadow_w = max(18, int((bbox[2] - bbox[0]) * (0.24 + tr.shadow * 0.14)))
        shadow_h = max(5, int(shadow_w * 0.18))
        shadow = Image.new("RGBA", (shadow_w, shadow_h), (0, 0, 0, int(46 * tr.shadow)))
        shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, int(shadow_h * 0.45))))
        sx = int((bbox[0] + bbox[2]) * 0.5 - shadow_w * 0.5 + tr.lower_shift_x * 0.2)
        sy = min(CELL - shadow_h - 8, max(0, bbox[3] - shadow_h + 3))
        out.alpha_composite(shadow, (sx, sy))

    left = int(round((bbox[0] + bbox[2]) * 0.5 - composed.width * 0.5))
    top = int(round(bbox[3] - composed.height + tr.shift_y))
    out.alpha_composite(composed, (left, top))
    return out


def blend_with_neighbour(current: Image.Image, neighbour: Image.Image, amount: float) -> Image.Image:
    """Add a very light line/detail pass from an adjacent manga frame.

    The weight is intentionally low. It gives held poses different hair/outline
    and limb anti-aliasing without creating the double-body cross-fade that made
    the runtime animation look wrong.
    """
    detail = ImageChops.subtract(neighbour, current, scale=2.4, offset=96)
    r, g, b, a = detail.split()
    a = a.point(lambda v: int(max(0, v - 96) * amount))
    detail = Image.merge("RGBA", (r, g, b, a)).filter(ImageFilter.GaussianBlur(0.25))
    return Image.alpha_composite(current, detail)


def get_cell(sheet: Image.Image, frame: int) -> Image.Image:
    col = frame % 6
    row = frame // 6
    return sheet.crop((col * CELL, row * CELL, (col + 1) * CELL, (row + 1) * CELL))


def put_cell(sheet: Image.Image, frame: int, cell: Image.Image) -> None:
    col = frame % 6
    row = frame // 6
    sheet.paste(cell, (col * CELL, row * CELL), cell)


def enrich_idle(sheet: Image.Image) -> list[int]:
    changed: list[int] = []
    # A subtle breathing cycle fixes the repeated idle holds without changing
    # the authored standing pose.
    for frame in range(24):
        phase = math.sin((frame / 24) * math.tau)
        lift = math.sin(((frame + 6) / 24) * math.tau)
        tr = Transform(
            scale_x=1.0 + phase * 0.004,
            scale_y=1.0 + lift * 0.007,
            shift_x=phase * 0.9,
            shift_y=-max(0.0, lift) * 1.8,
            shear_x=phase * 0.003,
            shadow=0.35 + max(0.0, -lift) * 0.2,
        )
        cell = transformed_subject(get_cell(sheet, frame), tr)
        if frame > 0:
            cell = blend_with_neighbour(cell, get_cell(sheet, frame - 1), 0.025)
        put_cell(sheet, frame, cell)
        changed.append(frame)
    return changed


def enrich_selected(sheet: Image.Image, edits: dict[int, Transform]) -> list[int]:
    changed: list[int] = []
    for frame, tr in edits.items():
        cell = transformed_subject(get_cell(sheet, frame), tr)
        if frame > 0:
            cell = blend_with_neighbour(cell, get_cell(sheet, frame - 1), 0.018)
        if frame < 23:
            cell = blend_with_neighbour(cell, get_cell(sheet, frame + 1), 0.018)
        put_cell(sheet, frame, cell)
        changed.append(frame)
    return changed


PLANS: dict[str, dict[int, Transform]] = {
    # Palleggio: the old sheet held several arm-extension frames.  Keep the
    # manga pose, but give the contact/recovery a small body rise and return.
    "set": {
        8: Transform(scale_x=0.998, scale_y=1.006, shift_x=-1.0, shift_y=-2.0, shear_x=-0.004, shadow=0.28),
        9: Transform(scale_x=0.990, scale_y=1.018, shift_x=-2.8, shift_y=-5.8, shear_x=-0.012, shadow=0.18),
        11: Transform(scale_x=1.002, scale_y=1.005, shift_x=0.8, shift_y=-1.6, shear_x=0.004, shadow=0.30),
        12: Transform(scale_x=1.004, scale_y=0.998, shift_x=1.2, shift_y=1.4, shear_x=0.005, shadow=0.42),
        13: Transform(scale_x=1.002, scale_y=0.996, shift_x=0.8, shift_y=2.0, shear_x=0.003, shadow=0.48),
    },
    # Muro: add an apex/landing separation to the held frames.
    "block": {
        16: Transform(scale_x=0.997, scale_y=1.008, shift_x=-0.8, shift_y=-3.0, shear_x=-0.004, shadow=0.18),
        18: Transform(scale_x=1.004, scale_y=0.996, shift_x=0.7, shift_y=2.6, shear_x=0.004, shadow=0.52),
    },
    # Battuta in salto: break the identical toss/contact hold.
    "jumpServe": {
        12: Transform(scale_x=0.998, scale_y=1.008, shift_x=1.0, shift_y=-2.4, shear_x=0.005, shadow=0.20),
    },
}


def enrich_cycle(sheet: Image.Image, action: str) -> list[int]:
    """Give every frame a small authored-in-between pass.

    The imported manga sheets are good drawings, but many adjacent cells still
    read as held poses at gameplay size.  This pass keeps the cell art and
    changes only timing accents: crouch, recoil, airborne hang, follow-through
    and landing shadow.  It is intentionally mild enough not to replace the
    user's manga style with a procedural rig.
    """

    changed: list[int] = []
    for frame in range(24):
        phase = (frame / 24) * math.tau
        tr = Transform()
        weight = 0.016

        if action == "serve":
            load = math.sin(phase)
            contact = max(0.0, math.sin(phase - math.pi * 0.25))
            tr = Transform(
                scale_x=1.0 + load * 0.004,
                scale_y=1.0 + contact * 0.010,
                shift_x=math.sin(phase * 1.5) * 1.0,
                shift_y=-contact * 2.4 + max(0.0, -load) * 1.1,
                shear_x=math.sin(phase) * 0.004,
                shadow=0.34 + max(0.0, -load) * 0.14,
            )
            weight = 0.018
        elif action == "jumpServe":
            rise = max(0.0, math.sin(phase - 0.15))
            landing = max(0.0, -math.sin(phase - 0.15))
            tr = Transform(
                scale_x=1.0 + math.cos(phase) * 0.006,
                scale_y=1.0 + rise * 0.014 - landing * 0.004,
                shift_x=math.sin(phase) * 1.6,
                shift_y=-rise * 5.2 + landing * 1.5,
                shear_x=math.sin(phase) * 0.008,
                shadow=0.18 + landing * 0.34,
            )
            weight = 0.020
        elif action == "spike":
            hang = max(0.0, math.sin(phase - math.pi * 0.1))
            recoil = max(0.0, -math.sin(phase - math.pi * 0.1))
            tr = Transform(
                scale_x=1.0 + math.cos(phase * 1.3) * 0.005,
                scale_y=1.0 + hang * 0.012 - recoil * 0.003,
                shift_x=math.sin(phase) * 1.5,
                shift_y=-hang * 4.6 + recoil * 1.4,
                shear_x=math.sin(phase) * 0.007,
                shadow=0.18 + recoil * 0.36,
            )
            weight = 0.020
        elif action == "block":
            jump = max(0.0, math.sin(phase))
            land = max(0.0, -math.sin(phase))
            tr = Transform(
                scale_x=1.0 + math.cos(phase) * 0.004,
                scale_y=1.0 + jump * 0.010 - land * 0.003,
                shift_x=math.sin(phase * 2) * 0.8,
                shift_y=-jump * 3.4 + land * 1.2,
                shear_x=math.sin(phase) * 0.003,
                shadow=0.18 + land * 0.34,
            )
        elif action == "bump":
            crouch = max(0.0, -math.sin(phase))
            extend = max(0.0, math.sin(phase))
            tr = Transform(
                scale_x=1.0 + crouch * 0.010,
                scale_y=1.0 - crouch * 0.008 + extend * 0.004,
                shift_x=math.sin(phase) * 1.2,
                shift_y=crouch * 2.2 - extend * 1.0,
                shear_x=-0.004 + math.sin(phase) * 0.006,
                shadow=0.38 + crouch * 0.18,
            )
        elif action == "set":
            lift = max(0.0, math.sin(phase))
            settle = max(0.0, -math.sin(phase))
            tr = Transform(
                scale_x=1.0 + settle * 0.005,
                scale_y=1.0 + lift * 0.009 - settle * 0.003,
                shift_x=math.sin(phase) * 0.9,
                shift_y=-lift * 2.6 + settle * 1.0,
                shear_x=math.sin(phase) * 0.004,
                shadow=0.30 + settle * 0.20,
            )
        elif action == "dive":
            stretch = max(0.0, math.sin(phase))
            recover = max(0.0, -math.sin(phase))
            tr = Transform(
                scale_x=1.0 + stretch * 0.018,
                scale_y=1.0 - stretch * 0.006 + recover * 0.004,
                shift_x=math.sin(phase) * 2.2,
                shift_y=-stretch * 1.8 + recover * 1.1,
                shear_x=math.sin(phase) * 0.010,
                shadow=0.24 + recover * 0.18,
            )
            weight = 0.020
        elif action == "celebrate":
            bounce = max(0.0, math.sin(phase * 2))
            tr = Transform(
                scale_x=1.0 + math.cos(phase) * 0.005,
                scale_y=1.0 + bounce * 0.008,
                shift_x=math.sin(phase) * 1.1,
                shift_y=-bounce * 2.0,
                shear_x=math.sin(phase) * 0.005,
                shadow=0.30 + max(0.0, -math.sin(phase * 2)) * 0.18,
            )
        elif action == "idle":
            breath = math.sin(phase)
            tr = Transform(
                scale_x=1.0 + breath * 0.003,
                scale_y=1.0 + max(0.0, breath) * 0.006,
                shift_x=breath * 0.7,
                shift_y=-max(0.0, breath) * 1.3,
                shear_x=breath * 0.002,
                shadow=0.32 + max(0.0, -breath) * 0.12,
            )
            weight = 0.012
        else:
            continue

        put_cell(sheet, frame, transform_frame(sheet, frame, tr, weight))
        changed.append(frame)
    return changed


def transform_frame(source: Image.Image, frame: int, tr: Transform, neighbour_weight: float = 0.014) -> Image.Image:
    cell = transformed_subject(get_cell(source, frame), tr)
    if neighbour_weight > 0 and frame > 0:
        cell = blend_with_neighbour(cell, get_cell(source, frame - 1), neighbour_weight)
    if neighbour_weight > 0 and frame < 23:
        cell = blend_with_neighbour(cell, get_cell(source, frame + 1), neighbour_weight)
    return cell


def transform_split_frame(source: Image.Image, frame: int, tr: SplitTransform, neighbour_weight: float = 0.014) -> Image.Image:
    cell = split_transformed_subject(get_cell(source, frame), tr)
    if neighbour_weight > 0 and frame > 0:
        cell = blend_with_neighbour(cell, get_cell(source, frame - 1), neighbour_weight)
    if neighbour_weight > 0 and frame < 23:
        cell = blend_with_neighbour(cell, get_cell(source, frame + 1), neighbour_weight)
    return cell


def build_locomotion_sheet(source: Image.Image, kind: str) -> Image.Image:
    """Create a 24-frame walk/run sheet from the authored approach atlas.

    This is intentionally conservative: no vector limbs, no new anatomy.  Each
    frame starts from an existing manga drawing and receives a whole-subject
    timing transform plus a tiny adjacent-frame detail pass.  The visual
    difference between the two sheets comes from cadence:

    * walk: short, upright, low lift, calmer shadow;
    * run: longer lean, larger bob, stronger footfall shadow.
    """

    out = Image.new("RGBA", (CELL * 6, CELL * 4), (0, 0, 0, 0))
    if kind == "walk":
        # Use the authored run-up as art source but heavily shorten the leg
        # band.  These are not attack frames at runtime: upright torso, small
        # ground bob, low shadow pulse, and alternating feet.
        #
        # Use twenty-four source cells, not a 13-cell loop.  The runtime QA
        # samples the sheet at gameplay size; a short loop made frames that
        # were technically different in the PNG collapse into the same small
        # silhouette/hash.  The forward-then-return source cadence keeps the
        # walk calm while giving every authored frame its own readable manga
        # pose.
        source_frames = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 11, 12, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
        for frame in range(24):
            phase = (frame / 24) * math.tau
            base = source_frames[frame]
            step = math.sin(phase * 2)
            lift = max(0.0, step)
            settle = max(0.0, -step)
            returning = 1.0 if frame >= 13 else 0.0
            mid_break = 1.0 if frame == 10 else 0.0
            turn_break = 1.0 if frame == 13 else 0.0
            tr = SplitTransform(
                upper_scale_x=0.88 + math.cos(phase) * 0.005 + mid_break * 0.006,
                upper_scale_y=0.996 + lift * 0.004,
                lower_scale_x=0.40 + math.cos(phase * 2) * 0.026 - turn_break * 0.018 + mid_break * 0.018,
                lower_scale_y=0.994 + lift * 0.010,
                upper_shift_x=math.sin(phase) * 1.05 - returning * 1.55 - turn_break * 1.15 + mid_break * 1.6,
                lower_shift_x=math.sin(phase * 2) * 3.6 + math.sin(phase) * 1.15 + returning * 1.75 + turn_break * 2.55 - mid_break * 2.3,
                shift_y=3.0 - lift * 2.55 + settle * 0.85 + returning * 0.45 + turn_break * 0.75 - mid_break * 0.55,
                shear_x=-0.056 + math.sin(phase) * 0.004 - returning * 0.004 - turn_break * 0.006 + mid_break * 0.007,
                shadow=0.29 + settle * 0.14 + returning * 0.025 + turn_break * 0.05 - mid_break * 0.035,
            )
            put_cell(out, frame, transform_split_frame(source, base, tr, 0.010))
        return out

    if kind == "run":
        source_frames = list(range(24))
        for frame in range(24):
            phase = (frame / 24) * math.tau
            base = source_frames[frame % len(source_frames)]
            lift = max(0.0, math.sin(phase * 2 + 0.35))
            footfall = max(0.0, -math.sin(phase * 2 + 0.35))
            forward = math.sin(phase)
            counter = math.sin(phase + math.pi * 0.5)
            tr = Transform(
                scale_x=1.006 + counter * 0.010,
                scale_y=1.002 + lift * 0.017 - footfall * 0.004,
                shift_x=forward * 4.2 + counter * 0.8,
                shift_y=-lift * 6.8 + footfall * 2.0,
                shear_x=0.024 + forward * 0.017,
                shadow=0.25 + footfall * 0.34,
            )
            put_cell(out, frame, transform_frame(source, base, tr, 0.022))
        return out

    raise ValueError(f"unknown locomotion sheet kind: {kind}")


def main() -> None:
    raise SystemExit(
        'Disabled: stretching and blending existing drawings is not new animation. '
        'Import authored source sheets with tools/import_generated_sprites.py instead.'
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {}

    approach_path = ROOT / "approach.png"
    approach_source = Image.open(approach_path).convert("RGBA")
    if approach_source.size != (CELL * 6, CELL * 4):
        raise SystemExit(f"{approach_path}: expected 3072x2048, got {approach_source.size}")

    for action in ("walk", "run"):
        path = ROOT / f"{action}.png"
        before = digest(path) if path.exists() else None
        sheet = build_locomotion_sheet(approach_source, action)
        sheet.save(path)
        after = digest(path)
        report[action] = {
            "before": before,
            "after": after,
            "framesEdited": list(range(1, 25)),
            "method": "derived-from-authored-approach-manga-frames",
        }
        print(f"{action:11} {before or 'missing':>16} -> {after}  frames 1..24")

    for action in ("idle", "serve", "jumpServe", "spike", "block", "bump", "set", "dive", "celebrate"):
        path = ROOT / f"{action}.png"
        before = digest(path)
        sheet = Image.open(path).convert("RGBA")
        if sheet.size != (CELL * 6, CELL * 4):
            raise SystemExit(f"{path}: expected 3072x2048, got {sheet.size}")

        distinct_before = distinct_frames(sheet)
        frames = enrich_cycle(sheet, action)
        if distinct_before < 24:
            if action == "idle":
                frames = sorted(set(frames + enrich_idle(sheet)))
            elif action in PLANS:
                frames = sorted(set(frames + enrich_selected(sheet, PLANS[action])))

        sheet.save(path)
        after = digest(path)
        report[action] = {
            "before": before,
            "after": after,
            "framesEdited": [frame + 1 for frame in frames],
            "method": "manga-source-cell-transform-full-action-pass",
            "distinctBefore": distinct_before,
            "distinctAfter": distinct_frames(sheet),
        }
        print(f"{action:11} {before} -> {after}  frames {', '.join(str(f + 1) for f in frames)}")

    OUT.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
