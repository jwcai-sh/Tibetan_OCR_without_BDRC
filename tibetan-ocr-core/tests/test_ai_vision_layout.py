import unittest

import cv2
import numpy as np

from ai_vision_ocr_server import (
    attach_layout_bboxes,
    build_layout_payload,
    detect_text_line_bboxes,
    prepare_vision_image,
)


def make_two_line_image() -> bytes:
    image = np.full((240, 640), 255, dtype=np.uint8)
    cv2.rectangle(image, (90, 45), (540, 72), 0, -1)
    cv2.rectangle(image, (120, 145), (500, 172), 0, -1)
    success, encoded = cv2.imencode(".png", image)
    assert success
    return encoded.tobytes()


class AiVisionLayoutTest(unittest.TestCase):
    def test_detects_ordered_normalized_line_boxes(self):
        boxes = detect_text_line_bboxes(make_two_line_image())
        self.assertEqual(len(boxes), 2)
        self.assertLess(boxes[0]["y"], boxes[1]["y"])
        for box in boxes:
            self.assertGreater(box["width"], 0)
            self.assertGreater(box["height"], 0)
            self.assertLessEqual(box["x"] + box["width"], 1)
            self.assertLessEqual(box["y"] + box["height"], 1)

    def test_maps_extra_detected_bands_without_merging_multiple_rows(self):
        image = make_two_line_image()
        lines, boxes = attach_layout_bboxes([{"text": "one"}], image)
        self.assertEqual(len(boxes), 2)
        self.assertIn("bbox", lines[0])
        self.assertTrue(lines[0]["bbox_approximate"])
        self.assertLessEqual(lines[0]["bbox"]["height"], max(box["height"] for box in boxes))

    def test_splits_detected_bands_when_ai_returns_more_lines(self):
        image = make_two_line_image()
        lines, boxes = attach_layout_bboxes(
            [{"text": "one"}, {"text": "two"}, {"text": "three"}], image
        )
        self.assertEqual(len(boxes), 2)
        self.assertEqual(len(lines), 3)
        self.assertTrue(all(line.get("bbox_approximate") for line in lines))
        self.assertTrue(all(line.get("bbox") for line in lines))
        self.assertLess(lines[0]["bbox"]["y"], lines[1]["bbox"]["y"])
        self.assertLess(lines[1]["bbox"]["y"], lines[2]["bbox"]["y"])

    def test_build_layout_payload_returns_one_box_per_existing_ocr_row(self):
        payload = build_layout_payload(make_two_line_image(), 3)
        self.assertEqual(len(payload["layout_bboxes"]), 2)
        self.assertEqual(len(payload["lines"]), 3)
        self.assertTrue(all(line.get("bbox") for line in payload["lines"]))
        self.assertTrue(all(line.get("bbox_approximate") for line in payload["lines"]))

    def test_image_preparation_always_returns_upload_tuple(self):
        prepared = prepare_vision_image(make_two_line_image(), "page.png")
        self.assertEqual(len(prepared), 3)
        self.assertTrue(prepared[0])


if __name__ == "__main__":
    unittest.main()
