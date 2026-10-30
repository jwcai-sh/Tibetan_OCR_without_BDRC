import json
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import oss2
import fitz
from fastapi import HTTPException
from fastapi.testclient import TestClient

from zeabur_app import main


class FakeObject:
    def __init__(self, body):
        self.body = body
        self.offset = 0

    def read(self, size=-1):
        if size < 0:
            chunk = self.body[self.offset:]
            self.offset = len(self.body)
            return chunk
        chunk = self.body[self.offset:self.offset + size]
        self.offset += len(chunk)
        return chunk


class FakeBucket:
    def __init__(self):
        self.objects = {
            "待识别文档/经书/第一册.pdf": b"%PDF-1.4\n",
        }

    def get_object(self, key, byte_range=None):
        if key not in self.objects:
            raise oss2.exceptions.NoSuchKey(404, {}, b"", {})
        body = self.objects[key]
        if byte_range is not None:
            body = body[byte_range[0]:byte_range[1] + 1]
        return FakeObject(body)

    def put_object(self, key, body, headers=None):
        self.objects[key] = body.read() if hasattr(body, "read") else body

    def get_bucket_versioning(self):
        return SimpleNamespace(status="Disabled")

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

    def test_source_supports_byte_ranges_for_fast_pdf_preview(self):
        headers = {"Authorization": "Bearer test-library-password"}
        book = self.client.post("/api/library/open", headers=headers, json={"path": "经书/第一册.pdf"}).json()
        response = self.client.get(f"/api/books/{book['book_id']}/source", headers={**headers, "Range": "bytes=0-4"})
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.content, b"%PDF-")
        self.assertEqual(response.headers["content-range"], "bytes 0-4/9")
        self.assertEqual(response.headers["accept-ranges"], "bytes")

    def test_gemini4_import_is_page_complete_and_keeps_proofreading_state(self):
        book = self.client.post("/api/library/open", headers={"Authorization": "Bearer test-library-password"}, json={"path": "经书/第一册.pdf"}).json()
        book_id = book["book_id"]
        main.write_json(book_id, "state.json", {"page_count": 2, "ocr_results": {"1": {"text": "人工校对"}}})
        endpoint = f"/api/books/{book_id}/model-results/gemini4"
        self.assertEqual(self.client.put(endpoint, json={"pages": {"1": "བོད་"}}).status_code, 400)
        response = self.client.put(endpoint, json={"pages": {"1": "བོད་", "2": "ཡིག་"}})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.client.get(endpoint).json()["pages"]["2"], "ཡིག་")
        self.assertEqual(main.read_json(book_id, "state.json")["ocr_results"]["1"]["text"], "人工校对")

    def test_mobile_pdf_pages_and_text_use_existing_collaboration_auth(self):
        document = fitz.open()
        document.new_page().insert_text((72, 72), "First page")
        document.new_page().insert_text((72, 72), "Second page")
        self.bucket.objects["待识别文档/经书/第一册.pdf"] = document.tobytes()
        document.close()
        book = self.client.post(
            "/api/library/open", headers={"Authorization": "Bearer test-library-password"},
            json={"path": "经书/第一册.pdf"},
        ).json()
        book_id = book["book_id"]
        with patch.object(main.collaboration, "configured", return_value=True), patch.object(
            main.collaboration, "current_actor", side_effect=HTTPException(401, "请登录协作")
        ):
            self.assertEqual(self.client.get(f"/api/books/{book_id}/document-info").status_code, 401)
            self.assertEqual(self.client.get(f"/api/books/{book_id}/pages/2/text").status_code, 401)
        with patch.object(main.collaboration, "configured", return_value=True), patch.object(
            main.collaboration, "current_actor", return_value="msh"
        ):
            info = self.client.get(f"/api/books/{book_id}/document-info")
            text = self.client.get(f"/api/books/{book_id}/pages/2/text")
            preview = self.client.get(f"/api/books/{book_id}/pages/1/preview?dpi=260")
            out_of_range = self.client.get(f"/api/books/{book_id}/pages/3/text")
        self.assertEqual(info.json()["page_count"], 2)
        self.assertEqual(text.json()["text"], "Second page")
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.headers["content-type"], "image/png")
        self.assertEqual(out_of_range.status_code, 400)

    def test_open_rejects_unauthorized_and_path_traversal(self):
        self.assertEqual(self.client.post("/api/library/open", json={"path": "经书/第一册.pdf"}).status_code, 401)
        headers = {"Authorization": "Bearer test-library-password"}
        for path in ("../secret.pdf", "/outside.pdf", "nested/../../secret.pdf", "../books/secret.pdf"):
            self.assertEqual(self.client.post("/api/library/open", headers=headers, json={"path": path}).status_code, 400)
        self.assertEqual(self.client.post("/api/library/open", headers=headers, json={"path": "missing.pdf"}).status_code, 404)

    def test_upload_accepts_text_formats_and_rejects_overwrite(self):
        headers = {"Authorization": "Bearer test-library-password"}
        response = self.client.post(
            "/api/library/upload", headers=headers,
            data={"path": "经书/"}, files={"file": ("校对稿.md", "藏文文本".encode(), "text/markdown")},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["path"], "经书/校对稿.md")
        self.assertEqual(self.bucket.objects["待识别文档/经书/校对稿.md"], "藏文文本".encode())
        duplicate = self.client.post(
            "/api/library/upload", headers=headers,
            data={"path": "经书"}, files={"file": ("校对稿.md", b"replacement", "text/markdown")},
        )
        self.assertEqual(duplicate.status_code, 409)

    def test_upload_rejects_unsupported_names_and_does_not_require_bucket_version_permission(self):
        headers = {"Authorization": "Bearer test-library-password"}
        invalid = self.client.post(
            "/api/library/upload", headers=headers,
            files={"file": ("archive.zip", b"zip", "application/zip")},
        )
        self.assertEqual(invalid.status_code, 400)
        with patch.object(self.bucket, "get_bucket_versioning", side_effect=AssertionError("upload must not require GetBucketVersioning")):
            versioned = self.client.post(
                "/api/library/upload", headers=headers,
                files={"file": ("new.txt", b"text", "text/plain")},
            )
        self.assertEqual(versioned.status_code, 200)
        self.assertEqual(self.bucket.objects["待识别文档/new.txt"], b"text")


if __name__ == "__main__":
    unittest.main()
