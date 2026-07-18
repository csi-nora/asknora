"""
CSI Nora ↔ AI Ecosystem Sandbox bridge (FastAPI) — lightweight (httpx only).

Run:
  uvicorn apps.nora_bridge.main:app --host 0.0.0.0 --port 8090
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.providers.device import apply_accel_env, ollama_num_gpu, resolve_device, status_report
from src.providers.guardrails import guard_input, guard_output

OLLAMA = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("LLM_MODEL_OLLAMA", "llama3.2:1b")

app = FastAPI(title="CSI Nora Sandbox Bridge", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Accel = Literal["auto", "cpu", "gpu", "npu"]


class NoraChatRequest(BaseModel):
    message: str | None = None
    messages: list[dict[str, str]] | None = None
    model: str | None = None
    max_tokens: int = Field(default=512, ge=16, le=4096)
    accel_device: Accel = "auto"
    use_guardrails: bool = True
    system: str | None = None


class NoraChatResponse(BaseModel):
    answer: str
    provider: str
    model: str
    accel: dict[str, Any]
    guarded: bool = False
    guard_reason: str | None = None


def _ollama_up() -> bool:
    try:
        r = httpx.get(f"{OLLAMA}/api/tags", timeout=5.0)
        return r.status_code == 200
    except Exception:
        return False


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "status": "ok" if _ollama_up() else "degraded",
        "ollama": _ollama_up(),
        "ollama_base_url": OLLAMA,
        "accel": status_report(os.getenv("ACCEL_DEVICE", "auto")),  # type: ignore[arg-type]
    }


@app.get("/v1/devices")
def devices(preference: Accel = "auto") -> dict[str, Any]:
    return status_report(preference)


@app.get("/v1/models")
def models() -> dict[str, Any]:
    try:
        r = httpx.get(f"{OLLAMA}/api/tags", timeout=8.0)
        r.raise_for_status()
        tags = r.json().get("models", [])
        data = [{"id": m.get("name", "unknown"), "object": "model", "owned_by": "ollama"} for m in tags]
    except Exception:
        data = [{"id": DEFAULT_MODEL, "object": "model", "owned_by": "ollama"}]
    return {"object": "list", "data": data}


def _chat_ollama(system: str, user: str, model: str, accel: Accel, max_tokens: int) -> str:
    info = apply_accel_env(accel)
    num_gpu = ollama_num_gpu(info)
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "stream": False,
        "options": {"num_predict": max_tokens, "num_gpu": num_gpu},
        "chat_template_kwargs": {"enable_thinking": False},
    }
    # Prefer OpenAI-compat endpoint
    r = httpx.post(f"{OLLAMA}/v1/chat/completions", json=payload, timeout=180.0)
    if r.status_code >= 400:
        # Fallback native API
        r2 = httpx.post(
            f"{OLLAMA}/api/chat",
            json={"model": model, "messages": payload["messages"], "stream": False, "options": payload["options"]},
            timeout=180.0,
        )
        r2.raise_for_status()
        return (r2.json().get("message") or {}).get("content") or ""
    r.raise_for_status()
    msg = r.json()["choices"][0]["message"]
    return (msg.get("content") or msg.get("reasoning_content") or "").strip()


@app.post("/v1/chat", response_model=NoraChatResponse)
def nora_chat(body: NoraChatRequest) -> NoraChatResponse:
    user_text = body.message
    if not user_text and body.messages:
        user_msgs = [m.get("content", "") for m in body.messages if m.get("role") == "user"]
        user_text = user_msgs[-1] if user_msgs else ""
    if not user_text:
        raise HTTPException(400, "message or messages required")

    if body.use_guardrails:
        gin = guard_input(user_text)
        if not gin.allowed:
            return NoraChatResponse(
                answer=f"Blocked by sandbox guardrails: {gin.reason}",
                provider="guardrails",
                model="n/a",
                accel=status_report(body.accel_device),
                guarded=True,
                guard_reason=gin.reason,
            )

    system = body.system or (
        "You are CSI Nora, Singtel enterprise portfolio advisor. "
        "Be concise. Apply Singapore PDPA / MAS TRM context when relevant."
    )
    model = body.model or DEFAULT_MODEL
    try:
        answer = _chat_ollama(system, user_text, model, body.accel_device, body.max_tokens)
    except Exception as exc:
        raise HTTPException(502, f"LLM failed: {exc}") from exc

    guarded = False
    reason = None
    if body.use_guardrails:
        gout = guard_output(answer)
        if not gout.allowed:
            answer = gout.message or "Response restricted by output guardrails."
            guarded = True
            reason = gout.reason

    info = resolve_device(body.accel_device)
    return NoraChatResponse(
        answer=answer or "No response.",
        provider="ollama",
        model=model,
        accel=status_report(body.accel_device),
        guarded=guarded,
        guard_reason=reason,
    )


@app.post("/v1/chat/completions")
def openai_compat(body: dict[str, Any]) -> dict[str, Any]:
    msgs = body.get("messages") or []
    system = ""
    user_parts: list[str] = []
    for m in msgs:
        if m.get("role") == "system":
            system = m.get("content") or ""
        elif m.get("role") == "user":
            user_parts.append(m.get("content") or "")
    req = NoraChatRequest(
        message=user_parts[-1] if user_parts else "",
        system=system or None,
        model=body.get("model"),
        max_tokens=int(body.get("max_tokens") or 512),
        accel_device=os.getenv("ACCEL_DEVICE", "auto"),  # type: ignore[arg-type]
    )
    out = nora_chat(req)
    return {
        "id": "nora-sandbox",
        "object": "chat.completion",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": out.answer}, "finish_reason": "stop"}
        ],
        "model": out.model,
    }
