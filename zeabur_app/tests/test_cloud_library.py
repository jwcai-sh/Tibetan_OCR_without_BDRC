import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import oss2
from fastapi.testclient import TestClient

from zeabur_app import main


class FakeObject:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body


class FakeBucket:
    def __init__(self):
        self.objects = {
            "待识别文档/经书/第一册.pdf": b"%PDF-1.4\n",
        }

    def get_object(self, key):
        if key not in self.objects:
            raise oss2.exceptions.NoSuchKey(404, {}, b"", {})
        return FakeObject(self.objects[key])

    def put_object(self, key, body, headers=None):
        self.objects[key] = body

    def head_object(self, key):
        if key not in self.objects:
            raise oss2.exceptions.NoSuchKey(404, {}, b"", {})
        return SimpleNamespace(content_length=len(self.objects[key]))


class CloudLibraryTest(unittest.TestCase):
    def setUp(self):
        self.bucket = FakeBucket()
        self.client = TestClient(main.app)
        self.bucket_patch = patch.object(main, "oss_bucket", return_value=self.bucket)
        self.password_patch = patch.object(main, "LIBRARY_PASSWORD", "test-library-password")
        self.bucket_patch.start()
        self.password_patch.start()
        self.addCleanup(self.bucket_patch.stop)
        self.addCleanup(self.password_patch.stop)

    def test_listing_requires_password_and_uses_only_library_prefix(self):
        objects = [SimpleNamespace(key="待识别文档/经书/第一册.pdf", size=9,
                                   last_modified=datetime(2026, 10, 12, tzinfo=timezone.utc).timestamp())]
        self.assertEqual(self.client.get("/api/library").status_code, 401)
        with patch.object(main.oss2, "ObjectIterator", return_value=iter(objects)) as iterator:
            response = self.client.get("/api/library", headers={"Authorization": "Bearer test-library-password"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["path"], "经书/第一册.pdf")
        self.assertEqual(iterator.call_args.kwargs["prefix"], "待识别文档/")

    def test_open_reuses_project_and_keeps_source_in_library(self):
        headers = {"Authorization": "Bearer test-library-password"}
        payload = {"path": "经书/第一册.pdf"}
        first = self.client.post("/api/library/open", headers=headers, json=payload)
        second = self.client.post("/api/library/open", headers=headers, json=payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["book_id"], second.json()["book_id"])
        self.assertEqual(first.json()["source_key"], "待识别文档/经书/第一册.pdf")
        book_id = first.json()["book_id"]
        self.assertEqual(self.client.get(f"/api/books/{book_id}/source").content, b"%PDF-1.4\n")
        self.assertEqual(self.client.get(f"/api/books/{book_id}/state").status_code, 200)
        self.assertTrue(any(key.endswith("state.json") for key in self.bucket.objects))

    def test_open_rejects_unauthorized_and_path_traversal(self):
        self.assertEqual(self.client.post("/api/library/open", json={"path": "经书/第一册.pdf"}).status_code, 401)
        headers = {"Authorization": "Bearer test-library-password"}
        for path in ("../secret.pdf", "/outside.pdf", "nested/../../secret.pdf", "../books/secret.pdf"):
            self.assertEqual(self.client.post("/api/library/open", headers=headers, json={"path": path}).status_code, 400)
        self.assertEqual(self.client.post("/api/library/open", headers=headers, json={"path": "missing.pdf"}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
