"""Separate, book-scoped storage for numbered TB translation work."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request
import oss2


BOOK_ID = re.compile(r"^[0-9a-f]{32}$")
SEGMENT_ID = re.compile(r"^TB-[0-9]{4,}$")
SOURCE_LINE = re.compile(r"^\[TB-([0-9]{4,})\]\s*(\S.*)$")
MAX_SOURCE_BYTES = 8 * 1024 * 1024
MAX_RESULT_BYTES = 64 * 1024


def create_router(storage: Any) -> APIRouter:
    router = APIRouter(prefix="/api/books/{book_id}/tb")

    def validate_book(book_id: str) -> None:
        if not BOOK_ID.fullmatch(book_id):
            raise HTTPException(400, "无效的书籍 ID")
        storage.read_json(book_id, "metadata.json")

    def source(book_id: str) -> dict[str, Any]:
        return storage.read_json(book_id, "tb/source.json")

    def validate_source_hash(book_id: str, digest: str) -> None:
        if source(book_id)["source_hash"] != digest:
            raise HTTPException(409, "TB 原文版本不一致，请重新打开书籍")

    def validate_segment_in_source(book_id: str, segment_id: str, source_text: str | None = None) -> None:
        result_suffix(segment_id, "final")
        if not re.search(rf"^\[{re.escape(segment_id)}\]", source_text if source_text is not None else source(book_id)["text"], re.MULTILINE):
            raise HTTPException(400, "TB 段号不属于此书的编号原文")

    def result_suffix(segment_id: str, kind: str, model: str = "") -> str:
        if not SEGMENT_ID.fullmatch(segment_id):
            raise HTTPException(400, "无效的 TB 段号")
        if kind == "final":
            return f"tb/results/{segment_id}/final.json"
        if kind != "model" or not model or len(model) > 200:
            raise HTTPException(400, "无效的模型 ID")
        model_hash = hashlib.sha256(model.encode("utf-8")).hexdigest()
        return f"tb/results/{segment_id}/models/{model_hash}.json"

    @router.get("/source")
    def get_source(book_id: str) -> dict[str, Any]:
        validate_book(book_id)
        return source(book_id)

    @router.put("/source")
    async def put_source(book_id: str, request: Request) -> dict[str, Any]:
        validate_book(book_id)
        payload = await request.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("text"), str):
            raise HTTPException(400, "请提供编号 TXT 原文")
        text = payload["text"].replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
        raw = text.encode("utf-8")
        if not raw or len(raw) > MAX_SOURCE_BYTES:
            raise HTTPException(413, "TB 原文为空或超过 8 MiB")
        ids = set()
        for line in text.splitlines():
            if not line.strip():
                continue
            match = SOURCE_LINE.fullmatch(line)
            if not match or match[1] in ids:
                raise HTTPException(400, "TB 原文必须逐行使用唯一的 [TB-0001] 段号")
            ids.add(match[1])
        if not ids:
            raise HTTPException(400, "TB 原文没有编号段落")
        digest = hashlib.sha256(raw).hexdigest()
        try:
            existing = source(book_id)
        except HTTPException as exc:
            if exc.status_code != 404:
                raise
        else:
            if existing.get("source_hash") != digest:
                raise HTTPException(409, "此书已关联另一份 TB 原文，不能覆盖已有段号与译文")
            return existing
        record = {"name": str(payload.get("name") or "TB 原文.txt")[:200], "text": text,
                  "source_hash": digest, "segment_count": len(ids),
                  "created_at": datetime.now(timezone.utc).isoformat()}
        # Atomic first write prevents a concurrent attachment from replacing the source.
        try:
            storage.oss_bucket().put_object(storage.object_key(book_id, "tb/source.json"),
                storage.json.dumps(record, ensure_ascii=False).encode("utf-8"),
                headers={"Content-Type": "application/json; charset=utf-8", "x-oss-forbid-overwrite": "true"})
        except oss2.exceptions.ObjectAlreadyExists as exc:
            raise HTTPException(409, "此书已关联 TB 原文，请重新打开") from exc
        return record

    @router.get("/results")
    def get_results(book_id: str, ids: str, models: str = "", source_hash: str = "") -> dict[str, Any]:
        validate_book(book_id)
        saved_source = source(book_id)
        if saved_source["source_hash"] != source_hash:
            raise HTTPException(409, "TB 原文版本不一致，请重新打开书籍")
        segment_ids = [item.strip() for item in ids.split(",") if item.strip()]
        model_ids = [item.strip() for item in models.split(",") if item.strip()]
        if not segment_ids or len(segment_ids) > 30 or len(model_ids) > 5:
            raise HTTPException(400, "每次最多读取 30 段和 5 个模型")
        records = {}
        for segment_id in segment_ids:
            validate_segment_in_source(book_id, segment_id, saved_source["text"])
            record = {"id": segment_id, "models": {}, "final": ""}
            for kind, model in [("final", "")] + [("model", item) for item in model_ids]:
                suffix = result_suffix(segment_id, kind, model)
                try:
                    saved = storage.read_json(book_id, suffix)
                except HTTPException as exc:
                    if exc.status_code == 404:
                        continue
                    raise
                if saved.get("source_hash") != source_hash:
                    continue
                if kind == "final":
                    record["final"] = saved.get("text", "")
                elif saved.get("model") == model:
                    record["models"][model] = {"text": saved.get("text", ""), "updatedAt": saved.get("updated_at", "")}
            records[segment_id] = record
        return {"source_hash": source_hash, "records": records}

    @router.put("/results/{segment_id}")
    async def put_result(book_id: str, segment_id: str, request: Request) -> dict[str, Any]:
        validate_book(book_id)
        payload = await request.json()
        if not isinstance(payload, dict):
            raise HTTPException(400, "译文必须是 JSON object")
        validate_source_hash(book_id, str(payload.get("source_hash") or ""))
        validate_segment_in_source(book_id, segment_id)
        kind, model, text = payload.get("kind"), str(payload.get("model") or ""), payload.get("text")
        suffix = result_suffix(segment_id, kind, model)
        if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_RESULT_BYTES:
            raise HTTPException(400, "译文必须是 64 KiB 以内的文本")
        if kind == "model" and not text.strip():
            raise HTTPException(400, "模型译文不能为空")
        record = {"source_hash": payload["source_hash"], "kind": kind, "model": model,
                  "text": text, "updated_at": datetime.now(timezone.utc).isoformat()}
        storage.write_json(book_id, suffix, record)
        return {"ok": True, "updated_at": record["updated_at"]}

    return router
