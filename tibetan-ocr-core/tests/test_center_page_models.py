"""Traditional-page model comparisons use one original page, never row tiles."""
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as server

ROWS = [
    {'index': 0, 'bbox': {'x': .2, 'y': .15, 'width': .6, 'height': .1}},
    {'index': 1, 'bbox': {'x': .2, 'y': .3, 'width': .6, 'height': .1}},
]
TRANSCRIPT = json.dumps({'lines': [
    {'index': 1, 'text': 'གཉིས་'}, {'index': 0, 'text': '༄༅། གཅིག་'}]}, ensure_ascii=False)


class CenterPageModels(unittest.TestCase):
    def test_gemini_uses_original_page_once_and_aligns_returned_rows(self):
        with patch.object(server, 'USE_MODEL_AGGREGATOR', True), \
             patch.object(server, 'post_json', return_value={'ok': True, 'answer': TRANSCRIPT,
                 'modelRef': 'gemini:gemini-2.5-flash', 'finishReason': 'STOP'}) as request, \
             patch.object(server, 'prepare_line_review_images') as crop:
            result = server.call_gemini_page_review(b'original-page', 'page.png', ROWS, 'gemini-2.5-flash')
        self.assertTrue(request.call_args.args[0].endswith('/api/aggregate/chat'))
        body = request.call_args.args[1]
        self.assertEqual(body['model'], 'gemini:gemini-2.5-flash')
        self.assertIn('b3JpZ2luYWwtcGFnZQ==', body['messages'][0]['content'][1]['image_url']['url'])
        self.assertIn('只输出JSON', body['messages'][0]['content'][0]['text'])
        crop.assert_not_called()
        self.assertEqual([row['text'] for row in result['lines']], ['༄༅། གཅིག་', 'གཉིས་'])
        self.assertEqual(result['recognition_scope'], 'whole-page')

    def test_gemini_accepts_fenced_json_but_keeps_old_result_when_row_is_missing(self):
        fenced = '转录如下：\n```json\n' + TRANSCRIPT + '\n```'
        parsed = server.parse_center_page_response(fenced, ROWS)
        self.assertEqual(len(parsed), 2)
        with self.assertRaisesRegex(RuntimeError, '行号不完整'):
            server.parse_center_page_response('{"lines":[{"index":0,"text":"ཀ་"}]}', ROWS)

    def test_gemini_rejects_truncated_chat_response(self):
        with patch.object(server, 'post_json', return_value={'ok': True, 'answer': TRANSCRIPT,
                'modelRef': 'gemini:gemini-2.5-flash', 'finishReason': 'MAX_TOKENS'}):
            with self.assertRaisesRegex(RuntimeError, '未完整结束'):
                server.call_model_aggregator_gemini_page(b'original-page', 'page.png', 'prompt', 'gemini-2.5-flash')

    def test_openai_uses_original_page_once_and_rejects_partial_output(self):
        response = {'status': 'completed', 'model': 'test-model', 'output': [
            {'type': 'message', 'content': [{'type': 'output_text', 'text': TRANSCRIPT}]}]}
        with patch.object(server, 'OPENAI_REVIEW_API_KEY', 'test'), \
             patch.object(server, 'OPENAI_REVIEW_MODEL', 'test-model'), \
             patch.object(server, 'post_json', return_value=response) as request, \
             patch.object(server, 'prepare_line_review_images') as crop:
            result = server.call_openai_page_review(b'original-page', 'page.png', ROWS)
        body = request.call_args.args[1]
        self.assertEqual(request.call_args.args[0], 'https://api.openai.com/v1/responses')
        self.assertIn('b3JpZ2luYWwtcGFnZQ==', body['input'][0]['content'][1]['image_url'])
        self.assertEqual(len(body['input'][0]['content']), 2)
        crop.assert_not_called()
        self.assertEqual(result['lines'][0]['text'], '༄༅། གཅིག་')
        with patch.object(server, 'OPENAI_REVIEW_API_KEY', 'test'), \
             patch.object(server, 'OPENAI_REVIEW_MODEL', 'test-model'), \
             patch.object(server, 'post_json', return_value={'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':'{"lines":[{"index":0,"text":"ཀ་"}]}'}]}]}):
            with self.assertRaisesRegex(RuntimeError, '行号不完整'):
                server.call_openai_page_review(b'original-page', 'page.png', ROWS)


if __name__ == '__main__':
    unittest.main()
