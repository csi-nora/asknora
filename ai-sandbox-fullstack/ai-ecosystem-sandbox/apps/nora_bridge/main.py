"""
CSI Nora ↔ AI Ecosystem Sandbox bridge (FastAPI) — lightweight (httpx only).

Responsible AI path:
  * Input + output guardrails middleware (see src.providers.guardrails)
  * Server-side LLM API key rotation for cloud providers (src.providers.key_pool)
  * Local Ollama needs no keys; still gets output guardrails when routed here

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
from src.providers.guardrails import guard_input, guard_output, status_report as guardrails_status
from src.providers.key_pool import get_key_pool, mask_key
from apps.nora_bridge.kb import router as kb_router, ensure_ready as kb_ensure_ready

OLLAMA = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.getenv("LLM_MODEL_OLLAMA", "llama3.2:1b")
DEFAULT_OPENAI_MODEL = os.getenv("LLM_MODEL_OPENAI", "gpt-4o-mini")
DEFAULT_ANTHROPIC_MODEL = os.getenv("LLM_MODEL_ANTHROPIC", "claude-3-5-haiku-20241022")
DEFAULT_HF_MODEL = os.getenv("LLM_MODEL_HF", "mistralai/Mistral-7B-Instruct-v0.2")

app = FastAPI(title="CSI Nora Sandbox Bridge", version="1.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:4200", "http://127.0.0.1:4200", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(kb_router)


@app.on_event("startup")
def _bootstrap() -> None:
    try:
        kb_ensure_ready()
        print("[kb] stores bootstrapped (Postgres schema + Qdrant collection ready).")
    except Exception as exc:  # noqa: BLE001
        print(f"[kb] deferred bootstrap (stores not ready yet): {exc}")
    get_key_pool().reload()
    print(f"[key_pool] status={get_key_pool().status()}")


Accel = Literal["auto", "cpu", "gpu", "npu"]
Provider = Literal["ollama", "openai", "anthropic", "hf"]


class NoraChatRequest(BaseModel):
    message: str | None = None
    messages: list[dict[str, str]] | None = None
    model: str | None = None
    max_tokens: int = Field(default=512, ge=16, le=4096)
    accel_device: Accel = "auto"
    use_guardrails: bool = True
    system: str | None = None
    provider: Provider = "ollama"
    api_key: str | None = None  # optional browser key; server pool preferred


class NoraChatResponse(BaseModel):
    answer: str
    provider: str
    model: str
    accel: dict[str, Any]
    guarded: bool = False
    guard_reason: str | None = None
    guard_actions: list[str] = Field(default_factory=list)
    key_rotated: bool = False
    key_fingerprint: str | None = None


def _ollama_up() -> bool:
    try:
        return httpx.get(f"{OLLAMA}/api/tags", timeout=5.0).status_code == 200
    except Exception:
        return False


def _apply_output_guardrails(answer: str, enabled: bool) -> tuple[str, bool, str | None, list[str]]:
    """Output middleware: AFTER LLM, BEFORE client."""
    if not enabled:
        return answer, False, None, []
    gout = guard_output(answer)
    if not gout.allowed:
        return (
            gout.message or "Response restricted by output guardrails.",
            True,
            gout.reason,
            list(gout.actions),
        )
    if gout.actions:
        return gout.sanitized_text or answer, True, gout.reason, list(gout.actions)
    return answer, False, None, []


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    pool = get_key_pool()
    return {
        "status": "ok" if _ollama_up() else "degraded",
        "ollama": _ollama_up(),
        "ollama_base_url": OLLAMA,
        "accel": status_report(os.getenv("ACCEL_DEVICE", "auto")),  # type: ignore[arg-type]
        "guardrails": guardrails_status(),
        "key_pools": {
            k: {"pool_size": v["pool_size"], "rotations": v["rotations"]}
            for k, v in pool.status().items()
        },
    }


@app.get("/guardrails/status")
def guardrails_status_endpoint() -> dict[str, Any]:
    """Responsible AI status: checks enabled + key-pool sizes (never the keys)."""
    return {
        "guardrails": guardrails_status(),
        "key_pools": get_key_pool().status(),
        "notes": {
            "ollama": "Local Ollama needs no API keys; output guardrails still apply on the bridge path.",
            "rotation": "Cloud keys rotate on HTTP 401/403/429. Set OPENAI_API_KEYS=k1,k2 (etc).",
        },
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
    r = httpx.post(f"{OLLAMA}/v1/chat/completions", json=payload, timeout=180.0)
    if r.status_code >= 400:
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


def _ordered_keys(provider: str, client_key: str | None) -> list[str]:
    pool = get_key_pool()
    keys = list(pool.iter_keys(provider))
    if client_key and client_key.strip():
        ck = client_key.strip()
        keys = [ck] + [k for k in keys if k != ck]
    return keys


def _chat_openai(
    system: str, messages: list[dict[str, str]], model: str, max_tokens: int, client_key: str | None,
) -> tuple[str, bool, str | None]:
    pool = get_key_pool()
    keys = _ordered_keys("openai", client_key)
    if not keys:
        raise HTTPException(503, "No OpenAI API key on bridge (OPENAI_API_KEY / OPENAI_API_KEYS).")
    rotated = False
    last_err = "unknown"
    body = {
        "model": model or DEFAULT_OPENAI_MODEL,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}, *messages],
    }
    for key in keys:
        r = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=body,
            timeout=120.0,
        )
        if r.status_code in (401, 403, 429):
            if pool.mark_failed("openai", key, r.status_code):
                rotated = True
            last_err = f"HTTP {r.status_code}"
            continue
        if r.status_code >= 400:
            last_err = r.text[:200]
            continue
        msg = (r.json().get("choices") or [{}])[0].get("message") or {}
        return (msg.get("content") or "").strip(), rotated, mask_key(key)
    raise HTTPException(502, f"OpenAI failed after key attempts: {last_err}")


def _chat_anthropic(
    system: str, messages: list[dict[str, str]], model: str, max_tokens: int, client_key: str | None,
) -> tuple[str, bool, str | None]:
    pool = get_key_pool()
    keys = _ordered_keys("anthropic", client_key)
    if not keys:
        raise HTTPException(503, "No Anthropic API key on bridge (ANTHROPIC_API_KEY / ANTHROPIC_API_KEYS).")
    rotated = False
    last_err = "unknown"
    body = {
        "model": model or DEFAULT_ANTHROPIC_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": messages,
    }
    for key in keys:
        r = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            json=body,
            timeout=120.0,
        )
        if r.status_code in (401, 403, 429):
            if pool.mark_failed("anthropic", key, r.status_code):
                rotated = True
            last_err = f"HTTP {r.status_code}"
            continue
        if r.status_code >= 400:
            last_err = r.text[:200]
            continue
        content = r.json().get("content") or []
        text = content[0].get("text", "") if content else ""
        return text.strip(), rotated, mask_key(key)
    raise HTTPException(502, f"Anthropic failed after key attempts: {last_err}")


def _chat_hf(
    system: str, messages: list[dict[str, str]], model: str, max_tokens: int, client_key: str | None,
) -> tuple[str, bool, str | None]:
    pool = get_key_pool()
    keys = _ordered_keys("hf", client_key)
    if not keys:
        raise HTTPException(503, "No HuggingFace token on bridge (HF_API_KEY / HF_API_KEYS).")
    rotated = False
    last_err = "unknown"
    prompt = f"<s>[INST] {system}\n\n"
    for m in messages[-4:]:
        role = m.get("role", "user")
        content = m.get("content", "")
        prompt += f"User: {content}\n" if role == "user" else f"Assistant: {content}\n"
    prompt += "[/INST]"
    mdl = model or DEFAULT_HF_MODEL
    for key in keys:
        r = httpx.post(
            f"https://api-inference.huggingface.co/models/{mdl}",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"inputs": prompt, "parameters": {"max_new_tokens": max_tokens, "return_full_text": False}},
            timeout=120.0,
        )
        if r.status_code in (401, 403, 429):
            if pool.mark_failed("hf", key, r.status_code):
                rotated = True
            last_err = f"HTTP {r.status_code}"
            continue
        if r.status_code >= 400:
            last_err = r.text[:200]
            continue
        data = r.json()
        if isinstance(data, list):
            text = (data[0] or {}).get("generated_text") or ""
        else:
            text = data.get("generated_text") or str(data)
        return text.strip(), rotated, mask_key(key)
    raise HTTPException(502, f"HuggingFace failed after key attempts: {last_err}")


@app.post("/v1/chat", response_model=NoraChatResponse)
def nora_chat(body: NoraChatRequest) -> NoraChatResponse:
    user_text = body.message
    history: list[dict[str, str]] = []
    if body.messages:
        history = [{"role": m.get("role", "user"), "content": m.get("content", "")} for m in body.messages]
        if not user_text:
            user_msgs = [m["content"] for m in history if m.get("role") == "user"]
            user_text = user_msgs[-1] if user_msgs else ""
    if not user_text:
        raise HTTPException(400, "message or messages required")

    guard_actions: list[str] = []
    if body.use_guardrails:
        gin = guard_input(user_text)
        if not gin.allowed:
            return NoraChatResponse(
                answer=gin.message or f"Blocked by sandbox guardrails: {gin.reason}",
                provider="guardrails",
                model="n/a",
                accel=status_report(body.accel_device),
                guarded=True,
                guard_reason=gin.reason,
                guard_actions=list(gin.actions),
            )
        if gin.sanitized_text:
            user_text = gin.sanitized_text
            guard_actions.extend(gin.actions)

    system = body.system or (
        "You are CSI Nora, Singtel enterprise portfolio advisor. "
        "Be concise. Apply Singapore PDPA / MAS TRM context when relevant."
    )

    key_rotated = False
    key_fp: str | None = None
    provider = body.provider
    model = body.model or (
        DEFAULT_MODEL if provider == "ollama"
        else DEFAULT_OPENAI_MODEL if provider == "openai"
        else DEFAULT_ANTHROPIC_MODEL if provider == "anthropic"
        else DEFAULT_HF_MODEL
    )

    try:
        if provider == "ollama":
            answer = _chat_ollama(system, user_text, model, body.accel_device, body.max_tokens)
        else:
            # Build chat history without duplicating the trailing user turn awkwardly
            msgs = [m for m in history if m.get("role") in ("user", "assistant")]
            if not msgs or msgs[-1].get("content") != user_text:
                msgs = msgs + [{"role": "user", "content": user_text}]
            if provider == "openai":
                answer, key_rotated, key_fp = _chat_openai(system, msgs, model, body.max_tokens, body.api_key)
            elif provider == "anthropic":
                answer, key_rotated, key_fp = _chat_anthropic(system, msgs, model, body.max_tokens, body.api_key)
            else:
                answer, key_rotated, key_fp = _chat_hf(system, msgs, model, body.max_tokens, body.api_key)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(502, f"LLM failed: {exc}") from exc

    answer, guarded, reason, out_actions = _apply_output_guardrails(answer, body.use_guardrails)
    guard_actions.extend(out_actions)
    guarded = guarded or bool(guard_actions)

    return NoraChatResponse(
        answer=answer or "No response.",
        provider=provider,
        model=model,
        accel=status_report(body.accel_device),
        guarded=guarded,
        guard_reason=reason or (", ".join(guard_actions) if guard_actions else None),
        guard_actions=guard_actions,
        key_rotated=key_rotated,
        key_fingerprint=key_fp,
    )


@app.post("/v1/chat/completions")
def openai_compat(body: dict[str, Any]) -> dict[str, Any]:
    """OpenAI-compatible entry used by the Angular app (guarded Responsible AI path)."""
    msgs = body.get("messages") or []
    system = ""
    history: list[dict[str, str]] = []
    for m in msgs:
        role = m.get("role") or "user"
        content = m.get("content") or ""
        if role == "system":
            system = content
        elif role in ("user", "assistant"):
            history.append({"role": role, "content": content})

    # Provider hint: nora_provider field, or Authorization bearer that isn't "ollama"
    provider: Provider = (body.get("nora_provider") or body.get("provider") or "ollama")  # type: ignore[assignment]
    if provider not in ("ollama", "openai", "anthropic", "hf"):
        provider = "ollama"

    api_key = body.get("api_key")
    auth = (body.get("_auth") or "")  # unused; prefer header via Starlette — read below if present
    # Parse Authorization from a nested convention if clients put it in body (Angular sends header;
    # FastAPI won't see it here — accept optional api_key / nora_api_key in body for cloud).
    api_key = api_key or body.get("nora_api_key")

    req = NoraChatRequest(
        messages=history or None,
        message=history[-1]["content"] if history else "",
        system=system or None,
        model=body.get("model"),
        max_tokens=int(body.get("max_tokens") or 512),
        accel_device=body.get("accel_device") or os.getenv("ACCEL_DEVICE", "auto"),  # type: ignore[arg-type]
        provider=provider,
        api_key=api_key,
        use_guardrails=bool(body.get("use_guardrails", True)),
    )
    # Silence unused
    _ = auth
    out = nora_chat(req)
    return {
        "id": "nora-sandbox",
        "object": "chat.completion",
        "choices": [
            {"index": 0, "message": {"role": "assistant", "content": out.answer}, "finish_reason": "stop"}
        ],
        "model": out.model,
        "nora": {
            "provider": out.provider,
            "guarded": out.guarded,
            "guard_reason": out.guard_reason,
            "guard_actions": out.guard_actions,
            "key_rotated": out.key_rotated,
            "key_fingerprint": out.key_fingerprint,
        },
    }
