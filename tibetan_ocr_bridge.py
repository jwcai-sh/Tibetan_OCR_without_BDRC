from __future__ import annotations

from typing import Any


def load_ai_ocr_module() -> Any:
    from importlib.util import module_from_spec, spec_from_file_location
    from pathlib import Path

    path = Path(__file__).parent / "tibetan-ocr-core" / "ai_vision_ocr_server.py"
    spec = spec_from_file_location("ai_vision_ocr_server", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("无法加载 AI Vision OCR 服务")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def call_ai_ocr(image: bytes, filename: str, draft: str = "", prompt: str = "", model: str = "") -> dict[str, Any]:
    module = load_ai_ocr_module()
    return module.call_vision_model(image, filename, prompt or module.default_prompt(draft), model=model)


def call_ai_layout(image: bytes, line_count: int) -> dict[str, Any]:
    return load_ai_ocr_module().build_layout_payload(image, line_count)


def call_ai_line_preview(image: bytes, bbox: str, review_image: str = "") -> dict[str, Any]:
    import base64
    import json
    from io import BytesIO
    from PIL import Image

    module = load_ai_ocr_module()
    parsed_bbox = module.parse_normalized_bbox(bbox)
    metadata = json.loads(review_image or "{}")
    if metadata:
        with Image.open(BytesIO(image)) as source:
            parsed_bbox = module.resolve_line_preview_bbox(
                parsed_bbox, metadata, {"width": source.width, "height": source.height}
            )
    tiles, crop_metadata = module.prepare_line_review_images(image, parsed_bbox)
    return {
        "images": ["data:image/png;base64," + base64.b64encode(tile).decode("ascii") for tile in tiles],
        "review_image": crop_metadata,
    }


def call_ai_review_models() -> dict[str, Any]:
    return load_ai_ocr_module().review_models_payload()


def call_ai_page_review(provider: str, image: bytes, filename: str, rows: list, model: str = "") -> dict[str, Any]:
    module = load_ai_ocr_module()
    if provider == "gemini":
        return module.call_gemini_page_review(image, filename, rows, model)
    if provider == "qwen":
        return module.call_qwen_page_review(image, filename, rows, model)
    raise RuntimeError("不支持的复核模型")
