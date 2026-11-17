"""Reproduce the two authored passing poses; never generate or deform limbs."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from import_single_pose_redraws import register_single

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent.parent / 'assets/source/manga-2026-09'
manifest = json.loads((source / 'run-passing-generation.json').read_text())
atlas = Image.new('RGBA', (1024,512))
for index, drawing in enumerate(manifest['drawings']):
    path = source / drawing['source']
    if hashlib.sha256(path.read_bytes()).hexdigest() != drawing['sha256']:
        raise ValueError('Source hash changed; review the drawing before importing')
    with Image.open(path) as raw:
        if list(raw.size) != drawing['sourceSize']:
            raise ValueError('Unexpected source size')
        cell = register_single(raw.crop((22,22,1232,1232)), drawing['scale'])
    atlas.paste(cell, (index*512,0))
atlas.save(args.out)
