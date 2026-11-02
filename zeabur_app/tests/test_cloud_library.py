import json
import io
import struct
import hashlib
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from threading import Event
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

import oss2
import fitz
from PIL import Image
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
        return SimpleNamespace(content_length=len(self.objects[key]), etag=hashlib.md5(self.objects[key]).hexdigest())

    def delete_object(self, key):
        self.objects.pop(key, None)


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

    def delete_payload(self, path="经书/第一册.pdf"):
        body = self.bucket.objects[f"待识别文档/{path}"]
        return {"path": path, "size": len(body), "etag": hashlib.md5(body).hexdigest()}

    def test_whole_page_uses_pdf_count_and_rotates_tall_preview_on_request(self):
        document = fitz.open()
        page = document.new_page(width=100, height=500)
        page.draw_rect(fitz.Rect(5, 5, 25, 45), color=(1, 0, 0), fill=(1, 0, 0))
        pdf = document.tobytes()
        document.close()
        book = self.client.post("/api/library/open", headers={"Authorization": "Bearer test-library-password"}, json={"path": "经书/第一册.pdf"}).json()
        book_id = book["book_id"]
        self.assertEqual(main.read_json(book_id, "state.json")["page_count"], 0)
        main._cached_pdf_page_preview.cache_clear()
        with patch.object(main, "cached_pdf_source", return_value=pdf):
            self.assertEqual(main.whole_page_book_count(book_id), 1)
            self.assertEqual(self.client.get(f"/api/books/{book_id}/whole-page-proofread/1").status_code, 200)
            self.assertEqual(self.client.put(f"/api/books/{book_id}/whole-page-proofread/1", json={"text": "བོད་"}).status_code, 200)
            portrait = self.client.get(f"/api/books/{book_id}/pages/1/preview?dpi=100&format=png")
            landscape = self.client.get(f"/api/books/{book_id}/pages/1/preview?dpi=100&format=png&landscape=true")
            quarter_turn = self.client.get(f"/api/books/{book_id}/pages/1/preview?dpi=100&format=png&landscape=true&rotation=90")
            half_turn = self.client.get(f"/api/books/{book_id}/pages/1/preview?dpi=100&format=png&landscape=true&rotation=180")
            invalid_turn = self.client.get(f"/api/books/{book_id}/pages/1/preview?rotation=45")
        self.assertEqual((portrait.status_code, landscape.status_code, quarter_turn.status_code, half_turn.status_code, invalid_turn.status_code), (200, 200, 200, 200, 400))
        pw, ph = struct.unpack(">II", portrait.content[16:24])
        lw, lh = struct.unpack(">II", landscape.content[16:24])
        qw, qh = struct.unpack(">II", quarter_turn.content[16:24])
        hw, hh = struct.unpack(">II", half_turn.content[16:24])
        self.assertLess(pw, ph)
        self.assertGreater(lw, lh)
        self.assertLess(qw, qh)
        self.assertEqual((hw, hh), (lw, lh))
        def marker_center(content):
            image = Image.open(io.BytesIO(content)).convert("RGB")
            pixels = image.load()
            points = [(x, y) for y in range(image.height) for x in range(image.width)
                      if pixels[x, y][0] > 180 and pixels[x, y][1] < 100 and pixels[x, y][2] < 100]
            self.assertTrue(points)
            return sum(x for x, _ in points) / len(points), sum(y for _, y in points) / len(points)
        before_x, before_y = marker_center(landscape.content)
        after_x, after_y = marker_center(half_turn.content)
        self.assertGreater(abs(before_x - after_x), lw / 2)
        self.assertAlmostEqual(before_x + after_x, lw, delta=lw * 0.05)
        self.assertAlmostEqual(before_y + after_y, lh, delta=lh * 0.1)

    def test_listing_requires_password_and_uses_only_library_prefix(self):
        objects = [SimpleNamespace(key="待识别文档/经书/第一册.pdf", size=9, etag="old-etag",
                                   last_modified=datetime(2026, 10, 12, tzinfo=timezone.utc).timestamp())]
        self.assertEqual(self.client.get("/api/library").status_code, 401)
        with patch.object(main.oss2, "ObjectIterator", return_value=iter(objects)) as iterator:
            response = self.client.get("/api/library", headers={"Authorization": "Bearer test-library-password"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["items"][0]["path"], "经书/第一册.pdf")
        self.assertEqual(response.json()["items"][0]["etag"], "old-etag")
        self.assertEqual(iterator.call_args.kwargs["prefix"], "待识别文档/")

    def test_delete_requires_access_and_removes_only_the_selected_library_file(self):
        self.bucket.objects["待识别文档/经书/保留.pdf"] = b"keep"
        self.bucket.objects["tibetan-proofreading/books/keep/state.json"] = b"{}"
        url = "/api/library/file"
        payload = self.delete_payload()
        self.assertEqual(self.client.request("DELETE", url, json=payload).status_code, 401)
        response = self.client.request("DELETE", url, headers={"Authorization": "Bearer test-library-password"}, json=payload)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["path"], "经书/第一册.pdf")
        self.assertNotIn("待识别文档/经书/第一册.pdf", self.bucket.objects)
        self.assertIn("待识别文档/经书/保留.pdf", self.bucket.objects)
        self.assertIn("tibetan-proofreading/books/keep/state.json", self.bucket.objects)

    def test_delete_allows_local_workbench_cors_preflight(self):
        response = self.client.options("/api/library/file", headers={
            "Origin": "http://127.0.0.1:8790",
            "Access-Control-Request-Method": "DELETE",
            "Access-Control-Request-Headers": "authorization,content-type",
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["access-control-allow-origin"], "http://127.0.0.1:8790")
        self.assertIn("DELETE", response.headers["access-control-allow-methods"])

    def test_delete_rejects_invalid_missing_or_changed_file(self):
        url = "/api/library/file"
        headers = {"Authorization": "Bearer test-library-password"}
        for path in ("../books/state.json", "/经书/第一册.pdf", "经书/../第一册.pdf"):
            self.assertEqual(self.client.request("DELETE", url, headers=headers, json={"path": path, "size": 9, "etag": "old-etag"}).status_code, 400)
        self.assertEqual(self.client.request("DELETE", url, headers=headers, json={"path": "经书/没有.pdf", "size": 9, "etag": "old-etag"}).status_code, 404)
        self.assertEqual(self.client.request("DELETE", url, headers=headers, json={**self.delete_payload(), "size": 8}).status_code, 409)
        self.assertIn("待识别文档/经书/第一册.pdf", self.bucket.objects)

    def test_delete_rejects_stale_etag_even_when_new_file_has_same_size(self):
        old = self.delete_payload()
        self.bucket.objects["待识别文档/经书/第一册.pdf"] = b"new-file!"
        response = self.client.request("DELETE", "/api/library/file", headers={"Authorization": "Bearer test-library-password"}, json=old)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.bucket.objects["待识别文档/经书/第一册.pdf"], b"new-file!")

    def test_delete_reports_oss_failure_without_exposing_details(self):
        with patch.object(self.bucket, "delete_object", side_effect=RuntimeError("secret-internal-detail")):
            response = self.client.request("DELETE", "/api/library/file", headers={"Authorization": "Bearer test-library-password"}, json=self.delete_payload())
        self.assertEqual(response.status_code, 502)
        self.assertIn("删除", response.json()["detail"])
        self.assertNotIn("secret-internal-detail", response.text)
        self.assertIn("待识别文档/经书/第一册.pdf", self.bucket.objects)

    def test_delete_invalidates_cached_page_preview(self):
        document = fitz.open()
        document.new_page(width=100, height=100)
        content = document.tobytes()
        document.close()
        self.bucket.objects["待识别文档/经书/第一册.pdf"] = content
        main.cached_pdf_source.cache_clear()
        main._cached_pdf_page_preview.cache_clear()
        headers = {"Authorization": "Bearer test-library-password"}
        book_id = self.client.post("/api/library/open", headers=headers, json={"path": "经书/第一册.pdf"}).json()["book_id"]
        preview_url = f"/api/books/{book_id}/pages/1/preview?dpi=72"
        self.assertEqual(self.client.get(preview_url).status_code, 200)
        self.assertEqual(self.client.request("DELETE", "/api/library/file", headers=headers, json=self.delete_payload()).status_code, 200)
        self.assertEqual(self.client.get(preview_url).status_code, 404)

    def test_reupload_after_delete_creates_a_new_project_without_erasing_old_state(self):
        headers = {"Authorization": "Bearer test-library-password"}
        path = "经书/第一册.pdf"
        first = self.client.post("/api/library/open", headers=headers, json={"path": path}).json()
        main.write_json(first["book_id"], "state.json", {"page_count": 1, "ocr_results": {"1": {"text": "旧校对"}}})
        self.assertEqual(self.client.request("DELETE", "/api/library/file", headers=headers, json=self.delete_payload()).status_code, 200)
        uploaded = self.client.post("/api/library/upload", headers=headers, files={"file": ("第一册.pdf", b"%PDF-new-version", "application/pdf")}, data={"path": "经书"})
        self.assertEqual(uploaded.status_code, 200, uploaded.text)
        second = self.client.post("/api/library/open", headers=headers, json={"path": path}).json()
        self.assertNotEqual(second["book_id"], first["book_id"])
        self.assertEqual(second["size"], len(b"%PDF-new-version"))
        self.assertEqual(main.read_json(first["book_id"], "state.json")["ocr_results"]["1"]["text"], "旧校对")

    def test_upload_waits_for_inflight_delete_before_reusing_same_path(self):
        headers = {"Authorization": "Bearer test-library-password"}
        source_key = "待识别文档/经书/第一册.pdf"
        entered = Event()
        release = Event()
        real_delete = self.bucket.delete_object

        def delayed_delete(key):
            if key == source_key:
                entered.set()
                if not release.wait(3):
                    raise TimeoutError("test did not release deletion")
            return real_delete(key)

        with patch.object(self.bucket, "delete_object", side_effect=delayed_delete), ThreadPoolExecutor(max_workers=2) as executor:
            deleting = executor.submit(lambda: TestClient(main.app).request("DELETE", "/api/library/file", headers=headers, json=self.delete_payload()))
            self.assertTrue(entered.wait(2))
            uploading = executor.submit(lambda: TestClient(main.app).post("/api/library/upload", headers=headers, files={"file": ("第一册.pdf", b"new-file!", "application/pdf")}, data={"path": "经书"}))
            try:
                with self.assertRaises(FutureTimeout):
                    uploading.result(timeout=0.2)
            finally:
                release.set()
            self.assertEqual(deleting.result(timeout=3).status_code, 200)
            self.assertEqual(uploading.result(timeout=3).status_code, 200)
        self.assertEqual(self.bucket.objects[source_key], b"new-file!")

    def test_disabled_oss_account_is_reported_in_directory(self):
        error = oss2.exceptions.ServerError(403, {"x-oss-request-id": "test-request"}, b"", {
            "Code": "UserDisable", "RequestId": "test-request",
        })
        with patch.object(main.oss2, "ObjectIterator", side_effect=error):
            response = self.client.get("/api/library", headers={"Authorization": "Bearer test-library-password"})
        self.assertEqual(response.status_code, 502)
        self.assertIn("OSS 账号被禁用", response.json()["detail"])
        self.assertIn("test-request", response.json()["detail"])

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

    def test_whole_page_candidates_and_corrected_page_are_isolated(self):
        book = self.client.post("/api/library/open", headers={"Authorization": "Bearer test-library-password"}, json={"path": "经书/第一册.pdf"}).json()
        book_id = book["book_id"]
        main.write_json(book_id, "state.json", {"page_count": 2, "ocr_results": {"1": {"text": "原工作台校对"}}})
        base = f"/api/books/{book_id}"
        self.assertEqual(self.client.put(f"{base}/model-results/teacher", json={"pages": {"1": "ཀ་"}}).status_code, 400)
        self.assertEqual(self.client.put(f"{base}/model-results/teacher", json={"pages": {"1": "ཀ་", "2": "ཁ་"}}).status_code, 200)
        self.assertEqual(self.client.put(f"{base}/model-results/yigdzin1", json={"pages": {"1": "ཀ་", "2": ""}}).status_code, 200)
        self.assertEqual(self.client.get(f"{base}/model-results/teacher").json()["pages"]["2"], "ཁ་")
        self.assertEqual(self.client.get(f"{base}/model-results/yigdzin1").json()["pages"]["2"], "")
        self.assertEqual(self.client.put(f"{base}/whole-page-proofread/1", json={"text": "ཀ་ག"}).status_code, 200)
        self.assertEqual(self.client.get(f"{base}/whole-page-proofread/1").json()["text"], "ཀ་ག")
        self.assertEqual(self.client.get(f"{base}/whole-page-proofread/2").json()["text"], "")
        self.assertEqual(main.read_json(book_id, "state.json")["ocr_results"]["1"]["text"], "原工作台校对")

    def test_single_gemini_recognition_updates_only_its_page_and_model(self):
        book = self.client.post("/api/library/open", headers={"Authorization": "Bearer test-library-password"}, json={"path": "经书/第一册.pdf"}).json()
        book_id = book["book_id"]
        main.write_json(book_id, "state.json", {"page_count": 2, "ocr_results": {"1": {"text": "原校对"}}})
        main.write_json(book_id, "model-results/gemini4.json", {"model": "Gemini 4", "pages": {"1": "旧一页", "2": "旧二页"}})
        endpoint = f"/api/books/{book_id}/model-results/gemini4/pages/1"
        with patch.object(main, "load_ai_ocr_module", return_value=SimpleNamespace(GEMINI_REVIEW_MODELS=["gemini-3.8-flash"])):
            self.assertEqual(self.client.put(endpoint, json={"text": "", "model": "gemini:gemini-3.8-flash"}).status_code, 400)
            result = self.client.put(endpoint, json={"text": "བོད་", "model": "gemini:gemini-3.8-flash"})
        self.assertEqual(result.status_code, 200, result.text)
        saved = self.client.get(f"/api/books/{book_id}/model-results/gemini4").json()
        self.assertEqual(saved["pages"], {"1": "བོད་", "2": "旧二页"})
        self.assertEqual(saved["page_models"]["1"], "gemini:gemini-3.8-flash")
        self.assertEqual(main.read_json(book_id, "state.json")["ocr_results"]["1"]["text"], "原校对")

    def test_single_openai_recognition_preserves_gemini_and_corrected_text(self):
        book = self.client.post("/api/library/open", headers={"Authorization": "Bearer test-library-password"}, json={"path": "经书/第一册.pdf"}).json()
        book_id = book["book_id"]
        main.write_json(book_id, "state.json", {"page_count": 2})
        main.write_json(book_id, "model-results/gemini4.json", {"model": "Gemini 4", "pages": {"1": "Gemini 原文"}})
        main.write_json(book_id, "whole-page-proofread/1.json", {"page_num": 1, "text": "人工正确版", "saved": True})
        endpoint = f"/api/books/{book_id}/model-results/openai/pages/1"
        with patch.object(main, "load_ai_ocr_module", return_value=SimpleNamespace(OPENAI_REVIEW_MODEL="test-model")):
            self.assertEqual(self.client.put(endpoint, json={"text": "错误", "model": "openai:other"}).status_code, 400)
            response = self.client.put(endpoint, json={"text": "བོད་", "model": "openai:test-model"})
        self.assertEqual(response.status_code, 200, response.text)
        saved = self.client.get(f"/api/books/{book_id}/model-results/openai").json()
        self.assertEqual(saved["pages"], {"1": "བོད་"})
        self.assertEqual(saved["page_models"]["1"], "openai:test-model")
        self.assertEqual(self.client.get(f"/api/books/{book_id}/model-results/gemini4").json()["pages"]["1"], "Gemini 原文")
        self.assertEqual(self.client.get(f"/api/books/{book_id}/whole-page-proofread/1").json()["text"], "人工正确版")

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
