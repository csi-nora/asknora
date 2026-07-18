"""Embedding provider comparison: OpenAI, Cohere, Voyage, Sentence-Transformers, BGE."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from src.config import get_settings
from src.logging_setup import setup_logging

log = setup_logging(__name__)

EmbeddingBackend = Literal["openai", "cohere", "voyage", "sentence-transformers", "bge"]


@dataclass
class EmbeddingResult:
    backend: EmbeddingBackend
    model: str
    vectors: list[list[float]]
    dimensions: int


def embed_texts(texts: list[str], backend: EmbeddingBackend = "sentence-transformers") -> EmbeddingResult:
    s = get_settings()
    if not texts:
        raise ValueError("texts must not be empty")

    if backend == "openai":
        if not s.openai_api_key:
            raise ValueError("OPENAI_API_KEY required for OpenAI embeddings")
        from openai import OpenAI

        client = OpenAI(api_key=s.openai_api_key)
        resp = client.embeddings.create(model=s.embedding_model_openai, input=texts)
        vectors = [d.embedding for d in resp.data]
        return EmbeddingResult(backend, s.embedding_model_openai, vectors, len(vectors[0]))

    if backend == "cohere":
        if not s.cohere_api_key:
            raise ValueError("COHERE_API_KEY required")
        import cohere

        client = cohere.ClientV2(api_key=s.cohere_api_key)
        resp = client.embed(model="embed-english-v3.0", texts=texts, input_type="search_document")
        vectors = resp.embeddings  # type: ignore[assignment]
        return EmbeddingResult(backend, "embed-english-v3.0", vectors, len(vectors[0]))

    if backend == "voyage":
        if not s.voyage_api_key:
            raise ValueError("VOYAGE_API_KEY required")
        import voyageai

        client = voyageai.Client(api_key=s.voyage_api_key)
        resp = client.embed(texts, model="voyage-3-lite")
        vectors = resp.embeddings
        return EmbeddingResult(backend, "voyage-3-lite", vectors, len(vectors[0]))

    from sentence_transformers import SentenceTransformer

    from src.providers.device import resolve_device, torch_device_string

    s.apply_device()
    model_name = s.embedding_model_bge if backend == "bge" else s.embedding_model_local
    device = torch_device_string(resolve_device(s.accel_device))
    # NPU: SentenceTransformers typically falls back to CPU; OpenVINO path is separate
    if s.accel_device == "npu" and device == "cpu":
        log.info("NPU selected — using CPU for SentenceTransformers (install openvino for NPU IR models)")
    model = SentenceTransformer(model_name, device=device)
    arr = model.encode(texts, normalize_embeddings=True)
    vectors = arr.tolist()
    return EmbeddingResult(backend, model_name, vectors, len(vectors[0]))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb))
    if denom == 0:
        return 0.0
    return float(np.dot(va, vb) / denom)
