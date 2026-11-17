#!/usr/bin/env python3
"""Register separately illustrated full-body redraws into selected atlas cells.

All sources in one import share a source resolution and ONE uniform scale.
Only whole-image resampling, chroma extraction and root/sole translation are
allowed here. Unselected runtime cells are copied without altering their pixels.
The JSON manifest records the source drawings and registration explicitly.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

from PIL import Image

from import_generated_sprites import CELL, GROUND_LINE, chroma_key, keep_single_figure, kit_root_x


def register_single(source: Image.Image, scale: float, sole_lift: float = 0) -> Image.Image:
    if not math.isfinite(scale) or scale <= 0 or scale > 1:
        raise ValueError('scale must be finite and in (0, 1]')
    if not math.isfinite(sole_lift) or sole_lift < 0 or sole_lift > 120:
        raise ValueError('sole_lift must be finite and in [0, 120]')
    rgba = source.convert('RGBA')
    # Opaque RGBA is still a keyed RGB drawing, not supplied transparency.
    keyed = chroma_key(rgba if rgba.getchannel('A').getextrema()[0] < 255 else rgba.convert('RGB'), cols=1, rows=1)
    box = keyed.getchannel('A').getbbox()
    if box is None or box[0] == 0 or box[1] == 0 or box[2] == source.width or box[3] == source.height:
        raise ValueError('source must contain a complete figure with outer margins')
    size = tuple(round(d * scale) for d in source.size)
    if min(size) < 1 or max(size) > CELL:
        raise ValueError('scaled source canvas must fit the atlas cell without cropping')
    resized = keyed.resize(size, Image.Resampling.LANCZOS)
    cell = Image.new('RGBA', (CELL, CELL))
    cell.paste(resized, ((CELL - resized.width) // 2, 0))
    cell = keep_single_figure(cell)
    box = cell.getchannel('A').getbbox()
    root_x = kit_root_x(cell, box)
    dx = round(CELL / 2 - root_x)
    dy = round(GROUND_LINE - sole_lift - (box[3] - 1))
    shifted = Image.new('RGBA', (CELL, CELL))
    shifted.paste(cell, (dx, dy))
    final_box = shifted.getchannel('A').getbbox()
    if final_box is None or min(final_box[:2]) < 6 or max(final_box[2:]) > CELL - 6:
        raise ValueError(f'registered figure violates safe margin: {final_box}')
    if sum(cell.getchannel('A').tobytes()) != sum(shifted.getchannel('A').tobytes()):
        raise ValueError('registration would crop authored pixels')
    return shifted


def replace_cells(base: Image.Image, replacements: dict[int, Image.Image]) -> Image.Image:
    if base.size != (3072, 2048) or base.mode != 'RGBA':
        raise ValueError('base must be a 3072x2048 RGBA atlas')
    if not replacements:
        raise ValueError('at least one selected redraw is required')
    result = base.copy()
    for frame, cell in replacements.items():
        if not isinstance(frame, int) or frame < 0 or frame >= 24:
            raise ValueError('frame indexes must be zero-based integers 0..23')
        if cell.size != (CELL, CELL) or cell.mode != 'RGBA':
            raise ValueError('replacement must be a 512x512 RGBA cell')
        result.paste(cell, (frame % 6 * CELL, frame // 6 * CELL))
    return result


def import_manifest(base_path: Path, manifest_path: Path) -> Image.Image:
    manifest = json.loads(manifest_path.read_text())
    sources = manifest['redraws']
    size = tuple(manifest['sourceSize'])
    scale = manifest['uniformScale']
    replacements = {}
    hashes = set()
    for item in sources:
        frame = item['frame']
        if frame in replacements:
            raise ValueError('duplicate target frame')
        path = manifest_path.parent / item['source']
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes:
            raise ValueError('duplicate drawings cannot provide in-betweens')
        if digest != item['sha256']:
            raise ValueError(f'source hash mismatch: {path.name}')
        hashes.add(digest)
        with Image.open(path) as source:
            if source.size != size:
                raise ValueError('all redraws must use the recorded common source resolution')
            replacements[frame] = register_single(source, scale, item.get('soleLift', 0))
    with Image.open(base_path) as base:
        return replace_cells(base, replacements)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    result = import_manifest(args.base, args.manifest)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    result.save(args.out, optimize=True)
    print(f'{args.out}: {hashlib.sha256(args.out.read_bytes()).hexdigest()}')


if __name__ == '__main__':
    main()
