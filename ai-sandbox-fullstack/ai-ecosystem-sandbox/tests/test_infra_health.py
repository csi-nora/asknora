"""Infrastructure health checks."""

from __future__ import annotations

import httpx
import pytest

from src.config import get_settings


@pytest.fixture
def settings():
    return get_settings()


def test_ollama_reachable(settings):
    try:
        r = httpx.get(f"{settings.ollama_base_url.rstrip('/')}/api/tags", timeout=5.0)
        assert r.status_code == 200
    except httpx.HTTPError:
        pytest.skip("Ollama not running")


def test_qdrant_reachable(settings):
    try:
        r = httpx.get(f"{settings.qdrant_url.rstrip('/')}/readyz", timeout=5.0)
        assert r.status_code == 200
    except httpx.HTTPError:
        pytest.skip("Qdrant not running")


def test_chroma_reachable(settings):
    try:
        r = httpx.get(f"{settings.chroma_url}/api/v2/heartbeat", timeout=5.0)
        assert r.status_code == 200
    except httpx.HTTPError:
        pytest.skip("Chroma not running")
