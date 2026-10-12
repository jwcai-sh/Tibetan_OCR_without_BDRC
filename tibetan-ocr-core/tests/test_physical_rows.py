import unittest
from io import BytesIO
from unittest.mock import patch
import cv2
import numpy as np
import ai_vision_ocr_server as server


class PhysicalRowsTests(unittest.TestCase):
    def test_sloping_rows_keep_detached_marks_and_remain_separate(self):
        image = np.full((420, 1400, 3), 240, dtype=np.uint8)
        for base in (80, 165, 250, 335):
            for x in range(90, 1300, 40):
                y = base - round(x * .025)
                cv2.rectangle(image, (x, y), (x + 18, y + 26), (20, 20, 20), -1)
                cv2.rectangle(image, (x + 4, y - 11), (x + 12, y - 6), (20, 20, 20), -1)
        _, encoded = cv2.imencode('.png', image)
        rows = server.detect_physical_text_line_bboxes(encoded.tobytes(), include_masks=True)
        self.assertEqual(len(rows), 4)
        for index, row in enumerate(rows):
            for x in range(90, 1300, 40):
                y = (80, 165, 250, 335)[index] - round(x * .025)
                self.assertEqual(int(row['_exclusion'][y - 8, x + 8]), 0, 'detached upper mark must survive')
                self.assertEqual(int(row['_exclusion'][y + 20, x + 8]), 0, 'glyph body must survive')
            neighbour = (index + 1) % 4
            y = (80, 165, 250, 335)[neighbour] - round(90 * .025)
            self.assertEqual(int(row['_exclusion'][y + 15, 100]), 1, 'neighbour body must be excluded')

    def test_two_legacy_boxes_for_one_row_share_identity_and_full_crop(self):
        image = np.full((200, 800, 3), 240, dtype=np.uint8)
        for y in (45, 120):
            for x in range(80, 720, 40):
                cv2.rectangle(image, (x, y), (x + 15, y + 28), (20, 20, 20), -1)
        _, encoded = cv2.imencode('.png', image)
        region = dict(id='center', x=0, y=0, width=1, height=1)
        with patch.object(server, 'detect_traditional_column_bboxes', return_value=[region]):
            _, first = server.prepare_line_review_images(encoded.tobytes(), dict(x=.1,y=.2,width=.8,height=.16))
            _, second = server.prepare_line_review_images(encoded.tobytes(), dict(x=.12,y=.21,width=.6,height=.18))
        self.assertEqual(first['source_bbox']['physical_row_index'], second['source_bbox']['physical_row_index'])
        self.assertEqual(first['crop_pixels'], second['crop_pixels'])
        self.assertGreater(first['padding_pixels'], 0)
