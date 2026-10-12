"""A source preview must not paint over faded glyphs beside a red rule."""
import sys
import unittest
from pathlib import Path
from io import BytesIO
from unittest.mock import patch
from PIL import Image, ImageDraw
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as server

class CropPixelPreservationTests(unittest.TestCase):
    def test_rule_cleanup_does_not_erase_warm_faded_letter_strokes(self):
        source = Image.new('RGB', (400, 160), (225, 220, 180))
        draw = ImageDraw.Draw(source)
        draw.rectangle((0, 12, 399, 15), fill=(190, 45, 35))
        # Faded ink over yellow paper can have the same hue as a red frame.
        draw.rectangle((100, 16, 119, 50), fill=(120, 100, 85))
        draw.rectangle((100, 50, 119, 100), fill=(35, 35, 30))
        data = BytesIO(); source.save(data, format='PNG')
        box = dict(x=0, y=0, width=1, height=1,
                   _exclusion=(0, 0, np.zeros((160, 400), dtype=np.uint8)))
        with patch.object(server, 'bound_legacy_line_crop', return_value=box):
            tiles, meta = server.prepare_line_review_images(data.getvalue(), box)
        # This short row is one tile. Sample the interior of the faded stroke,
        # allowing the production padding/resampling but no color replacement.
        image = Image.open(BytesIO(tiles[0]))
        scale = meta['review_size']['height'] / (160 + 2 * meta['padding_pixels'])
        pixel = image.getpixel((round(110 * scale), round((20 + meta['padding_pixels']) * scale)))
        self.assertLess(max(abs(a-b) for a,b in zip(pixel, (120,100,85))), 8)

if __name__ == '__main__':
    unittest.main()
