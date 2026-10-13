"""Opt-in Aliyun RDS collaboration store for the OCR workbench.

The database is enabled when the database connection, collaborator names,
and session secret are present. COLLABORATION_PASSWORD is optional for a
controlled test deployment; an empty value means name-only login. OSS remains the source-file store and bootstrap.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
import threading
import re
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request, Response

_schema_ready = False
_schema_lock = threading.Lock()


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def configured() -> bool:
    return all(_env(name) for name in (
        "COLLAB_DB_HOST", "COLLAB_DB_NAME", "COLLAB_DB_USER", "COLLAB_DB_PASSWORD",
        "COLLABORATOR_NAMES", "COLLAB_SESSION_SECRET",
    ))


def _schema() -> str:
    schema = _env("COLLAB_DB_SCHEMA") or "tibetan_collab"
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", schema):
        raise HTTPException(503, "协作数据库 schema 配置无效")
    return schema


def _table(name: str) -> str:
    return f"{_schema()}.{name}"


def collaborators() -> list[str]:
    return [name.strip() for name in _env("COLLABORATOR_NAMES").split(",") if name.strip()]


def _connect():
    try:
        import psycopg
        from psycopg.rows import dict_row
    except ImportError as exc:  # pragma: no cover - deployment configuration
        raise HTTPException(503, "协作数据库驱动未安装") from exc
    return psycopg.connect(
        host=_env("COLLAB_DB_HOST"), port=int(_env("COLLAB_DB_PORT") or "5432"),
        user=_env("COLLAB_DB_USER"), password=_env("COLLAB_DB_PASSWORD"),
        dbname=_env("COLLAB_DB_NAME"), autocommit=False,
        row_factory=dict_row, options=f"-c search_path={_schema()},public",
        connect_timeout=8,
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def initialize() -> None:
    global _schema_ready
    if not configured():
        return
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        _initialize_schema()
        _schema_ready = True


def _initialize_schema() -> None:
    db = _connect()
    try:
        with db.cursor() as cur:
            schema = _schema()
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {schema}")
            cur.execute(f"""CREATE TABLE IF NOT EXISTS {_table('collab_book_state')} (
                book_id VARCHAR(128) PRIMARY KEY,
                state_json TEXT NOT NULL,
                page_revisions_json TEXT NOT NULL,
                updated_at VARCHAR(40) NOT NULL
            )""")
            cur.execute(f"""CREATE TABLE IF NOT EXISTS {_table('collab_page_assignment')} (
                book_id VARCHAR(128) NOT NULL, page_num INT NOT NULL,
                stage VARCHAR(24) NOT NULL, assignee VARCHAR(128) NULL,
                status VARCHAR(24) NOT NULL DEFAULT 'todo', updated_by VARCHAR(128) NOT NULL,
                updated_at VARCHAR(40) NOT NULL,
                PRIMARY KEY (book_id, page_num, stage)
            )""")
            cur.execute(f"""CREATE TABLE IF NOT EXISTS {_table('collab_audit')} (
                id BIGSERIAL PRIMARY KEY, book_id VARCHAR(128) NOT NULL,
                page_num INT NOT NULL, actor VARCHAR(128) NOT NULL, event_type VARCHAR(24) NOT NULL,
                before_json TEXT NOT NULL, after_json TEXT NOT NULL,
                created_at VARCHAR(40) NOT NULL
            )""")
            cur.execute(f"CREATE INDEX IF NOT EXISTS ix_collab_audit_book_page ON {_table('collab_audit')} (book_id, page_num, id)")
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def issue_session(name: str, password: str, response: Response, request: Request) -> None:
    valid_name = next((item for item in collaborators() if hmac.compare_digest(item, name)), None)
    shared_password = _env("COLLABORATION_PASSWORD")
    if not valid_name or (shared_password and not hmac.compare_digest(password, shared_password)):
        raise HTTPException(401, "姓名或协作口令不正确")
    expires = int(time.time()) + 12 * 60 * 60
    body = base64.urlsafe_b64encode(json.dumps({"name": valid_name, "exp": expires}, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_env("COLLAB_SESSION_SECRET").encode(), body.encode(), hashlib.sha256).hexdigest()
    response.set_cookie("tibetan_collab", f"{body}.{sig}", httponly=True, secure=request.url.scheme == "https", samesite="lax", max_age=12 * 60 * 60, path="/")


def current_actor(request: Request) -> str:
    token = request.cookies.get("tibetan_collab", "")
    try:
        body, signature = token.rsplit(".", 1)
        expected = hmac.new(_env("COLLAB_SESSION_SECRET").encode(), body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        name = str(payload["name"])
        if int(payload["exp"]) < int(time.time()) or name not in collaborators():
            raise ValueError("expired")
        return name
    except Exception as exc:
        raise HTTPException(401, "协作登录已失效，请重新登录") from exc


def _page_value(state: dict[str, Any], page: str) -> dict[str, Any]:
    reviews = state.get("ocrQualityReviews") or state.get("ocr_quality_reviews") or []
    if isinstance(reviews, dict):
        page_reviews = reviews.get(page, [])
    else:
        page_reviews = [row for row in reviews if str(row.get("pageNum", row.get("page_num", ""))) == page] if isinstance(reviews, list) else []
    return {
        "ocr": (state.get("ocr_results") or state.get("ocrResults") or {}).get(page),
        "translation": (state.get("translation_results") or state.get("translationResults") or {}).get(page),
        "reviews": page_reviews,
    }


def changed_pages(current: dict[str, Any], incoming: dict[str, Any]) -> list[str]:
    keys = set((current.get("ocr_results") or current.get("ocrResults") or {}).keys())
    keys |= set((incoming.get("ocr_results") or incoming.get("ocrResults") or {}).keys())
    keys |= set((current.get("translation_results") or current.get("translationResults") or {}).keys())
    keys |= set((incoming.get("translation_results") or incoming.get("translationResults") or {}).keys())
    old_reviews = current.get("ocrQualityReviews") or current.get("ocr_quality_reviews") or []
    new_reviews = incoming.get("ocrQualityReviews") or incoming.get("ocr_quality_reviews") or []
    for rows in (old_reviews, new_reviews):
        if isinstance(rows, list):
            keys |= {str(row.get("pageNum", row.get("page_num"))) for row in rows if row.get("pageNum", row.get("page_num")) is not None}
        elif isinstance(rows, dict):
            keys |= set(rows)
    return sorted((page for page in keys if _page_value(current, str(page)) != _page_value(incoming, str(page))), key=lambda item: int(item) if str(item).isdigit() else str(item))


def _merge_pages(current: dict[str, Any], incoming: dict[str, Any], pages: list[str]) -> dict[str, Any]:
    merged = dict(current)
    for canonical, aliases in (("ocr_results", ("ocr_results", "ocrResults")), ("translation_results", ("translation_results", "translationResults"))):
        old_map = dict(current.get(canonical) or current.get(aliases[1]) or {})
        new_map = incoming.get(canonical) or incoming.get(aliases[1]) or {}
        for page in pages:
            if page in new_map:
                old_map[page] = new_map[page]
            else:
                old_map.pop(page, None)
        merged[canonical] = old_map
        merged.pop(aliases[1], None)
    reviews = current.get("ocrQualityReviews") or current.get("ocr_quality_reviews") or []
    incoming_reviews = incoming.get("ocrQualityReviews") or incoming.get("ocr_quality_reviews") or []
    if isinstance(reviews, list) and isinstance(incoming_reviews, list):
        keep = [row for row in reviews if str(row.get("pageNum", row.get("page_num", ""))) not in pages]
        merged["ocrQualityReviews"] = keep + [row for row in incoming_reviews if str(row.get("pageNum", row.get("page_num", ""))) in pages]
    elif isinstance(incoming_reviews, dict):
        merged_reviews = dict(reviews) if isinstance(reviews, dict) else {}
        for page in pages:
            if page in incoming_reviews:
                merged_reviews[page] = incoming_reviews[page]
            else:
                merged_reviews.pop(page, None)
        merged["ocrQualityReviews"] = merged_reviews
    for key in ("sourceName", "sourceSize", "sourceMime", "pageCount", "ocrProfile", "updatedAt"):
        if key in incoming:
            merged[key] = incoming[key]
    if "pageCount" in incoming:
        merged["page_count"] = incoming["pageCount"]
    if "ocrProfile" in incoming:
        merged["ocr_profile"] = incoming["ocrProfile"]
    return merged


def load_state(book_id: str, fallback: Any) -> dict[str, Any]:
    initialize()
    db = _connect()
    try:
        with db.cursor() as cur:
            cur.execute(f"SELECT state_json, page_revisions_json FROM {_table('collab_book_state')} WHERE book_id=%s", (book_id,))
            row = cur.fetchone()
            if row is None:
                fallback = fallback() if callable(fallback) else fallback
                keys = set((fallback.get("ocr_results") or fallback.get("ocrResults") or {})) | set((fallback.get("translation_results") or fallback.get("translationResults") or {}))
                revisions = {str(page): 1 for page in keys}
                cur.execute(f"INSERT INTO {_table('collab_book_state')} VALUES (%s,%s,%s,%s)", (book_id, json.dumps(fallback, ensure_ascii=False), json.dumps(revisions), _now()))
                db.commit()
                state = fallback
            else:
                state = json.loads(row["state_json"])
                revisions = json.loads(row["page_revisions_json"])
            state["page_revisions"] = revisions
            return state
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def save_state(book_id: str, incoming: dict[str, Any], actor: str) -> dict[str, Any]:
    initialize()
    db = _connect()
    try:
        with db.cursor() as cur:
            cur.execute(f"SELECT state_json, page_revisions_json FROM {_table('collab_book_state')} WHERE book_id=%s FOR UPDATE", (book_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(404, "协作书籍状态尚未初始化，请重新加载书籍")
            current = json.loads(row["state_json"])
            revisions = json.loads(row["page_revisions_json"])
            declared = incoming.get("changed_pages")
            pages = sorted({str(page) for page in declared if str(page).isdigit()} if isinstance(declared, list) else set(changed_pages(current, incoming)), key=int)
            expected = incoming.get("base_page_revisions") or {}
            conflicts = [page for page in pages if int(revisions.get(page, 0)) != int(expected.get(page, 0))]
            if conflicts:
                raise HTTPException(409, {"message": "这些页已被其他协作者修改；为避免覆盖，请重新加载后复核。", "pages": conflicts, "page_revisions": revisions})
            merged = _merge_pages(current, incoming, pages)
            now = _now()
            for page in pages:
                before = _page_value(current, page)
                after = _page_value(merged, page)
                revisions[page] = int(revisions.get(page, 0)) + 1
                cur.execute(f"INSERT INTO {_table('collab_audit')} (book_id,page_num,actor,event_type,before_json,after_json,created_at) VALUES (%s,%s,%s,'edit',%s,%s,%s)", (book_id, int(page), actor, json.dumps(before, ensure_ascii=False), json.dumps(after, ensure_ascii=False), now))
            merged["book_id"] = book_id
            merged["updated_at"] = now
            cur.execute(f"UPDATE {_table('collab_book_state')} SET state_json=%s,page_revisions_json=%s,updated_at=%s WHERE book_id=%s", (json.dumps(merged, ensure_ascii=False), json.dumps(revisions), now, book_id))
        db.commit()
        merged["page_revisions"] = revisions
        return {"ok": True, "book_id": book_id, "updated_at": now, "page_revisions": revisions}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def assignments(book_id: str) -> list[dict[str, Any]]:
    initialize()
    db = _connect()
    try:
        with db.cursor() as cur:
            cur.execute(f"SELECT page_num,stage,assignee,status,updated_by,updated_at FROM {_table('collab_page_assignment')} WHERE book_id=%s ORDER BY page_num,stage", (book_id,))
            return list(cur.fetchall())
    finally:
        db.close()


def set_assignment(book_id: str, page_num: int, stage: str, assignee: str | None, status: str, actor: str) -> dict[str, Any]:
    initialize()
    if page_num < 1 or stage not in {"first", "second"} or status not in {"todo", "doing", "done"}:
        raise HTTPException(400, "无效的页码、校对轮次或任务状态")
    if assignee and assignee not in collaborators():
        raise HTTPException(400, "指定的协作者不在姓名名单中")
    now = _now()
    db = _connect()
    try:
        with db.cursor() as cur:
            cur.execute(f"SELECT assignee,status FROM {_table('collab_page_assignment')} WHERE book_id=%s AND page_num=%s AND stage=%s FOR UPDATE", (book_id, page_num, stage))
            existing = cur.fetchone()
            before = {"stage": stage, "assignee": existing["assignee"], "status": existing["status"]} if existing else {}
            cur.execute(f"INSERT INTO {_table('collab_page_assignment')} (book_id,page_num,stage,assignee,status,updated_by,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (book_id,page_num,stage) DO UPDATE SET assignee=EXCLUDED.assignee,status=EXCLUDED.status,updated_by=EXCLUDED.updated_by,updated_at=EXCLUDED.updated_at", (book_id, page_num, stage, assignee, status, actor, now))
            cur.execute(f"INSERT INTO {_table('collab_audit')} (book_id,page_num,actor,event_type,before_json,after_json,created_at) VALUES (%s,%s,%s,'assignment',%s,%s,%s)", (book_id, page_num, actor, json.dumps(before, ensure_ascii=False), json.dumps({"stage": stage, "assignee": assignee, "status": status}, ensure_ascii=False), now))
        db.commit()
        return {"book_id": book_id, "page_num": page_num, "stage": stage, "assignee": assignee, "status": status, "updated_by": actor, "updated_at": now}
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def history(book_id: str, page_num: int, limit: int = 50) -> list[dict[str, Any]]:
    initialize()
    db = _connect()
    try:
        with db.cursor() as cur:
            cur.execute(f"SELECT actor,event_type,before_json,after_json,created_at FROM {_table('collab_audit')} WHERE book_id=%s AND page_num=%s ORDER BY id DESC LIMIT %s", (book_id, page_num, min(max(limit, 1), 100)))
            rows = cur.fetchall()
        for row in rows:
            row["before"] = json.loads(row.pop("before_json"))
            row["after"] = json.loads(row.pop("after_json"))
        return rows
    finally:
        db.close()
