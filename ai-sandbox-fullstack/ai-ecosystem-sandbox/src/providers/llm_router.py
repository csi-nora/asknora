"""Unified LLM router: OpenAI, Anthropic, Google, Groq, Ollama with fallback."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.language_models.chat_models import BaseChatModel

from src.config import ProviderName, get_settings
from src.logging_setup import setup_logging

log = setup_logging(__name__)


@dataclass
class LLMResult:
    text: str
    provider: ProviderName
    model: str
    raw: dict[str, Any] | None = None


def _build_chat_model(provider: ProviderName) -> BaseChatModel:
    s = get_settings()
    model = s.model_for(provider)

    if provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=model, api_key=s.openai_api_key, temperature=0.2)
    if provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=model, api_key=s.anthropic_api_key, temperature=0.2)
    if provider == "google":
        from langchain_google_genai import ChatGoogleGenerativeAI

        return ChatGoogleGenerativeAI(model=model, google_api_key=s.google_api_key, temperature=0.2)
    if provider == "groq":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=model,
            api_key=s.groq_api_key,
            base_url="https://api.groq.com/openai/v1",
            temperature=0.2,
        )
    from langchain_ollama import ChatOllama

    from src.providers.device import ollama_num_gpu, resolve_device

    s.apply_device()
    info = resolve_device(s.accel_device)
    num_gpu = s.ollama_num_gpu if s.ollama_num_gpu is not None else ollama_num_gpu(info)
    return ChatOllama(
        model=model,
        base_url=s.ollama_base_url,
        temperature=0.2,
        num_gpu=num_gpu,
    )


def ollama_available() -> bool:
    s = get_settings()
    try:
        r = httpx.get(f"{s.ollama_base_url.rstrip('/')}/api/tags", timeout=5.0)
        return r.status_code == 200
    except Exception:
        return False


def chat(
    prompt: str,
    system: str = "You are a helpful AI assistant for the Modern AI Ecosystem sandbox.",
    provider: ProviderName | None = None,
) -> LLMResult:
    """Call LLM with provider chain fallback."""
    s = get_settings()
    s.configure_langsmith()
    chain = [provider] if provider else s.provider_chain
    errors: list[str] = []

    for name in chain:
        if not s.provider_has_key(name):
            errors.append(f"{name}: no API key / unavailable")
            continue
        if name == "ollama" and not ollama_available():
            errors.append("ollama: server not reachable")
            continue
        try:
            llm = _build_chat_model(name)
            resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=prompt)])
            text = getattr(resp, "content", str(resp))
            return LLMResult(text=text, provider=name, model=s.model_for(name))
        except Exception as exc:
            log.warning("Provider %s failed: %s", name, exc)
            errors.append(f"{name}: {exc}")

    raise RuntimeError("All LLM providers failed: " + "; ".join(errors))


def list_available_providers() -> list[dict[str, Any]]:
    s = get_settings()
    out = []
    for p in s.provider_chain:
        out.append(
            {
                "provider": p,
                "model": s.model_for(p),
                "configured": s.provider_has_key(p),
                "reachable": ollama_available() if p == "ollama" else s.provider_has_key(p),
            }
        )
    return out
