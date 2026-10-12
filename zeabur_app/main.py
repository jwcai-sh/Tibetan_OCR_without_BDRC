from __future__ import annotations

import json
import hashlib
import hmac
import mimetypes
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

import oss2
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tibetan_ocr_bridge import call_ai_layout, call_ai_line_preview, call_ai_ocr, call_ai_page_review, call_ai_review_models
from tibetan_translation_bridge import call_translation


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


OSS_ENDPOINT = env("OSS_ENDPOINT")
OSS_BUCKET = env("OSS_BUCKET")
OSS_ACCESS_KEY_ID = env("OSS_ACCESS_KEY_ID")
OSS_ACCESS_KEY_SECRET = env("OSS_ACCESS_KEY_SECRET")
OSS_PREFIX = env("OSS_PREFIX", "tibetan-proofreading").strip("/")
LIBRARY_PREFIX = "待识别文档/"
LIBRARY_PASSWORD = env("LIBRARY_PASSWORD") or env("PASSWORD")
LIBRARY_LIMIT = 1000
MAX_UPLOAD_BYTES = int(env("MAX_UPLOAD_BYTES", str(200 * 1024 * 1024)))


def oss_bucket() -> oss2.Bucket:
    missing = [name for name, value in {
        "OSS_ENDPOINT": OSS_ENDPOINT,
        "OSS_BUCKET": OSS_BUCKET,
        "OSS_ACCESS_KEY_ID": OSS_ACCESS_KEY_ID,
        "OSS_ACCESS_KEY_SECRET": OSS_ACCESS_KEY_SECRET,
    }.items() if not value]
    if missing:
        raise HTTPException(503, f"OSS 尚未配置：{', '.join(missing)}")
    return oss2.Bucket(oss2.Auth(OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET), OSS_ENDPOINT, OSS_BUCKET)


def object_key(book_id: str, suffix: str) -> str:
    return f"{OSS_PREFIX}/books/{book_id}/{suffix.lstrip('/')}"


def write_json(book_id: str, suffix: str, payload: dict[str, Any]) -> None:
    oss_bucket().put_object(
        object_key(book_id, suffix),
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )


def read_json(book_id: str, suffix: str) -> dict[str, Any]:
    try:
        body = oss_bucket().get_object(object_key(book_id, suffix)).read()
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(404, "书籍或校对状态不存在") from exc
    return json.loads(body.decode("utf-8"))


def require_library_access(authorization: str) -> None:
    if not LIBRARY_PASSWORD:
        raise HTTPException(503, "云端文档目录尚未设置访问口令")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not hmac.compare_digest(token, LIBRARY_PASSWORD):
        raise HTTPException(401, "云端文档目录需要访问口令", headers={"WWW-Authenticate": "Bearer"})


def library_object_key(relative_path: str) -> str:
    path = str(relative_path or "")
    if (not path or path.startswith("/") or "\\" in path or "\x00" in path
            or any(part in ("", ".", "..") for part in path.split("/"))):
        raise HTTPException(400, "无效的文档路径")
    if PurePosixPath(path).suffix.lower() not in {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}:
        raise HTTPException(400, "仅支持打开 PDF 或图片")
    return f"{LIBRARY_PREFIX}{path}"


app = FastAPI(title="Tibetan OCR Proofreading Workbench", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict[str, Any]:
    oss_configured = all((OSS_ENDPOINT, OSS_BUCKET, OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET))
    return {
        "ok": oss_configured,
        "service": "tibetan-proofreading-zeabur",
        "oss": {"configured": oss_configured, "bucket": OSS_BUCKET, "prefix": OSS_PREFIX},
        "bdrc": {"configured": False, "status": "disabled"},
        "ai_ocr": {"configured": bool(env("MODEL_AGGREGATOR_BASE_URL") or env("AI_VISION_BASE_URL"))},
        "pdf_render": {"provider": "pymupdf"},
        "translation": {"provider": env("TRANSLATE_PROVIDER", "model_aggregator")},
    }


@app.get("/api/library")
def list_library(authorization: str = Header(default="")) -> dict[str, Any]:
    require_library_access(authorization)
    items = []
    truncated = False
    for obj in oss2.ObjectIterator(oss_bucket(), prefix=LIBRARY_PREFIX, max_keys=100):
        relative_path = obj.key[len(LIBRARY_PREFIX):]
        if not relative_path or relative_path.endswith("/") or relative_path.startswith("."):
            continue
        if len(items) >= LIBRARY_LIMIT:
            truncated = True
            break
        modified = getattr(obj, "last_modified", None)
        items.append({
            "path": relative_path,
            "size": int(getattr(obj, "size", 0) or 0),
            "updated_at": datetime.fromtimestamp(modified, timezone.utc).isoformat() if isinstance(modified, (int, float)) else str(modified or ""),
        })
    return {"folder": LIBRARY_PREFIX.rstrip("/"), "items": items, "truncated": truncated}


@app.post("/api/library/open")
async def open_library_book(request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    require_library_access(authorization)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, "文档请求必须为 JSON object")
    source_key = library_object_key(payload.get("path", ""))
    try:
        source = oss_bucket().head_object(source_key)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(404, "文档不存在") from exc

    index_name = hashlib.sha256(source_key.encode("utf-8")).hexdigest() + ".json"
    try:
        existing = read_json("_library-index", index_name)
        if existing.get("source_key") == source_key and existing.get("book_id"):
            return existing
    except HTTPException as exc:
        if exc.status_code != 404:
            raise

    book_id = uuid.uuid4().hex
    name = PurePosixPath(source_key).name
    created_at = datetime.now(timezone.utc).isoformat()
    metadata = {
        "book_id": book_id,
        "name": name,
        "size": int(source.content_length),
        "content_type": mimetypes.guess_type(name)[0] or "application/octet-stream",
        "source_key": source_key,
        "created_at": created_at,
        "updated_at": created_at,
    }
    write_json(book_id, "metadata.json", metadata)
    write_json(book_id, "state.json", {**metadata, "page_count": 0, "ocr_results": {}, "translation_results": {}})
    write_json("_library-index", index_name, metadata)
    return metadata


@app.post("/api/books")
async def create_book(file: UploadFile = File(...)) -> dict[str, Any]:
    content = await file.read()
    if not content:
        raise HTTPException(400, "上传文件为空")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"文件超过上限 {MAX_UPLOAD_BYTES} bytes")
    book_id = uuid.uuid4().hex
    safe_name = Path(file.filename or "book.bin").name
    created_at = datetime.now(timezone.utc).isoformat()
    source_key = object_key(book_id, f"source/{safe_name}")
    oss_bucket().put_object(source_key, content, headers={"Content-Type": file.content_type or "application/octet-stream"})
    metadata = {
        "book_id": book_id,
        "name": safe_name,
        "size": len(content),
        "content_type": file.content_type or "application/octet-stream",
        "source_key": source_key,
        "created_at": created_at,
        "updated_at": created_at,
    }
    write_json(book_id, "metadata.json", metadata)
    write_json(book_id, "state.json", {**metadata, "page_count": 0, "ocr_results": {}, "translation_results": {}})
    return metadata


@app.get("/api/books/{book_id}/state")
def get_book_state(book_id: str) -> dict[str, Any]:
    return read_json(book_id, "state.json")


@app.get("/api/books/{book_id}/source")
def get_book_source(book_id: str) -> Response:
    metadata = read_json(book_id, "metadata.json")
    source_key = str(metadata.get("source_key") or "")
    if not source_key:
        raise HTTPException(404, "书籍源文件不存在")
    try:
        body = oss_bucket().get_object(source_key).read()
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(404, "书籍源文件不存在") from exc
    safe_name = Path(str(metadata.get("name") or "source.pdf")).name
    return Response(
        content=body,
        media_type=str(metadata.get("content_type") or "application/octet-stream"),
        headers={"Content-Disposition": f"attachment; filename=source; filename*=UTF-8''{quote(safe_name)}"},
    )


@app.put("/api/books/{book_id}/state")
async def put_book_state(book_id: str, request: Request) -> dict[str, Any]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, "状态必须是 JSON object")
    payload["book_id"] = book_id
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    write_json(book_id, "state.json", payload)
    return {"ok": True, "book_id": book_id, "updated_at": payload["updated_at"]}


@app.post("/api/books/{book_id}/exports")
async def save_export(book_id: str, request: Request) -> dict[str, Any]:
    payload = await request.json()
    text = str(payload.get("text") or "")
    kind = str(payload.get("kind") or "markdown").replace("/", "-")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = object_key(book_id, f"exports/{timestamp}-{kind}.md")
    oss_bucket().put_object(key, text.encode("utf-8"), headers={"Content-Type": "text/markdown; charset=utf-8"})
    return {"ok": True, "book_id": book_id, "object_key": key}


@app.post("/api/ocr")
async def bdrc_ocr() -> JSONResponse:
    raise HTTPException(410, "BDRC OCR 已从当前版本停用；请使用 /api/ai-ocr")


@app.post("/api/render-pdf-page")
async def render_pdf_page(
    file: UploadFile = File(...),
    page: int = Form(1),
    dpi: int = Form(180),
) -> Response:
    content = await file.read()
    if not content:
        raise HTTPException(400, "上传 PDF 为空")

    page_num = max(1, int(page or 1))
    safe_dpi = min(420, max(72, int(dpi or 180)))
    try:
        import fitz

        with fitz.open(stream=content, filetype="pdf") as document:
            if page_num > document.page_count:
                raise HTTPException(400, f"页码超出范围：{page_num} / {document.page_count}")
            pdf_page = document.load_page(page_num - 1)
            pixmap = pdf_page.get_pixmap(dpi=safe_dpi, alpha=False)
            png_bytes = pixmap.tobytes("png")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"PyMuPDF PDF 渲染失败：{exc}") from exc

    return Response(content=png_bytes, media_type="image/png")


@app.post("/api/ai-ocr")
async def ai_ocr(
    file: UploadFile = File(...),
    ocr_text: str = Form(""),
    prompt: str = Form(""),
    model: str = Form(""),
) -> dict[str, Any]:
    return call_ai_ocr(await file.read(), file.filename or "page.png", ocr_text, prompt, model)


@app.post("/api/layout")
async def ai_layout(file: UploadFile = File(...), line_count: int = Form(0)) -> dict[str, Any]:
    return call_ai_layout(await file.read(), line_count)


@app.post("/api/line-preview")
async def ai_line_preview(
    file: UploadFile = File(...), bbox: str = Form(...), review_image: str = Form("")
) -> dict[str, Any]:
    try:
        return call_ai_line_preview(await file.read(), bbox, review_image)
    except (ValueError, KeyError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/api/review-models")
def review_models() -> dict[str, Any]:
    return call_ai_review_models()


@app.post("/api/{provider}-page-review")
async def ai_page_review(
    provider: str,
    file: UploadFile = File(...),
    rows: str = Form(...),
    model: str = Form(""),
) -> dict[str, Any]:
    if provider not in {"gemini", "qwen"}:
        raise HTTPException(404, "未知的复核模型")
    try:
        return call_ai_page_review(provider, await file.read(), file.filename or "page.png", json.loads(rows), model)
    except (ValueError, KeyError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/translate")
async def translate(request: Request) -> dict[str, Any]:
    payload = await request.json()
    return call_translation(payload)


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse("/tibetan-proofreading-app/")


app.mount("/tibetan-proofreading-app", StaticFiles(directory=ROOT / "tibetan-proofreading-app", html=True), name="workbench")
