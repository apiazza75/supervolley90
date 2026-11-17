"""Reproduce authored plant in-betweens by whole-figure registration only."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image
from import_set_gather import import_gather

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args()
source_dir = Path(__file__).resolve().parent.parent / 'assets/source/manga-2026-09'
manifest = json.loads((source_dir / 'approach-plant-generation.json').read_text())
source = source_dir / manifest['source']
if hashlib.sha256(source.read_bytes()).hexdigest() != manifest['sourceSha256']:
    raise ValueError('Source changed: review before importing')
with Image.open(source) as raw:
    if list(raw.size) != manifest['sourceSize']:
        raise ValueError('Unexpected source dimensions')
    result = import_gather(raw, manifest['uniformScale'], manifest['boxes'], planted_feet=True)
result.save(args.out, optimize=True)
