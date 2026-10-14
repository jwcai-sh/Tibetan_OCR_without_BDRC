import unittest
from unittest.mock import patch

from fastapi import HTTPException

from zeabur_app import main


class CollaborationFallbackTests(unittest.TestCase):
    def test_state_falls_back_to_oss_snapshot_when_database_is_unavailable(self):
        snapshot = {"book_id": "book-1", "ocr_results": {"1": {"text": "cached"}}}
        with patch.object(main.collaboration, "configured", return_value=True), \
             patch.object(main.collaboration, "load_state", side_effect=TimeoutError("db timeout")), \
             patch.object(main, "read_json", return_value=snapshot):
            result = main.get_book_state("book-1")
        self.assertEqual(result["ocr_results"], snapshot["ocr_results"])
        self.assertTrue(result["collaboration_degraded"])
        self.assertIn("page_revisions", result)

    def test_state_reports_503_if_database_and_oss_snapshot_are_both_unavailable(self):
        with patch.object(main.collaboration, "configured", return_value=True), \
             patch.object(main.collaboration, "load_state", side_effect=TimeoutError("db timeout")), \
             patch.object(main, "read_json", side_effect=HTTPException(404, "missing")):
            with self.assertRaises(HTTPException) as error:
                main.get_book_state("book-1")
        self.assertEqual(error.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
