"""Pack the illustrated seated referee/line judge atlas without altering anatomy."""
from pathlib import Path
from PIL import Image
from import_generated_sprites import chroma_key

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'assets/source/manga-2026-09/officials.png'
image = chroma_key(Image.open(source).convert('RGB'))
atlas = Image.new('RGBA', (1536, 1024))
# The raised flag starts 12 pixels above the nominal second row. The empty
# gutter ends at y=490; measure that row there to retain the whole red flag.
for row, (top, bottom) in enumerate(((0, 490), (490, 1024))):
    cells = [image.crop((i * 384, top, (i + 1) * 384, bottom)) for i in range(4)]
    boxes = [cell.getchannel('A').getbbox() for cell in cells]
    if any(box is None for box in boxes):
        raise ValueError('An official pose is empty')
    scale = min(1.0, 470 / max(box[3] - box[1] for box in boxes))
    for col, (cell, box) in enumerate(zip(cells, boxes)):
        # Root registration uses the chair feet/trouser legs in the bottom
        # fifth, so extending a signal arm does not move the body sideways.
        band = cell.crop((0, box[3] - 70, cell.width, box[3]))
        root_box = band.getchannel('A').getbbox()
        root_x = (root_box[0] + root_box[2]) / 2
        scaled = cell.resize((round(cell.width * scale), round(cell.height * scale)), Image.Resampling.LANCZOS)
        destination = Image.new('RGBA', (384, 512))
        destination.alpha_composite(scaled, (round(192 - root_x * scale), round(486 - box[3] * scale)))
        atlas.alpha_composite(destination, (col * 384, row * 512))
destination = ROOT / 'public/officials/manga-seated.png'
atlas.save(destination, optimize=True)
print(destination)
