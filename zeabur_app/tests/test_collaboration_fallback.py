import unittest
from unittest.mock import patch

from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from zeabur_app import main


class CollaborationFallbackTests(unittest.TestCase):
    @staticmethod
    def request():
        return Request({"type": "http", "headers": []})

    def test_state_falls_back_to_oss_snapshot_when_database_is_unavailable(self):
        snapshot = {"book_id": "book-1", "ocr_results": {"1": {"text": "cached"}}}
        with patch.object(main.collaboration, "configured", return_value=True), \
             patch.object(main.collaboration, "load_state", side_effect=TimeoutError("db timeout")), \
             patch.object(main, "read_json", return_value=snapshot):
            result = main.get_book_state("book-1", self.request())
        self.assertEqual(result["ocr_results"], snapshot["ocr_results"])
        self.assertTrue(result["collaboration_degraded"])
        self.assertIn("page_revisions", result)

    def test_state_reports_503_if_database_and_oss_snapshot_are_both_unavailable(self):
        with patch.object(main.collaboration, "configured", return_value=True), \
             patch.object(main.collaboration, "load_state", side_effect=TimeoutError("db timeout")), \
             patch.object(main, "read_json", side_effect=HTTPException(404, "missing")):
            with self.assertRaises(HTTPException) as error:
                main.get_book_state("book-1", self.request())
        self.assertEqual(error.exception.status_code, 503)

    def test_large_state_uses_gzip_without_changing_the_json_or_pdf_routes(self):
        state = {"book_id": "book-1", "ocr_results": {"1": {"text": "བོད་ཡིག་" * 3000}}, "translation_results": {}}
        with patch.object(main.collaboration, "configured", return_value=False), \
             patch.object(main, "read_json", return_value=state):
            client = TestClient(main.app)
            compressed = client.get("/api/books/book-1/state", headers={"Accept-Encoding": "gzip"})
            plain = client.get("/api/books/book-1/state", headers={"Accept-Encoding": "identity"})
        self.assertEqual(compressed.status_code, 200)
        self.assertEqual(compressed.headers["content-encoding"], "gzip")
        self.assertEqual(compressed.json(), state)
        self.assertLess(int(compressed.headers["content-length"]), len(plain.content))
        self.assertNotIn("content-encoding", plain.headers)


if __name__ == "__main__":
    unittest.main()
