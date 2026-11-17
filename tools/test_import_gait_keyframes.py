"""Mechanical importer tests, NOT artistic or anatomical acceptance tests."""
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase, main
from unittest.mock import patch

from PIL import Image

from import_gait_keyframes import extract_eight_figures, extract_grid_figures, extract_run_figure, interleave, preserve_unselected, RUN_FOOT_LIFTS
from import_generated_sprites import chroma_key, fit_source_grid, normalize_atlas


class GaitSheetImportTests(TestCase):
    def test_extracts_four_different_source_layouts_without_rescaling(self):
        for cols,rows,width,height in [(2,2,1374,1145),(4,1,1774,887)]:
            source=Image.new('RGBA',(width,height))
            for i in range(4):
                source.paste(Image.new('RGBA',(45+i,60),(30+i,80,160,255)),
                    (int((i%cols+.5)*width/cols),int((i//cols+.3)*height/rows)))
            before=source.tobytes();figures=extract_grid_figures(source,cols,rows)
            self.assertEqual(source.tobytes(),before)
            self.assertEqual([f.size for f in figures],[(45+i,60) for i in range(4)])

    def test_partial_redraw_preserves_every_unselected_pixel_and_both_inputs(self):
        base = Image.new('RGBA', (3072, 2048), (10, 20, 30, 255))
        candidate = Image.new('RGBA', (3072, 2048), (90, 80, 70, 128))
        before = base.tobytes(), candidate.tobytes()
        result = preserve_unselected(base, candidate, {14, 15, 16, 17})
        self.assertEqual((base.tobytes(), candidate.tobytes()), before)
        for i in range(24):
            cell = (i % 6 * 512, i // 6 * 512, (i % 6 + 1) * 512, (i // 6 + 1) * 512)
            source = candidate if i in {14, 15, 16, 17} else base
            self.assertEqual(result.crop(cell).tobytes(), source.crop(cell).tobytes())
        with self.assertRaisesRegex(ValueError, 'at least one'):
            preserve_unselected(base, candidate, set())
        with self.assertRaisesRegex(ValueError, 'candidate must'):
            preserve_unselected(base, Image.new('RGB', (3072, 2048)), {14})

    def test_pose_override_replaces_one_whole_drawing_before_shared_scale(self):
        with TemporaryDirectory(prefix='sv90-pose-override-') as folder:
            paths = [Path(folder) / f'{i}.png' for i in range(4)]
            for path in paths:
                Image.new('RGBA', (1536, 1024)).save(path)
            groups = [[Image.new('RGBA', (20, 40), (30 + key * 20, 20 + offset * 80, 90, 255))
                       for key in range(8)] for offset in range(3)]
            alternatives = [Image.new('RGBA', (30, 60), (210, 100, key * 20, 255)) for key in range(8)]
            with patch('import_gait_keyframes.chroma_key', side_effect=lambda img, **_: img), \
                    patch('import_gait_keyframes.extract_eight_figures', side_effect=[*groups, alternatives]), \
                    patch('import_gait_keyframes.normalize_atlas', side_effect=lambda atlas, *_: atlas):
                atlas = interleave(paths[:3], 'spikeFollow', {1: (paths[3], 2)})
            for frame in range(24):
                x, y = frame % 6 * 512, frame // 6 * 512
                cell = atlas.crop((x, y, x + 512, y + 512))
                box = cell.getchannel('A').getbbox()
                self.assertEqual((box[2] - box[0], box[3] - box[1]), (30, 60) if frame == 1 else (20, 40))
                key, offset = divmod(frame, 3)
                self.assertEqual(cell.getpixel((256, 480)), (210, 100, 40, 255) if frame == 1
                                 else (30 + key * 20, 20 + offset * 80, 90, 255))

    def test_legacy_gait_rejects_pose_overrides(self):
        with self.assertRaisesRegex(ValueError, 'registered eight-pose'):
            interleave([Path('unused')] * 3, 'walk', {1: (Path('unused'), 0)})

    def test_override_scale_rejects_invalid_values_before_opening_sources(self):
        for scale in (0, -1, 1.01, float('nan'), float('inf')):
            with self.subTest(scale=scale), self.assertRaisesRegex(ValueError, 'override scale'):
                interleave([Path('unused')] * 3, 'jumpServe', {13: (Path('unused'), 1)}, scale)
        with self.assertRaisesRegex(ValueError, 'requires pose overrides'):
            interleave([Path('unused')] * 3, 'jumpServe', override_scale=.85)

    def test_override_scale_preserves_aspect_and_unselected_drawings(self):
        with TemporaryDirectory(prefix='sv90-scaled-override-') as folder:
            paths = [Path(folder) / f'{i}.png' for i in range(4)]
            for path in paths:
                Image.new('RGBA', (1536, 1024)).save(path)
            groups = [[Image.new('RGBA', (20, 40), (30, 50, 90, 255)) for _ in range(8)] for _ in range(3)]
            alternatives = [Image.new('RGBA', (40, 80), (210, 100, 40, 255)) for _ in range(8)]
            with patch('import_gait_keyframes.chroma_key', side_effect=lambda img, **_: img), \
                    patch('import_gait_keyframes.extract_eight_figures', side_effect=[*groups, alternatives]), \
                    patch('import_gait_keyframes.normalize_atlas', side_effect=lambda atlas, *_: atlas):
                atlas = interleave(paths[:3], 'jumpServe', {13: (paths[3], 1)}, .75)
            for frame in range(24):
                x, y = frame % 6 * 512, frame // 6 * 512
                box = atlas.crop((x, y, x + 512, y + 512)).getchannel('A').getbbox()
                self.assertEqual((box[2] - box[0], box[3] - box[1]), (30, 60) if frame == 13 else (20, 40))

    def test_turn_endings_share_exact_prefix_but_have_distinct_tail_drawings(self):
        sprites = Path(__file__).resolve().parents[1] / 'public' / 'sprites'
        with Image.open(sprites / 'runTurn.png') as running, Image.open(sprites / 'turnStop.png') as stopping:
            for frame in range(24):
                x, y = frame % 6 * 512, frame // 6 * 512
                rect = (x, y, x + 512, y + 512)
                if frame < 12:
                    self.assertEqual(running.crop(rect).tobytes(), stopping.crop(rect).tobytes())
                else:
                    self.assertNotEqual(running.crop(rect).tobytes(), stopping.crop(rect).tobytes())

    def test_all_24_drawings_keep_source_order_and_aspect_ratio(self):
        # Deliberately non-art test markers: three sets of eight solid cells.
        # Disable registration here so this tests only extraction and padding.
        with TemporaryDirectory(prefix="sv90-gait-import-") as folder:
            sources = []
            for offset in range(3):
                sheet = Image.new("RGB", (1536, 1024))
                for key in range(8):
                    x, y = key % 4 * 384, key // 4 * 512
                    sheet.paste((40 + offset * 60, 20 + key * 25, 80), (x, y, x + 384, y + 512))
                path = Path(folder) / f"offset-{offset}.png"
                sheet.save(path)
                sources.append(path)
            with patch("import_gait_keyframes.chroma_key", side_effect=lambda img, **_: img.convert("RGBA")), \
                    patch("import_gait_keyframes.normalize_atlas", side_effect=lambda atlas, _: atlas):
                atlas = interleave(sources, "walk")
            self.assertEqual(atlas.size, (3072, 2048))
            for frame in range(24):
                key, offset = divmod(frame, 3)
                x, y = frame % 6 * 512, frame // 6 * 512
                colour = (40 + offset * 60, 20 + key * 25, 80, 255)
                self.assertEqual(atlas.getpixel((x + 64, y)), colour)
                self.assertEqual(atlas.getpixel((x + 447, y + 511)), colour)
                self.assertEqual(atlas.getpixel((x + 63, y + 255))[3], 0)
                self.assertEqual(atlas.getpixel((x + 448, y + 255))[3], 0)

    def test_eight_cell_key_removes_magenta_without_erasing_white_costume(self):
        sheet = Image.new("RGB", (64, 32), (255, 0, 255))
        for key in range(8):
            sheet.putpixel((key % 4 * 16 + 8, key // 4 * 16 + 8), (245, 245, 245))
        keyed = chroma_key(sheet, cols=4, rows=2)
        self.assertEqual(keyed.getpixel((0, 0))[3], 0)
        for key in range(8):
            self.assertEqual(keyed.getpixel((key % 4 * 16 + 8, key // 4 * 16 + 8)), (245, 245, 245, 255))

    def test_service_keeps_all_drawings_and_the_reviewed_rising_palm_order(self):
        with TemporaryDirectory(prefix="sv90-serve-import-") as folder:
            sources = []
            for offset in range(3):
                path = Path(folder) / f"source-{offset}.png"
                Image.new("RGBA", (1536, 1024)).save(path)
                sources.append(path)
            for action in ("serve", "jumpServe", "idle", "approach", "celebrate", "bump", "set", "backSet", "turn", "backpedal", "runTurn", "turnStop"):
                groups = [[Image.new("RGBA", (20, 40), (30 + key * 20, 20 + offset * 80, 90, 255))
                           for key in range(8)] for offset in range(3)]
                with patch("import_gait_keyframes.chroma_key", side_effect=lambda img, **_: img), \
                        patch("import_gait_keyframes.extract_eight_figures", side_effect=groups), \
                        patch("import_gait_keyframes.normalize_atlas", side_effect=lambda atlas, *_: atlas):
                    atlas = interleave(sources, action)
                colours = []
                for frame in range(24):
                    source_frame = 11 - frame if action == "serve" and frame in (5, 6) else frame
                    if action == "celebrate" and frame in (4, 5):
                        source_frame = 9 - frame
                    if action == "set":
                        source_frame = {4: 3, 3: 4, 10: 12, 11: 10, 12: 13, 13: 11}.get(frame, frame)
                    if action == "bump" and frame in (5, 6):
                        source_frame = 11 - frame
                    key, offset = divmod(source_frame, 3)
                    colour = atlas.getpixel((frame % 6 * 512 + 256, frame // 6 * 512 + 480))
                    self.assertEqual(colour, (30 + key * 20, 20 + offset * 80, 90, 255))
                    colours.append(colour)
                self.assertEqual(len(set(colours)), 24)

    def test_missing_inbetween_source_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "exactly three"):
            interleave([], "walk")

    def test_supplied_alpha_is_preserved_including_soft_ink_edges(self):
        source = Image.new("RGBA", (1536, 1024))
        source.putpixel((192, 200), (25, 70, 155, 173))
        keyed = chroma_key(fit_source_grid(source), cols=4, rows=2)
        self.assertEqual(keyed.tobytes(), source.tobytes())

    def test_painted_checkerboard_is_not_treated_as_transparency(self):
        source = Image.new("RGB", (1536, 1024), (245, 245, 245))
        with self.assertRaisesRegex(ValueError, "no magenta"):
            chroma_key(fit_source_grid(source), cols=4, rows=2)

    def test_attack_extraction_keeps_fingers_across_empty_virtual_row_divider(self):
        source = Image.new("RGBA", (1536, 1024))
        for key in range(8):
            x, y = key % 4 * 384, key // 4 * 512
            source.paste((25, 70, 155, 255), (x + 130, y + 100, x + 230, y + 430))
        # Complete raised arm at y=490..620, not clipped at the imaginary 512.
        source.paste((225, 170, 95, 255), (150, 490, 170, 620))
        figures = extract_eight_figures(source)
        self.assertEqual(len(figures), 8)
        self.assertEqual(figures[4].size, (100, 452))
        self.assertEqual(figures[4].getpixel((20, 0)), (225, 170, 95, 255))
        self.assertEqual(sum(figures[4].getchannel("A").histogram()[1:]), 35440)

    def test_attack_registration_changes_neither_pose_size_nor_limb_shape(self):
        atlas = Image.new("RGBA", (3072, 2048))
        for frame in range(24):
            x, y = frame % 6 * 512, frame // 6 * 512
            # Different-height markers stand for bent and extended poses.
            atlas.paste((25, 70, 155, 255), (x + 210, y + 140, x + 250, y + 200 + frame))
        for action in ("idle", "approach", "celebrate", "spike", "block", "serve", "jumpServe", "dive", "bump", "set", "backSet", "turn", "backpedal", "runTurn", "turnStop"):
            with patch("import_generated_sprites.keep_single_figure", side_effect=lambda cell: cell):
                registered = normalize_atlas(atlas, action, [0] * 24)
            for frame in range(24):
                x, y = frame % 6 * 512, frame // 6 * 512
                box = registered.crop((x, y, x + 512, y + 512)).getchannel("A").getbbox()
                self.assertEqual((box[2] - box[0], box[3] - box[1]), (40, 60 + frame))
                self.assertEqual(box[3] - 1, 470)

    def test_run_extraction_recovers_art_across_a_virtual_divider(self):
        source = Image.new('RGBA', (1536, 1024))
        blue = (25, 70, 155, 255)
        source.paste(blue, (550, 100, 610, 300))
        source.paste(blue, (365, 220, 551, 240))  # limb crosses the x=384 divider
        source.paste((200, 40, 40, 255), (340, 60, 365, 90))  # unrelated neighbour
        recovered = extract_run_figure(source, 1)
        self.assertEqual(recovered.getchannel('A').getbbox(), (45, 100, 290, 300))
        self.assertEqual(recovered.getpixel((50, 230)), blue)
        self.assertEqual(recovered.getpixel((30, 70))[3], 0)
        self.assertEqual(sum(recovered.getchannel('A').histogram()[1:]), 15700)

    def test_real_outer_image_clipping_requires_a_redraw(self):
        source = Image.new('RGBA', (1536, 1024))
        source.paste((25, 70, 155, 255), (0, 100, 40, 200))
        with self.assertRaisesRegex(ValueError, 'outer image/row edge'):
            extract_run_figure(source, 0)

    def test_run_floor_annotations_preserve_flight_without_warping_the_drawing(self):
        atlas = Image.new("RGBA", (3072, 2048))
        for frame in range(24):
            x, y = frame % 6 * 512, frame // 6 * 512
            atlas.paste((25, 70, 155, 255), (x + 210, y + 140, x + 250, y + 200))
        with patch("import_generated_sprites.keep_single_figure", side_effect=lambda cell: cell):
            registered = normalize_atlas(atlas, "run", RUN_FOOT_LIFTS)
        for frame, lift in enumerate(RUN_FOOT_LIFTS):
            x, y = frame % 6 * 512, frame // 6 * 512
            cell = registered.crop((x, y, x + 512, y + 512))
            left, top, right, bottom = cell.getchannel("A").getbbox()
            self.assertEqual((right - left, bottom - top), (40, 60))
            self.assertEqual(bottom - 1, 470 - lift)
        self.assertEqual(RUN_FOOT_LIFTS[:12], RUN_FOOT_LIFTS[12:])
        self.assertGreater(RUN_FOOT_LIFTS[9], 0)
        self.assertEqual(RUN_FOOT_LIFTS[0], 0)

    def test_invalid_floor_annotations_are_rejected(self):
        for values in ([0] * 23, [float("nan")] * 24, [-1] * 24, [121] * 24):
            with self.subTest(values=values):
                with self.assertRaisesRegex(ValueError, "foot_lifts"):
                    normalize_atlas(Image.new("RGBA", (3072, 2048)), "run", values)


if __name__ == "__main__":
    main()
