"""Observability: LangSmith, Langfuse, Phoenix helpers."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Any, Generator

from src.config import get_settings
from src.logging_setup import setup_logging

log = setup_logging(__name__)


def setup_langsmith() -> bool:
    s = get_settings()
    if not s.langsmith_api_key:
        return False
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = s.langsmith_api_key
    os.environ["LANGCHAIN_PROJECT"] = s.langsmith_project
    return True


def get_langfuse_client():
    s = get_settings()
    if not s.langfuse_public_key or not s.langfuse_secret_key:
        return None
    from langfuse import Langfuse

    return Langfuse(
        public_key=s.langfuse_public_key,
        secret_key=s.langfuse_secret_key,
        host=s.langfuse_host,
    )


@contextmanager
def trace_span(name: str, metadata: dict[str, Any] | None = None) -> Generator[dict[str, Any], None, None]:
    """Best-effort trace wrapper for demos."""
    setup_langsmith()
    lf = get_langfuse_client()
    span_ctx = None
    if lf:
        span_ctx = lf.start_as_current_span(name=name, metadata=metadata or {})
        span_ctx.__enter__()
    record: dict[str, Any] = {"name": name, "metadata": metadata or {}}
    try:
        yield record
    finally:
        if span_ctx:
            span_ctx.__exit__(None, None, None)
        if lf:
            lf.flush()


def start_phoenix() -> str | None:
    """Launch local Phoenix UI if available."""
    try:
        import phoenix as px

        session = px.launch_app()
        return str(session.url)
    except Exception as exc:
        log.warning("Phoenix not started: %s", exc)
        return None
