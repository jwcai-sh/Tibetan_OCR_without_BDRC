FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080
WORKDIR /app
COPY requirements-zeabur.txt .
RUN pip install --no-cache-dir -r requirements-zeabur.txt
COPY tibetan-proofreading-app ./tibetan-proofreading-app
COPY tibetan-ocr-core/ai_vision_ocr_server.py ./tibetan-ocr-core/ai_vision_ocr_server.py
COPY tibetan-translation-services/nllb_translate_server.py ./tibetan-translation-services/nllb_translate_server.py
COPY tibetan_ocr_bridge.py tibetan_translation_bridge.py ./
COPY zeabur_app ./zeabur_app
EXPOSE 8080
CMD ["sh", "-c", "uvicorn zeabur_app.main:app --host 0.0.0.0 --port ${PORT}"]
