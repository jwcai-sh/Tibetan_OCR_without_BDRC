import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import ai_vision_ocr_server as server

def test_missing_config_never_calls_upstream():
    with patch.object(server, 'OPENAI_REVIEW_API_KEY', ''), patch.object(server, 'post_json') as request:
        try:
            server.call_openai_line_review(b'', 'test.png', {})
        except RuntimeError as error:
            assert '未配置' in str(error)
        else:
            raise AssertionError('missing credentials must fail')
        request.assert_not_called()

def test_openai_routes_independently_and_returns_candidate():
    with patch.object(server, 'OPENAI_REVIEW_API_KEY', 'test'), patch.object(server, 'OPENAI_REVIEW_MODEL', 'test-model'), patch.object(server, 'prepare_line_review_images') as crop, patch.object(server, 'post_json', return_value={'status':'completed','model':'test-model','output':[{'type':'message','content':[{'type':'output_text','text':'བོད་'}]}]}) as request:
        result = server.call_openai_line_review(b'image', 'test.png', {})
        assert result['text'] == 'བོད་'
        assert result['provider'] == 'openai'
        url, body, _ = request.call_args.args
        assert url == 'https://api.openai.com/v1/responses'
        assert body['store'] is False
        assert body['input'][0]['content'][1]['detail'] == 'high'
        assert body['input'][0]['content'][1]['image_url'].endswith(',') is False
        crop.assert_not_called()

def test_whole_page_recognition_uses_original_image_and_plain_text():
    response = {'status': 'completed', 'model': 'test-model', 'output': [
        {'type': 'message', 'content': [{'type': 'output_text', 'text': 'ཀ་\nཁ་'}]}
    ]}
    with patch.object(server, 'OPENAI_REVIEW_API_KEY', 'test'), \
         patch.object(server, 'OPENAI_REVIEW_MODEL', 'test-model'), \
         patch.object(server, 'post_json', return_value=response) as request:
        result = server.call_openai_whole_page_recognition(b'original-png', 'page.png', 'transcribe')
    assert result['text'] == 'ཀ་\nཁ་'
    assert result['model'] == 'openai:test-model'
    url, body, key = request.call_args.args
    assert (url, key) == ('https://api.openai.com/v1/responses', 'test')
    assert body['store'] is False
    assert body['input'][0]['content'][0]['text'] == 'transcribe'
    assert body['input'][0]['content'][1]['image_url'].startswith('data:image/png;base64,')

def test_whole_page_recognition_rejects_incomplete_response():
    with patch.object(server, 'OPENAI_REVIEW_API_KEY', 'test'), \
         patch.object(server, 'OPENAI_REVIEW_MODEL', 'test-model'), \
         patch.object(server, 'post_json', return_value={'status': 'incomplete', 'output': []}):
        try:
            server.call_openai_whole_page_recognition(b'image', 'page.png', 'transcribe')
        except RuntimeError as error:
            assert '未返回完整' in str(error)
        else:
            raise AssertionError('incomplete output must not be saved')

def test_astra_whole_page_preserves_original_image_detail():
    response = {'status': 'completed', 'output': [
        {'type': 'message', 'content': [{'type': 'output_text', 'text': 'བོད་'}]}
    ]}
    with patch.object(server, 'OPENAI_REVIEW_API_KEY', 'test'), \
         patch.object(server, 'OPENAI_REVIEW_MODEL', 'gpt-6-astra'), \
         patch.object(server, 'post_json', return_value=response) as request:
        server.call_openai_whole_page_recognition(b'image', 'page.png', 'transcribe')
    assert request.call_args.args[1]['input'][0]['content'][1]['detail'] == 'original'

if __name__ == '__main__':
    test_missing_config_never_calls_upstream()
    test_openai_routes_independently_and_returns_candidate()
    test_whole_page_recognition_uses_original_image_and_plain_text()
    test_whole_page_recognition_rejects_incomplete_response()
    test_astra_whole_page_preserves_original_image_detail()
    print('OpenAI routing/configuration tests passed')
