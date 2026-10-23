import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import nllb_translate_server as server


class ModelAggregatorTranslationTest(unittest.TestCase):
    def test_long_page_is_chunked_and_busy_gemini_model_falls_back(self):
        source = "[TB-0001] " + "བཀྲ་ཤིས་བདེ་ལེགས། " * 60
        calls = []

        def fake_request(method, url, body, timeout):
            calls.append((body["model"], body["messages"][1]["content"], body["maxTokens"], timeout))
            if body["model"] == "gemini:gemini-3.8-flash":
                raise RuntimeError("request failed: timed out")
            return {"ok": True, "answer": f"中文译文{len(calls)}", "model": "gemini-3.6-flash"}

        with patch.object(server, "request_json", side_effect=fake_request):
            result = server.translate_text_model_aggregator(source, {
                "model": "gemini:gemini-3.8-flash", "max_tokens": 2048,
            })

        self.assertGreater(len(calls), 3)
        self.assertEqual(calls[0][0], "gemini:gemini-3.8-flash")
        self.assertTrue(all(call[0] == "gemini:gemini-3.6-flash" for call in calls[1:]))
        self.assertTrue(all(call[2] >= 4096 for call in calls))
        self.assertLessEqual(calls[0][3], 20)
        self.assertEqual(result["model"], "gemini-3.6-flash")
        self.assertEqual(result["requested_model"], "gemini:gemini-3.8-flash")
        self.assertEqual(result["chunk_count"], len(calls) - 1)
        self.assertIn("中文译文", result["translation"])

    def test_empty_model_answer_is_not_reported_as_success(self):
        with patch.object(server, "request_json", return_value={"ok": True, "answer": ""}):
            with self.assertRaisesRegex(RuntimeError, "空译文"):
                server.translate_text_model_aggregator("བཀྲ་ཤིས།", {"model": "gemini:gemini-3.6-flash"})

    def test_reports_progress_for_each_completed_passage(self):
        updates = []
        source = "བཀྲ་ཤིས་བདེ་ལེགས། " * 55
        with patch.object(server, "request_json", return_value={"ok": True, "answer": "中文", "model": "gemini-3.6-flash"}):
            result = server.translate_text_model_aggregator(source, {
                "model": "gemini:gemini-3.6-flash",
                "_progress": lambda completed, total: updates.append((completed, total)),
            })
        total = result["chunk_count"]
        self.assertEqual(updates, [(completed, total) for completed in range(total + 1)])


if __name__ == "__main__":
    unittest.main()
