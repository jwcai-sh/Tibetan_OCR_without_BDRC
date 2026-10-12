# Tibetan OCR without BDRC

Standalone server deployment for the Tibetan text proofreading workbench. The server image omits the local BDRC OCR runtime; Gemini Vision recognition, Gemini whole-page review, Qwen whole-page review, and Tibetan-to-Chinese translation remain available.

## Build and deploy

The repository root contains a Dockerfile and `zbpack.json`. Build from the repository root. The service listens on `$PORT` (default 8080). Configure credentials as deployment environment variables; do not commit `.env` files or credentials.

Required storage variables: `OSS_ENDPOINT`, `OSS_BUCKET`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`.

For Gemini Vision, set `AI_VISION_PROVIDER=openai-compatible`, `AI_VISION_BASE_URL`, `AI_VISION_API_KEY`, and `AI_VISION_MODEL`. The toolbar model selector uses the model catalog returned by `/api/review-models`; the selected Gemini model applies to both OCR and full-page review.

For Qwen full-page review, set `QWEN_REVIEW_API_KEY` and `QWEN_REVIEW_BASE_URL`; `QWEN_REVIEW_MODELS` is optional. Translation settings are `TRANSLATE_PROVIDER`, `OPENAI_TRANSLATE_BASE_URL`, `OPENAI_TRANSLATE_API_KEY`, and `OPENAI_TRANSLATE_MODEL`.

The deployment exposes `/health` and serves the workbench at `/tibetan-proofreading-app/`. The BDRC OCR route is disabled and the BDRC server is not part of the image.

## Checks

```bash
node --check tibetan-proofreading-app/app.js
for test_file in tibetan-proofreading-app/tests/*.mjs; do node "$test_file"; done
python3 -m unittest discover -s tibetan-ocr-core/tests -p 'test_*.py'
```
