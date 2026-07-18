"""Memory: Redis session store + optional Zep cloud hooks."""

from __future__ import annotations

import json
import uuid
from typing import Any

from src.config import get_settings
from src.providers.vectorstores import redis_cache_get, redis_cache_set


def new_session_id() -> str:
    return str(uuid.uuid4())


def remember(session_id: str, role: str, content: str) -> None:
    key = f"memory:{session_id}"
    existing = redis_cache_get(key)
    turns: list[dict[str, str]] = json.loads(existing) if existing else []
    turns.append({"role": role, "content": content})
    redis_cache_set(key, json.dumps(turns[-20:]), ttl=86400)


def recall(session_id: str) -> list[dict[str, str]]:
    key = f"memory:{session_id}"
    existing = redis_cache_get(key)
    return json.loads(existing) if existing else []


def zep_add_memory(session_id: str, message: str) -> dict[str, Any] | None:
    """Optional Zep cloud integration."""
    s = get_settings()
    if not s.zep_api_key:
        return None
    try:
        from zep_cloud.client import Zep

        client = Zep(api_key=s.zep_api_key)
        client.memory.add(session_id=session_id, messages=[{"role": "user", "content": message}])
        return {"status": "ok", "backend": "zep"}
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}
