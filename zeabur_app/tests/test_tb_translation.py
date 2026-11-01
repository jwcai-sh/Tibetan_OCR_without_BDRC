import hashlib
import json
import time
import unittest
from unittest.mock import patch

import oss2
from fastapi import HTTPException
from fastapi.testclient import TestClient

from zeabur_app import main


BOOK = "1de68f20c97f46a6a645c6a8f05cbc7f"
PREFIX = f"tibetan-proofreading/books/{BOOK}/"
SOURCE = "[TB-0001] ཀ།\n[TB-0002] ཁ།\n"


class FakeObject:
    def __init__(self, body):
        self.body = body

    def read(self, *args):
        return self.body


class FakeBucket:
    def __init__(self):
        self.objects = {PREFIX + "metadata.json": b'{"name":"book.pdf"}', PREFIX + "state.json": b'{"page_count":2}'}

    def get_object(self, key):
        if key not in self.objects:
            raise oss2.exceptions.NoSuchKey(404, {}, b"", {})
        return FakeObject(self.objects[key])

    def put_object(self, key, body, headers=None):
        if headers and headers.get("x-oss-forbid-overwrite") == "true" and key in self.objects:
            raise oss2.exceptions.ObjectAlreadyExists(409, {}, b"", {})
        self.objects[key] = body


class TbTranslationTest(unittest.TestCase):
    def setUp(self):
        self.bucket = FakeBucket()
        self.client = TestClient(main.app)
        self.patch = patch.object(main, "oss_bucket", return_value=self.bucket)
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_attach_source_and_keep_page_state(self):
        response = self.client.put(f"/api/books/{BOOK}/tb/source", json={"name": "book.txt", "text": SOURCE})
        self.assertEqual(response.status_code, 200, response.text)
        digest = hashlib.sha256(SOURCE.encode()).hexdigest()
        self.assertEqual(response.json()["source_hash"], digest)
        self.assertEqual(self.client.get(f"/api/books/{BOOK}/tb/source").json()["text"], SOURCE)
        self.assertEqual(self.bucket.objects[PREFIX + "state.json"], b'{"page_count":2}')
        self.assertEqual(self.client.put(f"/api/books/{BOOK}/tb/source", json={"name": "other.txt", "text": "[TB-0001] ག།"}).status_code, 409)

    def test_model_and_final_results_are_isolated(self):
        self.client.put(f"/api/books/{BOOK}/tb/source", json={"name": "book.txt", "text": SOURCE})
        digest = hashlib.sha256(SOURCE.encode()).hexdigest()
        url = f"/api/books/{BOOK}/tb/results/TB-0001"
        self.assertEqual(self.client.put(url, json={"source_hash": digest, "kind": "model", "model": "gemini:a", "text": "甲"}).status_code, 200)
        self.assertEqual(self.client.put(url, json={"source_hash": digest, "kind": "model", "model": "gemini:b", "text": "乙"}).status_code, 200)
        self.assertEqual(self.client.put(url, json={"source_hash": digest, "kind": "final", "text": "定稿"}).status_code, 200)
        result = self.client.get(f"/api/books/{BOOK}/tb/results?ids=TB-0001,TB-0002&source_hash={digest}&models=gemini:a,gemini:b")
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()["records"]["TB-0001"]["models"]["gemini:a"]["text"], "甲")
        self.assertEqual(result.json()["records"]["TB-0001"]["models"]["gemini:b"]["text"], "乙")
        self.assertEqual(result.json()["records"]["TB-0001"]["final"], "定稿")
        self.assertEqual(self.client.put(url, json={"source_hash": "wrong", "kind": "final", "text": "x"}).status_code, 409)
        self.assertEqual(self.client.put(f"/api/books/{BOOK}/tb/results/TB-9999", json={"source_hash": digest, "kind": "final", "text": "x"}).status_code, 400)

    def test_rejects_bad_ids_and_bad_source(self):
        self.assertEqual(self.client.put(f"/api/books/{BOOK}/tb/source", json={"name": "x.txt", "text": "not numbered"}).status_code, 400)
        self.assertEqual(self.client.put(f"/api/books/../tb/source", json={"name": "x.txt", "text": SOURCE}).status_code, 404)
        self.assertEqual(self.client.get(f"/api/books/{BOOK}/tb/source").status_code, 404)

    def test_collaboration_login_protects_tb_routes(self):
        with patch.object(main.collaboration, "configured", return_value=True), patch.object(
            main.collaboration, "current_actor", side_effect=HTTPException(401, "登录已失效")
        ):
            self.assertEqual(self.client.get(f"/api/books/{BOOK}/tb/source").status_code, 401)
            self.assertEqual(self.client.put(f"/api/books/{BOOK}/tb/source", json={"name": "x.txt", "text": SOURCE}).status_code, 401)

    def test_translation_job_returns_selected_model_result(self):
        with patch.object(main, "call_translation", side_effect=lambda payload: {"translation": "甲", "model": payload["model"]}):
            queued = self.client.post("/api/translate", json={"text": "ཀ།", "model": "gemini:a"})
            self.assertEqual(queued.status_code, 202, queued.text)
            result = self.client.get(queued.json()["status_url"])
            for _ in range(20):
                if result.json().get("status") != "running":
                    break
                time.sleep(0.01)
                result = self.client.get(queued.json()["status_url"])
            self.assertEqual(result.json()["translation"], "甲")
            self.assertEqual(result.json()["model"], "gemini:a")
