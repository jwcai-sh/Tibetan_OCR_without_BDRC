"""Faded stacked marks must not be erased by a dark-ink row mask."""
import sys
import unittest
from pathlib import Path
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as server

class PaleRowStrokesTests(unittest.TestCase):
    def test_faded_lower_strokes_survive_without_merging_rows(self):
        image = np.full((320, 1000, 3), 250, dtype=np.uint8)
        for base in (65, 180):
            for x in range(50, 950, 45):
                cv2.rectangle(image, (x, base), (x+20, base+25), (50,50,50), -1)
                cv2.line(image, (x+15, base+23), (x+18, base+78), (190,190,190), 3)
        _, png = cv2.imencode('.png', image)
        rows = server.detect_physical_text_line_bboxes(png.tobytes(), include_masks=True)
        self.assertEqual(len(rows), 2)
        for i, base in enumerate((65,180)):
            self.assertEqual(int(rows[i]['_exclusion'][base+75,68]), 0)
            self.assertGreaterEqual((rows[i]['y']+rows[i]['height'])*320, base+78)
        self.assertEqual(int(rows[0]['_exclusion'][190,60]), 1)

if __name__ == '__main__':
    unittest.main()
