"""Diagnostic crops only: compare source art with a flagged imported frame."""
from pathlib import Path
from PIL import Image

out = Path('artifacts/gait-key-direction')
with Image.open('public/sprites/run.png') as atlas:
    frame = atlas.crop((5 * 512, 512, 6 * 512, 2 * 512))
    canvas = Image.new('RGBA', frame.size, (36, 56, 62, 255))
    canvas.alpha_composite(frame)
    canvas.save(out / 'run-frame-12-edge.png')
    canvas.crop((30, 350, 110, 430)).resize((640, 640), Image.Resampling.NEAREST).save(out / 'run-frame-12-edge-zoom.png')
with Image.open('assets/source/manga-2026-09/run-between-2.png') as source:
    source.crop((1152, 0, 1536, 512)).save(out / 'run-frame-12-source.png')
