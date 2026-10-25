import unittest
from unittest.mock import patch
from types import SimpleNamespace
from fastapi.testclient import TestClient
from zeabur_app import main

class PreviewReferenceTests(unittest.TestCase):
    def test_cloud_reference_no_upload_and_no_state_write(self):
        with patch.object(main.collaboration, 'configured', return_value=True), patch.object(main.collaboration, 'current_actor', return_value='alice'), patch.object(main,'get_book_page_preview',return_value=SimpleNamespace(body=b'page-jpeg')) as render, patch.object(main,'call_ai_line_preview',return_value={'images':['preview']}) as crop:
            response=TestClient(main.app).post('/api/line-preview',data={'book_id':'a'*32,'page_num':4,'dpi':260,'bbox':'{}'})
            self.assertEqual(response.status_code,200)
            render.assert_called_once_with('a'*32,4,260,'jpeg')
            self.assertEqual(crop.call_args.args[0],b'page-jpeg')
    def test_mismatch_retries_without_upload(self):
        with patch.object(main,'call_ai_line_preview',side_effect=[RuntimeError('原文物理行数与识别 block 数不一致'),{'review_image':{'source_bbox':{'physical_row_index':0}}}]) as crop:
            result=main.render_line_preview(b'original','{}','','0','1','jpeg')
            self.assertTrue(result['approximateRowMatch'])
            self.assertEqual(crop.call_args.args[3:5],('',''))
    def test_unrelated_failure_not_retried(self):
        with patch.object(main,'call_ai_line_preview',side_effect=RuntimeError('bad image')) as crop:
            with self.assertRaises(RuntimeError): main.render_line_preview(b'x','{}','','0','1','jpeg')
            self.assertEqual(crop.call_count,1)
