#!/usr/bin/env python3
"""Small local HTTP wrapper for open-source Tibetan-to-Chinese translation.

Default model: facebook/nllb-200-distilled-600M

Endpoints:

- GET /health
- POST /translate with JSON field "text"
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


HOST = os.environ.get("NLLB_TRANSLATE_HOST", "127.0.0.1")
PORT = int(os.environ.get("NLLB_TRANSLATE_PORT", "18091"))
TRANSLATE_PROVIDER = os.environ.get("TRANSLATE_PROVIDER", "local_nllb")
MODEL_ID = os.environ.get("HF_MODEL") or os.environ.get("NLLB_MODEL", "facebook/nllb-200-distilled-600M")
SRC_LANG = os.environ.get("NLLB_SRC_LANG", "bod_Tibt")
TGT_LANG = os.environ.get("NLLB_TGT_LANG", "zho_Hans")
MAX_INPUT_TOKENS = int(os.environ.get("NLLB_MAX_INPUT_TOKENS", "512"))
MAX_NEW_TOKENS = int(os.environ.get("NLLB_MAX_NEW_TOKENS", "256"))
BATCH_SIZE = int(os.environ.get("NLLB_BATCH_SIZE", "4"))
DEVICE = os.environ.get("NLLB_DEVICE", "auto")
HF_TOKEN = os.environ.get("HF_TOKEN", "")
HF_API_URL = os.environ.get("HF_API_URL", f"https://api-inference.huggingface.co/models/{MODEL_ID}")
MODEL_AGGREGATOR_BASE_URL = os.environ.get("MODEL_AGGREGATOR_BASE_URL", "http://127.0.0.1:8890").rstrip("/")
MODEL_AGGREGATOR_MODEL = os.environ.get("MODEL_AGGREGATOR_MODEL", "local:qwen3.6-27b:latest")
MODEL_AGGREGATOR_TIMEOUT_SECONDS = float(os.environ.get("MODEL_AGGREGATOR_TIMEOUT_SECONDS", "120"))
OPENAI_TRANSLATE_BASE_URL = os.environ.get("OPENAI_TRANSLATE_BASE_URL", "").rstrip("/")
OPENAI_TRANSLATE_API_KEY = os.environ.get("OPENAI_TRANSLATE_API_KEY", "")
OPENAI_TRANSLATE_MODEL = os.environ.get("OPENAI_TRANSLATE_MODEL", "")
DEFAULT_ROLE_NAME = "学术直译"
DEFAULT_SYSTEM_PROMPT = (
    "你是严谨的学术翻译助手。请忠实翻译原文，保持术语稳定，"
    "不要添加原文没有的信息；遇到专名、术语和不确定处应尽量保留可追溯表达。"
)
DEFAULT_USER_PROMPT_TEMPLATE = (
    "请将以下{source_lang}文本翻译为{target_lang}。\n"
    "要求：忠实原文，术语前后一致，少发挥；只输出译文。\n\n"
    "来源：{source_name}\n"
    "页码：{page}\n\n"
    "原文：\n{source_text}"
)

_model_lock = threading.Lock()
_model_bundle: dict[str, Any] | None = None
_model_status: dict[str, Any] = {
    "status": "idle",
    "error": "",
    "started_at": None,
    "ready_at": None,
}
_preload_thread: threading.Thread | None = None
_torchvision_compat_library: Any = None


def prepare_torchvision_compat(torch_module: Any) -> None:
    """Register the text-model-only torchvision operator before Transformers imports it."""
    global _torchvision_compat_library
    if _torchvision_compat_library is not None:
        return

    library_api = getattr(torch_module, "library", None)
    if library_api is None:
        return

    try:
        library = library_api.Library("torchvision", "DEF")
        library.define("nms(Tensor dets, Tensor scores, float iou_threshold) -> Tensor")
        _torchvision_compat_library = library
    except RuntimeError:
        # A working torchvision build may already define this operator.
        _torchvision_compat_library = True


def choose_device(torch_module: Any) -> str:
    if DEVICE != "auto":
        return DEVICE
    if torch_module.cuda.is_available():
        return "cuda"
    if getattr(torch_module.backends, "mps", None) and torch_module.backends.mps.is_available():
        return "mps"
    return "cpu"


def get_model_bundle() -> dict[str, Any]:
    global _model_bundle
    if _model_bundle is not None:
        return _model_bundle

    with _model_lock:
        if _model_bundle is not None:
            return _model_bundle

        _model_status.update({
            "status": "loading",
            "error": "",
            "started_at": _model_status.get("started_at") or time.time(),
            "ready_at": None,
        })

        try:
            import torch
            prepare_torchvision_compat(torch)
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        except ImportError as exc:
            raise RuntimeError(
                "Missing translation dependencies. Install with: "
                "python3 -m pip install -r tibetan-translation-services/requirements-translate.txt"
            ) from exc

        tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, src_lang=SRC_LANG)
        model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
        device = choose_device(torch)
        model.to(device)
        model.eval()

        _model_bundle = {
            "torch": torch,
            "tokenizer": tokenizer,
            "model": model,
            "device": device,
        }
        _model_status.update({
            "status": "ready",
            "error": "",
            "ready_at": time.time(),
        })
        return _model_bundle


def preload_model_async() -> None:
    global _preload_thread
    if _model_bundle is not None:
        return
    if _preload_thread and _preload_thread.is_alive():
        return

    def worker() -> None:
        try:
            get_model_bundle()
        except Exception as exc:
            _model_status.update({
                "status": "error",
                "error": str(exc),
                "ready_at": None,
            })
            sys.stderr.write(f"Model preload failed: {exc}\n")

    _model_status.update({
        "status": "loading",
        "error": "",
        "started_at": time.time(),
        "ready_at": None,
    })
    _preload_thread = threading.Thread(target=worker, name="nllb-preload", daemon=True)
    _preload_thread.start()


def model_health_payload() -> dict[str, Any]:
    if TRANSLATE_PROVIDER == "model_aggregator":
        return model_aggregator_health_payload()

    if TRANSLATE_PROVIDER == "openai_compatible":
        configured = bool(OPENAI_TRANSLATE_BASE_URL and OPENAI_TRANSLATE_API_KEY and OPENAI_TRANSLATE_MODEL)
        return {
            "ok": configured,
            "status": "ready" if configured else "error",
            "provider": TRANSLATE_PROVIDER,
            "model": OPENAI_TRANSLATE_MODEL,
            "loaded": configured,
            "error": "" if configured else "OPENAI_TRANSLATE_BASE_URL/API_KEY/MODEL are required",
        }

    if TRANSLATE_PROVIDER == "huggingface_nllb":
        return {
            "ok": bool(HF_TOKEN),
            "status": "ready" if HF_TOKEN else "error",
            "provider": TRANSLATE_PROVIDER,
            "model": MODEL_ID,
            "src_lang": SRC_LANG,
            "tgt_lang": TGT_LANG,
            "loaded": True,
            "error": "" if HF_TOKEN else "HF_TOKEN is required for huggingface_nllb",
            "started_at": _model_status.get("started_at"),
            "ready_at": _model_status.get("ready_at") or time.time(),
        }

    status = "ready" if _model_bundle is not None else _model_status["status"]
    return {
        "ok": status != "error",
        "status": status,
        "provider": TRANSLATE_PROVIDER,
        "model": MODEL_ID,
        "src_lang": SRC_LANG,
        "tgt_lang": TGT_LANG,
        "loaded": _model_bundle is not None,
        "error": _model_status.get("error") or "",
        "started_at": _model_status.get("started_at"),
        "ready_at": _model_status.get("ready_at"),
    }


def model_aggregator_health_payload() -> dict[str, Any]:
    health_url = f"{MODEL_AGGREGATOR_BASE_URL}/api/aggregate/health"
    config_url = f"{MODEL_AGGREGATOR_BASE_URL}/api/aggregate/config"
    try:
        health = request_json("GET", health_url, timeout=min(10, MODEL_AGGREGATOR_TIMEOUT_SECONDS))
        config: dict[str, Any] = {}
        try:
            config = request_json("GET", config_url, timeout=min(10, MODEL_AGGREGATOR_TIMEOUT_SECONDS))
        except Exception as exc:
            config = {"error": str(exc)}
        configured_model = (
            config.get("defaultModel")
            or config.get("model")
            or config.get("default_model")
            or MODEL_AGGREGATOR_MODEL
        )
        return {
            "ok": True,
            "status": "ready",
            "provider": TRANSLATE_PROVIDER,
            "model": configured_model,
            "default_model": MODEL_AGGREGATOR_MODEL,
            "aggregator_base_url": MODEL_AGGREGATOR_BASE_URL,
            "aggregator_health": health,
            "aggregator_config": config,
            "loaded": True,
            "error": "",
            "started_at": _model_status.get("started_at"),
            "ready_at": time.time(),
        }
    except Exception as exc:
        return {
            "ok": False,
            "status": "error",
            "provider": TRANSLATE_PROVIDER,
            "model": MODEL_AGGREGATOR_MODEL,
            "default_model": MODEL_AGGREGATOR_MODEL,
            "aggregator_base_url": MODEL_AGGREGATOR_BASE_URL,
            "loaded": False,
            "error": f"模型聚合服务不可用，请先启动 ModelAggregatorService: {exc}",
            "started_at": _model_status.get("started_at"),
            "ready_at": None,
        }


def split_text(text: str) -> list[str]:
    lines = [line.strip() for line in text.replace("\r\n", "\n").split("\n")]
    chunks: list[str] = []
    current: list[str] = []
    current_len = 0

    for line in lines:
        if not line:
            if current:
                chunks.append(" ".join(current))
                current = []
                current_len = 0
            continue
        if current and current_len + len(line) > 900:
            chunks.append(" ".join(current))
            current = [line]
            current_len = len(line)
        else:
            current.append(line)
            current_len += len(line)

    if current:
        chunks.append(" ".join(current))

    return chunks or [text.strip()]


def translate_payload(payload: dict[str, Any]) -> dict[str, Any]:
    text = payload.get("text") or payload.get("source_text") or payload.get("input") or ""
    if not isinstance(text, str):
        raise RuntimeError('JSON field "text" must be a string')
    return translate_text(text, payload)


def translate_text(text: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
    source_text = text.strip()
    if not source_text:
        model = MODEL_AGGREGATOR_MODEL if TRANSLATE_PROVIDER == "model_aggregator" else MODEL_ID
        return {"translation": "", "translated_text": "", "text": "", "chunks": [], "model": model}

    if TRANSLATE_PROVIDER == "model_aggregator":
        return translate_text_model_aggregator(source_text, payload or {})

    if TRANSLATE_PROVIDER == "openai_compatible":
        return translate_text_openai_compatible(source_text, payload or {})

    if TRANSLATE_PROVIDER == "huggingface_nllb":
        return translate_text_huggingface(source_text)

    bundle = get_model_bundle()
    torch = bundle["torch"]
    tokenizer = bundle["tokenizer"]
    model = bundle["model"]
    device = bundle["device"]

    tokenizer.src_lang = SRC_LANG
    target_token_id = tokenizer.convert_tokens_to_ids(TGT_LANG)
    if target_token_id is None or target_token_id < 0:
        raise RuntimeError(f"Target language token not found: {TGT_LANG}")

    chunks = split_text(source_text)
    translations: list[str] = []

    with torch.no_grad():
        for index in range(0, len(chunks), BATCH_SIZE):
            batch = chunks[index:index + BATCH_SIZE]
            inputs = tokenizer(
                batch,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=MAX_INPUT_TOKENS,
            )
            inputs = {key: value.to(device) for key, value in inputs.items()}
            generated = model.generate(
                **inputs,
                forced_bos_token_id=target_token_id,
                max_new_tokens=MAX_NEW_TOKENS,
            )
            translations.extend(tokenizer.batch_decode(generated, skip_special_tokens=True))

    translation = "\n".join(item.strip() for item in translations if item.strip())
    return {
        "translation": translation,
        "translated_text": translation,
        "text": translation,
        "chunks": [
            {"source": source, "translation": target}
            for source, target in zip(chunks, translations)
        ],
        "model": MODEL_ID,
        "src_lang": SRC_LANG,
        "tgt_lang": TGT_LANG,
        "device": device,
    }


def translate_text_model_aggregator(text: str, payload: dict[str, Any]) -> dict[str, Any]:
    model = str(payload.get("model") or MODEL_AGGREGATOR_MODEL).strip() or MODEL_AGGREGATOR_MODEL
    source_lang = str(payload.get("source_lang") or payload.get("src_lang") or SRC_LANG)
    target_lang = str(payload.get("target_lang") or payload.get("tgt_lang") or TGT_LANG)
    role_id = str(payload.get("role_id") or "academic-literal")
    role_name = str(payload.get("role_name") or DEFAULT_ROLE_NAME)
    system_prompt = str(payload.get("system_prompt") or DEFAULT_SYSTEM_PROMPT)
    user_prompt_template = str(payload.get("user_prompt_template") or DEFAULT_USER_PROMPT_TEMPLATE)
    temperature = coerce_float(payload.get("temperature"), 0.2)
    max_tokens = coerce_int(payload.get("max_tokens") or payload.get("maxTokens"), 2048)
    page = payload.get("page") if payload.get("page") not in {None, ""} else "当前页"
    source_name = str(payload.get("source_name") or "未命名文件")

    user_prompt = render_prompt_template(user_prompt_template, {
        "source_text": text,
        "source_lang": source_lang,
        "target_lang": target_lang,
        "page": page,
        "source_name": source_name,
    })
    request_body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": temperature,
        "maxTokens": max_tokens,
        "metadata": {
            "role_id": role_id,
            "role_name": role_name,
            "source_lang": source_lang,
            "target_lang": target_lang,
            "page": page,
            "source_name": source_name,
        },
    }

    chat_url = f"{MODEL_AGGREGATOR_BASE_URL}/api/aggregate/chat"
    raw = request_json("POST", chat_url, request_body, timeout=MODEL_AGGREGATOR_TIMEOUT_SECONDS)
    if raw.get("ok") is False:
        raise RuntimeError(raw.get("error") or raw.get("message") or "ModelAggregatorService returned ok=false")

    translation = extract_model_aggregator_translation(raw)
    return {
        "translation": translation,
        "translated_text": translation,
        "text": translation,
        "provider": TRANSLATE_PROVIDER,
        "model": raw.get("model") or model,
        "role_id": role_id,
        "role_name": role_name,
        "raw": raw,
    }


def translate_text_openai_compatible(text: str, payload: dict[str, Any]) -> dict[str, Any]:
    if not OPENAI_TRANSLATE_BASE_URL or not OPENAI_TRANSLATE_API_KEY or not OPENAI_TRANSLATE_MODEL:
        raise RuntimeError("OpenAI-compatible translation endpoint is not fully configured")
    role_name = str(payload.get("role_name") or DEFAULT_ROLE_NAME)
    system_prompt = str(payload.get("system_prompt") or DEFAULT_SYSTEM_PROMPT)
    user_prompt = render_prompt_template(
        str(payload.get("user_prompt_template") or DEFAULT_USER_PROMPT_TEMPLATE),
        {
            "source_text": text,
            "source_lang": payload.get("source_lang") or payload.get("src_lang") or SRC_LANG,
            "target_lang": payload.get("target_lang") or payload.get("tgt_lang") or TGT_LANG,
            "page": payload.get("page") or "当前页",
            "source_name": payload.get("source_name") or "未命名文件",
        },
    )
    url = OPENAI_TRANSLATE_BASE_URL
    if not url.endswith("/chat/completions"):
        url = f"{url}/chat/completions"
    body = json.dumps({
        "model": OPENAI_TRANSLATE_MODEL,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": coerce_float(payload.get("temperature"), 0.2),
        "max_tokens": coerce_int(payload.get("max_tokens") or payload.get("maxTokens"), 2048),
    }, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {OPENAI_TRANSLATE_API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=MODEL_AGGREGATOR_TIMEOUT_SECONDS) as response:
            raw = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"OpenAI-compatible translation HTTP {exc.code}: {detail[:500]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"OpenAI-compatible translation unavailable: {exc.reason}") from exc
    translation = extract_model_aggregator_translation(raw)
    return {
        "translation": translation,
        "translated_text": translation,
        "text": translation,
        "provider": TRANSLATE_PROVIDER,
        "model": raw.get("model") or OPENAI_TRANSLATE_MODEL,
        "role_name": role_name,
    }


def render_prompt_template(template: str, variables: dict[str, Any]) -> str:
    rendered = template or DEFAULT_USER_PROMPT_TEMPLATE
    for key, value in variables.items():
        rendered = rendered.replace("{" + key + "}", str(value))
    return rendered


def extract_model_aggregator_translation(payload: Any) -> str:
    if isinstance(payload, str):
        return payload
    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected ModelAggregatorService response: {payload}")

    for key in ("answer", "translation", "translated_text", "text", "content", "output"):
        value = payload.get(key)
        if isinstance(value, str):
            return value

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        first = choices[0] if isinstance(choices[0], dict) else {}
        message = first.get("message") if isinstance(first.get("message"), dict) else {}
        content = message.get("content")
        if isinstance(content, str):
            return content

    raw = payload.get("raw")
    if isinstance(raw, dict):
        try:
            choice = raw.get("choices", [{}])[0]
            content = choice.get("message", {}).get("content")
            if isinstance(content, str):
                return content
        except (IndexError, AttributeError, TypeError):
            pass

    raise RuntimeError(f"Unexpected ModelAggregatorService response: {payload}")


def request_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    timeout: float = 120,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {error_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"request failed: {exc.reason}") from exc

    try:
        parsed = json.loads(body) if body else {}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid JSON response from {url}: {body[:500]}") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError(f"unexpected JSON response from {url}: {parsed}")
    return parsed


def coerce_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def translate_text_huggingface(text: str) -> dict[str, Any]:
    if not HF_TOKEN:
        raise RuntimeError("HF_TOKEN is required when TRANSLATE_PROVIDER=huggingface_nllb")

    chunks = split_text(text)
    translations = [translate_chunk_huggingface(chunk) for chunk in chunks]
    translation = "\n".join(item.strip() for item in translations if item.strip())
    return {
        "translation": translation,
        "translated_text": translation,
        "text": translation,
        "chunks": [
            {"source": source, "translation": target}
            for source, target in zip(chunks, translations)
        ],
        "provider": TRANSLATE_PROVIDER,
        "model": MODEL_ID,
        "src_lang": SRC_LANG,
        "tgt_lang": TGT_LANG,
    }


def translate_chunk_huggingface(text: str) -> str:
    payload = {
        "inputs": text,
        "parameters": {
            "src_lang": SRC_LANG,
            "tgt_lang": TGT_LANG,
            "max_new_tokens": MAX_NEW_TOKENS,
        },
        "options": {
            "wait_for_model": True,
        },
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        HF_API_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {HF_TOKEN}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            parsed = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        error_body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Hugging Face API HTTP {exc.code}: {error_body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Hugging Face API request failed: {exc.reason}") from exc

    return extract_huggingface_translation(parsed)


def extract_huggingface_translation(payload: Any) -> str:
    if isinstance(payload, list) and payload:
        return extract_huggingface_translation(payload[0])
    if isinstance(payload, dict):
        for key in ("translation_text", "generated_text", "text"):
            value = payload.get(key)
            if isinstance(value, str):
                return value
        if isinstance(payload.get("error"), str):
            raise RuntimeError(payload["error"])
    if isinstance(payload, str):
        return payload
    raise RuntimeError(f"Unexpected Hugging Face response: {payload}")


class Handler(BaseHTTPRequestHandler):
    server_version = "NLLBTranslateLocal/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self.send_json(model_health_payload())
            return

        self.send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/translate":
            self.send_json({"error": "Not found"}, status=404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            raw_body = self.rfile.read(length)
            payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            self.send_json(translate_payload(payload))
        except Exception as exc:
            self.send_json({"error": str(exc)}, status=500)

    def send_json(self, payload: dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_cors_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))


def main() -> None:
    print(f"NLLB Tibetan-to-Chinese local server: http://{HOST}:{PORT}")
    print(f"provider={TRANSLATE_PROVIDER} model={MODEL_ID} src_lang={SRC_LANG} tgt_lang={TGT_LANG}")
    if TRANSLATE_PROVIDER == "huggingface_nllb":
        print("Using Hugging Face Inference API; no local model preload is required.")
    elif TRANSLATE_PROVIDER == "model_aggregator":
        print(
            "Using ModelAggregatorService; no local model preload is required. "
            f"base_url={MODEL_AGGREGATOR_BASE_URL} default_model={MODEL_AGGREGATOR_MODEL}"
        )
    elif os.environ.get("NLLB_PRELOAD", "1") not in {"0", "false", "False"}:
        print("The model downloads and loads in the background after startup.")
        preload_model_async()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
