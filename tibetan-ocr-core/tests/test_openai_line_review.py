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
        result = server.call_openai_line_review(b'', 'test.png', {})
        assert result['text'] == 'བོད་'
        assert result['provider'] == 'openai'
        url, body, _ = request.call_args.args
        assert url == 'https://api.openai.com/v1/responses'
        assert body['store'] is False
        assert body['input'][0]['content'][1]['detail'] == 'high'
        assert body['input'][0]['content'][1]['image_url'].endswith(',') is False
        crop.assert_not_called()

if __name__ == '__main__':
    test_missing_config_never_calls_upstream()
    test_openai_routes_independently_and_returns_candidate()
    print('OpenAI routing/configuration tests passed')
