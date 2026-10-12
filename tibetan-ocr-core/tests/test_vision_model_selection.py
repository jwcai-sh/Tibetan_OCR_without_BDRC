import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as server


class VisionModelSelectionTests(unittest.TestCase):
    def test_ocr_forwards_selected_gemini_model(self):
        model = server.GEMINI_REVIEW_MODELS[0]
        response = {"text": "བོད", "lines": [], "model": model}
        with patch.object(server, "USE_MODEL_AGGREGATOR", False), \
             patch.object(server, "call_openai_compatible_images", return_value=response) as call:
            result = server.call_vision_model(b"page", "page.png", "read", model=model)
        call.assert_called_once_with([(b"page", "page.png")], "read", model_override=model)
        self.assertEqual(result["model"], model)

    def test_ocr_rejects_model_outside_gemini_catalog(self):
        with patch.object(server, "call_openai_compatible_images") as call:
            with self.assertRaisesRegex(RuntimeError, "不在允许列表"):
                server.call_vision_model(b"page", "page.png", "read", model="unknown-model")
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
