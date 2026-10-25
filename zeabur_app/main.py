from __future__ import annotations

import json
import hashlib
import hmac
import logging
import re
import mimetypes
import os
import sys
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import quote

import oss2
from fastapi import FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import UploadFile as StarletteUploadFile
from starlette.concurrency import run_in_threadpool


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from tibetan_ocr_bridge import load_ai_ocr_module, call_ai_layout, call_ai_line_preview, call_ai_line_review, call_ai_ocr, call_ai_page_review, call_ai_review_models
from tibetan_translation_bridge import call_translation, translation_health
from zeabur_app import collaboration


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
LOCAL_WORKBENCH_ORIGINS = {"http://127.0.0.1:8790", "http://localhost:8790"}
LIBRARY_FILE_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff",
    ".docx", ".md", ".markdown", ".txt",
}
TRANSLATION_JOB_TTL_SECONDS = 1800
TRANSLATION_MAX_JOBS = 4
translation_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="translation")
translation_jobs: dict[str, tuple[Future, str, float, dict[str, int]]] = {}
translation_jobs_lock = threading.Lock()


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


@lru_cache(maxsize=2)
def cached_pdf_source(source_key: str, source_size: int) -> bytes:
    source = oss_bucket().get_object(source_key)
    try:
        content = source.read()
    finally:
        close = getattr(source, "close", None)
        if close:
            close()
    if not content or (source_size and len(content) != source_size):
        raise HTTPException(502, "云端 PDF 下载不完整，请稍后重试")
    return content


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
    if PurePosixPath(path).suffix.lower() not in LIBRARY_FILE_EXTENSIONS:
        raise HTTPException(400, "不支持打开此文件类型")
    return f"{LIBRARY_PREFIX}{path}"


def library_directory_path(relative_path: str) -> str:
    path = str(relative_path or "")
    if not path:
        return ""
    if path.endswith("/"):
        path = path[:-1]
    if (not path or path.startswith("/") or "\\" in path or "\x00" in path
            or any(ord(char) < 32 or ord(char) == 127 for char in path)
            or any(part in ("", ".", "..") for part in path.split("/"))):
        raise HTTPException(400, "无效的目标文件夹")
    return f"{path}/"


def library_safe_filename(filename: str) -> str:
    if (not filename or filename in (".", "..") or "/" in filename or "\\" in filename
            or any(ord(char) < 32 or ord(char) == 127 for char in filename)):
        raise HTTPException(400, "文件名无效，请移除路径分隔符或控制字符")
    if PurePosixPath(filename).suffix.lower() not in LIBRARY_FILE_EXTENSIONS:
        raise HTTPException(400, "仅支持 PDF、图片、DOCX、Markdown 和 TXT 文件")
    return filename


app = FastAPI(title="Tibetan OCR Proofreading Workbench", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://tibetan-ocr-without-bdrc.zeabur.app", *sorted(LOCAL_WORKBENCH_ORIGINS)],
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Accept-Ranges", "Content-Disposition", "Content-Length", "Content-Range"],
)


@app.middleware("http")
async def collaboration_auth(request: Request, call_next):
    public_paths = {"/api/collaboration/config", "/api/collaboration/login", "/api/collaboration/logout", "/api/collaboration/me"}
    if collaboration.configured() and request.url.path.startswith("/api/") and request.url.path not in public_paths and request.method != "OPTIONS":
        try:
            request.state.collaborator = collaboration.current_actor(request)
        except HTTPException as exc:
            return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
    return await call_next(request)


@app.get("/api/collaboration/config")
def collaboration_config() -> dict[str, Any]:
    return {
        "enabled": collaboration.configured(),
        "names": collaboration.collaborators() if collaboration.configured() else [],
        "password_required": collaboration.password_required() if collaboration.configured() else True,
    }


@app.post("/api/collaboration/login")
async def collaboration_login(request: Request) -> Response:
    if not collaboration.configured():
        raise HTTPException(503, "多人协作尚未配置阿里云数据库及登录环境变量")
    payload = await request.json()
    name = str(payload.get("name") or "")
    response = JSONResponse({"ok": True, "name": name})
    access_token = collaboration.issue_session(name, str(payload.get("password") or ""), response, request)
    if request.headers.get("origin", "") in LOCAL_WORKBENCH_ORIGINS:
        response.body = json.dumps({"ok": True, "name": name, "access_token": access_token}).encode("utf-8")
        response.headers["content-length"] = str(len(response.body))
    return response


@app.post("/api/collaboration/logout")
def collaboration_logout() -> Response:
    response = JSONResponse({"ok": True})
    response.delete_cookie("tibetan_collab", path="/")
    return response


@app.get("/api/collaboration/me")
def collaboration_me(request: Request) -> dict[str, Any]:
    if not collaboration.configured():
        return {"enabled": False, "name": ""}
    return {"enabled": True, "name": collaboration.current_actor(request)}


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
        "collaboration": {"configured": collaboration.configured(), "database": "aliyun-rds-postgresql" if collaboration.configured() else "not-configured"},
    }


@app.get("/api/library")
def list_library(request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    if not collaboration.configured():
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


def library_upload_error(exc: Exception, stage: str) -> HTTPException:
    # Never include SDK exception text: it can contain signed URLs or credentials.
    def safe_token(value: Any) -> str:
        return re.sub(r"[^a-zA-Z0-9_.-]", "", str(value or ""))[:96]

    code = safe_token(getattr(exc, "code", "")) or type(exc).__name__
    request_id = safe_token(getattr(exc, "request_id", ""))
    status = safe_token(getattr(exc, "status", ""))
    logging.getLogger(__name__).warning(
        "library_upload_failed stage=%s status=%s code=%s request_id=%s",
        stage, status, code, request_id,
    )
    if code == "AccessDenied":
        action = "写入" if stage == "put" else "读取文件信息"
        message = f"OSS 拒绝{action}，请管理员检查待识别文档目录的权限"
    elif code in {"InvalidAccessKeyId", "SignatureDoesNotMatch", "SecurityTokenExpired"}:
        message = "OSS 身份认证失败，请管理员检查服务端凭据配置"
    elif code in {"RequestTimeout", "ConnectionTimeout", "ReadTimeout", "RequestError"}:
        message = "连接 OSS 失败或超时，请稍后重试"
    else:
        message = "上传到云端失败" if stage == "put" else "无法确认云端文件是否重名"
    detail = f"{message}（错误码：{code}"
    if request_id:
        detail += f"；请求编号：{request_id}"
    return HTTPException(502, detail + "）")


@app.post("/api/library/upload")
async def upload_library_file(request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    if not collaboration.configured():
        require_library_access(authorization)
    async with request.form() as form:
        file = form.get("file")
        if not isinstance(file, StarletteUploadFile):
            raise HTTPException(400, "请选择一个文件")
        directory = form.get("path", "")
        if not isinstance(directory, str):
            raise HTTPException(400, "无效的目标文件夹")
        directory = library_directory_path(directory)
        filename = library_safe_filename(file.filename or "")
        try:
            file.file.seek(0, 2)
            size = file.file.tell()
            file.file.seek(0)
        except (AttributeError, OSError) as exc:
            raise HTTPException(400, "无法读取上传文件") from exc
        if not size:
            raise HTTPException(400, "上传文件为空")
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"文件超过上限 {MAX_UPLOAD_BYTES} bytes")

        relative_path = f"{directory}{filename}"
        source_key = library_object_key(relative_path)
        extension = PurePosixPath(filename).suffix.lower()
        content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        if extension == ".txt":
            content_type = "text/plain; charset=utf-8"
        elif extension in {".md", ".markdown"}:
            content_type = "text/markdown; charset=utf-8"
        bucket = oss_bucket()
        try:
            bucket.head_object(source_key)
        except oss2.exceptions.NoSuchKey:
            pass
        except Exception as exc:
            raise library_upload_error(exc, "head") from exc
        else:
            raise HTTPException(409, "此文件夹中已存在同名文件，请重命名后重试")
        try:
            bucket.put_object(
                source_key, file.file,
                headers={"Content-Type": content_type, "x-oss-forbid-overwrite": "true"},
            )
        except oss2.exceptions.ObjectAlreadyExists as exc:
            raise HTTPException(409, "此文件夹中已存在同名文件，请重命名后重试") from exc
        except oss2.exceptions.ServerError as exc:
            if getattr(exc, "status", None) in (409, 412):
                raise HTTPException(409, "此文件夹中已存在同名文件，请重命名后重试") from exc
            raise library_upload_error(exc, "put") from exc
        except Exception as exc:
            raise library_upload_error(exc, "put") from exc
    return {"ok": True, "path": relative_path, "size": size, "content_type": content_type}


@app.post("/api/library/open")
async def open_library_book(request: Request, authorization: str = Header(default="")) -> dict[str, Any]:
    if not collaboration.configured():
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
            return {**existing, "size": int(source.content_length)}
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
async def create_book(request: Request, file: UploadFile = File(...)) -> dict[str, Any]:
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
    if collaboration.configured():
        try:
            return collaboration.load_state(book_id, lambda: read_json(book_id, "state.json"))
        except Exception as exc:
            logging.warning("Collaboration state unavailable for book %s; trying OSS snapshot: %s", book_id, type(exc).__name__)
            try:
                snapshot = read_json(book_id, "state.json")
            except HTTPException as snapshot_error:
                raise HTTPException(503, "协作数据库暂时无法连接，且没有可用的云端状态快照；请稍后重试。") from snapshot_error
            snapshot["collaboration_degraded"] = True
            snapshot["collaboration_message"] = "协作数据库暂时无法连接，当前显示云端最近保存的状态。修改暂时无法同步。"
            snapshot.setdefault("page_revisions", {})
            return snapshot
    return read_json(book_id, "state.json")


@app.get("/api/books/{book_id}/source")
def get_book_source(book_id: str, request: Request) -> Response:
    metadata = read_json(book_id, "metadata.json")
    source_key = str(metadata.get("source_key") or "")
    if not source_key:
        raise HTTPException(404, "书籍源文件不存在")
    try:
        source_head = oss_bucket().head_object(source_key)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(404, "书籍源文件不存在") from exc
    size = int(source_head.content_length)
    range_header = request.headers.get("range", "")
    byte_range: tuple[int, int] | None = None
    status_code = 200
    range_headers: dict[str, str] = {}
    if range_header:
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", range_header.strip())
        if not match or not size or not (match.group(1) or match.group(2)):
            raise HTTPException(416, "无效的字节范围", headers={"Content-Range": f"bytes */{size}"})
        if match.group(1):
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else size - 1
        else:
            suffix_length = int(match.group(2))
            if suffix_length <= 0:
                raise HTTPException(416, "无效的字节范围", headers={"Content-Range": f"bytes */{size}"})
            start, end = max(0, size - suffix_length), size - 1
        if start >= size or end < start:
            raise HTTPException(416, "字节范围超出文件大小", headers={"Content-Range": f"bytes */{size}"})
        end = min(end, size - 1)
        byte_range = (start, end)
        status_code = 206
        range_headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        range_headers["Content-Length"] = str(end - start + 1)
    try:
        source = oss_bucket().get_object(source_key, byte_range=byte_range) if byte_range else oss_bucket().get_object(source_key)
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(404, "书籍源文件不存在") from exc
    safe_name = Path(str(metadata.get("name") or "source.pdf")).name
    def chunks():
        try:
            while chunk := source.read(1024 * 1024):
                yield chunk
        finally:
            close = getattr(source, "close", None)
            if close:
                close()

    headers = {
        "Content-Disposition": f"attachment; filename=source; filename*=UTF-8''{quote(safe_name)}",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
        **range_headers,
    }
    if size > 0 and not range_headers:
        headers["Content-Length"] = str(size)
    return StreamingResponse(
        chunks(),
        media_type=str(metadata.get("content_type") or "application/octet-stream"),
        headers=headers,
        status_code=status_code,
    )


@app.get("/api/books/{book_id}/pages/{page_num}/preview")
def get_book_page_preview(book_id: str, page_num: int, dpi: int = 144, format: str = "png") -> Response:
    metadata = read_json(book_id, "metadata.json")
    source_key = str(metadata.get("source_key") or "")
    if not source_key or not str(metadata.get("name") or "").lower().endswith(".pdf"):
        raise HTTPException(404, "PDF 源文件不存在")
    if page_num < 1:
        raise HTTPException(400, "页码必须大于零")
    safe_dpi = min(360, max(72, dpi))
    preview_format = "jpeg" if format.lower() in ("jpeg", "jpg") else "png"
    try:
        import fitz

        with fitz.open(stream=cached_pdf_source(source_key, int(metadata.get("size") or 0)), filetype="pdf") as document:
            if page_num > document.page_count:
                raise HTTPException(400, f"页码超出范围：{page_num} / {document.page_count}")
            page = document.load_page(page_num - 1)
            bounded_dpi = min(safe_dpi, max(72, int(4200 * 72 / max(page.rect.width, page.rect.height, 1))))
            pixmap = page.get_pixmap(dpi=bounded_dpi, alpha=False)
            image_bytes = pixmap.tobytes("jpeg", jpg_quality=75) if preview_format == "jpeg" else pixmap.tobytes("png")
    except HTTPException:
        raise
    except oss2.exceptions.NoSuchKey as exc:
        raise HTTPException(404, "PDF 源文件不存在") from exc
    except Exception as exc:
        logging.warning("Remote PDF preview failed for book %s page %s: %s", book_id, page_num, type(exc).__name__)
        raise HTTPException(502, "云端 PDF 单页预览失败，请稍后重试") from exc
    return Response(content=image_bytes, media_type=f"image/{preview_format}", headers={"Cache-Control": "private, no-store"})


def remote_pdf_metadata(book_id: str) -> dict[str, Any]:
    metadata = read_json(book_id, "metadata.json")
    if not metadata.get("source_key") or not str(metadata.get("name") or "").lower().endswith(".pdf"):
        raise HTTPException(404, "PDF 源文件不存在")
    return metadata


@app.get("/api/books/{book_id}/document-info")
def get_book_document_info(book_id: str) -> dict[str, Any]:
    metadata = remote_pdf_metadata(book_id)
    try:
        import fitz

        with fitz.open(stream=cached_pdf_source(str(metadata["source_key"]), int(metadata.get("size") or 0)), filetype="pdf") as document:
            return {"page_count": document.page_count, "name": metadata.get("name") or "", "size": metadata.get("size") or 0}
    except HTTPException:
        raise
    except Exception as exc:
        logging.warning("Remote PDF info failed for book %s: %s", book_id, type(exc).__name__)
        raise HTTPException(502, "云端 PDF 页数读取失败，请稍后重试") from exc


@app.get("/api/books/{book_id}/pages/{page_num}/text")
def get_book_page_text(book_id: str, page_num: int) -> dict[str, Any]:
    metadata = remote_pdf_metadata(book_id)
    if page_num < 1:
        raise HTTPException(400, "页码必须大于零")
    try:
        import fitz

        with fitz.open(stream=cached_pdf_source(str(metadata["source_key"]), int(metadata.get("size") or 0)), filetype="pdf") as document:
            if page_num > document.page_count:
                raise HTTPException(400, f"页码超出范围：{page_num} / {document.page_count}")
            text = document.load_page(page_num - 1).get_text("text", sort=True).strip()
            return {"page": page_num, "text": text, "lines": [line.strip() for line in text.splitlines() if line.strip()]}
    except HTTPException:
        raise
    except Exception as exc:
        logging.warning("Remote PDF text failed for book %s page %s: %s", book_id, page_num, type(exc).__name__)
        raise HTTPException(502, "云端 PDF 文本层读取失败，请稍后重试") from exc


@app.put("/api/books/{book_id}/state")
async def put_book_state(book_id: str, request: Request) -> dict[str, Any]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(400, "状态必须是 JSON object")
    payload["book_id"] = book_id
    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    if collaboration.configured():
        try:
            collaboration.load_state(book_id, lambda: read_json(book_id, "state.json"))
            return collaboration.save_state(book_id, payload, collaboration.current_actor(request))
        except HTTPException:
            raise
        except Exception as exc:
            logging.warning("Collaboration state save unavailable for book %s: %s", book_id, type(exc).__name__)
            raise HTTPException(503, "协作数据库暂时无法连接，本次修改尚未同步；请保留当前内容并稍后重试。") from exc
    write_json(book_id, "state.json", payload)
    return {"ok": True, "book_id": book_id, "updated_at": payload["updated_at"]}


@app.get("/api/books/{book_id}/assignments")
def get_assignments(book_id: str) -> dict[str, Any]:
    if not collaboration.configured():
        raise HTTPException(503, "多人协作尚未配置")
    return {"items": collaboration.assignments(book_id)}


@app.put("/api/books/{book_id}/assignments")
async def put_assignment(book_id: str, request: Request) -> dict[str, Any]:
    if not collaboration.configured():
        raise HTTPException(503, "多人协作尚未配置")
    payload = await request.json()
    return collaboration.set_assignment(book_id, int(payload.get("page_num") or 0), str(payload.get("stage") or ""), payload.get("assignee"), str(payload.get("status") or "todo"), collaboration.current_actor(request))


@app.get("/api/books/{book_id}/history/{page_num}")
def get_page_history(book_id: str, page_num: int) -> dict[str, Any]:
    if not collaboration.configured():
        raise HTTPException(503, "多人协作尚未配置")
    try:
        return {"items": collaboration.history(book_id, page_num)}
    except HTTPException:
        raise
    except Exception as exc:
        logging.warning("Collaboration history unavailable for book %s page %s: %s", book_id, page_num, type(exc).__name__)
        raise HTTPException(503, "协作数据库暂时无法连接，修改历史暂不可用；请稍后重试。") from exc


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
    try:
        return await run_in_threadpool(call_ai_ocr, await file.read(), file.filename or "page.png", ocr_text, prompt, model)
    except RuntimeError as exc:
        detail = load_ai_ocr_module().redact_sensitive(str(exc))
        status = 422 if "blockReason=" in detail else 504 if "timed out" in detail.lower() else 502
        raise HTTPException(status_code=status, detail=detail[:1500]) from exc


@app.post("/api/layout")
async def ai_layout(file: UploadFile = File(...), line_count: int = Form(0)) -> dict[str, Any]:
    return call_ai_layout(await file.read(), line_count)


@app.post("/api/line-preview")
async def ai_line_preview(
    file: UploadFile = File(...), bbox: str = Form(...), review_image: str = Form(""),
    physical_row_index: str = Form(""), physical_row_count: str = Form(""),
    preview_format: str = Form(""),
) -> dict[str, Any]:
    try:
        return call_ai_line_preview(
            await file.read(), bbox, review_image, physical_row_index, physical_row_count, preview_format
        )
    except (ValueError, KeyError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


@app.post("/api/line-review")
async def ai_line_review(
    file: UploadFile = File(...), bbox: str = Form(...), ocr_text: str = Form(""),
    model: str = Form(""), region_id: str = Form(""),
) -> dict[str, Any]:
    try:
        return await run_in_threadpool(
            call_ai_line_review, await file.read(), file.filename or "page.png",
            bbox, ocr_text, model, region_id,
        )
    except (ValueError, KeyError) as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        detail = load_ai_ocr_module().redact_sensitive(str(exc))
        raise HTTPException(502, detail[:1500]) from exc


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
        return await run_in_threadpool(call_ai_page_review, provider, await file.read(), file.filename or "page.png", json.loads(rows), model)
    except (ValueError, KeyError, RuntimeError) as exc:
        raise HTTPException(400, str(exc)) from exc


def translation_failure_detail(exc: Exception) -> str:
    message = str(exc)
    upstream_status = re.search(r"\bHTTP (\d{3})\b", message)
    if upstream_status:
        return f"翻译模型服务返回 HTTP {upstream_status.group(1)}，请检查所选模型及服务配置"
    if "timed out" in message.lower() or "timeout" in message.lower():
        return "翻译模型服务响应超时，请稍后重试"
    if "request failed" in message.lower():
        return "无法连接翻译模型服务，请检查服务地址与网络"
    return "翻译模型服务调用失败，请检查模型聚合服务日志"


@app.post("/api/translate")
async def translate(request: Request) -> Response:
    payload = await request.json()
    actor = getattr(request.state, "collaborator", "")
    now = time.monotonic()
    with translation_jobs_lock:
        for job_id, (future, _, created_at, _) in list(translation_jobs.items()):
            if future.done() and now - created_at > TRANSLATION_JOB_TTL_SECONDS:
                del translation_jobs[job_id]
        if sum(not future.done() for future, _, _, _ in translation_jobs.values()) >= TRANSLATION_MAX_JOBS:
            raise HTTPException(503, "翻译任务较多，请稍后重试")
        job_id = uuid.uuid4().hex
        progress = {"completed": 0, "total": 0}
        job_payload = dict(payload)
        job_payload["_progress"] = lambda completed, total: progress.update(completed=completed, total=total)
        translation_jobs[job_id] = (translation_executor.submit(call_translation, job_payload), actor, now, progress)
    return JSONResponse(
        {"status": "queued", "job_id": job_id, "status_url": f"/api/translate/jobs/{job_id}"},
        status_code=202,
    )


@app.get("/api/translate/jobs/{job_id}")
def translation_job(request: Request, job_id: str) -> dict[str, Any]:
    with translation_jobs_lock:
        job = translation_jobs.get(job_id)
    if job is None or job[1] != getattr(request.state, "collaborator", ""):
        raise HTTPException(404, "翻译任务不存在或已过期，请重新翻译")
    future, _, created_at, progress = job
    if time.monotonic() - created_at > TRANSLATION_JOB_TTL_SECONDS:
        raise HTTPException(410, "翻译任务已过期，请重新翻译")
    if not future.done():
        return {"status": "running", "completed": progress["completed"], "total": progress["total"]}
    try:
        return future.result()
    except Exception as exc:
        logging.getLogger(__name__).warning("Translation job failed: %s", type(exc).__name__)
        raise HTTPException(502, translation_failure_detail(exc)) from exc


@app.get("/api/translate/health")
def translate_health() -> dict[str, Any]:
    return translation_health()


@app.get("/")
def root() -> RedirectResponse:
    return RedirectResponse("/tibetan-proofreading-app/")


app.mount("/tibetan-proofreading-app", StaticFiles(directory=ROOT / "tibetan-proofreading-app", html=True), name="workbench")
