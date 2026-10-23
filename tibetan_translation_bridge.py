from __future__ import annotations

import os
from typing import Any


def _load_translation_module() -> Any:
    from importlib.util import module_from_spec, spec_from_file_location
    from pathlib import Path

    path = Path(__file__).parent / "tibetan-translation-services" / "nllb_translate_server.py"
    spec = spec_from_file_location("nllb_translate_server", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载藏译汉服务")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    # Zeabur's API health route defaults to the aggregator provider; keep the
    # dynamically loaded translation module on that same production default.
    module.TRANSLATE_PROVIDER = os.environ.get("TRANSLATE_PROVIDER", "").strip() or "model_aggregator"
    return module


def call_translation(payload: dict[str, Any]) -> dict[str, Any]:
    return _load_translation_module().translate_payload(payload)


def translation_health() -> dict[str, Any]:
    return _load_translation_module().model_health_payload()
