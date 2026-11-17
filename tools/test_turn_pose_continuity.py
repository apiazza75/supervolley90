"""Guard the reviewed planted-pivot rise; not a substitute for motion review."""
from pathlib import Path
import unittest
from PIL import Image


class TurnPoseContinuity(unittest.TestCase):
    def test_middle_rise_has_no_single_frame_body_pop(self):
        sheet = Image.open(Path(__file__).resolve().parents[1] / 'public/sprites/turn.png').convert('RGBA')
        self.assertEqual(sheet.size, (3072, 2048))
        heights = []
        for frame in range(3, 7):
            x, y = frame % 6 * 512, frame // 6 * 512
            alpha = sheet.crop((x, y, x + 512, y + 512)).getchannel('A')
            # Ignore the faint antialias fringe; measure the actual ink body.
            box = alpha.point(lambda a: 255 if a >= 128 else 0).getbbox()
            self.assertIsNotNone(box)
            heights.append(box[3] - box[1])
        for first, second in zip(heights, heights[1:]):
            self.assertGreaterEqual(second - first, 0, heights)
            self.assertLessEqual(second - first, 12, heights)


if __name__ == '__main__':
    unittest.main()
