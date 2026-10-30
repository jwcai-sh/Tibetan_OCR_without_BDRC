import threading
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from fastapi.testclient import TestClient
from zeabur_app import main


class LineReviewJobsTest(unittest.TestCase):
    def setUp(self):
        self.actor = 'alice'
        self.release = threading.Event()
        self.started = threading.Event()
        self.calls = []
        self.module = SimpleNamespace(
            GEMINI_REVIEW_MODELS=['gemini-3.8-flash'],
            parse_normalized_bbox=lambda box: {}, normalize_center_page_rows=lambda rows: rows, redact_sensitive=lambda text: text,
        )
        self.patches = [
            patch.object(main.collaboration, 'configured', return_value=True),
            patch.object(main.collaboration, 'current_actor', side_effect=lambda request: self.actor),
            patch.object(main, 'load_ai_ocr_module', return_value=self.module),
            patch.object(main, 'call_ai_line_review', side_effect=self.recognize),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)
        main.line_review_jobs.clear()
        self.client = TestClient(main.app)
        self.addCleanup(self.release.set)

    def recognize(self, *args):
        self.calls.append(args)
        self.started.set()
        self.release.wait(5)
        return {'text': 'བོད་', 'model': 'gemini-3.8-flash', 'raw': 'not exposed'}

    def submit(self, job_id='a' * 32, model='gemini-3.8-flash'):
        return self.client.post('/api/line-review/jobs', files={'file': ('original.png', b'original-full-resolution-bytes', 'image/png')}, data={'job_id': job_id, 'model': model, 'bbox': '{}'})

    def test_async_original_bytes_idempotency_and_owner(self):
        self.assertEqual(self.submit().status_code, 202)
        self.assertTrue(self.started.wait(1))
        self.assertEqual(self.client.get('/api/line-review/jobs/' + 'a' * 32).json()['status'], 'running')
        self.assertEqual(self.submit().status_code, 202)
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(self.calls[0][0], b'original-full-resolution-bytes')
        self.actor = 'bob'
        self.assertEqual(self.client.get('/api/line-review/jobs/' + 'a' * 32).status_code, 404)
        self.assertEqual(self.submit().status_code, 404)
        self.actor = 'alice'
        self.release.set()
        main.line_review_jobs['a' * 32][0].result(2)
        payload = self.client.get('/api/line-review/jobs/' + 'a' * 32).json()
        self.assertEqual(payload, {'status': 'completed', 'result': {'text': 'བོད་', 'model': 'gemini-3.8-flash'}})

    def test_bad_model_never_calls_provider(self):
        self.assertEqual(self.submit(model='different-model').status_code, 400)
        self.assertFalse(self.calls)

    def test_whole_page_gemini_job_uses_selected_model_and_existing_polling(self):
        with patch.object(main, 'whole_page_book_count', return_value=2), \
             patch.object(main, 'run_cloud_gemini_page_recognition', return_value={
                 'text': 'བོད་', 'model': 'gemini:gemini-3.8-flash'}) as recognize:
            response = self.client.post('/api/books/' + 'c' * 32 + '/gemini-recognition-jobs',
                                        json={'page_num': 1, 'model': 'gemini-3.8-flash'})
            self.assertEqual(response.status_code, 202)
            job_id = response.json()['job_id']
            main.line_review_jobs[job_id][0].result(2)
        recognize.assert_called_once_with('c' * 32, 1, 'gemini-3.8-flash')
        self.assertEqual(self.client.get('/api/line-review/jobs/' + job_id).json()['result']['text'], 'བོད་')

    def test_cloud_original_renders_in_worker_without_upload(self):
        render_started = threading.Event()
        render_release = threading.Event()
        def render(*args):
            render_started.set()
            render_release.wait(2)
            return SimpleNamespace(body=b'lossless-original-png')
        with patch.object(main, 'get_book_page_preview', side_effect=render) as renderer:
            response = self.client.post('/api/line-review/jobs', data={
                'job_id':'b'*32, 'book_id':'c'*32, 'page_num':3, 'dpi':260,
                'model':'gemini-3.8-flash', 'bbox':'{}',
            })
            self.assertEqual(response.status_code, 202)
            self.assertTrue(render_started.wait(1))
            self.assertFalse(self.calls)
            render_release.set()
            self.assertTrue(self.started.wait(1))
            self.release.set()
            main.line_review_jobs['b'*32][0].result(2)
            renderer.assert_called_once_with('c'*32, 3, 260, 'png')
            self.assertEqual(self.calls[0][0], b'lossless-original-png')

    def test_cloud_job_recognizes_whole_page_and_returns_lines(self):
        rows = [{'index':0,'bbox':{'x':0,'y':0,'width':1,'height':1}}]
        result = {'text':'བོད་','model':'gemini:gemini-3.8-flash',
                  'lines':[{'index':0,'text':'བོད་'}], 'recognition_scope':'whole-page'}
        import json
        with patch.object(main, 'get_book_page_preview', return_value=SimpleNamespace(body=b'original')) as render, \
             patch.object(main, 'call_ai_page_review', return_value=result) as recognize:
            response = self.client.post('/api/line-review/jobs', data={
                'job_id':'d'*32,'book_id':'c'*32,'page_num':3,'dpi':260,
                'model':'gemini-3.8-flash','bbox':'{}','rows':json.dumps(rows)})
            self.assertEqual(response.status_code,202)
            main.line_review_jobs['d'*32][0].result(2)
            recognize.assert_called_once_with('gemini',b'original','original-page.png',rows,'gemini-3.8-flash')
            self.assertFalse(self.calls, 'Single-row recognition must not be used')
            payload=self.client.get('/api/line-review/jobs/'+'d'*32).json()
            self.assertEqual(payload['result'],result)

    def test_invalid_cloud_reference_never_calls_provider(self):
        response = self.client.post('/api/line-review/jobs', data={
            'job_id':'b'*32, 'book_id':'../other', 'page_num':3,
            'model':'gemini-3.8-flash', 'bbox':'{}',
        })
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.calls)

    def test_failure_is_terminal_not_resubmitted(self):
        with patch.object(main, 'call_ai_line_review', side_effect=RuntimeError('upstream timeout')):
            self.assertEqual(self.submit().status_code, 202)
            try:
                main.line_review_jobs['a' * 32][0].result(2)
            except RuntimeError:
                pass
            for _ in range(2):
                self.assertEqual(self.client.get('/api/line-review/jobs/' + 'a' * 32).json()['status'], 'failed')
            self.assertEqual(self.submit().status_code, 202)
            self.assertEqual(len(main.line_review_jobs), 1)

    def test_capacity_rejects_without_overwriting_jobs(self):
        for i in range(4):
            self.assertEqual(self.submit(f'{i:032x}').status_code, 202)
        self.assertEqual(self.submit('f' * 32).status_code, 429)
        self.release.set()
        for future, _, _ in main.line_review_jobs.values():
            future.result(2)


if __name__ == '__main__':
    unittest.main()
