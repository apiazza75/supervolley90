import unittest
from unittest.mock import patch
from PIL import Image
from import_set_gather import import_gather


class GatherRegistrationTests(unittest.TestCase):
    def test_default_square_grid_is_unchanged(self):
        with patch('import_set_gather.register_single', return_value=Image.new('RGBA', (512, 512))) as register:
            result = import_gather(Image.new('RGB', (1024, 1024)), .8)
        self.assertEqual(result.size, (2048, 512))
        self.assertEqual([call.args[0].size for call in register.call_args_list], [(512, 512)] * 4)
        self.assertEqual([call.args[1] for call in register.call_args_list], [.8] * 4)

    def test_explicit_crops_keep_one_canvas_size_and_one_uniform_scale(self):
        boxes = [[90, 0, 590, 580], [717, 0, 1217, 580], [90, 600, 590, 1180], [717, 600, 1217, 1180]]
        with patch('import_set_gather.register_single', return_value=Image.new('RGBA', (512, 512))) as register:
            import_gather(Image.new('RGB', (1254, 1254)), .84, boxes)
        self.assertEqual([call.args[0].size for call in register.call_args_list], [(500, 580)] * 4)
        self.assertEqual([call.args[1] for call in register.call_args_list], [.84] * 4)

    def test_rejects_mixed_sizes_and_out_of_bounds_crops(self):
        source = Image.new('RGB', (1024, 1024))
        for boxes in [[[0, 0, 500, 500]] * 3, [[0, 0, 500, 500]] * 3 + [[0, 0, 501, 500]],
                      [[600, 600, 1100, 1100]] * 4]:
            with self.assertRaises(ValueError):
                import_gather(source, .8, boxes)

    def test_explicit_scales_apply_to_whole_drawings_only(self):
        scales = [.776699, .781008, .730216, .740942]
        with patch('import_set_gather.register_single', return_value=Image.new('RGBA', (512, 512))) as register:
            result = import_gather(Image.new('RGB', (1254, 1254)), scales)
        self.assertEqual(result.size, (2048, 512))
        self.assertEqual([call.args[0].size for call in register.call_args_list], [(627, 627)] * 4)
        self.assertEqual([call.args[1] for call in register.call_args_list], scales)

    def test_planted_feet_translate_the_complete_figure_without_pixel_changes(self):
        cell = Image.new('RGBA', (512, 512))
        cell.paste((40, 80, 160, 255), (160, 200, 260, 400))
        cell.paste((60, 100, 200, 255), (150, 440, 281, 471))
        with patch('import_set_gather.register_single', return_value=cell):
            result = import_gather(Image.new('RGB', (1024, 1024)), .8, planted_feet=True)
        first = result.crop((0, 0, 512, 512))
        feet = first.getchannel('A').crop((0, 422, 512, 471)).getbbox()
        self.assertEqual((feet[0] + feet[2] - 1) / 2, 256)
        self.assertEqual(sum(first.getchannel('A').tobytes()), sum(cell.getchannel('A').tobytes()))
        self.assertEqual(first.getpixel((201, 200)), cell.getpixel((160, 200)))
        with patch('import_set_gather.register_single', return_value=Image.new('RGBA', (512,512))):
            with self.assertRaises(ValueError):
                import_gather(Image.new('RGB', (1024,1024)), .8, planted_feet=True)

    def test_rejects_invalid_explicit_registration_before_processing(self):
        for scales in [[.8] * 3, [.8] * 5, [.8, .8, float('nan'), .8], [.8, 0, .8, .8],
                       [.8, 1.01, .8, .8], [.8, 'bad', .8, .8]]:
            with patch('import_set_gather.register_single') as register:
                with self.assertRaises(ValueError):
                    import_gather(Image.new('RGB', (1024, 1024)), scales)
                register.assert_not_called()


if __name__ == '__main__':
    unittest.main()
