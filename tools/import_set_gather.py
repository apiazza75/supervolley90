"""Register four authored 2x2 gather drawings as an RGBA 4x1 entry strip."""
import argparse
import json
import math
from pathlib import Path
from PIL import Image
from import_single_pose_redraws import register_single

def import_gather(source: Image.Image, scale: float | list[float], boxes=None, planted_feet=False) -> Image.Image:
    # Generated panels can have different drawing scales. A reviewed explicit
    # factor may register each COMPLETE figure against its adjacent key poses.
    # This is not per-limb warping or automatic full-silhouette normalization:
    # an arm rising must still change the height of the ink bounds naturally.
    scales = list(scale) if isinstance(scale, (list, tuple)) else [scale] * 4
    if len(scales) != 4 or any(not isinstance(s, (int, float)) or not math.isfinite(s)
                              or s <= 0 or s > 1 for s in scales):
        raise ValueError('Provide one or four finite whole-figure scales in (0, 1]')
    if boxes is None:
        if source.width != source.height or source.width % 2:
            raise ValueError('Source must be a square 2x2 sheet')
        size = source.width // 2
        boxes = [(i % 2 * size, i // 2 * size, i % 2 * size + size, i // 2 * size + size) for i in range(4)]
    if len(boxes) != 4 or any(len(box) != 4 for box in boxes):
        raise ValueError('Exactly four source boxes are required')
    sizes = {(right - left, bottom - top) for left, top, right, bottom in boxes}
    if len(sizes) != 1 or any(left < 0 or top < 0 or right > source.width or bottom > source.height
                            or right <= left or bottom <= top for left, top, right, bottom in boxes):
        raise ValueError('Source boxes must have one common size and stay inside the image')
    out = Image.new('RGBA', (2048, 512))
    for i, box in enumerate(boxes):
        # Each complete drawing uses isotropic resampling; anatomy is intact.
        cell = register_single(source.crop(box), scales[i])
        if planted_feet:
            # A landing hinges the torso over planted shoes. Register the
            # complete figure to the shoe footprint, not its moving jersey.
            # No limb deformation: one horizontal translation per drawing.
            feet = cell.getchannel('A').crop((0, 422, 512, 471)).getbbox()
            if feet is None:
                raise ValueError('Planted-foot registration requires visible shoes')
            dx = round(256 - (feet[0] + feet[2] - 1) / 2)
            shifted = Image.new('RGBA', cell.size)
            shifted.paste(cell, (dx, 0))
            if sum(cell.getchannel('A').tobytes()) != sum(shifted.getchannel('A').tobytes()):
                raise ValueError('Foot registration would crop authored pixels')
            cell = shifted
        out.paste(cell, (i * 512, 0))
    return out

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    registration = parser.add_mutually_exclusive_group(required=True)
    registration.add_argument('--scale', type=float)
    registration.add_argument('--scales', type=json.loads, help='Four reviewed whole-figure registration scales')
    parser.add_argument('--boxes', type=json.loads, help='Four equally sized [left,top,right,bottom] source crops')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--planted-feet', action='store_true', help='Register whole figures by their stationary shoe footprint')
    args = parser.parse_args()
    import_gather(Image.open(args.source), args.scales if args.scales is not None else args.scale, args.boxes, args.planted_feet).save(args.out, optimize=True)
