"""Environment configuration with sensible defaults and Ollama fallback."""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal

from dotenv import load_dotenv
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()


ProviderName = Literal["openai", "anthropic", "google", "groq", "ollama"]
AccelDevice = Literal["cpu", "gpu", "npu", "auto"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Compute scaling: cpu | gpu | npu | auto
    accel_device: AccelDevice = "auto"
    accel_backend: str = ""
    openvino_device: str = "AUTO"
    ollama_num_gpu: int | None = None
    ovms_url: str = "http://localhost:9000"

    # LLM
    openai_api_key: str = ""
    anthropic_api_key: str = ""
    google_api_key: str = ""
    groq_api_key: str = ""
    llm_provider_order: str = "openai,anthropic,google,groq,ollama"
    llm_model_openai: str = "gpt-4o-mini"
    llm_model_anthropic: str = "claude-3-5-haiku-20241022"
    llm_model_google: str = "gemini-2.0-flash"
    llm_model_groq: str = "llama-3.1-8b-instant"
    llm_model_ollama: str = "llama3.1:8b"
    ollama_base_url: str = "http://localhost:11434"

    # Embeddings
    embedding_model_openai: str = "text-embedding-3-small"
    embedding_model_local: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_model_bge: str = "BAAI/bge-small-en-v1.5"
    cohere_api_key: str = ""
    voyage_api_key: str = ""

    # Infra
    qdrant_url: str = "http://localhost:6333"
    chroma_host: str = "localhost"
    chroma_port: int = 8000
    redis_url: str = "redis://localhost:6379/0"
    postgres_dsn: str = "postgresql://sandbox:sandbox_dev_password@localhost:5432/ai_sandbox"

    # Observability
    langsmith_api_key: str = ""
    langsmith_project: str = "ai-ecosystem-sandbox"
    langsmith_tracing: bool = True
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_host: str = "http://localhost:3000"
    phoenix_collector_endpoint: str = "http://localhost:6006"
    zep_api_key: str = ""
    zep_project_id: str = ""

    # Security
    guardrails_enabled: bool = True
    log_level: str = "INFO"

    @property
    def chroma_url(self) -> str:
        return f"http://{self.chroma_host}:{self.chroma_port}"

    @property
    def provider_chain(self) -> list[ProviderName]:
        valid: set[str] = {"openai", "anthropic", "google", "groq", "ollama"}
        out: list[ProviderName] = []
        for p in self.llm_provider_order.split(","):
            name = p.strip().lower()
            if name in valid and name not in out:
                out.append(name)  # type: ignore[arg-type]
        return out or ["ollama"]

    def provider_has_key(self, provider: ProviderName) -> bool:
        return {
            "openai": bool(self.openai_api_key),
            "anthropic": bool(self.anthropic_api_key),
            "google": bool(self.google_api_key),
            "groq": bool(self.groq_api_key),
            "ollama": True,
        }[provider]

    def model_for(self, provider: ProviderName) -> str:
        return {
            "openai": self.llm_model_openai,
            "anthropic": self.llm_model_anthropic,
            "google": self.llm_model_google,
            "groq": self.llm_model_groq,
            "ollama": self.llm_model_ollama,
        }[provider]

    def configure_langsmith(self) -> None:
        if self.langsmith_api_key and self.langsmith_tracing:
            os.environ.setdefault("LANGCHAIN_TRACING_V2", "true")
            os.environ.setdefault("LANGCHAIN_API_KEY", self.langsmith_api_key)
            os.environ.setdefault("LANGCHAIN_PROJECT", self.langsmith_project)

    def apply_device(self) -> dict:
        """Resolve ACCEL_DEVICE and export process env for runtimes."""
        from src.providers.device import apply_accel_env, status_report

        info = apply_accel_env(self.accel_device)
        if self.ollama_num_gpu is not None:
            os.environ["OLLAMA_NUM_GPU"] = str(self.ollama_num_gpu)
        if self.openvino_device and self.openvino_device != "AUTO":
            os.environ["OPENVINO_DEVICE"] = self.openvino_device
        return status_report(self.accel_device)


@lru_cache
def get_settings() -> Settings:
    return Settings()
