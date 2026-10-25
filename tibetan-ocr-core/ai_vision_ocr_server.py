#!/usr/bin/env python3
"""Local AI Vision OCR adapter for Tibetan OCR correction.

This service exposes the same lightweight HTTP shape as the local BDRC wrapper:

- GET /health
- POST /ocr with multipart field "file"

It forwards the rendered page image plus optional BDRC OCR draft text to either
ModelAggregatorService or an OpenAI-compatible vision chat-completions endpoint.
"""

from __future__ import annotations

import base64
import cgi
import json
import mimetypes
import os
import re
import sys
import urllib.error
import urllib.request
from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional runtime dependency
    Image = None  # type: ignore[assignment]

try:
    import cv2
    import numpy as np
except Exception:  # pragma: no cover - optional layout detector dependency
    cv2 = None  # type: ignore[assignment]
    np = None  # type: ignore[assignment]


HOST = os.environ.get("AI_VISION_OCR_HOST", "127.0.0.1")
PORT = int(os.environ.get("AI_VISION_OCR_PORT", "18092"))
PROVIDER = os.environ.get("AI_VISION_PROVIDER", "model_aggregator").strip().lower()
USE_MODEL_AGGREGATOR = PROVIDER in {"model_aggregator", "model-aggregator", "aggregator"}
BASE_URL = os.environ.get("AI_VISION_BASE_URL", "http://127.0.0.1:11434/v1").rstrip("/")
API_KEY = os.environ.get("AI_VISION_API_KEY", "")
AGGREGATOR_BASE_URL = os.environ.get("MODEL_AGGREGATOR_BASE_URL", "http://127.0.0.1:8890").rstrip("/")
AGGREGATOR_API_KEY = os.environ.get("MODEL_AGGREGATOR_API_KEY", "")
DEFAULT_MODEL = "gemini:gemini-2.5-flash" if USE_MODEL_AGGREGATOR else "qwen2.5-vl:7b"
MODEL = os.environ.get("AI_VISION_MODEL", DEFAULT_MODEL)
TIMEOUT = float(os.environ.get("AI_VISION_TIMEOUT", "120"))
GEMINI_OCR_TIMEOUT = float(os.environ.get("AI_VISION_GEMINI_OCR_TIMEOUT", "300"))
MAX_TOKENS = int(os.environ.get("AI_VISION_MAX_TOKENS", "8192"))
TEMPERATURE = float(os.environ.get("AI_VISION_TEMPERATURE", "0.0"))
MAX_IMAGE_SIDE = int(os.environ.get("AI_VISION_MAX_IMAGE_SIDE", "1800"))
IMAGE_JPEG_QUALITY = int(os.environ.get("AI_VISION_IMAGE_JPEG_QUALITY", "88"))
LINE_REVIEW_TARGET_HEIGHT = int(os.environ.get("AI_VISION_LINE_REVIEW_TARGET_HEIGHT", "640"))
LINE_REVIEW_TILE_WIDTH = int(os.environ.get("AI_VISION_LINE_REVIEW_TILE_WIDTH", "1500"))
OPENAI_REVIEW_MODEL = os.environ.get("OPENAI_REVIEW_MODEL", "").strip()
OPENAI_REVIEW_API_KEY = os.environ.get("OPENAI_REVIEW_API_KEY", "") or os.environ.get("OPENAI_API_KEY", "")
QWEN_REVIEW_API_KEY = os.environ.get("QWEN_REVIEW_API_KEY", "") or os.environ.get("DASHSCOPE_API_KEY", "")
QWEN_REVIEW_BASE_URL = os.environ.get("QWEN_REVIEW_BASE_URL", "").rstrip("/")
QWEN_REVIEW_MODELS = [item.strip() for item in os.environ.get("QWEN_REVIEW_MODELS", "qwen3.8-max,qwen3.7-plus").split(",") if item.strip()]
GEMINI_REVIEW_MODELS = [item.strip() for item in os.environ.get("GEMINI_REVIEW_MODELS", "gemini-3.8-flash,gemini-3.1-flash-lite,gemini-2.5-flash").split(",") if item.strip()]
AGGREGATOR_ALLOW_FALLBACK = os.environ.get("AI_VISION_ALLOW_FALLBACK", "0").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}


def parse_model_list(value: str) -> list[str]:
    value = value.strip()
    if not value:
        return []
    if value.startswith("["):
        parsed = json.loads(value)
        return [str(item).strip() for item in parsed if str(item).strip()]
    return [item.strip() for item in value.split(",") if item.strip()]


AGGREGATOR_MODELS = parse_model_list(os.environ.get("AI_VISION_MODELS", ""))


def chat_completions_url() -> str:
    if BASE_URL.endswith("/chat/completions"):
        return BASE_URL
    return f"{BASE_URL}/chat/completions"


def aggregator_url(path: str) -> str:
    return f"{AGGREGATOR_BASE_URL}/{path.lstrip('/')}"


def default_prompt(draft_text: str) -> str:
    draft_lines = [line for line in draft_text.splitlines() if line.strip()]
    parts = [
        "请识别图片中的藏文印刷体文字。",
        "重点检查上加字、下加字、元音符号和堆叠字。",
        "不要根据语义自由扩写，不要补充图片中不存在的字。",
    ]
    if draft_text:
        parts.append(
            f"BDRC OCR 初稿共有 {len(draft_lines)} 行。请必须输出 {len(draft_lines)} 行，用换行逐行分隔；不得只输出前几行。"
        )
        parts.append("看不清或无法确认的行，请保留 BDRC 原行，只修正有图像证据的字。")
        parts.append("下面是 BDRC OCR 初稿。请以图片为准，只修正有视觉证据的错误：")
        parts.append(draft_text)
    else:
        parts.append("请完整输出整页所有藏文行，用换行逐行分隔；不得只输出前几行。")
    parts.append("只输出纯藏文文本，不要输出编号、解释、Markdown 表格或代码块。")
    return "\n\n".join(parts)


def image_data_url(image_bytes: bytes, filename: str) -> str:
    mime_type = mimetypes.guess_type(filename)[0] or "image/png"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def prepare_vision_image(image_bytes: bytes, filename: str) -> tuple[bytes, str, str]:
    """Downscale full-page OCR images before sending them to a slow vision model."""
    if Image is None or MAX_IMAGE_SIDE <= 0:
        mime_type = mimetypes.guess_type(filename)[0] or "image/png"
        return image_bytes, filename, mime_type

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            width, height = image.size
            if max(width, height) <= MAX_IMAGE_SIDE:
                mime_type = mimetypes.guess_type(filename)[0] or "image/png"
                return image_bytes, filename, mime_type

            normalized = image.convert("RGB")
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            normalized.thumbnail((MAX_IMAGE_SIDE, MAX_IMAGE_SIDE), resampling)

            output = BytesIO()
            normalized.save(
                output,
                format="JPEG",
                quality=max(60, min(95, IMAGE_JPEG_QUALITY)),
                optimize=True,
            )
            stem = os.path.splitext(filename or "page.png")[0] or "page"
            return output.getvalue(), f"{stem}.jpg", "image/jpeg"
    except Exception:
        mime_type = mimetypes.guess_type(filename)[0] or "image/png"
        return image_bytes, filename, mime_type


def parse_normalized_bbox(value: str) -> dict[str, float]:
    """Parse and validate a normalized source-line rectangle from multipart data."""
    try:
        raw = json.loads(value)
        bbox = {key: float(raw[key]) for key in ("x", "y", "width", "height")}
    except (TypeError, ValueError, KeyError, json.JSONDecodeError) as exc:
        raise RuntimeError("bbox must be a JSON object with x, y, width, and height") from exc
    if not (0 <= bbox["x"] < 1 and 0 <= bbox["y"] < 1 and bbox["width"] > 0 and bbox["height"] > 0):
        raise RuntimeError("bbox must describe a non-empty normalized source region")
    if bbox["x"] + bbox["width"] > 1.001 or bbox["y"] + bbox["height"] > 1.001:
        raise RuntimeError("bbox extends outside the source image")
    return bbox


def split_enlarged_line(enlarged, tile_width):
    """Prefer whitespace near the width limit so a Tibetan stack is not split."""
    ranges = []
    left = 0
    ink_columns = None
    if cv2 is not None and np is not None:
        rgb = np.asarray(enlarged)
        hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
        gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
        ink = (gray < 100) | ((hsv[:, :, 1] >= 110) & ((hsv[:, :, 0] <= 18) | (hsv[:, :, 0] >= 170)))
        ink_columns = ink.sum(axis=0)
    while left < enlarged.width:
        right = min(enlarged.width, left + tile_width)
        if right < enlarged.width and ink_columns is not None:
            start = max(left + 480, right - 160)
            spaces = np.flatnonzero(ink_columns[start:right] <= 1)
            if spaces.size:
                right = start + int(spaces[-1])
        ranges.append([left, right])
        if right == enlarged.width:
            break
        # Retain a narrow shared edge when whitespace detection fails. The
        # transcription prompt instructs models to copy that overlap once.
        left = max(left + 1, right - min(48, max(1, tile_width // 24)))
    tiles = []
    for left, right in ranges:
        output = BytesIO()
        enlarged.crop((left, 0, right, enlarged.height)).save(output, format="PNG", optimize=True)
        tiles.append(output.getvalue())
    return tiles, ranges


LINE_CROP_VERSION = 26


def find_row_frame_clips(image_bytes, center, row, page_width, page_height):
    """Follow a sloping pecha's inner side rules at this physical row."""
    if cv2 is None or np is None:
        return None, None, None, None
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return None, None, None, None
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    red = (((hsv[:, :, 0] <= 25) | (hsv[:, :, 0] >= 165)) &
           (hsv[:, :, 1] >= 70))
    search = max(14, round(center['width'] * page_width * .055))
    boundaries = (round(center['x'] * page_width),
                  round((center['x'] + center['width']) * page_width))
    clips = []
    tracks = []
    for side, edge in enumerate(boundaries):
        x0 = max(0, edge - search)
        x1 = min(page_width, edge + search)
        rule_pixels = red[:, x0:x1].astype(np.uint8) * 255
        lines = cv2.HoughLinesP(rule_pixels, 1, np.pi / 360, threshold=40,
                                minLineLength=max(24, round(page_height * .3)),
                                maxLineGap=max(12, round(page_height * .04)))
        candidates = []
        for line in lines if lines is not None else []:
            lx0, ly0, lx1, ly1 = map(int, line[0])
            lx0 += x0; lx1 += x0
            if abs(ly1 - ly0) < page_height * .3 or abs(lx1 - lx0) > abs(ly1 - ly0) * .5:
                continue
            slope = (lx1 - lx0) / (ly1 - ly0)
            intercept = lx0 - slope * ly0
            midpoint = slope * page_height * .5 + intercept
            candidates.append((midpoint, slope, intercept))
        if not candidates:
            clips.append(None)
            tracks.append(None)
            continue
        _, slope, intercept = (max(candidates, key=lambda item: item[0]) if side == 0
                               else min(candidates, key=lambda item: item[0]))
        y0 = row['y'] * page_height
        y1 = (row['y'] + row['height']) * page_height
        edge_values = (slope * y0 + intercept, slope * y1 + intercept)
        # Keep the entire sloping edge in the raw crop; the per-scanline mask
        # below removes side writing without cutting the first or last glyph.
        clips.append((min(edge_values) - 4 if side == 0 else max(edge_values) + 4) / page_width)
        tracks.append((slope, intercept))
    return (*clips, *tracks)


def bound_legacy_line_crop(image_bytes, bbox):
    """Resolve a saved block to one physical row without splitting its stacks."""
    bbox = dict(bbox)
    if bbox["height"] > bbox["width"] and not isinstance(bbox.get("physical_row_index"), int):
        return bbox
    if cv2 is None or np is None:
        return bound_projection_line_crop(image_bytes, bbox)
    regions = detect_traditional_column_bboxes(image_bytes)
    center = next((region for region in regions if region["id"] == "center"), None)
    if not center:
        if isinstance(bbox.get("physical_row_index"), int):
            raise RuntimeError("中栏定位失败，无法安全恢复已保存的物理行裁剪。")
        return bound_projection_line_crop(image_bytes, bbox)
    mid_x = bbox["x"] + bbox["width"] / 2
    mid_y = bbox["y"] + bbox["height"] / 2
    if not center["x"] <= mid_x <= center["x"] + center["width"]:
        if isinstance(bbox.get("physical_row_index"), int):
            raise RuntimeError("已保存的物理行不在中栏，无法安全生成预览。")
        return bbox
    # The frame can slope across the page. Its average y coordinate must not
    # truncate the upper marks at the right end of the first row.
    region = dict(center)
    region["y"] = max(0, center["y"] - center["height"] * .15)
    region["height"] = min(1, center["y"] + center["height"] * 1.15) - region["y"]
    local_image = crop_image_to_bbox(image_bytes, region, padding=False)
    rows = detect_physical_text_line_bboxes(local_image, include_masks=True)
    if not rows:
        if isinstance(bbox.get("physical_row_index"), int):
            raise RuntimeError("中栏物理行定位失败，无法生成可靠的单行预览。")
        return bbox
    with Image.open(BytesIO(image_bytes)) as page:
        page_width, page_height = page.size
    ox, oy = round(region["x"] * page_width), round(region["y"] * page_height)
    with Image.open(BytesIO(local_image)) as local:
        width, height = local.size
    centers = [(oy + (r["y"] + r["height"] / 2) * height) / page_height for r in rows]
    index = min(range(len(rows)), key=lambda i: abs(centers[i] - mid_y))
    saved_index = bbox.get("physical_row_index")
    if isinstance(saved_index, int):
        if not 0 <= saved_index < len(rows):
            raise RuntimeError("指定的原文物理行不存在，无法生成单行预览。")
        index = saved_index
    row = rows[index]
    bbox.update(x=(ox + row["x"] * width) / page_width,
                y=(oy + row["y"] * height) / page_height,
                width=row["width"] * width / page_width,
                height=row["height"] * height / page_height,
                physical_row_index=index, physical_row_count=len(rows))
    # Components are assigned to complete row bodies before cropping. This
    # removes neighbouring ink even where sloped rows overlap in y.
    bbox['_exclusion'] = (ox, oy, row.get('_exclusion'))
    for key in ('clip_top', 'clip_bottom', 'crop_pad_y', 'clip_left', 'clip_right'):
        bbox.pop(key, None)
    # A three-region pecha layout has two physical frame boundaries. Expanding
    # across those boundaries picks up the side inscription (and often a red
    # vertical rule). Unframed/synthetic single-region pages still need the
    # original margin for glyphs that overhang the estimated column edge.
    horizontal_buffer = center['width'] * (.01 if len(regions) >= 3 else .02)
    bbox['clip_left'] = max(0, center['x'] - horizontal_buffer)
    bbox['clip_right'] = min(1, center['x'] + center['width'] + horizontal_buffer)
    if len(regions) >= 3:
        frame_left, frame_right, left_track, right_track = find_row_frame_clips(
            image_bytes, center, bbox, page_width, page_height)
        if frame_left is not None and frame_left < bbox['x'] + bbox['width']:
            bbox['clip_left'] = frame_left
        if frame_right is not None and frame_right > bbox['x']:
            bbox['clip_right'] = frame_right
        bbox['_frame_tracks'] = (left_track, right_track)
    return bbox


def remove_crop_frame_rules(crop):
    """Erase long red frame strokes without changing nearby black or red glyphs."""
    if cv2 is None or np is None:
        return crop
    rgb = np.asarray(crop).copy()
    height, width = rgb.shape[:2]
    if height < 20 or width < 40:
        return crop
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    red = (((hsv[:, :, 0] <= 25) | (hsv[:, :, 0] >= 165)) &
           (hsv[:, :, 1] >= 25)).astype(np.uint8)
    if red.sum() < 30:
        return crop
    erase = np.zeros_like(red)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(red, 8)
    for component in range(1, count):
        x, y, rule_width, rule_height, _ = stats[component]
        horizontal_rule = (rule_width >= width * .4 and rule_height <= max(8, height * .4)
                           and min(y, height - (y + rule_height)) < height * .28)
        vertical_rule = (rule_height >= height * .5 and rule_width <= max(8, width * .03)
                         and min(x, width - (x + rule_width)) < width * .08)
        if horizontal_rule or vertical_rule:
            erase[labels == component] = 1
    for minimum in (max(30, round(width * .3)), max(14, round(height * .45))):
        lines = cv2.HoughLinesP(red * 255, 1, np.pi / 180, threshold=12,
                                minLineLength=minimum, maxLineGap=max(6, round(minimum * .06)))
        for item in lines if lines is not None else []:
            x0, y0, x1, y1 = map(int, item[0]); dx, dy = x1-x0, y1-y0
            horizontal = abs(dx) >= width * .3 and abs(dy) <= max(4, abs(dx) * .04)
            vertical = abs(dy) >= height * .45 and abs(dx) <= max(4, abs(dy) * .25)
            near_horizontal_edge = min((y0+y1)/2, height-(y0+y1)/2) < height * .28
            near_vertical_edge = min((x0+x1)/2, width-(x0+x1)/2) < width * .08
            if (horizontal and near_horizontal_edge) or (vertical and near_vertical_edge):
                cv2.line(erase, (x0,y0), (x1,y1), 1,
                         thickness=max(5, min(11, round(height * .06))))
    # Scanned pecha rules can curve enough to join a vertical border, making
    # connected-component and straight-Hough removal leave red fragments.
    # A rule still occupies a large fraction of an edge scanline; rubric
    # letters do not. Remove red pixels only in those narrow edge bands.
    strong_red = red & (hsv[:, :, 1] >= 110)
    coverage = strong_red.sum(axis=1)
    for edge_rows in (np.arange(round(height * .34)),
                      np.arange(round(height * .66), height)):
        rule_rows = edge_rows[coverage[edge_rows] >= width * .25]
        if rule_rows.size:
            pad = max(3, round(height * .035))
            top = max(0, int(rule_rows.min()) - pad)
            bottom = min(height, int(rule_rows.max()) + pad + 1)
            erase[top:bottom] |= red[top:bottom]
    if width > 1000:
        edge = max(5, round(width * .007))
        erase[:, :edge] = red[:, :edge]
        erase[:, -edge:] = red[:, -edge:]
    if erase.any():
        paper = np.median(rgb.reshape(-1, 3), axis=0).astype(np.uint8)
        rgb[(erase > 0) & (red > 0)] = paper
        return Image.fromarray(rgb)
    return crop


def prepare_line_review_images(
    image_bytes: bytes, bbox: dict[str, float]
) -> tuple[list[bytes], dict[str, Any]]:
    """Tightly crop one OCR row, preserve ink color, enlarge it, then tile wide rows.

    A whole pecha page is intentionally downsized before ordinary OCR. That
    would make faint rubric text tiny again, so line review keeps each enlarged
    tile below the upstream maximum width instead of shrinking the whole row.
    """
    if Image is None:
        raise RuntimeError("Pillow is required for AI Vision line review")
    try:
        with Image.open(BytesIO(image_bytes)) as source:
            source.load()
            image = source.convert("RGB")
            page_width, page_height = image.size
            bbox = bound_legacy_line_crop(image_bytes, bbox)
            exclusion = bbox.pop("_exclusion", None)
            frame_tracks = bbox.pop("_frame_tracks", None)
            raw_x = bbox["x"] * page_width
            raw_y = bbox["y"] * page_height
            raw_width = max(1.0, bbox["width"] * page_width)
            raw_height = max(1.0, bbox["height"] * page_height)
            # Keep Tibetan stacks and red punctuation at the line edges, but do
            # not include the surrounding frame or neighbouring rows.
            pad_x = max(5, round(raw_width * 0.06))
            # For a bounded physical row, the OCR bbox often covers only the
            # central body of a Tibetan glyph. Expand toward the midpoint clips
            # so detached top/bottom marks stay visible without reaching a
            # neighbouring row.
            pad_y = max(
                4,
                round(raw_height * (2.0 if "clip_top" in bbox else 0.8)),
                round(bbox.get("crop_pad_y", 0) * page_height),
            )
            if exclusion is not None:
                # The exclusion mask bounds neighboring rows vertically, so
                # horizontal padding can scale with glyph height without
                # pulling ink from adjacent rows into the crop.
                pad_x = max(8, round(raw_height * .35))
                pad_y = max(6, round(raw_height * .12))
            x0 = max(0, int(round(raw_x - pad_x)))
            y0 = max(0, int(round(raw_y - pad_y)))
            x1 = min(page_width, int(round(raw_x + raw_width + pad_x)))
            y1 = min(page_height, int(round(raw_y + raw_height + pad_y)))
            x0 = max(x0, round(bbox.get("clip_left", 0) * page_width))
            x1 = min(x1, round(bbox.get("clip_right", 1) * page_width))
            y0 = max(y0, round(bbox.get("clip_top", 0) * page_height))
            y1 = min(y1, round(bbox.get("clip_bottom", 1) * page_height))
            if x1 <= x0 or y1 <= y0:
                raise RuntimeError("bbox crop is empty")
            crop = image.crop((x0, y0, x1, y1))
            if frame_tracks and any(frame_tracks) and np is not None:
                rgb_crop = np.array(crop)
                background = np.median(rgb_crop.reshape(-1, 3), axis=0).astype(np.uint8)
                for local_y in range(crop.height):
                    page_y = y0 + local_y
                    left_track, right_track = frame_tracks
                    if left_track is not None:
                        left = round(left_track[0] * page_y + left_track[1]) + 3 - x0
                        rgb_crop[local_y, :max(0, min(crop.width, left))] = background
                    if right_track is not None:
                        right = round(right_track[0] * page_y + right_track[1]) - 3 - x0
                        rgb_crop[local_y, max(0, min(crop.width, right)):] = background
                crop = Image.fromarray(rgb_crop)
            if exclusion is not None and exclusion[2] is not None:
                ox, oy, mask = exclusion
                rgb_crop = np.array(crop)
                background = np.median(rgb_crop.reshape(-1, 3), axis=0).astype(np.uint8)
                ax, ay = max(x0, ox), max(y0, oy)
                bx, by = min(x1, ox + mask.shape[1]), min(y1, oy + mask.shape[0])
                if bx > ax and by > ay:
                    view = rgb_crop[ay-y0:by-y0, ax-x0:bx-x0]
                    view[mask[ay-oy:by-oy, ax-ox:bx-ox] > 0] = background
                crop = Image.fromarray(rgb_crop)
            # Preserve source pixels: color-based rule removal also erases
            # faded Tibetan strokes on yellow paper. Row masks above already
            # isolate neighbouring lines without repainting this row.
            # A BDRC rubric band may include a long red rule and blank paper.
            # Locate saturated red glyph components before enlargement so a
            # short inscription is not split into a dozen mostly-empty tiles.
            red_dominant = False
            if exclusion is None and cv2 is not None and np is not None:
                rgb = np.asarray(crop)
                hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
                red = (((hsv[:, :, 0] <= 18) | (hsv[:, :, 0] >= 170)) &
                       (hsv[:, :, 1] >= 110)).astype(np.uint8)
                gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
                dark = (gray < 90) & (red == 0)
                # Scanned frame rules are often pale red (below the stricter
                # rubric-ink threshold), so use a lower threshold for crop
                # segmentation and remove long rules from this mask.
                red_for_glyphs = (((hsv[:, :, 0] <= 22) | (hsv[:, :, 0] >= 165)) &
                                  (hsv[:, :, 1] >= 60)).astype(np.uint8)
                dark = (gray < 90) & (red_for_glyphs == 0)
                if crop.height > crop.width * 2:
                    # Long side rules can touch black characters and merge into
                    # one mixed-color component. Remove vertical rule strokes
                    # from the mask before connected-component cropping.
                        kernel_height = max(12, min(40, round(crop.height * .06)))
                        vertical_kernel = np.ones((kernel_height, 1), dtype=np.uint8)
                        vertical_rules = cv2.morphologyEx(red_for_glyphs, cv2.MORPH_OPEN, vertical_kernel)
                        red_for_glyphs[vertical_rules > 0] = 0
                        rule_columns = np.flatnonzero(
                            vertical_rules.sum(axis=0) >= max(3, round(crop.height * .03))
                        )
                        edge_margin = max(8, round(crop.width * .25))
                        for column in rule_columns:
                            if column < edge_margin or column >= crop.width - edge_margin:
                                # Clear separated red fragments that share the
                                # same page-edge rule column after morphology.
                                red_for_glyphs[:, column] = 0
                mixed_glyph_mask = (((gray < 90) & (red_for_glyphs == 0)) | (red_for_glyphs > 0)).astype(np.uint8)
                if red.sum() >= 40 or dark.sum() >= 40:
                    red_dominant = red.sum() > dark.sum() * 3
                    glyph_mask = red_for_glyphs if red_dominant else mixed_glyph_mask
                    count, labels, stats, _ = cv2.connectedComponentsWithStats(glyph_mask, 8)
                    kept = []
                    for component in range(1, count):
                        cx, cy, cw, ch, area = stats[component]
                        if area < 5 or cw > red.shape[1] * .65 or (cw > ch * 12) or (ch > cw * 4 and ch >= red.shape[0] * .55):
                            continue
                        # Slanted/broken red side rules can survive run filtering.
                        near_edge = cx < 24 or cx + cw > crop.width - 24
                        component_hsv = hsv[cy:cy + ch, cx:cx + cw]
                        component_red = int(((component_hsv[:, :, 1] >= 60) & ((component_hsv[:, :, 0] <= 22) | (component_hsv[:, :, 0] >= 165))).sum())
                        # Side-region crops can be only a few dozen pixels wide,
                        # so a broken frame segment may sit well inside the crop
                        # rather than within the fixed edge margin. In a tall
                        # crop, discard elongated red rules wherever they occur;
                        # actual stacked glyphs remain short connected groups.
                        if (crop.height > crop.width * 2 and ch > cw * 2 and
                                cw <= max(8, crop.width * .2) and component_red >= area * .45):
                            continue
                        # Ignore nearby-row components outside the requested band.
                        center_y = cy + ch / 2 + y0
                        if raw_y - raw_height * .35 <= center_y <= raw_y + raw_height * 1.35:
                            kept.append((cx, cy, cx + cw, cy + ch))
                    if kept and "clip_left" in bbox:
                        # Remove only tiny isolated edge groups: residual frame
                        # fragments must not keep a title's blank margin alive.
                        groups = []
                        for component in sorted(kept, key=lambda item: item[0]):
                            if groups and component[0] - max(item[2] for item in groups[-1]) <= max(24, raw_height * 1.5):
                                groups[-1].append(component)
                            else:
                                groups.append([component])
                        largest = max(sum((b[2] - b[0]) * (b[3] - b[1]) for b in group) for group in groups)
                        retained = []
                        for group in groups:
                            gx0 = min(b[0] for b in group); gx1 = max(b[2] for b in group)
                            area = sum((b[2] - b[0]) * (b[3] - b[1]) for b in group)
                            edge = gx0 < max(32, raw_height * 1.2) or gx1 > crop.width - max(32, raw_height * 1.2)
                            if not (edge and gx1 - gx0 < raw_height and area < largest * .1):
                                retained.extend(group)
                        kept = retained or kept
                    if not kept and red_dominant:
                        # A long red frame can dominate a narrow side crop. Once
                        # the frame is filtered from the red-only mask, fall back
                        # to mixed ink so black side text still gets a tight crop.
                        # This fallback runs after the red-only candidate pass
                        # discarded every tall red component as a frame. Prefer
                        # the separate dark-ink mask so a touching border cannot
                        # rejoin the frame to otherwise valid side text.
                        glyph_mask = ((gray < 90) & (hsv[:, :, 1] < 110)).astype(np.uint8)
                        count, labels, stats, _ = cv2.connectedComponentsWithStats(glyph_mask, 8)
                        for component in range(1, count):
                            cx, cy, cw, ch, area = stats[component]
                            if area < 5 or cw > red.shape[1] * .65 or cw > ch * 12:
                                continue
                            component_hsv = hsv[cy:cy + ch, cx:cx + cw]
                            component_red = int(((component_hsv[:, :, 1] >= 60) & ((component_hsv[:, :, 0] <= 22) | (component_hsv[:, :, 0] >= 165))).sum())
                            if crop.height > crop.width * 2 and ch > cw * 2 and component_red > area * .6:
                                continue
                            if ch > cw * 4 and ch >= red.shape[0] * .55:
                                continue
                            kept.append((cx, cy, cx + cw, cy + ch))
                    if kept:
                        # Tall side inscriptions sit close to the page frame;
                        # the ordinary 8 px row margin can reintroduce that
                        # frame even after its connected component was removed.
                        side_padding = 1 if raw_height > raw_width * 2 else 8
                        tx0 = max(0, min(b[0] for b in kept) - side_padding)
                        tx1 = min(crop.width, max(b[2] for b in kept) + side_padding)
                        # A center-row crop is already bounded by the midpoints
                        # between physical rows. Keep that full safe band: trimming
                        # to connected components clips detached Tibetan marks.
                        ty0, ty1 = 0, crop.height
                        crop = crop.crop((tx0, ty0, tx1, ty1))
                        x0, x1 = int(x0 + tx0), int(x0 + tx1)
                        y0, y1 = int(y0 + ty0), int(y0 + ty1)
            padding_pixels = 0
            if exclusion is not None:
                padding_pixels = max(8, round(raw_height * .12))
                paper = tuple(int(v) for v in np.median(np.asarray(crop).reshape(-1, 3), axis=0))
                padded = Image.new('RGB', (crop.width, crop.height + 2 * padding_pixels), paper)
                padded.paste(crop, (0, padding_pixels))
                crop = padded
            crop_width, crop_height = crop.size
            target_height = max(480, LINE_REVIEW_TARGET_HEIGHT)
            if "clip_top" in bbox or exclusion is not None:
                # Keep glyphs legible without turning a short note into many tiles.
                target_height = min(target_height, max(160, crop_height * 3))
            scale = target_height / max(1, crop_height)
            resampling = getattr(getattr(Image, "Resampling", Image), "LANCZOS")
            enlarged = crop.resize(
                (max(1, round(crop_width * scale)), target_height),
                resampling,
            )
            tile_width = max(480, min(LINE_REVIEW_TILE_WIDTH, max(480, MAX_IMAGE_SIDE)))
            tiles, tile_ranges = split_enlarged_line(enlarged, tile_width)
            return tiles, {
                "crop_version": LINE_CROP_VERSION,
                "padding_pixels": padding_pixels,
                "source_bbox": bbox,
                "ink_color": "red" if red_dominant else "mixed",
                "source_size": {"width": page_width, "height": page_height},
                "crop_pixels": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
                "review_size": {"width": enlarged.width, "height": enlarged.height},
                "tile_count": len(tiles),
                "tile_ranges": tile_ranges,
            }
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError(f"unable to prepare line review crop: {exc}") from exc


def resolve_line_preview_bbox(bbox: dict[str, float], metadata: dict[str, Any], source_size: dict[str, int]) -> dict[str, float]:
    """Reuse source coordinates, but recompute crop limits from older versions."""
    saved_bbox = metadata.get("source_bbox")
    if not saved_bbox or metadata.get("source_size") != source_size:
        return bbox
    if metadata.get("crop_version") != LINE_CROP_VERSION:
        return dict(bbox)
    resolved = dict(saved_bbox)
    if metadata.get("crop_version") != LINE_CROP_VERSION:
        for key in ("clip_top", "clip_bottom", "clip_left", "clip_right", "crop_pad_y"):
            resolved.pop(key, None)
    return resolved

def find_framed_text_region(gray: Any, red_ink: Any) -> tuple[int, int] | None:
    """Find the densest nested red-frame interior, if this is a framed page."""
    height, width = gray.shape[:2]
    horizontal = red_ink.sum(axis=1) >= max(20, round(width * 0.2))
    bands: list[tuple[int, int]] = []
    start = None
    for index, is_active in enumerate(horizontal):
        if is_active and start is None:
            start = index
        elif not is_active and start is not None:
            bands.append((start, index))
            start = None
    if start is not None:
        bands.append((start, height))
    if len(bands) < 2:
        return None

    best_region = None
    # Title pages can contain only a few sparse glyphs between the red rules.
    # Keep the threshold low enough to locate that frame; later rule and
    # region checks still reject pages without a usable three-column layout.
    best_density = 0.0015
    for left_index, left_band in enumerate(bands):
        for right_band in bands[left_index + 1:]:
            y0, y1 = left_band[1], right_band[0]
            if y1 - y0 < max(24, round(height * 0.08)):
                continue
            dark_ink = (gray[y0:y1] < 90) & (~red_ink[y0:y1])
            density = float(dark_ink.mean()) if dark_ink.size else 0.0
            if density > best_density:
                best_density = density
                best_region = (y0, y1)
    return best_region


def _cluster_positions(values: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Cluster nearby line coordinates and keep the strongest score per cluster."""
    clusters: list[list[tuple[float, float]]] = []
    for position, score in sorted(values):
        if not clusters or position - clusters[-1][-1][0] > tolerance:
            clusters.append([(position, score)])
        else:
            clusters[-1].append((position, score))
    return [
        (
            sum(position * score for position, score in cluster) / max(1e-6, sum(score for _, score in cluster)),
            max(score for _, score in cluster),
        )
        for cluster in clusters
    ]


def _hough_vertical_rule_candidates(
    gray: Any, y0: int, y1: int
) -> list[tuple[float, float]]:
    """Find long vertical frame rules when LSD misses faint/slanted lines."""
    if cv2 is None or np is None:
        return []
    height, width = gray.shape[:2]
    y0 = max(0, min(height - 1, int(y0)))
    y1 = max(y0 + 1, min(height, int(y1)))
    crop = gray[y0:y1]
    edges = cv2.Canny(crop, 40, 120)
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(24, round(width * 0.008)),
        minLineLength=max(30, round((y1 - y0) * 0.45)),
        maxLineGap=max(8, round((y1 - y0) * 0.08)),
    )
    candidates: list[tuple[float, float]] = []
    for line in lines if lines is not None else []:
        x_start, y_start, x_end, y_end = map(float, line[0])
        dx = x_end - x_start
        dy = y_end - y_start
        length = abs(dy)
        # Glyph strokes can also look vertical, but they are shorter than the
        # long rules that span most of the inner frame.
        if length < (y1 - y0) * 0.55 or length < abs(dx) * 2:
            continue
        x = (x_start + x_end) / 2.0
        if x < width * 0.03 or x > width * 0.97:
            continue
        candidates.append((x, length))
    return candidates


def _red_vertical_rule_candidates(
    red_ink: Any, y0: int, y1: int
) -> list[tuple[float, float]]:
    """Find long, slightly slanted frame rules from the red-ink mask.

    At the browser's PDF render resolution the faded red rules can have too
    little grayscale contrast for the ordinary edge detector.  Their hue and
    saturation remain distinctive, so run the same line search on that mask.
    """
    if cv2 is None or np is None:
        return []
    height, width = red_ink.shape[:2]
    y0 = max(0, min(height - 1, int(y0)))
    y1 = max(y0 + 1, min(height, int(y1)))
    crop = (red_ink[y0:y1].astype(np.uint8) * 255)
    edges = cv2.Canny(crop, 30, 100)
    frame_height = y1 - y0
    lines = cv2.HoughLinesP(
        edges,
        1,
        np.pi / 180,
        threshold=max(16, round(width * 0.002)),
        minLineLength=max(30, round(frame_height * 0.4)),
        maxLineGap=max(8, round(frame_height * 0.12)),
    )
    candidates: list[tuple[float, float]] = []
    for line in lines if lines is not None else []:
        x_start, y_start, x_end, y_end = map(float, line[0])
        dx = x_end - x_start
        dy = y_end - y_start
        vertical_length = abs(dy)
        if vertical_length < frame_height * 0.45 or vertical_length < abs(dx) * 2:
            continue
        x = (x_start + x_end) / 2.0
        if x < width * 0.03 or x > width * 0.97:
            continue
        candidates.append((x, vertical_length))
    return candidates


def _select_traditional_boundaries(
    clusters: list[tuple[float, float]], width: int
) -> list[float]:
    """Choose the outer and inner rules for the two side strips."""
    if len(clusters) < 4:
        return []
    positions = [position for position, _ in clusters]
    # A traditional pecha frame has two rule pairs near its left and right
    # margins.  The outer/inner rule in each pair defines a side strip; the
    # two inner rules define the wide center column.  Keeping the search in
    # those margin bands prevents red title glyphs from splitting the center.
    left_rules = [position for position in positions if position <= width * 0.30]
    right_rules = [position for position in positions if position >= width * 0.70]
    if len(left_rules) >= 2 and len(right_rules) >= 2:
        boundary_set = [left_rules[0], left_rules[-1], right_rules[0], right_rules[-1]]
        left_width = boundary_set[1] - boundary_set[0]
        center_width = boundary_set[2] - boundary_set[1]
        right_width = boundary_set[3] - boundary_set[2]
        if (
            center_width >= width * 0.25
            and 0 < left_width <= width * 0.22
            and 0 < right_width <= width * 0.22
        ):
            return boundary_set

    best: tuple[float, list[float]] | None = None
    left_start = positions[0]
    right_end = positions[-1]
    # Red title glyphs can appear as short vertical candidates inside the
    # middle column.  Consider non-adjacent candidates so that they do not
    # split the center column into several false gaps.
    for center_start_index in range(1, len(positions) - 2):
        for center_end_index in range(center_start_index + 1, len(positions) - 1):
            center_start = positions[center_start_index]
            center_end = positions[center_end_index]
            center_width = center_end - center_start
            left_width = center_start - left_start
            right_width = right_end - center_end
            if center_width < width * 0.25:
                continue
            if not (
                0 < left_width <= width * 0.22
                and 0 < right_width <= width * 0.22
            ):
                continue
            side_ratio = min(left_width, right_width) / max(left_width, right_width)
            if side_ratio < 0.7:
                continue
            score = center_width - abs(left_width - right_width) * 1.5
            boundary_set = [left_start, center_start, center_end, right_end]
            if best is None or score > best[0]:
                best = (score, boundary_set)
    return best[1] if best else []


def _projection_vertical_rule_candidates(red_ink: Any) -> list[tuple[float, float]]:
    """Recover faint side rules that Hough misses on low-contrast PDF pages."""
    height, width = red_ink.shape[:2]
    relaxed = red_ink.astype(np.uint8)
    window = max(11, round(width * .007))
    if window % 2 == 0:
        window += 1
    scores = cv2.GaussianBlur(relaxed.sum(axis=0).astype(np.float32).reshape(1, -1),
                              (window, 1), 0).ravel()
    candidates = []
    min_gap = max(20, round(width * .012))
    for start, end in ((round(width * .02), round(width * .30)),
                       (round(width * .70), round(width * .995))):
        remaining = scores[start:end].copy()
        for _ in range(8):
            local = int(np.argmax(remaining))
            x = start + local
            if remaining[local] < height * .04:
                break
            lo, hi = max(0, x - min_gap // 2), min(width, x + min_gap // 2 + 1)
            support = float(relaxed[:, lo:hi].any(axis=1).mean())
            if support >= .38:
                candidates.append((float(x), height * support))
            remaining[max(0, local - min_gap):min(len(remaining), local + min_gap + 1)] = 0
    return candidates


def _select_fallback_boundaries(clusters: list[tuple[float, float]], width: int) -> list[float]:
    left = sorted(x for x, _ in clusters if width * .02 <= x < width * .30)
    right = sorted(x for x, _ in clusters if width * .70 < x <= width * .995)
    if len(left) < 2 or len(right) < 2:
        return []
    outer_left, inner_left, outer_right = left[0], left[-1], right[-1]
    inner_right = next((x for x in reversed(right[:-1]) if outer_right - x >= width * .012), None)
    if inner_right is None or inner_left - outer_left < width * .012:
        return []
    if inner_right - inner_left < width * .25:
        return []
    return [outer_left, inner_left, inner_right, outer_right]


def detect_traditional_column_bboxes(image_bytes: bytes) -> list[dict[str, float]]:
    """Find the three text columns inside a traditional pecha page frame.

    Traditional pages have a narrow side strip on each side of a wide central
    text area. The side strips are bounded by long, slightly slanted vertical
    rules. LSD is used instead of a simple red-pixel projection because the
    red ink can be faint or yellowed in scanned pages.
    """
    if cv2 is None or np is None:
        return []
    color = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if color is None:
        return []
    height, width = color.shape[:2]
    if width < 100 or height < 40:
        return []

    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(color, cv2.COLOR_BGR2HSV)
    hue, saturation, _ = cv2.split(hsv)
    red_ink = (saturation >= 80) & ((hue <= 22) | (hue >= 165))
    frame_region = find_framed_text_region(gray, red_ink)
    y0, y1 = frame_region if frame_region else (0, height)

    # LSD finds both red rules and dark rules after scanning/deskewing. Keep
    # lines that cross most of the text frame, then cluster duplicate edges.
    detector = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
    segments = detector.detect(gray)[0]
    candidates: list[tuple[float, float]] = []
    min_length = max(25.0, height * 0.22)
    for segment in segments if segments is not None else []:
        x1, y_start, x2, y_end = map(float, segment[0])
        dx = x2 - x1
        dy = y_end - y_start
        length = float((dx * dx + dy * dy) ** 0.5)
        if length < min_length or abs(dy) < 1:
            continue
        if abs(dx) > abs(dy) * 0.25:
            continue
        overlap = min(y1, max(y_start, y_end)) - max(y0, min(y_start, y_end))
        if overlap < (y1 - y0) * 0.35:
            continue
        x = (x1 + x2) / 2.0
        if x < width * 0.04 or x > width * 0.96:
            continue
        candidates.append((x, length * max(0.25, overlap / max(1.0, y1 - y0))))

    clusters = _cluster_positions(
        candidates
        + _hough_vertical_rule_candidates(gray, y0, y1)
        + _red_vertical_rule_candidates(red_ink, y0, y1),
        max(10.0, width * 0.012),
    )
    boundaries = _select_traditional_boundaries(clusters, width) if frame_region else []
    if len(boundaries) != 4:
        # The usual detector depends on complete red frame bands. Several
        # scanned pages have broken bands but still show two long side rules
        # on each side. Recover only those high-coverage margin rules.
        relaxed_red = (saturation >= 55) & ((hue <= 25) | (hue >= 165))
        fallback = _cluster_positions(
            _red_vertical_rule_candidates(relaxed_red, 0, height)
            + _projection_vertical_rule_candidates(relaxed_red),
            max(8.0, width * .006),
        )
        boundaries = _select_fallback_boundaries(fallback, width)
        if len(boundaries) == 4 and not frame_region:
            center_ink = gray[:, round(boundaries[1]):round(boundaries[2])] < 130
            density = center_ink.mean(axis=1)
            active = np.flatnonzero(density > .002)
            if active.size:
                margin = max(8, round(height * .025))
                y0 = max(0, int(active[0]) - margin)
                y1 = min(height, int(active[-1]) + margin)
    if len(boundaries) != 4:
        return []
    if not (boundaries[0] < boundaries[1] < boundaries[2] < boundaries[3]):
        return []

    top = max(0.0, y0 / height)
    bottom = min(1.0, y1 / height)
    regions = []
    labels = ("left", "center", "right")
    for label, start, end in zip(labels, boundaries, boundaries[1:]):
        regions.append({
            "id": label,
            "label": {"left": "左侧", "center": "中间", "right": "右侧"}[label],
            "role": "body" if label == "center" else "side",
            "direction": "horizontal" if label == "center" else "vertical",
            "text_orientation": "horizontal" if label == "center" else "vertical-or-page-number",
            "region_type": "body" if label == "center" else "margin",
            "x": round(max(0.0, start / width), 6),
            "y": round(top, 6),
            "width": round(max(0.0, (end - start) / width), 6),
            "height": round(max(0.0, bottom - top), 6),
        })
    return regions


def detect_physical_text_line_bboxes(image_bytes, include_masks=False):
    """Find row bodies by density peaks, keeping detached Tibetan stack marks.

    A nonzero projection is not a line boundary: slanted neighbouring rows can
    overlap vertically, while detached marks can create gaps inside one row.
    """
    if cv2 is None or np is None:
        return []
    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        return []
    height, width = image.shape[:2]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    # Faded lower stacks still belong to a glyph. Use paper-relative pale
    # ink for component extents and seams, but dark cores for row peaks.
    pale_limit = min(210, float(np.median(gray)) - 30)
    mask = ((gray < pale_limit) | ((hsv[:, :, 1] > 100) &
            ((hsv[:, :, 0] < 22) | (hsv[:, :, 0] > 165)))).astype(np.uint8)
    # Remove connected frame rules, including slanted rules. Do not erase a
    # whole scanline just because one long ink run occurs on it.
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    components = []
    accepted = np.zeros(count, dtype=np.uint8)
    for label, (x, y, w, h, area) in enumerate(stats[1:], 1):
        red_fraction = float(((hsv[y:y+h, x:x+w, 1] > 100) &
                              ((hsv[y:y+h, x:x+w, 0] < 22) | (hsv[y:y+h, x:x+w, 0] > 165))).mean())
        rule = red_fraction > .35 and (w > h * 8 or h > w * 4)
        if area >= max(3, height * .015) and w <= width * .55 and h <= height * .8 and not rule:
            accepted[label] = 1
            components.append((label, int(x), int(y), int(w), int(h)))
    mask = accepted[labels]
    margin = max(1, round(width * .025))
    core = mask & ((gray < 135) | (hsv[:, :, 1] > 100)).astype(np.uint8)
    density = core[:, margin:width - margin].sum(axis=1).astype(np.float64)
    smooth = cv2.GaussianBlur(density.reshape(-1, 1), (1, 0),
                             sigmaX=0, sigmaY=max(2, height * .015)).ravel()
    if not smooth.size or smooth.max() < 3:
        return []
    candidates = [i for i in range(1, height - 1)
                  if smooth[i] > smooth[i - 1] and smooth[i] >= smooth[i + 1]]
    peaks = []
    for i in sorted(candidates, key=lambda i: smooth[i], reverse=True):
        if any(abs(i - old) < max(8, height * .065) for old in peaks):
            continue
        left = i - 1
        while left > 0 and smooth[left] <= smooth[i]:
            left -= 1
        right = i + 1
        while right < height - 1 and smooth[right] <= smooth[i]:
            right += 1
        prominence = smooth[i] - max(smooth[left:i + 1].min(), smooth[i:right + 1].min())
        if prominence >= max(3, smooth.max() * .065):
            peaks.append(i)
    peaks.sort()
    if not peaks:
        return []
    cuts = [0] + [a + int(np.argmin(smooth[a:b + 1]))
                  for a, b in zip(peaks, peaks[1:])] + [height]
    # Follow local valleys across x: a horizontal cut can cross the top of a
    # sloping row at one end and the preceding row at the other end.
    local_density = cv2.boxFilter(mask.astype(np.float32), -1,
                                 (max(31, round(width * .09)), max(3, round(height * .015))))
    seams = [np.zeros(width, dtype=np.float32)]
    for left, right in zip(peaks, peaks[1:]):
        start = round(left + (right - left) * .22)
        end = max(start + 1, round(right - (right - left) * .22))
        seam = start + np.argmin(local_density[start:end], axis=0)
        seam = cv2.GaussianBlur(seam.astype(np.float32).reshape(1, -1), (0, 1),
                                sigmaX=max(2, width * .01)).ravel()
        seams.append(seam)
    seams.append(np.full(width, height, dtype=np.float32))
    groups = [[] for _ in peaks]
    for component in components:
        _, x, y, w, h = component
        if h > height * .45:
            continue
        center = y + h / 2
        cx = min(width - 1, x + w // 2)
        row = next((i for i in range(len(peaks)) if seams[i][cx] <= center < seams[i + 1][cx]), len(peaks) - 1)
        groups[row].append(component)
    rows = []
    for i, group in enumerate(groups):
        if not group:
            continue
        x0 = min(c[1] for c in group); x1 = max(c[1] + c[3] for c in group)
        y0 = min(c[2] for c in group); y1 = max(c[2] + c[4] for c in group)
        row = {'x': x0 / width, 'y': y0 / height,
                     'width': (x1 - x0) / width, 'height': (y1 - y0) / height,
                     'clip_top': cuts[i] / height, 'clip_bottom': cuts[i + 1] / height}
        if include_masks:
            top, bottom = seams[i].copy(), seams[i + 1].copy()
            for _, x, y, w, h in group:
                top[x:x+w] = np.minimum(top[x:x+w], y - 2)
                bottom[x:x+w] = np.maximum(bottom[x:x+w], y + h + 2)
            yy = np.arange(height)[:, None]
            row['_exclusion'] = ((yy < top[None, :]) | (yy >= bottom[None, :])).astype(np.uint8)
        rows.append(row)
    return rows


def detect_pillow_text_line_bboxes(image_bytes: bytes) -> list[dict[str, float]]:
    """Find separate horizontal ink bands with hard inter-line crop limits."""
    if Image is None:
        return []
    with Image.open(BytesIO(image_bytes)) as original:
        gray = original.convert("L")
        gray.thumbnail((1600, 1600))
    width, height = gray.size
    pixels = gray.load()
    spans = []
    for y in range(height):
        xs = [x for x in range(width) if pixels[x, y] < 160]
        spans.append((min(xs), max(xs)) if max(3, width * .003) <= len(xs) < width * .85 else None)
    bands = []
    start = last = None
    # Two blank scan rows already separate the small title from the next line.
    gap = max(1, round(height * .0015))
    for y, span in enumerate(spans + [None] * (gap + 1)):
        if span is not None:
            if start is None:
                start = y
            last = y
        elif start is not None and y - last > gap:
            if last - start >= 2:
                occupied = [v for v in spans[start:last + 1] if v is not None]
                bands.append((min(v[0] for v in occupied), max(v[1] for v in occupied) + 1, start, last + 1))
            start = last = None
    boxes = []
    for i, (x0, x1, y0, y1) in enumerate(bands):
        top = (bands[i - 1][3] + y0) / 2 if i else max(0, y0 - 2)
        bottom = (y1 + bands[i + 1][2]) / 2 if i + 1 < len(bands) else min(height, y1 + 2)
        boxes.append(dict(x=x0 / width, y=y0 / height,
                          width=(x1 - x0) / width, height=(y1 - y0) / height,
                          clip_top=top / height, clip_bottom=bottom / height))
    return boxes


def bound_projection_line_crop(image_bytes, bbox):
    """Repair old multi-row boxes without changing saved transcription data."""
    rows = detect_pillow_text_line_bboxes(image_bytes)
    if not rows:
        raise RuntimeError("未检测到独立文字行，无法生成单行预览")
    center = bbox["y"] + bbox["height"] / 2
    row = min(rows, key=lambda r: abs(r["y"] + r["height"] / 2 - center))
    # A large/unknown region must not silently select a distant line.
    if row["y"] >= bbox["y"] + bbox["height"] or row["y"] + row["height"] <= bbox["y"]:
        raise RuntimeError("原坐标与文字行不相交，无法可靠生成单行预览")
    return {**bbox, **row}


def detect_text_line_bboxes(image_bytes: bytes) -> list[dict[str, float]]:
    """Detect text bands while rejecting thin page borders and rules."""
    if cv2 is None or np is None:
        return detect_pillow_text_line_bboxes(image_bytes)

    color = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_COLOR)
    if color is None:
        return []
    height, width = color.shape[:2]
    if not width or not height:
        return []

    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(color, cv2.COLOR_BGR2HSV)
    hue, saturation, _ = cv2.split(hsv)
    red_ink = (saturation >= 120) & ((hue <= 18) | (hue >= 170))
    ink = (gray < 90) | red_ink
    frame_region = find_framed_text_region(gray, red_ink)

    # Long horizontal/vertical runs are usually pecha frames, table rules, or
    # scan edges. Remove their rows before projecting text density. Tibetan
    # glyphs have short disconnected runs, so this does not remove text rows.
    clean = ink.copy()
    max_rule_run = max(30, round(width * 0.03))
    for row_index, row in enumerate(ink):
        transitions = np.diff(np.r_[False, row, False].astype(np.int8))
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1)
        if starts.size and int((ends - starts).max()) > max_rule_run:
            clean[row_index] = False

    # Vertical frame rules otherwise remain active through many text rows and
    # make every detected text band appear as wide as the whole inner frame.
    # Remove only continuous, page-scale runs; Tibetan glyph strokes are much
    # shorter and stay available to the row projection.
    max_vertical_rule_run = max(30, round(height * 0.12))
    for column_index, column in enumerate(clean.T):
        transitions = np.diff(np.r_[False, column, False].astype(np.int8))
        starts = np.flatnonzero(transitions == 1)
        ends = np.flatnonzero(transitions == -1)
        for start, end in zip(starts, ends):
            if end - start > max_vertical_rule_run:
                clean[start:end, column_index] = False

    # A narrow outer margin avoids scan-edge noise while preserving ordinary
    # modern printed lines. The original adaptive detector remains the
    # fallback for low-contrast pages where this mask finds too little text.
    margin = round(width * 0.1)
    x_start, x_end = margin, width - margin
    scan_start, scan_end = frame_region or (0, height)
    row_density = clean[scan_start:scan_end, x_start:x_end].sum(axis=1)
    active = row_density >= max(3, round((x_end - x_start) * 0.02))
    bands: list[tuple[int, int]] = []
    start = None
    gap = 0
    max_gap = max(2, round(height * 0.003))
    min_height = max(3, round(height * 0.006))
    for index, is_active in enumerate(active):
        if is_active:
            if start is None:
                start = index
            gap = 0
            continue
        if start is None:
            continue
        gap += 1
        if gap > max_gap:
            end = index - gap + 1
            if end - start >= min_height:
                bands.append((start + scan_start, end + scan_start))
            start = None
            gap = 0
    if start is not None and scan_end - scan_start - start >= min_height:
        bands.append((start + scan_start, scan_end))

    boxes: list[dict[str, float]] = []
    for start, end in bands:
        columns = clean[start:end].sum(axis=0)
        occupied = np.flatnonzero(columns >= 1)
        if occupied.size == 0:
            continue
        pad_x = max(2, round(width * 0.006))
        pad_y = max(2, round(height * 0.006))
        x0 = max(0, int(occupied[0]) - pad_x)
        x1 = min(width, int(occupied[-1]) + 1 + pad_x)
        y0 = max(0, start - pad_y)
        y1 = min(height, end + pad_y)
        boxes.append({
            "x": round(x0 / width, 6),
            "y": round(y0 / height, 6),
            "width": round((x1 - x0) / width, 6),
            "height": round((y1 - y0) / height, 6),
        })

    # A page rule that survives masking is usually very thin and spans most of
    # the page. Exclude it before mapping model lines to source blocks.
    boxes = [
        box for box in boxes
        if not (box["height"] < 0.03 and box["width"] > 0.55)
    ]

    if len(boxes) >= 2:
        return boxes
    return detect_adaptive_text_line_bboxes(gray)


def detect_adaptive_text_line_bboxes(image: Any) -> list[dict[str, float]]:
    """Fallback projection for low-contrast pages without visible rules."""
    height, width = image.shape[:2]
    binary = cv2.adaptiveThreshold(
        image,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        15,
    )
    row_density = (binary > 0).sum(axis=1)
    active = row_density >= max(3, int(width * 0.004))
    bands: list[tuple[int, int]] = []
    start = None
    gap = 0
    max_gap = max(3, round(height * 0.004))
    min_height = max(3, round(height * 0.006))
    for index, is_active in enumerate(active):
        if is_active:
            if start is None:
                start = index
            gap = 0
            continue
        if start is None:
            continue
        gap += 1
        if gap > max_gap:
            end = index - gap + 1
            if end - start >= min_height:
                bands.append((start, end))
            start = None
            gap = 0
    if start is not None and height - start >= min_height:
        bands.append((start, height))

    boxes: list[dict[str, float]] = []
    for start, end in bands:
        columns = (binary[start:end] > 0).sum(axis=0)
        occupied = np.flatnonzero(columns >= 1)
        if occupied.size == 0:
            continue
        pad_x = max(2, round(width * 0.006))
        pad_y = max(2, round(height * 0.006))
        x0 = max(0, int(occupied[0]) - pad_x)
        x1 = min(width, int(occupied[-1]) + 1 + pad_x)
        y0 = max(0, start - pad_y)
        y1 = min(height, end + pad_y)
        boxes.append({
            "x": round(x0 / width, 6),
            "y": round(y0 / height, 6),
            "width": round((x1 - x0) / width, 6),
            "height": round((y1 - y0) / height, 6),
        })
    return boxes


def attach_layout_bboxes(
    lines: list[dict[str, Any]], image_bytes: bytes
) -> tuple[list[dict[str, Any]], list[dict[str, float]]]:
    boxes = detect_text_line_bboxes(image_bytes)
    if not boxes or not lines:
        return lines, boxes
    if len(lines) == len(boxes):
        return [dict(line, bbox=box) for line, box in zip(lines, boxes)], boxes

    # Some vision models merge adjacent physical lines into one response line.
    # Keep one physical band per response line. Merging bands makes the source
    # preview show multiple rows and is worse for proofreading than an explicit
    # approximate one-row mapping.
    if len(boxes) > len(lines):
        mapped: list[dict[str, float]] = []
        for line_index in range(len(lines)):
            box_index = round(line_index * (len(boxes) - 1) / max(1, len(lines) - 1))
            mapped.append(boxes[box_index])
        return [dict(line, bbox=box, bbox_approximate=True) for line, box in zip(lines, mapped)], boxes

    # A detector can merge closely spaced Tibetan rows into one band. When the
    # vision model returned more rows, split the tallest detected bands so every
    # OCR row remains locatable. These are explicitly approximate coordinates.
    if len(lines) > len(boxes):
        split_boxes = split_layout_bboxes(boxes, len(lines))
        return [dict(line, bbox=box, bbox_approximate=True) for line, box in zip(lines, split_boxes)], boxes
    return lines, boxes


def crop_image_to_bbox(image_bytes: bytes, bbox: dict[str, float], padding: bool = True) -> bytes:
    """Crop a normalized region while retaining a small border for glyphs."""
    if Image is None:
        return image_bytes
    with Image.open(BytesIO(image_bytes)) as image:
        image.load()
        width, height = image.size
        pad_x = max(3, round(width * 0.008)) if padding else 0
        pad_y = max(3, round(height * 0.012)) if padding else 0
        x0 = max(0, round(bbox["x"] * width) - pad_x)
        y0 = max(0, round(bbox["y"] * height) - pad_y)
        x1 = min(width, round((bbox["x"] + bbox["width"]) * width) + pad_x)
        y1 = min(height, round((bbox["y"] + bbox["height"]) * height) + pad_y)
        cropped = image.crop((x0, y0, x1, y1)).convert("RGB")
        output = BytesIO()
        cropped.save(output, format="PNG", optimize=True)
        return output.getvalue()


def merge_physical_row_fragments(boxes, max_gap=0.02):
    """Match BDRC's physical-row merging without importing its model runtime."""
    merged = []
    for raw in sorted(boxes, key=lambda box: box["y"]):
        box = dict(raw)
        if merged and box["y"] - (merged[-1]["y"] + merged[-1]["height"]) <= max_gap:
            previous = merged[-1]
            right = max(previous["x"] + previous["width"], box["x"] + box["width"])
            bottom = max(previous["y"] + previous["height"], box["y"] + box["height"])
            previous["x"] = min(previous["x"], box["x"])
            previous["width"] = right - previous["x"]
            previous["height"] = bottom - previous["y"]
        else:
            merged.append(box)
    return merged


def detect_sparse_side_bbox(crop):
    """Find dark side glyphs, excluding coloured rules and empty paper."""
    image = cv2.imdecode(np.frombuffer(crop, dtype=np.uint8), cv2.IMREAD_COLOR)
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = ((gray < 140) & (hsv[:, :, 1] < 110)).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    kept = [stat for stat in stats[1:] if stat[4] >= 5 and stat[2] < image.shape[1] * .7 and stat[3] < image.shape[0] * .7]
    if not kept:
        return []
    x0 = min(stat[0] for stat in kept); y0 = min(stat[1] for stat in kept)
    x1 = max(stat[0] + stat[2] for stat in kept); y1 = max(stat[1] + stat[3] for stat in kept)
    return [{"x": x0 / image.shape[1], "y": y0 / image.shape[0],
             "width": (x1 - x0) / image.shape[1], "height": (y1 - y0) / image.shape[0]}]


def call_traditional_region_ocr(
    image_bytes: bytes, filename: str, prompt: str, regions: list[dict[str, float]], layout_only: bool = False
) -> dict[str, Any]:
    """Locate display rows, then recognize center rows from the original page."""
    if not layout_only:
        layout = call_traditional_region_ocr(image_bytes, filename, prompt, regions, layout_only=True)
        rows = [{"index": index, "bbox": line["bbox"]} for index, line in enumerate(layout["lines"])
                if line.get("region_id") == "center"]
        result = call_gemini_page_review(image_bytes, filename, rows, MODEL.removeprefix("gemini:"))
        by_index = {line["index"]: line for line in result["lines"]}
        lines = [{**line, "text": by_index[index]["text"], "missing": False}
                 if index in by_index else {**line, "text": "", "missing": True}
                 for index, line in enumerate(layout["lines"])]
        return {**layout, "text": "\n".join(line["text"] for line in lines if line["text"]),
                "lines": lines, "model": result["model"], "provider": "gemini",
                "layout_only": False, "line_ocr": False, "failed_line_count": 0,
                "recognition_scope": "whole-page"}
    blocks = []
    models = []
    for original_region in regions:
        region = dict(original_region)
        if region['id'] == 'center':
            region['y'] = max(0, original_region['y'] - original_region['height'] * .15)
            region['height'] = min(1, original_region['y'] + original_region['height'] * 1.15) - region['y']
        crop = crop_image_to_bbox(image_bytes, region, padding=False)
        local_boxes = detect_physical_text_line_bboxes(crop) if region["id"] == "center" else detect_sparse_side_bbox(crop)
        boxes = [{
                "x": region["x"] + box["x"] * region["width"],
                "y": region["y"] + box["y"] * region["height"],
                "width": box["width"] * region["width"],
                "height": box["height"] * region["height"],
            } for box in local_boxes]
        if region["id"] == "center" and len(local_boxes) == 1 and local_boxes[0]["height"] > .65:
            raise RuntimeError("中间区域没有可靠分行，请调整定位后重试。")
        if not boxes and region["id"] != "center":
            continue
        if not boxes:
            raise RuntimeError(f"{region['label']}未定位到文字行，请调整定位后重试；不会退回整页识别。")
        for index, box in enumerate(boxes):
            # Limit vertical padding at neighbouring row midpoints.
            if region["id"] == "center":
                box = dict(box)
                box["clip_left"] = region["x"] + region["width"] * .01
                box["clip_right"] = region["x"] + region["width"] * .99
                box["clip_top"] = (boxes[index - 1]["y"] + boxes[index - 1]["height"] + box["y"]) / 2 if index else region["y"]
                box["clip_bottom"] = (box["y"] + box["height"] + boxes[index + 1]["y"]) / 2 if index + 1 < len(boxes) else region["y"] + region["height"]
            try:
                if layout_only:
                    _, metadata = prepare_line_review_images(image_bytes, box)
                    result = {"text": "", "review_image": metadata}
                else:
                    result = call_line_review_vision(image_bytes, filename, box, model=MODEL.removeprefix("gemini:") if USE_MODEL_AGGREGATOR else "", allow_page_numbers=region["id"] != "center")
                text = str(result.get("text") or "").strip()
                model = result.get("model", "")
                models.append(model)
                block = {"text": text or ("〔尚未识别〕" if layout_only else "〔本行未返回文字，待重新识别〕"), "review_image": result.get("review_image"), "missing": not bool(text)}
            except Exception as exc:
                try:
                    _, review_image = prepare_line_review_images(image_bytes, box)
                except RuntimeError:
                    review_image = None
                block = {"text": "〔本行识别失败，待重新识别〕", "error": True, "missing": True, "review_image": review_image,
                         "recognition_error": redact_sensitive(str(exc))}
            metadata = block.get("review_image") or {}
            pixels, source_size = metadata.get("crop_pixels"), metadata.get("source_size")
            display_bbox = {key: box[key] for key in ("x", "y", "width", "height")}
            if pixels and source_size:
                display_bbox = {"x": pixels["x"] / source_size["width"], "y": pixels["y"] / source_size["height"],
                                "width": pixels["width"] / source_size["width"], "height": pixels["height"] / source_size["height"]}
            blocks.append({**block, "bbox": display_bbox,
                           "region_id": region["id"], "region_label": region["label"],
                           "region_direction": region.get("direction", "horizontal"), "region_line_index": index, "line_count": 1,
                           "bbox_approximate": False})
    return {"text": "\n".join(block["text"] for block in blocks), "lines": blocks,
            "region_order": ["left", "center", "right"], "layout_bboxes": regions,
            "layout_bbox_source": "traditional-physical-lines", "line_ocr": True,
            "failed_line_count": sum(bool(block.get("error") or block.get("missing")) for block in blocks),
            "layout_only": layout_only,
            "model": next((model for model in models if model), MODEL), "provider": "gemini"}


def split_layout_bboxes(
    boxes: list[dict[str, float]], target_count: int
) -> list[dict[str, float]]:
    allocations = [1] * len(boxes)
    while sum(allocations) < target_count:
        target_index = max(
            range(len(boxes)),
            key=lambda index: boxes[index]["height"] / allocations[index],
        )
        allocations[target_index] += 1

    split: list[dict[str, float]] = []
    for box, count in zip(boxes, allocations):
        row_height = box["height"] / count
        for row_index in range(count):
            split.append({
                "x": box["x"],
                "y": round(box["y"] + row_height * row_index, 6),
                "width": box["width"],
                "height": round(row_height, 6),
            })
    return split


def build_layout_payload(image_bytes: bytes, line_count: int) -> dict[str, Any]:
    """Bind equal-count physical text rows; never stretch or split a mapping."""
    count = max(0, int(line_count))
    boxes = detect_pillow_text_line_bboxes(image_bytes)
    # Isolated, narrow bottom folio numbers are not Tibetan transcription rows.
    text_boxes = [box for box in boxes if not (
        box["y"] > .94 and box["width"] < .15 and box["height"] < .04)]
    matched = bool(count and len(text_boxes) == count)
    return {"lines": [{"text": "", "bbox": box, "source_row_index": i}
                      for i, box in enumerate(text_boxes)] if matched else [],
            "layout_bboxes": text_boxes, "layout_bbox_source": "physical-rows-v2",
            "alignment_version": 2, "alignment_matched": matched,
            "detected_line_count": len(text_boxes), "requested_line_count": count}

def parse_model_text(payload: dict[str, Any]) -> str:
    if isinstance(payload.get("text"), str):
        return payload["text"]
    if isinstance(payload.get("output"), str):
        return payload["output"]

    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message", {}) if isinstance(choices[0], dict) else {}
        content = message.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            chunks = []
            for item in content:
                if isinstance(item, dict) and isinstance(item.get("text"), str):
                    chunks.append(item["text"])
            if chunks:
                return "\n".join(chunks)

    return json.dumps(payload, ensure_ascii=False)


def post_json(url: str, body: dict[str, Any], api_key: str = "", timeout: float | None = None) -> dict[str, Any]:
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT if timeout is None else timeout) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"AI Vision upstream HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"AI Vision upstream unavailable: {exc.reason}") from exc
    except TimeoutError as exc:
        raise RuntimeError("AI Vision upstream request timed out") from exc

    return json.loads(response_body)


def get_json(url: str, api_key: str = "", timeout: float = 3.0) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"Accept": "application/json"}, method="GET")
    if api_key:
        request.add_header("Authorization", f"Bearer {api_key}")

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            response_body = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"unavailable: {exc.reason}") from exc

    return json.loads(response_body)


def summarize_attempts(attempts: Any) -> str:
    if not isinstance(attempts, list) or not attempts:
        return ""
    chunks: list[str] = []
    for attempt in attempts[:6]:
        if not isinstance(attempt, dict):
            continue
        model = attempt.get("modelRef") or attempt.get("model") or "model"
        status = attempt.get("status") or "unknown"
        error = compact_upstream_error(str(attempt.get("error") or ""))
        raw = attempt.get("raw")
        if isinstance(raw, dict):
            feedback = raw.get("promptFeedback") or {}
            blocked = feedback.get("blockReason") if isinstance(feedback, dict) else None
            if blocked:
                error = f"上游拒绝生成（blockReason={blocked}），未返回识别文字"
            version = raw.get("modelVersion")
            if version:
                error += f"；实际模型={version}"
        chunks.append(f"{model}: {status}" + (f" ({redact_sensitive(str(error))})" if error else ""))
    return "；".join(chunks)


def compact_upstream_error(text: str) -> str:
    lowered = text.lower()
    if "http 503" in lowered or '"code": 503' in lowered or "unavailable" in lowered:
        if "high demand" in lowered:
            return "HTTP 503 high demand，模型暂时拥堵"
        return "HTTP 503，模型服务暂时不可用"
    if "timed out" in lowered or "timeout" in lowered:
        return "请求超时"
    if "429" in lowered or "resource_exhausted" in lowered:
        return "额度或频率限制"
    return text[:220] + ("..." if len(text) > 220 else "")


def redact_sensitive(text: str) -> str:
    redacted = text
    for credential in (API_KEY, AGGREGATOR_API_KEY, OPENAI_REVIEW_API_KEY, QWEN_REVIEW_API_KEY):
        if credential:
            redacted = redacted.replace(credential, "***REDACTED***")
    redacted = re.sub(r"([?&]key=)[^&\s)]+", r"\1***REDACTED***", redacted)
    redacted = re.sub(r"(Authorization:\s*Bearer\s+)[A-Za-z0-9._~+/=-]+", r"\1***REDACTED***", redacted)
    redacted = re.sub(r"AIza[0-9A-Za-z_-]{20,}", "***REDACTED***", redacted)
    redacted = re.sub(r"sk-[A-Za-z0-9._-]{8,}", "***REDACTED***", redacted)
    return redacted


def call_model_aggregator_images(
    images: list[tuple[bytes, str]], prompt: str, *, preserve_size: bool = False, model_override: str = "", request_timeout: float | None = None
) -> dict[str, Any]:
    """Send one or more ordered image attachments in a single vision request."""
    attachment_ids: list[str] = []
    sent_sizes: list[int] = []
    for image_bytes, filename in images:
        if preserve_size:
            prepared_bytes = image_bytes
            prepared_filename = filename
            mime_type = mimetypes.guess_type(filename)[0] or "image/png"
        else:
            prepared_bytes, prepared_filename, mime_type = prepare_vision_image(image_bytes, filename)
        data_url = image_data_url(prepared_bytes, prepared_filename)
        upload = post_json(
            aggregator_url("/api/aggregate/upload"),
            {
                "name": prepared_filename,
                "kind": "image",
                "mimeType": mime_type,
                "size": len(prepared_bytes),
                "dataUrl": data_url,
            },
            AGGREGATOR_API_KEY,
        )
        if not upload.get("ok") or not upload.get("id"):
            raise RuntimeError(f"ModelAggregator upload failed: {upload.get('error') or upload}")
        attachment_ids.append(str(upload["id"]))
        sent_sizes.append(len(prepared_bytes))

    request_body: dict[str, Any] = {
        "attachmentIds": attachment_ids,
        "prompt": prompt,
        "allowFallback": False if model_override else AGGREGATOR_ALLOW_FALLBACK,
        "maxTokens": MAX_TOKENS,
        "temperature": TEMPERATURE,
    }
    if model_override:
        request_body["models"] = [model_override]
    elif AGGREGATOR_MODELS:
        request_body["models"] = AGGREGATOR_MODELS
    else:
        request_body["model"] = MODEL

    raw = post_json(
        aggregator_url("/api/aggregate/image-to-markdown"),
        request_body,
        AGGREGATOR_API_KEY,
        **({"timeout": request_timeout} if request_timeout is not None else {}),
    )
    if not raw.get("ok"):
        attempts = summarize_attempts(raw.get("attempts"))
        detail = raw.get("error") or "image-to-markdown failed"
        if attempts:
            detail = f"{detail}；{attempts}"
        raise RuntimeError(f"ModelAggregator image OCR failed: {redact_sensitive(detail)}")

    resolved_model = str(raw.get("modelRef") or raw.get("model") or model_override or MODEL).strip()
    if model_override and resolved_model != model_override:
        raise RuntimeError("Gemini 复核响应模型与所选模型不一致，结果未采用。")
    resolved_provider = str(raw.get("provider") or "").strip().lower()
    if resolved_provider == "mathpix" or "mathpix" in resolved_model.lower():
        attempts = summarize_attempts(raw.get("attempts"))
        detail = "AI Vision 已拒绝 Mathpix 回退：Mathpix 面向数学公式，不用于藏文 OCR。"
        if attempts:
            detail = f"{detail}；上游尝试：{attempts}"
        raise RuntimeError(detail)

    text = str(raw.get("markdown") or raw.get("answer") or raw.get("text") or "").strip()
    primary_image = images[0][0] if images else b""
    lines, layout_bboxes = attach_layout_bboxes(
        [{"text": line} for line in text.splitlines() if line.strip()], primary_image
    )
    return {
        "text": text,
        "lines": lines,
        "layout_bboxes": layout_bboxes,
        "layout_bbox_source": "projection",
        "raw": raw,
        "model": resolved_model,
        "provider": "model_aggregator",
        "upstream": aggregator_url("/api/aggregate/image-to-markdown"),
        "image": {
            "originalSize": sum(len(image_bytes) for image_bytes, _filename in images),
            "sentSize": sum(sent_sizes),
            "count": len(images),
            "maxSide": MAX_IMAGE_SIDE,
        },
    }


def call_model_aggregator(image_bytes: bytes, filename: str, prompt: str) -> dict[str, Any]:
    return call_model_aggregator_images([(image_bytes, filename)], prompt)


def call_openai_compatible_images(
    images: list[tuple[bytes, str]], prompt: str, model_override: str = ""
) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
    content.extend({
        "type": "image_url",
        "image_url": {"url": image_data_url(image_bytes, filename)},
    } for image_bytes, filename in images)
    body = {
        "model": model_override or MODEL,
        "temperature": TEMPERATURE,
        "max_tokens": MAX_TOKENS,
        "messages": [
            {
                "role": "user",
                "content": content,
            }
        ],
    }
    raw = post_json(chat_completions_url(), body, API_KEY)
    text = parse_model_text(raw).strip()
    primary_image = images[0][0] if images else b""
    lines, layout_bboxes = attach_layout_bboxes(
        [{"text": line} for line in text.splitlines() if line.strip()], primary_image
    )
    return {
        "text": text,
        "lines": lines,
        "layout_bboxes": layout_bboxes,
        "layout_bbox_source": "projection",
        "raw": raw,
        "model": raw.get("model") or model_override or MODEL,
        "provider": "openai-compatible",
        "upstream": chat_completions_url(),
    }


def call_openai_compatible(image_bytes: bytes, filename: str, prompt: str) -> dict[str, Any]:
    return call_openai_compatible_images([(image_bytes, filename)], prompt)


def normalize_center_page_rows(rows: list) -> list[dict[str, Any]]:
    if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
        raise RuntimeError("整页复核需要中间栏行坐标。")
    normalized = []
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or type(row.get("index")) is not int or row["index"] < 0 or row["index"] in seen:
            raise RuntimeError("整页复核行号无效或重复。")
        if row.get("region_id") not in (None, "center"):
            raise RuntimeError("整页复核只接受中间栏行。")
        seen.add(row["index"])
        normalized.append({"index": row["index"], "bbox": parse_normalized_bbox(json.dumps(row.get("bbox")))})
    return normalized


def center_page_prompt(rows: list[dict[str, Any]]) -> str:
    return ("图像是完整原页。只识别以下坐标对应的中间栏文字行，忽略左右边栏、边框及页码。"
            "逐字保留红字、叠字、祥云符号与标点，不按语义补写。坐标归一化到0到1："
            + json.dumps(rows, ensure_ascii=False) +
            '。每个index仅返回一次，不重新编号。只输出JSON：{"lines":[{"index":0,"text":"原文"}]}。'
            "不可省略行，无法确认的字以〔?〕标记。")


def parse_center_page_response(text: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    try:
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        try:
            payload = json.loads(clean)
        except json.JSONDecodeError:
            start = clean.find("{")
            if start < 0:
                raise
            payload, _ = json.JSONDecoder().raw_decode(clean[start:])
        returned = payload["lines"]
        if not isinstance(returned, list):
            raise ValueError("lines must be an array")
        expected = {row["index"] for row in rows}
        indexed = {item["index"]: item["text"] for item in returned
                   if isinstance(item, dict) and type(item.get("index")) is int and isinstance(item.get("text"), str)}
        if len(returned) != len(rows) or len(indexed) != len(rows) or set(indexed) != expected:
            raise ValueError("missing or duplicate row")
        return [{**row, "text": validate_qwen_transcript(indexed[row["index"]])} for row in rows]
    except (ValueError, TypeError, KeyError, AttributeError, RuntimeError) as exc:
        raise RuntimeError("整页识别结果行号不完整或内容无效，原结果保留，请重试。") from exc


def call_model_aggregator_gemini_page(image_bytes: bytes, filename: str, prompt: str, model: str) -> dict[str, Any]:
    """Use vision chat so the OCR-to-Markdown system prompt cannot override row JSON."""
    model_ref = f"gemini:{model}"
    raw = post_json(aggregator_url("/api/aggregate/chat"), {
        "model": model_ref,
        "temperature": 0,
        "maxTokens": MAX_TOKENS,
        "messages": [{"role": "user", "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": image_data_url(image_bytes, filename)}},
        ]}],
    }, AGGREGATOR_API_KEY)
    if not raw.get("ok"):
        raise RuntimeError(f"Gemini 整页复核失败：{redact_sensitive(str(raw.get('error') or '模型调用失败'))}")
    resolved = str(raw.get("modelRef") or raw.get("model") or "").strip()
    if resolved not in {model_ref, model}:
        raise RuntimeError("Gemini 复核响应模型与所选模型不一致，结果未采用。")
    if raw.get("finishReason") not in (None, "STOP"):
        raise RuntimeError("Gemini 复核输出未完整结束，原结果保留。")
    return {"text": str(raw.get("answer") or ""), "model": model_ref}


def call_gemini_page_review(image_bytes: bytes, filename: str, rows: list, model: str = "") -> dict[str, Any]:
    model = model.removeprefix("gemini:") if model else MODEL.removeprefix("gemini:")
    if model not in GEMINI_REVIEW_MODELS:
        raise RuntimeError("Gemini 复核模型不在允许列表中。")
    targets = normalize_center_page_rows(rows)
    prompt = center_page_prompt(targets)
    if USE_MODEL_AGGREGATOR:
        result = call_model_aggregator_gemini_page(image_bytes, filename, prompt, model)
        response_text = str(result.get("text") or "")
        actual_model = result.get("model", f"gemini:{model}")
    else:
        result = call_openai_compatible_images([(image_bytes, filename)], prompt, model_override=model)
        response_text = str(result.get("text") or "")
        actual_model = result.get("model", model)
        if actual_model not in {model, f"gemini:{model}"}:
            raise RuntimeError("Gemini Vision 复核响应模型与所选模型不一致，结果未采用。")
    lines = parse_center_page_response(response_text, targets)
    return {"text": "\n".join(line["text"] for line in lines), "lines": lines,
            "model": actual_model, "provider": "gemini",
            "recognition_scope": "whole-page"}


def call_openai_page_review(image_bytes: bytes, filename: str, rows: list) -> dict[str, Any]:
    if not OPENAI_REVIEW_API_KEY or not OPENAI_REVIEW_MODEL:
        raise RuntimeError("OpenAI 复核未配置：请在本地后端设置 OPENAI_REVIEW_API_KEY 和 OPENAI_REVIEW_MODEL。")
    targets = normalize_center_page_rows(rows)
    content = [{"type": "input_text", "text": center_page_prompt(targets)},
               {"type": "input_image", "image_url": image_data_url(image_bytes, filename), "detail": "high"}]
    raw = post_json("https://api.openai.com/v1/responses", {
        "model": OPENAI_REVIEW_MODEL, "store": False, "max_output_tokens": MAX_TOKENS,
        "input": [{"role": "user", "content": content}],
    }, OPENAI_REVIEW_API_KEY)
    text = "".join(part.get("text", "") for item in raw.get("output", [])
                   if item.get("type") == "message" for part in item.get("content", [])
                   if part.get("type") == "output_text").strip()
    if not text or raw.get("status") == "incomplete":
        raise RuntimeError("OpenAI 未返回完整的整页转录，请重试。")
    lines = parse_center_page_response(text, targets)
    return {"text": "\n".join(line["text"] for line in lines), "lines": lines,
            "provider": "openai", "model": raw.get("model", OPENAI_REVIEW_MODEL),
            "recognition_scope": "whole-page"}


def call_openai_line_review(image_bytes: bytes, filename: str, bbox: dict[str, float]) -> dict[str, Any]:
    """Use the official OpenAI API independently of the existing AI provider."""
    if not OPENAI_REVIEW_API_KEY or not OPENAI_REVIEW_MODEL:
        raise RuntimeError("OpenAI 复核未配置：请在本地后端设置 OPENAI_REVIEW_API_KEY（或 OPENAI_API_KEY）和 OPENAI_REVIEW_MODEL；Codex 套餐不能作为 API key。")
    prompt = "完整原页。只转录中间栏坐标 " + json.dumps(bbox) + " 对应的藏文行；忽略左右栏。只输出原文。"
    content = [{"type": "input_text", "text": prompt}]
    content.append({"type": "input_image", "image_url": image_data_url(image_bytes, filename), "detail": "high"})
    raw = post_json("https://api.openai.com/v1/responses", {
        "model": OPENAI_REVIEW_MODEL,
        "store": False,
        "max_output_tokens": MAX_TOKENS,
        "input": [{"role": "user", "content": content}],
    }, OPENAI_REVIEW_API_KEY)
    text = "".join(part.get("text", "") for item in raw.get("output", []) if item.get("type") == "message" for part in item.get("content", []) if part.get("type") == "output_text").strip()
    if not text or raw.get("status") == "incomplete":
        raise RuntimeError("OpenAI 未返回完整的单行转录，请重试或检查模型配置。")
    return {"text": text, "lines": [{"text": text, "bbox": bbox}], "provider": "openai", "model": raw.get("model", OPENAI_REVIEW_MODEL), "line_review": True, "recognition_scope": "whole-page"}


def call_line_review_vision(
    image_bytes: bytes, filename: str, bbox: dict[str, float], draft_text: str = "", model: str = "", allow_page_numbers: bool = False, request_timeout: float | None = None
) -> dict[str, Any]:
    """Review one center row using the original complete page."""
    if model:
        model = model.removeprefix("gemini:")
        if model not in GEMINI_REVIEW_MODELS:
            raise RuntimeError("Gemini 复核模型不在允许列表中，请刷新模型列表。")
        if not USE_MODEL_AGGREGATOR:
            raise RuntimeError("Gemini Vision 复核需要本地 Gemini 聚合服务；不会转发到其他提供商。")
    images = [(image_bytes, filename)]
    prompt = ("图片是完整原页。只转录中间栏坐标 " + json.dumps(bbox) +
              " 对应的一行藏文，忽略左右栏、邻行与边框；保留红字、叠字和标点。只输出原文。")
    if USE_MODEL_AGGREGATOR:
        result = call_model_aggregator_images(images, prompt, preserve_size=True, model_override=f"gemini:{model}" if model else "", **({"request_timeout": request_timeout} if request_timeout is not None else {}))
    else:
        result = call_openai_compatible_images(images, prompt)
    text = "".join(part.strip() for part in str(result.get("text") or "").splitlines() if part.strip())
    return {
        **result,
        "text": text,
        "lines": [{"text": text, "bbox": bbox}] if text else [],
        "line_review": True,
        "recognition_scope": "whole-page",
    }


def validate_qwen_transcript(value: str) -> str:
    text = value.strip()
    text = re.sub(r"^```[^\n]*\n([\s\S]*?)\n```$", r"\1", text).strip()
    if (not text or text.startswith(("{", "[")) or
            (not re.search(r"[\u0f00-\u0fff]", text) and
             not re.fullmatch(r"[0-9０-９\s.,:;()/-]+", text))):
        raise RuntimeError("千问返回非藏文转录（无关 JSON 或说明），请换模型复核。")
    return text


def prepare_qwen_review_context(image_bytes: bytes, bbox: dict[str, float]) -> tuple[list[bytes], dict[str, Any]]:
    """Provide page position and unmasked neighbouring pixels for one row."""
    if Image is None:
        raise RuntimeError("Pillow is required for Qwen review context")
    from PIL import ImageDraw

    with Image.open(BytesIO(image_bytes)) as original:
        page = original.convert("RGB")
    width, height = page.size
    x0 = max(0, round(float(bbox["x"]) * width))
    y0 = max(0, round(float(bbox["y"]) * height))
    x1 = min(width, round((float(bbox["x"]) + float(bbox["width"])) * width))
    y1 = min(height, round((float(bbox["y"]) + float(bbox["height"])) * height))
    if x1 <= x0 or y1 <= y0:
        raise RuntimeError("千问复核原文定位为空，请重新生成裁剪预览。")

    overview = page.copy()
    # A side marker identifies the row without drawing through faint letters.
    center_y = (y0 + y1) // 2
    ImageDraw.Draw(overview).polygon(((max(0, x0 - 12), center_y),
                                     (max(0, x0 - 36), max(0, center_y - 18)),
                                     (max(0, x0 - 36), min(height - 1, center_y + 18))),
                                    fill=(0, 95, 225))
    overview.thumbnail((1600, 1600), Image.Resampling.LANCZOS)

    row_height = y1 - y0
    margin_x = max(12, round(width * .012))
    margin_y = max(24, row_height)
    local_bbox = (max(0, x0 - margin_x), max(0, y0 - margin_y),
                  min(width, x1 + margin_x), min(height, y1 + margin_y))
    local = page.crop(local_bbox)
    local.thumbnail((1800, 1800), Image.Resampling.LANCZOS)
    images = []
    for picture in (overview, local):
        output = BytesIO()
        picture.save(output, format="PNG", optimize=True)
        images.append(output.getvalue())
    return images, {"page_size": {"width": width, "height": height},
                    "overview_size": {"width": overview.width, "height": overview.height},
                    "local_bbox": {"x": local_bbox[0], "y": local_bbox[1],
                                   "width": local_bbox[2] - local_bbox[0],
                                   "height": local_bbox[3] - local_bbox[1]},
                    "local_size": {"width": local.width, "height": local.height}}


def request_qwen_original_page(image_bytes: bytes, filename: str, model: str, prompt: str) -> tuple[str, str]:
    if model not in QWEN_REVIEW_MODELS:
        raise RuntimeError("千问复核模型不在允许列表中，请刷新模型列表。")
    if not QWEN_REVIEW_API_KEY or not QWEN_REVIEW_BASE_URL:
        raise RuntimeError("千问复核未配置：请在后端配置 QWEN_REVIEW_API_KEY（或 DASHSCOPE_API_KEY）和对应地域/平台的 QWEN_REVIEW_BASE_URL。")
    # Credentials may only be sent to an explicitly configured official endpoint.
    from urllib.parse import urlparse
    upstream = urlparse(QWEN_REVIEW_BASE_URL)
    host = upstream.hostname or ""
    if upstream.scheme != "https" or not (host.endswith(".aliyuncs.com") or host.endswith(".qianwenai.com")) or upstream.username or upstream.password or upstream.query or upstream.fragment:
        raise RuntimeError("千问接口必须是官方 HTTPS 地址，且不能在地址中包含凭据。")
    content = [{"type": "text", "text": prompt},
               {"type": "image_url", "image_url": {"url": image_data_url(image_bytes, filename)},
                "max_pixels": 8388608}]
    url = QWEN_REVIEW_BASE_URL if QWEN_REVIEW_BASE_URL.endswith("/chat/completions") else QWEN_REVIEW_BASE_URL + "/chat/completions"
    body = {"model": model, "messages": [{"role": "user", "content": content}], "temperature": 0, "max_tokens": MAX_TOKENS}
    if model in {"qwen3.8-max", "qwen3.7-plus"}:
        body["enable_thinking"] = False
    raw = post_json(url, body, QWEN_REVIEW_API_KEY)
    choices = raw.get("choices") or []
    text = parse_model_text(raw).strip()
    if not text or not choices or choices[0].get("finish_reason") not in {None, "stop"}:
        raise RuntimeError("千问未返回完整的单行文字，请检查模型权限或重试。")
    return text, raw.get("model", model)


def call_qwen_line_review(image_bytes: bytes, filename: str, bbox: dict[str, float], model: str) -> dict[str, Any]:
    # Compatibility for old clients: even a single-row request uses only the
    # original full page, never saved preview bounds, masks or enlarged tiles.
    prompt = ("图片是完整原页。请根据归一化坐标定位目标行：" + json.dumps(bbox) +
              "。只转录该行的藏文、红字、叠字和标点，不按语义补写，不抄邻行。只输出原文。")
    text, actual_model = request_qwen_original_page(image_bytes, filename, model, prompt)
    text = validate_qwen_transcript(text)
    return {"text": text, "lines": [{"text": text, "bbox": bbox}], "model": actual_model,
            "provider": "qwen", "line_review": True, "recognition_scope": "whole-page"}


def call_qwen_page_review(image_bytes: bytes, filename: str, rows: list, model: str) -> dict[str, Any]:
    if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
        raise RuntimeError("千问整页复核需要有效的原文行坐标。")
    targets = []
    seen = set()
    for row in rows:
        index = row.get("index")
        if type(index) is not int or index < 0 or index in seen:
            raise RuntimeError("千问整页复核行号无效或重复。")
        seen.add(index)
        targets.append({"index": index, "bbox": parse_normalized_bbox(json.dumps(row.get("bbox")))})
    prompt = ("图片是未经裁剪的完整原页。请一次识别以下所有目标行，坐标为原页0到1的归一化坐标：" +
              json.dumps(targets, ensure_ascii=False) +
              '。只按原图逐字转录藏文、红字、叠字、祥云符号和标点，不按语义补写。不要混入左右边栏。'
              '每个index只返回一次，保留给定index，不重新编号。只输出JSON：'
              '{"lines":[{"index":0,"text":"原文"}]}。不得省略目标行。无法辨认的字用〔?〕。')
    text, actual_model = request_qwen_original_page(image_bytes, filename, model, prompt)
    try:
        clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
        returned = json.loads(clean)["lines"]
        indexed = {row["index"]: row["text"] for row in returned
                   if type(row.get("index")) is int and isinstance(row.get("text"), str)}
        if len(returned) != len(targets) or len(indexed) != len(targets) or set(indexed) != seen:
            raise ValueError("missing or duplicate row")
        lines = [{**row, "text": validate_qwen_transcript(indexed[row["index"]])} for row in targets]
    except (ValueError, TypeError, KeyError, AttributeError, RuntimeError) as exc:
        raise RuntimeError("千问整页结果行号不完整或内容无效，原结果保留，请重试。") from exc
    return {"text": "\n".join(row["text"] for row in lines), "lines": lines,
            "model": actual_model, "provider": "qwen", "recognition_scope": "whole-page"}


def review_models_payload() -> dict[str, Any]:
    return {"qwen": {"models": QWEN_REVIEW_MODELS, "configured": bool(QWEN_REVIEW_API_KEY and QWEN_REVIEW_BASE_URL)},
            "gemini": {"models": GEMINI_REVIEW_MODELS, "configured": USE_MODEL_AGGREGATOR or bool(API_KEY and BASE_URL),
                       "billing_note": "免费层级与剩余额度请以 AI Studio 为准；模型列表不代表额度承诺。"}}


def call_vision_model(
    image_bytes: bytes, filename: str, prompt: str, ocr_profile: str = "", model: str = ""
) -> dict[str, Any]:
    if ocr_profile == "traditional":
        regions = detect_traditional_column_bboxes(image_bytes)
        if len(regions) == 3:
            return call_traditional_region_ocr(image_bytes, filename, prompt, regions)
        raise RuntimeError("传统经书三栏定位失败，请调整定位后重试；不会退回整页识别。")
    if model:
        model = model.removeprefix("gemini:")
        if model not in GEMINI_REVIEW_MODELS:
            raise RuntimeError("Gemini OCR 模型不在允许列表中，请刷新模型列表。")
        if USE_MODEL_AGGREGATOR:
            candidates = [model]
            if model == GEMINI_REVIEW_MODELS[0]:
                candidates.extend(candidate for candidate in GEMINI_REVIEW_MODELS[1:] if candidate != model)
            errors = []
            for candidate in candidates:
                try:
                    return call_model_aggregator_images(
                        [(image_bytes, filename)], prompt, preserve_size=True,
                        model_override=f"gemini:{candidate}", request_timeout=GEMINI_OCR_TIMEOUT,
                    )
                except RuntimeError as exc:
                    errors.append(f"{candidate}: {exc}")
                    detail = str(exc).lower()
                    if not any(marker in detail for marker in ("http 429", "http 503", "high demand", "blockreason=other")):
                        raise
            raise RuntimeError("Gemini OCR 候选模型均未返回有效文字：" + "；".join(errors))
        result = call_openai_compatible_images([(image_bytes, filename)], prompt, model_override=model)
        if result.get("model") not in {model, f"gemini:{model}"}:
            raise RuntimeError("Gemini OCR 响应模型与所选模型不一致，结果未采用。")
        return result
    if USE_MODEL_AGGREGATOR:
        return call_model_aggregator(image_bytes, filename, prompt)
    return call_openai_compatible(image_bytes, filename, prompt)


def health_payload() -> dict[str, Any]:
    if USE_MODEL_AGGREGATOR:
        upstream_health_url = aggregator_url("/api/aggregate/health")
        upstream_ok = False
        upstream_error = ""
        upstream_payload: dict[str, Any] = {}
        try:
            upstream_payload = get_json(upstream_health_url, AGGREGATOR_API_KEY)
            upstream_ok = bool(upstream_payload.get("ok", True))
        except Exception as exc:
            upstream_error = redact_sensitive(str(exc))

        return {
            "ok": upstream_ok,
            "line_crop_version": LINE_CROP_VERSION,
            "qwen_recognition_scope": "whole-page",
            "gemini_recognition_scope": "whole-page",
            "openai_recognition_scope": "whole-page",
            "model": MODEL,
            "models": AGGREGATOR_MODELS or [MODEL],
            "allow_fallback": AGGREGATOR_ALLOW_FALLBACK,
            "base_url": AGGREGATOR_BASE_URL,
            "upstream": aggregator_url("/api/aggregate/image-to-markdown"),
            "upstream_health": upstream_health_url,
            "upstream_ok": upstream_ok,
            "upstream_error": upstream_error,
            "upstream_payload": upstream_payload,
            "has_api_key": bool(AGGREGATOR_API_KEY),
            "provider": "model_aggregator",
        }
    return {
        "ok": True,
        "line_crop_version": LINE_CROP_VERSION,
        "qwen_recognition_scope": "whole-page",
        "gemini_recognition_scope": "whole-page",
        "openai_recognition_scope": "whole-page",
        "model": MODEL,
        "base_url": BASE_URL,
        "upstream": chat_completions_url(),
        "has_api_key": bool(API_KEY),
        "provider": "openai-compatible",
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "AIVisionOCRLocal/0.1"

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/review-models":
            self.send_json(review_models_payload())
            return
        if self.path.rstrip("/") == "/health":
            payload = health_payload()
            self.send_json(payload, status=200 if payload.get("ok") else 503)
            return
        self.send_json({"error": "Not found"}, status=404)

    def do_POST(self) -> None:
        path = self.path.rstrip("/")
        if path not in {"/ocr", "/layout", "/line-review", "/openai-line-review", "/openai-page-review", "/gemini-page-review", "/qwen-line-review", "/qwen-page-review", "/line-preview", "/line-layout"}:
            self.send_json({"error": "Not found"}, status=404)
            return

        try:
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": self.headers.get("Content-Type", ""),
                    "CONTENT_LENGTH": self.headers.get("Content-Length", "0"),
                },
            )
            if "file" not in form:
                raise RuntimeError('multipart field "file" is required')

            file_item = form["file"]
            image_bytes = file_item.file.read()
            if not image_bytes:
                raise RuntimeError("uploaded file is empty")

            filename = getattr(file_item, "filename", "") or "page.png"
            if path == "/layout":
                line_count = field_value(form, "line_count")
                ocr_profile = field_value(form, "ocr_profile")
                try:
                    payload = build_layout_payload(image_bytes, int(line_count))
                except ValueError as exc:
                    raise RuntimeError("line_count must be an integer") from exc
                if ocr_profile == "traditional":
                    regions = detect_traditional_column_bboxes(image_bytes)
                    if len(regions) == 3:
                        payload["regions"] = [
                            {
                                **region,
                                "text": "",
                                "lines": [],
                                "line_count": 0,
                                "empty": True,
                            }
                            for region in regions
                        ]
                        payload["region_order"] = ["left", "center", "right"]
                        payload["lines"] = [{
                            "text": "",
                            "bbox": region,
                            "region_id": region["id"],
                            "region_label": region["label"],
                            "region_role": region["role"],
                            "region_direction": region["direction"],
                        } for region in regions]
                        payload["layout_bboxes"] = regions
                        payload["layout_bbox_source"] = "traditional-columns"
                self.send_json(payload)
                return

            if path == "/line-layout":
                regions = detect_traditional_column_bboxes(image_bytes)
                if len(regions) != 3:
                    raise RuntimeError("传统经书三栏定位失败，请调整定位后重试。")
                self.send_json(call_traditional_region_ocr(image_bytes, filename, "", regions, layout_only=True))
                return

            if path == "/line-preview":
                bbox = parse_normalized_bbox(field_value(form, "bbox"))
                physical_row_index = field_value(form, "physical_row_index").strip()
                if physical_row_index:
                    try:
                        bbox["physical_row_index"] = int(physical_row_index)
                    except ValueError as exc:
                        raise RuntimeError("physical_row_index must be a non-negative integer") from exc
                    if bbox["physical_row_index"] < 0:
                        raise RuntimeError("physical_row_index must be a non-negative integer")
                expected_physical_row_count = field_value(form, "physical_row_count").strip()
                if expected_physical_row_count:
                    try:
                        expected_physical_row_count = int(expected_physical_row_count)
                    except ValueError as exc:
                        raise RuntimeError("physical_row_count must be a positive integer") from exc
                    if expected_physical_row_count < 1:
                        raise RuntimeError("physical_row_count must be a positive integer")
                metadata = json.loads(field_value(form, "review_image") or "{}")
                # Reproduce the exact saved crop, including neighbour limits.
                source_size = metadata.get("source_size", {})
                crop_pixels = metadata.get("crop_pixels", {})
                exact_match = False
                with Image.open(BytesIO(image_bytes)) as image:
                    if source_size == {"width": image.width, "height": image.height} and crop_pixels and metadata.get("crop_version") == LINE_CROP_VERSION and "physical_row_index" not in metadata.get("source_bbox", {}):
                        exact_match = True
                        x, y = crop_pixels["x"], crop_pixels["y"]
                        cropped = image.convert("RGB").crop((x, y, x + crop_pixels["width"], y + crop_pixels["height"]))
                        size = metadata["review_size"]
                        enlarged = cropped.resize((size["width"], size["height"]), Image.Resampling.LANCZOS)
                        tiles = []
                        tile_width = max(480, min(LINE_REVIEW_TILE_WIDTH, max(480, MAX_IMAGE_SIDE)))
                        ranges = metadata.get("tile_ranges") or [[left, min(enlarged.width, left + tile_width)] for left in range(0, enlarged.width, tile_width)]
                        for left, right in ranges:
                            output = BytesIO()
                            enlarged.crop((left, 0, right, enlarged.height)).save(output, format="PNG")
                            tiles.append(output.getvalue())
                    else:
                        # Old preview metadata can carry vertical limits that
                        # already cut Tibetan marks. Recompute those limits on
                        # a version change while retaining source coordinates.
                        bbox = resolve_line_preview_bbox(
                            bbox, metadata, {"width": image.width, "height": image.height}
                        )
                        tiles, metadata = prepare_line_review_images(image_bytes, bbox)
                resolved_bbox = metadata.get("source_bbox", {})
                if expected_physical_row_count and (
                    resolved_bbox.get("physical_row_count") != expected_physical_row_count
                    or resolved_bbox.get("physical_row_index") != bbox.get("physical_row_index")
                ):
                    raise RuntimeError("原文物理行数与识别 block 数不一致，无法安全生成对应的单行预览。")
                self.send_json({"images": ["data:image/png;base64," + base64.b64encode(tile).decode("ascii") for tile in tiles], "review_image": metadata, "exact_match": exact_match})
                return

            if path == "/openai-line-review":
                payload = call_openai_line_review(image_bytes, filename, parse_normalized_bbox(field_value(form, "bbox")))
                self.send_json(payload)
                return

            if path == "/openai-page-review":
                payload = call_openai_page_review(image_bytes, filename, json.loads(field_value(form, "rows") or "[]"))
                self.send_json(payload)
                return

            if path == "/gemini-page-review":
                payload = call_gemini_page_review(image_bytes, filename, json.loads(field_value(form, "rows") or "[]"), field_value(form, "model"))
                self.send_json(payload)
                return

            if path == "/qwen-page-review":
                payload = call_qwen_page_review(image_bytes, filename, json.loads(field_value(form, "rows") or "[]"), field_value(form, "model"))
                self.send_json(payload)
                return
            if path == "/qwen-line-review":
                payload = call_qwen_line_review(image_bytes, filename, parse_normalized_bbox(field_value(form, "bbox")), field_value(form, "model"))
                self.send_json(payload)
                return

            if path == "/line-review":
                bbox = parse_normalized_bbox(field_value(form, "bbox"))
                metadata = json.loads(field_value(form, "review_image") or "{}")
                bbox = resolve_saved_review_bbox(image_bytes, bbox, metadata)
                payload = call_line_review_vision(
                    image_bytes,
                    filename,
                    bbox,
                    field_value(form, "ocr_text"),
                    field_value(form, "model") or (MODEL.removeprefix("gemini:") if USE_MODEL_AGGREGATOR else ""),
                    allow_page_numbers=field_value(form, "region_id") in {"left", "right"},
                    request_timeout=min(TIMEOUT, 60) if field_value(form, "primary_line") == "1" else None,
                )
                self.send_json(payload)
                return

            draft_text = field_value(form, "ocr_text")
            prompt = field_value(form, "prompt") or default_prompt(draft_text)
            ocr_profile = field_value(form, "ocr_profile")
            payload = call_vision_model(image_bytes, filename, prompt, ocr_profile)
            self.send_json(payload)
        except Exception as exc:
            payload, status = ocr_error_response(exc)
            self.send_json(payload, status=status)

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


def resolve_saved_review_bbox(image_bytes, bbox, metadata):
    saved_bbox = metadata.get("source_bbox", {})
    with Image.open(BytesIO(image_bytes)) as image:
        if saved_bbox and metadata.get("source_size") == {"width": image.width, "height": image.height}:
            bbox = parse_normalized_bbox(json.dumps(saved_bbox))
            for key in ("clip_left", "clip_right", "clip_top", "clip_bottom"):
                if key in saved_bbox:
                    bbox[key] = max(0.0, min(1.0, float(saved_bbox[key])))
            if metadata.get("crop_version") == LINE_CROP_VERSION and isinstance(saved_bbox.get("physical_row_index"), int):
                bbox["physical_row_index"] = saved_bbox["physical_row_index"]
    return bbox


def ocr_error_response(error):
    """Preserve retryable upstream statuses instead of hiding them in HTTP 500.

    Authentication/quota errors stay non-retryable, even if a different attempt
    also failed temporarily. Only explicit HTTP codes trigger automatic retry.
    """
    message = redact_sensitive(str(error))
    codes = [int(code) for code in re.findall(r"\bHTTP\s+(\d{3})\b", message, re.I)]
    permanent = any(marker in message.lower() for marker in
                    ("额度", "频率限制", "quota", "resource_exhausted", "invalid key", "permission denied"))
    retryable = bool(codes) and not permanent and all(code in {502, 503, 504} for code in codes)
    status = codes[-1] if retryable else 500
    return {"error": message, "retryable": retryable}, status


def field_value(form: cgi.FieldStorage, name: str) -> str:
    if name not in form:
        return ""
    item = form[name]
    if isinstance(item, list):
        item = item[0]
    value = item.value
    return value if isinstance(value, str) else ""


def main() -> None:
    print(f"AI Vision OCR local server: http://{HOST}:{PORT}")
    print(f"provider={health_payload()['provider']}")
    print(f"upstream={health_payload()['upstream']}")
    print(f"model={MODEL}")
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
