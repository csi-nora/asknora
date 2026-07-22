"""Server-side LLM API key pools with rotation (Responsible AI / ops path).

Keys live in the bridge environment (or `.env` — never commit real values).
Supports comma-separated pools and primary/secondary aliases.

Env (examples):
  OPENAI_API_KEYS=sk-primary,sk-secondary
  OPENAI_API_KEY=sk-primary
  OPENAI_API_KEY_SECONDARY=sk-secondary

  ANTHROPIC_API_KEYS=…   / ANTHROPIC_API_KEY + ANTHROPIC_API_KEY_SECONDARY
  HF_API_KEYS=…          / HF_API_KEY or HUGGINGFACE_API_KEY (+ _SECONDARY)

Ollama needs no keys. Never log full keys — use ``mask_key`` / status fingerprints.
"""

from __future__ import annotations

import os
import threading
import time
from dataclasses import dataclass, field
from typing import Iterable


Provider = str  # openai | anthropic | hf


def mask_key(key: str | None) -> str:
    if not key:
        return "(none)"
    k = key.strip()
    if len(k) <= 8:
        return "***"
    return f"{k[:4]}…{k[-4:]} (len={len(k)})"


def _split_keys(raw: str | None) -> list[str]:
    if not raw:
        return []
    seen: set[str] = set()
    out: list[str] = []
    for part in raw.replace(";", ",").split(","):
        k = part.strip()
        if k and k not in seen:
            seen.add(k)
            out.append(k)
    return out


def _env_pool(primary: str, secondary: str, multi: str) -> list[str]:
    """Build ordered unique key list from MULTI, PRIMARY, SECONDARY env vars."""
    keys = _split_keys(os.getenv(multi))
    for name in (primary, secondary):
        for k in _split_keys(os.getenv(name)):
            if k not in keys:
                keys.append(k)
    return keys


@dataclass
class _PoolState:
    keys: list[str] = field(default_factory=list)
    index: int = 0
    rotations: int = 0
    last_rotate_reason: str | None = None
    last_rotate_at: float | None = None


class KeyPool:
    """In-process rotating key pool (one active key per provider)."""

    # HTTP statuses that trigger failover to the next key
    ROTATE_STATUSES = frozenset({401, 403, 429})

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pools: dict[str, _PoolState] = {
            "openai": _PoolState(keys=_env_pool(
                "OPENAI_API_KEY", "OPENAI_API_KEY_SECONDARY", "OPENAI_API_KEYS")),
            "anthropic": _PoolState(keys=_env_pool(
                "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_SECONDARY", "ANTHROPIC_API_KEYS")),
            "hf": _PoolState(keys=_env_pool(
                "HF_API_KEY", "HF_API_KEY_SECONDARY", "HF_API_KEYS")
                or _env_pool("HUGGINGFACE_API_KEY", "HUGGINGFACE_API_KEY_SECONDARY", "HUGGINGFACE_API_KEYS")),
        }

    def reload(self) -> None:
        """Re-read env (e.g. after ops updates secrets without rebuild)."""
        with self._lock:
            for name, prim, sec, multi in (
                ("openai", "OPENAI_API_KEY", "OPENAI_API_KEY_SECONDARY", "OPENAI_API_KEYS"),
                ("anthropic", "ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY_SECONDARY", "ANTHROPIC_API_KEYS"),
                ("hf", "HF_API_KEY", "HF_API_KEY_SECONDARY", "HF_API_KEYS"),
            ):
                keys = _env_pool(prim, sec, multi)
                if name == "hf" and not keys:
                    keys = _env_pool(
                        "HUGGINGFACE_API_KEY", "HUGGINGFACE_API_KEY_SECONDARY", "HUGGINGFACE_API_KEYS")
                st = self._pools[name]
                st.keys = keys
                st.index = 0 if keys else 0

    def pool_size(self, provider: Provider) -> int:
        return len(self._pools.get(provider, _PoolState()).keys)

    def current(self, provider: Provider) -> str | None:
        with self._lock:
            st = self._pools.get(provider)
            if not st or not st.keys:
                return None
            return st.keys[st.index % len(st.keys)]

    def iter_keys(self, provider: Provider) -> Iterable[str]:
        """Yield keys starting at the active index (for retry loops)."""
        with self._lock:
            st = self._pools.get(provider)
            if not st or not st.keys:
                return []
            n = len(st.keys)
            start = st.index % n
            ordered = [st.keys[(start + i) % n] for i in range(n)]
        return ordered

    def mark_failed(self, provider: Provider, key: str, status: int | None = None, reason: str = "") -> bool:
        """Rotate away from ``key`` if status warrants it. Returns True if rotated."""
        if status is not None and status not in self.ROTATE_STATUSES:
            return False
        with self._lock:
            st = self._pools.get(provider)
            if not st or len(st.keys) < 2:
                return False
            try:
                idx = st.keys.index(key)
            except ValueError:
                return False
            st.index = (idx + 1) % len(st.keys)
            st.rotations += 1
            st.last_rotate_reason = reason or f"http_{status}"
            st.last_rotate_at = time.time()
            print(
                f"[key_pool] rotated {provider} -> slot {st.index} "
                f"({mask_key(st.keys[st.index])}) reason={st.last_rotate_reason}"
            )
            return True

    def status(self) -> dict:
        with self._lock:
            out: dict = {}
            for name, st in self._pools.items():
                active = st.keys[st.index % len(st.keys)] if st.keys else None
                out[name] = {
                    "pool_size": len(st.keys),
                    "active_slot": st.index if st.keys else None,
                    "active_fingerprint": mask_key(active),
                    "rotations": st.rotations,
                    "last_rotate_reason": st.last_rotate_reason,
                }
            return out


_POOL: KeyPool | None = None


def get_key_pool() -> KeyPool:
    global _POOL
    if _POOL is None:
        _POOL = KeyPool()
    return _POOL
