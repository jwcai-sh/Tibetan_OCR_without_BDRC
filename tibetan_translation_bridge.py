from __future__ import annotations

from typing import Any


def call_translation(payload: dict[str, Any]) -> dict[str, Any]:
    from importlib.util import module_from_spec, spec_from_file_location
    from pathlib import Path

    path = Path(__file__).parent / "tibetan-translation-services" / "nllb_translate_server.py"
    spec = spec_from_file_location("nllb_translate_server", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载藏译汉服务")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.translate_payload(payload)
