"""Mechanical registration guarantees; these tests do not approve anatomy."""
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from PIL import Image, ImageDraw

from import_single_pose_redraws import import_manifest, register_single, replace_cells


def source_fixture():
    image = Image.new('RGBA', (384, 512))
    draw = ImageDraw.Draw(image)
    draw.rectangle((100, 50, 280, 450), fill=(30, 70, 150, 255))
    draw.rectangle((140, 140, 160, 180), fill=(255, 255, 255, 255))
    return image


class SinglePoseRedrawTest(unittest.TestCase):
    def test_registration_preserves_whole_figure_and_authored_white(self):
        cell = register_single(source_fixture(), 1)
        self.assertEqual(cell.getchannel('A').getbbox(), (165, 70, 346, 471))
        self.assertEqual(cell.getpixel((216, 180)), (255, 255, 255, 255))
        self.assertEqual(cell.getpixel((10, 180)), (0, 0, 0, 0))

    def test_common_scale_keeps_shape_and_sole_lift(self):
        grounded = register_single(source_fixture(), .75)
        lifted = register_single(source_fixture(), .75, 17)
        gbox, lbox = (im.getchannel('A').getbbox() for im in [grounded, lifted])
        self.assertEqual(gbox[2] - gbox[0], lbox[2] - lbox[0])
        self.assertEqual(gbox[3] - lbox[3], 17)
        self.assertEqual(sum(grounded.getchannel('A').tobytes()), sum(lifted.getchannel('A').tobytes()))

    def test_unselected_cells_are_byte_identical_and_selected_cell_replaces_alpha(self):
        base = Image.new('RGBA', (3072, 2048), (11, 21, 31, 255))
        new = register_single(source_fixture(), 1)
        result = replace_cells(base, {15: new, 16: new, 17: new})
        for frame in range(24):
            x, y = frame % 6 * 512, frame // 6 * 512
            crop = (x, y, x + 512, y + 512)
            self.assertEqual(result.crop(crop).tobytes(), new.tobytes() if frame in [15, 16, 17] else base.crop(crop).tobytes())
        self.assertEqual(base.getpixel((15 % 6 * 512, 15 // 6 * 512))[3], 255)

    def test_rejects_invalid_scale_lift_and_clipped_source(self):
        for scale in [0, float('nan'), float('inf'), 1.1]:
            with self.assertRaises(ValueError): register_single(source_fixture(), scale)
        for lift in [-1, float('nan'), 121]:
            with self.assertRaises(ValueError): register_single(source_fixture(), 1, lift)
        with self.assertRaises(ValueError): register_single(Image.new('RGBA', (384, 512), 'blue'), 1)

    def test_rejects_wrong_atlas_cells_and_frame_indexes(self):
        base = Image.new('RGBA', (3072, 2048))
        for frame in [-1, 24, 2.5]:
            with self.assertRaises(ValueError): replace_cells(base, {frame: Image.new('RGBA', (512, 512))})
        with self.assertRaises(ValueError): replace_cells(base, {})
        with self.assertRaises(ValueError): replace_cells(base, {0: Image.new('RGB', (512, 512))})
        with self.assertRaises(ValueError): replace_cells(Image.new('RGBA', (512, 512)), {0: Image.new('RGBA', (512, 512))})

    def test_manifest_rejects_duplicate_source_content_hash_and_resolution_drift(self):
        with tempfile.TemporaryDirectory(prefix='sv90-redraw-test-') as folder:
            root = Path(folder)
            source_fixture().save(root / 'pose.png')
            digest = hashlib.sha256((root / 'pose.png').read_bytes()).hexdigest()
            Image.new('RGBA', (3072, 2048)).save(root / 'base.png')
            manifest = {'sourceSize': [384, 512], 'uniformScale': 1, 'redraws': [
                {'frame': 15, 'source': 'pose.png', 'sha256': digest},
                {'frame': 16, 'source': 'pose.png', 'sha256': digest}]}
            path = root / 'manifest.json'
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'duplicate drawings'): import_manifest(root / 'base.png', path)
            manifest['redraws'].pop()
            manifest['redraws'][0]['sha256'] = 'wrong'
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'hash mismatch'): import_manifest(root / 'base.png', path)
            manifest['redraws'][0]['sha256'] = digest
            manifest['sourceSize'] = [400, 500]
            path.write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError, 'source resolution'): import_manifest(root / 'base.png', path)


if __name__ == '__main__':
    unittest.main()
