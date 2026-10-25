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


def call_ai_line_review(
    image: bytes, filename: str, bbox: str, draft: str = "", model: str = "", region_id: str = "",
) -> dict[str, Any]:
    module = load_ai_ocr_module()
    return module.call_line_review_vision(
        image, filename, module.parse_normalized_bbox(bbox), draft, model,
        allow_page_numbers=region_id in {"left", "right"},
    )


def call_ai_line_preview(
    image: bytes, bbox: str, review_image: str = "",
    physical_row_index: str = "", physical_row_count: str = "",
    preview_format: str = "",
) -> dict[str, Any]:
    import base64
    import json
    from io import BytesIO
    from PIL import Image

    module = load_ai_ocr_module()
    parsed_bbox = module.parse_normalized_bbox(bbox)
    expected_count = None
    if physical_row_index:
        row_index = int(physical_row_index)
        if row_index < 0:
            raise ValueError("physical_row_index must be a non-negative integer")
        parsed_bbox["physical_row_index"] = row_index
    if physical_row_count:
        expected_count = int(physical_row_count)
        if expected_count < 1:
            raise ValueError("physical_row_count must be a positive integer")
    metadata = json.loads(review_image or "{}")
    if metadata:
        with Image.open(BytesIO(image)) as source:
            parsed_bbox = module.resolve_line_preview_bbox(
                parsed_bbox, metadata, {"width": source.width, "height": source.height}
            )
    tiles, crop_metadata = module.prepare_line_review_images(image, parsed_bbox)
    resolved_bbox = crop_metadata.get("source_bbox", {})
    if expected_count is not None and (
        resolved_bbox.get("physical_row_count") != expected_count
        or resolved_bbox.get("physical_row_index") != parsed_bbox.get("physical_row_index")
    ):
        raise RuntimeError("原文物理行数与识别 block 数不一致，无法安全生成对应的单行预览。")
    if preview_format == "jpeg":
        compressed = []
        for tile in tiles:
            output = BytesIO()
            with Image.open(BytesIO(tile)) as source:
                source.convert("RGB").save(
                    output, format="JPEG", quality=92, subsampling=0, optimize=True
                )
            compressed.append(output.getvalue())
        tiles = compressed
    media_type = "image/jpeg" if preview_format == "jpeg" else "image/png"
    return {
        "images": [f"data:{media_type};base64," + base64.b64encode(tile).decode("ascii") for tile in tiles],
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
