import unittest

import torch

from nllb_translate_server import prepare_torchvision_compat


class NllbImportCompatibilityTest(unittest.TestCase):
    def test_prepares_torchvision_namespace_for_transformers_text_models(self):
        prepare_torchvision_compat(torch)
        from transformers import M2M100ForConditionalGeneration

        self.assertIsNotNone(M2M100ForConditionalGeneration)


if __name__ == "__main__":
    unittest.main()
